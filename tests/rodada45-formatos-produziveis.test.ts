/**
 * Fechamento das pendências do relatório noturno.
 *
 * 1. O plano nunca escolhe como execução automática um formato que a
 *    fábrica não produz — e quando nenhum produzível serve, o item vai para
 *    AGUARDANDO_CAPACIDADE em vez de virar execução fantasma.
 * 2. `SINCRONIZAR_MIDIA_AUTORIZADA` deixa de consumir retry enquanto não
 *    tiver executor.
 *
 * Sem provider pago. Sem publicação. Custo R$ 0,00.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ORDEM_DE_PRODUCAO,
  FORMATOS_NAO_PRODUZIDOS,
  ehFormatoProduzivel,
  motivoNaoProduzido,
  posicaoNaProducao,
  PLANO_SO_ESCOLHE_O_QUE_A_FABRICA_PRODUZ,
  ehFormatoDaDona,
} from '../lib/capacidades-da-fabrica'
import {
  FORMATOS,
  FORMATOS_POR_PRODUCAO,
  escolherCanalEFormato,
  derivarEstadoEAcao,
  montarPlanoDeAcao,
} from '../lib/plano-de-acao'
import {
  ehFormatoGratuito,
  FORMATOS_GRATUITOS,
  avaliarCapacidade,
  jobsDeGeracaoDoPlano,
  jobsDeLacunaDeFormato,
} from '../lib/fabrica-de-conteudo'
import { perfilDaDependencia, podeExecutarSozinho } from '../lib/automation-queue-contrato'
import { acoesDoExecutor } from '../lib/executor-da-fila'
import type { OportunidadePontuada } from '../lib/motor-de-oportunidades'

const RAIZ = join(__dirname, '..')

/** Oportunidade pronta: sem bloqueio, mídia autorizada, destino existente. */
const oport = (over: Partial<OportunidadePontuada> = {}): OportunidadePontuada =>
  ({
    workspaceId: 'ws-1',
    produtoId: 'p-1',
    produtoNome: 'Produto',
    categoria: 'casa',
    score: 50,
    classificacao: 'PRONTA_PARA_PUBLICACAO',
    confianca: 'SEM_HISTORICO_REAL',
    motivosDeProntidao: [],
    porqueDestaPosicao: [],
    dadosAusentes: [],
    receitaPotencialEstimada: null,
    baseDaEstimativa: null,
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
    ...over,
  }) as unknown as OportunidadePontuada

// ── A autoridade ────────────────────────────────────────────────────────

describe('Uma autoridade só decide o que a fábrica produz', () => {
  test('a ordem de produção é a declarada, e só ela', () => {
    assert.deepEqual([...ORDEM_DE_PRODUCAO], ['VIDEO_9X16_FFMPEG_NARRADO', 'TEXTO_COM_LINK'])
  })

  test('o nome histórico aponta para a MESMA lista, sem cópia', () => {
    // Se alguém duplicar a lista, este teste quebra — é o ponto dele.
    assert.equal(FORMATOS_GRATUITOS, ORDEM_DE_PRODUCAO, 'mesma referência, não uma cópia')
    for (const f of ORDEM_DE_PRODUCAO) assert.equal(ehFormatoGratuito(f), ehFormatoProduzivel(f))
  })

  test('o planejador não redeclara a lista: ele importa a autoridade', () => {
    const codigo = readFileSync(join(RAIZ, 'lib/plano-de-acao.ts'), 'utf8')
    assert.match(codigo, /from '\.\/capacidades-da-fabrica'/)
    assert.ok(
      !codigo.includes("'VIDEO_9X16_FFMPEG_NARRADO',\n  'TEXTO_COM_LINK'"),
      'a lista de produzíveis não pode ser repetida aqui'
    )
  })

  test('a autoridade é pura: não arrasta banco para dentro do planejador', () => {
    const codigo = readFileSync(join(RAIZ, 'lib/capacidades-da-fabrica.ts'), 'utf8')
    // O que importa é não haver IMPORT nenhum. A palavra "prisma" aparece no
    // comentário que explica justamente por que ela não pode ser importada.
    const imports = codigo.match(/^\s*(import|const .*=\s*require)/gm) ?? []
    assert.deepEqual(imports, [], 'a autoridade não pode importar nada')
  })

  test('cada formato do catálogo ou é produzido ou tem motivo escrito', () => {
    for (const f of FORMATOS) {
      if (ehFormatoProduzivel(f.formato)) continue
      const motivo = motivoNaoProduzido(f.formato)
      assert.ok(motivo && motivo.length > 20, `${f.formato} precisa de motivo`)
    }
  })

  test('a declaração da regra nomeia quem consulta a autoridade', () => {
    assert.equal(PLANO_SO_ESCOLHE_O_QUE_A_FABRICA_PRODUZ.autoridade, 'lib/capacidades-da-fabrica.ts')
    assert.ok(PLANO_SO_ESCOLHE_O_QUE_A_FABRICA_PRODUZ.consultadoPor.includes('lib/plano-de-acao.ts'))
  })
})

// ── A seleção ───────────────────────────────────────────────────────────

describe('O plano só escolhe o que a fábrica monta', () => {
  test('produzíveis vêm primeiro na ordem de varredura', () => {
    const ordem = FORMATOS_POR_PRODUCAO.map((f) => f.formato)
    assert.equal(ordem[0], 'VIDEO_9X16_FFMPEG_NARRADO')
    assert.equal(ordem[1], 'TEXTO_COM_LINK')
    // O catálogo completo continua lá: o plano precisa poder explicar o que
    // existe e não sai.
    assert.equal(FORMATOS_POR_PRODUCAO.length, FORMATOS.length)
  })

  test('CARROSSEL nunca é escolhido, nem quando o canal o aceita', () => {
    // Facebook aceita carousel e a mídia está autorizada: antes da rodada
    // 45, CARROSSEL era exatamente o que saía daqui. (P1.9.2: o teste usa
    // um canal SEM adapter real; o Instagram tem regra própria, abaixo.)
    const e = escolherCanalEFormato(oport(), ['facebook'], {})
    assert.notEqual(e.formato, 'CARROSSEL')
    assert.ok(ehFormatoProduzivel(e.formato), 'o escolhido tem de ser produzível')
  })

  test('IMAGEM_UNICA também não é escolhida', () => {
    const e = escolherCanalEFormato(oport(), ['facebook'], {})
    assert.notEqual(e.formato, 'IMAGEM_UNICA')
  })

  test('com FFmpeg disponível, escolhe o vídeo — o formato de maior valor', () => {
    const e = escolherCanalEFormato(oport(), ['facebook'], { FFMPEG: true })
    assert.equal(e.formato, 'VIDEO_9X16_FFMPEG_NARRADO')
    assert.equal(e.custo, 0)
  })

  test('FFmpeg INDISPONÍVEL: não seleciona vídeo FFmpeg', () => {
    const e = escolherCanalEFormato(oport(), ['facebook'], { FFMPEG: false })
    assert.notEqual(e.formato, 'VIDEO_9X16_FFMPEG_NARRADO')
    assert.ok(e.bloqueios.includes('CAPACIDADE_AUSENTE:FFMPEG'))
  })

  test('sem FFmpeg, cai para TEXTO_COM_LINK — que roda sem capacidade', () => {
    const e = escolherCanalEFormato(oport(), ['facebook'], {})
    assert.equal(e.formato, 'TEXTO_COM_LINK')
  })

  test('Digital Twin INDISPONÍVEL: não é selecionado', () => {
    const e = escolherCanalEFormato(oport(), ['facebook'], { DIGITAL_TWIN_GPU: false })
    assert.notEqual(e.formato, 'VIDEO_DIGITAL_TWIN')
  })

  test('Digital Twin com GPU declarada TAMBÉM não é selecionado', () => {
    // A GPU não cria o caminho de geração. A fábrica recusaria o job, e o
    // plano prometeria o que ninguém monta.
    const e = escolherCanalEFormato(oport(), ['facebook'], { DIGITAL_TWIN_GPU: true, FFMPEG: false })
    assert.notEqual(e.formato, 'VIDEO_DIGITAL_TWIN')
    assert.ok(ehFormatoProduzivel(e.formato))
    assert.equal(ehFormatoProduzivel('VIDEO_DIGITAL_TWIN'), false)
    assert.match(motivoNaoProduzido('VIDEO_DIGITAL_TWIN')!, /Declarar a GPU não basta/)
  })

  test('provider pago continua fora, com ou sem esta mudança', () => {
    const e = escolherCanalEFormato(oport(), ['facebook'], { FFMPEG: true })
    assert.notEqual(e.formato, 'VIDEO_IA_GERADO')
    assert.equal(e.custo, 0)
  })

  test('mídia sem direito: sobra TEXTO_COM_LINK, que não usa a imagem', () => {
    const e = escolherCanalEFormato(
      oport({ motivosDeProntidao: ['MIDIA_SEM_DIREITO'] as never }),
      ['facebook'],
      { FFMPEG: true }
    )
    assert.equal(e.formato, 'TEXTO_COM_LINK')
  })
})

// ── Sem execução fantasma ───────────────────────────────────────────────

describe('Nenhum formato viável nunca vira execução fantasma', () => {
  test('NENHUMA combinação de canal e capacidade escolhe formato não produzido', () => {
    // Varredura exaustiva: 5 canais do registro x 4 combinações de
    // capacidade x mídia autorizada ou não. Se algum dia alguém acrescentar
    // um formato ao catálogo sem escrever o caminho na fábrica, é aqui que
    // quebra.
    const caps = [{}, { FFMPEG: true }, { DIGITAL_TWIN_GPU: true }, { FFMPEG: true, DIGITAL_TWIN_GPU: true }]
    const canais = ['instagram', 'tiktok', 'youtube', 'facebook', 'pinterest']
    let escolhas = 0
    for (const canal of canais) {
      for (const c of caps) {
        for (const midia of [[], ['MIDIA_SEM_DIREITO']]) {
          const o = oport({ motivosDeProntidao: midia as never })
          const e = escolherCanalEFormato(o, [canal], c)
          if (e.formato === null) continue
          escolhas += 1
          // P1.9.2: o plano pode recomendar um formato que a DONA fornece
          // (VIDEO_PROPRIO). Ele não é produzido — e por isso nunca pode
          // virar PRONTO_PARA_GERAR_CONTEUDO. O que este teste protege é
          // isso: execução fantasma, não a recomendação.
          if (ehFormatoDaDona(e.formato)) {
            assert.equal(derivarEstadoEAcao(o, e).estado, 'AGUARDANDO_MIDIA_AUTORIZADA')
            continue
          }
          assert.ok(
            ehFormatoProduzivel(e.formato),
            `${canal} com ${JSON.stringify(c)} escolheu ${e.formato}, que a fábrica não produz`
          )
        }
      }
    }
    assert.ok(escolhas >= 30, `a varredura precisa exercitar o caminho (${escolhas})`)
  })

  test('todo canal SEM adapter real aceita TEXTO_COM_LINK — a trava é rede de segurança', () => {
    // Fato observado no registro: estes canais têm imagePost, shortVideo ou
    // reel, então sempre sobra um formato produzível.
    // P2.17.10: o TikTok agora tem adapter real (só vídeo): segue a regra do Instagram, abaixo.
    for (const canal of ['youtube', 'facebook', 'pinterest']) {
      const e = escolherCanalEFormato(oport(), [canal], {})
      assert.ok(ehFormatoProduzivel(e.formato), `${canal} deveria aceitar TEXTO_COM_LINK`)
    }
  })

  test('P1.9.2 — o Instagram (e o TikTok, P2.17.10), com adapter real, NÃO recebe TEXTO_COM_LINK: espera o vídeo da dona', () => {
    for (const [canal, caps] of [['instagram', {}], ['instagram', { FFMPEG: true }], ['tiktok', {}], ['tiktok', { FFMPEG: true }]] as const) {
      const e = escolherCanalEFormato(oport(), [canal], caps)
      assert.equal(e.formato, 'VIDEO_PROPRIO', JSON.stringify(caps))
      assert.equal(derivarEstadoEAcao(oport(), e).estado, 'AGUARDANDO_MIDIA_AUTORIZADA')
    }
  })

  test('o estado PRONTO_PARA_GERAR_CONTEUDO implica formato produzível', () => {
    for (const caps of [{}, { FFMPEG: true }, { DIGITAL_TWIN_GPU: true }]) {
      for (const canais of [['instagram'], ['tiktok'], ['instagram', 'tiktok'], ['youtube']]) {
        const e = escolherCanalEFormato(oport(), canais, caps)
        const d = derivarEstadoEAcao(oport(), e)
        if (d.estado === 'PRONTO_PARA_GERAR_CONTEUDO') {
          assert.ok(
            ehFormatoProduzivel(e.formato),
            `${e.formato} saiu como pronto e a fábrica não o produz`
          )
        }
      }
    }
  })

  test('todo item PRONTO do plano vira job de geração — fila nunca fica vazia', () => {
    const plano = montarPlanoDeAcao({
      workspaceId: 'ws-1',
      fila: [oport(), oport({ produtoId: 'p-2', categoria: 'pet' })],
      canaisConectados: ['facebook'],
      capacidades: {},
      agora: new Date('2026-09-24T12:00:00Z'),
    })
    const prontos = plano.itens.filter((i) => i.estado === 'PRONTO_PARA_GERAR_CONTEUDO')
    const jobs = jobsDeGeracaoDoPlano('ws-1', plano.itens)
    assert.ok(prontos.length > 0, 'o cenário precisa ter item pronto')
    assert.equal(jobs.length, prontos.length, 'cada pronto produz exatamente um job')
    assert.deepEqual(jobsDeLacunaDeFormato('ws-1', plano.itens), [], 'e nenhuma lacuna sobra')
  })

  test('a fábrica aceita todo formato que o plano marcou como pronto', () => {
    const plano = montarPlanoDeAcao({
      workspaceId: 'ws-1',
      fila: [oport()],
      canaisConectados: ['instagram'],
      capacidades: { FFMPEG: true },
      agora: new Date('2026-09-24T12:00:00Z'),
    })
    for (const item of plano.itens) {
      if (item.estado !== 'PRONTO_PARA_GERAR_CONTEUDO') continue
      const v = avaliarCapacidade(item.formatoRecomendado!, {
        ffmpeg: true,
        chatterbox: true,
        memoriaLivreBytes: 8 * 1024 ** 3,
      })
      assert.equal(v.pode, true, `${item.formatoRecomendado}: ${v.explicacao}`)
    }
  })

  test('isolamento por workspace: item de outro negócio não entra no plano', () => {
    const plano = montarPlanoDeAcao({
      workspaceId: 'ws-1',
      fila: [oport({ workspaceId: 'ws-2' })],
      canaisConectados: ['instagram'],
      capacidades: {},
      agora: new Date('2026-09-24T12:00:00Z'),
    })
    assert.deepEqual(plano.itens, [])
    assert.deepEqual(jobsDeGeracaoDoPlano('ws-1', plano.itens), [])
  })
})

// ── SINCRONIZAR_MIDIA_AUTORIZADA ────────────────────────────────────────

describe('Tipo sem executor não consome retry', () => {
  test('SINCRONIZAR_MIDIA_AUTORIZADA não é mais automatizável', () => {
    const p = perfilDaDependencia('SINCRONIZAR_MIDIA_AUTORIZADA')
    assert.equal(p.classe, 'AGUARDA_CONDICAO')
    assert.equal(p.maxTentativas, 0)
    assert.equal(podeExecutarSozinho(p), false)
  })

  test('o executor de fato não tem ação registrada para ele', () => {
    // É a razão de ser da mudança: classe e realidade agora concordam.
    const acoes = acoesDoExecutor({
      workspaceId: 'ws-1',
      workerId: 'w',
      capacidades: { ffmpeg: false, chatterbox: false, memoriaLivreBytes: 0 },
      agora: new Date(),
    }) as Record<string, unknown>
    assert.equal(acoes.SINCRONIZAR_MIDIA_AUTORIZADA, undefined)
  })

  test('todo tipo AUTOMATIZAVEL com tentativas TEM ação no executor', () => {
    const acoes = acoesDoExecutor({
      workspaceId: 'ws-1',
      workerId: 'w',
      capacidades: { ffmpeg: false, chatterbox: false, memoriaLivreBytes: 0 },
      agora: new Date(),
    }) as Record<string, unknown>
    for (const tipo of [
      'CONECTAR_CANAL',
      'RENOVAR_TOKEN',
      'SINCRONIZAR_MIDIA_AUTORIZADA',
      'COMPLETAR_DADO_DO_PRODUTO',
      'GERAR_CONTEUDO',
      'DISTRIBUIR_CONTEUDO',
      'HABILITAR_CAPACIDADE',
    ]) {
      const p = perfilDaDependencia(tipo)
      if (podeExecutarSozinho(p)) {
        assert.ok(acoes[tipo], `${tipo} é automatizável e não tem ação registrada`)
      }
    }
  })

  test('a mídia sem direito continua gerando a dependência certa', () => {
    const e = escolherCanalEFormato(
      oport({ motivosDeProntidao: ['MIDIA_SEM_DIREITO'] as never }),
      ['facebook'],
      { FFMPEG: true }
    )
    // Como sobra TEXTO_COM_LINK, que não usa a mídia, o item segue pronto —
    // e é isso que se quer: a falta de direito de imagem não trava tudo.
    assert.equal(derivarEstadoEAcao(oport({ motivosDeProntidao: ['MIDIA_SEM_DIREITO'] as never }), e).estado,
      'PRONTO_PARA_GERAR_CONTEUDO')
  })
})

// ── Custo e publicação ──────────────────────────────────────────────────

describe('Nada aqui gasta dinheiro nem publica', () => {
  test('nenhum provider pago aparece nos módulos tocados', () => {
    for (const rel of ['lib/capacidades-da-fabrica.ts', 'lib/plano-de-acao.ts']) {
      const codigo = readFileSync(join(RAIZ, rel), 'utf8').toLowerCase()
      for (const pago of ['anthropic', 'openai', 'elevenlabs']) {
        assert.ok(!codigo.includes(pago), `${pago} não pode aparecer em ${rel}`)
      }
    }
    // fal.ai é citado como formato BLOQUEADO, o que é o oposto de usá-lo.
    assert.match(FORMATOS_NAO_PRODUZIDOS.VIDEO_IA_GERADO, /pago|Bloqueado/)
  })

  test('o planejador continua sem publicar e sem tocar em banco', () => {
    const codigo = readFileSync(join(RAIZ, 'lib/plano-de-acao.ts'), 'utf8')
    // Import e chamada, não a prosa: os comentários explicam justamente que
    // o planejador não publica.
    for (const proibido of [/^\s*import .*prisma/m, /prisma\./, /fetch\(/, /publicarReel/, /prepararTentativa/]) {
      assert.ok(!proibido.test(codigo), `${proibido} não pode aparecer no planejador`)
    }
  })

  test('todo item do plano custa R$ 0,00', () => {
    const plano = montarPlanoDeAcao({
      workspaceId: 'ws-1',
      fila: [oport(), oport({ produtoId: 'p-2' })],
      canaisConectados: ['instagram', 'tiktok'],
      capacidades: { FFMPEG: true },
      agora: new Date('2026-09-24T12:00:00Z'),
    })
    for (const i of plano.itens) assert.equal(i.custoEstimado, 0)
    assert.equal(plano.custoTotal, 0)
  })

  test('posicaoNaProducao põe o não produzido no fim, sem exceção', () => {
    assert.equal(posicaoNaProducao('VIDEO_9X16_FFMPEG_NARRADO'), 0)
    assert.equal(posicaoNaProducao('TEXTO_COM_LINK'), 1)
    for (const f of ['CARROSSEL', 'IMAGEM_UNICA', 'VIDEO_DIGITAL_TWIN', 'VIDEO_IA_GERADO', 'INEXISTENTE']) {
      assert.equal(posicaoNaProducao(f), Number.MAX_SAFE_INTEGER, f)
    }
  })
})
