import { NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { sincronizarAgora } from '@/lib/sincronizacao-metas-tiktok'
import { respostaDeErroDeMeta } from '@/lib/metas-tiktok-http'

/**
 * P2.17.5 — "Sincronizar metas agora" (execução manual do TikTok Mission Sync).
 * Usa a melhor fonte AUTOMÁTICA disponível; sem fonte, registra a tentativa e
 * responde por quê (200 com status SEM_FONTE) — nunca inventa missão.
 */
export async function POST() {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  try {
    const r = await sincronizarAgora({ workspaceId: session.user.workspaceId, userId: session.user.id, gatilho: 'MANUAL' })
    return NextResponse.json(r)
  } catch (e) {
    return respostaDeErroDeMeta(e)
  }
}
