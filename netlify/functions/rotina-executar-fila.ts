/** P2.2 — Scheduled Function: executor da fila, de hora em hora (UTC). Ver netlify/rotina-interna.ts. */
import { dispararRotina, type ContextoNetlify } from '../rotina-interna'

export default async (_req: Request, contexto: ContextoNetlify): Promise<void> => {
  const r = await dispararRotina('executar-fila', contexto)
  console.log('[rotina-executar-fila]', r.disparou ? 'disparada' : 'não disparada', '—', r.motivo)
}

export const config = { schedule: '0 * * * *' }
