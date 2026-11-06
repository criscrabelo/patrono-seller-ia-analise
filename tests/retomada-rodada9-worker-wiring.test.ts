/**
 * Retomada da Rodada 9 — wiring real dos pipelines de voz/avatar no
 * worker (antes, `processarJobDeVerdade` caía sempre no mesmo placeholder
 * "não implementada" para `DIGITAL_TWIN`/`VOICE_ONLY`, independente do
 * `jobType`). Testa o ROTEAMENTO real por `jobType`
 * (`processarEtapaDeVozOuAvatar`, exportado de
 * `lib/digital-twin-worker-core.ts`) contra o Postgres local real — não
 * mocka a busca de perfil/assets, só força `modo`/`capacidades` (o mesmo
 * padrão já usado por `gerarPreviaLipSync`, que recebe `disponivel` como
 * parâmetro em vez de detectar sozinho).
 *
 * Chatterbox/MuseTalk não estão disponíveis via `python3` do sistema
 * neste ambiente de teste — os testes abaixo confirmam que a falha real
 * do provider (não um mock) é repassada como motivo, nunca escondida
 * atrás de um "sucesso" fabricado.
 *
 *   DATABASE_URL=... npx tsx --test tests/retomada-rodada9-worker-wiring.test.ts
 */
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'crypto'

import { criarUsuarioComWorkspace } from '../lib/workspace'
import { carregarContextoDigitalTwin } from '../lib/digital-twin-store'
import { processarEtapaDeVozOuAvatar, type JobDeProducao } from '../lib/digital-twin-worker-core'

const prisma = new PrismaClient()

const CAPACIDADES_SEM_MUSETALK = {
  chatterboxDisponivel: false,
  musetalkDisponivel: false,
  runtimeClasse: 'CPU_ONLY' as const,
  digitalTwinDisponivel: false,
  vozClonadaDisponivel: false,
}

async function novoWorkspaceComPerfil(prefixo: string) {
  const { user } = await criarUsuarioComWorkspace(prisma, { email: `${prefixo}-${randomUUID()}@t.com`, password: 'x' })
  const profile = await prisma.digitalTwinProfile.create({ data: { workspaceId: user.workspaceId, ownerUserId: user.id, displayName: 'x' } })
  return { user, profile }
}

async function limpar(workspaceId: string) {
  await prisma.digitalTwinAsset.deleteMany({ where: { workspaceId } })
  await prisma.voiceProfile.deleteMany({ where: { workspaceId } })
  await prisma.digitalTwinProfile.deleteMany({ where: { workspaceId } })
  await prisma.user.deleteMany({ where: { workspaceId } })
  await prisma.workspace.deleteMany({ where: { id: workspaceId } })
}

describe('Retomada Rodada 9 — roteamento real por jobType no worker', () => {
  test('VOICE_PREVIEW sem VoiceProfile configurado falha com motivo claro (nunca finge sucesso)', async () => {
    const { user, profile } = await novoWorkspaceComPerfil('r9w-voz-sem-perfil')
    const contexto = await carregarContextoDigitalTwin(user.workspaceId)
    const job: JobDeProducao = { id: 'j1', workspaceId: user.workspaceId, profileId: profile.id, jobType: 'VOICE_PREVIEW', mediaAssetUrl: '', overlayTexto: 'x', legenda: 'y' }

    const resultado = await processarEtapaDeVozOuAvatar(job, 'VOICE_ONLY', contexto, CAPACIDADES_SEM_MUSETALK)
    assert.equal(resultado.sucesso, false)
    assert.match(resultado.motivo, /VoiceProfile/)

    await limpar(user.workspaceId)
  })

  test('VOICE_PREVIEW sem VOICE_REFERENCE cadastrado falha com motivo claro (nunca inventa um audioPromptPath)', async () => {
    const { user, profile } = await novoWorkspaceComPerfil('r9w-voz-sem-referencia')
    const voiceProfile = await prisma.voiceProfile.create({ data: { workspaceId: user.workspaceId, ownerUserId: user.id, provider: 'chatterbox-tts' } })
    await prisma.digitalTwinProfile.update({ where: { id: profile.id }, data: { voiceProfileId: voiceProfile.id } })
    const contexto = await carregarContextoDigitalTwin(user.workspaceId)
    const job: JobDeProducao = { id: 'j2', workspaceId: user.workspaceId, profileId: profile.id, jobType: 'VOICE_PREVIEW', mediaAssetUrl: '', overlayTexto: 'x', legenda: 'Prévia de teste.' }

    const resultado = await processarEtapaDeVozOuAvatar(job, 'VOICE_ONLY', contexto, CAPACIDADES_SEM_MUSETALK)
    assert.equal(resultado.sucesso, false)
    assert.match(resultado.motivo, /VOICE_REFERENCE/)

    await limpar(user.workspaceId)
  })

  test('VOICE_PREVIEW com VOICE_REFERENCE cadastrado tenta baixar o asset do storage privado (falha honesta nesta sandbox, nunca fabrica áudio)', async () => {
    const { user, profile } = await novoWorkspaceComPerfil('r9w-voz-com-referencia')
    const voiceProfile = await prisma.voiceProfile.create({ data: { workspaceId: user.workspaceId, ownerUserId: user.id, provider: 'chatterbox-tts' } })
    await prisma.digitalTwinProfile.update({ where: { id: profile.id }, data: { voiceProfileId: voiceProfile.id } })
    await prisma.digitalTwinAsset.create({
      data: { workspaceId: user.workspaceId, profileId: profile.id, type: 'VOICE_REFERENCE', storagePath: 'voz-referencia.wav', mimeType: 'audio/wav' },
    })
    const contexto = await carregarContextoDigitalTwin(user.workspaceId)
    const job: JobDeProducao = { id: 'j2b', workspaceId: user.workspaceId, profileId: profile.id, jobType: 'VOICE_PREVIEW', mediaAssetUrl: '', overlayTexto: 'x', legenda: 'Prévia de teste.' }

    const resultado = await processarEtapaDeVozOuAvatar(job, 'VOICE_ONLY', contexto, CAPACIDADES_SEM_MUSETALK)
    assert.equal(resultado.sucesso, false)
    assert.equal(resultado.status, 'FAILED')
    assert.ok(resultado.motivo.length > 0)

    await limpar(user.workspaceId)
  })

  test('AVATAR_PREVIEW sem áudio de voz ainda gerado (mediaAssetUrl vazio) falha com motivo claro', async () => {
    const { user, profile } = await novoWorkspaceComPerfil('r9w-avatar-sem-audio')
    const voiceProfile = await prisma.voiceProfile.create({ data: { workspaceId: user.workspaceId, ownerUserId: user.id, provider: 'chatterbox-tts' } })
    await prisma.digitalTwinProfile.update({ where: { id: profile.id }, data: { voiceProfileId: voiceProfile.id } })
    const contexto = await carregarContextoDigitalTwin(user.workspaceId)
    const job: JobDeProducao = { id: 'j3', workspaceId: user.workspaceId, profileId: profile.id, jobType: 'AVATAR_PREVIEW', mediaAssetUrl: '', overlayTexto: 'x', legenda: 'y' }

    const resultado = await processarEtapaDeVozOuAvatar(job, 'DIGITAL_TWIN', contexto, CAPACIDADES_SEM_MUSETALK)
    assert.equal(resultado.sucesso, false)
    assert.match(resultado.motivo, /Áudio da voz ainda não foi gerado/)

    await limpar(user.workspaceId)
  })

  test('AVATAR_PREVIEW modo DIGITAL_TWIN sem REFERENCE_VIDEO cadastrado falha com motivo claro', async () => {
    const { user, profile } = await novoWorkspaceComPerfil('r9w-avatar-sem-video')
    const voiceProfile = await prisma.voiceProfile.create({ data: { workspaceId: user.workspaceId, ownerUserId: user.id, provider: 'chatterbox-tts' } })
    await prisma.digitalTwinProfile.update({ where: { id: profile.id }, data: { voiceProfileId: voiceProfile.id } })
    const contexto = await carregarContextoDigitalTwin(user.workspaceId)
    const job: JobDeProducao = { id: 'j4', workspaceId: user.workspaceId, profileId: profile.id, jobType: 'AVATAR_PREVIEW', mediaAssetUrl: '/tmp/audio-gerado.wav', overlayTexto: 'x', legenda: 'y' }

    const resultado = await processarEtapaDeVozOuAvatar(job, 'DIGITAL_TWIN', contexto, CAPACIDADES_SEM_MUSETALK)
    assert.equal(resultado.sucesso, false)
    assert.match(resultado.motivo, /REFERENCE_VIDEO/)

    await limpar(user.workspaceId)
  })

  test('AVATAR_PREVIEW modo VOICE_ONLY sem FACE_IMAGE cadastrado falha com motivo claro', async () => {
    const { user, profile } = await novoWorkspaceComPerfil('r9w-avatar-sem-foto')
    const voiceProfile = await prisma.voiceProfile.create({ data: { workspaceId: user.workspaceId, ownerUserId: user.id, provider: 'chatterbox-tts' } })
    await prisma.digitalTwinProfile.update({ where: { id: profile.id }, data: { voiceProfileId: voiceProfile.id } })
    const contexto = await carregarContextoDigitalTwin(user.workspaceId)
    const job: JobDeProducao = { id: 'j5', workspaceId: user.workspaceId, profileId: profile.id, jobType: 'AVATAR_PREVIEW', mediaAssetUrl: '/tmp/audio-gerado.wav', overlayTexto: 'x', legenda: 'y' }

    const resultado = await processarEtapaDeVozOuAvatar(job, 'VOICE_ONLY', contexto, CAPACIDADES_SEM_MUSETALK)
    assert.equal(resultado.sucesso, false)
    assert.match(resultado.motivo, /FACE_IMAGE/)

    await limpar(user.workspaceId)
  })

  // Atualizado na Rodada 10: PRODUCT_PREVIEW deixou de ser "fora do escopo" e
  // passou a ter processamento real (conteúdo de afiliado com voz aprovada).
  // A falha honesta agora é sobre o que de fato falta — o conteúdo ligado ao
  // job, de onde saem roteiro e produto.
  test('PRODUCT_PREVIEW sem conteúdo ligado falha dizendo o que falta, nunca finge', async () => {
    const { user, profile } = await novoWorkspaceComPerfil('r9w-product-sem-conteudo')
    const voiceProfile = await prisma.voiceProfile.create({ data: { workspaceId: user.workspaceId, ownerUserId: user.id, provider: 'chatterbox-tts' } })
    await prisma.digitalTwinProfile.update({ where: { id: profile.id }, data: { voiceProfileId: voiceProfile.id } })
    const contexto = await carregarContextoDigitalTwin(user.workspaceId)
    const job: JobDeProducao = { id: 'j6', workspaceId: user.workspaceId, profileId: profile.id, jobType: 'PRODUCT_PREVIEW', mediaAssetUrl: '', overlayTexto: 'x', legenda: 'y', contentId: null }

    const resultado = await processarEtapaDeVozOuAvatar(job, 'DIGITAL_TWIN', contexto, CAPACIDADES_SEM_MUSETALK)
    assert.equal(resultado.sucesso, false)
    assert.match(resultado.motivo, /contentId/)

    await limpar(user.workspaceId)
  })

  test('PUBLISH continua sem processamento real — falha honesta, nunca finge', async () => {
    const { user, profile } = await novoWorkspaceComPerfil('r9w-publish-fora-escopo')
    const voiceProfile = await prisma.voiceProfile.create({ data: { workspaceId: user.workspaceId, ownerUserId: user.id, provider: 'chatterbox-tts' } })
    await prisma.digitalTwinProfile.update({ where: { id: profile.id }, data: { voiceProfileId: voiceProfile.id } })
    const contexto = await carregarContextoDigitalTwin(user.workspaceId)
    const job: JobDeProducao = { id: 'j7', workspaceId: user.workspaceId, profileId: profile.id, jobType: 'PUBLISH', mediaAssetUrl: '', overlayTexto: 'x', legenda: 'y' }

    const resultado = await processarEtapaDeVozOuAvatar(job, 'DIGITAL_TWIN', contexto, CAPACIDADES_SEM_MUSETALK)
    assert.equal(resultado.sucesso, false)
    assert.match(resultado.motivo, /não tem processamento real no worker/)

    await limpar(user.workspaceId)
  })
})

after(async () => {
  await prisma.$disconnect()
})
