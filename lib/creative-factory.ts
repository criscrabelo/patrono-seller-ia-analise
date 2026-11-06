/**
 * CreativeFactory — arquitetura desacoplada de geração de conteúdo.
 *
 * NÃO contrata gerador pago. NÃO integra Anthropic/fal.ai como dependência
 * obrigatória — hoje esses dois já existem no projeto como recursos
 * OPCIONAIS (lib/claude.ts, lib/falai.ts) para quem quiser usar IA
 * generativa paga; a arquitetura abaixo existe para que o Patrono também
 * funcione SEM eles, usando composição programática gratuita (FFmpeg,
 * templates, overlays, texto) sempre que o produto tiver mídia oficial
 * disponível.
 *
 * Cada "provider" abaixo é uma interface — várias implementações podem
 * coexistir (uma paga, uma gratuita) e a fábrica escolhe pela capability
 * disponível, nunca hardcoded num componente de tela.
 */

import { formatarBRLOuNulo } from './formato-moeda'

export interface ImageGeneratorProvider {
  generate(params: { prompt: string; baseImageUrl?: string }): Promise<{ url: string; provider: string }>
}

export interface VideoGeneratorProvider {
  generate(params: { prompt: string; baseImageUrl?: string; durationSeconds?: number }): Promise<{ url: string; provider: string }>
}

export interface TextGeneratorProvider {
  generate(params: { prompt: string }): Promise<{ text: string; provider: string }>
}

export interface VoiceGeneratorProvider {
  generate(params: { text: string; voiceId?: string }): Promise<{ audioUrl: string; provider: string }>
}

/**
 * Compõe assets (imagem oficial do produto + texto + overlay + trilha) num
 * arquivo final — o caminho gratuito por padrão: zoom/pan, transições,
 * legendas, composição programática (ex.: FFmpeg), sem depender de IA
 * generativa. Implementação futura: nesta rodada só a interface, sem POC
 * de renderização (evita aumentar o escopo desta rodada sem necessidade).
 */
export interface RendererProvider {
  render(params: {
    mediaAssetIds: string[]
    format: 'imagem' | 'carrossel' | 'reel-simples' | 'video-vertical' | 'story' | 'short'
    overlays?: { texto: string; posicao: string }[]
  }): Promise<{ url: string; durationSeconds?: number }>
}

export interface CreativeFactory {
  imageProvider?: ImageGeneratorProvider
  videoProvider?: VideoGeneratorProvider
  textProvider?: TextGeneratorProvider
  voiceProvider?: VoiceGeneratorProvider
  renderer: RendererProvider
}

/**
 * Direitos de mídia — nenhum asset entra no pacote criativo sem isso.
 * O Patrono não pode pegar qualquer imagem da internet. Prioridade (mais
 * segura primeiro): mídia oficial autorizada > API oficial > mídia do
 * programa de afiliados > conteúdo enviado pela usuária > conteúdo
 * legitimamente gerado (IA, com selo).
 */
export const PRIORIDADE_FONTE_MIDIA = [
  'MIDIA_OFICIAL_AUTORIZADA',
  'API_OFICIAL',
  'MIDIA_DO_PROGRAMA_DE_AFILIADOS',
  'ENVIADA_PELA_USUARIA',
  'GERADA_LEGITIMAMENTE',
] as const
export type FonteMidia = (typeof PRIORIDADE_FONTE_MIDIA)[number]

export interface MediaAsset {
  id: string
  source: FonteMidia
  sourceUrl: string | null
  usageAuthorized: boolean
  provider: string | null // ex.: 'amazon-associados', 'gemini', 'upload-usuaria'
  productId: string | null
  generated: boolean
  licenseNotes: string | null
}

/**
 * Disclosure de afiliado/comercial — regra configurável por canal/provider,
 * nunca ocultada. Deriva de `ChannelCapability.commercialDisclosure`
 * (lib/channel-registry.ts); esta função só decide o TEXTO, não se é
 * necessário (isso a capability já diz).
 */
export function textoDisclosure(tipo: 'afiliado' | 'parceria' | 'publicidade' = 'afiliado'): string {
  const textos: Record<typeof tipo, string> = {
    afiliado: 'Este conteúdo contém link de afiliado — posso ganhar uma comissão sobre a venda.',
    parceria: 'Conteúdo produzido em parceria comercial.',
    publicidade: 'Publicidade.',
  }
  return textos[tipo]
}

/**
 * Preset TIKTOK_FIRST (Rodada 6, regra 25) — o TikTok passou a ser o canal
 * prioritário nº 1; o conteúdo gerado para ele precisa ser criado
 * especificamente para o formato/tom do TikTok, nunca um reaproveitamento
 * automático do Reel do Instagram (formato/ritmo/hook são diferentes).
 *
 * Só usa fatos presentes em `fonte` — nunca inventa benefício, desconto,
 * característica, certificação ou prazo. Preço só entra se vier com
 * timestamp; sem isso, usa a chamada genérica "confira o preço atual".
 */
export interface FonteFatualProduto {
  nome: string
  categoria: string
  preco: number | null
  precoConsultadoEm: string | null
  isAffiliate: boolean
}

export interface PacoteCriativoTikTokFirst {
  hooks: [string, string, string]
  caption: string
  cta: string
  hashtags: string[]
  disclosure: string | null
}

export function gerarPacoteCriativoTikTokFirst(fonte: FonteFatualProduto): PacoteCriativoTikTokFirst {
  // Formatação brasileira de verdade (R$ 199,00). O valor não muda — só a
  // escrita: esta legenda é publicada.
  const precoFormatado = formatarBRLOuNulo(fonte.preco)
  const precoTexto =
    precoFormatado && fonte.precoConsultadoEm
      ? `${precoFormatado} (consultado em ${fonte.precoConsultadoEm})`
      : 'confira o preço atual'

  const hooks: [string, string, string] = [
    `Achei isso: ${fonte.nome}`,
    `Você já viu ${fonte.nome}?`,
    `${fonte.categoria}: ${fonte.nome}`,
  ]
  const cta = 'Link na bio/comentário fixado.'
  const caption = `${fonte.nome} — ${precoTexto}.`
  const hashtags = ['#tiktokmademebuyit', `#${fonte.categoria.replace(/\s+/g, '').toLowerCase()}`].filter(Boolean)
  const disclosure = fonte.isAffiliate ? textoDisclosure('afiliado') : null

  return { hooks, caption, cta, hashtags, disclosure }
}
