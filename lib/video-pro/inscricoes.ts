/**
 * P2.84 — Similaridade visual NÃO aprova produto com inscrições.
 *
 * Caso real (29/10/2026, tomada ia-heroi, Runway/Gemini Omni Flash): a IA reescreveu o silk da placa
 * (IOREF→"ZOREF", RESET→"MESSY", 3.3V→"X.3V", GND→"CND", ANALOG→"ANXL…") e a conferência geométrica aprovou com
 * correlação 0,971; nem a grade 16×16 separou o texto trocado do fiel (pior região 0,916 alterado × 0,859 fiel).
 * Logo: para produto com inscrições ou componentes técnicos (placas, eletrônicos, embalagens com texto, livros),
 * a nota de similaridade só pode REPROVAR. Aprovar exige conferência das inscrições feita por pessoa, presa ao
 * sha256 exato do arquivo conferido. Sem ela: BLOQUEADO (nunca APROVADO automático).
 * Este bloqueio só sai quando existir um verificador de inscrições validado contra o caso obrigatório abaixo.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

export type DecisaoDeFidelidade = 'APROVADO' | 'REPROVADO' | 'BLOQUEADO_CONFERIR_INSCRICOES'

export interface ConferenciaDeInscricoes {
  /** sha256 do arquivo conferido: conferência de outro arquivo não vale */
  sha256: string
  aprovada: boolean
  /** só pessoa confere hoje; verificador automático entra aqui quando for validado (VERIFICADOR_DE_INSCRICOES_VALIDADO) */
  por: 'HUMANO'
  em: string
  /** inscrições lidas no vídeo × na referência (ex.: "IOREF → ZOREF") */
  divergencias: string[]
  /** quem conferiu (pessoa identificada). O agente produtor nunca confere a própria criação. */
  revisor: string
}

/** Nomes que identificam o PRODUTOR (o Patrono/agente): conferência assinada por eles não é independente. */
const PRODUTOR = /patrono|claude|agente|assistente|automa|\bia\b|\bai\b|gpt|gemini|runway/i
export const revisorIndependente = (revisor: string | undefined | null) => !!revisor && revisor.trim().length >= 3 && !PRODUTOR.test(revisor)

/** Nenhum verificador automático de inscrições passou no caso obrigatório: enquanto false, só conferência humana aprova. */
export const VERIFICADOR_DE_INSCRICOES_VALIDADO = false

/**
 * O produto tem inscrições/componentes que a IA pode alterar? Na dúvida, SIM: só um "semInscricoes: true" declarado
 * na ficha tira o produto da regra.
 */
export function produtoTemInscricoes(p: { semInscricoes?: boolean }): boolean {
  return p.semInscricoes !== true
}

export function decidirFidelidade(p: {
  aprovadoPelaSimilaridade: boolean
  produtoTemInscricoes: boolean
  sha256: string
  conferencia?: ConferenciaDeInscricoes | null
}): { decisao: DecisaoDeFidelidade; motivo: string } {
  if (!p.aprovadoPelaSimilaridade) return { decisao: 'REPROVADO', motivo: 'Reprovado pela conferência de similaridade.' }
  if (!p.produtoTemInscricoes) return { decisao: 'APROVADO', motivo: 'Similaridade aprovada; produto declarado sem inscrições.' }
  const c = p.conferencia
  if (!c) return { decisao: 'BLOQUEADO_CONFERIR_INSCRICOES', motivo: 'Produto com inscrições: similaridade não aprova sozinha (caso ia-heroi). Conferir as inscrições na folha de quadros.' }
  if (c.por !== 'HUMANO' || !revisorIndependente(c.revisor)) return { decisao: 'BLOQUEADO_CONFERIR_INSCRICOES', motivo: `Conferência sem revisor humano independente (${c.revisor || 'sem nome'}): o produtor não aprova a própria criação.` }
  if (c.sha256 !== p.sha256) return { decisao: 'BLOQUEADO_CONFERIR_INSCRICOES', motivo: 'A conferência de inscrições é de outro arquivo (sha256 diferente).' }
  if (!c.aprovada || c.divergencias.length) return { decisao: 'REPROVADO', motivo: `Inscrições alteradas: ${c.divergencias.join('; ') || 'reprovada na conferência'}.` }
  return { decisao: 'APROVADO', motivo: `Inscrições conferidas por pessoa em ${c.em}.` }
}

/** Caso OBRIGATÓRIO de reprovação (P2.84): todo verificador e toda regra de aprovação têm de reprová-lo. */
export const CASO_OBRIGATORIO_IA_HEROI = {
  tomada: 'ia-heroi-runway-t1',
  sha256: '4463814f9c08a679b023dc62b8c7ad73adea29dd6e744833da3c7e14b63bd7fe',
  correlacaoGeometrica: 0.971,
  aprovadoPelaSimilaridade: true,
  divergencias: ['IOREF → ZOREF', 'RESET → MESSY', '3.3V → X.3V', '5V → SV', 'GND → CND', 'ANALOG IN → ANXL…'],
} as const

// ── Rastro de tomada de IA na produção (P2.84) ─────────────────────────────────────────────────────────────────
// Toda tomada gerada por IA que entra numa pasta de produção deixa `<papel>.ia.json` ao lado do arquivo. A auditoria
// do vídeo final procura esse rastro: com ele, "imagens geradas por IA" = sim e a conformidade fica PENDENTE (bloqueia).

export const ARQUIVO_DE_CONFERENCIA = 'conferencia-inscricoes.json'

export function lerConferencia(arquivo: string): ConferenciaDeInscricoes | null {
  try { return existsSync(arquivo) ? (JSON.parse(readFileSync(arquivo, 'utf8')) as ConferenciaDeInscricoes) : null } catch { return null }
}

/** Há tomada de IA nesta pasta, em `tomadas/` ou (até 2 níveis) abaixo? */
export function temTomadaDeIA(pasta: string, nivel = 0): boolean {
  if (!existsSync(pasta) || nivel > 2) return false
  for (const n of readdirSync(pasta)) {
    if (n.endsWith('.ia.json')) return true
    const f = join(pasta, n)
    try { if (statSync(f).isDirectory() && temTomadaDeIA(f, nivel + 1)) return true } catch { /* ignora */ }
  }
  return false
}
