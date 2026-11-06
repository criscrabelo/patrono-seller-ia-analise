/**
 * P0.2 Bloco 3.1 — promoção auditada contra Postgres real.
 *
 * Revisto na rodada de CONFIANÇA DA EVIDÊNCIA. Prova o que a regra pura não
 * alcança: a conferência do responsável e da comissão CONTRA O BANCO, a
 * transação tudo-ou-nada, a idempotência, o isolamento entre workspaces e a
 * revalidação pela autoridade única.
 *
 * NUNCA rodar contra produção.
 */

import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../lib/prisma'
import { registrarResultado } from '../lib/vendas-comissoes'
import { ACAO_AUDIT_EVIDENCIA } from '../lib/real-operation'
import {
  promoverPorCorrecaoManual,
  promoverPorEvidenciaVerificada,
  ACAO_AUDIT_PROMOCAO,
} from '../lib/promocao-operacao-real'
import {
  verificarEvidencia,
  registrarVerificadorDeEvidencia,
  limparVerificadoresDeEvidencia,
  type FonteVerificada,
} from '../lib/evidencia-verificada'

const TEM_BANCO = !!process.env.DATABASE_URL

let workspaceA = ''
let workspaceB = ''
let userA = ''
let userB = ''
let produtoA = ''
let produtoB = ''
const criados: string[] = []

async function limpar(ws: string) {
  await prisma.commission.deleteMany({ where: { workspaceId: ws } })
  await prisma.sale.deleteMany({ where: { workspaceId: ws } })
  await prisma.auditLog.deleteMany({ where: { workspaceId: ws } })
}

async function criarVenda(opcoes: {
  origem?: string
  statusVenda?: string
  statusComissao?: string
  workspaceId?: string
} = {}) {
  const ws = opcoes.workspaceId ?? workspaceA
  const { sale, commission } = await registrarResultado({
    workspaceId: ws,
    actorUserId: ws === workspaceA ? userA : userB,
    dataOrigin: 'TEST_FIXTURE',
    productId: ws === workspaceA ? produtoA : produtoB,
    amount: 100,
    status: 'CONFIRMED',
    expectedCommission: 10,
    idempotencyKey: `b31r-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  })
  await prisma.sale.update({
    where: { id: sale.id },
    data: { dataOrigin: opcoes.origem ?? 'USER_REPORTED', status: opcoes.statusVenda ?? 'CONFIRMED' },
  })
  if (opcoes.statusComissao) {
    await prisma.commission.update({
      where: { id: commission!.id },
      data: { status: opcoes.statusComissao },
    })
  }
  return { saleId: sale.id, commissionId: commission!.id }
}

const MOTIVO_OK = 'Repasse conferido no extrato bancário da conta da empresa.'
const REF_OK = 'extrato-banco-2026-09-18-linha-42'

/** Emite uma fonte legítima, como um adapter real faria. */
async function fonteDe(tipo: string, pedido: { workspaceId: string; saleId: string; commissionId?: string }) {
  registrarVerificadorDeEvidencia({
    id: `adapter-${tipo}`,
    tipo: tipo as never,
    async verificar(p) {
      return { referencia: `conferido-${p.saleId}`, detalhes: { via: `adapter-${tipo}` } }
    },
  })
  return (await verificarEvidencia(tipo as never, pedido))!
}

describe(
  'Bloco 3.1 no banco — confiança da evidência',
  { skip: !TEM_BANCO ? 'DATABASE_URL ausente — este arquivo exige Postgres' : false },
  () => {
    before(async () => {
      const marca = Date.now()
      for (const nome of ['A', 'B']) {
        const ws = await prisma.workspace.create({
          data: { name: `B31R-${nome}`, ownerId: `b31r-${nome}-${marca}` },
          select: { id: true },
        })
        criados.push(ws.id)
      }
      ;[workspaceA, workspaceB] = criados

      const criarUser = async (ws: string, sufixo: string) =>
        (
          await prisma.user.create({
            data: {
              email: `b31r-${sufixo}-${marca}@teste.local`,
              name: `Teste ${sufixo}`,
              password: 'nao-usada-neste-teste',
              workspaceId: ws,
            },
            select: { id: true },
          })
        ).id
      userA = await criarUser(workspaceA, 'a')
      userB = await criarUser(workspaceB, 'b')

      const criarProduto = async (ws: string, uid: string) =>
        (
          await prisma.produto.create({
            data: {
              workspaceId: ws,
              userId: uid,
              nome: 'Produto Bloco 3.1',
              categoria: 'casa',
              tipoVenda: 'Afiliado',
              origemConteudo: 'Proprio',
            },
            select: { id: true },
          })
        ).id
      produtoA = await criarProduto(workspaceA, userA)
      produtoB = await criarProduto(workspaceB, userB)
    })

    after(async () => {
      for (const ws of criados) await limpar(ws)
      await prisma.produto.deleteMany({ where: { workspaceId: { in: criados } } })
      await prisma.user.deleteMany({ where: { workspaceId: { in: criados } } })
      await prisma.workspace.deleteMany({ where: { id: { in: criados } } })
      await prisma.$disconnect()
    })

    beforeEach(() => limparVerificadoresDeEvidencia())

    // ── Correção manual: usuário conferido contra o banco ──────────────

    test('correção manual com usuário do MESMO workspace → aceita', async () => {
      await limpar(workspaceA)
      const { saleId } = await criarVenda({ statusComissao: 'CONFIRMED' })

      const r = await promoverPorCorrecaoManual({
        workspaceId: workspaceA,
        saleId,
        responsavelUserId: userA,
        motivo: MOTIVO_OK,
        referencia: REF_OK,
      })

      assert.equal(r.promovido, true, r.explicacao)
      assert.equal(r.origemAnterior, 'USER_REPORTED')
      assert.equal(r.origemNova, 'REAL_OPERATION')
      assert.equal(r.veredito?.elegivel, true, JSON.stringify(r.veredito?.motivos))

      const log = await prisma.auditLog.findFirst({
        where: { workspaceId: workspaceA, action: ACAO_AUDIT_EVIDENCIA, entityId: saleId },
        select: { metadata: true, userId: true },
      })
      assert.equal(log?.userId, userA)
      const meta = log?.metadata as Record<string, unknown>
      assert.equal(meta.tipo, 'CORRECAO_MANUAL_AUDITADA')
      assert.equal(meta.atorTipo, 'USUARIA')
      assert.equal(meta.motivo, MOTIVO_OK)
    })

    test('usuário INEXISTENTE → recusa, sem gravar nada', async () => {
      await limpar(workspaceA)
      const { saleId } = await criarVenda({ statusComissao: 'CONFIRMED' })

      const r = await promoverPorCorrecaoManual({
        workspaceId: workspaceA,
        saleId,
        responsavelUserId: 'user-que-nao-existe',
        motivo: MOTIVO_OK,
        referencia: REF_OK,
      })

      assert.equal(r.promovido, false)
      assert.equal(r.motivo, 'RESPONSAVEL_INVALIDO')
      const venda = await prisma.sale.findUnique({ where: { id: saleId }, select: { dataOrigin: true } })
      assert.equal(venda?.dataOrigin, 'USER_REPORTED')
      const logs = await prisma.auditLog.count({
        where: {
          workspaceId: workspaceA,
          entityId: saleId,
          // Só as ações da promoção: `venda.criada` do registro normal
          // existe desde sempre e não tem nada a ver com esta recusa.
          action: { in: [ACAO_AUDIT_EVIDENCIA, ACAO_AUDIT_PROMOCAO] },
        },
      })
      assert.equal(logs, 0)
    })

    test('usuário de OUTRO workspace → recusa', async () => {
      // A FK de AuditLog.userId aceitaria: o usuário existe. Ela não sabe de
      // qual negócio ele é. Por isso a conferência é explícita.
      await limpar(workspaceA)
      const { saleId } = await criarVenda({ statusComissao: 'CONFIRMED' })

      const r = await promoverPorCorrecaoManual({
        workspaceId: workspaceA,
        saleId,
        responsavelUserId: userB,
        motivo: MOTIVO_OK,
        referencia: REF_OK,
      })

      assert.equal(r.promovido, false)
      assert.equal(r.motivo, 'RESPONSAVEL_INVALIDO')
      const venda = await prisma.sale.findUnique({ where: { id: saleId }, select: { dataOrigin: true } })
      assert.equal(venda?.dataOrigin, 'USER_REPORTED')
    })

    test('correção manual sem motivo → recusa e não grava', async () => {
      await limpar(workspaceA)
      const { saleId } = await criarVenda({ statusComissao: 'CONFIRMED' })
      const r = await promoverPorCorrecaoManual({
        workspaceId: workspaceA,
        saleId,
        responsavelUserId: userA,
        motivo: '',
        referencia: REF_OK,
      })
      assert.equal(r.promovido, false)
      assert.equal(r.motivo, 'MOTIVO_AUSENTE')
      assert.equal(await prisma.auditLog.count({
        where: {
          workspaceId: workspaceA,
          entityId: saleId,
          // Só as ações da promoção: `venda.criada` do registro normal
          // existe desde sempre e não tem nada a ver com esta recusa.
          action: { in: [ACAO_AUDIT_EVIDENCIA, ACAO_AUDIT_PROMOCAO] },
        },
      }), 0)
    })

    test('correção manual sem referência → recusa', async () => {
      await limpar(workspaceA)
      const { saleId } = await criarVenda({ statusComissao: 'CONFIRMED' })
      const r = await promoverPorCorrecaoManual({
        workspaceId: workspaceA,
        saleId,
        responsavelUserId: userA,
        motivo: MOTIVO_OK,
        referencia: '   ',
      })
      assert.equal(r.promovido, false)
      assert.equal(r.motivo, 'REFERENCIA_AUSENTE')
    })

    // ── Evidência de sistema: só com fonte verificada ──────────────────

    test('PROVIDER_OFICIAL fabricado por chamada comum → recusa', async () => {
      await limpar(workspaceA)
      const { saleId } = await criarVenda({ statusComissao: 'CONFIRMED' })

      const forjada = {
        tipo: 'PROVIDER_OFICIAL',
        referencia: 'webhook-123',
        verificadorId: 'tiktok',
        verificadaEm: new Date(),
        detalhes: {},
      } as unknown as FonteVerificada

      const r = await promoverPorEvidenciaVerificada({ workspaceId: workspaceA, saleId, fonte: forjada })
      assert.equal(r.promovido, false)
      assert.equal(r.motivo, 'FONTE_NAO_VERIFICADA')
      const venda = await prisma.sale.findUnique({ where: { id: saleId }, select: { dataOrigin: true } })
      assert.equal(venda?.dataOrigin, 'USER_REPORTED')
      assert.equal(await prisma.auditLog.count({
        where: {
          workspaceId: workspaceA,
          entityId: saleId,
          // Só as ações da promoção: `venda.criada` do registro normal
          // existe desde sempre e não tem nada a ver com esta recusa.
          action: { in: [ACAO_AUDIT_EVIDENCIA, ACAO_AUDIT_PROMOCAO] },
        },
      }), 0)
    })

    test('CONCILIACAO_FINANCEIRA sem prova verificável → recusa', async () => {
      await limpar(workspaceA)
      const { saleId } = await criarVenda({ statusComissao: 'CONFIRMED' })
      const forjada = {
        tipo: 'CONCILIACAO_FINANCEIRA',
        referencia: 'repasse-123',
        verificadorId: 'x',
        verificadaEm: new Date(),
        detalhes: {},
      } as unknown as FonteVerificada
      const r = await promoverPorEvidenciaVerificada({ workspaceId: workspaceA, saleId, fonte: forjada })
      assert.equal(r.promovido, false)
      assert.equal(r.motivo, 'FONTE_NAO_VERIFICADA')
    })

    test('provider com evidência previamente verificada → aceita', async () => {
      await limpar(workspaceA)
      const { saleId } = await criarVenda({ statusComissao: 'RECEIVED' })
      const fonte = await fonteDe('PROVIDER_OFICIAL', { workspaceId: workspaceA, saleId })

      const r = await promoverPorEvidenciaVerificada({ workspaceId: workspaceA, saleId, fonte })
      assert.equal(r.promovido, true, r.explicacao)
      assert.equal(r.veredito?.elegivel, true, JSON.stringify(r.veredito?.motivos))

      const log = await prisma.auditLog.findFirst({
        where: { workspaceId: workspaceA, action: ACAO_AUDIT_PROMOCAO, entityId: saleId },
        select: { metadata: true, userId: true },
      })
      const meta = log?.metadata as Record<string, unknown>
      assert.equal(meta.atorTipo, 'VERIFICADOR')
      assert.equal(meta.verificadorId, 'adapter-PROVIDER_OFICIAL')
      assert.equal(log?.userId, null, 'evidência de sistema não tem usuária responsável')
    })

    test('conciliação verificada → aceita', async () => {
      await limpar(workspaceA)
      const { saleId } = await criarVenda({ statusComissao: 'RECEIVED' })
      const fonte = await fonteDe('CONCILIACAO_FINANCEIRA', { workspaceId: workspaceA, saleId })
      const r = await promoverPorEvidenciaVerificada({ workspaceId: workspaceA, saleId, fonte })
      assert.equal(r.promovido, true, r.explicacao)
    })

    // ── Comissão vinculada à evidência ─────────────────────────────────

    test('comissão confirmada SEM commissionId no pedido → recusa', async () => {
      await limpar(workspaceA)
      const { saleId, commissionId } = await criarVenda({ statusComissao: 'CONFIRMED' })
      // A fonte é emitida corretamente vinculada à comissão; quem esquece de
      // informar qual comissão é o PEDIDO de promoção.
      const fonte = await fonteDe('COMISSAO_CONFIRMADA_COM_ORIGEM_VERIFICAVEL', {
        workspaceId: workspaceA,
        saleId,
        commissionId,
      })
      const r = await promoverPorEvidenciaVerificada({ workspaceId: workspaceA, saleId, fonte })
      assert.equal(r.promovido, false)
      assert.equal(r.motivo, 'COMISSAO_NAO_INFORMADA')
    })

    test('comissão de OUTRA Sale → recusa', async () => {
      await limpar(workspaceA)
      const alvo = await criarVenda({ statusComissao: 'CONFIRMED' })
      const outra = await criarVenda({ statusComissao: 'RECEIVED' })
      // A fonte é emitida JÁ vinculada à comissão alheia, então a
      // correspondência passa e quem recusa é a conferência no banco: essa
      // comissão não pertence a esta venda.
      const fonte = await fonteDe('COMISSAO_CONFIRMADA_COM_ORIGEM_VERIFICAVEL', {
        workspaceId: workspaceA,
        saleId: alvo.saleId,
        commissionId: outra.commissionId,
      })

      const r = await promoverPorEvidenciaVerificada({
        workspaceId: workspaceA,
        saleId: alvo.saleId,
        fonte,
        commissionId: outra.commissionId,
      })
      assert.equal(r.promovido, false)
      assert.equal(r.motivo, 'COMISSAO_NAO_COMPROVADA')
      const venda = await prisma.sale.findUnique({ where: { id: alvo.saleId }, select: { dataOrigin: true } })
      assert.equal(venda?.dataOrigin, 'USER_REPORTED')
    })

    test('comissão de OUTRO workspace → recusa', async () => {
      await limpar(workspaceA)
      await limpar(workspaceB)
      const alvo = await criarVenda({ statusComissao: 'CONFIRMED' })
      const alheia = await criarVenda({ statusComissao: 'RECEIVED', workspaceId: workspaceB })
      const fonte = await fonteDe('COMISSAO_CONFIRMADA_COM_ORIGEM_VERIFICAVEL', {
        workspaceId: workspaceA,
        saleId: alvo.saleId,
        commissionId: alheia.commissionId,
      })

      const r = await promoverPorEvidenciaVerificada({
        workspaceId: workspaceA,
        saleId: alvo.saleId,
        fonte,
        commissionId: alheia.commissionId,
      })
      assert.equal(r.promovido, false)
      assert.equal(r.motivo, 'COMISSAO_NAO_COMPROVADA')
    })

    test('comissão apenas EXPECTED → recusa', async () => {
      await limpar(workspaceA)
      const { saleId, commissionId } = await criarVenda()
      const fonte = await fonteDe('COMISSAO_CONFIRMADA_COM_ORIGEM_VERIFICAVEL', {
        workspaceId: workspaceA,
        saleId,
        commissionId,
      })
      const r = await promoverPorEvidenciaVerificada({ workspaceId: workspaceA, saleId, fonte, commissionId })
      assert.equal(r.promovido, false)
      assert.equal(r.motivo, 'COMISSAO_NAO_COMPROVADA')
    })

    test('comissão correta + fonte verificável → aceita, e o id fica na auditoria', async () => {
      await limpar(workspaceA)
      const { saleId, commissionId } = await criarVenda({ statusComissao: 'RECEIVED' })
      const fonte = await fonteDe('COMISSAO_CONFIRMADA_COM_ORIGEM_VERIFICAVEL', {
        workspaceId: workspaceA,
        saleId,
        commissionId,
      })

      const r = await promoverPorEvidenciaVerificada({ workspaceId: workspaceA, saleId, fonte, commissionId })
      assert.equal(r.promovido, true, r.explicacao)
      assert.equal(r.evidencia?.commissionId, commissionId)

      const log = await prisma.auditLog.findFirst({
        where: { workspaceId: workspaceA, action: ACAO_AUDIT_EVIDENCIA, entityId: saleId },
        select: { metadata: true },
      })
      assert.equal((log?.metadata as Record<string, unknown>).commissionId, commissionId)
    })

    // ── Origem sintética ───────────────────────────────────────────────

    for (const origem of ['SEED', 'TEST_FIXTURE', 'DEMO', 'SYNTHETIC_TEST']) {
      test(`${origem} continua impossível de promover, pelos dois caminhos`, async () => {
        await limpar(workspaceA)
        const { saleId } = await criarVenda({ origem, statusComissao: 'RECEIVED' })

        const manual = await promoverPorCorrecaoManual({
          workspaceId: workspaceA,
          saleId,
          responsavelUserId: userA,
          motivo: MOTIVO_OK,
          referencia: REF_OK,
        })
        assert.equal(manual.promovido, false)
        assert.equal(manual.motivo, 'ORIGEM_SINTETICA_NAO_PROMOVIVEL')

        const fonte = await fonteDe('PROVIDER_OFICIAL', { workspaceId: workspaceA, saleId })
        const sistema = await promoverPorEvidenciaVerificada({ workspaceId: workspaceA, saleId, fonte })
        assert.equal(sistema.promovido, false)
        assert.equal(sistema.motivo, 'ORIGEM_SINTETICA_NAO_PROMOVIVEL')

        const venda = await prisma.sale.findUnique({ where: { id: saleId }, select: { dataOrigin: true } })
        assert.equal(venda?.dataOrigin, origem)
      })
    }

    // ── Multi-workspace ────────────────────────────────────────────────

    test('venda de OUTRO workspace → bloqueia, sem tocar em nada', async () => {
      await limpar(workspaceA)
      await limpar(workspaceB)
      const { saleId } = await criarVenda({ statusComissao: 'CONFIRMED' })

      const r = await promoverPorCorrecaoManual({
        workspaceId: workspaceB,
        saleId,
        responsavelUserId: userB,
        motivo: MOTIVO_OK,
        referencia: REF_OK,
      })
      assert.equal(r.promovido, false)
      assert.equal(r.motivo, 'VENDA_NAO_ENCONTRADA')

      const venda = await prisma.sale.findUnique({ where: { id: saleId }, select: { dataOrigin: true } })
      assert.equal(venda?.dataOrigin, 'USER_REPORTED')
      assert.equal(await prisma.auditLog.count({ where: { workspaceId: workspaceB } }), 0)
    })

    test('saleId sem workspaceId → bloqueia', async () => {
      const r = await promoverPorCorrecaoManual({
        workspaceId: '',
        saleId: 'qualquer',
        responsavelUserId: userA,
        motivo: MOTIVO_OK,
        referencia: REF_OK,
      })
      assert.equal(r.promovido, false)
      assert.equal(r.motivo, 'WORKSPACE_AUSENTE')
    })

    // ── Promover ≠ ser elegível ────────────────────────────────────────

    test('promoção + venda PENDING → promovida, mas NÃO elegível', async () => {
      await limpar(workspaceA)
      const { saleId } = await criarVenda({ statusVenda: 'PENDING', statusComissao: 'RECEIVED' })
      const r = await promoverPorCorrecaoManual({
        workspaceId: workspaceA,
        saleId,
        responsavelUserId: userA,
        motivo: MOTIVO_OK,
        referencia: REF_OK,
      })
      assert.equal(r.promovido, true, r.explicacao)
      assert.equal(r.veredito?.elegivel, false)
      assert.ok(r.veredito?.motivos.includes('VENDA_NAO_CONFIRMADA'))
    })

    test('promoção + comissão EXPECTED → promovida, mas NÃO elegível', async () => {
      await limpar(workspaceA)
      const { saleId } = await criarVenda()
      const r = await promoverPorCorrecaoManual({
        workspaceId: workspaceA,
        saleId,
        responsavelUserId: userA,
        motivo: MOTIVO_OK,
        referencia: REF_OK,
      })
      assert.equal(r.promovido, true, r.explicacao)
      assert.equal(r.veredito?.elegivel, false)
      assert.ok(r.veredito?.motivos.includes('SEM_COMISSAO_RECONHECIDA'))
    })

    // ── Idempotência ───────────────────────────────────────────────────

    test('a MESMA evidência aplicada duas vezes é idempotente', async () => {
      await limpar(workspaceA)
      const { saleId } = await criarVenda({ statusComissao: 'CONFIRMED' })
      const pedido = {
        workspaceId: workspaceA,
        saleId,
        responsavelUserId: userA,
        motivo: MOTIVO_OK,
        referencia: REF_OK,
      }

      const primeira = await promoverPorCorrecaoManual(pedido)
      const segunda = await promoverPorCorrecaoManual(pedido)

      assert.equal(primeira.promovido, true)
      assert.equal(segunda.promovido, false)
      assert.equal(segunda.idempotente, true)
      assert.equal(segunda.motivo, null)
      assert.equal(segunda.veredito?.elegivel, true)

      assert.equal(
        await prisma.auditLog.count({
          where: { workspaceId: workspaceA, action: ACAO_AUDIT_EVIDENCIA, entityId: saleId },
        }),
        1
      )
      assert.equal(
        await prisma.auditLog.count({
          where: { workspaceId: workspaceA, action: ACAO_AUDIT_PROMOCAO, entityId: saleId },
        }),
        1
      )
    })

    test('duas entregas SIMULTÂNEAS da mesma evidência promovem uma só vez', async () => {
      await limpar(workspaceA)
      const { saleId } = await criarVenda({ statusComissao: 'CONFIRMED' })
      const pedido = {
        workspaceId: workspaceA,
        saleId,
        responsavelUserId: userA,
        motivo: MOTIVO_OK,
        referencia: REF_OK,
      }

      const [a, b] = await Promise.all([
        promoverPorCorrecaoManual(pedido),
        promoverPorCorrecaoManual(pedido),
      ])
      assert.equal([a, b].filter((r) => r.promovido).length, 1)
      assert.equal(
        await prisma.auditLog.count({
          where: { workspaceId: workspaceA, action: ACAO_AUDIT_EVIDENCIA, entityId: saleId },
        }),
        1
      )
    })

    test('venda já REAL_OPERATION → recusa com motivo próprio', async () => {
      await limpar(workspaceA)
      const { saleId } = await criarVenda({ origem: 'REAL_OPERATION', statusComissao: 'RECEIVED' })
      const r = await promoverPorCorrecaoManual({
        workspaceId: workspaceA,
        saleId,
        responsavelUserId: userA,
        motivo: MOTIVO_OK,
        referencia: REF_OK,
      })
      assert.equal(r.promovido, false)
      assert.equal(r.motivo, 'JA_ERA_OPERACAO_REAL')
    })

    // ── Fechamento ─────────────────────────────────────────────────────

    test('nenhum MLFeatureSnapshot foi criado por esta rodada', async () => {
      assert.equal(await prisma.mLFeatureSnapshot.count({ where: { workspaceId: { in: criados } } }), 0)
    })

    test('o primeiro REAL_OPERATION legítimo: manual auditada, comprovada e elegível', async () => {
      await limpar(workspaceA)
      const { saleId } = await criarVenda({ statusComissao: 'RECEIVED' })
      const r = await promoverPorCorrecaoManual({
        workspaceId: workspaceA,
        saleId,
        responsavelUserId: userA,
        motivo: 'Comissão recebida e conferida no extrato bancário da empresa.',
        referencia: REF_OK,
      })
      assert.equal(r.promovido, true, r.explicacao)
      assert.equal(r.veredito?.elegivel, true, JSON.stringify(r.veredito?.motivos))
      assert.equal(
        await prisma.sale.count({ where: { workspaceId: workspaceA, dataOrigin: 'REAL_OPERATION' } }),
        1
      )
    })
    // ── Vinculo com o alvo: sem replay entre vendas e workspaces ────────

    test('fonte da Sale A usada na Sale A → aceita', async () => {
      await limpar(workspaceA)
      const { saleId } = await criarVenda({ statusComissao: 'RECEIVED' })
      const fonte = await fonteDe('PROVIDER_OFICIAL', { workspaceId: workspaceA, saleId })

      const r = await promoverPorEvidenciaVerificada({ workspaceId: workspaceA, saleId, fonte })
      assert.equal(r.promovido, true, r.explicacao)
    })

    test('fonte da Sale A usada na Sale B → recusa', async () => {
      await limpar(workspaceA)
      const a = await criarVenda({ statusComissao: 'RECEIVED' })
      const b = await criarVenda({ statusComissao: 'RECEIVED' })
      const fonte = await fonteDe('PROVIDER_OFICIAL', { workspaceId: workspaceA, saleId: a.saleId })

      const r = await promoverPorEvidenciaVerificada({ workspaceId: workspaceA, saleId: b.saleId, fonte })
      assert.equal(r.promovido, false)
      assert.equal(r.motivo, 'FONTE_NAO_CORRESPONDE_AO_ALVO')

      const venda = await prisma.sale.findUnique({ where: { id: b.saleId }, select: { dataOrigin: true } })
      assert.equal(venda?.dataOrigin, 'USER_REPORTED')
    })

    test('fonte do workspace A usada no workspace B → recusa', async () => {
      await limpar(workspaceA)
      await limpar(workspaceB)
      const a = await criarVenda({ statusComissao: 'RECEIVED' })
      const b = await criarVenda({ statusComissao: 'RECEIVED', workspaceId: workspaceB })
      const fonte = await fonteDe('PROVIDER_OFICIAL', { workspaceId: workspaceA, saleId: a.saleId })

      // Mesmo apontando a venda certa do outro workspace, a fonte nao vale.
      const r = await promoverPorEvidenciaVerificada({ workspaceId: workspaceB, saleId: b.saleId, fonte })
      assert.equal(r.promovido, false)
      assert.equal(r.motivo, 'FONTE_NAO_CORRESPONDE_AO_ALVO')

      const venda = await prisma.sale.findUnique({ where: { id: b.saleId }, select: { dataOrigin: true } })
      assert.equal(venda?.dataOrigin, 'USER_REPORTED')
      assert.equal(
        await prisma.auditLog.count({
          where: { workspaceId: workspaceB, action: { in: [ACAO_AUDIT_EVIDENCIA, ACAO_AUDIT_PROMOCAO] } },
        }),
        0
      )
    })

    test('fonte da comissao X usada com a comissao Y → recusa, mesma Sale', async () => {
      await limpar(workspaceA)
      const { saleId, commissionId } = await criarVenda({ statusComissao: 'RECEIVED' })
      // Segunda comissao RECEIVED na MESMA venda.
      const outraComissao = await prisma.commission.create({
        data: {
          workspaceId: workspaceA,
          saleId,
          productId: produtoA,
          status: 'RECEIVED',
          receivedAmount: 5,
        },
        select: { id: true },
      })

      const fonte = await fonteDe('COMISSAO_CONFIRMADA_COM_ORIGEM_VERIFICAVEL', {
        workspaceId: workspaceA,
        saleId,
        commissionId,
      })

      const r = await promoverPorEvidenciaVerificada({
        workspaceId: workspaceA,
        saleId,
        fonte,
        commissionId: outraComissao.id,
      })
      assert.equal(r.promovido, false)
      assert.equal(r.motivo, 'FONTE_NAO_CORRESPONDE_AO_ALVO')

      const venda = await prisma.sale.findUnique({ where: { id: saleId }, select: { dataOrigin: true } })
      assert.equal(venda?.dataOrigin, 'USER_REPORTED')
    })

    test('fonte correta da comissao X → aceita, e o alvo vai para a auditoria', async () => {
      await limpar(workspaceA)
      const { saleId, commissionId } = await criarVenda({ statusComissao: 'RECEIVED' })
      const fonte = await fonteDe('COMISSAO_CONFIRMADA_COM_ORIGEM_VERIFICAVEL', {
        workspaceId: workspaceA,
        saleId,
        commissionId,
      })

      const r = await promoverPorEvidenciaVerificada({ workspaceId: workspaceA, saleId, fonte, commissionId })
      assert.equal(r.promovido, true, r.explicacao)

      const log = await prisma.auditLog.findFirst({
        where: { workspaceId: workspaceA, action: ACAO_AUDIT_EVIDENCIA, entityId: saleId },
        select: { metadata: true },
      })
      const meta = log?.metadata as Record<string, unknown>
      assert.equal(meta.workspaceIdVerificado, workspaceA)
      assert.equal(meta.saleIdVerificado, saleId)
      assert.equal(meta.commissionIdVerificado, commissionId)
      assert.equal(meta.verificadorId, 'adapter-COMISSAO_CONFIRMADA_COM_ORIGEM_VERIFICAVEL')
      assert.ok(typeof meta.verificadaEm === 'string')
      // Nunca credencial.
      for (const chave of Object.keys(meta)) {
        assert.ok(!/token|senha|password|secret|apiKey/i.test(chave), `metadata nao pode ter ${chave}`)
      }
    })

    test('idempotencia da fonte correta continua funcionando', async () => {
      await limpar(workspaceA)
      const { saleId } = await criarVenda({ statusComissao: 'RECEIVED' })
      const fonte = await fonteDe('PROVIDER_OFICIAL', { workspaceId: workspaceA, saleId })

      const primeira = await promoverPorEvidenciaVerificada({ workspaceId: workspaceA, saleId, fonte })
      const segunda = await promoverPorEvidenciaVerificada({ workspaceId: workspaceA, saleId, fonte })

      assert.equal(primeira.promovido, true, primeira.explicacao)
      assert.equal(segunda.promovido, false)
      assert.equal(segunda.idempotente, true)
      assert.equal(segunda.motivo, null)
      assert.equal(
        await prisma.auditLog.count({
          where: { workspaceId: workspaceA, action: ACAO_AUDIT_EVIDENCIA, entityId: saleId },
        }),
        1
      )
    })
  }
)
