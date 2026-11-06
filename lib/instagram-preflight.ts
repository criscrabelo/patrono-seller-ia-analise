/**
 * InstagramPreflightValidator (Rodada 5, prioridade nº 2) — valida um
 * conteúdo ANTES de publicar de verdade via `lib/instagram.ts`. Usa as
 * restrições conhecidas da Graph API (Reels/Feed/Stories) já documentadas
 * em `lib/channel-registry.ts` (entrada `instagram`) — nunca hardcoda um
 * limite que a própria conta/API possa mudar sem verificar primeiro.
 */

import { capacidadeDoCanal } from './channel-registry'

export interface InstagramContentToValidate {
  tipo: 'REELS' | 'STORIES' | 'FEED_IMAGE' | 'FEED_CAROUSEL'
  mediaUrl: string
  codec?: string | null
  aspectRatio?: string | null
  larguraPx?: number | null
  alturaPx?: number | null
  duracaoSegundos?: number | null
  tamanhoMB?: number | null
  temAudio?: boolean | null
  contaElegivel: boolean
  midiaAutorizada: boolean
}

export type InstagramPreflightStatus = 'TECHNICALLY_VALID' | 'BLOCKED_BY_POLICY' | 'NOT_VERIFIED'

export interface InstagramPreflightResult {
  status: InstagramPreflightStatus
  problemas: string[]
}

function urlAcessivel(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Valida contra as regras conhecidas do canal `instagram` em
 * `lib/channel-registry.ts`. Campo desconhecido (`null`/`undefined`) nunca
 * é tratado como "ok" — vira `NOT_VERIFIED` para esse item específico.
 */
export class InstagramPreflightValidator {
  validar(content: InstagramContentToValidate): InstagramPreflightResult {
    const canal = capacidadeDoCanal('instagram')
    const problemas: string[] = []

    if (!content.midiaAutorizada) {
      return { status: 'BLOCKED_BY_POLICY', problemas: ['Mídia sem autorização de uso confirmada (MediaRightsGate).'] }
    }
    if (!content.contaElegivel) {
      return { status: 'BLOCKED_BY_POLICY', problemas: ['Conta não elegível para este tipo de publicação.'] }
    }
    if (!urlAcessivel(content.mediaUrl)) {
      problemas.push('URL de mídia não é HTTPS acessível.')
    }
    if (!canal) {
      problemas.push('Canal instagram não encontrado no registro de capacidades.')
      return { status: 'NOT_VERIFIED', problemas }
    }

    if (content.aspectRatio && canal.aspectRatios && !canal.aspectRatios.includes(content.aspectRatio)) {
      problemas.push(`Aspect ratio ${content.aspectRatio} fora dos suportados (${canal.aspectRatios.join(', ')}).`)
    }
    if (content.codec && canal.supportedCodecs && !canal.supportedCodecs.includes(content.codec)) {
      problemas.push(`Codec ${content.codec} não suportado (${canal.supportedCodecs.join(', ')}).`)
    }
    if (content.tamanhoMB != null && canal.maxMediaSizeMB != null && content.tamanhoMB > canal.maxMediaSizeMB) {
      problemas.push(`Tamanho ${content.tamanhoMB}MB acima do limite (${canal.maxMediaSizeMB}MB).`)
    }
    if (content.tipo === 'REELS' && content.temAudio === false) {
      // Não bloqueia — apenas registra, já que Reels sem áudio é permitido, só não recomendado.
      problemas.push('Reel sem áudio (permitido, mas não recomendado).')
    }

    const algumCampoDesconhecido =
      content.aspectRatio == null || content.codec == null || content.duracaoSegundos == null || content.tamanhoMB == null

    if (problemas.some((p) => !p.includes('permitido, mas'))) {
      return { status: 'BLOCKED_BY_POLICY', problemas }
    }
    if (algumCampoDesconhecido) {
      return { status: 'NOT_VERIFIED', problemas: [...problemas, 'Um ou mais campos técnicos não informados — não é possível confirmar totalmente.'] }
    }
    return { status: 'TECHNICALLY_VALID', problemas }
  }
}
