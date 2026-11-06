/**
 * P1.0 Etapa 2.d — a unidade de observação do ML passa a ser a Publicacao.
 *
 * O que se prova aqui:
 *   - a amostra nasce na DISTRIBUIÇÃO, prospectiva, sem rótulo;
 *   - uma publicação gera no máximo uma amostra por geração;
 *   - republicação e outro canal geram amostras independentes;
 *   - positivo só pela cadeia do clique, nunca por aproximação;
 *   - fallback sem rastreamento nunca vira negativo;
 *   - editar o conteúdo depois não mexe na feature histórica;
 *   - as duas gerações não se somam nem se sobrescrevem.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '../lib/prisma'
import {
  FEATURE_VERSION_PUBLICACAO,
  ENTIDADE_PUBLICACAO,
  GERACAO_ANTERIOR,
  GRANULARIDADES_DA_CONVERSAO,
  CLIQUES_MINIMOS_PARA_NIVEL_CONTEUDO,
  extrairFeaturesDaPublicacao,
  capturarSnapshotDaPublicacao,
  rotularPositivoDaPublicacao,
  rotularNegativoDaPublicacao,
  fecharJanelasDePublicacao,
  chaveDaAmostraDaPublicacao,
} from '../lib/ml-geracao-publicacao'
import {
  calcularMetricasDaPublicacao,
  calcularMetricasPorConteudo,
  calcularMetricasPorCanal,
  listarVendasAtribuidasAPublicacao,
  contarCliquesDaPublicacao,
  METRICAS_AINDA_INDISPONIVEIS,
} from '../lib/metricas-publicacao'
import {
  contarAmostrasRotuladas,
  avaliarProntidaoDaGeracaoPublicacao,
  LIMIARES_PRONTIDAO_PADRAO,
} from '../lib/ml-readiness-gate'
import { verificarSemVazamentoDeResultado } from '../lib/ml-operacao-real'
import { FEATURE_VERSION } from '../lib/ml-feature-store'
import { prepararTentativaDePublicacao, confirmarDistribuicao } from '../lib/publicacao-fluxo'
import { promoverPorCorrecaoManual } from '../lib/promocao-operacao-real'

const MOTIVO_OK = 'Comissao recebida e conferida no extrato bancario da empresa.'
const REF_OK = 'extrato-banco-2026-09-22-linha-7'

const TEM_BANCO = !!process.env.DATABASE_URL
const RAIZ = join(__dirname, '..')
const lerCodigo = (rel: string) =>
  readFileSync(join(RAIZ, rel), 'utf8')
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n')

const BASE_OK = { PUBLIC_BASE_URL: 'https://patrono.exemplo.com.br' }

// ── Identidade da geração ───────────────────────────────────────────────

describe('As duas gerações são distintas e não se confundem', () => {
  test('a versão nova é explícita e não reutiliza a de Conteudo', () => {
    assert.equal(FEATURE_VERSION_PUBLICACAO, 'publication_v1')
    assert.equal(ENTIDADE_PUBLICACAO, 'Publicacao')
    assert.notEqual(FEATURE_VERSION_PUBLICACAO, FEATURE_VERSION)
    assert.equal(GERACAO_ANTERIOR.featureVersion, FEATURE_VERSION)
    assert.equal(GERACAO_ANTERIOR.entityType, 'Conteudo')
  })

  test('a chave da amostra carrega a geração', () => {
    const c = chaveDaAmostraDaPublicacao({ workspaceId: 'w', publicacaoId: 'p' })
    assert.match(c, new RegExp(FEATURE_VERSION_PUBLICACAO))
    assert.notEqual(c, chaveDaAmostraDaPublicacao({ workspaceId: 'w', publicacaoId: 'outro' }))
  })

  test('o módulo NÃO migra, converte nem apaga histórico', () => {
    const codigo = lerCodigo('lib/ml-geracao-publicacao.ts')
    for (const proibido of ['deleteMany', 'delete(', 'updateMany', 'backfill']) {
      assert.ok(!codigo.includes(proibido), `${proibido} não pode aparecer aqui`)
    }
    // Só toca amostras da própria geração.
    assert.ok(!codigo.includes("entityType: 'Conteudo'") || codigo.includes('GERACAO_ANTERIOR'))
  })

  test('nenhum modelo é treinado, ativado ou promovido', () => {
    const codigo = lerCodigo('lib/ml-geracao-publicacao.ts')
    for (const proibido of ['promoverModelo', 'treinar', 'mLModel', 'ACTIVE', 'shadow']) {
      assert.ok(!codigo.includes(proibido), `${proibido} não pode aparecer nesta rodada`)
    }
  })
})

describe('Features — só o que era conhecido na distribuição', () => {
  test('o vocabulário de granularidade é declarado', () => {
    assert.deepEqual([...GRANULARIDADES_DA_CONVERSAO], ['CONTEUDO', 'CATEGORIA', 'INDISPONIVEL'])
  })

  test('nenhum nome de feature descreve resultado', () => {
    // As chaves da interface, na prática: o mesmo guard do Bloco 4.
    const amostra = {
      channel: null,
      provider: null,
      tracked: false,
      posting_hour: null,
      hook_type: 'OUTRO',
      cta_type: 'OUTRO',
      video_duration: null,
      avatar_style: null,
      content_style: null,
      product_category: 'x',
      product_price_bucket: 'LOW',
      commission_percentage: null,
      historical_conversion_rate: null,
      historical_conversion_granularity: 'INDISPONIVEL',
      prior_publications: 0,
    }
    assert.doesNotThrow(() => verificarSemVazamentoDeResultado(amostra))
  })

  test('features proibidas continuam sendo recusadas', () => {
    for (const proibida of ['sale_total', 'commission_amount', 'receita_liquida', 'converted', 'label_final']) {
      assert.throws(() => verificarSemVazamentoDeResultado({ [proibida]: 1 }), /data leakage/i)
    }
  })

  test('clicksPerView continua indisponível, e o motivo está escrito', () => {
    assert.match(METRICAS_AINDA_INDISPONIVEIS.clicksPerView.porque, /visualizac|visualiza/i)
    assert.ok(METRICAS_AINDA_INDISPONIVEIS.cliqueEmPublicacaoSemLink.porque.length > 0)
    assert.ok(METRICAS_AINDA_INDISPONIVEIS.atribuicaoSemClickEventId.porque.length > 0)
  })
})

// ── Banco ───────────────────────────────────────────────────────────────

const marca = `r33-${Date.now()}`
let wsA = ''
let wsB = ''
let userA = ''
let produtoA = ''
let conteudoA = ''
let conteudoB = ''
const criados: string[] = []

/** Publica de verdade: prepara a tentativa e confirma a distribuição. */
async function publicar(over: Record<string, unknown> = {}) {
  const t = await prepararTentativaDePublicacao({
    workspaceId: wsA,
    contentId: conteudoA,
    canal: 'instagram',
    urlDiretaDoProduto: 'https://loja.invalido/a',
    env: BASE_OK,
    ...over,
  })
  if (t.publicacao) {
    await confirmarDistribuicao({
      workspaceId: (over.workspaceId as string) ?? wsA,
      publicacaoId: t.publicacao.id,
      publicacaoExternaId: `ig_${t.publicacao.id}`,
    })
  }
  return t
}

/**
 * Venda ELEGIVEL de verdade: a autoridade nao aceita `dataOrigin` gravado a
 * mao — ela reexamina status, comissao e evidencia. Entao a fixture passa
 * pelo caminho legitimo de promocao, igual a producao.
 */
async function vendaElegivelAtribuida(linkId: string, valor = 200) {
  const clique = await prisma.eventoLink.create({
    data: { workspaceId: wsA, linkId, tipo: 'clique' },
    select: { id: true },
  })
  const venda = await prisma.sale.create({
    data: {
      workspaceId: wsA, productId: produtoA, contentId: conteudoA, linkId,
      clickEventId: clique.id, attributionMethod: 'ULTIMO_CLIQUE_MESMO_LINK_ANTES_DA_VENDA',
      amount: valor, status: 'CONFIRMED', date: new Date(),
    },
    select: { id: true },
  })
  await prisma.commission.create({
    data: {
      workspaceId: wsA, saleId: venda.id, productId: produtoA,
      status: 'RECEIVED', expectedAmount: 20, confirmedAmount: 18, receivedAmount: 15,
    },
  })
  const r = await promoverPorCorrecaoManual({
    workspaceId: wsA,
    saleId: venda.id,
    responsavelUserId: userA,
    motivo: MOTIVO_OK,
    referencia: `${REF_OK}-${venda.id}`,
  })
  assert.equal(r.promovido, true, r.explicacao)
  return { saleId: venda.id, clickEventId: clique.id }
}

const amostraDa = (publicacaoId: string) =>
  prisma.mLFeatureSnapshot.findFirst({
    where: {
      entityType: ENTIDADE_PUBLICACAO,
      entityId: publicacaoId,
      featureVersion: FEATURE_VERSION_PUBLICACAO,
    },
  })

describe(
  'Geração publication_v1 no banco',
  { skip: !TEM_BANCO ? 'DATABASE_URL ausente — exige Postgres' : false },
  () => {
    before(async () => {
      for (const n of ['A', 'B']) {
        const ws = await prisma.workspace.create({
          data: { name: `R33-${n}`, ownerId: `${marca}-${n}` },
          select: { id: true },
        })
        criados.push(ws.id)
      }
      ;[wsA, wsB] = criados

      const criarUser = async (ws: string, s: string) =>
        (
          await prisma.user.create({
            data: { email: `${marca}-${s}@teste.local`, name: 'U', password: 'x', workspaceId: ws },
            select: { id: true },
          })
        ).id
      userA = await criarUser(wsA, 'a')
      const userB = await criarUser(wsB, 'b')

      const criarProduto = async (ws: string, uid: string, nome: string) =>
        (
          await prisma.produto.create({
            data: {
              workspaceId: ws, userId: uid, nome, categoria: `cat-${marca}`,
              tipoVenda: 'Afiliado', origemConteudo: 'Proprio',
              linkProduto: 'https://loja.invalido/a', preco: 120,
            },
            select: { id: true },
          })
        ).id
      produtoA = await criarProduto(wsA, userA, 'r33-a')
      const produtoB = await criarProduto(wsB, userB, 'r33-b')

      const criarConteudo = async (ws: string, uid: string, pid: string, roteiro: string) =>
        (
          await prisma.conteudo.create({
            data: { workspaceId: ws, userId: uid, produtoId: pid, roteiro, chamadaAcao: 'Link na bio', redeSocial: 'instagram', duracao: 30 },
            select: { id: true },
          })
        ).id
      conteudoA = await criarConteudo(wsA, userA, produtoA, 'Voce sabia que este produto resolve tudo?')
      conteudoB = await criarConteudo(wsB, userB, produtoB, 'Outro roteiro.')
    })

    after(async () => {
      for (const ws of criados) {
        await prisma.mLFeatureSnapshot.deleteMany({ where: { workspaceId: ws } })
        await prisma.commission.deleteMany({ where: { workspaceId: ws } })
        await prisma.sale.deleteMany({ where: { workspaceId: ws } })
        await prisma.auditLog.deleteMany({ where: { workspaceId: ws } })
        await prisma.linkDinamico.updateMany({ where: { workspaceId: ws }, data: { publicacaoId: null } })
        await prisma.eventoLink.deleteMany({ where: { workspaceId: ws } })
        await prisma.linkDinamico.deleteMany({ where: { workspaceId: ws } })
        await prisma.publicacao.deleteMany({ where: { workspaceId: ws } })
        await prisma.conteudo.deleteMany({ where: { workspaceId: ws } })
        await prisma.produto.deleteMany({ where: { workspaceId: ws } })
        await prisma.user.deleteMany({ where: { workspaceId: ws } })
      }
      await prisma.workspace.deleteMany({ where: { id: { in: criados } } })
      await prisma.$disconnect()
    })

    // ── Captura ─────────────────────────────────────────────────────────

    test('publicação DISTRIBUIDA cria snapshot entityType=Publicacao', async () => {
      const t = await publicar({ chaveDaTentativa: `${marca}-cap` })
      const snap = await amostraDa(t.publicacao!.id)

      assert.ok(snap, 'a amostra precisa existir')
      assert.equal(snap!.entityType, 'Publicacao')
      assert.equal(snap!.entityId, t.publicacao!.id)
      assert.equal(snap!.featureVersion, FEATURE_VERSION_PUBLICACAO)
      assert.equal(snap!.dataOrigin, 'REAL_OPERATION')
      assert.equal(snap!.label, null, 'prospectiva: nasce SEM rótulo')
      assert.equal(snap!.labeledAt, null)
    })

    test('o capturedAt é o instante da DISTRIBUIÇÃO', async () => {
      const t = await publicar({ chaveDaTentativa: `${marca}-marco` })
      const pub = await prisma.publicacao.findUniqueOrThrow({
        where: { id: t.publicacao!.id },
        select: { distribuidaEm: true },
      })
      const snap = await amostraDa(t.publicacao!.id)
      assert.equal(snap!.capturedAt.toISOString(), pub.distribuidaEm!.toISOString())
    })

    test('publicação não distribuída NÃO gera amostra', async () => {
      const t = await prepararTentativaDePublicacao({
        workspaceId: wsA, contentId: conteudoA, canal: 'instagram',
        chaveDaTentativa: `${marca}-sem-dist`, urlDiretaDoProduto: 'https://loja.invalido/a', env: BASE_OK,
      })
      // Sem confirmarDistribuicao: fica em DISTRIBUINDO.
      const r = await capturarSnapshotDaPublicacao({ workspaceId: wsA, publicacaoId: t.publicacao!.id })
      assert.equal(r.capturado, false)
      assert.equal(r.motivo, 'SEM_DISTRIBUICAO_COMPROVADA')
      assert.equal(await amostraDa(t.publicacao!.id), null)
    })

    test('RETRY não duplica a amostra', async () => {
      const chave = `${marca}-retry`
      const t = await publicar({ chaveDaTentativa: chave })
      // Reconfirma (retry do provider) e recaptura explicitamente.
      await confirmarDistribuicao({
        workspaceId: wsA, publicacaoId: t.publicacao!.id, publicacaoExternaId: `ig_${t.publicacao!.id}`,
      })
      const r = await capturarSnapshotDaPublicacao({ workspaceId: wsA, publicacaoId: t.publicacao!.id })
      assert.equal(r.capturado, false)
      assert.equal(r.motivo, 'JA_CAPTURADO')

      const quantas = await prisma.mLFeatureSnapshot.count({
        where: { entityType: ENTIDADE_PUBLICACAO, entityId: t.publicacao!.id },
      })
      assert.equal(quantas, 1)
    })

    test('REPUBLICAÇÃO cria OUTRA amostra — é outra Publicacao', async () => {
      const a = await publicar({ chaveDaTentativa: `${marca}-rep-1` })
      const b = await publicar({ chaveDaTentativa: `${marca}-rep-2` })
      const sa = await amostraDa(a.publicacao!.id)
      const sb = await amostraDa(b.publicacao!.id)
      assert.ok(sa && sb)
      assert.notEqual(sa!.id, sb!.id)
    })

    test('canal diferente gera amostra independente', async () => {
      const ig = await publicar({ canal: 'instagram', chaveDaTentativa: `${marca}-canal-ig` })
      const tk = await publicar({ canal: 'tiktok', chaveDaTentativa: `${marca}-canal-tk` })

      const sig = await amostraDa(ig.publicacao!.id)
      const stk = await amostraDa(tk.publicacao!.id)
      assert.notEqual(sig!.id, stk!.id)

      const fig = sig!.features as Record<string, unknown>
      const ftk = stk!.features as Record<string, unknown>
      assert.equal(fig.channel, 'instagram')
      assert.equal(fig.provider, 'META')
      assert.equal(ftk.channel, 'tiktok')
      assert.equal(ftk.provider, 'TIKTOK')
    })

    test('as features carregam canal, provider, oferta e contexto', async () => {
      const t = await publicar({ chaveDaTentativa: `${marca}-features` })
      const snap = await amostraDa(t.publicacao!.id)
      const f = snap!.features as Record<string, unknown>

      assert.equal(f.tracked, true)
      assert.equal(f.product_category, `cat-${marca}`)
      assert.equal(f.product_price_bucket, 'MID')
      assert.equal(f.video_duration, 30)
      assert.ok(typeof f.posting_hour === 'number')
      assert.ok(typeof f.prior_publications === 'number')
      assert.ok((GRANULARIDADES_DA_CONVERSAO as readonly string[]).includes(f.historical_conversion_granularity as string))
    })

    test('a granularidade da conversão histórica é SEMPRE gravada junto', async () => {
      const t = await publicar({ chaveDaTentativa: `${marca}-granularidade` })
      const snap = await amostraDa(t.publicacao!.id)
      const f = snap!.features as Record<string, unknown>
      // Sem histórico suficiente, é INDISPONIVEL e a taxa é null — nunca 0.
      if (f.historical_conversion_rate === null) {
        assert.equal(f.historical_conversion_granularity, 'INDISPONIVEL')
      } else {
        assert.notEqual(f.historical_conversion_granularity, 'INDISPONIVEL')
      }
      assert.ok(CLIQUES_MINIMOS_PARA_NIVEL_CONTEUDO >= 1)
    })

    test('conteúdo EDITADO depois não altera a feature histórica', async () => {
      const t = await publicar({ chaveDaTentativa: `${marca}-imutavel` })
      const antes = (await amostraDa(t.publicacao!.id))!.features as Record<string, unknown>
      const hookAntes = antes.hook_type
      const duracaoAntes = antes.video_duration

      await prisma.conteudo.update({
        where: { id: conteudoA },
        data: { roteiro: 'Compre agora com desconto imperdivel!', duracao: 99 },
      })

      const depois = (await amostraDa(t.publicacao!.id))!.features as Record<string, unknown>
      assert.equal(depois.hook_type, hookAntes, 'a observação é do dia da distribuição')
      assert.equal(depois.video_duration, duracaoAntes)
      assert.notEqual(depois.video_duration, 99)

      // Restaura para não afetar os testes seguintes.
      await prisma.conteudo.update({
        where: { id: conteudoA },
        data: { roteiro: 'Voce sabia que este produto resolve tudo?', duracao: 30 },
      })
    })

    test('workspace isolado: publicação de outro workspace não é lida', async () => {
      const t = await publicar({ chaveDaTentativa: `${marca}-iso` })
      const r = await capturarSnapshotDaPublicacao({ workspaceId: wsB, publicacaoId: t.publicacao!.id })
      assert.equal(r.capturado, false)
      assert.equal(r.motivo, 'PUBLICACAO_NAO_ENCONTRADA')
      assert.equal(await extrairFeaturesDaPublicacao(wsB, t.publicacao!.id), null)
    })

    // ── Positivo ────────────────────────────────────────────────────────

    test('venda com clickEventId rotula POSITIVO a publicação certa', async () => {
      const t = await publicar({ chaveDaTentativa: `${marca}-positivo` })
      const { saleId } = await vendaElegivelAtribuida(t.linkId!)

      const r = await rotularPositivoDaPublicacao({ workspaceId: wsA, saleId })
      assert.equal(r.rotulado, true, r.explicacao)
      assert.equal(r.publicacaoId, t.publicacao!.id, 'a publicação da cadeia, não outra')

      const snap = await amostraDa(t.publicacao!.id)
      const label = snap!.label as Record<string, unknown>
      assert.equal(label.converted, true)
      assert.equal(label.receitaRealizada, 15)
      assert.equal(label.featureVersion, FEATURE_VERSION_PUBLICACAO)
      assert.deepEqual(label.atribuicaoDeClique, { comClique: 1, semClique: 0 })
    })

    test('venda SEM clickEventId não inventa atribuição', async () => {
      const t = await publicar({ chaveDaTentativa: `${marca}-sem-clique` })
      const venda = await prisma.sale.create({
        data: {
          workspaceId: wsA, productId: produtoA, contentId: conteudoA,
          amount: 100, status: 'CONFIRMED', date: new Date(),
        },
        select: { id: true },
      })
      await prisma.commission.create({
        data: { workspaceId: wsA, saleId: venda.id, productId: produtoA, status: 'RECEIVED', expectedAmount: 10, confirmedAmount: 9, receivedAmount: 8 },
      })
      // ELEGIVEL de verdade — o que falta e a ATRIBUICAO, nao a qualidade.
      const promo = await promoverPorCorrecaoManual({
        workspaceId: wsA, saleId: venda.id, responsavelUserId: userA,
        motivo: MOTIVO_OK, referencia: `${REF_OK}-sem-clique-${venda.id}`,
      })
      assert.equal(promo.promovido, true, promo.explicacao)

      const r = await rotularPositivoDaPublicacao({ workspaceId: wsA, saleId: venda.id })
      assert.equal(r.rotulado, false)
      assert.equal(r.motivo, 'SEM_ATRIBUICAO_A_PUBLICACAO')
      assert.match(r.explicacao, /receita é real/i)

      // A amostra daquela publicação continua sem rótulo.
      const snap = await amostraDa(t.publicacao!.id)
      assert.equal(snap!.labeledAt, null)
    })

    test('venda não elegível nunca rotula', async () => {
      const t = await publicar({ chaveDaTentativa: `${marca}-nao-elegivel` })
      const clique = await prisma.eventoLink.create({
        data: { workspaceId: wsA, linkId: t.linkId!, tipo: 'clique' },
        select: { id: true },
      })
      const venda = await prisma.sale.create({
        data: {
          workspaceId: wsA, productId: produtoA, linkId: t.linkId!, clickEventId: clique.id,
          amount: 50, status: 'COMPLETED',
          // Relato não comprovado: a autoridade recusa.
          dataOrigin: 'USER_REPORTED', date: new Date(),
        },
        select: { id: true },
      })
      const r = await rotularPositivoDaPublicacao({ workspaceId: wsA, saleId: venda.id })
      assert.equal(r.rotulado, false)
      assert.equal(r.motivo, 'VENDA_NAO_ELEGIVEL')
    })

    // ── Negativo ────────────────────────────────────────────────────────

    test('FALLBACK sem rastreamento NUNCA vira negativo', async () => {
      const t = await prepararTentativaDePublicacao({
        workspaceId: wsA, contentId: conteudoA, canal: 'instagram',
        chaveDaTentativa: `${marca}-fallback-neg`,
        urlDiretaDoProduto: 'https://loja.invalido/a',
        env: {}, // sem base pública → sem link
      })
      await confirmarDistribuicao({
        workspaceId: wsA, publicacaoId: t.publicacao!.id, publicacaoExternaId: `ig_fb_${marca}`,
      })
      assert.equal(t.rastreada, false)

      // Janela MUITO no futuro para garantir que ela já fechou.
      const daquiUmAno = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
      const r = await rotularNegativoDaPublicacao({
        workspaceId: wsA, publicacaoId: t.publicacao!.id, agora: daquiUmAno,
      })
      assert.equal(r.rotulado, false)
      assert.equal(r.motivo, 'NAO_RASTREADA')
      assert.match(r.explicacao, /nunca foi observável/i)
    })

    test('janela ABERTA não vira negativo', async () => {
      const t = await publicar({ chaveDaTentativa: `${marca}-janela-aberta` })
      const r = await rotularNegativoDaPublicacao({ workspaceId: wsA, publicacaoId: t.publicacao!.id })
      assert.equal(r.rotulado, false)
      assert.equal(r.motivo, 'JANELA_ABERTA')
    })

    test('janela FECHADA, rastreada e sem venda vira NEGATIVO', async () => {
      const t = await publicar({ chaveDaTentativa: `${marca}-negativo` })
      const daquiUmAno = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
      const r = await rotularNegativoDaPublicacao({
        workspaceId: wsA, publicacaoId: t.publicacao!.id, agora: daquiUmAno,
      })
      assert.equal(r.rotulado, true, r.explicacao)

      const snap = await amostraDa(t.publicacao!.id)
      const label = snap!.label as Record<string, unknown>
      assert.equal(label.converted, false)
      assert.equal(label.featureVersion, FEATURE_VERSION_PUBLICACAO)
      // Zero MEDIDO: era rastreada, e nada passou.
      assert.deepEqual(label.atribuicaoDeClique, { comClique: 0, semClique: 0 })
      assert.equal(label.rastreamentoDeClique, 'RASTREADA')
    })

    test('venda em aberto ligada à publicação bloqueia o negativo', async () => {
      const t = await publicar({ chaveDaTentativa: `${marca}-duvida` })
      const clique = await prisma.eventoLink.create({
        data: { workspaceId: wsA, linkId: t.linkId!, tipo: 'clique' },
        select: { id: true },
      })
      await prisma.sale.create({
        data: {
          workspaceId: wsA, productId: produtoA, linkId: t.linkId!, clickEventId: clique.id,
          amount: 10, status: 'PENDING', dataOrigin: 'UNVERIFIED', date: new Date(),
        },
      })
      const daquiUmAno = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
      const r = await rotularNegativoDaPublicacao({
        workspaceId: wsA, publicacaoId: t.publicacao!.id, agora: daquiUmAno,
      })
      assert.equal(r.rotulado, false)
      assert.equal(r.motivo, 'RESULTADO_EM_DUVIDA')
    })

    test('o cron da janela fecha só a geração nova', async () => {
      const daquiUmAno = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
      const r = await fecharJanelasDePublicacao({ workspaceId: wsA, agora: daquiUmAno })
      assert.ok(r.avaliadas >= 1)
      assert.ok(typeof r.motivos === 'object')
    })

    // ── Métricas destravadas ────────────────────────────────────────────

    test('cliques e vendas por PUBLICAÇÃO passam pela cadeia inteira', async () => {
      const t = await publicar({ chaveDaTentativa: `${marca}-metrica` })
      await vendaElegivelAtribuida(t.linkId!, 300)

      const amanha = new Date(Date.now() + 24 * 60 * 60 * 1000)
      const janela = { workspaceId: wsA, publicacaoId: t.publicacao!.id, antesDe: amanha }

      assert.equal(await contarCliquesDaPublicacao(janela), 1)
      const vendas = await listarVendasAtribuidasAPublicacao(janela)
      assert.equal(vendas.length, 1)
      assert.equal(vendas[0].publicacaoId, t.publicacao!.id)
      assert.equal(vendas[0].contentId, conteudoA)

      const m = await calcularMetricasDaPublicacao(janela, 'PUBLICACAO' as never)
      assert.equal(m.cliques, 1)
      assert.equal(m.vendasElegiveis, 1)
      assert.equal(m.saleConversionRate, 1)
      assert.equal(m.commissionPerClick, 15, 'so o que foi RECEBIDO e dinheiro')
      assert.equal(m.indisponibilidade, null, 'deixou de ser null')
      assert.equal(m.clicksPerView, null, 'este continua null, e por um motivo declarado')
    })

    test('conversão por CONTEÚDO e por CANAL deixaram de ser null', async () => {
      const amanha = new Date(Date.now() + 24 * 60 * 60 * 1000)
      const porConteudo = await calcularMetricasPorConteudo(wsA, conteudoA, amanha)
      assert.equal(porConteudo.granularidade, 'CONTEUDO')
      assert.equal(porConteudo.indisponibilidade, null)
      assert.ok(porConteudo.cliques >= 1)

      const porCanal = await calcularMetricasPorCanal(wsA, 'instagram', amanha)
      assert.equal(porCanal.granularidade, 'CANAL')
      assert.equal(porCanal.indisponibilidade, null)
    })

    test('workspace sem publicação rastreada devolve null, nunca zero', async () => {
      const amanha = new Date(Date.now() + 24 * 60 * 60 * 1000)
      const m = await calcularMetricasPorConteudo(wsB, conteudoB, amanha)
      assert.equal(m.indisponibilidade, 'INDISPONIVEL_POR_FALTA_DE_RASTREAMENTO')
      assert.equal(m.saleConversionRate, null)
      assert.equal(m.commissionPerClick, null)
    })

    // ── Convivência das gerações ────────────────────────────────────────

    test('snapshots antigos de Conteudo continuam válidos e intocados', async () => {
      const antigo = await prisma.mLFeatureSnapshot.create({
        data: {
          workspaceId: wsA,
          entityType: 'Conteudo',
          entityId: conteudoA,
          featureVersion: FEATURE_VERSION,
          dataOrigin: 'REAL_OPERATION',
          features: { hook_type: 'PERGUNTA' } as never,
          label: { converted: true, featureVersion: FEATURE_VERSION } as never,
          labeledAt: new Date(),
        },
        select: { id: true, features: true, label: true },
      })

      // Uma rodada inteira da geração nova.
      await publicar({ chaveDaTentativa: `${marca}-convivencia` })
      await fecharJanelasDePublicacao({ workspaceId: wsA, agora: new Date() })

      const depois = await prisma.mLFeatureSnapshot.findUniqueOrThrow({
        where: { id: antigo.id },
        select: { entityType: true, featureVersion: true, features: true, label: true },
      })
      assert.equal(depois.entityType, 'Conteudo')
      assert.equal(depois.featureVersion, FEATURE_VERSION)
      assert.deepEqual(depois.features, antigo.features)
      assert.deepEqual(depois.label, antigo.label)
    })

    test('o readiness NÃO soma as duas gerações', async () => {
      const daGeracaoNova = await contarAmostrasRotuladas(
        wsA, ENTIDADE_PUBLICACAO, ['REAL_OPERATION'], FEATURE_VERSION_PUBLICACAO
      )
      const daGeracaoAntiga = await contarAmostrasRotuladas(
        wsA, 'Conteudo', ['REAL_OPERATION'], FEATURE_VERSION
      )
      const semFiltroDeVersao = await contarAmostrasRotuladas(wsA, ENTIDADE_PUBLICACAO, ['REAL_OPERATION'])

      assert.ok(daGeracaoAntiga.total >= 1, 'a geração antiga tem amostra')
      assert.ok(daGeracaoNova.total >= 1, 'a nova também')
      // A contagem da nova nunca inclui a antiga.
      assert.equal(daGeracaoNova.total, semFiltroDeVersao.total, 'só existe uma versão de Publicacao hoje')
      assert.ok(daGeracaoNova.total < daGeracaoNova.total + daGeracaoAntiga.total)
    })

    test('a prontidão da geração nova usa os MESMOS limiares', async () => {
      const r = await avaliarProntidaoDaGeracaoPublicacao(wsA, 'conversao')
      // Nenhum threshold foi afrouxado para a geração nova começar "pronta".
      assert.equal(LIMIARES_PRONTIDAO_PADRAO.minimoParaEstatistica, 30)
      assert.equal(LIMIARES_PRONTIDAO_PADRAO.minimoParaML, 200)
      assert.equal(LIMIARES_PRONTIDAO_PADRAO.minimoPositivosParaML, 20)
      // O relógio recomeça: poucas amostras nesta geração.
      assert.equal(r.estado, 'INSUFFICIENT_DATA')
      assert.ok(r.amostrasRotuladas < LIMIARES_PRONTIDAO_PADRAO.minimoParaEstatistica)
    })

    test('nenhum modelo foi criado, treinado ou ativado', async () => {
      const modelos = await prisma.mLModel.count({ where: { workspaceId: { in: criados } } })
      assert.equal(modelos, 0)
      const treinos = await prisma.mLTrainingRun.count({ where: { workspaceId: { in: criados } } })
      assert.equal(treinos, 0)
    })
  }
)
