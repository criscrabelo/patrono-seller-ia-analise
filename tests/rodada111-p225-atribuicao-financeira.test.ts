/**
 * P2.25 — ATRIBUIÇÃO E APRENDIZADO FINANCEIRO: uma cadeia (produto → conteúdo → publicação → pedido →
 * comissão → aprendizado), uma régua (lib/financeiro.ts) e nenhuma soma paralela.
 *
 * Trava: estados separados (estimada, não liquidada, liquidada, recebida, revertida, cancelada); vínculo só
 * por identificador (NAO_VINCULADO sem adivinhar); histórico antes/depois; o mesmo pedido nunca conta duas
 * vezes (reimportação, refresh, concorrência, telas diferentes); importação fora de ordem; o aprendizado
 * pesa o confirmado mais que o estimado. Banco de TESTE.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { estadoDaComissao, estadoDoPedido, somarFinanceiro, somarComissoes, valorConfirmado, PESO_NO_APRENDIZADO, PESO_DA_COMISSAO_ESTIMADA } from '../lib/financeiro'
import { PESO_DA_COMISSAO_ESTIMADA as PESO_DO_APRENDIZADO_CRIATIVO, comissaoPonderada } from '../lib/aprendizado-criativo'

const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')
const AGORA = new Date('2026-10-15T12:00:00-03:00')
const c = (status: string, e: number | null, conf: number | null = null, rec: number | null = null) => ({ status, expectedAmount: e, confirmedAmount: conf, receivedAmount: rec })

describe('P2.25 — régua canônica (pura)', () => {
  test('cada comissão cai em UM estado; confirmado = liquidada + recebida; previsão nunca é receita', () => {
    assert.deepEqual(estadoDaComissao(c('EXPECTED', 7)), { estado: 'ESTIMADA', valor: 7 })
    assert.deepEqual(estadoDaComissao(c('EXPECTED', 7), null, 'NAO_LIQUIDADA'), { estado: 'NAO_LIQUIDADA', valor: 7 })
    assert.deepEqual(estadoDaComissao(c('CONFIRMED', 7, 6.5)), { estado: 'LIQUIDADA', valor: 6.5 })
    assert.deepEqual(estadoDaComissao(c('RECEIVED', 7, 6.5, 6.4)), { estado: 'RECEBIDA', valor: 6.4 })
    assert.deepEqual(estadoDaComissao(c('REVERSED', 7, 6.5)), { estado: 'REVERTIDA', valor: 6.5 })
    assert.deepEqual(estadoDaComissao(c('CANCELLED', 7)), { estado: 'CANCELADA', valor: 7 })
    // linhas antigas: venda cancelada sem a comissão ter mudado de status
    assert.equal(estadoDaComissao(c('CONFIRMED', 7, 6.5), 'CANCELLED').estado, 'REVERTIDA')
    assert.equal(estadoDaComissao(c('EXPECTED', 7), 'CANCELLED').estado, 'CANCELADA')
    assert.equal(valorConfirmado(c('EXPECTED', 7)), 0)
    assert.equal(valorConfirmado(c('REVERSED', 7, 6.5)), 0)
    const s = somarComissoes([
      { id: 'a', ...c('EXPECTED', 1) }, { id: 'b', ...c('EXPECTED', 2), pedidoEstado: 'NAO_LIQUIDADA' }, { id: 'c', ...c('CONFIRMED', 3, 3) },
      { id: 'd', ...c('RECEIVED', 4, 4, 4) }, { id: 'e', ...c('REVERSED', 5, 5) }, { id: 'f', ...c('CANCELLED', 6) },
      { id: 'c', ...c('CONFIRMED', 3, 3) }, // a mesma comissão vinda de outra leitura: não dobra
    ])
    assert.deepEqual([s.estimada, s.naoLiquidada, s.liquidada, s.recebida, s.revertida, s.cancelada, s.confirmada, s.previsao], [1, 2, 3, 4, 5, 6, 7, 3])
    assert.equal(s.quantidade.LIQUIDADA, 1)
  })
  test('pedido importado: mesma régua; cancelado depois de liquidado = revertido', () => {
    assert.equal(estadoDoPedido({ estado: 'LIQUIDADA', comissaoEstimada: 7, comissaoLiquidada: 6 }).valor, 6)
    assert.equal(estadoDoPedido({ estado: 'CANCELADA', comissaoEstimada: 7, comissaoLiquidada: 6 }).estado, 'REVERTIDA')
    assert.equal(estadoDoPedido({ estado: 'CANCELADA', comissaoEstimada: 7, comissaoLiquidada: null }).estado, 'CANCELADA')
  })
  test('aprendizado: confirmado pesa mais que estimado; revertido/cancelado não ensina; um peso só', () => {
    assert.ok(PESO_NO_APRENDIZADO.LIQUIDADA > PESO_NO_APRENDIZADO.ESTIMADA && PESO_NO_APRENDIZADO.RECEBIDA > PESO_NO_APRENDIZADO.NAO_LIQUIDADA)
    assert.equal(PESO_NO_APRENDIZADO.REVERTIDA, 0)
    assert.equal(PESO_NO_APRENDIZADO.CANCELADA, 0)
    assert.equal(PESO_DO_APRENDIZADO_CRIATIVO, PESO_DA_COMISSAO_ESTIMADA, 'aprendizado criativo usa o peso da fonte canônica')
    assert.equal(comissaoPonderada({ comissaoConfirmada: 10, comissaoEstimada: 10 }), 10 + 10 * PESO_DA_COMISSAO_ESTIMADA)
  })
  test('trava: nenhuma soma de comissão fora da fonte canônica (cópias não voltam)', () => {
    const raiz = path.join(__dirname, '..')
    // Funil cumulativo (esperada ⊇ confirmada ⊇ recebida) por venda já filtrada, e receita REALIZADA (só RECEIVED):
    // perguntas diferentes da soma por estado, documentadas em P2.25-ATRIBUICAO-FINANCEIRA.md. Todas leem status, então REVERSED/CANCELLED já ficam fora.
    const PERMITIDOS = new Set(['lib/financeiro.ts', 'lib/ml-operacao-real.ts', 'lib/ml-geracao-publicacao.ts', 'lib/dossie-operacao.ts', 'lib/metricas-clique.ts', 'lib/metricas-publicacao.ts'])
    const proibido = /(receivedAmount|confirmedAmount)\s*\?\?\s*\w+\.(confirmedAmount|expectedAmount)|\+=?\s*\(?\s*\w+\.(receivedAmount|confirmedAmount|expectedAmount|comissaoLiquidada)\b|_sum:\s*\{[^}]*(comissaoEstimada|comissaoLiquidada|receivedAmount|confirmedAmount|expectedAmount)/
    const achados: string[] = []
    const varrer = (dir: string) => {
      for (const n of fs.readdirSync(path.join(raiz, dir), { withFileTypes: true })) {
        const rel = `${dir}/${n.name}`
        if (n.isDirectory()) { if (n.name !== 'node_modules') varrer(rel); continue }
        if (!/\.tsx?$/.test(n.name) || PERMITIDOS.has(rel)) continue
        const linhas = fs.readFileSync(path.join(raiz, rel), 'utf8').split('\n')
        linhas.forEach((l, i) => { if (proibido.test(l) && !/sugerido|aria-label|cadeia \?/.test(l)) achados.push(`${rel}:${i + 1}`) })
      }
    }
    varrer('lib'); varrer('app')
    assert.deepEqual(achados, [], 'some comissão pela lib/financeiro.ts')
  })
})

describe('P2.25 — cadeia de atribuição (banco de TESTE)', { skip: !TEM_BANCO }, () => {
  type P = typeof import('../lib/prisma')['prisma']
  let prisma: P
  let I: typeof import('../lib/creator-center-importacao')
  let V: typeof import('../lib/vendas-comissoes')
  let F: typeof import('../lib/financeiro')
  let R: typeof import('../lib/resumos')
  let M: typeof import('../lib/monetizacao')
  let RV: typeof import('../lib/resultados-videos')
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  const PREFIXO = 'Conta de Teste — '
  const marca = `r111-${Date.now()}`
  const workspaces: string[] = []
  const CAB = 'ID do pedido;ID do SKU;ID do produto;Nome do produto;Nome da loja;Quantidade;Valor do pedido;Taxa de comissão;Comissão estimada;Comissão real;Status do pedido;Status da liquidação;Data do pedido;Data de liquidação;Tipo de conteúdo;ID do conteúdo'
  const linha = (o: Partial<Record<string, string>> = {}) => [
    o.pedido ?? '1', o.sku ?? 'sku-1', o.produto ?? '1729111001', o.nome ?? 'Organizador E2E', 'Loja X', '1', 'R$ 59,90', '12%',
    o.estimada ?? 'R$ 7,00', o.real ?? '', o.status ?? 'Pago', o.liq ?? '', '14/10/2026 10:30', o.dataLiq ?? '', 'Vídeo', o.conteudo ?? '7551110000000000001',
  ].join(';')

  async function novoWorkspace(nome: string) {
    const { criarUsuarioComWorkspace } = await import('../lib/workspace')
    const { workspace, user } = await criarUsuarioComWorkspace(prisma, { email: `${marca}-${nome}@teste.local`, password: 'x', name: `${PREFIXO}${nome} r111` })
    await prisma.workspace.update({ where: { id: workspace.id }, data: { name: `${PREFIXO}${nome} r111` } })
    workspaces.push(workspace.id)
    const produto = await prisma.produto.create({ data: { workspaceId: workspace.id, userId: user.id, nome: 'Organizador E2E', categoria: 'Casa', origemConteudo: 'manual', tipoVenda: 'afiliado', providerId: 'tiktok-shop', externalId: '1729111001' } })
    const video = (postId: string) => prisma.videoTikTokResultado.create({ data: { workspaceId: workspace.id, produtoId: produto.id, postId, estrutura: 'DEMONSTRACAO', gancho: 'g', cta: 'A', duracaoSegundos: 20, publicadoEm: new Date('2026-10-10T12:00:00Z'), origemMetricas: 'MANUAL', views: 1000, nomeProduto: 'Organizador E2E' } })
    const [v1, v2] = [await video('7551110000000000001'), await video('7551110000000000002')]
    return { ws: workspace.id, userId: user.id, produto, v1, v2 }
  }
  const importar = (ws: string, linhas: string[], nome: string) =>
    I.importarCreatorCenter({ workspaceId: ws, userId: null, nomeArquivo: nome, conteudo: [CAB, ...linhas].join('\n'), dataOrigin: 'TEST_FIXTURE', agora: AGORA })

  before(async () => {
    ;[{ prisma }, I, V, F, R, M, RV, { limparWorkspaceDeTeste: limpar }] = await Promise.all([
      import('../lib/prisma'), import('../lib/creator-center-importacao'), import('../lib/vendas-comissoes'), import('../lib/financeiro'),
      import('../lib/resumos'), import('../lib/monetizacao'), import('../lib/resultados-videos'), import('./_limpar-workspace-de-teste'),
    ])
  })
  after(async () => {
    if (prisma) for (const w of workspaces) await limpar(prisma, w, PREFIXO)
    await prisma?.$disconnect()
  })

  test('estimada → não liquidada → liquidada → revertida: um pedido, uma comissão, antes/depois em cada passo', async () => {
    const { ws, produto, v1 } = await novoWorkspace('ciclo')
    await importar(ws, [linha({ pedido: 'A' })], 'a1.csv')
    let s = await F.resumoFinanceiro(ws)
    assert.deepEqual([s.estimada, s.naoLiquidada, s.confirmada], [7, 0, 0])
    await importar(ws, [linha({ pedido: 'A', status: 'Concluído' })], 'a2.csv')
    s = await F.resumoFinanceiro(ws)
    assert.deepEqual([s.estimada, s.naoLiquidada, s.confirmada], [0, 7, 0])
    await importar(ws, [linha({ pedido: 'A', status: 'Concluído', liq: 'Liquidado', real: 'R$ 6,50', dataLiq: '15/10/2026 08:00' })], 'a3.csv')
    s = await F.resumoFinanceiro(ws)
    assert.deepEqual([s.previsao, s.liquidada, s.confirmada], [0, 6.5, 6.5])
    // a cadeia responde: produto, conteúdo, pedido, quanto, e o que vai para o aprendizado
    const { elos } = await F.cadeiaFinanceira(ws)
    assert.equal(elos.length, 1)
    assert.equal(elos[0].produto.produtoId, produto.id)
    assert.equal(elos[0].produto.vinculo, 'VINCULADO_POR_ID_EXTERNO')
    assert.equal(elos[0].conteudo.videoResultadoId, v1.id)
    assert.equal(elos[0].conteudo.vinculo, 'VINCULADO_POR_POST_ID')
    assert.equal(elos[0].pedido.pedidoId, 'A')
    assert.equal(elos[0].canal, 'tiktok-shop')
    assert.deepEqual([elos[0].estado, elos[0].valor, elos[0].valorParaAprender], ['LIQUIDADA', 6.5, 6.5])

    await importar(ws, [linha({ pedido: 'A', status: 'Concluído', liq: 'Reembolsado', real: 'R$ 0,00' })], 'a4.csv')
    s = await F.resumoFinanceiro(ws)
    assert.deepEqual([s.confirmada, s.revertida, s.previsao], [0, 6.5, 0], 'revertida sai da receita e aparece à parte, com o valor que era confirmado')
    const com = await prisma.commission.findFirstOrThrow({ where: { workspaceId: ws } })
    assert.equal(com.status, 'REVERSED')
    assert.equal(com.confirmedAmount, 6.5, 'histórico financeiro não é sobrescrito')
    const h = await prisma.historicoDeComissao.findMany({ where: { commissionId: com.id }, orderBy: { registradoEm: 'asc' } })
    assert.deepEqual(h.map((x) => [(x.anterior as { status: string } | null)?.status ?? null, (x.novo as { status: string }).status]), [[null, 'EXPECTED'], ['EXPECTED', 'CONFIRMED'], ['CONFIRMED', 'REVERSED']])
    assert.equal(await prisma.historicoPedidoAfiliadoTikTok.count({ where: { workspaceId: ws } }), 4, 'o pedido guarda os 4 passos (inclusive estimada → não liquidada)')
    assert.equal(await prisma.domainEvent.count({ where: { workspaceId: ws, tipo: 'COMMISSION_REVERSED' } }), 1)
    assert.equal((await F.cadeiaFinanceira(ws)).elos[0].valorParaAprender, 0, 'revertida não alimenta o aprendizado')
  })

  test('mesmo pedido importado duas vezes (mesmo arquivo e outro arquivo) + refresh: nada dobra', async () => {
    const { ws } = await novoWorkspace('duas-vezes')
    const l = linha({ pedido: 'B', status: 'Concluído', liq: 'Liquidado', real: 'R$ 5,00' })
    await importar(ws, [l], 'b.csv')
    const r2 = await importar(ws, [l], 'b.csv')
    assert.equal(r2.repetida, true)
    const r3 = await importar(ws, [l, l], 'b-de-novo.csv')
    assert.equal(r3.linhasNovas, 0)
    assert.equal(await prisma.commission.count({ where: { workspaceId: ws } }), 1)
    assert.equal(await prisma.sale.count({ where: { workspaceId: ws } }), 1)
    assert.equal(await prisma.historicoDeComissao.count({ where: { workspaceId: ws } }), 1)
    const a = await F.resumoFinanceiro(ws), b = await F.resumoFinanceiro(ws)
    assert.deepEqual(a, b, 'refresh: a mesma leitura dá o mesmo número')
    assert.equal(a.confirmada, 5)
  })

  test('importação fora de ordem: o arquivo antigo (estimada) depois do novo (liquidada) não rebaixa nem soma', async () => {
    const { ws } = await novoWorkspace('fora-de-ordem')
    await importar(ws, [linha({ pedido: 'C', status: 'Concluído', liq: 'Liquidado', real: 'R$ 4,00' })], 'novo.csv')
    const r = await importar(ws, [linha({ pedido: 'C' })], 'antigo.csv')
    assert.equal(r.regressoesIgnoradas, 1)
    const s = await F.resumoFinanceiro(ws)
    assert.deepEqual([s.confirmada, s.previsao], [4, 0])
    assert.equal((await prisma.commission.findFirstOrThrow({ where: { workspaceId: ws } })).status, 'CONFIRMED')
  })

  test('conteúdo sem postId e pedido sem vínculo seguro: NAO_VINCULADO / SEM_IDENTIFICADOR, nunca por nome', async () => {
    const { ws } = await novoWorkspace('sem-vinculo')
    // mesmo NOME do produto cadastrado, mas outro id externo: não liga por semelhança
    await importar(ws, [linha({ pedido: 'D', produto: '999000111', conteudo: '' }), linha({ pedido: 'E', conteudo: '7559999999999999999' })], 'd.csv')
    const { elos } = await F.cadeiaFinanceira(ws)
    const d = elos.find((e) => e.pedido.pedidoId === 'D')!, e = elos.find((x) => x.pedido.pedidoId === 'E')!
    assert.equal(d.produto.produtoId, null)
    assert.equal(d.produto.vinculo, 'NAO_VINCULADO')
    assert.equal(d.conteudo.vinculo, 'SEM_IDENTIFICADOR')
    assert.equal(d.publicacao.vinculo, 'NAO_VINCULADO')
    assert.equal(e.conteudo.videoResultadoId, null)
    assert.equal(e.conteudo.vinculo, 'NAO_VINCULADO', 'postId que não existe no Patrono não é adivinhado')
    assert.equal((await F.resumoFinanceiro(ws)).estimada, 14, 'o dinheiro sem vínculo continua contado (uma vez), só não é atribuído')
  })

  test('dois vídeos do mesmo produto: cada pedido no seu vídeo; o produto soma os dois sem dobrar', async () => {
    const { ws, produto, v1, v2 } = await novoWorkspace('dois-videos')
    await importar(ws, [
      linha({ pedido: 'F', status: 'Concluído', liq: 'Liquidado', real: 'R$ 3,00', conteudo: v1.postId! }),
      linha({ pedido: 'G', status: 'Concluído', liq: 'Liquidado', real: 'R$ 2,00', conteudo: v2.postId! }),
      linha({ pedido: 'H', conteudo: v2.postId! }),
    ], 'f.csv')
    assert.equal((await F.cadeiaFinanceira(ws, { videoResultadoId: v1.id })).soma.confirmada, 3)
    const doV2 = (await F.cadeiaFinanceira(ws, { videoResultadoId: v2.id })).soma
    assert.deepEqual([doV2.confirmada, doV2.estimada], [2, 7])
    const doProduto = (await F.cadeiaFinanceira(ws, { produtoId: produto.id })).soma
    assert.deepEqual([doProduto.confirmada, doProduto.previsao], [5, 7])
    // aprendizado por vídeo: confirmada inteira, estimada separada (pesa menos)
    const vs = await RV.videosParaAprender(ws)
    const a1 = vs.find((v) => v.id === v1.id)!, a2 = vs.find((v) => v.id === v2.id)!
    assert.deepEqual([a1.comissaoConfirmada, a1.comissaoEstimada], [3, null])
    assert.deepEqual([a2.comissaoConfirmada, a2.comissaoEstimada], [2, 7])
    assert.equal(comissaoPonderada(a2), 2 + 7 * PESO_DA_COMISSAO_ESTIMADA)
  })

  test('mesmo produto em canais diferentes + todas as telas com o MESMO número (sem contar duas vezes)', async () => {
    const { ws, userId, produto, v1 } = await novoWorkspace('canais')
    await importar(ws, [linha({ pedido: 'I', status: 'Concluído', liq: 'Liquidado', real: 'R$ 6,00', conteudo: v1.postId! })], 'i.csv')
    const shopee = await prisma.affiliateProgram.create({ data: { workspaceId: ws, platform: 'shopee', status: 'ACTIVE' } })
    const manual = await V.registrarResultado({ workspaceId: ws, actorUserId: userId, dataOrigin: 'TEST_FIXTURE', productId: produto.id, affiliateProgramId: shopee.id, status: 'CONFIRMED', amount: 40, expectedCommission: 4 })
    await V.atualizarComissao({ workspaceId: ws, commissionId: manual.commission!.id, actorUserId: userId, status: 'CONFIRMED', confirmedAmount: 4 })
    // a titular digitou a comissão no vídeo que já tem pedido importado: não entra de novo
    await prisma.videoTikTokResultado.update({ where: { id: v1.id }, data: { comissao: 6 } })

    const canonico = await F.resumoFinanceiro(ws)
    assert.equal(canonico.confirmada, 10)
    const { elos } = await F.cadeiaFinanceira(ws)
    assert.deepEqual(elos.map((e) => e.canal).sort(), ['shopee', 'tiktok-shop'])
    assert.equal(elos.find((e) => e.canal === 'shopee')!.pedido.vinculo, 'REGISTRO_MANUAL')

    const resumo = await V.resumoComissoes(ws)
    assert.equal(resumo.confirmada + resumo.recebida, canonico.confirmada, 'Vendas e Comissões / Dashboard / Torre / Central')
    const mon = await M.monetizacaoDoWorkspace(ws, AGORA)
    assert.equal(mon.receita.confirmada, canonico.confirmada, 'Monetização')
    assert.equal(mon.receita.informada, 0, 'comissão digitada num vídeo com pedido importado não soma de novo')
    const canais = await R.canaisDeReceita(ws)
    assert.equal(canais.find((x) => x.id === 'shopee')?.comissao, 4, 'canal Shopee só com a dele')
    const produtos = await R.resumoDosProdutos(ws)
    assert.equal(produtos[produto.id].comissao, 10, 'produto soma os dois canais uma vez')
  })

  test('venda manual cancelada: comissão confirmada vira REVERTIDA (com histórico); reativar devolve; concorrência na edição não perde dado', async () => {
    const { ws, userId, produto } = await novoWorkspace('manual')
    const r = await V.registrarResultado({ workspaceId: ws, actorUserId: userId, dataOrigin: 'TEST_FIXTURE', productId: produto.id, status: 'CONFIRMED', amount: 30, expectedCommission: 3 })
    const id = r.commission!.id
    // duas abas confirmando ao mesmo tempo: uma grava, a outra recebe conflito (nada sobrescrito em silêncio)
    const duas = await Promise.allSettled([
      V.atualizarComissao({ workspaceId: ws, commissionId: id, actorUserId: userId, status: 'CONFIRMED', confirmedAmount: 3 }),
      V.atualizarComissao({ workspaceId: ws, commissionId: id, actorUserId: userId, status: 'CONFIRMED', confirmedAmount: 2.5 }),
    ])
    assert.equal(duas.filter((x) => x.status === 'fulfilled').length, 1)
    const rej = duas.find((x) => x.status === 'rejected') as PromiseRejectedResult
    assert.ok(rej.reason instanceof V.ComissaoAlteradaEmParalelo)
    assert.equal(await prisma.historicoDeComissao.count({ where: { commissionId: id, origem: 'MANUAL' } }), 1)
    const confirmada = (await F.resumoFinanceiro(ws)).confirmada

    await V.atualizarStatusVenda({ workspaceId: ws, saleId: r.sale.id, actorUserId: userId, status: 'CANCELLED' })
    assert.equal((await prisma.commission.findUniqueOrThrow({ where: { id } })).status, 'REVERSED')
    let s = await F.resumoFinanceiro(ws)
    assert.deepEqual([s.confirmada, s.revertida], [0, confirmada])
    await V.atualizarStatusVenda({ workspaceId: ws, saleId: r.sale.id, actorUserId: userId, status: 'CONFIRMED' })
    assert.equal((await prisma.commission.findUniqueOrThrow({ where: { id } })).status, 'CONFIRMED')
    s = await F.resumoFinanceiro(ws)
    assert.deepEqual([s.confirmada, s.revertida], [confirmada, 0])
    const h = await prisma.historicoDeComissao.findMany({ where: { commissionId: id }, orderBy: { registradoEm: 'asc' } })
    assert.deepEqual(h.map((x) => x.origem), ['MANUAL', 'VENDA_CANCELADA', 'VENDA_REATIVADA'])
  })

  test('concorrência: duas importações do mesmo arquivo ao mesmo tempo = um pedido, uma comissão, um histórico', async () => {
    const { ws } = await novoWorkspace('concorrencia')
    const linhas = [linha({ pedido: 'J', status: 'Concluído', liq: 'Liquidado', real: 'R$ 8,00' }), linha({ pedido: 'K' })]
    const rs = await Promise.allSettled([importar(ws, linhas, 'j.csv'), importar(ws, linhas, 'j.csv')])
    assert.ok(rs.every((x) => x.status === 'fulfilled'), JSON.stringify(rs.filter((x) => x.status === 'rejected')))
    assert.equal(await prisma.pedidoAfiliadoTikTok.count({ where: { workspaceId: ws } }), 2)
    assert.equal(await prisma.commission.count({ where: { workspaceId: ws } }), 2)
    assert.equal(await prisma.historicoDeComissao.count({ where: { workspaceId: ws } }), 2)
    const s = await F.resumoFinanceiro(ws)
    assert.deepEqual([s.confirmada, s.estimada], [8, 7])
  })
})
