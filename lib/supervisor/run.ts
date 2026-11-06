/**
 * P2.14.7 (Fase 0A) — Runs do Supervisor: criação idempotente e transição
 * atômica de estado.
 *
 * - `iniciarRun` com a mesma chave devolve o mesmo run (nada roda duas vezes).
 * - `transitar` usa compare-and-set (`updateMany where estado = de`): duas
 *   instâncias concorrentes não avançam o mesmo run; a perdedora recebe
 *   ErroDeTransicao e não executa a etapa.
 * - Cada transição grava RUN_STATE_CHANGED na mesma transação.
 * - Entrar em estado irreversível passa pelas travas (kill switch/Safe Mode).
 */
import { Prisma, type EstadoDoRun, type SupervisorRun } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { redigir } from '../cofre'
import { prisma } from '../prisma'
import { novoCorrelationId } from '../observabilidade'
import { exigirPodeAgir } from '../kill-switch'
import { ESTADOS_IRREVERSIVEIS, podeTransitar, retomadaValida } from './estados'

export class ErroDeTransicao extends Error {
  constructor(mensagem: string) {
    super(mensagem)
  }
}

export type ModoDoRun = 'MANUAL' | 'ASSISTED' | 'AUTOMATIC' | 'SIMULACAO'

/**
 * Idempotente pela chave. P2.15.8: o `upsert` do Prisma virava uma transação
 * (BEGIN, SELECT, INSERT, COMMIT: ~1 s a partir da Netlify). Agora o caso
 * comum é UM `INSERT`; só quando a chave já existe é que se lê o run.
 */
export async function iniciarRun(p: { workspaceId: string; chave: string; modo: ModoDoRun }): Promise<SupervisorRun> {
  try {
    return await prisma.supervisorRun.create({
      data: { workspaceId: p.workspaceId, chave: p.chave, modo: p.modo, correlationId: novoCorrelationId('run') },
    })
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e
    return prisma.supervisorRun.findUniqueOrThrow({ where: { workspaceId_chave: { workspaceId: p.workspaceId, chave: p.chave } } })
  }
}

function checkpointComo(obj: Prisma.JsonValue | null): Record<string, unknown> {
  return obj && typeof obj === 'object' && !Array.isArray(obj) ? (obj as Record<string, unknown>) : {}
}

/** Estado do run que o chamador já conhece (evita reler o banco antes de cada passo). */
export type RunConhecido = Pick<SupervisorRun, 'id' | 'estado' | 'passo' | 'checkpoint' | 'modo' | 'correlationId'>

/**
 * Transição atômica — P2.15.6: UMA ida ao banco.
 *
 * Antes: findFirst + BEGIN + updateMany + upsert do evento + findUniqueOrThrow
 * + COMMIT (~6 idas, ~2,25 s em Production). Agora um único comando SQL
 * (CTE): compare-and-set em `estado` E `passo` + o mesmo RUN_STATE_CHANGED
 * (mesma chave de idempotência, mesmo payload), atômico por ser um comando
 * só. Quem já conhece o run (o ciclo) passa `atual` e pula a releitura.
 * `para` pode ser uma SEQUÊNCIA de estados (ex.: VALIDANDO→RANQUEANDO→
 * DECIDINDO sem trabalho entre eles): um evento por passo, uma ida só.
 */
export async function transitar(p: {
  workspaceId: string
  runId: string
  de: EstadoDoRun
  para: EstadoDoRun | EstadoDoRun[]
  checkpoint?: Record<string, unknown>
  erro?: string | null
  env?: Record<string, string | undefined>
  atual?: RunConhecido
}): Promise<SupervisorRun> {
  const run = p.atual ?? (await prisma.supervisorRun.findFirst({ where: { id: p.runId, workspaceId: p.workspaceId } }))
  if (!run) throw new ErroDeTransicao('Run não encontrado.')
  if (run.estado !== p.de) throw new ErroDeTransicao(`Run está em ${run.estado}, não em ${p.de}.`)
  const destinos = Array.isArray(p.para) ? p.para : [p.para]
  if (!destinos.length) throw new ErroDeTransicao('Transição sem destino.')
  const cadeia: EstadoDoRun[] = [p.de, ...destinos]
  for (let i = 0; i < destinos.length; i++) {
    if (!podeTransitar(cadeia[i], cadeia[i + 1])) throw new ErroDeTransicao(`Transição proibida: ${cadeia[i]} → ${cadeia[i + 1]}.`)
  }
  const final = destinos[destinos.length - 1]

  const anterior = checkpointComo(run.checkpoint)
  if (p.de === 'PAUSADO' && !retomadaValida(anterior.estadoAntesDaPausa as EstadoDoRun | undefined, destinos[0])) {
    throw new ErroDeTransicao(`Retomada inválida: o run parou em ${String(anterior.estadoAntesDaPausa)}.`)
  }
  if (destinos.some((d) => ESTADOS_IRREVERSIVEIS.has(d)) && run.modo !== 'SIMULACAO') await exigirPodeAgir(p.workspaceId, p.env)

  const checkpoint = {
    ...anterior,
    ...(p.checkpoint ?? {}),
    ...(final === 'PAUSADO' ? { estadoAntesDaPausa: cadeia[cadeia.length - 2] } : {}),
  }
  const terminal = final === 'CONCLUIDO' || final === 'FALHOU' || final === 'CANCELADO'
  const falhou = final === 'FALHOU'
  const eventos = destinos.map((para, i) => ({
    id: randomUUID(),
    chave: `run:${p.runId}:${run.passo + i + 1}`,
    payload: JSON.stringify(redigir({ de: cadeia[i], para, erro: para === 'FALHOU' ? p.erro ?? null : null })),
  }))
  const valoresDosEventos = Prisma.join(
    eventos.map((e, i) => Prisma.sql`(${e.id}::text, ${e.chave}::text, ${e.payload}::jsonb, ${i}::int)`)
  )

  const linhas = await prisma.$queryRaw<SupervisorRun[]>(Prisma.sql`
    WITH atualizado AS (
      UPDATE "SupervisorRun" SET
        "estado" = ${final}::"EstadoDoRun",
        "passo" = "passo" + ${destinos.length},
        "checkpoint" = ${JSON.stringify(checkpoint)}::jsonb,
        "atualizadoEm" = now(),
        "concluidoEm" = CASE WHEN ${terminal} THEN now() ELSE "concluidoEm" END,
        "ultimoErro" = CASE WHEN ${falhou} THEN ${p.erro ?? 'falha sem detalhe'} ELSE "ultimoErro" END,
        "tentativas" = CASE WHEN ${falhou} THEN "tentativas" + 1 ELSE "tentativas" END
      WHERE "id" = ${p.runId} AND "workspaceId" = ${p.workspaceId} AND "estado" = ${p.de}::"EstadoDoRun" AND "passo" = ${run.passo}
      RETURNING *
    ),
    eventos AS (
      INSERT INTO "DomainEvent" ("id", "workspaceId", "tipo", "versao", "correlationId", "runId", "entidadeTipo", "entidadeId", "payload", "chaveIdempotencia", "ocorridoEm")
      SELECT v.id, ${p.workspaceId}, 'RUN_STATE_CHANGED', 1, ${run.correlationId}, ${p.runId}, 'SupervisorRun', ${p.runId}, v.payload, v.chave,
             clock_timestamp() + (v.ordem * interval '1 millisecond')
      FROM (VALUES ${valoresDosEventos}) AS v(id, chave, payload, ordem)
      WHERE EXISTS (SELECT 1 FROM atualizado)
      ON CONFLICT ("workspaceId", "chaveIdempotencia") DO NOTHING
      RETURNING 1
    )
    SELECT * FROM atualizado
  `)
  if (linhas.length !== 1) throw new ErroDeTransicao('Outra execução avançou este run primeiro.')
  return linhas[0]
}
