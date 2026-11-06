import { NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { enriquecerCandidatos } from '@/lib/enriquecimento-de-produto'
import { respostaDeErro } from '@/lib/curadoria-http'

/**
 * P2.17.6 — "Atualizar dados dos produtos": consulta as fontes OFICIAIS
 * disponíveis para cada candidato com link e devolve o antes/depois. Sem
 * fonte ativa, registra o motivo e a data da consulta — nada é inventado.
 */
export async function POST() {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  try {
    return NextResponse.json(await enriquecerCandidatos({ workspaceId: session.user.workspaceId, userId: session.user.id }))
  } catch (e) {
    return respostaDeErro(e)
  }
}
