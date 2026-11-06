import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { statusEfetivo } from '@/lib/regras-de-plataforma'
import { efeitoDaRegra, rotuloDoStatus } from '@/lib/permissao-da-acao'
import { ErroDeCota, lerEstadosDaConta, permissaoDaAcao, regrasEfetivas, salvarEstadoDaConta, sincronizarRegrasDoCatalogo } from '@/lib/cotas-da-plataforma'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * P2.20 — REVISÃO DAS REGRAS DA PLATAFORMA (auditoria, só admin; não é tela do dia a dia).
 * GET  → regras (com status efetivo, rótulo e efeito NESTA conta), estado da conta, quota de hoje e
 *        as últimas mudanças (PLATFORM_RULE_UPDATED / PLATFORM_ACCOUNT_STATE_UPDATED). SÓ LEITURA (P2.31.1).
 * POST → registra o ESTADO DA CONTA num programa (o que a titular viu). Não decide nada: quem decide é o motor.
 *        `{ "acao": "sincronizar-catalogo" }` registra o catálogo do código no histórico já (a reconciliação faz de hora em hora).
 */
async function sessaoAdmin() {
  const s = await exigirSessao()
  if (s instanceof NextResponse) return s
  if (s.user.role !== 'admin') return NextResponse.json({ error: 'Só a administradora vê a revisão das regras.' }, { status: 403 })
  return s
}

export async function GET() {
  const s = await sessaoAdmin()
  if (s instanceof NextResponse) return s
  const ws = s.user.workspaceId
  const agora = new Date()
  const [regras, estados, quota, eventos] = await Promise.all([
    regrasEfetivas(ws), lerEstadosDaConta(ws), permissaoDaAcao(ws, 'PUBLICAR_VIDEO_PROMOCIONAL', agora),
    prisma.domainEvent.findMany({ where: { workspaceId: ws, tipo: { in: ['PLATFORM_RULE_UPDATED', 'PLATFORM_ACCOUNT_STATE_UPDATED', 'PLATFORM_QUOTA_BLOCKED'] } }, orderBy: { ocorridoEm: 'desc' }, take: 20, select: { tipo: true, entidadeId: true, ocorridoEm: true } }),
  ])
  return NextResponse.json({
    agora: agora.toISOString(),
    regras: regras.map((r) => {
      const st = statusEfetivo(r, agora)
      return { ...r, statusAgora: st, rotulo: rotuloDoStatus(st), efeito: efeitoDaRegra(r, estados, agora) }
    }),
    estados, quota, eventos,
  })
}

export async function POST(req: NextRequest) {
  const s = await sessaoAdmin()
  if (s instanceof NextResponse) return s
  const corpo = await req.json().catch(() => null)
  if (!corpo || typeof corpo !== 'object') return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 })
  if ((corpo as { acao?: unknown }).acao === 'sincronizar-catalogo') return NextResponse.json({ ok: true, ...(await sincronizarRegrasDoCatalogo(s.user.workspaceId)) })
  try {
    const r = await salvarEstadoDaConta({ workspaceId: s.user.workspaceId, userId: s.user.id, dados: corpo })
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    if (e instanceof ErroDeCota) return NextResponse.json({ error: e.message }, { status: e.status })
    throw e
  }
}
