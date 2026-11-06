// Concatena múltiplos clipes de vídeo em um único arquivo usando FFmpeg.
import { execFile } from 'child_process'
import { promisify } from 'util'
import { writeFile, readFile, unlink } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import ffmpegStatic from 'ffmpeg-static'

const execFileAsync = promisify(execFile)

/**
 * Baixa cada URL da lista, concatena os clipes com FFmpeg e retorna o buffer do vídeo final.
 * @param urls - Lista de URLs públicas dos clipes MP4 a concatenar.
 */
export async function concatVideos(urls: string[]): Promise<Buffer> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const tmp = tmpdir()
  const clipPaths: string[] = []
  const outPath = join(tmp, `out-${id}.mp4`)
  const listPath = join(tmp, `list-${id}.txt`)

  try {
    // Baixa cada clipe e grava em disco.
    for (let i = 0; i < urls.length; i++) {
      const res = await fetch(urls[i])
      if (!res.ok) {
        throw new Error(`Não consegui baixar o clipe ${i + 1} (HTTP ${res.status}): ${urls[i]}`)
      }
      const ab = await res.arrayBuffer()
      const clipPath = join(tmp, `clip-${id}-${i}.mp4`)
      await writeFile(clipPath, Buffer.from(ab))
      clipPaths.push(clipPath)
    }

    // Cria o arquivo de lista para o concat demuxer do FFmpeg.
    const listContent = clipPaths.map((p) => `file '${p}'`).join('\n')
    await writeFile(listPath, listContent, 'utf8')

    // Obtém o caminho do binário ffmpeg-static.
    const ffmpegBin = ffmpegStatic
    if (!ffmpegBin) throw new Error('ffmpeg-static não encontrou o binário FFmpeg')

    // Concatena selecionando apenas a primeira track de vídeo.
    // Kling v3 gera MP4 com 2 tracks de vídeo (principal + thumbnail);
    // sem o -map 0:v:0 o muxer MP4 rejeita com "Multiple video tracks not supported".
    await execFileAsync(ffmpegBin, [
      '-f', 'concat',
      '-safe', '0',
      '-i', listPath,
      '-map', '0:v:0',
      '-c:v', 'copy',
      '-an',
      '-y',
      outPath,
    ])

    // Lê o arquivo de saída e retorna como Buffer.
    const outBuffer = await readFile(outPath)
    return outBuffer
  } finally {
    // Limpa todos os arquivos temporários, independentemente de sucesso ou erro.
    const toDelete = [...clipPaths, listPath, outPath]
    await Promise.allSettled(toDelete.map((p) => unlink(p)))
  }
}
