/**
 * P0.2 Bloco 4 — ligação segura da operação real ao Feature Store (regra pura).
 *
 * O label e as travas anti-vazamento são exercidos aqui sem Postgres. O que
 * precisa de banco — autoridade, idempotência, isolamento e contagem do
 * readiness gate — está em `rodada21-feature-store-banco.test.ts`.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  montarLabelDeOperacaoReal,
  verificarSemVazamentoDeResultado,
  chaveDaAmostra,
  ENTIDADE_DA_AMOSTRA,
  MOTIVOS_BLOQUEIO_ML,
  type VendaElegivelParaLabel,
} from '../lib/ml-operacao-real'
import { FEATURE_VERSION } from '../lib/ml-feature-store'
import { ORIGENS_PRODUCAO } from '../lib/ml-readiness-gate'

const RAIZ = join(__dirname, '..')
const lerFonte = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')
const lerCodigo = (rel: string) =>
  lerFonte(rel)
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n')

function venda(over: Partial<VendaElegivelParaLabel> = {}): VendaElegivelParaLabel {
  return {
    saleId: 'sale-1',
    amount: 100,
    clickEventId: 'clique-1',
    commissions: [{ status: 'RECEIVED', expectedAmount: 10, confirmedAmount: 9, receivedAmount: 8 }],
    ...over,
  }
}

// ── Label: os três estágios da comissão ─────────────────────────────────

describe('Label — comissão esperada, confirmada e recebida são coisas diferentes', () => {
  test('RECEIVED preenche os três, e a receita realizada é só o recebido', () => {
    const l = montarLabelDeOperacaoReal([venda()])
    assert.equal(l.comissaoEsperada, 10)
    assert.equal(l.comissaoConfirmada, 9)
    assert.equal(l.comissaoRecebida, 8)
    assert.equal(l.receitaRealizada, 8, 'receita efetiva é o RECEIVED, nunca o esperado')
  })

  test('comissão EXPECTED NÃO é tratada como recebida', () => {
    // O erro clássico de métrica de afiliado: tratar previsão como caixa.
    const l = montarLabelDeOperacaoReal([
      venda({ commissions: [{ status: 'EXPECTED', expectedAmount: 50, confirmedAmount: null, receivedAmount: null }] }),
    ])
    assert.equal(l.comissaoEsperada, 50)
    assert.equal(l.comissaoConfirmada, 0)
    assert.equal(l.comissaoRecebida, 0)
    assert.equal(l.receitaRealizada, 0)
  })

  test('CONFIRMED é distinguida de RECEIVED', () => {
    const l = montarLabelDeOperacaoReal([
      venda({ commissions: [{ status: 'CONFIRMED', expectedAmount: 10, confirmedAmount: 9, receivedAmount: null }] }),
    ])
    assert.equal(l.comissaoConfirmada, 9)
    assert.equal(l.comissaoRecebida, 0, 'confirmada não é recebida')
    assert.equal(l.receitaRealizada, 0)
  })

  test('valor com EXPECTED preenchido mas status EXPECTED não vira confirmado', () => {
    const l = montarLabelDeOperacaoReal([
      venda({ commissions: [{ status: 'EXPECTED', expectedAmount: 10, confirmedAmount: 99, receivedAmount: 99 }] }),
    ])
    assert.equal(l.comissaoConfirmada, 0, 'o status manda, não o campo solto')
    assert.equal(l.comissaoRecebida, 0)
  })

  test('valor bruto da venda é separado da comissão', () => {
    const l = montarLabelDeOperacaoReal([venda({ amount: 250 })])
    assert.equal(l.valorBrutoVendas, 250)
    assert.notEqual(l.valorBrutoVendas, l.comissaoRecebida)
  })

  test('várias vendas somam por estágio', () => {
    const l = montarLabelDeOperacaoReal([
      venda({ saleId: 'a', amount: 100 }),
      venda({
        saleId: 'b',
        amount: 200,
        commissions: [{ status: 'CONFIRMED', expectedAmount: 20, confirmedAmount: 18, receivedAmount: null }],
      }),
    ])
    assert.equal(l.vendasElegiveis, 2)
    assert.equal(l.valorBrutoVendas, 300)
    assert.equal(l.comissaoEsperada, 30)
    assert.equal(l.comissaoConfirmada, 27)
    assert.equal(l.comissaoRecebida, 8)
    assert.equal(l.receitaRealizada, 8)
  })

  test('valores nulos ou ilegíveis contam como zero, nunca como NaN', () => {
    const l = montarLabelDeOperacaoReal([
      venda({
        amount: null,
        commissions: [{ status: 'RECEIVED', expectedAmount: null, confirmedAmount: NaN, receivedAmount: Infinity }],
      }),
    ])
    for (const v of [l.valorBrutoVendas, l.comissaoEsperada, l.comissaoConfirmada, l.comissaoRecebida]) {
      assert.ok(Number.isFinite(v))
    }
    assert.equal(l.comissaoRecebida, 0)
  })
})

// ── Label: atribuição de clique ─────────────────────────────────────────

describe('Label — clique ausente é registrado como ausente', () => {
  // A contagem de clique só existe quando a publicação foi RASTREADA — fora
  // disso o clique nunca passou pelo redirect e a contagem vira `null` (ver
  // o describe seguinte). Estes testes são sobre a CONTAGEM, então declaram
  // a precondição em vez de depender do padrão fail-closed.
  const rastreada = (vendas: Parameters<typeof montarLabelDeOperacaoReal>[0]) =>
    montarLabelDeOperacaoReal(vendas, new Date(), 'RASTREADA')

  test('venda com clique atribuído entra em comClique', () => {
    const l = rastreada([venda({ clickEventId: 'clique-1' })])
    assert.deepEqual(l.atribuicaoDeClique, { comClique: 1, semClique: 0 })
  })

  test('venda SEM clique continua sendo operação real, com ausência registrada', () => {
    // Não inventamos clique. A amostra vale; a atribuição é declarada nula.
    const l = rastreada([venda({ clickEventId: null })])
    assert.equal(l.converted, true)
    assert.deepEqual(l.atribuicaoDeClique, { comClique: 0, semClique: 1 })
  })

  test('string vazia não conta como clique', () => {
    for (const id of ['', '   ']) {
      const l = rastreada([venda({ clickEventId: id })])
      assert.equal(l.atribuicaoDeClique?.semClique, 1)
    }
  })

  test('mistura de vendas com e sem clique é contada corretamente', () => {
    const l = rastreada([
      venda({ saleId: 'a', clickEventId: 'c1' }),
      venda({ saleId: 'b', clickEventId: null }),
      venda({ saleId: 'c', clickEventId: 'c2' }),
    ])
    assert.deepEqual(l.atribuicaoDeClique, { comClique: 2, semClique: 1 })
  })
})

// ── Label: estrutura e proveniência ─────────────────────────────────────

describe('Label — estrutura declarada', () => {
  test('origem do label é o fato comprovado, nunca inferência', () => {
    assert.equal(montarLabelDeOperacaoReal([venda()]).origemDoLabel, 'SALE_COMMISSION_COMPROVADA')
  })

  test('o label carrega a versão das features e o instante do labeling', () => {
    const agora = new Date('2026-09-21T15:00:00.000Z')
    const l = montarLabelDeOperacaoReal([venda()], agora)
    assert.equal(l.featureVersion, FEATURE_VERSION)
    assert.equal(l.labeledAt, agora.toISOString())
  })

  test('venda elegível marca converted=true — é o que o readiness conta como positiva', () => {
    assert.equal(montarLabelDeOperacaoReal([venda()]).converted, true)
  })

  test('lista vazia não inventa conversão', () => {
    const l = montarLabelDeOperacaoReal([])
    assert.equal(l.converted, false)
    assert.equal(l.vendasElegiveis, 0)
    assert.equal(l.receitaRealizada, 0)
  })

  test('a função é pura: não altera a lista recebida', () => {
    const lista = [venda()]
    const copia = JSON.parse(JSON.stringify(lista))
    montarLabelDeOperacaoReal(lista)
    assert.deepEqual(JSON.parse(JSON.stringify(lista)), copia)
  })
})

// ── Anti-vazamento ──────────────────────────────────────────────────────

describe('Sem data leakage — o resultado nunca entra como feature', () => {
  test('feature com nome de resultado é recusada', () => {
    for (const chave of [
      'sale_amount',
      'venda_confirmada',
      'commission_status',
      'comissao_recebida',
      'revenue_total',
      'receita_liquida',
      'converted',
      'label_final',
      'amount_bruto',
    ]) {
      assert.throws(
        () => verificarSemVazamentoDeResultado({ [chave]: 1 }),
        /data leakage/,
        `${chave} deveria ser recusada`
      )
    }
  })

  test('as features legítimas do conteúdo passam', () => {
    assert.doesNotThrow(() =>
      verificarSemVazamentoDeResultado({
        product_price_bucket: 'MID',
        commission_percentage: null,
        video_duration: 30,
        hook_type: 'PERGUNTA',
        cta_type: 'LINK_BIO',
        posting_hour: 19,
        avatar_style: null,
        channel: 'tiktok',
        product_category: 'casa',
        historical_conversion_rate: null,
      })
    )
  })

  test('entrada vazia ou nula não quebra', () => {
    assert.doesNotThrow(() => verificarSemVazamentoDeResultado({}))
    assert.doesNotThrow(() => verificarSemVazamentoDeResultado(null as never))
  })

  test('a extração de features NÃO lê Sale nem Commission', () => {
    // As features descrevem o criativo; o resultado é o que o modelo prevê.
    const codigo = lerCodigo('lib/ml-feature-store.ts')
    const trecho = codigo.slice(
      codigo.indexOf('export async function extrairFeaturesDeConteudo'),
      codigo.indexOf('export async function salvarFeatureSnapshot')
    )
    assert.ok(!/prisma\.sale|prisma\.commission/.test(trecho))
  })

  test('a conversão histórica corta no referenceDate e exclui o próprio conteúdo', () => {
    const codigo = lerCodigo('lib/ml-feature-store.ts')
    // Desde o P0.3 o corte temporal e a exclusao do proprio conteudo moram
    // em `lib/metricas-clique.ts`, que passou a ser a fonte de clique.
    const metricas = lerCodigo('lib/metricas-clique.ts')
    assert.match(metricas, /createdAt: \{ lt: janela\.antesDe \}/)
    assert.match(metricas, /date: \{ lt: janela\.antesDe \}/)
    assert.match(metricas, /contentId: \{ not: janela\.excluirContentId \}/)
  })

  test('capturedAt é o instante da DISTRIBUIÇÃO confirmada pelo canal', () => {
    // Revisto duas vezes: a amostra nasce quando o conteúdo REALMENTE
    // circula, e `capturedAt` guarda esse instante — não o de agora, nem o
    // de quando alguém abriu uma tela.
    assert.match(lerCodigo('lib/ml-captura-publicacao.ts'), /capturedAt: distribuidoEm/)
    assert.match(lerCodigo('lib/ml-captura-publicacao.ts'), /evidencia\.distribuidoEm/)
  })
})

// ── Autoridade única e proveniência ─────────────────────────────────────

describe('Autoridade única — este módulo não tem regra própria', () => {
  const codigo = lerCodigo('lib/ml-operacao-real.ts')

  test('pergunta à autoridade ANTES de qualquer escrita', () => {
    const posAutoridade = codigo.indexOf('avaliarVendaParaOperacaoReal(base.workspaceId, base.saleId)')
    const posUpdate = codigo.indexOf('tx.mLFeatureSnapshot.update')
    assert.ok(posAutoridade > 0 && posUpdate > posAutoridade)
  })

  test('não reproduz a regra de elegibilidade', () => {
    // Ler `Commission.status` para MONTAR O LABEL é legítimo e necessário —
    // é o resultado sendo registrado. O que não pode existir aqui é uma
    // segunda versão da regra que DECIDE elegibilidade: origem da venda,
    // status da venda, ou coerência de workspace.
    assert.ok(!/dataOrigin === 'REAL_OPERATION'/.test(codigo), 'origem é decisão da autoridade')
    assert.ok(!/venda\.status|sale\.status/.test(codigo), 'status da venda é decisão da autoridade')
    assert.ok(!/normalizarOrigemDeRegistro|ehOperacaoReal/.test(codigo), 'não reimplementar a origem')
  })

  test('mas LER o status da comissão para o label é legítimo', () => {
    assert.match(codigo, /c\?\.status === 'RECEIVED'/)
  })

  test('recusa da autoridade bloqueia e propaga os motivos como vieram', () => {
    assert.match(codigo, /if \(!veredito\.elegivel\)/)
    assert.match(codigo, /motivosDaAutoridade: veredito\?\.motivos \?\? \[\]/)
  })

  test('um único módulo grava REAL_OPERATION num snapshot', () => {
    // Desde o Bloco 4.1 esse módulo é o da CAPTURA, na publicação.
    assert.match(lerCodigo('lib/ml-captura-publicacao.ts'), /dataOrigin: 'REAL_OPERATION'/)
    for (const arq of [
      'lib/ml-operacao-real.ts',
      'lib/ml-feature-store.ts',
      'lib/ml-training-pipeline.ts',
      'lib/ml-engine.ts',
    ]) {
      assert.ok(
        !/dataOrigin: 'REAL_OPERATION'/.test(lerCodigo(arq)),
        `${arq} não pode gravar REAL_OPERATION por conta própria`
      )
    }
  })

  test('a rotulagem só toca label e labeledAt', () => {
    // Uma amostra de teste jamais vira de produção por reprocessamento, e a
    // observação histórica nunca é reescrita.
    const trecho = codigo.slice(codigo.indexOf('tx.mLFeatureSnapshot.update'), codigo.indexOf('return existente.id'))
    assert.ok(!/dataOrigin|features:|capturedAt/.test(trecho))
    assert.match(trecho, /data: \{ label: label as never, labeledAt/)
  })

  test('o label é montado só com vendas aprovadas pela autoridade', () => {
    assert.match(codigo, /if \(!veredito\?\.elegivel\) continue/)
  })

  test('só REAL_OPERATION conta como origem de produção', () => {
    assert.deepEqual([...ORIGENS_PRODUCAO], ['REAL_OPERATION'])
  })
})

// ── Entidade e idempotência ─────────────────────────────────────────────

describe('Entidade e chave de idempotência', () => {
  test('a amostra é do Conteudo — a mesma entidade que o readiness conta', () => {
    assert.equal(ENTIDADE_DA_AMOSTRA, 'Conteudo')
    assert.match(lerCodigo('lib/ml-readiness-gate.ts'), /entityType: string = 'Conteudo'/)
  })

  test('a chave é workspace + entidade + conteúdo + versão das features', () => {
    const base = { workspaceId: 'ws-a', entityId: 'cont-1' }
    assert.equal(chaveDaAmostra(base), `ws-a|Conteudo|cont-1|${FEATURE_VERSION}`)
  })

  test('workspace, conteúdo e versão entram todos na chave', () => {
    const base = { workspaceId: 'ws-a', entityId: 'cont-1' }
    assert.notEqual(chaveDaAmostra(base), chaveDaAmostra({ ...base, workspaceId: 'ws-b' }))
    assert.notEqual(chaveDaAmostra(base), chaveDaAmostra({ ...base, entityId: 'cont-2' }))
    assert.notEqual(chaveDaAmostra(base), chaveDaAmostra({ ...base, featureVersion: 'v2' }))
  })

  test('a escrita é serializada por advisory lock, dentro de transação', () => {
    const codigo = lerCodigo('lib/ml-operacao-real.ts')
    assert.match(codigo, /prisma\.\$transaction/)
    assert.match(codigo, /pg_advisory_xact_lock/)
  })

  test('a busca da amostra existente filtra por workspace', () => {
    const codigo = lerCodigo('lib/ml-operacao-real.ts')
    const trecho = codigo.slice(codigo.indexOf('tx.mLFeatureSnapshot.findFirst'), codigo.indexOf('if (existente)'))
    assert.match(trecho, /workspaceId: base\.workspaceId/)
    assert.match(trecho, /featureVersion: FEATURE_VERSION/)
  })

  test('todo motivo de bloqueio pertence à lista declarada', () => {
    for (const m of MOTIVOS_BLOQUEIO_ML) {
      assert.ok(typeof m === 'string' && m.length > 0)
    }
    assert.ok(MOTIVOS_BLOQUEIO_ML.includes('VENDA_SEM_CONTEUDO'))
  })
})

// ── O ML não se autoativa ───────────────────────────────────────────────

describe('Bloco 4 não ativa ML', () => {
  const codigo = lerCodigo('lib/ml-operacao-real.ts')

  test('nada de promover modelo, treinar ou sair do shadow mode', () => {
    for (const proibido of ['promoverModelo', 'treinarModelo', 'executarTreinamento', 'shadow', 'ACTIVE']) {
      assert.ok(!codigo.includes(proibido), `${proibido} não pode aparecer nesta rodada`)
    }
  })

  test('o módulo só escreve MLFeatureSnapshot — nada de MLModel nem MLTrainingRun', () => {
    assert.ok(!/mLModel|mLTrainingRun|mLPrediction/.test(codigo))
  })

  test('os limiares de prontidão não foram tocados', () => {
    const gate = lerCodigo('lib/ml-readiness-gate.ts')
    assert.match(gate, /minimoParaEstatistica: 30/)
    assert.match(gate, /minimoParaML: 200/)
    assert.match(gate, /minimoPositivosParaML: 20/)
  })

  test('o registro de modelos continua exigindo REAL_OPERATION para promover', () => {
    assert.match(lerCodigo('lib/ml-model-registry.ts'), /modelo\.dataOrigin !== 'REAL_OPERATION'/)
  })

  test('custo zero: nenhum provedor pago é tocado', () => {
    assert.ok(!/guardarChamadaPaga|falai|anthropic|resend|z-api/i.test(codigo))
  })
})
