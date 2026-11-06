/**
 * VITRINE (showcase) do TikTok Shop — fluxo automático pela Affiliate
 * Creator API, pronto para ligar quando a API estiver AUTORIZADA.
 *
 *   selecionar produto elegível → validar colaboração → Add Showcase
 *   Products → confirmar com Get Showcase Products → registrar
 *   data/hora · product_id · status no Patrono (VitrineTikTokShop).
 *
 * Regras (inegociáveis):
 *  - O produto NUNCA é considerado adicionado porque a chamada foi enviada.
 *    Só vira CONFIRMADO_NA_VITRINE quando o Get mostra o product_id.
 *  - Sinal de screening/aprovação do vendedor (no Add ou no item do Get) =
 *    AGUARDANDO_APROVACAO, nunca "adicionado".
 *  - O Add é ESCRITA: uma tentativa só (`tentativas: 1`). Falha de rede =
 *    ENVIO_INCERTO, resolvido por LEITURA (Get), nunca por reenvio às cegas.
 *  - Só produto com colaboração aberta confirmada pela fonte oficial (a busca
 *    de colaboração aberta da própria API) entra.
 *
 * DESLIGADO por padrão. Liga só com TUDO isto:
 *  - `TIKTOK_SHOP_VITRINE_AUTOMATICA=true`;
 *  - conta de criadora conectada (token válido, lib/tiktok-shop-oauth.ts);
 *  - caminhos OFICIAIS dos dois endpoints em `TIKTOK_SHOP_PATH_SHOWCASE_ADD` e
 *    `TIKTOK_SHOP_PATH_SHOWCASE_GET`, copiados da documentação do Partner
 *    Center na autorização. NÃO há caminho padrão: um caminho adivinhado numa
 *    ESCRITA é inaceitável. (O assinador cita `/affiliate_creator/202405/
 *    showcase/products` como exemplo — NÃO CONFIRMADO.)
 *  - Os NOMES dos campos do corpo/resposta também se confirmam na 1ª chamada
 *    real; a leitura é tolerante e, na dúvida, o estado fica NÃO confirmado.
 */
import { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { chamarOpenApi, ErroDaTikTokShop, type DepsDoCliente } from './tiktok-shop-cliente'
import { lerCredenciaisTikTokShopCreator, obterTokenDaCriadora } from './tiktok-shop-oauth'
import { FONTE_TIKTOK_SHOP } from './tiktok-shop-descoberta'
import { CANDIDATO_NAO_EXCLUIDO } from './produto-canonico'

/**
 * P2.17.15 — CONTRATO OFICIAL, item por item, com o grau de confirmação.
 * Lido em partner.tiktokshop.com só no trecho indexado (a página não renderiza
 * sem navegador) → "C-t". O que não foi encontrado em texto oficial fica
 * "AGUARDANDO_CONFIRMACAO_OFICIAL" e nunca vira valor padrão de escrita.
 */
export type GrauDeConfirmacao = 'C-t' | 'AGUARDANDO_CONFIRMACAO_OFICIAL'
export const CONTRATO_DOCUMENTADO = {
  get: { metodo: 'GET', caminho: '/affiliate_creator/202405/showcases/products', grau: 'C-t' as GrauDeConfirmacao, escopo: 'creator.showcase.read ou creator.video.write', query: { origin: 'SHOWCASE (obrigatório; LIVE para sala ao vivo)', paginacao: 'page_size + page_token, até 2.000 produtos' } },
  add: { metodo: 'POST', caminho: '/affiliate_creator/202405/showcases/products/add', grau: 'C-t' as GrauDeConfirmacao, escopo: 'creator.showcase.write ou creator.video.write', corpo: { add_type: 'PRODUCT_ID | PRODUCT_LINK', product_ids: 'lista (até 20)' } },
  remove: { metodo: 'POST ou DELETE (páginas divergem)', caminho: null, grau: 'AGUARDANDO_CONFIRMACAO_OFICIAL' as GrauDeConfirmacao, escopo: null },
  /** Nomes dos campos da RESPOSTA (status por produto, item da vitrine): não lidos em texto oficial. */
  resposta: { grau: 'AGUARDANDO_CONFIRMACAO_OFICIAL' as GrauDeConfirmacao },
  /** Screening/aprovação do vendedor por API: não encontrado — detectado só por sinal na resposta. */
  screening: { grau: 'AGUARDANDO_CONFIRMACAO_OFICIAL' as GrauDeConfirmacao },
} as const

/** FUNÇÃO PURA. O corpo do Add no formato documentado (add_type + product_ids). */
export function corpoDoAdd(productIds: string[]): { add_type: 'PRODUCT_ID'; product_ids: string[] } {
  if (productIds.length < 1 || productIds.length > 20) throw new Error('Add Showcase Products aceita de 1 a 20 produtos por chamada.')
  return { add_type: 'PRODUCT_ID', product_ids: productIds }
}

export const ESTADOS_DA_VITRINE = [
  'SELECIONADO', 'COLABORACAO_NAO_CONFIRMADA', 'ENVIADO', 'ENVIO_INCERTO', 'AGUARDANDO_APROVACAO',
  'CONFIRMADO_NA_VITRINE', 'NAO_ENCONTRADO_NA_VITRINE', 'FALHOU',
  // P2.17.15: remoção — também só vale com o Get confirmando a ausência.
  'REMOCAO_ENVIADA', 'REMOCAO_INCERTA', 'REMOVIDO',
] as const
export type EstadoDaVitrine = (typeof ESTADOS_DA_VITRINE)[number]

/** Rótulos para a tela: "adicionado" só existe com confirmação do Get. */
export const ROTULO_DA_VITRINE: Record<EstadoDaVitrine, string> = {
  SELECIONADO: 'selecionado',
  COLABORACAO_NAO_CONFIRMADA: 'colaboração não confirmada',
  ENVIADO: 'enviado — aguardando confirmação',
  ENVIO_INCERTO: 'envio incerto — conferindo na vitrine',
  AGUARDANDO_APROVACAO: 'AGUARDANDO APROVAÇÃO do vendedor',
  CONFIRMADO_NA_VITRINE: 'na vitrine (confirmado)',
  NAO_ENCONTRADO_NA_VITRINE: 'não encontrado na vitrine',
  FALHOU: 'falhou',
  REMOCAO_ENVIADA: 'remoção enviada — conferindo',
  REMOCAO_INCERTA: 'remoção incerta — conferindo na vitrine',
  REMOVIDO: 'removido (confirmado)',
}

/** Estados que ainda precisam de conferência pelo Get. */
export const A_CONFERIR: EstadoDaVitrine[] = ['ENVIADO', 'ENVIO_INCERTO', 'AGUARDANDO_APROVACAO', 'REMOCAO_ENVIADA', 'REMOCAO_INCERTA']
export const MAXIMO_DE_ENVIOS = 2
/** Depois do Add, o produto pode demorar a aparecer: até aqui, ausência no Get = "ainda conferindo" (nunca reenvio). */
export const JANELA_DE_CONFIRMACAO_MS = 24 * 60 * 60 * 1000
const PAGINAS_DO_GET = 5

// ── Liga/desliga (puro) ─────────────────────────────────────────────────

export interface ConfiguracaoDaVitrine {
  ligada: boolean
  caminhoAdd: string | null
  caminhoGet: string | null
  motivo: string | null
  /** Caminho configurado diferente do documentado (aviso; quem decide é a documentação vigente). */
  divergencias: string[]
  /** Remoção automática: desligada por padrão; exige flag própria + caminho oficial confirmado. */
  remocao: { ligada: boolean; caminho: string | null; motivo: string | null }
}

const caminhoValido = (p: string | undefined) => (p && /^\/[a-z0-9_/]+$/i.test(p.trim()) ? p.trim() : null)

/** FUNÇÃO PURA. A vitrine automática só liga com flag + os DOIS caminhos oficiais configurados. */
export function configuracaoDaVitrine(env: Record<string, string | undefined> = process.env): ConfiguracaoDaVitrine {
  const caminhoAdd = caminhoValido(env.TIKTOK_SHOP_PATH_SHOWCASE_ADD)
  const caminhoGet = caminhoValido(env.TIKTOK_SHOP_PATH_SHOWCASE_GET)
  const caminhoRemove = caminhoValido(env.TIKTOK_SHOP_PATH_SHOWCASE_REMOVE)
  const divergencias = [
    caminhoAdd && caminhoAdd !== CONTRATO_DOCUMENTADO.add.caminho ? `Add configurado (${caminhoAdd}) difere do documentado (${CONTRATO_DOCUMENTADO.add.caminho}).` : null,
    caminhoGet && caminhoGet !== CONTRATO_DOCUMENTADO.get.caminho ? `Get configurado (${caminhoGet}) difere do documentado (${CONTRATO_DOCUMENTADO.get.caminho}).` : null,
  ].filter((x): x is string => !!x)
  const remocao = env.TIKTOK_SHOP_VITRINE_REMOCAO_AUTOMATICA !== 'true'
    ? { ligada: false, caminho: caminhoRemove, motivo: 'Remoção automática desligada: o Gestor só recomenda.' }
    : !caminhoRemove
      ? { ligada: false, caminho: null, motivo: 'Remove Showcase Products: método/caminho AGUARDANDO CONFIRMAÇÃO OFICIAL.' }
      : { ligada: true, caminho: caminhoRemove, motivo: null }
  const base = { caminhoAdd, caminhoGet, divergencias, remocao }
  if (env.TIKTOK_SHOP_VITRINE_AUTOMATICA !== 'true') return { ligada: false, ...base, motivo: 'Vitrine automática desligada (aguardando a Affiliate Creator API ser autorizada).' }
  if (!caminhoAdd || !caminhoGet) return { ligada: false, ...base, motivo: 'Faltam os caminhos oficiais de Add/Get Showcase Products (copiar da documentação do Partner Center).' }
  if (!lerCredenciaisTikTokShopCreator(env)) return { ligada: false, ...base, motivo: 'O app do TikTok Shop não está configurado no servidor.' }
  return { ligada: true, ...base, motivo: null }
}

// ── Seleção e validação de colaboração (puro) ───────────────────────────

export interface CandidatoParaVitrine {
  id: string
  nome: string
  fonte: string
  providerId: string | null
  externalId: string | null
  status: string
  complianceBloqueante: boolean
  validoAte: Date
  score: number
}

/**
 * FUNÇÃO PURA. Colaboração confirmada = o produto veio da BUSCA OFICIAL de
 * colaboração aberta (fonte tiktok-shop, com product_id) e o dado ainda está
 * válido. Produto informado à mão com link do TikTok não prova colaboração.
 */
export function validarColaboracao(c: CandidatoParaVitrine, agora: Date): { ok: boolean; motivo: string } {
  if (c.providerId !== FONTE_TIKTOK_SHOP || !c.externalId) return { ok: false, motivo: 'Não é produto do TikTok Shop com product_id oficial.' }
  if (c.fonte !== FONTE_TIKTOK_SHOP) return { ok: false, motivo: 'Colaboração não confirmada: o produto não veio da busca oficial de colaboração aberta.' }
  if (c.validoAte.getTime() < agora.getTime()) return { ok: false, motivo: 'Dado de colaboração vencido: precisa de nova consulta oficial.' }
  return { ok: true, motivo: 'Colaboração aberta confirmada pela busca oficial.' }
}

/** FUNÇÃO PURA. Elegíveis: aberto, sem bloqueio de compliance, colaboração confirmada; melhor score primeiro; fora o que já está na vitrine, em conferência ou esgotou tentativas. */
export function selecionarElegiveis(candidatos: CandidatoParaVitrine[], registros: { productId: string; estado: string; tentativas: number }[], limite: number, agora: Date = new Date()): CandidatoParaVitrine[] {
  const porProduto = new Map(registros.map((r) => [r.productId, r]))
  return candidatos
    .filter((c) => ['NOVO', 'APRESENTADO', 'CADASTRADO'].includes(c.status) && !c.complianceBloqueante && validarColaboracao(c, agora).ok)
    .filter((c) => {
      const r = porProduto.get(c.externalId!)
      if (!r) return true
      // Já na vitrine, aguardando o vendedor ou ainda em conferência: não reenviar.
      if (['CONFIRMADO_NA_VITRINE', 'AGUARDANDO_APROVACAO', 'ENVIADO', 'ENVIO_INCERTO'].includes(r.estado)) return false
      return r.tentativas < MAXIMO_DE_ENVIOS
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limite)
}

// ── Leitura tolerante das respostas (puro) ──────────────────────────────

/** Sinal de screening/aprovação/revisão do vendedor em qualquer campo de texto. */
const SINAL_DE_APROVACAO = /(review|audit|screen|approv|pending|apply|application|need_seller)/i

/** FUNÇÃO PURA. Sinal de que o vendedor precisa aprovar (no Add ou no item do Get). */
export function exigeAprovacao(x: unknown): boolean {
  if (x === null || x === undefined) return false
  if (typeof x === 'string') return SINAL_DE_APROVACAO.test(x)
  if (typeof x === 'boolean' || typeof x === 'number') return false
  if (Array.isArray(x)) return x.some(exigeAprovacao)
  return Object.entries(x as Record<string, unknown>).some(([k, v]) => (SINAL_DE_APROVACAO.test(k) && v !== false && v !== null && v !== 0) || exigeAprovacao(v))
}

/** FUNÇÃO PURA. Itens da vitrine e o próximo token de página (nomes prováveis, a confirmar). */
export function itensDaVitrine(data: unknown): { itens: Record<string, unknown>[]; proxima: string | null } {
  const d = (data ?? {}) as Record<string, unknown>
  const lista = ['products', 'showcase_products', 'product_list', 'items', 'list'].map((k) => d[k]).find(Array.isArray) as unknown[] | undefined
  const proxima = ['next_page_token', 'next_cursor', 'page_token'].map((k) => d[k]).find((v) => typeof v === 'string' && v) as string | undefined
  return { itens: (lista ?? []).filter((x): x is Record<string, unknown> => !!x && typeof x === 'object'), proxima: proxima ?? null }
}

const idDoItem = (i: Record<string, unknown>) => String(i.product_id ?? i.productId ?? i.id ?? '')

/**
 * FUNÇÃO PURA. Decide o estado depois do Get: presente → confirmado (ou
 * aguardando aprovação, se o próprio item indicar); ausente → aguardando
 * aprovação se o Add sinalizou screening; senão, não encontrado.
 */
export function estadoAposConferencia(productId: string, itens: Record<string, unknown>[], respostaDoAdd: unknown): EstadoDaVitrine {
  const item = itens.find((i) => idDoItem(i) === productId)
  if (item) return exigeAprovacao(item) ? 'AGUARDANDO_APROVACAO' : 'CONFIRMADO_NA_VITRINE'
  return exigeAprovacao(respostaDoAdd) ? 'AGUARDANDO_APROVACAO' : 'NAO_ENCONTRADO_NA_VITRINE'
}

// ── Execução (banco + API oficial) ──────────────────────────────────────

interface EntradaDoHistorico { em: string; acao: string; estado: EstadoDaVitrine; detalhe?: string; requestId?: string | null }

async function gravar(workspaceId: string, productId: string, base: { candidatoId: string | null; nomeProduto: string }, estado: EstadoDaVitrine, extra: Prisma.VitrineTikTokShopUncheckedUpdateInput, h: Omit<EntradaDoHistorico, 'em' | 'estado'>, agora: Date) {
  const atual = await prisma.vitrineTikTokShop.findUnique({ where: { workspaceId_productId: { workspaceId, productId } } })
  const historico = [...((atual?.historico as unknown as EntradaDoHistorico[]) ?? []), { em: agora.toISOString(), estado, ...h }]
  return prisma.vitrineTikTokShop.upsert({
    where: { workspaceId_productId: { workspaceId, productId } },
    create: { workspaceId, productId, candidatoId: base.candidatoId, nomeProduto: base.nomeProduto, estado, historico: historico as unknown as Prisma.InputJsonValue, ...(extra as object) },
    update: { estado, historico: historico as unknown as Prisma.InputJsonValue, ...extra },
  })
}

export interface DepsDaVitrine {
  env?: Record<string, string | undefined>
  agora?: Date
  /** Para teste: cliente já autenticado (pula o token real). */
  cliente?: DepsDoCliente
  fetcher?: typeof fetch
}

async function clienteDaCriadora(workspaceId: string, deps: DepsDaVitrine): Promise<DepsDoCliente | { erro: string }> {
  if (deps.cliente) return deps.cliente
  const env = deps.env ?? process.env
  const creds = lerCredenciaisTikTokShopCreator(env)
  if (!creds) return { erro: 'O app do TikTok Shop não está configurado no servidor.' }
  const token = await obterTokenDaCriadora(workspaceId, { fetcher: deps.fetcher, env })
  if (!token.ok) return { erro: token.mensagem }
  return { appKey: creds.appKey, appSecret: creds.appSecret, accessToken: token.accessToken, chaveDeLimite: `vitrine:${workspaceId}`, fetcher: deps.fetcher }
}

/** Get Showcase Products, paginado, até achar o produto (ou acabar as páginas). */
async function lerVitrine(caminhoGet: string, cliente: DepsDoCliente, procurado: string): Promise<{ itens: Record<string, unknown>[]; requestId: string | null }> {
  const itens: Record<string, unknown>[] = []
  let token: string | null = null
  let requestId: string | null = null
  for (let p = 0; p < PAGINAS_DO_GET; p++) {
    // `origin` é obrigatório no Get documentado: SHOWCASE (vitrine), não LIVE.
    const query: Record<string, string | number> = { origin: 'SHOWCASE', page_size: 50 }
    if (token) query.page_token = token
    const r = await chamarOpenApi({ metodo: 'GET', caminho: caminhoGet, query }, cliente)
    requestId = r.requestId
    const pagina = itensDaVitrine(r.data)
    itens.push(...pagina.itens)
    if (pagina.itens.some((i) => idDoItem(i) === procurado) || !pagina.proxima) break
    token = pagina.proxima
  }
  return { itens, requestId }
}

/** Confere UM produto pelo Get e atualiza o registro. Nunca reenvia. */
export async function conferirNaVitrine(workspaceId: string, productId: string, deps: DepsDaVitrine = {}) {
  const agora = deps.agora ?? new Date()
  const cfg = configuracaoDaVitrine(deps.env)
  const reg = await prisma.vitrineTikTokShop.findUnique({ where: { workspaceId_productId: { workspaceId, productId } } })
  if (!reg) return null
  if (!cfg.ligada || !cfg.caminhoGet) return reg
  const cliente = await clienteDaCriadora(workspaceId, deps)
  if ('erro' in cliente) return reg
  const base = { candidatoId: reg.candidatoId, nomeProduto: reg.nomeProduto }
  try {
    const r = await lerVitrine(cfg.caminhoGet, cliente, productId)
    const ultimoAdd = ((reg.historico as unknown as (EntradaDoHistorico & { resposta?: unknown })[]) ?? []).filter((h) => h.acao === 'ADD').at(-1)?.resposta ?? null
    let estado = estadoAposConferencia(productId, r.itens, ultimoAdd)
    // Remoção pendente: ausente = REMOVIDO (confirmado); presente = continua na vitrine.
    if (reg.estado === 'REMOCAO_ENVIADA' || reg.estado === 'REMOCAO_INCERTA') {
      const presente = r.itens.some((i) => idDoItem(i) === productId)
      const final: EstadoDaVitrine = presente ? 'CONFIRMADO_NA_VITRINE' : 'REMOVIDO'
      return gravar(workspaceId, productId, base, final, { verificadoEm: agora, requestIdGet: r.requestId, removidoEm: presente ? undefined : agora, detalhe: ROTULO_DA_VITRINE[final] }, { acao: 'GET', requestId: r.requestId }, agora)
    }
    // Ainda dentro da janela depois do Add: ausência = "ainda conferindo", não "falhou" (e nada de reenvio).
    if (estado === 'NAO_ENCONTRADO_NA_VITRINE' && (reg.estado === 'ENVIADO' || reg.estado === 'ENVIO_INCERTO') && reg.enviadoEm && agora.getTime() - reg.enviadoEm.getTime() < JANELA_DE_CONFIRMACAO_MS) {
      estado = reg.estado as EstadoDaVitrine
    }
    return gravar(workspaceId, productId, base, estado, { verificadoEm: agora, requestIdGet: r.requestId, confirmadoEm: estado === 'CONFIRMADO_NA_VITRINE' ? agora : undefined, detalhe: ROTULO_DA_VITRINE[estado] }, { acao: 'GET', requestId: r.requestId }, agora)
  } catch (e) {
    const erro = e instanceof ErroDaTikTokShop ? e : null
    // Falha na LEITURA não muda o que se sabe: o estado continua, só registra a tentativa.
    return gravar(workspaceId, productId, base, reg.estado as EstadoDaVitrine, { verificadoEm: agora }, { acao: 'GET_FALHOU', detalhe: erro ? `${erro.tipo}: ${erro.message}` : 'erro ao ler a vitrine', requestId: erro?.requestId ?? null }, agora)
  }
}

/**
 * Adiciona UM candidato à vitrine e confere. Devolve o registro final.
 * Nunca "adicionado" sem o Get confirmar.
 */
export async function adicionarAVitrine(workspaceId: string, c: CandidatoParaVitrine, deps: DepsDaVitrine = {}) {
  const agora = deps.agora ?? new Date()
  const cfg = configuracaoDaVitrine(deps.env)
  if (!cfg.ligada || !cfg.caminhoAdd) return { ok: false as const, motivo: cfg.motivo ?? 'Vitrine automática desligada.' }
  const productId = c.externalId!
  const base = { candidatoId: c.id, nomeProduto: c.nome }
  const colab = validarColaboracao(c, agora)
  if (!colab.ok) {
    const r = await gravar(workspaceId, productId, base, 'COLABORACAO_NAO_CONFIRMADA', { detalhe: colab.motivo }, { acao: 'VALIDAR', detalhe: colab.motivo }, agora)
    return { ok: false as const, motivo: colab.motivo, registro: r }
  }
  const cliente = await clienteDaCriadora(workspaceId, deps)
  if ('erro' in cliente) return { ok: false as const, motivo: cliente.erro }

  const anterior = await prisma.vitrineTikTokShop.findUnique({ where: { workspaceId_productId: { workspaceId, productId } } })
  // Por que entrou: a decisão do ranking (a vitrine é consequência, não ranking paralelo).
  const motivoEntrada = `Score ${c.score} no ranking de Oportunidades; ${colab.motivo}`
  await gravar(workspaceId, productId, base, 'SELECIONADO', anterior?.motivoEntrada ? {} : { motivoEntrada }, { acao: 'SELECIONAR', detalhe: motivoEntrada }, agora)
  let resposta: unknown = null
  try {
    // ESCRITA: uma tentativa só. Nomes do corpo a confirmar na 1ª chamada real.
    const r = await chamarOpenApi({ metodo: 'POST', caminho: cfg.caminhoAdd, corpo: corpoDoAdd([productId]), tentativas: 1 }, cliente)
    resposta = r.data
    await gravar(workspaceId, productId, base, 'ENVIADO', { enviadoEm: agora, tentativas: (anterior?.tentativas ?? 0) + 1, requestIdAdd: r.requestId, detalhe: ROTULO_DA_VITRINE.ENVIADO }, { acao: 'ADD', requestId: r.requestId, ...({ resposta } as object) }, agora)
  } catch (e) {
    const erro = e instanceof ErroDaTikTokShop ? e : new ErroDaTikTokShop('REDE', 'REDE', 'Não foi possível falar com o TikTok Shop.')
    // Rede/timeout/5xx: o pedido pode ter chegado → INCERTO (confere pelo Get). Recusa explícita → FALHOU.
    const incerto = erro.tipo === 'REDE' || erro.tipo === 'INDISPONIVEL'
    await gravar(workspaceId, productId, base, incerto ? 'ENVIO_INCERTO' : 'FALHOU', { enviadoEm: agora, tentativas: (anterior?.tentativas ?? 0) + 1, requestIdAdd: erro.requestId, detalhe: `${erro.tipo}: ${erro.message}` }, { acao: 'ADD', detalhe: `${erro.tipo}: ${erro.message}`, requestId: erro.requestId }, agora)
    if (!incerto) return { ok: false as const, motivo: erro.message, registro: await prisma.vitrineTikTokShop.findUnique({ where: { workspaceId_productId: { workspaceId, productId } } }) }
  }
  const registro = await conferirNaVitrine(workspaceId, productId, { ...deps, cliente, agora })
  return { ok: registro?.estado === 'CONFIRMADO_NA_VITRINE', motivo: registro ? ROTULO_DA_VITRINE[registro.estado as EstadoDaVitrine] : 'sem registro', registro }
}

/**
 * O FLUXO AUTOMÁTICO: confere o que estava pendente (sem reenviar) e então
 * seleciona os elegíveis e adiciona, um a um. Desligado = não faz nada.
 */
export async function rodarVitrineAutomatica(workspaceId: string, deps: DepsDaVitrine & { limite?: number } = {}) {
  const agora = deps.agora ?? new Date()
  const cfg = configuracaoDaVitrine(deps.env)
  if (!cfg.ligada) return { ligada: false, motivo: cfg.motivo, conferidos: 0, processados: [] as { productId: string; estado: string | null }[] }
  const pendentes = await prisma.vitrineTikTokShop.findMany({ where: { workspaceId, estado: { in: A_CONFERIR } } })
  for (const p of pendentes) await conferirNaVitrine(workspaceId, p.productId, deps)
  const [candidatos, registros] = await Promise.all([
    prisma.candidatoDeProduto.findMany({
      where: { workspaceId, providerId: FONTE_TIKTOK_SHOP, externalId: { not: null }, AND: [CANDIDATO_NAO_EXCLUIDO] },
      select: { id: true, nome: true, fonte: true, providerId: true, externalId: true, status: true, complianceBloqueante: true, validoAte: true, score: true },
    }),
    prisma.vitrineTikTokShop.findMany({ where: { workspaceId }, select: { productId: true, estado: true, tentativas: true } }),
  ])
  const processados: { productId: string; estado: string | null }[] = []
  for (const c of selecionarElegiveis(candidatos, registros, deps.limite ?? 3, agora)) {
    const r = await adicionarAVitrine(workspaceId, c, { ...deps, agora })
    processados.push({ productId: c.externalId!, estado: 'registro' in r && r.registro ? r.registro.estado : null })
  }
  return { ligada: true, motivo: null, conferidos: pendentes.length, processados }
}

/**
 * P2.17.15 — Remover da vitrine: só com remoção automática ligada E caminho
 * oficial confirmado (hoje AGUARDANDO CONFIRMAÇÃO OFICIAL). Uma tentativa só;
 * REMOVIDO só quando o Get confirma a ausência. Tirar o produto da vitrine pode
 * encerrar a comissão dele — por isso só por decisão do Gestor com amostra
 * mínima e alternativa melhor (lib/gestor-de-vitrine.ts).
 */
export async function removerDaVitrine(workspaceId: string, productId: string, motivo: string, deps: DepsDaVitrine = {}) {
  const agora = deps.agora ?? new Date()
  const cfg = configuracaoDaVitrine(deps.env)
  if (!cfg.ligada || !cfg.remocao.ligada || !cfg.remocao.caminho || !cfg.caminhoGet) return { ok: false as const, motivo: cfg.remocao.motivo ?? cfg.motivo ?? 'Remoção indisponível.' }
  const reg = await prisma.vitrineTikTokShop.findUnique({ where: { workspaceId_productId: { workspaceId, productId } } })
  if (!reg || reg.estado !== 'CONFIRMADO_NA_VITRINE') return { ok: false as const, motivo: 'Só se remove o que está CONFIRMADO na vitrine.' }
  const cliente = await clienteDaCriadora(workspaceId, deps)
  if ('erro' in cliente) return { ok: false as const, motivo: cliente.erro }
  const base = { candidatoId: reg.candidatoId, nomeProduto: reg.nomeProduto }
  try {
    // Corpo AGUARDANDO CONFIRMAÇÃO OFICIAL (mesmo formato do Add até a documentação dizer outro).
    const r = await chamarOpenApi({ metodo: 'POST', caminho: cfg.remocao.caminho, corpo: { product_ids: [productId] }, tentativas: 1 }, cliente)
    await gravar(workspaceId, productId, base, 'REMOCAO_ENVIADA', { detalhe: motivo }, { acao: 'REMOVE', detalhe: motivo, requestId: r.requestId }, agora)
  } catch (e) {
    const erro = e instanceof ErroDaTikTokShop ? e : new ErroDaTikTokShop('REDE', 'REDE', 'Não foi possível falar com o TikTok Shop.')
    const incerto = erro.tipo === 'REDE' || erro.tipo === 'INDISPONIVEL'
    await gravar(workspaceId, productId, base, incerto ? 'REMOCAO_INCERTA' : 'CONFIRMADO_NA_VITRINE', { detalhe: `remoção: ${erro.tipo}: ${erro.message}` }, { acao: 'REMOVE', detalhe: `${erro.tipo}: ${erro.message}`, requestId: erro.requestId }, agora)
    if (!incerto) return { ok: false as const, motivo: erro.message }
  }
  // Confirma pela LEITURA: ausente = REMOVIDO; presente = continua na vitrine.
  try {
    const g = await lerVitrine(cfg.caminhoGet, cliente, productId)
    const presente = g.itens.some((i) => idDoItem(i) === productId)
    const estado: EstadoDaVitrine = presente ? 'CONFIRMADO_NA_VITRINE' : 'REMOVIDO'
    const registro = await gravar(workspaceId, productId, base, estado, { verificadoEm: agora, requestIdGet: g.requestId, removidoEm: presente ? undefined : agora, detalhe: presente ? 'remoção não confirmada: o produto continua na vitrine' : ROTULO_DA_VITRINE.REMOVIDO }, { acao: 'GET', requestId: g.requestId }, agora)
    return { ok: !presente, motivo: ROTULO_DA_VITRINE[estado], registro }
  } catch {
    return { ok: false as const, motivo: 'Remoção enviada; a conferência pela vitrine falhou e será refeita.' }
  }
}

export async function registrosDaVitrine(workspaceId: string) {
  return prisma.vitrineTikTokShop.findMany({ where: { workspaceId }, orderBy: { updatedAt: 'desc' }, take: 50 })
}
