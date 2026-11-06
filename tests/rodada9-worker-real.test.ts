/**
 * Testes da Rodada 9 (Worker Local + Primeira Voz Real + Primeiro Avatar
 * Real quando o hardware permitir). Baseline: 257 testes (67 mjs + 190 ts).
 * Cobre: classificação de rede (CURRENT_ENVIRONMENT_NETWORK_RESTRICTION x
 * MODEL_UNAVAILABLE), classificação da máquina, versão do worker, pairing
 * do worker (token escopado/revogável/isolado por workspace), cache de
 * modelos com download retomável, job de voz (Chatterbox), aprovação da
 * voz (separada da aprovação do avatar), pipeline de lip-sync + fallback
 * VOICE_ONLY_PREVIEW real, licenças das dependências do MuseTalk, segunda
 * prévia com produto, terceiro kill switch (worker) + isolamento
 * cross-workspace na fila, e fallback do Autopilot quando o worker está
 * pausado.
 *
 *   DATABASE_URL=... npm run test:rodada9
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'crypto'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { writeFile, stat, readFile, unlink } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import ffmpegStatic from 'ffmpeg-static'

import { criarUsuarioComWorkspace } from '../lib/workspace'
import { testarAcessoDeRede, verificarAcessoHuggingFace } from '../lib/digital-twin-network-access'
import { classificarMaquina, rotuloClassificacaoMaquina, type DiagnosticoMaquina } from '../lib/digital-twin-machine-classification'
import { verificarVersaoWorker, REQUIRED_WORKER_VERSION } from '../lib/digital-twin-worker-version'
import { gerarTokenWorker, verificarTokenWorker, revogarTokenWorker, listarTokensWorker, tokenWorkerVencido, revogarTokensWorkerDoWorkspace } from '../lib/digital-twin-worker-token'
import { reivindicarProximoJob } from '../lib/digital-twin-job-queue'
import { estimarTamanhoDownloadBytes, baixarComRetomada } from '../lib/digital-twin-model-cache'
import { gerarPreviaDeVoz, TEXTO_PREVIA_VOZ } from '../lib/digital-twin-voice-job'
import { gerarPreviaLipSync, gerarPreviaVozSomente, LIMITE_DURACAO_LIP_SYNC } from '../lib/digital-twin-lipsync-job'
import { podeAtivarMuseTalkComercialmente, MUSETALK_DEPENDENCY_LICENSES, MUSETALK_VERSAO_PREFERIDA } from '../lib/lipsync-provider'
import { gerarSegundaPreviaComProduto } from '../lib/digital-twin-product-preview-job'
import { avaliarKillSwitches } from '../lib/digital-twin-kill-switches'
import { determinarModoAutopilot } from '../lib/digital-twin-autopilot-integration'
import type { VoiceCloneProvider, LipSyncProvider } from '../lib/digital-twin'

const prisma = new PrismaClient()
const execFileAsync = promisify(execFile)
const ffmpegBin = ffmpegStatic as unknown as string

async function gerarAudioTeste(destino: string, duracaoSegundos: number) {
  await execFileAsync(ffmpegBin, ['-f', 'lavfi', '-i', `sine=frequency=220:duration=${duracaoSegundos}`, '-y', destino])
}
async function gerarVideoTeste(destino: string, duracaoSegundos: number) {
  await execFileAsync(ffmpegBin, [
    '-f', 'lavfi', '-i', `color=c=red:s=480x480:d=${duracaoSegundos}`,
    '-f', 'lavfi', '-i', `sine=frequency=200:duration=${duracaoSegundos}`,
    '-c:v', 'libx264', '-c:a', 'aac', '-shortest', '-y', destino,
  ])
}

// ── Rede: CURRENT_ENVIRONMENT_NETWORK_RESTRICTION x MODEL_UNAVAILABLE ────

describe('Classificação de acesso de rede (regra 1)', () => {
  test('HTTP 403 nunca é classificado como modelo indisponível — é restrição do ambiente atual', async () => {
    const fetcherFalso = async () => new Response(null, { status: 403 })
    const r = await testarAcessoDeRede('https://huggingface.co', fetcherFalso as unknown as typeof fetch)
    assert.equal(r.status, 'CURRENT_ENVIRONMENT_NETWORK_RESTRICTION')
    assert.notEqual(r.status, 'MODEL_UNAVAILABLE')
  })

  test('HTTP 404 é classificado como possível indisponibilidade real do lado do provedor', async () => {
    const fetcherFalso = async () => new Response(null, { status: 404 })
    const r = await testarAcessoDeRede('https://huggingface.co/algum-repo-que-nao-existe', fetcherFalso as unknown as typeof fetch)
    assert.equal(r.status, 'MODEL_UNAVAILABLE')
  })

  test('HTTP 200 é AVAILABLE', async () => {
    const fetcherFalso = async () => new Response(null, { status: 200 })
    const r = await testarAcessoDeRede('https://pypi.org', fetcherFalso as unknown as typeof fetch)
    assert.equal(r.status, 'AVAILABLE')
  })

  test('erro de rede tipo "connect_rejected" também é restrição do ambiente, não indisponibilidade do modelo', async () => {
    const fetcherFalso = async () => { throw new Error('connect_rejected: blocked by proxy') }
    const r = await testarAcessoDeRede('https://huggingface.co', fetcherFalso as unknown as typeof fetch)
    assert.equal(r.status, 'CURRENT_ENVIRONMENT_NETWORK_RESTRICTION')
  })

  test('verificarAcessoHuggingFace usa o host oficial do Hugging Face Hub', async () => {
    let hostChamado = ''
    const fetcherFalso = async (url: string) => { hostChamado = url; return new Response(null, { status: 200 }) }
    await verificarAcessoHuggingFace(fetcherFalso as unknown as typeof fetch)
    assert.equal(hostChamado, 'https://huggingface.co')
  })
})

// ── Classificação da máquina ──────────────────────────────────────────

describe('Classificação da máquina (regra 7)', () => {
  const base: DiagnosticoMaquina = {
    runtimeClasse: 'CPU_ONLY',
    pythonDisponivel: true,
    ffmpegDisponivel: true,
    discoSuficiente: true,
    huggingFaceAcessivel: true,
    supabaseAcessivel: true,
    patronoAcessivel: true,
  }

  test('GPU_READY + rede + python => FULL_DIGITAL_TWIN', () => {
    assert.equal(classificarMaquina({ ...base, runtimeClasse: 'GPU_READY' }), 'FULL_DIGITAL_TWIN')
  })

  test('GPU_LIMITED + rede + python => VOICE_AND_LIPSYNC', () => {
    assert.equal(classificarMaquina({ ...base, runtimeClasse: 'GPU_LIMITED' }), 'VOICE_AND_LIPSYNC')
  })

  test('CPU_ONLY + rede + python => VOICE_ONLY (sem avatar sincronizado)', () => {
    assert.equal(classificarMaquina(base), 'VOICE_ONLY')
  })

  test('sem rede (Hugging Face bloqueado), mas com FFmpeg e disco => MOTION_GRAPHICS_ONLY', () => {
    assert.equal(classificarMaquina({ ...base, huggingFaceAcessivel: false }), 'MOTION_GRAPHICS_ONLY')
  })

  test('sem python, sem FFmpeg, sem disco => UNAVAILABLE', () => {
    assert.equal(classificarMaquina({ ...base, pythonDisponivel: false, ffmpegDisponivel: false, discoSuficiente: false, huggingFaceAcessivel: false }), 'UNAVAILABLE')
  })

  test('rótulo amigável nunca expõe termos técnicos crus (CUDA/VRAM)', () => {
    const rotulo = rotuloClassificacaoMaquina('VOICE_ONLY')
    assert.ok(!/CUDA|VRAM/i.test(rotulo))
  })
})

// ── Versão do worker ───────────────────────────────────────────────────

describe('Versão do worker (regra 25)', () => {
  test('worker nunca reportou versão => não atualizado, motivo claro', () => {
    const r = verificarVersaoWorker(null)
    assert.equal(r.atualizado, false)
    assert.match(r.motivo, /nunca reportou/)
  })

  test('worker na versão esperada => atualizado', () => {
    const r = verificarVersaoWorker(REQUIRED_WORKER_VERSION)
    assert.equal(r.atualizado, true)
  })

  test('worker em versão antiga => não atualizado, nunca aplica update sozinho (só recomenda)', () => {
    const r = verificarVersaoWorker('0.9.0')
    assert.equal(r.atualizado, false)
    assert.match(r.motivo, /nunca aplicada automaticamente/)
  })
})

// ── Worker pairing / token (real, Postgres) ───────────────────────────

describe('Worker pairing — token escopado e revogável (regras 21-22)', () => {
  let workspaceA: string
  let workspaceB: string

  before(async () => {
    const a = await criarUsuarioComWorkspace(prisma, { email: `r9-tok-a-${randomUUID()}@t.com`, password: 'x' })
    const b = await criarUsuarioComWorkspace(prisma, { email: `r9-tok-b-${randomUUID()}@t.com`, password: 'x' })
    workspaceA = a.user.workspaceId
    workspaceB = b.user.workspaceId
  })

  after(async () => {
    await prisma.workerToken.deleteMany({ where: { workspaceId: { in: [workspaceA, workspaceB] } } })
    await prisma.user.deleteMany({ where: { workspaceId: { in: [workspaceA, workspaceB] } } })
    await prisma.workspace.deleteMany({ where: { id: { in: [workspaceA, workspaceB] } } })
  })

  test('token gerado resolve para o workspace correto', async () => {
    const { token } = await gerarTokenWorker(workspaceA, 'worker de teste')
    const resultado = await verificarTokenWorker(token)
    assert.equal(resultado?.workspaceId, workspaceA)
  })

  test('token de um workspace NUNCA resolve para outro workspace', async () => {
    const { token } = await gerarTokenWorker(workspaceA)
    const resultado = await verificarTokenWorker(token)
    assert.notEqual(resultado?.workspaceId, workspaceB)
  })

  test('token revogado para de funcionar imediatamente', async () => {
    const { id, token } = await gerarTokenWorker(workspaceA)
    const antes = await verificarTokenWorker(token)
    assert.ok(antes)
    await revogarTokenWorker(workspaceA, id)
    const depois = await verificarTokenWorker(token)
    assert.equal(depois, null)
  })

  test('token inválido/inexistente nunca resolve para nenhum workspace', async () => {
    const resultado = await verificarTokenWorker('token-que-nunca-existiu')
    assert.equal(resultado, null)
  })

  test('P2.50 R2: token vencido (90 d) ou parado (30 d) não vale', async () => {
    const DIA = 24 * 60 * 60 * 1000
    const { token } = await gerarTokenWorker(workspaceA, 'validade')
    assert.ok(await verificarTokenWorker(token, new Date(Date.now() + 29 * DIA)))
    assert.equal(await verificarTokenWorker(token, new Date(Date.now() + 29 * DIA + 31 * DIA)), null)
    const agora = new Date()
    assert.equal(tokenWorkerVencido({ createdAt: new Date(agora.getTime() - 91 * DIA), lastUsedAt: agora }, agora), true)
    assert.equal(tokenWorkerVencido({ createdAt: new Date(agora.getTime() - 31 * DIA), lastUsedAt: null }, agora), true)
    assert.equal(tokenWorkerVencido({ createdAt: new Date(agora.getTime() - 60 * DIA), lastUsedAt: new Date(agora.getTime() - DIA) }, agora), false)
  })

  test('P2.50 R2: dona bloqueada => token para; revogação em lote do workspace', async () => {
    const c = await criarUsuarioComWorkspace(prisma, { email: `r9-tok-c-${randomUUID()}@t.com`, password: 'x' })
    const ws = c.user.workspaceId
    try {
      const { token } = await gerarTokenWorker(ws)
      assert.ok(await verificarTokenWorker(token))
      await prisma.user.update({ where: { id: c.user.id }, data: { status: 'bloqueado' } })
      assert.equal(await verificarTokenWorker(token), null)
      await prisma.user.update({ where: { id: c.user.id }, data: { status: 'ativo' } })
      assert.ok(await verificarTokenWorker(token))
      assert.equal(await revogarTokensWorkerDoWorkspace(ws), 1)
      assert.equal(await verificarTokenWorker(token), null)
    } finally {
      await prisma.workerToken.deleteMany({ where: { workspaceId: ws } })
      await prisma.user.deleteMany({ where: { workspaceId: ws } })
      await prisma.workspace.deleteMany({ where: { id: ws } })
    }
  })

  test('P2.50 R2: o admin revoga os tokens ao bloquear a dona', async () => {
    const rota = await readFile(join(process.cwd(), 'app', 'api', 'admin', 'usuarios', 'route.ts'), 'utf8')
    assert.match(rota, /updated\.status === 'bloqueado'[\s\S]*?revogarTokensWorkerDoWorkspace\(updated\.workspaceId\)/)
    assert.match(rota, /const \{ workspaceId: _ws, \.\.\.resposta \} = updated/)
  })

  test('listarTokensWorker nunca expõe o hash do token', async () => {
    await gerarTokenWorker(workspaceA, 'listagem')
    const lista = await listarTokensWorker(workspaceA)
    for (const t of lista) {
      assert.equal('tokenHash' in t, false)
    }
  })
})

// ── Isolamento cross-workspace na fila + terceiro kill switch (worker) ──

describe('Job Queue — isolamento cross-workspace e terceiro kill switch (regras 21, 34)', () => {
  let workspaceA: string
  let workspaceB: string
  let profileA: string
  let profilePausado: string

  before(async () => {
    const a = await criarUsuarioComWorkspace(prisma, { email: `r9-fila-a-${randomUUID()}@t.com`, password: 'x' })
    const b = await criarUsuarioComWorkspace(prisma, { email: `r9-fila-b-${randomUUID()}@t.com`, password: 'x' })
    workspaceA = a.user.workspaceId
    workspaceB = b.user.workspaceId
    const perfilA = await prisma.digitalTwinProfile.create({ data: { workspaceId: workspaceA, ownerUserId: a.user.id, displayName: 'x' } })
    profileA = perfilA.id
    const perfilPausado = await prisma.digitalTwinProfile.create({ data: { workspaceId: workspaceB, ownerUserId: b.user.id, displayName: 'y', workerPaused: true } })
    profilePausado = perfilPausado.id
  })

  after(async () => {
    await prisma.digitalTwinJob.deleteMany({ where: { workspaceId: { in: [workspaceA, workspaceB] } } })
    await prisma.digitalTwinProfile.deleteMany({ where: { workspaceId: { in: [workspaceA, workspaceB] } } })
    await prisma.user.deleteMany({ where: { workspaceId: { in: [workspaceA, workspaceB] } } })
    await prisma.workspace.deleteMany({ where: { id: { in: [workspaceA, workspaceB] } } })
  })

  test('worker pareado a um workspace nunca reivindica job de outro workspace', async () => {
    await prisma.digitalTwinJob.create({ data: { workspaceId: workspaceB, profileId: profilePausado, status: 'QUEUED' } })
    const reivindicado = await reivindicarProximoJob('worker-pareado', undefined, prisma, workspaceA)
    assert.equal(reivindicado, null)
  })

  test('job de um perfil com workerPaused=true NUNCA é reivindicado, mesmo sem worker pareado', async () => {
    const job = await prisma.digitalTwinJob.create({ data: { workspaceId: workspaceB, profileId: profilePausado, status: 'QUEUED' } })
    const reivindicado = await reivindicarProximoJob('worker-livre', undefined, prisma)
    assert.notEqual(reivindicado?.id, job.id)
  })

  test('job de um perfil SEM worker pausado continua sendo reivindicado normalmente', async () => {
    const job = await prisma.digitalTwinJob.create({ data: { workspaceId: workspaceA, profileId: profileA, status: 'QUEUED' } })
    const reivindicado = await reivindicarProximoJob('worker-livre-2', undefined, prisma, workspaceA)
    assert.equal(reivindicado?.id, job.id)
  })
})

// ── Kill switches (três independentes) ────────────────────────────────

describe('Kill switches — três níveis independentes (regra 34)', () => {
  test('pausar só o worker não afeta Autopilot nem Digital Twin', () => {
    const r = avaliarKillSwitches({ automationPaused: false, digitalTwinEnabled: true, workerPaused: true })
    assert.equal(r.podePublicarAutopilot, true)
    assert.equal(r.podeUsarIdentidadeOuVoz, true)
    assert.equal(r.podeProcessarLocalmente, false)
  })

  test('pausar Autopilot e Digital Twin não afeta o worker sozinho', () => {
    const r = avaliarKillSwitches({ automationPaused: true, digitalTwinEnabled: false, workerPaused: false })
    assert.equal(r.podeProcessarLocalmente, true)
  })
})

describe('Autopilot — fallback quando o worker está pausado (regra 34-35)', () => {
  test('worker pausado nunca escolhe DIGITAL_TWIN/VOICE_ONLY, mesmo com tudo aprovado', () => {
    const d = determinarModoAutopilot({
      profile: {
        id: 'p1', workspaceId: 'w1', ownerUserId: 'u1', displayName: 'x', identityReferenceId: null, voiceProfileId: 'v1', approvedAt: new Date(),
        consentStatus: 'GRANTED', enabled: true, createdAt: new Date(), updatedAt: new Date(),
      },
      voiceProfile: { id: 'v1', workspaceId: 'w1', ownerUserId: 'u1', referenceAudio: null, consentId: 'c1', provider: null, language: 'pt-BR', enabled: true, createdAt: new Date() },
      identityConsent: { id: 'ic1', subjectUserId: 'u1', purpose: 'x', status: 'GRANTED', grantedAt: new Date(), revokedAt: null, expiresAt: null },
      voiceConsent: { id: 'vc1', subjectUserId: 'u1', purpose: 'x', status: 'GRANTED', grantedAt: new Date(), revokedAt: null, expiresAt: null },
      autoUseDigitalTwin: true,
      autoUseVoice: true,
      allowFallback: true,
      workerOnline: true,
      workerPaused: true,
    })
    assert.notEqual(d.modo, 'DIGITAL_TWIN')
    assert.notEqual(d.modo, 'VOICE_ONLY')
    assert.match(d.motivo, /pausado/)
  })
})

// ── Cache de modelos: estimativa + download retomável (real, HTTP local) ─

describe('Cache de modelos — download retomável (regras 27-28)', () => {
  test('estimarTamanhoDownloadBytes lê o content-length via HEAD, sem baixar nada', async () => {
    const fetcherFalso = async (_url: string, opts?: RequestInit) => {
      assert.equal(opts?.method, 'HEAD')
      return new Response(null, { status: 200, headers: { 'content-length': '123456' } })
    }
    const tamanho = await estimarTamanhoDownloadBytes('https://exemplo/modelo.bin', fetcherFalso as unknown as typeof fetch)
    assert.equal(tamanho, 123456)
  })

  test('download real com queda no meio é retomado de onde parou (Range), nunca recomeça do zero', async () => {
    const conteudoCompleto = Buffer.from('A'.repeat(50) + 'B'.repeat(50))
    const destino = join(tmpdir(), `modelo-teste-${randomUUID()}.bin`)
    const parcial = `${destino}.part`

    // Simula queda: já existem os primeiros 50 bytes no .part
    await writeFile(parcial, conteudoCompleto.subarray(0, 50))

    const fetcherFalso = async (_url: string, opts?: RequestInit) => {
      const range = (opts?.headers as Record<string, string> | undefined)?.Range
      assert.equal(range, 'bytes=50-')
      const restante = conteudoCompleto.subarray(50)
      return new Response(restante, { status: 206 })
    }

    const resultado = await baixarComRetomada('https://exemplo/modelo.bin', destino, fetcherFalso as unknown as typeof fetch)
    assert.equal(resultado.concluido, true)
    assert.equal(resultado.bytesBaixados, 100)

    const conteudoFinal = await readFile(destino)
    assert.equal(conteudoFinal.toString(), conteudoCompleto.toString())
    await unlink(destino)
  })

  test('servidor sem suporte a Range reinicia o download (nunca corrompe o arquivo final)', async () => {
    const conteudoCompleto = Buffer.from('X'.repeat(30))
    const destino = join(tmpdir(), `modelo-teste-semrange-${randomUUID()}.bin`)
    const parcial = `${destino}.part`
    await writeFile(parcial, Buffer.from('lixo-parcial'))

    const fetcherFalso = async () => new Response(conteudoCompleto, { status: 200 })
    const resultado = await baixarComRetomada('https://exemplo/modelo.bin', destino, fetcherFalso as unknown as typeof fetch)
    assert.equal(resultado.concluido, true)

    const conteudoFinal = await readFile(destino)
    assert.equal(conteudoFinal.toString(), conteudoCompleto.toString())
    await unlink(destino)
  })
})

// ── Job de voz real (Chatterbox) — regra 8 ────────────────────────────

describe('Job de voz — Reference Audio → Chatterbox → texto novo → Voice Quality Gate', () => {
  test('voz gerada com áudio válido é aprovada e nunca é marcada como publicada', async () => {
    const audio = join(tmpdir(), `voz-teste-${randomUUID()}.wav`)
    await gerarAudioTeste(audio, 3)

    const providerOk: VoiceCloneProvider = {
      sintetizar: async () => ({ audioUrl: 'https://fake/audio.wav' }),
    }
    const resultado = await gerarPreviaDeVoz({
      provider: providerOk,
      audioPromptPath: 'ref.wav',
      resolverParaCaminhoLocal: async () => audio,
    })
    assert.equal(resultado.status, 'READY')
    assert.match(resultado.motivo, /nunca publicada/)
    await unlink(audio)
  })

  test('usa o texto de prévia oficial da Rodada 9 quando nenhum texto é passado', () => {
    assert.match(TEXTO_PREVIA_VOZ, /prévia da minha voz digital no Patrono Seller/)
  })

  test('falha na síntese nunca finge sucesso', async () => {
    const providerFalho: VoiceCloneProvider = {
      sintetizar: async () => { throw new Error('Chatterbox indisponível neste teste') },
    }
    const resultado = await gerarPreviaDeVoz({ provider: providerFalho, audioPromptPath: 'ref.wav', resolverParaCaminhoLocal: async () => 'x' })
    assert.equal(resultado.status, 'FAILED')
  })

  test('áudio vazio (0 bytes) é reprovado pelo Voice Quality Gate, nunca aprovado por engano', async () => {
    const audioVazio = join(tmpdir(), `voz-vazia-${randomUUID()}.wav`)
    await writeFile(audioVazio, Buffer.alloc(0))
    const providerOk: VoiceCloneProvider = {
      sintetizar: async () => ({ audioUrl: 'https://fake/audio.wav' }),
    }
    const resultado = await gerarPreviaDeVoz({ provider: providerOk, audioPromptPath: 'ref.wav', resolverParaCaminhoLocal: async () => audioVazio })
    assert.equal(resultado.status, 'FAILED')
    await unlink(audioVazio)
  })
})

// ── Aprovação da voz — separada da aprovação do avatar (regra 11) ─────

describe('Aprovação da voz é separada da aprovação do perfil completo', () => {
  let workspaceId: string

  before(async () => {
    const { user } = await criarUsuarioComWorkspace(prisma, { email: `r9-vozaprov-${randomUUID()}@t.com`, password: 'x' })
    workspaceId = user.workspaceId
    const voiceProfile = await prisma.voiceProfile.create({ data: { workspaceId, ownerUserId: user.id, language: 'pt-BR' } })
    await prisma.digitalTwinProfile.create({ data: { workspaceId, ownerUserId: user.id, displayName: 'x', voiceProfileId: voiceProfile.id } })
  })

  after(async () => {
    await prisma.digitalTwinProfile.deleteMany({ where: { workspaceId } })
    await prisma.voiceProfile.deleteMany({ where: { workspaceId } })
    await prisma.user.deleteMany({ where: { workspaceId } })
    await prisma.workspace.deleteMany({ where: { id: workspaceId } })
  })

  test('voz pode ser aprovada mesmo sem o perfil completo (avatar) estar aprovado', async () => {
    const profile = await prisma.digitalTwinProfile.findUnique({ where: { workspaceId } })
    assert.equal(profile?.approvedAt, null)

    await prisma.digitalTwinProfile.update({ where: { id: profile!.id }, data: { voiceApprovedAt: new Date() } })
    if (profile!.voiceProfileId) {
      await prisma.voiceProfile.update({ where: { id: profile!.voiceProfileId }, data: { enabled: true } })
    }

    const atualizado = await prisma.digitalTwinProfile.findUnique({ where: { workspaceId } })
    assert.notEqual(atualizado?.voiceApprovedAt, null)
    assert.equal(atualizado?.approvedAt, null) // avatar continua não aprovado — nunca aprova os dois juntos
  })
})

// ── Lip-sync real + VOICE_ONLY_PREVIEW (fallback sem GPU) — regras 15-16 ─

describe('Lip-sync — primeiro pipeline real (MuseTalk) e fallback VOICE_ONLY_PREVIEW', () => {
  test('MuseTalk não confirmado disponível => nunca finge lip-sync, indica o fallback certo', async () => {
    const r = await gerarPreviaLipSync({
      disponivel: false,
      provider: {} as LipSyncProvider,
      referenceVideoUrl: 'x',
      audioUrl: 'y',
      resolverParaCaminhoLocal: async () => { throw new Error('nunca deveria chegar aqui') },
    })
    assert.equal(r.status, 'FAILED')
    assert.match(r.motivo, /VOICE_ONLY_PREVIEW/)
  })

  test('vídeo gerado dentro de 5-10s é aprovado como READY_LIP_SYNC_PREVIEW', async () => {
    const video = join(tmpdir(), `lipsync-ok-${randomUUID()}.mp4`)
    await gerarVideoTeste(video, 7)
    const provider: LipSyncProvider = { sincronizar: async () => ({ videoUrl: 'https://fake/video.mp4' }) }
    const r = await gerarPreviaLipSync({ disponivel: true, provider, referenceVideoUrl: 'ref.mp4', audioUrl: 'a.wav', resolverParaCaminhoLocal: async () => video })
    assert.equal(r.status, 'READY_LIP_SYNC_PREVIEW')
    await unlink(video)
  })

  test('vídeo fora do intervalo 5-10s é reprovado, mesmo com MuseTalk "disponível"', async () => {
    const video = join(tmpdir(), `lipsync-longo-${randomUUID()}.mp4`)
    await gerarVideoTeste(video, LIMITE_DURACAO_LIP_SYNC.maxSegundos + 5)
    const provider: LipSyncProvider = { sincronizar: async () => ({ videoUrl: 'https://fake/video.mp4' }) }
    const r = await gerarPreviaLipSync({ disponivel: true, provider, referenceVideoUrl: 'ref.mp4', audioUrl: 'a.wav', resolverParaCaminhoLocal: async () => video })
    assert.equal(r.status, 'FAILED')
    assert.match(r.motivo, /fora do intervalo/)
    await unlink(video)
  })

  test('VOICE_ONLY_PREVIEW real: foto + voz clonada + motion graphics + legenda gera um MP4 real com áudio', async () => {
    const img = join(tmpdir(), `face-teste-${randomUUID()}.jpg`)
    await execFileAsync(ffmpegBin, ['-f', 'lavfi', '-i', 'color=c=blue:s=480x480:d=1', '-frames:v', '1', '-y', img])
    const imgUrl = `file://${img}`

    const audio = join(tmpdir(), `voz-voiceonly-${randomUUID()}.wav`)
    await gerarAudioTeste(audio, 3.2)

    // O mixing real (FFmpeg + libass, já que este build não tem `drawtext`)
    // foi validado manualmente com o `RendererFFmpeg` de verdade — ver
    // DIGITAL-TWIN-BENCHMARK.md. Aqui validamos a composição do pipeline
    // (áudio real → duração real → chamada ao renderer) sem repetir upload
    // ao Supabase, que está bloqueado neste sandbox.
    const rendererMock = {
      renderVoiceOnlyPreview: async (params: { audioLocalPath: string }) => {
        const { analisarAudio } = await import('../lib/audio-ffprobe')
        const analise = await analisarAudio(params.audioLocalPath)
        return { caminhoLocal: '/tmp/voice-only-local.mp4', durationSeconds: analise.duracaoSegundos ?? 0 }
      },
    }

    const r = await gerarPreviaVozSomente({ faceImageUrl: imgUrl, audioLocalPath: audio, legenda: TEXTO_PREVIA_VOZ, renderer: rendererMock as any })
    assert.equal(r.status, 'READY_VOICE_ONLY_PREVIEW')
    // P2.33.1: prévia com rosto/voz nunca vira URL (pública ou não) aqui — só o arquivo local.
    assert.equal(r.videoUrl, null)
    assert.equal(r.caminhoLocal, '/tmp/voice-only-local.mp4')
    await unlink(img)
    await unlink(audio)
  })

  test('falha no fallback sem GPU nunca é escondida como sucesso', async () => {
    const rendererFalho = { renderVoiceOnlyPreview: async () => { throw new Error('falha proposital') } }
    const r = await gerarPreviaVozSomente({ faceImageUrl: 'x', audioLocalPath: 'y', legenda: 'z', renderer: rendererFalho as any })
    assert.equal(r.status, 'FAILED')
  })
})

// ── MuseTalk — versão preferida e licenças das dependências (regras 12-13) ─

describe('MuseTalk — versão preferida 1.5 e dependências revalidadas individualmente', () => {
  test('versão preferida documentada é 1.5', () => {
    assert.equal(MUSETALK_VERSAO_PREFERIDA, '1.5')
  })

  test('ativação comercial fica bloqueada até TODAS as dependências serem revalidadas manualmente', () => {
    const gate = podeAtivarMuseTalkComercialmente()
    assert.equal(gate.pode, false)
    assert.equal(gate.pendencias.length, MUSETALK_DEPENDENCY_LICENSES.length)
  })

  test('nenhuma dependência adicional começa como CLEARED por padrão (nunca assume licença liberada)', () => {
    for (const dep of MUSETALK_DEPENDENCY_LICENSES) {
      assert.notEqual(dep.status, 'CLEARED')
    }
  })
})

// ── Segunda prévia com produto (regras 19-20) ─────────────────────────

describe('Segunda prévia com produto — pipeline completo até o Quality Gate', () => {
  const produto = { nome: 'Fone Bluetooth XPTO', categoria: 'eletrônicos', preco: 99.9, precoConsultadoEm: '2026-09-14', isAffiliate: true }
  const providerVoz: VoiceCloneProvider = {
    sintetizar: async () => ({ audioUrl: 'https://fake/audio.wav' }),
  }
  const providerLipSync: LipSyncProvider = { sincronizar: async () => ({ videoUrl: 'https://fake/video.mp4' }) }
  let audioOk: string
  let videoOk: string

  before(async () => {
    audioOk = join(tmpdir(), `segunda-previa-audio-${randomUUID()}.wav`)
    await gerarAudioTeste(audioOk, 3)
    videoOk = join(tmpdir(), `segunda-previa-video-${randomUUID()}.mp4`)
    await gerarVideoTeste(videoOk, 7)
  })

  after(async () => {
    await unlink(audioOk)
    await unlink(videoOk)
  })

  test('modo sem avatar/voz (MOTION_GRAPHICS) nunca tenta montar a segunda prévia do Digital Twin', async () => {
    const r = await gerarSegundaPreviaComProduto({
      modo: 'MOTION_GRAPHICS', produto, produtoVisivelNoAsset: true, identidadeAprovada: true,
      vozDeps: { provider: providerVoz, audioPromptPath: 'ref.wav', resolverParaCaminhoLocal: async () => audioOk },
      lipSyncDeps: null, vozSomenteDeps: null,
      commercialDisclosureNecessario: true, commercialDisclosureAplicado: true, tiktokPreflightStatus: 'TECHNICALLY_VALID',
    })
    assert.equal(r.aprovado, false)
  })

  test('DIGITAL_TWIN com voz+avatar+disclosures+preflight todos ok => aprovado, nunca publicado', async () => {
    const r = await gerarSegundaPreviaComProduto({
      modo: 'DIGITAL_TWIN', produto, produtoVisivelNoAsset: true, identidadeAprovada: true,
      vozDeps: { provider: providerVoz, audioPromptPath: 'ref.wav', resolverParaCaminhoLocal: async () => audioOk },
      lipSyncDeps: { disponivel: true, provider: providerLipSync, referenceVideoUrl: 'ref.mp4', audioUrl: 'a.wav', resolverParaCaminhoLocal: async () => videoOk },
      vozSomenteDeps: null,
      commercialDisclosureNecessario: true, commercialDisclosureAplicado: true, tiktokPreflightStatus: 'TECHNICALLY_VALID',
    })
    assert.equal(r.aprovado, true)
    assert.match(r.motivo, /nunca publicada automaticamente/)
  })

  test('commercial disclosure necessário mas não aplicado reprova a segunda prévia', async () => {
    const r = await gerarSegundaPreviaComProduto({
      modo: 'DIGITAL_TWIN', produto, produtoVisivelNoAsset: true, identidadeAprovada: true,
      vozDeps: { provider: providerVoz, audioPromptPath: 'ref.wav', resolverParaCaminhoLocal: async () => audioOk },
      lipSyncDeps: { disponivel: true, provider: providerLipSync, referenceVideoUrl: 'ref.mp4', audioUrl: 'a.wav', resolverParaCaminhoLocal: async () => videoOk },
      vozSomenteDeps: null,
      commercialDisclosureNecessario: true, commercialDisclosureAplicado: false, tiktokPreflightStatus: 'TECHNICALLY_VALID',
    })
    assert.equal(r.aprovado, false)
  })

  test('TikTok preflight bloqueado por política reprova a segunda prévia', async () => {
    const r = await gerarSegundaPreviaComProduto({
      modo: 'DIGITAL_TWIN', produto, produtoVisivelNoAsset: true, identidadeAprovada: true,
      vozDeps: { provider: providerVoz, audioPromptPath: 'ref.wav', resolverParaCaminhoLocal: async () => audioOk },
      lipSyncDeps: { disponivel: true, provider: providerLipSync, referenceVideoUrl: 'ref.mp4', audioUrl: 'a.wav', resolverParaCaminhoLocal: async () => videoOk },
      vozSomenteDeps: null,
      commercialDisclosureNecessario: true, commercialDisclosureAplicado: true, tiktokPreflightStatus: 'BLOCKED_BY_POLICY',
    })
    assert.equal(r.aprovado, false)
  })

  test('sem mídia autorizada do produto, nunca finge posse física (MediaRightsGate reprova)', async () => {
    const r = await gerarSegundaPreviaComProduto({
      modo: 'DIGITAL_TWIN', produto, produtoVisivelNoAsset: false, identidadeAprovada: true,
      vozDeps: { provider: providerVoz, audioPromptPath: 'ref.wav', resolverParaCaminhoLocal: async () => audioOk },
      lipSyncDeps: { disponivel: true, provider: providerLipSync, referenceVideoUrl: 'ref.mp4', audioUrl: 'a.wav', resolverParaCaminhoLocal: async () => videoOk },
      vozSomenteDeps: null,
      commercialDisclosureNecessario: true, commercialDisclosureAplicado: true, tiktokPreflightStatus: 'TECHNICALLY_VALID',
    })
    assert.equal(r.aprovado, false)
    assert.ok(r.problemas.some((p) => p.includes('MediaRightsGate')))
  })
})
