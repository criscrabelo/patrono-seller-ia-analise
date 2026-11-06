/**
 * P0.1 — a reserva de orçamento é ATÔMICA por workspace + mês.
 *
 * ── O DEFEITO QUE ESTE TESTE COBRE ──────────────────────────────────────
 * Antes, `guardarChamadaPaga()` fazia três passos separados: lia o gasto do
 * mês, comparava com o teto e só depois gravava a autorização. Entre o ler e
 * o gravar cabia outra chamada inteira. Duas operações simultâneas liam o
 * mesmo saldo, as duas se achavam dentro do teto, e as duas gastavam. Com o
 * Revenue Autopilot disparando em paralelo isso deixa de ser hipótese.
 *
 * ── COMO O TESTE PROVA ──────────────────────────────────────────────────
 * Orçamento de R$ 10,00. Duas reservas de R$ 6,00 disparadas ao mesmo tempo.
 * Só uma pode ser autorizada — R$ 12,00 estouraria o teto.
 *
 * ── PRECISA DE POSTGRES ─────────────────────────────────────────────────
 * O lock é `pg_advisory_xact_lock`, do próprio banco: sem banco não há o que
 * testar. Rodando sem `DATABASE_URL`, o teste é PULADO com aviso, nunca
 * "passa" silenciosamente — um teste de concorrência que passa sem executar
 * é pior que teste nenhum.
 *
 * NUNCA rode isto contra produção: ele grava e apaga registros em AuditLog.
 * Use o banco de teste, por exemplo:
 *   node -r dotenv/config node_modules/tsx/dist/cli.mjs --test \
 *     tests/rodada17-cost-gate-concorrencia.test.ts \
 *     dotenv_config_path="$LOCALAPPDATA/PatronoSeller/teste/.env.digital-twin-test"
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../lib/prisma'
import { ACAO_AUDIT_AUTORIZADO, ACAO_AUDIT_BLOQUEIO } from '../lib/cost-safety-gate'
import { reservarOrcamento, calcularGastoAcumulado } from '../lib/cost-safety-reserva'

const TEM_BANCO = !!process.env.DATABASE_URL
const ORCAMENTO = { pagoHabilitado: true, orcamentoMensal: 10 }

let workspaceId: string | null = null
let workspaceCriado = false

async function limparAuditoriaDeCusto(ws: string) {
  await prisma.auditLog.deleteMany({
    where: { workspaceId: ws, entityType: 'CostSafetyGate' },
  })
}

describe('Reserva de orçamento é atômica por workspace + mês', { skip: !TEM_BANCO ? 'DATABASE_URL ausente — teste de concorrência exige Postgres' : false }, () => {
  before(async () => {
    // Usa um workspace existente; só cria um se o banco estiver vazio.
    const existente = await prisma.workspace.findFirst({ select: { id: true } })
    if (existente) {
      workspaceId = existente.id
    } else {
      const novo = await prisma.workspace.create({
        data: { name: 'Workspace de teste de concorrencia de custo', ownerId: `teste-custo-${Date.now()}` },
        select: { id: true },
      })
      workspaceId = novo.id
      workspaceCriado = true
    }
    await limparAuditoriaDeCusto(workspaceId)
  })

  after(async () => {
    if (workspaceId) await limparAuditoriaDeCusto(workspaceId)
    if (workspaceCriado && workspaceId) {
      await prisma.workspace.delete({ where: { id: workspaceId } })
    }
    await prisma.$disconnect()
  })

  test('duas reservas de R$ 6,00 simultâneas num teto de R$ 10,00 — só uma passa', async () => {
    const ws = workspaceId!
    await limparAuditoriaDeCusto(ws)

    const [a, b] = await Promise.all([
      reservarOrcamento({
        provider: 'fal.ai',
        operacao: 'gerar-video',
        workspaceId: ws,
        custoEstimado: 6,
        politica: ORCAMENTO,
      }),
      reservarOrcamento({
        provider: 'fal.ai',
        operacao: 'gerar-video',
        workspaceId: ws,
        custoEstimado: 6,
        politica: ORCAMENTO,
      }),
    ])

    const autorizadas = [a, b].filter((r) => r.permitido)
    assert.equal(
      autorizadas.length,
      1,
      `esperava exatamente 1 autorização, veio ${autorizadas.length} — o teto foi furado por corrida`
    )

    const negada = [a, b].find((r) => !r.permitido)!
    assert.equal(negada.decisao.motivo, 'CUSTO_EXCEDE_SALDO')

    // E o que ficou gravado tem de bater com o que foi decidido.
    const gasto = await calcularGastoAcumulado(ws)
    assert.equal(gasto, 6, 'só a reserva autorizada consome orçamento')
    assert.ok(gasto! <= ORCAMENTO.orcamentoMensal, 'o teto mensal nunca pode ser ultrapassado')

    const autorizacoes = await prisma.auditLog.count({
      where: { workspaceId: ws, action: ACAO_AUDIT_AUTORIZADO, entityType: 'CostSafetyGate' },
    })
    const bloqueios = await prisma.auditLog.count({
      where: { workspaceId: ws, action: ACAO_AUDIT_BLOQUEIO, entityType: 'CostSafetyGate' },
    })
    assert.equal(autorizacoes, 1)
    assert.equal(bloqueios, 1, 'o bloqueio também é auditado — negar é decisão, não silêncio')
  })

  test('cinco reservas de R$ 3,00 simultâneas num teto de R$ 10,00 — no máximo três', async () => {
    const ws = workspaceId!
    await limparAuditoriaDeCusto(ws)

    const resultados = await Promise.all(
      Array.from({ length: 5 }, () =>
        reservarOrcamento({
          provider: 'fal.ai',
          operacao: 'gerar-video',
          workspaceId: ws,
          custoEstimado: 3,
          politica: ORCAMENTO,
        })
      )
    )

    const autorizadas = resultados.filter((r) => r.permitido).length
    assert.equal(autorizadas, 3, `3 x R$ 3,00 = R$ 9,00 cabe; a quarta estouraria (veio ${autorizadas})`)

    const gasto = await calcularGastoAcumulado(ws)
    assert.equal(gasto, 9)
    assert.ok(gasto! <= ORCAMENTO.orcamentoMensal)
  })

  test('workspaces diferentes NÃO disputam o mesmo orçamento nem o mesmo lock', async () => {
    const ws = workspaceId!
    await limparAuditoriaDeCusto(ws)

    const outro = await prisma.workspace.create({
      data: { name: 'Workspace B - isolamento de orcamento', ownerId: `teste-custo-b-${Date.now()}` },
      select: { id: true },
    })
    try {
      const [a, b] = await Promise.all([
        reservarOrcamento({
          provider: 'fal.ai',
          operacao: 'gerar-video',
          workspaceId: ws,
          custoEstimado: 8,
          politica: ORCAMENTO,
        }),
        reservarOrcamento({
          provider: 'fal.ai',
          operacao: 'gerar-video',
          workspaceId: outro.id,
          custoEstimado: 8,
          politica: ORCAMENTO,
        }),
      ])
      // MULTI-WORKSPACE: cada negócio tem o seu teto. O gasto de um jamais
      // consome o orçamento do outro.
      assert.equal(a.permitido, true)
      assert.equal(b.permitido, true)
      assert.equal(await calcularGastoAcumulado(ws), 8)
      assert.equal(await calcularGastoAcumulado(outro.id), 8)
    } finally {
      await limparAuditoriaDeCusto(outro.id)
      await prisma.workspace.delete({ where: { id: outro.id } })
    }
  })

  test('P2.50 D3: mesma chave de idempotência (inclusive em paralelo) reserva UMA vez; chave nova reserva de novo', async () => {
    const ws = workspaceId!
    await limparAuditoriaDeCusto(ws)
    const pedido = (chaveIdempotencia: string) =>
      reservarOrcamento({ provider: 'fal.ai', operacao: 'gerar-video', workspaceId: ws, custoEstimado: 2, politica: ORCAMENTO, chaveIdempotencia })

    const [a, b, c] = await Promise.all([pedido('clip:x:0'), pedido('clip:x:0'), pedido('clip:x:0')])
    const ok = [a, b, c].filter((r) => r.permitido)
    assert.equal(ok.length, 1, 'só uma autorização para a mesma chave')
    for (const r of [a, b, c].filter((r) => !r.permitido)) assert.equal(r.decisao.motivo, 'CHAMADA_REPETIDA')
    assert.equal(await calcularGastoAcumulado(ws), 2, 'a repetição não reserva orçamento')

    const outra = await pedido('clip:x:1')
    assert.equal(outra.permitido, true)
    assert.equal(await calcularGastoAcumulado(ws), 4)

    // Sem chave, o comportamento antigo continua (cada chamada é uma reserva).
    const semChave = await reservarOrcamento({ provider: 'fal.ai', operacao: 'gerar-video', workspaceId: ws, custoEstimado: 2, politica: ORCAMENTO })
    assert.equal(semChave.permitido, true)
  })

  test('P2.50 D3: as submissões pagas da fal.ai levam chave da operação lógica', async () => {
    const { readFileSync } = await import('node:fs')
    const gerar = readFileSync('app/api/conteudos/[id]/gerar-video/route.ts', 'utf8')
    const status = readFileSync('app/api/conteudos/[id]/video-status/route.ts', 'utf8')
    const fal = readFileSync('lib/falai.ts', 'utf8')
    assert.match(gerar, /`gerar-video:\$\{conteudo\.id\}:\$\{reservaEm\}:\$\{i\}`/)
    assert.match(status, /comporVideos\(urlsClipes, conteudo\.workspaceId, chaveCompor\)/)
    assert.match(fal, /guardarChamadaPaga\(\{ provider: 'fal\.ai', operacao, workspaceId, chaveIdempotencia \}\)/)
  })

  test('com a política padrão (desligada), nada é reservado', async () => {
    const ws = workspaceId!
    await limparAuditoriaDeCusto(ws)

    const r = await reservarOrcamento({
      provider: 'fal.ai',
      operacao: 'gerar-video',
      workspaceId: ws,
      custoEstimado: 1,
      politica: { pagoHabilitado: false, orcamentoMensal: 0 },
    })
    assert.equal(r.permitido, false)
    assert.equal(r.decisao.motivo, 'PAGO_NAO_HABILITADO')
    assert.equal(await calcularGastoAcumulado(ws), 0)
  })
})
