/**
 * P2.77 — Adaptador da Runway API (gemini_omni_flash_1.1) para `executarComTrava`. `fetch` injetado; nunca reenvia.
 *
 * Contrato (openapi.json da Runway, lido em 29/10/2026; X-Runway-Version 2024-11-06):
 *   POST /v1/image_to_video { model, promptImage (data URI ≤ 5 MB), promptText, ratio "720:1280", duration 3–10 }
 *     → { id, estimatedCost.credits }  (custo MÁXIMO que a tarefa pode cobrar)
 *   GET  /v1/tasks/{id} → PENDING | THROTTLED | RUNNING | SUCCEEDED{output[], cost} | FAILED{failure, cost} | CANCELLED{cost}
 *   DELETE /v1/tasks/{id} cancela;  GET /v1/organization → creditBalance (gratuito)
 * Trava extra: se `estimatedCost` vier ACIMA do teto autorizado, a tarefa é cancelada na hora e o desfecho fica
 * INDETERMINADO até a conciliação pelo saldo (nunca se presume que o cancelamento devolveu tudo).
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PRECO_RUNWAY, type PedidoDeVideo } from './trava-local'

export const BASE_RUNWAY = 'https://api.dev.runwayml.com/v1'
const VERSAO = '2024-11-06'
const RATIO: Record<string, string> = { '360p': '360:640', '720p': '720:1280', '1080p': '1080:1920' }

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown>; arrayBuffer?(): Promise<ArrayBuffer> }>

export function montarCorpoRunway(p: PedidoDeVideo, dataUri: string) {
  return {
    model: PRECO_RUNWAY.modelo,
    promptImage: dataUri,
    promptText: `${p.prompt} No dialogue, no voice-over, no added text, no people, no hands.`,
    ratio: RATIO[p.resolucao],
    duration: p.segundos,
  }
}

const creditos = (x: unknown): number | null => {
  const c = (x as { credits?: unknown } | null)?.credits
  return typeof c === 'number' && Number.isFinite(c) && c >= 0 ? c : null
}

export function criarEnvioRunway(o: { chave: string; fetch: Fetch; pastaSaida: string; tetoCreditos: number; intervaloMs?: number; maxConsultas?: number; esperar?: (ms: number) => Promise<void> }) {
  const h = { Authorization: `Bearer ${o.chave}`, 'X-Runway-Version': VERSAO, 'Content-Type': 'application/json' }
  const esperar = o.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  async function aguardar(id: string, sinal?: AbortSignal): Promise<unknown> {
    for (let i = 0; i < (o.maxConsultas ?? 120); i++) {
      if (sinal?.aborted) throw new DOMException('tempo esgotado', 'AbortError')
      const r = await o.fetch(`${BASE_RUNWAY}/tasks/${encodeURIComponent(id)}`, { method: 'GET', headers: h, signal: sinal })
      if (r.status !== 200) throw new Error(`consulta HTTP ${r.status}`)
      const j = (await r.json()) as { status?: string; output?: unknown; cost?: unknown; failure?: string; failureCode?: string }
      if (j.status === 'SUCCEEDED') {
        const url = Array.isArray(j.output) && typeof j.output[0] === 'string' ? j.output[0] : null
        if (!url) return { desconhecido: 'SUCCEEDED sem saída' }
        const v = await o.fetch(url, { method: 'GET', headers: {}, signal: sinal })
        if (v.status !== 200 || !v.arrayBuffer) throw new Error(`download HTTP ${v.status}`)
        const arquivo = join(o.pastaSaida, `runway-${id}.mp4`)
        writeFileSync(arquivo, Buffer.from(await v.arrayBuffer()))
        const c = creditos(j.cost)
        return { tipo: 'CONCLUIDO', arquivo, ...(c !== null ? { usdInformado: +(c * PRECO_RUNWAY.usdPorCredito).toFixed(4) } : {}) }
      }
      if (j.status === 'FAILED' || j.status === 'CANCELLED') {
        const c = creditos(j.cost)
        const detalhe = `${j.status}${j.failureCode ? ` ${j.failureCode}` : ''}${j.failure ? `: ${j.failure}` : ''}`.slice(0, 300)
        return c !== null ? { tipo: 'FALHOU_NO_FORNECEDOR', detalhe, usdInformado: +(c * PRECO_RUNWAY.usdPorCredito).toFixed(4) } : { desconhecido: detalhe }
      }
      if (!['PENDING', 'THROTTLED', 'RUNNING'].includes(j.status ?? '')) return { desconhecido: `status ${j.status}` }
      await esperar(o.intervaloMs ?? 5_000)
    }
    throw new Error('consultas esgotadas sem desfecho')
  }

  return {
    async enviar(p: PedidoDeVideo, sinal: AbortSignal, aoReceberId: (id: string) => void, imagem: { base64: string; mime: 'image/png' | 'image/jpeg' }) {
      const r = await o.fetch(`${BASE_RUNWAY}/image_to_video`, { method: 'POST', headers: h, body: JSON.stringify(montarCorpoRunway(p, `data:${imagem.mime};base64,${imagem.base64}`)), signal: sinal })
      if (r.status === 400 || r.status === 429) {
        const j = (await r.json().catch(() => ({}))) as { error?: string; issues?: unknown }
        return { tipo: 'RECUSADO_SEM_PROCESSAR', detalhe: `HTTP ${r.status}: ${j.error ?? ''} ${j.issues ? JSON.stringify(j.issues).slice(0, 200) : ''}`.slice(0, 300) }
      }
      if (r.status !== 200) throw new Error(`criação HTTP ${r.status}`) // pode ter criado a tarefa → INDETERMINADO
      const j = (await r.json()) as { id?: string; estimatedCost?: unknown }
      if (!j.id) return { desconhecido: 'criação sem id' }
      aoReceberId(j.id)
      const est = creditos(j.estimatedCost)
      if (est === null || est > o.tetoCreditos) {
        await o.fetch(`${BASE_RUNWAY}/tasks/${encodeURIComponent(j.id)}`, { method: 'DELETE', headers: h, signal: sinal }).catch(() => undefined)
        return { desconhecido: `custo estimado pela Runway (${est ?? 'ausente'} créditos) acima do teto de ${o.tetoCreditos}: tarefa cancelada; conciliar pelo saldo` }
      }
      return aguardar(j.id, sinal)
    },
    consultar: (id: string) => aguardar(id),
    /** Saldo da organização (consulta gratuita). */
    async saldo(): Promise<number> {
      const r = await o.fetch(`${BASE_RUNWAY}/organization`, { method: 'GET', headers: h })
      const j = (await r.json()) as { creditBalance?: unknown }
      if (r.status !== 200 || typeof j.creditBalance !== 'number') throw new Error(`saldo indisponível (HTTP ${r.status})`)
      return j.creditBalance
    },
  }
}
