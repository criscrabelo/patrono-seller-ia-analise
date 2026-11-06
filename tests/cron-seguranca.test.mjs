/**
 * Teste de regressão — segurança do endpoint de cron (/api/cron/publicar).
 *
 * Esse endpoint não tem sessão de usuária (quem chama é a Vercel Cron),
 * mas isso não pode significar "aberto ao público". Confirma:
 * - sem segredo → 401
 * - segredo errado → 401
 * - segredo certo → executa (200)
 * - uma sessão de usuária comum autenticada NÃO substitui o segredo
 * - o segredo nunca aparece na resposta
 *
 *   BASE_URL=http://localhost:3100 CRON_SECRET=... npm run test:cron
 *
 * Precisa que o servidor tenha sido iniciado com a MESMA CRON_SECRET usada
 * aqui (o teste não define a env do servidor, só a usa para montar o header).
 */
import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { execCli, PRISMA_CLI, TSX_CLI } from './_exec-cli.mjs'

const BASE = process.env.BASE_URL ?? 'http://localhost:3100'
const SEGREDO = process.env.CRON_SECRET
const ROTA = '/api/cron/publicar'

before(async () => {
  const up = await fetch(BASE + '/login').catch(() => null)
  if (!up?.ok) throw new Error(`Servidor não respondeu em ${BASE}.`)
  if (!SEGREDO) {
    throw new Error(
      'Defina CRON_SECRET no ambiente do teste (a mesma usada para subir o servidor) antes de rodar este teste.'
    )
  }
})

describe('Sem segredo', () => {
  test('responde 401', async () => {
    const r = await fetch(BASE + ROTA)
    assert.equal(r.status, 401)
  })

  test('não expõe detalhes sensíveis no corpo', async () => {
    const r = await fetch(BASE + ROTA)
    const texto = await r.text()
    assert.ok(!/at \w+|prisma|stack|Error:/i.test(texto), `resposta vazou detalhe técnico: ${texto}`)
  })
})

describe('Segredo incorreto', () => {
  test('responde 401', async () => {
    const r = await fetch(BASE + ROTA, { headers: { authorization: 'Bearer segredo-errado-de-teste' } })
    assert.equal(r.status, 401)
  })
})

describe('Segredo correto', () => {
  test('executa e responde 200', async () => {
    const r = await fetch(BASE + ROTA, { headers: { authorization: `Bearer ${SEGREDO}` } })
    assert.equal(r.status, 200)
    const body = await r.json()
    assert.equal(typeof body.ok, 'boolean')
  })

  test('o segredo não aparece na resposta', async () => {
    const r = await fetch(BASE + ROTA, { headers: { authorization: `Bearer ${SEGREDO}` } })
    const texto = await r.text()
    assert.ok(!texto.includes(SEGREDO), 'a resposta ecoou o segredo de volta')
  })
})

describe('Sessão de usuária comum não substitui o segredo', () => {
  test('logada, sem header de segredo, ainda responde 401', async () => {
    const email = `cron-teste-${Date.now()}@teste.local`
    const senha = 'Teste@12345'
    await fetch(BASE + '/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Teste Cron', email, password: senha }),
    })

    const { execFileSync } = await import('node:child_process')
    execCli(PRISMA_CLI, ['db', 'execute', '--stdin'], {
      input: `UPDATE "User" SET status = 'ativo' WHERE email = '${email}';`,
      stdio: ['pipe', 'ignore', 'inherit'],
    })

    let cookie = ''
    const guardar = (res) => {
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const [par] = c.split(';')
        const nome = par.split('=')[0]
        cookie = cookie.split('; ').filter((x) => x && !x.startsWith(nome + '=')).concat(par).join('; ')
      }
    }
    const csrfRes = await fetch(BASE + '/api/auth/csrf')
    guardar(csrfRes)
    const { csrfToken } = await csrfRes.json()
    const login = await fetch(BASE + '/api/auth/callback/credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      body: new URLSearchParams({ csrfToken, email, password: senha, json: 'true' }),
      redirect: 'manual',
    })
    guardar(login)
    assert.ok(cookie.includes('session-token'))

    const r = await fetch(BASE + ROTA, { headers: { cookie } })
    assert.equal(r.status, 401, 'sessão de usuária comum não pode bastar para rodar o cron')
  })
})
