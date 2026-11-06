import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { exigirSessao } from '@/lib/sessao'
import { criarUrlDeEnvioPrivado } from '@/lib/supabase'
import { caminhoDeEnvio, validarEnvio } from '@/lib/envio-de-midia'

export const dynamic = 'force-dynamic'

const esquema = z.object({
  tipo: z.string().min(3).max(100),
  tamanho: z.number().int().positive(),
  nome: z.string().max(200).optional(),
  prefixo: z.string().max(80).optional(),
})

/**
 * P2.18.6 — Token de envio para o NAVEGADOR subir a foto/vídeo direto ao
 * storage (sem passar pela função, sem limite de corpo). O storage recusa
 * escrita anônima (RLS); o token assinado vale só para UM caminho, dentro do
 * workspace da sessão, sem sobrescrever.
 */
export async function POST(req: NextRequest) {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  const corpo = esquema.safeParse(await req.json().catch(() => ({})))
  if (!corpo.success) return NextResponse.json({ error: 'Dados do arquivo inválidos.' }, { status: 400 })
  const erro = validarEnvio(corpo.data)
  if (erro) return NextResponse.json({ error: erro }, { status: 400 })
  const { bucket, path } = caminhoDeEnvio({ workspaceId: session.user.workspaceId, ...corpo.data })
  try {
    const { token } = await criarUrlDeEnvioPrivado(bucket, path)
    return NextResponse.json({ bucket, path, token })
  } catch {
    return NextResponse.json({ error: 'Não consegui preparar o envio. Tente de novo.' }, { status: 502 })
  }
}
