/**
 * P2.15.4 — "Publicado" só com evidência real.
 *
 * Antes, um conteúdo agendado cuja data passou virava `publicado` em três
 * caminhos internos (ao abrir a listagem; no cron, sem vídeo; no cron, sem
 * Instagram conectado) — sem nada ter saído. Agora:
 *   - `publicado` só é gravado pelo executor da publicação, depois que o
 *     canal devolve o identificador (lib/trabalhos-longos/publicar-instagram.ts);
 *   - agendado vencido sem publicação é "Publicação atrasada": ou já gravado
 *     pelo cron (`publicacao_atrasada`), ou derivado na leitura (agendado
 *     com a data passada, quando o cron está desligado).
 */
import { prisma } from './prisma'

export const STATUS_ATRASADA = 'publicacao_atrasada'
/** Folga para não alarmar enquanto o cron ainda vai passar. */
export const FOLGA_MS = 15 * 60 * 1000

/** FUNÇÃO PURA: este conteúdo está com a publicação atrasada? */
export function estaAtrasado(c: { status: string; dataAgendamento: Date | string | null }, agora: Date): boolean {
  if (c.status === STATUS_ATRASADA) return true
  if (c.status !== 'agendado' || !c.dataAgendamento) return false
  return new Date(c.dataAgendamento).getTime() <= agora.getTime() - FOLGA_MS
}

export function ondeAtrasado(workspaceId: string, agora: Date) {
  return {
    workspaceId,
    OR: [{ status: STATUS_ATRASADA }, { status: 'agendado', dataAgendamento: { lte: new Date(agora.getTime() - FOLGA_MS) } }],
  }
}

export async function contarPublicacoesAtrasadas(workspaceId: string, agora = new Date()): Promise<number> {
  return prisma.conteudo.count({ where: ondeAtrasado(workspaceId, agora) })
}

/** Por que não saiu — gravado no conteúdo para a tela explicar. */
export const MOTIVO_SEM_VIDEO = 'Não publicado: na data marcada o conteúdo não tinha vídeo, e sem vídeo não há o que enviar ao canal. Gere o vídeo e reagende.'
export const MOTIVO_SEM_CANAL = 'Não publicado: na data marcada o Instagram não estava conectado. Conecte em Integrações e reagende.'
