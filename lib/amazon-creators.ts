/**
 * AmazonCreatorsProvider (Rodada 5) — Amazon Creators API, NÃO a
 * PA-API antiga/deprecated.
 *
 * Marketplace: www.amazon.com.br · Locale: pt_BR · Currency: BRL.
 *
 * Sem credenciais configuradas (`AMAZON_CREATORS_CREDENTIAL_ID`,
 * `AMAZON_CREATORS_CREDENTIAL_SECRET`, `AMAZON_CREATORS_PARTNER_TAG` —
 * nomes alinhados ao que a documentação oficial pede; nenhum tem
 * `NEXT_PUBLIC_` na frente, então nunca chegam ao navegador): este
 * provider NUNCA simula conexão. `healthCheck()` devolve
 * "AMAZON — AGUARDANDO CONFIGURAÇÃO" e o resto do Patrono continua
 * funcionando normalmente.
 *
 * Nenhuma chamada de rede foi testada contra a API real nesta rodada
 * (sem credenciais, sem acesso à internet externa neste ambiente) — o
 * código abaixo é o que SERIA chamado quando configurado; a assinatura
 * OAuth e o cache de token são testados isoladamente (mock de fetch).
 */

import { OAuthTokenCache } from './oauth-token-cache'
import type { AffiliateOpportunity, OpportunitySource } from './affiliate-discovery'
import type { MediaUsagePolicy } from './media-rights'

const MARKETPLACE = 'www.amazon.com.br'
const LOCALE = 'pt_BR'
const CURRENCY = 'BRL'

export interface AmazonCredentials {
  credentialId: string
  credentialSecret: string
  partnerTag: string
}

/** Lê as credenciais do ambiente — nunca do corpo de uma requisição do cliente. */
export function lerCredenciaisAmazon(): AmazonCredentials | null {
  const credentialId = process.env.AMAZON_CREATORS_CREDENTIAL_ID
  const credentialSecret = process.env.AMAZON_CREATORS_CREDENTIAL_SECRET
  const partnerTag = process.env.AMAZON_CREATORS_PARTNER_TAG
  if (!credentialId || !credentialSecret || !partnerTag) return null
  return { credentialId, credentialSecret, partnerTag }
}

const tokenCache = new OAuthTokenCache()

/**
 * OAuth 2.0 client-credentials — busca o token só quando o cache não tem
 * um válido (nunca a cada chamada). Isolado como função pura de I/O para
 * poder ser testado com fetch mockado.
 */
export async function obterAccessToken(
  creds: AmazonCredentials,
  fetcher: typeof fetch = fetch
): Promise<string> {
  return tokenCache.obterOuRenovar(`amazon:${creds.credentialId}`, async () => {
    const res = await fetcher('https://api.amazon.com/auth/o2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: creds.credentialId,
        client_secret: creds.credentialSecret,
        scope: 'creators_api::search',
      }),
    })
    const data = await res.json()
    if (!res.ok || !data.access_token) {
      throw new Error(data.error_description || 'Falha ao obter token da Amazon Creators API')
    }
    return { token: data.access_token, expiraEmSegundos: data.expires_in ?? 3600 }
  })
}

export type AmazonSearchIndex = string // ex.: 'Electronics', 'HomeAndKitchen' — validado pela própria API, não hardcoded aqui

export interface AmazonSearchItemsParams {
  keywords?: string
  searchIndex?: AmazonSearchIndex
  browseNodeId?: string
  minPrice?: number
  maxPrice?: number
  minReviewRating?: number
  primeOnly?: boolean
}

/** Distinção explícita pedida pela Rodada 5: ranking OFICIAL da Amazon x nosso próprio score. */
export interface AmazonSalesRank {
  tipo: 'browse_node_sales_rank' | 'website_sales_rank'
  rank: number
  categoria: string
}

export interface AmazonItem {
  asin: string
  title: string
  detailPageUrl: string // URL devolvida pela API, com partnerTag — NUNCA reconstruída manualmente
  price: { amount: number; currency: string } | null
  images: { url: string; usagePolicy: MediaUsagePolicy }[]
  officialSalesRank: AmazonSalesRank | null // null = Amazon não devolveu rank pra este item; nunca inventado
  consultedAt: string // ISO — data desta consulta, não de quando o produto foi visto pela última vez
}

export type AmazonHealthStatus =
  | { configured: false; status: 'AGUARDANDO CONFIGURAÇÃO'; message: string }
  | { configured: true; status: 'OK' | 'ERROR'; message: string }

export class AmazonCreatorsProvider implements OpportunitySource {
  private fetcher: typeof fetch

  constructor(fetcher: typeof fetch = fetch) {
    this.fetcher = fetcher
  }

  /**
   * Nunca simula conexão. Sem credenciais, devolve exatamente o estado
   * pedido pela Rodada 5 — nada mais do Patrono é afetado por isso.
   */
  async healthCheck(): Promise<AmazonHealthStatus> {
    const creds = lerCredenciaisAmazon()
    if (!creds) {
      return {
        configured: false,
        status: 'AGUARDANDO CONFIGURAÇÃO',
        message:
          'Defina AMAZON_CREATORS_CREDENTIAL_ID, AMAZON_CREATORS_CREDENTIAL_SECRET e AMAZON_CREATORS_PARTNER_TAG para conectar.',
      }
    }
    try {
      await obterAccessToken(creds, this.fetcher)
      return { configured: true, status: 'OK', message: 'Token obtido com sucesso.' }
    } catch (e) {
      return { configured: true, status: 'ERROR', message: e instanceof Error ? e.message : 'Falha desconhecida' }
    }
  }

  /** Busca produtos via SearchItems. Só pede os `resources` estritamente necessários (nunca o payload completo por padrão). */
  async searchItems(params: AmazonSearchItemsParams): Promise<AmazonItem[]> {
    const creds = lerCredenciaisAmazon()
    if (!creds) {
      throw new Error('Amazon Creators API não configurada — nada foi buscado.')
    }
    const token = await obterAccessToken(creds, this.fetcher)

    const resources = [
      'ItemInfo.Title',
      'Images.Primary.Large',
      'Offers.Listings.Price',
      'BrowseNodeInfo.BrowseNodes.SalesRank',
      'BrowseNodeInfo.WebsiteSalesRank',
    ]

    const res = await this.fetcher('https://creators-api.amazon.com/search-items', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        marketplace: MARKETPLACE,
        partnerTag: creds.partnerTag,
        keywords: params.keywords,
        searchIndex: params.searchIndex,
        browseNodeId: params.browseNodeId,
        minPrice: params.minPrice,
        maxPrice: params.maxPrice,
        minReviewRating: params.minReviewRating,
        merchant: params.primeOnly ? 'Amazon' : undefined,
        resources,
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data?.message || 'Falha na consulta SearchItems')

    return (data.items ?? []).map((item: Record<string, unknown>) => mapearItemAmazon(item))
  }

  async getCandidates({ category }: { workspaceId: string; category?: string }): Promise<AffiliateOpportunity[]> {
    const creds = lerCredenciaisAmazon()
    if (!creds) return [] // sem credenciais, nenhuma oportunidade — nunca inventar dado

    const itens = await this.searchItems({ searchIndex: category })
    return itens.map((item) => ({
      providerId: 'amazon-associados',
      productName: item.title,
      category: category ?? 'não informado',
      price: item.price?.amount ?? null,
      salesVolumeRank: item.officialSalesRank?.rank ?? null,
      origin: 'OFFICIAL_API',
      source: 'Amazon Creators API (SearchItems)',
      lastVerifiedAt: item.consultedAt,
      canGenerateLinkAutomatically: true, // detailPageUrl já vem com partnerTag
      authorizedMediaAvailable: item.images.some((i) => i.usagePolicy !== 'PROHIBITED' && i.usagePolicy !== 'UNKNOWN'),
      rulesConfidence: 'MEDIUM',
      automationCost: 'FREE',
    }))
  }
}

/**
 * Mapeia a resposta bruta da API para o nosso formato — isola o parsing
 * pra poder ser testado sem rede (dado um JSON de exemplo).
 *
 * Regra crítica: `detailPageUrl` é usada EXATAMENTE como a API devolveu.
 * Nunca reconstruída, nunca com parâmetro removido/alterado.
 */
export function mapearItemAmazon(item: Record<string, any>): AmazonItem {
  const browseNodeRank = item?.BrowseNodeInfo?.BrowseNodes?.[0]?.SalesRank
  const websiteRank = item?.BrowseNodeInfo?.WebsiteSalesRank?.SalesRank

  let officialSalesRank: AmazonSalesRank | null = null
  if (typeof browseNodeRank === 'number') {
    officialSalesRank = { tipo: 'browse_node_sales_rank', rank: browseNodeRank, categoria: item?.BrowseNodeInfo?.BrowseNodes?.[0]?.DisplayName ?? 'não informado' }
  } else if (typeof websiteRank === 'number') {
    officialSalesRank = { tipo: 'website_sales_rank', rank: websiteRank, categoria: 'geral' }
  }

  return {
    asin: item.ASIN,
    title: item?.ItemInfo?.Title?.DisplayValue ?? '(sem título)',
    // A própria URL devolvida pela API — nunca reconstruída manualmente.
    detailPageUrl: item.DetailPageURL,
    price: item?.Offers?.Listings?.[0]?.Price
      ? { amount: item.Offers.Listings[0].Price.Amount, currency: item.Offers.Listings[0].Price.Currency ?? CURRENCY }
      : null,
    images: item?.Images?.Primary?.Large?.URL
      ? [{ url: item.Images.Primary.Large.URL, usagePolicy: 'UNKNOWN' as MediaUsagePolicy }] // nunca assume social-reuse por padrão — ver AUTOPILOT-COMPLIANCE.md
      : [],
    officialSalesRank,
    consultedAt: new Date().toISOString(),
  }
}

export { MARKETPLACE as AMAZON_MARKETPLACE, LOCALE as AMAZON_LOCALE, CURRENCY as AMAZON_CURRENCY }
