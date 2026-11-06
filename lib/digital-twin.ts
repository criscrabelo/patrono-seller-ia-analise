/**
 * Digital Twin da proprietária — FUNDAÇÕES apenas (complemento à Rodada 6).
 *
 * Objetivo futuro: o Patrono gerar vídeos usando a aparência e a voz
 * consistentes da própria proprietária (identidade facial, sincronização
 * labial, roteiros/cenários variados) sem gravação manual de cada vídeo —
 * uma REPRESENTAÇÃO DIGITAL AUTORIZADA da própria dona da conta, nunca uma
 * ferramenta genérica de impersonação de terceiros.
 *
 * Esta rodada NÃO implementa geração de avatar, clonagem de voz nem
 * treinamento — só os tipos/contratos e os gates de segurança (consentimento,
 * kill switch, Presenter Mode) para que a etapa seguinte não precise
 * redesenhar nada. Nenhum provider concreto é acoplado aqui.
 *
 * Pipeline futuro (documentado, não implementado):
 *   Produto → Opportunity Radar → Script → Voice Clone → Digital Twin →
 *   Lip Sync → Renderer → TikTok Preflight → Commercial Disclosure →
 *   AI Content Disclosure → Consent Gate → Direct Post → Metrics →
 *   Sale/Commission → Learning Engine
 */

// ── Consentimento ──────────────────────────────────────────────────────
// Nenhuma geração usando rosto/voz da proprietária pode acontecer sem um
// consentimento GRANTED e não revogado/expirado — checado a cada job, não
// só uma vez no cadastro.

export const CONSENT_STATUSES = ['NOT_REQUESTED', 'GRANTED', 'REVOKED', 'EXPIRED'] as const
export type ConsentStatus = (typeof CONSENT_STATUSES)[number]

export interface IdentityConsent {
  id: string
  subjectUserId: string // sempre a própria titular — nunca um terceiro
  purpose: string // finalidade registrada (ex.: "geração de vídeos de divulgação de produtos")
  status: ConsentStatus
  grantedAt: Date | null
  revokedAt: Date | null
  expiresAt: Date | null
}

export interface VoiceConsent {
  id: string
  subjectUserId: string
  purpose: string
  status: ConsentStatus
  grantedAt: Date | null
  revokedAt: Date | null
  expiresAt: Date | null
}

function consentimentoValido(consent: { status: ConsentStatus; expiresAt: Date | null } | null, agora: Date = new Date()): boolean {
  if (!consent) return false
  if (consent.status !== 'GRANTED') return false
  if (consent.expiresAt != null && consent.expiresAt.getTime() <= agora.getTime()) return false
  return true
}

// ── Perfis (tipos apenas — sem persistência nesta rodada) ────────────────

export interface DigitalTwinProfile {
  id: string
  workspaceId: string
  ownerUserId: string
  displayName: string
  identityReferenceId: string | null // referência ao material biométrico de rosto — nunca a mídia em si
  voiceProfileId: string | null
  consentStatus: ConsentStatus
  enabled: boolean // kill switch — "DESATIVAR MEU AVATAR"
  approvedAt: Date | null // aprovação ÚNICA do perfil (Rodada 8, regra 24) — não é aprovação por vídeo
  createdAt: Date
  updatedAt: Date
}

export interface VoiceProfile {
  id: string
  workspaceId: string
  ownerUserId: string
  referenceAudio: string | null // caminho/referência PRIVADA — nunca exposta publicamente
  consentId: string | null
  provider: string | null // preenchido só quando um provider real for escolhido (ex.: 'chatterbox-tts')
  language: string
  enabled: boolean
  createdAt: Date
}

// ── Kill switch + gate de geração ─────────────────────────────────────────
// "DESATIVAR MEU AVATAR": quando enabled=false (perfil ou voz), nenhuma nova
// geração usa rosto/voz da proprietária. Todo job pendente deve checar o
// status IMEDIATAMENTE ANTES de gerar — nunca confiar num status checado
// no início do job.

export interface DigitalTwinGerarDecisao {
  permitido: boolean
  motivo: string
}

export function podeGerarComDigitalTwin(params: {
  profile: DigitalTwinProfile | null
  voiceProfile: VoiceProfile | null
  identityConsent: IdentityConsent | null
  voiceConsent: VoiceConsent | null
  agora?: Date
}): DigitalTwinGerarDecisao {
  const agora = params.agora ?? new Date()

  if (!params.profile) return { permitido: false, motivo: 'Nenhum DigitalTwinProfile cadastrado.' }
  if (!params.profile.enabled) return { permitido: false, motivo: 'Avatar desativado pela proprietária (kill switch).' }
  if (!consentimentoValido(params.identityConsent, agora)) {
    return { permitido: false, motivo: 'Consentimento de identidade ausente, revogado ou expirado.' }
  }

  if (!params.voiceProfile) return { permitido: false, motivo: 'Nenhum VoiceProfile cadastrado.' }
  if (!params.voiceProfile.enabled) return { permitido: false, motivo: 'Voz clonada desativada pela proprietária.' }
  if (!consentimentoValido(params.voiceConsent, agora)) {
    return { permitido: false, motivo: 'Consentimento de voz ausente, revogado ou expirado.' }
  }

  return { permitido: true, motivo: 'Perfil, voz e consentimentos válidos.' }
}

// ── Providers desacoplados (contratos apenas) ────────────────────────────
// Nenhuma implementação concreta nesta rodada — nenhum SaaS pago contratado.

/**
 * O Chatterbox é zero-shot (regra 10 da Continuação da Retomada da Rodada
 * 9, confirmado inspecionando o código real de `chatterbox/mtl_tts.py`:
 * `generate(text, language_id, audio_prompt_path=...)`) — não existe
 * nenhum conceito de "voice ID" persistente devolvido por uma etapa de
 * enrollment/clonagem. Cada síntese recebe o áudio de referência
 * autorizado diretamente (`audioPromptPath`); não inventar um voiceId.
 */
export interface VoiceCloneProvider {
  sintetizar(params: { audioPromptPath: string; texto: string; idioma?: string }): Promise<{ audioUrl: string }>
}

export interface AvatarVideoProvider {
  gerarVideo(params: { identityReferenceId: string; roteiro: string; cenario?: string; roupa?: string; enquadramento?: string }): Promise<{ videoUrl: string }>
}

export interface LipSyncProvider {
  sincronizar(params: { videoUrl: string; audioUrl: string }): Promise<{ videoUrl: string }>
}

// ── Presenter Mode ────────────────────────────────────────────────────────
// Modo padrão (único modo desta rodada): o avatar apresenta informações
// VERIFICADAS do produto, nunca inventa experiência pessoal ("eu usei",
// "eu testei", "eu recomendo porque uso"). Produto pode ser sintético na
// imagem do avatar, mas o CONTEÚDO sobre o produto nunca é falsificado.

const FRASES_DEPOIMENTO_PESSOAL_PROIBIDAS = [
  /\beu\s+us(ei|o|amos)\b/i,
  /\beu\s+test(ei|amos)\b/i,
  /\beu\s+recomendo\s+porque\s+us/i,
  /\bna\s+minha\s+experi[eê]ncia\b/i,
  /\bcompr(ei|amos)\s+e\s+adorei\b/i,
]

export interface PresenterModeValidation {
  valido: boolean
  motivo: string
}

/**
 * Bloqueia roteiro/legenda que simule depoimento pessoal não verídico do
 * avatar. Nunca permite o Digital Twin "mentir" que usou/testou o produto.
 */
export function validarPresenterMode(texto: string): PresenterModeValidation {
  for (const padrao of FRASES_DEPOIMENTO_PESSOAL_PROIBIDAS) {
    if (padrao.test(texto)) {
      return { valido: false, motivo: `Texto simula depoimento pessoal não verificável ("${texto.match(padrao)?.[0]}") — Presenter Mode só apresenta informação verificada do produto.` }
    }
  }
  return { valido: true, motivo: 'Nenhuma alegação de experiência pessoal detectada.' }
}

// ── Virtual Presentation vs Real Product Experience (Rodada 7) ───────────
// O avatar pode ser sintético; a EXPERIÊNCIA com o produto nunca pode ser
// falsificada. `UNBOXING_STYLE` pode existir como estilo visual, mas nunca
// afirma ou aparenta que a proprietária recebeu/testou fisicamente o
// produto se isso não aconteceu de verdade.

export type ProductExperienceMode = 'VIRTUAL_PRESENTATION' | 'REAL_PRODUCT_EXPERIENCE'

/** O Autopilot SEMPRE usa este modo — nunca REAL_PRODUCT_EXPERIENCE automaticamente. */
export const AUTOPILOT_PRODUCT_EXPERIENCE_MODE: ProductExperienceMode = 'VIRTUAL_PRESENTATION'

export interface UnboxingStyleValidation {
  permitido: boolean
  motivo: string
}

/**
 * `UNBOXING_STYLE` só é permitido em `VIRTUAL_PRESENTATION` quando o
 * roteiro não afirma posse/recebimento físico real — nunca em
 * `REAL_PRODUCT_EXPERIENCE` gerado automaticamente pelo Autopilot (isso
 * exigiria prova real de experiência, que o Autopilot nunca fabrica).
 */
export function validarUnboxingStyle(params: { mode: ProductExperienceMode; afirmaRecebimentoFisicoReal: boolean }): UnboxingStyleValidation {
  if (params.mode === 'REAL_PRODUCT_EXPERIENCE' && !params.afirmaRecebimentoFisicoReal) {
    return { permitido: false, motivo: 'REAL_PRODUCT_EXPERIENCE exige confirmação real de recebimento — o Autopilot nunca gera essa alegação sozinho.' }
  }
  if (params.mode === 'VIRTUAL_PRESENTATION' && params.afirmaRecebimentoFisicoReal) {
    return { permitido: false, motivo: 'VIRTUAL_PRESENTATION nunca pode afirmar/aparentar recebimento físico real do produto.' }
  }
  return { permitido: true, motivo: 'Estilo de apresentação consistente com o modo de experiência declarado.' }
}
