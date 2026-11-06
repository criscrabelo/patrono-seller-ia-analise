/**
 * P2.51 — Ciclo comercial (funções puras): descoberta real, avaliação sem inventar, seleção, afiliação que bloqueia,
 * cadeia de direitos, roteiro só com fatos, fidelidade ao produto no Quality Gate Comercial e a liberação final.
 * Caminhos de sucesso, erro, bloqueio e recuperação.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  avaliarProduto, blocoDaCampanha, descobrirDaCuradoriaAnterior, descobrirDoCreatorCenter, exigirDescobertaReal, falaValida, fatosDoTitulo,
  manifestoDeDireitos, roteiroAutomatico, selecionarPrioritario, unirDescobertas, verificarAfiliacao, type AtivoDaCampanha, type LinhaDoCreatorCenter,
} from '../lib/ciclo-comercial'
import { liberacaoParaPublicacao } from '../lib/quality-gate-conformidade'
import { avaliarMontagem } from '../lib/quality-gate-comercial'

const agora = new Date('2026-10-21T18:00:00Z')
const ctx = { agora, comissaoValidaDias: 30, excluir: [{ chave: 'tiktok-shop:1734150650544162236', motivo: 'Emocionário fora da P2.51.' }] }
const SUZANO = 'Suzano Papel A4 75g Sulfite Report Premium Branco 500 Folhas Alta Brancura e Absorção Rápida para Impressão e Escrita'
const linha = (o: Partial<LinhaDoCreatorCenter> = {}): LinhaDoCreatorCenter => ({ produtoIdExterno: '1736244818989057096', produtoNome: SUZANO, lojaNome: 'Tutto Limpo', quantidade: 5, valorBase: 134.95, taxaComissao: 0.095, tipoConteudo: 'VITRINE', estado: 'CANCELADA', statusOriginal: 'Inelegível', dataPedido: '2026-08-02T19:18:35Z', ...o })
const origem = { arquivo: 'affiliate_orders.xlsx', sha256: 'a'.repeat(64), lidoEm: agora }
const curadoria = [
  { fonte: 'CATALOGO', externalId: null, nome: 'Robô Aspirador H40', linkProduto: 'https://shopee.com.br/x-i.1.2', categoria: 'Eletro', preco: 299.9, comissaoPercentual: 10, status: 'DESCARTADO', coletadoEm: '2026-10-11T00:00:00Z' },
  { fonte: 'USER_PROVIDED', externalId: '1734150650544162236', nome: 'Livro Emocionário', linkProduto: 'https://shop.tiktok.com/br/pdp/1734150650544162236', categoria: 'Papelaria', preco: null, comissaoPercentual: null, status: 'NOVO', coletadoEm: '2026-10-18T00:00:00Z' },
  { fonte: 'USER_PROVIDED', externalId: '1737831384554898597', nome: 'Árvore De Natal', linkProduto: 'https://shop.tiktok.com/br/pdp/1737831384554898597', categoria: 'Casa', preco: null, comissaoPercentual: null, status: 'DESCARTADO', coletadoEm: '2026-10-15T00:00:00Z' },
]
const todos = () => unirDescobertas(descobrirDoCreatorCenter([linha()], origem), descobrirDaCuradoriaAnterior(curadoria, 'leitura'))

describe('descoberta', () => {
  test('export oficial: um produto por id, preço unitário e comissão reais, pedido como evidência (não como venda)', () => {
    const [p] = descobrirDoCreatorCenter([linha(), linha({ dataPedido: '2026-08-05T00:00:00Z' }), linha({ produtoIdExterno: null })], origem)
    assert.equal(p.externalId, '1736244818989057096')
    assert.equal(p.precoUnitario, 26.99)
    assert.equal(p.comissaoPercentual, 9.5)
    assert.equal(p.evidencias.length, 2)
    assert.match(p.fonteDetalhe, /export oficial do TikTok Creator Center/)
  })
  test('curadoria anterior traz a DECISÃO da titular; mesma chave une fontes sem perder o feedback', () => {
    const t = todos()
    assert.equal(t.length, 4)
    assert.equal(t.find((p) => p.nome === 'Árvore De Natal')?.feedbackDaTitular, 'DESCARTOU')
  })
  test('ERRO: menos de 3 produtos reais → o ciclo para (nada é completado com exemplo)', () => {
    assert.throws(() => exigirDescobertaReal(descobrirDoCreatorCenter([linha()], origem)), /descoberta real insuficiente: 1/)
    assert.equal(exigirDescobertaReal(todos()).length, 4)
  })
})

describe('avaliação e seleção', () => {
  test('dado ausente vira LIMITAÇÃO escrita (vendas, avaliação, estoque; comissão antiga a reconferir)', () => {
    const a = avaliarProduto(todos()[0], ctx)
    assert.ok(a.limitacoes.some((l) => /vendas do produto: a fonte não informa/.test(l)))
    assert.ok(a.limitacoes.some((l) => /observada em 2026-08-02 \(mais de 30 dias\)/.test(l)))
    assert.ok(a.motivosPositivos.some((m) => /pedido\(s\) real\(is\)/.test(m)))
  })
  test('descartado pela titular e Emocionário não entram; o TikTok Shop elegível é escolhido com justificativa', () => {
    const sel = selecionarPrioritario(todos().map((p) => avaliarProduto(p, ctx)))
    assert.equal(sel.escolhido?.externalId, '1736244818989057096')
    assert.ok(sel.descartados.some((d) => d.motivos.some((m) => /NÃO QUERO/.test(m))))
    assert.ok(sel.descartados.some((d) => d.motivos.some((m) => /Emocionário/.test(m))))
    assert.ok(sel.justificativa.some((j) => /Comissão oficial: 9.5%/.test(j)))
  })
  test('nenhum elegível → sem escolha, com o motivo', () => {
    const sel = selecionarPrioritario(descobrirDaCuradoriaAnterior(curadoria, 'x').map((p) => avaliarProduto(p, ctx)))
    assert.equal(sel.escolhido, null)
    assert.match(sel.justificativa[0], /Nenhum produto elegível/)
  })
})

describe('afiliação (bloqueio comercial)', () => {
  const p = () => avaliarProduto(todos()[0], ctx)
  test('BLOQUEIO: conta de afiliada não confirmada e comissão vigente não conferida', () => {
    const v = verificarAfiliacao(p(), { contaVerificada: null }, agora, 30)
    assert.equal(v.programa, 'CONFIRMADO_POR_FONTE_OFICIAL')
    assert.equal(v.linkValido, true)
    assert.equal(v.liberacaoComercial, 'BLOQUEADA')
    assert.ok(v.pendencias.some((x) => /credenciamento pendente/.test(x)))
    assert.match(v.linkDeAfiliado, /MANUAL por limitação oficial/)
  })
  test('SUCESSO: conta verificada e comissão recente → liberação comercial', () => {
    const recente = { ...p(), comissaoObservadaEm: '2026-10-20T00:00:00Z' }
    assert.equal(verificarAfiliacao(recente, { contaVerificada: true }, agora, 30).liberacaoComercial, 'LIBERADA')
  })
  test('ERRO: link de outro produto é inválido', () => {
    const v = verificarAfiliacao({ ...p(), link: 'https://shop.tiktok.com/br/pdp/999' }, { contaVerificada: true }, agora, 30)
    assert.equal(v.linkValido, false)
    assert.equal(v.liberacaoComercial, 'BLOQUEADA')
  })
})

describe('cadeia de direitos', () => {
  const base: AtivoDaCampanha = { papel: 'ABERTURA', arquivo: 'C:/x/ciclo/abertura.mp4', sha256: 'b'.repeat(64), origem: 'GERADO_PELO_PATRONO', permissao: 'obra original' }
  const ctxD = { produtoChave: 'tiktok-shop:1', produtoAprovadoPelaTitular: false, pastasDeOutrosProdutos: ['PatronoSeller/emocionario'] }
  test('só ativos do Patrono, rastreáveis → aprovado', () => assert.equal(manifestoDeDireitos([base], ctxD).aprovado, true))
  test('BLOQUEIO: terceiro sem licença, licença sem documento, ativo de outro produto, voz da titular sem aprovação dela, sem sha256', () => {
    const m = manifestoDeDireitos([
      { ...base, papel: 'A', origem: 'TERCEIRO_SEM_LICENCA' },
      { ...base, papel: 'B', origem: 'LICENCIADO', evidencia: null },
      { ...base, papel: 'C', arquivo: 'C:\\Users\\x\\AppData\\Local\\PatronoSeller\\emocionario\\v4.mp4' },
      { ...base, papel: 'D', vozDaTitular: true },
      { ...base, papel: 'E', sha256: '' },
    ], ctxD)
    assert.equal(m.aprovado, false)
    assert.equal(m.problemas.length, 5)
  })
})

describe('roteiro automático', () => {
  test('só fatos verificáveis do título (sem as alegações de marketing); falas aceitas pela voz', () => {
    const f = fatosDoTitulo(SUZANO)
    assert.deepEqual([f.marca, f.formato, f.gramatura, f.quantidade, f.cor], ['Suzano', 'A4', '75', '500 folhas', 'branca'])
    const ficha = roteiroAutomatico(avaliarProduto(todos()[0], ctx), 'tts-1', 'Vídeos Suzano Papel A4')
    const tudo = [ficha.gancho, ficha.apresentacao, ficha.demonstracao, ficha.proposta, ficha.cta, ficha.legendaDoPost.descricao].join(' ')
    assert.doesNotMatch(tudo, /Alta Brancura|Absorção Rápida|oficial/i)
    for (const s of [ficha.gancho, ficha.apresentacao, ficha.demonstracao, ficha.proposta, ficha.cta]) assert.ok(falaValida(s), s)
    assert.equal(ficha.voz, 'neutra-local')
    assert.match(ficha.legendaDoPost.rotuloIA, /não é a voz da criadora/)
  })
  test('fala curta é recusada (lição da v6)', () => assert.equal(falaValida('Ternura, gratidão, orgulho, medo.'), false))
})

describe('fidelidade ao produto (Quality Gate Comercial)', () => {
  const falas = [
    { ini: 0.3, fim: 3, texto: 'Sabe aquela hora em que a impressora pede papel e acabou?', papel: 'GANCHO' as const },
    { ini: 3.4, fim: 7, texto: 'Esse é o papel A4 Suzano, em pacote de 500 folhas.', papel: 'APRESENTACAO' as const },
    { ini: 7.4, fim: 11, texto: 'Folha A4 de 75 gramas, no tamanho que a impressora já usa.', papel: 'DEMONSTRACAO' as const },
    { ini: 11.4, fim: 14, texto: 'Se quiser conhecer, o produto está na sacolinha do vídeo.', papel: 'CTA' as const },
  ]
  const m = (mostra: string[], categoria = 'Papelaria') => avaliarMontagem({
    duracao: 15, produto: { nome: 'Papel A4 Suzano', categoria }, produtoMarcado: false, falas,
    tomadas: [{ ini: 0, fim: 15, origem: 'a.mp4', origemIni: 0, mostra: mostra as never, movimento: 0.05, zoom: 1 }],
    textos: [], audio: { lufs: -14, picoDb: -2, vozSobreTrilhaDb: 12, trilha: 'PROPRIA', vozSintetica: true },
  })
  test('BLOQUEIO: produto que não é livro, só gráficos do Patrono → o produto real nunca aparece', () => {
    const r = m(['GRAFICO_DO_PATRONO'])
    assert.ok(r.bloqueios.some((b) => /produto real nunca aparece/.test(b)))
    assert.equal(r.criterios.fidelidadeAoProduto.nota, 0)
  })
  test('com o produto real na tela, não há esse bloqueio', () => assert.ok(!m(['PRODUTO_REAL']).bloqueios.some((b) => /produto real/.test(b))))
  test('livro sem capa mantém a regra anterior (desconta, não bloqueia) — Emocionário inalterado', () => {
    const r = m(['MAOS'], 'Livros')
    assert.ok(!r.bloqueios.some((b) => /produto real/.test(b)))
    assert.ok(r.criterios.fidelidadeAoProduto.diagnostico.some((d) => /capa/.test(d)))
  })
})

describe('liberação final (três controles + campanha)', () => {
  // P2.66: liberação exige também a Barreira de Qualidade Profissional (rodada157 cobre a barreira em si).
  const tres = { veredito: 'APROVADO', arquivo: { largura: 1080, sha256: 'abc' }, comercial: { veredito: 'APRESENTAR_A_TITULAR' }, conformidade: { veredito: 'APTO', resumo: 'ok' }, barreira: { decisao: 'APTO_PARA_TITULAR', sha256: 'abc' } }
  test('campanha BLOQUEADA retém mesmo com os três controles aprovados', () => {
    const p = avaliarProduto(todos()[0], ctx)
    const camp = blocoDaCampanha(verificarAfiliacao(p, { contaVerificada: null }, agora, 30), manifestoDeDireitos([], { produtoChave: p.chave, produtoAprovadoPelaTitular: false, pastasDeOutrosProdutos: [] }))
    const l = liberacaoParaPublicacao({ ...tres, campanha: camp })
    assert.equal(l.liberado, false)
    assert.ok(l.motivos.every((x) => x.startsWith('Campanha: ')))
  })
  test('três controles + campanha LIBERADA → liberado para a titular decidir (ainda depende dela)', () => {
    const l = liberacaoParaPublicacao({ ...tres, campanha: { liberacaoComercial: 'LIBERADA', motivos: [] } })
    assert.equal(l.liberado, true)
    assert.equal(l.aindaDependeDaTitular, true)
  })
  test('sem bloco de campanha (vídeos antigos): três controles + barreira APTA liberam', () => assert.equal(liberacaoParaPublicacao(tres).liberado, true))
  test('o motivo do bloqueio comercial aparece na liberação', () => {
    const l = liberacaoParaPublicacao({ ...tres, comercial: { veredito: 'BLOQUEADO', bloqueios: ['O produto real nunca aparece no vídeo.'] } })
    assert.match(l.motivos[0], /BLOQUEADO — O produto real nunca aparece/)
  })
})
