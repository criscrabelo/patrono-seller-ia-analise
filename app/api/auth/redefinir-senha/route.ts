import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarTokenReset } from '@/lib/reset-token'
import bcrypt from 'bcryptjs'
import { validarSenhaNova } from '@/lib/politica-de-senha'

// Recebe o token do email + a nova senha. Valida o token (assinatura +
// validade + ligado ao hash atual) e troca a senha.
export async function POST(req: NextRequest) {
  const { token, novaSenha } = await req.json().catch(() => ({}))

  if (!token || !novaSenha) {
    return NextResponse.json({ error: 'Dados incompletos' }, { status: 400 })
  }
  const erroSenha = validarSenhaNova(novaSenha)
  if (erroSenha) return NextResponse.json({ error: erroSenha }, { status: 400 })

  const res = await verificarTokenReset(String(token))
  if (!res) {
    return NextResponse.json({ error: 'Link inválido ou expirado. Peça um novo.' }, { status: 400 })
  }

  const hash = await bcrypt.hash(String(novaSenha), 12)
  await prisma.user.update({ where: { id: res.userId }, data: { password: hash } })

  return NextResponse.json({ ok: true })
}
