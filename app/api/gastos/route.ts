import { NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { situacaoDosGastos } from '@/lib/controle-de-gastos'

export const dynamic = 'force-dynamic'

/** P2.53 — Situação do controle de gastos (só leitura; quem bloqueia é o gate no servidor). */
export async function GET() {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  try {
    return NextResponse.json(await situacaoDosGastos(session.user.workspaceId))
  } catch (e) {
    console.error('controle de gastos:', e)
    return NextResponse.json({ error: 'Não consegui ler o controle de gastos agora.' }, { status: 500 })
  }
}
