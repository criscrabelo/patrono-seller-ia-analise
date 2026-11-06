import { NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { estadoDoCanalTikTok } from '@/lib/tiktok-estado-canal'

/** P2.17.10 — Estado do canal TikTok (sem segredo): nível de automação e o que falta. */
export async function GET() {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  return NextResponse.json(await estadoDoCanalTikTok(session.user.workspaceId))
}
