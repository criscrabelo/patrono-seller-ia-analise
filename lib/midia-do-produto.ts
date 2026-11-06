/**
 * P2.17.12 — FONTE ÚNICA de mídia por produto.
 *
 * Cada arquivo tem: origem, titularidade/autorização, produto, tipo, data,
 * direito de uso e evidência. E um status, decidido pela MESMA régua do
 * preflight de publicação (`avaliarMidiaParaPublicacao`):
 *
 *   AUTORIZADA      → origem permitida + quem declarou e quando + arquivo no
 *                     storage do próprio projeto (+ termo, se licenciada;
 *                     + id da geração, se gerada pelo Patrono).
 *   BLOQUEADA       → mídia de terceiro: host de marketplace/fornecedor, ou
 *                     origem declarada FORNECEDOR/PLATAFORMA. Não há como
 *                     "autorizar" isso por declaração.
 *   NAO_CONFIRMADA  → falta evidência (quem/quando/termo/custódia).
 *
 * O renderizador só usa AUTORIZADA — e reconfere a régua na hora de usar
 * (o env pode mudar). Mídia autorizada é REAPROVEITADA nas próximas
 * variações do mesmo produto: não se pede de novo.
 */
import { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import {
  avaliarMidiaParaPublicacao,
  hostDeTerceiro,
  TIPO_EVIDENCIA_DE_MIDIA,
  ORIGENS_DE_MIDIA_PUBLICAVEIS,
  type EvidenciaDeMidia,
  type OrigemDeMidiaPublicavel,
} from './evidencia-de-midia'
import { DECLARACOES_OBRIGATORIAS, declaracoesFaltando, type DeclaracaoDoReel } from './validacao-de-reel'
import { autorizacaoParaUso, PREFIXO_DO_TERMO, type IndicioDeTerceiro } from './autorizacao-midia-vendedor'

export const STATUS_DE_MIDIA = ['AUTORIZADA', 'NAO_CONFIRMADA', 'BLOQUEADA'] as const
export type StatusDeMidia = (typeof STATUS_DE_MIDIA)[number]
export const ORIGENS_DE_MIDIA = ['PROPRIO', 'LICENCIADO', 'GERADO_PELO_PATRONO', 'FORNECEDOR', 'PLATAFORMA', 'DESCONHECIDA'] as const
export type OrigemDeMidia = (typeof ORIGENS_DE_MIDIA)[number]
export type TipoDeMidia = 'IMAGEM' | 'VIDEO'

/** Origens que, declaradas, já dizem "o arquivo é de outra pessoa". */
const ORIGENS_DE_TERCEIRO: readonly OrigemDeMidia[] = ['FORNECEDOR', 'PLATAFORMA']

export interface DeclaracaoDaMidia {
  url: string
  tipo: TipoDeMidia
  origem: OrigemDeMidia
  titularidade: string
  direitoDeUso: string
  declaradoPor: string | null
  declaradoEm: Date | null
  descricao: string
  termoDeLicenca?: string | null
  geracaoId?: string | null
  /** Vídeo próprio: as declarações do Reel (gravado por ela, sem música de terceiros…). */
  declaracoes?: Partial<Record<DeclaracaoDoReel, boolean>> | null
  /** P2.18.10 — mídia do vendedor: indícios de direito de terceiro (creator, música, marca…). */
  indicios?: IndicioDeTerceiro[] | null
  /** P2.50 (Codex 5): prazo do direito (fim do dia informado) e canais em que vale. */
  validaAte?: Date | null
  canaisPermitidos?: string[] | null
}

/** FUNÇÃO PURA. O registro de direito no formato do preflight — ou null quando a origem não é publicável. */
export function evidenciaDaDeclaracao(d: DeclaracaoDaMidia): EvidenciaDeMidia | null {
  if (!(ORIGENS_DE_MIDIA_PUBLICAVEIS as readonly string[]).includes(d.origem) || d.origem === ('DERIVADO' as string)) return null
  return {
    tipo: TIPO_EVIDENCIA_DE_MIDIA,
    severidade: 'verde',
    origem: d.origem as OrigemDeMidiaPublicavel,
    assetUrl: d.url.trim(),
    formato: d.tipo === 'VIDEO' ? 'VIDEO_PROPRIO' : 'IMAGEM_DO_PRODUTO',
    declaradoPor: d.declaradoPor ?? '',
    declaradoEm: d.declaradoEm ? d.declaradoEm.toISOString() : '',
    descricao: d.descricao,
    termoDeLicenca: d.termoDeLicenca ?? null,
    geracaoId: d.geracaoId ?? null,
    declaracoes: (d.declaracoes as Record<string, boolean> | null | undefined) ?? null,
    validaAte: d.validaAte ? d.validaAte.toISOString() : null,
    canaisPermitidos: d.canaisPermitidos?.length ? d.canaisPermitidos.map((c) => c.trim().toLowerCase()).filter(Boolean) : null,
    mensagem: `Mídia do produto: ${d.titularidade}. Direito de uso: ${d.direitoDeUso}.`,
  }
}

/**
 * FUNÇÃO PURA. O status da mídia — a régua do preflight, mais duas regras
 * da fonte única: vídeo PRÓPRIO exige as declarações do Reel; mídia de
 * terceiro é BLOQUEADA (não "não confirmada").
 */
export function classificarMidia(d: DeclaracaoDaMidia, env: Record<string, string | undefined>): { status: StatusDeMidia; motivo: string; evidencia: EvidenciaDeMidia | null } {
  const terceiro = hostDeTerceiro(d.url)
  if (terceiro) return { status: 'BLOQUEADA', motivo: `Arquivo hospedado em ${terceiro}: mídia de terceiro, sem direito de uso.`, evidencia: null }
  if (ORIGENS_DE_TERCEIRO.includes(d.origem)) {
    return { status: 'BLOQUEADA', motivo: `Origem "${d.origem}": o arquivo é do vendedor/plataforma. A política de conteúdo do TikTok Shop proíbe usar conteúdo de terceiros sem autorização.`, evidencia: null }
  }
  const evidencia = evidenciaDaDeclaracao(d)
  if (!evidencia) return { status: 'NAO_CONFIRMADA', motivo: 'Origem não confirmada: diga se o arquivo é seu, licenciado ou gerado pelo Patrono.', evidencia: null }
  if (d.origem === 'PROPRIO' && d.tipo === 'VIDEO') {
    const faltam = declaracoesFaltando(d.declaracoes ?? null)
    if (faltam.length > 0) return { status: 'NAO_CONFIRMADA', motivo: `Faltam declarações do vídeo próprio: ${faltam.join(', ')}.`, evidencia }
  }
  const r = avaliarMidiaParaPublicacao({ assetUrl: d.url, evidencia, env })
  return r.autorizada ? { status: 'AUTORIZADA', motivo: r.motivo, evidencia } : { status: 'NAO_CONFIRMADA', motivo: r.motivo, evidencia }
}

export { DECLARACOES_OBRIGATORIAS }

export interface MidiaUtilizavel {
  id: string
  tipo: TipoDeMidia
  url: string
  origem: OrigemDeMidia
  evidencia: EvidenciaDeMidia
  demonstracao: boolean
}

/** Registra (ou atualiza) uma mídia na fonte única. Mesma URL no workspace = mesma mídia. */
export async function registrarMidia(p: {
  workspaceId: string
  produtoId?: string | null
  candidatoId?: string | null
  nomeProduto: string
  declaracao: DeclaracaoDaMidia
  demonstracao?: boolean
  env?: Record<string, string | undefined>
}) {
  if (!p.produtoId && !p.candidatoId) throw new Error('A mídia precisa estar ligada a um produto.')
  const c = p.declaracao.origem === 'FORNECEDOR' && p.candidatoId && !hostDeTerceiro(p.declaracao.url)
    ? await classificarMidiaDoVendedor(p.workspaceId, p.candidatoId, p.declaracao, p.env ?? process.env)
    : classificarMidia(p.declaracao, p.env ?? process.env)
  const dados = {
    produtoId: p.produtoId ?? null,
    candidatoId: p.candidatoId ?? null,
    nomeProduto: p.nomeProduto,
    tipo: p.declaracao.tipo,
    origem: p.declaracao.origem,
    titularidade: p.declaracao.titularidade.slice(0, 300),
    direitoDeUso: p.declaracao.direitoDeUso.slice(0, 300),
    evidencia: c.evidencia ? (c.evidencia as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
    status: c.status,
    motivoStatus: c.motivo,
    declaradoPor: p.declaracao.declaradoPor,
    declaradoEm: p.declaracao.declaradoEm,
    demonstracao: !!p.demonstracao,
  }
  return prisma.midiaDoProduto.upsert({
    where: { workspaceId_url: { workspaceId: p.workspaceId, url: p.declaracao.url.trim() } },
    create: { workspaceId: p.workspaceId, url: p.declaracao.url.trim(), ...dados },
    update: dados,
  })
}

/**
 * As mídias AUTORIZADAS de um produto (pelo produto OU pelo candidato que
 * virou produto), reconferidas na régua agora. Vídeo primeiro (serve a
 * mais formatos), depois a mais recente.
 */
export async function midiasAutorizadas(p: { workspaceId: string; produtoId?: string | null; candidatoId?: string | null; env?: Record<string, string | undefined> }): Promise<MidiaUtilizavel[]> {
  const ou: Prisma.MidiaDoProdutoWhereInput[] = []
  if (p.produtoId) ou.push({ produtoId: p.produtoId })
  if (p.candidatoId) ou.push({ candidatoId: p.candidatoId })
  if (ou.length === 0) return []
  const linhas = await prisma.midiaDoProduto.findMany({ where: { workspaceId: p.workspaceId, status: 'AUTORIZADA', OR: ou }, orderBy: { createdAt: 'desc' } })
  const env = p.env ?? process.env
  // P2.18.10: mídia do vendedor só vale com a autorização vigente AGORA (revogada/expirada não passa).
  const doVendedor = linhas.filter((m) => m.origem === 'FORNECEDOR' && m.candidatoId)
  const vigente = new Set<string>()
  for (const m of doVendedor) {
    const ev = m.evidencia as unknown as { indicios?: IndicioDeTerceiro[] } | null
    const r = await autorizacaoParaUso(p.workspaceId, { candidatoId: m.candidatoId!, canal: 'tiktok', tipoDeMidia: m.tipo as TipoDeMidia, edita: true, indicios: ev?.indicios ?? [] })
    if (r.autorizacao) vigente.add(m.id)
  }
  return linhas
    .filter((m) => m.origem !== 'FORNECEDOR' || vigente.has(m.id))
    .filter((m) => m.evidencia && avaliarMidiaParaPublicacao({ assetUrl: m.url, evidencia: m.evidencia as unknown as EvidenciaDeMidia, env }).autorizada)
    .map((m) => ({ id: m.id, tipo: m.tipo as TipoDeMidia, url: m.url, origem: m.origem as OrigemDeMidia, evidencia: m.evidencia as unknown as EvidenciaDeMidia, demonstracao: m.demonstracao }))
    .sort((a, b) => (a.tipo === b.tipo ? 0 : a.tipo === 'VIDEO' ? -1 : 1))
}

/**
 * P2.18.10 — Mídia do VENDEDOR. Sem autorização vigente: BLOQUEADA (com o
 * motivo). Com autorização que cobre este uso: vale como LICENCIADO, com o
 * termo `autorizacao-vendedor:<id>` — e passa no MESMO preflight.
 */
export async function classificarMidiaDoVendedor(workspaceId: string, candidatoId: string, d: DeclaracaoDaMidia, env: Record<string, string | undefined>, agora = new Date()): Promise<{ status: StatusDeMidia; motivo: string; evidencia: EvidenciaDeMidia | null }> {
  const indicios = d.indicios ?? []
  const r = await autorizacaoParaUso(workspaceId, { candidatoId, canal: 'tiktok', tipoDeMidia: d.tipo, edita: true, indicios }, agora)
  // Os indícios ficam guardados mesmo bloqueada (a próxima reavaliação usa).
  const pendente = { tipo: 'midia_do_vendedor_pendente', indicios } as unknown as EvidenciaDeMidia
  if (!r.autorizacao) return { status: 'BLOQUEADA', motivo: `Mídia do vendedor: ${r.motivo}`, evidencia: pendente }
  // P2.50 (Codex 5): o prazo e os canais da AUTORIZAÇÃO viajam com o registro de direito — vencida, não publica.
  const base = evidenciaDaDeclaracao({ ...d, origem: 'LICENCIADO', termoDeLicenca: `${PREFIXO_DO_TERMO}${r.autorizacao.id}`, validaAte: r.autorizacao.validaAte ?? null, canaisPermitidos: r.autorizacao.canaisPermitidos ?? null })
  if (!base) return { status: 'BLOQUEADA', motivo: 'Mídia do vendedor: registro de direito inválido.', evidencia: pendente }
  const evidencia = { ...base, indicios, mensagem: `Mídia do vendedor (${r.autorizacao.lojaNome}). ${r.motivo}` } as EvidenciaDeMidia
  const av = avaliarMidiaParaPublicacao({ assetUrl: d.url, evidencia, env })
  return av.autorizada ? { status: 'AUTORIZADA', motivo: r.motivo, evidencia } : { status: 'NAO_CONFIRMADA', motivo: av.motivo, evidencia }
}

/** Reavalia uma mídia do vendedor já registrada (autorização aprovada, revogada, expirada…). */
export async function reclassificarMidiaDoVendedor(m: { id: string; workspaceId: string; candidatoId: string | null; url: string; tipo: string; titularidade: string; direitoDeUso: string; declaradoPor: string | null; declaradoEm: Date | null; evidencia: unknown; nomeProduto: string }, agora = new Date(), env: Record<string, string | undefined> = process.env): Promise<StatusDeMidia> {
  if (!m.candidatoId) return 'BLOQUEADA'
  const ev = m.evidencia as { indicios?: IndicioDeTerceiro[]; descricao?: string } | null
  const c = await classificarMidiaDoVendedor(m.workspaceId, m.candidatoId, {
    url: m.url, tipo: m.tipo as TipoDeMidia, origem: 'FORNECEDOR', titularidade: m.titularidade, direitoDeUso: m.direitoDeUso,
    declaradoPor: m.declaradoPor, declaradoEm: m.declaradoEm, descricao: ev?.descricao ?? m.nomeProduto, indicios: ev?.indicios ?? [],
  }, env, agora)
  await prisma.midiaDoProduto.update({ where: { id: m.id }, data: { status: c.status, motivoStatus: c.motivo, evidencia: c.evidencia ? (c.evidencia as unknown as Prisma.InputJsonValue) : Prisma.JsonNull } })
  return c.status
}

/** Reaproveitamento: conta o uso (a mídia não é pedida de novo). */
export async function marcarUso(id: string, agora: Date = new Date()) {
  await prisma.midiaDoProduto.update({ where: { id }, data: { usos: { increment: 1 }, ultimoUsoEm: agora } })
}

/** Tudo o que se sabe da mídia de um produto (para a tela): inclusive as bloqueadas, com o motivo. */
export async function midiasDoProduto(p: { workspaceId: string; produtoId?: string | null; candidatoId?: string | null }) {
  const ou: Prisma.MidiaDoProdutoWhereInput[] = []
  if (p.produtoId) ou.push({ produtoId: p.produtoId })
  if (p.candidatoId) ou.push({ candidatoId: p.candidatoId })
  if (ou.length === 0) return []
  return prisma.midiaDoProduto.findMany({
    where: { workspaceId: p.workspaceId, OR: ou },
    orderBy: { createdAt: 'desc' },
    select: { id: true, tipo: true, url: true, origem: true, titularidade: true, direitoDeUso: true, status: true, motivoStatus: true, declaradoEm: true, usos: true, demonstracao: true, createdAt: true },
  })
}
