/**
 * MercadoLivreOpportunitySource (Rodada 5) — segundo Opportunity Source
 * real, usando (quando configurado) os endpoints oficiais de tendências/
 * destaques do Mercado Livre para o Radar.
 *
 * REGRA CRÍTICA: Mercado Livre NÃO é link automático ainda. As regras do
 * programa de afiliados exigem geração pela ferramenta oficial deles —
 * este provider nunca fabrica `detailPageUrl`/link de afiliada.
 * Capacidades sempre fixas:
 *   productDiscovery = AUTOMATIC (podemos achar o produto sozinhos)
 *   affiliateLinkGeneration = ASSISTED (a usuária gera o link na
 *     ferramenta oficial do Mercado Livre; o Patrono só aponta o produto)
 *
 * Também nunca transforma diretamente uma página de ranking/categoria/
 * busca em link — sempre resolve para o PRODUTO individual primeiro.
 *
 * Sem credenciais configuradas (`MERCADO_LIVRE_APP_ID`,
 * `MERCADO_LIVRE_CLIENT_SECRET`): healthCheck() devolve
 * "MERCADO LIVRE — AGUARDANDO CONFIGURAÇÃO", `getCandidates()` devolve
 * lista vazia — nunca inventa oportunidade.
 */

import type { AffiliateOpportunity, OpportunitySource } from './affiliate-discovery'

export const MERCADO_LIVRE_CAPABILITY = {
  productDiscovery: 'AUTOMATIC',
  affiliateLinkGeneration: 'ASSISTED',
} as const

export interface MercadoLivreCredentials {
  appId: string
  clientSecret: string
}

export function lerCredenciaisMercadoLivre(): MercadoLivreCredentials | null {
  const appId = process.env.MERCADO_LIVRE_APP_ID
  const clientSecret = process.env.MERCADO_LIVRE_CLIENT_SECRET
  if (!appId || !clientSecret) return null
  return { appId, clientSecret }
}

export type MercadoLivreHealthStatus =
  | { configured: false; status: 'AGUARDANDO CONFIGURAÇÃO'; message: string }
  | { configured: true; status: 'OK' | 'ERROR'; message: string }

export interface MercadoLivreHighlight {
  productId: string
  title: string
  category: string
  officialTrendRank: number | null // vem de /trends — null quando a API não devolveu, nunca inventado
  price: number | null
  productPageUrl: string // página PÚBLICA do produto — NUNCA um link de afiliado
  consultedAt: string
}

/**
 * Distinção obrigatória (Rodada 5): "afiliado por venda" (o que este
 * arquivo trata) é DIFERENTE de "campanha de Criador" do Mercado Livre
 * (remunerada por visualização). Campanhas de Criador que exigem produto
 * físico real na gravação não podem ser preenchidas com vídeo gerado por
 * IA fingindo ser a gravação do produto — isso é fraude de conteúdo, não
 * automação.
 */
export type TipoOportunidadeMercadoLivre = 'AFILIADO_POR_VENDA' | 'CAMPANHA_DE_CRIADOR'

export interface RequisitoCampanhaCriador {
  tipo: TipoOportunidadeMercadoLivre
  physicalProductRequired: boolean
}

/**
 * Bloqueia a submissão automática quando a campanha exige produto físico
 * real e não temos confirmação de que o conteúdo é uma gravação real (não
 * gerado por IA). Nunca deixa passar por omissão.
 */
export function podeSubmeterAutomaticamente(
  requisito: RequisitoCampanhaCriador,
  conteudo: { geradoPorIA: boolean }
): { permitido: boolean; motivo: string } {
  if (requisito.tipo === 'CAMPANHA_DE_CRIADOR' && requisito.physicalProductRequired && conteudo.geradoPorIA) {
    return {
      permitido: false,
      motivo: 'PHYSICAL_PRODUCT_REQUIRED: esta campanha de Criador exige gravação real do produto físico — vídeo gerado por IA não pode substituir isso.',
    }
  }
  return { permitido: true, motivo: 'Sem exigência de produto físico incompatível com o conteúdo.' }
}

export class MercadoLivreOpportunitySource implements OpportunitySource {
  private fetcher: typeof fetch

  constructor(fetcher: typeof fetch = fetch) {
    this.fetcher = fetcher
  }

  async healthCheck(): Promise<MercadoLivreHealthStatus> {
    const creds = lerCredenciaisMercadoLivre()
    if (!creds) {
      return {
        configured: false,
        status: 'AGUARDANDO CONFIGURAÇÃO',
        message: 'Defina MERCADO_LIVRE_APP_ID e MERCADO_LIVRE_CLIENT_SECRET para conectar.',
      }
    }
    return { configured: true, status: 'OK', message: 'Credenciais presentes (nenhuma chamada de verificação feita nesta rodada).' }
  }

  /** `/highlights` e `/trends` oficiais — quando configurado. Nunca devolve link de afiliado. */
  async buscarDestaquesETendencias(category?: string): Promise<MercadoLivreHighlight[]> {
    const creds = lerCredenciaisMercadoLivre()
    if (!creds) return []

    const res = await this.fetcher(
      `https://api.mercadolibre.com/highlights/MLB/category${category ? `/${category}` : ''}`,
      { headers: { authorization: `Bearer ${creds.clientSecret}` } } // placeholder — fluxo OAuth real fica pra quando isso for de fato implementado
    )
    const data = await res.json()
    if (!res.ok) throw new Error(data?.message || 'Falha ao consultar /highlights do Mercado Livre')

    return (data.content ?? []).map((item: Record<string, any>) => ({
      productId: item.id,
      title: item.name ?? '(sem título)',
      category: category ?? 'não informado',
      officialTrendRank: typeof item.position === 'number' ? item.position : null,
      price: null, // /highlights não traz preço — nunca inventado; buscar em endpoint de item se necessário
      productPageUrl: item.permalink ?? `https://produto.mercadolivre.com.br/${item.id}`,
      consultedAt: new Date().toISOString(),
    }))
  }

  async getCandidates({ category }: { workspaceId: string; category?: string }): Promise<AffiliateOpportunity[]> {
    const creds = lerCredenciaisMercadoLivre()
    if (!creds) return []

    const destaques = await this.buscarDestaquesETendencias(category)
    return destaques.map((d) => ({
      providerId: 'mercado-livre',
      productName: d.title,
      category: d.category,
      price: d.price,
      salesVolumeRank: d.officialTrendRank,
      trending: d.officialTrendRank != null,
      origin: 'OFFICIAL_API',
      source: 'Mercado Livre /highlights',
      lastVerifiedAt: d.consultedAt,
      // Nunca automático: capacidade fixa desta fonte.
      canGenerateLinkAutomatically: false,
      requiresUserConsent: true, // a usuária precisa gerar o link na ferramenta oficial
      rulesConfidence: 'LOW',
      automationCost: 'FREE',
    }))
  }
}
