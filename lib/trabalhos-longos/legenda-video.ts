/**
 * P2.2 — Legenda queimada no vídeo (fal.ai veed/subtitles), em segundo plano.
 *
 * Era a rota `adicionar-legenda` esperando até 50 s dentro da requisição.
 * O que garante que a retomada não cobre duas vezes:
 *
 *   1. `fase: 'SUBMETENDO'` é gravada ANTES do pedido pago;
 *   2. as URLs de status/resultado do fal.ai são gravadas logo DEPOIS;
 *   3. uma retomada que encontra (1) sem (2) não reenvia: o pedido pode ter
 *      entrado lá — é `incerto`.
 *
 * O texto da legenda e o SRT são locais e gratuitos; só a submissão custa.
 */
import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { prisma } from '../prisma'
import {
  adicionarLegendaVideo,
  consultarStatusVideo,
  obterResultadoLegenda,
  montarSrt,
  BloqueadoPorPoliticaDeCusto,
  falRecusouComCerteza,
} from '../falai'
import type { Desfecho, Execucao, ExecutorDeTrabalho } from '../trabalho-longo'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
)

const INTERVALO_DE_CONSULTA_MS = 5_000
/** Margem para baixar o resultado e subir no Supabase depois do COMPLETED. */
const MARGEM_PARA_FINALIZAR_MS = 20_000

export interface PedidoDeLegenda {
  conteudoId: string
  userId: string
  preset: string
  /** O vídeo que recebe a legenda. Faz parte da chave. */
  videoUrl: string
  srt: string
}

/** O texto da legenda: narração, depois texto de tela, depois CTA. */
export function textoDaLegenda(c: { narracao: string | null; textoTela: string | null; chamadaAcao: string | null }): string {
  return c.narracao?.trim() || c.textoTela?.trim() || c.chamadaAcao?.trim() || ''
}

export function montarPedidoDeLegenda(params: {
  conteudo: { id: string; videoUrl: string; duracao: number | null; narracao: string | null; textoTela: string | null; chamadaAcao: string | null }
  userId: string
  preset: string
}): PedidoDeLegenda {
  return {
    conteudoId: params.conteudo.id,
    userId: params.userId,
    preset: params.preset,
    videoUrl: params.conteudo.videoUrl,
    srt: montarSrt(textoDaLegenda(params.conteudo), params.conteudo.duracao || 10),
  }
}

/**
 * Mesmo vídeo + mesmo preset + mesmo texto = mesmo trabalho. Depois que a
 * legenda sai, o `videoUrl` do conteúdo muda — e um pedido novo é outro
 * trabalho, como antes.
 */
export function chaveDaLegenda(p: PedidoDeLegenda): string {
  const h = createHash('sha256').update(`${p.videoUrl}|${p.preset}|${p.srt}`).digest('hex').slice(0, 24)
  return `legenda:${p.conteudoId}:${h}`
}

async function baixarUploadParaSupabase(urlFal: string, userId: string): Promise<string> {
  const resp = await fetch(urlFal)
  if (!resp.ok) throw new Error(`Não consegui baixar o vídeo legendado (HTTP ${resp.status})`)
  const buffer = Buffer.from(await resp.arrayBuffer())
  const path = `${userId}/${Date.now()}-legendado.mp4`
  const { data, error } = await supabaseAdmin.storage
    .from('videos')
    .upload(path, buffer, { contentType: 'video/mp4', upsert: false })
  if (error) throw new Error(`Upload no Supabase falhou: ${error.message}`)
  const { data: urlData } = supabaseAdmin.storage.from('videos').getPublicUrl(data.path)
  return urlData.publicUrl
}

/** Portas externas — trocadas por dublês nos testes. */
export interface DependenciasDaLegenda {
  submeter: typeof adicionarLegendaVideo
  consultar: typeof consultarStatusVideo
  resultado: typeof obterResultadoLegenda
  guardarVideo: (urlFal: string, userId: string) => Promise<string>
}

const DEPENDENCIAS_REAIS: DependenciasDaLegenda = {
  submeter: adicionarLegendaVideo,
  consultar: consultarStatusVideo,
  resultado: obterResultadoLegenda,
  guardarVideo: baixarUploadParaSupabase,
}

const processando = (mensagem = 'A legenda ainda está sendo gerada. Aguarde nesta tela.') => ({
  status: 202,
  corpo: { ok: false, processando: true, mensagem },
})

export function executorDaLegenda(dep: DependenciasDaLegenda = DEPENDENCIAS_REAIS): ExecutorDeTrabalho {
  return async (e: Execucao): Promise<Desfecho> => {
    const ctx = e.trabalho.contexto
    const pedido = ctx.pedido as PedidoDeLegenda

    if (typeof ctx.videoUrlFinal === 'string') {
      return { fim: 'concluido', resposta: { status: 200, corpo: { ok: true, videoUrl: ctx.videoUrlFinal } } }
    }

    const conteudo = await prisma.conteudo.findFirst({
      where: { id: pedido.conteudoId, workspaceId: e.trabalho.workspaceId },
      select: { id: true, workspaceId: true },
    })
    if (!conteudo) {
      return { fim: 'falhou', erro: 'Conteúdo não encontrado', resposta: { status: 404, corpo: { error: 'Conteúdo não encontrado' } } }
    }

    let fal = ctx.fal as { statusUrl: string; resultUrl: string; requestId: string } | undefined
    if (!fal) {
      if (ctx.fase === 'SUBMETENDO') {
        // A execução anterior morreu entre "vou pedir" e "pedi". O fal.ai
        // pode ter recebido — e cobrado. Reenviar seria pagar duas vezes.
        return {
          fim: 'incerto',
          erro: 'Submissão ao fal.ai interrompida sem confirmação.',
          resposta: {
            status: 409,
            corpo: {
              error: 'Não foi possível confirmar se o pedido de legenda chegou ao fal.ai. Ele não foi reenviado para não cobrar duas vezes.',
              incerto: true,
            },
          },
        }
      }
      await e.salvar({ fase: 'SUBMETENDO' })
      try {
        const sub = await dep.submeter({ videoUrl: pedido.videoUrl, srtContent: pedido.srt, preset: pedido.preset }, conteudo.workspaceId)
        fal = { statusUrl: sub.statusUrl, resultUrl: sub.resultUrl, requestId: sub.requestId }
        await e.salvar({ fal, fase: 'PROCESSANDO' })
      } catch (err) {
        if (err instanceof BloqueadoPorPoliticaDeCusto) {
          // SEM EQUIVALENTE GRATUITO. Nenhuma função local queima legenda em um
          // vídeo JÁ EXISTENTE — `renderer-ffmpeg` só monta vídeo a partir de
          // imagem. Em vez de inventar uma capacidade que não existe, o SRT
          // gerado (que é local e gratuito) volta para quem chamou, e a
          // pendência fica registrada na Fila de Automação.
          await e.salvar({ fase: null })
          return {
            fim: 'falhou',
            erro: err.message,
            resposta: {
              status: 402,
              corpo: {
                ok: false,
                bloqueadoPorCusto: true,
                erro: err.message,
                srt: pedido.srt,
                pendenciaDeAutomacao: 'fal.ai:adicionar-legenda',
                mensagem:
                  'A legendagem paga está bloqueada pela política de custo zero e ainda não há equivalente local. O arquivo SRT foi gerado sem custo e pode ser usado no editor.',
              },
            },
          }
        }
        const msg = err instanceof Error ? err.message : 'Falha ao adicionar legendas'
        if (falRecusouComCerteza(err)) {
          // O fal.ai recusou (4xx): nada entrou na fila de lá.
          await e.salvar({ fase: null })
          return { fim: 'falhou', erro: msg, resposta: { status: 502, corpo: { error: msg } } }
        }
        return {
          fim: 'incerto',
          erro: msg,
          resposta: {
            status: 502,
            corpo: {
              error: `Sem confirmação do fal.ai (${msg}). O pedido não foi reenviado para não cobrar duas vezes.`,
              incerto: true,
            },
          },
        }
      }
    }

    // Consulta de status é leitura: repetir não cobra nem duplica.
    let status = 'IN_PROGRESS'
    while (e.restanteMs() > MARGEM_PARA_FINALIZAR_MS + INTERVALO_DE_CONSULTA_MS) {
      await e.dormir(INTERVALO_DE_CONSULTA_MS)
      try {
        status = (await dep.consultar(fal.statusUrl)).status
      } catch (err) {
        console.warn('[legenda] consulta de status falhou; tenta de novo:', err instanceof Error ? err.message : err)
        continue
      }
      if (status === 'COMPLETED' || status === 'FAILED') break
    }

    if (status === 'FAILED') {
      // O fal.ai terminou sem vídeo. Um pedido novo, a pedido, é seguro.
      await e.salvar({ fal: null, fase: null })
      return { fim: 'falhou', erro: 'veed/subtitles falhou', resposta: { status: 502, corpo: { error: 'veed/subtitles falhou ao processar o vídeo' } } }
    }
    if (status !== 'COMPLETED') return { fim: 'continuar', resposta: processando() }

    let urlFinal: string
    try {
      const { videoUrl } = await dep.resultado(fal.resultUrl)
      urlFinal = await dep.guardarVideo(videoUrl, pedido.userId)
    } catch (err) {
      // O vídeo está pronto no fal.ai; faltou trazê-lo. `fal` continua
      // gravado, então repetir retoma daqui — sem submeter de novo.
      const msg = err instanceof Error ? err.message : 'Falha ao buscar o vídeo legendado'
      return { fim: 'falhou', erro: msg, resposta: { status: 502, corpo: { error: msg } } }
    }
    await prisma.conteudo.update({ where: { id: conteudo.id }, data: { videoUrl: urlFinal } })
    await e.salvar({ videoUrlFinal: urlFinal, fase: 'CONCLUIDA' })
    return { fim: 'concluido', resposta: { status: 200, corpo: { ok: true, videoUrl: urlFinal } } }
  }
}
