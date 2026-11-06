/** P2.29 — Scheduled Function: reconciliação operacional (P2.28), de hora em hora (UTC). A rota só roda com RECONCILIACAO_AGENDADA=true; corrige só o que é seguro. Ver netlify/rotina-interna.ts. */
import { dispararRotina, type ContextoNetlify } from '../rotina-interna'

export default async (_req: Request, contexto: ContextoNetlify): Promise<void> => {
  const r = await dispararRotina('reconciliar', contexto)
  console.log('[rotina-reconciliar]', r.disparou ? 'disparada' : 'não disparada', '—', r.motivo)
}

// P2.36: a cada 6 h (antes: toda hora). Só corrige render travado e estados velhos; 0 achados há dias.
export const config = { schedule: '0 */6 * * *' }
