import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { painelAssistido, prepararProximaPublicacao } from '@/lib/publicacao-assistida'
import { respostaDeErroAssistido } from '@/lib/publicacao-assistida-http'
import { assinarMidiasPrivadasNaResposta, SEM_CACHE } from '@/lib/midia-privada'

/** P2.17.10 — Modo assistido: contador x/10, publicação atual, histórico e relatório. */
export async function GET() {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  try {
    return NextResponse.json(await assinarMidiasPrivadasNaResposta(await painelAssistido(session.user.workspaceId), session.user.workspaceId), { headers: SEM_CACHE })
  } catch (e) {
    return respostaDeErroAssistido(e)
  }
}

/**
 * O Patrono escolhe, gera o roteiro, gera o VÍDEO (se houver mídia
 * autorizada), checa e apresenta a próxima (nada é publicado). Com uma em
 * andamento, só a leva adiante — chamar de novo não duplica nada.
 */
export async function POST(req: NextRequest) {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  try {
    // P2.18: { candidatoEmMaos } = a titular declarou ter este produto em mãos.
    const corpo = (await req.json().catch(() => ({}))) as { candidatoEmMaos?: unknown }
    const candidatoEmMaos = typeof corpo.candidatoEmMaos === 'string' && corpo.candidatoEmMaos.trim() ? corpo.candidatoEmMaos.trim() : undefined
    const a = await prepararProximaPublicacao({ workspaceId: session.user.workspaceId, userId: session.user.id, origem: req.nextUrl.origin, candidatoEmMaos })
    return NextResponse.json({ id: a.id, estado: a.estado }, { status: 201 })
  } catch (e) {
    return respostaDeErroAssistido(e)
  }
}
