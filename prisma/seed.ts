import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { criarUsuarioComWorkspace } from '../lib/workspace'
import { verificarAmbienteDeSeed } from '../lib/seed-guard'

/**
 * Seed — apenas o primeiro administrador.
 *
 * REGRA PERMANENTE: "zero significa zero".
 * Uma conta recém-criada começa com 0 produtos, 0 links, 0 cliques, 0 vendas,
 * R$ 0,00 de comissão e 0 publicações. Este arquivo NÃO cria produtos,
 * links, vendas nem qualquer número de exemplo.
 *
 * (Versões anteriores criavam "Power Bank 20000mAh" e "Fone Bluetooth Premium"
 * com IDs fixos. Removidos: eram dados fictícios entrando no banco real.)
 *
 * Dados de demonstração, quando necessários para teste, ficam em um banco
 * isolado e nunca neste arquivo.
 */

const prisma = new PrismaClient()

async function main() {
  verificarAmbienteDeSeed('prisma/seed.ts')

  // P2.50: sem credencial padrão no código — o seed exige as variáveis (e nunca roda em Production por acaso).
  const email = process.env.SEED_ADMIN_EMAIL
  const senha = process.env.SEED_ADMIN_PASSWORD
  if (!email || !senha || senha.length < 12) throw new Error('Defina SEED_ADMIN_EMAIL e SEED_ADMIN_PASSWORD (12+ caracteres) para rodar o seed.')
  if (process.env.PATRONO_AMBIENTE === 'producao') throw new Error('O seed não roda em Production.')

  // upsert não serve aqui: criar a usuária exige criar o workspace dela
  // junto (ver lib/workspace.ts), então checamos manualmente se já existe.
  const existente = await prisma.user.findUnique({ where: { email } })

  const admin =
    existente ??
    (
      await criarUsuarioComWorkspace(prisma, {
        email,
        password: await bcrypt.hash(senha, 12),
        name: 'Administrador',
        role: 'admin',
        status: 'ativo',
      })
    ).user

  console.log(`Administrador pronto: ${admin.email}`)
  console.log('Nenhum produto, link ou venda foi criado (estado zerado).')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
