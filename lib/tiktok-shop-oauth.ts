/**
 * P2.17 — Autorização de CRIADORA no TikTok Shop (Partner Center).
 *
 * Separado do OAuth do canal TikTok (`lib/tiktok-oauth.ts`, Login Kit): outro
 * app, outra chave, outro token. Nunca misturar.
 *
 * O que é oficial e o que ainda precisa ser conferido:
 *  - A URL de autorização é a que o Partner Center mostra para o app
 *    ("Authorization link"). Não a montamos: ela vem de
 *    `TIKTOK_SHOP_AUTHORIZE_URL`, copiada do painel. Só acrescentamos `state`.
 *  - Troca e renovação do token: `GET https://auth.tiktok-shops.com/api/v2/token/get`
 *    (`grant_type=authorized_code`) e `/api/v2/token/refresh`
 *    (`grant_type=refresh_token`). Fonte: guias de integração e SDKs públicos
 *    que citam a documentação do Partner Center [CONFIANÇA MÉDIA]. O código
 *    de autorização vale 30 min e só pode ser usado uma vez.
 *  - Campos da resposta lidos com tolerância (o formato exato será
 *    confirmado na primeira autorização real); campo ausente = erro, nunca
 *    valor inventado.
 *
 * Segurança:
 *  - `state` assinado (HMAC), amarrado a workspace + usuária + finalidade,
 *    com validade de 10 min: um `state` do Login Kit não serve aqui.
 *  - Sem `NEXTAUTH_SECRET` não há `state` (fail-closed).
 *  - Tokens só vão para `Integracao`, que o cofre cifra (lib/cofre-prisma.ts).
 *    Nada de token em log, auditoria ou resposta.
 */
import crypto from 'crypto'
import { prisma } from './prisma'
import { registrarAuditoria } from './audit-log'
import { flagLigada } from './feature-flags'

export const PLATAFORMA_CREATOR = 'tiktok-shop-creator'
export const FINALIDADE_STATE = 'tts-creator'
const STATE_TTL_MS = 10 * 60 * 1000
/** Renova quando faltar menos que isto para vencer. */
export const FOLGA_DE_RENOVACAO_MS = 10 * 60 * 1000

export const URL_TOKEN_GET = 'https://auth.tiktok-shops.com/api/v2/token/get'
export const URL_TOKEN_REFRESH = 'https://auth.tiktok-shops.com/api/v2/token/refresh'

export interface CredenciaisTikTokShop {
  appKey: string
  appSecret: string
  authorizeUrl: string
}

export function lerCredenciaisTikTokShopCreator(env: Record<string, string | undefined> = process.env): CredenciaisTikTokShop | null {
  const appKey = env.TIKTOK_SHOP_APP_KEY?.trim()
  const appSecret = env.TIKTOK_SHOP_APP_SECRET?.trim()
  const authorizeUrl = env.TIKTOK_SHOP_AUTHORIZE_URL?.trim()
  if (!appKey || !appSecret || !authorizeUrl) return null
  if (!urlDeAutorizacaoOficial(authorizeUrl)) return null
  return { appKey, appSecret, authorizeUrl }
}

const DOMINIOS_OFICIAIS = ['tiktokshop.com', 'tiktok-shops.com', 'tiktokglobalshop.com', 'tiktok.com']

/** Só aceita HTTPS num domínio do TikTok: a URL nunca leva a titular para outro lugar. */
export function urlDeAutorizacaoOficial(url: string): boolean {
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase()
    return u.protocol === 'https:' && DOMINIOS_OFICIAIS.some((d) => host === d || host.endsWith(`.${d}`))
  } catch {
    return false
  }
}

/**
 * A conexão só existe com credencial no servidor E a flag do workspace
 * ligada. Production não tem nenhuma das duas: lá a rota continua 501.
 */
export async function conexaoTikTokShopLiberada(workspaceId: string, env: Record<string, string | undefined> = process.env): Promise<boolean> {
  if (!lerCredenciaisTikTokShopCreator(env)) return false
  return flagLigada('TIKTOK_SHOP_CATALOGO', workspaceId, env)
}

// ── state ────────────────────────────────────────────────────────────────

function segredoDoState(env: Record<string, string | undefined>): string {
  const s = env.NEXTAUTH_SECRET?.trim()
  if (!s) throw new Error('NEXTAUTH_SECRET ausente: não é possível proteger a autorização do TikTok Shop.')
  return s
}

function hmac(payload: string, segredo: string): string {
  return crypto.createHmac('sha256', segredo).update(payload).digest('base64url')
}

export function gerarStateCreator(p: { workspaceId: string; userId: string; agora?: number }, env: Record<string, string | undefined> = process.env): string {
  const exp = (p.agora ?? Date.now()) + STATE_TTL_MS
  const nonce = crypto.randomBytes(12).toString('base64url')
  const payload = [FINALIDADE_STATE, p.workspaceId, p.userId, exp, nonce].join('.')
  return Buffer.from(`${payload}.${hmac(payload, segredoDoState(env))}`).toString('base64url')
}

export function validarStateCreator(
  state: string,
  agora: number = Date.now(),
  env: Record<string, string | undefined> = process.env
): { workspaceId: string; userId: string } | null {
  let partes: string[]
  try {
    partes = Buffer.from(state, 'base64url').toString('utf8').split('.')
  } catch {
    return null
  }
  if (partes.length !== 6) return null
  const [finalidade, workspaceId, userId, expStr, nonce, sig] = partes
  if (finalidade !== FINALIDADE_STATE || !workspaceId || !userId || !nonce) return null
  const exp = Number(expStr)
  if (!Number.isFinite(exp) || agora > exp) return null
  let segredo: string
  try {
    segredo = segredoDoState(env)
  } catch {
    return null
  }
  const esperado = Buffer.from(hmac(partes.slice(0, 5).join('.'), segredo))
  const recebido = Buffer.from(sig)
  if (esperado.length !== recebido.length || !crypto.timingSafeEqual(esperado, recebido)) return null
  return { workspaceId, userId }
}

/** A URL do painel, com o nosso `state` (substitui um `state` que já viesse nela). */
export function montarUrlDeAutorizacaoCreator(creds: CredenciaisTikTokShop, state: string): string {
  const u = new URL(creds.authorizeUrl)
  u.searchParams.set('state', state)
  return u.toString()
}

// ── token ────────────────────────────────────────────────────────────────

export interface TokensDaCriadora {
  accessToken: string
  refreshToken: string
  accessExpiraEm: Date
  refreshExpiraEm: Date | null
  openId: string | null
  nome: string | null
  regiao: string | null
  tipoDeUsuario: number | null
  escopos: string[]
}

export class ErroDeAutorizacaoTikTokShop extends Error {
  constructor(
    public readonly codigo: string,
    mensagem: string
  ) {
    super(mensagem)
  }
}

/**
 * `*_expire_in` aparece nas fontes como instante Unix (segundos). Se vier um
 * número pequeno, tratamos como "segundos a partir de agora". Nada é chutado:
 * sem o campo, a resposta é recusada.
 */
export function instanteDeExpiracao(valor: unknown, agora: number): Date | null {
  const n = typeof valor === 'string' ? Number(valor) : valor
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null
  return n > 1_000_000_000 ? new Date(n * 1000) : new Date(agora + n * 1000)
}

/** FUNÇÃO PURA: lê a resposta do endpoint de token. */
export function lerRespostaDeToken(corpo: unknown, agora: number = Date.now()): TokensDaCriadora {
  const r = (corpo ?? {}) as { code?: unknown; message?: unknown; data?: Record<string, unknown> }
  if (r.code !== 0 && r.code !== '0') {
    throw new ErroDeAutorizacaoTikTokShop(String(r.code ?? 'SEM_CODIGO'), `O TikTok Shop recusou a autorização: ${typeof r.message === 'string' ? r.message : 'sem mensagem'}.`)
  }
  const d = r.data ?? {}
  const accessToken = typeof d.access_token === 'string' ? d.access_token : ''
  const refreshToken = typeof d.refresh_token === 'string' ? d.refresh_token : ''
  const accessExpiraEm = instanteDeExpiracao(d.access_token_expire_in, agora)
  if (!accessToken || !refreshToken || !accessExpiraEm) {
    throw new ErroDeAutorizacaoTikTokShop('RESPOSTA_INCOMPLETA', 'A resposta do TikTok Shop veio sem token ou sem validade. Nada foi guardado.')
  }
  const escopos = Array.isArray(d.granted_scopes) ? d.granted_scopes.filter((s): s is string => typeof s === 'string') : []
  const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  return {
    accessToken,
    refreshToken,
    accessExpiraEm,
    refreshExpiraEm: instanteDeExpiracao(d.refresh_token_expire_in, agora),
    openId: texto(d.open_id),
    nome: texto(d.seller_name) ?? texto(d.user_name) ?? texto(d.creator_name),
    regiao: texto(d.seller_base_region) ?? texto(d.region),
    tipoDeUsuario: typeof d.user_type === 'number' ? d.user_type : null,
    escopos,
  }
}

async function chamarEndpointDeToken(url: string, query: Record<string, string>, fetcher: typeof fetch): Promise<unknown> {
  const u = new URL(url)
  for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v)
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 10_000)
  try {
    const res = await fetcher(u.toString(), { method: 'GET', signal: ctrl.signal, headers: { accept: 'application/json' } })
    const corpo = await res.json().catch(() => null)
    if (!res.ok && !corpo) throw new ErroDeAutorizacaoTikTokShop(`HTTP_${res.status}`, `O TikTok Shop respondeu HTTP ${res.status}.`)
    return corpo
  } catch (e) {
    if (e instanceof ErroDeAutorizacaoTikTokShop) throw e
    throw new ErroDeAutorizacaoTikTokShop('REDE', 'Não foi possível falar com o TikTok Shop agora. Tente de novo.')
  } finally {
    clearTimeout(t)
  }
}

export async function trocarCodigoDaCriadora(creds: CredenciaisTikTokShop, authCode: string, fetcher: typeof fetch = fetch): Promise<TokensDaCriadora> {
  const corpo = await chamarEndpointDeToken(
    URL_TOKEN_GET,
    { app_key: creds.appKey, app_secret: creds.appSecret, auth_code: authCode, grant_type: 'authorized_code' },
    fetcher
  )
  return lerRespostaDeToken(corpo)
}

export async function renovarTokenDaCriadora(creds: CredenciaisTikTokShop, refreshToken: string, fetcher: typeof fetch = fetch): Promise<TokensDaCriadora> {
  const corpo = await chamarEndpointDeToken(
    URL_TOKEN_REFRESH,
    { app_key: creds.appKey, app_secret: creds.appSecret, refresh_token: refreshToken, grant_type: 'refresh_token' },
    fetcher
  )
  return lerRespostaDeToken(corpo)
}

// ── persistência (cofre) ─────────────────────────────────────────────────

function extraDosTokens(t: TokensDaCriadora) {
  return {
    escopos: t.escopos,
    regiao: t.regiao,
    tipoDeUsuario: t.tipoDeUsuario,
    refreshExpiraEm: t.refreshExpiraEm?.toISOString() ?? null,
  }
}

export async function guardarTokensDaCriadora(p: { workspaceId: string; userId: string; tokens: TokensDaCriadora }) {
  const dados = {
    status: 'conectado',
    accessToken: p.tokens.accessToken,
    refreshToken: p.tokens.refreshToken,
    tokenExpiry: p.tokens.accessExpiraEm,
    accountId: p.tokens.openId,
    accountName: p.tokens.nome,
    extraData: extraDosTokens(p.tokens),
  }
  const integracao = await prisma.integracao.upsert({
    where: { workspaceId_plataforma: { workspaceId: p.workspaceId, plataforma: PLATAFORMA_CREATOR } },
    create: { ...dados, workspaceId: p.workspaceId, userId: p.userId, plataforma: PLATAFORMA_CREATOR },
    update: dados,
    select: { id: true },
  })
  await registrarAuditoria({
    workspaceId: p.workspaceId,
    userId: p.userId,
    action: 'integracao.conectada',
    entityType: 'Integracao',
    entityId: integracao.id,
    metadata: { plataforma: PLATAFORMA_CREATOR, escopos: p.tokens.escopos, regiao: p.tokens.regiao },
  })
  return integracao
}

export type EstadoDoTokenDaCriadora =
  | { ok: true; accessToken: string; openId: string | null; escopos: string[] }
  | { ok: false; motivo: 'NAO_CONECTADO' | 'RECONECTAR' | 'SEM_CREDENCIAL' | 'FALHA_NA_RENOVACAO'; mensagem: string }

/**
 * Token válido da criadora, renovando quando estiver perto de vencer. Refresh
 * vencido = reconectar (nunca tenta renovar com token morto).
 */
export async function obterTokenDaCriadora(
  workspaceId: string,
  deps: { fetcher?: typeof fetch; agora?: number; env?: Record<string, string | undefined> } = {}
): Promise<EstadoDoTokenDaCriadora> {
  const agora = deps.agora ?? Date.now()
  const i = await prisma.integracao.findUnique({ where: { workspaceId_plataforma: { workspaceId, plataforma: PLATAFORMA_CREATOR } } })
  if (!i || i.status !== 'conectado' || !i.accessToken) {
    return { ok: false, motivo: 'NAO_CONECTADO', mensagem: 'A conta de criadora do TikTok Shop não está conectada.' }
  }
  const extra = (i.extraData ?? {}) as { escopos?: string[]; refreshExpiraEm?: string | null }
  const escopos = Array.isArray(extra.escopos) ? extra.escopos : []
  if (i.tokenExpiry && i.tokenExpiry.getTime() - agora > FOLGA_DE_RENOVACAO_MS) {
    return { ok: true, accessToken: i.accessToken, openId: i.accountId, escopos }
  }
  const refreshVence = extra.refreshExpiraEm ? new Date(extra.refreshExpiraEm).getTime() : null
  if (!i.refreshToken || (refreshVence !== null && refreshVence <= agora)) {
    await marcarParaReconectar(workspaceId, i.id, 'refresh vencido')
    return { ok: false, motivo: 'RECONECTAR', mensagem: 'A autorização do TikTok Shop venceu. Conecte de novo em Integrações.' }
  }
  const creds = lerCredenciaisTikTokShopCreator(deps.env)
  if (!creds) return { ok: false, motivo: 'SEM_CREDENCIAL', mensagem: 'O app do TikTok Shop não está configurado no servidor.' }
  try {
    const t = await renovarTokenDaCriadora(creds, i.refreshToken, deps.fetcher)
    // P2.17.4 (auditoria): trava otimista — se outra coleta renovou primeiro, usa o token dela.
    const gravou = await prisma.integracao.updateMany({
      where: { id: i.id, updatedAt: i.updatedAt },
      data: { accessToken: t.accessToken, refreshToken: t.refreshToken, tokenExpiry: t.accessExpiraEm, extraData: extraDosTokens(t) },
    })
    if (gravou.count === 0) {
      const atual = await tokenRenovadoPorOutro(workspaceId, agora)
      if (atual) return atual
    }
    await registrarAuditoria({ workspaceId, action: 'integracao.token_renovado', entityType: 'Integracao', entityId: i.id, metadata: { plataforma: PLATAFORMA_CREATOR } })
    return { ok: true, accessToken: t.accessToken, openId: t.openId ?? i.accountId, escopos: t.escopos.length ? t.escopos : escopos }
  } catch (e) {
    const codigo = e instanceof ErroDeAutorizacaoTikTokShop ? e.codigo : 'DESCONHECIDO'
    // Corrida: outra coleta pode ter renovado (e invalidado este refresh) agora mesmo.
    const atual = await tokenRenovadoPorOutro(workspaceId, agora)
    if (atual) return atual
    // Falha de rede não derruba a conexão; recusa do TikTok, sim.
    if (codigo !== 'REDE' && !codigo.startsWith('HTTP_5')) await marcarParaReconectar(workspaceId, i.id, `renovação recusada (${codigo})`)
    return { ok: false, motivo: 'FALHA_NA_RENOVACAO', mensagem: 'Não consegui renovar o acesso ao TikTok Shop.' }
  }
}

/** Relê a integração: se já há token válido (renovado por outra execução), usa ele. */
async function tokenRenovadoPorOutro(workspaceId: string, agora: number): Promise<EstadoDoTokenDaCriadora | null> {
  const r = await prisma.integracao.findUnique({ where: { workspaceId_plataforma: { workspaceId, plataforma: PLATAFORMA_CREATOR } } })
  if (!r || r.status !== 'conectado' || !r.accessToken || !r.tokenExpiry || r.tokenExpiry.getTime() - agora <= FOLGA_DE_RENOVACAO_MS) return null
  const extra = (r.extraData ?? {}) as { escopos?: string[] }
  return { ok: true, accessToken: r.accessToken, openId: r.accountId, escopos: Array.isArray(extra.escopos) ? extra.escopos : [] }
}

async function marcarParaReconectar(workspaceId: string, id: string, motivo: string) {
  await prisma.integracao.update({ where: { id }, data: { status: 'expirado' } })
  await registrarAuditoria({ workspaceId, action: 'integracao.expirada', entityType: 'Integracao', entityId: id, metadata: { plataforma: PLATAFORMA_CREATOR, motivo } })
}

/**
 * Desconectar: apaga os tokens do nosso lado. Não encontramos endpoint
 * público de revogação no Partner Center; a titular também pode remover a
 * autorização pelo próprio TikTok Shop.
 */
export async function desconectarCriadora(p: { workspaceId: string; userId: string }): Promise<boolean> {
  const r = await prisma.integracao.updateMany({
    where: { workspaceId: p.workspaceId, plataforma: PLATAFORMA_CREATOR },
    data: { status: 'desconectado', accessToken: null, refreshToken: null, tokenExpiry: null, accountId: null, accountName: null, extraData: {} },
  })
  if (r.count) {
    await registrarAuditoria({ workspaceId: p.workspaceId, userId: p.userId, action: 'integracao.desconectada', entityType: 'Integracao', entityId: p.workspaceId, metadata: { plataforma: PLATAFORMA_CREATOR } })
  }
  return r.count > 0
}
