/**
 * P0.2 Bloco 4 — ligação segura ao Feature Store, contra Postgres real.
 *
 * Prova a cadeia inteira: só venda aprovada pela autoridade vira amostra de
 * produção; reprocessar não duplica; workspace é fronteira; e o readiness
 * gate conta o que deve contar.
 *
 * NUNCA rodar contra produção.
 */

import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../lib/prisma'
import { registrarResultado } from '../lib/vendas-comissoes'
import { promoverPorCorrecaoManual } from '../lib/promocao-operacao-real'
import { registrarOperacaoRealNoFeatureStore, ENTIDADE_DA_AMOSTRA } from '../lib/ml-operacao-real'
import { FEATURE_VERSION, salvarFeatureSnapshot, registrarLabelNoSnapshot } from '../lib/ml-feature-store'
import { contarAmostrasRotuladas } from '../lib/ml-readiness-gate'
import { limparVerificadoresDeEvidencia } from '../lib/evidencia-verificada'
import { capturarSnapshotDePublicacao } from '../lib/ml-captura-publicacao'

const TEM_BANCO = !!process.env.DATABASE_URL

let workspaceA = ''
let workspaceB = ''
let userA = ''
let userB = ''
let produtoA = ''
let produtoB = ''
const criados: string[] = []

const MOTIVO_OK = 'Comissão recebida e conferida no extrato bancário da empresa.'
const REF_OK = 'extrato-banco-2026-09-18-linha-42'

async function limpar(ws: string) {
  await prisma.mLFeatureSnapshot.deleteMany({ where: { workspaceId: ws } })
  await prisma.commission.deleteMany({ where: { workspaceId: ws } })
  await prisma.sale.deleteMany({ where: { workspaceId: ws } })
  await prisma.conteudo.deleteMany({ where: { workspaceId: ws } })
  await prisma.auditLog.deleteMany({ where: { workspaceId: ws } })
}

/**
 * Cria o conteúdo e, por padrão, CAPTURA a amostra no instante da
 * publicação (Bloco 4.1). A rotulagem não cria mais snapshot: ela só rotula
 * o que já foi observado quando o conteúdo foi ao ar.
 */
async function criarConteudo(ws = workspaceA, capturar = true) {
  const id = await criarConteudoSemCaptura(ws)
  if (capturar) {
    // Capturado "ontem" para que capturedAt fique claramente antes do label.
    await capturarSnapshotDePublicacao({
      workspaceId: ws,
      contentId: id,
      agora: new Date(Date.now() - 24 * 60 * 60 * 1000),
    })
  }
  return id
}

async function criarConteudoSemCaptura(ws = workspaceA) {
  return (
    await prisma.conteudo.create({
      data: {
        workspaceId: ws,
        userId: ws === workspaceA ? userA : userB,
        produtoId: ws === workspaceA ? produtoA : produtoB,
        roteiro: 'Você já viu esse produto? Ele resolve o problema em segundos.',
        chamadaAcao: 'Link na bio',
        duracao: 30,
        redeSocial: 'tiktok',
        dataPublicacao: new Date('2026-09-01T19:00:00.000Z'),
        // Evidência de distribuição real: sem identificador externo o core
        // recusa a captura (revisão do Bloco 4.1).
        publicacaoExternaId: `media-${Math.random().toString(36).slice(2, 10)}`,
      },
      select: { id: true },
    })
  ).id
}

/**
 * Cria uma venda ligada a um conteúdo. `origem` é ajustada direto no banco
 * para montar o cenário — só a promoção auditada escreve REAL_OPERATION.
 */
async function criarVenda(opcoes: {
  origem?: string
  statusVenda?: string
  statusComissao?: string
  contentId?: string | null
  workspaceId?: string
} = {}) {
  const ws = opcoes.workspaceId ?? workspaceA
  const { sale, commission } = await registrarResultado({
    workspaceId: ws,
    actorUserId: ws === workspaceA ? userA : userB,
    dataOrigin: 'TEST_FIXTURE',
    productId: ws === workspaceA ? produtoA : produtoB,
    contentId: opcoes.contentId ?? null,
    amount: 200,
    status: 'CONFIRMED',
    expectedCommission: 20,
    idempotencyKey: `b4-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  })
  await prisma.sale.update({
    where: { id: sale.id },
    data: { dataOrigin: opcoes.origem ?? 'USER_REPORTED', status: opcoes.statusVenda ?? 'CONFIRMED' },
  })
  if (opcoes.statusComissao) {
    await prisma.commission.update({
      where: { id: commission!.id },
      data: {
        status: opcoes.statusComissao,
        confirmedAmount: opcoes.statusComissao === 'EXPECTED' ? null : 18,
        receivedAmount: opcoes.statusComissao === 'RECEIVED' ? 15 : null,
      },
    })
  }
  return { saleId: sale.id, commissionId: commission!.id }
}

/**
 * Depois do Bloco 4.1 a amostra existe desde a PUBLICAÇÃO. O que uma venda
 * inelegível não pode fazer é RÓTULO — então é isso que se verifica, não a
 * ausência da linha.
 */
async function assertNaoRotulou(ws = workspaceA) {
  const rotuladas = await prisma.mLFeatureSnapshot.count({
    where: { workspaceId: ws, labeledAt: { not: null } },
  })
  assert.equal(rotuladas, 0, 'nenhuma amostra podia ter sido rotulada')
  assert.equal((await contarAmostrasRotuladas(ws)).total, 0)
}

/** Cria a venda e a promove pelo caminho legítimo — o cenário elegível. */
async function vendaElegivel(contentId: string | null, statusComissao = 'RECEIVED') {
  const { saleId } = await criarVenda({ contentId, statusComissao })
  const r = await promoverPorCorrecaoManual({
    workspaceId: workspaceA,
    saleId,
    responsavelUserId: userA,
    motivo: MOTIVO_OK,
    referencia: `${REF_OK}-${saleId}`,
  })
  assert.equal(r.promovido, true, r.explicacao)
  return { saleId }
}

describe(
  'Bloco 4 no banco — só operação real alimenta o Feature Store',
  { skip: !TEM_BANCO ? 'DATABASE_URL ausente — este arquivo exige Postgres' : false },
  () => {
    before(async () => {
      const marca = Date.now()
      for (const nome of ['A', 'B']) {
        const ws = await prisma.workspace.create({
          data: { name: `B4-${nome}`, ownerId: `b4-${nome}-${marca}` },
          select: { id: true },
        })
        criados.push(ws.id)
      }
      ;[workspaceA, workspaceB] = criados

      const criarUser = async (ws: string, sufixo: string) =>
        (
          await prisma.user.create({
            data: {
              email: `b4-${sufixo}-${marca}@teste.local`,
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
              nome: 'Produto Bloco 4',
              categoria: 'casa',
              preco: 120,
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

    // ── Origens que NÃO alimentam produção ─────────────────────────────

    test('USER_REPORTED não gera snapshot REAL_OPERATION', async () => {
      await limpar(workspaceA)
      const contentId = await criarConteudo()
      const { saleId } = await criarVenda({ origem: 'USER_REPORTED', contentId, statusComissao: 'RECEIVED' })

      const r = await registrarOperacaoRealNoFeatureStore({ workspaceId: workspaceA, saleId })
      assert.equal(r.registrado, false)
      assert.equal(r.motivo, 'VENDA_NAO_ELEGIVEL')
      assert.ok(r.motivosDaAutoridade.includes('ORIGEM_NAO_E_OPERACAO_REAL'))
      await assertNaoRotulou()
    })

    test('UNVERIFIED não gera snapshot REAL_OPERATION', async () => {
      await limpar(workspaceA)
      const contentId = await criarConteudo()
      const { saleId } = await criarVenda({ origem: 'UNVERIFIED', contentId, statusComissao: 'RECEIVED' })

      const r = await registrarOperacaoRealNoFeatureStore({ workspaceId: workspaceA, saleId })
      assert.equal(r.registrado, false)
      assert.equal(r.motivo, 'VENDA_NAO_ELEGIVEL')
      await assertNaoRotulou()
    })

    for (const origem of ['SEED', 'TEST_FIXTURE', 'DEMO', 'SYNTHETIC_TEST']) {
      test(`${origem} não alimenta produção`, async () => {
        await limpar(workspaceA)
        const contentId = await criarConteudo()
        const { saleId } = await criarVenda({ origem, contentId, statusComissao: 'RECEIVED' })

        const r = await registrarOperacaoRealNoFeatureStore({ workspaceId: workspaceA, saleId })
        assert.equal(r.registrado, false)
        assert.ok(r.motivosDaAutoridade.includes('ORIGEM_NAO_E_OPERACAO_REAL'))
        await assertNaoRotulou()
      })
    }

    test('Sale REAL_OPERATION porém INELEGÍVEL não gera snapshot', async () => {
      // Promovida com evidência válida, mas a comissão ficou em EXPECTED.
      await limpar(workspaceA)
      const contentId = await criarConteudo()
      const { saleId } = await criarVenda({ contentId, statusComissao: 'EXPECTED' })
      const promocao = await promoverPorCorrecaoManual({
        workspaceId: workspaceA,
        saleId,
        responsavelUserId: userA,
        motivo: MOTIVO_OK,
        referencia: REF_OK,
      })
      assert.equal(promocao.promovido, true)
      assert.equal(promocao.veredito?.elegivel, false)

      const r = await registrarOperacaoRealNoFeatureStore({ workspaceId: workspaceA, saleId })
      assert.equal(r.registrado, false)
      assert.equal(r.motivo, 'VENDA_NAO_ELEGIVEL')
      assert.ok(r.motivosDaAutoridade.includes('SEM_COMISSAO_RECONHECIDA'))
      await assertNaoRotulou()
    })

    test('venda elegível SEM conteúdo não gera amostra — e diz por quê', async () => {
      await limpar(workspaceA)
      const { saleId } = await vendaElegivel(null)
      const r = await registrarOperacaoRealNoFeatureStore({ workspaceId: workspaceA, saleId })
      assert.equal(r.registrado, false)
      assert.equal(r.motivo, 'VENDA_SEM_CONTEUDO')
      assert.equal(await prisma.mLFeatureSnapshot.count({ where: { workspaceId: workspaceA } }), 0)
    })

    test('venda inexistente não gera amostra', async () => {
      const r = await registrarOperacaoRealNoFeatureStore({ workspaceId: workspaceA, saleId: 'nao-existe' })
      assert.equal(r.registrado, false)
      assert.equal(r.motivo, 'VENDA_NAO_ENCONTRADA')
    })

    // ── O caminho que funciona ─────────────────────────────────────────

    test('Sale elegível rotula a amostra capturada, sem criar outra', async () => {
      await limpar(workspaceA)
      const contentId = await criarConteudo()
      const { saleId } = await vendaElegivel(contentId)

      const r = await registrarOperacaoRealNoFeatureStore({ workspaceId: workspaceA, saleId })
      assert.equal(r.registrado, true, r.explicacao)
      assert.equal(r.criado, false, 'a amostra nasceu na publicação, não aqui')
      assert.equal(r.contentId, contentId)

      const snaps = await prisma.mLFeatureSnapshot.findMany({ where: { workspaceId: workspaceA } })
      assert.equal(snaps.length, 1)
      assert.equal(snaps[0].dataOrigin, 'REAL_OPERATION')
      assert.equal(snaps[0].entityType, ENTIDADE_DA_AMOSTRA)
      assert.equal(snaps[0].entityId, contentId)
      assert.equal(snaps[0].featureVersion, FEATURE_VERSION)
    })

    test('as features descrevem o criativo, não o resultado', async () => {
      await limpar(workspaceA)
      const contentId = await criarConteudo()
      const { saleId } = await vendaElegivel(contentId)
      await registrarOperacaoRealNoFeatureStore({ workspaceId: workspaceA, saleId })

      const snap = await prisma.mLFeatureSnapshot.findFirst({ where: { workspaceId: workspaceA } })
      const features = snap?.features as Record<string, unknown>
      assert.equal(features.channel, 'tiktok')
      assert.equal(features.video_duration, 30)
      assert.equal(features.product_category, 'casa')
      // Nenhum campo do resultado entrou como entrada.
      for (const chave of Object.keys(features)) {
        assert.ok(
          !/sale|venda|revenue|receita|converted|amount|label/i.test(chave) || chave === 'commission_percentage',
          `feature "${chave}" não pode existir`
        )
      }
    })

    test('label só aparece DEPOIS do resultado: capturedAt < labeledAt', async () => {
      await limpar(workspaceA)
      const contentId = await criarConteudo()
      const { saleId } = await vendaElegivel(contentId)
      await registrarOperacaoRealNoFeatureStore({ workspaceId: workspaceA, saleId })

      const snap = await prisma.mLFeatureSnapshot.findFirst({ where: { workspaceId: workspaceA } })
      assert.ok(snap?.labeledAt, 'o label precisa estar registrado')
      assert.ok(
        snap!.capturedAt.getTime() < snap!.labeledAt!.getTime(),
        'as features descrevem a publicação; o label, o que veio depois'
      )
    })

    test('o label separa esperada, confirmada e recebida', async () => {
      await limpar(workspaceA)
      const contentId = await criarConteudo()
      const { saleId } = await vendaElegivel(contentId, 'RECEIVED')
      const r = await registrarOperacaoRealNoFeatureStore({ workspaceId: workspaceA, saleId })

      const label = r.label!
      assert.equal(label.converted, true)
      assert.equal(label.valorBrutoVendas, 200)
      assert.equal(label.comissaoEsperada, 20)
      assert.equal(label.comissaoConfirmada, 18)
      assert.equal(label.comissaoRecebida, 15)
      assert.equal(label.receitaRealizada, 15, 'receita efetiva é só o RECEIVED')
      assert.equal(label.origemDoLabel, 'SALE_COMMISSION_COMPROVADA')
    })

    test('comissão CONFIRMED (não recebida) não vira receita realizada', async () => {
      await limpar(workspaceA)
      const contentId = await criarConteudo()
      const { saleId } = await vendaElegivel(contentId, 'CONFIRMED')
      const r = await registrarOperacaoRealNoFeatureStore({ workspaceId: workspaceA, saleId })

      assert.equal(r.registrado, true, r.explicacao)
      assert.equal(r.label?.comissaoConfirmada, 18)
      assert.equal(r.label?.comissaoRecebida, 0)
      assert.equal(r.label?.receitaRealizada, 0)
    })

    test('venda sem clique atribuído registra a ausência, sem inventar', async () => {
      await limpar(workspaceA)
      const contentId = await criarConteudo()
      const { saleId } = await vendaElegivel(contentId)
      const r = await registrarOperacaoRealNoFeatureStore({ workspaceId: workspaceA, saleId })

      // A publicacao desta fixture nao passou pelo link rastreado, entao a
      // AUSENCIA de clique nao foi medida — e `null`, nao 1. `comClique`
      // continua sendo zero medido: nenhuma venda tem clique atribuido.
      assert.deepEqual(r.label?.atribuicaoDeClique, { comClique: 0, semClique: null })
      assert.equal(r.label?.rastreamentoDeClique, 'NAO_RASTREADA_COM_FALLBACK')
      const venda = await prisma.sale.findUnique({ where: { id: saleId }, select: { clickEventId: true } })
      assert.equal(venda?.clickEventId, null)
    })

    test('o label soma SÓ as vendas elegíveis do conteúdo', async () => {
      // Duas vendas no mesmo conteúdo: uma comprovada, outra USER_REPORTED.
      await limpar(workspaceA)
      const contentId = await criarConteudo()
      const { saleId } = await vendaElegivel(contentId)
      await criarVenda({ origem: 'USER_REPORTED', contentId, statusComissao: 'RECEIVED' })

      const r = await registrarOperacaoRealNoFeatureStore({ workspaceId: workspaceA, saleId })
      assert.equal(r.label?.vendasElegiveis, 1, 'a venda USER_REPORTED não pode entrar no label de produção')
      assert.equal(r.label?.valorBrutoVendas, 200)
    })

    // ── Idempotência ───────────────────────────────────────────────────

    test('reprocessar a mesma venda NÃO duplica snapshot', async () => {
      await limpar(workspaceA)
      const contentId = await criarConteudo()
      const { saleId } = await vendaElegivel(contentId)

      const primeira = await registrarOperacaoRealNoFeatureStore({ workspaceId: workspaceA, saleId })
      const segunda = await registrarOperacaoRealNoFeatureStore({ workspaceId: workspaceA, saleId })
      const terceira = await registrarOperacaoRealNoFeatureStore({ workspaceId: workspaceA, saleId })

      for (const r of [primeira, segunda, terceira]) {
        assert.equal(r.registrado, true, r.explicacao)
        assert.equal(r.criado, false, 'rotular nunca cria amostra')
      }
      assert.equal(primeira.snapshotId, segunda.snapshotId)
      assert.equal(segunda.snapshotId, terceira.snapshotId)
      assert.equal(await prisma.mLFeatureSnapshot.count({ where: { workspaceId: workspaceA } }), 1)
    })

    test('duas chamadas SIMULTÂNEAS criam uma amostra só', async () => {
      await limpar(workspaceA)
      const contentId = await criarConteudo()
      const { saleId } = await vendaElegivel(contentId)

      const [a, b] = await Promise.all([
        registrarOperacaoRealNoFeatureStore({ workspaceId: workspaceA, saleId }),
        registrarOperacaoRealNoFeatureStore({ workspaceId: workspaceA, saleId }),
      ])
      assert.equal([a, b].filter((r) => r.registrado).length, 2)
      assert.equal([a, b].filter((r) => r.criado).length, 0)
      assert.equal(await prisma.mLFeatureSnapshot.count({ where: { workspaceId: workspaceA } }), 1)
    })

    test('duas vendas do MESMO conteúdo convergem na mesma amostra', async () => {
      await limpar(workspaceA)
      const contentId = await criarConteudo()
      const a = await vendaElegivel(contentId)
      const b = await vendaElegivel(contentId)

      const r1 = await registrarOperacaoRealNoFeatureStore({ workspaceId: workspaceA, saleId: a.saleId })
      const r2 = await registrarOperacaoRealNoFeatureStore({ workspaceId: workspaceA, saleId: b.saleId })

      assert.equal(r1.snapshotId, r2.snapshotId, 'a amostra é do conteúdo, não da venda')
      assert.equal(await prisma.mLFeatureSnapshot.count({ where: { workspaceId: workspaceA } }), 1)
      assert.equal(r2.label?.vendasElegiveis, 2, 'o label acompanha as duas vendas comprovadas')
    })

    // ── Isolamento ─────────────────────────────────────────────────────

    test('workspace A nunca cria nem rotula snapshot de B', async () => {
      await limpar(workspaceA)
      await limpar(workspaceB)
      const contentId = await criarConteudo()
      const { saleId } = await vendaElegivel(contentId)

      // Pedir a venda de A usando o workspace B não encontra nada.
      const r = await registrarOperacaoRealNoFeatureStore({ workspaceId: workspaceB, saleId })
      assert.equal(r.registrado, false)
      assert.equal(r.motivo, 'VENDA_NAO_ENCONTRADA')
      assert.equal(await prisma.mLFeatureSnapshot.count({ where: { workspaceId: workspaceB } }), 0)
      assert.equal(await contarAmostrasRotuladas(workspaceB).then((c) => c.total), 0)

      // E o caminho certo continua funcionando, só em A.
      const ok = await registrarOperacaoRealNoFeatureStore({ workspaceId: workspaceA, saleId })
      assert.equal(ok.registrado, true, ok.explicacao)
      assert.equal(
        await prisma.mLFeatureSnapshot.count({ where: { workspaceId: workspaceA, labeledAt: { not: null } } }),
        1
      )
      assert.equal(await prisma.mLFeatureSnapshot.count({ where: { workspaceId: workspaceB } }), 0)
    })

    // ── Readiness gate ─────────────────────────────────────────────────

    test('snapshot REAL_OPERATION é contado pelo readiness gate', async () => {
      await limpar(workspaceA)
      const contentId = await criarConteudo()

      // Antes da venda: a amostra existe (capturada na publicação), mas sem
      // rótulo — e sem rótulo ela não conta para prontidão nenhuma.
      assert.equal(await prisma.mLFeatureSnapshot.count({ where: { workspaceId: workspaceA } }), 1)
      assert.equal((await contarAmostrasRotuladas(workspaceA)).total, 0)

      // A promoção já dispara o GATILHO B sozinha (Bloco 4.1): ninguém
      // precisa mandar "atualizar ML".
      const { saleId } = await vendaElegivel(contentId)

      const depoisDoGatilho = await contarAmostrasRotuladas(workspaceA)
      assert.equal(depoisDoGatilho.total, 1, 'o gatilho automático rotulou')
      assert.equal(depoisDoGatilho.positivas, 1, 'venda comprovada é amostra positiva')

      // Chamar de novo explicitamente é idempotente.
      const r = await registrarOperacaoRealNoFeatureStore({ workspaceId: workspaceA, saleId })
      assert.equal(r.registrado, true, r.explicacao)
      const final = await contarAmostrasRotuladas(workspaceA)
      assert.equal(final.total, 1)
      assert.equal(final.positivas, 1)
    })

    test('snapshots sintéticos NÃO são contados pelo readiness gate', async () => {
      await limpar(workspaceA)
      const contentId = await criarConteudo(workspaceA, false)

      // Amostras de teste podem existir para validar o motor...
      for (const origem of ['TEST_FIXTURE', 'DEMO', 'SEED', 'SYNTHETIC_TEST'] as const) {
        const snap = await salvarFeatureSnapshot(
          workspaceA,
          ENTIDADE_DA_AMOSTRA,
          `${contentId}-${origem}`,
          { product_price_bucket: 'MID' } as never,
          origem
        )
        await registrarLabelNoSnapshot(snap.id, { converted: true, saleAmount: 1, commissionValue: 1 })
      }

      // ...e nenhuma delas conta para a prontidão de produção.
      const producao = await contarAmostrasRotuladas(workspaceA)
      assert.equal(producao.total, 0)

      const todas = await prisma.mLFeatureSnapshot.count({ where: { workspaceId: workspaceA } })
      assert.equal(todas, 4, 'as amostras de teste continuam existindo')
    })

    test('reprocessar NÃO transforma amostra de teste em produção', async () => {
      await limpar(workspaceA)
      const contentId = await criarConteudo(workspaceA, false)
      // Uma amostra de teste já existe para este conteúdo e versão.
      await salvarFeatureSnapshot(
        workspaceA,
        ENTIDADE_DA_AMOSTRA,
        contentId,
        { product_price_bucket: 'MID' } as never,
        'TEST_FIXTURE'
      )
      const { saleId } = await vendaElegivel(contentId)

      const r = await registrarOperacaoRealNoFeatureStore({ workspaceId: workspaceA, saleId })
      assert.equal(r.criado, false, 'reaproveita a linha existente')

      const snap = await prisma.mLFeatureSnapshot.findFirst({ where: { workspaceId: workspaceA } })
      assert.equal(snap?.dataOrigin, 'TEST_FIXTURE', 'a origem NUNCA é reescrita por reprocessamento')
      assert.equal(await contarAmostrasRotuladas(workspaceA).then((c) => c.total), 0)
    })

    // ── Nada foi ativado ───────────────────────────────────────────────

    test('nenhum modelo foi criado, treinado ou promovido', async () => {
      const modelos = await prisma.mLModel.count({ where: { workspaceId: { in: criados } } })
      const treinos = await prisma.mLTrainingRun.count({ where: { workspaceId: { in: criados } } })
      const ativos = await prisma.mLModel.count({ where: { workspaceId: { in: criados }, status: 'ACTIVE' } })
      assert.equal(modelos, 0)
      assert.equal(treinos, 0)
      assert.equal(ativos, 0)
    })
  }
)
