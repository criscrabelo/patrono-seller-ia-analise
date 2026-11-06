import { autorizacaoDeRotinaValida } from '@/lib/segredo-de-rotina'
import { NextRequest, NextResponse } from 'next/server'
import { chamadaDeOutroAgendador, RESPOSTA_DE_OUTRO_AGENDADOR } from '@/lib/agendador'
import { MOTOR_NAO_PUBLICA } from '@/lib/motor-de-oportunidades'
import { PLANO_NAO_EXECUTA } from '@/lib/plano-de-acao'
import { portaPrisma } from '@/lib/automation-queue-prisma'
import {
  rodarCicloDeOportunidades,
  CICLO_NAO_PUBLICA_NEM_GERA,
  TIPOS_DESTE_CICLO,
} from '@/lib/ciclo-de-oportunidades'
import { rodarDescobertaAutomatica } from '@/lib/descoberta-automatica'

/**
 * Ciclo diário de oportunidades (P1.1 → P1.5.4).
 *
 * AUTOMATION FIRST: descobrir que um produto subiu, caiu ou apareceu não
 * pode depender de alguém abrir a tela e comparar de cabeça. O cron
 * recalcula, monta o plano e alimenta a Automation Queue.
 *
 * ── DOIS MODOS, UM CAMINHO ──────────────────────────────────────────────
 *   ?modo=ensaio  → percorre tudo e NÃO grava. É o ensaio de produção.
 *   (padrão)      → percorre tudo e grava a sincronização da fila.
 *
 * A diferença entre os dois é a última linha de cada workspace. Leitura,
 * pontuação, plano, formatos e a decisão de criar, manter e cancelar são
 * idênticas — um ensaio que rodasse código diferente mediria o ensaio, não
 * a operação.
 *
 * ── O QUE ESTE CRON NÃO FAZ ─────────────────────────────────────────────
 * Não publica, não cria `Publicacao`, não chama adapter de canal, não
 * chama provider pago e não gera conteúdo. Ele lê o catálogo, planeja e
 * enfileira trabalho INTERNO e gratuito. Gerar é do executor; publicar
 * depende do preflight e de um adapter ligado — ver `MOTOR_NAO_PUBLICA`.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  // Fail-closed: sem segredo configurado, ninguém roda. Não há modo aberto.
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[cron/oportunidades] CRON_SECRET não configurado — recusando executar.')
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  if (!autorizacaoDeRotinaValida(req.headers.get('authorization'), secret)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  // P2.2: um agendador por vez — ver lib/agendador.ts.
  if (chamadaDeOutroAgendador(req.headers)) {
    return NextResponse.json(RESPOSTA_DE_OUTRO_AGENDADOR, { status: 409 })
  }

  // O ensaio é explícito e opt-in; o padrão é a operação real, para que
  // ninguém descubra tarde demais que o cron diário só ensaiava.
  const modo = (new URL(req.url).searchParams.get('modo') ?? '').trim().toLowerCase()
  const ensaio = modo === 'ensaio' || modo === 'dry'

  const agora = new Date()
  // P2.18.1: primeiro a descoberta oficial do TikTok Shop (só onde a fonte
  // está liberada), para o ciclo e a tela já partirem dos produtos novos.
  const descobertaAutomatica = await rodarDescobertaAutomatica({ agora, escrever: !ensaio })
  const relatorio = await rodarCicloDeOportunidades({
    porta: portaPrisma(),
    agora,
    escrever: !ensaio,
  })

  return NextResponse.json({
    ok: true,
    modo: ensaio ? 'ENSAIO — nada gravado' : 'OPERACAO — fila sincronizada',
    ...relatorio,
    descobertaAutomatica,
    tiposAdministrados: TIPOS_DESTE_CICLO,
    // Declarado na resposta para não restar dúvida sobre o escopo.
    escopo: CICLO_NAO_PUBLICA_NEM_GERA.naoFaz,
    publicacaoAutonoma: MOTOR_NAO_PUBLICA.estado,
    execucaoAutonoma: PLANO_NAO_EXECUTA.estado,
  })
}

// ── POR QUE NÃO HÁ REEXPORT AQUI ───────────────────────────────────────
// Este arquivo já reexportou `compararFilas` e `capacidadesDeclaradas`
// "para quem quiser comparar execuções fora do cron". Parecia inofensivo e
// não era: o App Router do Next só admite, num `route.ts`, os handlers HTTP
// e um conjunto fixo de configs (`dynamic`, `maxDuration` e afins).
// Qualquer outro export vira erro de tipo no `next build` — e só no build,
// que `tsc --noEmit` e a suíte não executam. O projeto ficou indeployável
// sem ninguém notar.
//
// As duas funções continuam exportadas de onde moram:
// `lib/motor-de-oportunidades.ts` e `lib/ciclo-de-oportunidades.ts`. Quem
// precisa delas importa de lá, que é o lugar certo de qualquer forma.
