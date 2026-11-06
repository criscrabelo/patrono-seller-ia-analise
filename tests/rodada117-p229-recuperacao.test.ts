/**
 * P2.29 — RECUPERAÇÃO: queda no meio da importação e no meio da reconciliação. Cada caso termina em RETOMA ou
 * PEDE AÇÃO HUMANA, sem duplicar nada. (Queda durante evento: rodada114 + teste longo da P2.28; durante vídeo e
 * publicação: rodada113 e rodada114.) Banco de TESTE.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')

describe('P2.29 — recuperação (banco de TESTE)', { skip: !TEM_BANCO }, () => {
  let prisma: typeof import('../lib/prisma')['prisma']
  let I: typeof import('../lib/creator-center-importacao')
  let R: typeof import('../lib/reconciliacao')
  let S: typeof import('../lib/saude-operacional')
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  const PREFIXO = 'Conta de Teste — '
  const marca = `r117-${Date.now()}`
  const contas: string[] = []
  before(async () => {
    ;[{ prisma }, I, R, S, { limparWorkspaceDeTeste: limpar }] = await Promise.all([import('../lib/prisma'), import('../lib/creator-center-importacao'), import('../lib/reconciliacao'), import('../lib/saude-operacional'), import('./_limpar-workspace-de-teste')])
  })
  after(async () => {
    if (prisma) for (const w of contas) {
      await prisma.execucaoDoProcessador.deleteMany({ where: { workspaceId: w } })
      await limpar(prisma, w, PREFIXO)
    }
    await prisma?.$disconnect()
  })
  async function conta(nome: string) {
    const { criarUsuarioComWorkspace } = await import('../lib/workspace')
    const r = await criarUsuarioComWorkspace(prisma, { email: `${marca}-${nome}@teste.local`, password: 'x', name: `${PREFIXO}${nome} r117` })
    await prisma.workspace.update({ where: { id: r.workspace.id }, data: { name: `${PREFIXO}${nome} r117` } })
    contas.push(r.workspace.id)
    return r.workspace.id
  }
  const CAB = 'ID do pedido;ID do produto;Nome do produto;Valor do pedido;Comissão estimada;Comissão real;Status do pedido;Status da liquidação;Data do pedido;Data de liquidação'
  const arquivo = (n: number) => [CAB, ...Array.from({ length: n }, (_, i) => [`R117-${i}`, '17291170', `Item ${i}`, 'R$ 20,00', 'R$ 2,00', 'R$ 2,00', 'Concluído', 'Liquidado', '14/10/2026 10:00', '20/10/2026 10:00'].join(';'))].join('\n')
  const fotoDoBanco = async (ws: string) => ({
    importacoes: await prisma.importacaoCreatorCenter.count({ where: { workspaceId: ws } }),
    pedidos: await prisma.pedidoAfiliadoTikTok.count({ where: { workspaceId: ws } }),
    historico: await prisma.historicoPedidoAfiliadoTikTok.count({ where: { workspaceId: ws } }),
    vendas: await prisma.sale.count({ where: { workspaceId: ws } }),
    comissoes: await prisma.commission.count({ where: { workspaceId: ws } }),
  })

  test('queda NO MEIO da importação (linhas já gravadas, fim não marcado) → INCOMPLETA, vai para você; reenviar o mesmo arquivo RETOMA e conclui sem duplicar pedido, venda, comissão ou histórico', async () => {
    const ws = await conta('importacao-meio')
    const conteudo = arquivo(5)
    const r1 = await I.importarCreatorCenter({ workspaceId: ws, userId: null, nomeArquivo: 'cc.csv', conteudo, dataOrigin: 'TEST_FIXTURE' })
    const completo = await fotoDoBanco(ws)
    const situacaoSemQueda = (await I.situacaoDaImportacao(ws, r1.importacaoId!))!.situacao
    // a queda: o processo morreu depois de gravar as linhas e antes de marcar a importação como concluída
    await prisma.importacaoCreatorCenter.update({ where: { id: r1.importacaoId! }, data: { concluida: false, importadoEm: new Date(Date.now() - 30 * 60_000) } })
    assert.equal((await I.situacaoDaImportacao(ws, r1.importacaoId!))!.situacao, 'INCOMPLETA')
    const rec = await R.reconciliarEstadoOperacional(ws)
    const achado = rec.achados.find((a) => a.tipo === 'IMPORTACAO_INCOMPLETA')!
    assert.equal(achado.desfecho, 'PRECISA_DE_VOCE', 'pede ação humana (reenviar), sem adivinhar o que faltou')
    assert.match(achado.texto, /envie o mesmo arquivo de novo/)
    const r2 = await I.importarCreatorCenter({ workspaceId: ws, userId: null, nomeArquivo: 'cc.csv', conteudo, dataOrigin: 'TEST_FIXTURE' })
    assert.equal(r2.importacaoId, r1.importacaoId, 'retoma a MESMA importação')
    assert.deepEqual(await fotoDoBanco(ws), completo, 'nada duplicou')
    assert.equal((await I.situacaoDaImportacao(ws, r1.importacaoId!))!.situacao, situacaoSemQueda, 'a mesma situação de uma importação sem queda')
    assert.notEqual(situacaoSemQueda, 'INCOMPLETA')
    // e o terceiro envio é só "repetida"
    const r3 = await I.importarCreatorCenter({ workspaceId: ws, userId: null, nomeArquivo: 'cc.csv', conteudo, dataOrigin: 'TEST_FIXTURE' })
    assert.equal(r3.repetida, true)
    assert.deepEqual(await fotoDoBanco(ws), completo)
  })

  test('queda LOGO DEPOIS de abrir a importação (nenhuma linha gravada) → reenviar processa tudo uma vez', async () => {
    const ws = await conta('importacao-inicio')
    const conteudo = arquivo(3)
    const r1 = await I.importarCreatorCenter({ workspaceId: ws, userId: null, nomeArquivo: 'cc.csv', conteudo, dataOrigin: 'TEST_FIXTURE' })
    const esperado = await fotoDoBanco(ws)
    // reconstrói o cenário da queda num workspace novo: só a importação aberta, com o mesmo arquivo
    const ws2 = await conta('importacao-inicio-2')
    const imp = await prisma.importacaoCreatorCenter.findUniqueOrThrow({ where: { id: r1.importacaoId! } })
    await prisma.importacaoCreatorCenter.create({ data: { ...imp, id: undefined, workspaceId: ws2, concluida: false, linhasNovas: 0, ocorrencias: [], mapeamento: imp.mapeamento as never, importadoEm: new Date(Date.now() - 20 * 60_000) } as never })
    assert.equal((await fotoDoBanco(ws2)).pedidos, 0)
    const r2 = await I.importarCreatorCenter({ workspaceId: ws2, userId: null, nomeArquivo: 'cc.csv', conteudo, dataOrigin: 'TEST_FIXTURE' })
    assert.equal(r2.ok, true)
    assert.deepEqual(await fotoDoBanco(ws2), esperado, 'mesmo resultado de uma importação sem queda')
  })

  test('importação EM PARTES (orçamento de tempo da requisição): reenviar o mesmo arquivo até terminar dá exatamente o resultado de uma importação direta — números, pedidos, vendas, comissões, histórico', async () => {
    const CAB2 = 'ID do pedido;ID do produto;Nome do produto;Comissão estimada;Comissão real;Status do pedido;Status da liquidação;Data do pedido;Data de liquidação'
    const NL = String.fromCharCode(10)
    const antigo = [CAB2, ['PARTE-1', '1', 'A', 'R$ 1,00', '', 'Pago', '', '14/10/2026 10:00', ''].join(';'), ['PARTE-2', '1', 'B', 'R$ 2,00', 'R$ 2,00', 'Concluído', 'Liquidado', '14/10/2026 10:00', '20/10/2026 10:00'].join(';')].join(NL)
    const novo = [CAB2,
      ['PARTE-1', '1', 'A', 'R$ 1,00', 'R$ 1,00', 'Concluído', 'Liquidado', '14/10/2026 10:00', '20/10/2026 10:00'].join(';'), // atualiza (estimada → liquidada)
      ['PARTE-2', '1', 'B', 'R$ 2,00', '', 'Pago', '', '14/10/2026 10:00', ''].join(';'), // regressão (liquidada → estimada): ignorada
      ...Array.from({ length: 6 }, (_, i) => [`PARTE-N${i}`, '1', `N${i}`, 'R$ 3,00', '', 'Pago', '', '15/10/2026 10:00', ''].join(';')), // novas
    ].join(NL)
    const montar = async (nome: string) => { const ws = await conta(nome); await I.importarCreatorCenter({ workspaceId: ws, userId: null, nomeArquivo: 'antigo.csv', conteudo: antigo, dataOrigin: 'TEST_FIXTURE' }); return ws }
    const direto = await montar('partes-direto')
    const rd = await I.importarCreatorCenter({ workspaceId: direto, userId: null, nomeArquivo: 'novo.csv', conteudo: novo, dataOrigin: 'TEST_FIXTURE' })
    assert.equal(rd.continuar, undefined)
    const emPartes = await montar('partes')
    let r = await I.importarCreatorCenter({ workspaceId: emPartes, userId: null, nomeArquivo: 'novo.csv', conteudo: novo, dataOrigin: 'TEST_FIXTURE', orcamentoMs: 0 })
    let envios = 1
    const progresso: number[] = []
    while (r.continuar && envios < 30) {
      progresso.push(r.progresso!.tratadas)
      r = await I.importarCreatorCenter({ workspaceId: emPartes, userId: null, nomeArquivo: 'novo.csv', conteudo: novo, dataOrigin: 'TEST_FIXTURE', orcamentoMs: 0 })
      envios++
    }
    assert.ok(envios >= 4, `foi mesmo em partes (${envios} envios; progresso ${progresso.join(' → ')})`)
    assert.ok(progresso.every((x, i) => i === 0 || x > progresso[i - 1]), `sempre avança (${progresso.join(' → ')})`)
    assert.equal(r.continuar, undefined)
    const numeros = (x: typeof r) => ({ novas: x.linhasNovas, atualizadas: x.linhasAtualizadas, iguais: x.linhasIguais, regressoes: x.regressoesIgnoradas, rejeitadas: x.linhasRejeitadas })
    assert.deepEqual(numeros(r), numeros(rd), 'os mesmos números')
    assert.deepEqual(numeros(rd), { novas: 6, atualizadas: 1, iguais: 0, regressoes: 1, rejeitadas: 0 })
    const fotoDetalhada = async (ws: string) => ({
      ...(await fotoDoBanco(ws)),
      pedidos: JSON.stringify((await prisma.pedidoAfiliadoTikTok.findMany({ where: { workspaceId: ws }, orderBy: { chave: 'asc' }, select: { chave: true, estado: true, comissaoEstimada: true, comissaoLiquidada: true } }))),
      historico: JSON.stringify((await prisma.historicoPedidoAfiliadoTikTok.groupBy({ by: ['tipo'], where: { workspaceId: ws }, _count: { _all: true }, orderBy: { tipo: 'asc' } })).map((g) => [g.tipo, g._count._all])),
      comissoes: JSON.stringify((await prisma.commission.findMany({ where: { workspaceId: ws }, select: { status: true, expectedAmount: true, confirmedAmount: true } })).map((c) => `${c.status}:${c.expectedAmount}:${c.confirmedAmount}`).sort()),
    })
    assert.deepEqual(await fotoDetalhada(emPartes), await fotoDetalhada(direto), 'o banco fica igual ao da importação direta')
    // o reenvio depois de concluída continua sendo "repetida"
    assert.equal((await I.importarCreatorCenter({ workspaceId: emPartes, userId: null, nomeArquivo: 'novo.csv', conteudo: novo, dataOrigin: 'TEST_FIXTURE', orcamentoMs: 0 })).repetida, true)
  })

  test('queda NO MEIO da reconciliação: rodada aberta recente → a próxima espera (não roda em paralelo); rodada aberta velha → RETOMA; correção já feita não é refeita', async () => {
    const ws = await conta('reconciliacao')
    const venda = await prisma.sale.create({ data: { workspaceId: ws, amount: 30, status: 'CANCELLED', source: 'manual', dataOrigin: 'TEST_FIXTURE' } })
    const com = await prisma.commission.create({ data: { workspaceId: ws, saleId: venda.id, expectedAmount: 3, confirmedAmount: 3, status: 'CONFIRMED' } })
    // a rodada que "morreu" agora há pouco ainda segura a vez
    const morta = await prisma.execucaoDoProcessador.create({ data: { workspaceId: ws, tipo: 'RECONCILIACAO', worker: 'morto', iniciadoEm: new Date(Date.now() - 60_000) } })
    const espera = await R.reconciliarEstadoOperacional(ws)
    assert.equal(espera.emAndamento, true, 'não roda duas ao mesmo tempo')
    assert.equal((await prisma.commission.findUniqueOrThrow({ where: { id: com.id } })).status, 'CONFIRMED')
    // passou o tempo da rodada aberta (5 min): a próxima retoma sozinha
    await prisma.execucaoDoProcessador.update({ where: { id: morta.id }, data: { iniciadoEm: new Date(Date.now() - 10 * 60_000) } })
    const r = await R.reconciliarEstadoOperacional(ws)
    assert.equal(r.emAndamento, false)
    assert.equal((await prisma.commission.findUniqueOrThrow({ where: { id: com.id } })).status, 'REVERSED')
    // a queda aconteceu DEPOIS de corrigir a comissão e antes de fechar a rodada: rodar de novo não corrige outra vez
    await prisma.execucaoDoProcessador.updateMany({ where: { id: r.execucaoId! }, data: { terminadoEm: null, iniciadoEm: new Date(Date.now() - 10 * 60_000) } })
    const de_novo = await R.reconciliarEstadoOperacional(ws)
    assert.equal(de_novo.corrigidos, 0)
    assert.equal(await prisma.historicoDeComissao.count({ where: { commissionId: com.id } }), 1, 'um histórico só')
    // o health check mostra a rodada antiga sem fim? a última concluída é a que vale
    const saude = await S.saudeOperacional(ws, new Date(), {})
    assert.ok(saude.indicadores.some((i) => i.chave === 'reconciliacao'))
  })
})
