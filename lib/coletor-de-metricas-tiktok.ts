/**
 * P2.17.16 (P1 pós-aprovação) — TikTokAnalyticsAdapter.coletarMetricas →
 * VideoTikTokResultado → aprendizado.
 *
 * Quando o acesso oficial existir (app aprovado + conta conectada com
 * `video.list`), as views oficiais de cada vídeo publicado entram SOZINHAS no
 * resultado do vídeo — e, por consequência, em tudo que lê esse resultado:
 * Publicações Assistidas, Torre, Vendas & Receita, Relatórios, status
 * econômico do produto, Gestor de Vitrine e o aprendizado do Patrono.
 *
 * Desligado até lá (flag TIKTOK_METRICAS_AUTOMATICAS + conexão + escopo):
 * nenhuma chamada real acontece sem isso. Campo que a API não devolve fica
 * como estava (nunca vira zero); registro manual nunca é apagado — a origem
 * passa a dizer "API_TIKTOK+MANUAL" quando os dois convivem.
 */
import { prisma } from './prisma'
import { obterTikTokTokenValido, type TikTokIntegracaoAtiva } from './tiktok-token-store'
import { lerScopesComprovados } from './autorizacao-da-conta'
import { registrarAuditoria } from './audit-log'

export const URL_METRICAS = 'https://open.tiktokapis.com/v2/video/query/?fields=id,view_count,like_count,comment_count,share_count'
/** Só vídeos recentes (a janela de aprendizado/atribuição); o resto já está fechado. */
export const JANELA_DE_COLETA_DIAS = 30
const LOTE = 20

export interface ConfiguracaoDoColetor { ligado: boolean; motivo: string | null }

/** FUNÇÃO PURA. */
export function configuracaoDoColetor(env: Record<string, string | undefined> = process.env): ConfiguracaoDoColetor {
  if (env.TIKTOK_METRICAS_AUTOMATICAS !== 'true') return { ligado: false, motivo: 'Coleta automática desligada (TIKTOK_METRICAS_AUTOMATICAS) até o app do TikTok ser aprovado e conectado.' }
  return { ligado: true, motivo: null }
}

export interface MetricaOficial { postId: string; views: number | null }

/** FUNÇÃO PURA. Lê a resposta do video/query: só número vira número. */
export function lerMetricas(json: unknown): MetricaOficial[] {
  const videos = (json as { data?: { videos?: { id?: unknown; view_count?: unknown }[] } } | null)?.data?.videos ?? []
  return videos
    .filter((v) => v.id !== undefined && v.id !== null)
    .map((v) => ({ postId: String(v.id), views: typeof v.view_count === 'number' && Number.isFinite(v.view_count) && v.view_count >= 0 ? v.view_count : null }))
}

/** FUNÇÃO PURA. Nova origem: API sozinha, ou API + registros manuais que continuam valendo. */
export function origemDepoisDaColeta(linha: { origemMetricas: string; cliquesProduto: number | null; vendas: number | null; comissao: number | null; retencaoMedia: number | null }): string {
  const temManual = linha.origemMetricas !== 'API_TIKTOK' && [linha.cliquesProduto, linha.vendas, linha.comissao, linha.retencaoMedia].some((x) => x !== null)
  return temManual ? 'API_TIKTOK+MANUAL' : 'API_TIKTOK'
}

export async function coletarMetricasOficiais(p: {
  workspaceId: string
  fetcher?: typeof fetch
  obterToken?: (workspaceId: string) => Promise<TikTokIntegracaoAtiva | null>
  env?: Record<string, string | undefined>
  agora?: Date
}): Promise<{ ligado: boolean; motivo: string | null; consultados: number; atualizados: number; semConexao: boolean; semEscopo: boolean }> {
  const cfg = configuracaoDoColetor(p.env)
  const vazio = { consultados: 0, atualizados: 0, semConexao: false, semEscopo: false }
  if (!cfg.ligado) return { ...cfg, ...vazio }
  const agora = p.agora ?? new Date()
  const linhas = await prisma.videoTikTokResultado.findMany({
    where: { workspaceId: p.workspaceId, postId: { not: null }, publicadoEm: { gte: new Date(agora.getTime() - JANELA_DE_COLETA_DIAS * 24 * 60 * 60 * 1000) } },
    orderBy: { publicadoEm: 'desc' },
    take: 100,
  })
  if (!linhas.length) return { ...cfg, ...vazio }
  const token = await (p.obterToken ?? obterTikTokTokenValido)(p.workspaceId)
  if (!token) return { ...cfg, ...vazio, semConexao: true }
  if (!(lerScopesComprovados({ scope: token.scope }) ?? []).includes('video.list')) return { ...cfg, ...vazio, semEscopo: true }
  const fetcher = p.fetcher ?? fetch
  let atualizados = 0
  for (let i = 0; i < linhas.length; i += LOTE) {
    const lote = linhas.slice(i, i + LOTE)
    let metricas: MetricaOficial[] = []
    try {
      const r = await fetcher(URL_METRICAS, {
        method: 'POST',
        headers: { authorization: `Bearer ${token.accessToken}`, 'content-type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({ filters: { video_ids: lote.map((l) => l.postId) } }),
      })
      if (!r.ok) continue
      metricas = lerMetricas(await r.json().catch(() => null))
    } catch {
      continue // falha de consulta não apaga nada: tenta de novo na próxima rodada
    }
    for (const m of metricas) {
      const linha = lote.find((l) => l.postId === m.postId)
      if (!linha || m.views === null || m.views === linha.views) continue
      await prisma.videoTikTokResultado.update({ where: { id: linha.id }, data: { views: m.views, origemMetricas: origemDepoisDaColeta(linha) } })
      atualizados++
    }
  }
  if (atualizados) await registrarAuditoria({ workspaceId: p.workspaceId, action: 'tiktok.metricas_oficiais', entityType: 'VideoTikTokResultado', entityId: p.workspaceId, metadata: { consultados: linhas.length, atualizados } })
  return { ...cfg, consultados: linhas.length, atualizados, semConexao: false, semEscopo: false }
}
