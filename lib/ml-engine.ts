/**
 * PatronoMLEngine (Rodada 9, complemento ML, regras 2, 43-44) — ponto
 * único que o Autopilot consulta para obter uma previsão de conversão por
 * oportunidade. Consulta o Readiness Gate primeiro: só usa o modelo
 * ACTIVE quando `MODEL_ACTIVE`; caso contrário cai para o fallback
 * RULE_BASED (usa `historicalConversionRate` já presente na oportunidade,
 * quando informado — nunca inventa).
 *
 * REGRA 44 (fail-safe): qualquer erro (modelo corrompido, artifact
 * inválido, biblioteca faltando) cai para o fallback RULE_BASED — o
 * Autopilot NUNCA trava por causa do ML.
 *
 * Limitação real e documentada: uma `AffiliateOpportunity` ainda não tem
 * roteiro/CTA/duração/horário de publicação (isso só existe depois que o
 * Creative Factory gera o conteúdo) — a previsão nesta etapa usa um vetor
 * de features PARCIAL, com os campos ainda desconhecidos marcados como
 * "missing" (nunca um valor inventado). Ver MACHINE-LEARNING.md.
 */

import type { AffiliateOpportunity } from './affiliate-discovery'
import { prisma } from './prisma'
import type { MLDecisionType } from './ml-types'
import { avaliarProntidaoMLDoWorkspace } from './ml-readiness-gate'
import { CONVERSION_MODEL_FAMILY } from './ml-constantes'
import { obterModeloAtivo } from './ml-model-registry'
import { bucketPreco, type ContentMLFeatures } from './ml-feature-store'
import { vetorizarFeatures, preverProbabilidade, type Padronizacao } from './ml-model'
import { registrarAuditoriaML } from './ml-audit'

export interface OpportunityMLPrediction {
  opportunityKey: string
  predictedConversionProbability: number | null
  expectedCommissionValue: number | null
  decisionType: MLDecisionType
  modelFamily: string | null
  modelVersion: number | null
}

export function chaveOportunidade(op: Pick<AffiliateOpportunity, 'providerId' | 'productName'>): string {
  return `${op.providerId}:${op.productName}`
}

/** Features conhecidas no momento da PONTUAÇÃO DA OPORTUNIDADE (antes do conteúdo existir) — nunca inventa o que ainda não existe. */
function construirFeaturesParciais(op: AffiliateOpportunity): ContentMLFeatures {
  return {
    product_price_bucket: bucketPreco(op.price ?? null),
    commission_percentage: op.commissionPercent ?? null,
    video_duration: null,
    hook_type: 'NAO_CLASSIFICADO',
    cta_type: 'NAO_CLASSIFICADO',
    posting_hour: null,
    avatar_style: null,
    channel: op.channelFit?.[0] ?? null,
    product_category: op.category,
    historical_conversion_rate: op.historicalConversionRate ?? null,
  }
}

interface ModelArtifact {
  pesos: number[]
  bias: number
  padronizacao: Padronizacao
}

async function preverUmaOportunidade(
  workspaceId: string,
  op: AffiliateOpportunity,
  modeloAtivo: { id: string; family: string; version: number; artifact: unknown } | null
): Promise<OpportunityMLPrediction> {
  if (modeloAtivo?.artifact) {
    try {
      const artifact = modeloAtivo.artifact as ModelArtifact
      const features = construirFeaturesParciais(op)
      const vetor = vetorizarFeatures(features)
      const prob = preverProbabilidade({ pesos: artifact.pesos, bias: artifact.bias, padronizacao: artifact.padronizacao, iteracoes: 0, perdaFinal: 0 }, vetor)
      // Nunca aceita um resultado numericamente inválido como previsão real
      // (ex.: artifact com dimensão diferente do vetor de features atual
      // produziria NaN silenciosamente, sem lançar exceção) — regra 44
      // cobre não só falha explícita, mas também saída numérica corrompida.
      if (!Number.isFinite(prob) || prob < 0 || prob > 1) {
        throw new Error(`Previsão numericamente inválida (${prob}) — artifact do modelo pode estar dessincronizado do vetor de features atual.`)
      }
      const comissaoEsperada = op.estimatedCommissionBRL != null ? prob * op.estimatedCommissionBRL : null
      return {
        opportunityKey: chaveOportunidade(op),
        predictedConversionProbability: prob,
        expectedCommissionValue: comissaoEsperada,
        decisionType: 'MACHINE_LEARNING',
        modelFamily: modeloAtivo.family,
        modelVersion: modeloAtivo.version,
      }
    } catch {
      // Regra 44: modelo quebrado nunca bloqueia — cai para o fallback abaixo.
    }
  }

  const prob = op.historicalConversionRate ?? null
  const comissaoEsperada = prob != null && op.estimatedCommissionBRL != null ? prob * op.estimatedCommissionBRL : null
  return {
    opportunityKey: chaveOportunidade(op),
    predictedConversionProbability: prob,
    expectedCommissionValue: comissaoEsperada,
    decisionType: 'RULE_BASED',
    modelFamily: null,
    modelVersion: null,
  }
}

/**
 * Previsão em lote para o Autopilot. Nunca lança — qualquer falha interna
 * já é tratada por oportunidade em `preverUmaOportunidade`. Persiste cada
 * previsão (`MLPrediction`) e um log de auditoria (regra 37).
 */
export async function preverOportunidades(workspaceId: string, candidatos: AffiliateOpportunity[]): Promise<OpportunityMLPrediction[]> {
  if (candidatos.length === 0) return []

  let modeloAtivo: { id: string; family: string; version: number; artifact: unknown } | null = null
  try {
    const prontidao = await avaliarProntidaoMLDoWorkspace(workspaceId, CONVERSION_MODEL_FAMILY)
    if (prontidao.estado === 'MODEL_ACTIVE') {
      modeloAtivo = await obterModeloAtivo(workspaceId, CONVERSION_MODEL_FAMILY)
    }
  } catch {
    modeloAtivo = null // regra 44: falha ao consultar prontidão/modelo nunca impede o fallback
  }

  const resultados: OpportunityMLPrediction[] = []
  for (const op of candidatos) {
    const predicao = await preverUmaOportunidade(workspaceId, op, modeloAtivo)
    resultados.push(predicao)

    await prisma.mLPrediction
      .create({
        data: {
          workspaceId,
          modelRowId: modeloAtivo?.id ?? null,
          modelFamily: predicao.modelFamily,
          modelVersion: predicao.modelVersion,
          decisionType: predicao.decisionType,
          entityType: 'AffiliateOpportunity',
          entityId: null,
          inputFeatures: { providerId: op.providerId, productName: op.productName, category: op.category } as never,
          predictedConversionProbability: predicao.predictedConversionProbability,
          expectedCommissionValue: predicao.expectedCommissionValue,
        },
      })
      .catch(() => {}) // nunca deixa falha de persistência quebrar a previsão em si (mesmo padrão de registrarAuditoria)

    await registrarAuditoriaML(workspaceId, {
      action: 'ml.opportunity_prediction',
      entityId: predicao.opportunityKey,
      metadata: {
        decisionType: predicao.decisionType,
        modelFamily: predicao.modelFamily,
        modelVersion: predicao.modelVersion,
        predictedConversionProbability: predicao.predictedConversionProbability,
        expectedCommissionValue: predicao.expectedCommissionValue,
      },
    })
  }

  return resultados
}

/**
 * Implementação concreta para injeção em `AutopilotDeps.mlEngine`
 * (lib/autopilot.ts) — estruturalmente compatível com `MLPredictionSource`
 * sem precisar importar o tipo daqui (evita import circular).
 */
export const patronoMLEngine = { preverOportunidades }
