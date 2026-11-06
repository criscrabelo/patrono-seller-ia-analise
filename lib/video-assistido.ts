/**
 * P2.17.12 — GERAÇÃO AUTOMÁTICA do vídeo do modo assistido.
 *
 *   produto → roteiro → mídia AUTORIZADA (fonte única) → render (FFmpeg, em
 *   trabalho longo) → Quality Gate do ARQUIVO → só então "aguardando sua
 *   aprovação" → envio pela porta única.
 *
 * Sem mídia autorizada: AGUARDANDO_MIDIA — uma pendência só ("Fornecer
 * mídia autorizada para <produto>"); nada de improvisar com foto de vendedor
 * nem com fundo neutro fingindo ser o produto.
 *
 * Formatos (lista fechada, `politicaDoFormato`):
 *   com IMAGEM autorizada  → PROBLEMA_SOLUCAO, LISTA_3_MOTIVOS, ACHADO_TIKTOK_SHOP,
 *                            PRESENTE, NATAL, POV, UTILIDADE (texto sobre a foto,
 *                            sem fingir movimento ou uso)
 *   com VÍDEO autorizado   → + FACELESS, CURIOSIDADE (mostram o produto em ação)
 *   com VÍDEO PRÓPRIO      → + DEMONSTRACAO, UNBOXING (uso físico: evidência dela)
 *   com DADO REAL          → COMPARACAO (sem dado de comparação: não sai)
 *   NUNCA automático       → SURPRESA, TESTE_REAL, UGC, ANTES_DEPOIS (experiência pessoal)
 */
import { readFile, unlink } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'
import { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { EXIGE_EXPERIENCIA, nomeCurto, type Estrutura } from './motor-de-videos-tiktok'
import { claimsNaoComprovados } from './copy-por-canal'
import { validarReel, type ValidacaoDoReel } from './validacao-de-reel'
import { registrarDerivacao } from './cadeia-de-direitos'
import { marcarUso, midiasAutorizadas, type MidiaUtilizavel, type OrigemDeMidia, type TipoDeMidia } from './midia-do-produto'
import { textosIncoerentesComOProduto, type AvaliacaoDoVideo, type VereditoDoVideo } from './quality-gate-video-tiktok'
import type { CenaNaTela } from './renderer-ffmpeg'
import { iniciarTrabalhoLongo, type Desfecho, type ExecutorDeTrabalho } from './trabalho-longo'
import { registrarEvento } from './ledger'

// ── Política de formatos (pura) ─────────────────────────────────────────

export const FORMATOS_COM_IMAGEM: readonly Estrutura[] = ['PROBLEMA_SOLUCAO', 'LISTA_3_MOTIVOS', 'ACHADO_TIKTOK_SHOP', 'PRESENTE', 'NATAL', 'POV', 'UTILIDADE']
export const FORMATOS_QUE_PEDEM_VIDEO: readonly Estrutura[] = ['FACELESS', 'CURIOSIDADE']
export const FORMATOS_QUE_PEDEM_VIDEO_PROPRIO: readonly Estrutura[] = ['DEMONSTRACAO', 'UNBOXING']
export const FORMATOS_QUE_PEDEM_DADO_REAL: readonly Estrutura[] = ['COMPARACAO']

export interface MidiaParaPolitica {
  tipo: TipoDeMidia
  origem: OrigemDeMidia
}

export type PoliticaDoFormato =
  | { automatico: true; midia: MidiaParaPolitica }
  | { automatico: false; falta: 'MIDIA' | 'VIDEO' | 'VIDEO_PROPRIO' | 'DADO_REAL' | 'EXPERIENCIA_PESSOAL'; motivo: string }

/** FUNÇÃO PURA. Este formato pode ser gerado sozinho com estas mídias? Com qual? */
export function politicaDoFormato(estrutura: string, midias: MidiaParaPolitica[], ctx: { comparacaoComDadoReal?: boolean } = {}): PoliticaDoFormato {
  const e = estrutura as Estrutura
  if (EXIGE_EXPERIENCIA.has(e)) return { automatico: false, falta: 'EXPERIENCIA_PESSOAL', motivo: `${e} afirma experiência pessoal: só com teste real seu, nunca automático.` }
  if (FORMATOS_QUE_PEDEM_DADO_REAL.includes(e) && !ctx.comparacaoComDadoReal) {
    return { automatico: false, falta: 'DADO_REAL', motivo: 'Comparação só com dado real de comparação (ainda não há).' }
  }
  const video = midias.find((m) => m.tipo === 'VIDEO')
  const videoProprio = midias.find((m) => m.tipo === 'VIDEO' && m.origem === 'PROPRIO')
  if (FORMATOS_QUE_PEDEM_VIDEO_PROPRIO.includes(e)) {
    return videoProprio ? { automatico: true, midia: videoProprio } : { automatico: false, falta: 'VIDEO_PROPRIO', motivo: `${e} mostra uso físico: exige vídeo seu do produto.` }
  }
  if (FORMATOS_QUE_PEDEM_VIDEO.includes(e)) {
    return video ? { automatico: true, midia: video } : { automatico: false, falta: 'VIDEO', motivo: `${e} mostra o produto em ação: exige vídeo autorizado.` }
  }
  if (FORMATOS_COM_IMAGEM.includes(e) || FORMATOS_QUE_PEDEM_DADO_REAL.includes(e)) {
    const qualquer = video ?? midias[0]
    return qualquer ? { automatico: true, midia: qualquer } : { automatico: false, falta: 'MIDIA', motivo: 'Falta uma foto ou vídeo autorizado do produto.' }
  }
  return { automatico: false, falta: 'EXPERIENCIA_PESSOAL', motivo: `Formato ${e} fora da lista automática.` }
}

/**
 * FUNÇÃO PURA. P2.18 — O que gravar quando o produto NÃO tem kit (produto em
 * mãos, por exemplo): só cenas do PRODUTO, que qualquer pessoa com ele em mãos
 * consegue fazer, sem afirmar uso nem resultado. Formatos que mostram uso
 * físico pedem o vídeo dela fazendo de verdade — nunca encenação.
 */
export function cenasParaGravarGenericas(estrutura: string): string[] {
  const e = estrutura as Estrutura
  const base = [
    'Foto do produto inteiro, de frente, com luz natural (vertical).',
    'Foto de perto de um detalhe (textura, botão, acabamento ou rótulo).',
    'Foto do produto no lugar onde ele é usado na sua casa (sem você precisar aparecer).',
  ]
  const video = 'Vídeo de 5 a 10 s do produto: girando na mão ou sobre a mesa (vertical, sem música).'
  const extra = FORMATOS_QUE_PEDEM_VIDEO_PROPRIO.includes(e)
    ? ['Vídeo seu abrindo ou usando o produto — só o que aconteceu de verdade (vertical, sem música, sem outras pessoas).']
    : FORMATOS_QUE_PEDEM_VIDEO.includes(e) ? [video] : [video + ' (opcional: deixa o vídeo mais vivo)']
  return [...base, ...extra, 'Mande de 3 a 10 arquivos de uma vez: cada um vira um trecho do vídeo. Nada de foto do vendedor ou de print do app.']
}

/** O formato vale a pena com UMA foto autorizada (o mínimo a pedir quando não há mídia)? */
export function formatoServeComFoto(estrutura: string): boolean {
  return politicaDoFormato(estrutura, [{ tipo: 'IMAGEM', origem: 'PROPRIO' }]).automatico
}

/**
 * FUNÇÃO PURA. A ordem de tentativa das variantes: o que já VENDEU (vencedor
 * do aprendizado por estrutura, só com amostra mínima) primeiro; depois a
 * ordem do plano (produto, objetivo, campanha); por fim as já usadas.
 */
export function ordemDasVariantes(ordemDoPlano: string[], estruturaDe: (id: string) => string, usadas: Set<string>, vencedor: string | null, pontuar?: (id: string) => number): string[] {
  const novas = ordemDoPlano.filter((id) => !usadas.has(id))
  const repetidas = ordemDoPlano.filter((id) => usadas.has(id))
  const primeiro = (xs: string[]) => (vencedor ? [...xs.filter((id) => estruturaDe(id) === vencedor), ...xs.filter((id) => estruturaDe(id) !== vencedor)] : xs)
  // P2.21: a orientação do aprendizado criativo (só PADRAO_PROVAVEL+) reordena de forma estável: preferido antes, "evitar" por último.
  const porPontos = (xs: string[]) => (pontuar ? xs.map((id, i) => ({ id, i, s: pontuar(id) })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.id) : xs)
  return [...porPontos(primeiro(novas)), ...porPontos(primeiro(repetidas))]
}

// ── Cenas na tela (pura) ────────────────────────────────────────────────

/** Instrução para quem grava ("Mostre…", "Abra…") não vai para a tela. */
const INSTRUCAO = /^(mostre|abra|compare|diga|feche|grave|filme|use)\b/i
/** Telas que afirmam movimento/uso: com FOTO seriam mentira. */
const TELAS_DE_MOVIMENTO = /^(Demonstração|Prova|Abertura)$/

/** Emoji e símbolos fora da fonte viram "tofu" no vídeo: saem. */
export function textoParaTela(t: string): string {
  return t.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu, '').replace(/\s+/g, ' ').trim()
}

/** Quebra em linhas de até `largura` caracteres (o drawtext não quebra sozinho). */
export function quebrarLinhas(t: string, largura = 22): string {
  const linhas: string[] = []
  let atual = ''
  for (const p of t.split(' ')) {
    if (!atual) atual = p
    else if ((atual + ' ' + p).length <= largura) atual += ' ' + p
    else {
      linhas.push(atual)
      atual = p
    }
  }
  if (atual) linhas.push(atual)
  return linhas.join('\n')
}

export interface VersaoParaCenas {
  gancho: string
  roteiro: { etapa: string; texto: string; textoNaTela: string | null }[]
  cta: string
  duracaoSegundos: number
}

/**
 * FUNÇÃO PURA. As cenas que vão ao vídeo — só o que é verdade com ESTA mídia:
 * gancho (0–3 s) → nome do produto → etapas com texto real → CTA (3 s finais).
 * Com foto, etapas que afirmam movimento/uso ficam de fora.
 */
export function cenasDoVideo(v: VersaoParaCenas, nomeProduto: string, tipoDaMidia: TipoDeMidia): CenaNaTela[] {
  const dur = Math.max(10, v.duracaoSegundos)
  const meio: string[] = [nomeCurto(nomeProduto)]
  for (const r of v.roteiro) {
    if (/^Gancho|^CTA$/.test(r.etapa)) continue
    const texto = r.texto.trim()
    // Com FOTO, a etapa que afirma movimento/uso perde o rótulo ("Olha como
    // funciona"); só fica o texto que é DADO (ex.: vendas da loja), nunca instrução.
    const movimentoComFoto = tipoDaMidia === 'IMAGEM' && TELAS_DE_MOVIMENTO.test(r.etapa)
    const tela = r.textoNaTela && !movimentoComFoto ? textoParaTela(r.textoNaTela) : ''
    if (texto && !INSTRUCAO.test(texto)) meio.push(tela && /^Motivo/.test(r.etapa) ? `${tela}: ${texto}` : texto)
    else if (tela) meio.push(tela)
  }
  const limpos = [...new Set(meio.map(textoParaTela).filter(Boolean))].slice(0, 5)
  const inicioCta = dur - 3
  const fatia = (inicioCta - 3) / limpos.length
  const cenas: CenaNaTela[] = [{ texto: quebrarLinhas(textoParaTela(v.gancho)), inicio: 0, fim: 3, posicao: 'topo', tamanho: 64 }]
  limpos.forEach((t, i) => cenas.push({ texto: quebrarLinhas(t), inicio: +(3 + i * fatia).toFixed(2), fim: +(3 + (i + 1) * fatia).toFixed(2), posicao: i === 0 ? 'rodape' : 'centro' }))
  cenas.push({ texto: quebrarLinhas(textoParaTela(v.cta)), inicio: inicioCta, fim: dur, posicao: 'centro', tamanho: 62 })
  return cenas
}

// ── Quality Gate do ARQUIVO (pura) ──────────────────────────────────────

export interface ChecagemDoArquivo {
  valido: boolean
  problemas: string[]
  duracaoS: number | null
  largura: number | null
  altura: number | null
  tamanhoBytes: number
  direitoPublicavel: boolean
  motivoDoDireito: string
}

const PIOR: Record<VereditoDoVideo, number> = { APROVADO: 0, REVISAR: 1, BLOQUEADO: 2 }

/**
 * FUNÇÃO PURA. O Quality Gate do VÍDEO FINAL: o arquivo de verdade (MP4
 * legível, 9:16, duração do roteiro, H.264), a cadeia de direitos (todas as
 * fontes autorizadas, arquivo em custódia própria) e o texto queimado (sem
 * alegação). Somado à checagem do roteiro: vale o PIOR veredito.
 */
export function qualityGateDoVideoFinal(p: {
  roteiro: AvaliacaoDoVideo
  reel: ValidacaoDoReel
  duracaoPlanejada: number
  direito: { publicavel: boolean; motivo: string }
  cenas: CenaNaTela[]
  /** P2.34: quantos trechos de mídia o vídeo tem (para conferir a sincronia texto × troca de imagem). */
  trechos?: number | null
  /** P2.34: o produto (coerência do texto queimado com o que ele é). */
  produto?: { nome: string; categoria: string | null } | null
}): AvaliacaoDoVideo & { arquivo: ChecagemDoArquivo } {
  const bloqueios: string[] = []
  const revisoes: string[] = []
  const avisos: string[] = []
  // P2.34 — leitura: caracteres por segundo de cada texto na tela (até 15 lê bem; acima de 20 fica difícil). É AVISO
  // (a titular vê na aprovação), não reprovação: o gerador ainda reparte o tempo em fatias iguais e reprovar aqui
  // derrubaria vídeos legítimos. Repartir o tempo pelo tamanho do texto é a próxima melhoria.
  for (const c of p.cenas) {
    const t = c.texto.replace(/\n/g, ' ').trim()
    const d = c.fim - c.inicio
    if (!t || d <= 0) continue
    const cps = t.length / d
    if (cps > 20) avisos.push(`Texto rápido demais para ler (${cps.toFixed(1)} caracteres/s): "${t.slice(0, 40)}".`)
    else if (cps > 15) avisos.push(`Leitura no limite (${cps.toFixed(1)} caracteres/s): "${t.slice(0, 40)}".`)
  }
  // P2.34 — sincronia: trocar de imagem no meio do gancho ou da chamada final atrapalha a leitura.
  if (p.trechos && p.trechos > 1 && p.duracaoPlanejada > 0) {
    const cortes = Array.from({ length: p.trechos - 1 }, (_, i) => ((i + 1) * p.duracaoPlanejada) / p.trechos!)
    const primeira = p.cenas[0]
    const ultima = p.cenas[p.cenas.length - 1]
    const corta = (c: CenaNaTela | undefined) => !!c && cortes.some((x) => x > c.inicio + 0.3 && x < c.fim - 0.3)
    if (corta(primeira)) avisos.push('A imagem troca no meio do gancho: com menos mídias (ou trechos de 3 s), o gancho fica sobre uma imagem só.')
    if (ultima && ultima !== primeira && corta(ultima)) avisos.push('A imagem troca no meio da chamada final.')
  }
  if (!p.reel.valido) bloqueios.push(...p.reel.problemas.map((x) => `Arquivo: ${x}`))
  const dur = p.reel.metadados?.duracaoS ?? null
  if (dur !== null && Math.abs(dur - p.duracaoPlanejada) > 1.5) revisoes.push(`Arquivo com ${dur.toFixed(1)} s; o roteiro pede ${p.duracaoPlanejada} s.`)
  if (!p.direito.publicavel) bloqueios.push(`Direito da mídia: ${p.direito.motivo}`)
  const textoQueimado = p.cenas.map((c) => c.texto.replace(/\n/g, ' ')).join(' ')
  const alegacoes = claimsNaoComprovados(textoQueimado)
  if (alegacoes.length) bloqueios.push(`Texto no vídeo com alegação não comprovada: ${alegacoes.join(', ')}.`)
  const incoerentes = textosIncoerentesComOProduto(textoQueimado, p.produto)
  if (incoerentes.length) revisoes.push(`Texto no vídeo incoerente com o produto (livro): ${incoerentes.join(', ')}.`)
  if (p.cenas.length < 3) revisoes.push('Vídeo com menos de 3 cenas de texto.')
  if (p.cenas.some((c) => c.texto.split('\n').length > 4)) revisoes.push('Cena com mais de 4 linhas (difícil de ler).')
  const doArquivo: VereditoDoVideo = bloqueios.length ? 'BLOQUEADO' : revisoes.length ? 'REVISAR' : 'APROVADO'
  const veredito = PIOR[doArquivo] > PIOR[p.roteiro.veredito] ? doArquivo : p.roteiro.veredito
  const motivos = [...p.roteiro.motivos, ...bloqueios, ...revisoes, ...avisos]
  const m = p.reel.metadados
  return {
    ...p.roteiro,
    veredito,
    riscoDeCompliance: bloqueios.length ? 'ALTO' : p.roteiro.riscoDeCompliance,
    motivos,
    resumo:
      veredito === 'APROVADO'
        ? `Vídeo final checado: ${m?.largura}×${m?.altura}, ${dur?.toFixed(1)} s, mídia autorizada, sem alegação. ${p.roteiro.resumo}`
        : `Vídeo final ${veredito}: ${[...bloqueios, ...revisoes].join(' ') || p.roteiro.resumo}`,
    arquivo: {
      valido: p.reel.valido, problemas: p.reel.problemas, duracaoS: dur, largura: m?.largura ?? null, altura: m?.altura ?? null,
      tamanhoBytes: p.reel.tamanhoBytes, direitoPublicavel: p.direito.publicavel, motivoDoDireito: p.direito.motivo,
    },
  }
}

// ── O vídeo da publicação assistida ─────────────────────────────────────

export const SITUACOES_DO_VIDEO = ['FALTA_MIDIA_AUTORIZADA', 'NA_FILA', 'GERANDO', 'GERADO', 'FALHOU'] as const
export type SituacaoDoVideo = (typeof SITUACOES_DO_VIDEO)[number]
export const MAXIMO_DE_TENTATIVAS_DE_RENDER = 2

export interface VideoDaApresentacao {
  arquivo: string | null
  /** P2.72: sha256 dos bytes gerados (a liberação confere o arquivo fixado contra ele). */
  sha256?: string | null
  situacao: SituacaoDoVideo
  explicacao: string
  midiaId?: string | null
  /** P2.18: todas as mídias usadas, na ordem em que aparecem no vídeo. */
  midiaIds?: string[]
  midiaTipo?: TipoDeMidia | null
  midiaOrigem?: OrigemDeMidia | null
  demonstracao?: boolean
  trabalhoId?: string | null
  tentativas?: number
  geradoEm?: string | null
  cenas?: CenaNaTela[]
  erro?: string | null
  /** Cadeia de direitos do MP4 (DERIVADO): vai para o Conteúdo, que a porta única confere. */
  evidencia?: unknown
  /** Última checagem de arquivo REPROVADA (diagnóstico; a aprovada vai no qualityGate). */
  checagemDoArquivo?: ChecagemDoArquivo | null
}

export const EXPLICACAO_SEM_MIDIA =
  'O roteiro está pronto. O vídeo é gerado sozinho assim que houver uma foto ou vídeo AUTORIZADO do produto (seu, licenciado ou gerado pelo Patrono). Foto ou vídeo do vendedor não serve: é mídia de terceiro.'

/** FUNÇÃO PURA. Estado da publicação a partir da situação do vídeo (antes da aprovação). */
export function estadoPeloVideo(situacao: SituacaoDoVideo, tentativas: number): string {
  if (situacao === 'GERADO') return 'AGUARDANDO_APROVACAO'
  if (situacao === 'FALTA_MIDIA_AUTORIZADA') return 'AGUARDANDO_MIDIA'
  if (situacao === 'GERANDO') return 'GERANDO_VIDEO'
  if (situacao === 'FALHOU') return tentativas >= MAXIMO_DE_TENTATIVAS_DE_RENDER ? 'VIDEO_FALHOU' : 'VIDEO_NA_FILA'
  return 'VIDEO_NA_FILA'
}

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

/** Para teste: troca o renderizador e o envio ao storage. */
export interface PortasDoRender {
  renderizar(p: { midia: { tipo: TipoDeMidia; url: string }; midias?: { tipo: TipoDeMidia; url: string }[]; cenas: CenaNaTela[]; duracaoSegundos: number }): Promise<{ caminhoLocal: string; durationSeconds: number }>
  subir(buffer: Buffer, caminho: string): Promise<string>
}

const PORTAS_DE_FABRICA: PortasDoRender = {
  async renderizar(p) {
    const { RendererFFmpeg } = await import('./renderer-ffmpeg')
    return new RendererFFmpeg().renderCenasTikTok(p)
  },
  async subir(buffer, caminho) {
    const { data, error } = await supabaseAdmin.storage.from('videos').upload(caminho, buffer, { upsert: true, contentType: 'video/mp4' })
    if (error) throw new Error(`Não consegui guardar o vídeo no storage: ${error.message}`)
    return supabaseAdmin.storage.from('videos').getPublicUrl(data.path).data.publicUrl
  },
}
let PORTAS_REAIS: PortasDoRender = PORTAS_DE_FABRICA

/** Só para teste: troca o renderizador/storage em TODO o fluxo (null = volta ao real). */
export function definirPortasDoRender(portas: PortasDoRender | null) {
  PORTAS_REAIS = portas ?? PORTAS_DE_FABRICA
}

interface ApresentacaoMinima {
  produto: { nome: string; tiktokShop: boolean; categoria?: string | null }
  versao: VersaoParaCenas & { varianteId: string }
  video: VideoDaApresentacao
}

type EntradaDoVideo = { acao: string; detalhe: string; veredito?: string }

async function gravarVideo(id: string, video: VideoDaApresentacao, extra: Prisma.PublicacaoAssistidaUpdateInput = {}, historico: EntradaDoVideo | EntradaDoVideo[] = [], trabalhoQueGrava?: string) {
  const a = await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id } })
  // P2.50 (A4): o RESULTADO de um render só grava se a publicação ainda está GERANDO_VIDEO por ESTE trabalho. Um render
  // antigo (reclamado e refeito) que termina tarde não sobrescreve vídeo/estado de quem já foi aprovado ou publicado.
  if (trabalhoQueGrava) {
    const atual = (a.apresentacao as { video?: { trabalhoId?: string | null } } | null)?.video?.trabalhoId ?? null
    if (a.estado !== 'GERANDO_VIDEO' || atual !== trabalhoQueGrava) return a
    const hist0 = Array.isArray(a.historico) ? [...(a.historico as unknown[])] : []
    for (const h of Array.isArray(historico) ? historico : [historico]) hist0.push({ em: new Date().toISOString(), versao: a.versao, ...h })
    const ap0 = a.apresentacao as unknown as ApresentacaoMinima
    const n = await prisma.publicacaoAssistida.updateMany({ where: { id, estado: 'GERANDO_VIDEO' }, data: { ...(extra as Prisma.PublicacaoAssistidaUpdateManyMutationInput), apresentacao: { ...ap0, video } as unknown as Prisma.InputJsonValue, historico: hist0 as Prisma.InputJsonValue } })
    return n.count ? prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id } }) : a
  }
  const ap = a.apresentacao as unknown as ApresentacaoMinima
  const hist = Array.isArray(a.historico) ? [...(a.historico as unknown[])] : []
  for (const h of Array.isArray(historico) ? historico : [historico]) hist.push({ em: new Date().toISOString(), versao: a.versao, ...h })
  return prisma.publicacaoAssistida.update({
    where: { id },
    data: { ...extra, apresentacao: { ...ap, video } as unknown as Prisma.InputJsonValue, historico: hist as Prisma.InputJsonValue },
  })
}

/**
 * Executor do trabalho longo LONGO_RENDER_VIDEO. Renderiza, confere o
 * arquivo (Quality Gate do vídeo final + cadeia de direitos), sobe para o
 * storage do projeto e só então põe a publicação em AGUARDANDO_APROVACAO.
 * Reprovado: volta à fila (até 2 tentativas) — nunca chega à titular.
 */
export function executorDoRenderAssistido(portasFixas?: PortasDoRender, env: Record<string, string | undefined> = process.env): ExecutorDeTrabalho {
  return async ({ trabalho }): Promise<Desfecho> => {
    const portas = portasFixas ?? PORTAS_REAIS
    const id = trabalho.entityId
    const a = await prisma.publicacaoAssistida.findFirst({ where: { id, workspaceId: trabalho.workspaceId } })
    if (!a) return { fim: 'falhou', erro: 'Publicação não encontrada.', resposta: { status: 404, corpo: { error: 'Publicação não encontrada.' } } }
    const ap = a.apresentacao as unknown as ApresentacaoMinima
    if (!['VIDEO_NA_FILA', 'GERANDO_VIDEO'].includes(a.estado)) {
      return { fim: 'concluido', resposta: { status: 200, corpo: { ok: true, estado: a.estado, mensagem: 'Nada a gerar neste estado.' } } }
    }
    const midiaId = trabalho.contexto.midiaId as string
    const autorizadas = await midiasAutorizadas({ workspaceId: a.workspaceId, produtoId: a.produtoId, candidatoId: a.candidatoId, env })
    const midia = autorizadas.find((m) => m.id === midiaId)
    const tentativas = (ap.video.tentativas ?? 0) + 1
    if (!midia) {
      await gravarVideo(id, { ...ap.video, arquivo: null, situacao: 'FALTA_MIDIA_AUTORIZADA', explicacao: EXPLICACAO_SEM_MIDIA }, { estado: 'AGUARDANDO_MIDIA' })
      return { fim: 'concluido', resposta: { status: 200, corpo: { ok: false, mensagem: 'A mídia deixou de estar autorizada.' } } }
    }
    // P2.18: todas as fotos/vídeos AUTORIZADOS do produto entram (a escolhida pelo
    // formato abre o vídeo). Com qualquer FOTO no meio, vale a régua da foto:
    // nenhuma tela afirma movimento/uso que a foto não mostra.
    const usadas = sequenciaDeMidias(midia, autorizadas, ap.versao.duracaoSegundos)
    const tipoParaTexto: TipoDeMidia = usadas.every((m) => m.tipo === 'VIDEO') ? 'VIDEO' : 'IMAGEM'
    const cenas = cenasDoVideo(ap.versao, ap.produto.nome, tipoParaTexto)
    await gravarVideo(id, { ...ap.video, situacao: 'GERANDO', tentativas, cenas, trabalhoId: trabalho.id }, { estado: 'GERANDO_VIDEO' })

    let caminho: string | null = null
    try {
      // P2.35: mídia em armazenamento PRIVADO → o render baixa por link assinado curto (só aqui, no servidor) e
      // o vídeo gerado também fica PRIVADO (prévia antes da aprovação). Mídia pública antiga: como sempre.
      const { urlParaUsoInterno, ehRefPrivada, guardarPreviaPrivada } = await import('./midia-privada')
      const privado = usadas.some((m) => ehRefPrivada(m.url, env))
      const paraRender = async (u: string) => urlParaUsoInterno(u, env)
      const r = await portas.renderizar({ midia: { tipo: midia.tipo, url: await paraRender(midia.url) }, midias: await Promise.all(usadas.map(async (m) => ({ tipo: m.tipo, url: await paraRender(m.url) }))), cenas, duracaoSegundos: ap.versao.duracaoSegundos })
      caminho = r.caminhoLocal
      const buffer = await readFile(caminho)
      const reel = validarReel(buffer)
      // P2.72: hash REAL dos bytes gerados — a liberação confere o arquivo que vai ao ar contra ESTE (TOCTOU)
      const sha256 = (await import('node:crypto')).createHash('sha256').update(buffer).digest('hex')
      const url = privado
        ? await guardarPreviaPrivada(buffer, { workspaceId: a.workspaceId, publicacaoId: a.id, versao: a.versao }, env)
        : await portas.subir(buffer, `assistidas/${a.workspaceId}/${a.id}-v${a.versao}-${Date.now()}.mp4`)
      const derivacao = registrarDerivacao({
        assetUrl: url,
        formato: 'VIDEO_9X16_ASSISTIDO',
        geracaoId: trabalho.id,
        fontes: [
          ...usadas.map((m) => ({ papel: m.tipo === 'VIDEO' ? 'VIDEO_DO_PRODUTO' : 'IMAGEM_DO_PRODUTO', assetUrl: m.url, evidencia: m.evidencia })),
          { papel: 'TEXTO_DO_ROTEIRO', assetUrl: 'patrono:texto-do-roteiro', evidencia: { ...midia.evidencia, origem: 'GERADO_PELO_PATRONO', assetUrl: 'patrono:texto-do-roteiro', geracaoId: trabalho.id, descricao: 'Texto do roteiro aprovado pela checagem.' } },
        ],
        agora: new Date(),
        env,
      })
      const qgBase = qualityGateDoVideoFinal({
        roteiro: a.qualityGate as unknown as AvaliacaoDoVideo,
        reel,
        duracaoPlanejada: ap.versao.duracaoSegundos,
        direito: { publicavel: derivacao.publicavel, motivo: derivacao.motivo },
        cenas,
        trechos: usadas.length,
        produto: { nome: ap.produto.nome, categoria: ap.produto.categoria ?? null },
      })
      const qg = { ...qgBase, arquivo: { ...qgBase.arquivo, sha256 } }
      if (qg.veredito !== 'APROVADO') {
        const situacao: SituacaoDoVideo = 'FALHOU'
        await gravarVideo(
          id,
          // A checagem do roteiro (qualityGate) NÃO é trocada pela do arquivo reprovado:
          // a próxima tentativa parte do roteiro aprovado, não de um REVISAR herdado.
          { ...ap.video, arquivo: null, situacao, tentativas, cenas, erro: qg.resumo, checagemDoArquivo: qg.arquivo, explicacao: 'O vídeo gerado não passou na checagem do arquivo; o Patrono corrige antes de te mostrar.' },
          { estado: estadoPeloVideo(situacao, tentativas) },
          { acao: 'QUALITY_GATE', detalhe: qg.resumo, veredito: qg.veredito },
          trabalho.id
        )
        return { fim: 'concluido', resposta: { status: 200, corpo: { ok: false, veredito: qg.veredito, mensagem: qg.resumo } } }
      }
      for (const m of usadas) await marcarUso(m.id)
      await gravarVideo(
        id,
        {
          arquivo: url, sha256, situacao: 'GERADO', explicacao: 'Vídeo gerado com mídia autorizada e conferido pela checagem de qualidade.',
          midiaId: midia.id, midiaIds: usadas.map((m) => m.id), midiaTipo: midia.tipo, midiaOrigem: midia.origem, demonstracao: midia.demonstracao,
          trabalhoId: trabalho.id, tentativas, geradoEm: new Date().toISOString(), cenas, erro: null, evidencia: derivacao.evidencia,
        },
        { estado: 'AGUARDANDO_APROVACAO', qualityGate: qg as unknown as Prisma.InputJsonValue, bloqueio: null, erro: null },
        [
          { acao: 'QUALITY_GATE', detalhe: qg.resumo, veredito: qg.veredito },
          { acao: 'APRESENTADO', detalhe: `${ap.versao.varianteId} · vídeo gerado (${qg.arquivo.duracaoS?.toFixed(1)} s)` },
        ],
        trabalho.id
      )
      if (!a.demonstracao) {
        await registrarEvento({ workspaceId: a.workspaceId, tipo: 'APPROVAL_REQUIRED', chaveIdempotencia: `assistida:${a.id}:v${a.versao}:aprovacao`, entidadeTipo: 'PublicacaoAssistida', entidadeId: a.id, payload: { produto: a.nomeProduto, video: true } })
      }
      return { fim: 'concluido', resposta: { status: 200, corpo: { ok: true, arquivo: url, veredito: qg.veredito, evidencia: derivacao.evidencia } } }
    } catch (e) {
      // P2.35: o erro vai para o histórico e para o trabalho: nunca com o token de um link assinado.
      const { semSegredosDeLink } = await import('./midia-privada')
      const erro = semSegredosDeLink((e as Error).message).slice(0, 300)
      const situacao: SituacaoDoVideo = 'FALHOU'
      await gravarVideo(id, { ...ap.video, arquivo: null, situacao, tentativas, cenas, erro, explicacao: 'A geração do vídeo falhou; o Patrono tenta de novo sozinho.' }, { estado: estadoPeloVideo(situacao, tentativas) }, { acao: 'VIDEO_FALHOU', detalhe: `render: ${erro}` }, trabalho.id)
      // Render é local e gratuito: repetir é seguro (nada foi publicado nem cobrado).
      return { fim: 'concluido', resposta: { status: 200, corpo: { ok: false, mensagem: erro } } }
    } finally {
      if (caminho) await unlink(caminho).catch(() => null)
    }
  }
}

/**
 * FUNÇÃO PURA. As mídias do vídeo, em ordem: a escolhida pelo formato abre;
 * depois as outras autorizadas do produto (vídeos primeiro, depois as mais recentes).
 * Até 10, e no máximo uma a cada 2 s (trecho legível).
 */
export function sequenciaDeMidias<T extends { id: string }>(principal: T, autorizadas: T[], duracaoSegundos: number): T[] {
  const limite = Math.max(1, Math.min(10, Math.floor(Math.max(1, duracaoSegundos) / 2)))
  return [principal, ...autorizadas.filter((m) => m.id !== principal.id)].slice(0, limite)
}

/**
 * Põe o vídeo para gerar (trabalho longo). Idempotente por (publicação,
 * versão, mídia, tentativa): clicar/recarregar não gera duas vezes.
 */
export async function gerarVideoDaAssistida(p: { workspaceId: string; id: string; origem?: string; portas?: PortasDoRender; env?: Record<string, string | undefined> }) {
  const a = await prisma.publicacaoAssistida.findFirst({ where: { id: p.id, workspaceId: p.workspaceId } })
  if (!a || a.estado !== 'VIDEO_NA_FILA') return a
  const ap = a.apresentacao as unknown as ApresentacaoMinima
  const midiaId = ap.video.midiaId
  if (!midiaId) return a
  const tentativa = (ap.video.tentativas ?? 0) + 1
  const r = await iniciarTrabalhoLongo({
    workspaceId: a.workspaceId,
    tipo: 'LONGO_RENDER_VIDEO',
    chave: `render:${a.id}:v${a.versao}:${midiaId}:t${tentativa}`,
    entityType: 'PUBLICACAO_ASSISTIDA',
    entityId: a.id,
    contexto: { midiaId },
    executor: executorDoRenderAssistido(p.portas, p.env),
    origem: p.origem ?? process.env.NEXTAUTH_URL ?? '',
    mensagemDeProcessando: 'Gerando o vídeo.',
    orcamentoMs: 120_000,
  })
  // O executor grava o próprio progresso (trabalhoId, tentativas, situação):
  // nada de regravar aqui uma cópia antiga da apresentação por cima.
  void r
  return prisma.publicacaoAssistida.findUnique({ where: { id: a.id } })
}

/**
 * A mídia da publicação: a melhor AUTORIZADA para o formato escolhido.
 * Devolve a situação inicial do vídeo (NA_FILA com a mídia, ou falta mídia).
 */
export function videoInicial(estrutura: string, midias: MidiaUtilizavel[]): VideoDaApresentacao {
  const pol = politicaDoFormato(estrutura, midias)
  if (!pol.automatico) return { arquivo: null, situacao: 'FALTA_MIDIA_AUTORIZADA', explicacao: EXPLICACAO_SEM_MIDIA, tentativas: 0 }
  const m = midias.find((x) => x.tipo === pol.midia.tipo && x.origem === pol.midia.origem) ?? midias[0]
  return { arquivo: null, situacao: 'NA_FILA', explicacao: 'Mídia autorizada encontrada: o vídeo está na fila para ser gerado.', midiaId: m.id, midiaTipo: m.tipo, midiaOrigem: m.origem, demonstracao: m.demonstracao, tentativas: 0 }
}
