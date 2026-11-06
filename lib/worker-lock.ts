/**
 * Trava contra worker residente duplicado (Rodada 12).
 *
 * MOTIVO: com o restart automático do Task Scheduler entrando em cena, um
 * worker que demore a morrer pode coexistir com o que o Windows acabou de
 * subir. Dois workers residentes no MESMO destino desperdiçam CPU numa
 * máquina que já é CPU_ONLY, brigam pela memória do Chatterbox e confundem
 * o `GenerationWorkerHealth`.
 *
 * O que esta trava NÃO é: ela não substitui o `FOR UPDATE SKIP LOCKED` da
 * fila, e nem tem relação com ele. O SKIP LOCKED impede dois workers de
 * pegarem o MESMO JOB — e continua sendo a garantia correta, inclusive para
 * máquinas diferentes. Esta trava impede dois PROCESSOS no mesmo destino.
 * São camadas independentes; nenhuma torna a outra dispensável.
 *
 * Escopo do lock: destino do banco + workspace pareado. Dois negócios
 * distintos (workspaces distintos) podem rodar seus próprios workers na
 * mesma máquina sem se bloquear — a limitação multi-workspace registrada em
 * DIGITAL-TWIN-WORKER.md não é agravada aqui.
 *
 * `processoVivo` entra por parâmetro para o comportamento ser testável sem
 * criar nem matar processo de verdade.
 */

import { createHash } from 'crypto'
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { tmpdir } from 'os'

export interface ConteudoLock {
  pid: number
  workerId: string
  iniciadoEm: string
}

export type MotivoLock =
  | 'ADQUIRIDO_LIVRE'
  | 'ADQUIRIDO_LOCK_OBSOLETO'
  | 'ADQUIRIDO_LOCK_CORROMPIDO'
  | 'RECUSADO_WORKER_VIVO'

export interface ResultadoLock {
  adquirido: boolean
  motivo: MotivoLock
  mensagem: string
  /** PID do worker que já estava rodando, quando a aquisição é recusada. */
  pidExistente: number | null
}

export interface DepsLock {
  /** Injetável: em teste não se cria nem se mata processo de verdade. */
  processoVivo: (pid: number) => boolean
  agora: Date
}

/**
 * `process.kill(pid, 0)` não envia sinal: só verifica se o processo existe e
 * está acessível. É a checagem padrão, e funciona no Windows.
 */
export function processoVivoReal(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    // EPERM = existe, mas de outro usuário — ainda assim está VIVO, e tratar
    // como morto criaria justamente a duplicata que queremos evitar.
    return (e as { code?: string }).code === 'EPERM'
  }
}

/**
 * Chave do lock: identifica o par (destino, workspace) sem expor a string de
 * conexão. O hash entra no NOME DO ARQUIVO, que é visível no disco — por
 * isso a URL crua, que contém a senha do banco, nunca pode ir para lá.
 */
export function chaveDoLock(destino: string, workspaceId: string | null): string {
  return createHash('sha256').update(`${destino}|${workspaceId ?? 'sem-workspace'}`).digest('hex').slice(0, 16)
}

export function caminhoDoLock(chave: string, diretorio: string = tmpdir()): string {
  return join(diretorio, `patrono-worker-${chave}.lock`)
}

export function adquirirLock(caminho: string, pid: number, workerId: string, deps: DepsLock): ResultadoLock {
  const escrever = (motivo: MotivoLock, mensagem: string): ResultadoLock => {
    mkdirSync(dirname(caminho), { recursive: true })
    const conteudo: ConteudoLock = { pid, workerId, iniciadoEm: deps.agora.toISOString() }
    writeFileSync(caminho, JSON.stringify(conteudo), 'utf8')
    return { adquirido: true, motivo, mensagem, pidExistente: null }
  }

  if (!existsSync(caminho)) {
    return escrever('ADQUIRIDO_LIVRE', 'Nenhum outro worker residente neste destino.')
  }

  let existente: ConteudoLock
  try {
    existente = JSON.parse(readFileSync(caminho, 'utf8')) as ConteudoLock
  } catch {
    // Lock ilegível (disco cheio no meio da escrita, encerramento abrupto).
    // Não pode travar o worker para sempre: é tratado como obsoleto.
    return escrever('ADQUIRIDO_LOCK_CORROMPIDO', 'Lock anterior ilegível — tratado como obsoleto.')
  }

  if (!deps.processoVivo(existente.pid)) {
    return escrever(
      'ADQUIRIDO_LOCK_OBSOLETO',
      `Lock do PID ${existente.pid} estava obsoleto (processo não existe mais) — assumido por este worker.`
    )
  }

  return {
    adquirido: false,
    motivo: 'RECUSADO_WORKER_VIVO',
    mensagem: `Já existe um worker residente ativo neste destino (PID ${existente.pid}, iniciado em ${existente.iniciadoEm}). Este processo vai sair sem fazer nada.`,
    pidExistente: existente.pid,
  }
}

/**
 * Libera o lock SOMENTE se ele ainda for nosso. Um worker que morreu e teve
 * o lock assumido por outro não pode, ao encerrar, apagar o lock do vivo.
 */
export function liberarLock(caminho: string, pid: number): boolean {
  try {
    if (!existsSync(caminho)) return false
    const atual = JSON.parse(readFileSync(caminho, 'utf8')) as ConteudoLock
    if (atual.pid !== pid) return false
    unlinkSync(caminho)
    return true
  } catch {
    return false
  }
}
