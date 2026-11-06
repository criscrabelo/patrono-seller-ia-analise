import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { criarUsuarioComWorkspace } from '@/lib/workspace'
import { z } from 'zod'
import { validarSenhaNova } from '@/lib/politica-de-senha'
import { estaBloqueado, ipDaRequisicao, registrarTentativa, MENSAGEM_DE_LIMITE } from '@/lib/limite-de-tentativas'

const schema = z.object({
  name: z.string().min(2),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
})

export async function POST(req: NextRequest) {
  // P2.18: cadastro limitado por IP (a conta nasce pendente, mas sem limite
  // qualquer um encheria a fila de aprovação).
  const alvo = { ip: ipDaRequisicao(req.headers) }
  if (await estaBloqueado('CADASTRO', alvo)) return NextResponse.json({ error: MENSAGEM_DE_LIMITE }, { status: 429 })
  await registrarTentativa('CADASTRO', alvo, false)

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })
  }

  const { name, email, password } = parsed.data
  const erroSenha = validarSenhaNova(password)
  if (erroSenha) return NextResponse.json({ error: erroSenha }, { status: 400 })

  const exists = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } })

  // A6: o hash roda sempre, para o tempo de resposta não revelar se o e-mail já existe.
  const hashed = await bcrypt.hash(password, 12)

  // A6: resposta idêntica para e-mail novo e já cadastrado (sem enumeração de contas).
  // Quem já tem conta continua podendo entrar ou usar "esqueci a senha".
  if (exists) {
    // Iguala o custo de banco do caminho "novo" (transação com 2 escritas): sem isso o tempo de resposta
    // ainda distinguiria e-mail novo de existente. Mitiga, não elimina; o limite por IP segue valendo.
    await prisma.$transaction(async (tx) => {
      await tx.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } })
      await tx.workspace.findFirst({ select: { id: true } })
    })
    return NextResponse.json({ ok: true }, { status: 201 })
  }

  // Cria a usuária e o workspace dela junto (toda usuária precisa de um
  // workspace — é o que isola os dados dela dos de outras contas).
  try {
    await criarUsuarioComWorkspace(prisma, {
      name,
      email,
      password: hashed,
      role: 'usuario',
      status: 'pendente',
    })
  } catch (e) {
    // Duas requisições simultâneas com o mesmo e-mail novo: a perdedora bate no @unique. Responde igual (sem 500).
    if ((e as { code?: string })?.code !== 'P2002') throw e
  }

  return NextResponse.json({ ok: true }, { status: 201 })
}
