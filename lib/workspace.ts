import { randomUUID } from 'crypto'
import type { Prisma, PrismaClient } from '@prisma/client'

/**
 * Cria uma usuária E o workspace dela, atomicamente.
 *
 * Hoje o modelo é 1:1 — cada usuária é dona de exatamente um workspace,
 * criado junto com a conta (não existe ainda o conceito de várias usuárias
 * compartilhando o mesmo workspace; ver DOCUMENTACAO-PATRONO-SELLER.md,
 * seção Workspace, "decisões já tomadas").
 *
 * Nunca crie um `User` diretamente com `prisma.user.create` fora daqui —
 * ele ficaria sem workspace, e toda leitura/escrita de dados operacionais
 * (produtos, links, conteúdos, integrações, vendas, comissões) depende de
 * `workspaceId` existir sempre.
 *
 * O id da usuária é gerado aqui (em vez de deixar o Prisma gerar com
 * `@default(cuid())`) porque o workspace precisa apontar pra ele em
 * `ownerId` antes da usuária existir. Isso só é possível porque
 * `Workspace.ownerId` é só proveniência (sem chave estrangeira) — a ordem
 * de criação abaixo (workspace, depois usuária) é a que respeita a
 * fronteira que É obrigatória: `User.workspaceId -> Workspace.id`.
 */
export async function criarUsuarioComWorkspace(
  prisma: PrismaClient | Prisma.TransactionClient,
  dados: {
    email: string
    password: string
    name?: string | null
    role?: string
    status?: string
  }
) {
  const userId = randomUUID()

  return (prisma as PrismaClient).$transaction(async (tx) => {
    const workspace = await tx.workspace.create({
      data: {
        name: `${dados.name ?? dados.email} — Workspace`,
        ownerId: userId,
      },
    })

    const user = await tx.user.create({
      data: {
        id: userId,
        email: dados.email,
        password: dados.password,
        name: dados.name ?? null,
        role: dados.role ?? 'usuario',
        status: dados.status ?? 'pendente',
        workspaceId: workspace.id,
      },
    })

    return { user, workspace }
  })
}
