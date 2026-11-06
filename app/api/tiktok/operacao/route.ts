import { NextResponse } from 'next/server'
import { assinarMidiasPrivadasNaResposta, SEM_CACHE } from '@/lib/midia-privada'
import { exigirSessao } from '@/lib/sessao'
import { operacaoComercial } from '@/lib/operacao-comercial'

export const dynamic = 'force-dynamic'

/** P2.17.19+ — Fila comercial, plano das 10, agenda sugerida, riscos, caminho até a 1ª comissão e atribuição. Só leitura. */
export async function GET() {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  return NextResponse.json(await assinarMidiasPrivadasNaResposta(await operacaoComercial(session.user.workspaceId), session.user.workspaceId), { headers: SEM_CACHE })
}
