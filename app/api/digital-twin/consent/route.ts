import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { prisma } from '@/lib/prisma'
import { registrarAuditoria } from '@/lib/audit-log'
import { revogarIdentityConsent, revogarVoiceConsent } from '@/lib/digital-twin-revoke'
import { finalidadeAceita, VALIDADE_DO_CONSENTIMENTO_MS } from '@/lib/digital-twin-consentimento'

/** Registra consentimento (identidade ou voz) — sempre GRANTED explicitamente pela própria titular. */
export async function POST(req: NextRequest) {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const body = await req.json().catch(() => ({}))
  const { tipo, purpose } = body as { tipo?: 'identity' | 'voice'; purpose?: string }
  if (tipo !== 'identity' && tipo !== 'voice') {
    return NextResponse.json({ error: 'tipo precisa ser "identity" ou "voice".' }, { status: 400 })
  }
  // P2.33.1: consentimento ESPECÍFICO — só as finalidades conhecidas, com o texto exato; vale por 1 ano.
  if (!finalidadeAceita(tipo === 'identity' ? 'IMAGEM' : 'VOZ', purpose)) {
    return NextResponse.json({ error: 'Finalidade do consentimento não reconhecida.' }, { status: 400 })
  }
  const agora = new Date()

  const dataConsent = {
    workspaceId: session.user.workspaceId,
    subjectUserId: session.user.id,
    purpose: purpose.trim(),
    status: 'GRANTED',
    grantedAt: agora,
    expiresAt: new Date(agora.getTime() + VALIDADE_DO_CONSENTIMENTO_MS),
  }

  const consent =
    tipo === 'identity' ? await prisma.identityConsent.create({ data: dataConsent }) : await prisma.voiceConsent.create({ data: dataConsent })

  // Amarra o consentimento ao perfil automaticamente — a usuária nunca
  // precisa "linkar" nada manualmente (regra 1: sem passo técnico).
  const profile = await prisma.digitalTwinProfile.findUnique({ where: { workspaceId: session.user.workspaceId } })
  if (profile) {
    if (tipo === 'identity') {
      await prisma.digitalTwinProfile.update({ where: { id: profile.id }, data: { identityConsentId: consent.id } })
    } else {
      const voiceProfile = profile.voiceProfileId
        ? await prisma.voiceProfile.update({ where: { id: profile.voiceProfileId }, data: { consentId: consent.id } })
        : await prisma.voiceProfile.create({ data: { workspaceId: session.user.workspaceId, ownerUserId: session.user.id, consentId: consent.id } })
      if (!profile.voiceProfileId) {
        await prisma.digitalTwinProfile.update({ where: { id: profile.id }, data: { voiceProfileId: voiceProfile.id } })
      }
    }
  }

  await registrarAuditoria({
    workspaceId: session.user.workspaceId,
    userId: session.user.id,
    action: `digital_twin.${tipo}_consent_granted`,
    entityType: tipo === 'identity' ? 'IdentityConsent' : 'VoiceConsent',
    entityId: consent.id,
    metadata: { purpose },
  })

  return NextResponse.json(consent)
}

/** Revogação — impede novas gerações imediatamente (lib/digital-twin-revoke.ts). */
export async function DELETE(req: NextRequest) {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const { searchParams } = new URL(req.url)
  const tipo = searchParams.get('tipo')
  const consentId = searchParams.get('consentId')
  if (!consentId || (tipo !== 'identity' && tipo !== 'voice')) {
    return NextResponse.json({ error: 'tipo e consentId são obrigatórios.' }, { status: 400 })
  }

  // P2.33.1: por padrão a revogação também apaga o material de origem; `apagarMateriais=0` só o desativa.
  const apagarMateriais = searchParams.get('apagarMateriais') !== '0'
  let exclusao
  try {
    exclusao = tipo === 'identity'
      ? await revogarIdentityConsent(session.user.workspaceId, consentId, session.user.id, { apagarMateriais })
      : await revogarVoiceConsent(session.user.workspaceId, consentId, session.user.id, { apagarMateriais })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha ao revogar.'
    return NextResponse.json({ error: msg }, { status: /própria pessoa/.test(msg) ? 403 : 404 })
  }

  return NextResponse.json({ success: true, ...exclusao })
}
