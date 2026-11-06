/**
 * P2.17.4 — Correções da auditoria técnica do TikTok/TikTok Shop.
 * Cada teste prende um achado para não voltar.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { regraDaRota, rotaLiberada } from '../lib/modulos-rotas'
import { ehProdutoTikTokShop } from '../lib/tiktok-shop-link'
import { comissaoSemPalpite } from '../lib/tiktok-shop-descoberta'
import { avaliarEvidencia } from '../lib/tiktok-shop-evidencia'
import { analisarMeta } from '../lib/metas-tiktok'
import { consultar } from '../lib/consultor-afiliados'
import { planejarVideos } from '../lib/motor-de-videos-tiktok'

describe('P2.17.4 — auditoria: permissões e rotas', () => {
  test('conectar TikTok/TikTok Shop exige o módulo Integrações (mesmo via GET)', () => {
    for (const r of ['/api/integracoes/tiktok-shop/oauth/start', '/api/integracoes/tiktok-shop/oauth/callback', '/api/integracoes/tiktok/oauth/start', '/api/integracoes/tiktok/oauth/callback', '/api/integracoes/tiktok-shop/desconectar']) {
      const regra = regraDaRota(r, r.endsWith('desconectar') ? 'POST' : 'GET')
      assert.deepEqual(regra?.modulos, ['integracoes'], r)
      // quem só tem "conteudos" (todos os outros bloqueados) não passa
      const soConteudos = new Set(['integracoes', 'oportunidades', 'produtos'])
      assert.equal(rotaLiberada(regra, soConteudos), false, r)
    }
    // o estado da conexão continua legível por quem vê conteúdos
    assert.ok(regraDaRota('/api/integracoes/tiktok-shop/estado', 'GET')?.modulos.includes('conteudos'))
  })
  test('escrita em /api/tiktok nunca fica "sem regra = liberado"', () => {
    assert.deepEqual(regraDaRota('/api/tiktok/qualquer-coisa-nova', 'POST')?.modulos, ['oportunidades'])
    assert.deepEqual(regraDaRota('/api/tiktok/pacote-manual', 'DELETE')?.modulos, ['oportunidades'])
  })
  test('callback antigo do TikTok exige sessão e state do MESMO workspace', () => {
    const src = fs.readFileSync('app/api/integracoes/tiktok/oauth/callback/route.ts', 'utf8')
    assert.match(src, /exigirSessao\(\)/)
    assert.match(src, /stateValido\.workspaceId !== session\.user\.workspaceId/)
    assert.doesNotMatch(src, /findFirstOrThrow/)
    assert.doesNotMatch(fs.readFileSync('lib/tiktok-oauth.ts', 'utf8'), /dev-secret-inseguro/)
  })
})

describe('P2.17.4 — auditoria: regras únicas e textos honestos', () => {
  test('uma só regra de "produto do TikTok Shop", estrita', () => {
    assert.equal(ehProdutoTikTokShop(null, 'http://evil.example/?tiktok.com/product/123'), false)
    assert.equal(ehProdutoTikTokShop(null, 'https://shop.tiktok.com/view/product/1729384756102938475'), true)
    assert.equal(ehProdutoTikTokShop('tiktok-shop', null), true)
    for (const f of ['lib/consultor-afiliados.ts', 'lib/metas-tiktok.ts', 'lib/metas-tiktok-http.ts', 'app/api/tiktok/videos/route.ts']) {
      assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /tiktok\\\.com\\\/\.\*product/, f)
    }
  })
  test('comissão: só campo percentual explícito vira número; "rate" fica desconhecido', () => {
    assert.deepEqual(comissaoSemPalpite({ commission_percent: 12 }), { valor: 12, aviso: null })
    assert.equal(comissaoSemPalpite({ commission_rate: 50 }).valor, null)
    assert.equal(comissaoSemPalpite({ commission: { rate: 1500 } }).valor, null)
    assert.doesNotMatch(fs.readFileSync('lib/tiktok-shop-cliente.ts', 'utf8'), /minimum_rate/)
  })
  test('sem percentual, o consultor não escreve "null%"', () => {
    const c = consultar({ nome: 'X', categoria: 'Outros', preco: 50, providerId: null, linkProduto: null, comissaoPercentual: null, comissaoValor: 5, vendas: null, baseDeEvidencia: 30, confianca: 'BAIXA', nivelDeRisco: null, riscos: [], publicacaoImpedida: false, campanha: null })
    assert.doesNotMatch(c.comissao, /null/)
  })
  test('"vendidos no TikTok Shop" só quando o produto é de lá', () => {
    const fora = planejarVideos({ nome: 'Kit', categoria: 'Outros', preco: 50, vendas: 200, tiktokShop: false })
    assert.ok(fora.variantes.every((v) => !JSON.stringify(v.roteiro).includes('no TikTok Shop')))
    assert.ok(fora.variantes[0].roteiro.some((r) => /200 vendidos \(dado da loja\)/.test(r.texto)))
  })
  test('missão encerrada não afirma perda: pede conferir no app', () => {
    const a = analisarMeta({ id: 'x', nome: 'M', tipo: 'VIDEOS_QUALIFICADOS', inicio: new Date('2026-10-01'), fim: new Date('2026-10-05'), recompensaValor: 50, recompensaDescricao: null, quantidadeExigida: 5, quantidadeRealizada: 2, requisitos: null }, new Date('2026-10-10'))
    assert.match(a.frases[0], /Confira no app do TikTok Shop/)
    assert.doesNotMatch(a.frases[0], /foi perdida/)
  })
  test('missão que ainda não começou: ritmo contado a partir do início', () => {
    const a = analisarMeta({ id: 'x', nome: 'M', tipo: 'VIDEOS_QUALIFICADOS', inicio: new Date('2026-10-20T00:00:00Z'), fim: new Date('2026-10-30T00:00:00Z'), recompensaValor: null, recompensaDescricao: null, quantidadeExigida: 20, quantidadeRealizada: 0, requisitos: null }, new Date('2026-10-01T00:00:00Z'))
    assert.equal(a.situacao, 'NAO_INICIADA')
    assert.equal(a.ritmoNecessario, 2) // 20 em 10 dias de missão (não 29 dias a partir de hoje)
  })
  test('evidência: access vencido com refresh válido continua sendo conexão real', () => {
    const agora = new Date('2026-10-10T12:00:00Z')
    const base = { plataforma: 'tiktok-shop-creator', status: 'conectado', temToken: true, tokenExpiry: new Date('2026-10-10T11:00:00Z') }
    assert.equal(avaliarEvidencia([base], agora), null)
    assert.ok(avaliarEvidencia([{ ...base, refreshValido: true }], agora))
  })
})

const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')

describe('P2.17.4 — auditoria: corridas (banco de TESTE)', { skip: !TEM_BANCO ? 'exige banco de TESTE' : false }, () => {
  let prisma: typeof import('../lib/prisma').prisma
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  const PREFIXO = 'Conta de Teste — '
  const marca = `r78-${Date.now()}`
  let ws = ''
  let user = ''
  before(async () => {
    ;[{ prisma }, { limparWorkspaceDeTeste: limpar }] = await Promise.all([import('../lib/prisma'), import('./_limpar-workspace-de-teste')])
    ws = (await prisma.workspace.create({ data: { name: `${PREFIXO}auditoria P2.17.4`, ownerId: marca }, select: { id: true } })).id
    user = (await prisma.user.create({ data: { email: `${marca}@teste.local`, name: 'U', password: 'x', workspaceId: ws }, select: { id: true } })).id
  })
  after(async () => {
    if (prisma && ws) await limpar(prisma, ws, PREFIXO)
    await prisma?.$disconnect()
  })

  test('"+1 feito" simultâneo não perde contagem; nunca fica negativo', async () => {
    const M = await import('../lib/metas-tiktok')
    const m = await M.criarMeta({ workspaceId: ws, userId: user, dados: { nome: 'FIXTURE', tipo: 'VIDEOS_QUALIFICADOS', inicio: new Date(), fim: new Date(Date.now() + 5 * 86400000), recompensaValor: null, recompensaDescricao: null, quantidadeExigida: 10, quantidadeRealizada: 0, requisitos: null } })
    await Promise.all(Array.from({ length: 5 }, () => M.atualizarMeta({ workspaceId: ws, userId: user, id: m.id, mudanca: { incremento: 1 } })))
    assert.equal((await prisma.metaTikTokShop.findUniqueOrThrow({ where: { id: m.id } })).quantidadeRealizada, 5)
    await M.atualizarMeta({ workspaceId: ws, userId: user, id: m.id, mudanca: { incremento: -20 } })
    assert.equal((await prisma.metaTikTokShop.findUniqueOrThrow({ where: { id: m.id } })).quantidadeRealizada, 0)
  })

  test('"Informar produto" com dois cliques ao mesmo tempo cria UM candidato', async () => {
    const C = await import('../lib/curadoria')
    const dados = { nome: 'FIXTURE Produto duplo', link: 'https://shop.tiktok.com/view/product/9000000000000000777?region=BR', comprei: false, usei: false }
    const r = await Promise.allSettled([C.informarProduto({ workspaceId: ws, userId: user, dados }), C.informarProduto({ workspaceId: ws, userId: user, dados })])
    assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1)
    assert.equal(await prisma.candidatoDeProduto.count({ where: { workspaceId: ws, externalId: '9000000000000000777' } }), 1)
    const outro = await Promise.allSettled([C.informarProduto({ workspaceId: ws, userId: user, dados: { ...dados, link: 'https://loja.invalido/p/1#x' } }), C.informarProduto({ workspaceId: ws, userId: user, dados: { ...dados, link: 'https://LOJA.invalido/p/1/' } })])
    assert.equal(outro.filter((x) => x.status === 'fulfilled').length, 1)
  })

  test('duas renovações ao mesmo tempo: a perdedora usa o token da vencedora (não marca "expirado")', async () => {
    const O = await import('../lib/tiktok-shop-oauth')
    const env = { ...process.env, NEXTAUTH_SECRET: 'x', TIKTOK_SHOP_APP_KEY: 'FIXTURE_K', TIKTOK_SHOP_APP_SECRET: 'FIXTURE_S', TIKTOK_SHOP_AUTHORIZE_URL: 'https://services.tiktokshop.com/open/authorize?service_id=F' }
    await prisma.integracao.create({ data: { workspaceId: ws, userId: user, plataforma: 'tiktok-shop-creator', status: 'conectado', accessToken: 'A0', refreshToken: 'R0', tokenExpiry: new Date(Date.now() + 60_000), extraData: { escopos: [] } } })
    let chamadas = 0
    const fetcher = (async () => {
      chamadas++
      if (chamadas === 1) {
        await new Promise((r) => setTimeout(r, 50))
        return new Response(JSON.stringify({ code: 0, data: { access_token: 'A1', refresh_token: 'R1', access_token_expire_in: Math.floor(Date.now() / 1000) + 3600 } }), { status: 200 })
      }
      await new Promise((r) => setTimeout(r, 400))
      return new Response(JSON.stringify({ code: 36004004, message: 'refresh token já usado' }), { status: 200 })
    }) as unknown as typeof fetch
    const [a, b] = await Promise.all([O.obterTokenDaCriadora(ws, { env, fetcher }), O.obterTokenDaCriadora(ws, { env, fetcher })])
    assert.ok(a.ok && b.ok, JSON.stringify([a, b]))
    const i = await prisma.integracao.findUniqueOrThrow({ where: { workspaceId_plataforma: { workspaceId: ws, plataforma: 'tiktok-shop-creator' } } })
    assert.equal(i.status, 'conectado')
  })
})
