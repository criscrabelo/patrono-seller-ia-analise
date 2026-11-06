/**
 * P2.35 — MÍDIA PRIVADA (originais e prévias ANTES da aprovação).
 *
 * Um bucket PRIVADO novo (`midias-privadas`); os buckets públicos e as mídias comerciais que já existem
 * continuam como estão (compatibilidade). Separação por finalidade, dentro do bucket privado:
 *   originais/ws-<workspace>/<candidato>/…   mídia enviada pela titular (pendente de aprovação)
 *   previas/ws-<workspace>/<publicação>/…    vídeo gerado pelo Patrono, antes da aprovação
 * Nada vira público sozinho: a titular baixa o aprovado por link temporário e publica no app. Publicar por API
 * (no futuro) exigirá uma cópia pública explícita — esta camada não a cria.
 *
 * REFERÊNCIA guardada no banco = o endereço AUTENTICADO do storage do próprio projeto:
 *   <SUPABASE_URL>/storage/v1/object/authenticated/midias-privadas/<caminho>
 * Sem credencial ele NÃO abre (não é link público), e ele passa na regra de custódia própria sem mudança.
 * Só o SERVIDOR troca a referência por um link assinado curto, na resposta à usuária logada, e só se o
 * caminho for do workspace dela (`ws-<id>` no 2º segmento). Outro workspace → null, nunca assinado.
 */
import { randomBytes } from 'node:crypto'

export const BUCKET_MIDIA_PRIVADA = 'midias-privadas'
/** Validade do link assinado entregue à tela (o vídeo carrega nesse tempo; recarregar a tela gera outro). */
export const VALIDADE_DO_LINK_S = 600

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4' }

const base = (env: Record<string, string | undefined>) => (env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '')
const prefixo = (env: Record<string, string | undefined>) => `${base(env)}/storage/v1/object/authenticated/${BUCKET_MIDIA_PRIVADA}/`
const limpa = (x: string) => x.replace(/[^a-zA-Z0-9_-]/g, '')

/** FUNÇÃO PURA. A referência (não pública) de um caminho do bucket privado. */
export function refPrivada(caminho: string, env: Record<string, string | undefined> = process.env): string {
  return `${prefixo(env)}${caminho}`
}

/** FUNÇÃO PURA. O caminho dentro do bucket privado, se `url` for uma referência privada deste projeto. */
export function caminhoDaRefPrivada(url: unknown, env: Record<string, string | undefined> = process.env): string | null {
  if (typeof url !== 'string' || !base(env)) return null
  const p = prefixo(env)
  if (!url.startsWith(p)) return null
  const c = url.slice(p.length)
  return c && !c.includes('..') && !c.startsWith('/') ? c : null
}

export const ehRefPrivada = (url: unknown, env: Record<string, string | undefined> = process.env) => caminhoDaRefPrivada(url, env) !== null

/** FUNÇÃO PURA. O caminho pertence a este workspace? (`<finalidade>/ws-<id>/…`) */
export function pertenceAoWorkspace(caminho: string, workspaceId: string): boolean {
  const partes = caminho.split('/')
  return partes.length >= 3 && partes[1] === `ws-${limpa(workspaceId)}` && ['originais', 'previas'].includes(partes[0])
}

/** FUNÇÃO PURA. Caminho de um ORIGINAL (mídia enviada, pendente de aprovação). */
export function caminhoDoOriginal(p: { workspaceId: string; candidatoId: string; tipo: string; agora?: Date; aleatorio?: string }): string {
  const ext = EXT[p.tipo] ?? (p.tipo.startsWith('video/') ? 'mp4' : 'jpg')
  return `originais/ws-${limpa(p.workspaceId)}/${limpa(p.candidatoId)}/${(p.agora ?? new Date()).getTime()}-${p.aleatorio ?? randomBytes(6).toString('hex')}.${ext}`
}

/** FUNÇÃO PURA. Caminho de uma PRÉVIA (vídeo gerado antes da aprovação). */
export function caminhoDaPrevia(p: { workspaceId: string; publicacaoId: string; versao: number; agora?: Date; aleatorio?: string }): string {
  return `previas/ws-${limpa(p.workspaceId)}/${limpa(p.publicacaoId)}/v${p.versao}-${(p.agora ?? new Date()).getTime()}-${p.aleatorio ?? randomBytes(6).toString('hex')}.mp4`
}

// ── Servidor (storage) ──────────────────────────────────────────────────

export interface PortasDaMidiaPrivada {
  assinar(caminho: string, segundos: number): Promise<string>
  subir(buffer: Buffer, caminho: string, mime: string): Promise<void>
}

async function portasReais(): Promise<PortasDaMidiaPrivada> {
  const { createClient } = await import('@supabase/supabase-js')
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'placeholder')
  return {
    assinar: async (c, s) => {
      const { data, error } = await sb.storage.from(BUCKET_MIDIA_PRIVADA).createSignedUrl(c, s)
      if (error || !data) throw new Error(`Não consegui gerar o link temporário: ${error?.message ?? 'sem dados'}`)
      return data.signedUrl
    },
    subir: async (b, c, m) => {
      const { error } = await sb.storage.from(BUCKET_MIDIA_PRIVADA).upload(c, b, { contentType: m, upsert: false })
      if (error) throw new Error(`Não consegui guardar no armazenamento privado: ${error.message}`)
    },
  }
}
let portas: PortasDaMidiaPrivada | null = null
/** Só para teste. `null` volta às reais. */
export function definirPortasDaMidiaPrivada(p: PortasDaMidiaPrivada | null) { portas = p }
const atuais = async () => portas ?? (portas = await portasReais())

/**
 * Endereço para USO INTERNO do servidor (ex.: o render baixar a mídia): referência privada → link assinado
 * curto; qualquer outro endereço (mídia pública antiga) → ele mesmo. Nunca vai para a tela por aqui.
 */
export async function urlParaUsoInterno(url: string, env: Record<string, string | undefined> = process.env, segundos = 300): Promise<string> {
  const c = caminhoDaRefPrivada(url, env)
  return c ? (await atuais()).assinar(c, segundos) : url
}

/** Sobe uma prévia (vídeo gerado) ao bucket privado e devolve a REFERÊNCIA privada (não o link). */
export async function guardarPreviaPrivada(buffer: Buffer, p: { workspaceId: string; publicacaoId: string; versao: number }, env: Record<string, string | undefined> = process.env): Promise<string> {
  const caminho = caminhoDaPrevia(p)
  await (await atuais()).subir(buffer, caminho, 'video/mp4')
  return refPrivada(caminho, env)
}

/**
 * Na RESPOSTA à usuária logada: troca cada referência privada do PRÓPRIO workspace por um link assinado
 * (VALIDADE_DO_LINK_S); referência de outro workspace vira null (nunca assinada). Cópia profunda: o objeto
 * original (o que está no banco) não muda. Mesma referência → mesmo link na resposta.
 */
export async function assinarMidiasPrivadasNaResposta<T>(dados: T, workspaceId: string, env: Record<string, string | undefined> = process.env): Promise<T> {
  const cache = new Map<string, string | null>()
  const p = await atuais().catch(() => null)
  const trocar = async (v: unknown): Promise<unknown> => {
    if (typeof v === 'string') {
      const c = caminhoDaRefPrivada(v, env)
      if (!c) return v
      if (!cache.has(c)) cache.set(c, pertenceAoWorkspace(c, workspaceId) && p ? await p.assinar(c, VALIDADE_DO_LINK_S).catch(() => null) : null)
      return cache.get(c) ?? null
    }
    if (Array.isArray(v)) return Promise.all(v.map(trocar))
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      const out: Record<string, unknown> = {}
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = await trocar(x)
      return out
    }
    return v
  }
  return (await trocar(dados)) as T
}

/** FUNÇÃO PURA. Tira de um texto (erro, log, histórico) qualquer credencial de link assinado. */
export function semSegredosDeLink(texto: string): string {
  return texto.replace(/([?&](?:token|signature|X-Amz-Signature|sig)=)[^&\s"']+/gi, '$1***')
}

/** Cabeçalhos para respostas que carregam link assinado: nada de cache compartilhado nem guardado. */
export const SEM_CACHE = { 'Cache-Control': 'private, no-store, max-age=0', 'Referrer-Policy': 'no-referrer' } as const
