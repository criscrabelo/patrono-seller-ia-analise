import { NextResponse } from 'next/server'
import { assinarMidiasPrivadasNaResposta, SEM_CACHE } from '@/lib/midia-privada'
import { exigirSessao } from '@/lib/sessao'
import { painelDeResultados } from '@/lib/resultados-videos'
import { respostaDeErroAssistido } from '@/lib/publicacao-assistida-http'

/** P2.17.10 — Resultados por vídeo, métricas derivadas, aprendizado e status por produto. */
export async function GET() {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  try {
    return NextResponse.json(await assinarMidiasPrivadasNaResposta(await painelDeResultados(session.user.workspaceId), session.user.workspaceId), { headers: SEM_CACHE })
  } catch (e) {
    return respostaDeErroAssistido(e)
  }
}
