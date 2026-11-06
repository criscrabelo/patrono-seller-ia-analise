/**
 * Link rastreado da publicação (P1.0 — Etapa 2.a).
 *
 * ── O QUE A AUDITORIA ENCONTROU ─────────────────────────────────────────
 * A legenda publicada carregava `Produto.linkProduto` — a URL de afiliado
 * crua. Dois lugares apenas, mas os dois são exatamente os que publicam:
 *
 *   app/api/conteudos/[id]/publicar/route.ts   "publicar agora"
 *   app/api/cron/publicar/route.ts             publicação agendada
 *
 * Consequência: nenhum clique vindo de conteúdo publicado passava pelo
 * redirect do Patrono. `EventoLink` só via clique de link copiado à mão na
 * tela "Meus Links". Toda a cadeia de atribuição media zero.
 *
 * ── A CADEIA CORRETA ────────────────────────────────────────────────────
 *   publicação → LinkDinamico → /api/l/{slug} → EventoLink → Produto
 *
 * `Produto.linkProduto` continua sendo o DESTINO do redirect. Deixa de ser
 * o que vai para o público.
 *
 * ── SEM SCHEMA NESTA ETAPA ──────────────────────────────────────────────
 * `Publicacao` ainda não existe como tabela, e `LinkDinamico` não tem
 * `publicacaoId`. A idempotência que o contrato exige é obtida pelo SLUG:
 * ele é derivado deterministicamente da chave da tentativa. Retry reencontra
 * o mesmo slug; republicação com chave nova gera outro.
 *
 * LIMITE HONESTO: sem a coluna, o clique continua atribuível a PRODUTO, não
 * a conteúdo. Derivar o conteúdo lendo o slug seria acoplamento implícito
 * disfarçado de dado. A atribuição por publicação chega na Etapa 2.b.
 */

import { createHash } from 'crypto'
import { prisma } from './prisma'
import { isIP } from 'node:net'
import { ipNaoPublico } from './destino-publico'

// ── URL pública ─────────────────────────────────────────────────────────

/**
 * Hosts que nunca servem para um link divulgado ao público.
 *
 * Publicar `http://localhost:3000/api/l/abc` é pior que não publicar link
 * nenhum: o post sai com uma URL que só funciona na máquina de quem rodou o
 * servidor, e ninguém percebe até alguém clicar.
 */
const HOSTS_NAO_PUBLICOS = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']

export const MOTIVOS_SEM_BASE_PUBLICA = [
  'NAO_CONFIGURADA',
  'URL_INVALIDA',
  'PROTOCOLO_INVALIDO',
  'HOST_NAO_PUBLICO',
] as const

export type MotivoSemBasePublica = (typeof MOTIVOS_SEM_BASE_PUBLICA)[number]

export type BasePublica =
  | { ok: true; baseUrl: string }
  | { ok: false; motivo: MotivoSemBasePublica; explicacao: string }

/**
 * FUNÇÃO PURA. Lê e VALIDA a base pública.
 *
 * `PUBLIC_BASE_URL` primeiro; `NEXTAUTH_URL` como segunda opção, porque em
 * produção ela já aponta para o domínio real e evita duplicar configuração.
 * As duas passam pela mesma validação — em desenvolvimento `NEXTAUTH_URL` é
 * `localhost` e é recusada igual.
 *
 * Fail-closed: sem base válida não se monta link rastreado.
 */
export function lerBasePublica(env: Record<string, string | undefined> = process.env): BasePublica {
  // Vazio conta como ausente: `PUBLIC_BASE_URL=""` não pode esconder o
  // `NEXTAUTH_URL` configurado (com `??`, escondia).
  const bruto = (env.PUBLIC_BASE_URL ?? '').trim() || (env.NEXTAUTH_URL ?? '').trim()
  if (!bruto) {
    return {
      ok: false,
      motivo: 'NAO_CONFIGURADA',
      explicacao: 'PUBLIC_BASE_URL não está configurada — não há domínio público para montar o link rastreado.',
    }
  }

  let url: URL
  try {
    url = new URL(bruto)
  } catch {
    return { ok: false, motivo: 'URL_INVALIDA', explicacao: `"${bruto}" não é uma URL absoluta válida.` }
  }

  const host = url.hostname.toLowerCase()
  // P2.50 (L3): IP de rede interna e domínio de PRÉVIA da Netlify (deploy-preview--, branch--) também não são públicos.
  if (HOSTS_NAO_PUBLICOS.includes(host) || host.endsWith('.local') || (isIP(host) && ipNaoPublico(host)) || /--[a-z0-9-]+\.netlify\.app$/.test(host) || /^deploy-preview-\d+--/.test(host)) {
    return {
      ok: false,
      motivo: 'HOST_NAO_PUBLICO',
      explicacao: `"${url.hostname}" só existe na máquina que roda o servidor — um post com esse link nasce quebrado.`,
    }
  }

  // P2.50 (L3): link público é https (http só serve em desenvolvimento, e nem lá vai a um post).
  if (url.protocol !== 'https:') {
    return {
      ok: false,
      motivo: 'PROTOCOLO_INVALIDO',
      explicacao: `Protocolo "${url.protocol}" não serve para link público.`,
    }
  }

  // Sem barra final, para a concatenação ser previsível.
  return { ok: true, baseUrl: `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}` }
}

/** FUNÇÃO PURA. Monta a URL rastreada a partir da base já validada. */
export function montarUrlRastreada(baseUrl: string, slug: string): string {
  // Barra final da base fora e slug codificado: nunca `//api`, nunca um
  // slug que vire outro caminho.
  return `${baseUrl.replace(/\/+$/, '')}/api/l/${encodeURIComponent(slug)}`
}

// ── Base para EXIBIR e para e-mail ──────────────────────────────────────

export type BaseDeExibicao =
  | { ok: true; baseUrl: string; local: boolean }
  | { ok: false; motivo: MotivoSemBasePublica; explicacao: string }

/**
 * A base que a TELA mostra e copia, e a que vai em link de e-mail. Mesma
 * prioridade da publicação — `PUBLIC_BASE_URL`, depois `NEXTAUTH_URL` —
 * com UMA diferença: em DESENVOLVIMENTO (`NODE_ENV=development`), um
 * endereço local é aceito, marcado `local: true`. Sem nada configurado em
 * desenvolvimento, cai em `origemLocal` (a origem da requisição) ou em
 * `http://localhost:3000`.
 *
 * Fora de desenvolvimento é exatamente `lerBasePublica`: localhost NUNCA
 * sai em produção, e sem base válida não há link — a tela diz o motivo em
 * vez de copiar um endereço quebrado.
 *
 * A publicação continua usando `lerBasePublica` direto: post nunca leva
 * endereço local, nem em desenvolvimento.
 */
export function basePublicaParaExibir(
  env: Record<string, string | undefined> = process.env,
  origemLocal?: string | null
): BaseDeExibicao {
  const estrita = lerBasePublica(env)
  if (estrita.ok) return { ok: true, baseUrl: estrita.baseUrl, local: false }
  if (env.NODE_ENV !== 'development') return estrita

  const bruto =
    (env.PUBLIC_BASE_URL ?? '').trim() || (env.NEXTAUTH_URL ?? '').trim() || (origemLocal ?? '').trim() || 'http://localhost:3000'
  try {
    const u = new URL(bruto)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return estrita
    return { ok: true, baseUrl: `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`, local: true }
  } catch {
    return estrita
  }
}

/** O que a tela de Links recebe para cada link: a URL pronta, ou o porquê de não haver. */
export function urlRastreadaParaExibir(
  slug: string,
  env: Record<string, string | undefined> = process.env
): { url: string | null; local: boolean; motivo: string | null } {
  const base = basePublicaParaExibir(env)
  if (!base.ok) return { url: null, local: false, motivo: base.explicacao }
  return { url: montarUrlRastreada(base.baseUrl, slug), local: base.local, motivo: null }
}

// ── Slug determinístico ─────────────────────────────────────────────────

/**
 * Slug derivado da TENTATIVA de publicação.
 *
 * É o que dá idempotência sem coluna nova:
 *
 *   retry          → mesma `chaveDaTentativa` → mesmo slug → reusa o link
 *   republicação   → chave nova              → slug novo  → link novo
 *   outro workspace→ hash diferente          → slug novo  → nunca reusa
 *
 * O hash é SHA-256 truncado em 12 caracteres base36 (~62 bits). O gerador
 * antigo usava 3 dígitos aleatórios com `slug @unique` GLOBAL — com volume,
 * a colisão deixava de ser teórica.
 */
export function slugDaPublicacao(p: {
  workspaceId: string
  contentId: string
  chaveDaTentativa: string
  canal: string
  nomeProduto?: string | null
}): string {
  const base = (p.nomeProduto ?? 'produto')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 30)

  return `${base || 'produto'}-${sufixoDoSlugDaPublicacao(p)}`
}

/**
 * A metade IDENTIFICADORA do slug — 12 caracteres base36 de SHA-256.
 *
 * Separada de proposito: o nome do produto entra so no prefixo legivel, e
 * nome e MUTAVEL. Quem precisa reencontrar a publicacao depois (a derivacao
 * do estado de rastreamento) casa por este sufixo, e nao pelo slug inteiro
 * — assim renomear o produto nao faz uma publicacao rastreada desaparecer.
 */
export function sufixoDoSlugDaPublicacao(p: {
  workspaceId: string
  contentId: string
  chaveDaTentativa: string
  canal: string
}): string {
  const material = [p.workspaceId, p.contentId, p.canal, p.chaveDaTentativa].join('|')
  const hash = createHash('sha256').update(material).digest('hex')
  return BigInt(`0x${hash.slice(0, 16)}`).toString(36).padStart(12, '0').slice(0, 12)
}

/**
 * Chave de tentativa padrão, quando quem publica não fornece uma.
 *
 * Estável para RETRY — o mesmo conteúdo, no mesmo canal, no mesmo
 * agendamento, reencontra o mesmo link.
 *
 * ATENÇÃO: uma republicação manual depois também cai nesta mesma chave e
 * reusaria o link. Quem quiser link distinto por republicação precisa
 * enviar `chaveDaTentativa` própria — mesmo contrato de
 * `Sale.idempotencyKey`. A Etapa 2.b torna isso explícito na `Publicacao`.
 */
export function chaveDaTentativaPadrao(p: {
  contentId: string
  canal: string
  dataAgendamento?: Date | null
}): string {
  const quando =
    p.dataAgendamento instanceof Date && Number.isFinite(p.dataAgendamento.getTime())
      ? p.dataAgendamento.toISOString()
      : 'manual'
  return `${p.contentId}:${p.canal}:${quando}`
}

/**
 * P2.50 (D5): chave fornecida por quem chama — aceita só se for do MESMO
 * conteúdo e canal (`<contentId>:<canal>:<sufixo>`), com sufixo curto de
 * caracteres seguros. Impede reaproveitar a chave (e o link) de outro conteúdo.
 */
export function chaveDeTentativaDoConteudo(chave: string, contentId: string, canal = 'instagram'): boolean {
  const prefixo = `${contentId}:${canal}:`
  if (!contentId || !chave.startsWith(prefixo)) return false
  return /^[A-Za-z0-9._:-]{1,64}$/.test(chave.slice(prefixo.length))
}

// ── Obtenção do link ────────────────────────────────────────────────────

export const MOTIVOS_SEM_LINK_RASTREAVEL = [
  'CONTEUDO_NAO_ENCONTRADO',
  'PRODUTO_SEM_URL_DE_DESTINO',
  'SEM_BASE_PUBLICA',
  'FALHA_AO_CRIAR_LINK',
] as const

export type MotivoSemLinkRastreavel = (typeof MOTIVOS_SEM_LINK_RASTREAVEL)[number]

export interface ResultadoDoLinkRastreavel {
  ok: boolean
  /** URL para ir na legenda. `null` quando não foi possível rastrear. */
  urlPublica: string | null
  linkId: string | null
  slug: string | null
  /** `true` quando o link já existia — retry, não duplicata. */
  reutilizado: boolean
  motivo: MotivoSemLinkRastreavel | null
  /**
   * Detalha `SEM_BASE_PUBLICA`. A interface precisa distinguir "domínio nao
   * configurado" de "URL invalida", e `explicacao` nao serve para isso: ela
   * cita o valor configurado. O submotivo e um codigo, nunca um valor.
   */
  submotivo: MotivoSemBasePublica | null
  explicacao: string
  /** Destino final do redirect, para quem precisar do fallback. */
  urlDestino: string | null
}

/**
 * Cria — ou reusa — o link rastreado desta publicação.
 *
 * SOB DEMANDA: um link por tentativa de publicação, e só quando há uma
 * publicação que precisa dele. Não tem relação com a rota de links, que
 * cria 18 de uma vez por produto.
 *
 * O DESTINO vem do `Produto` do MESMO workspace, lido no servidor. Nenhuma
 * URL de destino é aceita de quem chama: aceitar abriria um redirecionador
 * aberto hospedado no domínio do Patrono.
 *
 * NUNCA lança: publicar é o fato principal, e não pode falhar porque o
 * rastreamento falhou. Quem chama decide o que fazer com `ok: false`.
 */
export async function obterLinkRastreavelDaPublicacao(params: {
  workspaceId: string
  contentId: string
  canal: string
  /** Fornecida por quem publica. Sem ela, usa `chaveDaTentativaPadrao`. */
  chaveDaTentativa?: string | null
  env?: Record<string, string | undefined>
}): Promise<ResultadoDoLinkRastreavel> {
  const vazio = (
    motivo: MotivoSemLinkRastreavel,
    explicacao: string,
    urlDestino: string | null = null,
    submotivo: MotivoSemBasePublica | null = null
  ): ResultadoDoLinkRastreavel => ({
    ok: false,
    urlPublica: null,
    linkId: null,
    slug: null,
    reutilizado: false,
    motivo,
    submotivo,
    explicacao,
    urlDestino,
  })

  if (!params?.workspaceId?.trim() || !params?.contentId?.trim() || !params?.canal?.trim()) {
    return vazio('CONTEUDO_NAO_ENCONTRADO', 'workspaceId, contentId e canal são obrigatórios juntos.')
  }

  try {
    // Conteúdo e produto SEMPRE conferidos contra o workspace.
    const conteudo = await prisma.conteudo.findFirst({
      where: { id: params.contentId, workspaceId: params.workspaceId },
      select: {
        id: true,
        userId: true,
        dataAgendamento: true,
        produto: { select: { id: true, nome: true, linkProduto: true, workspaceId: true } },
      },
    })
    if (!conteudo || conteudo.produto?.workspaceId !== params.workspaceId) {
      return vazio('CONTEUDO_NAO_ENCONTRADO', 'Conteúdo não encontrado neste workspace.')
    }

    const urlDestino = conteudo.produto?.linkProduto?.trim() || null
    if (!urlDestino) {
      // Sem destino não há o que rastrear. Um redirect para lugar nenhum
      // seria pior que não ter link.
      return vazio(
        'PRODUTO_SEM_URL_DE_DESTINO',
        'O produto não tem URL de destino cadastrada — não há para onde o redirect apontar.'
      )
    }

    const base = lerBasePublica(params.env ?? process.env)
    if (!base.ok) {
      return vazio('SEM_BASE_PUBLICA', base.explicacao, urlDestino, base.motivo)
    }

    const chaveDaTentativa =
      params.chaveDaTentativa?.trim() ||
      chaveDaTentativaPadrao({
        contentId: conteudo.id,
        canal: params.canal,
        dataAgendamento: conteudo.dataAgendamento,
      })

    const slug = slugDaPublicacao({
      workspaceId: params.workspaceId,
      contentId: conteudo.id,
      chaveDaTentativa,
      canal: params.canal,
      nomeProduto: conteudo.produto?.nome,
    })

    // Reuso: o slug é determinístico, então retry reencontra o link.
    const existente = await prisma.linkDinamico.findUnique({
      where: { slug },
      select: { id: true, workspaceId: true, urlDestino: true },
    })
    if (existente) {
      if (existente.workspaceId !== params.workspaceId) {
        // Colisão de hash entre workspaces é astronômica, mas reusar link
        // alheio seria vazamento — recusa em vez de assumir.
        return vazio('FALHA_AO_CRIAR_LINK', 'Conflito de slug com outro workspace.', urlDestino)
      }
      return {
        ok: true,
        urlPublica: montarUrlRastreada(base.baseUrl, slug),
        linkId: existente.id,
        slug,
        reutilizado: true,
        motivo: null,
        submotivo: null,
        explicacao: 'Link desta tentativa já existia — retry reusa, nunca duplica.',
        urlDestino: existente.urlDestino,
      }
    }

    const criado = await prisma.linkDinamico.create({
      data: {
        workspaceId: params.workspaceId,
        userId: conteudo.userId,
        produtoId: conteudo.produto!.id,
        slug,
        plataforma: params.canal,
        // Do PRODUTO do workspace, nunca de quem chamou.
        urlDestino,
        tipo: 'afiliado',
      },
      select: { id: true, urlDestino: true },
    })

    return {
      ok: true,
      urlPublica: montarUrlRastreada(base.baseUrl, slug),
      linkId: criado.id,
      slug,
      reutilizado: false,
      motivo: null,
      submotivo: null,
      explicacao: `Link rastreado criado sob demanda para a publicação do conteúdo ${conteudo.id} em ${params.canal}.`,
      urlDestino: criado.urlDestino,
    }
  } catch (e) {
    console.error(`[link-publicacao] falha ao obter link do conteúdo ${params.contentId}:`, e)
    return vazio('FALHA_AO_CRIAR_LINK', e instanceof Error ? e.message : 'Falha ao obter o link rastreado.')
  }
}

/**
 * LACUNA DECLARADA — publicação sem rastreamento.
 *
 * Quando o link rastreado não pôde ser montado, a publicação segue com o
 * link direto do produto. A escolha é deliberada e tem custo: o clique fica
 * inmensurável.
 *
 * Por que não publicar sem link nenhum: a receita da proprietária depende
 * do link, e derrubá-lo para proteger uma métrica inverteria a prioridade.
 * Por que não fazer isso em silêncio: uma substituição silenciosa vira
 * "estamos medindo" quando não estamos — o erro que todo o P0.2 evita.
 *
 * Então: cai para o link direto, e a lacuna vai para o log e para a resposta
 * da rota, nomeada.
 */
export function registrarLacunaDeRastreamento(contexto: {
  contentId: string
  canal: string
  motivo: MotivoSemLinkRastreavel
  explicacao: string
}): void {
  console.warn(
    `[link-publicacao] LACUNA (${contexto.motivo}) conteúdo=${contexto.contentId} canal=${contexto.canal}: ` +
      `${contexto.explicacao} A publicação segue com o link direto do produto e o clique NÃO será medido.`
  )
}
