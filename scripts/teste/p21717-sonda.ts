/** P2.17.17 — leitura (só TESTE): missões e candidatos não-catálogo dos workspaces com missões. Não grava. */
import { prisma } from '../../lib/prisma'
async function main() {
  if (!(process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')) throw new Error('só TESTE')
  const metas = await prisma.metaTikTokShop.findMany({ select: { id: true, workspaceId: true, nome: true, tipo: true, fim: true, quantidadeExigida: true, quantidadeRealizada: true, requisitos: true, origem: true } })
  const ws = [...new Set(metas.map((m) => m.workspaceId))]
  const cand = await prisma.candidatoDeProduto.findMany({ where: { workspaceId: { in: ws }, fonte: { not: 'CATALOGO' } }, select: { id: true, workspaceId: true, nome: true, fonte: true, providerId: true, comissaoValor: true, preco: true, vendas: true, categoria: true, status: true } })
  const owners = await prisma.workspace.findMany({ where: { id: { in: ws } }, select: { id: true, nome: true } as never }).catch(() => [])
  for (const m of metas) console.log('META', m.workspaceId.slice(-6), m.id, m.tipo, '|', m.nome, '|', m.fim.toISOString().slice(0, 10), `${m.quantidadeRealizada}/${m.quantidadeExigida}`, m.origem, '|', m.requisitos ?? '')
  for (const c of cand) console.log('CAND', c.workspaceId.slice(-6), c.id, '|', c.nome.slice(0, 70), '|', c.fonte, c.providerId, c.comissaoValor, c.preco, c.vendas, c.status)
  console.log('WS', JSON.stringify(owners))
}
main().finally(() => prisma.$disconnect())
