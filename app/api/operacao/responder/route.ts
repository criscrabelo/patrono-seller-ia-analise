import { NextRequest, NextResponse } from 'next/server'
import { exigirSessaoEFlag } from '@/lib/api-fase1'
import { responderNaJornada, visaoDaOperacao } from '@/lib/jornada'
import { esquemaDaResposta, respostaDeErroDaJornada } from '@/lib/jornada-http'
import { registrarAuditoria } from '@/lib/audit-log'
import { assinarMidiasPrivadasNaResposta, SEM_CACHE } from '@/lib/midia-privada'

export const dynamic = 'force-dynamic'

/** P2.18.5 — A titular responde a etapa ATUAL da jornada; volta a jornada já na próxima etapa. */
export async function POST(req: NextRequest) {
  const s = await exigirSessaoEFlag('CENTRAL_DE_APROVACOES')
  if (s instanceof NextResponse) return s
  const corpo = esquemaDaResposta.safeParse(await req.json().catch(() => ({})))
  if (!corpo.success) return NextResponse.json({ error: corpo.error.issues[0]?.message ?? 'Dados inválidos.' }, { status: 400 })
  try {
    const ctx = await responderNaJornada({ workspaceId: s.workspaceId, userId: s.userId, ...corpo.data })
    await registrarAuditoria({ workspaceId: s.workspaceId, userId: s.userId, action: 'jornada.resposta', entityType: 'JornadaOperacional', entityId: corpo.data.candidatoId, metadata: { resposta: corpo.data.resposta } })
    return NextResponse.json(await assinarMidiasPrivadasNaResposta(visaoDaOperacao(ctx), s.workspaceId), { headers: SEM_CACHE })
  } catch (e) {
    return respostaDeErroDaJornada(e)
  }
}
