import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { relatorioDoPeriodo } from '@/lib/resumos'
import { inicioDoDiaEmBrasilia } from '@/lib/central'

export const dynamic = 'force-dynamic'

const DIA = 24 * 60 * 60 * 1000

/** P2.17.13 — ?periodo=hoje|7|30 ou ?de=AAAA-MM-DD&ate=AAAA-MM-DD (só leitura). */
export async function GET(req: NextRequest) {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  const q = req.nextUrl.searchParams
  const agora = new Date()
  let desde: Date
  let ate = agora
  const de = q.get('de')
  if (de) {
    desde = new Date(`${de}T00:00:00-03:00`)
    const fim = q.get('ate')
    if (fim) ate = new Date(`${fim}T23:59:59-03:00`)
  } else {
    const p = q.get('periodo') ?? '30'
    desde = p === 'hoje' ? inicioDoDiaEmBrasilia(agora) : new Date(agora.getTime() - (p === '7' ? 7 : 30) * DIA)
  }
  if (Number.isNaN(desde.getTime()) || Number.isNaN(ate.getTime()) || desde > ate) return NextResponse.json({ error: 'Período inválido.' }, { status: 400 })
  try {
    return NextResponse.json(await relatorioDoPeriodo(session.user.workspaceId, desde, ate))
  } catch (e) {
    console.error('relatorio:', e)
    return NextResponse.json({ error: 'Não consegui montar o relatório agora.' }, { status: 500 })
  }
}
