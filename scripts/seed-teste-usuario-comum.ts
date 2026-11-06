import { PrismaClient } from '@prisma/client'
import { verificarAmbienteDeSeed } from '../lib/seed-guard'
import bcrypt from 'bcryptjs'
import { criarUsuarioComWorkspace } from '../lib/workspace'

const prisma = new PrismaClient()

async function main() {
  verificarAmbienteDeSeed('seed-teste-usuario-comum.ts')

  const email = 'usuario.teste@patronosellerai.com'
  const senhaHash = await bcrypt.hash('senha123', 10)

  const existente = await prisma.user.findUnique({ where: { email } })
  const user = existente
    ? await prisma.user.update({
        where: { email },
        data: { role: 'usuario', status: 'ativo', password: senhaHash },
      })
    : (
        await criarUsuarioComWorkspace(prisma, {
          name: 'Usuário Teste',
          email,
          password: senhaHash,
          role: 'usuario',
          status: 'ativo',
        })
      ).user

  console.log('Usuário comum criado:', user.email)
}

main().finally(() => prisma.$disconnect())
