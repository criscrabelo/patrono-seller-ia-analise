/**
 * Execução do plano de reconciliação de catálogo (Rodada 13).
 *
 * `reconciliarCatalogo()` decide; este módulo aplica. A separação é o que
 * permite testar a regra mais delicada do fluxo (o que INATIVAR) sem banco
 * nenhum, e testar a escrita sem TikTok nenhum.
 *
 * AUTOMATION FIRST: a proprietária não cadastra, não atualiza e não desativa
 * produto à mão. O que a API oficial fornece, o Patrono aplica sozinho.
 *
 * Garantias preservadas aqui:
 *  - isolamento por `workspaceId` em TODA query — nenhum negócio enxerga o
 *    catálogo do outro;
 *  - idempotência apoiada na constraint do banco
 *    `@@unique([workspaceId, providerId, externalId])`, não só na lógica;
 *  - nada é apagado, nunca: venda e comissão apontam para o produto;
 *  - auditoria por rodada, com o resumo do que mudou.
 */

import { prisma } from './prisma'
import { registrarAuditoria } from './audit-log'
import {
  reconciliarCatalogo,
  extrairFeaturesDeCatalogo,
  type ItemDeCatalogoExterno,
  type PlanoDeReconciliacao,
  type ProdutoSincronizado,
  type FeaturesDeCatalogo,
} from './catalogo-sync'

/** Origem de dados dos produtos vindos da Vitrine/Showcase do TikTok Shop. */
export const ORIGEM_TIKTOK_SHOWCASE = 'TIKTOK_SHOWCASE'

/**
 * `origemConteudo` dos produtos importados. "De fornecedor" é a descrição
 * honesta: a mídia é do vendedor, não da proprietária. Combina com o mapa de
 * direitos, que já trata `TIKTOK_SHOWCASE` como `UNKNOWN` — exibir sim,
 * transformar em vídeo não, até os termos serem validados.
 */
const ORIGEM_CONTEUDO_IMPORTADO = 'De fornecedor'

export interface EntradaExecucao {
  workspaceId: string
  /** Dono do produto no Patrono — exigido pelo modelo `Produto`. */
  userId: string
  providerId: string
  itens: ItemDeCatalogoExterno[]
  /** Vindo de `percorrerPaginas()`. `false` impede qualquer inativação. */
  paginacaoCompleta: boolean
  agora?: Date
}

export interface ResultadoExecucao {
  plano: PlanoDeReconciliacao
  features: FeaturesDeCatalogo[]
  aplicado: { criados: number; atualizados: number; reativados: number; inativados: number }
}

/** Campos obrigatórios do `Produto` que a API externa não fornece. */
function camposObrigatoriosDeCriacao(workspaceId: string, userId: string, providerId: string) {
  return {
    workspaceId,
    userId,
    providerId,
    origemDados: ORIGEM_TIKTOK_SHOWCASE,
    origemConteudo: ORIGEM_CONTEUDO_IMPORTADO,
    tipoVenda: 'afiliado',
    // Listas vazias, nunca conteúdo inventado: benefício e ponto negativo
    // são julgamento humano/IA sobre o produto, não dado da plataforma.
    publicoAlvo: [] as string[],
    beneficios: [] as string[],
    pontosNegativos: [] as string[],
    imagens: [] as string[],
    videos: [] as string[],
  }
}

export async function executarSincronizacaoDeCatalogo(entrada: EntradaExecucao): Promise<ResultadoExecucao> {
  const agora = entrada.agora ?? new Date()

  // Isolamento por workspace E por provider: um negócio nunca vê o catálogo
  // do outro, e o Amazon de amanhã não mexe no que é do TikTok.
  const existentesRows = await prisma.produto.findMany({
    where: { workspaceId: entrada.workspaceId, providerId: entrada.providerId },
    select: { id: true, externalId: true, nome: true, preco: true, status: true, removidoDaOrigemEm: true },
  })

  const existentes: ProdutoSincronizado[] = existentesRows
    .filter((p): p is typeof p & { externalId: string } => p.externalId !== null)
    .map((p) => ({
      id: p.id,
      externalId: p.externalId,
      nome: p.nome,
      preco: p.preco,
      status: p.status,
      removidoDaOrigemEm: p.removidoDaOrigemEm,
    }))

  const plano = reconciliarCatalogo({
    existentes,
    recebidos: entrada.itens,
    paginacaoCompleta: entrada.paginacaoCompleta,
    agora,
  })

  const base = camposObrigatoriosDeCriacao(entrada.workspaceId, entrada.userId, entrada.providerId)

  // Transação: uma rodada de sincronização entra inteira ou não entra. Meio
  // catálogo atualizado seria pior do que nenhum — a próxima rodada veria um
  // estado que não corresponde nem ao anterior nem ao da vitrine.
  await prisma.$transaction(async (tx) => {
    for (const criar of plano.criar) {
      await tx.produto.create({
        data: {
          ...base,
          externalId: criar.externalId,
          // `nome` e `categoria` são obrigatórios no modelo. Quando a API não
          // os envia, um rótulo explícito deixa claro que falta dado — melhor
          // que um nome inventado que iria para a legenda publicada.
          nome: (criar.campos.nome as string) ?? `Produto ${criar.externalId}`,
          categoria: (criar.campos.categoria as string) ?? 'nao-informada',
          preco: (criar.campos.preco as number | null) ?? null,
          linkProduto: (criar.campos.linkProduto as string | null) ?? null,
          descricao: (criar.campos.descricao as string | null) ?? null,
          imagens: (criar.campos.imagens as string[]) ?? [],
          videos: (criar.campos.videos as string[]) ?? [],
          sincronizadoEm: agora,
        },
      })
    }

    for (const atualizar of [...plano.atualizar, ...plano.reativar]) {
      await tx.produto.update({
        where: { id: atualizar.id },
        // Só os campos que a API realmente enviou E que mudaram — o plano já
        // veio filtrado. Campo ausente na resposta não é tocado.
        data: atualizar.campos as Record<string, never>,
      })
    }

    for (const inativar of plano.inativar) {
      await tx.produto.update({
        where: { id: inativar.id },
        // INATIVA, nunca apaga: `Sale` e `Commission` apontam para o produto,
        // e o histórico de receita não pode sumir porque a vitrine mudou.
        data: { status: 'inativo', removidoDaOrigemEm: agora, sincronizadoEm: agora },
      })
    }
  })

  const features = extrairFeaturesDeCatalogo(entrada.itens, entrada.providerId, plano)

  await registrarAuditoria({
    workspaceId: entrada.workspaceId,
    userId: entrada.userId,
    action: 'catalogo.sincronizado',
    entityType: 'Produto',
    entityId: entrada.providerId,
    metadata: {
      providerId: entrada.providerId,
      origemDados: ORIGEM_TIKTOK_SHOWCASE,
      ...plano.resumo,
      // Registrado de propósito: quando a inativação NÃO foi aplicada, o
      // motivo fica na auditoria em vez de virar um silêncio inexplicável.
      motivoInativacaoNaoAplicada: plano.resumo.motivoInativacaoNaoAplicada,
    },
  })

  return {
    plano,
    features,
    aplicado: {
      criados: plano.criar.length,
      atualizados: plano.atualizar.length,
      reativados: plano.reativar.length,
      inativados: plano.inativar.length,
    },
  }
}
