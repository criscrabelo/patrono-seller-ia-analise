/**
 * P2.17.10 — MODO ASSISTIDO: as 10 primeiras publicações reais.
 *
 *   o Patrono escolhe → gera → Quality Gate → apresenta → a titular APROVA,
 *   pede AJUSTE ou REJEITA → o Patrono publica pela porta única oficial
 *   (lib/distribuicao-orquestrador.ts) → acompanha → registra o resultado.
 *
 * Regras:
 *  - nenhuma publicação antes da aprovação (estado AGUARDANDO_APROVACAO);
 *  - Quality Gate em toda versão: BLOQUEADO não segue; REVISAR volta para correção;
 *  - ajuste/rejeição: o Patrono corrige e reapresenta (nova versão/variação);
 *  - o contador só conta publicação CONFIRMADA (id do vídeo);
 *  - em 10/10 sai só a RECOMENDAÇÃO (MANTER ASSISTIDO / APTO PARA AUTOMAÇÃO):
 *    nada muda na política sem a autorização explícita da titular;
 *  - o que o TikTok não permite fica marcado "BLOQUEADO PELO TIKTOK — falta X".
 */
import { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { log } from './observabilidade'
import { registrarAuditoria } from './audit-log'
import { registrarEvento } from './ledger'
import { confirmarCota, liberarCota, reservarCota } from './cotas-da-plataforma'
import { tipoDaPublicacao } from './permissao-da-acao'
import { dnaDaAssistida } from './dna-criativo'
import { pontuarVariante, type OrientacaoCriativa } from './aprendizado-criativo'
import { classificarGancho } from './ml-hook-classifier'
import { analisarMetas, listarMetasAtivas, missoesQueOVideoAjuda, priorizarProdutosTikTok } from './metas-tiktok'
import { planejarVideos, EXIGE_EXPERIENCIA, type Etapa, type VarianteDeVideo } from './motor-de-videos-tiktok'
import { avaliarVideo, roteiroComoTexto, type AvaliacaoDoVideo, type VideoParaAvaliar } from './quality-gate-video-tiktok'
import { ehProdutoTikTokShop } from './tiktok-shop-link'
import { campanhaDoCandidato } from './curadoria-http'
import { dadosDoProdutoACriar } from './curadoria'
import { distribuirConteudo, PUBLICACOES_ASSISTIDAS, higienizar } from './distribuicao-orquestrador'
import { adaptadoresHabilitados } from './adaptadores-reais'
import { estadoDoCanalTikTok, PRODUTO_MARCADO_POR_API } from './tiktok-estado-canal'
import { acompanharPublicacoesTikTok } from './tiktok-acompanhamento'
import { statusDosProdutos } from './resultados-videos'
import { agregar } from './metricas-economicas'
import { faixaDeHorario } from './aprendizado-videos-tiktok'
import { confirmarDistribuicao } from './publicacao-fluxo'
import { midiasAutorizadas } from './midia-do-produto'
import { aprendizadoCriativoDoWorkspace } from './resultados-videos'
import { candidatosComAmostraRecebida, ligarPublicacaoNaAmostra } from './amostras'
import { kitDaChave } from './kits-de-amostras'
import { coletarMetricasOficiais, configuracaoDoColetor } from './coletor-de-metricas-tiktok'
import { chavesDoCandidato } from './observacoes-de-mercado'
import {
  politicaDoFormato, formatoServeComFoto, ordemDasVariantes, videoInicial, estadoPeloVideo, gerarVideoDaAssistida, cenasParaGravarGenericas, MAXIMO_DE_TENTATIVAS_DE_RENDER,
  type VideoDaApresentacao, type MidiaParaPolitica,
} from './video-assistido'
import { CANDIDATO_NAO_EXCLUIDO, encerradaPorProdutoInativo } from './produto-canonico'
import { HEARTBEAT_VENCIDO_MS } from './trabalho-longo'
import { revalidarDadosComerciais, revisarVersao, retratoComercial } from './dados-comerciais'

export const LIMITE_ASSISTIDO = PUBLICACOES_ASSISTIDAS
export const ESTADOS_ASSISTIDOS = [
  'GERANDO', 'PRONTO',
  // P2.17.12: o vídeo antes da aprovação. Só há aprovação com o MP4 gerado.
  'AGUARDANDO_MIDIA', 'VIDEO_NA_FILA', 'GERANDO_VIDEO', 'VIDEO_FALHOU',
  'AGUARDANDO_APROVACAO', 'APROVADO', 'PUBLICANDO', 'PUBLICADO', 'FALHOU', 'REJEITADO', 'AJUSTE_PEDIDO',
] as const
export type EstadoAssistido = (typeof ESTADOS_ASSISTIDOS)[number]
/** VIDEO_FALHOU (após as tentativas) sai do andamento: o Patrono segue para outro produto/variação. */
const EM_ANDAMENTO: EstadoAssistido[] = ['GERANDO', 'PRONTO', 'AGUARDANDO_MIDIA', 'VIDEO_NA_FILA', 'GERANDO_VIDEO', 'AGUARDANDO_APROVACAO', 'APROVADO', 'PUBLICANDO', 'AJUSTE_PEDIDO']
/** Antes da aprovação a titular pode rejeitar (inclusive "não tenho mídia deste produto"). */
const REJEITAVEIS: EstadoAssistido[] = ['AGUARDANDO_APROVACAO', 'AGUARDANDO_MIDIA', 'VIDEO_FALHOU']

export class ErroAssistido extends Error {
  constructor(public readonly status: 400 | 403 | 404 | 409, mensagem: string) {
    super(mensagem)
  }
}

/** A versão de vídeo que a titular vê (e aprova). */
export interface VersaoDoVideo {
  varianteId: string
  estrutura: string
  objetivo: string
  gancho: string
  roteiro: Etapa[]
  cta: string
  legenda: string
  hashtags: string[]
  disclosure: string
  duracaoSegundos: number
  produtoMarcado: string
  exigeExperienciaReal: boolean
}

export interface Alteracoes {
  gancho?: string
  legenda?: string
  hashtags?: string[]
  cta?: string
  horarioPlanejado?: string | null
}

/** FUNÇÃO PURA. A versão no formato da checagem — o MESMO que `videoDoConteudo` reconstrói. */
export function paraAvaliar(v: VersaoDoVideo): VideoParaAvaliar {
  return {
    gancho: v.gancho,
    roteiro: [{ etapa: 'Gancho (0–3 s)', texto: v.gancho, textoNaTela: v.gancho.length <= 40 ? v.gancho : null }, ...v.roteiro],
    cta: v.cta,
    legenda: v.legenda,
    hashtags: v.hashtags,
    duracaoSegundos: v.duracaoSegundos,
    exigeExperienciaReal: v.exigeExperienciaReal,
    objetivo: v.objetivo,
  }
}

export function versaoDaVariante(v: VarianteDeVideo): VersaoDoVideo {
  return {
    varianteId: v.id, estrutura: v.estrutura, objetivo: v.objetivo, gancho: v.gancho, roteiro: v.roteiro, cta: v.cta, legenda: v.legenda, hashtags: v.hashtags,
    disclosure: v.disclosure, duracaoSegundos: v.duracaoSegundos, produtoMarcado: v.produtoMarcado, exigeExperienciaReal: v.exigeExperienciaReal,
  }
}

/** FUNÇÃO PURA. Aplica as alterações da titular (a legenda refaz o gancho na 1ª linha só se ela mesma mudar). */
export function aplicarAlteracoes(v: VersaoDoVideo, a: Alteracoes | undefined): VersaoDoVideo {
  if (!a) return v
  return {
    ...v,
    gancho: a.gancho?.trim() || v.gancho,
    legenda: a.legenda?.trim() || v.legenda,
    hashtags: a.hashtags?.length ? a.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)) : v.hashtags,
    cta: a.cta?.trim() || v.cta,
  }
}

const temAlteracao = (a: Alteracoes | undefined) => !!a && Object.values(a).some((x) => (Array.isArray(x) ? x.length > 0 : x !== undefined && x !== null && x !== ''))

function checar(v: VersaoDoVideo, tiktokShop: boolean, produto?: { nome: string; categoria: string | null } | null): AvaliacaoDoVideo {
  return avaliarVideo(paraAvaliar(v), { tiktokShop, produto: produto ?? null })
}

const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

interface EntradaDoHistorico {
  em: string
  versao: number
  acao: 'APRESENTADO' | 'AJUSTE_PEDIDO' | 'REJEITADO' | 'APROVADO' | 'QUALITY_GATE' | 'PUBLICACAO' | 'PUBLICADO' | 'FALHOU' | 'DADOS_COMERCIAIS_DESATUALIZADOS' | 'LEGENDA_CORRIGIDA_PRECO'
  detalhe?: string
  alteracoes?: Alteracoes
  veredito?: string
  /** P2.50: sha256 do vídeo que foi aprovado (a aprovação fica presa ao arquivo visto). */
  sha256?: string
  /** Retrato comercial confirmado no momento (o preço da época fica no histórico). */
  comercial?: unknown
}

const historicoDe = (x: Prisma.JsonValue): EntradaDoHistorico[] => (Array.isArray(x) ? (x as unknown as EntradaDoHistorico[]) : [])

/** Horário sugerido: hipótese declarada (sem dado de audiência ainda) — próxima hora cheia + 1 h. */
export function horarioSugerido(agora: Date): Date {
  const d = new Date(agora.getTime() + 60 * 60 * 1000)
  d.setUTCMinutes(0, 0, 0)
  return new Date(d.getTime() + 60 * 60 * 1000)
}

// ── Status VERDADEIRO (P2.17.11) ────────────────────────────────────────

/**
 * FUNÇÃO PURA. O que de fato existe, em ordem — nunca "vídeo pronto" sem
 * arquivo de vídeo gerado.
 *   ROTEIRO PRONTO → VÍDEO EM GERAÇÃO / VÍDEO GERADO (ou SEM ARQUIVO DE VÍDEO)
 *   → QUALITY GATE APROVADO → AGUARDANDO APROVAÇÃO → APROVADO → ENVIANDO
 *   → PUBLICANDO → PUBLICADO
 */
export function statusReal(a: { estado: string; apresentacao: unknown; qualityGate: unknown; publishId?: string | null }): {
  etapas: string[]
  principal: string
  videoGerado: boolean
} {
  const ap = (a.apresentacao ?? {}) as { video?: { arquivo?: string | null; situacao?: string } }
  const videoGerado = !!ap.video?.arquivo
  const etapas: string[] = []
  if (a.estado === 'GERANDO') return { etapas: ['ROTEIRO EM GERAÇÃO'], principal: 'ROTEIRO EM GERAÇÃO', videoGerado }
  etapas.push('ROTEIRO PRONTO')
  const DO_VIDEO: Record<string, string> = {
    FALTA_MIDIA_AUTORIZADA: 'AGUARDANDO MÍDIA AUTORIZADA',
    NA_FILA: 'VÍDEO NA FILA',
    GERANDO: 'VÍDEO EM GERAÇÃO',
    FALHOU: 'GERAÇÃO DO VÍDEO FALHOU',
  }
  etapas.push(videoGerado ? 'VÍDEO GERADO' : DO_VIDEO[ap.video?.situacao ?? ''] ?? 'SEM ARQUIVO DE VÍDEO')
  // O selo do Quality Gate só vale com o arquivo: antes dele, a checagem é só do roteiro.
  if (videoGerado && (a.qualityGate as { veredito?: string } | null)?.veredito === 'APROVADO') etapas.push('QUALITY GATE APROVADO')
  const porEstado: Record<string, string> = {
    AGUARDANDO_APROVACAO: videoGerado ? 'AGUARDANDO SUA APROVAÇÃO' : 'AGUARDANDO APROVAÇÃO',
    AJUSTE_PEDIDO: 'AJUSTE PEDIDO',
    APROVADO: 'APROVADO',
    PUBLICANDO: a.publishId ? 'PUBLICANDO' : 'ENVIANDO',
    PUBLICADO: 'PUBLICADO',
    FALHOU: 'FALHOU',
    REJEITADO: 'REJEITADO',
  }
  if (porEstado[a.estado]) etapas.push(porEstado[a.estado])
  // A frase principal deixa claro o que falta: roteiro pronto ≠ vídeo pronto.
  const principal = videoGerado ? etapas.join(' · ') : `${etapas.filter((e) => e !== 'SEM ARQUIVO DE VÍDEO').join(' · ')} (vídeo ainda não gerado)`
  return { etapas, principal, videoGerado }
}

/** FUNÇÃO PURA. A publicação tem o MP4? (só então existe "aprovar"). */
export function temVideoGerado(a: { apresentacao: unknown }): boolean {
  return !!((a.apresentacao ?? {}) as { video?: { arquivo?: string | null } }).video?.arquivo
}


// ── Escolher → gerar → checar → apresentar ─────────────────────────────

/**
 * P2.17.12 — Uma publicação que chegou a AGUARDANDO_APROVACAO sem o MP4
 * (versões anteriores) é aprovação PREMATURA: volta para o fluxo do vídeo.
 * Se o formato dela não é automático (ex.: DEMONSTRACAO sem vídeo seu), o
 * Patrono troca para a melhor variação automática do mesmo produto.
 */
async function retirarAprovacaoPrematura(a: Awaited<ReturnType<typeof lerAssistida>>, agora: Date) {
  if (a.estado !== 'AGUARDANDO_APROVACAO' || temVideoGerado(a)) return a
  const ap = a.apresentacao as unknown as { produto: { nome: string; categoria: string | null; preco: number | null; tiktokShop: boolean }; versao: VersaoDoVideo; textoNaTela?: string[] }
  const midias = await midiasAutorizadas({ workspaceId: a.workspaceId, produtoId: a.produtoId, candidatoId: a.candidatoId })
  let versao = ap.versao
  let qg = a.qualityGate as unknown as AvaliacaoDoVideo
  const serve = politicaDoFormato(versao.estrutura, midias).automatico || (midias.length === 0 && formatoServeComFoto(versao.estrutura))
  if (!serve) {
    const plano = planejarVideos({ nome: ap.produto.nome, categoria: ap.produto.categoria, preco: ap.produto.preco, tiktokShop: ap.produto.tiktokShop }, agora)
    const ordem = [...plano.testeInicial.variantes, ...plano.variantes.map((v) => v.id)]
    const escolha = escolherVariante(plano.variantes, ordem, new Set(), null, midias, ap.produto.tiktokShop, null, ap.produto)
    if (escolha) {
      versao = escolha.versao
      qg = escolha.qg
    }
  }
  const video = videoInicial(versao.estrutura, midias)
  const historico = historicoDe(a.historico)
  const troca = versao.estrutura !== ap.versao.estrutura ? ` Formato trocado de ${ap.versao.estrutura} para ${versao.estrutura} (gerável com a mídia disponível).` : ''
  historico.push({ em: agora.toISOString(), versao: a.versao, acao: 'QUALITY_GATE', veredito: qg.veredito, detalhe: `Aprovação retirada: não havia arquivo de vídeo.${troca}` })
  return prisma.publicacaoAssistida.update({
    where: { id: a.id },
    data: {
      estado: estadoPeloVideo(video.situacao, 0),
      varianteId: versao.varianteId,
      estrutura: versao.estrutura,
      apresentacao: { ...ap, versao, video, textoNaTela: textoNaTelaDe(versao) } as unknown as Prisma.InputJsonValue,
      qualityGate: qg as unknown as Prisma.InputJsonValue,
      historico: historico as unknown as Prisma.InputJsonValue,
    },
  })
}

const textoNaTelaDe = (v: VersaoDoVideo) => [v.gancho.length <= 40 ? v.gancho : null, ...v.roteiro.map((r) => r.textoNaTela)].filter((t): t is string => !!t)

/**
 * FUNÇÃO PURA (sem banco). A variação a usar: primeiro uma que o Patrono
 * gera SOZINHO com as mídias autorizadas; sem mídia, a melhor que serve com
 * UMA foto (é o mínimo a pedir). Formatos de experiência pessoal e de
 * comparação sem dado real nunca entram. Sempre aprovada na checagem.
 */
export function escolherVariante(
  variantes: VarianteDeVideo[],
  ordemDoPlano: string[],
  usadas: Set<string>,
  vencedor: string | null,
  midias: MidiaParaPolitica[],
  tiktokShop: boolean,
  orientacao: OrientacaoCriativa | null = null,
  produto: { nome: string; categoria: string | null } | null = null
): { versao: VersaoDoVideo; qg: AvaliacaoDoVideo; automatico: boolean; aplicado: string[] } | null {
  const variante = (id: string) => variantes.find((v) => v.id === id)
  const pontuar = orientacao ? (id: string) => { const v = variante(id); return v ? pontuarVariante(orientacao, { estrutura: v.estrutura, tipoDeGancho: classificarGancho(v.gancho).tipo }) : 0 } : undefined
  const ordem = ordemDasVariantes([...new Set(ordemDoPlano)], (id) => variante(id)?.estrutura ?? '', usadas, vencedor, pontuar)
  const tentar = (aceita: (estrutura: string) => boolean) => {
    for (const id of ordem) {
      const v = variante(id)
      if (!v || v.exigeExperienciaReal || !aceita(v.estrutura)) continue
      const base = versaoDaVariante(v)
      // P2.21: CTA e duração orientados pelo aprendizado; se a versão ajustada não passar na checagem, vale a original.
      const ajuste = aplicarOrientacao(base, v, orientacao)
      const opcoes = ajuste.aplicado.length ? [ajuste, { versao: base, aplicado: [] as string[] }] : [ajuste]
      for (const op of opcoes) {
        const qg = checar(op.versao, tiktokShop, produto)
        if (qg.veredito === 'APROVADO') return { versao: op.versao, qg, aplicado: [...(pontuar && pontuar(id) > 0 ? ['ordem das variantes'] : []), ...op.aplicado] }
      }
    }
    return null
  }
  const auto = midias.length ? tentar((e) => politicaDoFormato(e, midias).automatico) : null
  if (auto) return { ...auto, automatico: true }
  const comFoto = tentar(formatoServeComFoto)
  return comFoto ? { ...comFoto, automatico: false } : null
}

/** FUNÇÃO PURA. Aplica CTA/duração da orientação (que só vem de PADRAO_PROVAVEL ou mais). */
export function aplicarOrientacao(versao: VersaoDoVideo, v: VarianteDeVideo, o: OrientacaoCriativa | null): { versao: VersaoDoVideo; aplicado: string[] } {
  if (!o) return { versao, aplicado: [] }
  let x = versao
  const aplicado: string[] = []
  if (o.cta === 'B' && x.cta !== v.ctaB) { x = { ...x, cta: v.ctaB, legenda: v.legendaB }; aplicado.push('CTA B') }
  if (o.cta === 'A' && x.cta !== v.cta) { x = { ...x, cta: v.cta, legenda: v.legenda }; aplicado.push('CTA A') }
  if (o.duracao === 'CURTA' && x.duracaoSegundos > v.versaoCurta.segundos) { x = { ...x, duracaoSegundos: v.versaoCurta.segundos, roteiro: v.versaoCurta.roteiro.slice(1, -1) }; aplicado.push('versão curta') }
  if (o.duracao === 'MEDIA' && x.duracaoSegundos < v.versaoMedia.segundos) { x = { ...x, duracaoSegundos: v.versaoMedia.segundos, roteiro: v.versaoMedia.roteiro.slice(1, -1) }; aplicado.push('versão média') }
  return { versao: x, aplicado }
}

/**
 * Leva o vídeo da publicação em andamento adiante, sozinho:
 * AGUARDANDO_MIDIA + mídia autorizada nova → VIDEO_NA_FILA;
 * VIDEO_NA_FILA → gera (trabalho longo).
 */
export async function avancarVideo(a: Awaited<ReturnType<typeof lerAssistida>>, origem?: string) {
  let atual = a
  if (atual.estado === 'AGUARDANDO_MIDIA') {
    const midias = await midiasAutorizadas({ workspaceId: atual.workspaceId, produtoId: atual.produtoId, candidatoId: atual.candidatoId })
    const video = videoInicial(atual.estrutura, midias)
    if (video.situacao === 'NA_FILA') {
      const ap = atual.apresentacao as unknown as { video: VideoDaApresentacao }
      atual = await prisma.publicacaoAssistida.update({ where: { id: atual.id }, data: { estado: 'VIDEO_NA_FILA', apresentacao: { ...ap, video } as unknown as Prisma.InputJsonValue } })
    }
  }
  if (atual.estado === 'GERANDO_VIDEO') atual = await recuperarRenderInterrompido(atual)
  if (atual.estado === 'VIDEO_NA_FILA') return (await gerarVideoDaAssistida({ workspaceId: atual.workspaceId, id: atual.id, origem })) ?? atual
  return atual
}

/**
 * P2.27 — O render morreu no meio (OOM do FFmpeg, timeout, função encerrada) e a publicação ficou em
 * GERANDO_VIDEO para sempre, travando a fila (uma por vez). Se o trabalho do render não está vivo
 * (PENDING, ou RUNNING com heartbeat em dia), volta para a fila — repetir o render é seguro, nada sai daqui —
 * ou, depois das tentativas, para VIDEO_FALHOU (o Patrono segue para outro produto). Escrita condicionada
 * ao estado e ao updatedAt: duas abas não fazem a recuperação duas vezes.
 */
export async function recuperarRenderInterrompido(a: Awaited<ReturnType<typeof lerAssistida>>, agora: Date = new Date()) {
  const ap = a.apresentacao as unknown as { video?: VideoDaApresentacao & { trabalhoId?: string } }
  const trabalhoId = ap.video?.trabalhoId ?? null
  const job = trabalhoId ? await prisma.automationJob.findFirst({ where: { id: trabalhoId, workspaceId: a.workspaceId }, select: { estado: true, heartbeatAt: true, updatedAt: true } }) : null
  const recente = (d: Date | null | undefined) => !!d && agora.getTime() - d.getTime() <= HEARTBEAT_VENCIDO_MS
  const vivo = !!job && ((job.estado === 'PENDING' && recente(job.updatedAt)) || (job.estado === 'RUNNING' && recente(job.heartbeatAt)))
  if (vivo || (!job && recente(a.updatedAt))) return a
  const tentativas = ap.video?.tentativas ?? 0
  const destino = tentativas >= MAXIMO_DE_TENTATIVAS_DE_RENDER ? 'VIDEO_FALHOU' : 'VIDEO_NA_FILA'
  const video = { ...ap.video, situacao: destino === 'VIDEO_FALHOU' ? 'FALHOU' : 'NA_FILA', explicacao: destino === 'VIDEO_FALHOU' ? 'A geração do vídeo foi interrompida várias vezes; o Patrono segue para outra opção.' : 'A geração do vídeo foi interrompida; o Patrono tenta de novo sozinho.' }
  const historico = [...historicoDe(a.historico)]
  historico.push({ em: agora.toISOString(), versao: a.versao, acao: 'FALHOU', detalhe: `render interrompido (trabalho ${job?.estado ?? 'ausente'}) → ${destino}` })
  const r = await prisma.publicacaoAssistida.updateMany({
    where: { id: a.id, workspaceId: a.workspaceId, estado: 'GERANDO_VIDEO', updatedAt: a.updatedAt },
    data: { estado: destino, apresentacao: { ...(a.apresentacao as object), video } as unknown as Prisma.InputJsonValue, historico: historico as unknown as Prisma.InputJsonValue },
  })
  if (r.count === 1) log('warn', 'assistida.render_interrompido_recuperado', { workspaceId: a.workspaceId, id: a.id, destino, trabalho: job?.estado ?? null })
  return (await prisma.publicacaoAssistida.findFirst({ where: { id: a.id, workspaceId: a.workspaceId } })) ?? a
}

/**
 * Prepara a próxima publicação assistida. Se já houver uma em andamento,
 * leva o vídeo dela adiante e a devolve (uma por vez nas 10 primeiras).
 * Nunca publica nada.
 *
 *   escolhe o produto → escolhe o formato (mídia, aprendizado, campanha) →
 *   roteiro + checagem → mídia autorizada? gera o vídeo : AGUARDANDO_MIDIA
 */
export async function prepararProximaPublicacao(p: { workspaceId: string; userId: string | null; agora?: Date; excluirCandidatos?: string[]; origem?: string; candidatoEmMaos?: string }) {
  const agora = p.agora ?? new Date()
  if (p.candidatoEmMaos) return prepararComProdutoEmMaos({ ...p, candidatoEmMaos: p.candidatoEmMaos, agora })
  // P2.17.17: amostra RECEBIDA tem obrigação de conteúdo — vai na frente e não
  // fica travada atrás de uma publicação que só espera mídia de OUTRO produto.
  const recebidas = await candidatosComAmostraRecebida(p.workspaceId)
  const andamento = await prisma.publicacaoAssistida.findFirst({ where: { workspaceId: p.workspaceId, demonstracao: false, estado: { in: EM_ANDAMENTO } }, orderBy: { createdAt: 'desc' } })
  const amostraPassaNaFrente = !!andamento && andamento.estado === 'AGUARDANDO_MIDIA' && recebidas.some((r) => r.candidatoId !== andamento.candidatoId)
  if (andamento && !amostraPassaNaFrente) return avancarVideo(await retirarAprovacaoPrematura(andamento, agora), p.origem)
  const idsRecebidos = recebidas.map((r) => r.candidatoId)

  const [metas, candidatos, status, anteriores, resultados] = await Promise.all([
    listarMetasAtivas(p.workspaceId),
    prisma.candidatoDeProduto.findMany({
      where: {
        workspaceId: p.workspaceId,
        complianceBloqueante: false,
        AND: [CANDIDATO_NAO_EXCLUIDO],
        // Amostra recebida conta mesmo com o retrato do candidato vencido (a obrigação é real).
        OR: [{ status: { in: ['NOVO', 'APRESENTADO'] }, validoAte: { gte: agora } }, ...(idsRecebidos.length ? [{ id: { in: idsRecebidos } }] : [])],
        ...(amostraPassaNaFrente ? { id: { in: idsRecebidos } } : {}),
      },
      orderBy: [{ baseDeEvidencia: 'desc' }, { score: 'desc' }],
      take: 40,
    }),
    statusDosProdutos(p.workspaceId),
    prisma.publicacaoAssistida.findMany({ where: { workspaceId: p.workspaceId, demonstracao: false }, select: { candidatoId: true, estado: true, varianteId: true, createdAt: true, bloqueio: true } }),
    prisma.videoTikTokResultado.findMany({ where: { workspaceId: p.workspaceId }, orderBy: { publicadoEm: 'desc' }, take: 300 }),
  ])
  const analises = analisarMetas(metas, agora)
  // Aprendizado: a estrutura que mais rendeu (só com amostra mínima) vai na frente.
  // P2.21: o aprendizado só orienta com PADRAO_PROVAVEL ou mais (INSUFICIENTE/SINAL_INICIAL não mexem no plano).
  const { orientacao } = await aprendizadoCriativoDoWorkspace(p.workspaceId, agora, resultados)
  const vencedor = orientacao.estruturasPreferidas[0] ?? null
  const excluir = new Set(p.excluirCandidatos ?? [])
  // Rejeitado 2× na última semana: dá um tempo para esse produto.
  const semana = agora.getTime() - 7 * 24 * 60 * 60 * 1000
  for (const c of candidatos) {
    const rejeicoes = anteriores.filter((a) => a.candidatoId === c.id && a.estado === 'REJEITADO' && !encerradaPorProdutoInativo(a) && a.createdAt.getTime() > semana).length
    if (rejeicoes >= 2) excluir.add(c.id)
    // O render falhou nas tentativas: não insistir no mesmo produto agora.
    if (anteriores.some((a) => a.candidatoId === c.id && a.estado === 'VIDEO_FALHOU' && a.createdAt.getTime() > semana)) excluir.add(c.id)
    const st = status.get(c.id)?.status
    if (st === 'PAUSAR' || st === 'ENCERRADO') excluir.add(c.id)
  }
  const priorizados = priorizarProdutosTikTok(
    candidatos.filter((c) => !excluir.has(c.id)).map((c) => ({
      id: c.id, nome: c.nome, categoria: c.categoria, preco: c.preco, providerId: c.providerId, linkProduto: c.linkProduto, baseDeEvidencia: c.baseDeEvidencia,
      vendas: c.vendas, comissaoValor: c.comissaoValor, comissaoPercentual: c.comissaoPercentual, aderenciaNatal: campanhaDoCandidato(c, agora)?.aderencia ?? null,
    })),
    analises
  )
  // ESCALAR primeiro (repetir o que vende); depois a ordem comercial do TikTok.
  priorizados.sort((a, b) => (status.get(b.id)?.status === 'ESCALAR' ? 1 : 0) - (status.get(a.id)?.status === 'ESCALAR' ? 1 : 0))
  // P2.17.17: antes de tudo, amostra recebida (prazo confirmado/recebida há mais tempo primeiro).
  const ordemDaAmostra = (id: string) => {
    const r = recebidas.find((x) => x.candidatoId === id)
    return r ? (r.prazoConteudoEm ?? r.recebidaEm ?? agora).getTime() : Number.POSITIVE_INFINITY
  }
  priorizados.sort((a, b) => ordemDaAmostra(a.id) - ordemDaAmostra(b.id))
  for (const pr of priorizados) if (idsRecebidos.includes(pr.id)) pr.porque = ['Amostra recebida: tem obrigação de conteúdo.', ...pr.porque.filter((x) => !x.startsWith('Amostra recebida'))]

  return criarPublicacaoDoPrimeiroViavel({ workspaceId: p.workspaceId, agora, priorizados, candidatos, status, anteriores, analises, vencedor, orientacao, idsRecebidos, origem: p.origem })
}

/**
 * P2.18 — Plano B: a titular diz que TEM o produto em mãos. É a declaração
 * dela (nunca inferida): o Patrono prepara o vídeo DESTE produto, que passa
 * na frente de uma publicação que só espera mídia de outro produto — como a
 * amostra recebida. Não passa por cima de vídeo já pronto/aprovado.
 * A mídia continua exigindo as declarações de direito de uso de sempre.
 */
async function prepararComProdutoEmMaos(p: { workspaceId: string; userId: string | null; agora: Date; origem?: string; candidatoEmMaos: string }) {
  const { agora } = p
  const c = await prisma.candidatoDeProduto.findFirst({ where: { id: p.candidatoEmMaos, workspaceId: p.workspaceId } })
  if (!c) throw new ErroAssistido(404, 'Produto não encontrado em Oportunidades.')
  if (c.complianceBloqueante) throw new ErroAssistido(409, 'Este produto tem bloqueio de compliance: não dá para fazer vídeo dele.')
  const andamento = await prisma.publicacaoAssistida.findFirst({ where: { workspaceId: p.workspaceId, demonstracao: false, estado: { in: EM_ANDAMENTO } }, orderBy: { createdAt: 'desc' } })
  if (andamento?.candidatoId === c.id) return avancarVideo(await retirarAprovacaoPrematura(andamento, agora), p.origem)
  if (andamento && andamento.estado !== 'AGUARDANDO_MIDIA') {
    throw new ErroAssistido(409, `Já existe uma publicação em andamento (${andamento.nomeProduto}). Aprove, rejeite ou conclua essa antes de começar outro produto.`)
  }
  const [metas, status, anteriores, resultados, recebidas] = await Promise.all([
    listarMetasAtivas(p.workspaceId),
    statusDosProdutos(p.workspaceId),
    prisma.publicacaoAssistida.findMany({ where: { workspaceId: p.workspaceId, demonstracao: false }, select: { candidatoId: true, estado: true, varianteId: true, createdAt: true, bloqueio: true } }),
    prisma.videoTikTokResultado.findMany({ where: { workspaceId: p.workspaceId }, orderBy: { publicadoEm: 'desc' }, take: 300 }),
    candidatosComAmostraRecebida(p.workspaceId),
  ])
  const analises = analisarMetas(metas, agora)
  // P2.21: o aprendizado só orienta com PADRAO_PROVAVEL ou mais (INSUFICIENTE/SINAL_INICIAL não mexem no plano).
  const { orientacao } = await aprendizadoCriativoDoWorkspace(p.workspaceId, agora, resultados)
  const vencedor = orientacao.estruturasPreferidas[0] ?? null
  const [priorizado] = priorizarProdutosTikTok([{
    id: c.id, nome: c.nome, categoria: c.categoria, preco: c.preco, providerId: c.providerId, linkProduto: c.linkProduto, baseDeEvidencia: c.baseDeEvidencia,
    vendas: c.vendas, comissaoValor: c.comissaoValor, comissaoPercentual: c.comissaoPercentual, aderenciaNatal: campanhaDoCandidato(c, agora)?.aderencia ?? null,
  }], analises)
  priorizado.porque = ['Você disse que tem este produto em mãos: o vídeo usa a mídia que você gravar.', ...priorizado.porque]
  return criarPublicacaoDoPrimeiroViavel({ workspaceId: p.workspaceId, agora, priorizados: [priorizado], candidatos: [c], status, anteriores, analises, vencedor, orientacao, idsRecebidos: recebidas.map((r) => r.candidatoId), origem: p.origem, produtoEmMaos: true })
}

/**
 * Cria a publicação do produto SEM duplicar: uma trava transacional por
 * (workspace, produto) serializa requisições simultâneas; a segunda encontra
 * a publicação em andamento da primeira e a reaproveita.
 */
async function criarAssistidaSemDuplicar(workspaceId: string, candidatoId: string, data: Prisma.PublicacaoAssistidaUncheckedCreateInput) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`assistida:${workspaceId}:${candidatoId}`}))`
    const existente = await tx.publicacaoAssistida.findFirst({ where: { workspaceId, candidatoId, demonstracao: false, estado: { in: EM_ANDAMENTO } }, orderBy: { createdAt: 'desc' } })
    if (existente) return { registro: existente, novo: false }
    return { registro: await tx.publicacaoAssistida.create({ data }), novo: true }
  })
}

async function criarPublicacaoDoPrimeiroViavel(p: {
  workspaceId: string
  agora: Date
  priorizados: ReturnType<typeof priorizarProdutosTikTok>
  candidatos: Awaited<ReturnType<typeof prisma.candidatoDeProduto.findMany>>
  status: Awaited<ReturnType<typeof statusDosProdutos>>
  anteriores: { candidatoId: string | null; estado: string; varianteId: string; createdAt: Date; bloqueio: string | null }[]
  analises: ReturnType<typeof analisarMetas>
  vencedor: string | null
  orientacao?: OrientacaoCriativa | null
  idsRecebidos: string[]
  origem?: string
  produtoEmMaos?: boolean
}) {
  const { agora, priorizados, candidatos, status, anteriores, analises, vencedor, idsRecebidos } = p
  for (const escolhido of priorizados) {
    const c = candidatos.find((x) => x.id === escolhido.id)!
    const tiktokShop = ehProdutoTikTokShop(c.providerId, c.linkProduto)
    const plano = planejarVideos({ nome: c.nome, categoria: c.categoria, preco: c.preco, vendas: c.vendas, tiktokShop }, agora)
    const ordem = [...plano.testeInicial.variantes, ...plano.variantes.map((v) => v.id).filter((id) => !plano.testeInicial.variantes.includes(id))]
    const vezes = anteriores.filter((a) => a.candidatoId === c.id && a.estado !== 'GERANDO').length
    const usadas = new Set(anteriores.filter((a) => a.candidatoId === c.id).map((a) => a.varianteId))
    // Mídia autorizada do produto: reaproveitada (nunca pedida de novo).
    const midias = await midiasAutorizadas({ workspaceId: p.workspaceId, produtoId: c.produtoId, candidatoId: c.id })
    const escolha = escolherVariante(plano.variantes, ordem, usadas, vencedor, midias, tiktokShop, p.orientacao ?? null, { nome: c.nome, categoria: c.categoria })
    if (!escolha) continue
    const { versao, qg } = escolha
    const video = videoInicial(versao.estrutura, midias)
    const st = status.get(c.id)
    const missoes = missoesQueOVideoAjuda(analises, { tiktokShop })
    const metasIds = analises.filter((a) => (a.situacao === 'EM_ANDAMENTO' || a.situacao === 'NAO_INICIADA') && (a.usaProdutoNoVideo ? true : tiktokShop)).map((a) => a.id)
    const horario = horarioSugerido(agora)
    const apresentacao = {
      produto: {
        nome: c.nome, preco: c.preco, comissaoPercentual: c.comissaoPercentual, comissaoValor: c.comissaoValor,
        comissaoTexto: c.comissaoValor !== null ? `${reais(c.comissaoValor)} por venda` : c.comissaoPercentual !== null ? `${c.comissaoPercentual}%` : 'comissão ainda não informada por fonte oficial',
        link: c.linkProduto, tiktokShop, categoria: c.categoria, statusEconomico: st?.status ?? 'TESTANDO',
      },
      motivoEscolha: escolhido.porque,
      video,
      versao,
      textoNaTela: textoNaTelaDe(versao),
      canal: 'tiktok',
      horarioPlanejado: horario.toISOString(),
      horarioOrigem: 'hipótese: próxima janela livre (ainda sem dado da sua audiência)',
      missoes,
      produtoMarcado: tiktokShop ? PRODUTO_MARCADO_POR_API : 'Produto fora do TikTok Shop: o link vai na bio.',
      // P2.17.17: amostra com kit preparado → as cenas que a titular grava (só o que é mídia dela).
      cenasParaGravar: chavesDoCandidato(c).map(kitDaChave).find(Boolean)?.cenasParaGravar ?? cenasParaGravarGenericas(versao.estrutura),
      // P2.21: o que o aprendizado mudou neste vídeo e por quê (null = nada orientou).
      aprendizadoAplicado: escolha.aplicado.length ? { mudancas: escolha.aplicado, motivos: p.orientacao?.motivos ?? [] } : null,
    }
    const objetivoDoTeste = `${vezes + 1}ª vez deste produto: testar ${versao.estrutura.toLowerCase().replace(/_/g, ' ')} (objetivo ${versao.objetivo.toLowerCase()}).`
    // P2.18.11: duas abas/requisições ao mesmo tempo → uma publicação só (trava no banco, não só na tela).
    const { registro: criado, novo } = await criarAssistidaSemDuplicar(p.workspaceId, c.id, {
      workspaceId: p.workspaceId,
      estado: estadoPeloVideo(video.situacao, 0),
      candidatoId: c.id,
      produtoId: c.produtoId,
      nomeProduto: c.nome,
      varianteId: versao.varianteId,
      estrutura: versao.estrutura,
      apresentacao: apresentacao as unknown as Prisma.InputJsonValue,
      qualityGate: qg as unknown as Prisma.InputJsonValue,
      historico: [
        ...(p.produtoEmMaos ? [{ em: agora.toISOString(), versao: 1, acao: 'PRODUTO_EM_MAOS', detalhe: 'A titular declarou ter o produto em mãos.' }] : []),
        { em: agora.toISOString(), versao: 1, acao: 'QUALITY_GATE', veredito: qg.veredito, detalhe: `Roteiro: ${qg.resumo}` },
      ] as unknown as Prisma.InputJsonValue,
      motivoEscolha: escolhido.porque.join(' '),
      objetivoDoTeste,
      vezesQueOProdutoApareceu: vezes,
      horarioPlanejado: horario,
      metasIds,
    })
    if (!novo) return avancarVideo(criado, p.origem)
    if (idsRecebidos.includes(c.id)) await ligarPublicacaoNaAmostra(p.workspaceId, c.id, criado.id)
    await registrarEvento({ workspaceId: p.workspaceId, tipo: 'CONTENT_VALIDATED', chaveIdempotencia: `assistida:${criado.id}:v1:qg`, entidadeTipo: 'PublicacaoAssistida', entidadeId: criado.id, payload: { veredito: qg.veredito, produto: c.nome } })
    return avancarVideo(criado, p.origem)
  }
  if (p.produtoEmMaos) throw new ErroAssistido(409, 'Nenhum roteiro deste produto passou na checagem de qualidade. Confira o nome e a categoria em Oportunidades.')
  throw new ErroAssistido(409, 'Nenhum produto com vídeo aprovado pela checagem de qualidade agora. Informe produtos do TikTok Shop em Oportunidades ou atualize os candidatos.')
}

// ── Decisões da titular ─────────────────────────────────────────────────

async function lerAssistida(workspaceId: string, id: string) {
  const a = await prisma.publicacaoAssistida.findFirst({ where: { id, workspaceId } })
  if (!a) throw new ErroAssistido(404, 'Publicação não encontrada.')
  return a
}

function versaoAtual(a: { apresentacao: Prisma.JsonValue }): VersaoDoVideo {
  return (a.apresentacao as unknown as { versao: VersaoDoVideo }).versao
}

/** PEDIR AJUSTE: registra o motivo, o Patrono corrige (alterações da titular ou próxima variação) e reapresenta. */
export async function pedirAjuste(p: { workspaceId: string; userId: string; id: string; motivo: string; alteracoes?: Alteracoes; agora?: Date; origem?: string }) {
  const agora = p.agora ?? new Date()
  if (!p.motivo.trim()) throw new ErroAssistido(400, 'Diga o que ajustar.')
  const a = await lerAssistida(p.workspaceId, p.id)
  if (a.demonstracao) throw new ErroAssistido(409, 'Esta é uma DEMONSTRAÇÃO em teste: não aceita ajuste nem aprovação.')
  if (a.estado !== 'AGUARDANDO_APROVACAO') throw new ErroAssistido(409, `Esta publicação está em "${a.estado}" e não aceita ajuste agora.`)
  const ap = a.apresentacao as unknown as { produto: { tiktokShop: boolean; nome: string; categoria: string | null; preco: number | null }; versao: VersaoDoVideo }
  const historico = historicoDe(a.historico)
  historico.push({ em: agora.toISOString(), versao: a.versao, acao: 'AJUSTE_PEDIDO', detalhe: p.motivo.trim(), alteracoes: p.alteracoes })

  // 1) As alterações da titular, se vieram. 2) Senão, a próxima variação do produto.
  let nova: VersaoDoVideo | null = null
  let qg: AvaliacaoDoVideo | null = null
  if (temAlteracao(p.alteracoes)) {
    nova = aplicarAlteracoes(ap.versao, p.alteracoes)
    qg = checar(nova, ap.produto.tiktokShop, ap.produto)
  }
  if (!nova || qg?.veredito !== 'APROVADO') {
    const plano = planejarVideos({ nome: ap.produto.nome, categoria: ap.produto.categoria, preco: ap.produto.preco, tiktokShop: ap.produto.tiktokShop }, agora)
    const usadas = new Set(historico.filter((h) => h.acao === 'APRESENTADO').map((h) => h.detalhe?.split(' · ')[0]))
    const candidatas = plano.variantes.filter((v) => !v.exigeExperienciaReal && v.id !== ap.versao.varianteId && !usadas.has(v.estrutura))
    for (const v of [...candidatas, ...plano.variantes.filter((x) => !x.exigeExperienciaReal && x.id !== ap.versao.varianteId)]) {
      const versao = aplicarAlteracoes(versaoDaVariante(v), p.alteracoes)
      const checagem = checar(versao, ap.produto.tiktokShop, ap.produto)
      if (checagem.veredito === 'APROVADO') {
        nova = versao
        qg = checagem
        break
      }
    }
  }
  if (!nova || !qg || qg.veredito !== 'APROVADO') {
    throw new ErroAssistido(409, `Não consegui uma versão aprovada pela checagem com esse ajuste${qg ? `: ${qg.resumo}` : ''}.`)
  }
  const versao = a.versao + 1
  historico.push({ em: agora.toISOString(), versao, acao: 'QUALITY_GATE', veredito: qg.veredito, detalhe: `Roteiro: ${qg.resumo}` })
  // P2.17.12: o texto queimado mudou — o vídeo é gerado de novo com a MESMA
  // mídia autorizada (reaproveitada) e só volta a você com o MP4 novo.
  const midias = await midiasAutorizadas({ workspaceId: a.workspaceId, produtoId: a.produtoId, candidatoId: a.candidatoId })
  const video = videoInicial(nova.estrutura, midias)
  const r = await prisma.publicacaoAssistida.update({
    where: { id: a.id },
    data: {
      versao,
      estado: estadoPeloVideo(video.situacao, 0),
      varianteId: nova.varianteId,
      estrutura: nova.estrutura,
      apresentacao: { ...(a.apresentacao as object), versao: nova, video, textoNaTela: textoNaTelaDe(nova) } as unknown as Prisma.InputJsonValue,
      qualityGate: qg as unknown as Prisma.InputJsonValue,
      historico: historico as unknown as Prisma.InputJsonValue,
    },
  })
  await registrarAuditoria({ workspaceId: p.workspaceId, userId: p.userId, action: 'tiktok.assistido_ajuste', entityType: 'PublicacaoAssistida', entityId: a.id, metadata: { versao, motivo: p.motivo.slice(0, 200) } })
  return avancarVideo(r, p.origem)
}

/** REJEITAR: registra o motivo e o Patrono já prepara outra (outro produto ou outra variação). */
export async function rejeitar(p: { workspaceId: string; userId: string; id: string; motivo: string; agora?: Date; origem?: string }) {
  const agora = p.agora ?? new Date()
  if (!p.motivo.trim()) throw new ErroAssistido(400, 'Diga por que rejeitou: o Patrono aprende com isso.')
  const a = await lerAssistida(p.workspaceId, p.id)
  if (!REJEITAVEIS.includes(a.estado as EstadoAssistido)) throw new ErroAssistido(409, `Esta publicação está em "${a.estado}" e não pode ser rejeitada agora.`)
  const historico = historicoDe(a.historico)
  historico.push({ em: agora.toISOString(), versao: a.versao, acao: 'REJEITADO', detalhe: p.motivo.trim() })
  const r = await prisma.publicacaoAssistida.updateMany({ where: { id: a.id, estado: a.estado }, data: { estado: 'REJEITADO', historico: historico as unknown as Prisma.InputJsonValue } })
  if (r.count !== 1) throw new ErroAssistido(409, 'Esta publicação acabou de mudar de estado.')
  // Demonstração descartada: não conta e não puxa outra.
  if (a.demonstracao) return null
  await registrarEvento({ workspaceId: p.workspaceId, tipo: 'APPROVAL_REJECTED', chaveIdempotencia: `assistida:${a.id}:v${a.versao}:rejeitada`, entidadeTipo: 'PublicacaoAssistida', entidadeId: a.id, payload: { produto: a.nomeProduto } })
  await registrarAuditoria({ workspaceId: p.workspaceId, userId: p.userId, action: 'tiktok.assistido_rejeitado', entityType: 'PublicacaoAssistida', entityId: a.id, metadata: { motivo: p.motivo.slice(0, 200) } })
  // O Patrono corrige e apresenta de novo: outro produto; sem outro, outra variação do mesmo.
  return prepararProximaPublicacao({ workspaceId: p.workspaceId, userId: p.userId, agora, excluirCandidatos: a.candidatoId ? [a.candidatoId] : [], origem: p.origem })
    .catch(() => prepararProximaPublicacao({ workspaceId: p.workspaceId, userId: p.userId, agora, origem: p.origem }))
    .catch(() => null)
}

/** Produto + Conteúdo da publicação aprovada (a porta única publica `Conteudo`). */
async function garantirConteudo(a: Awaited<ReturnType<typeof lerAssistida>>, userId: string, versao: VersaoDoVideo, fixado: import('./arquivo-aprovado').ArquivoFixado | null = null): Promise<string> {
  if (a.conteudoId) {
    await prisma.conteudo.update({ where: { id: a.conteudoId }, data: dadosDoConteudo(versao, a, fixado) })
    return a.conteudoId
  }
  let produtoId = a.produtoId
  if (!produtoId && a.candidatoId) {
    const c = await prisma.candidatoDeProduto.findFirst({ where: { id: a.candidatoId, workspaceId: a.workspaceId } })
    if (!c) throw new ErroAssistido(404, 'O produto desta publicação não existe mais.')
    produtoId =
      c.produtoId ??
      (c.providerId && c.externalId ? (await prisma.produto.findFirst({ where: { workspaceId: a.workspaceId, providerId: c.providerId, externalId: c.externalId }, select: { id: true } }))?.id : null) ??
      (await prisma.produto.create({ data: dadosDoProdutoACriar(c, { workspaceId: a.workspaceId, userId }), select: { id: true } })).id
    // A aprovação da titular É a escolha do produto.
    await prisma.candidatoDeProduto.updateMany({ where: { id: c.id, status: { in: ['NOVO', 'APRESENTADO'] } }, data: { status: 'CADASTRADO', produtoId, escolhidoEm: new Date(), escolhidoPorUserId: userId } })
  }
  if (!produtoId) throw new ErroAssistido(409, 'Sem produto cadastrado para esta publicação.')
  const conteudo = await prisma.conteudo.create({ data: { workspaceId: a.workspaceId, userId, produtoId, ...dadosDoConteudo(versao, a, fixado) }, select: { id: true } })
  await prisma.publicacaoAssistida.update({ where: { id: a.id }, data: { produtoId, conteudoId: conteudo.id } })
  return conteudo.id
}

function dadosDoConteudo(v: VersaoDoVideo, a: { apresentacao: Prisma.JsonValue }, fixado: import('./arquivo-aprovado').ArquivoFixado | null = null) {
  const av = paraAvaliar(v)
  const original = (a.apresentacao as unknown as { video?: { arquivo?: string | null; evidencia?: unknown } }).video
  // P2.69+: com o arquivo fixado, a peça aponta para a CÓPIA IMUTÁVEL (mesmos bytes, sha256 conferido). O registro de
  // direito é o do original, transportado para a cópia com a prova do vínculo (sha256 + de onde veio).
  const ev = original?.evidencia as Record<string, unknown> | undefined
  const video = fixado
    ? { arquivo: fixado.url, evidencia: ev ? { ...ev, assetUrl: fixado.url, copiaImutavel: { de: original?.arquivo ?? null, sha256: fixado.sha256, caminho: fixado.caminho } } : undefined }
    : original
  return {
    roteiro: roteiroComoTexto(av.roteiro),
    legendaTiktok: v.legenda,
    // revisão P2.72 (MÉDIA 2): o Instagram leva a MESMA legenda aprovada (com #publi e o aviso de IA)
    legendaInstagram: v.legenda,
    hashtags: v.hashtags,
    textoTela: av.roteiro.map((r) => r.textoNaTela).filter(Boolean).join('\n') || null,
    chamadaAcao: v.cta,
    duracao: v.duracaoSegundos,
    redeSocial: 'tiktok',
    objetivo: v.objetivo,
    estilo: v.estrutura,
    status: 'aprovado',
    videoUrl: video?.arquivo ?? null,
    // revisão P2.72 (MÉDIA 1): container do Instagram criado com outro arquivo nunca é reaproveitado
    videoRequestId: null,
    // P2.17.12: a cadeia de direitos do MP4 vai junto — a porta única confere antes de enviar.
    ...(video?.evidencia ? { alertasCompliance: [video.evidencia as Prisma.InputJsonValue] } : {}),
  }
}

/** Traduz o "por que não publicou" da porta única, com o dono de cada bloqueio. */
async function motivoDoBloqueio(workspaceId: string, explicacao: string, temVideo: boolean): Promise<string> {
  const canal = await estadoDoCanalTikTok(workspaceId)
  const partes: string[] = []
  // P2.17.12: com o MP4 gerado (e a cadeia de direitos no Conteúdo), "falta o vídeo" seria mentira.
  if (!temVideo && /MIDIA|mídia|vídeo|VIDEO|FORMATO/i.test(explicacao)) partes.push('Falta o arquivo de vídeo com mídia autorizada.')
  partes.push(...canal.bloqueios.map((b) => b.texto))
  if (!partes.length) partes.push(higienizar(explicacao))
  return partes.join(' ')
}

/**
 * REVALIDAR_DADOS_COMERCIAIS antes de aprovar/publicar (e a cada sincronização
 * da Operação): "PREÇO NÃO CONFIRMADO = PREÇO NÃO PUBLICADO".
 *  - legenda com valor/desconto/cupom não confirmado → corrigida na hora ("Confira o valor atual no link.");
 *  - o mesmo no texto QUEIMADO no vídeo → o vídeo é gerado de novo sem o valor (mesma mídia) e volta à aprovação;
 *  - produto indisponível na fonte oficial → não publica.
 * Publicação já feita nunca é tocada.
 */
export async function revisarComercialDaAssistida(p: { workspaceId: string; id: string; agora?: Date; origem?: string }): Promise<{ regerou: boolean; legendaCorrigida: boolean; indisponivel: boolean }> {
  const agora = p.agora ?? new Date()
  const nada = { regerou: false, legendaCorrigida: false, indisponivel: false }
  const a = await lerAssistida(p.workspaceId, p.id)
  if (!a.candidatoId || a.demonstracao || !['AGUARDANDO_APROVACAO', 'APROVADO', 'FALHOU'].includes(a.estado)) return nada
  const d = await revalidarDadosComerciais({ workspaceId: p.workspaceId, candidatoId: a.candidatoId, agora })
  if (!d) return nada
  const ap = a.apresentacao as unknown as { produto: { preco: number | null; tiktokShop: boolean; nome: string; categoria: string | null }; versao: VersaoDoVideo; comercial?: unknown }
  const atual = (a.estado === 'AGUARDANDO_APROVACAO' ? null : (a.versaoFinal as unknown as VersaoDoVideo | null)) ?? ap.versao
  const rev = revisarVersao(atual, d)
  const apresentacao = { ...ap, produto: { ...ap.produto, preco: d.preco }, comercial: retratoComercial(d) }
  const historico = historicoDe(a.historico)
  if (rev.queimadoMudou && temVideoGerado(a)) {
    // O valor está escrito no vídeo: só regerando. Mesma mídia; volta para a titular aprovar.
    const qg = checar(rev.versao, ap.produto.tiktokShop, ap.produto)
    const midias = await midiasAutorizadas({ workspaceId: a.workspaceId, produtoId: a.produtoId, candidatoId: a.candidatoId })
    const video = videoInicial(rev.versao.estrutura, midias)
    const versao = a.versao + 1
    historico.push({ em: agora.toISOString(), versao, acao: 'DADOS_COMERCIAIS_DESATUALIZADOS', detalhe: `O vídeo mostrava um valor que não pode ser confirmado agora (${d.status}, fonte ${d.fonte}). Gerado de novo sem o valor.`, veredito: qg.veredito, comercial: retratoComercial(d) })
    const r = await prisma.publicacaoAssistida.updateMany({
      where: { id: a.id, estado: a.estado },
      data: {
        versao,
        estado: estadoPeloVideo(video.situacao, 0),
        versaoFinal: Prisma.DbNull,
        apresentacao: { ...apresentacao, versao: rev.versao, video, textoNaTela: textoNaTelaDe(rev.versao) } as unknown as Prisma.InputJsonValue,
        qualityGate: qg as unknown as Prisma.InputJsonValue,
        historico: historico as unknown as Prisma.InputJsonValue,
      },
    })
    if (r.count === 1) {
      await registrarEvento({ workspaceId: p.workspaceId, tipo: 'COMMERCIAL_DATA_INVALIDATED', chaveIdempotencia: `assistida:${a.id}:v${a.versao}:comercial`, entidadeTipo: 'PublicacaoAssistida', entidadeId: a.id, payload: { status: d.status, fonte: d.fonte, regerado: true } })
      await avancarVideo(await lerAssistida(p.workspaceId, a.id), p.origem)
    }
    return { ...nada, regerou: r.count === 1, indisponivel: d.disponivel === false }
  }
  if (rev.legendaMudou) historico.push({ em: agora.toISOString(), versao: a.versao, acao: 'LEGENDA_CORRIGIDA_PRECO', detalhe: `Valor não confirmado retirado da legenda (${d.status}, fonte ${d.fonte}).`, comercial: retratoComercial(d) })
  const legenda = rev.versao.legenda
  const naAprovacao = a.estado === 'AGUARDANDO_APROVACAO'
  await prisma.publicacaoAssistida.updateMany({
    where: { id: a.id, estado: a.estado },
    data: {
      apresentacao: { ...apresentacao, versao: rev.legendaMudou && naAprovacao ? { ...ap.versao, legenda } : ap.versao } as unknown as Prisma.InputJsonValue,
      ...(rev.legendaMudou && !naAprovacao ? { versaoFinal: { ...atual, legenda } as unknown as Prisma.InputJsonValue } : {}),
      ...(d.disponivel === false ? { bloqueio: `PRODUTO_INDISPONIVEL: a fonte oficial diz que o produto está indisponível (verificado em ${d.lastVerifiedAt}).` } : {}),
      historico: historico as unknown as Prisma.InputJsonValue,
    },
  })
  if (rev.legendaMudou) await registrarEvento({ workspaceId: p.workspaceId, tipo: 'COMMERCIAL_DATA_INVALIDATED', chaveIdempotencia: `assistida:${a.id}:v${a.versao}:legenda:${d.lastVerifiedAt}`, entidadeTipo: 'PublicacaoAssistida', entidadeId: a.id, payload: { status: d.status, fonte: d.fonte, regerado: false } })
  return { ...nada, legendaCorrigida: rev.legendaMudou, indisponivel: d.disponivel === false }
}

/**
 * APROVAR E PUBLICAR. Atômico contra clique duplo. A checagem roda de novo na
 * versão FINAL (com as alterações da titular): se reprovar, nada é aprovado.
 */
export async function aprovarEPublicar(p: { workspaceId: string; userId: string; id: string; alteracoes?: Alteracoes; privacidade?: string | null; agora?: Date; env?: Record<string, string | undefined>; versao?: number; sha256?: string | null; versaoEscolhida?: 'ORIGINAL' | 'NARRADA' | null }) {
  const agora = p.agora ?? new Date()
  // Dados comerciais revalidados ANTES de aprovar (a titular aprova o que vai ao ar).
  const comercial = await revisarComercialDaAssistida({ workspaceId: p.workspaceId, id: p.id, agora })
  if (comercial.regerou) throw new ErroAssistido(409, 'O vídeo mostrava um preço que não pode ser confirmado agora. O Patrono está gerando de novo sem o valor ("Confira o valor atual no link."): aprove a nova versão.')
  if (comercial.indisponivel) throw new ErroAssistido(409, 'A fonte oficial diz que o produto está indisponível agora: não dá para publicar.')
  const a = await lerAssistida(p.workspaceId, p.id)
  if (a.demonstracao) throw new ErroAssistido(409, 'Esta é uma DEMONSTRAÇÃO em teste (mídia fictícia): ela não pode ser aprovada nem publicada.')
  if (a.estado !== 'AGUARDANDO_APROVACAO') throw new ErroAssistido(409, `Esta publicação está em "${a.estado}": nada a aprovar.`)
  // P2.50 (A2): aprova-se a versão VISTA. Aba antiga (versão ou arquivo diferentes) não aprova o vídeo novo.
  const shaAtual = ((a.apresentacao as { video?: { sha256?: string | null } } | null)?.video?.sha256) ?? null
  if (p.versao !== undefined && p.versao !== a.versao) throw new ErroAssistido(409, `O vídeo mudou desde que você abriu a tela (você viu a versão ${p.versao}; agora é a ${a.versao}). Atualize e confira antes de aprovar.`)
  if (p.sha256 && shaAtual && p.sha256 !== shaAtual) throw new ErroAssistido(409, 'O arquivo do vídeo mudou desde que você abriu a tela. Atualize e confira antes de aprovar.')
  // P2.17.12: sem o MP4 não existe "aprovar e publicar".
  if (!temVideoGerado(a)) throw new ErroAssistido(409, 'O vídeo ainda não foi gerado: só dá para aprovar depois que o arquivo existir e passar na checagem.')
  // Gancho e CTA estão QUEIMADOS no vídeo: mudá-los aqui deixaria o arquivo diferente do aprovado.
  if (p.alteracoes?.gancho?.trim() || p.alteracoes?.cta?.trim()) {
    throw new ErroAssistido(400, 'Gancho e chamada final estão escritos no vídeo. Para mudá-los, use "Pedir ajuste": o Patrono gera o vídeo de novo.')
  }
  const ap = a.apresentacao as unknown as { produto: { tiktokShop: boolean; nome: string; categoria: string | null } }
  // P2.33.1: a titular escolhe a versão — ORIGINAL (padrão, sem narração) ou NARRADA (a prévia que ela ouviu).
  const { versaoParaAprovar, legendaComDisclosure } = await import('./narracao')
  const escolha = await versaoParaAprovar({ workspaceId: p.workspaceId, userId: p.userId, a, versao: p.versaoEscolhida ?? null, agora }).catch((e: unknown) => {
    const st = e instanceof Error && 'status' in e ? (e as { status: number }).status : null
    throw st === 400 || st === 403 || st === 404 || st === 409 ? new ErroAssistido(st, (e as Error).message) : e
  })
  const comAlteracao = aplicarAlteracoes(versaoAtual(a), p.alteracoes)
  // Legenda editada agora pela titular passa pela mesma regra de preço.
  const dados = a.candidatoId ? await revalidarDadosComerciais({ workspaceId: p.workspaceId, candidatoId: a.candidatoId, agora }) : null
  const revisada = dados ? { ...comAlteracao, legenda: revisarVersao(comAlteracao, dados).versao.legenda } : comAlteracao
  // Voz sintetizada → disclosure de IA na legenda (nunca escondido).
  const final = { ...revisada, legenda: legendaComDisclosure(revisada.legenda, escolha.formato) }
  // revisão P2.72 (MÉDIA 2c): a legenda editada agora não pode trazer número que a legenda avaliada pela barreira não
  // traz (mesma regra fechada: o número e a frase dele)
  if (p.alteracoes?.legenda?.trim()) {
    const { conferirAfirmacoes } = await import('./afirmacoes-numericas')
    const conf = conferirAfirmacoes([final.legenda], [versaoAtual(a).legenda], ap.produto.nome)
    if (conf.semVinculo.length) throw new ErroAssistido(400, `A legenda alterada traz número que a versão avaliada não traz (${conf.semVinculo[0]}). Use o número exatamente como está, ou peça ajuste ao Patrono.`.slice(0, 600))
  }
  const qgTexto = checar(final, ap.produto.tiktokShop, ap.produto)
  if (qgTexto.veredito !== 'APROVADO') {
    throw new ErroAssistido(400, `A sua alteração não passou na checagem de qualidade (${qgTexto.veredito}): ${qgTexto.resumo} Ajuste ou peça ajuste ao Patrono.`)
  }
  // A checagem do ARQUIVO (feita na geração) continua valendo: o vídeo não mudou.
  const qgArquivo = a.qualityGate as unknown as { arquivo?: unknown; veredito?: string }
  if (qgArquivo.veredito !== 'APROVADO' || !qgArquivo.arquivo) throw new ErroAssistido(409, 'O vídeo não tem a checagem do arquivo aprovada.')
  // P2.72 (revisão do porte, ALTA): preserva comercial, conformidade, campanha e barreira já registrados
  const qg = { ...(a.qualityGate as object), ...qgTexto, arquivo: qgArquivo.arquivo }
  const alterou = temAlteracao(p.alteracoes)
  const historico = historicoDe(a.historico)
  historico.push({ em: agora.toISOString(), versao: a.versao, acao: 'APROVADO', sha256: shaAtual ?? undefined, detalhe: escolha.versao === 'NARRADA' ? `versão narrada (${escolha.formato})` : undefined, alteracoes: alterou ? p.alteracoes : undefined, veredito: qg.veredito, comercial: dados ? retratoComercial(dados) : undefined })
  const reivindicado = await prisma.publicacaoAssistida.updateMany({
    where: { id: a.id, workspaceId: p.workspaceId, estado: 'AGUARDANDO_APROVACAO', updatedAt: a.updatedAt, versao: a.versao },
    data: {
      estado: 'APROVADO',
      // P2.33.1: versão escolhida + formato audiovisual (aprendizado). A versão original nunca é alterada.
      apresentacao: { ...(a.apresentacao as object), versaoEscolhida: escolha.versao, formatoAudiovisual: escolha.formato, narracao: escolha.narracao } as unknown as Prisma.InputJsonValue,
      aprovadoDePrimeira: a.versao === 1 && !alterou,
      versaoFinal: final as unknown as Prisma.InputJsonValue,
      qualityGate: qg as unknown as Prisma.InputJsonValue,
      horarioPlanejado: p.alteracoes?.horarioPlanejado ? new Date(p.alteracoes.horarioPlanejado) : undefined,
      historico: historico as unknown as Prisma.InputJsonValue,
    },
  })
  if (reivindicado.count !== 1) throw new ErroAssistido(409, 'Esta publicação acabou de ser aprovada ou mudou de estado.')
  await registrarEvento({ workspaceId: p.workspaceId, tipo: 'APPROVAL_GRANTED', chaveIdempotencia: `assistida:${a.id}:v${a.versao}:aprovada`, entidadeTipo: 'PublicacaoAssistida', entidadeId: a.id, payload: { produto: a.nomeProduto, deprimeira: a.versao === 1 && !alterou } })
  await registrarAuditoria({ workspaceId: p.workspaceId, userId: p.userId, action: 'tiktok.assistido_aprovado', entityType: 'PublicacaoAssistida', entityId: a.id, metadata: { versao: a.versao, alterou, versaoEscolhida: escolha.versao, formatoAudiovisual: escolha.formato } })
  return publicarAprovada({ workspaceId: p.workspaceId, userId: p.userId, id: a.id, privacidade: p.privacidade ?? null, agora, env: p.env })
}

/**
 * P2.69 — liberação calculada sobre o arquivo que VAI AO AR, com o sha256 RECALCULADO agora:
 *  - versão NARRADA: o vídeo narrado (armazenamento privado), não o MP4 base — a auditoria/barreira precisam ter sido
 *    feitas sobre ele (senão os sha não batem e a publicação fica retida);
 *  - versão padrão: o arquivo de `apresentacao.video.arquivo`.
 * Sem conseguir ler o arquivo, não há evidência: retido.
 *
 * Fechamento do TOCTOU: a origem é lida UMA vez, os bytes vão para o caminho IMUTÁVEL `<ws>/aprovados/<sha256>.mp4`
 * (lib/arquivo-aprovado.ts) e a liberação é decidida com o sha256 DESSES bytes. Quem publica usa `fixado.url` — o que
 * a plataforma lê é, por construção, o arquivo aprovado. `portas` só é injetado em teste.
 */
export async function liberacaoDoArquivoAPublicar(a: { workspaceId: string; apresentacao: unknown; qualityGate: unknown }, portas?: import('./arquivo-aprovado').PortasDoArquivoAprovado): Promise<{ liberado: boolean; motivos: string[]; fixado: import('./arquivo-aprovado').ArquivoFixado | null }> {
  const { liberacaoParaPublicacao } = await import('./quality-gate-conformidade')
  const { fixarArquivoAprovado } = await import('./arquivo-aprovado')
  const ap = (a.apresentacao ?? {}) as { video?: { arquivo?: string | null }; versaoEscolhida?: string; narracao?: { videoPath?: string | null } | null }
  const narrada = ap.versaoEscolhida === 'NARRADA'
  const origem = narrada ? ap.narracao?.videoPath ?? '' : ap.video?.arquivo ?? ''
  const p = portas ?? (await import('./arquivo-aprovado-real')).PORTAS_REAIS_DO_ARQUIVO_APROVADO
  const fixado = origem ? await fixarArquivoAprovado({ workspaceId: a.workspaceId, origem }, p).catch(() => null) : null
  // sem arquivo fixado nunca libera; os demais controles pendentes também aparecem no motivo
  if (!fixado) return { liberado: false, motivos: [`Não foi possível ler e fixar o arquivo ${narrada ? 'narrado' : 'de vídeo'} (sha256 + caminho imutável): sem prova de que é o arquivo aprovado.`, ...liberacaoParaPublicacao(a.qualityGate as never).motivos], fixado: null }
  const lib = liberacaoParaPublicacao(a.qualityGate as never, fixado.sha256)
  // P2.72: sem o sha256 do arquivo gerado e auditado não há como provar que o fixado é o MESMO (peça anterior a esta
  // versão: gerar de novo)
  const shaAuditado = ((a.qualityGate ?? {}) as { arquivo?: { sha256?: string | null } }).arquivo?.sha256 ?? null
  if (!shaAuditado) lib.motivos.push('A checagem do arquivo não tem o sha256 do vídeo gerado: gere o vídeo de novo para provar que é o mesmo arquivo.')
  const liberado = lib.motivos.length === 0
  return { ...lib, liberado, fixado: liberado ? fixado : null }
}

/** Executa (ou tenta de novo) a publicação de uma aprovada pela porta única oficial. */
export async function publicarAprovada(p: { workspaceId: string; userId: string; id: string; privacidade?: string | null; agora?: Date; env?: Record<string, string | undefined>; conferiuOPerfil?: boolean; /** P2.69: injeção para testes; padrão = Supabase Storage */ portasDoArquivo?: import('./arquivo-aprovado').PortasDoArquivoAprovado }) {
  const agora = p.agora ?? new Date()
  const comercial = await revisarComercialDaAssistida({ workspaceId: p.workspaceId, id: p.id, agora })
  if (comercial.regerou) throw new ErroAssistido(409, 'O preço mudou ou não pode ser confirmado: o vídeo está sendo gerado de novo sem o valor e volta para você aprovar.')
  if (comercial.indisponivel) throw new ErroAssistido(409, 'A fonte oficial diz que o produto está indisponível agora: não dá para publicar.')
  const a = await lerAssistida(p.workspaceId, p.id)
  if (a.estado !== 'APROVADO' && a.estado !== 'FALHOU') throw new ErroAssistido(409, `Esta publicação está em "${a.estado}".`)
  // P2.27: depois de um ENVIO INCERTO, tentar de novo pode duplicar o vídeo no perfil. Só com a conferência explícita.
  if (a.estado === 'FALHOU' && (a.erro ?? '').startsWith('ENVIO INCERTO') && !p.conferiuOPerfil) {
    throw new ErroAssistido(409, 'O último envio ficou sem confirmação: confira o seu perfil no TikTok. Se o vídeo NÃO está lá, confirme "conferi o perfil" para tentar de novo.')
  }
  if (p.conferiuOPerfil) await registrarAuditoria({ workspaceId: p.workspaceId, userId: p.userId, action: 'tiktok.assistido_conferiu_perfil', entityType: 'PublicacaoAssistida', entityId: a.id, metadata: { erroAnterior: (a.erro ?? '').slice(0, 300) } })
  // P2.45 — REGRA DEFINITIVA: nada é LIBERADO para publicação sem os TRÊS controles (técnico, comercial, conformidade
  // da plataforma). A aprovação da titular fica registrada; a liberação espera. Em Production não há como desligar.
  // Dispensa SÓ para os testes legados do fluxo anterior (marcada no próprio processo de teste); nunca em Production.
  const { dispensaLegadaAtiva, hashDoTexto } = await import('./arquivo-aprovado-vinculo')
  const dispensaLegada = dispensaLegadaAtiva(p.env ?? process.env)
  let fixado: import('./arquivo-aprovado').ArquivoFixado | null = null
  if (!dispensaLegada) {
    const lib = await liberacaoDoArquivoAPublicar(a, p.portasDoArquivo)
    if (!lib.liberado) {
      const bloqueio = `PUBLICAÇÃO RETIDA — faltam controles obrigatórios (três controles + barreira profissional): ${lib.motivos.join(' ')}`.slice(0, 1000)
      if (a.bloqueio !== bloqueio) await prisma.publicacaoAssistida.updateMany({ where: { id: a.id, workspaceId: p.workspaceId, estado: a.estado }, data: { bloqueio } })
      // revisão P2.69+ (3ª rodada, achado 1): retida, nenhum arquivo de liberação anterior continua valendo
      await prisma.$executeRaw`UPDATE "PublicacaoAssistida" SET "apresentacao" = jsonb_set(COALESCE("apresentacao", '{}'::jsonb), '{arquivoAprovado}', 'null'::jsonb, true) WHERE "id" = ${a.id} AND "workspaceId" = ${p.workspaceId} AND "apresentacao" ? 'arquivoAprovado'`
      return lerAssistida(p.workspaceId, a.id)
    }
    fixado = lib.fixado
    // registra o arquivo aprovado imutável (sha + caminho): é ELE que a titular baixa na versão narrada e o que o canal recebe
    // jsonb_set: só a chave arquivoAprovado muda (não regrava a apresentação lida antes — revisão, achado 17)
    // a versão e a escolha (ORIGINAL/NARRADA) ficam no registro: só vale enquanto forem as atuais
    const escolha = (a.apresentacao as { versaoEscolhida?: string } | null)?.versaoEscolhida === 'NARRADA' ? 'NARRADA' : 'ORIGINAL'
    const apOrigem = (a.apresentacao ?? {}) as { video?: { arquivo?: string | null }; narracao?: { videoPath?: string | null } | null }
    const origem = escolha === 'NARRADA' ? apOrigem.narracao?.videoPath ?? null : apOrigem.video?.arquivo ?? null
    // revisão P2.72 (MÉDIA 2): o texto comercial aprovado (legenda da versão final) fica preso ao mesmo registro
    const { hashDoTexto } = await import('./arquivo-aprovado-vinculo')
    const legendaAprovada = ((a.versaoFinal as unknown as VersaoDoVideo | null) ?? versaoAtual(a))?.legenda ?? ''
    const registro = JSON.stringify(fixado ? { sha256: fixado.sha256, caminho: fixado.caminho, tamanho: fixado.tamanho, versao: a.versao, versaoEscolhida: escolha, origem, textoSha256: hashDoTexto(legendaAprovada) } : null)
    const gravou = await prisma.$executeRaw`UPDATE "PublicacaoAssistida" SET "apresentacao" = jsonb_set(COALESCE("apresentacao", '{}'::jsonb), '{arquivoAprovado}', ${registro}::jsonb, true), "updatedAt" = NOW() WHERE "id" = ${a.id} AND "workspaceId" = ${p.workspaceId} AND "estado"::text = ${a.estado}`
    if (gravou !== 1) throw new ErroAssistido(409, 'Esta publicação mudou durante a liberação. Atualize a tela.')
  }
  // P2.33.1: a versão NARRADA (voz da titular, arquivo privado) nunca vai pela API: a própria titular baixa e
  // publica no app (assistido). Nada é enviado; a publicação fica aprovada esperando o link.
  if ((a.apresentacao as { versaoEscolhida?: string } | null)?.versaoEscolhida === 'NARRADA') {
    return prisma.publicacaoAssistida.update({
      where: { id: a.id },
      data: { estado: 'APROVADO', bloqueio: 'Versão narrada: baixe o vídeo narrado (Operação → ouvir a narração) e publique pelo app do TikTok. Depois cole o link.', erro: null },
    })
  }
  // P2.35: vídeo em armazenamento PRIVADO nunca vai pela API (exigiria link público): a titular baixa pela
  // Operação (link temporário) e publica no app. Nada é enviado; fica aprovado esperando o link do post.
  const { ehRefPrivada } = await import('./midia-privada')
  if (ehRefPrivada(((a.apresentacao ?? {}) as { video?: { arquivo?: string | null } }).video?.arquivo ?? null, p.env ?? process.env)) {
    return prisma.publicacaoAssistida.update({
      where: { id: a.id },
      data: { estado: 'APROVADO', bloqueio: 'Vídeo em armazenamento privado: baixe pela Operação (o link vale alguns minutos) e publique pelo app do TikTok. Depois cole o link.', erro: null },
    })
  }
  const final = (a.versaoFinal as unknown as VersaoDoVideo | null) ?? versaoAtual(a)
  const conteudoId = await garantirConteudo(a, p.userId, final, fixado)
  const historico = historicoDe(a.historico)
  const tentativa = historico.filter((h) => h.acao === 'PUBLICACAO').length + 1
  // P2.27: CLAIM atômico antes de falar com o TikTok. Duas abas / duplo clique: só uma passa; a outra recebe 409.
  // A intenção fica gravada (PUBLICANDO + histórico) ANTES do envio: se o processo morrer no meio, a reentrada
  // não reenvia — a reconciliação (acompanhamento ou link colado) decide.
  const intencao = { em: agora.toISOString(), versao: a.versao, acao: 'PUBLICACAO', detalhe: `tentativa ${tentativa} iniciada` }
  const reivindicou = await prisma.publicacaoAssistida.updateMany({
    where: { id: a.id, workspaceId: p.workspaceId, estado: a.estado },
    data: { estado: 'PUBLICANDO', erro: null, historico: [...historico, intencao] as unknown as Prisma.InputJsonValue },
  })
  if (reivindicou.count !== 1) throw new ErroAssistido(409, 'Esta publicação acabou de ser enviada por outra ação. Atualize a tela.')
  const estadoAnterior = a.estado
  const env = p.env ?? process.env
  // P2.20: a quota da plataforma é decidida num lugar só (avaliarPermissaoDaAcao). Só regra confirmada bloqueia.
  const acaoId = `publicacaoAssistida:${a.id}`
  // Nada foi enviado ainda: qualquer erro até aqui devolve o estado anterior (sem travar em PUBLICANDO).
  const devolver = () => prisma.publicacaoAssistida.updateMany({ where: { id: a.id, workspaceId: p.workspaceId, estado: 'PUBLICANDO' }, data: { estado: estadoAnterior, historico: historico as unknown as Prisma.InputJsonValue } })
  let cota: Awaited<ReturnType<typeof reservarCota>>
  try {
    cota = await reservarCota({ workspaceId: p.workspaceId, acao: tipoDaPublicacao(a), acaoId, agora })
  } catch (e) {
    await devolver()
    throw e
  }
  if (!cota.reservou && cota.resultado === 'BLOQUEADA') {
    await devolver()
    throw new ErroAssistido(409, cota.motivo)
  }
  let r: Awaited<ReturnType<typeof distribuirConteudo>>
  try {
    r = await distribuirConteudo({
      workspaceId: p.workspaceId,
      contentId: conteudoId,
      canal: 'tiktok',
      chaveDaTentativa: `assistida:${a.id}:t${tentativa}`,
      adaptadores: adaptadoresHabilitados(env),
      env,
      opcoesDoCanal: p.privacidade ? { privacidade: p.privacidade } : null,
      // P2.69+: sem a dispensa legada, só sai o arquivo do caminho imutável do sha256 liberado
      ...(dispensaLegada ? {} : { arquivoAprovadoSha256: fixado?.sha256 ?? null }),
    })
  } catch (e) {
    // A exceção escapou depois de começar o envio: não sabemos se saiu. Incerto (não repete sozinho).
    r = { ok: false, aguardar: false, envioIncerto: true, estado: null, acao: null, publicacaoId: null, publicacaoExternaId: null, rastreada: false, registroConfirmado: false, motivoDaEspera: null, erroFatal: false, explicacao: `Erro durante o envio: ${higienizar(e instanceof Error ? e.message : String(e))}`, veredito: null }
  }
  historico.push({ em: agora.toISOString(), versao: a.versao, acao: 'PUBLICACAO', detalhe: higienizar(r.explicacao) })
  // Enviado (ou envio incerto: pode ter ido ao ar) consome; não enviado devolve a vaga.
  if (r.ok || r.envioIncerto) await confirmarCota({ workspaceId: p.workspaceId, acaoId })
  else await liberarCota({ workspaceId: p.workspaceId, acaoId })

  if (r.ok && r.aguardandoConfirmacao) {
    return prisma.publicacaoAssistida.update({
      where: { id: a.id },
      data: { estado: 'PUBLICANDO', publicacaoId: r.publicacaoId, publishId: r.referenciaPendente ?? null, modoDePublicacao: r.acao === 'DRAFT' ? 'API_RASCUNHO' : 'API_DIRETO', bloqueio: null, erro: null, historico: historico as unknown as Prisma.InputJsonValue },
    })
  }
  if (r.ok) {
    await prisma.publicacaoAssistida.update({ where: { id: a.id }, data: { publicacaoId: r.publicacaoId, historico: historico as unknown as Prisma.InputJsonValue } })
    return concluirPublicacaoAssistida({ workspaceId: p.workspaceId, id: a.id, postId: r.publicacaoExternaId, url: null, modo: r.acao === 'DRAFT' ? 'API_RASCUNHO' : 'API_DIRETO', agora })
  }
  if (r.aguardar) {
    return prisma.publicacaoAssistida.update({
      where: { id: a.id },
      data: { estado: 'APROVADO', bloqueio: await motivoDoBloqueio(p.workspaceId, r.explicacao, temVideoGerado(a)), historico: historico as unknown as Prisma.InputJsonValue },
    })
  }
  historico.push({ em: agora.toISOString(), versao: a.versao, acao: 'FALHOU', detalhe: higienizar(r.explicacao) })
  return prisma.publicacaoAssistida.update({
    where: { id: a.id },
    data: {
      estado: 'FALHOU',
      publicacaoId: r.publicacaoId,
      erro: r.envioIncerto ? `ENVIO INCERTO — confira o seu perfil no TikTok antes de tentar de novo. ${higienizar(r.explicacao)}` : higienizar(r.explicacao),
      historico: historico as unknown as Prisma.InputJsonValue,
    },
  })
}

/**
 * Publicação confirmada (id do vídeo): ordem 1..10, resultado criado para o
 * aprendizado (métricas NULL até serem medidas).
 */
export async function concluirPublicacaoAssistida(p: { workspaceId: string; id: string; postId: string | null; url: string | null; modo: 'API_RASCUNHO' | 'API_DIRETO' | 'MANUAL_PELA_TITULAR'; agora?: Date }) {
  const agora = p.agora ?? new Date()
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    try {
      const feito = await prisma.$transaction(async (tx) => {
        const a = await tx.publicacaoAssistida.findFirst({ where: { id: p.id, workspaceId: p.workspaceId } })
        if (!a) throw new ErroAssistido(404, 'Publicação não encontrada.')
        if (a.estado === 'PUBLICADO') return a
        if (a.demonstracao) throw new ErroAssistido(409, 'Demonstração em teste não é publicação.')
        // P2.50 (P4): o estado é conferido DENTRO da transação — se o vídeo foi regerado/reaberto no meio, não conclui.
        if (!['APROVADO', 'PUBLICANDO', 'FALHOU'].includes(a.estado)) throw new ErroAssistido(409, `Esta publicação mudou para "${a.estado}" enquanto o registro acontecia. Atualize a tela.`)
        const ordem = (await tx.publicacaoAssistida.count({ where: { workspaceId: p.workspaceId, demonstracao: false, estado: 'PUBLICADO' } })) + 1
        const final = (a.versaoFinal as unknown as VersaoDoVideo | null) ?? versaoAtual(a)
        const ap = a.apresentacao as unknown as { produto: { categoria: string | null } }
        const historico = historicoDe(a.historico)
        historico.push({ em: agora.toISOString(), versao: a.versao, acao: 'PUBLICADO', detalhe: p.modo, comercial: (a.apresentacao as unknown as { comercial?: unknown }).comercial ?? null })
        const atualizado = await tx.publicacaoAssistida.update({
          where: { id: a.id },
          data: { estado: 'PUBLICADO', ordem, postId: p.postId, urlPublicada: p.url, modoDePublicacao: p.modo, publicadoEm: agora, bloqueio: null, erro: null, historico: historico as unknown as Prisma.InputJsonValue },
        })
        await tx.videoTikTokResultado.upsert({
          where: { publicacaoAssistidaId: a.id },
          create: {
            workspaceId: p.workspaceId, publicacaoAssistidaId: a.id, produtoId: a.produtoId, candidatoId: a.candidatoId, conteudoId: a.conteudoId, nomeProduto: a.nomeProduto,
            categoria: ap.produto.categoria, estrutura: final.estrutura, gancho: final.gancho, cta: final.cta.includes('Salva') ? 'B' : 'A', ctaTexto: final.cta,
            duracaoSegundos: final.duracaoSegundos, publicadoEm: agora, urlDoVideo: p.url, postId: p.postId, metasIds: a.metasIds, origemMetricas: 'MANUAL', canal: a.canal,
            // P2.21: DNA criativo do que foi publicado (gancho classificado; mídia/formato do render).
            ...dnaDaAssistida(a, final),
          },
          update: { postId: p.postId, urlDoVideo: p.url },
        })
        return atualizado
      })
      // P2.22: publicado por qualquer caminho (API ou manual) gera CONTENT_PUBLISHED uma vez (mesma chave do registro manual).
      if (feito.estado === 'PUBLICADO') await registrarEvento({ workspaceId: p.workspaceId, tipo: 'CONTENT_PUBLISHED', chaveIdempotencia: `assistida:${feito.id}:publicada`, entidadeTipo: 'PublicacaoAssistida', entidadeId: feito.id, payload: { produto: feito.nomeProduto, modo: feito.modoDePublicacao ?? p.modo } })
      return feito
    } catch (e) {
      // Duas confirmações ao mesmo tempo disputam a mesma ordem: tenta de novo.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue
      throw e
    }
  }
  throw new ErroAssistido(409, 'Não consegui registrar a ordem desta publicação; tente de novo.')
}

const URL_DO_TIKTOK = /^https:\/\/(?:www\.|m\.|vm\.|vt\.)?tiktok\.com\/.+/i

/**
 * Contingência por limitação oficial: a titular publicou pelo app (rascunho
 * finalizado ou envio bloqueado) e informa o link do vídeo.
 */
/**
 * P2.18 — PATRONO FAZ → CRISTIANE APROVA → PATRONO CONTINUA: registrado o
 * link da publicação, o Patrono já prepara a próxima (escolhe o produto,
 * roteiro, checagem; gera o vídeo se houver mídia autorizada). Nunca publica.
 * Sem produto viável agora, a publicação fica registrada e nada mais muda.
 */
export async function registrarPublicacaoManualEContinuar(p: { workspaceId: string; userId: string; id: string; url: string; agora?: Date; origem?: string; confirmoPublicacaoRetida?: boolean }) {
  const publicada = await registrarPublicacaoManual(p)
  const proxima = await prepararProximaPublicacao({ workspaceId: p.workspaceId, userId: p.userId, origem: p.origem }).catch((e) => {
    log('info', 'assistido.proxima_nao_preparada', { motivo: e instanceof Error ? e.message.slice(0, 200) : String(e) })
    return null
  })
  return { publicada, proxima }
}

export async function registrarPublicacaoManual(p: { workspaceId: string; userId: string; id: string; url: string; agora?: Date; som?: string | null; confirmoPublicacaoRetida?: boolean; portasDoArquivo?: import('./arquivo-aprovado').PortasDoArquivoAprovado }) {
  const url = p.url.trim()
  if (!URL_DO_TIKTOK.test(url)) throw new ErroAssistido(400, 'Cole o link do vídeo no TikTok (https://www.tiktok.com/@…/video/…).')
  const a = await lerAssistida(p.workspaceId, p.id)
  if (a.demonstracao) throw new ErroAssistido(409, 'Demonstração em teste não é publicação.')
  // P2.18.5: FALHOU também aceita — é o fallback da publicação automática para a assistida (a titular publica no app e cola o link).
  if (a.estado !== 'APROVADO' && a.estado !== 'PUBLICANDO' && a.estado !== 'FALHOU') throw new ErroAssistido(409, `Só uma publicação aprovada pode ser registrada como publicada (está em "${a.estado}").`)
  // P2.50 (A1): vídeo RETIDO pelos três controles/campanha não vira "publicado" por engano. Se a titular publicou mesmo
  // assim no app, ela confirma explicitamente — o registro reflete a realidade e fica auditado como exceção.
  const dispensaLegada = (await import('./arquivo-aprovado-vinculo')).dispensaLegadaAtiva()
  if (!dispensaLegada) {
    // P2.72: a mesma liberação da publicação (sha256 recalculado do arquivo), não o sha gravado na geração. Com o
    // arquivo aprovado desta versão já fixado, vale ele (refixar a cada "publiquei" retinha por falha de rede)
    const { registroDoArquivoValido } = await import('./arquivo-aprovado')
    const lib = registroDoArquivoValido(a) ? { liberado: true, motivos: [] as string[] } : await liberacaoDoArquivoAPublicar(a, p.portasDoArquivo)
    if (!lib.liberado && !p.confirmoPublicacaoRetida) throw new ErroAssistido(409, 'Este vídeo está RETIDO (' + lib.motivos.join(' ') + '). Se você já publicou mesmo assim, confirme "publiquei apesar da retenção" para registrar.')
    if (!lib.liberado) await registrarAuditoria({ workspaceId: p.workspaceId, userId: p.userId, action: 'tiktok.assistido_publicado_apesar_de_retido', entityType: 'PublicacaoAssistida', entityId: a.id, metadata: { motivos: lib.motivos.slice(0, 8) } })
  }
  const postId = url.match(/\/video\/(\d{8,25})/)?.[1] ?? null
  // P2.50 (P2): o mesmo vídeo do TikTok não conta como duas publicações.
  if (postId) {
    const outra = await prisma.publicacaoAssistida.findFirst({ where: { workspaceId: p.workspaceId, postId, id: { not: a.id } }, select: { nomeProduto: true } })
    if (outra) throw new ErroAssistido(409, 'Este link já está registrado em outra publicação (' + outra.nomeProduto + '). Confira o link do vídeo deste produto.')
  }
  const modo = a.estado === 'PUBLICANDO' && a.modoDePublicacao === 'API_RASCUNHO' ? 'API_RASCUNHO' : 'MANUAL_PELA_TITULAR'
  // Rascunho enviado pelo Patrono e finalizado no app: a Publicacao da porta única também é confirmada.
  if (a.publicacaoId && postId) {
    const pub = await prisma.publicacao.findFirst({ where: { id: a.publicacaoId, workspaceId: p.workspaceId }, select: { estado: true } })
    if (pub?.estado === 'DISTRIBUINDO') await confirmarDistribuicao({ workspaceId: p.workspaceId, publicacaoId: a.publicacaoId, publicacaoExternaId: postId, distribuidaEm: p.agora ?? new Date(), confirmadoPor: 'TITULAR' })
  }
  const r = await concluirPublicacaoAssistida({ workspaceId: p.workspaceId, id: a.id, postId, url, modo, agora: p.agora })
  // P2.20: publicado no app é FATO — conta na quota do dia (sem bloquear o que já aconteceu; idempotente com a reserva da API).
  await reservarCota({ workspaceId: p.workspaceId, acao: tipoDaPublicacao(a), acaoId: `publicacaoAssistida:${a.id}`, agora: p.agora, jaExecutada: true })
  await confirmarCota({ workspaceId: p.workspaceId, acaoId: `publicacaoAssistida:${a.id}` })
  await registrarAuditoria({ workspaceId: p.workspaceId, userId: p.userId, action: 'tiktok.assistido_publicado_informado', entityType: 'PublicacaoAssistida', entityId: a.id, metadata: { modo, temPostId: !!postId } })
  await registrarEvento({ workspaceId: p.workspaceId, tipo: 'CONTENT_PUBLISHED', chaveIdempotencia: `assistida:${a.id}:publicada`, entidadeTipo: 'PublicacaoAssistida', entidadeId: a.id, payload: { produto: a.nomeProduto, modo } })
  // P2.32: o som que ela usou no app (informado por ela — não é confirmação da plataforma) entra no histórico.
  const { normalizarSomUsado } = await import('./trilha-sonora')
  const som = normalizarSomUsado(p.som)
  if (som) {
    const atual = await prisma.publicacaoAssistida.findFirst({ where: { id: a.id, workspaceId: p.workspaceId }, select: { apresentacao: true } })
    await prisma.publicacaoAssistida.update({ where: { id: a.id }, data: { apresentacao: { ...((atual?.apresentacao ?? {}) as object), somUsado: { texto: som, fonte: 'INFORMADO_PELA_TITULAR', informadoEm: (p.agora ?? new Date()).toISOString() } } as unknown as Prisma.InputJsonValue } })
  }
  return r
}

// ── Relatório "Pronto para automação plena?" ───────────────────────────

export interface RelatorioDeTransicao {
  concluidas: number
  limite: number
  final: boolean
  aprovadasDePrimeira: number
  ajustesPedidos: number
  rejeicoes: number
  falhas: number
  enviosIncertos: number
  checagensReprovadas: number
  bloqueiosDeCompliance: number
  publicacoesPorModo: Record<string, number>
  intervaloMedioHoras: number | null
  porFaixaDeHorario: Record<string, number>
  produtosRepetidos: { produto: string; vezes: number }[]
  resultados: ReturnType<typeof agregar>
  recomendacao: 'MANTER ASSISTIDO' | 'APTO PARA AUTOMAÇÃO' | null
  motivos: string[]
  /** Sempre false: a recomendação nunca ativa nada. A titular decide. */
  ativaAutomacao: false
}

export async function relatorioDeTransicao(workspaceId: string): Promise<RelatorioDeTransicao> {
  const todas = await prisma.publicacaoAssistida.findMany({ where: { workspaceId, demonstracao: false }, orderBy: { createdAt: 'asc' } })
  const publicadas = todas.filter((a) => a.estado === 'PUBLICADO').sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
  const hist = todas.flatMap((a) => historicoDe(a.historico))
  const resultados = await prisma.videoTikTokResultado.findMany({ where: { workspaceId, publicacaoAssistidaId: { in: publicadas.map((a) => a.id) } } })
  const datas = publicadas.map((a) => a.publicadoEm).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())
  const intervalos = datas.slice(1).map((d, i) => (d.getTime() - datas[i].getTime()) / 3_600_000)
  const porProduto = new Map<string, number>()
  for (const a of publicadas) porProduto.set(a.nomeProduto, (porProduto.get(a.nomeProduto) ?? 0) + 1)
  const porFaixa: Record<string, number> = {}
  for (const d of datas) porFaixa[faixaDeHorario(d)] = (porFaixa[faixaDeHorario(d)] ?? 0) + 1
  const porModo: Record<string, number> = {}
  for (const a of publicadas) porModo[a.modoDePublicacao ?? '?'] = (porModo[a.modoDePublicacao ?? '?'] ?? 0) + 1

  const r: Omit<RelatorioDeTransicao, 'recomendacao' | 'motivos'> = {
    concluidas: publicadas.length,
    limite: LIMITE_ASSISTIDO,
    final: publicadas.length >= LIMITE_ASSISTIDO,
    aprovadasDePrimeira: publicadas.filter((a) => a.aprovadoDePrimeira).length,
    ajustesPedidos: hist.filter((h) => h.acao === 'AJUSTE_PEDIDO').length,
    rejeicoes: todas.filter((a) => a.estado === 'REJEITADO' && !encerradaPorProdutoInativo(a)).length,
    falhas: hist.filter((h) => h.acao === 'FALHOU').length,
    enviosIncertos: todas.filter((a) => (a.erro ?? '').startsWith('ENVIO INCERTO')).length,
    checagensReprovadas: hist.filter((h) => h.acao === 'QUALITY_GATE' && h.veredito !== 'APROVADO').length,
    bloqueiosDeCompliance: hist.filter((h) => h.acao === 'QUALITY_GATE' && h.veredito === 'BLOQUEADO').length,
    publicacoesPorModo: porModo,
    intervaloMedioHoras: intervalos.length ? Math.round((intervalos.reduce((s, x) => s + x, 0) / intervalos.length) * 10) / 10 : null,
    porFaixaDeHorario: porFaixa,
    produtosRepetidos: [...porProduto.entries()].map(([produto, vezes]) => ({ produto, vezes })).sort((a, b) => b.vezes - a.vezes),
    resultados: agregar(resultados.map((l) => ({ views: l.views, cliquesProduto: l.cliquesProduto, adicoesCarrinho: l.adicoesCarrinho, vendas: l.vendas, comissao: l.comissao, receita: l.receita }))),
    ativaAutomacao: false,
  }
  if (!r.final) return { ...r, recomendacao: null, motivos: [`Modo assistido: ${r.concluidas}/${LIMITE_ASSISTIDO}. A recomendação sai na 10ª publicação confirmada.`] }

  const motivos: string[] = []
  const taxaPrimeira = r.aprovadasDePrimeira / r.concluidas
  if (r.falhas > 0) motivos.push(`${r.falhas} falha(s) de publicação.`)
  if (r.enviosIncertos > 0) motivos.push(`${r.enviosIncertos} envio(s) incerto(s).`)
  if (taxaPrimeira < 0.7) motivos.push(`Só ${Math.round(taxaPrimeira * 100)}% aprovadas de primeira (mínimo 70%).`)
  if (r.rejeicoes > 2) motivos.push(`${r.rejeicoes} rejeições.`)
  if (r.bloqueiosDeCompliance > 0) motivos.push(`${r.bloqueiosDeCompliance} bloqueio(s) de compliance na checagem.`)
  if (r.resultados.videosMedidos < 5) motivos.push(`Só ${r.resultados.videosMedidos} vídeo(s) com métricas: pouca evidência de resultado.`)
  const apto = motivos.length === 0
  return {
    ...r,
    recomendacao: apto ? 'APTO PARA AUTOMAÇÃO' : 'MANTER ASSISTIDO',
    motivos: apto
      ? [`${Math.round(taxaPrimeira * 100)}% aprovadas de primeira, nenhuma falha, sem compliance. A decisão de ativar é sua: nada foi ligado.`]
      : [...motivos, 'Recomendação: manter assistido. Nada foi alterado.'],
  }
}

// ── Painel ──────────────────────────────────────────────────────────────

export async function painelAssistido(workspaceId: string) {
  const temPendente = await prisma.publicacaoAssistida.count({ where: { workspaceId, demonstracao: false, estado: 'PUBLICANDO' } })
  if (temPendente) await acompanharPublicacoesTikTok({ workspaceId }).catch(() => null)
  // P2.17.16 (P1 pós-aprovação): views oficiais entram sozinhas — só com a flag ligada (app aprovado + conectado).
  if (configuracaoDoColetor().ligado) await coletarMetricasOficiais({ workspaceId }).catch(() => null)
  const [itens, canal, relatorio] = await Promise.all([
    prisma.publicacaoAssistida.findMany({ where: { workspaceId, demonstracao: false }, orderBy: { updatedAt: 'desc' }, take: 25 }),
    estadoDoCanalTikTok(workspaceId),
    relatorioDeTransicao(workspaceId),
  ])
  const porEstado: Record<string, number> = {}
  for (const i of itens) porEstado[i.estado] = (porEstado[i.estado] ?? 0) + 1
  return {
    limite: LIMITE_ASSISTIDO,
    concluidas: relatorio.concluidas,
    porEstado,
    canal,
    atual: itens.find((i) => EM_ANDAMENTO.includes(i.estado as EstadoAssistido)) ?? null,
    itens: itens.map((i) => ({
      id: i.id, ordem: i.ordem, estado: i.estado, versao: i.versao, nomeProduto: i.nomeProduto, estrutura: i.estrutura, apresentacao: i.apresentacao, qualityGate: i.qualityGate,
      status: statusReal(i), historico: historicoDe(i.historico), aprovadoDePrimeira: i.aprovadoDePrimeira, motivoEscolha: i.motivoEscolha, objetivoDoTeste: i.objetivoDoTeste,
      vezesQueOProdutoApareceu: i.vezesQueOProdutoApareceu, horarioPlanejado: i.horarioPlanejado?.toISOString() ?? null, modoDePublicacao: i.modoDePublicacao,
      bloqueio: i.bloqueio, erro: i.erro, urlPublicada: i.urlPublicada, postId: i.postId, publicadoEm: i.publicadoEm?.toISOString() ?? null,
    })),
    relatorio,
    exigeExperienciaReal: [...EXIGE_EXPERIENCIA],
  }
}
