/**
 * Primeiro modelo real de Machine Learning do Patrono (Rodada 9,
 * complemento ML, regra 11) — regressão logística treinada por gradiente
 * descendente, implementada em TypeScript puro (sem scikit-learn/XGBoost/
 * LightGBM — zero dependência nova, zero custo, regra 45). Isso é
 * genuinamente MACHINE_LEARNING (lib/ml-types.ts): os pesos são
 * OTIMIZADOS a partir de dados reais, não fixados manualmente — distinto
 * de RULE_BASED/STATISTICAL_LEARNING.
 *
 * Prevê `PredictedConversionProbability`. `ExpectedCommissionValue` é
 * DERIVADO (probabilidade × comissão média histórica do produto/categoria)
 * — não é um segundo modelo de regressão treinado nesta rodada (ver
 * MACHINE-LEARNING.md, seção "escopo desta rodada").
 */

import type { ContentMLFeatures } from './ml-feature-store'
import { HOOK_TYPES, type HookType } from './ml-hook-classifier'
import { CTA_TYPES, type CtaType } from './ml-cta-classifier'

// ── Vetorização de features ────────────────────────────────────────────
// Ordem FIXA e documentada — o mesmo vetor de nomes é salvo em
// `MLModel.features` para que qualquer pessoa (ou teste) consiga auditar
// exatamente o que o modelo usa.

const CANAIS_CONHECIDOS = ['tiktok', 'instagram'] as const

export function nomesDoVetorDeFeatures(): string[] {
  return [
    'price_bucket_mid',
    'price_bucket_high',
    'price_bucket_desconhecido',
    'video_duration_norm',
    'video_duration_missing',
    'posting_hour_sin',
    'posting_hour_cos',
    'posting_hour_missing',
    'historical_conversion_rate',
    'historical_conversion_missing',
    ...HOOK_TYPES.map((h) => `hook_${h.toLowerCase()}`),
    ...CTA_TYPES.map((c) => `cta_${c.toLowerCase()}`),
    ...CANAIS_CONHECIDOS.map((c) => `channel_${c}`),
    'channel_outro',
  ]
}

/** Determinístico e puro — sempre produz o mesmo vetor para as mesmas features, na mesma ordem de `nomesDoVetorDeFeatures()`. */
export function vetorizarFeatures(features: ContentMLFeatures): number[] {
  const v: number[] = []
  v.push(features.product_price_bucket === 'MID' ? 1 : 0)
  v.push(features.product_price_bucket === 'HIGH' ? 1 : 0)
  v.push(features.product_price_bucket === 'DESCONHECIDO' ? 1 : 0)

  const duracao = features.video_duration
  v.push(duracao != null ? duracao / 60 : 0)
  v.push(duracao != null ? 0 : 1)

  const hora = features.posting_hour
  if (hora != null) {
    const radianos = (hora / 24) * 2 * Math.PI
    v.push(Math.sin(radianos), Math.cos(radianos), 0)
  } else {
    v.push(0, 0, 1)
  }

  const historico = features.historical_conversion_rate
  v.push(historico ?? 0)
  v.push(historico != null ? 0 : 1)

  for (const h of HOOK_TYPES) v.push(features.hook_type === h ? 1 : 0)
  for (const c of CTA_TYPES) v.push(features.cta_type === c ? 1 : 0)

  const canalConhecido = CANAIS_CONHECIDOS.find((c) => c === features.channel)
  for (const c of CANAIS_CONHECIDOS) v.push(canalConhecido === c ? 1 : 0)
  v.push(features.channel && !canalConhecido ? 1 : 0)

  return v
}

// ── Padronização (z-score) ─────────────────────────────────────────────

export interface Padronizacao {
  medias: number[]
  desvios: number[]
}

export function calcularPadronizacao(X: number[][]): Padronizacao {
  const n = X.length
  const dims = X[0]?.length ?? 0
  const medias = new Array(dims).fill(0)
  for (const linha of X) for (let j = 0; j < dims; j++) medias[j] += linha[j] / n
  const desvios = new Array(dims).fill(0)
  for (const linha of X) for (let j = 0; j < dims; j++) desvios[j] += (linha[j] - medias[j]) ** 2 / n
  for (let j = 0; j < dims; j++) desvios[j] = Math.sqrt(desvios[j]) || 1 // nunca divide por zero (feature constante)
  return { medias, desvios }
}

export function aplicarPadronizacao(x: number[], p: Padronizacao): number[] {
  return x.map((v, j) => (v - p.medias[j]) / p.desvios[j])
}

// ── Regressão logística (gradiente descendente com regularização L2) ──

export interface ModeloLogisticoTreinado {
  pesos: number[]
  bias: number
  padronizacao: Padronizacao
  iteracoes: number
  perdaFinal: number
}

export interface OpcoesTreinamento {
  taxaAprendizado?: number
  maxIteracoes?: number
  lambdaL2?: number
  tolerancia?: number
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z))
}

/**
 * Treina por gradiente descendente em lote (batch), minimizando log-loss
 * com regularização L2 — essencial com poucas amostras (evita pesos
 * explodindo em features quase colineares, como os one-hots de hook/cta).
 */
export function treinarRegressaoLogistica(X: number[][], y: number[], opcoes: OpcoesTreinamento = {}): ModeloLogisticoTreinado {
  const taxaAprendizado = opcoes.taxaAprendizado ?? 0.1
  const maxIteracoes = opcoes.maxIteracoes ?? 2000
  const lambdaL2 = opcoes.lambdaL2 ?? 0.1
  const tolerancia = opcoes.tolerancia ?? 1e-6

  if (X.length === 0 || X.length !== y.length) throw new Error('Dados de treinamento vazios ou X/y de tamanhos diferentes.')

  const padronizacao = calcularPadronizacao(X)
  const Xn = X.map((linha) => aplicarPadronizacao(linha, padronizacao))
  const n = Xn.length
  const dims = Xn[0].length

  let pesos = new Array(dims).fill(0)
  let bias = 0
  let perdaAnterior = Infinity
  let iteracoesReais = 0

  for (let iter = 0; iter < maxIteracoes; iter++) {
    const gradPesos = new Array(dims).fill(0)
    let gradBias = 0
    let perda = 0

    for (let i = 0; i < n; i++) {
      const z = bias + Xn[i].reduce((s, v, j) => s + v * pesos[j], 0)
      const p = sigmoid(z)
      const erro = p - y[i]
      for (let j = 0; j < dims; j++) gradPesos[j] += (erro * Xn[i][j]) / n
      gradBias += erro / n
      const pClamp = Math.min(Math.max(p, 1e-9), 1 - 1e-9)
      perda += -(y[i] * Math.log(pClamp) + (1 - y[i]) * Math.log(1 - pClamp)) / n
    }
    // Regularização L2 (nunca aplicada ao bias)
    for (let j = 0; j < dims; j++) {
      gradPesos[j] += (lambdaL2 * pesos[j]) / n
      perda += (lambdaL2 / (2 * n)) * pesos[j] ** 2
    }

    for (let j = 0; j < dims; j++) pesos[j] -= taxaAprendizado * gradPesos[j]
    bias -= taxaAprendizado * gradBias

    iteracoesReais = iter + 1
    if (Math.abs(perdaAnterior - perda) < tolerancia) {
      perdaAnterior = perda
      break
    }
    perdaAnterior = perda
  }

  return { pesos, bias, padronizacao, iteracoes: iteracoesReais, perdaFinal: perdaAnterior }
}

export function preverProbabilidade(modelo: ModeloLogisticoTreinado, x: number[]): number {
  const xn = aplicarPadronizacao(x, modelo.padronizacao)
  const z = modelo.bias + xn.reduce((s, v, j) => s + v * modelo.pesos[j], 0)
  return sigmoid(z)
}

// ── Métricas ────────────────────────────────────────────────────────────

/** ROC-AUC via contagem de pares concordantes — O(n log n), sem dependência externa. */
export function calcularRocAuc(scores: number[], labels: number[]): number | null {
  const positivos = scores.filter((_, i) => labels[i] === 1)
  const negativos = scores.filter((_, i) => labels[i] === 0)
  if (positivos.length === 0 || negativos.length === 0) return null // AUC não é definida com uma classe só

  let concordantes = 0
  let empates = 0
  for (const p of positivos) {
    for (const neg of negativos) {
      if (p > neg) concordantes++
      else if (p === neg) empates++
    }
  }
  return (concordantes + 0.5 * empates) / (positivos.length * negativos.length)
}

export interface PrecisionRecall {
  precision: number | null
  recall: number | null
  threshold: number
}

export function calcularPrecisionRecall(scores: number[], labels: number[], threshold: number = 0.5): PrecisionRecall {
  let tp = 0
  let fp = 0
  let fn = 0
  for (let i = 0; i < scores.length; i++) {
    const previsto = scores[i] >= threshold ? 1 : 0
    if (previsto === 1 && labels[i] === 1) tp++
    else if (previsto === 1 && labels[i] === 0) fp++
    else if (previsto === 0 && labels[i] === 1) fn++
  }
  return {
    precision: tp + fp > 0 ? tp / (tp + fp) : null,
    recall: tp + fn > 0 ? tp / (tp + fn) : null,
    threshold,
  }
}

export interface BinCalibracao {
  faixa: [number, number]
  previstoMedia: number | null
  observadoMedia: number | null
  amostras: number
}

/** Calibração simples por bins (regra 32) — previsto médio vs. observado médio em cada faixa de score. */
export function calcularCalibracao(scores: number[], labels: number[], bins: number = 5): BinCalibracao[] {
  const resultado: BinCalibracao[] = []
  for (let b = 0; b < bins; b++) {
    const inicio = b / bins
    const fim = (b + 1) / bins
    const indices = scores.map((s, i) => ({ s, i })).filter(({ s }) => s >= inicio && (b === bins - 1 ? s <= fim : s < fim))
    if (indices.length === 0) {
      resultado.push({ faixa: [inicio, fim], previstoMedia: null, observadoMedia: null, amostras: 0 })
      continue
    }
    const previstoMedia = indices.reduce((s, { i }) => s + scores[i], 0) / indices.length
    const observadoMedia = indices.reduce((s, { i }) => s + labels[i], 0) / indices.length
    resultado.push({ faixa: [inicio, fim], previstoMedia, observadoMedia, amostras: indices.length })
  }
  return resultado
}

/** MAE/RMSE — preparadas para quando um alvo de regressão real (ex.: valor esperado) for treinado diretamente; não usadas pelo modelo de conversão desta rodada. */
export function calcularMAE(previstos: number[], reais: number[]): number {
  return previstos.reduce((s, p, i) => s + Math.abs(p - reais[i]), 0) / previstos.length
}

export function calcularRMSE(previstos: number[], reais: number[]): number {
  const mse = previstos.reduce((s, p, i) => s + (p - reais[i]) ** 2, 0) / previstos.length
  return Math.sqrt(mse)
}

export type { HookType, CtaType }
