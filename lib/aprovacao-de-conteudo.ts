/**
 * P2.50 — Aprovação VINCULADA À VERSÃO do conteúdo (achado crítico da auditoria externa).
 *
 * A aprovação grava a impressão digital do que a titular viu: vídeo, legendas, roteiro e produto. A porta única de
 * publicação (lib/porta-de-publicacao-real.ts) só libera com status aprovado/agendado E a mesma impressão. Mudou
 * qualquer um desses campos depois da aprovação → a aprovação deixa de valer (a rota de edição também devolve o
 * conteúdo para "aguardando aprovação"). Sem migration: a impressão fica no registro de auditoria da aprovação.
 */
import { createHash } from 'node:crypto'
import { prisma } from './prisma'

/** Campos que, se mudarem, invalidam a aprovação. */
export const CAMPOS_APROVADOS = [
  'videoUrl', 'produtoId', 'legendaInstagram', 'legendaTiktok', 'legendaYoutube', 'legendaWhatsapp', 'legendaFacebook', 'legendaMarketplace',
  'roteiro', 'textoTela', 'narracao', 'chamadaAcao', 'hashtags',
] as const

type Material = Partial<Record<(typeof CAMPOS_APROVADOS)[number], unknown>>

/** FUNÇÃO PURA. Mesma entrada → mesma impressão (ordem fixa dos campos; ausente = null). */
export function impressaoDoConteudo(c: Material): string {
  const base = CAMPOS_APROVADOS.map((k) => [k, c[k] ?? null])
  return createHash('sha256').update(JSON.stringify(base)).digest('hex')
}

/** FUNÇÃO PURA. A edição toca algum campo aprovado? */
export function alteraMaterialAprovado(alteracao: Record<string, unknown>): boolean {
  return CAMPOS_APROVADOS.some((k) => k in alteracao)
}

export interface AprovacaoDoConteudo { valida: boolean; motivo: string | null; impressao: string | null }

export async function aprovacaoValidaDoConteudo(workspaceId: string, contentId: string): Promise<AprovacaoDoConteudo> {
  const c = await prisma.conteudo.findFirst({ where: { id: contentId, workspaceId } })
  if (!c) return { valida: false, motivo: 'Conteúdo não encontrado.', impressao: null }
  if (c.status !== 'aprovado' && c.status !== 'agendado') return { valida: false, motivo: `O conteúdo não está aprovado (está "${c.status}"). Aprove na tela de Aprovação antes de publicar.`, impressao: null }
  const atual = impressaoDoConteudo(c as unknown as Material)
  const ultima = await prisma.auditLog.findFirst({
    where: { workspaceId, entityType: 'Conteudo', entityId: contentId, action: 'conteudo.aprovado' },
    orderBy: { createdAt: 'desc' }, select: { metadata: true },
  })
  const aprovada = (ultima?.metadata as { impressao?: string } | null)?.impressao ?? null
  if (!aprovada) return { valida: false, motivo: 'Não há registro de QUAL versão foi aprovada. Aprove de novo na tela de Aprovação.', impressao: atual }
  if (aprovada !== atual) return { valida: false, motivo: 'O conteúdo mudou depois da aprovação (vídeo, legenda, roteiro ou produto). Aprove a versão atual antes de publicar.', impressao: atual }
  return { valida: true, motivo: null, impressao: atual }
}
