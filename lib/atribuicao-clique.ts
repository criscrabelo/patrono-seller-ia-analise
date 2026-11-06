/**
 * Atribuição clique → venda (P0.2 — Bloco 2).
 *
 * ── O QUE ESTA REGRA FAZ ────────────────────────────────────────────────
 * Dado o conjunto de cliques conhecidos, decide QUAL clique originou uma
 * venda — ou decide, explicitamente, que não dá para saber.
 *
 * A decisão é DETERMINÍSTICA e AUTOMÁTICA: a proprietária não escolhe clique
 * a clique como rotina. Mas automática não é sinônimo de otimista — a regra
 * só atribui quando o resultado é tecnicamente inequívoco.
 *
 * ── A REGRA IMPLEMENTADA ────────────────────────────────────────────────
 *   Último clique elegível do MESMO LinkDinamico, no MESMO workspace,
 *   ocorrido ESTRITAMENTE ANTES do instante da venda.
 *
 * Condições de elegibilidade, todas obrigatórias:
 *   1. `clique.workspaceId === venda.workspaceId`  — nunca cruza negócios;
 *   2. `clique.linkId === venda.linkId`            — nunca cruza links
 *                                                    (e, por consequência,
 *                                                    nunca cruza produtos:
 *                                                    o link é de um produto);
 *   3. `clique.createdAt < venda.date`             — clique posterior à
 *                                                    venda não pode tê-la
 *                                                    causado.
 *
 * ── QUANDO NÃO ATRIBUI ──────────────────────────────────────────────────
 * `clickEventId` fica `null` e `attributionMethod` registra o motivo:
 *   - a venda não tem link          → SEM_LINK_NA_VENDA
 *   - nenhum clique elegível        → SEM_CLIQUE_ELEGIVEL
 *   - empate no instante mais recente, ou data inválida → AMBIGUO_NAO_ATRIBUIDO
 *
 * "Não atribuído" é um resultado auditável, não uma falha. A ausência de
 * atribuição confiável NUNCA é preenchida depois por inferência, correlação
 * ou palpite de ML.
 *
 * ── SOBRE JANELA DE ATRIBUIÇÃO ──────────────────────────────────────────
 * Esta regra NÃO aplica janela de tempo (ex.: "clique vale por 7 dias").
 * Isso é deliberado: janela de atribuição é regra COMERCIAL do provider, e
 * hoje o Patrono não tem a regra oficial de nenhum provider. Inventar uma
 * janela interna e apresentá-la como se fosse a do provider produziria
 * número que parece oficial e não é.
 *
 * Quando um provider publicar a regra dele, ela entra como um método NOVO
 * e nomeado (ex.: `JANELA_OFICIAL_<PROVIDER>_<N>D`), nunca substituindo esta
 * em silêncio — o `attributionMethod` gravado em cada venda continua dizendo
 * exatamente qual regra decidiu aquela linha.
 */

/** Métodos possíveis. O nome é gravado na venda e nunca é decorativo. */
export const METODOS_ATRIBUICAO = [
  /** Atribuído: último clique do mesmo link, mesmo workspace, antes da venda. */
  'ULTIMO_CLIQUE_MESMO_LINK_ANTES_DA_VENDA',
  /** Não atribuído: a venda não aponta para nenhum link. */
  'SEM_LINK_NA_VENDA',
  /** Não atribuído: existe link, mas nenhum clique passou nos critérios. */
  'SEM_CLIQUE_ELEGIVEL',
  /** Não atribuído: mais de um candidato igualmente válido, ou data ilegível. */
  'AMBIGUO_NAO_ATRIBUIDO',
] as const

export type MetodoAtribuicao = (typeof METODOS_ATRIBUICAO)[number]

export interface CliqueCandidato {
  id: string
  workspaceId: string
  linkId: string
  createdAt: Date
}

export interface ConsultaAtribuicao {
  workspaceId: string
  /** `null` quando a venda foi registrada sem link. */
  linkId: string | null
  /** Instante da venda. Cliques posteriores a ele são descartados. */
  dataDaVenda: Date
  /** Candidatos conhecidos. Podem vir de qualquer link/workspace: a função filtra. */
  cliques: CliqueCandidato[]
}

export interface ResultadoAtribuicao {
  /** `null` sempre que a atribuição não for inequívoca. */
  clickEventId: string | null
  metodo: MetodoAtribuicao
  /** Texto para auditoria e para a tela. Nunca contém dado de outro workspace. */
  explicacao: string
}

function dataValida(d: unknown): d is Date {
  return d instanceof Date && Number.isFinite(d.getTime())
}

/**
 * Função PURA: não toca banco, não olha relógio, não depende de ambiente.
 * É o que permite testar clique de outro workspace, clique de outro link,
 * clique posterior à venda e empate sem precisar de Postgres.
 */
export function atribuirClique(consulta: ConsultaAtribuicao): ResultadoAtribuicao {
  const naoAtribuido = (metodo: MetodoAtribuicao, explicacao: string): ResultadoAtribuicao => ({
    clickEventId: null,
    metodo,
    explicacao,
  })

  if (!consulta.linkId) {
    return naoAtribuido(
      'SEM_LINK_NA_VENDA',
      'A venda não aponta para nenhum link — não há o que atribuir. Isso não é erro: venda pode ser registrada sem link.'
    )
  }

  if (!dataValida(consulta.dataDaVenda)) {
    return naoAtribuido(
      'AMBIGUO_NAO_ATRIBUIDO',
      'A data da venda é inválida — sem instante confiável não há como dizer qual clique veio antes.'
    )
  }

  const elegiveis = consulta.cliques.filter(
    (c) =>
      c.workspaceId === consulta.workspaceId &&
      c.linkId === consulta.linkId &&
      dataValida(c.createdAt) &&
      c.createdAt.getTime() < consulta.dataDaVenda.getTime()
  )

  if (elegiveis.length === 0) {
    return naoAtribuido(
      'SEM_CLIQUE_ELEGIVEL',
      'Nenhum clique deste link, neste workspace, anterior à venda. A venda fica sem clique atribuído — nunca com um clique aproximado.'
    )
  }

  const maisRecente = elegiveis.reduce((a, b) => (b.createdAt.getTime() > a.createdAt.getTime() ? b : a))
  const empatados = elegiveis.filter((c) => c.createdAt.getTime() === maisRecente.createdAt.getTime())

  if (empatados.length > 1) {
    // Dois cliques no mesmo milissegundo: não há critério objetivo para
    // escolher. Escolher por id ou por ordem de leitura seria inventar
    // atribuição com aparência de regra.
    return naoAtribuido(
      'AMBIGUO_NAO_ATRIBUIDO',
      `Há ${empatados.length} cliques no mesmo instante mais recente — sem critério objetivo de desempate, a venda fica sem atribuição.`
    )
  }

  return {
    clickEventId: maisRecente.id,
    metodo: 'ULTIMO_CLIQUE_MESMO_LINK_ANTES_DA_VENDA',
    explicacao: `Atribuído ao último clique do mesmo link neste workspace antes da venda (${maisRecente.createdAt.toISOString()}). Sem janela de tempo: nenhum provider forneceu regra oficial de atribuição.`,
  }
}

/** `true` quando o método representa uma atribuição de fato feita. */
export function houveAtribuicao(metodo: MetodoAtribuicao): boolean {
  return metodo === 'ULTIMO_CLIQUE_MESMO_LINK_ANTES_DA_VENDA'
}
