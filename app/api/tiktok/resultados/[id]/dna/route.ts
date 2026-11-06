import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { exigirSessao } from '@/lib/sessao'
import { informarDna } from '@/lib/dna-criativo'

/**
 * P2.21 — a titular informa o DNA que o Patrono não sabe (rosto, demonstração, narração, texto na tela).
 * true/false = informado; null = volta a desconhecido (UNKNOWN). Ausente = não mexe.
 */
const sn = z.boolean().nullable().optional()
const esquema = z.object({ temRosto: sn, temDemonstracao: sn, temNarracao: sn, temTextoNaTela: sn }).strict()

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  const c = esquema.safeParse(await req.json().catch(() => null))
  if (!c.success) return NextResponse.json({ error: 'Envie temRosto, temDemonstracao, temNarracao ou temTextoNaTela (sim, não ou vazio).' }, { status: 400 })
  const r = await informarDna({ workspaceId: session.user.workspaceId, userId: session.user.id, id, valores: c.data })
  if (!r) return NextResponse.json({ error: 'Resultado não encontrado.' }, { status: 404 })
  return NextResponse.json({ id: r.id })
}
