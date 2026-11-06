/**
 * P2.17.1 — Entrada do "Informar produto" (Oportunidades), FUNÇÃO PURA.
 *
 * Mesma regra de antes: nome e link obrigatórios; o resto opcional e nada é
 * completado. O que mudou foi só o tratamento da entrada real:
 *  - link colado junto com texto (o "Compartilhar" do TikTok cola
 *    "Confira… https://shop.tiktok.com/…"): usa o PRIMEIRO endereço http(s);
 *  - títulos do TikTok Shop vão até ~255 caracteres: o limite do nome passa
 *    de 200 para 300 (o banco não tem limite; isto só evita lixo);
 *  - erro de validação vira uma frase que a titular entende, por campo, em
 *    vez de "Dados inválidos".
 */
import { z } from 'zod'
import { CATEGORIAS } from '@/types'

export const MAX_NOME = 300

/** Primeiro endereço http(s) do texto, sem pontuação colada no fim. */
export function extrairUrl(texto: unknown): string | null {
  if (typeof texto !== 'string') return null
  const m = texto.match(/https?:\/\/[^\s<>"'`]+/i)
  if (!m) return null
  return m[0].replace(/[).,;!?\]]+$/, '')
}

function urlValida(u: string): boolean {
  try {
    const x = new URL(u)
    return (x.protocol === 'https:' || x.protocol === 'http:') && !!x.hostname && x.hostname.includes('.')
  } catch {
    return false
  }
}

const esquema = z.object({
  nome: z.string().trim().min(1).max(MAX_NOME),
  link: z.string().refine(urlValida),
  categoria: z.enum(CATEGORIAS as [string, ...string[]]).optional().nullable(),
  preco: z.number().finite().positive().max(1_000_000).optional().nullable(),
  imagem: z.string().refine(urlValida).optional().nullable(),
  comprei: z.boolean().default(false),
  usei: z.boolean().default(false),
})

export type EntradaInformada = z.infer<typeof esquema>

const MENSAGEM_POR_CAMPO: Record<string, (valor: unknown) => string> = {
  nome: (v) =>
    typeof v === 'string' && v.trim().length > MAX_NOME
      ? `O nome tem ${v.trim().length} caracteres; o máximo é ${MAX_NOME}. Encurte o nome do produto.`
      : 'Informe o nome do produto.',
  link: () => 'Não encontrei um link válido. Cole o endereço do produto (começa com https://).',
  categoria: () => 'Escolha uma categoria da lista ou deixe em branco.',
  preco: () => 'Preço inválido: use só números, por exemplo 49,90 — ou deixe em branco.',
  imagem: () => 'O link da imagem não é um endereço válido. Deixe em branco ou cole só o endereço da imagem.',
  comprei: () => 'Marcação "Comprei" inválida.',
  usei: () => 'Marcação "Usei" inválida.',
}

export type ResultadoDaEntrada = { ok: true; dados: EntradaInformada } | { ok: false; mensagem: string; campos: string[] }

/** Normaliza e valida o corpo enviado pela tela. */
export function lerEntradaInformada(corpo: unknown): ResultadoDaEntrada {
  const c = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>
  const normalizado = {
    ...c,
    nome: typeof c.nome === 'string' ? c.nome.replace(/\s+/g, ' ') : c.nome,
    link: extrairUrl(c.link) ?? (typeof c.link === 'string' ? c.link.trim() : c.link),
    imagem: c.imagem === '' || c.imagem == null ? null : extrairUrl(c.imagem) ?? c.imagem,
    categoria: c.categoria === '' ? null : c.categoria,
  }
  const r = esquema.safeParse(normalizado)
  if (r.success) return { ok: true, dados: r.data }
  const campos = [...new Set(r.error.issues.map((i) => String(i.path[0] ?? 'corpo')))]
  const mensagens = campos.map((f) => (MENSAGEM_POR_CAMPO[f] ?? (() => 'Dados inválidos.'))((normalizado as Record<string, unknown>)[f]))
  return { ok: false, mensagem: mensagens.join(' '), campos }
}
