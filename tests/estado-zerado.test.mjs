/**
 * Teste de regressão — "ZERO SIGNIFICA ZERO".
 *
 * Regra permanente do produto: uma conta recém-criada começa com
 * 0 produtos, 0 links, 0 cliques, 0 vendas, R$ 0,00 de comissão e
 * 0 publicações. Nada é semeado automaticamente.
 *
 * Este teste cria uma conta de verdade, entra com ela e confere que tudo
 * que a tela mostra está zerado. Se alguém voltar a semear dados de exemplo
 * (já aconteceu duas vezes: produtos no seed e links fictícios no protótipo),
 * este teste falha.
 *
 *   BASE_URL=http://localhost:3100 npm run test:zerado
 *
 * Precisa de um banco de TESTE — ele cria um usuário. Nunca rode em produção.
 */
import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { execCli, PRISMA_CLI, TSX_CLI } from './_exec-cli.mjs'

const BASE = process.env.BASE_URL ?? 'http://localhost:3100'
const email = `zerado-${Date.now()}@teste.local`
const senha = 'Teste@12345'

let cookie = ''

/** Lê os cookies da resposta e guarda o token de sessão. */
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

  // 1. Cria a conta
  const reg = await fetch(BASE + '/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Conta Zerada', email, password: senha }),
  })
  assert.equal(reg.status, 201, 'não consegui criar a conta de teste')

  // 2. Contas novas nascem "pendente" e não entram. Ativa direto no banco
  //    de teste — é o que a administradora faria pela tela de Usuários.
  execCli(PRISMA_CLI, ['db', 'execute', '--stdin'], {
    input: `UPDATE "User" SET status = 'ativo' WHERE email = '${email}';`,
    stdio: ['pipe', 'ignore', 'inherit'],
  })

  // 3. Entra
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
})

describe('Conta recém-criada', () => {
  test('não tem nenhum produto', async () => {
    const r = await comSessao('/api/produtos')
    assert.equal(r.status, 200)
    assert.deepEqual(await r.json(), [], 'produto apareceu sozinho')
  })

  test('não tem nenhum link', async () => {
    const r = await comSessao('/api/links')
    assert.equal(r.status, 200)
    assert.deepEqual(await r.json(), [], 'link apareceu sozinho')
  })

  test('não tem nenhum conteúdo', async () => {
    const r = await comSessao('/api/conteudos')
    assert.equal(r.status, 200)
    assert.deepEqual(await r.json(), [], 'conteúdo apareceu sozinho')
  })

  test('não tem nenhuma integração conectada', async () => {
    const r = await comSessao('/api/integracoes')
    assert.equal(r.status, 200)
    assert.deepEqual(await r.json(), [], 'integração apareceu sozinha')
  })

  test('não tem nenhum programa cadastrado', async () => {
    const r = await comSessao('/api/programas')
    assert.equal(r.status, 200)
    assert.deepEqual(await r.json(), [], 'programa apareceu sozinho')
  })

  test('não tem nenhuma venda nem comissão', async () => {
    const rVendas = await comSessao('/api/vendas')
    assert.equal(rVendas.status, 200)
    assert.deepEqual(await rVendas.json(), [], 'venda apareceu sozinha')

    const rComissoes = await comSessao('/api/comissoes')
    assert.equal(rComissoes.status, 200)
    const dataComissoes = await rComissoes.json()
    assert.deepEqual(dataComissoes.comissoes, [], 'comissão apareceu sozinha')
    assert.deepEqual({ prevista: dataComissoes.resumo.prevista, confirmada: dataComissoes.resumo.confirmada, recebida: dataComissoes.resumo.recebida, revertida: dataComissoes.resumo.revertida }, { prevista: 0, confirmada: 0, recebida: 0, revertida: 0 })
  })

  test('todos os números do painel são zero', async () => {
    const r = await comSessao('/api/metricas')
    assert.equal(r.status, 200)
    const m = await r.json()

    assert.equal(m.totalProdutos, 0, 'produtos')
    assert.equal(m.totalConteudos, 0, 'conteúdos')
    assert.equal(m.aguardandoAprovacao, 0, 'aguardando aprovação')
    assert.equal(m.publicados, 0, 'publicados')
    assert.equal(m.comissaoTotal ?? 0, 0, 'comissão')
    assert.deepEqual(m.lucroEscala ?? [], [], 'lucro e escala')

    // Resultados (Sale/Commission) — tudo zerado, incluindo cliques/vendas/
    // as três comissões (prevista/confirmada/recebida).
    assert.deepEqual(m.resultados, {
      vendasConfirmadas: 0,
      vendasPendentes: 0,
      vendasCanceladas: 0,
      comissaoPrevista: 0,
      comissaoConfirmada: 0,
      comissaoRecebida: 0,
    }, 'resultados deveriam nascer zerados')

    // Primeira comissão / celebração: nada concluído numa conta nova, e
    // nenhum dado de comissão inventado.
    assert.equal(m.primeiraComissao.concluida, false, 'celebração não deveria estar concluída')
    assert.ok(!('comissao' in m.primeiraComissao), 'não deveria existir comissão numa etapa não concluída')

    // Nenhum número do painel (no nível raiz) pode vir diferente de zero
    // numa conta nova.
    for (const [chave, valor] of Object.entries(m)) {
      if (typeof valor === 'number') {
        assert.equal(valor, 0, `"${chave}" veio ${valor} numa conta nova`)
      }
      if (Array.isArray(valor)) {
        assert.equal(valor.length, 0, `"${chave}" veio com ${valor.length} item(ns)`)
      }
    }
  })
})
