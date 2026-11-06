/**
 * P2.17 — Enviar o vídeo como RASCUNHO para a caixa de entrada do TikTok da
 * titular (Content Posting API › Upload, escopo `video.upload`).
 *
 * Por que rascunho: app não auditado só publica direto como privado
 * (SELF_ONLY). No rascunho, a própria titular abre a notificação no app,
 * marca o produto do TikTok Shop, revisa e publica. Nada vai ao ar sozinho.
 *
 * Contrato oficial (developers.tiktok.com, "Upload content"):
 *   POST https://open.tiktokapis.com/v2/post/publish/inbox/video/init/
 *   Authorization: Bearer <token do usuário com video.upload>
 *   source_info: PULL_FROM_URL { video_url } (domínio verificado) ou
 *                FILE_UPLOAD { video_size, chunk_size, total_chunk_count }
 *   resposta: data.publish_id (+ data.upload_url no FILE_UPLOAD);
 *             error.code === 'ok' quando deu certo.
 * O envio dos pedaços usa lib/tiktok-upload.ts; o status, o mesmo
 * `/v2/post/publish/status/fetch/` do Direct Post.
 *
 * NÃO LIGADO a nenhuma rota: enviar algo ao TikTok é ação externa e depende
 * de autorização da titular e de app com credenciais (ainda inexistentes).
 */
import { planejarChunks } from './tiktok-upload'

export const URL_INIT_RASCUNHO = 'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/'
/** Escopos mínimos do modo rascunho. Nunca pedir o que não usamos. */
export const ESCOPOS_DO_RASCUNHO = ['user.info.basic', 'video.upload'] as const

export type OrigemDoVideo = { tipo: 'URL'; url: string } | { tipo: 'ARQUIVO'; tamanho: number; tamanhoDoPedaco?: number }

/** FUNÇÃO PURA: corpo do `init`. */
export function corpoDoInitDoRascunho(origem: OrigemDoVideo): Record<string, unknown> {
  if (origem.tipo === 'URL') {
    if (!/^https:\/\//i.test(origem.url)) throw new Error('O vídeo precisa estar numa URL https de domínio verificado no app do TikTok.')
    return { source_info: { source: 'PULL_FROM_URL', video_url: origem.url } }
  }
  const plano = planejarChunks(origem.tamanho, origem.tamanhoDoPedaco)
  return {
    source_info: {
      source: 'FILE_UPLOAD',
      video_size: origem.tamanho,
      chunk_size: plano[0].size,
      total_chunk_count: plano.length,
    },
  }
}

export interface RascunhoIniciado {
  publishId: string
  uploadUrl: string | null
}

export async function iniciarRascunhoNoTikTok(
  p: { accessToken: string; escopos: string[]; origem: OrigemDoVideo },
  fetcher: typeof fetch = fetch
): Promise<RascunhoIniciado> {
  if (!p.escopos.includes('video.upload')) throw new Error('A conexão do TikTok não tem o escopo video.upload: reconecte autorizando o envio de rascunhos.')
  const res = await fetcher(URL_INIT_RASCUNHO, {
    method: 'POST',
    headers: { authorization: `Bearer ${p.accessToken}`, 'content-type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(corpoDoInitDoRascunho(p.origem)),
  })
  const corpo = (await res.json().catch(() => null)) as { data?: { publish_id?: string; upload_url?: string }; error?: { code?: string; message?: string } } | null
  if (!res.ok || !corpo || corpo.error?.code !== 'ok' || !corpo.data?.publish_id) {
    throw new Error(`O TikTok recusou o rascunho: ${corpo?.error?.code ?? `HTTP ${res.status}`}${corpo?.error?.message ? ` — ${corpo.error.message}` : ''}`)
  }
  return { publishId: corpo.data.publish_id, uploadUrl: corpo.data.upload_url ?? null }
}
