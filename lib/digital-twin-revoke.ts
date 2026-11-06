/**
 * Revogação de consentimento (Rodada 7, regra 8). Ao revogar identidade
 * OU voz: impede novas gerações, desativa `VoiceProfile` e
 * `DigitalTwinProfile` (kill switch), e mantém só os registros mínimos de
 * auditoria — nunca apaga o histórico de consentimento em si (é prova de
 * que existiu e foi revogado).
 *
 * P2.33.1: só a PRÓPRIA pessoa do consentimento revoga; a revogação também APAGA (com confirmação do
 * storage) todas as prévias que dependiam dele e, por padrão, o material de origem (rosto/voz/vídeo de
 * referência). `apagarMateriais: false` mantém os arquivos de origem inativos para uso futuro só com
 * novo consentimento — as prévias saem sempre.
 */

import { prisma } from './prisma'
import { registrarAuditoria } from './audit-log'
import { excluirMaterialDoConsentimento, type PortasDeExclusao } from './digital-twin-exclusao'

export interface OpcoesDaRevogacao { apagarMateriais?: boolean; portas?: PortasDeExclusao }

function exigirTitular(consent: { subjectUserId: string }, userId?: string) {
  if (userId && consent.subjectUserId !== userId) throw new Error('Só a própria pessoa do consentimento pode revogá-lo.')
}

export async function revogarIdentityConsent(workspaceId: string, consentId: string, userId?: string, opcoes: OpcoesDaRevogacao = {}) {
  const consent = await prisma.identityConsent.findFirst({ where: { id: consentId, workspaceId } })
  if (!consent) throw new Error('Consentimento de identidade não encontrado neste workspace.')
  exigirTitular(consent, userId)

  await prisma.$transaction([
    prisma.identityConsent.update({ where: { id: consentId }, data: { status: 'REVOKED', revokedAt: new Date() } }),
    prisma.digitalTwinProfile.updateMany({ where: { workspaceId, identityConsentId: consentId }, data: { enabled: false } }),
  ])
  const exclusao = await excluirMaterialDoConsentimento(workspaceId, 'IMAGEM', opcoes)

  await registrarAuditoria({
    workspaceId,
    userId: userId ?? null,
    action: 'digital_twin.identity_consent_revoked',
    entityType: 'IdentityConsent',
    entityId: consentId,
    metadata: { ...exclusao, apagarMateriais: opcoes.apagarMateriais !== false }, // nunca material biométrico
  })
  return exclusao
}

export async function revogarVoiceConsent(workspaceId: string, consentId: string, userId?: string, opcoes: OpcoesDaRevogacao = {}) {
  const consent = await prisma.voiceConsent.findFirst({ where: { id: consentId, workspaceId } })
  if (!consent) throw new Error('Consentimento de voz não encontrado neste workspace.')
  exigirTitular(consent, userId)

  await prisma.$transaction([
    prisma.voiceConsent.update({ where: { id: consentId }, data: { status: 'REVOKED', revokedAt: new Date() } }),
    prisma.voiceProfile.updateMany({ where: { workspaceId, consentId }, data: { enabled: false } }),
  ])

  const voiceProfile = await prisma.voiceProfile.findFirst({ where: { workspaceId, consentId } })
  if (voiceProfile) {
    await prisma.digitalTwinProfile.updateMany({ where: { workspaceId, voiceProfileId: voiceProfile.id }, data: { enabled: false } })
  }
  const exclusao = await excluirMaterialDoConsentimento(workspaceId, 'VOZ', opcoes)
  // Narrações com a voz sintetizada ainda não publicadas também saem (P2.33.1).
  const { excluirNarracoesComVozLocal } = await import('./narracao')
  const narracoes = await excluirNarracoesComVozLocal(workspaceId, opcoes.portas)

  await registrarAuditoria({
    workspaceId,
    userId: userId ?? null,
    action: 'digital_twin.voice_consent_revoked',
    entityType: 'VoiceConsent',
    entityId: consentId,
    metadata: { ...exclusao, narracoes, apagarMateriais: opcoes.apagarMateriais !== false },
  })
  return exclusao
}
