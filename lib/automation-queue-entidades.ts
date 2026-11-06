/**
 * Resolução da entidade de um job da Automation Queue (P1.3).
 *
 * ── O BURACO QUE ISTO FECHA ─────────────────────────────────────────────
 * `AutomationJob.entityType`/`entityId` é ponteiro POLIMÓRFICO de propósito:
 * hoje aponta para Produto, amanhã para Integracao, Publicacao, Conteudo ou
 * Canal, sem migration por tipo.
 *
 * O preço dessa flexibilidade é que o banco não consegue garantir que a
 * entidade apontada seja do MESMO workspace — não há FK composta possível
 * sobre uma coluna que aponta para tabelas diferentes.
 *
 * Então a garantia vem daqui, e de um jeito que não dá para esquecer: a
 * única porta de escrita da fila chama esta função ANTES de criar qualquer
 * job, e a entidade é lida do servidor, escopada pelo workspace.
 *
 * ── FAIL-CLOSED EM TODAS AS PONTAS ──────────────────────────────────────
 * Tipo fora do registry, entidade inexistente e entidade de outro workspace
 * recusam. As duas últimas devolvem a MESMA resposta de propósito: dizer
 * "existe, mas não é sua" confirmaria a existência de um id de outro
 * negócio para quem está sondando.
 */

import { prisma } from './prisma'

/**
 * Registry explícito. Acrescentar um tipo é acrescentar uma linha aqui —
 * e quem esquecer cai no fail-closed, não no silêncio.
 */
export const TIPOS_DE_ENTIDADE = ['PRODUTO', 'PUBLICACAO', 'CONTEUDO', 'INTEGRACAO', 'PUBLICACAO_ASSISTIDA'] as const
export type TipoDeEntidade = (typeof TIPOS_DE_ENTIDADE)[number]

export const MOTIVOS_ENTIDADE_INVALIDA = [
  'TIPO_DESCONHECIDO',
  /** Não existe, OU é de outro workspace. Deliberadamente indistinguíveis. */
  'ENTIDADE_NAO_ENCONTRADA',
  'PARAMETROS_INCOMPLETOS',
  'FALHA_AO_CONSULTAR',
] as const
export type MotivoEntidadeInvalida = (typeof MOTIVOS_ENTIDADE_INVALIDA)[number]

export interface VereditoDaEntidade {
  ok: boolean
  tipo: TipoDeEntidade | null
  motivo: MotivoEntidadeInvalida | null
  explicacao: string
  /** Dados mínimos da entidade, para o contexto do job. Nunca segredo. */
  resumo: Record<string, unknown> | null
}

/**
 * Como buscar cada tipo. Toda consulta é escopada por `workspaceId` — é a
 * linha que impede o vazamento entre negócios.
 */
type Buscador = (id: string, workspaceId: string) => Promise<Record<string, unknown> | null>

const BUSCADORES: Record<TipoDeEntidade, Buscador> = {
  PRODUTO: async (id, workspaceId) =>
    prisma.produto.findFirst({
      where: { id, workspaceId },
      select: { id: true, nome: true, status: true, providerId: true },
    }),
  PUBLICACAO: async (id, workspaceId) =>
    prisma.publicacao.findFirst({
      where: { id, workspaceId },
      select: { id: true, canal: true, provider: true, estado: true },
    }),
  CONTEUDO: async (id, workspaceId) =>
    prisma.conteudo.findFirst({
      where: { id, workspaceId },
      select: { id: true, status: true, redeSocial: true },
    }),
  INTEGRACAO: async (id, workspaceId) =>
    prisma.integracao.findFirst({
      where: { id, workspaceId },
      select: { id: true, plataforma: true, status: true },
    }),
  // P2.17.12: o render do vídeo do modo assistido.
  PUBLICACAO_ASSISTIDA: async (id, workspaceId) =>
    prisma.publicacaoAssistida.findFirst({
      where: { id, workspaceId },
      select: { id: true, estado: true, canal: true },
    }),
}

const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/**
 * Resolve e valida a entidade de um job.
 *
 * `workspaceId` vem do contexto AUTENTICADO — sessão, cron ou worker
 * pareado. Nunca do payload: aceitar workspace informado de fora tornaria
 * toda esta função decorativa.
 *
 * NUNCA lança: quem chama decide o que fazer com `ok: false`.
 */
export async function validarEntidadeDaAutomacao(params: {
  workspaceId: string
  entityType: string
  entityId: string
}): Promise<VereditoDaEntidade> {
  const recusar = (
    motivo: MotivoEntidadeInvalida,
    explicacao: string,
    tipo: TipoDeEntidade | null = null
  ): VereditoDaEntidade => ({ ok: false, tipo, motivo, explicacao, resumo: null })

  const workspaceId = texto(params?.workspaceId)
  const entityId = texto(params?.entityId)
  const entityType = texto(params?.entityType).toUpperCase()

  if (!workspaceId || !entityId || !entityType) {
    return recusar('PARAMETROS_INCOMPLETOS', 'workspaceId, entityType e entityId são obrigatórios juntos.')
  }

  if (!(TIPOS_DE_ENTIDADE as readonly string[]).includes(entityType)) {
    return recusar(
      'TIPO_DESCONHECIDO',
      `"${entityType}" não está no registry de entidades da automação. Acrescente-o explicitamente antes de enfileirar jobs desse tipo.`
    )
  }

  const tipo = entityType as TipoDeEntidade
  try {
    const achada = await BUSCADORES[tipo](entityId, workspaceId)
    if (!achada) {
      // MESMA resposta para "não existe" e "é de outro workspace". Separar
      // as duas confirmaria a existência de um id alheio.
      return recusar(
        'ENTIDADE_NAO_ENCONTRADA',
        `${tipo} não encontrada neste workspace.`,
        tipo
      )
    }
    return {
      ok: true,
      tipo,
      motivo: null,
      explicacao: `${tipo} ${entityId} confirmada neste workspace.`,
      resumo: achada,
    }
  } catch (e) {
    console.error(`[automation-queue] falha ao validar ${entityType} ${entityId}:`, e)
    return recusar('FALHA_AO_CONSULTAR', 'Não foi possível confirmar a entidade.', tipo)
  }
}

/**
 * REGRA PERMANENTE.
 *
 * Nenhum job entra na fila sem passar por `validarEntidadeDaAutomacao()`.
 * Há teste que varre o código e quebra se alguém escrever `AutomationJob`
 * fora do repositório central.
 */
export const ENTIDADE_EXIGE_VALIDACAO = {
  chave: 'automation-queue:entidade',
  funcaoObrigatoria: 'validarEntidadeDaAutomacao',
  porqueNaoEstaNoBanco:
    'entityType é polimórfico de propósito — não há FK composta possível sobre uma coluna que aponta para tabelas diferentes. Travar em Produto exigiria migration por tipo de pendência.',
} as const
