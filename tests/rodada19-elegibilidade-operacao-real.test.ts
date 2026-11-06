/**
 * P0.2 Bloco 3 — elegibilidade para REAL_OPERATION.
 *
 * A autoridade é uma função pura, então todos os casos perigosos são
 * exercidos com os dados exatos, sem banco. O que precisa de Postgres (a
 * leitura do retrato e da evidência no AuditLog) está em
 * `rodada19-elegibilidade-banco.test.ts`.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  avaliarElegibilidadeParaOperacaoReal,
  vendaEhOperacaoReal,
  evidenciaEhValida,
  MOTIVOS_INELEGIBILIDADE,
  STATUS_DE_COMISSAO_RECONHECIDA,
  ACAO_AUDIT_EVIDENCIA,
  lerEvidenciaDeMetadata,
  type ComissaoParaElegibilidade,
  type EvidenciaRegistrada,
  type VendaParaElegibilidade,
} from '../lib/real-operation'
import { ORIGENS_DE_REGISTRO } from '../lib/proveniencia'

const RAIZ = join(__dirname, '..')
const lerFonte = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')
const lerCodigo = (rel: string) =>
  lerFonte(rel)
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n')

const WS = 'ws-alfa'
const OUTRO_WS = 'ws-beta'
const SALE = 'sale-1'

/** Evidência externa válida — webhook oficial, com referência conferível. */
const EVIDENCIA_PROVIDER: EvidenciaRegistrada = {
  tipo: 'PROVIDER_OFICIAL',
  registradaEm: new Date('2026-09-21T12:00:00.000Z'),
  referencia: 'webhook-evt-9f3a1',
}

function comissao(over: Partial<ComissaoParaElegibilidade> = {}): ComissaoParaElegibilidade {
  return { id: 'com-1', saleId: SALE, workspaceId: WS, status: 'CONFIRMED', ...over }
}

/** Venda que passa em TUDO. Cada teste estraga exatamente um aspecto. */
function venda(over: Partial<VendaParaElegibilidade> = {}): VendaParaElegibilidade {
  return {
    id: SALE,
    workspaceId: WS,
    dataOrigin: 'REAL_OPERATION',
    status: 'CONFIRMED',
    productWorkspaceId: WS,
    linkWorkspaceId: WS,
    contentWorkspaceId: WS,
    commissions: [comissao()],
    evidencias: [EVIDENCIA_PROVIDER],
    ...over,
  }
}

const avaliar = (over: Partial<VendaParaElegibilidade> = {}) =>
  avaliarElegibilidadeParaOperacaoReal(venda(over))

// ── Casos que PASSAM ────────────────────────────────────────────────────

describe('Elegível — e só quando tudo confere', () => {
  test('REAL_OPERATION + venda CONFIRMED + comissão CONFIRMED → elegível', () => {
    const v = avaliar({ commissions: [comissao({ status: 'CONFIRMED' })] })
    assert.equal(v.elegivel, true)
    assert.deepEqual(v.motivos, [])
    assert.equal(v.evidenciaUtilizada, 'PROVIDER_OFICIAL')
  })

  test('REAL_OPERATION + venda CONFIRMED + comissão RECEIVED → elegível', () => {
    const v = avaliar({ commissions: [comissao({ status: 'RECEIVED' })] })
    assert.equal(v.elegivel, true)
    assert.deepEqual(v.motivos, [])
  })

  test('EXPECTED junto de uma RECONHECIDA não atrapalha', () => {
    const v = avaliar({
      commissions: [comissao({ id: 'c1', status: 'EXPECTED' }), comissao({ id: 'c2', status: 'RECEIVED' })],
    })
    assert.equal(v.elegivel, true)
    assert.deepEqual(v.statusDasComissoes, ['EXPECTED', 'RECEIVED'])
  })

  test('relação ausente (sem link, sem conteúdo) não bloqueia', () => {
    // Venda sem link é legítima; o que invalida é link de OUTRO workspace.
    const v = avaliar({ linkWorkspaceId: null, contentWorkspaceId: null })
    assert.equal(v.elegivel, true)
  })

  test('o veredito devolve a estrutura completa que o Bloco 4 vai consumir', () => {
    const v = avaliar()
    assert.equal(v.saleId, SALE)
    assert.equal(v.workspaceId, WS)
    assert.equal(v.dataOrigin, 'REAL_OPERATION')
    assert.equal(v.statusDaVenda, 'CONFIRMED')
    assert.deepEqual(v.statusDasComissoes, ['CONFIRMED'])
    assert.equal(v.evidenciaUtilizada, 'PROVIDER_OFICIAL')
    assert.ok(v.explicacao.includes('elegível'))
  })

  test('`vendaEhOperacaoReal` concorda com o veredito completo', () => {
    assert.equal(vendaEhOperacaoReal(venda()), true)
    assert.equal(vendaEhOperacaoReal(venda({ status: 'PENDING' })), false)
  })
})

// ── Casos BLOQUEADOS: origem ────────────────────────────────────────────

describe('Bloqueado — origem que não é operação real', () => {
  for (const origem of ['USER_REPORTED', 'UNVERIFIED', 'SEED', 'TEST_FIXTURE', 'DEMO', 'SYNTHETIC_TEST']) {
    test(`${origem} nunca é elegível, mesmo com tudo o mais perfeito`, () => {
      const v = avaliar({ dataOrigin: origem })
      assert.equal(v.elegivel, false)
      assert.ok(v.motivos.includes('ORIGEM_NAO_E_OPERACAO_REAL'))
      assert.equal(v.evidenciaUtilizada, null)
    })
  }

  test('USER_REPORTED com comissão CONFIRMED MANUALMENTE não vira operação real', () => {
    // O caso central desta rodada: confirmar a comissão na mesma tela é a
    // mesma declaração feita duas vezes, pela mesma pessoa. Não é evidência.
    const v = avaliarElegibilidadeParaOperacaoReal({
      ...venda({ dataOrigin: 'USER_REPORTED' }),
      commissions: [comissao({ status: 'CONFIRMED' })],
      evidencias: [],
    })
    assert.equal(v.elegivel, false)
    assert.ok(v.motivos.includes('ORIGEM_NAO_E_OPERACAO_REAL'))
    assert.ok(v.motivos.includes('SEM_EVIDENCIA_CONFIAVEL'))
  })

  test('USER_REPORTED com comissão RECEIVED também não basta', () => {
    const v = avaliarElegibilidadeParaOperacaoReal({
      ...venda({ dataOrigin: 'USER_REPORTED' }),
      commissions: [comissao({ status: 'RECEIVED' })],
      evidencias: [],
    })
    assert.equal(v.elegivel, false)
  })

  test('origem desconhecida ou corrompida é tratada como UNVERIFIED', () => {
    for (const lixo of ['PRODUCAO', 'real_operation', '', 'REAL', null, undefined, 42]) {
      const v = avaliar({ dataOrigin: lixo as string })
      assert.equal(v.elegivel, false)
      assert.equal(v.dataOrigin, 'UNVERIFIED')
    }
  })

  test('de todas as origens do vocabulário, só REAL_OPERATION passa', () => {
    const passam = ORIGENS_DE_REGISTRO.filter((o) => vendaEhOperacaoReal(venda({ dataOrigin: o })))
    assert.deepEqual(passam, ['REAL_OPERATION'])
  })
})

// ── Casos BLOQUEADOS: estado da venda ───────────────────────────────────

describe('Bloqueado — venda que não aconteceu', () => {
  test('Sale PENDING → não elegível', () => {
    const v = avaliar({ status: 'PENDING' })
    assert.equal(v.elegivel, false)
    assert.ok(v.motivos.includes('VENDA_NAO_CONFIRMADA'))
  })

  test('Sale CANCELLED → não elegível', () => {
    // Uma venda desfeita não pode ensinar ao modelo que converteu.
    const v = avaliar({ status: 'CANCELLED' })
    assert.equal(v.elegivel, false)
    assert.ok(v.motivos.includes('VENDA_NAO_CONFIRMADA'))
  })

  test('status ausente ou inventado → não elegível', () => {
    for (const s of ['', 'confirmed', 'OK', undefined as unknown as string]) {
      assert.equal(avaliar({ status: s }).elegivel, false)
    }
  })
})

// ── Casos BLOQUEADOS: comissão ──────────────────────────────────────────

describe('Bloqueado — comissão que não reconhece dinheiro', () => {
  test('REAL_OPERATION + comissão apenas EXPECTED → não elegível', () => {
    const v = avaliar({ commissions: [comissao({ status: 'EXPECTED' })] })
    assert.equal(v.elegivel, false)
    assert.ok(v.motivos.includes('SEM_COMISSAO_RECONHECIDA'))
  })

  test('nenhuma comissão → não elegível', () => {
    const v = avaliar({ commissions: [] })
    assert.equal(v.elegivel, false)
    assert.ok(v.motivos.includes('SEM_COMISSAO_RECONHECIDA'))
  })

  test('comissão SEM saleId nunca torna a venda elegível', () => {
    const v = avaliar({ commissions: [comissao({ saleId: null, status: 'RECEIVED' })] })
    assert.equal(v.elegivel, false)
    assert.ok(v.motivos.includes('COMISSAO_SEM_VENDA'))
    assert.ok(v.motivos.includes('SEM_COMISSAO_RECONHECIDA'))
  })

  test('comissão de OUTRA venda não conta', () => {
    const v = avaliar({ commissions: [comissao({ saleId: 'sale-2', status: 'RECEIVED' })] })
    assert.equal(v.elegivel, false)
    assert.ok(v.motivos.includes('COMISSAO_SEM_VENDA'))
  })

  test('statusDasComissoes lista só as desta venda', () => {
    const v = avaliar({
      commissions: [comissao({ id: 'a', status: 'RECEIVED' }), comissao({ id: 'b', saleId: 'sale-2', status: 'CONFIRMED' })],
    })
    assert.deepEqual(v.statusDasComissoes, ['RECEIVED'])
  })

  test('só CONFIRMED e RECEIVED contam como reconhecidas', () => {
    assert.deepEqual([...STATUS_DE_COMISSAO_RECONHECIDA], ['CONFIRMED', 'RECEIVED'])
    for (const s of ['EXPECTED', 'PENDING', 'PAID', '', 'confirmed']) {
      assert.equal(avaliar({ commissions: [comissao({ status: s })] }).elegivel, false, `${s} não pode contar`)
    }
  })
})

// ── Casos BLOQUEADOS: isolamento ────────────────────────────────────────

describe('Bloqueado — relação cruzada de workspace', () => {
  test('produto de outro workspace → não elegível', () => {
    const v = avaliar({ productWorkspaceId: OUTRO_WS })
    assert.equal(v.elegivel, false)
    assert.ok(v.motivos.includes('WORKSPACE_INCONSISTENTE'))
  })

  test('link de outro workspace → não elegível', () => {
    assert.ok(avaliar({ linkWorkspaceId: OUTRO_WS }).motivos.includes('WORKSPACE_INCONSISTENTE'))
  })

  test('conteúdo de outro workspace → não elegível', () => {
    assert.ok(avaliar({ contentWorkspaceId: OUTRO_WS }).motivos.includes('WORKSPACE_INCONSISTENTE'))
  })

  test('comissão de outro workspace → não elegível', () => {
    const v = avaliar({ commissions: [comissao({ workspaceId: OUTRO_WS })] })
    assert.equal(v.elegivel, false)
    assert.ok(v.motivos.includes('WORKSPACE_INCONSISTENTE'))
  })
})

// ── Casos BLOQUEADOS: evidência ─────────────────────────────────────────

describe('Bloqueado — sem evidência confiável', () => {
  test('nenhuma evidência → não elegível, mesmo com origem já REAL_OPERATION', () => {
    // As duas condições se somam. Origem sozinha nunca substitui evidência.
    const v = avaliar({ evidencias: [] })
    assert.equal(v.elegivel, false)
    assert.ok(v.motivos.includes('SEM_EVIDENCIA_CONFIAVEL'))
    assert.deepEqual(v.motivos, ['SEM_EVIDENCIA_CONFIAVEL'])
  })

  test('evidência de tipo inventado não vale', () => {
    const v = avaliar({
      evidencias: [{ tipo: 'ACHO_QUE_VENDEU', registradaEm: new Date(), referencia: 'x' }],
    })
    assert.equal(v.elegivel, false)
  })

  test('evidência sem referência conferível não vale', () => {
    // Evidência sem referência é afirmação, não prova.
    for (const ref of [null, undefined, '', '   ']) {
      const v = avaliar({
        evidencias: [{ ...EVIDENCIA_PROVIDER, referencia: ref as string | null }],
      })
      assert.equal(v.elegivel, false, `referência ${JSON.stringify(ref)} não deveria valer`)
    }
  })

  test('evidência com data ilegível não vale', () => {
    const v = avaliar({ evidencias: [{ ...EVIDENCIA_PROVIDER, registradaEm: new Date('xx') }] })
    assert.equal(v.elegivel, false)
  })

  test('CORRECAO_MANUAL_AUDITADA exige responsável E motivo', () => {
    const base: EvidenciaRegistrada = {
      tipo: 'CORRECAO_MANUAL_AUDITADA',
      registradaEm: new Date('2026-09-21T12:00:00.000Z'),
      referencia: 'extrato-2026-09',
      responsavelUserId: 'user-1',
      motivo: 'Repasse conferido no extrato do banco.',
    }
    assert.equal(evidenciaEhValida(base), true)
    assert.equal(evidenciaEhValida({ ...base, responsavelUserId: null }), false)
    assert.equal(evidenciaEhValida({ ...base, motivo: null }), false)
    assert.equal(evidenciaEhValida({ ...base, motivo: '  ' }), false)
  })

  test('correção manual COMPLETA é evidência aceita', () => {
    const v = avaliar({
      evidencias: [
        {
          tipo: 'CORRECAO_MANUAL_AUDITADA',
          registradaEm: new Date('2026-09-21T12:00:00.000Z'),
          referencia: 'extrato-2026-09',
          responsavelUserId: 'user-1',
          motivo: 'Repasse conferido no extrato.',
        },
      ],
    })
    assert.equal(v.elegivel, true)
    assert.equal(v.evidenciaUtilizada, 'CORRECAO_MANUAL_AUDITADA')
  })

  test('uma inválida não contamina uma válida presente', () => {
    const v = avaliar({
      evidencias: [{ tipo: 'LIXO', registradaEm: new Date(), referencia: 'x' }, EVIDENCIA_PROVIDER],
    })
    assert.equal(v.elegivel, true)
  })

  test('evidência NUNCA é derivada de Commission.status', () => {
    // Se fosse, confirmar a comissão pela tela viraria prova — exatamente o
    // que esta regra existe para impedir.
    const codigo = lerCodigo('lib/real-operation.ts')
    const trecho = codigo.slice(codigo.indexOf('const valida ='), codigo.indexOf('const elegivel ='))
    assert.ok(!/status/.test(trecho), 'a busca por evidência não pode olhar status de comissão')
  })
})

// ── Garantias estruturais ───────────────────────────────────────────────

describe('Garantias da autoridade única', () => {
  test('a função é pura: não altera a venda recebida', () => {
    const v = venda()
    const copia = JSON.parse(JSON.stringify(v))
    avaliarElegibilidadeParaOperacaoReal(v)
    assert.deepEqual(JSON.parse(JSON.stringify(v)), copia)
  })

  test('venda sem id ou sem workspace → DADOS_INSUFICIENTES', () => {
    assert.ok(avaliar({ id: '' }).motivos.includes('DADOS_INSUFICIENTES'))
    assert.ok(avaliar({ workspaceId: '' }).motivos.includes('DADOS_INSUFICIENTES'))
  })

  test('entrada completamente vazia não quebra e nega', () => {
    const v = avaliarElegibilidadeParaOperacaoReal({} as VendaParaElegibilidade)
    assert.equal(v.elegivel, false)
    assert.ok(v.motivos.length > 0)
  })

  test('motivos acumulam — o diagnóstico mostra o quadro inteiro', () => {
    const v = avaliarElegibilidadeParaOperacaoReal({
      ...venda({ dataOrigin: 'SEED', status: 'CANCELLED', productWorkspaceId: OUTRO_WS }),
      commissions: [],
      evidencias: [],
    })
    assert.equal(v.elegivel, false)
    for (const m of ['ORIGEM_NAO_E_OPERACAO_REAL', 'VENDA_NAO_CONFIRMADA', 'SEM_COMISSAO_RECONHECIDA', 'WORKSPACE_INCONSISTENTE', 'SEM_EVIDENCIA_CONFIAVEL']) {
      assert.ok(v.motivos.includes(m as never), `faltou o motivo ${m}`)
    }
  })

  test('todo motivo devolvido pertence à lista declarada', () => {
    const casos = [{}, { status: 'PENDING' }, { dataOrigin: 'SEED' }, { commissions: [] }, { evidencias: [] }]
    for (const c of casos) {
      for (const m of avaliar(c).motivos) {
        assert.ok((MOTIVOS_INELEGIBILIDADE as readonly string[]).includes(m))
      }
    }
  })

  test('elegivel:true SEMPRE vem com motivos vazios e evidência nomeada', () => {
    const v = avaliar()
    assert.equal(v.elegivel, true)
    assert.equal(v.motivos.length, 0)
    assert.ok(v.evidenciaUtilizada)
  })

  test('elegivel:false SEMPRE vem sem evidência utilizada', () => {
    for (const c of [{ status: 'PENDING' }, { dataOrigin: 'SEED' }, { evidencias: [] }]) {
      const v = avaliar(c)
      assert.equal(v.elegivel, false)
      assert.equal(v.evidenciaUtilizada, null)
    }
  })

  test('não existe parâmetro de afrouxamento na autoridade', () => {
    // Um "modoPermissivo" aqui seria o caminho mais curto para contaminar o
    // modelo sem ninguém perceber.
    assert.equal(avaliarElegibilidadeParaOperacaoReal.length, 1)
    assert.equal(vendaEhOperacaoReal.length, 1)
  })

  test('nenhuma inferência, score, heurística ou ML na autoridade', () => {
    const codigo = lerCodigo('lib/real-operation.ts')
    for (const proibido of ['Math.random', 'score', 'probabilit', 'predizer', 'mlEngine', 'modelo']) {
      assert.ok(!codigo.toLowerCase().includes(proibido.toLowerCase()), `${proibido} não pode estar na regra`)
    }
  })
})

// ── Leitura da evidência gravada ────────────────────────────────────────

describe('Evidência lida do AuditLog', () => {
  test('metadata bem formado vira evidência', () => {
    const e = lerEvidenciaDeMetadata(
      { tipo: 'PROVIDER_OFICIAL', referencia: 'evt-1' },
      new Date('2026-09-21T12:00:00.000Z')
    )
    assert.ok(e)
    assert.equal(e!.tipo, 'PROVIDER_OFICIAL')
  })

  test('metadata inválido é descartado, nunca aproveitado pela metade', () => {
    for (const m of [null, undefined, 'texto', 42, {}, { tipo: 'PROVIDER_OFICIAL' }, { tipo: 'LIXO', referencia: 'x' }]) {
      assert.equal(lerEvidenciaDeMetadata(m, new Date()), null, `${JSON.stringify(m)} não deveria virar evidência`)
    }
  })

  test('a ação de auditoria é dedicada e não se confunde com as outras', () => {
    assert.equal(ACAO_AUDIT_EVIDENCIA, 'venda.evidencia_de_operacao_real')
    assert.notEqual(ACAO_AUDIT_EVIDENCIA, 'venda.criada')
  })
})

// ── Nada de ML e nada de promoção nesta rodada ──────────────────────────

describe('Esta rodada não liga o ML nem promove nada', () => {
  test('a autoridade não escreve no banco', () => {
    const codigo = lerCodigo('lib/real-operation.ts')
    for (const escrita of ['.create(', '.update(', '.upsert(', '.delete(', '$executeRaw']) {
      assert.ok(!codigo.includes(escrita), `real-operation.ts não pode escrever (${escrita})`)
    }
  })

  test('nenhuma promoção automática de dataOrigin em lugar nenhum', () => {
    for (const arq of ['lib/real-operation.ts', 'lib/proveniencia.ts', 'lib/vendas-comissoes.ts']) {
      const codigo = lerCodigo(arq)
      assert.ok(
        !/dataOrigin:\s*'REAL_OPERATION'/.test(codigo),
        `${arq} não pode atribuir REAL_OPERATION a nada`
      )
    }
  })

  test('a autoridade não toca o feature store', () => {
    const codigo = lerCodigo('lib/real-operation.ts')
    assert.ok(!/salvarFeatureSnapshot|mLFeatureSnapshot|registrarLabelNoSnapshot/.test(codigo))
  })

  test('hoje NENHUM código grava a ação de evidência — e isso está documentado', () => {
    // Estado honesto: sem o caminho de comprovação, toda venda é
    // corretamente inelegível. O teste falha quando alguém implementar o
    // gravador, forçando a revisão consciente desta afirmação.
    const gravadores = [lerCodigo('lib/vendas-comissoes.ts'), lerCodigo('app/api/vendas/route.ts')]
    for (const g of gravadores) {
      assert.ok(!g.includes('venda.evidencia_de_operacao_real'))
    }
    assert.match(lerFonte('lib/real-operation.ts'), /NENHUM código grava esta ação ainda/)
  })
})
