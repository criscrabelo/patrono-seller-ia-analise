/**
 * MediaUsagePolicy / MediaRightsGate (Rodada 5).
 *
 * Regra inegociável: nenhuma imagem/vídeo de um provider de afiliados
 * (Amazon, Mercado Livre etc.) pode ser publicada automaticamente em rede
 * social sem confirmação explícita de que o uso é permitido. "A Amazon
 * devolveu a imagem" NUNCA significa "posso postar no Instagram/TikTok" —
 * são dois direitos diferentes (exibir no app vs. reusar publicamente).
 *
 * Quando a licença não confirma uso social: BLOCKED_BY_POLICY. O
 * Orchestrator deve então tentar outro asset/produto antes de perguntar
 * pra usuária (ver lib/autopilot.ts).
 */

export const MEDIA_USAGE_POLICIES = [
  'DISPLAY_ONLY', // só pode ser mostrada dentro do próprio Patrono (ex.: pré-visualização de produto)
  'TEMPORARY_REFERENCE', // pode ser referenciada por um tempo limitado, não armazenada
  'SOCIAL_REUSE_ALLOWED', // pode ser publicada como está em rede social
  'DERIVATIVE_ALLOWED', // pode ser transformada (recorte, overlay, composição em vídeo)
  'UNKNOWN', // não confirmamos a licença — tratar como o mais restritivo
  'PROHIBITED', // uso proibido explicitamente
] as const
export type MediaUsagePolicy = (typeof MEDIA_USAGE_POLICIES)[number]

export interface MediaRightsRecord {
  assetId: string
  policy: MediaUsagePolicy
  source: string // ex.: 'amazon-creators-api', 'mercado-livre', 'upload-usuaria'
  canDisplay: boolean
  canTransform: boolean
  canReuseSocial: boolean
  canDerive: boolean
  canStore: boolean
  storageExpiresAt: Date | null // null = sem prazo definido (não confunda com "para sempre")
  authorizingSource: string // documento/termo que autoriza — nunca vazio
}

export type MediaRightsDecision =
  | { allowed: true; record: MediaRightsRecord }
  | { allowed: false; status: 'BLOCKED_BY_POLICY'; reason: string; record: MediaRightsRecord }

/**
 * Deriva os direitos reais a partir da policy — nunca assume o oposto do
 * que a policy diz (ex.: DISPLAY_ONLY nunca autoriza canReuseSocial, mesmo
 * que o chamador só peça "canDisplay").
 */
export function direitosDaPolicy(
  policy: MediaUsagePolicy,
  params: { assetId: string; source: string; authorizingSource: string; storageExpiresAt?: Date | null }
): MediaRightsRecord {
  const base = {
    assetId: params.assetId,
    policy,
    source: params.source,
    authorizingSource: params.authorizingSource,
    storageExpiresAt: params.storageExpiresAt ?? null,
  }

  switch (policy) {
    case 'DISPLAY_ONLY':
      return { ...base, canDisplay: true, canTransform: false, canReuseSocial: false, canDerive: false, canStore: false }
    case 'TEMPORARY_REFERENCE':
      return { ...base, canDisplay: true, canTransform: false, canReuseSocial: false, canDerive: false, canStore: false }
    case 'SOCIAL_REUSE_ALLOWED':
      return { ...base, canDisplay: true, canTransform: false, canReuseSocial: true, canDerive: false, canStore: true }
    case 'DERIVATIVE_ALLOWED':
      return { ...base, canDisplay: true, canTransform: true, canReuseSocial: true, canDerive: true, canStore: true }
    case 'PROHIBITED':
    case 'UNKNOWN':
      return { ...base, canDisplay: policy === 'UNKNOWN', canTransform: false, canReuseSocial: false, canDerive: false, canStore: false }
  }
}

/**
 * MediaRightsGate — decide se um asset pode ser usado para uma finalidade
 * específica ("publicar em rede social", "gerar derivativo", etc.).
 * Chamado pelo CreativeFactory ANTES de gerar qualquer conteúdo — nunca
 * depois.
 */
export function mediaRightsGate(
  record: MediaRightsRecord,
  finalidade: 'exibir' | 'transformar' | 'reusar-social' | 'derivar' | 'armazenar'
): MediaRightsDecision {
  const mapa: Record<typeof finalidade, keyof MediaRightsRecord> = {
    exibir: 'canDisplay',
    transformar: 'canTransform',
    'reusar-social': 'canReuseSocial',
    derivar: 'canDerive',
    armazenar: 'canStore',
  }
  const campo = mapa[finalidade]
  const permitido = record[campo] === true

  if (record.policy === 'UNKNOWN' && finalidade !== 'exibir') {
    return {
      allowed: false,
      status: 'BLOCKED_BY_POLICY',
      reason: `Direitos de mídia não confirmados (UNKNOWN) para "${finalidade}" — nunca assumimos autorização.`,
      record,
    }
  }

  if (!permitido) {
    return {
      allowed: false,
      status: 'BLOCKED_BY_POLICY',
      reason: `Policy "${record.policy}" (fonte: ${record.authorizingSource}) não autoriza "${finalidade}".`,
      record,
    }
  }

  if (record.storageExpiresAt && record.storageExpiresAt.getTime() < Date.now() && finalidade === 'armazenar') {
    return {
      allowed: false,
      status: 'BLOCKED_BY_POLICY',
      reason: 'Prazo de armazenamento autorizado já expirou.',
      record,
    }
  }

  return { allowed: true, record }
}
