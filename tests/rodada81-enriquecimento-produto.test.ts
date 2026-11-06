/**
 * P2.17.6 — Enriquecimento automático de produto + inteligência comercial.
 * Ofertas abaixo são FIXTURE (dados fictícios, só para testar o caminho);
 * nenhuma API real é chamada.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  alertaDaMudanca, chaveDoDado, comissaoEmReais, confirmarUnidade, identificarProduto, mudancasDeDado, normalizarOferta, sobreporDadoOficial, type OfertaBruta,
} from '../lib/dados-de-produto'
import { linkDoTikTokShop, ehProdutoTikTokShop } from '../lib/tiktok-shop-link'
import { compararComissaoEOportunidade, montarVisao, notaDeOportunidade, VISOES, type ProdutoParaVisao } from '../lib/visoes-de-produtos'
import { regraDaRota } from '../lib/modulos-rotas'

const OFERTA: OfertaBruta = {
  preco: 79.9, precoAnterior: null, descontoPercentual: null, moeda: 'BRL', taxaDeComissao: null, unidadeDocumentada: null, comissaoValor: null,
  vendas: null, avaliacao: null, numeroDeAvaliacoes: null, estoque: null, disponivel: null, categoria: null, imagem: null, loja: null,
}

describe('P2.17.6 — identificar o produto pelo link', () => {
  test('TikTok Shop /pdp/ (formato real dos links da titular) é reconhecido', () => {
    assert.deepEqual(linkDoTikTokShop('https://shop.tiktok.com/br/pdp/1737831384554898597'), { ehTikTok: true, ehProduto: true, productId: '1737831384554898597', curto: false })
    assert.equal(linkDoTikTokShop('https://shop.tiktok.com/br/pdp/arvore-de-natal-luxo/1737831384554898597?source=x').productId, '1737831384554898597')
    assert.ok(ehProdutoTikTokShop(null, 'https://shop.tiktok.com/br/pdp/1733030408360724242'))
    assert.equal(linkDoTikTokShop('https://shop.tiktok.com.golpe.example/br/pdp/1737831384554898597').ehTikTok, false)
  })
  test('Shopee: loja.item do link completo; link curto não é aberto', () => {
    assert.deepEqual(identificarProduto('https://shopee.com.br/Kit-Jogo-04-Copos-Cactus-i.123456.7890123'), { provider: 'shopee', externalId: '123456.7890123', curto: false })
    assert.deepEqual(identificarProduto('https://shopee.com.br/product/123/456'), { provider: 'shopee', externalId: '123.456', curto: false })
    assert.deepEqual(identificarProduto('https://s.shopee.com.br/5flqnUahlb'), { provider: 'shopee', externalId: null, curto: true })
  })
  test('chave: provider:id quando reconhecido; senão hash do link; sem link = null', () => {
    assert.equal(chaveDoDado('https://shop.tiktok.com/br/pdp/1737831384554898597', identificarProduto('https://shop.tiktok.com/br/pdp/1737831384554898597')), 'tiktok-shop:1737831384554898597')
    assert.match(chaveDoDado('https://loja.example/x', identificarProduto('https://loja.example/x')) ?? '', /^link:[0-9a-f]{32}$/)
    assert.equal(chaveDoDado(null, identificarProduto(null)), null)
  })
})

describe('P2.17.6 — comissão: unidade confirmada, nunca por palpite', () => {
  test('R$ 79,90 × 12% = R$ 9,59', () => {
    assert.equal(comissaoEmReais(79.9, 12), 9.59)
    assert.equal(comissaoEmReais(null, 12), null)
    assert.equal(comissaoEmReais(79.9, null), null)
  })
  test('taxa sem documentação e sem valor em R$ = NÃO confirmada → comissão desconhecida', () => {
    const n = normalizarOferta({ ...OFERTA, taxaDeComissao: 0.12 })
    assert.equal(n.unidadeDaComissao, 'NAO_CONFIRMADA')
    assert.equal(n.comissaoPercentual, null)
    assert.equal(n.comissaoValor, null)
    assert.match(n.avisos.join(' '), /unidade não está confirmada/)
  })
  test('coerência com o valor em R$ da própria resposta confirma a unidade', () => {
    assert.equal(confirmarUnidade({ preco: 79.9, taxa: 0.12, comissaoValor: 9.59, documentada: null }), 'FRACAO_CONFIRMADA')
    assert.equal(confirmarUnidade({ preco: 79.9, taxa: 12, comissaoValor: 9.59, documentada: null }), 'PERCENTUAL_CONFIRMADO')
    assert.equal(confirmarUnidade({ preco: 79.9, taxa: 12, comissaoValor: 3, documentada: null }), 'NAO_CONFIRMADA')
    const n = normalizarOferta({ ...OFERTA, taxaDeComissao: 0.12, comissaoValor: 9.59 })
    assert.deepEqual([n.comissaoPercentual, n.comissaoValor], [12, 9.59])
  })
  test('unidade documentada: % e R$ calculado (só com preço e % reais)', () => {
    const n = normalizarOferta({ ...OFERTA, taxaDeComissao: 12, unidadeDocumentada: 'PERCENTUAL' })
    assert.deepEqual([n.comissaoPercentual, n.comissaoValor], [12, 9.59])
    const semPreco = normalizarOferta({ ...OFERTA, preco: null, taxaDeComissao: 12, unidadeDocumentada: 'PERCENTUAL' })
    assert.deepEqual([semPreco.comissaoPercentual, semPreco.comissaoValor], [12, null])
  })
  test('desconto do preço anterior; avaliação fora de 0–5 descartada', () => {
    const n = normalizarOferta({ ...OFERTA, preco: 69.9, precoAnterior: 89.9, avaliacao: 7 })
    assert.equal(n.descontoPercentual, 22.2)
    assert.equal(n.avaliacao, null)
  })
})

describe('P2.17.6 — histórico e alertas', () => {
  test('"Comissão subiu de 8% para 12%." e "Preço caiu de R$ 89,90 para R$ 69,90."', () => {
    assert.equal(alertaDaMudanca({ campo: 'comissaoPercentual', anterior: '8', novo: '12' }), 'Comissão subiu de 8% para 12%.')
    assert.match(alertaDaMudanca({ campo: 'preco', anterior: '89.9', novo: '69.9' }) ?? '', /^Preço caiu de R\$\s?89,90 para R\$\s?69,90\.$/)
  })
  test('ausência na fonte não apaga nem gera histórico; só o que mudou entra', () => {
    const novo = normalizarOferta({ ...OFERTA, preco: 79.9, taxaDeComissao: 12, unidadeDocumentada: 'PERCENTUAL' })
    const m = mudancasDeDado({ preco: 79.9, comissaoPercentual: 8, vendas: 100 }, novo)
    assert.deepEqual(m.map((x) => x.campo).sort(), ['comissaoPercentual', 'comissaoValor'])
  })
  test('dado oficial vence campo a campo; o que a fonte não trouxe continua', () => {
    const r = sobreporDadoOficial({ preco: 70, comissaoPercentual: null, comissaoValor: null, vendas: null, avaliacao: 4.1, numeroDeAvaliacoes: 3, estoque: null }, { preco: 79.9, comissaoPercentual: 12, vendas: 500 })
    assert.deepEqual([r.preco, r.comissaoPercentual, r.comissaoValor, r.vendas, r.avaliacao], [79.9, 12, 9.59, 500, 4.1])
  })
})

function prod(id: string, extra: Partial<ProdutoParaVisao> = {}): ProdutoParaVisao {
  return {
    id, nome: `FIXTURE ${id}`, preco: 50, precoAnterior: null, descontoPercentual: null, comissaoPercentual: 10, comissaoValor: 5, vendas: 100, avaliacao: 4.5, numeroDeAvaliacoes: 50,
    estoque: 10, conversao: null, baseDeEvidencia: 50, aderenciaNatal: null, tiktokShop: false, ajudaMissao: false, facilidadeVideo: 60, nivelDeRisco: 'BAIXO', complianceBloqueante: false, ...extra,
  }
}

describe('P2.17.6 — visões com explicação', () => {
  const ALTA_COMISSAO_SEM_VENDA = prod('alta', { comissaoPercentual: 30, comissaoValor: 30, preco: 100, vendas: 10, baseDeEvidencia: 20 })
  const VENDE_MUITO = prod('volume', { comissaoPercentual: 8, comissaoValor: 4, preco: 50, vendas: 5000, baseDeEvidencia: 85 })
  const SEM_DADO = prod('vazio', { comissaoPercentual: null, comissaoValor: null, vendas: null, preco: null, avaliacao: null, numeroDeAvaliacoes: null })
  const BLOQUEADO = prod('bloq', { complianceBloqueante: true, comissaoValor: 99 })
  const LISTA = [ALTA_COMISSAO_SEM_VENDA, VENDE_MUITO, SEM_DADO, BLOQUEADO]

  test('15 visões, 6 rápidas (Mais vendidos | Maior comissão | Melhor oportunidade | Menor preço | Natal | TikTok)', () => {
    assert.equal(VISOES.length, 15)
    assert.deepEqual(VISOES.filter((v) => v.rapida).map((v) => v.rotulo), ['Mais vendidos', 'Maior comissão', 'Melhor oportunidade', 'Menor preço', 'Melhor para Natal', 'Melhor para TikTok'])
    for (const v of VISOES) {
      const itens = montarVisao(v.id, LISTA)
      assert.ok(itens.every((i) => i.id !== 'bloq'), `${v.id}: compliance bloqueante nunca aparece`)
      assert.ok(itens.every((i) => i.porque.length > 10), `${v.id}: toda posição explica o porquê`)
    }
  })
  test('maior comissão ≠ melhor oportunidade; explicação de consultor', () => {
    assert.equal(montarVisao('MAIOR_COMISSAO', LISTA)[0].id, 'alta')
    const o = montarVisao('MELHOR_OPORTUNIDADE', LISTA)
    assert.equal(o[0].id, 'volume')
    assert.match(o[0].porque, /Paga menos comissão, porém o volume de vendas é o maior da lista\./)
    assert.match(o.find((i) => i.id === 'alta')!.porque, /Tem a maior comissão, mas vende pouco\./)
    assert.match(compararComissaoEOportunidade(LISTA) ?? '', /"FIXTURE alta" paga mais comissão, mas eu priorizaria "FIXTURE volume" porque vende muito mais/)
  })
  test('sem dado = fim da visão, com o motivo (nada estimado)', () => {
    for (const v of ['MAIS_VENDIDOS', 'MAIOR_COMISSAO', 'MENOR_PRECO', 'POTENCIAL_DE_RECEITA'] as const) {
      const itens = montarVisao(v, LISTA)
      assert.equal(itens.at(-1)!.id, 'vazio', v)
      assert.match(itens.at(-1)!.porque, /Sem dado de .*: fica no fim desta visão \(nada foi estimado\)\./)
    }
    assert.ok(notaDeOportunidade(SEM_DADO, LISTA).desconhecidos.includes('vendas'))
  })
  test('TikTok: produto que ajuda missão primeiro; fora do TikTok Shop explica que não conta', () => {
    const itens = montarVisao('MISSAO_TIKTOK', [prod('fora'), prod('tts', { tiktokShop: true, ajudaMissao: true })])
    assert.equal(itens[0].id, 'tts')
    assert.match(itens[1].porque, /Fora do TikTok Shop/)
  })
})

describe('P2.17.6 — segurança e honestidade', () => {
  test('sem scraping: nenhuma leitura de página, nenhum leitor oficial ativo sem documentação', () => {
    const codigo = ['lib/dados-de-produto.ts', 'lib/fontes-de-dados-de-produto.ts', 'lib/enriquecimento-de-produto.ts'].map((f) => fs.readFileSync(f, 'utf8')).join('\n')
    assert.doesNotMatch(codigo, /fetch\(|cheerio|puppeteer|playwright|innerHTML/)
    assert.match(fs.readFileSync('lib/fontes-de-dados-de-produto.ts', 'utf8'), /export const LEITORES_ATIVOS: Partial<Record<FonteOficial, LeitorOficial>> = \{\}/)
  })
  test('rotas novas exigem o módulo de oportunidades', () => {
    assert.deepEqual(regraDaRota('/api/oportunidades/enriquecer', 'POST')?.modulos, ['oportunidades'])
    assert.deepEqual(regraDaRota('/api/oportunidades/visoes', 'GET')?.modulos, ['oportunidades'])
  })
})

const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')

describe('P2.17.6 — banco de TESTE', { skip: !TEM_BANCO ? 'exige banco de TESTE' : false }, () => {
  let prisma: typeof import('../lib/prisma').prisma
  let E: typeof import('../lib/enriquecimento-de-produto')
  let C: typeof import('../lib/curadoria')
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  const PREFIXO = 'Conta de Teste — '
  const marca = `r81-${Date.now()}`
  const ws: string[] = []
  const users: string[] = []
  const AGORA = new Date('2026-10-11T12:00:00-03:00')
  const LINK_TTS = 'https://shop.tiktok.com/br/pdp/9000000000000000081'
  const LINK_SHOPEE = 'https://shopee.com.br/FIXTURE-Produto-i.111.222'
  const ENV_FIXTURE = { SHOPEE_AFFILIATE_APP_ID: 'fixture', SHOPEE_AFFILIATE_SECRET: 'fixture' }

  before(async () => {
    ;[{ prisma }, E, C, { limparWorkspaceDeTeste: limpar }] = await Promise.all([import('../lib/prisma'), import('../lib/enriquecimento-de-produto'), import('../lib/curadoria'), import('./_limpar-workspace-de-teste')])
    for (const n of ['A', 'B']) {
      const w = (await prisma.workspace.create({ data: { name: `${PREFIXO}enriquecimento ${n} P2.17.6`, ownerId: `${marca}-${n}` }, select: { id: true } })).id
      ws.push(w)
      users.push((await prisma.user.create({ data: { email: `${marca}-${n}@teste.local`, name: 'U', password: 'x', workspaceId: w }, select: { id: true } })).id)
    }
    // Informado ANTES da correção do /pdp/ (sem provider), como os da titular.
    const base = { score: 50, baseDeEvidencia: 30, confianca: 'SEM_HISTORICO_REAL', fonte: 'USER_PROVIDED', status: 'NOVO' as const, coletadoEm: AGORA, validoAte: new Date('2026-12-01'), motivosPositivos: [], riscos: [], desconhecidos: [], porqueDestaPosicao: [] }
    await prisma.candidatoDeProduto.create({ data: { ...base, workspaceId: ws[0], chaveDeOrigem: `${marca}-tts`, nome: 'FIXTURE TikTok', linkProduto: LINK_TTS } })
    await prisma.candidatoDeProduto.create({ data: { ...base, workspaceId: ws[0], chaveDeOrigem: `${marca}-shopee`, nome: 'FIXTURE Shopee', linkProduto: LINK_SHOPEE, preco: 70 } })
    await prisma.candidatoDeProduto.create({ data: { ...base, workspaceId: ws[0], chaveDeOrigem: `${marca}-curto`, nome: 'FIXTURE Curto', linkProduto: 'https://s.shopee.com.br/abc' } })
  })
  after(async () => {
    for (const w of ws) await limpar(prisma, w, PREFIXO)
    await prisma?.$disconnect()
  })

  test('tabelas novas com RLS e sem acesso público', async () => {
    for (const t of ['DadoOficialDeProduto', 'HistoricoDadoDeProduto']) {
      const [l] = await prisma.$queryRaw<{ rls: boolean; acesso: boolean }[]>`
        select c.relrowsecurity as rls,
          (has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE')) as acesso
        from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = ${t}`
      assert.deepEqual([l.rls, l.acesso], [true, false], t)
    }
  })

  test('sem fonte oficial: motivo por produto, data da consulta, nada inventado; /pdp/ ganha a identidade do TikTok Shop', async () => {
    const r = await E.enriquecerCandidatos({ workspaceId: ws[0], userId: users[0], agora: AGORA, env: {} })
    const tts = r.linhas.find((l) => l.nome === 'FIXTURE TikTok')!
    assert.equal(tts.motivoCurto, 'O TikTok ainda não forneceu esse dado.')
    assert.deepEqual(tts.depois, tts.antes)
    assert.equal(r.linhas.find((l) => l.nome === 'FIXTURE Shopee')!.motivoCurto, 'A Shopee ainda não forneceu esse dado.')
    assert.equal(r.linhas.find((l) => l.nome === 'FIXTURE Curto')!.situacao, 'NAO_IDENTIFICADO')
    const c = await prisma.candidatoDeProduto.findFirst({ where: { workspaceId: ws[0], nome: 'FIXTURE TikTok' } })
    assert.deepEqual([c?.providerId, c?.externalId, c?.comissaoPercentual], ['tiktok-shop', '9000000000000000081', null])
    const d = await prisma.dadoOficialDeProduto.findFirst({ where: { workspaceId: ws[0], chave: 'tiktok-shop:9000000000000000081' } })
    assert.deepEqual([d?.situacao, d?.atualizadoEm, d?.preco], ['INDISPONIVEL', null, null])
    assert.equal(await prisma.historicoDadoDeProduto.count({ where: { workspaceId: ws[0] } }), 0)
  })

  test('fonte oficial (FIXTURE): antes/depois, comissão 8% → 12% registrada, sem duplicar, só no workspace certo', async () => {
    let taxa = 8
    const leitor = async (ids: string[]) => new Map(ids.map((id) => [id, { ...OFERTA, preco: 79.9, taxaDeComissao: taxa, unidadeDocumentada: 'PERCENTUAL' as const, vendas: 1200, avaliacao: 4.8, numeroDeAvaliacoes: 340, estoque: 50, loja: 'FIXTURE Loja' }]))
    const r1 = await E.enriquecerCandidatos({ workspaceId: ws[0], userId: users[0], agora: AGORA, env: ENV_FIXTURE, leitores: { SHOPEE_AFFILIATE_API: leitor } })
    const l1 = r1.linhas.find((l) => l.nome === 'FIXTURE Shopee')!
    assert.deepEqual(l1.antes, { preco: 70, comissaoPercentual: null, comissaoValor: null, vendas: null, avaliacao: null, estoque: null })
    assert.deepEqual(l1.depois, { preco: 79.9, comissaoPercentual: 8, comissaoValor: 6.39, vendas: 1200, avaliacao: 4.8, estoque: 50 })
    taxa = 12
    const r2 = await E.enriquecerCandidatos({ workspaceId: ws[0], userId: users[0], agora: new Date(AGORA.getTime() + 3600_000), env: ENV_FIXTURE, leitores: { SHOPEE_AFFILIATE_API: leitor } })
    assert.ok(r2.linhas.find((l) => l.nome === 'FIXTURE Shopee')!.alertas.includes('Comissão subiu de 8% para 12%.'))
    assert.equal(await prisma.dadoOficialDeProduto.count({ where: { workspaceId: ws[0], chave: 'shopee:111.222' } }), 1)
    const h = await prisma.historicoDadoDeProduto.findFirst({ where: { workspaceId: ws[0], campo: 'comissaoPercentual', valorAnterior: '8' } })
    assert.equal(h?.valorNovo, '12')
    const c = await prisma.candidatoDeProduto.findFirst({ where: { workspaceId: ws[0], nome: 'FIXTURE Shopee' } })
    assert.deepEqual([c?.comissaoPercentual, c?.comissaoValor], [12, 9.59])
    assert.equal(await prisma.dadoOficialDeProduto.count({ where: { workspaceId: ws[1] } }), 0, 'isolamento')
  })

  test('a coleta seguinte mantém o dado oficial (não volta a "desconhecido")', async () => {
    await C.coletarCandidatos({ workspaceId: ws[0], userId: users[0], agora: new Date(AGORA.getTime() + 7200_000) })
    const c = await prisma.candidatoDeProduto.findFirst({ where: { workspaceId: ws[0], nome: 'FIXTURE Shopee' } })
    assert.deepEqual([c?.preco, c?.comissaoPercentual, c?.comissaoValor, c?.vendas], [79.9, 12, 9.59, 1200])
  })
})
