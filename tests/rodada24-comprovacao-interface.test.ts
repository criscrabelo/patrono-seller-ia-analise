/**
 * Interface de comprovação manual auditada.
 *
 * A rota é fina de propósito: a única decisão dela — traduzir o resultado
 * para HTTP — mora numa função pura e é testada aqui. O resto (quem pode
 * ser promovido, o que é motivo suficiente, idempotência) é a MESMA regra
 * do Bloco 3.1, exercida contra Postgres logo abaixo.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '../lib/prisma'
import { registrarResultado } from '../lib/vendas-comissoes'
import { promoverPorCorrecaoManual } from '../lib/promocao-operacao-real'
import { respostaHttpDaComprovacao } from '../lib/comprovacao-manual-http'
import { obterDossieDaOperacao } from '../lib/dossie-operacao'
import { ORIGENS_PROMOVIVEIS, podeComprovarManualmente } from '../lib/proveniencia'
import { ORIGENS_PROMOVIVEIS as REEXPORTADA } from '../lib/promocao-operacao-real'

const TEM_BANCO = !!process.env.DATABASE_URL
const RAIZ = join(__dirname, '..')
const lerFonte = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')
const lerCodigo = (rel: string) =>
  lerFonte(rel)
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n')

const ROTA_COMPROVAR = 'app/api/vendas/[id]/comprovar/route.ts'
const ROTA_DOSSIE = 'app/api/vendas/[id]/dossie/route.ts'
const TELA = 'components/comprovar-operacao-real.tsx'

const resultado = (over: Record<string, unknown> = {}) =>
  ({ promovido: false, idempotente: false, motivo: null, ...over }) as never

// ── Tradução para HTTP (pura) ───────────────────────────────────────────

describe('Resposta HTTP — a única decisão da rota', () => {
  test('promoção bem-sucedida → 200', () => {
    assert.deepEqual(respostaHttpDaComprovacao(resultado({ promovido: true })), {
      status: 200,
      ok: true,
      motivo: null,
    })
  })

  test('reenvio idempotente → 200, não é erro', () => {
    const r = respostaHttpDaComprovacao(resultado({ idempotente: true }))
    assert.equal(r.status, 200)
    assert.equal(r.ok, true)
  })

  test('venda de outro workspace → 404, sem revelar existência', () => {
    // 403 confirmaria que a venda existe em algum lugar.
    const r = respostaHttpDaComprovacao(resultado({ motivo: 'VENDA_NAO_ENCONTRADA' }))
    assert.equal(r.status, 404)
    assert.equal(r.ok, false)
  })

  for (const motivo of [
    'MOTIVO_AUSENTE',
    'MOTIVO_INSUFICIENTE',
    'REFERENCIA_AUSENTE',
    'RESPONSAVEL_INVALIDO',
    'ORIGEM_SINTETICA_NAO_PROMOVIVEL',
    'JA_ERA_OPERACAO_REAL',
  ]) {
    test(`recusa por ${motivo} → 422 com o motivo nomeado`, () => {
      const r = respostaHttpDaComprovacao(resultado({ motivo }))
      assert.equal(r.status, 422)
      assert.equal(r.ok, false)
      assert.equal(r.motivo, motivo)
    })
  }

  test('a tradução não decide a regra, só o código', () => {
    // Se esta função soubesse o que é "motivo suficiente", existiriam duas
    // versões da regra — e duas versões é o mesmo que nenhuma.
    const codigo = lerCodigo('lib/comprovacao-manual-http.ts')
    for (const regra of ['TAMANHO_MINIMO', 'motivo.length', 'trim()', 'ORIGENS_PROMOVIVEIS']) {
      assert.ok(!codigo.includes(regra), `${regra} não pode estar aqui`)
    }
  })
})

// ── Segurança das rotas (leitura do código) ─────────────────────────────

describe('Segurança — sessão manda, payload não', () => {
  const comprovar = lerCodigo(ROTA_COMPROVAR)
  const dossie = lerCodigo(ROTA_DOSSIE)

  const lerFonteDaSessao = () => readFileSync(join(process.cwd(), 'lib/sessao.ts'), 'utf8')
  test('as duas rotas exigem sessão ANTES de qualquer outra coisa', () => {
    for (const [nome, codigo] of [['comprovar', comprovar], ['dossiê', dossie]] as const) {
      // P2.15.4: o 401 (e o 403 de módulo) mora na porta única lib/sessao.ts.
      const pos401 = codigo.indexOf('if (session instanceof NextResponse) return session')
      assert.ok(pos401 > 0, `${nome} precisa devolver 401 sem sessão`)
      assert.match(codigo, /const session = await exigirSessao\(\)/)
      assert.match(lerFonteDaSessao(), /if \(!session\) return NextResponse\.json\(\{ error: 'Não autorizado' \}, \{ status: 401 \}\)/)
      // Nada é lido do corpo nem dos params antes da checagem.
      const posBody = codigo.indexOf('req.json()')
      if (posBody > 0) assert.ok(pos401 < posBody, `${nome} lê o corpo antes de exigir sessão`)
    }
  })

  test('workspaceId vem SEMPRE da sessão', () => {
    assert.match(comprovar, /workspaceId: session\.user\.workspaceId/)
    assert.match(dossie, /obterDossieDaOperacao\(session\.user\.workspaceId, id\)/)
  })

  test('responsavelUserId vem SEMPRE da sessão', () => {
    assert.match(comprovar, /responsavelUserId: session\.user\.id/)
  })

  test('o schema aceita SÓ motivo e referência', () => {
    // Zod descarta chaves desconhecidas: `workspaceId` ou
    // `responsavelUserId` enviados pelo cliente nem chegam ao código.
    const schema = comprovar.slice(comprovar.indexOf('const schema ='), comprovar.indexOf('export async function POST'))
    assert.match(schema, /motivo: z\.string\(\)/)
    assert.match(schema, /referencia: z\.string\(\)/)
    assert.ok(!/workspaceId|responsavelUserId|saleId|dataOrigin/.test(schema))
  })

  test('a rota NUNCA lê workspaceId ou responsavelUserId do corpo', () => {
    assert.ok(!/body\.workspaceId|parsed\.data\.workspaceId/.test(comprovar))
    assert.ok(!/body\.responsavelUserId|parsed\.data\.responsavelUserId/.test(comprovar))
  })

  test('a rota chama SOMENTE promoverPorCorrecaoManual — não replica a regra', () => {
    assert.match(comprovar, /promoverPorCorrecaoManual\(\{/)
    for (const proibido of [
      'promoverPorEvidenciaVerificada',
      'dataOrigin:',
      'TAMANHO_MINIMO_DO_MOTIVO',
      'prisma.sale.update',
      'auditLog.create',
    ]) {
      assert.ok(!comprovar.includes(proibido), `${proibido} não pode estar na rota`)
    }
  })

  test('o dossiê é somente leitura — a rota não escreve nada', () => {
    for (const escrita of ['.create(', '.update(', '.delete(', 'promover']) {
      assert.ok(!dossie.includes(escrita))
    }
  })

  test('nenhuma credencial aparece nas rotas nem na tela', () => {
    for (const arq of [ROTA_COMPROVAR, ROTA_DOSSIE, TELA]) {
      const codigo = lerCodigo(arq)
      for (const proibido of ['accessToken', 'password', 'apiKey', 'CRON_SECRET', 'SECRET', 'token']) {
        assert.ok(!codigo.includes(proibido), `${arq} não pode citar ${proibido}`)
      }
    }
  })
})

// ── Tela ────────────────────────────────────────────────────────────────

describe('Tela — ação excepcional, não fluxo normal', () => {
  const tela = lerFonte(TELA)
  const pagina = lerFonte('app/(dashboard)/vendas-comissoes/page.tsx')

  test('não existe botão de um clique "marcar como real"', () => {
    // Lê só o CÓDIGO: o cabeçalho do componente explica justamente por que
    // esse botão não existe, e o comentário não pode derrubar o teste.
    assert.ok(!/marcar como real/i.test(lerCodigo(TELA)))
    assert.ok(!/marcar como real/i.test(lerCodigo('app/(dashboard)/vendas-comissoes/page.tsx')))
  })

  test('exige motivo E referência antes de enviar', () => {
    assert.match(tela, /Motivo da comprovação/)
    assert.match(tela, /Referência da evidência/)
    assert.match(tela, /JSON\.stringify\(\{ motivo, referencia \}\)/)
  })

  test('avisa que a ação é auditada e excepcional', () => {
    assert.match(tela, /Esta ação é auditada/)
    assert.match(tela, /realmente ocorreu|realmente aconteceu/)
    assert.match(tela, /excepcional/)
  })

  test('mostra status, origem e os TRÊS estágios da comissão', () => {
    for (const rotulo of [
      'Status da venda',
      'Origem do registro',
      'Comissão esperada',
      'Comissão confirmada',
      'Comissão recebida',
    ]) {
      assert.ok(tela.includes(rotulo), `falta o campo "${rotulo}"`)
    }
  })

  test('mostra elegibilidade e lacunas do dossiê', () => {
    assert.match(tela, /Elegibilidade para aprendizado/)
    assert.match(tela, /Lacunas encontradas/)
  })

  test('recarrega o estado sozinha depois de comprovar', () => {
    // Nada de "atualize a página".
    assert.match(tela, /if \(data\.dossie\) setDossie\(data\.dossie\)/)
    assert.match(tela, /aoComprovar\?\.\(\)/)
    assert.match(pagina, /aoComprovar=\{fetchAll\}/)
  })

  test('a tela NÃO envia workspace nem responsável', () => {
    assert.ok(!/workspaceId/.test(tela))
    assert.ok(!/responsavelUserId/.test(tela))
  })

  test('a tela não replica a regra de promoção', () => {
    for (const proibido of ['TAMANHO_MINIMO', 'REAL_OPERATION =', 'USER_REPORTED =', 'motivo.length <']) {
      assert.ok(!tela.includes(proibido), `${proibido} não pode estar na tela`)
    }
  })

  test('a ação NÃO aparece quando a venda já é REAL_OPERATION', () => {
    assert.match(pagina, /v\.dataOrigin === 'REAL_OPERATION' \? \(/)
    assert.match(pagina, /Comprovada/)
  })

  test('a ação só aparece para origem promovível — sem lista copiada na tela', () => {
    assert.match(pagina, /podeComprovarManualmente\(v\.dataOrigin\)/)
    // A tela NÃO pode ter a própria cópia das origens.
    assert.ok(!/'USER_REPORTED'|'UNVERIFIED'/.test(lerCodigo('app/(dashboard)/vendas-comissoes/page.tsx')))
  })

  test('origem sintética ou desconhecida não oferece nada', () => {
    for (const origem of ['SEED', 'TEST_FIXTURE', 'DEMO', 'SYNTHETIC_TEST', 'REAL_OPERATION']) {
      assert.equal(podeComprovarManualmente(origem), false, `${origem} não pode oferecer a ação`)
    }
  })

  test('na dúvida, esconde', () => {
    // Valor ausente, nulo ou ilegível NÃO oferece a ação. É o oposto de
    // `normalizarOrigemDeRegistro`, de propósito: o pior caso é esconder uma
    // ação possível, nunca oferecer uma impossível.
    for (const v of [undefined, null, '', '  ', 42, {}, 'user_reported', 'PRODUCAO']) {
      assert.equal(podeComprovarManualmente(v), false, `${JSON.stringify(v)} não podia oferecer a ação`)
    }
  })

  test('as duas origens promovíveis oferecem a ação', () => {
    assert.equal(podeComprovarManualmente('USER_REPORTED'), true)
    assert.equal(podeComprovarManualmente('UNVERIFIED'), true)
    assert.deepEqual([...ORIGENS_PROMOVIVEIS], ['USER_REPORTED', 'UNVERIFIED'])
  })

  test('a lista é a MESMA que o core usa — uma fonte só', () => {
    // O módulo de promoção reexporta a constante; se alguém criar uma
    // segunda lista, este teste falha.
    assert.deepEqual([...REEXPORTADA], [...ORIGENS_PROMOVIVEIS])
  })

  test('esconder é UX, não segurança: o servidor continua decidindo', () => {
    // A rota não consulta nada da tela e recusa do mesmo jeito.
    assert.match(lerCodigo(ROTA_COMPROVAR), /promoverPorCorrecaoManual\(\{/)
    assert.ok(!/podeComprovarManualmente/.test(lerCodigo(ROTA_COMPROVAR)))
  })

  test('a ação aparece na listagem de vendas, fechada por padrão', () => {
    assert.match(pagina, /Comprovar operação real/)
    assert.match(pagina, /useState<string \| null>\(null\)/)
    assert.match(pagina, /ComprovarOperacaoReal/)
  })
})

// ── Banco: a regra por trás da rota ─────────────────────────────────────

let workspaceA = ''
let workspaceB = ''
let userA = ''
let userB = ''
let produtoA = ''
const criados: string[] = []

describe(
  'Comprovação pela interface — comportamento real',
  { skip: !TEM_BANCO ? 'DATABASE_URL ausente — exige Postgres' : false },
  () => {
    before(async () => {
      const marca = Date.now()
      for (const nome of ['A', 'B']) {
        const ws = await prisma.workspace.create({
          data: { name: `UI-${nome}`, ownerId: `teste-ui-${nome}-${marca}` },
          select: { id: true },
        })
        criados.push(ws.id)
      }
      ;[workspaceA, workspaceB] = criados
      const criarUser = async (ws: string, s: string) =>
        (
          await prisma.user.create({
            data: { email: `ui-${s}-${marca}@teste.local`, name: `U${s}`, password: 'x', workspaceId: ws },
            select: { id: true },
          })
        ).id
      userA = await criarUser(workspaceA, 'a')
      userB = await criarUser(workspaceB, 'b')
      produtoA = (
        await prisma.produto.create({
          data: {
            workspaceId: workspaceA,
            userId: userA,
            nome: 'Produto UI',
            categoria: 'casa',
            tipoVenda: 'Afiliado',
            origemConteudo: 'Proprio',
          },
          select: { id: true },
        })
      ).id
    })

    after(async () => {
      for (const ws of criados) {
        await prisma.commission.deleteMany({ where: { workspaceId: ws } })
        await prisma.sale.deleteMany({ where: { workspaceId: ws } })
        await prisma.auditLog.deleteMany({ where: { workspaceId: ws } })
      }
      await prisma.produto.deleteMany({ where: { workspaceId: { in: criados } } })
      await prisma.user.deleteMany({ where: { workspaceId: { in: criados } } })
      await prisma.workspace.deleteMany({ where: { id: { in: criados } } })
      await prisma.$disconnect()
    })

    async function criarVenda(over: { origem?: string; statusComissao?: string } = {}) {
      const { sale, commission } = await registrarResultado({
        workspaceId: workspaceA,
        actorUserId: userA,
        dataOrigin: 'USER_REPORTED',
        productId: produtoA,
        amount: 100,
        status: 'CONFIRMED',
        expectedCommission: 10,
        idempotencyKey: `ui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      })
      if (over.origem) await prisma.sale.update({ where: { id: sale.id }, data: { dataOrigin: over.origem } })
      await prisma.commission.update({
        where: { id: commission!.id },
        data: { status: over.statusComissao ?? 'RECEIVED', confirmedAmount: 9, receivedAmount: 8 },
      })
      return sale.id
    }

    /** Reproduz exatamente o que a rota faz: sessão manda, payload não. */
    const comoARota = (saleId: string, motivo: string, referencia: string, ws = workspaceA, uid = userA) =>
      promoverPorCorrecaoManual({ workspaceId: ws, saleId, responsavelUserId: uid, motivo, referencia })

    test('comprovação completa pela interface → 200 e venda vira operação real', async () => {
      const saleId = await criarVenda()
      const r = await comoARota(saleId, 'Comissão recebida e conferida no extrato bancário.', 'extrato-2026-09-18')
      assert.equal(respostaHttpDaComprovacao(r).status, 200)
      assert.equal(r.promovido, true, r.explicacao)
      assert.equal(r.veredito?.elegivel, true)

      const d = await obterDossieDaOperacao(workspaceA, saleId)
      assert.equal(d?.proveniencia.ehOperacaoReal, true)
      assert.equal(d?.evidencias[0].responsavelUserId, userA)
    })

    test('motivo vazio → recusa 422', async () => {
      const saleId = await criarVenda()
      const r = await comoARota(saleId, '', 'extrato-1')
      assert.equal(respostaHttpDaComprovacao(r).status, 422)
      assert.equal(r.motivo, 'MOTIVO_AUSENTE')
    })

    test('motivo curto → recusa 422', async () => {
      const saleId = await criarVenda()
      const r = await comoARota(saleId, 'ok', 'extrato-1')
      assert.equal(respostaHttpDaComprovacao(r).status, 422)
      assert.equal(r.motivo, 'MOTIVO_INSUFICIENTE')
    })

    test('referência vazia → recusa 422', async () => {
      const saleId = await criarVenda()
      const r = await comoARota(saleId, 'Conferido no extrato bancário da empresa.', '   ')
      assert.equal(respostaHttpDaComprovacao(r).status, 422)
      assert.equal(r.motivo, 'REFERENCIA_AUSENTE')
    })

    test('venda sintética → recusa, mesmo com tudo preenchido', async () => {
      const saleId = await criarVenda({ origem: 'TEST_FIXTURE' })
      const r = await comoARota(saleId, 'Conferido no extrato bancário da empresa.', 'extrato-1')
      assert.equal(respostaHttpDaComprovacao(r).status, 422)
      assert.equal(r.motivo, 'ORIGEM_SINTETICA_NAO_PROMOVIVEL')
    })

    test('venda de outro workspace → 404, e nada é tocado', async () => {
      const saleId = await criarVenda()
      // Sessão do workspace B pedindo uma venda do A.
      const r = await comoARota(saleId, 'Conferido no extrato bancário.', 'extrato-1', workspaceB, userB)
      assert.equal(respostaHttpDaComprovacao(r).status, 404)
      const venda = await prisma.sale.findUnique({ where: { id: saleId }, select: { dataOrigin: true } })
      assert.equal(venda?.dataOrigin, 'USER_REPORTED')
      assert.equal(await prisma.auditLog.count({ where: { workspaceId: workspaceB } }), 0)
    })

    test('responsável de outro workspace → recusa (o servidor usa a sessão, mas a regra protege)', async () => {
      const saleId = await criarVenda()
      const r = await comoARota(saleId, 'Conferido no extrato bancário.', 'extrato-1', workspaceA, userB)
      assert.equal(respostaHttpDaComprovacao(r).status, 422)
      assert.equal(r.motivo, 'RESPONSAVEL_INVALIDO')
    })

    test('comprovação repetida → idempotente, 200, sem duplicar auditoria', async () => {
      const saleId = await criarVenda()
      const motivo = 'Comissão recebida e conferida no extrato bancário.'
      const ref = `extrato-rep-${Date.now()}`

      const primeira = await comoARota(saleId, motivo, ref)
      const segunda = await comoARota(saleId, motivo, ref)

      assert.equal(respostaHttpDaComprovacao(primeira).status, 200)
      assert.equal(respostaHttpDaComprovacao(segunda).status, 200)
      assert.equal(primeira.promovido, true)
      assert.equal(segunda.idempotente, true)

      const evidencias = await prisma.auditLog.count({
        where: { workspaceId: workspaceA, entityId: saleId, action: 'venda.evidencia_de_operacao_real' },
      })
      assert.equal(evidencias, 1)
    })

    test('o dossiê devolvido depois da comprovação já reflete o novo estado', async () => {
      const saleId = await criarVenda()
      await comoARota(saleId, 'Comissão recebida e conferida no extrato.', `extrato-d-${Date.now()}`)
      // É exatamente o que a rota devolve no corpo da resposta.
      const d = await obterDossieDaOperacao(workspaceA, saleId)
      assert.equal(d?.venda.dataOrigin, 'REAL_OPERATION')
      assert.equal(d?.veredito?.elegivel, true)
      assert.equal(d?.promocoes[0].estadoAnterior, 'USER_REPORTED')
      assert.equal(d?.promocoes[0].estadoNovo, 'REAL_OPERATION')
    })

    test('o dossiê nunca devolve credencial', async () => {
      const saleId = await criarVenda()
      const d = await obterDossieDaOperacao(workspaceA, saleId)
      const texto = JSON.stringify(d).toLowerCase()
      for (const proibido of ['password', 'accesstoken', 'apikey', 'secret', 'postgres://', 'postgresql://']) {
        assert.ok(!texto.includes(proibido), `o dossiê não pode conter ${proibido}`)
      }
    })

    test('nenhum modelo foi treinado, ativado ou promovido', async () => {
      assert.equal(await prisma.mLModel.count({ where: { workspaceId: { in: criados } } }), 0)
      assert.equal(await prisma.mLTrainingRun.count({ where: { workspaceId: { in: criados } } }), 0)
    })
  }
)
