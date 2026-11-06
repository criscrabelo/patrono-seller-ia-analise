/**
 * ChannelRegistry — canais de PUBLICAÇÃO de conteúdo, separados de
 * AffiliateProviderRegistry (onde encontro o produto/programa de
 * afiliados). São conceitos diferentes de propósito: um provider de
 * afiliados (Shopee, Hotmart) é de onde vem o produto/comissão; um canal
 * (Instagram, TikTok) é para onde vai o conteúdo publicado. O mesmo
 * produto pode ser divulgado em vários canais; o mesmo canal publica
 * conteúdo de produtos de vários providers.
 *
 * Regras não devem ficar espalhadas em componentes — toda tela/automação
 * que precisa saber "esse canal aceita carrossel?" ou "precisa de
 * consentimento explícito?" consulta este registro.
 */

export type ChannelCapability = {
  channelId: string
  imagePost: boolean
  carousel: boolean
  shortVideo: boolean
  reel: boolean
  story: boolean
  autoPublish: boolean
  draftUpload: boolean
  analytics: boolean
  requiresExplicitConsent: boolean
  commercialDisclosure: boolean
  maxMediaSizeMB: number | null
  aspectRatios: string[]
  supportedCodecs: string[]
  durationRulesSeconds: { min: number; max: number } | null
  watermarkPolicy: string
  lastVerifiedAt: string
  sourceType: 'OFFICIAL_DOCS' | 'OFFICIAL_API' | 'NOT_VERIFIED'
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN'
  observacao?: string
}

const HOJE = '2026-09-14'

export const CHANNEL_CAPABILITIES: ChannelCapability[] = [
  {
    channelId: 'instagram',
    imagePost: true,
    carousel: true,
    shortVideo: false,
    reel: true,
    story: true,
    autoPublish: true, // via Graph API oficial — já implementado em lib/instagram.ts
    draftUpload: false,
    analytics: true,
    requiresExplicitConsent: false, // token já é consentimento explícito no fluxo OAuth
    commercialDisclosure: true,
    maxMediaSizeMB: null,
    aspectRatios: ['1:1', '4:5', '9:16'],
    supportedCodecs: ['h264'],
    durationRulesSeconds: { min: 3, max: 900 },
    watermarkPolicy: 'Selo "conteúdo gerado por IA" quando persona/avatar de IA aparece.',
    lastVerifiedAt: HOJE,
    sourceType: 'OFFICIAL_DOCS',
    confidence: 'MEDIUM',
    observacao:
      'Este registro descreve a PLATAFORMA: ela aceita Reel, imagem e carrossel. O adapter real do Patrono só envia Reel com vídeo — o que ele publica de verdade está em lib/capacidade-real-do-adapter.ts, e é isso que o preflight consulta. Não há post só de texto. Limites exatos de duração/tamanho variam por tipo de conta e devem ser reconferidos contra a documentação Meta antes de qualquer ajuste.',
  },
  {
    channelId: 'tiktok',
    imagePost: false,
    carousel: false,
    shortVideo: true,
    reel: false,
    story: false,
    // P2.17.10 (docs oficiais, 11/10/2026): Direct Post existe (público só com
    // app auditado — a decisão exige a auditoria CONFIRMADA); rascunho na caixa
    // de entrada (video.upload); métricas de vídeos públicos (video.list).
    autoPublish: true,
    draftUpload: true, // Content Posting API tem modo "draft" (envia pro inbox do criador)
    analytics: true,
    requiresExplicitConsent: true, // TikTok exige confirmação do criador antes de publicar
    commercialDisclosure: true,
    maxMediaSizeMB: null,
    aspectRatios: ['9:16'],
    supportedCodecs: ['h264', 'h265'],
    durationRulesSeconds: null, // não hardcodar: TikTokPreflightValidator deve consultar a conta, não um número fixo aqui
    watermarkPolicy: 'A VERIFICAR',
    lastVerifiedAt: HOJE,
    sourceType: 'OFFICIAL_DOCS',
    confidence: 'MEDIUM',
    observacao:
      'TikTok Content Posting API é o único caminho oficial (nunca automação de navegador). Duração permitida varia por conta/tipo de app e deve vir da própria API (creator info), não de um valor fixo — ver TikTokPreflightValidator em lib/tiktok-preflight.ts. Nenhuma credencial configurada nesta rodada.',
  },
  {
    channelId: 'youtube',
    imagePost: false,
    carousel: false,
    shortVideo: true, // Shorts
    reel: false,
    story: false,
    autoPublish: false,
    draftUpload: true,
    analytics: true,
    requiresExplicitConsent: true,
    commercialDisclosure: true,
    maxMediaSizeMB: null,
    aspectRatios: ['9:16', '16:9'],
    supportedCodecs: ['h264'],
    durationRulesSeconds: { min: 1, max: 60 },
    watermarkPolicy: 'A VERIFICAR',
    lastVerifiedAt: HOJE,
    sourceType: 'NOT_VERIFIED',
    confidence: 'LOW',
    observacao: 'YouTube Data API (upload) é o caminho oficial. Nenhuma credencial configurada; limites não reconferidos nesta rodada.',
  },
  {
    channelId: 'facebook',
    imagePost: true,
    carousel: true,
    shortVideo: true, // Reels
    reel: true,
    story: true,
    autoPublish: true, // mesma família de API (Graph API) do Instagram
    draftUpload: false,
    analytics: true,
    requiresExplicitConsent: false,
    commercialDisclosure: true,
    maxMediaSizeMB: null,
    aspectRatios: ['1:1', '4:5', '9:16', '16:9'],
    supportedCodecs: ['h264'],
    durationRulesSeconds: null,
    watermarkPolicy: 'A VERIFICAR',
    lastVerifiedAt: HOJE,
    sourceType: 'NOT_VERIFIED',
    confidence: 'LOW',
    observacao: 'Meta Graph API cobre Facebook também, mas o app atual só publica no Instagram — Facebook não está implementado ainda.',
  },
  {
    channelId: 'pinterest',
    imagePost: true,
    carousel: false,
    shortVideo: true,
    reel: false,
    story: false,
    autoPublish: false,
    draftUpload: false,
    analytics: false,
    requiresExplicitConsent: true,
    commercialDisclosure: true,
    maxMediaSizeMB: null,
    aspectRatios: ['2:3', '1:1'],
    supportedCodecs: ['h264'],
    durationRulesSeconds: null,
    watermarkPolicy: 'A VERIFICAR',
    lastVerifiedAt: HOJE,
    sourceType: 'NOT_VERIFIED',
    confidence: 'LOW',
    observacao: 'Pinterest tem API de Pins pública; não implementada, não reconferida nesta rodada.',
  },
]

export function capacidadeDoCanal(channelId: string): ChannelCapability | undefined {
  return CHANNEL_CAPABILITIES.find((c) => c.channelId === channelId)
}
