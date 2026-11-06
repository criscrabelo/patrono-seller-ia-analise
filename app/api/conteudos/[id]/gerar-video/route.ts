import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { prisma } from '@/lib/prisma'
import { submeterGeracaoVideo, MOTORES_VIDEO, BloqueadoPorPoliticaDeCusto, type MotorVideo } from '@/lib/falai'
import { RendererFFmpeg } from '@/lib/renderer-ffmpeg'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Configuração de durações suportadas. Cada duração mapeia para um
// conjunto de clipes (Kling v3 Pro maxa em 15s por clipe).
function planoDeClipes(duracaoTotal: number): { duracaoClipe: number; numClipes: number } {
  if (duracaoTotal === 30) return { duracaoClipe: 15, numClipes: 2 }
  // 5, 10 ou 15s — clipe único
  return { duracaoClipe: duracaoTotal, numClipes: 1 }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const body = await req.json().catch(() => ({}))
  const motor: MotorVideo = body.motor === 'veo' || body.motor === 'luma' ? body.motor : 'kling'
  const duracaoSolicitada = Number(body.duracao) || 5

  // Cada motor aceita durações diferentes; Veo é fixo (ignora o valor).
  const DURACOES_VALIDAS_POR_MOTOR: Record<MotorVideo, number[] | null> = {
    kling: [5, 10, 15, 30],
    veo: null,
    luma: [5, 9],
  }
  const duracoesValidas = DURACOES_VALIDAS_POR_MOTOR[motor]
  if (duracoesValidas && !duracoesValidas.includes(duracaoSolicitada)) {
    return NextResponse.json(
      { error: `Duração inválida para ${MOTORES_VIDEO[motor].label} (use ${duracoesValidas.join(', ')} segundos)` },
      { status: 400 }
    )
  }

  const conteudo = await prisma.conteudo.findFirst({
    where: { id, workspaceId: session.user.workspaceId },
    include: { produto: { select: { imagens: true, nome: true } } },
  })
  if (!conteudo) {
    return NextResponse.json({ error: 'Conteúdo não encontrado' }, { status: 404 })
  }
  // P2.72: a peça de uma publicação assistida é a versão APROVADA (arquivo + texto): não é regerada nem legendada por fora
  if (await prisma.publicacaoAssistida.findFirst({ where: { workspaceId: session.user.workspaceId, conteudoId: id }, select: { id: true } }))
    return NextResponse.json({ error: 'Esta peça é de uma publicação assistida aprovada: para mudar, peça ajuste na Operação.' }, { status: 409 })

  const imagens = conteudo.produto.imagens ?? []
  if (imagens.length === 0) {
    return NextResponse.json(
      { error: 'O produto não tem imagens. Adicione uma imagem ao produto antes de gerar o vídeo.' },
      { status: 400 }
    )
  }

  const prompt = (conteudo.promptVideoIA || conteudo.promptCurto || '').trim()
  if (!prompt) {
    return NextResponse.json(
      { error: 'O conteúdo não tem prompt de vídeo. Gere o conteúdo novamente.' },
      { status: 400 }
    )
  }

  // Veo gera um clipe único (~8s com áudio); Kling pode compor vários clipes.
  const { duracaoClipe, numClipes } = MOTORES_VIDEO[motor].clipeUnico
    ? { duracaoClipe: duracaoSolicitada, numClipes: 1 }
    : planoDeClipes(duracaoSolicitada)

  // P2.50 (D4): RESERVA atômica antes de qualquer submissão — dois cliques não contratam dois trabalhos.
  const reservaEm = new Date().toISOString()
  const reserva = await prisma.conteudo.updateMany({ where: { id: conteudo.id, workspaceId: session.user.workspaceId, videoRequestId: null }, data: { videoRequestId: JSON.stringify({ fase: 'submetendo', em: reservaEm }), videoErro: null } })
  if (reserva.count !== 1) return NextResponse.json({ error: 'Já existe uma geração de vídeo em andamento para este conteúdo.' }, { status: 409 })

  try {
    // Submete todos os clipes em paralelo, cada um usando uma imagem diferente
    // (cicla pelas imagens disponíveis se houver menos imagens que clipes).
    let submissoes
    try {
      submissoes = await Promise.all(
        Array.from({ length: numClipes }, (_, i) =>
          submeterGeracaoVideo({
            imageUrl: imagens[i % imagens.length],
            prompt,
            duracaoSegundos: duracaoClipe,
          }, motor, session.user.workspaceId, `gerar-video:${conteudo.id}:${reservaEm}:${i}`) // P2.50 (D3): um clipe = uma cobrança
        )
      )
    } catch (e) {
      if (!(e instanceof BloqueadoPorPoliticaDeCusto)) throw e

      // FALLBACK GRATUITO EXECUTADO DE VERDADE (revisão do P0.1): IA de vídeo
      // bloqueada por política de custo cai no FFmpeg local, que produz um
      // vídeo 9:16 real a partir da mesma imagem autorizada, por R$ 0,00.
      // Não é o mesmo resultado — não há movimento gerado por IA —, e por
      // isso a resposta diz explicitamente qual caminho foi usado.
      console.warn('[gerar-video] IA de vídeo bloqueada por política de custo — renderizando localmente com FFmpeg.')
      const renderer = new RendererFFmpeg()
      const local = await renderer.renderTikTokVideo({
        imagemUrl: imagens[0],
        hook: conteudo.textoTela ?? conteudo.produto.nome,
        legendaVisual: conteudo.legendaTiktok ?? '',
        cta: conteudo.chamadaAcao ?? '',
        duracaoSegundos: Math.min(duracaoSolicitada, 15),
      })

      await prisma.conteudo.update({
        where: { id: conteudo.id },
        data: { videoUrl: local.url, videoRequestId: null },
      })

      return NextResponse.json({
        geradoSemIaPaga: true,
        motor: 'ffmpeg-local',
        videoUrl: local.url,
        duracaoSegundos: local.durationSeconds,
        aviso:
          'IA de vídeo bloqueada por política de custo zero. Vídeo renderizado localmente com FFmpeg (9:16, sem movimento gerado por IA), sem nenhum custo.',
      })
    }

    const estado = {
      fase: 'gerando_clipes' as const,
      motor,
      duracaoTotal: duracaoSolicitada,
      clipes: submissoes.map((s) => ({
        requestId: s.requestId,
        statusUrl: s.statusUrl,
        resultUrl: s.resultUrl,
        videoUrl: null as string | null,
      })),
      compose: null as null | { requestId: string; statusUrl: string; resultUrl: string },
    }

    await prisma.conteudo.update({
      where: { id: conteudo.id },
      data: {
        videoRequestId: JSON.stringify(estado),
        videoErro: null,
      },
    })

    return NextResponse.json({ ok: true, numClipes, duracaoTotal: duracaoSolicitada })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha ao iniciar geração de vídeo'
    await prisma.conteudo.update({
      where: { id: conteudo.id },
      // Nada foi submetido (ou a submissão falhou): libera a reserva para tentar de novo.
      data: { videoErro: msg, videoRequestId: null },
    })
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
