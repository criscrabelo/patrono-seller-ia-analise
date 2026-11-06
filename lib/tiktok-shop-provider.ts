/**
 * TikTokShopAffiliateProvider (Rodada 5) — PROVIDER de afiliados do TikTok
 * Shop: produtos, oportunidades, links, comissões, vendas. Propositalmente
 * SEPARADO de `lib/tiktok-channel.ts` (TikTokChannel), que cuida só de
 * criação/publicação/disclosure/consentimento/status/métricas do CANAL
 * TikTok. Nunca misturar os dois — uma conta pode ter o canal conectado
 * sem ter o TikTok Shop, e vice-versa.
 *
 * Sem credenciais (`TIKTOK_SHOP_APP_KEY`, `TIKTOK_SHOP_APP_SECRET`):
 * healthCheck() devolve "TIKTOK SHOP — AGUARDANDO CONFIGURAÇÃO",
 * getCandidates() devolve lista vazia — nunca inventa oportunidade.
 */

import type { AffiliateOpportunity, OpportunitySource } from './affiliate-discovery'

export interface TikTokShopCredentials {
  appKey: string
  appSecret: string
}

export function lerCredenciaisTikTokShop(): TikTokShopCredentials | null {
  const appKey = process.env.TIKTOK_SHOP_APP_KEY
  const appSecret = process.env.TIKTOK_SHOP_APP_SECRET
  if (!appKey || !appSecret) return null
  return { appKey, appSecret }
}

export type TikTokShopHealthStatus =
  | { configured: false; status: 'AGUARDANDO CONFIGURAÇÃO'; message: string }
  | { configured: true; status: 'OK' | 'ERROR'; message: string }

/**
 * Implementação atual: nenhuma API oficial de afiliados do TikTok Shop foi
 * confirmada/registrada nesta rodada (ver REGRAS-PROVIDERS-E-CANAIS.md,
 * seção "TikTok Shop" — status A VERIFICAR). Por isso este provider nunca
 * fabrica produto, link ou comissão — existe só para o resto do código já
 * poder depender da interface `OpportunitySource`, trocando esta classe
 * pela integração real assim que a API/permissão for confirmada.
 */
export class TikTokShopAffiliateProvider implements OpportunitySource {
  async healthCheck(): Promise<TikTokShopHealthStatus> {
    const creds = lerCredenciaisTikTokShop()
    if (!creds) {
      return {
        configured: false,
        status: 'AGUARDANDO CONFIGURAÇÃO',
        message: 'Defina TIKTOK_SHOP_APP_KEY e TIKTOK_SHOP_APP_SECRET para conectar (API oficial ainda A VERIFICAR).',
      }
    }
    return { configured: true, status: 'ERROR', message: 'Credenciais presentes. O cliente oficial existe (lib/tiktok-shop-cliente.ts), mas a busca de produtos só funciona com a conta de criadora conectada e a Affiliate API liberada pelo TikTok; o caminho da busca será confirmado na primeira resposta real.' }
  }

  async getCandidates(): Promise<AffiliateOpportunity[]> {
    // Nunca inventa oportunidade sem uma API oficial confirmada — ver
    // TikTokShopAffiliateCapabilityProbe abaixo: só listaríamos algo com
    // capability = 'AVAILABLE' (AFFILIATE_API_APPROVAL_REQUIRED até lá).
    return []
  }
}

// ── TikTokShopAffiliateCapabilityProbe (Rodada 6, regra 17) ──────────────
// A documentação oficial do TikTok Shop Partner Center informa que a
// Affiliate API "is inactive by default" e precisa de aprovação de Account
// Manager/Partner Manager. Nunca assumimos que a conta brasileira já tem
// esse acesso — este probe representa o estado REAL, nunca um valor
// otimista/inventado.

export const TIKTOK_SHOP_CAPABILITY_STATUSES = [
  'NOT_CONFIGURED',
  'APP_REGISTERED',
  'CREATOR_AUTH_REQUIRED',
  'AFFILIATE_API_APPROVAL_REQUIRED',
  'AUTHORIZED',
  'AVAILABLE',
  'UNAVAILABLE_FOR_REGION',
  'ERROR',
] as const
export type TikTokShopCapabilityStatus = (typeof TIKTOK_SHOP_CAPABILITY_STATUSES)[number]

export interface TikTokShopCapabilityInput {
  appConfigured: boolean // TIKTOK_SHOP_APP_KEY/SECRET presentes
  creatorAutorizado: boolean // fluxo de Creator Authorization (OAuth) concluído
  affiliateApiAprovada: boolean // aprovação confirmada por Account/Partner Manager — NUNCA assumido true por padrão
  regiaoSuportada: boolean // região da conta é uma das suportadas pelo programa
  erro: string | null
}

/**
 * Calcula o estado real de capability do TikTok Shop Affiliate — nunca
 * "AVAILABLE" sem confirmação explícita de aprovação. Uma conta brasileira
 * recém-registrada, por padrão, para em `AFFILIATE_API_APPROVAL_REQUIRED`.
 */
export class TikTokShopAffiliateCapabilityProbe {
  calcular(input: TikTokShopCapabilityInput): TikTokShopCapabilityStatus {
    if (input.erro) return 'ERROR'
    if (!input.appConfigured) return 'NOT_CONFIGURED'
    if (!input.regiaoSuportada) return 'UNAVAILABLE_FOR_REGION'
    if (!input.creatorAutorizado) return 'CREATOR_AUTH_REQUIRED'
    if (!input.affiliateApiAprovada) return 'AFFILIATE_API_APPROVAL_REQUIRED'
    return 'AVAILABLE'
  }
}

// ── Creator Authorization (Rodada 6, regra 18) ────────────────────────────
// OAuth de CRIADORA no TikTok Shop — diferente de autorização de vendedora
// (seller) e diferente do token de parceiro (partner). Nunca misturar os
// três tipos de token — cada um tem escopo e finalidade próprios.

export type TikTokShopTokenType = 'creator' | 'seller' | 'partner'

export interface TikTokShopToken {
  type: TikTokShopTokenType
  accessToken: string
  openId: string
}

/** Garante em tempo de compilação/execução que um token não é usado no lugar de outro tipo. */
export function exigirTipoDeToken(token: TikTokShopToken, esperado: TikTokShopTokenType): TikTokShopToken {
  if (token.type !== esperado) {
    throw new Error(`Token do tipo "${token.type}" não pode ser usado onde se espera um token "${esperado}" — nunca misturar creator/seller/partner.`)
  }
  return token
}

export interface TikTokShopOAuthCredentials {
  appKey: string
  appSecret: string
  redirectUri: string
}

export function lerCredenciaisOAuthTikTokShop(): TikTokShopOAuthCredentials | null {
  const appKey = process.env.TIKTOK_SHOP_APP_KEY
  const appSecret = process.env.TIKTOK_SHOP_APP_SECRET
  const redirectUri = process.env.TIKTOK_SHOP_REDIRECT_URI
  if (!appKey || !appSecret || !redirectUri) return null
  return { appKey, appSecret, redirectUri }
}

/** Monta a URL de autorização de CRIADORA do TikTok Shop — nunca a mesma URL/escopo do fluxo de vendedora. */
export function montarUrlAutorizacaoCreatorTikTokShop(creds: TikTokShopOAuthCredentials, state: string): string {
  const params = new URLSearchParams({ app_key: creds.appKey, redirect_uri: creds.redirectUri, state })
  return `https://services.tiktokshop.com/open/authorize/creator?${params.toString()}`
}

// ── Product Discovery / Scoring / Showcase / Links / Orders (regras 19-23) ─
// Tudo abaixo só produz dado real quando a capability chegar a AVAILABLE —
// nunca uma resposta fictícia enquanto isso não acontecer.

export interface TikTokShopProductCandidate {
  productId: string
  title: string
  category: string
  commissionPercent: number | null
  price: number | null
  disponivel: boolean
  colaboracaoAberta: boolean // "Open Collaboration" — creator pode se candidatar sem convite
  automatizavel: boolean
  midiaAutorizada: boolean
  showcaseDisponivel: boolean
  desempenhoAnteriorPatrono: number | null // histórico REAL do Patrono (Sale/Commission já existentes) — null se nunca vendido
}

/**
 * Score de produtos do TikTok Shop — só chamado quando a capability é
 * AVAILABLE e há dados oficiais reais. Nunca inventa "mais vendido": usa
 * apenas os campos presentes no candidato (comissão, preço, categoria,
 * disponibilidade, colaboração aberta, automatizabilidade, mídia
 * autorizada, possibilidade de showcase, desempenho anterior real).
 */
export function calcularScoreProdutoTikTokShop(candidato: TikTokShopProductCandidate): number {
  let pontos = 0
  let pesoTotal = 0

  if (candidato.commissionPercent != null) {
    pontos += Math.min(candidato.commissionPercent, 50) * 2
    pesoTotal += 100
  }
  if (candidato.desempenhoAnteriorPatrono != null) {
    pontos += Math.min(candidato.desempenhoAnteriorPatrono, 100)
    pesoTotal += 100
  }
  pontos += candidato.disponivel ? 20 : 0
  pontos += candidato.colaboracaoAberta ? 20 : 0
  pontos += candidato.automatizavel ? 20 : 0
  pontos += candidato.midiaAutorizada ? 20 : 0
  pontos += candidato.showcaseDisponivel ? 20 : 0
  pesoTotal += 100

  return pesoTotal === 0 ? 0 : (pontos / pesoTotal) * 100
}

/**
 * Showcase — consultar/adicionar produto exige capability AVAILABLE e
 * colaboração confirmada. Nunca simula sucesso: sem essas condições,
 * devolve o motivo do bloqueio em vez de fingir que adicionou.
 */
export function podeAdicionarAoShowcase(candidato: TikTokShopProductCandidate, capability: TikTokShopCapabilityStatus): { permitido: boolean; motivo: string } {
  if (capability !== 'AVAILABLE') {
    return { permitido: false, motivo: `Capability "${capability}" — TikTok Shop Affiliate API ainda não está disponível para esta conta.` }
  }
  if (!candidato.colaboracaoAberta) {
    return { permitido: false, motivo: 'Produto exige colaboração confirmada antes de poder ser adicionado ao showcase.' }
  }
  return { permitido: true, motivo: 'Capability AVAILABLE e colaboração confirmada.' }
}

/**
 * Link do TikTok Shop — só usa a função oficial permitida ao nosso
 * tipo de conta/app; nunca fabrica URL manualmente.
 */
export function obterLinkOficialTikTokShop(candidato: TikTokShopProductCandidate, capability: TikTokShopCapabilityStatus, linkDaApi: string | null): string | null {
  if (capability !== 'AVAILABLE' || !linkDaApi) return null
  return linkDaApi
}

// ── Tracking de pedidos (regra 23) ────────────────────────────────────────

export interface TikTokShopOrder {
  orderId: string // idempotência: nunca cria Sale duplicada para o mesmo orderId
  productId: string
  commissionAmount: number | null
  status: string
  contentId: string | null // conteúdo/publicação que originou a venda, quando rastreável
}

