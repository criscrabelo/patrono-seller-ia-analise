/**
 * TikTokChannel (Rodada 5, prioridade nº 1) — publicação real via TikTok
 * Content Posting API oficial. Este arquivo é o CANAL (como publicar,
 * disclosure, consentimento, status, métricas) — nunca deve ser misturado
 * com `lib/tiktok-shop-provider.ts` (TikTokShopAffiliateProvider), que é o
 * PROVIDER de afiliados (produtos, oportunidades, links, comissões).
 *
 * Sem credenciais configuradas (`TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`,
 * `TIKTOK_ACCESS_TOKEN`/token por conta): healthCheck() devolve
 * "TIKTOK — AGUARDANDO CONFIGURAÇÃO", nenhuma chamada de publicação real é
 * feita — nunca simular sucesso.
 */

import { textoDisclosure } from './creative-factory'
import type { TikTokCreatorInfo, TikTokPreflightResult, TikTokPublicationStatus } from './tiktok-preflight'

export interface TikTokCredentials {
  clientKey: string
  clientSecret: string
  accessToken: string
}

export function lerCredenciaisTikTok(): TikTokCredentials | null {
  const clientKey = process.env.TIKTOK_CLIENT_KEY
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET
  const accessToken = process.env.TIKTOK_ACCESS_TOKEN
  if (!clientKey || !clientSecret || !accessToken) return null
  return { clientKey, clientSecret, accessToken }
}

export type TikTokHealthStatus =
  | { configured: false; status: 'AGUARDANDO CONFIGURAÇÃO'; message: string }
  | { configured: true; status: 'OK' | 'ERROR'; message: string }

async function tiktokFetch(url: string, accessToken: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      'content-type': 'application/json; charset=UTF-8',
      authorization: `Bearer ${accessToken}`,
    },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data?.error?.code === 'error') {
    const msg = data?.error?.message || `Erro HTTP ${res.status} na TikTok Content Posting API`
    throw new Error(msg)
  }
  return data
}

/**
 * Consulta `creator_info` da conta — nunca hardcoda duração/formato, porque
 * a própria API é quem manda (varia por conta/app). Sem credencial: não
 * chama nada, quem decide o NOT_VERIFIED é `TikTokPreflightNotConfigured`.
 */
export async function consultarCreatorInfo(creds: TikTokCredentials): Promise<TikTokCreatorInfo> {
  const data = await tiktokFetch('https://open.tiktokapis.com/v2/post/publish/creator_info/query/', creds.accessToken, {
    method: 'POST',
  })
  const d = data?.data ?? {}
  return {
    duracaoMaximaSegundos: typeof d.max_video_post_duration_sec === 'number' ? d.max_video_post_duration_sec : 'unknown',
    privacidadeOpcoesPermitidas: Array.isArray(d.privacy_level_options) ? d.privacy_level_options : 'unknown',
    duetPermitido: typeof d.duet_disabled === 'boolean' ? !d.duet_disabled : 'unknown',
    stitchPermitido: typeof d.stitch_disabled === 'boolean' ? !d.stitch_disabled : 'unknown',
    comentariosPermitidos: typeof d.comment_disabled === 'boolean' ? !d.comment_disabled : 'unknown',
  }
}

export class TikTokChannelHealthCheck {
  async healthCheck(): Promise<TikTokHealthStatus> {
    const creds = lerCredenciaisTikTok()
    if (!creds) {
      return {
        configured: false,
        status: 'AGUARDANDO CONFIGURAÇÃO',
        message: 'Defina TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET e TIKTOK_ACCESS_TOKEN para conectar.',
      }
    }
    try {
      await consultarCreatorInfo(creds)
      return { configured: true, status: 'OK', message: 'Conta TikTok conectada e creator_info consultado com sucesso.' }
    } catch (e) {
      return { configured: true, status: 'ERROR', message: e instanceof Error ? e.message : 'Falha ao consultar a conta TikTok.' }
    }
  }
}

/**
 * TikTokCommercialDisclosure — o TikTok exige marcar "Conteúdo comercial"
 * (Your brand / Branded content) quando há link de afiliado/comissão
 * envolvida. Nunca omite a marcação; a legenda também recebe o texto de
 * disclosure (nunca esconde a relação comercial).
 */
export interface TikTokDisclosureFlags {
  brandedContent: boolean // "Promoção de marca" — divulga produto/marca de terceiro
  yourBrand: boolean // "Seu produto/marca" — quando a própria usuária vende o produto
}

export function tiktokCommercialDisclosure(params: { isAffiliate: boolean }): { flags: TikTokDisclosureFlags; legendaComDisclosure: (legenda: string) => string } {
  const flags: TikTokDisclosureFlags = {
    brandedContent: params.isAffiliate,
    yourBrand: false,
  }
  return {
    flags,
    legendaComDisclosure: (legenda: string) => (params.isAffiliate ? `${legenda}\n\n${textoDisclosure('afiliado')}` : legenda),
  }
}

export interface PublicarVideoTikTokParams {
  creds: TikTokCredentials
  videoUrl: string
  legenda: string
  disclosure: TikTokDisclosureFlags
  privacyLevel: string
}

export interface TikTokPublishResult {
  publishId: string
  status: TikTokPublicationStatus
}

/**
 * Publica de verdade via Content Posting API (init por URL + status). Só
 * deve ser chamado depois que o preflight (`TikTokPreflightValidator`) e o
 * consent gate (`tiktokHumanConsentGate`) já liberaram — este publisher não
 * decide se pode publicar, só publica quando mandado.
 */
export class TikTokPublisher {
  async publicar(params: PublicarVideoTikTokParams): Promise<TikTokPublishResult> {
    const init = await tiktokFetch('https://open.tiktokapis.com/v2/post/publish/video/init/', params.creds.accessToken, {
      method: 'POST',
      body: JSON.stringify({
        post_info: {
          title: params.legenda,
          privacy_level: params.privacyLevel,
          disable_duet: false,
          disable_stitch: false,
          disable_comment: false,
          brand_content_toggle: params.disclosure.brandedContent,
          brand_organic_toggle: params.disclosure.yourBrand,
        },
        source_info: {
          source: 'PULL_FROM_URL',
          video_url: params.videoUrl,
        },
      }),
    })
    const publishId = init?.data?.publish_id as string | undefined
    if (!publishId) throw new Error('TikTok não retornou publish_id')
    return { publishId, status: 'PUBLISHING' }
  }

  /**
   * Consulta o status oficial — só aqui um vídeo vira ACCEPTED_BY_TIKTOK de
   * verdade. Um timeout do NOSSO polling nunca vira FAILED sozinho — aqui
   * só mapeamos o que a própria API respondeu; quem chama decide reagendar
   * a consulta em vez de desistir (regra 13: "não transformar timeout local
   * em falha definitiva").
   */
  async statusPublicacao(creds: TikTokCredentials, publishId: string): Promise<TikTokPublicationStatus> {
    const data = await tiktokFetch('https://open.tiktokapis.com/v2/post/publish/status/fetch/', creds.accessToken, {
      method: 'POST',
      body: JSON.stringify({ publish_id: publishId }),
    })
    const status = data?.data?.status as string | undefined
    if (status === 'PUBLISH_COMPLETE') return 'ACCEPTED_BY_TIKTOK'
    if (status === 'FAILED') return 'REJECTED_BY_TIKTOK'
    // P2.17.10 (auditoria): status desconhecido NÃO é falha — continua em
    // processamento (mesma regra de lib/tiktok-acompanhamento.ts).
    return 'PUBLISHING'
  }

  /**
   * Photo Post (Rodada 6, regra 12) — mesma Content Posting API, `post_mode:
   * PHOTO`. Base real para Carrossel/Photo Post automático no TikTok.
   */
  async publicarFotos(params: {
    creds: TikTokCredentials
    photoUrls: string[]
    coverIndex: number
    description: string
    disclosure: TikTokDisclosureFlags
    privacyLevel: string
    autoAddMusic?: boolean
  }): Promise<TikTokPublishResult> {
    if (params.photoUrls.length === 0) throw new Error('Photo Post precisa de pelo menos uma foto.')
    if (params.coverIndex < 0 || params.coverIndex >= params.photoUrls.length) {
      throw new Error('coverIndex fora do intervalo de fotos enviadas.')
    }
    const init = await tiktokFetch('https://open.tiktokapis.com/v2/post/publish/content/init/', params.creds.accessToken, {
      method: 'POST',
      body: JSON.stringify({
        post_info: {
          title: params.description,
          privacy_level: params.privacyLevel,
          disable_comment: false,
          brand_content_toggle: params.disclosure.brandedContent,
          brand_organic_toggle: params.disclosure.yourBrand,
          auto_add_music: params.autoAddMusic ?? false,
        },
        source_info: {
          source: 'PULL_FROM_URL',
          photo_cover_index: params.coverIndex,
          photo_images: params.photoUrls,
        },
        post_mode: 'DIRECT_POST',
        media_type: 'PHOTO',
      }),
    })
    const publishId = init?.data?.publish_id as string | undefined
    if (!publishId) throw new Error('TikTok não retornou publish_id para o Photo Post')
    return { publishId, status: 'PUBLISHING' }
  }
}

export interface TikTokMetrics {
  publishId: string
  views: number | null
  likes: number | null
  comments: number | null
  shares: number | null
  consultedAt: string
}

/**
 * TikTokAnalyticsAdapter — busca métricas de um vídeo publicado, para
 * alimentar o Learning Engine. Campo não devolvido pela API vira `null`,
 * nunca um número inventado.
 */
export class TikTokAnalyticsAdapter {
  async coletarMetricas(creds: TikTokCredentials, videoId: string): Promise<TikTokMetrics> {
    const data = await tiktokFetch(
      `https://open.tiktokapis.com/v2/video/query/?fields=id,view_count,like_count,comment_count,share_count`,
      creds.accessToken,
      { method: 'POST', body: JSON.stringify({ filters: { video_ids: [videoId] } }) }
    )
    const v = (data?.data?.videos ?? [])[0] ?? {}
    return {
      publishId: videoId,
      views: typeof v.view_count === 'number' ? v.view_count : null,
      likes: typeof v.like_count === 'number' ? v.like_count : null,
      comments: typeof v.comment_count === 'number' ? v.comment_count : null,
      shares: typeof v.share_count === 'number' ? v.share_count : null,
      consultedAt: new Date().toISOString(),
    }
  }
}

/** Reexporta para quem só importa de `tiktok-channel.ts` (conveniência). */
export type { TikTokPreflightResult, TikTokPublicationStatus }
