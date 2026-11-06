/**
 * Pipeline de treinamento (Rodada 9, complemento ML, regras 30-32, 41) —
 * junta o Feature Store, o Readiness Gate e o modelo (regressão
 * logística) num único fluxo: prepara dados → separa treino/validação
 * TEMPORALMENTE (nunca embaralha dados sequenciais, regra 30) → treina →
 * avalia contra um baseline determinístico → registra `MLTrainingRun` e,
 * se os dados forem suficientes, um `MLModel` `CANDIDATE`.
 *
 * NUNCA inventa dados: se `avaliarProntidaoMLDoWorkspace` não retornar
 * `READY_FOR_ML`, o treinamento não roda — devolve o motivo real.
 */

import { prisma } from './prisma'
import { avaliarProntidaoMLDoWorkspace, ORIGENS_PRODUCAO } from './ml-readiness-gate'
import { vetorizarFeatures, nomesDoVetorDeFeatures, treinarRegressaoLogistica, preverProbabilidade, calcularRocAuc, calcularPrecisionRecall, calcularCalibracao } from './ml-model'
import type { ContentMLFeatures } from './ml-feature-store'
import type { MLDataOrigin } from './ml-types'

/**
 * Reexportado de lib/ml-constantes.ts, onde a constante passou a morar.
 *
 * Quem so LE o modelo nao deve carregar quem TREINA: importar a
 * constante daqui arrastava este pipeline para o grafo do cron diario.
 */
export { CONVERSION_MODEL_FAMILY } from './ml-constantes'
import { CONVERSION_MODEL_FAMILY } from './ml-constantes'

export interface AmostraRotulada {
  features: ContentMLFeatures
  converted: boolean
  capturedAt: Date
}

async function carregarAmostrasRotuladas(workspaceId: string, origens: MLDataOrigin[], entityType: string = 'Conteudo'): Promise<AmostraRotulada[]> {
  const snapshots = await prisma.mLFeatureSnapshot.findMany({
    where: { workspaceId, entityType, labeledAt: { not: null }, dataOrigin: { in: origens } },
    orderBy: { capturedAt: 'asc' },
    select: { features: true, label: true, capturedAt: true },
  })
  return snapshots.map((s) => ({
    features: s.features as unknown as ContentMLFeatures,
    converted: (s.label as { converted?: boolean } | null)?.converted === true,
    capturedAt: s.capturedAt,
  }))
}

/** Baseline determinístico: prevê sempre a taxa média de conversão do conjunto de treino (RULE_BASED — não é ML). */
function preverBaselineConstante(taxaMedia: number, quantos: number): number[] {
  return new Array(quantos).fill(taxaMedia)
}

export type TrainingPipelineResultado =
  | { status: 'INSUFFICIENT_DATA'; motivo: string }
  | {
      status: 'COMPLETED'
      trainingRunId: string
      candidateModelId: string | null
      metrics: Record<string, unknown>
      baselineMetrics: Record<string, unknown>
      sampleCount: number
    }
  | { status: 'FAILED'; motivo: string; trainingRunId: string | null }

/**
 * Roda o pipeline completo para `workspaceId`. Sempre checa o Readiness
 * Gate primeiro — nunca treina com dados insuficientes.
 *
 * `origens` (correção pós-aprovação do complemento ML) define quais
 * `MLDataOrigin` alimentam o treinamento. O PADRÃO é `ORIGENS_PRODUCAO`
 * (só `REAL_OPERATION`) — este é o único caminho que produz um modelo
 * elegível para `ACTIVE` no workspace real (o "PRODUCTION_MODEL"). Um
 * valor diferente só existe para os TESTES do próprio motor de ML
 * validarem convergência/AUC/promoção/rollback contra dados de teste
 * controlados (o "TEST_MODEL") — nunca usado fora de teste. Exige
 * exatamente UMA origem por treinamento (nunca mistura), para que o
 * `dataOrigin` do modelo resultante seja sempre inequívoco.
 */
export async function treinarModeloConversao(workspaceId: string, origens: MLDataOrigin[] = ORIGENS_PRODUCAO): Promise<TrainingPipelineResultado> {
  if (origens.length !== 1) {
    return { status: 'FAILED', motivo: 'Um treinamento precisa de exatamente uma origem de dados (dataOrigin) — nunca misturar REAL_OPERATION com dados de teste.', trainingRunId: null }
  }
  const dataOrigin = origens[0]

  const prontidao = await avaliarProntidaoMLDoWorkspace(workspaceId, CONVERSION_MODEL_FAMILY, 'Conteudo', undefined, origens)
  if (prontidao.estado === 'INSUFFICIENT_DATA' || prontidao.estado === 'READY_FOR_STATISTICS') {
    return { status: 'INSUFFICIENT_DATA', motivo: prontidao.motivo }
  }

  const amostras = await carregarAmostrasRotuladas(workspaceId, origens)
  if (amostras.length === 0) {
    return { status: 'INSUFFICIENT_DATA', motivo: 'Nenhuma amostra rotulada encontrada.' }
  }

  const datasetVersion = `conteudo-${amostras.length}-${amostras[amostras.length - 1].capturedAt.toISOString()}`
  const featureNames = nomesDoVetorDeFeatures()

  const trainingRun = await prisma.mLTrainingRun.create({
    data: {
      workspaceId,
      modelFamily: CONVERSION_MODEL_FAMILY,
      datasetVersion,
      status: 'RUNNING',
      sampleCount: amostras.length,
      featureNames,
      dataOrigin,
    },
  })

  try {
    // Split TEMPORAL (regra 30): as amostras mais antigas treinam, as mais
    // recentes validam — nunca embaralhado, já que a ordem no tempo importa
    // (evita otimismo de validação cruzada aleatória em dados sequenciais).
    const corte = Math.floor(amostras.length * 0.8)
    const treino = amostras.slice(0, corte)
    const validacao = amostras.slice(corte)

    if (treino.length < 10 || validacao.length < 5) {
      await prisma.mLTrainingRun.update({ where: { id: trainingRun.id }, data: { status: 'FAILED', finishedAt: new Date(), notes: 'Split temporal ficou pequeno demais para treinar/validar com confiança.' } })
      return { status: 'FAILED', motivo: 'Split temporal ficou pequeno demais para treinar/validar com confiança.', trainingRunId: trainingRun.id }
    }

    const X_treino = treino.map((a) => vetorizarFeatures(a.features))
    const y_treino = treino.map((a) => (a.converted ? 1 : 0))
    const X_val = validacao.map((a) => vetorizarFeatures(a.features))
    const y_val = validacao.map((a) => (a.converted ? 1 : 0))

    const modelo = treinarRegressaoLogistica(X_treino, y_treino)
    const scoresVal = X_val.map((x) => preverProbabilidade(modelo, x))

    const metrics = {
      rocAuc: calcularRocAuc(scoresVal, y_val),
      precisionRecall: calcularPrecisionRecall(scoresVal, y_val),
      calibracao: calcularCalibracao(scoresVal, y_val),
      iteracoes: modelo.iteracoes,
      perdaFinal: modelo.perdaFinal,
    }

    // Baseline RULE_BASED: taxa média de conversão do treino, aplicada a todo mundo — nunca "aprende" nada.
    const taxaMediaTreino = y_treino.reduce((s: number, v) => s + v, 0) / y_treino.length
    const scoresBaseline = preverBaselineConstante(taxaMediaTreino, y_val.length)
    const baselineMetrics = {
      rocAuc: calcularRocAuc(scoresBaseline, y_val),
      precisionRecall: calcularPrecisionRecall(scoresBaseline, y_val),
      taxaMediaTreino,
    }

    await prisma.mLTrainingRun.update({
      where: { id: trainingRun.id },
      data: { status: 'COMPLETED', finishedAt: new Date(), metrics: metrics as never, baselineMetrics: baselineMetrics as never },
    })

    const ultimoModelo = await prisma.mLModel.findFirst({
      where: { workspaceId, family: CONVERSION_MODEL_FAMILY },
      orderBy: { version: 'desc' },
      select: { version: true },
    })
    const proximaVersao = (ultimoModelo?.version ?? 0) + 1

    const candidato = await prisma.mLModel.create({
      data: {
        workspaceId,
        family: CONVERSION_MODEL_FAMILY,
        modelType: 'LOGISTIC_REGRESSION',
        version: proximaVersao,
        trainingRunId: trainingRun.id,
        trainingDate: new Date(),
        trainingDatasetVersion: datasetVersion,
        features: featureNames,
        metrics: metrics as never,
        baselineMetrics: baselineMetrics as never,
        status: 'CANDIDATE',
        artifact: { pesos: modelo.pesos, bias: modelo.bias, padronizacao: modelo.padronizacao } as never,
        dataOrigin,
      },
    })

    return {
      status: 'COMPLETED',
      trainingRunId: trainingRun.id,
      candidateModelId: candidato.id,
      metrics,
      baselineMetrics,
      sampleCount: amostras.length,
    }
  } catch (e) {
    const motivo = e instanceof Error ? e.message : 'Falha desconhecida ao treinar.'
    await prisma.mLTrainingRun.update({ where: { id: trainingRun.id }, data: { status: 'FAILED', finishedAt: new Date(), notes: motivo } })
    return { status: 'FAILED', motivo, trainingRunId: trainingRun.id }
  }
}
