/**
 * P1.3 — a Automation Queue contra PostgreSQL REAL.
 *
 * O adaptador em memória da rodada 37 imitava a unique e o SKIP LOCKED.
 * Imitação não prova concorrência: quem garante que dois workers não levam
 * o mesmo job é o Postgres, e é ele que roda aqui.
 *
 * Nenhum teste publica, gera conteúdo ou chama provider. Custo R$ 0,00.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../lib/prisma'
import { portaPrisma, renovarHeartbeat } from '../lib/automation-queue-prisma'
import {
  criarOuSincronizarAutomationJob,
  sincronizarFilaComPlano,
  TIMEOUT_DE_HEARTBEAT_MS,
} from '../lib/automation-queue-repositorio'
import { jobsDesejadosDoPlano } from '../lib/automation-queue-contrato'
import { validarEntidadeDaAutomacao } from '../lib/automation-queue-entidades'
import type { ItemDaFilaDeAutomacao } from '../lib/plano-de-acao'

const TEM_BANCO = !!process.env.DATABASE_URL
const marca = `r38-${Date.now()}`

let wsA = ''
let wsB = ''
let userA = ''
let produtoA = ''
let produtoB = ''
let conteudoA = ''
let publicacaoA = ''
const criados: string[] = []

/** Stale curto para provar a recuperação sem esperar cinco minutos. */
const porta = portaPrisma(TIMEOUT_DE_HEARTBEAT_MS)
const portaStaleCurto = portaPrisma(50)

const item = (over: Partial<ItemDaFilaDeAutomacao> = {}): ItemDaFilaDeAutomacao => ({
  chave: 'x',
  produtoId: produtoA,
  dependencia: 'RENOVAR_TOKEN',
  explicacao: 'faltou mídia',
  repetivel: true,
  ...over,
})

/** Insere um job direto, com o estado que o teste precisa exercitar. */
async function semear(over: Record<string, unknown> = {}) {
  return prisma.automationJob.create({
    data: {
      workspaceId: wsA,
      tipo: 'GERAR_CONTEUDO',
      chave: `${marca}-${Math.random().toString(36).slice(2)}`,
      estado: 'PENDING',
      classe: 'AUTOMATIZAVEL',
      entityType: 'PRODUTO',
      entityId: produtoA,
      ...over,
    } as never,
    select: { id: true, estado: true, workerId: true },
  })
}

describe(
  'Automation Queue em PostgreSQL real',
  { skip: !TEM_BANCO ? 'DATABASE_URL ausente — exige Postgres' : false },
  () => {
    before(async () => {
      for (const n of ['A', 'B']) {
        const ws = await prisma.workspace.create({
          data: { name: `R38-${n}`, ownerId: `${marca}-${n}` },
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
      userA = await criarUser(wsA, 'a')
      const userB = await criarUser(wsB, 'b')

      const criarProduto = async (ws: string, uid: string, nome: string) =>
        (
          await prisma.produto.create({
            data: { workspaceId: ws, userId: uid, nome, categoria: 'x', tipoVenda: 'Afiliado', origemConteudo: 'Proprio' },
            select: { id: true },
          })
        ).id
      produtoA = await criarProduto(wsA, userA, `${marca}-a`)
      produtoB = await criarProduto(wsB, userB, `${marca}-b`)

      conteudoA = (
        await prisma.conteudo.create({
          data: { workspaceId: wsA, userId: userA, produtoId: produtoA, roteiro: 'x', redeSocial: 'instagram' },
          select: { id: true },
        })
      ).id

      publicacaoA = (
        await prisma.publicacao.create({
          data: {
            workspaceId: wsA, contentId: conteudoA, provider: 'META',
            canal: 'instagram', chaveDaTentativa: `${marca}-pub`,
          },
          select: { id: true },
        })
      ).id
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

    // ── Estrutura ─────────────────────────────────────────────────────

    test('a tabela, o enum e as constraints existem no banco', async () => {
      const tabela = await prisma.$queryRaw<{ c: bigint }[]>`
        SELECT count(*) AS c FROM information_schema.tables
        WHERE table_schema='public' AND table_name='AutomationJob'`
      assert.equal(Number(tabela[0].c), 1)

      const valores = await prisma.$queryRaw<{ v: string }[]>`
        SELECT e.enumlabel::text AS v FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
        WHERE t.typname='EstadoDoAutomationJob' ORDER BY e.enumsortorder`
      assert.deepEqual(valores.map((x) => x.v), [
        'PENDING', 'RUNNING', 'WAITING', 'SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'CANCELLED',
      ])

      const indices = await prisma.$queryRaw<{ indexname: string }[]>`
        SELECT indexname::text AS indexname FROM pg_indexes WHERE schemaname='public' AND tablename='AutomationJob'
        ORDER BY indexname`
      assert.deepEqual(indices.map((i) => i.indexname), [
        'AutomationJob_pkey',
        'AutomationJob_workspaceId_chave_key',
        'AutomationJob_workspaceId_estado_heartbeatAt_idx',
        'AutomationJob_workspaceId_estado_proximaTentativaEm_idx',
      ])

      const fk = await prisma.$queryRaw<{ def: string }[]>`
        SELECT pg_get_constraintdef(con.oid) AS def FROM pg_constraint con
        JOIN pg_class rel ON rel.oid=con.conrelid
        WHERE con.contype='f' AND rel.relname='AutomationJob'`
      assert.equal(fk.length, 1)
      assert.match(fk[0].def, /FOREIGN KEY \("workspaceId"\) REFERENCES "Workspace"\(id\)/)
    })

    test('defaults e nullability batem com o SQL revisado', async () => {
      const job = await semear({ chave: `${marca}-defaults` })
      const lido = await prisma.automationJob.findUniqueOrThrow({ where: { id: job.id } })
      assert.equal(lido.estado, 'PENDING', 'default do enum')
      assert.equal(lido.tentativas, 0, 'default 0')
      assert.equal(lido.proximaTentativaEm, null)
      assert.equal(lido.workerId, null)
      assert.equal(lido.claimedAt, null)
      assert.equal(lido.heartbeatAt, null)
      assert.equal(lido.resolvidoEm, null)
      assert.equal(lido.motivoHumano, null)
      assert.ok(lido.createdAt instanceof Date)
    })

    // ── Concorrência REAL ─────────────────────────────────────────────

    test('DOIS WORKERS simultâneos nunca recebem o mesmo job — 5 iterações', async () => {
      for (let iteracao = 0; iteracao < 5; iteracao++) {
        await prisma.automationJob.deleteMany({ where: { workspaceId: wsA } })
        const criados: string[] = []
        for (let i = 0; i < 6; i++) {
          const j = await semear({ chave: `${marca}-conc-${iteracao}-${i}` })
          criados.push(j.id)
        }

        const agora = new Date()
        // Seis claims em paralelo, dois workers alternados.
        const resultados = await Promise.all([
          porta.reivindicar(wsA, 'worker-1', agora),
          porta.reivindicar(wsA, 'worker-2', agora),
          porta.reivindicar(wsA, 'worker-1', agora),
          porta.reivindicar(wsA, 'worker-2', agora),
          porta.reivindicar(wsA, 'worker-1', agora),
          porta.reivindicar(wsA, 'worker-2', agora),
        ])
        const pegos = resultados.filter((r): r is NonNullable<typeof r> => r !== null)

        // NENHUM job entregue duas vezes.
        const ids = pegos.map((p) => p.id)
        assert.equal(new Set(ids).size, ids.length, `iteração ${iteracao}: job entregue em duplicidade`)
        assert.ok(ids.length > 0, 'pelo menos um claim tem de ter sucesso')

        // Cada job com UM único workerId, e os carimbos gravados.
        for (const p of pegos) {
          assert.equal(p.estado, 'RUNNING')
          assert.ok(p.workerId === 'worker-1' || p.workerId === 'worker-2')
          assert.ok(p.claimedAt instanceof Date, 'claimedAt gravado')
          assert.ok(p.heartbeatAt instanceof Date, 'heartbeatAt gravado')
        }

        // E no banco, nenhum RUNNING sem dono.
        const noBanco = await prisma.automationJob.findMany({
          where: { workspaceId: wsA, estado: 'RUNNING' },
          select: { id: true, workerId: true, claimedAt: true, heartbeatAt: true },
        })
        assert.equal(noBanco.length, ids.length)
        for (const j of noBanco) {
          assert.ok(j.workerId, 'RUNNING sem workerId')
          assert.ok(j.claimedAt && j.heartbeatAt)
        }
      }
    })

    test('ISOLAMENTO: workers de A e B simultâneos nunca cruzam', async () => {
      await prisma.automationJob.deleteMany({ where: { workspaceId: { in: criados } } })
      for (let i = 0; i < 3; i++) {
        await semear({ chave: `${marca}-iso-a-${i}` })
        await prisma.automationJob.create({
          data: {
            workspaceId: wsB, tipo: 'GERAR_CONTEUDO',
            chave: `${marca}-iso-b-${i}`, estado: 'PENDING',
            classe: 'AUTOMATIZAVEL', entityType: 'PRODUTO', entityId: produtoB,
          } as never,
        })
      }

      const agora = new Date()
      const [a1, b1, a2, b2] = await Promise.all([
        porta.reivindicar(wsA, 'worker-A', agora),
        porta.reivindicar(wsB, 'worker-B', agora),
        porta.reivindicar(wsA, 'worker-A', agora),
        porta.reivindicar(wsB, 'worker-B', agora),
      ])
      for (const j of [a1, a2]) {
        assert.ok(j)
        assert.equal(j!.workspaceId, wsA, 'worker de A pegou job de outro workspace')
      }
      for (const j of [b1, b2]) {
        assert.ok(j)
        assert.equal(j!.workspaceId, wsB, 'worker de B pegou job de outro workspace')
      }
    })

    // ── Estados ───────────────────────────────────────────────────────

    test('só os estados executáveis são reclamados', async () => {
      await prisma.automationJob.deleteMany({ where: { workspaceId: wsA } })
      const agora = new Date()
      const futuro = new Date(agora.getTime() + 60 * 60 * 1000)
      const passado = new Date(agora.getTime() - 60 * 60 * 1000)

      // Um de cada estado NÃO reclamável.
      await semear({ chave: `${marca}-w-humano`, estado: 'WAITING', classe: 'EXIGE_HUMANO', motivoHumano: 'OAUTH_AUTHORIZATION_REQUIRED' })
      await semear({ chave: `${marca}-w-condicao`, estado: 'WAITING', classe: 'AGUARDA_CONDICAO' })
      await semear({ chave: `${marca}-final`, estado: 'FAILED_FINAL' })
      await semear({ chave: `${marca}-cancel`, estado: 'CANCELLED' })
      await semear({ chave: `${marca}-ok`, estado: 'SUCCEEDED' })
      await semear({ chave: `${marca}-retry-cedo`, estado: 'FAILED_RETRYABLE', proximaTentativaEm: futuro })

      assert.equal(await porta.reivindicar(wsA, 'w', agora), null, 'nenhum deles podia ser reclamado')

      // FAILED_RETRYABLE cuja hora chegou: pode.
      await semear({ chave: `${marca}-retry-pronto`, estado: 'FAILED_RETRYABLE', proximaTentativaEm: passado })
      const pego = await porta.reivindicar(wsA, 'w', agora)
      assert.ok(pego, 'retry vencido tem de ser reclamável')
      assert.equal(pego!.chave, `${marca}-retry-pronto`)

      // PENDING: pode.
      await semear({ chave: `${marca}-pending` })
      const pendente = await porta.reivindicar(wsA, 'w2', agora)
      assert.ok(pendente)
      assert.equal(pendente!.chave, `${marca}-pending`)

      // E os WAITING continuam intocados, sem gastar tentativa.
      const waiting = await prisma.automationJob.findMany({
        where: { workspaceId: wsA, estado: 'WAITING' },
        select: { tentativas: true, workerId: true, proximaTentativaEm: true },
      })
      assert.equal(waiting.length, 2)
      for (const w of waiting) {
        assert.equal(w.tentativas, 0)
        assert.equal(w.workerId, null)
        assert.equal(w.proximaTentativaEm, null)
      }
    })

    // ── Recuperação de worker morto ───────────────────────────────────

    test('RUNNING com heartbeat RECENTE não é roubado', async () => {
      await prisma.automationJob.deleteMany({ where: { workspaceId: wsA } })
      const agora = new Date()
      await semear({ chave: `${marca}-vivo`, estado: 'RUNNING', workerId: 'dono', claimedAt: agora, heartbeatAt: agora })
      assert.equal(await porta.reivindicar(wsA, 'ladrao', agora), null)
    })

    test('RUNNING com heartbeat EXPIRADO é recuperado por outro worker', async () => {
      await prisma.automationJob.deleteMany({ where: { workspaceId: wsA } })
      const antes = new Date(Date.now() - 60_000)
      const j = await semear({
        chave: `${marca}-morto`, estado: 'RUNNING',
        workerId: 'worker-morto', claimedAt: antes, heartbeatAt: antes,
      })

      const agora = new Date()
      const recuperado = await portaStaleCurto.reivindicar(wsA, 'worker-novo', agora)
      assert.ok(recuperado, 'job abandonado tem de voltar')
      assert.equal(recuperado!.id, j.id)
      assert.equal(recuperado!.workerId, 'worker-novo', 'troca controlada de dono')
      assert.equal(recuperado!.estado, 'RUNNING')
      assert.ok(recuperado!.heartbeatAt!.getTime() > antes.getTime(), 'heartbeat renovado')
      assert.ok(recuperado!.claimedAt!.getTime() > antes.getTime())
    })

    test('heartbeat só é renovado pelo DONO', async () => {
      await prisma.automationJob.deleteMany({ where: { workspaceId: wsA } })
      const agora = new Date()
      const j = await semear({ chave: `${marca}-hb`, estado: 'RUNNING', workerId: 'dono', heartbeatAt: agora })
      assert.equal(await renovarHeartbeat(j.id, 'outro', new Date()), false)
      assert.equal(await renovarHeartbeat(j.id, 'dono', new Date()), true)
    })

    // ── Idempotência real ─────────────────────────────────────────────

    test('dois crons simultâneos com a MESMA chave geram UM job', async () => {
      await prisma.automationJob.deleteMany({ where: { workspaceId: wsA } })
      const agora = new Date()
      const criar = () =>
        criarOuSincronizarAutomationJob({
          porta, workspaceId: wsA, tipo: 'GERAR_CONTEUDO',
          entityType: 'PRODUTO', entityId: produtoA, contexto: { canal: 'instagram' }, agora,
        })

      // Em paralelo: a unique do banco resolve a corrida.
      const [a, b, c] = await Promise.all([criar(), criar(), criar()])
      for (const r of [a, b, c]) assert.equal(r.ok, true, r.explicacao)
      assert.equal(a.job!.id, b.job!.id)
      assert.equal(b.job!.id, c.job!.id)
      assert.equal(await prisma.automationJob.count({ where: { workspaceId: wsA } }), 1)
    })

    test('a unique recusa a segunda inserção da mesma chave', async () => {
      await prisma.automationJob.deleteMany({ where: { workspaceId: wsA } })
      await semear({ chave: `${marca}-unica` })
      await assert.rejects(
        () => semear({ chave: `${marca}-unica` }),
        (e: { code?: string; meta?: { target?: unknown } }) => {
          assert.equal(e.code, 'P2002')
          assert.deepEqual(e.meta?.target, ['workspaceId', 'chave'])
          return true
        }
      )
    })

    // ── Guard polimórfico, contra o banco ─────────────────────────────

    test('entidades de outro workspace são recusadas', async () => {
      assert.equal((await validarEntidadeDaAutomacao({ workspaceId: wsA, entityType: 'PRODUTO', entityId: produtoA })).ok, true)
      assert.equal((await validarEntidadeDaAutomacao({ workspaceId: wsA, entityType: 'PRODUTO', entityId: produtoB })).ok, false)
      assert.equal((await validarEntidadeDaAutomacao({ workspaceId: wsA, entityType: 'PUBLICACAO', entityId: publicacaoA })).ok, true)
      assert.equal((await validarEntidadeDaAutomacao({ workspaceId: wsB, entityType: 'PUBLICACAO', entityId: publicacaoA })).ok, false)
      assert.equal((await validarEntidadeDaAutomacao({ workspaceId: wsA, entityType: 'PRODUTO', entityId: 'nao-existe' })).ok, false)
      assert.equal((await validarEntidadeDaAutomacao({ workspaceId: wsA, entityType: 'CANAL', entityId: 'x' })).motivo, 'TIPO_DESCONHECIDO')
    })

    test('job com entidade alheia nunca chega ao banco', async () => {
      await prisma.automationJob.deleteMany({ where: { workspaceId: wsA } })
      const r = await criarOuSincronizarAutomationJob({
        porta, workspaceId: wsA, tipo: 'GERAR_CONTEUDO',
        entityType: 'PRODUTO', entityId: produtoB, agora: new Date(),
      })
      assert.equal(r.ok, false)
      assert.equal(r.motivo, 'ENTIDADE_INVALIDA')
      assert.equal(await prisma.automationJob.count({ where: { workspaceId: wsA } }), 0)
    })

    // ── Persistência e restart ────────────────────────────────────────

    test('RESTART: o job sobrevive e é retomado pelo estado', async () => {
      await prisma.automationJob.deleteMany({ where: { workspaceId: wsA } })
      const agora = new Date()
      const desejados = jobsDesejadosDoPlano(wsA, [item()])
      await sincronizarFilaComPlano({ porta, workspaceId: wsA, desejados, agora })
      const antes = await prisma.automationJob.findFirstOrThrow({ where: { workspaceId: wsA } })

      // "Restart": instância nova da porta, nenhum estado em memória.
      const portaNova = portaPrisma()
      const depois = await portaNova.listarPorWorkspace(wsA)
      assert.equal(depois.length, 1)
      assert.equal(depois[0].id, antes.id)
      assert.equal(depois[0].estado, antes.estado)

      // E o sync seguinte não recria.
      const r = await sincronizarFilaComPlano({ porta: portaNova, workspaceId: wsA, desejados, agora })
      assert.equal(r.criados, 0)
      assert.equal(r.mantidos, 1)
      assert.equal(await prisma.automationJob.count({ where: { workspaceId: wsA } }), 1)
    })

    test('job obsoleto é CANCELADO de forma auditável, no banco', async () => {
      await prisma.automationJob.deleteMany({ where: { workspaceId: wsA } })
      const agora = new Date()
      await sincronizarFilaComPlano({ porta, workspaceId: wsA, desejados: jobsDesejadosDoPlano(wsA, [item()]), agora })
      const r = await sincronizarFilaComPlano({ porta, workspaceId: wsA, desejados: [], agora })
      assert.equal(r.cancelados, 1)

      const cancelado = await prisma.automationJob.findFirstOrThrow({ where: { workspaceId: wsA } })
      assert.equal(cancelado.estado, 'CANCELLED')
      assert.ok(cancelado.resolvidoEm)
      assert.ok(cancelado.ultimoErro)
    })

    test('job RUNNING não é cancelado pelo sync', async () => {
      await prisma.automationJob.deleteMany({ where: { workspaceId: wsA } })
      const agora = new Date()
      await sincronizarFilaComPlano({ porta, workspaceId: wsA, desejados: jobsDesejadosDoPlano(wsA, [item()]), agora })
      await porta.reivindicar(wsA, 'worker-1', agora)

      const r = await sincronizarFilaComPlano({ porta, workspaceId: wsA, desejados: [], agora })
      assert.equal(r.cancelados, 0)
      const job = await prisma.automationJob.findFirstOrThrow({ where: { workspaceId: wsA } })
      assert.equal(job.estado, 'RUNNING')
    })

    // ── Escopo ────────────────────────────────────────────────────────

    test('nada foi publicado nem gerado por esta rodada', async () => {
      // A única Publicacao é a da fixture; o único Conteudo também.
      assert.equal(await prisma.publicacao.count({ where: { workspaceId: { in: criados } } }), 1)
      assert.equal(await prisma.conteudo.count({ where: { workspaceId: { in: criados } } }), 1)
      assert.equal(await prisma.mLFeatureSnapshot.count({ where: { workspaceId: { in: criados } } }), 0)
      assert.equal(await prisma.mLModel.count({ where: { workspaceId: { in: criados } } }), 0)
    })
  }
)
