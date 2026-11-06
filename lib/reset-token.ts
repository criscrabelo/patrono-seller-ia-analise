import crypto from 'crypto'
import { prisma } from './prisma'

// Token de redefinição de senha SEM tabela no banco: um payload assinado
// (HMAC) com o NEXTAUTH_SECRET + o hash ATUAL da senha do usuário. Como a
// assinatura depende do hash atual, o token deixa de valer assim que a senha
// muda — ou seja, é de uso único na prática. Também tem validade de 1h.

const SECRET = process.env.NEXTAUTH_SECRET || 'dev-secret-inseguro'
const TTL_MS = 60 * 60 * 1000 // 1 hora

function assinar(payload: string, hashSenha: string): string {
  return crypto.createHmac('sha256', SECRET + hashSenha).update(payload).digest('base64url')
}

export function gerarTokenReset(userId: string, hashSenha: string): string {
  const exp = Date.now() + TTL_MS
  const payload = `${userId}.${exp}`
  const sig = assinar(payload, hashSenha)
  return Buffer.from(`${payload}.${sig}`).toString('base64url')
}

export async function verificarTokenReset(token: string): Promise<{ userId: string } | null> {
  let decoded: string
  try {
    decoded = Buffer.from(token, 'base64url').toString('utf8')
  } catch {
    return null
  }
  const partes = decoded.split('.')
  if (partes.length !== 3) return null
  const [userId, expStr, sig] = partes
  const exp = parseInt(expStr, 10)
  if (!userId || !exp || Number.isNaN(exp) || Date.now() > exp) return null

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { password: true },
  })
  if (!user) return null

  const esperado = assinar(`${userId}.${expStr}`, user.password)
  const a = Buffer.from(sig)
  const b = Buffer.from(esperado)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null

  return { userId }
}
