/**
 * REVALIDAÇÃO DE DADOS COMERCIAIS — "PREÇO NÃO CONFIRMADO = PREÇO NÃO PUBLICADO".
 *
 * Preço, promoção, desconto, cupom, disponibilidade e comissão são VOLÁTEIS:
 * o valor salvo no banco nunca vira "preço atual" só por estar salvo.
 *
 * Fontes (da mais forte para a mais fraca), sempre com data, fonte e confiança:
 *   1. dado OFICIAL da plataforma (DadoOficialDeProduto.atualizadoEm, situação OK);
 *   2. sincronização do catálogo (Produto.sincronizadoEm);
 *   3. informado pela titular (candidato USER_PROVIDED: coletadoEm).
 * O prazo é o mesmo de `lib/preco-verificado.ts` (PRECO_VALIDADE_HORAS, padrão 24 h).
 *
 * Sem confirmação dentro do prazo: o texto ao público não traz valor nenhum —
 * a linha com o preço vira "Confira o valor atual no link." (legenda: corrigida
 * na hora; texto queimado no vídeo: o vídeo é gerado de novo sem o preço).
 * Publicação JÁ feita nunca muda: o preço confirmado na época fica no histórico.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { registrarEvento } from './ledger'
import { formatarBRL } from './formato-moeda'
import { avaliarPreco, type StatusDoPreco } from './preco-verificado'
import { chaveDoDado, identificarProduto } from './dados-de-produto'

export const FALLBACK_DO_PRECO = 'Confira o valor atual no link.'

export type FonteComercial = 'OFICIAL' | 'SYNC_CATALOGO' | 'TITULAR' | 'NENHUMA'

export interface DadosComerciais {
  preco: number | null
  /** Preço que pode ir ao público (confirmado e dentro do prazo); senão null. */
  precoPublicavel: number | null
  status: StatusDoPreco
  fonte: FonteComercial
  confianca: 'ALTA' | 'MEDIA' | 'NENHUMA'
  lastVerifiedAt: string | null
  disponivel: boolean | null
  descontoPercentual: number | null
  comissaoPercentual: number | null
  comissaoValor: number | null
  /** Comissão é dado INTERNO de decisão: nunca vai ao consumidor. */
  comissaoConfirmada: boolean
}

// ── Texto ao público (FUNÇÕES PURAS) ────────────────────────────────────

const VALOR = /R\$\s?\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|R\$\s?\d+(?:,\d{1,2})?/gi
const DESCONTO = /\d{1,2}\s?%\s?(?:off|de desconto|desconto)/i
const CUPOM = /\bcupom\b/i
const normalizarValor = (t: string) => t.replace(/\s/g, '').replace(/^R\$/i, 'R$')

/** O texto menciona algum dado comercial (valor, desconto, cupom)? */
export function mencionaDadoComercial(texto: string | null | undefined): boolean {
  const t = texto ?? ''
  return new RegExp(VALOR.source, 'i').test(t) || DESCONTO.test(t) || CUPOM.test(t)
}

/**
 * Remove do texto todo dado comercial que não esteja confirmado agora.
 * Linha a linha: a linha com valor/desconto/cupom não confirmado vira o
 * fallback (uma vez só). Valor IGUAL ao preço confirmado fica.
 */
export function sanearTextoComercial(texto: string, d: Pick<DadosComerciais, 'precoPublicavel' | 'descontoPercentual'>): { texto: string; mudou: boolean } {
  const confirmado = d.precoPublicavel !== null ? normalizarValor(formatarBRL(d.precoPublicavel)) : null
  let usouFallback = false
  let mudou = false
  const linhas = texto.split('\n').flatMap((linha) => {
    const valores = [...linha.matchAll(new RegExp(VALOR.source, 'gi'))].map((m) => normalizarValor(m[0]))
    const valorRuim = valores.some((v) => v !== confirmado)
    const descontoRuim = DESCONTO.test(linha) && !(d.descontoPercentual !== null && linha.includes(`${Math.round(d.descontoPercentual)}%`) && d.precoPublicavel !== null)
    const cupomRuim = CUPOM.test(linha) // não há fonte de cupom: cupom nunca vai ao ar sem confirmação
    if (!valorRuim && !descontoRuim && !cupomRuim) return [linha]
    mudou = true
    if (usouFallback) return []
    usouFallback = true
    return [FALLBACK_DO_PRECO]
  })
  return { texto: linhas.join('\n'), mudou }
}

export interface VersaoComTexto {
  gancho: string
  cta: string
  legenda: string
  roteiro: { textoNaTela?: string | null }[]
}

/** O que mudaria na versão: legenda (sem regerar) e o texto QUEIMADO no vídeo (exige regerar). */
export function revisarVersao<V extends VersaoComTexto>(v: V, d: Pick<DadosComerciais, 'precoPublicavel' | 'descontoPercentual'>): { versao: V; legendaMudou: boolean; queimadoMudou: boolean } {
  const leg = sanearTextoComercial(v.legenda, d)
  const gan = sanearTextoComercial(v.gancho, d)
  const cta = sanearTextoComercial(v.cta, d)
  const tela = v.roteiro.map((e) => (e.textoNaTela ? sanearTextoComercial(e.textoNaTela, d) : { texto: e.textoNaTela ?? '', mudou: false }))
  const queimadoMudou = gan.mudou || cta.mudou || tela.some((t) => t.mudou)
  return {
    versao: { ...v, legenda: leg.texto, gancho: gan.texto, cta: cta.texto, roteiro: v.roteiro.map((e, i) => (tela[i].mudou ? { ...e, textoNaTela: tela[i].texto } : e)) },
    legendaMudou: leg.mudou,
    queimadoMudou,
  }
}

// ── Revalidação (lê a fonte; atualiza a fonte única; dispara derivados) ──

/** FUNÇÃO PURA. Escolhe a fonte mais forte e diz o que pode ir ao público. */
export function decidirDadosComerciais(p: {
  agora: Date
  validadeHoras?: number
  oficial: { preco: number | null; atualizadoEm: Date | null; situacao: string; disponivel: boolean | null; descontoPercentual: number | null; comissaoPercentual: number | null; comissaoValor: number | null } | null
  produto: { preco: number | null; sincronizadoEm: Date | null } | null
  candidato: { preco: number | null; fonte: string; coletadoEm: Date | null; comissaoPercentual: number | null; comissaoValor: number | null }
}): DadosComerciais {
  const oficialValido = p.oficial && p.oficial.situacao === 'OK' && p.oficial.atualizadoEm
  const escolha: { preco: number | null; em: Date | null; fonte: FonteComercial; confianca: DadosComerciais['confianca'] } =
    oficialValido && p.oficial!.preco !== null
      ? { preco: p.oficial!.preco, em: p.oficial!.atualizadoEm, fonte: 'OFICIAL', confianca: 'ALTA' }
      : p.produto?.sincronizadoEm && p.produto.preco !== null
        ? { preco: p.produto.preco, em: p.produto.sincronizadoEm, fonte: 'SYNC_CATALOGO', confianca: 'ALTA' }
        : p.candidato.fonte === 'USER_PROVIDED' && p.candidato.preco !== null && p.candidato.coletadoEm
          ? { preco: p.candidato.preco, em: p.candidato.coletadoEm, fonte: 'TITULAR', confianca: 'MEDIA' }
          : { preco: p.candidato.preco, em: null, fonte: 'NENHUMA', confianca: 'NENHUMA' }
  const av = avaliarPreco({ preco: escolha.preco, verificadoEm: escolha.em, agora: p.agora, validadeHoras: p.validadeHoras })
  const disponivel = oficialValido ? p.oficial!.disponivel : null
  return {
    preco: escolha.preco,
    precoPublicavel: av.status === 'VERIFICADO' && disponivel !== false ? escolha.preco : null,
    status: av.status,
    fonte: escolha.fonte,
    confianca: escolha.confianca,
    lastVerifiedAt: escolha.em ? escolha.em.toISOString() : null,
    disponivel,
    descontoPercentual: oficialValido ? p.oficial!.descontoPercentual : null,
    comissaoPercentual: oficialValido && p.oficial!.comissaoPercentual !== null ? p.oficial!.comissaoPercentual : p.candidato.comissaoPercentual,
    comissaoValor: oficialValido && p.oficial!.comissaoValor !== null ? p.oficial!.comissaoValor : p.candidato.comissaoValor,
    comissaoConfirmada: !!oficialValido && (p.oficial!.comissaoPercentual !== null || p.oficial!.comissaoValor !== null),
  }
}

/**
 * REVALIDAR_DADOS_COMERCIAIS de um produto. Se a fonte confirmada traz preço
 * diferente do salvo: atualiza a fonte única (candidato + cadastro) e registra
 * PRICE_CHANGED (anterior → novo). Idempotente por (produto, verificação, valor):
 * duas verificações simultâneas não gravam dados conflitantes.
 */
export async function revalidarDadosComerciais(p: { workspaceId: string; candidatoId: string; agora?: Date; validadeHoras?: number }): Promise<DadosComerciais | null> {
  const agora = p.agora ?? new Date()
  const c = await prisma.candidatoDeProduto.findFirst({ where: { id: p.candidatoId, workspaceId: p.workspaceId } })
  if (!c) return null
  const chave = chaveDoDado(c.linkProduto, c.providerId && c.externalId ? { provider: c.providerId, externalId: c.externalId } as never : identificarProduto(c.linkProduto))
  const [oficial, produto] = await Promise.all([
    chave ? prisma.dadoOficialDeProduto.findUnique({ where: { workspaceId_chave: { workspaceId: p.workspaceId, chave } } }) : Promise.resolve(null),
    c.produtoId ? prisma.produto.findFirst({ where: { id: c.produtoId, workspaceId: p.workspaceId }, select: { id: true, preco: true, sincronizadoEm: true } }) : Promise.resolve(null),
  ])
  const d = decidirDadosComerciais({ agora, validadeHoras: p.validadeHoras, oficial, produto, candidato: c })
  // Mudou na fonte confirmada → a fonte única acompanha (e o histórico guarda o anterior).
  if ((d.fonte === 'OFICIAL' || d.fonte === 'SYNC_CATALOGO') && d.preco !== null && d.preco !== c.preco) {
    await prisma.candidatoDeProduto.updateMany({ where: { id: c.id, workspaceId: p.workspaceId }, data: { preco: d.preco } })
    if (produto && produto.preco !== d.preco) await prisma.produto.updateMany({ where: { id: produto.id, workspaceId: p.workspaceId }, data: { preco: d.preco } })
    await registrarEvento({
      workspaceId: p.workspaceId, tipo: 'PRICE_CHANGED', chaveIdempotencia: `preco:${c.id}:${d.lastVerifiedAt}:${d.preco}`, entidadeTipo: 'CandidatoDeProduto', entidadeId: c.id,
      payload: { anterior: c.preco, novo: d.preco, fonte: d.fonte, verificadoEm: d.lastVerifiedAt },
    })
  }
  if (d.disponivel === false) {
    await registrarEvento({ workspaceId: p.workspaceId, tipo: 'PRODUCT_BECAME_UNAVAILABLE', chaveIdempotencia: `indisponivel:${c.id}:${d.lastVerifiedAt}`, entidadeTipo: 'CandidatoDeProduto', entidadeId: c.id, payload: { fonte: d.fonte, verificadoEm: d.lastVerifiedAt } })
  }
  return d
}

export class ErroComercial extends Error {
  constructor(public readonly status: 409, mensagem: string) {
    super(mensagem)
  }
}

/** O retrato comercial que vai junto da publicação (fica no histórico dela). */
export const retratoComercial = (d: DadosComerciais) => ({ preco: d.preco, precoPublicavel: d.precoPublicavel, status: d.status, fonte: d.fonte, confianca: d.confianca, lastVerifiedAt: d.lastVerifiedAt, disponivel: d.disponivel })

export type JsonDeVersao = Prisma.InputJsonValue
