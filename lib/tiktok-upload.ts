/**
 * Upload de vídeo via `FILE_UPLOAD` (Rodada 6, regra 10) — alternativa ao
 * `PULL_FROM_URL` quando o arquivo não está (ou não deve estar) hospedado
 * numa URL pública. Segue as regras oficiais de chunking da Content
 * Posting API: PUT de cada pedaço para a `upload_url` devolvida pelo
 * `init`, com `Content-Range`/`Content-Length` — nunca um único POST com
 * o vídeo inteiro no corpo (evita estourar limite de tamanho de body de
 * qualquer endpoint intermediário nosso).
 */

const TAMANHO_MINIMO_CHUNK = 5 * 1024 * 1024 // 5MB — mínimo aceito pela API (exceto o último pedaço)
const TAMANHO_MAXIMO_CHUNK = 64 * 1024 * 1024 // 64MB — máximo aceito por chunk
const TAMANHO_CHUNK_PADRAO = 10 * 1024 * 1024 // 10MB — valor prático recomendado

export interface ChunkPlano {
  index: number
  start: number
  end: number // inclusivo, como no header Content-Range
  size: number
}

/** Calcula o plano de chunks para um arquivo de `tamanhoTotal` bytes — pura, sem I/O, fácil de testar. */
export function planejarChunks(tamanhoTotal: number, tamanhoChunk: number = TAMANHO_CHUNK_PADRAO): ChunkPlano[] {
  if (tamanhoTotal <= 0) throw new Error('Tamanho do arquivo precisa ser maior que zero.')
  const chunk = Math.min(Math.max(tamanhoChunk, TAMANHO_MINIMO_CHUNK), TAMANHO_MAXIMO_CHUNK)

  // Arquivo menor que o mínimo de chunk vira um único chunk (a regra de "mínimo,
  // exceto o último" já cobre esse caso — aqui não HÁ "não-último").
  if (tamanhoTotal <= chunk) {
    return [{ index: 0, start: 0, end: tamanhoTotal - 1, size: tamanhoTotal }]
  }

  const plano: ChunkPlano[] = []
  let offset = 0
  let index = 0
  while (offset < tamanhoTotal) {
    const restante = tamanhoTotal - offset
    // Nunca deixa o ÚLTIMO chunk menor que o mínimo permitido (exceto quando o
    // restante já é o próprio último pedaço) — junta ao penúltimo se precisar.
    const tamanhoDesteChunk = restante <= chunk + TAMANHO_MINIMO_CHUNK && restante > chunk ? restante : Math.min(chunk, restante)
    const end = offset + tamanhoDesteChunk - 1
    plano.push({ index, start: offset, end, size: tamanhoDesteChunk })
    offset = end + 1
    index++
  }
  return plano
}

/**
 * Faz o upload de fato, um chunk por vez, para a `upload_url` devolvida pelo
 * `init` do Direct Post. `lerChunk` isola a leitura do arquivo (Buffer/stream)
 * para que isto seja testável sem um arquivo real em disco.
 */
export async function enviarArquivoEmChunks(params: {
  uploadUrl: string
  tamanhoTotal: number
  contentType: string
  lerChunk: (chunk: ChunkPlano) => Promise<Buffer>
  tamanhoChunk?: number
  fetcher?: typeof fetch
}): Promise<void> {
  const fetcher = params.fetcher ?? fetch
  const plano = planejarChunks(params.tamanhoTotal, params.tamanhoChunk)

  for (const chunk of plano) {
    const dados = await params.lerChunk(chunk)
    const res = await fetcher(params.uploadUrl, {
      method: 'PUT',
      headers: {
        'content-type': params.contentType,
        'content-length': String(chunk.size),
        'content-range': `bytes ${chunk.start}-${chunk.end}/${params.tamanhoTotal}`,
      },
      body: new Uint8Array(dados),
    })
    if (!res.ok) {
      throw new Error(`Falha ao enviar o chunk ${chunk.index} (${chunk.start}-${chunk.end}): HTTP ${res.status}`)
    }
  }
}
