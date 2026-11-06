/**
 * Primeiro pipeline real de lip-sync + fallback sem GPU (Rodada 9, regras
 * 15-16). Reference Video da proprietária + áudio Chatterbox gerado →
 * MuseTalk → vídeo curto (5-10s), validando apenas identidade/voz/
 * sincronização labial/naturalidade — sem produto ainda. Quando a máquina
 * não tem GPU/MuseTalk disponível, NUNCA finge lip-sync: gera uma prévia
 * real e honesta rotulada `VOICE_ONLY_PREVIEW` (foto + voz clonada + motion
 * graphics + legendas). Nenhum dos dois caminhos é publicado — é sempre
 * uma prévia privada.
 */

import type { LipSyncProvider } from './digital-twin'
import { analisarVideo } from './audio-ffprobe'
import { RendererFFmpeg } from './renderer-ffmpeg'

export const AVATAR_PREVIEW_STATUSES = ['READY_LIP_SYNC_PREVIEW', 'READY_VOICE_ONLY_PREVIEW', 'FAILED'] as const
export type AvatarPreviewStatus = (typeof AVATAR_PREVIEW_STATUSES)[number]

/** Duração inicial esperada da primeira prévia de lip-sync (regra 15). */
export const LIMITE_DURACAO_LIP_SYNC = { minSegundos: 5, maxSegundos: 10 }

export interface AvatarPreviewResultado {
  status: AvatarPreviewStatus
  videoUrl: string | null
  /** P2.33.1 — prévia com rosto/voz: só o arquivo LOCAL (quem chama guarda no bucket privado). Nunca URL pública. */
  caminhoLocal?: string | null
  motivo: string
}

export interface LipSyncPreviewDeps {
  /** MuseTalk realmente confirmado disponível neste ambiente — checado por quem chama, nunca assumido aqui. */
  disponivel: boolean
  provider: LipSyncProvider
  referenceVideoUrl: string
  audioUrl: string
  resolverParaCaminhoLocal: (videoUrl: string) => Promise<string>
}

/**
 * Caminho COM GPU/MuseTalk. Só tenta gerar se `disponivel` for true — nunca
 * assume presença do motor. Valida a duração do resultado (5-10s) antes de
 * aprovar como prévia inicial.
 */
export async function gerarPreviaLipSync(deps: LipSyncPreviewDeps): Promise<AvatarPreviewResultado> {
  if (!deps.disponivel) {
    return {
      status: 'FAILED',
      videoUrl: null,
      motivo: 'MuseTalk não confirmado disponível neste ambiente — use gerarPreviaVozSomente() para o fallback real sem GPU (VOICE_ONLY_PREVIEW).',
    }
  }

  let videoUrl: string
  try {
    const resultado = await deps.provider.sincronizar({ videoUrl: deps.referenceVideoUrl, audioUrl: deps.audioUrl })
    videoUrl = resultado.videoUrl
  } catch (e) {
    return { status: 'FAILED', videoUrl: null, motivo: e instanceof Error ? e.message : 'Falha ao gerar lip-sync.' }
  }

  let caminhoLocal: string
  try {
    caminhoLocal = await deps.resolverParaCaminhoLocal(videoUrl)
  } catch (e) {
    return { status: 'FAILED', videoUrl: null, motivo: e instanceof Error ? e.message : 'Falha ao obter o vídeo gerado para validação.' }
  }

  const analise = await analisarVideo(caminhoLocal)
  if (analise.duracaoSegundos == null) {
    return { status: 'FAILED', videoUrl, motivo: 'Não foi possível determinar a duração do vídeo gerado.' }
  }
  if (analise.duracaoSegundos < LIMITE_DURACAO_LIP_SYNC.minSegundos || analise.duracaoSegundos > LIMITE_DURACAO_LIP_SYNC.maxSegundos) {
    return {
      status: 'FAILED',
      videoUrl,
      motivo: `Duração (${analise.duracaoSegundos.toFixed(1)}s) fora do intervalo esperado para a primeira prévia de lip-sync (${LIMITE_DURACAO_LIP_SYNC.minSegundos}-${LIMITE_DURACAO_LIP_SYNC.maxSegundos}s).`,
    }
  }

  return {
    status: 'READY_LIP_SYNC_PREVIEW',
    videoUrl,
    motivo: 'Prévia de lip-sync gerada — valida apenas identidade/voz/sincronização labial/naturalidade, sem produto. Nunca publicada automaticamente.',
  }
}

export interface VoiceOnlyPreviewDeps {
  faceImageUrl: string
  /** Áudio já sintetizado e aprovado no Voice Quality Gate (arquivo local, não uma URL remota). */
  audioLocalPath: string
  legenda: string
  renderer?: RendererFFmpeg
}

/**
 * Fallback real sem GPU (regra 16) — foto + voz clonada + motion graphics +
 * legendas + leve movimento. Roda de verdade com FFmpeg (sem depender de
 * GPU/MuseTalk). NUNCA rotulado como lip-sync.
 */
export async function gerarPreviaVozSomente(deps: VoiceOnlyPreviewDeps): Promise<AvatarPreviewResultado> {
  const renderer = deps.renderer ?? new RendererFFmpeg()
  try {
    const resultado = await renderer.renderVoiceOnlyPreview({
      imagemUrl: deps.faceImageUrl,
      audioLocalPath: deps.audioLocalPath,
      legenda: deps.legenda,
    })
    return {
      status: 'READY_VOICE_ONLY_PREVIEW',
      videoUrl: null,
      caminhoLocal: resultado.caminhoLocal,
      motivo: 'Prévia real sem GPU (foto + voz clonada + motion graphics + legendas) — nunca rotulada como lip-sync, nunca publicada automaticamente.',
    }
  } catch (e) {
    return { status: 'FAILED', videoUrl: null, motivo: e instanceof Error ? e.message : 'Falha ao gerar a prévia sem GPU.' }
  }
}
