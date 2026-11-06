/**
 * P2.14.7 (Fase 0A) — Feature flags.
 *
 * Todas nascem DESLIGADAS. Precedência (o mais específico vence, mas o
 * ambiente sempre pode DESLIGAR):
 *   1. env `FLAG_<CHAVE>=false` → desligada, sem consulta ao banco
 *   2. flag do workspace (escopo = workspaceId)
 *   3. flag global (escopo = "global")
 *   4. padrão do registro (false)
 * Flag desconhecida é sempre false — nada liga por erro de digitação.
 */
import { prisma } from './prisma'

export const FLAGS = {
  SUPERVISOR_SIMULACAO: 'Supervisor roda em modo simulação (sem publicar).',
  SUPERVISOR_AUTOMATICO: 'Supervisor pode agir sozinho dentro da política.',
  COPILOT_DETERMINISTICO: 'Copilot com comandos determinísticos (custo zero).',
  CENTRAL_DE_APROVACOES: 'Tela "Precisa de você" lê o Approval Engine.',
  CENTRAL_OPERACIONAL: 'Command Center na home + ciclo manual do Supervisor (sem publicar).',
  LEDGER_NA_CURADORIA: 'Curadoria registra decisões e eventos.',
  TIKTOK_SHOP_CATALOGO: 'Catálogo oficial TikTok Shop (exige app aprovado).',
  // P2.29.1: Gate B da P2.19 — só liga depois que o primeiro pedido ELEGÍVEL real for conferido (formato BR já validado no Gate A).
  IMPORTACAO_CREATOR_CENTER: 'Importar o relatório de pedidos do Creator Center (comissão). Desligada até conferir o 1º pedido elegível real.',
} as const
export type ChaveDeFlag = keyof typeof FLAGS

export function ehFlagConhecida(chave: string): chave is ChaveDeFlag {
  return Object.prototype.hasOwnProperty.call(FLAGS, chave)
}

/** FUNÇÃO PURA: resolve a precedência. */
export function resolverFlag(p: { env?: string; workspace?: boolean | null; global?: boolean | null }): boolean {
  const env = (p.env ?? '').trim().toLowerCase()
  if (env === 'false') return false
  if (env === 'true') return true
  if (typeof p.workspace === 'boolean') return p.workspace
  if (typeof p.global === 'boolean') return p.global
  return false
}

export async function flagLigada(chave: string, workspaceId?: string | null, env: Record<string, string | undefined> = process.env): Promise<boolean> {
  if (!ehFlagConhecida(chave)) return false
  const valorEnv = env[`FLAG_${chave}`]
  if ((valorEnv ?? '').trim().toLowerCase() === 'false') return false
  const linhas = await prisma.featureFlag.findMany({
    where: { chave, escopo: { in: workspaceId ? ['global', workspaceId] : ['global'] } },
    select: { escopo: true, ligada: true },
  })
  return resolverFlag({
    env: valorEnv,
    workspace: workspaceId ? linhas.find((l) => l.escopo === workspaceId)?.ligada ?? null : null,
    global: linhas.find((l) => l.escopo === 'global')?.ligada ?? null,
  })
}

export async function definirFlag(p: { chave: ChaveDeFlag; escopo?: string; ligada: boolean; userId?: string | null; motivo?: string | null }) {
  if (!ehFlagConhecida(p.chave)) throw new Error(`Flag desconhecida: ${p.chave}`)
  const escopo = p.escopo ?? 'global'
  return prisma.featureFlag.upsert({
    where: { chave_escopo: { chave: p.chave, escopo } },
    create: { chave: p.chave, escopo, ligada: p.ligada, atualizadoPorUserId: p.userId ?? null, motivo: p.motivo ?? null },
    update: { ligada: p.ligada, atualizadoPorUserId: p.userId ?? null, motivo: p.motivo ?? null },
  })
}
