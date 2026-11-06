import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { ativarProcessador, painelDoProcessador, processarEventos, reprocessarEvento } from '@/lib/processador-de-eventos'
import { REACOES, TIPOS_COM_REACAO } from '@/lib/reacoes-a-eventos'

export const dynamic = 'force-dynamic'

/**
 * P2.22 — observabilidade do processador de eventos (só admin).
 * GET  → pendentes, processados, falhos, em retry, última execução, motivos de erro e o corte.
 * POST { acao: 'ativar' | 'processar' | 'reprocessar', eventoId? }
 */
async function sessaoAdmin() {
  const s = await exigirSessao()
  if (s instanceof NextResponse) return s
  if (s.user.role !== 'admin') return NextResponse.json({ error: 'Só a administradora vê o processador de eventos.' }, { status: 403 })
  return s
}

export async function GET() {
  const s = await sessaoAdmin()
  if (s instanceof NextResponse) return s
  return NextResponse.json({ tipos: TIPOS_COM_REACAO, ...(await painelDoProcessador(s.user.workspaceId, TIPOS_COM_REACAO)) })
}

export async function POST(req: NextRequest) {
  const s = await sessaoAdmin()
  if (s instanceof NextResponse) return s
  const corpo = (await req.json().catch(() => null)) as { acao?: string; eventoId?: string } | null
  const ws = s.user.workspaceId
  if (corpo?.acao === 'ativar') {
    const r = await ativarProcessador({ workspaceId: ws, tipos: TIPOS_COM_REACAO, userId: s.user.id })
    return NextResponse.json({ ok: true, novo: r.novo, ignorados: r.corte.ignorados, corte: r.corte.iniciadoEm })
  }
  if (corpo?.acao === 'processar') return NextResponse.json({ ok: true, ...(await processarEventos({ reacoes: REACOES, workspaceId: ws, limite: 25, worker: `titular:${s.user.id}` })) })
  if (corpo?.acao === 'reprocessar' && typeof corpo.eventoId === 'string') {
    const ok = await reprocessarEvento({ workspaceId: ws, eventoId: corpo.eventoId, userId: s.user.id })
    return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Só um evento FALHOU pode ser reprocessado.' }, { status: 409 })
  }
  return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 })
}
