import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { exigirSessao } from '@/lib/sessao'
import { lerTextoDeMetas } from '@/lib/importar-metas-tiktok'

/**
 * P2.17.4 — Lê o texto copiado do print da tela de metas e devolve um
 * RASCUNHO para revisão. NÃO grava nada: salvar é outra rota, que exige a
 * confirmação explícita da titular depois de revisar.
 */
const corpo = z.object({ texto: z.string().trim().min(1).max(10_000) })

export async function POST(req: NextRequest) {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  const lido = corpo.safeParse(await req.json().catch(() => null))
  if (!lido.success) return NextResponse.json({ error: 'Cole o texto da tela de metas (até 10.000 caracteres).' }, { status: 400 })
  return NextResponse.json({ rascunho: lerTextoDeMetas(lido.data.texto) })
}
