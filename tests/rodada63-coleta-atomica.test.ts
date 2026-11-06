/**
 * P2.14.5.17 — coleta rápida, atômica, idempotente e sem corrida.
 *
 * Contra o Postgres de TESTE. Coleta completa; falha no meio da gravação →
 * nenhum estado parcial; clique duplo → estado final consistente; 0, 21 e
 * 200 produtos (margem de tempo); métricas em lote ≡ métricas por produto.
 * Limpa tudo o que cria.
 *
 * Sem rede externa, sem IA. Custo R$ 0,00.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../lib/prisma'
import { coletarCandidatos, ErroDeCuradoria, listarApresentados, persistirColeta, type LinhaDaColeta } from '../lib/curadoria'
import { calcularMetricasDeClique, calcularMetricasPorProduto } from '../lib/metricas-clique'

const TEM_BANCO = !!process.env.DATABASE_URL
const marca = `r63-${Date.now()}`
const ws: Record<'A' | 'VAZIO' | 'GRANDE', string> = { A: '', VAZIO: '', GRANDE: '' }
const usuarios: Record<string, string> = {}

async function criarWorkspace(n: string) {
  const w = await prisma.workspace.create({ data: { name: `R63-${n}`, ownerId: `${marca}-${n}` }, select: { id: true } })
  const u = await prisma.user.create({ data: { email: `${marca}-${n}@teste.local`, name: 'U', password: 'x', workspaceId: w.id }, select: { id: true } })
  usuarios[w.id] = u.id
  return w.id
}

async function criarProdutos(workspaceId: string, n: number) {
  const categorias = ['Casa e Decoração', 'Beleza', 'Brinquedos', 'Papelaria', 'Moda', 'Esportes', 'Outros']
  await prisma.produto.createMany({
    data: Array.from({ length: n }, (_, i) => ({
      workspaceId, userId: usuarios[workspaceId], nome: `${marca} produto ${String(i).padStart(3, '0')}`,
      categoria: categorias[i % categorias.length], preco: 20 + (i % 15) * 20, tipoVenda: 'Afiliado', origemConteudo: 'De fornecedor',
      imagens: [], linkProduto: `https://loja.invalido/${marca}/${workspaceId}/${i}`,
    })),
  })
}

async function retrato(workspaceId: string) {
  const linhas = await prisma.candidatoDeProduto.findMany({
    where: { workspaceId }, orderBy: { chaveDeOrigem: 'asc' },
    select: { chaveDeOrigem: true, status: true, posicao: true, score: true, coletadoEm: true, updatedAt: true },
  })
  return JSON.stringify(linhas)
}

describe('Coleta atômica contra o banco de teste', { skip: !TEM_BANCO ? 'DATABASE_URL ausente — exige Postgres' : false }, () => {
  before(async () => {
    ws.A = await criarWorkspace('A')
    ws.VAZIO = await criarWorkspace('VAZIO')
    ws.GRANDE = await criarWorkspace('GRANDE')
    await criarProdutos(ws.A, 21)
    await criarProdutos(ws.GRANDE, 200)
  })

  after(async () => {
    const ids = Object.values(ws).filter(Boolean)
    await prisma.decisionRecord.deleteMany({ where: { workspaceId: { in: ids } } })
    await prisma.domainEvent.deleteMany({ where: { workspaceId: { in: ids } } })
    await prisma.eventoLink.deleteMany({ where: { workspaceId: { in: ids } } })
    await prisma.linkDinamico.deleteMany({ where: { workspaceId: { in: ids } } })
    await prisma.candidatoDeProduto.deleteMany({ where: { workspaceId: { in: ids } } })
    await prisma.perfilDaLoja.deleteMany({ where: { workspaceId: { in: ids } } })
    await prisma.produto.deleteMany({ where: { workspaceId: { in: ids } } })
    await prisma.auditLog.deleteMany({ where: { workspaceId: { in: ids } } })
    await prisma.user.deleteMany({ where: { workspaceId: { in: ids } } })
    await prisma.workspace.deleteMany({ where: { id: { in: ids } } })
    await prisma.$disconnect()
  })

  test('0 produtos: coleta sem erro, nada gravado, auditoria com zeros', async () => {
    const r = await coletarCandidatos({ workspaceId: ws.VAZIO, userId: usuarios[ws.VAZIO] })
    assert.deepEqual([r.avaliados, r.candidatosAtivos, r.apresentados], [0, 0, 0])
    assert.equal(await prisma.candidatoDeProduto.count({ where: { workspaceId: ws.VAZIO } }), 0)
    const log = await prisma.auditLog.findFirstOrThrow({ where: { workspaceId: ws.VAZIO, action: 'curadoria.candidatos_coletados' } })
    assert.deepEqual(log.metadata, { avaliados: 0, apresentados: 0, bloqueados: 0 })
  })

  test('21 produtos: coleta completa, num único instante, rápida', async () => {
    const t0 = Date.now()
    const r = await coletarCandidatos({ workspaceId: ws.A, userId: usuarios[ws.A] })
    const ms = Date.now() - t0
    assert.equal(r.avaliados, 21)
    assert.equal(r.candidatosAtivos, 21)
    assert.equal(r.apresentados, 3)
    const instantes = await prisma.candidatoDeProduto.groupBy({ by: ['coletadoEm'], where: { workspaceId: ws.A } })
    assert.equal(instantes.length, 1, 'todos da mesma rodada')
    assert.deepEqual((await listarApresentados(ws.A)).map((c) => c.posicao), [1, 2, 3])
    assert.ok(ms < 10_000, `21 produtos em ${ms} ms (meta < 10 s)`)
    console.log(`[medicao] 21 produtos: ${ms} ms`)
  })

  test('reexecução é idempotente: mesmas linhas, mesmo ranking, sem duplicar', async () => {
    const antes = await prisma.candidatoDeProduto.findMany({ where: { workspaceId: ws.A }, orderBy: { chaveDeOrigem: 'asc' }, select: { id: true, chaveDeOrigem: true, status: true, posicao: true, score: true } })
    await coletarCandidatos({ workspaceId: ws.A })
    const depois = await prisma.candidatoDeProduto.findMany({ where: { workspaceId: ws.A }, orderBy: { chaveDeOrigem: 'asc' }, select: { id: true, chaveDeOrigem: true, status: true, posicao: true, score: true } })
    assert.deepEqual(depois, antes)
  })

  test('falha no meio da gravação: NENHUM estado parcial (nem reset, nem linhas, nem auditoria)', async () => {
    const antes = await retrato(ws.A)
    const logsAntes = await prisma.auditLog.count({ where: { workspaceId: ws.A } })
    const existentes = await prisma.candidatoDeProduto.findMany({ where: { workspaceId: ws.A }, take: 21 })
    // 20 linhas válidas (mudariam o estado) + 1 inválida (nome nulo) no meio.
    const linhas: LinhaDaColeta[] = existentes.map((c, i) => ({
      ...c, motivosPositivos: c.motivosPositivos, riscos: c.riscos, desconhecidos: c.desconhecidos, porqueDestaPosicao: c.porqueDestaPosicao,
      nome: i === 10 ? (null as unknown as string) : c.nome,
      score: c.score + 1, status: 'NOVO', posicao: null,
      coletadoEm: new Date(), validoAte: new Date(Date.now() + 3600_000),
    })) as unknown as LinhaDaColeta[]
    await assert.rejects(
      persistirColeta({ workspaceId: ws.A, agora: new Date(), linhas, auditoria: { userId: usuarios[ws.A], metadata: { teste: 'falha' } } })
    )
    assert.equal(await retrato(ws.A), antes, 'nada mudou: nem o reset dos APRESENTADO, nem as 20 linhas válidas')
    assert.equal(await prisma.auditLog.count({ where: { workspaceId: ws.A } }), logsAntes, 'nenhuma auditoria de rodada falha')
    assert.equal(await prisma.candidatoDeProduto.count({ where: { workspaceId: ws.A, status: 'APRESENTADO' } }), 3)
  })

  test('clique duplo / coletas simultâneas: estado final consistente (ou 409 explícito)', async () => {
    const resultados = await Promise.allSettled([
      coletarCandidatos({ workspaceId: ws.A, userId: usuarios[ws.A] }),
      coletarCandidatos({ workspaceId: ws.A, userId: usuarios[ws.A] }),
    ])
    for (const r of resultados) {
      if (r.status === 'rejected') {
        assert.ok(r.reason instanceof ErroDeCuradoria && r.reason.status === 409, String(r.reason))
      }
    }
    assert.ok(resultados.some((r) => r.status === 'fulfilled'))
    assert.equal(await prisma.candidatoDeProduto.count({ where: { workspaceId: ws.A } }), 21, 'sem duplicata')
    assert.equal(await prisma.candidatoDeProduto.count({ where: { workspaceId: ws.A, status: 'APRESENTADO' } }), 3)
    const instantes = await prisma.candidatoDeProduto.groupBy({ by: ['coletadoEm'], where: { workspaceId: ws.A } })
    assert.equal(instantes.length, 1, 'uma rodada inteira prevaleceu, sem mistura')
  })

  test('trava: coleta durante outra transação de coleta recebe 409, sem gravar', async () => {
    const antes = await retrato(ws.A)
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS ok FROM pg_advisory_xact_lock(hashtextextended(${`curadoria:${ws.A}`}, 0))`
      const erro = await coletarCandidatos({ workspaceId: ws.A }).then(() => null, (e) => e)
      assert.ok(erro instanceof ErroDeCuradoria && erro.status === 409, String(erro))
    }, { timeout: 30_000 })
    assert.equal(await retrato(ws.A), antes)
  })

  test('200 produtos: margem de segurança medida', async () => {
    const t0 = Date.now()
    const r = await coletarCandidatos({ workspaceId: ws.GRANDE })
    const ms = Date.now() - t0
    assert.equal(r.avaliados, 200)
    assert.equal(r.candidatosAtivos, 200)
    assert.equal(r.apresentados, 3)
    assert.ok(ms < 15_000, `200 produtos em ${ms} ms (meta < 15 s)`)
    console.log(`[medicao] 200 produtos: ${ms} ms`)
  })

  test('métricas em lote ≡ métricas produto a produto (cliques reais, corte temporal, outro tipo, outro workspace)', async () => {
    const produtos = await prisma.produto.findMany({ where: { workspaceId: ws.A }, take: 3, orderBy: { nome: 'asc' }, select: { id: true } })
    const agora = new Date()
    const [l1, l2] = await Promise.all(
      [produtos[0].id, produtos[1].id].map((produtoId, i) =>
        prisma.linkDinamico.create({
          data: { userId: usuarios[ws.A], workspaceId: ws.A, produtoId, slug: `${marca}-l${i}`, plataforma: 'instagram', urlDestino: 'https://loja.invalido/x', tipo: 'afiliado' },
          select: { id: true },
        })
      )
    )
    const passado = new Date(agora.getTime() - 3600_000)
    const futuro = new Date(agora.getTime() + 3600_000)
    await prisma.eventoLink.createMany({
      data: [
        { workspaceId: ws.A, linkId: l1.id, tipo: 'clique', createdAt: passado },
        { workspaceId: ws.A, linkId: l1.id, tipo: 'clique', createdAt: passado },
        { workspaceId: ws.A, linkId: l1.id, tipo: 'clique', createdAt: futuro }, // depois do corte: não conta
        { workspaceId: ws.A, linkId: l1.id, tipo: 'visualizacao', createdAt: passado }, // outro tipo: não conta
        { workspaceId: ws.A, linkId: l2.id, tipo: 'clique', createdAt: passado },
      ],
    })
    const ids = [produtos[0].id, produtos[1].id, produtos[2].id, produtos[0].id] // repetido de propósito
    const emLote = await calcularMetricasPorProduto(ws.A, ids, agora)
    const umAUm = await Promise.all(ids.map(async (produtoId) => ({ ...(await calcularMetricasDeClique({ workspaceId: ws.A, produtoId, antesDe: agora })), produtoId, granularidade: 'PRODUTO' })))
    assert.deepEqual(emLote, umAUm)
    assert.deepEqual(emLote.map((m) => m.cliques), [2, 1, 0, 2])
    assert.deepEqual(await calcularMetricasPorProduto(ws.VAZIO, ids, agora), ids.map((produtoId) => ({ cliques: 0, vendasElegiveis: 0, taxaConversao: null, receitaRealizada: 0, receitaPorClique: null, produtoId, granularidade: 'PRODUTO' })))
  })

  test('nenhuma tarefa, conteúdo ou publicação; modo intacto', async () => {
    for (const id of Object.values(ws)) {
      assert.equal(await prisma.automationJob.count({ where: { workspaceId: id } }), 0)
      assert.equal(await prisma.conteudo.count({ where: { workspaceId: id } }), 0)
      assert.equal(await prisma.publicacao.count({ where: { workspaceId: id } }), 0)
      const w = await prisma.workspace.findUniqueOrThrow({ where: { id }, select: { automationMode: true, automationPaused: true } })
      assert.deepEqual(w, { automationMode: 'MANUAL', automationPaused: true })
    }
  })
})
