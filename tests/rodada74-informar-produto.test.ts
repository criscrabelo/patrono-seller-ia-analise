/**
 * P2.17.1 — BUG "Não foi possível informar" com produto real do TikTok Shop.
 *
 * Causas tratadas (sem mudar regra: nome e link obrigatórios, nada inventado):
 * título do TikTok Shop > 200 caracteres, link colado junto com texto do
 * "Compartilhar", imagem em formato inesperado — e mensagem por campo.
 * Links de FIXTURE (ids 9000…), no mesmo formato do link real.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { lerEntradaInformada, extrairUrl, MAX_NOME } from '../lib/informar-produto-entrada'

const LINK = 'https://shop.tiktok.com/view/product/9000000000000000077?region=BR&locale=pt-BR&source=product_detail'
const TITULO_LONGO = ('FIXTURE Kit 3 Potes Herméticos de Vidro com Tampa de Bambu Organizador de Cozinha Mantimentos ' ).repeat(3).slice(0, 255)

describe('P2.17.1 — entrada do "Informar produto"', () => {
  test('link real do TikTok Shop, sozinho: aceito como está', () => {
    const r = lerEntradaInformada({ nome: 'FIXTURE Garrafa', link: LINK, comprei: false, usei: true })
    assert.ok(r.ok)
    assert.equal(r.ok && r.dados.link, LINK)
  })
  test('link colado com o texto do "Compartilhar": usa o endereço', () => {
    const r = lerEntradaInformada({ nome: 'FIXTURE Garrafa', link: `Confira este produto no TikTok Shop! ${LINK} 🔥`, comprei: false, usei: false })
    assert.ok(r.ok)
    assert.equal(r.ok && r.dados.link, LINK)
    assert.equal(extrairUrl('veja (https://shop.tiktok.com/view/product/1234567890123).'), 'https://shop.tiktok.com/view/product/1234567890123')
  })
  test('título de 255 caracteres (máximo do TikTok Shop) passa; acima de 300, mensagem clara', () => {
    assert.equal(TITULO_LONGO.length, 255)
    assert.ok(lerEntradaInformada({ nome: TITULO_LONGO, link: LINK }).ok)
    const r = lerEntradaInformada({ nome: 'x'.repeat(MAX_NOME + 1), link: LINK })
    assert.equal(r.ok, false)
    assert.match(!r.ok ? r.mensagem : '', /tem 301 caracteres; o máximo é 300/)
  })
  test('erros viram frases, por campo (nunca só "Dados inválidos")', () => {
    const semLink = lerEntradaInformada({ nome: 'FIXTURE', link: 'shop.tiktok.com/produto' })
    assert.ok(!semLink.ok && /Não encontrei um link válido/.test(semLink.mensagem) && semLink.campos.includes('link'))
    const semNome = lerEntradaInformada({ nome: '   ', link: LINK })
    assert.ok(!semNome.ok && /Informe o nome/.test(semNome.mensagem))
    const img = lerEntradaInformada({ nome: 'FIXTURE', link: LINK, imagem: 'imagem.jpg' })
    assert.ok(!img.ok && /link da imagem/.test(img.mensagem))
    const cat = lerEntradaInformada({ nome: 'FIXTURE', link: LINK, categoria: 'Inexistente' })
    assert.ok(!cat.ok && /categoria/.test(cat.mensagem))
    for (const r of [semLink, semNome, img, cat]) assert.ok(!r.ok && !/^Dados inválidos\.?$/.test(r.mensagem))
  })
  test('campos opcionais vazios continuam vazios (nada é completado)', () => {
    const r = lerEntradaInformada({ nome: 'FIXTURE', link: LINK, imagem: '', categoria: '', preco: null })
    assert.ok(r.ok)
    assert.deepEqual(r.ok && [r.dados.imagem, r.dados.categoria, r.dados.preco], [null, null, null])
  })
  test('a rota usa a leitura nova e a tela mostra o erro na hora, dentro do formulário', () => {
    const rota = fs.readFileSync('app/api/oportunidades/informar/route.ts', 'utf8')
    assert.match(rota, /lerEntradaInformada\(body\)/)
    assert.match(rota, /error: parsed\.mensagem/)
    const tela = fs.readFileSync('app/(dashboard)/oportunidades/page.tsx', 'utf8')
    assert.match(tela, /role="alert"/)
    assert.match(tela, /Sua sessão expirou/)
    assert.doesNotMatch(tela, /'Não foi possível informar'/)
  })
})

const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')

describe('P2.17.1 — ponta a ponta no banco de TESTE: informar → candidato → ranking', { skip: !TEM_BANCO ? 'exige banco de TESTE' : false }, () => {
  let prisma: typeof import('../lib/prisma').prisma
  let C: typeof import('../lib/curadoria')
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  const PREFIXO = 'Conta de Teste — '
  const marca = `r74-${Date.now()}`
  const ws: string[] = []
  const users: string[] = []

  before(async () => {
    ;[{ prisma }, C, { limparWorkspaceDeTeste: limpar }] = await Promise.all([import('../lib/prisma'), import('../lib/curadoria'), import('./_limpar-workspace-de-teste')])
    for (const n of ['A', 'B']) {
      const w = (await prisma.workspace.create({ data: { name: `${PREFIXO}informar ${n} P2.17.1`, ownerId: `${marca}-${n}` }, select: { id: true } })).id
      ws.push(w)
      users.push((await prisma.user.create({ data: { email: `${marca}-${n}@teste.local`, name: 'U', password: 'x', workspaceId: w }, select: { id: true } })).id)
    }
  })
  after(async () => {
    for (const w of ws) await limpar(prisma, w, PREFIXO)
    await prisma?.$disconnect()
  })

  test('produto do TikTok Shop com título longo e link compartilhado: candidato criado e apresentado', async () => {
    const entrada = lerEntradaInformada({ nome: TITULO_LONGO, link: `Olha isso: ${LINK}`, preco: 59.9, comprei: false, usei: true })
    assert.ok(entrada.ok)
    if (!entrada.ok) return
    const c = await C.informarProduto({ workspaceId: ws[0], userId: users[0], dados: { ...entrada.dados, imagem: null } })
    assert.equal(c.nome, TITULO_LONGO)
    assert.equal(c.linkProduto, LINK)
    assert.equal(c.providerId, 'tiktok-shop')
    assert.equal(c.externalId, '9000000000000000077')
    const r = await C.coletarCandidatos({ workspaceId: ws[0], userId: users[0] })
    assert.equal(r.avaliados, 1)
    const apresentados = await C.listarApresentados(ws[0])
    assert.equal(apresentados.length, 1)
    assert.equal(apresentados[0].id, c.id)
    assert.equal(apresentados[0].posicao, 1)
  })

  test('o mesmo produto de novo: recusa com mensagem clara (não duplica)', async () => {
    await assert.rejects(
      C.informarProduto({ workspaceId: ws[0], userId: users[0], dados: { nome: 'outra', link: LINK.replace('&source=product_detail', ''), comprei: false, usei: false } }),
      (e: Error) => /já está entre os candidatos|já foi informado/.test(e.message)
    )
  })

  test('isolamento: o outro workspace não vê nem é bloqueado pelo produto de A', async () => {
    assert.equal((await C.listarApresentados(ws[1])).length, 0)
    const cB = await C.informarProduto({ workspaceId: ws[1], userId: users[1], dados: { nome: 'FIXTURE em B', link: LINK, comprei: false, usei: false } })
    assert.equal(cB.workspaceId, ws[1])
  })
})
