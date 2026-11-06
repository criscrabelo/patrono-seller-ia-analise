import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { exigirSessao } from '@/lib/sessao'
import { registrarAuditoria } from '@/lib/audit-log'
import { reconciliarEstadoDoWorkspace, recomecarOperacao } from '@/lib/produto-canonico'

export const dynamic = 'force-dynamic'

/**
 * P2.18.11 — RECOMEÇAR OPERAÇÃO (só a titular/admin, com a palavra de confirmação).
 * GET  → o que seria arquivado (prévia; só leitura).
 * POST { confirmacao: 'RECOMEÇAR' } → arquiva a operação visível; histórico, usuários,
 *      integrações, configurações e aprendizado ficam.
 */
export async function GET() {
  const s = await exigirSessao()
  if (s instanceof NextResponse) return s
  if (s.user.role !== 'admin') return NextResponse.json({ error: 'Só a titular pode recomeçar a operação.' }, { status: 403 })
  return NextResponse.json(await reconciliarEstadoDoWorkspace(s.user.workspaceId))
}

const esquema = z.object({ confirmacao: z.literal('RECOMEÇAR') })

export async function POST(req: NextRequest) {
  const s = await exigirSessao()
  if (s instanceof NextResponse) return s
  if (s.user.role !== 'admin') return NextResponse.json({ error: 'Só a titular pode recomeçar a operação.' }, { status: 403 })
  if (!esquema.safeParse(await req.json().catch(() => ({}))).success) return NextResponse.json({ error: 'Para confirmar, escreva RECOMEÇAR.' }, { status: 400 })
  const r = await recomecarOperacao({ workspaceId: s.user.workspaceId, userId: s.user.id })
  await registrarAuditoria({ workspaceId: s.user.workspaceId, userId: s.user.id, action: 'operacao.recomecada', entityType: 'Workspace', entityId: s.user.workspaceId, metadata: { ...r } })
  return NextResponse.json(r)
}
