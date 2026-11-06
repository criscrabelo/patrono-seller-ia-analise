import { NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { hojeOperacional } from '@/lib/hoje'
import { log } from '@/lib/observabilidade'

// P2.26 — "O que eu preciso fazer agora?" (uma resposta, da decisão única da Operação + central + dinheiro canônico).
export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  try {
    return NextResponse.json(await hojeOperacional(session.user.workspaceId))
  } catch (e) {
    log('error', 'hoje.erro', { erro: e instanceof Error ? e.message : String(e) })
    return NextResponse.json({ error: 'Não consegui montar o HOJE agora. Atualize a página.' }, { status: 500 })
  }
}
