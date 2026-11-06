/**
 * Teste de regressão — Sale/Commission como fonte única (Rodada 3).
 *
 * Garante que:
 * - 1 Sale CONFIRMED = 1 venda, nunca 2 (mesmo que o contador legado do
 *   link também tenha sido incrementado).
 * - Um valor no contador legado NUNCA é somado ao total estruturado.
 * - 1 Sale CANCELLED = 0 vendas confirmadas.
 * - Os três valores de Commission (prevista/confirmada/recebida) são
 *   independentes.
 * - Duplo envio do "Registrar resultado" não cria duas vendas.
 *
 * Roda via tsx (importa lib/ diretamente).
 *   DATABASE_URL=... npm run test:fonte-unica
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { PrismaClient } from '@prisma/client'
import { criarUsuarioComWorkspace } from '../lib/workspace'
import { limparWorkspaceDeTeste } from './_limpar-workspace-de-teste'

// P2.14.8: o teste apaga, ao final, a conta que criou.
const PREFIXO = 'Conta de Teste — '
import { resumoVendas, resumoComissoes, registrarResultado } from '../lib/vendas-comissoes'

const prisma = new PrismaClient()
let workspaceId: string
let userId: string
let produto: Awaited<ReturnType<typeof prisma.produto.create>>

before(async () => {
  const { workspace, user } = await criarUsuarioComWorkspace(prisma, {
    email: `fonte-unica-${Date.now()}@teste.local`,
    password: 'hash-fake-nao-usado-no-login',
    name: 'Conta de Teste — Fonte Única',
  })
  workspaceId = workspace.id
  userId = user.id

  produto = await prisma.produto.create({
    data: {
      workspaceId,
      userId,
      nome: 'Produto Fonte Única',
      categoria: 'Teste',
      origemConteudo: 'manual',
      tipoVenda: 'afiliado',
    },
  })
})

after(async () => {
  await limparWorkspaceDeTeste(prisma, workspaceId, PREFIXO)
  await prisma.$disconnect()
})

describe('Caso 1 — 1 Sale CONFIRMED = 1 venda', () => {
  test('nunca 2', async () => {
    const antes = await resumoVendas(workspaceId)
    await prisma.sale.create({
      data: { workspaceId, productId: produto.id, amount: 100, status: 'CONFIRMED' },
    })
    const depois = await resumoVendas(workspaceId)
    assert.equal(depois.CONFIRMED, antes.CONFIRMED + 1)
  })
})

describe('Caso 2 — contador legado não soma com Sale estruturada', () => {
  test('link com contador legado = 1 + uma Sale CONFIRMED = 1 venda estruturada, não 2', async () => {
    const link = await prisma.linkDinamico.create({
      data: {
        workspaceId,
        userId,
        produtoId: produto.id,
        slug: `slug-legado-${Date.now()}`,
        plataforma: 'instagram',
        urlDestino: 'https://exemplo.com',
        conversoes: 1, // contador legado com valor > 0
        receitaTotal: 50,
      },
    })

    const antes = await resumoVendas(workspaceId)
    await prisma.sale.create({
      data: { workspaceId, productId: produto.id, linkId: link.id, amount: 100, status: 'CONFIRMED' },
    })
    const depois = await resumoVendas(workspaceId)

    // O contador legado do link (1) nunca deve ser somado ao total
    // estruturado — só a Sale recém-criada conta.
    assert.equal(depois.CONFIRMED, antes.CONFIRMED + 1, 'contagem de vendas foi contaminada pelo contador legado')
  })
})

describe('Caso 3 — venda cancelada', () => {
  test('não conta como confirmada', async () => {
    const antes = await resumoVendas(workspaceId)
    await prisma.sale.create({
      data: { workspaceId, productId: produto.id, amount: 500, status: 'CANCELLED' },
    })
    const depois = await resumoVendas(workspaceId)
    assert.equal(depois.CONFIRMED, antes.CONFIRMED, 'venda cancelada apareceu como confirmada')
    assert.equal(depois.CANCELLED, antes.CANCELLED + 1)
  })
})

describe('Caso 4 — Commission EXPECTED', () => {
  test('prevista = valor, confirmada = 0, recebida = 0', async () => {
    const sale = await prisma.sale.create({
      data: { workspaceId, productId: produto.id, amount: 200, status: 'CONFIRMED' },
    })
    const antes = await resumoComissoes(workspaceId)
    await prisma.commission.create({
      data: { workspaceId, saleId: sale.id, productId: produto.id, expectedAmount: 20, status: 'EXPECTED' },
    })
    const depois = await resumoComissoes(workspaceId)
    assert.equal(depois.prevista, antes.prevista + 20)
    assert.equal(depois.confirmada, antes.confirmada)
    assert.equal(depois.recebida, antes.recebida)
  })
})

describe('Caso 5 — Commission CONFIRMED', () => {
  test('confirmada = valor, recebida ainda = 0', async () => {
    const sale = await prisma.sale.create({
      data: { workspaceId, productId: produto.id, amount: 200, status: 'CONFIRMED' },
    })
    const antes = await resumoComissoes(workspaceId)
    await prisma.commission.create({
      data: {
        workspaceId, saleId: sale.id, productId: produto.id,
        expectedAmount: 20, confirmedAmount: 20, status: 'CONFIRMED', confirmedAt: new Date(),
      },
    })
    const depois = await resumoComissoes(workspaceId)
    assert.equal(depois.confirmada, antes.confirmada + 20)
    assert.equal(depois.recebida, antes.recebida)
  })
})

describe('Caso 6 — Commission RECEIVED', () => {
  test('recebida = valor', async () => {
    const sale = await prisma.sale.create({
      data: { workspaceId, productId: produto.id, amount: 200, status: 'CONFIRMED' },
    })
    const antes = await resumoComissoes(workspaceId)
    await prisma.commission.create({
      data: {
        workspaceId, saleId: sale.id, productId: produto.id,
        expectedAmount: 20, confirmedAmount: 20, receivedAmount: 20,
        status: 'RECEIVED', confirmedAt: new Date(), receivedAt: new Date(),
      },
    })
    const depois = await resumoComissoes(workspaceId)
    assert.equal(depois.recebida, antes.recebida + 20)
  })
})

describe('Proteção contra duplo clique', () => {
  test('duas chamadas idênticas de registrarResultado em sequência não criam duas vendas', async () => {
    const antes = await resumoVendas(workspaceId)

    const input = {
      workspaceId,
      actorUserId: userId,
      dataOrigin: 'TEST_FIXTURE' as const,
      productId: produto.id,
      amount: 321,
      status: 'CONFIRMED' as const,
    }
    const r1 = await registrarResultado(input)
    const r2 = await registrarResultado(input) // mesmo envio, "duplo clique"

    assert.equal(r1.duplicado, false)
    assert.equal(r2.duplicado, true, 'a segunda chamada deveria ter sido detectada como duplicata')
    assert.equal(r1.sale.id, r2.sale.id, 'deveria devolver a MESMA venda, não criar uma nova')

    const depois = await resumoVendas(workspaceId)
    assert.equal(depois.CONFIRMED, antes.CONFIRMED + 1, 'duplo envio criou mais de uma venda')
  })

  test('transação: Sale e Commission nascem juntas ou nenhuma nasce', async () => {
    const resultado = await registrarResultado({
      workspaceId,
      actorUserId: userId,
      dataOrigin: 'TEST_FIXTURE' as const,
      productId: produto.id,
      amount: 654,
      status: 'PENDING',
      expectedCommission: 65,
    })
    assert.ok(resultado.sale)
    assert.ok(resultado.commission, 'a Sale foi criada mas a Commission não — quebra a regra da transação')
    assert.equal(resultado.commission?.saleId, resultado.sale.id)
  })
})
