import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { criarMeta } from '@/lib/metas-tiktok'
import { lerMeta, painelDeMetas, respostaDeErroDeMeta } from '@/lib/metas-tiktok-http'

/** P2.17.3 — Painel "TikTok Shop — Metas e Recompensas" (missões registradas pela titular). */
export async function GET() {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  try {
    return NextResponse.json(await painelDeMetas(session.user.workspaceId))
  } catch (e) {
    return respostaDeErroDeMeta(e)
  }
}

export async function POST(req: NextRequest) {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  const lido = lerMeta(await req.json().catch(() => null))
  if (!lido.ok) return NextResponse.json({ error: lido.mensagem }, { status: 400 })
  try {
    const meta = await criarMeta({ workspaceId: session.user.workspaceId, userId: session.user.id, dados: lido.dados })
    return NextResponse.json({ id: meta.id }, { status: 201 })
  } catch (e) {
    return respostaDeErroDeMeta(e)
  }
}
