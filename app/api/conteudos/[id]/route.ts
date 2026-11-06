import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { registrarAuditoria } from '@/lib/audit-log'
import { alteraMaterialAprovado, impressaoDoConteudo } from '@/lib/aprovacao-de-conteudo'

/**
 * P2.15.3: lista branca do que a tela pode alterar (status, agenda, vídeo,
 * legendas). Antes o corpo ia inteiro para o banco: dava para trocar
 * workspaceId/userId/produtoId (inclusive para produto de outro workspace) e
 * aprovar conteúdo com alerta vermelho — a trava só existia na tela.
 */
// P2.15.4: 'publicado' NÃO está aqui — só o executor da publicação grava, com o id do canal.
const STATUS = ['ideia', 'produto_cadastrado', 'roteiro_gerado', 'aguardando_aprovacao', 'aprovado', 'agendado', 'analisar_resultado', 'reaproveitar', 'descartado'] as const
const legenda = z.string().max(5000).nullable()
const Alteracao = z
  .object({
    status: z.enum(STATUS),
    dataAgendamento: z.string().datetime().nullable(),
    videoUrl: z.string().url().nullable(),
    legendaTiktok: legenda,
    legendaInstagram: legenda,
    legendaYoutube: legenda,
    legendaWhatsapp: legenda,
    legendaFacebook: legenda,
    legendaMarketplace: legenda,
    // editor do conteúdo (ConteudoPreview)
    roteiro: legenda,
    textoTela: legenda,
    narracao: legenda,
    promptCurto: legenda,
    promptVideoIA: legenda,
    chamadaAcao: legenda,
    hashtags: z.array(z.string().max(100)).max(60),
    /** A titular confirmou o risco do alerta vermelho na tela de Aprovação (não é gravado). */
    confirmarRisco: z.boolean(),
  })
  .partial()
  .strict()

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const conteudo = await prisma.conteudo.findFirst({
    where: { id, workspaceId: session.user.workspaceId },
    include: { produto: true },
  })

  if (!conteudo) return NextResponse.json({ error: 'Conteúdo não encontrado' }, { status: 404 })
  return NextResponse.json(conteudo)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const bruto = await req.json().catch(() => null)
  if (bruto && typeof bruto === 'object' && (bruto as { status?: unknown }).status === 'publicado')
    return NextResponse.json({ error: 'Um conteúdo só fica "Publicado" quando o canal confirma a publicação. Use "Publicar agora" ou agende.' }, { status: 409 })
  const lido = Alteracao.safeParse(bruto)
  if (!lido.success) {
    const primeiro = lido.error.issues[0]
    return NextResponse.json({ error: primeiro?.code === 'unrecognized_keys' ? 'Campo não pode ser alterado por aqui.' : 'Dados inválidos.' }, { status: 400 })
  }
  const { confirmarRisco, ...body } = lido.data

  const atual = await prisma.conteudo.findFirst({ where: { id, workspaceId: session.user.workspaceId }, select: { alertasCompliance: true, status: true } })
  if (!atual) return NextResponse.json({ error: 'Conteúdo não encontrado' }, { status: 404 })
  // revisão P2.72 (MÉDIA 2): a peça de uma publicação assistida é a versão APROVADA (arquivo + texto). Alterar por
  // aqui deixaria o que sai diferente do que a titular aprovou: só pelo fluxo da Operação (ajuste → nova aprovação).
  if (await prisma.publicacaoAssistida.findFirst({ where: { workspaceId: session.user.workspaceId, conteudoId: id }, select: { id: true } }))
    return NextResponse.json({ error: 'Esta peça é de uma publicação assistida aprovada: para mudar, peça ajuste na Operação.' }, { status: 409 })
  // A trava de alerta vermelho vale no servidor, não só no botão.
  const alertaVermelho = (atual.alertasCompliance as { severidade?: string }[]).some((a) => a?.severidade === 'vermelho')
  if (alertaVermelho && body.status === 'aprovado' && !confirmarRisco)
    return NextResponse.json({ error: 'Este conteúdo tem alerta vermelho de conformidade. Confirme o risco antes de aprovar.' }, { status: 409 })

  const conteudo = await prisma.conteudo.updateMany({
    where: { id, workspaceId: session.user.workspaceId },
    data: {
      ...body,
      dataAgendamento: body.dataAgendamento === undefined ? undefined : body.dataAgendamento ? new Date(body.dataAgendamento) : null,
      // Reagendar limpa o motivo do atraso anterior.
      ...(body.status === 'agendado' && { erroPublicacao: null }),
      // P2.50: editar o material de um conteúdo aprovado/agendado invalida a aprovação (volta para aprovação).
      ...(!body.status && (atual.status === 'aprovado' || atual.status === 'agendado') && alteraMaterialAprovado(body) && { status: 'aguardando_aprovacao' }),
    },
  })

  if (!conteudo.count) return NextResponse.json({ error: 'Conteúdo não encontrado' }, { status: 404 })

  if (body.status === 'aprovado') {
    await registrarAuditoria({
      workspaceId: session.user.workspaceId,
      userId: session.user.id,
      action: 'conteudo.aprovado',
      entityType: 'Conteudo',
      entityId: id,
      // P2.50: QUAL versão foi aprovada (impressão de vídeo, legendas, roteiro e produto).
      metadata: { impressao: impressaoDoConteudo((await prisma.conteudo.findFirst({ where: { id, workspaceId: session.user.workspaceId } })) as never), ...(alertaVermelho && { riscoConfirmadoPelaTitular: true }) },
    })
  }

  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const r = await prisma.conteudo.deleteMany({
    where: { id, workspaceId: session.user.workspaceId },
  })
  if (!r.count) return NextResponse.json({ error: 'Conteúdo não encontrado' }, { status: 404 })

  return NextResponse.json({ success: true })
}
