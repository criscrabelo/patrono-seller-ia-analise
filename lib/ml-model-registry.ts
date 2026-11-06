/**
 * MLModelRegistry (Rodada 9, complemento ML, regras 28-29, 33-34) —
 * CANDIDATE → VALIDATED → ACTIVE → DEPRECATED/ROLLED_BACK. Nenhum modelo
 * vira ACTIVE sem passar pelo `ModelPromotionGate` (precisa superar o
 * baseline determinístico por uma margem mínima — nunca por empate/ruído).
 * Rollback sempre disponível: o Patrono nunca fica dependente de um
 * modelo quebrado (regra 34).
 */

import { prisma } from './prisma'

export interface ModelPromotionDecision {
  aprovado: boolean
  motivo: string
}

/** Margem mínima de ROC-AUC acima do baseline — documentada, nunca escondida. */
export const MARGEM_MINIMA_AUC = 0.02

interface MetricasComAuc {
  rocAuc?: number | null
  [k: string]: unknown
}

/** Função pura — o Promotion Gate nunca acessa o banco, só compara os números já calculados no treinamento. */
export function avaliarPromocaoModelo(candidato: { metrics: MetricasComAuc | null; baselineMetrics: MetricasComAuc | null }): ModelPromotionDecision {
  const aucCandidato = candidato.metrics?.rocAuc
  const aucBaseline = candidato.baselineMetrics?.rocAuc

  if (typeof aucCandidato !== 'number') {
    return { aprovado: false, motivo: 'Modelo candidato não tem ROC-AUC calculável (provavelmente uma classe só na validação) — nunca promovido sem essa checagem.' }
  }
  if (typeof aucBaseline !== 'number') {
    return { aprovado: false, motivo: 'Baseline não tem ROC-AUC calculável para comparação — promoção bloqueada até isso ser possível.' }
  }
  if (aucCandidato < aucBaseline + MARGEM_MINIMA_AUC) {
    return {
      aprovado: false,
      motivo: `ROC-AUC do candidato (${aucCandidato.toFixed(3)}) não supera o baseline (${aucBaseline.toFixed(3)}) pela margem mínima (${MARGEM_MINIMA_AUC}) — não promovido.`,
    }
  }
  return { aprovado: true, motivo: `ROC-AUC do candidato (${aucCandidato.toFixed(3)}) supera o baseline (${aucBaseline.toFixed(3)}) pela margem mínima — aprovado.` }
}

export interface ResultadoPromocao {
  promovido: boolean
  motivo: string
}

/**
 * Só promove CANDIDATE/VALIDATED → ACTIVE se `avaliarPromocaoModelo`
 * aprovar. Ao promover, o modelo ACTIVE anterior (se houver) vira
 * DEPRECATED — nunca dois modelos ACTIVE da mesma família ao mesmo tempo.
 */
export async function promoverModelo(workspaceId: string, modelId: string): Promise<ResultadoPromocao> {
  const modelo = await prisma.mLModel.findFirst({ where: { id: modelId, workspaceId } })
  if (!modelo) return { promovido: false, motivo: 'Modelo não encontrado neste workspace.' }
  if (modelo.status !== 'CANDIDATE' && modelo.status !== 'VALIDATED') {
    return { promovido: false, motivo: `Modelo está em status ${modelo.status} — só CANDIDATE/VALIDATED podem ser promovidos.` }
  }
  // Correção pós-aprovação do complemento ML (regra 3): um modelo treinado
  // com dado de teste/fixture/demo/seed NUNCA pode operar no workspace
  // real, mesmo que suas métricas superem o baseline. Só REAL_OPERATION.
  if (modelo.dataOrigin !== 'REAL_OPERATION') {
    return {
      promovido: false,
      motivo: `Modelo treinado com dataOrigin=${modelo.dataOrigin} — só um modelo treinado com dados REAL_OPERATION pode ser promovido a ACTIVE no workspace real.`,
    }
  }

  const decisao = avaliarPromocaoModelo({
    metrics: modelo.metrics as MetricasComAuc | null,
    baselineMetrics: modelo.baselineMetrics as MetricasComAuc | null,
  })
  if (!decisao.aprovado) return { promovido: false, motivo: decisao.motivo }

  await prisma.$transaction([
    prisma.mLModel.updateMany({
      where: { workspaceId, family: modelo.family, status: 'ACTIVE' },
      data: { status: 'DEPRECATED', deprecatedAt: new Date() },
    }),
    prisma.mLModel.update({ where: { id: modelo.id }, data: { status: 'ACTIVE', promotedAt: new Date() } }),
  ])

  return { promovido: true, motivo: decisao.motivo }
}

export interface ResultadoRollback {
  rolledBack: boolean
  novoAtivoId: string | null
  motivo: string
}

/**
 * Reverte o modelo ACTIVE atual. Se existir uma versão DEPRECATED
 * anterior, ela volta a ser ACTIVE; senão, nenhum modelo fica ACTIVE — o
 * Patrono volta sozinho ao baseline determinístico (RULE_BASED), nunca
 * trava esperando um modelo.
 */
export async function rollbackModelo(workspaceId: string, family: string): Promise<ResultadoRollback> {
  const ativo = await prisma.mLModel.findFirst({ where: { workspaceId, family, status: 'ACTIVE' } })
  if (!ativo) return { rolledBack: false, novoAtivoId: null, motivo: 'Nenhum modelo ACTIVE para reverter.' }

  const anterior = await prisma.mLModel.findFirst({
    where: { workspaceId, family, status: 'DEPRECATED', id: { not: ativo.id } },
    orderBy: { deprecatedAt: 'desc' },
  })

  await prisma.mLModel.update({ where: { id: ativo.id }, data: { status: 'ROLLED_BACK', rolledBackAt: new Date() } })

  if (anterior) {
    await prisma.mLModel.update({ where: { id: anterior.id }, data: { status: 'ACTIVE', promotedAt: new Date(), deprecatedAt: null } })
    return { rolledBack: true, novoAtivoId: anterior.id, motivo: `Revertido para a versão anterior (v${anterior.version}).` }
  }
  return { rolledBack: true, novoAtivoId: null, motivo: 'Revertido — nenhuma versão anterior disponível; o Patrono volta ao baseline determinístico (RULE_BASED).' }
}

export async function obterModeloAtivo(workspaceId: string, family: string) {
  return prisma.mLModel.findFirst({ where: { workspaceId, family, status: 'ACTIVE' } })
}

export async function listarModelos(workspaceId: string, family: string) {
  return prisma.mLModel.findMany({ where: { workspaceId, family }, orderBy: { version: 'desc' } })
}
