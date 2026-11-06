import { NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { configuracaoDaVitrine, registrosDaVitrine, ROTULO_DA_VITRINE, CONTRATO_DOCUMENTADO, type EstadoDaVitrine } from '@/lib/tiktok-shop-vitrine'
import { avaliarVitrine, cicloDaVitrine } from '@/lib/gestor-de-vitrine'
import { registrarAuditoria } from '@/lib/audit-log'

export const dynamic = 'force-dynamic'

/** Vitrine do TikTok Shop: configuração (ligada? por quê não?) e registros por produto. */
export async function GET() {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  const cfg = configuracaoDaVitrine()
  const [registros, gestor] = await Promise.all([registrosDaVitrine(session.user.workspaceId), avaliarVitrine(session.user.workspaceId)])
  return NextResponse.json({
    ligada: cfg.ligada,
    motivo: cfg.motivo,
    remocao: cfg.remocao,
    divergencias: cfg.divergencias,
    contrato: CONTRATO_DOCUMENTADO,
    // P2.17.15: o Gestor de Vitrine (leitura: não grava decisão; a rodada é que registra).
    gestor,
    registros: registros.map((r) => ({
      productId: r.productId, nomeProduto: r.nomeProduto, estado: r.estado, rotulo: ROTULO_DA_VITRINE[r.estado as EstadoDaVitrine] ?? r.estado,
      enviadoEm: r.enviadoEm?.toISOString() ?? null, verificadoEm: r.verificadoEm?.toISOString() ?? null, confirmadoEm: r.confirmadoEm?.toISOString() ?? null,
      tentativas: r.tentativas, detalhe: r.detalhe,
    })),
  })
}

/** Roda o fluxo automático (desligado = não faz nada e diz por quê). */
export async function POST() {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  const r = await cicloDaVitrine(session.user.workspaceId)
  if (r.ligada) {
    await registrarAuditoria({ workspaceId: session.user.workspaceId, userId: session.user.id, action: 'tiktok_shop.vitrine_rodada', entityType: 'VitrineTikTokShop', entityId: session.user.workspaceId, metadata: { conferidos: r.conferidos, processados: r.processados.length, decisoes: r.decisoes.length } })
  }
  return NextResponse.json(r, { status: r.ligada ? 200 : 409 })
}
