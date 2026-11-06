import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { exigirSessaoEFlag, respostaDeErroFase1 } from '@/lib/api-fase1'
import { decidirPrecisaDeVoce } from '@/lib/precisa-de-voce'

const Corpo = z.object({
  decisao: z.enum(['APROVAR', 'REJEITAR']),
  motivo: z.string().max(500).nullish(),
  sempre: z.boolean().optional(),
})

// P2.15: a titular decide; a ação aprovada é executada na hora pelos motores.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await exigirSessaoEFlag('CENTRAL_DE_APROVACOES')
  if (s instanceof NextResponse) return s
  const corpo = Corpo.safeParse(await req.json().catch(() => null))
  if (!corpo.success) return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 })
  try {
    const { id } = await params
    return NextResponse.json(await decidirPrecisaDeVoce({ workspaceId: s.workspaceId, userId: s.userId, id, ...corpo.data }))
  } catch (e) {
    return respostaDeErroFase1(e)
  }
}
