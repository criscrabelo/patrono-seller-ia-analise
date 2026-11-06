/**
 * P2.14.7 (Fase 0A) — Máquina de estados do Supervisor (contrato PURO).
 *
 * Um run percorre o ciclo comercial em ordem. Cada estado só pode ir para
 * os próximos previstos aqui; qualquer outro salto é recusado. FALHOU,
 * CANCELADO e CONCLUIDO são terminais. PAUSADO volta para o estado em que
 * parou (guardado no checkpoint) — a retomada nunca pula etapas.
 */
import type { EstadoDoRun } from '@prisma/client'

export const ESTADOS_TERMINAIS: ReadonlySet<EstadoDoRun> = new Set(['CONCLUIDO', 'FALHOU', 'CANCELADO'])

/** Fluxo feliz, na ordem. */
export const FLUXO: readonly EstadoDoRun[] = [
  'PLANEJADO',
  'DESCOBRINDO',
  'VALIDANDO',
  'RANQUEANDO',
  'DECIDINDO',
  'CRIANDO',
  'AGUARDANDO_APROVACAO',
  'AGENDANDO',
  'PUBLICANDO',
  'MEDINDO',
  'APRENDENDO',
  'CONCLUIDO',
]

/** Saltos além do "próximo da fila". */
const EXTRAS: Partial<Record<EstadoDoRun, EstadoDoRun[]>> = {
  // Decisão de não criar nada (nenhum candidato bom) encerra o run.
  DECIDINDO: ['CONCLUIDO'],
  // Política pode dispensar aprovação.
  CRIANDO: ['AGENDANDO'],
  // Rejeitado pela titular: volta a decidir com outro candidato.
  AGUARDANDO_APROVACAO: ['DECIDINDO'],
}

export function podeTransitar(de: EstadoDoRun, para: EstadoDoRun): boolean {
  if (ESTADOS_TERMINAIS.has(de)) return false
  if (de === para) return false
  // De qualquer estado ativo pode-se falhar, cancelar ou pausar.
  if (para === 'FALHOU' || para === 'CANCELADO') return true
  if (para === 'PAUSADO') return de !== 'PAUSADO'
  // De PAUSADO, a retomada é validada contra o checkpoint (ver `retomadaValida`).
  if (de === 'PAUSADO') return !ESTADOS_TERMINAIS.has(para)
  const i = FLUXO.indexOf(de)
  if (i >= 0 && FLUXO[i + 1] === para) return true
  return (EXTRAS[de] ?? []).includes(para)
}

/** Ao sair de PAUSADO, só se volta ao estado em que se parou. */
export function retomadaValida(estadoAntesDaPausa: EstadoDoRun | null | undefined, para: EstadoDoRun): boolean {
  return !!estadoAntesDaPausa && estadoAntesDaPausa === para
}

/** Estados em que o run está fazendo algo irreversível (exigem `exigirPodeAgir`). */
export const ESTADOS_IRREVERSIVEIS: ReadonlySet<EstadoDoRun> = new Set(['PUBLICANDO'])
