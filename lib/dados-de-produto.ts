/**
 * P2.17.6 — Enriquecimento de produto: identificar o provider pelo link e
 * normalizar o que a fonte OFICIAL devolve. FUNÇÕES PURAS, sem rede.
 *
 *   link → provider + id → (fonte oficial) → normalizar → comparar → histórico
 *
 * Regras:
 *   - nada é inventado: campo ausente na fonte fica NULL, com o motivo;
 *   - link curto (s.shopee, vt.tiktok) não é aberto (seria ler a página);
 *   - comissão em % só com UNIDADE confirmada (documentação ou coerência com o
 *     valor em R$ da própria resposta). Sem confirmação: desconhecida;
 *   - comissão em R$ = preço real × % real (79,90 × 12% = 9,59), só com os dois.
 */
import { createHash } from 'node:crypto'
import { linkDoTikTokShop } from './tiktok-shop-link'

export type Provider = 'tiktok-shop' | 'shopee' | 'mercado-livre' | 'amazon'

export interface ProdutoIdentificado {
  provider: Provider | null
  externalId: string | null
  /** Link curto: só abrindo a página saberíamos o produto (não fazemos). */
  curto: boolean
}

const NADA: ProdutoIdentificado = { provider: null, externalId: null, curto: false }

export function identificarProduto(link: string | null | undefined): ProdutoIdentificado {
  if (!link) return NADA
  let u: URL
  try {
    u = new URL(link.trim())
  } catch {
    return NADA
  }
  const host = u.hostname.toLowerCase()
  const tts = linkDoTikTokShop(link)
  if (tts.ehTikTok) return { provider: tts.ehProduto ? 'tiktok-shop' : null, externalId: tts.productId, curto: tts.curto }
  if (host === 's.shopee.com.br' || host === 'shope.ee') return { provider: 'shopee', externalId: null, curto: true }
  if (host === 'shopee.com.br' || host.endsWith('.shopee.com.br')) {
    const caminho = decodeURIComponent(u.pathname)
    const m = caminho.match(/-i\.(\d+)\.(\d+)(?:$|[/?])/) ?? caminho.match(/\/product\/(\d+)\/(\d+)(?:$|\/)/)
    return { provider: 'shopee', externalId: m ? `${m[1]}.${m[2]}` : null, curto: false }
  }
  if (host.includes('mercadolivre.com.br') || host.includes('mercadolibre.com')) {
    const m = u.pathname.match(/MLB-?(\d{6,})/i)
    return { provider: 'mercado-livre', externalId: m ? `MLB${m[1]}` : null, curto: host === 'mercadolivre.com' || host.startsWith('meli.') }
  }
  if (host.endsWith('amazon.com.br') || host === 'amzn.to') {
    const m = u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/)
    return { provider: 'amazon', externalId: m ? m[1] : null, curto: host === 'amzn.to' }
  }
  return NADA
}

/** Link sem fragmento, host em minúsculas e sem barra final (mesma regra da curadoria). */
function linkNormalizado(link: string): string {
  try {
    const u = new URL(link.trim())
    u.hash = ''
    u.hostname = u.hostname.toLowerCase()
    return u.toString().replace(/\/$/, '')
  } catch {
    return link.trim()
  }
}

/** A identidade do dado oficial: provider+id quando reconhecido; senão o link. */
export function chaveDoDado(link: string | null, id: ProdutoIdentificado): string | null {
  if (id.provider && id.externalId) return `${id.provider}:${id.externalId}`
  if (!link) return null
  return `link:${createHash('sha256').update(linkNormalizado(link)).digest('hex').slice(0, 32)}`
}

// ── Normalização ────────────────────────────────────────────────────────

export type UnidadeDaComissao = 'FRACAO_CONFIRMADA' | 'PERCENTUAL_CONFIRMADO' | 'NAO_CONFIRMADA'

/** O que a fonte oficial devolveu, ANTES de normalizar (ausente = null). */
export interface OfertaBruta {
  preco: number | null
  precoAnterior: number | null
  descontoPercentual: number | null
  moeda: string | null
  /** Taxa como veio (ex.: 0.12 ou 12) — unidade só com confirmação. */
  taxaDeComissao: number | null
  /** Unidade da taxa declarada pela DOCUMENTAÇÃO oficial (null = não confirmada). */
  unidadeDocumentada: 'FRACAO' | 'PERCENTUAL' | null
  /** Comissão em dinheiro, quando a fonte devolve. */
  comissaoValor: number | null
  vendas: number | null
  avaliacao: number | null
  numeroDeAvaliacoes: number | null
  estoque: number | null
  disponivel: boolean | null
  categoria: string | null
  imagem: string | null
  loja: string | null
}

export interface DadosNormalizados {
  preco: number | null
  precoAnterior: number | null
  descontoPercentual: number | null
  moeda: string | null
  comissaoPercentual: number | null
  comissaoValor: number | null
  unidadeDaComissao: UnidadeDaComissao | null
  vendas: number | null
  avaliacao: number | null
  numeroDeAvaliacoes: number | null
  estoque: number | null
  disponivel: boolean | null
  categoria: string | null
  imagem: string | null
  loja: string | null
  avisos: string[]
}

const centavos = (v: number) => Math.round(v * 100) / 100
const valido = (v: number | null, min = 0, max = Number.MAX_SAFE_INTEGER) => (v !== null && Number.isFinite(v) && v >= min && v <= max ? v : null)

/**
 * Unidade da taxa: a documentação manda; sem ela, só a COERÊNCIA com o valor em
 * R$ da mesma resposta confirma (preço × taxa ≈ comissão, tolerância 2%).
 * Nunca por palpite ("0,12 parece fração").
 */
export function confirmarUnidade(p: { preco: number | null; taxa: number | null; comissaoValor: number | null; documentada: 'FRACAO' | 'PERCENTUAL' | null }): UnidadeDaComissao | null {
  if (p.taxa === null) return null
  if (p.documentada === 'FRACAO') return 'FRACAO_CONFIRMADA'
  if (p.documentada === 'PERCENTUAL') return 'PERCENTUAL_CONFIRMADO'
  if (p.preco && p.comissaoValor && p.comissaoValor > 0) {
    const perto = (calc: number) => Math.abs(calc - p.comissaoValor!) / p.comissaoValor! <= 0.02
    if (perto(p.preco * p.taxa)) return 'FRACAO_CONFIRMADA'
    if (perto((p.preco * p.taxa) / 100)) return 'PERCENTUAL_CONFIRMADO'
  }
  return 'NAO_CONFIRMADA'
}

/** Comissão em R$ = preço × % / 100, em centavos (79,90 × 12% = 9,59). */
export function comissaoEmReais(preco: number | null, percentual: number | null): number | null {
  if (preco === null || percentual === null) return null
  return Math.round(preco * percentual) / 100
}

export function normalizarOferta(b: OfertaBruta): DadosNormalizados {
  const avisos: string[] = []
  const preco = valido(b.preco, 0.01)
  const precoAnterior = valido(b.precoAnterior, 0.01)
  const unidade = confirmarUnidade({ preco, taxa: valido(b.taxaDeComissao), comissaoValor: valido(b.comissaoValor), documentada: b.unidadeDocumentada })
  let comissaoPercentual: number | null = null
  if (unidade === 'FRACAO_CONFIRMADA') comissaoPercentual = centavos(b.taxaDeComissao! * 100)
  else if (unidade === 'PERCENTUAL_CONFIRMADO') comissaoPercentual = centavos(b.taxaDeComissao!)
  else if (unidade === 'NAO_CONFIRMADA') avisos.push('A fonte informou uma taxa de comissão, mas a unidade não está confirmada: fica desconhecida até a confirmação.')
  if (comissaoPercentual !== null && (comissaoPercentual <= 0 || comissaoPercentual > 100)) {
    avisos.push('Taxa de comissão fora do intervalo 0–100%: descartada.')
    comissaoPercentual = null
  }
  const comissaoValor = valido(b.comissaoValor, 0.01) !== null ? centavos(b.comissaoValor!) : comissaoEmReais(preco, comissaoPercentual)
  const desconto =
    valido(b.descontoPercentual, 0, 100) ?? (preco !== null && precoAnterior !== null && precoAnterior > preco ? Math.round((1 - preco / precoAnterior) * 1000) / 10 : null)
  const avaliacao = valido(b.avaliacao, 0, 5)
  if (b.avaliacao !== null && avaliacao === null) avisos.push('Avaliação fora de 0–5: descartada.')
  return {
    preco, precoAnterior, descontoPercentual: desconto, moeda: b.moeda,
    comissaoPercentual, comissaoValor, unidadeDaComissao: unidade,
    vendas: valido(b.vendas) !== null ? Math.round(b.vendas!) : null,
    avaliacao,
    numeroDeAvaliacoes: valido(b.numeroDeAvaliacoes) !== null ? Math.round(b.numeroDeAvaliacoes!) : null,
    estoque: valido(b.estoque) !== null ? Math.round(b.estoque!) : null,
    disponivel: b.disponivel,
    categoria: b.categoria?.trim() || null,
    imagem: b.imagem?.trim() || null,
    loja: b.loja?.trim() || null,
    avisos,
  }
}

// ── Mudanças e alertas ──────────────────────────────────────────────────

export const CAMPOS_COM_HISTORICO = [
  'preco', 'precoAnterior', 'descontoPercentual', 'comissaoPercentual', 'comissaoValor', 'vendas', 'avaliacao', 'numeroDeAvaliacoes', 'estoque', 'disponivel', 'loja', 'categoria',
] as const
export type CampoComHistorico = (typeof CAMPOS_COM_HISTORICO)[number]

export interface MudancaDeDado { campo: CampoComHistorico; anterior: string | null; novo: string | null }

const comoTexto = (v: unknown) => (v === null || v === undefined ? null : String(v))

/** Só registra o que a fonte TROUXE (novo != null): ausência não apaga o histórico. */
export function mudancasDeDado(anterior: Partial<Record<CampoComHistorico, unknown>> | null, novo: DadosNormalizados): MudancaDeDado[] {
  const out: MudancaDeDado[] = []
  for (const campo of CAMPOS_COM_HISTORICO) {
    const n = comoTexto(novo[campo])
    if (n === null) continue
    const a = comoTexto(anterior?.[campo])
    if (a !== n) out.push({ campo, anterior: a, novo: n })
  }
  return out
}

const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pct = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`

/** "Preço caiu de R$ 89,90 para R$ 69,90." / "Comissão subiu de 8% para 12%." */
export function alertaDaMudanca(m: { campo: string; anterior: string | null; novo: string | null }): string | null {
  if (m.anterior === null || m.novo === null) return null
  const a = Number(m.anterior), n = Number(m.novo)
  if (!Number.isFinite(a) || !Number.isFinite(n) || a === n) return null
  const verbo = n > a ? 'subiu' : 'caiu'
  if (m.campo === 'preco') return `Preço ${verbo} de ${reais(a)} para ${reais(n)}.`
  if (m.campo === 'comissaoPercentual') return `Comissão ${verbo} de ${pct(a)} para ${pct(n)}.`
  if (m.campo === 'comissaoValor') return `Comissão por venda ${verbo} de ${reais(a)} para ${reais(n)}.`
  if (m.campo === 'vendas' && n > a) return `Vendas foram de ${a.toLocaleString('pt-BR')} para ${n.toLocaleString('pt-BR')}.`
  if (m.campo === 'estoque' && n === 0) return 'Estoque zerou.'
  return null
}

/** Do histórico de preço: tendência e o melhor preço observado. */
export function resumoDePreco(precos: { valor: number; em: Date }[], atual: number | null) {
  if (!precos.length && atual === null) return null
  const valores = [...precos.map((p) => p.valor), ...(atual !== null ? [atual] : [])]
  const menor = Math.min(...valores)
  return { menorPrecoObservado: menor, atualEhOMenor: atual !== null && atual <= menor, observacoes: valores.length }
}

// ── Sobrepor o dado oficial ao candidato ────────────────────────────────

export interface CamposDeMercado {
  preco: number | null
  comissaoPercentual: number | null
  comissaoValor: number | null
  vendas: number | null
  avaliacao: number | null
  numeroDeAvaliacoes: number | null
  estoque: number | null
}

/**
 * FUNÇÃO PURA. O oficial vence o informado/cadastrado, campo a campo, só
 * quando EXISTE; o que a fonte não trouxe continua como estava. Comissão em
 * R$ é recalculada só com preço e % reais.
 */
export function sobreporDadoOficial<T extends CamposDeMercado>(item: T, dado: Partial<CamposDeMercado> | null | undefined): T {
  if (!dado) return item
  const preco = dado.preco ?? item.preco
  const comissaoPercentual = dado.comissaoPercentual ?? item.comissaoPercentual
  return {
    ...item,
    preco,
    comissaoPercentual,
    comissaoValor: dado.comissaoValor ?? comissaoEmReais(preco, comissaoPercentual) ?? item.comissaoValor,
    vendas: dado.vendas ?? item.vendas,
    avaliacao: dado.avaliacao ?? item.avaliacao,
    numeroDeAvaliacoes: dado.numeroDeAvaliacoes ?? item.numeroDeAvaliacoes,
    estoque: dado.estoque ?? item.estoque,
  }
}
