// P2.77 — PRIMEIRA TOMADA (uma só) do Arduino UNO R4 WiFi no Gemini Omni Flash 1.1 PELA RUNWAY, pela trava de gasto.
//   node node_modules/tsx/dist/cli.mjs scripts/video-pro/primeira-tomada-runway.ts              → SIMULAÇÃO (padrão) + saldo (gratuito)
//   node node_modules/tsx/dist/cli.mjs scripts/video-pro/primeira-tomada-runway.ts --enviar     → envia SÓ com as duas chaves da trava
//   node node_modules/tsx/dist/cli.mjs scripts/video-pro/primeira-tomada-runway.ts --recuperar=<chave>
// Livro, diário e autorização PRÓPRIOS da Runway (%LOCALAPPDATA%\PatronoSeller\runway\livro): a autorização do Google
// não vale aqui. A autorização lista cada tomada/tentativa com `tetoCreditos`. Chave: %LOCALAPPDATA%\PatronoSeller\runway\runway.key
// (nunca impressa). Saldo da organização conferido ANTES (tem de cobrir o máximo) e DEPOIS (consumo real = diferença).
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { criarEnvioRunway, montarCorpoRunway } from '../../lib/video-pro/runway'
import { PARAMETROS_PADRAO, PRECO_RUNWAY, conciliar, creditosMaximosRunway, decidir, executarComTrava, integridade, lerLivro, modoPermitido, recuperarPorId, type PedidoDeVideo } from '../../lib/video-pro/trava-local'
import { avaliarTomada } from './avaliar-tomada'

const LOCAL = process.env.LOCALAPPDATA ?? '.'
const CAMP = join(LOCAL, 'PatronoSeller', 'campanha-arduino-r4')
const RW = join(LOCAL, 'PatronoSeller', 'runway')
const DIR = join(RW, 'livro')
const SAIDA = join(CAMP, 'tomadas-ia'); mkdirSync(SAIDA, { recursive: true }); mkdirSync(DIR, { recursive: true })
const PASTA_TITULAR = join(process.env.USERPROFILE ?? '.', 'OneDrive', 'Área de Trabalho', 'PATRONO SELLER', 'Vídeos Arduino UNO R4 WiFi', 'TESTE TÉCNICO IA - NÃO PUBLICAR')
const arg = process.argv.slice(2)
const TENTATIVA = Number(arg.find((a) => a.startsWith('--tentativa='))?.split('=')[1] ?? 1)
const plano = JSON.parse(readFileSync(join(__dirname, '..', '..', 'campanhas', 'arduino-r4-tomadas-ia.json'), 'utf8')) as { tomadas: { id: string; prompt: string; quadroInicial: string; segundos?: number }[] }
// P2.79: --tomada=<id> (padrão ia-abertura); duração da tomada vem do plano (4 s desde a P2.79)
const TOMADA = arg.find((a) => a.startsWith('--tomada='))?.split('=')[1] ?? 'ia-abertura'
const achada = plano.tomadas.find((x) => x.id === TOMADA)
if (!achada) throw new Error(`tomada desconhecida: ${TOMADA}`)
const t = achada
const QUADRO = join(CAMP, t.quadroInicial)
const png = readFileSync(QUADRO)
const pedido: PedidoDeVideo = { provedor: 'runway', tomada: t.id, tentativa: TENTATIVA, resolucao: '720p', segundos: t.segundos ?? 6, duracaoConfirmada: true, prompt: t.prompt, imagensSha256: [createHash('sha256').update(png).digest('hex')] }
const MAX_CREDITOS = creditosMaximosRunway(pedido)

interface ItemAutorizado { tomada: string; tentativa: number; tetoCreditos: number; justificativa?: string }
function autorizacao(): { prePagoUsd: number; itens: ItemAutorizado[] } | null {
  try { const a = JSON.parse(readFileSync(join(DIR, 'autorizacao.json'), 'utf8')); return { prePagoUsd: a.prePagoUsd, itens: Array.isArray(a.pedidosAutorizados) ? a.pedidosAutorizados : [] } } catch { return null }
}
const chaveDaApi = () => { const f = join(RW, 'runway.key'); return existsSync(f) ? readFileSync(f, 'utf8').trim() || null : null }
const auditar = (e: Record<string, unknown>) => appendFileSync(join(DIR, 'auditoria.jsonl'), JSON.stringify({ em: new Date().toISOString(), ...e }) + '\n')

async function main() {
  const aut = autorizacao()
  const item = aut?.itens.find((i) => i.tomada === pedido.tomada && i.tentativa === pedido.tentativa && (pedido.tentativa === 1 || !!i.justificativa?.trim()))
  const tetoCreditos = Math.min(MAX_CREDITOS, item?.tetoCreditos ?? 0)
  const par = { ...PARAMETROS_PADRAO, prePagoUsd: aut?.prePagoUsd ?? 10, reservaParaRevisorUsd: 0, tetoPorPedidoUsd: +(tetoCreditos * PRECO_RUNWAY.usdPorCredito).toFixed(2) }
  const modo = modoPermitido(DIR, par)
  const ok = integridade(DIR)
  const chave = chaveDaApi()
  const rw = chave ? criarEnvioRunway({ chave, fetch: fetch as never, pastaSaida: SAIDA, tetoCreditos }) : null
  const saldoAntes = rw ? await rw.saldo().catch((e) => `indisponível: ${(e as Error).message}`) : 'sem chave'
  console.log(JSON.stringify({
    fornecedor: 'Runway API', modelo: PRECO_RUNWAY.modelo, tomada: pedido.tomada, tentativa: pedido.tentativa, resolucao: '720p (720:1280)', duracaoS: pedido.segundos,
    corpo: montarCorpoRunway(pedido, `<data URI de ${t.quadroInicial}, ${png.length} bytes>`),
    creditosMaximos: MAX_CREDITOS, usdMaximo: +(MAX_CREDITOS * PRECO_RUNWAY.usdPorCredito).toFixed(2), tetoAutorizadoCreditos: item?.tetoCreditos ?? null,
    saldoDaOrganizacao: saldoAntes, modo: modo.modo, motivoDoModo: modo.motivo, autorizacaoDestaTentativa: item ? 'listada' : 'NÃO listada',
    chaveDaApi: chave ? 'presente (não exibida)' : 'ausente', livro: ok.ok ? 'íntegro' : ok.motivo, decisao: ok.ok ? decidir(ok.livro, pedido, par, modo.modo) : null,
  }, null, 1))
  const rec = arg.find((a) => a.startsWith('--recuperar='))
  if (rec) {
    if (!rw) throw new Error('chave ausente')
    const r = await recuperarPorId(DIR, rec.slice('--recuperar='.length), rw.consultar)
    console.log(JSON.stringify(r)); auditar({ evento: 'RECUPERACAO', resultado: r })
    return
  }
  if (!arg.includes('--enviar')) { console.log('SIMULAÇÃO: nada foi enviado.'); return }
  if (modo.modo !== 'REAL') { console.log(`NÃO ENVIADO: ${modo.motivo}`); return }
  if (!item) { console.log(`NÃO ENVIADO: a tentativa ${pedido.tentativa} da tomada ${pedido.tomada} não está autorizada para a Runway${pedido.tentativa > 1 ? ' (a 2ª exige justificativa técnica)' : ''}.`); return }
  if (!rw) { console.log('NÃO ENVIADO: chave da Runway ausente.'); return }
  if (typeof saldoAntes !== 'number' || saldoAntes < MAX_CREDITOS) { console.log(`NÃO ENVIADO: saldo (${saldoAntes}) não cobre o máximo de ${MAX_CREDITOS} créditos.`); return }
  auditar({ evento: 'ENVIO', tomada: pedido.tomada, tentativa: pedido.tentativa, creditosMaximos: MAX_CREDITOS, saldoAntes })
  const r = await executarComTrava(DIR, pedido, (p, s, id) => rw.enviar(p, s, id, { base64: png.toString('base64'), mime: 'image/png' }), { par, exigirModoReal: true })
  const saldoDepois = await rw.saldo().catch(() => null)
  const consumo = saldoDepois !== null ? saldoAntes - saldoDepois : null
  auditar({ evento: 'RESULTADO', estado: r.estado, saldoAntes, saldoDepois, consumoPeloSaldo: consumo })
  console.log(JSON.stringify({ ...r, saldoAntes, saldoDepois, creditosConsumidosPeloSaldo: consumo }, null, 1))
  // conciliação: só com desfecho conhecido e saldo legível; usa o MAIOR entre o informado pela tarefa e o consumo pelo saldo
  if ((r.estado === 'CONCLUIDO' || r.estado === 'FALHOU') && consumo !== null) {
    const informado = lerLivro(DIR).reservas.find((x) => x.chave === r.chave)?.usdPelaResposta ?? 0
    const usdReal = Math.max(informado, +(consumo * PRECO_RUNWAY.usdPorCredito).toFixed(2))
    conciliar(DIR, r.chave, usdReal, `Runway: tarefa informou US$ ${informado}; saldo ${saldoAntes} → ${saldoDepois}`)
    auditar({ evento: 'CONCILIACAO', chave: r.chave, usdReal })
  }
  if (r.estado === 'CONCLUIDO') console.log(JSON.stringify(avaliarTomada({ arquivo: r.arquivo, quadro: QUADRO, rotulo: `${t.id}-runway-t${TENTATIVA}`, pastaTitular: PASTA_TITULAR }), null, 1))
  console.log('FIM: uma tomada. Nenhuma outra é gerada por este comando.')
}
main()
