/**
 * P1.9.1 — Pipeline de primeira publicação segura no Instagram.
 *
 * Regressão dos defeitos que a P1.9 encontrou ao tentar publicar:
 *
 *   1. preflight `pronto: true` para TEXTO_COM_LINK, que o adapter recusaria;
 *   2. "consultado em [data de geração]" — data de preço inventada;
 *   3. imagem de marketplace aceita por causa da origem declarada;
 *   4. `#tiktokmademebuyit`, "Homologado" e nenhuma CTA na legenda do Instagram;
 *   5. URL colada numa legenda onde ela não é clicável.
 *
 * NENHUMA publicação real. `fetch` é trocado por um espião que falha alto.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../lib/prisma'
import {
  CAPACIDADE_REAL_DO_ADAPTER,
  avaliarPecaParaOAdapter,
  estrategiaDeLinkDoCanal,
  urlVaiNaLegenda,
} from '../lib/capacidade-real-do-adapter'
import {
  avaliarPreco,
  pendenciaDePrecoNaLegenda,
  dataDaVerificacaoDoPreco,
  validadeDoPreco,
} from '../lib/preco-verificado'
import {
  claimsNaoComprovados,
  nomeSemClaims,
  hashtagsParaOCanal,
  ctaDoCanal,
  pendenciasDeCopy,
  montarLegendaDoCanal,
} from '../lib/copy-por-canal'
import {
  avaliarMidiaParaPublicacao,
  emCustodiaPropria,
  hostDeTerceiro,
  type EvidenciaDeMidia,
} from '../lib/evidencia-de-midia'
import { resolverDireitosDoProduto } from '../lib/media-rights-produto'
import { gerarConteudoGratuito } from '../lib/conteudo-gratuito'
import { decidirDistribuicao, type ContextoDaDistribuicao } from '../lib/distribuicao-decisao'
import {
  distribuirConteudo,
  ADAPTADORES_LIGADOS,
  type AdaptadorDeCanal,
  type PedidoDeDistribuicao,
} from '../lib/distribuicao-orquestrador'
import { ADAPTADORES_DISPONIVEIS, adaptadorInstagram, adaptadoresHabilitados } from '../lib/adaptadores-reais'
import { FORMATOS } from '../lib/plano-de-acao'
import { capacidadeDoCanal } from '../lib/channel-registry'
import { preflightDePublicacao, simularDistribuicao } from '../lib/preflight-de-publicacao'
import { montarPecaComMidiaPropria, prepararPecaComMidiaPropria, FORMATO_VIDEO_PROPRIO } from '../lib/peca-com-midia-propria'
import { CAMPO_DOS_SCOPES, CAMPO_DA_COMPROVACAO } from '../lib/autorizacao-da-conta'
import { textoDisclosure } from '../lib/creative-factory'
import {
  SUPABASE_DE_TESTE,
  VIDEO_PROPRIO_URL,
  ENV_DE_CUSTODIA,
  REEL_VALIDO,
  DECLARACOES_COMPLETAS,
  confirmarLinkNaBioParaTeste,
} from './_fixtura-midia-propria'

const TEM_BANCO = !!process.env.DATABASE_URL
const marca = `r48-${Date.now()}`
const AGORA = new Date('2026-10-01T15:00:00Z')
const SHOPEE = 'https://down-br.img.susercontent.com/file/br-11134207-abc'

const ENV = { PUBLIC_BASE_URL: 'https://patrono.exemplo.com.br', ...ENV_DE_CUSTODIA }

/** A legenda real de uma das cinco peças da P1.8, letra por letra. */
const LEGENDA_P18 =
  'Robô Aspirador H40 110V/220V Original Lacrado — R$ 299,90 (consultado em 24/09/2026).\n\n' +
  `${textoDisclosure('afiliado')}\n\n#tiktokmademebuyit #eletrodomésticos`

const evidencia = (over: Partial<EvidenciaDeMidia> = {}): EvidenciaDeMidia => ({
  tipo: 'direito_da_midia',
  severidade: 'verde',
  origem: 'PROPRIO',
  assetUrl: VIDEO_PROPRIO_URL,
  formato: 'VIDEO_PROPRIO',
  declaradoPor: 'u1',
  declaradoEm: AGORA.toISOString(),
  descricao: 'vídeo que gravei do produto',
  mensagem: 'x',
  ...over,
})

// ── Espião de rede: qualquer fetch durante esta suíte é um erro ─────────

const fetchOriginal = globalThis.fetch
let chamadasDeRede = 0
before(() => {
  globalThis.fetch = (async () => {
    chamadasDeRede += 1
    throw new Error('rede proibida nesta suíte')
  }) as typeof fetch
})
after(() => {
  globalThis.fetch = fetchOriginal
})

// ── 1. Preflight × adapter real ─────────────────────────────────────────

describe('O preflight e o adapter real leem a mesma lista', () => {
  test('TEXTO_COM_LINK no Instagram: recusado pelo adapter, com os dois motivos', () => {
    const r = avaliarPecaParaOAdapter({ canal: 'instagram', formato: 'TEXTO_COM_LINK', assetUrl: null })
    assert.equal(r.aceita, false)
    assert.deepEqual(r.bloqueios, ['FORMATO_INCOMPATIVEL_COM_ADAPTER', 'MIDIA_OBRIGATORIA_AUSENTE'])
  })

  test('vídeo sem arquivo: bloqueio explícito de mídia obrigatória', () => {
    const r = avaliarPecaParaOAdapter({ canal: 'instagram', formato: 'VIDEO_PROPRIO', assetUrl: '  ' })
    assert.deepEqual(r.bloqueios, ['MIDIA_OBRIGATORIA_AUSENTE'])
  })

  test('VIDEO_PROPRIO com arquivo: aceito', () => {
    const r = avaliarPecaParaOAdapter({ canal: 'instagram', formato: 'VIDEO_PROPRIO', assetUrl: VIDEO_PROPRIO_URL })
    assert.equal(r.aceita, true)
  })

  test('a decisão não deixa TEXTO_COM_LINK virar AUTO_PUBLICAVEL, mesmo com tudo o resto certo', () => {
    const ctx: ContextoDaDistribuicao = {
      canal: 'instagram',
      canalConectado: true,
      scopesConcedidos: ['instagram_content_publish'],
      appAprovadoPeloProvider: true,
      midiaAutorizada: true,
      formatoCompativel: true,
      pecaParaOAdapter: avaliarPecaParaOAdapter({ canal: 'instagram', formato: 'TEXTO_COM_LINK', assetUrl: null }),
      disclosurePresente: true,
      pendenciasDeCompliance: [],
      custoZero: true,
    }
    const v = decidirDistribuicao(ctx)
    assert.equal(v.podeExecutarSozinho, false)
    assert.equal(v.estado, 'PUBLICACAO_MANUAL_ASSISTIDA')
    assert.ok(v.bloqueios.includes('FORMATO_INCOMPATIVEL_COM_ADAPTER'))
    assert.ok(v.bloqueios.includes('MIDIA_OBRIGATORIA_AUSENTE'))
  })

  test('só falta a mídia: o estado diz AGUARDANDO_MIDIA_AUTORIZADA', () => {
    const v = decidirDistribuicao({
      canal: 'instagram', canalConectado: true, scopesConcedidos: ['instagram_content_publish'],
      appAprovadoPeloProvider: true, midiaAutorizada: true, formatoCompativel: true,
      pecaParaOAdapter: avaliarPecaParaOAdapter({ canal: 'instagram', formato: 'VIDEO_PROPRIO', assetUrl: null }),
      disclosurePresente: true, pendenciasDeCompliance: [], custoZero: true,
    })
    assert.equal(v.estado, 'AGUARDANDO_MIDIA_AUTORIZADA')
    assert.deepEqual(v.bloqueios, ['MIDIA_OBRIGATORIA_AUSENTE'])
  })

  test('INVARIANTE: todo adapter disponível tem capacidade real declarada, e vice-versa', () => {
    assert.deepEqual(Object.keys(CAPACIDADE_REAL_DO_ADAPTER).sort(), Object.keys(ADAPTADORES_DISPONIVEIS).sort())
  })

  test('INVARIANTE: o que o adapter declara publicar, a plataforma aceita e o catálogo conhece', () => {
    for (const [canal, cap] of Object.entries(CAPACIDADE_REAL_DO_ADAPTER)) {
      const plataforma = capacidadeDoCanal(canal)!
      assert.ok(plataforma, `${canal} sem registro de plataforma`)
      for (const formato of cap.formatosPublicaveis) {
        const def = FORMATOS.find((f) => f.formato === formato)
        assert.ok(def, `${formato} não está em FORMATOS`)
        assert.ok(def!.exigeDoCanal.some((c) => plataforma[c]), `${canal} não aceita ${formato}`)
      }
      assert.equal(cap.estrategiaDeLink, estrategiaDeLinkDoCanal(canal), 'uma estratégia de link só')
    }
  })

  test('o adapter real não abre rede para formato recusado', async () => {
    const antes = chamadasDeRede
    const r = await adaptadorInstagram.publicar!({
      canal: 'instagram', workspaceId: 'qualquer', publicacaoId: 'x',
      legenda: 'x', urlParaDivulgar: 'https://patrono.exemplo.com.br/api/l/a',
      assetUrl: VIDEO_PROPRIO_URL, formato: 'TEXTO_COM_LINK',
    })
    assert.equal(r.ok, false)
    assert.equal(r.fatal, true)
    assert.match(r.erro!, /não publica "TEXTO_COM_LINK"/)
    assert.equal(chamadasDeRede, antes, 'nenhuma chamada saiu')
  })

  test('o adapter real recusa pedido SEM formato — fail-closed', async () => {
    const r = await adaptadorInstagram.publicar!({
      canal: 'instagram', workspaceId: 'qualquer', publicacaoId: 'x',
      legenda: 'x', urlParaDivulgar: '', assetUrl: VIDEO_PROPRIO_URL,
    })
    assert.equal(r.ok, false)
    assert.equal(r.fatal, true)
  })
})

// ── 2. Data e preço ─────────────────────────────────────────────────────

describe('Preço: só com verificação real, nunca com data inventada', () => {
  test('sem data de verificação: não afirma preço nem data', () => {
    const r = avaliarPreco({ preco: 299.9, verificadoEm: null, agora: AGORA })
    assert.equal(r.status, 'PRECO_NAO_VERIFICADO')
    assert.equal(r.textoParaCopy, 'confira o preço atual')
    assert.equal(r.dataDaVerificacao, null)
    assert.match(r.alerta!, /^PRECO_NAO_VERIFICADO/)
  })

  test('geração sem data: a legenda NÃO ganha a data de hoje', () => {
    const { conteudo } = gerarConteudoGratuito({ nome: 'Colchão X', categoria: 'casa', preco: 189.9, agora: AGORA })
    for (const legenda of [conteudo.legendaInstagram, conteudo.legendaTiktok]) {
      assert.ok(!/consultado em/.test(legenda), legenda)
      assert.ok(!legenda.includes('01/10/2026'), 'a data de geração não vira data de consulta')
      assert.ok(!legenda.includes('R$'), 'sem verificação, sem preço')
    }
    assert.ok(conteudo.alertasCompliance.some((a) => /^PRECO_NAO_VERIFICADO/.test(a.mensagem)))
  })

  test('preço antigo: some da legenda e vira alerta PRECO_DESATUALIZADO', () => {
    const maio = new Date('2026-05-09T22:03:40Z')
    const r = avaliarPreco({ preco: 299.9, verificadoEm: maio, agora: AGORA })
    assert.equal(r.status, 'PRECO_DESATUALIZADO')
    assert.equal(r.textoParaCopy, 'confira o preço atual')
    assert.match(r.alerta!, /09\/05\/2026/)

    const { conteudo } = gerarConteudoGratuito({
      nome: 'Robô', categoria: 'casa', preco: 299.9, precoVerificadoEm: maio, agora: AGORA,
    })
    assert.ok(!conteudo.legendaInstagram.includes('R$'))
    assert.ok(conteudo.alertasCompliance.some((a) => /^PRECO_DESATUALIZADO/.test(a.mensagem)))
  })

  test('preço verificado dentro do prazo: aparece com a data REAL', () => {
    const ontem = new Date(AGORA.getTime() - 6 * 3_600_000)
    const r = avaliarPreco({ preco: 299.9, verificadoEm: ontem, agora: AGORA })
    assert.equal(r.status, 'VERIFICADO')
    assert.equal(r.textoParaCopy, 'R$ 299,90 (consultado em 01/10/2026)')
  })

  test('data no futuro não vira preço válido', () => {
    const r = avaliarPreco({ preco: 10, verificadoEm: new Date(AGORA.getTime() + 3_600_000 * 48), agora: AGORA })
    assert.equal(r.status, 'PRECO_DESATUALIZADO')
  })

  test('a fonte da data é a sincronização, nunca updatedAt', () => {
    assert.equal(dataDaVerificacaoDoPreco({ sincronizadoEm: null }), null)
    assert.equal(dataDaVerificacaoDoPreco({}), null)
    const d = new Date('2026-09-30T10:00:00Z')
    assert.equal(dataDaVerificacaoDoPreco({ sincronizadoEm: d }), d)
    assert.ok(validadeDoPreco({}).horas > 0)
  })

  test('a legenda da P1.8 é recusada: afirma preço sem verificação real', () => {
    assert.match(pendenciaDePrecoNaLegenda({ legenda: LEGENDA_P18, verificadoEm: null, agora: AGORA })!, /^PRECO_NAO_VERIFICADO/)
  })

  test('data da legenda diferente da verificação real: recusada', () => {
    const real = new Date('2026-10-01T09:00:00Z')
    const p = pendenciaDePrecoNaLegenda({ legenda: LEGENDA_P18, verificadoEm: real, agora: AGORA })
    assert.match(p!, /consultado em 24\/09\/2026.*01\/10\/2026/)
  })

  test('legenda sem preço não tem pendência de preço', () => {
    assert.equal(pendenciaDePrecoNaLegenda({ legenda: 'X — confira o preço atual.', verificadoEm: null, agora: AGORA }), null)
  })
})

// ── 3. Mídia e direitos ─────────────────────────────────────────────────

describe('Mídia: só com evidência, fail-closed', () => {
  test('imagem do CDN da Shopee: terceiro, seja qual for a declaração', () => {
    assert.equal(hostDeTerceiro(SHOPEE), 'Shopee')
    const r = avaliarMidiaParaPublicacao({ assetUrl: SHOPEE, evidencia: evidencia({ assetUrl: SHOPEE }), env: ENV })
    assert.equal(r.autorizada, false)
    assert.match(r.motivo, /Shopee/)
  })

  test('sem registro de direito: bloqueia, e diz que a origem do produto não prova autoria', () => {
    const r = avaliarMidiaParaPublicacao({ assetUrl: VIDEO_PROPRIO_URL, evidencia: null, env: ENV })
    assert.equal(r.autorizada, false)
    assert.match(r.motivo, /comprei_e_testei/)
  })

  test('registro de OUTRO arquivo: bloqueia', () => {
    const r = avaliarMidiaParaPublicacao({
      assetUrl: VIDEO_PROPRIO_URL,
      evidencia: evidencia({ assetUrl: `${SUPABASE_DE_TESTE}/storage/v1/object/public/midia/outro.mp4` }),
      env: ENV,
    })
    assert.equal(r.autorizada, false)
  })

  test('origem fora do vocabulário (comprei_e_testei): bloqueia', () => {
    const r = avaliarMidiaParaPublicacao({
      assetUrl: VIDEO_PROPRIO_URL,
      evidencia: evidencia({ origem: 'comprei_e_testei' as never }),
      env: ENV,
    })
    assert.equal(r.autorizada, false)
  })

  test('LICENCIADO sem termo e GERADO_PELO_PATRONO sem id: bloqueiam', () => {
    for (const origem of ['LICENCIADO', 'GERADO_PELO_PATRONO'] as const) {
      const r = avaliarMidiaParaPublicacao({ assetUrl: VIDEO_PROPRIO_URL, evidencia: evidencia({ origem }), env: ENV })
      assert.equal(r.autorizada, false, origem)
    }
    const comTermo = avaliarMidiaParaPublicacao({
      assetUrl: VIDEO_PROPRIO_URL, evidencia: evidencia({ origem: 'LICENCIADO', termoDeLicenca: 'contrato-123' }), env: ENV,
    })
    assert.equal(comTermo.autorizada, true)
  })

  test('fora do storage do projeto: custódia não comprovada', () => {
    const fora = 'https://cdn.qualquer.com/v.mp4'
    assert.equal(emCustodiaPropria(fora, ENV), false)
    assert.equal(emCustodiaPropria(VIDEO_PROPRIO_URL, {}), false, 'sem o host do projeto, nada é próprio')
    const r = avaliarMidiaParaPublicacao({ assetUrl: fora, evidencia: evidencia({ assetUrl: fora }), env: ENV })
    assert.equal(r.autorizada, false)
  })

  test('mídia PRÓPRIA, em custódia, com registro: permite seguir', () => {
    const r = avaliarMidiaParaPublicacao({ assetUrl: VIDEO_PROPRIO_URL, evidencia: evidencia(), env: ENV })
    assert.equal(r.autorizada, true, r.motivo)
    assert.equal(r.origem, 'PROPRIO')
  })

  test('Kit Torcedor: "Gerado por IA" com imagem da Shopee perde o direito de derivar', () => {
    const r = resolverDireitosDoProduto({
      id: 'kit', nome: 'Kit Torcedor Copa do Mundo 2026', origemConteudo: 'Gerado por IA', imagens: [SHOPEE],
    })
    assert.equal(r.policy, 'UNKNOWN')
    assert.equal(r.canDerive, false)
    assert.match(r.authorizingSource, /contradiz/)
  })

  test('"Próprio" com imagem no storage do projeto continua podendo derivar', () => {
    const r = resolverDireitosDoProduto({
      id: 'p', nome: 'x', origemConteudo: 'Próprio', imagens: [VIDEO_PROPRIO_URL],
    })
    assert.equal(r.canDerive, true)
  })
})

// ── 4. Copy ─────────────────────────────────────────────────────────────

describe('Copy do Instagram: CTA, hashtag do canal, sem claim', () => {
  test('CTA aponta para a bio, que é onde o link fica', () => {
    assert.equal(ctaDoCanal('instagram'), 'Link na bio.')
    const { conteudo } = gerarConteudoGratuito({ nome: 'Colchão', categoria: 'casa', agora: AGORA })
    assert.match(conteudo.legendaInstagram, /Link na bio\./)
    assert.equal(conteudo.chamadaAcao, 'Link na bio.')
  })

  test('hashtag do TikTok não entra no Instagram', () => {
    assert.deepEqual(hashtagsParaOCanal(['#tiktokmademebuyit', '#casa', '#fyp'], 'instagram'), ['#casa'])
    const { conteudo } = gerarConteudoGratuito({ nome: 'Colchão', categoria: 'casa', agora: AGORA })
    assert.ok(!conteudo.legendaInstagram.includes('#tiktok'), conteudo.legendaInstagram)
    assert.ok(!conteudo.hashtags.some((h) => /tiktok/i.test(h)))
    // No TikTok, a hashtag do TikTok continua.
    assert.ok(conteudo.legendaTiktok.includes('#tiktokmademebuyit'))
  })

  test('claim não comprovado sai do título e fica registrado', () => {
    assert.deepEqual(nomeSemClaims('Colete Salva Vidas Infantil Prolife Homologado'), {
      nome: 'Colete Salva Vidas Infantil Prolife', removidos: ['homologado'],
    })
    assert.equal(nomeSemClaims('Robô Aspirador H40 110V/220V Original Lacrado').nome, 'Robô Aspirador H40 110V/220V')
    const { conteudo } = gerarConteudoGratuito({ nome: 'Colete Infantil Homologado', categoria: 'esporte', agora: AGORA })
    for (const l of [conteudo.legendaInstagram, conteudo.legendaTiktok, conteudo.roteiro]) {
      assert.ok(!/homologad/i.test(l), l)
    }
    assert.ok(conteudo.alertasCompliance.some((a) => /^CLAIM_NAO_COMPROVADO/.test(a.mensagem)))
  })

  test('nome feito só de claim: não há o que publicar', () => {
    assert.throws(() => nomeSemClaims('Original Lacrado'))
  })

  test('disclosure de afiliado continua na legenda', () => {
    const { conteudo } = gerarConteudoGratuito({ nome: 'Colchão', categoria: 'casa', agora: AGORA })
    assert.ok(conteudo.legendaInstagram.includes(textoDisclosure('afiliado')))
  })

  test('a legenda real da P1.8 tem quatro pendências de copy', () => {
    const p = pendenciasDeCopy({ canal: 'instagram', legenda: LEGENDA_P18 })
    assert.ok(p.some((x) => x.startsWith('HASHTAG_DE_OUTRO_CANAL')), p.join('|'))
    assert.ok(p.some((x) => x.startsWith('CLAIM_NAO_COMPROVADO')))
    assert.ok(p.some((x) => x.startsWith('CTA_AUSENTE')))
    assert.deepEqual(claimsNaoComprovados(LEGENDA_P18).sort(), ['lacrado', 'original'])
  })

  test('a legenda montada pelo pipeline não tem pendência nenhuma', () => {
    const legenda = montarLegendaDoCanal({
      canal: 'instagram', nome: 'Colchão Inflável', precoTexto: 'confira o preço atual',
      disclosure: textoDisclosure('afiliado'), hashtags: ['#tiktokmademebuyit', '#casa'],
    })
    assert.deepEqual(pendenciasDeCopy({ canal: 'instagram', legenda }), [])
  })
})

// ── 5. Link ─────────────────────────────────────────────────────────────

describe('Link rastreado: estratégia compatível com o canal', () => {
  test('Instagram: bio. A legenda não leva URL', () => {
    assert.equal(estrategiaDeLinkDoCanal('instagram'), 'BIO')
    assert.equal(urlVaiNaLegenda('instagram'), false)
  })

  test('canal sem estratégia verificada também não leva URL na legenda', () => {
    assert.equal(estrategiaDeLinkDoCanal('youtube'), null)
    assert.equal(urlVaiNaLegenda('youtube'), false)
    assert.equal(urlVaiNaLegenda('facebook'), true, 'onde o texto é clicável, a URL vai nele')
  })

  test('URL colada na legenda do Instagram é pendência', () => {
    const p = pendenciasDeCopy({ canal: 'instagram', legenda: 'X\n\nLink na bio.\n\nhttps://patrono.exemplo.com.br/api/l/abc' })
    assert.ok(p.some((x) => x.startsWith('LINK_NAO_CLICAVEL')))
  })
})

// ── 6. A peça própria, montada ──────────────────────────────────────────

const PRODUTO = {
  id: 'p1', nome: 'Colchão Inflável Automático MODOFO Casal/Queen/King', categoria: 'casa e decoração',
  preco: 189.9, status: 'ativo', linkProduto: 'https://shopee.com.br/produto', sincronizadoEm: null,
}

describe('Peça com mídia própria (puro)', () => {
  test('monta a peça publicável com tudo o que o preflight exige', () => {
    const m = montarPecaComMidiaPropria({
      canal: 'instagram', produto: PRODUTO, videoUrl: VIDEO_PROPRIO_URL,
      reel: REEL_VALIDO,
        declaracao: { origem: 'PROPRIO', declaradoPor: 'u1', descricao: 'vídeo do colchão inflando', declaracoes: DECLARACOES_COMPLETAS },
      agora: AGORA, env: ENV,
    })
    assert.equal(m.ok, true, m.ok ? '' : m.motivos.join('|'))
    if (!m.ok) return
    assert.equal(m.previa.formato, FORMATO_VIDEO_PROPRIO)
    assert.equal(m.previa.ondeVaiOLink, 'BIO')
    assert.equal(m.previa.cta, 'Link na bio.')
    assert.match(m.previa.legenda, /confira o preço atual/, 'produto sem sincronização: sem preço')
    assert.ok(!/https?:\/\//.test(m.previa.legenda), 'sem URL na legenda')
    assert.deepEqual(pendenciasDeCopy({ canal: 'instagram', legenda: m.previa.legenda }), [])
    assert.equal(m.dados.videoUrl, VIDEO_PROPRIO_URL)
  })

  test('recusa: imagem da Shopee, produto inativo, sem link — todos os motivos de uma vez', () => {
    const m = montarPecaComMidiaPropria({
      canal: 'instagram', produto: { ...PRODUTO, status: 'inativo', linkProduto: null }, videoUrl: SHOPEE,
      reel: REEL_VALIDO,
        declaracao: { origem: 'PROPRIO', declaradoPor: 'u1', descricao: 'x', declaracoes: DECLARACOES_COMPLETAS },
      agora: AGORA, env: ENV,
    })
    assert.equal(m.ok, false)
    if (m.ok) return
    assert.ok(m.motivos.some((x) => /ativo/.test(x)))
    assert.ok(m.motivos.some((x) => /link de afiliado/.test(x)))
    assert.ok(m.motivos.some((x) => /Shopee/.test(x)))
  })

  test('recusa canal sem adapter real', () => {
    const m = montarPecaComMidiaPropria({
      canal: 'facebook', produto: PRODUTO, videoUrl: VIDEO_PROPRIO_URL,
      reel: REEL_VALIDO,
        declaracao: { origem: 'PROPRIO', declaradoPor: 'u1', descricao: 'x', declaracoes: DECLARACOES_COMPLETAS }, agora: AGORA, env: ENV,
    })
    assert.equal(m.ok, false)
  })
})

// ── 7. Banco: o caminho inteiro até o ensaio, sem publicar ──────────────

describe(
  'Do vídeo próprio ao ensaio — zero publicação',
  { skip: !TEM_BANCO ? 'DATABASE_URL ausente — exige Postgres' : false },
  () => {
    let wsA = ''
    let userA = ''
    let produtoId = ''
    let pecaTexto = ''

    before(async () => {
      wsA = (await prisma.workspace.create({ data: { name: 'R48', ownerId: marca }, select: { id: true } })).id
      userA = (
        await prisma.user.create({
          data: { email: `${marca}@teste.local`, name: 'U', password: 'x', workspaceId: wsA },
          select: { id: true },
        })
      ).id
      produtoId = (
        await prisma.produto.create({
          data: {
            workspaceId: wsA, userId: userA, nome: 'Colchão Inflável Automático MODOFO', categoria: 'casa',
            tipoVenda: 'Afiliado', origemConteudo: 'comprei_e_testei', imagens: [SHOPEE],
            linkProduto: 'https://shopee.com.br/colchao', preco: 189.9,
          },
          select: { id: true },
        })
      ).id
      // A peça como a P1.8 a deixou.
      pecaTexto = (
        await prisma.conteudo.create({
          data: {
            workspaceId: wsA, userId: userA, produtoId, roteiro: 'x', redeSocial: 'instagram',
            legendaInstagram: LEGENDA_P18,
          },
          select: { id: true },
        })
      ).id
      await prisma.integracao.create({
        data: {
          workspaceId: wsA, userId: userA, plataforma: 'instagram', status: 'conectado',
          accessToken: `TOKEN-${marca}`, tokenExpiry: new Date(Date.now() + 86_400_000),
          accountId: '178414', accountName: '@loja',
          extraData: {
            appId: '1', [CAMPO_DOS_SCOPES]: ['instagram_content_publish'],
            [CAMPO_DA_COMPROVACAO]: new Date().toISOString(),
          } as never,
        },
      })
    })

    after(async () => {
      // A distribuição com espião grava a captura prospectiva do ML.
      await prisma.mLFeatureSnapshot.deleteMany({ where: { workspaceId: wsA } })
      await prisma.eventoLink.deleteMany({ where: { workspaceId: wsA } })
      await prisma.automationJob.deleteMany({ where: { workspaceId: wsA } })
      await prisma.linkDinamico.updateMany({ where: { workspaceId: wsA }, data: { publicacaoId: null } })
      await prisma.linkDinamico.deleteMany({ where: { workspaceId: wsA } })
      await prisma.publicacao.deleteMany({ where: { workspaceId: wsA } })
      await prisma.conteudo.deleteMany({ where: { workspaceId: wsA } })
      await prisma.produto.deleteMany({ where: { workspaceId: wsA } })
      await prisma.integracao.deleteMany({ where: { workspaceId: wsA } })
      await prisma.auditLog.deleteMany({ where: { workspaceId: wsA } })
      await prisma.user.deleteMany({ where: { workspaceId: wsA } })
      await prisma.workspace.deleteMany({ where: { id: wsA } })
      await prisma.$disconnect()
    })

    test('a peça da P1.8 é recusada pelo preflight — nenhum flag a salvaria', async () => {
      const pf = await preflightDePublicacao({
        workspaceId: wsA, canal: 'instagram', contentId: pecaTexto,
        env: { ...ENV, PUBLICACAO_REAL_INSTAGRAM: 'true' },
      })
      assert.equal(pf.capabilityEfetiva.publicar, true, 'a conta está em ordem')
      assert.equal(pf.pronto, false)
      assert.equal(pf.executavelAgora, false, 'nem com o flag ligado')
      assert.equal(pf.aceitoPeloAdapter, false)
      assert.ok(pf.pendencias.some((p) => p.startsWith('HASHTAG_DE_OUTRO_CANAL')))
      assert.ok(pf.pendencias.some((p) => p.startsWith('PRECO_NAO_VERIFICADO')))
      assert.ok(pf.pendencias.some((p) => p.startsWith('CLAIM_NAO_COMPROVADO')))
    })

    test('vídeo da Shopee como "próprio": recusado antes de gravar qualquer coisa', async () => {
      const antes = await prisma.conteudo.count({ where: { workspaceId: wsA } })
      const r = await prepararPecaComMidiaPropria({
        workspaceId: wsA, produtoId, videoUrl: SHOPEE, gravar: true, env: ENV, agora: AGORA,
        reel: REEL_VALIDO,
        declaracao: { origem: 'PROPRIO', declaradoPor: userA, descricao: 'foto da Shopee', declaracoes: DECLARACOES_COMPLETAS },
      })
      assert.equal(r.montagem.ok, false)
      assert.equal(r.contentId, null)
      assert.equal(await prisma.conteudo.count({ where: { workspaceId: wsA } }), antes)
    })

    test('sem `gravar`: só prévia, nenhum Conteudo', async () => {
      const antes = await prisma.conteudo.count({ where: { workspaceId: wsA } })
      const r = await prepararPecaComMidiaPropria({
        workspaceId: wsA, produtoId, videoUrl: VIDEO_PROPRIO_URL, env: ENV, agora: AGORA,
        reel: REEL_VALIDO,
        declaracao: { origem: 'PROPRIO', declaradoPor: userA, descricao: 'vídeo do colchão inflando', declaracoes: DECLARACOES_COMPLETAS },
      })
      assert.equal(r.montagem.ok, true)
      assert.equal(r.contentId, null)
      assert.equal(await prisma.conteudo.count({ where: { workspaceId: wsA } }), antes)
    })

    test('vídeo próprio gravado: preflight PRONTO, e só o flag desligado o segura', async () => {
      const r = await prepararPecaComMidiaPropria({
        workspaceId: wsA, produtoId, videoUrl: VIDEO_PROPRIO_URL, gravar: true, env: ENV, agora: AGORA,
        reel: REEL_VALIDO,
        declaracao: { origem: 'PROPRIO', declaradoPor: userA, descricao: 'vídeo do colchão inflando', declaracoes: DECLARACOES_COMPLETAS },
      })
      assert.ok(r.contentId, r.montagem.ok ? '' : r.montagem.motivos.join('|'))

      const pf = await preflightDePublicacao({ workspaceId: wsA, canal: 'instagram', contentId: r.contentId!, env: ENV })
      assert.equal(pf.formato, 'VIDEO_PROPRIO')
      assert.equal(pf.aceitoPeloAdapter, true)
      assert.equal(pf.midiaAutorizada, true, pf.motivoDaMidia ?? '')
      assert.deepEqual(pf.pendencias, [])
      assert.equal(pf.estrategiaDeLink, 'BIO')
      assert.equal(pf.pronto, true, pf.explicacao.join(' | '))
      assert.equal(pf.executavelAgora, false)
      // P1.9.2: antes do canal desligado vem o passo humano da bio.
      assert.equal(pf.bloqueio, 'LINK_NA_BIO_NAO_CONFIRMADO')

      // Ensaio: mostra o link rastreado e onde ele vai, sem gravar nada.
      const pubAntes = await prisma.publicacao.count({ where: { workspaceId: wsA } })
      const linkAntes = await prisma.linkDinamico.count({ where: { workspaceId: wsA } })
      const ensaio = await simularDistribuicao({ workspaceId: wsA, contentId: r.contentId!, canal: 'instagram', env: ENV })
      assert.equal(ensaio.enviouAoCanal, false)
      assert.equal(ensaio.criouPublicacao, false)
      assert.equal(ensaio.payload!.ondeVaiOLink, 'BIO')
      assert.equal(ensaio.payload!.urlNaLegenda, false)
      assert.match(ensaio.payload!.urlQueSeriaUsada!, /\/api\/l\//)
      assert.equal(await prisma.publicacao.count({ where: { workspaceId: wsA } }), pubAntes)
      assert.equal(await prisma.linkDinamico.count({ where: { workspaceId: wsA } }), linkAntes)
    })

    test('distribuindo com adapter espião: a URL rastreada NÃO vai na legenda do Instagram', async () => {
      const r0 = await prepararPecaComMidiaPropria({
        workspaceId: wsA, produtoId, videoUrl: VIDEO_PROPRIO_URL, gravar: true, env: ENV, agora: AGORA,
        reel: REEL_VALIDO,
        declaracao: { origem: 'PROPRIO', declaradoPor: userA, descricao: 'vídeo do colchão', declaracoes: DECLARACOES_COMPLETAS },
      })
      const chamadas: PedidoDeDistribuicao[] = []
      const espiao: AdaptadorDeCanal = {
        canal: 'instagram',
        publicar: async (p) => {
          chamadas.push(p)
          return { ok: true, publicacaoExternaId: `ext-${marca}`, erro: null }
        },
      }
      await confirmarLinkNaBioParaTeste({
        workspaceId: wsA, contentId: r0.contentId!, chaveDaTentativa: `${marca}-espiao`, userId: userA, env: ENV,
      })
      const r = await distribuirConteudo({
        workspaceId: wsA, contentId: r0.contentId!, canal: 'instagram',
        chaveDaTentativa: `${marca}-espiao`, adaptadores: { instagram: espiao }, env: ENV,
      })
      assert.equal(r.ok, true, r.explicacao)
      assert.equal(chamadas.length, 1)
      assert.equal(chamadas[0].formato, 'VIDEO_PROPRIO')
      assert.match(chamadas[0].urlParaDivulgar, /\/api\/l\//, 'o link rastreado existe')
      assert.ok(!chamadas[0].legenda.includes(chamadas[0].urlParaDivulgar), 'e não está na legenda')
      assert.match(chamadas[0].legenda, /Link na bio\./)
    })

    test('ZERO publicação real: registro vazio, flag ausente, nenhuma rede', () => {
      assert.deepEqual(Object.keys(ADAPTADORES_LIGADOS), [])
      assert.deepEqual(Object.keys(adaptadoresHabilitados(process.env)), [])
      assert.equal(process.env.PUBLICACAO_REAL_INSTAGRAM, undefined)
      assert.equal(chamadasDeRede, 0, 'nenhum fetch saiu durante a suíte')
    })
  }
)
