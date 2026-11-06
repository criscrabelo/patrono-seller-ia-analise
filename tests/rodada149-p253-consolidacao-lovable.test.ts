/**
 * P2.53 — Consolidação das ferramentas da proposta do Lovable no Patrono principal (sem plataforma paralela).
 * Puro: painel de afiliados (5 situações, origem real, TikTok Shop primeiro), limite de gastos (R$ 0 sem
 * autorização registrada), calendário editorial (três controles + aprovação), Lucro Real por operação,
 * calculadora/comparador/escala (simulação). Banco de TESTE: painel e calendário lidos do workspace.
 */
process.env.PATRONO_TESTE_LEGADO_SEM_TRES_CONTROLES = ''
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { montarPainelDeAfiliados, plataformaCanonica, CATEGORIA_DO_ESTADO } from '../lib/painel-afiliados'
import { lerPoliticaDeCusto, lerAutorizacaoDeOrcamento, avaliarCusto } from '../lib/cost-safety-gate'
import { situacaoDaPolitica, REGRA_CREDITOS } from '../lib/controle-de-gastos'
import { pecaEditorial } from '../lib/calendario-editorial'
import { calcularResultadoAposCustos, somarFinanceiro } from '../lib/financeiro'
import { calcularRentabilidade, compararFornecedores, simularEscala, faixaDaMargem, EntradaInvalida } from '../lib/rentabilidade'
import { regraDaRota } from '../lib/modulos-rotas'

describe('Painel de afiliados', () => {
  test('cinco situações a partir da fonte única; estimada nunca é confirmado; estornada separada', () => {
    assert.deepEqual(CATEGORIA_DO_ESTADO, { ESTIMADA: 'ESTIMADA', NAO_LIQUIDADA: 'ESTIMADA', LIQUIDADA: 'APROVADA', RECEBIDA: 'RECEBIDA', CANCELADA: 'CANCELADA', REVERTIDA: 'ESTORNADA' })
    const p = montarPainelDeAfiliados([
      { id: '1', plataforma: 'tiktokshop', estado: 'ESTIMADA', valor: 10, origem: 'USER_REPORTED' },
      { id: '2', plataforma: 'tiktok-shop', estado: 'NAO_LIQUIDADA', valor: 5.5, origem: 'REAL_OPERATION' },
      { id: '3', plataforma: 'tiktok-shop', estado: 'LIQUIDADA', valor: 2.56, origem: 'REAL_OPERATION' },
      { id: '4', plataforma: 'shopee', estado: 'RECEBIDA', valor: 7, origem: 'USER_REPORTED' },
      { id: '5', plataforma: 'shopee', estado: 'CANCELADA', valor: 3, origem: 'USER_REPORTED' },
      { id: '6', plataforma: 'tiktok-shop', estado: 'REVERTIDA', valor: 4, origem: 'REAL_OPERATION' },
      { id: '6', plataforma: 'tiktok-shop', estado: 'REVERTIDA', valor: 4, origem: 'REAL_OPERATION' },
      { id: '7', plataforma: 'shopee', estado: 'RECEBIDA', valor: 1000, origem: 'DEMO' },
      { id: '8', plataforma: 'shopee', estado: 'RECEBIDA', valor: 1000, origem: 'TEST_FIXTURE' },
      { id: '9', plataforma: 'shopee', estado: 'RECEBIDA', valor: 1000, origem: null },
    ])
    assert.deepEqual(p.total.valores, { ESTIMADA: 15.5, APROVADA: 2.56, RECEBIDA: 7, CANCELADA: 3, ESTORNADA: 4 })
    assert.equal(p.total.confirmado, 9.56)
    assert.equal(p.total.aguardandoLiquidacao, 5.5)
    assert.equal(p.excluidos.quantidade, 3, 'demo, teste e sem origem ficam fora')
    assert.equal(p.porPlataforma[0].plataforma, 'tiktok-shop', 'TikTok Shop primeiro')
    assert.equal(p.porPlataforma[0].quantidades.ESTORNADA, 1, 'id repetido conta uma vez')
    assert.equal(plataformaCanonica('TikTokShop'), 'tiktok-shop')
  })
})

describe('Limite de gastos (orçamento adicional autorizado = R$ 0 sem assinatura)', () => {
  const agora = new Date('2026-10-25T12:00:00-03:00')
  test('valor no ambiente sem autorização registrada vale R$ 0 e o bloqueio diz por quê', () => {
    const pol = lerPoliticaDeCusto({ PAID_AI_ENABLED: 'true', AI_MONTHLY_BUDGET: '500' }, agora)
    assert.equal(pol.orcamentoMensal, 0)
    assert.equal(pol.orcamentoInformadoSemAutorizacao, 500)
    const d = avaliarCusto({ provider: 'anthropic', operacao: 'gerar-roteiro', workspaceId: 'w', custoEstimado: 0.5, gastoAcumulado: 0, politica: pol })
    assert.equal(d.permitido, false)
    assert.equal(d.motivo, 'ORCAMENTO_ZERO')
    assert.match(d.explicacao, /sem autorização registrada|Sem autorização/i)
  })
  test('autorização vencida, ilegível ou incompleta não vale; válida libera até o teto', () => {
    assert.equal(lerAutorizacaoDeOrcamento({ AI_BUDGET_AUTORIZADO_POR: 'titular' }, agora).valida, false)
    assert.equal(lerAutorizacaoDeOrcamento({ AI_BUDGET_AUTORIZADO_POR: 'titular', AI_BUDGET_AUTORIZADO_ATE: '31/12/2026' }, agora).valida, false)
    const vencida = lerAutorizacaoDeOrcamento({ AI_BUDGET_AUTORIZADO_POR: 'titular', AI_BUDGET_AUTORIZADO_ATE: '2026-10-24' }, agora)
    assert.equal(vencida.valida, false)
    assert.match(vencida.motivo ?? '', /venceu em 2026-10-24/)
    assert.equal(lerAutorizacaoDeOrcamento({ AI_BUDGET_AUTORIZADO_POR: 'titular', AI_BUDGET_AUTORIZADO_ATE: '2026-10-25' }, agora).valida, true, 'vale até o fim do dia')
    const pol = lerPoliticaDeCusto({ PAID_AI_ENABLED: 'true', AI_MONTHLY_BUDGET: '20', AI_BUDGET_AUTORIZADO_POR: 'titular', AI_BUDGET_AUTORIZADO_ATE: '2026-11-30' }, agora)
    assert.equal(pol.orcamentoMensal, 20)
    assert.equal(avaliarCusto({ provider: 'anthropic', operacao: 'gerar-roteiro', workspaceId: 'w', custoEstimado: 0.5, gastoAcumulado: 0, politica: pol }).permitido, true)
  })
  test('situação mostrada: padrão R$ 0, provedores pagos bloqueados, crédito não é gratuidade, recursos sem custo listados', () => {
    const s = situacaoDaPolitica(lerPoliticaDeCusto({}, agora))
    assert.equal(s.orcamentoAdicionalAutorizadoBRL, 0)
    assert.ok(s.provedoresPagos.some((p) => p.provedor === 'anthropic' && !p.liberado))
    assert.ok(s.provedoresPagos.every((p) => !p.liberado))
    assert.equal(s.regra, REGRA_CREDITOS)
    assert.ok(s.semCustoAdicional.length >= 4)
  })
})

describe('Calendário editorial (Central de Operação)', () => {
  const base = { id: 'a', canal: 'tiktok', nomeProduto: 'Papel A4', versao: 2, horarioPlanejado: new Date('2026-10-30T15:00:00Z'), publicadoEm: null, apresentacao: { video: { sha256: 'a'.repeat(64) } } }
  const qgOk = { veredito: 'APROVADO', arquivo: { sha256: 'a'.repeat(64) }, comercial: { veredito: 'APRESENTAR_A_TITULAR' }, conformidade: { veredito: 'APTO' }, campanha: { liberacaoComercial: 'LIBERADA' }, barreira: { decisao: 'APTO_PARA_TITULAR', sha256: 'a'.repeat(64), resumo: 'ok' } }
  test('aguardando aprovação sem os controles = RETIDO com motivos; com os controles = aguardando a titular', () => {
    const retida = pecaEditorial({ ...base, estado: 'AGUARDANDO_APROVACAO', qualityGate: { veredito: 'APROVADO' } })
    assert.equal(retida.situacao, 'RETIDO')
    assert.ok(retida.motivos.length > 0)
    const pronta = pecaEditorial({ ...base, estado: 'AGUARDANDO_APROVACAO', qualityGate: qgOk })
    assert.equal(pronta.situacao, 'AGUARDANDO_TITULAR', JSON.stringify(pronta.motivos))
    assert.equal(pronta.origemDaData, 'PLANEJADO')
    assert.equal(pronta.link, '/operacao')
  })
  test('aprovado pela titular continua retido se perder os controles; sem data vai para "sem data"; publicado usa a data real', () => {
    assert.equal(pecaEditorial({ ...base, estado: 'APROVADO', qualityGate: { veredito: 'APROVADO' } }).situacao, 'RETIDO')
    const semData = pecaEditorial({ ...base, horarioPlanejado: null, estado: 'GERANDO_VIDEO', qualityGate: {} })
    assert.equal(semData.quando, null)
    assert.equal(semData.situacao, 'EM_PRODUCAO')
    const pub = pecaEditorial({ ...base, estado: 'PUBLICADO', publicadoEm: new Date('2026-10-20T12:00:00Z'), qualityGate: qgOk })
    assert.equal(pub.origemDaData, 'PUBLICADO')
    assert.equal(pub.quando, '2026-10-20T12:00:00.000Z')
  })
  test('o calendário só mostra: a página não chama aprovar/publicar', () => {
    const pagina = readFileSync('app/(dashboard)/calendario/page.tsx', 'utf8')
    assert.match(pagina, /\/api\/calendario\/editorial/)
    assert.doesNotMatch(pagina, /method:\s*'(POST|PATCH|PUT|DELETE)'|\/aprovar|\/publicar/)
  })
})

describe('Lucro Real por tipo de operação', () => {
  test('afiliados separados; previsão fora do resultado; vendas próprias = SEM_OPERACAO (nunca zero)', () => {
    const soma = somarFinanceiro([{ estado: 'LIQUIDADA', valor: 10 }, { estado: 'ESTIMADA', valor: 50 }, { estado: 'REVERTIDA', valor: 2 }])
    const r = calcularResultadoAposCustos(soma, { reaisBRL: 0, reservadosBRL: 0 })
    assert.equal(r.resultado, 10)
    assert.deepEqual(r.porOperacao.afiliados, { receitaConfirmada: 10, previsao: 50, estornos: 2 })
    assert.equal(r.porOperacao.vendasProprias.situacao, 'SEM_OPERACAO')
  })
})

describe('Calculadora de rentabilidade, comparador e escala (simulação)', () => {
  const cenario = { custoProduto: 10, cotacao: 5, freteInternacional: 2, freteNacional: 8, tributoSobreVenda: 0.06, taxaPlataforma: 0.14, taxaPagamento: 0.02, marketing: { tipo: 'PERCENTUAL' as const, valor: 0.1 }, perdas: 0.03, logisticaBRL: 2, preco: 150 }
  test('custos, lucro, margem, faixa e preço de equilíbrio', () => {
    const r = calcularRentabilidade(cenario)
    assert.equal(r.simulacao, true)
    assert.equal(r.custoFixoUnitario, 70) // 50 + 10 + 8 + 2
    assert.equal(r.percentualSobrePreco, 0.35)
    assert.equal(r.custoTotal, 122.5)
    assert.equal(r.lucroUnitario, 27.5)
    assert.equal(r.margem, 0.1833)
    assert.equal(r.faixa, 'AMARELO')
    assert.equal(r.precoDeEquilibrio, 107.69)
    assert.deepEqual(r.faixaDoPreco, { minimo: 70, maximo: 210 })
    assert.equal(calcularRentabilidade({ ...cenario, preco: 100 }).prejuizo, true)
  })
  test('faixas 15% e 30%; frete pago pelo comprador; importação com ICMS por dentro; CPA', () => {
    assert.equal(faixaDaMargem(0.1499), 'VERMELHO')
    assert.equal(faixaDaMargem(0.15), 'AMARELO')
    assert.equal(faixaDaMargem(0.3), 'AMARELO')
    assert.equal(faixaDaMargem(0.3001), 'VERDE')
    assert.equal(calcularRentabilidade({ ...cenario, fretePagoPeloComprador: true }).custoFixoUnitario, 62)
    const imp = calcularRentabilidade({ ...cenario, importacao: { impostoDeImportacao: 0.6, icms: 0.17, despachoBRL: 10 } })
    // base 60; II 36; ICMS = (60+36+10)*0.17/0.83 = 21,71; importação = 67,71
    assert.equal(imp.detalhes.find((d) => d.bloco === 'Importação')?.valor, 67.71)
    const cpa = calcularRentabilidade({ ...cenario, marketing: { tipo: 'CPA', valorBRL: 12 } })
    assert.equal(cpa.custoFixoUnitario, 82)
    assert.equal(cpa.percentualSobrePreco, 0.25)
  })
  test('entrada inválida é erro explícito (nunca zero silencioso)', () => {
    assert.throws(() => calcularRentabilidade({ ...cenario, tributoSobreVenda: undefined as never }), EntradaInvalida)
    assert.throws(() => calcularRentabilidade({ ...cenario, taxaPlataforma: 14 }), /fração/)
    assert.throws(() => calcularRentabilidade({ ...cenario, preco: 0 }), EntradaInvalida)
    assert.throws(() => calcularRentabilidade({ ...cenario, cotacao: 0 }), EntradaInvalida)
  })
  test('comparador escolhe o menor custo total; escala mostra quando se paga', () => {
    const { custoProduto: _c, freteInternacional: _f, cotacao: _q, ...base } = cenario
    const c = compararFornecedores(base, [{ nome: 'A', custoProduto: 10, freteInternacional: 2, cotacao: 5 }, { nome: 'B', custoProduto: 9, freteInternacional: 4, cotacao: 5 }, { nome: 'C', custoProduto: 40 }])
    assert.equal(c.melhor, 'C')
    const e = simularEscala(calcularRentabilidade(cenario), 550)
    assert.equal(e.vendasParaPagar, 20)
    assert.deepEqual(e.pontos[0], { vendas: 10, lucro: -275 })
    assert.equal(simularEscala(calcularRentabilidade({ ...cenario, preco: 100 }), 100).vendasParaPagar, null)
  })
})

describe('Rotas e telas', () => {
  test('rotas novas têm módulo; painel e gastos na página Canais de receita (sem menu novo)', () => {
    assert.ok(regraDaRota('/api/afiliados/painel', 'GET'))
    assert.ok(regraDaRota('/api/gastos', 'GET'))
    assert.ok(regraDaRota('/api/calendario/editorial', 'GET'))
    const pagina = readFileSync('app/(dashboard)/monetizacao/page.tsx', 'utf8')
    assert.match(pagina, /<PainelDeAfiliados dados=\{painel\} \/>/)
    assert.match(pagina, /<ControleDeGastos dados=\{gastos\} \/>/)
  })
})

describe('Banco de TESTE — leitura do workspace', { skip: !process.env.DATABASE_URL ? 'sem banco' : false }, () => {
  after(async () => { const { prisma } = await import('../lib/prisma'); await prisma.$disconnect() })
  test('painel, calendário, gastos e resultado leem sem erro e sem gravar', async () => {
    const { prisma } = await import('../lib/prisma')
    const ws = await prisma.workspace.findFirst({ select: { id: true } })
    if (!ws) return
    const antes = await prisma.auditLog.count({ where: { workspaceId: ws.id } })
    const { painelDeAfiliados } = await import('../lib/painel-afiliados')
    const { calendarioEditorial } = await import('../lib/calendario-editorial')
    const { situacaoDosGastos } = await import('../lib/controle-de-gastos')
    const { resultadoAposCustos } = await import('../lib/financeiro')
    const [p, c, g, r] = await Promise.all([painelDeAfiliados(ws.id), calendarioEditorial(ws.id), situacaoDosGastos(ws.id, {}), resultadoAposCustos(ws.id)])
    assert.ok(p.total && Array.isArray(p.porPlataforma))
    assert.ok(Array.isArray(c))
    assert.equal(g.orcamentoAdicionalAutorizadoBRL, 0)
    assert.notEqual(g.reservadoNoMesBRL, undefined)
    assert.equal(r.porOperacao.vendasProprias.situacao, 'SEM_OPERACAO')
    assert.equal(await prisma.auditLog.count({ where: { workspaceId: ws.id } }), antes, 'leitura não grava')
  })
})
