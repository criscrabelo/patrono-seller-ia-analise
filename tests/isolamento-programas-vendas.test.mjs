/**
 * Teste de regressão — isolamento de workspace estendido a Programas,
 * Vendas e Comissões (Rodada 3, item §24).
 *
 * Mesma lógica de tests/isolamento-workspace.test.mjs, agora para as rotas
 * novas desta rodada.
 *
 *   BASE_URL=http://localhost:3100 npm run test:isolamento-programas
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

let A, B, produtoA, produtoB, programaA, vendaA

before(async () => {
  const up = await fetch(BASE + '/login').catch(() => null)
  if (!up?.ok) throw new Error(`Servidor não respondeu em ${BASE}.`)

  A = await criarContaLogada('iso-prog-a')
  B = await criarContaLogada('iso-prog-b')

  const criarProduto = async (conta, nome) => {
    const r = await conta.fetch('/api/produtos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nome, categoria: 'Teste', publicoAlvo: [], tipoVenda: 'afiliado', origemConteudo: 'manual',
        beneficios: [], pontosNegativos: [], imagens: [], videos: [],
      }),
    })
    assert.equal(r.status, 201)
    return r.json()
  }

  produtoA = await criarProduto(A, 'Produto Isolamento A')
  produtoB = await criarProduto(B, 'Produto Isolamento B')

  const rPrograma = await A.fetch('/api/programas', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ platform: 'shopee', status: 'ACTIVE' }),
  })
  assert.equal(rPrograma.status, 201)
  programaA = await rPrograma.json()

  const rVenda = await A.fetch('/api/vendas', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ productId: produtoA.id, amount: 150, status: 'CONFIRMED' }),
  })
  assert.equal(rVenda.status, 201)
  vendaA = (await rVenda.json()).sale
})

describe('Programas', () => {
  test('workspace B não lê os programas de A', async () => {
    const lista = await (await B.fetch('/api/programas')).json()
    assert.ok(!lista.some((p) => p.id === programaA.id))
  })

  test('workspace B não altera os programas de A (upsert cria um novo, não sobrescreve)', async () => {
    // B tentando "editar" a plataforma de A só cria o PRÓPRIO programa dela
    // com essa plataforma — nunca toca no registro de A, porque upsertPrograma
    // é sempre escopado por workspaceId.
    const r = await B.fetch('/api/programas', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platform: 'shopee', status: 'NEEDS_CONFIGURATION' }),
    })
    assert.equal(r.status, 201)
    const novo = await r.json()
    assert.notEqual(novo.id, programaA.id)

    const confereA = await A.fetch('/api/programas')
    const listaA = await confereA.json()
    const aindaActive = listaA.find((p) => p.id === programaA.id)
    assert.equal(aindaActive.status, 'ACTIVE', 'o programa de A foi alterado por B')
  })
})

describe('Vendas', () => {
  test('workspace B não lê as vendas de A', async () => {
    const lista = await (await B.fetch('/api/vendas')).json()
    assert.ok(!lista.some((v) => v.id === vendaA.id))
  })

  test('workspace B não altera (nem cancela) a venda de A', async () => {
    const r = await B.fetch('/api/vendas', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: vendaA.id, status: 'CANCELLED' }),
    })
    assert.equal(r.status, 404)

    const listaA = await (await A.fetch('/api/vendas')).json()
    const aindaConfirmada = listaA.find((v) => v.id === vendaA.id)
    assert.equal(aindaConfirmada.status, 'CONFIRMED', 'a venda de A foi cancelada por B')
  })
})

describe('Comissões', () => {
  test('workspace B não lê as comissões de A', async () => {
    const dataA = await (await A.fetch('/api/comissoes')).json()
    const dataB = await (await B.fetch('/api/comissoes')).json()
    const idsA = new Set(dataA.comissoes.map((c) => c.id))
    for (const c of dataB.comissoes) assert.ok(!idsA.has(c.id))
  })

  test('workspace B não altera a comissão de A', async () => {
    const dataA = await (await A.fetch('/api/comissoes')).json()
    const comissaoA = dataA.comissoes.find((c) => c.sale?.id === vendaA.id)
    assert.ok(comissaoA)

    const r = await B.fetch('/api/comissoes', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: comissaoA.id, status: 'RECEIVED', receivedAmount: 999 }),
    })
    assert.equal(r.status, 404)

    const confereA = await (await A.fetch('/api/comissoes')).json()
    const aindaExpected = confereA.comissoes.find((c) => c.id === comissaoA.id)
    assert.equal(aindaExpected.status, 'EXPECTED', 'a comissão de A foi alterada por B')
  })
})
