/**
 * P2.25 — FONTE CANÔNICA DO DINHEIRO: estado de cada comissão, soma e peso no aprendizado.
 *
 * Toda tela (Resultados, Dashboard, Operação, Aprendizado, Monetização, Torre, Central, Copiloto) soma
 * comissão por AQUI. Cada comissão cai em UM estado só, então nunca é contada duas vezes:
 *
 *   ESTIMADA       pedido pago, pode cancelar — previsão, não é receita;
 *   NAO_LIQUIDADA  pedido concluído, aguardando a liquidação da plataforma — previsão;
 *   LIQUIDADA      valor real confirmado pela plataforma (ou confirmado pela titular) — receita confirmada;
 *   RECEBIDA       dinheiro na conta, marcado pela titular — receita confirmada (é a liquidada que já caiu);
 *   REVERTIDA      era liquidada/recebida e foi cancelada/reembolsada na origem — sai da receita;
 *   CANCELADA      estimativa que nunca virou comissão — sai de tudo.
 *
 * "Confirmado" = LIQUIDADA + RECEBIDA. "Previsão" = ESTIMADA + NAO_LIQUIDADA. Estimativa nunca vira receita.
 *
 * Funções puras na primeira metade; leituras do banco no fim (cadeia de atribuição).
 */

export type EstadoFinanceiro = 'ESTIMADA' | 'NAO_LIQUIDADA' | 'LIQUIDADA' | 'RECEBIDA' | 'REVERTIDA' | 'CANCELADA'

/** Peso de cada estado no aprendizado (P2.21 / Learning Engine): confirmado pesa mais que estimado. */
export const PESO_NO_APRENDIZADO: Record<EstadoFinanceiro, number> = {
  RECEBIDA: 1,
  LIQUIDADA: 1,
  NAO_LIQUIDADA: 0.5,
  ESTIMADA: 0.5,
  REVERTIDA: 0,
  CANCELADA: 0,
}
/** Peso da comissão ainda não confirmada (estimada / não liquidada) no aprendizado. */
export const PESO_DA_COMISSAO_ESTIMADA = PESO_NO_APRENDIZADO.ESTIMADA

export const CONFIRMADOS: readonly EstadoFinanceiro[] = ['LIQUIDADA', 'RECEBIDA']
export const PREVISTOS: readonly EstadoFinanceiro[] = ['ESTIMADA', 'NAO_LIQUIDADA']

export interface ComissaoParaClassificar {
  status: string
  expectedAmount: number | null
  confirmedAmount: number | null
  receivedAmount: number | null
}

const num = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) ? n : 0)
const arred = (n: number) => Math.round(n * 100) / 100

/**
 * P2.50 (Codex 19, opção B — sem migration): valor em reais → centavos INTEIROS.
 * Somar em centavos elimina o erro acumulado do Float (0,1 + 0,2 ≠ 0,3).
 */
export const centavos = (n: number | null | undefined): number => Math.round((num(n) + Number.EPSILON * Math.sign(num(n))) * 100)

/** P2.50 (Codex 19): dinheiro na GRAVAÇÃO — sempre 2 casas; ausente continua ausente (null), nunca zero. */
export function dinheiro(n: number | null | undefined): number | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null
  return centavos(n) / 100
}

/**
 * Estado canônico de UMA comissão. `vendaStatus` = status da Sale (CANCELLED tira da receita);
 * `pedidoEstado` = estado do pedido importado (distingue ESTIMADA de NAO_LIQUIDADA). `valor` é o valor do
 * próprio estado (não soma estágios).
 */
export function estadoDaComissao(c: ComissaoParaClassificar, vendaStatus?: string | null, pedidoEstado?: string | null): { estado: EstadoFinanceiro; valor: number } {
  const confirmada = c.confirmedAmount ?? c.expectedAmount
  if (c.status === 'REVERSED') return { estado: 'REVERTIDA', valor: num(c.receivedAmount ?? confirmada) }
  if (c.status === 'CANCELLED') return { estado: 'CANCELADA', valor: num(c.expectedAmount) }
  if (vendaStatus === 'CANCELLED' || pedidoEstado === 'CANCELADA') {
    // Linhas antigas (antes da P2.25 a comissão não mudava de status quando a venda era cancelada).
    return c.status === 'CONFIRMED' || c.status === 'RECEIVED' ? { estado: 'REVERTIDA', valor: num(c.receivedAmount ?? confirmada) } : { estado: 'CANCELADA', valor: num(c.expectedAmount) }
  }
  if (c.status === 'RECEIVED') return { estado: 'RECEBIDA', valor: num(c.receivedAmount ?? confirmada) }
  // Confirmada sem valor digitado: vale o valor previsto que a titular confirmou (regra da tela de vendas).
  if (c.status === 'CONFIRMED') return { estado: 'LIQUIDADA', valor: num(confirmada) }
  return { estado: pedidoEstado === 'NAO_LIQUIDADA' ? 'NAO_LIQUIDADA' : 'ESTIMADA', valor: num(c.expectedAmount) }
}

/** Estado canônico de um pedido importado do Creator Center (mesma régua). */
export function estadoDoPedido(p: { estado: string; comissaoEstimada: number | null; comissaoLiquidada: number | null }): { estado: EstadoFinanceiro; valor: number } {
  if (p.estado === 'LIQUIDADA') return { estado: 'LIQUIDADA', valor: num(p.comissaoLiquidada) }
  if (p.estado === 'NAO_LIQUIDADA') return { estado: 'NAO_LIQUIDADA', valor: num(p.comissaoEstimada) }
  if (p.estado === 'CANCELADA') return { estado: p.comissaoLiquidada != null ? 'REVERTIDA' : 'CANCELADA', valor: num(p.comissaoLiquidada ?? p.comissaoEstimada) }
  return { estado: 'ESTIMADA', valor: num(p.comissaoEstimada) }
}

export interface SomaFinanceira {
  estimada: number
  naoLiquidada: number
  liquidada: number
  recebida: number
  revertida: number
  cancelada: number
  /** Efetivamente confirmado = liquidada + recebida. É a única "receita". */
  confirmada: number
  /** Previsão = estimada + não liquidada. Nunca é receita. */
  previsao: number
  quantidade: Record<EstadoFinanceiro, number>
}

/**
 * Soma canônica. Itens com o mesmo `id` contam UMA vez (a mesma comissão vinda de duas leituras não dobra).
 */
export function somarFinanceiro(itens: { id?: string; estado: EstadoFinanceiro; valor: number }[]): SomaFinanceira {
  const vistos = new Set<string>()
  const v: Record<EstadoFinanceiro, number> = { ESTIMADA: 0, NAO_LIQUIDADA: 0, LIQUIDADA: 0, RECEBIDA: 0, REVERTIDA: 0, CANCELADA: 0 }
  const q: Record<EstadoFinanceiro, number> = { ESTIMADA: 0, NAO_LIQUIDADA: 0, LIQUIDADA: 0, RECEBIDA: 0, REVERTIDA: 0, CANCELADA: 0 }
  for (const i of itens) {
    if (i.id) { if (vistos.has(i.id)) continue; vistos.add(i.id) }
    // P2.50 (Codex 19): soma em centavos inteiros; reais só na saída.
    v[i.estado] += centavos(i.valor)
    q[i.estado] += 1
  }
  const r = (c: number) => c / 100
  return {
    estimada: r(v.ESTIMADA), naoLiquidada: r(v.NAO_LIQUIDADA), liquidada: r(v.LIQUIDADA), recebida: r(v.RECEBIDA),
    revertida: r(v.REVERTIDA), cancelada: r(v.CANCELADA),
    confirmada: r(v.LIQUIDADA + v.RECEBIDA), previsao: r(v.ESTIMADA + v.NAO_LIQUIDADA), quantidade: q,
  }
}

/** Soma direto de linhas de Commission (com a venda junto quando houver). */
export function somarComissoes(cs: (ComissaoParaClassificar & { id?: string; sale?: { status: string } | null; pedidoEstado?: string | null })[]): SomaFinanceira {
  return somarFinanceiro(cs.map((c) => ({ id: c.id, ...estadoDaComissao(c, c.sale?.status ?? null, c.pedidoEstado ?? null) })))
}

/** Valor que conta como RECEITA confirmada desta comissão (0 se previsão, revertida ou cancelada). */
export function valorConfirmado(c: ComissaoParaClassificar, vendaStatus?: string | null): number {
  const e = estadoDaComissao(c, vendaStatus)
  return CONFIRMADOS.includes(e.estado) ? e.valor : 0
}

/** Retrato da comissão para o histórico (antes/depois). */
export function retratoDaComissao(c: ComissaoParaClassificar) {
  return { status: c.status, expectedAmount: c.expectedAmount, confirmedAmount: c.confirmedAmount, receivedAmount: c.receivedAmount }
}

// ── Cadeia de atribuição (banco) ────────────────────────────────────────────────────────────────────

/**
 * VINCULADO_POR_* = ligação por identificador confiável; NAO_VINCULADO = havia identificador mas sem
 * correspondência única; SEM_IDENTIFICADOR = a fonte não trouxe o id. Nunca por nome aproximado.
 */
export type Vinculo = string

export interface ElosDaCadeia {
  comissaoId: string
  vendaId: string | null
  origem: 'CREATOR_CENTER' | 'MANUAL' | 'OUTRA'
  estado: EstadoFinanceiro
  valor: number
  /** Valor ponderado que alimenta o aprendizado (confirmado 1×, previsão 0,5×, revertida/cancelada 0). */
  valorParaAprender: number
  canal: string | null
  produto: { produtoId: string | null; candidatoId: string | null; produtoIdExterno: string | null; vinculo: Vinculo }
  conteudo: { conteudoId: string | null; videoResultadoId: string | null; postId: string | null; vinculo: Vinculo }
  publicacao: { publicacaoAssistidaId: string | null; vinculo: Vinculo }
  pedido: { pedidoId: string | null; skuId: string | null; importacaoId: string | null; vinculo: Vinculo }
}

export async function cadeiaFinanceira(workspaceId: string, filtro?: { produtoId?: string; videoResultadoId?: string; publicacaoAssistidaId?: string }): Promise<{ elos: ElosDaCadeia[]; soma: SomaFinanceira }> {
  const { prisma } = await import('./prisma')
  const comissoes = await prisma.commission.findMany({
    where: { workspaceId },
    select: {
      id: true, status: true, expectedAmount: true, confirmedAmount: true, receivedAmount: true, productId: true, saleId: true,
      affiliateProgram: { select: { platform: true } },
      sale: { select: { id: true, status: true, source: true, contentId: true, productId: true, linkId: true, link: { select: { publicacaoId: true } } } },
    },
  })
  const saleIds = comissoes.map((c) => c.saleId).filter((x): x is string => !!x)
  const pedidos = saleIds.length
    ? await prisma.pedidoAfiliadoTikTok.findMany({ where: { workspaceId, saleId: { in: saleIds } }, select: { saleId: true, pedidoId: true, skuId: true, estado: true, produtoIdExterno: true, produtoId: true, candidatoId: true, videoResultadoId: true, conteudoIdExterno: true, vinculoProduto: true, vinculoVideo: true, ultimaImportacaoId: true } })
    : []
  const pedidoDaVenda = new Map(pedidos.map((p) => [p.saleId!, p]))
  const videoIds = [...new Set(pedidos.map((p) => p.videoResultadoId).filter((x): x is string => !!x))]
  const videos = videoIds.length ? await prisma.videoTikTokResultado.findMany({ where: { workspaceId, id: { in: videoIds } }, select: { id: true, postId: true, publicacaoAssistidaId: true, canal: true } }) : []
  const videoPorId = new Map(videos.map((v) => [v.id, v]))

  const elos: ElosDaCadeia[] = comissoes.map((c) => {
    const ped = c.saleId ? pedidoDaVenda.get(c.saleId) ?? null : null
    const { estado, valor } = estadoDaComissao(c, c.sale?.status ?? null, ped?.estado ?? null)
    const video = ped?.videoResultadoId ? videoPorId.get(ped.videoResultadoId) ?? null : null
    const produtoId = c.productId ?? c.sale?.productId ?? ped?.produtoId ?? null
    const origem: ElosDaCadeia['origem'] = c.sale?.source === 'creator_center_csv' ? 'CREATOR_CENTER' : c.sale?.source === 'manual' ? 'MANUAL' : 'OUTRA'
    return {
      comissaoId: c.id, vendaId: c.saleId, origem, estado, valor,
      valorParaAprender: arred(valor * PESO_NO_APRENDIZADO[estado]),
      canal: c.affiliateProgram?.platform ?? (origem === 'CREATOR_CENTER' ? 'tiktok-shop' : video?.canal ?? null),
      produto: {
        produtoId, candidatoId: ped?.candidatoId ?? null, produtoIdExterno: ped?.produtoIdExterno ?? null,
        vinculo: ped ? ped.vinculoProduto : produtoId ? 'VINCULADO_NO_REGISTRO' : 'NAO_VINCULADO',
      },
      conteudo: {
        conteudoId: c.sale?.contentId ?? null, videoResultadoId: ped?.videoResultadoId ?? null, postId: ped?.conteudoIdExterno ?? video?.postId ?? null,
        vinculo: ped ? ped.vinculoVideo : c.sale?.contentId ? 'VINCULADO_NO_REGISTRO' : 'NAO_VINCULADO',
      },
      publicacao: {
        publicacaoAssistidaId: video?.publicacaoAssistidaId ?? null,
        vinculo: video?.publicacaoAssistidaId ? 'VINCULADO_POR_POST_ID' : c.sale?.link?.publicacaoId ? 'VINCULADO_POR_LINK' : 'NAO_VINCULADO',
      },
      pedido: { pedidoId: ped?.pedidoId ?? null, skuId: ped?.skuId ?? null, importacaoId: ped?.ultimaImportacaoId ?? null, vinculo: ped ? 'VINCULADO_POR_ORDER_ID' : origem === 'MANUAL' ? 'REGISTRO_MANUAL' : 'NAO_VINCULADO' },
    }
  })
  const filtrados = elos.filter((e) =>
    (!filtro?.produtoId || e.produto.produtoId === filtro.produtoId || e.produto.candidatoId === filtro.produtoId) &&
    (!filtro?.videoResultadoId || e.conteudo.videoResultadoId === filtro.videoResultadoId) &&
    (!filtro?.publicacaoAssistidaId || e.publicacao.publicacaoAssistidaId === filtro.publicacaoAssistidaId))
  return { elos: filtrados, soma: somarFinanceiro(filtrados.map((e) => ({ id: e.comissaoId, estado: e.estado, valor: e.valor }))) }
}

/** Soma canônica do workspace (todas as telas usam esta). */
export async function resumoFinanceiro(workspaceId: string, filtro?: { desde?: Date; ate?: Date; affiliateProgramId?: string; productId?: string; periodoDaVenda?: { desde: Date; ate: Date }; somenteOrigens?: readonly string[] }): Promise<SomaFinanceira> {
  const { prisma } = await import('./prisma')
  const cs = await prisma.commission.findMany({
    where: {
      workspaceId,
      ...(filtro?.affiliateProgramId ? { affiliateProgramId: filtro.affiliateProgramId } : {}),
      ...(filtro?.productId ? { productId: filtro.productId } : {}),
      // P2.52: só vendas destas origens (teste, demo, seed e sem origem ficam fora).
      ...(filtro?.somenteOrigens ? { sale: { dataOrigin: { in: [...filtro.somenteOrigens] } } } : {}),
      ...(filtro?.desde || filtro?.ate ? { createdAt: { ...(filtro.desde ? { gte: filtro.desde } : {}), ...(filtro.ate ? { lte: filtro.ate } : {}) } } : {}),
      // Período pela DATA DO PEDIDO/VENDA (não pela data da importação); sem venda, pela criação.
      ...(filtro?.periodoDaVenda ? { OR: [{ sale: { date: { gte: filtro.periodoDaVenda.desde, lte: filtro.periodoDaVenda.ate } } }, { saleId: null, createdAt: { gte: filtro.periodoDaVenda.desde, lte: filtro.periodoDaVenda.ate } }] } : {}),
    },
    select: { id: true, status: true, expectedAmount: true, confirmedAmount: true, receivedAmount: true, saleId: true, sale: { select: { status: true } } },
  })
  const saleIds = cs.map((c) => c.saleId).filter((x): x is string => !!x)
  const pedidos = saleIds.length ? await prisma.pedidoAfiliadoTikTok.findMany({ where: { workspaceId, saleId: { in: saleIds } }, select: { saleId: true, estado: true } }) : []
  const estadoPorVenda = new Map(pedidos.map((p) => [p.saleId!, p.estado]))
  return somarComissoes(cs.map((c) => ({ ...c, pedidoEstado: c.saleId ? estadoPorVenda.get(c.saleId) ?? null : null })))
}

// ── P2.50 (Codex 20): resultado após custos ──────────────────────────────

export interface ResultadoAposCustos {
  /** Comissão confirmada (liquidada + recebida). Estornos já estão FORA dela. */
  receitaConfirmada: number
  /** Comissões revertidas (estornos) — informativo: nunca entram na receita, então não são subtraídas de novo. */
  estornos: number
  /** Custo real conhecido (fatura/registro confirmado). */
  custosReais: number
  /** Teto reservado antes de chamadas pagas ainda sem custo real — conservador, conta como custo. */
  custosReservados: number
  custos: number
  /** receitaConfirmada − custos. `null` quando os custos não puderam ser apurados com segurança. */
  resultado: number | null
  /** Previsão (estimada + não liquidada) — mostrada à parte, nunca no resultado. */
  previsao: number
  limitacoes: string[]
  /**
   * P2.53 (Lucro Real): o resultado separado por tipo de operação. Afiliados = comissão (sem estoque nem
   * custo de mercadoria). Vendas próprias = fase futura: sem dado, fica SEM_OPERACAO (nunca R$ 0).
   */
  porOperacao: {
    afiliados: { receitaConfirmada: number; previsao: number; estornos: number }
    vendasProprias: { situacao: 'SEM_OPERACAO'; motivo: string }
  }
}

/** P2.52: origens que contam como resultado da titular (painel e Lucro Real). Treino do ML continua só REAL_OPERATION. */
export const ORIGENS_DE_RESULTADO = ['REAL_OPERATION', 'USER_REPORTED'] as const

export const MOTIVO_SEM_VENDAS_PROPRIAS = 'Vendas próprias ainda não existem no Patrono (estoque e notas fiscais são a próxima fase): nada é somado aqui.'

/** FUNÇÃO PURA. `custos` null = não apurável (fail-closed: sem resultado, nunca "custo zero"). */
export function calcularResultadoAposCustos(
  soma: SomaFinanceira,
  custos: { reaisBRL: number; reservadosBRL: number } | null
): ResultadoAposCustos {
  const limitacoes = ['Custos não são vinculados a produto ou campanha: o resultado é do período, sem rateio por produto.']
  if (!custos) limitacoes.unshift('Não foi possível apurar os custos com segurança: resultado não calculado.')
  const custosReais = custos ? arred(num(custos.reaisBRL)) : 0
  const custosReservados = custos ? arred(num(custos.reservadosBRL)) : 0
  const total = arred(custosReais + custosReservados)
  return {
    receitaConfirmada: soma.confirmada,
    estornos: soma.revertida,
    custosReais,
    custosReservados,
    custos: total,
    resultado: custos ? arred(soma.confirmada - total) : null,
    previsao: soma.previsao,
    limitacoes,
    porOperacao: {
      afiliados: { receitaConfirmada: soma.confirmada, previsao: soma.previsao, estornos: soma.revertida },
      vendasProprias: { situacao: 'SEM_OPERACAO', motivo: MOTIVO_SEM_VENDAS_PROPRIAS },
    },
  }
}

/**
 * Resultado do workspace no período: comissão confirmada − custos (reais + reservas de chamadas pagas).
 * Custos: `CostLedger` (CONFIRMADO pelo real; RESERVADO pelo estimado) + reservas autorizadas do gate de custo.
 */
export async function resultadoAposCustos(workspaceId: string, periodo?: { desde?: Date; ate?: Date }): Promise<ResultadoAposCustos> {
  const { prisma } = await import('./prisma')
  const { ACAO_AUDIT_AUTORIZADO } = await import('./cost-safety-gate')
  const { somarReservas } = await import('./cost-safety-reserva')
  const quando = periodo?.desde || periodo?.ate ? { ...(periodo.desde ? { gte: periodo.desde } : {}), ...(periodo.ate ? { lte: periodo.ate } : {}) } : undefined
  // P2.52: mesma regra de origem do Painel de Afiliados — dado de teste, demonstração ou carga inicial nunca vira lucro.
  const somenteOrigens = ORIGENS_DE_RESULTADO
  const soma = await resumoFinanceiro(workspaceId, periodo?.desde || periodo?.ate ? { periodoDaVenda: { desde: periodo.desde ?? new Date(0), ate: periodo.ate ?? new Date() }, somenteOrigens } : { somenteOrigens })
  let custos: { reaisBRL: number; reservadosBRL: number } | null
  try {
    const [ledger, reservasDoGate] = await Promise.all([
      prisma.costLedger.findMany({ where: { workspaceId, status: { in: ['RESERVADO', 'CONFIRMADO'] }, ...(quando ? { criadoEm: quando } : {}) }, select: { status: true, estimadoCentavos: true, realCentavos: true } }),
      prisma.auditLog.findMany({ where: { workspaceId, action: ACAO_AUDIT_AUTORIZADO, ...(quando ? { createdAt: quando } : {}) }, select: { id: true, metadata: true } }),
    ])
    const reais = ledger.filter((l) => l.status === 'CONFIRMADO').reduce((s, l) => s + (l.realCentavos ?? l.estimadoCentavos), 0) / 100
    const reservadosLedger = ledger.filter((l) => l.status === 'RESERVADO').reduce((s, l) => s + l.estimadoCentavos, 0) / 100
    custos = { reaisBRL: reais, reservadosBRL: reservadosLedger + somarReservas(reservasDoGate) }
  } catch (e) {
    console.error('[financeiro] custos não apurados — resultado não calculado:', e instanceof Error ? e.message : e)
    custos = null
  }
  return calcularResultadoAposCustos(soma, custos)
}
