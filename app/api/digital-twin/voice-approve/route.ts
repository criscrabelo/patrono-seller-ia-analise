import { NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { prisma } from '@/lib/prisma'
import { registrarAuditoria } from '@/lib/audit-log'

/**
 * "Aprovar minha voz" (Rodada 9, regra 11) — aprovação ÚNICA da voz,
 * separada da aprovação do perfil completo (que inclui avatar). Depois
 * disso, o Autopilot reutiliza o VoiceProfile sem pedir aprovação de novo.
 */
export async function POST() {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const profile = await prisma.digitalTwinProfile.findUnique({ where: { workspaceId: session.user.workspaceId } })
  if (!profile || !profile.voiceProfileId) {
    return NextResponse.json({ error: 'Nenhuma voz para aprovar ainda — envie a referência de voz primeiro.' }, { status: 400 })
  }

  const [atualizado] = await prisma.$transaction([
    prisma.digitalTwinProfile.update({ where: { id: profile.id }, data: { voiceApprovedAt: new Date() } }),
    prisma.voiceProfile.update({ where: { id: profile.voiceProfileId }, data: { enabled: true } }),
  ])

  await registrarAuditoria({
    workspaceId: session.user.workspaceId,
    userId: session.user.id,
    action: 'digital_twin.voice_approved',
    entityType: 'VoiceProfile',
    entityId: profile.voiceProfileId,
    metadata: {},
  })

  return NextResponse.json(atualizado)
}

/** "Refazer referência" — desfaz a aprovação da voz (nunca apaga o consentimento). */
export async function DELETE() {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const profile = await prisma.digitalTwinProfile.findUnique({ where: { workspaceId: session.user.workspaceId } })
  if (!profile) return NextResponse.json({ error: 'Perfil não encontrado.' }, { status: 404 })

  const atualizado = await prisma.digitalTwinProfile.update({ where: { id: profile.id }, data: { voiceApprovedAt: null } })
  if (profile.voiceProfileId) {
    await prisma.voiceProfile.update({ where: { id: profile.voiceProfileId }, data: { enabled: false } })
  }

  await registrarAuditoria({
    workspaceId: session.user.workspaceId,
    userId: session.user.id,
    action: 'digital_twin.voice_approval_reset',
    entityType: 'VoiceProfile',
    entityId: profile.voiceProfileId ?? profile.id,
    metadata: {},
  })

  return NextResponse.json(atualizado)
}
