/**
 * Retenção de prévias (Rodada 8, regra 42) — `GENERATED_PREVIEW` rejeitada
 * ou não usada expira (`DigitalTwinAsset.expiresAt`) e é limpa (Storage +
 * banco). Referências permanentes (FACE_IMAGE, REFERENCE_VIDEO,
 * VOICE_REFERENCE, CONSENT_EVIDENCE) nunca expiram por esta rotina.
 *
 * P2.33.1: a remoção é SEGURA (lib/digital-twin-exclusao.ts) — o registro só sai depois de o storage
 * confirmar que o arquivo sumiu; se não confirmar, fica inativo e a próxima rodada tenta de novo.
 */

import { limparPreviasVencidas, type PortasDeExclusao } from './digital-twin-exclusao'

export const RETENCAO_PREVIEW_MS = 7 * 24 * 60 * 60 * 1000 // 7 dias

/** Calcula a data de expiração para uma nova prévia — chamado ao criar o asset. */
export function calcularExpiracaoPreview(agora: Date = new Date()): Date {
  return new Date(agora.getTime() + RETENCAO_PREVIEW_MS)
}

/** Remove (Storage + banco) prévias já expiradas — nunca mexe em referência permanente. Devolve quantas saíram. */
export async function limparPreviewsExpiradas(agora: Date = new Date(), portas?: PortasDeExclusao): Promise<number> {
  return (await limparPreviasVencidas(agora, portas)).apagados
}
