/**
 * Métricas reais de clique e conversão (P0.3).
 *
 * ── O QUE A AUDITORIA ENCONTROU ─────────────────────────────────────────
 * `Conteudo.cliquesLink` NUNCA é escrito por código de produção — só por
 * fixtures de teste. Em operação ele vale 0 para sempre. Como
 * `calcularConversaoHistoricaPorCategoria()` dividia vendas por ele, a
 * feature `historical_conversion_rate` era `null` em 100% dos casos reais.
 *
 * Enquanto isso, `EventoLink` registra clique a clique, com workspace, link
 * e carimbo de tempo — é o log real, e estava sendo ignorado.
 *
 * ── UMA VERDADE, UMA FONTE ──────────────────────────────────────────────
 * `EventoLink` passa a ser a fonte primária de clique. Nenhum contador
 * incremental paralelo: contador que ninguém incrementa mente em silêncio,
 * e contador que alguém precisa lembrar de atualizar é trabalho manual
 * recorrente — dívida de automação, não métrica.
 *
 * ── ATÉ ONDE O DADO SUSTENTA ────────────────────────────────────────────
 * Não existe relação entre `EventoLink` e `Conteudo`. O caminho é
 * `EventoLink → LinkDinamico → Produto`. Um link aponta para um PRODUTO, e
 * vários conteúdos podem falar do mesmo produto.
 *
 * Logo: clique é atribuível a PRODUTO/CATEGORIA, nunca a conteúdo. Dizer
 * "este clique veio deste vídeo" exigiria heurística, e heurística aqui
 * seria uma causalidade inventada dentro de uma feature de treino. Por isso
 * a métrica para no nível que o dado sustenta, e isso está declarado em
 * `LIMITACAO_DE_ATRIBUICAO` no fim do arquivo.
 */

import { prisma } from './prisma'
import { avaliarVendaParaOperacaoReal } from './real-operation'

/** Só este tipo de evento é clique. Qualquer outro fica de fora. */
export const TIPO_DE_EVENTO_CLIQUE = 'clique'

// ── Granularidade ───────────────────────────────────────────────────────

/**
 * Nível ao qual uma métrica se refere.
 *
 * Existe para impedir o erro mais caro deste domínio: dividir numerador e
 * denominador de níveis diferentes. "Vendas atribuídas a CONTEÚDO dividido
 * por cliques agregados por PRODUTO" produz um número que parece taxa de
 * conversão e não é nada.
 */
export const GRANULARIDADES = ['CONTEUDO', 'PRODUTO', 'CATEGORIA', 'CANAL', 'WORKSPACE'] as const
export type Granularidade = (typeof GRANULARIDADES)[number]

/**
 * Níveis em que o clique REAL consegue ser contado hoje.
 *
 * `EventoLink → LinkDinamico → Produto` sustenta PRODUTO, CATEGORIA e o
 * total do WORKSPACE.
 *
 * CONTEUDO fica de fora: o link aponta para produto, e vários conteúdos
 * divulgam o mesmo produto.
 *
 * CANAL também fica de fora, e o motivo é sutil: `EventoLink.plataforma`
 * existe, mas é a plataforma do LINK — onde ele deveria ser divulgado —, e
 * não o `Conteudo.redeSocial`, que é onde o conteúdo foi publicado. Somar
 * vendas por canal-do-conteúdo com cliques por plataforma-do-link seria
 * tratar dois campos diferentes como se fossem o mesmo, e o número
 * resultante pareceria correto.
 */
export const GRANULARIDADES_COM_CLIQUE_REAL: Granularidade[] = ['PRODUTO', 'CATEGORIA', 'WORKSPACE']

export function cliqueSuportaGranularidade(g: Granularidade): boolean {
  return GRANULARIDADES_COM_CLIQUE_REAL.includes(g)
}

/** Por que uma métrica de clique ficou indisponível. Nunca vira 0. */
export const MOTIVOS_CLIQUE_INDISPONIVEL = [
  /** Não existe atribuição EventoLink → Conteudo. */
  'SEM_ATRIBUICAO_POR_CONTEUDO',
  /** `EventoLink.plataforma` é do link, não o canal de publicação do conteúdo. */
  'SEM_ATRIBUICAO_POR_CANAL',
  /**
   * A publicação saiu com o link direto do produto (fallback da Etapa 2.a):
   * o clique não passou pelo redirect e por isso não existe em `EventoLink`.
   * Zero evento aqui NÃO é zero clique — é clique desconhecido. Ver
   * `lib/rastreamento-da-publicacao.ts`.
   */
  'INDISPONIVEL_POR_FALTA_DE_RASTREAMENTO',
] as const

export type MotivoCliqueIndisponivel = (typeof MOTIVOS_CLIQUE_INDISPONIVEL)[number]

/**
 * Divisão que nunca inventa número.
 *
 * Sem base, devolve `null` — "não sei" —, nunca `0`. Zero afirmaria que a
 * conversão foi medida e deu zero; `null` diz que não houve o que medir. A
 * diferença importa: o modelo trata `0` como sinal, e `null` como ausência.
 */
export function dividirOuNull(numerador: number, denominador: number): number | null {
  if (!Number.isFinite(numerador) || !Number.isFinite(denominador)) return null
  if (denominador <= 0) return null
  return numerador / denominador
}

export interface MetricasDeClique {
  /** Eventos de clique reais, do log. */
  cliques: number
  /** Vendas aprovadas pela autoridade de operação real. */
  vendasElegiveis: number
  /** `vendasElegiveis / cliques`. `null` quando não houve clique. */
  taxaConversao: number | null
  /** Soma do que foi efetivamente RECEBIDO nas vendas elegíveis. */
  receitaRealizada: number
  /** `receitaRealizada / cliques`. `null` quando não houve clique. */
  receitaPorClique: number | null
}

export interface JanelaDeMetrica {
  workspaceId: string
  /** Corte temporal: só conta o que aconteceu ANTES deste instante. */
  antesDe: Date
  /** Restringe a uma categoria de produto. Omitido = todas. */
  categoria?: string
  /** Restringe a um produto. Omitido = todos. */
  produtoId?: string
  /**
   * Conteúdo a EXCLUIR das vendas. Obrigatório quando a métrica vira
   * feature de um conteúdo: sem isso ele vazaria o próprio resultado.
   */
  excluirContentId?: string | null
}

function dataValida(d: unknown): d is Date {
  return d instanceof Date && Number.isFinite(d.getTime())
}

/**
 * Conta cliques REAIS no log de eventos.
 *
 * Filtra por workspace (isolamento), tipo `clique` (um evento de outro tipo
 * não é clique) e instante anterior ao corte (nada do futuro). A categoria,
 * quando informada, é resolvida pelo caminho real link → produto.
 */
export async function contarCliquesReais(janela: JanelaDeMetrica): Promise<number> {
  if (!janela?.workspaceId?.trim() || !dataValida(janela?.antesDe)) return 0
  return prisma.eventoLink.count({
    where: {
      workspaceId: janela.workspaceId,
      tipo: TIPO_DE_EVENTO_CLIQUE,
      createdAt: { lt: janela.antesDe },
      ...(janela.categoria || janela.produtoId
        ? {
            link: {
              workspaceId: janela.workspaceId,
              ...(janela.produtoId ? { produtoId: janela.produtoId } : {}),
              ...(janela.categoria ? { produto: { categoria: janela.categoria } } : {}),
            },
          }
        : {}),
    },
  })
}

interface VendaContada {
  id: string
  receitaRealizada: number
}

/**
 * Vendas que a AUTORIDADE aprova como operação real, dentro da janela.
 *
 * O filtro `dataOrigin: 'REAL_OPERATION'` na consulta é um pré-filtro, não
 * uma segunda versão da regra: a autoridade já EXIGE essa origem, então ele
 * só reduz o conjunto de candidatas, nunca amplia. Quem decide continua
 * sendo `avaliarVendaParaOperacaoReal()`, chamada uma vez por candidata —
 * inclusive para conferir evidência, comissão reconhecida e coerência de
 * workspace, que nenhuma cláusula de consulta saberia reproduzir.
 */
export async function listarVendasElegiveis(janela: JanelaDeMetrica): Promise<VendaContada[]> {
  if (!janela?.workspaceId?.trim() || !dataValida(janela?.antesDe)) return []

  const candidatas = await prisma.sale.findMany({
    where: {
      workspaceId: janela.workspaceId,
      dataOrigin: 'REAL_OPERATION',
      date: { lt: janela.antesDe },
      ...(janela.produtoId ? { productId: janela.produtoId } : {}),
      ...(janela.categoria ? { product: { categoria: janela.categoria } } : {}),
      // O próprio conteúdo nunca entra na sua própria feature histórica.
      //
      // O `OR` é necessário, não decorativo: em SQL, `contentId <> 'x'` é
      // NULL para linhas em que `contentId` é NULL, e NULL não satisfaz o
      // WHERE. Um `{ not: id }` sozinho descartaria TODAS as vendas sem
      // conteúdo — que são a maioria — e a métrica desabaria para zero.
      ...(janela.excluirContentId
        ? { OR: [{ contentId: null }, { contentId: { not: janela.excluirContentId } }] }
        : {}),
    },
    select: {
      id: true,
      commissions: { select: { status: true, receivedAmount: true } },
    },
  })

  const elegiveis: VendaContada[] = []
  for (const venda of candidatas) {
    const veredito = await avaliarVendaParaOperacaoReal(janela.workspaceId, venda.id)
    if (!veredito?.elegivel) continue
    // Receita REALIZADA: só o que foi recebido. Confirmada não é caixa.
    const receitaRealizada = venda.commissions.reduce(
      (soma, c) =>
        c.status === 'RECEIVED' && typeof c.receivedAmount === 'number' && Number.isFinite(c.receivedAmount)
          ? soma + c.receivedAmount
          : soma,
      0
    )
    elegiveis.push({ id: venda.id, receitaRealizada })
  }
  return elegiveis
}

/**
 * Métricas separadas — cliques, vendas, taxa e receita por clique.
 *
 * Os quatro números ficam distintos de propósito: uma taxa sozinha esconde
 * se ela veio de 1 clique ou de 10.000, e essa diferença decide se dá para
 * confiar nela.
 */
export async function calcularMetricasDeClique(janela: JanelaDeMetrica): Promise<MetricasDeClique> {
  const [cliques, vendas] = await Promise.all([contarCliquesReais(janela), listarVendasElegiveis(janela)])
  const receitaRealizada = vendas.reduce((s, v) => s + v.receitaRealizada, 0)
  return {
    cliques,
    vendasElegiveis: vendas.length,
    taxaConversao: dividirOuNull(vendas.length, cliques),
    receitaRealizada,
    receitaPorClique: dividirOuNull(receitaRealizada, cliques),
  }
}

export interface MetricasPorProduto extends MetricasDeClique {
  produtoId: string
  granularidade: 'PRODUTO'
}

/**
 * Métricas por PRODUTO — numerador e denominador no MESMO nível.
 *
 * Diferente do resumo por conteúdo, aqui os dois lados fecham: a venda é
 * ligada ao produto por `Sale.productId` (existe sempre), e o clique pelo
 * caminho `EventoLink → LinkDinamico → produtoId`. Nenhuma das duas pontas
 * depende de atribuição a criativo.
 *
 * É por isso que `commissionPerClick` faz sentido AQUI e não faz no resumo
 * por conteúdo: lá o numerador é de conteúdo e o denominador seria de
 * produto — níveis diferentes, número sem significado.
 */
export async function calcularMetricasPorProduto(
  workspaceId: string,
  produtoIds: string[],
  antesDe: Date = new Date()
): Promise<MetricasPorProduto[]> {
  // P2.14.5.17 — EM LOTE: os mesmos filtros de `contarCliquesReais` e
  // `listarVendasElegiveis` (por produto), em 3 consultas para todos os
  // produtos em vez de 2 por produto em sequência. A autoridade da venda
  // (`avaliarVendaParaOperacaoReal`) continua decidindo venda por venda.
  const ids = [...new Set((produtoIds ?? []).filter((id) => typeof id === 'string' && id.length > 0))]
  const janelaValida = !!workspaceId?.trim() && dataValida(antesDe)

  const cliquesPorProduto = new Map<string, number>()
  const vendasPorProduto = new Map<string, VendaContada[]>()
  if (janelaValida && ids.length > 0) {
    const [links, candidatas] = await Promise.all([
      // Mesmo caminho do clique por produto: link do workspace → produto.
      prisma.linkDinamico.findMany({
        where: { workspaceId, produtoId: { in: ids } },
        select: { id: true, produtoId: true },
      }),
      prisma.sale.findMany({
        where: { workspaceId, dataOrigin: 'REAL_OPERATION', date: { lt: antesDe }, productId: { in: ids } },
        select: { id: true, productId: true, commissions: { select: { status: true, receivedAmount: true } } },
      }),
    ])
    const produtoDoLink = new Map(links.map((l) => [l.id, l.produtoId as string]))
    if (links.length > 0) {
      const porLink = await prisma.eventoLink.groupBy({
        by: ['linkId'],
        where: { workspaceId, tipo: TIPO_DE_EVENTO_CLIQUE, createdAt: { lt: antesDe }, linkId: { in: links.map((l) => l.id) } },
        _count: { _all: true },
      })
      for (const g of porLink) {
        const pid = produtoDoLink.get(g.linkId)
        if (pid) cliquesPorProduto.set(pid, (cliquesPorProduto.get(pid) ?? 0) + g._count._all)
      }
    }
    for (const venda of candidatas) {
      // O filtro `productId in ids` já garante produto; o guard é só de tipo.
      if (!venda.productId) continue
      const veredito = await avaliarVendaParaOperacaoReal(workspaceId, venda.id)
      if (!veredito?.elegivel) continue
      const receitaRealizada = venda.commissions.reduce(
        (soma, c) =>
          c.status === 'RECEIVED' && typeof c.receivedAmount === 'number' && Number.isFinite(c.receivedAmount)
            ? soma + c.receivedAmount
            : soma,
        0
      )
      const lista = vendasPorProduto.get(venda.productId) ?? []
      lista.push({ id: venda.id, receitaRealizada })
      vendasPorProduto.set(venda.productId, lista)
    }
  }

  // Uma entrada por produto pedido, na mesma ordem (como antes).
  return (produtoIds ?? []).map((produtoId) => {
    const cliques = cliquesPorProduto.get(produtoId) ?? 0
    const vendas = vendasPorProduto.get(produtoId) ?? []
    const receitaRealizada = vendas.reduce((s, v) => s + v.receitaRealizada, 0)
    return {
      cliques,
      vendasElegiveis: vendas.length,
      taxaConversao: dividirOuNull(vendas.length, cliques),
      receitaRealizada,
      receitaPorClique: dividirOuNull(receitaRealizada, cliques),
      produtoId,
      granularidade: 'PRODUTO' as const,
    }
  })
}

/**
 * FILA DE AUTOMAÇÃO — limitação declarada, não escondida.
 *
 * O clique não se liga a conteúdo porque `LinkDinamico` aponta para produto,
 * e vários conteúdos podem divulgar o mesmo produto. Para medir conversão
 * POR CRIATIVO seria preciso um link por conteúdo (ou um parâmetro de
 * origem no redirect), o que é mudança de modelo — não de cálculo.
 *
 * Enquanto isso não existir, a métrica para em produto/categoria. É menos
 * preciso e é verdadeiro; o contrário seria mais preciso e inventado.
 */
export const LIMITACAO_DE_ATRIBUICAO = {
  chave: 'metricas:clique-por-conteudo',
  explicacao:
    'Cliques são atribuíveis a produto/categoria, nunca a um conteúdo específico: LinkDinamico aponta para produto e vários conteúdos divulgam o mesmo produto. Medir conversão por criativo exige um link por conteúdo ou um parâmetro de origem no redirect.',
  nivelSustentadoHoje: 'PRODUTO_CATEGORIA',
  /** O que fica indisponível enquanto a atribuição por criativo não existir. */
  metricasBloqueadas: [
    'taxa de conversão por conteúdo',
    'taxa de conversão por hook',
    'taxa de conversão por CTA',
    'taxa de conversão por canal de publicação',
    'cliques por visualização',
  ],
  /** O que destravaria: um link por conteúdo, ou origem no redirect. */
  destravaCom: 'LINK_POR_CONTEUDO_OU_PARAMETRO_DE_ORIGEM',
} as const

/**
 * `Conteudo.cliquesLink` é LEGADO e não deve ser lido como contagem de
 * clique. Nenhum código de produção o incrementa — em operação vale 0 —, e
 * a coluna permanece no schema só para não quebrar registros antigos.
 *
 * A contagem confiável vem de `contarCliquesReais()`.
 */
export const CLIQUES_LINK_E_LEGADO = true
