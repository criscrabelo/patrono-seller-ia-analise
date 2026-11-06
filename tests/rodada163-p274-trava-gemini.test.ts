/**
 * P2.74 — Trava local de gasto da geração de vídeo (Gemini Omni Flash). Sem banco, sem rede, sem chamada paga.
 *   node node_modules/tsx/dist/cli.mjs --test tests/rodada163-p274-trava-gemini.test.ts
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PARAMETROS_PADRAO, conciliar, custoMaximoUsd, decidir, encerrarPedido, lerLivro, modoPermitido, reservar, segundosCobrados, type PedidoDeVideo } from '../lib/video-pro/trava-local'

const ped = (o: Partial<PedidoDeVideo> = {}): PedidoDeVideo => ({ tomada: 'ia-abertura', tentativa: 1, resolucao: '720p', segundos: 6, duracaoConfirmada: true, prompt: 'Slow push-in on this exact board.', imagensSha256: ['a'.repeat(64)], ...o })
const dir = () => mkdtempSync(join(tmpdir(), 'trava-gemini-'))

describe('P2.74 — custo máximo antes do pedido', () => {
  test('duração não confirmada é cobrada como a MAIOR permitida (10 s)', () => {
    assert.equal(segundosCobrados({ segundos: 4, duracaoConfirmada: false }), 10)
    assert.equal(segundosCobrados({ segundos: 5, duracaoConfirmada: true }), 6, 'arredonda para a duração aceita acima')
    assert.throws(() => segundosCobrados({ segundos: 12, duracaoConfirmada: true }))
    assert.throws(() => segundosCobrados({ segundos: 0, duracaoConfirmada: true }))
  })
  test('saída por resolução + entrada + margem, arredondado para cima', () => {
    // 720p, 6 s: 5792 × 6 × 17,5/1e6 = 0,6082; entrada ≈ 0,0023; × 1,25 = 0,763 → 0,77
    assert.equal(custoMaximoUsd(ped()).usd, 0.77)
    assert.equal(custoMaximoUsd(ped({ duracaoConfirmada: false })).usd, 1.27)
    assert.ok(custoMaximoUsd(ped({ resolucao: '1080p' })).usd > custoMaximoUsd(ped()).usd)
    assert.ok(custoMaximoUsd(ped({ resolucao: '360p', segundos: 4 })).usd < 0.2)
    assert.ok(custoMaximoUsd(ped({ imagensSha256: ['a', 'b', 'c'] })).usd >= custoMaximoUsd(ped()).usd, 'imagens a mais nunca baixam o custo')
  })
})

describe('P2.74 — limites, tentativas e reenvio', () => {
  const vazio = { reservas: [] }
  test('teto por pedido e limite interno (80% do pré-pago menos a reserva do revisor)', () => {
    const d = decidir(vazio, ped({ resolucao: '1080p', segundos: 10 }), { ...PARAMETROS_PADRAO, tetoPorPedidoUsd: 1 }, 'SIMULACAO')
    assert.equal(d.libera, false)
    const ok = decidir(vazio, ped(), PARAMETROS_PADRAO, 'SIMULACAO')
    assert.ok(ok.libera && ok.limiteInternoUsd === 7.5, JSON.stringify(ok))
    const quase = { reservas: [{ chave: 'x', tomada: 'outra', tentativa: 1, resolucao: '720p' as const, usdMax: 7.0, em: '', estado: 'RESERVADO' as const, modo: 'SIMULACAO' as const }] }
    const r = decidir(quase, ped(), PARAMETROS_PADRAO, 'SIMULACAO')
    assert.ok(!r.libera && /Limite interno/.test(r.motivo))
  })
  test('máximo de tentativas por tomada; tentativa pulada recusada', () => {
    assert.equal(decidir(vazio, ped({ tentativa: 3 }), PARAMETROS_PADRAO, 'SIMULACAO').libera, false)
    assert.equal(decidir(vazio, ped({ tentativa: 2 }), PARAMETROS_PADRAO, 'SIMULACAO').libera, false)
    assert.equal(decidir(vazio, ped({ tentativa: 0 }), PARAMETROS_PADRAO, 'SIMULACAO').libera, false)
  })
  test('reenvio do MESMO pedido é recusado para sempre (não há reenvio automático)', () => {
    const d = dir()
    const a = reservar(d, ped()); assert.ok(a.libera); encerrarPedido(d)
    const b = reservar(d, ped()); assert.ok(!b.libera && /reenvio/.test(b.motivo))
    const c = reservar(d, ped({ prompt: 'outro texto' })); assert.ok(!c.libera && /já usada/.test(c.motivo), 'mesma tentativa com outro conteúdo também não')
    const e = reservar(d, ped({ tentativa: 2 })); assert.ok(e.libera, 'a próxima tentativa, pedida explicitamente, passa'); encerrarPedido(d)
  })
})

describe('P2.74 — um pedido por vez, reserva e conciliação', () => {
  test('com pedido em andamento, o segundo é recusado; a trava só sai com encerrarPedido', () => {
    const d = dir()
    assert.ok(reservar(d, ped()).libera)
    const b = reservar(d, ped({ tomada: 'ia-heroi' }))
    assert.ok(!b.libera && /em andamento/.test(b.motivo))
    encerrarPedido(d)
    assert.ok(reservar(d, ped({ tomada: 'ia-heroi' })).libera)
    encerrarPedido(d)
  })
  test('recusa não deixa trava nem reserva', () => {
    const d = dir()
    const r = reservar(d, ped({ tentativa: 5 }))
    assert.equal(r.libera, false)
    assert.equal(existsSync(join(d, 'pedido-em-andamento.lock')), false)
    assert.equal(lerLivro(d).reservas.length, 0)
  })
  test('reserva conta o custo MÁXIMO até a conciliação; conciliado conta o real', () => {
    const d = dir()
    const a = reservar(d, ped()); assert.ok(a.libera); encerrarPedido(d)
    assert.equal(lerLivro(d).reservas[0].usdMax, 0.77)
    conciliar(d, (a as { chave: string }).chave, 0.61)
    const l = lerLivro(d)
    assert.equal(l.reservas[0].estado, 'CONCILIADO')
    assert.throws(() => conciliar(d, (a as { chave: string }).chave, -1))
    const prox = decidir(l, ped({ tomada: 'ia-heroi' }), PARAMETROS_PADRAO, 'SIMULACAO')
    assert.ok(prox.libera && prox.comprometidoDepoisUsd === 1.38, JSON.stringify(prox))
  })
})

describe('P2.74 — modo real exige as duas chaves', () => {
  test('sem variável, sem autorização ou com teto diferente → SIMULAÇÃO', () => {
    const d = dir()
    assert.equal(modoPermitido(d, PARAMETROS_PADRAO, {}).modo, 'SIMULACAO')
    assert.equal(modoPermitido(d, PARAMETROS_PADRAO, { VIDEO_IA_PAGO_AUTORIZADO: 'sim' }).modo, 'SIMULACAO')
    writeFileSync(join(d, 'autorizacao.json'), JSON.stringify({ autorizadoPor: 'titular', em: '2026-10-29', texto: 'Autorizo', prePagoUsd: 20 }))
    assert.equal(modoPermitido(d, PARAMETROS_PADRAO, { VIDEO_IA_PAGO_AUTORIZADO: 'sim' }).modo, 'SIMULACAO', 'teto diferente')
    writeFileSync(join(d, 'autorizacao.json'), JSON.stringify({ autorizadoPor: 'titular', em: '2026-10-29', texto: 'Autorizo', prePagoUsd: 15 }))
    assert.equal(modoPermitido(d, PARAMETROS_PADRAO, { VIDEO_IA_PAGO_AUTORIZADO: 'sim' }).modo, 'REAL')
  })
  test('reservas de simulação não consomem o limite do modo real', () => {
    const d = dir()
    assert.equal(reservar(d, ped(), PARAMETROS_PADRAO, new Date(), {}).modo, 'SIMULACAO'); encerrarPedido(d)
    const l = lerLivro(d)
    const real = decidir(l, ped({ tomada: 'ia-heroi' }), PARAMETROS_PADRAO, 'REAL')
    assert.ok(real.libera && real.comprometidoDepoisUsd === 0.77)
  })
})
