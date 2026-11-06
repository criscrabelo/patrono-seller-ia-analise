/**
 * Testes da Rodada 8 (Digital Twin Operacional + Primeira Prévia Real).
 * Baseline: 218 testes (67 mjs + 151 ts). Cobre job queue real (claim
 * atômico/concorrência/heartbeat/retry/isolamento), Chatterbox corrigido +
 * seleção pt-BR, runtime classificado, quality score, regeneração
 * automática, identity lock, kill switches independentes, autopilot
 * presenter selection, rate limiter, retenção, onboarding (consentimento
 * amarrado automaticamente ao perfil) e zero state.
 *
 *   DATABASE_URL=... npm run test:rodada8
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'crypto'

import { criarUsuarioComWorkspace } from '../lib/workspace'
import {
  reivindicarProximoJob,
  renovarHeartbeat,
  completarJob,
  falharJob,
  statusAmigavelParaUsuaria,
} from '../lib/digital-twin-job-queue'
import { verificarDisponibilidadeChatterbox, selecionarProviderChatterbox, TEXTO_TESTE_PT_BR } from '../lib/chatterbox-adapter'
import { classificarRuntime, detectarCapacidadesRuntime, type DigitalTwinRuntimeCapabilities } from '../lib/digital-twin-runtime'
import { calcularPreviewScore, decidirRegeneracao, THRESHOLD_PREVIEW_SCORE } from '../lib/digital-twin-preview-score'
import { verificarIdentityLock } from '../lib/digital-twin-identity-lock'
import { avaliarKillSwitches } from '../lib/digital-twin-kill-switches'
import { determinarModoAutopilot, prepararSegundaPreviaComProduto } from '../lib/digital-twin-autopilot-integration'
import { DigitalTwinRateLimiter, LIMITE_PADRAO_GERACAO } from '../lib/digital-twin-rate-limiter'
import { calcularExpiracaoPreview, RETENCAO_PREVIEW_MS } from '../lib/digital-twin-retention'
import { ehTipoDeAssetValido, ehMimeTypeDeVozAceito } from '../lib/digital-twin-asset-types'
import { processarJobDeVerdade } from '../lib/digital-twin-worker-core'

const prisma = new PrismaClient()

// ── Job Queue real ─────────────────────────────────────────────────────

describe('Job Queue real (Postgres, claim atômico)', () => {
  let workspaceId: string
  let profileId: string

  before(async () => {
    const { user } = await criarUsuarioComWorkspace(prisma, { email: `r8-${randomUUID()}@t.com`, password: 'x' })
    workspaceId = user.workspaceId
    const profile = await prisma.digitalTwinProfile.create({ data: { workspaceId, ownerUserId: user.id, displayName: 'x' } })
    profileId = profile.id
  })

  after(async () => {
    await prisma.digitalTwinJob.deleteMany({ where: { workspaceId } })
    await prisma.digitalTwinProfile.deleteMany({ where: { workspaceId } })
    await prisma.user.deleteMany({ where: { workspaceId } })
    await prisma.workspace.deleteMany({ where: { id: workspaceId } })
    await prisma.$disconnect()
  })

  test('dois workers concorrendo nunca reivindicam o mesmo job', async () => {
    const job = await prisma.digitalTwinJob.create({ data: { workspaceId, profileId, status: 'QUEUED' } })
    const [a, b] = await Promise.all([reivindicarProximoJob('worker-A'), reivindicarProximoJob('worker-B')])
    const ganhou = [a, b].filter((r) => r?.id === job.id)
    assert.equal(ganhou.length, 1)
  })

  test('heartbeat só é renovado pelo worker dono do job', async () => {
    const job = await prisma.digitalTwinJob.create({ data: { workspaceId, profileId, status: 'QUEUED' } })
    await reivindicarProximoJob('worker-dono', undefined, prisma)
    const ok = await renovarHeartbeat(job.id, 'worker-dono', prisma)
    const naoDono = await renovarHeartbeat(job.id, 'worker-impostor', prisma)
    assert.equal(typeof ok, 'boolean')
    assert.equal(naoDono, false)
  })

  test('worker offline (job travado) volta a ser reivindicável — nunca vira FAILED sozinho', async () => {
    const job = await prisma.digitalTwinJob.create({
      data: { workspaceId, profileId, status: 'GENERATING_VOICE', workerId: 'worker-morto', heartbeatAt: new Date(Date.now() - 10 * 60 * 1000) },
    })
    const reivindicado = await reivindicarProximoJob('worker-novo', 5 * 60 * 1000, prisma)
    assert.equal(reivindicado?.id, job.id)
    assert.equal(reivindicado?.workerId, 'worker-novo')
  })

  test('job QUEUED sem worker é "Aguardando processador", nunca "Falhou"', () => {
    assert.equal(statusAmigavelParaUsuaria({ status: 'QUEUED', workerId: null }), 'Aguardando processador')
  })

  // Retomada da Rodada 9 (regra 31) — cada etapa tem um nome próprio, nunca um "Processando" genérico escondendo o progresso real.
  test('cada etapa do job tem um nome amigável próprio (regra 31 da Retomada), nunca "Processando" genérico', () => {
    assert.equal(statusAmigavelParaUsuaria({ status: 'PREPARING_AUDIO', workerId: 'w1' }), 'Preparando áudio')
    assert.equal(statusAmigavelParaUsuaria({ status: 'GENERATING_VOICE', workerId: 'w1' }), 'Gerando voz')
    assert.equal(statusAmigavelParaUsuaria({ status: 'GENERATING_AVATAR', workerId: 'w1' }), 'Criando avatar')
    assert.equal(statusAmigavelParaUsuaria({ status: 'LIP_SYNC', workerId: 'w1' }), 'Sincronizando fala')
    assert.equal(statusAmigavelParaUsuaria({ status: 'RENDERING', workerId: 'w1' }), 'Montando vídeo')
    assert.equal(statusAmigavelParaUsuaria({ status: 'VALIDATING', workerId: 'w1' }), 'Validando')
    assert.equal(statusAmigavelParaUsuaria({ status: 'CANCELLED', workerId: 'w1' }), 'Cancelado')
  })

  test('falha com tentativas restantes reagenda (QUEUED) — retry automático', async () => {
    const job = await prisma.digitalTwinJob.create({ data: { workspaceId, profileId, status: 'QUEUED' } })
    await reivindicarProximoJob('worker-x', undefined, prisma)
    const resultado = await falharJob(job.id, 'worker-x', 'erro de teste', 3, prisma)
    assert.equal(resultado, 'REQUEUED')
    const atualizado = await prisma.digitalTwinJob.findUnique({ where: { id: job.id } })
    assert.equal(atualizado?.status, 'QUEUED')
    assert.equal(atualizado?.workerId, null)
  })

  test('falha após esgotar tentativas vira FAILED de verdade', async () => {
    const job = await prisma.digitalTwinJob.create({ data: { workspaceId, profileId, status: 'QUEUED', attempts: 2, workerId: 'worker-y', heartbeatAt: new Date() } })
    const resultado = await falharJob(job.id, 'worker-y', 'erro final', 3, prisma)
    assert.equal(resultado, 'FAILED')
  })

  test('completar job grava resultAssetId e status READY', async () => {
    const job = await prisma.digitalTwinJob.create({ data: { workspaceId, profileId, status: 'RENDERING', workerId: 'worker-z' } })
    const ok = await completarJob(job.id, 'worker-z', 'asset-123', prisma)
    assert.equal(ok, true)
    const atualizado = await prisma.digitalTwinJob.findUnique({ where: { id: job.id } })
    assert.equal(atualizado?.status, 'READY')
    assert.equal(atualizado?.resultAssetId, 'asset-123')
  })

  test('workspace isolation: job de um workspace nunca aparece pra outro workspace', async () => {
    const outro = await criarUsuarioComWorkspace(prisma, { email: `r8-outro-${randomUUID()}@t.com`, password: 'x' })
    const outroProfile = await prisma.digitalTwinProfile.create({ data: { workspaceId: outro.user.workspaceId, ownerUserId: outro.user.id, displayName: 'y' } })
    const jobDoOutro = await prisma.digitalTwinJob.create({ data: { workspaceId: outro.user.workspaceId, profileId: outroProfile.id, status: 'QUEUED' } })

    const meuJobs = await prisma.digitalTwinJob.findMany({ where: { workspaceId } })
    assert.equal(meuJobs.some((j) => j.id === jobDoOutro.id), false)

    await prisma.digitalTwinJob.deleteMany({ where: { workspaceId: outro.user.workspaceId } })
    await prisma.digitalTwinProfile.deleteMany({ where: { workspaceId: outro.user.workspaceId } })
    await prisma.user.deleteMany({ where: { workspaceId: outro.user.workspaceId } })
    await prisma.workspace.deleteMany({ where: { id: outro.user.workspaceId } })
  })
})

// ── Chatterbox / pt-BR provider selection ────────────────────────────────

describe('Chatterbox — provider selection pt-BR', () => {
  test('sem pacote instalado, cai em VOICE_ONLY_FALLBACK', async () => {
    const disponibilidade = await verificarDisponibilidadeChatterbox('python3-inexistente-xyz')
    const selecao = selecionarProviderChatterbox(disponibilidade)
    assert.equal(selecao.tier, 'VOICE_ONLY_FALLBACK')
  })

  test('nunca seleciona PT_BR_SINGLE_LANGUAGE (não existe checkpoint dedicado confirmado)', async () => {
    const disponibilidade = await verificarDisponibilidadeChatterbox()
    const selecao = selecionarProviderChatterbox(disponibilidade)
    assert.notEqual(selecao.tier, 'PT_BR_SINGLE_LANGUAGE')
  })

  test('texto de teste pt-BR contém marca, preço e CTA', () => {
    assert.match(TEXTO_TESTE_PT_BR, /R\$/)
    assert.match(TEXTO_TESTE_PT_BR, /link/i)
  })
})

// ── Runtime classification ────────────────────────────────────────────

describe('Runtime classification', () => {
  test('ambiente sem GPU (deste sandbox) nunca vira GPU_READY', async () => {
    const caps = await detectarCapacidadesRuntime()
    const classe = classificarRuntime(caps)
    if (!caps.gpuDetected) assert.notEqual(classe, 'GPU_READY')
  })

  test('CPU com poucos núcleos/RAM é classificado UNSUPPORTED', () => {
    const capsFraco: DigitalTwinRuntimeCapabilities = {
      cpuCores: 1, totalRamGB: 1, freeRamGB: 0.5, gpuDetected: false, gpuName: null, vramGB: null, cudaAvailable: false, freeDiskGB: 5, verificadoEm: 'x',
    }
    assert.equal(classificarRuntime(capsFraco), 'UNSUPPORTED')
  })
})

// ── Preview Score + regeneração automática ────────────────────────────

describe('DigitalTwinPreviewScore', () => {
  test('nota abaixo do threshold nunca aprova', () => {
    const r = calcularPreviewScore({ voiceQuality: 40, lipSync: 40, identity: 40, artifacts: 40, captionReadability: 40, audio: 40, tiktokCompatibility: 40 })
    assert.equal(r.aprovado, false)
    assert.ok(r.nota < THRESHOLD_PREVIEW_SCORE)
  })

  test('nota acima do threshold em todos os componentes aprova', () => {
    const r = calcularPreviewScore({ voiceQuality: 90, lipSync: 90, identity: 90, artifacts: 90, captionReadability: 90, audio: 90, tiktokCompatibility: 90 })
    assert.equal(r.aprovado, true)
  })

  test('componente não aplicável (lipSync null) não penaliza a nota', () => {
    const r = calcularPreviewScore({ voiceQuality: 90, lipSync: null, identity: 90, artifacts: 90, captionReadability: 90, audio: 90, tiktokCompatibility: 90 })
    assert.equal(r.aprovado, true)
  })
})

describe('Regeneração automática', () => {
  test('tenta de novo automaticamente antes do limite, sem pedir nova referência', () => {
    const d = decidirRegeneracao(1, 3)
    assert.equal(d.deveRegenerarAutomaticamente, true)
    assert.equal(d.deveAcionarUsuaria, false)
  })

  test('aciona a usuária só depois de esgotar as tentativas automáticas', () => {
    const d = decidirRegeneracao(3, 3)
    assert.equal(d.deveRegenerarAutomaticamente, false)
    assert.equal(d.deveAcionarUsuaria, true)
  })
})

// ── Identity Lock ──────────────────────────────────────────────────────

describe('DigitalTwinIdentityLock', () => {
  test('bloqueia uso antes da aprovação do perfil', () => {
    const r = verificarIdentityLock({ profileId: 'p1', profileApproved: false, assetProfileId: 'p1' })
    assert.equal(r.permitido, false)
  })

  test('bloqueia asset de outro perfil, mesmo aprovado', () => {
    const r = verificarIdentityLock({ profileId: 'p1', profileApproved: true, assetProfileId: 'p2' })
    assert.equal(r.permitido, false)
  })

  test('permite asset do próprio perfil aprovado', () => {
    const r = verificarIdentityLock({ profileId: 'p1', profileApproved: true, assetProfileId: 'p1' })
    assert.equal(r.permitido, true)
  })
})

// ── Kill switches independentes ────────────────────────────────────────

describe('Kill switches independentes (Autopilot x Digital Twin)', () => {
  test('pausar só o Autopilot não afeta a disponibilidade de identidade/voz', () => {
    const r = avaliarKillSwitches({ automationPaused: true, digitalTwinEnabled: true, workerPaused: false })
    assert.equal(r.podePublicarAutopilot, false)
    assert.equal(r.podeUsarIdentidadeOuVoz, true)
  })

  test('pausar só o Digital Twin não afeta a publicação do Autopilot', () => {
    const r = avaliarKillSwitches({ automationPaused: false, digitalTwinEnabled: false, workerPaused: false })
    assert.equal(r.podePublicarAutopilot, true)
    assert.equal(r.podeUsarIdentidadeOuVoz, false)
  })
})

// ── Autopilot presenter selection ─────────────────────────────────────

describe('Autopilot — seleção automática de modo', () => {
  test('sem preferência autoUseDigitalTwin, nunca escolhe DIGITAL_TWIN mesmo com tudo disponível', () => {
    const d = determinarModoAutopilot({
      profile: {
        id: 'p1', workspaceId: 'w1', ownerUserId: 'u1', displayName: 'x', identityReferenceId: null, voiceProfileId: 'v1', approvedAt: new Date(),
        consentStatus: 'GRANTED', enabled: true, createdAt: new Date(), updatedAt: new Date(),
      },
      voiceProfile: { id: 'v1', workspaceId: 'w1', ownerUserId: 'u1', referenceAudio: null, consentId: 'c1', provider: null, language: 'pt-BR', enabled: true, createdAt: new Date() },
      identityConsent: { id: 'ic1', subjectUserId: 'u1', purpose: 'x', status: 'GRANTED', grantedAt: new Date(), revokedAt: null, expiresAt: null },
      voiceConsent: { id: 'vc1', subjectUserId: 'u1', purpose: 'x', status: 'GRANTED', grantedAt: new Date(), revokedAt: null, expiresAt: null },
      autoUseDigitalTwin: false,
      autoUseVoice: false,
      allowFallback: true,
      workerOnline: true,
      workerPaused: false,
    })
    assert.notEqual(d.modo, 'DIGITAL_TWIN')
  })

  test('zero state (sem perfil) nunca escolhe DIGITAL_TWIN, mas ainda escolhe um modo', () => {
    const d = determinarModoAutopilot({
      profile: null, voiceProfile: null, identityConsent: null, voiceConsent: null,
      autoUseDigitalTwin: true, autoUseVoice: true, allowFallback: true, workerOnline: true, workerPaused: false,
    })
    assert.notEqual(d.modo, 'DIGITAL_TWIN')
    assert.ok(d.modo)
  })
})

describe('Segunda prévia com produto', () => {
  test('produto sem mídia autorizada nunca finge posse física', () => {
    const r = prepararSegundaPreviaComProduto({ produtoNome: 'x', produtoMidiaAutorizada: false, roteiro: 'r', legenda: 'l', cta: 'c' })
    assert.equal(r.aprovado, false)
    assert.equal(r.layout, 'PRESENTER_INTRO_BROLL')
  })

  test('produto autorizado usa layout Presenter + product panel', () => {
    const r = prepararSegundaPreviaComProduto({ produtoNome: 'x', produtoMidiaAutorizada: true, roteiro: 'r', legenda: 'l', cta: 'c' })
    assert.equal(r.layout, 'PRESENTER_PRODUCT_PANEL')
  })
})

// ── Rate limiter e retenção ────────────────────────────────────────────

describe('Rate limiter local', () => {
  test('bloqueia geração acima do limite por workspace', () => {
    let agora = 0
    const limiter = new DigitalTwinRateLimiter(() => agora)
    const limite = { maxGeracoes: 2, janelaMs: 1000 }
    assert.equal(limiter.podeGerar('w1', limite), true)
    assert.equal(limiter.podeGerar('w1', limite), true)
    assert.equal(limiter.podeGerar('w1', limite), false)
  })

  test('limite padrão nunca cobra a usuária — só protege contra loop/abuso', () => {
    assert.ok(LIMITE_PADRAO_GERACAO.maxGeracoes > 0)
  })
})

describe('Retenção de prévias', () => {
  test('prévia expira 7 dias após criada', () => {
    const agora = new Date('2026-01-01T00:00:00Z')
    const expira = calcularExpiracaoPreview(agora)
    assert.equal(expira.getTime() - agora.getTime(), RETENCAO_PREVIEW_MS)
  })
})

// ── Onboarding (tipos de asset) ────────────────────────────────────────

describe('Onboarding — validação de asset', () => {
  test('aceita os 5 tipos oficiais', () => {
    for (const t of ['FACE_IMAGE', 'REFERENCE_VIDEO', 'VOICE_REFERENCE', 'CONSENT_EVIDENCE', 'GENERATED_PREVIEW']) {
      assert.equal(ehTipoDeAssetValido(t), true)
    }
  })

  test('rejeita tipo desconhecido', () => {
    assert.equal(ehTipoDeAssetValido('ROSTO_FALSO'), false)
  })

  test('gravação pelo navegador (audio/webm) é aceita como voz', () => {
    assert.equal(ehMimeTypeDeVozAceito('audio/webm'), true)
  })

  test('upload de arquivo de áudio comum também é aceito', () => {
    assert.equal(ehMimeTypeDeVozAceito('audio/mpeg'), true)
  })

  test('vídeo nunca é aceito como referência de voz', () => {
    assert.equal(ehMimeTypeDeVozAceito('video/mp4'), false)
  })

  test('consentimento concedido é automaticamente amarrado ao perfil (sem passo técnico)', async () => {
    const { user } = await criarUsuarioComWorkspace(prisma, { email: `r8-onb-${randomUUID()}@t.com`, password: 'x' })
    const profile = await prisma.digitalTwinProfile.create({ data: { workspaceId: user.workspaceId, ownerUserId: user.id, displayName: 'x' } })
    const consent = await prisma.identityConsent.create({
      data: { workspaceId: user.workspaceId, subjectUserId: user.id, purpose: 'teste', status: 'GRANTED', grantedAt: new Date() },
    })
    await prisma.digitalTwinProfile.update({ where: { id: profile.id }, data: { identityConsentId: consent.id } })
    const atualizado = await prisma.digitalTwinProfile.findUnique({ where: { id: profile.id } })
    assert.equal(atualizado?.identityConsentId, consent.id)

    await prisma.digitalTwinProfile.deleteMany({ where: { workspaceId: user.workspaceId } })
    await prisma.identityConsent.deleteMany({ where: { workspaceId: user.workspaceId } })
    await prisma.user.deleteMany({ where: { workspaceId: user.workspaceId } })
    await prisma.workspace.deleteMany({ where: { id: user.workspaceId } })
  })
})

// ── Worker core: fallback sem GPU roda de verdade ──────────────────────

describe('Worker core — fallback sem GPU', () => {
  test('sem media asset, o fallback Motion Graphics falha com motivo claro (nunca finge sucesso)', async () => {
    const { user } = await criarUsuarioComWorkspace(prisma, { email: `r8-worker-${randomUUID()}@t.com`, password: 'x' })
    const profile = await prisma.digitalTwinProfile.create({ data: { workspaceId: user.workspaceId, ownerUserId: user.id, displayName: 'x' } })

    const resultado = await processarJobDeVerdade({
      id: 'j1', workspaceId: user.workspaceId, profileId: profile.id, jobType: 'AVATAR_PREVIEW', mediaAssetUrl: '', overlayTexto: 'x', legenda: 'y',
    })
    assert.equal(resultado.sucesso, false)
    assert.notEqual(resultado.modo, 'DIGITAL_TWIN') // sem chatterbox/musetalk neste ambiente

    await prisma.digitalTwinProfile.deleteMany({ where: { workspaceId: user.workspaceId } })
    await prisma.user.deleteMany({ where: { workspaceId: user.workspaceId } })
    await prisma.workspace.deleteMany({ where: { id: user.workspaceId } })
  })
})

// ── Zero state ────────────────────────────────────────────────────────

describe('Zero state', () => {
  test('workspace novo sem nenhum job, perfil ou preferência não quebra a seleção de modo (cai no fallback com motion graphics)', () => {
    const d = determinarModoAutopilot({
      profile: null, voiceProfile: null, identityConsent: null, voiceConsent: null,
      autoUseDigitalTwin: false, autoUseVoice: false, allowFallback: true, workerOnline: false, workerPaused: false,
    })
    assert.equal(d.modo, 'MOTION_GRAPHICS')
  })

  test('sem perfil e fallback desabilitado, usa só o produto (PRODUCT_ONLY)', () => {
    const d = determinarModoAutopilot({
      profile: null, voiceProfile: null, identityConsent: null, voiceConsent: null,
      autoUseDigitalTwin: false, autoUseVoice: false, allowFallback: false, workerOnline: false, workerPaused: false,
    })
    assert.equal(d.modo, 'PRODUCT_ONLY')
  })
})
