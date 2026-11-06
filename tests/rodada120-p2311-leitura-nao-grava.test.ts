/**
 * P2.31.1 — LEITURA NÃO GRAVA. Em Production, montar a Operação (carregarOperacao → restricoesParaOperacao →
 * sincronizarRegrasDoCatalogo) gravou 7 versões de regra de plataforma. Regra: GET / leitura / montar visão
 * não produz escrita implícita. O catálogo de regras passa a ser registrado pela reconciliação (rotina
 * explícita) ou por ação da administradora; a leitura usa o catálogo do código.
 *
 * Prova por retrato: md5 de TODAS as linhas do workspace em TODAS as tabelas (e das tabelas sem workspace)
 * antes e depois de cada leitura → zero alteração. Cobre Operação, Home/Torre, HOJE, Precisa de você,
 * Oportunidades, Resultados, Saúde, regras da plataforma, alertas de comissão e os resumos. Banco de TESTE.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')

describe('P2.31.1 — leitura não grava (banco de TESTE)', { skip: !TEM_BANCO ? 'exige banco de TESTE' : false, timeout: 600_000 }, () => {
  let prisma: typeof import('../lib/prisma').prisma
  let J: typeof import('../lib/jornada')
  let C: typeof import('../lib/cotas-da-plataforma')
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  const PREFIXO = 'Conta de Teste — '
  const marca = `r120-${Date.now()}`
  const workspaces: string[] = []
  const usuarios: Record<string, string> = {}
  let tabelas: { nome: string; porWorkspace: boolean }[] = []

  async function novoWorkspace(nome: string) {
    const ws = (await prisma.workspace.create({ data: { name: `${PREFIXO}${nome} r120`, ownerId: `${marca}-${nome}` }, select: { id: true } })).id
    workspaces.push(ws)
    usuarios[ws] = (await prisma.user.create({ data: { email: `${marca}-${workspaces.length}@teste.local`, name: 'U', password: 'x', workspaceId: ws }, select: { id: true } })).id
    return ws
  }
  async function candidato(ws: string, nome: string, extra: Record<string, unknown> = {}) {
    const n = String(Date.now()).slice(-6) + Math.floor(Math.random() * 1000)
    return (await prisma.candidatoDeProduto.create({
      data: {
        workspaceId: ws, chaveDeOrigem: `${marca}-${nome}-${n}`, fonte: 'USER_PROVIDED', nome: `FIXTURE ${nome}`, categoria: 'Livros', preco: 49.9, comissaoValor: 6, vendas: 900, providerId: 'tiktok-shop', externalId: `9000000120${n}`,
        linkProduto: `https://www.tiktok.com/view/product/9000000120${n}`, score: 60, baseDeEvidencia: 60, confianca: 'SEM_HISTORICO_REAL', status: 'APRESENTADO', coletadoEm: new Date(), validoAte: new Date('2027-01-01'),
        motivosPositivos: ['Vende bem no app'], riscos: [], desconhecidos: [], porqueDestaPosicao: [], nivelDeRisco: 'BAIXO', ...extra,
      },
      select: { id: true },
    })).id
  }

  /** md5 por tabela: só as linhas do workspace (tabelas com workspaceId; Workspace pelo id) e a tabela inteira nas demais. */
  async function retrato(ws: string): Promise<Record<string, string>> {
    const out: Record<string, string> = {}
    for (const t of tabelas) {
      const onde = t.nome === 'Workspace' ? `WHERE x."id" = $1` : t.porWorkspace ? `WHERE x."workspaceId" = $1` : ''
      const sql = `SELECT count(*)::text || ':' || coalesce(md5(string_agg(md5(x::text), '' ORDER BY md5(x::text))), '-') AS h FROM "${t.nome}" x ${onde}`
      const [{ h }] = onde ? await prisma.$queryRawUnsafe<{ h: string }[]>(sql, ws) : await prisma.$queryRawUnsafe<{ h: string }[]>(sql)
      out[t.nome] = h
    }
    return out
  }
  const diferencas = (a: Record<string, string>, b: Record<string, string>) => Object.keys(a).filter((k) => a[k] !== b[k])

  /** Todas as leituras das telas (o que cada GET chama), na mesma ordem em que a titular abriria o app. */
  async function leituras(ws: string) {
    const [Torre, Hoje, Central, Cur, CurHttp, Res, Saude, Rec, Resumos, Alertas] = await Promise.all([
      import('../lib/torre-de-controle'), import('../lib/hoje'), import('../lib/precisa-de-voce-central'), import('../lib/curadoria'), import('../lib/curadoria-http'),
      import('../lib/resultados-videos'), import('../lib/saude-operacional'), import('../lib/reconciliacao'), import('../lib/resumos'), import('../lib/alerta-reducao-comissao'),
    ])
    const agora = new Date()
    return {
      'Operação (montar a visão)': async () => J.visaoDaOperacao(await J.carregarOperacao(ws, agora)),
      'Operação (GET resumo)': () => J.resumoDaOperacao(ws, agora),
      'Home/Torre (GET /api/torre)': () => Torre.torreDeControle(ws, agora),
      'HOJE (GET /api/hoje)': () => Hoje.hojeOperacional(ws, agora),
      'Precisa de você (GET)': async () => [await Central.centralPrecisaDeVoce(ws, agora), await Central.demonstracoesDaCentral(ws)],
      'Oportunidades (GET)': async () => CurHttp.candidatosParaTela(ws, await Cur.listarApresentados(ws)).then(async (c) => [c, await Cur.ultimaColeta(ws)]),
      'Resultados (GET)': () => Res.painelDeResultados(ws),
      'Saúde (GET admin)': async () => [await Saude.saudeOperacional(ws, agora), await Rec.ultimaReconciliacao(ws)],
      'Regras da plataforma (GET admin)': async () => [await C.regrasEfetivas(ws), await C.lerEstadosDaConta(ws), await C.permissaoDaAcao(ws, 'PUBLICAR_VIDEO_PROMOCIONAL', agora)],
      'Alertas de comissão (GET)': () => Alertas.atualizarAlertasDeComissao(ws, new Date('2027-06-01'), { gravar: false }),
      'Resumos (GET /api/resumos/*)': async () => [
        await Resumos.resumoVendasReceita(ws, agora), await Resumos.canaisDeReceita(ws), await Resumos.resumoConteudo(ws), await Resumos.situacaoDasFerramentas(ws),
        await Resumos.statusDoTopo(ws), await Resumos.resumoDosProdutos(ws), await Resumos.videosDoFluxo(ws), await Resumos.relatorioDoPeriodo(ws, new Date(agora.getTime() - 30 * 86_400_000), agora),
        await Resumos.integracoesExecutivo(ws),
      ],
    } as Record<string, () => Promise<unknown>>
  }

  before(async () => {
    ;[{ prisma }, J, C, { limparWorkspaceDeTeste: limpar }] = await Promise.all([import('../lib/prisma'), import('../lib/jornada'), import('../lib/cotas-da-plataforma'), import('./_limpar-workspace-de-teste')])
    const cols = await prisma.$queryRaw<{ t: string; ws: boolean }[]>`
      SELECT c.relname AS t, bool_or(a.attname = 'workspaceId') AS ws FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname <> '_prisma_migrations' GROUP BY c.relname ORDER BY c.relname`
    tabelas = cols.map((c) => ({ nome: c.t, porWorkspace: c.ws }))
  })
  after(async () => {
    if (prisma) {
      await prisma.domainEvent.deleteMany({ where: { workspaceId: { in: workspaces } } }).catch(() => null)
      await prisma.decisionRecord.deleteMany({ where: { workspaceId: { in: workspaces } } }).catch(() => null)
      await prisma.execucaoDoProcessador.deleteMany({ where: { workspaceId: { in: workspaces } } }).catch(() => null)
      for (const w of workspaces) await limpar(prisma, w, PREFIXO)
    }
    await prisma?.$disconnect()
  })

  test('1. reprodução do achado de Production: conta sem catálogo registrado → montar a Operação não grava NADA', async () => {
    const ws = await novoWorkspace('sem-catalogo')
    await candidato(ws, 'Livro Emocionário', { compradoPelaTitular: true })
    assert.equal(await prisma.versaoDeRegraDePlataforma.count({ where: { workspaceId: ws } }), 0)
    const antes = await retrato(ws)
    const v = J.visaoDaOperacao(await J.carregarOperacao(ws, new Date()))
    assert.ok(v.hoje.quota, 'a quota continua aparecendo (lida do catálogo do código)')
    await J.resumoDaOperacao(ws)
    assert.deepEqual(diferencas(antes, await retrato(ws)), [], 'nenhuma tabela mudou')
    assert.equal(await prisma.versaoDeRegraDePlataforma.count({ where: { workspaceId: ws } }), 0, 'as 7 versões NÃO são gravadas ao ler')
  })

  test('2. jornada real em andamento (produto em mãos, aguardando mídia) + alerta de comissão: TODAS as leituras das telas → zero alteração', async () => {
    const ws = await novoWorkspace('em-andamento')
    const c = await candidato(ws, 'Livro Emocionário', { compradoPelaTitular: true })
    await candidato(ws, 'Bastão para cabelo', { categoria: 'Beleza', score: 50 })
    // Monta o estado pelas portas de ESCRITA (fora do retrato): abrir a Operação (POST) e responder "já tenho".
    await J.sincronizarOperacao({ workspaceId: ws, userId: usuarios[ws] })
    const v = J.visaoDaOperacao(await J.responderNaJornada({ workspaceId: ws, userId: usuarios[ws], candidatoId: c, resposta: 'TENHO_EM_MAOS' }))
    assert.equal(v.prioritaria?.acao?.tipo, 'FORNECER_MIDIA_REAL')
    const A = await import('../lib/alerta-reducao-comissao')
    const anuncio = new Date('2026-10-01T12:00:00-03:00')
    await A.registrarReducaoDeComissao({ workspaceId: ws, candidatoId: c, chaveProduto: `tiktok-shop:${marca}`, nomeProduto: 'FIXTURE Livro Emocionário', taxaAtual: 12, taxaNova: 8, dataDoAnuncio: anuncio, fonteDoAnuncio: 'OBSERVADA_PELO_PATRONO', agora: anuncio })

    const comEfeito: string[] = []
    for (const [nome, ler] of Object.entries(await leituras(ws))) {
      const antes = await retrato(ws)
      await ler()
      const mudou = diferencas(antes, await retrato(ws))
      if (mudou.length) comEfeito.push(`${nome}: ${mudou.join(', ')}`)
    }
    assert.deepEqual(comEfeito, [], 'leitura com efeito colateral')
  })

  test('3. o alerta de comissão: a tela mostra o status calculado agora sem gravar; a reconciliação grava', async () => {
    const ws = await novoWorkspace('alerta')
    const A = await import('../lib/alerta-reducao-comissao')
    const anuncio = new Date('2026-10-01T12:00:00-03:00')
    const criado = await A.registrarReducaoDeComissao({ workspaceId: ws, chaveProduto: `tiktok-shop:${marca}-a`, nomeProduto: 'FIXTURE Bastão', taxaAtual: 12, taxaNova: 8, dataDoAnuncio: anuncio, fonteDoAnuncio: 'OBSERVADA_PELO_PATRONO', agora: anuncio })
    const depoisDoPrazo = new Date('2027-06-01T12:00:00-03:00')
    const [calc] = await A.atualizarAlertasDeComissao(ws, depoisDoPrazo, { gravar: false })
    assert.notEqual(calc.status, criado!.status, 'com o tempo o status muda (no cálculo)')
    assert.equal((await prisma.alertaReducaoComissao.findUniqueOrThrow({ where: { id: criado!.id } })).status, criado!.status, 'leitura não gravou')
    const R = await import('../lib/reconciliacao')
    await R.reconciliarEstadoOperacional(ws, { agora: depoisDoPrazo, origem: 'teste-r120' })
    assert.equal((await prisma.alertaReducaoComissao.findUniqueOrThrow({ where: { id: criado!.id } })).status, calc.status, 'a reconciliação gravou o status')
  })

  test('4. catálogo: a leitura usa o código mesmo com versão antiga gravada; a reconciliação registra (1ª vez sem achado; mudança = versão nova + evento)', async () => {
    const { CATALOGO_DE_REGRAS } = await import('../lib/regras-de-plataforma')
    const R = await import('../lib/reconciliacao')
    const ws = await novoWorkspace('catalogo')
    // 1ª rodada: bootstrap (registra as regras, sem achado e sem evento de mudança).
    const r1 = await R.reconciliarEstadoOperacional(ws, { origem: 'teste-r120' })
    assert.equal(await prisma.versaoDeRegraDePlataforma.count({ where: { workspaceId: ws, origem: 'CATALOGO' } }), CATALOGO_DE_REGRAS.length)
    assert.ok(!r1.achados.some((a) => a.tipo === 'REGRA_DO_CATALOGO_ATUALIZADA'))
    assert.equal(await prisma.domainEvent.count({ where: { workspaceId: ws, tipo: 'PLATFORM_RULE_UPDATED' } }), 0)
    // Simula um deploy que mudou uma regra: a versão de catálogo gravada fica "antiga".
    const alvo = CATALOGO_DE_REGRAS[0]
    await prisma.versaoDeRegraDePlataforma.updateMany({ where: { workspaceId: ws, regraId: alvo.id }, data: { hash: 'antigo', dados: { ...alvo, observacao: 'versão antiga' } as object } })
    assert.deepEqual(await C.regrasDoCatalogoPendentes(ws), [{ id: alvo.id, nova: false }])
    const antes = await retrato(ws)
    const efetiva = (await C.regrasEfetivas(ws)).find((r) => r.id === alvo.id)!
    assert.deepEqual(efetiva, alvo, 'a leitura já usa o catálogo do código')
    J.visaoDaOperacao(await J.carregarOperacao(ws, new Date()))
    assert.deepEqual(diferencas(antes, await retrato(ws)), [], 'e não grava')
    // Conferir (sem corrigir) só aponta; corrigir registra a versão nova com evento.
    const conferir = await R.reconciliarEstadoOperacional(ws, { corrigir: false, origem: 'teste-r120' })
    assert.ok(conferir.achados.some((a) => a.tipo === 'REGRA_DO_CATALOGO_ATUALIZADA' && a.desfecho === 'ADMIN'))
    assert.equal(await prisma.versaoDeRegraDePlataforma.count({ where: { workspaceId: ws, regraId: alvo.id } }), 1)
    const corrigir = await R.reconciliarEstadoOperacional(ws, { origem: 'teste-r120' })
    assert.ok(corrigir.achados.some((a) => a.tipo === 'REGRA_DO_CATALOGO_ATUALIZADA' && a.desfecho === 'CORRIGIDO'))
    assert.equal(await prisma.versaoDeRegraDePlataforma.count({ where: { workspaceId: ws, regraId: alvo.id } }), 2)
    assert.equal(await prisma.domainEvent.count({ where: { workspaceId: ws, tipo: 'PLATFORM_RULE_UPDATED', entidadeId: alvo.id } }), 1)
    assert.deepEqual(await C.regrasDoCatalogoPendentes(ws), [], 'idempotente')
  })
})
