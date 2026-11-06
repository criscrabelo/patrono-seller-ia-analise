/**
 * CreativePresenterMode (Rodada 7, regra 35) — o Digital Twin é
 * preferencial, mas nunca requisito absoluto para publicar. O Autopilot
 * sempre consegue produzir ALGUM conteúdo, escolhendo o melhor recurso
 * disponível nesta ordem de prioridade.
 */

export const CREATIVE_PRESENTER_MODES = ['DIGITAL_TWIN', 'VOICE_ONLY', 'MOTION_GRAPHICS', 'PRODUCT_ONLY'] as const
export type CreativePresenterMode = (typeof CREATIVE_PRESENTER_MODES)[number]

export interface CreativeCapabilities {
  digitalTwinDisponivel: boolean // perfil+voz+consentimentos válidos, kill switch OFF, quality gate ok
  vozClonadaDisponivel: boolean // voz clonada sem avatar sincronizado
  motionGraphicsDisponivel: boolean // renderer (FFmpeg) sempre deveria estar disponível, mas é checado mesmo assim
}

/** Nunca bloqueia o Autopilot — sempre resolve para algum modo, mesmo sem nenhum recurso avançado (PRODUCT_ONLY). */
export function selecionarCreativePresenterMode(capacidades: CreativeCapabilities): CreativePresenterMode {
  if (capacidades.digitalTwinDisponivel) return 'DIGITAL_TWIN'
  if (capacidades.vozClonadaDisponivel) return 'VOICE_ONLY'
  if (capacidades.motionGraphicsDisponivel) return 'MOTION_GRAPHICS'
  return 'PRODUCT_ONLY'
}
