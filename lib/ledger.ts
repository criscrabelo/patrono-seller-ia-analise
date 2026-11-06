/**
 * P2.14.7 (Fase 0A) — Livro de decisões e livro de eventos.
 *
 * DECISÃO: o que foi decidido, por quem (PATRONO/TITULAR/SISTEMA), com
 * quais dados, quais faltavam, confiança, regra/modelo e versão da
 * política. É o que responde "por que o Patrono fez isso?".
 *
 * EVENTO: fato do domínio (PRODUCT_SELECTED, CONTENT_PUBLISHED…),
 * versionado e idempotente. Alimenta "O que o Patrono está fazendo agora".
 *
 * Ambos aceitam um cliente de transação: gravam JUNTO com a ação que
 * registram (ou nada é gravado). Idempotentes por `chaveIdempotencia`.
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma as prismaPadrao } from './prisma'
import { redigir } from './cofre'
import { contextoAtual } from './observabilidade'

type Cliente = PrismaClient | Prisma.TransactionClient

/** Vocabulário de eventos (item 28 do Prompt Mestre). Novos tipos entram aqui. */
export const TIPOS_DE_EVENTO = [
  'PRODUCT_DISCOVERED',
  'PRODUCT_UPDATED',
  'OPPORTUNITY_SCORED',
  'CANDIDATES_PRESENTED',
  'PRODUCT_SELECTED',
  'CONTENT_REQUESTED',
  'CONTENT_CREATED',
  'CONTENT_VALIDATED',
  'APPROVAL_REQUIRED',
  'APPROVAL_GRANTED',
  'APPROVAL_REJECTED',
  'CONTENT_SCHEDULED',
  'CONTENT_PUBLISHED',
  'METRICS_UPDATED',
  'LEARNING_UPDATED',
  'POLICY_CHANGED',
  'RUN_STATE_CHANGED',
  'SAFE_MODE_ENTERED',
  'SAFE_MODE_EXITED',
  'COST_RESERVED',
  'COST_BLOCKED',
  'ERROR_DETECTED',
  'RECOVERY_COMPLETED',
  // P2.18.5 — Jornada única (entidade JornadaOperacional): cada transição com executor, origem, evidência e motivo.
  'JOURNEY_STARTED',
  'JOURNEY_STEP_CHANGED',
  'JOURNEY_STEP_FAILED',
  'JOURNEY_CLOSED',
  'PRODUCT_REJECTED',
  'PRODUCT_IN_HAND',
  'PRODUCT_CHOSEN',
  // P2.18.11 — fonte única do produto: excluir/restaurar propaga; recomeço e reconciliação ficam no livro.
  'PRODUCT_ARCHIVED',
  'PRODUCT_RESTORED',
  'OPERATION_RESET',
  'STATE_RECONCILED',
  // Revalidação comercial: preço confirmado mudou / produto indisponível (o valor anterior fica no evento).
  'PRICE_CHANGED',
  'PRODUCT_BECAME_UNAVAILABLE',
  'COMMERCIAL_DATA_INVALIDATED',
  // P2.18.10 — autorização de mídia do vendedor (pedido, resposta, aprovação, revogação).
  'MEDIA_AUTHORIZATION_REQUESTED',
  'MEDIA_AUTHORIZATION_RESPONSE',
  'MEDIA_AUTHORIZED',
  'MEDIA_AUTHORIZATION_REVOKED',
  'SHOWCASE_CONFIRMED',
  'SHOWCASE_UNAVAILABLE',
  'SAMPLE_REQUESTED',
  'SAMPLE_DECLINED',
  'SAMPLE_STATUS_REPORTED',
  'RESULT_REPORTED',
  // P2.20 — regra da plataforma mudou (nova versão) / estado da conta mudou: recalcula bloqueios, quotas, avisos, agenda e pendentes.
  'PLATFORM_RULE_UPDATED',
  'PLATFORM_ACCOUNT_STATE_UPDATED',
  'PLATFORM_QUOTA_BLOCKED',
  // P2.22 — amostra RECEBIDA (não ENVIADA); comissão LIQUIDADA de fato (uma vez por pedido) e a reversão (o histórico fica).
  'SAMPLE_DELIVERED',
  'COMMISSION_CONFIRMED',
  'COMMISSION_REVERSED',
] as const
export type TipoDeEvento = (typeof TIPOS_DE_EVENTO)[number]

export type Ator = 'PATRONO' | 'TITULAR' | 'SISTEMA'

export interface NovaDecisao {
  workspaceId: string
  tipo: string
  ator: Ator
  atorUserId?: string | null
  decisao: string
  entidadeTipo?: string | null
  entidadeId?: string | null
  confianca?: number | null
  entradas?: Record<string, unknown> | null
  ausentes?: string[]
  explicacao?: string[]
  regra?: string | null
  politicaVersao?: number | null
  chaveIdempotencia?: string | null
  runId?: string | null
  correlationId?: string | null
}

export async function registrarDecisao(d: NovaDecisao, cliente: Cliente = prismaPadrao) {
  const ctx = contextoAtual()
  const dados = {
    workspaceId: d.workspaceId,
    tipo: d.tipo,
    ator: d.ator,
    atorUserId: d.atorUserId ?? null,
    decisao: d.decisao,
    entidadeTipo: d.entidadeTipo ?? null,
    entidadeId: d.entidadeId ?? null,
    confianca: d.confianca ?? null,
    entradas: (d.entradas ? redigir(d.entradas) : undefined) as Prisma.InputJsonValue | undefined,
    ausentes: d.ausentes ?? [],
    explicacao: d.explicacao ?? [],
    regra: d.regra ?? null,
    politicaVersao: d.politicaVersao ?? null,
    chaveIdempotencia: d.chaveIdempotencia ?? null,
    runId: d.runId ?? ctx?.runId ?? null,
    correlationId: d.correlationId ?? ctx?.correlationId ?? null,
  }
  if (!d.chaveIdempotencia) return cliente.decisionRecord.create({ data: dados })
  // Idempotente: a mesma chave devolve a decisão já registrada, sem duplicar.
  const onde = { workspaceId_chaveIdempotencia: { workspaceId: d.workspaceId, chaveIdempotencia: d.chaveIdempotencia } }
  return cliente.decisionRecord.upsert({ where: onde, create: dados, update: {} })
    .catch((erro) => (repetidoEmParalelo(erro, cliente) ? cliente.decisionRecord.findUniqueOrThrow({ where: onde }) : Promise.reject(erro)))
}

/**
 * P2.18.11: duas requisições simultâneas com a MESMA chave — o upsert de uma
 * perde a corrida no índice único (P2002). É repetição, não erro: devolve o
 * registro que a outra gravou. Dentro de transação a falha aborta a
 * transação inteira, então lá o erro sobe (quem chama decide).
 */
function repetidoEmParalelo(erro: unknown, cliente: Cliente): boolean {
  return (erro as { code?: string } | null)?.code === 'P2002' && cliente === prismaPadrao
}

export interface NovoEvento {
  workspaceId: string
  tipo: TipoDeEvento
  chaveIdempotencia: string
  payload?: Record<string, unknown>
  versao?: number
  entidadeTipo?: string | null
  entidadeId?: string | null
  runId?: string | null
  correlationId?: string | null
  ocorridoEm?: Date
}

export async function registrarEvento(e: NovoEvento, cliente: Cliente = prismaPadrao) {
  if (!(TIPOS_DE_EVENTO as readonly string[]).includes(e.tipo)) throw new Error(`Tipo de evento desconhecido: ${e.tipo}`)
  const ctx = contextoAtual()
  const dados = {
    workspaceId: e.workspaceId,
    tipo: e.tipo,
    versao: e.versao ?? 1,
    chaveIdempotencia: e.chaveIdempotencia,
    payload: redigir(e.payload ?? {}) as Prisma.InputJsonValue,
    entidadeTipo: e.entidadeTipo ?? null,
    entidadeId: e.entidadeId ?? null,
    runId: e.runId ?? ctx?.runId ?? null,
    correlationId: e.correlationId ?? ctx?.correlationId ?? null,
    // P2.22: evento gerado dentro de uma reação carrega a linhagem (o processador corta loops por ela).
    causadoPorEventoId: ctx?.eventoDeOrigem?.id ?? null,
    profundidade: ctx?.eventoDeOrigem ? ctx.eventoDeOrigem.profundidade + 1 : 0,
    ...(e.ocorridoEm ? { ocorridoEm: e.ocorridoEm } : {}),
  }
  const onde = { workspaceId_chaveIdempotencia: { workspaceId: e.workspaceId, chaveIdempotencia: e.chaveIdempotencia } }
  return cliente.domainEvent.upsert({ where: onde, create: dados, update: {} })
    .catch((erro) => (repetidoEmParalelo(erro, cliente) ? cliente.domainEvent.findUniqueOrThrow({ where: onde }) : Promise.reject(erro)))
}

/** "O que o Patrono está fazendo agora": últimos eventos do workspace. */
export async function atividadeRecente(workspaceId: string, limite = 30) {
  return prismaPadrao.domainEvent.findMany({
    where: { workspaceId },
    orderBy: { ocorridoEm: 'desc' },
    take: Math.min(Math.max(limite, 1), 200),
  })
}

/** Decisões de uma entidade (timeline do produto, "por quê?"). */
export async function decisoesDaEntidade(workspaceId: string, entidadeTipo: string, entidadeId: string) {
  return prismaPadrao.decisionRecord.findMany({
    where: { workspaceId, entidadeTipo, entidadeId },
    orderBy: { criadoEm: 'asc' },
  })
}
