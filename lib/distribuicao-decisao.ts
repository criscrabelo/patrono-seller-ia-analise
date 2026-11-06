/**
 * Decisão de distribuição (P1.5).
 *
 * Responde UMA pergunta: dado um `Conteudo` pronto, o que o Patrono pode
 * fazer com ele NESTE canal, hoje, com as permissões que realmente tem?
 *
 * ── O QUE A AUDITORIA ENCONTROU ─────────────────────────────────────────
 * O `ChannelRegistry` descreve o que a PLATAFORMA permite. Isso não é a
 * mesma coisa que o que NÓS implementamos — e tratar como se fosse produz
 * exatamente o erro que esta rodada existe para evitar.
 *
 * Dois exemplos reais encontrados:
 *
 *   1. O registro diz `tiktok.draftUpload = true`, e não existe UMA linha
 *      de código que chame o endpoint de inbox/draft. A capacidade está
 *      declarada e não implementada.
 *
 *   2. O registro diz `tiktok.autoPublish = false`, mas
 *      `TikTokPublisher.publicar()` chama `/post/publish/video/init/`, que
 *      é Direct Post. O código implementa justamente o que o registro diz
 *      não ser possível — e pede o escopo `video.publish`, não o
 *      `video.upload` que o draft exigiria.
 *
 * Por isso a decisão cruza TRÊS coisas, nunca uma: o que a plataforma
 * permite, o que nós implementamos, e o que a conta autorizou.
 */

import { capacidadeDoCanal, type ChannelCapability } from './channel-registry'
import type { AvaliacaoDoAdapter } from './capacidade-real-do-adapter'

// ── Estados ─────────────────────────────────────────────────────────────

export const ESTADOS_DE_DISTRIBUICAO = [
  /** Dá para publicar sozinho, agora. */
  'AUTO_PUBLICAVEL',
  /** Dá para deixar pronto no canal; a pessoa confirma lá. */
  'DRAFT_AUTOMATICO',
  /** Falta a dona autorizar a conta. Só ela destrava. */
  'AGUARDANDO_OAUTH',
  /** Falta a plataforma liberar escopo/auditoria do app. */
  'AGUARDANDO_APROVACAO_DO_PROVIDER',
  /** A mídia do produto não pode ser usada. */
  'AGUARDANDO_MIDIA_AUTORIZADA',
  /** Nada automático serve; o Patrono prepara e a pessoa posta. */
  'PUBLICACAO_MANUAL_ASSISTIDA',
  /** Não entra em distribuição nenhuma. */
  'NAO_ELEGIVEL',
] as const
export type EstadoDeDistribuicao = (typeof ESTADOS_DE_DISTRIBUICAO)[number]

/** Os dois únicos que o robô executa sozinho nesta rodada. */
export const ESTADOS_EXECUTAVEIS: EstadoDeDistribuicao[] = ['AUTO_PUBLICAVEL', 'DRAFT_AUTOMATICO']

export const MOTIVOS_DE_BLOQUEIO = [
  'CANAL_DESCONHECIDO',
  'CANAL_DESCONECTADO',
  'SCOPE_AUSENTE',
  /** A conexão não guarda quais permissões foram concedidas. */
  'SCOPE_NAO_VERIFICAVEL',
  'ADAPTER_NAO_IMPLEMENTADO',
  'APROVACAO_DO_PROVIDER_PENDENTE',
  'MIDIA_SEM_DIREITO',
  'FORMATO_INCOMPATIVEL',
  /** P1.9.1. O canal aceita o formato; o adapter real, não. */
  'FORMATO_INCOMPATIVEL_COM_ADAPTER',
  /** P1.9.1. O adapter real exige mídia e a peça não tem. */
  'MIDIA_OBRIGATORIA_AUSENTE',
  'DISCLOSURE_AUSENTE',
  'COMPLIANCE_PENDENTE',
  'CUSTO_NAO_AUTORIZADO',
] as const
export type MotivoDeBloqueio = (typeof MOTIVOS_DE_BLOQUEIO)[number]

// ── O que NÓS implementamos ─────────────────────────────────────────────

export interface Implementacao {
  /** Existe código nosso que publica direto, de verdade. */
  publicaDireto: boolean
  /** Existe código nosso que envia rascunho, de verdade. */
  enviaDraft: boolean
  /** Escopos que o app REALMENTE pede hoje. */
  scopesPedidos: string[]
  /** Escopos exigidos para cada ação, segundo a doc oficial. */
  scopeParaPublicar: string | null
  scopeParaDraft: string | null
  /**
   * P2.17.10. Publicar direto só com a aprovação do app CONFIRMADA (`true`),
   * não apenas "não reprovada". TikTok: sem a auditoria do Direct Post todo
   * post sai privado (SELF_ONLY) — publicar assim não é publicar.
   */
  publicarExigeAprovacaoConfirmada?: boolean
  /** P2.17.10. O rascunho não depende da aprovação que trava o publicar direto. */
  draftDispensaAprovacaoDoApp?: boolean
  observacao: string
}

/**
 * O estado REAL do que existe no repositório, apurado na auditoria.
 *
 * Este mapa é sobre NÓS, não sobre a plataforma. Quando alguém implementar
 * o draft do TikTok, muda aqui — e o motor passa a oferecê-lo sozinho.
 */
export const IMPLEMENTACAO_POR_CANAL: Record<string, Implementacao> = {
  instagram: {
    publicaDireto: true,
    enviaDraft: false,
    scopesPedidos: ['instagram_content_publish'],
    scopeParaPublicar: 'instagram_content_publish',
    scopeParaDraft: null,
    observacao:
      'lib/instagram.ts publica de verdade pela Graph API oficial. O adapter real só envia Reel com vídeo (lib/capacidade-real-do-adapter.ts). A Meta não oferece rascunho por API.',
  },
  tiktok: {
    // P2.17.10: adapter real (lib/tiktok-adaptador.ts) — Direct Post e rascunho
    // por FILE_UPLOAD, confirmação assíncrona pelo status/webhook.
    publicaDireto: true,
    enviaDraft: true,
    scopesPedidos: ['user.info.basic', 'video.upload', 'video.list'],
    scopeParaPublicar: 'video.publish',
    scopeParaDraft: 'video.upload',
    publicarExigeAprovacaoConfirmada: true,
    draftDispensaAprovacaoDoApp: true,
    observacao:
      'Rascunho na caixa de entrada (video.upload) sem auditoria; Direct Post só com a auditoria do TikTok confirmada (TIKTOK_APP_AUDITADO=true) e video.publish. Produto do TikTok Shop não é marcado por esta API (limitação oficial).',
  },
  facebook: {
    publicaDireto: false,
    enviaDraft: false,
    scopesPedidos: [],
    scopeParaPublicar: 'pages_manage_posts',
    scopeParaDraft: null,
    observacao: 'Só existe no registro. Nenhum adapter escrito.',
  },
  youtube: {
    publicaDireto: false,
    enviaDraft: false,
    scopesPedidos: [],
    scopeParaPublicar: 'youtube.upload',
    scopeParaDraft: 'youtube.upload',
    observacao: 'Só existe no registro. Nenhum adapter escrito.',
  },
  pinterest: {
    publicaDireto: false,
    enviaDraft: false,
    scopesPedidos: [],
    scopeParaPublicar: null,
    scopeParaDraft: null,
    observacao: 'Só existe no registro. Nenhum adapter escrito.',
  },
}

export function implementacaoDoCanal(canal: string): Implementacao | null {
  return IMPLEMENTACAO_POR_CANAL[(canal ?? '').trim().toLowerCase()] ?? null
}

// ── A decisão ───────────────────────────────────────────────────────────

export interface ContextoDaDistribuicao {
  canal: string
  /** Integração conectada e com token válido. */
  canalConectado: boolean
  /**
   * Escopos que a CONTA concedeu.
   *
   * `[]` = conectada e nenhum escopo concedido.
   * `null` = a conexão não registra escopo nenhum — não dá para comprovar.
   * Os dois bloqueiam; só o motivo muda, porque o que destrava é diferente.
   */
  scopesConcedidos: string[] | null
  /** O app passou pela auditoria da plataforma? `null` = desconhecido. */
  appAprovadoPeloProvider: boolean | null
  midiaAutorizada: boolean
  /** O formato da peça é aceito pelo canal. */
  formatoCompativel: boolean
  /**
   * P1.9.1. O adapter REAL enviaria esta peça? Vem de
   * `avaliarPecaParaOAdapter`, a mesma função que o adapter chama antes de
   * abrir rede. Obrigatório de propósito: sem ele, "pronto" voltaria a
   * significar "a plataforma aceitaria", que foi o bug da P1.9.
   */
  pecaParaOAdapter: AvaliacaoDoAdapter
  /** O disclosure obrigatório está na peça. */
  disclosurePresente: boolean
  /** Pendências de compliance abertas. Vazio = nenhuma. */
  pendenciasDeCompliance: string[]
  /** `true` só quando o caminho é comprovadamente gratuito. */
  custoZero: boolean
}

export interface VereditoDaDistribuicao {
  estado: EstadoDeDistribuicao
  /** `true` só em AUTO_PUBLICAVEL e DRAFT_AUTOMATICO. */
  podeExecutarSozinho: boolean
  bloqueios: MotivoDeBloqueio[]
  explicacao: string[]
  capability: ChannelCapability | null
  implementacao: Implementacao | null
}

/**
 * FUNÇÃO PURA. O que dá para fazer com esta peça, neste canal, hoje.
 *
 * FAIL-CLOSED em cada porta: qualquer ausência derruba para o estado que
 * descreve o que falta. Publicar porque "o conteúdo está pronto" é
 * exatamente o que esta função existe para impedir.
 *
 * A ORDEM importa. Bloqueios que dependem de terceiros vêm depois dos que
 * dependem de nós — assim a explicação aponta a primeira coisa acionável,
 * e não a mais distante.
 */
export function decidirDistribuicao(ctx: ContextoDaDistribuicao): VereditoDaDistribuicao {
  const bloqueios: MotivoDeBloqueio[] = []
  const explicacao: string[] = []
  const canal = (ctx?.canal ?? '').trim().toLowerCase()
  const capability = capacidadeDoCanal(canal) ?? null
  const implementacao = implementacaoDoCanal(canal)

  const veredito = (estado: EstadoDeDistribuicao): VereditoDaDistribuicao => ({
    estado,
    podeExecutarSozinho: ESTADOS_EXECUTAVEIS.includes(estado),
    bloqueios,
    explicacao,
    capability,
    implementacao,
  })

  if (!capability || !implementacao) {
    bloqueios.push('CANAL_DESCONHECIDO')
    explicacao.push(`Canal "${canal}" não está no registro de capacidades — nada é assumido.`)
    return veredito('NAO_ELEGIVEL')
  }

  // ── Coisas da PEÇA, que não dependem de ninguém de fora ──────────────
  if (!ctx.formatoCompativel) {
    bloqueios.push('FORMATO_INCOMPATIVEL')
    explicacao.push('O formato da peça não é aceito por este canal.')
  }
  // Fail-closed: avaliação ausente é tratada como recusa.
  const doAdapter = ctx.pecaParaOAdapter ?? {
    aceita: false,
    bloqueios: ['FORMATO_INCOMPATIVEL_COM_ADAPTER'],
    explicacao: ['A peça não foi avaliada contra o adapter real.'],
  }
  if (!doAdapter.aceita) {
    for (const b of doAdapter.bloqueios) if (!bloqueios.includes(b)) bloqueios.push(b)
    explicacao.push(...doAdapter.explicacao)
  }
  if (ctx.pendenciasDeCompliance.length > 0) {
    bloqueios.push('COMPLIANCE_PENDENTE')
    explicacao.push(`Compliance pendente: ${ctx.pendenciasDeCompliance.join(', ')}.`)
  }
  if (capability.commercialDisclosure && !ctx.disclosurePresente) {
    bloqueios.push('DISCLOSURE_AUSENTE')
    explicacao.push('Este canal exige aviso de conteúdo comercial, e a peça não o traz.')
  }
  if (!ctx.custoZero) {
    bloqueios.push('CUSTO_NAO_AUTORIZADO')
    explicacao.push('A distribuição só é automática quando o caminho custa R$ 0,00.')
  }
  if (bloqueios.length > 0) {
    // Só falta a mídia: é ela que destrava, e o estado diz isso.
    if (bloqueios.length === 1 && bloqueios[0] === 'MIDIA_OBRIGATORIA_AUSENTE') {
      return veredito('AGUARDANDO_MIDIA_AUTORIZADA')
    }
    // Nada disso depende de terceiro: é a peça que precisa mudar.
    return veredito('PUBLICACAO_MANUAL_ASSISTIDA')
  }

  // ── Mídia ────────────────────────────────────────────────────────────
  if (!ctx.midiaAutorizada) {
    bloqueios.push('MIDIA_SEM_DIREITO')
    explicacao.push('A mídia do produto não tem direito de uso verificado para este canal.')
    return veredito('AGUARDANDO_MIDIA_AUTORIZADA')
  }

  // ── Conexão da conta ─────────────────────────────────────────────────
  if (!ctx.canalConectado) {
    bloqueios.push('CANAL_DESCONECTADO')
    explicacao.push('A conta deste canal não está conectada. Só a proprietária pode autorizar.')
    return veredito('AGUARDANDO_OAUTH')
  }

  // ── O que a plataforma permite × o que nós implementamos ─────────────
  // Escopo ilegível NÃO é escopo concedido. Assumir aqui seria exatamente
  // o "não assumir permissões" que a regra proíbe.
  const scopes = ctx.scopesConcedidos
  const temScope = (s: string | null) => !s || (scopes !== null && scopes.includes(s))

  // P2.17.10: onde a aprovação precisa estar CONFIRMADA, "desconhecida" não publica.
  const publicarLiberado = !implementacao.publicarExigeAprovacaoConfirmada || ctx.appAprovadoPeloProvider === true
  const podePublicar =
    capability.autoPublish && publicarLiberado && implementacao.publicaDireto && temScope(implementacao.scopeParaPublicar)
  const podeDraft =
    capability.draftUpload && implementacao.enviaDraft && temScope(implementacao.scopeParaDraft)

  if (podePublicar) {
    // Aprovação do provider é a última porta: sem ela, o app publica em
    // ambiente restrito ou não publica.
    if (ctx.appAprovadoPeloProvider === false) {
      bloqueios.push('APROVACAO_DO_PROVIDER_PENDENTE')
      explicacao.push('O app ainda não passou pela auditoria da plataforma.')
      return veredito('AGUARDANDO_APROVACAO_DO_PROVIDER')
    }
    explicacao.push(`Publicação automática disponível: ${implementacao.observacao}`)
    return veredito('AUTO_PUBLICAVEL')
  }

  if (podeDraft) {
    if (ctx.appAprovadoPeloProvider === false && !implementacao.draftDispensaAprovacaoDoApp) {
      bloqueios.push('APROVACAO_DO_PROVIDER_PENDENTE')
      explicacao.push('O app ainda não passou pela auditoria da plataforma.')
      return veredito('AGUARDANDO_APROVACAO_DO_PROVIDER')
    }
    explicacao.push(`Rascunho automático disponível: ${implementacao.observacao}`)
    return veredito('DRAFT_AUTOMATICO')
  }

  // ── Por que não deu: o motivo mais acionável primeiro ────────────────
  const publicarPossivel = capability.autoPublish && publicarLiberado
  const acaoDesejada = publicarPossivel ? 'publicar' : capability.draftUpload ? 'enviar rascunho' : null

  if (!acaoDesejada) {
    explicacao.push(`O canal não oferece publicação nem rascunho por API. ${implementacao.observacao}`)
    return veredito('PUBLICACAO_MANUAL_ASSISTIDA')
  }

  const implementado = publicarPossivel ? implementacao.publicaDireto : implementacao.enviaDraft
  if (!implementado) {
    bloqueios.push('ADAPTER_NAO_IMPLEMENTADO')
    explicacao.push(
      `A plataforma permite ${acaoDesejada}, mas não há implementação nossa para isso. ${implementacao.observacao}`
    )
    return veredito('PUBLICACAO_MANUAL_ASSISTIDA')
  }

  const scopeNecessario = publicarPossivel
    ? implementacao.scopeParaPublicar
    : implementacao.scopeParaDraft

  if (scopes === null) {
    bloqueios.push('SCOPE_NAO_VERIFICAVEL')
    explicacao.push(
      `A conexão deste canal não registra quais permissões foram concedidas, ` +
        `então não dá para comprovar "${scopeNecessario}" para ${acaoDesejada}.`
    )
    return veredito('AGUARDANDO_OAUTH')
  }

  bloqueios.push('SCOPE_AUSENTE')
  explicacao.push(
    `Falta o escopo "${scopeNecessario}" para ${acaoDesejada}. Concedidos hoje: ${
      scopes.length ? scopes.join(', ') : 'nenhum'
    }.`
  )
  return veredito('AGUARDANDO_OAUTH')
}

// ── Lacunas registradas ─────────────────────────────────────────────────

/**
 * FILA DE AUTOMAÇÃO — o que a auditoria achou e esta rodada NÃO resolve.
 *
 * Nenhuma destas é bug: são capacidades que a plataforma oferece e o
 * projeto ainda não tem. Ficam nomeadas para não virarem surpresa no dia em
 * que alguém confiar no registro sem olhar o código.
 */
export const LACUNAS_DE_DISTRIBUICAO = [
  {
    chave: 'tiktok:draft-nao-implementado',
    canal: 'tiktok',
    oQueFalta:
      'O registro declara draftUpload=true, mas nenhuma linha chama o endpoint de inbox da Content Posting API.',
    destravaCom: 'IMPLEMENTAR_ADAPTER_DE_DRAFT',
  },
  {
    chave: 'tiktok:scope-de-draft-nao-pedido',
    canal: 'tiktok',
    oQueFalta:
      'O app pede apenas `video.publish`. O rascunho exigiria `video.upload`, que não é solicitado no OAuth.',
    destravaCom: 'ACRESCENTAR_SCOPE_NO_OAUTH',
  },
  {
    chave: 'tiktok:publisher-sem-rota',
    canal: 'tiktok',
    oQueFalta:
      'TikTokPublisher publica de verdade (Direct Post), mas nenhuma rota o chama — a capacidade existe e está desligada.',
    destravaCom: 'LIGAR_APOS_APROVACAO_DO_APP',
  },
  {
    chave: 'instagram:escopos-nao-registrados',
    canal: 'instagram',
    oQueFalta:
      'A conexão do Instagram é por token colado (app/api/integracoes/route.ts) e não guarda os escopos concedidos. ' +
      'O adapter existe e publica, mas a permissão não é comprovável — e permissão não comprovada não é permissão.',
    destravaCom: 'REGISTRAR_ESCOPOS_NA_CONEXAO',
  },
  {
    chave: 'canais-sem-adapter',
    canal: 'facebook,youtube,pinterest',
    oQueFalta: 'Existem no registro e não têm nenhum adapter escrito.',
    destravaCom: 'IMPLEMENTAR_ADAPTER',
  },
] as const

/**
 * REGRA PERMANENTE.
 *
 * O registro de capacidades fala da PLATAFORMA. `IMPLEMENTACAO_POR_CANAL`
 * fala de NÓS. Decidir por um só produziria promessa que a execução não
 * cumpre — ou capacidade real desligada sem ninguém saber.
 */
export const DECISAO_CRUZA_TRES_FONTES = {
  chave: 'distribuicao:tres-fontes',
  fontes: ['ChannelRegistry (plataforma)', 'IMPLEMENTACAO_POR_CANAL (nós)', 'scopes concedidos (conta)'],
  porque:
    'Um registro otimista faria o robô prometer o que não sabe fazer; um registro pessimista esconderia capacidade pronta.',
} as const
