/**
 * P2.17 — TikTok / TikTok Shop: tudo o que depende do nosso lado.
 *
 * TODAS as respostas do TikTok aqui são FIXTURES/MOCKS de teste interno
 * (tests/fixtures/tiktok-shop/FIXTURE-*.json e respostas montadas abaixo,
 * com ids 9000…/textos "FIXTURE"). Nenhuma é produto real nem resposta real.
 * Nenhum teste chama a rede: todo `fetch` é injetado.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import {
  gerarStateCreator,
  validarStateCreator,
  montarUrlDeAutorizacaoCreator,
  lerCredenciaisTikTokShopCreator,
  lerRespostaDeToken,
  instanteDeExpiracao,
  trocarCodigoDaCriadora,
  urlDeAutorizacaoOficial,
} from '../lib/tiktok-shop-oauth'
import { gerarState } from '../lib/tiktok-oauth'
import { chamarOpenApi, classificarResposta, buscarProdutosDeColaboracaoAberta, caminhoDaBusca, ENDPOINT_BUSCA_COLABORACAO_ABERTA } from '../lib/tiktok-shop-cliente'
import { TikTokRateLimiter } from '../lib/tiktok-rate-limiter'
import { assinarRequisicaoTikTokShop } from '../lib/tiktok-shop-signer'
import { normalizarProdutoDoTikTokShop, comoProdutoDoCatalogo, comoDadosDoItem, chaveDeOrigemTikTokShop } from '../lib/tiktok-shop-descoberta'
import { linkDoTikTokShop } from '../lib/tiktok-shop-link'
import { montarPacoteTikTok, CTA_PRODUTO_MARCADO } from '../lib/tiktok-pacote'
import { corpoDoInitDoRascunho, iniciarRascunhoNoTikTok, ESCOPOS_DO_RASCUNHO } from '../lib/tiktok-rascunho'
import { pontuarProduto, calcularDesempenhoHistorico } from '../lib/motor-de-oportunidades'
import { regraDaRota } from '../lib/modulos-rotas'

const FIXTURE = JSON.parse(fs.readFileSync('tests/fixtures/tiktok-shop/FIXTURE-busca-colaboracao-aberta.json', 'utf8'))
const ENV = {
  NEXTAUTH_SECRET: 'segredo-de-teste-p217',
  TIKTOK_SHOP_APP_KEY: 'FIXTURE_APP_KEY',
  TIKTOK_SHOP_APP_SECRET: 'FIXTURE_APP_SECRET',
  TIKTOK_SHOP_AUTHORIZE_URL: 'https://services.tiktokshop.com/open/authorize?service_id=FIXTURE',
}
const resposta = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } })

describe('P2.17 — fixture é inequivocamente fixture', () => {
  test('arquivo marcado e ids/textos de mentira', () => {
    assert.match(FIXTURE._AVISO, /FIXTURE \/ MOCK DE TESTE INTERNO — NÃO É PRODUTO REAL/)
    for (const p of FIXTURE.data.products) assert.match(p.title, /^FIXTURE/)
  })
})

describe('P2.17 — OAuth da criadora (state, URL, token)', () => {
  test('state: amarrado a workspace, usuária e finalidade; vence; adulterado não passa', () => {
    const agora = 1_800_000_000_000
    const s = gerarStateCreator({ workspaceId: 'ws1', userId: 'u1', agora }, ENV)
    assert.deepEqual(validarStateCreator(s, agora + 1000, ENV), { workspaceId: 'ws1', userId: 'u1' })
    assert.equal(validarStateCreator(s, agora + 11 * 60_000, ENV), null, 'vencido')
    assert.equal(validarStateCreator(s, agora, { NEXTAUTH_SECRET: 'outro' }), null, 'outro segredo')
    const adulterado = Buffer.from(Buffer.from(s, 'base64url').toString().replace('ws1', 'ws2')).toString('base64url')
    assert.equal(validarStateCreator(adulterado, agora, ENV), null)
    assert.equal(validarStateCreator('lixo', agora, ENV), null)
  })

  test('state do Login Kit (canal TikTok) não serve para o TikTok Shop', () => {
    const doCanal = gerarState('ws1')
    assert.equal(validarStateCreator(doCanal, Date.now(), { NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET || 'dev-secret-inseguro' }), null)
  })

  test('sem NEXTAUTH_SECRET não há state (fail-closed)', () => {
    assert.throws(() => gerarStateCreator({ workspaceId: 'a', userId: 'b' }, {}), /NEXTAUTH_SECRET/)
    assert.equal(validarStateCreator('x', Date.now(), {}), null)
  })

  test('URL de autorização: só domínio oficial do TikTok; state acrescentado', () => {
    assert.equal(urlDeAutorizacaoOficial('https://services.tiktokshop.com/open/authorize?x=1'), true)
    assert.equal(urlDeAutorizacaoOficial('https://tiktokshop.com.golpe.example/x'), false)
    assert.equal(urlDeAutorizacaoOficial('http://services.tiktokshop.com/x'), false)
    assert.equal(lerCredenciaisTikTokShopCreator({ ...ENV, TIKTOK_SHOP_AUTHORIZE_URL: 'https://evil.example/a' }), null)
    assert.equal(lerCredenciaisTikTokShopCreator({}), null)
    const creds = lerCredenciaisTikTokShopCreator(ENV)!
    const u = new URL(montarUrlDeAutorizacaoCreator(creds, 'ESTADO'))
    assert.equal(u.searchParams.get('state'), 'ESTADO')
    assert.equal(u.searchParams.get('service_id'), 'FIXTURE')
  })

  test('resposta de token: lê validade em instante Unix; recusa incompleta e erro', () => {
    const agora = 1_800_000_000_000
    const t = lerRespostaDeToken(
      { code: 0, data: { access_token: 'A', refresh_token: 'R', access_token_expire_in: 1_800_604_800, refresh_token_expire_in: 1_831_536_000, open_id: 'OPEN', seller_name: 'FIXTURE Criadora', granted_scopes: ['x'] } },
      agora
    )
    assert.equal(t.accessExpiraEm.getTime(), 1_800_604_800_000)
    assert.equal(t.nome, 'FIXTURE Criadora')
    assert.deepEqual(t.escopos, ['x'])
    assert.equal(instanteDeExpiracao(3600, agora)!.getTime(), agora + 3_600_000)
    assert.throws(() => lerRespostaDeToken({ code: 36004004, message: 'invalid auth code' }), /recusou/)
    assert.throws(() => lerRespostaDeToken({ code: 0, data: { access_token: 'A' } }), /sem token/)
  })

  test('troca do código: endpoint oficial, grant authorized_code, sem token na saída de erro', async () => {
    let chamada = ''
    const t = await trocarCodigoDaCriadora(lerCredenciaisTikTokShopCreator(ENV)!, 'CODIGO', (async (url: string) => {
      chamada = url
      return resposta({ code: 0, data: { access_token: 'A', refresh_token: 'R', access_token_expire_in: 4_000_000_000 } })
    }) as typeof fetch)
    const u = new URL(chamada)
    assert.equal(u.origin + u.pathname, 'https://auth.tiktok-shops.com/api/v2/token/get')
    assert.equal(u.searchParams.get('grant_type'), 'authorized_code')
    assert.equal(u.searchParams.get('auth_code'), 'CODIGO')
    assert.equal(t.accessToken, 'A')
  })
})

describe('P2.17 — cliente oficial (assinatura, limite, retentativa)', () => {
  const base = { appKey: 'K', appSecret: 'S', accessToken: 'TOKEN-SECRETO', esperar: async () => {}, relogio: () => 1_800_000_000_000 }

  test('assina a query, token só no header, nunca na URL', async () => {
    let url = ''
    let headers: Record<string, string> = {}
    await chamarOpenApi({ metodo: 'POST', caminho: '/x/202405/y', query: { page_size: 20 }, corpo: {} }, {
      ...base,
      chaveDeLimite: 'a1',
      limitador: new TikTokRateLimiter(),
      fetcher: (async (u: string, init: RequestInit) => {
        url = u
        headers = init.headers as Record<string, string>
        return resposta({ code: 0, data: {} })
      }) as typeof fetch,
    })
    const q = new URL(url).searchParams
    assert.equal(q.get('app_key'), 'K')
    assert.equal(q.get('timestamp'), '1800000000')
    const esperado = assinarRequisicaoTikTokShop({ path: '/x/202405/y', query: { page_size: 20, app_key: 'K', timestamp: 1800000000 }, metodo: 'POST', corpoBruto: '{}' }, 'S')
    assert.equal(q.get('sign'), esperado)
    assert.ok(!url.includes('TOKEN-SECRETO'))
    assert.equal(headers['x-tts-access-token'], 'TOKEN-SECRETO')
  })

  test('repete 5xx e 429; não repete 403 nem recusa de negócio', async () => {
    const seq = [500, 429, 200]
    let n = 0
    const ok = await chamarOpenApi({ metodo: 'GET', caminho: '/a' }, {
      ...base, chaveDeLimite: 'a2', limitador: new TikTokRateLimiter(),
      fetcher: (async () => resposta(seq[n] === 200 ? { code: 0, data: { v: 1 } } : {}, seq[n++])) as typeof fetch,
    })
    assert.deepEqual(ok.data, { v: 1 })
    assert.equal(n, 3)
    for (const [status, corpo, tipo] of [[403, {}, 'PERMISSAO'], [200, { code: 105005, message: 'no permission' }, 'RECUSADO']] as const) {
      let chamadas = 0
      await assert.rejects(
        chamarOpenApi({ metodo: 'GET', caminho: '/b' }, { ...base, chaveDeLimite: `a3${status}`, limitador: new TikTokRateLimiter(), fetcher: (async () => (chamadas++, resposta(corpo, status))) as typeof fetch }),
        (e: { tipo: string }) => e.tipo === tipo
      )
      assert.equal(chamadas, 1)
    }
    assert.equal(classificarResposta(401, {})?.tipo, 'AUTENTICACAO')
  })

  test('limite local por workspace+caminho', async () => {
    const limitador = new TikTokRateLimiter(() => 0)
    const deps = { ...base, chaveDeLimite: 'a4', limitador, fetcher: (async () => resposta({ code: 0, data: {} })) as typeof fetch }
    for (let i = 0; i < 5; i++) await chamarOpenApi({ metodo: 'GET', caminho: '/c' }, deps)
    await assert.rejects(chamarOpenApi({ metodo: 'GET', caminho: '/c' }, deps), (e: { tipo: string }) => e.tipo === 'LIMITE_LOCAL')
  })

  test('busca de colaboração aberta: caminho marcado como NÃO confirmado e trocável por env; paginação lida', async () => {
    assert.equal(ENDPOINT_BUSCA_COLABORACAO_ABERTA.caminhoConfirmado, false)
    assert.equal(caminhoDaBusca({ TIKTOK_SHOP_PATH_BUSCA_COLABORACAO: '/affiliate_creator/202501/outro' }), '/affiliate_creator/202501/outro')
    assert.equal(caminhoDaBusca({ TIKTOK_SHOP_PATH_BUSCA_COLABORACAO: 'https://evil' }), ENDPOINT_BUSCA_COLABORACAO_ABERTA.caminhoPadrao)
    const pagina = await buscarProdutosDeColaboracaoAberta({}, { ...base, chaveDeLimite: 'a5', limitador: new TikTokRateLimiter(), fetcher: (async () => resposta(FIXTURE)) as typeof fetch })
    assert.equal(pagina.produtos.length, 4)
    assert.equal(pagina.proximaPagina, 'FIXTURE-PAGINA-2')
    assert.equal(pagina.requestId, 'FIXTURE-REQ-0001')
  })
})

describe('P2.17 — normalização sem inventar e motor', () => {
  const [a, b, c, semId] = FIXTURE.data.products
  test('campos aninhados lidos; ausente fica null; sem id é descartado', () => {
    const n = normalizarProdutoDoTikTokShop(a)!
    assert.equal(n.externalId, '9000000000000000001')
    assert.equal(n.preco, 59.9)
    assert.equal(n.comissaoPercentual, 12)
    assert.equal(n.vendas, 340)
    assert.equal(n.loja, 'FIXTURE Loja Exemplo')
    assert.equal(n.avaliacao, null)
    assert.equal(normalizarProdutoDoTikTokShop(semId), null)
  })
  test('comissão em formato duvidoso não é convertida (só campo percentual explícito); sem estoque = 0; moeda estrangeira não vira preço', () => {
    const nb = normalizarProdutoDoTikTokShop(b)!
    assert.equal(nb.comissaoPercentual, null)
    assert.ok(nb.desconhecidos.some((d) => /formato não confirmado \(1500\)/.test(d)))
    assert.equal(nb.estoque, 0)
    const nc = normalizarProdutoDoTikTokShop(c)!
    // "commission_rate" tem unidade não confirmada (fração, % ou pontos-base): fica null, com aviso.
    assert.equal(nc.comissaoPercentual, null)
    assert.ok(nc.desconhecidos.some((d) => /unidade será confirmada/.test(d)))
    assert.equal(comoProdutoDoCatalogo(nc, new Date()).preco, null)
    assert.equal(comoDadosDoItem(nc).preco, null)
  })
  test('o MESMO motor pontua; origem = parceiro autorizado; chave idempotente', () => {
    const agora = new Date('2026-10-10T12:00:00Z')
    const p = comoProdutoDoCatalogo(normalizarProdutoDoTikTokShop(a)!, agora)
    assert.equal(p.id, chaveDeOrigemTikTokShop('9000000000000000001'))
    const o = pontuarProduto(p, calcularDesempenhoHistorico({ taxaConversao: null, receitaPorClique: null, cliques: 0, vendasElegiveis: 0, publicacoesRecentes: 0 }), { canaisCapazes: [], agora })
    assert.equal(o.origem, 'AUTHORIZED_PARTNER_API')
    assert.equal(o.provider, 'tiktok-shop')
    assert.ok(o.score >= 0 && o.score <= 100)
  })
})

describe('P2.17 — modo assistido', () => {
  test('link de produto do TikTok Shop reconhecido sem abrir a página', () => {
    assert.deepEqual(linkDoTikTokShop('https://shop.tiktok.com/view/product/1729384756102938475?region=BR'), { ehTikTok: true, ehProduto: true, productId: '1729384756102938475', curto: false })
    assert.equal(linkDoTikTokShop('https://vt.tiktok.com/ZSabc/').curto, true)
    assert.equal(linkDoTikTokShop('https://vt.tiktok.com/ZSabc/').productId, null)
    assert.equal(linkDoTikTokShop('https://tiktok.com.golpe.example/view/product/1729384756102938475').ehTikTok, false)
    assert.equal(linkDoTikTokShop('https://www.amazon.com.br/dp/X').ehTikTok, false)
  })

  const conteudo = {
    id: 'c1', status: 'aprovado', roteiro: 'Gancho: Você ainda lava garrafa assim?\nCena 2...', textoTela: null,
    legendaTiktok: 'Garrafa que mantém o café quente.\n\nLink na bio.\n\n#casa #fyp #utilidades', chamadaAcao: 'Link na bio.',
    hashtags: ['#casa', '#utilidades', '#fyp', '#achadinhos'], videoUrl: 'https://fixture.invalid/v.mp4', alertasCompliance: [],
  }
  test('pacote TikTok Shop: CTA do produto marcado, divulgação, sem "link na bio", passos no app', () => {
    const p = montarPacoteTikTok({ nome: 'FIXTURE Garrafa', linkProduto: 'https://shop.tiktok.com/view/product/9000000000000000001', providerId: 'tiktok-shop', externalId: '9000000000000000001' }, conteudo)
    assert.equal(p.tiktokShop, true)
    assert.equal(p.productId, '9000000000000000001')
    assert.equal(p.cta, CTA_PRODUTO_MARCADO)
    assert.ok(p.legenda.includes(CTA_PRODUTO_MARCADO))
    assert.ok(!/link na bio/i.test(p.legenda))
    assert.match(p.legenda, /comissão/)
    assert.ok(p.hashtags.length <= 5)
    assert.equal(p.gancho, 'Você ainda lava garrafa assim?')
    assert.equal(p.pronto, true, p.pendencias.join(' | '))
    assert.equal(p.publicacao, 'MANUAL_PELA_TITULAR')
    assert.ok(p.passosNoApp.some((s) => /Adicionar link/.test(s)))
  })
  test('pacote recusa: sem aprovação, sem vídeo, com claim, com link na legenda; fora do TikTok Shop avisa', () => {
    const p = montarPacoteTikTok(
      { nome: 'X', linkProduto: 'https://loja.invalido/x', providerId: null, externalId: null },
      { ...conteudo, status: 'roteiro_gerado', videoUrl: null, legendaTiktok: 'Original lacrado! veja https://loja.invalido/x', alertasCompliance: [{}] }
    )
    assert.equal(p.pronto, false)
    for (const codigo of ['APROVACAO_PENDENTE', 'VIDEO_AUSENTE', 'LINK_NA_LEGENDA', 'COMPLIANCE']) assert.ok(p.pendencias.some((x) => x.startsWith(codigo)), codigo)
    assert.equal(p.cta, 'Link na bio.')
    assert.ok(p.avisos.some((x) => /fora do TikTok Shop/.test(x)))
  })
  test('rota do pacote é só leitura e passa pela porta de módulos', () => {
    assert.ok(regraDaRota('/api/tiktok/pacote-manual', 'GET'))
    const src = fs.readFileSync('app/api/tiktok/pacote-manual/route.ts', 'utf8')
    assert.match(src, /exigirSessao\(\)/)
    assert.match(src, /workspaceId: session\.user\.workspaceId/)
    assert.ok(!/export async function (POST|PUT|PATCH|DELETE)/.test(src))
    assert.ok(!/fetch\(|\.update\(|\.create\(/.test(src))
  })
})

describe('P2.17.1 — flag libera a conexão, não resolve a pendência', () => {
  test('o ciclo decide a pendência do TikTok Shop só pela evidência real', () => {
    const src = fs.readFileSync('lib/supervisor/ciclo.ts', 'utf8')
    assert.match(src, /const tiktokShopPendente = !evidenciaTikTokShop\b/)
    assert.doesNotMatch(src, /flagLigada\('TIKTOK_SHOP_CATALOGO'/)
  })
  test('a tela do conteúdo mostra o pacote do TikTok (só leitura)', () => {
    const pagina = fs.readFileSync('app/(dashboard)/conteudos/[id]/page.tsx', 'utf8')
    const comp = fs.readFileSync('components/conteudos/PacoteTikTok.tsx', 'utf8')
    assert.match(pagina, /<PacoteTikTok conteudoId=\{id\} \/>/)
    assert.match(comp, /\/api\/tiktok\/pacote-manual\?conteudoId=/)
    assert.doesNotMatch(comp, /method:\s*'(POST|PUT|PATCH|DELETE)'/)
  })
})

describe('P2.17 — rascunho na caixa de entrada (não ligado a rota)', () => {
  test('corpo oficial para URL e para arquivo em pedaços', () => {
    assert.deepEqual(corpoDoInitDoRascunho({ tipo: 'URL', url: 'https://fixture.invalid/v.mp4' }), { source_info: { source: 'PULL_FROM_URL', video_url: 'https://fixture.invalid/v.mp4' } })
    const f = corpoDoInitDoRascunho({ tipo: 'ARQUIVO', tamanho: 25 * 1024 * 1024 }) as { source_info: Record<string, number | string> }
    assert.equal(f.source_info.source, 'FILE_UPLOAD')
    assert.equal(f.source_info.total_chunk_count, 2)
    assert.throws(() => corpoDoInitDoRascunho({ tipo: 'URL', url: 'http://x' }))
    assert.deepEqual([...ESCOPOS_DO_RASCUNHO], ['user.info.basic', 'video.upload'])
  })
  test('sem escopo video.upload não chama o TikTok', async () => {
    let chamou = false
    await assert.rejects(iniciarRascunhoNoTikTok({ accessToken: 'x', escopos: ['video.publish'], origem: { tipo: 'URL', url: 'https://a.b/v.mp4' } }, (async () => { chamou = true; return resposta({}) }) as typeof fetch), /video\.upload/)
    assert.equal(chamou, false)
  })
  test('nenhuma rota usa o rascunho nem o Direct Post (publicação externa não autorizada)', () => {
    const rotas = fs.readdirSync('app/api', { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('route.ts'))
    for (const r of rotas) assert.ok(!/tiktok-rascunho|iniciarRascunhoNoTikTok/.test(fs.readFileSync(`app/api/${r}`, 'utf8')), r)
  })
})

// ── Banco de TESTE: conexão real ponta a ponta com o TikTok simulado ─────

const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')

describe('P2.17 — banco de teste (TikTok simulado por fixture)', { skip: !TEM_BANCO ? 'exige banco de TESTE' : false }, () => {
  let prisma: typeof import('../lib/prisma').prisma
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  const PREFIXO = 'Conta de Teste — '
  const marca = `r72-${Date.now()}`
  let ws = ''
  let user = ''
  const envAntes = { ...process.env }
  const fetchAntes = globalThis.fetch

  before(async () => {
    ;[{ prisma }, { limparWorkspaceDeTeste: limpar }] = await Promise.all([import('../lib/prisma'), import('./_limpar-workspace-de-teste')])
    ws = (await prisma.workspace.create({ data: { name: `${PREFIXO}tiktok P2.17`, ownerId: marca }, select: { id: true } })).id
    user = (await prisma.user.create({ data: { email: `${marca}@teste.local`, name: 'U', password: 'x', workspaceId: ws }, select: { id: true } })).id
  })
  after(async () => {
    globalThis.fetch = fetchAntes
    for (const k of Object.keys(ENV)) if (!(k in envAntes)) delete process.env[k]
    Object.assign(process.env, envAntes)
    if (prisma && ws) {
      await prisma.featureFlag.deleteMany({ where: { escopo: ws } })
      await limpar(prisma, ws, PREFIXO)
    }
    await prisma?.$disconnect()
  })

  test('sem flag: 501 mesmo com credencial; com flag: callback grava token CIFRADO e vira evidência', async () => {
    const { tratarCallbackDaCriadora, iniciarAutorizacaoDaCriadora } = await import('../lib/tiktok-shop-conexao')
    const { definirFlag } = await import('../lib/feature-flags')
    const { evidenciaDoTikTokShop } = await import('../lib/tiktok-shop-evidencia')
    const env = { ...process.env, ...ENV }
    const quem = { workspaceId: ws, userId: user }
    assert.equal((await iniciarAutorizacaoDaCriadora(quem, { env })).status, 501)

    await definirFlag({ chave: 'TIKTOK_SHOP_CATALOGO', escopo: ws, ligada: true, motivo: 'teste P2.17' })
    const inicio = await iniciarAutorizacaoDaCriadora(quem, { env })
    assert.equal(inicio.status, 307)
    const state = new URL(inicio.headers.get('location')!).searchParams.get('state')!
    // state de OUTRA usuária é recusado
    const outro = await tratarCallbackDaCriadora(`https://t.invalid/cb?code=C&state=${state}`, { workspaceId: ws, userId: 'outra' }, { env })
    assert.match(outro.headers.get('location')!, /tiktokShop=state-invalido/)

    const r = await tratarCallbackDaCriadora(`https://t.invalid/cb?code=C&state=${state}`, quem, {
      env,
      fetcher: (async () => resposta({ code: 0, data: { access_token: 'ACESSO-FIXTURE', refresh_token: 'RENOVA-FIXTURE', access_token_expire_in: Math.floor(Date.now() / 1000) + 3600 * 24 * 7, refresh_token_expire_in: Math.floor(Date.now() / 1000) + 3600 * 24 * 300, open_id: 'OPEN-FIXTURE', seller_name: 'FIXTURE Criadora', granted_scopes: ['FIXTURE-SCOPE'] } })) as typeof fetch,
    })
    assert.match(r.headers.get('location')!, /tiktokShop=conectado/)
    const [cru] = await prisma.$queryRaw<{ accessToken: string; refreshToken: string }[]>`SELECT "accessToken", "refreshToken" FROM "Integracao" WHERE "workspaceId" = ${ws} AND plataforma = 'tiktok-shop-creator'`
    assert.ok(cru.accessToken.startsWith('enc:v1:') && cru.refreshToken.startsWith('enc:v1:'), 'token em texto puro no banco')
    assert.ok(!cru.accessToken.includes('ACESSO-FIXTURE'))
    assert.ok(await evidenciaDoTikTokShop(ws))
    const auditoria = await prisma.auditLog.findMany({ where: { workspaceId: ws } })
    assert.ok(!JSON.stringify(auditoria).includes('ACESSO-FIXTURE'))
  })

  test('renova perto de vencer; refresh vencido pede reconectar', async () => {
    const { obterTokenDaCriadora } = await import('../lib/tiktok-shop-oauth')
    const env = { ...process.env, ...ENV }
    await prisma.integracao.update({ where: { workspaceId_plataforma: { workspaceId: ws, plataforma: 'tiktok-shop-creator' } }, data: { tokenExpiry: new Date(Date.now() + 60_000) } })
    let url = ''
    const t = await obterTokenDaCriadora(ws, { env, fetcher: (async (u: string) => { url = u; return resposta({ code: 0, data: { access_token: 'NOVO-FIXTURE', refresh_token: 'R2', access_token_expire_in: Math.floor(Date.now() / 1000) + 3600 } }) }) as typeof fetch })
    assert.ok(t.ok && t.accessToken === 'NOVO-FIXTURE')
    assert.match(url, /token\/refresh.*grant_type=refresh_token/)
    await prisma.integracao.update({ where: { workspaceId_plataforma: { workspaceId: ws, plataforma: 'tiktok-shop-creator' } }, data: { tokenExpiry: new Date(Date.now() - 1), extraData: { escopos: [], refreshExpiraEm: new Date(Date.now() - 1).toISOString() } } })
    const r = await obterTokenDaCriadora(ws, { env, fetcher: (async () => assert.fail('não pode renovar com refresh vencido')) as typeof fetch })
    assert.equal(r.ok, false)
    assert.equal((r as { motivo: string }).motivo, 'RECONECTAR')
    const i = await prisma.integracao.findUniqueOrThrow({ where: { workspaceId_plataforma: { workspaceId: ws, plataforma: 'tiktok-shop-creator' } } })
    assert.equal(i.status, 'expirado')
  })

  test('produtos do TikTok Shop (fixture) entram no MESMO ranking e no Top 3; sem flag, nem vai à rede', async () => {
    const { coletarCandidatos, listarApresentados } = await import('../lib/curadoria')
    const { definirFlag } = await import('../lib/feature-flags')
    Object.assign(process.env, ENV)
    const futuro = Math.floor(Date.now() / 1000) + 3600 * 24
    await prisma.integracao.update({ where: { workspaceId_plataforma: { workspaceId: ws, plataforma: 'tiktok-shop-creator' } }, data: { status: 'conectado', accessToken: 'ACESSO-FIXTURE-2', refreshToken: 'R3', tokenExpiry: new Date(futuro * 1000), extraData: { escopos: [] } } })
    const chamadas: string[] = []
    globalThis.fetch = (async (u: string) => {
      chamadas.push(String(u))
      return resposta({ ...FIXTURE, data: { ...FIXTURE.data, next_page_token: undefined } })
    }) as typeof fetch
    const r = await coletarCandidatos({ workspaceId: ws, userId: user })
    assert.equal(chamadas.length, 1)
    assert.match(chamadas[0], /^https:\/\/open-api\.tiktokglobalshop\.com\/affiliate_creator\//)
    assert.equal(r.avaliados, 3)
    const linhas = await prisma.candidatoDeProduto.findMany({ where: { workspaceId: ws }, orderBy: { posicao: 'asc' } })
    assert.equal(linhas.length, 3)
    assert.ok(linhas.every((l) => l.fonte === 'tiktok-shop' && l.chaveDeOrigem.startsWith('tiktok-shop:9000')))
    const garrafa = linhas.find((l) => l.externalId === '9000000000000000001')!
    assert.equal(garrafa.comissaoPercentual, 12)
    assert.equal(garrafa.vendas, 340)
    assert.ok(Math.abs((garrafa.comissaoValor ?? 0) - 7.19) < 0.01)
    assert.equal((await listarApresentados(ws)).length, 3)
    // idempotente: segunda coleta não duplica
    await coletarCandidatos({ workspaceId: ws })
    assert.equal(await prisma.candidatoDeProduto.count({ where: { workspaceId: ws } }), 3)

    await definirFlag({ chave: 'TIKTOK_SHOP_CATALOGO', escopo: ws, ligada: false })
    chamadas.length = 0
    await coletarCandidatos({ workspaceId: ws })
    assert.equal(chamadas.length, 0, 'flag desligada não pode chamar o TikTok')
    globalThis.fetch = fetchAntes
  })

  test('desconectar apaga os tokens e tira a evidência', async () => {
    const { desconectarCriadora } = await import('../lib/tiktok-shop-oauth')
    const { evidenciaDoTikTokShop } = await import('../lib/tiktok-shop-evidencia')
    assert.equal(await desconectarCriadora({ workspaceId: ws, userId: user }), true)
    const i = await prisma.integracao.findUniqueOrThrow({ where: { workspaceId_plataforma: { workspaceId: ws, plataforma: 'tiktok-shop-creator' } } })
    assert.equal(i.accessToken, null)
    assert.equal(i.refreshToken, null)
    assert.equal(await evidenciaDoTikTokShop(ws), null)
  })

  test('modo assistido: link do TikTok Shop informado pela titular leva o id oficial; repetido é recusado', async () => {
    const { informarProduto, ErroDeCuradoria } = await import('../lib/curadoria')
    const link = 'https://shop.tiktok.com/view/product/9000000000000000099?region=BR'
    const c = await informarProduto({ workspaceId: ws, userId: user, dados: { nome: 'FIXTURE produto informado', link, comprei: false, usei: true } })
    assert.equal(c.providerId, 'tiktok-shop')
    assert.equal(c.externalId, '9000000000000000099')
    assert.equal(c.fonte, 'USER_PROVIDED')
    await assert.rejects(
      informarProduto({ workspaceId: ws, userId: user, dados: { nome: 'outra', link: link.replace('?region=BR', '?x=1'), comprei: false, usei: false } }),
      (e: unknown) => e instanceof ErroDeCuradoria && e.status === 409
    )
  })
})
