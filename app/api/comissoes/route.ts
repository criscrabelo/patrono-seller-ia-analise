import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { prisma } from '@/lib/prisma'
import { resumoComissoes, atualizarComissao, ComissaoAlteradaEmParalelo } from '@/lib/vendas-comissoes'
import { z } from 'zod'
import { cadeiaFinanceira } from '@/lib/financeiro'

// "Vendas e Comissões" — bloco de Comissões (prevista/confirmada/recebida).
// Commission é a fonte única a partir desta rodada.

export async function GET() {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const [comissoes, resumo, cadeia] = await Promise.all([
    prisma.commission.findMany({
      where: { workspaceId: session.user.workspaceId },
      include: {
        product: { select: { nome: true } },
        affiliateProgram: { select: { platform: true } },
        sale: { select: { id: true, status: true, amount: true, date: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    resumoComissoes(session.user.workspaceId),
    cadeiaFinanceira(session.user.workspaceId),
  ])
  // P2.25: estado e valor de cada linha pela fonte canônica, com a cadeia (produto → conteúdo → publicação → pedido).
  const elo = new Map(cadeia.elos.map((e) => [e.comissaoId, e]))
  return NextResponse.json({ comissoes: comissoes.map((c) => ({ ...c, cadeia: elo.get(c.id) ?? null })), resumo })
}

const alterarSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['EXPECTED', 'CONFIRMED', 'RECEIVED']),
  confirmedAmount: z.number().nonnegative().optional(),
  receivedAmount: z.number().nonnegative().optional(),
  notes: z.string().optional(),
})
  // P2.50: CONFIRMED exige o valor confirmado e RECEIVED o valor recebido — a previsão nunca vira receita por omissão.
  .refine((d) => d.status !== 'CONFIRMED' || d.confirmedAmount !== undefined, { message: 'Informe o valor confirmado.' })
  .refine((d) => d.status !== 'RECEIVED' || d.receivedAmount !== undefined, { message: 'Informe o valor recebido.' })

export async function PATCH(req: NextRequest) {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const body = await req.json().catch(() => ({}))
  const parsed = alterarSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })
  }

  const commission = await atualizarComissao({
    workspaceId: session.user.workspaceId,
    commissionId: parsed.data.id,
    actorUserId: session.user.id,
    status: parsed.data.status,
    confirmedAmount: parsed.data.confirmedAmount,
    receivedAmount: parsed.data.receivedAmount,
    notes: parsed.data.notes,
  }).catch((e) => {
    if (e instanceof ComissaoAlteradaEmParalelo) return 'CONFLITO' as const
    throw e
  })
  if (commission === 'CONFLITO') return NextResponse.json({ error: 'A comissão foi alterada ao mesmo tempo por outra ação. Recarregue e tente de novo.' }, { status: 409 })
  if (!commission) return NextResponse.json({ error: 'Comissão não encontrada' }, { status: 404 })

  return NextResponse.json(commission)
}
