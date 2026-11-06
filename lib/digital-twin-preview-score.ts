/**
 * DigitalTwinPreviewScore (Rodada 8, regra 30) — nota composta de uma
 * prévia gerada, combinando os gates já calculados nas etapas anteriores.
 * Abaixo do threshold, o Patrono NUNCA marca a prévia como `READY` —
 * tenta regenerar automaticamente antes (regra 31) e só then pede
 * intervenção humana.
 */

export interface PreviewScoreComponentes {
  voiceQuality: number // 0-100, de VoiceQualityGate
  lipSync: number | null // 0-100, null quando a etapa não se aplica (ex.: VOICE_ONLY)
  identity: number // 0-100, de IdentityQualityGate
  artifacts: number // 0-100 (quanto menor artefato visual detectado, mais alto)
  captionReadability: number // 0-100
  audio: number // 0-100
  tiktokCompatibility: number // 0-100, do preflight do TikTok
}

export interface DigitalTwinPreviewScoreResultado {
  nota: number
  aprovado: boolean
  componentesAbaixoDoEsperado: string[]
}

export const THRESHOLD_PREVIEW_SCORE = 70

const PESOS: Record<keyof PreviewScoreComponentes, number> = {
  voiceQuality: 0.2,
  lipSync: 0.15,
  identity: 0.2,
  artifacts: 0.1,
  captionReadability: 0.1,
  audio: 0.1,
  tiktokCompatibility: 0.15,
}

export function calcularPreviewScore(componentes: PreviewScoreComponentes, threshold: number = THRESHOLD_PREVIEW_SCORE): DigitalTwinPreviewScoreResultado {
  let pontos = 0
  let pesoTotal = 0
  const abaixo: string[] = []

  for (const chave of Object.keys(PESOS) as (keyof PreviewScoreComponentes)[]) {
    const valor = componentes[chave]
    if (valor == null) continue // etapa não aplicável não penaliza nem soma
    pontos += valor * PESOS[chave]
    pesoTotal += PESOS[chave]
    if (valor < threshold) abaixo.push(chave)
  }

  const nota = pesoTotal === 0 ? 0 : pontos / pesoTotal
  return { nota, aprovado: nota >= threshold && abaixo.length === 0, componentesAbaixoDoEsperado: abaixo }
}

// ── Regeneração automática (regra 31) ────────────────────────────────────

export const MAX_TENTATIVAS_REGENERACAO_AUTOMATICA = 3

export interface RegeneracaoDecisao {
  deveRegenerarAutomaticamente: boolean
  deveAcionarUsuaria: boolean
  motivo: string
}

/**
 * Nunca pede nova referência (foto/vídeo/voz) imediatamente após uma
 * falha de qualidade — tenta regenerar sozinho até o limite seguro. Só
 * aciona a usuária quando as tentativas automáticas se esgotarem.
 */
export function decidirRegeneracao(tentativasJaFeitas: number, maxTentativas: number = MAX_TENTATIVAS_REGENERACAO_AUTOMATICA): RegeneracaoDecisao {
  if (tentativasJaFeitas < maxTentativas) {
    return { deveRegenerarAutomaticamente: true, deveAcionarUsuaria: false, motivo: `Tentativa ${tentativasJaFeitas + 1} de ${maxTentativas} — regenerando automaticamente.` }
  }
  return { deveRegenerarAutomaticamente: false, deveAcionarUsuaria: true, motivo: `${maxTentativas} tentativas automáticas esgotadas — precisa de intervenção.` }
}
