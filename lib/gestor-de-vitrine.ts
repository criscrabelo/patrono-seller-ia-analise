/**
 * P2.17.15 — GESTOR DE VITRINE do Patrono.
 *
 * A vitrine é CONSEQUÊNCIA do ranking de Oportunidades (o cérebro comercial),
 * não um ranking paralelo. O Gestor decide, para cada produto:
 *
 *   ENTRAR · MANTER · ESCALAR · OBSERVAR · SUBSTITUIR · REMOVER
 *
 * usando a MESMA régua aprovada do status econômico (lib/status-economico-
 * produto.ts: amostra mínima de 3 vídeos com 500+ views; receita, conversão
 * e comissão — nunca só views). Regras:
 *  - Nunca remove por poucas views. Sem amostra mínima → OBSERVAR.
 *  - REMOVER só por bloqueio objetivo (compliance, descartado, indisponível =
 *    status ENCERRADO).
 *  - SUBSTITUIR só com amostra suficiente E alternativa COMPROVADAMENTE melhor
 *    (status econômico melhor ou receita/1.000 views maior, com evidência).
 *  - Aguardando seller / confirmação → OBSERVAR (o TikTok ainda não decidiu).
 *  - Missão ativa ou campanha sazonal em curso seguram a troca (contexto).
 * A execução (remover de fato) só acontece com a remoção automática ligada
 * e o caminho oficial confirmado; senão a decisão fica como RECOMENDAÇÃO.
 */
import { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { statusDosProdutos } from './resultados-videos'
import { agregar } from './metricas-economicas'
import { brutoDaLinha } from './resultados-videos'
import { campanhaDoCandidato } from './curadoria-http'
import { analisarMetas, listarMetasAtivas } from './metas-tiktok'
import { LIMITES_DO_STATUS, type StatusEconomico } from './status-economico-produto'
import { selecionarElegiveis, type CandidatoParaVitrine } from './tiktok-shop-vitrine'
import { CANDIDATO_NAO_EXCLUIDO } from './produto-canonico'

export const DECISOES_DA_VITRINE = ['ENTRAR', 'MANTER', 'ESCALAR', 'OBSERVAR', 'SUBSTITUIR', 'REMOVER'] as const
export type DecisaoDaVitrine = (typeof DECISOES_DA_VITRINE)[number]
/** Tempo mínimo na vitrine antes de qualquer troca (heurística declarada, classe C). */
export const DIAS_MINIMOS_NA_VITRINE = 14
const ORDEM_DO_STATUS: Record<StatusEconomico, number> = { ESCALAR: 4, PROMISSOR: 3, TESTANDO: 2, PAUSAR: 1, ENCERRADO: 0 }

export interface SituacaoDoItem {
  estadoNaVitrine: string
  status: StatusEconomico | null
  amostraSuficiente: boolean
  videosMedidos: number
  receitaPor1000Views: number | null
  diasNaVitrine: number
  missaoAtiva: boolean
  campanhaAtiva: boolean
}
export interface Alternativa { nome: string; status: StatusEconomico | null; receitaPor1000Views: number | null; amostraSuficiente: boolean }

/** FUNÇÃO PURA. A decisão do Gestor para UM produto da vitrine, com o motivo. */
export function decidirNaVitrine(i: SituacaoDoItem, melhorAlternativa: Alternativa | null): { decisao: DecisaoDaVitrine; motivo: string } {
  if (['ENVIADO', 'ENVIO_INCERTO', 'AGUARDANDO_APROVACAO', 'REMOCAO_ENVIADA', 'REMOCAO_INCERTA'].includes(i.estadoNaVitrine)) {
    return { decisao: 'OBSERVAR', motivo: 'Aguardando confirmação na vitrine (ou aprovação do vendedor).' }
  }
  if (i.status === 'ENCERRADO') return { decisao: 'REMOVER', motivo: 'Bloqueio objetivo (compliance, descartado ou indisponível na origem).' }
  if (i.status === 'ESCALAR') return { decisao: 'ESCALAR', motivo: 'Vende com sinais saudáveis: mais conteúdo para este produto.' }
  if (i.status === 'PROMISSOR') return { decisao: 'MANTER', motivo: 'Sinais bons, ainda sem escala comprovada.' }
  if (!i.amostraSuficiente) {
    return { decisao: 'OBSERVAR', motivo: `Amostra insuficiente: ${i.videosMedidos}/${LIMITES_DO_STATUS.videosMedidosMinimos} vídeos com ${LIMITES_DO_STATUS.viewsMinimasPorVideo}+ views. Nada se remove por poucas views.` }
  }
  if (i.diasNaVitrine < DIAS_MINIMOS_NA_VITRINE) return { decisao: 'OBSERVAR', motivo: `Na vitrine há ${i.diasNaVitrine} dia(s); mínimo de ${DIAS_MINIMOS_NA_VITRINE} antes de trocar.` }
  if (i.status === 'PAUSAR') {
    if (i.missaoAtiva || i.campanhaAtiva) return { decisao: 'OBSERVAR', motivo: 'Resultado fraco, mas há missão ou campanha sazonal em curso: segura até o fim.' }
    const melhor = melhorAlternativa && melhorAlternativa.amostraSuficiente && (
      (melhorAlternativa.status !== null && ORDEM_DO_STATUS[melhorAlternativa.status] > ORDEM_DO_STATUS.PAUSAR) ||
      (melhorAlternativa.receitaPor1000Views !== null && (i.receitaPor1000Views ?? 0) < melhorAlternativa.receitaPor1000Views)
    )
    return melhor
      ? { decisao: 'SUBSTITUIR', motivo: `Amostra suficiente sem resultado; "${melhorAlternativa!.nome}" tem evidência melhor (${melhorAlternativa!.status ?? 'receita/1.000 views maior'}).` }
      : { decisao: 'OBSERVAR', motivo: 'Resultado fraco com amostra suficiente, mas não há alternativa COMPROVADAMENTE melhor.' }
  }
  return { decisao: 'MANTER', motivo: 'Sem motivo comprovado para mudar.' }
}

const DIA = 24 * 60 * 60 * 1000

export interface ItemDoGestor {
  productId: string
  nome: string
  estado: string
  entrouEm: string | null
  motivoEntrada: string | null
  comissao: { valor: number | null; percentual: number | null }
  vendasDaLoja: number | null
  conteudos: number
  views: number | null
  cliques: number | null
  vendas: number | null
  comissaoGerada: number | null
  receitaPor1000Views: number | null
  status: StatusEconomico | null
  missao: string | null
  sazonalidade: string | null
  decisao: DecisaoDaVitrine
  motivo: string
  historico: unknown[]
}

/**
 * O painel do Gestor: o que está (ou esteve) na vitrine, com dinheiro,
 * conteúdo, missão, sazonalidade, performance e a decisão. Com `persistir`,
 * grava a decisão (e o histórico) quando ela muda — só na rodada do fluxo,
 * nunca numa simples leitura de tela.
 */
export async function avaliarVitrine(workspaceId: string, opcoes: { agora?: Date; persistir?: boolean } = {}) {
  const agora = opcoes.agora ?? new Date()
  const [registros, resultados, metas] = await Promise.all([
    prisma.vitrineTikTokShop.findMany({ where: { workspaceId, estado: { notIn: ['REMOVIDO', 'COLABORACAO_NAO_CONFIRMADA'] } }, orderBy: { createdAt: 'asc' } }),
    prisma.videoTikTokResultado.findMany({ where: { workspaceId } }),
    listarMetasAtivas(workspaceId),
  ])
  const status = await statusDosProdutos(workspaceId, resultados)
  const analises = analisarMetas(metas, agora)
  const missaoComProduto = analises.find((a) => (a.situacao === 'EM_ANDAMENTO' || a.situacao === 'NAO_INICIADA') && a.usaProdutoNoVideo) ?? null
  const candidatos = await prisma.candidatoDeProduto.findMany({
    where: { workspaceId, providerId: 'tiktok-shop', externalId: { not: null }, AND: [CANDIDATO_NAO_EXCLUIDO] },
    select: { id: true, nome: true, fonte: true, providerId: true, externalId: true, status: true, complianceBloqueante: true, validoAte: true, score: true, categoria: true, preco: true, comissaoValor: true, comissaoPercentual: true, vendas: true, produtoId: true },
  })
  const produtoIds = candidatos.map((c) => c.produtoId).filter((x): x is string => !!x)
  const conteudos = produtoIds.length ? await prisma.conteudo.groupBy({ by: ['produtoId'], where: { workspaceId, produtoId: { in: produtoIds } }, _count: { produtoId: true } }) : []

  // Alternativa: o melhor elegível FORA da vitrine (mesmo ranking/seleção do fluxo).
  const elegiveisFora = selecionarElegiveis(candidatos as CandidatoParaVitrine[], registros.map((r) => ({ productId: r.productId, estado: r.estado, tentativas: r.tentativas })), 1, agora)
  const alt = elegiveisFora[0]
  const stAlt = alt ? status.get(alt.id) : undefined
  const melhorAlternativa: Alternativa | null = alt ? { nome: alt.nome, status: stAlt?.status ?? null, receitaPor1000Views: stAlt?.agregado.receitaPor1000Views ?? null, amostraSuficiente: stAlt?.amostraSuficiente ?? false } : null

  const itens: ItemDoGestor[] = []
  for (const r of registros) {
    const c = candidatos.find((x) => x.externalId === r.productId || x.id === r.candidatoId)
    const st = c ? status.get(c.id) : undefined
    const linhas = resultados.filter((x) => (c && x.candidatoId === c.id) || (c?.produtoId && x.produtoId === c.produtoId))
    const a = agregar(linhas.map(brutoDaLinha))
    const campanha = c ? campanhaDoCandidato(c, agora) : null
    const entrouEm = r.confirmadoEm ?? r.enviadoEm
    const d = decidirNaVitrine(
      {
        estadoNaVitrine: r.estado, status: st?.status ?? null, amostraSuficiente: st?.amostraSuficiente ?? false, videosMedidos: st?.videosMedidos ?? 0,
        receitaPor1000Views: a.receitaPor1000Views, diasNaVitrine: entrouEm ? Math.floor((agora.getTime() - entrouEm.getTime()) / DIA) : 0,
        missaoAtiva: !!missaoComProduto, campanhaAtiva: !!campanha && campanha.aderencia > 0,
      },
      melhorAlternativa
    )
    if (opcoes.persistir && (d.decisao !== r.decisao || d.motivo !== r.motivoDecisao)) {
      const historico = [...((r.historico as unknown[]) ?? []), { em: agora.toISOString(), acao: 'DECISAO', estado: r.estado, decisao: d.decisao, detalhe: d.motivo }]
      await prisma.vitrineTikTokShop.update({ where: { id: r.id }, data: { decisao: d.decisao, motivoDecisao: d.motivo, decididoEm: agora, historico: historico as Prisma.InputJsonValue } })
    }
    itens.push({
      productId: r.productId, nome: r.nomeProduto, estado: r.estado, entrouEm: entrouEm?.toISOString() ?? null, motivoEntrada: r.motivoEntrada,
      comissao: { valor: c?.comissaoValor ?? null, percentual: c?.comissaoPercentual ?? null }, vendasDaLoja: c?.vendas ?? null,
      conteudos: c?.produtoId ? conteudos.find((x) => x.produtoId === c.produtoId)?._count.produtoId ?? 0 : 0,
      views: a.views, cliques: a.cliquesProduto, vendas: a.vendas, comissaoGerada: a.comissao, receitaPor1000Views: a.receitaPor1000Views,
      status: st?.status ?? null, missao: missaoComProduto?.nome ?? null, sazonalidade: campanha && campanha.aderencia > 0 ? campanha.nome : null,
      decisao: d.decisao, motivo: d.motivo, historico: (r.historico as unknown[]) ?? [],
    })
  }
  return {
    itens,
    /** ENTRAR: o próximo elegível do ranking (a inclusão é o fluxo automático, quando autorizado). */
    entrar: alt ? { candidatoId: alt.id, nome: alt.nome, productId: alt.externalId, motivo: 'Melhor elegível do ranking de Oportunidades com colaboração aberta confirmada.' } : null,
  }
}

/**
 * P2.17.15 — O CICLO da vitrine (o que roda quando a API estiver autorizada):
 * conferir pendentes → incluir os elegíveis do ranking → o Gestor decide →
 * executar REMOVER/SUBSTITUIR só se a remoção automática estiver ligada (com
 * caminho oficial); senão a decisão fica registrada como recomendação.
 * Desligado = não faz nada e diz por quê.
 */
export async function cicloDaVitrine(workspaceId: string, deps: import('./tiktok-shop-vitrine').DepsDaVitrine & { limite?: number } = {}) {
  const { rodarVitrineAutomatica, removerDaVitrine, configuracaoDaVitrine } = await import('./tiktok-shop-vitrine')
  const agora = deps.agora ?? new Date()
  const rodada = await rodarVitrineAutomatica(workspaceId, deps)
  if (!rodada.ligada) return { ...rodada, decisoes: [] as { productId: string; decisao: DecisaoDaVitrine; executada: boolean; motivo: string }[] }
  const gestao = await avaliarVitrine(workspaceId, { agora, persistir: true })
  const cfg = configuracaoDaVitrine(deps.env)
  const decisoes: { productId: string; decisao: DecisaoDaVitrine; executada: boolean; motivo: string }[] = []
  for (const i of gestao.itens) {
    let executada = false
    if ((i.decisao === 'REMOVER' || i.decisao === 'SUBSTITUIR') && i.estado === 'CONFIRMADO_NA_VITRINE' && cfg.remocao.ligada) {
      const r = await removerDaVitrine(workspaceId, i.productId, `${i.decisao}: ${i.motivo}`, deps)
      executada = r.ok
    }
    decisoes.push({ productId: i.productId, decisao: i.decisao, executada, motivo: i.motivo })
  }
  return { ...rodada, decisoes }
}
