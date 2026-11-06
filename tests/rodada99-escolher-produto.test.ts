/**
 * "ESCOLHER OUTRO PRODUTO" na Operação (jornada única).
 *
 * Regras que estes testes travam:
 *   - a titular busca por nome (sem acento/maiúscula) entre os produtos conhecidos, em mãos primeiro;
 *   - escolha explícita + produto em mãos = prioridade máxima, na hora;
 *   - não precisa recusar os outros, e nenhum outro é recusado ou descartado;
 *   - idempotente: duplo clique / repetir não duplica jornada, aprovação, "em mãos" nem publicação;
 *   - refresh volta ao produto escolhido; escolher outro depois troca a prioridade.
 * Banco de TESTE; workspaces descartáveis; nada é publicado.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')

describe('escolher produto: a página e a rota', () => {
  test('a Operação tem "ESCOLHER OUTRO PRODUTO" com busca e as duas opções', () => {
    const pagina = fs.readFileSync('app/(dashboard)/operacao/page.tsx', 'utf8')
    assert.match(pagina, /ESCOLHER OUTRO PRODUTO/)
    assert.match(pagina, /\/api\/operacao\/escolher\?q=/)
    assert.match(pagina, /JÁ TENHO/)
    assert.match(pagina, /AINDA NÃO TENHO/)
  })
  test('ordem do Precisa de você: integração futura não passa na frente de quem leva à publicação', async () => {
    const { ordenarPendencias } = await import('../lib/precisa-de-voce-central')
    const p = (id: string, m: Record<string, unknown> = {}) => ({ id, origem: 'JORNADA', categoria: 'APROVACAO', titulo: id, motivo: '', urgencia: 'MEDIA', impacto: '', acao: { rotulo: '', link: null }, criadoEm: '2026-10-14T10:00:00Z', perdeDinheiro: false, prazo: null, bloqueiaPublicacao: false, bloqueiaIntegracao: false, ...m }) as import('../lib/precisa-de-voce-central').PendenciaDaCentral
    const r = ordenarPendencias([p('tiktok:criar-app', { origem: 'INTEGRACAO', urgencia: 'ALTA', bloqueiaIntegracao: true, integracaoFutura: true }), p('jornada:produto'), p('assistida:midia', { bloqueiaPublicacao: true })])
    assert.deepEqual(r.map((x) => x.id), ['assistida:midia', 'jornada:produto', 'tiktok:criar-app'])
  })
  test('a rota exige sessão e a mesma flag da Operação', () => {
    const rota = fs.readFileSync('app/api/operacao/escolher/route.ts', 'utf8')
    assert.equal((rota.match(/exigirSessaoEFlag\('CENTRAL_DE_APROVACOES'\)/g) ?? []).length, 2)
  })
})

describe('escolher produto (banco de TESTE)', { skip: !TEM_BANCO ? 'exige banco de TESTE' : false, timeout: 900_000 }, () => {
  let prisma: typeof import('../lib/prisma').prisma
  let J: typeof import('../lib/jornada')
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  const PREFIXO = 'Conta de Teste — '
  const marca = `r99-${Date.now()}`
  const workspaces: string[] = []
  const usuarios: Record<string, string> = {}

  async function novoWorkspace(nome: string) {
    const ws = (await prisma.workspace.create({ data: { name: `${PREFIXO}${nome} r99`, ownerId: `${marca}-${nome}` }, select: { id: true } })).id
    workspaces.push(ws)
    usuarios[ws] = (await prisma.user.create({ data: { email: `${marca}-${workspaces.length}@teste.local`, name: 'U', password: 'x', workspaceId: ws }, select: { id: true } })).id
    return ws
  }
  async function candidato(ws: string, nome: string, extra: Record<string, unknown> = {}) {
    const n = String(Date.now()).slice(-6) + Math.floor(Math.random() * 1000)
    return (await prisma.candidatoDeProduto.create({
      data: {
        workspaceId: ws, chaveDeOrigem: `${marca}-${nome}-${n}`, fonte: 'USER_PROVIDED', nome: `FIXTURE ${nome}`, categoria: 'Casa', preco: 49.9, providerId: 'tiktok-shop', externalId: `9000000099${n}`,
        linkProduto: `https://www.tiktok.com/view/product/9000000099${n}`, score: 60, baseDeEvidencia: 60, confianca: 'SEM_HISTORICO_REAL', status: 'APRESENTADO', coletadoEm: new Date(), validoAte: new Date('2027-01-01'),
        motivosPositivos: ['Vende bem no app'], riscos: [], desconhecidos: [], porqueDestaPosicao: [], nivelDeRisco: 'BAIXO', ...extra,
      },
      select: { id: true },
    })).id
  }
  const visao = async (ws: string, agora = new Date()) => J.visaoDaOperacao(await J.sincronizarOperacao({ workspaceId: ws, userId: usuarios[ws], agora }))
  const escolher = (ws: string, candidatoId: string, emMaos: boolean, agora = new Date()) =>
    J.escolherProduto({ workspaceId: ws, userId: usuarios[ws], candidatoId, emMaos, agora }).then(J.visaoDaOperacao)
  const eventos = (ws: string, c: string, tipo: string) => prisma.domainEvent.count({ where: { workspaceId: ws, entidadeId: c, tipo } })

  before(async () => {
    ;[{ prisma }, J, { limparWorkspaceDeTeste: limpar }] = await Promise.all([import('../lib/prisma'), import('../lib/jornada'), import('./_limpar-workspace-de-teste')])
  })
  after(async () => {
    if (prisma) {
      await prisma.domainEvent.deleteMany({ where: { workspaceId: { in: workspaces } } }).catch(() => null)
      await prisma.decisionRecord.deleteMany({ where: { workspaceId: { in: workspaces } } }).catch(() => null)
      for (const w of workspaces) await limpar(prisma, w, PREFIXO)
    }
    await prisma?.$disconnect()
  })

  test('busca por nome sem acento; em mãos primeiro; compliance e descartado ficam fora', async () => {
    const ws = await novoWorkspace('busca')
    const livro = await candidato(ws, 'Livro Emocionário', { score: 40 })
    await candidato(ws, 'Livro de receitas', { score: 90 })
    const giz = await candidato(ws, 'Giz para cabelo', { score: 30, compradoPelaTitular: true })
    await candidato(ws, 'Livro bloqueado', { complianceBloqueante: true })
    await candidato(ws, 'Livro descartado', { status: 'DESCARTADO' })
    assert.deepEqual((await J.buscarProdutosParaEscolher(ws, 'emocionario')).map((p) => p.candidatoId), [livro])
    assert.deepEqual((await J.buscarProdutosParaEscolher(ws, 'LIVRO  EMOCION')).map((p) => p.candidatoId), [livro])
    const livros = (await J.buscarProdutosParaEscolher(ws, 'livro')).map((p) => p.nome)
    assert.deepEqual(livros.sort(), ['FIXTURE Livro Emocionário', 'FIXTURE Livro de receitas'])
    const todos = await J.buscarProdutosParaEscolher(ws, '')
    assert.equal(todos[0].candidatoId, giz, 'produto em mãos vem primeiro')
    assert.equal(todos[0].emMaos, true)
    assert.equal(todos.length, 3)
  })

  test('escolher em mãos vira prioridade na hora, sem recusar os outros; duplo clique e refresh não duplicam', async () => {
    const ws = await novoWorkspace('escolha')
    const outro = await candidato(ws, 'Mais vendido', { score: 95 })
    const livro = await candidato(ws, 'Livro Emocionário', { score: 30 })
    let v = await visao(ws)
    assert.equal(v.prioritaria!.candidatoId, outro, 'o Patrono trouxe outro produto')
    assert.equal(v.prioritaria!.acao!.tipo, 'APROVAR_PRODUTO')

    // Duplo clique como a tela produz: a página trava o 2º clique enquanto o 1º não volta; repetir não grava nada.
    const a = await escolher(ws, livro, true)
    const b = await escolher(ws, livro, true)
    v = await escolher(ws, livro, true)
    for (const x of [a, b, v]) assert.equal(x.prioritaria!.candidatoId, livro)
    assert.equal(v.prioritaria!.proposta, false)
    assert.ok(!['APROVAR_PRODUTO', 'ADICIONAR_VITRINE', 'PEDIR_AMOSTRA', 'CONFIRMAR_RECEBIMENTO'].includes(v.prioritaria!.acao?.tipo ?? ''), `em mãos pula aprovação, vitrine e amostra (veio ${v.prioritaria!.acao?.tipo ?? v.prioritaria!.etapa})`)
    assert.ok(v.prioritaria!.progresso.some((p) => p.situacao === 'PULADO'))

    assert.equal(await eventos(ws, livro, 'PRODUCT_CHOSEN'), 1, 'uma escolha só')
    assert.equal(await eventos(ws, livro, 'JOURNEY_STARTED'), 1)
    assert.equal(await eventos(ws, livro, 'PRODUCT_IN_HAND'), 1)
    assert.equal(await prisma.publicacaoAssistida.count({ where: { workspaceId: ws, candidatoId: livro } }), 1, 'uma publicação do produto')
    assert.equal(await eventos(ws, outro, 'PRODUCT_REJECTED'), 0, 'o outro produto não foi recusado')
    assert.equal((await prisma.candidatoDeProduto.findUniqueOrThrow({ where: { id: outro } })).status, 'APRESENTADO', 'nem descartado')

    for (let i = 0; i < 2; i++) assert.equal((await visao(ws)).prioritaria!.candidatoId, livro, 'refresh volta ao escolhido')
    assert.equal(await eventos(ws, livro, 'PRODUCT_CHOSEN'), 1)
  })

  test('sem produção em andamento, escolher outro troca a prioridade; voltar ao primeiro funciona; nada é recusado', async () => {
    const ws = await novoWorkspace('troca')
    const livro = await candidato(ws, 'Livro Emocionário')
    const luminaria = await candidato(ws, 'Luminária')
    const t0 = new Date()
    let v = await escolher(ws, livro, false, t0)
    assert.equal(v.prioritaria!.candidatoId, livro)
    v = await escolher(ws, luminaria, false, new Date(t0.getTime() + 2 * 60_000))
    assert.equal(v.prioritaria!.candidatoId, luminaria)
    assert.ok(v.outras.some((o) => o.candidatoId === livro), 'o livro continua em andamento (não foi recusado)')
    v = await escolher(ws, livro, false, new Date(t0.getTime() + 4 * 60_000))
    assert.equal(v.prioritaria!.candidatoId, livro)
    assert.equal(await eventos(ws, livro, 'JOURNEY_STARTED'), 1)
    assert.equal(await eventos(ws, livro, 'PRODUCT_REJECTED'), 0)
  })

  test('Precisa de você segue a mesma escolha; o app do TikTok for Developers não fica em primeiro', async () => {
    const ws = await novoWorkspace('central')
    const percarbonato = await candidato(ws, 'Percarbonato de Sódio ECO CLEAN', { score: 95 })
    const livro = await candidato(ws, 'Livro Emocionário', { score: 30 })
    const giz = await candidato(ws, 'Bastão giz para cabelo', { score: 20 })
    const { centralPrecisaDeVoce } = await import('../lib/precisa-de-voce-central')
    let central = await centralPrecisaDeVoce(ws)
    assert.ok(central.some((p) => p.id === 'tiktok:criar-app'), 'sem chaves do app no TESTE, o item continua registrado')
    assert.notEqual(central[0].id, 'tiktok:criar-app', 'integração futura não fica em primeiro')
    assert.match(central[0].titulo, /Percarbonato/, 'antes da escolha, o Patrono propõe o de maior nota')

    const t0 = new Date()
    await escolher(ws, livro, true, t0)
    central = await centralPrecisaDeVoce(ws)
    assert.equal(central.at(-1)!.integracaoFutura, true, 'integração futura por último')
    assert.match(central[0].titulo + central[0].motivo, /Emocion/, 'Precisa de você mostra o produto escolhido')
    assert.ok(!central.some((p) => /Percarbonato/.test(p.titulo)), 'a proposta antiga sai da frente sem ser recusada')
    assert.equal((await visao(ws)).prioritaria!.candidatoId, livro)

    // Giz escolhido com o Emocionário ainda esperando as fotos: o giz vira o primeiro na hora (com o próprio "Gravar e enviar a mídia").
    const v = await escolher(ws, giz, true, new Date(t0.getTime() + 2 * 60_000))
    assert.equal(v.prioritaria!.candidatoId, giz)
    assert.equal(v.prioritaria!.acao?.tipo, 'FORNECER_MIDIA_REAL')
    assert.ok(v.outras.some((o) => o.candidatoId === livro), 'o Emocionário continua em andamento (não foi recusado)')
    for (let i = 0; i < 2; i++) assert.equal((await visao(ws)).prioritaria!.candidatoId, giz, 'refresh não perde a escolha')
    central = await centralPrecisaDeVoce(ws)
    assert.match(central[0].titulo + central[0].motivo, /giz/i, 'Precisa de você acompanha a nova escolha')
    assert.equal(central.at(-1)!.integracaoFutura, true)
    assert.equal(await prisma.publicacaoAssistida.count({ where: { workspaceId: ws, candidatoId: giz } }), 1, 'sem duplicação')
    assert.equal(await eventos(ws, giz, 'PRODUCT_CHOSEN'), 1)
    assert.equal(await eventos(ws, percarbonato, 'PRODUCT_REJECTED'), 0)
    assert.equal(await eventos(ws, livro, 'PRODUCT_REJECTED'), 0)
    assert.equal((await prisma.candidatoDeProduto.findUniqueOrThrow({ where: { id: percarbonato } })).status, 'APRESENTADO')
  })

  test('sem ter em mãos: entra na jornada aprovado, sem "em mãos"; compliance é recusado', async () => {
    const ws = await novoWorkspace('sem-maos')
    const c = await candidato(ws, 'Luminária')
    const v = await escolher(ws, c, false)
    assert.equal(v.prioritaria!.candidatoId, c)
    assert.notEqual(v.prioritaria!.acao?.tipo, 'APROVAR_PRODUTO')
    assert.equal(await eventos(ws, c, 'PRODUCT_IN_HAND'), 0)
    const bloqueado = await candidato(ws, 'Bloqueado', { complianceBloqueante: true })
    await assert.rejects(() => escolher(ws, bloqueado, true), /compliance/)
  })
})
