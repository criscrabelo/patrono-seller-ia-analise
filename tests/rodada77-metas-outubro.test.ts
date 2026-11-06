/**
 * P2.17.3.1 — Validação com a campanha real da titular ("Metas de Outubro",
 * 10/10 a 19/10/2026, recompensa total exibida R$ 230,00) como DADO DE TESTE.
 * Progresso 0 em tudo (nada inventado). Divisão da recompensa por meta: não informada.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { analisarMetas, missoesQueOVideoAjuda, recompensaEmJogo, type MetaParaAnalise } from '../lib/metas-tiktok'
import { planejarVideos } from '../lib/motor-de-videos-tiktok'

const AGORA = new Date('2026-10-11T08:00:00-03:00')
const base = { inicio: new Date('2026-10-10T00:00:00-03:00'), fim: new Date('2026-10-19T23:59:59-03:00'), recompensaValor: null, recompensaDescricao: null, requisitos: null, campanha: 'Metas de Outubro', recompensaCampanha: 230, quantidadeRealizada: 0 }
const OUTUBRO: MetaParaAnalise[] = [
  { ...base, id: 'q', nome: 'Vídeos qualificados publicados', tipo: 'VIDEOS_QUALIFICADOS', quantidadeExigida: 10 },
  { ...base, id: 'p', nome: 'Produtos adicionados', tipo: 'ADICIONAR_PRODUTOS', quantidadeExigida: 10 },
  { ...base, id: 'a', nome: 'Amostras solicitadas', tipo: 'SOLICITAR_AMOSTRAS', quantidadeExigida: 3 },
  { ...base, id: 'v', nome: 'Vídeos com produtos à venda publicados', tipo: 'VIDEOS_COM_PRODUTO', quantidadeExigida: 1 },
]

describe('P2.17.3.1 — Metas de Outubro (dado de teste)', () => {
  const analises = analisarMetas(OUTUBRO, AGORA)
  const por = (id: string) => analises.find((a) => a.id === id)!
  test('quanto falta, dias restantes e o que fazer hoje (progresso 0, nada inventado)', () => {
    assert.deepEqual([por('q').faltam, por('p').faltam, por('a').faltam, por('v').faltam], [10, 10, 3, 1])
    for (const a of analises) assert.equal(a.diasRestantes, 9)
    assert.deepEqual([por('q').hojeRecomendado, por('p').hojeRecomendado, por('a').hojeRecomendado, por('v').hojeRecomendado], [2, 2, 1, 1])
    assert.ok(por('q').frases.includes('Hoje recomendo publicar 2.'))
    assert.ok(por('p').frases.includes('Hoje recomendo adicionar 2.'))
    assert.ok(por('a').frases.includes('Hoje recomendo solicitar 1.'))
  })
  test('meta mais apertada = vídeos qualificados (maior ritmo ÷ ritmo sustentável)', () => {
    const maior = [...analises].sort((x, y) => y.pressao - x.pressao)[0]
    assert.equal(maior.id, 'q')
    assert.equal(maior.risco, 'BAIXO')
  })
  test('R$ 230 contado UMA vez; texto honesto sobre a divisão não informada', () => {
    assert.equal(recompensaEmJogo(OUTUBRO, analises), 230)
    assert.match(por('q').recompensaTexto, /parte da recompensa total de R\$\s?230,00 da campanha "Metas de Outubro" \(a divisão por meta não foi informada/)
    const encerradas = analisarMetas(OUTUBRO, new Date('2026-10-25T12:00:00-03:00'))
    assert.equal(recompensaEmJogo(OUTUBRO, encerradas), 0)
  })
  test('qual missão o vídeo ajuda: produto do TikTok Shop conta para as 4; fora dele, só "qualificado" (condicional)', () => {
    const tts = missoesQueOVideoAjuda(analises, { tiktokShop: true })
    assert.equal(tts.length, 4)
    assert.ok(tts.some((m) => /marcado no vídeo/.test(m)))
    assert.ok(tts.some((m) => /se o vendedor oferecer amostra grátis/.test(m)))
    const fora = missoesQueOVideoAjuda(analises, { tiktokShop: false })
    assert.equal(fora.length, 1)
    assert.match(fora[0], /se cumprir os critérios do TikTok para vídeo qualificado \(confira no app\)/)
  })
})

describe('P2.17.3.1 — qualidade dos vídeos', () => {
  test('ganchos sem artigo errado antes do nome; #tiktokshop só para produto do TikTok Shop', () => {
    const arvore = planejarVideos({ nome: 'Árvore De Natal Pinheiro Canadense Luxo 2,40', categoria: 'Casa e Decoração', preco: 400, tiktokShop: false }, AGORA)
    for (const v of arvore.variantes) assert.doesNotMatch(v.gancho, /\b(o|a) Árvore/)
    assert.ok(arvore.variantes.every((v) => !v.hashtags.includes('#tiktokshop')))
    const tts = planejarVideos({ nome: 'Kit copos', categoria: 'Casa e Decoração', preco: 40, tiktokShop: true }, AGORA)
    assert.ok(tts.variantes.every((v) => v.hashtags.includes('#tiktokshop')))
  })
  test('decoração natalina testa demonstração e POV primeiro (nada de "problema em casa")', () => {
    const arvore = planejarVideos({ nome: 'Árvore de Natal com pisca-pisca', categoria: 'Casa e Decoração', preco: 300, tiktokShop: true }, AGORA)
    assert.deepEqual(arvore.testeInicial.variantes.map((id) => id.split('-')[0]), ['DEMONSTRACAO', 'POV', 'ACHADO_TIKTOK_SHOP'])
    const presente = planejarVideos({ nome: 'Kit skincare feminino presente', categoria: 'Beleza', preco: 60, tiktokShop: true }, AGORA)
    assert.equal(presente.testeInicial.variantes[0].split('-')[0], 'PRESENTE')
  })
})

const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')

describe('P2.17.3.1 — painel no banco de TESTE', { skip: !TEM_BANCO ? 'exige banco de TESTE' : false }, () => {
  let prisma: typeof import('../lib/prisma').prisma
  let H: typeof import('../lib/metas-tiktok-http')
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  const PREFIXO = 'Conta de Teste — '
  const marca = `r77-${Date.now()}`
  let ws = ''
  before(async () => {
    ;[{ prisma }, H, { limparWorkspaceDeTeste: limpar }] = await Promise.all([import('../lib/prisma'), import('../lib/metas-tiktok-http'), import('./_limpar-workspace-de-teste')])
    ws = (await prisma.workspace.create({ data: { name: `${PREFIXO}metas outubro P2.17.3.1`, ownerId: marca }, select: { id: true } })).id
    const inicio = new Date(Date.now() - 86400000), fim = new Date(Date.now() + 8 * 86400000)
    for (const m of OUTUBRO) {
      await prisma.metaTikTokShop.create({ data: { workspaceId: ws, nome: m.nome, tipo: m.tipo, inicio, fim, campanha: 'Metas de Outubro', recompensaCampanha: 230, quantidadeExigida: m.quantidadeExigida, quantidadeRealizada: 0, requisitos: 'Dado de teste' } })
    }
    const comum = { workspaceId: ws, fonte: 'CATALOGO', imagemAutorizada: false, score: 60, baseDeEvidencia: 55, confianca: 'MEDIA', motivosPositivos: [], riscos: [], desconhecidos: [], porqueDestaPosicao: [], status: 'NOVO' as const, coletadoEm: new Date(), validoAte: new Date(Date.now() + 86400000) }
    await prisma.candidatoDeProduto.create({ data: { ...comum, chaveDeOrigem: `${marca}:a`, nome: 'FIXTURE Kit copos de vidro', categoria: 'Casa e Decoração', preco: 40 } })
  })
  after(async () => {
    if (prisma && ws) await limpar(prisma, ws, PREFIXO)
    await prisma?.$disconnect()
  })

  test('sem produto do TikTok Shop: R$ 230 uma vez, alerta claro e ações ajustadas', async () => {
    const p = await H.painelDeMetas(ws)
    assert.equal(p.resumo.recompensaEmJogo, 230)
    assert.equal(p.campanhas[0].recompensaTotal, 230)
    assert.equal(p.campanhas[0].faltamTotal, 24)
    assert.match(p.resumo.alerta ?? '', /nenhum produto recomendado agora é do TikTok Shop/)
    assert.match(p.metas.find((m) => m.tipo === 'ADICIONAR_PRODUTOS')!.proximaAcao, /com produtos do TikTok Shop/)
    assert.equal(p.resumo.videosHoje, 2)
    assert.match(p.resumo.receita ?? '', /R\$\s?230,00, contada uma vez por campanha/)
    assert.match(p.resumo.receita ?? '', /Não projeto quantas vendas/)
    const g = p.produtos[0].videos!.ganchos
    assert.equal(g.length, 3)
    for (const x of g) {
      assert.equal(x.curta.segundos, 15)
      assert.equal(x.media.segundos, 30)
      assert.ok(x.ctaA && x.ctaB && x.ctaA !== x.ctaB)
      assert.match(x.legendaA, /comissão/)
      assert.ok(x.hashtags.length > 0)
    }
  })

  test('com produto do TikTok Shop: sem alerta; o produto sobe por ajudar a missão e conta para as 4 metas', async () => {
    await prisma.candidatoDeProduto.create({
      data: {
        workspaceId: ws, fonte: 'USER_PROVIDED', providerId: 'tiktok-shop', externalId: '9000000000000000555', chaveDeOrigem: `${marca}:t`,
        nome: 'FIXTURE Organizador de gavetas', categoria: 'Casa e Decoração', preco: 50, linkProduto: 'https://shop.tiktok.com/view/product/9000000000000000555',
        imagemAutorizada: false, score: 60, baseDeEvidencia: 55, confianca: 'MEDIA', motivosPositivos: [], riscos: [], desconhecidos: [], porqueDestaPosicao: [],
        status: 'NOVO', coletadoEm: new Date(), validoAte: new Date(Date.now() + 86400000),
      },
    })
    const p = await H.painelDeMetas(ws)
    assert.equal(p.resumo.alerta, null)
    assert.equal(p.produtos[0].nome, 'FIXTURE Organizador de gavetas')
    assert.equal(p.produtos[0].ajudaMissao, true)
    assert.equal(p.produtos[0].videos!.missoes.length, 4)
  })
})
