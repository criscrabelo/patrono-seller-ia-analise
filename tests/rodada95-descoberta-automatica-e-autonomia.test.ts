/**
 * P2.18.1 — Descoberta automática e regra permanente de autonomia.
 *   - etapa manual sem "por quê / API / aprovação / como eliminar" não passa;
 *   - a rotina diária roda a descoberta oficial sozinha (só onde está liberada);
 *   - produto informado pela titular + o mesmo vindo da API = UM candidato,
 *     dela, com os dados oficiais;
 *   - "Tenho este produto em mãos" funciona com produto descoberto pela API.
 * TikTok simulado por FIXTURE (nunca rede real). Banco de TESTE.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { ETAPAS_DA_AUTONOMIA, resumoDaAutonomia } from '../lib/autonomia'
import { informadoComOficial, itemComOficial } from '../lib/curadoria'
import type { ProdutoDoTikTokShop } from '../lib/tiktok-shop-descoberta'

const FIXTURE = JSON.parse(fs.readFileSync('tests/fixtures/tiktok-shop/FIXTURE-busca-colaboracao-aberta.json', 'utf8'))
const ENV = {
  NEXTAUTH_SECRET: 'segredo-de-teste-p2181',
  TIKTOK_SHOP_APP_KEY: 'FIXTURE_APP_KEY',
  TIKTOK_SHOP_APP_SECRET: 'FIXTURE_APP_SECRET',
  TIKTOK_SHOP_AUTHORIZE_URL: 'https://services.tiktokshop.com/open/authorize?service_id=FIXTURE',
}
const resposta = (corpo: unknown) => new Response(JSON.stringify(corpo), { status: 200, headers: { 'content-type': 'application/json' } })

describe('regra permanente: manual é contingência, nunca desenho final', () => {
  test('toda etapa manual diz por quê, o que falta e como será eliminada', () => {
    for (const e of ETAPAS_DA_AUTONOMIA) {
      assert.ok(['AUTOMATICA', 'AUTOMATICA_COM_APROVACAO', 'CONTINGENCIA_MANUAL'].includes(e.situacao), e.id)
      if (e.situacao === 'CONTINGENCIA_MANUAL') {
        assert.ok(e.porqueManual && e.comoEliminar, `${e.id}: falta por quê/como eliminar`)
        assert.ok(e.apiNecessaria || e.aprovacaoExterna, `${e.id}: falta API/aprovação`)
        assert.ok(e.bloqueios.length > 0, `${e.id}: falta o tipo de bloqueio`)
        assert.ok(e.codigoOficialPronto || e.codigoFaltante, `${e.id}: falta dizer o código que falta`)
      } else {
        assert.equal(e.porqueManual, null, `${e.id}: automática não tem "por que manual"`)
        assert.equal(e.bloqueios.length, 0, e.id)
      }
    }
  })
  test('cobre o fluxo-alvo inteiro', () => {
    const ids = ETAPAS_DA_AUTONOMIA.map((e) => e.id)
    for (const id of ['descoberta', 'ranking', 'escolha', 'vitrine', 'amostra-pedido', 'amostra-acompanhamento', 'amostra-recebimento', 'conteudo', 'video', 'aprovacao', 'publicacao', 'marcacao', 'metricas', 'venda-comissao', 'aprendizado', 'missoes', 'agenda']) {
      assert.ok(ids.includes(id), `etapa ausente: ${id}`)
    }
    assert.equal(new Set(ids).size, ids.length)
  })
  test('descoberta: caminho padrão é a Affiliate API oficial; nenhum código nosso falta', () => {
    const d = ETAPAS_DA_AUTONOMIA.find((e) => e.id === 'descoberta')!
    assert.match(d.apiNecessaria!, /Search Open Collaboration Product/)
    assert.equal(d.codigoFaltante, null)
    assert.ok(d.codigoOficialPronto)
    assert.match(d.hoje, /fallback/)
  })
  test('resumo para a Torre', () => {
    const r = resumoDaAutonomia()
    assert.equal(r.automaticas + r.manuais.length, r.total)
    assert.ok(r.soDependemDoTikTok <= r.manuais.length)
  })
  test('a rotina diária chama a descoberta ANTES do ciclo', () => {
    const src = fs.readFileSync('app/api/cron/oportunidades/route.ts', 'utf8')
    const i = src.indexOf('await rodarDescobertaAutomatica(')
    assert.ok(i > 0 && i < src.indexOf('await rodarCicloDeOportunidades('))
  })
})

describe('informado + oficial: o oficial vence campo a campo, sem apagar o que a titular informou', () => {
  const oficial: ProdutoDoTikTokShop = {
    externalId: '1', nome: 'Nome oficial', preco: 59.9, moeda: 'BRL', comissaoPercentual: 12, vendas: 340, avaliacao: 4.8, numeroDeAvaliacoes: 90,
    estoque: null, imagem: null, categoria: null, link: null, loja: null, desconhecidos: [],
  }
  const informado = { id: 'c1', nome: 'Como ela escreveu', categoria: 'Casa', preco: 49.9, linkProduto: 'https://www.tiktok.com/view/product/1', imagem: 'https://img/x.jpg', compradoPelaTitular: true, usadoPelaTitular: false, createdAt: new Date(), providerId: 'tiktok-shop' }
  test('produto para o motor', () => {
    const p = informadoComOficial(informado, oficial)
    assert.equal(p.id, 'c1')
    assert.equal(p.preco, 59.9)
    assert.equal(p.comissaoPercentual, 12)
    assert.equal(p.categoria, 'Casa', 'categoria oficial null não apaga a informada')
    assert.deepEqual(p.imagens, ['https://img/x.jpg'])
    assert.deepEqual(informadoComOficial(informado, undefined).comissaoPercentual, null)
  })
  test('retrato do candidato', () => {
    const base = { nome: 'Como ela escreveu', linkProduto: 'https://www.tiktok.com/view/product/1', imagem: 'https://img/x.jpg', categoria: 'Casa', preco: 49.9, providerId: 'tiktok-shop', externalId: '1', comissaoPercentual: null, vendas: null, velocidadeDeVendas: null, avaliacao: null, numeroDeAvaliacoes: null, estoque: null }
    const r = itemComOficial(base, oficial)
    assert.equal(r.vendas, 340)
    assert.equal(r.nome, 'Nome oficial')
    assert.equal(r.linkProduto, base.linkProduto)
    assert.equal(r.imagem, base.imagem)
    assert.equal(r.estoque, null, 'desconhecido continua null, nunca 0')
  })
})

const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')

describe('descoberta automática (banco de TESTE, TikTok por FIXTURE)', { skip: !TEM_BANCO ? 'exige banco de TESTE' : false }, () => {
  let prisma: typeof import('../lib/prisma').prisma
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  let D: typeof import('../lib/descoberta-automatica')
  const PREFIXO = 'Conta de Teste — '
  const marca = `r95-${Date.now()}`
  const workspaces: string[] = []
  let ws = ''
  let semFonte = ''
  let user = ''
  const envAntes = { ...process.env }
  const fetchAntes = globalThis.fetch
  const chamadas: string[] = []

  before(async () => {
    ;[{ prisma }, { limparWorkspaceDeTeste: limpar }, D] = await Promise.all([import('../lib/prisma'), import('./_limpar-workspace-de-teste'), import('../lib/descoberta-automatica')])
    ws = (await prisma.workspace.create({ data: { name: `${PREFIXO}descoberta r95`, ownerId: marca }, select: { id: true } })).id
    semFonte = (await prisma.workspace.create({ data: { name: `${PREFIXO}sem fonte r95`, ownerId: `${marca}-b` }, select: { id: true } })).id
    workspaces.push(ws, semFonte)
    user = (await prisma.user.create({ data: { email: `${marca}@teste.local`, name: 'U', password: 'x', workspaceId: ws }, select: { id: true } })).id
    const { definirFlag } = await import('../lib/feature-flags')
    await definirFlag({ chave: 'TIKTOK_SHOP_CATALOGO', escopo: ws, ligada: true, motivo: 'teste P2.18.1' })
    await prisma.integracao.create({ data: { workspaceId: ws, userId: user, plataforma: 'tiktok-shop-creator', status: 'conectado', accessToken: 'ACESSO-FIXTURE-R95', refreshToken: 'R', tokenExpiry: new Date(Date.now() + 24 * 3600_000), extraData: { escopos: [] } } })
    // A titular já tinha informado a garrafa (mesmo product_id da FIXTURE) e marcou "comprei".
    await prisma.candidatoDeProduto.create({
      data: {
        workspaceId: ws, chaveDeOrigem: `${marca}-informado`, fonte: 'USER_PROVIDED', nome: 'Garrafa que eu tenho', categoria: 'Casa', preco: 49.9,
        linkProduto: 'https://www.tiktok.com/view/product/9000000000000000001', providerId: 'tiktok-shop', externalId: '9000000000000000001', compradoPelaTitular: true,
        score: 10, baseDeEvidencia: 10, confianca: 'SEM_HISTORICO_REAL', status: 'NOVO', coletadoEm: new Date(), validoAte: new Date('2027-01-01'), motivosPositivos: [], riscos: [], desconhecidos: [], porqueDestaPosicao: [], nivelDeRisco: 'BAIXO',
      },
    })
    Object.assign(process.env, ENV)
    globalThis.fetch = (async (u: string) => {
      chamadas.push(String(u))
      return resposta({ ...FIXTURE, data: { ...FIXTURE.data, next_page_token: undefined } })
    }) as typeof fetch
  })
  after(async () => {
    globalThis.fetch = fetchAntes
    for (const k of Object.keys(ENV)) if (!(k in envAntes)) delete process.env[k]
    Object.assign(process.env, envAntes)
    if (prisma) {
      await prisma.featureFlag.deleteMany({ where: { escopo: { in: workspaces } } })
      for (const w of workspaces) await limpar(prisma, w, PREFIXO)
    }
    await prisma?.$disconnect()
  })

  test('ensaio: diz onde rodaria, sem ir à rede nem gravar', async () => {
    const r = await D.rodarDescobertaAutomatica({ agora: new Date(), escrever: false, workspaceIds: [ws, semFonte] })
    assert.deepEqual(r.map((x) => x.rodou), [false, false])
    assert.match(r[0].motivo!, /Ensaio/)
    assert.match(r[1].motivo!, /não liberada/)
    assert.equal(chamadas.length, 0)
    assert.equal(await prisma.candidatoDeProduto.count({ where: { workspaceId: ws } }), 1)
  })

  test('operação: coleta sozinha (ator SISTEMA) só onde a fonte está liberada', async () => {
    const r = await D.rodarDescobertaAutomatica({ agora: new Date(), escrever: true, workspaceIds: [ws, semFonte] })
    assert.equal(r[0].rodou, true, String(r[0].motivo))
    assert.equal(r[1].rodou, false)
    assert.equal(chamadas.length, 1)
    assert.match(chamadas[0], /^https:\/\/open-api\.tiktokglobalshop\.com\/affiliate_creator\//)
    assert.equal(await prisma.candidatoDeProduto.count({ where: { workspaceId: semFonte } }), 0)
  })

  test('informado + descoberto = UM candidato, da titular, com dados oficiais', async () => {
    const garrafas = await prisma.candidatoDeProduto.findMany({ where: { workspaceId: ws, externalId: '9000000000000000001' } })
    assert.equal(garrafas.length, 1, 'o mesmo produto não pode aparecer duas vezes')
    const g = garrafas[0]
    assert.equal(g.fonte, 'USER_PROVIDED')
    assert.equal(g.compradoPelaTitular, true)
    assert.equal(g.comissaoPercentual, 12)
    assert.equal(g.vendas, 340)
    const daApi = await prisma.candidatoDeProduto.findMany({ where: { workspaceId: ws, fonte: 'tiktok-shop' } })
    assert.ok(daApi.length >= 1 && daApi.every((c) => c.externalId !== '9000000000000000001'))
  })

  test('"Tenho este produto em mãos" funciona com produto descoberto pela API', async () => {
    const A = await import('../lib/publicacao-assistida')
    const descoberto = await prisma.candidatoDeProduto.findFirstOrThrow({ where: { workspaceId: ws, fonte: 'tiktok-shop', complianceBloqueante: false } })
    const p = await A.prepararProximaPublicacao({ workspaceId: ws, userId: user, agora: new Date(), candidatoEmMaos: descoberto.id })
    assert.equal(p.candidatoId, descoberto.id)
    assert.equal((p.historico as { acao: string }[])[0].acao, 'PRODUTO_EM_MAOS')
  })

  test('repetir a descoberta não duplica nada', async () => {
    const antes = await prisma.candidatoDeProduto.count({ where: { workspaceId: ws } })
    await D.rodarDescobertaAutomatica({ agora: new Date(), escrever: true, workspaceIds: [ws] })
    assert.equal(await prisma.candidatoDeProduto.count({ where: { workspaceId: ws } }), antes)
  })
})
