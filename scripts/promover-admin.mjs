import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const email = 'admin@patronosellerai.com'

  const user = await prisma.user.update({
    where: { email },
    data: { role: 'admin', status: 'ativo' },
  })

  console.log(`✅ Usuário promovido a admin: ${user.email}`)
  console.log(`   role: ${user.role} | status: ${user.status}`)
}

main()
  .catch((e) => { console.error('❌ Erro:', e.message) })
  .finally(() => prisma.$disconnect())
