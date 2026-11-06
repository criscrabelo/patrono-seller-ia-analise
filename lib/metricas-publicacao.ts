/**
 * Métricas no nível da PUBLICAÇÃO (P1.0 — Etapa 2.d).
 *
 * ── O QUE DESTRAVOU ─────────────────────────────────────────────────────
 * Até a Etapa 2.b, `LIMITACAO_DE_ATRIBUICAO` em lib/metricas-clique.ts dizia
 * a verdade: o clique parava em produto/categoria, porque `LinkDinamico`
 * apontava para produto e vários conteúdos divulgavam o mesmo produto.
 *
 * Agora a cadeia existe e é explícita:
 *
 *   EventoLink → LinkDinamico → Publicacao → Conteudo
 *                                   ↓
 *                            canal, provider, tentativa
 *
 * Então conversão por CONTEÚDO, por CANAL e por PUBLICAÇÃO passam a ter
 * numerador e denominador no mesmo nível. `commissionPerClick` idem.
 *
 * ── O QUE **NÃO** DESTRAVOU ─────────────────────────────────────────────
 * Só o que passa pela cadeia conta. Publicação que caiu no fallback não tem
 * link, logo não tem clique observável — e ali a resposta continua `null`
 * com `INDISPONIVEL_POR_FALTA_DE_RASTREAMENTO`, nunca `0`.
 *
 * `clicksPerView` continua `null` em toda parte, e isso não é esquecimento:
 * `Conteudo.visualizacoes` não é atualizado por nenhum caminho de produção
 * nem vem de provider. Dividir clique real por visualização inventada daria
 * um número com aparência de métrica. Fica declarado em
 * `METRICAS_AINDA_INDISPONIVEIS`.
 */

import { prisma } from './prisma'
import { dividirOuNull, TIPO_DE_EVENTO_CLIQUE, type Granularidade } from './metricas-clique'
import { avaliarVendaParaOperacaoReal } from './real-operation'
import { INDISPONIVEL_POR_FALTA_DE_RASTREAMENTO } from './rastreamento-da-publicacao'

/** Estado que habilita medição. Publicação não distribuída não mede nada. */
const ESTADO_QUE_MEDE = 'DISTRIBUIDA' as const

export interface JanelaDaPublicacao {
  workspaceId: string
  /** Corte temporal: só conta o que aconteceu ANTES deste instante. */
  antesDe: Date
  /** Restringe a um conteúdo. */
  contentId?: string | null
  /** Restringe a um canal de publicação (`Publicacao.canal`). */
  canal?: string | null
  /** Restringe a uma publicação. */
  publicacaoId?: string | null
  /**
   * Conteúdo a EXCLUIR. Obrigatório quando a métrica vira feature de uma
   * publicação daquele conteúdo: sem isso ele vazaria o próprio resultado.
   */
  excluirContentId?: string | null
}

export interface MetricasDaPublicacao {
  granularidade: Granularidade
  /** Cliques que passaram por `/api/l/{slug}` de publicações rastreadas. */
  cliques: number
  vendasElegiveis: number
  /** `vendasElegiveis / cliques`. `null` sem clique. */
  saleConversionRate: number | null
  receitaRealizada: number
  /** `receitaRealizada / cliques`. `null` sem clique. */
  commissionPerClick: number | null
  /** Sempre `null`: não há contagem de visualização confiável. */
  clicksPerView: number | null
  indisponibilidade: typeof INDISPONIVEL_POR_FALTA_DE_RASTREAMENTO | null
}

function dataValida(d: unknown): d is Date {
  return d instanceof Date && Number.isFinite(d.getTime())
}

/** Filtro comum das publicações que sustentam medição. */
function ondePublicacao(j: JanelaDaPublicacao) {
  return {
    workspaceId: j.workspaceId,
    estado: ESTADO_QUE_MEDE,
    distribuidaEm: { lt: j.antesDe },
    ...(j.publicacaoId ? { id: j.publicacaoId } : {}),
    ...(j.canal ? { canal: j.canal.trim().toLowerCase() } : {}),
    ...(j.contentId ? { contentId: j.contentId } : {}),
    ...(j.excluirContentId ? { contentId: { not: j.excluirContentId } } : {}),
  }
}

/**
 * As publicações RASTREADAS da janela, com o link de cada uma.
 *
 * Só entram publicações que têm link: sem link não houve clique observável,
 * e incluí-las no denominador inventaria zeros.
 */
async function publicacoesRastreadas(
  j: JanelaDaPublicacao
): Promise<{ publicacaoIds: string[]; linkIds: string[] }> {
  const publicacoes = await prisma.publicacao.findMany({
    where: ondePublicacao(j),
    select: { id: true, link: { select: { id: true } } },
  })
  const comLink = publicacoes.filter((p) => p.link?.id)
  return {
    publicacaoIds: comLink.map((p) => p.id),
    linkIds: comLink.map((p) => p.link!.id),
  }
}

/**
 * Cliques REAIS atribuíveis às publicações da janela.
 *
 * Passa pela cadeia inteira: o evento tem de ser do tipo clique, do mesmo
 * workspace, anterior ao corte, e num link que pertence a uma publicação
 * distribuída que satisfaz o filtro.
 */
export async function contarCliquesDaPublicacao(j: JanelaDaPublicacao): Promise<number> {
  if (!j?.workspaceId?.trim() || !dataValida(j?.antesDe)) return 0
  const { linkIds } = await publicacoesRastreadas(j)
  if (linkIds.length === 0) return 0
  return prisma.eventoLink.count({
    where: {
      workspaceId: j.workspaceId,
      tipo: TIPO_DE_EVENTO_CLIQUE,
      createdAt: { lt: j.antesDe },
      linkId: { in: linkIds },
    },
  })
}

export interface VendaAtribuidaAPublicacao {
  saleId: string
  publicacaoId: string
  contentId: string
  receitaRealizada: number
}

/**
 * Vendas ELEGÍVEIS atribuídas às publicações da janela.
 *
 * A atribuição é a cadeia, e só ela:
 *
 *   Sale.clickEventId → EventoLink.linkId → LinkDinamico.publicacaoId
 *
 * Sem `clickEventId` não há atribuição a publicação nenhuma. A venda
 * continua sendo receita real — o que fica desconhecido é o criativo. Nunca
 * se aproxima por data, produto ou "era a única publicação no ar".
 *
 * Cada venda ainda passa pela AUTORIDADE ÚNICA antes de contar.
 */
export async function listarVendasAtribuidasAPublicacao(
  j: JanelaDaPublicacao
): Promise<VendaAtribuidaAPublicacao[]> {
  if (!j?.workspaceId?.trim() || !dataValida(j?.antesDe)) return []
  const { publicacaoIds } = await publicacoesRastreadas(j)
  if (publicacaoIds.length === 0) return []

  const vendas = await prisma.sale.findMany({
    where: {
      workspaceId: j.workspaceId,
      date: { lt: j.antesDe },
      // Sem clique atribuído a venda não entra: é a definição de "sem
      // atribuição", e inventar uma seria heurística.
      clickEventId: { not: null },
      clickEvent: { link: { publicacaoId: { in: publicacaoIds } } },
    },
    select: {
      id: true,
      clickEvent: { select: { link: { select: { publicacaoId: true } } } },
      commissions: { select: { status: true, receivedAmount: true } },
    },
  })

  const saida: VendaAtribuidaAPublicacao[] = []
  for (const v of vendas) {
    const veredito = await avaliarVendaParaOperacaoReal(j.workspaceId, v.id)
    if (!veredito?.elegivel) continue

    const publicacaoId = v.clickEvent?.link?.publicacaoId
    if (!publicacaoId) continue
    const pub = await prisma.publicacao.findUnique({
      where: { id: publicacaoId },
      select: { contentId: true },
    })
    if (!pub) continue

    // Receita EFETIVA: só o que está em RECEIVED é dinheiro.
    const receitaRealizada = (v.commissions ?? [])
      .filter((c) => c.status === 'RECEIVED')
      .reduce((s, c) => s + (typeof c.receivedAmount === 'number' ? c.receivedAmount : 0), 0)

    saida.push({ saleId: v.id, publicacaoId, contentId: pub.contentId, receitaRealizada })
  }
  return saida
}

/**
 * Métricas de uma janela, no nível que a cadeia sustenta.
 *
 * Sem publicação rastreada na janela, devolve tudo `null` com o marcador —
 * nunca zero. Zero afirmaria que houve medição.
 */
export async function calcularMetricasDaPublicacao(
  j: JanelaDaPublicacao,
  granularidade: Granularidade = 'CONTEUDO'
): Promise<MetricasDaPublicacao> {
  const vazio: MetricasDaPublicacao = {
    granularidade,
    cliques: 0,
    vendasElegiveis: 0,
    saleConversionRate: null,
    receitaRealizada: 0,
    commissionPerClick: null,
    clicksPerView: null,
    indisponibilidade: INDISPONIVEL_POR_FALTA_DE_RASTREAMENTO,
  }
  if (!j?.workspaceId?.trim() || !dataValida(j?.antesDe)) return vazio

  const { linkIds } = await publicacoesRastreadas(j)
  if (linkIds.length === 0) return vazio

  const [cliques, vendas] = await Promise.all([
    contarCliquesDaPublicacao(j),
    listarVendasAtribuidasAPublicacao(j),
  ])
  const receitaRealizada = vendas.reduce((s, v) => s + v.receitaRealizada, 0)

  return {
    granularidade,
    cliques,
    vendasElegiveis: vendas.length,
    saleConversionRate: dividirOuNull(vendas.length, cliques),
    receitaRealizada,
    commissionPerClick: dividirOuNull(receitaRealizada, cliques),
    // Ver METRICAS_AINDA_INDISPONIVEIS.
    clicksPerView: null,
    indisponibilidade: null,
  }
}

/** Conversão por CANAL — agora o canal é da publicação, não do link. */
export async function calcularMetricasPorCanal(
  workspaceId: string,
  canal: string,
  antesDe: Date,
  excluirContentId?: string | null
): Promise<MetricasDaPublicacao> {
  return calcularMetricasDaPublicacao(
    { workspaceId, canal, antesDe, excluirContentId: excluirContentId ?? null },
    'CANAL'
  )
}

/** Conversão por CONTEÚDO — o criativo, somando todas as publicações dele. */
export async function calcularMetricasPorConteudo(
  workspaceId: string,
  contentId: string,
  antesDe: Date
): Promise<MetricasDaPublicacao> {
  return calcularMetricasDaPublicacao({ workspaceId, contentId, antesDe }, 'CONTEUDO')
}

/**
 * O que continua indisponível, e por quê. Declarado, não escondido.
 */
export const METRICAS_AINDA_INDISPONIVEIS = {
  clicksPerView: {
    porque:
      'Conteudo.visualizacoes não é atualizado por nenhum caminho de produção nem vem de provider. Dividir clique real por visualização inventada produziria um número com cara de métrica.',
    destravaCom: 'INSIGHTS_DO_PROVIDER',
  },
  cliqueEmPublicacaoSemLink: {
    porque:
      'Publicação que caiu no fallback não passou pelo redirect. Zero evento ali é clique DESCONHECIDO, não clique zero.',
    destravaCom: 'PUBLIC_BASE_URL_CONFIGURADA',
  },
  atribuicaoSemClickEventId: {
    porque:
      'Venda sem clickEventId não tem cadeia até a publicação. A receita é real; o criativo é que fica desconhecido.',
    destravaCom: 'PROVIDER_QUE_INFORME_A_ORIGEM_DA_VENDA',
  },
} as const
