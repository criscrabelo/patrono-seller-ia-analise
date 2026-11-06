/**
 * Adaptador do catálogo do TikTok Shop (Rodada 13) — traduz a resposta bruta
 * da Affiliate Creator API para `ItemDeCatalogoExterno`, que é o formato
 * neutro que `reconciliarCatalogo()` entende.
 *
 * ⚠️ O FORMATO REAL DA RESPOSTA NÃO FOI VERIFICADO. A documentação do
 * Partner Center é renderizada por JavaScript e não pôde ser lida
 * diretamente; a Affiliate API é "inactive by default" e ainda não há
 * credencial para uma chamada real. Este módulo foi escrito para lidar com
 * essa ignorância de frente, e não para fingir que ela não existe:
 *
 *  1. cada campo é procurado numa LISTA de nomes candidatos;
 *  2. campo não encontrado vira `undefined` — ou seja, "a API não falou
 *     disso", e o reconciliador não toca no valor existente;
 *  3. tudo que veio na resposta e NÃO foi reconhecido sai em
 *     `camposNaoReconhecidos`, para a primeira resposta real revelar o
 *     formato verdadeiro em vez de ser silenciosamente descartada.
 *
 * O item 3 é o ponto central: quando as credenciais chegarem, uma única
 * sincronização em modo de inspeção mostra exatamente quais campos existem —
 * inclusive comissão e disponibilidade, que hoje nem têm coluna no `Produto`
 * justamente porque nunca vimos o payload.
 *
 * Nada aqui faz requisição: adaptador puro, testável com fixtures.
 */

import type { ItemDeCatalogoExterno } from './catalogo-sync'

/** Resposta crua: um objeto qualquer vindo da API. */
export type ItemBruto = Record<string, unknown>

export interface ResultadoAdaptacao {
  itens: ItemDeCatalogoExterno[]
  /**
   * Itens descartados por não terem identidade externa. Sem `externalId` não
   * há idempotência possível — importar assim duplicaria na próxima rodada.
   */
  descartados: { motivo: string; bruto: ItemBruto }[]
  /**
   * União de todas as chaves presentes na resposta que este adaptador não
   * sabe ler. É o mapa para completar o mapeamento com dado real.
   */
  camposNaoReconhecidos: string[]
}

/**
 * Nomes candidatos por campo. TikTok Shop usa snake_case; incluímos variações
 * camelCase porque não confirmamos a convenção da resposta.
 */
const CANDIDATOS = {
  externalId: ['product_id', 'productId', 'id', 'item_id', 'itemId'],
  nome: ['product_name', 'productName', 'title', 'name'],
  categoria: ['category_name', 'categoryName', 'category', 'category_id'],
  preco: ['price', 'sale_price', 'salePrice', 'current_price'],
  linkProduto: ['product_url', 'productUrl', 'url', 'detail_url', 'share_url'],
  descricao: ['description', 'desc', 'product_description'],
  imagens: ['images', 'image_urls', 'imageUrls', 'main_images', 'cover_images'],
  videos: ['videos', 'video_urls', 'videoUrls'],
  comissaoPercentual: ['commission_rate', 'commissionRate', 'commission_percent'],
  disponivel: ['is_available', 'available', 'in_stock', 'inStock'],
} as const

const TODOS_CANDIDATOS = new Set<string>(Object.values(CANDIDATOS).flat())

/** Devolve o primeiro candidato PRESENTE no objeto; `undefined` se nenhum. */
function primeiroPresente(bruto: ItemBruto, chaves: readonly string[]): { chave: string; valor: unknown } | undefined {
  for (const chave of chaves) {
    if (Object.prototype.hasOwnProperty.call(bruto, chave)) {
      return { chave, valor: bruto[chave] }
    }
  }
  return undefined
}

/**
 * Converte para texto sem inventar. `null` continua `null` (a API disse que
 * não há valor); ausente continua ausente.
 */
function comoTexto(valor: unknown): string | null | undefined {
  if (valor === undefined) return undefined
  if (valor === null) return null
  if (typeof valor === 'string') return valor
  if (typeof valor === 'number' || typeof valor === 'boolean') return String(valor)
  return undefined // objeto/array onde se esperava texto: não adivinhamos
}

/**
 * Preço pode vir como número ou como texto ("199.90", "R$ 199,90"). Texto que
 * não vira número NÃO retorna 0 — retorna `undefined`, e o preço anterior
 * fica intacto. Um zero inventado apareceria na legenda publicada.
 */
function comoNumero(valor: unknown): number | null | undefined {
  if (valor === undefined) return undefined
  if (valor === null) return null
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : undefined
  if (typeof valor === 'string') {
    const limpo = valor.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')
    // Sem NENHUM dígito, `Number('')` devolveria 0 — e um preço zero
    // inventado iria parar na legenda publicada ("R$ 0,00"). Texto como
    // "sob consulta" tem de ficar AUSENTE, nunca virar zero.
    if (!/\d/.test(limpo)) return undefined
    const n = Number(limpo)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

function comoBooleano(valor: unknown): boolean | undefined {
  if (typeof valor === 'boolean') return valor
  if (valor === 'true') return true
  if (valor === 'false') return false
  return undefined
}

/** Lista de URLs a partir de array de textos ou de objetos com url/uri. */
function comoListaDeUrls(valor: unknown): string[] | undefined {
  if (!Array.isArray(valor)) return undefined
  const urls = valor
    .map((v) => {
      if (typeof v === 'string') return v
      if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>
        for (const k of ['url', 'uri', 'thumb_url', 'image_url']) {
          if (typeof o[k] === 'string') return o[k] as string
        }
      }
      return null
    })
    .filter((u): u is string => !!u)
  return urls
}

export function adaptarItemDoTikTokShop(bruto: ItemBruto): ItemDeCatalogoExterno | null {
  const id = primeiroPresente(bruto, CANDIDATOS.externalId)
  const externalId = comoTexto(id?.valor)
  if (!externalId) return null

  const item: ItemDeCatalogoExterno = { externalId }

  const nome = primeiroPresente(bruto, CANDIDATOS.nome)
  if (nome) {
    const t = comoTexto(nome.valor)
    if (t !== undefined && t !== null) item.nome = t
  }

  const categoria = primeiroPresente(bruto, CANDIDATOS.categoria)
  if (categoria) {
    const t = comoTexto(categoria.valor)
    if (t !== undefined && t !== null) item.categoria = t
  }

  const preco = primeiroPresente(bruto, CANDIDATOS.preco)
  if (preco) {
    const n = comoNumero(preco.valor)
    if (n !== undefined) item.preco = n
  }

  const link = primeiroPresente(bruto, CANDIDATOS.linkProduto)
  if (link) {
    const t = comoTexto(link.valor)
    if (t !== undefined) item.linkProduto = t
  }

  const descricao = primeiroPresente(bruto, CANDIDATOS.descricao)
  if (descricao) {
    const t = comoTexto(descricao.valor)
    if (t !== undefined) item.descricao = t
  }

  const imagens = primeiroPresente(bruto, CANDIDATOS.imagens)
  if (imagens) {
    const l = comoListaDeUrls(imagens.valor)
    if (l !== undefined) item.imagens = l
  }

  const videos = primeiroPresente(bruto, CANDIDATOS.videos)
  if (videos) {
    const l = comoListaDeUrls(videos.valor)
    if (l !== undefined) item.videos = l
  }

  // Comissão e disponibilidade são LIDAS, mas ainda não têm coluna no
  // `Produto` — de propósito: criar coluna para campo nunca visto seria
  // especular sobre o formato. Seguem para as features do ML e para a
  // auditoria, e viram coluna quando o payload real confirmar que existem.
  const comissao = primeiroPresente(bruto, CANDIDATOS.comissaoPercentual)
  if (comissao) {
    const n = comoNumero(comissao.valor)
    if (n !== undefined) item.comissaoPercentual = n
  }

  const disponivel = primeiroPresente(bruto, CANDIDATOS.disponivel)
  if (disponivel) {
    const b = comoBooleano(disponivel.valor)
    if (b !== undefined) item.disponivel = b
  }

  return item
}

export function adaptarCatalogoDoTikTokShop(brutos: ItemBruto[]): ResultadoAdaptacao {
  const itens: ItemDeCatalogoExterno[] = []
  const descartados: ResultadoAdaptacao['descartados'] = []
  const naoReconhecidos = new Set<string>()

  for (const bruto of brutos) {
    for (const chave of Object.keys(bruto)) {
      if (!TODOS_CANDIDATOS.has(chave)) naoReconhecidos.add(chave)
    }

    const item = adaptarItemDoTikTokShop(bruto)
    if (!item) {
      descartados.push({
        motivo: 'Item sem identificador de produto — sem ele não há idempotência, e importar duplicaria na próxima sincronização.',
        bruto,
      })
      continue
    }
    itens.push(item)
  }

  return { itens, descartados, camposNaoReconhecidos: [...naoReconhecidos].sort() }
}
