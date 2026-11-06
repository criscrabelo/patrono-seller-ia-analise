/**
 * Integração do Digital Twin com o Autopilot (Rodada 8, regras 48-49, 25-27).
 *
 * O Autopilot escolhe o `CreativePresenterMode` sozinho — nunca pergunta
 * "Digital Twin? voz? cenário? formato?" a cada postagem. A única
 * configuração é a preferência global do perfil (regra 50).
 */

import { selecionarCreativePresenterMode, type CreativePresenterMode } from './creative-presenter-mode'
import { podeGerarComDigitalTwin, type DigitalTwinProfile, type VoiceProfile, type IdentityConsent, type VoiceConsent } from './digital-twin'
import { verificarIdentityLock } from './digital-twin-identity-lock'

export interface DecisaoModoAutopilot {
  modo: CreativePresenterMode
  motivo: string
}

/**
 * Decide o modo automaticamente: só considera `DIGITAL_TWIN`/`VOICE_ONLY`
 * quando (a) o perfil permite gerar (consentimentos válidos, kill switch
 * OFF), (b) a preferência global da usuária permite (`autoUseDigitalTwin`/
 * `autoUseVoice`), (c) o worker de geração está online, e (d) o worker
 * NÃO está pausado pelo terceiro kill switch (regra 34, Rodada 9 —
 * `DigitalTwinProfile.workerPaused`, independente do Autopilot ligado/
 * desligado e do Digital Twin habilitado/desabilitado). Sem isso, cai para
 * o fallback automaticamente — nunca trava a publicação.
 */
export function determinarModoAutopilot(params: {
  profile: DigitalTwinProfile | null
  voiceProfile: VoiceProfile | null
  identityConsent: IdentityConsent | null
  voiceConsent: VoiceConsent | null
  autoUseDigitalTwin: boolean
  autoUseVoice: boolean
  allowFallback: boolean
  workerOnline: boolean
  workerPaused: boolean
}): DecisaoModoAutopilot {
  const decisaoGate = podeGerarComDigitalTwin({
    profile: params.profile,
    voiceProfile: params.voiceProfile,
    identityConsent: params.identityConsent,
    voiceConsent: params.voiceConsent,
  })

  const workerDisponivel = params.workerOnline && !params.workerPaused
  const digitalTwinDisponivel = decisaoGate.permitido && params.autoUseDigitalTwin && workerDisponivel && !!params.profile?.approvedAt
  const vozClonadaDisponivel = decisaoGate.permitido && params.autoUseVoice && workerDisponivel

  if (!digitalTwinDisponivel && !vozClonadaDisponivel && !params.allowFallback) {
    return { modo: 'PRODUCT_ONLY', motivo: 'Fallback desabilitado pela preferência da usuária e Digital Twin/voz indisponíveis — usando produto apenas.' }
  }

  const modo = selecionarCreativePresenterMode({
    digitalTwinDisponivel,
    vozClonadaDisponivel,
    motionGraphicsDisponivel: true,
  })

  if (params.workerPaused && (decisaoGate.permitido && (params.autoUseDigitalTwin || params.autoUseVoice))) {
    return { modo, motivo: `Processador local (worker) pausado pela usuária — usando ${modo} até o worker ser reativado.` }
  }
  return { modo, motivo: decisaoGate.permitido ? decisaoGate.motivo : `Digital Twin indisponível (${decisaoGate.motivo}) — usando ${modo}.` }
}

// ── Segunda prévia: produto real/autorizado (regras 25-27) ────────────────

export type LayoutApresentacaoProduto = 'PRESENTER_PRODUCT_PANEL' | 'PRESENTER_INTRO_BROLL'

export interface SegundaPreviaInput {
  produtoNome: string
  produtoMidiaAutorizada: boolean
  roteiro: string
  legenda: string
  cta: string
}

export interface SegundaPreviaResultado {
  aprovado: boolean
  layout: LayoutApresentacaoProduto | null
  motivo: string
}

/**
 * Fluxo: Produto → roteiro → voz → avatar → produto autorizado → captions
 * → CTA → validação TikTok. NUNCA finge que a avatar segura o produto
 * fisicamente — usa um dos dois layouts seguros.
 */
export function prepararSegundaPreviaComProduto(input: SegundaPreviaInput): SegundaPreviaResultado {
  if (!input.produtoMidiaAutorizada) {
    return {
      aprovado: false,
      layout: 'PRESENTER_INTRO_BROLL', // avatar introduz, sem mostrar produto sem direito
      motivo: 'Produto sem mídia autorizada — avatar apresenta sem exibir o produto (MediaRightsGate).',
    }
  }
  return {
    aprovado: true,
    layout: 'PRESENTER_PRODUCT_PANEL', // avatar de um lado, produto real do outro — nunca nas mãos
    motivo: 'Produto com mídia autorizada — layout Presenter + product panel.',
  }
}

/** Reexporta para conveniência de quem só importa deste módulo. */
export { verificarIdentityLock }
