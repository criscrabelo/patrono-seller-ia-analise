import { PrismaClient } from '@prisma/client'
import { verificarAmbienteDeSeed } from '../lib/seed-guard'
const prisma = new PrismaClient()
async function main() {
  verificarAmbienteDeSeed('seed-teste-duracao30.ts')
  const admin = await prisma.user.findUnique({ where: { email: 'admin@patronosellerai.com' } })
  if (!admin) throw new Error('rode prisma/seed.ts antes')
  const produto = await prisma.produto.create({
    data: {
      userId: admin.id, workspaceId: admin.workspaceId, nome: 'Produto Teste Duracao30', descricao: 'teste', preco: 50,
      categoria: 'Casa e Decoração', origemConteudo: 'manual', tipoVenda: 'afiliado',
      imagens: ['https://picsum.photos/400/600'],
    },
  })
  const c = await prisma.conteudo.create({
    data: {
      userId: admin.id, workspaceId: admin.workspaceId, produtoId: produto.id, roteiro: 'Roteiro teste',
      legendaTiktok: 'Legenda #teste', hashtags: ['#teste'],
      promptVideoIA: 'produto girando', promptCurto: 'produto girando',
      redeSocial: 'TikTok', status: 'aprovado', duracao: 30,
    },
  })
  console.log('CONTEUDO_ID=' + c.id)
}
main().finally(() => prisma.$disconnect())
