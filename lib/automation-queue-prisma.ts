/**
 * Adaptador Prisma da Automation Queue (P1.3).
 *
 * É o ÚNICO arquivo que escreve em `AutomationJob`. Há teste varrendo
 * `lib/` e `app/` que quebra se outro módulo chamar
 * `prisma.automationJob.create/update/upsert`.
 *
 * ── O CLAIM É SQL CRU, E ISSO É DELIBERADO ──────────────────────────────
 * `FOR UPDATE SKIP LOCKED` não tem equivalente no query builder do Prisma.
 * Sem ele, dois workers simultâneos disputariam a MESMA linha: um esperaria
 * o outro soltar o lock e então pegaria o job já reivindicado, ou ficaria
 * bloqueado. Com ele, cada worker pula o que já está travado e leva uma
 * linha diferente — que é a diferença entre uma fila e uma disputa.
 */

import { prisma } from './prisma'
import {
  TIMEOUT_DE_HEARTBEAT_MS,
  type PortaDaFila,
  type LinhaDaFila,
} from './automation-queue-repositorio'
import type { EstadoDoJob, ClasseDeJob } from './automation-queue-contrato'
import type { PortaDeRetencao, TarefaParaRetencao } from './retencao-de-tarefas'

type LinhaCrua = {
  id: string
  workspaceId: string
  tipo: string
  chave: string
  estado: string
  classe: string
  motivoHumano: string | null
  entityType: string
  entityId: string
  contexto: unknown
  tentativas: number
  proximaTentativaEm: Date | null
  ultimoErro: string | null
  workerId: string | null
  claimedAt: Date | null
  heartbeatAt: Date | null
  resolvidoEm: Date | null
  createdAt: Date
}

function converter(l: LinhaCrua): LinhaDaFila {
  return {
    ...l,
    estado: l.estado as EstadoDoJob,
    classe: l.classe as ClasseDeJob,
    contexto: (l.contexto as Record<string, unknown> | null) ?? null,
  }
}

/**
 * A porta de verdade. `staleMs` fica configurável só para teste poder
 * provar a recuperação sem esperar cinco minutos de relógio.
 */
export function portaPrisma(staleMs: number = TIMEOUT_DE_HEARTBEAT_MS): PortaDaFila {
  return {
    async listarPorWorkspace(workspaceId) {
      const linhas = await prisma.automationJob.findMany({ where: { workspaceId } })
      return (linhas as unknown as LinhaCrua[]).map(converter)
    },

    async inserirOuReencontrar(nova) {
      try {
        const criada = await prisma.automationJob.create({
          data: {
            workspaceId: nova.workspaceId,
            tipo: nova.tipo,
            chave: nova.chave,
            estado: nova.estado as never,
            classe: nova.classe,
            motivoHumano: nova.motivoHumano,
            entityType: nova.entityType,
            entityId: nova.entityId,
            contexto: (nova.contexto ?? undefined) as never,
            tentativas: nova.tentativas,
            proximaTentativaEm: nova.proximaTentativaEm,
            ultimoErro: nova.ultimoErro,
            workerId: nova.workerId,
            claimedAt: nova.claimedAt,
            heartbeatAt: nova.heartbeatAt,
            resolvidoEm: nova.resolvidoEm,
          },
        })
        return converter(criada as unknown as LinhaCrua)
      } catch (e) {
        // A unique `(workspaceId, chave)` recusou: dois crons simultâneos
        // pediram a mesma coisa. Isso é IDEMPOTÊNCIA, não erro — devolve a
        // linha que venceu a corrida.
        const err = e as { code?: string }
        if (err?.code === 'P2002') {
          const existente = await prisma.automationJob.findUnique({
            where: { workspaceId_chave: { workspaceId: nova.workspaceId, chave: nova.chave } },
          })
          if (existente) return converter(existente as unknown as LinhaCrua)
        }
        throw e
      }
    },

    async atualizar(id, dados) {
      const atualizada = await prisma.automationJob
        .update({
          where: { id },
          data: {
            ...(dados.estado !== undefined ? { estado: dados.estado as never } : {}),
            ...(dados.contexto !== undefined ? { contexto: (dados.contexto ?? undefined) as never } : {}),
            ...(dados.classe !== undefined ? { classe: dados.classe } : {}),
            ...(dados.tentativas !== undefined ? { tentativas: dados.tentativas } : {}),
            ...(dados.proximaTentativaEm !== undefined ? { proximaTentativaEm: dados.proximaTentativaEm } : {}),
            ...(dados.ultimoErro !== undefined ? { ultimoErro: dados.ultimoErro } : {}),
            ...(dados.workerId !== undefined ? { workerId: dados.workerId } : {}),
            ...(dados.claimedAt !== undefined ? { claimedAt: dados.claimedAt } : {}),
            ...(dados.heartbeatAt !== undefined ? { heartbeatAt: dados.heartbeatAt } : {}),
            ...(dados.resolvidoEm !== undefined ? { resolvidoEm: dados.resolvidoEm } : {}),
          },
        })
        .catch(() => null)
      return atualizada ? converter(atualizada as unknown as LinhaCrua) : null
    },

    async reivindicar(workspaceId, workerId, agora) {
      const limiteStale = new Date(agora.getTime() - staleMs)
      // `workspaceId` no WHERE é o que impede o worker de A de enxergar job
      // de B. `WAITING` não aparece: dependência humana e condição externa
      // ficam visíveis na fila sem consumir execução.
      const linhas = await prisma.$queryRaw<LinhaCrua[]>`
        UPDATE "AutomationJob"
        SET "workerId" = ${workerId},
            "claimedAt" = ${agora},
            "heartbeatAt" = ${agora},
            -- P2.27: retomar um RUNNING vencido (o processo morreu) CONTA como tentativa: um job que derruba
            -- o processo toda vez não fica em loop infinito; o repositório o leva a FAILED_FINAL no limite.
            "tentativas" = "tentativas" + (CASE WHEN "estado" = 'RUNNING' THEN 1 ELSE 0 END),
            "estado" = 'RUNNING'::"EstadoDoAutomationJob",
            "updatedAt" = now()
        WHERE id = (
          SELECT id FROM "AutomationJob"
          WHERE "workspaceId" = ${workspaceId}
            -- P2.27: trabalhos longos têm ciclo próprio (lib/trabalho-longo.ts). Pegá-los aqui movia um longo
            -- interrompido para WAITING ("incerto") e anulava a retomada segura com interrompido: true.
            AND left("tipo", 6) <> 'LONGO_'
            AND (
              ("estado" = 'PENDING' AND "workerId" IS NULL)
              OR ("estado" = 'FAILED_RETRYABLE' AND "proximaTentativaEm" IS NOT NULL AND "proximaTentativaEm" <= ${agora})
              OR ("estado" = 'RUNNING' AND "heartbeatAt" IS NOT NULL AND "heartbeatAt" < ${limiteStale})
            )
          ORDER BY "createdAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        RETURNING *
      `
      return linhas[0] ? converter(linhas[0]) : null
    },
  }
}

/**
 * P2.28 — reconciliação: cancela um item da fila cuja entidade não existe mais. Só se ainda estiver no
 * estado lido (não pega um job que acabou de ser reivindicado por um worker).
 */
export async function cancelarJobSemEntidade(id: string, estadoLido: string, motivo: string): Promise<boolean> {
  const r = await prisma.automationJob.updateMany({
    where: { id, estado: estadoLido as never, workerId: null },
    data: { estado: 'CANCELLED' as never, ultimoErro: motivo.slice(0, 500), resolvidoEm: new Date() },
  })
  return r.count === 1
}

/** Renova o heartbeat — só se ESTE worker ainda for o dono. */
export async function renovarHeartbeat(jobId: string, workerId: string, agora: Date): Promise<boolean> {
  const r = await prisma.automationJob.updateMany({
    where: { id: jobId, workerId },
    data: { heartbeatAt: agora },
  })
  return r.count === 1
}

// ── P2.2: trabalhos longos ──────────────────────────────────────────────
//
// Os trabalhos `LONGO_*` (lib/trabalho-longo.ts) moram nesta mesma tabela,
// e por isso escrevem por AQUI — a regra "um arquivo só escreve na fila"
// continua valendo. Quem decide o quê é o núcleo dos trabalhos longos, que
// valida a entidade (`validarEntidadeDaAutomacao`) antes de inserir; este
// adaptador só executa a escrita, sempre condicionada a quem é o dono.

type CriacaoDeTrabalhoLongo = Parameters<typeof prisma.automationJob.create>[0]['data']
type MudancaDeTrabalhoLongo = Parameters<typeof prisma.automationJob.updateMany>[0]['data']

export const portaDosTrabalhosLongos = {
  inserir(dados: CriacaoDeTrabalhoLongo) {
    return prisma.automationJob.create({ data: dados })
  },

  /** Muda `de` → `para`, só se o estado (e o heartbeat, se pedido) ainda for o esperado. */
  async mudarSeEstado(id: string, de: string, dados: MudancaDeTrabalhoLongo, heartbeatAntesDe?: Date): Promise<boolean> {
    const r = await prisma.automationJob.updateMany({
      where: { id, estado: de as never, ...(heartbeatAntesDe ? { heartbeatAt: { lt: heartbeatAntesDe } } : {}) },
      data: dados,
    })
    return r.count === 1
  },

  /** Claim atômico: só o PENDING reservado vira RUNNING, e só para um worker. */
  async reivindicar(id: string, reserva: string, workerId: string): Promise<boolean> {
    const agora = new Date()
    const r = await prisma.automationJob.updateMany({
      where: { id, estado: 'PENDING', workerId: reserva },
      data: { estado: 'RUNNING', workerId, claimedAt: agora, heartbeatAt: agora, tentativas: { increment: 1 } },
    })
    return r.count === 1
  },

  /** Escreve só se ESTE worker ainda for o dono. */
  async escreverComoDono(id: string, workerId: string, dados: MudancaDeTrabalhoLongo): Promise<boolean> {
    const r = await prisma.automationJob.updateMany({ where: { id, workerId }, data: dados })
    return r.count === 1
  },
}

// ── P2.9: retenção dos trabalhos longos ─────────────────────────────────
//
// Leitura e escrita da política de lib/retencao-de-tarefas.ts. Toda escrita
// é condicionada à linha ainda estar EXATAMENTE como foi lida (workspace,
// estado e updatedAt): se um trabalho voltou a andar entre o relatório e a
// aplicação, ele não é tocado.

export function portaDeRetencaoPrisma(): PortaDeRetencao {
  return {
    async workspaces() {
      const linhas = await prisma.automationJob.findMany({
        where: { tipo: { startsWith: 'LONGO_' } },
        select: { workspaceId: true },
        distinct: ['workspaceId'],
      })
      return linhas.map((l) => l.workspaceId)
    },

    async listar(workspaceId, limite) {
      const linhas = await prisma.automationJob.findMany({
        where: { workspaceId, tipo: { startsWith: 'LONGO_' }, estado: { notIn: ['PENDING', 'RUNNING'] } },
        select: { id: true, workspaceId: true, tipo: true, estado: true, updatedAt: true, contexto: true },
        orderBy: { updatedAt: 'asc' },
        take: limite,
      })
      return linhas.map((l) => ({ ...l, contexto: (l.contexto as Record<string, unknown> | null) ?? null }))
    },

    async anonimizar(t: TarefaParaRetencao, contexto: Record<string, unknown>) {
      const r = await prisma.automationJob.updateMany({
        where: { id: t.id, workspaceId: t.workspaceId, estado: t.estado as never, updatedAt: t.updatedAt },
        // `ultimoErro` sai junto: mensagem de provider pode citar o número.
        data: { contexto: contexto as never, ultimoErro: null },
      })
      return r.count === 1
    },

    async excluir(t: TarefaParaRetencao) {
      const r = await prisma.automationJob.deleteMany({
        where: { id: t.id, workspaceId: t.workspaceId, estado: t.estado as never, updatedAt: t.updatedAt },
      })
      return r.count === 1
    },
  }
}
