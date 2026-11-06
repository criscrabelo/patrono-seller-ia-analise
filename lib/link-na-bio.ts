/**
 * P1.9.2 — O link rastreado na bio: gerado, colocado e CONFIRMADO.
 *
 * No Instagram a legenda não é clicável e a API de publicação de conteúdo
 * não edita a bio nem cria link sticker. O link rastreado só chega ao
 * público se uma PESSOA o colar na bio. Até aqui o Patrono não distinguia
 * três coisas diferentes:
 *
 *   1. a estratégia está definida   (Instagram = BIO)
 *   2. o link rastreado foi gerado   (existe o LinkDinamico, o redirect responde)
 *   3. o link está de fato na bio    (alguém olhou o perfil e confirmou)
 *
 * Publicar com (1) e (2) sem (3) é publicar um post cuja CTA aponta para
 * uma bio que leva a outro lugar — o clique se perde, e a medição também.
 *
 * ── A CONFIRMAÇÃO É HUMANA, EXPLÍCITA E AUDITÁVEL ───────────────────────
 * Nenhuma API comprova (3) hoje, e não se inventa automação para isso. A
 * confirmação:
 *   - é feita por um usuário DO workspace, com nome;
 *   - vale para UMA URL — a da tentativa que vai ao ar. Republicar gera
 *     link novo, e o link novo exige confirmação nova;
 *   - fica em `Conteudo.alertasCompliance` e no `AuditLog`.
 *
 * Sem migration: os dois lugares já existem.
 */

import { prisma } from './prisma'
import { registrarAuditoria } from './audit-log'
import { estrategiaDeLinkDoCanal, type EstrategiaDeLink } from './capacidade-real-do-adapter'
import {
  lerBasePublica,
  montarUrlRastreada,
  slugDaPublicacao,
  chaveDaTentativaPadrao,
  obterLinkRastreavelDaPublicacao,
} from './link-de-publicacao'

export const TIPO_CONFIRMACAO_DE_LINK_NA_BIO = 'link_na_bio_confirmado'

export interface ConfirmacaoDeLinkNaBio {
  tipo: typeof TIPO_CONFIRMACAO_DE_LINK_NA_BIO
  severidade: 'verde'
  canal: string
  /** A URL exata que a pessoa viu na bio. */
  url: string
  chaveDaTentativa: string
  /** Id do usuário que confirmou. */
  confirmadoPor: string
  confirmadoEm: string
  /** A conta em que o link foi colocado, como a integração a nomeia. */
  conta: string | null
  mensagem: string
}

export type EstadoDoLinkNaBio =
  /** O canal não usa bio: o link vai na própria publicação. */
  | 'NAO_SE_APLICA'
  /** Não há como montar link (sem domínio público e sem destino). */
  | 'LINK_INDISPONIVEL'
  /** A URL existe, e ainda não foi reservada (o redirect não responde). */
  | 'LINK_NAO_GERADO'
  /** O link existe e ninguém confirmou que ele está na bio. */
  | 'AGUARDANDO_CONFIRMACAO'
  /** Uma pessoa confirmou ESTA URL na bio. */
  | 'CONFIRMADO'

export interface SituacaoDoLinkNaBio {
  estrategia: EstrategiaDeLink | null
  /** A URL que esta tentativa usa. `null` quando não há link possível. */
  url: string | null
  rastreada: boolean
  /** O LinkDinamico desta URL existe — o redirect responde. */
  gerado: boolean
  estado: EstadoDoLinkNaBio
  confirmacao: ConfirmacaoDeLinkNaBio | null
  /** Sem isto, nada pode ir ao ar. */
  liberaExecucao: boolean
  explicacao: string
}

// ── A URL da tentativa, sem gravar nada ─────────────────────────────────

/**
 * A URL que a tentativa vai divulgar: a rastreada quando dá, a direta do
 * produto quando não dá. MESMAS entradas de `obterLinkRastreavelDaPublicacao`
 * — é o que garante que o link confirmado na bio é o link publicado.
 */
export function urlDaTentativa(p: {
  workspaceId: string
  contentId: string
  canal: string
  chaveDaTentativa?: string | null
  dataAgendamento?: Date | null
  nomeProduto: string | null
  urlDiretaDoProduto: string | null
  env?: Record<string, string | undefined>
}): { url: string | null; rastreada: boolean; slug: string | null; chaveDaTentativa: string } {
  const canal = (p.canal ?? '').trim().toLowerCase()
  const chaveDaTentativa =
    (p.chaveDaTentativa ?? '').trim() ||
    chaveDaTentativaPadrao({ contentId: p.contentId, canal, dataAgendamento: p.dataAgendamento ?? null })
  const destino = (p.urlDiretaDoProduto ?? '').trim() || null
  const base = lerBasePublica(p.env ?? process.env)
  if (!destino) return { url: null, rastreada: false, slug: null, chaveDaTentativa }
  if (!base.ok) return { url: destino, rastreada: false, slug: null, chaveDaTentativa }
  const slug = slugDaPublicacao({
    workspaceId: p.workspaceId,
    contentId: p.contentId,
    chaveDaTentativa,
    canal,
    nomeProduto: p.nomeProduto,
  })
  return { url: montarUrlRastreada(base.baseUrl, slug), rastreada: true, slug, chaveDaTentativa }
}

// ── Leitura e decisão (puras) ───────────────────────────────────────────

export function lerConfirmacoesDeLinkNaBio(alertas: unknown[] | null | undefined): ConfirmacaoDeLinkNaBio[] {
  if (!Array.isArray(alertas)) return []
  return alertas
    .map((a) => (a ?? {}) as Record<string, unknown>)
    .filter(
      (a) =>
        a.tipo === TIPO_CONFIRMACAO_DE_LINK_NA_BIO &&
        typeof a.url === 'string' &&
        typeof a.confirmadoPor === 'string' &&
        typeof a.confirmadoEm === 'string'
    ) as unknown as ConfirmacaoDeLinkNaBio[]
}

/**
 * FUNÇÃO PURA. O link desta tentativa está onde precisa estar?
 *
 * A confirmação vale pela URL EXATA. Confirmação de outra URL — outra
 * tentativa, outro produto — não conta.
 */
export function avaliarLinkNaBio(p: {
  canal: string
  url: string | null
  rastreada: boolean
  gerado: boolean
  alertas: unknown[] | null | undefined
}): SituacaoDoLinkNaBio {
  const estrategia = estrategiaDeLinkDoCanal(p.canal)
  const base = { estrategia, url: p.url, rastreada: p.rastreada, gerado: p.gerado }

  if (estrategia !== 'BIO') {
    return {
      ...base,
      estado: 'NAO_SE_APLICA',
      confirmacao: null,
      liberaExecucao: true,
      explicacao: estrategia === 'LEGENDA' ? 'O link vai na própria publicação.' : 'Canal sem estratégia de bio.',
    }
  }
  if (!p.url) {
    return {
      ...base,
      estado: 'LINK_INDISPONIVEL',
      confirmacao: null,
      liberaExecucao: false,
      explicacao: 'Não há link para colocar na bio: o produto não tem destino cadastrado.',
    }
  }
  // Link rastreado ainda não reservado: colar na bio levaria a um 404.
  if (p.rastreada && !p.gerado) {
    return {
      ...base,
      estado: 'LINK_NAO_GERADO',
      confirmacao: null,
      liberaExecucao: false,
      explicacao: 'O link rastreado ainda não foi gerado. Gere-o antes de colar na bio, ou ele abrirá uma página inexistente.',
    }
  }
  const confirmacao = lerConfirmacoesDeLinkNaBio(p.alertas).find((c) => c.url === p.url && c.canal === p.canal) ?? null
  if (!confirmacao) {
    return {
      ...base,
      estado: 'AGUARDANDO_CONFIRMACAO',
      confirmacao: null,
      liberaExecucao: false,
      explicacao: `Coloque ${p.url} na bio do perfil e confirme. Sem a confirmação, nada vai ao ar.`,
    }
  }
  return {
    ...base,
    estado: 'CONFIRMADO',
    confirmacao,
    liberaExecucao: true,
    explicacao: `Link confirmado na bio por ${confirmacao.confirmadoPor} em ${confirmacao.confirmadoEm}.`,
  }
}

// ── Banco ───────────────────────────────────────────────────────────────

/** Lê a peça e devolve a situação do link desta tentativa. Só leitura. */
export async function situacaoDoLinkNaBio(params: {
  workspaceId: string
  contentId: string
  canal: string
  chaveDaTentativa?: string | null
  env?: Record<string, string | undefined>
}): Promise<SituacaoDoLinkNaBio | null> {
  const canal = (params.canal ?? '').trim().toLowerCase()
  const conteudo = await prisma.conteudo.findFirst({
    where: { id: params.contentId, workspaceId: params.workspaceId },
    select: {
      id: true,
      dataAgendamento: true,
      alertasCompliance: true,
      produto: { select: { nome: true, linkProduto: true } },
    },
  })
  if (!conteudo) return null
  const t = urlDaTentativa({
    workspaceId: params.workspaceId,
    contentId: conteudo.id,
    canal,
    chaveDaTentativa: params.chaveDaTentativa,
    dataAgendamento: conteudo.dataAgendamento,
    nomeProduto: conteudo.produto.nome,
    urlDiretaDoProduto: conteudo.produto.linkProduto,
    env: params.env,
  })
  const gerado = t.slug
    ? !!(await prisma.linkDinamico.findFirst({ where: { slug: t.slug, workspaceId: params.workspaceId }, select: { id: true } }))
    : true
  return avaliarLinkNaBio({ canal, url: t.url, rastreada: t.rastreada, gerado, alertas: conteudo.alertasCompliance })
}

/**
 * Gera (reserva) o link rastreado desta tentativa, SEM criar Publicacao.
 *
 * É o mesmo link que a publicação vai usar: mesmo slug, reaproveitado por
 * ela e vinculado na hora. Existir antes é o que permite colá-lo na bio
 * sem que o primeiro clique caia num 404.
 */
export async function gerarLinkParaABio(params: {
  workspaceId: string
  contentId: string
  canal: string
  chaveDaTentativa?: string | null
  env?: Record<string, string | undefined>
}): Promise<{ ok: boolean; url: string | null; explicacao: string }> {
  const r = await obterLinkRastreavelDaPublicacao({
    workspaceId: params.workspaceId,
    contentId: params.contentId,
    canal: (params.canal ?? '').trim().toLowerCase(),
    chaveDaTentativa: params.chaveDaTentativa ?? null,
    env: params.env,
  })
  return { ok: r.ok, url: r.urlPublica, explicacao: r.explicacao }
}

/**
 * A confirmação humana. Recusa — sem gravar nada — quando:
 *   - a peça não é deste workspace;
 *   - quem confirma não é usuário deste workspace;
 *   - a URL não é a desta tentativa;
 *   - o link rastreado ainda não foi gerado.
 */
export async function confirmarLinkNaBio(params: {
  workspaceId: string
  contentId: string
  canal: string
  url: string
  confirmadoPor: string
  chaveDaTentativa?: string | null
  agora?: Date
  env?: Record<string, string | undefined>
}): Promise<{ ok: boolean; explicacao: string; confirmacao: ConfirmacaoDeLinkNaBio | null }> {
  const canal = (params.canal ?? '').trim().toLowerCase()
  const recusa = (explicacao: string) => ({ ok: false, explicacao, confirmacao: null })

  if (estrategiaDeLinkDoCanal(canal) !== 'BIO') return recusa(`${canal} não usa link na bio.`)

  const usuario = await prisma.user.findFirst({
    where: { id: params.confirmadoPor, workspaceId: params.workspaceId },
    select: { id: true },
  })
  if (!usuario) return recusa('Quem confirma precisa ser usuário deste workspace.')

  const conteudo = await prisma.conteudo.findFirst({
    where: { id: params.contentId, workspaceId: params.workspaceId },
    select: {
      id: true,
      dataAgendamento: true,
      alertasCompliance: true,
      produto: { select: { nome: true, linkProduto: true } },
    },
  })
  if (!conteudo) return recusa('Conteúdo não encontrado neste workspace.')

  const t = urlDaTentativa({
    workspaceId: params.workspaceId,
    contentId: conteudo.id,
    canal,
    chaveDaTentativa: params.chaveDaTentativa,
    dataAgendamento: conteudo.dataAgendamento,
    nomeProduto: conteudo.produto.nome,
    urlDiretaDoProduto: conteudo.produto.linkProduto,
    env: params.env,
  })
  if (!t.url) return recusa('Esta tentativa não tem link para a bio.')
  if ((params.url ?? '').trim() !== t.url) {
    return recusa(`A URL informada não é a desta tentativa. A da tentativa é ${t.url}.`)
  }
  if (t.slug) {
    const link = await prisma.linkDinamico.findFirst({
      where: { slug: t.slug, workspaceId: params.workspaceId },
      select: { id: true },
    })
    if (!link) return recusa('O link rastreado ainda não foi gerado — gere-o antes de colar na bio.')
  }

  const integracao = await prisma.integracao.findFirst({
    where: { workspaceId: params.workspaceId, plataforma: canal },
    select: { accountName: true },
  })
  const confirmacao: ConfirmacaoDeLinkNaBio = {
    tipo: TIPO_CONFIRMACAO_DE_LINK_NA_BIO,
    severidade: 'verde',
    canal,
    url: t.url,
    chaveDaTentativa: t.chaveDaTentativa,
    confirmadoPor: usuario.id,
    confirmadoEm: (params.agora ?? new Date()).toISOString(),
    conta: integracao?.accountName ?? null,
    mensagem: `Link rastreado confirmado na bio de ${integracao?.accountName ?? canal} por uma pessoa.`,
  }

  const anteriores = Array.isArray(conteudo.alertasCompliance) ? conteudo.alertasCompliance : []
  await prisma.conteudo.update({
    where: { id: conteudo.id },
    data: { alertasCompliance: [...anteriores, confirmacao] as object[] },
  })
  await registrarAuditoria({
    workspaceId: params.workspaceId,
    userId: usuario.id,
    action: 'link_na_bio.confirmado',
    entityType: 'Conteudo',
    entityId: conteudo.id,
    metadata: { canal, url: t.url, chaveDaTentativa: t.chaveDaTentativa, conta: confirmacao.conta },
  })
  return { ok: true, explicacao: confirmacao.mensagem, confirmacao }
}
