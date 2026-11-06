/**
 * Reserva ATÔMICA de orçamento (revisão final do P0.1).
 *
 * Separado de `cost-safety-gate.ts` para manter aquele módulo com as decisões
 * puras e testáveis sem banco. Aqui mora o que precisa de Postgres.
 *
 * ── POR QUE ATÔMICA ─────────────────────────────────────────────────────
 * Havia corrida real: duas chamadas leem R$ 90 de um teto de R$ 100, cada
 * uma reserva R$ 8, e o mês fecha em R$ 106. Com o Revenue Autopilot
 * disparando em paralelo, isso deixa de ser hipótese e vira rotina.
 *
 * Ler o gasto, conferir o saldo e gravar a reserva acontecem dentro de UMA
 * transação, protegida por `pg_advisory_xact_lock` na chave
 * (workspaceId + mês). O lock é por workspace: negócios diferentes nunca se
 * bloqueiam. Sem migration — o lock é do próprio Postgres e o `AuditLog` já
 * existe com índice em `[workspaceId, createdAt]`.
 *
 * ── RESERVA NÃO É GASTO REAL ────────────────────────────────────────────
 * O que somamos é `custoReservado`: o teto conservador separado ANTES da
 * chamada. NÃO é o valor faturado pelo fornecedor, que só se conhece depois
 * — e às vezes nunca, por API. Para um teto de segurança isso é o correto:
 * erra para o lado de gastar menos. Mas não pode ser apresentado como
 * despesa contábil. Quando o Motor Financeiro existir, `custoReal` será
 * campo próprio, conciliado com a fatura.
 *
 * ── MELHORIA FUTURA (registrada, NÃO implementada) ──────────────────────
 * Hoje uma reserva autorizada nunca é desfeita: ela consome orçamento do mês
 * mesmo que a chamada tenha falhado antes de gerar cobrança, ou que o
 * fornecedor tenha cobrado menos que o teto. O ciclo completo seria:
 *
 *     custoReservado  →  CONSUMIDO (cobrança confirmada, com custoReal)
 *                     →  LIBERADO  (não houve cobrança; volta ao saldo)
 *
 * Isso só deve ser implementado quando existir forma CONFIÁVEL de saber se
 * uma chamada autorizada gerou cobrança de verdade — fatura, webhook de
 * billing ou API de uso do fornecedor. Liberar reserva por inferência
 * ("deu erro HTTP, então não cobraram") é justamente o tipo de suposição que
 * fura teto: vários fornecedores cobram por trabalho iniciado.
 *
 * Até lá, a reserva conservadora FICA. Errar para o lado de gastar menos é a
 * escolha certa; o custo desse erro é uma operação a menos no mês, e o custo
 * do erro oposto é orçamento estourado sem ninguém perceber.
 */

import { prisma } from './prisma'
import {
  ACAO_AUDIT_AUTORIZADO,
  ACAO_AUDIT_BLOQUEIO,
  avaliarCusto,
  estimarCusto,
  lerPoliticaDeCusto,
  type DecisaoDeCusto,
  type FonteDeEnv,
  type PoliticaDeCusto,
} from './cost-safety-gate'

/** Chave do período de orçamento: um mês, por workspace. */
export function chaveDoPeriodo(workspaceId: string, agora: Date = new Date()): string {
  const ano = agora.getUTCFullYear()
  const mes = String(agora.getUTCMonth() + 1).padStart(2, '0')
  return workspaceId + '|' + ano + '-' + mes
}

export class GastoAcumuladoIndisponivel extends Error {
  constructor(detalhe: string) {
    super(detalhe)
    this.name = 'GastoAcumuladoIndisponivel'
  }
}

interface RegistroDeReserva {
  id: string
  metadata: unknown
}

/**
 * Soma as RESERVAS do workspace no mês corrente.
 *
 * FAIL-CLOSED EM REGISTRO INVÁLIDO: reserva ausente, NaN, negativa ou
 * ilegível NÃO é ignorada. Ignorar baixaria artificialmente o consumo e
 * deixaria passar gasto acima do teto — um registro que não se consegue ler
 * significa que o total do mês não é confiável, e total não confiável
 * bloqueia.
 */
export function somarReservas(registros: RegistroDeReserva[]): number {
  let total = 0
  for (const r of registros) {
    const meta = r.metadata as { custoReservado?: unknown } | null
    const bruto = meta?.custoReservado
    if (typeof bruto !== 'number' || !Number.isFinite(bruto) || bruto < 0) {
      throw new GastoAcumuladoIndisponivel(
        'Registro de reserva ' + r.id + ' tem custoReservado invalido (' + JSON.stringify(bruto) + ') — o total do mes nao e confiavel.'
      )
    }
    total += bruto
  }
  return total
}

function inicioDoMes(agora: Date): Date {
  return new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1))
}

/**
 * Gasto acumulado do mês. `null` = não foi possível apurar — e quem chama
 * BLOQUEIA, nunca assume zero.
 */
export async function calcularGastoAcumulado(
  workspaceId: string,
  agora: Date = new Date()
): Promise<number | null> {
  try {
    const registros = await prisma.auditLog.findMany({
      where: { workspaceId, action: ACAO_AUDIT_AUTORIZADO, createdAt: { gte: inicioDoMes(agora) } },
      select: { id: true, metadata: true },
    })
    return somarReservas(registros)
  } catch (e) {
    console.error('[cost-safety] nao foi possivel apurar o gasto acumulado — bloqueando por precaucao:', e)
    return null
  }
}

export interface ResultadoReserva {
  permitido: boolean
  decisao: DecisaoDeCusto
}

/**
 * Executa leitura + verificação + reserva numa única região atômica.
 * Só é chamada quando a política já autorizou serviços pagos.
 */
export async function reservarOrcamento(params: {
  provider: string
  operacao: string
  workspaceId: string
  custoEstimado: number | null
  /** Já lida pelo gate. `env` só existe para uso direto em teste. */
  politica?: PoliticaDeCusto
  env?: FonteDeEnv
  agora?: Date
  /** P2.50 (D3): ver `guardarChamadaPaga`. */
  chaveIdempotencia?: string | null
  fallbackTipo?: string
  fallbackAlternativa?: string | null
  pendenciaDeAutomacao?: boolean
}): Promise<ResultadoReserva> {
  const agora = params.agora ?? new Date()
  const politica = params.politica ?? lerPoliticaDeCusto(params.env ?? process.env)
  const custoEstimado =
    params.custoEstimado !== undefined ? params.custoEstimado : estimarCusto(params.provider, params.operacao)

  return prisma.$transaction(async (tx) => {
    // Serializa por (workspace, mes). O lock vive ate o fim da transacao.
    //
    // A funcao devolve `void`, que o Prisma nao consegue desserializar
    // ("Failed to deserialize column of type 'void'") - medido ao vivo: a
    // transacao inteira abortava. Por isso a chamada fica numa subconsulta e
    // o SELECT externo devolve um inteiro. O lock e adquirido do mesmo jeito;
    // so a coluna `void` nao chega ao driver.
    await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtext(${chaveDoPeriodo(params.workspaceId, agora)}))) AS trava`

    // P2.50 (D3): mesma operação lógica já autorizada => não reserva nem paga de novo.
    const chave = params.chaveIdempotencia?.trim() || null
    if (chave) {
      const anterior = await tx.auditLog.findFirst({
        where: {
          workspaceId: params.workspaceId,
          action: ACAO_AUDIT_AUTORIZADO,
          metadata: { path: ['chaveIdempotencia'], equals: chave },
        },
        select: { id: true },
      })
      if (anterior) {
        const repetida: DecisaoDeCusto = {
          permitido: false,
          decisao: 'BLOCKED_BY_COST_POLICY',
          motivo: 'CHAMADA_REPETIDA',
          explicacao: 'Esta chamada paga já foi autorizada antes (mesma chave de idempotência); não será paga de novo.',
          saldoDisponivel: 0,
        }
        await tx.auditLog.create({
          data: {
            workspaceId: params.workspaceId,
            action: ACAO_AUDIT_BLOQUEIO,
            entityType: 'CostSafetyGate',
            entityId: params.provider + ':' + params.operacao,
            metadata: { provider: params.provider, operacao: params.operacao, motivo: repetida.motivo, explicacao: repetida.explicacao, chaveIdempotencia: chave, autorizacaoAnterior: anterior.id } as never,
          },
        })
        return { permitido: false, decisao: repetida }
      }
    }

    const registros = await tx.auditLog.findMany({
      where: {
        workspaceId: params.workspaceId,
        action: ACAO_AUDIT_AUTORIZADO,
        createdAt: { gte: inicioDoMes(agora) },
      },
      select: { id: true, metadata: true },
    })
    const gastoAcumulado = somarReservas(registros)

    const decisao = avaliarCusto({
      provider: params.provider,
      operacao: params.operacao,
      workspaceId: params.workspaceId,
      custoEstimado,
      gastoAcumulado,
      politica,
    })

    const metadata: Record<string, unknown> = {
      provider: params.provider,
      operacao: params.operacao,
      motivo: decisao.motivo,
      explicacao: decisao.explicacao,
      saldoDisponivel: decisao.saldoDisponivel,
      decisao: decisao.decisao,
    }
    if (chave) metadata.chaveIdempotencia = chave
    if (decisao.permitido) {
      // RESERVA conservadora, nunca despesa faturada. Ver o cabecalho.
      metadata.custoReservado = custoEstimado
    } else {
      metadata.custoEstimado = custoEstimado
      if (params.fallbackTipo) metadata.fallbackTipo = params.fallbackTipo
      if (params.fallbackAlternativa !== undefined) metadata.fallbackAlternativa = params.fallbackAlternativa
      if (params.pendenciaDeAutomacao !== undefined) metadata.pendenciaDeAutomacao = params.pendenciaDeAutomacao
    }

    await tx.auditLog.create({
      data: {
        workspaceId: params.workspaceId,
        action: decisao.permitido ? ACAO_AUDIT_AUTORIZADO : ACAO_AUDIT_BLOQUEIO,
        entityType: 'CostSafetyGate',
        entityId: params.provider + ':' + params.operacao,
        metadata: metadata as never,
      },
    })

    return { permitido: decisao.permitido, decisao }
  })
}
