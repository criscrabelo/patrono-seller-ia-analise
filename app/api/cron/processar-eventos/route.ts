import { NextRequest, NextResponse } from 'next/server'
import { chamadaDeOutroAgendador, RESPOSTA_DE_OUTRO_AGENDADOR } from '@/lib/agendador'
import { processarEventos } from '@/lib/processador-de-eventos'
import { REACOES } from '@/lib/reacoes-a-eventos'
import { autorizacaoDeRotinaValida } from '@/lib/segredo-de-rotina'

/**
 * P2.22 — processa os eventos com reação (só workspaces em que o processador foi ATIVADO).
 * Mesma proteção dos outros crons (Bearer CRON_SECRET, fail-closed; um agendador por vez). Agendada de hora em
 * hora no workflow, mas DESLIGADA até PROCESSADOR_DE_EVENTOS_AGENDADO=true (decisão do pacote de Production).
 * As reações são internas: nada é publicado, pedido, enviado ou cobrado.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || !autorizacaoDeRotinaValida(req.headers.get('authorization'), secret)) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  if (chamadaDeOutroAgendador(req.headers)) return NextResponse.json(RESPOSTA_DE_OUTRO_AGENDADOR, { status: 409 })
  // Desligada por padrão: só roda com PROCESSADOR_DE_EVENTOS_AGENDADO=true no app (e só nos workspaces ativados).
  if (process.env.PROCESSADOR_DE_EVENTOS_AGENDADO !== 'true') return NextResponse.json({ ok: true, rotina: 'desligada', motivo: 'PROCESSADOR_DE_EVENTOS_AGENDADO não está ligado' })
  const r = await processarEventos({ reacoes: REACOES, limite: 25, worker: 'cron' })
  return NextResponse.json({ ok: true, processados: r.processados, retries: r.retries, falhas: r.falhas, ignorados: r.ignorados })
}
