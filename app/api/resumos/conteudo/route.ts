import { NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { resumoConteudo } from '@/lib/resumos'

export const dynamic = 'force-dynamic'

/** P2.17.13 — resumo de leitura (sem lógica própria; só dado real, null quando não há). */
export async function GET() {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  try {
    return NextResponse.json(await resumoConteudo(session.user.workspaceId))
  } catch (e) {
    console.error('resumo conteudo:', e)
    return NextResponse.json({ error: 'Não consegui montar o resumo agora.' }, { status: 500 })
  }
}
