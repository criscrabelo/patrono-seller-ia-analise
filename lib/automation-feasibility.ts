/**
 * AutomationFeasibilityScore (Rodada 5).
 *
 * O Patrono não deve só responder "qual produto vende mais?" — deve
 * responder "qual o melhor produto que eu consigo vender AUTOMATICAMENTE,
 * com segurança e dentro das regras?".
 *
 * Por isso o score final combina duas partes:
 * - `potencial`: o quanto o produto tende a vender (ranking, tendência,
 *   comissão) — o que o OpportunityScorer antigo já fazia.
 * - `automatizabilidade`: o quanto conseguimos operar isso SEM a usuária
 *   precisar agir (link automático, mídia autorizada, conteúdo gerável,
 *   publicação automática, sem exigir consentimento extra, sem restrição
 *   de plataforma, regras confiáveis, custo baixo).
 *
 * Entre dois produtos parecidos, um com potencial um pouco maior mas que
 * exige 5 ações manuais, e outro com potencial ligeiramente menor mas
 * 100% automático — o Patrono pode preferir o segundo. Objetivo: a
 * proprietária não vira operadora da plataforma.
 */

import type { AffiliateOpportunity, OpportunityScorer } from './affiliate-discovery'

export interface FeasibilityBreakdown {
  potencial: number | null // 0-100; null = nenhum sinal de mercado conhecido
  automatizabilidade: number // 0-100
  final: number // 0-100, combinação ponderada
  motivos: string[]
}

/**
 * Nota de automatizabilidade (0-100). Cada capacidade ausente ou incerta
 * reduz a nota — nunca assume "sim" para um campo `undefined`.
 */
export function notaAutomatizabilidade(op: AffiliateOpportunity): { nota: number; motivos: string[] } {
  const motivos: string[] = []
  let nota = 0
  const PESO_CADA = 100 / 6 // 6 capacidades binárias avaliadas abaixo

  if (op.canGenerateLinkAutomatically) {
    nota += PESO_CADA
  } else {
    motivos.push('link de afiliada não é gerado automaticamente')
  }

  if (op.authorizedMediaAvailable) {
    nota += PESO_CADA
  } else {
    motivos.push('sem mídia autorizada disponível')
  }

  if (op.canGenerateContent) {
    nota += PESO_CADA
  } else {
    motivos.push('não é possível gerar conteúdo para este produto ainda')
  }

  if (op.canAutoPublish) {
    nota += PESO_CADA
  } else {
    motivos.push('publicação não pode ser automática')
  }

  if (op.requiresUserConsent === false) {
    nota += PESO_CADA
  } else if (op.requiresUserConsent === true) {
    motivos.push('exige consentimento explícito da usuária em algum passo')
  }
  // requiresUserConsent === undefined: não soma nem penaliza (desconhecido, não confirmado como problema)

  const semRestricoes = !op.platformRestrictions || op.platformRestrictions.length === 0
  if (semRestricoes) {
    nota += PESO_CADA
  } else {
    motivos.push(`restrições de plataforma: ${op.platformRestrictions!.join(', ')}`)
  }

  // Confiança das regras e custo da automação MULTIPLICAM a nota — uma
  // capacidade "automática" baseada em regra NOT_VERIFIED/LOW não deveria
  // valer o mesmo que uma HIGH confidence.
  const multiplicadorConfianca: Record<NonNullable<AffiliateOpportunity['rulesConfidence']>, number> = {
    HIGH: 1,
    MEDIUM: 0.85,
    LOW: 0.6,
    UNKNOWN: 0.4,
  }
  const confMult = op.rulesConfidence ? multiplicadorConfianca[op.rulesConfidence] : 0.4
  if (confMult < 1) motivos.push(`confiança das regras: ${op.rulesConfidence ?? 'UNKNOWN'}`)

  const multiplicadorCusto: Record<NonNullable<AffiliateOpportunity['automationCost']>, number> = {
    FREE: 1,
    LOW: 0.9,
    MEDIUM: 0.7,
    HIGH: 0.4,
  }
  const custoMult = op.automationCost ? multiplicadorCusto[op.automationCost] : 1 // custo desconhecido não penaliza sozinho
  if (custoMult < 1) motivos.push(`custo de automação: ${op.automationCost}`)

  nota = Math.round(nota * confMult * custoMult)
  return { nota: Math.max(0, Math.min(100, nota)), motivos }
}

/** Avaliações mínimas para a nota média da fonte entrar no potencial. */
export const AVALIACOES_MINIMAS_PARA_NOTA = 10

/**
 * Nota de potencial de venda (0-100) — ranking/tendência/comissão/avaliações,
 * sem inventar dado ausente.
 *
 * P2.14.5.12: sem NENHUM sinal de mercado a nota é `null` (desconhecida),
 * nunca 0. Antes, o catálogo interno — que não tem ranking, tendência nem
 * avaliação — recebia 0 e esse zero pesava no score final como se fosse um
 * produto ruim. Quem combina notas redistribui o peso de um `null`.
 */
export function notaPotencial(op: AffiliateOpportunity): { nota: number | null; motivos: string[] } {
  const motivos: string[] = []
  let nota = 0
  let pesosSomados = 0

  if (typeof op.salesVolumeRank === 'number' && op.salesVolumeRank > 0) {
    // rank 1 = melhor. Normaliza numa escala decrescente simples.
    const notaRank = Math.max(0, 100 - Math.log10(op.salesVolumeRank + 1) * 25)
    nota += notaRank * 0.4
    pesosSomados += 0.4
  } else {
    motivos.push('sem Sales Rank oficial disponível')
  }

  if (op.trending === true) {
    nota += 100 * 0.2
    pesosSomados += 0.2
  } else if (op.trending === false) {
    pesosSomados += 0.2
  } else {
    motivos.push('tendência não confirmada')
  }

  if (typeof op.estimatedCommissionBRL === 'number') {
    const notaComissao = Math.min(100, (op.estimatedCommissionBRL / 50) * 100) // R$50 já pontua no teto, ajustável
    nota += notaComissao * 0.4
    pesosSomados += 0.4
  } else if (typeof op.commissionPercent === 'number') {
    nota += Math.min(100, op.commissionPercent * 3) * 0.4
    pesosSomados += 0.4
  } else {
    motivos.push('sem dado de comissão')
  }

  // Avaliações: só com volume mínimo — uma nota 5 com 2 avaliações não diz nada.
  if (
    typeof op.avaliacao === 'number' &&
    typeof op.numeroDeAvaliacoes === 'number' &&
    op.numeroDeAvaliacoes >= AVALIACOES_MINIMAS_PARA_NOTA
  ) {
    nota += Math.max(0, Math.min(100, (op.avaliacao / 5) * 100)) * 0.2
    pesosSomados += 0.2
  } else if (typeof op.avaliacao === 'number') {
    motivos.push(`avaliações insuficientes (mínimo ${AVALIACOES_MINIMAS_PARA_NOTA})`)
  } else {
    motivos.push('sem avaliações informadas pela fonte')
  }

  // Reponderar pelo que de fato foi avaliado, para não punir dobrado a
  // ausência de dado (já registrada em `motivos`). Nada avaliado = null.
  if (pesosSomados === 0) return { nota: null, motivos }
  const notaFinal = nota / pesosSomados
  return { nota: Math.round(Math.max(0, Math.min(100, notaFinal))), motivos }
}

/**
 * Peso do potencial vs. automatizabilidade no score final. 55/45: o
 * potencial ainda pesa um pouco mais (é uma venda de verdade), mas a
 * automatizabilidade tem peso suficiente para uma opção 100% automática
 * ultrapassar uma opção de potencial um pouco maior mas manual — como
 * pede a regra de seleção da Rodada 5.
 */
const PESO_POTENCIAL = 0.55
const PESO_AUTOMATIZABILIDADE = 0.45

export function calcularFeasibility(op: AffiliateOpportunity): FeasibilityBreakdown {
  const potencial = notaPotencial(op)
  const automatizabilidade = notaAutomatizabilidade(op)

  // Potencial desconhecido: o peso vai inteiro para a automatizabilidade,
  // em vez de entrar como zero.
  const final =
    potencial.nota === null
      ? automatizabilidade.nota
      : Math.round(potencial.nota * PESO_POTENCIAL + automatizabilidade.nota * PESO_AUTOMATIZABILIDADE)

  return {
    potencial: potencial.nota,
    automatizabilidade: automatizabilidade.nota,
    final,
    motivos: [...potencial.motivos, ...automatizabilidade.motivos],
  }
}

/**
 * OpportunityScorer real (não só interface) — implementa o contrato de
 * lib/affiliate-discovery.ts usando o AutomationFeasibilityScore.
 */
export class AutomationFeasibilityScorer implements OpportunityScorer {
  score(candidate: AffiliateOpportunity): number {
    return calcularFeasibility(candidate).final
  }

  rank(candidates: AffiliateOpportunity[]): AffiliateOpportunity[] {
    return [...candidates].sort((a, b) => this.score(b) - this.score(a))
  }
}
