import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { registrarPublicacaoManualEContinuar } from '@/lib/publicacao-assistida'
import { esquemaPublicadoConfirmado, lerCorpo, respostaDeErroAssistido } from '@/lib/publicacao-assistida-http'

/** Contingência (limitação oficial): a titular publicou pelo app e informa o link do vídeo. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  const corpo = lerCorpo(esquemaPublicadoConfirmado, await req.json().catch(() => ({})))
  if (!corpo.ok) return corpo.resposta
  try {
    const { publicada: a, proxima } = await registrarPublicacaoManualEContinuar({ workspaceId: session.user.workspaceId, userId: session.user.id, id, url: corpo.dados.url, origem: req.nextUrl.origin, confirmoPublicacaoRetida: corpo.dados.confirmoPublicacaoRetida === true })
    return NextResponse.json({ id: a.id, estado: a.estado, ordem: a.ordem, proxima: proxima ? { id: proxima.id, estado: proxima.estado, produto: proxima.nomeProduto } : null })
  } catch (e) {
    return respostaDeErroAssistido(e)
  }
}
