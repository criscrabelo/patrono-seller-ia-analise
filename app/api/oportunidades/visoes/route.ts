import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { painelDeVisoes, visaoValida } from '@/lib/visoes-de-produtos-http'
import { respostaDeErro } from '@/lib/curadoria-http'

/** P2.17.6 — Visões dos candidatos (Mais vendidos, Maior comissão, Melhor oportunidade…). Só leitura. */
export async function GET(req: NextRequest) {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  try {
    return NextResponse.json(await painelDeVisoes(session.user.workspaceId, visaoValida(req.nextUrl.searchParams.get('visao'))))
  } catch (e) {
    return respostaDeErro(e)
  }
}
