/**
 * Retry seguro para o fluxo de publicação do TikTok (Rodada 6, regra 30).
 * Nunca repete uma publicação já aceita — sempre confere o `publish_id` e o
 * status oficial antes de tentar de novo (idempotência), e só faz retry
 * para falhas de rede/processamento, nunca para um post já `ACCEPTED_BY_TIKTOK`.
 */

import type { TikTokPublicationStatus } from './tiktok-preflight'

export interface TikTokRetryPolicy {
  maxTentativas: number
  backoffBaseMs: number
}

export const POLITICA_RETRY_PADRAO: TikTokRetryPolicy = { maxTentativas: 3, backoffBaseMs: 1000 }

export interface TikTokRetryDeps {
  publicar: () => Promise<{ publishId: string }>
  consultarStatus: (publishId: string) => Promise<TikTokPublicationStatus>
  esperar?: (ms: number) => Promise<void>
}

export interface TikTokRetryResultado {
  publishId: string
  status: TikTokPublicationStatus
  tentativas: number
}

/**
 * Publica com retry. Se uma tentativa anterior já resultou em `publish_id`
 * com status `ACCEPTED_BY_TIKTOK`/`PUBLISHING`, nunca chama `publicar()` de
 * novo — só continua consultando o status existente.
 */
export async function publicarComRetry(
  deps: TikTokRetryDeps,
  policy: TikTokRetryPolicy = POLITICA_RETRY_PADRAO,
  estadoAnterior?: { publishId: string; status: TikTokPublicationStatus }
): Promise<TikTokRetryResultado> {
  const esperar = deps.esperar ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))

  if (estadoAnterior && (estadoAnterior.status === 'ACCEPTED_BY_TIKTOK' || estadoAnterior.status === 'PUBLISHING')) {
    return { publishId: estadoAnterior.publishId, status: estadoAnterior.status, tentativas: 0 }
  }

  let ultimoErro: unknown = null
  for (let tentativa = 1; tentativa <= policy.maxTentativas; tentativa++) {
    try {
      const { publishId } = await deps.publicar()
      const status = await deps.consultarStatus(publishId)
      return { publishId, status, tentativas: tentativa }
    } catch (e) {
      ultimoErro = e
      if (tentativa < policy.maxTentativas) {
        await esperar(policy.backoffBaseMs * 2 ** (tentativa - 1))
      }
    }
  }
  throw ultimoErro instanceof Error ? ultimoErro : new Error('Falha ao publicar no TikTok após retries.')
}
