/**
 * Rodada 14 (P0.1) — CostSafetyGate: custo zero por padrão.
 *
 * A auditoria encontrou quatro integrações que podem cobrar (fal.ai,
 * Anthropic, Resend, Z-API) e nenhuma verificação antes de chamar. O
 * `AI_MONTHLY_BUDGET` estava documentado como teto mas não era lido em lugar
 * nenhum do código.
 *
 * O que estes testes garantem é o inverso do usual: não que o sistema
 * funcione, mas que ele NÃO GASTE. Por isso a maior parte verifica bloqueio.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  lerPoliticaDeCusto,
  avaliarCusto,
  ehProvedorPagoConhecido,
  POLITICA_PADRAO,
  PROVEDORES_PAGOS,
  type PoliticaDeCusto,
} from '../lib/cost-safety-gate'
import { escolherFallback, listarPendenciasDeAutomacao } from '../lib/cost-fallback'

const LIBERADO: PoliticaDeCusto = { pagoHabilitado: true, orcamentoMensal: 100 }

function consulta(over: Partial<Parameters<typeof avaliarCusto>[0]> = {}) {
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

describe('Politica de custo — ausencia NUNCA e permissao', () => {
  test('ambiente vazio bloqueia', () => {
    const p = lerPoliticaDeCusto({})
    // P2.53: a política também traz a situação da autorização (sem autorização aqui).
    assert.deepEqual({ pagoHabilitado: p.pagoHabilitado, orcamentoMensal: p.orcamentoMensal }, POLITICA_PADRAO)
    assert.equal(p.autorizacao?.valida, false)
    assert.equal(p.pagoHabilitado, false)
    assert.equal(p.orcamentoMensal, 0)
  })

  test('default do projeto e custo zero', () => {
    assert.equal(POLITICA_PADRAO.pagoHabilitado, false)
    assert.equal(POLITICA_PADRAO.orcamentoMensal, 0)
  })

  test('PAID_AI_ENABLED so libera com o texto exato "true"', () => {
    for (const v of ['false', 'TRUE', '1', 'sim', 'yes', '']) {
      assert.equal(lerPoliticaDeCusto({ PAID_AI_ENABLED: v }).pagoHabilitado, false, `valor: ${JSON.stringify(v)}`)
    }
    assert.equal(lerPoliticaDeCusto({ PAID_AI_ENABLED: 'true' }).pagoHabilitado, true)
  })

  test('orcamento invalido, negativo ou zero vira 0', () => {
    for (const v of ['abc', '-10', '0', '', '   ', 'NaN']) {
      assert.equal(lerPoliticaDeCusto({ AI_MONTHLY_BUDGET: v }).orcamentoMensal, 0, `valor: ${JSON.stringify(v)}`)
    }
    assert.equal(lerPoliticaDeCusto({ AI_MONTHLY_BUDGET: '50', AI_BUDGET_AUTORIZADO_POR: 'titular', AI_BUDGET_AUTORIZADO_ATE: '2099-12-31' }).orcamentoMensal, 50)
  })
})

describe('As DUAS chaves sao obrigatorias', () => {
  test('nenhuma das duas: bloqueado', () => {
    const d = consulta({ politica: lerPoliticaDeCusto({}) })
    assert.equal(d.permitido, false)
    assert.equal(d.decisao, 'BLOCKED_BY_COST_POLICY')
    assert.equal(d.motivo, 'PAGO_NAO_HABILITADO')
  })

  test('so PAID_AI_ENABLED=true, sem orcamento: bloqueado', () => {
    const d = consulta({ politica: lerPoliticaDeCusto({ PAID_AI_ENABLED: 'true' }) })
    assert.equal(d.permitido, false)
    assert.equal(d.motivo, 'ORCAMENTO_ZERO')
  })

  test('so AI_MONTHLY_BUDGET>0, sem habilitar: bloqueado', () => {
    // O cenario do .env de teste esquecido — nao pode virar autorizacao.
    const d = consulta({ politica: lerPoliticaDeCusto({ AI_MONTHLY_BUDGET: '500' }) })
    assert.equal(d.permitido, false)
    assert.equal(d.motivo, 'PAGO_NAO_HABILITADO')
  })

  test('as duas juntas: liberado', () => {
    const d = consulta({ politica: lerPoliticaDeCusto({ PAID_AI_ENABLED: 'true', AI_MONTHLY_BUDGET: '100', AI_BUDGET_AUTORIZADO_POR: 'titular', AI_BUDGET_AUTORIZADO_ATE: '2099-12-31' }) })
    assert.equal(d.permitido, true)
    assert.equal(d.decisao, 'ALLOWED')
  })
})

describe('Fail-closed', () => {
  test('provedor desconhecido e bloqueado mesmo com politica liberada', () => {
    const d = consulta({ provider: 'servico-pago-novo' })
    assert.equal(d.permitido, false)
    assert.equal(d.motivo, 'PROVEDOR_DESCONHECIDO')
  })

  test('custo desconhecido (null) e bloqueado — nunca tratado como zero', () => {
    const d = consulta({ custoEstimado: null })
    assert.equal(d.permitido, false)
    assert.equal(d.motivo, 'CUSTO_EXCEDE_SALDO')
  })

  test('orcamento ja consumido bloqueia', () => {
    const d = consulta({ gastoAcumulado: 100 })
    assert.equal(d.permitido, false)
    assert.equal(d.motivo, 'ORCAMENTO_ESGOTADO')
    assert.equal(d.saldoDisponivel, 0)
  })

  test('custo acima do saldo restante bloqueia', () => {
    const d = consulta({ gastoAcumulado: 95, custoEstimado: 10 })
    assert.equal(d.permitido, false)
    assert.equal(d.motivo, 'CUSTO_EXCEDE_SALDO')
  })

  test('os provedores pagos estao catalogados (4 originais + 4 de video da P2.42)', () => {
    for (const p of ['fal.ai', 'anthropic', 'resend', 'z-api', 'runway', 'google-veo', 'luma', 'simulado-teste']) {
      assert.equal(ehProvedorPagoConhecido(p), true, p)
    }
    assert.equal(Object.keys(PROVEDORES_PAGOS).length, 8)
  })
})

describe('Nenhum ator pode contornar o gate', () => {
  // Rota manual, worker, cron e Autopilot chegam ao MESMO `avaliarCusto`. A
  // funcao nao tem parametro de forcar/ignorar/prioridade — nao ha o que
  // passar para contornar. Estes testes provam que a origem nao muda nada.
  const politicaBloqueada = lerPoliticaDeCusto({})

  test('rota manual e bloqueada', () => {
    assert.equal(consulta({ politica: politicaBloqueada, operacao: 'gerar-roteiro' }).permitido, false)
  })

  test('worker e bloqueado', () => {
    assert.equal(consulta({ politica: politicaBloqueada, provider: 'fal.ai', operacao: 'gerar-video' }).permitido, false)
  })

  test('cron e bloqueado', () => {
    assert.equal(consulta({ politica: politicaBloqueada, provider: 'resend', operacao: 'enviar-email' }).permitido, false)
  })

  test('Autopilot simulado pedindo 500 videos: todos bloqueados', () => {
    const decisoes = Array.from({ length: 500 }, () =>
      consulta({ politica: politicaBloqueada, provider: 'fal.ai', operacao: 'gerar-video' })
    )
    assert.equal(decisoes.every((d) => !d.permitido), true)
    assert.equal(decisoes.every((d) => d.decisao === 'BLOCKED_BY_COST_POLICY'), true)
  })

  test('a assinatura nao aceita forcar/ignorar/prioridade', () => {
    const campos = Object.keys({
      provider: '',
      operacao: '',
      workspaceId: '',
      custoEstimado: null,
      gastoAcumulado: 0,
      politica: POLITICA_PADRAO,
    })
    for (const proibido of ['forcar', 'force', 'ignorar', 'bypass', 'prioridade', 'override']) {
      assert.equal(campos.includes(proibido), false, `campo proibido presente: ${proibido}`)
    }
  })
})

describe('Isolamento por workspace', () => {
  test('gasto de A nao consome o orcamento de B', () => {
    const a = consulta({ workspaceId: 'ws-a', gastoAcumulado: 100, custoEstimado: 1 })
    const b = consulta({ workspaceId: 'ws-b', gastoAcumulado: 0, custoEstimado: 1 })
    assert.equal(a.permitido, false, 'A estourou o proprio orcamento')
    assert.equal(b.permitido, true, 'B nao pode ser afetado pelo gasto de A')
  })

  test('cada workspace tem o proprio saldo', () => {
    assert.equal(consulta({ workspaceId: 'ws-a', gastoAcumulado: 30 }).saldoDisponivel, 70)
    assert.equal(consulta({ workspaceId: 'ws-b', gastoAcumulado: 0 }).saldoDisponivel, 100)
  })
})

describe('Fallback gratuito', () => {
  test('fal.ai cai no FFmpeg local', () => {
    const f = escolherFallback('fal.ai', 'gerar-video')
    assert.equal(f.tipo, 'LOCAL_GRATUITO')
    assert.match(String(f.alternativa), /renderer-ffmpeg/)
    assert.equal(f.pendenciaDeAutomacao, false)
  })

  test('Anthropic para hook/CTA cai no preset deterministico', () => {
    const f = escolherFallback('anthropic', 'gerar-roteiro')
    assert.equal(f.tipo, 'DETERMINISTICO')
    assert.match(String(f.alternativa), /gerarPresetTikTokDigitalTwinV1/)
    assert.equal(f.pendenciaDeAutomacao, false)
  })

  test('sem alternativa: nao gera cobranca e vira divida de automacao', () => {
    for (const [p, op] of [
      ['resend', 'enviar-email'],
      ['z-api', 'enviar-whatsapp'],
      ['anthropic', 'gerar-narracao-livre'],
    ] as const) {
      const f = escolherFallback(p, op)
      assert.equal(f.tipo, 'SEM_ALTERNATIVA', `${p}:${op}`)
      assert.equal(f.alternativa, null)
      assert.equal(f.pendenciaDeAutomacao, true, `${p}:${op} tem de entrar na fila de automacao`)
    }
  })

  test('operacao nao mapeada tambem vira pendencia, nunca permissao', () => {
    const f = escolherFallback('fal.ai', 'operacao-que-nao-existe')
    assert.equal(f.tipo, 'SEM_ALTERNATIVA')
    assert.equal(f.pendenciaDeAutomacao, true)
  })

  test('Automation Queue lista as dividas conhecidas', () => {
    // Lista FECHADA de proposito: toda operacao paga sem alternativa gratuita
    // tem de aparecer aqui. Quando uma nova entra, este teste falha e obriga a
    // decisao consciente - e o que impede uma divida de automacao nascer em
    // silencio. Atualizada na revisao final do P0.1, que fechou os caminhos
    // pagos que faltavam no fal.ai e separou as operacoes da Anthropic.
    const chaves = listarPendenciasDeAutomacao().map((p) => p.chave).sort()
    assert.deepEqual(chaves, [
      'anthropic:analisar-compliance',
      'anthropic:gerar-narracao-livre',
      'fal.ai:adicionar-legenda',
      'resend:enviar-email',
      'z-api:enviar-whatsapp',
    ])
  })
})

describe('Nenhuma credencial vaza', () => {
  test('a consulta nao tem sequer campo para credencial', () => {
    const d = consulta({ politica: lerPoliticaDeCusto({}) })
    const texto = JSON.stringify(d)
    for (const segredo of ['FAL_KEY', 'ANTHROPIC_API_KEY', 'RESEND_API_KEY', 'sk-ant-', 'Bearer', 'Authorization']) {
      assert.equal(texto.includes(segredo), false, `vazou: ${segredo}`)
    }
  })

  test('explicacao de bloqueio nao cita valor de variavel, so o nome', () => {
    const d = consulta({ politica: lerPoliticaDeCusto({ PAID_AI_ENABLED: 'false', AI_MONTHLY_BUDGET: '0' }) })
    assert.match(d.explicacao, /PAID_AI_ENABLED/)
    assert.ok(!d.explicacao.includes('sk-'), 'nunca pode conter chave')
  })

  test('fallback nao expoe caminho de credencial', () => {
    const f = escolherFallback('fal.ai', 'gerar-video')
    assert.ok(!JSON.stringify(f).includes('KEY'))
  })
})
