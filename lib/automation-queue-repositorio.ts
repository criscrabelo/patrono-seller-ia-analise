/**
 * Automation Queue — a ÚNICA porta de escrita (P1.3).
 *
 * ── POR QUE UMA PORTA SÓ ────────────────────────────────────────────────
 * `entityType`/`entityId` é polimórfico, então o banco não consegue garantir
 * que a entidade apontada seja do mesmo workspace. A garantia vem da
 * aplicação — e uma garantia de aplicação só vale se não der para
 * contorná-la sem querer.
 *
 * Por isso todo caminho de escrita passa por aqui. Este arquivo tem a
 * REGRA e nunca toca o banco direto: quem fala com o Postgres é o
 * adaptador em lib/automation-queue-prisma.ts, o unico modulo do projeto
 * que escreve na tabela — ha teste varrendo `lib/` e `app/` para garantir
 * que continue sendo um so.
 *
 * ── A PERSISTÊNCIA ENTRA POR UMA PORTA ──────────────────────────────────
 * `PortaDaFila` existe por dois motivos. O primeiro é honesto: a tabela
 * ainda não existe no banco, e escrever contra o cliente gerado travaria a
 * compilação até a migration ser aprovada. O segundo é melhor: com a porta,
 * toda a regra — validação, idempotência, sincronização, retry — fica
 * testável sem Postgres, e o adaptador Prisma vira encaixe.
 */

import {
  chaveDoJob,
  perfilDaDependencia,
  podeExecutarSozinho,
  decidirAposFalha,
  sincronizar,
  type EstadoDoJob,
  type ClasseDeJob,
  type JobDesejado,
  type JobExistente,
  type PerfilDaDependencia,
} from './automation-queue-contrato'
import { validarEntidadeDaAutomacao, type TipoDeEntidade } from './automation-queue-entidades'

// ── A porta ─────────────────────────────────────────────────────────────

export interface LinhaDaFila {
  id: string
  workspaceId: string
  tipo: string
  chave: string
  estado: EstadoDoJob
  classe: ClasseDeJob
  motivoHumano: string | null
  entityType: string
  entityId: string
  contexto: Record<string, unknown> | null
  tentativas: number
  proximaTentativaEm: Date | null
  ultimoErro: string | null
  workerId: string | null
  claimedAt: Date | null
  heartbeatAt: Date | null
  resolvidoEm: Date | null
  createdAt: Date
}

export interface PortaDaFila {
  /** Jobs do workspace. SEMPRE escopado — nunca existe leitura global. */
  listarPorWorkspace(workspaceId: string): Promise<LinhaDaFila[]>
  /**
   * Insere. Devolve a linha existente quando a chave já existe — a unique
   * `(workspaceId, chave)` é a garantia real de idempotência sob corrida.
   */
  inserirOuReencontrar(linha: Omit<LinhaDaFila, 'id' | 'createdAt'>): Promise<LinhaDaFila>
  atualizar(id: string, dados: Partial<LinhaDaFila>): Promise<LinhaDaFila | null>
  /**
   * Reivindica UM job do workspace. `workspaceId` é obrigatório: um worker
   * do negócio A nunca pode enxergar job do B.
   */
  reivindicar(workspaceId: string, workerId: string, agora: Date): Promise<LinhaDaFila | null>
}

// ── Perfil contextual ───────────────────────────────────────────────────

/**
 * O perfil de `COMPLETAR_DADO_DO_PRODUTO` depende do caso concreto.
 *
 * Só faz sentido tentar quando existe FONTE AUTOMÁTICA de onde o dado possa
 * vir — um provider oficial sincronizando o catálogo. Produto cadastrado à
 * mão não tem de onde o dado aparecer sozinho: ali o job fica `WAITING`, à
 * espera da dona, em vez de gastar três tentativas para descobrir o óbvio.
 */
export function perfilContextual(
  tipo: string,
  contexto: Record<string, unknown> = {}
): PerfilDaDependencia {
  const base = perfilDaDependencia(tipo)

  // P1.9.2. Mídia que só a DONA pode fornecer (o vídeo que ela grava). Não
  // é a sincronização com o provider: é pessoa, e o painel precisa dizer
  // "preciso de você". Zero tentativas — repetir não grava vídeo.
  if (tipo === 'SINCRONIZAR_MIDIA_AUTORIZADA' && contexto.origemDaMidia === 'DA_DONA') {
    return {
      ...base,
      classe: 'EXIGE_HUMANO',
      motivoHumano: 'MISSING_AUTHORIZED_MEDIA',
      maxTentativas: 0,
      explicacao:
        'O canal só publica vídeo, e o vídeo tem de ser da proprietária, com direito registrado. Fica aguardando o arquivo, sem consumir tentativa.',
    }
  }

  if (tipo !== 'COMPLETAR_DADO_DO_PRODUTO') return base

  const temFonteAutomatica = contexto.temFonteAutomatica === true
  if (temFonteAutomatica) return base

  return {
    ...base,
    classe: 'AGUARDA_CONDICAO',
    maxTentativas: 0,
    explicacao:
      'Produto sem provider oficial: o dado não chega sozinho. Fica aguardando a proprietária em vez de gastar tentativas.',
  }
}

// ── Vocabulário de recusa ───────────────────────────────────────────────

export const MOTIVOS_RECUSA_DO_JOB = [
  'ENTIDADE_INVALIDA',
  'PARAMETROS_INCOMPLETOS',
  'FALHA_AO_PERSISTIR',
] as const
export type MotivoRecusaDoJob = (typeof MOTIVOS_RECUSA_DO_JOB)[number]

export interface ResultadoDoJob {
  ok: boolean
  job: LinhaDaFila | null
  /** `false` quando a linha já existia — idempotência, não erro. */
  criado: boolean
  motivo: MotivoRecusaDoJob | null
  explicacao: string
}

const recusar = (motivo: MotivoRecusaDoJob, explicacao: string): ResultadoDoJob => ({
  ok: false,
  job: null,
  criado: false,
  motivo,
  explicacao,
})

// ── A porta de escrita ──────────────────────────────────────────────────

/**
 * ÚNICO caminho que cria ou atualiza um job.
 *
 * Ordem deliberada: valida a entidade ANTES de qualquer escrita. Um job
 * apontando para produto de outro workspace nunca chega a existir, nem por
 * um instante.
 *
 * `workspaceId` vem de quem chama — sessão autenticada, cron ou worker
 * pareado — e é o mesmo usado para resolver a entidade. Payload externo não
 * tem como injetar outro.
 */
export async function criarOuSincronizarAutomationJob(params: {
  porta: PortaDaFila
  workspaceId: string
  tipo: string
  entityType: string
  entityId: string
  contexto?: Record<string, unknown>
  agora: Date
}): Promise<ResultadoDoJob> {
  const { porta, workspaceId, tipo, entityType, entityId, agora } = params
  const contexto = params.contexto ?? {}

  if (!workspaceId?.trim() || !tipo?.trim()) {
    return recusar('PARAMETROS_INCOMPLETOS', 'workspaceId e tipo são obrigatórios.')
  }

  // 1. A ENTIDADE, lida do servidor e escopada pelo workspace.
  const entidade = await validarEntidadeDaAutomacao({ workspaceId, entityType, entityId })
  if (!entidade.ok) {
    return recusar('ENTIDADE_INVALIDA', entidade.explicacao)
  }

  // 2. Perfil — que decide se isto vai tentar sozinho ou esperar.
  const perfil = perfilContextual(tipo, contexto)
  const estadoInicial: EstadoDoJob = podeExecutarSozinho(perfil) ? 'PENDING' : 'WAITING'

  // 3. Chave determinística. Mesma situação reencontra a mesma linha.
  const chave = chaveDoJob({ workspaceId, tipo, entityType: entidade.tipo!, entityId, contexto })

  try {
    const job = await porta.inserirOuReencontrar({
      workspaceId,
      tipo,
      chave,
      estado: estadoInicial,
      classe: perfil.classe,
      motivoHumano: perfil.motivoHumano,
      entityType: entidade.tipo!,
      entityId,
      contexto,
      tentativas: 0,
      proximaTentativaEm: null,
      ultimoErro: null,
      workerId: null,
      claimedAt: null,
      heartbeatAt: null,
      resolvidoEm: null,
    })
    const criado = job.createdAt.getTime() >= agora.getTime()
    return {
      ok: true,
      job,
      criado,
      motivo: null,
      explicacao: `${tipo} para ${entidade.tipo} ${entityId} — ${perfil.explicacao}`,
    }
  } catch (e) {
    console.error(`[automation-queue] falha ao persistir job ${tipo}/${entityId}:`, e)
    return recusar('FALHA_AO_PERSISTIR', 'Não foi possível gravar o job.')
  }
}

// ── Sincronização a partir do plano ─────────────────────────────────────

export interface ResultadoDaSincronizacao {
  criados: number
  mantidos: number
  cancelados: number
  recusados: { entityId: string; motivo: string }[]
}

/**
 * O que o cron chama.
 *
 * Cria o que falta, mantém o que já existe e CANCELA o que saiu do plano.
 * Job `RUNNING` nunca é cancelado: um worker está com ele na mão, e apagar
 * por baixo produziria resultado órfão.
 */
export async function sincronizarFilaComPlano(params: {
  porta: PortaDaFila
  workspaceId: string
  desejados: JobDesejado[]
  agora: Date
  /**
   * Tipos de job que esta chamada gerencia. Ausente = todos.
   *
   * Quem sincroniza só uma parte da fila precisa dizer qual parte — senão
   * cancela o que outro dono criou.
   */
  tiposGerenciados?: readonly string[]
}): Promise<ResultadoDaSincronizacao> {
  const { porta, workspaceId, desejados, agora } = params
  const existentes = await porta.listarPorWorkspace(workspaceId)

  const plano = sincronizar(
    desejados,
    existentes.map<JobExistente>((j) => ({ id: j.id, chave: j.chave, estado: j.estado, tipo: j.tipo })),
    params.tiposGerenciados
  )

  const recusados: { entityId: string; motivo: string }[] = []
  let criados = 0
  for (const d of plano.criar) {
    const r = await criarOuSincronizarAutomationJob({
      porta,
      workspaceId,
      tipo: d.tipo,
      entityType: d.entityType,
      entityId: d.entityId,
      contexto: d.contexto,
      agora,
    })
    if (r.ok) criados++
    else recusados.push({ entityId: d.entityId, motivo: r.explicacao })
  }

  let cancelados = 0
  for (const c of plano.cancelar) {
    const atual = existentes.find((j) => j.id === c.id)
    // RUNNING fica: há worker com ele na mão.
    if (!atual || atual.estado === 'RUNNING') continue
    await porta.atualizar(c.id, {
      estado: 'CANCELLED',
      resolvidoEm: agora,
      ultimoErro: c.motivo,
    })
    cancelados++
  }

  return { criados, mantidos: plano.manter.length, cancelados, recusados }
}

// ── Execução ────────────────────────────────────────────────────────────

export interface ResultadoDaExecucao {
  executado: boolean
  job: LinhaDaFila | null
  estadoFinal: EstadoDoJob | null
  explicacao: string
}

/**
 * Reivindica e executa UM job do workspace.
 *
 * `workspaceId` é obrigatório no claim. Um worker do negócio A nunca
 * enxerga job do B — é a mesma trava do `DigitalTwinJob`, só que aqui o
 * parâmetro não é opcional.
 *
 * O executor desta rodada só toca ação AUTOMATIZÁVEL. Qualquer outra coisa
 * já nasceu `WAITING` e não é reivindicável.
 */
export async function executarProximoJob(params: {
  porta: PortaDaFila
  workspaceId: string
  workerId: string
  agora: Date
  /**
   * A ação de verdade, por tipo de job.
   *
   * `aguardar: true` é diferente de `ok: false`: significa "não deu para
   * fazer agora, e isso não é falha" — falta de memória, de FFmpeg, de
   * capacidade. O job volta para WAITING SEM consumir tentativa, porque
   * gastar tentativa por falta de máquina esgotaria o retry de um trabalho
   * que nunca chegou a ser tentado.
   *
   * `resultado` é gravado no contexto do job: é ali que o `contentId` da
   * peça gerada fica, e é o que torna o retry idempotente.
   */
  acoes?: Record<
    string,
    (job: LinhaDaFila) => Promise<{
      ok: boolean
      aguardar?: boolean
      erroFatal?: boolean
      erro?: string
      resultado?: Record<string, unknown>
    }>
  >
}): Promise<ResultadoDaExecucao> {
  const { porta, workspaceId, workerId, agora } = params
  const job = await porta.reivindicar(workspaceId, workerId, agora)
  if (!job) {
    return { executado: false, job: null, estadoFinal: null, explicacao: 'Nada a executar nesta fila.' }
  }

  const perfil = perfilContextual(job.tipo, job.contexto ?? {})
  if (!podeExecutarSozinho(perfil)) {
    // Cinto e suspensório: o claim já não devia ter entregue isto.
    const atualizado = await porta.atualizar(job.id, {
      estado: 'WAITING',
      workerId: null,
      claimedAt: null,
      ultimoErro: perfil.explicacao,
    })
    return {
      executado: false,
      job: atualizado,
      estadoFinal: 'WAITING',
      explicacao: `${job.tipo} não é executável sozinho: ${perfil.explicacao}`,
    }
  }

  // P2.27: o claim conta como tentativa a retomada de um RUNNING vencido (o processo morreu). Passou do limite,
  // para de vez — um job que derruba o processo toda vez não roda para sempre.
  if (perfil.maxTentativas > 0 && job.tentativas >= perfil.maxTentativas) {
    const atualizado = await porta.atualizar(job.id, {
      estado: 'FAILED_FINAL',
      workerId: null,
      claimedAt: null,
      resolvidoEm: agora,
      ultimoErro: `Interrompido ${job.tentativas} vez(es) sem concluir (o processo caiu durante a execução). Não será repetido sozinho.`,
    })
    return { executado: false, job: atualizado, estadoFinal: 'FAILED_FINAL', explicacao: 'Limite de tentativas atingido por interrupções.' }
  }

  const acao = params.acoes?.[job.tipo]
  if (!acao) {
    const atualizado = await porta.atualizar(job.id, {
      estado: 'WAITING',
      workerId: null,
      claimedAt: null,
      ultimoErro: `Nenhuma ação registrada para ${job.tipo}.`,
    })
    return {
      executado: false,
      job: atualizado,
      estadoFinal: 'WAITING',
      explicacao: `Sem ação registrada para ${job.tipo} — aguardando implementação, não falhando.`,
    }
  }

  const r = await acao(job).catch((e) => ({
    ok: false,
    aguardar: false,
    erroFatal: false,
    erro: e instanceof Error ? e.message : 'falha desconhecida',
    resultado: undefined as Record<string, unknown> | undefined,
  }))

  // O resultado entra no contexto SEMPRE que existir — inclusive quando a
  // ação falhou depois de já ter criado a peça. É isso que faz o retry
  // reencontrar o que ficou pela metade em vez de gerar outra.
  const contextoAtualizado = r.resultado
    ? { ...(job.contexto ?? {}), ...r.resultado }
    : job.contexto

  if (r.aguardar) {
    const atualizado = await porta.atualizar(job.id, {
      estado: 'WAITING',
      workerId: null,
      claimedAt: null,
      contexto: contextoAtualizado,
      ultimoErro: r.erro ?? 'Capacidade indisponível — aguardando.',
    })
    return {
      executado: false,
      job: atualizado,
      estadoFinal: 'WAITING',
      explicacao: r.erro ?? 'Capacidade indisponível; o job espera sem gastar tentativa.',
    }
  }

  if (r.ok) {
    const atualizado = await porta.atualizar(job.id, {
      estado: 'SUCCEEDED',
      resolvidoEm: agora,
      workerId: null,
      ultimoErro: null,
      contexto: contextoAtualizado,
    })
    return { executado: true, job: atualizado, estadoFinal: 'SUCCEEDED', explicacao: 'Resolvido pelo sistema.' }
  }

  const decisao = decidirAposFalha({
    perfil,
    tentativasAtuais: job.tentativas,
    erroFatal: r.erroFatal,
    agora,
  })
  const atualizado = await porta.atualizar(job.id, {
    estado: decisao.estado,
    tentativas: job.tentativas + 1,
    proximaTentativaEm: decisao.proximaTentativaEm,
    ultimoErro: r.erro ?? decisao.explicacao,
    workerId: null,
    claimedAt: null,
    contexto: contextoAtualizado,
  })
  return { executado: false, job: atualizado, estadoFinal: decisao.estado, explicacao: decisao.explicacao }
}

/**
 * SQL do claim, para o adaptador Prisma usar depois da migration.
 *
 * `FOR UPDATE SKIP LOCKED` é o que faz dois workers simultâneos pegarem
 * linhas DIFERENTES em vez de disputarem a mesma. `workspaceId` no WHERE é
 * o que impede o worker de A de enxergar job de B.
 *
 * `WAITING` não aparece entre os estados reivindicáveis — é assim que
 * dependência humana e condição externa deixam de consumir execução.
 */
export const SQL_DO_CLAIM = `
UPDATE "AutomationJob"
SET "workerId" = $2, "claimedAt" = now(), "heartbeatAt" = now(), "estado" = 'RUNNING', "updatedAt" = now()
WHERE id = (
  SELECT id FROM "AutomationJob"
  WHERE "workspaceId" = $1
    AND (
      ("estado" = 'PENDING' AND "workerId" IS NULL)
      OR ("estado" = 'FAILED_RETRYABLE' AND "proximaTentativaEm" IS NOT NULL AND "proximaTentativaEm" <= $3)
      OR ("estado" = 'RUNNING' AND "heartbeatAt" IS NOT NULL AND "heartbeatAt" < $4)
    )
  ORDER BY "createdAt" ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
RETURNING *
`.trim()

/** Sem heartbeat por este tempo, o job é considerado abandonado. */
export const TIMEOUT_DE_HEARTBEAT_MS = 5 * 60 * 1000

/**
 * Estados que a query de claim aceita. Fora daqui, nada é reivindicável.
 *
 * `WAITING` NÃO está na lista, e é isso que faz dependência humana e
 * condição externa não consumirem execução: elas ficam visíveis na fila,
 * mas nenhum worker as pega.
 */
export const ESTADOS_REIVINDICAVEIS: EstadoDoJob[] = ['PENDING', 'FAILED_RETRYABLE', 'RUNNING']

/**
 * Índices que a migration cria, derivados das queries REAIS.
 *
 * Declarados aqui para o teste conferir que schema e uso não se afastam —
 * um índice que ninguém consulta é custo de escrita sem retorno, e uma
 * query sem índice é varredura silenciosa.
 */
export const INDICES_ESPERADOS = {
  /** Idempotência + busca da chave em `inserirOuReencontrar`. */
  idempotencia: ['workspaceId', 'chave'],
  /** Claim, ramos PENDING e FAILED_RETRYABLE. */
  claim: ['workspaceId', 'estado', 'proximaTentativaEm'],
  /** Claim, ramo de recuperação de job abandonado. */
  heartbeat: ['workspaceId', 'estado', 'heartbeatAt'],
} as const

/**
 * TESTES OBRIGATÓRIOS DEPOIS DA MIGRATION.
 *
 * O adaptador em memória reproduz a unique e o SKIP LOCKED, mas quem
 * garante concorrência de verdade é o Postgres. Estes são os primeiros
 * testes a escrever quando a tabela existir — ficam declarados aqui para
 * não virarem intenção esquecida.
 */
export const TESTES_POS_MIGRATION = [
  'Dois workers concorrentes no MESMO workspace: nenhum job entregue duas vezes.',
  'FOR UPDATE SKIP LOCKED: cada worker leva uma linha diferente, ninguém bloqueia ninguém.',
  'Cada job termina com um único workerId; claimedAt e heartbeatAt coerentes.',
  'Workers de workspaces A e B simultâneos: cada um só enxerga a própria fila.',
  'Job RUNNING sem heartbeat além do timeout volta a ser reivindicável.',
  'WAITING nunca é entregue pelo claim, mesmo sob concorrência.',
  'Unique (workspaceId, chave) recusa a segunda inserção sob corrida real.',
] as const
