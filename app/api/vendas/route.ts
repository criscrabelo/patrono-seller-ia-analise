import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { prisma } from '@/lib/prisma'
import { registrarResultado, atualizarStatusVenda, CadeiaDaVendaInconsistente } from '@/lib/vendas-comissoes'
import { z } from 'zod'

// "Vendas e Comissões" → "Registrar resultado" (design_handoff §4).
// Sale é a fonte única de vendas a partir desta rodada — nenhuma leitura
// nova soma o contador legado de LinkDinamico.

const registrarSchema = z.object({
  productId: z.string().min(1),
  affiliateProgramId: z.string().optional(),
  linkId: z.string().optional(),
  contentId: z.string().optional(),
  date: z.string().optional(),
  amount: z.number().positive().optional(),
  status: z.enum(['PENDING', 'CONFIRMED', 'CANCELLED']),
  expectedCommission: z.number().nonnegative().optional(),
  notes: z.string().optional(),
  // Idempotência persistente (Rodada 4) — ver lib/vendas-comissoes.ts
  // `registrarResultado()`. A tela gera esta chave uma vez por tentativa
  // de envio e reenvia a mesma em cada retry.
  idempotencyKey: z.string().min(1).optional(),
})

export async function GET(req: NextRequest) {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')

  const vendas = await prisma.sale.findMany({
    where: {
      workspaceId: session.user.workspaceId,
      ...(status && { status }),
    },
    include: {
      product: { select: { nome: true } },
      affiliateProgram: { select: { platform: true } },
      commissions: true,
    },
    orderBy: { date: 'desc' },
  })

  return NextResponse.json(vendas)
}

export async function POST(req: NextRequest) {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const body = await req.json().catch(() => ({}))
  const parsed = registrarSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados inválidos', details: parsed.error.flatten() }, { status: 400 })
  }
  const { productId } = parsed.data

  const produto = await prisma.produto.findFirst({
    where: { id: productId, workspaceId: session.user.workspaceId },
  })
  if (!produto) return NextResponse.json({ error: 'Selecione um produto para continuar' }, { status: 400 })

  if (parsed.data.affiliateProgramId) {
    const programa = await prisma.affiliateProgram.findFirst({
      where: { id: parsed.data.affiliateProgramId, workspaceId: session.user.workspaceId },
    })
    if (!programa) return NextResponse.json({ error: 'Programa não encontrado' }, { status: 400 })
  }

  let resultado
  try {
    resultado = await registrarResultado({
      workspaceId: session.user.workspaceId,
      actorUserId: session.user.id,
      // PROVENIÊNCIA (P0.2 Bloco 1, corrigido).
      //
      // Esta rota sabe QUEM criou o registro — usuária autenticada, no
      // workspace dela. Não sabe SE a operação comercial aconteceu: uma venda
      // de treino digitada aqui é indistinguível de uma venda real.
      //
      // Por isso declara USER_REPORTED, e não REAL_OPERATION. O relato vale
      // para a contabilidade da proprietária e para as telas; para ensinar o
      // ML seria preciso evidência externa (provider, conciliação, comissão
      // com origem verificável ou correção auditada), que esta rota não tem.
      dataOrigin: 'USER_REPORTED',
      productId: parsed.data.productId,
      affiliateProgramId: parsed.data.affiliateProgramId ?? null,
      linkId: parsed.data.linkId ?? null,
      contentId: parsed.data.contentId ?? null,
      date: parsed.data.date ? new Date(parsed.data.date) : undefined,
      amount: parsed.data.amount ?? null,
      status: parsed.data.status,
      expectedCommission: parsed.data.expectedCommission ?? null,
      notes: parsed.data.notes ?? null,
      idempotencyKey: parsed.data.idempotencyKey ?? null,
    })
  } catch (e) {
    // Cadeia incoerente é dado inválido de quem chamou, não falha do
    // servidor — 400, com o campo nomeado para a tela poder destacá-lo.
    if (e instanceof CadeiaDaVendaInconsistente) {
      return NextResponse.json({ error: e.message, campo: e.campo }, { status: 400 })
    }
    throw e
  }

  return NextResponse.json(resultado, { status: 201 })
}

const alterarStatusSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['PENDING', 'CONFIRMED', 'CANCELLED']),
  notes: z.string().optional(),
})

export async function PATCH(req: NextRequest) {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const body = await req.json().catch(() => ({}))
  const parsed = alterarStatusSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })
  }

  const sale = await atualizarStatusVenda({
    workspaceId: session.user.workspaceId,
    saleId: parsed.data.id,
    actorUserId: session.user.id,
    status: parsed.data.status,
    notes: parsed.data.notes,
  })
  if (!sale) return NextResponse.json({ error: 'Venda não encontrada' }, { status: 404 })

  return NextResponse.json(sale)
}
