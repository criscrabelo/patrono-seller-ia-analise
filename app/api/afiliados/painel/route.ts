import { NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { painelDeAfiliados } from '@/lib/painel-afiliados'

export const dynamic = 'force-dynamic'

/** P2.53 — Painel de Afiliados: comissões estimadas, aprovadas, recebidas, canceladas e estornadas (fonte única). */
export async function GET() {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  try {
    return NextResponse.json(await painelDeAfiliados(session.user.workspaceId))
  } catch (e) {
    console.error('painel de afiliados:', e)
    return NextResponse.json({ error: 'Não consegui montar o painel agora.' }, { status: 500 })
  }
}
