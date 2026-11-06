/**
 * P0.2 — Blocos 1 e 2: proveniência obrigatória e atribuição determinística.
 *
 * A regra de atribuição é uma FUNÇÃO PURA de propósito: todos os casos
 * perigosos — clique de outro workspace, clique de outro link, clique
 * posterior à venda, empate — são exercidos aqui sem Postgres, com os dados
 * exatos de cada cenário. Um teste que depende de banco para provar
 * isolamento prova menos, não mais: ele testa a consulta, não a regra.
 *
 * O que exige banco (a coluna existir, o `registrarResultado` gravar) está em
 * `rodada18-proveniencia-banco.test.ts`.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  atribuirClique,
  houveAtribuicao,
  METODOS_ATRIBUICAO,
  type CliqueCandidato,
} from '../lib/atribuicao-clique'
import {
  ORIGENS_DE_REGISTRO,
  ORIGENS_DECLARAVEIS_POR_ROTA,
  ORIGEM_NAO_VERIFICADA,
  ORIGEM_RELATADA_PELA_USUARIA,
  EVIDENCIAS_ACEITAS_PARA_OPERACAO_REAL,
  DESCRICAO_DA_ORIGEM,
  ehOperacaoReal,
  ehOrigemDeRegistro,
  normalizarOrigemDeRegistro,
  podeSerDeclaradaPorRota,
} from '../lib/proveniencia'
import { ML_DATA_ORIGINS } from '../lib/ml-types'

const RAIZ = join(__dirname, '..')
const lerFonte = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')

/**
 * Fonte SEM comentários. Asserções sobre o que o código faz não podem tropeçar
 * no texto que EXPLICA o que ele deixou de fazer — o comentário da rota de
 * clique cita o `.catch(() => {})` antigo justamente para registrar o defeito.
 */
const lerCodigo = (rel: string) =>
  lerFonte(rel)
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n')

const WS = 'ws-alfa'
const OUTRO_WS = 'ws-beta'
const LINK = 'link-1'
const OUTRO_LINK = 'link-2'
const VENDA_EM = new Date('2026-09-21T12:00:00.000Z')

function clique(over: Partial<CliqueCandidato> & { id: string }): CliqueCandidato {
  return { workspaceId: WS, linkId: LINK, createdAt: new Date('2026-09-21T11:00:00.000Z'), ...over }
}

function atribuir(cliques: CliqueCandidato[], linkId: string | null = LINK) {
  return atribuirClique({ workspaceId: WS, linkId, dataDaVenda: VENDA_EM, cliques })
}

// ── BLOCO 1: proveniência ───────────────────────────────────────────────

describe('Bloco 1 — proveniência é declarada, nunca inferida', () => {
  test('UNVERIFIED existe e NÃO pertence às origens de ML', () => {
    // A separação importa: UNVERIFIED é estado do registro comercial
    // ("ainda não classificado"), não uma origem de dado de treino.
    assert.equal(ORIGEM_NAO_VERIFICADA, 'UNVERIFIED')
    assert.ok(!(ML_DATA_ORIGINS as readonly string[]).includes('UNVERIFIED'))
    assert.ok((ORIGENS_DE_REGISTRO as readonly string[]).includes('UNVERIFIED'))
  })

  test('as cinco origens de ML continuam aceitas como origem de registro', () => {
    for (const o of ML_DATA_ORIGINS) {
      assert.ok(ehOrigemDeRegistro(o), `${o} deveria ser origem de registro válida`)
    }
  })

  test('REAL_OPERATION é operação real; as demais NÃO são', () => {
    assert.equal(ehOperacaoReal('REAL_OPERATION'), true)
    for (const o of ['USER_REPORTED', 'SEED', 'TEST_FIXTURE', 'DEMO', 'SYNTHETIC_TEST', 'UNVERIFIED']) {
      assert.equal(ehOperacaoReal(o), false, `${o} jamais pode contar como operação real`)
    }
  })

  test('valor desconhecido, nulo ou corrompido vira UNVERIFIED — nunca REAL_OPERATION', () => {
    for (const lixo of [null, undefined, '', 'real_operation', 'REAL', 42, {}, [], 'PRODUCAO']) {
      assert.equal(normalizarOrigemDeRegistro(lixo), 'UNVERIFIED', `${JSON.stringify(lixo)} não pode virar origem válida`)
      assert.equal(ehOperacaoReal(lixo), false)
    }
  })

  test('comparação é sensível a maiúsculas — não há normalização permissiva', () => {
    // Aceitar 'real_operation' abriria a porta para um seed minúsculo virar
    // dado de produção por descuido de digitação.
    assert.equal(ehOrigemDeRegistro('real_operation'), false)
    assert.equal(ehOperacaoReal(' REAL_OPERATION '), false)
  })

  test('toda origem tem descrição — nenhuma fica sem explicação na tela', () => {
    for (const o of ORIGENS_DE_REGISTRO) {
      assert.ok(DESCRICAO_DA_ORIGEM[o]?.length > 0, `falta descrição para ${o}`)
    }
  })

  test('`ehOperacaoReal` não tem parâmetro de afrouxamento', () => {
    // Um booleano "incluirDemo" aqui seria o caminho mais curto para
    // contaminar o modelo sem ninguém perceber.
    assert.equal(ehOperacaoReal.length, 1)
  })
})

describe('Bloco 1 — o compilador obriga a declarar', () => {
  const fonte = lerFonte('lib/vendas-comissoes.ts')

  test('`dataOrigin` é obrigatório no input, sem valor padrão', () => {
    assert.match(fonte, /dataOrigin: OrigemDeRegistro/)
    assert.ok(!/dataOrigin\?: OrigemDeRegistro/.test(fonte), 'não pode ser opcional')
    assert.ok(!/dataOrigin: input\.dataOrigin \?\?/.test(fonte), 'não pode ter fallback silencioso')
  })

  test('a venda grava exatamente o que quem chamou declarou', () => {
    assert.match(fonte, /dataOrigin: input\.dataOrigin,/)
  })

  test('as rotas autenticadas declaram a origem — e ela NÃO é REAL_OPERATION', () => {
    // Asserção revista na microcorreção: na rodada anterior estas rotas
    // declaravam REAL_OPERATION porque a sessão estava autenticada. Isso
    // provava quem registrou, nunca que a venda aconteceu.
    for (const rota of ['app/api/vendas/route.ts', 'app/api/links/[id]/venda/route.ts']) {
      assert.match(lerCodigo(rota), /dataOrigin: 'USER_REPORTED'/, `${rota} precisa declarar a origem`)
    }
  })

  test('a proveniência entra na auditoria da venda', () => {
    assert.match(fonte, /dataOrigin: sale\.dataOrigin/)
    assert.match(fonte, /attributionMethod: sale\.attributionMethod/)
  })

  test('o default do banco é UNVERIFIED, não REAL_OPERATION', () => {
    const schema = lerFonte('prisma/schema.prisma')
    assert.match(schema, /dataOrigin String @default\("UNVERIFIED"\)/)
  })

  test('a migration NÃO promove histórico a REAL_OPERATION', () => {
    const sql = lerFonte('prisma/migrations/20260921120000_venda_proveniencia_e_atribuicao_clique/migration.sql')
    assert.match(sql, /DEFAULT 'UNVERIFIED'/)
    assert.ok(
      !/UPDATE\s+"Sale"[\s\S]*REAL_OPERATION/i.test(sql),
      'nenhum backfill pode transformar venda antiga em operação real'
    )
  })
})

// ── BLOCO 2: atribuição ─────────────────────────────────────────────────

describe('Bloco 2 — venda SEM clique', () => {
  test('venda sem link nenhum: não atribui, e diz que não é erro', () => {
    const r = atribuir([], null)
    assert.equal(r.clickEventId, null)
    assert.equal(r.metodo, 'SEM_LINK_NA_VENDA')
    assert.equal(houveAtribuicao(r.metodo), false)
  })

  test('venda com link, mas nenhum clique registrado: não atribui', () => {
    const r = atribuir([])
    assert.equal(r.clickEventId, null)
    assert.equal(r.metodo, 'SEM_CLIQUE_ELEGIVEL')
  })

  test('venda sem link IGNORA cliques existentes — não pesca um qualquer', () => {
    const r = atribuir([clique({ id: 'c1' })], null)
    assert.equal(r.clickEventId, null)
    assert.equal(r.metodo, 'SEM_LINK_NA_VENDA')
  })
})

describe('Bloco 2 — venda COM clique correto', () => {
  test('um clique elegível: atribui esse, com o método nomeado', () => {
    const r = atribuir([clique({ id: 'c1' })])
    assert.equal(r.clickEventId, 'c1')
    assert.equal(r.metodo, 'ULTIMO_CLIQUE_MESMO_LINK_ANTES_DA_VENDA')
    assert.equal(houveAtribuicao(r.metodo), true)
  })

  test('um milissegundo antes da venda ainda conta', () => {
    const r = atribuir([clique({ id: 'c1', createdAt: new Date(VENDA_EM.getTime() - 1) })])
    assert.equal(r.clickEventId, 'c1')
  })

  test('a explicação registra que NÃO há janela de provider', () => {
    // Apresentar uma janela interna como se fosse regra oficial do provider
    // produziria número que parece oficial e não é.
    const r = atribuir([clique({ id: 'c1' })])
    assert.match(r.explicacao, /Sem janela de tempo/i)
    assert.match(r.explicacao, /nenhum provider forneceu regra oficial/i)
  })

  test('clique antigo (meses antes) ainda é elegível — sem janela arbitrária', () => {
    const r = atribuir([clique({ id: 'antigo', createdAt: new Date('2026-01-01T00:00:00.000Z') })])
    assert.equal(r.clickEventId, 'antigo')
  })
})

describe('Bloco 2 — DOIS cliques no mesmo link', () => {
  test('vence o mais recente anterior à venda', () => {
    const r = atribuir([
      clique({ id: 'antigo', createdAt: new Date('2026-09-21T10:00:00.000Z') }),
      clique({ id: 'recente', createdAt: new Date('2026-09-21T11:30:00.000Z') }),
    ])
    assert.equal(r.clickEventId, 'recente')
    assert.equal(r.metodo, 'ULTIMO_CLIQUE_MESMO_LINK_ANTES_DA_VENDA')
  })

  test('o resultado não depende da ordem em que os cliques chegaram', () => {
    const a = clique({ id: 'antigo', createdAt: new Date('2026-09-21T10:00:00.000Z') })
    const b = clique({ id: 'recente', createdAt: new Date('2026-09-21T11:30:00.000Z') })
    assert.equal(atribuir([a, b]).clickEventId, 'recente')
    assert.equal(atribuir([b, a]).clickEventId, 'recente')
  })

  test('EMPATE no mesmo instante: NÃO atribui — não há critério objetivo', () => {
    const t = new Date('2026-09-21T11:30:00.000Z')
    const r = atribuir([clique({ id: 'c1', createdAt: t }), clique({ id: 'c2', createdAt: t })])
    assert.equal(r.clickEventId, null, 'escolher por id seria inventar atribuição com cara de regra')
    assert.equal(r.metodo, 'AMBIGUO_NAO_ATRIBUIDO')
  })

  test('empate em instante NÃO-mais-recente não impede a atribuição', () => {
    const t = new Date('2026-09-21T10:00:00.000Z')
    const r = atribuir([
      clique({ id: 'c1', createdAt: t }),
      clique({ id: 'c2', createdAt: t }),
      clique({ id: 'vencedor', createdAt: new Date('2026-09-21T11:00:00.000Z') }),
    ])
    assert.equal(r.clickEventId, 'vencedor')
  })
})

describe('Bloco 2 — clique POSTERIOR à venda', () => {
  test('clique depois da venda nunca é atribuído', () => {
    const r = atribuir([clique({ id: 'depois', createdAt: new Date(VENDA_EM.getTime() + 1000) })])
    assert.equal(r.clickEventId, null)
    assert.equal(r.metodo, 'SEM_CLIQUE_ELEGIVEL')
  })

  test('clique EXATAMENTE no instante da venda não conta (comparação estrita)', () => {
    const r = atribuir([clique({ id: 'simultaneo', createdAt: new Date(VENDA_EM.getTime()) })])
    assert.equal(r.clickEventId, null)
  })

  test('entre um anterior e um posterior, vence o anterior', () => {
    const r = atribuir([
      clique({ id: 'antes', createdAt: new Date(VENDA_EM.getTime() - 60_000) }),
      clique({ id: 'depois', createdAt: new Date(VENDA_EM.getTime() + 60_000) }),
    ])
    assert.equal(r.clickEventId, 'antes')
  })
})

describe('Bloco 2 — clique de OUTRO WORKSPACE', () => {
  test('clique de outro workspace nunca é atribuído', () => {
    const r = atribuir([clique({ id: 'alheio', workspaceId: OUTRO_WS })])
    assert.equal(r.clickEventId, null)
    assert.equal(r.metodo, 'SEM_CLIQUE_ELEGIVEL')
  })

  test('clique alheio não vence o próprio, mesmo sendo mais recente', () => {
    const r = atribuir([
      clique({ id: 'meu', createdAt: new Date('2026-09-21T10:00:00.000Z') }),
      clique({ id: 'alheio', workspaceId: OUTRO_WS, createdAt: new Date('2026-09-21T11:59:00.000Z') }),
    ])
    assert.equal(r.clickEventId, 'meu')
  })

  test('a explicação nunca cita dado do outro workspace', () => {
    const r = atribuir([clique({ id: 'alheio-id-secreto', workspaceId: OUTRO_WS })])
    assert.ok(!r.explicacao.includes('alheio-id-secreto'))
    assert.ok(!r.explicacao.includes(OUTRO_WS))
  })
})

describe('Bloco 2 — clique de OUTRO LINK', () => {
  test('clique de outro link nunca é atribuído', () => {
    const r = atribuir([clique({ id: 'outro', linkId: OUTRO_LINK })])
    assert.equal(r.clickEventId, null)
    assert.equal(r.metodo, 'SEM_CLIQUE_ELEGIVEL')
  })

  test('clique de outro link não vence o do link certo, mesmo mais recente', () => {
    const r = atribuir([
      clique({ id: 'certo', createdAt: new Date('2026-09-21T10:00:00.000Z') }),
      clique({ id: 'outro-link', linkId: OUTRO_LINK, createdAt: new Date('2026-09-21T11:59:00.000Z') }),
    ])
    assert.equal(r.clickEventId, 'certo')
  })

  test('link diferente implica produto diferente — nunca cruza produto', () => {
    // O link pertence a um produto (LinkDinamico.produtoId); filtrar por link
    // é o que garante, por construção, que a venda de um produto não recebe
    // o clique de outro.
    const r = atribuir([clique({ id: 'produto-b', linkId: OUTRO_LINK })])
    assert.equal(r.clickEventId, null)
  })
})

describe('Bloco 2 — dados inválidos NÃO viram atribuição', () => {
  test('data da venda inválida: não atribui', () => {
    const r = atribuirClique({
      workspaceId: WS,
      linkId: LINK,
      dataDaVenda: new Date('data-que-nao-existe'),
      cliques: [clique({ id: 'c1' })],
    })
    assert.equal(r.clickEventId, null)
    assert.equal(r.metodo, 'AMBIGUO_NAO_ATRIBUIDO')
  })

  test('clique com data inválida é descartado, sem derrubar os válidos', () => {
    const r = atribuir([
      clique({ id: 'quebrado', createdAt: new Date('xx') }),
      clique({ id: 'bom', createdAt: new Date('2026-09-21T11:00:00.000Z') }),
    ])
    assert.equal(r.clickEventId, 'bom')
  })

  test('só cliques inválidos: não atribui nenhum', () => {
    const r = atribuir([clique({ id: 'quebrado', createdAt: new Date('xx') })])
    assert.equal(r.clickEventId, null)
  })
})

describe('Bloco 2 — garantias gerais da regra', () => {
  test('NENHUM cenário inválido produz clickEventId preenchido', () => {
    // Varredura: qualquer combinação de clique inelegível tem de devolver
    // null. É a asserção que impede uma atribuição falsa passar despercebida.
    const inelegiveis: CliqueCandidato[][] = [
      [clique({ id: 'a', workspaceId: OUTRO_WS })],
      [clique({ id: 'b', linkId: OUTRO_LINK })],
      [clique({ id: 'c', createdAt: new Date(VENDA_EM.getTime() + 1) })],
      [clique({ id: 'd', createdAt: VENDA_EM })],
      [clique({ id: 'e', workspaceId: OUTRO_WS, linkId: OUTRO_LINK })],
      [clique({ id: 'f', createdAt: new Date('xx') })],
      [
        clique({ id: 'g', workspaceId: OUTRO_WS }),
        clique({ id: 'h', linkId: OUTRO_LINK }),
        clique({ id: 'i', createdAt: new Date(VENDA_EM.getTime() + 5) }),
      ],
    ]
    for (const cliques of inelegiveis) {
      const r = atribuir(cliques)
      assert.equal(r.clickEventId, null, `atribuição falsa em ${JSON.stringify(cliques.map((c) => c.id))}`)
      assert.equal(houveAtribuicao(r.metodo), false)
    }
  })

  test('o clique atribuído é SEMPRE um dos candidatos recebidos — nunca inventado', () => {
    const cliques = [clique({ id: 'c1' }), clique({ id: 'c2', createdAt: new Date('2026-09-21T11:30:00.000Z') })]
    const r = atribuir(cliques)
    assert.ok(cliques.some((c) => c.id === r.clickEventId))
  })

  test('a função é pura: não altera a lista recebida', () => {
    const cliques = [clique({ id: 'c1' }), clique({ id: 'c2' })]
    const copia = cliques.map((c) => ({ ...c }))
    atribuir(cliques)
    assert.deepEqual(cliques, copia)
  })

  test('o método devolvido é sempre um dos declarados', () => {
    for (const cliques of [[], [clique({ id: 'c1' })], [clique({ id: 'x', workspaceId: OUTRO_WS })]]) {
      assert.ok((METODOS_ATRIBUICAO as readonly string[]).includes(atribuir(cliques).metodo))
    }
  })

  test('todo resultado tem explicação — "não atribuído" também é auditável', () => {
    for (const cliques of [[], [clique({ id: 'c1' })], [clique({ id: 'x', linkId: OUTRO_LINK })]]) {
      assert.ok(atribuir(cliques).explicacao.length > 0)
    }
  })
})

// ── Fiação: consulta e rota ─────────────────────────────────────────────

describe('Bloco 2 — fiação no banco e na rota de clique', () => {
  const vendas = lerFonte('lib/vendas-comissoes.ts')

  test('a consulta de cliques filtra por workspace, link e data', () => {
    assert.match(vendas, /workspaceId: input\.workspaceId/)
    assert.match(vendas, /linkId: input\.linkId/)
    assert.match(vendas, /createdAt: \{ lt: input\.dataDaVenda \}/)
    assert.match(vendas, /tipo: 'clique'/)
  })

  test('a venda grava o método mesmo quando não houve atribuição', () => {
    assert.match(vendas, /clickEventId: atribuicao\.clickEventId/)
    assert.match(vendas, /attributionMethod: atribuicao\.metodo/)
  })

  test('falha ao ler cliques não derruba o registro da venda', () => {
    // A venda é o fato comercial; perdê-la porque a atribuição falhou seria
    // trocar um dado forte por um fraco.
    assert.match(vendas, /catch \(e\)[\s\S]{0,400}AMBIGUO_NAO_ATRIBUIDO/)
  })

  test('o clique deixou de ser fire-and-forget', () => {
    const rota = lerCodigo('app/api/l/[slug]/route.ts')
    assert.match(rota, /await prisma\.\$transaction/)
    assert.ok(!/\.catch\(\(\) => \{\}\)/.test(rota), 'erro engolido em silêncio esconde clique perdido')
    assert.match(rota, /console\.error/)
  })

  test('o workspace do evento vem do LINK, nunca da requisição', () => {
    const rota = lerFonte('app/api/l/[slug]/route.ts')
    assert.match(rota, /workspaceId: link\.workspaceId/)
  })

  test('o redirect acontece mesmo se o registro falhar', () => {
    const rota = lerFonte('app/api/l/[slug]/route.ts')
    const posCatch = rota.slice(rota.indexOf('} catch (e) {'))
    assert.match(posCatch, /NextResponse\.redirect\(link\.urlDestino\)/)
  })

  test('nenhum identificador de pessoa é gravado no clique', () => {
    const rota = lerCodigo('app/api/l/[slug]/route.ts')
    for (const proibido of ['x-forwarded-for', 'req.ip', 'cookie', 'fingerprint', 'user-agent']) {
      assert.ok(!rota.toLowerCase().includes(proibido), `clique não pode registrar ${proibido}`)
    }
  })
})

// ── Nada de ML nesta rodada ─────────────────────────────────────────────

describe('Esta rodada NÃO liga o ML', () => {
  test('nenhum feature snapshot é gerado por vendas ou cliques', () => {
    for (const arq of ['lib/vendas-comissoes.ts', 'lib/atribuicao-clique.ts', 'lib/proveniencia.ts', 'app/api/l/[slug]/route.ts']) {
      assert.ok(
        !/salvarFeatureSnapshot|registrarLabelNoSnapshot|mLFeatureSnapshot/.test(lerFonte(arq)),
        `${arq} não deve tocar o feature store nesta rodada`
      )
    }
  })

  test('nenhuma inferência promove dado a REAL_OPERATION', () => {
    const vendas = lerFonte('lib/vendas-comissoes.ts')
    // A única menção permitida é a declaração vinda de quem chama.
    assert.ok(!/= 'REAL_OPERATION'|\?\? 'REAL_OPERATION'/.test(vendas))
  })
})

// ── MICROCORREÇÃO: rota autenticada NÃO é prova de operação real ────────

describe('Correção 1 — separar origem do REGISTRO de evidência de OPERAÇÃO', () => {
  test('USER_REPORTED existe e NÃO conta como operação real', () => {
    assert.equal(ORIGEM_RELATADA_PELA_USUARIA, 'USER_REPORTED')
    assert.ok(ehOrigemDeRegistro('USER_REPORTED'))
    assert.equal(ehOperacaoReal('USER_REPORTED'), false)
  })

  test('USER_REPORTED não pertence às origens de ML', () => {
    // Se pertencesse, entraria na contagem do MLReadinessGate e um relato
    // sem evidência viraria amostra de treino.
    assert.ok(!(ML_DATA_ORIGINS as readonly string[]).includes('USER_REPORTED'))
  })

  test('NENHUMA rota pode declarar REAL_OPERATION', () => {
    assert.ok(!(ORIGENS_DECLARAVEIS_POR_ROTA as readonly string[]).includes('REAL_OPERATION'))
    assert.equal(podeSerDeclaradaPorRota('REAL_OPERATION'), false)
    assert.equal(podeSerDeclaradaPorRota('USER_REPORTED'), true)
  })

  test('VARREDURA: nenhuma rota do app escreve REAL_OPERATION', () => {
    // É a asserção central desta correção. "Veio da tela logada" prova quem
    // registrou, nunca que a venda aconteceu.
    const rotas = [
      'app/api/vendas/route.ts',
      'app/api/links/[id]/venda/route.ts',
    ]
    for (const rota of rotas) {
      const codigo = lerCodigo(rota)
      assert.ok(
        !/dataOrigin:\s*'REAL_OPERATION'/.test(codigo),
        `${rota} não pode declarar operação real — ela não tem como prová-la`
      )
      assert.match(codigo, /dataOrigin: 'USER_REPORTED'/, `${rota} precisa declarar USER_REPORTED`)
    }
  })

  test('venda criada pela tela, sem evidência externa, fica USER_REPORTED', () => {
    // Contrato de ponta a ponta lido do código: a rota declara USER_REPORTED,
    // e USER_REPORTED não é operação real. Logo a venda da tela não alimenta
    // o ML enquanto não houver evidência.
    assert.match(lerCodigo('app/api/vendas/route.ts'), /dataOrigin: 'USER_REPORTED'/)
    assert.equal(ehOperacaoReal('USER_REPORTED'), false)
  })

  test('as evidências aceitas estão declaradas, e nenhuma é "rota autenticada"', () => {
    assert.ok(EVIDENCIAS_ACEITAS_PARA_OPERACAO_REAL.length >= 4)
    for (const e of EVIDENCIAS_ACEITAS_PARA_OPERACAO_REAL) {
      assert.ok(!/ROTA|AUTENTICAD|SESSAO|LOGIN/i.test(e), `${e} não é evidência de operação comercial`)
    }
  })

  test('nenhuma promoção automática para REAL_OPERATION no código', () => {
    for (const arq of ['lib/proveniencia.ts', 'lib/vendas-comissoes.ts']) {
      const codigo = lerCodigo(arq)
      // Comparar com REAL_OPERATION e legitimo (`ehOperacaoReal`); ATRIBUIR
      // nao e. O regex distingue os dois casos.
      assert.ok(
        !/(?<![=!<>])=[^=]\s*'REAL_OPERATION'|\?\?\s*'REAL_OPERATION'|dataOrigin:\s*'REAL_OPERATION'/.test(codigo),
        `${arq} não pode promover nada a REAL_OPERATION nesta rodada`
      )
    }
  })

  test('toda origem — inclusive USER_REPORTED — tem descrição', () => {
    for (const o of ORIGENS_DE_REGISTRO) {
      assert.ok(DESCRICAO_DA_ORIGEM[o]?.length > 0, `falta descrição para ${o}`)
    }
    assert.match(DESCRICAO_DA_ORIGEM.USER_REPORTED, /não|NÃO/)
  })

  test('UNVERIFIED continua sendo o default do banco', () => {
    assert.equal(ORIGEM_NAO_VERIFICADA, 'UNVERIFIED')
    assert.match(lerFonte('prisma/schema.prisma'), /dataOrigin String @default\("UNVERIFIED"\)/)
  })
})

// ── MICROCORREÇÃO: validar a cadeia da venda ANTES de gravar ────────────

describe('Correção 2 — cadeia produto → link → conteúdo validada antes de gravar', () => {
  const vendas = lerCodigo('lib/vendas-comissoes.ts')

  test('a validação roda ANTES do atalho de idempotência', () => {
    // Um reenvio com cadeia incoerente tem de falhar igual ao primeiro
    // envio; devolver a venda anterior calada esconderia o erro.
    const corpo = vendas.slice(vendas.indexOf('export async function registrarResultado'))
    const posValidacao = corpo.indexOf('await validarCadeiaDaVenda(input)')
    const posIdempotencia = corpo.indexOf('if (input.idempotencyKey)')
    assert.ok(posValidacao > 0, 'registrarResultado precisa validar a cadeia')
    assert.ok(posValidacao < posIdempotencia, 'a validação não pode ficar depois da idempotência')
  })

  test('link é conferido contra workspace E produto', () => {
    assert.match(vendas, /link\.workspaceId !== input\.workspaceId/)
    assert.match(vendas, /link\.produtoId !== input\.productId/)
  })

  test('conteúdo é conferido contra workspace E produto', () => {
    assert.match(vendas, /conteudo\.workspaceId !== input\.workspaceId/)
    assert.match(vendas, /conteudo\.produtoId !== input\.productId/)
  })

  test('link inativo NÃO é rejeitado — e a regra está escrita', () => {
    // `ativo` diz se o link ainda redireciona, não se já produziu venda.
    assert.ok(!/link\.ativo/.test(vendas), 'rejeitar link inativo impediria registrar venda de campanha encerrada')
    assert.match(lerFonte('lib/vendas-comissoes.ts'), /LINK INATIVO É ACEITO, DE PROPÓSITO/)
  })

  test('a validação é feita no ponto único, não só na rota', () => {
    // Validar só na rota deixaria seed, script e chamada futura livres para
    // gravar venda com link de outro negócio.
    assert.match(vendas, /async function validarCadeiaDaVenda/)
  })

  test('erro de cadeia é tipado e vira 400, não 500', () => {
    assert.match(vendas, /export class CadeiaDaVendaInconsistente/)
    const rota = lerCodigo('app/api/vendas/route.ts')
    assert.match(rota, /e instanceof CadeiaDaVendaInconsistente/)
    assert.match(rota, /status: 400/)
  })

  test('id de outro workspace não é confirmado na mensagem', () => {
    // Dizer "existe, mas é de outro workspace" já vaza informação sobre o
    // outro negócio. As duas mensagens são iguais de propósito.
    assert.match(vendas, /'linkId', 'OUTRO_WORKSPACE', 'O link informado não existe\.'/)
    assert.match(vendas, /'contentId', 'OUTRO_WORKSPACE', 'O conteúdo informado não existe\.'/)
  })
})

describe('Correção — nada desta rodada alimenta ML', () => {
  test('nenhum arquivo tocado gera MLFeatureSnapshot', () => {
    const tocados = [
      'lib/proveniencia.ts',
      'lib/atribuicao-clique.ts',
      'lib/vendas-comissoes.ts',
      'app/api/vendas/route.ts',
      'app/api/links/[id]/venda/route.ts',
      'app/api/l/[slug]/route.ts',
    ]
    for (const arq of tocados) {
      assert.ok(
        !/salvarFeatureSnapshot|registrarLabelNoSnapshot|mLFeatureSnapshot|extrairFeaturesDeConteudo/.test(lerFonte(arq)),
        `${arq} não deve tocar o feature store`
      )
    }
  })

  test('com USER_REPORTED, a contagem de dado elegível para ML continua zero', () => {
    const origensDeVendaHoje = ['USER_REPORTED', 'TEST_FIXTURE', 'SEED', 'DEMO', 'SYNTHETIC_TEST', 'UNVERIFIED']
    assert.equal(origensDeVendaHoje.filter(ehOperacaoReal).length, 0)
  })
})
