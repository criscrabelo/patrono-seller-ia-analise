/**
 * P1.3 — Automation Queue: contrato e núcleo puro.
 *
 * A persistência ainda não existe (a migration está proposta, não aplicada).
 * O que dá para provar agora — e é a parte que decide se a fila funciona —
 * é o núcleo: idempotência, sincronização, retry e classificação.
 *
 * Nenhum teste toca banco, rede ou provider. Custo R$ 0,00.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ESTADOS_DO_JOB,
  ESTADOS_ATIVOS,
  ESTADOS_TERMINAIS,
  CLASSES_DE_JOB,
  PERFIS_DE_DEPENDENCIA,
  BACKOFF_BASE_MS,
  BACKOFF_MAXIMO_MS,
  EXECUTOR_NAO_FAZ,
  MOTIVOS_HUMANOS_ACEITOS,
  perfilDaDependencia,
  podeExecutarSozinho,
  chaveDoJob,
  normalizarContexto,
  sincronizar,
  jobsDesejadosDoPlano,
  decidirAposFalha,
  resumirParaPainel,
  type JobExistente,
} from '../lib/automation-queue-contrato'
import { HUMAN_ACTION_REASONS } from '../lib/automation'
import type { ItemDaFilaDeAutomacao } from '../lib/plano-de-acao'

const RAIZ = join(__dirname, '..')
const AGORA = new Date('2026-09-23T12:00:00.000Z')

const item = (over: Partial<ItemDaFilaDeAutomacao> = {}): ItemDaFilaDeAutomacao => ({
  chave: 'x',
  produtoId: 'p1',
  dependencia: 'COMPLETAR_DADO_DO_PRODUTO',
  explicacao: 'faltou mídia',
  repetivel: true,
  ...over,
})

// ── Vocabulário reusado ─────────────────────────────────────────────────

describe('Vocabulário — estendido, não duplicado', () => {
  test('os sete estados pedidos existem', () => {
    assert.deepEqual([...ESTADOS_DO_JOB], [
      'PENDING', 'RUNNING', 'WAITING', 'SUCCEEDED',
      'FAILED_RETRYABLE', 'FAILED_FINAL', 'CANCELLED',
    ])
  })

  test('ativo e terminal são conjuntos disjuntos que cobrem tudo', () => {
    const todos = new Set([...ESTADOS_ATIVOS, ...ESTADOS_TERMINAIS])
    assert.equal(todos.size, ESTADOS_DO_JOB.length)
    for (const e of ESTADOS_ATIVOS) assert.ok(!ESTADOS_TERMINAIS.includes(e))
  })

  test('as quatro classes do Painel de Exceções estão declaradas', () => {
    assert.deepEqual([...CLASSES_DE_JOB], ['AUTOMATIZAVEL', 'TENTANDO', 'AGUARDA_CONDICAO', 'EXIGE_HUMANO'])
  })

  test('o motivo humano vem do vocabulário que já existia', () => {
    assert.equal(MOTIVOS_HUMANOS_ACEITOS, HUMAN_ACTION_REASONS)
    for (const p of Object.values(PERFIS_DE_DEPENDENCIA)) {
      if (p.motivoHumano) {
        assert.ok((HUMAN_ACTION_REASONS as readonly string[]).includes(p.motivoHumano))
      }
    }
  })

  test('o núcleo é PURO — sem banco, rede ou relógio interno', () => {
    const codigo = readFileSync(join(RAIZ, 'lib/automation-queue-contrato.ts'), 'utf8')
      .split(/\r?\n/)
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n')
    for (const proibido of ['prisma', 'fetch(', 'Math.random', 'Date.now()', 'new Date()']) {
      assert.ok(!codigo.includes(proibido), `${proibido} não pode aparecer`)
    }
  })
})

// ── Quem executa sozinho ────────────────────────────────────────────────

describe('Automatizável × dependência externa', () => {
  test('CONECTAR_CANAL exige humano e NUNCA fica tentando', () => {
    const p = perfilDaDependencia('CONECTAR_CANAL')
    assert.equal(p.classe, 'EXIGE_HUMANO')
    assert.equal(p.motivoHumano, 'OAUTH_AUTHORIZATION_REQUIRED')
    assert.equal(p.maxTentativas, 0, 'OAuth não destrava tentando de novo')
    assert.equal(podeExecutarSozinho(p), false)
  })

  test('SINCRONIZAR_MIDIA_AUTORIZADA nao e automatizavel enquanto nao tiver executor', () => {
    // Ate a rodada 45 este tipo era AUTOMATIZAVEL com 3 tentativas e NENHUMA
    // acao registrada no executor: o claim entregava o job, o worker nao
    // achava acao, devolvia a WAITING e repetia a cada execucao. Classe e
    // realidade agora concordam.
    const p = perfilDaDependencia('SINCRONIZAR_MIDIA_AUTORIZADA')
    assert.equal(p.classe, 'AGUARDA_CONDICAO')
    assert.equal(p.maxTentativas, 0)
    assert.equal(podeExecutarSozinho(p), false)
  })

  test('HABILITAR_CAPACIDADE aguarda condição, sem tentar', () => {
    const p = perfilDaDependencia('HABILITAR_CAPACIDADE')
    assert.equal(p.classe, 'AGUARDA_CONDICAO')
    assert.equal(p.maxTentativas, 0)
    assert.equal(podeExecutarSozinho(p), false)
  })

  test('dependência DESCONHECIDA é fail-closed: vira decisão humana', () => {
    const p = perfilDaDependencia('ALGO_QUE_NINGUEM_CLASSIFICOU')
    assert.equal(p.classe, 'EXIGE_HUMANO')
    assert.equal(p.motivoHumano, 'AMBIGUOUS_RULE')
    assert.equal(podeExecutarSozinho(p), false)
  })

  test('o executor declara o que não faz', () => {
    for (const proibido of ['PUBLICAR', 'PROVIDER_PAGO', 'CONSENTIMENTO_HUMANO', 'GERAR_CONTEUDO']) {
      assert.ok((EXECUTOR_NAO_FAZ.proibido as readonly string[]).includes(proibido))
    }
    assert.equal(EXECUTOR_NAO_FAZ.proximaRodada, 'CREATIVE_FACTORY_GRATUITA')
  })
})

// ── Idempotência ────────────────────────────────────────────────────────

describe('Idempotência — mesma situação, mesmo job', () => {
  const base = {
    workspaceId: 'ws-1',
    tipo: 'GERAR_CONTEUDO',
    entityType: 'Produto',
    entityId: 'p1',
    contexto: { dependencia: 'COMPLETAR_DADO_DO_PRODUTO', canal: 'instagram' },
  }

  test('mesma entrada = mesma chave', () => {
    assert.equal(chaveDoJob(base), chaveDoJob(base))
    assert.equal(chaveDoJob(base), chaveDoJob({ ...base, contexto: { ...base.contexto } }))
  })

  test('ORDEM das chaves do contexto não muda o resultado', () => {
    // Sem a ordenação, cada execução do cron criaria um job novo.
    const a = chaveDoJob({ ...base, contexto: { canal: 'instagram', dependencia: 'X' } })
    const b = chaveDoJob({ ...base, contexto: { dependencia: 'X', canal: 'instagram' } })
    assert.equal(a, b)
    assert.equal(normalizarContexto({ b: 2, a: 1 }), normalizarContexto({ a: 1, b: 2 }))
  })

  test('workspace diferente = chave diferente', () => {
    assert.notEqual(chaveDoJob(base), chaveDoJob({ ...base, workspaceId: 'ws-2' }))
  })

  test('produto, tipo e MUDANÇA MATERIAL do contexto geram chave nova', () => {
    assert.notEqual(chaveDoJob(base), chaveDoJob({ ...base, entityId: 'p2' }))
    assert.notEqual(chaveDoJob(base), chaveDoJob({ ...base, tipo: 'CONECTAR_CANAL' }))
    assert.notEqual(
      chaveDoJob(base),
      chaveDoJob({ ...base, contexto: { ...base.contexto, canal: 'tiktok' } })
    )
  })

  test('contexto ausente e vazio são equivalentes', () => {
    assert.equal(normalizarContexto(null), '')
    assert.equal(normalizarContexto(undefined), '')
    assert.equal(normalizarContexto({}), '')
  })
})

// ── Sincronização ───────────────────────────────────────────────────────

describe('Sincronização — o cron não pede que ninguém crie tarefa', () => {
  const desejados = jobsDesejadosDoPlano('ws-1', [
    item({ produtoId: 'p1', dependencia: 'COMPLETAR_DADO_DO_PRODUTO' }),
    item({ produtoId: 'p2', dependencia: 'CONECTAR_CANAL' }),
  ])

  test('primeira execução cria tudo', () => {
    const r = sincronizar(desejados, [])
    assert.equal(r.criar.length, 2)
    assert.deepEqual(r.manter, [])
    assert.deepEqual(r.cancelar, [])
  })

  test('SEGUNDA execução não duplica nada', () => {
    const existentes: JobExistente[] = desejados.map((d, i) => ({
      id: `job-${i}`,
      chave: d.chave,
      estado: 'PENDING',
    }))
    const r = sincronizar(desejados, existentes)
    assert.deepEqual(r.criar, [])
    assert.equal(r.manter.length, 2)
    assert.deepEqual(r.cancelar, [])
  })

  test('pendência RESOLVIDA deixa de ficar ativa', () => {
    const existentes: JobExistente[] = [
      { id: 'job-0', chave: desejados[0].chave, estado: 'PENDING' },
      { id: 'job-velho', chave: 'CONECTAR_CANAL:Produto:sumiu:abc', estado: 'PENDING' },
    ]
    const r = sincronizar([desejados[0]], existentes)
    assert.deepEqual(r.cancelar.map((c) => c.id), ['job-velho'])
    assert.ok(r.cancelar[0].motivo.length > 0)
  })

  test('job TERMINAL não é recontado nem cancelado de novo', () => {
    const existentes: JobExistente[] = [
      { id: 'ok', chave: desejados[0].chave, estado: 'SUCCEEDED' },
      { id: 'cancelado', chave: 'outra', estado: 'CANCELLED' },
    ]
    const r = sincronizar(desejados, existentes)
    // O SUCCEEDED não conta como ativo, então a pendência volta a ser criada
    // se o plano ainda a pede — que é o correto: ela reapareceu.
    assert.ok(r.criar.some((c) => c.chave === desejados[0].chave))
    assert.deepEqual(r.cancelar, [], 'terminal não é cancelado outra vez')
  })

  test('FAILED_RETRYABLE continua ativo — não vira job duplicado', () => {
    const existentes: JobExistente[] = [{ id: 'j', chave: desejados[0].chave, estado: 'FAILED_RETRYABLE' }]
    const r = sincronizar([desejados[0]], existentes)
    assert.deepEqual(r.criar, [])
    assert.deepEqual(r.manter, ['j'])
  })

  test('GERAR_CONTEUDO nunca vira job', () => {
    const r = jobsDesejadosDoPlano('ws-1', [
      item({ dependencia: 'GERAR_CONTEUDO' }),
      item({ dependencia: 'NENHUMA' }),
    ])
    assert.deepEqual(r, [])
  })

  test('WORKSPACE ISOLADO: a mesma pendência em dois negócios são dois jobs', () => {
    const deA = jobsDesejadosDoPlano('ws-A', [item()])
    const deB = jobsDesejadosDoPlano('ws-B', [item()])
    assert.notEqual(deA[0].chave, deB[0].chave)
    // E sincronizar um não cancela o outro, porque cada fila é consultada
    // pelo seu próprio workspace.
    const r = sincronizar(deA, [{ id: 'jb', chave: deB[0].chave, estado: 'PENDING' }])
    assert.equal(r.criar.length, 1)
    assert.equal(r.cancelar.length, 1, 'no escopo de A, um job de chave estranha sai')
  })

  test('DETERMINÍSTICA: duas chamadas, mesmo resultado', () => {
    const existentes: JobExistente[] = [{ id: 'j', chave: desejados[0].chave, estado: 'PENDING' }]
    assert.deepEqual(sincronizar(desejados, existentes), sincronizar(desejados, existentes))
  })

  test('cada job desejado carrega classe e motivo', () => {
    for (const d of desejados) {
      assert.ok((CLASSES_DE_JOB as readonly string[]).includes(d.classe))
      assert.ok(d.explicacao.length > 0)
      if (d.classe === 'EXIGE_HUMANO') assert.ok(d.motivoHumano)
    }
  })
})

// ── Retry ───────────────────────────────────────────────────────────────

describe('Retry — transitório volta, fatal não entra em loop', () => {
  const automatizavel = perfilDaDependencia('GERAR_CONTEUDO')

  test('falha transitória volta com backoff crescente', () => {
    const p1 = decidirAposFalha({ perfil: automatizavel, tentativasAtuais: 0, agora: AGORA })
    const p2 = decidirAposFalha({ perfil: automatizavel, tentativasAtuais: 1, agora: AGORA })
    assert.equal(p1.estado, 'FAILED_RETRYABLE')
    assert.equal(p2.estado, 'FAILED_RETRYABLE')
    assert.ok(p2.proximaTentativaEm!.getTime() > p1.proximaTentativaEm!.getTime(), 'o backoff dobra')
    assert.equal(p1.proximaTentativaEm!.getTime() - AGORA.getTime(), BACKOFF_BASE_MS)
  })

  test('o backoff tem TETO', () => {
    const r = decidirAposFalha({ perfil: { ...automatizavel, maxTentativas: 99 }, tentativasAtuais: 50, agora: AGORA })
    assert.equal(r.proximaTentativaEm!.getTime() - AGORA.getTime(), BACKOFF_MAXIMO_MS)
  })

  test('tentativas esgotadas = FAILED_FINAL, sem nova tentativa', () => {
    const r = decidirAposFalha({ perfil: automatizavel, tentativasAtuais: automatizavel.maxTentativas - 1, agora: AGORA })
    assert.equal(r.estado, 'FAILED_FINAL')
    assert.equal(r.proximaTentativaEm, null, 'nada de loop')
  })

  test('erro FATAL não tenta de novo, mesmo com tentativas sobrando', () => {
    const r = decidirAposFalha({ perfil: automatizavel, tentativasAtuais: 0, erroFatal: true, agora: AGORA })
    assert.equal(r.estado, 'FAILED_FINAL')
    assert.equal(r.proximaTentativaEm, null)
  })

  test('o que exige humano vai para WAITING, não para FAILED', () => {
    // A distinção central: OAuth pendente não é falha do sistema.
    const r = decidirAposFalha({ perfil: perfilDaDependencia('CONECTAR_CANAL'), tentativasAtuais: 0, agora: AGORA })
    assert.equal(r.estado, 'WAITING')
    assert.equal(r.proximaTentativaEm, null)
    assert.ok(!/falha/i.test(r.estado))
  })

  test('todo estado devolvido pertence ao vocabulário', () => {
    const casos = [
      decidirAposFalha({ perfil: automatizavel, tentativasAtuais: 0, agora: AGORA }),
      decidirAposFalha({ perfil: automatizavel, tentativasAtuais: 9, agora: AGORA }),
      decidirAposFalha({ perfil: perfilDaDependencia('HABILITAR_CAPACIDADE'), tentativasAtuais: 0, agora: AGORA }),
    ]
    for (const c of casos) assert.ok((ESTADOS_DO_JOB as readonly string[]).includes(c.estado))
  })
})

// ── Painel ──────────────────────────────────────────────────────────────

describe('Painel de Exceções — as quatro perguntas', () => {
  test('separa resolvido, tentando, aguardando e humano', () => {
    const r = resumirParaPainel([
      { estado: 'SUCCEEDED', classe: 'AUTOMATIZAVEL' },
      { estado: 'FAILED_RETRYABLE', classe: 'AUTOMATIZAVEL' },
      { estado: 'RUNNING', classe: 'AUTOMATIZAVEL' },
      { estado: 'WAITING', classe: 'AGUARDA_CONDICAO' },
      { estado: 'WAITING', classe: 'EXIGE_HUMANO' },
      { estado: 'FAILED_FINAL', classe: 'AUTOMATIZAVEL' },
    ])
    assert.deepEqual(r, {
      resolveuSozinho: 1,
      estaTentando: 2,
      aguardandoCondicao: 1,
      precisaDeDecisaoHumana: 2,
    })
  })

  test('PENDING de algo que exige humano já conta como decisão humana', () => {
    const r = resumirParaPainel([{ estado: 'PENDING', classe: 'EXIGE_HUMANO' }])
    assert.equal(r.precisaDeDecisaoHumana, 1)
    assert.equal(r.estaTentando, 0, 'não é o sistema tentando — ele não pode')
  })

  test('falha DEFINITIVA vira decisão humana, não some', () => {
    const r = resumirParaPainel([{ estado: 'FAILED_FINAL', classe: 'AUTOMATIZAVEL' }])
    assert.equal(r.precisaDeDecisaoHumana, 1)
  })

  test('cancelado não polui nenhuma contagem', () => {
    const r = resumirParaPainel([{ estado: 'CANCELLED', classe: 'AUTOMATIZAVEL' }])
    assert.deepEqual(r, { resolveuSozinho: 0, estaTentando: 0, aguardandoCondicao: 0, precisaDeDecisaoHumana: 0 })
  })
})

// ── Migration proposta ──────────────────────────────────────────────────

describe('A migration está proposta, não aplicada', () => {
  test('o schema declara AutomationJob com unique de idempotência', () => {
    const schema = readFileSync(join(RAIZ, 'prisma/schema.prisma'), 'utf8')
    assert.match(schema, /model AutomationJob \{/)
    assert.match(schema, /@@unique\(\[workspaceId, chave\]\)/)
    assert.match(schema, /enum EstadoDoAutomationJob/)
    for (const e of ESTADOS_DO_JOB) {
      assert.match(schema, new RegExp(`\\n  ${e}\\n`), `o enum precisa ter ${e}`)
    }
  })

  test('DigitalTwinJob NÃO foi afrouxado para hospedar a fila', () => {
    const schema = readFileSync(join(RAIZ, 'prisma/schema.prisma'), 'utf8')
    const bloco = schema.match(/model DigitalTwinJob \{[\s\S]*?\n\}/)![0]
    assert.match(bloco, /profileId String\n/, 'a FK continua obrigatória')
    assert.ok(!/profileId String\?/.test(bloco))
  })
})
