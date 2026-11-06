/**
 * Executor da Automation Queue (P1.4.1).
 *
 * ── O QUE FALTAVA ───────────────────────────────────────────────────────
 * Até aqui, `gerarConteudoDoJob()` existia e `executarProximoJob()` existia,
 * mas NINGUÉM ligava os dois: nenhuma rota, nenhum worker, nenhuma ação
 * registrada. A fábrica só funcionava se alguém chamasse a função à mão —
 * que é exatamente o trabalho manual recorrente que a regra proíbe.
 *
 * Este módulo é o fio que faltava, e nada além disso: registra a ação de
 * `GERAR_CONTEUDO`, detecta a capacidade da máquina, mantém o heartbeat
 * enquanto o trabalho pesado roda, e destrava o que estava esperando.
 *
 * ── WAITING NÃO PODE SER ETERNO ─────────────────────────────────────────
 * Um job em `WAITING` não é reivindicável — é assim que ele não consome
 * execução. Mas isso criaria um buraco: sem ninguém reavaliando, um job
 * bloqueado por falta de memória ficaria ali para sempre, mesmo depois de a
 * memória voltar.
 *
 * `reavaliarAguardando()` fecha o buraco: a cada execução, os jobs que
 * esperavam por CAPACIDADE voltam para `PENDING` quando a capacidade
 * existe. Quem espera por decisão humana continua esperando — ali não há o
 * que reavaliar sozinho.
 */

import { prisma } from './prisma'
import {
  executarProximoJob,
  type PortaDaFila,
  type LinhaDaFila,
} from './automation-queue-repositorio'
import { renovarHeartbeat } from './automation-queue-prisma'
import { perfilDaDependencia } from './automation-queue-contrato'
import {
  gerarConteudoDoJob,
  avaliarCapacidade,
  TIPO_JOB_GERACAO,
  type CapacidadesDeGeracao,
} from './fabrica-de-conteudo'
import {
  acaoDeDistribuir,
  adaptadorDoCanal,
  ADAPTADORES_LIGADOS,
  TIPO_JOB_DISTRIBUICAO,
  type AdaptadorDeCanal,
} from './distribuicao-orquestrador'
import {
  acaoDeRenovarToken,
  RENOVADORES_LIGADOS,
  TIPO_JOB_RENOVAR_TOKEN,
  type RenovadorDeAcesso,
} from './renovacao-de-acesso'
import type { FonteDeEnv } from './cost-safety-gate'
import { avaliarFormatoParaOCanal } from './capacidades-da-fabrica'

/** De quanto em quanto tempo o heartbeat é renovado durante o trabalho. */
export const INTERVALO_DE_HEARTBEAT_MS = 30_000

/**
 * Detecta o que esta máquina consegue fazer AGORA.
 *
 * Injetável para teste poder simular máquina sem FFmpeg ou sem memória sem
 * depender do hardware onde a suíte roda.
 */
export interface DetectorDeCapacidade {
  (): Promise<CapacidadesDeGeracao>
}

/** Detector padrão: memória real do SO; render e voz vêm de quem configura. */
export async function detectarCapacidades(
  opcoes: { ffmpeg?: boolean; chatterbox?: boolean } = {}
): Promise<CapacidadesDeGeracao> {
  const os = await import('os')
  return {
    // Fail-closed: capacidade não declarada é capacidade ausente.
    ffmpeg: opcoes.ffmpeg === true,
    chatterbox: opcoes.chatterbox === true,
    memoriaLivreBytes: os.freemem(),
  }
}

/**
 * Mantém o heartbeat vivo enquanto uma promessa demorada resolve.
 *
 * Render de vídeo leva minutos. Sem isto, o job passaria do timeout de
 * heartbeat e OUTRO worker o reivindicaria — dois renders da mesma peça, e
 * o segundo sobrescrevendo o primeiro.
 */
export async function comHeartbeat<T>(
  jobId: string,
  workerId: string,
  trabalho: () => Promise<T>,
  intervaloMs: number = INTERVALO_DE_HEARTBEAT_MS,
  renovar: (id: string, worker: string, agora: Date) => Promise<boolean> = renovarHeartbeat
): Promise<T> {
  const timer = setInterval(() => {
    renovar(jobId, workerId, new Date()).catch((e) =>
      console.error(`[executor] falha ao renovar heartbeat do job ${jobId}:`, e)
    )
  }, intervaloMs)
  try {
    return await trabalho()
  } finally {
    clearInterval(timer)
  }
}

// ── As ações registradas ────────────────────────────────────────────────

export interface ContextoDoExecutor {
  workspaceId: string
  workerId: string
  capacidades: CapacidadesDeGeracao
  agora: Date
  env?: FonteDeEnv
  /**
   * Adapters de canal LIGADOS (P1.5). Ausente = `ADAPTADORES_LIGADOS`, que
   * está vazio — então o executor decide, registra e espera, sem publicar.
   */
  adaptadores?: Record<string, AdaptadorDeCanal>
  /**
   * Renovadores de acesso LIGADOS (P1.5.1). Ausente = `RENOVADORES_LIGADOS`,
   * que está vazio — então o job de renovação espera em vez de chamar nada.
   */
  renovadores?: Record<string, RenovadorDeAcesso>
  /** Trocável em teste, para não esperar o intervalo real. */
  intervaloDeHeartbeatMs?: number
  renovarHeartbeat?: (id: string, worker: string, agora: Date) => Promise<boolean>
}

/**
 * A ação de `GERAR_CONTEUDO` — o fio entre a fila e a fábrica.
 *
 * O `contentId` volta em `resultado` e o repositório o grava no contexto do
 * job. É isso que torna o retry idempotente: numa retomada, o mesmo job
 * reencontra a peça em vez de gerar outra.
 */
export function acaoDeGerarConteudo(ctx: ContextoDoExecutor) {
  return async (job: LinhaDaFila) => {
    const contexto = job.contexto ?? {}
    const formato = String(contexto.formato ?? '')
    const canal = String(contexto.canal ?? '')
    const contentIdExistente =
      typeof contexto.contentId === 'string' && contexto.contentId.trim() ? contexto.contentId : null

    // P1.9.2. Utilidade antes da capacidade: esperar por FFmpeg para gerar
    // algo que o canal não publica seria esperar à toa.
    const utilidade = avaliarFormatoParaOCanal(canal, formato)
    if (!utilidade.util) {
      return { ok: false, erroFatal: true, erro: `Job obsoleto — ${utilidade.explicacao}` }
    }

    // Capacidade ANTES do trabalho: sem ela o job espera, e esperar não é
    // falhar.
    const capacidade = avaliarCapacidade(formato, ctx.capacidades, ctx.env)
    if (!capacidade.pode) {
      return {
        ok: false,
        aguardar: true,
        erro: capacidade.explicacao,
        resultado: { bloqueadoPor: capacidade.motivo, reavaliarQuandoHouverCapacidade: true },
      }
    }

    const r = await comHeartbeat(
      job.id,
      ctx.workerId,
      () =>
        gerarConteudoDoJob({
          workspaceId: ctx.workspaceId,
          produtoId: job.entityId,
          formato,
          canal,
          contentIdExistente,
          capacidades: ctx.capacidades,
          agora: ctx.agora,
          env: ctx.env,
        }),
      ctx.intervaloDeHeartbeatMs,
      ctx.renovarHeartbeat
    )

    // O resultado viaja MESMO em falha: se a peça chegou a ser criada e algo
    // quebrou depois, o retry precisa reencontrá-la.
    const resultado: Record<string, unknown> = {
      ...(r.contentId ? { contentId: r.contentId } : {}),
      formato: r.formato,
      canal: r.canal,
      assetUrl: r.assetUrl,
      custo: r.custo,
      concluidoEm: ctx.agora.toISOString(),
      bloqueadoPor: null,
      reavaliarQuandoHouverCapacidade: false,
    }

    if (r.ok) return { ok: true, resultado }
    return { ok: false, erroFatal: r.erroFatal === true, erro: r.explicacao, resultado }
  }
}

/** Todas as ações que este executor sabe fazer. */
export function acoesDoExecutor(ctx: ContextoDoExecutor) {
  return {
    [TIPO_JOB_GERACAO]: acaoDeGerarConteudo(ctx),
    [TIPO_JOB_DISTRIBUICAO]: acaoDeDistribuir({
      workspaceId: ctx.workspaceId,
      adaptadores: ctx.adaptadores ?? ADAPTADORES_LIGADOS,
      env: ctx.env as Record<string, string | undefined> | undefined,
    }),
    [TIPO_JOB_RENOVAR_TOKEN]: acaoDeRenovarToken({
      workspaceId: ctx.workspaceId,
      renovadores: ctx.renovadores ?? RENOVADORES_LIGADOS,
      agora: ctx.agora,
      env: ctx.env as Record<string, string | undefined> | undefined,
    }),
  }
}

// ── Destravar quem esperava ─────────────────────────────────────────────

export interface ResultadoDaReavaliacao {
  avaliados: number
  destravados: number
  motivos: Record<string, number>
}

/**
 * Devolve à fila os jobs que esperavam por CAPACIDADE, quando ela volta.
 *
 * Só mexe em quem tem `reavaliarQuandoHouverCapacidade` no contexto — ou
 * seja, quem parou por falta de máquina. Job em `WAITING` por decisão
 * humana continua onde está: reavaliá-lo sozinho seria fingir que o OAuth
 * apareceu.
 */
export async function reavaliarAguardando(params: {
  porta: PortaDaFila
  workspaceId: string
  capacidades: CapacidadesDeGeracao
  env?: FonteDeEnv
}): Promise<ResultadoDaReavaliacao> {
  const motivos: Record<string, number> = {}
  let avaliados = 0
  let destravados = 0

  const todos = await params.porta.listarPorWorkspace(params.workspaceId)
  for (const job of todos) {
    if (job.estado !== 'WAITING') continue
    const ctx = job.contexto ?? {}
    if (ctx.reavaliarQuandoHouverCapacidade !== true) {
      motivos.NAO_E_CAPACIDADE = (motivos.NAO_E_CAPACIDADE ?? 0) + 1
      continue
    }
    avaliados++

    const perfil = perfilDaDependencia(job.tipo)
    if (perfil.classe !== 'AUTOMATIZAVEL') {
      motivos.NAO_AUTOMATIZAVEL = (motivos.NAO_AUTOMATIZAVEL ?? 0) + 1
      continue
    }

    const capacidade = avaliarCapacidade(String(ctx.formato ?? ''), params.capacidades, params.env)
    if (!capacidade.pode) {
      motivos[capacidade.motivo ?? 'AINDA_SEM_CAPACIDADE'] =
        (motivos[capacidade.motivo ?? 'AINDA_SEM_CAPACIDADE'] ?? 0) + 1
      continue
    }

    await params.porta.atualizar(job.id, {
      estado: 'PENDING',
      ultimoErro: null,
      contexto: { ...ctx, bloqueadoPor: null, reavaliarQuandoHouverCapacidade: false },
    })
    destravados++
    motivos.DESTRAVADO = (motivos.DESTRAVADO ?? 0) + 1
  }

  return { avaliados, destravados, motivos }
}

// ── O laço ──────────────────────────────────────────────────────────────

export interface ResultadoDoLaco {
  executados: number
  sucessos: number
  aguardando: number
  falhas: number
  destravados: number
  detalhes: { jobId: string; tipo: string; estadoFinal: string | null; explicacao: string }[]
}

/**
 * Roda a fila de UM workspace até acabar o que dá para fazer.
 *
 * AUTOMATION FIRST: reavalia o que esperava, reclama, executa, conclui e
 * segue para o próximo — sem ninguém disparar função à mão.
 *
 * `limite` existe porque um laço sem teto num cron de plataforma serverless
 * estoura o tempo da requisição e morre no meio de um render.
 */
export async function rodarFilaDoWorkspace(params: {
  porta: PortaDaFila
  workspaceId: string
  workerId: string
  capacidades: CapacidadesDeGeracao
  agora: Date
  env?: FonteDeEnv
  /** P1.5: canais ligados. Ausente = nenhum, e nada é publicado. */
  adaptadores?: Record<string, AdaptadorDeCanal>
  /** P1.5.1: renovadores ligados. Ausente = nenhum. */
  renovadores?: Record<string, RenovadorDeAcesso>
  limite?: number
  intervaloDeHeartbeatMs?: number
  renovarHeartbeat?: (id: string, worker: string, agora: Date) => Promise<boolean>
}): Promise<ResultadoDoLaco> {
  const limite = params.limite ?? 10
  const detalhes: ResultadoDoLaco['detalhes'] = []
  let sucessos = 0
  let aguardando = 0
  let falhas = 0

  // 1. Quem esperava por capacidade volta à fila, se a capacidade voltou.
  const reavaliacao = await reavaliarAguardando({
    porta: params.porta,
    workspaceId: params.workspaceId,
    capacidades: params.capacidades,
    env: params.env,
  })

  // 2. O laço de execução.
  const ctx: ContextoDoExecutor = {
    workspaceId: params.workspaceId,
    workerId: params.workerId,
    capacidades: params.capacidades,
    agora: params.agora,
    env: params.env,
    adaptadores: params.adaptadores,
    renovadores: params.renovadores,
    intervaloDeHeartbeatMs: params.intervaloDeHeartbeatMs,
    renovarHeartbeat: params.renovarHeartbeat,
  }
  const acoes = acoesDoExecutor(ctx)

  for (let i = 0; i < limite; i++) {
    const r = await executarProximoJob({
      porta: params.porta,
      workspaceId: params.workspaceId,
      workerId: params.workerId,
      agora: params.agora,
      acoes,
    })
    if (!r.job) break

    detalhes.push({
      jobId: r.job.id,
      tipo: r.job.tipo,
      estadoFinal: r.estadoFinal,
      explicacao: r.explicacao,
    })
    if (r.estadoFinal === 'SUCCEEDED') sucessos++
    else if (r.estadoFinal === 'WAITING') aguardando++
    else falhas++
  }

  return {
    executados: detalhes.length,
    sucessos,
    aguardando,
    falhas,
    destravados: reavaliacao.destravados,
    detalhes,
  }
}

/**
 * Em que condição este executor publica — e em que condição não publica.
 *
 * Mudou no P1.5: ele passou a executar distribuição. O que NÃO mudou é a
 * regra. Distribuir exige a decisão aprovar E um adapter ligado, e o
 * registro de adapters está vazio: hoje o executor decide, registra o
 * motivo e espera. `Publicacao` continua significando distribuição real.
 */
export const PUBLICACAO_DO_EXECUTOR = {
  chave: 'executor-da-fila:publicacao',
  estado: 'SOMENTE_COM_DECISAO_APROVADA_E_ADAPTER_LIGADO',
  tiposExecutados: [TIPO_JOB_GERACAO, TIPO_JOB_DISTRIBUICAO, TIPO_JOB_RENOVAR_TOKEN],
  porque:
    'Peça pronta não é autorização. Entre a peça e o post estão a decisão de distribuição e um adapter que alguém ligou.',
  /** Quantos canais estão de fato ligados agora. Zero é a resposta honesta. */
  adaptadoresLigados: () => Object.keys(ADAPTADORES_LIGADOS),
  canalLigado: (canal: string) => adaptadorDoCanal(canal) !== null,
} as const

/** Reexportado para quem monta o contexto do worker. */
export { prisma }
