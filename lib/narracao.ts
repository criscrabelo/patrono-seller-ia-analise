/**
 * P2.33.1 — NARRAÇÃO na Operação (publicação assistida).
 *
 * Duas fontes, as duas com a voz da PRÓPRIA titular e sob o seu controle:
 *   - GRAVACAO_REAL: ela grava/envia o áudio (a voz dela de verdade, sem IA), com a declaração de que a
 *     gravação é dela e autoriza o uso como narração DESTE vídeo;
 *   - VOZ_LOCAL: o worker local (Chatterbox, na máquina dela, custo zero) sintetiza o texto com a voz
 *     dela — só com o consentimento de VOZ vigente, a voz aprovada e o perfil ativo. Leva disclosure de IA.
 *
 * Regras:
 *   - a versão ORIGINAL (sem narração) nunca é alterada: a narrada é o MESMO MP4 com a faixa de voz,
 *     guardado à parte no bucket PRIVADO (é a voz dela — dado biométrico);
 *   - a titular OUVE a prévia (URL assinada de 5 min, só ela) e escolhe na aprovação: ORIGINAL ou NARRADA;
 *   - nada é aprovado nem publicado sozinho; a narrada é publicada pela própria titular no app;
 *   - a prévia vence em 7 dias (retenção apaga com remoção confirmada); revogar a voz apaga as narrações
 *     com voz sintetizada ainda não publicadas;
 *   - o formato audiovisual escolhido fica registrado para o aprendizado (P2.21/P2.33.4).
 */
import { randomBytes } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFile, writeFile, unlink } from 'node:fs/promises'
import ffmpegStatic from 'ffmpeg-static'
import { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { registrarAuditoria } from './audit-log'
import { analisarAudio } from './audio-ffprobe'
import { validarReel } from './validacao-de-reel'
import { validarPresenterMode } from './digital-twin'
import { claimsNaoComprovados } from './copy-por-canal'
import { BUCKET_DIGITAL_TWIN_PRIVADO } from './digital-twin-store'
import { consentimentosDoPerfil, podeUsarMaterial } from './digital-twin-consentimento'
import { apagarObjetoComConfirmacao, type PortasDeExclusao } from './digital-twin-exclusao'
import { criarUrlAssinada, criarUrlDeEnvioPrivado, infoDoObjetoPrivado, uploadBufferPrivado } from './supabase'
import { ESTADOS_APROVADOS_OU_ALEM } from './estados-da-publicacao'

const execFileAsync = promisify(execFile)

/** P2.117: VOZ_PROFISSIONAL_LICENCIADA = voz pronta licenciada (Azure, lib/voz/provedor-azure.ts), nunca a voz da titular. */
export type ModoDeNarracao = 'GRAVACAO_REAL' | 'VOZ_LOCAL' | 'VOZ_PROFISSIONAL_LICENCIADA'
export type FormatoAudiovisual = 'IMAGENS_SEM_VOZ' | 'NARRACAO_GRAVADA' | 'NARRACAO_VOZ_LOCAL' | 'NARRACAO_VOZ_LICENCIADA'
export type EstadoDaNarracao = 'AGUARDANDO_GRAVACAO' | 'NA_FILA' | 'PREVIA_PRONTA' | 'FALHOU' | 'DESCARTADA'
export type VersaoEscolhida = 'ORIGINAL' | 'NARRADA'

export interface ChecagemDoAudio {
  veredito: 'APROVADO' | 'REVISAR' | 'BLOQUEADO'
  problemas: string[]
  duracaoAudioS: number | null
  duracaoVideoS: number | null
  mediaDb: number | null
  picoDb: number | null
}

export interface NarracaoDaPublicacao {
  modo: ModoDeNarracao
  estado: EstadoDaNarracao
  criadaEm: string
  expiraEm: string
  /** A narração vale para ESTA versão e ESTE arquivo do vídeo (ajuste/novo render = narração obsoleta). */
  versaoDoVideo: number
  arquivoBase: string
  declaracao: { por: string; em: string; texto: string }
  caminhoPendente?: string | null
  mime?: string | null
  audioPath?: string | null
  videoPath?: string | null
  texto?: string | null
  jobId?: string | null
  qg?: ChecagemDoAudio | null
  motivo?: string | null
  aprovadaEm?: string | null
}

export class ErroDeNarracao extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export const MIMES_DE_AUDIO: Record<string, string> = {
  'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a',
  'audio/aac': 'aac', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav',
}
export const TAMANHO_MAXIMO_DA_GRAVACAO = 20 * 1024 * 1024
export const VALIDADE_DA_PREVIA_MS = 7 * 24 * 60 * 60 * 1000
export const VALIDADE_DO_ENVIO_MS = 60 * 60 * 1000
export const DECLARACAO_DA_GRAVACAO = 'Esta gravação é da minha própria voz, feita por mim, e autorizo o seu uso como narração deste vídeo.'
export const DECLARACAO_DA_VOZ_LOCAL = 'Autorizo gerar a narração deste vídeo com a minha voz, sintetizada no meu computador.'
export const DISCLOSURE_DA_VOZ_SINTETICA = 'Narração com voz gerada por inteligência artificial a partir da minha própria voz.'
export const DISCLOSURE_DA_VOZ_LICENCIADA = 'Narração com voz gerada por inteligência artificial.'
const PREFIXO = 'narracoes'

// ── Funções puras ───────────────────────────────────────────────────────

/** FUNÇÃO PURA. A faixa de narração serve para este vídeo? (não corta fala, não satura, não é silêncio) */
export function checarAudioDaNarracao(p: { duracaoAudioS: number | null; duracaoVideoS: number | null; mediaDb: number | null; picoDb: number | null }): ChecagemDoAudio {
  const bloqueios: string[] = []
  const revisoes: string[] = []
  if (p.duracaoAudioS == null || p.duracaoAudioS < 1) bloqueios.push('Áudio vazio ou ilegível.')
  if (p.duracaoVideoS == null) bloqueios.push('Não consegui medir a duração do vídeo.')
  if (p.duracaoAudioS != null && p.duracaoVideoS != null && p.duracaoAudioS > p.duracaoVideoS + 1) {
    bloqueios.push(`A narração tem ${p.duracaoAudioS.toFixed(1)} s e o vídeo ${p.duracaoVideoS.toFixed(1)} s: a fala seria cortada. Grave mais curto.`)
  }
  if (p.mediaDb != null && p.mediaDb < -40) bloqueios.push('A gravação está quase em silêncio.')
  else if (p.mediaDb != null && p.mediaDb < -30) revisoes.push('A gravação está baixa: fale mais perto do celular.')
  if (p.picoDb != null && p.picoDb >= -0.3) revisoes.push('A gravação chega ao volume máximo (pode estourar): grave um pouco mais longe.')
  const veredito = bloqueios.length ? 'BLOQUEADO' : revisoes.length ? 'REVISAR' : 'APROVADO'
  return { veredito, problemas: [...bloqueios, ...revisoes], duracaoAudioS: p.duracaoAudioS, duracaoVideoS: p.duracaoVideoS, mediaDb: p.mediaDb, picoDb: p.picoDb }
}

/** FUNÇÃO PURA. Texto para a voz sintetizada: curto, sem depoimento fictício e sem alegação não comprovada. */
export function validarTextoDaNarracao(texto: unknown): { ok: true; texto: string } | { ok: false; motivo: string } {
  if (typeof texto !== 'string') return { ok: false, motivo: 'Informe o texto da narração.' }
  const t = texto.replace(/\s+/g, ' ').trim()
  if (t.length < 10) return { ok: false, motivo: 'O texto da narração está curto demais.' }
  const palavras = t.split(' ').length
  if (palavras > 60) return { ok: false, motivo: `O texto tem ${palavras} palavras; para um vídeo curto use até 60.` }
  const presenter = validarPresenterMode(t)
  if (!presenter.valido) return { ok: false, motivo: presenter.motivo }
  const claims = claimsNaoComprovados(t)
  if (claims.length) return { ok: false, motivo: `O texto tem alegação não comprovada: ${claims.join(', ')}.` }
  return { ok: true, texto: t }
}

/** FUNÇÃO PURA. Texto sugerido = o que já está aprovado na tela (gancho, frases do roteiro, CTA). */
export function textoSugeridoDaNarracao(v: { gancho: string; roteiro: { etapa: string; texto: string }[]; cta: string }, nomeDoProduto: string): string {
  const meio = v.roteiro.map((r) => r.texto.trim()).filter((t) => t && !/^(mostre|abra|compare|diga|feche|grave|filme|use)\b/i.test(t))
  return [v.gancho, nomeDoProduto, ...meio, v.cta].map((x) => x.trim().replace(/[.!?…]*$/, '')).filter(Boolean).join('. ') + '.'
}

/** FUNÇÃO PURA. A narração pode ser usada AGORA neste vídeo? */
export function narracaoUtilizavel(n: NarracaoDaPublicacao | null | undefined, a: { versao: number; apresentacao: unknown }, agora: Date = new Date()): { ok: boolean; motivo: string | null } {
  if (!n) return { ok: false, motivo: 'Não há narração para este vídeo.' }
  if (n.estado !== 'PREVIA_PRONTA') return { ok: false, motivo: 'A narração ainda não está pronta.' }
  if (!n.videoPath || !n.qg || n.qg.veredito === 'BLOQUEADO') return { ok: false, motivo: 'A narração não passou na checagem do áudio.' }
  const arquivo = ((a.apresentacao ?? {}) as { video?: { arquivo?: string | null } }).video?.arquivo ?? null
  if (n.versaoDoVideo !== a.versao || n.arquivoBase !== arquivo) return { ok: false, motivo: 'O vídeo mudou depois da narração: grave ou gere a narração de novo.' }
  if (new Date(n.expiraEm).getTime() <= agora.getTime()) return { ok: false, motivo: 'A prévia da narração venceu: grave ou gere de novo.' }
  return { ok: true, motivo: null }
}

/** FUNÇÃO PURA. O formato audiovisual que vai ao ar (para o aprendizado). */
export function formatoAudiovisualDa(versao: VersaoEscolhida, n: NarracaoDaPublicacao | null | undefined): FormatoAudiovisual {
  if (versao !== 'NARRADA' || !n) return 'IMAGENS_SEM_VOZ'
  return n.modo === 'VOZ_LOCAL' ? 'NARRACAO_VOZ_LOCAL' : n.modo === 'VOZ_PROFISSIONAL_LICENCIADA' ? 'NARRACAO_VOZ_LICENCIADA' : 'NARRACAO_GRAVADA'
}

/** FUNÇÃO PURA. Legenda com o disclosure de IA quando a voz é sintetizada (nunca escondido). */
export function legendaComDisclosure(legenda: string, formato: FormatoAudiovisual): string {
  const aviso = formato === 'NARRACAO_VOZ_LOCAL' ? DISCLOSURE_DA_VOZ_SINTETICA : formato === 'NARRACAO_VOZ_LICENCIADA' ? DISCLOSURE_DA_VOZ_LICENCIADA : null
  if (!aviso || legenda.includes(aviso)) return legenda
  return `${legenda.trim()}\n\n${aviso}`
}

export const narracaoDe = (apresentacao: unknown): NarracaoDaPublicacao | null => ((apresentacao ?? {}) as { narracao?: NarracaoDaPublicacao | null }).narracao ?? null

// ── Portas (storage e mídia) — trocáveis em teste ───────────────────────

export interface PortasDaNarracao extends PortasDeExclusao {
  urlDeEnvio(caminho: string): Promise<string>
  info(caminho: string): Promise<{ tamanho: number | null; mime: string | null } | null>
  baixarPrivado(caminho: string): Promise<Buffer>
  subirPrivado(buffer: Buffer, caminho: string, mime: string): Promise<void>
  urlDeLeitura(caminho: string): Promise<string>
  baixarUrl(url: string): Promise<Buffer>
}

const PORTAS_REAIS: PortasDaNarracao = {
  urlDeEnvio: async (c) => (await criarUrlDeEnvioPrivado(BUCKET_DIGITAL_TWIN_PRIVADO, c)).signedUrl,
  info: (c) => infoDoObjetoPrivado(BUCKET_DIGITAL_TWIN_PRIVADO, c),
  baixarPrivado: async (c) => {
    const r = await fetch(await criarUrlAssinada(BUCKET_DIGITAL_TWIN_PRIVADO, c, 120))
    if (!r.ok) throw new Error(`Não consegui ler o áudio (HTTP ${r.status}).`)
    return Buffer.from(await r.arrayBuffer())
  },
  subirPrivado: async (b, c, m) => { await uploadBufferPrivado(b, BUCKET_DIGITAL_TWIN_PRIVADO, c, m) },
  urlDeLeitura: (c) => criarUrlAssinada(BUCKET_DIGITAL_TWIN_PRIVADO, c, 300),
  baixarUrl: async (u) => {
    const r = await fetch(u)
    if (!r.ok) throw new Error(`Não consegui baixar o vídeo (HTTP ${r.status}).`)
    return Buffer.from(await r.arrayBuffer())
  },
  apagar: async (bucket, c) => { const { deleteFilePrivado } = await import('./supabase'); await deleteFilePrivado(bucket, c) },
  existe: async (bucket, c) => (await infoDoObjetoPrivado(bucket, c)) !== null,
}
let portasAtuais: PortasDaNarracao = PORTAS_REAIS
/** Só para teste. `null` volta às reais. */
export function definirPortasDaNarracao(p: Partial<PortasDaNarracao> | null) { portasAtuais = p ? { ...PORTAS_REAIS, ...p } : PORTAS_REAIS }

/** P2.69: bytes do vídeo NARRADO (armazenamento privado) — é ESTE arquivo que a titular publica na versão narrada. */
export async function baixarVideoNarrado(videoPath: string): Promise<Buffer> {
  if (!videoPath) throw new Error('sem vídeo narrado')
  return portasAtuais.baixarPrivado(videoPath)
}

// ── Leitura e gravação condicionada ─────────────────────────────────────

async function lerPublicacao(workspaceId: string, id: string) {
  const a = await prisma.publicacaoAssistida.findFirst({ where: { id, workspaceId } })
  if (!a) throw new ErroDeNarracao(404, 'Publicação não encontrada.')
  return a
}

/** Grava a narração só se a publicação não mudou desde a leitura (duas abas não se atropelam). */
async function gravarNarracao(a: { id: string; workspaceId: string; updatedAt: Date; apresentacao: unknown }, narracao: NarracaoDaPublicacao | null, extra: Record<string, unknown> = {}) {
  const ap = (a.apresentacao ?? {}) as Record<string, unknown>
  const r = await prisma.publicacaoAssistida.updateMany({
    where: { id: a.id, workspaceId: a.workspaceId, updatedAt: a.updatedAt },
    data: { apresentacao: { ...ap, ...extra, narracao } as unknown as Prisma.InputJsonValue },
  })
  if (r.count !== 1) throw new ErroDeNarracao(409, 'A publicação mudou enquanto a narração era preparada. Atualize a tela e tente de novo.')
}

function exigirPronta(a: { estado: string; demonstracao?: boolean; apresentacao: unknown }) {
  if (a.demonstracao) throw new ErroDeNarracao(409, 'Demonstração em teste não recebe narração.')
  if (a.estado !== 'AGUARDANDO_APROVACAO') throw new ErroDeNarracao(409, `A narração entra antes da aprovação (a publicação está em "${a.estado}").`)
  if (!((a.apresentacao ?? {}) as { video?: { arquivo?: string | null } }).video?.arquivo) throw new ErroDeNarracao(409, 'O vídeo ainda não foi gerado.')
}

async function apagarArquivosDa(n: NarracaoDaPublicacao | null, portas: PortasDeExclusao = portasAtuais): Promise<boolean> {
  if (!n) return true
  let ok = true
  for (const c of [n.caminhoPendente, n.audioPath, n.videoPath]) if (c) ok = (await apagarObjetoComConfirmacao(c, portas)) && ok
  return ok
}

/**
 * P2.69+ (revisão, achado 13): com a versão NARRADA escolhida, a cópia imutável `<ws>/aprovados/<sha>.mp4` (lib/arquivo-aprovado.ts)
 * TAMBÉM tem a voz: sai junto na retenção e na revogação do consentimento. Devolve o que gravar em `apresentacao`.
 */
async function apagarCopiaAprovadaNarrada(a: { apresentacao: unknown }, portas: PortasDeExclusao = portasAtuais): Promise<{ ok: boolean; extra: Record<string, unknown> }> {
  const ap = (a.apresentacao ?? {}) as { versaoEscolhida?: string; arquivoAprovado?: { caminho?: string } | null }
  if (ap.versaoEscolhida !== 'NARRADA' || !ap.arquivoAprovado?.caminho) return { ok: true, extra: {} }
  const ok = await apagarObjetoComConfirmacao(ap.arquivoAprovado.caminho, portas)
  // o registro sai SEMPRE (nada mais entrega a cópia); se a exclusão falhou, o caminho fica pendente para nova tentativa
  return { ok, extra: ok ? { arquivoAprovado: null } : { arquivoAprovado: null, copiaAprovadaPendente: ap.arquivoAprovado.caminho } }
}

const caminhoNovo = (ws: string, id: string, nome: string, ext: string) => `${PREFIXO}/${ws}/${id}/${nome}-${Date.now()}-${randomBytes(4).toString('hex')}.${ext}`

// ── Gravação real ───────────────────────────────────────────────────────

/** Passo ①: autoriza o envio da gravação (direto do navegador ao bucket PRIVADO). */
export async function pedirEnvioDaGravacao(p: { workspaceId: string; userId: string; id: string; mime: unknown; tamanho: unknown; declaro: unknown; agora?: Date }) {
  const agora = p.agora ?? new Date()
  if (p.declaro !== true) throw new ErroDeNarracao(400, `Para usar a gravação, confirme: "${DECLARACAO_DA_GRAVACAO}"`)
  const mime = typeof p.mime === 'string' ? p.mime.split(';')[0].trim().toLowerCase() : ''
  const ext = MIMES_DE_AUDIO[mime]
  if (!ext) throw new ErroDeNarracao(400, 'Formato de áudio não aceito (use webm, ogg, mp3, m4a, aac ou wav).')
  const tamanho = Number(p.tamanho)
  if (!Number.isFinite(tamanho) || tamanho <= 0 || tamanho > TAMANHO_MAXIMO_DA_GRAVACAO) throw new ErroDeNarracao(400, 'A gravação precisa ter até 20 MB.')
  const a = await lerPublicacao(p.workspaceId, p.id)
  exigirPronta(a)
  const anterior = narracaoDe(a.apresentacao)
  if (anterior && anterior.declaracao.por !== p.userId) throw new ErroDeNarracao(403, 'Esta narração é de outra pessoa.')
  await apagarArquivosDa(anterior)
  const caminho = caminhoNovo(p.workspaceId, a.id, 'gravacao', ext)
  const uploadUrl = await portasAtuais.urlDeEnvio(caminho)
  const arquivoBase = ((a.apresentacao ?? {}) as { video: { arquivo: string } }).video.arquivo
  await gravarNarracao(a, {
    modo: 'GRAVACAO_REAL', estado: 'AGUARDANDO_GRAVACAO', criadaEm: agora.toISOString(), expiraEm: new Date(agora.getTime() + VALIDADE_DO_ENVIO_MS).toISOString(),
    versaoDoVideo: a.versao, arquivoBase, declaracao: { por: p.userId, em: agora.toISOString(), texto: DECLARACAO_DA_GRAVACAO }, caminhoPendente: caminho, mime,
  })
  await registrarAuditoria({ workspaceId: p.workspaceId, userId: p.userId, action: 'assistida.narracao_envio_autorizado', entityType: 'PublicacaoAssistida', entityId: a.id, metadata: { mime } })
  return { uploadUrl, contentType: mime }
}

/** Passo ②: confere o que chegou ao storage e monta a prévia narrada (privada). */
export async function confirmarGravacao(p: { workspaceId: string; userId: string; id: string; agora?: Date }) {
  const a = await lerPublicacao(p.workspaceId, p.id)
  const n = narracaoDe(a.apresentacao)
  if (!n || n.estado !== 'AGUARDANDO_GRAVACAO' || !n.caminhoPendente) throw new ErroDeNarracao(409, 'Não há envio de gravação em andamento.')
  if (n.declaracao.por !== p.userId) throw new ErroDeNarracao(403, 'Esta narração é de outra pessoa.')
  exigirPronta(a)
  const info = await portasAtuais.info(n.caminhoPendente)
  if (!info) throw new ErroDeNarracao(409, 'A gravação ainda não chegou ao armazenamento.')
  if (info.tamanho != null && info.tamanho > TAMANHO_MAXIMO_DA_GRAVACAO) {
    await apagarObjetoComConfirmacao(n.caminhoPendente, portasAtuais)
    throw new ErroDeNarracao(400, 'A gravação passou de 20 MB.')
  }
  const audio = await portasAtuais.baixarPrivado(n.caminhoPendente)
  return finalizarNarracao({ a, n: { ...n, audioPath: n.caminhoPendente, caminhoPendente: null }, audio, extensao: MIMES_DE_AUDIO[n.mime ?? ''] ?? 'webm', agora: p.agora })
}

// ── Voz local (Chatterbox, worker na máquina da titular) ────────────────

/** Coloca na fila a narração com a voz sintetizada localmente — só com consentimento de VOZ vigente e voz aprovada. */
export async function pedirNarracaoComVozLocal(p: { workspaceId: string; userId: string; id: string; texto: unknown; agora?: Date }) {
  const agora = p.agora ?? new Date()
  const t = validarTextoDaNarracao(p.texto)
  if (!t.ok) throw new ErroDeNarracao(400, t.motivo)
  const c = await consentimentosDoPerfil(p.workspaceId)
  if (!c.profileId || c.ownerUserId !== p.userId) throw new ErroDeNarracao(403, 'Só a titular do perfil usa a própria voz.')
  const pode = podeUsarMaterial('GENERATED_PREVIEW', 'narration', { userId: p.userId, imagem: c.imagem, voz: c.voz, agora })
  if (!pode.ok) throw new ErroDeNarracao(403, pode.motivo ?? 'Consentimento de voz não vigente.')
  const perfil = await prisma.digitalTwinProfile.findFirst({ where: { id: c.profileId, workspaceId: p.workspaceId }, select: { enabled: true, voiceApprovedAt: true, workerPaused: true } })
  if (!perfil?.enabled || !perfil.voiceApprovedAt) throw new ErroDeNarracao(409, 'A sua voz digital ainda não foi aprovada (Configurações → Digital Twin).')
  if (perfil.workerPaused) throw new ErroDeNarracao(409, 'O processador da sua voz está pausado.')
  const referencia = await prisma.digitalTwinAsset.findFirst({ where: { workspaceId: p.workspaceId, profileId: c.profileId, type: 'VOICE_REFERENCE', active: true }, select: { id: true } })
  if (!referencia) throw new ErroDeNarracao(409, 'Não há gravação de referência da sua voz.')
  const a = await lerPublicacao(p.workspaceId, p.id)
  exigirPronta(a)
  const anterior = narracaoDe(a.apresentacao)
  if (anterior && anterior.declaracao.por !== p.userId) throw new ErroDeNarracao(403, 'Esta narração é de outra pessoa.')
  if (anterior?.estado === 'NA_FILA') throw new ErroDeNarracao(409, 'Já há uma narração com a sua voz na fila.')
  await apagarArquivosDa(anterior)
  const job = await prisma.digitalTwinJob.create({ data: { workspaceId: p.workspaceId, profileId: c.profileId, status: 'QUEUED', jobType: 'NARRATION', contentId: a.id }, select: { id: true } })
  const arquivoBase = ((a.apresentacao ?? {}) as { video: { arquivo: string } }).video.arquivo
  await gravarNarracao(a, {
    modo: 'VOZ_LOCAL', estado: 'NA_FILA', criadaEm: agora.toISOString(), expiraEm: new Date(agora.getTime() + VALIDADE_DA_PREVIA_MS).toISOString(),
    versaoDoVideo: a.versao, arquivoBase, declaracao: { por: p.userId, em: agora.toISOString(), texto: DECLARACAO_DA_VOZ_LOCAL }, texto: t.texto, jobId: job.id,
  })
  await registrarAuditoria({ workspaceId: p.workspaceId, userId: p.userId, action: 'assistida.narracao_voz_local_pedida', entityType: 'PublicacaoAssistida', entityId: a.id, metadata: { jobId: job.id, palavras: t.texto.split(' ').length } })
  return { jobId: job.id }
}

export interface DepsDaVozLocal {
  /** Áudio de referência (bucket privado) → arquivo local. */
  baixarReferencia(storagePath: string): Promise<string>
  /** Sintetiza `texto` com a voz da referência → caminho LOCAL do áudio. */
  sintetizar(p: { audioPromptPath: string; texto: string; idioma: string }): Promise<string>
}

/** Worker: processa o job NARRATION. Re-confere o consentimento AGORA (revogado depois do pedido = nada é gerado). */
export async function processarNarracaoComVozLocal(job: { id: string; workspaceId: string; profileId: string; contentId?: string | null }, deps: DepsDaVozLocal, agora: Date = new Date()): Promise<{ ok: boolean; motivo: string }> {
  if (!job.contentId) return { ok: false, motivo: 'Job de narração sem publicação.' }
  const a = await prisma.publicacaoAssistida.findFirst({ where: { id: job.contentId, workspaceId: job.workspaceId } })
  const n = a ? narracaoDe(a.apresentacao) : null
  if (!a || !n || n.modo !== 'VOZ_LOCAL' || n.jobId !== job.id || n.estado !== 'NA_FILA') return { ok: false, motivo: 'A narração deste job não está mais na fila (descartada ou substituída).' }
  const c = await consentimentosDoPerfil(job.workspaceId)
  const pode = podeUsarMaterial('GENERATED_PREVIEW', 'narration', { userId: n.declaracao.por, imagem: c.imagem, voz: c.voz, agora })
  const perfil = await prisma.digitalTwinProfile.findFirst({ where: { id: job.profileId, workspaceId: job.workspaceId }, select: { enabled: true, voiceApprovedAt: true, ownerUserId: true } })
  const falhar = async (motivo: string) => { await gravarNarracao(a, { ...n, estado: 'FALHOU', motivo }).catch(() => {}); return { ok: false, motivo } }
  if (!pode.ok) return falhar(pode.motivo ?? 'Consentimento de voz não vigente.')
  if (!perfil?.enabled || !perfil.voiceApprovedAt || perfil.ownerUserId !== n.declaracao.por) return falhar('A voz digital não está aprovada/ativa para esta titular.')
  const referencia = await prisma.digitalTwinAsset.findFirst({ where: { workspaceId: job.workspaceId, profileId: job.profileId, type: 'VOICE_REFERENCE', active: true }, orderBy: { createdAt: 'desc' } })
  if (!referencia) return falhar('Não há gravação de referência da voz.')
  let prompt: string | null = null
  let sintetizado: string | null = null
  try {
    prompt = await deps.baixarReferencia(referencia.storagePath)
    sintetizado = await deps.sintetizar({ audioPromptPath: prompt, texto: n.texto ?? '', idioma: 'pt' })
    const audio = await readFile(sintetizado)
    const caminho = caminhoNovo(job.workspaceId, a.id, 'voz-local', 'wav')
    await portasAtuais.subirPrivado(audio, caminho, 'audio/wav')
    await finalizarNarracao({ a, n: { ...n, audioPath: caminho }, audio, extensao: 'wav', agora })
    return { ok: true, motivo: 'Prévia da narração com a sua voz pronta para você ouvir.' }
  } catch (e) {
    return falhar(e instanceof Error ? e.message.slice(0, 300) : 'Falha ao gerar a narração.')
  } finally {
    for (const f of [prompt, sintetizado]) if (f) await unlink(f).catch(() => {})
  }
}

// ── Montagem (comum às duas fontes) ─────────────────────────────────────

async function finalizarNarracao(p: { a: Awaited<ReturnType<typeof lerPublicacao>>; n: NarracaoDaPublicacao; audio: Buffer; extensao: string; agora?: Date }) {
  const agora = p.agora ?? new Date()
  const id = `${Date.now()}-${randomBytes(4).toString('hex')}`
  const tmpAudio = join(tmpdir(), `narracao-a-${id}.${p.extensao}`)
  const tmpVideo = join(tmpdir(), `narracao-v-${id}.mp4`)
  const tmpSaida = join(tmpdir(), `narracao-s-${id}.mp4`)
  try {
    await writeFile(tmpAudio, p.audio)
    await writeFile(tmpVideo, await portasAtuais.baixarUrl(p.n.arquivoBase))
    const [aud, vid] = await Promise.all([analisarAudio(tmpAudio), analisarAudio(tmpVideo)])
    const qg = checarAudioDaNarracao({ duracaoAudioS: aud.duracaoSegundos, duracaoVideoS: vid.duracaoSegundos, mediaDb: aud.meanVolumeDb, picoDb: aud.maxVolumeDb })
    if (qg.veredito === 'BLOQUEADO') {
      await apagarArquivosDa(p.n)
      await gravarNarracao(p.a, { ...p.n, estado: 'FALHOU', audioPath: null, videoPath: null, qg, motivo: qg.problemas.join(' ') })
      throw new ErroDeNarracao(400, `A narração não passou na checagem: ${qg.problemas.join(' ')}`)
    }
    const bin = ffmpegStatic as unknown as string
    // Mesmo vídeo (cópia do vídeo aprovado, sem re-encode) + a faixa de voz, completada até o fim do vídeo.
    await execFileAsync(bin, ['-i', tmpVideo, '-i', tmpAudio, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-af', 'apad', '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-t', String(vid.duracaoSegundos), '-movflags', '+faststart', '-y', tmpSaida])
    const saida = await readFile(tmpSaida)
    const reel = validarReel(saida)
    if (!reel.valido) {
      await apagarArquivosDa(p.n)
      await gravarNarracao(p.a, { ...p.n, estado: 'FALHOU', audioPath: null, videoPath: null, qg, motivo: `Arquivo narrado inválido: ${reel.problemas.join('; ')}` })
      throw new ErroDeNarracao(500, 'O vídeo narrado não passou na checagem do arquivo.')
    }
    const videoPath = caminhoNovo(p.a.workspaceId, p.a.id, 'video-narrado', 'mp4')
    await portasAtuais.subirPrivado(saida, videoPath, 'video/mp4')
    const final: NarracaoDaPublicacao = { ...p.n, estado: 'PREVIA_PRONTA', videoPath, qg, motivo: null, expiraEm: new Date(agora.getTime() + VALIDADE_DA_PREVIA_MS).toISOString() }
    try {
      await gravarNarracao(p.a, final)
    } catch (e) {
      await apagarArquivosDa(final)
      throw e
    }
    await registrarAuditoria({ workspaceId: p.a.workspaceId, userId: p.n.declaracao.por, action: 'assistida.narracao_previa_pronta', entityType: 'PublicacaoAssistida', entityId: p.a.id, metadata: { modo: p.n.modo, veredito: qg.veredito } })
    return { estado: final.estado, qg }
  } finally {
    await Promise.allSettled([unlink(tmpAudio), unlink(tmpVideo), unlink(tmpSaida)])
  }
}

// ── Ouvir, descartar, aprovar ───────────────────────────────────────────

/**
 * P2.69+ (revisão, achados 13/16) — o arquivo que a titular BAIXA para publicar pelo app é a cópia imutável do sha256
 * liberado (`apresentacao.arquivoAprovado`), relida e conferida agora — nas DUAS versões. Na narrada com voz
 * sintetizada, só com o consentimento de voz vigente. Sem arquivo fixado, nada para baixar.
 */
export async function arquivoAprovadoParaATitular(p: { workspaceId: string; userId: string; id: string }): Promise<{ url: string | null; motivo: string | null }> {
  const a = await lerPublicacao(p.workspaceId, p.id)
  const ap = (a.apresentacao ?? {}) as { versaoEscolhida?: string }
  const { registroDoArquivoValido, urlConferidaDoArquivoAprovado } = await import('./arquivo-aprovado-vinculo')
  // só o arquivo da versão e da escolha ATUAIS, num estado de publicação (revisão P2.69+, 3ª rodada, achado 1)
  const aa = registroDoArquivoValido(a)
  if (!aa) return { url: null, motivo: 'O vídeo só fica disponível depois que os controles liberam o arquivo aprovado desta versão.' }
  if (ap.versaoEscolhida === 'NARRADA') {
    const n = narracaoDe(a.apresentacao)
    if (!n || n.declaracao.por !== p.userId) throw new ErroDeNarracao(403, 'Só a titular baixa a própria narração.')
    if (n.modo === 'VOZ_LOCAL') {
      const c = await consentimentosDoPerfil(p.workspaceId)
      const pode = podeUsarMaterial('GENERATED_PREVIEW', 'narration', { userId: p.userId, imagem: c.imagem, voz: c.voz })
      if (!pode.ok) return { url: null, motivo: pode.motivo ?? 'Consentimento de voz não vigente.' }
    }
  }
  const { PORTAS_REAIS_DO_ARQUIVO_APROVADO } = await import('./arquivo-aprovado-real')
  try {
    return { url: await urlConferidaDoArquivoAprovado(aa, PORTAS_REAIS_DO_ARQUIVO_APROVADO), motivo: null }
  } catch {
    return { url: null, motivo: 'O arquivo aprovado não pôde ser conferido agora (sha256). Nada para baixar.' }
  }
}

/** Estado + URLs assinadas (5 min) — só para a pessoa que gravou/autorizou. */
export async function narracaoParaATitular(p: { workspaceId: string; userId: string; id: string }) {
  const a = await lerPublicacao(p.workspaceId, p.id)
  const n = narracaoDe(a.apresentacao)
  if (!n || n.estado === 'DESCARTADA') return { narracao: null }
  if (n.declaracao.por !== p.userId) throw new ErroDeNarracao(403, 'Só a titular ouve a própria narração.')
  let util = narracaoUtilizavel(n, a)
  // Voz sintetizada: sem o consentimento de voz vigente, nenhum link é entregue (nem da prévia aprovada).
  if (n.modo === 'VOZ_LOCAL') {
    const c = await consentimentosDoPerfil(p.workspaceId)
    const pode = podeUsarMaterial('GENERATED_PREVIEW', 'narration', { userId: p.userId, imagem: c.imagem, voz: c.voz })
    if (!pode.ok) return { narracao: { modo: n.modo, estado: n.estado, qg: n.qg ?? null, motivo: pode.motivo, utilizavel: false, texto: n.texto ?? null, expiraEm: n.expiraEm, audioUrl: null, videoUrl: null } }
  }
  return {
    narracao: {
      modo: n.modo, estado: n.estado, qg: n.qg ?? null, motivo: n.motivo ?? util.motivo, utilizavel: util.ok, texto: n.texto ?? null, expiraEm: n.expiraEm,
      audioUrl: n.audioPath && n.estado === 'PREVIA_PRONTA' ? await portasAtuais.urlDeLeitura(n.audioPath) : null,
      videoUrl: n.videoPath && n.estado === 'PREVIA_PRONTA' ? await portasAtuais.urlDeLeitura(n.videoPath) : null,
    },
  }
}

/** Descarta (arquivos apagados com confirmação). A versão original continua intacta. */
export async function descartarNarracao(p: { workspaceId: string; userId: string; id: string }) {
  const a = await lerPublicacao(p.workspaceId, p.id)
  const n = narracaoDe(a.apresentacao)
  if (!n) return { descartada: false }
  if (n.declaracao.por !== p.userId) throw new ErroDeNarracao(403, 'Esta narração é de outra pessoa.')
  if (n.aprovadaEm) throw new ErroDeNarracao(409, 'Esta narração já foi aprovada para publicação.')
  const ok = await apagarArquivosDa(n)
  await gravarNarracao(a, { ...n, estado: 'DESCARTADA', caminhoPendente: ok ? null : n.caminhoPendente, audioPath: ok ? null : n.audioPath, videoPath: ok ? null : n.videoPath, motivo: ok ? 'Descartada pela titular.' : 'Descartada; remoção do arquivo pendente (a retenção tenta de novo).' })
  await registrarAuditoria({ workspaceId: p.workspaceId, userId: p.userId, action: 'assistida.narracao_descartada', entityType: 'PublicacaoAssistida', entityId: a.id, metadata: { removida: ok } })
  return { descartada: true, removida: ok }
}

/**
 * Na APROVAÇÃO (chamado por `aprovarEPublicar`): resolve a versão escolhida pela titular e o que muda.
 * ORIGINAL é o padrão. NARRADA exige a prévia válida, a própria titular e — com voz sintetizada — o
 * consentimento de voz vigente agora e o disclosure de IA na legenda.
 */
export async function versaoParaAprovar(p: { workspaceId: string; userId: string; a: { versao: number; apresentacao: unknown }; versao?: VersaoEscolhida | null; agora?: Date }): Promise<{ versao: VersaoEscolhida; formato: FormatoAudiovisual; narracao: NarracaoDaPublicacao | null }> {
  const n = narracaoDe(p.a.apresentacao)
  if (p.versao !== 'NARRADA') return { versao: 'ORIGINAL', formato: 'IMAGENS_SEM_VOZ', narracao: n }
  const util = narracaoUtilizavel(n, p.a, p.agora)
  if (!util.ok || !n) throw new ErroDeNarracao(409, util.motivo ?? 'Narração indisponível.')
  if (n.declaracao.por !== p.userId) throw new ErroDeNarracao(403, 'Só a titular aprova a narração com a própria voz.')
  if (n.modo === 'VOZ_LOCAL') {
    const c = await consentimentosDoPerfil(p.workspaceId)
    const pode = podeUsarMaterial('GENERATED_PREVIEW', 'narration', { userId: p.userId, imagem: c.imagem, voz: c.voz, agora: p.agora })
    if (!pode.ok) throw new ErroDeNarracao(403, pode.motivo ?? 'Consentimento de voz não vigente.')
  }
  return { versao: 'NARRADA', formato: formatoAudiovisualDa('NARRADA', n), narracao: { ...n, aprovadaEm: (p.agora ?? new Date()).toISOString() } }
}

// ── Retenção e revogação ────────────────────────────────────────────────

const ESTADOS_PUBLICADOS = new Set<string>(ESTADOS_APROVADOS_OU_ALEM)

async function narracoesComArquivo(workspaceId?: string) {
  const linhas = await prisma.$queryRaw<{ id: string; workspaceId: string }[]>`
    SELECT "id", "workspaceId" FROM "PublicacaoAssistida"
    WHERE "apresentacao" ? 'narracao' AND jsonb_typeof("apresentacao"->'narracao') = 'object'
      AND ("apresentacao"->'narracao'->>'estado') <> 'DESCARTADA'
      ${workspaceId ? Prisma.sql`AND "workspaceId" = ${workspaceId}` : Prisma.empty}
    LIMIT 500`
  return linhas
}

/** Retenção: narração vencida (ou envio não concluído) que NÃO foi aprovada para publicação sai com os arquivos. */
export async function limparNarracoesVencidas(agora: Date = new Date(), workspaceId?: string): Promise<{ apagadas: number; pendentes: number }> {
  let apagadas = 0
  let pendentes = 0
  for (const l of await narracoesComArquivo(workspaceId)) {
    const a = await prisma.publicacaoAssistida.findFirst({ where: { id: l.id, workspaceId: l.workspaceId } })
    const n = a ? narracaoDe(a.apresentacao) : null
    if (!a || !n || n.estado === 'DESCARTADA') continue
    const escolhida = (a.apresentacao as { versaoEscolhida?: string } | null)?.versaoEscolhida === 'NARRADA'
    if (escolhida && ESTADOS_PUBLICADOS.has(a.estado)) continue // é o arquivo que vai/foi ao ar
    if (new Date(n.expiraEm).getTime() > agora.getTime()) continue
    const copia = await apagarCopiaAprovadaNarrada(a)
    const ok = (await apagarArquivosDa(n)) && copia.ok
    await gravarNarracao(a, { ...n, estado: 'DESCARTADA', caminhoPendente: ok ? null : n.caminhoPendente, audioPath: ok ? null : n.audioPath, videoPath: ok ? null : n.videoPath, motivo: ok ? 'Vencida (retenção).' : 'Vencida; remoção pendente.' }, copia.extra).catch(() => {})
    if (ok) apagadas++
    else pendentes++
  }
  return { apagadas, pendentes }
}

/**
 * Revogação da voz: TODA narração com voz sintetizada perde os arquivos privados (apagados com confirmação).
 *   - ainda não aprovada → descartada;
 *   - aprovada como NARRADA e ainda NÃO publicada → a aprovação é DESFEITA (volta para "aguardando sua
 *     aprovação", versão original como padrão): sem consentimento, a voz sintetizada não pode ir ao ar;
 *   - já publicada → o vídeo está no TikTok (fora do Patrono): a cópia privada sai e o registro avisa que a
 *     remoção do post, se ela quiser, é feita no app. O formato fica no histórico (fato para o aprendizado).
 */
export async function excluirNarracoesComVozLocal(workspaceId: string, portas?: PortasDeExclusao, agora: Date = new Date()): Promise<number> {
  let n = 0
  for (const l of await narracoesComArquivo(workspaceId)) {
    const a = await prisma.publicacaoAssistida.findFirst({ where: { id: l.id, workspaceId } })
    const nar = a ? narracaoDe(a.apresentacao) : null
    if (!a || !nar || nar.modo !== 'VOZ_LOCAL' || nar.estado === 'DESCARTADA') continue
    const copia = await apagarCopiaAprovadaNarrada(a, portas ?? portasAtuais)
    const ok = (await apagarArquivosDa(nar, portas ?? portasAtuais)) && copia.ok
    const semArquivos = { audioPath: ok ? null : nar.audioPath, videoPath: ok ? null : nar.videoPath }
    const escolhida = (a.apresentacao as { versaoEscolhida?: string } | null)?.versaoEscolhida === 'NARRADA'
    if (escolhida && a.estado === 'PUBLICADO') {
      await gravarNarracao(a, { ...nar, ...semArquivos, estado: 'DESCARTADA', motivo: 'Consentimento de voz revogado: a cópia privada foi apagada. O vídeo já publicado continua no TikTok — remova pelo app, se quiser.' }, copia.extra).catch(() => {})
    } else if (escolhida && ESTADOS_PUBLICADOS.has(a.estado)) {
      const ap = (a.apresentacao ?? {}) as Record<string, unknown>
      const historico = [...(((a.historico as unknown) as unknown[]) ?? []), { em: agora.toISOString(), versao: a.versao, acao: 'APROVACAO_DESFEITA', detalhe: 'Consentimento de voz revogado: a versão narrada com voz sintetizada não pode ir ao ar.' }]
      await prisma.publicacaoAssistida.updateMany({
        where: { id: a.id, workspaceId, updatedAt: a.updatedAt, estado: a.estado },
        data: {
          estado: 'AGUARDANDO_APROVACAO', bloqueio: null, versaoFinal: Prisma.DbNull,
          apresentacao: { ...ap, ...copia.extra, versaoEscolhida: 'ORIGINAL', formatoAudiovisual: 'IMAGENS_SEM_VOZ', narracao: { ...nar, ...semArquivos, estado: 'DESCARTADA', aprovadaEm: null, motivo: 'Consentimento de voz revogado: aprovação desfeita; aprove a versão original ou grave a sua voz.' } } as unknown as Prisma.InputJsonValue,
          historico: historico as unknown as Prisma.InputJsonValue,
        },
      })
    } else {
      await gravarNarracao(a, { ...nar, ...semArquivos, estado: 'DESCARTADA', motivo: 'Consentimento de voz revogado.' }, copia.extra).catch(() => {})
    }
    n++
  }
  return n
}
