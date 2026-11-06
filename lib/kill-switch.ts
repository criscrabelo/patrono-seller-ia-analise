/**
 * P2.14.7 (Fase 0A) — Kill switch e Safe Mode.
 *
 * Três travas, da mais ampla para a mais específica:
 *   1. GLOBAL  — env `PATRONO_AUTOPILOT_DESLIGADO=true`: nenhum workspace age.
 *   2. PAUSA   — `Workspace.automationPaused` (já existia; padrão true).
 *   3. SAFE MODE — `Workspace.safeModeAtivo`: o Patrono continua observando
 *      (coletar, ranquear, simular), mas não executa ação irreversível
 *      (publicar, gastar, conectar). Entra sozinho em condição grave; SAI
 *      só por decisão humana.
 *
 * Nada é apagado por nenhuma trava — elas só impedem novas ações.
 */
import { prisma } from './prisma'
import { registrarDecisao, registrarEvento } from './ledger'
import type { ContextoDeSeguranca } from './politica'

export class ErroDeSeguranca extends Error {
  constructor(public readonly motivo: string) {
    super(`[seguranca] ${motivo}`)
  }
}

export function killSwitchGlobalAtivo(env: Record<string, string | undefined> = process.env): boolean {
  return (env.PATRONO_AUTOPILOT_DESLIGADO ?? '').trim().toLowerCase() === 'true'
}

export interface EstadoDeExecucao extends ContextoDeSeguranca {
  global: boolean
  pausado: boolean
  safeMode: boolean
}

/** FUNÇÃO PURA: combina as três travas. */
export function combinarTravas(p: { global: boolean; pausado: boolean; safeMode: boolean; motivoSafeMode?: string | null }): EstadoDeExecucao {
  const motivo = p.global
    ? 'Kill switch global ligado: nenhuma ação automática em nenhum workspace.'
    : p.safeMode
      ? `Safe Mode: ${p.motivoSafeMode ?? 'condição grave detectada'}. Só observação.`
      : p.pausado
        ? 'Automação pausada pela titular.'
        : undefined
  return { ...p, acoesIrreversiveisBloqueadas: p.global || p.safeMode || p.pausado, motivoDoBloqueio: motivo }
}

export async function estadoDeExecucao(workspaceId: string, env: Record<string, string | undefined> = process.env): Promise<EstadoDeExecucao> {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { automationPaused: true, safeModeAtivo: true, safeModeMotivo: true },
  })
  // Workspace inexistente conta como travado: o seguro é não agir.
  return combinarTravas({
    global: killSwitchGlobalAtivo(env),
    pausado: ws?.automationPaused ?? true,
    safeMode: ws?.safeModeAtivo ?? true,
    motivoSafeMode: ws?.safeModeMotivo ?? (ws ? null : 'workspace inexistente'),
  })
}

/**
 * Freio de EMERGÊNCIA para as portas únicas já existentes (publicação e
 * chamada paga): só kill switch global e Safe Mode. A pausa comum NÃO entra
 * aqui — a automação nasce pausada e a titular continua podendo publicar e
 * gerar manualmente. Workspace inexistente ou leitura que falha → bloqueia.
 */
export async function freioDeEmergencia(workspaceId: string, env: Record<string, string | undefined> = process.env): Promise<{ bloqueado: boolean; motivo: string | null }> {
  if (killSwitchGlobalAtivo(env)) return { bloqueado: true, motivo: 'Kill switch global ligado: nenhuma publicação ou gasto em nenhum workspace.' }
  try {
    const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { safeModeAtivo: true, safeModeMotivo: true } })
    if (!ws) return { bloqueado: true, motivo: 'Workspace inexistente.' }
    if (ws.safeModeAtivo) return { bloqueado: true, motivo: `Safe Mode ligado: ${ws.safeModeMotivo ?? 'condição grave detectada'}.` }
    return { bloqueado: false, motivo: null }
  } catch {
    return { bloqueado: true, motivo: 'Não foi possível conferir o Safe Mode. Nada foi feito.' }
  }
}

/** Chamar ANTES de qualquer ação irreversível. Lança se alguma trava estiver ligada. */
export async function exigirPodeAgir(workspaceId: string, env: Record<string, string | undefined> = process.env): Promise<void> {
  const e = await estadoDeExecucao(workspaceId, env)
  if (e.acoesIrreversiveisBloqueadas) throw new ErroDeSeguranca(e.motivoDoBloqueio ?? 'ação bloqueada')
}

/** Liga o Safe Mode (idempotente). Pode ser automático (SISTEMA/PATRONO) ou da titular. */
export async function entrarEmSafeMode(p: { workspaceId: string; motivo: string; ator: 'PATRONO' | 'TITULAR' | 'SISTEMA'; userId?: string | null; agora?: Date }) {
  const agora = p.agora ?? new Date()
  return prisma.$transaction(async (tx) => {
    const r = await tx.workspace.updateMany({
      where: { id: p.workspaceId, safeModeAtivo: false },
      data: { safeModeAtivo: true, safeModeMotivo: p.motivo, safeModeDesde: agora },
    })
    if (r.count === 0) return { mudou: false }
    const chave = `safe-mode:entrar:${agora.toISOString()}`
    await registrarDecisao({ workspaceId: p.workspaceId, tipo: 'SAFE_MODE', ator: p.ator, atorUserId: p.userId ?? null, decisao: 'Safe Mode ligado.', explicacao: [p.motivo], chaveIdempotencia: chave }, tx)
    await registrarEvento({ workspaceId: p.workspaceId, tipo: 'SAFE_MODE_ENTERED', chaveIdempotencia: chave, payload: { motivo: p.motivo, ator: p.ator } }, tx)
    return { mudou: true }
  })
}

/** Sair do Safe Mode é SEMPRE decisão humana. */
export async function sairDoSafeMode(p: { workspaceId: string; userId: string; motivo?: string; agora?: Date }) {
  const agora = p.agora ?? new Date()
  return prisma.$transaction(async (tx) => {
    const r = await tx.workspace.updateMany({
      where: { id: p.workspaceId, safeModeAtivo: true },
      data: { safeModeAtivo: false, safeModeMotivo: null, safeModeDesde: null },
    })
    if (r.count === 0) return { mudou: false }
    const chave = `safe-mode:sair:${agora.toISOString()}`
    await registrarDecisao({ workspaceId: p.workspaceId, tipo: 'SAFE_MODE', ator: 'TITULAR', atorUserId: p.userId, decisao: 'Safe Mode desligado pela titular.', explicacao: p.motivo ? [p.motivo] : [], chaveIdempotencia: chave }, tx)
    await registrarEvento({ workspaceId: p.workspaceId, tipo: 'SAFE_MODE_EXITED', chaveIdempotencia: chave, payload: { userId: p.userId } }, tx)
    return { mudou: true }
  })
}
