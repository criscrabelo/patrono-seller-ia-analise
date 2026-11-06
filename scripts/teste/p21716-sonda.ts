/** P2.17.16 — leitura (só TESTE) do estado real da conta: integrações, missões, candidatos. Não grava nada; não imprime segredo. */
import { prisma } from '../../lib/prisma'
async function main() {
  const ws = process.argv[2]
  if (!(process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')) throw new Error('só TESTE')
  const integ = await prisma.integracao.findMany({ where: { workspaceId: ws }, select: { plataforma: true, status: true, updatedAt: true } })
  const metas = await prisma.metaTikTokShop.findMany({ where: { workspaceId: ws }, select: { nome: true, tipo: true, origem: true, fim: true, quantidadeExigida: true, quantidadeRealizada: true, recompensaValor: true, status: true, fonteSincronizacao: true, createdAt: true } }).catch((e) => String(e).slice(0, 200))
  const cand = await prisma.candidatoDeProduto.groupBy({ by: ['fonte', 'providerId', 'status'], where: { workspaceId: ws }, _count: { _all: true } })
  const assist = await prisma.publicacaoAssistida.findMany({ where: { workspaceId: ws }, select: { estado: true, nomeProduto: true, demonstracao: true } })
  const programas = await prisma.affiliateProgram.findMany({ where: { workspaceId: ws }, select: { platform: true, status: true } })
  console.log(JSON.stringify({ integ, metas, cand, assist, programas }, null, 1))
}
main().finally(() => prisma.$disconnect())
