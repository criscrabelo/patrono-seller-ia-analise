import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { prisma } from '@/lib/prisma'
import { upsertPrograma, STATUS_PROGRAMA } from '@/lib/affiliate-program'
import { z } from 'zod'

// "Meus Programas" — Programa × Operação × Integração (design_handoff §6).
// Cadastro manual: nunca autentica, nunca conecta, nunca simula token.
// Nesta rodada a Operação é sempre MANUAL; Integração é sempre
// NOT_AVAILABLE/FUTURE a menos que já exista uma Integracao real conectada
// (ver lib/affiliate-program.ts, que recusa CONNECTED fictício).

const programaSchema = z.object({
  platform: z.string().min(1),
  status: z.enum(STATUS_PROGRAMA).optional(),
  accountName: z.string().optional(),
  accessLink: z.string().url().optional().or(z.literal('')),
  notes: z.string().optional(),
})

export async function GET() {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const programas = await prisma.affiliateProgram.findMany({
    where: { workspaceId: session.user.workspaceId },
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json(programas)
}

export async function POST(req: NextRequest) {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const body = await req.json().catch(() => ({}))
  const parsed = programaSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados inválidos', details: parsed.error.flatten() }, { status: 400 })
  }

  const { platform, status, accountName, accessLink, notes } = parsed.data

  // Conta/link de acesso e observações não têm coluna própria ainda no
  // modelo (o Design não pede senha da plataforma externa — só um lembrete
  // de acesso) — guardamos em `notes` como texto legível, sem inventar
  // estrutura que o Design não pediu.
  const notasCompostas = [
    accountName && `Conta: ${accountName}`,
    accessLink && `Link de acesso: ${accessLink}`,
    notes,
  ]
    .filter(Boolean)
    .join('\n')

  try {
    const programa = await upsertPrograma({
      workspaceId: session.user.workspaceId,
      platform,
      status,
      // Nesta fase, Operação é sempre MANUAL — a API nem aceita esse campo
      // do corpo da requisição, então a interface não tem como mudar isso.
      operationMode: 'MANUAL',
      notes: notasCompostas || null,
      actorUserId: session.user.id,
    })
    return NextResponse.json(programa, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Não foi possível salvar o programa'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
