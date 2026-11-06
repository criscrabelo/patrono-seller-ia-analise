/**
 * P1.4 — Fábrica de Conteúdo Autônoma Gratuita.
 *
 * Item do plano em PRONTO_PARA_GERAR_CONTEUDO vira `Conteudo` real, por
 * caminhos que já existem e custam R$ 0,00.
 *
 * Nenhum teste chama fal.ai, Anthropic ou API de publicação. Nenhuma
 * `Publicacao` nasce daqui.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '../lib/prisma'
import {
  FORMATOS_GRATUITOS,
  FORMATOS_NAO_PRODUZIDOS,
  MOTIVOS_SEM_CAPACIDADE,
  TIPO_JOB_GERACAO,
  FABRICA_NAO_PUBLICA,
  ehFormatoGratuito,
  avaliarCapacidade,
  custoAutorizado,
  jobsDeGeracaoDoPlano,
  gerarConteudoDoJob,
  type CapacidadesDeGeracao,
} from '../lib/fabrica-de-conteudo'
import { perfilDaDependencia, jobsDesejadosDoPlano, podeExecutarSozinho } from '../lib/automation-queue-contrato'
import { portaPrisma } from '../lib/automation-queue-prisma'
import { criarOuSincronizarAutomationJob } from '../lib/automation-queue-repositorio'
import type { ItemDoPlano } from '../lib/plano-de-acao'

const TEM_BANCO = !!process.env.DATABASE_URL
const RAIZ = join(__dirname, '..')
const AGORA = new Date('2026-09-23T12:00:00.000Z')
const marca = `r39-${Date.now()}`

/** Custo zero é o padrão: PAID_AI_ENABLED ausente, orçamento zero. */
const ENV_GRATUITO = {}
const ENV_PAGO = { PAID_AI_ENABLED: 'true', AI_MONTHLY_BUDGET: '500', AI_BUDGET_AUTORIZADO_POR: 'titular', AI_BUDGET_AUTORIZADO_ATE: '2099-12-31' }

const CAPACIDADES_OK: CapacidadesDeGeracao = {
  ffmpeg: true,
  chatterbox: true,
  memoriaLivreBytes: 8 * 1024 ** 3,
}

const lerCodigo = (rel: string) =>
  readFileSync(join(RAIZ, rel), 'utf8')
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n')

let wsA = ''
let wsB = ''
let produtoA = ''
let produtoB = ''
let produtoSemDireito = ''
const criados: string[] = []

const itemDoPlano = (over: Partial<ItemDoPlano> = {}): ItemDoPlano => ({
  workspaceId: wsA,
  produtoId: produtoA,
  produtoNome: 'Produto',
  categoria: 'eletronicos',
  scoreDaOportunidade: 80,
  prioridadeOperacional: 76,
  posicao: 1,
  // P1.9.2: canal SEM adapter real. Estes testes exercitam a mecânica da
  // fábrica; o Instagram tem regra própria (só Reel com vídeo) e é testado
  // à parte, no fim deste arquivo e na rodada 49.
  canalRecomendado: 'facebook',
  formatoRecomendado: 'VIDEO_9X16_FFMPEG_NARRADO',
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

// ── Escopo e custo ──────────────────────────────────────────────────────

describe('Escopo: a fábrica gera, não publica', () => {
  test('só dois formatos são produzidos, e nenhum é pago', () => {
    assert.deepEqual([...FORMATOS_GRATUITOS], ['VIDEO_9X16_FFMPEG_NARRADO', 'TEXTO_COM_LINK'])
    assert.equal(ehFormatoGratuito('VIDEO_IA_GERADO'), false)
    assert.ok(FORMATOS_NAO_PRODUZIDOS.VIDEO_IA_GERADO.includes('pago'))
  })

  test('o que NÃO é produzido tem motivo escrito', () => {
    for (const [formato, motivo] of Object.entries(FORMATOS_NAO_PRODUZIDOS)) {
      assert.ok(motivo.length > 20, `${formato} sem explicação`)
    }
  })

  test('a não-publicação está declarada', () => {
    assert.equal(FABRICA_NAO_PUBLICA.estado, 'DELIBERADAMENTE_FORA_DE_ESCOPO')
    assert.deepEqual([...FABRICA_NAO_PUBLICA.provedoresProibidos], ['fal.ai', 'anthropic', 'resend', 'z-api'])
  })

  test('o módulo NÃO chama provider pago nem publica', () => {
    const codigo = lerCodigo('lib/fabrica-de-conteudo.ts')
    // IMPORT e CHAMADA, nunca a mencao. `FABRICA_NAO_PUBLICA` LISTA os
    // provedores proibidos — procurar pela palavra acusaria a propria
    // proibicao como violacao.
    for (const importProibido of [
      "from './falai'", "from './claude'", "from './instagram'",
      "from './publicacao-fluxo'", "from './publicacao-repositorio'",
    ]) {
      assert.ok(!codigo.includes(importProibido), `${importProibido} nao pode ser importado`)
    }
    for (const chamada of [
      'publicarReel(', 'publicarContainer(', 'prepararTentativaDePublicacao(',
      'confirmarDistribuicao(', 'prisma.publicacao.', 'fetch(',
    ]) {
      assert.ok(!codigo.includes(chamada), `${chamada} nao pode ser chamado`)
    }
  })

  test('a copy vem do gerador gratuito que já existia', () => {
    const codigo = lerCodigo('lib/fabrica-de-conteudo.ts')
    assert.match(codigo, /gerarConteudoGratuito/)
    // E não de uma segunda implementação.
    assert.ok(!codigo.includes('montarRoteiro'), 'nenhum gerador paralelo')
  })

  test('o CreativeFactory que já existia NÃO foi substituído', () => {
    const antigo = lerCodigo('lib/creative-factory.ts')
    assert.match(antigo, /export function textoDisclosure/, 'compliance-engine depende disto')
    assert.match(antigo, /export interface RendererProvider/, 'autopilot depende disto')
  })
})

describe('CostSafetyGate — custo zero é porta', () => {
  test('com o padrão, o caminho pago é BLOQUEADO', async () => {
    const r = await custoAutorizado({ workspaceId: 'w', provider: 'fal.ai', operacao: 'gerar-video', env: ENV_GRATUITO })
    assert.equal(r.permitido, false)
    assert.match(r.explicacao, /PAID_AI_ENABLED|não estão habilitados/i)
  })

  test('Anthropic também é bloqueada por padrão', async () => {
    const r = await custoAutorizado({ workspaceId: 'w', provider: 'anthropic', operacao: 'gerar-roteiro', env: ENV_GRATUITO })
    assert.equal(r.permitido, false)
  })

  test('provider desconhecido é bloqueado por precaução', async () => {
    const r = await custoAutorizado({ workspaceId: 'w', provider: 'servico-novo', operacao: 'x', env: ENV_PAGO })
    assert.equal(r.permitido, false)
    assert.match(r.explicacao, /catálogo/i)
  })
})

// ── Capacidade ──────────────────────────────────────────────────────────

describe('Capacidade técnica — fail-closed', () => {
  test('TEXTO_COM_LINK não precisa de render nem voz', () => {
    const r = avaliarCapacidade('TEXTO_COM_LINK', { ffmpeg: false, chatterbox: false, memoriaLivreBytes: 0 }, ENV_GRATUITO)
    assert.equal(r.pode, true)
  })

  test('vídeo sem FFmpeg não pode', () => {
    const r = avaliarCapacidade('VIDEO_9X16_FFMPEG_NARRADO', { ...CAPACIDADES_OK, ffmpeg: false }, ENV_GRATUITO)
    assert.equal(r.pode, false)
    assert.equal(r.motivo, 'FFMPEG_INDISPONIVEL')
  })

  test('vídeo sem Chatterbox não pode — e não há substituto pago', () => {
    const r = avaliarCapacidade('VIDEO_9X16_FFMPEG_NARRADO', { ...CAPACIDADES_OK, chatterbox: false }, ENV_GRATUITO)
    assert.equal(r.pode, false)
    assert.equal(r.motivo, 'CHATTERBOX_INDISPONIVEL')
    assert.match(r.explicacao, /não há substituto pago/i)
  })

  test('MEMÓRIA insuficiente não pode — e o job espera, não falha', () => {
    const r = avaliarCapacidade(
      'VIDEO_9X16_FFMPEG_NARRADO',
      { ...CAPACIDADES_OK, memoriaLivreBytes: 512 * 1024 ** 2 },
      { DIGITAL_TWIN_MIN_FREE_RAM_GB: '3' }
    )
    assert.equal(r.pode, false)
    assert.equal(r.motivo, 'MEMORIA_INSUFICIENTE')
    assert.match(r.explicacao, /assim que houver memória/i)
  })

  test('formato pago é recusado como NÃO PRODUZIDO', () => {
    const r = avaliarCapacidade('VIDEO_IA_GERADO', CAPACIDADES_OK, ENV_GRATUITO)
    assert.equal(r.pode, false)
    assert.equal(r.motivo, 'FORMATO_NAO_PRODUZIDO')
  })

  test('com tudo disponível, o vídeo gratuito pode', () => {
    const r = avaliarCapacidade('VIDEO_9X16_FFMPEG_NARRADO', CAPACIDADES_OK, { DIGITAL_TWIN_MIN_FREE_RAM_GB: '3' })
    assert.equal(r.pode, true)
    assert.match(r.explicacao, /R\$ 0,00/)
  })

  test('todo motivo pertence à lista declarada', () => {
    for (const caso of [
      avaliarCapacidade('X', CAPACIDADES_OK, ENV_GRATUITO),
      avaliarCapacidade('VIDEO_9X16_FFMPEG_NARRADO', { ...CAPACIDADES_OK, ffmpeg: false }, ENV_GRATUITO),
    ]) {
      assert.ok((MOTIVOS_SEM_CAPACIDADE as readonly string[]).includes(caso.motivo!))
    }
  })
})

// ── GERAR_CONTEUDO na fila ──────────────────────────────────────────────

describe('GERAR_CONTEUDO entra na fila que já existe', () => {
  test('tem perfil automatizável, com retry', () => {
    const p = perfilDaDependencia(TIPO_JOB_GERACAO)
    assert.equal(p.classe, 'AUTOMATIZAVEL')
    assert.ok(p.maxTentativas > 0)
    assert.equal(podeExecutarSozinho(p), true)
  })

  test('continua FORA da fila de DEPENDÊNCIAS', () => {
    // Geração é execução, não coisa que falta. As duas rotas usam a mesma
    // tabela, mas a de dependências não o enfileira.
    const r = jobsDesejadosDoPlano('ws-1', [
      { chave: 'x', produtoId: 'p1', dependencia: 'GERAR_CONTEUDO', explicacao: '', repetivel: true },
    ])
    assert.deepEqual(r, [])
  })

  test('nenhuma tabela nova foi criada', () => {
    const schema = readFileSync(join(RAIZ, 'prisma/schema.prisma'), 'utf8')
    assert.ok(!/model CreativeJob|model GeracaoJob|model ContentJob/.test(schema))
  })
})

// ── Banco ───────────────────────────────────────────────────────────────

describe(
  'Geração real, contra o banco',
  { skip: !TEM_BANCO ? 'DATABASE_URL ausente — exige Postgres' : false },
  () => {
    before(async () => {
      for (const n of ['A', 'B']) {
        const ws = await prisma.workspace.create({
          data: { name: `R39-${n}`, ownerId: `${marca}-${n}` },
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

      const criarProduto = async (ws: string, uid: string, nome: string, over: Record<string, unknown> = {}) =>
        (
          await prisma.produto.create({
            data: {
              workspaceId: ws, userId: uid, nome, categoria: 'eletronicos',
              tipoVenda: 'Afiliado', origemConteudo: 'Proprio', preco: 150,
              imagens: ['https://img.invalido/1.jpg'], beneficios: ['dura mais'],
              ...over,
            } as never,
            select: { id: true },
          })
        ).id
      produtoA = await criarProduto(wsA, uA, `${marca}-a`)
      produtoB = await criarProduto(wsB, uB, `${marca}-b`)
      // Origem que NÃO autoriza derivar mídia.
      produtoSemDireito = await criarProduto(wsA, uA, `${marca}-sem-direito`, { origemConteudo: 'TikTokShop' })
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

    test('item PRONTO cria job de geração', async () => {
      const jobs = jobsDeGeracaoDoPlano(wsA, [itemDoPlano()])
      assert.equal(jobs.length, 1)
      assert.equal(jobs[0].tipo, TIPO_JOB_GERACAO)
      assert.equal(jobs[0].classe, 'AUTOMATIZAVEL')
      assert.equal(jobs[0].contexto.custoEstimado, 0)

      const porta = portaPrisma()
      const r = await criarOuSincronizarAutomationJob({
        porta, workspaceId: wsA, tipo: jobs[0].tipo,
        entityType: jobs[0].entityType, entityId: jobs[0].entityId,
        contexto: jobs[0].contexto, agora: AGORA,
      })
      assert.equal(r.ok, true, r.explicacao)
      assert.equal(r.job!.estado, 'PENDING', 'automatizável entra na fila')
    })

    test('item NÃO pronto não vira job', () => {
      for (const over of [
        { estado: 'AGUARDANDO_CANAL' as const },
        { canalRecomendado: null },
        { formatoRecomendado: 'VIDEO_IA_GERADO' },
        { custoEstimado: 5 },
      ]) {
        assert.deepEqual(jobsDeGeracaoDoPlano(wsA, [itemDoPlano(over)]), [], JSON.stringify(over))
      }
    })

    test('WORKSPACE ISOLADO: item de outro negócio não vira job', () => {
      assert.deepEqual(jobsDeGeracaoDoPlano(wsA, [itemDoPlano({ workspaceId: wsB })]), [])
    })

    test('MUDANÇA MATERIAL gera chave nova, não sobrescreve', () => {
      const a = jobsDeGeracaoDoPlano(wsA, [itemDoPlano()])[0]
      // P2.17.10: o TikTok agora tem adapter real (só vídeo), como o Instagram; youtube segue sem adapter.
      const b = jobsDeGeracaoDoPlano(wsA, [itemDoPlano({ canalRecomendado: 'youtube' })])[0]
      const c = jobsDeGeracaoDoPlano(wsA, [itemDoPlano({ formatoRecomendado: 'TEXTO_COM_LINK' })])[0]
      assert.equal(new Set([a.chave, b.chave, c.chave]).size, 3)
    })

    // ── A geração ─────────────────────────────────────────────────────

    test('gera Conteudo real, com copy determinística e custo zero', async () => {
      const r = await gerarConteudoDoJob({
        workspaceId: wsA, produtoId: produtoA,
        formato: 'TEXTO_COM_LINK', canal: 'facebook',
        capacidades: CAPACIDADES_OK, agora: AGORA, env: ENV_GRATUITO,
      })
      assert.equal(r.ok, true, r.explicacao)
      assert.equal(r.custo, 0)
      assert.ok(r.contentId)

      const c = await prisma.conteudo.findUniqueOrThrow({ where: { id: r.contentId! } })
      assert.equal(c.workspaceId, wsA)
      assert.equal(c.produtoId, produtoA)
      assert.equal(c.redeSocial, 'facebook')
      assert.equal(c.status, 'roteiro_gerado')
      assert.ok(c.roteiro && c.roteiro.length > 0)
      assert.ok(c.legendaInstagram && c.legendaInstagram.length > 0)
      assert.ok(c.hashtags.length > 0)
    })

    test('a PROVENIÊNCIA fica registrada, e nunca como operação real', async () => {
      const r = await gerarConteudoDoJob({
        workspaceId: wsA, produtoId: produtoA,
        formato: 'TEXTO_COM_LINK', canal: 'facebook',
        capacidades: CAPACIDADES_OK, agora: AGORA, env: ENV_GRATUITO,
      })
      const c = await prisma.conteudo.findUniqueOrThrow({ where: { id: r.contentId! } })
      const alertas = c.alertasCompliance as unknown as Record<string, unknown>[]
      const proveniencia = alertas.find((a) => a.tipo === 'proveniencia')
      assert.ok(proveniencia, 'a origem automática precisa estar registrada')
      assert.equal(proveniencia!.acaoRecomendada, 'NAO_E_OPERACAO_REAL')
      assert.match(String(proveniencia!.mensagem), /R\$ 0,00/)

      // E nada foi marcado como REAL_OPERATION em lugar nenhum.
      assert.equal(await prisma.mLFeatureSnapshot.count({ where: { workspaceId: wsA } }), 0)
    })

    test('RETRY não duplica Conteudo, asset nem render', async () => {
      const primeira = await gerarConteudoDoJob({
        workspaceId: wsA, produtoId: produtoA,
        formato: 'TEXTO_COM_LINK', canal: 'facebook',
        capacidades: CAPACIDADES_OK, agora: AGORA, env: ENV_GRATUITO,
      })
      const antes = await prisma.conteudo.count({ where: { workspaceId: wsA } })

      const retry = await gerarConteudoDoJob({
        workspaceId: wsA, produtoId: produtoA,
        formato: 'TEXTO_COM_LINK', canal: 'facebook',
        contentIdExistente: primeira.contentId,
        capacidades: CAPACIDADES_OK, agora: AGORA, env: ENV_GRATUITO,
      })
      assert.equal(retry.ok, true)
      assert.equal(retry.reaproveitado, true, 'retry reusa a peça')
      assert.equal(retry.contentId, primeira.contentId)
      assert.equal(await prisma.conteudo.count({ where: { workspaceId: wsA } }), antes)
    })

    test('MÍDIA SEM DIREITO bloqueia o vídeo', async () => {
      const r = await gerarConteudoDoJob({
        workspaceId: wsA, produtoId: produtoSemDireito,
        formato: 'VIDEO_9X16_FFMPEG_NARRADO', canal: 'facebook',
        capacidades: CAPACIDADES_OK, agora: AGORA,
        env: { DIGITAL_TWIN_MIN_FREE_RAM_GB: '3' },
      })
      assert.equal(r.ok, false)
      assert.equal(r.erro, 'MIDIA_SEM_DIREITO')
      assert.equal(r.custo, 0)
    })

    test('SEM CAPACIDADE não gera e não é fatal — o job espera', async () => {
      const r = await gerarConteudoDoJob({
        workspaceId: wsA, produtoId: produtoA,
        formato: 'VIDEO_9X16_FFMPEG_NARRADO', canal: 'facebook',
        capacidades: { ...CAPACIDADES_OK, ffmpeg: false },
        agora: AGORA, env: ENV_GRATUITO,
      })
      assert.equal(r.ok, false)
      assert.equal(r.erro, 'FFMPEG_INDISPONIVEL')
      assert.notEqual(r.erroFatal, true, 'falta de capacidade não é falha definitiva')
    })

    test('MEMÓRIA insuficiente não gera e não é fatal', async () => {
      const r = await gerarConteudoDoJob({
        workspaceId: wsA, produtoId: produtoA,
        formato: 'VIDEO_9X16_FFMPEG_NARRADO', canal: 'facebook',
        capacidades: { ...CAPACIDADES_OK, memoriaLivreBytes: 100 * 1024 ** 2 },
        agora: AGORA, env: { DIGITAL_TWIN_MIN_FREE_RAM_GB: '3' },
      })
      assert.equal(r.ok, false)
      assert.equal(r.erro, 'MEMORIA_INSUFICIENTE')
      assert.notEqual(r.erroFatal, true)
    })

    test('produto de OUTRO workspace é FATAL, não retry', async () => {
      const r = await gerarConteudoDoJob({
        workspaceId: wsA, produtoId: produtoB,
        formato: 'TEXTO_COM_LINK', canal: 'facebook',
        capacidades: CAPACIDADES_OK, agora: AGORA, env: ENV_GRATUITO,
      })
      assert.equal(r.ok, false)
      assert.equal(r.erroFatal, true, 'produto alheio não melhora tentando de novo')
      assert.equal(await prisma.conteudo.count({ where: { workspaceId: wsA, produtoId: produtoB } }), 0)
    })

    test('DOIS WORKERS não geram a mesma peça — a fila garante', async () => {
      await prisma.automationJob.deleteMany({ where: { workspaceId: wsA } })
      const porta = portaPrisma()
      const job = jobsDeGeracaoDoPlano(wsA, [itemDoPlano({ formatoRecomendado: 'TEXTO_COM_LINK' })])[0]
      await criarOuSincronizarAutomationJob({
        porta, workspaceId: wsA, tipo: job.tipo, entityType: job.entityType,
        entityId: job.entityId, contexto: job.contexto, agora: AGORA,
      })

      const agora = new Date()
      const [a, b] = await Promise.all([
        porta.reivindicar(wsA, 'worker-1', agora),
        porta.reivindicar(wsA, 'worker-2', agora),
      ])
      const pegos = [a, b].filter(Boolean)
      assert.equal(pegos.length, 1, 'só um worker leva o job de geração')
    })

    test('NENHUMA Publicacao nasceu da geração', async () => {
      assert.equal(await prisma.publicacao.count({ where: { workspaceId: { in: criados } } }), 0)
      assert.ok(
        (await prisma.conteudo.count({ where: { workspaceId: wsA } })) > 0,
        'mas conteúdo foi gerado — é esse o ponto da rodada'
      )
    })

    test('nenhum modelo foi treinado ou promovido', async () => {
      assert.equal(await prisma.mLModel.count({ where: { workspaceId: { in: criados } } }), 0)
      assert.equal(await prisma.mLTrainingRun.count({ where: { workspaceId: { in: criados } } }), 0)
    })
  }
)
