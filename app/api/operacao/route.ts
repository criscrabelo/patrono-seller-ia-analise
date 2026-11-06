import { NextRequest, NextResponse } from 'next/server'
import { exigirSessaoEFlag } from '@/lib/api-fase1'
import { resumoDaOperacao, sincronizarOperacao, visaoDaOperacao } from '@/lib/jornada'
import { respostaDeErroDaJornada } from '@/lib/jornada-http'
import { assinarMidiasPrivadasNaResposta, SEM_CACHE } from '@/lib/midia-privada'

export const dynamic = 'force-dynamic'

/**
 * P2.18.5 — Operação (jornada única).
 * GET  → resumo de uma linha para a Torre ("CONTINUAR OPERAÇÃO"). Só leitura.
 * POST → o Patrono roda os passos automáticos, registra as transições e
 *        devolve a jornada prioritária (é o que a página chama ao abrir).
 */
export async function GET() {
  const s = await exigirSessaoEFlag('CENTRAL_DE_APROVACOES')
  if (s instanceof NextResponse) return s
  try {
    return NextResponse.json(await resumoDaOperacao(s.workspaceId))
  } catch (e) {
    return respostaDeErroDaJornada(e)
  }
}

export async function POST(_req: NextRequest) {
  const s = await exigirSessaoEFlag('CENTRAL_DE_APROVACOES')
  if (s instanceof NextResponse) return s
  try {
    // P2.35: referências privadas viram links temporários só na resposta, só do próprio workspace; sem cache.
    return NextResponse.json(await assinarMidiasPrivadasNaResposta(visaoDaOperacao(await sincronizarOperacao({ workspaceId: s.workspaceId, userId: s.userId })), s.workspaceId), { headers: SEM_CACHE })
  } catch (e) {
    return respostaDeErroDaJornada(e)
  }
}
