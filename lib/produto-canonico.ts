/**
 * P2.18.11 — FONTE ÚNICA DE VERDADE DO PRODUTO.
 *
 * Identidade: `CandidatoDeProduto` é a identidade OPERACIONAL (jornada,
 * publicação, amostra, mídia e resultado apontam para `candidatoId`);
 * `Produto` é o cadastro/catálogo, ligado por `produtoId` (ou, sem ele, por
 * `providerId + externalId`). Nunca por nome.
 *
 * Estado canônico (sem enum novo):
 *   Produto.status: 'ativo' | 'inativo' (sumiu da origem, o SYNC decide) | 'descartado' (EXCLUÍDO pela titular)
 *   Candidato.status: … | 'DESCARTADO'
 * Excluir = Produto 'descartado' + candidatos dele 'DESCARTADO' + publicações
 * em andamento encerradas + amostras abertas canceladas + pedidos cancelados,
 * numa transação, com evento PRODUCT_ARCHIVED guardando o estado anterior
 * (é dele que RESTAURAR lê). Nada é apagado: o histórico (publicadas,
 * resultados, vendas, eventos) continua consultável.
 *
 * Toda tela que mostra "produto ativo" usa ESTAS definições.
 */
import { TIPO_ESCOLHA_DE_PRODUTO, cancelarPedidosPendentes } from './aprovacoes'
import type { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { registrarEvento } from './ledger'

/** Produto ativo no cadastro: só 'ativo' entra em ranking, contagem e coleta. */
export const PRODUTO_ATIVO = { status: 'ativo' } as const satisfies Prisma.ProdutoWhereInput
/** Produto visível na lista de Produtos (o 'inativo' aparece com o rótulo; o excluído não). */
export const PRODUTO_NAO_EXCLUIDO = { status: { not: 'descartado' } } as const satisfies Prisma.ProdutoWhereInput
/** Candidato que pode aparecer em qualquer área ATIVA: não descartado e sem cadastro excluído. */
/** Candidato cujo CADASTRO (quando há) não foi excluído — sem olhar o status do candidato (a jornada usa este). */
export const CADASTRO_NAO_EXCLUIDO: Prisma.CandidatoDeProdutoWhereInput = { OR: [{ produtoId: null }, { produto: PRODUTO_NAO_EXCLUIDO }] }
export const CANDIDATO_NAO_EXCLUIDO: Prisma.CandidatoDeProdutoWhereInput = {
  status: { not: 'DESCARTADO' },
  ...CADASTRO_NAO_EXCLUIDO,
}

/**
 * P2.29.1 — REGRA CANÔNICA DO PRODUTO DESCARTADO OU EXCLUÍDO.
 *
 * Descartar ou excluir = decisão expressa da titular de não continuar com aquele produto. Então:
 *   - o que tem CERTEZA de não ter saído para o TikTok (geração, mídia, aprovação, aprovado sem envio, falha sem
 *     envio, ajuste) é ENCERRADO sozinho (REJEITADO + motivo + estado anterior no histórico);
 *   - o que PODE já estar publicado (PUBLICANDO, ENVIO INCERTO, post id gravado, Publicacao que chegou a ser
 *     distribuída) NUNCA é encerrado: vai para "Precisa de você" com ORIENTACAO_PODE_TER_SAIDO;
 *   - PUBLICADO, resultados, vendas, pedidos, comissões, histórico e aprendizado não são tocados.
 * Uma função só (encerrarProdutoDescartado), usada por: excluir produto/candidato, NÃO QUERO (descartarCandidato),
 * coleta/curadoria e as duas reconciliações. Toda escrita é condicionada ao estado lido (duas ações ao mesmo tempo
 * não encerram duas vezes nem duplicam histórico).
 */
const SEM_ENVIO = ['GERANDO', 'PRONTO', 'AGUARDANDO_MIDIA', 'VIDEO_NA_FILA', 'GERANDO_VIDEO', 'AGUARDANDO_APROVACAO', 'APROVADO', 'AJUSTE_PEDIDO', 'FALHOU']
const PODE_TER_SAIDO = ['PUBLICANDO', 'FALHOU']
export const ORIENTACAO_PODE_TER_SAIDO = 'Confirme se este conteúdo apareceu no TikTok antes de encerrar ou tentar novamente.'
const AMOSTRA_FECHADA = ['CANCELADA', 'CONCLUIDA', 'REJEITADA']
const TIPO_DA_ESCOLHA = TIPO_ESCOLHA_DE_PRODUTO
/** Marca da publicação encerrada porque o PRODUTO saiu (não é rejeição da titular: não pesa no aprendizado nem trava a volta). */
export const ENCERRADA_POR_PRODUTO_INATIVO = 'PRODUTO_INATIVO'
export const encerradaPorProdutoInativo = (a: { estado: string; bloqueio: string | null }) => a.estado === 'REJEITADO' && !!a.bloqueio?.startsWith(ENCERRADA_POR_PRODUTO_INATIVO)

type Tx = Prisma.TransactionClient
type Leitor = Pick<Tx, 'publicacaoAssistida' | 'publicacao'>

export interface EfeitoDaExclusao {
  produtos: number
  candidatos: number
  publicacoesEncerradas: number
  /** Ficaram de pé porque podem já estar no TikTok: aparecem em "Precisa de você". */
  publicacoesParaConferir: number
  amostrasCanceladas: number
  pedidosCancelados: number
}

/** Pode já existir publicação externa? (na dúvida, sim: nunca se encerra o que talvez esteja no ar). */
export function podeTerSaido(a: { estado: string; erro: string | null; postId: string | null }, distribuida: boolean): boolean {
  return a.estado === 'PUBLICANDO' || !!a.postId || (a.erro ?? '').startsWith('ENVIO INCERTO') || distribuida
}

/** Publicações pendentes destes candidatos/produtos, separadas em "encerrável com certeza" e "pode ter saído". */
async function separarPendentes(db: Leitor, workspaceId: string, doProduto: Prisma.PublicacaoAssistidaWhereInput) {
  const pendentes = await db.publicacaoAssistida.findMany({
    where: { workspaceId, demonstracao: false, estado: { in: [...new Set([...SEM_ENVIO, ...PODE_TER_SAIDO])] }, ...doProduto },
    select: { id: true, historico: true, estado: true, erro: true, postId: true, publicacaoId: true, nomeProduto: true, updatedAt: true },
  })
  // Publicacao que chegou ao provedor (DISTRIBUINDO/DISTRIBUIDA) = pode ter saído, qualquer que seja o estado da assistida.
  const enviadas = pendentes.length
    ? await db.publicacao.findMany({
        where: { workspaceId, estado: { in: ['DISTRIBUINDO', 'DISTRIBUIDA'] }, OR: [{ id: { in: pendentes.map((a) => a.publicacaoId).filter((x): x is string => !!x) } }, ...pendentes.map((a) => ({ chaveDaTentativa: { startsWith: `assistida:${a.id}:` } }))] },
        select: { id: true, chaveDaTentativa: true },
      })
    : []
  const distribuida = (a: (typeof pendentes)[number]) => enviadas.some((p) => p.id === a.publicacaoId || (p.chaveDaTentativa ?? '').startsWith(`assistida:${a.id}:`))
  return {
    encerraveis: pendentes.filter((a) => !podeTerSaido(a, distribuida(a))),
    paraConferir: pendentes.filter((a) => podeTerSaido(a, distribuida(a))),
  }
}

/** A função canônica: encerra o que é certo, deixa para a titular o que pode ter saído. Histórico fica; nada é apagado. */
export async function encerrarProdutoDescartado(tx: Tx, workspaceId: string, candidatoIds: string[], produtoIds: string[], motivo: string, agora: Date) {
  if (!candidatoIds.length && !produtoIds.length) return { publicacoesEncerradas: 0, publicacoesParaConferir: 0, amostrasCanceladas: 0, pedidosCancelados: 0 }
  const doProduto = { OR: [{ candidatoId: { in: candidatoIds } }, { produtoId: { in: produtoIds } }] }
  const { encerraveis, paraConferir } = await separarPendentes(tx, workspaceId, doProduto)
  let publicacoesEncerradas = 0
  for (const a of encerraveis) {
    const historico = [...((a.historico as unknown[] | null) ?? []), { em: agora.toISOString(), acao: 'ENCERRADA_PRODUTO_INATIVO', detalhe: motivo, estadoAnterior: a.estado }]
    const r = await tx.publicacaoAssistida.updateMany({ where: { id: a.id, workspaceId, estado: a.estado, updatedAt: a.updatedAt }, data: { estado: 'REJEITADO', bloqueio: `${ENCERRADA_POR_PRODUTO_INATIVO}: ${motivo}`, historico: historico as Prisma.InputJsonValue } })
    publicacoesEncerradas += r.count
  }
  const amostras = await tx.amostraTikTokShop.findMany({ where: { workspaceId, estado: { notIn: AMOSTRA_FECHADA }, ...doProduto }, select: { id: true, historico: true, estado: true } })
  let amostrasCanceladas = 0
  for (const a of amostras) {
    const historico = [...((a.historico as unknown[] | null) ?? []), { em: agora.toISOString(), acao: 'CANCELADA_NO_PATRONO', estado: 'CANCELADA', detalhe: `${motivo} (só no Patrono: nada foi pedido ao vendedor)`, estadoAnterior: a.estado }]
    const r = await tx.amostraTikTokShop.updateMany({ where: { id: a.id, workspaceId, estado: a.estado }, data: { estado: 'CANCELADA', historico: historico as Prisma.InputJsonValue } })
    amostrasCanceladas += r.count
  }
  const pedidos = await tx.approvalRequest.findMany({ where: { workspaceId, status: 'PENDENTE', tipo: TIPO_DA_ESCOLHA }, select: { id: true, acaoProposta: true } })
  const doCandidato = pedidos.filter((r) => candidatoIds.includes((r.acaoProposta as { candidatoId?: string } | null)?.candidatoId ?? '')).map((r) => r.id)
  const cancelados = doCandidato.length ? await cancelarPedidosPendentes({ workspaceId, filtro: { id: { in: doCandidato } }, motivo, agora }, tx) : { count: 0 }
  return { publicacoesEncerradas, publicacoesParaConferir: paraConferir.length, amostrasCanceladas, pedidosCancelados: cancelados.count }
}

/**
 * NÃO QUERO de um produto que já tinha sido escolhido (ESCOLHIDO/CADASTRADO, por isso não vira DESCARTADO pela
 * curadoria): a mesma regra canônica para o que estava em andamento dele.
 */
export async function encerrarPorRecusaDaTitular(p: { workspaceId: string; candidatoId: string; agora?: Date }) {
  return prisma.$transaction((tx) => encerrarProdutoDescartado(tx, p.workspaceId, [p.candidatoId], [], 'A titular não quis este produto.', p.agora ?? new Date()))
}

/** Publicações de produto inativo (descartado/excluído) que PODEM ter saído: a central e a reconciliação leem daqui. */
export async function publicacoesParaConferirDeProdutoInativo(workspaceId: string) {
  const [excluidos, descartados] = await Promise.all([
    prisma.produto.findMany({ where: { workspaceId, status: 'descartado' }, select: { id: true } }),
    prisma.candidatoDeProduto.findMany({ where: { workspaceId, OR: [{ status: 'DESCARTADO' }, { produto: { status: 'descartado' } }] }, select: { id: true } }),
  ])
  if (!excluidos.length && !descartados.length) return []
  const { paraConferir } = await separarPendentes(prisma, workspaceId, { OR: [{ candidatoId: { in: descartados.map((c) => c.id) } }, { produtoId: { in: excluidos.map((p) => p.id) } }] })
  return paraConferir.map((a) => ({ id: a.id, nomeProduto: a.nomeProduto, estado: a.estado }))
}

/** Candidatos do produto: pelo vínculo (produtoId) ou pela identidade externa. Nunca por nome. */
async function candidatosDoProduto(tx: Tx, workspaceId: string, p: { id: string; providerId: string | null; externalId: string | null }) {
  return tx.candidatoDeProduto.findMany({
    where: {
      workspaceId,
      OR: [{ produtoId: p.id }, ...(p.providerId && p.externalId ? [{ providerId: p.providerId, externalId: p.externalId }] : [])],
    },
    select: { id: true, status: true },
  })
}

/**
 * EXCLUIR produto (cadastro): propaga para todas as áreas ativas numa
 * transação. Idempotente (excluir de novo não muda nada).
 */
export async function excluirProduto(p: { workspaceId: string; userId: string | null; produtoId: string; motivo?: string; agora?: Date }): Promise<EfeitoDaExclusao | null> {
  const agora = p.agora ?? new Date()
  const motivo = p.motivo ?? 'Produto excluído pela titular.'
  const r = await prisma.$transaction(async (tx) => {
    const prod = await tx.produto.findFirst({ where: { id: p.produtoId, workspaceId: p.workspaceId }, select: { id: true, status: true, providerId: true, externalId: true } })
    if (!prod) return null
    const candidatos = await candidatosDoProduto(tx, p.workspaceId, prod)
    const ativos = candidatos.filter((c) => c.status !== 'DESCARTADO')
    if (prod.status !== 'descartado') await tx.produto.update({ where: { id: prod.id }, data: { status: 'descartado' } })
    if (ativos.length) await tx.candidatoDeProduto.updateMany({ where: { id: { in: ativos.map((c) => c.id) } }, data: { status: 'DESCARTADO', posicao: null } })
    const derivados = await encerrarProdutoDescartado(tx, p.workspaceId, candidatos.map((c) => c.id), [prod.id], motivo, agora)
    const mudou = prod.status !== 'descartado' || ativos.length > 0 || derivados.publicacoesEncerradas + derivados.amostrasCanceladas + derivados.pedidosCancelados > 0
    if (mudou) {
      await registrarEvento({
        workspaceId: p.workspaceId, tipo: 'PRODUCT_ARCHIVED', chaveIdempotencia: `produto:${prod.id}:excluido:${agora.toISOString()}`, entidadeTipo: 'Produto', entidadeId: prod.id,
        payload: { motivo, userId: p.userId, statusAnterior: prod.status, candidatosAnteriores: ativos, ...derivados },
      }, tx)
    }
    return { produtos: prod.status !== 'descartado' ? 1 : 0, candidatos: ativos.length, ...derivados }
  })
  return r
}

/**
 * EXCLUIR a partir de Oportunidades (candidato): o mesmo efeito. Se houver
 * cadastro ligado, ele também sai (uma identidade, um estado).
 */
export async function excluirCandidato(p: { workspaceId: string; userId: string | null; candidatoId: string; motivo?: string; agora?: Date }): Promise<EfeitoDaExclusao | null> {
  const agora = p.agora ?? new Date()
  const c = await prisma.candidatoDeProduto.findFirst({ where: { id: p.candidatoId, workspaceId: p.workspaceId }, select: { id: true, status: true, produtoId: true } })
  if (!c) return null
  if (c.produtoId) return excluirProduto({ workspaceId: p.workspaceId, userId: p.userId, produtoId: c.produtoId, motivo: p.motivo, agora })
  const motivo = p.motivo ?? 'Produto excluído pela titular.'
  return prisma.$transaction(async (tx) => {
    if (c.status !== 'DESCARTADO') await tx.candidatoDeProduto.update({ where: { id: c.id }, data: { status: 'DESCARTADO', posicao: null } })
    const derivados = await encerrarProdutoDescartado(tx, p.workspaceId, [c.id], [], motivo, agora)
    if (c.status !== 'DESCARTADO' || derivados.publicacoesEncerradas + derivados.amostrasCanceladas + derivados.pedidosCancelados > 0) {
      await registrarEvento({
        workspaceId: p.workspaceId, tipo: 'PRODUCT_ARCHIVED', chaveIdempotencia: `candidato:${c.id}:excluido:${agora.toISOString()}`, entidadeTipo: 'CandidatoDeProduto', entidadeId: c.id,
        payload: { motivo, userId: p.userId, candidatosAnteriores: c.status !== 'DESCARTADO' ? [{ id: c.id, status: c.status }] : [], ...derivados },
      }, tx)
    }
    return { produtos: 0, candidatos: c.status !== 'DESCARTADO' ? 1 : 0, ...derivados }
  })
}

/**
 * RESTAURAR: volta a ser elegível. Os candidatos voltam ao status de antes
 * da exclusão (lido do evento); sem registro, voltam a NOVO. Publicações
 * encerradas NÃO renascem: a jornada prepara conteúdo novo.
 */
export async function restaurarProduto(p: { workspaceId: string; userId: string | null; produtoId: string; agora?: Date }) {
  const agora = p.agora ?? new Date()
  return prisma.$transaction(async (tx) => {
    const prod = await tx.produto.findFirst({ where: { id: p.produtoId, workspaceId: p.workspaceId }, select: { id: true, status: true, providerId: true, externalId: true } })
    if (!prod) return null
    const ultimo = await tx.domainEvent.findFirst({ where: { workspaceId: p.workspaceId, tipo: 'PRODUCT_ARCHIVED', entidadeTipo: 'Produto', entidadeId: prod.id }, orderBy: { ocorridoEm: 'desc' } })
    const anteriores = ((ultimo?.payload as { candidatosAnteriores?: { id: string; status: string }[] } | null)?.candidatosAnteriores ?? [])
    const candidatos = await candidatosDoProduto(tx, p.workspaceId, prod)
    let restaurados = 0
    for (const c of candidatos.filter((x) => x.status === 'DESCARTADO')) {
      const antes = anteriores.find((a) => a.id === c.id)?.status
      if (!antes && anteriores.length) continue // descartado antes desta exclusão (decisão própria): fica como estava
      await tx.candidatoDeProduto.update({ where: { id: c.id }, data: { status: (antes ?? 'NOVO') as never } })
      restaurados++
    }
    const statusAnterior = (ultimo?.payload as { statusAnterior?: string } | null)?.statusAnterior
    if (prod.status === 'descartado') await tx.produto.update({ where: { id: prod.id }, data: { status: statusAnterior && statusAnterior !== 'descartado' ? statusAnterior : 'ativo' } })
    await registrarEvento({ workspaceId: p.workspaceId, tipo: 'PRODUCT_RESTORED', chaveIdempotencia: `produto:${prod.id}:restaurado:${agora.toISOString()}`, entidadeTipo: 'Produto', entidadeId: prod.id, payload: { userId: p.userId, candidatosRestaurados: restaurados } }, tx)
    return { produto: prod.id, candidatosRestaurados: restaurados }
  })
}

// ── Reconciliação: corrige SÓ estado derivado; nunca apaga histórico ─────

export interface RelatorioDeReconciliacao {
  candidatosDeProdutoExcluido: number
  publicacoesDeProdutoInativo: number
  amostrasDeProdutoInativo: number
  pedidosDeProdutoInativo: number
  jornadasOrfas: number
  contagens: { produtosAtivos: number; produtosInativos: number; produtosExcluidos: number; candidatosAtivos: number }
  aplicado: boolean
}

/**
 * Detecta (e, com `aplicar`, corrige) o que divergiu da fonte canônica:
 * candidato vivo de cadastro excluído, publicação/amostra/pedido em andamento
 * de produto inativo, jornada apontando para candidato inexistente.
 */
export async function reconciliarEstadoDoWorkspace(workspaceId: string, opcoes: { aplicar?: boolean; agora?: Date } = {}): Promise<RelatorioDeReconciliacao> {
  const agora = opcoes.agora ?? new Date()
  const excluidos = await prisma.produto.findMany({ where: { workspaceId, status: 'descartado' }, select: { id: true, providerId: true, externalId: true } })
  const chavesExternas = excluidos.filter((p) => p.providerId && p.externalId).map((p) => ({ providerId: p.providerId!, externalId: p.externalId! }))
  const vivosDeExcluido = excluidos.length
    ? await prisma.candidatoDeProduto.findMany({
        where: { workspaceId, status: { not: 'DESCARTADO' }, OR: [{ produtoId: { in: excluidos.map((p) => p.id) } }, ...chavesExternas.map((k) => ({ providerId: k.providerId, externalId: k.externalId }))] },
        select: { id: true, status: true, produtoId: true },
      })
    : []
  const inativos = await prisma.candidatoDeProduto.findMany({ where: { workspaceId, status: 'DESCARTADO' }, select: { id: true } })
  const idsInativos = [...new Set([...inativos.map((c) => c.id), ...vivosDeExcluido.map((c) => c.id)])]
  const doInativo = { OR: [{ candidatoId: { in: idsInativos } }, { produtoId: { in: excluidos.map((p) => p.id) } }] }
  const [publicacoes, amostras, pedidos, eventosDeJornada, todosOsIds] = await Promise.all([
    // só o que a regra canônica encerra (o que pode ter saído fica para a titular e não conta aqui)
    separarPendentes(prisma, workspaceId, doInativo).then((x) => x.encerraveis.length),
    prisma.amostraTikTokShop.count({ where: { workspaceId, estado: { notIn: AMOSTRA_FECHADA }, ...doInativo } }),
    prisma.approvalRequest.findMany({ where: { workspaceId, status: 'PENDENTE', tipo: TIPO_DA_ESCOLHA }, select: { acaoProposta: true } }),
    prisma.domainEvent.findMany({ where: { workspaceId, entidadeTipo: 'JornadaOperacional' }, distinct: ['entidadeId'], select: { entidadeId: true } }),
    prisma.candidatoDeProduto.findMany({ where: { workspaceId }, select: { id: true } }),
  ])
  const existentes = new Set(todosOsIds.map((c) => c.id))
  const pedidosDeInativo = pedidos.filter((r) => idsInativos.includes((r.acaoProposta as { candidatoId?: string } | null)?.candidatoId ?? '')).length
  const jornadasOrfas = eventosDeJornada.filter((e) => e.entidadeId && !existentes.has(e.entidadeId)).length

  if (opcoes.aplicar && (vivosDeExcluido.length || publicacoes || amostras || pedidosDeInativo)) {
    await prisma.$transaction(async (tx) => {
      if (vivosDeExcluido.length) await tx.candidatoDeProduto.updateMany({ where: { id: { in: vivosDeExcluido.map((c) => c.id) } }, data: { status: 'DESCARTADO', posicao: null } })
      const d = await encerrarProdutoDescartado(tx, workspaceId, idsInativos, excluidos.map((p) => p.id), 'Reconciliação: o produto não está ativo na fonte central.', agora)
      await registrarEvento({
        workspaceId, tipo: 'STATE_RECONCILED', chaveIdempotencia: `reconciliacao:${agora.toISOString()}`, entidadeTipo: 'Workspace', entidadeId: workspaceId,
        payload: { candidatosAnteriores: vivosDeExcluido.map((c) => ({ id: c.id, status: c.status, produtoId: c.produtoId })), ...d },
      }, tx)
    })
  }
  const [produtosAtivos, produtosInativos, produtosExcluidos, candidatosAtivos] = await Promise.all([
    prisma.produto.count({ where: { workspaceId, ...PRODUTO_ATIVO } }),
    prisma.produto.count({ where: { workspaceId, status: 'inativo' } }),
    prisma.produto.count({ where: { workspaceId, status: 'descartado' } }),
    prisma.candidatoDeProduto.count({ where: { workspaceId, AND: [CANDIDATO_NAO_EXCLUIDO] } }),
  ])
  return {
    candidatosDeProdutoExcluido: vivosDeExcluido.length,
    publicacoesDeProdutoInativo: publicacoes,
    amostrasDeProdutoInativo: amostras,
    pedidosDeProdutoInativo: pedidosDeInativo,
    jornadasOrfas,
    contagens: { produtosAtivos, produtosInativos, produtosExcluidos, candidatosAtivos },
    aplicado: !!opcoes.aplicar,
  }
}

// ── RECOMEÇAR OPERAÇÃO ──────────────────────────────────────────────────

export interface ResultadoDoRecomeco extends EfeitoDaExclusao { chave: string }

/**
 * Deixa a operação VISÍVEL zerada para recomeçar, sem "apagar o banco":
 * arquiva todos os produtos e candidatos, encerra publicações em andamento,
 * cancela amostras abertas (só no Patrono) e pedidos de escolha. NÃO toca em
 * usuários, integrações, configurações, flags, metas/campanhas, histórico
 * publicado, resultados, vendas, comissões nem aprendizado. Tudo fica no
 * evento OPERATION_RESET (com o estado anterior de cada item).
 */
export async function recomecarOperacao(p: { workspaceId: string; userId: string | null; agora?: Date }): Promise<ResultadoDoRecomeco> {
  const agora = p.agora ?? new Date()
  const motivo = 'Recomeço da operação pedido pela titular.'
  const chave = `recomeco:${agora.toISOString()}`
  return prisma.$transaction(async (tx) => {
    const produtos = await tx.produto.findMany({ where: { workspaceId: p.workspaceId, status: { not: 'descartado' } }, select: { id: true, status: true } })
    const candidatos = await tx.candidatoDeProduto.findMany({ where: { workspaceId: p.workspaceId, status: { not: 'DESCARTADO' } }, select: { id: true, status: true, produtoId: true } })
    if (produtos.length) await tx.produto.updateMany({ where: { id: { in: produtos.map((x) => x.id) } }, data: { status: 'descartado' } })
    if (candidatos.length) await tx.candidatoDeProduto.updateMany({ where: { id: { in: candidatos.map((x) => x.id) } }, data: { status: 'DESCARTADO', posicao: null } })
    const todosCandidatos = await tx.candidatoDeProduto.findMany({ where: { workspaceId: p.workspaceId }, select: { id: true } })
    const todosProdutos = await tx.produto.findMany({ where: { workspaceId: p.workspaceId }, select: { id: true } })
    const derivados = await encerrarProdutoDescartado(tx, p.workspaceId, todosCandidatos.map((c) => c.id), todosProdutos.map((x) => x.id), motivo, agora)
    // Pedidos pendentes de escolha que sobraram (sem candidato ligado) também saem.
    const sobra = await cancelarPedidosPendentes({ workspaceId: p.workspaceId, filtro: { tipo: TIPO_DA_ESCOLHA }, motivo, agora }, tx)
    // Um evento de exclusão por produto: RESTAURAR um produto depois do recomeço funciona igual.
    for (const prod of produtos) {
      await registrarEvento({
        workspaceId: p.workspaceId, tipo: 'PRODUCT_ARCHIVED', chaveIdempotencia: `produto:${prod.id}:excluido:${agora.toISOString()}`, entidadeTipo: 'Produto', entidadeId: prod.id,
        payload: { motivo, userId: p.userId, statusAnterior: prod.status, candidatosAnteriores: candidatos.filter((c) => c.produtoId === prod.id).map((c) => ({ id: c.id, status: c.status })), recomeco: chave },
      }, tx)
    }
    const efeito = { produtos: produtos.length, candidatos: candidatos.length, ...derivados, pedidosCancelados: derivados.pedidosCancelados + sobra.count }
    await registrarEvento({
      workspaceId: p.workspaceId, tipo: 'OPERATION_RESET', chaveIdempotencia: chave, entidadeTipo: 'Workspace', entidadeId: p.workspaceId,
      payload: { userId: p.userId, ...efeito, candidatosAnteriores: candidatos.map((c) => ({ id: c.id, status: c.status, produtoId: c.produtoId })) },
    }, tx)
    return { chave, ...efeito }
  }, { timeout: 60_000 })
}
