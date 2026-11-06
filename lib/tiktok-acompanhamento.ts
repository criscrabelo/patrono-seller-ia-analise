/**
 * P2.17.10 — Acompanhamento assíncrono das publicações no TikTok.
 *
 * Fontes oficiais (developers.tiktok.com, 11/10/2026):
 *   POST /v2/post/publish/status/fetch/  → status + publicaly_available_post_id (grafia do TikTok)
 *   webhooks post.publish.*              → publish_id, post_id (publicly_available), reason (failed)
 *   POST /v2/video/query/                → share_url do vídeo (escopo video.list)
 *
 * Regras:
 *   - DISTRIBUIDA só com o post_id PÚBLICO (nunca com o publish_id);
 *   - status desconhecido = continua processando (nunca vira falha sozinho);
 *   - rascunho na caixa de entrada = aguardando a titular (não é publicado);
 *   - URL publicada só a que o TikTok devolver (share_url) — nunca montada.
 */
import { prisma } from './prisma'
import { confirmarDistribuicao, registrarFalhaDaTentativa } from './publicacao-fluxo'
import { obterTikTokTokenValido, type TikTokIntegracaoAtiva } from './tiktok-token-store'
import { lerScopesComprovados } from './autorizacao-da-conta'
import { registrarAuditoria } from './audit-log'
import { higienizar } from './distribuicao-orquestrador'

export const URL_STATUS = 'https://open.tiktokapis.com/v2/post/publish/status/fetch/'
export const URL_VIDEO_QUERY = 'https://open.tiktokapis.com/v2/video/query/?fields=id,share_url'

export type SituacaoNoTikTok = 'PROCESSANDO' | 'NA_CAIXA_DE_ENTRADA' | 'PUBLICADO' | 'FALHOU' | 'DESCONHECIDO'

/** FUNÇÃO PURA. Status oficial → situação nossa. Desconhecido nunca é falha. */
export function mapearStatusTikTok(status: string | null | undefined): SituacaoNoTikTok {
  if (status === 'PUBLISH_COMPLETE') return 'PUBLICADO'
  if (status === 'FAILED') return 'FALHOU'
  if (status === 'SEND_TO_USER_INBOX') return 'NA_CAIXA_DE_ENTRADA'
  if (status === 'PROCESSING_UPLOAD' || status === 'PROCESSING_DOWNLOAD') return 'PROCESSANDO'
  return 'DESCONHECIDO'
}

/**
 * O id do post é int64: `JSON.parse` arredonda números acima de 2^53
 * (…0999 vira …1000). O id é lido do TEXTO da resposta, dígito por dígito.
 */
export function idsInt64DoTexto(texto: string, campo: string): string[] {
  const nome = campo.replace(/[^a-z_]/gi, '')
  const lista = texto.match(new RegExp(`"${nome}"\\s*:\\s*\\[([^\\]]*)\\]`))
  if (lista) return [...lista[1].matchAll(/"?(\d{1,25})"?/g)].map((m) => m[1])
  const unico = texto.match(new RegExp(`"${nome}"\\s*:\\s*"?(\\d{1,25})"?`))
  return unico ? [unico[1]] : []
}

export interface StatusLido {
  situacao: SituacaoNoTikTok
  postId: string | null
  motivo: string | null
}

export async function consultarStatus(accessToken: string, publishId: string, fetcher: typeof fetch = fetch): Promise<StatusLido> {
  const r = await fetcher(URL_STATUS, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ publish_id: publishId }),
  })
  const texto = await r.text().catch(() => '')
  let j: { data?: { status?: string; fail_reason?: string }; error?: { code?: string; message?: string } } | null = null
  try {
    j = JSON.parse(texto)
  } catch {
    j = null
  }
  if (!r.ok || !j || (j.error?.code && j.error.code !== 'ok')) throw new Error(`Status indisponível: ${j?.error?.code ?? `HTTP ${r.status}`}`)
  const ids = idsInt64DoTexto(texto, 'publicaly_available_post_id')
  return { situacao: mapearStatusTikTok(j.data?.status), postId: ids[0] ?? null, motivo: j.data?.fail_reason ?? null }
}

/** share_url oficial do vídeo (exige video.list). Sem escopo ou sem resposta: null. */
export async function urlDoVideo(token: TikTokIntegracaoAtiva, postId: string, fetcher: typeof fetch = fetch): Promise<string | null> {
  const escopos = lerScopesComprovados({ scope: token.scope }) ?? []
  if (!escopos.includes('video.list')) return null
  try {
    const r = await fetcher(URL_VIDEO_QUERY, {
      method: 'POST',
      headers: { authorization: `Bearer ${token.accessToken}`, 'content-type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ filters: { video_ids: [postId] } }),
    })
    const j = (await r.json().catch(() => null)) as { data?: { videos?: { id?: string; share_url?: string }[] } } | null
    return j?.data?.videos?.find((v) => String(v.id) === postId)?.share_url ?? null
  } catch {
    return null
  }
}

interface EvidenciaPendente {
  tipo: 'ENVIO_PENDENTE'
  canal: string
  referencia: string
  modo: 'RASCUNHO' | 'DIRETO'
  enviadoEm: string
  etapa: string
}

/**
 * Aplica uma situação lida (status ou webhook) à publicação. Idempotente:
 * publicação já DISTRIBUIDA/FALHOU não muda.
 */
export async function aplicarSituacao(p: {
  workspaceId: string
  publicacaoId: string
  situacao: SituacaoNoTikTok
  postId: string | null
  motivo: string | null
  urlPublicada?: string | null
  agora?: Date
}): Promise<{ mudou: boolean; estado: string }> {
  const agora = p.agora ?? new Date()
  const pub = await prisma.publicacao.findFirst({ where: { id: p.publicacaoId, workspaceId: p.workspaceId }, select: { id: true, estado: true, evidencia: true } })
  if (!pub || pub.estado !== 'DISTRIBUINDO') return { mudou: false, estado: pub?.estado ?? 'INEXISTENTE' }
  const ev = (pub.evidencia ?? {}) as Partial<EvidenciaPendente>
  const assistida = await prisma.publicacaoAssistida.findFirst({ where: { workspaceId: p.workspaceId, publicacaoId: p.publicacaoId } })

  if (p.situacao === 'PUBLICADO' && p.postId) {
    const r = await confirmarDistribuicao({ workspaceId: p.workspaceId, publicacaoId: p.publicacaoId, publicacaoExternaId: p.postId, distribuidaEm: agora })
    if (assistida) {
      const { concluirPublicacaoAssistida } = await import('./publicacao-assistida')
      await concluirPublicacaoAssistida({ workspaceId: p.workspaceId, id: assistida.id, postId: p.postId, url: p.urlPublicada ?? null, modo: ev.modo === 'DIRETO' ? 'API_DIRETO' : 'API_RASCUNHO', agora })
    }
    await registrarAuditoria({ workspaceId: p.workspaceId, action: 'tiktok.publicacao_confirmada', entityType: 'Publicacao', entityId: p.publicacaoId, metadata: { postId: p.postId } })
    return { mudou: r.ok, estado: 'DISTRIBUIDA' }
  }
  if (p.situacao === 'FALHOU') {
    await registrarFalhaDaTentativa({ workspaceId: p.workspaceId, publicacaoId: p.publicacaoId })
    if (assistida) {
      await prisma.publicacaoAssistida.update({ where: { id: assistida.id }, data: { estado: 'FALHOU', erro: higienizar(`O TikTok recusou: ${p.motivo ?? 'motivo não informado'}`) } })
    }
    await registrarAuditoria({ workspaceId: p.workspaceId, action: 'tiktok.publicacao_falhou', entityType: 'Publicacao', entityId: p.publicacaoId, metadata: { motivo: p.motivo } })
    return { mudou: true, estado: 'FALHOU' }
  }
  // PROCESSANDO / NA_CAIXA_DE_ENTRADA / PUBLICADO sem id público / DESCONHECIDO: continua pendente.
  const etapa =
    p.situacao === 'NA_CAIXA_DE_ENTRADA' ? 'NA_CAIXA_DE_ENTRADA'
      : p.situacao === 'PUBLICADO' ? 'PUBLICADO_SEM_ID_PUBLICO'
        : p.situacao === 'PROCESSANDO' ? 'PROCESSANDO' : 'AGUARDANDO_TIKTOK'
  if (ev.etapa === etapa) return { mudou: false, estado: 'DISTRIBUINDO' }
  await prisma.publicacao.update({ where: { id: pub.id }, data: { evidencia: { ...ev, etapa, atualizadoEm: agora.toISOString() } } })
  if (assistida) {
    await prisma.publicacaoAssistida.update({
      where: { id: assistida.id },
      data: {
        bloqueio:
          etapa === 'NA_CAIXA_DE_ENTRADA'
            ? 'Rascunho na sua caixa de entrada do TikTok: abra a notificação, marque o produto e toque em Publicar (manual por limitação oficial do TikTok).'
            : etapa === 'PUBLICADO_SEM_ID_PUBLICO'
              ? 'O TikTok concluiu, mas ainda não liberou o vídeo publicamente (moderação ou privado).'
              : null,
      },
    })
  }
  return { mudou: true, estado: 'DISTRIBUINDO' }
}

/** Consulta o status de todas as publicações pendentes do TikTok neste workspace. */
export async function acompanharPublicacoesTikTok(p: {
  workspaceId: string
  fetcher?: typeof fetch
  obterToken?: (workspaceId: string) => Promise<TikTokIntegracaoAtiva | null>
  agora?: Date
}): Promise<{ consultadas: number; mudaram: number; semConexao: boolean }> {
  const pendentes = await prisma.publicacao.findMany({
    where: { workspaceId: p.workspaceId, canal: 'tiktok', estado: 'DISTRIBUINDO' },
    select: { id: true, evidencia: true },
    take: 20,
  })
  const comReferencia = pendentes.filter((x) => (x.evidencia as Partial<EvidenciaPendente> | null)?.tipo === 'ENVIO_PENDENTE')
  if (!comReferencia.length) return { consultadas: 0, mudaram: 0, semConexao: false }
  const token = await (p.obterToken ?? obterTikTokTokenValido)(p.workspaceId)
  if (!token) return { consultadas: 0, mudaram: 0, semConexao: true }
  let mudaram = 0
  for (const x of comReferencia) {
    const ev = x.evidencia as unknown as EvidenciaPendente
    try {
      const s = await consultarStatus(token.accessToken, ev.referencia, p.fetcher)
      const url = s.situacao === 'PUBLICADO' && s.postId ? await urlDoVideo(token, s.postId, p.fetcher) : null
      const r = await aplicarSituacao({ workspaceId: p.workspaceId, publicacaoId: x.id, situacao: s.situacao, postId: s.postId, motivo: s.motivo, urlPublicada: url, agora: p.agora })
      if (r.mudou) mudaram++
    } catch {
      // Falha de consulta não é falha da publicação: tenta de novo depois.
    }
  }
  return { consultadas: comReferencia.length, mudaram, semConexao: false }
}

/**
 * Webhook oficial (já autenticado e deduplicado na rota): eventos post.publish.*.
 * A conta vem de `user_openid` → Integracao (accountId) → workspace.
 */
export async function aplicarEventoDoWebhook(payload: { event?: string; user_openid?: string; content?: string }, fetcher?: typeof fetch): Promise<boolean> {
  if (!payload.event?.startsWith('post.publish.') || !payload.user_openid) return false
  let conteudo: { publish_id?: string; post_id?: string | number; reason?: string } = {}
  try {
    conteudo = JSON.parse(payload.content ?? '{}')
  } catch {
    return false
  }
  if (!conteudo.publish_id) return false
  const integracao = await prisma.integracao.findFirst({ where: { plataforma: 'tiktok', accountId: payload.user_openid }, select: { workspaceId: true } })
  if (!integracao) return false
  const pub = await prisma.publicacao.findFirst({
    where: { workspaceId: integracao.workspaceId, canal: 'tiktok', estado: 'DISTRIBUINDO', evidencia: { path: ['referencia'], equals: conteudo.publish_id } },
    select: { id: true },
  })
  if (!pub) return false
  const situacao: SituacaoNoTikTok =
    payload.event === 'post.publish.publicly_available' ? 'PUBLICADO'
      : payload.event === 'post.publish.failed' ? 'FALHOU'
        : payload.event === 'post.publish.inbox_delivered' ? 'NA_CAIXA_DE_ENTRADA'
          : 'DESCONHECIDO'
  // post_id é int64: lido do texto, não do número já arredondado pelo JSON.
  const postId = idsInt64DoTexto(payload.content ?? '', 'post_id')[0] ?? null
  let url: string | null = null
  if (situacao === 'PUBLICADO' && postId) {
    const token = await obterTikTokTokenValido(integracao.workspaceId).catch(() => null)
    if (token) url = await urlDoVideo(token, postId, fetcher)
  }
  const r = await aplicarSituacao({ workspaceId: integracao.workspaceId, publicacaoId: pub.id, situacao, postId, motivo: conteudo.reason ?? null, urlPublicada: url })
  return r.mudou
}
