import { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { createHash } from 'crypto'
import { prisma } from './prisma'
import { estaBloqueado, ipDaRequisicao, registrarTentativa } from './limite-de-tentativas'

/** Impressão curta do hash da senha: muda quando a senha muda; não revela nada. */
export function versaoDaSenha(hash: string): string {
  return createHash('sha256').update(hash).digest('hex').slice(0, 16)
}

/** Hash bcrypt (custo 12) de um texto qualquer: iguala o tempo quando a conta não existe. */
const HASH_SEM_CONTA = '$2a$12$Cwdvrge/2EfX.iD/7aMSiOiNz1meDRdM6ObYuVIyWI8veTALX1a3e'

/** Releitura de status/papel da sessão no banco (no máximo 1 vez por minuto por sessão). */
const REVALIDAR_A_CADA_MS = 60_000

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: '/login' },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Senha', type: 'password' },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) return null

        // P2.18: limite de tentativas por conta digitada e por IP. Bloqueado →
        // mesma mensagem genérica, exista a conta ou não (sem enumeração), e
        // nem a senha certa entra até a janela passar.
        const alvo = { conta: credentials.email, ip: ipDaRequisicao(req?.headers) }
        if (await estaBloqueado('LOGIN', alvo)) throw new Error('LIMITE')

        // P2.15.3: e-mail sem diferença de maiúsculas (o cadastro antigo guardava como digitado).
        const user = await prisma.user.findFirst({
          where: { email: { equals: credentials.email.trim(), mode: 'insensitive' } },
        })

        // P2.18: conta inexistente também passa pelo bcrypt (mesmo tempo de
        // resposta) — o tempo não pode dizer se o e-mail está cadastrado.
        const passwordMatch = await bcrypt.compare(credentials.password, user?.password ?? HASH_SEM_CONTA)
        if (!user || !passwordMatch) {
          await registrarTentativa('LOGIN', alvo, false)
          return null
        }
        await registrarTentativa('LOGIN', alvo, true)

        if (user.status === 'pendente') throw new Error('PENDENTE')
        if (user.status === 'bloqueado') throw new Error('BLOQUEADO')

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          workspaceId: user.workspaceId,
          senhaVersao: versaoDaSenha(user.password),
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = (user as { role?: string }).role ?? 'usuario'
        token.workspaceId = (user as { workspaceId?: string }).workspaceId
        token.senhaVersao = (user as { senhaVersao?: string }).senhaVersao
        token.verificadoEm = Date.now()
      } else if (token.id && Date.now() - Number(token.verificadoEm ?? 0) > REVALIDAR_A_CADA_MS) {
        // P2.15.3: o JWT vale 30 dias; sem reler o banco, usuária bloqueada ou
        // excluída (e admin rebaixado) continuava com acesso. Lançar aqui faz o
        // NextAuth limpar o cookie: getServerSession passa a devolver null.
        // (Também completa tokens antigos sem workspaceId.)
        const atual = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { workspaceId: true, role: true, status: true, password: true },
        })
        if (!atual || atual.status === 'bloqueado' || atual.status === 'pendente') throw new Error('SESSAO_REVOGADA')
        // P2.15.4: senha trocada (na conta ou por redefinição) derruba as sessões abertas com a senha antiga.
        if (token.senhaVersao && token.senhaVersao !== versaoDaSenha(atual.password)) throw new Error('SESSAO_REVOGADA')
        token.senhaVersao = versaoDaSenha(atual.password)
        token.workspaceId = atual.workspaceId
        token.role = atual.role
        token.verificadoEm = Date.now()
      }
      return token
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string
        session.user.role = token.role as string
        // Todo dado operacional (produto, link, conteúdo, integração,
        // programa, venda, comissão) é isolado por workspaceId — nunca por
        // userId sozinho. Ver lib/workspace.ts e DOCUMENTACAO-PATRONO-SELLER.md.
        session.user.workspaceId = token.workspaceId as string
      }
      return session
    },
  },
}

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      email: string
      name?: string | null
      role: string
      workspaceId: string
    }
  }
}
