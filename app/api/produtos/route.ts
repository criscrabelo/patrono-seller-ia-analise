import { NextRequest, NextResponse } from 'next/server'
import { PRODUTO_NAO_EXCLUIDO } from '@/lib/produto-canonico'
import { exigirSessao } from '@/lib/sessao'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { registrarAuditoria } from '@/lib/audit-log'
import { destinoPublico } from '@/lib/destino-publico'

const produtoSchema = z.object({
  nome: z.string().min(1),
  categoria: z.string().min(1),
  preco: z.number().positive().optional(),
  linkProduto: z.string().url().refine((v) => destinoPublico(v).ok, { message: 'Use o link público do produto (https://), nunca um endereço interno.' }).optional().or(z.literal('')),
  descricao: z.string().optional(),
  publicoAlvo: z.array(z.string()),
  tipoVenda: z.string().min(1),
  origemConteudo: z.string().min(1),
  observacoes: z.string().optional(),
  beneficios: z.array(z.string()),
  pontosNegativos: z.array(z.string()),
  imagens: z.array(z.string().refine((v) => destinoPublico(v).ok, { message: 'Imagem/vídeo precisa de endereço público https://.' })),
  videos: z.array(z.string().refine((v) => destinoPublico(v).ok, { message: 'Imagem/vídeo precisa de endereço público https://.' })),
})

export async function GET(req: NextRequest) {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const { searchParams } = new URL(req.url)
  const categoria = searchParams.get('categoria')
  const busca = searchParams.get('busca')
  // P2.18.11: ?excluidos=1 lista só os excluídos (para restaurar). Padrão: a mesma definição canônica de "não excluído".
  const excluidos = searchParams.get('excluidos') === '1'

  const produtos = await prisma.produto.findMany({
    where: {
      workspaceId: session.user.workspaceId,
      ...(excluidos ? { status: 'descartado' } : PRODUTO_NAO_EXCLUIDO),
      ...(categoria && { categoria }),
      ...(busca && { nome: { contains: busca, mode: 'insensitive' } }),
    },
    include: { _count: { select: { conteudos: true } } },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json(produtos)
}

export async function POST(req: NextRequest) {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const body = await req.json().catch(() => ({}))
  const parsed = produtoSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados inválidos', details: parsed.error.flatten() }, { status: 400 })
  }

  const produto = await prisma.produto.create({
    data: {
      ...parsed.data,
      userId: session.user.id,
      workspaceId: session.user.workspaceId,
    },
  })

  await registrarAuditoria({
    workspaceId: session.user.workspaceId,
    userId: session.user.id,
    action: 'produto.criado',
    entityType: 'Produto',
    entityId: produto.id,
    metadata: { nome: produto.nome, categoria: produto.categoria },
  })

  return NextResponse.json(produto, { status: 201 })
}