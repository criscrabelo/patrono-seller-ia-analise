import { NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { aplicarEventoNaAmostra, confirmarPrazo, ErroDeAmostra, marcarMissaoComputada } from '@/lib/amostras'

export const dynamic = 'force-dynamic'

/**
 * Atualiza o que SÓ a titular vê no app (não há API de escrita de amostras):
 *   { evento: APROVADA | ENVIADA | RECEBIDA | REJEITADA | CANCELADA | PENDENTE_APROVACAO | CONCLUIDA, em?, prazoConteudoEm? }
 *   { prazoConteudoEm }        — prazo confirmado no app
 *   { missaoComputada: true }  — o app contou esta solicitação na missão
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  const { id } = await ctx.params
  const b = (await req.json().catch(() => null)) as { evento?: string; em?: string; prazoConteudoEm?: string; motivo?: string; missaoComputada?: boolean } | null
  if (!b) return NextResponse.json({ erro: 'Corpo inválido.' }, { status: 400 })
  const base = { workspaceId: session.user.workspaceId, userId: session.user.id, id }
  try {
    if (b.evento) return NextResponse.json(await aplicarEventoNaAmostra({ ...base, evento: b.evento, em: b.em ?? null, prazoConteudoEm: b.prazoConteudoEm ?? null, motivo: b.motivo ?? null }))
    if (b.missaoComputada === true) return NextResponse.json(await marcarMissaoComputada(base))
    if (b.prazoConteudoEm) return NextResponse.json(await confirmarPrazo({ ...base, prazoConteudoEm: b.prazoConteudoEm }))
    return NextResponse.json({ erro: 'Nada para atualizar.' }, { status: 400 })
  } catch (e) {
    if (e instanceof ErroDeAmostra) return NextResponse.json({ erro: e.message }, { status: e.status })
    throw e
  }
}
