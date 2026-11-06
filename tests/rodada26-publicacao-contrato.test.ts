/**
 * P1.0 Etapa 1 — contrato de domínio de `Publicacao`.
 *
 * Tudo puro: nenhum teste aqui toca banco, porque nenhuma linha do contrato
 * toca banco. A prova central é a republicação — três distribuições do
 * mesmo conteúdo têm de ser três publicações distintas.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ESTADOS_DA_PUBLICACAO,
  TRANSICOES_PERMITIDAS,
  TIPOS_DE_EVIDENCIA_DE_PUBLICACAO,
  CAPACIDADES_DA_PUBLICACAO,
  CARDINALIDADE_COM_LINK,
  MOTIVOS_PUBLICACAO_INVALIDA,
  MOTIVOS_SEM_ATRIBUICAO,
  PROPOSTA_DE_ATRIBUICAO_DE_VENDA,
  TRANSICAO_DE_ML,
  TAMANHO_MINIMO_DO_MOTIVO_DE_PUBLICACAO,
  transicaoPermitida,
  validarTransicao,
  validarPublicacao,
  validarEvidenciaDePublicacao,
  avaliarDistribuicaoDaPublicacao,
  publicacaoHabilita,
  chaveDeIdempotencia,
  chaveExternaDaPublicacao,
  ehMesmaPublicacao,
  derivarAtribuicaoDoClique,
  type CadeiaDoClique,
  type EvidenciaDePublicacao,
  type Publicacao,
} from '../lib/publicacao-contrato'
import { AFFILIATE_PROVIDER_REGISTRY } from '../lib/affiliate-providers'
import { FEATURE_VERSION } from '../lib/ml-feature-store'

const RAIZ = join(__dirname, '..')
const lerFonte = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')

const WS = 'ws-alfa'
const OUTRO_WS = 'ws-beta'

const EVIDENCIA_OK: EvidenciaDePublicacao = {
  tipo: 'ID_EXTERNO_DO_PROVIDER',
  referenciaExterna: 'media-abc123',
  confirmadaEm: new Date('2026-09-20T19:00:00.000Z'),
}

function publicacao(over: Partial<Publicacao> = {}): Publicacao {
  return {
    id: 'pub-1',
    workspaceId: WS,
    contentId: 'cont-1',
    destino: { provider: 'instagram', canal: 'reels' },
    estado: 'DISTRIBUIDA',
    chaveDaTentativa: 'tentativa-1',
    publicacaoExternaId: 'media-abc123',
    distribuidaEm: new Date('2026-09-20T19:00:00.000Z'),
    evidencia: EVIDENCIA_OK,
    linkId: null,
    dataOrigin: 'USER_REPORTED',
    criadaEm: new Date('2026-09-20T18:00:00.000Z'),
    ...over,
  }
}

const motivo = (v: ReturnType<typeof validarPublicacao>) => (v as { motivo: string }).motivo

// ── Identidade e idempotência ───────────────────────────────────────────

describe('Identidade — a chave não pode depender de campo que às vezes some', () => {
  test('a chave primária existe mesmo sem id externo', () => {
    // É o caso que quebra `contentId + canal + publicacaoExternaId`.
    const manual = publicacao({ publicacaoExternaId: null, chaveDaTentativa: 'manual-1' })
    assert.equal(chaveDeIdempotencia(manual), `${WS}|manual-1`)
    assert.equal(chaveExternaDaPublicacao({ ...manual, provider: 'instagram' }), null)
  })

  test('a chave externa só existe quando o provider devolveu id', () => {
    assert.equal(
      chaveExternaDaPublicacao({ workspaceId: WS, provider: 'instagram', publicacaoExternaId: 'media-1' }),
      `${WS}|instagram|media-1`
    )
    for (const id of [null, undefined, '', '   ']) {
      assert.equal(chaveExternaDaPublicacao({ workspaceId: WS, provider: 'instagram', publicacaoExternaId: id }), null)
    }
  })

  test('espaços não criam chave diferente', () => {
    assert.equal(
      chaveDeIdempotencia({ workspaceId: WS, chaveDaTentativa: '  t1  ' }),
      chaveDeIdempotencia({ workspaceId: WS, chaveDaTentativa: 't1' })
    )
  })

  test('workspaces diferentes nunca compartilham chave', () => {
    assert.notEqual(
      chaveDeIdempotencia({ workspaceId: WS, chaveDaTentativa: 't1' }),
      chaveDeIdempotencia({ workspaceId: OUTRO_WS, chaveDaTentativa: 't1' })
    )
  })

  test('RETRY: mesma chave de tentativa é a MESMA publicação', () => {
    const a = publicacao({ estado: 'FALHOU', publicacaoExternaId: null })
    const b = publicacao({ estado: 'DISTRIBUINDO', publicacaoExternaId: null })
    assert.equal(ehMesmaPublicacao(a, b), true)
  })

  test('mesmo post do provider sob chaves diferentes é a MESMA publicação', () => {
    // Webhook reentregue, adapter reprocessado.
    const a = publicacao({ chaveDaTentativa: 't1', publicacaoExternaId: 'media-9' })
    const b = publicacao({ chaveDaTentativa: 't2', publicacaoExternaId: 'media-9' })
    assert.equal(ehMesmaPublicacao(a, b), true)
  })

  test('mesmo id externo em PROVIDERS diferentes NÃO é a mesma', () => {
    const a = publicacao({ chaveDaTentativa: 't1', destino: { provider: 'instagram', canal: 'reels' } })
    const b = publicacao({ chaveDaTentativa: 't2', destino: { provider: 'tiktok', canal: 'feed' } })
    assert.equal(ehMesmaPublicacao(a, b), false)
  })
})

// ── Republicação: a prova obrigatória ───────────────────────────────────

describe('Republicação — três distribuições, três publicações', () => {
  const contentId = 'cont-A'
  const hoje = new Date('2026-09-22T12:00:00.000Z')
  const em15dias = new Date('2026-10-07T12:00:00.000Z')

  const tiktokHoje = publicacao({
    id: 'pub-1',
    contentId,
    destino: { provider: 'tiktok', canal: 'feed' },
    chaveDaTentativa: 'tt-2026-09-22',
    publicacaoExternaId: 'tt-post-1',
    distribuidaEm: hoje,
    evidencia: { ...EVIDENCIA_OK, referenciaExterna: 'tt-post-1', confirmadaEm: hoje },
  })
  const tiktokDepois = publicacao({
    id: 'pub-2',
    contentId,
    destino: { provider: 'tiktok', canal: 'feed' },
    chaveDaTentativa: 'tt-2026-10-07',
    publicacaoExternaId: 'tt-post-2',
    distribuidaEm: em15dias,
    evidencia: { ...EVIDENCIA_OK, referenciaExterna: 'tt-post-2', confirmadaEm: em15dias },
  })
  const instagram = publicacao({
    id: 'pub-3',
    contentId,
    destino: { provider: 'instagram', canal: 'reels' },
    chaveDaTentativa: 'ig-2026-09-22',
    publicacaoExternaId: 'ig-post-1',
    distribuidaEm: hoje,
    evidencia: { ...EVIDENCIA_OK, referenciaExterna: 'ig-post-1', confirmadaEm: hoje },
  })

  test('mesmo conteúdo, mesmo canal, 15 dias depois → publicações DIFERENTES', () => {
    // Hoje isso sobrescreveria `Conteudo.dataPublicacao` e apagaria a
    // primeira. É a dívida que a entidade resolve.
    assert.equal(ehMesmaPublicacao(tiktokHoje, tiktokDepois), false)
  })

  test('mesmo conteúdo em canais diferentes → publicações DIFERENTES', () => {
    assert.equal(ehMesmaPublicacao(tiktokHoje, instagram), false)
  })

  test('as três têm chaves distintas', () => {
    const chaves = [tiktokHoje, tiktokDepois, instagram].map(chaveDeIdempotencia)
    assert.equal(new Set(chaves).size, 3)
  })

  test('cada uma carrega o próprio instante, e as capacidades são próprias', () => {
    const v1 = avaliarDistribuicaoDaPublicacao(tiktokHoje)
    const v2 = avaliarDistribuicaoDaPublicacao(tiktokDepois)
    assert.equal(v1.distribuidaEm?.toISOString(), hoje.toISOString())
    assert.equal(v2.distribuidaEm?.toISOString(), em15dias.toISOString())
    // Janelas, snapshots e métricas são ancorados nesses instantes.
    assert.notEqual(v1.distribuidaEm!.getTime(), v2.distribuidaEm!.getTime())
  })

  test('cada uma pode ter o próprio link', () => {
    const a = publicacao({ ...tiktokHoje, linkId: 'link-1' })
    const b = publicacao({ ...tiktokDepois, linkId: 'link-2' })
    for (const p of [a, b]) {
      assert.deepEqual(
        validarPublicacao(p, { linkWorkspaceId: WS, linkProdutoId: 'prod-1', conteudoProdutoId: 'prod-1', linksJaVinculados: 0 }),
        { ok: true }
      )
    }
    assert.notEqual(a.linkId, b.linkId)
  })
})

// ── Estados ─────────────────────────────────────────────────────────────

describe('Estados e transições', () => {
  test('os cinco estados estão declarados', () => {
    assert.deepEqual([...ESTADOS_DA_PUBLICACAO], [
      'PREPARADA',
      'DISTRIBUINDO',
      'DISTRIBUIDA',
      'FALHOU',
      'REMOVIDA',
    ])
  })

  test('o caminho feliz é permitido', () => {
    assert.equal(transicaoPermitida('PREPARADA', 'DISTRIBUINDO'), true)
    assert.equal(transicaoPermitida('DISTRIBUINDO', 'DISTRIBUIDA'), true)
    assert.equal(transicaoPermitida('DISTRIBUIDA', 'REMOVIDA'), true)
  })

  test('retry depois de falha volta a DISTRIBUINDO', () => {
    assert.equal(transicaoPermitida('FALHOU', 'DISTRIBUINDO'), true)
  })

  test('publicação confirmada NÃO volta a processar', () => {
    assert.equal(transicaoPermitida('DISTRIBUIDA', 'DISTRIBUINDO'), false)
    assert.equal(transicaoPermitida('DISTRIBUIDA', 'PREPARADA'), false)
  })

  test('REMOVIDA é terminal — republicar é publicação nova', () => {
    assert.deepEqual(TRANSICOES_PERMITIDAS.REMOVIDA, [])
    for (const e of ESTADOS_DA_PUBLICACAO) {
      assert.equal(transicaoPermitida('REMOVIDA', e), false)
    }
  })

  test('transição inválida é recusada com motivo', () => {
    const v = validarTransicao('DISTRIBUIDA', 'PREPARADA')
    assert.equal(v.ok, false)
    assert.equal(motivo(v), 'TRANSICAO_NAO_PERMITIDA')
  })

  test('nenhuma transição aponta para estado inexistente', () => {
    for (const [de, paras] of Object.entries(TRANSICOES_PERMITIDAS)) {
      assert.ok((ESTADOS_DA_PUBLICACAO as readonly string[]).includes(de))
      for (const p of paras) assert.ok((ESTADOS_DA_PUBLICACAO as readonly string[]).includes(p))
    }
  })
})

// ── Evidência e capacidades ─────────────────────────────────────────────

describe('Evidência — estado interno não é prova', () => {
  test('DISTRIBUIDA com evidência válida habilita as quatro capacidades', () => {
    const v = avaliarDistribuicaoDaPublicacao(publicacao())
    assert.equal(v.distribuida, true)
    assert.deepEqual(v.capacidades, [...CAPACIDADES_DA_PUBLICACAO])
    for (const c of CAPACIDADES_DA_PUBLICACAO) {
      assert.equal(publicacaoHabilita(publicacao(), c), true)
    }
  })

  test('DISTRIBUIDA SEM evidência não habilita nada', () => {
    const v = avaliarDistribuicaoDaPublicacao(publicacao({ evidencia: null }))
    assert.equal(v.distribuida, false)
    assert.deepEqual(v.capacidades, [])
    assert.equal(v.motivo, 'EVIDENCIA_AUSENTE')
  })

  for (const estado of ['PREPARADA', 'DISTRIBUINDO', 'FALHOU', 'REMOVIDA'] as const) {
    test(`${estado} não habilita capacidade nenhuma, mesmo com evidência`, () => {
      const v = avaliarDistribuicaoDaPublicacao(publicacao({ estado }))
      assert.equal(v.distribuida, false)
      assert.deepEqual(v.capacidades, [])
      assert.equal(v.motivo, 'ESTADO_INVALIDO')
    })
  }

  test('o instante vem da EVIDÊNCIA, não do campo espelho', () => {
    // Espelho divergente não pode virar a fonte.
    const real = new Date('2026-09-20T19:00:00.000Z')
    const v = avaliarDistribuicaoDaPublicacao(
      publicacao({ distribuidaEm: new Date('2020-01-01T00:00:00.000Z'), evidencia: { ...EVIDENCIA_OK, confirmadaEm: real } })
    )
    assert.equal(v.distribuidaEm?.toISOString(), real.toISOString())
  })

  test('sem instante de confirmação não há distribuição', () => {
    for (const d of [null, undefined, new Date('xx')]) {
      const v = validarEvidenciaDePublicacao({ ...EVIDENCIA_OK, confirmadaEm: d as Date })
      assert.equal(v.ok, false)
      assert.equal(motivo(v), 'SEM_INSTANTE_DE_DISTRIBUICAO')
    }
  })

  test('sem referência externa não há prova', () => {
    for (const r of [null, undefined, '', '   ']) {
      const v = validarEvidenciaDePublicacao({ ...EVIDENCIA_OK, referenciaExterna: r })
      assert.equal(v.ok, false)
      assert.equal(motivo(v), 'REFERENCIA_EXTERNA_AUSENTE')
    }
  })

  test('tipo inventado é recusado', () => {
    const v = validarEvidenciaDePublicacao({ ...EVIDENCIA_OK, tipo: 'ACHO_QUE_PUBLIQUEI' })
    assert.equal(v.ok, false)
    assert.equal(motivo(v), 'TIPO_DE_EVIDENCIA_INVALIDO')
  })

  test('CONFIRMACAO_DE_ADAPTER exige nomear o adapter', () => {
    const base = { ...EVIDENCIA_OK, tipo: 'CONFIRMACAO_DE_ADAPTER' as const }
    assert.equal(motivo(validarEvidenciaDePublicacao(base)), 'ADAPTER_AUSENTE')
    assert.deepEqual(validarEvidenciaDePublicacao({ ...base, adapterId: 'adapter-instagram' }), { ok: true })
  })

  test('CORRECAO_MANUAL_AUDITADA exige responsável e motivo escrito', () => {
    const base = { ...EVIDENCIA_OK, tipo: 'CORRECAO_MANUAL_AUDITADA' as const }
    assert.equal(motivo(validarEvidenciaDePublicacao(base)), 'RESPONSAVEL_AUSENTE')
    assert.equal(motivo(validarEvidenciaDePublicacao({ ...base, responsavelUserId: 'u1' })), 'MOTIVO_AUSENTE')
    assert.equal(
      motivo(validarEvidenciaDePublicacao({ ...base, responsavelUserId: 'u1', motivo: 'ok' })),
      'MOTIVO_INSUFICIENTE'
    )
    assert.deepEqual(
      validarEvidenciaDePublicacao({
        ...base,
        responsavelUserId: 'u1',
        motivo: 'Post conferido no perfil público em 20/09.',
      }),
      { ok: true }
    )
    assert.ok(TAMANHO_MINIMO_DO_MOTIVO_DE_PUBLICACAO >= 10)
  })

  test('os três tipos de evidência estão declarados', () => {
    assert.deepEqual([...TIPOS_DE_EVIDENCIA_DE_PUBLICACAO], [
      'ID_EXTERNO_DO_PROVIDER',
      'CONFIRMACAO_DE_ADAPTER',
      'CORRECAO_MANUAL_AUDITADA',
    ])
  })
})

// ── Segurança e coerência ───────────────────────────────────────────────

describe('Segurança — nada vindo do cliente é aceito sem conferência', () => {
  test('publicação válida passa', () => {
    assert.deepEqual(validarPublicacao(publicacao(), { conteudoWorkspaceId: WS, providerConhecido: true }), {
      ok: true,
    })
  })

  test('workspace ausente → recusa', () => {
    assert.equal(motivo(validarPublicacao(publicacao({ workspaceId: '' }))), 'WORKSPACE_AUSENTE')
  })

  test('conteúdo de OUTRO workspace → recusa', () => {
    const v = validarPublicacao(publicacao(), { conteudoWorkspaceId: OUTRO_WS })
    assert.equal(motivo(v), 'CONTEUDO_DE_OUTRO_WORKSPACE')
  })

  test('link de OUTRO workspace → recusa', () => {
    const v = validarPublicacao(publicacao({ linkId: 'link-1' }), { linkWorkspaceId: OUTRO_WS })
    assert.equal(motivo(v), 'LINK_DE_OUTRO_WORKSPACE')
  })

  test('link de OUTRO produto → recusa', () => {
    const v = validarPublicacao(publicacao({ linkId: 'link-1' }), {
      linkWorkspaceId: WS,
      linkProdutoId: 'prod-9',
      conteudoProdutoId: 'prod-1',
    })
    assert.equal(motivo(v), 'LINK_DE_OUTRO_PRODUTO')
  })

  test('provider fora do registry → recusa', () => {
    const v = validarPublicacao(publicacao(), { providerConhecido: false })
    assert.equal(motivo(v), 'PROVIDER_DESCONHECIDO')
  })

  test('destino incompleto → recusa', () => {
    assert.equal(
      motivo(validarPublicacao(publicacao({ destino: { provider: 'instagram', canal: '' } }))),
      'DESTINO_INCOMPLETO'
    )
    assert.equal(
      motivo(validarPublicacao(publicacao({ destino: { provider: '', canal: 'reels' } }))),
      'DESTINO_INCOMPLETO'
    )
  })

  test('sem chave de tentativa → recusa', () => {
    assert.equal(motivo(validarPublicacao(publicacao({ chaveDaTentativa: '  ' }))), 'CHAVE_DE_TENTATIVA_AUSENTE')
  })

  test('estado inventado → recusa', () => {
    assert.equal(motivo(validarPublicacao(publicacao({ estado: 'NO_AR' as never }))), 'ESTADO_INVALIDO')
  })

  test('todo motivo pertence à lista declarada', () => {
    const casos = [
      validarPublicacao(publicacao({ workspaceId: '' })),
      validarPublicacao(publicacao({ contentId: '' })),
      validarPublicacao(publicacao(), { conteudoWorkspaceId: OUTRO_WS }),
      validarPublicacao(publicacao(), { providerConhecido: false }),
      validarEvidenciaDePublicacao(null),
      validarTransicao('REMOVIDA', 'DISTRIBUIDA'),
    ]
    for (const c of casos) {
      assert.equal(c.ok, false)
      assert.ok((MOTIVOS_PUBLICACAO_INVALIDA as readonly string[]).includes(motivo(c)))
      assert.ok((c as { explicacao: string }).explicacao.length > 0)
    }
  })
})

// ── Cardinalidade ───────────────────────────────────────────────────────

describe('Cardinalidade com LinkDinamico', () => {
  test('é 0..1, e o motivo é o schema', () => {
    assert.equal(CARDINALIDADE_COM_LINK.minimo, 0)
    assert.equal(CARDINALIDADE_COM_LINK.maximo, 1)
    assert.match(CARDINALIDADE_COM_LINK.porque, /Conteudo\.produtoId é FK única/)
  })

  test('publicação sem link é válida — nem toda distribuição é rastreada', () => {
    assert.deepEqual(validarPublicacao(publicacao({ linkId: null }), { conteudoWorkspaceId: WS }), { ok: true })
  })

  test('um segundo link na mesma publicação é recusado', () => {
    const v = validarPublicacao(publicacao({ linkId: 'link-2' }), {
      linkWorkspaceId: WS,
      linksJaVinculados: 1,
    })
    assert.equal(motivo(v), 'EXCEDE_CARDINALIDADE_DE_LINK')
  })

  test('está declarado quando a cardinalidade mudaria', () => {
    assert.match(CARDINALIDADE_COM_LINK.viraVariosQuando, /mais de um produto/)
  })
})

// ── Atribuição do clique ────────────────────────────────────────────────

describe('Atribuição do clique — as duas pontas, simultâneas', () => {
  const cadeia = (over: Partial<CadeiaDoClique> = {}): CadeiaDoClique => ({
    clickEventId: 'ev-1',
    workspaceId: WS,
    link: { id: 'link-1', workspaceId: WS, produtoId: 'prod-1', publicacaoId: 'pub-1' },
    publicacao: {
      id: 'pub-1',
      workspaceId: WS,
      contentId: 'cont-1',
      destino: { provider: 'tiktok', canal: 'feed' },
    },
    ...over,
  })

  test('cadeia completa devolve produto, publicação, conteúdo e canal', () => {
    const a = derivarAtribuicaoDoClique(cadeia())
    assert.equal(a.produtoId, 'prod-1')
    assert.equal(a.publicacaoId, 'pub-1')
    assert.equal(a.contentId, 'cont-1')
    assert.equal(a.canal, 'feed')
    assert.equal(a.provider, 'tiktok')
    assert.equal(a.motivoSemPublicacao, null)
  })

  test('link antigo sem publicação: produto conhecido, origem não', () => {
    // Informação verdadeira, não buraco a preencher.
    const a = derivarAtribuicaoDoClique(cadeia({ link: { id: 'link-1', workspaceId: WS, produtoId: 'prod-1', publicacaoId: null } }))
    assert.equal(a.produtoId, 'prod-1')
    assert.equal(a.publicacaoId, null)
    assert.equal(a.contentId, null)
    assert.equal(a.motivoSemPublicacao, 'SEM_PUBLICACAO_NO_LINK')
  })

  test('sem link, nada é derivado', () => {
    const a = derivarAtribuicaoDoClique(cadeia({ link: null }))
    assert.equal(a.produtoId, null)
    assert.equal(a.publicacaoId, null)
    assert.equal(a.motivoSemPublicacao, 'SEM_LINK')
  })

  test('link de outro workspace não deriva nada', () => {
    const a = derivarAtribuicaoDoClique(
      cadeia({ link: { id: 'link-1', workspaceId: OUTRO_WS, produtoId: 'prod-1', publicacaoId: 'pub-1' } })
    )
    assert.equal(a.produtoId, null)
    assert.equal(a.motivoSemPublicacao, 'LINK_DE_OUTRO_WORKSPACE')
  })

  test('publicação de outro workspace é recusada, produto preservado', () => {
    const a = derivarAtribuicaoDoClique(
      cadeia({ publicacao: { id: 'pub-1', workspaceId: OUTRO_WS, contentId: 'c', destino: { provider: 'x', canal: 'y' } } })
    )
    assert.equal(a.produtoId, 'prod-1')
    assert.equal(a.publicacaoId, null)
    assert.equal(a.motivoSemPublicacao, 'PUBLICACAO_DE_OUTRO_WORKSPACE')
  })

  test('publicação que não é a do link é recusada', () => {
    const a = derivarAtribuicaoDoClique(
      cadeia({ publicacao: { id: 'pub-99', workspaceId: WS, contentId: 'c', destino: { provider: 'x', canal: 'y' } } })
    )
    assert.equal(a.publicacaoId, null)
    assert.equal(a.motivoSemPublicacao, 'PUBLICACAO_NAO_CORRESPONDE_AO_LINK')
  })

  test('referer NUNCA entra na atribuição', () => {
    // Cabeçalho do navegador: ausente em app nativo, forjável por qualquer um.
    const codigo = lerFonte('lib/publicacao-contrato.ts')
      .split(/\r?\n/)
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n')
    assert.ok(!/referer/i.test(codigo))
  })

  test('todo motivo de não-atribuição pertence à lista', () => {
    const casos = [
      derivarAtribuicaoDoClique(cadeia({ link: null })),
      derivarAtribuicaoDoClique(cadeia({ link: { id: 'l', workspaceId: OUTRO_WS, produtoId: 'p', publicacaoId: null } })),
      derivarAtribuicaoDoClique(cadeia({ publicacao: null })),
    ]
    for (const c of casos) {
      assert.ok((MOTIVOS_SEM_ATRIBUICAO as readonly string[]).includes(c.motivoSemPublicacao!))
      assert.ok(c.explicacao.length > 0)
    }
  })

  test('a função é pura: não altera a cadeia recebida', () => {
    const c = cadeia()
    const copia = JSON.parse(JSON.stringify(c))
    derivarAtribuicaoDoClique(c)
    assert.deepEqual(JSON.parse(JSON.stringify(c)), copia)
  })
})

// ── Venda e ML: propostas declaradas ────────────────────────────────────

describe('Venda — derivação sem coluna nova', () => {
  test('a proposta não cria coluna em Sale, e diz por quê', () => {
    assert.equal(PROPOSTA_DE_ATRIBUICAO_DE_VENDA.colunaNovaEmSale, false)
    assert.match(PROPOSTA_DE_ATRIBUICAO_DE_VENDA.porque, /segunda verdade/)
    assert.match(PROPOSTA_DE_ATRIBUICAO_DE_VENDA.cadeia, /Sale\.clickEventId/)
  })

  test('o único caso que justificaria a coluna está declarado', () => {
    assert.match(PROPOSTA_DE_ATRIBUICAO_DE_VENDA.quandoJustificaria, /sem passar pelo redirect/)
  })
})

describe('ML — transição por geração, sem reescrever história', () => {
  test('a geração atual é a que está no código hoje', () => {
    assert.equal(TRANSICAO_DE_ML.geracaoAtual.entityType, 'Conteudo')
    assert.equal(TRANSICAO_DE_ML.geracaoAtual.featureVersion, FEATURE_VERSION)
  })

  test('a geração futura muda entidade E versão', () => {
    assert.equal(TRANSICAO_DE_ML.geracaoFutura.entityType, 'Publicacao')
    assert.notEqual(TRANSICAO_DE_ML.geracaoFutura.featureVersion, FEATURE_VERSION)
  })

  test('NÃO haverá backfill — reconstruir amostra é o vazamento já eliminado', () => {
    assert.equal(TRANSICAO_DE_ML.backfill, false)
    assert.match(TRANSICAO_DE_ML.porque, /editado/)
  })

  test('a consequência de não somar gerações está assumida', () => {
    assert.match(TRANSICAO_DE_ML.consequencia, /não se somam/)
  })
})

// ── Multi-provider e isolamento do contrato ─────────────────────────────

describe('Multi-provider — nenhum nome de plataforma em regra', () => {
  test('o contrato não cita provider específico no código', () => {
    const codigo = lerFonte('lib/publicacao-contrato.ts')
      .split(/\r?\n/)
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n')
    for (const nome of ['tiktok', 'instagram', 'amazon', 'shopee', 'mercadolivre', 'hotmart']) {
      assert.ok(!new RegExp(nome, 'i').test(codigo), `o contrato não pode citar ${nome} em código`)
    }
  })

  test('funciona com qualquer provider do registry', () => {
    for (const p of AFFILIATE_PROVIDER_REGISTRY.slice(0, 6)) {
      const v = validarPublicacao(publicacao({ destino: { provider: p.id, canal: 'feed' } }), {
        conteudoWorkspaceId: WS,
        providerConhecido: true,
      })
      assert.deepEqual(v, { ok: true }, `falhou para ${p.id}`)
    }
  })

  test('o contrato não importa Prisma nem toca banco', () => {
    const fonte = lerFonte('lib/publicacao-contrato.ts')
    assert.ok(!/from '\.\/prisma'|prisma\./.test(fonte), 'Etapa 1 é só domínio')
    for (const escrita of ['.create(', '.update(', '.findMany', '$transaction']) {
      assert.ok(!fonte.includes(escrita))
    }
  })

  test('o contrato continua PURO — nenhuma dependência de banco', () => {
    // Esta asserção nasceu como "Publicacao nao existe no schema", o que
    // valia enquanto a Etapa 1 era so contrato. A Etapa 2.b criou a tabela,
    // entao a trava mudou de alvo: o que precisa continuar verdadeiro e que
    // o CONTRATO nao dependa dela. Regra de dominio nao consulta banco.
    const fonte = lerFonte('lib/publicacao-contrato.ts')
    assert.ok(!/from '\.\/prisma'/.test(fonte), 'o contrato nao importa prisma')
    assert.ok(!/prisma\./.test(fonte), 'o contrato nao consulta o banco')
    assert.ok(!/@prisma\/client/.test(fonte), 'nem os tipos gerados')
  })
})
