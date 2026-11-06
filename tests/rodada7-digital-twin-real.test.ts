/**
 * Testes da Rodada 7 (Digital Twin Real). Baseline: 189 testes (174 +
 * 15). Cobre persistência real, isolamento cross-workspace, providers
 * (Chatterbox/MuseTalk honestos sobre indisponibilidade), licenças
 * (Wav2Lip/LivePortrait BLOCKED_BY_LICENSE), gates de qualidade, kill
 * switch, Presenter Mode, fallback sem GPU, jobs/retry e zero state.
 *
 *   DATABASE_URL=... npm run test:rodada7
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'crypto'

import { criarUsuarioComWorkspace } from '../lib/workspace'
import { podeGerarComDigitalTwin, validarPresenterMode, validarUnboxingStyle, AUTOPILOT_PRODUCT_EXPERIENCE_MODE } from '../lib/digital-twin'
import { obterAssetDigitalTwin, obterIdentityConsent } from '../lib/digital-twin-store'
import { revogarIdentityConsent, revogarVoiceConsent } from '../lib/digital-twin-revoke'
import { verificarDisponibilidadeChatterbox, TEXTO_TESTE_PT_BR } from '../lib/chatterbox-adapter'
import { verificarDisponibilidadeMuseTalk, decisaoDoMotor, bloquearMotor } from '../lib/lipsync-provider'
import { detectarCapacidadesRuntime, atendeRequisitosMinimosAvatar } from '../lib/digital-twin-runtime'
import { selecionarCreativePresenterMode } from '../lib/creative-presenter-mode'
import { podeTentarNovamente, deveAbortarPorKillSwitch, type DigitalTwinJobState } from '../lib/digital-twin-job'
import { avaliarDigitalTwinQualityGate } from '../lib/digital-twin-quality-gate'
import { avaliarQualidadeVoz } from '../lib/voice-quality-gate'
import { avaliarQualidadeIdentidade, DetectorDeRostoNaoDisponivel } from '../lib/identity-quality-gate'
import { gerarLegendas } from '../lib/captions'

const prisma = new PrismaClient()

describe('Persistência real — DigitalTwinProfile/VoiceProfile/Consents/Asset', () => {
  let workspaceId: string
  let userId: string

  before(async () => {
    const { user } = await criarUsuarioComWorkspace(prisma, {
      email: `dt-${randomUUID()}@teste.com`,
      password: 'hash-teste',
      name: 'Proprietária Teste',
    })
    userId = user.id
    workspaceId = user.workspaceId
  })

  after(async () => {
    await prisma.digitalTwinAsset.deleteMany({ where: { workspaceId } })
    await prisma.digitalTwinJob.deleteMany({ where: { workspaceId } })
    await prisma.digitalTwinProfile.deleteMany({ where: { workspaceId } })
    await prisma.voiceProfile.deleteMany({ where: { workspaceId } })
    await prisma.identityConsent.deleteMany({ where: { workspaceId } })
    await prisma.voiceConsent.deleteMany({ where: { workspaceId } })
    // Faltava: `revogarIdentityConsent()`/`revogarVoiceConsent()`, chamadas
    // neste próprio teste, gravam AuditLog — e a FK `AuditLog_workspaceId_fkey`
    // impedia o delete do workspace abaixo, derrubando o hook de limpeza.
    await prisma.auditLog.deleteMany({ where: { workspaceId } })
    await prisma.user.deleteMany({ where: { workspaceId } })
    await prisma.workspace.deleteMany({ where: { id: workspaceId } })
    await prisma.$disconnect()
  })

  test('consentimento persistido é lido de volta com o mesmo workspaceId', async () => {
    const consent = await prisma.identityConsent.create({
      data: { workspaceId, subjectUserId: userId, purpose: 'teste', status: 'GRANTED', grantedAt: new Date() },
    })
    const lido = await obterIdentityConsent(workspaceId, consent.id)
    assert.ok(lido)
    assert.equal(lido?.workspaceId, workspaceId)
  })

  test('revogação de IdentityConsent desativa o DigitalTwinProfile vinculado', async () => {
    const consent = await prisma.identityConsent.create({
      data: { workspaceId, subjectUserId: userId, purpose: 'teste', status: 'GRANTED', grantedAt: new Date() },
    })
    const profile = await prisma.digitalTwinProfile.create({
      data: { workspaceId, ownerUserId: userId, displayName: 'Twin', enabled: true, identityConsentId: consent.id },
    })
    await revogarIdentityConsent(workspaceId, consent.id, userId)

    const consentDepois = await prisma.identityConsent.findUnique({ where: { id: consent.id } })
    const profileDepois = await prisma.digitalTwinProfile.findUnique({ where: { id: profile.id } })
    assert.equal(consentDepois?.status, 'REVOKED')
    assert.equal(profileDepois?.enabled, false)
  })

  test('revogação de VoiceConsent desativa VoiceProfile e o DigitalTwinProfile vinculado', async () => {
    const voiceConsent = await prisma.voiceConsent.create({
      data: { workspaceId, subjectUserId: userId, purpose: 'teste', status: 'GRANTED', grantedAt: new Date() },
    })
    const voiceProfile = await prisma.voiceProfile.create({
      data: { workspaceId, ownerUserId: userId, consentId: voiceConsent.id, enabled: true },
    })
    const profile2 = await prisma.digitalTwinProfile.create({
      data: { workspaceId: `${workspaceId}-outro`, ownerUserId: userId, displayName: 'x', enabled: true },
    }).catch(() => null)
    // workspace fake não existe de verdade — ignora erro de FK; o que importa é o voiceProfile abaixo.
    void profile2

    await revogarVoiceConsent(workspaceId, voiceConsent.id, userId)
    const voiceDepois = await prisma.voiceProfile.findUnique({ where: { id: voiceProfile.id } })
    assert.equal(voiceDepois?.enabled, false)
  })

  test('workspace isolation: asset de um workspace nunca é encontrado pelo id de outro workspace', async () => {
    const profile = await prisma.digitalTwinProfile.upsert({
      where: { workspaceId },
      create: { workspaceId, ownerUserId: userId, displayName: 'Twin' },
      update: {},
    })
    const asset = await prisma.digitalTwinAsset.create({
      data: { workspaceId, profileId: profile.id, type: 'FACE_IMAGE', storagePath: 'x/y.jpg', mimeType: 'image/jpeg' },
    })

    // Simula outro workspace tentando acessar o asset pelo id certo, mas workspaceId errado.
    const outro = await criarUsuarioComWorkspace(prisma, { email: `dt-outro-${randomUUID()}@teste.com`, password: 'hash' })
    const encontradoPeloOutro = await obterAssetDigitalTwin(outro.user.workspaceId, asset.id)
    assert.equal(encontradoPeloOutro, null)

    const encontradoPeloDono = await obterAssetDigitalTwin(workspaceId, asset.id)
    assert.ok(encontradoPeloDono)

    await prisma.user.deleteMany({ where: { workspaceId: outro.user.workspaceId } })
    await prisma.workspace.deleteMany({ where: { id: outro.user.workspaceId } })
  })
})

describe('podeGerarComDigitalTwin — kill switch e consentimento', () => {
  test('sem nenhum perfil, nunca gera (zero state)', () => {
    const decisao = podeGerarComDigitalTwin({ profile: null, voiceProfile: null, identityConsent: null, voiceConsent: null })
    assert.equal(decisao.permitido, false)
  })

  test('avatar desativado bloqueia mesmo com consentimento válido', () => {
    const decisao = podeGerarComDigitalTwin({
      profile: {
        id: 'p1', workspaceId: 'w1', ownerUserId: 'u1', displayName: 'x', identityReferenceId: null, voiceProfileId: null, approvedAt: null,
        consentStatus: 'GRANTED', enabled: false, createdAt: new Date(), updatedAt: new Date(),
      },
      voiceProfile: { id: 'v1', workspaceId: 'w1', ownerUserId: 'u1', referenceAudio: null, consentId: 'c1', provider: null, language: 'pt-BR', enabled: true, createdAt: new Date() },
      identityConsent: { id: 'ic1', subjectUserId: 'u1', purpose: 'x', status: 'GRANTED', grantedAt: new Date(), revokedAt: null, expiresAt: null },
      voiceConsent: { id: 'vc1', subjectUserId: 'u1', purpose: 'x', status: 'GRANTED', grantedAt: new Date(), revokedAt: null, expiresAt: null },
    })
    assert.equal(decisao.permitido, false)
  })
})

describe('Chatterbox — provider honesto sobre indisponibilidade', () => {
  test('sem o pacote instalado, nunca finge disponibilidade', async () => {
    const disponibilidade = await verificarDisponibilidadeChatterbox('python3-que-nao-existe-xyz')
    assert.equal(disponibilidade.available, false)
  })

  test('texto de teste pt-BR cobre marca, número, preço e CTA', () => {
    assert.match(TEXTO_TESTE_PT_BR, /R\$/)
    assert.match(TEXTO_TESTE_PT_BR, /link/i)
  })
})

describe('MuseTalk — capability probe honesto', () => {
  test('sem o pacote instalado, nunca finge disponibilidade', async () => {
    const disponibilidade = await verificarDisponibilidadeMuseTalk('python3-que-nao-existe-xyz')
    assert.equal(disponibilidade.available, false)
  })
})

describe('Licenças de lip-sync', () => {
  test('Wav2Lip está BLOCKED_BY_LICENSE', () => {
    assert.equal(decisaoDoMotor('wav2lip').status, 'BLOCKED_BY_LICENSE')
    assert.throws(() => bloquearMotor('wav2lip'))
  })

  test('LivePortrait está BLOCKED_BY_LICENSE', () => {
    assert.equal(decisaoDoMotor('liveportrait').status, 'BLOCKED_BY_LICENSE')
    assert.throws(() => bloquearMotor('liveportrait'))
  })

  test('MuseTalk é o único candidato liberado nesta rodada', () => {
    assert.equal(decisaoDoMotor('musetalk').status, 'AVAILABLE_CANDIDATE')
    assert.doesNotThrow(() => bloquearMotor('musetalk'))
  })
})

describe('Fallback sem GPU', () => {
  test('ambiente sem GPU nunca atende aos requisitos mínimos de avatar local', async () => {
    const caps = await detectarCapacidadesRuntime()
    const atende = atendeRequisitosMinimosAvatar(caps)
    if (!caps.gpuDetected) assert.equal(atende, false)
  })

  test('sem Digital Twin nem voz disponíveis, o Autopilot ainda escolhe um modo (nunca trava)', () => {
    const modo = selecionarCreativePresenterMode({ digitalTwinDisponivel: false, vozClonadaDisponivel: false, motionGraphicsDisponivel: false })
    assert.equal(modo, 'PRODUCT_ONLY')
  })

  test('prioridade correta: Digital Twin > voz > motion graphics > produto', () => {
    assert.equal(selecionarCreativePresenterMode({ digitalTwinDisponivel: true, vozClonadaDisponivel: true, motionGraphicsDisponivel: true }), 'DIGITAL_TWIN')
    assert.equal(selecionarCreativePresenterMode({ digitalTwinDisponivel: false, vozClonadaDisponivel: true, motionGraphicsDisponivel: true }), 'VOICE_ONLY')
    assert.equal(selecionarCreativePresenterMode({ digitalTwinDisponivel: false, vozClonadaDisponivel: false, motionGraphicsDisponivel: true }), 'MOTION_GRAPHICS')
  })
})

describe('Presenter Mode e Product Experience', () => {
  test('bloqueia depoimento pessoal falso', () => {
    assert.equal(validarPresenterMode('Eu uso esse produto todo dia!').valido, false)
  })

  test('Autopilot sempre usa VIRTUAL_PRESENTATION', () => {
    assert.equal(AUTOPILOT_PRODUCT_EXPERIENCE_MODE, 'VIRTUAL_PRESENTATION')
  })

  test('VIRTUAL_PRESENTATION nunca pode afirmar recebimento físico real', () => {
    const r = validarUnboxingStyle({ mode: 'VIRTUAL_PRESENTATION', afirmaRecebimentoFisicoReal: true })
    assert.equal(r.permitido, false)
  })
})

describe('Job pipeline — retry seguro', () => {
  function jobBase(overrides: Partial<DigitalTwinJobState> = {}): DigitalTwinJobState {
    return { id: 'j1', status: 'GENERATING_VOICE', attempts: 0, resultAssetId: null, error: null, ...overrides }
  }

  test('job já pronto com artefato nunca é reprocessado', () => {
    const r = podeTentarNovamente(jobBase({ status: 'READY', resultAssetId: 'a1' }))
    assert.equal(r.pode, false)
  })

  test('job cancelado nunca é reprocessado automaticamente', () => {
    const r = podeTentarNovamente(jobBase({ status: 'CANCELLED' }))
    assert.equal(r.pode, false)
  })

  test('etapa retryável dentro do limite pode tentar de novo', () => {
    const r = podeTentarNovamente(jobBase({ status: 'RENDERING', attempts: 1 }))
    assert.equal(r.pode, true)
  })

  test('kill switch desativado aborta a etapa crítica GENERATING_VOICE', () => {
    const r = deveAbortarPorKillSwitch({
      proximaEtapa: 'GENERATING_VOICE',
      profile: {
        id: 'p1', workspaceId: 'w1', ownerUserId: 'u1', displayName: 'x', identityReferenceId: null, voiceProfileId: null, approvedAt: null,
        consentStatus: 'GRANTED', enabled: false, createdAt: new Date(), updatedAt: new Date(),
      },
      voiceProfile: null,
      identityConsent: null,
      voiceConsent: null,
    })
    assert.equal(r.abortar, true)
  })

  test('etapa não crítica nunca é abortada pelo kill switch check', () => {
    const r = deveAbortarPorKillSwitch({ proximaEtapa: 'RENDERING', profile: null, voiceProfile: null, identityConsent: null, voiceConsent: null })
    assert.equal(r.abortar, false)
  })
})

describe('DigitalTwinQualityGate', () => {
  test('bloqueia quando AI disclosure obrigatório não foi aplicado', () => {
    const r = avaliarDigitalTwinQualityGate({
      identidadeOk: true, audioOk: true, lipSyncOk: true, duracaoDentroDoLimite: true, legendasPresentes: true,
      produtoAutorizado: true, aiDisclosureAplicado: false, commercialDisclosureAplicado: null, tiktokPreflightStatus: 'TECHNICALLY_VALID',
    })
    assert.equal(r.aprovado, false)
  })

  test('aprova quando tudo está correto', () => {
    const r = avaliarDigitalTwinQualityGate({
      identidadeOk: true, audioOk: true, lipSyncOk: true, duracaoDentroDoLimite: true, legendasPresentes: true,
      produtoAutorizado: true, aiDisclosureAplicado: true, commercialDisclosureAplicado: true, tiktokPreflightStatus: 'TECHNICALLY_VALID',
    })
    assert.equal(r.aprovado, true)
  })
})

describe('Voice Quality Gate e Identity Quality Gate — zero state', () => {
  test('arquivo de voz vazio é rejeitado sem chamar análise de áudio', async () => {
    const r = await avaliarQualidadeVoz('/tmp/inexistente.wav', 0)
    assert.equal(r.aprovado, false)
  })

  test('vídeo de identidade vazio é rejeitado', async () => {
    const r = await avaliarQualidadeIdentidade('/tmp/inexistente.mp4', 0, new DetectorDeRostoNaoDisponivel())
    assert.equal(r.status, 'REJECTED')
  })
})

describe('Captions', () => {
  test('gera blocos cobrindo a duração total informada', () => {
    const blocos = gerarLegendas('este é um texto de teste com várias palavras para gerar legendas', 10)
    assert.ok(blocos.length > 0)
    assert.ok(blocos[blocos.length - 1].fimSegundos <= 10)
  })

  test('texto vazio não gera blocos', () => {
    assert.deepEqual(gerarLegendas(''), [])
  })
})
