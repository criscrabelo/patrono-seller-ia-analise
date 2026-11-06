/**
 * P2.52 — prazos padrão das transações interativas (lib/prisma.ts).
 *
 * Achado da validação no GitHub Actions (banco remoto lento): cinco reservas de cota simultâneas faziam
 * fila na mesma trava (pg_advisory_xact_lock) e a última estourava os prazos padrão do Prisma (2 s para
 * obter conexão, 5 s de duração) — "Unable to start a transaction in the given time". A ação concorrente
 * falhava com erro em vez de esperar a vez. Production também tem banco remoto lento.
 */
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')

describe('P2.52 — prazos das transações (código)', () => {
  test('o cliente do banco define prazos padrão, acima dos do Prisma e abaixo do limite de 30 s da Netlify', async () => {
    const src = readFileSync('lib/prisma.ts', 'utf8')
    assert.match(src, /transactionOptions: PRAZOS_DAS_TRANSACOES/)
    const { maxWait, timeout } = (await import('../lib/prisma')).PRAZOS_DAS_TRANSACOES
    assert.ok(maxWait >= 10_000, `maxWait ${maxWait}`)
    assert.ok(timeout > 5_000 && timeout <= 25_000, `timeout ${timeout}`)
  })
})

describe('P2.52 — fila na mesma trava (banco de TESTE)', { skip: !TEM_BANCO ? 'exige banco de TESTE' : false, timeout: 120_000 }, () => {
  after(async () => { const { prisma } = await import('../lib/prisma'); await prisma.$disconnect() })

  test('quatro transações na mesma trava, 1,8 s cada: todas esperam a vez e terminam, sem erro de prazo', async () => {
    const { prisma } = await import('../lib/prisma')
    const chave = `p252-prazos:${Date.now()}:${Math.random()}`
    const inicio = Date.now()
    const ordem: number[] = []
    const r = await Promise.allSettled([0, 1, 2, 3].map((i) =>
      prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${chave}))::text AS ok`
        await tx.$queryRaw`SELECT pg_sleep(1.8)::text AS ok`
        ordem.push(i)
        return i
      })))
    const erros = r.filter((x) => x.status === 'rejected').map((x) => String((x as PromiseRejectedResult).reason).slice(0, 200))
    assert.deepEqual(erros, [], 'nenhuma transação falhou por prazo')
    assert.equal(ordem.length, 4)
    assert.ok(Date.now() - inicio >= 4 * 1_800 - 200, 'a trava serializou as quatro (passou do prazo padrão de 5 s)')
  })
})
