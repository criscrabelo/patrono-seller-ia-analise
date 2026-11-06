import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { confirmarGravacao } from '@/lib/narracao'
import { respostaDeErroDaNarracao } from '@/lib/narracao-http'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** P2.33.1 — passo ② da GRAVAÇÃO REAL: confere o áudio enviado, monta a prévia narrada (privada) e devolve a checagem. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const s = await exigirSessao()
  if (s instanceof NextResponse) return s
  try {
    return NextResponse.json(await confirmarGravacao({ workspaceId: s.user.workspaceId, userId: s.user.id, id }))
  } catch (e) {
    return respostaDeErroDaNarracao(e)
  }
}
