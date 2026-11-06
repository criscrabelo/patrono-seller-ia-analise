/**
 * P0.2 Bloco 4.1 — captura prospectiva, rotulagem posterior e gatilhos.
 *
 * A prova central desta rodada está em "editar o conteúdo depois NÃO altera
 * a feature histórica": é o que separa uma observação de uma opinião atual
 * disfarçada de dado.
 */

import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '../lib/prisma'
import { registrarResultado, atualizarComissao } from '../lib/vendas-comissoes'
import { promoverPorCorrecaoManual } from '../lib/promocao-operacao-real'
import { ENTIDADE_DA_AMOSTRA } from '../lib/ml-operacao-real'
import {
  capturarSnapshotDePublicacao,
  rotularNegativoSeJanelaEncerrada,
  fecharJanelasDeObservacao,
  listarLacunasDeCaptura,
  lerPoliticaDeObservacao,
  janelaEncerrada,
  avaliarDistribuicaoReal,
  montarLabelNegativo,
  JANELA_OBSERVACAO_PADRAO_DIAS,
  LIMITACAO_DE_REVISAO,
} from '../lib/ml-captura-publicacao'
import { FEATURE_VERSION } from '../lib/ml-feature-store'
import { contarAmostrasRotuladas } from '../lib/ml-readiness-gate'
import { limparVerificadoresDeEvidencia } from '../lib/evidencia-verificada'

const TEM_BANCO = !!process.env.DATABASE_URL
const RAIZ = join(__dirname, '..')
const lerFonte = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')

const DIA = 24 * 60 * 60 * 1000
const MOTIVO_OK = 'Comissão recebida e conferida no extrato bancário da empresa.'

// ── Política da janela (pura) ───────────────────────────────────────────

describe('Janela de observação — política INTERNA, nunca regra de provider', () => {
  test('o padrão é conservador e declarado', () => {
    const p = lerPoliticaDeObservacao({})
    assert.equal(p.dias, JANELA_OBSERVACAO_PADRAO_DIAS)
    assert.equal(p.dias, 30)
    assert.equal(p.origem, 'PADRAO_INTERNO')
  })

  test('NUNCA é apresentada como regra oficial de provider', () => {
    // Apresentar número interno como "a janela do TikTok" produziria um dado
    // que parece oficial e não é.
    for (const env of [{}, { ML_CONVERSION_OBSERVATION_WINDOW_DAYS: '7' }]) {
      assert.equal(lerPoliticaDeObservacao(env).oficialDeProvider, false)
    }
  })

  test('é configurável por ML_CONVERSION_OBSERVATION_WINDOW_DAYS', () => {
    const p = lerPoliticaDeObservacao({ ML_CONVERSION_OBSERVATION_WINDOW_DAYS: '7' })
    assert.equal(p.dias, 7)
    assert.equal(p.origem, 'CONFIGURADO')
  })

  test('valor inválido cai no padrão, nunca em zero', () => {
    // Zero dias rotularia tudo como negativo no mesmo instante da publicação.
    for (const v of ['0', '-5', 'abc', '', '  ']) {
      const p = lerPoliticaDeObservacao({ ML_CONVERSION_OBSERVATION_WINDOW_DAYS: v })
      assert.equal(p.dias, JANELA_OBSERVACAO_PADRAO_DIAS)
      assert.equal(p.origem, 'PADRAO_INTERNO')
    }
  })

  test('a janela só fecha depois do prazo', () => {
    const pub = new Date('2026-09-01T00:00:00.000Z')
    assert.equal(janelaEncerrada(pub, new Date('2026-09-30T23:59:59.000Z'), 30), false)
    assert.equal(janelaEncerrada(pub, new Date('2026-10-01T00:00:00.000Z'), 30), true)
  })

  test('sem data de publicação a janela nunca fecha', () => {
    assert.equal(janelaEncerrada(null, new Date(), 30), false)
    assert.equal(janelaEncerrada(new Date('xx'), new Date(), 30), false)
  })
})

describe('Label negativo — zeros explícitos', () => {
  test('tudo zerado, com a ausência de conversão preservada', () => {
    const l = montarLabelNegativo(new Date('2026-10-01T00:00:00.000Z'))
    assert.equal(l.converted, false)
    assert.equal(l.vendasElegiveis, 0)
    assert.equal(l.valorBrutoVendas, 0)
    assert.equal(l.comissaoEsperada, 0)
    assert.equal(l.comissaoConfirmada, 0)
    assert.equal(l.comissaoRecebida, 0)
    assert.equal(l.receitaRealizada, 0)
    assert.equal(l.origemDoLabel, 'JANELA_DE_OBSERVACAO_ENCERRADA')
    assert.equal(l.featureVersion, FEATURE_VERSION)
  })

  test('a origem do negativo é distinta da do positivo', () => {
    assert.notEqual(montarLabelNegativo().origemDoLabel, 'SALE_COMMISSION_COMPROVADA')
  })
})

describe('Distribuição real — status "publicado" NÃO é prova', () => {
  test('identificador externo do canal prova distribuição', () => {
    const e = avaliarDistribuicaoReal({
      publicacaoExternaId: 'media-123',
      dataPublicacao: new Date('2026-09-01T19:00:00.000Z'),
    })
    assert.equal(e.distribuida, true)
    assert.equal(e.identificadorExterno, 'media-123')
    assert.equal(e.distribuidoEm?.toISOString(), '2026-09-01T19:00:00.000Z')
  })

  test('sem identificador externo NÃO há distribuição', () => {
    for (const id of [null, undefined, '', '   ']) {
      const e = avaliarDistribuicaoReal({ publicacaoExternaId: id, dataPublicacao: new Date() })
      assert.equal(e.distribuida, false, `id ${JSON.stringify(id)} não podia contar como distribuição`)
      assert.equal(e.distribuidoEm, null)
    }
  })

  test('identificador sem data de publicação também não basta', () => {
    // Sem o instante não dá para datar a amostra nem contar a janela.
    for (const d of [null, undefined, new Date('xx')]) {
      assert.equal(avaliarDistribuicaoReal({ publicacaoExternaId: 'media-1', dataPublicacao: d }).distribuida, false)
    }
  })

  test('a regra NÃO olha `status` — é o sinal ambíguo que ela veio separar', () => {
    const fonte = lerFonte('lib/ml-captura-publicacao.ts')
    const trecho = fonte.slice(
      fonte.indexOf('export function avaliarDistribuicaoReal'),
      fonte.indexOf('export interface ResultadoDaCaptura')
    )
    assert.ok(!/status/.test(trecho), 'status publicado não pode entrar na decisão')
  })

  test('a regra fica no CORE, não acoplada ao Instagram', () => {
    const fonte = lerFonte('lib/ml-captura-publicacao.ts')
    assert.ok(!/instagram|mediaId|publicarContainer/i.test(fonte.replace(/\/\*[\s\S]*?\*\//g, '')),
      'o core não pode citar um provider específico no código')
  })
})

describe('Gatilhos ligados no código', () => {
  test('A — só os caminhos de DISTRIBUIÇÃO REAL capturam a amostra', () => {
    // Revisão: publicação interna deixou de gerar amostra.
    // P2.2: as duas rotas não falam mais com a Meta — registram o trabalho,
    // e quem distribui (e captura) é o executor único da publicação.
    const executor = lerFonte('lib/trabalhos-longos/publicar-instagram.ts')
    assert.match(executor, /capturarSnapshotDePublicacao/, 'o executor distribui de verdade e precisa capturar')
    for (const rota of ['app/api/conteudos/[id]/publicar/route.ts', 'app/api/cron/publicar/route.ts']) {
      assert.match(lerFonte(rota), /executorDaPublicacao\(\)/, `${rota} precisa delegar ao executor`)
    }
    // A listagem marca como publicado DENTRO do app: nada circulou.
    assert.ok(
      !/capturarSnapshot/.test(lerFonte('app/api/conteudos/route.ts')),
      'a listagem não pode gerar amostra: é publicação interna'
    )
  })

  test('no cron, só o caminho com mediaId captura', () => {
    // P2.2: os dois caminhos internos do cron (sem vídeo, sem canal) ficam
    // na rota e NÃO capturam; a captura mora no executor, uma vez só.
    const cron = lerFonte('app/api/cron/publicar/route.ts').replace(/\/\/.*$/gm, '')
    assert.ok(!/capturar\(|capturarSnapshot/.test(cron), 'os dois caminhos internos não podem capturar')
    const executor = lerFonte('lib/trabalhos-longos/publicar-instagram.ts')
    const chamadas = executor.match(/await capturarSnapshotDePublicacao\(/g) ?? []
    assert.equal(chamadas.length, 1, 'uma captura só, no caminho distribuído')
    // E a única chamada vem depois do identificador externo ser gravado.
    const posMediaId = executor.indexOf('publicacaoExternaId: mediaId')
    assert.ok(posMediaId > 0 && executor.indexOf('await capturarSnapshotDePublicacao(') > posMediaId)
  })

  test('B — a promoção tenta rotular quando fica elegível', () => {
    const fonte = lerFonte('lib/promocao-operacao-real.ts')
    assert.match(fonte, /if \(veredito\?\.elegivel\)/)
    assert.match(fonte, /rotularAmostraDeOperacaoReal\(entrada\.workspaceId, entrada\.saleId\)/)
  })

  test('C — comissão CONFIRMED/RECEIVED reavalia e rotula', () => {
    const fonte = lerFonte('lib/vendas-comissoes.ts')
    assert.match(fonte, /params\.status === 'CONFIRMED' \|\| params\.status === 'RECEIVED'/)
    assert.match(fonte, /rotularAmostraDeOperacaoReal\(params\.workspaceId, commission\.saleId\)/)
  })

  test('D — o cron da janela existe, exige segredo e está agendado', () => {
    const rota = lerFonte('app/api/cron/ml-janela-observacao/route.ts')
    assert.match(rota, /CRON_SECRET/)
    assert.match(rota, /status: 401/)
    assert.match(rota, /fecharJanelasDeObservacao/)
    // O agendamento saiu do `vercel.json` (o plano Hobby recusava as
    // frequências do projeto e deixava o deploy travado) e passou para o
    // GitHub Actions. A exigência continua a mesma: este cron TEM de estar
    // agendado em algum lugar.
    assert.match(lerFonte('.github/workflows/patrono-crons.yml'), /ml-janela-observacao/)
  })

  test('nenhum gatilho derruba a operação principal quando o ML falha', () => {
    assert.match(lerFonte('lib/promocao-operacao-real.ts'), /catch \(e\)[\s\S]{0,300}console\.error/)
  })

  test('a rotulagem NUNCA cria snapshot — só rotula o que já foi capturado', () => {
    const fonte = lerFonte('lib/ml-operacao-real.ts')
    assert.ok(!/mLFeatureSnapshot\.create/.test(fonte), 'criar aqui reconstruiria features possivelmente editadas')
    assert.match(fonte, /SEM_AMOSTRA_CAPTURADA/)
  })

  test('a limitação de conteúdo republicado está declarada', () => {
    assert.equal(LIMITACAO_DE_REVISAO.chave, 'ml:revisao-de-conteudo-republicado')
    assert.match(LIMITACAO_DE_REVISAO.explicacao, /versionar a revisão/i)
  })
})

// ── Banco ───────────────────────────────────────────────────────────────

let workspaceA = ''
let workspaceB = ''
let userA = ''
let userB = ''
let produtoA = ''
let produtoB = ''
const criados: string[] = []

async function limpar(ws: string) {
  await prisma.mLFeatureSnapshot.deleteMany({ where: { workspaceId: ws } })
  await prisma.commission.deleteMany({ where: { workspaceId: ws } })
  await prisma.sale.deleteMany({ where: { workspaceId: ws } })
  await prisma.conteudo.deleteMany({ where: { workspaceId: ws } })
  await prisma.auditLog.deleteMany({ where: { workspaceId: ws } })
}

/**
 * `distribuido: true` simula o canal tendo devolvido um identificador —
 * `publicacaoExternaId` é a evidência que o core exige. Sem ele o conteúdo
 * está apenas marcado como publicado DENTRO do app.
 */
async function criarConteudo(
  opcoes: { roteiro?: string; publicadoEm?: Date | null; ws?: string; distribuido?: boolean } = {}
) {
  const ws = opcoes.ws ?? workspaceA
  const distribuido = opcoes.distribuido !== false
  return (
    await prisma.conteudo.create({
      data: {
        workspaceId: ws,
        userId: ws === workspaceA ? userA : userB,
        produtoId: ws === workspaceA ? produtoA : produtoB,
        roteiro: opcoes.roteiro ?? 'Você já viu esse produto? Ele resolve tudo.',
        chamadaAcao: 'Link na bio',
        duracao: 30,
        redeSocial: 'tiktok',
        status: 'publicado',
        dataPublicacao: opcoes.publicadoEm === undefined ? new Date() : opcoes.publicadoEm,
        publicacaoExternaId: distribuido ? `media-${Math.random().toString(36).slice(2, 10)}` : null,
      },
      select: { id: true },
    })
  ).id
}

async function criarVenda(opcoes: { contentId?: string | null; statusComissao?: string; ws?: string } = {}) {
  const ws = opcoes.ws ?? workspaceA
  const { sale, commission } = await registrarResultado({
    workspaceId: ws,
    actorUserId: ws === workspaceA ? userA : userB,
    dataOrigin: 'USER_REPORTED',
    productId: ws === workspaceA ? produtoA : produtoB,
    contentId: opcoes.contentId ?? null,
    amount: 200,
    status: 'CONFIRMED',
    expectedCommission: 20,
    idempotencyKey: `b41-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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

async function promover(saleId: string) {
  return promoverPorCorrecaoManual({
    workspaceId: workspaceA,
    saleId,
    responsavelUserId: userA,
    motivo: MOTIVO_OK,
    referencia: `extrato-${saleId}`,
  })
}

describe(
  'Bloco 4.1 no banco — captura prospectiva e gatilhos',
  { skip: !TEM_BANCO ? 'DATABASE_URL ausente — este arquivo exige Postgres' : false },
  () => {
    before(async () => {
      const marca = Date.now()
      for (const nome of ['A', 'B']) {
        const ws = await prisma.workspace.create({
          data: { name: `B41-${nome}`, ownerId: `b41-${nome}-${marca}` },
          select: { id: true },
        })
        criados.push(ws.id)
      }
      ;[workspaceA, workspaceB] = criados

      const criarUser = async (ws: string, sufixo: string) =>
        (
          await prisma.user.create({
            data: {
              email: `b41-${sufixo}-${marca}@teste.local`,
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
              nome: 'Produto Bloco 4.1',
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

    // ── PROVA OBRIGATÓRIA: imutabilidade da observação ───────────────

    test('editar o conteúdo depois NÃO altera a feature histórica', async () => {
      await limpar(workspaceA)
      // 1. publica com hook A (pergunta)
      const contentId = await criarConteudo({ roteiro: 'Você já viu esse produto? Resolve tudo.' })
      const captura = await capturarSnapshotDePublicacao({ workspaceId: workspaceA, contentId })
      assert.equal(captura.capturado, true, captura.explicacao)

      const antes = await prisma.mLFeatureSnapshot.findUnique({
        where: { id: captura.snapshotId! },
        select: { features: true, labeledAt: true },
      })
      const hookOriginal = (antes?.features as Record<string, unknown>).hook_type
      assert.equal(antes?.labeledAt, null, 'a captura nasce sem rótulo')

      // 2. a proprietária edita o conteúdo para um hook diferente
      await prisma.conteudo.update({
        where: { id: contentId },
        data: { roteiro: 'Compre agora com 50% de desconto por tempo limitado.' },
      })

      // 3. uma venda comprovada chega e rotula a amostra
      const { saleId } = await criarVenda({ contentId, statusComissao: 'RECEIVED' })
      const r = await promover(saleId)
      assert.equal(r.promovido, true, r.explicacao)

      // 4. a feature histórica continua sendo a do momento da publicação
      const depois = await prisma.mLFeatureSnapshot.findUnique({
        where: { id: captura.snapshotId! },
        select: { features: true, labeledAt: true, label: true },
      })
      assert.equal(
        (depois?.features as Record<string, unknown>).hook_type,
        hookOriginal,
        'a observação histórica foi reescrita — é exatamente o vazamento que o Bloco 4.1 corrige'
      )
      assert.ok(depois?.labeledAt, 'o rótulo foi adicionado depois')
      assert.equal((depois?.label as Record<string, unknown>).converted, true)
    })

    test('a captura nasce sem label e sem labeledAt', async () => {
      await limpar(workspaceA)
      const contentId = await criarConteudo()
      const r = await capturarSnapshotDePublicacao({ workspaceId: workspaceA, contentId })
      const snap = await prisma.mLFeatureSnapshot.findUnique({ where: { id: r.snapshotId! } })
      assert.equal(snap?.label, null)
      assert.equal(snap?.labeledAt, null)
      assert.equal(snap?.entityType, ENTIDADE_DA_AMOSTRA)
      assert.equal(snap?.featureVersion, FEATURE_VERSION)
      assert.ok(snap?.capturedAt instanceof Date)
    })

    // ── Idempotência ─────────────────────────────────────────────────

    test('publicar duas vezes o mesmo conteúdo não duplica snapshot', async () => {
      await limpar(workspaceA)
      const contentId = await criarConteudo()
      const a = await capturarSnapshotDePublicacao({ workspaceId: workspaceA, contentId })
      const b = await capturarSnapshotDePublicacao({ workspaceId: workspaceA, contentId })
      assert.equal(a.capturado, true)
      assert.equal(b.capturado, false)
      assert.equal(b.motivo, 'JA_CAPTURADO')
      assert.equal(a.snapshotId, b.snapshotId)
      assert.equal(await prisma.mLFeatureSnapshot.count({ where: { workspaceId: workspaceA } }), 1)
    })

    test('duas capturas SIMULTÂNEAS criam uma só', async () => {
      await limpar(workspaceA)
      const contentId = await criarConteudo()
      const [a, b] = await Promise.all([
        capturarSnapshotDePublicacao({ workspaceId: workspaceA, contentId }),
        capturarSnapshotDePublicacao({ workspaceId: workspaceA, contentId }),
      ])
      assert.equal([a, b].filter((r) => r.capturado).length, 1)
      assert.equal(await prisma.mLFeatureSnapshot.count({ where: { workspaceId: workspaceA } }), 1)
    })

    test('promoção repetida não duplica rótulo nem linha', async () => {
      await limpar(workspaceA)
      const contentId = await criarConteudo()
      await capturarSnapshotDePublicacao({ workspaceId: workspaceA, contentId })
      const { saleId } = await criarVenda({ contentId, statusComissao: 'RECEIVED' })

      await promover(saleId)
      await promover(saleId)
      await promover(saleId)

      assert.equal(await prisma.mLFeatureSnapshot.count({ where: { workspaceId: workspaceA } }), 1)
      const conta = await contarAmostrasRotuladas(workspaceA)
      assert.equal(conta.total, 1)
      assert.equal(conta.positivas, 1)
    })

    test('mudança de comissão repetida não duplica', async () => {
      await limpar(workspaceA)
      const contentId = await criarConteudo()
      await capturarSnapshotDePublicacao({ workspaceId: workspaceA, contentId })
      const { saleId, commissionId } = await criarVenda({ contentId, statusComissao: 'RECEIVED' })
      await promover(saleId)

      for (let i = 0; i < 3; i++) {
        await atualizarComissao({
          workspaceId: workspaceA,
          commissionId,
          actorUserId: userA,
          status: 'RECEIVED',
          receivedAmount: 15,
        })
      }
      assert.equal(await prisma.mLFeatureSnapshot.count({ where: { workspaceId: workspaceA } }), 1)
    })

    test('cron da janela repetido não cria linhas novas', async () => {
      await limpar(workspaceA)
      const publicadoEm = new Date(Date.now() - 40 * DIA)
      const contentId = await criarConteudo({ publicadoEm })
      await capturarSnapshotDePublicacao({ workspaceId: workspaceA, contentId, agora: publicadoEm })

      const um = await fecharJanelasDeObservacao({ workspaceId: workspaceA })
      const dois = await fecharJanelasDeObservacao({ workspaceId: workspaceA })

      assert.equal(um.rotulados, 1)
      assert.equal(dois.rotulados, 0, 'rotulado não é reexaminado')
      assert.equal(dois.examinados, 0)
      assert.equal(await prisma.mLFeatureSnapshot.count({ where: { workspaceId: workspaceA } }), 1)
    })

    // ── GATILHO C: comissão tardia ───────────────────────────────────

    test('promoção ANTES da comissão: nada é rotulado; a comissão depois rotula', async () => {
      // O caso que o gatilho da promoção sozinho não cobre.
      await limpar(workspaceA)
      const contentId = await criarConteudo()
      await capturarSnapshotDePublicacao({ workspaceId: workspaceA, contentId })
      const { saleId, commissionId } = await criarVenda({ contentId })

      const promocao = await promover(saleId)
      assert.equal(promocao.promovido, true, promocao.explicacao)
      assert.equal(promocao.veredito?.elegivel, false, 'comissão ainda EXPECTED')

      let snap = await prisma.mLFeatureSnapshot.findFirst({ where: { workspaceId: workspaceA } })
      assert.equal(snap?.labeledAt, null, 'nenhum rótulo com a venda ainda inelegível')

      // Agora a comissão é reconhecida — o GATILHO C assume.
      await atualizarComissao({
        workspaceId: workspaceA,
        commissionId,
        actorUserId: userA,
        status: 'RECEIVED',
        confirmedAmount: 18,
        receivedAmount: 15,
      })

      snap = await prisma.mLFeatureSnapshot.findFirst({ where: { workspaceId: workspaceA } })
      assert.ok(snap?.labeledAt, 'o gatilho da comissão rotulou sozinho')
      const label = snap?.label as Record<string, unknown>
      assert.equal(label.converted, true)
      assert.equal(label.receitaRealizada, 15)
    })

    // ── Não contaminar produção ──────────────────────────────────────

    test('USER_REPORTED não rotula positivo', async () => {
      await limpar(workspaceA)
      const contentId = await criarConteudo()
      await capturarSnapshotDePublicacao({ workspaceId: workspaceA, contentId })
      const { saleId, commissionId } = await criarVenda({ contentId, statusComissao: 'RECEIVED' })

      // Sem promoção: a venda continua USER_REPORTED.
      await atualizarComissao({
        workspaceId: workspaceA,
        commissionId,
        actorUserId: userA,
        status: 'RECEIVED',
        receivedAmount: 15,
      })

      const snap = await prisma.mLFeatureSnapshot.findFirst({ where: { workspaceId: workspaceA } })
      assert.equal(snap?.labeledAt, null)
      assert.equal((await contarAmostrasRotuladas(workspaceA)).total, 0)
      assert.equal(saleId.length > 0, true)
    })

    test('venda inelegível não vira label positivo', async () => {
      await limpar(workspaceA)
      const contentId = await criarConteudo()
      await capturarSnapshotDePublicacao({ workspaceId: workspaceA, contentId })
      const { saleId } = await criarVenda({ contentId }) // comissão EXPECTED
      await promover(saleId)

      const snap = await prisma.mLFeatureSnapshot.findFirst({ where: { workspaceId: workspaceA } })
      assert.equal(snap?.labeledAt, null)
    })

    // ── Negativos ────────────────────────────────────────────────────

    test('janela aberta NÃO vira negativo prematuro', async () => {
      await limpar(workspaceA)
      const contentId = await criarConteudo({ publicadoEm: new Date() })
      await capturarSnapshotDePublicacao({ workspaceId: workspaceA, contentId })

      const r = await rotularNegativoSeJanelaEncerrada({ workspaceId: workspaceA, contentId })
      assert.equal(r.rotulado, false)
      assert.equal(r.motivo, 'JANELA_ABERTA')
      const snap = await prisma.mLFeatureSnapshot.findFirst({ where: { workspaceId: workspaceA } })
      assert.equal(snap?.labeledAt, null)
    })

    test('janela encerrada SEM venda nenhuma → negativo', async () => {
      await limpar(workspaceA)
      const publicadoEm = new Date(Date.now() - 40 * DIA)
      const contentId = await criarConteudo({ publicadoEm })
      await capturarSnapshotDePublicacao({ workspaceId: workspaceA, contentId, agora: publicadoEm })

      const r = await rotularNegativoSeJanelaEncerrada({ workspaceId: workspaceA, contentId })
      assert.equal(r.rotulado, true, r.explicacao)

      const snap = await prisma.mLFeatureSnapshot.findFirst({ where: { workspaceId: workspaceA } })
      const label = snap?.label as Record<string, unknown>
      assert.equal(label.converted, false)
      assert.equal(label.receitaRealizada, 0)
      assert.equal(label.origemDoLabel, 'JANELA_DE_OBSERVACAO_ENCERRADA')
    })

    test('janela encerrada COM venda em dúvida → fica SEM rótulo', async () => {
      // Venda relatada e não comprovada: declarar "não converteu" seria
      // afirmar mais do que se sabe.
      await limpar(workspaceA)
      const publicadoEm = new Date(Date.now() - 40 * DIA)
      const contentId = await criarConteudo({ publicadoEm })
      await capturarSnapshotDePublicacao({ workspaceId: workspaceA, contentId, agora: publicadoEm })
      await criarVenda({ contentId, statusComissao: 'RECEIVED' })

      const r = await rotularNegativoSeJanelaEncerrada({ workspaceId: workspaceA, contentId })
      assert.equal(r.rotulado, false)
      assert.equal(r.motivo, 'RESULTADO_EM_DUVIDA')
      const snap = await prisma.mLFeatureSnapshot.findFirst({ where: { workspaceId: workspaceA } })
      assert.equal(snap?.labeledAt, null)
    })

    test('conteúdo legado sem amostra NÃO recebe negativo retroativo', async () => {
      await limpar(workspaceA)
      const publicadoEm = new Date(Date.now() - 40 * DIA)
      const contentId = await criarConteudo({ publicadoEm })
      // Nenhuma captura: é o legado.
      const r = await rotularNegativoSeJanelaEncerrada({ workspaceId: workspaceA, contentId })
      assert.equal(r.rotulado, false)
      assert.equal(r.motivo, 'SEM_AMOSTRA_CAPTURADA')
      assert.equal(await prisma.mLFeatureSnapshot.count({ where: { workspaceId: workspaceA } }), 0)
    })

    test('a lacuna do legado é listada, não preenchida com palpite', async () => {
      await limpar(workspaceA)
      const legado = await criarConteudo({ publicadoEm: new Date(Date.now() - 40 * DIA) })
      const novo = await criarConteudo()
      await capturarSnapshotDePublicacao({ workspaceId: workspaceA, contentId: novo })

      const lacunas = await listarLacunasDeCaptura(workspaceA)
      assert.equal(lacunas.length, 1)
      assert.equal(lacunas[0].contentId, legado)
    })

    test('conteúdo já rotulado não é rerrotulado pela janela', async () => {
      await limpar(workspaceA)
      const publicadoEm = new Date(Date.now() - 40 * DIA)
      const contentId = await criarConteudo({ publicadoEm })
      await capturarSnapshotDePublicacao({ workspaceId: workspaceA, contentId, agora: publicadoEm })
      await rotularNegativoSeJanelaEncerrada({ workspaceId: workspaceA, contentId })

      const r = await rotularNegativoSeJanelaEncerrada({ workspaceId: workspaceA, contentId })
      assert.equal(r.rotulado, false)
      assert.equal(r.motivo, 'JA_ROTULADO')
    })

    // ── Isolamento e readiness ───────────────────────────────────────

    test('workspace A não captura nem rotula conteúdo de B', async () => {
      await limpar(workspaceA)
      await limpar(workspaceB)
      const contentB = await criarConteudo({ ws: workspaceB })

      const r = await capturarSnapshotDePublicacao({ workspaceId: workspaceA, contentId: contentB })
      assert.equal(r.capturado, false)
      assert.equal(r.motivo, 'CONTEUDO_NAO_ENCONTRADO')
      assert.equal(await prisma.mLFeatureSnapshot.count({ where: { workspaceId: workspaceA } }), 0)
      assert.equal(await prisma.mLFeatureSnapshot.count({ where: { workspaceId: workspaceB } }), 0)
    })

    test('o readiness conta positivos E negativos reais, só REAL_OPERATION', async () => {
      await limpar(workspaceA)

      // Um positivo comprovado.
      const positivo = await criarConteudo()
      await capturarSnapshotDePublicacao({ workspaceId: workspaceA, contentId: positivo })
      const { saleId } = await criarVenda({ contentId: positivo, statusComissao: 'RECEIVED' })
      await promover(saleId)

      // Um negativo por janela encerrada.
      const publicadoEm = new Date(Date.now() - 40 * DIA)
      const negativo = await criarConteudo({ publicadoEm })
      await capturarSnapshotDePublicacao({ workspaceId: workspaceA, contentId: negativo, agora: publicadoEm })
      await fecharJanelasDeObservacao({ workspaceId: workspaceA })

      const conta = await contarAmostrasRotuladas(workspaceA)
      assert.equal(conta.total, 2, 'positivo e negativo entram no total')
      assert.equal(conta.positivas, 1, 'só o positivo conta como positiva')
    })

    test('os limiares de prontidão continuam intocados', async () => {
      const gate = lerFonte('lib/ml-readiness-gate.ts')
      assert.match(gate, /minimoParaEstatistica: 30/)
      assert.match(gate, /minimoParaML: 200/)
      assert.match(gate, /minimoPositivosParaML: 20/)
    })

    test('nenhum modelo foi criado, treinado ou promovido', async () => {
      assert.equal(await prisma.mLModel.count({ where: { workspaceId: { in: criados } } }), 0)
      assert.equal(await prisma.mLTrainingRun.count({ where: { workspaceId: { in: criados } } }), 0)
      assert.equal(
        await prisma.mLModel.count({ where: { workspaceId: { in: criados }, status: 'ACTIVE' } }),
        0
      )
    })
    // ── DISTRIBUIÇÃO REAL vs PUBLICAÇÃO INTERNA ──────────────────────

    test('conteúdo apenas marcado publicado INTERNAMENTE → NÃO cria amostra', async () => {
      await limpar(workspaceA)
      const contentId = await criarConteudo({ distribuido: false })
      const r = await capturarSnapshotDePublicacao({ workspaceId: workspaceA, contentId })
      assert.equal(r.capturado, false)
      assert.equal(r.motivo, 'SEM_DISTRIBUICAO_COMPROVADA')
      assert.equal(await prisma.mLFeatureSnapshot.count({ where: { workspaceId: workspaceA } }), 0)
    })

    test('conteúdo sem provider conectado → NÃO cria amostra', async () => {
      // Mesmo cenário do cron quando o Instagram não está conectado: marca
      // como publicado, mas nenhum canal devolveu identificador.
      await limpar(workspaceA)
      const contentId = await criarConteudo({ distribuido: false })
      await prisma.conteudo.update({ where: { id: contentId }, data: { status: 'publicado' } })
      const r = await capturarSnapshotDePublicacao({ workspaceId: workspaceA, contentId })
      assert.equal(r.capturado, false)
      assert.equal(r.motivo, 'SEM_DISTRIBUICAO_COMPROVADA')
    })

    test('agendado vencido mas não distribuído → NÃO cria amostra', async () => {
      await limpar(workspaceA)
      const contentId = await criarConteudo({ distribuido: false, publicadoEm: new Date(Date.now() - 5 * DIA) })
      await prisma.conteudo.update({
        where: { id: contentId },
        data: { status: 'agendado', dataAgendamento: new Date(Date.now() - 6 * DIA) },
      })
      const r = await capturarSnapshotDePublicacao({ workspaceId: workspaceA, contentId })
      assert.equal(r.capturado, false)
      assert.equal(r.motivo, 'SEM_DISTRIBUICAO_COMPROVADA')
      assert.equal(await prisma.mLFeatureSnapshot.count({ where: { workspaceId: workspaceA } }), 0)
    })

    test('canal confirmou com identificador → CRIA amostra', async () => {
      await limpar(workspaceA)
      const distribuidoEm = new Date(Date.now() - 2 * DIA)
      const contentId = await criarConteudo({ publicadoEm: distribuidoEm })
      const r = await capturarSnapshotDePublicacao({ workspaceId: workspaceA, contentId })
      assert.equal(r.capturado, true, r.explicacao)

      const snap = await prisma.mLFeatureSnapshot.findUnique({ where: { id: r.snapshotId! } })
      // capturedAt é o instante da DISTRIBUIÇÃO, não o de agora.
      assert.equal(snap?.capturedAt.toISOString(), distribuidoEm.toISOString())
      assert.equal(snap?.labeledAt, null)
    })

    test('repetir a confirmação da mesma publicação é idempotente', async () => {
      await limpar(workspaceA)
      const contentId = await criarConteudo()
      const a = await capturarSnapshotDePublicacao({ workspaceId: workspaceA, contentId })
      const b = await capturarSnapshotDePublicacao({ workspaceId: workspaceA, contentId })
      assert.equal(a.capturado, true)
      assert.equal(b.motivo, 'JA_CAPTURADO')
      assert.equal(await prisma.mLFeatureSnapshot.count({ where: { workspaceId: workspaceA } }), 1)
    })

    // ── Conteúdo não distribuído NUNCA vira negativo ─────────────────

    test('conteúdo NÃO distribuído nunca vira negativo, nem depois de 30 dias', async () => {
      // A trava central desta revisão.
      await limpar(workspaceA)
      const contentId = await criarConteudo({ distribuido: false, publicadoEm: new Date(Date.now() - 90 * DIA) })

      const r = await rotularNegativoSeJanelaEncerrada({ workspaceId: workspaceA, contentId })
      assert.equal(r.rotulado, false)
      // Sem amostra capturada, nem chega a olhar a janela.
      assert.ok(['SEM_DISTRIBUICAO_COMPROVADA', 'SEM_AMOSTRA_CAPTURADA'].includes(r.motivo))

      const varredura = await fecharJanelasDeObservacao({ workspaceId: workspaceA })
      assert.equal(varredura.rotulados, 0)
      assert.equal(await prisma.mLFeatureSnapshot.count({ where: { workspaceId: workspaceA } }), 0)
    })

    test('perder a evidência depois impede o negativo', async () => {
      // Cenário defensivo: a amostra existe, mas o identificador sumiu. Sem
      // prova de exposição, não se declara que não converteu.
      await limpar(workspaceA)
      const distribuidoEm = new Date(Date.now() - 40 * DIA)
      const contentId = await criarConteudo({ publicadoEm: distribuidoEm })
      await capturarSnapshotDePublicacao({ workspaceId: workspaceA, contentId })
      await prisma.conteudo.update({ where: { id: contentId }, data: { publicacaoExternaId: null } })

      const r = await rotularNegativoSeJanelaEncerrada({ workspaceId: workspaceA, contentId })
      assert.equal(r.rotulado, false)
      assert.equal(r.motivo, 'SEM_DISTRIBUICAO_COMPROVADA')
    })

    test('conteúdo DISTRIBUÍDO e sem venda vira negativo após a janela', async () => {
      await limpar(workspaceA)
      const distribuidoEm = new Date(Date.now() - 40 * DIA)
      const contentId = await criarConteudo({ publicadoEm: distribuidoEm })
      await capturarSnapshotDePublicacao({ workspaceId: workspaceA, contentId })

      const r = await rotularNegativoSeJanelaEncerrada({ workspaceId: workspaceA, contentId })
      assert.equal(r.rotulado, true, r.explicacao)
      const snap = await prisma.mLFeatureSnapshot.findFirst({ where: { workspaceId: workspaceA } })
      assert.equal((snap?.label as Record<string, unknown>).converted, false)
    })

    test('conteúdo DISTRIBUÍDO + venda elegível vira positivo', async () => {
      await limpar(workspaceA)
      const contentId = await criarConteudo({ publicadoEm: new Date(Date.now() - 2 * DIA) })
      await capturarSnapshotDePublicacao({ workspaceId: workspaceA, contentId })
      const { saleId } = await criarVenda({ contentId, statusComissao: 'RECEIVED' })
      const p = await promover(saleId)
      assert.equal(p.promovido, true, p.explicacao)

      const conta = await contarAmostrasRotuladas(workspaceA)
      assert.equal(conta.total, 1)
      assert.equal(conta.positivas, 1)
    })

    test('a janela conta da DISTRIBUIÇÃO, não de quando o registro foi marcado', async () => {
      await limpar(workspaceA)
      // Distribuído há 10 dias: a janela de 30 ainda está aberta, mesmo que
      // o cron rode hoje.
      const contentId = await criarConteudo({ publicadoEm: new Date(Date.now() - 10 * DIA) })
      await capturarSnapshotDePublicacao({ workspaceId: workspaceA, contentId })

      const r = await rotularNegativoSeJanelaEncerrada({ workspaceId: workspaceA, contentId })
      assert.equal(r.rotulado, false)
      assert.equal(r.motivo, 'JANELA_ABERTA')
    })
  }
)
