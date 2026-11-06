import { createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { prisma } from '@/lib/prisma'
import {
  consultarStatusVideo,
  obterResultadoVideo,
  comporVideos,
  consultarStatusCompose,
  obterResultadoCompose,
  BloqueadoPorPoliticaDeCusto,
} from '@/lib/falai'
import { concatVideos } from '@/lib/concat-video'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

interface ClipeEstado {
  requestId: string
  statusUrl: string
  resultUrl: string
  videoUrl: string | null
}

interface EstadoVideo {
  fase: 'gerando_clipes' | 'compondo'
  duracaoTotal?: number
  clipes: ClipeEstado[]
  compose: null | { requestId: string; statusUrl: string; resultUrl: string }
}

async function baixarUploadParaSupabase(videoUrlFal: string, userId: string): Promise<string> {
  const videoResp = await fetch(videoUrlFal)
  if (!videoResp.ok) {
    throw new Error(`Não consegui baixar o vídeo do fal.ai (HTTP ${videoResp.status})`)
  }
  return subirBufferParaSupabase(Buffer.from(await videoResp.arrayBuffer()), userId, 'fal')
}

async function subirBufferParaSupabase(buffer: Buffer, userId: string, origem: string): Promise<string> {
  const path = `${userId}/${Date.now()}-${origem}.mp4`
  const { data: up, error: upErr } = await supabaseAdmin.storage
    .from('videos')
    .upload(path, buffer, { contentType: 'video/mp4', upsert: false })
  if (upErr) throw new Error(`Upload no Supabase falhou: ${upErr.message}`)
  const { data: urlData } = supabaseAdmin.storage.from('videos').getPublicUrl(up.path)
  return urlData.publicUrl
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const conteudo = await prisma.conteudo.findFirst({
    where: { id, workspaceId: session.user.workspaceId },
  })
  if (!conteudo) return NextResponse.json({ error: 'Conteúdo não encontrado' }, { status: 404 })

  if (conteudo.videoUrl) {
    return NextResponse.json({ status: 'pronto', videoUrl: conteudo.videoUrl })
  }
  if (!conteudo.videoRequestId) {
    return NextResponse.json({ status: 'nenhum', erro: conteudo.videoErro })
  }

  // Tenta interpretar o videoRequestId como nosso estado JSON.
  // P2.50: o mesmo campo guarda o container do Instagram durante a publicação — não é job de vídeo, não se apaga aqui.
  if (conteudo.videoRequestId.startsWith('ig:')) return NextResponse.json({ status: 'publicando', fase: 'instagram' })
  let estado: EstadoVideo
  try {
    estado = JSON.parse(conteudo.videoRequestId) as EstadoVideo
    // P2.50 (D4): reserva da submissão em curso — ainda não há clipes para consultar.
    const reserva = estado as unknown as { fase?: string; em?: string }
    if (reserva.fase === 'submetendo') {
      if (Date.now() - new Date(reserva.em ?? 0).getTime() > 15 * 60_000) {
        await prisma.conteudo.updateMany({ where: { id: conteudo.id, videoRequestId: conteudo.videoRequestId }, data: { videoRequestId: null, videoErro: 'A submissão do vídeo foi interrompida. Gere de novo.' } })
        return NextResponse.json({ status: 'erro', erro: 'A submissão foi interrompida. Gere de novo.' }, { status: 502 })
      }
      return NextResponse.json({ status: 'gerando', fase: 'submetendo' })
    }
    if (!estado.clipes || !Array.isArray(estado.clipes)) throw new Error('formato inválido')
  } catch {
    await prisma.conteudo.update({
      where: { id: conteudo.id },
      data: { videoRequestId: null, videoErro: 'Job em formato antigo — gere novamente.' },
    })
    return NextResponse.json(
      { status: 'erro', erro: 'Formato antigo. Tente gerar de novo.' },
      { status: 502 }
    )
  }

  try {
    // ─── FASE 1: gerando_clipes ──────────────────────────────────────
    if (estado.fase === 'gerando_clipes') {
      let mudouEstado = false
      let todosProntos = true

      for (const clipe of estado.clipes) {
        if (clipe.videoUrl) continue // já está pronto
        const { status } = await consultarStatusVideo(clipe.statusUrl)
        if (status === 'COMPLETED') {
          const { videoUrl } = await obterResultadoVideo(clipe.resultUrl)
          clipe.videoUrl = videoUrl
          mudouEstado = true
        } else if (status === 'FAILED') {
          throw new Error('Um dos clipes falhou no fal.ai')
        } else {
          todosProntos = false
        }
      }

      if (!todosProntos) {
        if (mudouEstado) {
          await prisma.conteudo.update({
            where: { id: conteudo.id },
            data: { videoRequestId: JSON.stringify(estado) },
          })
        }
        return NextResponse.json({ status: 'gerando', fase: 'gerando_clipes' })
      }

      // Todos os clipes prontos!
      if (estado.clipes.length === 1) {
        // Clipe único — pula composição, baixa e salva
        const videoUrlClipe = estado.clipes[0].videoUrl
        if (!videoUrlClipe) throw new Error('Clipe sem URL após COMPLETED')
        const urlFinal = await baixarUploadParaSupabase(videoUrlClipe, session.user.id)
        await prisma.conteudo.update({
          where: { id: conteudo.id },
          data: { videoUrl: urlFinal, videoRequestId: null, videoErro: null },
        })
        return NextResponse.json({ status: 'pronto', videoUrl: urlFinal })
      }

      // Múltiplos clipes — composição.
      const urlsClipes = estado.clipes.map((c) => c.videoUrl).filter((u): u is string => !!u)
      // P2.50 (D4): só UMA consulta submete a composição — quem ganha a troca do estado (compare-and-set) submete.
      const estadoLido = conteudo.videoRequestId
      const emComposicao = JSON.stringify({ ...estado, fase: 'compondo', compose: null })
      const ganhou = await prisma.conteudo.updateMany({ where: { id: conteudo.id, videoRequestId: estadoLido }, data: { videoRequestId: emComposicao } })
      if (ganhou.count !== 1) return NextResponse.json({ status: 'gerando', fase: 'compondo' })
      try {
        // P2.50 (D3): a mesma lista de clipes só é composta (e paga) uma vez.
        const chaveCompor = `compor-video:${conteudo.id}:${createHash('sha256').update(urlsClipes.join('|')).digest('hex').slice(0, 32)}`
        const composeJob = await comporVideos(urlsClipes, conteudo.workspaceId, chaveCompor)
        estado.fase = 'compondo'
        estado.compose = composeJob
        await prisma.conteudo.update({
          where: { id: conteudo.id },
          data: { videoRequestId: JSON.stringify(estado) },
        })
        return NextResponse.json({ status: 'gerando', fase: 'compondo' })
      } catch (e) {
        if (!(e instanceof BloqueadoPorPoliticaDeCusto)) throw e
        // FALLBACK EXECUTADO, não apenas mapeado: concatenar clipes é uma
        // capacidade que este repositório TEM de verdade (ffmpeg-static, em
        // `lib/concat-video.ts`). Com a composição paga bloqueada, o fluxo
        // termina sozinho por R$ 0,00 — a proprietária recebe o vídeo, não
        // um erro. Os clipes já foram gerados e pagos; parar aqui seria
        // desperdiçar o que já custou.
        const buffer = await concatVideos(urlsClipes)
        const urlFinal = await subirBufferParaSupabase(buffer, session.user.id, 'local')
        await prisma.conteudo.update({
          where: { id: conteudo.id },
          data: { videoUrl: urlFinal, videoRequestId: null, videoErro: null },
        })
        return NextResponse.json({
          status: 'pronto',
          videoUrl: urlFinal,
          composicao: 'ffmpeg-local',
          aviso: 'Composição paga bloqueada pela política de custo — os clipes foram unidos localmente com FFmpeg, sem custo.',
        })
      }
    }

    // ─── FASE 2: compondo ────────────────────────────────────────────
    if (estado.fase === 'compondo' && estado.compose) {
      const { status } = await consultarStatusCompose(estado.compose.statusUrl)
      if (status === 'IN_QUEUE' || status === 'IN_PROGRESS') {
        return NextResponse.json({ status: 'gerando', fase: 'compondo' })
      }
      if (status === 'FAILED') {
        throw new Error('Composição dos vídeos falhou no fal.ai')
      }
      // COMPLETED → busca a URL composta, baixa, sobe pro Supabase
      const { videoUrl: composedUrl } = await obterResultadoCompose(estado.compose.resultUrl)
      const urlFinal = await baixarUploadParaSupabase(composedUrl, session.user.id)
      await prisma.conteudo.update({
        where: { id: conteudo.id },
        data: { videoUrl: urlFinal, videoRequestId: null, videoErro: null },
      })
      return NextResponse.json({ status: 'pronto', videoUrl: urlFinal })
    }

    return NextResponse.json({ status: 'erro', erro: 'Estado desconhecido' }, { status: 500 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha ao consultar status do vídeo'
    await prisma.conteudo.update({
      where: { id: conteudo.id },
      data: { videoErro: msg, videoRequestId: null },
    })
    return NextResponse.json({ status: 'erro', erro: msg }, { status: 502 })
  }
}
