/**
 * Continuação da Retomada da Rodada 9 (regra 12/13) — antes,
 * `statusAmigavelParaUsuaria()` existia no backend mas NENHUMA tela o
 * consumia (confirmado por grep no relatório anterior). Este teste
 * confirma, contra o servidor real (HTTP de verdade, sessão real), que
 * `GET /api/digital-twin` agora devolve `ultimoJob.statusAmigavel` a
 * partir do `DigitalTwinJob` mais recente — nunca um percentual
 * fabricado, só o nome real da etapa.
 *
 *   BASE_URL=http://localhost:3100 node --test tests/digital-twin-status-ui.test.mjs
 *
 * Precisa de um banco de TESTE — cria um usuário e um job reais. Nunca
 * rode em produção.
 */
import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { execCli, PRISMA_CLI, TSX_CLI } from './_exec-cli.mjs'

const BASE = process.env.BASE_URL ?? 'http://localhost:3100'
const email = `dt-status-${Date.now()}@teste.local`
const senha = 'Teste@12345'

let cookie = ''
let profileId = ''

function guardarCookies(res) {
  const set = res.headers.getSetCookie?.() ?? []
  for (const c of set) {
    const [par] = c.split(';')
    if (par.includes('session-token') || par.includes('csrf-token')) {
      const nome = par.split('=')[0]
      cookie = cookie.split('; ').filter((x) => x && !x.startsWith(nome + '=')).concat(par).join('; ')
    }
  }
}

const comSessao = (url, init = {}) =>
  fetch(BASE + url, { ...init, headers: { ...init.headers, cookie }, redirect: 'manual' })

before(async () => {
  const up = await fetch(BASE + '/login').catch(() => null)
  if (!up?.ok) throw new Error(`Servidor não respondeu em ${BASE}.`)

  const reg = await fetch(BASE + '/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Conta Digital Twin Status', email, password: senha }),
  })
  assert.equal(reg.status, 201, 'não consegui criar a conta de teste')

  execCli(PRISMA_CLI, ['db', 'execute', '--stdin'], {
    input: `UPDATE "User" SET status = 'ativo' WHERE email = '${email}';`,
    stdio: ['pipe', 'ignore', 'inherit'],
  })

  const csrfRes = await fetch(BASE + '/api/auth/csrf')
  guardarCookies(csrfRes)
  const { csrfToken } = await csrfRes.json()

  const login = await fetch(BASE + '/api/auth/callback/credentials', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ csrfToken, email, password: senha, json: 'true' }),
    redirect: 'manual',
  })
  guardarCookies(login)
  assert.ok(cookie.includes('session-token'), 'login da conta de teste falhou')

  const criarPerfil = await comSessao('/api/digital-twin', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  assert.equal(criarPerfil.status, 200)
  const perfil = await criarPerfil.json()
  profileId = perfil.id
  assert.ok(profileId, 'perfil do Digital Twin não foi criado')
})

describe('GET /api/digital-twin — statusAmigavelParaUsuaria() agora chega na UI', () => {
  test('job em GENERATING_VOICE aparece como "Gerando voz", em andamento', async () => {
    const jobId = randomUUID()
    execCli(PRISMA_CLI, ['db', 'execute', '--stdin'], {
      input: `INSERT INTO "DigitalTwinJob" (id, "workspaceId", "profileId", status, "jobType", attempts, "createdAt", "updatedAt")
              SELECT '${jobId}', "workspaceId", id, 'GENERATING_VOICE', 'VOICE_PREVIEW', 0, now(), now()
              FROM "DigitalTwinProfile" WHERE id = '${profileId}';`,
      stdio: ['pipe', 'ignore', 'inherit'],
    })

    const r = await comSessao('/api/digital-twin')
    assert.equal(r.status, 200)
    const corpo = await r.json()
    assert.equal(corpo.ultimoJob?.status, 'GENERATING_VOICE')
    assert.equal(corpo.ultimoJob?.statusAmigavel, 'Gerando voz')
    assert.equal(corpo.ultimoJob?.emAndamento, true)
  })

  test('job READY não fica marcado como em andamento', async () => {
    const jobId = randomUUID()
    execCli(PRISMA_CLI, ['db', 'execute', '--stdin'], {
      input: `INSERT INTO "DigitalTwinJob" (id, "workspaceId", "profileId", status, "jobType", attempts, "createdAt", "updatedAt")
              SELECT '${jobId}', "workspaceId", id, 'READY', 'VOICE_PREVIEW', 0, now(), now()
              FROM "DigitalTwinProfile" WHERE id = '${profileId}';`,
      stdio: ['pipe', 'ignore', 'inherit'],
    })

    const r = await comSessao('/api/digital-twin')
    assert.equal(r.status, 200)
    const corpo = await r.json()
    assert.equal(corpo.ultimoJob?.status, 'READY')
    assert.equal(corpo.ultimoJob?.statusAmigavel, 'Pronto')
    assert.equal(corpo.ultimoJob?.emAndamento, false)
  })
})
