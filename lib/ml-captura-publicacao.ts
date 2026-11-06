/**
 * Captura prospectiva + rotulagem negativa (P0.2 — Bloco 4.1).
 *
 * ── O QUE MUDA EM RELAÇÃO AO BLOCO 4 ────────────────────────────────────
 * O Bloco 4 criava a amostra QUANDO A VENDA CHEGAVA, reextraindo as
 * features do conteúdo naquele momento. Duas consequências ruins:
 *
 *  1. as features descreviam o conteúdo COMO ELE ESTÁ HOJE, não como estava
 *     quando foi publicado — se a proprietária editou o hook depois, a
 *     observação histórica era reescrita em silêncio;
 *  2. só existiam amostras positivas, porque nada acontecia quando um
 *     conteúdo era publicado e não convertia.
 *
 * Agora a ordem é a correta:
 *
 *   conteúdo publicado → captura features → snapshot SEM label
 *                      → resultado futuro → label (positivo ou negativo)
 *
 * ── IMUTABILIDADE ───────────────────────────────────────────────────────
 * Depois de capturada, uma amostra NUNCA tem as features reescritas. O
 * rótulo é a única coisa que muda. Uma observação histórica que se altera
 * depois não é observação, é opinião atual disfarçada de dado.
 *
 * ── CONTEÚDO LEGADO ─────────────────────────────────────────────────────
 * Conteúdo publicado ANTES desta rodada não tem snapshot, e não há como
 * criar um honestamente: `Conteudo` não guarda histórico de revisões, então
 * qualquer reconstrução usaria campos que podem ter sido editados. A lacuna
 * é registrada (`listarLacunasDeCaptura`) em vez de preenchida com palpite.
 */

import { prisma } from './prisma'
import { FEATURE_VERSION, extrairFeaturesDeConteudo } from './ml-feature-store'
import { verificarSemDadosBiometricos } from './ml-privacy'
import {
  ENTIDADE_DA_AMOSTRA,
  chaveDaAmostra,
  verificarSemVazamentoDeResultado,
  type LabelDeOperacaoReal,
} from './ml-operacao-real'
import { avaliarVendaParaOperacaoReal } from './real-operation'
import {
  avaliarRastreamentoDoConteudo,
  type EstadoDeRastreamento,
} from './rastreamento-da-publicacao'

// ── Janela de observação ────────────────────────────────────────────────

/**
 * POLÍTICA INTERNA DO PATRONO — não é regra de provider.
 *
 * Nenhum provider integrado hoje publica uma janela oficial de atribuição
 * para o Patrono. Apresentar um número interno como se fosse "a janela do
 * TikTok" produziria um dado que parece oficial e não é.
 *
 * 30 dias é uma escolha conservadora: cobre com folga as janelas típicas de
 * programas de afiliado e erra para o lado de esperar mais antes de declarar
 * que um conteúdo não converteu. Rotular negativo cedo demais ensinaria ao
 * modelo que um criativo falhou quando ele só ainda não tinha dado retorno.
 *
 * Configurável por `ML_CONVERSION_OBSERVATION_WINDOW_DAYS`. Quando um
 * provider publicar a regra dele, ela entra como política PRÓPRIA daquele
 * provider, nunca substituindo esta em silêncio.
 */
export const JANELA_OBSERVACAO_PADRAO_DIAS = 30

export interface PoliticaDeObservacao {
  dias: number
  origem: 'PADRAO_INTERNO' | 'CONFIGURADO'
  /** Sempre `false` nesta fase: nenhum provider forneceu regra oficial. */
  oficialDeProvider: boolean
}

export function lerPoliticaDeObservacao(
  env: Record<string, string | undefined> = process.env
): PoliticaDeObservacao {
  const bruto = env.ML_CONVERSION_OBSERVATION_WINDOW_DAYS
  if (bruto !== undefined && bruto.trim() !== '') {
    const valor = Number(bruto)
    if (Number.isFinite(valor) && valor > 0) {
      return { dias: valor, origem: 'CONFIGURADO', oficialDeProvider: false }
    }
  }
  return { dias: JANELA_OBSERVACAO_PADRAO_DIAS, origem: 'PADRAO_INTERNO', oficialDeProvider: false }
}

export function janelaEncerrada(
  dataPublicacao: Date | null | undefined,
  agora: Date,
  dias: number
): boolean {
  if (!(dataPublicacao instanceof Date) || !Number.isFinite(dataPublicacao.getTime())) return false
  const fim = dataPublicacao.getTime() + dias * 24 * 60 * 60 * 1000
  return agora.getTime() >= fim
}

// ── Captura na publicação ───────────────────────────────────────────────

/**
 * DISTRIBUIÇÃO REAL — o núcleo desta revisão.
 *
 * ── O PROBLEMA ──────────────────────────────────────────────────────────
 * `Conteudo.status = 'publicado'` NÃO prova que alguém viu o conteúdo. O
 * sistema marca como publicado em situações puramente internas: conteúdo
 * agendado sem vídeo ao abrir a listagem, ou conteúdo cujo Instagram não
 * está conectado. Nesses casos nada saiu do Patrono.
 *
 * Se uma dessas amostras entrasse no dataset, trinta dias depois ela viraria
 * um NEGATIVO — ensinando ao modelo que aquele criativo não converteu,
 * quando na verdade ele nunca chegou a existir para o público. É o pior tipo
 * de erro de rótulo: parece dado e é ruído.
 *
 * ── A REGRA, NO CORE ────────────────────────────────────────────────────
 * O que caracteriza distribuição real é um IDENTIFICADOR EXTERNO devolvido
 * pelo canal — `Conteudo.publicacaoExternaId`. É o recibo: o provider
 * aceitou a publicação e deu um id para ela.
 *
 * A regra fica AQUI, no core, não no adaptador do Instagram. Hoje quem
 * preenche esse campo é o Instagram (`publicarContainer() → mediaId`), mas
 * TikTok, Shopee, Amazon e qualquer canal futuro usam o mesmo contrato:
 * devolveu id, houve distribuição. O provider fornece a evidência; quem
 * decide o que conta como evidência é o core.
 */
export const MOTIVOS_CAPTURA = [
  'CAPTURADO',
  /** Já havia amostra desta versão de features para este conteúdo. */
  'JA_CAPTURADO',
  'CONTEUDO_NAO_ENCONTRADO',
  /**
   * Marcado como publicado DENTRO do app, sem recibo de nenhum canal.
   * Não é erro: é o estado normal de conteúdo que ainda não circulou.
   */
  'SEM_DISTRIBUICAO_COMPROVADA',
  'FEATURES_INDISPONIVEIS',
] as const

export type MotivoCaptura = (typeof MOTIVOS_CAPTURA)[number]

export interface EvidenciaDeDistribuicao {
  distribuida: boolean
  /** Id devolvido pelo canal. `null` quando não houve distribuição. */
  identificadorExterno: string | null
  /**
   * Instante em que o conteúdo entrou em circulação. É ESTE o marco da
   * amostra e o início da janela de observação — não o instante em que
   * alguém abriu uma tela ou o cron passou.
   */
  distribuidoEm: Date | null
  explicacao: string
}

/**
 * FUNÇÃO PURA. Decide se um conteúdo foi realmente distribuído.
 *
 * `status === 'publicado'` de propósito NÃO entra na conta: é justamente o
 * sinal ambíguo que esta revisão veio separar.
 */
export function avaliarDistribuicaoReal(conteudo: {
  publicacaoExternaId?: string | null
  dataPublicacao?: Date | null
}): EvidenciaDeDistribuicao {
  const id = typeof conteudo?.publicacaoExternaId === 'string' ? conteudo.publicacaoExternaId.trim() : ''
  if (!id) {
    return {
      distribuida: false,
      identificadorExterno: null,
      distribuidoEm: null,
      explicacao:
        'Nenhum canal devolveu identificador de publicação. O conteúdo pode estar marcado como publicado dentro do app, mas não há prova de que circulou.',
    }
  }
  const quando = conteudo?.dataPublicacao
  if (!(quando instanceof Date) || !Number.isFinite(quando.getTime())) {
    return {
      distribuida: false,
      identificadorExterno: id,
      distribuidoEm: null,
      explicacao:
        'Há identificador externo, mas não há data de publicação — sem o instante da distribuição não dá para datar a amostra nem contar a janela.',
    }
  }
  return {
    distribuida: true,
    identificadorExterno: id,
    distribuidoEm: quando,
    explicacao: `Distribuição confirmada pelo canal (id externo ${id}).`,
  }
}

export interface ResultadoDaCaptura {
  capturado: boolean
  motivo: MotivoCaptura
  snapshotId: string | null
  workspaceId: string
  contentId: string
  explicacao: string
}

/**
 * Captura a amostra no instante da publicação — SEM label.
 *
 * Idempotente pela mesma chave do Bloco 4
 * (`workspaceId + Conteudo + contentId + featureVersion`): publicar o mesmo
 * conteúdo duas vezes, ou o cron reprocessar, converge na mesma linha.
 *
 * NUNCA lança: publicação real não pode falhar porque o ML não conseguiu
 * observar. O erro vai para o log e a lacuna fica visível.
 */
export async function capturarSnapshotDePublicacao(params: {
  workspaceId: string
  contentId: string
  agora?: Date
}): Promise<ResultadoDaCaptura> {
  const base = {
    workspaceId: params?.workspaceId ?? '',
    contentId: params?.contentId ?? '',
  }
  const falhar = (motivo: MotivoCaptura, explicacao: string): ResultadoDaCaptura => ({
    capturado: false,
    motivo,
    snapshotId: null,
    ...base,
    explicacao,
  })

  if (!base.workspaceId || !base.contentId) {
    return falhar('CONTEUDO_NAO_ENCONTRADO', 'workspaceId e contentId são obrigatórios juntos.')
  }

  try {
    // ── PORTÃO: sem distribuição comprovada, nenhuma amostra de produção.
    const conteudo = await prisma.conteudo.findFirst({
      where: { id: base.contentId, workspaceId: base.workspaceId },
      select: { publicacaoExternaId: true, dataPublicacao: true },
    })
    if (!conteudo) {
      return falhar('CONTEUDO_NAO_ENCONTRADO', 'Conteúdo não encontrado neste workspace.')
    }

    const evidencia = avaliarDistribuicaoReal(conteudo)
    if (!evidencia.distribuida) {
      // Estado normal, não erro: conteúdo que ainda não circulou simplesmente
      // não entra no dataset. Vira negativo daqui a 30 dias seria ensinar ao
      // modelo que um criativo falhou sem que ninguém o tenha visto.
      return falhar('SEM_DISTRIBUICAO_COMPROVADA', evidencia.explicacao)
    }

    const extraido = await extrairFeaturesDeConteudo(base.workspaceId, base.contentId)
    if (!extraido) {
      return falhar('CONTEUDO_NAO_ENCONTRADO', 'Conteúdo não encontrado neste workspace.')
    }

    const asRecord = extraido.features as unknown as Record<string, unknown>
    verificarSemDadosBiometricos(asRecord)
    verificarSemVazamentoDeResultado(asRecord)

    const chave = chaveDaAmostra({ workspaceId: base.workspaceId, entityId: base.contentId })
    // O marco da amostra é o instante da DISTRIBUIÇÃO, não o instante em que
    // alguém abriu uma tela ou o cron passou. `params.agora` só existe para
    // teste poder fixar o relógio, e mesmo assim perde para a evidência.
    const distribuidoEm = evidencia.distribuidoEm ?? params.agora ?? new Date()

    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtext(${chave}))) AS trava`

      const existente = await tx.mLFeatureSnapshot.findFirst({
        where: {
          workspaceId: base.workspaceId,
          entityType: ENTIDADE_DA_AMOSTRA,
          entityId: base.contentId,
          featureVersion: FEATURE_VERSION,
        },
        select: { id: true },
      })
      if (existente) {
        // Republicação NÃO reescreve a observação original. Ver
        // `LIMITACAO_DE_REVISAO` no fim deste arquivo.
        return {
          capturado: false,
          motivo: 'JA_CAPTURADO' as const,
          snapshotId: existente.id,
          ...base,
          explicacao: 'Já existe amostra desta versão de features para este conteúdo — a observação original é preservada.',
        }
      }

      const novo = await tx.mLFeatureSnapshot.create({
        data: {
          workspaceId: base.workspaceId,
          entityType: ENTIDADE_DA_AMOSTRA,
          entityId: base.contentId,
          featureVersion: FEATURE_VERSION,
          // A publicação não prova nada sobre a venda. A origem da AMOSTRA é
          // a operação real do workspace; o que decide se ela conta é o
          // LABEL, que só chega depois e só pela autoridade.
          dataOrigin: 'REAL_OPERATION',
          features: extraido.features as never,
          capturedAt: distribuidoEm,
          // O resultado ainda não existe. Rotular agora seria inventá-lo.
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
        explicacao: `Amostra capturada na distribuição do conteúdo ${base.contentId} (${evidencia.explicacao}), sem rótulo.`,
      }
    })
  } catch (e) {
    console.error(`[ml-captura] falha ao capturar amostra do conteúdo ${base.contentId}:`, e)
    return falhar('FEATURES_INDISPONIVEIS', e instanceof Error ? e.message : 'Falha ao capturar a amostra.')
  }
}

/**
 * Captura em lote, para os pontos que publicam vários conteúdos de uma vez.
 * Cada falha é isolada: um conteúdo problemático não impede os outros.
 */
export async function capturarSnapshotsDePublicacao(
  workspaceId: string,
  contentIds: string[],
  agora?: Date
): Promise<ResultadoDaCaptura[]> {
  const resultados: ResultadoDaCaptura[] = []
  for (const contentId of contentIds ?? []) {
    resultados.push(await capturarSnapshotDePublicacao({ workspaceId, contentId, agora }))
  }
  return resultados
}

// ── Rotulagem negativa ──────────────────────────────────────────────────

export const MOTIVOS_NEGATIVO = [
  'ROTULADO_NEGATIVO',
  /** A janela de observação ainda não terminou. */
  'JANELA_ABERTA',
  /**
   * Sem prova de que o conteúdo circulou. NUNCA vira negativo: declarar que
   * um criativo não converteu exige antes que ele tenha sido exposto.
   */
  'SEM_DISTRIBUICAO_COMPROVADA',
  /** Não há amostra capturada — conteúdo legado. Nunca criada retroativamente. */
  'SEM_AMOSTRA_CAPTURADA',
  /** A amostra já tem rótulo. */
  'JA_ROTULADO',
  /**
   * Há venda ligada a este conteúdo que não está resolvida — relatada e não
   * comprovada, ou comprovada e ainda sem comissão reconhecida. Declarar
   * "não converteu" aqui seria afirmar mais do que se sabe.
   */
  'RESULTADO_EM_DUVIDA',
] as const

export type MotivoNegativo = (typeof MOTIVOS_NEGATIVO)[number]

export interface ResultadoDoNegativo {
  rotulado: boolean
  motivo: MotivoNegativo
  snapshotId: string | null
  workspaceId: string
  contentId: string
  explicacao: string
}

/**
 * Label de ausência de conversão. Zeros explícitos, nunca `null` disfarçado.
 *
 * Os zeros de VENDA são medidos: a janela fechou e nenhuma venda apareceu.
 * A ausência de CLIQUE não: se a publicação saiu com link direto, o clique
 * dela nunca chegou a ser observável. Por isso `semClique` vira `null` fora
 * de `RASTREADA`, em vez de `0`.
 */
export function montarLabelNegativo(
  agora: Date = new Date(),
  /** Fail-closed: sem saber, assume que a publicação NÃO foi rastreada. */
  rastreamento: EstadoDeRastreamento = 'NAO_RASTREADA_COM_FALLBACK'
): LabelDeOperacaoReal {
  return {
    converted: false,
    vendasElegiveis: 0,
    valorBrutoVendas: 0,
    comissaoEsperada: 0,
    comissaoConfirmada: 0,
    comissaoRecebida: 0,
    receitaRealizada: 0,
    // Sem venda nenhuma, `comClique` é zero medido. `semClique` segue a
    // mesma regra do label positivo: só é zero quando o clique era
    // observável.
    atribuicaoDeClique: { comClique: 0, semClique: rastreamento === 'RASTREADA' ? 0 : null },
    rastreamentoDeClique: rastreamento,
    origemDoLabel: 'JANELA_DE_OBSERVACAO_ENCERRADA',
    featureVersion: FEATURE_VERSION,
    labeledAt: agora.toISOString(),
  }
}

/**
 * Rotula um conteúdo como NÃO convertido — mas só quando a janela fechou e
 * não há dúvida nenhuma sobre o resultado.
 *
 * Na dúvida, deixa sem rótulo. Uma amostra sem rótulo apenas não entra no
 * treino; uma amostra rotulada errado ensina o contrário do que aconteceu.
 */
export async function rotularNegativoSeJanelaEncerrada(params: {
  workspaceId: string
  contentId: string
  agora?: Date
  env?: Record<string, string | undefined>
}): Promise<ResultadoDoNegativo> {
  const base = { workspaceId: params?.workspaceId ?? '', contentId: params?.contentId ?? '' }
  const agora = params.agora ?? new Date()
  const politica = lerPoliticaDeObservacao(params.env ?? process.env)

  const negar = (motivo: MotivoNegativo, explicacao: string, snapshotId: string | null = null): ResultadoDoNegativo => ({
    rotulado: false,
    motivo,
    snapshotId,
    ...base,
    explicacao,
  })

  const conteudo = await prisma.conteudo.findFirst({
    where: { id: base.contentId, workspaceId: base.workspaceId },
    select: { publicacaoExternaId: true, dataPublicacao: true },
  })
  if (!conteudo) {
    return negar('SEM_DISTRIBUICAO_COMPROVADA', 'Conteúdo não encontrado neste workspace.')
  }

  // Conteúdo que nunca circulou NUNCA vira negativo de produção. É a trava
  // central desta revisão: rotular "não converteu" algo que ninguém viu
  // ensinaria ao modelo uma falha que nunca aconteceu.
  const evidencia = avaliarDistribuicaoReal(conteudo)
  if (!evidencia.distribuida) {
    return negar('SEM_DISTRIBUICAO_COMPROVADA', evidencia.explicacao)
  }

  const amostra = await prisma.mLFeatureSnapshot.findFirst({
    where: {
      workspaceId: base.workspaceId,
      entityType: ENTIDADE_DA_AMOSTRA,
      entityId: base.contentId,
      featureVersion: FEATURE_VERSION,
    },
    select: { id: true, labeledAt: true, capturedAt: true },
  })
  if (!amostra) {
    // Conteúdo legado: nunca criamos a amostra retroativamente.
    return negar(
      'SEM_AMOSTRA_CAPTURADA',
      'Não há amostra capturada na distribuição deste conteúdo. Criar uma agora usaria campos possivelmente editados — a lacuna fica registrada em vez de preenchida com palpite.'
    )
  }
  if (amostra.labeledAt) {
    return negar('JA_ROTULADO', 'Esta amostra já tem rótulo.', amostra.id)
  }

  // A janela conta a partir da DISTRIBUIÇÃO — que é o que `capturedAt`
  // guarda —, nunca de quando o registro foi marcado internamente.
  if (!janelaEncerrada(amostra.capturedAt, agora, politica.dias)) {
    return negar(
      'JANELA_ABERTA',
      `A janela de ${politica.dias} dias contados da distribuição ainda não terminou.`,
      amostra.id
    )
  }

  // Qualquer venda não cancelada ligada ao conteúdo cria dúvida: ou já é
  // operação real elegível (e então o positivo é que deve rotular), ou é
  // relato/promessa ainda não resolvida.
  const vendas = await prisma.sale.findMany({
    where: { workspaceId: base.workspaceId, contentId: base.contentId, status: { not: 'CANCELLED' } },
    select: { id: true },
  })
  if (vendas.length > 0) {
    return negar(
      'RESULTADO_EM_DUVIDA',
      `Há ${vendas.length} venda(s) não cancelada(s) ligada(s) a este conteúdo. Declarar "não converteu" seria afirmar mais do que se sabe.`,
      amostra.id
    )
  }

  // O rótulo negativo continua sendo de VENDA — nasce da ausência de venda
  // depois da janela, nunca da ausência de `EventoLink`. O estado entra só
  // para que ninguém leia a contagem de clique como medida.
  const rastreamento = await avaliarRastreamentoDoConteudo({
    workspaceId: base.workspaceId,
    contentId: base.contentId,
  })
  const label = montarLabelNegativo(agora, rastreamento.estado)
  await prisma.mLFeatureSnapshot.update({
    where: { id: amostra.id },
    // SÓ o rótulo. As features capturadas na publicação nunca são tocadas.
    data: { label: label as never, labeledAt: new Date(label.labeledAt) },
  })

  return {
    rotulado: true,
    motivo: 'ROTULADO_NEGATIVO',
    snapshotId: amostra.id,
    ...base,
    explicacao: `Janela de ${politica.dias} dias encerrada sem nenhuma venda: conteúdo rotulado como não convertido.`,
  }
}

/**
 * Varredura do gatilho D: fecha a janela de todos os conteúdos elegíveis.
 * Idempotente — rodar duas vezes não cria nem rotula nada de novo.
 */
export async function fecharJanelasDeObservacao(params?: {
  workspaceId?: string
  agora?: Date
  env?: Record<string, string | undefined>
  limite?: number
}): Promise<{ examinados: number; rotulados: number; porMotivo: Record<string, number> }> {
  const agora = params?.agora ?? new Date()
  const politica = lerPoliticaDeObservacao(params?.env ?? process.env)
  const limiteDaJanela = new Date(agora.getTime() - politica.dias * 24 * 60 * 60 * 1000)

  const candidatos = await prisma.mLFeatureSnapshot.findMany({
    where: {
      ...(params?.workspaceId ? { workspaceId: params.workspaceId } : {}),
      entityType: ENTIDADE_DA_AMOSTRA,
      featureVersion: FEATURE_VERSION,
      // Só o que ainda não tem rótulo: rotulado não é reexaminado.
      labeledAt: null,
      capturedAt: { lte: limiteDaJanela },
    },
    select: { workspaceId: true, entityId: true },
    take: params?.limite ?? 500,
  })

  const porMotivo: Record<string, number> = {}
  let rotulados = 0
  for (const c of candidatos) {
    if (!c.entityId) continue
    const r = await rotularNegativoSeJanelaEncerrada({
      workspaceId: c.workspaceId,
      contentId: c.entityId,
      agora,
      env: params?.env,
    })
    porMotivo[r.motivo] = (porMotivo[r.motivo] ?? 0) + 1
    if (r.rotulado) rotulados++
  }

  return { examinados: candidatos.length, rotulados, porMotivo }
}

// ── Lacunas e limitações declaradas ─────────────────────────────────────

/**
 * Conteúdos publicados SEM amostra capturada — o legado desta rodada.
 *
 * Diagnóstico, não conserto: não existe forma honesta de reconstruir a
 * observação. `Conteudo` não guarda revisões, então qualquer reconstrução
 * usaria o estado ATUAL dos campos, que pode ter sido editado depois da
 * publicação. Isso é exatamente o vazamento que o Bloco 4.1 veio corrigir.
 */
export async function listarLacunasDeCaptura(
  workspaceId: string,
  limite = 200
): Promise<Array<{ contentId: string; dataPublicacao: Date | null }>> {
  const publicados = await prisma.conteudo.findMany({
    where: { workspaceId, status: 'publicado' },
    select: { id: true, dataPublicacao: true },
    orderBy: { dataPublicacao: 'desc' },
    take: limite,
  })
  if (publicados.length === 0) return []

  const comAmostra = await prisma.mLFeatureSnapshot.findMany({
    where: {
      workspaceId,
      entityType: ENTIDADE_DA_AMOSTRA,
      featureVersion: FEATURE_VERSION,
      entityId: { in: publicados.map((p) => p.id) },
    },
    select: { entityId: true },
  })
  const jaTem = new Set(comAmostra.map((a) => a.entityId))
  return publicados.filter((p) => !jaTem.has(p.id)).map((p) => ({ contentId: p.id, dataPublicacao: p.dataPublicacao }))
}

/**
 * FILA DE AUTOMAÇÃO — limitação conhecida e declarada.
 *
 * `featureVersion` versiona o ESQUEMA de features, não a revisão do
 * conteúdo. Se a proprietária editar um conteúdo já publicado e publicar de
 * novo, a chave de idempotência continua a mesma e a observação ORIGINAL é
 * preservada — que é o comportamento seguro, porque reescrever apagaria um
 * dado histórico.
 *
 * O custo é real: uma venda vinda da segunda publicação será atribuída às
 * features da primeira. Resolver isso exige um conceito de REVISÃO de
 * conteúdo que o schema não tem, e inventá-lo aqui seria mudança grande
 * fora do escopo desta rodada.
 */
export const LIMITACAO_DE_REVISAO = {
  chave: 'ml:revisao-de-conteudo-republicado',
  explicacao:
    'Conteúdo editado e republicado reaproveita a amostra da primeira publicação. Preservar a observação original é o comportamento seguro, mas a atribuição fica imprecisa. Resolver exige versionar a revisão do Conteudo — não existe no schema hoje.',
} as const

/** Reexporta para quem orquestra os gatilhos. */
export { avaliarVendaParaOperacaoReal }
