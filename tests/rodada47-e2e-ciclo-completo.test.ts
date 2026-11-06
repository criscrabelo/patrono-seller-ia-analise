/**
 * E2E do ciclo interno autônomo, de ponta a ponta.
 *
 *   Produto → Oportunidade → Plano → AutomationJob → Executor
 *          → Conteudo → Preflight → Dry Run
 *
 * P1.9.2: no Instagram o ciclo NÃO gera mais peça de texto — o adapter real
 * só publica Reel com vídeo. O ciclo agora termina numa dependência humana
 * (o vídeo da dona), e o e2e segue pelo caminho real de mídia própria:
 *
 *   ciclo → WAITING (EXIGE_HUMANO) → vídeo da dona → peça → link rastreado
 *        → preflight (bio não confirmada) → confirmação → preflight → ensaio
 *
 * Nenhuma etapa é simulada com atalho: cada uma chama a função que roda em
 * produção. O que muda é o banco (o de teste) e o fato de nenhum adapter
 * de canal estar ligado.
 *
 * O que este arquivo existe para provar, e que nenhum teste isolado prova:
 * que as sete etapas encaixam. Cada peça já tinha teste próprio; o bug de
 * 24/09 — plano dizendo "pronto" e fila vazia — passou por todos eles
 * porque ninguém media a junta.
 *
 * NENHUMA publicação. NENHUM provider. Custo R$ 0,00.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../lib/prisma'
import { rodarCicloDeOportunidades } from '../lib/ciclo-de-oportunidades'
import { portaPrisma } from '../lib/automation-queue-prisma'
import { rodarFilaDoWorkspace } from '../lib/executor-da-fila'
import { preflightDePublicacao, simularDistribuicao } from '../lib/preflight-de-publicacao'
import { ADAPTADORES_LIGADOS, type AdaptadorDeCanal } from '../lib/distribuicao-orquestrador'
import { RENOVADORES_LIGADOS } from '../lib/renovacao-de-acesso'
import { adaptadoresHabilitados } from '../lib/adaptadores-reais'
import { CAMPO_DOS_SCOPES, CAMPO_DA_COMPROVACAO } from '../lib/autorizacao-da-conta'
import { textoDisclosure } from '../lib/creative-factory'
import { prepararPecaComMidiaPropria } from '../lib/peca-com-midia-propria'
import { gerarLinkParaABio, confirmarLinkNaBio } from '../lib/link-na-bio'
import {
  ENV_DE_CUSTODIA,
  VIDEO_PROPRIO_URL,
  REEL_VALIDO,
  DECLARACOES_COMPLETAS,
} from './_fixtura-midia-propria'

const TEM_BANCO = !!process.env.DATABASE_URL
const marca = `r47-${Date.now()}`
const AGORA = new Date('2026-09-24T05:00:00Z')
const AMANHA = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

/** Base pública para o link rastreado; nada ligado para publicar. */
const ENV = { PUBLIC_BASE_URL: 'https://patrono.exemplo.com.br', ...ENV_DE_CUSTODIA }

/** Máquina sem render e sem voz: o caminho que funciona hoje. */
const SEM_CAPACIDADE = { ffmpeg: false, chatterbox: false, memoriaLivreBytes: 8 * 1024 ** 3 }
const CAPS_PLANO = { FFMPEG: false, DIGITAL_TWIN_GPU: false, PROVEDOR_PAGO_AUTORIZADO: false as const }

const criados: string[] = []
let wsA = ''
let wsB = ''
let produtoA = ''
let userA = ''

async function montarWorkspace(nome: string) {
  const ws = await prisma.workspace.create({
    // P2.14.5.12: o ciclo só cria tarefas em workspace AUTOMATIC e despausado.
    data: { name: `R47-${nome}`, ownerId: `${marca}-${nome}`, automationPaused: false, automationMode: 'AUTOMATIC' },
    select: { id: true },
  })
  criados.push(ws.id)
  const u = await prisma.user.create({
    data: { email: `${marca}-${nome}@teste.local`, name: 'U', password: 'x', workspaceId: ws.id },
    select: { id: true },
  })
  // Sem direito de mídia de propósito: sobra TEXTO_COM_LINK, que a fábrica
  // produz sem FFmpeg e sem Chatterbox. É o único caminho que fecha o ciclo
  // inteiro numa máquina sem capacidade declarada.
  const p = await prisma.produto.create({
    data: {
      workspaceId: ws.id, userId: u.id, nome: `${marca}-${nome}`, categoria: 'livros',
      tipoVenda: 'Afiliado', origemConteudo: 'Licenciado',
      imagens: [], linkProduto: 'https://loja.invalido/p', preco: 80,
    },
    select: { id: true },
  })
  // Instagram conectado COM escopo comprovado: é o que faz o preflight ter
  // o que dizer além de "desconectado".
  await prisma.integracao.create({
    data: {
      workspaceId: ws.id, userId: u.id, plataforma: 'instagram', status: 'conectado',
      accessToken: `TOKEN-SECRETO-${marca}`, tokenExpiry: AMANHA,
      accountId: '178414', accountName: '@loja',
      extraData: {
        [CAMPO_DOS_SCOPES]: ['instagram_content_publish'],
        [CAMPO_DA_COMPROVACAO]: new Date().toISOString(),
      } as never,
    },
  })
  return { wsId: ws.id, produtoId: p.id, userId: u.id }
}

before(async () => {
  if (!TEM_BANCO) return
  const a = await montarWorkspace('A')
  wsA = a.wsId
  produtoA = a.produtoId
  userA = a.userId
  wsB = (await montarWorkspace('B')).wsId
})

after(async () => {
  if (!TEM_BANCO) return
  for (const ws of criados) {
    await prisma.mLFeatureSnapshot.deleteMany({ where: { workspaceId: ws } })
    await prisma.linkDinamico.updateMany({ where: { workspaceId: ws }, data: { publicacaoId: null } })
    await prisma.eventoLink.deleteMany({ where: { workspaceId: ws } })
    await prisma.linkDinamico.deleteMany({ where: { workspaceId: ws } })
    await prisma.publicacao.deleteMany({ where: { workspaceId: ws } })
    await prisma.automationJob.deleteMany({ where: { workspaceId: ws } })
    await prisma.conteudo.deleteMany({ where: { workspaceId: ws } })
    await prisma.produto.deleteMany({ where: { workspaceId: ws } })
    await prisma.integracao.deleteMany({ where: { workspaceId: ws } })
    await prisma.auditLog.deleteMany({ where: { workspaceId: ws } })
    await prisma.user.deleteMany({ where: { workspaceId: ws } })
  }
  await prisma.workspace.deleteMany({ where: { id: { in: criados } } })
  await prisma.$disconnect()
})

describe(
  'Produto → Oportunidade → Plano → Job → Executor → Conteudo → Preflight → Dry Run',
  { skip: !TEM_BANCO ? 'DATABASE_URL ausente — exige Postgres' : false },
  () => {
    test('nada está ligado antes de começar', () => {
      // Se algum destes deixar de estar vazio, o E2E passa a poder publicar
      // de verdade — e este teste é o que avisa.
      assert.deepEqual(Object.keys(ADAPTADORES_LIGADOS), [])
      assert.deepEqual(Object.keys(RENOVADORES_LIGADOS), [])
      assert.deepEqual(Object.keys(adaptadoresHabilitados(ENV)), [])
    })

    test('O CICLO INTEIRO, de uma ponta à outra', async () => {
      const porta = portaPrisma()

      // 1-3. Produto → Oportunidade → Plano → fila desejada.
      const ciclo = await rodarCicloDeOportunidades({
        porta, agora: AGORA, escrever: true, capacidades: CAPS_PLANO, workspaceIds: [wsA],
      })
      assert.equal(ciclo.erros, 0)
      assert.equal(ciclo.oportunidadesAvaliadas, 1, 'o produto virou oportunidade')
      assert.equal(ciclo.itensDePlano, 1, 'a oportunidade virou item de plano')
      assert.equal(ciclo.jobsCriados, 1, 'o item de plano virou job')
      assert.equal(ciclo.custoTotal, 0)

      // 4. O job existe, e é a DEPENDÊNCIA da mídia — não geração.
      //    Antes da P1.9.2 era um GERAR_CONTEUDO de TEXTO_COM_LINK, que o
      //    adapter do Instagram nunca publicaria.
      const jobs = await prisma.automationJob.findMany({
        where: { workspaceId: wsA },
        select: { id: true, tipo: true, estado: true, classe: true, motivoHumano: true, entityId: true, tentativas: true },
      })
      assert.equal(jobs.length, 1)
      assert.equal(jobs[0].tipo, 'SINCRONIZAR_MIDIA_AUTORIZADA')
      assert.equal(jobs[0].estado, 'WAITING', 'dependência humana não é reivindicável')
      assert.equal(jobs[0].classe, 'EXIGE_HUMANO')
      assert.equal(jobs[0].motivoHumano, 'MISSING_AUTHORIZED_MEDIA')
      assert.equal(jobs[0].entityId, produtoA)
      assert.equal(jobs[0].tentativas, 0)

      // 5. Executor: não há o que executar, e nada é gerado.
      const laco = await rodarFilaDoWorkspace({
        porta, workspaceId: wsA, workerId: `e2e-${marca}`,
        capacidades: SEM_CAPACIDADE, agora: AGORA, limite: 5,
      })
      assert.equal(laco.executados, 0, JSON.stringify(laco.detalhes))
      assert.equal(await prisma.conteudo.count({ where: { workspaceId: wsA } }), 0, 'nenhuma peça inútil')

      // 6. A dona fornece o vídeo: direito registrado, Reel validado, copy.
      const peca = await prepararPecaComMidiaPropria({
        workspaceId: wsA, produtoId: produtoA, videoUrl: VIDEO_PROPRIO_URL, gravar: true,
        reel: REEL_VALIDO, env: ENV, agora: AGORA,
        declaracao: {
          origem: 'PROPRIO', declaradoPor: userA, descricao: 'vídeo que a dona gravou',
          declaracoes: DECLARACOES_COMPLETAS,
        },
      })
      assert.ok(peca.contentId, peca.montagem.ok ? '' : peca.montagem.motivos.join('|'))
      const conteudo = await prisma.conteudo.findUniqueOrThrow({
        where: { id: peca.contentId! },
        select: { id: true, legendaInstagram: true, videoUrl: true, produtoId: true },
      })
      assert.equal(conteudo.produtoId, produtoA)
      assert.ok(conteudo.legendaInstagram!.includes(textoDisclosure('afiliado')), 'a peça sai com o disclosure')
      assert.equal(conteudo.videoUrl, VIDEO_PROPRIO_URL)

      // 7. Link rastreado GERADO (para a bio não abrir um 404) e preflight:
      //    pronto, e não executável — o link ainda não foi confirmado na bio.
      const link = await gerarLinkParaABio({ workspaceId: wsA, contentId: conteudo.id, canal: 'instagram', env: ENV })
      assert.equal(link.ok, true, link.explicacao)
      const pf = await preflightDePublicacao({
        workspaceId: wsA, canal: 'instagram', contentId: conteudo.id, env: ENV,
      })
      assert.equal(pf.conectado, true)
      assert.deepEqual(pf.scopesComprovados, ['instagram_content_publish'])
      assert.equal(pf.capabilityEfetiva.publicar, true, 'a CONTA está pronta')
      assert.equal(pf.formato, 'VIDEO_PROPRIO')
      assert.equal(pf.aceitoPeloAdapter, true)
      assert.equal(pf.midiaAutorizada, true, pf.motivoDaMidia ?? '')
      assert.equal(pf.disclosurePresente, true)
      assert.equal(pf.custoZero, true)
      assert.equal(pf.pronto, true, pf.explicacao.join(' | '))
      assert.equal(pf.executavelAgora, false)
      assert.equal(pf.bloqueio, 'LINK_NA_BIO_NAO_CONFIRMADO')
      assert.equal(pf.link!.estrategia, 'BIO')
      assert.equal(pf.link!.gerado, true)
      assert.equal(pf.link!.estado, 'AGUARDANDO_CONFIRMACAO')
      assert.equal(pf.link!.url, link.url)

      // 8. A confirmação humana: agora só o canal desligado segura.
      const conf = await confirmarLinkNaBio({
        workspaceId: wsA, contentId: conteudo.id, canal: 'instagram', url: link.url!, confirmadoPor: userA, env: ENV,
      })
      assert.equal(conf.ok, true, conf.explicacao)
      const pf2 = await preflightDePublicacao({ workspaceId: wsA, canal: 'instagram', contentId: conteudo.id, env: ENV })
      assert.equal(pf2.link!.estado, 'CONFIRMADO')
      assert.equal(pf2.executavelAgora, false)
      assert.equal(pf2.bloqueio, 'ADAPTER_DESLIGADO')

      // 9. Dry run: o caminho inteiro sem enviar e sem gravar.
      const pubAntes = await prisma.publicacao.count({ where: { workspaceId: wsA } })
      const ensaio = await simularDistribuicao({
        workspaceId: wsA, contentId: conteudo.id, canal: 'instagram', env: ENV,
      })
      assert.equal(ensaio.simulado, true)
      assert.equal(ensaio.enviouAoCanal, false)
      assert.equal(ensaio.criouPublicacao, false)
      assert.equal(ensaio.acaoQueSeriaTomada, 'NENHUMA', 'nada sai com o canal desligado')
      assert.equal(ensaio.payload!.urlQueSeriaUsada, link.url, 'o ensaio usa o link confirmado')
      assert.equal(ensaio.payload!.urlNaLegenda, false)
      assert.equal(await prisma.publicacao.count({ where: { workspaceId: wsA } }), pubAntes)

      // 10. O saldo: nenhuma Publicacao; um link, o da bio.
      assert.equal(await prisma.publicacao.count({ where: { workspaceId: wsA } }), 0)
      assert.equal(await prisma.linkDinamico.count({ where: { workspaceId: wsA } }), 1)
    })

    test('SEGUNDA volta do ciclo não duplica job nem peça', async () => {
      const porta = portaPrisma()
      const conteudosAntes = await prisma.conteudo.count({ where: { workspaceId: wsA } })

      const ciclo = await rodarCicloDeOportunidades({
        porta, agora: AGORA, escrever: true, capacidades: CAPS_PLANO, workspaceIds: [wsA],
      })
      // O job anterior concluiu (SUCCEEDED = terminal). O plano continua
      // desejando a mesma coisa, então nasce um job novo com a MESMA chave?
      // Não: a chave é a mesma, mas o job terminal não bloqueia um novo
      // ciclo — o que não pode é existir DOIS ativos com a mesma chave.
      const porChave = await prisma.automationJob.groupBy({
        by: ['chave'],
        where: { workspaceId: wsA, estado: { in: ['PENDING', 'RUNNING', 'WAITING', 'FAILED_RETRYABLE'] } },
        _count: { chave: true },
      })
      for (const g of porChave) {
        assert.equal(g._count.chave, 1, `chave ${g.chave} tem mais de um job ativo`)
      }

      const laco = await rodarFilaDoWorkspace({
        porta, workspaceId: wsA, workerId: `e2e2-${marca}`,
        capacidades: SEM_CAPACIDADE, agora: AGORA, limite: 5,
      })
      const conteudosDepois = await prisma.conteudo.count({ where: { workspaceId: wsA } })
      assert.equal(
        conteudosDepois,
        conteudosAntes + laco.sucessos,
        'cada sucesso produz no máximo uma peça, e nenhuma volta duplica a anterior'
      )
      assert.equal(ciclo.custoTotal, 0)
    })

    test('RETRY não duplica: o mesmo job retomado reusa a peça', async () => {
      // Cenário real: o worker caiu depois de criar a peça. O contexto do
      // job guarda o contentId, e a retomada reencontra em vez de gerar.
      const porta = portaPrisma()
      const job = await prisma.automationJob.findFirst({
        where: { workspaceId: wsA, tipo: 'GERAR_CONTEUDO', estado: 'SUCCEEDED' },
        select: { id: true, contexto: true },
      })
      if (!job) return // nada a retomar neste cenário
      const ctx = (job.contexto ?? {}) as Record<string, unknown>
      assert.ok(typeof ctx.contentId === 'string' && ctx.contentId, 'o contexto guarda a peça criada')

      const antes = await prisma.conteudo.count({ where: { workspaceId: wsA } })
      await prisma.automationJob.update({
        where: { id: job.id },
        data: { estado: 'PENDING', workerId: null, claimedAt: null },
      })
      const laco = await rodarFilaDoWorkspace({
        porta, workspaceId: wsA, workerId: `retomada-${marca}`,
        capacidades: SEM_CAPACIDADE, agora: AGORA, limite: 3,
      })
      assert.ok(laco.executados >= 1)
      assert.equal(
        await prisma.conteudo.count({ where: { workspaceId: wsA } }),
        antes,
        'a retomada reusou a peça — nenhuma nova'
      )
    })

    test('WORKSPACE ISOLADO: o ciclo de A nunca toca em B', async () => {
      const porta = portaPrisma()
      const antesB = {
        jobs: await prisma.automationJob.count({ where: { workspaceId: wsB } }),
        conteudos: await prisma.conteudo.count({ where: { workspaceId: wsB } }),
      }
      await rodarCicloDeOportunidades({
        porta, agora: AGORA, escrever: true, capacidades: CAPS_PLANO, workspaceIds: [wsA],
      })
      await rodarFilaDoWorkspace({
        porta, workspaceId: wsA, workerId: `iso-${marca}`,
        capacidades: SEM_CAPACIDADE, agora: AGORA, limite: 5,
      })
      assert.equal(await prisma.automationJob.count({ where: { workspaceId: wsB } }), antesB.jobs)
      assert.equal(await prisma.conteudo.count({ where: { workspaceId: wsB } }), antesB.conteudos)

      // E o preflight de B não enxerga a peça de A.
      const daA = await prisma.conteudo.findFirstOrThrow({ where: { workspaceId: wsA }, select: { id: true } })
      const pf = await preflightDePublicacao({
        workspaceId: wsB, canal: 'instagram', contentId: daA.id, env: ENV,
      })
      assert.equal(pf.bloqueio, 'CONTEUDO_INDISPONIVEL')
      assert.equal(pf.executavelAgora, false)
    })

    test('NENHUM provider foi chamado: o espião não registra nada', async () => {
      // Injetar um adapter no dry run e conferir que ele não é tocado prova
      // mais que contar Publicacao: prova que o caminho nem chega lá.
      const chamadas: string[] = []
      const espiao: AdaptadorDeCanal = {
        canal: 'instagram',
        publicar: async () => {
          chamadas.push('publicou')
          return { ok: true, publicacaoExternaId: 'x', erro: null }
        },
        enviarDraft: async () => {
          chamadas.push('draft')
          return { ok: true, publicacaoExternaId: 'x', erro: null }
        },
      }
      const conteudo = await prisma.conteudo.findFirstOrThrow({
        where: { workspaceId: wsA }, select: { id: true },
      })
      const r = await simularDistribuicao({
        workspaceId: wsA, contentId: conteudo.id, canal: 'instagram',
        env: { ...ENV, PUBLICACAO_REAL_INSTAGRAM: 'true' },
        adaptadores: { instagram: espiao },
      })
      assert.equal(chamadas.length, 0, 'o ensaio não pode tocar o adapter')
      assert.equal(r.enviouAoCanal, false)
      assert.equal(r.criouPublicacao, false)
    })

    test('SALDO FINAL: nenhuma Publicacao, só o link da bio, nenhum custo', async () => {
      for (const ws of [wsA, wsB]) {
        assert.equal(await prisma.publicacao.count({ where: { workspaceId: ws } }), 0)
        assert.equal(await prisma.eventoLink.count({ where: { workspaceId: ws } }), 0)
      }
      // P1.9.2: o link da bio é gerado ANTES da publicação, de propósito.
      assert.equal(await prisma.linkDinamico.count({ where: { workspaceId: wsA } }), 1)
      assert.equal(await prisma.linkDinamico.count({ where: { workspaceId: wsB } }), 0)
      // E nenhum job ficou com tentativa queimada sem motivo.
      const jobs = await prisma.automationJob.findMany({
        where: { workspaceId: wsA },
        select: { tipo: true, estado: true, tentativas: true },
      })
      for (const j of jobs) {
        if (j.estado === 'SUCCEEDED') assert.ok(j.tentativas <= 1, `${j.tipo} gastou ${j.tentativas}`)
      }
    })
  }
)
