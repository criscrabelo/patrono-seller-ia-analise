/**
 * P2.22 — dados do SampleOpportunityScore (leitura em lote; a decisão é de `avaliarOportunidadeDeAmostra`).
 * Fonte de cada fator, em ordem de confiança: dado oficial (consulta ≤ 7 dias) → observação vigente no app
 * (≤ 7 dias) → ranking/curadoria (vale até `validoAte`). Observação expirada sem uma vigente = VENCIDO.
 */
import { estadoDoPedido, somarFinanceiro } from './financeiro'
import { prisma } from './prisma'
import { avaliarOportunidadeDeAmostra, type AvaliacaoDeAmostra, type EntradaDaAmostra, type Medida } from './oportunidade-de-amostra'
import { chavesDoCandidato, sinaisVigentes } from './observacoes-de-mercado'
import { chaveOficialDoCandidato } from './curadoria-http'
import { avaliarCampanha, campanhaAtiva } from './campanha-sazonal'
import { EXIGE_EXPERIENCIA, estruturasPossiveis, facilidadeDeVideo } from './motor-de-videos-tiktok'
import { ehProdutoTikTokShop } from './tiktok-shop-link'

export interface CandidatoParaAmostra {
  id: string; nome: string; categoria: string | null; linkProduto: string | null; providerId: string | null; externalId: string | null
  comissaoValor: number | null; comissaoPercentual: number | null; preco: number | null; vendas: number | null; validoAte: Date | null
  complianceBloqueante: boolean; compradoPelaTitular: boolean; usadoPelaTitular: boolean
}

const DIA = 86_400_000
const mediana = (xs: number[]) => { if (!xs.length) return null; const o = [...xs].sort((a, b) => a - b); const m = Math.floor(o.length / 2); return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2 }
const nada = <T>(): Medida<T> => ({ valor: null, fonte: null, em: null })

/** Avalia vários candidatos de uma vez. `emMaos` = decisão "em mãos" da jornada (além de comprado/usado). */
export async function avaliacoesDeAmostra(p: {
  workspaceId: string
  candidatos: CandidatoParaAmostra[]
  emMaos?: Set<string>
  metas: { nome: string; tipo: string; fim: Date; faltam: number }[]
  agora?: Date
}): Promise<Map<string, AvaliacaoDeAmostra>> {
  const agora = p.agora ?? new Date()
  const out = new Map<string, AvaliacaoDeAmostra>()
  if (!p.candidatos.length) return out
  const ws = p.workspaceId
  const chavesObs = p.candidatos.flatMap((c) => chavesDoCandidato(c))
  const chavesOficiais = p.candidatos.map((c) => chaveOficialDoCandidato(c)).filter((k): k is string => !!k)
  const externos = p.candidatos.map((c) => c.externalId).filter((x): x is string => !!x)
  const [obs, oficiais, perfil, daCategoria, liquidados, amostrasAnteriores, videos] = await Promise.all([
    prisma.observacaoDeMercado.findMany({ where: { workspaceId: ws, chave: { in: [...new Set(chavesObs)] }, observadoEm: { gte: new Date(agora.getTime() - 90 * DIA) } } }),
    chavesOficiais.length ? prisma.dadoOficialDeProduto.findMany({ where: { workspaceId: ws, chave: { in: chavesOficiais } } }) : [],
    prisma.perfilDaLoja.findUnique({ where: { workspaceId: ws }, select: { categoriasPrioritarias: true } }),
    prisma.candidatoDeProduto.findMany({ where: { workspaceId: ws, categoria: { in: [...new Set(p.candidatos.map((c) => c.categoria).filter((x): x is string => !!x))] }, comissaoValor: { not: null } }, select: { categoria: true, comissaoValor: true }, take: 2000 }),
    externos.length ? prisma.pedidoAfiliadoTikTok.findMany({ where: { workspaceId: ws, estado: 'LIQUIDADA', produtoIdExterno: { in: externos } }, select: { produtoIdExterno: true, estado: true, comissaoEstimada: true, comissaoLiquidada: true } }) : [],
    prisma.amostraTikTokShop.findMany({ where: { workspaceId: ws, candidatoId: { not: null } }, select: { candidatoId: true, estado: true } }),
    prisma.videoTikTokResultado.findMany({ where: { workspaceId: ws, views: { gte: 500 }, comissao: { not: null } }, select: { categoria: true, views: true, comissao: true }, take: 1000 }),
  ])
  // Loja: pelo dado oficial dos candidatos das amostras anteriores.
  const candsDasAmostras = amostrasAnteriores.length ? await prisma.candidatoDeProduto.findMany({ where: { workspaceId: ws, id: { in: [...new Set(amostrasAnteriores.map((a) => a.candidatoId!))] } }, select: { id: true, linkProduto: true } }) : []
  const chavesAnt = candsDasAmostras.map((c) => chaveOficialDoCandidato(c)).filter((k): k is string => !!k)
  const oficiaisAnt = chavesAnt.length ? await prisma.dadoOficialDeProduto.findMany({ where: { workspaceId: ws, chave: { in: chavesAnt } }, select: { chave: true, loja: true } }) : []
  const lojaDoCandidato = new Map(candsDasAmostras.map((c) => [c.id, oficiaisAnt.find((o) => o.chave === chaveOficialDoCandidato(c))?.loja ?? null]))

  const cpm = (v: { views: number | null; comissao: number | null }) => (v.comissao! / v.views!) * 1000
  const medianaGeral = mediana(videos.map(cpm))
  const campanha = campanhaAtiva(agora)
  const amostrasMetas = p.metas.filter((m) => m.tipo === 'SOLICITAR_AMOSTRAS').map((m) => ({ nome: m.nome, faltam: m.faltam, fim: m.fim }))

  for (const c of p.candidatos) {
    const chaves = chavesDoCandidato(c)
    const linhas = obs.filter((o) => chaves.includes(o.chave))
    const vig = sinaisVigentes(linhas, agora)
    const obsVencida = !vig && linhas.length > 0
    const ultimaObs = [...linhas].sort((a, b) => b.observadoEm.getTime() - a.observadoEm.getTime())[0] ?? null
    const k = chaveOficialDoCandidato(c)
    const of = k ? oficiais.find((o) => o.chave === k && o.situacao === 'OK') ?? null : null
    const ofFresco = !!of && agora.getTime() - of.consultadoEm.getTime() <= 7 * DIA
    const candVencido = !!c.validoAte && c.validoAte.getTime() < agora.getTime()
    const medidaDe = <T>(oficial: T | null | undefined, observado: T | null | undefined, curadoria: T | null | undefined): Medida<T> => {
      if (of && oficial != null) return { valor: oficial, fonte: 'Fonte oficial', em: of.consultadoEm, vencido: !ofFresco }
      if (vig && observado != null) return { valor: observado, fonte: 'Visto no app', em: new Date(vig.observadoEm) }
      if (obsVencida && ultimaObs) {
        const v = (observado ?? null) as T | null
        if (v != null) return { valor: v, fonte: 'Visto no app', em: ultimaObs.observadoEm, vencido: true }
      }
      if (curadoria != null) return { valor: curadoria, fonte: 'Ranking/curadoria', em: null, vencido: candVencido }
      return nada<T>()
    }
    const ultima = ultimaObs
    const comissaoValor = medidaDe(of?.comissaoValor, vig?.comissaoValor ?? (obsVencida ? ultima?.comissaoExibida : null), c.comissaoValor)
    const comissaoPercentual = medidaDe(of?.comissaoPercentual, vig?.comissaoPercentual ?? (obsVencida ? ultima?.comissaoPercentualExibida : null), c.comissaoPercentual)
    const preco = medidaDe(of?.preco, vig?.preco ?? (obsVencida ? ultima?.preco : null), c.preco)
    const vendas = medidaDe(of?.vendas, vig?.vendas ?? (obsVencida ? ultima?.vendasExibidas : null), c.vendas)
    const tipoObs = (vig?.tipoDeAmostra ?? (obsVencida ? ultima?.tipoDeAmostra : null)) as 'GRATIS' | 'REEMBOLSAVEL' | 'NENHUMA' | null
    const tipoDeAmostra: Medida<'GRATIS' | 'REEMBOLSAVEL' | 'NENHUMA'> = tipoObs ? { valor: tipoObs, fonte: 'Visto no app', em: vig ? new Date(vig.observadoEm) : ultima?.observadoEm ?? null, vencido: !vig } : nada()
    const disponivel: Medida<boolean> = of && of.disponivel != null ? { valor: of.estoque === 0 ? false : of.disponivel, fonte: 'Fonte oficial', em: of.consultadoEm, vencido: !ofFresco } : vig?.estoque === 0 ? { valor: false, fonte: 'Visto no app', em: new Date(vig.observadoEm) } : nada()
    const doMesmoGrupo = daCategoria.filter((x) => x.categoria === c.categoria).map((x) => x.comissaoValor!)
    const liq = c.externalId ? liquidados.filter((x) => x.produtoIdExterno === c.externalId) : []
    const loja = of?.loja ?? null
    const anteriores = loja ? amostrasAnteriores.filter((a) => a.candidatoId !== c.id && lojaDoCandidato.get(a.candidatoId!) === loja) : []
    const daCat = videos.filter((v) => v.categoria && v.categoria === c.categoria)
    const medCat = mediana(daCat.map(cpm))
    const tiktokShop = ehProdutoTikTokShop(c.providerId, c.linkProduto)
    const produto = { nome: c.nome, categoria: c.categoria, preco: c.preco, tiktokShop }
    const estruturas = estruturasPossiveis(produto, agora)
    const camp = avaliarCampanha({ categoria: c.categoria, nome: c.nome, preco: c.preco }, agora)
    const entrada: EntradaDaAmostra = {
      agora, emMaos: c.compradoPelaTitular || c.usadoPelaTitular || !!p.emMaos?.has(c.id), tiktokShop, complianceBloqueante: c.complianceBloqueante, nome: c.nome, categoria: c.categoria,
      comissaoValor, comissaoPercentual, preco, vendas,
      serieDeVendas: linhas.filter((l) => l.vendasExibidas != null).map((l) => ({ em: l.observadoEm, vendas: l.vendasExibidas! })),
      tipoDeAmostra, disponivel,
      medianaDaCategoria: doMesmoGrupo.length >= 5 ? mediana(doMesmoGrupo) : null,
      comissaoLiquidadaHistorica: liq.length ? somarFinanceiro(liq.map((x) => estadoDoPedido(x))).confirmada : null,
      categoriasDaAudiencia: perfil?.categoriasPrioritarias?.length ? perfil.categoriasPrioritarias : null,
      historicoDaLoja: loja && anteriores.length ? { loja, aprovadas: anteriores.filter((a) => ['APROVADA', 'ENVIADA', 'RECEBIDA', 'CONCLUIDA'].includes(a.estado)).length, rejeitadas: anteriores.filter((a) => a.estado === 'REJEITADA').length } : null,
      aderenciaDeCampanha: camp ? { nome: camp.nome, aderencia: camp.aderencia, fim: campanha?.fim ?? null } : null,
      metasDeAmostra: amostrasMetas, prazoDeConteudoDias: null,
      facilidadeDeVideo: c.categoria ? facilidadeDeVideo(produto) : null,
      formatosPossiveis: estruturas.length, formatosSemUsoReal: estruturas.filter((x) => !EXIGE_EXPERIENCIA.has(x)).length,
      semelhantes: medCat != null && medianaGeral && daCat.length >= 3 && videos.length - daCat.length >= 3 ? { razao: medCat / medianaGeral, videos: daCat.length } : null,
    }
    out.set(c.id, avaliarOportunidadeDeAmostra(entrada))
  }
  return out
}
