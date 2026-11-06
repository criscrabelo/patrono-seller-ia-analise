/**
 * P2.69 — sha256 REAL do arquivo de vídeo no instante da publicação. A liberação compara este valor com o sha256 que a
 * auditoria e a Barreira Profissional avaliaram: arquivo trocado depois da aprovação não herda a aprovação.
 * Sem conseguir ler o arquivo, não há evidência: quem chama RETÉM a publicação (nunca presume o hash antigo).
 *
 * Revisão independente (A4): o hash é calculado EM FLUXO (nunca o arquivo inteiro na memória), aborta ao passar do
 * limite mesmo sem `content-length`, e o tempo limite (20 s) fica abaixo do limite de 30 s das funções da Netlify.
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'

export const TAMANHO_MAXIMO_DO_VIDEO = 300 * 1024 * 1024 // 300 MB
export const TEMPO_LIMITE_DO_HASH_MS = 20_000

export async function sha256DoArquivoDeVideo(arquivo: string, deps: { fetch?: typeof fetch; timeoutMs?: number; limiteBytes?: number } = {}): Promise<string> {
  if (!arquivo) throw new Error('sem arquivo de vídeo')
  const limite = deps.limiteBytes ?? TAMANHO_MAXIMO_DO_VIDEO
  const h = createHash('sha256')
  let total = 0
  if (/^https?:\/\//i.test(arquivo)) {
    const r = await (deps.fetch ?? fetch)(arquivo, { signal: AbortSignal.timeout(deps.timeoutMs ?? TEMPO_LIMITE_DO_HASH_MS) })
    if (!r.ok || !r.body) throw new Error(`arquivo de vídeo respondeu HTTP ${r.status}`)
    if (Number(r.headers.get('content-length') ?? 0) > limite) throw new Error('arquivo de vídeo acima do limite')
    const leitor = r.body.getReader()
    for (;;) {
      const { done, value } = await leitor.read()
      if (done) break
      total += value.byteLength
      if (total > limite) { await leitor.cancel(); throw new Error('arquivo de vídeo acima do limite') }
      h.update(value)
    }
  } else {
    if ((await stat(arquivo)).size > limite) throw new Error('arquivo de vídeo acima do limite')
    for await (const parte of createReadStream(arquivo)) { total += (parte as Buffer).length; h.update(parte as Buffer) }
  }
  if (!total) throw new Error('arquivo de vídeo vazio')
  return h.digest('hex')
}
