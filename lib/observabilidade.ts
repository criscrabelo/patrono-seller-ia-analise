/**
 * P2.14.7 (Fase 0A) — correlação e log estruturado.
 *
 * Toda execução (run do Supervisor, rota, job) ganha um `correlationId`
 * que acompanha decisões, eventos e logs. O log é uma linha JSON e passa
 * SEMPRE por `redigir()` — nenhum segredo chega ao console.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { redigir } from './cofre'

export interface ContextoDeExecucao {
  correlationId: string
  workspaceId?: string
  runId?: string
  jobId?: string
  ator?: 'PATRONO' | 'TITULAR' | 'SISTEMA'
  /** P2.22: o evento cuja REAÇÃO está rodando (linhagem dos eventos gerados por ela — anti-loop). */
  eventoDeOrigem?: { id: string; tipo: string; entidadeId: string | null; profundidade: number }
}

const armazenamento = new AsyncLocalStorage<ContextoDeExecucao>()

export function novoCorrelationId(prefixo = 'exec'): string {
  return `${prefixo}_${randomUUID()}`
}

/** Executa `fn` com o contexto propagado a tudo que ela chamar (inclusive async). */
export function comContexto<T>(contexto: Partial<ContextoDeExecucao>, fn: () => T): T {
  const pai = armazenamento.getStore()
  const ctx: ContextoDeExecucao = {
    ...pai,
    ...contexto,
    correlationId: contexto.correlationId ?? pai?.correlationId ?? novoCorrelationId(),
  }
  return armazenamento.run(ctx, fn)
}

export function contextoAtual(): ContextoDeExecucao | undefined {
  return armazenamento.getStore()
}

export type NivelDeLog = 'debug' | 'info' | 'warn' | 'error'

/** Linha JSON única, com contexto de correlação e dados redigidos. */
export function formatarLog(nivel: NivelDeLog, evento: string, dados?: Record<string, unknown>, agora = new Date()): string {
  const ctx = contextoAtual()
  return JSON.stringify({
    t: agora.toISOString(),
    nivel,
    evento,
    correlationId: ctx?.correlationId,
    workspaceId: ctx?.workspaceId,
    runId: ctx?.runId,
    jobId: ctx?.jobId,
    ...(dados ? { dados: redigir(dados) } : {}),
  })
}

export function log(nivel: NivelDeLog, evento: string, dados?: Record<string, unknown>): void {
  const linha = formatarLog(nivel, evento, dados)
  if (nivel === 'error') console.error(linha)
  else if (nivel === 'warn') console.warn(linha)
  else console.info(linha)
}
