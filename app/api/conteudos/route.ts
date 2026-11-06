import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { prisma } from '@/lib/prisma'
import { avaliarRastreamentoDosConteudos } from '@/lib/rastreamento-da-publicacao'
import { estaAtrasado, ondeAtrasado, STATUS_ATRASADA } from '@/lib/publicacao-atrasada'

export async function GET(req: NextRequest) {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  // P2.15.4: a listagem NÃO altera nada. Antes, ao abrir, conteúdo agendado
  // sem vídeo e com a data passada virava "publicado" sem ter saído — agora
  // ele aparece como "Publicação atrasada" (campo `atrasado`), e "publicado"
  // só existe com confirmação do canal (lib/publicacao-atrasada.ts).
  const agora = new Date()

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const produtoId = searchParams.get('produtoId')
  const redeSocial = searchParams.get('redeSocial')
  const countOnly = searchParams.get('count') === 'true'

  // "Publicação atrasada" inclui o agendado vencido (derivado), não só o gravado pelo cron.
  const where = {
    workspaceId: session.user.workspaceId,
    ...(status === STATUS_ATRASADA ? { OR: ondeAtrasado(session.user.workspaceId, agora).OR } : status ? { status } : {}),
    ...(produtoId && { produtoId }),
    ...(redeSocial && { redeSocial }),
  }

  if (countOnly) {
    const count = await prisma.conteudo.count({ where })
    return NextResponse.json({ count })
  }

  const conteudos = await prisma.conteudo.findMany({
    where,
    include: { produto: { select: { nome: true, imagens: true } } },
    orderBy: { createdAt: 'desc' },
  })

  // Estado de rastreamento por publicacao (P1.0 Etapa 2.a — microcorrecao).
  // Uma publicacao que caiu no fallback saiu com o link direto do produto:
  // o clique dela nunca passa pelo redirect e por isso nao e medido. Isso
  // precisa aparecer na tela, senao a unica forma de descobrir seria olhar
  // log de servidor. Uma consulta so para a listagem inteira.
  const rastreamento = await avaliarRastreamentoDosConteudos(session.user.workspaceId, conteudos)

  return NextResponse.json(
    conteudos.map((c) => ({
      ...c,
      atrasado: estaAtrasado(c, agora),
      rastreamento: rastreamento.get(c.id) ?? null,
    }))
  )
}
