/**
 * Teste de regressão — log de auditoria.
 *
 * Confirma que operações de escrita importantes geram um registro em
 * AuditLog com os campos certos, e que dados sensíveis (senha, token)
 * nunca vão parar lá.
 *
 *   BASE_URL=http://localhost:3100 npm run test:audit-log
 */
import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { execCli, PRISMA_CLI, TSX_CLI } from './_exec-cli.mjs'

const BASE = process.env.BASE_URL ?? 'http://localhost:3100'

function consultarAuditLogsDoWorkspace(email) {
  // `prisma db execute` não devolve linhas de SELECT — só roda comandos.
  // Para ler o AuditLog, usamos um script Prisma de verdade via tsx.
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
  const raw = execCli(TSX_CLI, ['-e', script], { encoding: 'utf8' })
  return JSON.parse(raw.trim().split('\n').pop())
}

let conta

before(async () => {
  const up = await fetch(BASE + '/login').catch(() => null)
  if (!up?.ok) throw new Error(`Servidor não respondeu em ${BASE}.`)

  const email = `audit-${Date.now()}@teste.local`
  const senha = 'Teste@12345'

  const reg = await fetch(BASE + '/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Conta Auditoria', email, password: senha }),
  })
  assert.equal(reg.status, 201)

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

  conta = {
    email,
    fetch: (url, init = {}) =>
      fetch(BASE + url, { ...init, headers: { ...init.headers, cookie }, redirect: 'manual' }),
  }
})

describe('Criar produto gera log de auditoria', () => {
  test('AuditLog registra a criação com os campos certos', async () => {
    const r = await conta.fetch('/api/produtos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nome: 'Produto Auditado',
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
    assert.equal(r.status, 201)
    const produto = await r.json()

    const logs = consultarAuditLogsDoWorkspace(conta.email)

    const logCriacao = logs.find((l) => l.action === 'produto.criado' && l.entityId === produto.id)
    assert.ok(logCriacao, 'não achei o log de produto.criado')
    assert.equal(logCriacao.entityType, 'Produto')
    assert.ok(logCriacao.workspaceId)
    assert.ok(logCriacao.userId)

    // Nunca senha, token ou segredo no metadata.
    const metadataTexto = JSON.stringify(logCriacao.metadata ?? {}).toLowerCase()
    assert.ok(!metadataTexto.includes('senha'))
    assert.ok(!metadataTexto.includes('password'))
    assert.ok(!metadataTexto.includes('token'))
    assert.ok(!metadataTexto.includes('secret'))
  })

  test('alterar o produto gera um segundo log (produto.alterado)', async () => {
    const lista = await (await conta.fetch('/api/produtos')).json()
    const produto = lista.find((p) => p.nome === 'Produto Auditado')
    assert.ok(produto)

    await conta.fetch(`/api/produtos/${produto.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nome: 'Produto Auditado (editado)' }),
    })

    const logs = consultarAuditLogsDoWorkspace(conta.email)
    const logAlteracao = logs.find((l) => l.action === 'produto.alterado' && l.entityId === produto.id)
    assert.ok(logAlteracao, 'não achei o log de produto.alterado')
  })
})
