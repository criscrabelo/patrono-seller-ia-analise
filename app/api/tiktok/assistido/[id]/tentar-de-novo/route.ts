import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { publicarAprovada } from '@/lib/publicacao-assistida'
import { esquemaTentarDeNovo, lerCorpo, respostaDeErroAssistido } from '@/lib/publicacao-assistida-http'

/** Tenta publicar de novo uma aprovada (bloqueada ou com falha definitiva). Envio incerto pede conferência antes. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  const bruto = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const corpo = lerCorpo(esquemaTentarDeNovo, bruto)
  if (!corpo.ok) return corpo.resposta
  try {
    // P2.27: depois de envio incerto, só tenta de novo com a conferência explícita do perfil (auditada).
    const a = await publicarAprovada({ workspaceId: session.user.workspaceId, userId: session.user.id, id, privacidade: corpo.dados.privacidade ?? null, conferiuOPerfil: bruto.conferiuOPerfil === true })
    return NextResponse.json({ id: a.id, estado: a.estado, bloqueio: a.bloqueio, erro: a.erro })
  } catch (e) {
    return respostaDeErroAssistido(e)
  }
}
