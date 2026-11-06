/**
 * P1.0 Etapa 2.a — microcorreção: a lacuna de rastreamento fica visível, e
 * nunca vira evidência de zero cliques.
 *
 * O fallback para `Produto.linkProduto` fica. O que não pode ficar é o
 * silêncio: nem para a dona do negócio, nem para o ML.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '../lib/prisma'
import {
  ESTADOS_DE_RASTREAMENTO,
  INDISPONIVEL_POR_FALTA_DE_RASTREAMENTO,
  TITULO_SEM_RASTREAMENTO,
  MENSAGEM_GENERICA,
  derivarEstadoDaPublicacao,
  mensagemDaLacuna,
  avisoDaPublicacao,
  podeUsarComoEvidenciaDeZeroCliques,
  metricasDeCliqueIndisponiveis,
  metricasDeCliqueDaPublicacao,
  sufixosDerivaveisDaPublicacao,
  avaliarRastreamentoDosConteudos,
  avaliarRastreamentoDoConteudo,
  INTEGRACAO_FUTURA_PAINEL_DE_EXCECOES,
} from '../lib/rastreamento-da-publicacao'
import { lerBasePublica, obterLinkRastreavelDaPublicacao } from '../lib/link-de-publicacao'
import { montarLabelDeOperacaoReal } from '../lib/ml-operacao-real'
import { montarLabelNegativo } from '../lib/ml-captura-publicacao'
import { MOTIVOS_CLIQUE_INDISPONIVEL } from '../lib/metricas-clique'

const TEM_BANCO = !!process.env.DATABASE_URL
const RAIZ = join(__dirname, '..')
const lerFonte = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')
const lerCodigo = (rel: string) =>
  lerFonte(rel)
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n')

const BASE_OK = { PUBLIC_BASE_URL: 'https://patrono.exemplo.com.br' }

// ── Os três estados ─────────────────────────────────────────────────────

describe('Três estados — publicada, rastreada, nenhum dos dois', () => {
  test('o vocabulário tem exatamente os três', () => {
    assert.deepEqual([...ESTADOS_DE_RASTREAMENTO], [
      'RASTREADA',
      'NAO_RASTREADA_COM_FALLBACK',
      'NAO_PUBLICADA',
    ])
  })

  test('distribuída + rastreada = RASTREADA', () => {
    assert.equal(derivarEstadoDaPublicacao({ distribuida: true, rastreada: true }), 'RASTREADA')
  })

  test('distribuída sem link rastreado = NAO_RASTREADA_COM_FALLBACK', () => {
    assert.equal(
      derivarEstadoDaPublicacao({ distribuida: true, rastreada: false }),
      'NAO_RASTREADA_COM_FALLBACK'
    )
  })

  test('sem distribuição = NAO_PUBLICADA, mesmo que o link exista', () => {
    // Link criado + publicação que falhou não é publicação.
    assert.equal(derivarEstadoDaPublicacao({ distribuida: false, rastreada: true }), 'NAO_PUBLICADA')
    assert.equal(derivarEstadoDaPublicacao({ distribuida: false, rastreada: false }), 'NAO_PUBLICADA')
  })
})

// ── Mensagem segura ─────────────────────────────────────────────────────

describe('Motivo técnico vira frase segura', () => {
  test('cada motivo do usuário tem a sua frase', () => {
    assert.match(mensagemDaLacuna('SEM_BASE_PUBLICA', 'NAO_CONFIGURADA'), /domínio público/i)
    assert.match(mensagemDaLacuna('SEM_BASE_PUBLICA', 'URL_INVALIDA'), /não é uma URL válida/i)
    assert.match(mensagemDaLacuna('SEM_BASE_PUBLICA', 'PROTOCOLO_INVALIDO'), /não é uma URL válida/i)
    assert.match(mensagemDaLacuna('SEM_BASE_PUBLICA', 'HOST_NAO_PUBLICO'), /acessível fora do servidor/i)
    assert.match(mensagemDaLacuna('PRODUTO_SEM_URL_DE_DESTINO'), /URL de destino/i)
    assert.match(mensagemDaLacuna('FALHA_AO_CRIAR_LINK'), /criar o link rastreado/i)
    assert.match(mensagemDaLacuna('CONTEUDO_NAO_ENCONTRADO'), /identificar o produto/i)
  })

  test('motivo desconhecido cai na frase genérica, nunca vaza o interno', () => {
    assert.equal(mensagemDaLacuna('ALGO_NOVO_QUE_NINGUEM_MAPEOU'), MENSAGEM_GENERICA)
    assert.equal(mensagemDaLacuna(null), MENSAGEM_GENERICA)
    assert.equal(mensagemDaLacuna(undefined, 'NAO_CONFIGURADA'), MENSAGEM_GENERICA)
  })

  test('NENHUMA frase carrega detalhe interno', () => {
    const motivos = [
      ['SEM_BASE_PUBLICA', 'NAO_CONFIGURADA'],
      ['SEM_BASE_PUBLICA', 'URL_INVALIDA'],
      ['SEM_BASE_PUBLICA', 'PROTOCOLO_INVALIDO'],
      ['SEM_BASE_PUBLICA', 'HOST_NAO_PUBLICO'],
      ['PRODUTO_SEM_URL_DE_DESTINO', null],
      ['FALHA_AO_CRIAR_LINK', null],
      ['CONTEUDO_NAO_ENCONTRADO', null],
      ['DESCONHECIDO', null],
    ] as const

    for (const [motivo, sub] of motivos) {
      const frase = mensagemDaLacuna(motivo, sub)
      // Sem nome de variável de ambiente, sem stack, sem código interno.
      for (const proibido of [
        'PUBLIC_BASE_URL',
        'NEXTAUTH_URL',
        'DATABASE_URL',
        'process.env',
        'prisma',
        'Error',
        'at ',
        'linkProduto',
        'workspaceId',
        'undefined',
        '_',
      ]) {
        assert.ok(!frase.includes(proibido), `"${frase}" vazou "${proibido}"`)
      }
      assert.ok(frase.endsWith('.'), 'é frase, não código')
    }
  })

  test('a explicação interna REALMENTE cita o configurado — por isso não vai à tela', () => {
    // Esta é a prova de que a tabela de mensagens não é decoração.
    const r = lerBasePublica({ PUBLIC_BASE_URL: 'coisa-invalida-do-env' })
    assert.equal(r.ok, false)
    assert.ok((r as { explicacao: string }).explicacao.includes('coisa-invalida-do-env'))
    // A frase equivalente da tela não cita nada disso.
    assert.ok(!mensagemDaLacuna('SEM_BASE_PUBLICA', 'URL_INVALIDA').includes('coisa-invalida'))
  })
})

// ── O aviso ─────────────────────────────────────────────────────────────

describe('Aviso — só quando há o que avisar', () => {
  test('publicação RASTREADA não gera alerta nenhum', () => {
    assert.equal(avisoDaPublicacao({ rastreado: true }), null)
    assert.equal(avisoDaPublicacao({ rastreado: true, motivo: null }), null)
  })

  test('fallback gera alerta visível com o título pedido', () => {
    const aviso = avisoDaPublicacao({ rastreado: false, motivo: 'SEM_BASE_PUBLICA', submotivo: 'NAO_CONFIGURADA' })
    assert.ok(aviso)
    assert.equal(aviso.titulo, TITULO_SEM_RASTREAMENTO)
    assert.match(aviso.titulo, /sem rastreamento de cliques/i)
    assert.match(aviso.detalhe, /domínio público/i)
  })

  test('o aviso afirma que a publicação ACONTECEU', () => {
    const aviso = avisoDaPublicacao({ rastreado: false, motivo: 'FALHA_AO_CRIAR_LINK' })
    assert.equal(aviso?.publicacaoRealizada, true)
    assert.equal(aviso?.estado, 'NAO_RASTREADA_COM_FALLBACK')
  })
})

// ── Proteção do ML ──────────────────────────────────────────────────────

describe('ML — fallback nunca vira evidência de zero cliques', () => {
  test('só RASTREADA autoriza ler ausência de EventoLink como ausência de clique', () => {
    assert.equal(podeUsarComoEvidenciaDeZeroCliques('RASTREADA'), true)
    assert.equal(podeUsarComoEvidenciaDeZeroCliques('NAO_RASTREADA_COM_FALLBACK'), false)
    assert.equal(podeUsarComoEvidenciaDeZeroCliques('NAO_PUBLICADA'), false)
  })

  const venda = (over: Record<string, unknown> = {}) => ({
    saleId: 's1',
    amount: 100,
    clickEventId: null,
    commissions: [],
    ...over,
  })

  test('sem rastreamento, a AUSÊNCIA de clique é null — nunca 0', () => {
    const l = montarLabelDeOperacaoReal([venda()], new Date(), 'NAO_RASTREADA_COM_FALLBACK')
    assert.equal(l.atribuicaoDeClique.semClique, null)
    assert.notEqual(l.atribuicaoDeClique.semClique, 0)
    assert.equal(l.rastreamentoDeClique, 'NAO_RASTREADA_COM_FALLBACK')
  })

  test('o clique que EXISTE continua contando, rastreada ou não', () => {
    // Evidência positiva não depende do canal de medição: a venda tem
    // clickEventId, o clique aconteceu e está registrado.
    for (const estado of ['RASTREADA', 'NAO_RASTREADA_COM_FALLBACK'] as const) {
      const l = montarLabelDeOperacaoReal([venda({ clickEventId: 'ev-1' })], new Date(), estado)
      assert.equal(l.atribuicaoDeClique.comClique, 1)
    }
  })

  test('com rastreamento, a ausência volta a ser número medido', () => {
    const l = montarLabelDeOperacaoReal([venda()], new Date(), 'RASTREADA')
    assert.equal(l.atribuicaoDeClique.semClique, 1)
    assert.equal(l.rastreamentoDeClique, 'RASTREADA')
  })

  test('o padrão é fail-closed: sem informar o estado, assume NÃO rastreada', () => {
    const l = montarLabelDeOperacaoReal([venda()])
    assert.equal(l.rastreamentoDeClique, 'NAO_RASTREADA_COM_FALLBACK')
    assert.equal(l.atribuicaoDeClique.semClique, null)
  })

  test('o rótulo NEGATIVO segue a mesma regra', () => {
    const semRastreio = montarLabelNegativo(new Date(), 'NAO_RASTREADA_COM_FALLBACK')
    assert.equal(semRastreio.converted, false)
    assert.equal(semRastreio.atribuicaoDeClique.semClique, null)
    assert.equal(semRastreio.rastreamentoDeClique, 'NAO_RASTREADA_COM_FALLBACK')

    const comRastreio = montarLabelNegativo(new Date(), 'RASTREADA')
    assert.equal(comRastreio.atribuicaoDeClique.semClique, 0)
  })

  test('o negativo continua nascendo de VENDA, não de EventoLink', () => {
    const codigo = lerCodigo('lib/ml-captura-publicacao.ts')
    // A decisão de rotular negativo olha Sale e a janela — nunca eventos.
    assert.match(codigo, /prisma\.sale\.findMany/)
    assert.ok(
      !/eventoLink[\s\S]{0,400}montarLabelNegativo/.test(codigo),
      'nenhum caminho deriva o negativo de contagem de evento'
    )
  })

  test('zero venda continua virando negativo — a receita não depende de rastreio', () => {
    // O que fica desconhecido é a atribuição por clique, não o resultado
    // financeiro. Uma venda comprovada segue valendo.
    const l = montarLabelDeOperacaoReal(
      [venda({ commissions: [{ status: 'RECEIVED', expectedAmount: 20, confirmedAmount: 18, receivedAmount: 15 }] })],
      new Date(),
      'NAO_RASTREADA_COM_FALLBACK'
    )
    assert.equal(l.converted, true)
    assert.equal(l.receitaRealizada, 15)
    assert.equal(l.comissaoConfirmada, 18)
  })
})

// ── Métricas dependentes de clique ──────────────────────────────────────

describe('Métricas de clique ficam null, com o motivo nomeado', () => {
  test('todas as quatro métricas pedidas ficam null', () => {
    const m = metricasDeCliqueIndisponiveis()
    assert.equal(m.taxaConversao, null)
    assert.equal(m.clicksPerView, null)
    assert.equal(m.commissionPerClick, null)
    assert.equal(m.receitaPorClique, null)
    assert.equal(m.cliques, null)
  })

  test('o marcador é declarado, não improvisado', () => {
    assert.equal(
      metricasDeCliqueIndisponiveis().indisponibilidade,
      INDISPONIVEL_POR_FALTA_DE_RASTREAMENTO
    )
    assert.ok(
      (MOTIVOS_CLIQUE_INDISPONIVEL as readonly string[]).includes(
        INDISPONIVEL_POR_FALTA_DE_RASTREAMENTO
      ),
      'o vocabulário de métricas conhece o motivo'
    )
  })

  test('nenhum valor é 0 — 0 afirmaria medição', () => {
    for (const estado of ESTADOS_DE_RASTREAMENTO) {
      const m = metricasDeCliqueDaPublicacao(estado)
      for (const [campo, valor] of Object.entries(m)) {
        if (campo === 'indisponibilidade') continue
        assert.notEqual(valor, 0, `${campo} em ${estado} virou 0`)
      }
    }
  })

  test('fora de RASTREADA a indisponibilidade é declarada', () => {
    assert.equal(
      metricasDeCliqueDaPublicacao('NAO_RASTREADA_COM_FALLBACK').indisponibilidade,
      INDISPONIVEL_POR_FALTA_DE_RASTREAMENTO
    )
    assert.equal(
      metricasDeCliqueDaPublicacao('NAO_PUBLICADA').indisponibilidade,
      INDISPONIVEL_POR_FALTA_DE_RASTREAMENTO
    )
    assert.equal(metricasDeCliqueDaPublicacao('RASTREADA').indisponibilidade, null)
  })
})

// ── Interface ───────────────────────────────────────────────────────────

describe('A lacuna aparece na interface, não só no log', () => {
  // P2.2: a resposta de sucesso do "publicar agora" é montada pelo executor
  // único da publicação; a rota só a repassa (`r.resposta.corpo`).
  const rota = lerCodigo('lib/trabalhos-longos/publicar-instagram.ts')
  // Só o CORPO da resposta. O resto do arquivo legitimamente manipula
  // accessToken e explicacao — isso fica no servidor e no log; o que não
  // pode é atravessar para o cliente.
  const corpoDaResposta = (() => {
    const i = rota.indexOf('rastreamento: respostaDeRastreamento')
    assert.ok(i > 0, 'o bloco de rastreamento da resposta precisa existir')
    return rota.slice(rota.lastIndexOf('corpo: {', i), rota.indexOf('await e.salvar({ respostaDeSucesso', i))
  })()
  test('a rota manual repassa exatamente a resposta do executor', () => {
    const manual = lerCodigo('app/api/conteudos/[id]/publicar/route.ts')
    assert.match(manual, /NextResponse\.json\(r\.resposta\.corpo, \{ status: r\.resposta\.status \}\)/)
  })
  const lista = lerCodigo('app/api/conteudos/route.ts')
  const tela = lerCodigo('app/(dashboard)/conteudos/page.tsx')

  test('a rota manual devolve o aviso pronto', () => {
    // A Etapa 2.c moveu a montagem do aviso para o fluxo; a rota so repassa.
    assert.match(rota, /respostaDeRastreamento\(tentativa\)/)
    const fluxo = lerCodigo('lib/publicacao-fluxo.ts')
    assert.match(fluxo, /avisoDaPublicacao/)
    assert.match(fluxo, /estado: 'NAO_RASTREADA_COM_FALLBACK'/)
  })

  test('a rota NÃO devolve mais a explicação interna', () => {
    // `explicacao` cita PUBLIC_BASE_URL e o caminho que falhou. Ela continua
    // indo para o LOG do servidor — o que não pode é entrar na resposta.
    assert.ok(
      !/explicacao/.test(corpoDaResposta),
      'a explicação interna não pode viajar para a tela'
    )
    // O log continua recebendo — no fluxo, que e quem sabe da lacuna.
    assert.match(lerCodigo('lib/publicacao-fluxo.ts'), /registrarLacunaDeRastreamento/)
  })

  test('a tela avisa imediatamente quando o post sai sem rastreamento', () => {
    assert.match(tela, /rastreamento\.rastreado === false/)
    assert.match(tela, /variant: 'destructive'/)
  })

  test('a tela diz que a publicação foi feita', () => {
    assert.match(tela, /publicação foi feita/i)
  })

  test('a listagem marca cada publicação sem rastreamento', () => {
    assert.match(lista, /avaliarRastreamentoDosConteudos/)
    assert.match(tela, /Sem rastreamento de cliques/)
  })

  test('o cron preserva o contador', () => {
    const cron = lerCodigo('app/api/cron/publicar/route.ts')
    assert.match(cron, /publicacoesSemRastreamento/)
  })

  test('a integração com o Painel de Exceções está na fila, não esquecida', () => {
    assert.equal(INTEGRACAO_FUTURA_PAINEL_DE_EXCECOES.estado, 'REGISTRADA_NAO_IMPLEMENTADA')
    assert.ok(INTEGRACAO_FUTURA_PAINEL_DE_EXCECOES.ondeApareceHoje.length >= 3)
  })

  test('nenhuma credencial aparece na resposta ou na tela', () => {
    const proibidos = [
      'ANTHROPIC_API_KEY',
      'CRON_SECRET',
      'DATABASE_URL',
      'accessToken',
      'SUPABASE_SERVICE',
      'NEXTAUTH_SECRET',
      'PUBLIC_BASE_URL',
    ]
    // A resposta ao cliente, a listagem e a tela. O miolo do servidor da
    // rota manual usa accessToken de propósito — para falar com a Meta.
    for (const codigo of [corpoDaResposta, lista, tela, lerCodigo('lib/rastreamento-da-publicacao.ts')]) {
      for (const segredo of proibidos) {
        assert.ok(!codigo.includes(segredo), `${segredo} não pode aparecer aqui`)
      }
    }
  })

  test('o estado de rastreamento NUNCA virou coluna', () => {
    // Nasceu como "o schema continua intocado". A Etapa 2.b mexeu no schema
    // — mas a regra que esta asserção realmente protege sobreviveu: o estado
    // de rastreamento e DERIVADO, nunca guardado. Um cache aqui poderia
    // contradizer a fonte e envenenar o ML.
    const schema = lerFonte('prisma/schema.prisma')
      .split(/\r?\n/)
      .filter((l) => !l.trimStart().startsWith('//'))
      .join('\n')
    assert.ok(!/rastreamentoDeClique/.test(schema))
    assert.ok(!/NAO_RASTREADA_COM_FALLBACK/.test(schema))
    const publicacao = schema.match(/model Publicacao \{[\s\S]*?\n\}/)
    if (publicacao) assert.ok(!/rastread/i.test(publicacao[0]))
  })
})

// ── Banco ───────────────────────────────────────────────────────────────

let workspaceA = ''
let userA = ''
let conteudoRastreado = ''
let conteudoFallback = ''
let conteudoNaoPublicado = ''
const criados: string[] = []

describe(
  'Derivação do estado no banco',
  { skip: !TEM_BANCO ? 'DATABASE_URL ausente — exige Postgres' : false },
  () => {
    before(async () => {
      const marca = Date.now()
      const ws = await prisma.workspace.create({
        data: { name: 'R28', ownerId: `teste-r28-${marca}` },
        select: { id: true },
      })
      workspaceA = ws.id
      criados.push(ws.id)

      userA = (
        await prisma.user.create({
          data: { email: `r28-${marca}@teste.local`, name: 'U', password: 'x', workspaceId: workspaceA },
          select: { id: true },
        })
      ).id

      const produtoId = (
        await prisma.produto.create({
          data: {
            workspaceId: workspaceA,
            userId: userA,
            nome: 'Fone bluetooth',
            categoria: 'eletronicos',
            tipoVenda: 'Afiliado',
            origemConteudo: 'Proprio',
            linkProduto: 'https://loja.exemplo.invalido/fone',
          },
          select: { id: true },
        })
      ).id

      const criar = async (dados: Record<string, unknown>) =>
        (
          await prisma.conteudo.create({
            data: {
              workspaceId: workspaceA,
              userId: userA,
              produtoId,
              roteiro: 'x',
              redeSocial: 'instagram',
              ...dados,
            },
            select: { id: true },
          })
        ).id

      // Distribuído de verdade: identificador externo + data.
      const distribuido = { publicacaoExternaId: 'ig-123', dataPublicacao: new Date() }
      conteudoRastreado = await criar(distribuido)
      conteudoFallback = await criar(distribuido)
      conteudoNaoPublicado = await criar({})

      // Só o primeiro ganha o link rastreado da publicação.
      const r = await obterLinkRastreavelDaPublicacao({
        workspaceId: workspaceA,
        contentId: conteudoRastreado,
        canal: 'instagram',
        env: BASE_OK,
      })
      assert.equal(r.ok, true, r.explicacao)
    })

    after(async () => {
      for (const ws of criados) {
        await prisma.eventoLink.deleteMany({ where: { workspaceId: ws } })
        await prisma.linkDinamico.deleteMany({ where: { workspaceId: ws } })
        await prisma.conteudo.deleteMany({ where: { workspaceId: ws } })
        await prisma.produto.deleteMany({ where: { workspaceId: ws } })
        await prisma.user.deleteMany({ where: { workspaceId: ws } })
      }
      await prisma.workspace.deleteMany({ where: { id: { in: criados } } })
      await prisma.$disconnect()
    })

    test('publicação COM link rastreado lê como RASTREADA, sem aviso', async () => {
      const r = await avaliarRastreamentoDoConteudo({ workspaceId: workspaceA, contentId: conteudoRastreado })
      assert.equal(r.estado, 'RASTREADA')
      assert.equal(r.aviso, null)
      assert.equal(r.metricasDeClique.indisponibilidade, null)
    })

    test('publicação que caiu no fallback lê como NAO_RASTREADA_COM_FALLBACK, com aviso', async () => {
      const r = await avaliarRastreamentoDoConteudo({ workspaceId: workspaceA, contentId: conteudoFallback })
      assert.equal(r.estado, 'NAO_RASTREADA_COM_FALLBACK')
      assert.equal(r.aviso?.titulo, TITULO_SEM_RASTREAMENTO)
      assert.equal(r.metricasDeClique.indisponibilidade, INDISPONIVEL_POR_FALTA_DE_RASTREAMENTO)
      assert.equal(r.metricasDeClique.taxaConversao, null)
    })

    test('conteúdo nunca distribuído lê como NAO_PUBLICADA — e não vira alerta', async () => {
      const r = await avaliarRastreamentoDoConteudo({ workspaceId: workspaceA, contentId: conteudoNaoPublicado })
      assert.equal(r.estado, 'NAO_PUBLICADA')
      assert.equal(r.aviso, null, 'o que nunca saiu não é exceção de rastreamento')
    })

    test('a listagem inteira é avaliada em UMA consulta', async () => {
      const conteudos = await prisma.conteudo.findMany({
        where: { workspaceId: workspaceA },
        include: { produto: { select: { nome: true } } },
      })
      const mapa = await avaliarRastreamentoDosConteudos(workspaceA, conteudos)
      assert.equal(mapa.size, conteudos.length)
      assert.equal(mapa.get(conteudoRastreado)?.estado, 'RASTREADA')
      assert.equal(mapa.get(conteudoFallback)?.estado, 'NAO_RASTREADA_COM_FALLBACK')
      assert.equal(mapa.get(conteudoNaoPublicado)?.estado, 'NAO_PUBLICADA')
    })

    test('outro workspace nunca faz esta publicação parecer rastreada', async () => {
      const r = await avaliarRastreamentoDoConteudo({
        workspaceId: 'workspace-que-nao-existe',
        contentId: conteudoRastreado,
      })
      assert.equal(r.estado, 'NAO_PUBLICADA')
    })

    test('os sufixos derivados batem com o que a publicação realmente criou', async () => {
      const conteudo = await prisma.conteudo.findUniqueOrThrow({
        where: { id: conteudoRastreado },
        select: { id: true, workspaceId: true, redeSocial: true, dataAgendamento: true },
      })
      const sufixos = sufixosDerivaveisDaPublicacao(conteudo)
      const achados = await prisma.linkDinamico.findMany({
        where: { workspaceId: workspaceA, OR: sufixos.map((s) => ({ slug: { endsWith: `-${s}` } })) },
        select: { slug: true },
      })
      assert.equal(achados.length, 1, 'um link, não vários')
    })

    test('RENOMEAR o produto não apaga o rastreamento', async () => {
      // O nome do produto entra só no prefixo legível do slug. Se a
      // derivação casasse pelo slug inteiro, renomear faria uma publicação
      // rastreada passar a ler como fallback — e o ML perderia a amostra.
      const antes = await avaliarRastreamentoDoConteudo({ workspaceId: workspaceA, contentId: conteudoRastreado })
      assert.equal(antes.estado, 'RASTREADA')

      const conteudo = await prisma.conteudo.findUniqueOrThrow({
        where: { id: conteudoRastreado },
        select: { produtoId: true },
      })
      await prisma.produto.update({
        where: { id: conteudo.produtoId! },
        data: { nome: 'Fone TWS edição nova' },
      })

      const depois = await avaliarRastreamentoDoConteudo({ workspaceId: workspaceA, contentId: conteudoRastreado })
      assert.equal(depois.estado, 'RASTREADA')
    })

    test('a publicação sem rastreamento NÃO impede venda real', async () => {
      // A receita não depende do rastreio. O que fica desconhecida é a
      // atribuição por clique.
      const venda = await prisma.sale.create({
        data: {
          workspaceId: workspaceA,
          contentId: conteudoFallback,
          amount: 199,
          status: 'COMPLETED',
          dataOrigin: 'USER_REPORTED',
          date: new Date(),
        },
        select: { id: true, amount: true, dataOrigin: true },
      })
      assert.equal(venda.amount, 199)

      const r = await avaliarRastreamentoDoConteudo({ workspaceId: workspaceA, contentId: conteudoFallback })
      assert.equal(r.estado, 'NAO_RASTREADA_COM_FALLBACK')
      assert.equal(r.metricasDeClique.commissionPerClick, null)

      await prisma.sale.delete({ where: { id: venda.id } })
    })
  }
)
