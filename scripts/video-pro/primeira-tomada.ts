// P2.75/P2.76 — PRIMEIRA TOMADA (uma só) do Arduino UNO R4 WiFi no Gemini Omni Flash, pela trava de gasto.
//   node node_modules/tsx/dist/cli.mjs scripts/video-pro/primeira-tomada.ts                  → SIMULAÇÃO (padrão)
//   node node_modules/tsx/dist/cli.mjs scripts/video-pro/primeira-tomada.ts --verificar      → confere o modelo na conta (consulta gratuita)
//   node node_modules/tsx/dist/cli.mjs scripts/video-pro/primeira-tomada.ts --enviar [--tentativa=2]
//   node node_modules/tsx/dist/cli.mjs scripts/video-pro/primeira-tomada.ts --recuperar=<chave>   → consulta pelo id, sem nova geração
// Envio SÓ com: VIDEO_IA_PAGO_AUTORIZADO=sim + autorizacao.json da titular que LISTE esta tomada e tentativa
// (`pedidosAutorizados`), com teto ≤ US$ 1,27. A 2ª tentativa exige item próprio com justificativa técnica.
// Chave da API: GEMINI_API_KEY_PAGO ou o arquivo <livro>/gemini-pago.key (fora do OneDrive); nunca impressa nem gravada.
// Depois de gerar: conferência de fidelidade, folha de quadros, custo pela resposta e cópia para avaliação visual.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { criarEnvioOmni, montarCorpo } from '../../lib/video-pro/omni-gemini'
import { avaliarTomada } from './avaliar-tomada'
import { PARAMETROS_PADRAO, PRECO_OMNI, custoMaximoUsd, decidir, executarComTrava, integridade, lerLivro, modoPermitido, recuperarPorId, type ParametrosDaTrava, type PedidoDeVideo } from '../../lib/video-pro/trava-local'

const LOCAL = process.env.LOCALAPPDATA ?? '.'
const CAMP = join(LOCAL, 'PatronoSeller', 'campanha-arduino-r4')
const DIR = join(LOCAL, 'PatronoSeller', 'video-ia-livro')
const SAIDA = join(CAMP, 'tomadas-ia'); mkdirSync(SAIDA, { recursive: true }); mkdirSync(DIR, { recursive: true })
const PASTA_TITULAR = join(process.env.USERPROFILE ?? '.', 'OneDrive', 'Área de Trabalho', 'PATRONO SELLER', 'Vídeos Arduino UNO R4 WiFi', 'TESTE TÉCNICO IA - NÃO PUBLICAR')
export const TETO_DA_PRIMEIRA_TOMADA_USD = 1.27
const arg = process.argv.slice(2)
const TENTATIVA = Number(arg.find((a) => a.startsWith('--tentativa='))?.split('=')[1] ?? 1)
const plano = JSON.parse(readFileSync(join(__dirname, '..', '..', 'campanhas', 'arduino-r4-tomadas-ia.json'), 'utf8')) as { tomadas: { id: string; prompt: string; quadroInicial: string }[] }
const t = plano.tomadas.find((x) => x.id === 'ia-abertura')!
const QUADRO = join(CAMP, t.quadroInicial)
const png = readFileSync(QUADRO)
const pedido: PedidoDeVideo = { tomada: t.id, tentativa: TENTATIVA, resolucao: '720p', segundos: 6, duracaoConfirmada: false, prompt: t.prompt, imagensSha256: [createHash('sha256').update(png).digest('hex')] }

interface ItemAutorizado { tomada: string; tentativa: number; tetoUsd: number; justificativa?: string }
function autorizacao(): { prePagoUsd: number; itens: ItemAutorizado[] } | null {
  try { const a = JSON.parse(readFileSync(join(DIR, 'autorizacao.json'), 'utf8')); return { prePagoUsd: a.prePagoUsd, itens: Array.isArray(a.pedidosAutorizados) ? a.pedidosAutorizados : [] } } catch { return null }
}
/** Parâmetros desta etapa: teto por pedido = o menor entre US$ 1,27 e o autorizado; o revisor ainda não tem gasto autorizado. */
function parametros(item: ItemAutorizado | undefined, prePagoUsd: number): ParametrosDaTrava {
  return { ...PARAMETROS_PADRAO, prePagoUsd, reservaParaRevisorUsd: 0, tetoPorPedidoUsd: Math.min(TETO_DA_PRIMEIRA_TOMADA_USD, item?.tetoUsd ?? 0) }
}
function chaveDaApi(): string | null {
  if (process.env.GEMINI_API_KEY_PAGO) return process.env.GEMINI_API_KEY_PAGO.trim()
  const f = join(DIR, 'gemini-pago.key')
  return existsSync(f) ? readFileSync(f, 'utf8').trim() || null : null
}

/** Avaliação objetiva logo depois da geração (local, R$ 0): módulo comum com a Runway. */
function avaliar(arquivo: string, tokensDeSaida: number | null) {
  return { custoPelaRespostaUsd: tokensDeSaida != null ? +((tokensDeSaida * PRECO_OMNI.usdPorMilhaoSaida) / 1e6).toFixed(4) : null, ...avaliarTomada({ arquivo, quadro: QUADRO, rotulo: `ia-abertura-t${TENTATIVA}`, pastaTitular: PASTA_TITULAR }) }
}

async function main() {
  const aut = autorizacao()
  const item = aut?.itens.find((i) => i.tomada === pedido.tomada && i.tentativa === pedido.tentativa && (pedido.tentativa === 1 || !!i.justificativa?.trim()))
  const par = parametros(item, aut?.prePagoUsd ?? PARAMETROS_PADRAO.prePagoUsd)
  const modo = modoPermitido(DIR, par)
  const ok = integridade(DIR)
  const c = custoMaximoUsd(pedido)
  console.log(JSON.stringify({
    tomada: pedido.tomada, tentativa: pedido.tentativa, quadroInicialSha256: pedido.imagensSha256[0],
    corpo: montarCorpo(pedido, `<base64 de ${t.quadroInicial}, ${png.length} bytes>`, 'image/png'),
    custoMaximoUsd: c.usd, conta: c.detalhe, tetoDestaTomadaUsd: par.tetoPorPedidoUsd, modo: modo.modo, motivoDoModo: modo.motivo,
    autorizacaoDestaTentativa: item ? 'listada' : 'NÃO listada em autorizacao.json', chaveDaApi: chaveDaApi() ? 'presente (não exibida)' : 'ausente',
    livro: ok.ok ? 'íntegro' : ok.motivo, decisao: ok.ok ? decidir(ok.livro, pedido, par, modo.modo) : null,
  }, null, 1))
  const chave = chaveDaApi()
  if (arg.includes('--verificar')) {
    if (!chave) { console.log('Sem chave da API: nada verificado.'); return }
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${PRECO_OMNI.modelo}`, { headers: { 'x-goog-api-key': chave } })
    const j = (await r.json().catch(() => ({}))) as { name?: string; displayName?: string; error?: { message?: string } }
    console.log(JSON.stringify({ verificacaoDoModelo: r.status, nome: j.name ?? null, exibicao: j.displayName ?? null, erro: j.error?.message ?? null }))
    return
  }
  const rec = arg.find((a) => a.startsWith('--recuperar='))
  if (rec) {
    if (!chave) throw new Error('chave da API ausente')
    const o = criarEnvioOmni({ chave, fetch: fetch as never, pastaSaida: SAIDA })
    const r = await recuperarPorId(DIR, rec.slice('--recuperar='.length), o.consultar)
    console.log(JSON.stringify(r)); if (r.estado === 'CONCLUIDO') console.log(JSON.stringify(avaliar(r.arquivo, r.usdPelaResposta != null ? Math.round((r.usdPelaResposta * 1e6) / PRECO_OMNI.usdPorMilhaoSaida) : null), null, 1))
    return
  }
  if (!arg.includes('--enviar')) { console.log('SIMULAÇÃO: nada foi enviado.'); return }
  if (modo.modo !== 'REAL') { console.log(`NÃO ENVIADO: ${modo.motivo}`); return }
  if (!item) { console.log(`NÃO ENVIADO: a tentativa ${pedido.tentativa} da tomada ${pedido.tomada} não está autorizada${pedido.tentativa > 1 ? ' (a 2ª exige justificativa técnica)' : ''}.`); return }
  if (!chave) { console.log('NÃO ENVIADO: chave da API ausente.'); return }
  const o = criarEnvioOmni({ chave, fetch: fetch as never, pastaSaida: SAIDA })
  const r = await executarComTrava(DIR, pedido, (p, s, id) => o.enviar(p, s, id, { base64: png.toString('base64'), mime: 'image/png' }), { par, exigirModoReal: true })
  console.log(JSON.stringify(r, null, 1))
  console.log('Livro:', JSON.stringify(lerLivro(DIR).reservas.at(-1)))
  if (r.estado === 'CONCLUIDO') console.log(JSON.stringify(avaliar(r.arquivo, r.usdPelaResposta != null ? Math.round((r.usdPelaResposta * 1e6) / PRECO_OMNI.usdPorMilhaoSaida) : null), null, 1))
  console.log('FIM: uma tomada. Nenhuma outra é gerada por este comando.')
}
main()
