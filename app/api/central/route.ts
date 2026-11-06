import { NextResponse } from 'next/server'
import { exigirSessaoEFlag, respostaDeErroFase1 } from '@/lib/api-fase1'
import { painelCentral } from '@/lib/central'

// P2.15: Command Center — leitura só (não altera nada).
export async function GET() {
  const s = await exigirSessaoEFlag('CENTRAL_OPERACIONAL')
  if (s instanceof NextResponse) return s
  try {
    return NextResponse.json(await painelCentral(s.workspaceId))
  } catch (e) {
    return respostaDeErroFase1(e)
  }
}
