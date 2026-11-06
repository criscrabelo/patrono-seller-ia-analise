/**
 * Vitrine (showcase) do TikTok Shop pela Affiliate Creator API.
 * Nunca "adicionado" sem o Get confirmar; screening = AGUARDANDO APROVAÇÃO;
 * escrita sem reenvio às cegas; desligada sem flag + caminhos oficiais.
 * As respostas do TikTok abaixo são FIXTURE (nenhuma chamada real).
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  configuracaoDaVitrine, validarColaboracao, selecionarElegiveis, exigeAprovacao, estadoAposConferencia, itensDaVitrine,
  type CandidatoParaVitrine,
} from '../lib/tiktok-shop-vitrine'
import { regraDaRota } from '../lib/modulos-rotas'

const AGORA = new Date('2026-11-20T12:00:00-03:00')
const ENV_LIGADO = {
  TIKTOK_SHOP_VITRINE_AUTOMATICA: 'true',
  TIKTOK_SHOP_PATH_SHOWCASE_ADD: '/fixture/showcase/add',
  TIKTOK_SHOP_PATH_SHOWCASE_GET: '/fixture/showcase/get',
  TIKTOK_SHOP_APP_KEY: 'fixture-key', TIKTOK_SHOP_APP_SECRET: 'fixture-secret', TIKTOK_SHOP_AUTHORIZE_URL: 'https://services.tiktokshop.com/open/authorize?service_id=1',
}
const cand = (m: Partial<CandidatoParaVitrine>): CandidatoParaVitrine => ({
  id: 'c1', nome: 'FIXTURE Árvore', fonte: 'tiktok-shop', providerId: 'tiktok-shop', externalId: '1729000000000000001', status: 'APRESENTADO',
  complianceBloqueante: false, validoAte: new Date('2027-01-01'), score: 70, ...m,
})

describe('liga/desliga', () => {
  test('desligada por padrão; sem os DOIS caminhos oficiais não liga; não existe caminho padrão para escrita', () => {
    assert.equal(configuracaoDaVitrine({}).ligada, false)
    assert.equal(configuracaoDaVitrine({ ...ENV_LIGADO, TIKTOK_SHOP_PATH_SHOWCASE_ADD: '' }).ligada, false)
    assert.equal(configuracaoDaVitrine({ ...ENV_LIGADO, TIKTOK_SHOP_PATH_SHOWCASE_GET: '' }).ligada, false)
    assert.equal(configuracaoDaVitrine({ ...ENV_LIGADO, TIKTOK_SHOP_APP_KEY: '' }).ligada, false)
    assert.equal(configuracaoDaVitrine(ENV_LIGADO).ligada, true)
    assert.doesNotMatch(fs.readFileSync('lib/tiktok-shop-vitrine.ts', 'utf8'), /caminhoPadrao/)
  })
  test('painel fica em Integrações (escrita externa não entra na tela de curadoria)', () => {
    assert.match(fs.readFileSync('app/(dashboard)/integracoes/page.tsx', 'utf8'), /<VitrineTikTokShop \/>/)
    assert.doesNotMatch(fs.readFileSync('app/(dashboard)/oportunidades/page.tsx', 'utf8'), /VitrineTikTokShop/)
  })
  test('rota protegida (sessão + Oportunidades)', () => {
    assert.ok(regraDaRota('/api/tiktok/vitrine', 'POST')?.modulos.includes('oportunidades'))
    assert.match(fs.readFileSync('app/api/tiktok/vitrine/route.ts', 'utf8'), /exigirSessao\(\)/)
  })
})

describe('seleção e colaboração', () => {
  test('colaboração só confirmada quando veio da busca oficial e ainda é válida', () => {
    assert.equal(validarColaboracao(cand({}), AGORA).ok, true)
    assert.equal(validarColaboracao(cand({ fonte: 'USER_PROVIDED' }), AGORA).ok, false, 'link informado à mão não prova colaboração')
    assert.equal(validarColaboracao(cand({ validoAte: new Date('2026-01-01') }), AGORA).ok, false)
    assert.equal(validarColaboracao(cand({ externalId: null }), AGORA).ok, false)
  })
  test('elegíveis: sem compliance, colaboração confirmada, fora o que já está/aguarda/confere; melhor score primeiro', () => {
    const lista = [cand({ id: 'a', externalId: '1', score: 50 }), cand({ id: 'b', externalId: '2', score: 90 }), cand({ id: 'c', externalId: '3', complianceBloqueante: true }), cand({ id: 'd', externalId: '4', fonte: 'USER_PROVIDED' }), cand({ id: 'e', externalId: '5' }), cand({ id: 'f', externalId: '6' })]
    const regs = [{ productId: '5', estado: 'AGUARDANDO_APROVACAO', tentativas: 1 }, { productId: '6', estado: 'FALHOU', tentativas: 2 }]
    assert.deepEqual(selecionarElegiveis(lista, regs, 5, AGORA).map((c) => c.id), ['b', 'a'])
  })
})

describe('leitura das respostas (nunca "adicionado" sem confirmação)', () => {
  test('screening/aprovação em qualquer campo = exige aprovação', () => {
    assert.equal(exigeAprovacao({ products: [{ product_id: '1', status: 'PENDING_REVIEW' }] }), true)
    assert.equal(exigeAprovacao({ need_seller_approval: true }), true)
    assert.equal(exigeAprovacao({ need_seller_approval: false }), false)
    assert.equal(exigeAprovacao({ products: [{ product_id: '1', status: 'SUCCESS' }] }), false)
  })
  test('estado após o Get', () => {
    const { itens } = itensDaVitrine({ products: [{ product_id: '1' }, { product_id: '2', status: 'IN_REVIEW' }] })
    assert.equal(estadoAposConferencia('1', itens, {}), 'CONFIRMADO_NA_VITRINE')
    assert.equal(estadoAposConferencia('2', itens, {}), 'AGUARDANDO_APROVACAO')
    assert.equal(estadoAposConferencia('3', itens, { result: 'apply submitted, pending seller review' }), 'AGUARDANDO_APROVACAO')
    assert.equal(estadoAposConferencia('3', itens, {}), 'NAO_ENCONTRADO_NA_VITRINE')
  })
})

const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')

describe('banco de TESTE: fluxo completo com TikTok simulado', { skip: !TEM_BANCO ? 'exige banco de TESTE' : false }, () => {
  let prisma: typeof import('../lib/prisma').prisma
  let V: typeof import('../lib/tiktok-shop-vitrine')
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  const PREFIXO = 'Conta de Teste — '
  let ws = ''

  /** TikTok simulado: guarda as chamadas e responde conforme o roteiro do teste. */
  function tiktok(roteiro: { add: () => Response | Promise<Response>; get: () => Response }) {
    const chamadas: string[] = []
    const fetcher = (async (url: string) => {
      const u = String(url)
      if (u.includes('/fixture/showcase/add')) { chamadas.push('ADD'); return roteiro.add() }
      chamadas.push('GET')
      return roteiro.get()
    }) as typeof fetch
    return { chamadas, cliente: { appKey: 'k', appSecret: 's', accessToken: 't', chaveDeLimite: `r88-${Math.random()}`, fetcher, esperar: async () => {} } }
  }
  const ok = (data: unknown) => new Response(JSON.stringify({ code: 0, message: 'Success', data, request_id: 'req-fixture' }), { status: 200 })

  before(async () => {
    ;[{ prisma }, V, { limparWorkspaceDeTeste: limpar }] = await Promise.all([import('../lib/prisma'), import('../lib/tiktok-shop-vitrine'), import('./_limpar-workspace-de-teste')])
    ws = (await prisma.workspace.create({ data: { name: `${PREFIXO}vitrine`, ownerId: `r88-${Date.now()}` }, select: { id: true } })).id
  })
  after(async () => {
    await prisma.vitrineTikTokShop.deleteMany({ where: { workspaceId: ws } })
    await limpar(prisma, ws, PREFIXO)
    await prisma?.$disconnect()
  })

  test('tabela com RLS e sem acesso público', async () => {
    const [l] = await prisma.$queryRaw<{ rls: boolean; acesso: boolean }[]>`
      select c.relrowsecurity as rls,
        (has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE')) as acesso
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'VitrineTikTokShop'`
    assert.deepEqual([l.rls, l.acesso], [true, false])
  })

  test('desligada: não chama nada e diz por quê', async () => {
    const r = await V.rodarVitrineAutomatica(ws, { env: {}, agora: AGORA })
    assert.equal(r.ligada, false)
    assert.match(r.motivo ?? '', /desligada/)
  })

  test('Add aceito + Get com o produto → CONFIRMADO_NA_VITRINE, com data/hora, product_id e request ids', async () => {
    const t = tiktok({ add: () => ok({}), get: () => ok({ products: [{ product_id: '900000000000000881' }] }) })
    const r = await V.adicionarAVitrine(ws, cand({ id: 'x1', externalId: '900000000000000881' }), { env: ENV_LIGADO, cliente: t.cliente, agora: AGORA })
    assert.equal(r.registro?.estado, 'CONFIRMADO_NA_VITRINE')
    assert.deepEqual(t.chamadas, ['ADD', 'GET'])
    assert.equal(r.registro?.productId, '900000000000000881')
    assert.equal(r.registro?.confirmadoEm?.toISOString(), AGORA.toISOString())
    assert.equal(r.registro?.requestIdAdd, 'req-fixture')
  })

  test('Add aceito mas o produto NÃO aparece no Get → continua ENVIADO (não "adicionado"); sem reenvio na janela', async () => {
    const t = tiktok({ add: () => ok({}), get: () => ok({ products: [] }) })
    const r = await V.adicionarAVitrine(ws, cand({ id: 'x2', externalId: '900000000000000882' }), { env: ENV_LIGADO, cliente: t.cliente, agora: AGORA })
    assert.equal(r.ok, false)
    assert.equal(r.registro?.estado, 'ENVIADO')
    // Rodada seguinte: confere de novo, NÃO reenvia (ainda na janela).
    const reg = await prisma.vitrineTikTokShop.findMany({ where: { workspaceId: ws }, select: { productId: true, estado: true, tentativas: true } })
    assert.ok(!V.selecionarElegiveis([cand({ id: 'x2', externalId: '900000000000000882' })], reg, 5, AGORA).length)
    // Passou a janela e segue ausente → NÃO ENCONTRADO.
    const depois = await V.conferirNaVitrine(ws, '900000000000000882', { env: ENV_LIGADO, cliente: t.cliente, agora: new Date(AGORA.getTime() + 25 * 3_600_000) })
    assert.equal(depois?.estado, 'NAO_ENCONTRADO_NA_VITRINE')
  })

  test('screening do vendedor no Add → AGUARDANDO_APROVACAO, nunca "adicionado"', async () => {
    const t = tiktok({ add: () => ok({ products: [{ product_id: '900000000000000883', status: 'PENDING_SELLER_APPROVAL' }] }), get: () => ok({ products: [] }) })
    const r = await V.adicionarAVitrine(ws, cand({ id: 'x3', externalId: '900000000000000883' }), { env: ENV_LIGADO, cliente: t.cliente, agora: AGORA })
    assert.equal(r.registro?.estado, 'AGUARDANDO_APROVACAO')
    assert.equal(r.registro?.confirmadoEm, null)
  })

  test('rede caiu no Add → ENVIO_INCERTO, UMA tentativa só (sem reenvio), e o Get resolve', async () => {
    const t = tiktok({ add: () => { throw new TypeError('fetch failed') }, get: () => ok({ products: [{ product_id: '900000000000000884' }] }) })
    const r = await V.adicionarAVitrine(ws, cand({ id: 'x4', externalId: '900000000000000884' }), { env: ENV_LIGADO, cliente: t.cliente, agora: AGORA })
    assert.deepEqual(t.chamadas, ['ADD', 'GET'], 'escrita não é repetida')
    assert.equal(r.registro?.estado, 'CONFIRMADO_NA_VITRINE')
    const h = r.registro?.historico as { acao: string; estado: string }[]
    assert.ok(h.some((x) => x.acao === 'ADD' && x.estado === 'ENVIO_INCERTO'))
  })

  test('recusa explícita (403) → FALHOU, sem Get e sem "adicionado"', async () => {
    const t = tiktok({ add: () => new Response(JSON.stringify({ code: 105001, message: 'no permission' }), { status: 403 }), get: () => ok({ products: [] }) })
    const r = await V.adicionarAVitrine(ws, cand({ id: 'x5', externalId: '900000000000000885' }), { env: ENV_LIGADO, cliente: t.cliente, agora: AGORA })
    assert.equal(r.registro?.estado, 'FALHOU')
    assert.deepEqual(t.chamadas, ['ADD'])
  })

  test('colaboração não confirmada: registra e NÃO chama a API', async () => {
    const t = tiktok({ add: () => ok({}), get: () => ok({}) })
    const r = await V.adicionarAVitrine(ws, cand({ id: 'x6', externalId: '900000000000000886', fonte: 'USER_PROVIDED' }), { env: ENV_LIGADO, cliente: t.cliente, agora: AGORA })
    assert.equal(r.ok, false)
    assert.equal(t.chamadas.length, 0)
    assert.equal(r.registro?.estado, 'COLABORACAO_NAO_CONFIRMADA')
  })
})
