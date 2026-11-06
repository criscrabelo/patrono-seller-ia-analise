/**
 * Acesso a dados do Digital Twin — SEMPRE escopado por `workspaceId`
 * (resolvido no servidor, nunca aceito do corpo/query da requisição).
 * Toda consulta inclui `workspaceId` no `where` — um id de asset/perfil de
 * outro workspace nunca é encontrado, mesmo que alguém tente adivinhar o
 * id (regra 44: isolamento nunca depende só do frontend não mostrar o
 * botão certo).
 */

import { prisma } from './prisma'
import type { DigitalTwinProfile, VoiceProfile, IdentityConsent, VoiceConsent } from './digital-twin'

/** Bucket PRIVADO do Supabase Storage usado por todos os assets do Digital Twin (rosto/voz/vídeo de referência/prévias) — nunca público. */
export const BUCKET_DIGITAL_TWIN_PRIVADO = 'digital-twin-private'

export async function obterPerfilDigitalTwin(workspaceId: string) {
  return prisma.digitalTwinProfile.findUnique({ where: { workspaceId } })
}

export async function obterVoiceProfile(workspaceId: string, voiceProfileId: string) {
  return prisma.voiceProfile.findFirst({ where: { id: voiceProfileId, workspaceId } })
}

export async function obterIdentityConsent(workspaceId: string, consentId: string) {
  return prisma.identityConsent.findFirst({ where: { id: consentId, workspaceId } })
}

export async function obterVoiceConsent(workspaceId: string, consentId: string) {
  return prisma.voiceConsent.findFirst({ where: { id: consentId, workspaceId } })
}

/** Nunca devolve um asset de outro workspace, mesmo passando o id certo. */
export async function obterAssetDigitalTwin(workspaceId: string, assetId: string) {
  return prisma.digitalTwinAsset.findFirst({ where: { id: assetId, workspaceId } })
}

export async function listarAssetsDigitalTwin(workspaceId: string, profileId: string) {
  return prisma.digitalTwinAsset.findMany({ where: { workspaceId, profileId }, orderBy: { createdAt: 'desc' } })
}

/**
 * Monta os objetos de domínio (`lib/digital-twin.ts`) a partir do banco,
 * já escopados pelo workspace da sessão. Usado por `podeGerarComDigitalTwin()`.
 */
export async function carregarContextoDigitalTwin(workspaceId: string): Promise<{
  profile: DigitalTwinProfile | null
  voiceProfile: VoiceProfile | null
  identityConsent: IdentityConsent | null
  voiceConsent: VoiceConsent | null
}> {
  const profileRow = await obterPerfilDigitalTwin(workspaceId)
  if (!profileRow) return { profile: null, voiceProfile: null, identityConsent: null, voiceConsent: null }

  const [voiceProfileRow, identityConsentRow] = await Promise.all([
    profileRow.voiceProfileId ? obterVoiceProfile(workspaceId, profileRow.voiceProfileId) : null,
    profileRow.identityConsentId ? obterIdentityConsent(workspaceId, profileRow.identityConsentId) : null,
  ])
  const voiceConsentRow = voiceProfileRow?.consentId ? await obterVoiceConsent(workspaceId, voiceProfileRow.consentId) : null

  return {
    profile: {
      id: profileRow.id,
      workspaceId: profileRow.workspaceId,
      ownerUserId: profileRow.ownerUserId,
      displayName: profileRow.displayName,
      identityReferenceId: profileRow.identityConsentId,
      voiceProfileId: profileRow.voiceProfileId,
      consentStatus: (identityConsentRow?.status as DigitalTwinProfile['consentStatus']) ?? 'NOT_REQUESTED',
      enabled: profileRow.enabled,
      approvedAt: profileRow.approvedAt,
      createdAt: profileRow.createdAt,
      updatedAt: profileRow.updatedAt,
    },
    voiceProfile: voiceProfileRow
      ? {
          id: voiceProfileRow.id,
          workspaceId: voiceProfileRow.workspaceId,
          ownerUserId: voiceProfileRow.ownerUserId,
          referenceAudio: null, // nunca exposto fora do storage privado
          consentId: voiceProfileRow.consentId,
          provider: voiceProfileRow.provider,
          language: voiceProfileRow.language,
          enabled: voiceProfileRow.enabled,
          createdAt: voiceProfileRow.createdAt,
        }
      : null,
    identityConsent: identityConsentRow
      ? {
          id: identityConsentRow.id,
          subjectUserId: identityConsentRow.subjectUserId,
          purpose: identityConsentRow.purpose,
          status: identityConsentRow.status as IdentityConsent['status'],
          grantedAt: identityConsentRow.grantedAt,
          revokedAt: identityConsentRow.revokedAt,
          expiresAt: identityConsentRow.expiresAt,
        }
      : null,
    voiceConsent: voiceConsentRow
      ? {
          id: voiceConsentRow.id,
          subjectUserId: voiceConsentRow.subjectUserId,
          purpose: voiceConsentRow.purpose,
          status: voiceConsentRow.status as VoiceConsent['status'],
          grantedAt: voiceConsentRow.grantedAt,
          revokedAt: voiceConsentRow.revokedAt,
          expiresAt: voiceConsentRow.expiresAt,
        }
      : null,
  }
}
