/**
 * Testes da Rodada 6 (TikTok First: Primeira Integração Real). Baseline:
 * 134 testes (103 + 31 da Rodada 5) — todos devem continuar verdes.
 *
 *   npm run test:rodada6
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { gerarState, validarState, TIKTOK_SCOPES } from '../lib/tiktok-oauth'
import { calcularStatusConfiguracaoTikTok } from '../lib/tiktok-config-status'
import { validarPreflightDinamico, tiktokHumanConsentGate, type TikTokCreatorInfo } from '../lib/tiktok-preflight'
import { resolverPrivacidadeTikTok } from '../lib/tiktok-privacy'
import { planejarChunks } from '../lib/tiktok-upload'
import { TikTokRateLimiter } from '../lib/tiktok-rate-limiter'
import { publicarComRetry } from '../lib/tiktok-retry'
import {
  verificarAssinaturaWebhook,
  timestampDentroDaJanela,
  processarWebhookTikTok,
  WebhookIdempotencyStoreEmMemoria,
} from '../lib/tiktok-webhook'
import {
  TikTokShopAffiliateCapabilityProbe,
  exigirTipoDeToken,
  TikTokShopAffiliateProvider,
} from '../lib/tiktok-shop-provider'
import { decidirUsoDeAudio } from '../lib/audio-policy'
import type { AffiliateOpportunity } from '../lib/affiliate-discovery'
import crypto from 'node:crypto'

// ── OAuth ──────────────────────────────────────────────────────────────

describe('TikTok OAuth', () => {
  // P2.17.4: o segredo do state é lido na hora e é obrigatório (sem padrão conhecido).
  const segredoAntes = process.env.NEXTAUTH_SECRET
  if (!segredoAntes) process.env.NEXTAUTH_SECRET = 'segredo-de-teste-rodada6'

  test('sem NEXTAUTH_SECRET não há state (fail-closed, sem segredo padrão)', () => {
    const atual = process.env.NEXTAUTH_SECRET
    delete process.env.NEXTAUTH_SECRET
    try {
      assert.throws(() => gerarState('workspace-123'), /NEXTAUTH_SECRET/)
      assert.equal(validarState('qualquer'), null)
    } finally {
      process.env.NEXTAUTH_SECRET = atual
    }
  })

  test('state assinado é válido e devolve o workspace correto', () => {
    const state = gerarState('workspace-123')
    const resultado = validarState(state)
    assert.deepEqual(resultado, { workspaceId: 'workspace-123' })
  })

  test('state adulterado nunca é aceito', () => {
    const state = gerarState('workspace-123')
    const adulterado = state.slice(0, -2) + 'xx'
    assert.equal(validarState(adulterado), null)
  })

  test('state expirado nunca é aceito', () => {
    const original = Date.now
    Date.now = () => original() - 20 * 60 * 1000
    const state = gerarState('workspace-123')
    Date.now = original
    assert.equal(validarState(state), null)
  })

  test('escopo principal é somente video.publish (nenhum escopo desnecessário)', () => {
    assert.deepEqual(TIKTOK_SCOPES, ['video.publish'])
  })
})

// ── Config Status ──────────────────────────────────────────────────────

describe('TikTok — status de configuração', () => {
  test('sem app configurado → NAO_CONFIGURADO', () => {
    const status = calcularStatusConfiguracaoTikTok({
      appConfigured: false,
      integracaoConectada: false,
      tokenExpirado: false,
      escoposConcedidos: null,
      escoposNecessarios: TIKTOK_SCOPES,
      appAuditado: false,
      erro: null,
    })
    assert.equal(status, 'NAO_CONFIGURADO')
  })

  test('nunca mostra CONECTADO só porque existem client credentials', () => {
    const status = calcularStatusConfiguracaoTikTok({
      appConfigured: true,
      integracaoConectada: false,
      tokenExpirado: false,
      escoposConcedidos: null,
      escoposNecessarios: TIKTOK_SCOPES,
      appAuditado: false,
      erro: null,
    })
    assert.notEqual(status, 'CONECTADO')
    assert.equal(status, 'AUTORIZACAO_NECESSARIA')
  })

  test('token expirado tem estado próprio', () => {
    const status = calcularStatusConfiguracaoTikTok({
      appConfigured: true,
      integracaoConectada: true,
      tokenExpirado: true,
      escoposConcedidos: [...TIKTOK_SCOPES],
      escoposNecessarios: TIKTOK_SCOPES,
      appAuditado: true,
      erro: null,
    })
    assert.equal(status, 'TOKEN_EXPIRADO')
  })

  test('escopo faltando nunca vira "pronto para postar"', () => {
    const status = calcularStatusConfiguracaoTikTok({
      appConfigured: true,
      integracaoConectada: true,
      tokenExpirado: false,
      escoposConcedidos: ['user.info.basic'],
      escoposNecessarios: TIKTOK_SCOPES,
      appAuditado: true,
      erro: null,
    })
    assert.equal(status, 'ESCOPO_PENDENTE')
  })

  test('app não auditado, mesmo com tudo certo, só libera postagem privada', () => {
    const status = calcularStatusConfiguracaoTikTok({
      appConfigured: true,
      integracaoConectada: true,
      tokenExpirado: false,
      escoposConcedidos: [...TIKTOK_SCOPES],
      escoposNecessarios: TIKTOK_SCOPES,
      appAuditado: false,
      erro: null,
    })
    assert.equal(status, 'PRONTO_PARA_POSTAGEM_PRIVADA')
  })

})

// ── Preflight dinâmico ───────────────────────────────────────────────────

describe('TikTok — preflight dinâmico com creator_info real', () => {
  const creatorInfoBase: TikTokCreatorInfo = {
    duracaoMaximaSegundos: 60,
    privacidadeOpcoesPermitidas: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'],
    duetPermitido: true,
    stitchPermitido: false,
    comentariosPermitidos: true,
  }

  test('duração acima do max_video_post_duration_sec bloqueia', () => {
    const resultado = validarPreflightDinamico(creatorInfoBase, {
      duracaoSegundos: 90,
      privacyLevel: 'PUBLIC_TO_EVERYONE',
      comentariosHabilitados: false,
      duetHabilitado: false,
      stitchHabilitado: false,
    })
    assert.equal(resultado.status, 'BLOCKED_BY_POLICY')
  })

  test('privacidade fora das opções permitidas pela conta bloqueia', () => {
    const resultado = validarPreflightDinamico(creatorInfoBase, {
      duracaoSegundos: 30,
      privacyLevel: 'FOLLOWER_OF_CREATOR',
      comentariosHabilitados: false,
      duetHabilitado: false,
      stitchHabilitado: false,
    })
    assert.equal(resultado.status, 'BLOCKED_BY_POLICY')
  })

  test('stitch habilitado quando a conta não permite bloqueia', () => {
    const resultado = validarPreflightDinamico(creatorInfoBase, {
      duracaoSegundos: 30,
      privacyLevel: 'PUBLIC_TO_EVERYONE',
      comentariosHabilitados: false,
      duetHabilitado: false,
      stitchHabilitado: true,
    })
    assert.equal(resultado.status, 'BLOCKED_BY_POLICY')
  })

  test('dentro de todos os limites reais da conta → TECHNICALLY_VALID', () => {
    const resultado = validarPreflightDinamico(creatorInfoBase, {
      duracaoSegundos: 30,
      privacyLevel: 'PUBLIC_TO_EVERYONE',
      comentariosHabilitados: true,
      duetHabilitado: true,
      stitchHabilitado: false,
    })
    assert.equal(resultado.status, 'TECHNICALLY_VALID')
  })

  test('creator_info incompleto (unknown) nunca é tratado como sem limite', () => {
    const resultado = validarPreflightDinamico(
      { ...creatorInfoBase, duracaoMaximaSegundos: 'unknown' },
      { duracaoSegundos: 999, privacyLevel: 'PUBLIC_TO_EVERYONE', comentariosHabilitados: false, duetHabilitado: false, stitchHabilitado: false }
    )
    assert.equal(resultado.status, 'NOT_VERIFIED')
  })

  test('consent gate ainda funciona sobre o resultado dinâmico (regressão)', () => {
    const resultado = validarPreflightDinamico(creatorInfoBase, {
      duracaoSegundos: 30,
      privacyLevel: 'PUBLIC_TO_EVERYONE',
      comentariosHabilitados: true,
      duetHabilitado: true,
      stitchHabilitado: false,
    })
    const gate = tiktokHumanConsentGate(resultado)
    assert.equal(gate.liberadoParaPublicarSozinho, true)
  })
})

// ── Privacidade / App não auditado ──────────────────────────────────────

describe('TikTok — privacidade e app não auditado', () => {
  test('app não auditado sempre resolve para PRIVATE_TESTING_ONLY, nunca pública', () => {
    const resolucao = resolverPrivacidadeTikTok({
      appAuditado: false,
      opcoesPermitidasPelaConta: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'],
      preferenciaConfiguradaPelaUsuaria: 'PUBLIC_TO_EVERYONE',
    })
    assert.equal(resolucao.status, 'PRIVATE_TESTING_ONLY')
    assert.notEqual(resolucao.privacyLevel, 'PUBLIC_TO_EVERYONE')
  })

  test('app auditado com preferência válida resolve automaticamente (não pede decisão à toa)', () => {
    const resolucao = resolverPrivacidadeTikTok({
      appAuditado: true,
      opcoesPermitidasPelaConta: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'],
      preferenciaConfiguradaPelaUsuaria: 'PUBLIC_TO_EVERYONE',
    })
    assert.equal(resolucao.status, 'RESOLVIDO_AUTOMATICAMENTE')
    assert.equal(resolucao.privacyLevel, 'PUBLIC_TO_EVERYONE')
  })

  test('app auditado sem preferência válida exige escolha explícita (a API exige)', () => {
    const resolucao = resolverPrivacidadeTikTok({
      appAuditado: true,
      opcoesPermitidasPelaConta: ['PUBLIC_TO_EVERYONE'],
      preferenciaConfiguradaPelaUsuaria: 'SELF_ONLY',
    })
    assert.equal(resolucao.status, 'REQUER_ESCOLHA_DA_USUARIA')
  })
})

// ── Upload chunking ──────────────────────────────────────────────────────

describe('TikTok — upload em chunks', () => {
  test('arquivo menor que o chunk mínimo vira um único pedaço', () => {
    const plano = planejarChunks(1_000_000)
    assert.equal(plano.length, 1)
    assert.equal(plano[0].size, 1_000_000)
  })

  test('arquivo grande é dividido em múltiplos chunks cobrindo o arquivo inteiro sem sobreposição', () => {
    const tamanhoTotal = 25 * 1024 * 1024
    const plano = planejarChunks(tamanhoTotal, 10 * 1024 * 1024)
    assert.ok(plano.length >= 2)
    let esperado = 0
    for (const chunk of plano) {
      assert.equal(chunk.start, esperado)
      esperado = chunk.end + 1
    }
    assert.equal(esperado, tamanhoTotal)
  })
})

// ── Rate limiter ──────────────────────────────────────────────────────────

describe('TikTok — rate limiter local', () => {
  test('bloqueia chamada acima do limite dentro da janela', () => {
    let agora = 0
    const limiter = new TikTokRateLimiter(() => agora)
    const limite = { maxChamadas: 2, janelaMs: 1000 }
    assert.equal(limiter.podeChamar('x', limite), true)
    assert.equal(limiter.podeChamar('x', limite), true)
    assert.equal(limiter.podeChamar('x', limite), false)
  })

  test('libera de novo depois que a janela passa', () => {
    let agora = 0
    const limiter = new TikTokRateLimiter(() => agora)
    const limite = { maxChamadas: 1, janelaMs: 1000 }
    assert.equal(limiter.podeChamar('x', limite), true)
    agora = 1500
    assert.equal(limiter.podeChamar('x', limite), true)
  })
})

// ── Retry sem duplicação ─────────────────────────────────────────────────

describe('TikTok — retry seguro', () => {
  test('nunca chama publicar() de novo se já está ACCEPTED_BY_TIKTOK', async () => {
    let chamouPublicar = false
    const resultado = await publicarComRetry(
      {
        publicar: async () => {
          chamouPublicar = true
          return { publishId: 'novo' }
        },
        consultarStatus: async () => 'ACCEPTED_BY_TIKTOK',
      },
      undefined,
      { publishId: 'antigo', status: 'ACCEPTED_BY_TIKTOK' }
    )
    assert.equal(chamouPublicar, false)
    assert.equal(resultado.publishId, 'antigo')
  })

  test('tenta de novo em falha de rede, respeitando o máximo de tentativas', async () => {
    let tentativas = 0
    const resultado = await publicarComRetry(
      {
        publicar: async () => {
          tentativas++
          if (tentativas < 3) throw new Error('falha de rede')
          return { publishId: 'ok' }
        },
        consultarStatus: async () => 'PUBLISHING',
        esperar: async () => {},
      },
      { maxTentativas: 3, backoffBaseMs: 1 }
    )
    assert.equal(resultado.publishId, 'ok')
    assert.equal(tentativas, 3)
  })
})

// ── Webhook ────────────────────────────────────────────────────────────

describe('TikTok — webhook (assinatura + idempotência)', () => {
  const secret = 'segredo-teste'

  function assinar(corpo: string, timestamp: string) {
    return crypto.createHmac('sha256', secret).update(`${timestamp}.${corpo}`).digest('hex')
  }

  test('assinatura inválida nunca é aceita', () => {
    const corpo = JSON.stringify({ event: 'x', client_key: 'c', create_time: 1, user_openid: 'o' })
    const ts = String(Math.floor(Date.now() / 1000))
    const ok = verificarAssinaturaWebhook({ corpoCru: corpo, timestampHeader: ts, assinaturaHeader: 'assinatura-errada', clientSecret: secret })
    assert.equal(ok, false)
  })

  test('assinatura válida é aceita', () => {
    const corpo = JSON.stringify({ event: 'x', client_key: 'c', create_time: 1, user_openid: 'o' })
    const ts = String(Math.floor(Date.now() / 1000))
    const sig = assinar(corpo, ts)
    const ok = verificarAssinaturaWebhook({ corpoCru: corpo, timestampHeader: ts, assinaturaHeader: sig, clientSecret: secret })
    assert.equal(ok, true)
  })

  test('timestamp antigo demais é rejeitado (proteção contra replay)', () => {
    const tsAntigo = String(Math.floor(Date.now() / 1000) - 3600)
    assert.equal(timestampDentroDaJanela(tsAntigo), false)
  })

  test('mesmo evento processado duas vezes é detectado como duplicado (idempotência)', async () => {
    const store = new WebhookIdempotencyStoreEmMemoria()
    const payload = { event: 'post.publish.complete', client_key: 'c', create_time: 12345, user_openid: 'open-1' }
    const corpo = JSON.stringify(payload)
    const ts = String(Math.floor(Date.now() / 1000))
    const sig = assinar(corpo, ts)

    const r1 = await processarWebhookTikTok({ corpoCru: corpo, timestampHeader: ts, assinaturaHeader: sig, clientSecret: secret, store })
    const r2 = await processarWebhookTikTok({ corpoCru: corpo, timestampHeader: ts, assinaturaHeader: sig, clientSecret: secret, store })
    assert.equal(r1.duplicado, false)
    assert.equal(r2.duplicado, true)
  })
})

// ── TikTok Shop: capability probe + separação de tokens ──────────────────

describe('TikTok Shop', () => {
  test('conta brasileira recém-registrada nunca é AVAILABLE por padrão', () => {
    const probe = new TikTokShopAffiliateCapabilityProbe()
    const status = probe.calcular({
      appConfigured: true,
      creatorAutorizado: true,
      affiliateApiAprovada: false, // nunca assumido true
      regiaoSuportada: true,
      erro: null,
    })
    assert.equal(status, 'AFFILIATE_API_APPROVAL_REQUIRED')
  })

  test('capability chega a AVAILABLE só com aprovação explícita confirmada', () => {
    const probe = new TikTokShopAffiliateCapabilityProbe()
    const status = probe.calcular({
      appConfigured: true,
      creatorAutorizado: true,
      affiliateApiAprovada: true,
      regiaoSuportada: true,
      erro: null,
    })
    assert.equal(status, 'AVAILABLE')
  })

  test('nunca mistura token de creator com token de seller/partner', () => {
    const creatorToken = { type: 'creator' as const, accessToken: 'x', openId: 'o' }
    assert.throws(() => exigirTipoDeToken(creatorToken, 'seller'))
    assert.doesNotThrow(() => exigirTipoDeToken(creatorToken, 'creator'))
  })

  test('sem aprovação da Affiliate API, getCandidates nunca inventa oportunidade', async () => {
    const provider = new TikTokShopAffiliateProvider()
    const candidatos = await provider.getCandidates()
    assert.deepEqual(candidatos, [])
  })
})

// ── Audio policy ──────────────────────────────────────────────────────────

describe('AudioUsagePolicy', () => {
  test('TIKTOK_LIBRARY_REQUIRED sem API autorizada gera conteúdo sem música (nunca pede decisão à toa)', () => {
    const decisao = decidirUsoDeAudio('TIKTOK_LIBRARY_REQUIRED', { apiEscolhaFaixaAutorizada: false })
    assert.equal(decisao.podeUsar, false)
    assert.equal(decisao.acaoMinimaNecessaria, null)
  })

  test('PROHIBITED nunca é usado', () => {
    const decisao = decidirUsoDeAudio('PROHIBITED', { apiEscolhaFaixaAutorizada: true })
    assert.equal(decisao.podeUsar, false)
  })

  test('LICENSED é liberado', () => {
    const decisao = decidirUsoDeAudio('LICENSED', { apiEscolhaFaixaAutorizada: false })
    assert.equal(decisao.podeUsar, true)
  })
})

describe('Zero state', () => {
  test('TikTok Shop sem nenhuma configuração nunca aparece como disponível', () => {
    const probe = new TikTokShopAffiliateCapabilityProbe()
    const status = probe.calcular({ appConfigured: false, creatorAutorizado: false, affiliateApiAprovada: false, regiaoSuportada: true, erro: null })
    assert.equal(status, 'NOT_CONFIGURED')
  })
})
