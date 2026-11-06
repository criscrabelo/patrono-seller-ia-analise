/**
 * P2.15.3 — Regressão da auditoria funcional, contra o SERVIDOR (banco de TESTE).
 *
 * Prova, pela API real, as proteções que a auditoria fechou:
 *   - PATCH de produto/conteúdo recusa campos fora da lista branca
 *     (workspaceId, userId…) e corpo inválido vira 400, nunca 500;
 *   - TikTok Shop não pode ser "conectado" por POST (evidência só via OAuth);
 *   - PATCH /api/links exige id (antes alterava todos os links);
 *   - rotas de upload sem uso respondem 410;
 *   - rota inexistente → 404 em português.
 *
 *   BASE_URL=http://localhost:3100 node --test tests/auditoria-p2153.test.mjs
 */
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { execCli, PRISMA_CLI } from './_exec-cli.mjs'

const BASE = process.env.BASE_URL ?? 'http://localhost:3100'

function sqlAtivarUsuario(email) {
  execCli(PRISMA_CLI, ['db', 'execute', '--stdin'], {
    input: `UPDATE "User" SET status = 'ativo' WHERE email = '${email}';`,
    stdio: ['pipe', 'ignore', 'inherit'],
  })
}

/** Registra uma conta nova, ativa ela e devolve o cookie de sessão logada. */
async function criarContaLogada(prefixo) {
  const email = `${prefixo}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@teste.local`
  const senha = 'Teste@12345'

  const reg = await fetch(BASE + '/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: prefixo, email, password: senha }),
  })
  assert.equal(reg.status, 201, `não criou a conta ${prefixo}`)

  sqlAtivarUsuario(email)

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

let C, produto

before(async () => {
  const up = await fetch(BASE + '/login').catch(() => null)
  if (!up?.ok) throw new Error(`Servidor não respondeu em ${BASE}.`)
  C = await criarContaLogada('auditoria-p2153')
  const r = await C.fetch('/api/produtos', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nome: 'Produto da auditoria', categoria: 'Teste', publicoAlvo: [], tipoVenda: 'afiliado', origemConteudo: 'manual', beneficios: [], pontosNegativos: [], imagens: [], videos: [] }),
  })
  assert.equal(r.status, 201, 'não criou o produto')
  produto = await r.json()
})

const json = (conta, url, method, body) =>
  conta.fetch(url, { method, headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) })

test('PATCH de produto: campo fora da lista branca → 400; corpo inválido → 400; campo permitido → 200', async () => {
  assert.equal((await json(C, `/api/produtos/${produto.id}`, 'PATCH', { workspaceId: 'outro' })).status, 400)
  assert.equal((await json(C, `/api/produtos/${produto.id}`, 'PATCH', { userId: 'outro' })).status, 400)
  assert.equal((await json(C, `/api/produtos/${produto.id}`, 'PATCH', '{nao é json')).status, 400)
  assert.equal((await json(C, `/api/produtos/${produto.id}`, 'PATCH', { linkProduto: 'loja.com/x' })).status, 400)
  assert.equal((await json(C, `/api/produtos/${produto.id}`, 'PATCH', { nome: 'Renomeado pela auditoria' })).status, 200)
  assert.equal((await (await C.fetch(`/api/produtos/${produto.id}`)).json()).nome, 'Renomeado pela auditoria')
})

test('PATCH de conteúdo: campo fora da lista → 400; inexistente → 404', async () => {
  assert.equal((await json(C, '/api/conteudos/nao-existe', 'PATCH', { workspaceId: 'x' })).status, 400)
  assert.equal((await json(C, '/api/conteudos/nao-existe', 'PATCH', { status: 'aprovado' })).status, 404)
  assert.equal((await json(C, '/api/conteudos/nao-existe', 'PATCH', { status: 'qualquer-coisa' })).status, 400)
})

test('TikTok Shop não se conecta por POST (só pela autorização oficial)', async () => {
  for (const plataforma of ['tiktok-shop', 'tiktok-shop-creator']) {
    const r = await json(C, '/api/integracoes', 'POST', { plataforma, accessToken: 'token-falso' })
    assert.equal(r.status, 403, plataforma)
  }
  assert.equal((await json(C, '/api/integracoes', 'POST', { lixo: true })).status, 400)
  const lista = await (await C.fetch('/api/integracoes')).json()
  assert.equal(lista.filter((i) => String(i.plataforma).startsWith('tiktok-shop')).length, 0)
})

test('PATCH /api/links sem id → 400 (antes alterava todos os links); URL ruim → 400', async () => {
  assert.equal((await json(C, '/api/links', 'PATCH', { ativo: false })).status, 400)
  assert.equal((await json(C, '/api/links', 'POST', { produtoId: produto.id, urlDestino: 'sem-protocolo' })).status, 400)
  assert.equal((await json(C, '/api/links', 'POST', { urlDestino: 'https://loja.invalido/x' })).status, 400)
})

test('rotas de upload sem uso: 410', async () => {
  assert.equal((await json(C, '/api/upload', 'POST', {})).status, 410)
  assert.equal((await json(C, '/api/upload/presign', 'POST', {})).status, 410)
})

test('rota inexistente: 404 em português', async () => {
  const r = await C.fetch('/pagina-que-nao-existe-p2153')
  assert.equal(r.status, 404)
  assert.match(await r.text(), /Esta página não existe/)
})
