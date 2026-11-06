/**
 * ML Audit Log (Rodada 9, complemento ML, regra 37) — reaproveita o
 * `AuditLog` já existente: nenhuma tabela nova. Nunca registra
 * secrets/biometria — só modelo/versão/decisionType/score/decisão.
 */

import { registrarAuditoria } from './audit-log'

export async function registrarAuditoriaML(
  workspaceId: string,
  evento: { action: string; entityType?: string; entityId?: string; metadata?: Record<string, unknown> }
) {
  await registrarAuditoria({
    workspaceId,
    action: evento.action,
    entityType: evento.entityType ?? 'MLPrediction',
    entityId: evento.entityId ?? workspaceId,
    metadata: evento.metadata,
  })
}
