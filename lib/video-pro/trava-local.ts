/**
 * P2.74 — TRAVA LOCAL DE GASTO da geração de vídeo por IA (Gemini Omni Flash), para o experimento da campanha 1.
 *
 * O pré-pago do Google não é teto exato (a cobrança chega com atraso e pode passar do saldo). Por isso a trava é
 * NOSSA e PREVENTIVA, e erra sempre para o lado de gastar menos:
 *   1. CUSTO MÁXIMO antes de cada pedido: saída (tokens/s × segundos, pela resolução) + entrada (imagens + texto),
 *      com duração não confirmada cobrada como a MAIOR permitida e margem para cobrança extra;
 *   2. RESERVA antes do envio: o custo máximo fica reservado até ser CONCILIADO com o painel de uso do Google
 *      (falha, filtro ou erro de rede continuam reservados: cobrança desconhecida conta como cobrada);
 *   3. LIMITE INTERNO abaixo do pré-pago (margem de latência de faturamento) + teto por pedido;
 *   4. UM PEDIDO POR VEZ (arquivo de trava criado com 'wx'; trava velha NUNCA é removida sozinha: pode haver pedido
 *      em andamento no fornecedor);
 *   5. SEM REENVIO AUTOMÁTICO: cada pedido tem chave única (sha256 do conteúdo + tomada + tentativa); a mesma chave é
 *      recusada para sempre, e a tentativa seguinte precisa ser pedida explicitamente, até o máximo por tomada;
 *   6. MODO SIMULAÇÃO por padrão: modo real só com a variável VIDEO_IA_PAGO_AUTORIZADO=sim E o arquivo de
 *      autorização da titular (texto, data e teto) no diretório do livro-caixa, com o mesmo teto.
 * Esta trava não chama a rede: devolve a liberação (ou a recusa) e registra a reserva.
 */
import { createHash } from 'node:crypto'
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type Resolucao = '360p' | '720p' | '1080p'

/** Preço OFICIAL (ai.google.dev/gemini-api/docs/pricing e /omni, lidos em 28/10/2026): saída US$ 17,50 por 1 M de
 *  tokens; tokens de saída por segundo de vídeo por resolução. Entrada: valor conservador (a página não separa). */
export const PRECO_OMNI = {
  modelo: 'gemini-omni-1.1-flash',
  usdPorMilhaoSaida: 17.5,
  usdPorMilhaoEntrada: 2.0,
  tokensPorSegundo: { '360p': 1931, '720p': 5792, '1080p': 8688 } as Record<Resolucao, number>,
  tokensPorImagem: 1120,
  /** Durações aceitas (Flow: 4/6/8/10 s). Na API a base não está documentada: sem confirmação, cobra-se a maior. */
  duracoesPermitidas: [4, 6, 8, 10],
  fonte: 'https://ai.google.dev/gemini-api/docs/pricing ; https://ai.google.dev/gemini-api/docs/omni',
  vistoEm: '2026-10-28',
} as const

export interface PedidoDeVideo {
  tomada: string
  tentativa: number
  resolucao: Resolucao
  segundos: number
  /** A API aceita fixar a duração pedida? Sem confirmação oficial, conta a maior duração permitida. */
  duracaoConfirmada: boolean
  prompt: string
  /** sha256 de cada imagem enviada (quadro inicial e referências), na ordem */
  imagensSha256: string[]
  /** P2.77: fornecedor. 'google' (padrão) = Gemini API, preço em tokens; 'runway' = Runway API, preço em créditos. */
  provedor?: 'google' | 'runway'
}

/** P2.77 — Runway API (docs.dev.runwayml.com/guides/pricing, lido em 29/10/2026): 1 crédito = US$ 0,01;
 *  gemini_omni_flash_1.1 = 3,4 / 10 / 15 créditos por segundo (360p/720p/1080p) + 1 por imagem de quadro inicial/referência.
 *  A duração é parâmetro (3–10 s inteiros), então é cobrada a pedida; sem margem, porque a tarefa devolve o custo real
 *  e o saldo da organização é conferido antes e depois. */
export const PRECO_RUNWAY = {
  modelo: 'gemini_omni_flash_1.1',
  usdPorCredito: 0.01,
  creditosPorSegundo: { '360p': 3.4, '720p': 10, '1080p': 15 } as Record<Resolucao, number>,
  creditosPorImagem: 1,
  duracaoMin: 3,
  duracaoMax: 10,
  fonte: 'https://docs.dev.runwayml.com/guides/pricing/ ; openapi.json (image_to_video, gemini_omni_flash_1.1)',
  vistoEm: '2026-10-29',
} as const

export function creditosMaximosRunway(p: PedidoDeVideo): number {
  if (!Number.isInteger(p.segundos) || p.segundos < PRECO_RUNWAY.duracaoMin || p.segundos > PRECO_RUNWAY.duracaoMax) throw new Error(`Duração Runway deve ser inteira entre ${PRECO_RUNWAY.duracaoMin} e ${PRECO_RUNWAY.duracaoMax} s.`)
  const cps = PRECO_RUNWAY.creditosPorSegundo[p.resolucao]
  if (!cps) throw new Error(`Resolução não prevista: ${p.resolucao}`)
  return Math.ceil(p.segundos * cps + p.imagensSha256.length * PRECO_RUNWAY.creditosPorImagem)
}

export interface ParametrosDaTrava {
  /** Saldo pré-pago autorizado pela titular (US$). */
  prePagoUsd: number
  /** Fração do pré-pago que a trava deixa usar (o resto absorve o atraso de faturamento). */
  fracaoUtilizavel: number
  /** Teto por pedido (US$). */
  tetoPorPedidoUsd: number
  /** Margem sobre o custo calculado (unidade não confirmada, arredondamentos, cobrança extra). 0,25 = +25%. */
  margemDeCobranca: number
  tentativasMaxPorTomada: number
  /** Parte do MESMO pré-pago separada para o revisor independente (as chamadas dele saem da mesma conta). */
  reservaParaRevisorUsd: number
}

export const PARAMETROS_PADRAO: ParametrosDaTrava = { prePagoUsd: 15, fracaoUtilizavel: 0.8, tetoPorPedidoUsd: 2.5, margemDeCobranca: 0.25, tentativasMaxPorTomada: 2, reservaParaRevisorUsd: 4.5 }

const tokensDeTexto = (s: string) => Math.ceil(s.length / 3) // conservador (≈4 caracteres por token em inglês)

export function segundosCobrados(p: Pick<PedidoDeVideo, 'segundos' | 'duracaoConfirmada'>): number {
  if (!Number.isFinite(p.segundos) || p.segundos <= 0) throw new Error('Duração inválida.')
  const ok = PRECO_OMNI.duracoesPermitidas
  const maior = ok[ok.length - 1]
  if (p.segundos > maior) throw new Error(`Duração acima do máximo do modelo (${maior} s).`)
  if (!p.duracaoConfirmada) return maior
  return ok.find((d) => d >= p.segundos) ?? maior
}

/** Custo MÁXIMO do pedido (US$, arredondado para cima no centavo), já com a margem de cobrança. */
export function custoMaximoUsd(p: PedidoDeVideo, margemDeCobranca = PARAMETROS_PADRAO.margemDeCobranca): { usd: number; detalhe: string } {
  if (p.provedor === 'runway') {
    const cr = creditosMaximosRunway(p)
    return { usd: +(cr * PRECO_RUNWAY.usdPorCredito).toFixed(2), detalhe: `${cr} créditos = ${p.segundos} s × ${PRECO_RUNWAY.creditosPorSegundo[p.resolucao]} + ${p.imagensSha256.length} imagem(ns) × ${PRECO_RUNWAY.creditosPorImagem} (Runway, duração fixada na chamada)` }
  }
  const tps = PRECO_OMNI.tokensPorSegundo[p.resolucao]
  if (!tps) throw new Error(`Resolução não prevista: ${p.resolucao}`)
  const s = segundosCobrados(p)
  const saida = (tps * s * PRECO_OMNI.usdPorMilhaoSaida) / 1e6
  const tokensEntrada = p.imagensSha256.length * PRECO_OMNI.tokensPorImagem + tokensDeTexto(p.prompt)
  const entrada = (tokensEntrada * PRECO_OMNI.usdPorMilhaoEntrada) / 1e6
  const usd = Math.ceil((saida + entrada) * (1 + margemDeCobranca) * 100) / 100
  return { usd, detalhe: `${s} s × ${tps} tokens/s × US$ ${PRECO_OMNI.usdPorMilhaoSaida}/M + ${tokensEntrada} tokens de entrada, +${Math.round(margemDeCobranca * 100)}%` }
}

export function chaveDoPedido(p: PedidoDeVideo): string {
  return createHash('sha256').update(JSON.stringify([p.provedor === 'runway' ? `runway:${PRECO_RUNWAY.modelo}` : PRECO_OMNI.modelo, p.tomada, p.tentativa, p.resolucao, p.segundos, p.prompt, p.imagensSha256])).digest('hex')
}

/** RESERVADO → ENVIANDO → CONCLUIDO | FALHOU | INDETERMINADO → CONCILIADO. Até CONCILIADO conta o custo MÁXIMO. */
export type EstadoDaReserva = 'RESERVADO' | 'ENVIANDO' | 'CONCLUIDO' | 'FALHOU' | 'INDETERMINADO' | 'CONCILIADO'
export interface Reserva { chave: string; tomada: string; tentativa: number; resolucao: Resolucao; usdMax: number; em: string; estado: EstadoDaReserva; usdReal?: number; modo: 'SIMULACAO' | 'REAL'; arquivo?: string; usdPelaResposta?: number; observacao?: string; idDoFornecedor?: string }
export interface LivroCaixa { reservas: Reserva[] }

/** O que conta no limite: reservado = custo máximo; conciliado = o MAIOR entre o real informado e zero (nunca negativo). */
export function comprometidoUsd(l: LivroCaixa, modo: 'SIMULACAO' | 'REAL'): number {
  return +l.reservas.filter((r) => r.modo === modo).reduce((s, r) => s + (r.estado === 'CONCILIADO' ? Math.max(0, r.usdReal ?? r.usdMax) : r.usdMax), 0).toFixed(2)
}

export type Decisao = { libera: true; chave: string; usdMax: number; comprometidoDepoisUsd: number; limiteInternoUsd: number } | { libera: false; motivo: string }

/** Decide SEM efeito colateral (função pura): o pedido cabe? */
export function decidir(l: LivroCaixa, p: PedidoDeVideo, par: ParametrosDaTrava, modo: 'SIMULACAO' | 'REAL'): Decisao {
  if (!Number.isInteger(p.tentativa) || p.tentativa < 1) return { libera: false, motivo: 'Tentativa inválida (começa em 1).' }
  if (p.tentativa > par.tentativasMaxPorTomada) return { libera: false, motivo: `Tomada ${p.tomada}: máximo de ${par.tentativasMaxPorTomada} tentativa(s).` }
  const chave = chaveDoPedido(p)
  if (l.reservas.some((r) => r.chave === chave)) return { libera: false, motivo: 'Pedido idêntico já registrado (reenvio bloqueado: peça a próxima tentativa explicitamente).' }
  const anteriores = l.reservas.filter((r) => r.tomada === p.tomada && r.modo === modo).map((r) => r.tentativa)
  if (anteriores.includes(p.tentativa)) return { libera: false, motivo: `Tomada ${p.tomada}, tentativa ${p.tentativa} já usada (com outro conteúdo).` }
  if (p.tentativa > 1 && !anteriores.includes(p.tentativa - 1)) return { libera: false, motivo: `Tomada ${p.tomada}: a tentativa ${p.tentativa - 1} não existe.` }
  let c: { usd: number }
  try { c = custoMaximoUsd(p, par.margemDeCobranca) } catch (e) { return { libera: false, motivo: (e as Error).message } }
  if (c.usd > par.tetoPorPedidoUsd) return { libera: false, motivo: `Custo máximo US$ ${c.usd} acima do teto por pedido (US$ ${par.tetoPorPedidoUsd}).` }
  const limite = +(par.prePagoUsd * par.fracaoUtilizavel - par.reservaParaRevisorUsd).toFixed(2)
  const depois = +(comprometidoUsd(l, modo) + c.usd).toFixed(2)
  if (depois > limite) return { libera: false, motivo: `Limite interno de vídeo de US$ ${limite} (${Math.round(par.fracaoUtilizavel * 100)}% do pré-pago de US$ ${par.prePagoUsd}, menos US$ ${par.reservaParaRevisorUsd} do revisor) seria ultrapassado: ${depois}.` }
  return { libera: true, chave, usdMax: c.usd, comprometidoDepoisUsd: depois, limiteInternoUsd: limite }
}

// ── Autorização e livro-caixa em disco ─────────────────────────────────────────────────────────────────────────

export interface AutorizacaoDaTitular { autorizadoPor: string; em: string; texto: string; prePagoUsd: number }

/** Modo REAL só com as duas chaves: variável de ambiente E autorização escrita com o MESMO teto. */
export function modoPermitido(dir: string, par: ParametrosDaTrava, env: Record<string, string | undefined> = process.env): { modo: 'SIMULACAO' | 'REAL'; motivo: string } {
  if (env.VIDEO_IA_PAGO_AUTORIZADO !== 'sim') return { modo: 'SIMULACAO', motivo: 'VIDEO_IA_PAGO_AUTORIZADO não é "sim".' }
  const f = join(dir, 'autorizacao.json')
  if (!existsSync(f)) return { modo: 'SIMULACAO', motivo: 'Sem autorizacao.json da titular.' }
  let a: AutorizacaoDaTitular
  try { a = JSON.parse(readFileSync(f, 'utf8')) } catch { return { modo: 'SIMULACAO', motivo: 'autorizacao.json ilegível.' } }
  if (!a.autorizadoPor || !a.em || !a.texto || a.prePagoUsd !== par.prePagoUsd) return { modo: 'SIMULACAO', motivo: 'Autorização incompleta ou com teto diferente do configurado.' }
  return { modo: 'REAL', motivo: `Autorizado por ${a.autorizadoPor} em ${a.em} (pré-pago US$ ${a.prePagoUsd}).` }
}

const arqLivro = (dir: string) => join(dir, 'livro-caixa.json')
const arqDiario = (dir: string) => join(dir, 'diario.jsonl')
const arqTrava = (dir: string) => join(dir, 'pedido-em-andamento.lock')
export const lerLivro = (dir: string): LivroCaixa => (existsSync(arqLivro(dir)) ? JSON.parse(readFileSync(arqLivro(dir), 'utf8')) : { reservas: [] })
function gravarLivro(dir: string, l: LivroCaixa, evento: Record<string, unknown>) {
  // P2.75: diário só de acréscimo ANTES do livro (gravação atômica por rename): livro apagado, truncado ou voltado
  // para trás é detectado (o diário tem mais reservas que o livro) e nada mais é enviado
  appendFileSync(arqDiario(dir), JSON.stringify({ em: new Date().toISOString(), ...evento }) + '\n')
  const tmp = arqLivro(dir) + '.tmp'
  writeFileSync(tmp, JSON.stringify(l, null, 1))
  renameSync(tmp, arqLivro(dir))
}

/** Pedidos sem desfecho conhecido: bloqueiam qualquer novo envio até a conciliação com o painel do Google. */
const PENDENTES: EstadoDaReserva[] = ['ENVIANDO', 'INDETERMINADO']

/** Livro legível, coerente com o diário e sem pedido pendente? (falha = nada é enviado) */
export function integridade(dir: string): { ok: true; livro: LivroCaixa } | { ok: false; motivo: string } {
  let l: LivroCaixa
  try { l = lerLivro(dir); if (!Array.isArray(l.reservas)) throw new Error() } catch { return { ok: false, motivo: 'Livro-caixa ilegível: nada é enviado até a conferência manual.' } }
  const reservadas = existsSync(arqDiario(dir)) ? new Set(readFileSync(arqDiario(dir), 'utf8').split('\n').filter(Boolean).map((x) => { try { return JSON.parse(x) } catch { return {} } }).filter((e) => e.tipo === 'RESERVA').map((e) => e.chave)) : new Set<string>()
  const noLivro = new Set(l.reservas.map((r) => r.chave))
  const sumidas = [...reservadas].filter((c) => !noLivro.has(c))
  if (sumidas.length) return { ok: false, motivo: `Livro-caixa sem ${sumidas.length} reserva(s) registrada(s) no diário (apagado ou restaurado?): nada é enviado.` }
  const pend = l.reservas.filter((r) => PENDENTES.includes(r.estado))
  if (pend.length) return { ok: false, motivo: `Pedido sem desfecho conhecido (${pend.map((r) => `${r.tomada} t${r.tentativa}: ${r.estado}`).join(', ')}): confira o uso no painel do Google e concilie antes de qualquer novo envio.` }
  return { ok: true, livro: l }
}

function marcar(dir: string, chave: string, estado: EstadoDaReserva, extra: Partial<Reserva> = {}) {
  const l = lerLivro(dir)
  const r = l.reservas.find((x) => x.chave === chave)
  if (!r) throw new Error('Reserva não encontrada.')
  Object.assign(r, extra, { estado })
  gravarLivro(dir, l, { tipo: estado, chave, ...extra })
}

/**
 * Reserva o pedido (um por vez). Devolve a decisão; se liberado, a reserva JÁ está gravada e a trava de pedido em
 * andamento fica criada — só `encerrarPedido` a remove, depois que o pedido terminar (com sucesso ou não).
 */
export function reservar(dir: string, p: PedidoDeVideo, par: ParametrosDaTrava = PARAMETROS_PADRAO, agora = new Date(), env: Record<string, string | undefined> = process.env): Decisao & { modo: 'SIMULACAO' | 'REAL' } {
  mkdirSync(dir, { recursive: true })
  const { modo } = modoPermitido(dir, par, env)
  let fd: number
  try { fd = openSync(arqTrava(dir), 'wx') } catch {
    return { libera: false, motivo: 'Há um pedido em andamento (ou trava antiga). Confira no painel do Google antes de remover a trava manualmente.', modo }
  }
  closeSync(fd)
  // P2.75: apagar a trava à mão NÃO libera envio: pedido pendente no livro, livro ilegível ou adulterado também bloqueiam
  const ok = integridade(dir)
  if (!ok.ok) { unlinkSync(arqTrava(dir)); return { libera: false, motivo: ok.motivo, modo } }
  const l = ok.livro
  const d = decidir(l, p, par, modo)
  if (!d.libera) { unlinkSync(arqTrava(dir)); return { ...d, modo } }
  l.reservas.push({ chave: d.chave, tomada: p.tomada, tentativa: p.tentativa, resolucao: p.resolucao, usdMax: d.usdMax, em: agora.toISOString(), estado: 'RESERVADO', modo })
  gravarLivro(dir, l, { tipo: 'RESERVA', chave: d.chave, usdMax: d.usdMax, modo })
  return { ...d, modo }
}

/** Fim do pedido: remove a trava de andamento. A reserva continua contando o custo máximo até ser conciliada. */
export function encerrarPedido(dir: string): void {
  if (existsSync(arqTrava(dir))) unlinkSync(arqTrava(dir))
}

/**
 * Conciliação com o painel de uso do Google: grava o custo real informado (≥ 0). Resolve também pedido ENVIANDO ou
 * INDETERMINADO (processo interrompido, conexão caída, resposta desconhecida); a trava sai quando não resta pendente.
 */
export function conciliar(dir: string, chave: string, usdReal: number, observacao = ''): void {
  if (!Number.isFinite(usdReal) || usdReal < 0) throw new Error('Valor real inválido.')
  marcar(dir, chave, 'CONCILIADO', { usdReal, observacao })
  if (!lerLivro(dir).reservas.some((r) => PENDENTES.includes(r.estado))) encerrarPedido(dir)
}

// ── Execução com a trava (sem rede aqui: o envio é injetado) ──────────────────────────────────────────────────

/** Desfecho do envio, classificado por quem chama a API. Só RECUSADO_SEM_PROCESSAR (erro de validação ANTES de gerar,
 *  ex.: HTTP 400 com o pedido rejeitado) libera a trava; o custo máximo continua reservado até a conciliação. */
export type Desfecho =
  | { tipo: 'CONCLUIDO'; arquivo: string; tokensDeSaida?: number; usdInformado?: number }
  | { tipo: 'RECUSADO_SEM_PROCESSAR'; detalhe: string }
  /** P2.77: o fornecedor informa a falha E o custo final (Runway: FAILED/CANCELLED com `cost`; reembolsada = 0) */
  | { tipo: 'FALHOU_NO_FORNECEDOR'; detalhe: string; usdInformado: number }

export type ResultadoDaExecucao =
  | { estado: 'NAO_ENVIADO'; motivo: string }
  | { estado: 'CONCLUIDO'; chave: string; arquivo: string; usdMax: number; usdPelaResposta: number | null }
  | { estado: 'FALHOU'; chave: string; detalhe: string }
  | { estado: 'INDETERMINADO'; chave: string; detalhe: string }

/**
 * Reserva → marca ENVIANDO (gravado ANTES da chamada) → UMA chamada, com tempo-limite → registra o desfecho.
 * Sem reenvio: exceção, tempo esgotado ou resposta fora do formato = INDETERMINADO (o Google pode ter gerado e cobrado):
 * a trava FICA e nada mais sai até a conciliação. Se o processo morrer no meio, o livro fica em ENVIANDO — mesmo efeito.
 */
export async function executarComTrava(
  dir: string,
  p: PedidoDeVideo,
  enviar: (p: PedidoDeVideo, sinal: AbortSignal, aoReceberId: (id: string) => void) => Promise<unknown>,
  o: { par?: ParametrosDaTrava; env?: Record<string, string | undefined>; tempoLimiteMs?: number; exigirModoReal?: boolean } = {},
): Promise<ResultadoDaExecucao> {
  const par = o.par ?? PARAMETROS_PADRAO
  const r = reservar(dir, p, par, new Date(), o.env ?? process.env)
  if (!r.libera) return { estado: 'NAO_ENVIADO', motivo: r.motivo }
  if (o.exigirModoReal && r.modo !== 'REAL') {
    // reserva de simulação sem envio: fica registrada (custo de simulação), trava liberada
    marcar(dir, r.chave, 'FALHOU', { observacao: 'modo SIMULAÇÃO: nada enviado' }); encerrarPedido(dir)
    return { estado: 'NAO_ENVIADO', motivo: 'Modo SIMULAÇÃO (sem as duas chaves de autorização): nada foi enviado.' }
  }
  marcar(dir, r.chave, 'ENVIANDO')
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), o.tempoLimiteMs ?? 15 * 60_000)
  let resp: unknown
  // P2.75: o id da interação (modo background do Omni) é gravado ASSIM que chega: interrompido depois disso, o
  // resultado é RECUPERADO pelo id (consulta, sem nova geração), nunca reenviado
  const aoReceberId = (id: string) => { if (typeof id === 'string' && id) marcar(dir, r.chave, 'ENVIANDO', { idDoFornecedor: id }) }
  try { resp = await enviar(p, ctl.signal, aoReceberId) } catch (e) {
    clearTimeout(t)
    const detalhe = `${(e as Error)?.name ?? 'erro'}: ${(e as Error)?.message ?? String(e)}`.slice(0, 300)
    marcar(dir, r.chave, 'INDETERMINADO', { observacao: detalhe })
    return { estado: 'INDETERMINADO', chave: r.chave, detalhe }
  }
  clearTimeout(t)
  return registrarDesfecho(dir, r.chave, r.usdMax, resp)
}

function registrarDesfecho(dir: string, chave: string, usdMax: number, resp: unknown): ResultadoDaExecucao {
  const d = resp as Partial<Desfecho> | null
  if (d?.tipo === 'CONCLUIDO' && typeof d.arquivo === 'string' && d.arquivo) {
    const usdPelaResposta = Number.isFinite(d.usdInformado) ? +Number(d.usdInformado).toFixed(4) : Number.isFinite(d.tokensDeSaida) ? +((Number(d.tokensDeSaida) * PRECO_OMNI.usdPorMilhaoSaida) / 1e6).toFixed(4) : null
    marcar(dir, chave, 'CONCLUIDO', { arquivo: d.arquivo, usdPelaResposta: usdPelaResposta ?? undefined })
    encerrarPedido(dir)
    return { estado: 'CONCLUIDO', chave, arquivo: d.arquivo, usdMax, usdPelaResposta }
  }
  if (d?.tipo === 'FALHOU_NO_FORNECEDOR' && typeof d.detalhe === 'string' && Number.isFinite(d.usdInformado) && Number(d.usdInformado) >= 0) {
    // desfecho e custo informados pelo fornecedor: fica FALHOU com o valor informado; a conciliação pelo saldo confirma
    marcar(dir, chave, 'FALHOU', { observacao: d.detalhe.slice(0, 300), usdPelaResposta: Number(d.usdInformado) })
    encerrarPedido(dir)
    return { estado: 'FALHOU', chave, detalhe: d.detalhe }
  }
  if (d?.tipo === 'RECUSADO_SEM_PROCESSAR' && typeof d.detalhe === 'string') {
    marcar(dir, chave, 'FALHOU', { observacao: d.detalhe.slice(0, 300) })
    encerrarPedido(dir)
    return { estado: 'FALHOU', chave, detalhe: d.detalhe }
  }
  const detalhe = `resposta fora do formato esperado: ${JSON.stringify(resp)?.slice(0, 200)}`
  marcar(dir, chave, 'INDETERMINADO', { observacao: detalhe })
  return { estado: 'INDETERMINADO', chave, detalhe }
}

/**
 * Retomada de pedido ENVIANDO/INDETERMINADO que já tem o id do fornecedor: CONSULTA o resultado pelo id (não gera de
 * novo, não reserva de novo). Sem id, só a conciliação manual com o painel resolve.
 */
export async function recuperarPorId(dir: string, chave: string, consultar: (id: string) => Promise<unknown>): Promise<ResultadoDaExecucao> {
  const r = lerLivro(dir).reservas.find((x) => x.chave === chave)
  if (!r) return { estado: 'NAO_ENVIADO', motivo: 'Reserva não encontrada.' }
  if (!PENDENTES.includes(r.estado)) return { estado: 'NAO_ENVIADO', motivo: `Reserva em ${r.estado}: nada a recuperar.` }
  if (!r.idDoFornecedor) return { estado: 'NAO_ENVIADO', motivo: 'Sem id do fornecedor: concilie com o painel do Google (não reenviar).' }
  let resp: unknown
  try { resp = await consultar(r.idDoFornecedor) } catch (e) { return { estado: 'INDETERMINADO', chave, detalhe: `consulta falhou: ${(e as Error)?.message}` } }
  return registrarDesfecho(dir, chave, r.usdMax, resp)
}
