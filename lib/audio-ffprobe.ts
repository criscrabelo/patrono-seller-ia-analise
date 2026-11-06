/**
 * Utilitário de análise de áudio via FFmpeg (sem ffprobe — o projeto só
 * empacota `ffmpeg-static`). Usa o filtro `volumedetect` do próprio FFmpeg
 * e o parsing do `Duration:` que ele sempre imprime no stderr — real,
 * sem nenhuma dependência nova, usado pelo Voice Quality Gate (Rodada 7).
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import ffmpegStatic from 'ffmpeg-static'

const execFileAsync = promisify(execFile)

export interface AnaliseAudio {
  duracaoSegundos: number | null
  meanVolumeDb: number | null
  maxVolumeDb: number | null
}

function ffmpegBin(): string {
  const bin = ffmpegStatic as unknown as string | null
  if (!bin) throw new Error('ffmpeg-static não encontrou o binário FFmpeg')
  return bin
}

/**
 * Roda `ffmpeg -i arquivo -af volumedetect -f null -` e faz o parsing do
 * stderr (FFmpeg sempre imprime duração e volumedetect por ali, nunca no
 * stdout). Isolado como função pura de I/O para poder ser testado com um
 * `execFile` mockado.
 */
export async function analisarAudio(caminho: string, exec: typeof execFileAsync = execFileAsync): Promise<AnaliseAudio> {
  let stderr = ''
  try {
    const resultado = await exec(ffmpegBin(), ['-i', caminho, '-af', 'volumedetect', '-f', 'null', '-'])
    stderr = (resultado as { stderr?: string }).stderr ?? ''
  } catch (e) {
    // FFmpeg sai com código != 0 mesmo em execução normal com "-f null -"
    // em algumas versões — o stderr ainda contém a informação que queremos.
    stderr = (e as { stderr?: string })?.stderr ?? ''
  }

  const duracaoMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/)
  const duracaoSegundos = duracaoMatch
    ? parseInt(duracaoMatch[1], 10) * 3600 + parseInt(duracaoMatch[2], 10) * 60 + parseFloat(duracaoMatch[3])
    : null

  const meanMatch = stderr.match(/mean_volume:\s*(-?\d+(\.\d+)?)\s*dB/)
  const maxMatch = stderr.match(/max_volume:\s*(-?\d+(\.\d+)?)\s*dB/)

  return {
    duracaoSegundos,
    meanVolumeDb: meanMatch ? parseFloat(meanMatch[1]) : null,
    maxVolumeDb: maxMatch ? parseFloat(maxMatch[1]) : null,
  }
}

export interface AnaliseVideo {
  duracaoSegundos: number | null
  larguraPx: number | null
  alturaPx: number | null
}

/** Mesma técnica de `analisarAudio`, mas lendo resolução do stream de vídeo — usado pelo Identity Quality Gate. */
export async function analisarVideo(caminho: string, exec: typeof execFileAsync = execFileAsync): Promise<AnaliseVideo> {
  let stderr = ''
  try {
    const resultado = await exec(ffmpegBin(), ['-i', caminho, '-f', 'null', '-'])
    stderr = (resultado as { stderr?: string }).stderr ?? ''
  } catch (e) {
    stderr = (e as { stderr?: string })?.stderr ?? ''
  }

  const duracaoMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/)
  const duracaoSegundos = duracaoMatch
    ? parseInt(duracaoMatch[1], 10) * 3600 + parseInt(duracaoMatch[2], 10) * 60 + parseFloat(duracaoMatch[3])
    : null

  const resolucaoMatch = stderr.match(/Video:.*?(\d{2,5})x(\d{2,5})/)

  return {
    duracaoSegundos,
    larguraPx: resolucaoMatch ? parseInt(resolucaoMatch[1], 10) : null,
    alturaPx: resolucaoMatch ? parseInt(resolucaoMatch[2], 10) : null,
  }
}
