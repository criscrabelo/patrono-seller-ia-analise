import { NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { prisma } from '@/lib/prisma'
import { registrarAuditoria } from '@/lib/audit-log'
import { carregarContextoDigitalTwin } from '@/lib/digital-twin-store'
import { podeGerarComDigitalTwin } from '@/lib/digital-twin'

/**
 * "Aprovar meu Digital Twin" (regra 24) — aprovação ÚNICA do perfil, não
 * de cada vídeo futuro. Só permite aprovar quando ambos os consentimentos
 * estiverem GRANTED (nunca aprova um perfil sem consentimento válido).
 */
export async function POST() {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const contexto = await carregarContextoDigitalTwin(session.user.workspaceId)
  if (!contexto.profile) return NextResponse.json({ error: 'Crie o perfil do Digital Twin primeiro.' }, { status: 400 })

  const decisao = podeGerarComDigitalTwin({ ...contexto, profile: { ...contexto.profile, enabled: true } })
  if (!decisao.permitido) {
    return NextResponse.json({ error: `Não é possível aprovar ainda: ${decisao.motivo}` }, { status: 400 })
  }

  const atualizado = await prisma.digitalTwinProfile.update({
    where: { id: contexto.profile.id },
    data: { approvedAt: new Date(), enabled: true },
  })

  if (contexto.voiceProfile) {
    await prisma.voiceProfile.update({ where: { id: contexto.voiceProfile.id }, data: { enabled: true } })
  }

  await registrarAuditoria({
    workspaceId: session.user.workspaceId,
    userId: session.user.id,
    action: 'digital_twin.profile_approved',
    entityType: 'DigitalTwinProfile',
    entityId: atualizado.id,
    metadata: {},
  })

  return NextResponse.json(atualizado)
}

/** "Refazer" — desfaz a aprovação, sem apagar consentimentos/assets (a usuária reenvia só o que precisa). */
export async function DELETE() {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const profile = await prisma.digitalTwinProfile.findUnique({ where: { workspaceId: session.user.workspaceId } })
  if (!profile) return NextResponse.json({ error: 'Perfil não encontrado.' }, { status: 404 })

  const atualizado = await prisma.digitalTwinProfile.update({ where: { id: profile.id }, data: { approvedAt: null, enabled: false } })

  await registrarAuditoria({
    workspaceId: session.user.workspaceId,
    userId: session.user.id,
    action: 'digital_twin.profile_approval_reset',
    entityType: 'DigitalTwinProfile',
    entityId: profile.id,
    metadata: {},
  })

  return NextResponse.json(atualizado)
}
