import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { situacaoDoTrabalho } from '@/lib/trabalho-longo'
import { EXECUTORES_REAIS } from '@/lib/trabalhos-longos'

// Fora da Netlify, a consulta faz o trabalho andar um trecho (até ~45 s).
export const maxDuration = 60
export const dynamic = 'force-dynamic'

/**
 * P2.2 — A tela consulta aqui o andamento de um trabalho longo (legenda,
 * publicação, WhatsApp). Escopado pelo workspace da SESSÃO: o id sozinho
 * não abre trabalho de outro negócio. Responde só o que a rota original
 * devolveria — nada do contexto interno.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const situacao = await situacaoDoTrabalho({
    workspaceId: session.user.workspaceId,
    trabalhoId: id,
    origem: req.nextUrl.origin,
    executores: EXECUTORES_REAIS,
  })
  if (!situacao) return NextResponse.json({ error: 'Trabalho não encontrado' }, { status: 404 })
  return NextResponse.json(situacao)
}
