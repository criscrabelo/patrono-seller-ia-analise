import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { exigirSessaoEFlag, respostaDeErroFase1 } from '@/lib/api-fase1'
import { perguntarAoCopilot } from '@/lib/copilot'

const Corpo = z.object({ texto: z.string().max(300) })

// P2.15: Copilot determinístico — sem IA paga, sem rede externa.
export async function POST(req: NextRequest) {
  const s = await exigirSessaoEFlag('COPILOT_DETERMINISTICO')
  if (s instanceof NextResponse) return s
  const corpo = Corpo.safeParse(await req.json().catch(() => null))
  if (!corpo.success) return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 })
  try {
    return NextResponse.json(await perguntarAoCopilot(corpo.data.texto, s))
  } catch (e) {
    return respostaDeErroFase1(e)
  }
}
