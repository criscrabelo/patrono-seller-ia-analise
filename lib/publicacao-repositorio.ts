/**
 * Autoridade única da `Publicacao` (P1.0 — Etapa 2.c).
 *
 * Toda criação, reuso e transição de estado passa por aqui. As rotas de
 * publicação chamam estas funções; nenhuma delas reimplementa a regra.
 *
 * ── A SEQUÊNCIA ─────────────────────────────────────────────────────────
 *   Conteudo
 *     → Publicacao PREPARADA          obterOuCriarPublicacaoDaTentativa()
 *     → LinkDinamico criado/reusado   obterLinkRastreavelDaPublicacao()
 *     → vínculo validado e gravado    vincularLinkAPublicacao()
 *     → Publicacao DISTRIBUINDO       marcarDistribuindo()
 *     → provider
 *         sucesso → DISTRIBUIDA       marcarDistribuida()
 *         falha   → FALHOU            marcarFalhou()
 *
 * ── O QUE NUNCA ACONTECE AQUI ───────────────────────────────────────────
 * `workspaceId` jamais vem do frontend: quem chama passa o da sessão, e o
 * conteúdo é conferido contra ele. `produtoId` não é aceito de ninguém — o
 * destino sai de `Conteudo.produtoId`, lido no servidor.
 *
 * Nenhuma função lança por falha de provider ou de validação: publicar é o
 * fato principal, e o registro não pode derrubá-lo. Quem chama decide.
 */

import { prisma } from './prisma'
import {
  ESTADOS_DA_PUBLICACAO,
  transicaoPermitida,
  normalizarPublicacaoExternaId,
  type EstadoDaPublicacao,
} from './publicacao-contrato'
import { avaliarVinculoDeLinkComPublicacao } from './vinculo-publicacao-link'

// ── Vocabulário ─────────────────────────────────────────────────────────

export const MOTIVOS_PUBLICACAO_RECUSADA = [
  'PARAMETROS_INCOMPLETOS',
  'CONTEUDO_NAO_ENCONTRADO',
  'PUBLICACAO_NAO_ENCONTRADA',
  'TRANSICAO_NAO_PERMITIDA',
  /**
   * A chave da tentativa aponta para uma publicação, e o id externo do
   * provider aponta para OUTRA. Fail-closed: não se escolhe uma das duas.
   */
  'CONFLITO_DE_IDENTIDADE',
  'VINCULO_RECUSADO',
  'FALHA_AO_PERSISTIR',
] as const

export type MotivoPublicacaoRecusada = (typeof MOTIVOS_PUBLICACAO_RECUSADA)[number]

/** Ações auditadas desta etapa. */
export const ACAO_AUDIT_CONFLITO = 'publicacao.conflito_de_identidade'

export interface PublicacaoPersistida {
  id: string
  workspaceId: string
  contentId: string
  provider: string
  canal: string
  chaveDaTentativa: string
  estado: EstadoDaPublicacao
  publicacaoExternaId: string | null
  distribuidaEm: Date | null
}

export interface ResultadoDaPublicacao {
  ok: boolean
  publicacao: PublicacaoPersistida | null
  /** `false` quando a linha já existia — retry, não duplicata. */
  criada: boolean
  motivo: MotivoPublicacaoRecusada | null
  explicacao: string
}

const SELECAO = {
  id: true,
  workspaceId: true,
  contentId: true,
  provider: true,
  canal: true,
  chaveDaTentativa: true,
  estado: true,
  publicacaoExternaId: true,
  distribuidaEm: true,
} as const

const recusar = (
  motivo: MotivoPublicacaoRecusada,
  explicacao: string,
  publicacao: PublicacaoPersistida | null = null
): ResultadoDaPublicacao => ({ ok: false, publicacao, criada: false, motivo, explicacao })

const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

// ── Criação / reuso ─────────────────────────────────────────────────────

/**
 * Prepara — ou reencontra — a `Publicacao` desta tentativa.
 *
 * IDEMPOTENTE pela chave da tentativa. Retry reenvia a mesma chave e
 * reencontra a mesma linha; republicação manda chave nova e nasce outra
 * publicação. É o que separa os dois casos, e é decisão de quem publica,
 * não efeito colateral do provider.
 *
 * A corrida entre duas chamadas simultâneas é resolvida pelo BANCO: a
 * unique `(workspaceId, chaveDaTentativa)` recusa a segunda inserção, e
 * aqui isso é tratado como idempotência, não como erro.
 */
export async function obterOuCriarPublicacaoDaTentativa(params: {
  workspaceId: string
  contentId: string
  provider: string
  canal: string
  chaveDaTentativa: string
  dataOrigin?: string
}): Promise<ResultadoDaPublicacao> {
  const workspaceId = texto(params?.workspaceId)
  const contentId = texto(params?.contentId)
  const provider = texto(params?.provider).toUpperCase()
  const canal = texto(params?.canal).toLowerCase()
  const chaveDaTentativa = texto(params?.chaveDaTentativa)
  const dataOrigin = texto(params?.dataOrigin) || 'UNVERIFIED'

  if (!workspaceId || !contentId || !provider || !canal || !chaveDaTentativa) {
    return recusar(
      'PARAMETROS_INCOMPLETOS',
      'workspaceId, contentId, provider, canal e chaveDaTentativa são obrigatórios juntos.'
    )
  }

  try {
    // O conteúdo precisa ser DESTE workspace. A FK composta também garante,
    // mas recusar aqui dá motivo legível em vez de erro de constraint.
    const conteudo = await prisma.conteudo.findFirst({
      where: { id: contentId, workspaceId },
      select: { id: true },
    })
    if (!conteudo) {
      return recusar('CONTEUDO_NAO_ENCONTRADO', 'Conteúdo não encontrado neste workspace.')
    }

    const existente = await prisma.publicacao.findUnique({
      where: { workspaceId_chaveDaTentativa: { workspaceId, chaveDaTentativa } },
      select: SELECAO,
    })
    if (existente) {
      return {
        ok: true,
        publicacao: existente as PublicacaoPersistida,
        criada: false,
        motivo: null,
        explicacao: 'Publicação desta tentativa já existia — retry reusa, nunca duplica.',
      }
    }

    const criada = await prisma.publicacao.create({
      data: { workspaceId, contentId, provider, canal, chaveDaTentativa, dataOrigin },
      select: SELECAO,
    })
    return {
      ok: true,
      publicacao: criada as PublicacaoPersistida,
      criada: true,
      motivo: null,
      explicacao: `Publicação PREPARADA para ${provider}/${canal}.`,
    }
  } catch (e) {
    // Corrida: a unique recusou a segunda inserção. Reencontra e devolve a
    // linha vencedora — dois pedidos simultâneos do mesmo retry não podem
    // virar erro para a usuária.
    const err = e as { code?: string }
    if (err?.code === 'P2002') {
      const vencedora = await prisma.publicacao
        .findUnique({
          where: { workspaceId_chaveDaTentativa: { workspaceId, chaveDaTentativa } },
          select: SELECAO,
        })
        .catch(() => null)
      if (vencedora) {
        return {
          ok: true,
          publicacao: vencedora as PublicacaoPersistida,
          criada: false,
          motivo: null,
          explicacao: 'Outra chamada criou esta publicação primeiro — idempotência, não erro.',
        }
      }
    }
    console.error(`[publicacao] falha ao preparar publicação do conteúdo ${contentId}:`, e)
    return recusar('FALHA_AO_PERSISTIR', 'Não foi possível preparar a publicação.')
  }
}

// ── Vínculo com o link ──────────────────────────────────────────────────

/**
 * ÚNICO caminho que grava `LinkDinamico.publicacaoId`.
 *
 * Chama `avaliarVinculoDeLinkComPublicacao()` ANTES de qualquer escrita —
 * é ele que garante o invariante que o banco não garante: o link tem de
 * apontar para o produto do conteúdo da publicação.
 *
 * Idempotente: revincular o MESMO link à MESMA publicação não é erro.
 */
export async function vincularLinkAPublicacao(params: {
  workspaceId: string
  contentId: string
  publicacaoId: string
  linkId: string
}): Promise<ResultadoDaPublicacao> {
  const workspaceId = texto(params?.workspaceId)
  const contentId = texto(params?.contentId)
  const publicacaoId = texto(params?.publicacaoId)
  const linkId = texto(params?.linkId)

  if (!workspaceId || !contentId || !publicacaoId || !linkId) {
    return recusar('PARAMETROS_INCOMPLETOS', 'workspaceId, contentId, publicacaoId e linkId são obrigatórios.')
  }

  try {
    const atual = await prisma.linkDinamico.findFirst({
      where: { id: linkId, workspaceId },
      select: { publicacaoId: true },
    })

    // O GUARD. Sem ele nenhuma escrita acontece.
    const veredito = await avaliarVinculoDeLinkComPublicacao({
      workspaceId,
      contentId,
      linkId,
      publicacaoId,
      publicacaoIdAtualDoLink: atual?.publicacaoId ?? null,
    })
    if (!veredito.ok) {
      return recusar('VINCULO_RECUSADO', veredito.explicacao)
    }

    if (atual?.publicacaoId !== publicacaoId) {
      await prisma.linkDinamico.update({ where: { id: linkId }, data: { publicacaoId } })
    }

    const publicacao = await prisma.publicacao.findFirst({
      where: { id: publicacaoId, workspaceId },
      select: SELECAO,
    })
    return {
      ok: true,
      publicacao: (publicacao as PublicacaoPersistida) ?? null,
      criada: false,
      motivo: null,
      explicacao:
        atual?.publicacaoId === publicacaoId
          ? 'Link já estava vinculado a esta publicação.'
          : 'Link vinculado à publicação.',
    }
  } catch (e) {
    console.error(`[publicacao] falha ao vincular link ${linkId} à publicação ${publicacaoId}:`, e)
    return recusar('FALHA_AO_PERSISTIR', 'Não foi possível vincular o link à publicação.')
  }
}

// ── Evidência ───────────────────────────────────────────────────────────

/**
 * Campos que PODEM entrar na evidência. Whitelist, não blacklist.
 *
 * A diferença importa: com blacklist, todo campo novo que o provider
 * inventar entra por padrão, e um dia entra um token. Aqui, o que não está
 * nesta lista simplesmente não é gravado.
 */
export const CAMPOS_DE_EVIDENCIA = ['tipo', 'provider', 'canal', 'referenciaExterna', 'confirmadaEm', 'resultado'] as const

export interface EvidenciaSegura {
  tipo: string
  provider: string
  canal: string
  referenciaExterna: string | null
  confirmadaEm: string
  resultado: string
}

/**
 * FUNÇÃO PURA. Monta a evidência com metadados não sensíveis, e só.
 *
 * Nunca recebe nem grava token, secret, header de autenticação ou payload
 * bruto do provider. A prova de que a publicação circulou é o id externo
 * mais o instante — o resto é risco sem ganho.
 */
export function montarEvidenciaDeDistribuicao(p: {
  provider: string
  canal: string
  publicacaoExternaId?: string | null
  confirmadaEm?: Date | null
  resultado?: string | null
}): EvidenciaSegura {
  const quando =
    p?.confirmadaEm instanceof Date && Number.isFinite(p.confirmadaEm.getTime())
      ? p.confirmadaEm
      : new Date()
  return {
    tipo: 'ID_EXTERNO_DO_PROVIDER',
    provider: texto(p?.provider).toUpperCase(),
    canal: texto(p?.canal).toLowerCase(),
    referenciaExterna: normalizarPublicacaoExternaId(p?.publicacaoExternaId),
    confirmadaEm: quando.toISOString(),
    resultado: texto(p?.resultado) || 'PUBLICADO',
  }
}

// ── Transições ──────────────────────────────────────────────────────────

async function transicionar(
  workspaceId: string,
  publicacaoId: string,
  para: EstadoDaPublicacao,
  dadosExtras: Record<string, unknown> = {}
): Promise<ResultadoDaPublicacao> {
  if (!texto(workspaceId) || !texto(publicacaoId)) {
    return recusar('PARAMETROS_INCOMPLETOS', 'workspaceId e publicacaoId são obrigatórios.')
  }
  if (!(ESTADOS_DA_PUBLICACAO as readonly string[]).includes(para)) {
    return recusar('TRANSICAO_NAO_PERMITIDA', `Estado "${para}" não existe.`)
  }

  try {
    const atual = await prisma.publicacao.findFirst({
      where: { id: publicacaoId, workspaceId },
      select: SELECAO,
    })
    if (!atual) {
      return recusar('PUBLICACAO_NAO_ENCONTRADA', 'Publicação não encontrada neste workspace.')
    }

    // Reentrada no MESMO estado é idempotência, não transição.
    if (atual.estado === para) {
      return {
        ok: true,
        publicacao: atual as PublicacaoPersistida,
        criada: false,
        motivo: null,
        explicacao: `Publicação já estava ${para}.`,
      }
    }

    if (!transicaoPermitida(atual.estado as EstadoDaPublicacao, para)) {
      return recusar(
        'TRANSICAO_NAO_PERMITIDA',
        `A máquina de estados não permite ${atual.estado} → ${para}.`,
        atual as PublicacaoPersistida
      )
    }

    const atualizada = await prisma.publicacao.update({
      where: { id: publicacaoId },
      data: { estado: para, ...dadosExtras },
      select: SELECAO,
    })
    return {
      ok: true,
      publicacao: atualizada as PublicacaoPersistida,
      criada: false,
      motivo: null,
      explicacao: `${atual.estado} → ${para}.`,
    }
  } catch (e) {
    console.error(`[publicacao] falha na transição ${publicacaoId} → ${para}:`, e)
    return recusar('FALHA_AO_PERSISTIR', 'Não foi possível registrar a transição.')
  }
}

/**
 * P2.27 — RESERVA ATÔMICA DO ENVIO: só quem tira a publicação de PREPARADA/FALHOU para DISTRIBUINDO pode
 * chamar o provider. Duas chamadas ao mesmo tempo (duas abas, retry da fila, processo que morreu depois
 * de enviar) não chegam as duas ao adapter: a segunda recebe `reservou: false` com o estado atual.
 */
export async function reservarEnvio(params: { workspaceId: string; publicacaoId: string }): Promise<{ reservou: boolean; estado: string | null }> {
  const r = await prisma.publicacao.updateMany({
    where: { id: params.publicacaoId, workspaceId: params.workspaceId, estado: { in: ['PREPARADA', 'FALHOU'] } },
    data: { estado: 'DISTRIBUINDO' },
  })
  if (r.count === 1) return { reservou: true, estado: 'DISTRIBUINDO' }
  const atual = await prisma.publicacao.findFirst({ where: { id: params.publicacaoId, workspaceId: params.workspaceId }, select: { estado: true } })
  return { reservou: false, estado: atual?.estado ?? null }
}

/** O provider recebeu e está processando. Ainda não há prova de exposição. */
export async function marcarDistribuindo(params: {
  workspaceId: string
  publicacaoId: string
}): Promise<ResultadoDaPublicacao> {
  return transicionar(params?.workspaceId, params?.publicacaoId, 'DISTRIBUINDO')
}

/** Tentou e não foi. Retry usa a MESMA chave e volta a DISTRIBUINDO. */
export async function marcarFalhou(params: {
  workspaceId: string
  publicacaoId: string
}): Promise<ResultadoDaPublicacao> {
  return transicionar(params?.workspaceId, params?.publicacaoId, 'FALHOU')
}

/**
 * Confirmada pelo canal. É o único estado que habilita medição.
 *
 * ── CONFLITO DE IDENTIDADE ──────────────────────────────────────────────
 * O id externo pode apontar para OUTRA publicação já registrada — webhook
 * reentregue, adapter reprocessado, ou um bug de chave de tentativa. Aí
 * temos duas identidades discordando sobre a mesma coisa.
 *
 * Não escolhemos uma. Fail-closed, auditamos, e quem chama decide. Fazer
 * merge silencioso juntaria duas publicações que podem ser distintas de
 * verdade, e o histórico não se desfaz depois.
 */
export async function marcarDistribuida(params: {
  workspaceId: string
  publicacaoId: string
  publicacaoExternaId?: string | null
  distribuidaEm?: Date | null
  resultado?: string | null
}): Promise<ResultadoDaPublicacao> {
  const workspaceId = texto(params?.workspaceId)
  const publicacaoId = texto(params?.publicacaoId)
  if (!workspaceId || !publicacaoId) {
    return recusar('PARAMETROS_INCOMPLETOS', 'workspaceId e publicacaoId são obrigatórios.')
  }

  // SEMPRE normalizado: '' e espaços nunca chegam ao banco, porque lá eles
  // não seriam "ausência de id" e colidiriam com a próxima publicação sem id.
  const idExterno = normalizarPublicacaoExternaId(params?.publicacaoExternaId)
  const quando =
    params?.distribuidaEm instanceof Date && Number.isFinite(params.distribuidaEm.getTime())
      ? params.distribuidaEm
      : new Date()

  try {
    const alvo = await prisma.publicacao.findFirst({
      where: { id: publicacaoId, workspaceId },
      select: SELECAO,
    })
    if (!alvo) {
      return recusar('PUBLICACAO_NAO_ENCONTRADA', 'Publicação não encontrada neste workspace.')
    }

    if (idExterno) {
      const donoDoIdExterno = await prisma.publicacao.findFirst({
        where: { workspaceId, provider: alvo.provider, publicacaoExternaId: idExterno },
        select: { id: true, chaveDaTentativa: true },
      })
      if (donoDoIdExterno && donoDoIdExterno.id !== publicacaoId) {
        await prisma.auditLog
          .create({
            data: {
              workspaceId,
              action: ACAO_AUDIT_CONFLITO,
              entityType: 'Publicacao',
              entityId: publicacaoId,
              metadata: {
                // Identificadores, nunca credenciais nem payload.
                provider: alvo.provider,
                canal: alvo.canal,
                chaveDaTentativaDoAlvo: alvo.chaveDaTentativa,
                publicacaoQueJaTemOIdExterno: donoDoIdExterno.id,
                chaveDaTentativaDaOutra: donoDoIdExterno.chaveDaTentativa,
              },
            },
          })
          .catch((e) => console.error('[publicacao] falha ao auditar conflito:', e))

        return recusar(
          'CONFLITO_DE_IDENTIDADE',
          `A chave desta tentativa aponta para ${publicacaoId}, e o id externo do provider já pertence a ${donoDoIdExterno.id}. Nenhuma das duas é escolhida automaticamente.`,
          alvo as PublicacaoPersistida
        )
      }

      // Mesmo id externo na MESMA publicação: retry do provider. Idempotente.
      if (donoDoIdExterno && donoDoIdExterno.id === publicacaoId && alvo.estado === 'DISTRIBUIDA') {
        return {
          ok: true,
          publicacao: alvo as PublicacaoPersistida,
          criada: false,
          motivo: null,
          explicacao: 'Publicação já estava DISTRIBUIDA com este id externo — retry do provider.',
        }
      }
    }

    return transicionar(workspaceId, publicacaoId, 'DISTRIBUIDA', {
      publicacaoExternaId: idExterno,
      distribuidaEm: quando,
      evidencia: montarEvidenciaDeDistribuicao({
        provider: alvo.provider,
        canal: alvo.canal,
        publicacaoExternaId: idExterno,
        confirmadaEm: quando,
        resultado: params?.resultado,
      }) as unknown as Record<string, unknown>,
    })
  } catch (e) {
    console.error(`[publicacao] falha ao marcar distribuída ${publicacaoId}:`, e)
    return recusar('FALHA_AO_PERSISTIR', 'Não foi possível registrar a distribuição.')
  }
}

// ── Leitura ─────────────────────────────────────────────────────────────

/** A publicação desta tentativa, se existir. Somente leitura. */
export async function obterPublicacaoDaTentativa(params: {
  workspaceId: string
  chaveDaTentativa: string
}): Promise<PublicacaoPersistida | null> {
  const workspaceId = texto(params?.workspaceId)
  const chaveDaTentativa = texto(params?.chaveDaTentativa)
  if (!workspaceId || !chaveDaTentativa) return null
  return prisma.publicacao
    .findUnique({ where: { workspaceId_chaveDaTentativa: { workspaceId, chaveDaTentativa } }, select: SELECAO })
    .then((p) => (p as PublicacaoPersistida) ?? null)
    .catch(() => null)
}
