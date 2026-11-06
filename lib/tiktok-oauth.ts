/**
 * TikTokOAuth (Rodada 6) — fluxo real de autorização do TikTokChannel
 * (Login Kit / Content Posting API). Propositalmente SEPARADO de qualquer
 * token do TikTok Shop (`lib/tiktok-shop-provider.ts`) — nunca o mesmo
 * client/escopo/token.
 *
 * Escopo principal (Direct Post): `video.publish`. Se/quando Upload/Draft
 * for implementado, usar o escopo oficial correspondente — documentado em
 * TIKTOK-INTEGRATION.md junto com finalidade/tela de cada escopo.
 *
 * `state` é assinado com HMAC (mesmo padrão de `lib/reset-token.ts`) —
 * sem tabela nova no banco, com TTL curto e verificação de assinatura
 * (proteção CSRF do OAuth). Nunca aceitamos um `state` não assinado por nós.
 *
 * Secrets (`TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`) só no servidor —
 * nunca `NEXT_PUBLIC_`, nunca devolvidos ao navegador.
 */

import crypto from 'crypto'

// P2.17.4 (auditoria): sem segredo não há state (fail-closed). Antes havia um
// segredo padrão conhecido, que permitiria forjar `state`.
function segredoDoState(): string {
  const s = process.env.NEXTAUTH_SECRET?.trim()
  if (!s) throw new Error('NEXTAUTH_SECRET ausente: não é possível proteger a autorização do TikTok.')
  return s
}
const STATE_TTL_MS = 10 * 60 * 1000 // 10 minutos — só o tempo de completar o redirect

/** Escopo do Direct Post (publicação direta). Só vale com o app auditado pelo TikTok. */
export const TIKTOK_SCOPES = ['video.publish'] as const

/**
 * P2.17.10 — Escopos pedidos na autorização. O mínimo para o fluxo oficial
 * sem auditoria (rascunho na caixa de entrada + métricas dos vídeos públicos):
 *   user.info.basic · video.upload · video.list
 * `video.publish` (Direct Post) só entra quando o app tiver esse produto
 * habilitado (TIKTOK_DIRECT_POST_HABILITADO=true): pedir escopo que o app não
 * tem faz o TikTok recusar a autorização inteira.
 */
export const ESCOPOS_BASE_DO_TIKTOK = ['user.info.basic', 'video.upload', 'video.list'] as const
export function escoposDoTikTok(env: Record<string, string | undefined> = process.env): string[] {
  const direto = (env.TIKTOK_DIRECT_POST_HABILITADO ?? '').trim().toLowerCase() === 'true'
  return [...ESCOPOS_BASE_DO_TIKTOK, ...(direto ? TIKTOK_SCOPES : [])]
}

export interface TikTokOAuthCredentials {
  clientKey: string
  clientSecret: string
  redirectUri: string
}

export function lerCredenciaisOAuthTikTok(): TikTokOAuthCredentials | null {
  const clientKey = process.env.TIKTOK_CLIENT_KEY
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET
  const redirectUri = process.env.TIKTOK_REDIRECT_URI
  if (!clientKey || !clientSecret || !redirectUri) return null
  return { clientKey, clientSecret, redirectUri }
}

function assinar(payload: string): string {
  return crypto.createHmac('sha256', segredoDoState()).update(payload).digest('base64url')
}

/** Gera um `state` assinado, amarrado ao workspace que iniciou o fluxo. */
export function gerarState(workspaceId: string): string {
  const exp = Date.now() + STATE_TTL_MS
  const nonce = crypto.randomBytes(12).toString('base64url')
  const payload = `${workspaceId}.${exp}.${nonce}`
  const sig = assinar(payload)
  return Buffer.from(`${payload}.${sig}`).toString('base64url')
}

/** Verifica o `state` recebido no callback — nunca aceita sem assinatura válida e dentro do TTL. */
export function validarState(state: string): { workspaceId: string } | null {
  let decoded: string
  try {
    decoded = Buffer.from(state, 'base64url').toString('utf8')
  } catch {
    return null
  }
  const partes = decoded.split('.')
  if (partes.length !== 4) return null
  const [workspaceId, expStr, nonce, sig] = partes
  const exp = parseInt(expStr, 10)
  if (!workspaceId || !nonce || !exp || Number.isNaN(exp) || Date.now() > exp) return null

  let esperado: string
  try {
    esperado = assinar(`${workspaceId}.${expStr}.${nonce}`)
  } catch {
    return null
  }
  const a = Buffer.from(sig)
  const b = Buffer.from(esperado)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null

  return { workspaceId }
}

/** Monta a URL de autorização real do TikTok (Login Kit). */
export function montarUrlAutorizacao(creds: TikTokOAuthCredentials, state: string): string {
  const params = new URLSearchParams({
    client_key: creds.clientKey,
    scope: escoposDoTikTok().join(','),
    response_type: 'code',
    redirect_uri: creds.redirectUri,
    state,
  })
  return `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`
}

export interface TikTokOAuthTokens {
  accessToken: string
  refreshToken: string
  expiresInSeconds: number
  refreshExpiresInSeconds: number
  openId: string
  scope: string
}

/** Troca o authorization code pelo access token — nunca reconstrói a URL manualmente para chamadas subsequentes. */
export async function trocarCodigoPorToken(
  creds: TikTokOAuthCredentials,
  code: string,
  fetcher: typeof fetch = fetch
): Promise<TikTokOAuthTokens> {
  const res = await fetcher('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'cache-control': 'no-cache' },
    body: new URLSearchParams({
      client_key: creds.clientKey,
      client_secret: creds.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: creds.redirectUri,
    }),
  })
  const data = await res.json()
  if (!res.ok || data.error) {
    throw new Error(data.error_description || data.error || 'Falha ao trocar o código de autorização por token.')
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresInSeconds: data.expires_in,
    refreshExpiresInSeconds: data.refresh_expires_in,
    openId: data.open_id,
    scope: data.scope,
  }
}

/** Renova o access token via refresh token — nunca pede novo consentimento se o refresh ainda for válido. */
export async function renovarAccessToken(
  creds: TikTokOAuthCredentials,
  refreshToken: string,
  fetcher: typeof fetch = fetch
): Promise<TikTokOAuthTokens> {
  const res = await fetcher('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'cache-control': 'no-cache' },
    body: new URLSearchParams({
      client_key: creds.clientKey,
      client_secret: creds.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })
  const data = await res.json()
  if (!res.ok || data.error) {
    throw new Error(data.error_description || data.error || 'Falha ao renovar o token do TikTok.')
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresInSeconds: data.expires_in,
    refreshExpiresInSeconds: data.refresh_expires_in,
    openId: data.open_id,
    scope: data.scope,
  }
}

/**
 * P2.17.26 — Revoga a autorização no TikTok quando a titular desconecta
 * (POST /v2/oauth/revoke/). Best-effort: a desconexão local (apagar tokens)
 * acontece mesmo se o TikTok não responder. Nunca loga o token.
 */
export async function revogarTokenTikTok(
  creds: Pick<TikTokOAuthCredentials, 'clientKey' | 'clientSecret'>,
  accessToken: string,
  fetcher: typeof fetch = fetch
): Promise<boolean> {
  try {
    const res = await fetcher('https://open.tiktokapis.com/v2/oauth/revoke/', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'cache-control': 'no-cache' },
      body: new URLSearchParams({ client_key: creds.clientKey, client_secret: creds.clientSecret, token: accessToken }),
    })
    return res.ok
  } catch {
    return false
  }
}
