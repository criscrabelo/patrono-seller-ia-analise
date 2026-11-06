/**
 * MLReadinessGate (Rodada 9, complemento ML, regras 3, 8, 41) — nunca
 * força Machine Learning com meia dúzia de publicações. A escada de
 * maturidade é sempre avaliada a partir de dados REAIS já rotulados
 * (`MLFeatureSnapshot.labeledAt != null`) — nunca de dados inventados.
 *
 * COLD START → RULE_BASED → STATISTICAL_LEARNING → MACHINE_LEARNING →
 * CONTINUOUS LEARNING (regra 3), mapeado nos 4 estados de
 * `MLReadinessState` (lib/ml-types.ts).
 *
 * Correção pós-aprovação do complemento ML: a prontidão de PRODUÇÃO só
 * conta amostras com `dataOrigin = REAL_OPERATION`. 250 registros
 * `TEST_FIXTURE`/`DEMO`/`SEED`/`SYNTHETIC_TEST` mais 3 publicações reais
 * NUNCA resulta em `READY_FOR_ML` — resulta em `INSUFFICIENT_DATA`, porque
 * só 3 amostras reais existem. `contarAmostrasRotuladas`/
 * `avaliarProntidaoMLDoWorkspace` aceitam um parâmetro `origens` só para
 * permitir que os PRÓPRIOS TESTES do motor de ML validem o gate contra
 * dados de teste — o padrão (nunca sobrescrito em produção) é sempre
 * `['REAL_OPERATION']`.
 */

import { prisma } from './prisma'
import type { MLReadinessState, MLDataOrigin } from './ml-types'

/** Único conjunto de origem que conta para prontidão de PRODUÇÃO — nunca alterado silenciosamente. */
export const ORIGENS_PRODUCAO: MLDataOrigin[] = ['REAL_OPERATION']

export interface LimiaresProntidaoML {
  minimoParaEstatistica: number
  minimoParaML: number
  minimoPositivosParaML: number
}

/**
 * Limiares documentados e ajustáveis (nunca escondidos): um workspace
 * novo do Patrono Seller começa em zero publicações — é esperado (e
 * correto) que a maioria comece em INSUFFICIENT_DATA por um bom tempo.
 */
export const LIMIARES_PRONTIDAO_PADRAO: LimiaresProntidaoML = {
  minimoParaEstatistica: 30,
  minimoParaML: 200,
  minimoPositivosParaML: 20,
}

export interface MLReadinessInput {
  labeledSampleCount: number
  positiveSampleCount: number
  hasActiveModel: boolean
}

export interface MLReadinessResultado {
  estado: MLReadinessState
  motivo: string
  amostrasRotuladas: number
  amostrasPositivas: number
}

/** Função pura — nunca acessa banco, só decide a partir dos números já apurados. */
export function avaliarProntidaoML(input: MLReadinessInput, limiares: LimiaresProntidaoML = LIMIARES_PRONTIDAO_PADRAO): MLReadinessResultado {
  const base = { amostrasRotuladas: input.labeledSampleCount, amostrasPositivas: input.positiveSampleCount }

  if (input.hasActiveModel) {
    return { ...base, estado: 'MODEL_ACTIVE', motivo: 'Já existe um MLModel ACTIVE para este workspace/família.' }
  }

  if (input.labeledSampleCount < limiares.minimoParaEstatistica) {
    return {
      ...base,
      estado: 'INSUFFICIENT_DATA',
      motivo: `Apenas ${input.labeledSampleCount} amostra(s) rotulada(s) — mínimo de ${limiares.minimoParaEstatistica} para estatística simples confiável.`,
    }
  }

  if (input.labeledSampleCount < limiares.minimoParaML || input.positiveSampleCount < limiares.minimoPositivosParaML) {
    return {
      ...base,
      estado: 'READY_FOR_STATISTICS',
      motivo: `${input.labeledSampleCount} amostra(s) rotulada(s) (${input.positiveSampleCount} positiva(s)) — suficiente para médias/taxas por grupo, mas abaixo do mínimo para treinar um modelo (${limiares.minimoParaML} amostras / ${limiares.minimoPositivosParaML} positivas).`,
    }
  }

  return {
    ...base,
    estado: 'READY_FOR_ML',
    motivo: `${input.labeledSampleCount} amostra(s) rotulada(s) (${input.positiveSampleCount} positiva(s)) — dados suficientes para treinar um primeiro modelo real.`,
  }
}

/**
 * Conta amostras rotuladas reais de um workspace — nunca inventa
 * contagem. `origens` filtra por `MLDataOrigin`; o padrão (`ORIGENS_PRODUCAO`
 * = só `REAL_OPERATION`) é o que qualquer chamada de produção deve usar.
 * Um valor diferente só existe para os testes do próprio motor de ML
 * validarem o gate contra dados de teste conhecidos.
 */
export async function contarAmostrasRotuladas(
  workspaceId: string,
  entityType: string = 'Conteudo',
  origens: MLDataOrigin[] = ORIGENS_PRODUCAO,
  /**
   * Geracao a contar. Quando informada, a contagem fica PRESA a ela.
   *
   * Existe porque `entityType` sozinho deixou de separar as geracoes com
   * seguranca: hoje 'Conteudo' e 'Publicacao' ja se distinguem, mas a
   * proxima troca de features dentro da MESMA entidade somaria duas
   * geracoes em silencio — e prontidao somada e prontidao falsa.
   */
  featureVersion?: string
): Promise<{ total: number; positivas: number }> {
  const snapshots = await prisma.mLFeatureSnapshot.findMany({
    where: {
      workspaceId,
      entityType,
      labeledAt: { not: null },
      dataOrigin: { in: origens },
      ...(featureVersion ? { featureVersion } : {}),
    },
    select: { label: true },
  })
  const total = snapshots.length
  const positivas = snapshots.filter((s) => (s.label as { converted?: boolean } | null)?.converted === true).length
  return { total, positivas }
}

export async function avaliarProntidaoMLDoWorkspace(
  workspaceId: string,
  family: string,
  entityType: string = 'Conteudo',
  limiares: LimiaresProntidaoML = LIMIARES_PRONTIDAO_PADRAO,
  origens: MLDataOrigin[] = ORIGENS_PRODUCAO,
  featureVersion?: string
): Promise<MLReadinessResultado> {
  // Um modelo ACTIVE só existe se `promoverModelo()` já confirmou
  // dataOrigin=REAL_OPERATION (lib/ml-model-registry.ts) — não precisa
  // refiltrar aqui, mas nunca assume isso sem essa garantia upstream.
  const hasActiveModel = (await prisma.mLModel.count({ where: { workspaceId, family, status: 'ACTIVE' } })) > 0
  const { total, positivas } = await contarAmostrasRotuladas(workspaceId, entityType, origens, featureVersion)
  return avaliarProntidaoML({ labeledSampleCount: total, positiveSampleCount: positivas, hasActiveModel }, limiares)
}

/**
 * Prontidão da geração `publication_v1` (P1.0 — Etapa 2.d).
 *
 * Conta SOMENTE positivos e negativos REAL_OPERATION de `Publicacao` nesta
 * featureVersion. As amostras antigas de `Conteudo` continuam contando na
 * geração delas e NUNCA entram aqui.
 *
 * Os limiares são os mesmos — trocar a unidade de observação não é motivo
 * para afrouxar o portão. A consequência honesta é que o relógio recomeça:
 * a geração nova começa do zero e precisa acumular sozinha.
 *
 * NÃO ativa treino, NÃO promove modelo, NÃO tira do shadow mode.
 */
export async function avaliarProntidaoDaGeracaoPublicacao(
  workspaceId: string,
  family: string,
  limiares: LimiaresProntidaoML = LIMIARES_PRONTIDAO_PADRAO,
  origens: MLDataOrigin[] = ORIGENS_PRODUCAO
): Promise<MLReadinessResultado> {
  const { ENTIDADE_PUBLICACAO, FEATURE_VERSION_PUBLICACAO } = await import('./ml-geracao-publicacao')
  return avaliarProntidaoMLDoWorkspace(
    workspaceId,
    family,
    ENTIDADE_PUBLICACAO,
    limiares,
    origens,
    FEATURE_VERSION_PUBLICACAO
  )
}
