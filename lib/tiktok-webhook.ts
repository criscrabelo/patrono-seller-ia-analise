/**
 * Webhook de Content Posting do TikTok (Rodada 6, regra 14) — endpoint
 * seguro para eventos de status quando pudermos configurar legitimamente
 * (nenhum serviço externo contratado; só o endpoint HTTP já hospedado pelo
 * próprio Next.js). Nunca confia em payload sem verificar autenticidade,
 * nunca processa o mesmo evento duas vezes (idempotência), nunca aceita
 * timestamp antigo demais (proteção contra replay).
 */

import crypto from 'crypto'

const REPLAY_TOLERANCIA_MS = 5 * 60 * 1000 // 5 minutos

export interface TikTokWebhookPayload {
  event: string
  client_key: string
  create_time: number // epoch segundos, enviado pelo TikTok
  user_openid: string
  content?: string // JSON-string com o corpo específico do evento (ex.: publish_id, status)
}

/**
 * Verifica a assinatura HMAC-SHA256 do webhook (segredo = client_secret do
 * app) sobre `timestamp.corpoCru` — nunca aceita um payload cuja assinatura
 * não bate, mesmo que o JSON pareça válido.
 */
export function verificarAssinaturaWebhook(params: {
  corpoCru: string
  timestampHeader: string
  assinaturaHeader: string
  clientSecret: string
}): boolean {
  const esperado = crypto
    .createHmac('sha256', params.clientSecret)
    .update(`${params.timestampHeader}.${params.corpoCru}`)
    .digest('hex')
  const a = Buffer.from(params.assinaturaHeader)
  const b = Buffer.from(esperado)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

/**
 * P2.5 — Lê o cabeçalho OFICIAL `Tiktok-Signature` (developers.tiktok.com/
 * doc/webhooks-verification): `t=<epoch em segundos>,s=<HMAC-SHA256 hex>`.
 *
 * A rota lia dois cabeçalhos separados (`tiktok-signature` e
 * `tiktok-timestamp`), que o TikTok não envia — todo evento legítimo seria
 * recusado. Formato fora do documentado devolve `null` e a requisição é
 * recusada antes de o corpo ser lido.
 */
export function lerCabecalhoDeAssinatura(valor: string | null | undefined): { timestamp: string; assinatura: string } | null {
  if (!valor || valor.length > 300) return null
  const partes = new Map<string, string>()
  for (const pedaco of valor.split(',')) {
    const i = pedaco.indexOf('=')
    if (i <= 0) return null
    const chave = pedaco.slice(0, i).trim()
    if (partes.has(chave)) return null
    partes.set(chave, pedaco.slice(i + 1).trim())
  }
  const timestamp = partes.get('t')
  const assinatura = partes.get('s')
  if (!timestamp || !/^\d{9,11}$/.test(timestamp)) return null
  if (!assinatura || !/^[0-9a-f]{64}$/i.test(assinatura)) return null
  return { timestamp, assinatura: assinatura.toLowerCase() }
}

/** Corpo máximo aceito pelo webhook público: evento do TikTok é pequeno. */
export const TAMANHO_MAXIMO_DO_CORPO = 64 * 1024

/** Rejeita webhook com timestamp fora da janela de tolerância — nunca reprocessa um replay antigo. */
export function timestampDentroDaJanela(timestampHeaderSegundos: string, agoraMs: number = Date.now()): boolean {
  const ts = parseInt(timestampHeaderSegundos, 10)
  if (Number.isNaN(ts)) return false
  return Math.abs(agoraMs - ts * 1000) <= REPLAY_TOLERANCIA_MS
}

/** Store de idempotência — injetável para teste sem banco real. */
export interface WebhookIdempotencyStore {
  jaProcessado(eventId: string): Promise<boolean>
  marcarProcessado(eventId: string): Promise<void>
  /**
   * Reivindicação ATÔMICA (P2.14.7): true = este processo é o primeiro a ver
   * o evento. Quando existe, substitui o par jaProcessado/marcarProcessado,
   * que tem corrida entre instâncias serverless.
   */
  reivindicar?(eventId: string): Promise<boolean>
}

export class WebhookIdempotencyStoreEmMemoria implements WebhookIdempotencyStore {
  private vistos = new Set<string>()
  async jaProcessado(eventId: string) {
    return this.vistos.has(eventId)
  }
  async marcarProcessado(eventId: string) {
    this.vistos.add(eventId)
  }
}

/** Identificador estável do evento para dedup — nunca reprocessa o mesmo `publish_id`+`event`. */
export function idDoEvento(payload: TikTokWebhookPayload): string {
  return `${payload.event}:${payload.user_openid}:${payload.create_time}`
}

export interface ProcessarWebhookResultado {
  aceito: boolean
  motivo: string
  duplicado: boolean
}

/**
 * Pipeline completo de recebimento: assinatura → replay → idempotência.
 * Falha em qualquer etapa nunca processa o evento como se fosse válido.
 */
export async function processarWebhookTikTok(params: {
  corpoCru: string
  timestampHeader: string
  assinaturaHeader: string
  clientSecret: string
  store: WebhookIdempotencyStore
  agoraMs?: number
}): Promise<ProcessarWebhookResultado> {
  if (!verificarAssinaturaWebhook({ ...params })) {
    return { aceito: false, motivo: 'Assinatura inválida.', duplicado: false }
  }
  if (!timestampDentroDaJanela(params.timestampHeader, params.agoraMs)) {
    return { aceito: false, motivo: 'Timestamp fora da janela de tolerância (possível replay).', duplicado: false }
  }

  let payload: TikTokWebhookPayload
  try {
    payload = JSON.parse(params.corpoCru)
  } catch {
    return { aceito: false, motivo: 'Corpo não é um JSON válido.', duplicado: false }
  }

  const eventId = idDoEvento(payload)
  if (params.store.reivindicar) {
    return (await params.store.reivindicar(eventId))
      ? { aceito: true, motivo: 'Evento aceito e processado.', duplicado: false }
      : { aceito: true, motivo: 'Evento já processado anteriormente — ignorado (idempotência).', duplicado: true }
  }
  if (await params.store.jaProcessado(eventId)) {
    return { aceito: true, motivo: 'Evento já processado anteriormente — ignorado (idempotência).', duplicado: true }
  }
  await params.store.marcarProcessado(eventId)
  return { aceito: true, motivo: 'Evento aceito e processado.', duplicado: false }
}
