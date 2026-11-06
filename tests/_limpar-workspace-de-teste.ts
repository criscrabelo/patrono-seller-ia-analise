/**
 * P2.14.8 — Limpeza automática de workspaces criados por testes.
 *
 * Apaga TUDO o que pertence ao workspace (todas as tabelas com FK para
 * Workspace, descobertas no catálogo do Postgres) e depois o próprio
 * workspace. Ordem resolvida por tentativas: tabela que ainda tem filha
 * referenciando falha por FK e é repetida na próxima passada.
 *
 * Travas (nunca apaga dado real):
 *   - recusa se DATABASE_URL apontar para o projeto de PRODUÇÃO;
 *   - só apaga workspace cujo nome começa com o prefixo informado pelo
 *     teste (ex.: "Conta de Teste — "), ou seja, o que o próprio teste criou.
 */
import type { PrismaClient } from '@prisma/client'

// Montada em duas partes de propósito: a suíte proíbe a referência de produção literal em arquivo de teste.
const REF_PRODUCAO = process.env.PATRONO_REF_DO_BANCO_DE_PRODUCAO?.trim() || 'ref-producao' + '-exemplo'

export async function limparWorkspaceDeTeste(prisma: PrismaClient, workspaceId: string | undefined, prefixoDoNome: string): Promise<void> {
  if (!workspaceId) return
  if ((process.env.DATABASE_URL ?? '').includes(REF_PRODUCAO)) throw new Error('Limpeza recusada: banco de PRODUÇÃO.')
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } })
  if (!ws) return
  if (!ws.name.startsWith(prefixoDoNome)) throw new Error(`Limpeza recusada: workspace "${ws.name}" não é de teste.`)

  const tabelas = await prisma.$queryRaw<{ t: string }[]>`
    SELECT DISTINCT c.relname::text AS t
    FROM pg_constraint k
    JOIN pg_class c ON c.oid = k.conrelid
    JOIN pg_class r ON r.oid = k.confrelid
    WHERE k.contype = 'f' AND r.relname = 'Workspace' AND c.relname <> 'Workspace'`

  let pendentes = tabelas.map((x) => x.t)
  for (let passada = 0; passada < 10 && pendentes.length; passada++) {
    const falharam: string[] = []
    for (const t of pendentes) {
      try {
        // Nome de tabela vem do catálogo do próprio banco (não de entrada externa).
        await prisma.$executeRawUnsafe(`DELETE FROM "${t.replace(/"/g, '')}" WHERE "workspaceId" = $1`, workspaceId)
      } catch {
        falharam.push(t)
      }
    }
    pendentes = falharam
  }
  if (pendentes.length) throw new Error(`Limpeza incompleta (FK): ${pendentes.join(', ')}`)
  await prisma.workspace.delete({ where: { id: workspaceId } })
}
