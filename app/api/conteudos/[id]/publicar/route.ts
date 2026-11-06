import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { prisma } from '@/lib/prisma'
import { autorizarPublicacaoReal } from '@/lib/porta-de-publicacao-real'
import { chaveDaTentativaPadrao, chaveDeTentativaDoConteudo } from '@/lib/link-de-publicacao'
import { iniciarTrabalhoLongo } from '@/lib/trabalho-longo'
import { executorDaPublicacao, chaveDaPublicacao } from '@/lib/trabalhos-longos/publicar-instagram'

// Publicar pode levar até ~50s (processamento do vídeo na Meta). Na Netlify
// (limite síncrono de 30 s) isso roda na Background Function; esta rota só
// valida, confere a porta e registra o pedido. Fora dela, o MESMO executor
// roda dentro da requisição.
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
  const tipoMidia: 'video' | 'imagens' = body.tipoMidia === 'imagens' ? 'imagens' : 'video'
  const destino: 'feed' | 'stories' = body.destino === 'stories' ? 'stories' : 'feed'

  const conteudo = await prisma.conteudo.findFirst({
    where: { id, workspaceId: session.user.workspaceId },
    include: { produto: { select: { imagens: true } } },
  })
  if (!conteudo) {
    return NextResponse.json({ error: 'Conteúdo não encontrado' }, { status: 404 })
  }

  const imagens = conteudo.produto?.imagens ?? []
  if (tipoMidia === 'video' && !conteudo.videoUrl) {
    return NextResponse.json(
      { error: 'Este conteúdo não tem vídeo. Gere o vídeo ou escolha publicar as imagens.' },
      { status: 400 }
    )
  }
  if (tipoMidia === 'imagens' && imagens.length === 0) {
    return NextResponse.json(
      { error: 'O produto não tem imagens cadastradas.' },
      { status: 400 }
    )
  }

  const integracao = await prisma.integracao.findUnique({
    where: { workspaceId_plataforma: { workspaceId: session.user.workspaceId, plataforma: 'instagram' } },
  })
  if (
    !integracao ||
    integracao.status !== 'conectado' ||
    !integracao.accessToken ||
    !integracao.accountId
  ) {
    return NextResponse.json(
      { error: 'Conecte o Instagram em Integrações antes de publicar.' },
      { status: 400 }
    )
  }

  // P1.9.2: A PORTA ÚNICA. A chave de quem chama é lida UMA vez, aqui, e a
  // mesma vai para o preflight e para a tentativa — é ela que fixa o link
  // que foi confirmado na bio. O executor confere a porta DE NOVO antes de
  // falar com a Meta e antes do media_publish.
  // P2.50 (D5): a chave de quem chama só vale se for DESTE conteúdo e DESTE
  // canal (prefixo `<id>:instagram:`), curta e sem caracteres livres. Fora
  // disso a rota recusa — nunca reaproveita a chave de outro conteúdo.
  const chaveDoCorpo = typeof body?.chaveDaTentativa === 'string' ? body.chaveDaTentativa.trim() : ''
  if (chaveDoCorpo && !chaveDeTentativaDoConteudo(chaveDoCorpo, conteudo.id)) {
    return NextResponse.json(
      { error: 'Chave da tentativa inválida para este conteúdo.', bloqueio: 'CHAVE_DA_TENTATIVA_INVALIDA' },
      { status: 400 }
    )
  }
  const chaveDaTentativa =
    chaveDoCorpo ||
    chaveDaTentativaPadrao({ contentId: conteudo.id, canal: 'instagram', dataAgendamento: conteudo.dataAgendamento })
  const porta = await autorizarPublicacaoReal({
    workspaceId: session.user.workspaceId,
    contentId: conteudo.id,
    canal: 'instagram',
    chaveDaTentativa,
    envio: { tipoMidia, destino },
  })
  if (!porta.liberada) {
    return NextResponse.json(
      { error: porta.explicacao, bloqueio: porta.bloqueio },
      { status: 409 }
    )
  }

  // `workspaceId` vem da SESSAO, nunca do corpo. A chave da tentativa é a
  // chave do trabalho: o mesmo pedido reencontra o mesmo trabalho, e o que
  // já saiu não sai de novo.
  const r = await iniciarTrabalhoLongo({
    workspaceId: session.user.workspaceId,
    tipo: 'LONGO_PUBLICAR_INSTAGRAM',
    chave: chaveDaPublicacao({ chaveDaTentativa }),
    entityType: 'CONTEUDO',
    entityId: conteudo.id,
    contexto: { pedido: { conteudoId: conteudo.id, tipoMidia, destino, chaveDaTentativa, origem: 'manual' } },
    executor: executorDaPublicacao(),
    origem: req.nextUrl.origin,
    mensagemDeProcessando: 'Publicação em andamento. O Patrono acompanha o processamento do Instagram.',
  })
  return NextResponse.json(r.resposta.corpo, { status: r.resposta.status })
}
