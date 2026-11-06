/**
 * P2.77 — Adaptador da Runway com a trava, contra um fetch FALSO (nenhuma rede, nenhum crédito).
 *   node node_modules/tsx/dist/cli.mjs --test tests/rodada168-p277-adaptador-runway.test.ts
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { criarEnvioRunway, montarCorpoRunway } from '../lib/video-pro/runway'
import { PARAMETROS_PADRAO, comprometidoUsd, creditosMaximosRunway, custoMaximoUsd, executarComTrava, lerLivro, recuperarPorId, type PedidoDeVideo } from '../lib/video-pro/trava-local'

const ped: PedidoDeVideo = { provedor: 'runway', tomada: 'ia-abertura', tentativa: 1, resolucao: '720p', segundos: 6, duracaoConfirmada: true, prompt: 'Slow push-in on this exact board.', imagensSha256: ['a'.repeat(64)] }
const img = { base64: 'iVBORw0KGgo=', mime: 'image/png' as const }
const par = { ...PARAMETROS_PADRAO, prePagoUsd: 10, reservaParaRevisorUsd: 0, tetoPorPedidoUsd: 0.61 }
const resp = (status: number, j: unknown, bin?: Buffer) => ({ status, json: async () => j, arrayBuffer: async () => (bin ?? Buffer.alloc(0)).buffer.slice(0) as ArrayBuffer })
function falso(roteiro: Array<ReturnType<typeof resp> | Error>) {
  const chamadas: { url: string; method: string; body?: string; headers: Record<string, string> }[] = []
  return { chamadas, fetch: async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => { chamadas.push({ url, ...init }); const r = roteiro.shift(); if (!r) throw new Error('roteiro acabou'); if (r instanceof Error) throw r; return r } }
}
const env = {}
const montar = (f: ReturnType<typeof falso>, d: string, teto = 61) => criarEnvioRunway({ chave: 'key_FALSA', fetch: f.fetch, pastaSaida: d, tetoCreditos: teto, esperar: async () => {} })
const ID = '0f0e0d0c-0b0a-4908-8706-050403020100'

describe('P2.77 — custo em créditos e corpo', () => {
  test('720p, 6 s, 1 quadro inicial = 61 créditos = US$ 0,61; duração fora de 3–10 é recusada', () => {
    assert.equal(creditosMaximosRunway(ped), 61)
    assert.equal(custoMaximoUsd(ped).usd, 0.61)
    assert.equal(creditosMaximosRunway({ ...ped, resolucao: '360p', segundos: 4 }), 15) // 13,6 + 1 → 15
    assert.throws(() => creditosMaximosRunway({ ...ped, segundos: 11 }))
    assert.throws(() => creditosMaximosRunway({ ...ped, segundos: 5.5 }))
  })
  test('corpo: modelo, data URI, ratio 720:1280, duração inteira', () => {
    const c = montarCorpoRunway(ped, 'data:image/png;base64,AAAA')
    assert.deepEqual({ m: c.model, r: c.ratio, d: c.duration }, { m: 'gemini_omni_flash_1.1', r: '720:1280', d: 6 })
    assert.match(c.promptText, /exact board.*No dialogue/)
  })
  test('pedido Runway e pedido Google com o mesmo conteúdo têm chaves diferentes (livros não se confundem)', async () => {
    const { chaveDoPedido } = await import('../lib/video-pro/trava-local')
    assert.notEqual(chaveDoPedido(ped), chaveDoPedido({ ...ped, provedor: 'google' }))
  })
})

describe('P2.77 — adaptador com a trava (fetch falso)', () => {
  test('sucesso: UMA criação, id gravado, vídeo baixado, custo informado pela tarefa', async () => {
    const d = mkdtempSync(join(tmpdir(), 'rw-'))
    const f = falso([resp(200, { id: ID, estimatedCost: { credits: 61 } }), resp(200, { status: 'RUNNING' }), resp(200, { status: 'SUCCEEDED', output: ['https://cdn.example/v.mp4'], cost: { credits: 61 } }), resp(200, {}, Buffer.alloc(500, 3))])
    const o = montar(f, d)
    const r = await executarComTrava(d, ped, (p, s, id) => o.enviar(p, s, id, img), { env, par })
    assert.equal(r.estado, 'CONCLUIDO')
    assert.ok(r.estado === 'CONCLUIDO' && existsSync(r.arquivo) && readFileSync(r.arquivo).length === 500 && r.usdPelaResposta === 0.61)
    assert.equal(f.chamadas.filter((c) => c.method === 'POST').length, 1)
    assert.equal(f.chamadas[0].headers['X-Runway-Version'], '2024-11-06')
    assert.equal(lerLivro(d).reservas[0].idDoFornecedor, ID)
  })
  test('estimativa da Runway acima do teto: tarefa CANCELADA na hora e desfecho INDETERMINADO (conciliar)', async () => {
    const d = mkdtempSync(join(tmpdir(), 'rw-'))
    const f = falso([resp(200, { id: ID, estimatedCost: { credits: 101 } }), resp(200, {})])
    const r = await executarComTrava(d, ped, (p, s, id) => montar(f, d).enviar(p, s, id, img), { env, par })
    assert.equal(r.estado, 'INDETERMINADO')
    assert.ok(f.chamadas.some((c) => c.method === 'DELETE' && c.url.endsWith(ID)))
  })
  test('FAILED com custo informado (reembolsada = 0): FALHOU, sem reenvio; o máximo segue reservado até conciliar', async () => {
    const d = mkdtempSync(join(tmpdir(), 'rw-'))
    const f = falso([resp(200, { id: ID, estimatedCost: { credits: 61 } }), resp(200, { status: 'FAILED', failureCode: 'SAFETY.INPUT', failure: 'blocked', cost: { credits: 0 } })])
    const r = await executarComTrava(d, ped, (p, s, id) => montar(f, d).enviar(p, s, id, img), { env, par })
    assert.equal(r.estado, 'FALHOU')
    assert.equal(lerLivro(d).reservas[0].usdPelaResposta, 0)
    assert.equal(comprometidoUsd(lerLivro(d), 'SIMULACAO'), 0.61)
  })
  test('400 na criação = recusado antes de processar; 500 = INDETERMINADO', async () => {
    const d1 = mkdtempSync(join(tmpdir(), 'rw-'))
    assert.equal((await executarComTrava(d1, ped, (p, s, id) => montar(falso([resp(400, { error: 'bad' })]), d1).enviar(p, s, id, img), { env, par })).estado, 'FALHOU')
    const d2 = mkdtempSync(join(tmpdir(), 'rw-'))
    assert.equal((await executarComTrava(d2, ped, (p, s, id) => montar(falso([resp(502, {})]), d2).enviar(p, s, id, img), { env, par })).estado, 'INDETERMINADO')
  })
  test('conexão cai na espera: retomada CONSULTA a tarefa pelo id, sem nova criação', async () => {
    const d = mkdtempSync(join(tmpdir(), 'rw-'))
    const f = falso([resp(200, { id: ID, estimatedCost: { credits: 61 } }), new TypeError('fetch failed'), resp(200, { status: 'SUCCEEDED', output: ['https://cdn.example/v.mp4'], cost: { credits: 61 } }), resp(200, {}, Buffer.alloc(10, 1))])
    const o = montar(f, d)
    const r = await executarComTrava(d, ped, (p, s, id) => o.enviar(p, s, id, img), { env, par })
    assert.equal(r.estado, 'INDETERMINADO')
    assert.equal((await recuperarPorId(d, (r as { chave: string }).chave, o.consultar)).estado, 'CONCLUIDO')
    assert.equal(f.chamadas.filter((c) => c.method === 'POST').length, 1)
  })
  test('teto por pedido de US$ 0,61: 7 s (71 créditos) nem chega a ser enviado', async () => {
    const d = mkdtempSync(join(tmpdir(), 'rw-'))
    let chamadas = 0
    const r = await executarComTrava(d, { ...ped, segundos: 7 }, async () => { chamadas++; return {} }, { env, par })
    assert.equal(r.estado, 'NAO_ENVIADO'); assert.equal(chamadas, 0)
  })
})
