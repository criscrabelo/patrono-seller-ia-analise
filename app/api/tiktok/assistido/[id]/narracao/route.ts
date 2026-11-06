import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { descartarNarracao, narracaoParaATitular } from '@/lib/narracao'
import { respostaDeErroDaNarracao } from '@/lib/narracao-http'

export const dynamic = 'force-dynamic'

/**
 * P2.33.1 — NARRAÇÃO da publicação assistida.
 * GET    → estado + URLs assinadas (5 min) da prévia narrada — só para a titular que gravou/autorizou. Só leitura.
 * DELETE → descarta a narração (arquivos apagados com confirmação). A versão original continua intacta.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const s = await exigirSessao()
  if (s instanceof NextResponse) return s
  try {
    return NextResponse.json(await narracaoParaATitular({ workspaceId: s.user.workspaceId, userId: s.user.id, id }))
  } catch (e) {
    return respostaDeErroDaNarracao(e)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const s = await exigirSessao()
  if (s instanceof NextResponse) return s
  try {
    return NextResponse.json(await descartarNarracao({ workspaceId: s.user.workspaceId, userId: s.user.id, id }))
  } catch (e) {
    return respostaDeErroDaNarracao(e)
  }
}
