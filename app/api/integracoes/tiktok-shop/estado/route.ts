import { NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { estadoDaConexaoTikTokShop } from '@/lib/tiktok-shop-estado'

/** P2.17 — Estado da conexão de criadora no TikTok Shop (sem segredo, sem rede). */
export async function GET() {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  return NextResponse.json(await estadoDaConexaoTikTokShop(session.user.workspaceId))
}
