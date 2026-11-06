/**
 * P2.14.5.13 — o que as rotas de /api/oportunidades devolvem. Só campos do
 * candidato; nada de token, segredo ou dado de outro workspace.
 */
import { prisma } from './prisma'
import { situacaoNaVitrine, type SituacaoNaVitrine } from './vitrine-situacao'
import { NextResponse } from 'next/server'
import type { CandidatoDeProduto, DadoOficialDeProduto } from '@prisma/client'
import { chaveDoDado, identificarProduto } from './dados-de-produto'
import { dadosOficiaisPorChave } from './enriquecimento-de-produto'
import { ErroDeCuradoria } from './curadoria'
import { avaliarCampanha } from './campanha-sazonal'
import { consultar } from './consultor-afiliados'

/**
 * P2.17.2: etiquetas da campanha sazonal ativa, calculadas do dado real do
 * candidato (nome, categoria, preço); fora da campanha, null.
 */
export function campanhaDoCandidato(c: Pick<CandidatoDeProduto, 'nome' | 'categoria' | 'preco'>, agora: Date) {
  const a = avaliarCampanha({ categoria: c.categoria, nome: c.nome, preco: c.preco }, agora)
  return a ? { nome: a.nome, aderencia: a.aderencia, tags: a.tags } : null
}

/**
 * P2.17.6: o que se sabe de OFICIAL sobre o produto — data, fonte, alertas e,
 * quando não há dado, POR QUÊ ("O TikTok ainda não forneceu esse dado.").
 */
export function dadosOficiaisParaTela(oficial: { dado: DadoOficialDeProduto | null; alertas: string[] } | null | undefined) {
  const d = oficial?.dado ?? null
  if (!d) return null
  return {
    fonte: d.fonte,
    situacao: d.situacao,
    motivoCurto: d.motivoCurto,
    motivo: d.motivo,
    consultadoEm: d.consultadoEm.toISOString(),
    atualizadoEm: d.atualizadoEm?.toISOString() ?? null,
    precoAnterior: d.precoAnterior,
    descontoPercentual: d.descontoPercentual,
    menorPrecoObservado: d.menorPrecoObservado,
    loja: d.loja,
    disponivel: d.disponivel,
    alertas: oficial?.alertas ?? [],
  }
}

/** A chave do dado oficial deste candidato (provider:id ou link). */
export function chaveOficialDoCandidato(c: Pick<CandidatoDeProduto, 'linkProduto'>): string | null {
  return chaveDoDado(c.linkProduto, identificarProduto(c.linkProduto))
}

/** Vários candidatos para a tela, com os dados oficiais numa leitura só. */
export async function candidatosParaTela(workspaceId: string, candidatos: CandidatoDeProduto[]) {
  const chaves = candidatos.map(chaveOficialDoCandidato).filter((k): k is string => !!k)
  const oficiais = await dadosOficiaisPorChave(workspaceId, [...new Set(chaves)])
  // P2.17.15: situação na vitrine (só leitura; a inclusão é do fluxo automático).
  const ids = candidatos.map((c) => c.externalId).filter((x): x is string => !!x)
  const registros = ids.length ? await prisma.vitrineTikTokShop.findMany({ where: { workspaceId, productId: { in: ids } }, select: { productId: true, estado: true } }) : []
  const agora = new Date()
  return candidatos.map((c) => {
    const k = chaveOficialDoCandidato(c)
    const reg = c.externalId ? registros.find((r) => r.productId === c.externalId) ?? null : null
    return { ...candidatoParaTela(c, k ? oficiais.get(k) : null), vitrine: c.providerId === 'tiktok-shop' ? situacaoNaVitrine(c, reg, agora) : null }
  })
}

export function candidatoParaTela(c: CandidatoDeProduto, oficial?: { dado: DadoOficialDeProduto | null; alertas: string[] } | null) {
  return {
    id: c.id,
    posicao: c.posicao,
    status: c.status,
    nome: c.nome,
    fonte: c.fonte,
    providerId: c.providerId,
    linkProduto: c.linkProduto,
    // Imagem só sai da API quando o direito de uso foi verificado.
    imagem: c.imagemAutorizada ? c.imagem : null,
    imagemInformadaSemDireito: !c.imagemAutorizada && c.imagem !== null,
    categoria: c.categoria,
    preco: c.preco,
    comissaoPercentual: c.comissaoPercentual,
    comissaoValor: c.comissaoValor,
    vendas: c.vendas,
    velocidadeDeVendas: c.velocidadeDeVendas,
    avaliacao: c.avaliacao,
    numeroDeAvaliacoes: c.numeroDeAvaliacoes,
    estoque: c.estoque,
    score: c.score,
    baseDeEvidencia: c.baseDeEvidencia,
    aderencia: c.aderencia,
    aderenciaDoPerfil: c.aderenciaDoPerfil,
    afinidade: c.afinidade,
    confianca: c.confianca,
    nivelDeRisco: c.nivelDeRisco,
    publicacaoImpedida: c.publicacaoImpedida,
    compradoPelaTitular: c.compradoPelaTitular,
    usadoPelaTitular: c.usadoPelaTitular,
    motivosPositivos: c.motivosPositivos,
    riscos: c.riscos,
    desconhecidos: c.desconhecidos,
    porqueDestaPosicao: c.porqueDestaPosicao,
    campanha: campanhaDoCandidato(c, new Date()),
    // P2.17.3: a opinião do consultor (regras + dados reais, sem IA).
    consultoria: consultar({
      nome: c.nome,
      categoria: c.categoria,
      preco: c.preco,
      providerId: c.providerId,
      linkProduto: c.linkProduto,
      comissaoPercentual: c.comissaoPercentual,
      comissaoValor: c.comissaoValor,
      vendas: c.vendas,
      baseDeEvidencia: c.baseDeEvidencia,
      confianca: c.confianca,
      nivelDeRisco: c.nivelDeRisco,
      riscos: c.riscos,
      complianceBloqueante: c.complianceBloqueante,
      publicacaoImpedida: c.publicacaoImpedida,
      campanha: campanhaDoCandidato(c, new Date()),
    }),
    coletadoEm: c.coletadoEm.toISOString(),
    validoAte: c.validoAte.toISOString(),
    dadosOficiais: dadosOficiaisParaTela(oficial),
  }
}

export type CandidatoNaTela = ReturnType<typeof candidatoParaTela> & { vitrine?: SituacaoNaVitrine | null }

export function respostaDeErro(e: unknown) {
  if (e instanceof ErroDeCuradoria) return NextResponse.json({ error: e.message }, { status: e.status })
  console.error('Erro na curadoria:', e)
  return NextResponse.json({ error: 'Erro interno ao processar a curadoria.' }, { status: 500 })
}

export { ultimaColetaParaTela } from './curadoria-estado'
export type { UltimaColetaNaTela } from './curadoria-estado'
