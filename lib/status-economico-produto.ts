/**
 * P2.17.10 — Status ECONÔMICO do produto, calculado por evidência. FUNÇÃO PURA.
 *
 *   TESTANDO · PROMISSOR · ESCALAR · PAUSAR · ENCERRADO
 *
 * Nunca é manual por padrão e nunca decide com amostra pequena: sem o mínimo
 * de vídeos medidos, o produto continua TESTANDO (exceto bloqueios objetivos:
 * indisponível, risco alto, compliance). Os limites são HEURÍSTICAS
 * DECLARADAS (hipótese a calibrar com os dados da conta), não regra do TikTok.
 */
import { agregar, type AgregadoDeProduto, type MetricasBrutas, metricasDerivadas } from './metricas-economicas'
import { AMOSTRA_MINIMA, VIEWS_MINIMAS } from './aprendizado-videos-tiktok'

export const STATUS_ECONOMICOS = ['TESTANDO', 'PROMISSOR', 'ESCALAR', 'PAUSAR', 'ENCERRADO'] as const
export type StatusEconomico = (typeof STATUS_ECONOMICOS)[number]

/** Heurísticas declaradas (classe C — hipótese a testar). */
export const LIMITES_DO_STATUS = {
  videosMedidosMinimos: AMOSTRA_MINIMA, // mesmo mínimo do aprendizado
  viewsMinimasPorVideo: VIEWS_MINIMAS,
  vendasParaEscalar: 3,
  ctrSaudavel: 0.005, // 0,5% de cliques por view
  conversaoSaudavel: 0.01, // 1% de vendas por clique
  comissaoRelevantePorVenda: 1, // R$ por venda
  viewsSemVendaParaPausar: 3000,
  cliquesSemVendaParaPausar: 50,
  quedaRelevante: 0.3, // últimos 3 vídeos rendem < 30% dos 3 anteriores
} as const

export interface VideoDoProduto extends MetricasBrutas {
  publicadoEm: Date
}

export interface EntradaDoStatus {
  videos: VideoDoProduto[]
  /** Dado oficial: false/estoque 0 = indisponível; null = não se sabe. */
  disponivel: boolean | null
  estoque: number | null
  nivelDeRisco: string | null
  complianceBloqueante: boolean
  /** Candidato descartado/removido da origem. */
  encerradoNaOrigem: boolean
  /** Comissão por venda conhecida pelo enriquecimento (quando não há venda própria). */
  comissaoPorVendaConhecida: number | null
}

export interface StatusDoProduto {
  status: StatusEconomico
  motivos: string[]
  amostraSuficiente: boolean
  videosMedidos: number
  faltamVideos: number
  agregado: AgregadoDeProduto
}

export function statusEconomico(e: EntradaDoStatus): StatusDoProduto {
  const L = LIMITES_DO_STATUS
  const agregado = agregar(e.videos)
  const medidos = e.videos.filter((v) => typeof v.views === 'number' && v.views >= L.viewsMinimasPorVideo)
  const amostraSuficiente = medidos.length >= L.videosMedidosMinimos
  const faltamVideos = Math.max(0, L.videosMedidosMinimos - medidos.length)
  const r = (status: StatusEconomico, motivos: string[]): StatusDoProduto => ({ status, motivos, amostraSuficiente, videosMedidos: medidos.length, faltamVideos, agregado })

  // 1) Bloqueios objetivos — não dependem de amostra.
  if (e.complianceBloqueante) return r('ENCERRADO', ['Bloqueado por compliance.'])
  if (e.encerradoNaOrigem) return r('ENCERRADO', ['Produto descartado ou removido da origem.'])
  if (e.disponivel === false || e.estoque === 0) return r('PAUSAR', ['Produto indisponível ou sem estoque (dado oficial).'])
  if (e.nivelDeRisco === 'ALTO') return r('PAUSAR', ['Risco alto de compliance/reputação.'])

  const vendas = agregado.vendas
  const comissaoPorVenda = agregado.comissaoPorVenda ?? e.comissaoPorVendaConhecida

  // 2) ESCALAR: evidência de venda + sinais saudáveis (desconhecido não reprova, mas não aprova sozinho).
  if (amostraSuficiente && vendas !== null && vendas >= L.vendasParaEscalar) {
    const problemas: string[] = []
    if (agregado.ctr !== null && agregado.ctr < L.ctrSaudavel) problemas.push(`CTR ${(agregado.ctr * 100).toFixed(2)}% abaixo de ${(L.ctrSaudavel * 100).toFixed(1)}%`)
    if (agregado.conversaoCliqueVenda !== null && agregado.conversaoCliqueVenda < L.conversaoSaudavel) problemas.push(`conversão ${(agregado.conversaoCliqueVenda * 100).toFixed(2)}% abaixo de ${L.conversaoSaudavel * 100}%`)
    if (comissaoPorVenda !== null && comissaoPorVenda < L.comissaoRelevantePorVenda) problemas.push('comissão por venda pouco relevante')
    if (!problemas.length) {
      return r('ESCALAR', [
        `${vendas} vendas em ${medidos.length} vídeos medidos.`,
        agregado.receitaPor1000Views !== null ? `R$ ${agregado.receitaPor1000Views.toFixed(2)} a cada 1.000 views.` : 'Receita por 1.000 views desconhecida.',
        agregado.ctr === null ? 'CTR não medido (não reprova, mas confira).' : `CTR ${(agregado.ctr * 100).toFixed(2)}%.`,
      ])
    }
    return r('PROMISSOR', [`Vende (${vendas}), mas: ${problemas.join('; ')}.`])
  }

  // 3) PAUSAR por desempenho — só com amostra suficiente.
  if (amostraSuficiente) {
    if (vendas === 0 && (agregado.views ?? 0) >= L.viewsSemVendaParaPausar) return r('PAUSAR', [`${agregado.views} views e nenhuma venda em ${medidos.length} vídeos.`])
    if (vendas === 0 && (agregado.cliquesProduto ?? 0) >= L.cliquesSemVendaParaPausar) return r('PAUSAR', [`${agregado.cliquesProduto} cliques e nenhuma venda.`])
    // Queda relevante: últimos 3 × 3 anteriores (receita por 1.000 views).
    const porData = [...medidos].sort((a, b) => a.publicadoEm.getTime() - b.publicadoEm.getTime())
    if (porData.length >= 6) {
      const rpm = (vs: VideoDoProduto[]) => agregar(vs).receitaPor1000Views
      const antes = rpm(porData.slice(-6, -3))
      const depois = rpm(porData.slice(-3))
      if (antes !== null && depois !== null && antes > 0 && depois < antes * L.quedaRelevante) {
        return r('PAUSAR', [`Queda relevante: R$ ${depois.toFixed(2)} contra R$ ${antes.toFixed(2)} a cada 1.000 views nos 3 vídeos anteriores. Renove o criativo antes de abandonar.`])
      }
    }
  }

  // 4) PROMISSOR: já vendeu, mas ainda sem amostra/volume para escalar.
  if (vendas !== null && vendas > 0) return r('PROMISSOR', [`${vendas} venda(s) registradas; ${amostraSuficiente ? 'faltam vendas para escalar' : `faltam ${faltamVideos} vídeo(s) medido(s) para decidir`}.`])

  return r('TESTANDO', [
    amostraSuficiente
      ? 'Amostra suficiente, sem venda registrada e sem sinal forte para pausar: continue testando outro ângulo.'
      : `Amostra pequena: ${medidos.length} de ${L.videosMedidosMinimos} vídeos medidos (≥ ${L.viewsMinimasPorVideo} views). Nada decidido ainda.`,
  ])
}

/** Atalho para o painel: métricas de UM vídeo. */
export { metricasDerivadas }
