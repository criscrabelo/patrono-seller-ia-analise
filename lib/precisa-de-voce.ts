/**
 * P2.15 (Fase 1) — "Precisa de você": a fila central de exceções e aprovações.
 *
 * Regra de ouro: só aparece o que SÓ a titular pode decidir. Antes de
 * listar, a fila se limpa sozinha:
 *   - pedido vencido → EXPIRADA;
 *   - escolha cujo candidato já não está apresentado (a titular escolheu em
 *     Oportunidades, descartou, ou uma coleta nova mudou o top) → CANCELADA.
 *
 * Decidir executa a ação aprovada na hora (aprovar escolha = escolher o
 * produto), sempre pelos motores com as mesmas garantias (idempotência,
 * atomicidade, ledger). "Sempre aprovar casos assim" vira ApprovalRule.
 */
import type { ApprovalRequest } from '@prisma/client'
import { prisma } from './prisma'
import { criarRegra, decidirAprovacao, ErroDeAprovacao, expirarVencidas, pendentes, type CondicaoDaRegra, cancelarPedidosPendentes } from './aprovacoes'
import { escolherCandidato } from './curadoria'
import { TIPO_ESCOLHA, TIPO_EXCECAO } from './supervisor/ciclo'
import { comContexto, contextoAtual, novoCorrelationId } from './observabilidade'
import { registrarDecisao, registrarEvento } from './ledger'
import { CHAVE_TIKTOK_SHOP, evidenciaDoTikTokShop, exigeEvidencia, PASSOS_TIKTOK_SHOP } from './tiktok-shop-evidencia'
import { situacaoDaAffiliateApi } from './elegibilidade-tiktok-shop'

export interface ItemPrecisaDeVoce {
  id: string
  tipo: string
  titulo: string
  resumo: string
  porque: string[]
  risco: string
  criadoEm: string
  expiraEm: string | null
  /** Rótulos dos botões, pela natureza do pedido. */
  acoes: { aprovar: string; rejeitar: string }
  link: string | null
  podeVirarRegra: boolean
  /**
   * P2.15.3: false = nenhum clique tira o item da fila (ex.: TikTok Shop);
   * ele só sai sozinho quando houver evidência real no sistema.
   */
  podeMarcarResolvido: boolean
  /** Passo a passo de "Ver como fazer" (só itens que exigem evidência). */
  comoFazer: string[] | null
}

export function rotulos(tipo: string, chave = ''): ItemPrecisaDeVoce['acoes'] {
  if (exigeEvidencia(chave)) return { aprovar: 'Ver como fazer', rejeitar: 'Agora não' }
  if (tipo === TIPO_EXCECAO) return { aprovar: 'Já resolvi', rejeitar: 'Ignorar' }
  if (tipo === TIPO_ESCOLHA) return { aprovar: 'Escolher este produto', rejeitar: 'Agora não' }
  return { aprovar: 'Aprovar', rejeitar: 'Rejeitar' }
}

function paraItem(r: ApprovalRequest): ItemPrecisaDeVoce {
  const acao = (r.acaoProposta ?? {}) as Record<string, unknown>
  return {
    id: r.id,
    tipo: r.tipo,
    titulo: r.titulo,
    resumo: r.resumo,
    porque: r.porque,
    risco: r.risco,
    criadoEm: r.criadoEm.toISOString(),
    expiraEm: r.expiraEm?.toISOString() ?? null,
    acoes: rotulos(r.tipo, r.chave),
    link: typeof acao.link === 'string' ? acao.link : r.tipo === TIPO_ESCOLHA ? '/oportunidades' : null,
    podeVirarRegra: r.tipo === TIPO_ESCOLHA,
    podeMarcarResolvido: !exigeEvidencia(r.chave),
    comoFazer: exigeEvidencia(r.chave) ? PASSOS_TIKTOK_SHOP : null,
  }
}

const PRIORIDADE_DO_RISCO: Record<string, number> = { ALTO: 0, MEDIO: 1, BAIXO: 2 }

/**
 * FUNÇÃO PURA (P2.15.1): o mais urgente primeiro — risco alto, depois médio,
 * depois baixo; no mesmo risco, o mais antigo primeiro. Tela, card e Copilot
 * ("aprovar 1") usam esta mesma ordem.
 */
export function porPrioridade<T extends { risco: string; criadoEm: string }>(itens: T[]): T[] {
  return [...itens].sort((a, b) => (PRIORIDADE_DO_RISCO[a.risco] ?? 3) - (PRIORIDADE_DO_RISCO[b.risco] ?? 3) || a.criadoEm.localeCompare(b.criadoEm))
}

/**
 * P2.15.3: item que exige evidência sai da fila SÓ quando ela existe — e a
 * resolução fica no ledger (decisão do SISTEMA + evento), idempotente.
 * Devolve os ids resolvidos agora.
 */
async function resolverPorEvidencia(workspaceId: string, lista: ApprovalRequest[], agora: Date): Promise<Set<string>> {
  const resolvidos = new Set<string>()
  for (const r of lista.filter((x) => exigeEvidencia(x.chave))) {
    const evidencia = await evidenciaDoTikTokShop(workspaceId, agora)
    if (!evidencia) continue
    await prisma.$transaction(async (tx) => {
      const u = await tx.approvalRequest.updateMany({
        where: { id: r.id, workspaceId, status: 'PENDENTE' },
        data: { status: 'APROVADA', decididoEm: agora, motivoDaDecisao: `Resolvido por evidência: ${evidencia}` },
      })
      if (u.count !== 1) return
      await registrarDecisao(
        { workspaceId, tipo: 'RESOLUCAO_POR_EVIDENCIA', ator: 'SISTEMA', decisao: 'Resolvido por evidência.', explicacao: [evidencia], entradas: { pedidoTipo: r.tipo, titulo: r.titulo }, entidadeTipo: 'ApprovalRequest', entidadeId: r.id, chaveIdempotencia: `evidencia:${r.chave}` },
        tx
      )
      await registrarEvento(
        { workspaceId, tipo: 'APPROVAL_GRANTED', chaveIdempotencia: `evidencia:${r.chave}`, entidadeTipo: 'ApprovalRequest', entidadeId: r.id, payload: { resolvidoPor: 'EVIDENCIA', evidencia } },
        tx
      )
      resolvidos.add(r.id)
    })
  }
  return resolvidos
}

/** Limpa o que já não precisa da titular e devolve o que sobra, por prioridade. */
export async function listarPrecisaDeVoce(workspaceId: string, agora = new Date()): Promise<ItemPrecisaDeVoce[]> {
  // P2.15.6: 2 idas em vez de 4. `pendentes` já ignora o que venceu, então
  // expirar e listar saem juntos; depois, a evidência do TikTok Shop e a
  // conferência dos candidatos (independentes) também saem juntas.
  const [, todos] = await Promise.all([expirarVencidas(workspaceId, agora), pendentes(workspaceId, agora)])
  const idsDasEscolhas = todos
    .filter((r) => r.tipo === TIPO_ESCOLHA)
    .map((r) => (r.acaoProposta as { candidatoId?: string } | null)?.candidatoId)
    .filter((x): x is string => !!x)
  const [resolvidos, vivosLidos] = await Promise.all([
    resolverPorEvidencia(workspaceId, todos, agora),
    idsDasEscolhas.length
      ? prisma.candidatoDeProduto.findMany({ where: { workspaceId, id: { in: idsDasEscolhas }, status: 'APRESENTADO' }, select: { id: true } })
      : Promise.resolve([] as { id: string }[]),
  ])
  // P2.18.3: o pedido de onboarding do TikTok Shop é impossível até a data-base (elegibilidade da empresa).
  // Sai da fila com o motivo registrado — não é clique de ninguém, é a regra oficial.
  const elegib = situacaoDaAffiliateApi(agora)
  const impossiveis = elegib.bloqueada ? todos.filter((r) => r.chave === CHAVE_TIKTOK_SHOP && !resolvidos.has(r.id)) : []
  if (impossiveis.length) {
    await cancelarPedidosPendentes({ workspaceId, filtro: { id: { in: impossiveis.map((r) => r.id) } }, motivo: elegib.frase, agora })
    for (const r of impossiveis) resolvidos.add(r.id)
  }
  const lista = todos.filter((r) => !resolvidos.has(r.id))
  const escolhas = lista.filter((r) => r.tipo === TIPO_ESCOLHA)
  if (escolhas.length) {
    const vivos = new Set(vivosLidos.map((c) => c.id))
    const mortos = escolhas.filter((r) => !vivos.has((r.acaoProposta as { candidatoId?: string } | null)?.candidatoId ?? ''))
    if (mortos.length) {
      await cancelarPedidosPendentes({ workspaceId, filtro: { id: { in: mortos.map((m) => m.id) } }, motivo: 'O candidato já não está entre os apresentados.', agora })
    }
    const mortosIds = new Set(mortos.map((m) => m.id))
    return porPrioridade(lista.filter((r) => !mortosIds.has(r.id)).map(paraItem))
  }
  return porPrioridade(lista.map(paraItem))
}

export async function contarPrecisaDeVoce(workspaceId: string, agora = new Date()): Promise<number> {
  return (await listarPrecisaDeVoce(workspaceId, agora)).length
}

export interface ResultadoDaDecisao {
  /** PENDENTE = nada mudou (ex.: "Agora não" num item que exige evidência). */
  status: 'APROVADA' | 'REJEITADA' | 'PENDENTE'
  mensagem: string
  regraCriada: boolean
}

/**
 * A titular decide; a ação aprovada é executada na hora. P2.15.2: aprovação
 * e ação (ex.: escolher o produto) ficam no ledger com o MESMO correlationId.
 */
export function decidirPrecisaDeVoce(p: ParametrosDaDecisao): Promise<ResultadoDaDecisao> {
  return comContexto(
    { correlationId: contextoAtual()?.correlationId ?? novoCorrelationId('decisao'), workspaceId: p.workspaceId, ator: 'TITULAR' },
    () => decidirNoContexto(p)
  )
}

interface ParametrosDaDecisao {
  workspaceId: string
  userId: string
  id: string
  decisao: 'APROVAR' | 'REJEITAR'
  motivo?: string | null
  /** Só para escolha de produto: "sempre aprovar casos assim". */
  sempre?: boolean
  agora?: Date
}

async function decidirNoContexto(p: ParametrosDaDecisao): Promise<ResultadoDaDecisao> {
  const agora = p.agora ?? new Date()
  const pedido = await prisma.approvalRequest.findFirst({ where: { id: p.id, workspaceId: p.workspaceId } })
  if (!pedido) throw new ErroDeAprovacao(404, 'Pedido não encontrado.')

  // P2.15.3: nenhum clique (botão, Copilot ou API) tira da fila um item que exige evidência.
  if (exigeEvidencia(pedido.chave) && pedido.status === 'PENDENTE') {
    if (p.decisao === 'APROVAR')
      throw new ErroDeAprovacao(409, 'Este item só sai sozinho, quando a conexão com o TikTok Shop existir de verdade no sistema. Nada foi alterado.')
    return { status: 'PENDENTE', mensagem: 'Ok, fica para depois. O item continua na lista até a conexão existir.', regraCriada: false }
  }

  const { status } = await decidirAprovacao({ workspaceId: p.workspaceId, id: p.id, decisao: p.decisao, userId: p.userId, motivo: p.motivo ?? null, agora })
  let mensagem = status === 'APROVADA' ? 'Feito.' : 'Ok, não será feito.'
  let regraCriada = false

  if (status === 'APROVADA' && pedido.tipo === TIPO_ESCOLHA) {
    const candidatoId = (pedido.acaoProposta as { candidatoId?: string } | null)?.candidatoId
    if (!candidatoId) throw new ErroDeAprovacao(409, 'Pedido sem candidato.')
    const r = await escolherCandidato({ workspaceId: p.workspaceId, userId: p.userId, candidatoId, agora, ator: 'TITULAR' })
    mensagem = r.produtoCriado ? 'Produto escolhido e cadastrado.' : 'Produto escolhido.'
  }
  if (status === 'APROVADA' && pedido.tipo === TIPO_EXCECAO) mensagem = 'Marcado como resolvido. Se o problema voltar, o Patrono avisa de novo.'

  if (status === 'APROVADA' && p.sempre && pedido.tipo === TIPO_ESCOLHA) {
    const c = await prisma.candidatoDeProduto.findFirst({ where: { id: (pedido.acaoProposta as { candidatoId: string }).candidatoId }, select: { categoria: true, preco: true } })
    const condicao: CondicaoDaRegra = { riscoMax: (['BAIXO', 'MEDIO', 'ALTO'].includes(pedido.risco) ? pedido.risco : 'BAIXO') as CondicaoDaRegra['riscoMax'] }
    if (c?.categoria) condicao.categoriaIn = [c.categoria]
    if (typeof c?.preco === 'number') condicao.precoMax = Math.ceil(c.preco)
    await criarRegra({ workspaceId: p.workspaceId, tipo: TIPO_ESCOLHA, condicao, efeito: 'APROVAR', userId: p.userId, motivo: 'Criada em "Precisa de você" (sempre aprovar casos assim).' })
    regraCriada = true
    mensagem += ' Daqui em diante, casos assim o Patrono resolve sozinho.'
  }
  return { status: status as ResultadoDaDecisao['status'], mensagem, regraCriada }
}
