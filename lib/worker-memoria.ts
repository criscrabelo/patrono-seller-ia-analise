/**
 * Gate de memória para jobs pesados (Rodada 12).
 *
 * MOTIVO REAL: em 20/09/2026 a máquina chegou a 83% de RAM ocupada (2,66 GB
 * livres de 15,7 GB) e os processos de fundo foram encerrados por pressão de
 * memória. O Chatterbox carrega o modelo inteiro em RAM: começar uma síntese
 * com pouca memória livre desperdiça minutos de CPU para o processo morrer
 * no meio — e ainda deixa o job com heartbeat velho, esperando o
 * STALE_TIMEOUT.
 *
 * AUTOMATION FIRST: faltar memória NÃO é defeito do job. Quando a memória
 * está baixa, o worker simplesmente **não reivindica**; o job continua
 * `QUEUED` e é processado sozinho quando houver recurso. Nada vira `FAILED`,
 * ninguém precisa reapertar botão.
 *
 * Por que o gate roda ANTES do claim: `reivindicarProximoJob()` já devolve o
 * job reivindicado — depois disso, recusar exigiria devolvê-lo à fila. Como
 * todos os jobType atuais (VOICE_PREVIEW, AVATAR_PREVIEW, PRODUCT_PREVIEW)
 * disparam Chatterbox e/ou FFmpeg, "não reivindicar nada" é a decisão certa
 * e a mais simples.
 *
 * Módulo puro: recebe a memória livre, não a lê. Assim "pouca memória" e
 * "memória voltou" são testáveis sem encher a RAM de propósito.
 */

/**
 * Default conservador, escolhido para ESTA máquina (15,7 GB): o Chatterbox
 * em CPU precisa de folga para o modelo mais o áudio intermediário, e o
 * episódio real aconteceu com 2,66 GB livres. 3 GB é o piso abaixo do qual
 * já vimos o sistema sob pressão.
 */
export const MIN_FREE_RAM_GB_PADRAO = 3

export interface DecisaoMemoria {
  podeReivindicar: boolean
  livreGB: number
  limiteGB: number
  motivo: string
}

/**
 * Lê `DIGITAL_TWIN_MIN_FREE_RAM_GB`. Valor inválido, negativo ou ausente cai
 * no default — nunca desliga o gate por engano de digitação. `0` é aceito e
 * desliga o gate de propósito (máquina grande, ou depuração).
 */
/** Fonte de variaveis de ambiente — frouxa de proposito: exigir o
 * `NodeJS.ProcessEnv` completo (que neste projeto obriga `NODE_ENV`) tornaria
 * a funcao pura impossivel de chamar com um objeto de teste. */
export type FonteDeEnv = Record<string, string | undefined>

export function lerLimiteMinimoRamGB(env: FonteDeEnv = process.env): number {
  const bruto = env.DIGITAL_TWIN_MIN_FREE_RAM_GB
  if (bruto === undefined || bruto.trim() === '') return MIN_FREE_RAM_GB_PADRAO
  const valor = Number(bruto)
  if (!Number.isFinite(valor) || valor < 0) return MIN_FREE_RAM_GB_PADRAO
  return valor
}

export function bytesParaGB(bytes: number): number {
  return Math.round((bytes / 1024 ** 3) * 10) / 10
}

export function avaliarMemoriaParaJobPesado(
  memoriaLivreBytes: number,
  env: FonteDeEnv = process.env
): DecisaoMemoria {
  const limiteGB = lerLimiteMinimoRamGB(env)
  const livreGB = bytesParaGB(memoriaLivreBytes)

  if (limiteGB === 0) {
    return { podeReivindicar: true, livreGB, limiteGB, motivo: 'Gate de memória desligado (DIGITAL_TWIN_MIN_FREE_RAM_GB=0).' }
  }
  if (livreGB < limiteGB) {
    return {
      podeReivindicar: false,
      livreGB,
      limiteGB,
      motivo: `Memória livre ${livreGB} GB abaixo do mínimo de ${limiteGB} GB — nenhum job será reivindicado agora. O job continua na fila e será processado assim que houver memória.`,
    }
  }
  return {
    podeReivindicar: true,
    livreGB,
    limiteGB,
    motivo: `Memória livre ${livreGB} GB (mínimo ${limiteGB} GB).`,
  }
}
