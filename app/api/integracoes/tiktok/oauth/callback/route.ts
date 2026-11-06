import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { registrarAuditoria } from '@/lib/audit-log'
import { exigirSessao } from '@/lib/sessao'
import { lerCredenciaisOAuthTikTok, validarState, trocarCodigoPorToken } from '@/lib/tiktok-oauth'

/**
 * Callback real do OAuth do TikTok Channel. Nunca confia no `state` sem
 * verificar a assinatura.
 *
 * P2.17.4 (auditoria): exige SESSÃO e que o `state` seja do MESMO workspace
 * da sessão. Antes, um `state` válido de outro workspace (link enviado por
 * terceiro) gravava os tokens da vítima no workspace de quem iniciou o fluxo
 * (CSRF de vinculação de conta). A usuária vem da sessão, não do banco.
 */
export async function GET(req: NextRequest) {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const erro = searchParams.get('error')

  if (erro) {
    return NextResponse.json({ error: `TikTok recusou a autorização: ${erro}` }, { status: 400 })
  }
  if (!code || !state) {
    return NextResponse.json({ error: 'Callback do TikTok sem code/state.' }, { status: 400 })
  }

  const stateValido = validarState(state)
  if (!stateValido || stateValido.workspaceId !== session.user.workspaceId) {
    return NextResponse.json({ error: 'State inválido ou expirado — reinicie a autorização do TikTok.' }, { status: 400 })
  }

  const creds = lerCredenciaisOAuthTikTok()
  if (!creds) {
    return NextResponse.json({ error: 'TikTok não configurado no servidor.' }, { status: 400 })
  }

  let tokens
  try {
    tokens = await trocarCodigoPorToken(creds, code)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha ao trocar código por token.'
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  const workspaceId = session.user.workspaceId
  const dados = {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    accountId: tokens.openId,
    tokenExpiry: new Date(Date.now() + tokens.expiresInSeconds * 1000),
    extraData: { scope: tokens.scope, refreshExpiresInSeconds: tokens.refreshExpiresInSeconds },
    status: 'conectado',
  }
  const integracao = await prisma.integracao.upsert({
    where: { workspaceId_plataforma: { workspaceId, plataforma: 'tiktok' } },
    update: { ...dados, updatedAt: new Date() },
    create: { ...dados, userId: session.user.id, workspaceId, plataforma: 'tiktok' },
  })

  await registrarAuditoria({
    workspaceId,
    userId: session.user.id,
    action: 'integracao.conectada',
    entityType: 'Integracao',
    entityId: integracao.id,
    metadata: { plataforma: 'tiktok' }, // nunca token/segredo
  })

  return NextResponse.redirect(new URL('/integracoes?tiktok=conectado', req.url))
}
