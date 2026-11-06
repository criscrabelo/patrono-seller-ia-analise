/** P2.2 — Scheduled Function: sincronização de catálogo, 06/12/18 UTC. Ver netlify/rotina-interna.ts. */
import { dispararRotina, type ContextoNetlify } from '../rotina-interna'

export default async (_req: Request, contexto: ContextoNetlify): Promise<void> => {
  const r = await dispararRotina('sincronizar-catalogo', contexto)
  console.log('[rotina-sincronizar-catalogo]', r.disparou ? 'disparada' : 'não disparada', '—', r.motivo)
}

export const config = { schedule: '0 6,12,18 * * *' }
