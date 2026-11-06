import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { registrarAuditoria } from '@/lib/audit-log'
import { excluirProduto } from '@/lib/produto-canonico'
import { destinoPublico } from '@/lib/destino-publico'

/**
 * P2.15.3: lista branca do que a tela pode alterar. Antes o corpo ia inteiro
 * para o banco — dava para trocar workspaceId/userId (levar o produto para
 * outro workspace) ou gravar qualquer coluna, e campo desconhecido virava 500.
 */
const Alteracao = z
  .object({
    nome: z.string().trim().min(1).max(200),
    categoria: z.string().trim().min(1).max(100),
    preco: z.number().nonnegative().nullable(),
    linkProduto: z.string().trim().url('O link precisa ser um endereço completo, começando com https://').refine((v) => destinoPublico(v).ok, { message: 'Use o link público do produto (https://), nunca um endereço interno.' }).nullable(),
    descricao: z.string().max(5000).nullable(),
    publicoAlvo: z.array(z.string().max(200)).max(50),
    beneficios: z.array(z.string().max(500)).max(50),
    pontosNegativos: z.array(z.string().max(500)).max(50),
    observacoes: z.string().max(5000).nullable(),
    imagens: z.array(z.string().url().refine((v) => destinoPublico(v).ok, { message: 'Imagem/vídeo precisa de endereço público https://.' })).max(30),
    videos: z.array(z.string().url().refine((v) => destinoPublico(v).ok, { message: 'Imagem/vídeo precisa de endereço público https://.' })).max(30),
  })
  .partial()
  .strict()

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const produto = await prisma.produto.findFirst({
    where: { id, workspaceId: session.user.workspaceId },
    include: { conteudos: { orderBy: { createdAt: 'desc' } } },
  })

  if (!produto) return NextResponse.json({ error: 'Produto não encontrado' }, { status: 404 })
  return NextResponse.json(produto)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const lido = Alteracao.safeParse(await req.json().catch(() => null))
  if (!lido.success) {
    const primeiro = lido.error.issues[0]
    return NextResponse.json({ error: primeiro?.code === 'unrecognized_keys' ? 'Campo não pode ser alterado por aqui.' : primeiro?.message ?? 'Dados inválidos.' }, { status: 400 })
  }
  const body = lido.data

  const produto = await prisma.produto.updateMany({
    where: { id, workspaceId: session.user.workspaceId },
    data: body,
  })

  if (!produto.count) return NextResponse.json({ error: 'Produto não encontrado' }, { status: 404 })

  await registrarAuditoria({
    workspaceId: session.user.workspaceId,
    userId: session.user.id,
    action: 'produto.alterado',
    entityType: 'Produto',
    entityId: id,
    metadata: { campos: Object.keys(body) },
  })

  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  // P2.18.11: excluir propaga para TODAS as áreas ativas (candidatos, jornada, publicação em andamento, amostra, pedidos).
  const r = await excluirProduto({ workspaceId: session.user.workspaceId, userId: session.user.id, produtoId: id })
  if (!r) return NextResponse.json({ error: 'Produto não encontrado' }, { status: 404 })

  await registrarAuditoria({
    workspaceId: session.user.workspaceId,
    userId: session.user.id,
    action: 'produto.descartado',
    entityType: 'Produto',
    entityId: id,
    metadata: { ...r },
  })

  return NextResponse.json({ success: true, efeito: r })
}
