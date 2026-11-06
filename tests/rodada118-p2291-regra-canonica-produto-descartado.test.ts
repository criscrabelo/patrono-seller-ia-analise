/**
 * P2.29.1 — REGRA CANÔNICA DO PRODUTO DESCARTADO OU EXCLUÍDO (aprovada pela titular).
 *
 * Descartar/excluir = decisão de não continuar: encerra sozinho (com histórico) o que é CERTO que não saiu; o que
 * PODE já estar no TikTok (PUBLICANDO, ENVIO INCERTO, Publicacao distribuída) fica e vai para "Precisa de você"
 * com a orientação; PUBLICADO, resultados, vendas, pedidos, comissões, histórico e aprendizado nunca mudam.
 * Uma função só (encerrarProdutoDescartado) para excluir, NÃO QUERO, curadoria/coleta e reconciliação. Banco de TESTE.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = join(__dirname, '..')
const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')
const ORIENTACAO = 'Confirme se este conteúdo apareceu no TikTok antes de encerrar ou tentar novamente.'

describe('P2.29.1 — uma regra só (estático)', () => {
  test('nenhuma outra área encerra publicação de produto inativo por conta própria', () => {
    const arquivos: string[] = []
    const andar = (d: string) => { for (const e of readdirSync(join(RAIZ, d), { withFileTypes: true })) { if (e.isDirectory()) andar(`${d}/${e.name}`); else if (/\.tsx?$/.test(e.name)) arquivos.push(`${d}/${e.name}`) } }
    andar('lib'); andar('app')
    const comMarca = arquivos.filter((f) => readFileSync(join(RAIZ, f), 'utf8').includes("acao: 'ENCERRADA_PRODUTO_INATIVO'"))
    assert.deepEqual(comMarca, ['lib/produto-canonico.ts'], 'o encerramento por produto inativo só existe na função canônica')
    const canon = readFileSync(join(RAIZ, 'lib/produto-canonico.ts'), 'utf8')
    assert.doesNotMatch(canon, /encerrarDerivados/)
    assert.equal(canon.match(/encerrarProdutoDescartado\(tx/g)?.length, 6, 'a definição + excluirProduto, excluirCandidato, reconciliação, recomeço e recusa da titular')
    assert.match(readFileSync(join(RAIZ, 'lib/curadoria.ts'), 'utf8'), /encerrarProdutoDescartado\(tx, params\.workspaceId/)
    assert.match(readFileSync(join(RAIZ, 'lib/jornada.ts'), 'utf8'), /encerrarPorRecusaDaTitular/)
    assert.match(readFileSync(join(RAIZ, 'lib/reconciliacao.ts'), 'utf8'), /publicacoesParaConferirDeProdutoInativo/)
    assert.ok(canon.includes(ORIENTACAO))
  })
})

describe('P2.29.1 — regra canônica (banco de TESTE)', { skip: !TEM_BANCO, timeout: 900_000 }, () => {
  let prisma: typeof import('../lib/prisma')['prisma']
  let P: typeof import('../lib/produto-canonico')
  let Cu: typeof import('../lib/curadoria')
  let J: typeof import('../lib/jornada')
  let R: typeof import('../lib/reconciliacao')
  let C: typeof import('../lib/precisa-de-voce-central')
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  const PREFIXO = 'Conta de Teste — '
  const marca = `r118-${Date.now()}`
  const contas: string[] = []
  before(async () => {
    ;[{ prisma }, P, Cu, J, R, C, { limparWorkspaceDeTeste: limpar }] = await Promise.all([import('../lib/prisma'), import('../lib/produto-canonico'), import('../lib/curadoria'), import('../lib/jornada'), import('../lib/reconciliacao'), import('../lib/precisa-de-voce-central'), import('./_limpar-workspace-de-teste')])
  })
  after(async () => {
    if (prisma) for (const w of contas) {
      await prisma.execucaoDoProcessador.deleteMany({ where: { workspaceId: w } })
      await prisma.domainEvent.deleteMany({ where: { workspaceId: w } }).catch(() => null)
      await prisma.decisionRecord.deleteMany({ where: { workspaceId: w } }).catch(() => null)
      await limpar(prisma, w, PREFIXO)
    }
    await prisma?.$disconnect()
  })

  let seq = 0
  async function conta(nome: string) {
    const { criarUsuarioComWorkspace } = await import('../lib/workspace')
    const r = await criarUsuarioComWorkspace(prisma, { email: `${marca}-${nome}@teste.local`, password: 'x', name: `${PREFIXO}${nome} r118` })
    await prisma.workspace.update({ where: { id: r.workspace.id }, data: { name: `${PREFIXO}${nome} r118` } })
    contas.push(r.workspace.id)
    return { ws: r.workspace.id, userId: r.user.id }
  }
  async function produto(ws: string, userId: string, nome: string, status: 'NOVO' | 'APRESENTADO' | 'ESCOLHIDO' = 'APRESENTADO') {
    const ext = `9118${Date.now() % 1_000_000}${++seq}`
    const p = await prisma.produto.create({ data: { workspaceId: ws, userId, nome: `FIXTURE ${nome}`, categoria: 'Casa', origemConteudo: 'manual', tipoVenda: 'afiliado', providerId: 'tiktok-shop', externalId: ext } })
    const c = await prisma.candidatoDeProduto.create({ data: {
      workspaceId: ws, produtoId: p.id, chaveDeOrigem: `${marca}-${ext}`, fonte: 'USER_PROVIDED', nome: `FIXTURE ${nome}`, categoria: 'Moda', preco: 99.9, comissaoValor: 12, vendas: 1500, providerId: 'tiktok-shop', externalId: ext,
      linkProduto: `https://www.tiktok.com/view/product/${ext}`, score: 60, baseDeEvidencia: 60, confianca: 'SEM_HISTORICO_REAL', status, coletadoEm: new Date(), validoAte: new Date('2027-01-01'),
      motivosPositivos: ['Vende bem no app'], riscos: [], desconhecidos: [], porqueDestaPosicao: [], nivelDeRisco: 'BAIXO' } as never })
    return { produtoId: p.id, candidatoId: c.id }
  }
  async function assistida(ws: string, candidatoId: string, estado: string, extra: Record<string, unknown> = {}) {
    return prisma.publicacaoAssistida.create({ data: { workspaceId: ws, candidatoId, estado, nomeProduto: 'FIXTURE r118', varianteId: 'v', estrutura: 'DEMONSTRACAO',
      apresentacao: { produto: { nome: 'FIXTURE r118', categoria: 'Casa' }, versao: { estrutura: 'DEMONSTRACAO', gancho: 'g', cta: 'Comente', duracaoSegundos: 20 }, video: { situacao: 'GERADO' } }, qualityGate: {}, motivoEscolha: 't', objetivoDoTeste: 't', historico: [], ...extra } as never })
  }
  const estado = async (id: string) => prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id } })
  const encerrada = async (id: string, antes: string) => {
    const a = await estado(id)
    assert.equal(a.estado, 'REJEITADO', `${antes} → REJEITADO`)
    assert.ok(P.encerradaPorProdutoInativo(a))
    const h = (a.historico as { acao: string; estadoAnterior?: string }[]).filter((x) => x.acao === 'ENCERRADA_PRODUTO_INATIVO')
    assert.equal(h.length, 1, 'um registro no histórico')
    assert.equal(h[0].estadoAnterior, antes, 'com o estado anterior')
  }

  test('1. excluir antes de gerar: cadastro e candidato saem, amostra aberta cancelada só no Patrono, pedido de escolha cancelado; nenhuma publicação criada', async () => {
    const { ws, userId } = await conta('excluir-antes')
    const { produtoId, candidatoId } = await produto(ws, userId, 'Garrafa')
    const amostra = await prisma.amostraTikTokShop.create({ data: { workspaceId: ws, chave: `${marca}-a1`, candidatoId, nomeProduto: 'FIXTURE Garrafa', estado: 'SOLICITADA', solicitadaEm: new Date() } as never })
    const r = await P.excluirProduto({ workspaceId: ws, userId, produtoId })
    assert.equal(r!.produtos, 1)
    assert.equal((await prisma.candidatoDeProduto.findUniqueOrThrow({ where: { id: candidatoId } })).status, 'DESCARTADO')
    assert.equal((await prisma.amostraTikTokShop.findUniqueOrThrow({ where: { id: amostra.id } })).estado, 'CANCELADA')
    assert.equal(await prisma.publicacaoAssistida.count({ where: { workspaceId: ws } }), 0)
  })

  test('2. NÃO QUERO antes de gerar (pela Jornada): candidato descartado, a jornada encerra e nada fica pendente', async () => {
    const { ws, userId } = await conta('naoquero-antes')
    const { candidatoId } = await produto(ws, userId, 'Bolsa')
    await J.sincronizarOperacao({ workspaceId: ws, userId })
    await J.responderNaJornada({ workspaceId: ws, userId, candidatoId, resposta: 'NAO_QUERO' })
    assert.equal((await prisma.candidatoDeProduto.findUniqueOrThrow({ where: { id: candidatoId } })).status, 'DESCARTADO')
    assert.equal(await prisma.publicacaoAssistida.count({ where: { workspaceId: ws, candidatoId, estado: { notIn: ['REJEITADO', 'PUBLICADO'] } } }), 0)
  })

  test('3–6. em geração, aguardando aprovação, aprovado sem envio e falha sem envio: encerradas com histórico (excluir e NÃO QUERO usam a mesma regra)', async () => {
    const { ws, userId } = await conta('certos')
    const a = await produto(ws, userId, 'Luminária')
    const geracao = await assistida(ws, a.candidatoId, 'GERANDO_VIDEO')
    const aprovacao = await assistida(ws, a.candidatoId, 'AGUARDANDO_APROVACAO')
    await P.excluirProduto({ workspaceId: ws, userId, produtoId: a.produtoId })
    await encerrada(geracao.id, 'GERANDO_VIDEO')
    await encerrada(aprovacao.id, 'AGUARDANDO_APROVACAO')
    // NÃO QUERO (descarte pela curadoria) de outro produto: aprovado sem envio e falha sem envio
    const b = await produto(ws, userId, 'Organizador')
    const aprovado = await assistida(ws, b.candidatoId, 'APROVADO')
    const falha = await assistida(ws, b.candidatoId, 'FALHOU', { erro: 'O render falhou (FFmpeg).' })
    await Cu.descartarCandidato({ workspaceId: ws, userId, candidatoId: b.candidatoId })
    await encerrada(aprovado.id, 'APROVADO')
    await encerrada(falha.id, 'FALHOU')
    // NÃO QUERO de um produto já ESCOLHIDO (a curadoria não o descarta): a mesma regra
    const c = await produto(ws, userId, 'Agenda', 'ESCOLHIDO')
    const midia = await assistida(ws, c.candidatoId, 'AGUARDANDO_MIDIA')
    await P.encerrarPorRecusaDaTitular({ workspaceId: ws, candidatoId: c.candidatoId })
    await encerrada(midia.id, 'AGUARDANDO_MIDIA')
  })

  test('7–8. PUBLICANDO, ENVIO INCERTO e Publicacao já distribuída NÃO são encerrados: vão para Precisa de você com a orientação (uma pendência só)', async () => {
    const { ws, userId } = await conta('incertos')
    const { produtoId, candidatoId } = await produto(ws, userId, 'Garrafa térmica')
    const publicando = await assistida(ws, candidatoId, 'PUBLICANDO')
    const incerto = await assistida(ws, candidatoId, 'FALHOU', { erro: 'ENVIO INCERTO — confira o seu perfil no TikTok antes de tentar de novo.' })
    const aprovadoEnviado = await assistida(ws, candidatoId, 'APROVADO')
    const ct = await prisma.conteudo.create({ data: { workspaceId: ws, userId, produtoId, roteiro: 'x', redeSocial: 'tiktok' }, select: { id: true } })
    await prisma.publicacao.create({ data: { workspaceId: ws, contentId: ct.id, provider: 'TIKTOK', canal: 'tiktok', chaveDaTentativa: `assistida:${aprovadoEnviado.id}:t1`, estado: 'DISTRIBUIDA' } as never })
    const r = await P.excluirProduto({ workspaceId: ws, userId, produtoId })
    assert.equal(r!.publicacoesEncerradas, 0)
    assert.equal(r!.publicacoesParaConferir, 3)
    assert.equal((await estado(publicando.id)).estado, 'PUBLICANDO')
    assert.equal((await estado(incerto.id)).estado, 'FALHOU')
    assert.equal((await estado(aprovadoEnviado.id)).estado, 'APROVADO')
    const central = await C.centralPrecisaDeVoce(ws)
    for (const a of [publicando, incerto, aprovadoEnviado]) {
      const itens = central.filter((x) => x.id.startsWith(`assistida:${a.id}:`) || x.id.includes(a.id))
      assert.equal(itens.length, 1, `uma pendência só para ${a.estado} (${itens.map((x) => x.id).join(', ')})`)
      assert.equal(itens[0].id, `assistida:${a.id}:produto-descartado`)
      assert.ok(itens[0].motivo.includes(ORIENTACAO), itens[0].motivo)
    }
  })

  test('9. PUBLICADO, resultado, venda, comissão e histórico da comissão ficam intocados (também depois da reconciliação)', async () => {
    const { ws, userId } = await conta('publicado')
    const { produtoId, candidatoId } = await produto(ws, userId, 'Bolsa térmica')
    const pub = await assistida(ws, candidatoId, 'PUBLICADO', { postId: '7400000000000001181', publicadoEm: new Date() })
    const res = await prisma.videoTikTokResultado.create({ data: { workspaceId: ws, estrutura: 'POV', gancho: 'g', cta: 'A', duracaoSegundos: 15, publicadoEm: new Date(), postId: '7400000000000001181', origemMetricas: 'MANUAL', cliquesProduto: 3 } as never })
    const venda = await prisma.sale.create({ data: { workspaceId: ws, productId: produtoId, amount: 80, status: 'CONFIRMED', source: 'manual', dataOrigin: 'TEST_FIXTURE' } })
    const com = await prisma.commission.create({ data: { workspaceId: ws, saleId: venda.id, productId: produtoId, expectedAmount: 8, confirmedAmount: 8, status: 'CONFIRMED' } })
    await prisma.historicoDeComissao.create({ data: { workspaceId: ws, commissionId: com.id, origem: 'TESTE', novo: { status: 'CONFIRMED' } } })
    const foto = async () => JSON.stringify([await estado(pub.id), await prisma.videoTikTokResultado.findUniqueOrThrow({ where: { id: res.id } }), await prisma.sale.findUniqueOrThrow({ where: { id: venda.id } }), await prisma.commission.findUniqueOrThrow({ where: { id: com.id } }), await prisma.historicoDeComissao.count({ where: { commissionId: com.id } })])
    const antes = await foto()
    await P.excluirProduto({ workspaceId: ws, userId, produtoId })
    await R.reconciliarEstadoOperacional(ws)
    assert.equal(await foto(), antes)
  })

  test('10. duas ações ao mesmo tempo (excluir + NÃO QUERO + reconciliação): encerra uma vez, um registro no histórico', async () => {
    const { ws, userId } = await conta('simultaneo')
    const { produtoId, candidatoId } = await produto(ws, userId, 'Garrafa simultânea')
    const a = await assistida(ws, candidatoId, 'AGUARDANDO_APROVACAO')
    const rs = await Promise.allSettled([
      P.excluirProduto({ workspaceId: ws, userId, produtoId }),
      Cu.descartarCandidato({ workspaceId: ws, userId, candidatoId }),
      P.reconciliarEstadoDoWorkspace(ws, { aplicar: true }),
    ])
    assert.ok(rs[0].status === 'fulfilled' && rs[2].status === 'fulfilled', JSON.stringify(rs.map((x) => x.status)))
    await encerrada(a.id, 'AGUARDANDO_APROVACAO')
  })

  test('11. refresh: sincronizar de novo não traz o produto de volta nem cria publicação; excluir de novo não muda nada', async () => {
    const { ws, userId } = await conta('refresh')
    const { produtoId, candidatoId } = await produto(ws, userId, 'Luminária refresh')
    const a = await assistida(ws, candidatoId, 'APROVADO')
    await P.excluirProduto({ workspaceId: ws, userId, produtoId })
    const foto = async () => JSON.stringify([await estado(a.id), await prisma.publicacaoAssistida.count({ where: { workspaceId: ws } }), (await prisma.candidatoDeProduto.findUniqueOrThrow({ where: { id: candidatoId } })).status])
    const antes = await foto()
    await J.sincronizarOperacao({ workspaceId: ws, userId })
    await J.sincronizarOperacao({ workspaceId: ws, userId })
    const r = await P.excluirProduto({ workspaceId: ws, userId, produtoId })
    assert.equal(r!.publicacoesEncerradas + r!.produtos + r!.candidatos, 0)
    assert.equal(await foto(), antes)
  })

  test('12. reconciliação posterior não contradiz a decisão: não reabre o encerrado, não encerra o incerto, aponta o incerto com a orientação; a 2ª rodada não corrige nada', async () => {
    const { ws, userId } = await conta('reconciliacao')
    const { produtoId, candidatoId } = await produto(ws, userId, 'Agenda reconciliação')
    const certa = await assistida(ws, candidatoId, 'APROVADO')
    const incerta = await assistida(ws, candidatoId, 'FALHOU', { erro: 'ENVIO INCERTO — confira o seu perfil no TikTok antes de tentar de novo.' })
    await P.excluirProduto({ workspaceId: ws, userId, produtoId })
    const r1 = await R.reconciliarEstadoOperacional(ws)
    await encerrada(certa.id, 'APROVADO')
    assert.equal((await estado(incerta.id)).estado, 'FALHOU')
    const achado = r1.achados.find((x) => x.tipo === 'PRODUTO_ARQUIVADO_ATIVO')!
    assert.equal(achado.desfecho, 'PRECISA_DE_VOCE')
    assert.equal(achado.entidade.id, incerta.id)
    assert.ok(achado.texto.includes(ORIENTACAO))
    assert.ok(!r1.achados.some((x) => x.tipo === 'PRODUTO_EXCLUIDO_AINDA_VIVO'), 'nada a corrigir: a exclusão já aplicou a regra')
    const r2 = await R.reconciliarEstadoOperacional(ws)
    assert.equal(r2.corrigidos, 0)
    const v = await P.reconciliarEstadoDoWorkspace(ws, { aplicar: true })
    assert.equal(v.publicacoesDeProdutoInativo + v.candidatosDeProdutoExcluido, 0, 'a regra da curadoria/coleta concorda')
    assert.equal((await estado(incerta.id)).estado, 'FALHOU')
    // a central mostra a incerta uma vez, pela própria publicação
    const central = await C.centralPrecisaDeVoce(ws)
    assert.equal(central.filter((x) => x.id.includes(incerta.id)).length, 1)
  })
})
