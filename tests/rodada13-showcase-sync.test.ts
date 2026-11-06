/**
 * Rodada 13 — paginação, adaptação e execução da sincronização de catálogo.
 *
 * Nenhum teste aqui fala com o TikTok: a paginação recebe a função de busca
 * por parâmetro e o adaptador trabalha sobre fixtures. É o que permite provar
 * a regra mais perigosa do fluxo (quando NÃO inativar) muito antes de existir
 * aprovação da Affiliate API.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { percorrerPaginas, type PaginaDeResultado } from '../lib/paginacao'
import {
  adaptarItemDoTikTokShop,
  adaptarCatalogoDoTikTokShop,
  type ItemBruto,
} from '../lib/tiktok-shop-catalogo-adapter'
import { reconciliarCatalogo } from '../lib/catalogo-sync'

describe('Percurso de paginacao', () => {
  function paginador(paginas: Array<{ itens: number[]; proximo: string | null }>) {
    let chamada = 0
    return async (): Promise<PaginaDeResultado<number>> => {
      const p = paginas[chamada++]
      return { itens: p.itens, proximoCursor: p.proximo }
    }
  }

  test('le todas as paginas ate a API dizer que acabou', async () => {
    const r = await percorrerPaginas(
      paginador([
        { itens: [1, 2], proximo: 'c1' },
        { itens: [3, 4], proximo: 'c2' },
        { itens: [5], proximo: null },
      ]),
      { maxPaginas: 10 }
    )
    assert.deepEqual(r.itens, [1, 2, 3, 4, 5])
    assert.equal(r.paginacaoCompleta, true)
    assert.equal(r.paginasLidas, 3)
    assert.equal(r.motivo, null)
  })

  test('pagina unica sem cursor ja e completa', async () => {
    const r = await percorrerPaginas(paginador([{ itens: [1], proximo: null }]), { maxPaginas: 10 })
    assert.equal(r.paginacaoCompleta, true)
    assert.equal(r.paginasLidas, 1)
  })

  test('vitrine vazia e completa, nao um erro', async () => {
    const r = await percorrerPaginas(paginador([{ itens: [], proximo: null }]), { maxPaginas: 10 })
    assert.deepEqual(r.itens, [])
    assert.equal(r.paginacaoCompleta, true)
  })

  test('FALHA no meio: devolve o que leu e marca INCOMPLETA, sem lancar', async () => {
    let chamada = 0
    const r = await percorrerPaginas<number>(async () => {
      chamada++
      if (chamada === 1) return { itens: [1, 2], proximoCursor: 'c1' }
      throw new Error('ECONNRESET')
    }, { maxPaginas: 10 })

    assert.deepEqual(r.itens, [1, 2], 'nao pode perder o que ja leu')
    assert.equal(r.paginacaoCompleta, false)
    assert.equal(r.motivo, 'FALHA_AO_BUSCAR')
    assert.match(String(r.detalhe), /Nada será inativado/)
  })

  test('falha na PRIMEIRA pagina tambem nao lanca', async () => {
    const r = await percorrerPaginas<number>(async () => {
      throw new Error('token expirado')
    }, { maxPaginas: 10 })
    assert.deepEqual(r.itens, [])
    assert.equal(r.paginacaoCompleta, false)
    assert.equal(r.motivo, 'FALHA_AO_BUSCAR')
  })

  test('cursor repetido interrompe em vez de girar para sempre', async () => {
    const r = await percorrerPaginas<number>(async () => ({ itens: [1], proximoCursor: 'mesmo' }), { maxPaginas: 50 })
    assert.equal(r.paginacaoCompleta, false)
    assert.equal(r.motivo, 'CURSOR_REPETIDO')
    assert.ok(r.paginasLidas < 50)
  })

  test('limite de paginas marca incompleta em vez de fingir fim', async () => {
    let n = 0
    const r = await percorrerPaginas<number>(async () => ({ itens: [n], proximoCursor: `c${n++}` }), { maxPaginas: 3 })
    assert.equal(r.paginasLidas, 3)
    assert.equal(r.paginacaoCompleta, false)
    assert.equal(r.motivo, 'LIMITE_DE_PAGINAS')
  })

  test('paginacao incompleta + reconciliador = NENHUMA inativacao', async () => {
    const r = await percorrerPaginas<{ externalId: string }>(async () => {
      throw new Error('rede caiu')
    }, { maxPaginas: 10 })

    const plano = reconciliarCatalogo({
      existentes: [
        { id: 'p1', externalId: 'tt-1', nome: 'A', preco: 10, status: 'ativo', removidoDaOrigemEm: null },
        { id: 'p2', externalId: 'tt-2', nome: 'B', preco: 20, status: 'ativo', removidoDaOrigemEm: null },
      ],
      recebidos: r.itens,
      paginacaoCompleta: r.paginacaoCompleta,
      agora: new Date(),
    })

    assert.equal(plano.inativar.length, 0, 'falha de rede nunca pode inativar a vitrine inteira')
    assert.equal(plano.resumo.inativacaoAplicada, false)
  })
})

describe('Adaptador do catalogo TikTok Shop', () => {
  test('mapeia os campos principais em snake_case', () => {
    const item = adaptarItemDoTikTokShop({
      product_id: 'TT-123',
      product_name: 'Carregador portátil',
      price: 199.9,
      product_url: 'https://shop.tiktok.com/p/123',
      images: ['a.jpg', 'b.jpg'],
    })
    assert.equal(item?.externalId, 'TT-123')
    assert.equal(item?.nome, 'Carregador portátil')
    assert.equal(item?.preco, 199.9)
    assert.deepEqual(item?.imagens, ['a.jpg', 'b.jpg'])
  })

  test('aceita camelCase como alternativa', () => {
    const item = adaptarItemDoTikTokShop({ productId: 'TT-9', productName: 'X' })
    assert.equal(item?.externalId, 'TT-9')
    assert.equal(item?.nome, 'X')
  })

  test('campo AUSENTE fica ausente — nao vira null nem string vazia', () => {
    const item = adaptarItemDoTikTokShop({ product_id: 'TT-1' })
    assert.ok(!('preco' in item!), 'preco ausente nao pode entrar no item')
    assert.ok(!('nome' in item!))
    assert.ok(!('imagens' in item!))
  })

  test('null EXPLICITO e preservado como null', () => {
    const item = adaptarItemDoTikTokShop({ product_id: 'TT-1', price: null })
    assert.equal(item?.preco, null)
  })

  test('preco em texto e convertido; texto invalido NAO vira zero', () => {
    assert.equal(adaptarItemDoTikTokShop({ product_id: 'a', price: '199.90' })?.preco, 199.9)
    assert.equal(adaptarItemDoTikTokShop({ product_id: 'b', price: 'R$ 1.299,90' })?.preco, 1299.9)
    const invalido = adaptarItemDoTikTokShop({ product_id: 'c', price: 'sob consulta' })
    assert.ok(!('preco' in invalido!), 'preco ilegivel deve ficar ausente, nunca 0')
  })

  test('imagens como objetos com url sao extraidas', () => {
    const item = adaptarItemDoTikTokShop({ product_id: 'a', images: [{ url: 'x.jpg' }, { uri: 'y.jpg' }] })
    assert.deepEqual(item?.imagens, ['x.jpg', 'y.jpg'])
  })

  test('item SEM identificador e descartado — sem ele nao ha idempotencia', () => {
    assert.equal(adaptarItemDoTikTokShop({ product_name: 'Sem id' }), null)
    const r = adaptarCatalogoDoTikTokShop([{ product_name: 'Sem id' }])
    assert.equal(r.itens.length, 0)
    assert.equal(r.descartados.length, 1)
    assert.match(r.descartados[0].motivo, /idempotência/)
  })

  test('campos desconhecidos sao REPORTADOS, nao descartados em silencio', () => {
    const r = adaptarCatalogoDoTikTokShop([
      { product_id: 'a', campo_novo_da_api: 1, outro_campo: 'x' },
      { product_id: 'b', campo_novo_da_api: 2 },
    ])
    assert.deepEqual(r.camposNaoReconhecidos, ['campo_novo_da_api', 'outro_campo'])
    assert.equal(r.itens.length, 2)
  })

  test('comissao e disponibilidade sao lidas (ainda sem coluna no Produto)', () => {
    const item = adaptarItemDoTikTokShop({ product_id: 'a', commission_rate: 12.5, is_available: true })
    assert.equal(item?.comissaoPercentual, 12.5)
    assert.equal(item?.disponivel, true)
  })

  test('resposta vazia nao quebra', () => {
    const r = adaptarCatalogoDoTikTokShop([])
    assert.deepEqual(r.itens, [])
    assert.deepEqual(r.camposNaoReconhecidos, [])
  })
})

describe('Adaptador + reconciliador, de ponta a ponta (sem rede)', () => {
  const brutos: ItemBruto[] = [
    { product_id: 'TT-1', product_name: 'Carregador', price: 199 },
    { product_id: 'TT-2', product_name: 'Fone', price: 89.9 },
  ]

  test('primeira sincronizacao cria tudo', () => {
    const { itens } = adaptarCatalogoDoTikTokShop(brutos)
    const plano = reconciliarCatalogo({ existentes: [], recebidos: itens, paginacaoCompleta: true, agora: new Date() })
    assert.equal(plano.criar.length, 2)
    assert.equal(plano.inativar.length, 0)
  })

  test('segunda sincronizacao identica nao muda nada (idempotente)', () => {
    const { itens } = adaptarCatalogoDoTikTokShop(brutos)
    const plano = reconciliarCatalogo({
      existentes: [
        { id: 'p1', externalId: 'TT-1', nome: 'Carregador', preco: 199, status: 'ativo', removidoDaOrigemEm: null },
        { id: 'p2', externalId: 'TT-2', nome: 'Fone', preco: 89.9, status: 'ativo', removidoDaOrigemEm: null },
      ],
      recebidos: itens,
      paginacaoCompleta: true,
      agora: new Date(),
    })
    assert.equal(plano.criar.length, 0)
    assert.equal(plano.atualizar.length, 0)
    assert.equal(plano.inalterados.length, 2)
  })

  test('produto que saiu da vitrine e inativado, o que ficou permanece', () => {
    const { itens } = adaptarCatalogoDoTikTokShop([brutos[0]])
    const plano = reconciliarCatalogo({
      existentes: [
        { id: 'p1', externalId: 'TT-1', nome: 'Carregador', preco: 199, status: 'ativo', removidoDaOrigemEm: null },
        { id: 'p2', externalId: 'TT-2', nome: 'Fone', preco: 89.9, status: 'ativo', removidoDaOrigemEm: null },
      ],
      recebidos: itens,
      paginacaoCompleta: true,
      agora: new Date(),
    })
    assert.equal(plano.inativar.length, 1)
    assert.equal(plano.inativar[0].externalId, 'TT-2')
    assert.equal(plano.inalterados.length, 1)
  })
})
