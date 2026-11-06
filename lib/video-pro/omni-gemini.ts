/**
 * P2.75 — Adaptador do Gemini Omni Flash (Interactions API) para `executarComTrava`. NÃO é chamado por nada sem as
 * duas chaves da trava; o `fetch` é injetado (testes usam um falso; nenhuma rede nos testes).
 *
 * Formato conforme ai.google.dev/gemini-api/docs/omni e /api/interactions-api (lidos em 28/10/2026):
 *   POST v1beta/interactions  { model, input:[imagem, texto], response_format:{type:video, aspect_ratio, resolution},
 *                               generation_config:{video_config:{task:image_to_video}}, background:true, store:true }
 *   → { id, status }  ·  GET v1beta/interactions/{id} até completed|failed|cancelled|incomplete
 * `background` exige `store`: o id volta logo e é gravado no livro ANTES da espera (retomada por consulta, sem reenvio).
 * Não existe chave de idempotência na API: por isso NUNCA há reenvio aqui. 400/429 na criação = recusado antes de
 * processar; qualquer outra coisa sem vídeo (failed, bloqueio, formato novo) volta como desconhecido → INDETERMINADO.
 * O áudio gerado é descartado depois (a API não documenta como desligá-lo).
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PRECO_OMNI, type PedidoDeVideo } from './trava-local'

const BASE = 'https://generativelanguage.googleapis.com/v1beta'

export function montarCorpo(p: PedidoDeVideo, imagemBase64: string, mime: 'image/png' | 'image/jpeg') {
  return {
    model: PRECO_OMNI.modelo,
    input: [
      { type: 'image', data: imagemBase64, mime_type: mime },
      { type: 'text', text: `<FIRST_FRAME> Use the image as the exact first frame. ${p.prompt} No dialogue, no voice-over, no added text, no people, no hands.` },
    ],
    response_format: { type: 'video', aspect_ratio: '9:16', resolution: p.resolucao },
    generation_config: { video_config: { task: 'image_to_video' } },
    background: true,
    store: true,
  }
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>

/** Procura o vídeo em base64 em qualquer saída da interação (o formato exato da lista de saídas não é garantido). */
function videoDaResposta(j: unknown): string | null {
  const pilha = [j]
  while (pilha.length) {
    const x = pilha.pop()
    if (!x || typeof x !== 'object') continue
    const o = x as Record<string, unknown>
    if ((o.type === 'video' || typeof o.mime_type === 'string' && String(o.mime_type).startsWith('video/')) && typeof o.data === 'string' && o.data.length > 100) return o.data
    for (const v of Object.values(o)) if (v && typeof v === 'object') pilha.push(v)
  }
  return null
}

export function criarEnvioOmni(o: { chave: string; fetch: Fetch; pastaSaida: string; intervaloMs?: number; maxConsultas?: number; esperar?: (ms: number) => Promise<void> }) {
  const h = { 'Content-Type': 'application/json', 'x-goog-api-key': o.chave }
  const esperar = o.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  async function aguardar(id: string, sinal?: AbortSignal): Promise<unknown> {
    for (let i = 0; i < (o.maxConsultas ?? 120); i++) {
      if (sinal?.aborted) throw new DOMException('tempo esgotado', 'AbortError')
      const r = await o.fetch(`${BASE}/interactions/${encodeURIComponent(id.replace(/^interactions\//, ''))}`, { method: 'GET', headers: h, signal: sinal })
      if (r.status !== 200) throw new Error(`consulta HTTP ${r.status}`) // desconhecido para a trava: INDETERMINADO
      const j = (await r.json()) as { status?: string; usage?: { total_output_tokens?: number } }
      if (j.status === 'completed') {
        const b64 = videoDaResposta(j)
        if (!b64) return { desconhecido: 'completed sem vídeo', status: j.status }
        const arquivo = join(o.pastaSaida, `${id.replace(/[^\w-]/g, '_')}.mp4`)
        writeFileSync(arquivo, Buffer.from(b64, 'base64'))
        return { tipo: 'CONCLUIDO', arquivo, tokensDeSaida: j.usage?.total_output_tokens }
      }
      if (j.status && j.status !== 'in_progress') return { desconhecido: `interação ${j.status}`, status: j.status } // failed/cancelled/incomplete/bloqueio: pode ter cobrado
      await esperar(o.intervaloMs ?? 10_000)
    }
    throw new Error('consultas esgotadas sem desfecho')
  }

  return {
    async enviar(p: PedidoDeVideo, sinal: AbortSignal, aoReceberId: (id: string) => void, imagem: { base64: string; mime: 'image/png' | 'image/jpeg' }) {
      const r = await o.fetch(`${BASE}/interactions`, { method: 'POST', headers: h, body: JSON.stringify(montarCorpo(p, imagem.base64, imagem.mime)), signal: sinal })
      if (r.status === 400 || r.status === 429) {
        const j = (await r.json().catch(() => ({}))) as { error?: { message?: string } }
        return { tipo: 'RECUSADO_SEM_PROCESSAR', detalhe: `HTTP ${r.status}: ${j.error?.message ?? ''}`.slice(0, 300) }
      }
      if (r.status !== 200) throw new Error(`criação HTTP ${r.status}`) // 5xx etc.: pode ter processado → INDETERMINADO
      const j = (await r.json()) as { id?: string }
      if (!j.id) return { desconhecido: 'criação sem id' }
      aoReceberId(j.id)
      return aguardar(j.id, sinal)
    },
    consultar: (id: string) => aguardar(id),
  }
}
