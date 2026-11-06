/**
 * P0.2 Bloco 5 — dossiê auditável (regra pura).
 *
 * `detectarLacunas` e `montarReceita` são puras de propósito: a parte que
 * pode dizer "aqui há um problema" precisa ser exercida com os dados exatos
 * de cada cenário, sem banco.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  detectarLacunas,
  montarReceita,
  descreverCadeia,
  CODIGOS_DE_LACUNA,
  type DossieDaOperacao,
} from '../lib/dossie-operacao'

const RAIZ = join(__dirname, '..')
const lerFonte = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')
const lerCodigo = (rel: string) =>
  lerFonte(rel)
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n')

const WS = 'ws-alfa'

function comissao(over: Partial<DossieDaOperacao['comissoes'][number]> = {}) {
  return {
    id: 'com-1',
    status: 'RECEIVED',
    expectedAmount: 20,
    confirmedAmount: 18,
    receivedAmount: 15,
    expectedAt: null,
    confirmedAt: null,
    receivedAt: null,
    pertenceAEstaVenda: true,
    ...over,
  }
}

/** Dossiê completo, sem nenhuma lacuna. Cada teste estraga um aspecto. */
function dossie(over: Partial<DossieDaOperacao> = {}): DossieDaOperacao {
  const comissoes = over.comissoes ?? [comissao()]
  return {
    workspaceId: WS,
    saleId: 'sale-1',
    geradoEm: '2026-09-21T12:00:00.000Z',
    provider: { plataforma: 'shopee', providerDoProduto: null, origemDoRegistroDoProduto: 'MANUAL' },
    produto: { id: 'prod-1', nome: 'Produto', categoria: 'casa', preco: 120 },
    conteudo: { id: 'cont-1', redeSocial: 'tiktok', status: 'publicado', dataPublicacao: '2026-09-01T19:00:00.000Z' },
    distribuicao: {
      comprovada: true,
      publicacaoExternaId: 'media-1',
      distribuidoEm: '2026-09-01T19:00:00.000Z',
      explicacao: 'Distribuição confirmada pelo canal (id externo media-1).',
    },
    link: { id: 'link-1', slug: 'meu-link', plataforma: 'tiktok', ativo: true },
    clique: {
      atribuido: true,
      clickEventId: 'clique-1',
      attributionMethod: 'ULTIMO_CLIQUE_MESMO_LINK_ANTES_DA_VENDA',
      ocorridoEm: '2026-09-02T10:00:00.000Z',
    },
    venda: {
      id: 'sale-1',
      status: 'CONFIRMED',
      data: '2026-09-02T12:00:00.000Z',
      valorBruto: 200,
      source: 'manual',
      dataOrigin: 'REAL_OPERATION',
    },
    comissoes,
    receita: montarReceita(200, comissoes),
    proveniencia: { dataOrigin: 'REAL_OPERATION', descricao: 'ok', ehOperacaoReal: true },
    evidencias: [
      {
        tipo: 'CORRECAO_MANUAL_AUDITADA',
        referencia: 'extrato-42',
        verificadorId: null,
        responsavelUserId: 'user-1',
        motivo: 'Conferido no extrato.',
        registradaEm: '2026-09-03T09:00:00.000Z',
        workspaceIdVerificado: null,
        saleIdVerificado: null,
        commissionIdVerificado: null,
      },
    ],
    promocoes: [],
    veredito: null,
    amostraML: {
      snapshotId: 'snap-1',
      entityType: 'Conteudo',
      entityId: 'cont-1',
      featureVersion: 'v1',
      dataOrigin: 'REAL_OPERATION',
      capturedAt: '2026-09-01T19:00:00.000Z',
      labeledAt: '2026-09-03T09:00:00.000Z',
      label: { converted: true },
      contadaPeloReadiness: true,
    },
    auditoria: [],
    lacunas: [],
    ...over,
  }
}

const codigos = (d: DossieDaOperacao) => detectarLacunas(d as never).map((l) => l.codigo)

// ── Receita ─────────────────────────────────────────────────────────────

describe('Receita — os cinco números nunca se misturam', () => {
  test('RECEIVED preenche os três estágios; realizada é só o recebido', () => {
    const r = montarReceita(200, [comissao()])
    assert.equal(r.valorBrutoDaVenda, 200)
    assert.equal(r.comissaoEsperada, 20)
    assert.equal(r.comissaoConfirmada, 18)
    assert.equal(r.comissaoRecebida, 15)
    assert.equal(r.receitaRealizada, 15)
  })

  test('EXPECTED nunca é tratada como recebida', () => {
    const r = montarReceita(200, [
      comissao({ status: 'EXPECTED', expectedAmount: 50, confirmedAmount: null, receivedAmount: null }),
    ])
    assert.equal(r.comissaoEsperada, 50)
    assert.equal(r.comissaoConfirmada, 0)
    assert.equal(r.comissaoRecebida, 0)
    assert.equal(r.receitaRealizada, 0)
  })

  test('CONFIRMED é distinguida de RECEIVED', () => {
    const r = montarReceita(200, [comissao({ status: 'CONFIRMED', receivedAmount: null })])
    assert.equal(r.comissaoConfirmada, 18)
    assert.equal(r.receitaRealizada, 0)
  })

  test('o status manda, não o campo solto', () => {
    const r = montarReceita(200, [comissao({ status: 'EXPECTED', confirmedAmount: 99, receivedAmount: 99 })])
    assert.equal(r.comissaoConfirmada, 0)
    assert.equal(r.comissaoRecebida, 0)
  })

  test('comissão de outra venda não entra na conta', () => {
    const r = montarReceita(200, [comissao({ pertenceAEstaVenda: false })])
    assert.equal(r.comissaoRecebida, 0)
  })

  test('valor bruto ausente vira null, nunca zero', () => {
    // Zero afirmaria "vendeu R$ 0,00"; null diz "não sabemos".
    assert.equal(montarReceita(null, []).valorBrutoDaVenda, null)
    assert.equal(montarReceita(NaN, []).valorBrutoDaVenda, null)
  })

  test('valores ilegíveis não produzem NaN', () => {
    const r = montarReceita(200, [comissao({ expectedAmount: NaN, confirmedAmount: Infinity, receivedAmount: null })])
    for (const v of [r.comissaoEsperada, r.comissaoConfirmada, r.comissaoRecebida, r.receitaRealizada]) {
      assert.ok(Number.isFinite(v))
    }
  })
})

// ── Lacunas ─────────────────────────────────────────────────────────────

describe('Lacunas — ausência é resposta, não campo inventado', () => {
  test('operação completa não tem lacuna nenhuma', () => {
    assert.deepEqual(codigos(dossie()), [])
  })

  test('venda sem clique → CLIQUE_NAO_ATRIBUIDO, sem causalidade inventada', () => {
    const d = dossie({
      clique: { atribuido: false, clickEventId: null, attributionMethod: 'SEM_CLIQUE_ELEGIVEL', ocorridoEm: null },
    })
    const l = detectarLacunas(d as never)
    assert.ok(l.some((x) => x.codigo === 'CLIQUE_NAO_ATRIBUIDO'))
    assert.match(l.find((x) => x.codigo === 'CLIQUE_NAO_ATRIBUIDO')!.explicacao, /nenhuma causalidade é presumida/i)
  })

  test('venda sem conteúdo → SEM_CONTEUDO', () => {
    assert.ok(codigos(dossie({ conteudo: null })).includes('SEM_CONTEUDO'))
  })

  test('venda sem link → SEM_LINK', () => {
    assert.ok(codigos(dossie({ link: null })).includes('SEM_LINK'))
  })

  test('sem distribuição comprovada → lacuna própria', () => {
    const d = dossie({
      distribuicao: { comprovada: false, publicacaoExternaId: null, distribuidoEm: null, explicacao: 'sem recibo' },
    })
    assert.ok(codigos(d).includes('SEM_DISTRIBUICAO_COMPROVADA'))
  })

  test('sem conteúdo NÃO acumula lacuna de distribuição', () => {
    // Não faz sentido cobrar distribuição de algo que não tem conteúdo.
    const d = dossie({
      conteudo: null,
      distribuicao: { comprovada: false, publicacaoExternaId: null, distribuidoEm: null, explicacao: 'x' },
    })
    assert.ok(!codigos(d).includes('SEM_DISTRIBUICAO_COMPROVADA'))
  })

  test('venda sem valor → SEM_VALOR_DA_VENDA', () => {
    const d = dossie({ venda: { ...dossie().venda, valorBruto: null }, receita: montarReceita(null, [comissao()]) })
    assert.ok(codigos(d).includes('SEM_VALOR_DA_VENDA'))
  })

  test('sem comissão → SEM_COMISSAO', () => {
    const d = dossie({ comissoes: [], receita: montarReceita(200, []) })
    assert.ok(codigos(d).includes('SEM_COMISSAO'))
  })

  test('comissão EXPECTED: sem comissão reconhecida, sem receita realizada', () => {
    const c = [comissao({ status: 'EXPECTED', confirmedAmount: null, receivedAmount: null })]
    const d = dossie({ comissoes: c, receita: montarReceita(200, c) })
    assert.equal(d.receita.receitaRealizada, 0)
    // EXPECTED sozinha não gera RECEITA_NAO_REALIZADA (não há confirmada).
    assert.ok(!codigos(d).includes('RECEITA_NAO_REALIZADA'))
  })

  test('comissão CONFIRMED sem recebimento → RECEITA_NAO_REALIZADA', () => {
    const c = [comissao({ status: 'CONFIRMED', receivedAmount: null })]
    const d = dossie({ comissoes: c, receita: montarReceita(200, c) })
    assert.ok(codigos(d).includes('RECEITA_NAO_REALIZADA'))
  })

  test('comissão RECEIVED não gera lacuna de receita', () => {
    assert.ok(!codigos(dossie()).includes('RECEITA_NAO_REALIZADA'))
  })

  test('USER_REPORTED → lacuna de evidência, sem ser tratada como real', () => {
    const d = dossie({
      venda: { ...dossie().venda, dataOrigin: 'USER_REPORTED' },
      proveniencia: { dataOrigin: 'USER_REPORTED', descricao: 'relato', ehOperacaoReal: false },
      evidencias: [],
    })
    assert.ok(codigos(d).includes('SEM_EVIDENCIA_REGISTRADA'))
    assert.equal(d.proveniencia.ehOperacaoReal, false)
  })

  test('UNVERIFIED → ORIGEM_NAO_VERIFICADA', () => {
    const d = dossie({ proveniencia: { dataOrigin: 'UNVERIFIED', descricao: 'x', ehOperacaoReal: false } })
    assert.ok(codigos(d).includes('ORIGEM_NAO_VERIFICADA'))
  })

  for (const origem of ['SEED', 'TEST_FIXTURE', 'DEMO', 'SYNTHETIC_TEST'] as const) {
    test(`${origem} → ORIGEM_SINTETICA`, () => {
      const d = dossie({ proveniencia: { dataOrigin: origem, descricao: 'x', ehOperacaoReal: false } })
      assert.ok(codigos(d).includes('ORIGEM_SINTETICA'))
    })
  }

  test('sem amostra de ML → SEM_AMOSTRA_ML', () => {
    assert.ok(codigos(dossie({ amostraML: null })).includes('SEM_AMOSTRA_ML'))
  })

  test('amostra sem label → AMOSTRA_SEM_LABEL e fora do readiness', () => {
    const d = dossie({
      amostraML: { ...dossie().amostraML!, labeledAt: null, label: null, contadaPeloReadiness: false },
    })
    const c = codigos(d)
    assert.ok(c.includes('AMOSTRA_SEM_LABEL'))
    assert.ok(c.includes('AMOSTRA_FORA_DO_READINESS'))
  })

  test('amostra sintética rotulada → fora do readiness', () => {
    const d = dossie({
      amostraML: { ...dossie().amostraML!, dataOrigin: 'TEST_FIXTURE', contadaPeloReadiness: false },
    })
    assert.ok(codigos(d).includes('AMOSTRA_FORA_DO_READINESS'))
  })

  test('todo código devolvido pertence à lista declarada', () => {
    const casos = [dossie({ conteudo: null }), dossie({ link: null }), dossie({ comissoes: [] }), dossie({ amostraML: null })]
    for (const d of casos) {
      for (const c of codigos(d)) assert.ok((CODIGOS_DE_LACUNA as readonly string[]).includes(c))
    }
  })

  test('toda lacuna tem gravidade e explicação', () => {
    for (const l of detectarLacunas(dossie({ conteudo: null, link: null, comissoes: [] }) as never)) {
      assert.ok(['AUSENCIA', 'INCONSISTENCIA'].includes(l.gravidade))
      assert.ok(l.explicacao.length > 0)
    }
  })
})

// ── Inconsistências ─────────────────────────────────────────────────────

describe('Inconsistências — contradição não é ausência', () => {
  const comRelacoes = (r: Record<string, string | null>) => ({ ...dossie(), _relacoes: r })

  test('produto de outro workspace', () => {
    const l = detectarLacunas(comRelacoes({ produtoWorkspaceId: 'ws-beta' }) as never)
    const achado = l.find((x) => x.codigo === 'PRODUTO_DE_OUTRO_WORKSPACE')
    assert.ok(achado)
    assert.equal(achado!.gravidade, 'INCONSISTENCIA')
  })

  test('conteúdo e link de outro workspace', () => {
    const l = detectarLacunas(comRelacoes({ conteudoWorkspaceId: 'ws-beta', linkWorkspaceId: 'ws-beta' }) as never)
    assert.ok(l.some((x) => x.codigo === 'CONTEUDO_DE_OUTRO_WORKSPACE'))
    assert.ok(l.some((x) => x.codigo === 'LINK_DE_OUTRO_WORKSPACE'))
  })

  test('link de outro produto', () => {
    const l = detectarLacunas(comRelacoes({ linkProdutoId: 'prod-99' }) as never)
    assert.ok(l.some((x) => x.codigo === 'LINK_DE_OUTRO_PRODUTO'))
  })

  test('clique de outro link', () => {
    const l = detectarLacunas(comRelacoes({ cliqueLinkId: 'link-99' }) as never)
    assert.ok(l.some((x) => x.codigo === 'CLIQUE_DE_OUTRO_LINK'))
  })

  test('comissão de outra venda', () => {
    const c = [comissao(), comissao({ id: 'com-2', pertenceAEstaVenda: false })]
    assert.ok(codigos(dossie({ comissoes: c })).includes('COMISSAO_DE_OUTRA_VENDA'))
  })
})

// ── Cadeia ──────────────────────────────────────────────────────────────

describe('Cadeia de causalidade — elo ausente aparece como ausente', () => {
  test('cadeia completa cita cada elo', () => {
    const linhas = descreverCadeia(dossie())
    assert.equal(linhas.length, 9)
    assert.match(linhas.join('\n'), /produto:[\s\S]*conteúdo:[\s\S]*distribuição:[\s\S]*link:[\s\S]*clique:[\s\S]*venda:[\s\S]*comissão:[\s\S]*receita realizada:[\s\S]*aprendizado:/)
  })

  test('sem clique, a cadeia diz "não atribuído" — não pula o elo', () => {
    const linhas = descreverCadeia(
      dossie({ clique: { atribuido: false, clickEventId: null, attributionMethod: null, ocorridoEm: null } })
    )
    assert.ok(linhas.some((l) => l === 'clique: não atribuído'))
  })

  test('elos ausentes aparecem marcados, nunca omitidos', () => {
    const linhas = descreverCadeia(dossie({ produto: null, conteudo: null, link: null, comissoes: [] }))
    assert.equal(linhas.filter((l) => l.includes('ausente')).length, 4)
  })

  test('a cadeia mostra receita REALIZADA, não a esperada', () => {
    const c = [comissao({ status: 'EXPECTED', expectedAmount: 999, confirmedAmount: null, receivedAmount: null })]
    const linhas = descreverCadeia(dossie({ comissoes: c, receita: montarReceita(200, c) }))
    assert.ok(linhas.some((l) => l === 'receita realizada: R$ 0.00'))
  })
})

// ── Garantias estruturais ───────────────────────────────────────────────

describe('Garantias do dossiê', () => {
  const codigo = lerCodigo('lib/dossie-operacao.ts')

  test('é SOMENTE LEITURA — não escreve nada', () => {
    for (const escrita of ['.create(', '.update(', '.upsert(', '.delete(', '.createMany', '$executeRaw']) {
      assert.ok(!codigo.includes(escrita), `dossiê não pode escrever (${escrita})`)
    }
  })

  test('não promove, não atribui, não rotula', () => {
    for (const acao of [
      'promoverPorCorrecaoManual',
      'promoverPorEvidenciaVerificada',
      'atribuirClique',
      'capturarSnapshotDePublicacao',
      'registrarOperacaoRealNoFeatureStore',
      'rotularNegativo',
    ]) {
      assert.ok(!codigo.includes(acao), `${acao} não pode ser chamada pelo dossiê`)
    }
  })

  test('toda consulta filtra por workspaceId', () => {
    const consultas = codigo.match(/prisma\.\w+\.find\w+\(\{[\s\S]*?\}\)/g) ?? []
    assert.ok(consultas.length >= 3)
    for (const c of consultas) {
      assert.match(c, /workspaceId/, `consulta sem workspaceId:\n${c}`)
    }
  })

  test('o metadata bruto do AuditLog NUNCA é devolvido', () => {
    // Hoje não guardamos credencial nele; um dossiê que despeja metadata
    // inteiro passa a vazar no dia em que alguém guardar.
    assert.ok(!/metadata: l\.metadata|metadata: log\.metadata/.test(codigo))
    assert.match(codigo, /const CAMPOS_DE_EVIDENCIA = \[/)
  })

  test('não expõe token, senha ou segredo', () => {
    for (const proibido of ['accessToken', 'password', 'token', 'secret', 'apiKey', 'CRON_SECRET']) {
      assert.ok(!codigo.includes(proibido), `${proibido} não pode aparecer no dossiê`)
    }
  })

  test('usa a autoridade única para o veredito, sem regra própria', () => {
    assert.match(codigo, /avaliarVendaParaOperacaoReal\(workspaceId, saleId\)/)
    assert.ok(!/status === 'CONFIRMED' &&/.test(codigo))
  })

  test('a contagem do readiness segue a mesma regra do gate', () => {
    assert.match(codigo, /ORIGENS_PRODUCAO as readonly string\[\]\)\.includes\(amostra\.dataOrigin\)/)
  })
})
