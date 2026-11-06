import { NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { prisma } from '@/lib/prisma'
import { MODULO_KEYS } from '@/lib/modulos'

// Retorna os módulos liberados para o papel do usuário logado.
// Admin sempre vê tudo, sem consultar o banco. Módulo sem registro
// explícito é considerado liberado (default-allow).
export async function GET() {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  if (session.user.role === 'admin') {
    return NextResponse.json({ modulos: MODULO_KEYS })
  }

  const bloqueados = await prisma.moduloPermissao.findMany({
    where: { role: session.user.role, liberado: false },
    select: { modulo: true },
  })
  const bloqueadosSet = new Set(bloqueados.map((b) => b.modulo))

  return NextResponse.json({
    modulos: MODULO_KEYS.filter((m) => !bloqueadosSet.has(m)),
  })
}
