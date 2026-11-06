/**
 * MLFeatureStore (Rodada 9, complemento ML, regra 7) — features nomeadas e
 * versionadas, derivadas de dados REAIS já existentes (`Conteudo`/
 * `Produto`/`Sale`/`Commission`). Sem serviço externo: usa o Postgres já
 * existente (`MLFeatureSnapshot`).
 *
 * Anti-leakage (regra 31): a extração de features (`extrairFeaturesDeConteudo`)
 * só usa dados anteriores/conhecidos no momento da publicação — o rótulo
 * (`extrairLabelDeConteudo`) é sempre uma chamada SEPARADA, feita depois,
 * quando o resultado (venda/comissão) já é conhecido. Nunca misturado na
 * mesma função.
 *
 * Funil preservado (regra 6): Produto → Conteudo (Creative/Publication) →
 * Sale → Commission, usando o vínculo real `Sale.contentId`. Este schema
 * não persiste `Opportunity`/`Impression` como eventos individuais.
 *
 * CLIQUE, porém, TEM log evento a evento: `EventoLink`. Desde o P0.3 é ele
 * a fonte de verdade — `Conteudo.cliquesLink` é LEGADO e não deve ser lido
 * como contagem de clique, porque nenhum código de produção o incrementa
 * (ver lib/metricas-clique.ts).
 */

import { estadoDaComissao, PESO_NO_APRENDIZADO } from './financeiro'
import { prisma } from './prisma'
import { classificarHook, type HookType } from './ml-hook-classifier'
import { classificarCta, type CtaType } from './ml-cta-classifier'
import { verificarSemDadosBiometricos } from './ml-privacy'
import type { MLDataOrigin } from './ml-types'

export const FEATURE_VERSION = 'ml-features-v1-rodada9'

export type ProductPriceBucket = 'LOW' | 'MID' | 'HIGH' | 'DESCONHECIDO'

/** Limiares documentados e ajustáveis — nunca escondidos dentro da função. */
export const LIMIARES_PRECO_PADRAO = { low: 50, high: 200 }

export function bucketPreco(preco: number | null | undefined, limiares = LIMIARES_PRECO_PADRAO): ProductPriceBucket {
  if (preco == null) return 'DESCONHECIDO'
  if (preco < limiares.low) return 'LOW'
  if (preco > limiares.high) return 'HIGH'
  return 'MID'
}

export interface ContentMLFeatures {
  product_price_bucket: ProductPriceBucket
  // Não existe campo de % de comissão persistido em Produto/AffiliateProgram
  // hoje — nunca inventado; fica `null` até o schema registrar isso.
  commission_percentage: number | null
  video_duration: number | null
  hook_type: HookType
  cta_type: CtaType
  posting_hour: number | null
  // Conteudo ainda não registra qual modo do Digital Twin foi usado
  // (DIGITAL_TWIN/VOICE_ONLY/MOTION_GRAPHICS) — reservado, sempre `null`
  // nesta rodada. Ver DIGITAL-TWIN.md para o estado real dessa integração.
  avatar_style: string | null
  channel: string | null
  product_category: string
  historical_conversion_rate: number | null
}

/**
 * Conversão histórica por categoria (reescrita no P0.3).
 *
 * ── O QUE ESTAVA ERRADO ─────────────────────────────────────────────────
 * A versão anterior somava `Conteudo.cliquesLink`, coluna que NENHUM código
 * de produção incrementa — vale 0 em operação. Com denominador zero, esta
 * função devolvia `null` em 100% dos casos reais: a feature existia e nunca
 * valia nada. E o numerador contava qualquer Sale CONFIRMED, inclusive
 * relato não comprovado e fixture de teste.
 *
 * ── FÓRMULA ATUAL ───────────────────────────────────────────────────────
 *     vendas REAIS elegíveis da categoria, anteriores ao corte
 *     ───────────────────────────────────────────────────────
 *     cliques REAIS do log, da categoria, anteriores ao corte
 *
 * Numerador: só venda aprovada pela autoridade única
 * (`avaliarVendaParaOperacaoReal`) — REAL_OPERATION comprovada, confirmada,
 * com comissão reconhecida. USER_REPORTED, UNVERIFIED, SEED, TEST_FIXTURE,
 * DEMO e SYNTHETIC_TEST ficam de fora por construção.
 *
 * Denominador: `EventoLink` do tipo `clique`, no mesmo workspace, resolvido
 * até a categoria pelo caminho real link → produto.
 *
 * ── ANTI-VAZAMENTO ──────────────────────────────────────────────────────
 * Os dois lados cortam em `antesDe`, e `excluirContentId` tira as vendas do
 * próprio conteúdo. Sem ele, um conteúdo cujo `createdAt` antecede a sua
 * `dataPublicacao` vazaria o próprio resultado para dentro da própria
 * feature — vazamento sutil que só aparece testando com dado real.
 *
 * Sem clique no período devolve `null`, nunca 0: o modelo trata `0` como
 * sinal ("mediu e deu zero") e `null` como ausência.
 */
export async function calcularConversaoHistoricaPorCategoria(
  workspaceId: string,
  categoria: string,
  antesDe: Date,
  excluirContentId?: string
): Promise<number | null> {
  const { calcularMetricasDeClique } = await import('./metricas-clique')
  const m = await calcularMetricasDeClique({
    workspaceId,
    categoria,
    antesDe,
    excluirContentId: excluirContentId ?? null,
  })
  return m.taxaConversao
}

/**
 * Extrai as features nomeadas de um `Conteudo` real. `referenceDate` é a
 * data de publicação (ou criação, se ainda não publicado) — o corte
 * temporal usado para a conversão histórica, nunca a data "agora".
 */
export async function extrairFeaturesDeConteudo(
  workspaceId: string,
  contentId: string
): Promise<{ features: ContentMLFeatures; referenceDate: Date } | null> {
  const conteudo = await prisma.conteudo.findFirst({
    where: { id: contentId, workspaceId },
    select: {
      roteiro: true,
      chamadaAcao: true,
      duracao: true,
      redeSocial: true,
      dataPublicacao: true,
      createdAt: true,
      produto: { select: { categoria: true, preco: true } },
    },
  })
  if (!conteudo) return null

  const referenceDate = conteudo.dataPublicacao ?? conteudo.createdAt
  const primeiraFrase = conteudo.roteiro?.split(/[.!?\n]/).find((s) => s.trim().length > 0) ?? null
  const hook = classificarHook(primeiraFrase)
  const cta = classificarCta(conteudo.chamadaAcao)
  const historicalRate = await calcularConversaoHistoricaPorCategoria(workspaceId, conteudo.produto.categoria, referenceDate, contentId)

  const features: ContentMLFeatures = {
    product_price_bucket: bucketPreco(conteudo.produto.preco),
    commission_percentage: null,
    video_duration: conteudo.duracao,
    hook_type: hook.tipo,
    cta_type: cta.tipo,
    posting_hour: conteudo.dataPublicacao ? conteudo.dataPublicacao.getUTCHours() : null,
    avatar_style: null,
    channel: conteudo.redeSocial,
    product_category: conteudo.produto.categoria,
    historical_conversion_rate: historicalRate,
  }

  return { features, referenceDate }
}

/**
 * `dataOrigin` é OBRIGATÓRIO e nunca inferido — quem chama declara
 * explicitamente se este dado veio de operação real (`REAL_OPERATION`)
 * ou de teste/fixture/demo/seed. Só `REAL_OPERATION` conta para o
 * `MLReadinessGate` de produção (`lib/ml-readiness-gate.ts`) — nunca a
 * confundir com dado real por omissão.
 */
export async function salvarFeatureSnapshot(
  workspaceId: string,
  entityType: string,
  entityId: string,
  features: ContentMLFeatures,
  dataOrigin: MLDataOrigin
) {
  verificarSemDadosBiometricos(features as unknown as Record<string, unknown>)
  return prisma.mLFeatureSnapshot.create({
    data: { workspaceId, entityType, entityId, featureVersion: FEATURE_VERSION, features: features as never, dataOrigin },
  })
}

export interface RotuloConversao {
  converted: boolean
  saleAmount: number | null
  commissionValue: number | null
}

/**
 * Rótulo (label) — SEMPRE chamado depois, quando o resultado já é
 * conhecido. Nunca dentro de `extrairFeaturesDeConteudo`.
 */
export async function extrairLabelDeConteudo(workspaceId: string, contentId: string): Promise<RotuloConversao> {
  const sales = await prisma.sale.findMany({
    where: { workspaceId, contentId, status: 'CONFIRMED' },
    select: { amount: true, commissions: { select: { status: true, expectedAmount: true, confirmedAmount: true, receivedAmount: true } } },
  })
  if (sales.length === 0) return { converted: false, saleAmount: null, commissionValue: null }

  const saleAmount = sales.reduce((s, v) => s + (v.amount ?? 0), 0)
  // P2.25: rótulo do ML pela régua canônica — comissão confirmada inteira, previsão com o peso da estimada,
  // revertida/cancelada zero (lib/financeiro.ts). Antes a previsão entrava como se fosse confirmada.
  const commissionValue = sales.reduce((somaVendas, venda) => {
    const daVenda = venda.commissions.reduce((soma, com) => {
      const e = estadoDaComissao(com, 'CONFIRMED')
      return soma + e.valor * PESO_NO_APRENDIZADO[e.estado]
    }, 0)
    return somaVendas + daVenda
  }, 0)

  return { converted: true, saleAmount, commissionValue }
}

export async function registrarLabelNoSnapshot(snapshotId: string, label: RotuloConversao) {
  return prisma.mLFeatureSnapshot.update({
    where: { id: snapshotId },
    data: { label: label as never, labeledAt: new Date() },
  })
}
