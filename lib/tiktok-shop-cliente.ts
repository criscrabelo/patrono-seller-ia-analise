/**
 * P2.17 — Cliente oficial da TikTok Shop Open API (só leitura nesta fase).
 *
 * - Assinatura: lib/tiktok-shop-signer.ts (HMAC-SHA256; `sign` e
 *   `access_token` fora do cálculo). Token no header `x-tts-access-token`.
 * - Parâmetros comuns: `app_key`, `timestamp` (segundos), `sign`.
 * - Limite local por workspace+caminho (não substitui o limite oficial),
 *   timeout de 8 s, retentativa só para rede, HTTP 429 e 5xx, com espera
 *   exponencial. Erro de permissão/autenticação NÃO é repetido.
 * - Escrita: só a vitrine (lib/tiktok-shop-vitrine.ts), com `tentativas: 1`
 *   e confirmação por leitura. Link de afiliada continua não implementado.
 *
 * ⚠️ Caminho do endpoint "Creator Search Open Collaboration Product": o nome
 * e o escopo (Read Creator Affiliate Collaborations) constam do Partner
 * Center; o CAMINHO exato não pôde ser lido (página renderizada por
 * JavaScript, acesso exige conta). Fica numa constante marcada como NÃO
 * CONFIRMADA e pode ser trocado por `TIKTOK_SHOP_PATH_BUSCA_COLABORACAO`
 * sem mudar código. A primeira chamada real confirma ou corrige.
 */
import { comAssinatura } from './tiktok-shop-signer'
import { TikTokRateLimiter, type TikTokRateLimit } from './tiktok-rate-limiter'

export const HOST_OPEN_API = 'https://open-api.tiktokglobalshop.com'

export const ENDPOINT_BUSCA_COLABORACAO_ABERTA = {
  nome: 'Creator Search Open Collaboration Product',
  escopo: 'Read Creator Affiliate Collaborations',
  metodo: 'POST' as const,
  caminhoPadrao: '/affiliate_creator/202405/open_collaborations/products/search',
  caminhoConfirmado: false,
}

export function caminhoDaBusca(env: Record<string, string | undefined> = process.env): string {
  const p = env.TIKTOK_SHOP_PATH_BUSCA_COLABORACAO?.trim()
  return p && /^\/[a-z0-9_/]+$/i.test(p) ? p : ENDPOINT_BUSCA_COLABORACAO_ABERTA.caminhoPadrao
}

export const LIMITE_LOCAL: TikTokRateLimit = { maxChamadas: 5, janelaMs: 1000 }
export const TIMEOUT_MS = 8000
export const TENTATIVAS = 3

export type TipoDeErro = 'LIMITE_LOCAL' | 'AUTENTICACAO' | 'PERMISSAO' | 'LIMITE_OFICIAL' | 'INDISPONIVEL' | 'REDE' | 'RECUSADO'

export class ErroDaTikTokShop extends Error {
  constructor(
    public readonly tipo: TipoDeErro,
    public readonly codigo: string,
    mensagem: string,
    public readonly requestId: string | null = null
  ) {
    super(mensagem)
  }
  get repetivel() {
    return this.tipo === 'REDE' || this.tipo === 'LIMITE_OFICIAL' || this.tipo === 'INDISPONIVEL'
  }
}

export interface DepsDoCliente {
  appKey: string
  appSecret: string
  accessToken: string
  chaveDeLimite: string
  fetcher?: typeof fetch
  esperar?: (ms: number) => Promise<void>
  relogio?: () => number
  limitador?: TikTokRateLimiter
  host?: string
}

const limitadorPadrao = new TikTokRateLimiter()

/** FUNÇÃO PURA: classifica HTTP + corpo. `null` = sucesso. */
export function classificarResposta(status: number, corpo: unknown): ErroDaTikTokShop | null {
  const c = (corpo ?? {}) as { code?: unknown; message?: unknown; request_id?: unknown }
  const requestId = typeof c.request_id === 'string' ? c.request_id : null
  const msg = typeof c.message === 'string' ? c.message : `HTTP ${status}`
  if (status === 429) return new ErroDaTikTokShop('LIMITE_OFICIAL', 'HTTP_429', 'Limite de chamadas do TikTok Shop atingido.', requestId)
  if (status >= 500) return new ErroDaTikTokShop('INDISPONIVEL', `HTTP_${status}`, 'TikTok Shop indisponível no momento.', requestId)
  if (status === 401) return new ErroDaTikTokShop('AUTENTICACAO', 'HTTP_401', 'Acesso ao TikTok Shop recusado: reconectar.', requestId)
  if (status === 403) return new ErroDaTikTokShop('PERMISSAO', 'HTTP_403', 'O app não tem permissão para esta função do TikTok Shop.', requestId)
  if (status >= 400) return new ErroDaTikTokShop('RECUSADO', `HTTP_${status}`, msg, requestId)
  if (c.code === 0 || c.code === '0') return null
  return new ErroDaTikTokShop('RECUSADO', String(c.code ?? 'SEM_CODIGO'), `TikTok Shop recusou a chamada: ${msg}`, requestId)
}

export async function chamarOpenApi<T = unknown>(
  /**
   * `tentativas`: 1 para ESCRITA (ex.: adicionar à vitrine) — nunca reenviar
   * às cegas; o resultado incerto é resolvido por leitura, não por repetição.
   */
  req: { metodo: 'GET' | 'POST'; caminho: string; query?: Record<string, string | number>; corpo?: unknown; tentativas?: number },
  deps: DepsDoCliente
): Promise<{ data: T; requestId: string | null }> {
  const fetcher = deps.fetcher ?? fetch
  const esperar = deps.esperar ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const relogio = deps.relogio ?? Date.now
  const limitador = deps.limitador ?? limitadorPadrao
  if (!limitador.podeChamar(`${deps.chaveDeLimite}:${req.caminho}`, LIMITE_LOCAL)) {
    throw new ErroDaTikTokShop('LIMITE_LOCAL', 'LIMITE_LOCAL', 'Muitas chamadas seguidas ao TikTok Shop; tente em instantes.')
  }
  const corpoBruto = req.corpo === undefined ? undefined : JSON.stringify(req.corpo)

  let ultimo: ErroDaTikTokShop | null = null
  const maximo = Math.max(1, Math.min(req.tentativas ?? TENTATIVAS, TENTATIVAS))
  for (let tentativa = 1; tentativa <= maximo; tentativa++) {
    // timestamp novo a cada tentativa: a assinatura acompanha.
    const query = { ...(req.query ?? {}), app_key: deps.appKey, timestamp: Math.floor(relogio() / 1000) }
    const assinada = comAssinatura({ path: req.caminho, query, metodo: req.metodo, corpoBruto }, deps.appSecret)
    const url = `${deps.host ?? HOST_OPEN_API}${req.caminho}?${new URLSearchParams(assinada).toString()}`
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    try {
      const res = await fetcher(url, {
        method: req.metodo,
        headers: { 'content-type': 'application/json', 'x-tts-access-token': deps.accessToken },
        body: corpoBruto,
        signal: ctrl.signal,
      })
      const corpo = await res.json().catch(() => null)
      const erro = classificarResposta(res.status, corpo)
      if (!erro) {
        const c = corpo as { data?: T; request_id?: string }
        return { data: (c.data ?? ({} as T)) as T, requestId: c.request_id ?? null }
      }
      ultimo = erro
    } catch (e) {
      ultimo = e instanceof ErroDaTikTokShop ? e : new ErroDaTikTokShop('REDE', 'REDE', 'Não foi possível falar com o TikTok Shop.')
    } finally {
      clearTimeout(t)
    }
    if (!ultimo.repetivel || tentativa === maximo) break
    await esperar(500 * 2 ** (tentativa - 1))
  }
  throw ultimo!
}

// ── Busca de produtos de colaboração aberta ─────────────────────────────

/**
 * ⚠️ Nomes dos filtros NÃO CONFIRMADOS. A descoberta automática
 * (lib/tiktok-shop-descoberta.ts) não envia filtro nenhum (corpo `{}`) até a
 * primeira resposta real confirmar o contrato; isto existe para a
 * conferência manual no Partner Center.
 */
export interface FiltrosDaBusca {
  palavrasChave?: string
  categoriaId?: string
  comissaoMinimaPercentual?: number
}

export interface PaginaDaBusca {
  produtos: Record<string, unknown>[]
  proximaPagina: string | null
  total: number | null
  requestId: string | null
}

/** Lista de produtos dentro da resposta, procurando nos nomes prováveis. */
export function extrairPagina(data: unknown, requestId: string | null): PaginaDaBusca {
  const d = (data ?? {}) as Record<string, unknown>
  const lista = ['products', 'product_list', 'items', 'list'].map((k) => d[k]).find(Array.isArray) as unknown[] | undefined
  const prox = ['next_page_token', 'next_cursor', 'page_token'].map((k) => d[k]).find((v) => typeof v === 'string' && v) as string | undefined
  const total = typeof d.total_count === 'number' ? d.total_count : typeof d.total === 'number' ? d.total : null
  return {
    produtos: (lista ?? []).filter((x): x is Record<string, unknown> => !!x && typeof x === 'object'),
    proximaPagina: prox ?? null,
    total,
    requestId,
  }
}

export async function buscarProdutosDeColaboracaoAberta(
  p: { filtros?: FiltrosDaBusca; tamanhoDaPagina?: number; pagina?: string | null; env?: Record<string, string | undefined> },
  deps: DepsDoCliente
): Promise<PaginaDaBusca> {
  const corpo: Record<string, unknown> = {}
  if (p.filtros?.palavrasChave) corpo.title_keywords = [p.filtros.palavrasChave]
  if (p.filtros?.categoriaId) corpo.category = { id: p.filtros.categoriaId }
  // P2.17.4 (auditoria): filtro de comissão NÃO é enviado — a unidade (percentual ou
  // pontos-base) não foi confirmada; mandar um palpite filtraria errado.
  const query: Record<string, string | number> = { page_size: Math.min(Math.max(p.tamanhoDaPagina ?? 20, 1), 50) }
  if (p.pagina) query.page_token = p.pagina
  const r = await chamarOpenApi({ metodo: 'POST', caminho: caminhoDaBusca(p.env), query, corpo }, deps)
  return extrairPagina(r.data, r.requestId)
}
