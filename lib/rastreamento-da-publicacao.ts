/**
 * Estado de rastreamento da publicação (P1.0 — microcorreção da Etapa 2.a).
 *
 * ── O PROBLEMA QUE ISTO FECHA ───────────────────────────────────────────
 * A Etapa 2.a passou a divulgar o link rastreado do Patrono, mas mantém o
 * fallback para `Produto.linkProduto` quando o link não pode ser criado —
 * publicar sem rastreamento vale mais que não publicar.
 *
 * O preço desse fallback é que o clique daquele post NÃO passa por
 * `/api/l/{slug}`. Logo `EventoLink` não o vê. E aí mora a armadilha: zero
 * evento passa a parecer zero clique. Não é. É clique DESCONHECIDO.
 *
 * Tratar desconhecido como zero contaminaria o ML com um negativo falso e
 * mostraria ao dono uma taxa de conversão que ele não mediu.
 *
 * ── OS TRÊS ESTADOS ─────────────────────────────────────────────────────
 *   RASTREADA                    publicada com /api/l/{slug} — clique medido
 *   NAO_RASTREADA_COM_FALLBACK   publicada com link direto — clique ignoto
 *   NAO_PUBLICADA                não houve distribuição comprovada
 *
 * SEM COLUNA NOVA nesta rodada. O estado é DERIVADO: o slug da publicação é
 * determinístico, então basta recalcular os slugs possíveis e perguntar ao
 * banco se algum deles existe. A `Publicacao` da Etapa 2.b persiste isso de
 * verdade e aposenta a derivação.
 */

import { prisma } from './prisma'
import {
  sufixoDoSlugDaPublicacao,
  chaveDaTentativaPadrao,
  type MotivoSemLinkRastreavel,
  type MotivoSemBasePublica,
} from './link-de-publicacao'
// `avaliarDistribuicaoReal` entra por import DINAMICO, dentro da funcao.
// A autoridade da distribuicao mora em ml-captura-publicacao, e esse modulo
// depende (via ml-operacao-real) deste aqui. Import estatico fecharia um
// ciclo de tres modulos; carregar sob demanda mantem a autoridade unica sem
// depender da ordem de avaliacao dos modulos.

// ── Estados ─────────────────────────────────────────────────────────────

export const ESTADOS_DE_RASTREAMENTO = [
  /** Saiu com `/api/l/{slug}`. O clique é medido de ponta a ponta. */
  'RASTREADA',
  /** Saiu com o link direto do produto. O clique existe e não é visto. */
  'NAO_RASTREADA_COM_FALLBACK',
  /** Não há prova de distribuição. Não há publicação para rastrear. */
  'NAO_PUBLICADA',
] as const

export type EstadoDeRastreamento = (typeof ESTADOS_DE_RASTREAMENTO)[number]

/**
 * Marcador único de métrica de clique que não pode ser calculada porque o
 * post não passou pelo redirect. NUNCA substituível por `0`.
 */
export const INDISPONIVEL_POR_FALTA_DE_RASTREAMENTO = 'INDISPONIVEL_POR_FALTA_DE_RASTREAMENTO'

/** FUNÇÃO PURA. Deriva o estado a partir dos dois fatos independentes. */
export function derivarEstadoDaPublicacao(p: {
  distribuida: boolean
  rastreada: boolean
}): EstadoDeRastreamento {
  // Distribuição vem primeiro: sem ela não existe publicação, rastreada ou
  // não. Um link criado para uma publicação que falhou não é publicação.
  if (!p?.distribuida) return 'NAO_PUBLICADA'
  return p.rastreada ? 'RASTREADA' : 'NAO_RASTREADA_COM_FALLBACK'
}

/**
 * FUNÇÃO PURA. O estado derivado da PUBLICAÇÃO PERSISTIDA (Etapa 2.b).
 *
 * Ainda não é chamada por ninguém: a tabela `Publicacao` não existe no banco
 * enquanto a migration não for aprovada. Está aqui para que a regra de
 * derivação seja testável ANTES de virar dado, e não uma promessa de
 * documento.
 *
 * ── DISTRIBUÍDA ≠ RASTREADA ─────────────────────────────────────────────
 * Só `DISTRIBUIDA` habilita medição. Uma publicação `DISTRIBUIDA` que saiu
 * com o link direto do produto é `NAO_RASTREADA_COM_FALLBACK` — o caso que
 * a Etapa 2.a mantém vivo de propósito.
 *
 * ── A CONDIÇÃO TEMPORAL, E POR QUE ELA É OBRIGATÓRIA ────────────────────
 * Não basta "existe link". O link precisa ter existido ANTES da
 * distribuição, porque é ele que vai na legenda: um link criado depois não
 * esteve em post nenhum.
 *
 * Sem `criadoEm <= distribuidaEm`, anexar um link a uma publicação antiga
 * faria um post que saiu por fallback passar a ler como rastreado — e o ML
 * leria ausência de `EventoLink` como zero clique medido. Seria reescrever
 * história em favor do número bonito, exatamente o que a microcorreção da
 * 2.a bloqueou.
 *
 * Na operação normal a condição é sempre verdadeira, porque a legenda
 * precisa da URL antes de publicar. Ela só morde no caso patológico — que é
 * quando precisa morder.
 *
 * Fail-closed em toda dúvida: data ilegível, ausente ou fora de ordem
 * resulta em `NAO_RASTREADA_COM_FALLBACK`, nunca em `RASTREADA`.
 */
export function derivarEstadoDaPublicacaoPersistida(p: {
  estado: string
  distribuidaEm?: Date | string | null
  /** O link rastreado da publicação, quando existe. */
  link?: { criadoEm?: Date | string | null } | null
}): EstadoDeRastreamento {
  if (p?.estado !== 'DISTRIBUIDA') return 'NAO_PUBLICADA'

  const distribuidaEm = comoData(p?.distribuidaEm)
  // `DISTRIBUIDA` sem instante de distribuição é contradição no próprio
  // registro. Não é publicação comprovada.
  if (!distribuidaEm) return 'NAO_PUBLICADA'

  const criadoEm = comoData(p?.link?.criadoEm)
  if (!criadoEm) return 'NAO_RASTREADA_COM_FALLBACK'

  return criadoEm.getTime() <= distribuidaEm.getTime()
    ? 'RASTREADA'
    : 'NAO_RASTREADA_COM_FALLBACK'
}

function comoData(v: unknown): Date | null {
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null
  if (typeof v === 'string' && v.trim()) {
    const d = new Date(v)
    return Number.isFinite(d.getTime()) ? d : null
  }
  return null
}

// ── Mensagem para a interface ───────────────────────────────────────────

/** O título do aviso. Curto, e o mesmo em qualquer motivo. */
export const TITULO_SEM_RASTREAMENTO = 'Publicada sem rastreamento de cliques'

/**
 * Motivo técnico → frase segura.
 *
 * A `explicacao` interna NÃO serve para a tela: ela cita o valor de
 * `PUBLIC_BASE_URL`, nomes de campo e o caminho que falhou. Isso é
 * diagnóstico de servidor, não texto de usuária. Esta tabela é a única
 * ponte, e só devolve frases escritas à mão.
 */
const MENSAGENS: Record<string, string> = {
  'SEM_BASE_PUBLICA:NAO_CONFIGURADA': 'O domínio público do Patrono ainda não foi configurado.',
  'SEM_BASE_PUBLICA:URL_INVALIDA': 'O endereço público configurado não é uma URL válida.',
  'SEM_BASE_PUBLICA:PROTOCOLO_INVALIDO': 'O endereço público configurado não é uma URL válida.',
  'SEM_BASE_PUBLICA:HOST_NAO_PUBLICO': 'O endereço público configurado não é acessível fora do servidor.',
  SEM_BASE_PUBLICA: 'O domínio público do Patrono ainda não foi configurado.',
  PRODUTO_SEM_URL_DE_DESTINO: 'O produto não tem URL de destino cadastrada.',
  FALHA_AO_CRIAR_LINK: 'Não foi possível criar o link rastreado.',
  CONTEUDO_NAO_ENCONTRADO: 'Não foi possível identificar o produto deste conteúdo.',
}

/** Quando o motivo não é reconhecido, a frase genérica — nunca o interno. */
export const MENSAGEM_GENERICA = 'Não foi possível criar o link rastreado.'

/**
 * FUNÇÃO PURA. Traduz motivo técnico em frase exibível.
 *
 * Fail-closed no sentido da privacidade: motivo desconhecido devolve a
 * frase genérica em vez de repassar o texto interno.
 */
export function mensagemDaLacuna(
  motivo?: MotivoSemLinkRastreavel | string | null,
  submotivo?: MotivoSemBasePublica | string | null
): string {
  if (!motivo) return MENSAGEM_GENERICA
  if (submotivo) {
    const comSub = MENSAGENS[`${motivo}:${submotivo}`]
    if (comSub) return comSub
  }
  return MENSAGENS[motivo] ?? MENSAGEM_GENERICA
}

export interface AvisoDeRastreamento {
  estado: EstadoDeRastreamento
  titulo: string
  detalhe: string
  /** A publicação aconteceu. O que está incompleto é a atribuição. */
  publicacaoRealizada: true
}

/**
 * FUNÇÃO PURA. O aviso que a tela mostra — ou `null` quando não há o que
 * avisar.
 *
 * `RASTREADA` devolve `null`: sucesso não vira alerta.
 */
export function avisoDaPublicacao(rastreamento: {
  rastreado: boolean
  motivo?: MotivoSemLinkRastreavel | string | null
  submotivo?: MotivoSemBasePublica | string | null
}): AvisoDeRastreamento | null {
  if (rastreamento?.rastreado) return null
  return {
    estado: 'NAO_RASTREADA_COM_FALLBACK',
    titulo: TITULO_SEM_RASTREAMENTO,
    detalhe: mensagemDaLacuna(rastreamento?.motivo, rastreamento?.submotivo),
    publicacaoRealizada: true,
  }
}

// ── Proteção do ML e das métricas ───────────────────────────────────────

/**
 * REGRA OBRIGATÓRIA: publicação que caiu no fallback NÃO é evidência de
 * zero cliques.
 *
 * O clique aconteceu ou não — ninguém sabe, porque ele não passou pelo
 * redirect. Só `RASTREADA` autoriza ler a ausência de `EventoLink` como
 * ausência de clique.
 */
export function podeUsarComoEvidenciaDeZeroCliques(estado: EstadoDeRastreamento): boolean {
  return estado === 'RASTREADA'
}

export interface MetricasDeCliqueDaPublicacao {
  cliques: number | null
  taxaConversao: number | null
  clicksPerView: number | null
  commissionPerClick: number | null
  receitaPorClique: number | null
  /** `null` quando tudo foi medido; o marcador quando não houve medição. */
  indisponibilidade: typeof INDISPONIVEL_POR_FALTA_DE_RASTREAMENTO | null
}

/**
 * FUNÇÃO PURA. Todas as métricas dependentes de clique, zeradas em `null`.
 *
 * `null` é "não medido". `0` seria "medido e deu zero" — e diria uma
 * mentira sobre um post cujo clique nunca chegou a ser observável.
 */
export function metricasDeCliqueIndisponiveis(): MetricasDeCliqueDaPublicacao {
  return {
    cliques: null,
    taxaConversao: null,
    clicksPerView: null,
    commissionPerClick: null,
    receitaPorClique: null,
    indisponibilidade: INDISPONIVEL_POR_FALTA_DE_RASTREAMENTO,
  }
}

/**
 * FUNÇÃO PURA. As métricas de clique de UMA publicação.
 *
 * Fora de `RASTREADA` devolve tudo `null` com o marcador. Mesmo em
 * `RASTREADA` esta rodada não calcula taxa por publicação: o clique é
 * atribuível a produto, não a criativo (ver `LIMITACAO_DE_ATRIBUICAO` em
 * lib/metricas-clique.ts). Quem quiser o número usa a granularidade que
 * fecha numerador com denominador.
 */
export function metricasDeCliqueDaPublicacao(
  estado: EstadoDeRastreamento
): MetricasDeCliqueDaPublicacao {
  if (!podeUsarComoEvidenciaDeZeroCliques(estado)) return metricasDeCliqueIndisponiveis()
  return {
    cliques: null,
    taxaConversao: null,
    clicksPerView: null,
    commissionPerClick: null,
    receitaPorClique: null,
    indisponibilidade: null,
  }
}

// ── Derivação do estado a partir do banco ───────────────────────────────

/**
 * FUNÇÃO PURA. Os sufixos de slug que a publicação DESTE conteúdo pode ter
 * gerado.
 *
 * São os dois caminhos reais de produção: o cron e o "publicar agora" usam
 * `chaveDaTentativaPadrao`, que cai em `dataAgendamento` quando existe e em
 * `'manual'` quando não existe. Ambos são recalculáveis.
 *
 * Casa pelo SUFIXO, nunca pelo slug inteiro: o prefixo legível vem do nome
 * do produto, e nome muda. Renomear "Fone bluetooth" para "Fone TWS" não
 * pode fazer uma publicação rastreada passar a ler como não rastreada.
 *
 * LIMITE DECLARADO: uma publicação feita com `chaveDaTentativa` própria
 * (republicação futura) não é recalculável daqui. Ela lê como NÃO
 * rastreada. O erro é sempre para o lado seguro — perde-se um rótulo, nunca
 * se inventa um. A `Publicacao` da Etapa 2.b elimina a derivação.
 */
export function sufixosDerivaveisDaPublicacao(conteudo: {
  workspaceId: string
  id: string
  redeSocial?: string | null
  dataAgendamento?: Date | null
}): string[] {
  const canal = conteudo?.redeSocial?.trim() || 'instagram'
  const chaves = new Set<string>([
    chaveDaTentativaPadrao({ contentId: conteudo.id, canal, dataAgendamento: conteudo.dataAgendamento }),
    chaveDaTentativaPadrao({ contentId: conteudo.id, canal, dataAgendamento: null }),
  ])
  return [...chaves].map((chaveDaTentativa) =>
    sufixoDoSlugDaPublicacao({
      workspaceId: conteudo.workspaceId,
      contentId: conteudo.id,
      chaveDaTentativa,
      canal,
    })
  )
}

export interface AvaliacaoDeRastreamento {
  contentId: string
  estado: EstadoDeRastreamento
  /** O aviso pronto para a tela, ou `null` quando não há o que avisar. */
  aviso: AvisoDeRastreamento | null
  metricasDeClique: MetricasDeCliqueDaPublicacao
}

type ConteudoParaAvaliar = {
  id: string
  workspaceId: string
  redeSocial?: string | null
  dataAgendamento?: Date | null
  publicacaoExternaId?: string | null
  dataPublicacao?: Date | null
  produto?: { nome?: string | null } | null
}

/**
 * Avalia vários conteúdos em UMA consulta.
 *
 * A listagem de conteúdos chama isto; fazer duas buscas por linha
 * transformaria a tela em N+1. Os slugs são calculados em memória e o banco
 * responde uma vez só.
 *
 * NUNCA lança: o rastreamento é anotação, e uma anotação não pode derrubar
 * a listagem. Em qualquer falha todos ficam no estado conservador.
 */
export async function avaliarRastreamentoDosConteudos(
  workspaceId: string,
  conteudos: ConteudoParaAvaliar[]
): Promise<Map<string, AvaliacaoDeRastreamento>> {
  const mapa = new Map<string, AvaliacaoDeRastreamento>()
  const lista = Array.isArray(conteudos) ? conteudos.filter((c) => c?.id) : []
  const { avaliarDistribuicaoReal } = await import('./ml-captura-publicacao')

  const conservador = (c: ConteudoParaAvaliar): AvaliacaoDeRastreamento => {
    const estado = derivarEstadoDaPublicacao({
      distribuida: avaliarDistribuicaoReal(c).distribuida,
      rastreada: false,
    })
    return {
      contentId: c.id,
      estado,
      aviso: estado === 'NAO_RASTREADA_COM_FALLBACK' ? avisoDaPublicacao({ rastreado: false }) : null,
      metricasDeClique: metricasDeCliqueDaPublicacao(estado),
    }
  }

  if (!workspaceId?.trim() || lista.length === 0) return mapa

  // ── FONTE PREFERIDA: a Publicacao persistida (Etapa 2.c) ──────────────
  //
  // Onde ela existe, o slug nao e mais consultado. A relacao e explicita:
  // Publicacao -> LinkDinamico. Recalcular slug so continua valendo para o
  // legado da Etapa 2.a, que publicou antes da tabela existir — e para esse
  // legado nao ha backfill, porque o banco nao consegue provar o que
  // aconteceu.
  const comPublicacao = new Map<string, AvaliacaoDeRastreamento>()
  try {
    const publicacoes = await prisma.publicacao.findMany({
      where: { workspaceId, contentId: { in: lista.map((c) => c.id) } },
      select: {
        contentId: true,
        estado: true,
        distribuidaEm: true,
        createdAt: true,
        link: { select: { createdAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
    // A mais recente manda: e ela que descreve como o conteudo esta no ar
    // agora. `orderBy desc` + `has` garante que so a primeira de cada
    // conteudo entra.
    for (const p of publicacoes) {
      if (comPublicacao.has(p.contentId)) continue
      const estado = derivarEstadoDaPublicacaoPersistida({
        estado: p.estado,
        distribuidaEm: p.distribuidaEm,
        link: p.link ? { criadoEm: p.link.createdAt } : null,
      })
      comPublicacao.set(p.contentId, {
        contentId: p.contentId,
        estado,
        aviso: estado === 'NAO_RASTREADA_COM_FALLBACK' ? avisoDaPublicacao({ rastreado: false }) : null,
        metricasDeClique: metricasDeCliqueDaPublicacao(estado),
      })
    }
  } catch {
    // Banco indisponivel: cai para o caminho legado, que e conservador.
  }
  for (const [id, avaliacao] of comPublicacao) mapa.set(id, avaliacao)

  // Daqui para baixo, so o legado — conteudo sem nenhuma Publicacao.
  const legado = lista.filter((c) => !mapa.has(c.id))
  if (legado.length === 0) return mapa

  const porSufixo = new Map<string, ConteudoParaAvaliar>()
  for (const c of legado) {
    if (c.workspaceId !== workspaceId) continue
    for (const sufixo of sufixosDerivaveisDaPublicacao(c)) porSufixo.set(sufixo, c)
  }
  if (porSufixo.size === 0) {
    for (const c of legado) mapa.set(c.id, conservador(c))
    return mapa
  }

  let slugs: string[] = []
  try {
    const achados = await prisma.linkDinamico.findMany({
      // O workspace entra na consulta: um slug de outro negócio nunca pode
      // fazer esta publicação parecer rastreada. O OR de sufixos mantém isto
      // em UMA consulta e traz só as linhas que interessam — puxar todos os
      // links do workspace para filtrar em memória cresceria com o catálogo.
      where: {
        workspaceId,
        OR: [...porSufixo.keys()].map((sufixo) => ({ slug: { endsWith: `-${sufixo}` } })),
      },
      select: { slug: true },
    })
    slugs = achados.map((l) => l.slug)
  } catch {
    // Banco indisponível não pode virar "rastreada". Todos conservadores.
    for (const c of legado) mapa.set(c.id, conservador(c))
    return mapa
  }

  const rastreados = new Set<string>()
  for (const [sufixo, c] of porSufixo) {
    if (slugs.some((s) => s.endsWith(`-${sufixo}`))) rastreados.add(c.id)
  }

  for (const c of legado) {
    const estado = derivarEstadoDaPublicacao({
      distribuida: avaliarDistribuicaoReal(c).distribuida,
      rastreada: rastreados.has(c.id),
    })
    mapa.set(c.id, {
      contentId: c.id,
      estado,
      aviso: estado === 'NAO_RASTREADA_COM_FALLBACK' ? avisoDaPublicacao({ rastreado: false }) : null,
      metricasDeClique: metricasDeCliqueDaPublicacao(estado),
    })
  }
  return mapa
}

/** Um conteúdo só. Lê do banco e delega para a versão em lote. */
export async function avaliarRastreamentoDoConteudo(params: {
  workspaceId: string
  contentId: string
}): Promise<AvaliacaoDeRastreamento> {
  const vazio: AvaliacaoDeRastreamento = {
    contentId: params?.contentId ?? '',
    estado: 'NAO_PUBLICADA',
    aviso: null,
    metricasDeClique: metricasDeCliqueIndisponiveis(),
  }
  if (!params?.workspaceId?.trim() || !params?.contentId?.trim()) return vazio

  let conteudo: ConteudoParaAvaliar | null = null
  try {
    conteudo = await prisma.conteudo.findFirst({
      where: { id: params.contentId, workspaceId: params.workspaceId },
      select: {
        id: true,
        workspaceId: true,
        redeSocial: true,
        dataAgendamento: true,
        publicacaoExternaId: true,
        dataPublicacao: true,
        produto: { select: { nome: true } },
      },
    })
  } catch {
    return vazio
  }
  if (!conteudo) return vazio

  const mapa = await avaliarRastreamentoDosConteudos(params.workspaceId, [conteudo])
  return mapa.get(params.contentId) ?? vazio
}

// ── Fila de automação ───────────────────────────────────────────────────

/**
 * FILA DE AUTOMAÇÃO — integração futura com o Painel de Exceções.
 *
 * Hoje não existe Painel de Exceções no app. O cron já devolve
 * `publicacoesSemRastreamento` no JSON, e a listagem de conteúdos já marca
 * cada publicação sem rastreamento — mas nada AGREGA a exceção num lugar só
 * com histórico.
 *
 * AUTOMATION FIRST: descobrir que estamos publicando sem rastreamento não
 * pode depender de alguém abrir log de servidor nem de reparar num selo na
 * listagem. Enquanto o painel não existe, o menor aviso possível está na
 * interface atual — e a dívida fica registrada aqui, não esquecida.
 *
 * O QUE FALTA: uma área de exceções operacionais que leia esta avaliação
 * para todo o workspace, mostre a contagem, o motivo agrupado e o que
 * desbloqueia cada um (configurar domínio público, cadastrar URL de destino
 * do produto), e avise sozinha quando a contagem sair de zero.
 */
export const INTEGRACAO_FUTURA_PAINEL_DE_EXCECOES = {
  chave: 'painel-de-excecoes:publicacao-sem-rastreamento',
  estado: 'REGISTRADA_NAO_IMPLEMENTADA',
  ondeApareceHoje: ['listagem de conteúdos', 'aviso pós-publicação', 'JSON do cron'],
  oQueFalta: 'Área de exceções operacionais que agregue, historize e avise sozinha.',
  desbloqueiaCom: 'PAINEL_DE_EXCECOES',
} as const
