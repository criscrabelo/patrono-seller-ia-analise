/**
 * Classificação de hook — RULE_BASED (palavras-chave, nenhum parâmetro aprendido). Classificador ÚNICO
 * do projeto (Rodada 9; consolidado na P2.21). A camada estatística fica em `ml-feature-store.ts` e no
 * aprendizado criativo (`aprendizado-criativo.ts`).
 *
 * P2.21:
 *   - limites de palavra que funcionam com acento (o `\b` do JavaScript não enxerga "preço", "última");
 *   - padrões que cobrem os ganchos que o próprio Patrono gera (motor-de-videos-tiktok `ganchoDe`);
 *   - `classificarGancho` devolve tipo, confiança, método e candidatos; sem segurança → UNKNOWN (nunca palpite):
 *       · nenhum padrão casou → UNKNOWN;
 *       · dois tipos PRINCIPAIS casaram → UNKNOWN (ambíguo; os candidatos ficam registrados);
 *       · um principal + modificadores (urgência, preço, sazonal) → o principal, confiança MEDIA;
 *       · um tipo só → ALTA.
 */

import type { MLDecisionType } from './ml-types'

export const HOOK_TYPES = [
  'CURIOSIDADE',
  'PROBLEMA_SOLUCAO',
  'PRECO',
  'BENEFICIO',
  'COMPARACAO',
  'URGENCIA',
  'DESCOBERTA',
  'LISTA',
  'DEMONSTRACAO',
  'PRESENTE',
  'POV',
  'PROVA_REAL',
  'SURPRESA',
  'SAZONAL',
  'NAO_CLASSIFICADO',
] as const
export type HookType = (typeof HOOK_TYPES)[number]
/** Tipo canônico do aprendizado: o que não dá para classificar com segurança é UNKNOWN. */
export type TipoDeGancho = Exclude<HookType, 'NAO_CLASSIFICADO'> | 'UNKNOWN'
export const METODO_DO_CLASSIFICADOR = 'REGRAS_PT_BR@2'

/** Palavra/expressão inteira, com acento (Unicode): não casa dentro de outra palavra. */
const termo = (fonte: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${fonte})(?![\\p{L}\\p{N}])`, 'iu')

interface RegraHook {
  tipo: Exclude<HookType, 'NAO_CLASSIFICADO'>
  /** Modificador: acompanha um tipo principal sem disputar com ele. */
  modificador?: boolean
  padroes: RegExp[]
}

const REGRAS_HOOK: RegraHook[] = [
  { tipo: 'URGENCIA', modificador: true, padroes: [termo('últim[oa]s?|corre|acaba(ndo)?|s[oó] hoje|enquanto durar|antes que acabe')] },
  { tipo: 'PRECO', modificador: true, padroes: [termo('por apenas|de\\s*r\\$|desconto|preço|barato|promoção|cupom')] },
  { tipo: 'SAZONAL', modificador: true, padroes: [termo('natal|black friday|dia das m[ãa]es|dia dos pais|volta às aulas')] },
  { tipo: 'COMPARACAO', padroes: [termo('melhor que|comparado|versus|vs\\.?|diferença entre|ou o comum|a diferença')] },
  { tipo: 'PROBLEMA_SOLUCAO', padroes: [termo('cansad[oa] de|resolve|nunca mais|acabou com|pare de|esse problema|coisa chata')] },
  { tipo: 'LISTA', padroes: [termo('\\d+\\s*(motivos|raz[oõ]es|dicas|jeitos|formas|coisas)')] },
  { tipo: 'DEMONSTRACAO', padroes: [termo('veja como|te mostro|mostro como|como funciona|em ação|assista|mostrando|na prática|abre comigo|só as mãos')] },
  { tipo: 'PROVA_REAL', padroes: [termo('testei|minha opinião|depois de usar|antes e depois')] },
  { tipo: 'DESCOBERTA', padroes: [termo('achei|descobri|encontrei|ningu[eé]m fala|segredo')] },
  { tipo: 'PRESENTE', padroes: [termo('ideia de presente|presente perfeito|para presentear|de presente')] },
  { tipo: 'POV', padroes: [/^\s*pov\s*:/iu] },
  { tipo: 'SURPRESA', padroes: [termo('n[ãa]o esperava|me surpreendeu|fiquei chocad[oa]')] },
  { tipo: 'BENEFICIO', padroes: [termo('voc[eê] vai|ajuda a|benef[ií]cio|resultado')] },
  { tipo: 'CURIOSIDADE', padroes: [termo('voc[eê] sabia|imagina|e se eu|adivinha|pouca gente sabe')] },
]

export interface ClassificacaoDoGancho {
  tipo: TipoDeGancho
  confianca: 'ALTA' | 'MEDIA' | 'BAIXA'
  metodo: typeof METODO_DO_CLASSIFICADOR
  /** Tipos que casaram (para auditoria; útil quando ficou UNKNOWN por ambiguidade). */
  candidatos: Exclude<HookType, 'NAO_CLASSIFICADO'>[]
  motivo: string
}

/** Classificação canônica (P2.21). Nunca inventa: sem segurança, UNKNOWN. */
export function classificarGancho(texto: string | null | undefined): ClassificacaoDoGancho {
  const base = { metodo: METODO_DO_CLASSIFICADOR } as const
  if (!texto || texto.trim().length < 3) return { ...base, tipo: 'UNKNOWN', confianca: 'BAIXA', candidatos: [], motivo: 'Gancho vazio.' }
  const casaram = REGRAS_HOOK.filter((r) => r.padroes.some((p) => p.test(texto)))
  const principais = casaram.filter((r) => !r.modificador)
  const candidatos = casaram.map((r) => r.tipo)
  if (!casaram.length) return { ...base, tipo: 'UNKNOWN', confianca: 'BAIXA', candidatos, motivo: 'Nenhum padrão conhecido.' }
  if (principais.length > 1) return { ...base, tipo: 'UNKNOWN', confianca: 'BAIXA', candidatos, motivo: `Ambíguo: ${candidatos.join(' + ')}.` }
  if (principais.length === 1) {
    const extra = casaram.length > 1
    return { ...base, tipo: principais[0].tipo, confianca: extra ? 'MEDIA' : 'ALTA', candidatos, motivo: extra ? `${principais[0].tipo} (com ${casaram.filter((r) => r.modificador).map((r) => r.tipo).join(', ')}).` : `${principais[0].tipo}.` }
  }
  // Só modificadores.
  if (casaram.length === 1) return { ...base, tipo: casaram[0].tipo, confianca: 'ALTA', candidatos, motivo: `${casaram[0].tipo}.` }
  return { ...base, tipo: 'UNKNOWN', confianca: 'BAIXA', candidatos, motivo: `Ambíguo: ${candidatos.join(' + ')}.` }
}

/** Contrato antigo (feature store, geração de publicação): o mesmo classificador; UNKNOWN = NAO_CLASSIFICADO. */
export function classificarHook(texto: string | null | undefined): { tipo: HookType; decisionType: MLDecisionType } {
  const c = classificarGancho(texto)
  return { tipo: c.tipo === 'UNKNOWN' ? 'NAO_CLASSIFICADO' : c.tipo, decisionType: 'RULE_BASED' }
}
