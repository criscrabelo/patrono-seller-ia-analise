/**
 * P2.17.3 — Metas e recompensas do TikTok Shop.
 *
 * As missões são registradas pela titular (não há API pública confirmada de
 * missões). Aqui: análise PURA de cada missão (faltantes, prazo, ritmo, risco,
 * prioridade, próxima ação) e a prioridade comercial dos produtos para o
 * TikTok:
 *
 *   evidência de venda > ajuda a cumprir missão > Natal > comissão >
 *   facilidade de vídeo
 *
 * A recompensa entra como receita potencial JUNTO com a comissão. A evidência
 * continua mandando: produto sem prova de venda nunca passa à frente de um que
 * vende só por causa da missão.
 */
import { FAIXA_DE_DESEMPATE } from './faixa-de-evidencia'
import { ehProdutoTikTokShop } from './tiktok-shop-link'
import type { MetaTikTokShop } from '@prisma/client'
import { prisma } from './prisma'
import { registrarAuditoria } from './audit-log'
import { facilidadeDeVideo } from './motor-de-videos-tiktok'

export const TIPOS_DE_META = ['VIDEOS_QUALIFICADOS', 'VIDEOS_COM_PRODUTO', 'ADICIONAR_PRODUTOS', 'SOLICITAR_AMOSTRAS', 'OUTRO'] as const
export type TipoDeMeta = (typeof TIPOS_DE_META)[number]

export const ROTULO_DO_TIPO: Record<TipoDeMeta, { unidade: string; acao: string }> = {
  VIDEOS_QUALIFICADOS: { unidade: 'vídeo(s) qualificado(s)', acao: 'publicar' },
  VIDEOS_COM_PRODUTO: { unidade: 'vídeo(s) com produto à venda', acao: 'publicar' },
  ADICIONAR_PRODUTOS: { unidade: 'produto(s) adicionado(s) à vitrine', acao: 'adicionar' },
  SOLICITAR_AMOSTRAS: { unidade: 'amostra(s) solicitada(s)', acao: 'solicitar' },
  OUTRO: { unidade: 'ação(ões)', acao: 'fazer' },
}

/**
 * Ritmo diário que consideramos sustentável para uma pessoa (heurística
 * declarada, não regra do TikTok). Acima disso a meta fica em risco.
 */
export const RITMO_SUSTENTAVEL_POR_DIA: Record<TipoDeMeta, number> = {
  VIDEOS_QUALIFICADOS: 3,
  VIDEOS_COM_PRODUTO: 3,
  ADICIONAR_PRODUTOS: 15,
  SOLICITAR_AMOSTRAS: 10,
  OUTRO: 3,
}

const DIA = 24 * 60 * 60 * 1000

export type SituacaoDaMeta = 'NAO_INICIADA' | 'EM_ANDAMENTO' | 'CONCLUIDA' | 'EXPIRADA'
export type RiscoDaMeta = 'NENHUM' | 'BAIXO' | 'MEDIO' | 'ALTO' | 'PERDIDA'

export interface MetaParaAnalise {
  id: string
  nome: string
  tipo: string
  inicio: Date
  fim: Date
  recompensaValor: number | null
  recompensaDescricao: string | null
  quantidadeExigida: number
  quantidadeRealizada: number
  requisitos: string | null
  /** P2.17.3.1: campanha que agrupa metas e a recompensa TOTAL da campanha. */
  campanha?: string | null
  recompensaCampanha?: number | null
}

export interface AnaliseDaMeta {
  id: string
  nome: string
  tipo: TipoDeMeta
  situacao: SituacaoDaMeta
  faltam: number
  progresso: number
  diasRestantes: number
  hojeRecomendado: number
  ritmoNecessario: number | null
  risco: RiscoDaMeta
  /** Ritmo necessário ÷ ritmo sustentável (0 = folgado; > 1 = acima do sustentável). */
  pressao: number
  campanha: string | null
  prioridade: number
  recompensaTexto: string
  frases: string[]
  proximaAcao: string
  usaProdutoNoVideo: boolean
}

function tipoValido(t: string): TipoDeMeta {
  return (TIPOS_DE_META as readonly string[]).includes(t) ? (t as TipoDeMeta) : 'OUTRO'
}

const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/** FUNÇÃO PURA. `maiorRecompensa` normaliza o peso da recompensa entre as metas. */
export function analisarMeta(m: MetaParaAnalise, agora: Date, maiorRecompensa: number | null = null): AnaliseDaMeta {
  const tipo = tipoValido(m.tipo)
  const r = ROTULO_DO_TIPO[tipo]
  const faltam = Math.max(0, m.quantidadeExigida - m.quantidadeRealizada)
  const progresso = m.quantidadeExigida > 0 ? Math.min(1, m.quantidadeRealizada / m.quantidadeExigida) : 1
  const msRestante = m.fim.getTime() - agora.getTime()
  const diasRestantes = msRestante <= 0 ? 0 : Math.ceil(msRestante / DIA)
  const situacao: SituacaoDaMeta =
    faltam === 0 ? 'CONCLUIDA' : diasRestantes === 0 ? 'EXPIRADA' : agora.getTime() < m.inicio.getTime() ? 'NAO_INICIADA' : 'EM_ANDAMENTO'
  // P2.17.4 (auditoria): missão que ainda não começou conta os dias a partir do INÍCIO.
  const diasUteis = situacao === 'NAO_INICIADA' ? Math.max(1, Math.ceil((m.fim.getTime() - m.inicio.getTime()) / DIA)) : Math.max(1, diasRestantes)
  const ritmo = situacao === 'EM_ANDAMENTO' || situacao === 'NAO_INICIADA' ? faltam / diasUteis : null
  const sustentavel = RITMO_SUSTENTAVEL_POR_DIA[tipo]
  const risco: RiscoDaMeta =
    situacao === 'CONCLUIDA' ? 'NENHUM'
      : situacao === 'EXPIRADA' ? 'PERDIDA'
        : ritmo !== null && ritmo > sustentavel ? 'ALTO'
          : diasRestantes <= 1 && faltam > 1 ? 'ALTO'
            : ritmo !== null && ritmo > sustentavel / 2 ? 'MEDIO'
              : 'BAIXO'
  const hojeRecomendado = situacao === 'EM_ANDAMENTO' ? Math.ceil(faltam / Math.max(1, diasRestantes)) : 0

  // Prioridade 0–100: recompensa (40) + urgência (30) + chance de concluir (20) + facilidade (10).
  // Recompensa só da campanha (divisão não informada): todas as metas do grupo
  // pesam igual pelo total — nada de dividir por palpite.
  const valorDeReferencia = m.recompensaValor ?? m.recompensaCampanha ?? null
  const pesoRecompensa = valorDeReferencia && maiorRecompensa ? Math.min(1, valorDeReferencia / maiorRecompensa) : valorDeReferencia ? 1 : 0.3
  const urgencia = situacao === 'EM_ANDAMENTO' ? Math.min(1, 1 / Math.max(1, diasRestantes)) * 0.7 + 0.3 : 0
  const chance = { NENHUM: 0, PERDIDA: 0, ALTO: 0.3, MEDIO: 0.7, BAIXO: 1 }[risco]
  const facilidade = { ADICIONAR_PRODUTOS: 1, SOLICITAR_AMOSTRAS: 0.8, VIDEOS_QUALIFICADOS: 0.6, VIDEOS_COM_PRODUTO: 0.6, OUTRO: 0.5 }[tipo]
  const prioridade = situacao === 'EM_ANDAMENTO' || situacao === 'NAO_INICIADA'
    ? Math.round(40 * pesoRecompensa + 30 * urgencia + 20 * chance + 10 * facilidade)
    : 0

  const recompensaTexto = m.recompensaValor
    ? `${reais(m.recompensaValor)}${m.recompensaDescricao ? ` (${m.recompensaDescricao})` : ''}`
    : m.recompensaCampanha && m.campanha
      ? `parte da recompensa total de ${reais(m.recompensaCampanha)} da campanha "${m.campanha}" (a divisão por meta não foi informada; confira no app se exige cumprir todas)`
      : m.recompensaDescricao ?? 'recompensa não informada'

  const frases: string[] = []
  if (situacao === 'CONCLUIDA') frases.push(`Missão concluída: ${m.quantidadeRealizada} de ${m.quantidadeExigida}. Confira no TikTok Shop se a recompensa foi liberada.`)
  else if (situacao === 'EXPIRADA') frases.push(`Pelo progresso registrado aqui, o prazo acabou com ${faltam} ${r.unidade} faltando. Confira no app do TikTok Shop: se a missão não foi cumprida, a recompensa não será paga.`)
  else {
    frases.push(`Faltam ${faltam} ${r.unidade} para concluir esta missão.`)
    frases.push(diasRestantes === 1 ? 'Temos 1 dia.' : `Temos ${diasRestantes} dias.`)
    if (situacao === 'EM_ANDAMENTO') frases.push(`Hoje recomendo ${r.acao} ${hojeRecomendado}.`)
    else frases.push('A missão ainda não começou; já dá para preparar.')
    if (risco === 'ALTO') frases.push(`Risco alto de perder a recompensa: o ritmo necessário (${(ritmo ?? 0).toFixed(1)}/dia) passa do sustentável (${sustentavel}/dia).`)
    else if (risco === 'MEDIO') frases.push('Dá para cumprir, mas sem folga: não deixe acumular.')
    frases.push(`Recompensa: ${recompensaTexto}.`)
  }
  const usaProdutoNoVideo = tipo === 'VIDEOS_COM_PRODUTO' || tipo === 'VIDEOS_QUALIFICADOS'
  const proximaAcao =
    situacao === 'CONCLUIDA' ? 'Conferir a liberação da recompensa no TikTok Shop.'
      : situacao === 'EXPIRADA' ? 'Arquivar a missão.'
        : tipo === 'ADICIONAR_PRODUTOS' ? `Adicionar ${hojeRecomendado || faltam} produto(s) dos recomendados à vitrine.`
          : tipo === 'SOLICITAR_AMOSTRAS' ? `Solicitar ${hojeRecomendado || faltam} amostra(s) dos produtos recomendados.`
            : usaProdutoNoVideo ? `Gravar ${hojeRecomendado || 1} vídeo(s) com os produtos recomendados, marcando o produto.`
              : 'Seguir o requisito da missão.'
  const pressao = ritmo !== null ? Math.round((ritmo / sustentavel) * 100) / 100 : 0
  return { id: m.id, nome: m.nome, tipo, situacao, faltam, progresso, diasRestantes, hojeRecomendado, ritmoNecessario: ritmo, risco, pressao, campanha: m.campanha ?? null, prioridade, recompensaTexto, frases, proximaAcao, usaProdutoNoVideo }
}

/** FUNÇÃO PURA. Analisa e ordena por prioridade (ativas primeiro). */
export function analisarMetas(metas: MetaParaAnalise[], agora: Date): AnaliseDaMeta[] {
  const maior = Math.max(0, ...metas.map((m) => m.recompensaValor ?? m.recompensaCampanha ?? 0)) || null
  return metas.map((m) => analisarMeta(m, agora, maior)).sort((a, b) => b.prioridade - a.prioridade || a.diasRestantes - b.diasRestantes)
}

/**
 * FUNÇÃO PURA. A recompensa em jogo: valores por meta + o total de cada
 * campanha UMA vez (só se a campanha ainda tem meta aberta).
 */
export function recompensaEmJogo(metas: MetaParaAnalise[], analises: AnaliseDaMeta[]): number {
  const abertas = new Set(analises.filter((a) => a.situacao === 'EM_ANDAMENTO' || a.situacao === 'NAO_INICIADA').map((a) => a.id))
  let total = 0
  const campanhasContadas = new Set<string>()
  for (const m of metas) {
    if (!abertas.has(m.id)) continue
    if (m.recompensaValor) total += m.recompensaValor
    else if (m.campanha && m.recompensaCampanha && !campanhasContadas.has(m.campanha)) {
      total += m.recompensaCampanha
      campanhasContadas.add(m.campanha)
    }
  }
  return total
}

/**
 * FUNÇÃO PURA. Quais missões abertas um vídeo deste produto ajuda a cumprir.
 * Onde a regra é do TikTok (critério de "vídeo qualificado", amostra grátis),
 * a frase é condicional — nada é afirmado sem confirmação.
 */
export function missoesQueOVideoAjuda(analises: AnaliseDaMeta[], produto: { tiktokShop: boolean }): string[] {
  const out: string[] = []
  for (const a of analises) {
    if (a.situacao !== 'EM_ANDAMENTO' && a.situacao !== 'NAO_INICIADA') continue
    if (a.tipo === 'VIDEOS_QUALIFICADOS') out.push(`"${a.nome}": pode contar como vídeo qualificado se cumprir os critérios do TikTok para vídeo qualificado (confira no app).`)
    if (a.tipo === 'VIDEOS_COM_PRODUTO' && produto.tiktokShop) out.push(`"${a.nome}": conta ao publicar com este produto marcado no vídeo.`)
    if (a.tipo === 'ADICIONAR_PRODUTOS' && produto.tiktokShop) out.push(`"${a.nome}": adicionar este produto à sua vitrine conta 1.`)
    if (a.tipo === 'SOLICITAR_AMOSTRAS' && produto.tiktokShop) out.push(`"${a.nome}": se o vendedor oferecer amostra grátis deste produto, solicitar conta 1.`)
  }
  return out
}

// ── Prioridade comercial de produtos para o TikTok ──────────────────────

export interface ProdutoParaTikTok {
  id: string
  nome: string
  categoria: string | null
  preco: number | null
  providerId: string | null
  linkProduto: string | null
  baseDeEvidencia: number
  vendas: number | null
  comissaoValor: number | null
  comissaoPercentual: number | null
  aderenciaNatal: number | null
}

export interface ProdutoPriorizado extends ProdutoParaTikTok {
  ajudaMissao: boolean
  facilidade: number
  porque: string[]
}

const FAIXA = FAIXA_DE_DESEMPATE

/**
 * FUNÇÃO PURA. Ordem: faixa de evidência (mesma régua do motor) → ajuda a
 * cumprir missão ativa de vídeo (produto do TikTok Shop, marcável) → Natal →
 * comissão por venda → facilidade de vídeo.
 */
export function priorizarProdutosTikTok(produtos: ProdutoParaTikTok[], metas: AnaliseDaMeta[]): ProdutoPriorizado[] {
  const missaoDeVideo = metas.some((m) => m.usaProdutoNoVideo && (m.situacao === 'EM_ANDAMENTO' || m.situacao === 'NAO_INICIADA'))
  const lista = produtos.map((p) => {
    const tiktokShop = ehProdutoTikTokShop(p.providerId, p.linkProduto)
    const ajudaMissao = missaoDeVideo && tiktokShop
    const facilidade = facilidadeDeVideo({ categoria: p.categoria, nome: p.nome, preco: p.preco })
    const porque = [
      `Evidência ${p.baseDeEvidencia}/100${p.vendas !== null ? ` · ${p.vendas.toLocaleString('pt-BR')} vendidos (dado da loja)` : ' · vendas não informadas'}.`,
      ajudaMissao ? 'Ajuda a cumprir missão ativa (produto marcável no vídeo).' : tiktokShop ? 'Produto do TikTok Shop (marcável no vídeo).' : 'Fora do TikTok Shop: não conta para missão de produto à venda.',
      p.aderenciaNatal !== null && p.aderenciaNatal > 0 ? `Natal: aderência ${p.aderenciaNatal}/100.` : '',
      p.comissaoValor !== null ? `Comissão ${p.comissaoValor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} por venda.` : p.comissaoPercentual !== null ? `Comissão ${p.comissaoPercentual}%.` : 'Comissão não informada.',
      `Facilidade de vídeo ${facilidade}/100.`,
    ].filter(Boolean)
    return { ...p, ajudaMissao, facilidade, porque }
  })
  return lista.sort((a, b) => {
    const fa = Math.floor(a.baseDeEvidencia / FAIXA), fb = Math.floor(b.baseDeEvidencia / FAIXA)
    if (fa !== fb) return fb - fa
    if (a.ajudaMissao !== b.ajudaMissao) return a.ajudaMissao ? -1 : 1
    const na = a.aderenciaNatal ?? -1, nb = b.aderenciaNatal ?? -1
    if (na !== nb) return nb - na
    const ca = a.comissaoValor ?? -1, cb = b.comissaoValor ?? -1
    if (ca !== cb) return cb - ca
    return b.facilidade - a.facilidade
  })
}

// ── Banco (registradas pela titular) ────────────────────────────────────

export class ErroDeMeta extends Error {
  constructor(public readonly status: 400 | 404, mensagem: string) {
    super(mensagem)
  }
}

export interface DadosDaMeta {
  nome: string
  tipo: TipoDeMeta
  inicio: Date
  fim: Date
  recompensaValor: number | null
  recompensaDescricao: string | null
  quantidadeExigida: number
  quantidadeRealizada: number
  requisitos: string | null
  campanha?: string | null
  recompensaCampanha?: number | null
}

export function validarDadosDaMeta(d: DadosDaMeta): string | null {
  if (!d.nome.trim()) return 'Dê um nome à missão.'
  if (!(d.fim.getTime() > d.inicio.getTime())) return 'O fim precisa ser depois do início.'
  if (!Number.isInteger(d.quantidadeExigida) || d.quantidadeExigida < 1) return 'A quantidade exigida precisa ser um número inteiro maior que zero.'
  if (!Number.isInteger(d.quantidadeRealizada) || d.quantidadeRealizada < 0) return 'A quantidade realizada não pode ser negativa.'
  if (d.recompensaValor !== null && !(d.recompensaValor >= 0)) return 'Recompensa inválida.'
  if (d.recompensaCampanha != null && !(d.recompensaCampanha >= 0)) return 'Recompensa da campanha inválida.'
  return null
}

export async function criarMeta(p: { workspaceId: string; userId: string; dados: DadosDaMeta }): Promise<MetaTikTokShop> {
  const erro = validarDadosDaMeta(p.dados)
  if (erro) throw new ErroDeMeta(400, erro)
  const meta = await prisma.metaTikTokShop.create({
    data: { ...p.dados, nome: p.dados.nome.trim(), workspaceId: p.workspaceId, criadoPorUserId: p.userId, origem: 'MANUAL' },
  })
  await registrarAuditoria({ workspaceId: p.workspaceId, userId: p.userId, action: 'tiktok.meta_criada', entityType: 'MetaTikTokShop', entityId: meta.id, metadata: { tipo: meta.tipo, exigida: meta.quantidadeExigida } })
  return meta
}

/**
 * P2.17.4 — Salva as metas REVISADAS pela titular (vindas da importação por
 * texto) de uma vez: valida todas antes e grava numa transação (tudo ou nada).
 * `origem` = IMPORTADA_REVISADA, para separar do cadastro manual.
 */
export async function criarMetasRevisadas(p: { workspaceId: string; userId: string; metas: DadosDaMeta[] }): Promise<number> {
  if (!p.metas.length) throw new ErroDeMeta(400, 'Nenhuma meta para salvar.')
  if (p.metas.length > 30) throw new ErroDeMeta(400, 'Muitas metas de uma vez (máximo 30).')
  for (const [i, d] of p.metas.entries()) {
    const erro = validarDadosDaMeta(d)
    if (erro) throw new ErroDeMeta(400, `Meta ${i + 1} ("${d.nome}"): ${erro}`)
  }
  const criadas = await prisma.$transaction(
    p.metas.map((d) =>
      prisma.metaTikTokShop.create({
        data: { ...d, nome: d.nome.trim(), workspaceId: p.workspaceId, criadoPorUserId: p.userId, origem: 'IMPORTADA_REVISADA' },
        select: { id: true },
      })
    )
  )
  await registrarAuditoria({
    workspaceId: p.workspaceId,
    userId: p.userId,
    action: 'tiktok.metas_importadas',
    entityType: 'MetaTikTokShop',
    entityId: criadas[0].id,
    metadata: { quantidade: criadas.length, campanha: p.metas[0].campanha ?? null },
  })
  return criadas.length
}

export async function atualizarMeta(p: { workspaceId: string; userId: string; id: string; mudanca: Partial<DadosDaMeta> & { incremento?: number; arquivar?: boolean } }): Promise<MetaTikTokShop> {
  const { incremento, arquivar, ...campos } = p.mudanca
  // P2.17.4 (auditoria): "+1 feito"/"−1" sozinho é ATÔMICO no banco — dois cliques
  // ao mesmo tempo não perdem contagem (antes: ler → somar → gravar).
  const soIncremento = incremento !== undefined && !arquivar && Object.values(campos).every((v) => v === undefined)
  if (soIncremento) {
    const n = await prisma.$executeRaw`
      UPDATE "MetaTikTokShop" SET "quantidadeRealizada" = GREATEST(0, "quantidadeRealizada" + ${incremento}), "updatedAt" = now()
      WHERE "id" = ${p.id} AND "workspaceId" = ${p.workspaceId}`
    if (n === 0) throw new ErroDeMeta(404, 'Missão não encontrada.')
    const meta = await prisma.metaTikTokShop.findFirstOrThrow({ where: { id: p.id, workspaceId: p.workspaceId } })
    await registrarAuditoria({ workspaceId: p.workspaceId, userId: p.userId, action: 'tiktok.meta_atualizada', entityType: 'MetaTikTokShop', entityId: meta.id, metadata: { incremento, realizada: meta.quantidadeRealizada, exigida: meta.quantidadeExigida } })
    return meta
  }
  const atual = await prisma.metaTikTokShop.findFirst({ where: { id: p.id, workspaceId: p.workspaceId } })
  if (!atual) throw new ErroDeMeta(404, 'Missão não encontrada.')
  const proxima: DadosDaMeta = {
    nome: campos.nome ?? atual.nome,
    tipo: tipoValido(campos.tipo ?? atual.tipo),
    inicio: campos.inicio ?? atual.inicio,
    fim: campos.fim ?? atual.fim,
    recompensaValor: campos.recompensaValor !== undefined ? campos.recompensaValor : atual.recompensaValor,
    recompensaDescricao: campos.recompensaDescricao !== undefined ? campos.recompensaDescricao : atual.recompensaDescricao,
    quantidadeExigida: campos.quantidadeExigida ?? atual.quantidadeExigida,
    quantidadeRealizada: Math.max(0, (campos.quantidadeRealizada ?? atual.quantidadeRealizada) + (incremento ?? 0)),
    requisitos: campos.requisitos !== undefined ? campos.requisitos : atual.requisitos,
    campanha: campos.campanha !== undefined ? campos.campanha : atual.campanha,
    recompensaCampanha: campos.recompensaCampanha !== undefined ? campos.recompensaCampanha : atual.recompensaCampanha,
  }
  const erro = validarDadosDaMeta(proxima)
  if (erro) throw new ErroDeMeta(400, erro)
  const meta = await prisma.metaTikTokShop.update({ where: { id: atual.id }, data: { ...proxima, ...(arquivar ? { status: 'ARQUIVADA' } : {}) } })
  await registrarAuditoria({ workspaceId: p.workspaceId, userId: p.userId, action: arquivar ? 'tiktok.meta_arquivada' : 'tiktok.meta_atualizada', entityType: 'MetaTikTokShop', entityId: meta.id, metadata: { realizada: meta.quantidadeRealizada, exigida: meta.quantidadeExigida } })
  return meta
}

export async function listarMetasAtivas(workspaceId: string) {
  return prisma.metaTikTokShop.findMany({ where: { workspaceId, status: 'ATIVA' }, orderBy: { fim: 'asc' } })
}
