import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { prisma } from '@/lib/prisma'
import { lucroEscalaPorProduto, resumoVendas, resumoComissoes, primeiraComissao } from '@/lib/vendas-comissoes'
import { PRODUTO_NAO_EXCLUIDO } from '@/lib/produto-canonico'
import { calcularScoreEscala } from '@/lib/score-de-escala'
import { resultadoAposCustos } from '@/lib/financeiro'

export async function GET(req: NextRequest) {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const workspaceId = session.user.workspaceId

  const [
    totalProdutos,
    totalConteudos,
    aguardandoAprovacao,
    publicados,
    somaVisualizacoes,
    conteudosRecentes,
    conteudosPorStatus,
    produtosComVenda,
    vendas,
    comissoes,
    primeira,
    resultado,
  ] = await Promise.all([
    prisma.produto.count({ where: { workspaceId, ...PRODUTO_NAO_EXCLUIDO } }),
    prisma.conteudo.count({ where: { workspaceId } }),
    prisma.conteudo.count({ where: { workspaceId, status: 'aguardando_aprovacao' } }),
    prisma.conteudo.count({ where: { workspaceId, status: 'publicado' } }),
    // Soma TODAS as visualizações, não apenas top 5
    prisma.conteudo.aggregate({
      where: { workspaceId },
      _sum: { visualizacoes: true },
    }),
    // Conteúdos recentes de todos os status (não só publicados)
    prisma.conteudo.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { produto: { select: { nome: true } } },
    }),
    prisma.conteudo.groupBy({
      by: ['status'],
      where: { workspaceId },
      _count: { status: true },
    }),
    // Fonte única de vendas/comissões por produto (Rodada 3) — nunca mais
    // soma o contador legado de LinkDinamico. Cliques continuam vindo dos
    // links (fonte de tracking); vendas e receita vêm de Sale/Commission.
    lucroEscalaPorProduto(workspaceId),
    resumoVendas(workspaceId),
    resumoComissoes(workspaceId),
    primeiraComissao(workspaceId),
    // P2.50 (Codex 20): comissão confirmada − custos (reais + reservas de chamadas pagas).
    resultadoAposCustos(workspaceId),
  ])

  const lucroEscala = calcularScoreEscala(produtosComVenda)
  const comissaoTotal = comissoes.confirmada + comissoes.recebida

  return NextResponse.json({
    totalProdutos,
    totalConteudos,
    aguardandoAprovacao,
    publicados,
    visualizacoesTotais: somaVisualizacoes._sum.visualizacoes ?? 0,
    topConteudos: conteudosRecentes,
    conteudosPorStatus,
    lucroEscala,
    comissaoTotal,
    // "Resultados" (design_handoff §I) — cliques permanecem na fonte de
    // links/tracking; vendas confirmadas e comissão confirmada/recebida
    // vêm de Sale/Commission, nunca do contador legado.
    resultados: {
      vendasConfirmadas: vendas.CONFIRMED,
      vendasPendentes: vendas.PENDING,
      vendasCanceladas: vendas.CANCELLED,
      comissaoPrevista: comissoes.prevista,
      comissaoConfirmada: comissoes.confirmada,
      comissaoRecebida: comissoes.recebida,
    },
    primeiraComissao: primeira,
    resultadoAposCustos: resultado,
  })
}
