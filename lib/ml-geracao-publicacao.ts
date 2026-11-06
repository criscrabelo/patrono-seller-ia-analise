/**
 * Geração `publication_v1` do Feature Store (P1.0 — Etapa 2.d).
 *
 * ── A TROCA DE UNIDADE DE OBSERVAÇÃO ────────────────────────────────────
 * Até aqui a amostra era o `Conteudo`: uma peça, uma linha, para sempre.
 * Publicar a mesma peça de novo, ou em outro canal, não gerava observação
 * nova — a segunda distribuição sumia dentro da primeira.
 *
 * Agora a amostra é a `Publicacao`. Cada distribuição concreta vira uma
 * observação, com o canal, o provider e o instante que ela realmente teve.
 *
 * ── AS DUAS GERAÇÕES NÃO SE MISTURAM ────────────────────────────────────
 * Nada é migrado, convertido ou apagado. As amostras antigas continuam
 * `entityType = 'Conteudo'`, `featureVersion = ml-features-v1-rodada9`, e
 * são contadas dentro da geração delas. As novas nascem
 * `entityType = 'Publicacao'`, `featureVersion = 'publication_v1'`.
 *
 * Reconstruir amostra antiga no formato novo usaria o estado ATUAL do
 * conteúdo — que pode ter sido editado depois da publicação. É o vazamento
 * que o Bloco 4.1 eliminou, e não vamos reintroduzi-lo por conveniência.
 *
 * PREÇO ASSUMIDO: as gerações não se somam para prontidão. O relógio do
 * readiness recomeça na geração nova.
 */

import { prisma } from './prisma'
import { bucketPreco } from './ml-feature-store'
import { classificarHook, type HookType } from './ml-hook-classifier'
import { classificarCta, type CtaType } from './ml-cta-classifier'
import { verificarSemDadosBiometricos } from './ml-privacy'
import { verificarSemVazamentoDeResultado, type LabelDeOperacaoReal } from './ml-operacao-real'
import { avaliarVendaParaOperacaoReal } from './real-operation'
import { lerPoliticaDeObservacao, janelaEncerrada } from './ml-captura-publicacao'
import { derivarEstadoDaPublicacaoPersistida } from './rastreamento-da-publicacao'
import { calcularMetricasDaPublicacao } from './metricas-publicacao'
import { calcularMetricasDeClique } from './metricas-clique'

// ── Identidade da geração ───────────────────────────────────────────────

export const FEATURE_VERSION_PUBLICACAO = 'publication_v1'
export const ENTIDADE_PUBLICACAO = 'Publicacao'

/** A geração anterior, preservada intacta. Só para comparação e contagem. */
export const GERACAO_ANTERIOR = {
  entityType: 'Conteudo',
  featureVersion: 'ml-features-v1-rodada9',
} as const

// ── Features ────────────────────────────────────────────────────────────

/**
 * Nível de onde veio `historical_conversion_rate`.
 *
 * Gravado JUNTO com a taxa, sempre. Uma taxa sem o nível de onde saiu é um
 * número que parece comparável e não é — e foi exatamente misturar níveis
 * que a granularidade explícita do P0.3.1 proibiu.
 */
export const GRANULARIDADES_DA_CONVERSAO = ['CONTEUDO', 'CATEGORIA', 'INDISPONIVEL'] as const
export type GranularidadeDaConversao = (typeof GRANULARIDADES_DA_CONVERSAO)[number]

export interface PublicationMLFeatures {
  // ── Da distribuição ──
  channel: string | null
  provider: string | null
  /** `true` quando o post saiu com `/api/l/{slug}`. */
  tracked: boolean
  posting_hour: number | null
  // ── Do criativo, como ele estava NA distribuição ──
  hook_type: HookType
  cta_type: CtaType
  video_duration: number | null
  /** Modo do Digital Twin. `null` enquanto o Conteudo não registrar. */
  avatar_style: string | null
  content_style: string | null
  // ── Da oferta, conhecida ANTES de publicar ──
  product_category: string
  product_price_bucket: string
  /** Taxa da oferta, do link. Nunca o valor de uma comissão realizada. */
  commission_percentage: number | null
  // ── Contexto histórico anterior ao instante da distribuição ──
  historical_conversion_rate: number | null
  historical_conversion_granularity: GranularidadeDaConversao
  /** Quantas publicações deste conteúdo já tinham saído antes desta. */
  prior_publications: number
}

/** Mínimo de cliques para a taxa por conteúdo ser confiável o bastante. */
export const CLIQUES_MINIMOS_PARA_NIVEL_CONTEUDO = 10

/**
 * Conversão histórica, preferindo o nível mais específico que se sustenta.
 *
 * 1. CONTEUDO — publicações anteriores do MESMO conteúdo, pela cadeia
 *    explícita. Só vale com cliques suficientes; com 1 ou 2 cliques a taxa
 *    oscila entre 0 e 1 e ensina ruído.
 * 2. CATEGORIA — o fallback, pela via já provada no P0.3.
 * 3. INDISPONIVEL — `null`, nunca 0.
 *
 * O nível usado volta junto e é gravado na feature. Numerador e denominador
 * saem SEMPRE do mesmo nível; não há mistura silenciosa.
 *
 * ANTI-VAZAMENTO: os dois caminhos cortam em `antesDe` e excluem o próprio
 * conteúdo, então a publicação nunca vê o próprio resultado.
 */
export async function calcularConversaoHistoricaDaPublicacao(params: {
  workspaceId: string
  contentId: string
  categoria: string
  antesDe: Date
}): Promise<{ taxa: number | null; granularidade: GranularidadeDaConversao }> {
  // 1. Nível CONTEUDO — publicações anteriores desta mesma peça.
  try {
    const porConteudo = await calcularMetricasDaPublicacao(
      { workspaceId: params.workspaceId, contentId: params.contentId, antesDe: params.antesDe },
      'CONTEUDO'
    )
    if (
      porConteudo.indisponibilidade === null &&
      porConteudo.cliques >= CLIQUES_MINIMOS_PARA_NIVEL_CONTEUDO &&
      porConteudo.saleConversionRate !== null
    ) {
      return { taxa: porConteudo.saleConversionRate, granularidade: 'CONTEUDO' }
    }
  } catch {
    // Cai para a categoria.
  }

  // 2. Fallback EXPLÍCITO para categoria.
  try {
    const porCategoria = await calcularMetricasDeClique({
      workspaceId: params.workspaceId,
      categoria: params.categoria,
      antesDe: params.antesDe,
      excluirContentId: params.contentId,
    })
    if (porCategoria.taxaConversao !== null) {
      return { taxa: porCategoria.taxaConversao, granularidade: 'CATEGORIA' }
    }
  } catch {
    // Sem histórico.
  }

  return { taxa: null, granularidade: 'INDISPONIVEL' }
}

export interface FeaturesExtraidas {
  features: PublicationMLFeatures
  /** O instante da distribuição. Marco de tudo o que vem depois. */
  distribuidaEm: Date
}

/**
 * Extrai as features de uma `Publicacao` DISTRIBUIDA.
 *
 * Tudo aqui é o que era conhecido no instante da distribuição: atributos do
 * criativo, da oferta e do histórico ANTERIOR. Nada que só existe depois —
 * venda, comissão realizada, receita, clique posterior ou rótulo.
 */
export async function extrairFeaturesDaPublicacao(
  workspaceId: string,
  publicacaoId: string
): Promise<FeaturesExtraidas | null> {
  const pub = await prisma.publicacao.findFirst({
    where: { id: publicacaoId, workspaceId },
    select: {
      id: true,
      contentId: true,
      canal: true,
      provider: true,
      estado: true,
      distribuidaEm: true,
      createdAt: true,
      link: { select: { id: true, comissao: true, createdAt: true } },
      content: {
        select: {
          roteiro: true,
          chamadaAcao: true,
          duracao: true,
          estilo: true,
          produto: { select: { categoria: true, preco: true } },
        },
      },
    },
  })
  if (!pub || !pub.distribuidaEm) return null

  const estadoDeRastreamento = derivarEstadoDaPublicacaoPersistida({
    estado: pub.estado,
    distribuidaEm: pub.distribuidaEm,
    link: pub.link ? { criadoEm: pub.link.createdAt } : null,
  })

  const primeiraFrase = pub.content.roteiro?.split(/[.!?\n]/).find((s) => s.trim().length > 0) ?? null
  const historico = await calcularConversaoHistoricaDaPublicacao({
    workspaceId,
    contentId: pub.contentId,
    categoria: pub.content.produto.categoria,
    antesDe: pub.distribuidaEm,
  })

  // Quantas publicações deste conteúdo já tinham sido distribuídas ANTES
  // desta. É contexto legítimo: a terceira vez que uma peça vai ao ar não é
  // a mesma coisa que a primeira.
  const prior_publications = await prisma.publicacao.count({
    where: {
      workspaceId,
      contentId: pub.contentId,
      estado: 'DISTRIBUIDA',
      distribuidaEm: { lt: pub.distribuidaEm },
    },
  })

  const features: PublicationMLFeatures = {
    channel: pub.canal ?? null,
    provider: pub.provider ?? null,
    tracked: estadoDeRastreamento === 'RASTREADA',
    posting_hour: pub.distribuidaEm.getUTCHours(),
    hook_type: classificarHook(primeiraFrase).tipo,
    cta_type: classificarCta(pub.content.chamadaAcao).tipo,
    video_duration: pub.content.duracao,
    // O Conteudo ainda não registra o modo do Digital Twin usado.
    avatar_style: null,
    content_style: pub.content.estilo ?? null,
    product_category: pub.content.produto.categoria,
    product_price_bucket: bucketPreco(pub.content.produto.preco),
    // A TAXA da oferta, que vem do link e existe antes de qualquer venda.
    // Sem link (fallback), fica `null` — nunca 0.
    commission_percentage: typeof pub.link?.comissao === 'number' ? pub.link.comissao : null,
    historical_conversion_rate: historico.taxa,
    historical_conversion_granularity: historico.granularidade,
    prior_publications,
  }

  return { features, distribuidaEm: pub.distribuidaEm }
}

// ── Captura ─────────────────────────────────────────────────────────────

export const MOTIVOS_CAPTURA_PUBLICACAO = [
  'CAPTURADO',
  'JA_CAPTURADO',
  'PUBLICACAO_NAO_ENCONTRADA',
  'SEM_DISTRIBUICAO_COMPROVADA',
  'FEATURES_INDISPONIVEIS',
] as const

export type MotivoCapturaPublicacao = (typeof MOTIVOS_CAPTURA_PUBLICACAO)[number]

export interface ResultadoDaCapturaDaPublicacao {
  capturado: boolean
  motivo: MotivoCapturaPublicacao
  snapshotId: string | null
  workspaceId: string
  publicacaoId: string
  explicacao: string
}

/** Chave determinística da amostra, para o lock de idempotência. */
export function chaveDaAmostraDaPublicacao(p: { workspaceId: string; publicacaoId: string }): string {
  return `ml:${FEATURE_VERSION_PUBLICACAO}:${p.workspaceId}:${p.publicacaoId}`
}

/**
 * Captura a amostra no instante em que a publicação foi DISTRIBUIDA.
 *
 * PROSPECTIVA: nasce sem rótulo. O resultado ainda não existe, e rotular
 * agora seria inventá-lo.
 *
 * IDEMPOTENTE: uma publicação gera no máximo uma amostra por
 * `featureVersion`. Retry não duplica porque é a mesma `Publicacao`;
 * republicação gera outra amostra porque é OUTRA `Publicacao` — que é
 * exatamente o ponto desta geração.
 *
 * NUNCA lança: publicar não pode falhar porque o ML não conseguiu observar.
 */
export async function capturarSnapshotDaPublicacao(params: {
  workspaceId: string
  publicacaoId: string
}): Promise<ResultadoDaCapturaDaPublicacao> {
  const base = {
    workspaceId: params?.workspaceId ?? '',
    publicacaoId: params?.publicacaoId ?? '',
  }
  const falhar = (motivo: MotivoCapturaPublicacao, explicacao: string): ResultadoDaCapturaDaPublicacao => ({
    capturado: false,
    motivo,
    snapshotId: null,
    ...base,
    explicacao,
  })

  if (!base.workspaceId || !base.publicacaoId) {
    return falhar('PUBLICACAO_NAO_ENCONTRADA', 'workspaceId e publicacaoId são obrigatórios juntos.')
  }

  try {
    const pub = await prisma.publicacao.findFirst({
      where: { id: base.publicacaoId, workspaceId: base.workspaceId },
      select: { estado: true, distribuidaEm: true },
    })
    if (!pub) {
      return falhar('PUBLICACAO_NAO_ENCONTRADA', 'Publicação não encontrada neste workspace.')
    }
    // PORTÃO: só distribuição confirmada gera amostra de produção.
    if (pub.estado !== 'DISTRIBUIDA' || !pub.distribuidaEm) {
      return falhar(
        'SEM_DISTRIBUICAO_COMPROVADA',
        `Publicação em ${pub.estado} sem instante de distribuição — nada circulou, nada a observar.`
      )
    }

    const extraido = await extrairFeaturesDaPublicacao(base.workspaceId, base.publicacaoId)
    if (!extraido) {
      return falhar('FEATURES_INDISPONIVEIS', 'Não foi possível extrair as features desta publicação.')
    }

    const asRecord = extraido.features as unknown as Record<string, unknown>
    verificarSemDadosBiometricos(asRecord)
    verificarSemVazamentoDeResultado(asRecord)

    const chave = chaveDaAmostraDaPublicacao(base)
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtext(${chave}))) AS trava`

      const existente = await tx.mLFeatureSnapshot.findFirst({
        where: {
          workspaceId: base.workspaceId,
          entityType: ENTIDADE_PUBLICACAO,
          entityId: base.publicacaoId,
          featureVersion: FEATURE_VERSION_PUBLICACAO,
        },
        select: { id: true },
      })
      if (existente) {
        return {
          capturado: false,
          motivo: 'JA_CAPTURADO' as const,
          snapshotId: existente.id,
          ...base,
          explicacao: 'Esta publicação já tem amostra desta geração — a observação original é preservada.',
        }
      }

      const novo = await tx.mLFeatureSnapshot.create({
        data: {
          workspaceId: base.workspaceId,
          entityType: ENTIDADE_PUBLICACAO,
          entityId: base.publicacaoId,
          featureVersion: FEATURE_VERSION_PUBLICACAO,
          dataOrigin: 'REAL_OPERATION',
          features: extraido.features as never,
          // O marco é a DISTRIBUIÇÃO, nunca o instante em que este código rodou.
          capturedAt: extraido.distribuidaEm,
          label: undefined,
          labeledAt: null,
        },
        select: { id: true },
      })

      return {
        capturado: true,
        motivo: 'CAPTURADO' as const,
        snapshotId: novo.id,
        ...base,
        explicacao: `Amostra ${FEATURE_VERSION_PUBLICACAO} capturada na distribuição da publicação ${base.publicacaoId}.`,
      }
    })
  } catch (e) {
    console.error(`[ml-publicacao] falha ao capturar amostra da publicação ${base.publicacaoId}:`, e)
    return falhar('FEATURES_INDISPONIVEIS', e instanceof Error ? e.message : 'Falha ao capturar a amostra.')
  }
}

// ── Rotulagem ───────────────────────────────────────────────────────────

export const MOTIVOS_ROTULO_PUBLICACAO = [
  'ROTULADO',
  'SEM_AMOSTRA',
  'JA_ROTULADO',
  'VENDA_NAO_ELEGIVEL',
  'SEM_ATRIBUICAO_A_PUBLICACAO',
  'JANELA_ABERTA',
  'NAO_RASTREADA',
  'RESULTADO_EM_DUVIDA',
  'SEM_DISTRIBUICAO_COMPROVADA',
] as const

export type MotivoRotuloPublicacao = (typeof MOTIVOS_ROTULO_PUBLICACAO)[number]

export interface ResultadoDoRotulo {
  rotulado: boolean
  motivo: MotivoRotuloPublicacao
  snapshotId: string | null
  publicacaoId: string | null
  explicacao: string
}

const semRotulo = (
  motivo: MotivoRotuloPublicacao,
  explicacao: string,
  publicacaoId: string | null = null,
  snapshotId: string | null = null
): ResultadoDoRotulo => ({ rotulado: false, motivo, snapshotId, publicacaoId, explicacao })

/**
 * POSITIVO — a venda elegível atribuída a esta publicação pela CADEIA.
 *
 *   Sale.clickEventId → EventoLink → LinkDinamico → Publicacao
 *
 * Sem `clickEventId` não há atribuição. A venda continua sendo receita real;
 * o que fica desconhecido é o criativo. Nenhuma heurística de data, produto
 * ou "era a única no ar" — aproximação aqui ensinaria o modelo a creditar o
 * criativo errado, e o erro não apareceria em métrica nenhuma.
 */
export async function rotularPositivoDaPublicacao(params: {
  workspaceId: string
  saleId: string
  agora?: Date
}): Promise<ResultadoDoRotulo> {
  const workspaceId = params?.workspaceId ?? ''
  const saleId = params?.saleId ?? ''
  if (!workspaceId.trim() || !saleId.trim()) {
    return semRotulo('SEM_ATRIBUICAO_A_PUBLICACAO', 'workspaceId e saleId são obrigatórios juntos.')
  }

  try {
    // 1. AUTORIDADE ÚNICA, antes de qualquer coisa.
    const veredito = await avaliarVendaParaOperacaoReal(workspaceId, saleId)
    if (!veredito?.elegivel) {
      return semRotulo(
        'VENDA_NAO_ELEGIVEL',
        `A autoridade recusou esta venda: ${veredito?.motivos?.join(', ') ?? 'venda não encontrada'}.`
      )
    }

    // 2. A CADEIA, e só ela.
    const venda = await prisma.sale.findFirst({
      where: { id: saleId, workspaceId },
      select: {
        amount: true,
        clickEvent: { select: { link: { select: { publicacaoId: true } } } },
        commissions: { select: { status: true, expectedAmount: true, confirmedAmount: true, receivedAmount: true } },
      },
    })
    const publicacaoId = venda?.clickEvent?.link?.publicacaoId ?? null
    if (!publicacaoId) {
      return semRotulo(
        'SEM_ATRIBUICAO_A_PUBLICACAO',
        'Venda elegível, mas sem clique atribuído a uma publicação. A receita é real; o criativo fica desconhecido.'
      )
    }

    const amostra = await prisma.mLFeatureSnapshot.findFirst({
      where: {
        workspaceId,
        entityType: ENTIDADE_PUBLICACAO,
        entityId: publicacaoId,
        featureVersion: FEATURE_VERSION_PUBLICACAO,
      },
      select: { id: true },
    })
    if (!amostra) {
      // Publicação anterior à geração nova. Nenhuma amostra é criada agora:
      // as features de hoje não são as do dia da distribuição.
      return semRotulo(
        'SEM_AMOSTRA',
        'Não há amostra desta geração para a publicação atribuída. Criar uma agora usaria o estado ATUAL do conteúdo.',
        publicacaoId
      )
    }

    // 3. O label sai das vendas ATRIBUÍDAS a esta publicação, todas elas.
    const label = await montarLabelDaPublicacao(workspaceId, publicacaoId, params?.agora ?? new Date())

    await prisma.mLFeatureSnapshot.update({
      where: { id: amostra.id },
      data: { label: label as never, labeledAt: new Date(label.labeledAt) },
    })

    return {
      rotulado: true,
      motivo: 'ROTULADO',
      snapshotId: amostra.id,
      publicacaoId,
      explicacao: `Publicação ${publicacaoId} rotulada como convertida a partir de venda atribuída pelo clique.`,
    }
  } catch (e) {
    console.error(`[ml-publicacao] falha ao rotular positivo da venda ${saleId}:`, e)
    return semRotulo('SEM_ATRIBUICAO_A_PUBLICACAO', 'Falha ao rotular a amostra.')
  }
}

/** Monta o label somando as vendas ELEGÍVEIS atribuídas à publicação. */
export async function montarLabelDaPublicacao(
  workspaceId: string,
  publicacaoId: string,
  agora: Date = new Date()
): Promise<LabelDeOperacaoReal> {
  const vendas = await prisma.sale.findMany({
    where: { workspaceId, clickEvent: { link: { publicacaoId } } },
    select: {
      id: true,
      amount: true,
      commissions: { select: { status: true, expectedAmount: true, confirmedAmount: true, receivedAmount: true } },
    },
  })

  let valorBrutoVendas = 0
  let comissaoEsperada = 0
  let comissaoConfirmada = 0
  let comissaoRecebida = 0
  let elegiveis = 0

  for (const v of vendas) {
    const veredito = await avaliarVendaParaOperacaoReal(workspaceId, v.id)
    if (!veredito?.elegivel) continue
    elegiveis += 1
    valorBrutoVendas += typeof v.amount === 'number' ? v.amount : 0
    for (const c of v.commissions ?? []) {
      comissaoEsperada += typeof c.expectedAmount === 'number' ? c.expectedAmount : 0
      if (c.status === 'CONFIRMED' || c.status === 'RECEIVED') {
        comissaoConfirmada += typeof c.confirmedAmount === 'number' ? c.confirmedAmount : 0
      }
      if (c.status === 'RECEIVED') {
        comissaoRecebida += typeof c.receivedAmount === 'number' ? c.receivedAmount : 0
      }
    }
  }

  return {
    converted: elegiveis > 0,
    vendasElegiveis: elegiveis,
    valorBrutoVendas,
    comissaoEsperada,
    comissaoConfirmada,
    comissaoRecebida,
    receitaRealizada: comissaoRecebida,
    // Nesta geração TODA venda contada veio por clique — é a condição de
    // entrada. Por isso `semClique` é sempre 0, e é um zero medido.
    atribuicaoDeClique: { comClique: elegiveis, semClique: 0 },
    rastreamentoDeClique: 'RASTREADA',
    origemDoLabel: 'SALE_COMMISSION_COMPROVADA',
    featureVersion: FEATURE_VERSION_PUBLICACAO,
    labeledAt: agora.toISOString(),
  }
}

/**
 * NEGATIVO — só quando TODAS as condições valem ao mesmo tempo.
 *
 * Distribuída, rastreada, janela encerrada, nenhuma venda elegível
 * atribuída, e nenhuma venda em estado aberto que possa virar uma.
 *
 * `NAO_RASTREADA_COM_FALLBACK` NUNCA vira negativo: ali o clique não era
 * observável, então ausência de clique não é evidência de nada.
 */
export async function rotularNegativoDaPublicacao(params: {
  workspaceId: string
  publicacaoId: string
  agora?: Date
  env?: Record<string, string | undefined>
}): Promise<ResultadoDoRotulo> {
  const workspaceId = params?.workspaceId ?? ''
  const publicacaoId = params?.publicacaoId ?? ''
  const agora = params?.agora ?? new Date()
  const politica = lerPoliticaDeObservacao(params?.env ?? process.env)

  if (!workspaceId.trim() || !publicacaoId.trim()) {
    return semRotulo('SEM_AMOSTRA', 'workspaceId e publicacaoId são obrigatórios juntos.')
  }

  try {
    const pub = await prisma.publicacao.findFirst({
      where: { id: publicacaoId, workspaceId },
      select: {
        estado: true,
        distribuidaEm: true,
        contentId: true,
        link: { select: { id: true, createdAt: true } },
      },
    })
    if (!pub) return semRotulo('SEM_AMOSTRA', 'Publicação não encontrada neste workspace.')

    if (pub.estado !== 'DISTRIBUIDA' || !pub.distribuidaEm) {
      return semRotulo('SEM_DISTRIBUICAO_COMPROVADA', 'Publicação sem distribuição comprovada nunca vira negativo.', publicacaoId)
    }

    // A TRAVA CENTRAL desta etapa.
    const estadoDeRastreamento = derivarEstadoDaPublicacaoPersistida({
      estado: pub.estado,
      distribuidaEm: pub.distribuidaEm,
      link: pub.link ? { criadoEm: pub.link.createdAt } : null,
    })
    if (estadoDeRastreamento !== 'RASTREADA') {
      return semRotulo(
        'NAO_RASTREADA',
        'Publicação sem rastreamento: o clique dela nunca foi observável, então ausência de clique não prova nada.',
        publicacaoId
      )
    }

    const amostra = await prisma.mLFeatureSnapshot.findFirst({
      where: {
        workspaceId,
        entityType: ENTIDADE_PUBLICACAO,
        entityId: publicacaoId,
        featureVersion: FEATURE_VERSION_PUBLICACAO,
      },
      select: { id: true, labeledAt: true, capturedAt: true },
    })
    if (!amostra) {
      return semRotulo('SEM_AMOSTRA', 'Não há amostra desta geração para esta publicação.', publicacaoId)
    }
    if (amostra.labeledAt) {
      return semRotulo('JA_ROTULADO', 'Esta amostra já tem rótulo.', publicacaoId, amostra.id)
    }

    if (!janelaEncerrada(amostra.capturedAt, agora, politica.dias)) {
      return semRotulo(
        'JANELA_ABERTA',
        `A janela de ${politica.dias} dias contados da distribuição ainda não terminou.`,
        publicacaoId,
        amostra.id
      )
    }

    // Qualquer venda não cancelada ligada ao link desta publicação cria
    // dúvida — resolvida ou não, declarar "não converteu" afirmaria mais do
    // que se sabe.
    const vendasLigadas = await prisma.sale.findMany({
      where: {
        workspaceId,
        status: { not: 'CANCELLED' },
        clickEvent: { link: { publicacaoId } },
      },
      select: { id: true },
    })
    if (vendasLigadas.length > 0) {
      return semRotulo(
        'RESULTADO_EM_DUVIDA',
        `Há ${vendasLigadas.length} venda(s) não cancelada(s) atribuída(s) a esta publicação.`,
        publicacaoId,
        amostra.id
      )
    }

    const label: LabelDeOperacaoReal = {
      converted: false,
      vendasElegiveis: 0,
      valorBrutoVendas: 0,
      comissaoEsperada: 0,
      comissaoConfirmada: 0,
      comissaoRecebida: 0,
      receitaRealizada: 0,
      // Zero MEDIDO: a publicação era rastreada, e nada passou pelo redirect.
      atribuicaoDeClique: { comClique: 0, semClique: 0 },
      rastreamentoDeClique: 'RASTREADA',
      origemDoLabel: 'JANELA_DE_OBSERVACAO_ENCERRADA',
      featureVersion: FEATURE_VERSION_PUBLICACAO,
      labeledAt: agora.toISOString(),
    }

    await prisma.mLFeatureSnapshot.update({
      where: { id: amostra.id },
      data: { label: label as never, labeledAt: agora },
    })

    return {
      rotulado: true,
      motivo: 'ROTULADO',
      snapshotId: amostra.id,
      publicacaoId,
      explicacao: `Publicação ${publicacaoId} rotulada como NÃO convertida após ${politica.dias} dias de observação rastreada.`,
    }
  } catch (e) {
    console.error(`[ml-publicacao] falha ao rotular negativo da publicação ${publicacaoId}:`, e)
    return semRotulo('SEM_AMOSTRA', 'Falha ao rotular a amostra.', publicacaoId)
  }
}

/** Fecha as janelas vencidas desta geração. Chamado pelo cron. */
export async function fecharJanelasDePublicacao(params?: {
  workspaceId?: string
  agora?: Date
  env?: Record<string, string | undefined>
}): Promise<{ avaliadas: number; rotuladas: number; motivos: Record<string, number> }> {
  const agora = params?.agora ?? new Date()
  const motivos: Record<string, number> = {}
  let avaliadas = 0
  let rotuladas = 0

  const pendentes = await prisma.mLFeatureSnapshot.findMany({
    where: {
      ...(params?.workspaceId ? { workspaceId: params.workspaceId } : {}),
      entityType: ENTIDADE_PUBLICACAO,
      featureVersion: FEATURE_VERSION_PUBLICACAO,
      labeledAt: null,
      dataOrigin: 'REAL_OPERATION',
    },
    select: { workspaceId: true, entityId: true },
  })

  for (const p of pendentes) {
    if (!p.entityId) continue
    avaliadas++
    const r = await rotularNegativoDaPublicacao({
      workspaceId: p.workspaceId,
      publicacaoId: p.entityId,
      agora,
      env: params?.env,
    })
    motivos[r.motivo] = (motivos[r.motivo] ?? 0) + 1
    if (r.rotulado) rotuladas++
  }

  return { avaliadas, rotuladas, motivos }
}
