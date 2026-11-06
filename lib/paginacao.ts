/**
 * Percurso de páginas de uma API externa (Rodada 13).
 *
 * Existe por causa de uma regra do reconciliador: só é seguro INATIVAR o que
 * "sumiu" da vitrine se TODAS as páginas foram lidas. Se a paginação parar no
 * meio — rede caiu, rate limit, token expirado —, o que falta parece removido
 * e o Patrono inativaria a vitrine inteira por causa de um erro de rede.
 *
 * Por isso este módulo NUNCA lança quando uma página falha: ele devolve o que
 * conseguiu mais `paginacaoCompleta: false` e o motivo. Quem chama decide — e
 * `reconciliarCatalogo()` já sabe não inativar nada nesse caso. Um `throw`
 * aqui perderia os itens já lidos e, pior, um `catch` distraído lá em cima
 * poderia tratar "leu metade" como "leu tudo".
 *
 * Módulo PURO: não conhece TikTok, HTTP nem relógio. A função de busca entra
 * por parâmetro, então falha no meio, cursor repetido e vitrine gigante são
 * testáveis sem rede.
 */

export interface PaginaDeResultado<T> {
  itens: T[]
  /** `null` quando acabou. Qualquer outro valor pede a próxima página. */
  proximoCursor: string | null
}

export interface OpcoesPaginacao {
  /**
   * Teto de páginas. Protege contra API que devolve cursor para sempre —
   * sem isso, um bug do outro lado viraria laço infinito no nosso worker.
   */
  maxPaginas: number
}

export type MotivoIncompleta =
  | 'FALHA_AO_BUSCAR'
  | 'LIMITE_DE_PAGINAS'
  | 'CURSOR_REPETIDO'

export interface ResultadoPaginacao<T> {
  itens: T[]
  /** Só `true` quando a API disse "acabou". Nunca por suposição. */
  paginacaoCompleta: boolean
  paginasLidas: number
  motivo: MotivoIncompleta | null
  /** Texto pronto para log/auditoria. */
  detalhe: string | null
}

export async function percorrerPaginas<T>(
  buscar: (cursor: string | null) => Promise<PaginaDeResultado<T>>,
  opcoes: OpcoesPaginacao
): Promise<ResultadoPaginacao<T>> {
  const itens: T[] = []
  const cursoresVistos = new Set<string>()
  let cursor: string | null = null
  let paginasLidas = 0

  while (paginasLidas < opcoes.maxPaginas) {
    let pagina: PaginaDeResultado<T>
    try {
      pagina = await buscar(cursor)
    } catch (e) {
      return {
        itens,
        paginacaoCompleta: false,
        paginasLidas,
        motivo: 'FALHA_AO_BUSCAR',
        detalhe: `Falha ao ler a página ${paginasLidas + 1}: ${e instanceof Error ? e.message : String(e)}. Nada será inativado nesta rodada.`,
      }
    }

    itens.push(...pagina.itens)
    paginasLidas++

    if (pagina.proximoCursor === null) {
      return { itens, paginacaoCompleta: true, paginasLidas, motivo: null, detalhe: null }
    }

    // Cursor que se repete = a API está girando em falso. Continuar
    // duplicaria itens e nunca terminaria.
    if (cursoresVistos.has(pagina.proximoCursor)) {
      return {
        itens,
        paginacaoCompleta: false,
        paginasLidas,
        motivo: 'CURSOR_REPETIDO',
        detalhe: `A API devolveu um cursor repetido na página ${paginasLidas}. Interrompido para não entrar em laço; nada será inativado.`,
      }
    }
    cursoresVistos.add(pagina.proximoCursor)
    cursor = pagina.proximoCursor
  }

  return {
    itens,
    paginacaoCompleta: false,
    paginasLidas,
    motivo: 'LIMITE_DE_PAGINAS',
    detalhe: `Limite de ${opcoes.maxPaginas} páginas atingido antes do fim da vitrine. Nada será inativado; aumente o limite ou investigue a paginação.`,
  }
}
