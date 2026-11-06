/**
 * Testes de fundação do Digital Twin (complemento à Rodada 6). Só cobre o
 * que foi implementado agora — gates de consentimento/kill switch/Presenter
 * Mode/AI Disclosure. Nenhuma renderização fotorrealista é testada aqui.
 *
 *   npm run test:digital-twin
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { podeGerarComDigitalTwin, validarPresenterMode, type DigitalTwinProfile, type VoiceProfile, type IdentityConsent, type VoiceConsent } from '../lib/digital-twin'
import { decidirAIContentDisclosure } from '../lib/ai-content-disclosure'

function profileBase(overrides: Partial<DigitalTwinProfile> = {}): DigitalTwinProfile {
  return {
    id: 'p1',
    workspaceId: 'w1',
    ownerUserId: 'u1',
    displayName: 'Proprietária',
    identityReferenceId: 'ref-1',
    voiceProfileId: 'v1',
    consentStatus: 'GRANTED',
    enabled: true,
    approvedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function voiceBase(overrides: Partial<VoiceProfile> = {}): VoiceProfile {
  return {
    id: 'v1',
    workspaceId: 'w1',
    ownerUserId: 'u1',
    referenceAudio: null,
    consentId: 'c1',
    provider: null,
    language: 'pt-BR',
    enabled: true,
    createdAt: new Date(),
    ...overrides,
  }
}

function identityConsentBase(overrides: Partial<IdentityConsent> = {}): IdentityConsent {
  return {
    id: 'ic1',
    subjectUserId: 'u1',
    purpose: 'geração de vídeos de divulgação',
    status: 'GRANTED',
    grantedAt: new Date(),
    revokedAt: null,
    expiresAt: null,
    ...overrides,
  }
}

function voiceConsentBase(overrides: Partial<VoiceConsent> = {}): VoiceConsent {
  return {
    id: 'vc1',
    subjectUserId: 'u1',
    purpose: 'clonagem de voz para vídeos de divulgação',
    status: 'GRANTED',
    grantedAt: new Date(),
    revokedAt: null,
    expiresAt: null,
    ...overrides,
  }
}

describe('Digital Twin — consentimento e kill switch', () => {
  test('sem consentimento de identidade, nunca gera', () => {
    const decisao = podeGerarComDigitalTwin({
      profile: profileBase(),
      voiceProfile: voiceBase(),
      identityConsent: identityConsentBase({ status: 'NOT_REQUESTED' }),
      voiceConsent: voiceConsentBase(),
    })
    assert.equal(decisao.permitido, false)
  })

  test('consentimento revogado nunca gera, mesmo que o perfil esteja habilitado', () => {
    const decisao = podeGerarComDigitalTwin({
      profile: profileBase(),
      voiceProfile: voiceBase(),
      identityConsent: identityConsentBase({ status: 'REVOKED' }),
      voiceConsent: voiceConsentBase(),
    })
    assert.equal(decisao.permitido, false)
  })

  test('consentimento expirado nunca gera', () => {
    const decisao = podeGerarComDigitalTwin({
      profile: profileBase(),
      voiceProfile: voiceBase(),
      identityConsent: identityConsentBase({ expiresAt: new Date(Date.now() - 1000) }),
      voiceConsent: voiceConsentBase(),
    })
    assert.equal(decisao.permitido, false)
  })

  test('avatar desativado (kill switch "DESATIVAR MEU AVATAR") bloqueia geração mesmo com consentimento válido', () => {
    const decisao = podeGerarComDigitalTwin({
      profile: profileBase({ enabled: false }),
      voiceProfile: voiceBase(),
      identityConsent: identityConsentBase(),
      voiceConsent: voiceConsentBase(),
    })
    assert.equal(decisao.permitido, false)
    assert.match(decisao.motivo, /desativado/i)
  })

  test('VoiceProfile desativado bloqueia mesmo com o avatar ativo', () => {
    const decisao = podeGerarComDigitalTwin({
      profile: profileBase(),
      voiceProfile: voiceBase({ enabled: false }),
      identityConsent: identityConsentBase(),
      voiceConsent: voiceConsentBase(),
    })
    assert.equal(decisao.permitido, false)
  })

  test('sem consentimento de voz, mesmo com voz habilitada, nunca gera', () => {
    const decisao = podeGerarComDigitalTwin({
      profile: profileBase(),
      voiceProfile: voiceBase(),
      identityConsent: identityConsentBase(),
      voiceConsent: voiceConsentBase({ status: 'REVOKED' }),
    })
    assert.equal(decisao.permitido, false)
  })

  test('tudo válido: perfil, voz, consentimentos → permitido', () => {
    const decisao = podeGerarComDigitalTwin({
      profile: profileBase(),
      voiceProfile: voiceBase(),
      identityConsent: identityConsentBase(),
      voiceConsent: voiceConsentBase(),
    })
    assert.equal(decisao.permitido, true)
  })

  test('zero state: sem perfil nenhum, nunca gera', () => {
    const decisao = podeGerarComDigitalTwin({ profile: null, voiceProfile: null, identityConsent: null, voiceConsent: null })
    assert.equal(decisao.permitido, false)
  })
})

describe('Presenter Mode — nunca depoimento pessoal falso', () => {
  test('bloqueia "eu usei"', () => {
    const r = validarPresenterMode('Eu usei esse produto e amei!')
    assert.equal(r.valido, false)
  })

  test('bloqueia "eu testei"', () => {
    const r = validarPresenterMode('Eu testei por uma semana.')
    assert.equal(r.valido, false)
  })

  test('bloqueia "na minha experiência"', () => {
    const r = validarPresenterMode('Na minha experiência, esse fone é ótimo.')
    assert.equal(r.valido, false)
  })

  test('permite apresentação factual do produto', () => {
    const r = validarPresenterMode('Este fone de ouvido tem bateria de 20 horas, segundo o fabricante.')
    assert.equal(r.valido, true)
  })
})

describe('AIContentDisclosureGate', () => {
  test('avatar sintético exige disclosure de IA', () => {
    const decisao = decidirAIContentDisclosure({ usaAvatarSintetico: true, usaVozClonada: false, usaLipSync: false })
    assert.equal(decisao.necessario, true)
  })

  test('voz clonada sozinha já exige disclosure de IA', () => {
    const decisao = decidirAIContentDisclosure({ usaAvatarSintetico: false, usaVozClonada: true, usaLipSync: false })
    assert.equal(decisao.necessario, true)
  })

  test('conteúdo sem nenhum elemento sintético não exige disclosure de IA', () => {
    const decisao = decidirAIContentDisclosure({ usaAvatarSintetico: false, usaVozClonada: false, usaLipSync: false })
    assert.equal(decisao.necessario, false)
  })
})
