import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { registrarAuditoria } from '@/lib/audit-log'
import { restaurarProduto } from '@/lib/produto-canonico'

/** P2.18.11 — Restaurar um produto excluído: volta a ser elegível em todas as áreas. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  const r = await restaurarProduto({ workspaceId: session.user.workspaceId, userId: session.user.id, produtoId: id })
  if (!r) return NextResponse.json({ error: 'Produto não encontrado' }, { status: 404 })
  await registrarAuditoria({ workspaceId: session.user.workspaceId, userId: session.user.id, action: 'produto.restaurado', entityType: 'Produto', entityId: id, metadata: { candidatosRestaurados: r.candidatosRestaurados } })
  return NextResponse.json({ success: true, ...r })
}
