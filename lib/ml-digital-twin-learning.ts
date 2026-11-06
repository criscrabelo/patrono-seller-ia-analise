/**
 * Aprendizado de apresentação do Digital Twin (Rodada 9, complemento ML,
 * regras 17-19) — o ML pode aprender a MELHOR FORMA de apresentar
 * (duração da fala, avatar vs B-roll, posição da legenda, timing do CTA,
 * velocidade/pausa da voz), NUNCA a identidade em si (rosto, voz,
 * características pessoais — isso pertence ao `DigitalTwinIdentityLock`,
 * lib/digital-twin-identity-lock.ts, e nunca é reimplementado/bypassado
 * aqui).
 *
 * `nuncaAlterarIdentidade()` é uma barreira defensiva: qualquer sugestão
 * desta camada que, por engano, incluísse um campo de identidade (rosto/
 * voz/referência) lança erro imediatamente — nunca silenciosamente aceito.
 */

import { prisma } from './prisma'
import type { MLDecisionType } from './ml-types'

const CAMPOS_PROIBIDOS = [
  'face',
  'rosto',
  'voice',
  'voz',
  'identityreferenceid',
  'voiceprofileid',
  'referenceaudio',
  'faceimage',
  'audio',
  'biometr',
]

/** Barreira defensiva (regra 18) — nunca deixa um campo de identidade entrar numa sugestão de apresentação. */
export function nuncaAlterarIdentidade(sugestao: Record<string, unknown>): void {
  for (const chave of Object.keys(sugestao)) {
    const chaveNormalizada = chave.toLowerCase()
    if (CAMPOS_PROIBIDOS.some((proibido) => chaveNormalizada.includes(proibido))) {
      throw new Error(`Sugestão de aprendizado de apresentação do Digital Twin nunca pode incluir campo de identidade: "${chave}".`)
    }
  }
}

export interface DigitalTwinPresentationSuggestion {
  idealSpeechDurationSeconds: number | null
  avatarToBrollRatio: number | null // 0-1: fração do tempo em avatar vs B-roll
  captionPosition: 'top' | 'center' | 'bottom' | null
  ctaTimingSeconds: number | null
  amostras: number
  decisionType: MLDecisionType
  motivo: string
}

/**
 * Nesta rodada, `Conteudo` ainda não persiste qual modo do Digital Twin
 * foi usado (`avatar_style`, sempre `null` em `ml-feature-store.ts`) nem a
 * duração isolada da fala do avatar — só a duração total do vídeo. Sem
 * esse metadado estruturado, não há dado real para aprender apresentação
 * ainda. Retorna honestamente vazio (nunca inventado) — ver
 * DIGITAL-TWIN.md e MACHINE-LEARNING.md.
 */
export async function aprenderApresentacaoDigitalTwin(workspaceId: string): Promise<DigitalTwinPresentationSuggestion> {
  // Consulta real (mesmo que hoje sempre vazia) — nunca hardcoded sem
  // checar o banco, para que o dia em que o schema passar a registrar
  // avatar_style este código já funcione sem precisar ser reescrito.
  const totalConteudos = await prisma.conteudo.count({ where: { workspaceId } })

  const sugestao: DigitalTwinPresentationSuggestion = {
    idealSpeechDurationSeconds: null,
    avatarToBrollRatio: null,
    captionPosition: null,
    ctaTimingSeconds: null,
    amostras: 0,
    decisionType: 'RULE_BASED',
    motivo: `Conteudo ainda não registra o modo do Digital Twin usado (avatar_style) de forma estruturada — sem esse dado, não há aprendizado real de apresentação possível ainda (${totalConteudos} publicação(ões) no total, mas sem o metadado necessário).`,
  }
  nuncaAlterarIdentidade(sugestao as unknown as Record<string, unknown>)
  return sugestao
}
