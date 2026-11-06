/**
 * P2.14.7 (Fase 0A) — Cost Governor.
 *
 * Camada ACIMA do `cost-safety-gate` (que continua soberano): uma operação
 * paga só é reservada se TODAS as barreiras passarem, nesta ordem:
 *   1. travas (kill switch / pausa / Safe Mode) — `avaliarAcao` bloqueia GASTAR;
 *   2. gate de ambiente: PAID_AI_ENABLED=true E AI_MONTHLY_BUDGET>0 (duas chaves);
 *   3. política versionada do workspace (orçamento mensal/diário, limite de
 *      aprovação) — padrão é ZERO;
 *   4. reserva atômica no CostLedger sob advisory lock por workspace.
 *
 * Idempotente por `chaveIdempotencia`: repetir a reserva devolve a mesma.
 * Ciclo: RESERVADO → CONFIRMADO (com custo real) | CANCELADO (somente com
 * prova de que não houve cobrança — mesma regra conservadora do P0.1).
 * BLOQUEADO também é gravado: tentativa negada fica auditável.
 */
import { prisma } from './prisma'
import { avaliarCusto, lerPoliticaDeCusto, type FonteDeEnv } from './cost-safety-gate'
import { avaliarAcao, politicaAtiva } from './politica'
import { estadoDeExecucao } from './kill-switch'
import { registrarEvento } from './ledger'
import { contextoAtual } from './observabilidade'

export type ResultadoDaReserva =
  | { status: 'RESERVADO'; id: string; repetida: boolean }
  | { status: 'EXIGE_APROVACAO'; motivos: string[] }
  | { status: 'BLOQUEADO'; id: string | null; motivos: string[] }

const CONTAM = ['RESERVADO', 'CONFIRMADO'] as const

function inicioDoMesUtc(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
}
function inicioDoDiaUtc(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

export async function reservarCusto(p: {
  workspaceId: string
  provider: string
  operacao: string
  estimadoCentavos: number
  chaveIdempotencia: string
  env?: FonteDeEnv
  agora?: Date
}): Promise<ResultadoDaReserva> {
  if (!Number.isInteger(p.estimadoCentavos) || p.estimadoCentavos <= 0) {
    // Custo desconhecido/zero numa operação paga é tratado como inválido, nunca como grátis.
    return { status: 'BLOQUEADO', id: null, motivos: ['Estimativa de custo ausente ou inválida.'] }
  }
  const env = p.env ?? process.env
  const agora = p.agora ?? new Date()

  const ja = await prisma.costLedger.findUnique({ where: { workspaceId_chaveIdempotencia: { workspaceId: p.workspaceId, chaveIdempotencia: p.chaveIdempotencia } } })
  if (ja) return ja.status === 'BLOQUEADO' ? { status: 'BLOQUEADO', id: ja.id, motivos: [ja.motivo ?? 'bloqueado'] } : { status: 'RESERVADO', id: ja.id, repetida: true }

  const [politica, seguranca] = await Promise.all([politicaAtiva(p.workspaceId), estadoDeExecucao(p.workspaceId, env)])

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS ok FROM pg_advisory_xact_lock(hashtextextended(${`custo:${p.workspaceId}`}, 0))`
    const repetida = await tx.costLedger.findUnique({ where: { workspaceId_chaveIdempotencia: { workspaceId: p.workspaceId, chaveIdempotencia: p.chaveIdempotencia } } })
    if (repetida) return repetida.status === 'BLOQUEADO' ? { status: 'BLOQUEADO' as const, id: repetida.id, motivos: [repetida.motivo ?? 'bloqueado'] } : { status: 'RESERVADO' as const, id: repetida.id, repetida: true }

    const somar = async (desde: Date) =>
      (await tx.costLedger.aggregate({ where: { workspaceId: p.workspaceId, status: { in: [...CONTAM] }, criadoEm: { gte: desde } }, _sum: { estimadoCentavos: true } }))._sum.estimadoCentavos ?? 0
    const [noMes, noDia] = await Promise.all([somar(inicioDoMesUtc(agora)), somar(inicioDoDiaUtc(agora))])

    const motivos: string[] = []
    const gate = avaliarCusto({ provider: p.provider, operacao: p.operacao, workspaceId: p.workspaceId, custoEstimado: p.estimadoCentavos / 100, gastoAcumulado: noMes / 100, politica: lerPoliticaDeCusto(env) })
    if (!gate.permitido) motivos.push(gate.explicacao)
    const pol = avaliarAcao(politica.regras, { tipo: 'GASTAR', centavos: p.estimadoCentavos, gastoNoMesCentavos: noMes, gastoNoDiaCentavos: noDia }, seguranca)
    if (pol.resultado === 'BLOQUEAR') motivos.push(...pol.motivos)

    const correlationId = contextoAtual()?.correlationId ?? null
    if (motivos.length) {
      const linha = await tx.costLedger.create({
        data: { workspaceId: p.workspaceId, operacao: p.operacao, provider: p.provider, estimadoCentavos: p.estimadoCentavos, status: 'BLOQUEADO', motivo: motivos.join(' | ').slice(0, 1000), correlationId, chaveIdempotencia: p.chaveIdempotencia },
      })
      await registrarEvento({ workspaceId: p.workspaceId, tipo: 'COST_BLOCKED', chaveIdempotencia: `custo:${p.chaveIdempotencia}`, entidadeTipo: 'CostLedger', entidadeId: linha.id, payload: { provider: p.provider, operacao: p.operacao, centavos: p.estimadoCentavos, politicaVersao: politica.versao } }, tx)
      return { status: 'BLOQUEADO' as const, id: linha.id, motivos }
    }
    if (pol.resultado === 'EXIGIR_APROVACAO') return { status: 'EXIGE_APROVACAO' as const, motivos: pol.motivos }

    const linha = await tx.costLedger.create({
      data: { workspaceId: p.workspaceId, operacao: p.operacao, provider: p.provider, estimadoCentavos: p.estimadoCentavos, status: 'RESERVADO', correlationId, chaveIdempotencia: p.chaveIdempotencia },
    })
    await registrarEvento({ workspaceId: p.workspaceId, tipo: 'COST_RESERVED', chaveIdempotencia: `custo:${p.chaveIdempotencia}`, entidadeTipo: 'CostLedger', entidadeId: linha.id, payload: { provider: p.provider, operacao: p.operacao, centavos: p.estimadoCentavos, politicaVersao: politica.versao } }, tx)
    return { status: 'RESERVADO' as const, id: linha.id, repetida: false }
  })
}

/** Confirma com o custo real conhecido. Só sai de RESERVADO. */
export async function confirmarCusto(p: { workspaceId: string; id: string; realCentavos: number }) {
  if (!Number.isInteger(p.realCentavos) || p.realCentavos < 0) throw new Error('Custo real inválido.')
  const r = await prisma.costLedger.updateMany({ where: { id: p.id, workspaceId: p.workspaceId, status: 'RESERVADO' }, data: { status: 'CONFIRMADO', realCentavos: p.realCentavos } })
  return r.count === 1
}

/**
 * Cancela a reserva SOMENTE com prova de que o fornecedor não cobrou
 * (ex.: recusa antes de iniciar o trabalho). Erro HTTP genérico NÃO é prova.
 */
export async function cancelarReserva(p: { workspaceId: string; id: string; provaDeNaoCobranca: string }) {
  if (!p.provaDeNaoCobranca.trim()) throw new Error('Cancelar reserva exige prova de não cobrança.')
  const r = await prisma.costLedger.updateMany({ where: { id: p.id, workspaceId: p.workspaceId, status: 'RESERVADO' }, data: { status: 'CANCELADO', motivo: p.provaDeNaoCobranca.slice(0, 1000) } })
  return r.count === 1
}
