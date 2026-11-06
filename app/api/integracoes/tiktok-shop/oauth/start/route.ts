import { NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { iniciarAutorizacaoDaCriadora } from '@/lib/tiktok-shop-conexao'

/** P2.17 — Leva a titular à autorização oficial do TikTok Shop (501 enquanto não liberada). */
export async function GET() {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  return iniciarAutorizacaoDaCriadora({ workspaceId: session.user.workspaceId, userId: session.user.id })
}
