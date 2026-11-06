import { NextResponse } from 'next/server'
import { exigirSessaoEFlag, respostaDeErroFase1 } from '@/lib/api-fase1'
import { executarCiclo } from '@/lib/supervisor/ciclo'

// P2.15: um ciclo do Supervisor por clique da titular (sem cron). Descobre,
// ranqueia e decide pela política; nunca publica nem gasta.
export async function POST() {
  const s = await exigirSessaoEFlag('CENTRAL_OPERACIONAL')
  if (s instanceof NextResponse) return s
  try {
    return NextResponse.json(await executarCiclo({ workspaceId: s.workspaceId, userId: s.userId, gatilho: 'MANUAL' }))
  } catch (e) {
    return respostaDeErroFase1(e)
  }
}
