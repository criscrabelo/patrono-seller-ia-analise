// P2.74 — SIMULAÇÃO do experimento da campanha 1 na trava local (nenhuma rede, nenhum gasto). Livro-caixa temporário.
//   node node_modules/tsx/dist/cli.mjs scripts/video-pro/simular-experimento.ts
// Etapa 0 = SONDA (1 pedido barato, 360p): confirma acesso, cobrança real por segundo e se a duração pedida é a cobrada.
// Etapa 1 = 4 tomadas a 720p, até 2 tentativas cada (a 2ª só se a 1ª for descartada na conferência de fidelidade).
// A versão 1080×1920 sai por ampliação LOCAL (FFmpeg, R$ 0) da tomada aprovada: gerar de novo em 1080p seria OUTRO vídeo
// e exigiria nova conferência.
import { mkdtempSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PARAMETROS_PADRAO, encerrarPedido, reservar, type PedidoDeVideo } from '../../lib/video-pro/trava-local'

const plano = JSON.parse(readFileSync(join(__dirname, '..', '..', 'campanhas', 'arduino-r4-tomadas-ia.json'), 'utf8')) as { tomadas: { id: string; prompt: string }[] }
const env = {} // simulação: sem chaves

for (const duracaoConfirmada of [true, false]) {
  const d = mkdtempSync(join(tmpdir(), 'sim-experimento-'))
  console.log(`\n=== Cenário: duração ${duracaoConfirmada ? 'CONFIRMADA (6 s cobrados)' : 'NÃO confirmada (10 s cobrados)'} ===`)
  const pedidos: PedidoDeVideo[] = [
    { tomada: 'sonda', tentativa: 1, resolucao: '360p', segundos: 4, duracaoConfirmada: false, prompt: plano.tomadas[0].prompt, imagensSha256: ['sonda'] },
    ...[1, 2].flatMap((tentativa) => plano.tomadas.map((t) => ({ tomada: t.id, tentativa, resolucao: '720p' as const, segundos: 6, duracaoConfirmada, prompt: t.prompt, imagensSha256: [t.id] }))),
  ]
  for (const p of pedidos) {
    const r = reservar(d, p, PARAMETROS_PADRAO, new Date(), env)
    encerrarPedido(d)
    console.log(`${p.tomada.padEnd(12)} t${p.tentativa} ${p.resolucao}  ${r.libera ? `LIBERA  máx US$ ${r.usdMax.toFixed(2)}  acumulado US$ ${r.comprometidoDepoisUsd.toFixed(2)} / ${r.limiteInternoUsd}` : `RECUSA  ${r.motivo}`}`)
  }
}
console.log(`\nParâmetros: pré-pago US$ ${PARAMETROS_PADRAO.prePagoUsd}, uso ${PARAMETROS_PADRAO.fracaoUtilizavel * 100}%, reserva do revisor US$ ${PARAMETROS_PADRAO.reservaParaRevisorUsd}, teto por pedido US$ ${PARAMETROS_PADRAO.tetoPorPedidoUsd}, margem ${PARAMETROS_PADRAO.margemDeCobranca * 100}%.`)
