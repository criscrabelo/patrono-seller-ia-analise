import { NextRequest, NextResponse } from 'next/server'
import { chamadaDeOutroAgendador, RESPOSTA_DE_OUTRO_AGENDADOR } from '@/lib/agendador'
import { fecharJanelasDeObservacao, lerPoliticaDeObservacao } from '@/lib/ml-captura-publicacao'
import { fecharJanelasDePublicacao, FEATURE_VERSION_PUBLICACAO } from '@/lib/ml-geracao-publicacao'
import { autorizacaoDeRotinaValida } from '@/lib/segredo-de-rotina'

/**
 * GATILHO D (P0.2 Bloco 4.1) — fecha a janela de observação.
 *
 * Conteúdo publicado há mais do que a janela e que não teve NENHUMA venda é
 * rotulado como não convertido. É a única fonte de amostras negativas do
 * sistema — sem elas o modelo só veria acertos.
 *
 * Na dúvida, não rotula: se houver qualquer venda não cancelada ligada ao
 * conteúdo, a amostra fica sem rótulo em vez de virar um negativo errado.
 *
 * Idempotente: só examina amostras `labeledAt: null`, então rodar de novo
 * não cria linha nem reescreve rótulo.
 */
export const maxDuration = 60
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  // Mesmo padrão dos outros crons: sem sessão de usuária, mas NUNCA aberto.
  // Sem `CRON_SECRET` configurado a rota se recusa a rodar, em vez de ficar
  // pública por omissão.
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[cron/ml-janela-observacao] CRON_SECRET não configurado — recusando executar.')
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
  const politica = lerPoliticaDeObservacao()
  // As DUAS geracoes fecham janela, cada uma na sua. A antiga continua
  // rotulando amostras de Conteudo que ja existem; a nova rotula as de
  // Publicacao. Os numeros vao separados de proposito — somar as duas
  // esconderia qual geracao esta de fato aprendendo.
  const resultado = await fecharJanelasDeObservacao({ agora })
  const daPublicacao = await fecharJanelasDePublicacao({ agora })

  return NextResponse.json({
    ok: true,
    janela: {
      dias: politica.dias,
      origem: politica.origem,
      // Explícito para ninguém confundir política interna com regra oficial.
      oficialDeProvider: politica.oficialDeProvider,
    },
    geracaoConteudo: resultado,
    geracaoPublicacao: { featureVersion: FEATURE_VERSION_PUBLICACAO, ...daPublicacao },
    ...resultado,
    executadoEm: agora.toISOString(),
  })
}
