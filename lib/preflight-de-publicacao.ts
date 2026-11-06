/**
 * P1.5.2 — Preflight de publicação.
 *
 * A pergunta que este arquivo responde, com evidência e sem publicar nada:
 *
 *   "Esta conta está realmente pronta para publicar isto agora?"
 *
 * ── AUTORIDADE CENTRAL, NÃO REGRA NOVA ──────────────────────────────────
 * Nenhuma regra nasce aqui. O preflight PERGUNTA a quem já decide:
 *
 *   autorizacao-da-conta  → o que a conta autorizou (P1.5.1)
 *   distribuicao-decisao  → o que dá para fazer com a peça (P1.5)
 *   adaptadores-reais     → o canal está ligado? (P1.5.2)
 *
 * Ele junta as três num relatório único e legível. Reimplementar qualquer
 * uma produziria duas respostas para a mesma pergunta, e um dia elas
 * divergiriam — que é exatamente o bug que o registro do TikTok tinha.
 *
 * ── PRONTO ≠ EXECUTÁVEL AGORA ───────────────────────────────────────────
 * `pronto` é sobre a CONTA e a PEÇA: tudo comprovado, nada faltando.
 * `executavelAgora` acrescenta o adapter ligado. A distinção importa: uma
 * conta pode estar impecável e o canal continuar desligado de propósito —
 * e isso não é um problema da conta.
 *
 * ── NADA DAQUI PUBLICA ──────────────────────────────────────────────────
 * Este módulo não chama adapter, não cria `Publicacao` e não escreve nada.
 */

import {
  lerAutorizacao,
  capabilityEfetivaDaConta,
  scopesExigidosDoCanal,
  dependenciaDaAutorizacao,
  type AutorizacaoDaConta,
  type CapabilityEfetiva,
  type MotivoDaConta,
} from './autorizacao-da-conta'
import {
  decidirDistribuicao,
  implementacaoDoCanal,
  type EstadoDeDistribuicao,
  type MotivoDeBloqueio,
  type VereditoDaDistribuicao,
} from './distribuicao-decisao'
import {
  montarContextoDaDistribuicao,
  type ConteudoParaDistribuir,
  type AdaptadorDeCanal,
} from './distribuicao-orquestrador'
import {
  adaptadoresHabilitados,
  motivoDeAdapterDesligado,
  ADAPTADORES_DISPONIVEIS,
} from './adaptadores-reais'
import { chaveDaTentativaPadrao } from './link-de-publicacao'
import { chaveDoJob, type JobDesejado } from './automation-queue-contrato'
import { type EstrategiaDeLink, urlVaiNaLegenda } from './capacidade-real-do-adapter'
import { situacaoDoLinkNaBio, urlDaTentativa, type SituacaoDoLinkNaBio } from './link-na-bio'

// ── Vocabulário ─────────────────────────────────────────────────────────

/**
 * O motivo EXATO do bloqueio.
 *
 * Reúne os vocabulários que já existem e acrescenta só o que é desta
 * rodada: o adapter desligado, que não é falta da conta nem da peça.
 */
export const MOTIVOS_DO_PREFLIGHT = [
  'ADAPTER_DESLIGADO',
  'CONTEUDO_INDISPONIVEL',
  /** P1.9.2. O link vai na bio e a presença dele lá não foi confirmada. */
  'LINK_NA_BIO_NAO_CONFIRMADO',
] as const
export type MotivoDoPreflight =
  | (typeof MOTIVOS_DO_PREFLIGHT)[number]
  | MotivoDaConta
  | MotivoDeBloqueio

export interface RelatorioDePreflight {
  canal: string
  /** Sem segredo: id e nome, como a plataforma os devolve. */
  conta: { id: string | null; nome: string | null }

  conectado: boolean
  tokenValido: boolean
  validadeAte: string | null

  scopesNecessarios: string[]
  scopesComprovados: string[] | null
  scopesFaltando: string[]
  scopesComprovadosEm: string | null

  appAprovado: boolean | null
  adapterImplementado: boolean
  adapterLigado: boolean
  motivoDoAdapter: string | null

  formatoCompativel: boolean
  midiaAutorizada: boolean
  disclosurePresente: boolean
  custoZero: boolean

  /** P1.9.1. O formato da peça, como o adapter o receberia. */
  formato: string | null
  /** P1.9.1. O adapter REAL enviaria esta peça? Mesma função que ele chama. */
  aceitoPeloAdapter: boolean
  /** P1.9.1. Por que a mídia foi ou não aceita. */
  motivoDaMidia: string | null
  /** P1.9.1. Onde o link rastreado fica para o público. */
  estrategiaDeLink: EstrategiaDeLink | null
  /** P1.9.1. Pendências de copy, preço e compliance, uma por linha. */
  pendencias: string[]
  /**
   * P1.9.2. As três coisas que antes se confundiam: estratégia definida,
   * link rastreado gerado, e link confirmado na bio por uma pessoa.
   * `null` quando o relatório é só da conta.
   */
  link: SituacaoDoLinkNaBio | null

  capabilityEfetiva: { publicar: boolean; draft: boolean }
  estadoDaDistribuicao: EstadoDeDistribuicao | null

  /** A conta e a peça estão prontas. Não diz nada sobre o adapter. */
  pronto: boolean
  /** Pronto E com o canal ligado. Só isto autoriza execução real. */
  executavelAgora: boolean

  bloqueio: MotivoDoPreflight | null
  explicacao: string[]
  /** O que destrava, em uma frase, para quem lê a tela. */
  oQueFalta: string | null
}

// ── O preflight ─────────────────────────────────────────────────────────

/**
 * O relatório completo de prontidão. NÃO PUBLICA.
 *
 * Quando `contentId` não vem, responde só sobre a CONTA — é o que a tela
 * de Integrações precisa para explicar "por que o Instagram ainda não está
 * publicando" sem depender de existir uma peça pronta.
 */
export async function preflightDePublicacao(params: {
  workspaceId: string
  canal: string
  /** Opcional: sem ele, o relatório é só da conta. */
  contentId?: string | null
  env?: Record<string, string | undefined>
  /** Injetável em teste. Sem isto, lê do ambiente. */
  adaptadores?: Record<string, AdaptadorDeCanal>
  agora?: Date
  /** A tentativa que vai ao ar. Sem ela, a chave padrão — é dela o link da bio. */
  chaveDaTentativa?: string | null
}): Promise<RelatorioDePreflight> {
  const canal = (params.canal ?? '').trim().toLowerCase()
  const env = params.env ?? process.env
  const implementacao = implementacaoDoCanal(canal)

  // 1. A conta: o que ela autorizou (P1.5.1).
  const autorizacao = await lerAutorizacao({
    workspaceId: params.workspaceId,
    canal,
    agora: params.agora,
    env,
  })
  const capability = capabilityEfetivaDaConta(autorizacao)

  // 2. O canal: implementado por nós, e ligado por alguém (P1.5.2).
  const adapterImplementado = !!ADAPTADORES_DISPONIVEIS[canal]
  const ligados = params.adaptadores ?? adaptadoresHabilitados(env)
  const adapterLigado = !!ligados[canal]
  const motivoDoAdapter = adapterLigado ? null : motivoDeAdapterDesligado(canal, env)

  // 3. A peça, quando há uma (P1.5).
  let contexto = null as Awaited<ReturnType<typeof montarContextoDaDistribuicao>>['contexto'] | null
  let conteudo: ConteudoParaDistribuir | null = null
  if (params.contentId) {
    const lido = await montarContextoDaDistribuicao({
      workspaceId: params.workspaceId,
      contentId: params.contentId,
      canal,
      env,
      agora: params.agora,
    })
    contexto = lido.contexto
    conteudo = lido.conteudo
  }

  const veredito: VereditoDaDistribuicao | null = contexto ? decidirDistribuicao(contexto) : null

  // 4. O link na bio (P1.9.2): só existe pergunta quando há peça.
  const link =
    params.contentId && conteudo
      ? await situacaoDoLinkNaBio({
          workspaceId: params.workspaceId,
          contentId: params.contentId,
          canal,
          chaveDaTentativa: params.chaveDaTentativa,
          env,
        })
      : null

  const explicacao: string[] = [autorizacao.explicacao, ...(veredito?.explicacao ?? [])]

  // ── O motivo exato, na ordem em que importa ─────────────────────────
  //
  // Primeiro a conta, porque sem ela nada mais adianta. Depois a peça.
  // Por último o adapter, que é a única coisa que NÃO impede `pronto`.
  let bloqueio: MotivoDoPreflight | null = capability.publicar.bloqueio ?? capability.draft.bloqueio

  // Quando as duas ações estão bloqueadas, o motivo de `publicar` manda —
  // exceto se ele for só "a plataforma não permite" e o draft tiver um
  // motivo mais acionável.
  if (capability.publicar.bloqueio === 'PLATAFORMA_NAO_PERMITE' && capability.draft.bloqueio) {
    bloqueio = capability.draft.bloqueio
  }
  if (capability.algoLiberado) bloqueio = null

  if (params.contentId && !conteudo) {
    bloqueio = 'CONTEUDO_INDISPONIVEL'
  } else if (!bloqueio && veredito && !veredito.podeExecutarSozinho) {
    bloqueio = veredito.bloqueios[0] ?? null
  }

  const pronto =
    capability.algoLiberado &&
    bloqueio === null &&
    // Com peça: ela também precisa passar. Sem peça: só a conta responde.
    (!params.contentId || (!!veredito && veredito.podeExecutarSozinho))

  // O link na bio vem ANTES do adapter na ordem do bloqueio: confirmar é o
  // passo humano que precede ligar o canal, e é o que a pessoa faz primeiro.
  const linkLiberado = link === null || link.liberaExecucao
  const executavelAgora = pronto && adapterLigado && linkLiberado
  if (pronto && !linkLiberado) bloqueio = 'LINK_NA_BIO_NAO_CONFIRMADO'
  else if (pronto && !adapterLigado) bloqueio = 'ADAPTER_DESLIGADO'

  const oQueFalta = (() => {
    if (executavelAgora) return null
    if (bloqueio === 'LINK_NA_BIO_NAO_CONFIRMADO') return link?.explicacao ?? 'Confirme o link na bio.'
    if (bloqueio === 'ADAPTER_DESLIGADO') return motivoDoAdapter
    if (bloqueio === 'SCOPE_NAO_VERIFICAVEL')
      return 'Revalide as permissões no card do canal em Integrações. Se a conta não tiver App ID e App Secret, reconecte informando os dois.'
    if (bloqueio === 'FORMATO_INCOMPATIVEL_COM_ADAPTER')
      return `O adapter de ${canal} não publica este formato. ${contexto?.pecaParaOAdapter.explicacao[0] ?? ''}`.trim()
    if (bloqueio === 'MIDIA_OBRIGATORIA_AUSENTE')
      return `${canal} exige vídeo e a peça não tem. Envie um vídeo próprio do produto.`
    if (bloqueio === 'MIDIA_SEM_DIREITO')
      return conteudo?.motivoDaMidia ?? 'A mídia não tem direito de uso verificado para este canal.'
    if (bloqueio === 'COMPLIANCE_PENDENTE')
      return contexto?.pendenciasDeCompliance[0] ?? 'Há pendência de compliance na peça.'
    if (bloqueio === 'ESCOPO_INSUFICIENTE')
      return `A conta precisa conceder: ${autorizacao.scopesFaltando.join(', ')}.`
    if (bloqueio === 'TOKEN_EXPIRADO')
      return autorizacao.podeRenovarSozinho
        ? 'O acesso venceu e será renovado automaticamente.'
        : 'O acesso venceu e não há refresh token — reconecte a conta.'
    if (bloqueio === 'DESCONECTADA') return 'Conecte a conta deste canal.'
    if (bloqueio === 'APP_NAO_APROVADO') return 'O provider ainda não aprovou o app.'
    if (bloqueio === 'ADAPTER_NAO_IMPLEMENTADO')
      return `A plataforma permite, e ainda não há implementação nossa. ${implementacao?.observacao ?? ''}`.trim()
    if (bloqueio === 'PLATAFORMA_NAO_PERMITE')
      return 'A plataforma não oferece publicação nem rascunho por API para este caso.'
    return explicacao.filter(Boolean)[0] ?? null
  })()

  return {
    canal,
    conta: { id: autorizacao.contaId, nome: autorizacao.contaNome },

    conectado: autorizacao.estado !== 'DESCONECTADA',
    tokenValido: autorizacao.estado !== 'DESCONECTADA' && !autorizacao.expirado,
    validadeAte: autorizacao.expiraEm ? autorizacao.expiraEm.toISOString() : null,

    scopesNecessarios: scopesExigidosDoCanal(implementacao, autorizacao.aprovacaoDoApp),
    scopesComprovados: autorizacao.scopesComprovados,
    scopesFaltando: autorizacao.scopesFaltando,
    scopesComprovadosEm: autorizacao.scopesComprovadosEm
      ? autorizacao.scopesComprovadosEm.toISOString()
      : null,

    appAprovado: autorizacao.aprovacaoDoApp,
    adapterImplementado,
    adapterLigado,
    motivoDoAdapter,

    formatoCompativel: contexto?.formatoCompativel ?? false,
    midiaAutorizada: contexto?.midiaAutorizada ?? false,
    disclosurePresente: contexto?.disclosurePresente ?? false,
    custoZero: contexto?.custoZero ?? true,

    formato: conteudo?.formato ?? null,
    aceitoPeloAdapter: contexto?.pecaParaOAdapter.aceita ?? false,
    motivoDaMidia: conteudo?.motivoDaMidia ?? null,
    estrategiaDeLink: conteudo?.estrategiaDeLink ?? null,
    pendencias: contexto?.pendenciasDeCompliance ?? [],
    link,

    capabilityEfetiva: { publicar: capability.publicar.permitido, draft: capability.draft.permitido },
    estadoDaDistribuicao: veredito?.estado ?? null,

    pronto,
    executavelAgora,
    bloqueio,
    explicacao: explicacao.filter(Boolean),
    oQueFalta,
  }
}

// ── Dry run ─────────────────────────────────────────────────────────────

export interface PayloadSimulado {
  canal: string
  formato: string | null
  /** Quantos caracteres a legenda teria. O texto em si não sai daqui. */
  tamanhoDaLegenda: number
  /** `true` quando a peça tem vídeo renderizado. */
  temMidia: boolean
  /** O link que seria divulgado seria o rastreado? */
  linkRastreado: boolean
  /**
   * P1.9.1. Onde o link fica. Em `BIO`, a legenda NÃO leva a URL: ela vai
   * na bio do perfil, e quem publica precisa colocá-la lá antes.
   */
  ondeVaiOLink: EstrategiaDeLink | null
  /** A URL entraria no texto da legenda? Só onde ela é clicável. */
  urlNaLegenda: boolean
  /** A URL que seria usada. É pública por natureza — não é segredo. */
  urlQueSeriaUsada: string | null
  disclosurePresente: boolean
}

export interface ResultadoDoDryRun {
  simulado: true
  /** Nada foi enviado, nada foi gravado. */
  enviouAoCanal: false
  criouPublicacao: false
  preflight: RelatorioDePreflight
  payload: PayloadSimulado | null
  /** O que aconteceria numa execução real. */
  acaoQueSeriaTomada: 'PUBLICAR' | 'DRAFT' | 'NENHUMA'
  bloqueios: string[]
  explicacao: string
}

/**
 * Roda o caminho inteiro sem enviar nada e sem gravar nada.
 *
 * ── POR QUE NÃO CRIA `Publicacao` ───────────────────────────────────────
 * `Publicacao` significa distribuição real: é a unidade que o ML lê como
 * evidência e que o estado de rastreamento deriva. Criar uma no ensaio
 * encheria o histórico de tentativas que nunca saíram, e um `PREPARADA`
 * abandonada é indistinguível de uma que falhou de verdade.
 *
 * Dá para simular sem ela porque o link rastreado é DETERMINÍSTICO:
 * `slugDaPublicacao()` é função pura da chave da tentativa, então a URL que
 * sairia pode ser calculada exatamente, sem persistir linha nenhuma. O
 * ensaio mostra a URL de verdade; ele só não a reserva.
 */
export async function simularDistribuicao(params: {
  workspaceId: string
  contentId: string
  canal: string
  chaveDaTentativa?: string | null
  env?: Record<string, string | undefined>
  adaptadores?: Record<string, AdaptadorDeCanal>
  agora?: Date
}): Promise<ResultadoDoDryRun> {
  const canal = (params.canal ?? '').trim().toLowerCase()
  const env = params.env ?? process.env

  const preflight = await preflightDePublicacao({
    workspaceId: params.workspaceId,
    canal,
    contentId: params.contentId,
    env,
    adaptadores: params.adaptadores,
    agora: params.agora,
    chaveDaTentativa: params.chaveDaTentativa,
  })

  const { conteudo } = await montarContextoDaDistribuicao({
    workspaceId: params.workspaceId,
    contentId: params.contentId,
    canal,
    env,
    agora: params.agora,
  })

  if (!conteudo) {
    return {
      simulado: true,
      enviouAoCanal: false,
      criouPublicacao: false,
      preflight,
      payload: null,
      acaoQueSeriaTomada: 'NENHUMA',
      bloqueios: ['CONTEUDO_INDISPONIVEL'],
      explicacao: 'Conteúdo não encontrado neste workspace.',
    }
  }

  // A URL rastreada, calculada e não reservada.
  // Sem chave explícita, a padrão — derivada do agendamento da peça, como
  // a publicação real faz. Antes o ensaio usava `dataAgendamento: null` e,
  // numa peça agendada, mostrava um link diferente do que sairia.
  const chaveDaTentativa =
    (params.chaveDaTentativa ?? '').trim() ||
    chaveDaTentativaPadrao({
      contentId: params.contentId,
      canal,
      dataAgendamento: conteudo.dataAgendamento ?? null,
    })

  // A MESMA função que o link da bio e o orquestrador usam: a URL do ensaio
  // é a que seria confirmada e a que seria publicada.
  const daTentativa = urlDaTentativa({
    workspaceId: params.workspaceId,
    contentId: params.contentId,
    canal,
    chaveDaTentativa,
    dataAgendamento: conteudo.dataAgendamento ?? null,
    nomeProduto: conteudo.nomeProduto ?? null,
    urlDiretaDoProduto: conteudo.urlDiretaDoProduto,
    env,
  })
  const podeRastrear = daTentativa.rastreada
  const urlQueSeriaUsada = daTentativa.url

  const acaoQueSeriaTomada: 'PUBLICAR' | 'DRAFT' | 'NENHUMA' = !preflight.executavelAgora
    ? 'NENHUMA'
    : preflight.estadoDaDistribuicao === 'AUTO_PUBLICAVEL'
      ? 'PUBLICAR'
      : preflight.estadoDaDistribuicao === 'DRAFT_AUTOMATICO'
        ? 'DRAFT'
        : 'NENHUMA'

  return {
    simulado: true,
    enviouAoCanal: false,
    criouPublicacao: false,
    preflight,
    payload: {
      canal,
      formato: conteudo.formato,
      // O TAMANHO, não o texto: legenda pode conter o que a dona escreveu,
      // e um ensaio não precisa ecoar conteúdo para provar que funciona.
      tamanhoDaLegenda: conteudo.legenda.length,
      temMidia: !!conteudo.assetUrl,
      linkRastreado: podeRastrear,
      ondeVaiOLink: conteudo.estrategiaDeLink ?? null,
      urlNaLegenda: urlVaiNaLegenda(canal),
      urlQueSeriaUsada,
      disclosurePresente: preflight.disclosurePresente,
    },
    acaoQueSeriaTomada,
    bloqueios: preflight.bloqueio ? [preflight.bloqueio] : [],
    explicacao: preflight.executavelAgora
      ? `Ensaio: ${acaoQueSeriaTomada.toLowerCase()} em ${canal}. Nada foi enviado e nada foi gravado.`
      : `Ensaio: nada seria enviado. ${preflight.oQueFalta ?? ''}`.trim(),
  }
}

// ── A fila que já existe ────────────────────────────────────────────────

/**
 * O que o preflight manda para a Automation Queue.
 *
 * A pendência da CONTA já tem autoridade própria (`dependenciaDaAutorizacao`,
 * P1.5.1) e é reusada inteira. O que esta função acrescenta é a pendência da
 * PEÇA — hoje, mídia sem direito de uso.
 */
export function dependenciasDoPreflight(params: {
  workspaceId: string
  integracaoId: string | null
  produtoId: string | null
  relatorio: RelatorioDePreflight
  autorizacao: AutorizacaoDaConta
}): JobDesejado[] {
  const jobs: JobDesejado[] = []

  if (params.integracaoId) {
    const daConta = dependenciaDaAutorizacao({
      workspaceId: params.workspaceId,
      integracaoId: params.integracaoId,
      autorizacao: params.autorizacao,
    })
    if (daConta) jobs.push(daConta)
  }

  // Mídia sem direito é do PRODUTO, não da conta: o que destrava é uma
  // sincronização com o catálogo oficial, não um OAuth.
  if (params.produtoId && params.relatorio.bloqueio === 'MIDIA_SEM_DIREITO') {
    const contexto: Record<string, unknown> = { canal: params.relatorio.canal, custoEstimado: 0 }
    jobs.push({
      chave: chaveDoJob({
        workspaceId: params.workspaceId,
        tipo: 'SINCRONIZAR_MIDIA_AUTORIZADA',
        entityType: 'PRODUTO',
        entityId: params.produtoId,
        contexto,
      }),
      tipo: 'SINCRONIZAR_MIDIA_AUTORIZADA',
      entityType: 'PRODUTO',
      entityId: params.produtoId,
      classe: 'AUTOMATIZAVEL',
      motivoHumano: null,
      contexto,
      explicacao: 'A mídia do produto não tem direito de uso verificado para este canal.',
    } as JobDesejado)
  }

  return jobs
}

/** REGRA PERMANENTE: o ensaio não deixa rastro de operação. */
export const DRY_RUN_NAO_E_OPERACAO = {
  chave: 'preflight:dry-run-sem-rastro',
  naoFaz: ['chamar adapter', 'criar Publicacao', 'criar LinkDinamico', 'marcar DISTRIBUIDA'],
  porque:
    'Publicacao significa distribuição real. Um ensaio que a criasse encheria o histórico do ML de tentativas que nunca saíram.',
  comoSimulaOLink:
    'slugDaPublicacao() é função pura da chave da tentativa: a URL que sairia é calculada, não reservada.',
} as const

export { capabilityEfetivaDaConta, lerAutorizacao }
export type { CapabilityEfetiva, AutorizacaoDaConta }
