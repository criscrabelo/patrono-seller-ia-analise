/**
 * P2.69+ — portas REAIS do arquivo aprovado imutável (Supabase Storage, bucket privado). Separadas de
 * lib/arquivo-aprovado.ts para que a lógica seja testada sem storage.
 */
import { BUCKET_MIDIA_PRIVADA, ehRefPrivada, urlParaUsoInterno } from './midia-privada'
import { criarUrlAssinada, uploadBufferPrivadoSemSobrescrever } from './supabase'
import { BUCKET_DOS_APROVADOS, LIMITE_DO_ARQUIVO_APROVADO, type PortasDoArquivoAprovado } from './arquivo-aprovado'

if (BUCKET_DOS_APROVADOS !== BUCKET_MIDIA_PRIVADA) throw new Error('bucket dos aprovados divergente do bucket privado')

const TEMPO_LIMITE_MS = 20_000
/** validade da URL entregue à plataforma (o Instagram busca o vídeo pela URL; o TikTok baixa e envia em pedaços) */
export const VALIDADE_DA_URL_APROVADA_S = 3600

async function lerUrl(url: string): Promise<Buffer> {
  const r = await fetch(url, { signal: AbortSignal.timeout(TEMPO_LIMITE_MS) })
  if (!r.ok || !r.body) throw new Error(`arquivo respondeu HTTP ${r.status}`)
  if (Number(r.headers.get('content-length') ?? 0) > LIMITE_DO_ARQUIVO_APROVADO) throw new Error('arquivo acima do limite')
  const partes: Uint8Array[] = []; let total = 0
  const leitor = r.body.getReader()
  for (;;) {
    const { done, value } = await leitor.read()
    if (done) break
    total += value.byteLength
    if (total > LIMITE_DO_ARQUIVO_APROVADO) { await leitor.cancel(); throw new Error('arquivo acima do limite') }
    partes.push(value)
  }
  return Buffer.concat(partes)
}

export const PORTAS_REAIS_DO_ARQUIVO_APROVADO: PortasDoArquivoAprovado = {
  // origem privada de Production é a URL `.../object/authenticated/midias-privadas/...`: assinada antes de ler
  baixar: async (origem) => lerUrl(/^https?:\/\//i.test(origem) ? (ehRefPrivada(origem) ? await urlParaUsoInterno(origem, process.env, 120) : origem) : await criarUrlAssinada(BUCKET_MIDIA_PRIVADA, origem, 120)),
  subirSemSobrescrever: (caminho, bytes) => uploadBufferPrivadoSemSobrescrever(bytes, BUCKET_MIDIA_PRIVADA, caminho, 'video/mp4'),
  ler: async (caminho) => lerUrl(await criarUrlAssinada(BUCKET_MIDIA_PRIVADA, caminho, 120)),
  urlDeLeitura: (caminho) => criarUrlAssinada(BUCKET_MIDIA_PRIVADA, caminho, VALIDADE_DA_URL_APROVADA_S),
}
