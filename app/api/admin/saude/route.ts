import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { saudeOperacional } from '@/lib/saude-operacional'
import { reconciliarEstadoOperacional, ultimaReconciliacao } from '@/lib/reconciliacao'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * P2.28 — health check operacional (só admin).
 * GET  → veredito + indicadores + agendamentos + o que a última reconciliação achou.
 * POST { acao: 'reconciliar' } → roda a reconciliação agora nesta conta (detecta; corrige só o seguro).
 * POST { acao: 'conferir' }    → P2.29: só detecta, sem alterar nenhum dado (o "antes" do plano de reconciliação).
 */
async function sessaoAdmin() {
  const s = await exigirSessao()
  if (s instanceof NextResponse) return s
  if (s.user.role !== 'admin') return NextResponse.json({ error: 'Só a administradora vê a saúde do sistema.' }, { status: 403 })
  return s
}

export async function GET() {
  const s = await sessaoAdmin()
  if (s instanceof NextResponse) return s
  const [saude, rec] = await Promise.all([saudeOperacional(s.user.workspaceId), ultimaReconciliacao(s.user.workspaceId)])
  return NextResponse.json({ ...saude, reconciliacao: rec })
}

export async function POST(req: NextRequest) {
  const s = await sessaoAdmin()
  if (s instanceof NextResponse) return s
  const corpo = (await req.json().catch(() => null)) as { acao?: string } | null
  if (corpo?.acao !== 'reconciliar' && corpo?.acao !== 'conferir') return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 })
  const corrigir = corpo.acao === 'reconciliar'
  const r = await reconciliarEstadoOperacional(s.user.workspaceId, { origem: `titular:${s.user.id}`, corrigir })
  if (r.emAndamento) return NextResponse.json({ error: 'Já há uma reconciliação rodando nesta conta. Aguarde e atualize.' }, { status: 409 })
  return NextResponse.json({ ok: true, corrigir, corrigidos: r.corrigidos, paraVoce: r.paraVoce, admin: r.admin, achados: r.achados.length })
}
