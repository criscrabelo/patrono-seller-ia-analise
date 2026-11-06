/**
 * P1.5.4 — o ciclo diário de oportunidades, em ensaio e em operação.
 *
 * O que estes testes precisam provar antes de alguém ligar isto todo dia:
 * o ensaio não grava, a operação é idempotente, um workspace não enxerga
 * o outro, capacidade ausente vira espera em vez de falha, e nada disso
 * publica nem gasta.
 *
 * Sem provider pago. Sem publicação. Custo R$ 0,00.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '../lib/prisma'
import {
  rodarCicloDeOportunidades,
  planejarWorkspace,
  capacidadesDeclaradas,
  contarQueNasceriamWaiting,
  TIPOS_DESTE_CICLO,
  CICLO_NAO_PUBLICA_NEM_GERA,
} from '../lib/ciclo-de-oportunidades'
import { portaPrisma } from '../lib/automation-queue-prisma'
import { perfilDaDependencia, podeExecutarSozinho } from '../lib/automation-queue-contrato'

const TEM_BANCO = !!process.env.DATABASE_URL
const RAIZ = join(__dirname, '..')
const marca = `r46-${Date.now()}`
const AGORA = new Date('2026-09-24T05:00:00Z')

const criados: string[] = []
let wsA = ''
let wsB = ''

// ── Capacidade declarada ────────────────────────────────────────────────

describe('A capacidade vem do ambiente, fail-closed', () => {
  test('nada declarado = nada disponível', () => {
    const c = capacidadesDeclaradas({})
    assert.equal(c.FFMPEG, false)
    assert.equal(c.DIGITAL_TWIN_GPU, false)
  })

  test('só a string `true` habilita', () => {
    assert.equal(capacidadesDeclaradas({ FFMPEG_DISPONIVEL: 'true' }).FFMPEG, true)
    for (const v of ['1', 'yes', 'sim', '']) {
      assert.equal(capacidadesDeclaradas({ FFMPEG_DISPONIVEL: v }).FFMPEG, false, v)
    }
  })

  test('NENHUMA variável de ambiente autoriza gasto', () => {
    for (const env of [
      {},
      { PROVEDOR_PAGO_AUTORIZADO: 'true' },
      { PAID_AI_ENABLED: 'true' },
      { AI_MONTHLY_BUDGET: '999' },
    ]) {
      assert.equal(capacidadesDeclaradas(env).PROVEDOR_PAGO_AUTORIZADO, false, JSON.stringify(env))
    }
  })
})

// ── Escopo ──────────────────────────────────────────────────────────────

describe('O ciclo não publica, não gera e não gasta', () => {
  test('o escopo está declarado e inclui as três proibições', () => {
    for (const p of ['publicar', 'chamar provider pago', 'gerar conteúdo']) {
      assert.ok(CICLO_NAO_PUBLICA_NEM_GERA.naoFaz.includes(p as never), p)
    }
  })

  test('nenhuma rota de publicação é alcançável a partir do ciclo', () => {
    const codigo = readFileSync(join(RAIZ, 'lib/ciclo-de-oportunidades.ts'), 'utf8')
    // IMPORT e CHAMADA, não a prosa: o comentário do módulo cita
    // ADAPTADORES_LIGADOS justamente para dizer onde mora o portão de
    // publicação — que é fora daqui.
    const linhasDeImport = (codigo.match(/^import[\s\S]*?from '[^']+'/gm) ?? []).join(' ')
    for (const proibido of [
      'publicacao-fluxo',
      'distribuicao-orquestrador',
      'adaptadores-reais',
      'instagram',
      'tiktok-channel',
    ]) {
      assert.ok(!linhasDeImport.includes(proibido), `o ciclo não pode importar ${proibido}`)
    }
    for (const chamada of [
      /prepararTentativaDePublicacao\s*\(/,
      /confirmarDistribuicao\s*\(/,
      /distribuirConteudo\s*\(/,
      /publicarReelInstagram\s*\(/,
      /gerarConteudoDoJob\s*\(/,
      /rodarFilaDoWorkspace\s*\(/,
    ]) {
      assert.ok(!chamada.test(codigo), `${chamada} não pode ser chamado pelo ciclo`)
    }
  })

  test('nenhum provider pago é citado', () => {
    const codigo = readFileSync(join(RAIZ, 'lib/ciclo-de-oportunidades.ts'), 'utf8').toLowerCase()
    for (const pago of ['fal.ai', 'fal-ai', 'anthropic', 'openai', 'elevenlabs']) {
      assert.ok(!codigo.includes(pago), pago)
    }
  })

  test('a rota exige Bearer e recusa sem segredo', () => {
    const codigo = readFileSync(join(RAIZ, 'app/api/cron/oportunidades/route.ts'), 'utf8')
    assert.match(codigo, /if \(!secret\)/)
    assert.match(codigo, /autorizacaoDeRotinaValida\(req\.headers\.get\('authorization'\), secret\)/)
    assert.match(codigo, /status: 401/)
    // O ensaio é opt-in: o padrão do cron diário é operar, não ensaiar.
    assert.match(codigo, /const ensaio = modo === 'ensaio'/)
  })

  test('o ciclo administra só os tipos dele', () => {
    assert.ok(!TIPOS_DESTE_CICLO.includes('RENOVAR_TOKEN' as never))
    assert.ok(!TIPOS_DESTE_CICLO.includes('DISTRIBUIR_CONTEUDO' as never))
  })
})

// ── WAITING previsto ────────────────────────────────────────────────────

describe('Capacidade ausente vira espera, não falha', () => {
  const job = (tipo: string) =>
    ({ chave: `k-${tipo}`, tipo, entityType: 'PRODUTO', entityId: 'p', classe: 'X', motivoHumano: null, contexto: {}, explicacao: '' }) as never

  test('conta como WAITING exatamente quem não executa sozinho', () => {
    const tipos = ['GERAR_CONTEUDO', 'CONECTAR_CANAL', 'HABILITAR_CAPACIDADE', 'SINCRONIZAR_MIDIA_AUTORIZADA']
    const esperado = tipos.filter((t) => !podeExecutarSozinho(perfilDaDependencia(t))).length
    assert.equal(contarQueNasceriamWaiting(tipos.map(job)), esperado)
    assert.equal(esperado, 3, 'só GERAR_CONTEUDO é automatizável entre esses')
  })

  test('lista vazia não quebra', () => {
    assert.equal(contarQueNasceriamWaiting([]), 0)
  })
})

// ── Contra o banco ──────────────────────────────────────────────────────

before(async () => {
  if (!TEM_BANCO) return
  for (const n of ['A', 'B']) {
    const ws = await prisma.workspace.create({
      // P2.14.5.12: o ciclo só cria tarefas em workspace AUTOMATIC e despausado.
      data: { name: `R46-${n}`, ownerId: `${marca}-${n}`, automationPaused: false, automationMode: 'AUTOMATIC' },
      select: { id: true },
    })
    criados.push(ws.id)
  }
  ;[wsA, wsB] = criados

  for (const [i, ws] of criados.entries()) {
    const u = await prisma.user.create({
      data: { email: `${marca}-${i}@teste.local`, name: 'U', password: 'x', workspaceId: ws },
      select: { id: true },
    })
    // Produto sem direito de mídia: sobra TEXTO_COM_LINK, que roda sem
    // capacidade nenhuma — é o caminho que fecha o ciclo de verdade.
    for (const cat of ['casa', 'pet']) {
      await prisma.produto.create({
        data: {
          workspaceId: ws, userId: u.id, nome: `${marca}-${cat}`, categoria: cat,
          tipoVenda: 'Afiliado', origemConteudo: 'Licenciado',
          imagens: [], linkProduto: 'https://loja.invalido/p', preco: 60,
        },
      })
    }
    await prisma.integracao.create({
      data: {
        workspaceId: ws, userId: u.id, plataforma: 'instagram', status: 'conectado',
        accessToken: `TOKEN-${marca}`, accountId: 'x',
      },
    })
  }
})

after(async () => {
  if (!TEM_BANCO) return
  for (const ws of criados) {
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
  'Ensaio e operação percorrem o mesmo caminho',
  { skip: !TEM_BANCO ? 'DATABASE_URL ausente — exige Postgres' : false },
  () => {
    const rodar = (escrever: boolean, ws = wsA) =>
      rodarCicloDeOportunidades({
        porta: portaPrisma(),
        agora: AGORA,
        escrever,
        capacidades: { FFMPEG: false, DIGITAL_TWIN_GPU: false, PROVEDOR_PAGO_AUTORIZADO: false },
        workspaceIds: [ws],
      })

    test('ENSAIO não grava uma linha sequer', async () => {
      const antes = await prisma.automationJob.count({ where: { workspaceId: wsA } })
      const r = await rodar(false)
      assert.equal(r.escreveu, false)
      assert.ok(r.oportunidadesAvaliadas > 0, 'o cenário precisa ter oportunidade')
      assert.ok(r.jobsCriados > 0, 'e o ensaio precisa prever criação')
      assert.equal(await prisma.automationJob.count({ where: { workspaceId: wsA } }), antes)
    })

    test('o ensaio PREVÊ exatamente o que a operação cria', async () => {
      const ensaio = await rodar(false)
      const real = await rodar(true)
      assert.equal(real.escreveu, true)
      assert.equal(real.jobsCriados, ensaio.jobsCriados, 'previsão e realidade batem')
      assert.equal(
        await prisma.automationJob.count({ where: { workspaceId: wsA } }),
        real.jobsCriados
      )
    })

    test('DOIS CRONS SEGUIDOS não duplicam nada', async () => {
      const primeiro = await rodar(true)
      const depois = await prisma.automationJob.count({ where: { workspaceId: wsA } })
      const segundo = await rodar(true)
      assert.equal(segundo.jobsCriados, 0, 'nada novo a criar')
      assert.equal(segundo.jobsMantidos, primeiro.jobsMantidos + primeiro.jobsCriados)
      assert.equal(await prisma.automationJob.count({ where: { workspaceId: wsA } }), depois)
    })

    test('job já resolvido não reaparece sem mudança material', async () => {
      await rodar(true)
      const job = await prisma.automationJob.findFirstOrThrow({ where: { workspaceId: wsA } })
      await prisma.automationJob.update({ where: { id: job.id }, data: { estado: 'SUCCEEDED' } })
      const r = await rodar(true)
      const atual = await prisma.automationJob.findUniqueOrThrow({ where: { id: job.id } })
      assert.equal(atual.estado, 'SUCCEEDED', 'o terminal fica terminal')
      assert.equal(
        await prisma.automationJob.count({ where: { workspaceId: wsA, chave: job.chave } }),
        1,
        'e não nasce um gêmeo com a mesma chave'
      )
      assert.ok(r.jobsCriados >= 0)
    })

    test('WORKSPACE ISOLADO: o ciclo de A não toca em B', async () => {
      await prisma.automationJob.deleteMany({ where: { workspaceId: wsB } })
      await rodar(true, wsA)
      assert.equal(await prisma.automationJob.count({ where: { workspaceId: wsB } }), 0)

      const rb = await rodar(true, wsB)
      assert.ok(rb.jobsCriados > 0, 'B tem o próprio plano')
      const deB = await prisma.automationJob.findMany({
        where: { workspaceId: wsB },
        select: { workspaceId: true },
      })
      for (const j of deB) assert.equal(j.workspaceId, wsB)
    })

    test('capacidade ausente: o job de geração nasce WAITING', async () => {
      await prisma.automationJob.deleteMany({ where: { workspaceId: wsA } })
      const r = await rodar(true)
      const jobs = await prisma.automationJob.findMany({
        where: { workspaceId: wsA },
        select: { tipo: true, estado: true, tentativas: true },
      })
      assert.ok(jobs.length > 0)
      for (const j of jobs) {
        const perfil = perfilDaDependencia(j.tipo)
        const esperado = podeExecutarSozinho(perfil) ? 'PENDING' : 'WAITING'
        assert.equal(j.estado, esperado, `${j.tipo} deveria nascer ${esperado}`)
        assert.equal(j.tentativas, 0, 'nada consome tentativa ao nascer')
      }
      assert.equal(r.nasceriamWaiting, jobs.filter((j) => j.estado === 'WAITING').length)
    })

    test('o relatório traz observabilidade completa, sem segredo', async () => {
      const r = await rodar(false)
      for (const campo of [
        'executadoEm', 'workspaces', 'oportunidadesAvaliadas', 'jobsCriados',
        'jobsMantidos', 'jobsCancelados', 'nasceriamWaiting', 'erros', 'custoTotal',
      ]) {
        assert.ok(campo in r, `falta ${campo} no relatório`)
      }
      assert.equal(r.porWorkspace[0].workspaceId, wsA)
      assert.equal(r.erros, 0)
      const texto = JSON.stringify(r)
      for (const proibido of ['accessToken', 'TOKEN-', 'CRON_SECRET', 'Bearer', 'password']) {
        assert.ok(!texto.includes(proibido), `${proibido} não pode entrar no relatório`)
      }
    })

    test('CUSTO R$ 0,00 no ensaio e na operação', async () => {
      for (const escrever of [false, true]) {
        const r = await rodar(escrever)
        assert.equal(r.custoTotal, 0)
        for (const w of r.porWorkspace) assert.equal(w.custo, 0)
      }
    })

    test('NENHUMA Publicacao nasce do ciclo', async () => {
      await rodar(true)
      assert.equal(await prisma.publicacao.count({ where: { workspaceId: wsA } }), 0)
      assert.equal(await prisma.conteudo.count({ where: { workspaceId: wsA } }), 0)
    })

    test('P2.14.5.12: pausado, MANUAL e ASSISTED não criam nem cancelam tarefa', async () => {
      try {
        await prisma.automationJob.deleteMany({ where: { workspaceId: wsB } })
        await rodar(true, wsB)
        const antes = await prisma.automationJob.count({ where: { workspaceId: wsB } })
        assert.ok(antes > 0, 'o cenário precisa ter tarefa enfileirada')

        for (const controles of [
          { automationPaused: true, automationMode: 'AUTOMATIC' },
          { automationPaused: false, automationMode: 'MANUAL' },
          { automationPaused: false, automationMode: 'ASSISTED' },
        ]) {
          await prisma.workspace.update({ where: { id: wsB }, data: controles })
          const r = await rodar(true, wsB)
          const linha = r.porWorkspace[0]
          assert.equal(linha.jobsCriados, 0, JSON.stringify(controles))
          assert.equal(linha.jobsCancelados, 0, JSON.stringify(controles))
          assert.equal(await prisma.automationJob.count({ where: { workspaceId: wsB } }), antes)
          if (controles.automationMode === 'ASSISTED') {
            assert.equal(linha.modo, 'ASSISTED')
            assert.ok(linha.candidatos.length > 0 && linha.candidatos.length <= 3)
            assert.ok(linha.candidatos.every((c) => c.motivoDaPosicao.length > 0))
          } else {
            assert.equal(linha.candidatos.length, 0)
          }
        }
      } finally {
        await prisma.workspace.update({
          where: { id: wsB },
          data: { automationPaused: false, automationMode: 'AUTOMATIC' },
        })
      }
    })

    test('um workspace quebrado não derruba os outros', async () => {
      const r = await rodarCicloDeOportunidades({
        porta: portaPrisma(),
        agora: AGORA,
        escrever: false,
        capacidades: { FFMPEG: false, DIGITAL_TWIN_GPU: false, PROVEDOR_PAGO_AUTORIZADO: false },
        workspaceIds: ['workspace-que-nao-existe', wsA],
      })
      assert.equal(r.workspaces, 2)
      // O inexistente simplesmente não tem catálogo: zero oportunidade, sem
      // erro. O importante é que o laço seguiu e A foi avaliado.
      assert.ok(r.porWorkspace[1].oportunidadesAvaliadas > 0)
    })

    test('planejarWorkspace é só leitura', async () => {
      await prisma.automationJob.deleteMany({ where: { workspaceId: wsA } })
      const r = await planejarWorkspace({
        workspaceId: wsA,
        agora: AGORA,
        capacidades: { FFMPEG: false, DIGITAL_TWIN_GPU: false, PROVEDOR_PAGO_AUTORIZADO: false },
      })
      assert.ok(r.desejados.length > 0)
      assert.equal(await prisma.automationJob.count({ where: { workspaceId: wsA } }), 0)
    })
  }
)
