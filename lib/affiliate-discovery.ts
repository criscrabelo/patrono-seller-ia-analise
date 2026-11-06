/**
 * Arquitetura FUTURA — NÃO implementada nesta rodada.
 *
 * Este arquivo só declara os TIPOS (contratos), sem nenhuma lógica de
 * execução, sem chamada de rede, sem integração externa. Existe para que
 * uma rodada futura tenha um contrato já pensado para implementar de
 * verdade, em vez de decidir a forma dos dados às pressas.
 *
 * Direção do produto (não executar ainda):
 *   descobrir programa → avaliar oportunidade → orientar/automatizar
 *   adesão → encontrar produtos → criar conteúdo → publicar → medir →
 *   vender → aprender.
 *
 * Regras já decididas para quando isso for implementado:
 * - Usar SOMENTE fontes oficiais ou autorizadas (nunca raspar/violar termos).
 * - Nunca assumir que um programa continua disponível para sempre —
 *   `AffiliateProvider.lastVerifiedAt`/`fonteDasRegras` (lib/affiliate-providers.ts)
 *   já existem para isso; `AffiliateProviderCapability.lastVerifiedAt`
 *   (lib/affiliate-provider-capabilities.ts) idem para o que é permitido.
 * - Nunca contornar exigência de aceite pessoal, CPF, dados bancários,
 *   autenticação ou qualquer confirmação que só a própria usuária pode dar
 *   — o motor deve preparar tudo e parar exatamente nesse ponto (ver
 *   `HumanActionRequired` em lib/automation.ts).
 * - Campo desconhecido fica `undefined`/`null` — nunca um número inventado
 *   "para preencher a tela".
 */

import type { AffiliateProvider } from './affiliate-providers'

/**
 * De onde veio o dado de uma oportunidade. `SCRAPED_UNOFFICIAL` NÃO existe
 * de propósito — nunca é uma fonte operacional aceita nesta plataforma.
 */
export const ORIGEM_OPORTUNIDADE = [
  'OFFICIAL_API',
  'AUTHORIZED_PARTNER_API',
  'AFFILIATE_PORTAL_IMPORT',
  'USER_PROVIDED',
  'MANUAL',
] as const
export type OrigemOportunidade = (typeof ORIGEM_OPORTUNIDADE)[number]

/**
 * Uma oportunidade concreta de venda dentro de um provider. Campos que
 * dependem de dado externo não confirmado ficam `null`/`undefined` — nunca
 * um valor inventado para não deixar a tela "vazia".
 *
 * Os campos de `Automatizabilidade` (Rodada 5) alimentam o
 * `AutomationFeasibilityScore` (lib/automation-feasibility.ts) — sem eles,
 * o Patrono só saberia "o que vende mais", não "o que consigo vender
 * sozinho, com segurança".
 */
export interface AffiliateOpportunity {
  providerId: string
  productName: string
  category: string
  price?: number | null
  commissionPercent?: number | null
  estimatedCommissionBRL?: number | null
  salesVolumeRank?: number | null
  trending?: boolean | null
  historicalConversionRate?: number | null
  channelFit?: string[]
  // ── Demanda (P2.14.5.12) — só quando a FONTE informa. Ausente = desconhecido.
  /** Nota média de avaliação, 0 a 5, como a fonte publica. */
  avaliacao?: number | null
  /** Quantidade de avaliações que sustenta a nota. */
  numeroDeAvaliacoes?: number | null
  /** Unidades em estoque informadas pela fonte. `0` = indisponível. */
  estoque?: number | null
  /**
   * Aderência ao perfil da loja (0–100), calculada pelo motor a partir de
   * dados reais do produto contra o perfil declarado. `null` = sem base.
   */
  aderenciaAoPerfil?: number | null
  origin: OrigemOportunidade
  source: string
  lastVerifiedAt: string

  // ── Automatizabilidade ──────────────────────────────────────────────
  canGenerateLinkAutomatically?: boolean
  authorizedMediaAvailable?: boolean
  canGenerateContent?: boolean
  canAutoPublish?: boolean
  requiresUserConsent?: boolean
  platformRestrictions?: string[]
  rulesConfidence?: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN'
  automationCost?: 'FREE' | 'LOW' | 'MEDIUM' | 'HIGH'
}

/** Uma fonte de candidatos a oportunidade — um provider, um canal, um dado informado pela usuária. */
export interface OpportunitySource {
  getCandidates(params: { workspaceId: string; category?: string }): Promise<AffiliateOpportunity[]>
}

/**
 * Compara oportunidades entre providers para sugerir onde vale mais a pena
 * divulgar. Implementação futura — hoje é só o contrato. `score` nunca
 * deve inventar valor para um campo `null`/`undefined` da oportunidade —
 * a ausência de dado entra como "desconhecido", não como zero.
 */
export interface OpportunityScorer {
  score(candidate: AffiliateOpportunity): number
  rank(candidates: AffiliateOpportunity[]): AffiliateOpportunity[]
}

/**
 * Varre categorias (moda, beleza, casa, eletrônicos, etc.) em providers
 * conhecidos (lib/affiliate-providers.ts) e providers novos ainda não
 * cadastrados, sempre por fonte oficial/autorizada. Implementação futura —
 * hoje é só o contrato.
 */
export interface AffiliateProgramDiscoveryEngine {
  discoverByCategory(category: string): Promise<AffiliateProvider[]>
  discoverOpportunities(providerId: string): Promise<AffiliateOpportunity[]>
}
