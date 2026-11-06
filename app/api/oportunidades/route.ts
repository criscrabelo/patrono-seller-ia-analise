import { NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { listarApresentados, ultimaColeta } from '@/lib/curadoria'
import { candidatosParaTela, respostaDeErro, ultimaColetaParaTela } from '@/lib/curadoria-http'

// P2.14.5.13: os 3 candidatos apresentados à titular. Só leitura.
export async function GET() {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  try {
    const [candidatos, ultima] = await Promise.all([
      listarApresentados(session.user.workspaceId),
      ultimaColeta(session.user.workspaceId),
    ])
    return NextResponse.json({ candidatos: await candidatosParaTela(session.user.workspaceId, candidatos), ultimaColeta: ultimaColetaParaTela(ultima) })
  } catch (e) {
    return respostaDeErro(e)
  }
}
