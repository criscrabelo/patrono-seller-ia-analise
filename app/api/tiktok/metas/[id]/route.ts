import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { exigirSessao } from '@/lib/sessao'
import { atualizarMeta } from '@/lib/metas-tiktok'
import { respostaDeErroDeMeta } from '@/lib/metas-tiktok-http'

/** P2.17.3 — Atualiza a missão: +1/−1 no realizado, valores corrigidos ou arquivar. */
const mudanca = z.object({
  incremento: z.number().int().min(-1000).max(1000).optional(),
  quantidadeRealizada: z.number().int().min(0).max(100_000).optional(),
  quantidadeExigida: z.number().int().min(1).max(100_000).optional(),
  recompensaValor: z.number().finite().nonnegative().max(1_000_000).nullable().optional(),
  fim: z.coerce.date().optional(),
  arquivar: z.boolean().optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  const { id } = await params
  const lido = mudanca.safeParse(await req.json().catch(() => null))
  if (!lido.success) return NextResponse.json({ error: 'Alteração inválida.' }, { status: 400 })
  try {
    const meta = await atualizarMeta({ workspaceId: session.user.workspaceId, userId: session.user.id, id, mudanca: lido.data })
    return NextResponse.json({ id: meta.id, quantidadeRealizada: meta.quantidadeRealizada, status: meta.status })
  } catch (e) {
    return respostaDeErroDeMeta(e)
  }
}
