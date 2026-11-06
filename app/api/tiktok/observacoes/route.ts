import { NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { ErroDeObservacao, registrarObservacao, type DadosDaObservacao } from '@/lib/observacoes-de-mercado'

export const dynamic = 'force-dynamic'

/** P2.17.18 — Registra um SNAPSHOT do que a titular viu no app (Mais vendidos, comissão, amostra…). Nunca é "API oficial". */
export async function POST(req: Request) {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  const dados = (await req.json().catch(() => null)) as DadosDaObservacao | null
  if (!dados) return NextResponse.json({ erro: 'Corpo inválido.' }, { status: 400 })
  try {
    const o = await registrarObservacao({ workspaceId: session.user.workspaceId, userId: session.user.id, dados })
    return NextResponse.json({ id: o.id, validaAte: o.validaAte.toISOString() }, { status: 201 })
  } catch (e) {
    if (e instanceof ErroDeObservacao) return NextResponse.json({ erro: e.message }, { status: e.status })
    throw e
  }
}
