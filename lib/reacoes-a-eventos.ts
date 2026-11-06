/**
 * P2.22 — REAÇÕES INTERNAS aos eventos (o processador as chama). Cada reação RELÊ o estado atual antes de agir
 * (evento velho ou fora de ordem vira "obsoleto", sem efeito), reaproveita o caminho canônico que já existe
 * (nenhuma regra paralela) e devolve o que fez (fica em `resultadoProcessamento`).
 *
 * NUNCA: publicar, pedir amostra real, mandar mensagem, gastar, chamar serviço pago, mexer em publicação
 * histórica. Regenerar um vídeo sempre o devolve para a aprovação da titular.
 */
import { prisma } from './prisma'
import type { Reacoes } from './processador-de-eventos'
import { revisarComercialDaAssistida } from './publicacao-assistida'
import { ligarPublicacaoNaAmostra, prazoDaAmostra } from './amostras'
import { sincronizarOperacao } from './jornada'
import { garantirDnaDosResultados } from './dna-criativo'
import { aprendizadoCriativoDoWorkspace } from './resultados-videos'
import { ESPERA_PARA_MEDIR_H } from './motor-da-jornada'
import type { Prisma } from '@prisma/client'

const PENDENTES_DE_PUBLICAR = ['AGUARDANDO_APROVACAO', 'APROVADO', 'FALHOU']

export const REACOES: Reacoes = {
  /** Preço mudou → conteúdo pendente revisado (legenda corrigida ou vídeo regerado → volta para aprovação). */
  async PRICE_CHANGED(e) {
    if (!e.entidadeId) return { obsoleto: 'evento sem produto' }
    const pend = await prisma.publicacaoAssistida.findMany({ where: { workspaceId: e.workspaceId, candidatoId: e.entidadeId, demonstracao: false, estado: { in: PENDENTES_DE_PUBLICAR } }, select: { id: true, estado: true } })
    const revisadas = []
    for (const a of pend) revisadas.push({ id: a.id, estadoAntes: a.estado, ...(await revisarComercialDaAssistida({ workspaceId: e.workspaceId, id: a.id, agora: e.agora, origem: 'processador' })) })
    const depois = pend.length ? await prisma.publicacaoAssistida.findMany({ where: { id: { in: pend.map((a) => a.id) } }, select: { id: true, estado: true } }) : []
    return { candidatoId: e.entidadeId, precoAnterior: e.payload.anterior ?? null, precoNovo: e.payload.novo ?? null, revisadas: revisadas.map((r) => ({ ...r, estadoDepois: depois.find((d) => d.id === r.id)?.estado })), publicadasIntocadas: true }
  },

  /** Amostra RECEBIDA → jornada atualizada pelo caminho canônico (conteúdo/briefing/mídia real/agenda) + prazo. */
  async SAMPLE_DELIVERED(e) {
    const am = e.entidadeId ? await prisma.amostraTikTokShop.findFirst({ where: { id: e.entidadeId, workspaceId: e.workspaceId } }) : null
    if (!am) return { obsoleto: 'amostra não existe mais' }
    if (am.estado !== 'RECEBIDA') return { obsoleto: `a amostra está em ${am.estado} (o evento chegou fora de ordem ou já foi tratado)` }
    const prazo = prazoDaAmostra(am)
    const ctx = await sincronizarOperacao({ workspaceId: e.workspaceId, userId: null, agora: e.agora })
    const j = ctx.jornadas.find((x) => x.fatos.candidato.id === am.candidatoId)
    const a = am.candidatoId ? await prisma.publicacaoAssistida.findFirst({ where: { workspaceId: e.workspaceId, candidatoId: am.candidatoId, demonstracao: false }, orderBy: { createdAt: 'desc' }, select: { id: true, estado: true, horarioPlanejado: true, apresentacao: true } }) : null
    const cenas = ((a?.apresentacao ?? {}) as { cenasParaGravar?: unknown[] }).cenasParaGravar ?? []
    return {
      amostraId: am.id, candidatoId: am.candidatoId, prazo,
      etapa: j?.estado.etapa ?? null, proximaAcao: j?.estado.acao?.tipo ?? null, titulo: j?.estado.titulo ?? null,
      publicacao: a ? { id: a.id, estado: a.estado, horarioPlanejado: a.horarioPlanejado?.toISOString() ?? null, briefing: cenas.length } : null,
    }
  },

  /** Publicado → medição começa (resultado + DNA), a amostra é ligada e a obrigação de conteúdo registrada. */
  async CONTENT_PUBLISHED(e) {
    const a = e.entidadeId ? await prisma.publicacaoAssistida.findFirst({ where: { id: e.entidadeId, workspaceId: e.workspaceId } }) : null
    if (!a) return { obsoleto: 'publicação não existe' }
    if (a.estado !== 'PUBLICADO') return { obsoleto: `a publicação está em ${a.estado}` }
    const resultado = await prisma.videoTikTokResultado.findUnique({ where: { publicacaoAssistidaId: a.id }, select: { id: true, publicadoEm: true } })
    await garantirDnaDosResultados(e.workspaceId)
    let obrigacao: Record<string, unknown> | null = null
    if (a.candidatoId) {
      await ligarPublicacaoNaAmostra(e.workspaceId, a.candidatoId, a.id)
      const am = await prisma.amostraTikTokShop.findFirst({ where: { workspaceId: e.workspaceId, publicacaoAssistidaId: a.id } })
      if (am) {
        const prazo = prazoDaAmostra(am)
        const hist = (am.historico as unknown as { acao?: string }[]) ?? []
        const noPrazo = prazo ? (a.publicadoEm ?? e.agora).getTime() <= new Date(prazo.em).getTime() : null
        obrigacao = { amostraId: am.id, prazo: prazo?.em ?? null, prazoConfirmado: prazo?.confirmado ?? false, cumpridaNoPrazo: noPrazo }
        if (!hist.some((h) => h.acao === 'OBRIGACAO_DE_CONTEUDO')) {
          await prisma.amostraTikTokShop.updateMany({ where: { id: am.id }, data: { historico: [...hist, { em: e.agora.toISOString(), acao: 'OBRIGACAO_DE_CONTEUDO', publicacaoAssistidaId: a.id, ...obrigacao }] as unknown as Prisma.InputJsonValue } })
        }
      }
    }
    const desde = resultado?.publicadoEm ?? a.publicadoEm
    return { publicacaoId: a.id, medicaoIniciada: !!resultado, resultadoId: resultado?.id ?? null, medirAPartirDe: desde ? new Date(desde.getTime() + ESPERA_PARA_MEDIR_H * 3_600_000).toISOString() : null, obrigacao }
  },

  /** Comissão confirmada → o aprendizado (P2.21) passa a contar o valor confirmado (peso 1) e recalcula. */
  async COMMISSION_CONFIRMED(e) {
    const ped = e.entidadeId ? await prisma.pedidoAfiliadoTikTok.findFirst({ where: { id: e.entidadeId, workspaceId: e.workspaceId } }) : null
    if (!ped) return { obsoleto: 'pedido não existe' }
    if (ped.estado !== 'LIQUIDADA') return { obsoleto: `o pedido está ${ped.estado} (revertido depois?)` }
    const { aprendizado, orientacao } = await aprendizadoCriativoDoWorkspace(e.workspaceId, e.agora)
    return {
      pedidoId: ped.pedidoId, comissaoLiquidada: ped.comissaoLiquidada, videoResultadoId: ped.videoResultadoId,
      aprendizado: { videosComparaveis: aprendizado.videosComparaveis, recomendacoesQueOrientam: aprendizado.recomendacoes.filter((r) => r.orientaPlanejador).length, motivos: orientacao.motivos.slice(0, 3) },
    }
  },

  /** Reversão (reembolso depois da liquidação) → o aprendizado deixa de contar e recalcula. O histórico fica. */
  async COMMISSION_REVERSED(e) {
    const ped = e.entidadeId ? await prisma.pedidoAfiliadoTikTok.findFirst({ where: { id: e.entidadeId, workspaceId: e.workspaceId } }) : null
    if (!ped) return { obsoleto: 'pedido não existe' }
    const { aprendizado } = await aprendizadoCriativoDoWorkspace(e.workspaceId, e.agora)
    return { pedidoId: ped.pedidoId, estado: ped.estado, aprendizado: { videosComparaveis: aprendizado.videosComparaveis } }
  },
}

export const TIPOS_COM_REACAO = Object.keys(REACOES)
