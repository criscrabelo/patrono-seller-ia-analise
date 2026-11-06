import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { pedirNarracaoComVozLocal } from '@/lib/narracao'
import { respostaDeErroDaNarracao } from '@/lib/narracao-http'

export const dynamic = 'force-dynamic'

/**
 * P2.33.1 — NARRAÇÃO COM A VOZ LOCAL: { texto } → coloca na fila do worker local (Chatterbox, no computador
 * da titular, custo zero). Só com o consentimento de VOZ vigente, a voz aprovada e o perfil ativo.
 * O worker re-confere tudo antes de gerar; a prévia volta para ela ouvir. Nunca aprova nem publica.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const s = await exigirSessao()
  if (s instanceof NextResponse) return s
  const corpo = (await req.json().catch(() => ({}))) as { texto?: unknown }
  try {
    return NextResponse.json(await pedirNarracaoComVozLocal({ workspaceId: s.user.workspaceId, userId: s.user.id, id, texto: corpo.texto }))
  } catch (e) {
    return respostaDeErroDaNarracao(e)
  }
}
