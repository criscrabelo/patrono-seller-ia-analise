/** P2.2 — Scheduled Function: janela de observação do ML, 03:00 UTC. Ver netlify/rotina-interna.ts. */
import { dispararRotina, type ContextoNetlify } from '../rotina-interna'

export default async (_req: Request, contexto: ContextoNetlify): Promise<void> => {
  const r = await dispararRotina('ml-janela-observacao', contexto)
  console.log('[rotina-ml-janela-observacao]', r.disparou ? 'disparada' : 'não disparada', '—', r.motivo)
}

export const config = { schedule: '0 3 * * *' }
