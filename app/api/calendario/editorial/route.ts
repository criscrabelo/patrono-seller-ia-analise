import { NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { calendarioEditorial } from '@/lib/calendario-editorial'

export const dynamic = 'force-dynamic'

/** P2.53 — Calendário editorial: as peças da Central de Operação com a situação dos três controles e da aprovação (só leitura). */
export async function GET() {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  try {
    return NextResponse.json(await calendarioEditorial(session.user.workspaceId))
  } catch (e) {
    console.error('calendário editorial:', e)
    return NextResponse.json({ error: 'Não consegui montar o calendário agora.' }, { status: 500 })
  }
}
