/**
 * P1.5.1 — Autorizações e scopes verificáveis.
 *
 * A pergunta que este arquivo responde: **o que esta conta realmente
 * autorizou?** Não "o que a plataforma oferece" (isso é `ChannelRegistry`),
 * nem "o que nós sabemos fazer" (isso é `IMPLEMENTACAO_POR_CANAL`), nem "o
 * que tem token" — ter token não é ter permissão.
 *
 * ── A CONTA DA CAPABILITY EFETIVA ───────────────────────────────────────
 *
 *   capability da plataforma
 *   × implementação do Patrono
 *   × scope concedido pela conta
 *   × aprovação do app pelo provider
 *   ──────────────────────────────────
 *   = capability EFETIVA da conta
 *
 * Só a capability efetiva libera execução. Qualquer fator ausente ou
 * ilegível derruba o produto a zero — `null` é bloqueio, não permissão.
 *
 * ── NENHUM SEGREDO SAI DAQUI ────────────────────────────────────────────
 * Nada que este módulo devolve contém token, refresh token, client secret
 * ou header de autorização. O que sai é provider, conta, scopes, validade,
 * capabilities efetivas e motivo do bloqueio — e só.
 *
 * ── NENHUMA PUBLICAÇÃO ──────────────────────────────────────────────────
 * Este módulo lê autorização. Ele não publica, não envia rascunho e não
 * chama adapter de canal.
 */

import { prisma } from './prisma'
import { capacidadeDoCanal, type ChannelCapability } from './channel-registry'
import { implementacaoDoCanal, type Implementacao } from './distribuicao-decisao'
import { chaveDoJob, type JobDesejado } from './automation-queue-contrato'

// ── Vocabulário ─────────────────────────────────────────────────────────

/**
 * O estado da AUTORIZAÇÃO, que é diferente do estado da CONEXÃO.
 *
 * `CONECTADA` responde "existe token aqui". As outras respondem "e o que
 * ele autoriza?" — que é a pergunta que decide execução.
 */
export const ESTADOS_DA_AUTORIZACAO = [
  /** Não há integração, ou ela foi desconectada. */
  'DESCONECTADA',
  /** Há token, e ainda não se sabe o que ele autoriza. */
  'CONECTADA',
  /** A validade venceu. Nada é autorizado até renovar. */
  'TOKEN_EXPIRADO',
  /** Não há registro de escopos: não dá para comprovar nada. */
  'SCOPES_NAO_VERIFICAVEIS',
  /** Há escopos comprovados, e falta algum dos exigidos. */
  'ESCOPO_INSUFICIENTE',
  /** Todos os escopos exigidos foram comprovados. */
  'SCOPES_COMPROVADOS',
] as const
export type EstadoDaAutorizacao = (typeof ESTADOS_DA_AUTORIZACAO)[number]

export const MOTIVOS_DA_CONTA = [
  'DESCONECTADA',
  'SEM_TOKEN',
  'TOKEN_EXPIRADO',
  'PLATAFORMA_NAO_PERMITE',
  'ADAPTER_NAO_IMPLEMENTADO',
  'SCOPE_NAO_VERIFICAVEL',
  'ESCOPO_INSUFICIENTE',
  'APP_NAO_APROVADO',
] as const
export type MotivoDaConta = (typeof MOTIVOS_DA_CONTA)[number]

export type AcaoDeDistribuicao = 'PUBLICAR' | 'DRAFT'

// ── Aprovação do app ────────────────────────────────────────────────────

/**
 * O provider aprovou NOSSO app?
 *
 * Não é inferível do nosso lado, e não está persistido em lugar nenhum:
 * vem de uma afirmação explícita por ambiente. `null` = desconhecido, que é
 * a resposta certa quando ninguém afirmou nada — e é diferente de `false`,
 * que é uma reprovação conhecida.
 */
export const VARIAVEL_DE_APROVACAO: Record<string, string> = {
  tiktok: 'TIKTOK_APP_AUDITADO',
  instagram: 'META_APP_APROVADO',
  facebook: 'META_APP_APROVADO',
  youtube: 'YOUTUBE_APP_APROVADO',
  pinterest: 'PINTEREST_APP_APROVADO',
}

export function aprovacaoDoApp(
  canal: string,
  env: Record<string, string | undefined> = process.env
): boolean | null {
  const nome = VARIAVEL_DE_APROVACAO[(canal ?? '').trim().toLowerCase()]
  if (!nome) return null
  const valor = (env?.[nome] ?? '').trim().toLowerCase()
  if (valor === 'true') return true
  if (valor === 'false') return false
  return null
}

// ── A leitura pura ──────────────────────────────────────────────────────

/**
 * O que a camada de persistência entrega — SEM o token.
 *
 * `temToken` em vez de `accessToken` não é detalhe de estilo: é o que
 * impede que um segredo chegue a uma função pura que alguém pode logar,
 * serializar ou devolver numa resposta HTTP.
 */
export interface RegistroDaIntegracao {
  canal: string
  conectada: boolean
  temToken: boolean
  temRefreshToken: boolean
  expiraEm: Date | null
  contaId: string | null
  contaNome: string | null
  /** `null` = a conexão não registra escopo nenhum. */
  scopesComprovados: string[] | null
  /** Quando os escopos foram comprovados. `null` quando nunca foram. */
  scopesComprovadosEm: Date | null
}

export interface AutorizacaoDaConta {
  canal: string
  estado: EstadoDaAutorizacao
  contaId: string | null
  contaNome: string | null
  scopesComprovados: string[] | null
  /** Quando a plataforma confirmou esses escopos. `null` = nunca confirmou. */
  scopesComprovadosEm: Date | null
  scopesExigidosPelaImplementacao: string[]
  /** Exigidos que não foram comprovados. Vazio quando nada falta. */
  scopesFaltando: string[]
  expiraEm: Date | null
  expirado: boolean
  /** `true` quando dá para renovar sozinho, sem incomodar a proprietária. */
  podeRenovarSozinho: boolean
  aprovacaoDoApp: boolean | null
  explicacao: string
}

/** Os escopos que a NOSSA implementação precisa neste canal. */
export function scopesExigidosDoCanal(implementacao: Implementacao | null, aprovacaoDoAppConfirmada: boolean | null = null): string[] {
  if (!implementacao) return []
  const lista: string[] = []
  // P2.17.10: onde publicar direto exige a aprovação CONFIRMADA (TikTok), o
  // escopo de publicação só é exigido quando ela existe — sem ela, o caminho é o rascunho.
  const publicarConta = !implementacao.publicarExigeAprovacaoConfirmada || aprovacaoDoAppConfirmada === true
  if (implementacao.publicaDireto && implementacao.scopeParaPublicar && publicarConta) {
    lista.push(implementacao.scopeParaPublicar)
  }
  if (implementacao.enviaDraft && implementacao.scopeParaDraft) {
    lista.push(implementacao.scopeParaDraft)
  }
  return [...new Set(lista)]
}

/**
 * FUNÇÃO PURA. O estado da autorização desta conta.
 *
 * A ordem é fail-closed e vai do mais fundamental ao mais específico: sem
 * conexão nada mais importa; token vencido não autoriza nada, mesmo com
 * escopo comprovado; e escopo ilegível nunca vira escopo concedido.
 */
export function derivarAutorizacao(
  registro: RegistroDaIntegracao,
  opcoes: { agora?: Date; env?: Record<string, string | undefined> } = {}
): AutorizacaoDaConta {
  const canal = (registro?.canal ?? '').trim().toLowerCase()
  const agora = opcoes.agora ?? new Date()
  const implementacao = implementacaoDoCanal(canal)
  const aprovacao = aprovacaoDoApp(canal, opcoes.env ?? process.env)
  const exigidos = scopesExigidosDoCanal(implementacao, aprovacao)

  const base = {
    canal,
    contaId: registro?.contaId ?? null,
    contaNome: registro?.contaNome ?? null,
    scopesComprovados: registro?.scopesComprovados ?? null,
    scopesComprovadosEm: registro?.scopesComprovadosEm ?? null,
    scopesExigidosPelaImplementacao: exigidos,
    expiraEm: registro?.expiraEm ?? null,
    aprovacaoDoApp: aprovacao,
  }

  if (!registro?.conectada || !registro?.temToken) {
    return {
      ...base,
      estado: 'DESCONECTADA',
      scopesFaltando: exigidos,
      expirado: false,
      podeRenovarSozinho: false,
      explicacao: 'Não há conta conectada neste canal. Só a proprietária pode autorizar.',
    }
  }

  const expirado = !!registro.expiraEm && registro.expiraEm.getTime() <= agora.getTime()
  if (expirado) {
    return {
      ...base,
      estado: 'TOKEN_EXPIRADO',
      scopesFaltando: exigidos,
      expirado: true,
      // Renovar sozinho é possível quando existe refresh token guardado.
      podeRenovarSozinho: registro.temRefreshToken,
      explicacao: registro.temRefreshToken
        ? 'A validade venceu, e há refresh token: dá para renovar sozinho.'
        : 'A validade venceu e não há refresh token — precisa de nova autorização.',
    }
  }

  const comprovados = registro.scopesComprovados
  if (comprovados === null) {
    return {
      ...base,
      estado: 'SCOPES_NAO_VERIFICAVEIS',
      scopesFaltando: exigidos,
      expirado: false,
      podeRenovarSozinho: false,
      explicacao:
        'A conexão não registra quais permissões foram concedidas. Permissão não comprovada não é permissão.',
    }
  }

  const faltando = exigidos.filter((s) => !comprovados.includes(s))

  // Sem nada exigido, não há o que comprovar: a conta está conectada e o
  // que decide passa a ser a implementação, não o escopo.
  if (exigidos.length === 0) {
    return {
      ...base,
      estado: 'CONECTADA',
      scopesFaltando: [],
      expirado: false,
      podeRenovarSozinho: false,
      explicacao:
        'Conta conectada. Nenhum escopo é exigido porque não há implementação nossa que dependa de um.',
    }
  }

  if (faltando.length > 0) {
    return {
      ...base,
      estado: 'ESCOPO_INSUFICIENTE',
      scopesFaltando: faltando,
      expirado: false,
      podeRenovarSozinho: false,
      explicacao: `A conta não concedeu: ${faltando.join(', ')}. Concedidos: ${
        comprovados.length ? comprovados.join(', ') : 'nenhum'
      }.`,
    }
  }

  return {
    ...base,
    estado: 'SCOPES_COMPROVADOS',
    scopesFaltando: [],
    expirado: false,
    podeRenovarSozinho: false,
    explicacao: `Permissões comprovadas: ${comprovados.join(', ')}.`,
  }
}

// ── Capability efetiva ──────────────────────────────────────────────────

export interface PermissaoEfetiva {
  /** O produto dos quatro fatores. Só isto libera execução. */
  permitido: boolean
  plataformaPermite: boolean
  patronoImplementa: boolean
  /** `null` = não verificável, que bloqueia igual a `false`. */
  scopeConcedido: boolean | null
  aprovacaoDoApp: boolean | null
  scopeExigido: string | null
  bloqueio: MotivoDaConta | null
  explicacao: string
}

export interface CapabilityEfetiva {
  canal: string
  contaId: string | null
  estado: EstadoDaAutorizacao
  publicar: PermissaoEfetiva
  draft: PermissaoEfetiva
  /** `true` quando alguma das duas ações está liberada. */
  algoLiberado: boolean
}

function avaliarAcao(
  acao: AcaoDeDistribuicao,
  autorizacao: AutorizacaoDaConta,
  capability: ChannelCapability | null,
  implementacao: Implementacao | null
): PermissaoEfetiva {
  const plataformaPermite = acao === 'PUBLICAR' ? !!capability?.autoPublish : !!capability?.draftUpload
  const patronoImplementa = acao === 'PUBLICAR' ? !!implementacao?.publicaDireto : !!implementacao?.enviaDraft
  const scopeExigido =
    (acao === 'PUBLICAR' ? implementacao?.scopeParaPublicar : implementacao?.scopeParaDraft) ?? null

  const negar = (bloqueio: MotivoDaConta, explicacao: string, scopeConcedido: boolean | null = null) => ({
    permitido: false,
    plataformaPermite,
    patronoImplementa,
    scopeConcedido,
    aprovacaoDoApp: autorizacao.aprovacaoDoApp,
    scopeExigido,
    bloqueio,
    explicacao,
  })

  if (autorizacao.estado === 'DESCONECTADA') {
    return negar('DESCONECTADA', 'Não há conta conectada neste canal.')
  }
  if (autorizacao.estado === 'TOKEN_EXPIRADO') {
    return negar('TOKEN_EXPIRADO', 'A validade do acesso venceu — nada é autorizado até renovar.')
  }
  if (!plataformaPermite) {
    return negar('PLATAFORMA_NAO_PERMITE', `A plataforma não oferece ${acao.toLowerCase()} por API.`)
  }
  if (!patronoImplementa) {
    return negar(
      'ADAPTER_NAO_IMPLEMENTADO',
      `A plataforma permite, e não há implementação nossa para ${acao.toLowerCase()}.`
    )
  }
  if (scopeExigido) {
    if (autorizacao.scopesComprovados === null) {
      return negar('SCOPE_NAO_VERIFICAVEL', `Não dá para comprovar "${scopeExigido}" nesta conexão.`)
    }
    if (!autorizacao.scopesComprovados.includes(scopeExigido)) {
      return negar('ESCOPO_INSUFICIENTE', `A conta não concedeu "${scopeExigido}".`, false)
    }
  }
  // P2.17.10: Direct Post do TikTok só com a auditoria CONFIRMADA (sem ela, sai privado).
  if (acao === 'PUBLICAR' && implementacao?.publicarExigeAprovacaoConfirmada && autorizacao.aprovacaoDoApp !== true) {
    return negar('APP_NAO_APROVADO', 'Publicar direto exige a auditoria do app confirmada pela plataforma; sem ela, use o rascunho.', true)
  }
  // O rascunho do TikTok não depende da auditoria do Direct Post.
  if (acao === 'DRAFT' && implementacao?.draftDispensaAprovacaoDoApp) {
    return { permitido: true, plataformaPermite, patronoImplementa, scopeConcedido: scopeExigido ? true : null, aprovacaoDoApp: autorizacao.aprovacaoDoApp, scopeExigido, bloqueio: null, explicacao: 'Rascunho permitido: implementado e com o escopo concedido.' }
  }
  // Só a reprovação CONHECIDA bloqueia. `null` é desconhecido, e travar aqui
  // impediria canal que já publica hoje por uma pergunta que ninguém fez.
  if (autorizacao.aprovacaoDoApp === false) {
    return negar('APP_NAO_APROVADO', 'O provider ainda não aprovou este app.', true)
  }

  return {
    permitido: true,
    plataformaPermite,
    patronoImplementa,
    scopeConcedido: scopeExigido ? true : null,
    aprovacaoDoApp: autorizacao.aprovacaoDoApp,
    scopeExigido,
    bloqueio: null,
    explicacao: `Capability efetiva: ${acao.toLowerCase()} liberado nesta conta.`,
  }
}

/** Os quatro fatores, multiplicados. Autoridade única desta conta. */
export function capabilityEfetivaDaConta(autorizacao: AutorizacaoDaConta): CapabilityEfetiva {
  const capability = capacidadeDoCanal(autorizacao.canal) ?? null
  const implementacao = implementacaoDoCanal(autorizacao.canal)
  const publicar = avaliarAcao('PUBLICAR', autorizacao, capability, implementacao)
  const draft = avaliarAcao('DRAFT', autorizacao, capability, implementacao)
  return {
    canal: autorizacao.canal,
    contaId: autorizacao.contaId,
    estado: autorizacao.estado,
    publicar,
    draft,
    algoLiberado: publicar.permitido || draft.permitido,
  }
}

// ── A leitura do banco ──────────────────────────────────────────────────

/** Onde os escopos comprovados moram dentro de `Integracao.extraData`. */
export const CAMPO_DOS_SCOPES = 'scopesComprovados'
export const CAMPO_DA_COMPROVACAO = 'scopesComprovadosEm'

/**
 * Lê os escopos COMPROVADOS de `extraData`.
 *
 * `scope` (string) é o que o OAuth do TikTok já gravava e continua valendo:
 * veio do próprio provider na troca do código. `scopesComprovados` é o
 * campo desta rodada, preenchido quando conseguimos perguntar à plataforma.
 * Qualquer outra coisa é `null` — inclusive objeto sem nenhum dos dois.
 */
export function lerScopesComprovados(extraData: unknown): string[] | null {
  const extra = (extraData ?? null) as Record<string, unknown> | null
  if (!extra) return null

  const bruto = extra[CAMPO_DOS_SCOPES] ?? extra.scope ?? extra.scopes
  if (Array.isArray(bruto)) return bruto.map((s) => String(s).trim()).filter(Boolean)
  if (typeof bruto === 'string') {
    return bruto
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return null
}

function lerData(extraData: unknown, campo: string): Date | null {
  const extra = (extraData ?? null) as Record<string, unknown> | null
  const bruto = extra?.[campo]
  if (typeof bruto !== 'string' || !bruto.trim()) return null
  const d = new Date(bruto)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Lê a autorização de uma conta. NUNCA devolve token.
 *
 * O token é lido para saber se existe e descartado na mesma linha — o
 * objeto que sai daqui não tem onde guardá-lo.
 */
export async function lerAutorizacao(params: {
  workspaceId: string
  canal: string
  agora?: Date
  env?: Record<string, string | undefined>
}): Promise<AutorizacaoDaConta> {
  const canal = (params?.canal ?? '').trim().toLowerCase()

  const vazio: RegistroDaIntegracao = {
    canal,
    conectada: false,
    temToken: false,
    temRefreshToken: false,
    expiraEm: null,
    contaId: null,
    contaNome: null,
    scopesComprovados: null,
    scopesComprovadosEm: null,
  }

  if (!params?.workspaceId?.trim() || !canal) {
    return derivarAutorizacao(vazio, { agora: params?.agora, env: params?.env })
  }

  let linha: {
    status: string
    accessToken: string | null
    refreshToken: string | null
    tokenExpiry: Date | null
    accountId: string | null
    accountName: string | null
    extraData: unknown
  } | null = null

  try {
    linha = await prisma.integracao.findFirst({
      // O workspace entra na consulta: conta de outro negócio nunca pode
      // autorizar coisa alguma aqui, e responde igual a inexistente.
      where: { workspaceId: params.workspaceId, plataforma: canal },
      select: {
        status: true,
        accessToken: true,
        refreshToken: true,
        tokenExpiry: true,
        accountId: true,
        accountName: true,
        extraData: true,
      },
    })
  } catch {
    // Banco indisponível não vira autorização: continua bloqueado.
    return derivarAutorizacao(vazio, { agora: params?.agora, env: params?.env })
  }

  if (!linha) return derivarAutorizacao(vazio, { agora: params?.agora, env: params?.env })

  const registro: RegistroDaIntegracao = {
    canal,
    conectada: linha.status === 'conectado',
    temToken: !!linha.accessToken,
    temRefreshToken: !!linha.refreshToken,
    expiraEm: linha.tokenExpiry ?? null,
    contaId: linha.accountId ?? null,
    contaNome: linha.accountName ?? null,
    scopesComprovados: lerScopesComprovados(linha.extraData),
    scopesComprovadosEm: lerData(linha.extraData, CAMPO_DA_COMPROVACAO),
  }

  return derivarAutorizacao(registro, { agora: params?.agora, env: params?.env })
}

// ── O que pode sair para fora ───────────────────────────────────────────

export interface ResumoPublicoDaIntegracao {
  provider: string
  conta: { id: string | null; nome: string | null }
  estado: EstadoDaAutorizacao
  scopes: string[] | null
  scopesComprovadosEm: string | null
  scopesFaltando: string[]
  validade: { expiraEm: string | null; expirado: boolean; podeRenovarSozinho: boolean }
  capabilities: { publicar: boolean; draft: boolean }
  bloqueio: { publicar: MotivoDaConta | null; draft: MotivoDaConta | null }
  motivo: string
}

/**
 * O ÚNICO formato que sai numa resposta HTTP ou num log.
 *
 * É uma lista branca, não uma lista negra: campos novos de `Integracao` não
 * passam a vazar sozinhos porque alguém esqueceu de acrescentá-los a um
 * `omit`. O que não está escrito aqui não sai.
 */
export function resumoPublicoDaIntegracao(
  autorizacao: AutorizacaoDaConta,
  capability?: CapabilityEfetiva
): ResumoPublicoDaIntegracao {
  const efetiva = capability ?? capabilityEfetivaDaConta(autorizacao)
  return {
    provider: autorizacao.canal,
    conta: { id: autorizacao.contaId, nome: autorizacao.contaNome },
    estado: autorizacao.estado,
    scopes: autorizacao.scopesComprovados,
    scopesComprovadosEm: autorizacao.scopesComprovadosEm
      ? autorizacao.scopesComprovadosEm.toISOString()
      : null,
    scopesFaltando: autorizacao.scopesFaltando,
    validade: {
      expiraEm: autorizacao.expiraEm ? autorizacao.expiraEm.toISOString() : null,
      expirado: autorizacao.expirado,
      podeRenovarSozinho: autorizacao.podeRenovarSozinho,
    },
    capabilities: { publicar: efetiva.publicar.permitido, draft: efetiva.draft.permitido },
    bloqueio: { publicar: efetiva.publicar.bloqueio, draft: efetiva.draft.bloqueio },
    motivo: autorizacao.explicacao,
  }
}

// ── A fila que já existe ────────────────────────────────────────────────

/** P1.5.1: renovar acesso é trabalho de máquina, não de pessoa. */
export const TIPO_JOB_RENOVAR_TOKEN = 'RENOVAR_TOKEN'

/**
 * A pendência que esta autorização gera na Automation Queue — se gerar.
 *
 * Nenhuma fila nova: os tipos já existem e cada um traz a classe certa.
 * O que muda entre eles é quem destrava — e é isso que impede o executor de
 * queimar tentativa para sempre num OAuth que só a proprietária concede.
 */
export function dependenciaDaAutorizacao(params: {
  workspaceId: string
  integracaoId: string
  autorizacao: AutorizacaoDaConta
}): JobDesejado | null {
  const { autorizacao } = params
  const canal = autorizacao.canal

  const montar = (
    tipo: string,
    classe: 'AUTOMATIZAVEL' | 'EXIGE_HUMANO' | 'AGUARDA_CONDICAO',
    motivoHumano: string | null,
    explicacao: string,
    extra: Record<string, unknown> = {}
  ): JobDesejado => {
    const contexto: Record<string, unknown> = { canal, motivo: autorizacao.estado, custoEstimado: 0, ...extra }
    return {
      chave: chaveDoJob({
        workspaceId: params.workspaceId,
        tipo,
        entityType: 'INTEGRACAO',
        entityId: params.integracaoId,
        contexto,
      }),
      tipo,
      entityType: 'INTEGRACAO',
      entityId: params.integracaoId,
      classe,
      motivoHumano,
      contexto,
      explicacao,
    } as JobDesejado
  }

  if (autorizacao.estado === 'DESCONECTADA') {
    return montar(
      'CONECTAR_CANAL',
      'EXIGE_HUMANO',
      'OAUTH_AUTHORIZATION_REQUIRED',
      `Conectar ${canal}: só a proprietária pode autorizar.`
    )
  }

  if (autorizacao.estado === 'TOKEN_EXPIRADO') {
    return autorizacao.podeRenovarSozinho
      ? montar(
          TIPO_JOB_RENOVAR_TOKEN,
          'AUTOMATIZAVEL',
          null,
          `Renovar o acesso de ${canal} pelo refresh token — sem incomodar a proprietária.`
        )
      : montar(
          'CONECTAR_CANAL',
          'EXIGE_HUMANO',
          'TOKEN_EXPIRED',
          `O acesso de ${canal} venceu e não há refresh token: precisa de nova autorização.`
        )
  }

  if (autorizacao.estado === 'SCOPES_NAO_VERIFICAVEIS' || autorizacao.estado === 'ESCOPO_INSUFICIENTE') {
    return montar(
      'CONECTAR_CANAL',
      'EXIGE_HUMANO',
      'OAUTH_AUTHORIZATION_REQUIRED',
      `Nova autorização em ${canal}: ${autorizacao.explicacao}`,
      { scopesFaltando: autorizacao.scopesFaltando }
    )
  }

  // Escopos comprovados e o provider reprovou o app: não há o que pedir à
  // proprietária, e não há o que tentar. O sistema observa a condição.
  if (autorizacao.aprovacaoDoApp === false) {
    return montar(
      'HABILITAR_CAPACIDADE',
      'AGUARDA_CONDICAO',
      null,
      `${canal}: o provider ainda não aprovou o app. Nenhuma tentativa destrava isso.`
    )
  }

  return null
}

/**
 * REGRA PERMANENTE.
 *
 * Ter token não é ter permissão, e conexão não é autorização. Entre uma e
 * outra está a comprovação — e o que não foi comprovado não libera nada.
 */
export const TOKEN_NAO_E_PERMISSAO = {
  chave: 'autorizacao:token-nao-e-permissao',
  fatores: [
    'capability da plataforma',
    'implementação do Patrono',
    'scope concedido pela conta',
    'aprovação do app pelo provider',
  ],
  porque:
    'Um token abre a porta da API; ele não diz o que a conta deixou fazer. Assumir scope por causa de token é como tratar recibo de entrega como licença de uso.',
  nuncaRetornar: ['accessToken', 'refreshToken', 'clientSecret', 'appSecret', 'authorization header'],
} as const
