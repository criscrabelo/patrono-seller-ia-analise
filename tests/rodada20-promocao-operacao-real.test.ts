/**
 * P0.2 Bloco 3.1 — comprovação e promoção auditada (regra pura).
 *
 * Revisto na rodada de CONFIANÇA DA EVIDÊNCIA: o tipo de evidência deixou
 * de vir do payload. Agora há dois caminhos com capacidades diferentes —
 * correção manual (interface) e evidência verificada (sistema) — e o
 * segundo exige um objeto que só `verificarEvidencia()` emite.
 *
 * O que precisa de Postgres — transação, idempotência, conferência de
 * usuário e comissão — está em `rodada20-promocao-banco.test.ts`.
 */

import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  validarCorrecaoManual,
  validarEvidenciaVerificada,
  validarOrigemPromovivel,
  chaveDaEvidencia,
  ORIGENS_PROMOVIVEIS,
  MOTIVOS_RECUSA_PROMOCAO,
  TAMANHO_MINIMO_DO_MOTIVO,
  ACAO_AUDIT_PROMOCAO,
  PENDENCIA_DE_AUTOMACAO,
  type ContextoDaVenda,
  type PedidoDeCorrecaoManual,
  type PedidoDeEvidenciaVerificada,
} from '../lib/promocao-operacao-real'
import {
  verificarEvidencia,
  registrarVerificadorDeEvidencia,
  limparVerificadoresDeEvidencia,
  listarVerificadoresDeEvidencia,
  tiposComVerificador,
  ehFonteVerificada,
  type FonteVerificada,
} from '../lib/evidencia-verificada'
import { EVIDENCIAS_ACEITAS_PARA_OPERACAO_REAL, ORIGENS_DE_REGISTRO } from '../lib/proveniencia'
import { ACAO_AUDIT_EVIDENCIA } from '../lib/real-operation'

const RAIZ = join(__dirname, '..')
const lerFonte = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')
const lerCodigo = (rel: string) =>
  lerFonte(rel)
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n')

const WS = 'ws-alfa'
const SALE = 'sale-1'

function manual(over: Partial<PedidoDeCorrecaoManual> = {}): PedidoDeCorrecaoManual {
  return {
    workspaceId: WS,
    saleId: SALE,
    responsavelUserId: 'user-1',
    motivo: 'Repasse conferido no extrato bancário da conta da empresa.',
    referencia: 'extrato-banco-2026-09-18-linha-42',
    ...over,
  }
}

function contexto(over: Partial<ContextoDaVenda> = {}): ContextoDaVenda {
  return { origemAtual: 'USER_REPORTED', responsavelDoWorkspace: true, comissaoComprovada: true, ...over }
}

const validarManual = (p: Partial<PedidoDeCorrecaoManual> = {}, c: Partial<ContextoDaVenda> = {}) =>
  validarCorrecaoManual(manual(p), contexto(c))

const motivoDe = (r: ReturnType<typeof validarManual>) => (r as { motivo: string }).motivo

/** Registra um verificador de mentira que confirma — como um adapter real faria. */
function registrarVerificadorFake(tipo: string, id = `fake-${tipo}`) {
  registrarVerificadorDeEvidencia({
    id,
    tipo: tipo as never,
    async verificar(pedido) {
      return { referencia: `conferido-${pedido.saleId}`, detalhes: { via: id } }
    },
  })
}

beforeEach(() => limparVerificadoresDeEvidencia())

// ── Capacidade: quem pode emitir evidência de sistema ───────────────────

describe('Confiança — uma FonteVerificada só existe se for emitida aqui', () => {
  test('sem verificador registrado, nenhum tipo de sistema é alcançável', async () => {
    // Estado de hoje no repositório: nenhuma integração conectada.
    assert.deepEqual(listarVerificadoresDeEvidencia(), [])
    assert.deepEqual(tiposComVerificador(), [])
    for (const tipo of ['PROVIDER_OFICIAL', 'CONCILIACAO_FINANCEIRA', 'COMISSAO_CONFIRMADA_COM_ORIGEM_VERIFICAVEL']) {
      const fonte = await verificarEvidencia(tipo as never, { workspaceId: WS, saleId: SALE })
      assert.equal(fonte, null, `${tipo} não podia ser emitido sem verificador`)
    }
  })

  test('objeto montado à mão NÃO passa na checagem de runtime', () => {
    // É o cerne: `ator: 'INTEGRACAO'` no TypeScript não protege nada, porque
    // em runtime qualquer chamador constrói o objeto.
    const forjado = {
      tipo: 'PROVIDER_OFICIAL',
      referencia: 'webhook-123',
      verificadorId: 'tiktok',
      verificadaEm: new Date(),
      detalhes: {},
    }
    assert.equal(ehFonteVerificada(forjado), false)
    assert.equal(ehFonteVerificada(JSON.parse(JSON.stringify(forjado))), false)
  })

  test('PROVIDER_OFICIAL fabricado por chamada comum → recusa', () => {
    const forjado = {
      tipo: 'PROVIDER_OFICIAL',
      referencia: 'webhook-123',
      verificadorId: 'x',
      verificadaEm: new Date(),
      detalhes: {},
    } as unknown as FonteVerificada
    const r = validarEvidenciaVerificada(
      { workspaceId: WS, saleId: SALE, fonte: forjado },
      contexto()
    )
    assert.equal(r.ok, false)
    assert.equal((r as { motivo: string }).motivo, 'FONTE_NAO_VERIFICADA')
  })

  test('CONCILIACAO_FINANCEIRA sem prova verificável → recusa', () => {
    const forjado = {
      tipo: 'CONCILIACAO_FINANCEIRA',
      referencia: 'repasse-123',
      verificadorId: 'x',
      verificadaEm: new Date(),
      detalhes: {},
    } as unknown as FonteVerificada
    const r = validarEvidenciaVerificada({ workspaceId: WS, saleId: SALE, fonte: forjado }, contexto())
    assert.equal(r.ok, false)
    assert.equal((r as { motivo: string }).motivo, 'FONTE_NAO_VERIFICADA')
  })

  test('fonte ausente, nula ou de outro formato → recusa', () => {
    for (const f of [null, undefined, 'PROVIDER_OFICIAL', 42, {}, []]) {
      const r = validarEvidenciaVerificada(
        { workspaceId: WS, saleId: SALE, fonte: f as never },
        contexto()
      )
      assert.equal(r.ok, false)
      assert.equal((r as { motivo: string }).motivo, 'FONTE_NAO_VERIFICADA')
    }
  })

  test('provider COM verificador registrado emite fonte legítima e é aceita', async () => {
    registrarVerificadorFake('PROVIDER_OFICIAL')
    const fonte = await verificarEvidencia('PROVIDER_OFICIAL', { workspaceId: WS, saleId: SALE })
    assert.ok(fonte)
    assert.equal(ehFonteVerificada(fonte), true)
    assert.equal(fonte!.verificadorId, 'fake-PROVIDER_OFICIAL')
    // A referência vem do verificador, não do chamador.
    assert.equal(fonte!.referencia, `conferido-${SALE}`)

    const r = validarEvidenciaVerificada({ workspaceId: WS, saleId: SALE, fonte: fonte! }, contexto())
    assert.deepEqual(r, { ok: true })
  })

  test('conciliação COM verificador registrado é aceita', async () => {
    registrarVerificadorFake('CONCILIACAO_FINANCEIRA')
    const fonte = await verificarEvidencia('CONCILIACAO_FINANCEIRA', { workspaceId: WS, saleId: SALE })
    assert.ok(fonte)
    assert.deepEqual(validarEvidenciaVerificada({ workspaceId: WS, saleId: SALE, fonte: fonte! }, contexto()), {
      ok: true,
    })
  })

  test('verificador que não confirma NÃO emite fonte', async () => {
    registrarVerificadorDeEvidencia({
      id: 'recusa-tudo',
      tipo: 'PROVIDER_OFICIAL',
      async verificar() {
        return null
      },
    })
    assert.equal(await verificarEvidencia('PROVIDER_OFICIAL', { workspaceId: WS, saleId: SALE }), null)
  })

  test('verificador que lança erro NÃO emite fonte — erro não vira permissão', async () => {
    registrarVerificadorDeEvidencia({
      id: 'quebra',
      tipo: 'PROVIDER_OFICIAL',
      async verificar() {
        throw new Error('API fora do ar')
      },
    })
    assert.equal(await verificarEvidencia('PROVIDER_OFICIAL', { workspaceId: WS, saleId: SALE }), null)
  })

  test('verificador que devolve referência vazia NÃO emite fonte', async () => {
    registrarVerificadorDeEvidencia({
      id: 'vazio',
      tipo: 'PROVIDER_OFICIAL',
      async verificar() {
        return { referencia: '   ' }
      },
    })
    assert.equal(await verificarEvidencia('PROVIDER_OFICIAL', { workspaceId: WS, saleId: SALE }), null)
  })

  test('não é possível registrar verificador para CORRECAO_MANUAL_AUDITADA', () => {
    // Correção manual é decisão humana assinada, não carimbo de sistema.
    assert.throws(() =>
      registrarVerificadorDeEvidencia({
        id: 'carimbo',
        tipo: 'CORRECAO_MANUAL_AUDITADA',
        async verificar() {
          return { referencia: 'x' }
        },
      })
    )
  })

  test('verificador malformado é recusado no registro', () => {
    for (const v of [{}, { id: 'x' }, { id: 'x', tipo: 'PROVIDER_OFICIAL' }]) {
      assert.throws(() => registrarVerificadorDeEvidencia(v as never))
    }
  })

  test('a fonte emitida é imutável', async () => {
    registrarVerificadorFake('PROVIDER_OFICIAL')
    const fonte = (await verificarEvidencia('PROVIDER_OFICIAL', { workspaceId: WS, saleId: SALE }))!
    assert.ok(Object.isFrozen(fonte))
  })
})

// ── Comissão: qual comissão foi comprovada ──────────────────────────────

describe('Comissão comprovada — referência genérica não basta', () => {
  async function fonteDeComissao() {
    registrarVerificadorFake('COMISSAO_CONFIRMADA_COM_ORIGEM_VERIFICAVEL')
    return (await verificarEvidencia('COMISSAO_CONFIRMADA_COM_ORIGEM_VERIFICAVEL', {
      workspaceId: WS,
      saleId: SALE,
      commissionId: 'com-1',
    }))!
  }

  test('sem commissionId → recusa', async () => {
    const fonte = await fonteDeComissao()
    const r = validarEvidenciaVerificada({ workspaceId: WS, saleId: SALE, fonte }, contexto())
    assert.equal(r.ok, false)
    assert.equal((r as { motivo: string }).motivo, 'COMISSAO_NAO_INFORMADA')
  })

  test('commissionId em branco → recusa', async () => {
    const fonte = await fonteDeComissao()
    for (const id of ['', '   ', null]) {
      const r = validarEvidenciaVerificada(
        { workspaceId: WS, saleId: SALE, fonte, commissionId: id },
        contexto()
      )
      assert.equal(r.ok, false)
      assert.equal((r as { motivo: string }).motivo, 'COMISSAO_NAO_INFORMADA')
    }
  })

  test('comissão que não confere no banco → recusa', async () => {
    // `comissaoComprovada: false` é o que a consulta devolve quando a
    // comissão não existe, é de outra venda, de outro workspace, ou não
    // está CONFIRMED/RECEIVED.
    const fonte = await fonteDeComissao()
    const r = validarEvidenciaVerificada(
      { workspaceId: WS, saleId: SALE, fonte, commissionId: 'com-1' },
      contexto({ comissaoComprovada: false })
    )
    assert.equal(r.ok, false)
    assert.equal((r as { motivo: string }).motivo, 'COMISSAO_NAO_COMPROVADA')
  })

  test('comissão correta + fonte verificável → aceita', async () => {
    const fonte = await fonteDeComissao()
    const r = validarEvidenciaVerificada(
      { workspaceId: WS, saleId: SALE, fonte, commissionId: 'com-1' },
      contexto({ comissaoComprovada: true })
    )
    assert.deepEqual(r, { ok: true })
  })

  test('os outros tipos não exigem commissionId', async () => {
    registrarVerificadorFake('PROVIDER_OFICIAL')
    const fonte = (await verificarEvidencia('PROVIDER_OFICIAL', { workspaceId: WS, saleId: SALE }))!
    assert.deepEqual(validarEvidenciaVerificada({ workspaceId: WS, saleId: SALE, fonte }, contexto()), {
      ok: true,
    })
  })
})

// ── Correção manual ─────────────────────────────────────────────────────

describe('Correção manual — o único caminho da interface', () => {
  test('usuário do mesmo workspace + motivo + referência → aceita', () => {
    assert.deepEqual(validarManual(), { ok: true })
  })

  test('responsável ausente → recusa', () => {
    for (const u of ['', '   ', null, undefined]) {
      const r = validarManual({ responsavelUserId: u as string })
      assert.equal(r.ok, false)
      assert.equal(motivoDe(r), 'RESPONSAVEL_AUSENTE')
    }
  })

  test('usuário inexistente → recusa', () => {
    // `responsavelDoWorkspace: false` é o que a consulta devolve quando o
    // usuário não existe OU é de outro workspace.
    const r = validarManual({}, { responsavelDoWorkspace: false })
    assert.equal(r.ok, false)
    assert.equal(motivoDe(r), 'RESPONSAVEL_INVALIDO')
  })

  test('a mensagem não revela se o usuário existe em outro workspace', () => {
    const r = validarManual({}, { responsavelDoWorkspace: false })
    const explicacao = (r as { explicacao: string }).explicacao
    assert.ok(!/inexistente|não existe/i.test(explicacao), explicacao)
  })

  test('sem motivo → recusa', () => {
    assert.equal(motivoDe(validarManual({ motivo: '' })), 'MOTIVO_AUSENTE')
    assert.equal(motivoDe(validarManual({ motivo: null as unknown as string })), 'MOTIVO_AUSENTE')
  })

  test('motivo curto demais → recusa ("ok" não é justificativa)', () => {
    assert.equal(motivoDe(validarManual({ motivo: 'ok' })), 'MOTIVO_INSUFICIENTE')
    assert.ok(TAMANHO_MINIMO_DO_MOTIVO >= 10)
  })

  test('sem referência → recusa', () => {
    assert.equal(motivoDe(validarManual({ referencia: '  ' })), 'REFERENCIA_AUSENTE')
  })

  test('a interface não escolhe o tipo de evidência', () => {
    // O pedido manual não tem campo `tipoEvidencia`: é fixado no código.
    const campos = Object.keys(manual())
    assert.ok(!campos.includes('tipoEvidencia'))
    assert.match(lerCodigo('lib/promocao-operacao-real.ts'), /tipoEvidencia: 'CORRECAO_MANUAL_AUDITADA'/)
  })
})

// ── Origem ──────────────────────────────────────────────────────────────

describe('Origem — dado sintético nunca vira real', () => {
  for (const origem of ['SEED', 'TEST_FIXTURE', 'DEMO', 'SYNTHETIC_TEST']) {
    test(`${origem} nunca promove, por nenhum caminho`, async () => {
      assert.equal(motivoDe(validarManual({}, { origemAtual: origem })), 'ORIGEM_SINTETICA_NAO_PROMOVIVEL')

      registrarVerificadorFake('PROVIDER_OFICIAL')
      const fonte = (await verificarEvidencia('PROVIDER_OFICIAL', { workspaceId: WS, saleId: SALE }))!
      const r = validarEvidenciaVerificada(
        { workspaceId: WS, saleId: SALE, fonte },
        contexto({ origemAtual: origem })
      )
      assert.equal(r.ok, false)
      assert.equal((r as { motivo: string }).motivo, 'ORIGEM_SINTETICA_NAO_PROMOVIVEL')
    })
  }

  test('só USER_REPORTED e UNVERIFIED são promovíveis', () => {
    assert.deepEqual([...ORIGENS_PROMOVIVEIS], ['USER_REPORTED', 'UNVERIFIED'])
    const passam = ORIGENS_DE_REGISTRO.filter((o) => validarOrigemPromovivel({ workspaceId: WS, saleId: SALE }, o).ok)
    assert.deepEqual([...passam].sort(), ['UNVERIFIED', 'USER_REPORTED'])
  })

  test('já REAL_OPERATION → motivo próprio', () => {
    assert.equal(motivoDe(validarManual({}, { origemAtual: 'REAL_OPERATION' })), 'JA_ERA_OPERACAO_REAL')
  })

  test('saleId sem workspaceId e vice-versa → recusa', () => {
    assert.equal(motivoDe(validarManual({ workspaceId: '' })), 'WORKSPACE_AUSENTE')
    assert.equal(motivoDe(validarManual({ saleId: '' })), 'WORKSPACE_AUSENTE')
  })
})

// ── Idempotência ────────────────────────────────────────────────────────

describe('Chave de idempotência', () => {
  const base = { workspaceId: WS, saleId: SALE, tipoEvidencia: 'PROVIDER_OFICIAL', referencia: 'evt-1' }

  test('mesma evidência → mesma chave; espaços não contam', () => {
    assert.equal(chaveDaEvidencia(base), chaveDaEvidencia({ ...base, referencia: '  evt-1  ' }))
  })

  test('workspace, venda, tipo e referência entram todos na chave', () => {
    assert.notEqual(chaveDaEvidencia(base), chaveDaEvidencia({ ...base, workspaceId: 'ws-beta' }))
    assert.notEqual(chaveDaEvidencia(base), chaveDaEvidencia({ ...base, saleId: 'sale-2' }))
    assert.notEqual(chaveDaEvidencia(base), chaveDaEvidencia({ ...base, tipoEvidencia: 'CONCILIACAO_FINANCEIRA' }))
    assert.notEqual(chaveDaEvidencia(base), chaveDaEvidencia({ ...base, referencia: 'evt-2' }))
  })
})

// ── Garantias estruturais ───────────────────────────────────────────────

describe('Garantias da promoção', () => {
  const codigo = lerCodigo('lib/promocao-operacao-real.ts')

  test('validar → evidência → origem → auditoria, tudo numa transação', () => {
    assert.match(codigo, /prisma\.\$transaction/)
    assert.match(codigo, /pg_advisory_xact_lock/)
    const posEvidencia = codigo.indexOf('action: ACAO_AUDIT_EVIDENCIA')
    const posUpdate = codigo.indexOf('tx.sale.update')
    const posPromocao = codigo.indexOf('action: ACAO_AUDIT_PROMOCAO')
    assert.ok(posEvidencia > 0 && posUpdate > posEvidencia, 'evidência tem de vir antes da promoção')
    assert.ok(posPromocao > posUpdate, 'a auditoria da promoção vem por último')
  })

  test('a venda é sempre buscada COM o workspace', () => {
    assert.match(codigo, /where: \{ id: entrada\.saleId, workspaceId: entrada\.workspaceId \}/)
  })

  test('o responsável é conferido contra o banco, com workspace', () => {
    assert.match(codigo, /tx\.user\.findFirst\(\{[\s\S]{0,160}workspaceId: entrada\.workspaceId/)
  })

  test('a comissão é conferida por id, venda, workspace E status', () => {
    const trecho = codigo.slice(codigo.indexOf('tx.commission.findFirst'), codigo.indexOf('const validacao'))
    assert.match(trecho, /id: entrada\.commissionId/)
    assert.match(trecho, /workspaceId: entrada\.workspaceId/)
    assert.match(trecho, /saleId: entrada\.saleId/)
    assert.match(trecho, /status: \{ in: \['CONFIRMED', 'RECEIVED'\] \}/)
  })

  test('o contexto de confiança é apurado no banco, nunca aceito do chamador', () => {
    // Se `responsavelDoWorkspace` ou `comissaoComprovada` viessem do pedido,
    // o chamador simplesmente enviaria `true`.
    assert.ok(!/pedido\.responsavelDoWorkspace|pedido\.comissaoComprovada/.test(codigo))
    assert.match(codigo, /contexto\.responsavelDoWorkspace = !!responsavel/)
    assert.match(codigo, /contexto\.comissaoComprovada = !!comissao/)
  })

  test('o tipo da evidência de sistema vem da FONTE, não do pedido', () => {
    assert.match(codigo, /tipoEvidencia: fonteOk \? pedido\.fonte\.tipo : 'NAO_VERIFICADA'/)
    assert.ok(!/tipoEvidencia: pedido\.tipoEvidencia/.test(codigo))
  })

  test('a promoção revalida pela autoridade única', () => {
    assert.match(codigo, /avaliarVendaParaOperacaoReal\(entrada\.workspaceId, entrada\.saleId\)/)
  })

  test('as duas ações de auditoria são distintas', () => {
    assert.equal(ACAO_AUDIT_PROMOCAO, 'venda.promovida_para_operacao_real')
    assert.notEqual(ACAO_AUDIT_PROMOCAO, ACAO_AUDIT_EVIDENCIA)
  })

  test('estado anterior, novo, verificador e comissão vão para a auditoria', () => {
    assert.match(codigo, /estadoAnterior: origemAnterior/)
    assert.match(codigo, /estadoNovo: 'REAL_OPERATION'/)
    assert.match(codigo, /verificadorId: entrada\.verificadorId/)
    assert.match(codigo, /commissionId: entrada\.commissionId/)
  })

  test('não existe atalho para marcar como real sem evidência', () => {
    for (const atalho of ['forcar', 'force', 'ignorarEvidencia', 'marcarComoReal', 'skipValidacao']) {
      assert.ok(!codigo.toLowerCase().includes(atalho.toLowerCase()), `${atalho} não pode existir`)
    }
  })

  test('o WeakSet de fontes emitidas não é exportado', () => {
    const fonte = lerCodigo('lib/evidencia-verificada.ts')
    assert.match(fonte, /const EMITIDAS = new WeakSet/)
    assert.ok(!/export const EMITIDAS|export \{ EMITIDAS/.test(fonte), 'exportar o WeakSet anularia a proteção')
  })

  test('todo motivo de recusa pertence à lista declarada', () => {
    const casos = [
      validarManual({ referencia: '' }),
      validarManual({ motivo: 'x' }),
      validarManual({}, { responsavelDoWorkspace: false }),
      validarManual({}, { origemAtual: 'SEED' }),
      validarManual({}, { origemAtual: 'REAL_OPERATION' }),
      validarEvidenciaVerificada({ workspaceId: WS, saleId: SALE, fonte: {} as never }, contexto()),
    ]
    for (const r of casos) {
      assert.equal(r.ok, false)
      assert.ok((MOTIVOS_RECUSA_PROMOCAO as readonly string[]).includes((r as { motivo: string }).motivo))
      assert.ok((r as { explicacao: string }).explicacao.length > 0)
    }
  })
})

// ── Fila de automação ───────────────────────────────────────────────────

describe('Correção manual é exceção, não rotina', () => {
  test('a pendência de automação está declarada', () => {
    assert.equal(PENDENCIA_DE_AUTOMACAO.chave, 'operacao-real:comprovacao-recorrente')
    assert.equal(PENDENCIA_DE_AUTOMACAO.evidenciaManualAceitaHoje, 'CORRECAO_MANUAL_AUDITADA')
    assert.deepEqual([...PENDENCIA_DE_AUTOMACAO.substitutosAutomaticos], [
      'PROVIDER_OFICIAL',
      'CONCILIACAO_FINANCEIRA',
    ])
    assert.match(PENDENCIA_DE_AUTOMACAO.explicacao, /dívida de automação/i)
  })

  test('as quatro evidências do Bloco 3 continuam aceitas', () => {
    assert.deepEqual([...EVIDENCIAS_ACEITAS_PARA_OPERACAO_REAL], [
      'PROVIDER_OFICIAL',
      'CONCILIACAO_FINANCEIRA',
      'COMISSAO_CONFIRMADA_COM_ORIGEM_VERIFICAVEL',
      'CORRECAO_MANUAL_AUDITADA',
    ])
  })
})

// ── Nada de ML nesta rodada ─────────────────────────────────────────────

describe('Bloco 3.1 não liga o ML', () => {
  test('promoção e verificação não tocam o feature store', () => {
    for (const arq of ['lib/promocao-operacao-real.ts', 'lib/evidencia-verificada.ts']) {
      assert.ok(
        !/salvarFeatureSnapshot|mLFeatureSnapshot|registrarLabelNoSnapshot|extrairFeaturesDeConteudo|treinar|promoverModelo/.test(
          lerCodigo(arq)
        ),
        `${arq} não pode tocar o ML`
      )
    }
  })

  test('a autoridade do Bloco 3 continua sem escrever nada', () => {
    const codigo = lerCodigo('lib/real-operation.ts')
    for (const escrita of ['.create(', '.update(', '.upsert(', '.delete(']) {
      assert.ok(!codigo.includes(escrita))
    }
  })

  test('as rotas continuam criando USER_REPORTED', () => {
    for (const rota of ['app/api/vendas/route.ts', 'app/api/links/[id]/venda/route.ts']) {
      const codigo = lerCodigo(rota)
      assert.match(codigo, /dataOrigin: 'USER_REPORTED'/)
      assert.ok(!/dataOrigin:\s*'REAL_OPERATION'/.test(codigo))
    }
  })
})

// ── Vínculo com o ALVO: a fonte prova O QUE comprovou ───────────────────

describe('Fonte vinculada ao alvo — sem replay', () => {
  const WS_B = 'ws-beta'
  const SALE_B = 'sale-2'

  async function fonteProvider(alvo: { workspaceId: string; saleId: string }) {
    registrarVerificadorFake('PROVIDER_OFICIAL')
    return (await verificarEvidencia('PROVIDER_OFICIAL', alvo))!
  }

  test('a fonte carrega o alvo que foi verificado', async () => {
    const fonte = await fonteProvider({ workspaceId: WS, saleId: SALE })
    assert.equal(fonte.workspaceIdVerificado, WS)
    assert.equal(fonte.saleIdVerificado, SALE)
    assert.equal(fonte.commissionIdVerificado, null)
  })

  test('fonte da Sale A usada na Sale A → aceita', async () => {
    const fonte = await fonteProvider({ workspaceId: WS, saleId: SALE })
    assert.deepEqual(validarEvidenciaVerificada({ workspaceId: WS, saleId: SALE, fonte }, contexto()), {
      ok: true,
    })
  })

  test('fonte da Sale A usada na Sale B → recusa', async () => {
    const fonte = await fonteProvider({ workspaceId: WS, saleId: SALE })
    const r = validarEvidenciaVerificada({ workspaceId: WS, saleId: SALE_B, fonte }, contexto())
    assert.equal(r.ok, false)
    assert.equal((r as { motivo: string }).motivo, 'FONTE_NAO_CORRESPONDE_AO_ALVO')
  })

  test('fonte do workspace A usada no workspace B → recusa', async () => {
    const fonte = await fonteProvider({ workspaceId: WS, saleId: SALE })
    const r = validarEvidenciaVerificada({ workspaceId: WS_B, saleId: SALE, fonte }, contexto())
    assert.equal(r.ok, false)
    assert.equal((r as { motivo: string }).motivo, 'FONTE_NAO_CORRESPONDE_AO_ALVO')
  })

  test('workspace A / venda A nunca promove workspace B / venda B', async () => {
    const fonte = await fonteProvider({ workspaceId: WS, saleId: SALE })
    const r = validarEvidenciaVerificada({ workspaceId: WS_B, saleId: SALE_B, fonte }, contexto())
    assert.equal(r.ok, false)
    assert.equal((r as { motivo: string }).motivo, 'FONTE_NAO_CORRESPONDE_AO_ALVO')
  })

  test('FONTE_NAO_CORRESPONDE_AO_ALVO é motivo distinto de FONTE_NAO_VERIFICADA', () => {
    // São problemas diferentes: "não foi verificada" e "foi verificada, mas
    // para outra coisa". Confundi-los esconderia o reaproveitamento.
    assert.ok((MOTIVOS_RECUSA_PROMOCAO as readonly string[]).includes('FONTE_NAO_CORRESPONDE_AO_ALVO'))
    assert.notEqual('FONTE_NAO_CORRESPONDE_AO_ALVO', 'FONTE_NAO_VERIFICADA')
  })

  test('objeto forjado continua recusado como NÃO VERIFICADA, não como alvo errado', () => {
    const forjado = {
      tipo: 'PROVIDER_OFICIAL',
      referencia: 'webhook-123',
      verificadorId: 'x',
      verificadaEm: new Date(),
      workspaceIdVerificado: WS,
      saleIdVerificado: SALE,
      commissionIdVerificado: null,
      detalhes: {},
    } as unknown as FonteVerificada
    const r = validarEvidenciaVerificada({ workspaceId: WS, saleId: SALE, fonte: forjado }, contexto())
    assert.equal(r.ok, false)
    assert.equal((r as { motivo: string }).motivo, 'FONTE_NAO_VERIFICADA')
  })
})

describe('Fonte de comissão vinculada à comissão específica', () => {
  async function fonteComissao(commissionId: string) {
    registrarVerificadorFake('COMISSAO_CONFIRMADA_COM_ORIGEM_VERIFICAVEL')
    return (await verificarEvidencia('COMISSAO_CONFIRMADA_COM_ORIGEM_VERIFICAVEL', {
      workspaceId: WS,
      saleId: SALE,
      commissionId,
    }))!
  }

  test('a fonte carrega a comissão verificada', async () => {
    const fonte = await fonteComissao('com-X')
    assert.equal(fonte.commissionIdVerificado, 'com-X')
  })

  test('fonte correta da comissão X → aceita', async () => {
    const fonte = await fonteComissao('com-X')
    const r = validarEvidenciaVerificada(
      { workspaceId: WS, saleId: SALE, fonte, commissionId: 'com-X' },
      contexto({ comissaoComprovada: true })
    )
    assert.deepEqual(r, { ok: true })
  })

  test('fonte da comissão X usada com a comissão Y → recusa, mesmo na mesma Sale', async () => {
    const fonte = await fonteComissao('com-X')
    const r = validarEvidenciaVerificada(
      { workspaceId: WS, saleId: SALE, fonte, commissionId: 'com-Y' },
      contexto({ comissaoComprovada: true })
    )
    assert.equal(r.ok, false)
    assert.equal((r as { motivo: string }).motivo, 'FONTE_NAO_CORRESPONDE_AO_ALVO')
  })

  test('verificarEvidencia NÃO emite fonte de comissão sem commissionId', async () => {
    // Emitir sem isso produziria um vínculo vazio — a fonte não poderia
    // dizer QUAL comissão conferiu.
    registrarVerificadorFake('COMISSAO_CONFIRMADA_COM_ORIGEM_VERIFICAVEL')
    for (const id of [undefined, null, '', '   ']) {
      const fonte = await verificarEvidencia('COMISSAO_CONFIRMADA_COM_ORIGEM_VERIFICAVEL', {
        workspaceId: WS,
        saleId: SALE,
        commissionId: id,
      })
      assert.equal(fonte, null, `commissionId ${JSON.stringify(id)} não podia emitir fonte`)
    }
  })

  test('verificarEvidencia NÃO emite fonte sem workspace ou sem venda', async () => {
    registrarVerificadorFake('PROVIDER_OFICIAL')
    assert.equal(await verificarEvidencia('PROVIDER_OFICIAL', { workspaceId: '', saleId: SALE }), null)
    assert.equal(await verificarEvidencia('PROVIDER_OFICIAL', { workspaceId: WS, saleId: '  ' }), null)
  })
})
