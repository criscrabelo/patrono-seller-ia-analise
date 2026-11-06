/**
 * P2.75 — Adaptador do Omni com a trava, contra um fetch FALSO (nenhuma rede, nenhuma chave real).
 *   node node_modules/tsx/dist/cli.mjs --test tests/rodada167-p275-adaptador-omni.test.ts
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { criarEnvioOmni, montarCorpo } from '../lib/video-pro/omni-gemini'
import { executarComTrava, lerLivro, recuperarPorId, type PedidoDeVideo } from '../lib/video-pro/trava-local'

const ped: PedidoDeVideo = { tomada: 'ia-abertura', tentativa: 1, resolucao: '720p', segundos: 6, duracaoConfirmada: false, prompt: 'Slow push-in on this exact board.', imagensSha256: ['a'.repeat(64)] }
const img = { base64: 'iVBORw0KGgo=', mime: 'image/png' as const }
const VIDEO = Buffer.alloc(400, 7).toString('base64')
const resp = (status: number, j: unknown) => ({ status, json: async () => j })
function falso(roteiro: Array<ReturnType<typeof resp> | Error>) {
  const chamadas: { url: string; method: string; body?: string; headers: Record<string, string> }[] = []
  const fetch = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    chamadas.push({ url, ...init })
    const r = roteiro.shift(); if (!r) throw new Error('roteiro acabou'); if (r instanceof Error) throw r; return r
  }
  return { fetch, chamadas }
}
const montar = (f: ReturnType<typeof falso>, d: string) => criarEnvioOmni({ chave: 'CHAVE-FALSA', fetch: f.fetch, pastaSaida: d, esperar: async () => {} })

describe('P2.75 — corpo do pedido', () => {
  test('modelo, imagem como 1º quadro, 9:16, resolução, background+store', () => {
    const c = montarCorpo(ped, img.base64, img.mime)
    assert.equal(c.model, 'gemini-omni-1.1-flash')
    assert.equal(c.input[0].type, 'image'); assert.match((c.input[1] as { text: string }).text, /^<FIRST_FRAME>.*exact board.*No dialogue/)
    assert.deepEqual(c.response_format, { type: 'video', aspect_ratio: '9:16', resolution: '720p' })
    assert.equal(c.background, true); assert.equal(c.store, true)
  })
})

describe('P2.75 — adaptador com a trava (fetch falso)', () => {
  const env = {}
  test('criação → id gravado → consultas até completed → vídeo salvo; UMA criação; tokens da resposta', async () => {
    const d = mkdtempSync(join(tmpdir(), 'omni-'))
    const f = falso([resp(200, { id: 'abc', status: 'in_progress' }), resp(200, { status: 'in_progress' }), resp(200, { status: 'completed', outputs: [{ type: 'video', data: VIDEO, mime_type: 'video/mp4' }], usage: { total_output_tokens: 34752 } })])
    const o = montar(f, d)
    const r = await executarComTrava(d, ped, (p, s, id) => o.enviar(p, s, id, img), { env })
    assert.equal(r.estado, 'CONCLUIDO')
    assert.ok(r.estado === 'CONCLUIDO' && existsSync(r.arquivo) && r.usdPelaResposta === 0.6082)
    assert.equal(f.chamadas.filter((c) => c.method === 'POST').length, 1)
    assert.equal(f.chamadas[0].headers['x-goog-api-key'], 'CHAVE-FALSA')
    assert.equal(lerLivro(d).reservas[0].idDoFornecedor, 'abc')
  })
  test('HTTP 400 na criação = recusado antes de processar (FALHOU); 500 = INDETERMINADO', async () => {
    const d1 = mkdtempSync(join(tmpdir(), 'omni-'))
    const o1 = montar(falso([resp(400, { error: { message: 'invalid' } })]), d1)
    assert.equal((await executarComTrava(d1, ped, (p, s, id) => o1.enviar(p, s, id, img), { env })).estado, 'FALHOU')
    const d2 = mkdtempSync(join(tmpdir(), 'omni-'))
    const o2 = montar(falso([resp(500, {})]), d2)
    assert.equal((await executarComTrava(d2, ped, (p, s, id) => o2.enviar(p, s, id, img), { env })).estado, 'INDETERMINADO')
  })
  test('failed/bloqueio ou completed sem vídeo = INDETERMINADO (pode ter cobrado)', async () => {
    for (const fim of [{ status: 'failed' }, { status: 'completed', outputs: [] }, { status: 'incomplete' }]) {
      const d = mkdtempSync(join(tmpdir(), 'omni-'))
      const o = montar(falso([resp(200, { id: 'x' }), resp(200, fim)]), d)
      assert.equal((await executarComTrava(d, ped, (p, s, id) => o.enviar(p, s, id, img), { env })).estado, 'INDETERMINADO', JSON.stringify(fim))
    }
  })
  test('conexão cai na espera: retomada CONSULTA pelo id, sem nova criação', async () => {
    const d = mkdtempSync(join(tmpdir(), 'omni-'))
    const f = falso([resp(200, { id: 'abc' }), new TypeError('fetch failed'), resp(200, { status: 'completed', outputs: [{ type: 'video', data: VIDEO }], usage: { total_output_tokens: 1000 } })])
    const o = montar(f, d)
    const r = await executarComTrava(d, ped, (p, s, id) => o.enviar(p, s, id, img), { env })
    assert.equal(r.estado, 'INDETERMINADO')
    const rec = await recuperarPorId(d, (r as { chave: string }).chave, o.consultar)
    assert.equal(rec.estado, 'CONCLUIDO')
    assert.equal(f.chamadas.filter((c) => c.method === 'POST').length, 1, 'nenhuma segunda geração')
  })
})
