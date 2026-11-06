/**
 * P2.19 — IMPORTAÇÃO DO CSV DO CREATOR CENTER (comissão estimada, não liquidada e liquidada).
 *
 * Trava: leitura PT/EN, números e datas do Brasil, estado da comissão (desconhecido → estimada;
 * "liquidado" sem valor real → não liquidada), colunas obrigatórias (arquivo recusado inteiro),
 * idempotência (mesmo arquivo = nada novo; importação interrompida retoma), duplicidade (mesma
 * linha no mesmo arquivo e em arquivos diferentes), histórico de cada mudança, regressão ignorada,
 * espelho em Sale/Commission sem confundir estimativa com receita, origem e data preservadas.
 * Banco de TESTE.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { lerCsv, lerNumero, lerTaxa, lerData, classificarEstado, lerArquivoDoCreatorCenter, mapearColunas } from '../lib/creator-center-csv'

const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')
const AGORA = new Date('2026-10-15T12:00:00-03:00')

const CAB_PT = 'ID do pedido;ID do SKU;ID do produto;Nome do produto;Nome da loja;Quantidade;Valor do pedido;Taxa de comissão;Comissão estimada;Comissão real;Status do pedido;Status da liquidação;Data do pedido;Data de liquidação;Tipo de conteúdo;ID do conteúdo;Coluna Misteriosa'
const linhaPt = (o: Partial<Record<string, string>> = {}) => [
  o.pedido ?? '5770001', o.sku ?? 'sku-1', o.produto ?? '1729000001', o.nome ?? 'Livro Emocionário', 'Loja X', '1', o.valor ?? 'R$ 59,90', '12%',
  o.estimada ?? 'R$ 7,19', o.real ?? '', o.status ?? 'Pago', o.liq ?? '', '14/10/2026 10:30', o.dataLiq ?? '', 'Vídeo', o.conteudo ?? '7550000000000000001', 'x',
].join(';')

describe('leitura do arquivo (puro)', () => {
  test('CSV: separador detectado, aspas, "" escapado, quebra de linha dentro de aspas e BOM', () => {
    const t = lerCsv('﻿a,b,c\n"1,5","diz ""oi""","linha\nquebrada"\r\n\n2,3,4\n')
    assert.deepEqual(t, [['a', 'b', 'c'], ['1,5', 'diz "oi"', 'linha\nquebrada'], ['2', '3', '4']])
    assert.deepEqual(lerCsv('x;y\n1;2'), [['x', 'y'], ['1', '2']])
  })
  test('números do Brasil e de fora; vazio/"--" é não medido (null), nunca zero', () => {
    assert.equal(lerNumero('R$ 1.234,56'), 1234.56)
    assert.equal(lerNumero('1,234.56'), 1234.56)
    assert.equal(lerNumero('7,19'), 7.19)
    assert.equal(lerNumero('1.234'), 1234)
    assert.equal(lerNumero('12.5'), 12.5)
    assert.equal(lerNumero('-3,50'), -3.5)
    assert.equal(lerNumero(''), null)
    assert.equal(lerNumero('--'), null)
    assert.equal(lerTaxa('12%'), 0.12)
    assert.equal(lerTaxa('0.12'), 0.12)
  })
  test('datas sem fuso são do Brasil (-03:00)', () => {
    assert.equal(lerData('14/10/2026 10:30')!.toISOString(), '2026-10-14T13:30:00.000Z')
    assert.equal(lerData('2026-10-14 10:30:05')!.toISOString(), '2026-10-14T13:30:05.000Z')
    assert.equal(lerData('2026-10-14T10:30:00Z')!.toISOString(), '2026-10-14T10:30:00.000Z')
    assert.equal(lerData('ontem'), null)
  })
  test('estado: cancelado/reembolso, não liquidado (antes de "liquidado"), liquidado só com valor real, concluído, pago, desconhecido', () => {
    assert.equal(classificarEstado({ statusPedido: 'Cancelado', comissaoLiquidada: null }).estado, 'CANCELADA')
    assert.equal(classificarEstado({ statusPedido: 'Concluído', statusLiquidacao: 'Reembolsado', comissaoLiquidada: 5 }).estado, 'CANCELADA')
    assert.equal(classificarEstado({ statusLiquidacao: 'Não liquidado', comissaoLiquidada: null }).estado, 'NAO_LIQUIDADA')
    assert.equal(classificarEstado({ statusLiquidacao: 'Unsettled', comissaoLiquidada: null }).estado, 'NAO_LIQUIDADA')
    assert.equal(classificarEstado({ statusLiquidacao: 'Liquidado', comissaoLiquidada: 7 }).estado, 'LIQUIDADA')
    const semValor = classificarEstado({ statusLiquidacao: 'Settled', comissaoLiquidada: null })
    assert.equal(semValor.estado, 'NAO_LIQUIDADA')
    assert.match(semValor.aviso!, /sem o valor real/)
    assert.equal(classificarEstado({ statusPedido: 'Concluído', comissaoLiquidada: null }).estado, 'NAO_LIQUIDADA')
    assert.equal(classificarEstado({ statusPedido: 'Pago', comissaoLiquidada: null }).estado, 'ESTIMADA')
    const desconhecido = classificarEstado({ statusPedido: 'Xyz', comissaoLiquidada: 9 })
    assert.equal(desconhecido.estado, 'ESTIMADA', 'desconhecido nunca vira receita')
    assert.equal(desconhecido.reconhecido, false)
  })
  test('colunas PT e EN; coluna desconhecida fica listada; sem obrigatórias o arquivo é recusado inteiro', () => {
    const pt = mapearColunas(CAB_PT.split(';'))
    assert.equal(pt.mapeamento.comissaoEstimada, 'Comissão estimada')
    assert.equal(pt.mapeamento.comissaoLiquidada, 'Comissão real')
    assert.equal(pt.mapeamento.statusLiquidacao, 'Status da liquidação')
    assert.deepEqual(pt.ignoradas, ['Coluna Misteriosa'])
    const en = mapearColunas(['Order ID', 'SKU ID', 'Product Name', 'Estimated Commission', 'Actual Commission', 'Order Status', 'Settlement Status', 'Order Created Time'])
    assert.equal(en.mapeamento.pedidoId, 'Order ID')
    assert.equal(en.mapeamento.comissaoLiquidada, 'Actual Commission')
    const r = lerArquivoDoCreatorCenter('Nome do produto;Quantidade\nLivro;1')
    assert.equal(r.ok, false)
    assert.match(r.motivo!, /ID do pedido.*comissão estimada ou comissão real.*Nada foi importado/)
  })
  test('linhas: chave pedido+SKU; repetida no mesmo arquivo é rejeitada; cancelada zera a liquidada; sem comissão é rejeitada', () => {
    const r = lerArquivoDoCreatorCenter([CAB_PT, linhaPt(), linhaPt(), linhaPt({ pedido: '5770002', status: 'Cancelado', real: 'R$ 7,19' }), linhaPt({ pedido: '5770003', estimada: '' })].join('\n'))
    assert.equal(r.ok, true)
    assert.equal(r.linhas.length, 2)
    assert.equal(r.linhas[0].chave, '5770001:sku-1')
    assert.equal(r.linhas[0].estado, 'ESTIMADA')
    assert.equal(r.linhas[0].comissaoEstimada, 7.19)
    assert.equal(r.linhas[0].comissaoLiquidada, null)
    assert.equal(r.linhas[0].tipoConteudo, 'VIDEO')
    assert.equal(r.linhas[1].estado, 'CANCELADA')
    assert.equal(r.linhas[1].comissaoLiquidada, 0)
    assert.deepEqual(r.rejeitadas.map((x) => x.motivo), ['repetida no mesmo arquivo (igual à linha 2)', 'sem valor de comissão'])
  })
})

describe('importação (banco de TESTE)', { skip: !TEM_BANCO ? 'exige banco de TESTE' : false, timeout: 900_000 }, () => {
  let prisma: typeof import('../lib/prisma').prisma
  let I: typeof import('../lib/creator-center-importacao')
  let V: typeof import('../lib/vendas-comissoes')
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  const PREFIXO = 'Conta de Teste — '
  const marca = `r103-${Date.now()}`
  const workspaces: string[] = []

  async function novoWorkspace(nome: string) {
    const ws = (await prisma.workspace.create({ data: { name: `${PREFIXO}${nome} r103`, ownerId: `${marca}-${nome}` }, select: { id: true } })).id
    workspaces.push(ws)
    return ws
  }
  const importar = (ws: string, linhas: string[], nome = 'pedidos.csv') =>
    I.importarCreatorCenter({ workspaceId: ws, userId: null, nomeArquivo: nome, conteudo: [CAB_PT, ...linhas].join('\n'), dataOrigin: 'TEST_FIXTURE', agora: AGORA })

  before(async () => {
    ;[{ prisma }, I, V, { limparWorkspaceDeTeste: limpar }] = await Promise.all([import('../lib/prisma'), import('../lib/creator-center-importacao'), import('../lib/vendas-comissoes'), import('./_limpar-workspace-de-teste')])
  })
  after(async () => {
    if (prisma) for (const w of workspaces) await limpar(prisma, w, PREFIXO)
    await prisma?.$disconnect()
  })

  test('primeira importação: 3 estados separados; origem, arquivo e data guardados; só a liquidada é receita', async () => {
    const ws = await novoWorkspace('estados')
    const r = await importar(ws, [
      linhaPt({ pedido: 'A1' }),
      linhaPt({ pedido: 'A2', status: 'Concluído', estimada: 'R$ 10,00' }),
      linhaPt({ pedido: 'A3', status: 'Concluído', liq: 'Liquidado', real: 'R$ 6,50', dataLiq: '15/10/2026 08:00' }),
      linhaPt({ pedido: 'A4', status: 'Cancelado' }),
    ])
    assert.equal(r.ok, true)
    assert.deepEqual([r.linhasNovas, r.linhasAtualizadas, r.linhasIguais, r.linhasRejeitadas], [4, 0, 0, 0])
    assert.deepEqual(r.colunasIgnoradas, ['Coluna Misteriosa'])
    const imp = await prisma.importacaoCreatorCenter.findUniqueOrThrow({ where: { id: r.importacaoId! } })
    assert.equal(imp.origem, 'CREATOR_CENTER_CSV')
    assert.equal(imp.dataOrigin, 'TEST_FIXTURE')
    assert.equal(imp.nomeArquivo, 'pedidos.csv')
    assert.equal(imp.importadoEm.toISOString(), AGORA.toISOString())
    assert.equal(imp.concluida, true)
    const s = await I.resumoCreatorCenter(ws)
    assert.deepEqual(s.estimada, { pedidos: 1, valor: 7.19 })
    assert.deepEqual(s.naoLiquidada, { pedidos: 1, valor: 10 })
    assert.deepEqual(s.liquidada, { pedidos: 1, valor: 6.5 })
    assert.equal(s.cancelada.pedidos, 1)
    assert.equal(s.receitaConfirmada, 6.5, 'estimativa nunca entra na receita confirmada')
    assert.equal(s.previsao, 17.19)
    assert.equal(s.ultimaImportacao!.nomeArquivo, 'pedidos.csv')
    // Espelho na fonte única de vendas: estimada/não liquidada = prevista; liquidada = confirmada; cancelada fora.
    const c = await V.resumoComissoes(ws)
    assert.equal(Math.round(c.prevista * 100) / 100, 17.19)
    assert.equal(c.confirmada, 6.5)
    assert.equal(c.recebida, 0, 'liquidação não é pagamento: RECEIVED continua manual')
    const vendas = await prisma.sale.findMany({ where: { workspaceId: ws }, select: { status: true, source: true, dataOrigin: true } })
    assert.deepEqual(vendas.map((v) => v.status).sort(), ['CANCELLED', 'CONFIRMED', 'PENDING', 'PENDING'])
    assert.ok(vendas.every((v) => v.source === 'creator_center_csv' && v.dataOrigin === 'TEST_FIXTURE'))
  })

  test('idempotência: o mesmo arquivo de novo não cria nada; arquivo diferente com as mesmas linhas não duplica', async () => {
    const ws = await novoWorkspace('idem')
    const linhas = [linhaPt({ pedido: 'B1' }), linhaPt({ pedido: 'B2' })]
    const a = await importar(ws, linhas)
    const b = await importar(ws, linhas, 'outro-nome.csv')
    assert.equal(b.repetida, true)
    assert.equal(b.importacaoId, a.importacaoId)
    const c = await importar(ws, [...linhas, ''], 'com-linha-vazia.csv')
    assert.equal(c.repetida, undefined)
    assert.deepEqual([c.linhasNovas, c.linhasAtualizadas, c.linhasIguais], [0, 0, 2])
    assert.equal(await prisma.pedidoAfiliadoTikTok.count({ where: { workspaceId: ws } }), 2)
    assert.equal(await prisma.sale.count({ where: { workspaceId: ws } }), 2)
    assert.equal(await prisma.commission.count({ where: { workspaceId: ws } }), 2)
    assert.equal(await prisma.historicoPedidoAfiliadoTikTok.count({ where: { workspaceId: ws } }), 2, 'só os 2 CRIADO')
  })

  test('mesmo arquivo enviado 3 vezes ao mesmo tempo (duas abas): uma importação, sem duplicar', async () => {
    const ws = await novoWorkspace('corrida')
    const linhas = [linhaPt({ pedido: 'C1' })]
    const rs = await Promise.all([importar(ws, linhas), importar(ws, linhas), importar(ws, linhas)])
    assert.ok(rs.every((r) => r.ok))
    assert.equal(await prisma.importacaoCreatorCenter.count({ where: { workspaceId: ws } }), 1)
    assert.equal(await prisma.pedidoAfiliadoTikTok.count({ where: { workspaceId: ws } }), 1)
    assert.equal(await prisma.sale.count({ where: { workspaceId: ws } }), 1)
  })

  test('evolução estimada → não liquidada → liquidada, com histórico; arquivo antigo depois não volta o estado', async () => {
    const ws = await novoWorkspace('evolucao')
    await importar(ws, [linhaPt({ pedido: 'D1' })], 'semana1.csv')
    await importar(ws, [linhaPt({ pedido: 'D1', status: 'Concluído' })], 'semana2.csv')
    const r3 = await importar(ws, [linhaPt({ pedido: 'D1', status: 'Concluído', liq: 'Liquidado', real: 'R$ 6,90', dataLiq: '20/10/2026 09:00' })], 'semana3.csv')
    assert.equal(r3.linhasAtualizadas, 1)
    const antigo = await importar(ws, [linhaPt({ pedido: 'D1', estimada: 'R$ 7,20' })], 'semana1-reenviada-editada.csv')
    assert.equal(antigo.regressoesIgnoradas, 1)
    assert.match(antigo.ocorrencias.find((o) => o.tipo === 'REGRESSAO_IGNORADA')!.texto, /mantido/)
    const p = await prisma.pedidoAfiliadoTikTok.findFirstOrThrow({ where: { workspaceId: ws } })
    assert.equal(p.estado, 'LIQUIDADA')
    assert.equal(p.comissaoLiquidada, 6.9)
    assert.equal(p.dataLiquidacao!.toISOString(), '2026-10-20T12:00:00.000Z')
    const h = await prisma.historicoPedidoAfiliadoTikTok.findMany({ where: { pedidoId: p.id }, orderBy: { registradoEm: 'asc' } })
    assert.deepEqual(h.map((x) => x.tipo), ['CRIADO', 'ATUALIZADO', 'ATUALIZADO', 'REGRESSAO_IGNORADA'])
    assert.deepEqual(h.map((x) => (x.novo as { estado: string }).estado), ['ESTIMADA', 'NAO_LIQUIDADA', 'LIQUIDADA', 'ESTIMADA'])
    assert.equal((h[2].anterior as { estado: string }).estado, 'NAO_LIQUIDADA', 'o histórico guarda o antes')
    const com = await prisma.commission.findFirstOrThrow({ where: { workspaceId: ws } })
    assert.equal(com.status, 'CONFIRMED')
    assert.equal(com.confirmedAmount, 6.9)
    assert.equal(com.expectedAmount, 7.19, 'a estimativa fica guardada ao lado do valor real')
  })

  test('reembolso depois da liquidação: vira cancelada (comissão 0) e sai dos totais; a comissão recebida vira REVERTIDA (P2.25) com o valor e o antes/depois guardados', async () => {
    const ws = await novoWorkspace('reembolso')
    await importar(ws, [linhaPt({ pedido: 'E1', status: 'Concluído', liq: 'Liquidado', real: 'R$ 6,90' })], 'liq.csv')
    const com = await prisma.commission.findFirstOrThrow({ where: { workspaceId: ws } })
    await prisma.commission.update({ where: { id: com.id }, data: { status: 'RECEIVED', receivedAmount: 6.9 } })
    await importar(ws, [linhaPt({ pedido: 'E1', status: 'Concluído', liq: 'Reembolsado', real: 'R$ 6,90' })], 'reembolso.csv')
    const p = await prisma.pedidoAfiliadoTikTok.findFirstOrThrow({ where: { workspaceId: ws } })
    assert.equal(p.estado, 'CANCELADA')
    assert.equal(p.comissaoLiquidada, 0)
    const venda = await prisma.sale.findFirstOrThrow({ where: { workspaceId: ws } })
    assert.equal(venda.status, 'CANCELLED')
    const revertida = await prisma.commission.findFirstOrThrow({ where: { workspaceId: ws } })
    assert.equal(revertida.status, 'REVERSED')
    assert.equal(revertida.receivedAmount, 6.9, 'o valor recebido fica no histórico (não é apagado)')
    const h = await prisma.historicoDeComissao.findMany({ where: { commissionId: revertida.id, origem: 'CREATOR_CENTER' }, orderBy: { registradoEm: 'asc' } })
    assert.equal((h.at(-1)!.anterior as { status: string }).status, 'RECEIVED')
    assert.equal((h.at(-1)!.novo as { status: string }).status, 'REVERSED')
    const c = await V.resumoComissoes(ws)
    assert.deepEqual([c.prevista, c.confirmada, c.recebida, c.revertida], [0, 0, 0, 6.9], 'venda cancelada não conta em nenhum total; aparece como revertida')
  })

  test('arquivo sem as colunas obrigatórias: nada gravado; importação interrompida é retomada sem duplicar', async () => {
    const ws = await novoWorkspace('recusa')
    const r = await I.importarCreatorCenter({ workspaceId: ws, userId: null, nomeArquivo: 'errado.csv', conteudo: 'Produto;Qtd\nLivro;1', dataOrigin: 'TEST_FIXTURE', agora: AGORA })
    assert.equal(r.ok, false)
    assert.equal(await prisma.importacaoCreatorCenter.count({ where: { workspaceId: ws } }), 0)
    // Simula uma importação que caiu no meio: a linha F1 gravada, a importação não concluída.
    const conteudo = [CAB_PT, linhaPt({ pedido: 'F1' }), linhaPt({ pedido: 'F2' })].join('\n')
    const a = await I.importarCreatorCenter({ workspaceId: ws, userId: null, nomeArquivo: 'x.csv', conteudo, dataOrigin: 'TEST_FIXTURE', agora: AGORA })
    await prisma.importacaoCreatorCenter.update({ where: { id: a.importacaoId! }, data: { concluida: false } })
    await prisma.historicoPedidoAfiliadoTikTok.deleteMany({ where: { workspaceId: ws, pedido: { pedidoId: 'F2' } } })
    await prisma.pedidoAfiliadoTikTok.updateMany({ where: { workspaceId: ws, pedidoId: 'F2' }, data: { saleId: null } })
    await prisma.pedidoAfiliadoTikTok.deleteMany({ where: { workspaceId: ws, pedidoId: 'F2' } })
    const b = await I.importarCreatorCenter({ workspaceId: ws, userId: null, nomeArquivo: 'x.csv', conteudo, dataOrigin: 'TEST_FIXTURE', agora: AGORA })
    assert.equal(b.importacaoId, a.importacaoId, 'retoma a mesma importação')
    // P2.29: os números descrevem a IMPORTAÇÃO inteira (o que ela gravou), não só o envio que a retomou — o
    // mesmo vale para a importação em partes. F1 (antes da queda) + F2 (na retomada) = 2 novas desta importação.
    assert.deepEqual([b.linhasNovas, b.linhasIguais], [2, 0])
    assert.equal(await prisma.pedidoAfiliadoTikTok.count({ where: { workspaceId: ws } }), 2)
    assert.equal(await prisma.sale.count({ where: { workspaceId: ws } }), 2, 'a venda de F2 foi reaproveitada pela chave de idempotência')
  })

  test('ligações nunca por nome: produto pelo id externo, vídeo pelo postId', async () => {
    const ws = await novoWorkspace('ligacoes')
    const userId = (await prisma.user.create({ data: { email: `${marca}-lig@teste.local`, name: 'U', password: 'x', workspaceId: ws }, select: { id: true } })).id
    const base = { workspaceId: ws, userId, categoria: 'Livros', origemConteudo: 'manual', tipoVenda: 'afiliado' }
    const prod = await prisma.produto.create({ data: { ...base, nome: 'Outro nome qualquer', externalId: '1729000777', providerId: 'tiktok-shop' }, select: { id: true } })
    const homonimo = await prisma.produto.create({ data: { ...base, nome: 'Livro Emocionário' }, select: { id: true } })
    await importar(ws, [linhaPt({ pedido: 'G1', produto: '1729000777' }), linhaPt({ pedido: 'G2', produto: '999' })])
    const [g1, g2] = await Promise.all(['G1', 'G2'].map((x) => prisma.pedidoAfiliadoTikTok.findFirstOrThrow({ where: { workspaceId: ws, pedidoId: x } })))
    assert.equal(g1.produtoId, prod.id)
    assert.equal(g2.produtoId, null, 'mesmo nome de produto não liga')
    assert.notEqual(g2.produtoId, homonimo.id)
  })
})
