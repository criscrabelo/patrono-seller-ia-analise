import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { rejeitar } from '@/lib/publicacao-assistida'
import { esquemaRejeitar, lerCorpo, respostaDeErroAssistido } from '@/lib/publicacao-assistida-http'

/** REJEITAR: registra o motivo; o Patrono já apresenta outra opção. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  const corpo = lerCorpo(esquemaRejeitar, await req.json().catch(() => ({})))
  if (!corpo.ok) return corpo.resposta
  try {
    const proxima = await rejeitar({ workspaceId: session.user.workspaceId, userId: session.user.id, id, motivo: corpo.dados.motivo, origem: req.nextUrl.origin })
    return NextResponse.json({ rejeitada: id, proxima: proxima ? { id: proxima.id, estado: proxima.estado } : null })
  } catch (e) {
    return respostaDeErroAssistido(e)
  }
}
