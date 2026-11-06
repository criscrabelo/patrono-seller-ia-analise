// Publicação de Reels no Instagram via Instagram Graph API (Meta).
// Requer um Access Token e o ID da conta comercial do Instagram,
// configurados na página de Integrações.

const API_VERSION = 'v21.0'

// A Meta tem DOIS fluxos diferentes para publicar no Instagram, cada um com
// seu próprio host e formato de token:
//
//  - "Instagram API with Instagram login"  -> graph.instagram.com, token IGAA.../IGQ...
//  - "Instagram API with Facebook login"   -> graph.facebook.com,  token EAA...
//
// Aceitamos os dois: o host é escolhido pelo prefixo do token, então o
// usuário pode colar o que obteve em qualquer um dos fluxos.
function apiBase(accessToken: string): string {
  const host = accessToken.startsWith('IG') ? 'graph.instagram.com' : 'graph.facebook.com'
  return `https://${host}/${API_VERSION}`
}

/** True se o token é do fluxo "Instagram login" (e não do Facebook login). */
function isTokenInstagram(accessToken: string): boolean {
  return accessToken.startsWith('IG')
}

export interface PublicarReelParams {
  accessToken: string
  igUserId: string
  videoUrl: string
  legenda: string
}

/**
 * A Meta RESPONDEU com erro. Diferente de falha de rede, que chega como
 * exceção do `fetch` sem resposta nenhuma.
 *
 * A diferença decide se dá para repetir uma publicação: com resposta 4xx e
 * corpo de erro da Graph API, a Meta recusou e nada foi ao ar. Sem
 * resposta (rede, timeout) ou com 5xx, ninguém sabe — ver
 * `metaRecusouComCerteza`.
 */
export class ErroDaApiInstagram extends Error {
  constructor(
    mensagem: string,
    public readonly status: number,
    public readonly temCorpoDeErro: boolean
  ) {
    super(mensagem)
    this.name = 'ErroDaApiInstagram'
  }
}

/** `true` só quando a Meta recusou explicitamente (4xx com erro da Graph API). */
export function metaRecusouComCerteza(e: unknown): boolean {
  return e instanceof ErroDaApiInstagram && e.temCorpoDeErro && e.status >= 400 && e.status < 500
}

// P2.69 (revisão independente B3): chamadas de TOKEN (inspeção, validação, renovação) com tempo limite — Meta lenta não
// pode travar o cron nem a função da Netlify (30 s). As de publicação ficam como estavam (fora do escopo deste release).
export const TEMPO_LIMITE_META_MS = 15_000
const comTempoLimite = (): RequestInit => ({ signal: AbortSignal.timeout(TEMPO_LIMITE_META_MS) })
async function fbFetch(url: string, init?: RequestInit) {
  const res = await fetch(url, init)
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data?.error) {
    const msg = data?.error?.message || `Erro HTTP ${res.status} na API do Instagram`
    throw new ErroDaApiInstagram(msg, res.status, !!data?.error)
  }
  return data
}

/**
 * Publica um Reels no Instagram.
 * 1) cria o container de mídia, 2) aguarda o processamento do vídeo,
 * 3) publica. Retorna o ID da mídia publicada.
 */
export async function publicarReelInstagram({
  accessToken,
  igUserId,
  videoUrl,
  legenda,
}: PublicarReelParams): Promise<string> {
  // 1. Cria o container de mídia (REELS)
  const criar = await fbFetch(`${apiBase(accessToken)}/${igUserId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      media_type: 'REELS',
      video_url: videoUrl,
      caption: legenda,
      access_token: accessToken,
    }),
  })
  const containerId = criar.id as string
  if (!containerId) throw new Error('Instagram não retornou o ID do container de mídia')

  // 2. Aguarda o Instagram processar o vídeo (Reels leva alguns segundos)
  const MAX_POLLS = 8
  const INTERVALO = 5000
  let pronto = false
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, INTERVALO))
    const status = await fbFetch(
      `${apiBase(accessToken)}/${containerId}?fields=status_code&access_token=${encodeURIComponent(accessToken)}`
    )
    if (status.status_code === 'FINISHED') {
      pronto = true
      break
    }
    if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') {
      throw new Error(`O Instagram falhou ao processar o vídeo (${status.status_code})`)
    }
  }
  if (!pronto) {
    throw new Error(
      'O vídeo ainda está sendo processado pelo Instagram. Tente publicar novamente em instantes.'
    )
  }

  // 3. Publica o container
  const publicar = await fbFetch(`${apiBase(accessToken)}/${igUserId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      creation_id: containerId,
      access_token: accessToken,
    }),
  })
  const mediaId = publicar.id as string
  if (!mediaId) throw new Error('Instagram não retornou o ID da publicação')
  return mediaId
}

/** Cria o container de mídia (REELS) e retorna o containerId. */
export async function criarContainerReel(params: {
  accessToken: string
  igUserId: string
  videoUrl: string
  legenda: string
}): Promise<string> {
  const criar = await fbFetch(`${apiBase(params.accessToken)}/${params.igUserId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      media_type: 'REELS',
      video_url: params.videoUrl,
      caption: params.legenda,
      access_token: params.accessToken,
    }),
  })
  const containerId = criar.id as string | undefined
  if (!containerId) throw new Error('Instagram não retornou o ID do container de mídia')
  return containerId
}

/** Consulta o status de processamento de um container (FINISHED/IN_PROGRESS/ERROR). */
export async function statusContainer(params: {
  accessToken: string
  containerId: string
}): Promise<string> {
  const data = await fbFetch(
    `${apiBase(params.accessToken)}/${params.containerId}?fields=status_code&access_token=${encodeURIComponent(params.accessToken)}`
  )
  return (data.status_code as string) || 'IN_PROGRESS'
}

/** Publica um container já processado (FINISHED). Retorna o ID da mídia. */
export async function publicarContainer(params: {
  accessToken: string
  igUserId: string
  containerId: string
}): Promise<string> {
  const publicar = await fbFetch(`${apiBase(params.accessToken)}/${params.igUserId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      creation_id: params.containerId,
      access_token: params.accessToken,
    }),
  })
  const mediaId = publicar.id as string | undefined
  if (!mediaId) throw new Error('Instagram não retornou o ID da publicação')
  return mediaId
}

/** Helper genérico: cria um container de mídia no Instagram e retorna o ID. */
async function postarMedia(
  igUserId: string,
  accessToken: string,
  campos: Record<string, unknown>
): Promise<string> {
  const data = await fbFetch(`${apiBase(accessToken)}/${igUserId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...campos, access_token: accessToken }),
  })
  const id = data.id as string | undefined
  if (!id) throw new Error('Instagram não retornou o ID do container de mídia')
  return id
}

/** Container de VÍDEO para Stories. */
export async function criarContainerStoryVideo(params: {
  accessToken: string
  igUserId: string
  videoUrl: string
}): Promise<string> {
  return postarMedia(params.igUserId, params.accessToken, {
    media_type: 'STORIES',
    video_url: params.videoUrl,
  })
}

/** Container de IMAGEM única para o Feed. */
export async function criarContainerImagemFeed(params: {
  accessToken: string
  igUserId: string
  imageUrl: string
  legenda: string
}): Promise<string> {
  return postarMedia(params.igUserId, params.accessToken, {
    image_url: params.imageUrl,
    caption: params.legenda,
  })
}

/** Container de IMAGEM para Stories (Stories não têm legenda). */
export async function criarContainerStoryImagem(params: {
  accessToken: string
  igUserId: string
  imageUrl: string
}): Promise<string> {
  return postarMedia(params.igUserId, params.accessToken, {
    media_type: 'STORIES',
    image_url: params.imageUrl,
  })
}

/** Cria um CARROSSEL no Feed: um container-filho por imagem + o container do carrossel. */
export async function criarContainerCarrossel(params: {
  accessToken: string
  igUserId: string
  imageUrls: string[]
  legenda: string
}): Promise<string> {
  // Instagram aceita de 2 a 10 itens no carrossel.
  const urls = params.imageUrls.slice(0, 10)
  const filhos: string[] = []
  for (const url of urls) {
    const filhoId = await postarMedia(params.igUserId, params.accessToken, {
      image_url: url,
      is_carousel_item: true,
    })
    filhos.push(filhoId)
  }
  return postarMedia(params.igUserId, params.accessToken, {
    media_type: 'CAROUSEL',
    children: filhos,
    caption: params.legenda,
  })
}

/** Monta a legenda final: texto + chamada para ação + link de compra + hashtags. */
export function montarLegenda(
  legendaInstagram?: string | null,
  hashtags?: string[],
  chamadaAcao?: string | null,
  linkCompra?: string | null
): string {
  return [
    legendaInstagram?.trim(),
    chamadaAcao?.trim(),
    linkCompra ? `🛒 Compre aqui: ${linkCompra}` : '',
    (hashtags ?? []).join(' ').trim(),
  ]
    .filter(Boolean)
    .join('\n\n')
}

/**
 * Renova um token de longa duração, usando o fluxo correto para cada tipo:
 *  - Instagram login (IGAA...): grant ig_refresh_token (não precisa de app id/secret)
 *  - Facebook login (EAA...):   grant fb_exchange_token (exige app id + secret)
 * Retorna o novo token e quantos segundos até expirar (~5184000 = 60 dias).
 */
export async function renovarTokenInstagram(params: {
  accessToken: string
  appId?: string
  appSecret?: string
}): Promise<{ accessToken: string; expiresIn: number }> {
  let url: string

  if (isTokenInstagram(params.accessToken)) {
    // Instagram Login API: basta o token atual (válido, com +24h de vida).
    url =
      `https://graph.instagram.com/refresh_access_token` +
      `?grant_type=ig_refresh_token` +
      `&access_token=${encodeURIComponent(params.accessToken)}`
  } else {
    // Facebook Login: troca o token atual por um novo de longa duração.
    if (!params.appId || !params.appSecret) {
      throw new Error(
        'Para renovar um token do Facebook (EAA...) é preciso informar o Meta App ID e o App Secret.'
      )
    }
    url =
      `https://graph.facebook.com/${API_VERSION}/oauth/access_token` +
      `?grant_type=fb_exchange_token` +
      `&client_id=${encodeURIComponent(params.appId)}` +
      `&client_secret=${encodeURIComponent(params.appSecret)}` +
      `&fb_exchange_token=${encodeURIComponent(params.accessToken)}`
  }

  const data = await fbFetch(url, comTempoLimite())

  if (!data.access_token) {
    throw new Error('Instagram não retornou um novo access_token na renovação')
  }

  // P2.69 (revisão B1): sem `expires_in` da Meta não se presume validade (antes: 60 dias por suposição).
  const expiresIn = Number(data.expires_in)
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) throw new Error('A Meta não informou a validade do token renovado: nada foi gravado.')
  return {
    accessToken: data.access_token as string,
    expiresIn,
  }
}

/**
 * Verifica se o token realmente funciona, consultando a conta na API da Meta.
 * Usado ao conectar, para não salvar como "conectado" um token morto/inválido.
 * Retorna o nome de usuário da conta quando dá certo.
 */
export async function validarCredenciaisInstagram(params: {
  accessToken: string
  igUserId: string
}): Promise<{ username?: string }> {
  const data = await fbFetch(
    `${apiBase(params.accessToken)}/${params.igUserId}` +
      `?fields=username&access_token=${encodeURIComponent(params.accessToken)}`,
    comTempoLimite()
  )
  return { username: data.username as string | undefined }
}

/**
 * Descobre quando o token expira DE VERDADE, em vez de assumir 60 dias.
 * Só funciona para tokens do Facebook (EAA...) com App ID + Secret, via
 * debug_token. Retorna null quando não é possível descobrir — aí quem chama
 * decide o fallback.
 */
export async function descobrirExpiracaoToken(params: {
  accessToken: string
  appId?: string
  appSecret?: string
}): Promise<Date | null> {
  return (await inspecionarTokenMeta(params)).expiraEm
}

/**
 * O que a Meta afirma sobre ESTE token: validade e permissões concedidas.
 *
 * Mesma chamada oficial de sempre (`debug_token`) — a resposta já traz
 * `scopes` ao lado de `expires_at`, e até agora só líamos metade dela. Não
 * há endpoint novo aqui, e nenhuma permission é inventada: o que volta é o
 * que a própria Meta diz que a conta concedeu.
 *
 * `scopes: null` significa NÃO VERIFICÁVEL, nunca "nenhum". Token do fluxo
 * "Instagram login" (IGAA…) não passa por `debug_token`, e sem App
 * ID/Secret não há como perguntar — nos dois casos a resposta honesta é
 * "não sei", que fail-closed trata como bloqueio.
 */
export interface InspecaoDeTokenMeta {
  expiraEm: Date | null
  scopes: string[] | null
  motivo: string
  /**
   * P2.68: a Meta CONFIRMOU que o token não expira (debug_token válido com expires_at = 0, ex.: usuário de sistema).
   * `expiraEm: null` sozinho é ambíguo ("sem prazo" × "não sei"): antes, a conexão gravava 59 dias por suposição, e
   * a renovação automática tentaria "renovar" um token que nunca vence (caso real do Instagram em 27/10/2026).
   */
  semPrazo?: boolean
  /** P2.69: o que a Meta disse sobre validade/tipo (null = não verificável) */
  valido?: boolean | null
  tipo?: string | null
  dataAccessExpiraEm?: Date | null
}

export async function inspecionarTokenMeta(params: {
  accessToken: string
  appId?: string
  appSecret?: string
}): Promise<InspecaoDeTokenMeta> {
  if (isTokenInstagram(params.accessToken)) {
    return {
      expiraEm: null,
      scopes: null,
      motivo: 'Token do fluxo "Instagram login": a Meta nao expoe debug_token para ele.',
    }
  }
  if (!params.appId || !params.appSecret) {
    return {
      expiraEm: null,
      scopes: null,
      motivo: 'Sem Meta App ID e App Secret nao ha como perguntar a Meta o que foi concedido.',
    }
  }

  try {
    const data = await fbFetch(
      `https://graph.facebook.com/${API_VERSION}/debug_token` +
        `?input_token=${encodeURIComponent(params.accessToken)}` +
        `&access_token=${encodeURIComponent(`${params.appId}|${params.appSecret}`)}`,
      comTempoLimite()
    )
    const corpo = (data?.data ?? {}) as { expires_at?: number; scopes?: unknown; is_valid?: boolean; type?: string; data_access_expires_at?: number }
    const expiresAt = corpo.expires_at
    // expires_at 0 (ou ausente) = token sem prazo de validade.
    const expiraEm =
      typeof expiresAt !== 'number' || expiresAt === 0 ? null : new Date(expiresAt * 1000)
    const dataAccessExpiraEm = typeof corpo.data_access_expires_at === 'number' && corpo.data_access_expires_at > 0 ? new Date(corpo.data_access_expires_at * 1000) : null

    // Um token que a Meta diz ser invalido nao comprova permissao nenhuma.
    if (corpo.is_valid === false) {
      return { expiraEm, scopes: null, motivo: 'A Meta respondeu que este token nao e valido.', valido: false, tipo: corpo.type ?? null, dataAccessExpiraEm }
    }

    const scopes = Array.isArray(corpo.scopes)
      ? corpo.scopes.map((s) => String(s).trim()).filter(Boolean)
      : null

    return {
      expiraEm,
      scopes,
      motivo: scopes ? 'Permissoes confirmadas pela Meta via debug_token.' : 'A Meta nao devolveu a lista de permissoes.',
      // P2.69 (revisão B2): "sem prazo" só para USUÁRIO DE SISTEMA, válido, sem vencimento E sem prazo de acesso aos dados.
      // Token de página/usuário também mostra expires_at 0, mas perde o acesso (data_access ~90 dias, troca de senha).
      semPrazo: corpo.is_valid === true && expiresAt === 0 && corpo.type === 'SYSTEM_USER' && !dataAccessExpiraEm,
      valido: corpo.is_valid === true ? true : null,
      tipo: corpo.type ?? null,
      dataAccessExpiraEm,
    }
  } catch {
    // debug_token é um extra: se falhar, não impede a conexão — mas também
    // não passa a comprovar nada.
    return { expiraEm: null, scopes: null, motivo: 'A consulta a debug_token falhou.' }
  }
}
