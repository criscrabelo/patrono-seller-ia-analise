/**
 * P2.14.5.13 — Fase 2 contra o Postgres de TESTE.
 *
 * Tabelas com RLS e sem acesso direto; coleta em workspace MANUAL/pausado
 * sem mudar o modo; 3 apresentados; coletas seguidas não duplicam; escolha
 * do catálogo não duplica produto; "Informar produto" vira Produto real;
 * fonte externa preserva providerId/externalId; clique duplo cria 1 só;
 * isolamento entre workspaces; vencido/bloqueado não se escolhe; nada de
 * tarefa, conteúdo ou publicação. Limpa tudo o que cria.
 *
 * Sem rede externa, sem IA. Custo R$ 0,00.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../lib/prisma'
import {
  coletarCandidatos,
  descartarCandidato,
  escolherCandidato,
  ErroDeCuradoria,
  informarProduto,
  listarApresentados,
} from '../lib/curadoria'
import { obterPerfilDaLoja } from '../lib/perfil-da-loja'

const TEM_BANCO = !!process.env.DATABASE_URL
const marca = `r62-${Date.now()}`
let wsA = ''
let wsB = ''
let userA = ''
let userB = ''
const produtosDoCatalogo: Record<string, string> = {}

async function contarEfeitosColaterais(ws: string) {
  const [jobs, conteudos, publicacoes] = await Promise.all([
    prisma.automationJob.count({ where: { workspaceId: ws } }),
    prisma.conteudo.count({ where: { workspaceId: ws } }),
    prisma.publicacao.count({ where: { workspaceId: ws } }),
  ])
  return { jobs, conteudos, publicacoes }
}

async function erroDe(p: Promise<unknown>): Promise<ErroDeCuradoria> {
  try {
    await p
  } catch (e) {
    assert.ok(e instanceof ErroDeCuradoria, String(e))
    return e
  }
  assert.fail('deveria ter falhado')
}

describe('Curadoria contra o banco de teste', { skip: !TEM_BANCO ? 'DATABASE_URL ausente — exige Postgres' : false }, () => {
  before(async () => {
    // Workspaces com o padrão do sistema: pausado e MANUAL.
    for (const n of ['A', 'B']) {
      const ws = await prisma.workspace.create({ data: { name: `R62-${n}`, ownerId: `${marca}-${n}` }, select: { id: true } })
      const u = await prisma.user.create({
        data: { email: `${marca}-${n}@teste.local`, name: 'U', password: 'x', workspaceId: ws.id },
        select: { id: true },
      })
      if (n === 'A') { wsA = ws.id; userA = u.id } else { wsB = ws.id; userB = u.id }
    }
    // Catálogo de A: 4 elegíveis fora do perfil (para o informado ranquear
    // acima), 1 inativo, 1 descartado e 1 sintético — os 3 últimos não podem
    // virar candidato.
    const itens: Array<[string, Record<string, unknown>]> = [
      ['pet', { categoria: 'Pet', preco: 900 }],
      ['esporte1', { categoria: 'Esportes', preco: 900 }],
      ['esporte2', { categoria: 'Esportes', preco: 950 }],
      ['alimento', { categoria: 'Alimentação', preco: 910 }],
      ['inativo', { categoria: 'Beleza', preco: 100, status: 'inativo' }],
      ['descartado', { categoria: 'Beleza', preco: 100, status: 'descartado' }],
      ['sintetico', { categoria: 'Beleza', preco: 100, origemDados: 'TEST_FIXTURE' }],
    ]
    for (const [chave, extra] of itens) {
      const p = await prisma.produto.create({
        data: {
          workspaceId: wsA, userId: userA, nome: `${marca}-${chave}`, tipoVenda: 'Afiliado', origemConteudo: 'De fornecedor',
          imagens: [], linkProduto: `https://loja.invalido/${marca}/${chave}`, categoria: 'Outros', ...extra,
        },
        select: { id: true },
      })
      produtosDoCatalogo[chave] = p.id
    }
  })

  after(async () => {
    for (const ws of [wsA, wsB].filter(Boolean)) {
      await prisma.decisionRecord.deleteMany({ where: { workspaceId: ws } })
      await prisma.domainEvent.deleteMany({ where: { workspaceId: ws } })
      await prisma.candidatoDeProduto.deleteMany({ where: { workspaceId: ws } })
      await prisma.perfilDaLoja.deleteMany({ where: { workspaceId: ws } })
      await prisma.produto.deleteMany({ where: { workspaceId: ws } })
      await prisma.auditLog.deleteMany({ where: { workspaceId: ws } })
      await prisma.user.deleteMany({ where: { workspaceId: ws } })
    }
    await prisma.workspace.deleteMany({ where: { id: { in: [wsA, wsB].filter(Boolean) } } })
    await prisma.$disconnect()
  })

  test('tabelas novas: RLS ligado e sem acesso direto de anon/authenticated', async () => {
    const linhas = await prisma.$queryRaw<Array<{ relname: string; rls: boolean; acesso: boolean }>>`
      select c.relname::text as relname, c.relrowsecurity as rls,
        (has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
          or has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')) as acesso
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in ('CandidatoDeProduto', 'PerfilDaLoja')`
    assert.equal(linhas.length, 2)
    for (const l of linhas) {
      assert.equal(l.rls, true, l.relname)
      assert.equal(l.acesso, false, l.relname)
    }
  })

  test('coleta com workspace MANUAL e pausado: 3 apresentados, modo intacto, nenhum efeito colateral', async () => {
    const antes = await prisma.workspace.findUniqueOrThrow({ where: { id: wsA }, select: { automationMode: true, automationPaused: true } })
    assert.deepEqual(antes, { automationMode: 'MANUAL', automationPaused: true })

    const r = await coletarCandidatos({ workspaceId: wsA, userId: userA })
    assert.equal(r.apresentados, 3)
    assert.equal(r.candidatosAtivos, 4, 'só os 4 elegíveis viram candidato')

    const apresentados = await listarApresentados(wsA)
    assert.deepEqual(apresentados.map((c) => c.posicao), [1, 2, 3])
    for (const c of apresentados) {
      assert.equal(c.vendas, null)
      assert.equal(c.avaliacao, null)
      assert.equal(c.estoque, null)
      assert.equal(c.comissaoPercentual, null)
      assert.ok(c.porqueDestaPosicao.length > 0)
      assert.ok(c.desconhecidos.length > 0)
      assert.equal(c.validoAte.getTime() - c.coletadoEm.getTime(), 7 * 24 * 3600 * 1000, 'catálogo interno: 7 dias')
    }
    const ids = new Set((await prisma.candidatoDeProduto.findMany({ where: { workspaceId: wsA } })).map((c) => c.produtoId))
    for (const fora of ['inativo', 'descartado', 'sintetico']) assert.ok(!ids.has(produtosDoCatalogo[fora]), fora)

    const depois = await prisma.workspace.findUniqueOrThrow({ where: { id: wsA }, select: { automationMode: true, automationPaused: true } })
    assert.deepEqual(depois, antes)
    assert.deepEqual(await contarEfeitosColaterais(wsA), { jobs: 0, conteudos: 0, publicacoes: 0 })
  })

  test('o perfil padrão foi gravado no workspace e é o que vale', async () => {
    const { origem } = await obterPerfilDaLoja(wsA)
    assert.equal(origem, 'BANCO')
    assert.equal(await prisma.perfilDaLoja.count({ where: { workspaceId: wsA } }), 1)
  })

  test('coletas seguidas não duplicam', async () => {
    const antes = await prisma.candidatoDeProduto.count({ where: { workspaceId: wsA } })
    await coletarCandidatos({ workspaceId: wsA })
    await coletarCandidatos({ workspaceId: wsA })
    assert.equal(await prisma.candidatoDeProduto.count({ where: { workspaceId: wsA } }), antes)
    assert.equal(await prisma.candidatoDeProduto.count({ where: { workspaceId: wsA, status: 'APRESENTADO' } }), 3)
    assert.equal(await prisma.perfilDaLoja.count({ where: { workspaceId: wsA } }), 1)
  })

  test('escolher um do catálogo: ESCOLHIDO, sem produto duplicado; não volta a ser apresentado', async () => {
    const [primeiro] = await listarApresentados(wsA)
    const produtosAntes = await prisma.produto.count({ where: { workspaceId: wsA } })
    const r = await escolherCandidato({ workspaceId: wsA, userId: userA, candidatoId: primeiro.id })
    assert.deepEqual(r, { status: 'ESCOLHIDO', produtoId: primeiro.produtoId, produtoCriado: false })
    assert.equal(await prisma.produto.count({ where: { workspaceId: wsA } }), produtosAntes)

    await coletarCandidatos({ workspaceId: wsA })
    const agora = await listarApresentados(wsA)
    assert.ok(!agora.some((c) => c.produtoId === primeiro.produtoId))
    assert.equal(agora.length, 3)
  })

  test('"Informar produto": só nome e link; nada inventado; duplicado é recusado', async () => {
    const c = await informarProduto({
      workspaceId: wsA,
      userId: userA,
      dados: { nome: `${marca} Máscara capilar Kérastase`, link: `https://loja.invalido/${marca}/kerastase`, categoria: 'Beleza', preco: 189, comprei: true, usei: true },
    })
    assert.equal(c.fonte, 'USER_PROVIDED')
    assert.equal(c.imagem, null)
    assert.equal(c.vendas, null)
    assert.equal(c.comissaoPercentual, null)
    assert.equal(c.compradoPelaTitular, true)
    assert.equal(c.usadoPelaTitular, true)
    assert.equal(c.afinidade, 20, 'marca +10, usado +10 (comprado não acumula)')

    const semNada = await informarProduto({
      workspaceId: wsA,
      userId: userA,
      dados: { nome: `${marca} Item só com link`, link: `https://loja.invalido/${marca}/so-link`, comprei: false, usei: false },
    })
    assert.equal(semNada.categoria, null)
    assert.equal(semNada.preco, null)

    const dup = await erroDe(
      informarProduto({ workspaceId: wsA, userId: userA, dados: { nome: 'X', link: `https://loja.invalido/${marca}/kerastase`, comprei: false, usei: false } })
    )
    assert.equal(dup.status, 409)
    const noCatalogo = await erroDe(
      informarProduto({ workspaceId: wsA, userId: userA, dados: { nome: 'X', link: `https://loja.invalido/${marca}/pet`, comprei: false, usei: false } })
    )
    assert.equal(noCatalogo.status, 409)
  })

  test('informado bem ranqueado: escolher cria Produto só com dado real (CADASTRADO)', async () => {
    await coletarCandidatos({ workspaceId: wsA })
    const informado = (await listarApresentados(wsA)).find((c) => c.fonte === 'USER_PROVIDED' && c.compradoPelaTitular)
    assert.ok(informado, 'o informado (Beleza, marca preferida, usado) deve estar entre os 3')
    assert.equal(informado!.posicao, 1)

    const r = await escolherCandidato({ workspaceId: wsA, userId: userA, candidatoId: informado!.id })
    assert.equal(r.status, 'CADASTRADO')
    assert.equal(r.produtoCriado, true)
    const p = await prisma.produto.findUniqueOrThrow({ where: { id: r.produtoId } })
    assert.equal(p.workspaceId, wsA)
    assert.equal(p.origemDados, 'USER_PROVIDED')
    assert.equal(p.observacoes, '#usei')
    assert.equal(p.categoria, 'Beleza')
    assert.equal(p.preco, 189)
    assert.deepEqual(p.imagens, [])
    assert.equal(p.descricao, null)
    assert.equal(p.providerId, null)
    const cand = await prisma.candidatoDeProduto.findUniqueOrThrow({ where: { id: informado!.id } })
    assert.equal(cand.status, 'CADASTRADO')
    assert.equal(cand.produtoId, p.id)

    // O produto novo não volta como candidato na próxima coleta.
    await coletarCandidatos({ workspaceId: wsA })
    assert.equal(await prisma.candidatoDeProduto.count({ where: { workspaceId: wsA, produtoId: p.id } }), 1)
  })

  test('fonte externa: preserva providerId/externalId; clique duplo cria 1 produto só', async () => {
    const agora = new Date()
    const c = await prisma.candidatoDeProduto.create({
      data: {
        workspaceId: wsA, chaveDeOrigem: `tiktok-shop:${marca}`, fonte: 'tiktok-shop', providerId: 'tiktok-shop', externalId: `${marca}-X1`,
        nome: `${marca} externo`, linkProduto: `https://loja.invalido/${marca}/externo`, score: 70, baseDeEvidencia: 70,
        confianca: 'BAIXA', status: 'APRESENTADO', posicao: 1, coletadoEm: agora, validoAte: new Date(agora.getTime() + 3600_000),
      },
    })
    const antes = await prisma.produto.count({ where: { workspaceId: wsA } })
    const resultados = await Promise.allSettled([
      escolherCandidato({ workspaceId: wsA, userId: userA, candidatoId: c.id }),
      escolherCandidato({ workspaceId: wsA, userId: userA, candidatoId: c.id }),
    ])
    const ok = resultados.filter((r) => r.status === 'fulfilled')
    const falhas = resultados.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
    assert.equal(ok.length, 1)
    assert.equal(falhas.length, 1)
    assert.equal((falhas[0].reason as ErroDeCuradoria).status, 409)
    assert.equal(await prisma.produto.count({ where: { workspaceId: wsA } }), antes + 1)

    const p = await prisma.produto.findFirstOrThrow({ where: { workspaceId: wsA, externalId: `${marca}-X1` } })
    assert.equal(p.providerId, 'tiktok-shop')
    assert.equal(p.origemDados, 'tiktok-shop')
    assert.equal(p.categoria, 'Outros', 'categoria ausente = Outros')
    assert.equal(p.preco, null)
  })

  test('isolamento: o usuário de B não escolhe nem descarta candidato de A', async () => {
    await coletarCandidatos({ workspaceId: wsA })
    const [deA] = await listarApresentados(wsA)
    assert.equal((await erroDe(escolherCandidato({ workspaceId: wsB, userId: userB, candidatoId: deA.id }))).status, 404)
    assert.equal((await erroDe(descartarCandidato({ workspaceId: wsB, userId: userB, candidatoId: deA.id }))).status, 404)
    assert.equal((await listarApresentados(wsB)).length, 0)
    const atual = await prisma.candidatoDeProduto.findUniqueOrThrow({ where: { id: deA.id } })
    assert.equal(atual.status, 'APRESENTADO')
  })

  test('vencido ou bloqueado não pode ser escolhido', async () => {
    const [um, dois] = await listarApresentados(wsA)
    await prisma.candidatoDeProduto.update({ where: { id: um.id }, data: { validoAte: new Date(Date.now() - 1000) } })
    assert.match((await erroDe(escolherCandidato({ workspaceId: wsA, userId: userA, candidatoId: um.id }))).message, /vencido/)
    await prisma.candidatoDeProduto.update({ where: { id: dois.id }, data: { complianceBloqueante: true } })
    assert.match((await erroDe(escolherCandidato({ workspaceId: wsA, userId: userA, candidatoId: dois.id }))).message, /compliance/)
  })

  test('"Usei" sem "Comprei": sinais separados no candidato', async () => {
    const c = await informarProduto({
      workspaceId: wsA,
      userId: userA,
      dados: { nome: `${marca} Organizador usado`, link: `https://loja.invalido/${marca}/usado`, comprei: false, usei: true },
    })
    await coletarCandidatos({ workspaceId: wsA })
    const depois = await prisma.candidatoDeProduto.findUniqueOrThrow({ where: { id: c.id } })
    assert.equal(depois.usadoPelaTitular, true)
    assert.equal(depois.compradoPelaTitular, false, '"usei" não vira "comprei"')
  })

  test('descartar: fora por 30 dias; depois volta a concorrer; escolhidos/cadastrados nunca voltam', async () => {
    await coletarCandidatos({ workspaceId: wsA })
    const [alvo] = await listarApresentados(wsA)
    await descartarCandidato({ workspaceId: wsA, userId: userA, candidatoId: alvo.id })
    const DIA = 24 * 3600 * 1000

    // Dentro da quarentena (hoje e daqui a 29 dias): continua fora.
    for (const dias of [0, 29]) {
      await coletarCandidatos({ workspaceId: wsA, agora: new Date(Date.now() + dias * DIA) })
      const c = await prisma.candidatoDeProduto.findUniqueOrThrow({ where: { id: alvo.id } })
      assert.equal(c.status, 'DESCARTADO', `dia ${dias}`)
      assert.ok(!(await listarApresentados(wsA)).some((x) => x.id === alvo.id))
    }

    // Depois de 30 dias: volta a concorrer, sem duplicar.
    const definitivosAntes = await prisma.candidatoDeProduto.findMany({
      where: { workspaceId: wsA, status: { in: ['ESCOLHIDO', 'CADASTRADO'] } },
      select: { id: true, status: true, produtoId: true },
    })
    assert.ok(definitivosAntes.length >= 3)
    const linhasAntes = await prisma.candidatoDeProduto.count({ where: { workspaceId: wsA } })
    const produtosAntes = await prisma.produto.count({ where: { workspaceId: wsA } })
    await coletarCandidatos({ workspaceId: wsA, agora: new Date(Date.now() + 31 * DIA) })
    const voltou = await prisma.candidatoDeProduto.findUniqueOrThrow({ where: { id: alvo.id } })
    assert.ok(['NOVO', 'APRESENTADO'].includes(voltou.status), voltou.status)
    assert.equal(await prisma.candidatoDeProduto.count({ where: { workspaceId: wsA } }), linhasAntes, 'nenhuma linha nova')
    assert.equal(await prisma.produto.count({ where: { workspaceId: wsA } }), produtosAntes, 'nenhum produto novo')

    const definitivosDepois = await prisma.candidatoDeProduto.findMany({
      where: { id: { in: definitivosAntes.map((d) => d.id) } },
      select: { id: true, status: true, produtoId: true },
    })
    assert.deepEqual(
      definitivosDepois.sort((a, b) => a.id.localeCompare(b.id)),
      definitivosAntes.sort((a, b) => a.id.localeCompare(b.id)),
      'escolhidos/cadastrados intactos'
    )
    for (const d of definitivosAntes) {
      assert.equal(await prisma.candidatoDeProduto.count({ where: { workspaceId: wsA, produtoId: d.produtoId } }), 1)
    }
  })

  test('ao final: nenhuma tarefa, conteúdo ou publicação; modo intacto', async () => {
    assert.deepEqual(await contarEfeitosColaterais(wsA), { jobs: 0, conteudos: 0, publicacoes: 0 })
    const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: wsA }, select: { automationMode: true, automationPaused: true } })
    assert.deepEqual(ws, { automationMode: 'MANUAL', automationPaused: true })
  })
})
