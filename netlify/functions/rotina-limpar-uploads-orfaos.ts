/**
 * P2.12 — Scheduled Function: limpeza dos uploads órfãos do Digital Twin,
 * 04:30 UTC. Pede execução, mas a rota só apaga com
 * LIMPEZA_UPLOADS_ORFAOS_ATIVA=true — sem ele, é ensaio (relatório, nada
 * apagado). Ver netlify/rotina-interna.ts.
 */
import { dispararRotina, type ContextoNetlify } from '../rotina-interna'

export default async (_req: Request, contexto: ContextoNetlify): Promise<void> => {
  const r = await dispararRotina('limpar-uploads-orfaos', contexto, process.env, fetch, '?modo=execucao')
  console.log('[rotina-limpar-uploads-orfaos]', r.disparou ? 'disparada' : 'não disparada', '—', r.motivo)
}

export const config = { schedule: '30 4 * * *' }
