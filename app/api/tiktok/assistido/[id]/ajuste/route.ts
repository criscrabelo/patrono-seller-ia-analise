import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { pedirAjuste } from '@/lib/publicacao-assistida'
import { esquemaAjuste, lerCorpo, respostaDeErroAssistido } from '@/lib/publicacao-assistida-http'

/** PEDIR AJUSTE: o Patrono corrige e reapresenta (nova versão, nova checagem). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  const corpo = lerCorpo(esquemaAjuste, await req.json().catch(() => ({})))
  if (!corpo.ok) return corpo.resposta
  try {
    const a = await pedirAjuste({ workspaceId: session.user.workspaceId, userId: session.user.id, id, motivo: corpo.dados.motivo, alteracoes: corpo.dados.alteracoes, origem: req.nextUrl.origin })
    return NextResponse.json({ id: a.id, estado: a.estado, versao: a.versao })
  } catch (e) {
    return respostaDeErroAssistido(e)
  }
}
