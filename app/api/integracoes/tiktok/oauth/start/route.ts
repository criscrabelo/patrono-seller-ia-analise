import { NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { lerCredenciaisOAuthTikTok, gerarState, montarUrlAutorizacao } from '@/lib/tiktok-oauth'

/** Inicia o fluxo real de autorização do TikTok Channel — redireciona para o TikTok. */
export async function GET() {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const creds = lerCredenciaisOAuthTikTok()
  if (!creds) {
    return NextResponse.json(
      { error: 'TikTok não configurado. Defina TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET e TIKTOK_REDIRECT_URI.' },
      { status: 400 }
    )
  }

  const state = gerarState(session.user.workspaceId)
  const url = montarUrlAutorizacao(creds, state)
  return NextResponse.redirect(url)
}
