import { PrismaClient } from '@prisma/client'
import { verificarAmbienteDeSeed } from '../lib/seed-guard'

const prisma = new PrismaClient()

async function main() {
  verificarAmbienteDeSeed('seed-teste-conteudo-video.ts')

  const admin = await prisma.user.findUnique({ where: { email: 'admin@patronosellerai.com' } })
  if (!admin) throw new Error('rode prisma/seed.ts antes')

  // produto com imagem (necessária pra gerar vídeo)
  const produto = await prisma.produto.create({
    data: {
      userId: admin.id, workspaceId: admin.workspaceId,
      nome: 'Produto Teste Vídeo',
      descricao: 'teste',
      preco: 99.9,
      categoria: 'Casa e Decoração',
      origemConteudo: 'manual',
      tipoVenda: 'afiliado',
      imagens: ['https://picsum.photos/400/600'],
    },
  })

  // conteúdo aprovado, com prompt de vídeo, sem vídeo ainda
  const c = await prisma.conteudo.create({
    data: {
      userId: admin.id, workspaceId: admin.workspaceId,
      produtoId: produto.id,
      roteiro: 'Roteiro de teste',
      legendaTiktok: 'Legenda #teste',
      hashtags: ['#teste'],
      promptVideoIA: 'produto girando em fundo neutro',
      promptCurto: 'produto girando',
      redeSocial: 'TikTok',
      status: 'aprovado',
    },
  })
  console.log('CONTEUDO_ID=' + c.id)
}

main().finally(() => prisma.$disconnect())
