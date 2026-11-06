/**
 * P2.17.10 — Resultados REAIS dos vídeos publicados, ligados ao aprendizado
 * e ao status econômico dos produtos.
 *
 *   publicação confirmada → linha em VideoTikTokResultado (métricas NULL)
 *   métricas (manual pela titular até haver API; Display API depois)
 *   → métricas derivadas (CTR, conversão, por 1.000 views…)
 *   → aprendizado por produto/categoria/estrutura/gancho/CTA/duração/horário
 *   → status do produto (TESTANDO/PROMISSOR/ESCALAR/PAUSAR/ENCERRADO)
 *
 * Métrica não informada continua NULL. Nada é estimado.
 */
import { estadoDoPedido, CONFIRMADOS } from './financeiro'
import { prisma } from './prisma'
import { registrarAuditoria } from './audit-log'
import { aprender, decisaoPorEstrutura, DIMENSOES, registroDaLinha } from './aprendizado-videos-tiktok'
import { agregar, metricasDerivadas, type MetricasBrutas } from './metricas-economicas'
import { statusEconomico, type StatusDoProduto } from './status-economico-produto'
import { chaveOficialDoCandidato } from './curadoria-http'
import { CANDIDATO_NAO_EXCLUIDO } from './produto-canonico'
import { aprenderCriativo, orientacaoParaOPlanejador, type VideoParaAprender } from './aprendizado-criativo'
import { garantirDnaDosResultados } from './dna-criativo'

export const CAMPOS_DE_METRICA = ['views', 'retencaoMedia', 'tempoMedioSeg', 'cliquesProduto', 'ctr', 'adicoesCarrinho', 'vendas', 'comissao', 'receita'] as const
export type CampoDeMetrica = (typeof CAMPOS_DE_METRICA)[number]
export type MetricasInformadas = Partial<Record<CampoDeMetrica, number | null>>

export class ErroDeResultado extends Error {
  constructor(public readonly status: 400 | 404, mensagem: string) {
    super(mensagem)
  }
}

const INTEIROS: CampoDeMetrica[] = ['views', 'cliquesProduto', 'adicoesCarrinho', 'vendas']

/** FUNÇÃO PURA. Valida o que foi informado. Ausente = não mexe; `null` = apaga (volta a desconhecido). */
export function validarMetricas(m: MetricasInformadas): string | null {
  for (const [campo, v] of Object.entries(m) as [CampoDeMetrica, number | null][]) {
    if (v === null || v === undefined) continue
    if (!Number.isFinite(v) || v < 0) return `"${campo}" precisa ser um número maior ou igual a zero.`
    if (INTEIROS.includes(campo) && !Number.isInteger(v)) return `"${campo}" precisa ser um número inteiro.`
    if ((campo === 'retencaoMedia' || campo === 'ctr') && v > 1) return `"${campo}" vai de 0 a 1 (ex.: 0,35 = 35%).`
  }
  if (typeof m.vendas === 'number' && typeof m.cliquesProduto === 'number' && m.vendas > m.cliquesProduto && m.cliquesProduto > 0) {
    return 'Mais vendas que cliques no produto: confira os números.'
  }
  return null
}

export async function atualizarMetricas(p: { workspaceId: string; userId: string | null; id: string; metricas: MetricasInformadas; origem: 'MANUAL' | 'API_TIKTOK' | 'LINK_RASTREADO' }) {
  const erro = validarMetricas(p.metricas)
  if (erro) throw new ErroDeResultado(400, erro)
  const atual = await prisma.videoTikTokResultado.findFirst({ where: { id: p.id, workspaceId: p.workspaceId } })
  if (!atual) throw new ErroDeResultado(404, 'Resultado não encontrado.')
  const dados: Record<string, number | null> = {}
  for (const c of CAMPOS_DE_METRICA) if (c in p.metricas) dados[c] = p.metricas[c] ?? null
  // CTR informado vale; sem ele, deriva de cliques ÷ views quando os dois existem.
  if (!('ctr' in p.metricas)) {
    const views = 'views' in dados ? dados.views : atual.views
    const cliques = 'cliquesProduto' in dados ? dados.cliquesProduto : atual.cliquesProduto
    dados.ctr = metricasDerivadas({ views, cliquesProduto: cliques, adicoesCarrinho: null, vendas: null, comissao: null, receita: null }).ctr
  }
  const r = await prisma.videoTikTokResultado.update({ where: { id: atual.id }, data: { ...dados, origemMetricas: p.origem } })
  await registrarAuditoria({ workspaceId: p.workspaceId, userId: p.userId ?? undefined, action: 'tiktok.resultado_atualizado', entityType: 'VideoTikTokResultado', entityId: r.id, metadata: { campos: Object.keys(dados), origem: p.origem } })
  return r
}

type Linha = Awaited<ReturnType<typeof prisma.videoTikTokResultado.findMany>>[number]

export function brutoDaLinha(l: Linha): MetricasBrutas {
  return { views: l.views, cliquesProduto: l.cliquesProduto, adicoesCarrinho: l.adicoesCarrinho, vendas: l.vendas, comissao: l.comissao, receita: l.receita, retencaoMedia: l.retencaoMedia, tempoMedioSeg: l.tempoMedioSeg }
}

/** A chave do produto num resultado: candidato, produto ou nome. */
export const chaveDoProdutoDoResultado = (l: Pick<Linha, 'candidatoId' | 'produtoId' | 'nomeProduto'>) => l.candidatoId ?? l.produtoId ?? `nome:${l.nomeProduto ?? '?'}`

export async function listarResultados(workspaceId: string) {
  const linhas = await prisma.videoTikTokResultado.findMany({ where: { workspaceId }, orderBy: [{ publicadoEm: 'desc' }, { id: 'desc' }], take: 200 })
  return linhas.map((l) => ({ ...l, derivadas: metricasDerivadas(brutoDaLinha(l)) }))
}

/** Aprendizado real: todas as dimensões, com o mínimo estatístico do motor. */
export function aprendizadoDasLinhas(linhas: Linha[]) {
  const registros = linhas.map((l) => registroDaLinha(l))
  return DIMENSOES.map((d) => {
    const a = aprender(registros, d)
    return { ...a, decisoes: decisaoPorEstrutura(a) }
  })
}

/**
 * Status econômico de cada produto em aberto ou com vídeo publicado.
 * Chave = id do candidato (ou do produto).
 */
export async function statusDosProdutos(workspaceId: string, linhas?: Linha[]): Promise<Map<string, StatusDoProduto & { nome: string }>> {
  const resultados = linhas ?? (await prisma.videoTikTokResultado.findMany({ where: { workspaceId } }))
  const candidatoIds = [...new Set(resultados.map((r) => r.candidatoId).filter((x): x is string => !!x))]
  const candidatos = await prisma.candidatoDeProduto.findMany({
    where: { workspaceId, OR: [{ status: { in: ['NOVO', 'APRESENTADO'] }, AND: [CANDIDATO_NAO_EXCLUIDO] }, { id: { in: candidatoIds } }] },
    select: { id: true, nome: true, status: true, produtoId: true, linkProduto: true, nivelDeRisco: true, complianceBloqueante: true, comissaoValor: true },
  })
  const chaves = [...new Set(candidatos.map((c) => chaveOficialDoCandidato(c)).filter((k): k is string => !!k))]
  const oficiais = new Map(
    (await prisma.dadoOficialDeProduto.findMany({ where: { workspaceId, chave: { in: chaves } }, select: { chave: true, disponivel: true, estoque: true } })).map((d) => [d.chave, d])
  )
  const porProduto = new Map<string, Linha[]>()
  for (const r of resultados) porProduto.set(chaveDoProdutoDoResultado(r), [...(porProduto.get(chaveDoProdutoDoResultado(r)) ?? []), r])

  const out = new Map<string, StatusDoProduto & { nome: string }>()
  for (const c of candidatos) {
    const videos = [...(porProduto.get(c.id) ?? []), ...(c.produtoId ? porProduto.get(c.produtoId) ?? [] : [])]
    const k = chaveOficialDoCandidato(c)
    const oficial = k ? oficiais.get(k) : undefined
    const s = statusEconomico({
      videos: videos.map((v) => ({ ...brutoDaLinha(v), publicadoEm: v.publicadoEm })),
      disponivel: oficial?.disponivel ?? null,
      estoque: oficial?.estoque ?? null,
      nivelDeRisco: c.nivelDeRisco,
      complianceBloqueante: c.complianceBloqueante,
      encerradoNaOrigem: c.status === 'DESCARTADO',
      comissaoPorVendaConhecida: c.comissaoValor,
    })
    out.set(c.id, { ...s, nome: c.nome })
  }
  // Resultados de produtos sem candidato (ex.: catálogo antigo) também ganham status.
  for (const [chave, vs] of porProduto) {
    if (out.has(chave) || candidatos.some((c) => c.produtoId === chave)) continue
    const s = statusEconomico({ videos: vs.map((v) => ({ ...brutoDaLinha(v), publicadoEm: v.publicadoEm })), disponivel: null, estoque: null, nivelDeRisco: null, complianceBloqueante: false, encerradoNaOrigem: false, comissaoPorVendaConhecida: null })
    out.set(chave, { ...s, nome: vs[0].nomeProduto ?? 'Produto' })
  }
  return out
}

/**
 * P2.21 — vídeos no formato do aprendizado criativo. Comissão: pedidos importados ligados ao vídeo
 * (LIQUIDADA = confirmada; ESTIMADA/NAO_LIQUIDADA = estimada; CANCELADA fora); sem pedidos importados,
 * a comissão informada pela titular conta como ESTIMADA. Produto pela identidade (nunca pelo nome).
 */
export async function videosParaAprender(workspaceId: string, linhas?: Linha[]): Promise<VideoParaAprender[]> {
  const rs = linhas ?? (await prisma.videoTikTokResultado.findMany({ where: { workspaceId }, orderBy: [{ publicadoEm: 'desc' }, { id: 'desc' }], take: 500 }))
  const pedidos = rs.length ? await prisma.pedidoAfiliadoTikTok.findMany({ where: { workspaceId, videoResultadoId: { in: rs.map((r) => r.id) } }, select: { videoResultadoId: true, estado: true, comissaoEstimada: true, comissaoLiquidada: true } }) : []
  return rs.map((l) => {
    const ps = pedidos.filter((x) => x.videoResultadoId === l.id && x.estado !== 'CANCELADA')
    let confirmada: number | null = null, estimada: number | null = null, qtd: number | null = l.vendas
    if (ps.length) {
      qtd = ps.length
      // P2.25: régua canônica (lib/financeiro.ts) — confirmada pesa 1, estimada/não liquidada pesa menos no aprendizado.
      for (const x of ps) {
        const e = estadoDoPedido(x)
        if (CONFIRMADOS.includes(e.estado)) { if (x.comissaoLiquidada != null) confirmada = (confirmada ?? 0) + e.valor }
        else if (x.comissaoEstimada != null) estimada = (estimada ?? 0) + e.valor
      }
    } else if (l.comissao != null) estimada = l.comissao
    return {
      id: l.id, publicadoEm: l.publicadoEm, produto: l.candidatoId ?? l.produtoId ?? 'SEM_IDENTIFICADOR', categoria: l.categoria, canal: l.canal,
      estrutura: l.estrutura, tipoDeGancho: l.tipoDeGancho, tipoDeCta: l.tipoDeCta, duracaoSegundos: l.duracaoSegundos, formatoDoConteudo: l.formatoDoConteudo,
      temRosto: l.temRosto, temDemonstracao: l.temDemonstracao, temNarracao: l.temNarracao, temTextoNaTela: l.temTextoNaTela,
      views: l.views, cliques: l.cliquesProduto, pedidos: qtd, comissaoConfirmada: confirmada, comissaoEstimada: estimada,
    }
  })
}

/** P2.21 — aprendizado criativo do workspace (garante o DNA antes; recalcula a cada leitura). */
export async function aprendizadoCriativoDoWorkspace(workspaceId: string, agora = new Date(), linhas?: Linha[]) {
  const r = await garantirDnaDosResultados(workspaceId)
  const atual = r.extraidos || r.reclassificados || !linhas ? undefined : linhas
  const aprendizado = aprenderCriativo(await videosParaAprender(workspaceId, atual), agora)
  return { aprendizado, orientacao: orientacaoParaOPlanejador(aprendizado) }
}

/** Painel de resultados: lista + aprendizado + status por produto. */
export async function painelDeResultados(workspaceId: string) {
  await garantirDnaDosResultados(workspaceId)
  const linhas = await prisma.videoTikTokResultado.findMany({ where: { workspaceId }, orderBy: [{ publicadoEm: 'desc' }, { id: 'desc' }], take: 200 })
  const status = await statusDosProdutos(workspaceId, linhas)
  const criativo = await aprendizadoCriativoDoWorkspace(workspaceId, new Date(), linhas)
  const total = agregar(linhas.map(brutoDaLinha))
  return {
    resultados: linhas.map((l) => ({
      id: l.id, nomeProduto: l.nomeProduto, categoria: l.categoria, estrutura: l.estrutura, gancho: l.gancho, cta: l.ctaTexto ?? `CTA ${l.cta}`,
      duracaoSegundos: l.duracaoSegundos, canal: l.canal, publicadoEm: l.publicadoEm.toISOString(), urlDoVideo: l.urlDoVideo, postId: l.postId, metasIds: l.metasIds,
      views: l.views, retencaoMedia: l.retencaoMedia, tempoMedioSeg: l.tempoMedioSeg, cliquesProduto: l.cliquesProduto, ctr: l.ctr, adicoesCarrinho: l.adicoesCarrinho,
      vendas: l.vendas, comissao: l.comissao, receita: l.receita, origemMetricas: l.origemMetricas, derivadas: metricasDerivadas(brutoDaLinha(l)),
      dna: { tipoDeGancho: l.tipoDeGancho, confiancaDoGancho: l.confiancaDoGancho, tipoDeCta: l.tipoDeCta, formatoDoConteudo: l.formatoDoConteudo, tipoDeMidia: l.tipoDeMidia, origemDaMidia: l.origemDaMidia, temRosto: l.temRosto, temDemonstracao: l.temDemonstracao, temNarracao: l.temNarracao, temTextoNaTela: l.temTextoNaTela, origemDoDna: l.origemDoDna },
    })),
    total,
    aprendizado: aprendizadoDasLinhas(linhas),
    aprendizadoCriativo: criativo.aprendizado,
    orientacao: criativo.orientacao,
    produtos: [...status.entries()].map(([id, s]) => ({ id, nome: s.nome, status: s.status, motivos: s.motivos, videos: s.agregado.videos, videosMedidos: s.videosMedidos, faltamVideos: s.faltamVideos, vendas: s.agregado.vendas, receita: s.agregado.receitaDoVideo, receitaPor1000Views: s.agregado.receitaPor1000Views, ctr: s.agregado.ctr, conversao: s.agregado.conversaoCliqueVenda })),
  }
}
