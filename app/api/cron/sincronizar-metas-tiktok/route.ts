import { NextRequest, NextResponse } from 'next/server'
import { chamadaDeOutroAgendador, RESPOSTA_DE_OUTRO_AGENDADOR } from '@/lib/agendador'
import { prisma } from '@/lib/prisma'
import { sincronizarAgora } from '@/lib/sincronizacao-metas-tiktok'
import { autorizacaoDeRotinaValida } from '@/lib/segredo-de-rotina'

/**
 * P2.17.5 — Rotina diária do TikTok Mission Sync.
 *
 * DESLIGADA por padrão: só roda com TIKTOK_MISSOES_SYNC_AGENDADA=true (decisão
 * da titular, depois da aprovação em TESTE). Mesmo ligada, cada workspace usa
 * a melhor fonte AUTOMÁTICA; sem fonte, registra "SEM_FONTE" e não toca nas metas.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[cron/sincronizar-metas-tiktok] CRON_SECRET não configurado — recusando executar.')
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  if (!autorizacaoDeRotinaValida(req.headers.get('authorization'), secret)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  if (chamadaDeOutroAgendador(req.headers)) {
    return NextResponse.json(RESPOSTA_DE_OUTRO_AGENDADOR, { status: 409 })
  }
  if (process.env.TIKTOK_MISSOES_SYNC_AGENDADA !== 'true') {
    return NextResponse.json({ executado: false, motivo: 'Rotina diária desligada (TIKTOK_MISSOES_SYNC_AGENDADA != true).' })
  }
  // Só workspaces que acompanham missões (têm meta) ou conectaram o TikTok Shop.
  const [comMetas, comConexao] = await Promise.all([
    prisma.metaTikTokShop.findMany({ distinct: ['workspaceId'], select: { workspaceId: true } }),
    prisma.integracao.findMany({ where: { plataforma: 'tiktok-shop', status: 'conectado' }, select: { workspaceId: true } }),
  ])
  const workspaces = [...new Set([...comMetas, ...comConexao].map((w) => w.workspaceId))]
  const resultados = []
  for (const workspaceId of workspaces) {
    try {
      const r = await sincronizarAgora({ workspaceId, userId: null, gatilho: 'AGENDADA' })
      resultados.push({ workspaceId, status: r.status, criadas: r.criadas, atualizadas: r.atualizadas, encerradas: r.encerradas })
    } catch (e) {
      resultados.push({ workspaceId, status: 'ERRO', erro: e instanceof Error ? e.message : String(e) })
    }
  }
  return NextResponse.json({ executado: true, workspaces: resultados.length, resultados })
}
