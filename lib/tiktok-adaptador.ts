/**
 * P2.17.10 — Adaptador do TikTok na PORTA ÚNICA de publicação
 * (`lib/distribuicao-orquestrador.ts`). Só endpoints oficiais da Content
 * Posting API (developers.tiktok.com, verificados em 11/10/2026):
 *
 *   rascunho (caixa de entrada) — POST /v2/post/publish/inbox/video/init/  (video.upload)
 *   Direct Post                 — POST /v2/post/publish/video/init/        (video.publish; público só com app auditado)
 *   envio do arquivo            — FILE_UPLOAD em pedaços (dispensa verificar domínio)
 *   status                      — POST /v2/post/publish/status/fetch/  (lib/tiktok-acompanhamento.ts)
 *
 * O envio é ASSÍNCRONO: o adapter devolve o `publish_id` como confirmação
 * PENDENTE. A publicação só vira DISTRIBUIDA quando o TikTok confirmar o
 * `post_id` público (status ou webhook) — um rascunho na caixa de entrada não
 * é vídeo publicado. Produto do TikTok Shop NÃO é marcado por esta API (não
 * existe o campo): no rascunho, a titular marca no app (limitação oficial).
 */
import { higienizar, type AdaptadorDeCanal, type PedidoDeDistribuicao, type RespostaDoAdaptador } from './distribuicao-orquestrador'
import { avaliarPecaParaOAdapter } from './capacidade-real-do-adapter'
import { lerScopesComprovados } from './autorizacao-da-conta'
import { corpoDoInitDoRascunho, URL_INIT_RASCUNHO } from './tiktok-rascunho'
import { enviarArquivoEmChunks, planejarChunks } from './tiktok-upload'
import { obterTikTokTokenValido, type TikTokIntegracaoAtiva } from './tiktok-token-store'

export const URL_INIT_DIRECT_POST = 'https://open.tiktokapis.com/v2/post/publish/video/init/'
export const PRIVACIDADES_TIKTOK = ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'] as const

export interface DependenciasDoTikTok {
  fetcher?: typeof fetch
  obterToken?: (workspaceId: string) => Promise<TikTokIntegracaoAtiva | null>
  /** Lê o vídeo do NOSSO storage (a URL da peça). */
  baixarVideo?: (url: string, fetcher: typeof fetch) => Promise<Buffer>
}

async function baixarDoStorage(url: string, fetcher: typeof fetch): Promise<Buffer> {
  const r = await fetcher(url)
  if (!r.ok) throw new Error(`Não consegui ler o vídeo do storage (HTTP ${r.status}).`)
  return Buffer.from(await r.arrayBuffer())
}

/** Falha de transporte = a requisição pode ter chegado ao TikTok (envio incerto). */
function ehFalhaDeRede(e: unknown): boolean {
  if (e instanceof TypeError) return true
  return e instanceof Error && /fetch failed|network|socket|ECONN|ETIMEDOUT|EAI_AGAIN|aborted|timeout/i.test(e.message)
}

const falha = (erro: string, extra: Partial<RespostaDoAdaptador> = {}): RespostaDoAdaptador => ({ ok: false, publicacaoExternaId: null, erro: higienizar(erro), ...extra })

async function iniciarEEnviar(
  pedido: PedidoDeDistribuicao,
  modo: 'RASCUNHO' | 'DIRETO',
  deps: DependenciasDoTikTok
): Promise<RespostaDoAdaptador> {
  const fetcher = deps.fetcher ?? fetch
  if (!pedido.assetUrl) return falha('A peça não tem vídeo: o TikTok não aceita publicação sem vídeo.', { fatal: true })
  const peca = avaliarPecaParaOAdapter({ canal: 'tiktok', formato: pedido.formato ?? null, assetUrl: pedido.assetUrl })
  if (!peca.aceita) return falha(peca.explicacao.join(' '), { fatal: true })

  const token = await (deps.obterToken ?? obterTikTokTokenValido)(pedido.workspaceId)
  if (!token) return falha('A conta do TikTok não está conectada (ou a autorização venceu): reconecte em Integrações.', { fatal: true })
  const escopos = lerScopesComprovados({ scope: token.scope }) ?? []
  const escopo = modo === 'RASCUNHO' ? 'video.upload' : 'video.publish'
  if (!escopos.includes(escopo)) return falha(`A conexão do TikTok não tem o escopo ${escopo}: reconecte autorizando.`, { fatal: true })

  let video: Buffer
  try {
    video = await (deps.baixarVideo ?? baixarDoStorage)(pedido.assetUrl, fetcher)
  } catch (e) {
    // Nada saiu para o TikTok: repetir é seguro.
    return falha(e instanceof Error ? e.message : String(e))
  }
  // P2.69+: os bytes que vão para o TikTok SÃO os bytes aprovados (o hash é conferido depois do download, antes do envio).
  if (pedido.sha256Esperado !== undefined) {
    const sha = (await import('node:crypto')).createHash('sha256').update(video).digest('hex')
    if (!pedido.sha256Esperado || sha !== pedido.sha256Esperado) return falha('O arquivo baixado não é o arquivo aprovado (sha256 diferente): nada foi enviado.', { fatal: true })
  }

  const plano = planejarChunks(video.length)
  let corpo: Record<string, unknown>
  if (modo === 'RASCUNHO') {
    corpo = corpoDoInitDoRascunho({ tipo: 'ARQUIVO', tamanho: video.length })
  } else {
    const privacidade = String(pedido.opcoes?.privacidade ?? '')
    // Exigência da auditoria: a privacidade é ESCOLHIDA pela titular, sem padrão.
    if (!(PRIVACIDADES_TIKTOK as readonly string[]).includes(privacidade)) return falha('Escolha a privacidade da publicação (exigência do TikTok).', { fatal: true })
    corpo = {
      post_info: {
        title: pedido.legenda,
        privacy_level: privacidade,
        disable_comment: pedido.opcoes?.desativarComentarios === true,
        disable_duet: pedido.opcoes?.desativarDuet === true,
        disable_stitch: pedido.opcoes?.desativarStitch === true,
        brand_content_toggle: pedido.opcoes?.conteudoDeMarca === true,
        brand_organic_toggle: pedido.opcoes?.suaMarca === true,
      },
      source_info: { source: 'FILE_UPLOAD', video_size: video.length, chunk_size: plano[0].size, total_chunk_count: plano.length },
    }
  }

  let publishId: string
  let uploadUrl: string | null
  try {
    const r = await fetcher(modo === 'RASCUNHO' ? URL_INIT_RASCUNHO : URL_INIT_DIRECT_POST, {
      method: 'POST',
      headers: { authorization: `Bearer ${token.accessToken}`, 'content-type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(corpo),
    })
    const j = (await r.json().catch(() => null)) as { data?: { publish_id?: string; upload_url?: string }; error?: { code?: string; message?: string } } | null
    if (!r.ok || !j || j.error?.code !== 'ok' || !j.data?.publish_id) {
      // Resposta do TikTok = nada foi criado: recusa, repetível conforme o motivo.
      const codigo = j?.error?.code ?? `HTTP ${r.status}`
      return falha(`O TikTok recusou o envio: ${codigo}${j?.error?.message ? ` — ${j.error.message}` : ''}`, {
        fatal: /scope|unaudited|privacy|spam_risk|not_supported|invalid/i.test(codigo),
      })
    }
    publishId = j.data.publish_id
    uploadUrl = j.data.upload_url ?? null
  } catch (e) {
    return falha(`Sem resposta do TikTok no início do envio: ${e instanceof Error ? e.message : String(e)}`, { envioIncerto: ehFalhaDeRede(e) })
  }
  if (!uploadUrl) return falha('O TikTok não devolveu o endereço de envio do arquivo.', { fatal: true })

  try {
    await enviarArquivoEmChunks({
      uploadUrl,
      tamanhoTotal: video.length,
      contentType: 'video/mp4',
      lerChunk: async (c) => video.subarray(c.start, c.end + 1),
      fetcher,
    })
  } catch (e) {
    // Envio do arquivo incompleto: o TikTok descarta (não publica). Repetir cria outro envio.
    return falha(`O envio do arquivo ao TikTok falhou: ${e instanceof Error ? e.message : String(e)}`)
  }

  return { ok: true, publicacaoExternaId: null, erro: null, confirmacaoPendente: { referencia: publishId, modo } }
}

export function criarAdaptadorTikTok(deps: DependenciasDoTikTok = {}): AdaptadorDeCanal {
  return {
    canal: 'tiktok',
    enviarDraft: (pedido) => iniciarEEnviar(pedido, 'RASCUNHO', deps),
    publicar: (pedido) => iniciarEEnviar(pedido, 'DIRETO', deps),
  }
}

export const adaptadorTikTok = criarAdaptadorTikTok()
