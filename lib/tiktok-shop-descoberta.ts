/**
 * P2.17 — Descoberta oficial no TikTok Shop → motor de oportunidades.
 *
 *   token da criadora (cofre) → busca de colaboração aberta (API oficial) →
 *   normalização SEM inventar → `ProdutoDoCatalogo` + `DadosReaisDoItem` →
 *   pontuação pelo MESMO motor → candidatos → Top 3.
 *
 * Só roda com a flag TIKTOK_SHOP_CATALOGO ligada no workspace E a conta de
 * criadora conectada. Sem isso devolve vazio com o motivo — nunca um
 * produto de exemplo. Falha da API não derruba a coleta: o catálogo e os
 * informados seguem, e o motivo fica registrado.
 *
 * Normalização: o formato real da resposta ainda não foi visto. Cada campo
 * é procurado numa lista de nomes (inclusive aninhados, como
 * `sale_price.amount`); o que não for reconhecido fica ausente (null) e
 * entra em "desconhecidos". Comissão em formato duvidoso NÃO é convertida
 * por palpite: fica null.
 */
import type { ProdutoDoCatalogo } from './motor-de-oportunidades'
import type { DadosReaisDoItem } from './curadoria'
import { flagLigada } from './feature-flags'
import { lerCredenciaisTikTokShopCreator, obterTokenDaCriadora } from './tiktok-shop-oauth'
import { buscarProdutosDeColaboracaoAberta, ErroDaTikTokShop, type DepsDoCliente } from './tiktok-shop-cliente'

export const FONTE_TIKTOK_SHOP = 'tiktok-shop'
export const ORIGEM_DADOS_TIKTOK_SHOP = 'TIKTOK_SHOP_API'
export const MAX_PAGINAS = 2

export interface ProdutoDoTikTokShop {
  externalId: string
  nome: string
  preco: number | null
  moeda: string | null
  comissaoPercentual: number | null
  vendas: number | null
  avaliacao: number | null
  numeroDeAvaliacoes: number | null
  estoque: number | null
  imagem: string | null
  categoria: string | null
  link: string | null
  loja: string | null
  desconhecidos: string[]
}

type Bruto = Record<string, unknown>

/** Lê `a.b.c` num objeto; ausente = undefined. */
function caminho(o: Bruto, c: string): unknown {
  return c.split('.').reduce<unknown>((acc, k) => (acc && typeof acc === 'object' ? (acc as Bruto)[k] : undefined), o)
}
function primeiro(o: Bruto, caminhos: string[]): unknown {
  for (const c of caminhos) {
    const v = caminho(o, c)
    if (v !== undefined && v !== null && v !== '') return v
  }
  return undefined
}
function numero(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && /^\s*-?\d+([.,]\d+)?\s*$/.test(v)) return Number(v.replace(',', '.'))
  return null
}
function texto(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim()
  if (typeof v === 'number') return String(v)
  return null
}
function url(v: unknown): string | null {
  const t = Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : texto((x as Bruto)?.url) ?? texto((x as Bruto)?.thumb_url))).find(Boolean) : texto(v)
  return t && /^https:\/\//i.test(t) ? t : null
}

/**
 * Comissão: aceita só um percentual inequívoco (campo "percent"/"rate" com
 * valor entre 0 e 100). Valores > 100 podem ser pontos-base e frações < 1
 * podem ser fração OU percentual: nos dois casos, null + aviso.
 */
export function comissaoSemPalpite(o: Bruto): { valor: number | null; aviso: string | null } {
  // P2.17.4 (auditoria): só campo EXPLICITAMENTE percentual vira número. Campos
  // "rate" podem ser fração, percentual ou pontos-base — sem a primeira resposta
  // real confirmar a unidade, ficam null (com aviso), para não inflar o ranking.
  const pct = numero(primeiro(o, ['commission_percent', 'commission.percent', 'commission_percentage', 'commission.percentage']))
  if (pct !== null) return pct >= 0 && pct <= 100 ? { valor: pct, aviso: null } : { valor: null, aviso: `comissão em formato não confirmado (${pct})` }
  const rate = numero(primeiro(o, ['commission_rate', 'commission.rate', 'open_collaboration.commission_rate']))
  if (rate === null) return { valor: null, aviso: 'comissão (a fonte não informou)' }
  return { valor: null, aviso: `comissão em formato não confirmado (${rate}) — a unidade será confirmada na primeira resposta real` }
}

/** FUNÇÃO PURA. Sem identificador ou sem nome → descartado (null). */
export function normalizarProdutoDoTikTokShop(o: Bruto): ProdutoDoTikTokShop | null {
  const externalId = texto(primeiro(o, ['product_id', 'id', 'product.id']))
  const nome = texto(primeiro(o, ['title', 'product_name', 'name', 'product.title']))
  if (!externalId || !nome) return null
  const desconhecidos: string[] = []
  const preco = numero(primeiro(o, ['sale_price.amount', 'price.sale_price', 'sales_price', 'price.amount', 'price', 'original_price.amount']))
  if (preco === null) desconhecidos.push('preço (a fonte não informou)')
  const comissao = comissaoSemPalpite(o)
  if (comissao.aviso) desconhecidos.push(comissao.aviso)
  const vendas = numero(primeiro(o, ['units_sold', 'sales_count', 'sold_count', 'sale_count']))
  if (vendas === null) desconhecidos.push('vendas (a fonte não informou)')
  const estoque = numero(primeiro(o, ['stock', 'inventory', 'stock_quantity']))
  const temEstoque = primeiro(o, ['has_inventory', 'in_stock'])
  return {
    externalId,
    nome,
    preco,
    moeda: texto(primeiro(o, ['sale_price.currency', 'price.currency', 'currency'])),
    comissaoPercentual: comissao.valor,
    vendas: vendas !== null && vendas >= 0 ? Math.round(vendas) : null,
    avaliacao: numero(primeiro(o, ['rating', 'product_rating', 'review.rating'])),
    numeroDeAvaliacoes: numero(primeiro(o, ['review_count', 'reviews_count', 'review.count'])),
    estoque: estoque !== null ? Math.round(estoque) : temEstoque === false ? 0 : null,
    imagem: url(primeiro(o, ['main_image_url', 'image_url', 'main_images', 'images', 'cover_url'])),
    categoria: texto(primeiro(o, ['category_name', 'category.name', 'category_chains.0.local_name'])),
    link: url(primeiro(o, ['detail_link', 'product_url', 'detail_url', 'share_url'])),
    loja: texto(primeiro(o, ['shop.name', 'shop_name', 'seller_name'])),
    desconhecidos,
  }
}

/** Moeda diferente de BRL não entra como preço: seria comparar reais com dólares. */
function precoEmReais(p: ProdutoDoTikTokShop): number | null {
  return p.moeda && p.moeda.toUpperCase() !== 'BRL' ? null : p.preco
}

export function chaveDeOrigemTikTokShop(externalId: string): string {
  return `${FONTE_TIKTOK_SHOP}:${externalId}`
}

/** FUNÇÃO PURA: no formato que o motor pontua. */
export function comoProdutoDoCatalogo(p: ProdutoDoTikTokShop, agora: Date): ProdutoDoCatalogo {
  return {
    id: chaveDeOrigemTikTokShop(p.externalId),
    nome: p.nome,
    categoria: p.categoria ?? 'Outros',
    preco: precoEmReais(p),
    linkProduto: p.link,
    imagens: p.imagem ? [p.imagem] : [],
    // Direito de uso da imagem do vendedor não verificado.
    origemConteudo: 'De fornecedor',
    origemDados: ORIGEM_DADOS_TIKTOK_SHOP,
    providerId: FONTE_TIKTOK_SHOP,
    status: 'ativo',
    removidoDaOrigemEm: null,
    createdAt: agora,
    comissaoPercentual: p.comissaoPercentual,
    sincronizadoEm: agora,
  }
}

/** FUNÇÃO PURA: dados reais para o retrato do candidato. */
export function comoDadosDoItem(p: ProdutoDoTikTokShop): DadosReaisDoItem {
  return {
    nome: p.nome,
    linkProduto: p.link,
    imagem: p.imagem,
    categoria: p.categoria,
    preco: precoEmReais(p),
    providerId: FONTE_TIKTOK_SHOP,
    externalId: p.externalId,
    comissaoPercentual: p.comissaoPercentual,
    vendas: p.vendas,
    velocidadeDeVendas: null,
    avaliacao: p.avaliacao,
    numeroDeAvaliacoes: p.numeroDeAvaliacoes,
    estoque: p.estoque,
  }
}

export interface ResultadoDaDescoberta {
  produtos: ProdutoDoTikTokShop[]
  descartados: number
  /** null = rodou; texto = por que não rodou ou parou. */
  motivo: string | null
  requestIds: string[]
}

const VAZIO = (motivo: string): ResultadoDaDescoberta => ({ produtos: [], descartados: 0, motivo, requestIds: [] })

export async function descobrirNoTikTokShop(
  workspaceId: string,
  deps: { env?: Record<string, string | undefined>; cliente?: Partial<DepsDoCliente>; flagJaLida?: boolean } = {}
): Promise<ResultadoDaDescoberta> {
  const env = deps.env ?? process.env
  const ligada = deps.flagJaLida ?? (await flagLigada('TIKTOK_SHOP_CATALOGO', workspaceId, env))
  if (!ligada) return VAZIO('Descoberta do TikTok Shop desligada para este workspace.')
  const creds = lerCredenciaisTikTokShopCreator(env)
  if (!creds) return VAZIO('App do TikTok Shop não configurado no servidor.')
  const token = await obterTokenDaCriadora(workspaceId, { env, fetcher: deps.cliente?.fetcher })
  if (!token.ok) return VAZIO(token.mensagem)

  const vistos = new Map<string, ProdutoDoTikTokShop>()
  let descartados = 0
  const requestIds: string[] = []
  let pagina: string | null = null
  try {
    for (let i = 0; i < MAX_PAGINAS; i++) {
      const r = await buscarProdutosDeColaboracaoAberta(
        { tamanhoDaPagina: 20, pagina, env },
        { appKey: creds.appKey, appSecret: creds.appSecret, accessToken: token.accessToken, chaveDeLimite: workspaceId, ...deps.cliente }
      )
      if (r.requestId) requestIds.push(r.requestId)
      for (const bruto of r.produtos) {
        const n = normalizarProdutoDoTikTokShop(bruto)
        if (!n) descartados++
        else if (!vistos.has(n.externalId)) vistos.set(n.externalId, n)
      }
      pagina = r.proximaPagina
      if (!pagina) break
    }
  } catch (e) {
    const motivo = e instanceof ErroDaTikTokShop ? `${e.message} (${e.codigo})` : 'Falha inesperada ao consultar o TikTok Shop.'
    return { produtos: [...vistos.values()], descartados, motivo, requestIds }
  }
  return { produtos: [...vistos.values()], descartados, motivo: null, requestIds }
}
