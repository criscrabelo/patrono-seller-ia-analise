import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { recusaPeloCabecalho } from '@/lib/digital-twin-upload-direto'
import { confirmarEnvioDireto } from '@/lib/digital-twin-upload-direto-servico'

export const dynamic = 'force-dynamic'

/**
 * P2.11, passo ③ — o navegador já enviou o arquivo direto ao bucket. O
 * servidor confere o objeto gravado contra a intenção assinada e só então
 * registra o asset (lib/digital-twin-upload-direto-servico.ts).
 */
export async function POST(req: NextRequest) {
  const recusa = recusaPeloCabecalho(req.headers.get('content-type'), req.headers.get('content-length'))
  if (recusa) return NextResponse.json({ error: recusa.motivo }, { status: recusa.status })

  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const corpo = await req.json().catch(() => null)
  const r = await confirmarEnvioDireto({ workspaceId: session.user.workspaceId, userId: session.user.id }, corpo)
  return NextResponse.json(r.corpo, { status: r.status })
}
