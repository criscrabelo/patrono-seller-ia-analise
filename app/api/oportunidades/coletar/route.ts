import { NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { coletarCandidatos, listarApresentados, ultimaColeta } from '@/lib/curadoria'
import { candidatosParaTela, respostaDeErro, ultimaColetaParaTela } from '@/lib/curadoria-http'

// P2.14.5.13: coleta e ranqueia por clique da titular. Funciona com o
// workspace em MANUAL ou pausado; não muda o modo, não cria tarefa, não gera
// conteúdo, não publica.
export async function POST() {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  try {
    const resumo = await coletarCandidatos({ workspaceId: session.user.workspaceId, userId: session.user.id })
    const [candidatos, ultima] = await Promise.all([
      listarApresentados(session.user.workspaceId),
      ultimaColeta(session.user.workspaceId),
    ])
    return NextResponse.json({ resumo, candidatos: await candidatosParaTela(session.user.workspaceId, candidatos), ultimaColeta: ultimaColetaParaTela(ultima) })
  } catch (e) {
    return respostaDeErro(e)
  }
}
