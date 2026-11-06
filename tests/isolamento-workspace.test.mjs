/**
 * Teste de regressão — isolamento de dados por workspace.
 *
 * Regra: nenhum registro operacional (produto, link, conteúdo, etc.) pode
 * ser lido OU alterado por uma sessão de um workspace diferente do dono do
 * registro — nem manipulando ID, nem forçando a URL. O isolamento tem que
 * valer na API (servidor), nunca só na tela.
 *
 * Cria duas contas de verdade (workspace A e workspace B), um produto em
 * cada, e confere nos dois sentidos: leitura e escrita cruzada devem
 * falhar; leitura e escrita própria devem funcionar.
 *
 *   BASE_URL=http://localhost:3100 npm run test:isolamento
 *
 * Precisa de um banco de TESTE — cria contas e produtos de verdade.
 */
import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { execCli, PRISMA_CLI, TSX_CLI } from './_exec-cli.mjs'

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

let A, B, produtoA, produtoB

before(async () => {
  const up = await fetch(BASE + '/login').catch(() => null)
  if (!up?.ok) throw new Error(`Servidor não respondeu em ${BASE}.`)

  A = await criarContaLogada('workspace-a')
  B = await criarContaLogada('workspace-b')

  const criarProduto = async (conta, nome) => {
    const r = await conta.fetch('/api/produtos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nome,
        categoria: 'Teste',
        publicoAlvo: [],
        tipoVenda: 'afiliado',
        origemConteudo: 'manual',
        beneficios: [],
        pontosNegativos: [],
        imagens: [],
        videos: [],
      }),
    })
    assert.equal(r.status, 201, `não criou produto para ${nome}`)
    return r.json()
  }

  produtoA = await criarProduto(A, 'Produto A')
  produtoB = await criarProduto(B, 'Produto B')
})

describe('Isolamento entre workspaces — leitura', () => {
  test('usuária A acessa o produto A', async () => {
    const r = await A.fetch(`/api/produtos/${produtoA.id}`)
    assert.equal(r.status, 200)
    const body = await r.json()
    assert.equal(body.id, produtoA.id)
  })

  test('usuária B acessa o produto B', async () => {
    const r = await B.fetch(`/api/produtos/${produtoB.id}`)
    assert.equal(r.status, 200)
    const body = await r.json()
    assert.equal(body.id, produtoB.id)
  })

  test('usuária A NÃO acessa o produto B (mesmo sabendo o ID)', async () => {
    const r = await A.fetch(`/api/produtos/${produtoB.id}`)
    assert.equal(r.status, 404)
  })

  test('usuária B NÃO acessa o produto A', async () => {
    const r = await B.fetch(`/api/produtos/${produtoA.id}`)
    assert.equal(r.status, 404)
  })

  test('a listagem de A não inclui o produto de B, e vice-versa', async () => {
    const listaA = await (await A.fetch('/api/produtos')).json()
    const listaB = await (await B.fetch('/api/produtos')).json()
    assert.ok(listaA.some((p) => p.id === produtoA.id))
    assert.ok(!listaA.some((p) => p.id === produtoB.id))
    assert.ok(listaB.some((p) => p.id === produtoB.id))
    assert.ok(!listaB.some((p) => p.id === produtoA.id))
  })
})

describe('Isolamento entre workspaces — escrita', () => {
  test('usuária A NÃO consegue alterar o produto de B', async () => {
    const r = await A.fetch(`/api/produtos/${produtoB.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nome: 'Sequestrado pela A' }),
    })
    assert.equal(r.status, 404, 'a alteração cruzada deveria ser recusada')

    // Confirma no banco: o nome de B continua o original.
    const confereB = await B.fetch(`/api/produtos/${produtoB.id}`)
    const bodyB = await confereB.json()
    assert.equal(bodyB.nome, 'Produto B')
  })

  test('usuária B NÃO consegue apagar (descartar) o produto de A', async () => {
    const r = await B.fetch(`/api/produtos/${produtoA.id}`, { method: 'DELETE' })
    // P2.15.3: produto de outro workspace = 404 (antes a rota respondia 200 sem fazer nada).
    assert.equal(r.status, 404)

    // Confirma que o produto de A continua "ativo", não "descartado".
    const confereA = await A.fetch(`/api/produtos/${produtoA.id}`)
    const bodyA = await confereA.json()
    assert.equal(bodyA.status, 'ativo', 'produto de A foi descartado por B')
  })

  test('usuária A consegue alterar o próprio produto', async () => {
    const r = await A.fetch(`/api/produtos/${produtoA.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nome: 'Produto A renomeado' }),
    })
    assert.equal(r.status, 200)
    const confere = await A.fetch(`/api/produtos/${produtoA.id}`)
    const body = await confere.json()
    assert.equal(body.nome, 'Produto A renomeado')
  })
})
