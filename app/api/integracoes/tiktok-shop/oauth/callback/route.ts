import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { tratarCallbackDaCriadora } from '@/lib/tiktok-shop-conexao'

/**
 * P2.17 — Callback OAuth do TikTok Shop (autorização da criadora).
 *
 * Exige SESSÃO (o middleware não libera): a volta do TikTok é navegação no
 * navegador da própria titular, com o cookie. O `state` assinado precisa ser
 * do MESMO workspace e da MESMA usuária da sessão.
 *
 * Bloqueada (501) enquanto a conexão não estiver liberada: sem App Key /
 * App Secret / URL de autorização no servidor OU com a flag
 * TIKTOK_SHOP_CATALOGO desligada para o workspace. Nesse caso nada da URL é
 * lido, nada vai à rede e nada é gravado — é o estado de Production.
 * A lógica fica em lib/tiktok-shop-conexao.ts.
 */
export async function GET(req: NextRequest) {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  return tratarCallbackDaCriadora(req.url, { workspaceId: session.user.workspaceId, userId: session.user.id })
}

export async function POST() {
  return NextResponse.json({ error: 'Método não permitido.' }, { status: 405 })
}
