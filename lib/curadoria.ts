/**
 * P2.14.5.13 — Fase 2: curadoria de produtos.
 *
 *   Patrono encontra candidatos → ranqueia → mostra os 3 melhores →
 *   titular escolhe 1 → Patrono cadastra o produto.
 *
 * O ranking é o do motor de oportunidades EXISTENTE
 * (lib/motor-de-oportunidades.ts: `montarFilaDeOportunidades`,
 * `pontuarProduto`, `ordenarFila`, `selecionarParaModo`). Este módulo não
 * calcula score: só grava o retrato do motor e cuida do ciclo de vida do
 * candidato.
 *
 * Fontes nesta fase: catálogo real do workspace e produtos informados pela
 * titular ("Informar produto", fallback). Sem scraping, sem ranking externo
 * inventado, sem vendas/comissão inventadas.
 *
 * Nada aqui muda `automationMode`/`automationPaused`, cria tarefa, gera
 * conteúdo, publica ou chama IA.
 */

import { createHash, randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import type { CandidatoDeProduto } from '@prisma/client'

const Prisma_sql = Prisma.sql
import { prisma } from './prisma'
import {
  calcularDesempenhoHistorico,
  comissaoDaOferta,
  montarFilaComProdutos,
  ordenarFila,
  pontuarProduto,
  selecionarParaModo,
  type OportunidadePontuada,
  type ProdutoDoCatalogo,
} from './motor-de-oportunidades'
import { obterPerfilDaLoja } from './perfil-da-loja'
import { registrarAuditoria } from './audit-log'
import { registrarDecisao, registrarEvento } from './ledger'
import { redigir } from './cofre'
import { comContexto, contextoAtual, novoCorrelationId, log } from './observabilidade'
import { chaveDeOrigemTikTokShop, comoDadosDoItem, comoProdutoDoCatalogo, descobrirNoTikTokShop, FONTE_TIKTOK_SHOP, type ProdutoDoTikTokShop } from './tiktok-shop-descoberta'
import { linkDoTikTokShop } from './tiktok-shop-link'
import { chaveDoDado, identificarProduto, sobreporDadoOficial, type CamposDeMercado } from './dados-de-produto'
import { CANDIDATO_NAO_EXCLUIDO, PRODUTO_NAO_EXCLUIDO } from './produto-canonico'

// ── Vocabulário ─────────────────────────────────────────────────────────

export const FONTE_CATALOGO = 'CATALOGO'
export const FONTE_TITULAR = 'USER_PROVIDED'

/** Status que tiram o candidato da tela (DESCARTADO só por 30 dias). */
export const STATUS_TERMINAIS = ['ESCOLHIDO', 'DESCARTADO', 'CADASTRADO'] as const
/** Encerrados para sempre: já viraram (ou já eram) Produto escolhido. */
export const STATUS_DEFINITIVOS = ['ESCOLHIDO', 'CADASTRADO'] as const

/**
 * P2.14.5.13.1 — DESCARTADO não é permanente: fica fora das coletas por 30
 * dias e depois pode voltar a concorrer, se ainda for elegível. O início da
 * quarentena é o `updatedAt` do candidato (a última escrita é o descarte:
 * coleta e escolha não tocam em candidato descartado). Se algo o atualizar,
 * a quarentena só fica mais longa — nunca mais curta.
 */
export const QUARENTENA_DO_DESCARTE_DIAS = 30

const HORA = 60 * 60 * 1000
const DIA = 24 * HORA

/** Validade por tipo de fonte (decisão da titular em 08/10/2026). */
export const VALIDADE_POR_TIPO = {
  /** Fonte oficial/externa com dados de mercado. */
  EXTERNA: 48 * HORA,
  CATALOGO: 7 * DIA,
  USER_PROVIDED: 7 * DIA,
} as const
export type TipoDeFonte = keyof typeof VALIDADE_POR_TIPO

/**
 * FUNÇÃO PURA. Fim da validade do candidato. Se a fonte trouxer validade
 * própria MENOR, vale a menor.
 */
export function calcularValidade(p: { tipo: TipoDeFonte; coletadoEm: Date; validadeDaFonte?: Date | null }): Date {
  const padrao = new Date(p.coletadoEm.getTime() + VALIDADE_POR_TIPO[p.tipo])
  if (p.validadeDaFonte && p.validadeDaFonte.getTime() < padrao.getTime()) return new Date(p.validadeDaFonte)
  return padrao
}

/** FUNÇÃO PURA. Tipo de fonte de um produto do catálogo, pela origem do registro. */
export function tipoDeFonteDoCatalogo(o: Pick<OportunidadePontuada, 'origem'>, origemDados: string | null): TipoDeFonte {
  if (o.origem === 'OFFICIAL_API' || o.origem === 'AUTHORIZED_PARTNER_API') return 'EXTERNA'
  if ((origemDados ?? '').toUpperCase() === FONTE_TITULAR) return 'USER_PROVIDED'
  return 'CATALOGO'
}

/** Início da janela de quarentena: quem foi descartado depois disto ainda está fora. */
export function inicioDaQuarentena(agora: Date): Date {
  return new Date(agora.getTime() - QUARENTENA_DO_DESCARTE_DIAS * DIA)
}

/**
 * FUNÇÃO PURA. O candidato pode voltar a concorrer?
 *
 * Ponto de extensão (fase futura): reavaliar ANTES dos 30 dias quando
 * preço, comissão, disponibilidade ou outro dado relevante mudar. Nesta
 * fase vale só a quarentena.
 */
export function podeVoltarAConcorrer(c: Pick<CandidatoDeProduto, 'status' | 'updatedAt'>, agora: Date): boolean {
  if ((STATUS_DEFINITIVOS as readonly string[]).includes(c.status)) return false
  if (c.status === 'DESCARTADO') return c.updatedAt.getTime() <= inicioDaQuarentena(agora).getTime()
  return true
}

/**
 * FUNÇÃO PURA. Comprou OU usou → USER_PROVIDED (o produto é da experiência
 * da titular). Nenhum dos dois → MANUAL, como qualquer cadastro à mão. Os
 * dois sinais continuam separados na afinidade (comprado +5 OU usado +10).
 */
export function origemDoInformado(c: { compradoPelaTitular: boolean; usadoPelaTitular: boolean }): string {
  return c.compradoPelaTitular || c.usadoPelaTitular ? FONTE_TITULAR : 'MANUAL'
}

// ── Retrato do motor → candidato ────────────────────────────────────────

/** Dados reais do item, como a fonte os entrega. Ausente = null. */
export interface DadosReaisDoItem {
  nome: string
  linkProduto: string | null
  imagem: string | null
  categoria: string | null
  preco: number | null
  providerId: string | null
  externalId: string | null
  comissaoPercentual: number | null
  /** A fonte informa? Catálogo interno e titular: não → null. */
  vendas: number | null
  velocidadeDeVendas: number | null
  avaliacao: number | null
  numeroDeAvaliacoes: number | null
  estoque: number | null
}

export type RetratoDoCandidato = Omit<
  Prisma.CandidatoDeProdutoUncheckedCreateInput,
  'id' | 'workspaceId' | 'chaveDeOrigem' | 'fonte' | 'produtoId' | 'status' | 'posicao' | 'createdAt' | 'updatedAt'
>

/**
 * FUNÇÃO PURA. Grava o que o motor sabia — sem completar nada. Comissão em
 * R$ só quando preço E percentual são reais.
 */
export function retratoDoCandidato(
  o: OportunidadePontuada,
  item: DadosReaisDoItem,
  datas: { coletadoEm: Date; validoAte: Date }
): RetratoDoCandidato {
  const comissaoValor =
    item.preco !== null && item.comissaoPercentual !== null
      ? Math.round(item.preco * item.comissaoPercentual) / 100
      : null
  return {
    providerId: item.providerId,
    externalId: item.externalId,
    nome: item.nome,
    linkProduto: item.linkProduto,
    imagem: item.imagem,
    // Imagem só conta como autorizada se existe E o motor não impediu a mídia.
    imagemAutorizada: item.imagem !== null && o.publicacaoImpedida === false,
    categoria: item.categoria,
    preco: item.preco,
    comissaoPercentual: item.comissaoPercentual,
    comissaoValor,
    vendas: item.vendas,
    velocidadeDeVendas: item.velocidadeDeVendas,
    avaliacao: item.avaliacao,
    numeroDeAvaliacoes: item.numeroDeAvaliacoes,
    estoque: item.estoque,
    score: o.score,
    baseDeEvidencia: o.componentes.base,
    aderencia: o.componentes.aderenciaAoPerfil,
    aderenciaDoPerfil: o.aderenciaDoPerfil ?? null,
    afinidade: o.afinidadeDaTitular ?? 0,
    confianca: o.confianca,
    nivelDeRisco: o.nivelDeRisco ?? null,
    complianceBloqueante: o.complianceBloqueante ?? false,
    publicacaoImpedida: o.publicacaoImpedida ?? false,
    compradoPelaTitular: o.compradoPelaTitular ?? false,
    usadoPelaTitular: o.usadoPelaTitular ?? false,
    motivosPositivos: o.motivosPositivos ?? [],
    riscos: o.riscos ?? [],
    desconhecidos: desconhecidosDoItem(o.desconhecidos ?? [], item),
    porqueDestaPosicao: o.porqueDestaPosicao,
    coletadoEm: datas.coletadoEm,
    validoAte: datas.validoAte,
  }
}

/** Acrescenta à lista do motor o que a fonte deste item não informou. */
function desconhecidosDoItem(doMotor: string[], item: DadosReaisDoItem): string[] {
  const extra: string[] = []
  if (item.imagem === null) extra.push('imagem do produto')
  if (item.categoria === null) extra.push('categoria (cadastrada como "Outros")')
  return [...new Set([...doMotor, ...extra])]
}

// ── Candidato → Produto ─────────────────────────────────────────────────

/**
 * FUNÇÃO PURA. Produto a criar na escolha, SÓ com dado real do candidato.
 * Campos obrigatórios do cadastro sem dado ficam vazios; categoria ausente
 * vira "Outros". A origem da imagem não é verificada → "De fornecedor"
 * (direito de uso desconhecido; a mídia não é usada até alguém verificar).
 */
export function dadosDoProdutoACriar(
  c: Pick<
    CandidatoDeProduto,
    'nome' | 'categoria' | 'preco' | 'linkProduto' | 'imagem' | 'providerId' | 'externalId' | 'fonte' | 'compradoPelaTitular' | 'usadoPelaTitular'
  >,
  quem: { workspaceId: string; userId: string }
): Prisma.ProdutoUncheckedCreateInput {
  const daTitular = c.fonte === FONTE_TITULAR
  return {
    workspaceId: quem.workspaceId,
    userId: quem.userId,
    nome: c.nome,
    categoria: c.categoria ?? 'Outros',
    preco: c.preco,
    linkProduto: c.linkProduto,
    descricao: null,
    publicoAlvo: [],
    origemConteudo: 'De fornecedor',
    tipoVenda: 'Afiliado',
    // Fase 1: "#usei" em Observações marca uso pela titular (até a Fase 2b).
    observacoes: c.usadoPelaTitular ? '#usei' : null,
    beneficios: [],
    pontosNegativos: [],
    imagens: c.imagem ? [c.imagem] : [],
    videos: [],
    providerId: c.providerId,
    externalId: c.externalId,
    // Comprou ou usou → USER_PROVIDED; nenhum dos dois → MANUAL.
    // Fonte externa → o id da fonte.
    origemDados: daTitular ? origemDoInformado(c) : c.fonte,
  }
}

/** FUNÇÃO PURA. Por que este candidato não pode ser escolhido agora (ou null). */
export function impedimentoParaEscolha(
  c: Pick<CandidatoDeProduto, 'status' | 'validoAte' | 'complianceBloqueante'>,
  agora: Date
): string | null {
  if (c.status !== 'APRESENTADO') return `Candidato em "${c.status}": só um dos 3 apresentados pode ser escolhido.`
  if (c.complianceBloqueante) return 'Candidato bloqueado por compliance.'
  if (c.validoAte.getTime() < agora.getTime()) return 'Candidato vencido: atualize os candidatos antes de escolher.'
  return null
}

// ── Produto informado pela titular (fallback) ───────────────────────────

export interface ProdutoInformado {
  nome: string
  link: string
  categoria?: string | null
  preco?: number | null
  imagem?: string | null
  comprei: boolean
  usei: boolean
}

/**
 * FUNÇÃO PURA. O informado no formato do motor. A imagem informada não tem
 * direito de uso verificado ("De fornecedor"). Comprei OU Usei → origem
 * USER_PROVIDED; "Usei" também vira `#usei` — os sinais da Fase 1.
 */
export function informadoComoProduto(
  c: Pick<CandidatoDeProduto, 'id' | 'nome' | 'categoria' | 'preco' | 'linkProduto' | 'imagem' | 'compradoPelaTitular' | 'usadoPelaTitular' | 'createdAt'> &
    Partial<Pick<CandidatoDeProduto, 'providerId'>>
): ProdutoDoCatalogo {
  return {
    id: c.id,
    nome: c.nome,
    categoria: c.categoria ?? 'Outros',
    preco: c.preco,
    linkProduto: c.linkProduto,
    imagens: c.imagem ? [c.imagem] : [],
    origemConteudo: 'De fornecedor',
    origemDados: origemDoInformado(c),
    // P2.17: link de produto do TikTok Shop reconhecido → programa conhecido.
    providerId: c.providerId ?? null,
    status: 'ativo',
    removidoDaOrigemEm: null,
    createdAt: c.createdAt,
    comissaoPercentual: null,
    observacoes: c.usadoPelaTitular ? '#usei' : null,
  }
}

const SEM_HISTORICO = () =>
  calcularDesempenhoHistorico({ taxaConversao: null, receitaPorClique: null, cliques: 0, vendasElegiveis: 0, publicacoesRecentes: 0 })

/**
 * No informado, comprado/usado são o que a titular MARCOU. A origem
 * USER_PROVIDED vale para os dois; sem isto, "só usei" apareceria como
 * "comprado" também.
 */
function sinaisMarcados(c: Pick<CandidatoDeProduto, 'compradoPelaTitular' | 'usadoPelaTitular'>) {
  return { compradoPelaTitular: c.compradoPelaTitular, usadoPelaTitular: c.usadoPelaTitular }
}

function itemDoInformado(
  c: Pick<CandidatoDeProduto, 'nome' | 'linkProduto' | 'imagem' | 'categoria' | 'preco'> & Partial<Pick<CandidatoDeProduto, 'providerId' | 'externalId'>>
): DadosReaisDoItem {
  return {
    nome: c.nome,
    linkProduto: c.linkProduto,
    imagem: c.imagem,
    categoria: c.categoria,
    preco: c.preco,
    providerId: c.providerId ?? null,
    externalId: c.externalId ?? null,
    comissaoPercentual: null,
    vendas: null,
    velocidadeDeVendas: null,
    avaliacao: null,
    numeroDeAvaliacoes: null,
    estoque: null,
  }
}

/**
 * P2.18.1 — FUNÇÃO PURA. Informado que a descoberta oficial também trouxe:
 * o dado oficial vence campo a campo, mas só quando existe (null oficial
 * nunca apaga o que a titular informou). Identidade e marcas ficam dela.
 */
export function informadoComOficial(
  c: Parameters<typeof informadoComoProduto>[0],
  oficial: ProdutoDoTikTokShop | undefined
): ProdutoDoCatalogo {
  const base = informadoComoProduto(c)
  if (!oficial) return base
  const o = comoProdutoDoCatalogo(oficial, c.createdAt)
  return {
    ...base,
    nome: o.nome || base.nome,
    categoria: oficial.categoria ?? base.categoria,
    preco: o.preco ?? base.preco,
    imagens: o.imagens.length ? o.imagens : base.imagens,
    comissaoPercentual: o.comissaoPercentual ?? base.comissaoPercentual,
  }
}

/** P2.18.1 — FUNÇÃO PURA. Mesma regra para o retrato do candidato. */
export function itemComOficial(item: DadosReaisDoItem, oficial: ProdutoDoTikTokShop | undefined): DadosReaisDoItem {
  if (!oficial) return item
  const o = comoDadosDoItem(oficial)
  const r = { ...item }
  for (const k of Object.keys(o) as (keyof DadosReaisDoItem)[]) {
    if (k === 'linkProduto' && item.linkProduto) continue
    if (o[k] !== null && o[k] !== undefined) (r as Record<string, unknown>)[k] = o[k]
  }
  return r
}

async function canaisConectados(workspaceId: string): Promise<string[]> {
  const integracoes = await prisma.integracao.findMany({
    where: { workspaceId, status: 'conectado' },
    select: { plataforma: true },
  })
  return integracoes.map((i) => i.plataforma)
}

/** Link sem fragmento, com host em minúsculas e sem barra final — a identidade do informado. */
export function linkNormalizado(link: string): string {
  try {
    const u = new URL(link.trim())
    u.hash = ''
    u.hostname = u.hostname.toLowerCase()
    return u.toString().replace(/\/$/, '')
  } catch {
    return link.trim()
  }
}

export class ErroDeCuradoria extends Error {
  constructor(public readonly status: 400 | 404 | 409, mensagem: string) {
    super(mensagem)
  }
}

export async function informarProduto(params: {
  workspaceId: string
  userId: string
  dados: ProdutoInformado
  agora?: Date
}): Promise<CandidatoDeProduto> {
  const agora = params.agora ?? new Date()
  const { workspaceId, dados } = params
  const link = dados.link.trim()

  const jaInformado = await prisma.candidatoDeProduto.findFirst({
    where: { workspaceId, fonte: FONTE_TITULAR, linkProduto: link, status: { notIn: [...STATUS_TERMINAIS] } },
    select: { id: true },
  })
  if (jaInformado) throw new ErroDeCuradoria(409, 'Este link já foi informado e está entre os candidatos.')
  const noCatalogo = await prisma.produto.findFirst({
    where: { workspaceId, linkProduto: link, ...PRODUTO_NAO_EXCLUIDO },
    select: { id: true },
  })
  if (noCatalogo) throw new ErroDeCuradoria(409, 'Este link já é de um produto do catálogo.')

  // P2.17 (modo assistido): link de produto do TikTok Shop → id oficial do
  // produto, sem abrir a página. O mesmo produto não entra duas vezes.
  const tts = linkDoTikTokShop(link)
  const daLoja = tts.ehProduto && tts.productId ? { providerId: FONTE_TIKTOK_SHOP, externalId: tts.productId } : { providerId: null, externalId: null }
  if (daLoja.externalId) {
    const mesmo = await prisma.candidatoDeProduto.findFirst({
      where: { workspaceId, providerId: FONTE_TIKTOK_SHOP, externalId: daLoja.externalId, status: { notIn: [...STATUS_TERMINAIS] } },
      select: { id: true },
    })
    if (mesmo) throw new ErroDeCuradoria(409, 'Este produto do TikTok Shop já está entre os candidatos.')
  }

  const base = {
    id: randomUUID(),
    nome: dados.nome.trim(),
    categoria: dados.categoria?.trim() || null,
    preco: typeof dados.preco === 'number' ? dados.preco : null,
    linkProduto: link,
    imagem: dados.imagem?.trim() || null,
    compradoPelaTitular: dados.comprei,
    usadoPelaTitular: dados.usei,
    createdAt: agora,
    ...daLoja,
  }
  const pontuada = pontuarProduto(informadoComoProduto(base), SEM_HISTORICO(), {
    canaisCapazes: await canaisConectados(workspaceId),
    agora,
    perfil: (await obterPerfilDaLoja(workspaceId, { criarSeAusente: true })).perfil,
  })
  const retrato = {
    ...retratoDoCandidato(pontuada, itemDoInformado(base), {
      coletadoEm: agora,
      validoAte: calcularValidade({ tipo: 'USER_PROVIDED', coletadoEm: agora }),
    }),
    ...sinaisMarcados(base),
  }

  // P2.17.4 (auditoria): chave DETERMINÍSTICA — dois cliques no mesmo produto
  // caem na chave única (workspaceId, chaveDeOrigem) em vez de duplicar.
  const chaveDeOrigem = daLoja.externalId
    ? `titular:tiktok-shop:${daLoja.externalId}`
    : `titular:link:${createHash('sha256').update(linkNormalizado(link)).digest('hex').slice(0, 32)}`
  let candidato: CandidatoDeProduto
  try {
    candidato = await prisma.candidatoDeProduto.create({
      data: {
        ...retrato,
        id: base.id,
        workspaceId,
        chaveDeOrigem,
        fonte: FONTE_TITULAR,
        produtoId: null,
        status: 'NOVO',
        createdAt: agora,
      },
    })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new ErroDeCuradoria(409, 'Este produto já foi informado antes (está entre os candidatos ou foi escolhido/descartado).')
    }
    throw e
  }
  await registrarAuditoria({
    workspaceId,
    userId: params.userId,
    action: 'curadoria.produto_informado',
    entityType: 'CandidatoDeProduto',
    entityId: candidato.id,
    metadata: { comprei: dados.comprei, usei: dados.usei, tiktokShop: !!daLoja.externalId },
  })
  return candidato
}

/**
 * P2.17.17 — Candidato de um produto cuja AMOSTRA a titular já pediu no app
 * do TikTok Shop (sem link conhecido). Mesmo motor do "informado"; idempotente
 * pela chave do produto. Nada de mercado é inventado: comissão/vendas vistas
 * no app entram como observação manual (lib/observacoes-de-mercado.ts).
 */
export async function candidatoDaAmostra(params: { workspaceId: string; nome: string; categoria?: string | null; productIdExterno?: string | null; chaveDoProduto: string; agora?: Date }): Promise<CandidatoDeProduto> {
  const agora = params.agora ?? new Date()
  const chaveDeOrigem = `titular:amostra:${params.chaveDoProduto}`
  const existente = await prisma.candidatoDeProduto.findUnique({ where: { workspaceId_chaveDeOrigem: { workspaceId: params.workspaceId, chaveDeOrigem } } })
  if (existente) return existente
  const base = {
    id: randomUUID(),
    nome: params.nome.trim(),
    categoria: params.categoria?.trim() || null,
    preco: null,
    linkProduto: null,
    imagem: null,
    compradoPelaTitular: false,
    usadoPelaTitular: false,
    createdAt: agora,
    providerId: FONTE_TIKTOK_SHOP,
    externalId: params.productIdExterno ?? null,
  }
  const pontuada = pontuarProduto(informadoComoProduto(base), SEM_HISTORICO(), {
    canaisCapazes: await canaisConectados(params.workspaceId),
    agora,
    perfil: (await obterPerfilDaLoja(params.workspaceId, { criarSeAusente: true })).perfil,
  })
  const retrato = retratoDoCandidato(pontuada, itemDoInformado(base), { coletadoEm: agora, validoAte: calcularValidade({ tipo: 'USER_PROVIDED', coletadoEm: agora }) })
  try {
    return await prisma.candidatoDeProduto.create({
      data: { ...retrato, ...sinaisMarcados(base), id: base.id, workspaceId: params.workspaceId, chaveDeOrigem, fonte: FONTE_TITULAR, produtoId: null, status: 'NOVO', createdAt: agora },
    })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return prisma.candidatoDeProduto.findUniqueOrThrow({ where: { workspaceId_chaveDeOrigem: { workspaceId: params.workspaceId, chaveDeOrigem } } })
    }
    throw e
  }
}

// ── Coleta e ranking ────────────────────────────────────────────────────

export interface ResultadoDaColeta {
  avaliados: number
  candidatosAtivos: number
  apresentados: number
  bloqueados: number
  origemDoPerfil: string
}

/**
 * Coleta e ranqueia com o motor existente e marca os 3 melhores como
 * APRESENTADO. Roda em qualquer modo de automação (é ação da titular) e
 * não altera o modo, não cria tarefa, não gera conteúdo, não publica.
 */
export async function coletarCandidatos(params: { workspaceId: string; userId?: string; agora?: Date; ator?: 'TITULAR' | 'SISTEMA' }): Promise<ResultadoDaColeta> {
  // P2.14.8: uma coleta = um correlationId, compartilhado por decisão, evento e log.
  // P2.18.1: a descoberta automática diária coleta como SISTEMA.
  return comContexto(
    { correlationId: contextoAtual()?.correlationId ?? novoCorrelationId('coleta'), workspaceId: params.workspaceId, ator: params.ator ?? 'TITULAR' },
    () => coletarCandidatosNoContexto(params)
  )
}

async function coletarCandidatosNoContexto(params: { workspaceId: string; userId?: string; agora?: Date }): Promise<ResultadoDaColeta> {
  const agora = params.agora ?? new Date()
  const { workspaceId } = params
  // Fora da coleta: escolhidos/cadastrados (para sempre) e descartados nos
  // últimos 30 dias. Descartado há mais tempo volta a concorrer.
  const foraDaQuarentena = { OR: [{ status: { notIn: ['DESCARTADO' as const] } }, { updatedAt: { lte: inicioDaQuarentena(agora) } }] }
  const emQuarentena = { status: 'DESCARTADO' as const, updatedAt: { gt: inicioDaQuarentena(agora) } }

  // P2.15: tudo o que não depende de outra leitura sai junto — fora da
  // região do banco, cada ida custa caro (ver scripts/perf/perfil-da-coleta.ts).
  const [{ perfil, origem: origemDoPerfil }, canais, encerrados, informadosBrutos, tiktokShop, dadosOficiais, excluidosPelaTitular] = await Promise.all([
    obterPerfilDaLoja(workspaceId, { criarSeAusente: true }),
    canaisConectados(workspaceId),
    prisma.candidatoDeProduto.findMany({
      where: { workspaceId, OR: [{ status: { in: [...STATUS_DEFINITIVOS] } }, emQuarentena] },
      select: { produtoId: true, chaveDeOrigem: true, providerId: true, externalId: true },
    }),
    // 2) Informados pela titular, ainda em aberto: repontuados agora.
    prisma.candidatoDeProduto.findMany({
      where: { workspaceId, fonte: FONTE_TITULAR, produtoId: null, status: { notIn: [...STATUS_DEFINITIVOS] }, ...foraDaQuarentena },
    }),
    // P2.17: fonte oficial do TikTok Shop (só com flag + conta de criadora;
    // senão volta vazia sem ir à rede). Corre junto com as leituras acima.
    descobrirNoTikTokShop(workspaceId).catch((e) => ({ produtos: [] as ProdutoDoTikTokShop[], descartados: 0, motivo: String(e), requestIds: [] as string[] })),
    // P2.17.6: dados OFICIAIS do enriquecimento (só os que trouxeram valor).
    prisma.dadoOficialDeProduto.findMany({ where: { workspaceId, atualizadoEm: { not: null } } }),
    // P2.18.11: cadastro EXCLUÍDO pela titular nunca volta pela coleta (nem pela descoberta, nem depois da quarentena).
    prisma.produto.findMany({ where: { workspaceId, status: 'descartado', externalId: { not: null } }, select: { providerId: true, externalId: true } }),
  ])
  const externoExcluido = new Set(excluidosPelaTitular.map((p) => `${p.providerId}:${p.externalId}`))
  const informados = informadosBrutos.filter((c) => !(c.providerId && c.externalId && externoExcluido.has(`${c.providerId}:${c.externalId}`)))
  const oficialPorChave = new Map(dadosOficiais.map((d) => [d.chave, d]))
  const produtosEncerrados = new Set(encerrados.map((c) => c.produtoId).filter((id): id is string => !!id))
  const chavesEncerradas = new Set(encerrados.map((c) => c.chaveDeOrigem))
  if (tiktokShop.produtos.length || tiktokShop.requestIds.length) {
    log('info', 'curadoria.tiktok_shop', { workspaceId, produtos: tiktokShop.produtos.length, descartados: tiktokShop.descartados, motivo: tiktokShop.motivo, requestIds: tiktokShop.requestIds })
  }

  // 1) Catálogo real (o motor já exclui sintéticos e descartados). Os
  // produtos vêm junto com a fila: nenhuma segunda consulta ao catálogo.
  const { fila: filaCompleta, produtos: brutos } = await montarFilaComProdutos({ workspaceId, agora, canaisCapazes: canais, perfil })
  const filaDoCatalogo = filaCompleta.filter((o) => !produtosEncerrados.has(o.produtoId))
  const brutoPorId = new Map(brutos.map((b) => [b.id, b]))
  // P2.18.1 — o produto que a titular informou e que a descoberta oficial
  // também trouxe é UM candidato só: continua o dela (marcas "comprei/usei",
  // "em mãos", histórico) e passa a ter os dados oficiais.
  const oficialPorExterno = new Map(tiktokShop.produtos.map((p) => [p.externalId, p]))
  const oficialDoInformado = (c: CandidatoDeProduto) =>
    c.providerId === FONTE_TIKTOK_SHOP && c.externalId ? oficialPorExterno.get(c.externalId) : undefined
  const filaDosInformados = informados.map((c) => ({
    ...pontuarProduto(informadoComOficial(c, oficialDoInformado(c)), SEM_HISTORICO(), { canaisCapazes: canais, agora, perfil }),
    workspaceId,
  }))
  const informadoPorId = new Map(informados.map((c) => [c.id, c]))

  // 2b) TikTok Shop (P2.17): o mesmo item já cadastrado no catálogo, já
  // escolhido (inclusive vindo de "Informar produto"), em quarentena ou já
  // informado e em aberto não volta como candidato externo.
  const externosNoCatalogo = new Set(brutos.filter((b) => b.providerId === FONTE_TIKTOK_SHOP && b.externalId).map((b) => b.externalId as string))
  const externosJaConhecidos = new Set(
    [...encerrados, ...informados].filter((c) => c.providerId === FONTE_TIKTOK_SHOP && c.externalId).map((c) => c.externalId as string)
  )
  const doTikTokShop = tiktokShop.produtos.filter(
    (p) => !chavesEncerradas.has(chaveDeOrigemTikTokShop(p.externalId)) && !externosNoCatalogo.has(p.externalId) && !externosJaConhecidos.has(p.externalId) && !externoExcluido.has(`${FONTE_TIKTOK_SHOP}:${p.externalId}`)
  )
  const filaDoTikTokShop = doTikTokShop.map((p) => ({
    ...pontuarProduto(comoProdutoDoCatalogo(p, agora), SEM_HISTORICO(), { canaisCapazes: canais, agora, perfil }),
    workspaceId,
  }))
  const tiktokPorId = new Map(doTikTokShop.map((p) => [chaveDeOrigemTikTokShop(p.externalId), p]))

  // 3) Uma fila só, na ordem do motor; os 3 melhores pela regra do ASSISTED.
  const fila = ordenarFila([...filaDoCatalogo, ...filaDosInformados, ...filaDoTikTokShop])
  const selecao = selecionarParaModo(fila, { automationMode: 'ASSISTED', automationPaused: false })
  const posicaoPorProduto = new Map(selecao.candidatos.map((c) => [c.produtoId, c]))
  const elegiveis = fila.filter((o) => !o.complianceBloqueante && o.classificacao !== 'NAO_ELEGIVEL')

  // 4) Monta TODA a rodada em memória; nada é gravado ainda.
  const linhas: LinhaDaColeta[] = []
  for (const o of elegiveis) {
    const escolhido = posicaoPorProduto.get(o.produtoId)
    const comPosicao = escolhido ? { ...o, porqueDestaPosicao: [escolhido.motivoDaPosicao, ...o.porqueDestaPosicao] } : o
    const situacao = escolhido ? { status: 'APRESENTADO' as const, posicao: escolhido.posicao } : { status: 'NOVO' as const, posicao: null }
    const informado = informadoPorId.get(o.produtoId)
    if (informado) {
      const oficial = oficialDoInformado(informado)
      const retrato = retratoDoCandidato(comPosicao, itemComOficial(itemDoInformado(informado), oficial), {
        coletadoEm: agora,
        validoAte: calcularValidade({ tipo: oficial ? 'EXTERNA' : 'USER_PROVIDED', coletadoEm: agora }),
      })
      linhas.push({
        ...retrato,
        ...(oficial ? { desconhecidos: [...new Set([...(comPosicao.desconhecidos ?? []), ...oficial.desconhecidos])] } : {}),
        ...sinaisMarcados(informado),
        chaveDeOrigem: informado.chaveDeOrigem,
        fonte: informado.fonte,
        produtoId: null,
        ...situacao,
      })
      continue
    }
    const externo = tiktokPorId.get(o.produtoId)
    if (externo) {
      const item = comoDadosDoItem(externo)
      linhas.push({
        ...retratoDoCandidato(comPosicao, item, {
          coletadoEm: agora,
          validoAte: calcularValidade({ tipo: 'EXTERNA', coletadoEm: agora }),
        }),
        desconhecidos: [...new Set([...(comPosicao.desconhecidos ?? []), ...externo.desconhecidos, ...(item.imagem ? [] : ['imagem do produto'])])],
        chaveDeOrigem: chaveDeOrigemTikTokShop(externo.externalId),
        fonte: FONTE_TIKTOK_SHOP,
        produtoId: null,
        ...situacao,
      })
      continue
    }
    const b = brutoPorId.get(o.produtoId)
    if (!b) continue
    linhas.push({
      ...retratoDoCandidato(
        comPosicao,
        {
          nome: b.nome,
          linkProduto: b.linkProduto,
          imagem: b.imagens[0] ?? null,
          categoria: b.categoria,
          preco: b.preco,
          providerId: b.providerId,
          externalId: b.externalId,
          comissaoPercentual: comissaoDaOferta(b.linksDinamicos),
          vendas: null,
          velocidadeDeVendas: null,
          avaliacao: null,
          numeroDeAvaliacoes: null,
          estoque: null,
        },
        { coletadoEm: agora, validoAte: calcularValidade({ tipo: tipoDeFonteDoCatalogo(o, b.origemDados), coletadoEm: agora }) }
      ),
      chaveDeOrigem: `produto:${b.id}`,
      fonte: FONTE_CATALOGO,
      produtoId: b.id,
      ...situacao,
    })
  }

  // 4b) P2.17.6: o dado oficial vence o informado/cadastrado, campo a campo.
  for (const [i, l] of linhas.entries()) {
    const chave = chaveDoDado(l.linkProduto ?? null, identificarProduto(l.linkProduto))
    const oficial = chave ? oficialPorChave.get(chave) : undefined
    if (oficial) linhas[i] = sobreporDadoOficial(l as LinhaDaColeta & CamposDeMercado, oficial)
  }

  // 5) Grava a rodada inteira de uma vez (atômico) — ou nada.
  const bloqueados = fila.length - elegiveis.length
  const r = await persistirColeta({
    workspaceId,
    agora,
    linhas,
    auditoria: params.userId
      ? { userId: params.userId, metadata: { avaliados: fila.length, apresentados: linhas.filter((l) => l.status === 'APRESENTADO').length, bloqueados } }
      : undefined,
  })
  // P2.18.11: depois de cada coleta, a reconciliação corrige o que divergiu da fonte central (só estado derivado).
  await import('./produto-canonico').then((m) => m.reconciliarEstadoDoWorkspace(workspaceId, { aplicar: true, agora })).catch((e) => log('error', 'reconciliacao.falhou', { workspaceId, erro: e instanceof Error ? e.message : String(e) }))

  return {
    avaliados: fila.length,
    candidatosAtivos: r.gravados,
    apresentados: r.apresentados,
    bloqueados,
    origemDoPerfil,
  }
}

// ── Persistência atômica da coleta (P2.14.5.17) ────────────────────────

/** Uma linha da rodada: o retrato do motor + identidade + situação. */
export type LinhaDaColeta = RetratoDoCandidato & {
  chaveDeOrigem: string
  fonte: string
  produtoId: string | null
  status: 'NOVO' | 'APRESENTADO'
  posicao: number | null
}

const MENSAGEM_COLETA_EM_ANDAMENTO = 'Já existe uma coleta em andamento para este workspace. Tente de novo em instantes.'

/**
 * Grava a rodada inteira num ÚNICO comando SQL (P2.15) — atômico por
 * natureza e com UMA ida ao banco (antes: ~8 idas numa transação):
 *   1. trava lógica do workspace (`pg_try_advisory_xact_lock`): uma segunda
 *      coleta simultânea recebe 409; com a trava ocupada nada é escrito;
 *   2. os APRESENTADO anteriores que NÃO estão nesta rodada voltam a NOVO
 *      (os que estão são atualizados pelo próprio upsert — mesmo resultado);
 *   3. `INSERT … ON CONFLICT (workspaceId, chaveDeOrigem) DO UPDATE` com
 *      todas as linhas — nunca reabre escolhido/cadastrado nem descartado em
 *      quarentena, mesmo que mudem entre a leitura e a escrita;
 *   4. auditoria, decisão (ledger) e evento (CANDIDATES_PRESENTED) no mesmo
 *      comando: existem só se tudo deu certo.
 * Qualquer falha desfaz tudo: não há rodada pela metade.
 */
export async function persistirColeta(p: {
  workspaceId: string
  agora: Date
  linhas: LinhaDaColeta[]
  auditoria?: { userId: string; metadata: Record<string, unknown> }
}): Promise<{ gravados: number; apresentados: number }> {
  const agoraIso = p.agora.toISOString()
  const quarentenaIso = inicioDaQuarentena(p.agora).toISOString()
  const json = JSON.stringify(
    p.linhas.map((l) => ({
      ...l,
      id: randomUUID(),
      coletadoEm: new Date(l.coletadoEm as Date).toISOString(),
      validoAte: new Date(l.validoAte as Date).toISOString(),
    }))
  )
  const trava = `curadoria:${p.workspaceId}`
  const chavesDaRodada = p.linhas.map((l) => l.chaveDeOrigem)

  // Decisão e evento da rodada (P2.14.7), montados aqui e gravados no mesmo comando.
  const escolhidos = p.linhas
    .filter((l) => l.status === 'APRESENTADO')
    .sort((x, y) => (x.posicao ?? 99) - (y.posicao ?? 99))
    .map((l) => ({ posicao: l.posicao, chaveDeOrigem: l.chaveDeOrigem, nome: l.nome, score: l.score, confianca: l.confianca, porque: Array.isArray(l.porqueDestaPosicao) ? l.porqueDestaPosicao : [] }))
  const chaveDaColeta = `coleta:${agoraIso}`
  const ctx = contextoAtual()
  const decisao = {
    id: randomUUID(),
    texto: escolhidos.length ? `Apresentar ${escolhidos.length} candidato(s).` : 'Nenhum candidato apto para apresentar.',
    entradas: JSON.stringify(redigir({ avaliados: p.linhas.length, apresentados: escolhidos })),
    explicacao: escolhidos.map((e) => `${e.posicao}º ${e.nome}: ${e.porque.join(' ')}`.trim()),
  }
  const evento = { id: randomUUID(), payload: JSON.stringify(redigir({ avaliados: p.linhas.length, apresentados: escolhidos.length, chaves: escolhidos.map((e) => e.chaveDeOrigem) })) }
  const auditoria = p.auditoria
    ? Prisma_sql`
      , auditoria AS (
        INSERT INTO "AuditLog" ("id", "workspaceId", "userId", "action", "entityType", "entityId", "metadata", "createdAt")
        SELECT ${randomUUID()}, ${p.workspaceId}, ${p.auditoria.userId}, 'curadoria.candidatos_coletados', 'CandidatoDeProduto', ${p.workspaceId},
               ${JSON.stringify(redigir(p.auditoria.metadata))}::jsonb, ${agoraIso}::timestamp(3)
        WHERE (SELECT ok FROM trava)
        RETURNING 1
      )`
    : Prisma_sql``

  const [r] = await prisma.$queryRaw<{ ok: boolean; gravados: number; apresentados: number }[]>`
    WITH trava AS (
      SELECT pg_try_advisory_xact_lock(hashtextextended(${trava}, 0)) AS ok
    ),
    dados AS (
      SELECT j FROM jsonb_array_elements(${json}::jsonb) AS e(j) WHERE (SELECT ok FROM trava)
    ),
    reinicio AS (
      UPDATE "CandidatoDeProduto" SET "status" = 'NOVO', "posicao" = NULL, "updatedAt" = ${agoraIso}::timestamp(3)
      WHERE (SELECT ok FROM trava) AND "workspaceId" = ${p.workspaceId} AND "status" = 'APRESENTADO'
        AND NOT ("chaveDeOrigem" = ANY(${chavesDaRodada}::text[]))
      RETURNING 1
    ),
    gravados AS (
        INSERT INTO "CandidatoDeProduto" (
          "id", "workspaceId", "chaveDeOrigem", "fonte", "providerId", "externalId", "produtoId",
          "nome", "linkProduto", "imagem", "imagemAutorizada", "categoria", "preco",
          "comissaoPercentual", "comissaoValor", "vendas", "velocidadeDeVendas", "avaliacao", "numeroDeAvaliacoes", "estoque",
          "score", "baseDeEvidencia", "aderencia", "aderenciaDoPerfil", "afinidade", "confianca", "nivelDeRisco",
          "complianceBloqueante", "publicacaoImpedida", "compradoPelaTitular", "usadoPelaTitular",
          "motivosPositivos", "riscos", "desconhecidos", "porqueDestaPosicao",
          "status", "posicao", "coletadoEm", "validoAte", "createdAt", "updatedAt"
        )
        SELECT
          j->>'id', ${p.workspaceId}, j->>'chaveDeOrigem', j->>'fonte', j->>'providerId', j->>'externalId', j->>'produtoId',
          j->>'nome', j->>'linkProduto', j->>'imagem', (j->>'imagemAutorizada')::boolean, j->>'categoria', (j->>'preco')::double precision,
          (j->>'comissaoPercentual')::double precision, (j->>'comissaoValor')::double precision, (j->>'vendas')::integer,
          (j->>'velocidadeDeVendas')::double precision, (j->>'avaliacao')::double precision, (j->>'numeroDeAvaliacoes')::integer, (j->>'estoque')::integer,
          (j->>'score')::integer, (j->>'baseDeEvidencia')::integer, (j->>'aderencia')::integer, (j->>'aderenciaDoPerfil')::integer,
          (j->>'afinidade')::integer, j->>'confianca', j->>'nivelDeRisco',
          (j->>'complianceBloqueante')::boolean, (j->>'publicacaoImpedida')::boolean, (j->>'compradoPelaTitular')::boolean, (j->>'usadoPelaTitular')::boolean,
          ARRAY(SELECT jsonb_array_elements_text(j->'motivosPositivos')),
          ARRAY(SELECT jsonb_array_elements_text(j->'riscos')),
          ARRAY(SELECT jsonb_array_elements_text(j->'desconhecidos')),
          ARRAY(SELECT jsonb_array_elements_text(j->'porqueDestaPosicao')),
          (j->>'status')::"StatusDoCandidato", (j->>'posicao')::integer,
          (j->>'coletadoEm')::timestamp(3), (j->>'validoAte')::timestamp(3), ${agoraIso}::timestamp(3), ${agoraIso}::timestamp(3)
        FROM dados
        ON CONFLICT ("workspaceId", "chaveDeOrigem") DO UPDATE SET
          "providerId" = EXCLUDED."providerId", "externalId" = EXCLUDED."externalId",
          "nome" = EXCLUDED."nome", "linkProduto" = EXCLUDED."linkProduto", "imagem" = EXCLUDED."imagem",
          "imagemAutorizada" = EXCLUDED."imagemAutorizada", "categoria" = EXCLUDED."categoria", "preco" = EXCLUDED."preco",
          "comissaoPercentual" = EXCLUDED."comissaoPercentual", "comissaoValor" = EXCLUDED."comissaoValor",
          "vendas" = EXCLUDED."vendas", "velocidadeDeVendas" = EXCLUDED."velocidadeDeVendas", "avaliacao" = EXCLUDED."avaliacao",
          "numeroDeAvaliacoes" = EXCLUDED."numeroDeAvaliacoes", "estoque" = EXCLUDED."estoque",
          "score" = EXCLUDED."score", "baseDeEvidencia" = EXCLUDED."baseDeEvidencia", "aderencia" = EXCLUDED."aderencia",
          "aderenciaDoPerfil" = EXCLUDED."aderenciaDoPerfil", "afinidade" = EXCLUDED."afinidade", "confianca" = EXCLUDED."confianca",
          "nivelDeRisco" = EXCLUDED."nivelDeRisco", "complianceBloqueante" = EXCLUDED."complianceBloqueante",
          "publicacaoImpedida" = EXCLUDED."publicacaoImpedida", "compradoPelaTitular" = EXCLUDED."compradoPelaTitular",
          "usadoPelaTitular" = EXCLUDED."usadoPelaTitular", "motivosPositivos" = EXCLUDED."motivosPositivos",
          "riscos" = EXCLUDED."riscos", "desconhecidos" = EXCLUDED."desconhecidos", "porqueDestaPosicao" = EXCLUDED."porqueDestaPosicao",
          "status" = EXCLUDED."status", "posicao" = EXCLUDED."posicao",
          "coletadoEm" = EXCLUDED."coletadoEm", "validoAte" = EXCLUDED."validoAte", "updatedAt" = EXCLUDED."updatedAt"
        WHERE "CandidatoDeProduto"."status" NOT IN ('ESCOLHIDO', 'CADASTRADO')
          AND NOT ("CandidatoDeProduto"."status" = 'DESCARTADO' AND "CandidatoDeProduto"."updatedAt" > ${quarentenaIso}::timestamp(3))
        RETURNING "status"::text AS status
    ),
    decisao AS (
      INSERT INTO "DecisionRecord" ("id", "workspaceId", "tipo", "ator", "decisao", "entradas", "ausentes", "explicacao", "regra", "chaveIdempotencia", "runId", "correlationId")
      SELECT ${decisao.id}, ${p.workspaceId}, 'CURADORIA_APRESENTACAO', 'PATRONO', ${decisao.texto}, ${decisao.entradas}::jsonb, ARRAY[]::text[],
             ${decisao.explicacao}::text[], 'curadoria:ranking-v1', ${chaveDaColeta}, ${ctx?.runId ?? null}, ${ctx?.correlationId ?? null}
      WHERE (SELECT ok FROM trava)
      ON CONFLICT ("workspaceId", "chaveIdempotencia") DO NOTHING
      RETURNING 1
    ),
    evento AS (
      INSERT INTO "DomainEvent" ("id", "workspaceId", "tipo", "versao", "payload", "chaveIdempotencia", "runId", "correlationId")
      SELECT ${evento.id}, ${p.workspaceId}, 'CANDIDATES_PRESENTED', 1, ${evento.payload}::jsonb, ${chaveDaColeta}, ${ctx?.runId ?? null}, ${ctx?.correlationId ?? null}
      WHERE (SELECT ok FROM trava)
      ON CONFLICT ("workspaceId", "chaveIdempotencia") DO NOTHING
      RETURNING 1
    )${auditoria}
    SELECT (SELECT ok FROM trava) AS ok,
           (SELECT count(*) FROM gravados)::int AS gravados,
           (SELECT count(*) FROM gravados WHERE status = 'APRESENTADO')::int AS apresentados`
  if (!r?.ok) throw new ErroDeCuradoria(409, MENSAGEM_COLETA_EM_ANDAMENTO)
  return { gravados: r.gravados, apresentados: r.apresentados }
}

export interface ResumoDaUltimaColeta {
  em: Date
  avaliados: number
  apresentados: number
  /** null em coletas registradas antes de este número ser gravado. */
  bloqueados: number | null
}

const numeroOuNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/**
 * Última coleta feita pela titular, lida do log de auditoria (só leitura).
 * `null` = nunca houve coleta neste workspace.
 */
export async function ultimaColeta(workspaceId: string): Promise<ResumoDaUltimaColeta | null> {
  const log = await prisma.auditLog.findFirst({
    where: { workspaceId, action: 'curadoria.candidatos_coletados' },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true, metadata: true },
  })
  if (!log) return null
  const m = (log.metadata ?? {}) as Record<string, unknown>
  return {
    em: log.createdAt,
    avaliados: numeroOuNull(m.avaliados) ?? 0,
    apresentados: numeroOuNull(m.apresentados) ?? 0,
    bloqueados: numeroOuNull(m.bloqueados),
  }
}

export async function listarApresentados(workspaceId: string) {
  return prisma.candidatoDeProduto.findMany({
    where: { workspaceId, status: 'APRESENTADO', AND: [CANDIDATO_NAO_EXCLUIDO] },
    orderBy: { posicao: 'asc' },
  })
}

// ── Escolha e descarte ──────────────────────────────────────────────────

export interface ResultadoDaEscolha {
  status: 'ESCOLHIDO' | 'CADASTRADO'
  produtoId: string
  produtoCriado: boolean
}

/**
 * A titular escolhe 1 dos 3. Do catálogo → ESCOLHIDO (o produto já existe;
 * nada é duplicado). Informado/fonte externa → cria o Produto só com dado
 * real, preservando providerId/externalId → CADASTRADO. Clique duplo: o
 * segundo recebe 409 e nenhum produto a mais é criado.
 */
export async function escolherCandidato(params: {
  workspaceId: string
  userId: string
  candidatoId: string
  agora?: Date
  /** P2.15: quem decidiu. PATRONO = escolha automática permitida pela política/regra da titular. */
  ator?: 'TITULAR' | 'PATRONO'
  /** Regra/política que autorizou a escolha automática (vai para o ledger). */
  regra?: string | null
}): Promise<ResultadoDaEscolha> {
  return comContexto(
    { correlationId: contextoAtual()?.correlationId ?? novoCorrelationId('escolha'), workspaceId: params.workspaceId, ator: params.ator ?? 'TITULAR' },
    () => escolherCandidatoNoContexto(params)
  )
}

async function escolherCandidatoNoContexto(params: {
  workspaceId: string
  userId: string
  candidatoId: string
  agora?: Date
  ator?: 'TITULAR' | 'PATRONO'
  regra?: string | null
}): Promise<ResultadoDaEscolha> {
  const agora = params.agora ?? new Date()
  const { workspaceId, userId, candidatoId } = params

  const c = await prisma.candidatoDeProduto.findFirst({ where: { id: candidatoId, workspaceId } })
  if (!c) throw new ErroDeCuradoria(404, 'Candidato não encontrado.')
  const impedimento = impedimentoParaEscolha(c, agora)
  if (impedimento) throw new ErroDeCuradoria(409, impedimento)

  const resultado = await prisma.$transaction(async (tx) => {
    const r = await reivindicarECadastrar(tx, c)
    // P2.14.7: a escolha é da titular — decisão e evento no MESMO commit.
    await registrarDecisao(
      {
        workspaceId,
        tipo: 'ESCOLHA_DE_PRODUTO',
        ator: params.ator ?? 'TITULAR',
        atorUserId: (params.ator ?? 'TITULAR') === 'TITULAR' ? userId : null,
        decisao: (params.ator ?? 'TITULAR') === 'TITULAR' ? `Escolheu "${c.nome}".` : `O Patrono escolheu "${c.nome}" (permitido pela política).`,
        entidadeTipo: 'CandidatoDeProduto',
        entidadeId: c.id,
        entradas: { score: c.score, posicao: c.posicao, produtoId: r.produtoId },
        regra: params.regra ?? null,
        chaveIdempotencia: `escolha:${c.id}`,
      },
      tx
    )
    await registrarEvento(
      { workspaceId, tipo: 'PRODUCT_SELECTED', chaveIdempotencia: `escolha:${c.id}`, entidadeTipo: 'Produto', entidadeId: r.produtoId, payload: { candidatoId: c.id, status: r.status, produtoCriado: r.produtoCriado } },
      tx
    )
    return r
  })

  async function reivindicarECadastrar(tx: Prisma.TransactionClient, c: CandidatoDeProduto): Promise<ResultadoDaEscolha> {
    // Reivindicação atômica: só um clique passa.
    const reivindicado = await tx.candidatoDeProduto.updateMany({
      where: { id: c.id, workspaceId, status: 'APRESENTADO', complianceBloqueante: false, validoAte: { gte: agora } },
      data: { status: 'ESCOLHIDO', escolhidoEm: agora, escolhidoPorUserId: userId },
    })
    if (reivindicado.count !== 1) throw new ErroDeCuradoria(409, 'Este candidato acabou de ser escolhido ou mudou de estado.')

    if (c.produtoId) return { status: 'ESCOLHIDO' as const, produtoId: c.produtoId, produtoCriado: false }

    // Mesmo item de uma fonte já cadastrado? Liga, não duplica.
    const existente =
      c.providerId && c.externalId
        ? await tx.produto.findFirst({
            where: { workspaceId, providerId: c.providerId, externalId: c.externalId },
            select: { id: true },
          })
        : null
    const produtoId = existente
      ? existente.id
      : (await tx.produto.create({ data: dadosDoProdutoACriar(c, { workspaceId, userId }), select: { id: true } })).id

    await tx.candidatoDeProduto.update({ where: { id: c.id }, data: { status: 'CADASTRADO', produtoId } })
    return { status: 'CADASTRADO' as const, produtoId, produtoCriado: !existente }
  }

  await registrarAuditoria({
    workspaceId,
    userId,
    action: 'curadoria.candidato_escolhido',
    entityType: 'CandidatoDeProduto',
    entityId: c.id,
    metadata: { status: resultado.status, produtoId: resultado.produtoId, produtoCriado: resultado.produtoCriado, score: c.score },
  })
  if (resultado.produtoCriado) {
    await registrarAuditoria({
      workspaceId,
      userId,
      action: 'produto.criado',
      entityType: 'Produto',
      entityId: resultado.produtoId,
      metadata: { nome: c.nome, origem: 'curadoria', fonte: c.fonte },
    })
  }
  return resultado
}

export async function descartarCandidato(params: { workspaceId: string; userId: string; candidatoId: string; agora?: Date }): Promise<void> {
  // P2.29.1: descartar = decisão de não continuar com o produto → a regra canônica encerra o que é certo que não
  // saiu e deixa para a titular o que pode já estar no TikTok (mesma função da exclusão e da reconciliação).
  const { encerrarProdutoDescartado } = await import('./produto-canonico')
  const agora = params.agora ?? new Date()
  const descartou = await prisma.$transaction(async (tx) => {
    const r = await tx.candidatoDeProduto.updateMany({
      where: { id: params.candidatoId, workspaceId: params.workspaceId, status: { in: ['NOVO', 'APRESENTADO'] } },
      data: { status: 'DESCARTADO', posicao: null },
    })
    if (r.count !== 1) return false
    await encerrarProdutoDescartado(tx, params.workspaceId, [params.candidatoId], [], 'Produto descartado pela titular.', agora)
    return true
  })
  if (!descartou) throw new ErroDeCuradoria(404, 'Candidato não encontrado ou já resolvido.')
  await registrarAuditoria({
    workspaceId: params.workspaceId,
    userId: params.userId,
    action: 'curadoria.candidato_descartado',
    entityType: 'CandidatoDeProduto',
    entityId: params.candidatoId,
  })
}
