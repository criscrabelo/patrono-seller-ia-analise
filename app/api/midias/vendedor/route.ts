import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { exigirSessao } from '@/lib/sessao'
import { registrarAuditoria } from '@/lib/audit-log'
import {
  associarProdutoALoja, confirmarRevisao, ErroDeAutorizacao, registrarResposta, revogarAutorizacao, situacaoDaMidiaDoVendedor, solicitarAutorizacao,
} from '@/lib/autorizacao-midia-vendedor'

export const dynamic = 'force-dynamic'

/**
 * P2.18.10 — MÍDIA DO VENDEDOR.
 * GET ?candidatoId= → situação ("Autorização geral: APROVADA" / "Autorização necessária") + mensagem padrão.
 * POST { acao } → solicitar | responder | revisar | revogar | associar.
 * Nada é enviado ao vendedor pelo Patrono: a titular copia a mensagem e registra a resposta.
 */
export async function GET(req: NextRequest) {
  const s = await exigirSessao()
  if (s instanceof NextResponse) return s
  const candidatoId = req.nextUrl.searchParams.get('candidatoId') ?? ''
  if (!candidatoId) return NextResponse.json({ error: 'candidatoId obrigatório.' }, { status: 400 })
  return NextResponse.json(await situacaoDaMidiaDoVendedor(s.user.workspaceId, candidatoId))
}

const esquema = z.discriminatedUnion('acao', [
  z.object({ acao: z.literal('solicitar'), candidatoId: z.string().min(1).max(64), lojaNome: z.string().trim().min(2).max(120), lojaId: z.string().trim().max(64).nullable().optional(), vendedorNome: z.string().trim().max(120).nullable().optional(), tipo: z.enum(['GERAL', 'ESPECIFICA']).optional() }),
  z.object({ acao: z.literal('responder'), id: z.string().min(1).max(64), resposta: z.string().trim().max(4000).nullable().optional(), evidenciaUrl: z.string().trim().url().max(1000).nullable().optional() }),
  z.object({ acao: z.literal('revisar'), id: z.string().min(1).max(64), aprovar: z.boolean() }),
  z.object({ acao: z.literal('revogar'), id: z.string().min(1).max(64), motivo: z.string().trim().max(300).optional() }),
  z.object({ acao: z.literal('associar'), id: z.string().min(1).max(64), candidatoId: z.string().min(1).max(64) }),
])

export async function POST(req: NextRequest) {
  const s = await exigirSessao()
  if (s instanceof NextResponse) return s
  const c = esquema.safeParse(await req.json().catch(() => ({})))
  if (!c.success) return NextResponse.json({ error: c.error.issues[0]?.message ?? 'Dados inválidos.' }, { status: 400 })
  const ws = s.user.workspaceId
  const userId = s.user.id
  try {
    const d = c.data
    const r =
      d.acao === 'solicitar' ? await solicitarAutorizacao({ workspaceId: ws, userId, candidatoId: d.candidatoId, lojaNome: d.lojaNome, lojaId: d.lojaId, provider: d.lojaId ? 'tiktok-shop' : null, vendedorNome: d.vendedorNome, tipo: d.tipo })
        : d.acao === 'responder' ? await registrarResposta({ workspaceId: ws, userId, id: d.id, resposta: d.resposta, evidenciaUrl: d.evidenciaUrl })
          : d.acao === 'revisar' ? await confirmarRevisao({ workspaceId: ws, userId, id: d.id, aprovar: d.aprovar })
            : d.acao === 'revogar' ? await revogarAutorizacao({ workspaceId: ws, userId, id: d.id, motivo: d.motivo })
              : (await associarProdutoALoja({ workspaceId: ws, id: d.id, candidatoId: d.candidatoId }), null)
    await registrarAuditoria({ workspaceId: ws, userId, action: `midia_vendedor.${d.acao}`, entityType: 'AutorizacaoDeMidiaDoVendedor', entityId: r?.id ?? ('id' in d ? d.id : d.candidatoId), metadata: { status: r?.status ?? null } })
    return NextResponse.json({ ok: true, status: r?.status ?? null, id: r?.id ?? null })
  } catch (e) {
    if (e instanceof ErroDeAutorizacao) return NextResponse.json({ error: e.message }, { status: e.status })
    throw e
  }
}
