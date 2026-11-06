/**
 * P2.18.5 (complemento arquitetural) — REGISTRO CENTRAL DE CAPACIDADES.
 *
 * Uma ação da jornada (ex.: ADICIONAR_VITRINE) não sabe QUEM a executa: ela
 * pergunta à capacidade correspondente. Hoje a vitrine é ASSISTED (executor
 * HUMANO); quando a API for liberada, a mesma capacidade passa a AUTOMATIC
 * (executor API_EXTERNA) e a jornada se adapta sem redesenho.
 *
 * Regra: nenhum outro lugar da jornada testa "a API do TikTok está ligada?".
 * Habilitar uma integração = flag + credencial + teste; a capacidade muda
 * aqui e a jornada inteira acompanha.
 *
 * As flags são as que já existiam (não há flag nova):
 *   TIKTOK_SHOP_CATALOGO (flag do workspace) · TIKTOK_SHOP_VITRINE_AUTOMATICA
 *   · TIKTOK_METRICAS_AUTOMATICAS · canal TikTok (app aprovado + escopos).
 */
import { AFFILIATE_CREATOR_API, situacaoDaAffiliateApi } from './elegibilidade-tiktok-shop'

export const CAPACIDADES = [
  'TIKTOK_DISCOVERY',
  'TIKTOK_SHOWCASE_WRITE',
  'TIKTOK_SAMPLE_REQUEST',
  'TIKTOK_SAMPLE_STATUS',
  'TIKTOK_PUBLISH',
  'TIKTOK_PRODUCT_TAG',
  'TIKTOK_METRICS',
  'TIKTOK_ORDERS',
  'TIKTOK_COMMISSIONS',
] as const
export type IdDaCapacidade = (typeof CAPACIDADES)[number]

/**
 * AUTOMATIC   — a API oficial executa (executor API_EXTERNA).
 * ASSISTED    — a API não está utilizável agora; existe contingência registrada (executor HUMANO ou PATRONO).
 * BLOCKED     — a API existe, está bloqueada e não há contingência.
 * UNAVAILABLE — não existe API pública; só a contingência (se houver).
 */
export type ModoDaCapacidade = 'AUTOMATIC' | 'ASSISTED' | 'BLOCKED' | 'UNAVAILABLE'
export type Executor = 'PATRONO' | 'HUMANO' | 'API_EXTERNA' | 'TERCEIRO'

export interface Capacidade {
  id: IdDaCapacidade
  nome: string
  modo: ModoDaCapacidade
  /** Quem executa a ação AGORA. */
  executor: Executor
  motivo: string
  /** De onde vem o estado (documentação oficial, flag, regra). */
  fonte: string
  condicaoDeDesbloqueio: string | null
  /** Feature flag que liga a execução automática (null = não há API para ligar). */
  flag: string | null
  /** A capacidade depende da Affiliate Creator API (bloqueada por elegibilidade). */
  dependeDaAffiliateApi: boolean
  /** O cliente oficial já existe no código (desligado até a liberação). */
  codigoPronto: boolean
}

/** O que o servidor sabe de cada integração (lido uma vez por requisição). */
export interface SinaisDasCapacidades {
  agora: Date
  /** Chaves do app TikTok Shop + flag TIKTOK_SHOP_CATALOGO + conta de criadora conectada. */
  affiliateConectada: boolean
  /** configuracaoDaVitrine().ligada (TIKTOK_SHOP_VITRINE_AUTOMATICA + caminhos + chaves). */
  vitrineLigada: boolean
  /** Canal TikTok publica sozinho (nível AUTOMATICO ou SEMIAUTOMATICO). */
  publicacaoAutomatica: boolean
  /** Coletor de métricas ligado (TIKTOK_METRICAS_AUTOMATICAS + app aprovado). */
  coletorDeMetricasLigado: boolean
}

/** FUNÇÃO PURA. O estado de TODAS as capacidades, a partir dos sinais. */
export function resolverCapacidades(s: SinaisDasCapacidades): Record<IdDaCapacidade, Capacidade> {
  const elegib = situacaoDaAffiliateApi(s.agora)
  const desbloqueioAffiliate = elegib.bloqueada
    ? `A partir de ${elegib.revisaoEmBR} (ou mudança oficial): certificação no Partner Center → chaves no servidor → flag → conectar a conta de criadora.`
    : 'Pedir a certificação no Partner Center → chaves no servidor → flag → conectar a conta de criadora.'
  const motivoAffiliate = elegib.bloqueada ? elegib.frase : 'Affiliate Creator API ainda não conectada a esta conta.'
  const c = (x: Omit<Capacidade, 'executor'> & { executor?: Executor }): Capacidade => ({
    ...x,
    executor: x.executor ?? (x.modo === 'AUTOMATIC' ? 'API_EXTERNA' : 'HUMANO'),
  })
  return {
    TIKTOK_DISCOVERY: s.affiliateConectada
      ? c({ id: 'TIKTOK_DISCOVERY', nome: 'Descoberta de produtos', modo: 'AUTOMATIC', motivo: 'Busca oficial de colaboração aberta ligada.', fonte: 'Affiliate Creator API — Search Open Collaboration Product', condicaoDeDesbloqueio: null, flag: 'TIKTOK_SHOP_CATALOGO', dependeDaAffiliateApi: true, codigoPronto: true })
      // Sem a API, o PATRONO continua descobrindo nas fontes disponíveis (catálogo, "Mais vendidos" registrado, informado).
      : c({ id: 'TIKTOK_DISCOVERY', nome: 'Descoberta de produtos', modo: 'ASSISTED', executor: 'PATRONO', motivo: `${motivoAffiliate} O Patrono ranqueia catálogo, "Mais vendidos" registrado e produtos informados.`, fonte: AFFILIATE_CREATOR_API.regra, condicaoDeDesbloqueio: desbloqueioAffiliate, flag: 'TIKTOK_SHOP_CATALOGO', dependeDaAffiliateApi: true, codigoPronto: true }),
    TIKTOK_SHOWCASE_WRITE: s.vitrineLigada
      ? c({ id: 'TIKTOK_SHOWCASE_WRITE', nome: 'Adicionar à vitrine', modo: 'AUTOMATIC', motivo: 'Vitrine automática ligada (Add/Get Showcase Products).', fonte: 'Affiliate Creator API — Manage Showcase Products', condicaoDeDesbloqueio: null, flag: 'TIKTOK_SHOP_VITRINE_AUTOMATICA', dependeDaAffiliateApi: true, codigoPronto: true })
      : c({ id: 'TIKTOK_SHOWCASE_WRITE', nome: 'Adicionar à vitrine', modo: 'ASSISTED', motivo: `${motivoAffiliate} O Patrono decide o produto; a titular adiciona no app.`, fonte: 'Affiliate Creator API — Manage Showcase Products', condicaoDeDesbloqueio: desbloqueioAffiliate, flag: 'TIKTOK_SHOP_VITRINE_AUTOMATICA', dependeDaAffiliateApi: true, codigoPronto: true }),
    TIKTOK_SAMPLE_REQUEST: c({ id: 'TIKTOK_SAMPLE_REQUEST', nome: 'Pedir amostra', modo: 'UNAVAILABLE', motivo: 'Não há endpoint público de solicitação de amostra para criadora. O Patrono decide se vale; a titular pede no app.', fonte: 'Documentação pública da Affiliate Creator API (sem endpoint de pedido)', condicaoDeDesbloqueio: `Endpoint oficial publicado e confirmado para o Brasil; depende também da elegibilidade (${elegib.revisaoEmBR}).`, flag: null, dependeDaAffiliateApi: true, codigoPronto: false }),
    TIKTOK_SAMPLE_STATUS: c({ id: 'TIKTOK_SAMPLE_STATUS', nome: 'Status da amostra', modo: 'UNAVAILABLE', motivo: 'Sem leitura oficial confirmada do status da amostra: a titular informa o que o app mostra.', fonte: 'Documentação pública da Affiliate Creator API', condicaoDeDesbloqueio: `Leitura oficial confirmada; depende da elegibilidade (${elegib.revisaoEmBR}).`, flag: null, dependeDaAffiliateApi: true, codigoPronto: false }),
    TIKTOK_PUBLISH: s.publicacaoAutomatica
      ? c({ id: 'TIKTOK_PUBLISH', nome: 'Publicar vídeo', modo: 'AUTOMATIC', motivo: 'Canal TikTok conectado com o app aprovado.', fonte: 'TikTok for Developers — Content Posting API', condicaoDeDesbloqueio: null, flag: 'canal TikTok (app aprovado + video.upload)', dependeDaAffiliateApi: false, codigoPronto: true })
      : c({ id: 'TIKTOK_PUBLISH', nome: 'Publicar vídeo', modo: 'ASSISTED', motivo: 'Sem o app revisado no TikTok for Developers, o TikTok não aceita envio pela API: a titular publica e cola o link.', fonte: 'TikTok for Developers — Content Posting API', condicaoDeDesbloqueio: 'App aprovado (Login Kit + Content Posting) → conectar a conta.', flag: 'canal TikTok (app aprovado + video.upload)', dependeDaAffiliateApi: false, codigoPronto: true }),
    TIKTOK_PRODUCT_TAG: c({ id: 'TIKTOK_PRODUCT_TAG', nome: 'Marcar o produto no vídeo', modo: 'UNAVAILABLE', motivo: 'A API de publicação não tem campo de produto do TikTok Shop: marcar é no app.', fonte: 'TikTok for Developers — Content Posting API (sem anchor de produto)', condicaoDeDesbloqueio: 'Campo de produto publicado na API oficial.', flag: null, dependeDaAffiliateApi: false, codigoPronto: false }),
    TIKTOK_METRICS: s.coletorDeMetricasLigado
      ? c({ id: 'TIKTOK_METRICS', nome: 'Métricas do vídeo', modo: 'AUTOMATIC', motivo: 'Coletor oficial ligado (video.list).', fonte: 'TikTok for Developers — Display API', condicaoDeDesbloqueio: null, flag: 'TIKTOK_METRICAS_AUTOMATICAS', dependeDaAffiliateApi: false, codigoPronto: true })
      : c({ id: 'TIKTOK_METRICS', nome: 'Métricas do vídeo', modo: 'ASSISTED', motivo: 'Sem o app aprovado não há leitura oficial: a titular informa só o mínimo (views, vendas, comissão).', fonte: 'TikTok for Developers — Display API', condicaoDeDesbloqueio: 'App aprovado com video.list → TIKTOK_METRICAS_AUTOMATICAS.', flag: 'TIKTOK_METRICAS_AUTOMATICAS', dependeDaAffiliateApi: false, codigoPronto: true }),
    TIKTOK_ORDERS: c({ id: 'TIKTOK_ORDERS', nome: 'Pedidos de afiliada', modo: 'ASSISTED', motivo: `${motivoAffiliate} Vendas entram pelo que o app mostra (atribuição CONFIRMADA/PROVÁVEL).`, fonte: 'Affiliate Creator API — Orders', condicaoDeDesbloqueio: desbloqueioAffiliate, flag: null, dependeDaAffiliateApi: true, codigoPronto: false }),
    TIKTOK_COMMISSIONS: c({ id: 'TIKTOK_COMMISSIONS', nome: 'Comissões', modo: 'ASSISTED', motivo: `${motivoAffiliate} Comissão informada nunca vira "paga confirmada" sem fonte oficial.`, fonte: 'Affiliate Creator API — Commissions', condicaoDeDesbloqueio: desbloqueioAffiliate, flag: null, dependeDaAffiliateApi: true, codigoPronto: false }),
  }
}

/** Sinais reais do servidor para um workspace (só configuração + linhas de integração; sem rede). */
export async function capacidadesDoWorkspace(workspaceId: string, env: Record<string, string | undefined> = process.env, agora: Date = new Date()) {
  const [{ conexaoTikTokShopLiberada, PLATAFORMA_CREATOR }, { configuracaoDaVitrine }, { estadoDoCanalTikTok }, { prisma }] = await Promise.all([
    import('./tiktok-shop-oauth'),
    import('./tiktok-shop-vitrine'),
    import('./tiktok-estado-canal'),
    import('./prisma'),
  ])
  const [liberada, creator, canal] = await Promise.all([
    conexaoTikTokShopLiberada(workspaceId, env),
    prisma.integracao.findUnique({ where: { workspaceId_plataforma: { workspaceId, plataforma: PLATAFORMA_CREATOR } }, select: { status: true } }),
    estadoDoCanalTikTok(workspaceId, env),
  ])
  const affiliateConectada = liberada && creator?.status === 'conectado'
  return resolverCapacidades({
    agora,
    affiliateConectada,
    vitrineLigada: affiliateConectada && configuracaoDaVitrine(env).ligada,
    publicacaoAutomatica: canal.nivel !== 'BLOQUEADO',
    coletorDeMetricasLigado: env.TIKTOK_METRICAS_AUTOMATICAS === 'true' && canal.conectado,
  })
}
