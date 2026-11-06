import { NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { torreDeControle } from '@/lib/torre-de-controle'

/** P2.17.10 — Torre de Controle v1: a operação inteira numa leitura (só leitura). */
export async function GET() {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  try {
    return NextResponse.json(await torreDeControle(session.user.workspaceId))
  } catch (e) {
    console.error('Erro na Torre de Controle:', e)
    return NextResponse.json({ error: 'Não consegui montar a Torre de Controle agora.' }, { status: 500 })
  }
}
