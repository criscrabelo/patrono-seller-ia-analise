/**
 * P2.14.7 (Fase 0A) — aplica o cofre ao modelo `Integracao` dentro do
 * cliente Prisma: cifra ao gravar, decifra ao ler. Os ~22 arquivos que usam
 * tokens não mudam, e nenhum caminho novo consegue gravar texto puro.
 *
 * Campos cifrados: `accessToken`, `refreshToken` e, em `extraData`, toda
 * chave cujo nome indique segredo (`appSecret`, `clientToken`, `partnerKey`…).
 */
import { Prisma } from '@prisma/client'
import { cifrar, cifrarSegredosDoJson, decifrar, decifrarSegredosDoJson } from './cofre'

const CAMPOS = ['accessToken', 'refreshToken'] as const

function cifrarValor(v: unknown, campo: string): unknown {
  if (typeof v === 'string' && v) return cifrar(v, `Integracao.${campo}`)
  if (v && typeof v === 'object' && 'set' in (v as Record<string, unknown>)) {
    const s = (v as { set: unknown }).set
    return { set: typeof s === 'string' && s ? cifrar(s, `Integracao.${campo}`) : s }
  }
  return v
}

export function cifrarDadosDaIntegracao<T>(dados: T): T {
  if (Array.isArray(dados)) return dados.map((d) => cifrarDadosDaIntegracao(d)) as T
  if (!dados || typeof dados !== 'object') return dados
  const d = { ...(dados as Record<string, unknown>) }
  for (const campo of CAMPOS) if (campo in d) d[campo] = cifrarValor(d[campo], campo)
  if ('extraData' in d && d.extraData && typeof d.extraData === 'object') {
    d.extraData = cifrarSegredosDoJson(d.extraData, 'Integracao.extraData')
  }
  return d as T
}

export function decifrarIntegracao<T>(linha: T): T {
  if (!linha || typeof linha !== 'object') return linha
  const d = { ...(linha as Record<string, unknown>) }
  for (const campo of CAMPOS) {
    if (typeof d[campo] === 'string') d[campo] = decifrar(d[campo] as string, `Integracao.${campo}`)
  }
  if (d.extraData && typeof d.extraData === 'object') d.extraData = decifrarSegredosDoJson(d.extraData, 'Integracao.extraData')
  return d as T
}

function decifrarResultado(r: unknown): unknown {
  if (Array.isArray(r)) return r.map((x) => decifrarIntegracao(x))
  if (r && typeof r === 'object' && !('count' in (r as Record<string, unknown>) && Object.keys(r as object).length === 1)) {
    return decifrarIntegracao(r)
  }
  return r
}

export const extensaoDoCofre = Prisma.defineExtension({
  name: 'cofre-de-integracoes',
  query: {
    integracao: {
      async $allOperations({ args, query }) {
        const a = args as Record<string, unknown> | undefined
        if (a && typeof a === 'object') {
          if ('data' in a) a.data = cifrarDadosDaIntegracao(a.data)
          if ('create' in a) a.create = cifrarDadosDaIntegracao(a.create)
          if ('update' in a) a.update = cifrarDadosDaIntegracao(a.update)
        }
        return decifrarResultado(await query(args))
      },
    },
  },
})
