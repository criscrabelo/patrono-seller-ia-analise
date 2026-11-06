/**
 * Patrono Generation Worker (Rodada 8, regra 10) — processo separado do
 * servidor web, feito para rodar numa máquina local ou servidor
 * compatível. Nunca dentro de uma requisição HTTP (Vercel não é lugar
 * para workload longo de IA).
 *
 * Uso:
 *   DATABASE_URL=... npx tsx worker/digital-twin-worker.ts            # loop contínuo
 *   DATABASE_URL=... npx tsx worker/digital-twin-worker.ts --once     # processa no máximo 1 job e sai (usado em teste manual)
 *
 * A instalação automatizada fica em setup-digital-twin-worker.ps1 /
 * start-digital-twin-worker.ps1 (Windows) — a proprietária nunca precisa
 * abrir terminal no dia a dia depois da instalação inicial.
 */

import { randomUUID } from 'crypto'
import { PrismaClient } from '@prisma/client'
import {
  reivindicarProximoJob,
  renovarHeartbeat,
  completarJob,
  falharJob,
  STALE_TIMEOUT_MS_PADRAO,
} from '../lib/digital-twin-job-queue'
import { processarJobDeVerdade, detectarCapacidadesDeGeracao, type JobDeProducao } from '../lib/digital-twin-worker-core'
import { detectarCapacidadesRuntime } from '../lib/digital-twin-runtime'
import { REQUIRED_WORKER_VERSION } from '../lib/digital-twin-worker-version'
import { verificarTokenWorker } from '../lib/digital-twin-worker-token'
import { comReconexao, classificarErroDeBanco, calcularEsperaBackoff, type TentativaReconexao } from '../lib/db-resiliencia'
import { adquirirLock, liberarLock, caminhoDoLock, chaveDoLock, processoVivoReal } from '../lib/worker-lock'
import { avaliarMemoriaParaJobPesado } from '../lib/worker-memoria'
import { freemem } from 'os'

const WORKER_ID = process.env.DIGITAL_TWIN_WORKER_ID || `worker-${randomUUID().slice(0, 8)}`
const HEARTBEAT_INTERVAL_MS = 30_000
const POLL_INTERVAL_MS = 5_000
/**
 * De quanto em quanto tempo o worker renova `GenerationWorkerHealth.lastSeenAt`.
 * Precisa ser bem menor que a janela de 5 min que a tela usa para dizer
 * "processador conectado" — antes disso a saúde só era gravada UMA vez, no
 * startup, e um worker rodando há mais de 5 minutos aparecia como
 * "nenhum conectado" mesmo processando jobs normalmente.
 */
const HEALTH_REFRESH_MS = 60_000

/**
 * Reconexão ao banco (Rodada 10.2). Base 2s, teto 60s: uma queda curta se
 * resolve em segundos, e uma longa fica batendo de minuto em minuto sem
 * martelar o pooler.
 *
 * `maxTentativas: 0` (sem limite) no LOOP residente é deliberado — desistir
 * depois de N tentativas reproduziria o defeito que originou esta rodada: o
 * worker morreu por um ConnectionReset e ficou 8 horas fora do ar. No
 * STARTUP o limite é finito: ali um banco inalcançável quase sempre é
 * ambiente errado, e é melhor falhar alto e cedo.
 */
const BACKOFF_BASE_MS = 2_000
const BACKOFF_MAX_MS = 60_000
const MAX_TENTATIVAS_STARTUP = 5

const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

const depsReconexao = (maxTentativas: number) => ({
  maxTentativas,
  baseMs: BACKOFF_BASE_MS,
  maxMs: BACKOFF_MAX_MS,
  esperar,
  aoRetentar: ({ tentativa, motivo, proximaEsperaMs }: TentativaReconexao) => {
    console.warn(
      `[digital-twin-worker] banco indisponível (tentativa ${tentativa}${maxTentativas > 0 ? `/${maxTentativas}` : ''}): ${motivo}. Nova tentativa em ${Math.round(proximaEsperaMs / 1000)}s.`
    )
  },
  aoRecuperar: (tentativasGastas: number) => {
    console.log(`[digital-twin-worker] conexão com o banco restabelecida após ${tentativasGastas} tentativa(s). Retomando o polling.`)
  },
})
const MAX_TENTATIVAS = 3 // regra 31: máximo 2-3 tentativas automáticas

const prisma = new PrismaClient()

/**
 * Pairing (Rodada 9, regras 21-22): o worker se autentica com um token
 * PRÓPRIO (nunca a senha da usuária), escopado a um único workspace.
 * `DIGITAL_TWIN_WORKER_TOKEN` nunca é logado — só o resultado da
 * verificação (workspaceId).
 */
async function resolverWorkspacePareado(): Promise<string | null> {
  const token = process.env.DIGITAL_TWIN_WORKER_TOKEN
  if (!token) return null
  const resultado = await verificarTokenWorker(token)
  return resultado?.workspaceId ?? null
}

async function registrarSaudeWorker() {
  const caps = await detectarCapacidadesRuntime()
  await prisma.generationWorkerHealth.upsert({
    where: { workerId: WORKER_ID },
    create: {
      workerId: WORKER_ID,
      online: true,
      gpuDetected: caps.gpuDetected,
      gpuName: caps.gpuName,
      vramGB: caps.vramGB,
      version: REQUIRED_WORKER_VERSION,
      lastSeenAt: new Date(),
    },
    update: { online: true, gpuDetected: caps.gpuDetected, gpuName: caps.gpuName, vramGB: caps.vramGB, lastSeenAt: new Date() },
  })
}

/**
 * Texto falado pela prévia — vem do PRÓPRIO job, pelo `Conteudo` ligado em
 * `DigitalTwinJob.contentId`, nunca de uma frase fixa no código. Enquanto a
 * frase era constante (`'Confira o preço atual.'`), toda prévia saía com o
 * mesmo áudio de 2,5s: impossível avaliar a voz num texto de verdade e
 * impossível gerar duas prévias diferentes.
 *
 * `narracao` é o campo do que é FALADO; `roteiro` é o fallback natural. As
 * legendas de rede social não entram: são texto para ler na tela, com
 * hashtags e emojis que não se narra.
 */
async function textoFaladoDoJob(contentId: string | null): Promise<string | null> {
  if (!contentId) return null
  const conteudo = await prisma.conteudo.findUnique({
    where: { id: contentId },
    select: { narracao: true, roteiro: true },
  })
  return conteudo?.narracao?.trim() || conteudo?.roteiro?.trim() || null
}

async function processarUmJob(workspaceIdPareado: string | null): Promise<boolean> {
  const job = await reivindicarProximoJob(WORKER_ID, STALE_TIMEOUT_MS_PADRAO, prisma, workspaceIdPareado ?? undefined)
  if (!job) return false

  const heartbeat = setInterval(() => {
    renovarHeartbeat(job.id, WORKER_ID, prisma).catch(() => {})
  }, HEARTBEAT_INTERVAL_MS)

  try {
    // jobType, resultAssetId (entrada de áudio/vídeo já gerado por uma etapa
    // anterior) e agora também o TEXTO FALADO vêm de verdade do
    // `DigitalTwinJob` — o texto pelo `Conteudo` ligado em `contentId`.
    // Sem texto no job, `gerarPreviaDeVoz()` cai no `TEXTO_PREVIA_VOZ`
    // padrão do próprio pipeline; o worker não inventa frase nenhuma.
    const textoFalado = await textoFaladoDoJob(job.contentId)
    const resultado = await processarJobDeVerdade({
      id: job.id,
      workspaceId: job.workspaceId,
      profileId: job.profileId,
      jobType: job.jobType as JobDeProducao['jobType'],
      mediaAssetUrl: job.resultAssetId ?? '',
      overlayTexto: 'Patrono',
      legenda: textoFalado ?? '',
      contentId: job.contentId,
    })

    if (resultado.sucesso && resultado.contentUrl) {
      await completarJob(job.id, WORKER_ID, resultado.contentUrl, prisma)
    } else {
      await falharJob(job.id, WORKER_ID, resultado.motivo, MAX_TENTATIVAS, prisma)
    }
  } catch (e) {
    await falharJob(job.id, WORKER_ID, e instanceof Error ? e.message : 'Erro desconhecido', MAX_TENTATIVAS, prisma)
  } finally {
    clearInterval(heartbeat)
  }
  return true
}

async function main() {
  const modoUnico = process.argv.includes('--once')
  // Startup com retentativa LIMITADA: se o banco não responde nem no começo,
  // costuma ser ambiente errado — melhor falhar alto depois de algumas
  // tentativas do que ficar girando em silêncio na tarefa do logon.
  await comReconexao(() => registrarSaudeWorker(), depsReconexao(MAX_TENTATIVAS_STARTUP))
  const capacidades = await detectarCapacidadesDeGeracao()

  const workspaceIdPareado = await comReconexao(() => resolverWorkspacePareado(), depsReconexao(MAX_TENTATIVAS_STARTUP))
  if (process.env.DIGITAL_TWIN_WORKER_TOKEN && !workspaceIdPareado) {
    console.error('[digital-twin-worker] Token inválido/revogado — o worker não vai reivindicar nenhum job. Gere um novo token em Configurações → Digital Twin.')
    await prisma.$disconnect()
    process.exit(1)
  }

  // Lock escopado por (destino do banco, workspace pareado): dois negócios
  // distintos podem rodar workers próprios na mesma máquina sem se bloquear.
  // A chave é um hash — a URL crua traz a senha do banco e nunca pode virar
  // nome de arquivo no disco.
  const caminhoLock = caminhoDoLock(chaveDoLock(process.env.DATABASE_URL ?? '', workspaceIdPareado))

  console.log(
    `[digital-twin-worker] ${WORKER_ID} iniciado. Chatterbox=${capacidades.chatterboxDisponivel} MuseTalk=${capacidades.musetalkDisponivel} Runtime=${capacidades.runtimeClasse} Pareado=${workspaceIdPareado ? 'sim' : 'não (sem escopo — só para desenvolvimento)'}`
  )

  if (modoUnico) {
    // `--once` NÃO toma o lock de propósito: é ferramenta de diagnóstico
    // manual, roda uma vez e sai. Só avisa se houver residente ativo, para
    // quem estiver depurando saber que os dois podem competir por CPU.
    const residente = adquirirLock(caminhoLock, process.pid, WORKER_ID, { processoVivo: processoVivoReal, agora: new Date() })
    if (!residente.adquirido) {
      console.warn(`[digital-twin-worker] --once: ${residente.mensagem} Seguindo mesmo assim (modo manual).`)
    } else {
      liberarLock(caminhoLock, process.pid)
    }
    const processou = await processarUmJob(workspaceIdPareado)
    console.log(`[digital-twin-worker] --once: ${processou ? 'processou 1 job' : 'nenhum job na fila'}`)
    await prisma.$disconnect()
    return
  }

  // ── Trava de worker residente duplicado (Rodada 12) ───────────────────
  // Com o restart automático do Task Scheduler, um worker que demore a
  // morrer pode coexistir com o que o Windows acabou de subir. Dois
  // residentes no mesmo destino brigam pela RAM do Chatterbox numa máquina
  // CPU_ONLY. Isto NÃO substitui o SKIP LOCKED: aquele impede dois workers
  // de pegarem o mesmo JOB; este impede dois PROCESSOS no mesmo destino.
  const lock = adquirirLock(caminhoLock, process.pid, WORKER_ID, { processoVivo: processoVivoReal, agora: new Date() })
  if (!lock.adquirido) {
    // Saída LIMPA (código 0): não é erro. Se saísse com código 1, o Task
    // Scheduler trataria como falha e ficaria reiniciando em laço.
    console.log(`[digital-twin-worker] ${lock.mensagem}`)
    await prisma.$disconnect()
    process.exit(0)
  }
  console.log(`[digital-twin-worker] lock adquirido (${lock.motivo}). ${lock.mensagem}`)

  const soltarLock = () => {
    liberarLock(caminhoLock, process.pid)
  }
  process.on('exit', soltarLock)
  for (const sinal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(sinal, () => {
      soltarLock()
      process.exit(0)
    })
  }

  // Loop contínuo — processo de longa duração, nunca dentro de um request HTTP.
  // A saúde é renovada periodicamente aqui: sem isso `lastSeenAt` ficava
  // congelado no horário do startup e a tela passava a mentir "nenhum
  // processador conectado" depois de 5 minutos de worker no ar.
  //
  // HEARTBEAT HONESTO: quando o banco cai, esta escrita falha e o
  // `lastSeenAt` PARA de avançar — é exatamente o que a tela precisa para
  // dizer "nenhum processador conectado" em vez de mentir. Nada aqui grava
  // um estado otimista de fora do banco. O `catch` só evita derrubar o
  // processo por causa do timer; a falha é registrada (uma vez por queda,
  // para não inundar o log) em vez de ser engolida como antes.
  let saudeFalhando = false
  const renovarSaude = setInterval(() => {
    registrarSaudeWorker()
      .then(() => {
        if (saudeFalhando) {
          saudeFalhando = false
          console.log('[digital-twin-worker] heartbeat voltou a ser gravado.')
        }
      })
      .catch((e) => {
        if (!saudeFalhando) {
          saudeFalhando = true
          console.warn(
            `[digital-twin-worker] heartbeat NÃO gravado: ${classificarErroDeBanco(e).motivo}. A tela vai mostrar "nenhum processador conectado" até voltar — e isso está correto.`
          )
        }
      })
  }, HEALTH_REFRESH_MS)
  renovarSaude.unref?.()

  // Loop residente. Uma falha TRANSITÓRIA de conexão não mata mais o
  // processo: espera com backoff e volta ao polling. Erro fatal (credencial,
  // banco inexistente, string inválida) continua derrubando o worker na
  // hora, alto — nunca engolido.
  let falhasSeguidas = 0
  // Estado do gate de memória: serve só para logar a TRANSIÇÃO (entrou em
  // espera / voltou a processar) em vez de repetir a mesma linha a cada 5s.
  let esperandoMemoria = false
  // P2.33.1: retenção de material biométrico — prévias vencidas (e narrações vencidas) saem do storage
  // privado e do banco, com remoção confirmada. No máximo uma vez por hora; falha nunca derruba o worker.
  let ultimaLimpeza = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (Date.now() - ultimaLimpeza > 60 * 60 * 1000) {
      ultimaLimpeza = Date.now()
      try {
        const { limparPreviasVencidas } = await import('../lib/digital-twin-exclusao')
        const { limparNarracoesVencidas } = await import('../lib/narracao')
        const [p, n] = [await limparPreviasVencidas(), await limparNarracoesVencidas()]
        if (p.apagados + p.pendentes + n.apagadas > 0) console.log(`[digital-twin-worker] retenção: ${p.apagados} prévia(s) apagada(s), ${p.pendentes} pendente(s), ${n.apagadas} narração(ões) vencida(s) apagada(s).`)
      } catch (e) {
        console.warn(`[digital-twin-worker] retenção falhou (tenta na próxima hora): ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    try {
      // ── Gate de memória (Rodada 12) ───────────────────────────────────
      // Roda ANTES do claim: `reivindicarProximoJob()` já devolve o job
      // reivindicado, e recusar depois exigiria devolvê-lo à fila. Todos os
      // jobType atuais disparam Chatterbox e/ou FFmpeg, então "não
      // reivindicar nada" é a decisão certa e a mais simples.
      //
      // AUTOMATION FIRST: nada vira FAILED. O job continua QUEUED e é
      // processado sozinho quando houver memória — ninguém reaperta botão.
      const memoria = avaliarMemoriaParaJobPesado(freemem())
      if (!memoria.podeReivindicar) {
        if (!esperandoMemoria) {
          esperandoMemoria = true
          console.warn(`[digital-twin-worker] aguardando memória: ${memoria.motivo}`)
        }
        await esperar(POLL_INTERVAL_MS)
        continue
      }
      if (esperandoMemoria) {
        esperandoMemoria = false
        console.log(`[digital-twin-worker] memória liberada (${memoria.livreGB} GB livres, mínimo ${memoria.limiteGB} GB). Retomando o processamento da fila.`)
      }

      const processou = await processarUmJob(workspaceIdPareado)
      if (falhasSeguidas > 0) {
        console.log(`[digital-twin-worker] conexão com o banco restabelecida após ${falhasSeguidas} tentativa(s). Retomando o polling.`)
        falhasSeguidas = 0
      }
      if (!processou) await esperar(POLL_INTERVAL_MS)
    } catch (e) {
      const diagnostico = classificarErroDeBanco(e)
      if (diagnostico.classe === 'FATAL') throw e

      falhasSeguidas++
      const espera = calcularEsperaBackoff(falhasSeguidas, { baseMs: BACKOFF_BASE_MS, maxMs: BACKOFF_MAX_MS })
      console.warn(
        `[digital-twin-worker] banco indisponível (tentativa ${falhasSeguidas}): ${diagnostico.motivo}. Nova tentativa em ${Math.round(espera / 1000)}s.`
      )
      await esperar(espera)
    }
  }
}

main().catch((e) => {
  // Só chega aqui erro FATAL (ou transitório que esgotou o limite do
  // startup). Falha transitória no loop residente nunca mais cai neste ponto.
  const diagnostico = classificarErroDeBanco(e)
  console.error(`[digital-twin-worker] erro fatal (${diagnostico.classe}): ${diagnostico.motivo}`)
  console.error(e)
  process.exit(1)
})
