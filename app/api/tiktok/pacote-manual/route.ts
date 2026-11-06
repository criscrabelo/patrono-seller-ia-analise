import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { prisma } from '@/lib/prisma'
import { montarPacoteTikTok } from '@/lib/tiktok-pacote'

/**
 * P2.17 — Pacote do TikTok (modo assistido): gancho, roteiro, legenda com
 * divulgação, CTA, hashtags, vídeo e os passos no app. Só leitura: não
 * publica, não chama o TikTok, não grava nada.
 */
export async function GET(req: NextRequest) {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  const conteudoId = req.nextUrl.searchParams.get('conteudoId')?.trim()
  if (!conteudoId) return NextResponse.json({ error: 'Informe o conteúdo.' }, { status: 400 })

  const c = await prisma.conteudo.findFirst({
    where: { id: conteudoId, workspaceId: session.user.workspaceId },
    select: {
      id: true, status: true, roteiro: true, textoTela: true, legendaTiktok: true, chamadaAcao: true, hashtags: true, videoUrl: true, alertasCompliance: true,
      produto: { select: { nome: true, linkProduto: true, providerId: true, externalId: true } },
    },
  })
  if (!c) return NextResponse.json({ error: 'Conteúdo não encontrado.' }, { status: 404 })
  const { produto, ...conteudo } = c
  // revisão P2.72 (BAIXA 2): o arquivo de uma publicação assistida só sai pela rota conferida (sha256) da Operação
  const assistida = await prisma.publicacaoAssistida.findFirst({ where: { workspaceId: session.user.workspaceId, conteudoId }, select: { id: true } })
  return NextResponse.json({ pacote: montarPacoteTikTok(produto, assistida ? { ...conteudo, videoUrl: null } : conteudo) })
}
