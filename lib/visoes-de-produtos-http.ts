/**
 * P2.17.6 — Painel de visões dos candidatos (Mais vendidos | Maior comissão |
 * Melhor oportunidade | …). Só leitura: candidatos abertos e válidos + dados
 * oficiais + missões ativas. Nada é estimado para preencher lacuna.
 */
import { prisma } from './prisma'
import { analisarMetas, listarMetasAtivas } from './metas-tiktok'
import { ehProdutoTikTokShop } from './tiktok-shop-link'
import { facilidadeDeVideo } from './motor-de-videos-tiktok'
import { campanhaDoCandidato, chaveOficialDoCandidato, dadosOficiaisParaTela } from './curadoria-http'
import { dadosOficiaisPorChave } from './enriquecimento-de-produto'
import { statusDosProdutos } from './resultados-videos'
import { chavesDoCandidato, sinaisPorChave } from './observacoes-de-mercado'
import { compararComissaoEOportunidade, montarVisao, VISOES, type IdDaVisao, type ProdutoParaVisao } from './visoes-de-produtos'
import { CANDIDATO_NAO_EXCLUIDO } from './produto-canonico'

export function visaoValida(v: string | null): IdDaVisao {
  return (VISOES.find((x) => x.id === v)?.id ?? 'MELHOR_OPORTUNIDADE') as IdDaVisao
}

export async function painelDeVisoes(workspaceId: string, visao: IdDaVisao, agora: Date = new Date()) {
  const [candidatos, metas] = await Promise.all([
    prisma.candidatoDeProduto.findMany({
      where: { workspaceId, status: { in: ['NOVO', 'APRESENTADO'] }, complianceBloqueante: false, validoAte: { gte: agora }, AND: [CANDIDATO_NAO_EXCLUIDO] },
      orderBy: [{ baseDeEvidencia: 'desc' }, { score: 'desc' }],
      take: 60,
    }),
    listarMetasAtivas(workspaceId),
  ])
  const analises = analisarMetas(metas, agora)
  const missaoDeVideo = analises.some((m) => m.usaProdutoNoVideo && (m.situacao === 'EM_ANDAMENTO' || m.situacao === 'NAO_INICIADA'))
  const chaves = [...new Set(candidatos.map(chaveOficialDoCandidato).filter((k): k is string => !!k))]
  const [oficiais, status, manuais] = await Promise.all([
    dadosOficiaisPorChave(workspaceId, chaves),
    statusDosProdutos(workspaceId),
    // P2.17.18: o que a titular VIU no app (snapshot vigente) — só preenche lacuna, rotulado.
    sinaisPorChave(workspaceId, candidatos.flatMap(chavesDoCandidato), agora),
  ])
  const produtos: ProdutoParaVisao[] = candidatos.map((c) => {
    const tiktokShop = ehProdutoTikTokShop(c.providerId, c.linkProduto)
    const o = oficiais.get(chaveOficialDoCandidato(c) ?? '')?.dado ?? null
    const m = chavesDoCandidato(c).map((k) => manuais.get(k)).find(Boolean) ?? null
    const vendas = c.vendas ?? m?.vendas ?? null
    const comissaoValor = c.comissaoValor ?? m?.comissaoValor ?? null
    return {
      id: c.id, nome: c.nome, preco: c.preco ?? m?.preco ?? null, precoAnterior: o?.precoAnterior ?? null, descontoPercentual: o?.descontoPercentual ?? null,
      comissaoPercentual: c.comissaoPercentual ?? m?.comissaoPercentual ?? null, comissaoValor, vendas, avaliacao: c.avaliacao, numeroDeAvaliacoes: c.numeroDeAvaliacoes, estoque: c.estoque ?? m?.estoque ?? null,
      fonteVendas: c.vendas !== null ? 'OFICIAL_API' : m?.vendas != null ? m.fonte : null,
      fonteComissao: c.comissaoValor !== null ? 'OFICIAL_API' : m?.comissaoValor != null ? m.fonte : null,
      rankingPosicao: m?.rankingPosicao ?? null, rankingCategoria: m?.rankingCategoria ?? null, tipoDeAmostra: m?.tipoDeAmostra ?? null, observadoEm: m?.observadoEm ?? null,
      // P2.17.10: conversão REAL (vendas ÷ cliques) dos vídeos deste produto; sem os dois medidos, null.
      conversao: status.get(c.id)?.agregado.conversaoCliqueVenda ?? null,
      baseDeEvidencia: c.baseDeEvidencia,
      aderenciaNatal: campanhaDoCandidato(c, agora)?.aderencia ?? null,
      tiktokShop, ajudaMissao: missaoDeVideo && tiktokShop,
      facilidadeVideo: facilidadeDeVideo({ categoria: c.categoria, nome: c.nome, preco: c.preco }),
      nivelDeRisco: c.nivelDeRisco, complianceBloqueante: c.complianceBloqueante,
    }
  })
  const porId = new Map(candidatos.map((c) => [c.id, c]))
  const itens = montarVisao(visao, produtos).map((i) => {
    const c = porId.get(i.id)!
    const p = produtos.find((x) => x.id === i.id)!
    const k = chaveOficialDoCandidato(c)
    return {
      ...i,
      linkProduto: c.linkProduto,
      tiktokShop: p.tiktokShop,
      preco: p.preco, comissaoPercentual: p.comissaoPercentual, comissaoValor: p.comissaoValor, vendas: p.vendas, avaliacao: c.avaliacao,
      numeroDeAvaliacoes: c.numeroDeAvaliacoes, estoque: p.estoque, baseDeEvidencia: c.baseDeEvidencia,
      // P2.17.18: a tela mostra de onde veio cada sinal.
      fonteVendas: p.fonteVendas ?? null, fonteComissao: p.fonteComissao ?? null, rankingPosicao: p.rankingPosicao ?? null, rankingCategoria: p.rankingCategoria ?? null, tipoDeAmostra: p.tipoDeAmostra ?? null, observadoEm: p.observadoEm ?? null,
      dadosOficiais: dadosOficiaisParaTela(k ? oficiais.get(k) : null),
      statusEconomico: status.get(i.id)?.status ?? 'TESTANDO',
      motivoDoStatus: status.get(i.id)?.motivos[0] ?? null,
      conversao: p.conversao,
    }
  })
  const semNenhumDadoDeMercado = produtos.every((p) => p.vendas === null && p.comissaoValor === null && p.comissaoPercentual === null && !p.rankingPosicao)
  return {
    visoes: VISOES,
    visao,
    itens,
    comparacao: compararComissaoEOportunidade(produtos),
    aviso: semNenhumDadoDeMercado
      ? 'Nenhum candidato tem ainda vendas ou comissão de fonte oficial: as visões de vendas e comissão ficam sem ordem real até a primeira consulta oficial. As de Natal, TikTok, vídeo e risco já funcionam.'
      : null,
  }
}
