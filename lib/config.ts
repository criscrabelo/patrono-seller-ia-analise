// Configurações da loja / vínculos externos
// Para trocar o perfil do Instagram, defina NEXT_PUBLIC_LINK_COMPRA no .env
// ou edite o valor padrão abaixo.

export const LINK_COMPRA =
  process.env.NEXT_PUBLIC_LINK_COMPRA || 'https://www.instagram.com/conta_exemplo'

export const NOME_LOJA = process.env.NEXT_PUBLIC_NOME_LOJA || 'Bora Comprar'

/**
 * Perfil inicial da loja (P2.14.5.12), definido pela titular em 08/10/2026.
 * Configuração, não banco: sem migration nesta fase.
 *
 * O motor de oportunidades usa este perfil para a ADERÊNCIA — sempre contra
 * dados reais do produto (categoria, preço, textos do cadastro, quem
 * informou). O que o perfil pede mas o produto não informa (ex.: facilidade
 * de demonstrar) fica DESCONHECIDO; nunca é presumido.
 *
 * P2.14.5.12.1: aderência = perfil (0–80) + afinidade da titular (0–20),
 * com participação fixa de 13% no score (lib/opportunity-score-composite.ts).
 * Afinidade é bônus de aderência — nunca prova de demanda.
 */
export const PERFIL_DA_LOJA = {
  posicionamento:
    'Achados para uma mulher que trabalha muito, gosta de se vestir bem e valoriza conforto, praticidade, elegância e qualidade.',
  publico:
    'Mulheres adultas que conciliam trabalho, casa, estudos, família, autocuidado e estilo profissional, em busca de praticidade',
  /** Como a titular descreveu as prioridades. */
  categoriasPrioritarias: [
    'organização e casa',
    'escritório e produtividade',
    'tecnologia útil',
    'moda feminina',
    'calçados',
    'bolsas',
    'cintos',
    'acessórios',
    'beleza',
    'maquiagem',
    'perfumes',
    'cabelos',
    'livros e estudos',
    'maternidade e itens infantis úteis',
  ],
  /**
   * Palavras (no nome/descrição) que revelam uma prioridade mesmo quando a
   * categoria do cadastro é "Outros" ou outra. Busca por palavra inteira,
   * sem acento e sem diferenciar maiúsculas; aceita plural simples.
   */
  subcategoriasPrioritarias: {
    'organização e casa': ['organizador', 'organizadora', 'cabide', 'caixa organizadora', 'porta temperos'],
    'escritório e produtividade': ['agenda', 'planner', 'suporte para notebook', 'luminária de mesa', 'mouse', 'teclado'],
    'tecnologia útil': ['fone de ouvido', 'carregador', 'power bank', 'smartwatch', 'suporte para celular'],
    'moda feminina': ['vestido', 'blusa', 'saia', 'blazer', 'camisa feminina', 'calça feminina', 'alfaiataria'],
    calçados: ['sapato', 'scarpin', 'salto', 'tênis', 'sandália', 'sapatilha', 'mocassim', 'bota'],
    bolsas: ['bolsa', 'carteira feminina'],
    cintos: ['cinto'],
    acessórios: ['brinco', 'colar', 'pulseira', 'relógio', 'óculos de sol', 'lenço'],
    maquiagem: ['maquiagem', 'batom', 'base líquida', 'rímel', 'máscara de cílios', 'paleta de sombras', 'pó compacto', 'corretivo', 'blush', 'primer'],
    perfumes: ['perfume', 'eau de parfum', 'eau de toilette', 'colônia', 'body splash'],
    cabelos: ['shampoo', 'condicionador', 'máscara capilar', 'leave-in', 'protetor térmico', 'finalizador', 'óleo capilar', 'sérum capilar', 'tratamento capilar'],
    'livros e estudos': ['livro', 'apostila', 'caderno', 'marca-texto', 'fichário'],
    'maternidade e itens infantis úteis': ['bebê', 'maternidade', 'mamadeira', 'trocador', 'infantil'],
  } as Record<string, readonly string[]>,
  /**
   * Tradução para as categorias do cadastro (`CATEGORIAS`, types/index.ts).
   * O cadastro não tem "Livros" nem "Maternidade": livros/estudos foi ligado
   * a Papelaria e itens infantis a Brinquedos — aproximação explícita, a
   * revisar quando o cadastro ganhar categorias próprias. "Outros" não conta
   * como prioritária nem como fora do perfil: é desconhecida.
   */
  categoriasDoCadastro: ['Casa e Decoração', 'Papelaria', 'Eletrônicos', 'Moda', 'Beleza', 'Brinquedos'],
  /**
   * Referência, não trava: dentro da faixa = nota cheia; abaixo do mínimo ou
   * até `premiumAte` = neutra (50); acima disso = baixa (20). Produto premium
   * concorre pela evidência (demanda, comissão, histórico).
   */
  faixaDePreco: { minimo: 30, maximo: 300, premiumAte: 600 },
  priorizarFacilDeDemonstrar: true,
  priorizarSemPresencaDaTitular: true,

  /**
   * Afinidade pessoal da titular — bônus DENTRO da aderência, teto 20.
   * Só se aplica quando o perfil dá pelo menos `perfilMinimoParaBonus`/80;
   * com perfil desconhecido não cria nota (aparece só na explicação e no
   * desempate). Marca famosa que não está na lista não conta. Lista
   * extensível: basta acrescentar uma entrada.
   */
  afinidadeDaTitular: {
    marcasPreferidas: [
      { nome: 'O Boticário', termos: ['boticario'] },
      { nome: 'Renner', termos: ['renner'] },
      { nome: 'Adidas', termos: ['adidas'] },
      { nome: 'Usaflex', termos: ['usaflex'] },
      // "MAC" só em maiúsculas e fora de Eletrônicos (não confundir com MacBook).
      { nome: 'MAC', termos: ['MAC', 'M·A·C', 'M.A.C'], diferenciaMaiusculas: true, excetoCategorias: ['Eletrônicos'] },
      { nome: 'Kérastase', termos: ['kerastase'] },
      { nome: 'Wella', termos: ['wella'] },
    ] as ReadonlyArray<{
      nome: string
      termos: readonly string[]
      diferenciaMaiusculas?: boolean
      excetoCategorias?: readonly string[]
    }>,
    /** Estilo da titular: profissional/elegante, "estilo advogada". */
    estilo: ['salto alto', 'scarpin', 'salto', 'bolsa', 'cinto', 'blazer', 'alfaiataria', 'executiva', 'executivo', 'mocassim'],
    /**
     * Fase 1, temporário: `#usei` no campo Observações = produto usado pela
     * titular. Na Fase 2 vira campo próprio (migration).
     */
    marcadorDeUso: '#usei',
    bonus: { marcaPreferida: 10, estilo: 5, comprado: 5, usado: 10 },
    /** Comprado e usado NÃO acumulam: usado (+10) substitui comprado (+5). */
    teto: 20,
    perfilMinimoParaBonus: 40,
  },
} as const

// Quantas vezes a IA tenta refazer o conteúdo para eliminar alertas de compliance.
// Mantido em 2 para evitar timeout (cada chamada leva ~20-30s; limite Vercel = 60s).
export const MAX_TENTATIVAS_COMPLIANCE = 2
