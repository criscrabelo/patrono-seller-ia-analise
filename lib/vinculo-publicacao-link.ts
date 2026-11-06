/**
 * Vínculo `Publicacao` → `LinkDinamico` (P1.0 Etapa 2.b).
 *
 * ── O INVARIANTE QUE O BANCO NÃO GARANTE ────────────────────────────────
 * As FKs compostas da migration garantem WORKSPACE. Não garantem PRODUTO.
 * Dentro de um mesmo workspace, o banco aceitaria:
 *
 *   Conteudo(produto A) → Publicacao → LinkDinamico(produto B)
 *
 * O efeito seria o pior possível em silêncio: o post fala do produto A e o
 * clique leva o comprador ao produto B. A venda, se acontecer, é do B, e a
 * atribuição por publicação passa a mentir.
 *
 * Garantir isso no banco exigiria `produtoId` redundante em `Publicacao`
 * (mais uma FK composta) — uma segunda verdade que pode divergir de
 * `Conteudo.produtoId`. Preferimos a trava na aplicação, mas uma trava que
 * NÃO DÁ PARA ESQUECER.
 *
 * ── POR QUE ESTE MÓDULO EXISTE, SE O CONTRATO JÁ TEM A REGRA ────────────
 * `validarPublicacao()` já recusa `LINK_DE_OUTRO_PRODUTO` — mas só quando
 * quem chama passa `linkProdutoId` e `conteudoProdutoId` no contexto. Se
 * esquecer, o teste `!= null` pula a verificação e a publicação passa.
 * Fail-OPEN.
 *
 * Aqui os dois produtos são LIDOS DO SERVIDOR, sempre. Não há parâmetro
 * para esquecer, e nada vindo do cliente é aceito. O contrato continua
 * valendo como regra pura; este módulo é a porta por onde o vínculo passa.
 */

import { prisma } from './prisma'

export const MOTIVOS_VINCULO_INVALIDO = [
  /** Conteúdo não existe, ou não é deste workspace. */
  'CONTEUDO_NAO_ENCONTRADO',
  /** Link não existe, ou não é deste workspace. */
  'LINK_NAO_ENCONTRADO',
  /** O link aponta para produto diferente do produto do conteúdo. */
  'LINK_DE_OUTRO_PRODUTO',
  /** O link já pertence a outra publicação — cardinalidade 1 → 0..1. */
  'LINK_JA_VINCULADO',
  /** Parâmetros incompletos. Nunca "deixa passar por omissão". */
  'PARAMETROS_INCOMPLETOS',
] as const

export type MotivoVinculoInvalido = (typeof MOTIVOS_VINCULO_INVALIDO)[number]

export interface VereditoDoVinculo {
  ok: boolean
  motivo: MotivoVinculoInvalido | null
  explicacao: string
  /** O produto que os dois lados precisam compartilhar. `null` se recusado. */
  produtoId: string | null
}

/**
 * Pode este `LinkDinamico` ser vinculado à publicação deste `Conteudo`?
 *
 * Fail-closed em tudo: parâmetro faltando, conteúdo de outro workspace, link
 * de outro workspace, produto diferente, link já tomado — todos recusam.
 * Na dúvida, não vincula.
 *
 * NUNCA lança: quem chama decide o que fazer com `ok: false`.
 */
export async function avaliarVinculoDeLinkComPublicacao(params: {
  workspaceId: string
  /** O conteúdo da `Publicacao` — de onde sai o produto verdadeiro. */
  contentId: string
  linkId: string
  /**
   * A publicação que quer o link. Quando informada, um link já vinculado a
   * ELA MESMA é aceito — retry não é conflito.
   */
  publicacaoId?: string | null
  /**
   * `LinkDinamico.publicacaoId` atual, quando quem chama já o leu.
   *
   * NÃO é lido aqui de propósito: a coluna só existe depois da migration, e
   * este módulo precisa funcionar antes dela. Esquecer de passar não abre
   * buraco nenhum — a cardinalidade tem garantia de BANCO
   * (`LinkDinamico_publicacaoId_workspaceId_key`), que recusa o segundo
   * vínculo mesmo que ninguém confira.
   *
   * A verificação de PRODUTO, essa sim, não tem garantia de banco — e por
   * isso ela não depende de parâmetro nenhum.
   */
  publicacaoIdAtualDoLink?: string | null
}): Promise<VereditoDoVinculo> {
  const recusar = (motivo: MotivoVinculoInvalido, explicacao: string): VereditoDoVinculo => ({
    ok: false,
    motivo,
    explicacao,
    produtoId: null,
  })

  if (!params?.workspaceId?.trim() || !params?.contentId?.trim() || !params?.linkId?.trim()) {
    return recusar(
      'PARAMETROS_INCOMPLETOS',
      'workspaceId, contentId e linkId são obrigatórios juntos — sem os três não há o que conferir.'
    )
  }

  try {
    // Os dois lados lidos do SERVIDOR, cada um escopado pelo workspace.
    const [conteudo, link] = await Promise.all([
      prisma.conteudo.findFirst({
        where: { id: params.contentId, workspaceId: params.workspaceId },
        select: { produtoId: true },
      }),
      prisma.linkDinamico.findFirst({
        where: { id: params.linkId, workspaceId: params.workspaceId },
        select: { produtoId: true },
      }),
    ])

    if (!conteudo) {
      return recusar('CONTEUDO_NAO_ENCONTRADO', 'Conteúdo não encontrado neste workspace.')
    }
    if (!link) {
      return recusar('LINK_NAO_ENCONTRADO', 'Link não encontrado neste workspace.')
    }

    // O CORAÇÃO DA TRAVA. Nenhum dos dois lados veio de quem chamou.
    if (link.produtoId !== conteudo.produtoId) {
      return recusar(
        'LINK_DE_OUTRO_PRODUTO',
        'O link aponta para produto diferente do produto do conteúdo — o post falaria de um produto e o clique levaria a outro.'
      )
    }

    // Cardinalidade 1 → 0..1, em cima do banco. Retry da MESMA publicação
    // não é conflito.
    const jaVinculado = params.publicacaoIdAtualDoLink?.trim() || null
    const alvo = params.publicacaoId?.trim() || null
    if (jaVinculado && jaVinculado !== alvo) {
      return recusar(
        'LINK_JA_VINCULADO',
        'Este link já pertence a outra publicação. Republicação cria link próprio; ela não toma o link de outra.'
      )
    }

    return {
      ok: true,
      motivo: null,
      explicacao: jaVinculado
        ? 'Link já vinculado a esta mesma publicação — retry, não duplicata.'
        : 'Link e conteúdo compartilham produto e workspace.',
      produtoId: conteudo.produtoId,
    }
  } catch (e) {
    console.error(`[vinculo-publicacao] falha ao avaliar vínculo do link ${params.linkId}:`, e)
    return recusar('LINK_NAO_ENCONTRADO', 'Não foi possível conferir o vínculo.')
  }
}

/**
 * REGRA PERMANENTE desta etapa.
 *
 * Nenhum caminho pode gravar `LinkDinamico.publicacaoId` sem passar por
 * `avaliarVinculoDeLinkComPublicacao()`. Há teste que lê o código-fonte e
 * exige isso de todo módulo que escreva a coluna.
 *
 * O dia em que essa trava incomodar é o dia de conferir se o caso novo é
 * legítimo — não de contorná-la.
 */
export const VINCULO_EXIGE_AVALIACAO = {
  chave: 'publicacao:vinculo-de-link',
  funcaoObrigatoria: 'avaliarVinculoDeLinkComPublicacao',
  colunaProtegida: 'LinkDinamico.publicacaoId',
  porqueNaoEstaNoBanco:
    'Garantir produto no banco exigiria produtoId redundante em Publicacao, criando uma segunda verdade capaz de divergir de Conteudo.produtoId.',
} as const
