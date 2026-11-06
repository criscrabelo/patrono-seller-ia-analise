import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { prisma } from '@/lib/prisma'
import { iniciarTrabalhoLongo } from '@/lib/trabalho-longo'
import {
  executorDaLegenda,
  montarPedidoDeLegenda,
  chaveDaLegenda,
  textoDaLegenda,
} from '@/lib/trabalhos-longos/legenda-video'

// Processar legendas pode levar ~30-60s. Na Netlify (limite síncrono de 30 s)
// o trabalho vai para a Background Function; aqui só se valida e registra.
// Fora dela, o mesmo executor roda dentro da requisição.
export const maxDuration = 60
export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const body = await req.json().catch(() => ({}))
  const preset = typeof body.preset === 'string' ? body.preset : 'glass'

  const conteudo = await prisma.conteudo.findFirst({
    where: { id, workspaceId: session.user.workspaceId },
  })
  if (!conteudo) return NextResponse.json({ error: 'Conteúdo não encontrado' }, { status: 404 })
  // P2.72: a peça de uma publicação assistida é a versão APROVADA (arquivo + texto): não é regerada nem legendada por fora
  if (await prisma.publicacaoAssistida.findFirst({ where: { workspaceId: session.user.workspaceId, conteudoId: id }, select: { id: true } }))
    return NextResponse.json({ error: 'Esta peça é de uma publicação assistida aprovada: para mudar, peça ajuste na Operação.' }, { status: 409 })
  if (!conteudo.videoUrl) {
    return NextResponse.json({ error: 'Este conteúdo não tem vídeo. Gere ou envie o vídeo primeiro.' }, { status: 400 })
  }

  // Texto da legenda: prioriza narração (mais longa), depois textoTela, depois chamadaAcao
  if (!textoDaLegenda(conteudo)) {
    return NextResponse.json(
      { error: 'O conteúdo não tem texto para usar como legenda (narração, textoTela ou chamadaAcao).' },
      { status: 400 }
    )
  }

  const pedido = montarPedidoDeLegenda({
    conteudo: { ...conteudo, videoUrl: conteudo.videoUrl },
    userId: session.user.id,
    preset,
  })
  const r = await iniciarTrabalhoLongo({
    workspaceId: session.user.workspaceId,
    tipo: 'LONGO_LEGENDA_VIDEO',
    chave: chaveDaLegenda(pedido),
    entityType: 'CONTEUDO',
    entityId: conteudo.id,
    contexto: { pedido },
    executor: executorDaLegenda(),
    origem: req.nextUrl.origin,
    mensagemDeProcessando: 'A legenda está sendo gerada. Aguarde nesta tela.',
  })
  return NextResponse.json(r.resposta.corpo, { status: r.resposta.status })
}
