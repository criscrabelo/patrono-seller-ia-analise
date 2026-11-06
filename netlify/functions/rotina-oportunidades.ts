/** P2.2 — Scheduled Function: ciclo de oportunidades, 05:00 UTC. Ver netlify/rotina-interna.ts. */
import { dispararRotina, type ContextoNetlify } from '../rotina-interna'

export default async (_req: Request, contexto: ContextoNetlify): Promise<void> => {
  const r = await dispararRotina('oportunidades', contexto)
  console.log('[rotina-oportunidades]', r.disparou ? 'disparada' : 'não disparada', '—', r.motivo)
}

export const config = { schedule: '0 5 * * *' }
