/**
 * P2.15.4 — Conferência do conteúdo antes do envio em massa de WhatsApp
 * (servidor). Recusa o que não for aprovado + liberado para WhatsApp + sem
 * alerta vermelho, com mensagem clara e registro no audit log.
 */
import { prisma } from './prisma'
import { registrarAuditoria } from './audit-log'
import { motivoParaNaoEnviar } from './whatsapp-elegibilidade'

export type ResultadoDaConferencia =
  | { ok: true; conteudo: { id: string; legendaWhatsapp: string | null; produto: { imagens: string[] } } }
  | { ok: false; status: number; error: string }

export async function conferirConteudoParaWhatsapp(p: { workspaceId: string; userId: string; conteudoId: string | null }): Promise<ResultadoDaConferencia> {
  const recusar = async (status: number, error: string): Promise<ResultadoDaConferencia> => {
    await registrarAuditoria({
      workspaceId: p.workspaceId,
      userId: p.userId,
      action: 'whatsapp.envio_recusado',
      entityType: 'Conteudo',
      entityId: p.conteudoId ?? 'sem-conteudo',
      metadata: { motivo: error },
    })
    return { ok: false, status, error }
  }
  if (!p.conteudoId) return recusar(400, 'Escolha um conteúdo aprovado para WhatsApp. Envio em massa de texto livre não é permitido.')
  const conteudo = await prisma.conteudo.findFirst({
    where: { id: p.conteudoId, workspaceId: p.workspaceId },
    select: { id: true, status: true, redeSocial: true, legendaWhatsapp: true, alertasCompliance: true, produto: { select: { imagens: true } } },
  })
  if (!conteudo) return recusar(404, 'Conteúdo não encontrado.')
  const motivo = motivoParaNaoEnviar(conteudo)
  if (motivo) return recusar(403, motivo)
  return { ok: true, conteudo }
}
