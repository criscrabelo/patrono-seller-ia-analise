/**
 * P2.9 — Scheduled Function: retenção dos registros de tarefas, 04:00 UTC.
 * Pede execução, mas a rota só aplica com EXPURGO_TAREFAS_ATIVO=true —
 * sem ele, é ensaio (relatório, nada alterado). Ver netlify/rotina-interna.ts.
 */
import { dispararRotina, type ContextoNetlify } from '../rotina-interna'

export default async (_req: Request, contexto: ContextoNetlify): Promise<void> => {
  const r = await dispararRotina('expurgar-tarefas', contexto, process.env, fetch, '?modo=execucao')
  console.log('[rotina-expurgar-tarefas]', r.disparou ? 'disparada' : 'não disparada', '—', r.motivo)
}

export const config = { schedule: '0 4 * * *' }
