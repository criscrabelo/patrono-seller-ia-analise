import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { pedirEnvioDaGravacao } from '@/lib/narracao'
import { respostaDeErroDaNarracao } from '@/lib/narracao-http'

export const dynamic = 'force-dynamic'

/**
 * P2.33.1 — passo ① da GRAVAÇÃO REAL: { mime, tamanho, declaro: true } → URL de envio direto ao bucket
 * PRIVADO (o áudio não passa pela função). Exige a declaração da titular de que a gravação é dela.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const s = await exigirSessao()
  if (s instanceof NextResponse) return s
  const corpo = (await req.json().catch(() => ({}))) as { mime?: unknown; tamanho?: unknown; declaro?: unknown }
  try {
    return NextResponse.json(await pedirEnvioDaGravacao({ workspaceId: s.user.workspaceId, userId: s.user.id, id, mime: corpo.mime, tamanho: corpo.tamanho, declaro: corpo.declaro }))
  } catch (e) {
    return respostaDeErroDaNarracao(e)
  }
}
