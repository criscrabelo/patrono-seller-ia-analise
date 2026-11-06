import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { exigirSessao } from '@/lib/sessao'
import { TIPOS_DE_META } from '@/lib/metas-tiktok'
import { aplicarLeitura, chavesDoTexto } from '@/lib/sincronizacao-metas-tiktok'
import { respostaDeErroDeMeta } from '@/lib/metas-tiktok-http'

/**
 * P2.17.4 — Salva as metas que a titular REVISOU na tela de importação.
 * Exige `revisado: true` (confirmação explícita): nada vindo da importação é
 * gravado sem passar pela revisão. Tudo ou nada (transação).
 */
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const corpo = z.object({
  revisado: z.literal(true),
  campanha: z.string().trim().min(1).max(200),
  recompensaTotal: z.number().finite().nonnegative().max(1_000_000).nullable(),
  inicio: data,
  fim: data,
  metas: z
    .array(
      z.object({
        nome: z.string().trim().min(1).max(200),
        tipo: z.enum(TIPOS_DE_META),
        quantidadeRealizada: z.number().int().min(0).max(100_000),
        quantidadeExigida: z.number().int().min(1).max(100_000),
      })
    )
    .min(1)
    .max(30),
})

export async function POST(req: NextRequest) {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  const lido = corpo.safeParse(await req.json().catch(() => null))
  if (!lido.success) {
    const campo = String(lido.error.issues[0]?.path[0] ?? '')
    const msg: Record<string, string> = {
      revisado: 'Confirme que revisou as metas antes de salvar.',
      campanha: 'Informe o nome da campanha.',
      inicio: 'Informe a data de início.',
      fim: 'Informe a data de fim.',
      metas: 'Revise as metas: cada uma precisa de nome, tipo e quantidades válidas.',
      recompensaTotal: 'Recompensa inválida.',
    }
    return NextResponse.json({ error: msg[campo] ?? 'Dados da revisão inválidos.' }, { status: 400 })
  }
  const d = lido.data
  const inicio = new Date(`${d.inicio}T00:00:00-03:00`)
  const fim = new Date(`${d.fim}T23:59:59-03:00`)
  // P2.17.5: o fallback passa pelo MESMO motor da sincronização — reimportar o
  // print de amanhã ATUALIZA as metas (progresso, prazo, recompensa) em vez de
  // duplicar, e registra o que mudou.
  const metas = d.metas.map((m) => ({
    nome: m.nome,
    tipo: m.tipo,
    inicio,
    fim,
    recompensaValor: null,
    recompensaDescricao: null,
    campanha: d.campanha,
    recompensaCampanha: d.recompensaTotal,
    quantidadeExigida: m.quantidadeExigida,
    quantidadeRealizada: m.quantidadeRealizada,
    requisitos: null,
  }))
  const chaves = chavesDoTexto(metas)
  try {
    const r = await aplicarLeitura({
      workspaceId: session.user.workspaceId,
      userId: session.user.id,
      gatilho: 'MANUAL',
      fonte: 'TEXTO_REVISADO',
      escopo: { tipo: 'CAMPANHA', campanha: d.campanha },
      missoes: metas.map((m, i) => ({ ...m, chave: chaves[i] })),
    })
    return NextResponse.json({ salvas: r.criadas + r.atualizadas + r.inalteradas, ...r }, { status: 201 })
  } catch (e) {
    return respostaDeErroDeMeta(e)
  }
}
