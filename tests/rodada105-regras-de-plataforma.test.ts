/**
 * P2.20 — MOTOR DE RESTRIÇÕES/COTAS DA PLATAFORMA (início, puro).
 * Trava: toda regra tem os campos exigidos; regra de programa nunca vira regra universal; só regra
 * confirmada (fonte oficial ou conferida no app pela titular) bloqueia; revisão vencida/sem data = REVISAR;
 * cota diária: sem regra confirmada para a conta não limita; a da conta vale mais que a geral.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { CATALOGO_DE_REGRAS, statusEfetivo, regrasAplicaveis, avaliarCotaDiaria, confirmarNaConta } from '../lib/regras-de-plataforma'

const AGORA = new Date('2026-10-15T12:00:00-03:00')
const contaComum = { regiao: 'BR' as const, programas: [] as string[] }
const contaPiloto = { regiao: 'BR' as const, programas: ['PROGRAMA_PILOTO_VIDEOS_COMPRAVEIS'] }

describe('catálogo', () => {
  test('toda regra tem plataforma, programa, escopo, região, regra, limite, fonte, datas, confiança e status; ids únicos', () => {
    const ids = new Set<string>()
    for (const r of CATALOGO_DE_REGRAS) {
      for (const k of ['id', 'plataforma', 'escopo', 'regiao', 'regra', 'descricao', 'fonte', 'confianca', 'status'] as const) assert.ok(r[k], `${r.id}: ${k}`)
      for (const k of ['programa', 'limite', 'dataDaFonte', 'verificadaEm', 'vigenciaInicio', 'revisarEm', 'expiraEm'] as const) assert.ok(k in r, `${r.id}: campo ${k} presente (pode ser null)`)
      assert.ok(!ids.has(r.id)); ids.add(r.id)
      if (r.status === 'CONFIRMADA') assert.notEqual(r.confianca, 'BAIXA', `${r.id}: confirmada não pode ter confiança baixa`)
    }
  })
  test('o piloto de 10 vídeos/dia é de PROGRAMA, não confirmado, e não é regra da plataforma inteira', () => {
    const p = CATALOGO_DE_REGRAS.find((r) => r.regra === 'VIDEOS_COMPRAVEIS_POR_DIA')!
    assert.equal(p.escopo, 'PROGRAMA'); assert.equal(p.programa, 'PROGRAMA_PILOTO_VIDEOS_COMPRAVEIS'); assert.equal(p.status, 'NAO_CONFIRMADA')
  })
})

describe('status efetivo', () => {
  test('sem data de conferência → REVISAR; revisão vencida → REVISAR; expirada → EXPIRADA; antes da vigência → FUTURA', () => {
    const legenda = CATALOGO_DE_REGRAS.find((r) => r.regra === 'LEGENDA_MAX_CARACTERES')!
    assert.equal(statusEfetivo(legenda, AGORA), 'REVISAR')
    const reducao = CATALOGO_DE_REGRAS.find((r) => r.regra === 'REDUCAO_DE_COMISSAO_APOS_DIAS')!
    assert.equal(statusEfetivo(reducao, AGORA), 'CONFIRMADA')
    assert.equal(statusEfetivo(reducao, new Date('2027-05-01T12:00:00-03:00')), 'REVISAR', 'passou da revisão: conferir de novo')
    assert.equal(statusEfetivo({ ...reducao, expiraEm: '2026-10-01' }, AGORA), 'EXPIRADA')
    assert.equal(statusEfetivo({ ...reducao, vigenciaInicio: '2026-12-01' }, AGORA), 'FUTURA', 'confirmada mas ainda não vigente')
  })
})

describe('aplicabilidade (nunca generaliza regra de programa)', () => {
  test('conta fora do piloto: a regra do piloto não se aplica; regras da plataforma sim', () => {
    const r = regrasAplicaveis(CATALOGO_DE_REGRAS, { plataforma: 'TIKTOK_SHOP', conta: contaComum, agora: AGORA })
    assert.ok(!r.some((x) => x.programa === 'PROGRAMA_PILOTO_VIDEOS_COMPRAVEIS'))
    assert.ok(r.some((x) => x.regra === 'REDUCAO_DE_COMISSAO_APOS_DIAS' && x.bloqueia))
  })
  test('região: regra do Brasil não vale fora; GLOBAL vale em qualquer região', () => {
    assert.equal(regrasAplicaveis(CATALOGO_DE_REGRAS, { plataforma: 'TIKTOK_SHOP', regra: 'REDUCAO_DE_COMISSAO_APOS_DIAS', conta: { regiao: 'GLOBAL', programas: [] }, agora: AGORA }).length, 0)
    assert.equal(regrasAplicaveis(CATALOGO_DE_REGRAS, { plataforma: 'TIKTOK', regra: 'LEGENDA_MAX_CARACTERES', conta: { regiao: 'BR', programas: ['CONTENT_POSTING_API'] }, agora: AGORA }).length, 1)
  })
})

describe('cota diária de vídeos compráveis', () => {
  test('conta comum: não limita (a do piloto aparece só como informativa, com o motivo)', () => {
    const a = avaliarCotaDiaria(CATALOGO_DE_REGRAS, { plataforma: 'TIKTOK_SHOP', regra: 'VIDEOS_COMPRAVEIS_POR_DIA', conta: contaComum, usadoHoje: 25, agora: AGORA })
    assert.equal(a.limite, null); assert.equal(a.bloqueia, false)
    assert.match(a.motivo, /não limita por conta própria/)
    assert.match(a.informativas[0].motivo, /só vale para quem está no programa/)
  })
  test('conta no piloto mas regra não confirmada: ainda não bloqueia', () => {
    const a = avaliarCotaDiaria(CATALOGO_DE_REGRAS, { plataforma: 'TIKTOK_SHOP', regra: 'VIDEOS_COMPRAVEIS_POR_DIA', conta: contaPiloto, usadoHoje: 25, agora: AGORA })
    assert.equal(a.bloqueia, false); assert.match(a.informativas[0].motivo, /não confirmada/)
  })
  test('a titular confere no app (ex.: 8/dia): vira regra DA CONTA, conta 8, bloqueia ao atingir; revisão em 30 dias', () => {
    const base = CATALOGO_DE_REGRAS.find((r) => r.regra === 'VIDEOS_COMPRAVEIS_POR_DIA')!
    const daConta = confirmarNaConta(base, { limite: 8, agora: AGORA })
    assert.equal(daConta.status, 'CONFIRMADA_PELA_TITULAR'); assert.equal(daConta.escopo, 'CONTA'); assert.equal(daConta.revisarEm, '2026-11-14')
    const regras = [...CATALOGO_DE_REGRAS, daConta]
    const meio = avaliarCotaDiaria(regras, { plataforma: 'TIKTOK_SHOP', regra: 'VIDEOS_COMPRAVEIS_POR_DIA', conta: contaPiloto, usadoHoje: 5, agora: AGORA })
    assert.deepEqual([meio.limite, meio.restante, meio.bloqueia], [8, 3, false])
    assert.match(meio.motivo, /3 de 8 disponíveis hoje \(Tela do app TikTok/)
    const cheio = avaliarCotaDiaria(regras, { plataforma: 'TIKTOK_SHOP', regra: 'VIDEOS_COMPRAVEIS_POR_DIA', conta: contaPiloto, usadoHoje: 8, agora: AGORA })
    assert.equal(cheio.bloqueia, true)
    const vencida = avaliarCotaDiaria(regras, { plataforma: 'TIKTOK_SHOP', regra: 'VIDEOS_COMPRAVEIS_POR_DIA', conta: contaPiloto, usadoHoje: 8, agora: new Date('2026-11-20T12:00:00-03:00') })
    assert.equal(vencida.bloqueia, false, 'passou da revisão: não bloqueia até conferir de novo')
    assert.ok(vencida.informativas.some((x) => /conferida de novo/.test(x.motivo)))
  })
})

describe('fonte única da regra de 30 dias', () => {
  test('o alerta da P2.19 lê a regra do catálogo (mesmo id, dias, fonte e datas)', async () => {
    const { REGRA_REDUCAO_DE_COMISSAO } = await import('../lib/alerta-reducao-comissao')
    const c = CATALOGO_DE_REGRAS.find((r) => r.regra === 'REDUCAO_DE_COMISSAO_APOS_DIAS')!
    assert.deepEqual([REGRA_REDUCAO_DE_COMISSAO.id, REGRA_REDUCAO_DE_COMISSAO.dias, REGRA_REDUCAO_DE_COMISSAO.fonte, REGRA_REDUCAO_DE_COMISSAO.dataDaFonte, REGRA_REDUCAO_DE_COMISSAO.verificadaEm], [c.id, c.limite, c.fonte, c.dataDaFonte, c.verificadaEm])
  })
})
