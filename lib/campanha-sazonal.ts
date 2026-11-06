/**
 * P2.17.2 — Campanha sazonal: Natal 2026. FUNÇÃO PURA, determinística, sem IA.
 *
 * Regra da titular (11/10/2026):
 *   evidência real de venda > aderência à campanha de Natal > aderência ao
 *   público BoraComprar > comissão > facilidade de criação de conteúdo.
 *
 * A campanha é BÔNUS DE RANKING, nunca substitui evidência:
 *  - não mexe no score (a nota continua uma só, a do motor);
 *  - entra na ordenação logo DEPOIS da faixa de evidência
 *    (lib/motor-de-oportunidades.ts → criterioDeDesempate): só reordena
 *    produtos com evidência equivalente; um produto de evidência menor nunca
 *    passa à frente de um de evidência maior por causa do Natal.
 * Preço NÃO exclui nem penaliza: só vira etiqueta (LEMBRANCINHA / PREMIUM).
 * Fora da janela da campanha, nada disto vale (aderência null, sem etiquetas).
 */

export const TAGS_DA_CAMPANHA = [
  'NATAL',
  'PRESENTE',
  'DECORACAO_NATALINA',
  'PRESENTE_INFANTIL',
  'PRESENTE_MULHER',
  'PRESENTE_CASA',
  'LEMBRANCINHA',
  'PREMIUM',
] as const
export type TagDaCampanha = (typeof TAGS_DA_CAMPANHA)[number]

export interface CampanhaSazonal {
  id: string
  nome: string
  /** Início e fim (exclusivo), em UTC. */
  inicio: Date
  fim: Date
  /** Categorias do cadastro que a campanha prioriza. */
  categorias: readonly string[]
}

/** Natal 2026: de 01/10 até o fim do dia 25/12 (horário de Brasília). */
export const NATAL_2026: CampanhaSazonal = {
  id: 'NATAL_2026',
  nome: 'Natal 2026',
  inicio: new Date('2026-10-01T03:00:00Z'),
  fim: new Date('2026-12-26T03:00:00Z'),
  // Casa e decoração (inclui cozinha e organização), brinquedos e infantil,
  // beleza, moda e acessórios, tecnologia útil.
  categorias: ['Casa e Decoração', 'Brinquedos', 'Beleza', 'Moda', 'Eletrônicos'],
}

export const CAMPANHAS: readonly CampanhaSazonal[] = [NATAL_2026]

export function campanhaAtiva(agora: Date, campanhas: readonly CampanhaSazonal[] = CAMPANHAS): CampanhaSazonal | null {
  return campanhas.find((c) => agora.getTime() >= c.inicio.getTime() && agora.getTime() < c.fim.getTime()) ?? null
}

/** Faixas de preço que viram etiqueta (nunca filtro). */
export const PRECO_LEMBRANCINHA = 30
export const PRECO_PREMIUM = 200

function semAcento(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

const PALAVRAS: Record<Exclude<TagDaCampanha, 'NATAL' | 'PREMIUM'> | 'TECNOLOGIA_UTIL' | 'FAMILIA', RegExp> = {
  DECORACAO_NATALINA: /\b(natal|natalin[ao]s?|arvore de natal|pisca[- ]?pisca|enfeites?|guirlandas?|papai noel|presepios?|bolas? de natal|festao|noel|rena)\b/,
  PRESENTE: /\b(presentes?|kits?|conjuntos?|caixa presente|estojos?|combos?|cesta|gift)\b/,
  PRESENTE_INFANTIL: /\b(infantil|criancas?|bebes?|brinquedos?|bonecas?|carrinhos?|pelucias?|lego|blocos de montar|quebra[- ]cabeca)\b/,
  PRESENTE_MULHER: /\b(feminin[ao]s?|mulher|maquiagem|perfumes?|bolsas?|bijuterias?|colar|brincos?|pulseiras?|skin ?care|batom|esmaltes?)\b/,
  PRESENTE_CASA: /\b(cozinha|organizador(es|a)?|organizacao|potes?|jogo de cama|toalhas?|luminarias?|aromatizador|difusor|canecas?|tacas?|panelas?|decoracao)\b/,
  LEMBRANCINHA: /\b(lembrancinhas?|mimos?|chaveiros?|amigo secreto|amigo oculto)\b/,
  TECNOLOGIA_UTIL: /\b(fones?|carregador(es)?|smartwatch|relogio inteligente|caixa de som|power ?bank|suporte (de|para) celular|luz led|ring light)\b/,
  FAMILIA: /\b(familia|jogos? de tabuleiro|kit familia|pais e filhos)\b/,
}

export interface AvaliacaoDaCampanha {
  campanha: string
  nome: string
  /** 0–100: quanto o produto combina com a campanha (com o que se sabe). */
  aderencia: number
  tags: TagDaCampanha[]
  motivos: string[]
}

/**
 * FUNÇÃO PURA. Aderência à campanha ativa + etiquetas. `null` = nenhuma
 * campanha ativa. Só usa dado real (categoria, nome, descrição, preço); o
 * que não se sabe não soma ponto.
 */
export function avaliarCampanha(
  p: { categoria: string | null; nome: string; descricao?: string | null; preco: number | null },
  agora: Date,
  campanhas: readonly CampanhaSazonal[] = CAMPANHAS
): AvaliacaoDaCampanha | null {
  const c = campanhaAtiva(agora, campanhas)
  if (!c) return null
  const texto = semAcento(`${p.nome} ${p.descricao ?? ''}`)
  const tem = (k: keyof typeof PALAVRAS) => PALAVRAS[k].test(texto)
  const categoriaDaCampanha = !!p.categoria && c.categorias.includes(p.categoria)

  const tags = new Set<TagDaCampanha>()
  const motivos: string[] = []
  let pontos = 0
  if (categoriaDaCampanha) {
    pontos += 40
    motivos.push(`categoria "${p.categoria}" é prioridade do ${c.nome}`)
  }
  if (tem('DECORACAO_NATALINA')) {
    pontos += 40
    tags.add('DECORACAO_NATALINA')
    motivos.push('produto natalino')
  }
  if (tem('PRESENTE') || tem('LEMBRANCINHA')) {
    pontos += 20
    tags.add('PRESENTE')
    motivos.push('formato de presente (kit, conjunto, caixa…)')
  }
  const especificos: [keyof typeof PALAVRAS, TagDaCampanha | null, string, boolean][] = [
    ['PRESENTE_INFANTIL', 'PRESENTE_INFANTIL', 'presente infantil', p.categoria === 'Brinquedos'],
    ['PRESENTE_MULHER', 'PRESENTE_MULHER', 'presente para mulher', p.categoria === 'Beleza'],
    ['PRESENTE_CASA', 'PRESENTE_CASA', 'presente para casa', p.categoria === 'Casa e Decoração'],
    ['TECNOLOGIA_UTIL', null, 'tecnologia útil', false],
    ['FAMILIA', null, 'presente para a família', false],
  ]
  let bonusEspecifico = 0
  for (const [chave, tag, rotulo, porCategoria] of especificos) {
    if (tem(chave) || porCategoria) {
      if (tag) tags.add(tag)
      bonusEspecifico += 10
      motivos.push(rotulo)
    }
  }
  pontos += Math.min(bonusEspecifico, 20)

  // Preço: só etiqueta, nunca ponto a menos e nunca exclusão.
  if ((p.preco !== null && p.preco > 0 && p.preco <= PRECO_LEMBRANCINHA) || tem('LEMBRANCINHA')) tags.add('LEMBRANCINHA')
  if (p.preco !== null && p.preco >= PRECO_PREMIUM) tags.add('PREMIUM')

  const aderencia = Math.min(100, pontos)
  if (aderencia > 0) tags.add('NATAL')
  if (tags.has('PRESENTE_INFANTIL') || tags.has('PRESENTE_MULHER') || tags.has('PRESENTE_CASA')) tags.add('PRESENTE')

  const ordem = (t: TagDaCampanha) => TAGS_DA_CAMPANHA.indexOf(t)
  return { campanha: c.id, nome: c.nome, aderencia, tags: [...tags].sort((a, b) => ordem(a) - ordem(b)), motivos }
}
