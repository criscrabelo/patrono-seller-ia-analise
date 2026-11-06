/**
 * Cache local de pesos de modelo (Rodada 9, regras 27-28) — NUNCA
 * versionado no Git (fora do repositório, sob o diretório do usuário).
 * Download retomável: se cair no meio, a próxima tentativa continua de
 * onde parou (HTTP `Range`), nunca recomeça do zero sem necessidade.
 */

import os from 'os'
import path from 'path'
import { mkdir, stat, rename, appendFile } from 'fs/promises'
import { createWriteStream } from 'fs'

/** Diretório de cache — fora do repositório Git, configurável por env para instalações diferentes. */
export function obterDiretorioCacheModelos(): string {
  return process.env.DIGITAL_TWIN_MODEL_CACHE_DIR || path.join(os.homedir(), '.patrono-digital-twin', 'model-cache')
}

export async function garantirDiretorioCacheModelos(): Promise<string> {
  const dir = obterDiretorioCacheModelos()
  await mkdir(dir, { recursive: true })
  return dir
}

/** Consulta o tamanho esperado do download via HEAD, sem baixar nada — mostrado à usuária antes de começar. */
export async function estimarTamanhoDownloadBytes(url: string, fetcher: typeof fetch = fetch): Promise<number | null> {
  try {
    const res = await fetcher(url, { method: 'HEAD' })
    const tamanho = res.headers.get('content-length')
    return tamanho ? parseInt(tamanho, 10) : null
  } catch {
    return null
  }
}

export interface ResultadoDownload {
  concluido: boolean
  bytesBaixados: number
  motivo: string
}

/**
 * Baixa `url` para `destinoFinal` com suporte a retomada: se já existir um
 * arquivo parcial (`.part`), continua de onde parou via `Range`. Nunca
 * obriga a usuária a recomeçar um download grande do zero por causa de
 * uma queda de conexão.
 */
export async function baixarComRetomada(url: string, destinoFinal: string, fetcher: typeof fetch = fetch): Promise<ResultadoDownload> {
  const destinoParcial = `${destinoFinal}.part`
  let bytesExistentes = 0
  try {
    const info = await stat(destinoParcial)
    bytesExistentes = info.size
  } catch {
    bytesExistentes = 0
  }

  const headers: Record<string, string> = bytesExistentes > 0 ? { Range: `bytes=${bytesExistentes}-` } : {}
  const res = await fetcher(url, { headers })

  if (!res.ok && res.status !== 206) {
    return { concluido: false, bytesBaixados: bytesExistentes, motivo: `Download falhou (HTTP ${res.status}) — pode ser retomado depois.` }
  }
  if (bytesExistentes > 0 && res.status !== 206) {
    // Servidor não suportou Range — precisa recomeçar do zero desta vez.
    bytesExistentes = 0
  }

  if (!res.body) {
    return { concluido: false, bytesBaixados: bytesExistentes, motivo: 'Resposta sem corpo — nada para gravar.' }
  }

  const buffer = Buffer.from(await res.arrayBuffer())
  if (bytesExistentes > 0 && res.status === 206) {
    await appendFile(destinoParcial, buffer)
  } else {
    await new Promise<void>((resolve, reject) => {
      const ws = createWriteStream(destinoParcial)
      ws.write(buffer, (err) => (err ? reject(err) : resolve()))
      ws.end()
    })
  }

  const infoFinal = await stat(destinoParcial)
  await rename(destinoParcial, destinoFinal)
  return { concluido: true, bytesBaixados: infoFinal.size, motivo: 'Download concluído.' }
}
