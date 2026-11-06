/**
 * Rodada 10.2 — resiliência do worker residente a queda de conexão.
 *
 * O caso real que originou isto: 20/09/2026, `ConnectionReset` (Os code
 * 10054) no pooler do Supabase derrubou o worker com exit code 1 e ele ficou
 * 8 horas fora do ar. Os testes reproduzem a queda temporária e a
 * recuperação sem derrubar banco nenhum — espera, sorteio e log são
 * injetados.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  classificarErroDeBanco,
  calcularEsperaBackoff,
  comReconexao,
  type TentativaReconexao,
} from '../lib/db-resiliencia'

/** Reproduz o formato real: Prisma embrulha o erro de socket em `cause`. */
function erroPrisma(codigo: string, mensagem = 'falha'): Error & { code: string } {
  const e = new Error(mensagem) as Error & { code: string }
  e.code = codigo
  return e
}

function erroDeSocketAninhado(codigo: string): Error {
  const socket = new Error('Foi forçado o cancelamento de uma conexão existente pelo host remoto.') as Error & { code: string }
  socket.code = codigo
  const externo = new Error('Error in PostgreSQL connection') as Error & { cause: unknown }
  externo.cause = socket
  return externo
}

describe('Classificação de erro de banco', () => {
  test('ConnectionReset real (ECONNRESET) é transitório', () => {
    const d = classificarErroDeBanco(erroPrisma('ECONNRESET'))
    assert.equal(d.classe, 'TRANSITORIO')
    assert.equal(d.codigo, 'ECONNRESET')
  })

  test('P1001 (banco inalcançável) é transitório', () => {
    assert.equal(classificarErroDeBanco(erroPrisma('P1001')).classe, 'TRANSITORIO')
  })

  test('encontra o código mesmo aninhado em cause (formato real do Prisma)', () => {
    const d = classificarErroDeBanco(erroDeSocketAninhado('ECONNRESET'))
    assert.equal(d.classe, 'TRANSITORIO')
    assert.equal(d.codigo, 'ECONNRESET')
  })

  test('credencial inválida (P1000) é FATAL — retentar esconderia o problema', () => {
    assert.equal(classificarErroDeBanco(erroPrisma('P1000')).classe, 'FATAL')
  })

  test('string de conexão inválida (P1013) é FATAL', () => {
    assert.equal(classificarErroDeBanco(erroPrisma('P1013')).classe, 'FATAL')
  })

  test('ENOTFOUND é FATAL: host que não resolve é ambiente errado, não queda', () => {
    assert.equal(classificarErroDeBanco(erroPrisma('ENOTFOUND')).classe, 'FATAL')
  })

  test('erro desconhecido é FATAL por padrão — nunca engolido em retry silencioso', () => {
    assert.equal(classificarErroDeBanco(new Error('qualquer outra coisa')).classe, 'FATAL')
    assert.equal(classificarErroDeBanco(erroPrisma('P2002', 'unique constraint')).classe, 'FATAL')
  })

  test('motivo não vaza stack e cabe numa linha', () => {
    const e = erroPrisma('P1001', 'Can\'t reach database server at `host:6543`\n   at algumaFuncao (/caminho/interno.ts:1:1)')
    const d = classificarErroDeBanco(e)
    assert.ok(!d.motivo.includes('\n'), 'motivo deve ser uma linha só')
    assert.ok(!d.motivo.includes('at algumaFuncao'), 'motivo não deve trazer stack')
  })

  // Verificado ao vivo na simulação: pegar a primeira linha da mensagem do
  // Prisma produzia "Invalid `prisma.$queryRaw()` invocation:", que não diz
  // nada sobre a causa justamente na hora da queda.
  test('motivo pula o cabeçalho do Prisma e mostra a causa real', () => {
    const mensagemReal = [
      'Invalid `prisma.$queryRaw()` invocation:',
      '',
      '',
      "Can't reach database server at `aws-0-sa-east-1.pooler.supabase.com:6543`",
      '',
      'Please make sure your database server is running at `aws-0-sa-east-1.pooler.supabase.com:6543`.',
    ].join('\n')
    const d = classificarErroDeBanco(erroPrisma('P1001', mensagemReal))
    assert.ok(d.motivo.includes("Can't reach database server"), `motivo inútil: ${d.motivo}`)
    assert.ok(!d.motivo.includes('invocation'), 'não deve ficar no cabeçalho vazio')
  })
})

describe('Backoff exponencial', () => {
  const semJitter = { baseMs: 1000, maxMs: 60_000, jitter: 0, aleatorio: () => 0 }

  test('cresce exponencialmente a partir da tentativa 1', () => {
    assert.equal(calcularEsperaBackoff(1, semJitter), 1000)
    assert.equal(calcularEsperaBackoff(2, semJitter), 2000)
    assert.equal(calcularEsperaBackoff(3, semJitter), 4000)
    assert.equal(calcularEsperaBackoff(4, semJitter), 8000)
  })

  test('respeita o teto máximo e nunca ultrapassa', () => {
    assert.equal(calcularEsperaBackoff(20, semJitter), 60_000)
    assert.equal(calcularEsperaBackoff(100, semJitter), 60_000)
  })

  test('jitter só SUBTRAI — a espera nunca passa do teto', () => {
    const comJitterMaximo = { baseMs: 1000, maxMs: 60_000, jitter: 0.2, aleatorio: () => 1 }
    assert.equal(calcularEsperaBackoff(1, comJitterMaximo), 800)
    assert.equal(calcularEsperaBackoff(20, comJitterMaximo), 48_000)
    for (let t = 1; t <= 30; t++) {
      assert.ok(calcularEsperaBackoff(t, comJitterMaximo) <= 60_000)
    }
  })

  test('jitter real (Math.random) fica sempre dentro da faixa esperada', () => {
    for (let i = 0; i < 200; i++) {
      const espera = calcularEsperaBackoff(5, { baseMs: 1000, maxMs: 60_000 })
      assert.ok(espera >= 12_800 && espera <= 16_000, `espera fora da faixa: ${espera}`)
    }
  })

  test('nunca devolve espera negativa', () => {
    assert.ok(calcularEsperaBackoff(1, { baseMs: 10, maxMs: 100, jitter: 1, aleatorio: () => 1 }) >= 0)
  })
})

describe('Queda temporária e recuperação (o caso real)', () => {
  function deps(overrides: Partial<Parameters<typeof comReconexao>[1]> = {}) {
    const esperas: number[] = []
    const tentativas: TentativaReconexao[] = []
    let recuperouApos: number | null = null
    return {
      esperas,
      tentativas,
      recuperou: () => recuperouApos,
      deps: {
        maxTentativas: 0,
        baseMs: 1000,
        maxMs: 60_000,
        jitter: 0,
        aleatorio: () => 0,
        esperar: async (ms: number) => {
          esperas.push(ms)
        },
        aoRetentar: (t: TentativaReconexao) => tentativas.push(t),
        aoRecuperar: (n: number) => {
          recuperouApos = n
        },
        ...overrides,
      },
    }
  }

  test('ConnectionReset duas vezes e depois volta: retoma sem matar o processo', async () => {
    const d = deps()
    let chamadas = 0
    const resultado = await comReconexao(async () => {
      chamadas++
      if (chamadas <= 2) throw erroDeSocketAninhado('ECONNRESET')
      return 'job-processado'
    }, d.deps)

    assert.equal(resultado, 'job-processado')
    assert.equal(chamadas, 3, 'deve ter tentado 3 vezes no total')
    assert.deepEqual(d.esperas, [1000, 2000], 'backoff exponencial entre as tentativas')
    assert.equal(d.recuperou(), 2, 'recuperação registrada com as tentativas gastas')
  })

  test('registra tentativa, motivo e próxima espera em cada falha', () => {
    const d = deps()
    return comReconexao(async () => {
      if (d.tentativas.length < 1) throw erroPrisma('P1001', 'Can\'t reach database server')
      return 'ok'
    }, d.deps).then(() => {
      assert.equal(d.tentativas.length, 1)
      const t = d.tentativas[0]
      assert.equal(t.tentativa, 1)
      assert.ok(t.motivo.includes('P1001'), 'motivo deve nomear o código real')
      assert.equal(t.proximaEsperaMs, 1000)
    })
  })

  test('erro FATAL relança na hora, sem esperar nem retentar', async () => {
    const d = deps()
    let chamadas = 0
    await assert.rejects(
      () =>
        comReconexao(async () => {
          chamadas++
          throw erroPrisma('P1000', 'Authentication failed')
        }, d.deps),
      /Authentication failed/
    )
    assert.equal(chamadas, 1, 'não pode retentar erro de credencial')
    assert.deepEqual(d.esperas, [], 'não pode esperar antes de falhar')
  })

  test('erro permanente desconhecido não é engolido pelo retry', async () => {
    const d = deps()
    await assert.rejects(() => comReconexao(async () => {
      throw new Error('bug de lógica no worker')
    }, d.deps), /bug de lógica no worker/)
    assert.equal(d.tentativas.length, 0)
  })

  test('com limite, esgotar as tentativas relança o último erro (morre alto)', async () => {
    const d = deps({ maxTentativas: 3 })
    let chamadas = 0
    await assert.rejects(
      () =>
        comReconexao(async () => {
          chamadas++
          throw erroPrisma('P1001', 'Can\'t reach database server')
        }, d.deps),
      /Can't reach database server/
    )
    assert.equal(chamadas, 4, '1 tentativa inicial + 3 retentativas')
    assert.equal(d.esperas.length, 3)
  })

  test('sem limite (loop residente), sobrevive a uma queda longa e volta', async () => {
    const d = deps()
    let chamadas = 0
    const QUEDA_LONGA = 50
    const resultado = await comReconexao(async () => {
      chamadas++
      if (chamadas <= QUEDA_LONGA) throw erroPrisma('ECONNRESET')
      return 'voltou'
    }, d.deps)

    assert.equal(resultado, 'voltou')
    assert.equal(d.esperas.length, QUEDA_LONGA)
    // Depois de saturar, todas as esperas ficam no teto — sem martelar o pooler.
    assert.equal(d.esperas[d.esperas.length - 1], 60_000)
    assert.ok(d.esperas.every((e) => e <= 60_000))
  })

  test('sucesso de primeira não registra retentativa nem recuperação', async () => {
    const d = deps()
    assert.equal(await comReconexao(async () => 'direto', d.deps), 'direto')
    assert.deepEqual(d.tentativas, [])
    assert.equal(d.recuperou(), null)
  })
})
