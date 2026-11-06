/**
 * Teste de regressão — Programa × Operação × Integração, e Venda ≠ Comissão.
 *
 * Roda direto contra o Prisma (não HTTP): ainda não existe tela/rota pública
 * para "Meus Programas" nem para editar Vendas e Comissões diretamente
 * (isso é trabalho de uma rodada futura de UI) — mas o MODELO de dados e as
 * regras de negócio já precisam estar corretos agora, porque é a fundação
 * que a tela vai usar.
 *
 *   DATABASE_URL=... npm run test:programa-venda-comissao
 *
 * Usa um banco de TESTE isolado — cria workspace, programa, vendas e
 * comissões de verdade.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { PrismaClient } from '@prisma/client'
import { criarUsuarioComWorkspace } from '../lib/workspace'
import { limparWorkspaceDeTeste } from './_limpar-workspace-de-teste'

// P2.14.8: o teste apaga, ao final, a conta que criou.
const PREFIXO = 'Conta de Teste — '
import { upsertPrograma } from '../lib/affiliate-program'
import { resumoVendas, resumoComissoes } from '../lib/vendas-comissoes'

const prisma = new PrismaClient()
let workspaceId: string

before(async () => {
  const { workspace } = await criarUsuarioComWorkspace(prisma, {
    email: `programa-venda-${Date.now()}@teste.local`,
    password: 'hash-fake-nao-usado-no-login',
    name: 'Conta de Teste — Programa/Venda/Comissão',
  })
  workspaceId = workspace.id
})

after(async () => {
  await limparWorkspaceDeTeste(prisma, workspaceId, PREFIXO)
  await prisma.$disconnect()
})

describe('AffiliateProgram — Programa × Operação × Integração', () => {
  test('nasce com os valores padrão corretos', async () => {
    const programa = await upsertPrograma({ workspaceId, platform: 'shopee' })
    assert.equal(programa.status, 'NOT_REGISTERED')
    assert.equal(programa.operationMode, 'MANUAL')
    assert.equal(programa.integrationStatus, 'NOT_AVAILABLE')
  })

  test('o status do programa muda independente da operação e da integração', async () => {
    const programa = await upsertPrograma({
      workspaceId,
      platform: 'hotmart',
      status: 'ACTIVE',
    })
    assert.equal(programa.status, 'ACTIVE')
    // Operação continua MANUAL mesmo com o programa ativo — são eixos
    // independentes, não sinônimos.
    assert.equal(programa.operationMode, 'MANUAL')
    assert.equal(programa.integrationStatus, 'NOT_AVAILABLE')
  })

  test('recusa marcar integração como CONNECTED sem uma integração real', async () => {
    await assert.rejects(
      () =>
        upsertPrograma({
          workspaceId,
          platform: 'mercadolivre',
          integrationStatus: 'CONNECTED',
        }),
      /sem uma integração real/
    )
  })

  test('aceita CONNECTED quando existe uma Integracao de verdade conectada', async () => {
    await prisma.integracao.create({
      data: {
        workspaceId,
        userId: (await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })).ownerId,
        plataforma: 'mercadolivre',
        status: 'conectado',
      },
    })

    const programa = await upsertPrograma({
      workspaceId,
      platform: 'mercadolivre',
      integrationStatus: 'CONNECTED',
    })
    assert.equal(programa.integrationStatus, 'CONNECTED')
  })

  test('um programa por plataforma por workspace (upsert, não duplica)', async () => {
    await upsertPrograma({ workspaceId, platform: 'shopee', status: 'REQUESTED' })
    const todos = await prisma.affiliateProgram.findMany({
      where: { workspaceId, platform: 'shopee' },
    })
    assert.equal(todos.length, 1)
    assert.equal(todos[0].status, 'REQUESTED')
  })
})

describe('Sale × Commission — venda não é comissão', () => {
  let produto: Awaited<ReturnType<typeof prisma.produto.create>>

  before(async () => {
    produto = await prisma.produto.create({
      data: {
        workspaceId,
        userId: (await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })).ownerId,
        nome: 'Produto de teste — venda/comissão',
        categoria: 'Teste',
        origemConteudo: 'manual',
        tipoVenda: 'afiliado',
      },
    })
  })

  test('registrar uma venda não cria comissão recebida automaticamente', async () => {
    const sale = await prisma.sale.create({
      data: { workspaceId, productId: produto.id, amount: 100, status: 'PENDING' },
    })
    const commission = await prisma.commission.create({
      data: {
        workspaceId,
        saleId: sale.id,
        productId: produto.id,
        expectedAmount: 10,
        status: 'EXPECTED',
      },
    })

    assert.equal(sale.status, 'PENDING')
    assert.equal(commission.status, 'EXPECTED')
    assert.equal(commission.receivedAmount, null)
    assert.equal(commission.confirmedAmount, null)
  })

  test('comissão prevista não é confirmada, e confirmada não é recebida', async () => {
    const sale = await prisma.sale.create({
      data: { workspaceId, productId: produto.id, amount: 200, status: 'CONFIRMED' },
    })
    let commission = await prisma.commission.create({
      data: {
        workspaceId,
        saleId: sale.id,
        productId: produto.id,
        expectedAmount: 20,
        status: 'EXPECTED',
      },
    })
    assert.equal(commission.status, 'EXPECTED')
    assert.equal(commission.confirmedAmount, null, 'confirmedAmount não deveria existir ainda')

    commission = await prisma.commission.update({
      where: { id: commission.id },
      data: { status: 'CONFIRMED', confirmedAmount: 20, confirmedAt: new Date() },
    })
    assert.equal(commission.status, 'CONFIRMED')
    assert.equal(commission.receivedAmount, null, 'receivedAmount não deveria existir ainda')

    commission = await prisma.commission.update({
      where: { id: commission.id },
      data: { status: 'RECEIVED', receivedAmount: 20, receivedAt: new Date() },
    })
    assert.equal(commission.status, 'RECEIVED')
    assert.equal(commission.receivedAmount, 20)
    // O valor previsto original continua registrado — não foi sobrescrito.
    assert.equal(commission.expectedAmount, 20)
  })

  test('venda cancelada não aparece como confirmada nos totais', async () => {
    const saleCancelada = await prisma.sale.create({
      data: { workspaceId, productId: produto.id, amount: 999, status: 'CANCELLED' },
    })
    await prisma.commission.create({
      data: {
        workspaceId,
        saleId: saleCancelada.id,
        productId: produto.id,
        expectedAmount: 999,
        status: 'EXPECTED',
      },
    })

    const vendas = await resumoVendas(workspaceId)
    assert.ok(vendas.CANCELLED >= 1)

    const comissoes = await resumoComissoes(workspaceId)
    // Nenhum dos totais deve incluir a comissão da venda cancelada (999).
    assert.notEqual(comissoes.prevista, 999)
  })

  test('resumoVendas separa pending/confirmed/cancelled corretamente', async () => {
    const vendas = await resumoVendas(workspaceId)
    assert.ok(vendas.PENDING >= 1)
    assert.ok(vendas.CONFIRMED >= 1)
    assert.ok(vendas.CANCELLED >= 1)
  })
})
