/**
 * P0.2 Bloco 3 — o que só o banco prova.
 *
 * A REGRA já é testada sem Postgres em
 * `rodada19-elegibilidade-operacao-real.test.ts`. Aqui provamos a outra
 * metade: que o retrato lido do banco (venda, comissões, workspaces
 * relacionados e evidência no AuditLog) chega correto até a regra, e que o
 * workspace é respeitado como fronteira na leitura.
 *
 * NUNCA rodar contra produção.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../lib/prisma'
import { registrarResultado } from '../lib/vendas-comissoes'
import { avaliarVendaParaOperacaoReal, ACAO_AUDIT_EVIDENCIA } from '../lib/real-operation'

const TEM_BANCO = !!process.env.DATABASE_URL

let workspaceA = ''
let workspaceB = ''
let userId = ''
let produtoA = ''
let linkA = ''
const criados: string[] = []

async function limpar(ws: string) {
  await prisma.commission.deleteMany({ where: { workspaceId: ws } })
  await prisma.sale.deleteMany({ where: { workspaceId: ws } })
  await prisma.eventoLink.deleteMany({ where: { workspaceId: ws } })
  await prisma.auditLog.deleteMany({ where: { workspaceId: ws } })
}

/**
 * Cria a venda pelo caminho normal e depois ajusta `dataOrigin` direto no
 * banco. O ajuste direto é proposital: NENHUM código de produção pode
 * gravar REAL_OPERATION, então a única forma de montar o cenário elegível é
 * simulando o que a futura promoção auditada fará.
 */
async function vendaComOrigem(origem: string, over: Record<string, unknown> = {}) {
  const { sale, commission } = await registrarResultado({
    workspaceId: workspaceA,
    actorUserId: userId,
    dataOrigin: 'TEST_FIXTURE',
    productId: produtoA,
    linkId: linkA,
    amount: 100,
    status: 'CONFIRMED',
    expectedCommission: 10,
    idempotencyKey: `b3-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  })
  await prisma.sale.update({ where: { id: sale.id }, data: { dataOrigin: origem, ...over } })
  return { saleId: sale.id, commissionId: commission!.id }
}

async function gravarEvidencia(saleId: string, metadata: Record<string, unknown>, ws = workspaceA) {
  await prisma.auditLog.create({
    data: {
      workspaceId: ws,
      action: ACAO_AUDIT_EVIDENCIA,
      entityType: 'Sale',
      entityId: saleId,
      metadata: metadata as never,
    },
  })
}

const EVIDENCIA_OK = { tipo: 'PROVIDER_OFICIAL', referencia: 'webhook-evt-teste' }

describe(
  'Bloco 3 no banco — elegibilidade lida da fonte de verdade',
  { skip: !TEM_BANCO ? 'DATABASE_URL ausente — este arquivo exige Postgres' : false },
  () => {
    before(async () => {
      const marca = Date.now()
      for (const nome of ['A', 'B']) {
        const ws = await prisma.workspace.create({
          data: { name: `B3-${nome}`, ownerId: `b3-${nome}-${marca}` },
          select: { id: true },
        })
        criados.push(ws.id)
      }
      ;[workspaceA, workspaceB] = criados

      userId = (
        await prisma.user.create({
          data: {
            email: `b3-${marca}@teste.local`,
            name: 'Teste Bloco 3',
            password: 'nao-usada-neste-teste',
            workspaceId: workspaceA,
          },
          select: { id: true },
        })
      ).id

      produtoA = (
        await prisma.produto.create({
          data: {
            workspaceId: workspaceA,
            userId,
            nome: 'Produto Bloco 3',
            categoria: 'casa',
            tipoVenda: 'Afiliado',
            origemConteudo: 'Proprio',
          },
          select: { id: true },
        })
      ).id

      linkA = (
        await prisma.linkDinamico.create({
          data: {
            workspaceId: workspaceA,
            userId,
            produtoId: produtoA,
            slug: `b3-a-${marca}`,
            plataforma: 'tiktok',
            urlDestino: 'https://exemplo.invalido/produto',
          },
          select: { id: true },
        })
      ).id
    })

    after(async () => {
      for (const ws of criados) await limpar(ws)
      await prisma.linkDinamico.deleteMany({ where: { workspaceId: { in: criados } } })
      await prisma.produto.deleteMany({ where: { workspaceId: { in: criados } } })
      await prisma.user.deleteMany({ where: { workspaceId: { in: criados } } })
      await prisma.workspace.deleteMany({ where: { id: { in: criados } } })
      await prisma.$disconnect()
    })

    test('venda real + comissão CONFIRMED + evidência gravada → ELEGÍVEL', async () => {
      await limpar(workspaceA)
      const { saleId, commissionId } = await vendaComOrigem('REAL_OPERATION')
      await prisma.commission.update({ where: { id: commissionId }, data: { status: 'CONFIRMED' } })
      await gravarEvidencia(saleId, EVIDENCIA_OK)

      const v = await avaliarVendaParaOperacaoReal(workspaceA, saleId)
      assert.equal(v?.elegivel, true, JSON.stringify(v?.motivos))
      assert.equal(v?.evidenciaUtilizada, 'PROVIDER_OFICIAL')
      assert.deepEqual(v?.statusDasComissoes, ['CONFIRMED'])
    })

    test('venda real + comissão RECEIVED + evidência → ELEGÍVEL', async () => {
      await limpar(workspaceA)
      const { saleId, commissionId } = await vendaComOrigem('REAL_OPERATION')
      await prisma.commission.update({ where: { id: commissionId }, data: { status: 'RECEIVED' } })
      await gravarEvidencia(saleId, EVIDENCIA_OK)

      const v = await avaliarVendaParaOperacaoReal(workspaceA, saleId)
      assert.equal(v?.elegivel, true, JSON.stringify(v?.motivos))
    })

    test('comissão apenas EXPECTED → NÃO elegível', async () => {
      await limpar(workspaceA)
      const { saleId } = await vendaComOrigem('REAL_OPERATION')
      await gravarEvidencia(saleId, EVIDENCIA_OK)

      const v = await avaliarVendaParaOperacaoReal(workspaceA, saleId)
      assert.equal(v?.elegivel, false)
      assert.ok(v?.motivos.includes('SEM_COMISSAO_RECONHECIDA'))
    })

    test('venda PENDING → NÃO elegível', async () => {
      await limpar(workspaceA)
      const { saleId, commissionId } = await vendaComOrigem('REAL_OPERATION', { status: 'PENDING' })
      await prisma.commission.update({ where: { id: commissionId }, data: { status: 'RECEIVED' } })
      await gravarEvidencia(saleId, EVIDENCIA_OK)

      const v = await avaliarVendaParaOperacaoReal(workspaceA, saleId)
      assert.equal(v?.elegivel, false)
      assert.ok(v?.motivos.includes('VENDA_NAO_CONFIRMADA'))
    })

    test('venda CANCELLED → NÃO elegível', async () => {
      await limpar(workspaceA)
      const { saleId, commissionId } = await vendaComOrigem('REAL_OPERATION', { status: 'CANCELLED' })
      await prisma.commission.update({ where: { id: commissionId }, data: { status: 'RECEIVED' } })
      await gravarEvidencia(saleId, EVIDENCIA_OK)

      const v = await avaliarVendaParaOperacaoReal(workspaceA, saleId)
      assert.equal(v?.elegivel, false)
      assert.ok(v?.motivos.includes('VENDA_NAO_CONFIRMADA'))
    })

    test('USER_REPORTED com comissão CONFIRMED pela tela → NÃO elegível', async () => {
      // O caso central: a comissão foi confirmada pelo mesmo caminho manual
      // que criou a venda. Não há fonte externa nenhuma no meio.
      await limpar(workspaceA)
      const { saleId, commissionId } = await vendaComOrigem('USER_REPORTED')
      await prisma.commission.update({ where: { id: commissionId }, data: { status: 'CONFIRMED' } })

      const v = await avaliarVendaParaOperacaoReal(workspaceA, saleId)
      assert.equal(v?.elegivel, false)
      assert.ok(v?.motivos.includes('ORIGEM_NAO_E_OPERACAO_REAL'))
      assert.ok(v?.motivos.includes('SEM_EVIDENCIA_CONFIAVEL'))
    })

    for (const origem of ['UNVERIFIED', 'SEED', 'TEST_FIXTURE', 'DEMO', 'SYNTHETIC_TEST']) {
      test(`${origem} com tudo o mais perfeito → NÃO elegível`, async () => {
        await limpar(workspaceA)
        const { saleId, commissionId } = await vendaComOrigem(origem)
        await prisma.commission.update({ where: { id: commissionId }, data: { status: 'RECEIVED' } })
        await gravarEvidencia(saleId, EVIDENCIA_OK)

        const v = await avaliarVendaParaOperacaoReal(workspaceA, saleId)
        assert.equal(v?.elegivel, false)
        assert.ok(v?.motivos.includes('ORIGEM_NAO_E_OPERACAO_REAL'))
      })
    }

    test('comissão SEM saleId não torna a venda elegível', async () => {
      await limpar(workspaceA)
      const { saleId, commissionId } = await vendaComOrigem('REAL_OPERATION')
      await gravarEvidencia(saleId, EVIDENCIA_OK)
      // Comissão órfã, RECEIVED, no mesmo workspace — nada disso a salva.
      await prisma.commission.create({
        data: { workspaceId: workspaceA, productId: produtoA, status: 'RECEIVED', receivedAmount: 50 },
      })
      await prisma.commission.delete({ where: { id: commissionId } })

      const v = await avaliarVendaParaOperacaoReal(workspaceA, saleId)
      assert.equal(v?.elegivel, false)
      assert.ok(v?.motivos.includes('SEM_COMISSAO_RECONHECIDA'))
      assert.deepEqual(v?.statusDasComissoes, [], 'comissão órfã não entra no retrato da venda')
    })

    test('SEM evidência gravada → NÃO elegível, mesmo com origem REAL_OPERATION', async () => {
      await limpar(workspaceA)
      const { saleId, commissionId } = await vendaComOrigem('REAL_OPERATION')
      await prisma.commission.update({ where: { id: commissionId }, data: { status: 'RECEIVED' } })

      const v = await avaliarVendaParaOperacaoReal(workspaceA, saleId)
      assert.equal(v?.elegivel, false)
      assert.deepEqual(v?.motivos, ['SEM_EVIDENCIA_CONFIAVEL'])
    })

    test('evidência mal formada no AuditLog é descartada', async () => {
      await limpar(workspaceA)
      const { saleId, commissionId } = await vendaComOrigem('REAL_OPERATION')
      await prisma.commission.update({ where: { id: commissionId }, data: { status: 'RECEIVED' } })
      await gravarEvidencia(saleId, { tipo: 'PROVIDER_OFICIAL' }) // sem referência
      await gravarEvidencia(saleId, { tipo: 'INVENTADO', referencia: 'x' })

      const v = await avaliarVendaParaOperacaoReal(workspaceA, saleId)
      assert.equal(v?.elegivel, false)
      assert.ok(v?.motivos.includes('SEM_EVIDENCIA_CONFIAVEL'))
    })

    test('evidência gravada em OUTRO workspace não vale para esta venda', async () => {
      await limpar(workspaceA)
      await limpar(workspaceB)
      const { saleId, commissionId } = await vendaComOrigem('REAL_OPERATION')
      await prisma.commission.update({ where: { id: commissionId }, data: { status: 'RECEIVED' } })
      await gravarEvidencia(saleId, EVIDENCIA_OK, workspaceB)

      const v = await avaliarVendaParaOperacaoReal(workspaceA, saleId)
      assert.equal(v?.elegivel, false)
      assert.ok(v?.motivos.includes('SEM_EVIDENCIA_CONFIAVEL'))
    })

    test('a leitura respeita o workspace como fronteira', async () => {
      await limpar(workspaceA)
      const { saleId } = await vendaComOrigem('REAL_OPERATION')
      // Pedir a venda de A usando o workspace B devolve null, nunca o dado.
      assert.equal(await avaliarVendaParaOperacaoReal(workspaceB, saleId), null)
      assert.ok(await avaliarVendaParaOperacaoReal(workspaceA, saleId))
    })

    test('venda inexistente devolve null, não um veredito otimista', async () => {
      assert.equal(await avaliarVendaParaOperacaoReal(workspaceA, 'venda-que-nao-existe'), null)
    })

    test('a avaliação NÃO escreve nada no banco', async () => {
      await limpar(workspaceA)
      const { saleId } = await vendaComOrigem('REAL_OPERATION')
      const antes = {
        sales: await prisma.sale.count({ where: { workspaceId: workspaceA } }),
        logs: await prisma.auditLog.count({ where: { workspaceId: workspaceA } }),
        snapshots: await prisma.mLFeatureSnapshot.count({ where: { workspaceId: workspaceA } }),
      }
      await avaliarVendaParaOperacaoReal(workspaceA, saleId)
      assert.equal(await prisma.sale.count({ where: { workspaceId: workspaceA } }), antes.sales)
      assert.equal(await prisma.auditLog.count({ where: { workspaceId: workspaceA } }), antes.logs)
      assert.equal(await prisma.mLFeatureSnapshot.count({ where: { workspaceId: workspaceA } }), antes.snapshots)
    })

    test('nenhum MLFeatureSnapshot foi criado por esta rodada', async () => {
      const n = await prisma.mLFeatureSnapshot.count({ where: { workspaceId: { in: criados } } })
      assert.equal(n, 0)
    })
  }
)
