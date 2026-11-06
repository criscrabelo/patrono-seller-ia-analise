/**
 * Rodada 11 — sincronização automática de catálogo (Vitrine/Showcase).
 *
 * Tudo aqui roda sem rede, sem banco e sem credencial do TikTok: o
 * reconciliador e o signer são puros de propósito, então a regra mais
 * delicada do fluxo (o que criar, o que atualizar, o que INATIVAR) pode ser
 * verificada muito antes de existir aprovação da Affiliate API.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  reconciliarCatalogo,
  extrairFeaturesDeCatalogo,
  type ItemDeCatalogoExterno,
  type ProdutoSincronizado,
} from '../lib/catalogo-sync'
import { montarStringCanonica, assinarRequisicaoTikTokShop, comAssinatura } from '../lib/tiktok-shop-signer'
import { resolverDireitosDoProduto, produtoPodeAparecerNoVideo } from '../lib/media-rights-produto'
import { mediaRightsGate } from '../lib/media-rights'

const AGORA = new Date('2026-09-20T12:00:00.000Z')

function existente(over: Partial<ProdutoSincronizado> = {}): ProdutoSincronizado {
  return {
    id: 'p1',
    externalId: 'tt-1',
    nome: 'Carregador',
    preco: 199,
    status: 'ativo',
    removidoDaOrigemEm: null,
    ...over,
  }
}

describe('Reconciliação de catálogo — idempotência', () => {
  test('produto novo é criado', () => {
    const plano = reconciliarCatalogo({
      existentes: [],
      recebidos: [{ externalId: 'tt-1', nome: 'Carregador', preco: 199 }],
      paginacaoCompleta: true,
      agora: AGORA,
    })
    assert.equal(plano.criar.length, 1)
    assert.equal(plano.criar[0].externalId, 'tt-1')
  })

  test('rodar duas vezes com a mesma resposta NÃO duplica nem reescreve', () => {
    const recebidos: ItemDeCatalogoExterno[] = [{ externalId: 'tt-1', nome: 'Carregador', preco: 199 }]
    const plano = reconciliarCatalogo({ existentes: [existente()], recebidos, paginacaoCompleta: true, agora: AGORA })
    assert.equal(plano.criar.length, 0)
    assert.equal(plano.atualizar.length, 0)
    assert.deepEqual(plano.inalterados, ['tt-1'])
  })

  test('identidade é o externalId, nunca o nome — produto renomeado é o MESMO', () => {
    const plano = reconciliarCatalogo({
      existentes: [existente({ nome: 'Nome antigo' })],
      recebidos: [{ externalId: 'tt-1', nome: 'Nome novo na vitrine' }],
      paginacaoCompleta: true,
      agora: AGORA,
    })
    assert.equal(plano.criar.length, 0, 'não pode criar um segundo produto')
    assert.equal(plano.atualizar.length, 1)
    assert.equal(plano.atualizar[0].campos.nome, 'Nome novo na vitrine')
  })

  test('item sem externalId é descartado — sem identidade não há idempotência', () => {
    const plano = reconciliarCatalogo({
      existentes: [],
      recebidos: [{ externalId: '', nome: 'Sem id' }],
      paginacaoCompleta: true,
      agora: AGORA,
    })
    assert.equal(plano.criar.length, 0)
  })
})

describe('Reconciliação — nunca inventa dado', () => {
  test('campo ausente na resposta não sobrescreve o que já existe', () => {
    const plano = reconciliarCatalogo({
      existentes: [existente({ preco: 199 })],
      recebidos: [{ externalId: 'tt-1', nome: 'Carregador' }], // API não falou de preço
      paginacaoCompleta: true,
      agora: AGORA,
    })
    assert.equal(plano.atualizar.length, 0, 'nada mudou de fato')
    for (const a of plano.atualizar) {
      assert.ok(!('preco' in a.campos), 'preço não pode entrar no plano se a API não o enviou')
    }
  })

  test('preço null explícito É aplicado — a API disse que não há preço', () => {
    const plano = reconciliarCatalogo({
      existentes: [existente({ preco: 199 })],
      recebidos: [{ externalId: 'tt-1', preco: null }],
      paginacaoCompleta: true,
      agora: AGORA,
    })
    assert.equal(plano.atualizar.length, 1)
    assert.equal(plano.atualizar[0].campos.preco, null)
  })

  test('mudança real de preço vira atualização', () => {
    const plano = reconciliarCatalogo({
      existentes: [existente({ preco: 199 })],
      recebidos: [{ externalId: 'tt-1', preco: 149.9 }],
      paginacaoCompleta: true,
      agora: AGORA,
    })
    assert.equal(plano.atualizar[0].campos.preco, 149.9)
    assert.equal(plano.atualizar[0].campos.sincronizadoEm, AGORA)
  })
})

describe('Reconciliação — remoção e histórico', () => {
  test('produto que sumiu da vitrine é INATIVADO, nunca apagado', () => {
    const plano = reconciliarCatalogo({
      existentes: [existente({ id: 'p1', externalId: 'tt-1' }), existente({ id: 'p2', externalId: 'tt-2' })],
      recebidos: [{ externalId: 'tt-1' }],
      paginacaoCompleta: true,
      agora: AGORA,
    })
    assert.equal(plano.inativar.length, 1)
    assert.equal(plano.inativar[0].externalId, 'tt-2')
    assert.ok(!('apagar' in plano), 'o plano não tem sequer a noção de apagar')
  })

  test('TRAVA: paginação incompleta nunca inativa nada', () => {
    const plano = reconciliarCatalogo({
      existentes: [existente({ id: 'p1', externalId: 'tt-1' }), existente({ id: 'p2', externalId: 'tt-2' })],
      recebidos: [{ externalId: 'tt-1' }], // 2ª página nunca chegou
      paginacaoCompleta: false,
      agora: AGORA,
    })
    assert.equal(plano.inativar.length, 0, 'falha de rede não pode virar "produto removido"')
    assert.equal(plano.resumo.inativacaoAplicada, false)
    assert.match(String(plano.resumo.motivoInativacaoNaoAplicada), /Paginação incompleta/)
  })

  test('produto inativo que volta à vitrine é reativado', () => {
    const plano = reconciliarCatalogo({
      existentes: [existente({ status: 'inativo', removidoDaOrigemEm: new Date('2026-09-01T00:00:00Z') })],
      recebidos: [{ externalId: 'tt-1', preco: 179 }],
      paginacaoCompleta: true,
      agora: AGORA,
    })
    assert.equal(plano.reativar.length, 1)
    assert.equal(plano.reativar[0].campos.status, 'ativo')
    assert.equal(plano.reativar[0].campos.removidoDaOrigemEm, null)
    assert.equal(plano.reativar[0].campos.preco, 179)
  })

  test('produto já inativo e ausente não é inativado de novo', () => {
    const plano = reconciliarCatalogo({
      existentes: [existente({ status: 'inativo' })],
      recebidos: [],
      paginacaoCompleta: true,
      agora: AGORA,
    })
    assert.equal(plano.inativar.length, 0)
  })
})

describe('Features para o ML já existente', () => {
  test('extrai sinais sem inventar: ausência vira null, não zero', () => {
    const itens: ItemDeCatalogoExterno[] = [{ externalId: 'tt-1', nome: 'X' }]
    const plano = reconciliarCatalogo({ existentes: [], recebidos: itens, paginacaoCompleta: true, agora: AGORA })
    const [f] = extrairFeaturesDeCatalogo(itens, 'tiktok-shop', plano)
    assert.equal(f.preco, null)
    assert.equal(f.comissaoPercentual, null)
    assert.equal(f.disponivel, null)
    assert.equal(f.temImagem, false)
    assert.equal(f.novoNestaRodada, true)
  })

  test('marca o que a sincronização observou de verdade', () => {
    const itens: ItemDeCatalogoExterno[] = [
      { externalId: 'tt-1', preco: 199, comissaoPercentual: 12, disponivel: true, imagens: ['a.jpg', 'b.jpg'] },
    ]
    const plano = reconciliarCatalogo({ existentes: [existente()], recebidos: itens, paginacaoCompleta: true, agora: AGORA })
    const [f] = extrairFeaturesDeCatalogo(itens, 'tiktok-shop', plano)
    assert.equal(f.comissaoPercentual, 12)
    assert.equal(f.quantidadeImagens, 2)
    assert.equal(f.providerId, 'tiktok-shop')
    assert.equal(f.novoNestaRodada, false)
  })

  test('não decide proveniência — isso continua com quem chama o feature store', () => {
    const itens: ItemDeCatalogoExterno[] = [{ externalId: 'tt-1' }]
    const plano = reconciliarCatalogo({ existentes: [], recebidos: itens, paginacaoCompleta: true, agora: AGORA })
    const [f] = extrairFeaturesDeCatalogo(itens, 'tiktok-shop', plano)
    assert.ok(!('dataOrigin' in f), 'gate de proveniência não pode ser decidido por função pura')
  })
})

describe('Direitos de mídia — TIKTOK_SHOWCASE nunca autoriza transformar', () => {
  const produtoDaVitrine = {
    id: 'p1',
    nome: 'Carregador',
    origemConteudo: 'Próprio', // herdado do formulário — não pode mandar aqui
    origemDados: 'TIKTOK_SHOWCASE',
    imagens: ['https://cdn.tiktok/produto.jpg'],
  }

  test('policy é UNKNOWN mesmo com origemConteudo "Próprio"', () => {
    const record = resolverDireitosDoProduto(produtoDaVitrine)
    assert.equal(record.policy, 'UNKNOWN')
    assert.match(record.authorizingSource, /não verificados/)
  })

  test('exibir é permitido; transformar e derivar são bloqueados', () => {
    const record = resolverDireitosDoProduto(produtoDaVitrine)
    assert.equal(mediaRightsGate(record, 'exibir').allowed, true)
    assert.equal(mediaRightsGate(record, 'transformar').allowed, false)
    assert.equal(mediaRightsGate(record, 'derivar').allowed, false)
    assert.equal(mediaRightsGate(record, 'reusar-social').allowed, false)
  })

  test('produto da vitrine não aparece no vídeo sem verificação dos termos', () => {
    const decisao = produtoPodeAparecerNoVideo(produtoDaVitrine)
    assert.equal(decisao.visivel, false)
    assert.match(decisao.motivo, /não autorizada/)
  })

  test('produto MANUAL com origem Próprio segue autorizado — sem regressão', () => {
    const decisao = produtoPodeAparecerNoVideo({
      id: 'p2',
      nome: 'Foto minha',
      origemConteudo: 'Próprio',
      origemDados: 'MANUAL',
      imagens: ['minha-foto.jpg'],
    })
    assert.equal(decisao.visivel, true)
  })

  test('produto antigo, sem origemDados, continua se comportando como MANUAL', () => {
    const decisao = produtoPodeAparecerNoVideo({
      id: 'p3',
      nome: 'Produto anterior à Rodada 11',
      origemConteudo: 'Próprio',
      imagens: ['foto.jpg'],
    })
    assert.equal(decisao.visivel, true)
  })
})

describe('Assinatura da TikTok Shop Open API', () => {
  const SECRET = 'segredo-de-teste'

  test('ordena as chaves alfabeticamente e prefixa o path', () => {
    const canonica = montarStringCanonica({
      path: '/affiliate_creator/202405/showcase/products',
      query: { timestamp: 1700000000, app_key: 'abc', page_size: 20 },
      metodo: 'GET',
    })
    assert.equal(canonica, '/affiliate_creator/202405/showcase/productsapp_keyabcpage_size20timestamp1700000000')
  })

  test('exclui sign e access_token do cálculo', () => {
    const comExtras = montarStringCanonica({
      path: '/p',
      query: { a: '1', sign: 'xxx', access_token: 'segredo' },
      metodo: 'GET',
    })
    assert.equal(comExtras, '/pa1')
  })

  test('parâmetro ausente não vira a string "undefined"', () => {
    const canonica = montarStringCanonica({ path: '/p', query: { a: '1', b: undefined, c: null }, metodo: 'GET' })
    assert.equal(canonica, '/pa1')
  })

  test('GET não assina corpo; POST assina o corpo BRUTO', () => {
    const get = montarStringCanonica({ path: '/p', query: { a: '1' }, metodo: 'GET', corpoBruto: '{"x":1}' })
    assert.equal(get, '/pa1')
    const post = montarStringCanonica({ path: '/p', query: { a: '1' }, metodo: 'POST', corpoBruto: '{"x":1}' })
    assert.equal(post, '/pa1{"x":1}')
  })

  test('multipart não assina o corpo', () => {
    const s = montarStringCanonica({ path: '/p', query: { a: '1' }, metodo: 'POST', corpoBruto: 'binario', multipart: true })
    assert.equal(s, '/pa1')
  })

  test('assinatura é hex minúsculo, estável e sensível a qualquer mudança', () => {
    const base = { path: '/p', query: { a: '1' }, metodo: 'GET' as const }
    const sign = assinarRequisicaoTikTokShop(base, SECRET)
    assert.match(sign, /^[0-9a-f]{64}$/)
    assert.equal(sign, assinarRequisicaoTikTokShop(base, SECRET), 'mesma entrada, mesma assinatura')
    assert.notEqual(sign, assinarRequisicaoTikTokShop({ ...base, query: { a: '2' } }, SECRET))
    assert.notEqual(sign, assinarRequisicaoTikTokShop(base, 'outro-segredo'))
  })

  test('sem app_secret falha alto, nunca assina vazio', () => {
    assert.throws(() => assinarRequisicaoTikTokShop({ path: '/p', query: {}, metodo: 'GET' }, ''), /app_secret ausente/)
  })

  test('comAssinatura devolve a query pronta, sem access_token', () => {
    const q = comAssinatura(
      { path: '/p', query: { app_key: 'abc', access_token: 'segredo', timestamp: 1 }, metodo: 'GET' },
      SECRET
    )
    assert.equal(q.app_key, 'abc')
    assert.equal(q.timestamp, '1')
    assert.ok(q.sign)
    assert.ok(!('access_token' in q), 'access_token viaja no header, nunca na query assinada')
  })

  test('o segredo nunca aparece na saída', () => {
    const q = comAssinatura({ path: '/p', query: { a: '1' }, metodo: 'GET' }, SECRET)
    assert.ok(!JSON.stringify(q).includes(SECRET))
  })
})
