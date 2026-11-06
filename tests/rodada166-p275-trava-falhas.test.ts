/**
 * P2.75 — Trava de gasto sob FALHA: conexão caída, tempo esgotado, resposta desconhecida, processo interrompido,
 * trava apagada à mão, livro apagado/corrompido, pedido duplicado e retomada. Envio SIMULADO (função injetada).
 *   node node_modules/tsx/dist/cli.mjs --test tests/rodada166-p275-trava-falhas.test.ts
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PARAMETROS_PADRAO, comprometidoUsd, conciliar, executarComTrava, integridade, lerLivro, recuperarPorId, reservar, type PedidoDeVideo } from '../lib/video-pro/trava-local'

const ped = (o: Partial<PedidoDeVideo> = {}): PedidoDeVideo => ({ tomada: 'ia-abertura', tentativa: 1, resolucao: '720p', segundos: 6, duracaoConfirmada: false, prompt: 'Slow push-in.', imagensSha256: ['a'.repeat(64)], ...o })
const dir = () => mkdtempSync(join(tmpdir(), 'trava-falhas-'))
const ok = async () => ({ tipo: 'CONCLUIDO', arquivo: 'C:/x/gerado.mp4', tokensDeSaida: 34752 })
const env = {}
const trava = (d: string) => existsSync(join(d, 'pedido-em-andamento.lock'))

describe('P2.75 — desfechos do envio', () => {
  test('sucesso: CONCLUIDO, trava liberada, custo MÁXIMO continua contando até conciliar', async () => {
    const d = dir(); let chamadas = 0
    const r = await executarComTrava(d, ped(), async () => { chamadas++; return ok() }, { env })
    assert.equal(r.estado, 'CONCLUIDO'); assert.equal(chamadas, 1); assert.equal(trava(d), false)
    assert.equal(r.estado === 'CONCLUIDO' && r.usdPelaResposta, 0.6082, '34.752 tokens × US$ 17,50/M')
    assert.equal(comprometidoUsd(lerLivro(d), 'SIMULACAO'), 1.27)
  })
  test('conexão caída: INDETERMINADO, UMA chamada só, trava FICA e o próximo pedido é recusado', async () => {
    const d = dir(); let chamadas = 0
    const r = await executarComTrava(d, ped(), async () => { chamadas++; throw new TypeError('fetch failed') }, { env })
    assert.equal(r.estado, 'INDETERMINADO'); assert.equal(chamadas, 1); assert.equal(trava(d), true)
    const prox = await executarComTrava(d, ped({ tomada: 'ia-heroi' }), async () => { chamadas++; return ok() }, { env })
    assert.equal(prox.estado, 'NAO_ENVIADO'); assert.equal(chamadas, 1, 'nada mais foi enviado')
  })
  test('tempo esgotado: o envio é abortado e fica INDETERMINADO', async () => {
    const d = dir()
    const r = await executarComTrava(d, ped(), (_p, sinal) => new Promise((_, rej) => sinal.addEventListener('abort', () => rej(new DOMException('tempo', 'AbortError')))), { env, tempoLimiteMs: 30 })
    assert.equal(r.estado, 'INDETERMINADO'); assert.match((r as { detalhe: string }).detalhe, /AbortError/)
  })
  test('resposta desconhecida (sem arquivo, formato novo) = INDETERMINADO, nunca "concluído"', async () => {
    for (const resp of [{ status: 'ok' }, { tipo: 'CONCLUIDO' }, null, 'texto']) {
      const d = dir()
      const r = await executarComTrava(d, ped(), async () => resp, { env })
      assert.equal(r.estado, 'INDETERMINADO', JSON.stringify(resp)); assert.equal(trava(d), true)
    }
  })
  test('recusa ANTES de processar (validação): FALHOU, trava liberada, custo máximo ainda reservado', async () => {
    const d = dir()
    const r = await executarComTrava(d, ped(), async () => ({ tipo: 'RECUSADO_SEM_PROCESSAR', detalhe: 'HTTP 400 INVALID_ARGUMENT' }), { env })
    assert.equal(r.estado, 'FALHOU'); assert.equal(trava(d), false)
    assert.equal(comprometidoUsd(lerLivro(d), 'SIMULACAO'), 1.27)
  })
})

describe('P2.75 — interrupção, adulteração e retomada', () => {
  test('processo interrompido durante o envio (livro em ENVIANDO): apagar a trava à mão NÃO libera', async () => {
    const d = dir()
    // simula a morte do processo: o envio nunca termina e o livro fica em ENVIANDO
    void executarComTrava(d, ped(), () => new Promise(() => {}), { env, tempoLimiteMs: 60_000 })
    await new Promise((r) => setTimeout(r, 20))
    assert.equal(lerLivro(d).reservas[0].estado, 'ENVIANDO')
    unlinkSync(join(d, 'pedido-em-andamento.lock'))
    const r = reservar(d, ped({ tomada: 'ia-heroi' }), PARAMETROS_PADRAO, new Date(), env)
    assert.ok(!r.libera && /sem desfecho conhecido/.test(r.motivo), JSON.stringify(r))
    assert.equal(trava(d), false, 'a recusa não deixa trava nova')
  })
  test('retomada: só depois de conciliar com o painel; a mesma tentativa nunca sai de novo, a seguinte sim', async () => {
    const d = dir()
    const r = await executarComTrava(d, ped(), async () => { throw new Error('ECONNRESET') }, { env })
    assert.equal(integridade(d).ok, false)
    conciliar(d, (r as { chave: string }).chave, 0.61, 'painel: 1 geração cobrada')
    assert.equal(trava(d), false); assert.equal(integridade(d).ok, true)
    assert.equal((await executarComTrava(d, ped(), ok, { env })).estado, 'NAO_ENVIADO', 'duplicado')
    assert.equal((await executarComTrava(d, ped({ tentativa: 2 }), ok, { env })).estado, 'CONCLUIDO')
    assert.equal(comprometidoUsd(lerLivro(d), 'SIMULACAO'), +(0.61 + 1.27).toFixed(2))
  })
  test('livro apagado ou voltado para trás: o diário denuncia e nada é enviado', async () => {
    const d = dir()
    await executarComTrava(d, ped(), ok, { env })
    unlinkSync(join(d, 'livro-caixa.json'))
    const r = await executarComTrava(d, ped({ tomada: 'ia-heroi' }), ok, { env })
    assert.ok(r.estado === 'NAO_ENVIADO' && /diário/.test(r.motivo), JSON.stringify(r))
  })
  test('livro corrompido: nada é enviado', async () => {
    const d = dir()
    writeFileSync(join(d, 'livro-caixa.json'), '{"reservas": [')
    const r = await executarComTrava(d, ped(), ok, { env })
    assert.ok(r.estado === 'NAO_ENVIADO' && /ilegível/.test(r.motivo))
  })
  test('pedidos simultâneos: só um sai', async () => {
    const d = dir(); let chamadas = 0
    const lento = async () => { chamadas++; await new Promise((r) => setTimeout(r, 30)); return ok() }
    const rs = await Promise.all([executarComTrava(d, ped(), lento, { env }), executarComTrava(d, ped({ tomada: 'ia-heroi' }), lento, { env })])
    assert.equal(chamadas, 1); assert.deepEqual(rs.map((x) => x.estado).sort(), ['CONCLUIDO', 'NAO_ENVIADO'])
  })
  test('exigirModoReal sem as duas chaves: nada é enviado', async () => {
    const d = dir(); let chamadas = 0
    const r = await executarComTrava(d, ped(), async () => { chamadas++; return ok() }, { env, exigirModoReal: true })
    assert.equal(r.estado, 'NAO_ENVIADO'); assert.equal(chamadas, 0); assert.equal(trava(d), false)
  })
})

describe('P2.75 — retomada pelo id do fornecedor (modo background)', () => {
  test('processo cai DEPOIS de receber o id: o resultado é recuperado por consulta, sem nova geração', async () => {
    const d = dir(); let geracoes = 0, consultas = 0
    const r = await executarComTrava(d, ped(), async (_p, _s, aoReceberId) => { geracoes++; aoReceberId('interactions/abc123'); throw new Error('ECONNRESET durante o polling') }, { env })
    assert.equal(r.estado, 'INDETERMINADO')
    assert.equal(lerLivro(d).reservas[0].idDoFornecedor, 'interactions/abc123')
    const rec = await recuperarPorId(d, (r as { chave: string }).chave, async (id) => { consultas++; assert.equal(id, 'interactions/abc123'); return ok() })
    assert.equal(rec.estado, 'CONCLUIDO'); assert.equal(geracoes, 1); assert.equal(consultas, 1)
    assert.equal(integridade(d).ok, true, 'recuperado: novos pedidos voltam a ser possíveis')
  })
  test('sem id gravado, não há recuperação automática: só conciliação manual', async () => {
    const d = dir()
    const r = await executarComTrava(d, ped(), async () => { throw new Error('caiu antes do id') }, { env })
    const rec = await recuperarPorId(d, (r as { chave: string }).chave, ok)
    assert.ok(rec.estado === 'NAO_ENVIADO' && /painel/.test(rec.motivo))
  })
})
