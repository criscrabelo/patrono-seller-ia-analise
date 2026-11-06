/**
 * P2.17.15 — Vitrine conforme o contrato oficial + Gestor de Vitrine.
 * Respostas do TikTok são FIXTURE; nenhuma chamada real.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { CONTRATO_DOCUMENTADO, corpoDoAdd, configuracaoDaVitrine, type CandidatoParaVitrine } from '../lib/tiktok-shop-vitrine'
import { decidirNaVitrine, DIAS_MINIMOS_NA_VITRINE, type SituacaoDoItem } from '../lib/gestor-de-vitrine'
import { situacaoNaVitrine } from '../lib/vitrine-situacao'

const AGORA = new Date('2026-11-20T12:00:00-03:00')
const ENV = {
  TIKTOK_SHOP_VITRINE_AUTOMATICA: 'true',
  TIKTOK_SHOP_PATH_SHOWCASE_ADD: '/affiliate_creator/202405/showcases/products/add',
  TIKTOK_SHOP_PATH_SHOWCASE_GET: '/affiliate_creator/202405/showcases/products',
  TIKTOK_SHOP_APP_KEY: 'fixture-key', TIKTOK_SHOP_APP_SECRET: 'fixture-secret', TIKTOK_SHOP_AUTHORIZE_URL: 'https://services.tiktokshop.com/open/authorize?service_id=1',
}

describe('contrato oficial (trecho indexado) refletido no código', () => {
  test('Add: add_type=PRODUCT_ID + product_ids, 1 a 20 produtos', () => {
    assert.deepEqual(corpoDoAdd(['1']), { add_type: 'PRODUCT_ID', product_ids: ['1'] })
    assert.throws(() => corpoDoAdd([]))
    assert.throws(() => corpoDoAdd(Array.from({ length: 21 }, (_, i) => String(i))))
  })
  test('caminhos documentados; Remove e campos de resposta AGUARDANDO CONFIRMAÇÃO OFICIAL', () => {
    assert.equal(CONTRATO_DOCUMENTADO.add.caminho, '/affiliate_creator/202405/showcases/products/add')
    assert.equal(CONTRATO_DOCUMENTADO.get.caminho, '/affiliate_creator/202405/showcases/products')
    assert.equal(CONTRATO_DOCUMENTADO.remove.grau, 'AGUARDANDO_CONFIRMACAO_OFICIAL')
    assert.equal(CONTRATO_DOCUMENTADO.resposta.grau, 'AGUARDANDO_CONFIRMACAO_OFICIAL')
    assert.equal(CONTRATO_DOCUMENTADO.screening.grau, 'AGUARDANDO_CONFIRMACAO_OFICIAL')
  })
  test('continua desligada por padrão; caminho diferente do documentado gera aviso; remoção desligada por padrão', () => {
    assert.equal(configuracaoDaVitrine({}).ligada, false)
    assert.deepEqual(configuracaoDaVitrine(ENV).divergencias, [])
    assert.equal(configuracaoDaVitrine({ ...ENV, TIKTOK_SHOP_PATH_SHOWCASE_GET: '/affiliate_creator/202405/showcase/products' }).divergencias.length, 1)
    assert.equal(configuracaoDaVitrine(ENV).remocao.ligada, false)
    assert.match(configuracaoDaVitrine({ ...ENV, TIKTOK_SHOP_VITRINE_REMOCAO_AUTOMATICA: 'true' }).remocao.motivo ?? '', /AGUARDANDO CONFIRMAÇÃO OFICIAL/)
  })
})

describe('Gestor de Vitrine — decisões', () => {
  const base: SituacaoDoItem = { estadoNaVitrine: 'CONFIRMADO_NA_VITRINE', status: 'TESTANDO', amostraSuficiente: false, videosMedidos: 1, receitaPor1000Views: null, diasNaVitrine: 30, missaoAtiva: false, campanhaAtiva: false }
  const altBoa = { nome: 'FIXTURE B', status: 'ESCALAR' as const, receitaPor1000Views: 12, amostraSuficiente: true }
  test('nunca remove por poucas views: sem amostra = OBSERVAR, mesmo com alternativa melhor', () => {
    assert.equal(decidirNaVitrine({ ...base, views: 10 } as SituacaoDoItem, altBoa).decisao, 'OBSERVAR')
  })
  test('ESCALAR / MANTER pelo status econômico aprovado', () => {
    assert.equal(decidirNaVitrine({ ...base, status: 'ESCALAR', amostraSuficiente: true }, null).decisao, 'ESCALAR')
    assert.equal(decidirNaVitrine({ ...base, status: 'PROMISSOR', amostraSuficiente: true }, null).decisao, 'MANTER')
  })
  test('PAUSAR com amostra: SUBSTITUIR só com alternativa comprovadamente melhor; sem ela, OBSERVAR', () => {
    const fraco = { ...base, status: 'PAUSAR' as const, amostraSuficiente: true, videosMedidos: 3, receitaPor1000Views: 0.5 }
    assert.equal(decidirNaVitrine(fraco, altBoa).decisao, 'SUBSTITUIR')
    assert.equal(decidirNaVitrine(fraco, null).decisao, 'OBSERVAR')
    assert.equal(decidirNaVitrine(fraco, { ...altBoa, amostraSuficiente: false }).decisao, 'OBSERVAR', 'alternativa sem evidência não conta')
    assert.equal(decidirNaVitrine({ ...fraco, missaoAtiva: true }, altBoa).decisao, 'OBSERVAR', 'missão em curso segura a troca')
    assert.equal(decidirNaVitrine({ ...fraco, diasNaVitrine: DIAS_MINIMOS_NA_VITRINE - 1 }, altBoa).decisao, 'OBSERVAR')
  })
  test('REMOVER só por bloqueio objetivo (ENCERRADO); aguardando seller = OBSERVAR', () => {
    assert.equal(decidirNaVitrine({ ...base, status: 'ENCERRADO' }, null).decisao, 'REMOVER')
    assert.equal(decidirNaVitrine({ ...base, estadoNaVitrine: 'AGUARDANDO_APROVACAO', status: 'ENCERRADO' }, null).decisao, 'OBSERVAR')
  })
})

describe('cartão de Oportunidades: situação na vitrine (só leitura)', () => {
  const c = { fonte: 'tiktok-shop', providerId: 'tiktok-shop', externalId: '1', complianceBloqueante: false, validoAte: new Date('2027-01-01') }
  test('elegível · já está · aguardando seller · não elegível · dados pendentes', () => {
    assert.equal(situacaoNaVitrine(c, null, AGORA), 'ELEGIVEL')
    assert.equal(situacaoNaVitrine(c, { estado: 'CONFIRMADO_NA_VITRINE' }, AGORA), 'NA_VITRINE')
    assert.equal(situacaoNaVitrine(c, { estado: 'ENVIADO' }, AGORA), 'ELEGIVEL', 'enviado não é "na vitrine"')
    assert.equal(situacaoNaVitrine(c, { estado: 'AGUARDANDO_APROVACAO' }, AGORA), 'AGUARDANDO_SELLER')
    assert.equal(situacaoNaVitrine({ ...c, complianceBloqueante: true }, null, AGORA), 'NAO_ELEGIVEL')
    assert.equal(situacaoNaVitrine({ ...c, fonte: 'USER_PROVIDED' }, null, AGORA), 'DADOS_PENDENTES')
  })
  test('a tela de curadoria não importa o canal TikTok (guarda da rodada 61)', () => {
    assert.doesNotMatch(fs.readFileSync('lib/vitrine-situacao.ts', 'utf8'), /from ['"]/)
  })
})

const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')

describe('banco de TESTE: contrato no fio, remoção confirmada pelo Get, decisão com histórico', { skip: !TEM_BANCO ? 'exige banco de TESTE' : false }, () => {
  let prisma: typeof import('../lib/prisma').prisma
  let V: typeof import('../lib/tiktok-shop-vitrine')
  let G: typeof import('../lib/gestor-de-vitrine')
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  const PREFIXO = 'Conta de Teste — '
  let ws = ''
  const cand = (m: Partial<CandidatoParaVitrine>): CandidatoParaVitrine => ({
    id: 'c1', nome: 'FIXTURE Vitrine', fonte: 'tiktok-shop', providerId: 'tiktok-shop', externalId: '900000000000000891', status: 'APRESENTADO', complianceBloqueante: false, validoAte: new Date('2027-01-01'), score: 80, ...m,
  })
  const ok = (data: unknown) => new Response(JSON.stringify({ code: 0, message: 'Success', data, request_id: 'req-fixture' }), { status: 200 })

  before(async () => {
    ;[{ prisma }, V, G, { limparWorkspaceDeTeste: limpar }] = await Promise.all([import('../lib/prisma'), import('../lib/tiktok-shop-vitrine'), import('../lib/gestor-de-vitrine'), import('./_limpar-workspace-de-teste')])
    ws = (await prisma.workspace.create({ data: { name: `${PREFIXO}gestor de vitrine`, ownerId: `r89-${Date.now()}` }, select: { id: true } })).id
  })
  after(async () => {
    await prisma.vitrineTikTokShop.deleteMany({ where: { workspaceId: ws } })
    await limpar(prisma, ws, PREFIXO)
    await prisma?.$disconnect()
  })

  test('no fio: Add leva add_type=PRODUCT_ID; Get leva origin=SHOWCASE; motivo de entrada registrado', async () => {
    const vistos: { url: string; corpo: string | null }[] = []
    const fetcher = (async (url: string, init?: RequestInit) => {
      vistos.push({ url: String(url), corpo: (init?.body as string) ?? null })
      return String(url).includes('/add') ? ok({}) : ok({ products: [{ product_id: '900000000000000891' }] })
    }) as typeof fetch
    const cliente = { appKey: 'k', appSecret: 's', accessToken: 't', chaveDeLimite: `r89-${Math.random()}`, fetcher, esperar: async () => {} }
    const r = await V.adicionarAVitrine(ws, cand({}), { env: ENV, cliente, agora: AGORA })
    assert.equal(r.registro?.estado, 'CONFIRMADO_NA_VITRINE')
    assert.deepEqual(JSON.parse(vistos[0].corpo!), { add_type: 'PRODUCT_ID', product_ids: ['900000000000000891'] })
    assert.equal(new URL(vistos[1].url).searchParams.get('origin'), 'SHOWCASE')
    assert.match(r.registro?.motivoEntrada ?? '', /ranking de Oportunidades/)
  })

  test('remoção desligada por padrão: nenhuma chamada; ligada sem caminho: recusa', async () => {
    const r = await V.removerDaVitrine(ws, '900000000000000891', 'teste', { env: ENV, agora: AGORA })
    assert.equal(r.ok, false)
    assert.match(r.motivo, /só recomenda/)
  })

  test('remoção ligada com caminho: REMOVIDO só quando o Get confirma a ausência', async () => {
    let fase = 0
    const fetcher = (async (url: string) => {
      if (String(url).includes('/fixture/remove')) { fase = 1; return ok({}) }
      return ok({ products: fase === 1 ? [] : [{ product_id: '900000000000000891' }] })
    }) as typeof fetch
    const cliente = { appKey: 'k', appSecret: 's', accessToken: 't', chaveDeLimite: `r89r-${Math.random()}`, fetcher, esperar: async () => {} }
    const env = { ...ENV, TIKTOK_SHOP_VITRINE_REMOCAO_AUTOMATICA: 'true', TIKTOK_SHOP_PATH_SHOWCASE_REMOVE: '/fixture/remove' }
    const r = await V.removerDaVitrine(ws, '900000000000000891', 'SUBSTITUIR: fixture', { env, cliente, agora: AGORA })
    assert.equal(r.ok, true)
    const reg = await prisma.vitrineTikTokShop.findUniqueOrThrow({ where: { workspaceId_productId: { workspaceId: ws, productId: '900000000000000891' } } })
    assert.equal(reg.estado, 'REMOVIDO')
    assert.ok(reg.removidoEm)
  })

  test('Gestor: avalia e PERSISTE a decisão com histórico só na rodada (leitura não grava)', async () => {
    await prisma.vitrineTikTokShop.create({ data: { workspaceId: ws, productId: '900000000000000892', nomeProduto: 'FIXTURE Na Vitrine', estado: 'CONFIRMADO_NA_VITRINE', confirmadoEm: new Date(AGORA.getTime() - 20 * 864e5) } })
    const leitura = await G.avaliarVitrine(ws, { agora: AGORA })
    const item = leitura.itens.find((i) => i.productId === '900000000000000892')!
    assert.equal(item.decisao, 'OBSERVAR', 'sem amostra: observa')
    assert.equal((await prisma.vitrineTikTokShop.findFirstOrThrow({ where: { workspaceId: ws, productId: '900000000000000892' } })).decisao, null)
    await G.avaliarVitrine(ws, { agora: AGORA, persistir: true })
    const salvo = await prisma.vitrineTikTokShop.findFirstOrThrow({ where: { workspaceId: ws, productId: '900000000000000892' } })
    assert.equal(salvo.decisao, 'OBSERVAR')
    assert.ok((salvo.historico as { acao: string }[]).some((h) => h.acao === 'DECISAO'))
  })

  test('ciclo desligado: não chama nada, não decide nada', async () => {
    const r = await G.cicloDaVitrine(ws, { env: {}, agora: AGORA })
    assert.equal(r.ligada, false)
    assert.deepEqual(r.decisoes, [])
  })
})
