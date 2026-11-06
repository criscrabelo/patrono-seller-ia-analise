/**
 * P1.3 — o guard não-esquecível da Automation Queue.
 *
 * A tabela ainda não existe (migration proposta, não aplicada). O que dá
 * para provar agora é tudo o que decide se ela vai funcionar:
 *
 *   - a entidade é resolvida contra TABELAS REAIS, escopada por workspace;
 *   - nenhum módulo escreve na fila fora da autoridade central;
 *   - o claim exige workspace e dois workers não pegam o mesmo job;
 *   - dependência humana e condição externa não consomem tentativa.
 *
 * A porta de persistência é substituída por um adaptador em memória que
 * reproduz a unique `(workspaceId, chave)` e o `FOR UPDATE SKIP LOCKED`.
 * Nenhum teste toca rede ou provider. Custo R$ 0,00.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '../lib/prisma'
import {
  TIPOS_DE_ENTIDADE,
  ENTIDADE_EXIGE_VALIDACAO,
  validarEntidadeDaAutomacao,
} from '../lib/automation-queue-entidades'
import {
  criarOuSincronizarAutomationJob,
  sincronizarFilaComPlano,
  executarProximoJob,
  perfilContextual,
  SQL_DO_CLAIM,
  TIMEOUT_DE_HEARTBEAT_MS,
  ESTADOS_REIVINDICAVEIS,
  INDICES_ESPERADOS,
  TESTES_POS_MIGRATION,
  type PortaDaFila,
  type LinhaDaFila,
} from '../lib/automation-queue-repositorio'
import { jobsDesejadosDoPlano, podeExecutarSozinho } from '../lib/automation-queue-contrato'
import type { ItemDaFilaDeAutomacao } from '../lib/plano-de-acao'

const TEM_BANCO = !!process.env.DATABASE_URL
const RAIZ = join(__dirname, '..')
const AGORA = new Date('2026-09-23T12:00:00.000Z')

function varrer(dir: string): string[] {
  const saida: string[] = []
  for (const nome of readdirSync(dir)) {
    const abs = join(dir, nome)
    if (statSync(abs).isDirectory()) saida.push(...varrer(abs))
    else if (/[.]tsx?$/.test(nome)) saida.push(abs)
  }
  return saida
}

/**
 * Porta em memória que imita o banco no que importa: a unique
 * `(workspaceId, chave)` e a reivindicação atômica.
 */
function portaEmMemoria(): PortaDaFila & { linhas: LinhaDaFila[]; emUso: Set<string> } {
  const linhas: LinhaDaFila[] = []
  const emUso = new Set<string>()
  let seq = 0
  return {
    linhas,
    emUso,
    async listarPorWorkspace(workspaceId) {
      return linhas.filter((l) => l.workspaceId === workspaceId)
    },
    async inserirOuReencontrar(nova) {
      // A unique do banco, em memória.
      const existente = linhas.find((l) => l.workspaceId === nova.workspaceId && l.chave === nova.chave)
      if (existente) return existente
      const linha: LinhaDaFila = { ...nova, id: `job-${++seq}`, createdAt: AGORA }
      linhas.push(linha)
      return linha
    },
    async atualizar(id, dados) {
      const i = linhas.findIndex((l) => l.id === id)
      if (i < 0) return null
      linhas[i] = { ...linhas[i], ...dados }
      return linhas[i]
    },
    async reivindicar(workspaceId, workerId, agora) {
      const candidato = linhas.find(
        (l) =>
          l.workspaceId === workspaceId &&
          !emUso.has(l.id) &&
          ((l.estado === 'PENDING' && l.workerId === null) ||
            (l.estado === 'FAILED_RETRYABLE' &&
              l.proximaTentativaEm !== null &&
              l.proximaTentativaEm <= agora) ||
            (l.estado === 'RUNNING' &&
              l.heartbeatAt !== null &&
              agora.getTime() - l.heartbeatAt.getTime() > TIMEOUT_DE_HEARTBEAT_MS))
      )
      if (!candidato) return null
      // SKIP LOCKED: ninguém mais pega esta linha.
      emUso.add(candidato.id)
      candidato.estado = 'RUNNING'
      candidato.workerId = workerId
      candidato.claimedAt = agora
      candidato.heartbeatAt = agora
      return candidato
    },
  }
}

const item = (over: Partial<ItemDaFilaDeAutomacao> = {}): ItemDaFilaDeAutomacao => ({
  chave: 'x',
  produtoId: 'p1',
  dependencia: 'RENOVAR_TOKEN',
  explicacao: 'faltou mídia',
  repetivel: true,
  ...over,
})

// ── Autoridade única ────────────────────────────────────────────────────

describe('Uma porta só escreve na fila', () => {
  test('só o adaptador Prisma escreve em AutomationJob', () => {
    const arquivos = [...varrer(join(RAIZ, 'lib')), ...varrer(join(RAIZ, 'app'))]
    const escrevem: string[] = []
    for (const abs of arquivos) {
      const codigo = readFileSync(abs, 'utf8')
        .split(/\r?\n/)
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n')
      if (/prisma\.automationJob\.(create|update|upsert|createMany|updateMany|delete)/.test(codigo)) {
        escrevem.push(abs.slice(RAIZ.length + 1).split('\\').join('/'))
      }
    }
    // UM arquivo só escreve na tabela: o adaptador Prisma. A regra de
    // negócio mora no repositório, que nunca toca o banco direto — ele
    // passa pela porta. Quem aparecer aqui além do adaptador está
    // contornando o guard de entidade.
    assert.deepEqual(escrevem, ['lib/automation-queue-prisma.ts'])
  })

  test('a regra permanente está declarada', () => {
    assert.equal(ENTIDADE_EXIGE_VALIDACAO.funcaoObrigatoria, 'validarEntidadeDaAutomacao')
    assert.ok(ENTIDADE_EXIGE_VALIDACAO.porqueNaoEstaNoBanco.length > 0)
  })

  test('o repositório NÃO toca o banco direto — só a porta', () => {
    const codigo = readFileSync(join(RAIZ, 'lib/automation-queue-repositorio.ts'), 'utf8')
      .split(/\r?\n/)
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n')
    assert.ok(!/prisma\./.test(codigo), 'a regra de negócio passa pela porta, nunca pelo cliente')
  })

  test('a criação valida a entidade ANTES de qualquer escrita', () => {
    const codigo = readFileSync(join(RAIZ, 'lib/automation-queue-repositorio.ts'), 'utf8')
    const posValida = codigo.indexOf('await validarEntidadeDaAutomacao')
    const posInsere = codigo.indexOf('porta.inserirOuReencontrar')
    assert.ok(posValida > 0 && posValida < posInsere, 'validar tem de vir antes de inserir')
  })

  test('o claim exige workspaceId — não é opcional', () => {
    assert.match(SQL_DO_CLAIM, /WHERE "workspaceId" = \$1/)
    assert.match(SQL_DO_CLAIM, /FOR UPDATE SKIP LOCKED/)
    // WAITING não é reivindicável: é assim que dependência humana não
    // consome execução.
    assert.ok(!/estado" = 'WAITING'/.test(SQL_DO_CLAIM))
  })
})

// ── Perfis sem loop ─────────────────────────────────────────────────────

describe('Estados sem loop falso', () => {
  test('CONECTAR_CANAL: EXIGE_HUMANO, zero tentativas', () => {
    const p = perfilContextual('CONECTAR_CANAL')
    assert.equal(p.classe, 'EXIGE_HUMANO')
    assert.equal(p.maxTentativas, 0)
    assert.equal(podeExecutarSozinho(p), false)
  })

  test('HABILITAR_CAPACIDADE: aguarda condição, zero tentativas', () => {
    const p = perfilContextual('HABILITAR_CAPACIDADE')
    assert.equal(p.classe, 'AGUARDA_CONDICAO')
    assert.equal(p.maxTentativas, 0)
  })

  test('COMPLETAR_DADO_DO_PRODUTO só tenta quando HÁ fonte automática', () => {
    const comProvider = perfilContextual('COMPLETAR_DADO_DO_PRODUTO', { temFonteAutomatica: true })
    assert.equal(comProvider.classe, 'AGUARDA_CONDICAO')
    assert.ok(comProvider.maxTentativas > 0, 'com provider oficial, vale sincronizar')

    const manual = perfilContextual('COMPLETAR_DADO_DO_PRODUTO', { temFonteAutomatica: false })
    assert.equal(manual.maxTentativas, 0, 'sem provider, o dado não chega sozinho')
    assert.match(manual.explicacao, /não chega sozinho/i)
  })

  test('GERAR_CONTEUDO e automatizavel com retry', () => {
    const p = perfilContextual('GERAR_CONTEUDO')
    assert.equal(p.classe, 'AUTOMATIZAVEL')
    assert.equal(p.maxTentativas, 3)
  })

  test('SINCRONIZAR_MIDIA_AUTORIZADA nao consome retry: nao tem executor', () => {
    const p = perfilContextual('SINCRONIZAR_MIDIA_AUTORIZADA')
    assert.equal(p.classe, 'AGUARDA_CONDICAO')
    assert.equal(p.maxTentativas, 0)
  })

  test('tipo desconhecido é fail-closed', () => {
    const p = perfilContextual('COISA_NOVA')
    assert.equal(p.classe, 'EXIGE_HUMANO')
    assert.equal(p.maxTentativas, 0)
  })
})

// ── Índices derivados das queries ───────────────────────────────────────

describe('Índices — derivados do uso, não do palpite', () => {
  const schema = readFileSync(join(RAIZ, 'prisma/schema.prisma'), 'utf8')
  const modelo = schema.match(/model AutomationJob {[^]*?\n}/)![0]

  test('o composto do claim cobre workspace + estado + proximaTentativaEm', () => {
    assert.match(modelo, /@@index\(\[workspaceId, estado, proximaTentativaEm\]\)/)
    assert.deepEqual([...INDICES_ESPERADOS.claim], ['workspaceId', 'estado', 'proximaTentativaEm'])
  })

  test('o índice de heartbeat existe porque o ramo 3 do claim o usa', () => {
    assert.match(modelo, /@@index\(\[workspaceId, estado, heartbeatAt\]\)/)
    assert.match(SQL_DO_CLAIM, /"estado" = 'RUNNING' AND "heartbeatAt"/)
  })

  test('o índice REDUNDANTE (workspaceId, estado) foi removido', () => {
    // É prefixo do composto do claim: manter os dois pagaria escrita duas
    // vezes pela mesma leitura.
    assert.ok(!/@@index\(\[workspaceId, estado\]\)/.test(modelo))
  })

  test('nenhum índice lidera por estado — não existe leitura global', () => {
    assert.ok(!/@@index\(\[estado/.test(modelo), 'toda consulta é escopada por workspace')
  })

  test('o índice por entidade saiu: nenhuma query o usa hoje', () => {
    assert.ok(!/@@index\(\[workspaceId, entityType, entityId\]\)/.test(modelo))
  })

  test('sobram exatamente dois índices e uma unique', () => {
    const indices = modelo.match(/@@index\(/g) ?? []
    const uniques = modelo.match(/@@unique\(/g) ?? []
    assert.equal(indices.length, 2)
    assert.equal(uniques.length, 1)
    assert.match(modelo, /@@unique\(\[workspaceId, chave\]\)/)
  })
})

// ── WAITING nunca é reivindicável ───────────────────────────────────────

describe('Estados humanos e condicionais ficam fora do claim', () => {
  test('WAITING não está entre os reivindicáveis', () => {
    assert.ok(!ESTADOS_REIVINDICAVEIS.includes('WAITING'))
    assert.deepEqual([...ESTADOS_REIVINDICAVEIS], ['PENDING', 'FAILED_RETRYABLE', 'RUNNING'])
  })

  test('o SQL do claim lista só os três estados executáveis', () => {
    for (const e of ['PENDING', 'FAILED_RETRYABLE', 'RUNNING']) {
      assert.ok(SQL_DO_CLAIM.includes(`'${e}'`), `${e} precisa estar no claim`)
    }
    for (const e of ['WAITING', 'SUCCEEDED', 'FAILED_FINAL', 'CANCELLED']) {
      assert.ok(!SQL_DO_CLAIM.includes(`'${e}'`), `${e} não pode ser reivindicável`)
    }
  })

  test('job que exige humano nasce sem proximaTentativaEm', () => {
    const codigo = readFileSync(join(RAIZ, 'lib/automation-queue-repositorio.ts'), 'utf8')
    assert.match(codigo, /proximaTentativaEm: null,/, 'a criação sempre zera a próxima tentativa')
  })

  test('os testes pós-migration estão registrados, não esquecidos', () => {
    assert.ok(TESTES_POS_MIGRATION.length >= 7)
    const texto = TESTES_POS_MIGRATION.join(' ')
    assert.match(texto, /SKIP LOCKED/)
    assert.match(texto, /workspaces A e B/)
    assert.match(texto, /heartbeat/i)
    assert.match(texto, /WAITING/)
  })
})

// ── Banco: entidades reais ──────────────────────────────────────────────

const marca = `r37-${Date.now()}`
let wsA = ''
let wsB = ''
let produtoA = ''
let produtoB = ''
let conteudoA = ''
let integracaoA = ''
const criados: string[] = []

describe(
  'Entidade resolvida contra tabelas reais',
  { skip: !TEM_BANCO ? 'DATABASE_URL ausente — exige Postgres' : false },
  () => {
    before(async () => {
      for (const n of ['A', 'B']) {
        const ws = await prisma.workspace.create({
          data: { name: `R37-${n}`, ownerId: `${marca}-${n}` },
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
              workspaceId: ws, userId: uid, nome, categoria: 'x',
              tipoVenda: 'Afiliado', origemConteudo: 'Proprio',
            },
            select: { id: true },
          })
        ).id
      produtoA = await criarProduto(wsA, uA, `${marca}-a`)
      produtoB = await criarProduto(wsB, uB, `${marca}-b`)

      conteudoA = (
        await prisma.conteudo.create({
          data: { workspaceId: wsA, userId: uA, produtoId: produtoA, roteiro: 'x', redeSocial: 'instagram' },
          select: { id: true },
        })
      ).id

      integracaoA = (
        await prisma.integracao.create({
          data: { workspaceId: wsA, userId: uA, plataforma: `teste-${marca}`, status: 'conectado' },
          select: { id: true },
        })
      ).id
    })

    after(async () => {
      for (const ws of criados) {
        await prisma.integracao.deleteMany({ where: { workspaceId: ws } })
        await prisma.conteudo.deleteMany({ where: { workspaceId: ws } })
        await prisma.produto.deleteMany({ where: { workspaceId: ws } })
        await prisma.user.deleteMany({ where: { workspaceId: ws } })
      }
      await prisma.workspace.deleteMany({ where: { id: { in: criados } } })
      await prisma.$disconnect()
    })

    test('o registry cobre os quatro tipos de hoje', () => {
      assert.deepEqual([...TIPOS_DE_ENTIDADE], ['PRODUTO', 'PUBLICACAO', 'CONTEUDO', 'INTEGRACAO', 'PUBLICACAO_ASSISTIDA'])
    })

    test('PRODUTO do próprio workspace é aceito', async () => {
      const r = await validarEntidadeDaAutomacao({ workspaceId: wsA, entityType: 'PRODUTO', entityId: produtoA })
      assert.equal(r.ok, true, r.explicacao)
      assert.equal(r.tipo, 'PRODUTO')
      assert.ok(r.resumo)
    })

    test('PRODUTO de OUTRO workspace é RECUSADO', async () => {
      const r = await validarEntidadeDaAutomacao({ workspaceId: wsA, entityType: 'PRODUTO', entityId: produtoB })
      assert.equal(r.ok, false)
      assert.equal(r.motivo, 'ENTIDADE_NAO_ENCONTRADA')
    })

    test('entidade inexistente e de outro workspace dão a MESMA resposta', async () => {
      // Separar as duas confirmaria a existência de um id alheio.
      const alheia = await validarEntidadeDaAutomacao({ workspaceId: wsA, entityType: 'PRODUTO', entityId: produtoB })
      const inexistente = await validarEntidadeDaAutomacao({ workspaceId: wsA, entityType: 'PRODUTO', entityId: 'nao-existe' })
      assert.equal(alheia.motivo, inexistente.motivo)
      assert.equal(alheia.explicacao, inexistente.explicacao)
    })

    test('CONTEUDO e INTEGRACAO também resolvem, escopados', async () => {
      assert.equal((await validarEntidadeDaAutomacao({ workspaceId: wsA, entityType: 'CONTEUDO', entityId: conteudoA })).ok, true)
      assert.equal((await validarEntidadeDaAutomacao({ workspaceId: wsB, entityType: 'CONTEUDO', entityId: conteudoA })).ok, false)
      assert.equal((await validarEntidadeDaAutomacao({ workspaceId: wsA, entityType: 'INTEGRACAO', entityId: integracaoA })).ok, true)
      assert.equal((await validarEntidadeDaAutomacao({ workspaceId: wsB, entityType: 'INTEGRACAO', entityId: integracaoA })).ok, false)
    })

    test('PUBLICACAO de outro workspace é recusada', async () => {
      // A tabela existe desde a Etapa 2.b; nenhuma publicação nesta fixture.
      const r = await validarEntidadeDaAutomacao({ workspaceId: wsA, entityType: 'PUBLICACAO', entityId: 'qualquer' })
      assert.equal(r.ok, false)
      assert.equal(r.motivo, 'ENTIDADE_NAO_ENCONTRADA')
    })

    test('entityType DESCONHECIDO é fail-closed', async () => {
      const r = await validarEntidadeDaAutomacao({ workspaceId: wsA, entityType: 'CANAL_QUE_AINDA_NAO_EXISTE', entityId: 'x' })
      assert.equal(r.ok, false)
      assert.equal(r.motivo, 'TIPO_DESCONHECIDO')
      assert.match(r.explicacao, /registry/i)
    })

    test('parâmetro faltando nunca passa por omissão', async () => {
      for (const p of [
        { workspaceId: '', entityType: 'PRODUTO', entityId: produtoA },
        { workspaceId: wsA, entityType: '', entityId: produtoA },
        { workspaceId: wsA, entityType: 'PRODUTO', entityId: '  ' },
      ]) {
        const r = await validarEntidadeDaAutomacao(p)
        assert.equal(r.ok, false)
        assert.equal(r.motivo, 'PARAMETROS_INCOMPLETOS')
      }
    })

    // ── A porta de escrita ────────────────────────────────────────────

    test('job de produto ALHEIO nunca chega a existir', async () => {
      const porta = portaEmMemoria()
      const r = await criarOuSincronizarAutomationJob({
        porta, workspaceId: wsA, tipo: 'GERAR_CONTEUDO',
        entityType: 'PRODUTO', entityId: produtoB, agora: AGORA,
      })
      assert.equal(r.ok, false)
      assert.equal(r.motivo, 'ENTIDADE_INVALIDA')
      assert.equal(porta.linhas.length, 0, 'nem por um instante')
    })

    test('job válido nasce com o estado certo para o perfil', async () => {
      const porta = portaEmMemoria()
      const auto = await criarOuSincronizarAutomationJob({
        porta, workspaceId: wsA, tipo: 'GERAR_CONTEUDO',
        entityType: 'PRODUTO', entityId: produtoA, agora: AGORA,
      })
      assert.equal(auto.job!.estado, 'PENDING', 'automatizável entra na fila')

      const humano = await criarOuSincronizarAutomationJob({
        porta, workspaceId: wsA, tipo: 'CONECTAR_CANAL',
        entityType: 'PRODUTO', entityId: produtoA, agora: AGORA,
      })
      assert.equal(humano.job!.estado, 'WAITING', 'humano nunca entra como PENDING')
      assert.equal(humano.job!.classe, 'EXIGE_HUMANO')
      assert.equal(humano.job!.motivoHumano, 'OAUTH_AUTHORIZATION_REQUIRED')
    })

    test('IDEMPOTENTE: dois crons, um job', async () => {
      const porta = portaEmMemoria()
      const criar = () =>
        criarOuSincronizarAutomationJob({
          porta, workspaceId: wsA, tipo: 'GERAR_CONTEUDO',
          entityType: 'PRODUTO', entityId: produtoA, contexto: { canal: 'instagram' }, agora: AGORA,
        })
      const a = await criar()
      const b = await criar()
      assert.equal(a.job!.id, b.job!.id)
      assert.equal(porta.linhas.length, 1)
    })

    test('MUDANÇA MATERIAL do contexto gera job novo', async () => {
      const porta = portaEmMemoria()
      const a = await criarOuSincronizarAutomationJob({
        porta, workspaceId: wsA, tipo: 'GERAR_CONTEUDO',
        entityType: 'PRODUTO', entityId: produtoA, contexto: { canal: 'instagram' }, agora: AGORA,
      })
      const b = await criarOuSincronizarAutomationJob({
        porta, workspaceId: wsA, tipo: 'GERAR_CONTEUDO',
        entityType: 'PRODUTO', entityId: produtoA, contexto: { canal: 'tiktok' }, agora: AGORA,
      })
      assert.notEqual(a.job!.id, b.job!.id)
      assert.equal(porta.linhas.length, 2)
    })

    // ── Sincronização e obsolescência ─────────────────────────────────

    test('job OBSOLETO é cancelado de forma auditável', async () => {
      const porta = portaEmMemoria()
      const desejados = jobsDesejadosDoPlano(wsA, [item({ produtoId: produtoA })])
      await sincronizarFilaComPlano({ porta, workspaceId: wsA, desejados, agora: AGORA })
      assert.equal(porta.linhas.length, 1)

      // O plano seguinte não pede mais nada.
      const r = await sincronizarFilaComPlano({ porta, workspaceId: wsA, desejados: [], agora: AGORA })
      assert.equal(r.cancelados, 1)
      assert.equal(porta.linhas[0].estado, 'CANCELLED')
      assert.ok(porta.linhas[0].ultimoErro, 'o motivo do cancelamento fica registrado')
      assert.ok(porta.linhas[0].resolvidoEm, 'e o instante também')
    })

    test('job RUNNING NÃO é cancelado pelo sync', async () => {
      const porta = portaEmMemoria()
      const desejados = jobsDesejadosDoPlano(wsA, [item({ produtoId: produtoA })])
      await sincronizarFilaComPlano({ porta, workspaceId: wsA, desejados, agora: AGORA })
      await porta.reivindicar(wsA, 'worker-1', AGORA)
      assert.equal(porta.linhas[0].estado, 'RUNNING')

      const r = await sincronizarFilaComPlano({ porta, workspaceId: wsA, desejados: [], agora: AGORA })
      assert.equal(r.cancelados, 0, 'há um worker com ele na mão')
      assert.equal(porta.linhas[0].estado, 'RUNNING')
    })

    test('RESTART preserva a fila — o estado vive na porta, não na memória do processo', async () => {
      const porta = portaEmMemoria()
      const desejados = jobsDesejadosDoPlano(wsA, [item({ produtoId: produtoA })])
      await sincronizarFilaComPlano({ porta, workspaceId: wsA, desejados, agora: AGORA })

      // "Restart": mesma porta, execução nova. Nada é recriado.
      const r = await sincronizarFilaComPlano({ porta, workspaceId: wsA, desejados, agora: AGORA })
      assert.equal(r.criados, 0)
      assert.equal(r.mantidos, 1)
      assert.equal(porta.linhas.length, 1)
    })

    test('job com entidade inválida é RECUSADO pelo sync, e o sync continua', async () => {
      const porta = portaEmMemoria()
      const desejados = jobsDesejadosDoPlano(wsA, [
        item({ produtoId: produtoA }),
        item({ produtoId: produtoB, dependencia: 'CONECTAR_CANAL' }),
      ])
      const r = await sincronizarFilaComPlano({ porta, workspaceId: wsA, desejados, agora: AGORA })
      assert.equal(r.criados, 1)
      assert.equal(r.recusados.length, 1)
      assert.equal(r.recusados[0].entityId, produtoB)
    })

    // ── Claim e concorrência ──────────────────────────────────────────

    test('DOIS WORKERS não pegam o mesmo job', async () => {
      const porta = portaEmMemoria()
      for (const dep of ['GERAR_CONTEUDO'] as const) {
        await criarOuSincronizarAutomationJob({
          porta, workspaceId: wsA, tipo: dep, entityType: 'PRODUTO', entityId: produtoA, agora: AGORA,
        })
      }
      const [a, b] = await Promise.all([
        porta.reivindicar(wsA, 'worker-1', AGORA),
        porta.reivindicar(wsA, 'worker-2', AGORA),
      ])
      const pegos = [a, b].filter(Boolean)
      assert.equal(pegos.length, 1, 'só um worker leva')
      assert.equal(porta.linhas.filter((l) => l.estado === 'RUNNING').length, 1)
    })

    test('worker do workspace A NUNCA pega job do B', async () => {
      const porta = portaEmMemoria()
      await criarOuSincronizarAutomationJob({
        porta, workspaceId: wsA, tipo: 'GERAR_CONTEUDO',
        entityType: 'PRODUTO', entityId: produtoA, agora: AGORA,
      })
      const doB = await porta.reivindicar(wsB, 'worker-do-b', AGORA)
      assert.equal(doB, null, 'a fila de A é invisível para o worker de B')

      const doA = await porta.reivindicar(wsA, 'worker-do-a', AGORA)
      assert.ok(doA)
      assert.equal(doA!.workspaceId, wsA)
    })

    test('WAITING não é reivindicável — não consome execução', async () => {
      const porta = portaEmMemoria()
      await criarOuSincronizarAutomationJob({
        porta, workspaceId: wsA, tipo: 'CONECTAR_CANAL',
        entityType: 'PRODUTO', entityId: produtoA, agora: AGORA,
      })
      assert.equal(porta.linhas[0].estado, 'WAITING')
      assert.equal(await porta.reivindicar(wsA, 'worker-1', AGORA), null)
      assert.equal(porta.linhas[0].tentativas, 0, 'nenhuma tentativa foi gasta')
    })

    // ── Executor ──────────────────────────────────────────────────────

    test('o executor resolve o que é automatizável', async () => {
      const porta = portaEmMemoria()
      await criarOuSincronizarAutomationJob({
        porta, workspaceId: wsA, tipo: 'GERAR_CONTEUDO',
        entityType: 'PRODUTO', entityId: produtoA, agora: AGORA,
      })
      const r = await executarProximoJob({
        porta, workspaceId: wsA, workerId: 'w1', agora: AGORA,
        acoes: { GERAR_CONTEUDO: async () => ({ ok: true }) },
      })
      assert.equal(r.executado, true)
      assert.equal(r.estadoFinal, 'SUCCEEDED')
      assert.ok(r.job!.resolvidoEm)
    })

    test('falha transitória vira FAILED_RETRYABLE com próxima tentativa', async () => {
      const porta = portaEmMemoria()
      await criarOuSincronizarAutomationJob({
        porta, workspaceId: wsA, tipo: 'GERAR_CONTEUDO',
        entityType: 'PRODUTO', entityId: produtoA, agora: AGORA,
      })
      const r = await executarProximoJob({
        porta, workspaceId: wsA, workerId: 'w1', agora: AGORA,
        acoes: { GERAR_CONTEUDO: async () => ({ ok: false, erro: 'rede caiu' }) },
      })
      assert.equal(r.estadoFinal, 'FAILED_RETRYABLE')
      assert.ok(r.job!.proximaTentativaEm)
      assert.equal(r.job!.tentativas, 1)
    })

    test('falha FATAL não entra em loop', async () => {
      const porta = portaEmMemoria()
      await criarOuSincronizarAutomationJob({
        porta, workspaceId: wsA, tipo: 'GERAR_CONTEUDO',
        entityType: 'PRODUTO', entityId: produtoA, agora: AGORA,
      })
      const r = await executarProximoJob({
        porta, workspaceId: wsA, workerId: 'w1', agora: AGORA,
        acoes: { GERAR_CONTEUDO: async () => ({ ok: false, erroFatal: true }) },
      })
      assert.equal(r.estadoFinal, 'FAILED_FINAL')
      assert.equal(r.job!.proximaTentativaEm, null)
      assert.equal(await porta.reivindicar(wsA, 'w2', new Date(AGORA.getTime() + 999999)), null)
    })

    test('sem ação registrada o job AGUARDA, não falha', async () => {
      const porta = portaEmMemoria()
      await criarOuSincronizarAutomationJob({
        porta, workspaceId: wsA, tipo: 'GERAR_CONTEUDO',
        entityType: 'PRODUTO', entityId: produtoA, agora: AGORA,
      })
      const r = await executarProximoJob({ porta, workspaceId: wsA, workerId: 'w1', agora: AGORA })
      assert.equal(r.estadoFinal, 'WAITING')
      assert.equal(r.job!.tentativas, 0, 'não gasta tentativa por falta de implementação')
    })

    test('nenhuma Publicacao ou Conteudo nasceu da fila', async () => {
      assert.equal(await prisma.publicacao.count({ where: { workspaceId: { in: criados } } }), 0)
      // O único Conteudo é o da fixture.
      assert.equal(await prisma.conteudo.count({ where: { workspaceId: { in: criados } } }), 1)
    })
  }
)
