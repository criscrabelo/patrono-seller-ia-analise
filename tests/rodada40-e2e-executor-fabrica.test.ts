/**
 * P1.4.1 — E2E do executor da Fábrica de Conteúdo.
 *
 * Prova que a automação anda SOZINHA, sem ninguém chamar função à mão:
 *
 *   Plano → AutomationJob GERAR_CONTEUDO → claim → fábrica → Conteudo
 *         → resultado no job → estado final
 *
 * Tudo contra Postgres real. Nenhuma publicação, nenhum provider pago.
 */

import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '../lib/prisma'
import { portaPrisma } from '../lib/automation-queue-prisma'
import { criarOuSincronizarAutomationJob } from '../lib/automation-queue-repositorio'
import { jobsDeGeracaoDoPlano, type CapacidadesDeGeracao } from '../lib/fabrica-de-conteudo'
import {
  rodarFilaDoWorkspace,
  reavaliarAguardando,
  comHeartbeat,
  acoesDoExecutor,
  PUBLICACAO_DO_EXECUTOR,
} from '../lib/executor-da-fila'
import type { ItemDoPlano } from '../lib/plano-de-acao'

const TEM_BANCO = !!process.env.DATABASE_URL
const RAIZ = join(__dirname, '..')
const AGORA = new Date('2026-09-23T12:00:00.000Z')
const marca = `r40-${Date.now()}`
const ENV = { DIGITAL_TWIN_MIN_FREE_RAM_GB: '3' }

const TUDO_OK: CapacidadesDeGeracao = { ffmpeg: true, chatterbox: true, memoriaLivreBytes: 8 * 1024 ** 3 }
const SEM_FFMPEG: CapacidadesDeGeracao = { ...TUDO_OK, ffmpeg: false }
const SEM_CHATTERBOX: CapacidadesDeGeracao = { ...TUDO_OK, chatterbox: false }
const SEM_MEMORIA: CapacidadesDeGeracao = { ...TUDO_OK, memoriaLivreBytes: 100 * 1024 ** 2 }

let wsA = ''
let wsB = ''
let produtoA = ''
let produtoB = ''
const criados: string[] = []
const porta = portaPrisma()

const itemDoPlano = (over: Partial<ItemDoPlano> = {}): ItemDoPlano => ({
  workspaceId: wsA,
  produtoId: produtoA,
  produtoNome: 'Produto',
  categoria: 'eletronicos',
  scoreDaOportunidade: 80,
  prioridadeOperacional: 76,
  posicao: 1,
  // P1.9.2: canal SEM adapter real — o teste é da mecânica do executor.
  // O Instagram só aceita Reel com vídeo, e tem testes próprios (rodada 49).
  canalRecomendado: 'facebook',
  formatoRecomendado: 'TEXTO_COM_LINK',
  estado: 'PRONTO_PARA_GERAR_CONTEUDO',
  proximaAcao: 'GERAR_CONTEUDO',
  podeExecutarAutomaticamente: true,
  dependenciaExterna: null,
  confianca: 'MEDIA',
  bloqueios: [],
  motivo: ['teste'],
  custoEstimado: 0,
  ...over,
})

/** Enfileira o job de geração do item, como o cron de oportunidades faria. */
async function enfileirar(item: ItemDoPlano) {
  const desejado = jobsDeGeracaoDoPlano(item.workspaceId, [item])[0]
  assert.ok(desejado, 'o item precisa virar job')
  const r = await criarOuSincronizarAutomationJob({
    porta,
    workspaceId: item.workspaceId,
    tipo: desejado.tipo,
    entityType: desejado.entityType,
    entityId: desejado.entityId,
    contexto: desejado.contexto,
    agora: AGORA,
  })
  assert.equal(r.ok, true, r.explicacao)
  return r.job!
}

// ── Auditoria do wiring ─────────────────────────────────────────────────

describe('O executor liga a fila à fábrica', () => {
  test('a ação de GERAR_CONTEUDO está registrada', () => {
    const acoes = acoesDoExecutor({
      workspaceId: 'w', workerId: 'x', capacidades: TUDO_OK, agora: AGORA,
    })
    assert.ok(typeof acoes.GERAR_CONTEUDO === 'function')
  })

  test('a rota de cron existe e chama o laço', () => {
    const rota = readFileSync(join(RAIZ, 'app/api/cron/executar-fila/route.ts'), 'utf8')
    assert.match(rota, /rodarFilaDoWorkspace/)
    assert.match(rota, /portaPrisma/)
    assert.match(rota, /CRON_SECRET/)
  })

  test('o cron está agendado', () => {
    // O agendamento saiu do `vercel.json` e foi para o GitHub Actions: o
    // plano Hobby recusa cron sub-diário, e o `*/30` deste executor era um
    // dos dois que deixavam o projeto INDEPLOYÁVEL. A exigência não
    // afrouxou — mudou de arquivo.
    const fluxo = readFileSync(join(RAIZ, '.github/workflows/patrono-crons.yml'), 'utf8')
    assert.match(fluxo, /chamar "executar-fila"/)
    assert.match(fluxo, /- cron: '0 \* \* \* \*'/)
  })

  test('o executor NÃO publica', () => {
    assert.equal(PUBLICACAO_DO_EXECUTOR.estado, 'SOMENTE_COM_DECISAO_APROVADA_E_ADAPTER_LIGADO')
    assert.deepEqual([...PUBLICACAO_DO_EXECUTOR.tiposExecutados], [
      'GERAR_CONTEUDO',
      'DISTRIBUIR_CONTEUDO',
      // P1.5.1: renovar acesso e o oposto de publicar — nao poe nada no ar.
      'RENOVAR_TOKEN',
    ])
    // O portao do P1.4.1 nao afrouxou: ele mudou de lugar. Nenhum canal
    // esta ligado, entao distribuir continua nao publicando nada.
    assert.deepEqual(PUBLICACAO_DO_EXECUTOR.adaptadoresLigados(), [])

    const codigo = readFileSync(join(RAIZ, 'lib/executor-da-fila.ts'), 'utf8')
      .split(/\r?\n/)
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n')
    for (const proibido of [
      'prisma.publicacao', 'publicarReel(', 'confirmarDistribuicao(',
      "from './falai'", "from './claude'", "from './instagram'",
    ]) {
      assert.ok(!codigo.includes(proibido), `${proibido} não pode aparecer`)
    }
  })
})

// ── Heartbeat ───────────────────────────────────────────────────────────

describe('Heartbeat durante trabalho pesado', () => {
  test('renova enquanto a promessa não resolve', async () => {
    const renovacoes: string[] = []
    const r = await comHeartbeat(
      'job-1',
      'worker-1',
      async () => {
        await new Promise((res) => setTimeout(res, 120))
        return 'pronto'
      },
      30,
      async (id, worker) => {
        renovacoes.push(`${id}:${worker}`)
        return true
      }
    )
    assert.equal(r, 'pronto')
    assert.ok(renovacoes.length >= 2, `esperava várias renovações, houve ${renovacoes.length}`)
    assert.ok(renovacoes.every((x) => x === 'job-1:worker-1'))
  })

  test('para de renovar quando o trabalho termina', async () => {
    let renovacoes = 0
    await comHeartbeat('j', 'w', async () => 'ok', 10, async () => { renovacoes++; return true })
    const depoisDoFim = renovacoes
    await new Promise((res) => setTimeout(res, 60))
    assert.equal(renovacoes, depoisDoFim, 'o intervalo tem de ser limpo')
  })

  test('erro no trabalho ainda limpa o intervalo', async () => {
    let renovacoes = 0
    await assert.rejects(() =>
      comHeartbeat('j', 'w', async () => { throw new Error('quebrou') }, 10, async () => { renovacoes++; return true })
    )
    const depois = renovacoes
    await new Promise((res) => setTimeout(res, 60))
    assert.equal(renovacoes, depois)
  })
})

// ── Banco ───────────────────────────────────────────────────────────────

describe(
  'E2E do executor contra Postgres',
  { skip: !TEM_BANCO ? 'DATABASE_URL ausente — exige Postgres' : false },
  () => {
    before(async () => {
      for (const n of ['A', 'B']) {
        const ws = await prisma.workspace.create({
          data: { name: `R40-${n}`, ownerId: `${marca}-${n}` },
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

      const criarProduto = async (ws: string, uid: string, nome: string) =>
        (
          await prisma.produto.create({
            data: {
              workspaceId: ws, userId: uid, nome, categoria: 'eletronicos',
              tipoVenda: 'Afiliado', origemConteudo: 'Proprio', preco: 150,
              imagens: ['https://img.invalido/1.jpg'], beneficios: ['dura mais'],
            },
            select: { id: true },
          })
        ).id
      produtoA = await criarProduto(wsA, uA, `${marca}-a`)
      produtoB = await criarProduto(wsB, uB, `${marca}-b`)
    })

    beforeEach(async () => {
      await prisma.automationJob.deleteMany({ where: { workspaceId: { in: criados } } })
      await prisma.conteudo.deleteMany({ where: { workspaceId: { in: criados } } })
    })

    after(async () => {
      for (const ws of criados) {
        await prisma.automationJob.deleteMany({ where: { workspaceId: ws } })
        await prisma.publicacao.deleteMany({ where: { workspaceId: ws } })
        await prisma.conteudo.deleteMany({ where: { workspaceId: ws } })
        await prisma.produto.deleteMany({ where: { workspaceId: ws } })
        await prisma.user.deleteMany({ where: { workspaceId: ws } })
      }
      await prisma.workspace.deleteMany({ where: { id: { in: criados } } })
      await prisma.$disconnect()
    })

    // ── Sucesso ponta a ponta ─────────────────────────────────────────

    test('PLANO → JOB → CLAIM → FÁBRICA → CONTEUDO → SUCCEEDED', async () => {
      const job = await enfileirar(itemDoPlano())
      assert.equal(job.estado, 'PENDING', 'nasce PENDING')
      assert.equal(await prisma.conteudo.count({ where: { workspaceId: wsA } }), 0)

      const r = await rodarFilaDoWorkspace({
        porta, workspaceId: wsA, workerId: 'worker-e2e',
        capacidades: TUDO_OK, agora: AGORA, env: ENV,
      })

      assert.equal(r.executados, 1)
      assert.equal(r.sucessos, 1)
      assert.equal(r.falhas, 0)

      // EXATAMENTE um Conteudo.
      const conteudos = await prisma.conteudo.findMany({ where: { workspaceId: wsA } })
      assert.equal(conteudos.length, 1)
      assert.equal(conteudos[0].produtoId, produtoA)
      assert.equal(conteudos[0].redeSocial, 'facebook')

      // O job terminou certo, com resultado auditável.
      const final = await prisma.automationJob.findUniqueOrThrow({ where: { id: job.id } })
      assert.equal(final.estado, 'SUCCEEDED')
      assert.ok(final.resolvidoEm, 'resolvidoEm preenchido')
      assert.equal(final.workerId, null, 'o worker soltou o job')

      const ctx = final.contexto as Record<string, unknown>
      assert.equal(ctx.contentId, conteudos[0].id, 'o contentId fica no contexto')
      assert.equal(ctx.formato, 'TEXTO_COM_LINK')
      assert.equal(ctx.canal, 'facebook')
      assert.equal(ctx.custo, 0, 'custo R$ 0,00')
      assert.ok(ctx.concluidoEm)
    })

    test('o job passou por RUNNING antes de concluir', async () => {
      const job = await enfileirar(itemDoPlano())
      // O claim é o que muda para RUNNING.
      const pego = await porta.reivindicar(wsA, 'w', new Date())
      assert.ok(pego)
      assert.equal(pego!.id, job.id)
      assert.equal(pego!.estado, 'RUNNING')
      assert.ok(pego!.claimedAt && pego!.heartbeatAt)
    })

    // ── Retry / idempotência ──────────────────────────────────────────

    test('QUEDA depois de criar a peça: retomada reusa, não duplica', async () => {
      const job = await enfileirar(itemDoPlano())

      // Simula o crash: a ação cria a peça e "cai" antes de concluir.
      const primeiro = await rodarFilaDoWorkspace({
        porta, workspaceId: wsA, workerId: 'worker-que-caiu',
        capacidades: TUDO_OK, agora: AGORA, env: ENV,
      })
      assert.equal(primeiro.sucessos, 1)
      const contentId = (
        (await prisma.automationJob.findUniqueOrThrow({ where: { id: job.id } })).contexto as Record<string, unknown>
      ).contentId as string
      assert.ok(contentId)

      // Força o job de volta à fila, como se a conclusão não tivesse sido
      // gravada — mantendo o contexto com o contentId.
      await porta.atualizar(job.id, { estado: 'PENDING', resolvidoEm: null, workerId: null })

      const segundo = await rodarFilaDoWorkspace({
        porta, workspaceId: wsA, workerId: 'worker-novo',
        capacidades: TUDO_OK, agora: AGORA, env: ENV,
      })
      assert.equal(segundo.sucessos, 1)

      // NENHUM Conteudo a mais.
      const conteudos = await prisma.conteudo.findMany({ where: { workspaceId: wsA }, select: { id: true } })
      assert.equal(conteudos.length, 1, 'retomada não pode duplicar a peça')
      assert.equal(conteudos[0].id, contentId, 'e reencontra a mesma')

      const final = await prisma.automationJob.findUniqueOrThrow({ where: { id: job.id } })
      assert.equal(final.estado, 'SUCCEEDED')
      assert.equal((final.contexto as Record<string, unknown>).contentId, contentId)
    })

    // ── WAITING por capacidade ────────────────────────────────────────

    for (const [nome, capacidades, motivo] of [
      ['FFmpeg ausente', SEM_FFMPEG, 'FFMPEG_INDISPONIVEL'],
      ['Chatterbox ausente', SEM_CHATTERBOX, 'CHATTERBOX_INDISPONIVEL'],
      ['memória insuficiente', SEM_MEMORIA, 'MEMORIA_INSUFICIENTE'],
    ] as const) {
      test(`vídeo com ${nome} vira WAITING, não FAILED`, async () => {
        const job = await enfileirar(itemDoPlano({ formatoRecomendado: 'VIDEO_9X16_FFMPEG_NARRADO' }))
        const r = await rodarFilaDoWorkspace({
          porta, workspaceId: wsA, workerId: 'w', capacidades, agora: AGORA, env: ENV,
        })
        assert.equal(r.aguardando, 1)
        assert.equal(r.falhas, 0)

        const final = await prisma.automationJob.findUniqueOrThrow({ where: { id: job.id } })
        assert.equal(final.estado, 'WAITING')
        assert.equal(final.tentativas, 0, 'esperar não gasta tentativa')
        const ctx = final.contexto as Record<string, unknown>
        assert.equal(ctx.bloqueadoPor, motivo)
        assert.equal(ctx.reavaliarQuandoHouverCapacidade, true, 'tem de ficar observável')
        assert.equal(await prisma.conteudo.count({ where: { workspaceId: wsA } }), 0)
      })
    }

    test('WAITING por capacidade VOLTA quando a capacidade volta', async () => {
      const job = await enfileirar(itemDoPlano({ formatoRecomendado: 'VIDEO_9X16_FFMPEG_NARRADO' }))
      await rodarFilaDoWorkspace({
        porta, workspaceId: wsA, workerId: 'w', capacidades: SEM_FFMPEG, agora: AGORA, env: ENV,
      })
      assert.equal((await prisma.automationJob.findUniqueOrThrow({ where: { id: job.id } })).estado, 'WAITING')

      // A máquina melhorou: o mesmo laço destrava e executa.
      const r = await rodarFilaDoWorkspace({
        porta, workspaceId: wsA, workerId: 'w2', capacidades: TUDO_OK, agora: AGORA, env: ENV,
      })
      assert.equal(r.destravados, 1, 'ninguém fica em WAITING eterno')
      assert.equal(r.sucessos, 1)
      assert.equal((await prisma.automationJob.findUniqueOrThrow({ where: { id: job.id } })).estado, 'SUCCEEDED')
    })

    test('a reavaliação NÃO destrava quem espera decisão humana', async () => {
      const r = await criarOuSincronizarAutomationJob({
        porta, workspaceId: wsA, tipo: 'CONECTAR_CANAL',
        entityType: 'PRODUTO', entityId: produtoA, agora: AGORA,
      })
      assert.equal(r.job!.estado, 'WAITING')

      const reav = await reavaliarAguardando({ porta, workspaceId: wsA, capacidades: TUDO_OK, env: ENV })
      assert.equal(reav.destravados, 0, 'OAuth não aparece porque a memória voltou')
      assert.equal((await prisma.automationJob.findUniqueOrThrow({ where: { id: r.job!.id } })).estado, 'WAITING')
    })

    // ── Falhas ────────────────────────────────────────────────────────

    test('a porta NÃO deixa trocar a identidade do job', async () => {
      // `entityId` e `tipo` definem o que o job é. Se pudessem mudar, a
      // chave de idempotência deixaria de descrever a linha.
      const r = await criarOuSincronizarAutomationJob({
        porta, workspaceId: wsA, tipo: 'GERAR_CONTEUDO',
        entityType: 'PRODUTO', entityId: produtoA,
        contexto: { formato: 'TEXTO_COM_LINK', canal: 'facebook', custoEstimado: 0 },
        agora: AGORA,
      })
      await porta.atualizar(r.job!.id, { entityId: 'outro', tipo: 'OUTRA_COISA' } as never)
      const depois = await prisma.automationJob.findUniqueOrThrow({ where: { id: r.job!.id } })
      assert.equal(depois.entityId, produtoA)
      assert.equal(depois.tipo, 'GERAR_CONTEUDO')
    })

    test('produto QUE SUMIU é FATAL, sem loop', async () => {
      // O produto existia quando o job nasceu e foi apagado depois. Tentar
      // de novo não o traz de volta.
      const uid = (
        await prisma.user.findFirstOrThrow({ where: { workspaceId: wsA }, select: { id: true } })
      ).id
      const efemero = await prisma.produto.create({
        data: {
          workspaceId: wsA, userId: uid, nome: `${marca}-efemero`, categoria: 'x',
          tipoVenda: 'Afiliado', origemConteudo: 'Proprio',
        },
        select: { id: true },
      })
      const r = await criarOuSincronizarAutomationJob({
        porta, workspaceId: wsA, tipo: 'GERAR_CONTEUDO',
        entityType: 'PRODUTO', entityId: efemero.id,
        contexto: { formato: 'TEXTO_COM_LINK', canal: 'facebook', custoEstimado: 0 },
        agora: AGORA,
      })
      await prisma.produto.delete({ where: { id: efemero.id } })

      const laco = await rodarFilaDoWorkspace({
        porta, workspaceId: wsA, workerId: 'w', capacidades: TUDO_OK, agora: AGORA, env: ENV,
      })
      assert.equal(laco.falhas, 1)
      const final = await prisma.automationJob.findUniqueOrThrow({ where: { id: r.job!.id } })
      assert.equal(final.estado, 'FAILED_FINAL')
      assert.equal(final.proximaTentativaEm, null, 'sem loop')
    })

    // ── Concorrência ──────────────────────────────────────────────────

    test('DOIS WORKERS no mesmo job: só um executa, uma peça nasce', async () => {
      await enfileirar(itemDoPlano())
      const [a, b] = await Promise.all([
        rodarFilaDoWorkspace({ porta, workspaceId: wsA, workerId: 'w1', capacidades: TUDO_OK, agora: AGORA, env: ENV, limite: 1 }),
        rodarFilaDoWorkspace({ porta, workspaceId: wsA, workerId: 'w2', capacidades: TUDO_OK, agora: AGORA, env: ENV, limite: 1 }),
      ])
      assert.equal(a.executados + b.executados, 1, 'só um worker pegou o job')
      assert.equal(await prisma.conteudo.count({ where: { workspaceId: wsA } }), 1, 'uma peça só')
    })

    test('WORKSPACE ISOLADO: o laço de A não toca a fila de B', async () => {
      await enfileirar(itemDoPlano())
      const r = await rodarFilaDoWorkspace({
        porta, workspaceId: wsB, workerId: 'worker-b', capacidades: TUDO_OK, agora: AGORA, env: ENV,
      })
      assert.equal(r.executados, 0, 'a fila de B está vazia')
      assert.equal(await prisma.conteudo.count({ where: { workspaceId: wsB } }), 0)
      assert.equal(await prisma.conteudo.count({ where: { workspaceId: wsA } }), 0, 'e a de A não foi executada por B')
    })

    // ── Escopo ────────────────────────────────────────────────────────

    test('o laço não publicou nada', async () => {
      await enfileirar(itemDoPlano())
      await rodarFilaDoWorkspace({
        porta, workspaceId: wsA, workerId: 'w', capacidades: TUDO_OK, agora: AGORA, env: ENV,
      })
      assert.equal(await prisma.publicacao.count({ where: { workspaceId: { in: criados } } }), 0)
      assert.equal(await prisma.mLFeatureSnapshot.count({ where: { workspaceId: { in: criados } } }), 0)
      assert.ok((await prisma.conteudo.count({ where: { workspaceId: wsA } })) > 0, 'mas gerou conteúdo')
    })
  }
)
