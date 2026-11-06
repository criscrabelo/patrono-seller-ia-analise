import { NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { prisma } from '@/lib/prisma'
import { renovarTokenInstagram, inspecionarTokenMeta } from '@/lib/instagram'
import { decisaoDaRenovacaoManual } from '@/lib/instagram-renovacao'

export async function POST() {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const integracao = await prisma.integracao.findUnique({
    where: { workspaceId_plataforma: { workspaceId: session.user.workspaceId, plataforma: 'instagram' } },
  })

  if (!integracao || !integracao.accessToken) {
    return NextResponse.json({ error: 'Instagram não conectado' }, { status: 400 })
  }

  const extra = (integracao.extraData ?? {}) as Record<string, string>
  const appId = extra.appId
  const appSecret = extra.appSecret

  if (!appId || !appSecret) {
    return NextResponse.json(
      { error: 'Meta App ID e App Secret são necessários para renovar o token automaticamente. Reconecte o Instagram informando esses campos.' },
      { status: 400 }
    )
  }

  // P2.69 (revisão B1): pergunta à Meta ANTES de trocar. Token de usuário de sistema (sem prazo) não é renovado —
  // renovar o trocaria por um que expira; token não confirmado também não.
  const decisao = decisaoDaRenovacaoManual(await inspecionarTokenMeta({ accessToken: integracao.accessToken, appId, appSecret }))
  if (!decisao.renovar) return NextResponse.json({ error: decisao.motivo }, { status: 409 })

  try {
    const { accessToken: novoToken, expiresIn } = await renovarTokenInstagram({
      accessToken: integracao.accessToken,
      appId,
      appSecret,
    })

    const tokenExpiry = new Date(Date.now() + expiresIn * 1000)

    await prisma.integracao.update({
      where: { id: integracao.id },
      data: { accessToken: novoToken, tokenExpiry, updatedAt: new Date() },
    })

    return NextResponse.json({ ok: true, tokenExpiry: tokenExpiry.toISOString() })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha ao renovar token'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
