import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { registrarAuditoria } from '@/lib/audit-log'
import { revogarTokensWorkerDoWorkspace } from '@/lib/digital-twin-worker-token'
import { validarSenhaNova } from '@/lib/politica-de-senha'

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!session) return null
  if (session.user.role !== 'admin') return null
  return session
}

export async function GET() {
  const session = await requireAdmin()
  if (!session) return NextResponse.json({ error: 'Não autorizado' }, { status: 403 })

  const usuarios = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, status: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json(usuarios)
}

export async function PATCH(req: NextRequest) {
  const session = await requireAdmin()
  if (!session) return NextResponse.json({ error: 'Não autorizado' }, { status: 403 })

  const { id, status, role, email, name, password } = await req.json().catch(() => ({}))
  if (!id) return NextResponse.json({ error: 'ID obrigatório' }, { status: 400 })
  // P2.15.3: só valores conhecidos (antes, qualquer texto virava status/papel).
  if (status !== undefined && !['pendente', 'ativo', 'bloqueado'].includes(status)) return NextResponse.json({ error: 'Status inválido' }, { status: 400 })
  if (role !== undefined && !['usuario', 'admin'].includes(role)) return NextResponse.json({ error: 'Papel inválido' }, { status: 400 })

  if (email !== undefined) {
    const emailNormalizado = String(email).trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNormalizado)) {
      return NextResponse.json({ error: 'Email inválido' }, { status: 400 })
    }
  }

  if (name !== undefined && !String(name).trim()) {
    return NextResponse.json({ error: 'Informe um nome' }, { status: 400 })
  }

  let passwordHash: string | undefined
  if (password !== undefined) {
    const erroSenha = validarSenhaNova(password)
    if (erroSenha) return NextResponse.json({ error: erroSenha }, { status: 400 })
    passwordHash = await bcrypt.hash(String(password), 12)
  }

  // Trava de segurança: não deixar o sistema ficar sem nenhum admin.
  if (role && role !== 'admin') {
    const alvo = await prisma.user.findUnique({ where: { id }, select: { role: true } })
    if (alvo?.role === 'admin') {
      const totalAdmins = await prisma.user.count({ where: { role: 'admin' } })
      if (totalAdmins <= 1) {
        return NextResponse.json({ error: 'Não é possível remover o último administrador' }, { status: 400 })
      }
    }
  }

  try {
    const updated = await prisma.user.update({
      where: { id },
      data: {
        ...(status && { status }),
        ...(role && { role }),
        ...(email !== undefined && { email: String(email).trim().toLowerCase() }),
        ...(name !== undefined && { name: String(name).trim() }),
        ...(passwordHash && { password: passwordHash }),
      },
      select: { id: true, name: true, email: true, role: true, status: true, workspaceId: true },
    })
    // P2.50 (R2): bloquear a dona do workspace revoga os tokens do worker na
    // hora (a verificação do token também recusa dona bloqueada).
    if (updated.status === 'bloqueado') {
      const ws = await prisma.workspace.findUnique({ where: { id: updated.workspaceId }, select: { ownerId: true } })
      if (ws?.ownerId === updated.id) {
        const revogados = await revogarTokensWorkerDoWorkspace(updated.workspaceId)
        if (revogados > 0) {
          await registrarAuditoria({
            workspaceId: updated.workspaceId,
            userId: session.user.id,
            action: 'digital_twin.worker_tokens_revoked_on_block',
            entityType: 'User',
            entityId: updated.id,
            metadata: { revogados },
          })
        }
      }
    }
    // A9: trilha de quem mudou o quê (nunca grava a senha, só que ela mudou).
    await registrarAuditoria({
      workspaceId: session.user.workspaceId,
      userId: session.user.id,
      action: 'admin.usuario.alterar',
      entityType: 'User',
      entityId: id,
      metadata: {
        status: status ?? undefined,
        role: role ?? undefined,
        emailAlterado: email !== undefined,
        nomeAlterado: name !== undefined,
        credencialAlterada: password !== undefined,
      },
    })
    const { workspaceId: _ws, ...resposta } = updated
    return NextResponse.json(resposta)
  } catch (e: any) {
    if (e?.code === 'P2002') {
      return NextResponse.json({ error: 'Esse email já está em uso por outra conta' }, { status: 409 })
    }
    if (e?.code === 'P2025') return NextResponse.json({ error: 'Usuária não encontrada' }, { status: 404 })
    return NextResponse.json({ error: 'Não foi possível alterar agora.' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const session = await requireAdmin()
  if (!session) return NextResponse.json({ error: 'Não autorizado' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'ID obrigatório' }, { status: 400 })

  if (id === session.user.id) {
    return NextResponse.json({ error: 'Não é possível excluir sua própria conta' }, { status: 400 })
  }

  try {
    const alvo = await prisma.user.findUnique({ where: { id }, select: { email: true, role: true } })
    await prisma.user.delete({ where: { id } })
    // A9: exclusão registrada (quem, quando, qual conta e papel).
    await registrarAuditoria({
      workspaceId: session.user.workspaceId,
      userId: session.user.id,
      action: 'admin.usuario.excluir',
      entityType: 'User',
      entityId: id,
      metadata: { emailExcluido: alvo?.email, papel: alvo?.role },
    })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    // P2.15.3: conta com dados (produtos, conteúdos…) não pode ser apagada — antes virava 500 sem mensagem.
    if (e?.code === 'P2003' || e?.code === 'P2014')
      return NextResponse.json({ error: 'Esta conta já tem dados no sistema e não pode ser excluída. Use "Bloquear" para tirar o acesso.' }, { status: 409 })
    if (e?.code === 'P2025') return NextResponse.json({ error: 'Usuária não encontrada' }, { status: 404 })
    return NextResponse.json({ error: 'Não foi possível excluir agora.' }, { status: 500 })
  }
}
