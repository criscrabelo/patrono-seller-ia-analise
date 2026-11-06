/**
 * Controle de versão do worker (Rodada 9, regra 25). O Patrono precisa
 * saber se o worker conectado está na versão esperada — nunca autoexecuta
 * código arbitrário baixado sem validação; a comparação é só informativa
 * (mostra "atualização disponível"), nunca dispara update sozinho.
 */

export const REQUIRED_WORKER_VERSION = '1.1.0'

export interface WorkerVersionCheck {
  workerVersion: string | null
  requiredVersion: string
  atualizado: boolean
  motivo: string
}

export function verificarVersaoWorker(workerVersion: string | null, requiredVersion: string = REQUIRED_WORKER_VERSION): WorkerVersionCheck {
  if (!workerVersion) {
    return { workerVersion, requiredVersion, atualizado: false, motivo: 'Worker nunca reportou versão.' }
  }
  return {
    workerVersion,
    requiredVersion,
    atualizado: workerVersion === requiredVersion,
    motivo: workerVersion === requiredVersion ? 'Worker na versão esperada.' : `Worker na versão ${workerVersion}, esperada ${requiredVersion} — atualização recomendada (nunca aplicada automaticamente).`,
  }
}
