/**
 * P2.17.10 — Métricas econômicas de vídeo e de produto. FUNÇÕES PURAS.
 *
 * Regra: métrica desconhecida é NULL, nunca zero. Sem denominador (views,
 * cliques) a razão é NULL. Receita de afiliada = comissão (+ recompensa
 * quando informada): sem `receita` informada, usa-se a comissão — e isso é
 * dito no campo `receitaInferidaDaComissao`.
 */

export interface MetricasBrutas {
  views: number | null
  cliquesProduto: number | null
  adicoesCarrinho: number | null
  vendas: number | null
  comissao: number | null
  receita: number | null
  retencaoMedia?: number | null
  tempoMedioSeg?: number | null
}

export interface MetricasDerivadas {
  /** cliques ÷ views */
  ctr: number | null
  /** vendas ÷ cliques */
  conversaoCliqueVenda: number | null
  vendasPor1000Views: number | null
  comissaoPor1000Views: number | null
  receitaPor1000Views: number | null
  comissaoPorClique: number | null
  comissaoPorVenda: number | null
  receitaDoVideo: number | null
  receitaInferidaDaComissao: boolean
}

const ok = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)
const razao = (a: number | null | undefined, b: number | null | undefined, fator = 1, casas = 4): number | null =>
  ok(a) && ok(b) && b > 0 ? Math.round((a / b) * fator * 10 ** casas) / 10 ** casas : null

export function receitaDe(m: Pick<MetricasBrutas, 'receita' | 'comissao'>): { valor: number | null; inferida: boolean } {
  if (ok(m.receita)) return { valor: m.receita, inferida: false }
  if (ok(m.comissao)) return { valor: m.comissao, inferida: true }
  return { valor: null, inferida: false }
}

export function metricasDerivadas(m: MetricasBrutas): MetricasDerivadas {
  const r = receitaDe(m)
  return {
    ctr: razao(m.cliquesProduto, m.views),
    conversaoCliqueVenda: razao(m.vendas, m.cliquesProduto),
    vendasPor1000Views: razao(m.vendas, m.views, 1000, 2),
    comissaoPor1000Views: razao(m.comissao, m.views, 1000, 2),
    receitaPor1000Views: razao(r.valor, m.views, 1000, 2),
    comissaoPorClique: razao(m.comissao, m.cliquesProduto, 1, 2),
    comissaoPorVenda: razao(m.comissao, m.vendas, 1, 2),
    receitaDoVideo: r.valor,
    receitaInferidaDaComissao: r.inferida,
  }
}

/** Soma só o que foi medido; tudo ausente = NULL (não zero). */
function somar(xs: (number | null | undefined)[]): number | null {
  const v = xs.filter(ok)
  return v.length ? Math.round(v.reduce((s, x) => s + x, 0) * 100) / 100 : null
}

export interface AgregadoDeProduto extends MetricasBrutas, MetricasDerivadas {
  videos: number
  videosMedidos: number
}

type Chave = 'views' | 'cliquesProduto' | 'vendas' | 'comissao' | 'receitaEfetiva'
const valorDe = (v: MetricasBrutas, k: Chave): number | null => (k === 'receitaEfetiva' ? receitaDe(v).valor : (v[k] ?? null))

/**
 * Razão sobre os PARES COMPLETOS: só entram os vídeos que têm numerador e
 * denominador medidos. Vídeo sem vendas informadas não "dilui" a conversão.
 */
function razaoDosPares(videos: MetricasBrutas[], num: Chave, den: Chave, fator = 1, casas = 4): number | null {
  const pares = videos.filter((v) => ok(valorDe(v, num)) && ok(valorDe(v, den)))
  return razao(somar(pares.map((v) => valorDe(v, num))), somar(pares.map((v) => valorDe(v, den))), fator, casas)
}

/** Agrega os vídeos de um produto (ou de qualquer grupo) e deriva as razões. */
export function agregar(videos: MetricasBrutas[]): AgregadoDeProduto {
  const receitas = videos.map((v) => receitaDe(v))
  return {
    views: somar(videos.map((v) => v.views)),
    cliquesProduto: somar(videos.map((v) => v.cliquesProduto)),
    adicoesCarrinho: somar(videos.map((v) => v.adicoesCarrinho)),
    vendas: somar(videos.map((v) => v.vendas)),
    comissao: somar(videos.map((v) => v.comissao)),
    receita: somar(videos.map((v) => v.receita)),
    ctr: razaoDosPares(videos, 'cliquesProduto', 'views'),
    conversaoCliqueVenda: razaoDosPares(videos, 'vendas', 'cliquesProduto'),
    vendasPor1000Views: razaoDosPares(videos, 'vendas', 'views', 1000, 2),
    comissaoPor1000Views: razaoDosPares(videos, 'comissao', 'views', 1000, 2),
    receitaPor1000Views: razaoDosPares(videos, 'receitaEfetiva', 'views', 1000, 2),
    comissaoPorClique: razaoDosPares(videos, 'comissao', 'cliquesProduto', 1, 2),
    comissaoPorVenda: razaoDosPares(videos, 'comissao', 'vendas', 1, 2),
    receitaDoVideo: somar(receitas.map((r) => r.valor)),
    receitaInferidaDaComissao: receitas.some((r) => r.inferida),
    videos: videos.length,
    videosMedidos: videos.filter((v) => ok(v.views)).length,
  }
}
