/** P2.2 — Scheduled Function: publicação agendada, 12:00 UTC (desligada sem CRON_PUBLICAR_ATIVO=true). Ver netlify/rotina-interna.ts. */
import { dispararRotina, type ContextoNetlify } from '../rotina-interna'

export default async (_req: Request, contexto: ContextoNetlify): Promise<void> => {
  const r = await dispararRotina('publicar', contexto)
  console.log('[rotina-publicar]', r.disparou ? 'disparada' : 'não disparada', '—', r.motivo)
}

export const config = { schedule: '0 12 * * *' }
