/**
 * Auditoria Skip (A6, A8, A9, A15) — ponta a ponta contra o servidor.
 *
 *   BASE_URL=http://localhost:3100 node --test tests/auth-senha-e-auditoria-admin.test.mjs
 *
 * Cobre: política de senha em todas as rotas, cadastro sem enumeração de e-mail,
 * trilha de auditoria de alteração/exclusão de usuário pelo admin e permissão (usuária comum não é admin).
 */
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { execCli, PRISMA_CLI, TSX_CLI } from './_exec-cli.mjs'

const BASE = process.env.BASE_URL ?? 'http://localhost:3100'
const SENHA = 'Teste@12345'
const marca = Date.now()

const post = (caminho, corpo, cookie = '') =>
  fetch(BASE + caminho, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(corpo) })
const sql = (comando) => execCli(PRISMA_CLI, ['db', 'execute', '--stdin'], { input: comando, stdio: ['pipe', 'ignore', 'inherit'] })

async function entrar(email, senha) {
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
  return cookie.includes('session-token') ? cookie : null
}

function auditorias(email) {
  const script = `
    import { PrismaClient } from '@prisma/client'
    const prisma = new PrismaClient()
    ;(async () => {
      const user = await prisma.user.findUnique({ where: { email: ${JSON.stringify(email)} } })
      const logs = user ? await prisma.auditLog.findMany({ where: { workspaceId: user.workspaceId } }) : []
      console.log(JSON.stringify(logs))
      await prisma.$disconnect()
    })()
  `
  return JSON.parse(execCli(TSX_CLI, ['-e', script], { encoding: 'utf8' }).trim().split('\n').pop())
}

let admin
let comum
let alvo

before(async () => {
  const up = await fetch(BASE + '/login').catch(() => null)
  if (!up?.ok) throw new Error(`Servidor não respondeu em ${BASE}.`)

  const criar = async (rotulo) => {
    const email = `${rotulo}-${marca}@teste.local`
    const r = await post('/api/auth/register', { name: `Conta ${rotulo}`, email, password: SENHA })
    assert.equal(r.status, 201)
    return email
  }
  const emailAdmin = await criar('adm')
  const emailComum = await criar('usr')
  const emailAlvo = await criar('alvo')
  sql(`UPDATE "User" SET status = 'ativo', role = 'admin' WHERE email = '${emailAdmin}';`)
  sql(`UPDATE "User" SET status = 'ativo' WHERE email IN ('${emailComum}', '${emailAlvo}');`)
  admin = { email: emailAdmin, cookie: await entrar(emailAdmin, SENHA) }
  comum = { email: emailComum, cookie: await entrar(emailComum, SENHA) }
  assert.ok(admin.cookie && comum.cookie, 'login das contas de teste')
  alvo = { email: emailAlvo }
})

test('A8: cadastro recusa senha curta e senha óbvia', async () => {
  for (const password of ['curta1', '123456', '1234567890', 'aaaaaaaaaaaa']) {
    const r = await post('/api/auth/register', { name: 'Teste Fraca', email: `fraca-${marca}@teste.local`, password })
    assert.equal(r.status, 400, `senha "${password}"`)
  }
})

test('A6: cadastro com e-mail já existente responde igual ao de e-mail novo e não altera a conta', async () => {
  const novo = await post('/api/auth/register', { name: 'Nova', email: `nova-${marca}@teste.local`, password: SENHA })
  const repetido = await post('/api/auth/register', { name: 'Intrusa', email: alvo.email.toUpperCase(), password: 'Outra@Senha12345' })
  assert.equal(novo.status, 201)
  assert.equal(repetido.status, 201, 'não pode revelar que o e-mail já existe (nada de 409)')
  assert.deepEqual(await repetido.json(), await novo.json())
  assert.ok(await entrar(alvo.email, SENHA), 'a senha original continua valendo')
  assert.equal(await entrar(alvo.email, 'Outra@Senha12345'), null, 'a "intrusa" não pode ter trocado a senha')
})

test('A8/A15: /conta/senha recusa senha nova fraca e aceita forte', async () => {
  const fraca = await post('/api/conta/senha', { senhaAtual: SENHA, novaSenha: 'curta1' }, comum.cookie)
  assert.equal(fraca.status, 400)
  const forte = await post('/api/conta/senha', { senhaAtual: SENHA, novaSenha: 'Nova@Senha12345' }, comum.cookie)
  assert.equal(forte.status, 200, await forte.clone().text())
  assert.ok(await entrar(comum.email, 'Nova@Senha12345'))
})

test('A7: usuária comum não acessa as rotas de administração', async () => {
  const cookie = (await entrar(comum.email, 'Nova@Senha12345')) ?? comum.cookie
  const lista = await fetch(BASE + '/api/admin/usuarios', { headers: { cookie } })
  assert.equal(lista.status, 403)
  const altera = await fetch(BASE + '/api/admin/usuarios', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ id: 'qualquer', role: 'admin' }),
  })
  assert.equal(altera.status, 403)
  const semSessao = await fetch(BASE + '/api/admin/usuarios')
  assert.equal(semSessao.status, 401)
})

test('A8/A9: admin não define senha fraca; alterar e excluir usuário deixa trilha sem a senha', async () => {
  const lista = await fetch(BASE + '/api/admin/usuarios', { headers: { cookie: admin.cookie } })
  assert.equal(lista.status, 200)
  const usuarios = await lista.json()
  const idAlvo = usuarios.find((u) => u.email === alvo.email)?.id
  assert.ok(idAlvo, 'usuária-alvo listada')

  const patch = (corpo) =>
    fetch(BASE + '/api/admin/usuarios', { method: 'PATCH', headers: { 'content-type': 'application/json', cookie: admin.cookie }, body: JSON.stringify({ id: idAlvo, ...corpo }) })
  assert.equal((await patch({ password: 'curta1' })).status, 400)
  assert.equal((await patch({ status: 'bloqueado', password: 'Admin@Define12345' })).status, 200)

  const apagar = await fetch(BASE + '/api/admin/usuarios?id=' + idAlvo, { method: 'DELETE', headers: { cookie: admin.cookie } })
  assert.ok([200, 409].includes(apagar.status), `exclusão: ${apagar.status}`)

  const logs = auditorias(admin.email)
  const alterou = logs.find((l) => l.action === 'admin.usuario.alterar' && l.entityId === idAlvo)
  assert.ok(alterou, 'alteração registrada')
  assert.equal(alterou.metadata.credencialAlterada, true)
  assert.equal(alterou.metadata.status, 'bloqueado')
  assert.doesNotMatch(JSON.stringify(logs), /Admin@Define12345|\$2[aby]\$/, 'a senha nunca vai para o log')
  if (apagar.status === 200) assert.ok(logs.find((l) => l.action === 'admin.usuario.excluir' && l.entityId === idAlvo), 'exclusão registrada')
})

test('npm audit: o otimizador de imagens do Next está desligado (/_next/image não existe)', async () => {
  for (const u of ['/_next/image?url=%2Flogo.png&w=64&q=75', '/_next/image?url=https%3A%2F%2Fx.supabase.co%2Fstorage%2Fv1%2Fobject%2Fpublic%2Fa.avif&w=64&q=75']) {
    assert.equal((await fetch(BASE + u)).status, 404, u)
  }
})

test('npm audit: Authorization malformado não derruba o middleware (401, nunca 500)', async () => {
  for (const h of ['Bearer %', 'Bearer', 'Bearer a.b.c']) {
    assert.equal((await fetch(BASE + '/api/produtos', { headers: { authorization: h } })).status, 401, h)
  }
})

test('A6: cadastros simultâneos com o mesmo e-mail novo não dão 500', async () => {
  const email = `corrida-${marca}@teste.local`
  const rs = await Promise.all([1, 2, 3].map(() => post('/api/auth/register', { name: 'Corrida', email, password: SENHA })))
  for (const r of rs) assert.ok([201, 429].includes(r.status), `status ${r.status}`)
})
