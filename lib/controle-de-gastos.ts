/**
 * P2.53 — CONTROLE DE GASTOS (o "limite de gastos com IA" da proposta do Lovable, sobre o gate que já existe).
 *
 * Não há gate novo: quem decide é `guardarChamadaPaga` (lib/cost-safety-gate.ts), no servidor, antes de
 * toda chamada paga. Aqui só se MOSTRA à titular a situação:
 *  - orçamento ADICIONAL autorizado (R$ 0/mês até ela assinar: AI_BUDGET_AUTORIZADO_POR + _ATE);
 *  - reservado no mês, bloqueios no mês e os últimos bloqueios (com o motivo);
 *  - cada provedor pago e a sua situação;
 *  - o que roda SEM custo adicional (gratuito ou já contratado), que continua funcionando.
 * Crédito de IA disponível NÃO é gratuidade: a Anthropic é provedor pago e passa pelo limite.
 */
import { PROVEDORES_PAGOS, lerPoliticaDeCusto, ACAO_AUDIT_AUTORIZADO, ACAO_AUDIT_BLOQUEIO, type FonteDeEnv, type PoliticaDeCusto } from './cost-safety-gate'

export const REGRA_CREDITOS = 'Créditos de IA disponíveis não são gratuidade: toda chamada a um provedor pago conta como gasto e passa pelo limite.'

/** O que o Patrono usa sem gerar despesa nova (por chamada). Continua liberado. */
export const RECURSOS_SEM_CUSTO_ADICIONAL: ReadonlyArray<{ recurso: string; por: string }> = [
  { recurso: 'Montagem de vídeo (FFmpeg local)', por: 'roda no computador/servidor, sem cobrança por uso' },
  { recurso: 'Voz neutra local (Chatterbox)', por: 'roda no computador, sem cobrança por uso' },
  { recurso: 'Roteiro e legenda pelo caminho gratuito', por: 'textos montados por modelos (templates) do Patrono, sem IA' },
  { recurso: 'APIs oficiais (TikTok, Meta) e importação do Creator Center', por: 'sem cobrança por chamada' },
  { recurso: 'Hospedagem e banco (planos já contratados)', por: 'custo fixo do plano; nenhuma chamada do Patrono aumenta a fatura por uso' },
]

export interface SituacaoDosGastos {
  orcamentoAdicionalAutorizadoBRL: number
  pagoHabilitado: boolean
  autorizacao: { valida: boolean; por: string | null; ate: string | null; motivo: string | null }
  /** Havia valor no ambiente, mas sem autorização: ignorado. */
  orcamentoIgnoradoBRL: number | null
  reservadoNoMesBRL: number | null
  bloqueiosNoMes: number | null
  ultimosBloqueios: Array<{ quando: string; operacao: string; motivo: string }>
  provedoresPagos: Array<{ provedor: string; descricao: string; liberado: boolean }>
  semCustoAdicional: typeof RECURSOS_SEM_CUSTO_ADICIONAL
  regra: string
}

/** FUNÇÃO PURA: a parte que não depende do banco. */
export function situacaoDaPolitica(politica: PoliticaDeCusto) {
  const liberado = politica.pagoHabilitado && politica.orcamentoMensal > 0
  return {
    orcamentoAdicionalAutorizadoBRL: politica.orcamentoMensal,
    pagoHabilitado: politica.pagoHabilitado,
    autorizacao: politica.autorizacao ?? { valida: false, por: null, ate: null, motivo: 'Sem autorização registrada.' },
    orcamentoIgnoradoBRL: politica.orcamentoInformadoSemAutorizacao ?? null,
    provedoresPagos: Object.entries(PROVEDORES_PAGOS).map(([provedor, p]) => ({ provedor, descricao: p.descricao, liberado })),
    semCustoAdicional: RECURSOS_SEM_CUSTO_ADICIONAL,
    regra: REGRA_CREDITOS,
  }
}

export async function situacaoDosGastos(workspaceId: string, env: FonteDeEnv = process.env, agora: Date = new Date()): Promise<SituacaoDosGastos> {
  const base = situacaoDaPolitica(lerPoliticaDeCusto(env, agora))
  const { prisma } = await import('./prisma')
  const { somarReservas } = await import('./cost-safety-reserva')
  const inicio = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1))
  let reservadoNoMesBRL: number | null = null
  let bloqueiosNoMes: number | null = null
  let ultimosBloqueios: SituacaoDosGastos['ultimosBloqueios'] = []
  try {
    const [autorizados, nBloqueios, ultimos] = await Promise.all([
      prisma.auditLog.findMany({ where: { workspaceId, action: ACAO_AUDIT_AUTORIZADO, createdAt: { gte: inicio } }, select: { id: true, metadata: true } }),
      prisma.auditLog.count({ where: { workspaceId, action: ACAO_AUDIT_BLOQUEIO, createdAt: { gte: inicio } } }),
      prisma.auditLog.findMany({ where: { workspaceId, action: ACAO_AUDIT_BLOQUEIO }, orderBy: { createdAt: 'desc' }, take: 5, select: { createdAt: true, entityId: true, metadata: true } }),
    ])
    reservadoNoMesBRL = Math.round(somarReservas(autorizados) * 100) / 100
    bloqueiosNoMes = nBloqueios
    ultimosBloqueios = ultimos.map((u) => ({
      quando: u.createdAt.toISOString(),
      operacao: u.entityId ?? '?',
      motivo: String((u.metadata as { explicacao?: unknown } | null)?.explicacao ?? 'bloqueado').slice(0, 300),
    }))
  } catch (e) {
    // Sem leitura confiável: mostra "não apurado" (null), nunca zero.
    console.error('[controle-de-gastos] leitura falhou:', e instanceof Error ? e.message : e)
  }
  return { ...base, reservadoNoMesBRL, bloqueiosNoMes, ultimosBloqueios }
}
