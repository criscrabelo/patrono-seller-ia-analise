import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { registrarAuditoria } from '@/lib/audit-log'
import { gerarTokenWorker, listarTokensWorker, revogarTokenWorker } from '@/lib/digital-twin-worker-token'

/** Lista tokens do próprio workspace — nunca o valor bruto/hash, só metadados. */
export async function GET() {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  const tokens = await listarTokensWorker(session.user.workspaceId)
  return NextResponse.json(tokens)
}

/** Gera um novo token de pareamento — devolvido em texto puro só nesta resposta, nunca de novo. */
export async function POST(req: NextRequest) {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const body = await req.json().catch(() => ({}))
  const label = typeof body.label === 'string' ? body.label.slice(0, 100) : undefined

  const criado = await gerarTokenWorker(session.user.workspaceId, label)

  await registrarAuditoria({
    workspaceId: session.user.workspaceId,
    userId: session.user.id,
    action: 'digital_twin.worker_token_created',
    entityType: 'WorkerToken',
    entityId: criado.id,
    metadata: { label: label ?? null }, // nunca o token em si
  })

  return NextResponse.json(criado)
}

/** Revoga um token — o worker que o usava para de conseguir reivindicar jobs imediatamente. */
export async function DELETE(req: NextRequest) {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const { searchParams } = new URL(req.url)
  const tokenId = searchParams.get('id')
  if (!tokenId) return NextResponse.json({ error: 'id é obrigatório.' }, { status: 400 })

  const ok = await revogarTokenWorker(session.user.workspaceId, tokenId)
  if (!ok) return NextResponse.json({ error: 'Token não encontrado.' }, { status: 404 })

  await registrarAuditoria({
    workspaceId: session.user.workspaceId,
    userId: session.user.id,
    action: 'digital_twin.worker_token_revoked',
    entityType: 'WorkerToken',
    entityId: tokenId,
    metadata: {},
  })

  return NextResponse.json({ success: true })
}
