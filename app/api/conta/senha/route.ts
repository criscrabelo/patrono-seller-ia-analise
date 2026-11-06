import { validarSenhaNova } from '@/lib/politica-de-senha'
import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'

// Troca de senha pelo próprio usuário logado. Exige a senha atual
// correta antes de aplicar a nova (não precisa de email/serviço externo).
export async function POST(req: NextRequest) {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const { senhaAtual, novaSenha } = await req.json().catch(() => ({}))

  if (!senhaAtual || !novaSenha) {
    return NextResponse.json({ error: 'Preencha a senha atual e a nova senha' }, { status: 400 })
  }
  const erroSenha = validarSenhaNova(novaSenha)
  if (erroSenha) return NextResponse.json({ error: erroSenha }, { status: 400 })

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { password: true },
  })
  if (!user) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

  const confere = await bcrypt.compare(String(senhaAtual), user.password)
  if (!confere) {
    return NextResponse.json({ error: 'Senha atual incorreta' }, { status: 400 })
  }

  const hash = await bcrypt.hash(String(novaSenha), 12)
  await prisma.user.update({ where: { id: session.user.id }, data: { password: hash } })

  return NextResponse.json({ ok: true })
}
