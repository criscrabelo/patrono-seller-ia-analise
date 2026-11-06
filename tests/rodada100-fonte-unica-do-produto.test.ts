/**
 * P2.18.11 — FONTE ÚNICA DE VERDADE DO PRODUTO.
 *
 * Regras que estes testes travam:
 *   - excluir o cadastro tira o produto de TODAS as áreas ativas (Operação, busca, Oportunidades, Torre, Precisa de você, ranking);
 *   - histórico (publicadas, resultados, eventos) continua consultável;
 *   - o sync do catálogo nunca ressuscita o que a titular excluiu;
 *   - restaurar devolve o produto a todas as áreas;
 *   - duas requisições simultâneas não criam duas publicações do mesmo produto;
 *   - RECOMEÇAR OPERAÇÃO deixa o workspace visualmente zerado sem apagar histórico;
 *   - reconciliação corrige só derivado e não deixa contagem divergente.
 * Banco de TESTE; workspaces descartáveis.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { reconciliarCatalogo } from '../lib/catalogo-sync'

const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')

describe('sync do catálogo (puro)', () => {
  const base = { id: 'p1', externalId: 'ext-1', nome: 'Garrafa', preco: 10, removidoDaOrigemEm: null as Date | null }
  test('produto EXCLUÍDO pela titular nunca volta a ativo; os dados da API continuam atualizando', () => {
    const plano = reconciliarCatalogo({ existentes: [{ ...base, status: 'descartado' }] as never, recebidos: [{ externalId: 'ext-1', nome: 'Garrafa nova', preco: 12 }] as never, paginacaoCompleta: true, agora: new Date() })
    assert.equal(plano.reativar.length, 0)
    assert.equal(plano.atualizar.length, 1)
    assert.equal((plano.atualizar[0].campos as { status?: string }).status, undefined, 'o status não é tocado')
    assert.equal(plano.inativar.length, 0)
  })
  test('o que o SYNC tinha inativado (sumiu da origem) volta quando reaparece', () => {
    const plano = reconciliarCatalogo({ existentes: [{ ...base, status: 'inativo', removidoDaOrigemEm: new Date() }] as never, recebidos: [{ externalId: 'ext-1' }] as never, paginacaoCompleta: true, agora: new Date() })
    assert.equal(plano.reativar.length, 1)
  })
})

describe('fonte única do produto (banco de TESTE)', { skip: !TEM_BANCO ? 'exige banco de TESTE' : false, timeout: 900_000 }, () => {
  let prisma: typeof import('../lib/prisma').prisma
  let J: typeof import('../lib/jornada')
  let P: typeof import('../lib/produto-canonico')
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  const PREFIXO = 'Conta de Teste — '
  const marca = `r100-${Date.now()}`
  const workspaces: string[] = []
  const usuarios: Record<string, string> = {}

  async function novoWorkspace(nome: string) {
    const ws = (await prisma.workspace.create({ data: { name: `${PREFIXO}${nome} r100`, ownerId: `${marca}-${nome}` }, select: { id: true } })).id
    workspaces.push(ws)
    usuarios[ws] = (await prisma.user.create({ data: { email: `${marca}-${workspaces.length}@teste.local`, name: 'U', password: 'x', workspaceId: ws }, select: { id: true } })).id
    return ws
  }
  /** Cadastro (Produto) + candidato ligado a ele, como a coleta do catálogo faz. */
  async function produtoComCandidato(ws: string, nome: string, extra: Record<string, unknown> = {}) {
    const n = String(Date.now()).slice(-6) + Math.floor(Math.random() * 1000)
    const ext = `9000000100${n}`
    const produto = await prisma.produto.create({ data: { workspaceId: ws, userId: usuarios[ws], nome: `FIXTURE ${nome}`, categoria: 'Casa', preco: 49.9, origemConteudo: 'MANUAL', tipoVenda: 'AFILIADO', providerId: 'tiktok-shop', externalId: ext, linkProduto: `https://www.tiktok.com/view/product/${ext}` }, select: { id: true } })
    const c = await prisma.candidatoDeProduto.create({
      data: {
        workspaceId: ws, produtoId: produto.id, chaveDeOrigem: `produto:${produto.id}`, fonte: 'CATALOGO', nome: `FIXTURE ${nome}`, categoria: 'Casa', preco: 49.9, providerId: 'tiktok-shop', externalId: ext,
        linkProduto: `https://www.tiktok.com/view/product/${ext}`, score: 60, baseDeEvidencia: 60, confianca: 'SEM_HISTORICO_REAL', status: 'APRESENTADO', posicao: 1, coletadoEm: new Date(), validoAte: new Date('2027-01-01'),
        motivosPositivos: ['Vende bem no app'], riscos: [], desconhecidos: [], porqueDestaPosicao: [], nivelDeRisco: 'BAIXO', ...extra,
      },
      select: { id: true },
    })
    return { produtoId: produto.id, candidatoId: c.id }
  }
  const visao = async (ws: string) => J.visaoDaOperacao(await J.sincronizarOperacao({ workspaceId: ws, userId: usuarios[ws] }))
  const nasAreasAtivas = async (ws: string, candidatoId: string) => {
    const [v, busca, apresentados, torre, central] = await Promise.all([
      visao(ws),
      J.buscarProdutosParaEscolher(ws, ''),
      import('../lib/curadoria').then((m) => m.listarApresentados(ws)),
      prisma.candidatoDeProduto.count({ where: { workspaceId: ws, id: candidatoId, status: { in: ['NOVO', 'APRESENTADO'] }, AND: [P.CANDIDATO_NAO_EXCLUIDO] } }),
      import('../lib/precisa-de-voce-central').then((m) => m.centralPrecisaDeVoce(ws)),
    ])
    return {
      operacao: v.prioritaria?.candidatoId === candidatoId || v.outras.some((o) => o.candidatoId === candidatoId),
      busca: busca.some((p) => p.candidatoId === candidatoId),
      oportunidades: apresentados.some((c) => c.id === candidatoId),
      torre: torre > 0,
      central: central.some((p) => p.id.includes(candidatoId) || !!p.assistida && p.assistida.nomeProduto.includes('Garrafa')),
    }
  }

  before(async () => {
    ;[{ prisma }, J, P, { limparWorkspaceDeTeste: limpar }] = await Promise.all([import('../lib/prisma'), import('../lib/jornada'), import('../lib/produto-canonico'), import('./_limpar-workspace-de-teste')])
  })
  after(async () => {
    if (prisma) {
      await prisma.domainEvent.deleteMany({ where: { workspaceId: { in: workspaces } } }).catch(() => null)
      await prisma.decisionRecord.deleteMany({ where: { workspaceId: { in: workspaces } } }).catch(() => null)
      for (const w of workspaces) await limpar(prisma, w, PREFIXO)
    }
    await prisma?.$disconnect()
  })

  test('criar → aparece; excluir → some de TODAS as áreas ativas; refresh não ressuscita; restaurar → volta', async () => {
    const ws = await novoWorkspace('exclusao')
    const { produtoId, candidatoId } = await produtoComCandidato(ws, 'Garrafa')
    let onde = await nasAreasAtivas(ws, candidatoId)
    assert.deepEqual({ operacao: onde.operacao, busca: onde.busca, oportunidades: onde.oportunidades, torre: onde.torre }, { operacao: true, busca: true, oportunidades: true, torre: true }, 'criado: aparece')
    // escolhido em mãos: a jornada abre e prepara a publicação
    await J.escolherProduto({ workspaceId: ws, userId: usuarios[ws], candidatoId, emMaos: true })
    assert.equal(await prisma.publicacaoAssistida.count({ where: { workspaceId: ws, candidatoId, estado: { not: 'REJEITADO' } } }), 1)

    const efeito = await P.excluirProduto({ workspaceId: ws, userId: usuarios[ws], produtoId })
    assert.deepEqual({ produtos: efeito!.produtos, candidatos: efeito!.candidatos, publicacoes: efeito!.publicacoesEncerradas }, { produtos: 1, candidatos: 1, publicacoes: 1 })
    for (let i = 0; i < 2; i++) {
      onde = await nasAreasAtivas(ws, candidatoId)
      assert.deepEqual(onde, { operacao: false, busca: false, oportunidades: false, torre: false, central: false }, `excluído: some de tudo (refresh ${i + 1})`)
    }
    // histórico continua
    assert.equal(await prisma.publicacaoAssistida.count({ where: { workspaceId: ws, candidatoId } }), 1, 'a publicação fica no histórico (encerrada)')
    assert.ok(await prisma.domainEvent.findFirst({ where: { workspaceId: ws, tipo: 'PRODUCT_ARCHIVED', entidadeId: produtoId } }))
    assert.ok(await prisma.domainEvent.findFirst({ where: { workspaceId: ws, entidadeId: candidatoId, tipo: 'PRODUCT_CHOSEN' } }), 'eventos da jornada ficam')
    // excluir de novo: idempotente
    const de_novo = await P.excluirProduto({ workspaceId: ws, userId: usuarios[ws], produtoId })
    assert.deepEqual(de_novo, { produtos: 0, candidatos: 0, publicacoesEncerradas: 0, publicacoesParaConferir: 0, amostrasCanceladas: 0, pedidosCancelados: 0 })
    // a coleta não traz de volta
    const { reconciliarEstadoDoWorkspace } = P
    const r = await reconciliarEstadoDoWorkspace(ws)
    assert.equal(r.candidatosDeProdutoExcluido + r.publicacoesDeProdutoInativo + r.amostrasDeProdutoInativo + r.pedidosDeProdutoInativo, 0, 'nada a reconciliar')
    assert.deepEqual(r.contagens, { produtosAtivos: 0, produtosInativos: 0, produtosExcluidos: 1, candidatosAtivos: 0 })

    const rest = await P.restaurarProduto({ workspaceId: ws, userId: usuarios[ws], produtoId })
    assert.equal(rest!.candidatosRestaurados, 1)
    assert.equal((await prisma.produto.findUniqueOrThrow({ where: { id: produtoId } })).status, 'ativo')
    assert.equal((await prisma.candidatoDeProduto.findUniqueOrThrow({ where: { id: candidatoId } })).status, 'APRESENTADO', 'volta ao status de antes')
    onde = await nasAreasAtivas(ws, candidatoId)
    assert.ok(onde.operacao && onde.busca && onde.oportunidades && onde.torre, 'restaurado: volta a todas as áreas')
  })

  test('exclusão ANTIGA (só o cadastro marcado): as telas já escondem e a reconciliação corrige o derivado', async () => {
    const ws = await novoWorkspace('legado')
    const { produtoId, candidatoId } = await produtoComCandidato(ws, 'Bolsa')
    await prisma.produto.update({ where: { id: produtoId }, data: { status: 'descartado' } }) // como a rota antiga fazia
    const onde = await nasAreasAtivas(ws, candidatoId)
    assert.deepEqual({ operacao: onde.operacao, busca: onde.busca, oportunidades: onde.oportunidades, torre: onde.torre }, { operacao: false, busca: false, oportunidades: false, torre: false }, 'mesmo antes da reconciliação')
    const antes = await P.reconciliarEstadoDoWorkspace(ws)
    assert.equal(antes.candidatosDeProdutoExcluido, 1)
    await P.reconciliarEstadoDoWorkspace(ws, { aplicar: true })
    assert.equal((await prisma.candidatoDeProduto.findUniqueOrThrow({ where: { id: candidatoId } })).status, 'DESCARTADO')
    assert.equal((await P.reconciliarEstadoDoWorkspace(ws)).candidatosDeProdutoExcluido, 0, 'depois: nada divergente')
    assert.ok(await prisma.domainEvent.findFirst({ where: { workspaceId: ws, tipo: 'STATE_RECONCILED' } }), 'a correção fica no livro')
  })

  test('ranking (motor): produto excluído pela titular nunca entra', async () => {
    const ws = await novoWorkspace('ranking')
    const a = await produtoComCandidato(ws, 'Ativo')
    const b = await produtoComCandidato(ws, 'Excluido')
    const c = await produtoComCandidato(ws, 'ForaDaOrigem')
    await P.excluirProduto({ workspaceId: ws, userId: usuarios[ws], produtoId: b.produtoId })
    await prisma.produto.update({ where: { id: c.produtoId }, data: { status: 'inativo' } })
    const { montarFilaComProdutos } = await import('../lib/motor-de-oportunidades')
    const { obterPerfilDaLoja } = await import('../lib/perfil-da-loja')
    const { perfil } = await obterPerfilDaLoja(ws, { criarSeAusente: true })
    const { produtos } = await montarFilaComProdutos({ workspaceId: ws, agora: new Date(), canaisCapazes: [], perfil })
    assert.deepEqual(produtos.map((p) => p.id).sort(), [a.produtoId, c.produtoId].sort(), 'excluído fica fora; inativo entra (como NAO_ELEGIVEL, pela regra do motor)')
  })

  test('duas abas confirmando o MESMO produto ao mesmo tempo: uma publicação só', async () => {
    const ws = await novoWorkspace('concorrencia')
    const { candidatoId } = await produtoComCandidato(ws, 'Garrafa')
    const t = new Date()
    const rs = await Promise.allSettled([
      J.escolherProduto({ workspaceId: ws, userId: usuarios[ws], candidatoId, emMaos: true, agora: t }),
      J.escolherProduto({ workspaceId: ws, userId: usuarios[ws], candidatoId, emMaos: true, agora: t }),
      J.escolherProduto({ workspaceId: ws, userId: usuarios[ws], candidatoId, emMaos: true, agora: t }),
    ])
    assert.ok(rs.every((r) => r.status === 'fulfilled'), `nenhuma aba dá erro: ${rs.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason?.stack ?? (r as PromiseRejectedResult).reason).slice(0, 600)).join(' | ')}`)
    assert.equal(await prisma.publicacaoAssistida.count({ where: { workspaceId: ws, candidatoId } }), 1, 'uma publicação')
    for (const tipo of ['PRODUCT_CHOSEN', 'JOURNEY_STARTED', 'PRODUCT_IN_HAND']) assert.equal(await prisma.domainEvent.count({ where: { workspaceId: ws, entidadeId: candidatoId, tipo } }), 1, tipo)
    assert.equal(await prisma.decisionRecord.count({ where: { workspaceId: ws, entidadeId: candidatoId } }), 1, 'uma decisão')
  })

  test('RECOMEÇAR OPERAÇÃO: workspace visualmente zerado; histórico, usuário e configuração ficam; restaurar um produto depois funciona', async () => {
    const ws = await novoWorkspace('recomeco')
    const a = await produtoComCandidato(ws, 'Garrafa')
    const b = await produtoComCandidato(ws, 'Bolsa', { status: 'NOVO', posicao: null })
    await J.escolherProduto({ workspaceId: ws, userId: usuarios[ws], candidatoId: a.candidatoId, emMaos: true })
    await prisma.featureFlag.create({ data: { chave: 'CENTRAL_OPERACIONAL', escopo: ws, ligada: true, motivo: 'r100' } })
    const r = await P.recomecarOperacao({ workspaceId: ws, userId: usuarios[ws] })
    assert.equal(r.produtos, 2)
    assert.equal(r.candidatos, 2)
    assert.equal(r.publicacoesEncerradas, 1)
    const v = await visao(ws)
    assert.equal(v.prioritaria, null, 'Operação vazia')
    assert.equal(v.outras.length, 0)
    assert.equal((await J.buscarProdutosParaEscolher(ws, '')).length, 0, 'busca vazia')
    const { centralPrecisaDeVoce } = await import('../lib/precisa-de-voce-central')
    assert.ok(!(await centralPrecisaDeVoce(ws)).some((p) => p.origem !== 'INTEGRACAO'), 'Precisa de você só com integrações futuras (nada operacional)')
    const rec = await P.reconciliarEstadoDoWorkspace(ws)
    assert.deepEqual(rec.contagens, { produtosAtivos: 0, produtosInativos: 0, produtosExcluidos: 2, candidatosAtivos: 0 })
    // fica
    assert.ok(await prisma.user.findUnique({ where: { id: usuarios[ws] } }))
    assert.ok(await prisma.featureFlag.findFirst({ where: { escopo: ws, chave: 'CENTRAL_OPERACIONAL', ligada: true } }))
    assert.equal(await prisma.publicacaoAssistida.count({ where: { workspaceId: ws } }), 1, 'histórico da publicação fica')
    assert.ok(await prisma.domainEvent.findFirst({ where: { workspaceId: ws, tipo: 'OPERATION_RESET' } }))
    // restaurar um produto depois do recomeço
    await P.restaurarProduto({ workspaceId: ws, userId: usuarios[ws], produtoId: b.produtoId })
    assert.equal((await prisma.candidatoDeProduto.findUniqueOrThrow({ where: { id: b.candidatoId } })).status, 'NOVO')
    assert.ok((await J.buscarProdutosParaEscolher(ws, 'bolsa')).some((p) => p.candidatoId === b.candidatoId))
  })
})
