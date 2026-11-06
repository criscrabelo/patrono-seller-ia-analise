/**
 * P2.2 — Trabalhos longos: os que passam do limite de uma função síncrona.
 *
 * ── POR QUE EXISTE ──────────────────────────────────────────────────────
 * Na Netlify Free, função síncrona é encerrada aos 30 s (medido na P2.1:
 * `Task timed out after 30.00 seconds`, inclusive fora do Next.js). Quatro
 * rotas esperam provedores externos por mais que isso: legenda (fal.ai),
 * publicação (Instagram), publicação agendada e envio de WhatsApp. Elas
 * passam a REGISTRAR o trabalho e responder na hora; uma Background
 * Function (até 15 min) executa, e a tela consulta o andamento — o mesmo
 * padrão "processando + consulta posterior" que o vídeo já usava.
 *
 * ── ONDE O ESTADO MORA ──────────────────────────────────────────────────
 * Na `AutomationJob`, sem migration. A unique `(workspaceId, chave)` é a
 * idempotência: o mesmo pedido reencontra o mesmo trabalho. Os tipos têm o
 * prefixo `LONGO_` e NUNCA entram na fila genérica do executor:
 *   - PENDING nasce com `workerId = RESERVA`, e o claim genérico só pega
 *     PENDING com `workerId IS NULL`;
 *   - FAILED_RETRYABLE fica com `proximaTentativaEm = null`, que o claim
 *     genérico também ignora;
 *   - RUNNING renova heartbeat; sem ele por 5 min, o pior que o executor
 *     genérico faz é mover para WAITING (tipo sem ação registrada).
 *
 * ── AS QUATRO SAÍDAS DE UMA EXECUÇÃO ────────────────────────────────────
 *   concluido → SUCCEEDED. Repetir o pedido devolve o mesmo resultado.
 *   continuar → PENDING. Nada ambíguo aconteceu; retomar é seguro.
 *   falhou    → FAILED_RETRYABLE. O provider RECUSOU (ou nada saiu daqui):
 *               repetir é seguro, mas só acontece a pedido — nunca sozinho.
 *   incerto   → WAITING + EXIGE_HUMANO. O provider pode ter executado e
 *               não houve confirmação. NUNCA é repetido automaticamente:
 *               repetir às cegas é como nasce a publicação duplicada.
 *
 * Exceção não tratada dentro de um executor vira `incerto`, não `falhou`:
 * quem não sabe o que aconteceu não pode presumir que nada aconteceu.
 *
 * ── DOIS MODOS ──────────────────────────────────────────────────────────
 * `TRABALHO_LONGO_MODO=segundo-plano` (Netlify): a rota dispara a
 * Background Function e devolve 202. Ausente (Vercel, local): a rota
 * executa o MESMO executor dentro da requisição, com orçamento que cabe no
 * `maxDuration`, e devolve a resposta de sempre. Um caminho só de código.
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { prisma } from './prisma'
// Só o heartbeat: `executor-da-fila` arrastaria a fábrica e o orquestrador
// para o pacote da Background Function sem necessidade.
import { renovarHeartbeat, portaDosTrabalhosLongos as porta } from './automation-queue-prisma'
import { validarEntidadeDaAutomacao } from './automation-queue-entidades'

// ── Tipos e constantes ──────────────────────────────────────────────────

export const TIPOS_DE_TRABALHO_LONGO = [
  'LONGO_LEGENDA_VIDEO',
  'LONGO_PUBLICAR_INSTAGRAM',
  'LONGO_ENVIO_WHATSAPP',
  // P2.17.12: vídeo do modo assistido (FFmpeg local, gratuito).
  'LONGO_RENDER_VIDEO',
] as const
export type TipoDeTrabalhoLongo = (typeof TIPOS_DE_TRABALHO_LONGO)[number]

export function ehTrabalhoLongo(tipo: string): tipo is TipoDeTrabalhoLongo {
  return (TIPOS_DE_TRABALHO_LONGO as readonly string[]).includes(tipo)
}

/** `workerId` de um trabalho PENDING: invisível para o claim genérico. */
export const RESERVA_DO_SEGUNDO_PLANO = 'segundo-plano:aguardando'

/** Limite medido na P2.1 para função síncrona na Netlify Free. */
export const LIMITE_SINCRONO_OBSERVADO_MS = 30_000

/** Dentro da requisição (Vercel `maxDuration = 60`): sobra margem. */
export const ORCAMENTO_NA_REQUISICAO_MS = 45_000

/** Background Function vive 15 min; o trabalho para antes, e retoma. */
export const ORCAMENTO_EM_SEGUNDO_PLANO_MS = 12 * 60_000

/** Quantas vezes um trabalho pode se reencadear sozinho em segundo plano. */
export const MAXIMO_DE_ENCADEAMENTOS = 6

/** Sem heartbeat por este tempo, a execução é considerada interrompida. */
export const HEARTBEAT_VENCIDO_MS = 5 * 60_000

/** Caminho da Background Function (nome do arquivo + sufixo `-background`). */
export const CAMINHO_DA_FUNCAO = '/.netlify/functions/trabalho-longo-background'

export const MOTIVO_HUMANO_DO_INCERTO = 'PROVIDER_OUTCOME_UNCONFIRMED'

export type ModoDeExecucao = 'segundo-plano' | 'na-requisicao'

export function modoDeExecucao(env: Record<string, string | undefined> = process.env): ModoDeExecucao {
  return env.TRABALHO_LONGO_MODO === 'segundo-plano' ? 'segundo-plano' : 'na-requisicao'
}

/** O que a rota devolveria se tivesse feito tudo dentro da requisição. */
export interface RespostaDoTrabalho {
  status: number
  corpo: Record<string, unknown>
}

export type Desfecho =
  | { fim: 'concluido'; resposta: RespostaDoTrabalho }
  | { fim: 'continuar'; resposta: RespostaDoTrabalho }
  | { fim: 'falhou'; resposta: RespostaDoTrabalho; erro: string }
  | { fim: 'incerto'; resposta: RespostaDoTrabalho; erro: string }

export interface TrabalhoEmExecucao {
  id: string
  workspaceId: string
  tipo: TipoDeTrabalhoLongo
  entityId: string
  /** Contexto vivo: o executor lê e grava progresso aqui via `salvar`. */
  contexto: Record<string, unknown>
}

export interface Execucao {
  trabalho: TrabalhoEmExecucao
  /**
   * Grava progresso NO BANCO antes de seguir. Tudo o que torna a retomada
   * segura — id do container, id do pedido no fal.ai, números já
   * enviados — passa por aqui ANTES do próximo passo externo.
   */
  salvar(parcial: Record<string, unknown>): Promise<void>
  restanteMs(): number
  dormir(ms: number): Promise<void>
}

export type ExecutorDeTrabalho = (e: Execucao) => Promise<Desfecho>

export interface LinhaDoTrabalho {
  id: string
  workspaceId: string
  tipo: string
  chave: string
  estado: string
  entityId: string
  contexto: Record<string, unknown> | null
  heartbeatAt: Date | null
  updatedAt: Date
}

// ── Assinatura do disparo ───────────────────────────────────────────────

/**
 * A Background Function é uma URL pública. Ela só aceita um `jobId`
 * assinado com o NEXTAUTH_SECRET do próprio ambiente — e, mesmo com a
 * assinatura, só executa o que já está PENDING e reservado no banco.
 */
export function assinarDisparo(jobId: string, segredo = process.env.NEXTAUTH_SECRET): string {
  if (!segredo) throw new Error('NEXTAUTH_SECRET ausente: o disparo em segundo plano não pode ser assinado.')
  return createHmac('sha256', segredo).update(`trabalho-longo:${jobId}`).digest('base64url')
}

export function disparoAutentico(jobId: unknown, assinatura: unknown, segredo = process.env.NEXTAUTH_SECRET): boolean {
  if (typeof jobId !== 'string' || typeof assinatura !== 'string' || !jobId || !segredo) return false
  const esperada = Buffer.from(assinarDisparo(jobId, segredo))
  const recebida = Buffer.from(assinatura)
  return esperada.length === recebida.length && timingSafeEqual(esperada, recebida)
}

/** Dispara a Background Function. Nunca lança: falha deixa o trabalho PENDING. */
export async function dispararEmSegundoPlano(
  jobId: string,
  origem: string,
  enviar: typeof fetch = fetch
): Promise<boolean> {
  try {
    const r = await enviar(new URL(CAMINHO_DA_FUNCAO, origem).toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId, assinatura: assinarDisparo(jobId) }),
      signal: AbortSignal.timeout(10_000),
    })
    // Background Function responde 202 na hora; o trabalho segue lá.
    return r.status === 202 || r.ok
  } catch (e) {
    console.error(`[trabalho-longo] disparo do ${jobId} falhou; fica PENDING para a próxima consulta:`, e instanceof Error ? e.message : e)
    return false
  }
}

/** Renova o heartbeat enquanto o trabalho roda — só se ESTE worker ainda for o dono. */
async function comBatimento<T>(jobId: string, workerId: string, trabalho: () => Promise<T>, intervaloMs = 30_000): Promise<T> {
  const timer = setInterval(() => {
    renovarHeartbeat(jobId, workerId, new Date()).catch((e) =>
      console.error(`[trabalho-longo] heartbeat do ${jobId} falhou:`, e instanceof Error ? e.message : e)
    )
  }, intervaloMs)
  try {
    return await trabalho()
  } finally {
    clearInterval(timer)
  }
}

// ── Persistência ────────────────────────────────────────────────────────

function linha(j: {
  id: string; workspaceId: string; tipo: string; chave: string; estado: string; entityId: string
  contexto: unknown; heartbeatAt: Date | null; updatedAt: Date
}): LinhaDoTrabalho {
  return { ...j, contexto: (j.contexto as Record<string, unknown> | null) ?? null }
}

async function buscarPorChave(workspaceId: string, chave: string): Promise<LinhaDoTrabalho | null> {
  const j = await prisma.automationJob.findUnique({ where: { workspaceId_chave: { workspaceId, chave } } })
  return j ? linha(j) : null
}

export async function buscarTrabalho(id: string): Promise<LinhaDoTrabalho | null> {
  const j = await prisma.automationJob.findUnique({ where: { id } })
  return j && ehTrabalhoLongo(j.tipo) ? linha(j) : null
}

/** Devolve PENDING reservado. Só a partir de um estado em que retomar é seguro. */
async function reservar(
  id: string,
  de: string,
  contexto: Record<string, unknown>,
  heartbeatAntesDe?: Date
): Promise<boolean> {
  return porta.mudarSeEstado(
    id,
    de,
    {
      estado: 'PENDING',
      workerId: RESERVA_DO_SEGUNDO_PLANO,
      classe: 'TENTANDO',
      motivoHumano: null,
      proximaTentativaEm: null,
      claimedAt: null,
      contexto: contexto as never,
    },
    heartbeatAntesDe
  )
}

// ── Início ──────────────────────────────────────────────────────────────

export interface ResultadoDoInicio {
  trabalhoId: string
  estado: string
  resposta: RespostaDoTrabalho
}

function respostaDeProcessando(trabalhoId: string, mensagem: string): RespostaDoTrabalho {
  return { status: 202, corpo: { ok: false, processando: true, trabalhoId, mensagem } }
}

/**
 * Registra (ou reencontra) o trabalho e o põe para andar.
 *
 * Mesma chave = mesmo trabalho. O que já CONCLUIU devolve o mesmo
 * resultado; o que está INCERTO não roda de novo; o que está rodando não
 * ganha uma segunda execução. Só PENDING, FAILED_RETRYABLE e RUNNING com
 * heartbeat vencido voltam a andar.
 */
export async function iniciarTrabalhoLongo(params: {
  workspaceId: string
  tipo: TipoDeTrabalhoLongo
  chave: string
  entityType: string
  entityId: string
  /** Parâmetros do pedido. Mesclados por cima do contexto numa nova tentativa. */
  contexto: Record<string, unknown>
  executor: ExecutorDeTrabalho
  /** Base para o disparo: a origem da própria requisição. */
  origem: string
  mensagemDeProcessando: string
  modo?: ModoDeExecucao
  orcamentoMs?: number
  agora?: Date
  enviar?: typeof fetch
  /** Só para teste: espera sem relógio real. */
  dormir?: (ms: number) => Promise<void>
}): Promise<ResultadoDoInicio> {
  const modo = params.modo ?? modoDeExecucao()
  const agora = params.agora ?? new Date()
  const contextoInicial = { ...params.contexto, origem: params.origem }

  let job = await buscarPorChave(params.workspaceId, params.chave)
  if (!job) {
    // Nenhum job entra na fila sem a entidade confirmada NESTE workspace.
    const entidade = await validarEntidadeDaAutomacao({
      workspaceId: params.workspaceId,
      entityType: params.entityType,
      entityId: params.entityId,
    })
    if (!entidade.ok) throw new Error(`Trabalho recusado: ${entidade.explicacao}`)
    try {
      const criado = await porta.inserir({
          workspaceId: params.workspaceId,
          tipo: params.tipo,
          chave: params.chave,
          estado: 'PENDING',
          classe: 'TENTANDO',
          entityType: params.entityType,
          entityId: params.entityId,
          contexto: contextoInicial as never,
          workerId: RESERVA_DO_SEGUNDO_PLANO,
      })
      job = linha(criado)
    } catch {
      // Dois pedidos simultâneos: a unique escolheu um. Reencontra.
      job = await buscarPorChave(params.workspaceId, params.chave)
      if (!job) throw new Error('Não foi possível registrar o trabalho.')
    }
  } else if (job.tipo !== params.tipo) {
    throw new Error(`A chave ${params.chave} já pertence a outro tipo de trabalho.`)
  }

  const contextoAtual = job.contexto ?? {}

  if (job.estado === 'FAILED_RETRYABLE') {
    // O provider recusou da última vez — nada saiu. Repetir A PEDIDO é seguro.
    // O pedido novo ganha de volta a cota de reencadeamentos.
    await reservar(job.id, 'FAILED_RETRYABLE', { ...contextoAtual, ...contextoInicial, encadeamentos: 0 })
  } else if (job.estado === 'RUNNING') {
    const vencido = !job.heartbeatAt || agora.getTime() - job.heartbeatAt.getTime() > HEARTBEAT_VENCIDO_MS
    if (!vencido) {
      return { trabalhoId: job.id, estado: job.estado, resposta: respostaDeProcessando(job.id, params.mensagemDeProcessando) }
    }
    // A execução anterior morreu no meio. O executor decide, pelo progresso
    // gravado, se retomar é seguro — ou se o desfecho virou incerto.
    await reservar(job.id, 'RUNNING', { ...contextoAtual, interrompido: true }, new Date(agora.getTime() - HEARTBEAT_VENCIDO_MS))
  } else if (job.estado !== 'PENDING') {
    // SUCCEEDED, WAITING (incerto), FAILED_FINAL, CANCELLED: não roda de novo.
    return {
      trabalhoId: job.id,
      estado: job.estado,
      resposta: (contextoAtual.resposta as RespostaDoTrabalho | undefined) ?? {
        status: 409,
        corpo: { error: 'Este pedido já foi tratado e não será repetido automaticamente.', trabalhoId: job.id },
      },
    }
  }

  if (modo === 'segundo-plano') {
    await dispararEmSegundoPlano(job.id, params.origem, params.enviar)
    return { trabalhoId: job.id, estado: 'PENDING', resposta: respostaDeProcessando(job.id, params.mensagemDeProcessando) }
  }

  const r = await executarTrabalhoLongo(job.id, {
    executores: { [params.tipo]: params.executor },
    orcamentoMs: params.orcamentoMs ?? ORCAMENTO_NA_REQUISICAO_MS,
    modo,
    dormir: params.dormir,
  })
  if (!r) {
    // Outro pedido pegou a execução entre a leitura e o claim.
    return { trabalhoId: job.id, estado: 'RUNNING', resposta: respostaDeProcessando(job.id, params.mensagemDeProcessando) }
  }
  return r
}

// ── Execução ────────────────────────────────────────────────────────────

const ESTADO_DO_DESFECHO = {
  concluido: { estado: 'SUCCEEDED', classe: 'AUTOMATIZAVEL' },
  continuar: { estado: 'PENDING', classe: 'TENTANDO' },
  falhou: { estado: 'FAILED_RETRYABLE', classe: 'TENTANDO' },
  incerto: { estado: 'WAITING', classe: 'EXIGE_HUMANO' },
} as const

/**
 * Executa UMA vez: reivindica atomicamente, roda o executor com heartbeat
 * e grava o desfecho. Devolve `null` se o trabalho não estava disponível
 * (outro worker o tem, ou ele já terminou) — é isso que torna o disparo
 * duplicado inofensivo.
 */
export async function executarTrabalhoLongo(
  jobId: string,
  opcoes: {
    executores: Partial<Record<TipoDeTrabalhoLongo, ExecutorDeTrabalho>>
    orcamentoMs: number
    modo?: ModoDeExecucao
    workerId?: string
    enviar?: typeof fetch
    intervaloDeHeartbeatMs?: number
    /** Só para teste: espera sem relógio real. */
    dormir?: (ms: number) => Promise<void>
  }
): Promise<ResultadoDoInicio | null> {
  const workerId = opcoes.workerId ?? `segundo-plano:${randomUUID()}`
  const inicio = Date.now()

  if (!(await porta.reivindicar(jobId, RESERVA_DO_SEGUNDO_PLANO, workerId))) return null

  const job = await buscarTrabalho(jobId)
  if (!job) return null
  const contexto: Record<string, unknown> = { ...(job.contexto ?? {}) }
  const executor = opcoes.executores[job.tipo as TipoDeTrabalhoLongo]

  const salvar = async (parcial: Record<string, unknown>) => {
    Object.assign(contexto, parcial)
    const dono = await porta.escreverComoDono(jobId, workerId, { contexto: contexto as never, heartbeatAt: new Date() })
    if (!dono) throw new Error('A execução perdeu a posse do trabalho.')
  }

  let desfecho: Desfecho
  if (!executor) {
    desfecho = {
      fim: 'falhou',
      erro: `Nenhum executor registrado para ${job.tipo}.`,
      resposta: { status: 500, corpo: { error: 'Trabalho sem executor neste ambiente.' } },
    }
  } else {
    desfecho = await comBatimento(
      jobId,
      workerId,
      () =>
        executor({
          trabalho: { id: job.id, workspaceId: job.workspaceId, tipo: job.tipo as TipoDeTrabalhoLongo, entityId: job.entityId, contexto },
          salvar,
          restanteMs: () => opcoes.orcamentoMs - (Date.now() - inicio),
          dormir: opcoes.dormir ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
        }).catch((e): Desfecho => {
          const erro = e instanceof Error ? e.message : String(e)
          console.error(`[trabalho-longo] ${job.tipo} ${jobId} lançou — tratado como INCERTO:`, erro)
          return {
            fim: 'incerto',
            erro,
            resposta: {
              status: 500,
              corpo: {
                error: 'O trabalho foi interrompido por um erro inesperado. Confira o resultado antes de pedir de novo.',
                incerto: true,
                trabalhoId: jobId,
              },
            },
          }
        }),
      opcoes.intervaloDeHeartbeatMs
    )
  }

  const destino = ESTADO_DO_DESFECHO[desfecho.fim]
  const encadeamentos = Number(contexto.encadeamentos ?? 0)
  const reencadear =
    desfecho.fim === 'continuar' &&
    (opcoes.modo ?? modoDeExecucao()) === 'segundo-plano' &&
    encadeamentos < MAXIMO_DE_ENCADEAMENTOS &&
    typeof contexto.origem === 'string'

  // `interrompido` vale para UMA retomada: quem a tratou já gravou o que importava.
  const { interrompido: _, ...semMarca } = contexto
  const contextoFinal = {
    ...semMarca,
    resposta: desfecho.fim === 'continuar' ? { ...desfecho.resposta, corpo: { ...desfecho.resposta.corpo, trabalhoId: jobId } } : desfecho.resposta,
    ...(reencadear ? { encadeamentos: encadeamentos + 1 } : {}),
  }

  await porta.escreverComoDono(jobId, workerId, {
      estado: destino.estado,
      classe: destino.classe,
      motivoHumano: desfecho.fim === 'incerto' ? MOTIVO_HUMANO_DO_INCERTO : null,
      ultimoErro: 'erro' in desfecho ? desfecho.erro.slice(0, 2000) : null,
      contexto: contextoFinal as never,
      workerId: desfecho.fim === 'continuar' ? RESERVA_DO_SEGUNDO_PLANO : null,
      proximaTentativaEm: null,
      resolvidoEm: desfecho.fim === 'concluido' || desfecho.fim === 'incerto' ? new Date() : null,
      heartbeatAt: new Date(),
  })

  if (reencadear) await dispararEmSegundoPlano(jobId, contexto.origem as string, opcoes.enviar)

  return { trabalhoId: jobId, estado: destino.estado, resposta: contextoFinal.resposta as RespostaDoTrabalho }
}

// ── Consulta ────────────────────────────────────────────────────────────

export interface SituacaoDoTrabalho {
  trabalhoId: string
  tipo: string
  estado: string
  terminado: boolean
  resposta: RespostaDoTrabalho | null
  atualizadoEm: string
}

/**
 * O que a tela consulta. Escopado por workspace: o id sozinho não abre
 * trabalho de outro negócio. Se o trabalho está PENDING há mais de 30 s em
 * segundo plano, o disparo pode ter se perdido — dispara de novo (o claim
 * atômico torna o disparo duplicado inofensivo).
 */
export async function situacaoDoTrabalho(params: {
  workspaceId: string
  trabalhoId: string
  origem: string
  /**
   * Fora da Netlify não há Background Function: a própria consulta da tela
   * faz o trabalho PENDING andar mais um trecho, dentro do orçamento da
   * requisição. É o "processando + consulta posterior" de antes, sem clique.
   */
  executores?: Partial<Record<TipoDeTrabalhoLongo, ExecutorDeTrabalho>>
  modo?: ModoDeExecucao
  agora?: Date
  enviar?: typeof fetch
}): Promise<SituacaoDoTrabalho | null> {
  const modo = params.modo ?? modoDeExecucao()
  let j = await prisma.automationJob.findFirst({ where: { id: params.trabalhoId, workspaceId: params.workspaceId } })
  if (!j || !ehTrabalhoLongo(j.tipo)) return null
  const agora = params.agora ?? new Date()

  // P2.27: execução que morreu no meio (RUNNING sem heartbeat) é retomada pela consulta da tela, com
  // `interrompido: true` — o executor decide, pelo progresso gravado, se retomar é seguro ou se virou incerto.
  if (j.estado === 'RUNNING' && (!j.heartbeatAt || agora.getTime() - j.heartbeatAt.getTime() > HEARTBEAT_VENCIDO_MS)) {
    const contextoAtual = (j.contexto as Record<string, unknown> | null) ?? {}
    await reservar(j.id, 'RUNNING', { ...contextoAtual, interrompido: true }, new Date(agora.getTime() - HEARTBEAT_VENCIDO_MS))
    j = (await prisma.automationJob.findFirst({ where: { id: params.trabalhoId, workspaceId: params.workspaceId } })) ?? j
  }

  if (j.estado === 'PENDING') {
    if (modo === 'segundo-plano') {
      if (agora.getTime() - j.updatedAt.getTime() > 30_000) await dispararEmSegundoPlano(j.id, params.origem, params.enviar)
    } else if (params.executores) {
      await executarTrabalhoLongo(j.id, { executores: params.executores, orcamentoMs: ORCAMENTO_NA_REQUISICAO_MS, modo })
      j = (await prisma.automationJob.findFirst({ where: { id: params.trabalhoId, workspaceId: params.workspaceId } })) ?? j
    }
  }
  const contexto = (j.contexto as Record<string, unknown> | null) ?? {}

  return {
    trabalhoId: j.id,
    tipo: j.tipo,
    estado: j.estado,
    terminado: j.estado !== 'PENDING' && j.estado !== 'RUNNING',
    resposta: (contexto.resposta as RespostaDoTrabalho | undefined) ?? null,
    atualizadoEm: j.updatedAt.toISOString(),
  }
}
