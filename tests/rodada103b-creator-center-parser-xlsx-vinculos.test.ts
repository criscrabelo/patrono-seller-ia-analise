/**
 * P2.19 (2ª parte) — parser flexível (aliases + mapeamento manual + colunas extras guardadas), XLSX sem
 * dependência, auditoria (arquivo original, versão do parser) e vínculos só por identificador único
 * (NAO_VINCULADO / SEM_IDENTIFICADOR, nunca por nome). RECEBIDA separada de LIQUIDADA. Banco de TESTE.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { lerArquivoDoCreatorCenter, lerTabelaDoCreatorCenter, VERSAO_DO_PARSER } from '../lib/creator-center-csv'
import { lerXlsx, ehXlsx, ErroDeXlsx } from '../lib/xlsx-leitor'
import { gerarXlsx } from './_xlsx-de-teste'

const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')
const AGORA = new Date('2026-10-15T12:00:00-03:00')
const CAB_PT = 'ID do pedido;ID do SKU;ID do produto;Nome do produto;Comissão estimada;Comissão real;Status do pedido;Status da liquidação'

describe('parser flexível e XLSX (puro)', () => {
  test('arquivo vazio e só cabeçalho: recusados com mensagem clara; versão do parser sempre informada', () => {
    const v = lerArquivoDoCreatorCenter('')
    assert.equal(v.ok, false); assert.match(v.motivo!, /vazio/); assert.equal(v.versaoDoParser, VERSAO_DO_PARSER)
    const c = lerArquivoDoCreatorCenter(CAB_PT)
    assert.equal(c.ok, false); assert.match(c.motivo!, /só tem o cabeçalho/)
  })
  test('coluna desconhecida: o valor fica guardado no pedido e, se parecer relevante, gera aviso (nunca some em silêncio)', () => {
    const r = lerArquivoDoCreatorCenter(['ID do pedido;Nome do produto;Comissão estimada;Comissão de bônus;Cor', '1;Livro;5,00;1,20;azul'].join('\n'))
    assert.equal(r.ok, true)
    assert.deepEqual(r.colunasIgnoradas, ['Comissão de bônus', 'Cor'])
    assert.deepEqual(r.colunasPossivelmenteRelevantes, ['Comissão de bônus'])
    assert.deepEqual(r.linhas[0].colunasExtras, { 'Comissão de bônus': '1,20', Cor: 'azul' })
    assert.ok(r.avisos.some((a) => /Comissão de bônus.*guardado/.test(a.aviso)))
  })
  test('mapeamento manual: a titular aponta a coluna que o apelido não conhece; coluna inexistente recusa tudo', () => {
    const csv = ['Nº Pedido;Item;Ganho previsto', 'P9;Livro;4,50'].join('\n')
    assert.equal(lerArquivoDoCreatorCenter(csv).ok, false)
    const r = lerArquivoDoCreatorCenter(csv, { mapeamentoManual: { pedidoId: 'Nº Pedido', produtoNome: 'Item', comissaoEstimada: 'Ganho previsto' } })
    assert.equal(r.ok, true); assert.equal(r.linhas[0].pedidoId, 'P9'); assert.equal(r.linhas[0].comissaoEstimada, 4.5)
    const e = lerArquivoDoCreatorCenter(csv, { mapeamentoManual: { pedidoId: 'Não existe' } })
    assert.equal(e.ok, false); assert.match(e.motivo!, /Mapeamento inválido.*Não existe/)
  })
  test('XLSX: 1ª planilha; número fica número (1,234 decimal não vira milhar); data serial do Excel no horário do Brasil; células faltando', () => {
    const buf = gerarXlsx([
      ['ID do pedido', 'Nome do produto', 'Comissão estimada', 'Valor do pedido', 'Data do pedido', 'Status do pedido'],
      ['X1', 'Livro & Cia <ed.>', 1.234, 59.9, 46309.4375, 'Pago'],
      ['X2', 'Caneca', 2.5, null, null, 'Concluído'],
    ])
    assert.equal(ehXlsx(buf), true)
    const t = lerXlsx(buf)
    assert.equal(t[1][1], 'Livro & Cia <ed.>')
    const r = lerTabelaDoCreatorCenter(t)
    assert.equal(r.ok, true)
    // 1,234 continua decimal (não vira 1234); P2.50 (Codex 19): dinheiro entra com 2 casas.
    assert.equal(r.linhas[0].comissaoEstimada, 1.23)
    assert.equal(r.linhas[0].dataPedido!.toISOString(), '2026-10-14T13:30:00.000Z', '46309,4375 = 14/10/2026 10:30 no Brasil')
    assert.equal(r.linhas[1].valorBase, null); assert.equal(r.linhas[1].estado, 'NAO_LIQUIDADA')
  })
  test('XLSX inválido ou disfarçado: erro claro, nada é lido', () => {
    assert.equal(ehXlsx(Buffer.from('ID do pedido;x')), false)
    assert.throws(() => lerXlsx(Buffer.from('PK\u0003\u0004 lixo')), ErroDeXlsx)
  })
})

describe('auditoria e vínculos (banco de TESTE)', { skip: !TEM_BANCO ? 'exige banco de TESTE' : false, timeout: 900_000 }, () => {
  let prisma: typeof import('../lib/prisma').prisma
  let I: typeof import('../lib/creator-center-importacao')
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  const PREFIXO = 'Conta de Teste — '
  const marca = `r103b-${Date.now()}`
  const workspaces: string[] = []
  async function novoWorkspace(nome: string) {
    const ws = (await prisma.workspace.create({ data: { name: `${PREFIXO}${nome} r103b`, ownerId: `${marca}-${nome}` }, select: { id: true } })).id
    workspaces.push(ws)
    const userId = (await prisma.user.create({ data: { email: `${marca}-${workspaces.length}@teste.local`, name: 'U', password: 'x', workspaceId: ws }, select: { id: true } })).id
    return { ws, userId }
  }
  before(async () => {
    ;[{ prisma }, I, { limparWorkspaceDeTeste: limpar }] = await Promise.all([import('../lib/prisma'), import('../lib/creator-center-importacao'), import('./_limpar-workspace-de-teste')])
  })
  after(async () => {
    if (prisma) for (const w of workspaces) await limpar(prisma, w, PREFIXO)
    await prisma?.$disconnect()
  })

  test('XLSX importado: formato, arquivo original (base64), cabeçalho e versão do parser gravados; reenviar = repetida', async () => {
    const { ws } = await novoWorkspace('xlsx')
    const buf = gerarXlsx([['ID do pedido', 'Nome do produto', 'Comissão estimada', 'Extra'], ['Y1', 'Livro', 3.3, 'abc']])
    const r = await I.importarCreatorCenter({ workspaceId: ws, userId: null, nomeArquivo: 'pedidos.xlsx', bytes: buf, dataOrigin: 'TEST_FIXTURE', agora: AGORA })
    assert.equal(r.ok, true); assert.equal(r.formato, 'XLSX'); assert.equal(r.linhasNovas, 1)
    const imp = await prisma.importacaoCreatorCenter.findUniqueOrThrow({ where: { id: r.importacaoId! } })
    assert.equal(imp.formato, 'XLSX')
    assert.equal(Buffer.from(imp.conteudoOriginal!, 'base64').equals(buf), true, 'o arquivo original fica guardado para auditoria')
    assert.deepEqual(imp.cabecalhoOriginal, ['ID do pedido', 'Nome do produto', 'Comissão estimada', 'Extra'])
    assert.equal(imp.versaoDoParser, VERSAO_DO_PARSER)
    const p = await prisma.pedidoAfiliadoTikTok.findFirstOrThrow({ where: { workspaceId: ws } })
    assert.deepEqual(p.colunasExtras, { Extra: 'abc' })
    const de = await I.importarCreatorCenter({ workspaceId: ws, userId: null, nomeArquivo: 'outro.xlsx', bytes: buf, dataOrigin: 'TEST_FIXTURE', agora: AGORA })
    assert.equal(de.repetida, true)
  })

  test('CSV: o texto original fica guardado; o mesmo arquivo com outro mapeamento manual não é "repetida"', async () => {
    const { ws } = await novoWorkspace('csv-original')
    const csv = ['ID do pedido;Nome do produto;Comissão estimada;Ganho real', 'Z1;Livro;3,00;2,90'].join('\n')
    const a = await I.importarCreatorCenter({ workspaceId: ws, userId: null, nomeArquivo: 'a.csv', conteudo: csv, dataOrigin: 'TEST_FIXTURE', agora: AGORA })
    assert.equal((await prisma.importacaoCreatorCenter.findUniqueOrThrow({ where: { id: a.importacaoId! } })).conteudoOriginal, csv)
    const b = await I.importarCreatorCenter({ workspaceId: ws, userId: null, nomeArquivo: 'a.csv', conteudo: csv, mapeamentoManual: { comissaoLiquidada: 'Ganho real' }, dataOrigin: 'TEST_FIXTURE', agora: AGORA })
    assert.equal(b.repetida, undefined)
    assert.notEqual(b.importacaoId, a.importacaoId)
  })

  test('vínculos só por identificador ÚNICO: id duplicado = NAO_VINCULADO; vídeo pelo postId; sem id = SEM_IDENTIFICADOR (nome igual não liga)', async () => {
    const { ws, userId } = await novoWorkspace('vinculos')
    const base = { workspaceId: ws, userId, categoria: 'Livros', origemConteudo: 'manual', tipoVenda: 'afiliado', providerId: 'tiktok-shop' }
    await prisma.produto.create({ data: { ...base, nome: 'A', externalId: '111' } })
    // O banco já impede dois PRODUTOS com o mesmo id; candidatos podem repetir (coletas diferentes): ambíguo.
    for (const n of ['B', 'C']) {
      await prisma.candidatoDeProduto.create({
        data: {
          workspaceId: ws, chaveDeOrigem: `${marca}-${n}`, fonte: 'USER_PROVIDED', nome: `FIXTURE ${n} (ficha duplicada)`, providerId: 'tiktok-shop', externalId: '222',
          score: 50, baseDeEvidencia: 50, confianca: 'SEM_HISTORICO_REAL', status: 'APRESENTADO', coletadoEm: AGORA, validoAte: new Date('2027-01-01'),
          motivosPositivos: [], riscos: [], desconhecidos: [], porqueDestaPosicao: [], nivelDeRisco: 'BAIXO',
        },
      })
    }
    const video = await prisma.videoTikTokResultado.create({ data: { workspaceId: ws, estrutura: 'x', gancho: 'x', cta: 'A', duracaoSegundos: 20, publicadoEm: AGORA, origemMetricas: 'MANUAL', postId: '7550000000000000999' } })
    const cab = 'ID do pedido;ID do produto;Nome do produto;Comissão estimada;ID do conteúdo'
    const r = await I.importarCreatorCenter({
      workspaceId: ws, userId: null, nomeArquivo: 'v.csv', dataOrigin: 'TEST_FIXTURE', agora: AGORA,
      conteudo: [cab, 'V1;111;Livro;1,00;7550000000000000999', 'V2;222;Livro;1,00;7550000000000000123', 'V3;;A;1,00;'].join('\n'),
    })
    assert.equal(r.naoVinculados, 2)
    const ped = Object.fromEntries((await prisma.pedidoAfiliadoTikTok.findMany({ where: { workspaceId: ws } })).map((x) => [x.pedidoId, x]))
    assert.equal(ped.V1.vinculoProduto, 'VINCULADO_POR_ID_EXTERNO'); assert.ok(ped.V1.produtoId)
    assert.equal(ped.V1.vinculoVideo, 'VINCULADO_POR_POST_ID'); assert.equal(ped.V1.videoResultadoId, video.id)
    assert.equal(ped.V2.vinculoProduto, 'NAO_VINCULADO', 'duas fichas com o mesmo id: ambíguo, não liga'); assert.equal(ped.V2.produtoId, null)
    assert.equal(ped.V2.vinculoVideo, 'NAO_VINCULADO')
    assert.equal(ped.V3.vinculoProduto, 'SEM_IDENTIFICADOR', 'o nome "A" é igual ao de um produto, e mesmo assim não liga'); assert.equal(ped.V3.produtoId, null)
    assert.equal(ped.V3.vinculoVideo, 'SEM_IDENTIFICADOR')
    assert.equal((await I.resumoCreatorCenter(ws)).naoVinculados, 2)
  })

  test('RECEBIDA fica separada: liquidada não é dinheiro na conta; só a marcação manual conta como recebida', async () => {
    const { ws } = await novoWorkspace('recebida')
    await I.importarCreatorCenter({ workspaceId: ws, userId: null, nomeArquivo: 'r.csv', dataOrigin: 'TEST_FIXTURE', agora: AGORA, conteudo: [CAB_PT, 'R1;s1;;Livro;R$ 5,50;R$ 5,00;Concluído;Liquidado'].join('\n') })
    let s = await I.resumoCreatorCenter(ws)
    assert.deepEqual([s.liquidada.valor, s.recebida.valor], [5, 0])
    const c = await prisma.commission.findFirstOrThrow({ where: { workspaceId: ws } })
    await prisma.commission.update({ where: { id: c.id }, data: { status: 'RECEIVED', receivedAmount: 5 } })
    s = await I.resumoCreatorCenter(ws)
    assert.deepEqual([s.liquidada.valor, s.recebida.valor, s.receitaConfirmada], [5, 5, 5])
  })
})
