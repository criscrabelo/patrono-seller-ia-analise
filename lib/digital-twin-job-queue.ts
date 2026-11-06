/**
 * Job Queue real do Digital Twin (Rodada 8, regras 33-36) — usa o Postgres
 * já existente (nenhum Redis/BullMQ/fila SaaS). Claim atômico via
 * `SELECT ... FOR UPDATE SKIP LOCKED` — dois workers nunca pegam o mesmo
 * job ao mesmo tempo, mesmo concorrendo de verdade.
 *
 * Worker offline nunca perde o job: se o `heartbeatAt` parar de ser
 * renovado por mais que `staleTimeoutMs`, o job volta a ficar "claimável"
 * — nunca vira `FAILED` só por falta de processador (regra 36).
 */

import { Prisma, PrismaClient } from '@prisma/client'
import { prisma as prismaPadrao } from './prisma'

export const STALE_TIMEOUT_MS_PADRAO = 5 * 60 * 1000 // 5 minutos sem heartbeat = considerado travado/offline

export interface DigitalTwinJobRow {
  id: string
  workspaceId: string
  profileId: string
  status: string
  jobType: string
  workerId: string | null
  claimedAt: Date | null
  heartbeatAt: Date | null
  attempts: number
  error: string | null
  resultAssetId: string | null
  /** Conteúdo ligado ao job — é dele que sai o TEXTO falado da prévia. */
  contentId: string | null
}

/**
 * Reivindica atomicamente o próximo job elegível: `QUEUED`, ou um job
 * travado (heartbeat velho demais) de outro worker que caiu. `FOR UPDATE
 * SKIP LOCKED` garante que dois workers rodando a mesma query ao mesmo
 * tempo nunca pegam a mesma linha.
 *
 * `workspaceId` (Rodada 9, worker pairing): quando informado, o worker só
 * enxerga jobs DAQUELE workspace — nunca de outro. Um worker pareado a um
 * workspace nunca deve poder baixar assets/gerar conteúdo de outro.
 *
 * Terceiro kill switch (Rodada 9, regra 34): um job cujo `DigitalTwinProfile`
 * está com `workerPaused = true` NUNCA é reivindicado — pausar o worker é
 * independente de pausar o Autopilot (`Workspace.automationPaused`) ou o
 * Digital Twin (`DigitalTwinProfile.enabled`).
 */
export async function reivindicarProximoJob(
  workerId: string,
  staleTimeoutMs: number = STALE_TIMEOUT_MS_PADRAO,
  client: PrismaClient = prismaPadrao,
  workspaceId?: string
): Promise<DigitalTwinJobRow | null> {
  const limiteStale = new Date(Date.now() - staleTimeoutMs)
  const filtroWorkspace = workspaceId ? Prisma.sql`AND "workspaceId" = ${workspaceId}` : Prisma.empty

  const rows = await client.$queryRaw<DigitalTwinJobRow[]>(Prisma.sql`
    UPDATE "DigitalTwinJob"
    SET "workerId" = ${workerId}, "claimedAt" = now(), "heartbeatAt" = now(), "updatedAt" = now()
    WHERE id = (
      SELECT id FROM "DigitalTwinJob"
      WHERE (
        (status = 'QUEUED' AND "workerId" IS NULL)
        OR (status NOT IN ('READY', 'FAILED', 'CANCELLED') AND "heartbeatAt" IS NOT NULL AND "heartbeatAt" < ${limiteStale})
      )
      AND NOT EXISTS (
        SELECT 1 FROM "DigitalTwinProfile" p WHERE p.id = "DigitalTwinJob"."profileId" AND p."workerPaused" = true
      )
      ${filtroWorkspace}
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, "workspaceId", "profileId", status, "jobType", "workerId", "claimedAt", "heartbeatAt", attempts, error, "resultAssetId", "contentId"
  `)

  return rows[0] ?? null
}

/** Renova o heartbeat — só se ESTE worker ainda for o dono do job (nunca renova o job de outro worker). */
export async function renovarHeartbeat(jobId: string, workerId: string, client: PrismaClient = prismaPadrao): Promise<boolean> {
  const resultado = await client.digitalTwinJob.updateMany({
    where: { id: jobId, workerId },
    data: { heartbeatAt: new Date() },
  })
  return resultado.count === 1
}

/** Avança o status — só se este worker ainda for o dono. */
export async function avancarStatus(jobId: string, workerId: string, novoStatus: string, client: PrismaClient = prismaPadrao): Promise<boolean> {
  const resultado = await client.digitalTwinJob.updateMany({
    where: { id: jobId, workerId },
    data: { status: novoStatus, heartbeatAt: new Date() },
  })
  return resultado.count === 1
}

export async function completarJob(jobId: string, workerId: string, resultAssetId: string, client: PrismaClient = prismaPadrao): Promise<boolean> {
  const resultado = await client.digitalTwinJob.updateMany({
    where: { id: jobId, workerId },
    // `error: null` é essencial: com o retry automático (regra 31), um job
    // que falhou e deu certo na tentativa seguinte ficava READY carregando a
    // mensagem da falha anterior — e a UI mostra `ultimoJob.erro` ao lado do
    // status. A proprietária via a prévia pronta e um erro junto.
    data: { status: 'READY', resultAssetId, error: null, heartbeatAt: new Date() },
  })
  return resultado.count === 1
}

/**
 * Falha um job — se ainda houver tentativas dentro do limite, volta para
 * `QUEUED` (retry automático, regra 31); senão, `FAILED` de verdade.
 */
export async function falharJob(
  jobId: string,
  workerId: string,
  erro: string,
  maxTentativas: number,
  client: PrismaClient = prismaPadrao
): Promise<'REQUEUED' | 'FAILED' | 'NAO_ERA_DONO'> {
  const job = await client.digitalTwinJob.findUnique({ where: { id: jobId } })
  if (!job || job.workerId !== workerId) return 'NAO_ERA_DONO'

  const novasTentativas = job.attempts + 1
  if (novasTentativas < maxTentativas) {
    await client.digitalTwinJob.update({
      where: { id: jobId },
      data: { status: 'QUEUED', workerId: null, attempts: novasTentativas, error: erro, heartbeatAt: null },
    })
    return 'REQUEUED'
  }
  await client.digitalTwinJob.update({
    where: { id: jobId },
    data: { status: 'FAILED', attempts: novasTentativas, error: erro },
  })
  return 'FAILED'
}

/**
 * Nomes amigáveis por etapa (regra 31 da Retomada da Rodada 9) — a
 * proprietária vê o que está acontecendo agora, nunca uma estimativa de
 * tempo (que dependeria de hardware/fila e seria só um chute).
 */
const NOME_AMIGAVEL_POR_ETAPA: Record<string, string> = {
  PREPARING_AUDIO: 'Preparando áudio',
  GENERATING_VOICE: 'Gerando voz',
  GENERATING_AVATAR: 'Criando avatar',
  LIP_SYNC: 'Sincronizando fala',
  RENDERING: 'Montando vídeo',
  VALIDATING: 'Validando',
  CANCELLED: 'Cancelado',
}

/**
 * Status amigável para a UI: um job `QUEUED` sem worker nenhum ainda não
 * é "falha" — é só "aguardando processador" (regra 36). Cada etapa
 * intermediária tem seu próprio nome (regra 31), em vez de um genérico
 * "Processando" que escondia o progresso real do job.
 */
export function statusAmigavelParaUsuaria(job: Pick<DigitalTwinJobRow, 'status' | 'workerId'>): string {
  if (job.status === 'QUEUED' && !job.workerId) return 'Aguardando processador'
  if (job.status === 'FAILED') return 'Falhou'
  if (job.status === 'READY') return 'Pronto'
  return NOME_AMIGAVEL_POR_ETAPA[job.status] ?? 'Processando'
}
