/**
 * Revisão do P0.1 — as três correções pedidas.
 *
 * 1. teto mensal real (gasto acumulado apurado, fail-closed quando não dá);
 * 2. fallback EXECUTADO, não apenas mapeado;
 * 3. custo estimado que permite liberação coerente quando as duas chaves
 *    estiverem ligadas — mantendo fail-closed para o que não tem estimativa.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  avaliarCusto,
  lerPoliticaDeCusto,
  estimarCusto,
  CUSTO_ESTIMADO_BRL,
  ACAO_AUDIT_AUTORIZADO,
  ACAO_AUDIT_BLOQUEIO,
  type PoliticaDeCusto,
} from '../lib/cost-safety-gate'
import { gerarConteudoGratuito } from '../lib/conteudo-gratuito'
import { listarPendenciasDeAutomacao } from '../lib/cost-fallback'

const LIBERADO: PoliticaDeCusto = { pagoHabilitado: true, orcamentoMensal: 100 }

function decidir(over: Partial<Parameters<typeof avaliarCusto>[0]> = {}) {
  return avaliarCusto({
    provider: 'anthropic',
    operacao: 'gerar-roteiro',
    workspaceId: 'ws-a',
    custoEstimado: 1,
    gastoAcumulado: 0,
    politica: LIBERADO,
    ...over,
  })
}

describe('Custo estimado: tabela central conservadora', () => {
  test('operacoes conhecidas tem teto, e o de video e o maior', () => {
    const video = estimarCusto('fal.ai', 'gerar-video')
    const texto = estimarCusto('anthropic', 'gerar-roteiro')
    assert.ok(video && video > 0)
    assert.ok(texto && texto > 0)
    assert.ok(video > texto, 'video por IA e a operacao mais cara e precisa do maior teto')
  })

  test('operacao sem estimativa devolve null — e null BLOQUEIA', () => {
    assert.equal(estimarCusto('fal.ai', 'operacao-nova'), null)
    assert.equal(estimarCusto('provedor-novo', 'gerar-video'), null)
    const d = decidir({ custoEstimado: estimarCusto('fal.ai', 'operacao-nova') })
    assert.equal(d.permitido, false)
    assert.equal(d.motivo, 'CUSTO_EXCEDE_SALDO')
  })

  test('com as duas chaves ligadas, operacao com estimativa AGORA libera', () => {
    // Regressao do defeito apontado na revisao: com custoEstimado sempre null,
    // nem PAID_AI_ENABLED=true + orcamento liberavam coisa alguma.
    const d = decidir({
      custoEstimado: estimarCusto('anthropic', 'gerar-roteiro'),
      politica: lerPoliticaDeCusto({ PAID_AI_ENABLED: 'true', AI_MONTHLY_BUDGET: '100', AI_BUDGET_AUTORIZADO_POR: 'titular', AI_BUDGET_AUTORIZADO_ATE: '2099-12-31' }),
    })
    assert.equal(d.permitido, true)
  })

  test('estimativa nunca ultrapassa o saldo do workspace', () => {
    const custo = estimarCusto('fal.ai', 'gerar-video') as number
    const d = decidir({
      provider: 'fal.ai',
      operacao: 'gerar-video',
      custoEstimado: custo,
      gastoAcumulado: 100 - custo / 2,
      politica: { pagoHabilitado: true, orcamentoMensal: 100 },
    })
    assert.equal(d.permitido, false)
    assert.equal(d.motivo, 'CUSTO_EXCEDE_SALDO')
  })

  test('todos os tetos sao finitos e positivos', () => {
    for (const [chave, valor] of Object.entries(CUSTO_ESTIMADO_BRL)) {
      assert.ok(Number.isFinite(valor) && valor > 0, `teto invalido em ${chave}`)
    }
  })
})

describe('Gasto acumulado real e fail-closed', () => {
  test('gasto alto consome o saldo e bloqueia — o teto e real', () => {
    const d = decidir({ gastoAcumulado: 100 })
    assert.equal(d.permitido, false)
    assert.equal(d.motivo, 'ORCAMENTO_ESGOTADO')
    assert.equal(d.saldoDisponivel, 0)
  })

  test('gasto parcial reduz o saldo proporcionalmente', () => {
    assert.equal(decidir({ gastoAcumulado: 40 }).saldoDisponivel, 60)
    assert.equal(decidir({ gastoAcumulado: 99 }).saldoDisponivel, 1)
  })

  test('acoes de auditoria separam autorizado de bloqueado', () => {
    // Sem o registro de AUTORIZADO nao ha como somar consumo: o teto mensal
    // seria uma funcao que recebe zero para sempre.
    assert.equal(ACAO_AUDIT_AUTORIZADO, 'custo.autorizado')
    assert.equal(ACAO_AUDIT_BLOQUEIO, 'custo.bloqueado_por_politica')
    assert.notEqual(ACAO_AUDIT_AUTORIZADO, ACAO_AUDIT_BLOQUEIO)
  })

  test('gasto de um workspace nao entra no acumulado de outro', () => {
    const politica = { pagoHabilitado: true, orcamentoMensal: 10 }
    const a = decidir({ workspaceId: 'ws-a', gastoAcumulado: 10, politica })
    const b = decidir({ workspaceId: 'ws-b', gastoAcumulado: 0, politica })
    assert.equal(a.permitido, false)
    assert.equal(b.permitido, true)
    assert.equal(b.saldoDisponivel, 10)
  })
})

describe('Fallback EXECUTADO, nao apenas mapeado', () => {
  test('conteudo gratuito produz roteiro, legendas, hashtags e CTA reais', () => {
    const { conteudo, limitacoes } = gerarConteudoGratuito({
      nome: 'Carregador portátil 20.000 mAh',
      categoria: 'eletronicos',
      preco: 199,
    })
    assert.ok(conteudo.roteiro.length > 0, 'roteiro tem de ser gerado de verdade')
    assert.ok(conteudo.legendaTiktok.includes('Carregador'), 'legenda usa o produto real')
    assert.ok(conteudo.hashtags.length > 0)
    assert.ok(conteudo.chamadaAcao.length > 0)
    assert.ok(conteudo.textoTela.length > 0)
    assert.ok(limitacoes.length > 0, 'as limitacoes do caminho gratuito sao declaradas')
  })

  test('preco real aparece formatado em BRL na legenda', () => {
    // P1.9.1: preço só entra com verificação real e dentro do prazo.
    const agora = new Date('2026-10-01T12:00:00Z')
    const { conteudo } = gerarConteudoGratuito({
      nome: 'X', categoria: 'casa', preco: 1299.9,
      precoVerificadoEm: new Date('2026-10-01T09:00:00Z'), agora,
    })
    assert.ok(conteudo.legendaTiktok.includes('R$ 1.299,90'), conteudo.legendaTiktok)
  })

  test('sem preco, nao inventa valor', () => {
    const { conteudo } = gerarConteudoGratuito({ nome: 'X', categoria: 'casa', preco: null })
    assert.match(conteudo.legendaTiktok, /confira o preço atual/)
    assert.ok(!conteudo.legendaTiktok.includes('R$ 0'))
  })

  test('narracao livre fica VAZIA e vira divida de automacao, nao rotina manual', () => {
    const { conteudo, limitacoes } = gerarConteudoGratuito({ nome: 'X', categoria: 'casa' })
    assert.equal(conteudo.narracao, '', 'sem equivalente gratuito, fica vazia — nunca inventada')
    assert.ok(limitacoes.some((l) => /narração/i.test(l)))
    const pendencias = listarPendenciasDeAutomacao().map((p) => p.chave)
    assert.ok(pendencias.includes('anthropic:gerar-narracao-livre'))
  })

  test('nao inventa nota nem julgamento sobre o produto', () => {
    const { conteudo } = gerarConteudoGratuito({ nome: 'X', categoria: 'casa' })
    assert.equal(conteudo.notaProduto, null, 'null significa "nao avaliado" (P2.50: antes 0, que a tela mostrava como 0/10)')
    assert.match(conteudo.veredito, /não foi feita automaticamente/)
    assert.deepEqual(conteudo.pontosPositivos, [])
  })

  test('beneficios do cadastro sao preservados, nao inferidos', () => {
    const { conteudo } = gerarConteudoGratuito({
      nome: 'X',
      categoria: 'casa',
      beneficios: ['dura 2 anos'],
      pontosNegativos: ['não acompanha cabo'],
    })
    assert.deepEqual(conteudo.pontosPositivos, ['dura 2 anos'])
    assert.deepEqual(conteudo.pontosNegativos, ['não acompanha cabo'])
  })

  test('o caminho gratuito nao faz chamada de rede', async () => {
    const fetchOriginal = globalThis.fetch
    let chamou = false
    globalThis.fetch = (async () => {
      chamou = true
      throw new Error('nao deveria haver rede no caminho gratuito')
    }) as typeof fetch
    try {
      gerarConteudoGratuito({ nome: 'X', categoria: 'casa', preco: 10 })
      assert.equal(chamou, false, 'o fallback gratuito tem de ser 100% local')
    } finally {
      globalThis.fetch = fetchOriginal
    }
  })
})
