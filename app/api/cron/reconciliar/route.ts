import { NextRequest, NextResponse } from 'next/server'
import { chamadaDeOutroAgendador, RESPOSTA_DE_OUTRO_AGENDADOR } from '@/lib/agendador'
import { prisma } from '@/lib/prisma'
import { reconciliarEstadoOperacional } from '@/lib/reconciliacao'
import { autorizacaoDeRotinaValida } from '@/lib/segredo-de-rotina'

/**
 * P2.28 — reconciliação operacional agendada (detecta; corrige só o determinístico e seguro; o resto vai para
 * "Precisa de você" ou para o health check). Mesma proteção dos outros crons. DESLIGADA até
 * RECONCILIACAO_AGENDADA=true no app (decisão do pacote de Production). Nada é publicado, enviado ou apagado.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || !autorizacaoDeRotinaValida(req.headers.get('authorization'), secret)) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  if (chamadaDeOutroAgendador(req.headers)) return NextResponse.json(RESPOSTA_DE_OUTRO_AGENDADOR, { status: 409 })
  if (process.env.RECONCILIACAO_AGENDADA !== 'true') return NextResponse.json({ ok: true, rotina: 'desligada', motivo: 'RECONCILIACAO_AGENDADA não está ligado' })
  // Só contas com operação (algo que pode ficar preso): publicação assistida, importação, comissão ou evento.
  const contas = await prisma.workspace.findMany({
    where: { OR: [{ publicacoesAssistidas: { some: {} } }, { importacoesCreatorCenter: { some: {} } }, { commissions: { some: {} } }, { execucoesDoProcessador: { some: { tipo: 'CORTE' } } }] },
    select: { id: true }, take: 200,
  })
  const inicio = Date.now()
  const resumo = { contas: 0, corrigidos: 0, paraVoce: 0, admin: 0, emAndamento: 0, pulados: 0 }
  for (const c of contas) {
    // Orçamento: cabe no maxDuration; o que não couber roda na próxima hora.
    if (Date.now() - inicio > 45_000) { resumo.pulados++; continue }
    const r = await reconciliarEstadoOperacional(c.id, { origem: 'cron' }).catch(() => null)
    if (!r) continue
    resumo.contas++
    if (r.emAndamento) resumo.emAndamento++
    resumo.corrigidos += r.corrigidos; resumo.paraVoce += r.paraVoce; resumo.admin += r.admin
  }
  return NextResponse.json({ ok: true, ...resumo })
}
