import { NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { acompanharPublicacoesTikTok } from '@/lib/tiktok-acompanhamento'
import { coletarMetricasOficiais } from '@/lib/coletor-de-metricas-tiktok'
import { respostaDeErroAssistido } from '@/lib/publicacao-assistida-http'

/** P2.17.10 — Consulta agora o status oficial das publicações pendentes no TikTok. */
export async function POST() {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  try {
    const status = await acompanharPublicacoesTikTok({ workspaceId: session.user.workspaceId })
    // P2.17.16 (P1 pós-aprovação): views oficiais dos vídeos publicados — desligado até o app ser aprovado.
    const metricas = await coletarMetricasOficiais({ workspaceId: session.user.workspaceId }).catch(() => null)
    return NextResponse.json({ ...status, metricas })
  } catch (e) {
    return respostaDeErroAssistido(e)
  }
}
