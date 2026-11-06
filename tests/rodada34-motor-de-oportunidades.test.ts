/**
 * P1.1 — Motor de Oportunidades Reais.
 *
 * A fila responde duas perguntas DIFERENTES, e é isso que se prova aqui:
 *
 *   vale a pena vender isto?        → OPORTUNIDADE_COMERCIAL
 *   dá para publicar isto hoje?     → PRONTA_PARA_PUBLICACAO
 *
 * Nenhum teste chama provider, gera conteúdo ou publica. Custo R$ 0,00.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '../lib/prisma'
import {
  CLASSIFICACOES,
  NIVEIS_DE_CONFIANCA,
  MOTIVOS_NAO_PRONTA,
  ORIGENS_SINTETICAS,
  JANELA_DE_SATURACAO_DIAS,
  PUBLICACOES_ANTES_DE_SATURAR,
  CLIQUES_MINIMOS_PARA_HISTORICO,
  MOTOR_NAO_PUBLICA,
  origemDaOportunidade,
  calcularDesempenhoHistorico,
  classificarConfianca,
  classificarProntidao,
  estimarReceitaPotencial,
  pontuarProduto,
  montarFilaDeOportunidades,
  compararFilas,
  type ProdutoDoCatalogo,
  type ContextoDoWorkspace,
} from '../lib/motor-de-oportunidades'

const TEM_BANCO = !!process.env.DATABASE_URL
const RAIZ = join(__dirname, '..')
const lerCodigo = (rel: string) =>
  readFileSync(join(RAIZ, rel), 'utf8')
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n')

const AGORA = new Date('2026-09-22T12:00:00.000Z')
const CONTEXTO: ContextoDoWorkspace = { canaisCapazes: ['instagram'], agora: AGORA }

const produtoBase = (over: Partial<ProdutoDoCatalogo> = {}): ProdutoDoCatalogo => ({
  id: 'p1',
  nome: 'Carregador portátil',
  categoria: 'eletronicos',
  preco: 100,
  linkProduto: 'https://loja.invalido/p1',
  imagens: ['https://img.invalido/1.jpg'],
  // Origem que autoriza derivar mídia.
  origemConteudo: 'Proprio',
  origemDados: 'MANUAL',
  providerId: null,
  status: 'ativo',
  removidoDaOrigemEm: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  comissaoPercentual: 10,
  ...over,
})

const semHistorico = calcularDesempenhoHistorico({
  taxaConversao: null,
  receitaPorClique: null,
  cliques: 0,
  vendasElegiveis: 0,
  publicacoesRecentes: 0,
})

// ── Vocabulário e escopo ────────────────────────────────────────────────

describe('Escopo: o motor recomenda, não publica', () => {
  test('a fila distingue as três classificações', () => {
    assert.deepEqual([...CLASSIFICACOES], ['PRONTA_PARA_PUBLICACAO', 'OPORTUNIDADE_COMERCIAL', 'NAO_ELEGIVEL'])
  })

  test('SEM_HISTORICO_REAL é nível próprio, não "baixa"', () => {
    assert.ok((NIVEIS_DE_CONFIANCA as readonly string[]).includes('SEM_HISTORICO_REAL'))
    assert.notEqual('SEM_HISTORICO_REAL', 'BAIXA')
  })

  test('a não-publicação está declarada, não subentendida', () => {
    assert.equal(MOTOR_NAO_PUBLICA.estado, 'DELIBERADAMENTE_FORA_DE_ESCOPO')
    assert.equal(MOTOR_NAO_PUBLICA.desbloqueiaCom, 'REVENUE_AUTOPILOT')
  })

  test('o motor NÃO publica, não gera conteúdo e não chama provider pago', () => {
    for (const rel of ['lib/motor-de-oportunidades.ts', 'app/api/cron/oportunidades/route.ts']) {
      const codigo = lerCodigo(rel)
      for (const proibido of [
        'publicarReel', 'prepararTentativaDePublicacao', 'confirmarDistribuicao',
        'gerarVideo', 'fetch(', 'anthropic', 'falai', 'guardarChamadaPaga',
        'runAutopilot', 'promoverModelo', 'treinar',
      ]) {
        assert.ok(!codigo.includes(proibido), `${rel} não pode conter ${proibido}`)
      }
    }
  })

  test('o motor é somente LEITURA do catálogo', () => {
    const codigo = lerCodigo('lib/motor-de-oportunidades.ts')
    for (const escrita of ['prisma.produto.create', 'prisma.produto.update', 'prisma.conteudo.create', '.deleteMany']) {
      assert.ok(!codigo.includes(escrita), `${escrita} não pode aparecer`)
    }
  })

  test('não cria score concorrente — usa o motor que já existe', () => {
    const codigo = lerCodigo('lib/motor-de-oportunidades.ts')
    assert.match(codigo, /calcularOpportunityScoreComposto/)
    // A nota final vem de lá, não de uma soma local.
    assert.match(codigo, /score: componentes\.final/)
  })
})

// ── Proveniência ────────────────────────────────────────────────────────

describe('Nada sintético entra', () => {
  test('as origens sintéticas estão nomeadas e REAL_OPERATION não está entre elas', () => {
    assert.deepEqual([...ORIGENS_SINTETICAS].sort(), ['DEMO', 'SEED', 'SYNTHETIC_TEST', 'TEST_FIXTURE'])
    assert.ok(!(ORIGENS_SINTETICAS as readonly string[]).includes('REAL_OPERATION'))
  })

  test('a consulta exclui origem sintética', () => {
    const codigo = lerCodigo('lib/motor-de-oportunidades.ts')
    assert.match(codigo, /origemDados: \{ notIn: \[\.\.\.ORIGENS_SINTETICAS\] \}/)
  })

  test('origem desconhecida vira MANUAL, nunca OFFICIAL_API', () => {
    assert.equal(origemDaOportunidade('provider-que-nao-existe'), 'MANUAL')
    assert.equal(origemDaOportunidade(null), 'MANUAL')
    assert.equal(origemDaOportunidade(''), 'MANUAL')
    assert.equal(origemDaOportunidade('SHOPEE_API'), 'OFFICIAL_API')
    assert.equal(origemDaOportunidade('TIKTOK_SHOWCASE'), 'AFFILIATE_PORTAL_IMPORT')
  })
})

// ── Score ───────────────────────────────────────────────────────────────

describe('Score — explicável e determinístico', () => {
  test('comissão ALTA sobe o score', () => {
    const baixa = pontuarProduto(produtoBase({ comissaoPercentual: 2 }), semHistorico, CONTEXTO)
    const alta = pontuarProduto(produtoBase({ comissaoPercentual: 40 }), semHistorico, CONTEXTO)
    assert.ok(alta.score > baixa.score, `alta ${alta.score} devia superar baixa ${baixa.score}`)
  })

  test('preço maior com a mesma comissão sobe o score', () => {
    const barato = pontuarProduto(produtoBase({ preco: 20 }), semHistorico, CONTEXTO)
    const caro = pontuarProduto(produtoBase({ preco: 500 }), semHistorico, CONTEXTO)
    assert.ok(caro.score > barato.score)
  })

  test('histórico RUIM reduz o score', () => {
    const ruim = calcularDesempenhoHistorico({
      taxaConversao: 0.001, receitaPorClique: 0.01, cliques: 200, vendasElegiveis: 1, publicacoesRecentes: 0,
    })
    const bom = calcularDesempenhoHistorico({
      taxaConversao: 0.06, receitaPorClique: 3, cliques: 200, vendasElegiveis: 12, publicacoesRecentes: 0,
    })
    const comRuim = pontuarProduto(produtoBase(), ruim, CONTEXTO)
    const comBom = pontuarProduto(produtoBase(), bom, CONTEXTO)
    assert.ok(comRuim.score < comBom.score, `${comRuim.score} devia ser menor que ${comBom.score}`)
    assert.equal(ruim.nota! < bom.nota!, true)
  })

  test('IDEMPOTENTE: mesmos dados, mesmo score', () => {
    const p = produtoBase()
    const a = pontuarProduto(p, semHistorico, CONTEXTO)
    const b = pontuarProduto(p, semHistorico, CONTEXTO)
    const c = pontuarProduto({ ...p }, { ...semHistorico }, { ...CONTEXTO })
    assert.equal(a.score, b.score)
    assert.equal(b.score, c.score)
    assert.deepEqual(a.componentes, b.componentes)
  })

  test('mudança REAL nos dados muda o score', () => {
    const antes = pontuarProduto(produtoBase({ comissaoPercentual: 5 }), semHistorico, CONTEXTO)
    const depois = pontuarProduto(produtoBase({ comissaoPercentual: 25 }), semHistorico, CONTEXTO)
    assert.notEqual(antes.score, depois.score)
  })

  test('o score vem acompanhado dos componentes, nunca sozinho', () => {
    const o = pontuarProduto(produtoBase(), semHistorico, CONTEXTO)
    assert.ok(typeof o.componentes.externalMarketSignals === 'number')
    assert.ok(typeof o.componentes.automationFeasibility === 'number')
    assert.ok(o.porqueDestaPosicao.length > 0)
    assert.ok(o.dadosUsados.length > 0)
  })
})

describe('Saturação — publicar demais rende menos', () => {
  const base = { taxaConversao: 0.05, receitaPorClique: 2, cliques: 100, vendasElegiveis: 5 }

  test('até o limite não há penalidade', () => {
    const d = calcularDesempenhoHistorico({ ...base, publicacoesRecentes: PUBLICACOES_ANTES_DE_SATURAR })
    assert.equal(d.fatorDeSaturacao, 1)
  })

  test('acima do limite a nota cai', () => {
    const normal = calcularDesempenhoHistorico({ ...base, publicacoesRecentes: 0 })
    const saturado = calcularDesempenhoHistorico({ ...base, publicacoesRecentes: PUBLICACOES_ANTES_DE_SATURAR + 4 })
    assert.ok(saturado.fatorDeSaturacao < 1)
    assert.ok(saturado.nota! < normal.nota!)
    assert.ok(saturado.partes.some((p) => /satura/i.test(p)))
  })

  test('a penalidade tem piso — saturação não zera o produto', () => {
    const d = calcularDesempenhoHistorico({ ...base, publicacoesRecentes: 100 })
    assert.equal(d.fatorDeSaturacao, 0.5)
  })

  test('a janela está declarada', () => {
    assert.equal(JANELA_DE_SATURACAO_DIAS, 14)
  })
})

// ── Sem histórico ───────────────────────────────────────────────────────

describe('Produto novo continua elegível, com confiança menor', () => {
  test('poucos cliques = nota null, nunca 0', () => {
    const d = calcularDesempenhoHistorico({
      taxaConversao: 1, receitaPorClique: 99, cliques: CLIQUES_MINIMOS_PARA_HISTORICO - 1,
      vendasElegiveis: 1, publicacoesRecentes: 0,
    })
    assert.equal(d.nota, null, 'null é "não medido", 0 seria "medido e deu zero"')
    assert.ok(d.partes.some((p) => /sem base real/i.test(p)))
  })

  test('sem histórico ainda entra na fila e recebe score', () => {
    const o = pontuarProduto(produtoBase(), semHistorico, CONTEXTO)
    assert.ok(o.score > 0, 'produto novo não é descartado')
    assert.equal(o.confianca, 'SEM_HISTORICO_REAL')
    assert.equal(o.componentes.historicalPerformance, null)
  })

  test('SEM_HISTORICO_REAL não se mistura com desempenho ruim', () => {
    const ruim = calcularDesempenhoHistorico({
      taxaConversao: 0.0001, receitaPorClique: 0.001, cliques: 500, vendasElegiveis: 1, publicacoesRecentes: 0,
    })
    const comRuim = pontuarProduto(produtoBase(), ruim, CONTEXTO)
    assert.notEqual(comRuim.confianca, 'SEM_HISTORICO_REAL', 'este TEM histórico — ruim, mas tem')
  })

  test('a confiança sobe com origem oficial e dados completos', () => {
    assert.equal(classificarConfianca({ temHistoricoReal: true, dadosAusentes: [], origem: 'OFFICIAL_API' }), 'ALTA')
    assert.equal(classificarConfianca({ temHistoricoReal: true, dadosAusentes: [], origem: 'MANUAL' }), 'MEDIA')
    assert.equal(classificarConfianca({ temHistoricoReal: true, dadosAusentes: ['a', 'b', 'c'], origem: 'OFFICIAL_API' }), 'BAIXA')
    assert.equal(classificarConfianca({ temHistoricoReal: false, dadosAusentes: [], origem: 'OFFICIAL_API' }), 'SEM_HISTORICO_REAL')
  })
})

// ── Receita potencial ───────────────────────────────────────────────────

describe('Receita potencial — estimativa, nunca garantia', () => {
  test('sem base real devolve null', () => {
    assert.equal(estimarReceitaPotencial({ preco: null, comissaoPercentual: 10, taxaConversao: 0.02 }).valor, null)
    assert.equal(estimarReceitaPotencial({ preco: 100, comissaoPercentual: null, taxaConversao: 0.02 }).valor, null)
    assert.equal(estimarReceitaPotencial({ preco: 100, comissaoPercentual: 10, taxaConversao: null }).valor, null)
  })

  test('com base real, o valor vem rotulado como ESTIMATIVA', () => {
    const r = estimarReceitaPotencial({ preco: 100, comissaoPercentual: 10, taxaConversao: 0.02, cliquesEsperados: 100 })
    assert.equal(r.valor, 20)
    assert.match(r.base, /^ESTIMATIVA:/)
    assert.ok(!/garantid/i.test(r.base))
  })

  test('produto sem histórico não recebe estimativa', () => {
    const o = pontuarProduto(produtoBase(), semHistorico, CONTEXTO)
    assert.equal(o.receitaPotencialEstimada, null)
    assert.equal(o.baseDaEstimativa, 'SEM_BASE_REAL_SUFICIENTE')
  })
})

// ── Prontidão × oportunidade ────────────────────────────────────────────

describe('Oportunidade comercial NÃO é prontidão para publicar', () => {
  test('tudo em ordem = PRONTA_PARA_PUBLICACAO', () => {
    const o = pontuarProduto(produtoBase(), semHistorico, CONTEXTO)
    assert.equal(o.classificacao, 'PRONTA_PARA_PUBLICACAO')
    assert.deepEqual(o.motivosDeProntidao, [])
    assert.deepEqual(o.canaisElegiveis, ['instagram'])
  })

  test('mídia sem direito: continua OPORTUNIDADE_COMERCIAL', () => {
    // `origemConteudo` que não autoriza derivar.
    const o = pontuarProduto(produtoBase({ origemConteudo: 'TikTokShop' }), semHistorico, CONTEXTO)
    assert.equal(o.classificacao, 'OPORTUNIDADE_COMERCIAL')
    assert.ok(o.motivosDeProntidao.includes('MIDIA_SEM_DIREITO'))
    assert.ok(o.score > 0, 'o valor comercial não some por causa da mídia')
    assert.deepEqual(o.canaisElegiveis, [], 'mas nenhum canal fica elegível')
  })

  test('produto SEM imagem não vira pronta', () => {
    const o = pontuarProduto(produtoBase({ imagens: [] }), semHistorico, CONTEXTO)
    assert.equal(o.classificacao, 'OPORTUNIDADE_COMERCIAL')
    assert.ok(o.motivosDeProntidao.includes('MIDIA_SEM_DIREITO'))
  })

  test('produto INDISPONÍVEL não entra como pronto', () => {
    for (const over of [{ status: 'inativo' }, { removidoDaOrigemEm: AGORA }]) {
      const o = pontuarProduto(produtoBase(over), semHistorico, CONTEXTO)
      assert.equal(o.classificacao, 'NAO_ELEGIVEL')
      assert.deepEqual(o.motivosDeProntidao, ['INDISPONIVEL'])
    }
  })

  test('sem destino não vira pronta', () => {
    const o = pontuarProduto(produtoBase({ linkProduto: null }), semHistorico, CONTEXTO)
    assert.ok(o.motivosDeProntidao.includes('SEM_DESTINO'))
    assert.notEqual(o.classificacao, 'PRONTA_PARA_PUBLICACAO')
  })

  test('sem canal capaz não vira pronta', () => {
    const o = pontuarProduto(produtoBase(), semHistorico, { canaisCapazes: [], agora: AGORA })
    assert.ok(o.motivosDeProntidao.includes('SEM_CANAL_CAPAZ'))
  })

  test('todo motivo pertence à lista declarada', () => {
    const o = pontuarProduto(
      produtoBase({ linkProduto: null, imagens: [] }),
      semHistorico,
      { canaisCapazes: [], agora: AGORA }
    )
    for (const m of o.motivosDeProntidao) {
      assert.ok((MOTIVOS_NAO_PRONTA as readonly string[]).includes(m))
    }
    assert.ok(o.motivosDeProntidao.length >= 3)
  })

  test('indisponível curto-circuita: não lista motivos que não importam', () => {
    const v = classificarProntidao({
      disponivel: false, temDestino: false, midiaAutorizada: false,
      motivoDaMidia: 'x', canaisCapazes: [],
    })
    assert.deepEqual(v.motivos, ['INDISPONIVEL'])
  })
})

// ── Mudança na fila ─────────────────────────────────────────────────────

describe('Detecção de mudança — o cron avisa só o que mudou', () => {
  test('produto novo aparece como novo', () => {
    const r = compararFilas([{ produtoId: 'a', score: 50 }], [{ produtoId: 'a', score: 50 }, { produtoId: 'b', score: 70 }])
    assert.deepEqual(r.novas, ['b'])
  })

  test('queda e alta são detectadas acima do limiar', () => {
    const r = compararFilas(
      [{ produtoId: 'a', score: 80 }, { produtoId: 'b', score: 40 }],
      [{ produtoId: 'a', score: 60 }, { produtoId: 'b', score: 65 }]
    )
    assert.deepEqual(r.queda, [{ produtoId: 'a', de: 80, para: 60 }])
    assert.deepEqual(r.alta, [{ produtoId: 'b', de: 40, para: 65 }])
  })

  test('variação pequena não vira alerta', () => {
    const r = compararFilas([{ produtoId: 'a', score: 50 }], [{ produtoId: 'a', score: 55 }])
    assert.deepEqual(r.queda, [])
    assert.deepEqual(r.alta, [])
  })
})

// ── Banco ───────────────────────────────────────────────────────────────

const marca = `r34-${Date.now()}`
let wsA = ''
let wsB = ''
const criados: string[] = []

describe(
  'Fila real do catálogo',
  { skip: !TEM_BANCO ? 'DATABASE_URL ausente — exige Postgres' : false },
  () => {
    before(async () => {
      for (const n of ['A', 'B']) {
        const ws = await prisma.workspace.create({
          data: { name: `R34-${n}`, ownerId: `${marca}-${n}` },
          select: { id: true },
        })
        criados.push(ws.id)
      }
      ;[wsA, wsB] = criados

      const criarUser = async (ws: string, s: string) =>
        (
          await prisma.user.create({
            data: { email: `${marca}-${s}@teste.local`, name: 'U', password: 'x', workspaceId: ws },
            select: { id: true },
          })
        ).id
      const uA = await criarUser(wsA, 'a')
      const uB = await criarUser(wsB, 'b')

      const criar = async (ws: string, uid: string, over: Record<string, unknown>) =>
        prisma.produto.create({
          data: {
            workspaceId: ws, userId: uid, categoria: 'eletronicos',
            tipoVenda: 'Afiliado', origemConteudo: 'Proprio',
            linkProduto: 'https://loja.invalido/x', imagens: ['https://img.invalido/1.jpg'],
            preco: 100, status: 'ativo',
            ...over,
          } as never,
          select: { id: true },
        })

      await criar(wsA, uA, { nome: `${marca}-comissao-alta` })
      await criar(wsA, uA, { nome: `${marca}-sem-imagem`, imagens: [] })
      await criar(wsA, uA, { nome: `${marca}-inativo`, status: 'inativo' })
      await criar(wsA, uA, { nome: `${marca}-descartado`, status: 'descartado' })
      await criar(wsA, uA, { nome: `${marca}-sintetico`, origemDados: 'SEED' })
      await criar(wsA, uA, { nome: `${marca}-demo`, origemDados: 'DEMO' })
      await criar(wsB, uB, { nome: `${marca}-do-outro-workspace` })
    })

    after(async () => {
      for (const ws of criados) {
        await prisma.linkDinamico.deleteMany({ where: { workspaceId: ws } })
        await prisma.conteudo.deleteMany({ where: { workspaceId: ws } })
        await prisma.produto.deleteMany({ where: { workspaceId: ws } })
        await prisma.user.deleteMany({ where: { workspaceId: ws } })
      }
      await prisma.workspace.deleteMany({ where: { id: { in: criados } } })
      await prisma.$disconnect()
    })

    test('produto SINTÉTICO não entra na fila', async () => {
      const fila = await montarFilaDeOportunidades({ workspaceId: wsA, agora: AGORA, canaisCapazes: ['instagram'] })
      const nomes = fila.map((o) => o.produtoNome)
      assert.ok(!nomes.includes(`${marca}-sintetico`), 'SEED não pode virar oportunidade')
      assert.ok(!nomes.includes(`${marca}-demo`), 'DEMO não pode virar oportunidade')
    })

    test('produto DESCARTADO não entra na fila', async () => {
      const fila = await montarFilaDeOportunidades({ workspaceId: wsA, agora: AGORA, canaisCapazes: ['instagram'] })
      assert.ok(!fila.map((o) => o.produtoNome).includes(`${marca}-descartado`))
    })

    test('WORKSPACE ISOLADO: nada do outro negócio aparece', async () => {
      const deA = await montarFilaDeOportunidades({ workspaceId: wsA, agora: AGORA, canaisCapazes: ['instagram'] })
      const deB = await montarFilaDeOportunidades({ workspaceId: wsB, agora: AGORA, canaisCapazes: ['instagram'] })

      assert.ok(!deA.map((o) => o.produtoNome).includes(`${marca}-do-outro-workspace`))
      assert.ok(deB.map((o) => o.produtoNome).includes(`${marca}-do-outro-workspace`))
      for (const o of deA) assert.equal(o.workspaceId, wsA)
      for (const o of deB) assert.equal(o.workspaceId, wsB)
    })

    test('a fila vem ordenada por score, do maior para o menor', async () => {
      const fila = await montarFilaDeOportunidades({ workspaceId: wsA, agora: AGORA, canaisCapazes: ['instagram'] })
      assert.ok(fila.length >= 3)
      for (let i = 1; i < fila.length; i++) {
        assert.ok(fila[i - 1].score >= fila[i].score, 'a ordem tem de ser decrescente')
      }
    })

    test('produto inativo entra como NAO_ELEGIVEL, não como pronto', async () => {
      const fila = await montarFilaDeOportunidades({ workspaceId: wsA, agora: AGORA, canaisCapazes: ['instagram'] })
      const inativo = fila.find((o) => o.produtoNome === `${marca}-inativo`)
      assert.ok(inativo)
      assert.equal(inativo!.classificacao, 'NAO_ELEGIVEL')
      assert.deepEqual(inativo!.canaisElegiveis, [])
    })

    test('produto sem imagem fica comercial, não pronto', async () => {
      const fila = await montarFilaDeOportunidades({ workspaceId: wsA, agora: AGORA, canaisCapazes: ['instagram'] })
      const semImagem = fila.find((o) => o.produtoNome === `${marca}-sem-imagem`)
      assert.ok(semImagem)
      assert.equal(semImagem!.classificacao, 'OPORTUNIDADE_COMERCIAL')
      assert.ok(semImagem!.motivosDeProntidao.includes('MIDIA_SEM_DIREITO'))
    })

    test('IDEMPOTENTE no banco: duas execuções, mesma fila', async () => {
      const a = await montarFilaDeOportunidades({ workspaceId: wsA, agora: AGORA, canaisCapazes: ['instagram'] })
      const b = await montarFilaDeOportunidades({ workspaceId: wsA, agora: AGORA, canaisCapazes: ['instagram'] })
      assert.deepEqual(
        a.map((o) => [o.produtoId, o.score]),
        b.map((o) => [o.produtoId, o.score])
      )
      assert.deepEqual(compararFilas(a, b), { novas: [], queda: [], alta: [] })
    })

    test('sem canal conectado, NADA fica pronto para publicação', async () => {
      const fila = await montarFilaDeOportunidades({ workspaceId: wsA, agora: AGORA, canaisCapazes: [] })
      assert.ok(fila.length > 0, 'a fila comercial continua existindo')
      assert.equal(fila.filter((o) => o.classificacao === 'PRONTA_PARA_PUBLICACAO').length, 0)
    })

    test('cada oportunidade vem explicada', async () => {
      const fila = await montarFilaDeOportunidades({ workspaceId: wsA, agora: AGORA, canaisCapazes: ['instagram'] })
      for (const o of fila) {
        assert.ok(o.porqueDestaPosicao.length > 0, `${o.produtoNome} sem explicação`)
        assert.ok((CLASSIFICACOES as readonly string[]).includes(o.classificacao))
        assert.ok((NIVEIS_DE_CONFIANCA as readonly string[]).includes(o.confianca))
        assert.ok(Array.isArray(o.dadosUsados) && Array.isArray(o.dadosAusentes))
        assert.equal(o.componentes.mlPrediction, null, 'nenhum ML treinado nesta rodada')
      }
    })

    test('workspace sem produto devolve fila vazia, não erro', async () => {
      const fila = await montarFilaDeOportunidades({ workspaceId: 'workspace-que-nao-existe', agora: AGORA })
      assert.deepEqual(fila, [])
    })

    test('nenhuma publicação foi criada por este motor', async () => {
      const publicacoes = await prisma.publicacao.count({ where: { workspaceId: { in: criados } } })
      assert.equal(publicacoes, 0)
      const conteudos = await prisma.conteudo.count({ where: { workspaceId: { in: criados } } })
      assert.equal(conteudos, 0)
    })
  }
)
