/**
 * Teste de regressão — "primeira comissão" com dados reais (Rodada 3, §27).
 *
 * Confirma que:
 * - Um workspace vazio nunca mostra o progresso como concluído.
 * - Registrar uma venda/comissão real conclui a etapa.
 * - Um "reload" (nova leitura de /api/metricas) continua mostrando
 *   concluído — porque vem do banco, não de localStorage.
 *
 *   BASE_URL=http://localhost:3100 npm run test:primeira-comissao
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
  const email = `${prefixo}-${Date.now()}@teste.local`
  const senha = 'Teste@12345'
  const reg = await fetch(BASE + '/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: prefixo, email, password: senha }),
  })
  assert.equal(reg.status, 201)
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
  assert.ok(cookie.includes('session-token'))
  return { fetch: (url, init = {}) => fetch(BASE + url, { ...init, headers: { ...init.headers, cookie }, redirect: 'manual' }) }
}

let conta, produto, commissionId

before(async () => {
  const up = await fetch(BASE + '/login').catch(() => null)
  if (!up?.ok) throw new Error(`Servidor não respondeu em ${BASE}.`)
  conta = await criarContaLogada('primeira-comissao')

  const rProduto = await conta.fetch('/api/produtos', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nome: 'Produto Primeira Comissão', categoria: 'Teste', publicoAlvo: [], tipoVenda: 'afiliado',
      origemConteudo: 'manual', beneficios: [], pontosNegativos: [], imagens: [], videos: [],
    }),
  })
  produto = await rProduto.json()
})

describe('Workspace vazio', () => {
  test('progresso não concluído', async () => {
    const metricas = await (await conta.fetch('/api/metricas')).json()
    assert.equal(metricas.primeiraComissao.concluida, false)
  })
})

describe('Depois de registrar e confirmar uma comissão real', () => {
  test('a etapa é concluída', async () => {
    const rVenda = await conta.fetch('/api/vendas', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ productId: produto.id, amount: 300, status: 'CONFIRMED', expectedCommission: 30 }),
    })
    const { commission } = await rVenda.json()
    commissionId = commission.id

    // Só EXPECTED ainda não conclui a etapa (é previsão, não comissão de fato).
    let metricas = await (await conta.fetch('/api/metricas')).json()
    assert.equal(metricas.primeiraComissao.concluida, false, 'EXPECTED sozinho não deveria concluir a etapa')

    const rConfirma = await conta.fetch('/api/comissoes', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: commissionId, status: 'CONFIRMED', confirmedAmount: 30 }),
    })
    assert.equal(rConfirma.status, 200)

    metricas = await (await conta.fetch('/api/metricas')).json()
    assert.equal(metricas.primeiraComissao.concluida, true)
    assert.equal(metricas.primeiraComissao.comissao.produto, 'Produto Primeira Comissão')
    assert.equal(metricas.primeiraComissao.comissao.valor, 30)
  })

  test('"reload" (nova leitura) continua concluída — não depende de localStorage', async () => {
    // Chama de novo, como se a página tivesse recarregado do zero.
    const metricas = await (await conta.fetch('/api/metricas')).json()
    assert.equal(metricas.primeiraComissao.concluida, true)
    assert.equal(metricas.primeiraComissao.comissao.id, commissionId)
  })
})
