/**
 * Testes do complemento "Machine Learning Real" da Rodada 9. Baseline:
 * 303 testes (67 mjs + 236 ts). Cobre: cold start/dados insuficientes,
 * extração de features, ausência de vazamento (leakage), isolamento por
 * workspace, fallback do ML, registro de modelo, versão do modelo,
 * promoção de modelo, rollback, previsão persistida, RULE_BASED vs ML,
 * atribuição de experimento (A/B), objetivo financeiro, identidade do
 * Digital Twin nunca alterada, e ausência de dado biométrico bruto no
 * dataset de performance.
 *
 *   DATABASE_URL=... npm run test:rodada9-ml
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'crypto'

import { criarUsuarioComWorkspace } from '../lib/workspace'
import { ML_DECISION_TYPES } from '../lib/ml-types'
import { avaliarProntidaoML, avaliarProntidaoMLDoWorkspace, LIMIARES_PRONTIDAO_PADRAO } from '../lib/ml-readiness-gate'
import {
  extrairFeaturesDeConteudo,
  extrairLabelDeConteudo,
  salvarFeatureSnapshot,
  registrarLabelNoSnapshot,
  calcularConversaoHistoricaPorCategoria,
  FEATURE_VERSION,
  type ContentMLFeatures,
} from '../lib/ml-feature-store'
import { treinarModeloConversao, CONVERSION_MODEL_FAMILY } from '../lib/ml-training-pipeline'
import { promoverModelo, rollbackModelo, obterModeloAtivo, avaliarPromocaoModelo } from '../lib/ml-model-registry'
import { preverOportunidades } from '../lib/ml-engine'
import { registrarResultado } from '../lib/vendas-comissoes'
import { promoverPorCorrecaoManual } from '../lib/promocao-operacao-real'
import { nomesDoVetorDeFeatures } from '../lib/ml-model'
import { MLBlendedScorer } from '../lib/opportunity-score-composite'
import { criarExperimento, atribuirVariante, registrarResultadoExperimento, concluirExperimento, decidirVarianteEpsilonGreedy } from '../lib/creative-experiment'
import { aprenderApresentacaoDigitalTwin, nuncaAlterarIdentidade } from '../lib/ml-digital-twin-learning'
import { verificarSemDadosBiometricos } from '../lib/ml-privacy'
import type { AffiliateOpportunity, OpportunitySource } from '../lib/affiliate-discovery'
import type { RendererProvider } from '../lib/creative-factory'

const prisma = new PrismaClient()

// ── Taxonomia — nunca chamado de ML o que é regra fixa (regra 1) ──────

describe('Taxonomia de decisão', () => {
  test('os 4 tipos de decisão existem e são distintos', () => {
    assert.deepEqual([...ML_DECISION_TYPES].sort(), ['MACHINE_LEARNING', 'MODEL_BASED', 'RULE_BASED', 'STATISTICAL_LEARNING'].sort())
  })
})

// ── Readiness Gate: cold start / dados insuficientes ───────────────────

describe('MLReadinessGate — cold start', () => {
  test('sem amostras rotuladas => INSUFFICIENT_DATA', () => {
    const r = avaliarProntidaoML({ labeledSampleCount: 0, positiveSampleCount: 0, hasActiveModel: false })
    assert.equal(r.estado, 'INSUFFICIENT_DATA')
  })

  test('amostras suficientes para estatística mas não para ML => READY_FOR_STATISTICS', () => {
    const r = avaliarProntidaoML({ labeledSampleCount: LIMIARES_PRONTIDAO_PADRAO.minimoParaEstatistica, positiveSampleCount: 5, hasActiveModel: false })
    assert.equal(r.estado, 'READY_FOR_STATISTICS')
  })

  test('amostras suficientes para ML (total e positivas) => READY_FOR_ML', () => {
    const r = avaliarProntidaoML({
      labeledSampleCount: LIMIARES_PRONTIDAO_PADRAO.minimoParaML,
      positiveSampleCount: LIMIARES_PRONTIDAO_PADRAO.minimoPositivosParaML,
      hasActiveModel: false,
    })
    assert.equal(r.estado, 'READY_FOR_ML')
  })

  test('modelo já ACTIVE => MODEL_ACTIVE independentemente da contagem', () => {
    const r = avaliarProntidaoML({ labeledSampleCount: 0, positiveSampleCount: 0, hasActiveModel: true })
    assert.equal(r.estado, 'MODEL_ACTIVE')
  })

  test('workspace novo (sem nenhum dado real) => INSUFFICIENT_DATA de verdade contra o Postgres', async () => {
    const { user } = await criarUsuarioComWorkspace(prisma, { email: `ml-cold-${randomUUID()}@t.com`, password: 'x' })
    const r = await avaliarProntidaoMLDoWorkspace(user.workspaceId, CONVERSION_MODEL_FAMILY)
    assert.equal(r.estado, 'INSUFFICIENT_DATA')
    await prisma.user.deleteMany({ where: { workspaceId: user.workspaceId } })
    await prisma.workspace.deleteMany({ where: { id: user.workspaceId } })
  })

  test('treinarModeloConversao recusa treinar com dados insuficientes — nunca inventa dado', async () => {
    const { user } = await criarUsuarioComWorkspace(prisma, { email: `ml-cold2-${randomUUID()}@t.com`, password: 'x' })
    const resultado = await treinarModeloConversao(user.workspaceId)
    assert.equal(resultado.status, 'INSUFFICIENT_DATA')
    await prisma.user.deleteMany({ where: { workspaceId: user.workspaceId } })
    await prisma.workspace.deleteMany({ where: { id: user.workspaceId } })
  })

  test('CORREÇÃO: 250 amostras TEST_FIXTURE + poucas REAL_OPERATION nunca vira READY_FOR_ML — só dado real conta para produção', async () => {
    const { user } = await criarUsuarioComWorkspace(prisma, { email: `ml-prov-${randomUUID()}@t.com`, password: 'x' })
    const workspaceId = user.workspaceId

    // 250 observações de teste (fixture) — nunca podem contar para a prontidão de PRODUÇÃO.
    const fixtures = Array.from({ length: 250 }, (_, i) => ({
      workspaceId, entityType: 'Conteudo', entityId: `fixture-${i}`, featureVersion: FEATURE_VERSION,
      features: {} as never, label: { converted: true } as never, labeledAt: new Date(), dataOrigin: 'TEST_FIXTURE',
    }))
    await prisma.mLFeatureSnapshot.createMany({ data: fixtures })

    // Só 3 publicações reais — bem abaixo do mínimo.
    const reais = Array.from({ length: 3 }, (_, i) => ({
      workspaceId, entityType: 'Conteudo', entityId: `real-${i}`, featureVersion: FEATURE_VERSION,
      features: {} as never, label: { converted: true } as never, labeledAt: new Date(), dataOrigin: 'REAL_OPERATION',
    }))
    await prisma.mLFeatureSnapshot.createMany({ data: reais })

    const prontidao = await avaliarProntidaoMLDoWorkspace(workspaceId, CONVERSION_MODEL_FAMILY)
    // 250 fixtures + 3 reais NUNCA significa READY_FOR_ML — só as 3 reais contam.
    assert.notEqual(prontidao.estado, 'READY_FOR_ML')
    assert.equal(prontidao.estado, 'INSUFFICIENT_DATA')
    assert.equal(prontidao.amostrasRotuladas, 3)

    const treino = await treinarModeloConversao(workspaceId)
    assert.equal(treino.status, 'INSUFFICIENT_DATA')

    // Agora completamos REAL_OPERATION suficiente — a prontidão pode avançar.
    const maisReais = Array.from({ length: 250 }, (_, i) => ({
      workspaceId, entityType: 'Conteudo', entityId: `real-extra-${i}`, featureVersion: FEATURE_VERSION,
      features: {} as never, label: { converted: i % 5 === 0 } as never, labeledAt: new Date(), dataOrigin: 'REAL_OPERATION',
    }))
    await prisma.mLFeatureSnapshot.createMany({ data: maisReais })

    const prontidaoDepois = await avaliarProntidaoMLDoWorkspace(workspaceId, CONVERSION_MODEL_FAMILY)
    assert.equal(prontidaoDepois.estado, 'READY_FOR_ML')
    assert.equal(prontidaoDepois.amostrasRotuladas, 253) // as 250 TEST_FIXTURE continuam nunca contando

    await prisma.mLFeatureSnapshot.deleteMany({ where: { workspaceId } })
    await prisma.user.deleteMany({ where: { workspaceId } })
    await prisma.workspace.deleteMany({ where: { id: workspaceId } })
  })
})

// ── Feature Store: extração real + ausência de vazamento (leakage) ────

describe('MLFeatureStore — extração de features e funil real', () => {
  let workspaceId: string
  let produtoId: string

  before(async () => {
    const { user } = await criarUsuarioComWorkspace(prisma, { email: `ml-fs-${randomUUID()}@t.com`, password: 'x' })
    workspaceId = user.workspaceId
    const produto = await prisma.produto.create({
      data: { workspaceId, userId: user.id, nome: 'Fone Z', categoria: 'eletronicos', preco: 89.9, origemConteudo: 'manual', tipoVenda: 'afiliado' },
    })
    produtoId = produto.id
  })

  after(async () => {
    // A ordem segue as chaves estrangeiras. Comissão, evento de clique e
    // link entraram aqui no P0.3: o teste de vazamento passou a montar o
    // cenário com clique e venda REAIS, e sem apagá-los o `deleteMany` de
    // produto esbarra em LinkDinamico_produtoId_fkey.
    await prisma.mLFeatureSnapshot.deleteMany({ where: { workspaceId } })
    await prisma.commission.deleteMany({ where: { workspaceId } })
    await prisma.sale.deleteMany({ where: { workspaceId } })
    await prisma.eventoLink.deleteMany({ where: { workspaceId } })
    await prisma.linkDinamico.deleteMany({ where: { workspaceId } })
    await prisma.auditLog.deleteMany({ where: { workspaceId } })
    await prisma.conteudo.deleteMany({ where: { workspaceId } })
    await prisma.produto.deleteMany({ where: { workspaceId } })
    await prisma.user.deleteMany({ where: { workspaceId } })
    await prisma.workspace.deleteMany({ where: { id: workspaceId } })
    await prisma.$disconnect()
  })

  test('features nomeadas são extraídas de um Conteudo real (produto/roteiro/CTA/canal reais)', async () => {
    const conteudo = await prisma.conteudo.create({
      data: {
        workspaceId, userId: (await prisma.user.findFirstOrThrow({ where: { workspaceId } })).id, produtoId,
        roteiro: 'Achei um preco incrivel nesse fone, veja como funciona.',
        chamadaAcao: 'Veja o preco atual', duracao: 18, redeSocial: 'tiktok',
        dataPublicacao: new Date('2026-03-01T12:00:00Z'), cliquesLink: 10,
      },
    })
    const resultado = await extrairFeaturesDeConteudo(workspaceId, conteudo.id)
    assert.ok(resultado)
    assert.equal(resultado!.features.product_price_bucket, 'MID')
    assert.equal(resultado!.features.video_duration, 18)
    assert.equal(resultado!.features.channel, 'tiktok')
    assert.equal(resultado!.features.product_category, 'eletronicos')
    assert.equal(resultado!.features.cta_type, 'VEJA_PRECO')
    assert.equal(resultado!.features.commission_percentage, null) // nunca inventado — campo não existe no schema ainda
  })

  test('conteúdo sem venda: label nunca finge conversão (converted=false, valores null)', async () => {
    const conteudo = await prisma.conteudo.create({
      data: { workspaceId, userId: (await prisma.user.findFirstOrThrow({ where: { workspaceId } })).id, produtoId, cliquesLink: 5 },
    })
    const label = await extrairLabelDeConteudo(workspaceId, conteudo.id)
    assert.equal(label.converted, false)
    assert.equal(label.saleAmount, null)
    assert.equal(label.commissionValue, null)
  })

  test('label muda para converted=true só depois que a Sale real é confirmada — nunca antes', async () => {
    const user = await prisma.user.findFirstOrThrow({ where: { workspaceId } })
    const conteudo = await prisma.conteudo.create({ data: { workspaceId, userId: user.id, produtoId, cliquesLink: 5 } })

    const antes = await extrairLabelDeConteudo(workspaceId, conteudo.id)
    assert.equal(antes.converted, false)

    await prisma.sale.create({ data: { workspaceId, productId: produtoId, contentId: conteudo.id, amount: 89.9, status: 'CONFIRMED' } })
    const depois = await extrairLabelDeConteudo(workspaceId, conteudo.id)
    assert.equal(depois.converted, true)
    assert.equal(depois.saleAmount, 89.9)
  })

  test('snapshot persistido + label registrado depois (labeledAt preenchido só na segunda chamada)', async () => {
    const user = await prisma.user.findFirstOrThrow({ where: { workspaceId } })
    const conteudo = await prisma.conteudo.create({ data: { workspaceId, userId: user.id, produtoId, cliquesLink: 1 } })
    const extracao = await extrairFeaturesDeConteudo(workspaceId, conteudo.id)
    const snapshot = await salvarFeatureSnapshot(workspaceId, 'Conteudo', conteudo.id, extracao!.features, 'TEST_FIXTURE')
    assert.equal(snapshot.labeledAt, null)
    assert.equal(snapshot.featureVersion, FEATURE_VERSION)

    const label = await extrairLabelDeConteudo(workspaceId, conteudo.id)
    const atualizado = await registrarLabelNoSnapshot(snapshot.id, label)
    assert.notEqual(atualizado.labeledAt, null)
  })

  test('SEM VAZAMENTO: o conteúdo sendo featurizado nunca contamina sua própria conversão histórica (regra 31)', async () => {
    // REESCRITO no P0.3. O cenário antigo fabricava `cliquesLink` e uma Sale
    // crua — dois atalhos que a métrica real não aceita mais: clique vem de
    // `EventoLink` e venda precisa ser REAL_OPERATION comprovada. A garantia
    // testada continua a mesma; só o caminho para montá-la ficou honesto.
    const user = await prisma.user.findFirstOrThrow({ where: { workspaceId } })
    const referencia = new Date('2026-05-01T10:00:00Z')

    const link = await prisma.linkDinamico.create({
      data: {
        workspaceId,
        userId: user.id,
        produtoId,
        slug: `vaz-${randomUUID()}`,
        plataforma: 'tiktok',
        urlDestino: 'https://exemplo.invalido/p',
      },
    })

    // 100 cliques REAIS anteriores à referência.
    for (let i = 1; i <= 100; i++) {
      await prisma.eventoLink.create({
        data: {
          workspaceId,
          linkId: link.id,
          tipo: 'clique',
          createdAt: new Date(referencia.getTime() - i * 60 * 1000),
        },
      })
    }

    const antigo = await prisma.conteudo.create({
      data: {
        workspaceId,
        userId: user.id,
        produtoId,
        createdAt: new Date('2026-04-01T00:00:00Z'),
        dataPublicacao: new Date('2026-04-01T01:00:00Z'),
      },
    })

    // Uma venda COMPROVADA de outro conteúdo, e uma do próprio conteúdo novo.
    const criarVendaReal = async (contentId: string, quando: Date) => {
      const { sale, commission } = await registrarResultado({
        workspaceId,
        actorUserId: user.id,
        dataOrigin: 'USER_REPORTED',
        productId: produtoId,
        contentId,
        date: quando,
        amount: 89.9,
        status: 'CONFIRMED',
        expectedCommission: 9,
        idempotencyKey: `vaz-${randomUUID()}`,
      })
      await prisma.commission.update({
        where: { id: commission!.id },
        data: { status: 'RECEIVED', confirmedAmount: 9, receivedAmount: 8 },
      })
      const r = await promoverPorCorrecaoManual({
        workspaceId,
        saleId: sale.id,
        responsavelUserId: user.id,
        motivo: 'Repasse conferido no extrato bancário da empresa.',
        referencia: `extrato-${sale.id}`,
      })
      assert.equal(r.promovido, true, r.explicacao)
      return sale.id
    }
    await criarVendaReal(antigo.id, new Date('2026-04-01T02:00:00Z'))

    // Conteúdo novo, criado ANTES de ser publicado — sem a exclusão de si
    // mesmo, a venda dele vazaria para dentro da própria feature.
    const novo = await prisma.conteudo.create({
      data: {
        workspaceId,
        userId: user.id,
        produtoId,
        createdAt: new Date(referencia.getTime() - 60 * 60 * 1000),
        dataPublicacao: referencia,
      },
    })
    await criarVendaReal(novo.id, new Date(referencia.getTime() - 30 * 60 * 1000))

    const semExclusao = await calcularConversaoHistoricaPorCategoria(workspaceId, 'eletronicos', referencia)
    const comExclusao = await calcularConversaoHistoricaPorCategoria(workspaceId, 'eletronicos', referencia, novo.id)

    // Sem a exclusão o número muda — é o vazamento, real e detectável.
    assert.notEqual(semExclusao, comExclusao)
    assert.equal(semExclusao, 2 / 100)
    assert.equal(comExclusao, 1 / 100, 'só a venda do conteúdo antigo conta')

    const extracao = await extrairFeaturesDeConteudo(workspaceId, novo.id)
    assert.equal(extracao!.features.historical_conversion_rate, 1 / 100)
  })
})

// ── Métricas financeiras (regra 5) ─────────────────────────────────────

describe('MLModelRegistry — promoção, versão e rollback', () => {
  let workspaceId: string
  const family = CONVERSION_MODEL_FAMILY

  before(async () => {
    const { user } = await criarUsuarioComWorkspace(prisma, { email: `ml-reg-${randomUUID()}@t.com`, password: 'x' })
    workspaceId = user.workspaceId
  })

  after(async () => {
    await prisma.mLModel.deleteMany({ where: { workspaceId } })
    await prisma.user.deleteMany({ where: { workspaceId } })
    await prisma.workspace.deleteMany({ where: { id: workspaceId } })
    await prisma.$disconnect()
  })

  test('ModelPromotionGate nunca promove candidato que não supera o baseline pela margem mínima', () => {
    const decisao = avaliarPromocaoModelo({ metrics: { rocAuc: 0.51 }, baselineMetrics: { rocAuc: 0.5 } })
    assert.equal(decisao.aprovado, false)
  })

  test('ModelPromotionGate promove candidato que supera claramente o baseline', () => {
    const decisao = avaliarPromocaoModelo({ metrics: { rocAuc: 0.85 }, baselineMetrics: { rocAuc: 0.5 } })
    assert.equal(decisao.aprovado, true)
  })

  test('candidato sem ROC-AUC calculável nunca é promovido (uma classe só na validação)', () => {
    const decisao = avaliarPromocaoModelo({ metrics: { rocAuc: null }, baselineMetrics: { rocAuc: 0.5 } })
    assert.equal(decisao.aprovado, false)
  })

  test('modelo criado começa CANDIDATE — nunca ACTIVE automaticamente', async () => {
    const modelo = await prisma.mLModel.create({
      data: { workspaceId, family, modelType: 'LOGISTIC_REGRESSION', version: 1, trainingDate: new Date(), trainingDatasetVersion: 'v1', features: [], metrics: { rocAuc: 0.9 }, baselineMetrics: { rocAuc: 0.5 }, dataOrigin: 'REAL_OPERATION' },
    })
    assert.equal(modelo.status, 'CANDIDATE')
  })

  test('promoverModelo real: candidato forte (REAL_OPERATION) vira ACTIVE, versão anterior vira DEPRECATED (nunca dois ACTIVE)', async () => {
    const v1 = await prisma.mLModel.create({
      data: { workspaceId, family, modelType: 'LOGISTIC_REGRESSION', version: 2, trainingDate: new Date(), trainingDatasetVersion: 'v2', features: [], metrics: { rocAuc: 0.8 }, baselineMetrics: { rocAuc: 0.5 }, dataOrigin: 'REAL_OPERATION' },
    })
    const r1 = await promoverModelo(workspaceId, v1.id)
    assert.equal(r1.promovido, true)

    const v2 = await prisma.mLModel.create({
      data: { workspaceId, family, modelType: 'LOGISTIC_REGRESSION', version: 3, trainingDate: new Date(), trainingDatasetVersion: 'v3', features: [], metrics: { rocAuc: 0.9 }, baselineMetrics: { rocAuc: 0.5 }, dataOrigin: 'REAL_OPERATION' },
    })
    const r2 = await promoverModelo(workspaceId, v2.id)
    assert.equal(r2.promovido, true)

    const v1Depois = await prisma.mLModel.findUnique({ where: { id: v1.id } })
    const v2Depois = await prisma.mLModel.findUnique({ where: { id: v2.id } })
    assert.equal(v1Depois?.status, 'DEPRECATED')
    assert.equal(v2Depois?.status, 'ACTIVE')

    const ativo = await obterModeloAtivo(workspaceId, family)
    assert.equal(ativo?.id, v2.id)
  })

  test('CORREÇÃO: modelo treinado com TEST_FIXTURE nunca é promovido a ACTIVE, mesmo superando o baseline', async () => {
    const fixture = await prisma.mLModel.create({
      data: { workspaceId, family, modelType: 'LOGISTIC_REGRESSION', version: 100, trainingDate: new Date(), trainingDatasetVersion: 'vfixture', features: [], metrics: { rocAuc: 0.95 }, baselineMetrics: { rocAuc: 0.5 }, dataOrigin: 'TEST_FIXTURE' },
    })
    const r = await promoverModelo(workspaceId, fixture.id)
    assert.equal(r.promovido, false)
    assert.match(r.motivo, /TEST_FIXTURE/)

    const depois = await prisma.mLModel.findUnique({ where: { id: fixture.id } })
    assert.equal(depois?.status, 'CANDIDATE') // nunca vira ACTIVE
  })

  test('rollbackModelo reverte para a versão anterior — nunca deixa o Patrono sem fallback', async () => {
    const resultado = await rollbackModelo(workspaceId, family)
    assert.equal(resultado.rolledBack, true)
    assert.ok(resultado.novoAtivoId) // reativou a versão DEPRECATED anterior

    const novoAtivo = await obterModeloAtivo(workspaceId, family)
    assert.equal(novoAtivo?.id, resultado.novoAtivoId)
  })

  test('rollback sem nenhum modelo ACTIVE nunca lança erro — só reporta que não havia o que reverter', async () => {
    await prisma.mLModel.updateMany({ where: { workspaceId, family }, data: { status: 'DEPRECATED' } })
    const resultado = await rollbackModelo(workspaceId, family)
    assert.equal(resultado.rolledBack, false)
  })
})

// ── PatronoMLEngine: previsão persistida, versão registrada, fallback ──

describe('PatronoMLEngine — previsão real, versão registrada, fallback nunca bloqueia', () => {
  let workspaceId: string

  before(async () => {
    const { user } = await criarUsuarioComWorkspace(prisma, { email: `ml-engine-${randomUUID()}@t.com`, password: 'x' })
    workspaceId = user.workspaceId
  })

  after(async () => {
    await prisma.mLPrediction.deleteMany({ where: { workspaceId } })
    await prisma.mLModel.deleteMany({ where: { workspaceId } })
    await prisma.auditLog.deleteMany({ where: { workspaceId } })
    await prisma.user.deleteMany({ where: { workspaceId } })
    await prisma.workspace.deleteMany({ where: { id: workspaceId } })
    await prisma.$disconnect()
  })

  const opBase: AffiliateOpportunity = {
    providerId: 'amazon', productName: 'Produto Engine', category: 'eletronicos', price: 100,
    estimatedCommissionBRL: 10, historicalConversionRate: 0.05, origin: 'OFFICIAL_API', source: 'x', lastVerifiedAt: 'x',
  }

  test('sem modelo ACTIVE, previsão cai para RULE_BASED usando o historicalConversionRate da própria oportunidade', async () => {
    const [predicao] = await preverOportunidades(workspaceId, [opBase])
    assert.equal(predicao.decisionType, 'RULE_BASED')
    assert.equal(predicao.predictedConversionProbability, 0.05)
    assert.equal(predicao.modelFamily, null)
  })

  test('previsão é SEMPRE persistida (MLPrediction real no Postgres) — nunca silenciosa', async () => {
    await preverOportunidades(workspaceId, [opBase])
    const registros = await prisma.mLPrediction.findMany({ where: { workspaceId, entityType: 'AffiliateOpportunity' } })
    assert.ok(registros.length >= 1)
    assert.equal(registros[0].decisionType, 'RULE_BASED')
  })

  test('com modelo ACTIVE, previsão vira MACHINE_LEARNING e registra modelFamily/modelVersion', async () => {
    // Modelo simples e determinístico: pesos zerados => sempre prevê sigmoid(bias).
    // Tamanho do vetor derivado de nomesDoVetorDeFeatures() (nunca hardcoded — evita
    // um artifact de teste dessincronizado do vetorizador real, que produziria NaN).
    const dims = nomesDoVetorDeFeatures().length
    const modelo = await prisma.mLModel.create({
      data: {
        workspaceId, family: CONVERSION_MODEL_FAMILY, modelType: 'LOGISTIC_REGRESSION', version: 1,
        trainingDate: new Date(), trainingDatasetVersion: 'v1', features: [], metrics: { rocAuc: 0.9 }, status: 'ACTIVE', dataOrigin: 'TEST_FIXTURE',
        artifact: { pesos: new Array(dims).fill(0), bias: 2, padronizacao: { medias: new Array(dims).fill(0), desvios: new Array(dims).fill(1) } },
      },
    })
    const [predicao] = await preverOportunidades(workspaceId, [opBase])
    assert.equal(predicao.decisionType, 'MACHINE_LEARNING')
    assert.equal(predicao.modelFamily, CONVERSION_MODEL_FAMILY)
    assert.equal(predicao.modelVersion, 1)
    assert.ok(predicao.predictedConversionProbability! > 0.5) // sigmoid(2) > 0.5

    const registro = await prisma.mLPrediction.findFirst({ where: { workspaceId, modelRowId: modelo.id } })
    assert.ok(registro)
  })

  test('artifact com dimensão dessincronizada do vetor de features atual nunca produz NaN silencioso — cai para RULE_BASED', async () => {
    await prisma.mLModel.updateMany({ where: { workspaceId, family: CONVERSION_MODEL_FAMILY }, data: { status: 'DEPRECATED' } })
    await prisma.mLModel.create({
      data: {
        workspaceId, family: CONVERSION_MODEL_FAMILY, modelType: 'LOGISTIC_REGRESSION', version: 3,
        trainingDate: new Date(), trainingDatasetVersion: 'v3', features: [], metrics: { rocAuc: 0.9 }, status: 'ACTIVE', dataOrigin: 'TEST_FIXTURE',
        // Dimensão errada de propósito (3 em vez do tamanho real do vetor) — produziria NaN sem a validação.
        artifact: { pesos: [0, 0, 0], bias: 2, padronizacao: { medias: [0, 0, 0], desvios: [1, 1, 1] } },
      },
    })
    const [predicao] = await preverOportunidades(workspaceId, [opBase])
    assert.equal(predicao.decisionType, 'RULE_BASED')
    assert.notEqual(predicao.predictedConversionProbability, NaN)
    assert.ok(predicao.predictedConversionProbability == null || Number.isFinite(predicao.predictedConversionProbability))
  })

  test('modelo ACTIVE com artifact corrompido nunca bloqueia — cai para RULE_BASED (regra 44)', async () => {
    await prisma.mLModel.updateMany({ where: { workspaceId, family: CONVERSION_MODEL_FAMILY }, data: { status: 'DEPRECATED' } })
    await prisma.mLModel.create({
      data: {
        workspaceId, family: CONVERSION_MODEL_FAMILY, modelType: 'LOGISTIC_REGRESSION', version: 2,
        trainingDate: new Date(), trainingDatasetVersion: 'v2', features: [], metrics: { rocAuc: 0.9 }, status: 'ACTIVE', dataOrigin: 'TEST_FIXTURE',
        artifact: { pesosCorrompido: true }, // formato inválido de propósito
      },
    })
    const [predicao] = await preverOportunidades(workspaceId, [opBase])
    assert.equal(predicao.decisionType, 'RULE_BASED')
  })
})

describe('Isolamento por workspace — dados de ML nunca cruzam workspaces', () => {
  let workspaceA: string
  let workspaceB: string

  before(async () => {
    const a = await criarUsuarioComWorkspace(prisma, { email: `ml-iso-a-${randomUUID()}@t.com`, password: 'x' })
    const b = await criarUsuarioComWorkspace(prisma, { email: `ml-iso-b-${randomUUID()}@t.com`, password: 'x' })
    workspaceA = a.user.workspaceId
    workspaceB = b.user.workspaceId
  })

  after(async () => {
    await prisma.mLModel.deleteMany({ where: { workspaceId: { in: [workspaceA, workspaceB] } } })
    await prisma.mLFeatureSnapshot.deleteMany({ where: { workspaceId: { in: [workspaceA, workspaceB] } } })
    await prisma.user.deleteMany({ where: { workspaceId: { in: [workspaceA, workspaceB] } } })
    await prisma.workspace.deleteMany({ where: { id: { in: [workspaceA, workspaceB] } } })
    await prisma.$disconnect()
  })

  test('modelo ACTIVE do workspace A nunca é retornado como ativo para o workspace B', async () => {
    await prisma.mLModel.create({
      data: { workspaceId: workspaceA, family: CONVERSION_MODEL_FAMILY, modelType: 'LOGISTIC_REGRESSION', version: 1, trainingDate: new Date(), trainingDatasetVersion: 'v1', features: [], metrics: {}, status: 'ACTIVE', dataOrigin: 'TEST_FIXTURE' },
    })
    const ativoB = await obterModeloAtivo(workspaceB, CONVERSION_MODEL_FAMILY)
    assert.equal(ativoB, null)
    const ativoA = await obterModeloAtivo(workspaceA, CONVERSION_MODEL_FAMILY)
    assert.notEqual(ativoA, null)
  })

  test('readiness gate de B nunca conta amostras rotuladas de A', async () => {
    for (let i = 0; i < 50; i++) {
      await prisma.mLFeatureSnapshot.create({
        data: { workspaceId: workspaceA, entityType: 'Conteudo', entityId: `c-${i}`, featureVersion: FEATURE_VERSION, features: {}, label: { converted: true }, labeledAt: new Date(), dataOrigin: 'REAL_OPERATION' },
      })
    }
    const prontidaoA = await avaliarProntidaoMLDoWorkspace(workspaceA, CONVERSION_MODEL_FAMILY)
    const prontidaoB = await avaliarProntidaoMLDoWorkspace(workspaceB, CONVERSION_MODEL_FAMILY)
    assert.equal(prontidaoA.amostrasRotuladas, 50)
    assert.equal(prontidaoB.amostrasRotuladas, 0)
  })
})

// ── CreativeExperiment (A/B) ────────────────────────────────────────────

describe('CreativeExperiment — atribuição epsilon-greedy real', () => {
  let workspaceId: string

  before(async () => {
    const { user } = await criarUsuarioComWorkspace(prisma, { email: `ml-exp-${randomUUID()}@t.com`, password: 'x' })
    workspaceId = user.workspaceId
  })

  after(async () => {
    await prisma.creativeExperiment.deleteMany({ where: { workspaceId } })
    await prisma.user.deleteMany({ where: { workspaceId } })
    await prisma.workspace.deleteMany({ where: { id: workspaceId } })
    await prisma.$disconnect()
  })

  test('epsilon=0 sempre aproveita (exploit) a variante com melhor taxa observada', () => {
    const statsA = { samples: 100, conversions: 60, commissionTotal: 0 }
    const statsB = { samples: 100, conversions: 10, commissionTotal: 0 }
    const decisao = decidirVarianteEpsilonGreedy(statsA, statsB, 0, () => 0.99)
    assert.equal(decisao.variant, 'A')
  })

  test('atribuição real persiste no Postgres (assignments[] cresce a cada chamada)', async () => {
    const exp = await criarExperimento(workspaceId, { name: 'Teste', dimension: 'cta', variantA: { cta: 'CONFIRA_LINK' }, variantB: { cta: 'SAIBA_MAIS' } })
    await atribuirVariante(workspaceId, exp.id, 'entidade-1')
    await atribuirVariante(workspaceId, exp.id, 'entidade-2')
    const atualizado = await prisma.creativeExperiment.findUnique({ where: { id: exp.id } })
    assert.equal(atualizado?.assignments.length, 2)
  })

  test('experimento concluído com dados suficientes declara vencedor real', async () => {
    const exp = await criarExperimento(workspaceId, { name: 'Teste 2', dimension: 'hook', variantA: {}, variantB: {} })
    for (let i = 0; i < 25; i++) await registrarResultadoExperimento(workspaceId, exp.id, 'A', { converted: true })
    for (let i = 0; i < 25; i++) await registrarResultadoExperimento(workspaceId, exp.id, 'B', { converted: false })
    const conclusao = await concluirExperimento(workspaceId, exp.id)
    assert.equal(conclusao.winner, 'A')
  })

  test('nunca atribui variante em experimento já CONCLUDED', async () => {
    const exp = await criarExperimento(workspaceId, { name: 'Teste 3', dimension: 'hook', variantA: {}, variantB: {} })
    await concluirExperimento(workspaceId, exp.id)
    await assert.rejects(() => atribuirVariante(workspaceId, exp.id))
  })
})

// ── Digital Twin: identidade NUNCA alterada pelo ML + sem dado biométrico ─

describe('Digital Twin — ML nunca altera identidade, nunca usa dado biométrico bruto', () => {
  test('aprenderApresentacaoDigitalTwin nunca retorna campo de identidade (rosto/voz/referência)', async () => {
    const { user } = await criarUsuarioComWorkspace(prisma, { email: `ml-dt-${randomUUID()}@t.com`, password: 'x' })
    const sugestao = await aprenderApresentacaoDigitalTwin(user.workspaceId)
    const chaves = Object.keys(sugestao)
    assert.ok(!chaves.some((c) => /face|rosto|voice|voz|identity|biometr/i.test(c)))
    await prisma.user.deleteMany({ where: { workspaceId: user.workspaceId } })
    await prisma.workspace.deleteMany({ where: { id: user.workspaceId } })
  })

  test('nuncaAlterarIdentidade lança erro se um campo de identidade aparecer numa sugestão', () => {
    assert.throws(() => nuncaAlterarIdentidade({ duration: 20, faceImageUrl: 'x' }))
    assert.throws(() => nuncaAlterarIdentidade({ voiceProfileId: 'x' }))
    assert.doesNotThrow(() => nuncaAlterarIdentidade({ idealSpeechDurationSeconds: 20, captionPosition: 'bottom' }))
  })

  test('verificarSemDadosBiometricos bloqueia áudio/rosto bruto num objeto de feature de performance', () => {
    assert.throws(() => verificarSemDadosBiometricos({ referenceAudio: 'x' }))
    assert.throws(() => verificarSemDadosBiometricos({ faceImage: 'x' }))
    assert.doesNotThrow(() => verificarSemDadosBiometricos({ video_duration: 20, channel: 'tiktok' } as unknown as Record<string, unknown>))
  })

  test('salvarFeatureSnapshot recusa persistir um objeto de features com campo biométrico (defesa em profundidade)', async () => {
    const { user } = await criarUsuarioComWorkspace(prisma, { email: `ml-dt2-${randomUUID()}@t.com`, password: 'x' })
    const featuresContaminadas = { product_price_bucket: 'MID', referenceAudio: 'nao-deveria-estar-aqui' } as unknown as ContentMLFeatures
    await assert.rejects(() => salvarFeatureSnapshot(user.workspaceId, 'Conteudo', 'x', featuresContaminadas, 'TEST_FIXTURE'))
    await prisma.user.deleteMany({ where: { workspaceId: user.workspaceId } })
    await prisma.workspace.deleteMany({ where: { id: user.workspaceId } })
  })
})
