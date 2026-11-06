/**
 * P2.14.7 (Fase 0A) — Cofre: criptografia em repouso dos segredos persistidos.
 *
 * AES-256-GCM (autenticada). Formato: `enc:v1:<kid>:<iv>:<tag>:<cifra>`
 * (base64url). `kid` = 8 hex do SHA-256 da chave, para saber qual chave
 * decifra (rotação). O nome do campo entra como dado associado (AAD): um
 * valor cifrado copiado para outro campo NÃO decifra — troca e adulteração
 * são detectadas.
 *
 * Chaves (nunca no código, nunca em log):
 *   TOKENS_ENCRYPTION_KEY           — atual (32 bytes em hex ou base64)
 *   TOKENS_ENCRYPTION_KEY_ANTERIOR  — opcional, só para decifrar na rotação
 *
 * Política fail-closed:
 *   - gravar segredo sem chave → ERRO (nunca grava texto puro);
 *   - ler valor cifrado sem a chave certa → ERRO;
 *   - ler valor legado em texto puro → devolvido como está (transição) e
 *     sinalizado por `estaCifrado()`; a rotina de migração o cifra.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

export const PREFIXO_CIFRADO = 'enc:v1:'

export class ErroDoCofre extends Error {
  constructor(mensagem: string) {
    super(`[cofre] ${mensagem}`)
  }
}

interface Chave {
  kid: string
  key: Buffer
}

function lerChave(bruta: string | undefined): Chave | null {
  const v = (bruta ?? '').trim()
  if (!v) return null
  let key: Buffer | null = null
  if (/^[0-9a-fA-F]{64}$/.test(v)) key = Buffer.from(v, 'hex')
  else {
    const b = Buffer.from(v.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    if (b.length === 32) key = b
  }
  if (!key || key.length !== 32) throw new ErroDoCofre('chave inválida: use 32 bytes em hex (64 caracteres) ou base64.')
  return { kid: createHash('sha256').update(key).digest('hex').slice(0, 8), key }
}

export function chavesDoCofre(env: Record<string, string | undefined> = process.env): { atual: Chave | null; todas: Chave[] } {
  const atual = lerChave(env.TOKENS_ENCRYPTION_KEY)
  const anterior = lerChave(env.TOKENS_ENCRYPTION_KEY_ANTERIOR)
  return { atual, todas: [atual, anterior].filter((c): c is Chave => c !== null) }
}

export function cofreConfigurado(env: Record<string, string | undefined> = process.env): boolean {
  try {
    return chavesDoCofre(env).atual !== null
  } catch {
    return false
  }
}

export function estaCifrado(valor: unknown): boolean {
  return typeof valor === 'string' && valor.startsWith(PREFIXO_CIFRADO)
}

const b64u = (b: Buffer) => b.toString('base64url')

/** Cifra `texto` ligado ao `campo` (AAD). Idempotente: valor já cifrado volta igual. */
export function cifrar(texto: string, campo: string, env: Record<string, string | undefined> = process.env): string {
  if (estaCifrado(texto)) return texto
  const { atual } = chavesDoCofre(env)
  if (!atual) throw new ErroDoCofre('TOKENS_ENCRYPTION_KEY ausente: o segredo NÃO será gravado em texto puro.')
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', atual.key, iv)
  c.setAAD(Buffer.from(campo, 'utf8'))
  const cifra = Buffer.concat([c.update(texto, 'utf8'), c.final()])
  return `${PREFIXO_CIFRADO}${atual.kid}:${b64u(iv)}:${b64u(c.getAuthTag())}:${b64u(cifra)}`
}

/** Decifra. Texto puro legado volta como está (ver `estaCifrado`). */
export function decifrar(valor: string, campo: string, env: Record<string, string | undefined> = process.env): string {
  if (!estaCifrado(valor)) return valor
  const partes = valor.slice(PREFIXO_CIFRADO.length).split(':')
  if (partes.length !== 4) throw new ErroDoCofre('valor cifrado malformado.')
  const [kid, iv, tag, cifra] = partes
  const chave = chavesDoCofre(env).todas.find((k) => k.kid === kid)
  if (!chave) throw new ErroDoCofre(`nenhuma chave disponível decifra o kid ${kid} (rotação incompleta ou chave ausente).`)
  try {
    const d = createDecipheriv('aes-256-gcm', chave.key, Buffer.from(iv, 'base64url'))
    d.setAAD(Buffer.from(campo, 'utf8'))
    d.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([d.update(Buffer.from(cifra, 'base64url')), d.final()]).toString('utf8')
  } catch {
    throw new ErroDoCofre(`falha de autenticação ao decifrar ${campo} (valor adulterado ou de outro campo).`)
  }
}

/** Precisa recifrar com a chave atual? (rotação) */
export function precisaRecifrar(valor: unknown, env: Record<string, string | undefined> = process.env): boolean {
  if (typeof valor !== 'string' || !valor) return false
  if (!estaCifrado(valor)) return true
  const atual = chavesDoCofre(env).atual
  return !!atual && !valor.startsWith(`${PREFIXO_CIFRADO}${atual.kid}:`)
}

// ── Segredos dentro de JSON (ex.: Integracao.extraData) ─────────────────

/**
 * Chaves de JSON tratadas como segredo. Por nome — conservador de propósito.
 * "chave" sozinha NÃO conta (P2.14.8): `chaveDeOrigem`, `chaves`,
 * `chaveIdempotencia` são identificadores, não segredos. Só chave secreta,
 * de API, privada ou de acesso.
 */
export const PADRAO_CHAVE_SECRETA = /(secret|token|senha|password|apikey|api_key|partnerkey|clientkey|privatekey|chave_?(secreta|api|privada|de_?acesso))/i

export function chaveEhSecreta(k: string): boolean {
  return PADRAO_CHAVE_SECRETA.test(k)
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json }

function mapearSegredos(obj: unknown, campo: string, fn: (v: string, c: string) => string): unknown {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj
  const saida: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    saida[k] = typeof v === 'string' && v && chaveEhSecreta(k) ? fn(v, `${campo}.${k}`) : v
  }
  return saida as Json
}

export function cifrarSegredosDoJson(obj: unknown, campo: string, env: Record<string, string | undefined> = process.env): unknown {
  return mapearSegredos(obj, campo, (v, c) => cifrar(v, c, env))
}

export function decifrarSegredosDoJson(obj: unknown, campo: string, env: Record<string, string | undefined> = process.env): unknown {
  return mapearSegredos(obj, campo, (v, c) => decifrar(v, c, env))
}

// ── Redação para logs e auditoria ───────────────────────────────────────

const VALOR_SECRETO = /(enc:v1:[\w:.-]+|sb_secret_\w+|sk-ant-[\w-]+|eyJ[\w-]{10,}\.[\w-]+\.[\w-]+|postgres(ql)?:\/\/\S+|Bearer\s+[\w.-]+)/g

/** Copia `valor` trocando segredos por "[redigido]" (chaves secretas e padrões conhecidos). */
export function redigir(valor: unknown, profundidade = 0): unknown {
  if (profundidade > 6) return '[profundo]'
  if (typeof valor === 'string') return valor.replace(VALOR_SECRETO, '[redigido]')
  if (Array.isArray(valor)) return valor.map((v) => redigir(v, profundidade + 1))
  if (valor && typeof valor === 'object') {
    const saida: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
      saida[k] = chaveEhSecreta(k) || /^(accessToken|refreshToken|authorization|cookie)$/i.test(k) ? '[redigido]' : redigir(v, profundidade + 1)
    }
    return saida
  }
  return valor
}
