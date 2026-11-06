/**
 * Contrato de domínio de `Publicacao` (P1.0 — Etapa 1).
 *
 * ── SÓ CONTRATO, NENHUM BANCO ───────────────────────────────────────────
 * Este arquivo não importa Prisma, não consulta nada e não escreve nada.
 * São tipos, estados e validadores PUROS. O schema só muda na Etapa 2, e a
 * migration é apresentada antes.
 *
 * ── A DISTINÇÃO QUE JUSTIFICA A ENTIDADE ────────────────────────────────
 *   Conteudo   = o criativo. Roteiro, hook, CTA, duração. Existe uma vez.
 *   Publicacao = uma DISTRIBUIÇÃO concreta desse criativo, num canal, num
 *                instante. O mesmo conteúdo pode ir ao ar várias vezes.
 *
 * Hoje as duas coisas moram juntas: `Conteudo.dataPublicacao`,
 * `Conteudo.publicacaoExternaId` e `Conteudo.status` fazem um conteúdo ter
 * no máximo UMA publicação, e republicar sobrescreve a anterior em silêncio.
 * É a dívida registrada como `LIMITACAO_DE_REVISAO` no Bloco 4.1.
 *
 * Separar resolve três coisas de uma vez: republicação deixa de apagar
 * histórico, canal passa a ser do evento de distribuição (e não um campo
 * solto no criativo), e o clique ganha onde se ancorar.
 *
 * ── MULTI-PROVIDER POR CONSTRUÇÃO ───────────────────────────────────────
 * Nenhum nome de plataforma aparece em regra. `provider` é um id do
 * `AFFILIATE_PROVIDER_REGISTRY`, e `canal` é texto livre validado só quanto
 * a presença. TikTok não tem tratamento especial em lugar nenhum.
 */

// ── Provider e canal ────────────────────────────────────────────────────

/**
 * De onde veio a confirmação da publicação.
 *
 * `provider` identifica o SISTEMA (instagram, tiktok-shop, shopee...) e
 * `canal` identifica ONDE o público viu (feed, reels, stories, perfil).
 * São coisas diferentes: o mesmo provider distribui em vários canais, e o
 * mesmo canal pode ser servido por providers distintos.
 */
export interface DestinoDaPublicacao {
  provider: string
  canal: string
}

// ── Estados ─────────────────────────────────────────────────────────────

/**
 * Estados de uma publicação.
 *
 * Deliberadamente poucos. Cada um responde a uma pergunta operacional real,
 * e nenhum existe só para "ficar bonito no diagrama".
 */
export const ESTADOS_DA_PUBLICACAO = [
  /** Existe a intenção e o material; nada saiu ainda. */
  'PREPARADA',
  /** O provider recebeu e está processando. Ainda não há prova de exposição. */
  'DISTRIBUINDO',
  /** Confirmada pelo canal. É o único estado que habilita medição. */
  'DISTRIBUIDA',
  /** Tentou e não foi. Pode ser retentada com a MESMA chave de tentativa. */
  'FALHOU',
  /** Estava no ar e saiu — apagada, despublicada, derrubada. */
  'REMOVIDA',
] as const

export type EstadoDaPublicacao = (typeof ESTADOS_DA_PUBLICACAO)[number]

/**
 * Transições permitidas.
 *
 * `DISTRIBUIDA → DISTRIBUINDO` não existe: publicação confirmada não volta
 * a processar. `REMOVIDA` é terminal — republicar é uma publicação NOVA,
 * com chave nova, não um retorno de estado. É justamente isso que faz o
 * histórico parar de se sobrescrever.
 */
export const TRANSICOES_PERMITIDAS: Record<EstadoDaPublicacao, EstadoDaPublicacao[]> = {
  PREPARADA: ['DISTRIBUINDO', 'FALHOU'],
  DISTRIBUINDO: ['DISTRIBUIDA', 'FALHOU'],
  // Retry usa a mesma chave de tentativa e volta a DISTRIBUINDO.
  FALHOU: ['DISTRIBUINDO'],
  DISTRIBUIDA: ['REMOVIDA'],
  REMOVIDA: [],
}

export function transicaoPermitida(de: EstadoDaPublicacao, para: EstadoDaPublicacao): boolean {
  return (TRANSICOES_PERMITIDAS[de] ?? []).includes(para)
}

// ── Evidência de distribuição ───────────────────────────────────────────

/**
 * Como se sabe que a publicação realmente aconteceu.
 *
 * Mesma lição do P0.2: estado interno não é prova. `status = 'DISTRIBUIDA'`
 * é uma afirmação nossa; evidência é o recibo de alguém de fora.
 */
export const TIPOS_DE_EVIDENCIA_DE_PUBLICACAO = [
  /** O provider devolveu um identificador para a publicação. */
  'ID_EXTERNO_DO_PROVIDER',
  /** Um adapter oficial confirmou, nomeando-se. */
  'CONFIRMACAO_DE_ADAPTER',
  /** Exceção auditada: alguém comprovou à mão que o post está no ar. */
  'CORRECAO_MANUAL_AUDITADA',
] as const

export type TipoDeEvidenciaDePublicacao = (typeof TIPOS_DE_EVIDENCIA_DE_PUBLICACAO)[number]

export interface EvidenciaDePublicacao {
  tipo: string
  /** Id do post/mídia no provider, protocolo, ou onde a prova foi conferida. */
  referenciaExterna?: string | null
  /** Instante em que a distribuição foi confirmada. Marco de tudo o que vem depois. */
  confirmadaEm?: Date | null
  /** Obrigatório em `CONFIRMACAO_DE_ADAPTER`. */
  adapterId?: string | null
  /** Obrigatórios em `CORRECAO_MANUAL_AUDITADA`. */
  responsavelUserId?: string | null
  motivo?: string | null
}

/** Motivo de uma frase curta não servir como justificativa. */
export const TAMANHO_MINIMO_DO_MOTIVO_DE_PUBLICACAO = 10

// ── A publicação ────────────────────────────────────────────────────────

export interface Publicacao {
  id: string
  workspaceId: string
  /** O criativo distribuído. */
  contentId: string
  /**
   * NÃO é coluna: o produto é derivado de `Conteudo.produtoId`. Duplicá-lo
   * aqui criaria duas verdades que podem divergir.
   */
  destino: DestinoDaPublicacao
  estado: EstadoDaPublicacao
  /**
   * Chave de IDEMPOTÊNCIA da tentativa, gerada UMA VEZ por quem inicia a
   * publicação e reenviada em cada retry. Ver `chaveDeIdempotencia()`.
   */
  chaveDaTentativa: string
  /** Id no provider. `null` até existir — e ele pode nunca existir. */
  publicacaoExternaId?: string | null
  /** Instante REAL da distribuição. `null` enquanto não houver evidência. */
  distribuidaEm?: Date | null
  evidencia?: EvidenciaDePublicacao | null
  /** Ver `CARDINALIDADE_COM_LINK`. */
  linkId?: string | null
  /** Proveniência do REGISTRO, no mesmo vocabulário do P0.2. */
  dataOrigin: string
  criadaEm: Date
}

// ── Idempotência ────────────────────────────────────────────────────────

/**
 * ── POR QUE NÃO `contentId + canal + publicacaoExternaId` ───────────────
 * Porque `publicacaoExternaId` é `null` em três situações reais: publicação
 * manual, provider que não devolve id, e publicação ainda em processamento.
 * Uma chave que some quando o campo some não é chave — e, pior, colapsa
 * `(conteúdo, canal, null)` de duas publicações distintas na mesma linha,
 * que é exatamente a republicação que viemos resolver.
 *
 * ── AS DUAS CHAVES ──────────────────────────────────────────────────────
 * 1. PRIMÁRIA — `workspaceId + chaveDaTentativa`. Sempre existe, porque é
 *    gerada por quem inicia. Retry reenvia a mesma; republicação gera outra.
 *    É a chave que DISTINGUE retry de republicação, e ela é a intenção de
 *    quem publica, não um efeito colateral do provider.
 *
 * 2. EXTERNA — `workspaceId + provider + publicacaoExternaId`, só quando o
 *    id existe. Protege do caso oposto: o mesmo post do provider chegando
 *    duas vezes (webhook reentregue, adapter reprocessado) sob chaves de
 *    tentativa diferentes.
 *
 * As duas juntas cobrem os cinco casos: provider confirmado, manual,
 * republicação, retry e canais diferentes.
 */
export function chaveDeIdempotencia(p: { workspaceId: string; chaveDaTentativa: string }): string {
  return [p.workspaceId, p.chaveDaTentativa.trim()].join('|')
}

/**
 * FUNÇÃO PURA. `''` e espaço em branco viram `null` ANTES de gravar.
 *
 * ── POR QUE ISTO NÃO É FRESCURA ─────────────────────────────────────────
 * A constraint `(workspaceId, provider, publicacaoExternaId)` só vale
 * "somente quando há id" porque o Postgres trata NULLs como distintos. Uma
 * string vazia NÃO é NULL: ela é um valor comum, igual a si mesma.
 *
 * Gravar `''` faria a segunda publicação sem id do mesmo provider colidir
 * com a primeira — duas publicações legítimas, ambas sem id externo, e a
 * segunda recusada por engano. Pior: `chaveExternaDaPublicacao()` devolve
 * `null` para `''`, então o código concordaria que "não há id" enquanto o
 * banco trataria `''` como identidade. Duas leituras da mesma coluna.
 *
 * Toda escrita passa por aqui. Ausência de id é `null`, um valor só.
 */
export function normalizarPublicacaoExternaId(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const limpo = v.trim()
  return limpo === '' ? null : limpo
}

/** `null` quando ainda não há id externo — e isso é estado normal. */
export function chaveExternaDaPublicacao(p: {
  workspaceId: string
  provider: string
  publicacaoExternaId?: string | null
}): string | null {
  const id = normalizarPublicacaoExternaId(p?.publicacaoExternaId)
  if (!id || !p?.workspaceId?.trim() || !p?.provider?.trim()) return null
  return [p.workspaceId, p.provider.trim(), id].join('|')
}

/**
 * Duas publicações são a MESMA tentativa?
 *
 * Só quando compartilham a chave de tentativa, ou quando apontam para o
 * mesmo post no mesmo provider. Mesmo conteúdo + mesmo canal + instantes
 * diferentes são publicações DIFERENTES — é a definição de republicação.
 */
export function ehMesmaPublicacao(
  a: Pick<Publicacao, 'workspaceId' | 'chaveDaTentativa' | 'publicacaoExternaId' | 'destino'>,
  b: Pick<Publicacao, 'workspaceId' | 'chaveDaTentativa' | 'publicacaoExternaId' | 'destino'>
): boolean {
  if (chaveDeIdempotencia(a) === chaveDeIdempotencia(b)) return true
  const ea = chaveExternaDaPublicacao({ ...a, provider: a.destino?.provider })
  const eb = chaveExternaDaPublicacao({ ...b, provider: b.destino?.provider })
  return ea !== null && ea === eb
}

// ── Cardinalidade com LinkDinamico ──────────────────────────────────────

/**
 * ── 1 → 0..1, e o motivo é o schema, não preferência ────────────────────
 * `Conteudo.produtoId` é uma FK obrigatória e única: um conteúdo fala de UM
 * produto. Como `LinkDinamico` também aponta para um produto, uma
 * publicação daquele conteúdo precisa de no máximo um link.
 *
 * O `0` é real: uma publicação pode ir ao ar sem link rastreado — legado,
 * ou fail-closed quando a URL pública não está configurada. Melhor sem link
 * do que com um link apontando para `localhost`.
 *
 * O LINK CONTINUA APONTANDO PARA PRODUTO. A publicação acrescenta a origem
 * do clique; não substitui o destino dele.
 *
 * Isto vira 1 → 0..N no dia em que `Conteudo` puder falar de vários
 * produtos (um vídeo "top 5", por exemplo). A constante existe para que
 * essa mudança seja um lugar só, e não uma caçada.
 */
export const CARDINALIDADE_COM_LINK = {
  minimo: 0,
  maximo: 1,
  porque: 'Conteudo.produtoId é FK única — um conteúdo fala de um produto, então uma publicação precisa de no máximo um link.',
  viraVariosQuando: 'Conteudo passar a referenciar mais de um produto.',
} as const

// ── Validadores puros ───────────────────────────────────────────────────

export const MOTIVOS_PUBLICACAO_INVALIDA = [
  'WORKSPACE_AUSENTE',
  'CONTEUDO_AUSENTE',
  'CONTEUDO_DE_OUTRO_WORKSPACE',
  'DESTINO_INCOMPLETO',
  'PROVIDER_DESCONHECIDO',
  'CHAVE_DE_TENTATIVA_AUSENTE',
  'ESTADO_INVALIDO',
  'TRANSICAO_NAO_PERMITIDA',
  'LINK_DE_OUTRO_WORKSPACE',
  'LINK_DE_OUTRO_PRODUTO',
  'EXCEDE_CARDINALIDADE_DE_LINK',
  // Evidência
  'EVIDENCIA_AUSENTE',
  'TIPO_DE_EVIDENCIA_INVALIDO',
  'REFERENCIA_EXTERNA_AUSENTE',
  'ADAPTER_AUSENTE',
  'RESPONSAVEL_AUSENTE',
  'MOTIVO_AUSENTE',
  'MOTIVO_INSUFICIENTE',
  'SEM_INSTANTE_DE_DISTRIBUICAO',
] as const

export type MotivoPublicacaoInvalida = (typeof MOTIVOS_PUBLICACAO_INVALIDA)[number]

export type Validacao =
  | { ok: true }
  | { ok: false; motivo: MotivoPublicacaoInvalida; explicacao: string }

const recusar = (motivo: MotivoPublicacaoInvalida, explicacao: string): Validacao => ({
  ok: false,
  motivo,
  explicacao,
})

const texto = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const dataValida = (d: unknown): d is Date => d instanceof Date && Number.isFinite(d.getTime())

export interface ContextoDaPublicacao {
  /** Workspace do `Conteudo`, lido do banco por quem chama. */
  conteudoWorkspaceId?: string | null
  /** Provider existe no registry? Conferido por quem chama. */
  providerConhecido?: boolean
  /** Workspace e produto do link, quando houver link. */
  linkWorkspaceId?: string | null
  linkProdutoId?: string | null
  /** Produto do conteúdo, para conferir contra o do link. */
  conteudoProdutoId?: string | null
  /** Quantos links já estão ligados a esta publicação. */
  linksJaVinculados?: number
}

/**
 * Valida a identidade e a coerência da publicação.
 *
 * NUNCA confia em id vindo do cliente: `conteudoWorkspaceId`,
 * `linkWorkspaceId` e `providerConhecido` são apurados no servidor por quem
 * chama, e conferidos aqui. Um `contentId` de outro workspace é recusado
 * mesmo que o chamador jure que é dele.
 */
export function validarPublicacao(
  p: Partial<Publicacao>,
  contexto: ContextoDaPublicacao = {}
): Validacao {
  if (!texto(p?.workspaceId)) {
    return recusar('WORKSPACE_AUSENTE', 'Toda publicação pertence a um workspace — nunca opcional.')
  }
  if (!texto(p?.contentId)) {
    return recusar('CONTEUDO_AUSENTE', 'Publicação é a distribuição de um conteúdo; sem conteúdo não há o que publicar.')
  }
  if (contexto.conteudoWorkspaceId != null && contexto.conteudoWorkspaceId !== p.workspaceId) {
    return recusar(
      'CONTEUDO_DE_OUTRO_WORKSPACE',
      'O conteúdo informado não pertence a este workspace.'
    )
  }
  if (!texto(p?.destino?.provider) || !texto(p?.destino?.canal)) {
    return recusar('DESTINO_INCOMPLETO', 'Publicação exige provider e canal — quem distribuiu e onde apareceu.')
  }
  if (contexto.providerConhecido === false) {
    return recusar('PROVIDER_DESCONHECIDO', `Provider "${p.destino!.provider}" não está no registry de providers.`)
  }
  if (!texto(p?.chaveDaTentativa)) {
    return recusar(
      'CHAVE_DE_TENTATIVA_AUSENTE',
      'Sem chave de tentativa não há como distinguir um retry de uma republicação.'
    )
  }
  if (!p?.estado || !(ESTADOS_DA_PUBLICACAO as readonly string[]).includes(p.estado)) {
    return recusar('ESTADO_INVALIDO', `Estado "${p?.estado}" não existe.`)
  }

  if (texto(p?.linkId)) {
    if (contexto.linkWorkspaceId != null && contexto.linkWorkspaceId !== p.workspaceId) {
      return recusar('LINK_DE_OUTRO_WORKSPACE', 'O link informado não pertence a este workspace.')
    }
    if (
      contexto.linkProdutoId != null &&
      contexto.conteudoProdutoId != null &&
      contexto.linkProdutoId !== contexto.conteudoProdutoId
    ) {
      return recusar(
        'LINK_DE_OUTRO_PRODUTO',
        'O link aponta para produto diferente do produto do conteúdo — o clique iria para outro lugar.'
      )
    }
    if ((contexto.linksJaVinculados ?? 0) >= CARDINALIDADE_COM_LINK.maximo) {
      return recusar(
        'EXCEDE_CARDINALIDADE_DE_LINK',
        `Uma publicação aceita no máximo ${CARDINALIDADE_COM_LINK.maximo} link: ${CARDINALIDADE_COM_LINK.porque}`
      )
    }
  }

  return { ok: true }
}

/** Valida a evidência de que a publicação realmente foi ao ar. */
export function validarEvidenciaDePublicacao(e: EvidenciaDePublicacao | null | undefined): Validacao {
  if (!e) return recusar('EVIDENCIA_AUSENTE', 'Sem evidência não se afirma que a publicação circulou.')
  if (!(TIPOS_DE_EVIDENCIA_DE_PUBLICACAO as readonly string[]).includes(e.tipo)) {
    return recusar('TIPO_DE_EVIDENCIA_INVALIDO', `"${e.tipo}" não é um tipo de evidência aceito.`)
  }
  if (!dataValida(e.confirmadaEm)) {
    return recusar(
      'SEM_INSTANTE_DE_DISTRIBUICAO',
      'Sem o instante da confirmação não dá para datar a amostra nem contar a janela de observação.'
    )
  }
  if (!texto(e.referenciaExterna)) {
    return recusar(
      'REFERENCIA_EXTERNA_AUSENTE',
      'Evidência sem referência conferível é afirmação, não prova.'
    )
  }
  if (e.tipo === 'CONFIRMACAO_DE_ADAPTER' && !texto(e.adapterId)) {
    return recusar('ADAPTER_AUSENTE', 'A confirmação precisa dizer QUAL adapter atestou.')
  }
  if (e.tipo === 'CORRECAO_MANUAL_AUDITADA') {
    if (!texto(e.responsavelUserId)) {
      return recusar('RESPONSAVEL_AUSENTE', 'Correção manual exige quem assinou.')
    }
    if (!texto(e.motivo)) {
      return recusar('MOTIVO_AUSENTE', 'Correção manual exige o motivo por escrito.')
    }
    if (e.motivo!.trim().length < TAMANHO_MINIMO_DO_MOTIVO_DE_PUBLICACAO) {
      return recusar(
        'MOTIVO_INSUFICIENTE',
        `O motivo precisa explicar a correção (mínimo ${TAMANHO_MINIMO_DO_MOTIVO_DE_PUBLICACAO} caracteres).`
      )
    }
  }
  return { ok: true }
}

export function validarTransicao(de: EstadoDaPublicacao, para: EstadoDaPublicacao): Validacao {
  if (!transicaoPermitida(de, para)) {
    return recusar('TRANSICAO_NAO_PERMITIDA', `Não existe transição de ${de} para ${para}.`)
  }
  return { ok: true }
}

// ── Capacidades habilitadas pela distribuição ───────────────────────────

export const CAPACIDADES_DA_PUBLICACAO = [
  'INICIAR_JANELA_DE_OBSERVACAO',
  'CAPTURAR_SNAPSHOT_DE_PRODUCAO',
  'GERAR_LINK_ATRIBUIVEL',
  'PARTICIPAR_DE_METRICAS_REAIS',
] as const

export type CapacidadeDaPublicacao = (typeof CAPACIDADES_DA_PUBLICACAO)[number]

export interface VereditoDeDistribuicao {
  distribuida: boolean
  capacidades: CapacidadeDaPublicacao[]
  /** Instante que ancora janela e `capturedAt`. `null` quando não distribuída. */
  distribuidaEm: Date | null
  motivo: MotivoPublicacaoInvalida | null
  explicacao: string
}

/**
 * AUTORIDADE ÚNICA: esta publicação realmente ocorreu?
 *
 * Estado interno sozinho não basta — `DISTRIBUIDA` é afirmação nossa. Só
 * `DISTRIBUIDA` **com evidência válida** habilita as quatro capacidades.
 *
 * `REMOVIDA` não habilita nada: o post saiu do ar. O que já foi capturado
 * permanece (observação histórica é imutável), mas a publicação não começa
 * janela nova nem entra em métrica nova. Uma publicação removida ANTES de a
 * janela fechar não deve gerar rótulo negativo — exposição parcial não
 * sustenta "não converteu". Essa regra é da janela, e fica declarada aqui
 * para quem a implementar na Etapa 2.
 */
export function avaliarDistribuicaoDaPublicacao(
  p: Pick<Publicacao, 'estado' | 'evidencia' | 'distribuidaEm'>
): VereditoDeDistribuicao {
  const negar = (motivo: MotivoPublicacaoInvalida, explicacao: string): VereditoDeDistribuicao => ({
    distribuida: false,
    capacidades: [],
    distribuidaEm: null,
    motivo,
    explicacao,
  })

  if (p?.estado !== 'DISTRIBUIDA') {
    return negar(
      'ESTADO_INVALIDO',
      `Publicação em ${p?.estado ?? 'estado desconhecido'} — só DISTRIBUIDA habilita medição.`
    )
  }

  const v = validarEvidenciaDePublicacao(p?.evidencia)
  if (!v.ok) return negar(v.motivo, v.explicacao)

  // O instante da evidência manda; `distribuidaEm` é espelho, e espelho
  // divergente não pode virar a fonte.
  const quando = p.evidencia!.confirmadaEm as Date

  return {
    distribuida: true,
    capacidades: [...CAPACIDADES_DA_PUBLICACAO],
    distribuidaEm: quando,
    motivo: null,
    explicacao: `Distribuição confirmada (${p.evidencia!.tipo}, ref. ${p.evidencia!.referenciaExterna}).`,
  }
}

export function publicacaoHabilita(
  p: Pick<Publicacao, 'estado' | 'evidencia' | 'distribuidaEm'>,
  capacidade: CapacidadeDaPublicacao
): boolean {
  return avaliarDistribuicaoDaPublicacao(p).capacidades.includes(capacidade)
}

// ── Atribuição do clique ────────────────────────────────────────────────

/**
 * A cadeia, com as duas pontas que o P1.0 quer simultâneas:
 *
 *   EventoLink → LinkDinamico → Publicacao → Conteudo    (origem)
 *   EventoLink → LinkDinamico → Produto                  (destino)
 *
 * `referer` NÃO entra: é cabeçalho enviado pelo navegador, ausente em
 * aplicativo nativo e forjável por qualquer um. Serve para diagnóstico,
 * jamais para causalidade.
 */
export interface CadeiaDoClique {
  clickEventId: string
  workspaceId: string
  link?: { id: string; workspaceId: string; produtoId: string; publicacaoId?: string | null } | null
  publicacao?: { id: string; workspaceId: string; contentId: string; destino: DestinoDaPublicacao } | null
}

export const MOTIVOS_SEM_ATRIBUICAO = [
  'SEM_LINK',
  'SEM_PUBLICACAO_NO_LINK',
  'LINK_DE_OUTRO_WORKSPACE',
  'PUBLICACAO_DE_OUTRO_WORKSPACE',
  'PUBLICACAO_NAO_CORRESPONDE_AO_LINK',
] as const

export type MotivoSemAtribuicao = (typeof MOTIVOS_SEM_ATRIBUICAO)[number]

export interface AtribuicaoDoClique {
  /** Destino do clique — conhecido sempre que houver link. */
  produtoId: string | null
  /** Origem do clique. `null` quando o link não pertence a uma publicação. */
  publicacaoId: string | null
  contentId: string | null
  canal: string | null
  provider: string | null
  motivoSemPublicacao: MotivoSemAtribuicao | null
  explicacao: string
}

/**
 * FUNÇÃO PURA. Deriva o que a cadeia sustenta, e só isso.
 *
 * Produto e publicação são independentes: um clique pode ter produto
 * conhecido e origem desconhecida (link antigo, sem publicação), e isso é
 * informação verdadeira — não um buraco a preencher.
 */
export function derivarAtribuicaoDoClique(cadeia: CadeiaDoClique): AtribuicaoDoClique {
  const vazio = (motivo: MotivoSemAtribuicao, explicacao: string, produtoId: string | null = null): AtribuicaoDoClique => ({
    produtoId,
    publicacaoId: null,
    contentId: null,
    canal: null,
    provider: null,
    motivoSemPublicacao: motivo,
    explicacao,
  })

  const link = cadeia?.link
  if (!link) {
    return vazio('SEM_LINK', 'O evento não aponta para nenhum link — não há destino nem origem a derivar.')
  }
  if (link.workspaceId !== cadeia.workspaceId) {
    return vazio('LINK_DE_OUTRO_WORKSPACE', 'O link é de outro workspace; nada é derivado.')
  }

  const produtoId = link.produtoId ?? null

  if (!texto(link.publicacaoId)) {
    return vazio(
      'SEM_PUBLICACAO_NO_LINK',
      'O link não pertence a nenhuma publicação — clique atribuível a produto, não a criativo.',
      produtoId
    )
  }
  const pub = cadeia?.publicacao
  if (!pub) {
    return vazio('SEM_PUBLICACAO_NO_LINK', 'A publicação do link não foi carregada.', produtoId)
  }
  if (pub.workspaceId !== cadeia.workspaceId) {
    return vazio('PUBLICACAO_DE_OUTRO_WORKSPACE', 'A publicação é de outro workspace.', produtoId)
  }
  if (pub.id !== link.publicacaoId) {
    return vazio(
      'PUBLICACAO_NAO_CORRESPONDE_AO_LINK',
      'A publicação carregada não é a que o link aponta.',
      produtoId
    )
  }

  return {
    produtoId,
    publicacaoId: pub.id,
    contentId: pub.contentId,
    canal: pub.destino?.canal ?? null,
    provider: pub.destino?.provider ?? null,
    motivoSemPublicacao: null,
    explicacao: `Clique originado da publicação ${pub.id} (conteúdo ${pub.contentId}, ${pub.destino?.provider}/${pub.destino?.canal}), destino produto ${produtoId}.`,
  }
}

// ── Venda: derivação, sem coluna nova ───────────────────────────────────

/**
 * PROPOSTA — não implementada aqui.
 *
 *   Sale.clickEventId → EventoLink.linkId → LinkDinamico.publicacaoId
 *                     → Publicacao.contentId
 *
 * `Sale` NÃO ganha coluna. Duplicar `publicacaoId` nela criaria uma segunda
 * verdade que pode divergir do clique, e o P0.2 inteiro foi construído para
 * não ter duas versões do mesmo fato.
 *
 * Venda sem clique atribuído continua sem publicação — e isso é correto:
 * sem o clique não há evidência de qual distribuição originou a venda.
 * `Sale.contentId`, que já existe e é escolhido à mão, continua sendo o que
 * é: uma declaração da proprietária no nível do CRIATIVO, não da publicação.
 *
 * O ÚNICO motivo técnico que justificaria a coluna: um provider que informe
 * diretamente qual publicação gerou a venda, sem passar pelo nosso redirect.
 * Nesse dia a coluna nasce com evidência própria, não por conveniência.
 */
export const PROPOSTA_DE_ATRIBUICAO_DE_VENDA = {
  cadeia: 'Sale.clickEventId → EventoLink → LinkDinamico.publicacaoId → Publicacao.contentId',
  colunaNovaEmSale: false,
  porque:
    'Duplicar publicacaoId em Sale criaria uma segunda verdade divergente do clique. A derivação é única e auditável.',
  quandoJustificaria:
    'Provider que informe a publicação de origem da venda sem passar pelo redirect do Patrono.',
} as const

// ── ML: transição de geração ────────────────────────────────────────────

/**
 * Como migrar o Feature Store sem reescrever história.
 *
 * Hoje as amostras são `entityType = 'Conteudo'`, versão
 * `ml-features-v1-rodada9`. Quando a atribuição por publicação existir, a
 * entidade certa passa a ser `Publicacao` — a mesma peça publicada duas
 * vezes rende duas observações, que é o ponto.
 *
 * A transição usa o versionamento QUE JÁ EXISTE: sobe-se `FEATURE_VERSION`.
 * Amostras antigas continuam onde estão, íntegras e contáveis dentro da
 * geração delas. Nada é migrado, reescrito ou reconstruído — reconstruir
 * amostra é justamente o vazamento que o Bloco 4.1 eliminou.
 *
 * Consequência a assumir: as duas gerações não se somam para prontidão. O
 * contador passa a filtrar por versão, e o relógio do readiness recomeça na
 * geração nova. É o preço honesto de trocar a unidade de observação.
 */
export const TRANSICAO_DE_ML = {
  geracaoAtual: { entityType: 'Conteudo', featureVersion: 'ml-features-v1-rodada9' },
  geracaoFutura: { entityType: 'Publicacao', featureVersion: 'ml-features-v2-publicacao' },
  backfill: false,
  porque:
    'featureVersion já separa gerações. Reconstruir amostra antiga no formato novo usaria o estado ATUAL do conteúdo, que pode ter sido editado — o vazamento que o Bloco 4.1 eliminou.',
  consequencia: 'As gerações não se somam para prontidão; o contador passa a filtrar por featureVersion.',
} as const
