import { NextRequest, NextResponse } from 'next/server'
import { chamadaDeOutroAgendador, RESPOSTA_DE_OUTRO_AGENDADOR } from '@/lib/agendador'
import { limparPreviasVencidas } from '@/lib/digital-twin-exclusao'
import { limparNarracoesVencidas } from '@/lib/narracao'

/**
 * P2.33.1 — RETENÇÃO de material biométrico: prévias vencidas do Digital Twin e narrações vencidas
 * saem do storage privado e do banco, com remoção CONFIRMADA (o registro só sai quando o arquivo sumiu).
 * Mesma proteção dos outros crons. DESLIGADA até LIMPEZA_BIOMETRICA_AGENDADA=true (o worker local já
 * faz a mesma limpeza de hora em hora enquanto roda). Nunca toca referência permanente nem publicada.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  if (chamadaDeOutroAgendador(req.headers)) return NextResponse.json(RESPOSTA_DE_OUTRO_AGENDADOR, { status: 409 })
  if (process.env.LIMPEZA_BIOMETRICA_AGENDADA !== 'true') return NextResponse.json({ ok: true, rotina: 'desligada', motivo: 'LIMPEZA_BIOMETRICA_AGENDADA não está ligado' })
  const previas = await limparPreviasVencidas()
  const narracoes = await limparNarracoesVencidas()
  return NextResponse.json({ ok: true, previas, narracoes })
}
