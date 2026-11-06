/**
 * P1.9.1 — A copy que cada canal pode publicar.
 *
 * ── OS QUATRO DEFEITOS QUE A P1.9 ENCONTROU NA LEGENDA ──────────────────
 * 1. `#tiktokmademebuyit` num post de Instagram: a mesma legenda servia a
 *    todos os canais.
 * 2. "Colete Salva Vidas Infantil Prolife Homologado": o título do vendedor
 *    entrava inteiro, com uma alegação de homologação que ninguém conferiu.
 * 3. Sem CTA: a legenda do Instagram não dizia onde comprar.
 * 4. Link na legenda do Instagram, onde ele não é clicável.
 *
 * Este módulo é a autoridade das três primeiras. A quarta é da estratégia
 * de link (lib/capacidade-real-do-adapter.ts), que é lida daqui.
 *
 * ── DUAS PONTAS, A MESMA REGRA ──────────────────────────────────────────
 * A geração usa `montarLegendaDoCanal` para escrever certo. O preflight usa
 * `pendenciasDeCopy` para recusar o que já foi escrito errado, como as cinco
 * peças da P1.8. As duas leem as mesmas listas.
 *
 * Puro e sem dependência de banco.
 */

import { estrategiaDeLinkDoCanal } from './capacidade-real-do-adapter'

// ── Hashtags que pertencem a outro canal ────────────────────────────────

/**
 * Hashtags que só fazem sentido no canal de origem. Publicá-las em outro
 * canal sugere uma origem que o post não tem.
 */
const HASHTAGS_DO_CANAL: Record<string, RegExp[]> = {
  tiktok: [/^#tiktok\w*/i, /^#fyp\w*/i, /^#foryou\w*/i, /^#paravoce\w*/i, /^#paravocê\w*/i, /^#xyzbca$/i],
  instagram: [/^#instagood$/i, /^#instagram\w*/i, /^#reels?\w*$/i, /^#insta\w*/i],
  youtube: [/^#shorts?$/i, /^#youtube\w*/i],
}

/** A hashtag pertence a OUTRO canal que não este? Devolve qual, ou `null`. */
export function canalDaHashtag(hashtag: string, canalDoPost: string): string | null {
  const canal = (canalDoPost ?? '').trim().toLowerCase()
  for (const [dono, padroes] of Object.entries(HASHTAGS_DO_CANAL)) {
    if (dono === canal) continue
    if (padroes.some((p) => p.test(hashtag.trim()))) return dono
  }
  return null
}

export function hashtagsParaOCanal(hashtags: string[], canal: string): string[] {
  return hashtags.filter((h) => !!h && h.trim().length > 1 && canalDaHashtag(h, canal) === null)
}

// ── Alegações que exigem comprovação ────────────────────────────────────

/**
 * Termos que afirmam algo verificável sobre o produto e que o Patrono não
 * verificou. Vêm, quase sempre, do título que o VENDEDOR escreveu.
 *
 * Repetir a alegação na legenda transfere a afirmação para a dona do
 * perfil. Num produto de segurança infantil, "homologado" sem comprovação é
 * o tipo de frase que não se publica.
 */
const CLAIMS_SEM_COMPROVACAO: { termo: string; padrao: RegExp }[] = [
  { termo: 'homologado', padrao: /\bhomologad[oa]s?\b/gi },
  { termo: 'certificado', padrao: /\bcertificad[oa]s?\b/gi },
  { termo: 'inmetro', padrao: /\b(aprovad[oa]s?\s+pel[oa]\s+)?inmetro\b/gi },
  { termo: 'anvisa', padrao: /\b(aprovad[oa]s?\s+pel[oa]\s+|registr[oa]d?[oa]?\s+n[ao]\s+)?anvisa\b/gi },
  { termo: 'original', padrao: /\boriginal\b/gi },
  { termo: 'lacrado', padrao: /\blacrad[oa]s?\b/gi },
  { termo: 'garantia', padrao: /\bcom\s+garantia\b|\bgarantia\b/gi },
  { termo: 'oficial', padrao: /\boficial\b/gi },
  { termo: 'aprovado', padrao: /\baprovad[oa]s?\b/gi },
  { termo: 'comprovado', padrao: /\b(cientificamente\s+)?comprovad[oa]s?\b/gi },
  { termo: 'testado dermatologicamente', padrao: /\bdermatologicamente\s+testad[oa]s?\b|\btestad[oa]s?\s+dermatologicamente\b/gi },
  { termo: 'mais vendido', padrao: /\bmais\s+vendid[oa]s?\b/gi },
  { termo: 'número 1', padrao: /\bn[ºo°]\.?\s?1\b|\bn[úu]mero\s+1\b/gi },
  { termo: '100%', padrao: /\b100\s?%/gi },
]

/** As alegações não comprovadas presentes no texto. Vazio = nenhuma. */
export function claimsNaoComprovados(texto: string): string[] {
  const achados = new Set<string>()
  for (const c of CLAIMS_SEM_COMPROVACAO) {
    c.padrao.lastIndex = 0
    if (c.padrao.test(texto ?? '')) achados.add(c.termo)
    c.padrao.lastIndex = 0
  }
  return [...achados]
}

/**
 * Tira as alegações do título, preservando o resto.
 *
 * "Robô Aspirador H40 110V/220V Original Lacrado" → "Robô Aspirador H40 110V/220V".
 * Se não sobrar nome, lança: publicar sem nome seria pior que não publicar.
 */
export function nomeSemClaims(nome: string): { nome: string; removidos: string[] } {
  const removidos = claimsNaoComprovados(nome)
  let limpo = nome ?? ''
  for (const c of CLAIMS_SEM_COMPROVACAO) limpo = limpo.replace(c.padrao, ' ')
  limpo = limpo
    .replace(/\s*[-–—,|/]\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  if (!limpo) throw new Error(`O nome "${nome}" é feito só de alegações — não há o que publicar.`)
  return { nome: limpo, removidos }
}

// ── CTA ─────────────────────────────────────────────────────────────────

/**
 * A chamada para ação de cada canal, coerente com onde o link fica.
 *
 * No Instagram o link está na bio, então a CTA aponta para a bio. Uma CTA
 * "clique no link abaixo" num canal onde o link não abre seria mentira.
 */
export function ctaDoCanal(canal: string): string {
  const estrategia = estrategiaDeLinkDoCanal(canal)
  if (estrategia === 'BIO') return 'Link na bio.'
  if (estrategia === 'LEGENDA') return 'Link abaixo.'
  return 'Confira o link do perfil.'
}

// ── A legenda ───────────────────────────────────────────────────────────

export function montarLegendaDoCanal(params: {
  canal: string
  /** Já sem claims. Use `nomeSemClaims` antes. */
  nome: string
  /** Vem de `avaliarPreco`: nunca traz data inventada. */
  precoTexto: string
  disclosure: string | null
  hashtags: string[]
}): string {
  const linhaDoProduto = `${params.nome} — ${params.precoTexto}.`
  return [
    linhaDoProduto,
    ctaDoCanal(params.canal),
    params.disclosure,
    hashtagsParaOCanal(params.hashtags, params.canal).join(' '),
  ]
    .filter((p): p is string => !!p && p.trim().length > 0)
    .join('\n\n')
}

// ── O que o preflight recusa numa legenda já escrita ────────────────────

/**
 * Pendências de copy de uma legenda pronta. Vazio = nada a corrigir.
 *
 * Cada item começa com um código estável, para tela e teste.
 */
export function pendenciasDeCopy(params: { canal: string; legenda: string }): string[] {
  const canal = (params.canal ?? '').trim().toLowerCase()
  const legenda = params.legenda ?? ''
  const pendencias: string[] = []

  const hashtags = legenda.match(/#[\p{L}\p{N}_]+/gu) ?? []
  const deOutro = hashtags.filter((h) => canalDaHashtag(h, canal) !== null)
  if (deOutro.length > 0) {
    pendencias.push(`HASHTAG_DE_OUTRO_CANAL: ${deOutro.join(', ')} não pertence a ${canal}.`)
  }

  const claims = claimsNaoComprovados(legenda)
  if (claims.length > 0) {
    pendencias.push(`CLAIM_NAO_COMPROVADO: a legenda afirma "${claims.join('", "')}" sem comprovação.`)
  }

  const estrategia = estrategiaDeLinkDoCanal(canal)
  if (estrategia === 'BIO' && !/link na bio/i.test(legenda)) {
    pendencias.push(`CTA_AUSENTE: a legenda não diz onde comprar. Em ${canal} o link fica na bio.`)
  }
  if (estrategia === 'BIO' && /https?:\/\//i.test(legenda)) {
    pendencias.push(`LINK_NAO_CLICAVEL: em ${canal} link na legenda não abre. O link rastreado vai na bio.`)
  }

  return pendencias
}
