import { NextRequest, NextResponse } from 'next/server'
import { chamadaDeOutroAgendador, RESPOSTA_DE_OUTRO_AGENDADOR } from '@/lib/agendador'
import { executarRetencao, lerPrazos } from '@/lib/retencao-de-tarefas'
import { portaDeRetencaoPrisma } from '@/lib/automation-queue-prisma'
import { autorizacaoDeRotinaValida } from '@/lib/segredo-de-rotina'

/**
 * P2.9 — Retenção dos registros de tarefas em segundo plano.
 *
 * ENSAIO POR PADRÃO: lê, decide e devolve o relatório do que SERIA
 * anonimizado ou excluído — sem escrever nada. Execução real exige as duas
 * coisas ao mesmo tempo:
 *   - `?modo=execucao` na chamada;
 *   - `EXPURGO_TAREFAS_ATIVO=true` no ambiente (desligado por padrão).
 * Faltando qualquer uma, é ensaio — e a resposta diz por quê.
 *
 * `?workspace=<id>` restringe a um workspace. O relatório não contém
 * números, mensagens nem textos: só contagens por workspace e por tipo.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[cron/expurgar-tarefas] CRON_SECRET não configurado — recusando executar.')
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  if (!autorizacaoDeRotinaValida(req.headers.get('authorization'), secret)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  // P2.2: um agendador por vez — ver lib/agendador.ts.
  if (chamadaDeOutroAgendador(req.headers)) {
    return NextResponse.json(RESPOSTA_DE_OUTRO_AGENDADOR, { status: 409 })
  }

  const pedido = (req.nextUrl.searchParams.get('modo') ?? '').trim().toLowerCase()
  const ativo = process.env.EXPURGO_TAREFAS_ATIVO === 'true'
  const modo = pedido === 'execucao' && ativo ? 'execucao' : 'ensaio'
  const workspaceId = (req.nextUrl.searchParams.get('workspace') ?? '').trim() || undefined

  const relatorio = await executarRetencao({
    porta: portaDeRetencaoPrisma(),
    agora: new Date(),
    prazos: lerPrazos(),
    modo,
    workspaceId,
  })

  return NextResponse.json({
    ok: true,
    ...relatorio,
    motivoDoModo:
      modo === 'execucao'
        ? 'Execução real: pedida e habilitada (EXPURGO_TAREFAS_ATIVO=true).'
        : pedido === 'execucao'
          ? 'ENSAIO — execução pedida, mas EXPURGO_TAREFAS_ATIVO não está ligado. Nada foi alterado.'
          : 'ENSAIO — nada foi alterado. Use ?modo=execucao com EXPURGO_TAREFAS_ATIVO=true para aplicar.',
  })
}
