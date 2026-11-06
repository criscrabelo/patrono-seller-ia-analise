import { NextRequest, NextResponse } from 'next/server'
import { chamadaDoAgendadorDeclarado } from '@/lib/agendador'
import { uploadDiretoConfigurado } from '@/lib/digital-twin-upload-direto'
import { decidirModo, executarLimpeza, lerPrazoHoras } from '@/lib/limpeza-uploads-orfaos'
import { portaDaLimpezaReal } from '@/lib/limpeza-uploads-orfaos-porta'
import { autorizacaoDeRotinaValida } from '@/lib/segredo-de-rotina'

/**
 * P2.12 — Limpeza dos uploads diretos do Digital Twin enviados e nunca
 * confirmados (ver lib/limpeza-uploads-orfaos.ts).
 *
 * ENSAIO POR PADRÃO: relata o que SERIA apagado, sem apagar. Execução real
 * exige `?modo=execucao` E `LIMPEZA_UPLOADS_ORFAOS_ATIVA=true`.
 *
 * `?workspace=<id>` restringe a um workspace. O relatório só tem contagens
 * por workspace — nunca nome de arquivo.
 *
 * FAIL-CLOSED: sem CRON_SECRET, 401; AGENDADOR_DOS_CRONS ausente ou chamada
 * de outro agendador, 409; sem storage configurado, 503; erro
 * inesperado, 500 sem detalhe — nada apagado depois do erro.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[cron/limpar-uploads-orfaos] CRON_SECRET não configurado — recusando executar.')
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  if (!autorizacaoDeRotinaValida(req.headers.get('authorization'), secret)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  // Um agendador por vez, na versão estrita: AGENDADOR_DOS_CRONS precisa
  // estar declarado e a chamada precisa vir dele (lib/agendador.ts).
  const agendador = chamadaDoAgendadorDeclarado(req.headers)
  if (!agendador.ok) {
    return NextResponse.json({ error: agendador.motivo }, { status: 409 })
  }

  const config = uploadDiretoConfigurado()
  if (!config.ok) {
    console.error(`[cron/limpar-uploads-orfaos] storage não configurado: ${config.motivo}`)
    return NextResponse.json({ error: 'Storage não configurado. Nada foi feito.' }, { status: 503 })
  }

  const { modo, motivo } = decidirModo(req.nextUrl.searchParams.get('modo'))
  const workspaceId = (req.nextUrl.searchParams.get('workspace') ?? '').trim() || undefined

  try {
    const relatorio = await executarLimpeza({ porta: portaDaLimpezaReal(), agora: new Date(), prazoHoras: lerPrazoHoras(), modo, workspaceId })
    console.log('[cron/limpar-uploads-orfaos]', modo, JSON.stringify(relatorio.totais))
    return NextResponse.json({ ok: true, ...relatorio, motivoDoModo: motivo })
  } catch (e) {
    console.error('[cron/limpar-uploads-orfaos] falhou:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ error: 'Falha na limpeza. Nada foi apagado depois do erro.' }, { status: 500 })
  }
}
