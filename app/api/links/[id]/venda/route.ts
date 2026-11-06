import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { prisma } from '@/lib/prisma'
import { registrarResultado } from '@/lib/vendas-comissoes'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const valor = parseFloat(body.valor)
  if (!valor || valor <= 0) {
    return NextResponse.json({ error: 'Informe um valor de venda válido' }, { status: 400 })
  }
  // Idempotência persistente (Rodada 4): a tela gera esta chave uma vez por
  // tentativa de envio e reenvia a mesma em cada retry — ver
  // lib/vendas-comissoes.ts `registrarResultado()`.
  const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : null

  const link = await prisma.linkDinamico.findFirst({
    where: { id, workspaceId: session.user.workspaceId },
  })
  if (!link) return NextResponse.json({ error: 'Link não encontrado' }, { status: 404 })

  // Loja própria: o valor da venda inteiro é a receita do vendedor (sem custo cadastrado).
  // Afiliado / TikTok Shop: a receita é a comissão sobre o valor vendido.
  // P2.50: sem taxa cadastrada a comissão é DESCONHECIDA (null), não "previsão R$ 0".
  const receitaGanha = link.tipo === 'loja-propria'
    ? valor
    : link.comissao === null || link.comissao === undefined ? null : valor * (link.comissao / 100)

  // Sale/Commission são a fonte única (Rodada 3/4) — o contador legado em
  // LinkDinamico (conversoes/receitaTotal, DEPRECATED_LEGACY) NÃO é mais
  // incrementado aqui. A tela "Meus Links" já lê o resumo calculado a
  // partir de Sale (GET /api/links, via lib/vendas-comissoes.ts
  // `resumoPorLink`), então nada muda visualmente para quem usa a tela.
  const resultado = await registrarResultado({
    workspaceId: session.user.workspaceId,
    actorUserId: session.user.id,
    // PROVENIÊNCIA (P0.2 Bloco 1, corrigido): a rota sabe quem registrou,
    // não sabe se a venda ocorreu. Ver lib/proveniencia.ts.
    dataOrigin: 'USER_REPORTED',
    productId: link.produtoId,
    linkId: link.id,
    amount: valor,
    status: 'CONFIRMED',
    expectedCommission: receitaGanha,
    idempotencyKey,
  })

  return NextResponse.json({
    link,
    sale: resultado.sale,
    commission: resultado.commission,
    duplicado: resultado.duplicado,
  })
}
