/**
 * P2.74 — Exame de DEFEITOS do revisor independente e estágios (funcionamento × operação). Puro, sem rede.
 *   node node_modules/tsx/dist/cli.mjs --test tests/rodada164-p274-exame-de-defeitos.test.ts
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { DEFEITOS_DE_TESTE, RUBRICA, avaliarDeteccaoDeDefeitos, confiabilidadeEmOperacao, estagioDoRevisor, type DefeitoDeTeste, type ResultadoDeCalibracao, type CalibracaoRegistrada } from '../lib/revisao-independente'
import type { ItemDeLaudo } from '../lib/barreira-profissional'

const todos = Object.keys(RUBRICA) as ItemDeLaudo[]
const notas = (n: number, exc: Partial<Record<ItemDeLaudo, number>> = {}) => Object.fromEntries(todos.map((i) => [i, exc[i] ?? n])) as Partial<Record<ItemDeLaudo, number>>
const res = (video: string, n: Partial<Record<ItemDeLaudo, number>>): ResultadoDeCalibracao => ({ video, esperado: 'RUIM', execucoes: [n, n] })
const base = res('base', notas(4.5))
const percebe = (d: DefeitoDeTeste) => ({ base, defeito: d, variante: res(`v-${d}`, notas(4.5, Object.fromEntries(DEFEITOS_DE_TESTE[d].itens.map((i) => [i, 2])))) })
const ignora = (d: DefeitoDeTeste) => ({ base, defeito: d, variante: res(`v-${d}`, notas(4.5)) })
const nomes = Object.keys(DEFEITOS_DE_TESTE) as DefeitoDeTeste[]

describe('P2.74 — exame de defeitos', () => {
  test('percebe os 8 defeitos → aprovado', () => {
    const e = avaliarDeteccaoDeDefeitos(nomes.map(percebe))
    assert.ok(e.aprovado, e.motivo)
    assert.equal(e.detectados.length, 8)
  })
  test('deixa passar um defeito CRÍTICO → reprovado, mesmo com taxa alta', () => {
    const e = avaliarDeteccaoDeDefeitos(nomes.map((d) => (d === 'semCta' ? ignora(d) : percebe(d))))
    assert.ok(!e.aprovado && /CRÍTICO.*semCta/.test(e.motivo))
  })
  test('perde 2 defeitos não críticos de 8 (75%) → reprovado pela taxa', () => {
    const e = avaliarDeteccaoDeDefeitos(nomes.map((d) => (d === 'dessincronia' || d === 'vozRobotizada' ? ignora(d) : percebe(d))))
    assert.ok(!e.aprovado && /6 de 8/.test(e.motivo))
  })
  test('queda pequena (4,5 → 3,5) não conta: precisa ficar ≤ 2', () => {
    const v = { base, defeito: 'semCta' as const, variante: res('v', notas(4.5, { forcaDoCta: 3.5 })) }
    assert.deepEqual(avaliarDeteccaoDeDefeitos([v]).perdidos, ['semCta'])
  })
  test('conjunto pequeno, variante igual à base e resposta incompleta não valem', () => {
    assert.ok(/mín\. 6/.test(avaliarDeteccaoDeDefeitos(nomes.slice(0, 3).map(percebe)).motivo))
    assert.ok(avaliarDeteccaoDeDefeitos([{ base, defeito: 'semCta', variante: base }]).perdidos.includes('semCta'))
    const semNota = { base, defeito: 'dessincronia' as const, variante: res('v', notas(1, { sincronizacao: undefined as unknown as number })) }
    delete (semNota.variante.execucoes[0] as Record<string, number>).sincronizacao
    delete (semNota.variante.execucoes[1] as Record<string, number>).sincronizacao
    assert.deepEqual(avaliarDeteccaoDeDefeitos([semNota]).perdidos, ['dessincronia'])
  })
})

describe('P2.74 — estágios: funcionar não é aprovar', () => {
  const cal = (aprovada: boolean): CalibracaoRegistrada => ({ revisor: 'r', aprovada, em: '', conjunto: [], motivo: '' })
  const exame = (aprovado: boolean) => ({ aprovado, detectados: [], perdidos: [], motivo: '' })
  test('só APTO_PARA_OPERACAO vale na barreira', () => {
    assert.deepEqual(estagioDoRevisor({ laudoDeFuncionamentoOk: false, calibracao: null, defeitos: null }), { estagio: 'NAO_TESTADO', laudoValeNaBarreira: false })
    assert.deepEqual(estagioDoRevisor({ laudoDeFuncionamentoOk: true, calibracao: null, defeitos: null }), { estagio: 'FUNCIONANDO', laudoValeNaBarreira: false })
    assert.deepEqual(estagioDoRevisor({ laudoDeFuncionamentoOk: true, calibracao: cal(true), defeitos: null }), { estagio: 'CALIBRADO_SEM_EXAME_DE_DEFEITOS', laudoValeNaBarreira: false })
    assert.deepEqual(estagioDoRevisor({ laudoDeFuncionamentoOk: true, calibracao: cal(true), defeitos: exame(false) }), { estagio: 'REPROVADO', laudoValeNaBarreira: false })
    assert.deepEqual(estagioDoRevisor({ laudoDeFuncionamentoOk: true, calibracao: cal(false), defeitos: exame(true) }), { estagio: 'REPROVADO', laudoValeNaBarreira: false })
    assert.deepEqual(estagioDoRevisor({ laudoDeFuncionamentoOk: true, calibracao: cal(true), defeitos: exame(true) }), { estagio: 'APTO_PARA_OPERACAO', laudoValeNaBarreira: true })
  })
})

describe('P2.75 — calibração não é garantia: divergência e auditoria em operação', () => {
  const cal: CalibracaoRegistrada = { revisor: 'r', aprovada: true, em: '2026-11-01T00:00:00Z', conjunto: [], motivo: '' }
  const ev = (tipo: 'DIVERGENCIA' | 'AUDITORIA_OK' | 'LAUDO_USADO', dia: number) => ({ tipo, sha256: 'f'.repeat(64), em: `2026-11-${String(dia).padStart(2, '0')}T00:00:00Z` })
  test('divergência depois da calibração revoga na hora; antes dela não conta', () => {
    assert.equal(confiabilidadeEmOperacao(cal, [ev('LAUDO_USADO', 2)]).vale, true)
    assert.match(confiabilidadeEmOperacao(cal, [ev('LAUDO_USADO', 2), ev('DIVERGENCIA', 3)]).motivo, /revogado/)
    assert.equal(confiabilidadeEmOperacao({ ...cal, em: '2026-11-05T00:00:00Z' }, [ev('DIVERGENCIA', 3)]).vale, true, 'recalibrado depois')
  })
  test('5 laudos usados sem auditoria humana: o próximo não vale; auditoria zera a contagem', () => {
    const cinco = [2, 3, 4, 5, 6].map((d) => ev('LAUDO_USADO', d))
    assert.equal(confiabilidadeEmOperacao(cal, cinco).vale, false)
    assert.equal(confiabilidadeEmOperacao(cal, [...cinco, ev('AUDITORIA_OK', 7)]).vale, true)
    assert.equal(confiabilidadeEmOperacao({ ...cal, aprovada: false }, []).vale, false)
  })
})
