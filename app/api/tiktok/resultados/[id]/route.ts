import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { atualizarMetricas } from '@/lib/resultados-videos'
import { esquemaMetricas, lerCorpo, respostaDeErroAssistido } from '@/lib/publicacao-assistida-http'

/** Registra as métricas reais de um vídeo (manual até existir a API). Ausente = não mexe; null = desconhecido. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  const corpo = lerCorpo(esquemaMetricas, await req.json().catch(() => null))
  if (!corpo.ok) return corpo.resposta
  try {
    const r = await atualizarMetricas({ workspaceId: session.user.workspaceId, userId: session.user.id, id, metricas: corpo.dados, origem: 'MANUAL' })
    return NextResponse.json({ id: r.id })
  } catch (e) {
    return respostaDeErroAssistido(e)
  }
}
