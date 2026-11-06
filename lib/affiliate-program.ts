import { prisma } from '@/lib/prisma'
import { registrarAuditoria } from '@/lib/audit-log'

export const STATUS_PROGRAMA = [
  'NOT_REGISTERED',
  'REQUESTED',
  'WAITING_APPROVAL',
  'ACTIVE',
  'NEEDS_CONFIGURATION',
] as const
export type StatusPrograma = (typeof STATUS_PROGRAMA)[number]

export const MODO_OPERACAO = ['MANUAL', 'INTEGRATED'] as const
export type ModoOperacao = (typeof MODO_OPERACAO)[number]

export const STATUS_INTEGRACAO = [
  'NOT_AVAILABLE',
  'FUTURE',
  'CONFIGURED',
  'CONNECTED',
  'ERROR',
] as const
export type StatusIntegracao = (typeof STATUS_INTEGRACAO)[number]

/**
 * Cria ou atualiza o registro de "Programa de afiliados" de uma
 * plataforma (Shopee, Hotmart, Mercado Livre, ...) para um workspace.
 *
 * Programa × Operação × Integração NÃO são sinônimos (design_handoff §6):
 * - Programa: a afiliada está cadastrada nesse programa? (status abaixo)
 * - Operação: como o Patrono trabalha com ele hoje — nesta fase, sempre
 *   MANUAL.
 * - Integração: existe conexão técnica real? Por isso esta função RECUSA
 *   marcar `integrationStatus: 'CONNECTED'` a menos que já exista uma
 *   `Integracao` de verdade (status "conectado") para a mesma plataforma
 *   neste workspace — nunca finge uma conexão que não existe.
 */
export async function upsertPrograma(params: {
  workspaceId: string
  platform: string
  status?: StatusPrograma
  operationMode?: ModoOperacao
  integrationStatus?: StatusIntegracao
  notes?: string | null
  // Quem fez a alteração — opcional porque hoje esta função também é usada
  // em testes/scripts sem uma sessão de usuária por trás. Quando presente,
  // gera o registro de auditoria (criação ou alteração de programa).
  actorUserId?: string
}) {
  const { workspaceId, platform } = params

  if (params.integrationStatus === 'CONNECTED') {
    const integracaoReal = await prisma.integracao.findUnique({
      where: { workspaceId_plataforma: { workspaceId, plataforma: platform } },
    })
    if (!integracaoReal || integracaoReal.status !== 'conectado') {
      throw new Error(
        `Não é possível marcar "${platform}" como CONNECTED sem uma integração real conectada.`
      )
    }
  }

  const jaExistia = await prisma.affiliateProgram.findUnique({
    where: { workspaceId_platform: { workspaceId, platform } },
  })

  const programa = await prisma.affiliateProgram.upsert({
    where: { workspaceId_platform: { workspaceId, platform } },
    update: {
      ...(params.status && { status: params.status }),
      ...(params.operationMode && { operationMode: params.operationMode }),
      ...(params.integrationStatus && { integrationStatus: params.integrationStatus }),
      ...(params.notes !== undefined && { notes: params.notes }),
    },
    create: {
      workspaceId,
      platform,
      status: params.status ?? 'NOT_REGISTERED',
      operationMode: params.operationMode ?? 'MANUAL',
      integrationStatus: params.integrationStatus ?? 'NOT_AVAILABLE',
      notes: params.notes ?? null,
    },
  })

  if (params.actorUserId) {
    await registrarAuditoria({
      workspaceId,
      userId: params.actorUserId,
      action: jaExistia ? 'programa.alterado' : 'programa.criado',
      entityType: 'AffiliateProgram',
      entityId: programa.id,
      metadata: { platform, status: programa.status, operationMode: programa.operationMode },
    })
  }

  return programa
}
