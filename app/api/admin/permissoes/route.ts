import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { MODULOS, MODULO_KEYS } from '@/lib/modulos'

const ROLE_CONFIGURAVEL = 'usuario'

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!session) return null
  if (session.user.role !== 'admin') return null
  return session
}

// Lista todos os módulos com o estado atual (liberado/bloqueado) pro papel
// configurável ("usuario"). Sem registro no banco = liberado (default).
export async function GET() {
  const session = await requireAdmin()
  if (!session) return NextResponse.json({ error: 'Não autorizado' }, { status: 403 })

  const registros = await prisma.moduloPermissao.findMany({
    where: { role: ROLE_CONFIGURAVEL },
  })
  const mapa = new Map(registros.map((r) => [r.modulo, r.liberado]))

  return NextResponse.json(
    MODULOS.map((m) => ({ ...m, liberado: mapa.get(m.key) ?? true }))
  )
}

export async function POST(req: NextRequest) {
  const session = await requireAdmin()
  if (!session) return NextResponse.json({ error: 'Não autorizado' }, { status: 403 })

  const { modulo, liberado } = await req.json().catch(() => ({}))
  if (!modulo || typeof liberado !== 'boolean') {
    return NextResponse.json({ error: 'Informe modulo e liberado' }, { status: 400 })
  }
  if (!(MODULO_KEYS as string[]).includes(modulo)) {
    return NextResponse.json({ error: 'Módulo desconhecido' }, { status: 400 })
  }

  const atualizado = await prisma.moduloPermissao.upsert({
    where: { role_modulo: { role: ROLE_CONFIGURAVEL, modulo } },
    update: { liberado },
    create: { role: ROLE_CONFIGURAVEL, modulo, liberado },
  })

  return NextResponse.json(atualizado)
}
