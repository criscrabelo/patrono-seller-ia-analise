/**
 * Teste de regressão — idempotência PERSISTENTE de vendas (Rodada 4).
 *
 * A janela de 5 segundos da Rodada 3 não é garantia financeira suficiente
 * (retry de rede após 5s, ou duas chamadas concorrentes, ainda poderiam
 * duplicar). Este teste confirma a camada persistente:
 * - a mesma idempotencyKey reenviada sempre devolve a MESMA Sale/Commission,
 *   mesmo que os valores da chamada sejam diferentes (a chave manda);
 * - duas chamadas CONCORRENTES com a mesma chave (race condition de
 *   verdade, via Promise.all) criam só UMA Sale — a constraint única do
 *   banco garante isso mesmo sob concorrência real.
 *
 *   DATABASE_URL=... npm run test:idempotencia
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { PrismaClient } from '@prisma/client'
import { criarUsuarioComWorkspace } from '../lib/workspace'
import { limparWorkspaceDeTeste } from './_limpar-workspace-de-teste'

// P2.14.8: o teste apaga, ao final, a conta que criou.
const PREFIXO = 'Conta de Teste — '
import { registrarResultado } from '../lib/vendas-comissoes'

const prisma = new PrismaClient()
let workspaceId: string
let userId: string
let produto: Awaited<ReturnType<typeof prisma.produto.create>>

before(async () => {
  const { workspace, user } = await criarUsuarioComWorkspace(prisma, {
    email: `idempotencia-${Date.now()}@teste.local`,
    password: 'hash-fake-nao-usado-no-login',
    name: 'Conta de Teste — Idempotência',
  })
  workspaceId = workspace.id
  userId = user.id

  produto = await prisma.produto.create({
    data: {
      workspaceId, userId, nome: 'Produto Idempotência', categoria: 'Teste',
      origemConteudo: 'manual', tipoVenda: 'afiliado',
    },
  })
})

after(async () => {
  await limparWorkspaceDeTeste(prisma, workspaceId, PREFIXO)
  await prisma.$disconnect()
})

describe('Chave persistente (sem depender de janela de tempo)', () => {
  test('a mesma chave reenviada devolve a MESMA Sale, mesmo com valores diferentes', async () => {
    const chave = `chave-teste-${Date.now()}`

    const r1 = await registrarResultado({
      workspaceId, actorUserId: userId, dataOrigin: 'TEST_FIXTURE' as const, productId: produto.id,
      amount: 100, status: 'CONFIRMED', idempotencyKey: chave,
    })

    // Reenvio com valor DIFERENTE (simula um formulário que mudou de
    // estado entre o clique e o retry) — a chave é o que importa; o
    // servidor não deve criar uma segunda Sale só porque o corpo mudou.
    const r2 = await registrarResultado({
      workspaceId, actorUserId: userId, dataOrigin: 'TEST_FIXTURE' as const, productId: produto.id,
      amount: 999, status: 'PENDING', idempotencyKey: chave,
    })

    assert.equal(r1.duplicado, false)
    assert.equal(r2.duplicado, true)
    assert.equal(r1.sale.id, r2.sale.id, 'deveria ser a mesma Sale')
    assert.equal(r2.sale.amount, 100, 'os dados são os da PRIMEIRA chamada, não da segunda')
  })

  test('chaves diferentes criam vendas diferentes', async () => {
    const r1 = await registrarResultado({
      workspaceId, actorUserId: userId, dataOrigin: 'TEST_FIXTURE' as const, productId: produto.id,
      amount: 50, status: 'CONFIRMED', idempotencyKey: `chave-a-${Date.now()}`,
    })
    const r2 = await registrarResultado({
      workspaceId, actorUserId: userId, dataOrigin: 'TEST_FIXTURE' as const, productId: produto.id,
      amount: 50, status: 'CONFIRMED', idempotencyKey: `chave-b-${Date.now()}`,
    })
    assert.notEqual(r1.sale.id, r2.sale.id)
  })
})

describe('Concorrência real (duas chamadas simultâneas, mesma chave)', () => {
  test('só uma Sale é criada, mesmo sob race condition de verdade', async () => {
    const chave = `chave-concorrente-${Date.now()}`
    const input = {
      workspaceId, actorUserId: userId, dataOrigin: 'TEST_FIXTURE' as const, productId: produto.id,
      amount: 777, status: 'CONFIRMED' as const, idempotencyKey: chave,
    }

    // Dispara as duas ao mesmo tempo — sem await entre elas — para forçar
    // a race condition de verdade (não é só "chamar duas vezes em
    // sequência", como no teste de duplo clique da Rodada 3).
    const [r1, r2] = await Promise.all([registrarResultado(input), registrarResultado(input)])

    assert.equal(r1.sale.id, r2.sale.id, 'as duas chamadas concorrentes deveriam apontar para a mesma Sale')

    const total = await prisma.sale.count({ where: { workspaceId, idempotencyKey: chave } })
    assert.equal(total, 1, 'a concorrência real criou mais de uma Sale com a mesma chave')
  })
})

describe('Compatibilidade — sem chave, cai no fallback por janela de tempo', () => {
  test('continua funcionando para chamadas que não enviam idempotencyKey', async () => {
    const antes = await prisma.sale.count({ where: { workspaceId } })
    const input = {
      workspaceId, actorUserId: userId, dataOrigin: 'TEST_FIXTURE' as const, productId: produto.id,
      amount: 456, status: 'CONFIRMED' as const,
    }
    const r1 = await registrarResultado(input)
    const r2 = await registrarResultado(input)
    assert.equal(r1.sale.id, r2.sale.id)
    const depois = await prisma.sale.count({ where: { workspaceId } })
    assert.equal(depois, antes + 1)
  })
})
