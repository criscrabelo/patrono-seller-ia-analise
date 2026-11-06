/**
 * P2.21 — APRENDIZADO CRIATIVO com NÍVEIS DE EVIDÊNCIA. FUNÇÃO PURA (sem banco).
 *
 * Critério: COMISSÃO por 1.000 views (não views). Comissão CONFIRMADA (liquidada) vale 1; ESTIMADA
 * (estimada/não liquidada/informada) vale 0,5. Sem comissão conhecida o vídeo não entra (nunca vira 0).
 *
 * Cada grupo (ex.: gancho DESCOBERTA) é comparado com o RESTO dos vídeos comparáveis da mesma dimensão:
 *   - estatística central = MEDIANA PONDERADA (robusta a outlier; a média simples nunca decide);
 *   - significância = Mann-Whitney (por posições: um vídeo extremo não arrasta o resultado);
 *   - consistência = parcela ponderada do grupo do lado certo da mediana dos demais;
 *   - recência = peso 0,5^(idade/60 dias) (histórico completo preservado; o recente pesa mais) e a amostra
 *     efetiva é a soma dos pesos: evidência velha perde força sozinha;
 *   - confusão: grupo de um produto só, ou separado dos demais por categoria/canal, ou que muda de
 *     sinal dentro do mesmo produto, não passa de SINAL_INICIAL;
 *   - dispersão alta rebaixa um nível.
 * Níveis: INSUFICIENTE < SINAL_INICIAL < PADRAO_PROVAVEL < PADRAO_FORTE. Só PADRAO_PROVAVEL ou mais orienta
 * o planejador; nada aqui é conclusão permanente (recalcula a cada leitura).
 */
import { VIEWS_MINIMAS } from './aprendizado-videos-tiktok'

export type NivelDeEvidencia = 'INSUFICIENTE' | 'SINAL_INICIAL' | 'PADRAO_PROVAVEL' | 'PADRAO_FORTE'
export const NIVEIS: NivelDeEvidencia[] = ['INSUFICIENTE', 'SINAL_INICIAL', 'PADRAO_PROVAVEL', 'PADRAO_FORTE']
const ordemDoNivel = (n: NivelDeEvidencia) => NIVEIS.indexOf(n)
export const orientaOPlanejador = (n: NivelDeEvidencia) => ordemDoNivel(n) >= ordemDoNivel('PADRAO_PROVAVEL')

/** P2.23: a mesma régua do aprendizado por grupo (fonte única em aprendizado-videos-tiktok). */
export { VIEWS_MINIMAS }
export const MEIA_VIDA_DIAS = 60
/** P2.25: o peso vem da fonte canônica do dinheiro (lib/financeiro.ts). */
export { PESO_DA_COMISSAO_ESTIMADA } from './financeiro'
import { PESO_DA_COMISSAO_ESTIMADA } from './financeiro'
export const CRITERIOS = {
  SINAL_INICIAL: { n: 3, nDemais: 3 },
  PADRAO_PROVAVEL: { n: 5, nDemais: 5, nEfetivo: 3.5, p: 0.1, consistencia: 0.6, efeito: 0.2, produtos: 1 },
  PADRAO_FORTE: { n: 8, nDemais: 8, nEfetivo: 6, p: 0.01, consistencia: 0.75, efeito: 0.3, produtos: 3, dispersao: 1.0 },
  DISPERSAO_ALTA: 1.5,
} as const

export interface VideoParaAprender {
  id: string
  publicadoEm: Date
  /** Identidade do produto (nunca o nome). */
  produto: string
  categoria: string | null
  canal: string
  estrutura: string
  tipoDeGancho: string | null
  tipoDeCta: string | null
  duracaoSegundos: number | null
  formatoDoConteudo: string | null
  temRosto: boolean | null
  temDemonstracao: boolean | null
  temNarracao: boolean | null
  temTextoNaTela: boolean | null
  views: number | null
  cliques: number | null
  pedidos: number | null
  comissaoConfirmada: number | null
  comissaoEstimada: number | null
}

export const DIMENSOES_CRIATIVAS = ['estrutura', 'gancho', 'cta', 'duracao', 'formato', 'rosto', 'demonstracao', 'narracao', 'textoNaTela'] as const
export const COMBINACOES = [['gancho', 'formato'], ['gancho', 'cta'], ['gancho', 'categoria']] as const
export type DimensaoCriativa = (typeof DIMENSOES_CRIATIVAS)[number] | 'gancho+formato' | 'gancho+cta' | 'gancho+categoria'

const NOME_DA_DIMENSAO: Record<string, string> = {
  estrutura: 'Estrutura', gancho: 'Hook', cta: 'CTA', duracao: 'Duração', formato: 'Formato', rosto: 'Rosto', demonstracao: 'Demonstração',
  narracao: 'Narração', textoNaTela: 'Texto na tela', categoria: 'Categoria', 'gancho+formato': 'Hook + formato', 'gancho+cta': 'Hook + CTA', 'gancho+categoria': 'Hook + categoria',
}
const simNao = (b: boolean | null, sim: string, nao: string) => (b === null ? null : b ? sim : nao)
const desconhecido = (s: string | null | undefined) => !s || s === 'UNKNOWN'

/** Valor do vídeo numa dimensão (null = desconhecido: fica fora da comparação). */
export function valorNaDimensao(v: VideoParaAprender, d: string): string | null {
  switch (d) {
    case 'estrutura': return desconhecido(v.estrutura) ? null : v.estrutura
    case 'gancho': return desconhecido(v.tipoDeGancho) ? null : v.tipoDeGancho
    case 'cta': return desconhecido(v.tipoDeCta) ? null : v.tipoDeCta
    case 'duracao': return v.duracaoSegundos == null ? null : v.duracaoSegundos <= 20 ? 'CURTA' : 'MEDIA'
    case 'formato': return desconhecido(v.formatoDoConteudo) ? null : v.formatoDoConteudo
    case 'rosto': return simNao(v.temRosto, 'COM_ROSTO', 'SEM_ROSTO')
    case 'demonstracao': return simNao(v.temDemonstracao, 'COM_DEMONSTRACAO', 'SEM_DEMONSTRACAO')
    case 'narracao': return simNao(v.temNarracao, 'COM_NARRACAO', 'SEM_NARRACAO')
    case 'textoNaTela': return simNao(v.temTextoNaTela, 'COM_TEXTO', 'SEM_TEXTO')
    case 'categoria': return v.categoria || null
  }
  const partes = d.split('+')
  if (partes.length === 2) {
    const a = valorNaDimensao(v, partes[0]), b = valorNaDimensao(v, partes[1])
    return a && b ? `${a} + ${b}` : null
  }
  return null
}

// ── estatística ─────────────────────────────────────────────────────────

const DIA = 86_400_000
export const pesoTemporal = (publicadoEm: Date, agora: Date) => Math.pow(0.5, Math.max(0, (agora.getTime() - publicadoEm.getTime()) / DIA) / MEIA_VIDA_DIAS)

/** Comissão do vídeo com a estimada valendo a metade. null = não se sabe. */
export function comissaoPonderada(v: Pick<VideoParaAprender, 'comissaoConfirmada' | 'comissaoEstimada'>): number | null {
  if (v.comissaoConfirmada == null && v.comissaoEstimada == null) return null
  return (v.comissaoConfirmada ?? 0) + PESO_DA_COMISSAO_ESTIMADA * (v.comissaoEstimada ?? 0)
}
const confiabilidade = (v: VideoParaAprender) => ((v.comissaoConfirmada ?? 0) > 0 ? ((v.comissaoEstimada ?? 0) > 0 ? 0.8 : 1) : 0.6)

interface Ponto { v: VideoParaAprender; valor: number; peso: number }

function medianaPonderada(ps: { valor: number; peso: number }[]): number | null {
  if (!ps.length) return null
  const ord = [...ps].sort((a, b) => a.valor - b.valor)
  const total = ord.reduce((s, p) => s + p.peso, 0)
  let acc = 0
  for (const p of ord) { acc += p.peso; if (acc >= total / 2) return p.valor }
  return ord[ord.length - 1].valor
}
function quantil(xs: number[], q: number) {
  const o = [...xs].sort((a, b) => a - b)
  const i = (o.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i)
  return o[lo] + (o[hi] - o[lo]) * (i - lo)
}
/**
 * Amostra efetiva = soma dos pesos (recência × confiança da comissão). Absoluta, não relativa: 6 vídeos de
 * um ano atrás valem quase nada, então um padrão antigo perde força sozinho (nenhuma conclusão é permanente).
 */
const nEfetivo = (ps: Ponto[]) => ps.reduce((a, p) => a + p.peso, 0)
function phi(z: number) {
  // Φ(z) por erf (Abramowitz-Stegun 7.1.26)
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2)
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2)
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2
}
/** Mann-Whitney bicaudal (aproximação normal com correção de continuidade). */
export function mannWhitney(a: number[], b: number[]): number {
  if (!a.length || !b.length) return 1
  const todos = [...a.map((x) => ({ x, g: 0 })), ...b.map((x) => ({ x, g: 1 }))].sort((p, q) => p.x - q.x)
  const rank = new Array(todos.length)
  for (let i = 0; i < todos.length;) { let j = i; while (j + 1 < todos.length && todos[j + 1].x === todos[i].x) j++; for (let k = i; k <= j; k++) rank[k] = (i + j) / 2 + 1; i = j + 1 }
  const r1 = todos.reduce((s, p, i) => s + (p.g === 0 ? rank[i] : 0), 0)
  const n1 = a.length, n2 = b.length
  const u = r1 - (n1 * (n1 + 1)) / 2
  const mu = (n1 * n2) / 2, sigma = Math.sqrt((n1 * n2 * (n1 + n2 + 1)) / 12)
  if (!sigma) return 1
  const z = (Math.abs(u - mu) - 0.5) / sigma
  return Math.min(1, 2 * (1 - phi(Math.max(0, z))))
}

// ── métricas comerciais ─────────────────────────────────────────────────

export interface MetricasComerciais {
  comissaoPor1000Views: number | null
  pedidosPor1000Views: number | null
  comissaoPorClique: number | null
  conversao: number | null
  comissaoPorVideo: number | null
  /** Mediana do grupo ÷ mediana de todos os comparáveis (1 = na média). */
  eficienciaComercial: number | null
  comissaoConfirmada: number | null
  comissaoEstimada: number | null
}
const arred = (x: number | null, c = 2) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** c) / 10 ** c)
const soma = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => typeof x === 'number'); return v.length ? v.reduce((s, x) => s + x, 0) : null }
const razao = (a: number | null, b: number | null, f = 1) => (a == null || b == null || b <= 0 ? null : (a / b) * f)

function metricasComerciais(vs: VideoParaAprender[], medianaGeral: number | null, medianaDoGrupo: number | null): MetricasComerciais {
  const comCom = vs.filter((v) => comissaoPonderada(v) != null)
  const cv = comCom.filter((v) => (v.views ?? 0) > 0)
  const cc = comCom.filter((v) => (v.cliques ?? 0) > 0)
  const pv = vs.filter((v) => v.pedidos != null && (v.views ?? 0) > 0)
  const pc = vs.filter((v) => v.pedidos != null && (v.cliques ?? 0) > 0)
  return {
    comissaoPor1000Views: arred(razao(soma(cv.map(comissaoPonderada)), soma(cv.map((v) => v.views)), 1000)),
    pedidosPor1000Views: arred(razao(soma(pv.map((v) => v.pedidos)), soma(pv.map((v) => v.views)), 1000)),
    comissaoPorClique: arred(razao(soma(cc.map(comissaoPonderada)), soma(cc.map((v) => v.cliques)))),
    conversao: arred(razao(soma(pc.map((v) => v.pedidos)), soma(pc.map((v) => v.cliques))), 4),
    comissaoPorVideo: arred(comCom.length ? (soma(comCom.map(comissaoPonderada)) ?? 0) / comCom.length : null),
    eficienciaComercial: arred(medianaGeral && medianaDoGrupo != null ? medianaDoGrupo / medianaGeral : null),
    comissaoConfirmada: arred(soma(vs.map((v) => v.comissaoConfirmada))),
    comissaoEstimada: arred(soma(vs.map((v) => v.comissaoEstimada))),
  }
}

// ── comparação ──────────────────────────────────────────────────────────

export interface ResultadoDoGrupo {
  dimensao: DimensaoCriativa
  grupo: string
  nivel: NivelDeEvidencia
  direcao: 'MELHOR' | 'PIOR' | 'IGUAL' | null
  /** mediana do grupo ÷ mediana dos demais */
  efeito: number | null
  videos: number
  videosDosDemais: number
  nEfetivo: number
  produtos: number
  p: number | null
  consistencia: number | null
  dispersao: number | null
  medianaPor1000Views: number | null
  medianaDosDemais: number | null
  metricas: MetricasComerciais
  /** Por que não subiu de nível (ou "—"). */
  limitacoes: string[]
  outliers: string[]
}

export interface AprendizadoCriativo {
  geradoEm: string
  videosComparaveis: number
  videosSemComissao: number
  videosAbaixoDasViews: number
  outliers: string[]
  dimensoes: { dimensao: DimensaoCriativa; grupos: ResultadoDoGrupo[] }[]
  recomendacoes: Recomendacao[]
}

function avaliarGrupo(dimensao: DimensaoCriativa, grupo: string, g: Ponto[], resto: Ponto[], medianaGeral: number | null, outliers: Set<string>): ResultadoDoGrupo {
  const limitacoes: string[] = []
  const mg = medianaPonderada(g), mr = medianaPonderada(resto)
  const efeito = mg != null && mr != null ? (mr > 0 ? mg / mr : mg > 0 ? 10 : 1) : null
  const direcao = efeito == null ? null : efeito > 1 ? 'MELHOR' as const : efeito < 1 ? 'PIOR' as const : 'IGUAL' as const
  const p = g.length && resto.length ? mannWhitney(g.map((x) => x.valor), resto.map((x) => x.valor)) : null
  const pesoG = g.reduce((s, x) => s + x.peso, 0)
  const consistencia = mr == null || !pesoG ? null : g.filter((x) => (direcao === 'PIOR' ? x.valor < mr : x.valor > mr)).reduce((s, x) => s + x.peso, 0) / pesoG
  const mad = mg != null && g.length ? medianaPonderada(g.map((x) => ({ valor: Math.abs(x.valor - mg), peso: x.peso }))) : null
  const dispersao = mg && mad != null ? mad / mg : null
  const produtos = new Set(g.map((x) => x.v.produto)).size
  const nef = nEfetivo(g)
  const base = {
    dimensao, grupo, direcao, efeito: arred(efeito), videos: g.length, videosDosDemais: resto.length, nEfetivo: arred(nef, 1)!, produtos, p: arred(p, 4),
    consistencia: arred(consistencia), dispersao: arred(dispersao), medianaPor1000Views: arred(mg), medianaDosDemais: arred(mr),
    metricas: metricasComerciais(g.map((x) => x.v), medianaGeral, mg), outliers: g.filter((x) => outliers.has(x.v.id)).map((x) => x.v.id),
  }
  if (g.length < CRITERIOS.SINAL_INICIAL.n || resto.length < CRITERIOS.SINAL_INICIAL.nDemais) {
    limitacoes.push(`Amostra pequena: ${g.length} vídeo(s) no grupo e ${resto.length} nos demais (mínimo ${CRITERIOS.SINAL_INICIAL.n} e ${CRITERIOS.SINAL_INICIAL.nDemais}).`)
    return { ...base, nivel: 'INSUFICIENTE', limitacoes }
  }
  // Confusão com produto/categoria/canal.
  let confundido = false
  const produtosDosDemais = new Set(resto.map((x) => x.v.produto))
  if (![...new Set(g.map((x) => x.v.produto))].some((pr) => produtosDosDemais.has(pr))) { confundido = true; limitacoes.push('O grupo e os demais não têm nenhum produto em comum: pode ser efeito do produto, não do criativo.') }
  for (const [campo, nome] of [['categoria', 'categoria'], ['canal', 'canal']] as const) {
    const dentro = new Set(g.map((x) => x.v[campo] ?? '?')), fora = new Set(resto.map((x) => x.v[campo] ?? '?'))
    if (![...dentro].some((c) => fora.has(c))) { confundido = true; limitacoes.push(`O grupo e os demais não têm nenhuma ${nome} em comum: pode ser efeito da ${nome}.`) }
  }
  const produtosComOsDois = [...new Set(g.map((x) => x.v.produto))].filter((pr) => resto.some((x) => x.v.produto === pr))
  if (produtosComOsDois.length && direcao && direcao !== 'IGUAL') {
    const contra = produtosComOsDois.filter((pr) => {
      const a = medianaPonderada(g.filter((x) => x.v.produto === pr)), b = medianaPonderada(resto.filter((x) => x.v.produto === pr))
      return a != null && b != null && (direcao === 'MELHOR' ? a < b : a > b)
    })
    if (contra.length * 2 > produtosComOsDois.length) { confundido = true; limitacoes.push('Dentro do mesmo produto o resultado se inverte: o padrão não se sustenta.') }
  }
  const atende = (c: { n: number; nDemais: number; nEfetivo: number; p: number; consistencia: number; efeito: number; produtos: number }) =>
    g.length >= c.n && resto.length >= c.nDemais && nef >= c.nEfetivo && p != null && p < c.p && (consistencia ?? 0) >= c.consistencia && efeito != null && Math.abs(efeito - 1) >= c.efeito && produtos >= c.produtos
  let nivel: NivelDeEvidencia = 'SINAL_INICIAL'
  if (!confundido && atende(CRITERIOS.PADRAO_FORTE) && (dispersao ?? 99) <= CRITERIOS.PADRAO_FORTE.dispersao) nivel = 'PADRAO_FORTE'
  else if (!confundido && atende(CRITERIOS.PADRAO_PROVAVEL)) nivel = 'PADRAO_PROVAVEL'
  if (nivel === 'SINAL_INICIAL' && !confundido) {
    const c = CRITERIOS.PADRAO_PROVAVEL
    if (g.length < c.n || resto.length < c.nDemais) limitacoes.push(`Para padrão provável: ${c.n}+ vídeos no grupo e nos demais (há ${g.length} e ${resto.length}).`)
    if (nef < c.nEfetivo) limitacoes.push('Os vídeos são antigos: o peso recente ainda é pouco.')
    if (p == null || p >= c.p) limitacoes.push(`A diferença ainda pode ser acaso (p = ${p == null ? '—' : p.toFixed(2)}).`)
    if ((consistencia ?? 0) < c.consistencia) limitacoes.push('Os vídeos do grupo não vão na mesma direção.')
    if (efeito == null || Math.abs(efeito - 1) < c.efeito) limitacoes.push('A diferença é pequena.')
    if (produtos < c.produtos) limitacoes.push(`Precisa de pelo menos ${c.produtos} produtos diferentes.`)
  }
  if (nivel === 'PADRAO_PROVAVEL' && produtos < CRITERIOS.PADRAO_FORTE.produtos) {
    limitacoes.push(`Para padrão forte: ${CRITERIOS.PADRAO_FORTE.produtos}+ produtos diferentes (há ${produtos}).`)
  }
  if ((dispersao ?? 0) > CRITERIOS.DISPERSAO_ALTA && nivel !== 'SINAL_INICIAL') {
    nivel = nivel === 'PADRAO_FORTE' ? 'PADRAO_PROVAVEL' : 'SINAL_INICIAL'
    limitacoes.push('Resultados muito espalhados dentro do grupo: rebaixado um nível.')
  }
  return { ...base, nivel, limitacoes }
}

// ── recomendações ───────────────────────────────────────────────────────

export type AcaoRecomendada = 'REPETIR_HOOK' | 'REPETIR_ESTRUTURA' | 'REPETIR_FORMATO' | 'REPETIR_COMBINACAO' | 'TESTAR_VARIACAO' | 'MUDAR_CTA' | 'USAR_CTA'
  | 'ENCURTAR' | 'ALONGAR' | 'DEMONSTRAR_MAIS_CEDO' | 'USAR_ROSTO' | 'USAR_NARRACAO' | 'MANTER_TEXTO_NA_TELA' | 'EVITAR_ESTE_PADRAO'

export interface Recomendacao {
  acao: AcaoRecomendada
  dimensao: DimensaoCriativa
  grupo: string
  nivel: NivelDeEvidencia
  orientaPlanejador: boolean
  motivo: string
  efeito: number
  videos: number
}

const vezes = (x: number) => `${x.toFixed(1).replace('.', ',')}x`
function motivoDe(r: ResultadoDoGrupo): string {
  const nome = NOME_DA_DIMENSAO[r.dimensao] ?? r.dimensao
  const comp = r.direcao === 'PIOR' ? `${vezes(r.efeito!)} da comissão por 1.000 views dos demais (${Math.round((1 - r.efeito!) * 100)}% menos)` : `${vezes(r.efeito!)} mais comissão por 1.000 views`
  const nivel = { INSUFICIENTE: 'insuficiente', SINAL_INICIAL: 'sinal inicial', PADRAO_PROVAVEL: 'padrão provável', PADRAO_FORTE: 'padrão forte' }[r.nivel]
  const p = r.p == null ? '—' : r.p < 0.01 ? 'p < 0,01' : `p = ${r.p.toFixed(2).replace('.', ',')}`
  return `${nome} ${r.grupo} teve ${comp} em ${r.videos} vídeos comparáveis (contra ${r.videosDosDemais} dos demais; ${nivel}, ${p}).`
}

function acaoDe(r: ResultadoDoGrupo): AcaoRecomendada | null {
  const melhor = r.direcao === 'MELHOR'
  if (r.direcao !== 'MELHOR' && r.direcao !== 'PIOR') return null
  switch (r.dimensao) {
    case 'gancho': return melhor ? 'REPETIR_HOOK' : 'EVITAR_ESTE_PADRAO'
    case 'estrutura': return melhor ? 'REPETIR_ESTRUTURA' : 'EVITAR_ESTE_PADRAO'
    case 'formato': return melhor ? 'REPETIR_FORMATO' : 'EVITAR_ESTE_PADRAO'
    case 'cta': return melhor ? 'USAR_CTA' : 'MUDAR_CTA'
    case 'duracao': return (r.grupo === 'CURTA') === melhor ? 'ENCURTAR' : 'ALONGAR'
    case 'demonstracao': return (r.grupo === 'COM_DEMONSTRACAO') === melhor ? 'DEMONSTRAR_MAIS_CEDO' : 'EVITAR_ESTE_PADRAO'
    case 'rosto': return (r.grupo === 'COM_ROSTO') === melhor ? 'USAR_ROSTO' : 'EVITAR_ESTE_PADRAO'
    case 'narracao': return (r.grupo === 'COM_NARRACAO') === melhor ? 'USAR_NARRACAO' : 'EVITAR_ESTE_PADRAO'
    case 'textoNaTela': return (r.grupo === 'COM_TEXTO') === melhor ? 'MANTER_TEXTO_NA_TELA' : 'EVITAR_ESTE_PADRAO'
    default: return melhor ? 'REPETIR_COMBINACAO' : 'EVITAR_ESTE_PADRAO'
  }
}

/** FUNÇÃO PURA. O aprendizado inteiro (todas as dimensões + combinações com amostra suficiente). */
export function aprenderCriativo(videos: VideoParaAprender[], agora: Date): AprendizadoCriativo {
  const abaixo = videos.filter((v) => (v.views ?? 0) < VIEWS_MINIMAS)
  const semComissao = videos.filter((v) => (v.views ?? 0) >= VIEWS_MINIMAS && comissaoPonderada(v) == null)
  const pontos: Ponto[] = videos
    .filter((v) => (v.views ?? 0) >= VIEWS_MINIMAS && comissaoPonderada(v) != null)
    .map((v) => ({ v, valor: (comissaoPonderada(v)! / v.views!) * 1000, peso: pesoTemporal(v.publicadoEm, agora) * confiabilidade(v) }))
  // Outlier extremo (Q3 + 3·IQR): continua nos dados (mediana e posições já o neutralizam), mas é apontado.
  const outliers = new Set<string>()
  if (pontos.length >= 5) {
    const xs = pontos.map((p) => p.valor), q1 = quantil(xs, 0.25), q3 = quantil(xs, 0.75), lim = q3 + 3 * Math.max(q3 - q1, 1e-9)
    for (const p of pontos) if (p.valor > lim) outliers.add(p.v.id)
  }
  const medianaGeral = medianaPonderada(pontos)
  const dims: { dimensao: DimensaoCriativa; grupos: ResultadoDoGrupo[] }[] = []
  const analisar = (d: DimensaoCriativa, combinacao: boolean) => {
    const comValor = pontos.map((p) => ({ p, k: valorNaDimensao(p.v, d) })).filter((x): x is { p: Ponto; k: string } => !!x.k)
    const grupos = [...new Set(comValor.map((x) => x.k))]
    if (grupos.length < 2) return
    // Combinação só acrescenta informação se a 2ª parte varia (ex.: uma categoria só = repete o hook).
    if (combinacao && new Set(comValor.map((x) => valorNaDimensao(x.p.v, d.split('+')[1]))).size < 2) return
    const rs = grupos.map((k) => avaliarGrupo(d, k, comValor.filter((x) => x.k === k).map((x) => x.p), comValor.filter((x) => x.k !== k).map((x) => x.p), medianaGeral, outliers))
    // Combinação só aparece com amostra suficiente (≥ critério de padrão provável no grupo e nos demais).
    const mostrar = combinacao ? rs.filter((r) => r.videos >= CRITERIOS.PADRAO_PROVAVEL.n && r.videosDosDemais >= CRITERIOS.PADRAO_PROVAVEL.nDemais) : rs
    if (mostrar.length) dims.push({ dimensao: d, grupos: mostrar.sort((a, b) => ordemDoNivel(b.nivel) - ordemDoNivel(a.nivel) || (b.efeito ?? 0) - (a.efeito ?? 0)) })
  }
  for (const d of DIMENSOES_CRIATIVAS) analisar(d, false)
  for (const [a, b] of COMBINACOES) analisar(`${a}+${b}` as DimensaoCriativa, true)

  const recomendacoes: Recomendacao[] = []
  for (const { grupos } of dims) for (const r of grupos) {
    if (r.nivel === 'INSUFICIENTE' || r.efeito == null) continue
    const acao = r.nivel === 'SINAL_INICIAL' ? (r.direcao === 'MELHOR' ? 'TESTAR_VARIACAO' as const : null) : acaoDe(r)
    if (!acao) continue
    recomendacoes.push({ acao, dimensao: r.dimensao, grupo: r.grupo, nivel: r.nivel, orientaPlanejador: orientaOPlanejador(r.nivel), motivo: r.nivel === 'SINAL_INICIAL' ? `Sinal inicial (ainda não orienta): ${motivoDe(r)} ${r.limitacoes[0] ?? ''}`.trim() : motivoDe(r), efeito: r.efeito, videos: r.videos })
  }
  recomendacoes.sort((a, b) => Number(b.orientaPlanejador) - Number(a.orientaPlanejador) || ordemDoNivel(b.nivel) - ordemDoNivel(a.nivel) || Math.abs(b.efeito - 1) - Math.abs(a.efeito - 1))
  return { geradoEm: agora.toISOString(), videosComparaveis: pontos.length, videosSemComissao: semComissao.length, videosAbaixoDasViews: abaixo.length, outliers: [...outliers], dimensoes: dims, recomendacoes }
}

// ── feedback para o planejador ──────────────────────────────────────────

export interface OrientacaoCriativa {
  estruturasPreferidas: string[]
  estruturasEvitar: string[]
  ganchosPreferidos: string[]
  ganchosEvitar: string[]
  /** 'B' = "Salva este vídeo…"; 'A' = produto marcado/link. */
  cta: 'A' | 'B' | null
  duracao: 'CURTA' | 'MEDIA' | null
  motivos: string[]
}

/** Só PADRAO_PROVAVEL ou mais orienta. INSUFICIENTE/SINAL_INICIAL → orientação vazia. */
export function orientacaoParaOPlanejador(a: AprendizadoCriativo): OrientacaoCriativa {
  const o: OrientacaoCriativa = { estruturasPreferidas: [], estruturasEvitar: [], ganchosPreferidos: [], ganchosEvitar: [], cta: null, duracao: null, motivos: [] }
  for (const r of a.recomendacoes.filter((x) => x.orientaPlanejador)) {
    let usou = true
    if (r.dimensao === 'estrutura') (r.acao === 'REPETIR_ESTRUTURA' ? o.estruturasPreferidas : o.estruturasEvitar).push(r.grupo)
    else if (r.dimensao === 'gancho') (r.acao === 'REPETIR_HOOK' ? o.ganchosPreferidos : o.ganchosEvitar).push(r.grupo)
    else if (r.dimensao === 'cta' && !o.cta) {
      const ctaDe = (t: string) => (t === 'SALVAR_E_CONFERIR' ? 'B' as const : ['PRODUTO_MARCADO', 'CONFIRA_LINK'].includes(t) ? 'A' as const : null)
      o.cta = r.acao === 'USAR_CTA' ? ctaDe(r.grupo) : ctaDe(r.grupo) === 'A' ? 'B' : ctaDe(r.grupo) === 'B' ? 'A' : null
      usou = !!o.cta
    } else if (r.dimensao === 'duracao' && !o.duracao) o.duracao = r.acao === 'ENCURTAR' ? 'CURTA' : 'MEDIA'
    else usou = false
    if (usou) o.motivos.push(`${r.acao.replace(/_/g, ' ')}: ${r.motivo}`)
  }
  return o
}

/** Pontuação de uma variante pela orientação (maior = antes). Sem orientação, 0. */
export function pontuarVariante(o: OrientacaoCriativa | null, v: { estrutura: string; tipoDeGancho: string }): number {
  if (!o) return 0
  let s = 0
  if (o.estruturasPreferidas.includes(v.estrutura)) s += 2
  if (o.estruturasEvitar.includes(v.estrutura)) s -= 3
  if (o.ganchosPreferidos.includes(v.tipoDeGancho)) s += 1
  if (o.ganchosEvitar.includes(v.tipoDeGancho)) s -= 2
  return s
}
