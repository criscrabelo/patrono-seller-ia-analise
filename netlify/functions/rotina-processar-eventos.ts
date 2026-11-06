/** P2.29 — Scheduled Function: processador de eventos (P2.22), de hora em hora (UTC). A rota só roda com PROCESSADOR_DE_EVENTOS_AGENDADO=true e só nos workspaces ativados. Ver netlify/rotina-interna.ts. */
import { dispararRotina, type ContextoNetlify } from '../rotina-interna'

export default async (_req: Request, contexto: ContextoNetlify): Promise<void> => {
  const r = await dispararRotina('processar-eventos', contexto)
  console.log('[rotina-processar-eventos]', r.disparou ? 'disparada' : 'não disparada', '—', r.motivo)
}

// P2.36: a cada 3 h (antes: toda hora). Sem eventos, cada disparo era só partida a frio (~9 s de duas funções) —
// o maior gasto de créditos da Netlify. As reações (preço, amostra, publicação, comissão) toleram até 3 h.
export const config = { schedule: '0 */3 * * *' }
