/**
 * CreativeExperiment — teste A/B de criativo (Rodada 9, complemento ML,
 * regras 23-25). Estratégia de atribuição SIMPLES, AUDITÁVEL e GRATUITA:
 * epsilon-greedy (nunca publica só a variante vencedora de sempre —
 * reserva uma fração `epsilon` das vezes para continuar testando/
 * explorando). Sem serviço externo, sem biblioteca nova.
 */

import { prisma } from './prisma'

export interface VariantStats {
  samples: number
  conversions: number
  commissionTotal: number
}

const STATS_VAZIAS: VariantStats = { samples: 0, conversions: 0, commissionTotal: 0 }

export async function criarExperimento(
  workspaceId: string,
  params: { name: string; dimension: string; variantA: unknown; variantB: unknown; epsilon?: number }
) {
  return prisma.creativeExperiment.create({
    data: {
      workspaceId,
      name: params.name,
      dimension: params.dimension,
      variantA: params.variantA as never,
      variantB: params.variantB as never,
      epsilon: params.epsilon ?? 0.1,
      resultsA: STATS_VAZIAS as never,
      resultsB: STATS_VAZIAS as never,
    },
  })
}

export interface AtribuicaoVariante {
  variant: 'A' | 'B'
  motivo: string
}

/**
 * Epsilon-greedy (regra 25) — função pura, testável sem banco. Com
 * probabilidade `epsilon`, explora (variante aleatória); senão, aproveita
 * (escolhe a variante com melhor taxa de conversão OBSERVADA até agora).
 */
export function decidirVarianteEpsilonGreedy(
  statsA: VariantStats,
  statsB: VariantStats,
  epsilon: number,
  aleatorio: () => number = Math.random
): AtribuicaoVariante {
  if (aleatorio() < epsilon) {
    const variant = aleatorio() < 0.5 ? 'A' : 'B'
    return { variant, motivo: `Exploração (epsilon=${epsilon}) — variante escolhida aleatoriamente para continuar testando.` }
  }

  const taxaA = statsA.samples > 0 ? statsA.conversions / statsA.samples : null
  const taxaB = statsB.samples > 0 ? statsB.conversions / statsB.samples : null

  if (taxaA == null && taxaB == null) {
    const variant = aleatorio() < 0.5 ? 'A' : 'B'
    return { variant, motivo: 'Nenhuma variante tem dados ainda — escolha aleatória inicial (cold start do experimento).' }
  }
  if (taxaA == null) return { variant: 'B', motivo: 'Variante A ainda sem dados — usando B (única com histórico).' }
  if (taxaB == null) return { variant: 'A', motivo: 'Variante B ainda sem dados — usando A (única com histórico).' }

  const variant = taxaA >= taxaB ? 'A' : 'B'
  return {
    variant,
    motivo: `Aproveitamento (epsilon=${epsilon}) — A=${taxaA.toFixed(3)} B=${taxaB.toFixed(3)}, escolhida a de melhor taxa observada.`,
  }
}

export async function atribuirVariante(workspaceId: string, experimentId: string, entityId?: string): Promise<AtribuicaoVariante> {
  const exp = await prisma.creativeExperiment.findFirst({ where: { id: experimentId, workspaceId } })
  if (!exp) throw new Error('Experimento não encontrado neste workspace.')
  if (exp.status !== 'RUNNING') throw new Error(`Experimento está ${exp.status} — só experimentos RUNNING recebem novas atribuições.`)

  const statsA = (exp.resultsA as unknown as VariantStats) ?? STATS_VAZIAS
  const statsB = (exp.resultsB as unknown as VariantStats) ?? STATS_VAZIAS
  const decisao = decidirVarianteEpsilonGreedy(statsA, statsB, exp.epsilon)

  const registroAtribuicao = { variant: decisao.variant, entityId: entityId ?? null, assignedAt: new Date().toISOString() }
  await prisma.creativeExperiment.update({
    where: { id: exp.id },
    data: { assignments: { push: registroAtribuicao as never } },
  })

  return decisao
}

export async function registrarResultadoExperimento(
  workspaceId: string,
  experimentId: string,
  variant: 'A' | 'B',
  outcome: { converted: boolean; commissionValue?: number }
): Promise<VariantStats> {
  const exp = await prisma.creativeExperiment.findFirst({ where: { id: experimentId, workspaceId } })
  if (!exp) throw new Error('Experimento não encontrado neste workspace.')

  const statsAtuais = ((variant === 'A' ? exp.resultsA : exp.resultsB) as unknown as VariantStats) ?? STATS_VAZIAS
  const novasStats: VariantStats = {
    samples: statsAtuais.samples + 1,
    conversions: statsAtuais.conversions + (outcome.converted ? 1 : 0),
    commissionTotal: statsAtuais.commissionTotal + (outcome.commissionValue ?? 0),
  }

  const campo = variant === 'A' ? 'resultsA' : 'resultsB'
  await prisma.creativeExperiment.update({ where: { id: exp.id }, data: { [campo]: novasStats as never } })
  return novasStats
}

/** Amostras mínimas por variante antes de declarar um vencedor — nunca conclui de poucos dados (mesmo espírito da regra 8). */
export const MINIMO_AMOSTRAS_PARA_VENCEDOR = 20

export interface ResultadoConclusao {
  winner: 'A' | 'B' | null
  statsA: VariantStats
  statsB: VariantStats
  motivo: string
}

export async function concluirExperimento(workspaceId: string, experimentId: string): Promise<ResultadoConclusao> {
  const exp = await prisma.creativeExperiment.findFirst({ where: { id: experimentId, workspaceId } })
  if (!exp) throw new Error('Experimento não encontrado neste workspace.')

  const statsA = (exp.resultsA as unknown as VariantStats) ?? STATS_VAZIAS
  const statsB = (exp.resultsB as unknown as VariantStats) ?? STATS_VAZIAS

  let winner: 'A' | 'B' | null = null
  let motivo: string
  if (statsA.samples < MINIMO_AMOSTRAS_PARA_VENCEDOR || statsB.samples < MINIMO_AMOSTRAS_PARA_VENCEDOR) {
    motivo = `Amostras insuficientes para declarar vencedor (mínimo ${MINIMO_AMOSTRAS_PARA_VENCEDOR} por variante) — A=${statsA.samples}, B=${statsB.samples}.`
  } else {
    const taxaA = statsA.conversions / statsA.samples
    const taxaB = statsB.conversions / statsB.samples
    if (taxaA === taxaB) {
      motivo = `Empate técnico (A=${taxaA.toFixed(3)}, B=${taxaB.toFixed(3)}) — nenhuma variante declarada vencedora.`
    } else {
      winner = taxaA > taxaB ? 'A' : 'B'
      motivo = `Variante ${winner} venceu (A=${taxaA.toFixed(3)}, B=${taxaB.toFixed(3)}).`
    }
  }

  await prisma.creativeExperiment.update({ where: { id: exp.id }, data: { status: 'CONCLUDED', winner, concludedAt: new Date() } })
  return { winner, statsA, statsB, motivo }
}
