/**
 * P1.2 — Motor de Seleção e Plano de Ação.
 *
 * A fila do P1.1 diz o que VALE. O plano diz o que FAZER — e as duas coisas
 * não coincidem: score alto com mídia bloqueada não rende nada hoje.
 *
 * Nenhum teste publica, gera conteúdo ou chama provider. Custo R$ 0,00.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '../lib/prisma'
import {
  ESTADOS_DO_PLANO,
  ESTADO_QUE_EXECUTA,
  PROXIMAS_ACOES,
  FORMATOS,
  PREFERENCIA_DE_CANAL,
  MAXIMO_POR_PRODUTO,
  MAXIMO_POR_CATEGORIA,
  VANTAGEM_MATERIAL,
  TAMANHO_DO_PLANO,
  PLANO_NAO_EXECUTA,
  calcularPrioridadeOperacional,
  aplicarDiversidade,
  escolherCanalEFormato,
  derivarEstadoEAcao,
  montarPlanoDeAcao,
} from '../lib/plano-de-acao'
import { montarFilaDeOportunidades, type OportunidadePontuada } from '../lib/motor-de-oportunidades'
import { capacidadeDoCanal } from '../lib/channel-registry'

const TEM_BANCO = !!process.env.DATABASE_URL
const RAIZ = join(__dirname, '..')
const lerCodigo = (rel: string) =>
  readFileSync(join(RAIZ, rel), 'utf8')
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n')

const AGORA = new Date('2026-09-22T12:00:00.000Z')
const SO_FFMPEG = { FFMPEG: true }

/** Oportunidade de mentira — pura, para exercitar a seleção sem banco. */
function op(over: Partial<OportunidadePontuada> = {}): OportunidadePontuada {
  return {
    workspaceId: 'ws-1',
    produtoId: 'p1',
    produtoNome: 'Produto 1',
    provider: null,
    categoria: 'eletronicos',
    origem: 'MANUAL',
    score: 70,
    componentes: {
      externalMarketSignals: 70,
      automationFeasibility: 70,
      historicalPerformance: null,
      mlPrediction: null,
      aderenciaAoPerfil: null,
      base: 70,
      cobertura: 0.7,
      final: 70,
      motivos: [],
      decisionType: 'RULE_BASED',
    },
    desempenho: {
      nota: null,
      taxaConversao: null,
      receitaPorClique: null,
      cliques: 0,
      vendasElegiveis: 0,
      publicacoesRecentes: 0,
      fatorDeSaturacao: 1,
      partes: [],
    },
    classificacao: 'PRONTA_PARA_PUBLICACAO',
    motivosDeProntidao: [],
    canaisElegiveis: ['instagram'],
    confianca: 'MEDIA',
    dadosUsados: ['preco'],
    dadosAusentes: [],
    porqueDestaPosicao: ['motivo de teste'],
    receitaPotencialEstimada: null,
    baseDaEstimativa: 'SEM_BASE_REAL_SUFICIENTE',
    ...over,
  }
}

// ── Escopo ──────────────────────────────────────────────────────────────

describe('Escopo: o plano planeja, não executa', () => {
  test('os estados do plano estão declarados', () => {
    assert.deepEqual([...ESTADOS_DO_PLANO], [
      'PRONTO_PARA_GERAR_CONTEUDO',
      'AGUARDANDO_MIDIA_AUTORIZADA',
      'AGUARDANDO_CANAL',
      'AGUARDANDO_DADO',
      'AGUARDANDO_CAPACIDADE',
      'NAO_ELEGIVEL',
    ])
    assert.equal(ESTADO_QUE_EXECUTA, 'PRONTO_PARA_GERAR_CONTEUDO')
  })

  test('a não-execução é declarada', () => {
    assert.equal(PLANO_NAO_EXECUTA.estado, 'DELIBERADAMENTE_FORA_DE_ESCOPO')
    assert.equal(PLANO_NAO_EXECUTA.desbloqueiaCom, 'REVENUE_AUTOPILOT')
  })

  test('o módulo NÃO publica, não gera conteúdo e não chama provider', () => {
    const codigo = lerCodigo('lib/plano-de-acao.ts')
    for (const proibido of [
      'prepararTentativaDePublicacao', 'confirmarDistribuicao', 'publicarReel',
      'prisma.', 'fetch(', 'anthropic', 'falai', 'runAutopilot', 'promoverModelo',
    ]) {
      assert.ok(!codigo.includes(proibido), `${proibido} não pode aparecer`)
    }
  })

  test('o plano é função PURA — sem relógio nem aleatoriedade internos', () => {
    const codigo = lerCodigo('lib/plano-de-acao.ts')
    assert.ok(!codigo.includes('Math.random'))
    assert.ok(!codigo.includes('Date.now()'))
    assert.ok(!/new Date\(\)/.test(codigo), 'o instante entra por parâmetro')
  })
})

// ── Formatos e canais ───────────────────────────────────────────────────

describe('Formatos — só o que o projeto realmente faz', () => {
  test('todo formato aponta para uma exigência de canal existente', () => {
    const cap = capacidadeDoCanal('instagram')!
    for (const f of FORMATOS) {
      assert.ok(f.exigeDoCanal.length > 0, `${f.formato} sem exigência de canal`)
      for (const c of f.exigeDoCanal) {
        assert.ok(c in cap, `${f.formato} exige campo inexistente: ${c}`)
      }
      assert.ok(f.explicacao.length > 0)
    }
  })

  test('o único formato pago está marcado como pago', () => {
    const pagos = FORMATOS.filter((f) => f.provedorPago !== null)
    assert.deepEqual(pagos.map((f) => f.formato), ['VIDEO_IA_GERADO'])
    assert.equal(pagos[0].provedorPago, 'fal.ai')
  })

  test('vídeo aceita reel OU shortVideo — o mesmo formato, nome diferente por canal', () => {
    const video = FORMATOS.find((f) => f.formato === 'VIDEO_9X16_FFMPEG_NARRADO')!
    assert.deepEqual(video.exigeDoCanal, ['reel', 'shortVideo'])
  })

  test('TEXTO_COM_LINK é o único que não exige mídia autorizada', () => {
    const semMidia = FORMATOS.filter((f) => !f.exigeMidiaAutorizada)
    assert.deepEqual(semMidia.map((f) => f.formato), ['TEXTO_COM_LINK'])
  })

  test('TikTok é prioridade nº 1 na ordem estratégica', () => {
    assert.equal(PREFERENCIA_DE_CANAL[0], 'tiktok')
  })
})

describe('Canal — respeita o que a API realmente permite', () => {
  test('canal sem adapter real, com FFmpeg: formato de vídeo gratuito', () => {
    const e = escolherCanalEFormato(op(), ['facebook'], SO_FFMPEG)
    assert.equal(e.canal, 'facebook')
    assert.equal(e.formato, 'VIDEO_9X16_FFMPEG_NARRADO')
    assert.equal(e.custo, 0)
    assert.equal(e.dependenciaExterna, null)
  })

  test('P1.9.2 — Instagram: só o que o adapter real publica, e hoje isso é o vídeo da dona', () => {
    // O adapter do Instagram publica Reel com vídeo. A fábrica entrega copy
    // (TEXTO_COM_LINK) ou copy sem vídeo (FFMPEG, render não ligado à peça).
    // Nenhum dos dois iria ao ar: o plano espera pelo vídeo da dona.
    const e = escolherCanalEFormato(op(), ['instagram'], SO_FFMPEG)
    assert.equal(e.canal, 'instagram')
    assert.equal(e.formato, 'VIDEO_PROPRIO')
    assert.equal(e.dependenciaExterna, 'MIDIA_DA_DONA')
    assert.ok(e.bloqueios.includes('MIDIA_PROPRIA_AUSENTE'))
    assert.ok(e.bloqueios.includes('FORMATO_NAO_PUBLICAVEL_PELO_ADAPTER:instagram:TEXTO_COM_LINK'))
    assert.ok(e.bloqueios.includes('FABRICA_NAO_ENTREGA_MIDIA:instagram:VIDEO_9X16_FFMPEG_NARRADO'))
  })

  test('TikTok vence Instagram quando os dois estão conectados', () => {
    const e = escolherCanalEFormato(op(), ['instagram', 'tiktok'], SO_FFMPEG)
    assert.equal(e.canal, 'tiktok', 'prioridade estratégica nº 1')
  })

  test('TikTok NÃO é forçado a publicar sozinho — vira rascunho', () => {
    // P2.17.10: a plataforma permite Direct Post, mas só com a auditoria
    // confirmada — sem ela, continua rascunho para confirmação no canal.
    const cap = capacidadeDoCanal('tiktok')!
    assert.equal(cap.autoPublish, true, 'a plataforma permite, com auditoria')
    // Com o adapter real (só vídeo), o TikTok espera primeiro o vídeo da dona —
    // nunca vira publicação automática sem dependência.
    const e = escolherCanalEFormato(op(), ['tiktok'], SO_FFMPEG)
    assert.notEqual(e.dependenciaExterna, null)
    assert.ok(['MIDIA_DA_DONA', 'CONFIRMACAO_NO_CANAL'].includes(String(e.dependenciaExterna)))
  })

  test('CANAL DESCONECTADO vira dependência, não erro', () => {
    const e = escolherCanalEFormato(op(), [], SO_FFMPEG)
    assert.equal(e.canal, null)
    assert.deepEqual(e.bloqueios, ['SEM_CANAL_CONECTADO'])
    assert.equal(e.dependenciaExterna, 'CONECTAR_CANAL')
  })

  test('CUSTO PAGO bloqueia — e prefere o fallback gratuito', () => {
    // Sem FFMPEG declarado, o formato gratuito de vídeo sai de cena e o
    // pago seria o próximo. Ele não é escolhido.
    const e = escolherCanalEFormato(op(), ['facebook'], {})
    assert.notEqual(e.formato, 'VIDEO_IA_GERADO', 'nunca escolhe o pago sozinho')
    assert.equal(e.custo, 0)
    // A partir da rodada 45 o laço varre os formatos na ordem da FÁBRICA e
    // retorna no primeiro produzível. VIDEO_IA_GERADO ficou no fim e não
    // chega a ser avaliado, então não há bloqueio de custo a registrar —
    // o motivo de não escolhê-lo passou a ser "havia opção melhor antes".
    // A garantia que importa continua: o pago nunca é escolhido sozinho.
    assert.ok(e.formato === null || e.formato === 'TEXTO_COM_LINK')
  })

  test('capacidade ausente é registrada como bloqueio nomeado', () => {
    const e = escolherCanalEFormato(op(), ['facebook'], {})
    assert.ok(e.bloqueios.some((b) => b === 'CAPACIDADE_AUSENTE:FFMPEG'))
  })

  test('Digital Twin só entra quando a GPU é declarada', () => {
    const semGpu = escolherCanalEFormato(op(), ['instagram'], { FFMPEG: false })
    assert.notEqual(semGpu.formato, 'VIDEO_DIGITAL_TWIN')
    // E COM a GPU declarada também não entra: desde a rodada 45 a fábrica é
    // a autoridade, e não existe caminho de geração para o Digital Twin.
    const comGpu = escolherCanalEFormato(op(), ['instagram'], { DIGITAL_TWIN_GPU: true })
    assert.notEqual(comGpu.formato, 'VIDEO_DIGITAL_TWIN')
  })

  test('mídia bloqueada cai para TEXTO_COM_LINK, não some', () => {
    const e = escolherCanalEFormato(
      op({ motivosDeProntidao: ['MIDIA_SEM_DIREITO'], classificacao: 'OPORTUNIDADE_COMERCIAL' }),
      ['facebook'],
      SO_FFMPEG
    )
    assert.equal(e.formato, 'TEXTO_COM_LINK')
    assert.ok(e.bloqueios.includes('MIDIA_SEM_DIREITO'))
  })
})

// ── Prioridade operacional ──────────────────────────────────────────────

describe('Prioridade operacional ≠ score', () => {
  test('pronta supera comercial bloqueada com scores próximos', () => {
    const pronta = op({ produtoId: 'pronta', score: 70, classificacao: 'PRONTA_PARA_PUBLICACAO' })
    const bloqueada = op({
      produtoId: 'bloqueada', score: 85,
      classificacao: 'OPORTUNIDADE_COMERCIAL',
      motivosDeProntidao: ['MIDIA_SEM_DIREITO'],
    })
    assert.ok(
      calcularPrioridadeOperacional(pronta) > calcularPrioridadeOperacional(bloqueada),
      'o que dá para fazer hoje vale mais'
    )
  })

  test('NAO_ELEGIVEL zera a prioridade, por maior que seja o score', () => {
    assert.equal(calcularPrioridadeOperacional(op({ score: 100, classificacao: 'NAO_ELEGIVEL' })), 0)
  })

  test('SATURADO perde para um score menor não saturado', () => {
    const saturado = op({
      produtoId: 'saturado', score: 90,
      desempenho: { ...op().desempenho, fatorDeSaturacao: 0.5, publicacoesRecentes: 9 },
    })
    const limpo = op({ produtoId: 'limpo', score: 60 })
    assert.ok(
      calcularPrioridadeOperacional(limpo) > calcularPrioridadeOperacional(saturado),
      'maior score não vence sempre'
    )
  })

  test('SEM_HISTORICO_REAL pesa mais que BAIXA — desconhecido não é ruim', () => {
    const novo = op({ confianca: 'SEM_HISTORICO_REAL' })
    const ruim = op({ confianca: 'BAIXA' })
    assert.ok(calcularPrioridadeOperacional(novo) > calcularPrioridadeOperacional(ruim))
  })
})

// ── Diversidade ─────────────────────────────────────────────────────────

describe('Diversidade e saturação', () => {
  test('o MESMO produto não aparece duas vezes', () => {
    const { escolhidos, descartados } = aplicarDiversidade([
      op({ produtoId: 'a', score: 90 }),
      op({ produtoId: 'a', score: 88 }),
      op({ produtoId: 'b', score: 80, categoria: 'casa' }),
    ])
    assert.equal(escolhidos.filter((o) => o.produtoId === 'a').length, MAXIMO_POR_PRODUTO)
    assert.ok(descartados.some((d) => /repetir vira repetidor/.test(d.motivo)))
  })

  test('a categoria tem teto', () => {
    const { escolhidos } = aplicarDiversidade([
      op({ produtoId: 'a', score: 90, categoria: 'eletronicos' }),
      op({ produtoId: 'b', score: 89, categoria: 'eletronicos' }),
      op({ produtoId: 'c', score: 88, categoria: 'eletronicos' }),
      op({ produtoId: 'd', score: 50, categoria: 'casa' }),
    ])
    assert.equal(escolhidos.filter((o) => o.categoria === 'eletronicos').length, MAXIMO_POR_CATEGORIA)
    assert.ok(escolhidos.some((o) => o.categoria === 'casa'), 'a diversidade abre espaço para outra categoria')
  })

  test('o teto cede apenas com vantagem MATERIAL, e fica explicado', () => {
    const { escolhidos, descartados } = aplicarDiversidade([
      op({ produtoId: 'a', score: 50, categoria: 'eletronicos' }),
      op({ produtoId: 'b', score: 50, categoria: 'eletronicos' }),
      op({ produtoId: 'c', score: 50 + VANTAGEM_MATERIAL, categoria: 'eletronicos' }),
      op({ produtoId: 'd', score: 55, categoria: 'eletronicos' }),
    ])
    assert.ok(escolhidos.some((o) => o.produtoId === 'c'), 'vantagem material rompe o teto')
    assert.ok(descartados.some((d) => d.produtoId === 'd'), 'vantagem pequena não rompe')
    assert.ok(descartados.find((d) => d.produtoId === 'd')!.motivo.includes(`${VANTAGEM_MATERIAL}`))
  })

  test('o plano respeita o tamanho e explica quem ficou de fora', () => {
    const muitos = Array.from({ length: TAMANHO_DO_PLANO + 3 }, (_, i) =>
      op({ produtoId: `p${i}`, categoria: `cat${i}`, score: 90 - i })
    )
    const { escolhidos, descartados } = aplicarDiversidade(muitos)
    assert.equal(escolhidos.length, TAMANHO_DO_PLANO)
    assert.equal(descartados.length, 3)
    for (const d of descartados) assert.ok(d.motivo.length > 0)
  })
})

// ── Estado e ação ───────────────────────────────────────────────────────

describe('Estado e próxima ação', () => {
  test('tudo em ordem = PRONTO_PARA_GERAR_CONTEUDO', () => {
    const e = escolherCanalEFormato(op(), ['facebook'], SO_FFMPEG)
    const r = derivarEstadoEAcao(op(), e)
    assert.equal(r.estado, 'PRONTO_PARA_GERAR_CONTEUDO')
    assert.equal(r.proximaAcao, 'GERAR_CONTEUDO')
  })

  test('sem destino = AGUARDANDO_DADO', () => {
    const o = op({ motivosDeProntidao: ['SEM_DESTINO'], classificacao: 'OPORTUNIDADE_COMERCIAL' })
    const r = derivarEstadoEAcao(o, escolherCanalEFormato(o, ['instagram'], SO_FFMPEG))
    assert.equal(r.estado, 'AGUARDANDO_DADO')
    assert.equal(r.proximaAcao, 'COMPLETAR_DADO_DO_PRODUTO')
  })

  test('sem canal = AGUARDANDO_CANAL', () => {
    const r = derivarEstadoEAcao(op(), escolherCanalEFormato(op(), [], SO_FFMPEG))
    assert.equal(r.estado, 'AGUARDANDO_CANAL')
    assert.equal(r.proximaAcao, 'CONECTAR_CANAL')
  })

  test('indisponível = NAO_ELEGIVEL, sem ação', () => {
    const o = op({ classificacao: 'NAO_ELEGIVEL', motivosDeProntidao: ['INDISPONIVEL'] })
    const r = derivarEstadoEAcao(o, escolherCanalEFormato(o, ['instagram'], SO_FFMPEG))
    assert.equal(r.estado, 'NAO_ELEGIVEL')
    assert.equal(r.proximaAcao, 'NENHUMA')
  })

  test('toda ação pertence ao vocabulário declarado', () => {
    const casos = [op(), op({ classificacao: 'NAO_ELEGIVEL' }), op({ motivosDeProntidao: ['SEM_DESTINO'] })]
    for (const o of casos) {
      for (const canais of [[], ['instagram']]) {
        const r = derivarEstadoEAcao(o, escolherCanalEFormato(o, canais, SO_FFMPEG))
        assert.ok((PROXIMAS_ACOES as readonly string[]).includes(r.proximaAcao))
        assert.ok((ESTADOS_DO_PLANO as readonly string[]).includes(r.estado))
      }
    }
  })
})

// ── O plano inteiro ─────────────────────────────────────────────────────

describe('Plano montado', () => {
  const fila = [
    op({ produtoId: 'a', score: 90, categoria: 'eletronicos' }),
    op({ produtoId: 'b', score: 80, categoria: 'casa' }),
    op({
      produtoId: 'c', score: 95, categoria: 'moda',
      classificacao: 'OPORTUNIDADE_COMERCIAL', motivosDeProntidao: ['MIDIA_SEM_DIREITO'],
    }),
  ]
  const plano = () =>
    montarPlanoDeAcao({
      workspaceId: 'ws-1',
      fila,
      canaisConectados: ['instagram'],
      capacidades: SO_FFMPEG,
      agora: AGORA,
    })

  test('IDEMPOTENTE: mesma entrada, mesmo plano', () => {
    assert.deepEqual(plano(), plano())
  })

  test('a pronta de score 90 vence a bloqueada de 95', () => {
    const p = plano()
    assert.equal(p.itens[0].produtoId, 'a')
    assert.ok(p.itens[0].prioridadeOperacional > p.itens.find((i) => i.produtoId === 'c')!.prioridadeOperacional)
  })

  test('score e prioridade aparecem SEPARADOS', () => {
    const p = plano()
    const c = p.itens.find((i) => i.produtoId === 'c')!
    assert.equal(c.scoreDaOportunidade, 95)
    assert.ok(c.prioridadeOperacional < 95, 'a prioridade desconta o bloqueio')
  })

  test('custo total é ZERO', () => {
    const p = plano()
    assert.equal(p.custoTotal, 0)
    for (const i of p.itens) assert.equal(i.custoEstimado, 0)
  })

  test('cada item traz canal, formato, motivo e próxima ação', () => {
    for (const i of plano().itens) {
      assert.ok(i.motivo.length > 0)
      assert.ok((PROXIMAS_ACOES as readonly string[]).includes(i.proximaAcao))
      assert.ok(typeof i.podeExecutarAutomaticamente === 'boolean')
      assert.ok(Array.isArray(i.bloqueios))
    }
  })

  test('dependência repetível entra na AUTOMATION QUEUE', () => {
    const p = montarPlanoDeAcao({
      workspaceId: 'ws-1',
      fila: [op({ produtoId: 'z', motivosDeProntidao: ['MIDIA_SEM_DIREITO'], classificacao: 'OPORTUNIDADE_COMERCIAL' })],
      canaisConectados: [],
      capacidades: SO_FFMPEG,
      agora: AGORA,
    })
    assert.equal(p.filaDeAutomacao.length, 1)
    assert.equal(p.filaDeAutomacao[0].dependencia, 'CONECTAR_CANAL')
    assert.equal(p.filaDeAutomacao[0].repetivel, true)
  })

  test('GERAR_CONTEUDO não vira pendência — é a própria execução', () => {
    const p = plano()
    assert.ok(!p.filaDeAutomacao.some((f) => f.dependencia === 'GERAR_CONTEUDO'))
  })

  test('WORKSPACE ISOLADO: oportunidade de outro negócio não entra', () => {
    const p = montarPlanoDeAcao({
      workspaceId: 'ws-1',
      fila: [...fila, op({ produtoId: 'intruso', workspaceId: 'ws-2', score: 100 })],
      canaisConectados: ['instagram'],
      capacidades: SO_FFMPEG,
      agora: AGORA,
    })
    assert.ok(!p.itens.some((i) => i.produtoId === 'intruso'))
    for (const i of p.itens) assert.equal(i.workspaceId, 'ws-1')
  })

  test('sem canal, nada pode executar automaticamente', () => {
    const p = montarPlanoDeAcao({
      workspaceId: 'ws-1', fila, canaisConectados: [], capacidades: SO_FFMPEG, agora: AGORA,
    })
    assert.equal(p.itens.filter((i) => i.podeExecutarAutomaticamente).length, 0)
    assert.ok(p.filaDeAutomacao.length > 0)
  })
})

// ── Banco: fila real → plano ────────────────────────────────────────────

const marca = `r35-${Date.now()}`
let wsA = ''
let wsB = ''
const criados: string[] = []

describe(
  'Do catálogo real ao plano',
  { skip: !TEM_BANCO ? 'DATABASE_URL ausente — exige Postgres' : false },
  () => {
    before(async () => {
      for (const n of ['A', 'B']) {
        const ws = await prisma.workspace.create({
          data: { name: `R35-${n}`, ownerId: `${marca}-${n}` },
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

      const criar = (ws: string, uid: string, over: Record<string, unknown>) =>
        prisma.produto.create({
          data: {
            workspaceId: ws, userId: uid, categoria: 'eletronicos',
            tipoVenda: 'Afiliado', origemConteudo: 'Proprio',
            linkProduto: 'https://loja.invalido/x', imagens: ['https://img.invalido/1.jpg'],
            preco: 150, status: 'ativo', ...over,
          } as never,
          select: { id: true },
        })

      await criar(wsA, uA, { nome: `${marca}-um` })
      await criar(wsA, uA, { nome: `${marca}-dois`, categoria: 'casa' })
      await criar(wsA, uA, { nome: `${marca}-sem-midia`, imagens: [] })
      await criar(wsB, uB, { nome: `${marca}-outro-ws` })
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

    test('a fila real vira plano, sem publicar nada', async () => {
      const fila = await montarFilaDeOportunidades({ workspaceId: wsA, agora: AGORA, canaisCapazes: ['instagram'] })
      const plano = montarPlanoDeAcao({
        workspaceId: wsA, fila, canaisConectados: ['instagram'], capacidades: SO_FFMPEG, agora: AGORA,
      })
      assert.ok(plano.itens.length > 0)
      assert.equal(plano.custoTotal, 0)

      assert.equal(await prisma.publicacao.count({ where: { workspaceId: wsA } }), 0)
      assert.equal(await prisma.conteudo.count({ where: { workspaceId: wsA } }), 0)
    })

    test('mídia sem direito NÃO vira plano de publicação com mídia', async () => {
      const fila = await montarFilaDeOportunidades({ workspaceId: wsA, agora: AGORA, canaisCapazes: ['instagram'] })
      const plano = montarPlanoDeAcao({
        workspaceId: wsA, fila, canaisConectados: ['instagram'], capacidades: SO_FFMPEG, agora: AGORA,
      })
      const semMidia = plano.itens.find((i) => i.produtoNome === `${marca}-sem-midia`)
      if (semMidia) {
        assert.notEqual(semMidia.formatoRecomendado, 'VIDEO_9X16_FFMPEG_NARRADO')
        assert.notEqual(semMidia.formatoRecomendado, 'CARROSSEL')
        assert.ok(semMidia.bloqueios.includes('MIDIA_SEM_DIREITO'))
      }
    })

    test('diversidade por categoria funciona com dado real', async () => {
      const fila = await montarFilaDeOportunidades({ workspaceId: wsA, agora: AGORA, canaisCapazes: ['instagram'] })
      const plano = montarPlanoDeAcao({
        workspaceId: wsA, fila, canaisConectados: ['instagram'], capacidades: SO_FFMPEG, agora: AGORA,
      })
      const porCategoria = new Map<string, number>()
      for (const i of plano.itens) porCategoria.set(i.categoria, (porCategoria.get(i.categoria) ?? 0) + 1)
      for (const [cat, n] of porCategoria) {
        assert.ok(n <= MAXIMO_POR_CATEGORIA + 1, `categoria ${cat} com ${n} itens`)
      }
      const produtos = plano.itens.map((i) => i.produtoId)
      assert.equal(new Set(produtos).size, produtos.length, 'nenhum produto repetido')
    })

    test('IDEMPOTENTE com dado real', async () => {
      const fila = await montarFilaDeOportunidades({ workspaceId: wsA, agora: AGORA, canaisCapazes: ['instagram'] })
      const a = montarPlanoDeAcao({ workspaceId: wsA, fila, canaisConectados: ['instagram'], capacidades: SO_FFMPEG, agora: AGORA })
      const b = montarPlanoDeAcao({ workspaceId: wsA, fila, canaisConectados: ['instagram'], capacidades: SO_FFMPEG, agora: AGORA })
      assert.deepEqual(a, b)
    })

    test('workspace isolado no caminho real', async () => {
      const filaA = await montarFilaDeOportunidades({ workspaceId: wsA, agora: AGORA, canaisCapazes: ['instagram'] })
      const planoB = montarPlanoDeAcao({
        workspaceId: wsB, fila: filaA, canaisConectados: ['instagram'], capacidades: SO_FFMPEG, agora: AGORA,
      })
      assert.deepEqual(planoB.itens, [], 'a fila de A não produz plano para B')
    })

    test('nenhum provider pago foi chamado e nada foi publicado', async () => {
      assert.equal(await prisma.publicacao.count({ where: { workspaceId: { in: criados } } }), 0)
      assert.equal(await prisma.conteudo.count({ where: { workspaceId: { in: criados } } }), 0)
      assert.equal(await prisma.mLFeatureSnapshot.count({ where: { workspaceId: { in: criados } } }), 0)
    })
  }
)
