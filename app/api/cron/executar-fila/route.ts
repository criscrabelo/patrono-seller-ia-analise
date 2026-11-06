import { autorizacaoDeRotinaValida } from '@/lib/segredo-de-rotina'
import { NextRequest, NextResponse } from 'next/server'
import { chamadaDeOutroAgendador, RESPOSTA_DE_OUTRO_AGENDADOR } from '@/lib/agendador'
import { prisma } from '@/lib/prisma'
import { portaPrisma } from '@/lib/automation-queue-prisma'
import {
  rodarFilaDoWorkspace,
  detectarCapacidades,
  PUBLICACAO_DO_EXECUTOR,
} from '@/lib/executor-da-fila'
import { adaptadoresHabilitados } from '@/lib/adaptadores-reais'
import { RENOVADORES_LIGADOS } from '@/lib/renovacao-de-acesso'

/**
 * Executor da Automation Queue (P1.4.1).
 *
 * AUTOMATION FIRST: é isto que faz a fábrica funcionar sozinha. Sem esta
 * rota, `gerarConteudoDoJob()` só rodaria se alguém a chamasse à mão — e
 * trabalho manual recorrente é exatamente o que a regra proíbe.
 *
 * ── O QUE ELE FAZ ───────────────────────────────────────────────────────
 * Por workspace: devolve à fila quem esperava por capacidade, reclama o
 * próximo job, executa, renova o heartbeat durante o trabalho pesado e
 * conclui. Depois segue para o próximo.
 *
 * ── O QUE ELE NÃO FAZ ───────────────────────────────────────────────────
 * Não publica, não cria `Publicacao`, não chama provider de canal nem
 * provider pago. Termina com a peça pronta.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Teto por execução: cron serverless morre no meio de um render sem isso. */
const JOBS_POR_WORKSPACE = 5

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[cron/executar-fila] CRON_SECRET não configurado — recusando executar.')
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  if (!autorizacaoDeRotinaValida(req.headers.get('authorization'), secret)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  // P2.2: um agendador por vez — ver lib/agendador.ts.
  if (chamadaDeOutroAgendador(req.headers)) {
    return NextResponse.json(RESPOSTA_DE_OUTRO_AGENDADOR, { status: 409 })
  }

  const agora = new Date()
  const workerId = `cron-${agora.getTime()}`
  const porta = portaPrisma()

  // Capacidade declarada por ambiente. Fail-closed: o que não for afirmado
  // como disponível não é usado, e o job espera em vez de falhar no meio.
  const capacidades = await detectarCapacidades({
    ffmpeg: process.env.FFMPEG_DISPONIVEL === 'true',
    chatterbox: process.env.CHATTERBOX_DISPONIVEL === 'true',
  })

  // P1.5.2: o ÚNICO caminho por onde um canal real entra no executor.
  // Fail-closed: sem `PUBLICACAO_REAL_<CANAL>=true` e sem adapter escrito,
  // isto vem vazio — a fila decide, registra o motivo e espera.
  const adaptadores = adaptadoresHabilitados(process.env)

  const workspaces = await prisma.workspace.findMany({ select: { id: true } })
  const porWorkspace: Record<string, unknown> = {}
  let totalExecutados = 0
  let totalSucessos = 0
  let totalAguardando = 0
  let totalDestravados = 0
  // Sem isto, uma execucao com falhas era indistinguivel de uma limpa na
  // resposta do cron: o laco contava, e ninguem lia.
  let totalFalhas = 0

  for (const ws of workspaces) {
    // P2.15.3: erro num workspace não derruba a fila dos outros.
    let r: Awaited<ReturnType<typeof rodarFilaDoWorkspace>>
    try {
      r = await rodarFilaDoWorkspace({
        porta,
        workspaceId: ws.id,
        workerId,
        capacidades,
        adaptadores,
        renovadores: RENOVADORES_LIGADOS,
        agora,
        limite: JOBS_POR_WORKSPACE,
      })
    } catch (e) {
      totalFalhas++
      console.error('[cron/executar-fila] workspace falhou', ws.id, e instanceof Error ? e.message : String(e))
      continue
    }
    if (r.executados === 0 && r.destravados === 0) continue

    totalExecutados += r.executados
    totalSucessos += r.sucessos
    totalAguardando += r.aguardando
    totalDestravados += r.destravados
    totalFalhas += r.falhas
    porWorkspace[ws.id] = r
  }

  return NextResponse.json({
    ok: true,
    workerId,
    capacidades: {
      ffmpeg: capacidades.ffmpeg,
      chatterbox: capacidades.chatterbox,
      memoriaLivreGB: Math.round((capacidades.memoriaLivreBytes / 1024 ** 3) * 100) / 100,
    },
    totalExecutados,
    totalSucessos,
    totalAguardando,
    totalFalhas,
    totalDestravados,
    porWorkspace,
    custoTotal: 0,
    publicacaoAutomatica: PUBLICACAO_DO_EXECUTOR.estado,
    canaisLigados: Object.keys(adaptadores),
    executadoEm: agora.toISOString(),
  })
}
