/**
 * P2.15.4 — Regras pré-go-live, pela API REAL (servidor local + banco de TESTE).
 *
 *   - permissão de módulo vale no servidor: 403 para quem tem o módulo
 *     bloqueado, mesmo chamando a API direto; cabeçalho forjado não contorna;
 *     admin passa; módulo não bloqueado passa;
 *   - "publicado" não pode ser gravado à mão (409);
 *   - WhatsApp: sem conteúdo aprovado, recusa (e o módulo bloqueado vem antes).
 * Usa um PAPEL DE TESTE próprio — nunca mexe no papel "usuario".
 *
 *   BASE_URL=http://localhost:3100 node --test tests/regras-p2154.test.mjs
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execCli, PRISMA_CLI } from './_exec-cli.mjs'

const BASE = process.env.BASE_URL ?? 'http://localhost:3100'
const PAPEL = `teste-modulos-${Date.now()}`
const sql = (q) => execCli(PRISMA_CLI, ['db', 'execute', '--stdin'], { input: q, stdio: ['pipe', 'ignore', 'inherit'] })

function sqlAtivarUsuario(email) {
  execCli(PRISMA_CLI, ['db', 'execute', '--stdin'], {
    input: `UPDATE "User" SET status = 'ativo' WHERE email = '${email}';`,
    stdio: ['pipe', 'ignore', 'inherit'],
  })
}

/** Registra uma conta nova, ativa ela e devolve o cookie de sessão logada. */
async function criarContaLogada(prefixo, papel) {
  const email = `${prefixo}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@teste.local`
  const senha = 'Teste@12345'

  const reg = await fetch(BASE + '/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: prefixo, email, password: senha }),
  })
  assert.equal(reg.status, 201, `não criou a conta ${prefixo}`)

  sqlAtivarUsuario(email)
  if (papel) sql(`UPDATE "User" SET role = '${papel}' WHERE email = '${email}';`)

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
  assert.ok(cookie.includes('session-token'), `login da conta ${prefixo} falhou`)

  return {
    email,
    fetch: (url, init = {}) =>
      fetch(BASE + url, { ...init, headers: { ...init.headers, cookie }, redirect: 'manual' }),
  }
}

let U, ADM

before(async () => {
  const up = await fetch(BASE + '/login').catch(() => null)
  if (!up?.ok) throw new Error(`Servidor não respondeu em ${BASE}.`)
  sql(`INSERT INTO "ModuloPermissao" ("id","role","modulo","liberado","updatedAt") VALUES ('${PAPEL}-w','${PAPEL}','whatsapp',false,now()), ('${PAPEL}-p','${PAPEL}','produtos',false,now()), ('${PAPEL}-v','${PAPEL}','video-seller',false,now());`)
  U = await criarContaLogada('modulos-bloqueados', PAPEL)
  ADM = await criarContaLogada('modulos-admin', 'admin')
})

after(() => sql(`DELETE FROM "ModuloPermissao" WHERE role = '${PAPEL}';`))

const json = (conta, url, method, body, extra = {}) =>
  conta.fetch(url, { method, headers: { 'content-type': 'application/json', ...extra }, body: body === undefined ? undefined : JSON.stringify(body) })

test('módulo bloqueado: a API responde 403, mesmo chamada direto', async () => {
  const r = await U.fetch('/api/whatsapp/status')
  assert.equal(r.status, 403)
  assert.match((await r.json()).error, /acesso a este módulo está bloqueado/)
  assert.equal((await json(U, '/api/whatsapp/enviar?conteudoId=x', 'POST', { numeros: ['11999999999'] })).status, 403)
  assert.equal((await json(U, '/api/video-seller', 'POST', { nome: 'x' })).status, 403)
  assert.equal((await json(U, '/api/produtos', 'POST', { nome: 'x' })).status, 403)
})

test('cabeçalho forjado não contorna a permissão', async () => {
  const r = await U.fetch('/api/whatsapp/status', { headers: { 'x-patrono-caminho': '/api/conta/senha', 'x-patrono-metodo': 'GET' } })
  assert.equal(r.status, 403)
})

test('rota compartilhada e módulo liberado continuam funcionando para a mesma usuária', async () => {
  assert.equal((await U.fetch('/api/produtos')).status, 200) // leitura usada por Gerar Conteúdo, Links…
  assert.equal((await U.fetch('/api/oportunidades')).status, 200)
  assert.equal((await U.fetch('/api/links')).status, 200)
})

test('admin acessa todos os módulos', async () => {
  assert.equal((await ADM.fetch('/api/whatsapp/status')).status, 200)
  assert.equal((await ADM.fetch('/api/produtos')).status, 200)
})

test('"publicado" não se grava à mão (só com confirmação do canal)', async () => {
  const r = await json(ADM, '/api/conteudos/qualquer', 'PATCH', { status: 'publicado' })
  assert.equal(r.status, 409)
  assert.match((await r.json()).error, /quando o canal confirma/)
})

test('WhatsApp sem conteúdo aprovado é recusado (hospedagem fechada ou conteúdo ausente) — nada é enviado', async () => {
  const r = await json(ADM, '/api/whatsapp/enviar', 'POST', { numeros: ['11999999999'] })
  assert.ok([400, 403].includes(r.status), String(r.status))
})
