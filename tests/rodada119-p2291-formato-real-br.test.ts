/**
 * P2.29.1 — P2.19, GATE A: FORMATO REAL DO EXPORT DO CREATOR CENTER BRASIL.
 *
 * Base: o arquivo real exportado pela titular (affiliate_orders_<id>.xlsx: XLSX, 1 planilha, 48 colunas em PT-BR,
 * 1 pedido "Inelegível"). O arquivo real NUNCA entra no repositório: o teste o lê de
 * %LOCALAPPDATA%\PatronoSeller\csv-real\ quando existe (senão, essa parte é pulada). As linhas sintéticas abaixo
 * usam o CABEÇALHO REAL (exatamente como veio) e só os formatos vistos nele; os IDs são fictícios.
 *
 * NÃO valida (Gate B, primeiro pedido elegível real): comissão real/estimada de pedido elegível, transição entre
 * estados financeiros, data de liquidação, moeda/SKU de pedido elegível, vínculo com vídeo/postId, soma do período,
 * reembolso real.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { lerXlsx } from '../lib/xlsx-leitor'
import { lerTabelaDoCreatorCenter, VERSAO_DO_PARSER } from '../lib/creator-center-csv'
import { gerarXlsx } from './_xlsx-de-teste'

const RAIZ = join(__dirname, '..')
const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')
const PASTA_REAL = join(process.env.LOCALAPPDATA ?? '', 'PatronoSeller', 'csv-real')
const ARQUIVO_REAL = existsSync(PASTA_REAL) ? readdirSync(PASTA_REAL).filter((f) => /^affiliate_orders_.*\.xlsx$/i.test(f)).map((f) => join(PASTA_REAL, f))[0] : undefined

/** Cabeçalho REAL do export BR, na ordem em que veio (inclusive as quebras de linha que o TikTok põe em 2 colunas). */
export const CABECALHO_REAL_BR = [
  'ID do pedido', 'ID do SKU', 'Nome do produto', 'ID do produto', 'Preço', 'Itens vendidos', 'Itens reembolsados', 'Nome da loja', 'Código da loja',
  'Agência parceira', 'Agência', 'Moeda', 'Tipo de pedido', 'Status de liquidação do pedido', 'Indireta', 'Tipo de comissão', 'Tipo de conteúdo', 'Carrossel',
  'ID do conteúdo', 'Padrão', 'Anúncios da loja', 'Bônus do TikTok', 'Bônus do parceiro', 'Participação na receita\n\n', 'GMV', 'Base de comissão estimada',
  'Comissão padrão estimada', 'Comissão estimada de anúncios da loja', 'Bônus estimado', 'Bônus estimado da agência parceira', 'IVA estimado', 'ISR estimado',
  'Est. CedularTax', 'PIT estimado', 'Estimativa da participação na receita\n\n', 'Base de comissão real', 'Comissão padrão', 'Comissão de anúncios da loja',
  'Bônus', 'Bônus da agência parceira', 'Imposto - ISR', 'Imposto - IVA', 'cedular_tax', 'Imposto - PIT', 'Compartilhado com parceiro', 'Valor total final recebido',
  'Data do pedido', 'Data de liquidação da comissão',
]
/** Uma linha com os formatos do arquivo real (vírgula decimal no dinheiro, ponto na taxa, "/" sem data). IDs fictícios. */
const linhaComoAReal = (o: Partial<Record<string, string>> = {}) => CABECALHO_REAL_BR.map((h) => ({
  'ID do pedido': '900000000000000001', 'ID do SKU': '900000000000000002', 'Nome do produto': 'FIXTURE produto', 'ID do produto': '900000000000000003', 'Preço': '26,99',
  'Itens vendidos': '5', 'Itens reembolsados': '0', 'Nome da loja': 'FIXTURE loja', 'Código da loja': 'BRLFIXTURE', 'Moeda': 'BRL', 'Tipo de pedido': 'Pedido de anúncios da loja',
  'Status de liquidação do pedido': 'Inelegível', 'Tipo de comissão': 'Mesma taxa para todos os pedidos', 'Tipo de conteúdo': 'Vitrine', 'ID do conteúdo': '900000000000000004',
  'Padrão': '9.5%', 'GMV': '149,25', 'Base de comissão estimada': '134,95', 'Comissão padrão estimada': '12,80', 'Base de comissão real': '0,00', 'Comissão padrão': '0,00',
  'Valor total final recebido': '0,00', 'Data do pedido': '02/08/2026 16:18:35', 'Data de liquidação da comissão': '/',
  ...o,
} as Record<string, string>)[h] ?? '')

describe('P2.19 Gate A — formato real BR (sem banco)', () => {
  test('o ARQUIVO REAL (se presente nesta máquina): XLSX, 1 planilha, 48 colunas = o cabeçalho deste teste, 1 pedido Inelegível → CANCELADA, sem receita nem previsão, sem crash', { skip: !ARQUIVO_REAL ? 'arquivo real ausente (fica fora do repositório)' : false }, () => {
    const tabela = lerXlsx(readFileSync(ARQUIVO_REAL!))
    assert.deepEqual(tabela[0].map(String), CABECALHO_REAL_BR, 'nomes e ORDEM das colunas iguais aos do arquivo real')
    assert.equal(tabela.length, 2)
    const r = lerTabelaDoCreatorCenter(tabela)
    assert.equal(r.ok, true, r.motivo)
    assert.equal(r.versaoDoParser, VERSAO_DO_PARSER)
    assert.deepEqual(r.colunasPossivelmenteRelevantes, [], 'nenhuma coluna real fica como "desconhecida"')
    assert.equal(r.linhas.length, 1)
    const l = r.linhas[0]
    assert.equal(l.estado, 'CANCELADA')
    assert.equal(l.statusOriginal, 'Inelegível', 'o texto real do status fica guardado')
    assert.equal(l.comissaoLiquidada, 0)
    assert.equal(l.dataLiquidacao, null, '"/" = sem data')
    assert.ok(/^\d+$/.test(l.pedidoId) && l.pedidoId.length >= 18, 'ID do pedido longo preservado como texto (sem notação científica)')
    assert.equal(l.colunasExtras?.Moeda, 'BRL')
  })

  test('mapeamento do cabeçalho real: as colunas que o Patrono usa', () => {
    const r = lerTabelaDoCreatorCenter([CABECALHO_REAL_BR, linhaComoAReal()])
    assert.equal(r.ok, true, r.motivo)
    assert.deepEqual(r.mapeamento, {
      pedidoId: 'ID do pedido', skuId: 'ID do SKU', produtoIdExterno: 'ID do produto', produtoNome: 'Nome do produto', lojaNome: 'Nome da loja',
      quantidade: 'Itens vendidos', valorBase: 'Base de comissão estimada', taxaComissao: 'Padrão', comissaoEstimada: 'Comissão padrão estimada',
      comissaoLiquidada: 'Valor total final recebido', statusLiquidacao: 'Status de liquidação do pedido', dataPedido: 'Data do pedido',
      dataLiquidacao: 'Data de liquidação da comissão', tipoConteudo: 'Tipo de conteúdo', conteudoIdExterno: 'ID do conteúdo',
    })
    assert.deepEqual(r.colunasPossivelmenteRelevantes, [])
    const l = r.linhas[0]
    assert.deepEqual([l.quantidade, l.valorBase, l.taxaComissao, l.tipoConteudo], [5, 134.95, 0.095, 'VITRINE'], 'vírgula decimal no dinheiro, ponto na taxa')
    assert.equal(l.dataPedido!.toISOString(), '2026-08-02T19:18:35.000Z', 'DD/MM/AAAA HH:MM:SS no horário do Brasil (dia/mês a confirmar com o app)')
  })

  test('"Inelegível" nunca vira receita nem previsão (antes do Gate A seria "status desconhecido → estimada")', () => {
    const l = lerTabelaDoCreatorCenter([CABECALHO_REAL_BR, linhaComoAReal()]).linhas[0]
    assert.equal(l.estado, 'CANCELADA')
    assert.equal(l.comissaoEstimada, 12.8, 'o valor do arquivo fica guardado')
    assert.equal(l.comissaoLiquidada, 0)
  })

  test('relatório vazio (só o cabeçalho real, XLSX): recusa clara, nada é gravado', () => {
    const r = lerTabelaDoCreatorCenter(lerXlsx(gerarXlsx([CABECALHO_REAL_BR])))
    assert.equal(r.ok, false)
    assert.match(r.motivo ?? '', /só tem o cabeçalho/)
  })

  test('moeda diferente de BRL: a linha não entra (nunca converte); componente de comissão com valor: aviso (não é somado sem o Gate B)', () => {
    const r = lerTabelaDoCreatorCenter([CABECALHO_REAL_BR,
      linhaComoAReal({ 'ID do pedido': '900000000000000011', 'Moeda': 'USD' }),
      linhaComoAReal({ 'ID do pedido': '900000000000000012', 'Comissão estimada de anúncios da loja': '3,10' }),
    ])
    assert.deepEqual(r.rejeitadas.map((x) => x.motivo), ['moeda USD: o Patrono só importa valores em reais (BRL)'])
    assert.equal(r.linhas.length, 1)
    assert.ok(r.avisos.some((a) => /"Comissão estimada de anúncios da loja" = 3,10: valor guardado, ainda não somado/.test(a.aviso)))
  })

  test('coluna nova que o TikTok venha a acrescentar continua sendo apontada (as 48 conhecidas não)', () => {
    const r = lerTabelaDoCreatorCenter([[...CABECALHO_REAL_BR, 'Comissão de afiliado nova'], [...linhaComoAReal(), '1,00']])
    assert.deepEqual(r.colunasPossivelmenteRelevantes, ['Comissão de afiliado nova'])
  })

  test('Gate B fica fechado em código: a importação financeira só roda com a flag IMPORTACAO_CREATOR_CENTER (padrão: desligada)', async () => {
    const { FLAGS, resolverFlag } = await import('../lib/feature-flags')
    assert.ok('IMPORTACAO_CREATOR_CENTER' in FLAGS)
    assert.equal(resolverFlag({}), false, 'sem decisão, desligada')
    const rota = readFileSync(join(RAIZ, 'app/api/comissoes/creator-center/route.ts'), 'utf8')
    const post = rota.slice(rota.indexOf('export async function POST'))
    assert.ok(post.indexOf("flagLigada('IMPORTACAO_CREATOR_CENTER'") > 0 && post.indexOf("flagLigada('IMPORTACAO_CREATOR_CENTER'") < post.indexOf('importarCreatorCenter('), 'a flag é conferida ANTES de importar')
    assert.match(post, /status: 403/)
    const tela = readFileSync(join(RAIZ, 'components/importar-creator-center.tsx'), 'utf8')
    assert.match(tela, /importacaoAtiva === false/)
  })
})

describe('P2.19 Gate A — importador com o arquivo real (banco de TESTE)', { skip: !TEM_BANCO }, () => {
  let prisma: typeof import('../lib/prisma')['prisma']
  let I: typeof import('../lib/creator-center-importacao')
  let F: typeof import('../lib/financeiro')
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  const PREFIXO = 'Conta de Teste — '
  const contas: string[] = []
  before(async () => {
    ;[{ prisma }, I, F, { limparWorkspaceDeTeste: limpar }] = await Promise.all([import('../lib/prisma'), import('../lib/creator-center-importacao'), import('../lib/financeiro'), import('./_limpar-workspace-de-teste')])
  })
  after(async () => {
    if (prisma) for (const w of contas) await limpar(prisma, w, PREFIXO)
    await prisma?.$disconnect()
  })
  async function conta(nome: string) {
    const { criarUsuarioComWorkspace } = await import('../lib/workspace')
    const r = await criarUsuarioComWorkspace(prisma, { email: `r119-${Date.now()}-${nome}@teste.local`, password: 'x', name: `${PREFIXO}${nome} r119` })
    await prisma.workspace.update({ where: { id: r.workspace.id }, data: { name: `${PREFIXO}${nome} r119` } })
    contas.push(r.workspace.id)
    return r
  }

  test('o arquivo real (XLSX, bytes como vieram): importa 1 pedido CANCELADO, sem receita nem previsão, sem vínculo inventado; reenviar = repetida, nada duplica', { skip: !ARQUIVO_REAL ? 'arquivo real ausente' : false }, async () => {
    const { workspace, user } = await conta('real')
    const bytes = readFileSync(ARQUIVO_REAL!)
    const r = await I.importarCreatorCenter({ workspaceId: workspace.id, userId: user.id, nomeArquivo: 'affiliate_orders_real.xlsx', bytes, dataOrigin: 'USER_REPORTED' })
    assert.equal(r.ok, true, r.motivo)
    assert.equal(r.formato, 'XLSX')
    assert.deepEqual([r.linhasNovas, r.linhasRejeitadas], [1, 0])
    const p = await prisma.pedidoAfiliadoTikTok.findFirstOrThrow({ where: { workspaceId: workspace.id } })
    assert.equal(p.estado, 'CANCELADA')
    assert.equal(p.statusOriginal, 'Inelegível')
    assert.equal(p.vinculoProduto, 'NAO_VINCULADO', 'sem produto com esse ID na conta: nunca liga por nome')
    assert.equal(p.vinculoVideo, 'NAO_VINCULADO')
    const s = await F.resumoFinanceiro(workspace.id)
    assert.equal(s.confirmada, 0)
    assert.equal(s.previsao, 0, 'inelegível não entra na previsão')
    const sit = await I.situacaoDaImportacao(workspace.id, r.importacaoId!)
    assert.ok(sit && sit.situacao !== 'INCOMPLETA')
    const de_novo = await I.importarCreatorCenter({ workspaceId: workspace.id, userId: user.id, nomeArquivo: 'affiliate_orders_real.xlsx', bytes, dataOrigin: 'USER_REPORTED' })
    assert.equal(de_novo.repetida, true)
    assert.equal(await prisma.pedidoAfiliadoTikTok.count({ where: { workspaceId: workspace.id } }), 1)
    assert.equal(await prisma.importacaoCreatorCenter.count({ where: { workspaceId: workspace.id } }), 1)
  })

  test('relatório vazio (cabeçalho real, XLSX): nenhuma importação, nenhum pedido', async () => {
    const { workspace, user } = await conta('vazio')
    const r = await I.importarCreatorCenter({ workspaceId: workspace.id, userId: user.id, nomeArquivo: 'vazio.xlsx', bytes: gerarXlsx([CABECALHO_REAL_BR]), dataOrigin: 'USER_REPORTED' })
    assert.equal(r.ok, false)
    assert.match(r.motivo ?? '', /só tem o cabeçalho/)
    assert.equal(await prisma.importacaoCreatorCenter.count({ where: { workspaceId: workspace.id } }), 0)
    assert.equal(await prisma.pedidoAfiliadoTikTok.count({ where: { workspaceId: workspace.id } }), 0)
  })
})
