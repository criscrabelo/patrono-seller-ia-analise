/**
 * P2.22 — PROCESSADOR GENÉRICO DE EVENTOS: EVENTO → PROCESSADOR → RELER ESTADO → DECIDIR → ATUALIZAR DERIVADOS
 * → CRIAR PRÓXIMA AÇÃO. As reações ficam em `reacoes-a-eventos.ts` (internas; nunca publicam, pedem amostra,
 * mandam mensagem ou gastam).
 *
 * Garantias:
 *   - IDEMPOTENTE: cada reação relê o estado atual e só faz o que falta; o evento só vira PROCESSADO uma vez.
 *   - CONCORRÊNCIA: a reivindicação é `FOR UPDATE SKIP LOCKED` + token: duas instâncias nunca pegam o mesmo evento.
 *   - RETOMÁVEL: lease (`processandoAte`); se a instância cair no meio, o lease expira e outro retoma.
 *   - RETRY limitado: espera 2^tentativa minutos (máx. 60); depois de MAX_TENTATIVAS → FALHOU (dead letter),
 *     com erro, tentativas, última tentativa e contexto; retry manual pela área administrativa.
 *   - Um evento com erro não trava os outros (cada um tem o próprio desfecho).
 *   - ANTI-LOOP: evento gerado dentro de uma reação carrega a linhagem (`causadoPorEventoId`, `profundidade`);
 *     mesmo tipo + mesma entidade da causa, ou profundidade > PROFUNDIDADE_MAXIMA → IGNORADO_LOOP (registrado).
 *   - CORTE: ao ativar num workspace, os eventos anteriores ficam IGNORADO_ANTES_DO_CORTE, com contagem por
 *     tipo, data e motivo gravados em ExecucaoDoProcessador (tipo CORTE) — sem avalanche e sem silêncio.
 */
import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { comContexto, log } from './observabilidade'
import { registrarAuditoria } from './audit-log'

export const MAX_TENTATIVAS = 5
export const LEASE_MS = 2 * 60_000
export const PROFUNDIDADE_MAXIMA = 3
export const MOTIVO_DO_CORTE = 'Evento anterior à ativação do processador: já foi tratado pelo fluxo da época (reações inline). Não é reprocessado para não disparar uma avalanche de reações velhas.'

export interface EventoParaReagir {
  id: string
  workspaceId: string
  tipo: string
  entidadeTipo: string | null
  entidadeId: string | null
  payload: Record<string, unknown>
  ocorridoEm: Date
  tentativas: number
  agora: Date
}
export type Reacao = (e: EventoParaReagir) => Promise<Record<string, unknown>>
export type Reacoes = Record<string, Reacao>

const backoffMs = (tentativa: number) => Math.min(60, 2 ** tentativa) * 60_000

/** Ativa o processador no workspace (idempotente). Marca os eventos anteriores, de forma auditável. */
export async function ativarProcessador(p: { workspaceId: string; tipos: string[]; userId?: string | null; agora?: Date }) {
  const agora = p.agora ?? new Date()
  const existente = await prisma.execucaoDoProcessador.findFirst({ where: { workspaceId: p.workspaceId, tipo: 'CORTE' } })
  if (existente) return { corte: existente, novo: false }
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`processador-corte:${p.workspaceId}`}))::text AS ok`
    const ja = await tx.execucaoDoProcessador.findFirst({ where: { workspaceId: p.workspaceId, tipo: 'CORTE' } })
    if (ja) return { corte: ja, novo: false }
    const antigos = await tx.domainEvent.groupBy({ by: ['tipo'], where: { workspaceId: p.workspaceId, tipo: { in: p.tipos }, estadoProcessamento: null, ocorridoEm: { lt: agora } }, _count: { _all: true } })
    const total = antigos.reduce((s, x) => s + x._count._all, 0)
    await tx.domainEvent.updateMany({ where: { workspaceId: p.workspaceId, tipo: { in: p.tipos }, estadoProcessamento: null, ocorridoEm: { lt: agora } }, data: { estadoProcessamento: 'IGNORADO_ANTES_DO_CORTE', erroProcessamento: MOTIVO_DO_CORTE } })
    const corte = await tx.execucaoDoProcessador.create({
      data: { workspaceId: p.workspaceId, tipo: 'CORTE', worker: p.userId ? `titular:${p.userId}` : 'sistema', iniciadoEm: agora, terminadoEm: agora, ignorados: total,
        detalhe: { dataDoCorte: agora.toISOString(), motivo: MOTIVO_DO_CORTE, porTipo: Object.fromEntries(antigos.map((x) => [x.tipo, x._count._all])), tiposComReacao: p.tipos } },
    })
    return { corte, novo: true }
  }).then(async (r) => {
    if (r.novo) await registrarAuditoria({ workspaceId: p.workspaceId, userId: p.userId ?? null, action: 'processador.ativado', entityType: 'ExecucaoDoProcessador', entityId: r.corte.id, metadata: { ignorados: r.corte.ignorados, dataDoCorte: agora.toISOString() } })
    return r
  })
}

/** Reivindica um lote (atômico entre instâncias). Só workspaces ativados e tipos com reação. */
async function reivindicar(p: { tipos: string[]; limite: number; agora: Date; token: string; workspaceId?: string }) {
  const ate = new Date(p.agora.getTime() + LEASE_MS)
  return prisma.$queryRaw<{ id: string }[]>`
    UPDATE "DomainEvent" d SET "estadoProcessamento" = 'PROCESSANDO', "processandoPor" = ${p.token}, "processandoAte" = ${ate},
      "tentativas" = d."tentativas" + 1, "ultimaTentativaEm" = ${p.agora}
    WHERE d."id" IN (
      SELECT e."id" FROM "DomainEvent" e
      JOIN "ExecucaoDoProcessador" c ON c."workspaceId" = e."workspaceId" AND c."tipo" = 'CORTE'
      WHERE e."tipo" = ANY(${p.tipos}::text[])
        AND (${p.workspaceId ?? null}::text IS NULL OR e."workspaceId" = ${p.workspaceId ?? null})
        AND (e."estadoProcessamento" IS NULL
          OR (e."estadoProcessamento" = 'RETRY' AND e."proximaTentativaEm" <= ${p.agora})
          OR (e."estadoProcessamento" = 'PROCESSANDO' AND e."processandoAte" < ${p.agora}))
      ORDER BY e."ocorridoEm" ASC, e."id" ASC
      LIMIT ${p.limite}
      FOR UPDATE OF e SKIP LOCKED)
    RETURNING d."id"`
}

export interface ResumoDaExecucao { processados: number; falhas: number; retries: number; ignorados: number; eventos: { id: string; tipo: string; desfecho: string }[] }

/**
 * Processa um lote. `reacoes` = registro tipo → reação (o padrão vem de `reacoes-a-eventos.ts`).
 * `interromperDepoisDe` (só testes): simula a queda da instância depois de N eventos reivindicados.
 */
export async function processarEventos(p: { reacoes: Reacoes; workspaceId?: string; limite?: number; agora?: Date; worker?: string; interromperDepoisDe?: number }): Promise<ResumoDaExecucao> {
  const agora = p.agora ?? new Date()
  const token = `${p.worker ?? 'processador'}:${randomUUID()}`
  const tipos = Object.keys(p.reacoes)
  const ids = (await reivindicar({ tipos, limite: p.limite ?? 25, agora, token, workspaceId: p.workspaceId })).map((x) => x.id)
  const resumo: ResumoDaExecucao = { processados: 0, falhas: 0, retries: 0, ignorados: 0, eventos: [] }
  if (!ids.length) return resumo
  const eventos = await prisma.domainEvent.findMany({ where: { id: { in: ids } }, orderBy: [{ ocorridoEm: 'asc' }, { id: 'asc' }] })
  const causas = new Map((await prisma.domainEvent.findMany({ where: { id: { in: eventos.map((e) => e.causadoPorEventoId).filter((x): x is string => !!x) } }, select: { id: true, tipo: true, entidadeId: true } })).map((c) => [c.id, c]))
  const porWorkspace = new Map<string, ResumoDaExecucao>()
  let feitos = 0
  for (const e of eventos) {
    if (p.interromperDepoisDe != null && feitos >= p.interromperDepoisDe) break // "queda": os demais ficam PROCESSANDO até o lease expirar
    feitos++
    const r = porWorkspace.get(e.workspaceId) ?? { processados: 0, falhas: 0, retries: 0, ignorados: 0, eventos: [] }
    porWorkspace.set(e.workspaceId, r)
    const fim = (data: Prisma.DomainEventUpdateManyMutationInput) =>
      prisma.domainEvent.updateMany({ where: { id: e.id, processandoPor: token }, data: { processandoPor: null, processandoAte: null, ...data } })
    // P2.28: renova o lease do que ainda é DESTE lote (reação lenta não deixa o fim do lote expirar e ser
    // reivindicado por outra execução — que reagiria de novo).
    await prisma.domainEvent.updateMany({ where: { id: { in: ids }, processandoPor: token, estadoProcessamento: 'PROCESSANDO' }, data: { processandoAte: new Date(Date.now() + LEASE_MS) } })
    // P2.28: evento que DERRUBA o processo nunca chegava ao catch; a cada retomada a tentativa sobe no claim.
    // Passou do limite: dead letter, sem rodar de novo.
    if (e.tentativas > MAX_TENTATIVAS) {
      await fim({ estadoProcessamento: 'FALHOU', erroProcessamento: `Interrompido ${e.tentativas - 1} vez(es) sem concluir (a execução caiu durante a reação). Não será repetido sozinho.`, proximaTentativaEm: null })
      log('warn', 'processador.evento_interrompido_demais', { evento: e.id, tipo: e.tipo, tentativas: e.tentativas })
      r.falhas++; r.eventos.push({ id: e.id, tipo: e.tipo, desfecho: 'FALHOU' })
      continue
    }
    const causa = e.causadoPorEventoId ? causas.get(e.causadoPorEventoId) : null
    if (e.profundidade > PROFUNDIDADE_MAXIMA || (causa && causa.tipo === e.tipo && causa.entidadeId === e.entidadeId)) {
      const motivo = causa && causa.tipo === e.tipo ? `Gerado pela reação a um ${causa.tipo} da mesma entidade: reagir de novo criaria um ciclo.` : `Cadeia de reações com profundidade ${e.profundidade} (> ${PROFUNDIDADE_MAXIMA}).`
      await fim({ estadoProcessamento: 'IGNORADO_LOOP', processadoEm: agora, erroProcessamento: motivo, resultadoProcessamento: { ignorado: 'LOOP', causadoPor: e.causadoPorEventoId } })
      r.ignorados++; r.eventos.push({ id: e.id, tipo: e.tipo, desfecho: 'IGNORADO_LOOP' })
      continue
    }
    try {
      const reacao = p.reacoes[e.tipo]
      const resultado = await comContexto({ correlationId: `evento:${e.id}`, workspaceId: e.workspaceId, ator: 'PATRONO', eventoDeOrigem: { id: e.id, tipo: e.tipo, entidadeId: e.entidadeId, profundidade: e.profundidade } }, () =>
        reacao({ id: e.id, workspaceId: e.workspaceId, tipo: e.tipo, entidadeTipo: e.entidadeTipo, entidadeId: e.entidadeId, payload: (e.payload ?? {}) as Record<string, unknown>, ocorridoEm: e.ocorridoEm, tentativas: e.tentativas, agora }))
      await fim({ estadoProcessamento: 'PROCESSADO', processadoEm: agora, erroProcessamento: null, proximaTentativaEm: null, resultadoProcessamento: resultado as Prisma.InputJsonValue })
      r.processados++; r.eventos.push({ id: e.id, tipo: e.tipo, desfecho: 'PROCESSADO' })
    } catch (erro) {
      const msg = (erro instanceof Error ? erro.message : String(erro)).slice(0, 1000)
      const esgotou = e.tentativas >= MAX_TENTATIVAS
      await fim(esgotou
        ? { estadoProcessamento: 'FALHOU', erroProcessamento: msg, proximaTentativaEm: null }
        : { estadoProcessamento: 'RETRY', erroProcessamento: msg, proximaTentativaEm: new Date(agora.getTime() + backoffMs(e.tentativas)) })
      log('warn', 'processador.evento_falhou', { evento: e.id, tipo: e.tipo, tentativas: e.tentativas, esgotou, erro: msg })
      if (esgotou) { r.falhas++; r.eventos.push({ id: e.id, tipo: e.tipo, desfecho: 'FALHOU' }) } else { r.retries++; r.eventos.push({ id: e.id, tipo: e.tipo, desfecho: 'RETRY' }) }
    }
  }
  for (const [ws, r] of porWorkspace) {
    await prisma.execucaoDoProcessador.create({ data: { workspaceId: ws, tipo: 'EXECUCAO', worker: token, iniciadoEm: agora, terminadoEm: new Date(), processados: r.processados, falhas: r.falhas, retries: r.retries, ignorados: r.ignorados, detalhe: { eventos: r.eventos } } })
    resumo.processados += r.processados; resumo.falhas += r.falhas; resumo.retries += r.retries; resumo.ignorados += r.ignorados; resumo.eventos.push(...r.eventos)
  }
  return resumo
}

/** Retry manual de um evento FALHOU (zera as tentativas; fica registrado). */
export async function reprocessarEvento(p: { workspaceId: string; eventoId: string; userId: string | null; agora?: Date }) {
  const agora = p.agora ?? new Date()
  const n = await prisma.domainEvent.updateMany({ where: { id: p.eventoId, workspaceId: p.workspaceId, estadoProcessamento: 'FALHOU' }, data: { estadoProcessamento: 'RETRY', proximaTentativaEm: agora, tentativas: 0 } })
  if (n.count !== 1) return false
  await prisma.execucaoDoProcessador.create({ data: { workspaceId: p.workspaceId, tipo: 'RETRY_MANUAL', worker: p.userId ? `titular:${p.userId}` : 'sistema', iniciadoEm: agora, terminadoEm: agora, retries: 1, detalhe: { eventoId: p.eventoId } } })
  await registrarAuditoria({ workspaceId: p.workspaceId, userId: p.userId, action: 'processador.retry_manual', entityType: 'DomainEvent', entityId: p.eventoId })
  return true
}

/** Observabilidade: pendentes, processados, falhos, em retry, última execução, motivos de erro e o corte. */
export async function painelDoProcessador(workspaceId: string, tipos: string[], agora = new Date()) {
  const corte = await prisma.execucaoDoProcessador.findFirst({ where: { workspaceId, tipo: 'CORTE' } })
  const [porEstado, pendentes, ultimas, problemas] = await Promise.all([
    prisma.domainEvent.groupBy({ by: ['estadoProcessamento'], where: { workspaceId, tipo: { in: tipos }, estadoProcessamento: { not: null } }, _count: { _all: true } }),
    corte ? prisma.domainEvent.count({ where: { workspaceId, tipo: { in: tipos }, estadoProcessamento: null, ocorridoEm: { gte: corte.iniciadoEm } } }) : Promise.resolve(0),
    prisma.execucaoDoProcessador.findMany({ where: { workspaceId, tipo: { in: ['EXECUCAO', 'RETRY_MANUAL'] } }, orderBy: { iniciadoEm: 'desc' }, take: 5 }),
    prisma.domainEvent.findMany({ where: { workspaceId, tipo: { in: tipos }, estadoProcessamento: { in: ['FALHOU', 'RETRY', 'IGNORADO_LOOP', 'PROCESSANDO'] } }, orderBy: { ocorridoEm: 'desc' }, take: 30, select: { id: true, tipo: true, entidadeTipo: true, entidadeId: true, estadoProcessamento: true, tentativas: true, ultimaTentativaEm: true, proximaTentativaEm: true, erroProcessamento: true, ocorridoEm: true, processandoAte: true } }),
  ])
  const n = (e: string) => porEstado.find((x) => x.estadoProcessamento === e)?._count._all ?? 0
  return {
    ativo: !!corte,
    corte: corte ? { em: corte.iniciadoEm.toISOString(), ignorados: corte.ignorados, detalhe: corte.detalhe } : null,
    contagem: { pendentes, processando: n('PROCESSANDO'), processados: n('PROCESSADO'), emRetry: n('RETRY'), falhos: n('FALHOU'), ignoradosLoop: n('IGNORADO_LOOP'), ignoradosAntesDoCorte: n('IGNORADO_ANTES_DO_CORTE') },
    ultimaExecucao: ultimas[0] ? { em: ultimas[0].iniciadoEm.toISOString(), tipo: ultimas[0].tipo, processados: ultimas[0].processados, falhas: ultimas[0].falhas, retries: ultimas[0].retries, ignorados: ultimas[0].ignorados } : null,
    execucoes: ultimas.map((x) => ({ em: x.iniciadoEm.toISOString(), tipo: x.tipo, processados: x.processados, falhas: x.falhas, retries: x.retries, ignorados: x.ignorados })),
    problemas: problemas.map((x) => ({ ...x, travado: x.estadoProcessamento === 'PROCESSANDO' && !!x.processandoAte && x.processandoAte < agora })),
  }
}
