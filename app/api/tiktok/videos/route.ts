import { ehProdutoTikTokShop } from '@/lib/tiktok-shop-link'
import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { prisma } from '@/lib/prisma'
import { planejarVideos } from '@/lib/motor-de-videos-tiktok'

/** P2.17.3 — Plano de vídeos (variantes, teste A/B/C, potencial) de um candidato. Só leitura. */
export async function GET(req: NextRequest) {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  const id = req.nextUrl.searchParams.get('candidatoId')?.trim()
  if (!id) return NextResponse.json({ error: 'Informe o produto.' }, { status: 400 })
  const c = await prisma.candidatoDeProduto.findFirst({ where: { id, workspaceId: session.user.workspaceId } })
  if (!c) return NextResponse.json({ error: 'Produto não encontrado.' }, { status: 404 })
  const tiktokShop = ehProdutoTikTokShop(c.providerId, c.linkProduto)
  return NextResponse.json({
    plano: planejarVideos({ nome: c.nome, categoria: c.categoria, preco: c.preco, vendas: c.vendas, tiktokShop, temImagem: !!c.imagem }),
  })
}
