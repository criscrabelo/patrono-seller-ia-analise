/**
 * P2.15.6 — Otimização da Fase 1 sem mudar regra de negócio.
 *
 * Banco de TESTE: a transição em UM comando SQL mantém o compare-and-set,
 * o evento e a chave de idempotência; a sequência VALIDANDO→RANQUEANDO→
 * DECIDINDO grava um evento por passo; o pedido de aprovação criado em um
 * comando é atômico e idempotente; o ciclo continua com o mesmo resultado.
 * Puro: o selo da barra lateral consulta a cada 3 min e só com a aba visível.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

describe('P2.15.6 — selo da barra lateral (P2.17.11: o sininho de "Precisa de você")', () => {
  test('consulta a cada 3 min e só com a aba visível', () => {
    const src = fs.readFileSync('hooks/usePrecisaDeVoce.ts', 'utf8')
    assert.match(src, /INTERVALO_MS = 3 \* 60_000/)
    assert.match(src, /document\.visibilityState === 'visible'/)
    assert.match(src, /visibilitychange/)
    assert.doesNotMatch(src, /30000/)
  })
})

const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')

describe('P2.15.6 — banco de teste', { skip: !TEM_BANCO ? 'exige banco de TESTE' : false }, () => {
  let prisma: typeof import('../lib/prisma').prisma
  let R: typeof import('../lib/supervisor/run')
  let A: typeof import('../lib/aprovacoes')
  let PV: typeof import('../lib/precisa-de-voce')
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  const PREFIXO = 'Conta de Teste — '
  const marca = `r71-${Date.now()}`
  let ws = ''

  before(async () => {
    ;[{ prisma }, R, A, PV, { limparWorkspaceDeTeste: limpar }] = await Promise.all([
      import('../lib/prisma'), import('../lib/supervisor/run'), import('../lib/aprovacoes'), import('../lib/precisa-de-voce'), import('./_limpar-workspace-de-teste'),
    ])
    ws = (await prisma.workspace.create({ data: { name: `${PREFIXO}perf P2.15.6`, ownerId: marca }, select: { id: true } })).id
  })
  after(async () => {
    if (prisma && ws) await limpar(prisma, ws, PREFIXO)
    await prisma?.$disconnect()
  })

  test('transição com o run conhecido: 1 comando, mesmo evento, mesma chave; sequência = 1 evento por passo', async () => {
    const run = await R.iniciarRun({ workspaceId: ws, chave: `${marca}:a`, modo: 'MANUAL' })
    const r1 = await R.transitar({ workspaceId: ws, runId: run.id, de: 'PLANEJADO', para: 'DESCOBRINDO', checkpoint: { gatilho: 'TESTE' }, atual: run })
    assert.equal(r1.estado, 'DESCOBRINDO')
    assert.equal(r1.passo, 1)
    const r2 = await R.transitar({ workspaceId: ws, runId: run.id, de: 'DESCOBRINDO', para: ['VALIDANDO', 'RANQUEANDO', 'DECIDINDO'], checkpoint: { avaliados: 3 }, atual: r1 })
    assert.equal(r2.estado, 'DECIDINDO')
    assert.equal(r2.passo, 4)
    assert.deepEqual(r2.checkpoint, { gatilho: 'TESTE', avaliados: 3 })
    const eventos = await prisma.domainEvent.findMany({ where: { workspaceId: ws, runId: run.id }, orderBy: { ocorridoEm: 'asc' } })
    assert.deepEqual(eventos.map((e) => [e.chaveIdempotencia, (e.payload as { de: string; para: string }).de, (e.payload as { para: string }).para]), [
      [`run:${run.id}:1`, 'PLANEJADO', 'DESCOBRINDO'],
      [`run:${run.id}:2`, 'DESCOBRINDO', 'VALIDANDO'],
      [`run:${run.id}:3`, 'VALIDANDO', 'RANQUEANDO'],
      [`run:${run.id}:4`, 'RANQUEANDO', 'DECIDINDO'],
    ])
    assert.ok(eventos.every((e) => e.tipo === 'RUN_STATE_CHANGED' && e.correlationId === run.correlationId))
    // estado conhecido desatualizado = compare-and-set recusa (nada é gravado)
    await assert.rejects(R.transitar({ workspaceId: ws, runId: run.id, de: 'DESCOBRINDO', para: 'VALIDANDO', atual: r1 }), /Outra execução avançou/)
    // sequência com passo proibido é recusada antes de gravar
    await assert.rejects(R.transitar({ workspaceId: ws, runId: run.id, de: 'DECIDINDO', para: ['PUBLICANDO'], atual: r2 }), /proibida/)
    const fim = await R.transitar({ workspaceId: ws, runId: run.id, de: 'DECIDINDO', para: 'CONCLUIDO', atual: r2 })
    assert.ok(fim.concluidoEm)
    assert.equal(await prisma.domainEvent.count({ where: { workspaceId: ws, runId: run.id } }), 5)
  })

  test('falha grava ultimoErro e tentativas, como antes', async () => {
    const run = await R.iniciarRun({ workspaceId: ws, chave: `${marca}:b`, modo: 'MANUAL' })
    const f = await R.transitar({ workspaceId: ws, runId: run.id, de: 'PLANEJADO', para: 'FALHOU', erro: 'motivo de teste' })
    assert.equal(f.ultimoErro, 'motivo de teste')
    assert.equal(f.tentativas, 1)
    assert.ok(f.concluidoEm)
  })

  test('pedido sem regra: criado em 1 comando (pedido + evento), idempotente e com corrida segura', async () => {
    const pedido = { workspaceId: ws, tipo: 'EXCECAO', chave: `${marca}:pedido`, titulo: 'Teste', resumo: 'r', porque: ['a', 'b'], fatos: { risco: 'MEDIO' as const }, acaoProposta: { link: '/x' } }
    const [p1, p2, p3] = await Promise.all([A.solicitarAprovacao(pedido), A.solicitarAprovacao(pedido), A.solicitarAprovacao(pedido)])
    assert.equal(p1.id, p2.id)
    assert.equal(p2.id, p3.id)
    assert.equal(p1.status, 'PENDENTE')
    assert.deepEqual(p1.porque, ['a', 'b'])
    assert.deepEqual(p1.acaoProposta, { link: '/x' })
    assert.equal(await prisma.approvalRequest.count({ where: { workspaceId: ws, chave: pedido.chave } }), 1)
    const ev = await prisma.domainEvent.findMany({ where: { workspaceId: ws, chaveIdempotencia: `aprovacao:${pedido.chave}:pedido` } })
    assert.equal(ev.length, 1)
    assert.equal(ev[0].tipo, 'APPROVAL_REQUIRED')
    assert.equal(ev[0].entidadeId, p1.id)
    // aparece na fila (2 idas), por prioridade
    const fila = await PV.listarPrecisaDeVoce(ws)
    assert.ok(fila.some((i) => i.id === p1.id && i.risco === 'MEDIO'))
  })
})
