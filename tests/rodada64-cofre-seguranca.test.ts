/**
 * P2.14.7 (Fase 0A) — Cofre e segurança dos segredos persistidos.
 *
 * Parte pura: AES-256-GCM, AAD por campo, adulteração, ausência de chave
 * (fail-closed), legado em texto puro, rotação, extraData, redação.
 * Parte com banco (TESTE): o cliente Prisma grava CIFRADO (prova lendo a
 * linha crua via SQL) e devolve decifrado; auditoria grava redigida.
 *
 * Chaves de teste geradas aqui, em memória. Nenhum segredo real é usado
 * nem impresso. Custo R$ 0,00.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import {
  cifrar, decifrar, estaCifrado, precisaRecifrar, cofreConfigurado, ErroDoCofre,
  cifrarSegredosDoJson, decifrarSegredosDoJson, chaveEhSecreta, redigir,
} from '../lib/cofre'
import { cifrarDadosDaIntegracao } from '../lib/cofre-prisma'
import { formatarLog, comContexto } from '../lib/observabilidade'

const K1 = randomBytes(32).toString('hex')
const K2 = randomBytes(32).toString('hex')
const ENV1 = { TOKENS_ENCRYPTION_KEY: K1 }
const ENV2_ROTACAO = { TOKENS_ENCRYPTION_KEY: K2, TOKENS_ENCRYPTION_KEY_ANTERIOR: K1 }
const SEGREDO = 'tok_' + randomBytes(12).toString('hex')

describe('Cofre — criptografia (pura)', () => {
  test('ida e volta; texto cifrado não contém o segredo; IV aleatório', () => {
    const a = cifrar(SEGREDO, 'Integracao.accessToken', ENV1)
    const b = cifrar(SEGREDO, 'Integracao.accessToken', ENV1)
    assert.ok(estaCifrado(a))
    assert.ok(!a.includes(SEGREDO))
    assert.notEqual(a, b, 'mesmo texto deve gerar cifras diferentes')
    assert.equal(decifrar(a, 'Integracao.accessToken', ENV1), SEGREDO)
  })

  test('AAD: valor copiado para outro campo não decifra', () => {
    const a = cifrar(SEGREDO, 'Integracao.accessToken', ENV1)
    assert.throws(() => decifrar(a, 'Integracao.refreshToken', ENV1), ErroDoCofre)
  })

  test('adulteração de 1 caractere é detectada', () => {
    const a = cifrar(SEGREDO, 'c', ENV1)
    const partes = a.split(':')
    const ult = partes[partes.length - 1]
    partes[partes.length - 1] = (ult[0] === 'A' ? 'B' : 'A') + ult.slice(1)
    assert.throws(() => decifrar(partes.join(':'), 'c', ENV1), ErroDoCofre)
  })

  test('fail-closed: sem chave NÃO grava (nunca texto puro)', () => {
    assert.equal(cofreConfigurado({}), false)
    assert.throws(() => cifrar(SEGREDO, 'c', {}), /NÃO será gravado em texto puro/)
    // A camada do Prisma lê process.env: sem a chave, a gravação é recusada.
    const guardada = process.env.TOKENS_ENCRYPTION_KEY
    delete process.env.TOKENS_ENCRYPTION_KEY
    try {
      assert.throws(() => cifrarDadosDaIntegracao({ accessToken: SEGREDO }), ErroDoCofre)
      assert.throws(() => cifrarDadosDaIntegracao({ extraData: { appSecret: 'x' } }), ErroDoCofre)
      assert.deepEqual(cifrarDadosDaIntegracao({ status: 'x', accessToken: null }), { status: 'x', accessToken: null })
    } finally {
      if (guardada !== undefined) process.env.TOKENS_ENCRYPTION_KEY = guardada
    }
  })

  test('fail-closed: chave inválida é recusada', () => {
    assert.throws(() => cifrar(SEGREDO, 'c', { TOKENS_ENCRYPTION_KEY: 'curta' }), /chave inválida/)
    assert.equal(cofreConfigurado({ TOKENS_ENCRYPTION_KEY: 'curta' }), false)
  })

  test('cifrado sem a chave certa → erro (não devolve lixo)', () => {
    const a = cifrar(SEGREDO, 'c', ENV1)
    assert.throws(() => decifrar(a, 'c', { TOKENS_ENCRYPTION_KEY: K2 }), /nenhuma chave/)
  })

  test('legado em texto puro: leitura passa, e é marcado para cifrar', () => {
    assert.equal(decifrar('legado-123', 'c', ENV1), 'legado-123')
    assert.equal(precisaRecifrar('legado-123', ENV1), true)
  })

  test('rotação: chave anterior decifra; valor antigo pede recifragem; novo não', () => {
    const antigo = cifrar(SEGREDO, 'c', ENV1)
    assert.equal(decifrar(antigo, 'c', ENV2_ROTACAO), SEGREDO)
    assert.equal(precisaRecifrar(antigo, ENV2_ROTACAO), true)
    const novo = cifrar(SEGREDO, 'c', ENV2_ROTACAO)
    assert.equal(precisaRecifrar(novo, ENV2_ROTACAO), false)
  })

  test('extraData: só chaves secretas são cifradas; o resto fica legível', () => {
    const ex = { appSecret: 's1', clientToken: 's2', partnerKey: 's3', accountLabel: 'Loja', phoneId: '123' }
    const c = cifrarSegredosDoJson(ex, 'Integracao.extraData', ENV1) as Record<string, string>
    assert.ok(estaCifrado(c.appSecret) && estaCifrado(c.clientToken) && estaCifrado(c.partnerKey))
    assert.equal(c.accountLabel, 'Loja')
    assert.equal(c.phoneId, '123')
    assert.deepEqual(decifrarSegredosDoJson(c, 'Integracao.extraData', ENV1), ex)
    for (const k of ['appSecret', 'clientToken', 'access_token', 'apiKey', 'password', 'senha']) assert.ok(chaveEhSecreta(k), k)
    for (const k of ['accountName', 'phoneId', 'nome', 'chaveDeOrigem', 'chaves', 'chaveIdempotencia', 'partnerId', 'appId']) assert.ok(!chaveEhSecreta(k), k)
    for (const k of ['chaveSecreta', 'chaveApi', 'chave_api', 'chavePrivada', 'chaveDeAcesso']) assert.ok(chaveEhSecreta(k), k)
  })
})

describe('Redação de logs e auditoria (pura)', () => {
  test('chaves secretas e padrões conhecidos viram [redigido]', () => {
    const r = redigir({
      accessToken: 'abc', nested: { appSecret: 'x', ok: 'visivel' },
      texto: 'Authorization: Bearer abc.def-123 e postgres://u:p@h/db e sk-ant-api03-xyz e sb_secret_abc',
      jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.assinatura',
      cifrado: 'enc:v1:abcd1234:iv:tag:ct',
    }) as Record<string, unknown>
    const s = JSON.stringify(r)
    for (const proibido of ['abc.def-123', 'u:p@h', 'sk-ant-api03', 'sb_secret_abc', 'eyJhbGci', 'enc:v1:abcd']) {
      assert.ok(!s.includes(proibido), `vazou: ${proibido}`)
    }
    assert.equal((r.nested as Record<string, unknown>).ok, 'visivel')
  })

  test('log estruturado: uma linha JSON com correlationId e dados redigidos', () => {
    const linha = comContexto({ correlationId: 'exec_teste', workspaceId: 'ws1' }, () => formatarLog('info', 'x', { refreshToken: 'segredo-r' }))
    const o = JSON.parse(linha)
    assert.equal(o.correlationId, 'exec_teste')
    assert.equal(o.workspaceId, 'ws1')
    assert.ok(!linha.includes('segredo-r'))
  })
})

// ── Com banco de TESTE ──────────────────────────────────────────────────
const TEM_BANCO = !!process.env.DATABASE_URL && cofreConfigurado()

describe('Cofre no Prisma (banco de teste)', { skip: !TEM_BANCO ? 'exige DATABASE_URL e TOKENS_ENCRYPTION_KEY' : false }, () => {
  // Import tardio: o cliente com a extensão só é carregado quando há banco.
  let prisma: typeof import('../lib/prisma').prisma
  let registrarAuditoria: typeof import('../lib/audit-log').registrarAuditoria
  const marca = `r64-${Date.now()}`
  let ws = ''
  let user = ''

  before(async () => {
    ;({ prisma } = await import('../lib/prisma'))
    ;({ registrarAuditoria } = await import('../lib/audit-log'))
    ws = (await prisma.workspace.create({ data: { name: 'R64', ownerId: marca }, select: { id: true } })).id
    user = (await prisma.user.create({ data: { email: `${marca}@teste.local`, name: 'U', password: 'x', workspaceId: ws }, select: { id: true } })).id
  })

  after(async () => {
    if (ws) {
      await prisma.integracao.deleteMany({ where: { workspaceId: ws } })
      await prisma.auditLog.deleteMany({ where: { workspaceId: ws } })
      await prisma.user.deleteMany({ where: { workspaceId: ws } })
      await prisma.workspace.deleteMany({ where: { id: ws } })
    }
    await prisma?.$disconnect()
  })

  async function cru(id: string) {
    const [l] = await prisma.$queryRaw<{ accessToken: string | null; refreshToken: string | null; extraData: Record<string, unknown> | null }[]>`
      SELECT "accessToken", "refreshToken", "extraData" FROM "Integracao" WHERE "id" = ${id}`
    return l
  }

  test('create grava cifrado no banco e devolve decifrado', async () => {
    const i = await prisma.integracao.create({
      data: { workspaceId: ws, userId: user, plataforma: `${marca}-a`, status: 'conectado', accessToken: SEGREDO, refreshToken: SEGREDO + 'r', extraData: { appSecret: 'app-s', accountLabel: 'Loja' } },
    })
    assert.equal(i.accessToken, SEGREDO)
    const l = await cru(i.id)
    assert.ok(estaCifrado(l.accessToken) && estaCifrado(l.refreshToken), 'banco deve ter enc:v1')
    assert.ok(!JSON.stringify(l).includes(SEGREDO), 'segredo em texto puro no banco')
    assert.ok(estaCifrado(l.extraData?.appSecret))
    assert.equal(l.extraData?.accountLabel, 'Loja')
  })

  test('findFirst/findMany/select decifram; update com {set} e upsert cifram', async () => {
    const i = await prisma.integracao.findFirstOrThrow({ where: { workspaceId: ws, plataforma: `${marca}-a` }, select: { id: true, accessToken: true, extraData: true } })
    assert.equal(i.accessToken, SEGREDO)
    assert.equal((i.extraData as Record<string, unknown>).appSecret, 'app-s')
    const muitos = await prisma.integracao.findMany({ where: { workspaceId: ws } })
    assert.ok(muitos.every((m) => !estaCifrado(m.accessToken)))

    await prisma.integracao.update({ where: { id: i.id }, data: { accessToken: { set: 'novo-1' } } })
    assert.ok(estaCifrado((await cru(i.id)).accessToken))
    assert.equal((await prisma.integracao.findUniqueOrThrow({ where: { id: i.id } })).accessToken, 'novo-1')

    const u = await prisma.integracao.upsert({
      where: { workspaceId_plataforma: { workspaceId: ws, plataforma: `${marca}-b` } },
      create: { workspaceId: ws, userId: user, plataforma: `${marca}-b`, accessToken: 'up-1' },
      update: { accessToken: 'up-2' },
    })
    assert.equal(u.accessToken, 'up-1')
    assert.ok(estaCifrado((await cru(u.id)).accessToken))
    await prisma.integracao.upsert({
      where: { workspaceId_plataforma: { workspaceId: ws, plataforma: `${marca}-b` } },
      create: { workspaceId: ws, userId: user, plataforma: `${marca}-b`, accessToken: 'x' },
      update: { accessToken: 'up-2' },
    })
    assert.ok(estaCifrado((await cru(u.id)).accessToken))
    assert.equal((await prisma.integracao.findUniqueOrThrow({ where: { id: u.id } })).accessToken, 'up-2')
  })

  test('linha legada em texto puro continua legível (transição)', async () => {
    const i = await prisma.integracao.create({ data: { workspaceId: ws, userId: user, plataforma: `${marca}-legado` } })
    await prisma.$executeRaw`UPDATE "Integracao" SET "accessToken" = 'legado-puro' WHERE "id" = ${i.id}`
    assert.equal((await prisma.integracao.findUniqueOrThrow({ where: { id: i.id } })).accessToken, 'legado-puro')
  })

  test('nenhuma integração de teste ficou com token em texto puro (exceto a legada proposital)', async () => {
    const [r] = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "Integracao"
      WHERE "workspaceId" = ${ws} AND "plataforma" <> ${`${marca}-legado`}
        AND "accessToken" IS NOT NULL AND "accessToken" NOT LIKE 'enc:v1:%'`
    assert.equal(Number(r.n), 0)
  })

  test('auditoria grava metadata redigida', async () => {
    await registrarAuditoria({ workspaceId: ws, userId: user, action: `${marca}.teste`, entityType: 'X', entityId: 'x', metadata: { accessToken: 'vaza-nao', ok: 1 } })
    const log = await prisma.auditLog.findFirstOrThrow({ where: { workspaceId: ws, action: `${marca}.teste` } })
    assert.ok(!JSON.stringify(log.metadata).includes('vaza-nao'))
    assert.equal((log.metadata as Record<string, unknown>).ok, 1)
  })
})
