/**
 * DigitalTwinQualityGate (Rodada 7, regra 33) — última checagem antes de
 * `READY_TO_PUBLISH`. Reúne os resultados já calculados pelas etapas
 * anteriores do pipeline (identidade, voz, lip-sync, disclosures,
 * preflight do TikTok) — nunca recalcula do zero, só confere que nada
 * ficou pendente.
 */

export interface DigitalTwinQualityInput {
  identidadeOk: boolean
  audioOk: boolean
  lipSyncOk: boolean | null // null = etapa não usada neste conteúdo (ex.: VOICE_ONLY)
  duracaoDentroDoLimite: boolean
  legendasPresentes: boolean
  produtoAutorizado: boolean
  aiDisclosureAplicado: boolean
  commercialDisclosureAplicado: boolean | null // null = não se aplica a este conteúdo
  tiktokPreflightStatus: 'TECHNICALLY_VALID' | 'NOT_VERIFIED' | 'BLOCKED_BY_POLICY' | 'REQUIRES_USER_CONSENT'
}

export interface DigitalTwinQualityResultado {
  aprovado: boolean
  problemas: string[]
}

export function avaliarDigitalTwinQualityGate(input: DigitalTwinQualityInput): DigitalTwinQualityResultado {
  const problemas: string[] = []

  if (!input.identidadeOk) problemas.push('Identidade não validada.')
  if (!input.audioOk) problemas.push('Áudio não passou no Voice Quality Gate.')
  if (input.lipSyncOk === false) problemas.push('Lip-sync não passou na validação.')
  if (!input.duracaoDentroDoLimite) problemas.push('Duração fora do limite do canal.')
  if (!input.legendasPresentes) problemas.push('Legendas ausentes.')
  if (!input.produtoAutorizado) problemas.push('Produto sem autorização de mídia (MediaRightsGate).')
  if (!input.aiDisclosureAplicado) problemas.push('AI Content Disclosure obrigatório não aplicado.')
  if (input.commercialDisclosureAplicado === false) problemas.push('Commercial Disclosure obrigatório não aplicado.')
  if (input.tiktokPreflightStatus === 'BLOCKED_BY_POLICY') problemas.push('TikTok preflight bloqueou o conteúdo.')
  if (input.tiktokPreflightStatus === 'NOT_VERIFIED') problemas.push('TikTok preflight ainda não confirmou tecnicamente (creator_info indisponível).')

  return { aprovado: problemas.length === 0, problemas }
}
