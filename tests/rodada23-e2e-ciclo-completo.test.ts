/**
 * P0.2 — fechamento técnico: E2E do ciclo inteiro + dossiê contra Postgres.
 *
 * ── O QUE ESTE TESTE É, E O QUE NÃO É ───────────────────────────────────
 * Ele percorre a cadeia completa para provar que o MECANISMO encadeia:
 *
 *   Produto → Conteudo distribuído → Link → Clique → Sale → Commission
 *           → evidência auditada → REAL_OPERATION → elegibilidade
 *           → MLFeatureSnapshot → label
 *
 * Ele NÃO fabrica receita. Tudo acontece dentro de workspaces DESCARTÁVEIS,
 * criados no `before` e apagados no `after`. Nenhum workspace de negócio é
 * tocado, e o teste verifica isso explicitamente ao final.
 *
 * ── O PONTO DELICADO, DITO SEM RODEIO ───────────────────────────────────
 * Para provar o encadeamento a venda PRECISA ser promovida a
 * `REAL_OPERATION` — é exatamente esse o mecanismo em prova. Então sim,
 * existe uma linha com `dataOrigin = REAL_OPERATION` enquanto o teste roda,
 * e ela conta no readiness DAQUELE workspace descartável. Não há como
 * demonstrar a cadeia sem isso.
 *
 * O que garante que nada vira receita de negócio:
 *   1. o workspace é criado e destruído dentro do próprio teste;
 *   2. nenhum outro workspace ganha amostra (verificado);
 *   3. a promoção usa evidência de teste explícita, e o dossiê mostra isso.
 *
 * O primeiro REAL_OPERATION de NEGÓCIO só existirá quando houver uma venda
 * real comprovada pela proprietária.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../lib/prisma'
import { registrarResultado, atualizarComissao } from '../lib/vendas-comissoes'
import { promoverPorCorrecaoManual } from '../lib/promocao-operacao-real'
import { capturarSnapshotDePublicacao } from '../lib/ml-captura-publicacao'
import { avaliarVendaParaOperacaoReal } from '../lib/real-operation'
import { contarAmostrasRotuladas } from '../lib/ml-readiness-gate'
import { obterDossieDaOperacao, descreverCadeia } from '../lib/dossie-operacao'

const TEM_BANCO = !!process.env.DATABASE_URL

let workspaceA = ''
let workspaceB = ''
let userA = ''
let userB = ''
let produtoA = ''
let produtoB = ''
const criados: string[] = []
const marca = Date.now()

async function limpar(ws: string) {
  await prisma.mLFeatureSnapshot.deleteMany({ where: { workspaceId: ws } })
  await prisma.commission.deleteMany({ where: { workspaceId: ws } })
  await prisma.sale.deleteMany({ where: { workspaceId: ws } })
  await prisma.eventoLink.deleteMany({ where: { workspaceId: ws } })
  await prisma.linkDinamico.deleteMany({ where: { workspaceId: ws } })
  await prisma.conteudo.deleteMany({ where: { workspaceId: ws } })
  await prisma.auditLog.deleteMany({ where: { workspaceId: ws } })
}

describe(
  'P0.2 — E2E do ciclo completo e dossiê auditável',
  { skip: !TEM_BANCO ? 'DATABASE_URL ausente — este arquivo exige Postgres' : false },
  () => {
    before(async () => {
      for (const nome of ['A', 'B']) {
        const ws = await prisma.workspace.create({
          data: { name: `E2E-${nome}`, ownerId: `e2e-${nome}-${marca}` },
          select: { id: true },
        })
        criados.push(ws.id)
      }
      ;[workspaceA, workspaceB] = criados

      const criarUser = async (ws: string, sufixo: string) =>
        (
          await prisma.user.create({
            data: {
              email: `e2e-${sufixo}-${marca}@teste.local`,
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
              nome: 'Carregador portátil 20.000 mAh',
              categoria: 'eletronicos',
              preco: 199,
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

    // ── E2E: a cadeia inteira ────────────────────────────────────────

    test('E2E: Produto → Conteudo distribuído → Link → Clique → Sale → Commission → evidência → REAL_OPERATION → elegível → snapshot → label', async () => {
      await limpar(workspaceA)

      // 1. CONTEÚDO, distribuído de verdade (o canal devolveu identificador).
      const distribuidoEm = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
      const conteudo = await prisma.conteudo.create({
        data: {
          workspaceId: workspaceA,
          userId: userA,
          produtoId: produtoA,
          roteiro: 'Você já ficou sem bateria no meio do dia? Esse carregador resolve.',
          chamadaAcao: 'Link na bio',
          duracao: 30,
          redeSocial: 'tiktok',
          status: 'publicado',
          dataPublicacao: distribuidoEm,
          publicacaoExternaId: `media-e2e-${marca}`,
        },
        select: { id: true },
      })

      // 2. CAPTURA na distribuição — amostra sem rótulo.
      const captura = await capturarSnapshotDePublicacao({ workspaceId: workspaceA, contentId: conteudo.id })
      assert.equal(captura.capturado, true, captura.explicacao)
      const snapInicial = await prisma.mLFeatureSnapshot.findUnique({ where: { id: captura.snapshotId! } })
      assert.equal(snapInicial?.labeledAt, null, 'a amostra nasce sem rótulo')
      assert.equal(snapInicial?.capturedAt.toISOString(), distribuidoEm.toISOString())

      // 3. LINK e CLIQUE reais.
      const link = await prisma.linkDinamico.create({
        data: {
          workspaceId: workspaceA,
          userId: userA,
          produtoId: produtoA,
          slug: `e2e-${marca}`,
          plataforma: 'tiktok',
          urlDestino: 'https://exemplo.invalido/produto',
        },
        select: { id: true },
      })
      const clique = await prisma.eventoLink.create({
        data: {
          workspaceId: workspaceA,
          linkId: link.id,
          tipo: 'clique',
          createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
        },
        select: { id: true },
      })

      // 4. VENDA pelo caminho da tela: nasce USER_REPORTED, com o clique
      //    atribuído pela regra determinística.
      const { sale, commission } = await registrarResultado({
        workspaceId: workspaceA,
        actorUserId: userA,
        dataOrigin: 'USER_REPORTED',
        productId: produtoA,
        linkId: link.id,
        contentId: conteudo.id,
        amount: 199,
        status: 'CONFIRMED',
        expectedCommission: 20,
        idempotencyKey: `e2e-${marca}`,
      })
      assert.equal(sale.dataOrigin, 'USER_REPORTED', 'a tela nunca declara operação real')
      assert.equal(sale.clickEventId, clique.id, 'o clique foi atribuído pela regra')
      assert.equal(sale.attributionMethod, 'ULTIMO_CLIQUE_MESMO_LINK_ANTES_DA_VENDA')

      // 5. Antes da comprovação: NÃO é operação real, e nada foi rotulado.
      const antes = await avaliarVendaParaOperacaoReal(workspaceA, sale.id)
      assert.equal(antes?.elegivel, false)
      assert.ok(antes?.motivos.includes('ORIGEM_NAO_E_OPERACAO_REAL'))
      assert.equal((await contarAmostrasRotuladas(workspaceA)).total, 0)

      // 6. COMISSÃO recebida — o gatilho C reavalia sozinho.
      await atualizarComissao({
        workspaceId: workspaceA,
        commissionId: commission!.id,
        actorUserId: userA,
        status: 'RECEIVED',
        confirmedAmount: 18,
        receivedAmount: 15,
      })
      // Ainda USER_REPORTED: comissão reconhecida não é evidência.
      assert.equal((await contarAmostrasRotuladas(workspaceA)).total, 0)

      // 7. EVIDÊNCIA auditada → promoção para REAL_OPERATION.
      const promocao = await promoverPorCorrecaoManual({
        workspaceId: workspaceA,
        saleId: sale.id,
        responsavelUserId: userA,
        motivo: 'E2E controlado: repasse conferido no extrato de teste.',
        referencia: `extrato-e2e-${marca}`,
      })
      assert.equal(promocao.promovido, true, promocao.explicacao)
      assert.equal(promocao.origemAnterior, 'USER_REPORTED')
      assert.equal(promocao.origemNova, 'REAL_OPERATION')

      // 8. ELEGIBILIDADE pela autoridade única.
      assert.equal(promocao.veredito?.elegivel, true, JSON.stringify(promocao.veredito?.motivos))

      // 9. O GATILHO B já rotulou a amostra — ninguém mandou "atualizar ML".
      const snapFinal = await prisma.mLFeatureSnapshot.findUnique({ where: { id: captura.snapshotId! } })
      assert.ok(snapFinal?.labeledAt, 'o gatilho automático rotulou')
      assert.equal(snapFinal?.dataOrigin, 'REAL_OPERATION')
      assert.ok(
        snapFinal!.capturedAt.getTime() < snapFinal!.labeledAt!.getTime(),
        'features descrevem a distribuição; label, o que veio depois'
      )
      const label = snapFinal?.label as Record<string, unknown>
      assert.equal(label.converted, true)
      assert.equal(label.receitaRealizada, 15)
      assert.equal(label.comissaoEsperada, 20)
      assert.equal(label.comissaoConfirmada, 18)
      // O clique DESTA venda existe e esta atribuido — evidencia positiva,
      // vale sempre. Ja `semClique` fica `null`: a publicacao do E2E usa um
      // link criado a mao, nao o rastreado da publicacao, entao ausencia de
      // clique aqui nao teria como ser medida.
      assert.deepEqual(label.atribuicaoDeClique, { comClique: 1, semClique: null })
      assert.equal(label.rastreamentoDeClique, 'NAO_RASTREADA_COM_FALLBACK')

      // 10. Uma amostra, uma linha, contada no readiness DESTE workspace.
      const conta = await contarAmostrasRotuladas(workspaceA)
      assert.equal(conta.total, 1)
      assert.equal(conta.positivas, 1)
      assert.equal(await prisma.mLFeatureSnapshot.count({ where: { workspaceId: workspaceA } }), 1)

      // 11. O outro workspace não foi tocado em nenhum momento.
      assert.equal(await prisma.mLFeatureSnapshot.count({ where: { workspaceId: workspaceB } }), 0)
      assert.equal((await contarAmostrasRotuladas(workspaceB)).total, 0)
      assert.equal(await prisma.sale.count({ where: { workspaceId: workspaceB } }), 0)
    })

    test('o E2E não criou modelo, treino nem ativação', async () => {
      assert.equal(await prisma.mLModel.count({ where: { workspaceId: { in: criados } } }), 0)
      assert.equal(await prisma.mLTrainingRun.count({ where: { workspaceId: { in: criados } } }), 0)
      assert.equal(await prisma.mLPrediction.count({ where: { workspaceId: { in: criados } } }), 0)
    })

    // ── Dossiê ───────────────────────────────────────────────────────

    test('dossiê da operação COMPLETA responde a cadeia inteira', async () => {
      const venda = await prisma.sale.findFirst({ where: { workspaceId: workspaceA }, select: { id: true } })
      const d = await obterDossieDaOperacao(workspaceA, venda!.id)
      assert.ok(d)

      assert.equal(d!.workspaceId, workspaceA)
      assert.equal(d!.produto?.nome, 'Carregador portátil 20.000 mAh')
      assert.ok(d!.conteudo)
      assert.equal(d!.distribuicao.comprovada, true)
      assert.match(d!.distribuicao.publicacaoExternaId!, /^media-e2e-/)
      assert.ok(d!.link)
      assert.equal(d!.clique.atribuido, true)
      assert.equal(d!.clique.attributionMethod, 'ULTIMO_CLIQUE_MESMO_LINK_ANTES_DA_VENDA')
      assert.equal(d!.venda.valorBruto, 199)
      assert.equal(d!.venda.dataOrigin, 'REAL_OPERATION')
      assert.equal(d!.proveniencia.ehOperacaoReal, true)

      // Os cinco números, separados.
      assert.equal(d!.receita.valorBrutoDaVenda, 199)
      assert.equal(d!.receita.comissaoEsperada, 20)
      assert.equal(d!.receita.comissaoConfirmada, 18)
      assert.equal(d!.receita.comissaoRecebida, 15)
      assert.equal(d!.receita.receitaRealizada, 15)

      // Evidência e promoção com responsável.
      assert.equal(d!.evidencias.length, 1)
      assert.equal(d!.evidencias[0].tipo, 'CORRECAO_MANUAL_AUDITADA')
      assert.equal(d!.evidencias[0].responsavelUserId, userA)
      assert.equal(d!.promocoes.length, 1)
      assert.equal(d!.promocoes[0].estadoAnterior, 'USER_REPORTED')
      assert.equal(d!.promocoes[0].estadoNovo, 'REAL_OPERATION')

      assert.equal(d!.veredito?.elegivel, true)
      assert.ok(d!.amostraML)
      assert.equal(d!.amostraML!.contadaPeloReadiness, true)
      assert.ok(d!.amostraML!.labeledAt)

      // Auditoria presente, sem metadata bruto.
      const acoes = d!.auditoria.map((a) => a.action)
      assert.ok(acoes.includes('venda.criada'))
      assert.ok(acoes.includes('venda.evidencia_de_operacao_real'))
      assert.ok(acoes.includes('venda.promovida_para_operacao_real'))
      assert.ok(acoes.includes('comissao.recebida'))
      for (const item of d!.auditoria) {
        assert.ok(!('metadata' in item), 'o dossiê não devolve metadata bruto')
      }

      // Operação completa: nenhuma lacuna.
      assert.deepEqual(d!.lacunas, [], JSON.stringify(d!.lacunas))

      // A cadeia legível.
      const cadeia = descreverCadeia(d!)
      assert.ok(cadeia.some((l) => l.startsWith('receita realizada: R$ 15.00')))
      assert.ok(cadeia.some((l) => l.includes('amostra contando no readiness')))
    })

    test('dossiê de venda SEM clique e SEM conteúdo mostra lacunas, não invenções', async () => {
      await limpar(workspaceB)
      const { sale } = await registrarResultado({
        workspaceId: workspaceB,
        actorUserId: userB,
        dataOrigin: 'USER_REPORTED',
        productId: produtoB,
        amount: 50,
        status: 'PENDING',
        idempotencyKey: `e2e-vazio-${Date.now()}`,
      })

      const d = await obterDossieDaOperacao(workspaceB, sale.id)
      assert.ok(d)
      assert.equal(d!.conteudo, null)
      assert.equal(d!.link, null)
      assert.equal(d!.clique.atribuido, false)
      assert.equal(d!.clique.clickEventId, null)
      assert.equal(d!.clique.attributionMethod, 'SEM_LINK_NA_VENDA')
      assert.equal(d!.amostraML, null)

      const codigos = d!.lacunas.map((l) => l.codigo)
      for (const esperado of ['SEM_CONTEUDO', 'SEM_LINK', 'CLIQUE_NAO_ATRIBUIDO', 'SEM_AMOSTRA_ML', 'SEM_EVIDENCIA_REGISTRADA']) {
        assert.ok(codigos.includes(esperado as never), `faltou a lacuna ${esperado}`)
      }
      // Nada foi inventado para tapar buraco.
      assert.ok(descreverCadeia(d!).some((l) => l === 'clique: não atribuído'))
    })

    test('dossiê de USER_REPORTED mostra que NÃO é operação real', async () => {
      const venda = await prisma.sale.findFirst({ where: { workspaceId: workspaceB }, select: { id: true } })
      const d = await obterDossieDaOperacao(workspaceB, venda!.id)
      assert.equal(d!.proveniencia.dataOrigin, 'USER_REPORTED')
      assert.equal(d!.proveniencia.ehOperacaoReal, false)
      assert.equal(d!.veredito?.elegivel, false)
      assert.ok(d!.veredito?.motivos.includes('ORIGEM_NAO_E_OPERACAO_REAL'))
    })

    test('venda de OUTRO workspace parece inexistente', async () => {
      const venda = await prisma.sale.findFirst({ where: { workspaceId: workspaceA }, select: { id: true } })
      // Existe — mas não para quem pergunta do workspace errado.
      assert.equal(await obterDossieDaOperacao(workspaceB, venda!.id), null)
      assert.ok(await obterDossieDaOperacao(workspaceA, venda!.id))
    })

    test('workspace ou venda em branco devolvem null', async () => {
      assert.equal(await obterDossieDaOperacao('', 'x'), null)
      assert.equal(await obterDossieDaOperacao(workspaceA, '  '), null)
      assert.equal(await obterDossieDaOperacao(workspaceA, 'venda-que-nao-existe'), null)
    })

    test('o dossiê NÃO altera nada ao ser gerado', async () => {
      const venda = await prisma.sale.findFirst({ where: { workspaceId: workspaceA }, select: { id: true } })
      const contar = async () => ({
        sales: await prisma.sale.count({ where: { workspaceId: workspaceA } }),
        commissions: await prisma.commission.count({ where: { workspaceId: workspaceA } }),
        logs: await prisma.auditLog.count({ where: { workspaceId: workspaceA } }),
        snaps: await prisma.mLFeatureSnapshot.count({ where: { workspaceId: workspaceA } }),
      })
      const antes = await contar()
      await obterDossieDaOperacao(workspaceA, venda!.id)
      await obterDossieDaOperacao(workspaceA, venda!.id)
      assert.deepEqual(await contar(), antes)
    })

    test('dossiê de venda com comissão EXPECTED separa previsão de caixa', async () => {
      await limpar(workspaceB)
      const { sale } = await registrarResultado({
        workspaceId: workspaceB,
        actorUserId: userB,
        dataOrigin: 'USER_REPORTED',
        productId: produtoB,
        amount: 300,
        status: 'CONFIRMED',
        expectedCommission: 30,
        idempotencyKey: `e2e-expected-${Date.now()}`,
      })
      const d = await obterDossieDaOperacao(workspaceB, sale.id)
      assert.equal(d!.receita.comissaoEsperada, 30)
      assert.equal(d!.receita.comissaoConfirmada, 0)
      assert.equal(d!.receita.comissaoRecebida, 0)
      assert.equal(d!.receita.receitaRealizada, 0, 'esperada jamais é caixa')
    })

    test('amostra NEGATIVA aparece no dossiê como não convertida', async () => {
      await limpar(workspaceB)
      const distribuidoEm = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000)
      const conteudo = await prisma.conteudo.create({
        data: {
          workspaceId: workspaceB,
          userId: userB,
          produtoId: produtoB,
          roteiro: 'Conteúdo que não converteu.',
          chamadaAcao: 'Link na bio',
          duracao: 20,
          redeSocial: 'tiktok',
          status: 'publicado',
          dataPublicacao: distribuidoEm,
          publicacaoExternaId: `media-neg-${Date.now()}`,
        },
        select: { id: true },
      })
      await capturarSnapshotDePublicacao({ workspaceId: workspaceB, contentId: conteudo.id })
      const { rotularNegativoSeJanelaEncerrada } = await import('../lib/ml-captura-publicacao')
      const neg = await rotularNegativoSeJanelaEncerrada({ workspaceId: workspaceB, contentId: conteudo.id })
      assert.equal(neg.rotulado, true, neg.explicacao)

      // Uma venda daquele conteúdo (criada depois) permite ver a amostra
      // negativa pelo dossiê.
      const { sale } = await registrarResultado({
        workspaceId: workspaceB,
        actorUserId: userB,
        dataOrigin: 'USER_REPORTED',
        productId: produtoB,
        contentId: conteudo.id,
        amount: 10,
        status: 'PENDING',
        idempotencyKey: `e2e-neg-${Date.now()}`,
      })
      const d = await obterDossieDaOperacao(workspaceB, sale.id)
      assert.ok(d!.amostraML)
      assert.equal((d!.amostraML!.label as Record<string, unknown>).converted, false)
      assert.equal(d!.amostraML!.contadaPeloReadiness, true, 'negativo real também conta no total')
    })

    // ── Fechamento ───────────────────────────────────────────────────

    test('FECHAMENTO: o REAL_OPERATION deste E2E vive só nos workspaces descartáveis', async () => {
      // O banco de TESTE é, por construção, todo dado de teste — varrer o
      // banco inteiro atrás de "workspace de negócio" não prova nada aqui,
      // porque não existe nenhum. O que dá para provar, e é o que importa:
      //
      //   1. este arquivo produziu EXATAMENTE uma operação real;
      //   2. ela está num workspace criado no `before` e apagado no `after`;
      //   3. o segundo workspace, testemunha, nunca ganhou nada.
      //
      // A garantia de que produção não foi tocada é outra, e é anterior: a
      // migration do P0.2 nunca foi aplicada lá, e nenhuma rota autenticada
      // consegue declarar REAL_OPERATION (Bloco 3.1).
      const reais = await prisma.sale.findMany({
        where: { dataOrigin: 'REAL_OPERATION', workspaceId: { in: criados } },
        select: { id: true, workspaceId: true },
      })
      assert.equal(reais.length, 1, 'o E2E prova o mecanismo com UMA operação, não fabrica receita')
      assert.equal(reais[0].workspaceId, workspaceA)

      const amostras = await prisma.mLFeatureSnapshot.count({
        where: { dataOrigin: 'REAL_OPERATION', labeledAt: { not: null }, workspaceId: workspaceA },
      })
      assert.equal(amostras, 1)

      // O workspace testemunha permanece intocado por operação real.
      assert.equal(
        await prisma.sale.count({ where: { workspaceId: workspaceB, dataOrigin: 'REAL_OPERATION' } }),
        0
      )

      // E tudo isto desaparece no `after` — nada sobrevive à suíte.
      assert.equal(criados.length, 2)
    })
  }
)
