/**
 * Reconciliação de catálogo — o coração da sincronização automática da
 * Vitrine/Showcase (Rodada 11).
 *
 * AUTOMATION FIRST: cadastrar produto, preço, imagem, comissão e
 * disponibilidade à mão é exatamente o trabalho recorrente que esta camada
 * existe para eliminar. O que a API oficial fornecer, o Patrono importa
 * sozinho; o que ela NÃO fornecer, o Patrono deixa como está — nunca inventa.
 *
 * Módulo PURO de propósito: sem Prisma, sem rede, sem relógio próprio. Ele
 * decide "o que criar, o que atualizar, o que inativar" e devolve um plano.
 * Quem executa o plano (job/worker, item 5) entra depois, quando houver
 * credencial e aprovação reais. Assim a regra mais delicada do fluxo é
 * testável sem TikTok nenhum.
 *
 * Serve a qualquer provider — TikTok Shop hoje, Amazon/Mercado Livre/Shopee/
 * Renner depois — porque só conhece `ItemDeCatalogoExterno`, nunca o formato
 * bruto de uma plataforma.
 */

/**
 * Item já NORMALIZADO por um adaptador de provider.
 *
 * `undefined` e `null` significam coisas DIFERENTES aqui, e a distinção é o
 * que impede o Patrono de inventar dado:
 *   - `undefined` = a API não falou sobre este campo → não mexer no que existe
 *   - `null`      = a API disse explicitamente que não há valor → limpar
 */
export interface ItemDeCatalogoExterno {
  externalId: string
  nome?: string
  categoria?: string
  preco?: number | null
  linkProduto?: string | null
  descricao?: string | null
  imagens?: string[]
  videos?: string[]
  /** Percentual de comissão, quando a plataforma informar. */
  comissaoPercentual?: number | null
  /** Disponibilidade declarada pela plataforma. */
  disponivel?: boolean
}

/** Produto como já existe no Patrono, no mínimo necessário para reconciliar. */
export interface ProdutoSincronizado {
  id: string
  externalId: string
  nome: string
  preco: number | null
  status: string
  removidoDaOrigemEm: Date | null
}

export interface PlanoDeCriacao {
  externalId: string
  campos: Record<string, unknown>
}

export interface PlanoDeAtualizacao {
  id: string
  externalId: string
  /** Só os campos que a API realmente forneceu E que mudaram. */
  campos: Record<string, unknown>
}

export interface PlanoDeInativacao {
  id: string
  externalId: string
  motivo: string
}

export interface PlanoDeReconciliacao {
  criar: PlanoDeCriacao[]
  atualizar: PlanoDeAtualizacao[]
  inativar: PlanoDeInativacao[]
  /** Voltaram à vitrine depois de terem sumido. */
  reativar: PlanoDeAtualizacao[]
  inalterados: string[]
  resumo: ResumoReconciliacao
}

export interface ResumoReconciliacao {
  recebidos: number
  existentes: number
  criados: number
  atualizados: number
  inativados: number
  reativados: number
  inalterados: number
  /** Explica por que nada foi inativado, quando for o caso. */
  inativacaoAplicada: boolean
  motivoInativacaoNaoAplicada: string | null
}

export interface EntradaReconciliacao {
  /** O que já existe no Patrono para este (workspace, provider). */
  existentes: ProdutoSincronizado[]
  /** O que a API devolveu nesta rodada, já normalizado. */
  recebidos: ItemDeCatalogoExterno[]
  /**
   * TRAVA DE SEGURANÇA. Só é seguro inativar o que "sumiu" se TODAS as
   * páginas foram lidas com sucesso. Se a paginação parou no meio — rede
   * caiu, rate limit, token expirado —, o que falta parece "removido" e o
   * Patrono inativaria a vitrine inteira por causa de um erro de rede.
   * Nunca assuma `true`: quem pagina precisa provar que terminou.
   */
  paginacaoCompleta: boolean
  agora: Date
}

/** Campos que a atualização pode tocar, mapeados do item externo. */
function camposDoItem(item: ItemDeCatalogoExterno): Record<string, unknown> {
  const campos: Record<string, unknown> = {}
  // `undefined` some aqui: só entra no plano o que a API falou de verdade.
  if (item.nome !== undefined) campos.nome = item.nome
  if (item.categoria !== undefined) campos.categoria = item.categoria
  if (item.preco !== undefined) campos.preco = item.preco
  if (item.linkProduto !== undefined) campos.linkProduto = item.linkProduto
  if (item.descricao !== undefined) campos.descricao = item.descricao
  if (item.imagens !== undefined) campos.imagens = item.imagens
  if (item.videos !== undefined) campos.videos = item.videos
  return campos
}

function mudou(atual: unknown, novo: unknown): boolean {
  if (Array.isArray(atual) && Array.isArray(novo)) {
    return atual.length !== novo.length || atual.some((v, i) => v !== novo[i])
  }
  return atual !== novo
}

/**
 * Decide o plano. Não executa nada.
 *
 * Regras, na ordem em que importam:
 *  - identidade é SEMPRE o `externalId` da plataforma, nunca o nome;
 *  - item novo → criar;
 *  - item conhecido → atualizar só o que a API mandou e de fato mudou;
 *  - item conhecido que estava inativo e voltou → reativar;
 *  - item EXCLUÍDO pela titular ('descartado') → nunca reativar (só atualiza os dados da API);
 *  - item ausente da resposta → inativar, e SOMENTE com paginação completa;
 *  - nada é apagado, em nenhuma hipótese: histórico de venda e comissão
 *    aponta para o produto.
 */
export function reconciliarCatalogo(entrada: EntradaReconciliacao): PlanoDeReconciliacao {
  const porExternalId = new Map(entrada.existentes.map((p) => [p.externalId, p]))
  const recebidosIds = new Set<string>()

  const criar: PlanoDeCriacao[] = []
  const atualizar: PlanoDeAtualizacao[] = []
  const reativar: PlanoDeAtualizacao[] = []
  const inalterados: string[] = []

  for (const item of entrada.recebidos) {
    // Item sem identidade externa é descartado: sem ele não há idempotência,
    // e criar assim mesmo duplicaria o produto na próxima sincronização.
    if (!item.externalId) continue
    recebidosIds.add(item.externalId)

    const existente = porExternalId.get(item.externalId)
    const campos = camposDoItem(item)

    if (!existente) {
      criar.push({ externalId: item.externalId, campos })
      continue
    }

    const alterados: Record<string, unknown> = {}
    if (campos.nome !== undefined && mudou(existente.nome, campos.nome)) alterados.nome = campos.nome
    if (campos.preco !== undefined && mudou(existente.preco, campos.preco)) alterados.preco = campos.preco
    for (const chave of ['categoria', 'linkProduto', 'descricao', 'imagens', 'videos']) {
      if (campos[chave] !== undefined) alterados[chave] = campos[chave]
    }

    // P2.18.11: excluído pela TITULAR ('descartado') é decisão dela — o sync nunca ressuscita.
    // Só volta a 'ativo' o que o próprio sync tinha inativado (sumiu da origem e reapareceu).
    if (existente.status === 'descartado') {
      if (Object.keys(alterados).length > 0) atualizar.push({ id: existente.id, externalId: item.externalId, campos: { ...alterados, sincronizadoEm: entrada.agora } })
      else inalterados.push(item.externalId)
      continue
    }
    const voltou = existente.removidoDaOrigemEm !== null || existente.status !== 'ativo'
    if (voltou) {
      reativar.push({
        id: existente.id,
        externalId: item.externalId,
        campos: { ...alterados, status: 'ativo', removidoDaOrigemEm: null, sincronizadoEm: entrada.agora },
      })
      continue
    }

    if (Object.keys(alterados).length > 0) {
      atualizar.push({ id: existente.id, externalId: item.externalId, campos: { ...alterados, sincronizadoEm: entrada.agora } })
    } else {
      inalterados.push(item.externalId)
    }
  }

  const inativar: PlanoDeInativacao[] = []
  let motivoInativacaoNaoAplicada: string | null = null

  if (entrada.paginacaoCompleta) {
    for (const existente of entrada.existentes) {
      if (recebidosIds.has(existente.externalId)) continue
      if (existente.status !== 'ativo') continue // já inativo, nada a fazer
      inativar.push({
        id: existente.id,
        externalId: existente.externalId,
        motivo: 'Produto não veio na sincronização completa da vitrine — provavelmente removido na origem.',
      })
    }
  } else {
    motivoInativacaoNaoAplicada =
      'Paginação incompleta nesta rodada — nada foi inativado. Inativar aqui trataria falha de rede como "produto removido".'
  }

  return {
    criar,
    atualizar,
    reativar,
    inativar,
    inalterados,
    resumo: {
      recebidos: entrada.recebidos.length,
      existentes: entrada.existentes.length,
      criados: criar.length,
      atualizados: atualizar.length,
      inativados: inativar.length,
      reativados: reativar.length,
      inalterados: inalterados.length,
      inativacaoAplicada: entrada.paginacaoCompleta,
      motivoInativacaoNaoAplicada,
    },
  }
}

// ── Preparo para o ML já existente ──────────────────────────────────────
//
// NENHUM modelo novo é criado aqui: o projeto já tem `ml-engine`,
// `ml-feature-store`, `MLBlendedScorer`, `ml-readiness-gate`,
// `ml-model-registry` e a auditoria em `MLPrediction`. O que faltava era o
// catálogo automático produzir features. Esta função só EXTRAI o que a
// sincronização observou — não decide nada, não treina, não pontua.
//
// `dataOrigin` deliberadamente NÃO é decidido aqui: `salvarFeatureSnapshot()`
// exige que quem chama declare a proveniência, e os gates
// (REAL_OPERATION vs TEST_FIXTURE/DEMO/SEED/SYNTHETIC_TEST) continuam
// intocados. Uma função pura não tem como saber se está num teste.

export interface FeaturesDeCatalogo {
  externalId: string
  providerId: string
  /** null quando a API não informou — nunca 0 por conveniência. */
  preco: number | null
  comissaoPercentual: number | null
  disponivel: boolean | null
  temImagem: boolean
  temVideo: boolean
  quantidadeImagens: number
  categoria: string | null
  /** Quantas vezes este item já apareceu/sumiu ajuda a medir estabilidade. */
  novoNestaRodada: boolean
  reativadoNestaRodada: boolean
}

export function extrairFeaturesDeCatalogo(
  itens: ItemDeCatalogoExterno[],
  providerId: string,
  plano: PlanoDeReconciliacao
): FeaturesDeCatalogo[] {
  const novos = new Set(plano.criar.map((c) => c.externalId))
  const reativados = new Set(plano.reativar.map((r) => r.externalId))

  return itens
    .filter((i) => i.externalId)
    .map((i) => ({
      externalId: i.externalId,
      providerId,
      preco: i.preco ?? null,
      comissaoPercentual: i.comissaoPercentual ?? null,
      disponivel: i.disponivel ?? null,
      temImagem: (i.imagens?.length ?? 0) > 0,
      temVideo: (i.videos?.length ?? 0) > 0,
      quantidadeImagens: i.imagens?.length ?? 0,
      categoria: i.categoria ?? null,
      novoNestaRodada: novos.has(i.externalId),
      reativadoNestaRodada: reativados.has(i.externalId),
    }))
}
