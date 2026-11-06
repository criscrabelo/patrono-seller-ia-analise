/**
 * Teste de regressão — Provider/Channel Capability, automação e
 * Learning Engine (Rodada 4).
 *
 *   DATABASE_URL=... npm run test:capabilities
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { PrismaClient } from '@prisma/client'
import { AFFILIATE_PROVIDER_CAPABILITIES, capacidadeDoProvider, capacidadeOuDesconhecida } from '../lib/affiliate-provider-capabilities'
import { AFFILIATE_PROVIDER_REGISTRY } from '../lib/affiliate-providers'
import { CHANNEL_CAPABILITIES, capacidadeDoCanal } from '../lib/channel-registry'
import { STATUS_PIPELINE, AUTOMATION_MODES, HUMAN_ACTION_REASONS } from '../lib/automation'
import { criarUsuarioComWorkspace } from '../lib/workspace'
import { limparWorkspaceDeTeste } from './_limpar-workspace-de-teste'

// P2.14.8: o teste apaga, ao final, a conta que criou.
const PREFIXO = 'Conta de Teste — '

const prisma = new PrismaClient()

describe('AffiliateProviderCapability', () => {
  test('todo provider do registry tem uma capability correspondente', () => {
    for (const provider of AFFILIATE_PROVIDER_REGISTRY) {
      const cap = capacidadeDoProvider(provider.id)
      assert.ok(cap, `provider "${provider.id}" não tem capability cadastrada`)
    }
  })

  test('nenhuma capability permite scraping', () => {
    for (const cap of AFFILIATE_PROVIDER_CAPABILITIES) {
      assert.equal(cap.scrapingAllowed, false, `${cap.providerId} não pode permitir scraping`)
    }
  })

  test('toda capability tem fonte, data de verificação e nível de confiança', () => {
    for (const cap of AFFILIATE_PROVIDER_CAPABILITIES) {
      assert.ok(cap.sourceType, `${cap.providerId} sem sourceType`)
      assert.ok(cap.lastVerifiedAt, `${cap.providerId} sem lastVerifiedAt`)
      assert.ok(cap.confidence, `${cap.providerId} sem confidence`)
      assert.ok(cap.country, `${cap.providerId} sem country`)
    }
  })

  test('Shopee está marcada com regra crítica contra scraping na observação', () => {
    const shopee = capacidadeDoProvider('shopee')
    assert.ok(shopee)
    assert.equal(shopee.scrapingAllowed, false)
    assert.ok(shopee.observacao?.toUpperCase().includes('REGRA CRÍTICA'))
  })

  test('provider desconhecido nunca é tratado como disponível', () => {
    const desconhecido = capacidadeOuDesconhecida('provider-que-nao-existe-123')
    assert.equal(desconhecido.status, 'NOT_VERIFIED')
    assert.equal(desconhecido.officialApi, false)
    assert.equal(desconhecido.automatedPublishing, false)
    assert.equal(desconhecido.scrapingAllowed, false)
  })

  test('nenhum provider está marcado como conectado/automatizado sem verificação', () => {
    for (const cap of AFFILIATE_PROVIDER_CAPABILITIES) {
      if (cap.automatedPublishing || cap.automatedDiscovery) {
        assert.notEqual(cap.sourceType, 'NOT_VERIFIED', `${cap.providerId} automatiza algo sem fonte verificada`)
      }
    }
  })
})

describe('ChannelCapability', () => {
  test('TikTok exige consentimento explícito do usuário', () => {
    const tiktok = capacidadeDoCanal('tiktok')
    assert.ok(tiktok)
    assert.equal(tiktok.requiresExplicitConsent, true)
  })

  test('TikTok não hardcoda duração — depende da conta (null, não um número fixo)', () => {
    const tiktok = capacidadeDoCanal('tiktok')
    assert.equal(tiktok?.durationRulesSeconds, null)
  })

  test('Instagram já tem publicação automática real implementada', () => {
    const instagram = capacidadeDoCanal('instagram')
    assert.equal(instagram?.autoPublish, true)
  })

  test('todo canal tem lastVerifiedAt e sourceType', () => {
    for (const c of CHANNEL_CAPABILITIES) {
      assert.ok(c.lastVerifiedAt)
      assert.ok(c.sourceType)
    }
  })
})

describe('Automação — constantes', () => {
  test('pipeline de status inclui REQUIRES_USER_CONSENT e BLOCKED_BY_POLICY', () => {
    assert.ok(STATUS_PIPELINE.includes('REQUIRES_USER_CONSENT'))
    assert.ok(STATUS_PIPELINE.includes('BLOCKED_BY_POLICY'))
  })

  test('modos de automação incluem MANUAL, ASSISTED e AUTOMATIC', () => {
    assert.deepEqual([...AUTOMATION_MODES].sort(), ['ASSISTED', 'AUTOMATIC', 'MANUAL'])
  })

  test('motivos de HumanActionRequired cobrem consentimento e token expirado', () => {
    assert.ok(HUMAN_ACTION_REASONS.includes('TIKTOK_CONSENT'))
    assert.ok(HUMAN_ACTION_REASONS.includes('TOKEN_EXPIRED'))
  })
})
