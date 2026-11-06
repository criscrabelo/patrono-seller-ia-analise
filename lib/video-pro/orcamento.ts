/**
 * P2.42 — Orçamento da geração PROFISSIONAL de vídeo (arquitetura híbrida). Funções PURAS.
 *
 * O vídeo comercial continua sendo montado localmente (FFmpeg, R$ 0) com as filmagens REAIS do produto; a IA paga
 * entra só em TRECHOS curtos (animar uma foto real, estender/estabilizar um take real, upscale). Por isso o custo é
 * contado por SEGUNDO GERADO, não por vídeo, e toda estimativa inclui as tentativas extras e as falhas cobradas.
 *
 * Três barreiras antes de qualquer chamada (a 3ª é o Cost Governor já existente, que é soberano):
 *   1. estimativa ANTES da geração (pior caso: todas as tentativas, com margem de câmbio);
 *   2. LIMITE RÍGIDO POR EXECUÇÃO: o pior caso da execução inteira tem de caber; se não couber, nada é reservado;
 *   3. orçamento mensal/diário + duas chaves de ambiente + Safe Mode (`cost-governor.reservarCusto`).
 * Errar para o lado de gastar menos: arredonda para CIMA, falha de cobrança desconhecida conta como cobrada.
 */
import type { ModeloDeVideo } from './catalogo'

export interface Cambio {
  /** BRL por 1 USD. */
  brlPorUsd: number
  /** Margem sobre o câmbio (IOF de cartão internacional, spread). 0,10 = +10%. */
  margem: number
}

// PTAX venda 19/10/2026 = 5,0564 (Banco Central). Margem 10%: IOF de cartão internacional (3,5%) + spread.
export const CAMBIO_PADRAO: Cambio = { brlPorUsd: 5.0564, margem: 0.1 }

/** Centavos de real por tentativa de `segundos` no modelo (arredonda para cima; mínimo de cobrança do modelo). */
export function centavosPorTentativa(m: ModeloDeVideo, segundos: number, c: Cambio = CAMBIO_PADRAO): number {
  if (!Number.isFinite(segundos) || segundos <= 0) throw new Error('Duração inválida.')
  const cobrados = Math.max(m.segundosMinimos ?? 0, m.duracoesPermitidas ? arredondarDuracao(m, segundos) : segundos)
  const usd = cobrados * m.usdPorSegundo
  return Math.ceil(usd * c.brlPorUsd * (1 + c.margem) * 100)
}

/** Duração que o modelo aceita: a menor permitida ≥ pedida (cobra-se a que for gerada). */
export function arredondarDuracao(m: ModeloDeVideo, segundos: number): number {
  const ok = [...(m.duracoesPermitidas ?? [])].sort((a, b) => a - b)
  const d = ok.find((x) => x >= segundos) ?? ok[ok.length - 1]
  if (d === undefined) return segundos
  return d
}

export interface EstimativaDeExecucao {
  modelo: string
  segundosPorTentativa: number
  centavosPorTentativa: number
  tentativasMax: number
  /** Pior caso: TODAS as tentativas cobradas. É o que precisa caber no limite por execução. */
  piorCasoCentavos: number
  /** Esperado com a taxa de refação informada (para orçamento mensal). */
  esperadoCentavos: number
  /** Falhas do provedor são cobradas? 'desconhecido' é tratado como SIM. */
  falhaCobrada: boolean
}

/**
 * Estimativa ANTES de gerar. `taxaDeRefacao` = fração de tentativas que precisam ser refeitas (falha técnica,
 * moderação ou reprovação na checagem de fidelidade). Esperado = custo × 1/(1−taxa), limitado a `tentativasMax`.
 */
export function estimarExecucao(p: { modelo: ModeloDeVideo; segundos: number; tentativasMax: number; taxaDeRefacao: number; cambio?: Cambio }): EstimativaDeExecucao {
  if (!Number.isInteger(p.tentativasMax) || p.tentativasMax < 1 || p.tentativasMax > 5) throw new Error('tentativasMax deve ficar entre 1 e 5.')
  if (!(p.taxaDeRefacao >= 0 && p.taxaDeRefacao < 1)) throw new Error('taxaDeRefacao deve ficar em [0, 1).')
  const unit = centavosPorTentativa(p.modelo, p.segundos, p.cambio)
  // Tentativas esperadas com no máximo N: soma de q^k, k = 0..N−1 (q = taxa de refação).
  let esperadas = 0
  for (let k = 0; k < p.tentativasMax; k++) esperadas += p.taxaDeRefacao ** k
  return {
    modelo: p.modelo.id,
    segundosPorTentativa: p.modelo.duracoesPermitidas ? arredondarDuracao(p.modelo, p.segundos) : p.segundos,
    centavosPorTentativa: unit,
    tentativasMax: p.tentativasMax,
    piorCasoCentavos: unit * p.tentativasMax,
    esperadoCentavos: Math.ceil(unit * esperadas),
    falhaCobrada: p.modelo.falhaCobrada !== false,
  }
}

export type VereditoDoLimite = { cabe: true } | { cabe: false; motivo: string }

/** Limite RÍGIDO por execução: o pior caso inteiro tem de caber. Sem limite configurado (≤ 0) = não cabe. */
export function verificarLimiteDaExecucao(e: EstimativaDeExecucao, limiteCentavos: number): VereditoDoLimite {
  if (!Number.isInteger(limiteCentavos) || limiteCentavos <= 0) return { cabe: false, motivo: 'Limite por execução não configurado (R$ 0,00): nada é gerado.' }
  if (e.piorCasoCentavos > limiteCentavos) {
    return { cabe: false, motivo: `Pior caso de ${brl(e.piorCasoCentavos)} (${e.tentativasMax} tentativa(s) de ${brl(e.centavosPorTentativa)}) passa do limite por execução de ${brl(limiteCentavos)}.` }
  }
  return { cabe: true }
}

/** Dentro da execução: a PRÓXIMA tentativa ainda cabe no que sobrou do limite? */
export function proximaTentativaCabe(gastoNaExecucaoCentavos: number, centavosDaTentativa: number, limiteCentavos: number): boolean {
  return gastoNaExecucaoCentavos + centavosDaTentativa <= limiteCentavos
}

export const brl = (centavos: number) => `R$ ${(centavos / 100).toFixed(2).replace('.', ',')}`

// ── Simulação mensal ─────────────────────────────────────────────────────────

export interface PerfilDeVideo {
  nome: string
  /** Trechos de IA por vídeo (o resto é filmagem real montada localmente, R$ 0). */
  trechos: Array<{ modelo: ModeloDeVideo; segundos: number }>
  tentativasMax: number
  taxaDeRefacao: number
  /** Parte da refação que é FALHA DO FORNECEDOR (o resto é reprovação na checagem de fidelidade, sempre cobrada).
   *  Em modelo com `falhaCobrada === false` essa parte não entra no esperado; no pior caso entra sempre. */
  taxaDeFalhaDoFornecedor?: number
  /** Fração dos vídeos que é descartada inteira (titular rejeita / Quality Gate) e refeita do zero. */
  taxaDeDescarte: number
}

export interface LinhaDaSimulacao {
  videosPorMes: number
  perfil: string
  esperadoCentavos: number
  piorCasoCentavos: number
  porVideoEsperadoCentavos: number
}

/** Esperado e pior caso para N vídeos aprovados no mês, com refações por trecho e descarte de vídeos inteiros. */
export function simularMes(videosPorMes: number, perfil: PerfilDeVideo, cambio: Cambio = CAMBIO_PADRAO): LinhaDaSimulacao {
  let esperado = 0
  let pior = 0
  for (const t of perfil.trechos) {
    const e = estimarExecucao({ modelo: t.modelo, segundos: t.segundos, tentativasMax: perfil.tentativasMax, taxaDeRefacao: perfil.taxaDeRefacao, cambio })
    const falha = perfil.taxaDeFalhaDoFornecedor ?? 0
    if (t.modelo.falhaCobrada === false && falha > 0 && perfil.taxaDeRefacao > 0) {
      // Tentativas extras esperadas × fração delas que é cobrada (só as reprovadas na fidelidade).
      const extras = e.esperadoCentavos / e.centavosPorTentativa - 1
      const cobrada = Math.max(0, perfil.taxaDeRefacao - falha) / perfil.taxaDeRefacao
      esperado += Math.ceil(e.centavosPorTentativa * (1 + extras * cobrada))
    } else esperado += e.esperadoCentavos
    pior += e.piorCasoCentavos
  }
  const fatorDescarte = 1 / (1 - perfil.taxaDeDescarte)
  const porVideo = Math.ceil(esperado * fatorDescarte)
  return {
    videosPorMes,
    perfil: perfil.nome,
    esperadoCentavos: porVideo * videosPorMes,
    // Pior caso: todos os trechos em todas as tentativas, mais os descartes refeitos também no pior caso.
    piorCasoCentavos: Math.ceil(pior * fatorDescarte) * videosPorMes,
    porVideoEsperadoCentavos: porVideo,
  }
}
