import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { exigirSessao } from '@/lib/sessao'
import { prisma } from '@/lib/prisma'
import { atualizarAlertasDeComissao, corrigirAlerta, registrarReducaoDeComissao, REGRA_REDUCAO_DE_COMISSAO } from '@/lib/alerta-reducao-comissao'

export const dynamic = 'force-dynamic'

/**
 * P2.19 — ALERTAS DE REDUÇÃO DE COMISSÃO (janela oficial de 30 dias).
 * GET  → lista os alertas com a contagem, o nível e o status calculados AGORA, a regra e a fonte. SÓ LEITURA
 *        (P2.31.1): o status gravado é atualizado pela reconciliação e pelas ações de escrita.
 * POST { acao: 'registrar', candidatoId, taxaAtual, taxaNova, dataDoAnuncio?, dataEfetiva?, produtoJaAdicionado? }
 *      { acao: 'corrigir', id, dataEfetiva?, produtoJaAdicionado?, cancelar? }
 */
export async function GET() {
  const s = await exigirSessao()
  if (s instanceof NextResponse) return s
  const ws = s.user.workspaceId
  const calculos = new Map((await atualizarAlertasDeComissao(ws, new Date(), { gravar: false })).map((c) => [c.id, c]))
  const alertas = await prisma.alertaReducaoComissao.findMany({ where: { workspaceId: ws }, orderBy: [{ dataEfetiva: 'asc' }], take: 50 })
  return NextResponse.json({
    regra: REGRA_REDUCAO_DE_COMISSAO,
    alertas: alertas.map((a) => {
      const c = calculos.get(a.id)
      return { ...a, ...(c ? { status: c.status, nivel: c.nivel, produtoJaAdicionado: c.produtoJaAdicionado } : {}), calculo: c ?? null }
    }),
  })
}

const data = z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).transform((v) => new Date(v.length === 10 ? `${v}T00:00:00-03:00` : v))
const taxa = z.number().min(0).max(100)
const esquema = z.discriminatedUnion('acao', [
  z.object({ acao: z.literal('registrar'), candidatoId: z.string().min(1).max(64), taxaAtual: taxa, taxaNova: taxa, dataDoAnuncio: data.optional(), dataEfetiva: data.optional(), produtoJaAdicionado: z.enum(['SIM', 'NAO', 'NAO_CONFIRMADO']).optional() }),
  z.object({ acao: z.literal('corrigir'), id: z.string().min(1).max(64), dataEfetiva: data.optional(), produtoJaAdicionado: z.enum(['SIM', 'NAO', 'NAO_CONFIRMADO']).optional(), cancelar: z.boolean().optional() }),
])

export async function POST(req: NextRequest) {
  const s = await exigirSessao()
  if (s instanceof NextResponse) return s
  const c = esquema.safeParse(await req.json().catch(() => ({})))
  if (!c.success) return NextResponse.json({ error: c.error.issues[0]?.message ?? 'Dados inválidos.' }, { status: 400 })
  const ws = s.user.workspaceId
  const d = c.data
  if (d.acao === 'corrigir') {
    const r = await corrigirAlerta({ workspaceId: ws, userId: s.user.id, id: d.id, dataEfetiva: d.dataEfetiva, produtoJaAdicionado: d.produtoJaAdicionado, cancelar: d.cancelar })
    return r ? NextResponse.json({ ok: true, alerta: r }) : NextResponse.json({ error: 'Alerta não encontrado.' }, { status: 404 })
  }
  if (!(d.taxaNova < d.taxaAtual)) return NextResponse.json({ error: 'Não é redução: aumento de taxa vale na hora, sem janela de 30 dias.' }, { status: 422 })
  const cand = await prisma.candidatoDeProduto.findFirst({ where: { id: d.candidatoId, workspaceId: ws }, select: { id: true, nome: true, providerId: true, externalId: true } })
  if (!cand) return NextResponse.json({ error: 'Produto não encontrado.' }, { status: 404 })
  // Identidade só por id oficial: sem ele, não há como acompanhar a regra sem confundir produtos.
  if (!cand.providerId || !cand.externalId) return NextResponse.json({ error: 'Este produto não tem o identificador do TikTok Shop: informe o link oficial do produto antes.' }, { status: 422 })
  const r = await registrarReducaoDeComissao({
    workspaceId: ws, userId: s.user.id, candidatoId: cand.id, chaveProduto: `${cand.providerId}:${cand.externalId}`, nomeProduto: cand.nome,
    taxaAtual: d.taxaAtual, taxaNova: d.taxaNova, dataDoAnuncio: d.dataDoAnuncio ?? new Date(), fonteDoAnuncio: 'INFORMADA_PELA_TITULAR',
    dataEfetivaInformada: d.dataEfetiva ?? null, produtoJaAdicionado: d.produtoJaAdicionado,
  })
  return NextResponse.json({ ok: true, alerta: r })
}
