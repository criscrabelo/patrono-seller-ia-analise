import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { prisma } from '@/lib/prisma'
import { registrarAuditoria } from '@/lib/audit-log'
import { carregarContextoDigitalTwin } from '@/lib/digital-twin-store'
import { podeGerarComDigitalTwin } from '@/lib/digital-twin'
import { detectarCapacidadesRuntime } from '@/lib/digital-twin-runtime'
import { statusAmigavelParaUsuaria } from '@/lib/digital-twin-job-queue'

/** Status do Digital Twin do workspace da sessão — nunca aceita workspaceId do cliente. */
export async function GET() {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const contexto = await carregarContextoDigitalTwin(session.user.workspaceId)
  const decisao = podeGerarComDigitalTwin(contexto)
  const runtime = await detectarCapacidadesRuntime()

  // Saúde do worker de geração — só aparece em Configurações/Digital Twin, nunca na Home.
  const cincoMinutosAtras = new Date(Date.now() - 5 * 60 * 1000)
  // P2.15.4: a saúde do processador não é separada por workspace (o modelo
  // não tem workspaceId). Sem migration, só a admin — quem opera a máquina —
  // vê; outras contas não veem o processador de outro workspace.
  const workers = session.user.role !== 'admin' ? [] : await prisma.generationWorkerHealth.findMany({
    where: { lastSeenAt: { gte: cincoMinutosAtras } },
    select: { workerId: true, gpuDetected: true, gpuName: true, vramGB: true, version: true, lastSeenAt: true },
  })

  // Preferências globais (regra 50) não fazem parte do tipo de domínio
  // DigitalTwinProfile — buscadas direto do banco para a tela.
  const preferencias = contexto.profile
    ? await prisma.digitalTwinProfile.findUnique({
        where: { id: contexto.profile.id },
        select: {
          autoUseDigitalTwin: true,
          autoUseVoice: true,
          allowFallback: true,
          priorityChannel: true,
          defaultStyle: true,
          workerPaused: true,
          voiceApprovedAt: true,
        },
      })
    : null

  // Etapa real do último job (regra 12/13 da Continuação da Retomada da
  // Rodada 9) — nunca um percentual fabricado, só o nome da etapa vindo do
  // `DigitalTwinJob` de verdade. `statusAmigavelParaUsuaria()` existia no
  // backend sem nenhuma tela consumir — corrigido aqui.
  const ultimoJobRow = contexto.profile
    ? await prisma.digitalTwinJob.findFirst({
        where: { profileId: contexto.profile.id },
        orderBy: { createdAt: 'desc' },
        select: { id: true, status: true, jobType: true, workerId: true, error: true, createdAt: true },
      })
    : null
  const ultimoJob = ultimoJobRow
    ? {
        id: ultimoJobRow.id,
        jobType: ultimoJobRow.jobType,
        status: ultimoJobRow.status,
        statusAmigavel: statusAmigavelParaUsuaria(ultimoJobRow),
        emAndamento: !['READY', 'FAILED', 'CANCELLED'].includes(ultimoJobRow.status),
        erro: ultimoJobRow.status === 'FAILED' ? ultimoJobRow.error : null,
      }
    : null

  // Legenda do último conteúdo gerado (Rodada 10) — entregue SEPARADA do
  // MP4, de propósito: a proprietária baixa o vídeo e copia o texto na hora
  // de publicar à mão. Nada é embutido no arquivo.
  const conteudoRow = contexto.profile
    ? await prisma.conteudo.findFirst({
        where: { workspaceId: session.user.workspaceId, legendaTiktok: { not: null } },
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          legendaTiktok: true,
          hashtags: true,
          chamadaAcao: true,
          textoTela: true,
          duracao: true,
          updatedAt: true,
          produto: { select: { nome: true } },
        },
      })
    : null
  const ultimoConteudo = conteudoRow
    ? {
        id: conteudoRow.id,
        produtoNome: conteudoRow.produto.nome,
        legenda: conteudoRow.legendaTiktok,
        hashtags: conteudoRow.hashtags,
        cta: conteudoRow.chamadaAcao,
        hook: conteudoRow.textoTela,
        duracaoSegundos: conteudoRow.duracao,
        atualizadoEm: conteudoRow.updatedAt,
      }
    : null

  return NextResponse.json({
    profile: contexto.profile ? { ...contexto.profile, ...preferencias } : null,
    voiceProfile: contexto.voiceProfile ? { ...contexto.voiceProfile, referenceAudio: undefined } : null,
    identityConsent: contexto.identityConsent,
    voiceConsent: contexto.voiceConsent,
    podeGerar: decisao,
    runtime,
    workers,
    ultimoJob,
    ultimoConteudo,
  })
}

/** Bootstrap do perfil (etapa 0 do onboarding) — nasce sempre desativado. */
export async function POST(req: NextRequest) {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const existente = await prisma.digitalTwinProfile.findUnique({ where: { workspaceId: session.user.workspaceId } })
  if (existente) return NextResponse.json(existente)

  const body = await req.json().catch(() => ({}))
  const displayName = typeof body.displayName === 'string' && body.displayName.trim() ? body.displayName.trim() : 'Meu Digital Twin'

  const profile = await prisma.digitalTwinProfile.create({
    data: {
      workspaceId: session.user.workspaceId,
      ownerUserId: session.user.id,
      displayName,
      enabled: false,
    },
  })

  await registrarAuditoria({
    workspaceId: session.user.workspaceId,
    userId: session.user.id,
    action: 'digital_twin.profile_created',
    entityType: 'DigitalTwinProfile',
    entityId: profile.id,
    metadata: {},
  })

  return NextResponse.json(profile)
}

const CANAIS_VALIDOS = ['tiktok', 'instagram']
const ESTILOS_VALIDOS = ['presenter', 'unboxing']

/** Preferências globais (regra 50) — nunca perguntadas a cada postagem. */
export async function PATCH(req: NextRequest) {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const profile = await prisma.digitalTwinProfile.findUnique({ where: { workspaceId: session.user.workspaceId } })
  if (!profile) return NextResponse.json({ error: 'Crie o perfil do Digital Twin primeiro.' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const data: Record<string, unknown> = {}
  if (typeof body.autoUseDigitalTwin === 'boolean') data.autoUseDigitalTwin = body.autoUseDigitalTwin
  if (typeof body.autoUseVoice === 'boolean') data.autoUseVoice = body.autoUseVoice
  if (typeof body.allowFallback === 'boolean') data.allowFallback = body.allowFallback
  if (typeof body.workerPaused === 'boolean') data.workerPaused = body.workerPaused
  if (typeof body.priorityChannel === 'string' && CANAIS_VALIDOS.includes(body.priorityChannel)) data.priorityChannel = body.priorityChannel
  if (typeof body.defaultStyle === 'string' && ESTILOS_VALIDOS.includes(body.defaultStyle)) data.defaultStyle = body.defaultStyle

  const atualizado = await prisma.digitalTwinProfile.update({ where: { id: profile.id }, data })

  await registrarAuditoria({
    workspaceId: session.user.workspaceId,
    userId: session.user.id,
    action: 'digital_twin.preferences_updated',
    entityType: 'DigitalTwinProfile',
    entityId: profile.id,
    metadata: data,
  })

  return NextResponse.json(atualizado)
}
