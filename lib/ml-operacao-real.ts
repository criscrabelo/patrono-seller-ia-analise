/**
 * Ligação segura da operação real ao Feature Store (P0.2 — Bloco 4).
 *
 * ── A SEQUÊNCIA, E SÓ ELA ───────────────────────────────────────────────
 *   Sale comprovada → autoridade → features → snapshot → label → ML
 *
 * Nunca o inverso. Nenhum snapshot de produção nasce sem que
 * `avaliarVendaParaOperacaoReal()` tenha dito sim primeiro.
 *
 * ── AUTORIDADE ÚNICA ────────────────────────────────────────────────────
 * Este módulo NÃO tem a sua própria versão da regra de elegibilidade. Ele
 * pergunta à autoridade do Bloco 3 e obedece — inclusive quando a resposta
 * é não. Se ela devolver `null` ou `elegivel: false`, nada é escrito e o
 * motivo é propagado como veio. Não há "completar com inferência".
 *
 * ── ENTIDADE: `Conteudo` ────────────────────────────────────────────────
 * A amostra de conversão é ligada ao CONTEÚDO, não à venda. Três razões, e
 * as três vêm do código que já existe:
 *
 *  1. `ContentMLFeatures` descreve o criativo — hook, CTA, duração, canal,
 *     horário, faixa de preço do produto. É a decisão que o modelo apoia:
 *     "que conteúdo produzir e publicar".
 *  2. `MLReadinessGate` já conta por `entityType = 'Conteudo'` (default de
 *     `contarAmostrasRotuladas`).
 *  3. `Sale.contentId` é o vínculo real do funil
 *     Produto → Conteudo → Sale → Commission.
 *
 * A VENDA é o resultado; as features têm de descrever o que existia ANTES
 * dele. Ligar a amostra à venda inverteria isso.
 *
 * CONSEQUÊNCIA HONESTA: venda elegível SEM `contentId` não produz amostra.
 * Não há criativo a que atribuir o aprendizado, e inventar um seria pior
 * que não ter a amostra.
 *
 * ── SEM VAZAMENTO DE RESULTADO ──────────────────────────────────────────
 * As features saem de `extrairFeaturesDeConteudo()`, que já corta no
 * `referenceDate` (publicação, ou criação se não publicado). Aqui somamos
 * duas travas: `capturedAt` é gravado COMO o `referenceDate` — o instante
 * que as features descrevem, sempre anterior ao `labeledAt` — e
 * `verificarSemVazamentoDeResultado()` recusa qualquer feature cujo nome
 * remeta a venda, comissão ou receita.
 */

import { prisma } from './prisma'
import { FEATURE_VERSION } from './ml-feature-store'
import { avaliarVendaParaOperacaoReal, type VereditoDeOperacaoReal } from './real-operation'
// O modulo de rastreamento carrega `avaliarDistribuicaoReal` sob demanda,
// entao este import estatico nao fecha ciclo.
import {
  avaliarRastreamentoDoConteudo,
  type EstadoDeRastreamento,
} from './rastreamento-da-publicacao'

export const ENTIDADE_DA_AMOSTRA = 'Conteudo' as const

export const MOTIVOS_BLOQUEIO_ML = [
  /** A autoridade não encontrou a venda neste workspace. */
  'VENDA_NAO_ENCONTRADA',
  /** A autoridade disse não. Os motivos dela vêm em `motivosDaAutoridade`. */
  'VENDA_NAO_ELEGIVEL',
  /** Venda elegível, mas sem conteúdo — não há criativo a que atribuir. */
  'VENDA_SEM_CONTEUDO',
  /** O conteúdo não existe neste workspace, ou não deu para extrair features. */
  'FEATURES_INDISPONIVEIS',
  /**
   * Não há amostra capturada na publicação deste conteúdo (Bloco 4.1).
   * NUNCA criamos uma agora: as features seriam reextraídas do conteúdo
   * como ele está HOJE, que pode ter sido editado desde a publicação.
   */
  'SEM_AMOSTRA_CAPTURADA',
] as const

export type MotivoBloqueioML = (typeof MOTIVOS_BLOQUEIO_ML)[number]

/**
 * Nomes que NUNCA podem aparecer numa feature de entrada: descrevem o
 * resultado, e o resultado é o que o modelo deve prever, não receber.
 */
const PADROES_DE_VAZAMENTO = [
  /sale/i,
  /venda/i,
  /commission/i,
  /comissao|comissão/i,
  /revenue|receita/i,
  /converted|conversao_real/i,
  /amount|valor_/i,
  /label/i,
]

/**
 * Nomes que PARECEM resultado mas não são, e por isso passam.
 *
 * `commission_percentage` é a TAXA oferecida pela oferta — atributo do
 * produto, conhecido antes de qualquer venda. É coisa diferente de
 * `commission_amount`, que é o resultado. Tratar as duas como a mesma
 * palavra proibiria uma feature legítima e importante.
 */
const EXCECOES_LEGITIMAS = new Set(['commission_percentage'])

export function verificarSemVazamentoDeResultado(features: Record<string, unknown>): void {
  for (const chave of Object.keys(features ?? {})) {
    if (EXCECOES_LEGITIMAS.has(chave)) continue
    for (const padrao of PADROES_DE_VAZAMENTO) {
      if (padrao.test(chave)) {
        throw new Error(
          `Feature "${chave}" descreve o resultado e não pode entrar como entrada do modelo (data leakage).`
        )
      }
    }
  }
}

// ── Label ───────────────────────────────────────────────────────────────

export interface VendaElegivelParaLabel {
  saleId: string
  /** Valor bruto da venda. `null` quando não informado. */
  amount: number | null
  /** `null` quando a venda não teve atribuição de clique confiável. */
  clickEventId: string | null
  commissions: Array<{
    status: string
    expectedAmount: number | null
    confirmedAmount: number | null
    receivedAmount: number | null
  }>
}

/**
 * Label de uma amostra de produção.
 *
 * Os três estágios da comissão ficam SEPARADOS de propósito.
 * `expectedAmount` é previsão — tratá-lo como dinheiro em caixa é o erro
 * clássico de métrica de afiliado. Quem precisar de receita efetivamente
 * realizada usa `receitaRealizada`, que é só o RECEIVED.
 */
export interface LabelDeOperacaoReal {
  converted: boolean
  vendasElegiveis: number
  valorBrutoVendas: number
  comissaoEsperada: number
  comissaoConfirmada: number
  comissaoRecebida: number
  /** Receita EFETIVA. Igual a `comissaoRecebida`, nunca à esperada. */
  receitaRealizada: number
  /**
   * As duas metades NÃO têm o mesmo estatuto, e é por isso que só uma delas
   * pode virar `null`:
   *
   * `comClique` é evidência POSITIVA — a venda tem `clickEventId`, o clique
   * existiu e foi registrado. Vale sempre, rastreada a publicação ou não.
   *
   * `semClique` é uma AUSÊNCIA. Numa publicação rastreada, ausência de
   * clique é medição: o post levava `/api/l/{slug}` e nada passou por ele.
   * Numa publicação com link direto, ausência não é medição nenhuma — o
   * clique pode ter acontecido e simplesmente não ter como ser visto. Aí
   * vira `null`, nunca `0`.
   */
  atribuicaoDeClique: { comClique: number; semClique: number | null }
  /**
   * Estado de rastreamento da publicação que originou a amostra.
   *
   * REGRA OBRIGATÓRIA (P1.0 Etapa 2.a): só `RASTREADA` autoriza ler ausência
   * de `EventoLink` como ausência de clique. Fora disso o clique é
   * DESCONHECIDO, e quem treinar precisa saber disso pelo próprio rótulo.
   */
  rastreamentoDeClique: EstadoDeRastreamento
  /** De onde o label veio. Nunca inferência, nunca modelo. */
  origemDoLabel: 'SALE_COMMISSION_COMPROVADA' | 'JANELA_DE_OBSERVACAO_ENCERRADA'
  featureVersion: string
  /** Quando o resultado passou a ser conhecido. Sempre > `capturedAt`. */
  labeledAt: string
}

function numero(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/**
 * FUNÇÃO PURA. Recebe só vendas JÁ APROVADAS pela autoridade — montar label
 * a partir de venda não elegível contaminaria a amostra de produção com
 * dado `USER_REPORTED`.
 */
export function montarLabelDeOperacaoReal(
  vendas: VendaElegivelParaLabel[],
  agora: Date = new Date(),
  /**
   * Fail-closed: sem saber se a publicação foi rastreada, assume que NÃO
   * foi. Perder a contagem de clique de uma amostra custa menos que
   * afirmar zero clique num post que ninguém conseguiu medir.
   */
  rastreamento: EstadoDeRastreamento = 'NAO_RASTREADA_COM_FALLBACK'
): LabelDeOperacaoReal {
  const lista = Array.isArray(vendas) ? vendas : []
  let valorBrutoVendas = 0
  let comissaoEsperada = 0
  let comissaoConfirmada = 0
  let comissaoRecebida = 0
  let comClique = 0
  let semClique = 0

  for (const venda of lista) {
    valorBrutoVendas += numero(venda?.amount)
    // Clique ausente é registrado como ausente, nunca inventado.
    if (typeof venda?.clickEventId === 'string' && venda.clickEventId.trim() !== '') comClique += 1
    else semClique += 1

    for (const c of venda?.commissions ?? []) {
      comissaoEsperada += numero(c?.expectedAmount)
      // Confirmada só conta quando o estado diz que foi confirmada.
      if (c?.status === 'CONFIRMED' || c?.status === 'RECEIVED') {
        comissaoConfirmada += numero(c?.confirmedAmount)
      }
      // Recebida só conta em RECEIVED. É o único estágio que é dinheiro.
      if (c?.status === 'RECEIVED') {
        comissaoRecebida += numero(c?.receivedAmount)
      }
    }
  }

  return {
    converted: lista.length > 0,
    vendasElegiveis: lista.length,
    valorBrutoVendas,
    comissaoEsperada,
    comissaoConfirmada,
    comissaoRecebida,
    receitaRealizada: comissaoRecebida,
    atribuicaoDeClique: {
      comClique,
      // Fora de RASTREADA a ausência de clique não foi medida — foi
      // impossível de medir.
      semClique: rastreamento === 'RASTREADA' ? semClique : null,
    },
    rastreamentoDeClique: rastreamento,
    origemDoLabel: 'SALE_COMMISSION_COMPROVADA',
    featureVersion: FEATURE_VERSION,
    labeledAt: agora.toISOString(),
  }
}

// ── Orquestração ────────────────────────────────────────────────────────

export interface ResultadoDeRegistroML {
  registrado: boolean
  motivo: MotivoBloqueioML | null
  /** Motivos da autoridade, propagados como vieram. */
  motivosDaAutoridade: string[]
  explicacao: string
  snapshotId: string | null
  /** `false` quando a amostra já existia — idempotência, não erro. */
  criado: boolean
  workspaceId: string
  saleId: string
  contentId: string | null
  label: LabelDeOperacaoReal | null
  veredito: VereditoDeOperacaoReal | null
}

/**
 * Chave de idempotência da amostra.
 *
 * `MLFeatureSnapshot` NÃO tem constraint única hoje, e
 * `salvarFeatureSnapshot()` sempre criava linha nova. Em vez de inventar uma
 * segunda convenção, adotamos a que o próprio schema já sugere e que o
 * `MLReadinessGate` já usa para contar:
 *
 *     workspaceId + entityType + entityId + featureVersion
 *
 * Serializada por advisory lock dentro da transação — mesmo padrão já usado
 * na reserva de orçamento (P0.1) e na promoção (Bloco 3.1). Sem migration:
 * webhook repetido, comissão reprocessada, worker reexecutado e Autopilot
 * rodando de novo convergem na MESMA linha.
 */
export function chaveDaAmostra(p: {
  workspaceId: string
  entityId: string
  featureVersion?: string
}): string {
  return [p.workspaceId, ENTIDADE_DA_AMOSTRA, p.entityId, p.featureVersion ?? FEATURE_VERSION].join('|')
}

function bloquear(
  base: { workspaceId: string; saleId: string },
  motivo: MotivoBloqueioML,
  explicacao: string,
  veredito: VereditoDeOperacaoReal | null = null,
  contentId: string | null = null
): ResultadoDeRegistroML {
  console.warn(`[ml-operacao-real] amostra NÃO criada (${motivo}) venda=${base.saleId}: ${explicacao}`)
  return {
    registrado: false,
    motivo,
    motivosDaAutoridade: veredito?.motivos ?? [],
    explicacao,
    snapshotId: null,
    criado: false,
    workspaceId: base.workspaceId,
    saleId: base.saleId,
    contentId,
    label: null,
    veredito,
  }
}

/**
 * Reúne as vendas do conteúdo que a AUTORIDADE aprova.
 *
 * Um conteúdo pode ter várias vendas, e nem todas elegíveis. Somar as não
 * elegíveis colocaria valor de venda `USER_REPORTED` dentro de um label de
 * produção — exatamente o que toda a cadeia do P0.2 impede.
 */
async function vendasElegiveisDoConteudo(
  workspaceId: string,
  contentId: string
): Promise<VendaElegivelParaLabel[]> {
  const candidatas = await prisma.sale.findMany({
    where: { workspaceId, contentId },
    select: {
      id: true,
      amount: true,
      clickEventId: true,
      commissions: {
        select: { status: true, expectedAmount: true, confirmedAmount: true, receivedAmount: true },
      },
    },
  })

  const elegiveis: VendaElegivelParaLabel[] = []
  for (const venda of candidatas) {
    const veredito = await avaliarVendaParaOperacaoReal(workspaceId, venda.id)
    if (!veredito?.elegivel) continue
    elegiveis.push({
      saleId: venda.id,
      amount: venda.amount,
      clickEventId: venda.clickEventId,
      commissions: venda.commissions,
    })
  }
  return elegiveis
}

/**
 * Único ponto do sistema que escreve amostra de PRODUÇÃO no Feature Store.
 *
 * Idempotente: chamar de novo para a mesma venda/conteúdo reaproveita a
 * amostra existente e apenas reatualiza o label com os fatos atuais.
 */
export async function registrarOperacaoRealNoFeatureStore(params: {
  workspaceId: string
  saleId: string
  agora?: Date
}): Promise<ResultadoDeRegistroML> {
  const base = { workspaceId: params?.workspaceId ?? '', saleId: params?.saleId ?? '' }
  if (!base.workspaceId || !base.saleId) {
    return bloquear(base, 'VENDA_NAO_ENCONTRADA', 'workspaceId e saleId são obrigatórios juntos.')
  }

  // 1) AUTORIDADE ÚNICA — antes de qualquer coisa.
  const veredito = await avaliarVendaParaOperacaoReal(base.workspaceId, base.saleId)
  if (!veredito) {
    return bloquear(base, 'VENDA_NAO_ENCONTRADA', 'Venda não encontrada neste workspace.')
  }
  if (!veredito.elegivel) {
    return bloquear(
      base,
      'VENDA_NAO_ELEGIVEL',
      `A autoridade recusou esta venda: ${veredito.motivos.join(', ')}.`,
      veredito
    )
  }

  // 2) A amostra é do CONTEÚDO. Sem conteúdo não há criativo a aprender.
  const venda = await prisma.sale.findFirst({
    where: { id: base.saleId, workspaceId: base.workspaceId },
    select: { contentId: true },
  })
  const contentId = venda?.contentId ?? null
  if (!contentId) {
    return bloquear(
      base,
      'VENDA_SEM_CONTEUDO',
      'Venda elegível, mas sem conteúdo associado — não há criativo a que atribuir o aprendizado, e inventar um seria pior que não ter a amostra.',
      veredito
    )
  }

  // 3) Label a partir SÓ das vendas que a autoridade aprova.
  const elegiveis = await vendasElegiveisDoConteudo(base.workspaceId, contentId)
  // O estado de rastreamento entra no rotulo. Sem ele, uma amostra vinda de
  // publicacao com link direto afirmaria "nenhuma venda teve clique" quando
  // o certo e "nao da para saber": o clique nao passou pelo redirect.
  const rastreamento = await avaliarRastreamentoDoConteudo({
    workspaceId: base.workspaceId,
    contentId,
  })
  const label = montarLabelDeOperacaoReal(elegiveis, params.agora ?? new Date(), rastreamento.estado)

  // 4) Rotulagem da amostra JÁ CAPTURADA na publicação.
  //
  // Esta função NUNCA cria snapshot (correção do Bloco 4.1). Criar aqui
  // significaria reextrair as features do conteúdo como ele está HOJE —
  // possivelmente editado desde a publicação — e gravar isso como se fosse
  // a observação do momento em que ele foi ao ar. A captura acontece em
  // `ml-captura-publicacao.ts`, na publicação.
  const chave = chaveDaAmostra({ workspaceId: base.workspaceId, entityId: contentId })

  const alvo = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtext(${chave}))) AS trava`

    const existente = await tx.mLFeatureSnapshot.findFirst({
      where: {
        workspaceId: base.workspaceId,
        entityType: ENTIDADE_DA_AMOSTRA,
        entityId: contentId,
        featureVersion: FEATURE_VERSION,
      },
      select: { id: true },
    })
    if (!existente) return null

    // SÓ o rótulo. `features`, `capturedAt` e `dataOrigin` nunca são
    // tocados: a observação histórica é imutável, e uma amostra de teste
    // jamais vira de produção por reprocessamento.
    await tx.mLFeatureSnapshot.update({
      where: { id: existente.id },
      data: { label: label as never, labeledAt: new Date(label.labeledAt) },
    })
    return existente.id
  })

  if (!alvo) {
    return bloquear(
      base,
      'SEM_AMOSTRA_CAPTURADA',
      `Não há amostra capturada na publicação do conteúdo ${contentId}. Criar uma agora usaria as features atuais, que podem ter sido editadas — a lacuna fica registrada em vez de preenchida com palpite.`,
      veredito,
      contentId
    )
  }

  return {
    registrado: true,
    motivo: null,
    motivosDaAutoridade: [],
    explicacao: `Amostra do conteúdo ${contentId} rotulada como conversão real a partir da venda comprovada ${base.saleId}.`,
    snapshotId: alvo,
    criado: false,
    workspaceId: base.workspaceId,
    saleId: base.saleId,
    contentId,
    label,
    veredito,
  }
}
