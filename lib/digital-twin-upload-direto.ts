/**
 * P2.11 — Upload direto do navegador ao Supabase (Digital Twin).
 *
 * Foto, vídeo e voz da titular são tratados com base em CONSENTIMENTO, e a
 * P2.10 concluiu que o art. 33, IX não os cobre. Por isso o arquivo não
 * passa mais pelas funções da hospedagem (EUA): o navegador envia direto ao
 * Supabase (sa-east-1) por uma URL assinada, e as funções só trocam JSON
 * pequeno com metadados.
 *
 *   ① POST /api/digital-twin/assets/url-de-envio  → URL assinada + intenção
 *   ② PUT  <Supabase>/storage/v1/object/upload/sign/...  (o arquivo)
 *   ③ POST /api/digital-twin/assets/confirmar      → confere o objeto e registra
 *
 * Este módulo é puro (sem banco, sem rede): regras de tipo/tamanho, caminho,
 * intenção assinada e configuração. As rotas só orquestram.
 *
 * FAIL-CLOSED: sem configuração completa não há upload — e não existe
 * caminho alternativo pela função.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { DigitalTwinAssetType } from './digital-twin-asset-types'

type Env = Record<string, string | undefined>

// ── Tipos e limites ──────────────────────────────────────────────────────

const MB = 1024 * 1024

/**
 * Só o que a tela envia. `CONSENT_EVIDENCE` e `GENERATED_PREVIEW` não vêm do
 * navegador: prévias são gravadas pelo worker, direto no storage.
 */
export const LIMITES_DO_UPLOAD_DIRETO = {
  FACE_IMAGE: { mimes: ['image/jpeg', 'image/png', 'image/webp'], maximoBytes: 10 * MB },
  REFERENCE_VIDEO: { mimes: ['video/mp4', 'video/webm', 'video/quicktime'], maximoBytes: 50 * MB },
  VOICE_REFERENCE: {
    mimes: ['audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'audio/aac', 'audio/x-m4a'],
    maximoBytes: 20 * MB,
  },
} as const satisfies Partial<Record<DigitalTwinAssetType, { mimes: readonly string[]; maximoBytes: number }>>

export type TipoDeUploadDireto = keyof typeof LIMITES_DO_UPLOAD_DIRETO

/**
 * P2.12 — `file_size_limit` do bucket `digital-twin-private`: o maior limite
 * por tipo (vídeo, 50 MB). É a segunda barreira: o storage recusa o PUT
 * acima disso mesmo que alguém pule a validação do passo ①. Aplicado por
 * `scripts/limite-bucket-digital-twin.mjs`.
 */
export const LIMITE_DO_BUCKET_BYTES = Math.max(...Object.values(LIMITES_DO_UPLOAD_DIRETO).map((l) => l.maximoBytes))

export function ehTipoDeUploadDireto(tipo: unknown): tipo is TipoDeUploadDireto {
  return typeof tipo === 'string' && Object.prototype.hasOwnProperty.call(LIMITES_DO_UPLOAD_DIRETO, tipo)
}

/** `audio/webm;codecs=opus` → `audio/webm`. */
export function normalizarMime(mime: unknown): string {
  return typeof mime === 'string' ? mime.split(';')[0].trim().toLowerCase() : ''
}

/** Corpo JSON das rotas ① e ③ — metadados, nunca o arquivo. */
export const MAXIMO_CORPO_DAS_ROTAS_BYTES = 2048

/**
 * Decide pelos CABEÇALHOS, antes de ler qualquer byte do corpo: só JSON,
 * com tamanho declarado e pequeno. Multipart (o jeito antigo de mandar o
 * arquivo) nunca é lido.
 */
export function recusaPeloCabecalho(contentType: string | null, contentLength: string | null): { status: 411 | 413 | 415; motivo: string } | null {
  if (normalizarMime(contentType) !== 'application/json') {
    return { status: 415, motivo: 'Esta rota só aceita JSON. O arquivo vai direto ao armazenamento, nunca por aqui.' }
  }
  if (contentLength === null || !/^\d+$/.test(contentLength)) return { status: 411, motivo: 'Content-Length obrigatório.' }
  if (Number(contentLength) > MAXIMO_CORPO_DAS_ROTAS_BYTES) return { status: 413, motivo: 'Corpo grande demais para esta rota.' }
  return null
}

/** A confirmação ③ precisa acontecer dentro deste prazo após ①. */
export const VALIDADE_DA_INTENCAO_MS = 10 * 60_000

export type PedidoValidado = { ok: true; tipo: TipoDeUploadDireto; mime: string; tamanho: number } | { ok: false; motivo: string }

export function validarPedidoDeEnvio(corpo: { type?: unknown; mimeType?: unknown; size?: unknown }): PedidoValidado {
  if (!ehTipoDeUploadDireto(corpo.type)) {
    return { ok: false, motivo: `type precisa ser um de: ${Object.keys(LIMITES_DO_UPLOAD_DIRETO).join(', ')}` }
  }
  const limite = LIMITES_DO_UPLOAD_DIRETO[corpo.type]
  const mime = normalizarMime(corpo.mimeType)
  if (!(limite.mimes as readonly string[]).includes(mime)) {
    return { ok: false, motivo: `Formato não aceito para ${corpo.type}. Aceitos: ${limite.mimes.join(', ')}` }
  }
  const tamanho = corpo.size
  if (typeof tamanho !== 'number' || !Number.isInteger(tamanho) || tamanho <= 0) {
    return { ok: false, motivo: 'size precisa ser o tamanho do arquivo em bytes.' }
  }
  if (tamanho > limite.maximoBytes) {
    return { ok: false, motivo: `Arquivo maior que o permitido (${limite.maximoBytes / MB} MB).` }
  }
  return { ok: true, tipo: corpo.type, mime, tamanho }
}

// ── Caminho no bucket ────────────────────────────────────────────────────

/** Sempre gerado no servidor, a partir da sessão. Mesmo prefixo de antes. */
export function montarCaminhoDoAsset(workspaceId: string, profileId: string, tipo: TipoDeUploadDireto, agora: Date, aleatorio: string): string {
  return `${workspaceId}/${profileId}/${tipo.toLowerCase()}-${agora.getTime()}-${aleatorio}`
}

// ── Configuração ─────────────────────────────────────────────────────────

export function uploadDiretoConfigurado(env: Env = process.env): { ok: true } | { ok: false; motivo: string } {
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url)) return { ok: false, motivo: 'NEXT_PUBLIC_SUPABASE_URL ausente ou inválida' }
  const chave = env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!chave || chave === 'placeholder') return { ok: false, motivo: 'SUPABASE_SERVICE_ROLE_KEY ausente' }
  if (!env.NEXTAUTH_SECRET) return { ok: false, motivo: 'NEXTAUTH_SECRET ausente' }
  return { ok: true }
}

export const CODIGO_UPLOAD_DIRETO_INDISPONIVEL = 'UPLOAD_DIRETO_INDISPONIVEL'

// ── Intenção assinada ────────────────────────────────────────────────────

export interface IntencaoDeEnvio {
  workspaceId: string
  profileId: string
  tipo: TipoDeUploadDireto
  mime: string
  tamanho: number
  caminho: string
  purpose: string | null
  /** epoch ms */
  expiraEm: number
}

function chaveDaIntencao(segredo: string): Buffer {
  // Chave própria, derivada: um token desta finalidade não serve em outra.
  return createHmac('sha256', segredo).update('p2.11/digital-twin/upload-direto').digest()
}

function b64url(b: Buffer | string): string {
  return Buffer.from(b).toString('base64url')
}

export function assinarIntencao(intencao: IntencaoDeEnvio, segredo: string): string {
  const corpo = b64url(JSON.stringify(intencao))
  const assinatura = b64url(createHmac('sha256', chaveDaIntencao(segredo)).update(corpo).digest())
  return `${corpo}.${assinatura}`
}

export type IntencaoVerificada = { ok: true; intencao: IntencaoDeEnvio } | { ok: false; motivo: 'formato' | 'assinatura' | 'vencida' }

export function verificarIntencao(token: unknown, segredo: string, agora: number): IntencaoVerificada {
  if (typeof token !== 'string' || token.length > 1500) return { ok: false, motivo: 'formato' }
  const partes = token.split('.')
  if (partes.length !== 2) return { ok: false, motivo: 'formato' }
  const [corpo, assinatura] = partes
  const esperada = createHmac('sha256', chaveDaIntencao(segredo)).update(corpo).digest()
  const recebida = Buffer.from(assinatura, 'base64url')
  if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada)) return { ok: false, motivo: 'assinatura' }
  let intencao: IntencaoDeEnvio
  try {
    intencao = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, motivo: 'formato' }
  }
  if (typeof intencao.expiraEm !== 'number' || agora > intencao.expiraEm) return { ok: false, motivo: 'vencida' }
  return { ok: true, intencao }
}

// ── Conferência do objeto enviado (passo ③) ──────────────────────────────

/** O que o storage diz do objeto — nunca o conteúdo. */
export interface InfoDoObjeto {
  tamanho: number | null
  mime: string | null
}

export function validarObjetoEnviado(info: InfoDoObjeto, intencao: IntencaoDeEnvio): { ok: true } | { ok: false; motivo: string } {
  const limite = LIMITES_DO_UPLOAD_DIRETO[intencao.tipo]
  if (!limite) return { ok: false, motivo: 'Tipo não aceito.' }
  if (typeof info.tamanho !== 'number' || info.tamanho <= 0) return { ok: false, motivo: 'Arquivo vazio ou sem tamanho.' }
  if (info.tamanho > limite.maximoBytes) return { ok: false, motivo: 'Arquivo enviado maior que o permitido.' }
  if (info.tamanho !== intencao.tamanho) return { ok: false, motivo: 'Arquivo enviado diferente do informado.' }
  if (normalizarMime(info.mime) !== intencao.mime) return { ok: false, motivo: 'Formato do arquivo enviado diferente do informado.' }
  return { ok: true }
}
