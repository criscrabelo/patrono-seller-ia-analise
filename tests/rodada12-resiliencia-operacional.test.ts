/**
 * Rodada 12 — automação operacional: trava de worker duplicado e gate de
 * memória.
 *
 * Origem real: em 20/09/2026 a máquina chegou a 83% de RAM ocupada e os
 * processos de fundo foram encerrados por pressão de memória, ficando fora
 * do ar até alguém religar. Os dois mecanismos aqui atacam os dois lados
 * disso — não subir um segundo worker quando o primeiro volta, e não
 * começar geração pesada sem memória.
 *
 * Tudo determinístico: nenhum processo é criado ou morto, nenhuma RAM é
 * enchida de propósito. `processoVivo` e a memória livre entram por
 * parâmetro.
 */

import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  adquirirLock,
  liberarLock,
  chaveDoLock,
  caminhoDoLock,
  processoVivoReal,
  type ConteudoLock,
} from '../lib/worker-lock'
import {
  avaliarMemoriaParaJobPesado,
  lerLimiteMinimoRamGB,
  bytesParaGB,
  MIN_FREE_RAM_GB_PADRAO,
} from '../lib/worker-memoria'

const GB = 1024 ** 3
const criados: string[] = []

function dirTemporario(): string {
  const d = mkdtempSync(join(tmpdir(), 'patrono-lock-teste-'))
  criados.push(d)
  return d
}

afterEach(() => {
  while (criados.length) {
    const d = criados.pop() as string
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      /* limpeza best-effort */
    }
  }
})

const VIVO = { processoVivo: () => true, agora: new Date('2026-09-20T12:00:00Z') }
const MORTO = { processoVivo: () => false, agora: new Date('2026-09-20T12:00:00Z') }

function lerLock(caminho: string): ConteudoLock {
  return JSON.parse(readFileSync(caminho, 'utf8')) as ConteudoLock
}

describe('Trava de worker duplicado', () => {
  test('primeiro worker adquire o lock num destino livre', () => {
    const caminho = join(dirTemporario(), 'w.lock')
    const r = adquirirLock(caminho, 111, 'worker-a', VIVO)
    assert.equal(r.adquirido, true)
    assert.equal(r.motivo, 'ADQUIRIDO_LIVRE')
    assert.ok(existsSync(caminho))
    assert.equal(lerLock(caminho).pid, 111)
    assert.equal(lerLock(caminho).workerId, 'worker-a')
  })

  test('SEGUNDO worker e recusado enquanto o primeiro esta vivo', () => {
    const caminho = join(dirTemporario(), 'w.lock')
    adquirirLock(caminho, 111, 'worker-a', VIVO)

    const segundo = adquirirLock(caminho, 222, 'worker-b', VIVO)
    assert.equal(segundo.adquirido, false)
    assert.equal(segundo.motivo, 'RECUSADO_WORKER_VIVO')
    assert.equal(segundo.pidExistente, 111)
    assert.match(segundo.mensagem, /PID 111/)
  })

  test('o segundo NAO rouba o lock do primeiro', () => {
    const caminho = join(dirTemporario(), 'w.lock')
    adquirirLock(caminho, 111, 'worker-a', VIVO)
    adquirirLock(caminho, 222, 'worker-b', VIVO)
    assert.equal(lerLock(caminho).pid, 111, 'o lock tem de continuar do primeiro')
  })

  test('lock de processo MORTO e assumido — worker reiniciado nao fica travado para sempre', () => {
    const caminho = join(dirTemporario(), 'w.lock')
    adquirirLock(caminho, 111, 'worker-antigo', VIVO)

    // E o cenario do restart automatico: o antigo morreu sem liberar nada.
    const novo = adquirirLock(caminho, 222, 'worker-novo', MORTO)
    assert.equal(novo.adquirido, true)
    assert.equal(novo.motivo, 'ADQUIRIDO_LOCK_OBSOLETO')
    assert.match(novo.mensagem, /obsoleto/)
    assert.equal(lerLock(caminho).pid, 222)
  })

  test('lock corrompido nao trava o worker para sempre', () => {
    const caminho = join(dirTemporario(), 'w.lock')
    writeFileSync(caminho, 'isto nao e json', 'utf8')
    const r = adquirirLock(caminho, 333, 'worker-c', VIVO)
    assert.equal(r.adquirido, true)
    assert.equal(r.motivo, 'ADQUIRIDO_LOCK_CORROMPIDO')
  })

  test('liberar remove o lock quando ele e nosso', () => {
    const caminho = join(dirTemporario(), 'w.lock')
    adquirirLock(caminho, 111, 'worker-a', VIVO)
    assert.equal(liberarLock(caminho, 111), true)
    assert.equal(existsSync(caminho), false)
  })

  test('worker que perdeu o lock NAO apaga o lock de quem o assumiu', () => {
    const caminho = join(dirTemporario(), 'w.lock')
    adquirirLock(caminho, 111, 'worker-antigo', VIVO)
    adquirirLock(caminho, 222, 'worker-novo', MORTO)

    assert.equal(liberarLock(caminho, 111), false, 'o antigo nao pode remover')
    assert.ok(existsSync(caminho), 'o lock do novo tem de sobreviver')
    assert.equal(lerLock(caminho).pid, 222)
  })

  test('liberar lock inexistente nao quebra', () => {
    assert.equal(liberarLock(join(dirTemporario(), 'nao-existe.lock'), 111), false)
  })

  test('workspaces diferentes NAO se bloqueiam (multi-negocio)', () => {
    const destino = 'postgresql://host/db'
    const a = chaveDoLock(destino, 'workspace-afiliados')
    const b = chaveDoLock(destino, 'workspace-advocacia')
    assert.notEqual(a, b)

    const dir = dirTemporario()
    assert.equal(adquirirLock(caminhoDoLock(a, dir), 111, 'worker-a', VIVO).adquirido, true)
    assert.equal(adquirirLock(caminhoDoLock(b, dir), 222, 'worker-b', VIVO).adquirido, true)
  })

  test('mesmo destino e mesmo workspace geram a MESMA chave', () => {
    assert.equal(chaveDoLock('postgresql://host/db', 'ws-1'), chaveDoLock('postgresql://host/db', 'ws-1'))
  })

  test('destinos diferentes nao se bloqueiam (teste x producao)', () => {
    assert.notEqual(chaveDoLock('postgresql://host/teste', 'ws-1'), chaveDoLock('postgresql://host/prod', 'ws-1'))
  })

  test('a chave nunca expoe a string de conexao no nome do arquivo', () => {
    const url = 'postgresql://postgres.abc:SENHA_SECRETA@host:6543/postgres'
    const caminho = caminhoDoLock(chaveDoLock(url, 'ws-1'), dirTemporario())
    assert.ok(!caminho.includes('SENHA_SECRETA'))
    assert.ok(!caminho.includes('postgres.abc'))
    assert.match(caminho, /patrono-worker-[0-9a-f]{16}\.lock$/)
  })

  test('processoVivoReal reconhece o proprio processo e recusa PID invalido', () => {
    assert.equal(processoVivoReal(process.pid), true)
    assert.equal(processoVivoReal(-1), false)
    assert.equal(processoVivoReal(0), false)
  })
})

describe('Gate de memoria para jobs pesados', () => {
  test('memoria ABAIXO do limite: nao reivindica', () => {
    const d = avaliarMemoriaParaJobPesado(2 * GB, { DIGITAL_TWIN_MIN_FREE_RAM_GB: '3' })
    assert.equal(d.podeReivindicar, false)
    assert.equal(d.livreGB, 2)
    assert.equal(d.limiteGB, 3)
    assert.match(d.motivo, /continua na fila/)
  })

  test('memoria VOLTANDO ao normal: volta a reivindicar sozinho', () => {
    const env = { DIGITAL_TWIN_MIN_FREE_RAM_GB: '3' }
    assert.equal(avaliarMemoriaParaJobPesado(2.6 * GB, env).podeReivindicar, false)
    assert.equal(avaliarMemoriaParaJobPesado(6 * GB, env).podeReivindicar, true)
  })

  test('exatamente no limite e suficiente', () => {
    assert.equal(avaliarMemoriaParaJobPesado(3 * GB, { DIGITAL_TWIN_MIN_FREE_RAM_GB: '3' }).podeReivindicar, true)
  })

  test('o cenario real do incidente (2,66 GB livres) e barrado pelo default', () => {
    const d = avaliarMemoriaParaJobPesado(2.66 * GB, {})
    assert.equal(d.podeReivindicar, false)
    assert.equal(d.limiteGB, MIN_FREE_RAM_GB_PADRAO)
  })

  test('motivo NUNCA sugere falha do job — nada de FAILED', () => {
    const d = avaliarMemoriaParaJobPesado(1 * GB, {})
    assert.ok(!/falh|erro|FAILED/i.test(d.motivo), 'motivo nao pode soar como falha: ' + d.motivo)
    assert.match(d.motivo, /assim que houver memoria|assim que houver mem/)
  })
})

describe('Configuracao do limite de memoria', () => {
  test('default conservador quando a variavel nao existe', () => {
    assert.equal(lerLimiteMinimoRamGB({}), MIN_FREE_RAM_GB_PADRAO)
    assert.equal(MIN_FREE_RAM_GB_PADRAO, 3)
  })

  test('valor valido e respeitado, inclusive fracionario', () => {
    assert.equal(lerLimiteMinimoRamGB({ DIGITAL_TWIN_MIN_FREE_RAM_GB: '8' }), 8)
    assert.equal(lerLimiteMinimoRamGB({ DIGITAL_TWIN_MIN_FREE_RAM_GB: '1.5' }), 1.5)
  })

  test('zero desliga o gate de proposito', () => {
    assert.equal(lerLimiteMinimoRamGB({ DIGITAL_TWIN_MIN_FREE_RAM_GB: '0' }), 0)
    const d = avaliarMemoriaParaJobPesado(0.1 * GB, { DIGITAL_TWIN_MIN_FREE_RAM_GB: '0' })
    assert.equal(d.podeReivindicar, true)
    assert.match(d.motivo, /desligado/)
  })

  test('valor invalido cai no default em vez de desligar o gate por engano', () => {
    for (const ruim of ['abc', '', '   ', '-5', 'NaN']) {
      assert.equal(
        lerLimiteMinimoRamGB({ DIGITAL_TWIN_MIN_FREE_RAM_GB: ruim }),
        MIN_FREE_RAM_GB_PADRAO,
        'entrada: ' + JSON.stringify(ruim)
      )
    }
  })

  test('conversao de bytes para GB arredonda em uma casa', () => {
    assert.equal(bytesParaGB(2.66 * GB), 2.7)
    assert.equal(bytesParaGB(0), 0)
  })
})
