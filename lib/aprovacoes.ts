/**
 * P2.14.7 (Fase 0A) — Approval Engine: o único lugar de intervenção humana.
 *
 * Fluxo: o Patrono prepara tudo e pede UMA decisão (Aprovar/Rejeitar).
 * Antes de pedir, consulta as REGRAS da titular (classe de ação, período ou
 * permanente). Se uma regra decide, o pedido já nasce resolvido — a
 * titular não é incomodada de novo pelo mesmo tipo de coisa.
 *
 * Garantias:
 *   - idempotente por (workspaceId, chave): pedir duas vezes = um pedido;
 *   - decisão atômica: clique duplo aprova uma vez só (o 2º recebe 409);
 *   - pedido vencido não pode ser aprovado;
 *   - toda decisão vai para o livro de decisões e de eventos, na mesma
 *     transação.
 */
import { Prisma, type ApprovalRequest, type ApprovalRule } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { redigir } from './cofre'
import { contextoAtual } from './observabilidade'
import { prisma } from './prisma'
import { registrarDecisao, registrarEvento } from './ledger'

/** P2.23: tipo do pedido "escolher produto" — fonte única (supervisor, jornada e produto-canonico usavam cópias). */
export const TIPO_ESCOLHA_DE_PRODUTO = 'ESCOLHER_PRODUTO'

/**
 * P2.23 — porta única do CANCELAMENTO AUTOMÁTICO de pedidos pendentes (substituído, decidido em outro lugar,
 * candidato que saiu, regra oficial). Sempre com motivo e data da decisão; só toca PENDENTE do workspace.
 */
export function cancelarPedidosPendentes(
  p: { workspaceId: string; filtro: Prisma.ApprovalRequestWhereInput; motivo: string; agora?: Date },
  cliente: { approvalRequest: Prisma.TransactionClient['approvalRequest'] } = prisma
) {
  return cliente.approvalRequest.updateMany({
    where: { ...p.filtro, workspaceId: p.workspaceId, status: 'PENDENTE' },
    data: { status: 'CANCELADA', motivoDaDecisao: p.motivo, decididoEm: p.agora ?? new Date() },
  })
}

export class ErroDeAprovacao extends Error {
  constructor(public readonly status: 404 | 409, mensagem: string) {
    super(mensagem)
  }
}

export type Risco = 'BAIXO' | 'MEDIO' | 'ALTO'
const ORDEM: Record<Risco, number> = { BAIXO: 0, MEDIO: 1, ALTO: 2 }

/** Fatos da ação, usados para casar regras. */
export interface FatosDaAcao {
  risco: Risco
  categoria?: string | null
  canal?: string | null
  preco?: number | null
}

/** Condição de uma regra. Todos os campos presentes precisam casar. */
export interface CondicaoDaRegra {
  categoriaIn?: string[]
  canalIn?: string[]
  precoMax?: number
  riscoMax?: Risco
}

/** FUNÇÃO PURA: a regra vale para estes fatos? Desconhecido nunca casa com limite. */
export function regraCasa(condicao: CondicaoDaRegra, fatos: FatosDaAcao): boolean {
  if (condicao.categoriaIn && (!fatos.categoria || !condicao.categoriaIn.includes(fatos.categoria))) return false
  if (condicao.canalIn && (!fatos.canal || !condicao.canalIn.includes(fatos.canal))) return false
  if (typeof condicao.precoMax === 'number' && (typeof fatos.preco !== 'number' || fatos.preco > condicao.precoMax)) return false
  if (condicao.riscoMax && ORDEM[fatos.risco] > ORDEM[condicao.riscoMax]) return false
  return true
}

/** FUNÇÃO PURA: primeira regra ativa e vigente que casa. REJEITAR tem precedência. */
export function regraAplicavel(regras: Pick<ApprovalRule, 'id' | 'tipo' | 'condicao' | 'efeito' | 'ativa' | 'validaAte' | 'revogadaEm'>[], tipo: string, fatos: FatosDaAcao, agora: Date) {
  const vigentes = regras.filter(
    (r) => r.ativa && !r.revogadaEm && r.tipo === tipo && (!r.validaAte || r.validaAte.getTime() > agora.getTime()) && regraCasa((r.condicao ?? {}) as CondicaoDaRegra, fatos)
  )
  return vigentes.find((r) => r.efeito === 'REJEITAR') ?? vigentes.find((r) => r.efeito === 'APROVAR') ?? null
}

export interface NovoPedido {
  workspaceId: string
  tipo: string
  chave: string
  titulo: string
  resumo: string
  porque: string[]
  fatos: FatosDaAcao
  acaoProposta: Record<string, unknown>
  entidadeTipo?: string | null
  entidadeId?: string | null
  expiraEm?: Date | null
  agora?: Date
}

/** Pede aprovação (ou resolve por regra). Idempotente pela chave. */
export async function solicitarAprovacao(p: NovoPedido): Promise<ApprovalRequest> {
  const agora = p.agora ?? new Date()
  // P2.15.6: o pedido que já existe (caso comum a cada ciclo) sai com UMA ida,
  // sem abrir transação; pedido novo lê as regras junto. A criação continua
  // atômica (pedido + evento [+ decisão]) e a corrida entre dois ciclos cai
  // na chave única — quem perde devolve o pedido do vencedor.
  const [existente, regras] = await Promise.all([
    prisma.approvalRequest.findUnique({ where: { workspaceId_chave: { workspaceId: p.workspaceId, chave: p.chave } } }),
    prisma.approvalRule.findMany({ where: { workspaceId: p.workspaceId, tipo: p.tipo, ativa: true } }),
  ])
  if (existente) return existente
  try {
    return await criarPedido(p, regras, agora)
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') {
      const vencedor = await prisma.approvalRequest.findUnique({ where: { workspaceId_chave: { workspaceId: p.workspaceId, chave: p.chave } } })
      if (vencedor) return vencedor
    }
    throw e
  }
}

async function criarPedido(p: NovoPedido, regras: ApprovalRule[], agora: Date): Promise<ApprovalRequest> {
  // P2.15.6: sem regra aplicável (o caso comum), pedido + evento saem num
  // ÚNICO comando SQL — atômico e uma ida ao banco, em vez de BEGIN + create
  // + evento + COMMIT. Com regra, segue a transação (grava também a decisão).
  if (!regraAplicavel(regras, p.tipo, p.fatos, agora)) {
    const ctx = contextoAtual()
    const id = randomUUID()
    const linhas = await prisma.$queryRaw<ApprovalRequest[]>(Prisma.sql`
      WITH pedido AS (
        INSERT INTO "ApprovalRequest" ("id", "workspaceId", "tipo", "chave", "titulo", "resumo", "porque", "risco", "acaoProposta", "entidadeTipo", "entidadeId", "expiraEm", "status", "criadoEm", "atualizadoEm")
        VALUES (${id}, ${p.workspaceId}, ${p.tipo}, ${p.chave}, ${p.titulo}, ${p.resumo}, ${p.porque}::text[], ${p.fatos.risco}, ${JSON.stringify(p.acaoProposta)}::jsonb,
                ${p.entidadeTipo ?? null}, ${p.entidadeId ?? null}, ${p.expiraEm ?? null}::timestamp(3), 'PENDENTE'::"StatusDaAprovacao", ${agora}::timestamp(3), now())
        ON CONFLICT ("workspaceId", "chave") DO NOTHING
        RETURNING *
      ),
      evento AS (
        INSERT INTO "DomainEvent" ("id", "workspaceId", "tipo", "versao", "correlationId", "runId", "entidadeTipo", "entidadeId", "payload", "chaveIdempotencia")
        SELECT ${randomUUID()}, ${p.workspaceId}, 'APPROVAL_REQUIRED', 1, ${ctx?.correlationId ?? null}, ${ctx?.runId ?? null}, 'ApprovalRequest', pedido."id",
               ${JSON.stringify(redigir({ tipo: p.tipo, risco: p.fatos.risco, porRegra: null }))}::jsonb, ${`aprovacao:${p.chave}:pedido`}
        FROM pedido
        ON CONFLICT ("workspaceId", "chaveIdempotencia") DO NOTHING
        RETURNING 1
      )
      SELECT * FROM pedido
    `)
    if (linhas[0]) return linhas[0]
    // Outro ciclo criou o mesmo pedido no meio do caminho: devolve o dele.
    const vencedor = await prisma.approvalRequest.findUnique({ where: { workspaceId_chave: { workspaceId: p.workspaceId, chave: p.chave } } })
    if (vencedor) return vencedor
    throw new Error('Pedido de aprovação não foi criado nem encontrado.')
  }
  return prisma.$transaction(async (tx) => {
    const regra = regraAplicavel(regras, p.tipo, p.fatos, agora)
    const resolvido = regra
      ? { status: (regra.efeito === 'REJEITAR' ? 'REJEITADA' : 'APROVADA') as 'APROVADA' | 'REJEITADA', decididoEm: agora, decididoPorRegraId: regra.id, motivoDaDecisao: `Resolvido pela regra ${regra.id}.` }
      : {}

    const pedido = await tx.approvalRequest.create({
      data: {
        workspaceId: p.workspaceId,
        tipo: p.tipo,
        chave: p.chave,
        titulo: p.titulo,
        resumo: p.resumo,
        porque: p.porque,
        risco: p.fatos.risco,
        acaoProposta: p.acaoProposta as Prisma.InputJsonValue,
        entidadeTipo: p.entidadeTipo ?? null,
        entidadeId: p.entidadeId ?? null,
        expiraEm: p.expiraEm ?? null,
        ...resolvido,
      },
    })
    await registrarEvento(
      {
        workspaceId: p.workspaceId,
        tipo: regra ? (regra.efeito === 'REJEITAR' ? 'APPROVAL_REJECTED' : 'APPROVAL_GRANTED') : 'APPROVAL_REQUIRED',
        chaveIdempotencia: `aprovacao:${p.chave}:${regra ? 'regra' : 'pedido'}`,
        entidadeTipo: 'ApprovalRequest',
        entidadeId: pedido.id,
        payload: { tipo: p.tipo, risco: p.fatos.risco, porRegra: regra?.id ?? null },
      },
      tx
    )
    if (regra) {
      await registrarDecisao(
        { workspaceId: p.workspaceId, tipo: 'APROVACAO', ator: 'SISTEMA', decisao: `${pedido.status} por regra da titular.`, entidadeTipo: 'ApprovalRequest', entidadeId: pedido.id, regra: `ApprovalRule:${regra.id}`, chaveIdempotencia: `aprovacao:${p.chave}` },
        tx
      )
    }
    return pedido
  })
}

/** A titular decide. Atômico: só um clique passa. */
export async function decidirAprovacao(p: { workspaceId: string; id: string; decisao: 'APROVAR' | 'REJEITAR'; userId: string; motivo?: string | null; agora?: Date }) {
  const agora = p.agora ?? new Date()
  const pedido = await prisma.approvalRequest.findFirst({ where: { id: p.id, workspaceId: p.workspaceId } })
  if (!pedido) throw new ErroDeAprovacao(404, 'Pedido de aprovação não encontrado.')
  if (pedido.status !== 'PENDENTE') throw new ErroDeAprovacao(409, `Pedido já está ${pedido.status}.`)
  if (pedido.expiraEm && pedido.expiraEm.getTime() <= agora.getTime()) throw new ErroDeAprovacao(409, 'Pedido vencido: o Patrono vai preparar um novo.')

  const status: 'APROVADA' | 'REJEITADA' = p.decisao === 'APROVAR' ? 'APROVADA' : 'REJEITADA'
  return prisma.$transaction(async (tx) => {
    const r = await tx.approvalRequest.updateMany({
      where: { id: p.id, workspaceId: p.workspaceId, status: 'PENDENTE', OR: [{ expiraEm: null }, { expiraEm: { gt: agora } }] },
      data: { status, decididoEm: agora, decididoPorUserId: p.userId, motivoDaDecisao: p.motivo ?? null },
    })
    if (r.count !== 1) throw new ErroDeAprovacao(409, 'Este pedido acabou de ser decidido.')
    await registrarDecisao(
      { workspaceId: p.workspaceId, tipo: 'APROVACAO', ator: 'TITULAR', atorUserId: p.userId, decisao: `${status}.`, explicacao: p.motivo ? [p.motivo] : [], entradas: { pedidoTipo: pedido.tipo, titulo: pedido.titulo }, entidadeTipo: 'ApprovalRequest', entidadeId: p.id, chaveIdempotencia: `aprovacao:${pedido.chave}` },
      tx
    )
    await registrarEvento(
      { workspaceId: p.workspaceId, tipo: status === 'APROVADA' ? 'APPROVAL_GRANTED' : 'APPROVAL_REJECTED', chaveIdempotencia: `aprovacao:${pedido.chave}:decisao`, entidadeTipo: 'ApprovalRequest', entidadeId: p.id, payload: { motivo: p.motivo ?? null } },
      tx
    )
    return { status }
  })
}

/** "Precisa de você": só o que é pendente e vigente. */
export async function pendentes(workspaceId: string, agora = new Date()) {
  return prisma.approvalRequest.findMany({
    where: { workspaceId, status: 'PENDENTE', OR: [{ expiraEm: null }, { expiraEm: { gt: agora } }] },
    orderBy: { criadoEm: 'asc' },
  })
}

/** Marca como EXPIRADA o que venceu (rotina de manutenção). */
export async function expirarVencidas(workspaceId: string, agora = new Date()) {
  const r = await prisma.approvalRequest.updateMany({
    where: { workspaceId, status: 'PENDENTE', expiraEm: { lte: agora } },
    data: { status: 'EXPIRADA' },
  })
  return r.count
}

/** Regra de classe/período/permanente ("aprovar Casa ≤ R$ 300 risco baixo"). */
export async function criarRegra(p: { workspaceId: string; tipo: string; condicao: CondicaoDaRegra; efeito: 'APROVAR' | 'REJEITAR'; validaAte?: Date | null; userId: string; motivo?: string | null }) {
  return prisma.$transaction(async (tx) => {
    const regra = await tx.approvalRule.create({
      data: { workspaceId: p.workspaceId, tipo: p.tipo, condicao: p.condicao as Prisma.InputJsonValue, efeito: p.efeito, validaAte: p.validaAte ?? null, criadoPorUserId: p.userId, motivo: p.motivo ?? null },
    })
    await registrarDecisao(
      { workspaceId: p.workspaceId, tipo: 'REGRA_DE_APROVACAO', ator: 'TITULAR', atorUserId: p.userId, decisao: `Regra ${p.efeito} para ${p.tipo} criada.`, entradas: { condicao: p.condicao, validaAte: p.validaAte ?? null }, entidadeTipo: 'ApprovalRule', entidadeId: regra.id, chaveIdempotencia: `regra:${regra.id}` },
      tx
    )
    return regra
  })
}

export async function revogarRegra(p: { workspaceId: string; id: string; userId: string; agora?: Date }) {
  const r = await prisma.approvalRule.updateMany({ where: { id: p.id, workspaceId: p.workspaceId, ativa: true }, data: { ativa: false, revogadaEm: p.agora ?? new Date() } })
  if (r.count !== 1) throw new ErroDeAprovacao(404, 'Regra não encontrada ou já revogada.')
  return { revogada: true }
}
