/**
 * Classificação de CTA (Rodada 9, complemento ML, regra 15) — RULE_BASED
 * (regra 1). Nunca produz um CTA enganoso: isso é responsabilidade de
 * quem GERA o texto (Presenter Mode, `lib/digital-twin.ts`); este módulo
 * só CLASSIFICA um CTA já existente para fins de aprendizado de
 * performance.
 *
 * P2.21: limites de palavra com acento ("preço") e os CTAs que o Patrono usa
 * (produto marcado; salvar e conferir). Classificador ÚNICO de CTA.
 */

import type { MLDecisionType } from './ml-types'

export const CTA_TYPES = ['SALVAR_E_CONFERIR', 'PRODUTO_MARCADO', 'CONFIRA_LINK', 'VEJA_PRECO', 'SAIBA_MAIS', 'VEJA_DETALHES', 'OUTRO', 'NAO_CLASSIFICADO'] as const
export type CtaType = (typeof CTA_TYPES)[number]
/** Tipo canônico do aprendizado: sem CTA reconhecido = UNKNOWN (não se compara o que não se sabe). */
export type TipoDeCta = Exclude<CtaType, 'OUTRO' | 'NAO_CLASSIFICADO'> | 'UNKNOWN'

const termo = (fonte: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${fonte})(?![\\p{L}\\p{N}])`, 'iu')

interface RegraCta {
  tipo: CtaType
  padroes: RegExp[]
}

// Ordem importa: "Salva este vídeo e confere o produto marcado" é SALVAR (a ação pedida primeiro).
const REGRAS_CTA: RegraCta[] = [
  { tipo: 'SALVAR_E_CONFERIR', padroes: [termo('salva|salve|salvar')] },
  { tipo: 'PRODUTO_MARCADO', padroes: [termo('produto marcado|toque no produto|carrinho laranja|cesta laranja')] },
  { tipo: 'VEJA_PRECO', padroes: [termo('pre[cç]o( atual| de hoje)?'), termo('veja o pre[cç]o')] },
  { tipo: 'CONFIRA_LINK', padroes: [termo('confira no link'), termo('link na bio'), termo('confira o link'), termo('link está na bio')] },
  { tipo: 'VEJA_DETALHES', padroes: [termo('veja os detalhes'), termo('mais detalhes')] },
  { tipo: 'SAIBA_MAIS', padroes: [termo('saiba mais')] },
]

export function classificarCta(texto: string | null | undefined): { tipo: CtaType; decisionType: MLDecisionType } {
  if (!texto || !texto.trim()) return { tipo: 'NAO_CLASSIFICADO', decisionType: 'RULE_BASED' }
  for (const regra of REGRAS_CTA) {
    if (regra.padroes.some((p) => p.test(texto))) {
      return { tipo: regra.tipo, decisionType: 'RULE_BASED' }
    }
  }
  return { tipo: 'OUTRO', decisionType: 'RULE_BASED' }
}

/** Para o aprendizado: OUTRO/NAO_CLASSIFICADO viram UNKNOWN. */
export function tipoDeCta(texto: string | null | undefined): TipoDeCta {
  const t = classificarCta(texto).tipo
  return t === 'OUTRO' || t === 'NAO_CLASSIFICADO' ? 'UNKNOWN' : t
}
