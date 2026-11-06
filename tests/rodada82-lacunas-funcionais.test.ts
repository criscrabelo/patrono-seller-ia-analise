/**
 * P2.17.10 — Fechamento das lacunas funcionais (P2.17.9):
 * resultados reais, métricas derivadas, status econômico, aprendizado ligado,
 * Quality Gate obrigatório no fluxo, modo assistido 10/10, TikTok (OAuth,
 * status, rascunho assíncrono, webhook). Produtos, vídeos e respostas do TikTok
 * abaixo são FIXTURE (dados fictícios); nenhuma chamada real é feita.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { metricasDerivadas, agregar } from '../lib/metricas-economicas'
import { statusEconomico, type VideoDoProduto } from '../lib/status-economico-produto'
import { aprender, DIMENSOES, faixaDeHorario, type RegistroDeVideo } from '../lib/aprendizado-videos-tiktok'
import { avaliarVideo, videoDoConteudo, roteiroComoTexto, pendenciaDaChecagem } from '../lib/quality-gate-video-tiktok'
import { paraAvaliar, versaoDaVariante, aplicarAlteracoes } from '../lib/publicacao-assistida'
import { planejarVideos } from '../lib/motor-de-videos-tiktok'
import { mapearStatusTikTok, idsInt64DoTexto } from '../lib/tiktok-acompanhamento'
import { escoposDoTikTok, TIKTOK_SCOPES } from '../lib/tiktok-oauth'
import { decidirDistribuicao, type ContextoDaDistribuicao } from '../lib/distribuicao-decisao'
import { ADAPTADORES_DISPONIVEIS, adaptadoresHabilitados } from '../lib/adaptadores-reais'
import { CAPACIDADE_REAL_DO_ADAPTER } from '../lib/capacidade-real-do-adapter'
import { criarAdaptadorTikTok } from '../lib/tiktok-adaptador'
import { regraDaRota } from '../lib/modulos-rotas'
// P2.45: este arquivo testa o fluxo de publicação ANTERIOR aos três controles (técnico, comercial, conformidade).
process.env.PATRONO_TESTE_LEGADO_SEM_TRES_CONTROLES = 'true'

const nulo = { views: null, cliquesProduto: null, adicoesCarrinho: null, vendas: null, comissao: null, receita: null }

describe('P6 — métricas econômicas (null nunca vira zero)', () => {
  test('razões só com denominador; receita = comissão quando não informada (marcado)', () => {
    const m = metricasDerivadas({ ...nulo, views: 10000, cliquesProduto: 200, vendas: 10, comissao: 95.9 })
    assert.deepEqual([m.ctr, m.conversaoCliqueVenda, m.vendasPor1000Views, m.comissaoPor1000Views, m.comissaoPorClique, m.comissaoPorVenda], [0.02, 0.05, 1, 9.59, 0.48, 9.59])
    assert.equal(m.receitaDoVideo, 95.9)
    assert.equal(m.receitaInferidaDaComissao, true)
    const vazio = metricasDerivadas({ ...nulo, vendas: 3 })
    assert.deepEqual([vazio.ctr, vazio.conversaoCliqueVenda, vazio.vendasPor1000Views], [null, null, null])
    assert.equal(metricasDerivadas({ ...nulo, views: 0, cliquesProduto: 0 }).ctr, null, 'denominador zero = null')
  })
  test('agregado: razão só sobre os pares completos (vídeo sem vendas não dilui a conversão)', () => {
    const a = agregar([{ ...nulo, views: 1000, cliquesProduto: 50, vendas: 5 }, { ...nulo, views: 1000, cliquesProduto: 50 }])
    assert.equal(a.conversaoCliqueVenda, 0.1)
    assert.equal(a.ctr, 0.05)
    assert.equal(a.vendas, 5)
    assert.equal(agregar([]).views, null)
  })
})

const vid = (d: string, m: Partial<VideoDoProduto>): VideoDoProduto => ({ ...nulo, publicadoEm: new Date(d), ...m })
const base = { disponivel: null, estoque: null, nivelDeRisco: 'BAIXO', complianceBloqueante: false, encerradoNaOrigem: false, comissaoPorVendaConhecida: null }

describe('P2 — status econômico por evidência', () => {
  test('amostra pequena = TESTANDO, mesmo com números bons', () => {
    const s = statusEconomico({ ...base, videos: [vid('2026-10-01', { views: 900, vendas: 4, cliquesProduto: 40, comissao: 40 })] })
    assert.equal(s.status, 'PROMISSOR') // já vendeu, mas sem amostra para escalar
    assert.equal(statusEconomico({ ...base, videos: [vid('2026-10-01', { views: 900 })] }).status, 'TESTANDO')
  })
  test('ESCALAR com vendas, CTR e conversão saudáveis e comissão relevante', () => {
    const vs = [1, 2, 3].map((i) => vid(`2026-10-0${i}`, { views: 2000, cliquesProduto: 40, vendas: 2, comissao: 19.18 }))
    const s = statusEconomico({ ...base, videos: vs })
    assert.equal(s.status, 'ESCALAR')
    assert.ok(s.amostraSuficiente)
  })
  test('PAUSAR: indisponível (sem amostra), risco alto, views sem venda, queda relevante', () => {
    assert.equal(statusEconomico({ ...base, disponivel: false, videos: [] }).status, 'PAUSAR')
    assert.equal(statusEconomico({ ...base, nivelDeRisco: 'ALTO', videos: [] }).status, 'PAUSAR')
    const semVenda = [1, 2, 3].map((i) => vid(`2026-10-0${i}`, { views: 1500, vendas: 0, cliquesProduto: 10 }))
    assert.equal(statusEconomico({ ...base, videos: semVenda }).status, 'PAUSAR')
    const queda = [
      ...[1, 2, 3].map((i) => vid(`2026-10-0${i}`, { views: 1000, comissao: 50, vendas: 0, cliquesProduto: 5 })),
      ...[4, 5, 6].map((i) => vid(`2026-10-0${i}`, { views: 1000, comissao: 5, vendas: 0, cliquesProduto: 5 })),
    ]
    assert.match(statusEconomico({ ...base, videos: queda }).motivos[0], /Queda relevante|nenhuma venda/)
  })
  test('ENCERRADO por compliance ou descarte', () => {
    assert.equal(statusEconomico({ ...base, complianceBloqueante: true, videos: [] }).status, 'ENCERRADO')
    assert.equal(statusEconomico({ ...base, encerradoNaOrigem: true, videos: [] }).status, 'ENCERRADO')
  })
})

describe('P7 — aprendizado ligado (receita pesa mais que views)', () => {
  const reg = (id: string, produto: string, views: number, receita: number, hora: string): RegistroDeVideo => ({
    id, produtoId: produto, nomeProduto: produto, categoria: produto === 'A' ? 'Casa' : 'Beleza', estrutura: 'DEMONSTRACAO', gancho: `g-${produto}`, cta: 'A', duracaoSegundos: 15,
    publicadoEm: new Date(hora), metasIds: [], origemMetricas: 'MANUAL', metricas: { views, receita },
  })
  test('dimensões: produto, categoria, estrutura, gancho, CTA, duração, horário', () => {
    assert.deepEqual([...DIMENSOES], ['produto', 'categoria', 'estrutura', 'gancho', 'cta', 'duracao', 'horario'])
    assert.equal(faixaDeHorario(new Date('2026-10-11T23:00:00Z')), 'noite (18–24 h)') // 20 h em Brasília
  })
  test('vencedor só com o mínimo; o produto que vende ganha do que só tem views', () => {
    const rs = [
      ...[1, 2, 3].map((i) => reg(`a${i}`, 'A', 50000, 10, `2026-10-0${i}T15:00:00Z`)),
      ...[1, 2, 3].map((i) => reg(`b${i}`, 'B', 2000, 40, `2026-10-0${i}T15:00:00Z`)),
    ]
    assert.equal(aprender(rs, 'produto').vencedor, 'B')
    assert.equal(aprender(rs.slice(0, 4), 'produto').vencedor, null, 'sem amostra mínima em todos os grupos, nada é declarado')
  })
})

describe('P3 — Quality Gate obrigatório e reconstruível', () => {
  const plano = planejarVideos({ nome: 'FIXTURE Árvore de Natal 2,40 m', categoria: 'Casa e Decoração', preco: 199, tiktokShop: true }, new Date('2026-11-20T12:00:00-03:00'))
  const v = versaoDaVariante(plano.variantes.find((x) => x.id === plano.testeInicial.variantes[0])!)
  test('a checagem do conteúdo gravado é a MESMA da versão aprovada', () => {
    const direto = avaliarVideo(paraAvaliar(v), { tiktokShop: true })
    const av = paraAvaliar(v)
    const doBanco = avaliarVideo(
      videoDoConteudo({ roteiro: roteiroComoTexto(av.roteiro), textoTela: null, chamadaAcao: v.cta, legendaTiktok: v.legenda, hashtags: v.hashtags, duracao: v.duracaoSegundos, objetivo: v.objetivo, exigeExperienciaReal: v.exigeExperienciaReal }),
      { tiktokShop: true }
    )
    assert.equal(direto.veredito, 'APROVADO')
    assert.deepEqual(doBanco.notas, direto.notas)
  })
  test('BLOQUEADO não publica; REVISAR volta para correção', () => {
    const sem = avaliarVideo(paraAvaliar(aplicarAlteracoes(v, { legenda: 'Olha que achado incrível #natal' })), { tiktokShop: true })
    assert.equal(sem.veredito, 'BLOQUEADO')
    assert.match(pendenciaDaChecagem(sem) ?? '', /BLOQUEADO — não publica/)
    const promessa = avaliarVideo(paraAvaliar(aplicarAlteracoes(v, { gancho: 'Esse vai viralizar garantido' })), { tiktokShop: true })
    assert.equal(promessa.veredito, 'BLOQUEADO')
  })
})

describe('P5 — TikTok: OAuth, decisão, status e adaptador oficial', () => {
  test('escopos: rascunho + métricas; Direct Post só com o produto habilitado no app', () => {
    assert.deepEqual(escoposDoTikTok({}), ['user.info.basic', 'video.upload', 'video.list'])
    assert.deepEqual(escoposDoTikTok({ TIKTOK_DIRECT_POST_HABILITADO: 'true' }), ['user.info.basic', 'video.upload', 'video.list', 'video.publish'])
    assert.deepEqual([...TIKTOK_SCOPES], ['video.publish'])
  })
  test('id do post (int64) lido do texto: JSON.parse arredondaria 7500000000000000999', () => {
    assert.equal(JSON.parse('{"x":7500000000000000999}').x.toString(), '7500000000000001000')
    assert.deepEqual(idsInt64DoTexto('{"data":{"publicaly_available_post_id":[7500000000000000999]}}', 'publicaly_available_post_id'), ['7500000000000000999'])
    assert.deepEqual(idsInt64DoTexto('{"publish_id":"p","post_id":7500000000000000999}', 'post_id'), ['7500000000000000999'])
    assert.deepEqual(idsInt64DoTexto('{"data":{}}', 'post_id'), [])
  })
  test('status: desconhecido nunca é falha; caixa de entrada não é publicado', () => {
    assert.equal(mapearStatusTikTok('PUBLISH_COMPLETE'), 'PUBLICADO')
    assert.equal(mapearStatusTikTok('SEND_TO_USER_INBOX'), 'NA_CAIXA_DE_ENTRADA')
    assert.equal(mapearStatusTikTok('FAILED'), 'FALHOU')
    assert.equal(mapearStatusTikTok('ALGO_NOVO'), 'DESCONHECIDO')
    assert.match(fs.readFileSync('lib/tiktok-channel.ts', 'utf8'), /status desconhecido NÃO é falha/)
  })
  const ctx = (m: Partial<ContextoDaDistribuicao>): ContextoDaDistribuicao => ({
    canal: 'tiktok', canalConectado: true, scopesConcedidos: ['user.info.basic', 'video.upload', 'video.list'], appAprovadoPeloProvider: null, midiaAutorizada: true,
    formatoCompativel: true, pecaParaOAdapter: { aceita: true, bloqueios: [], explicacao: [] }, disclosurePresente: true, pendenciasDeCompliance: [], custoZero: true, ...m,
  })
  test('decisão: sem auditoria = RASCUNHO (não Direct Post privado); auditado + video.publish = publicar', () => {
    assert.equal(decidirDistribuicao(ctx({})).estado, 'DRAFT_AUTOMATICO')
    assert.equal(decidirDistribuicao(ctx({ appAprovadoPeloProvider: false })).estado, 'DRAFT_AUTOMATICO', 'o rascunho não depende da auditoria')
    assert.equal(decidirDistribuicao(ctx({ scopesConcedidos: ['video.publish', 'video.upload'], appAprovadoPeloProvider: true })).estado, 'AUTO_PUBLICAVEL')
    assert.equal(decidirDistribuicao(ctx({ scopesConcedidos: ['user.info.basic'] })).estado, 'AGUARDANDO_OAUTH')
    assert.equal(decidirDistribuicao(ctx({ pendenciasDeCompliance: ['Quality Gate BLOQUEADO — não publica: x'] })).podeExecutarSozinho, false)
  })
  test('adaptador registrado com a mesma capacidade do preflight, e DESLIGADO sem PUBLICACAO_REAL_TIKTOK', () => {
    assert.ok(ADAPTADORES_DISPONIVEIS.tiktok)
    assert.deepEqual(Object.keys(ADAPTADORES_DISPONIVEIS).sort(), Object.keys(CAPACIDADE_REAL_DO_ADAPTER).sort())
    assert.equal(adaptadoresHabilitados({}).tiktok, undefined)
    assert.ok(adaptadoresHabilitados({ PUBLICACAO_REAL_TIKTOK: 'true' }).tiktok)
  })
  test('rascunho por FILE_UPLOAD (endpoint oficial), confirmação pendente com o publish_id', async () => {
    const chamadas: { url: string; metodo: string; corpo?: string }[] = []
    const fetcher = (async (url: string, init?: RequestInit) => {
      chamadas.push({ url: String(url), metodo: init?.method ?? 'GET', corpo: typeof init?.body === 'string' ? init.body : undefined })
      if (String(url).includes('/inbox/video/init/')) return new Response(JSON.stringify({ data: { publish_id: 'FIXTURE-pub-1', upload_url: 'https://upload.fixture/u' }, error: { code: 'ok' } }), { status: 200 })
      return new Response('', { status: 201 })
    }) as typeof fetch
    const adaptador = criarAdaptadorTikTok({
      fetcher,
      obterToken: async () => ({ accessToken: 'FIXTURE-token', openId: 'FIXTURE-open', scope: 'user.info.basic,video.upload' }),
      baixarVideo: async () => Buffer.alloc(1024, 1),
    })
    const r = await adaptador.enviarDraft!({ canal: 'tiktok', workspaceId: 'w', publicacaoId: 'p', legenda: 'x', urlParaDivulgar: '', assetUrl: 'https://storage.fixture/v.mp4', formato: 'VIDEO_PROPRIO' })
    assert.deepEqual(r.confirmacaoPendente, { referencia: 'FIXTURE-pub-1', modo: 'RASCUNHO' })
    assert.equal(r.publicacaoExternaId, null, 'publish_id NÃO é id de post')
    assert.equal(chamadas[0].url, 'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/')
    assert.match(chamadas[0].corpo ?? '', /"source":"FILE_UPLOAD"/)
    assert.equal(chamadas[1].metodo, 'PUT')
    // Direct Post sem privacidade escolhida: recusado (exigência da auditoria).
    const direto = await criarAdaptadorTikTok({ fetcher, obterToken: async () => ({ accessToken: 't', openId: 'o', scope: 'video.publish' }), baixarVideo: async () => Buffer.alloc(10) }).publicar!({ canal: 'tiktok', workspaceId: 'w', publicacaoId: 'p', legenda: 'x', urlParaDivulgar: '', assetUrl: 'https://s/v.mp4', formato: 'VIDEO_PROPRIO' })
    assert.equal(direto.ok, false)
    assert.match(direto.erro ?? '', /privacidade/)
  })
  test('rotas novas exigem sessão + módulo', () => {
    assert.deepEqual(regraDaRota('/api/tiktok/assistido/x/aprovar', 'POST')?.modulos, ['oportunidades', 'aprovacao'])
    assert.deepEqual(regraDaRota('/api/tiktok/resultados/x', 'PATCH')?.modulos, ['oportunidades', 'relatorios'])
    assert.deepEqual(regraDaRota('/api/torre', 'GET')?.modulos, ['dashboard'])
  })
})

const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')

describe('P1/P4 — banco de TESTE: modo assistido de ponta a ponta', { skip: !TEM_BANCO ? 'exige banco de TESTE' : false }, () => {
  let prisma: typeof import('../lib/prisma').prisma
  let A: typeof import('../lib/publicacao-assistida')
  let R: typeof import('../lib/resultados-videos')
  let T: typeof import('../lib/tiktok-acompanhamento')
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  let V: typeof import('../lib/video-assistido')
  let M: typeof import('../lib/midia-do-produto')
  let RT: typeof import('./_render-de-teste')
  const PREFIXO = 'Conta de Teste — '
  const marca = `r82-${Date.now()}`
  const ws: string[] = []
  const users: string[] = []
  const AGORA = new Date('2026-11-20T12:00:00-03:00')

  before(async () => {
    ;[{ prisma }, A, R, T, { limparWorkspaceDeTeste: limpar }, V, M, RT] = await Promise.all([
      import('../lib/prisma'), import('../lib/publicacao-assistida'), import('../lib/resultados-videos'), import('../lib/tiktok-acompanhamento'), import('./_limpar-workspace-de-teste'),
      import('../lib/video-assistido'), import('../lib/midia-do-produto'), import('./_render-de-teste'),
    ])
    // P2.17.12: render REAL (ffmpeg-static local), sem rede nem storage.
    V.definirPortasDoRender(RT.portasDeTeste())
    for (const n of ['A', 'B']) {
      const w = (await prisma.workspace.create({ data: { name: `${PREFIXO}assistido ${n} P2.17.10`, ownerId: `${marca}-${n}` }, select: { id: true } })).id
      ws.push(w)
      users.push((await prisma.user.create({ data: { email: `${marca}-${n}@teste.local`, name: 'U', password: 'x', workspaceId: w }, select: { id: true } })).id)
    }
    const cand = (i: number) => ({
      workspaceId: ws[0], chaveDeOrigem: `${marca}-${i}`, fonte: 'USER_PROVIDED', nome: `FIXTURE Árvore de Natal ${i}`, categoria: 'Casa e Decoração', preco: 199,
      linkProduto: `https://shop.tiktok.com/br/pdp/90000000000000008${i}`, providerId: 'tiktok-shop', externalId: `90000000000000008${i}`,
      score: 70, baseDeEvidencia: 60 - i, confianca: 'SEM_HISTORICO_REAL', status: 'APRESENTADO' as const, coletadoEm: AGORA, validoAte: new Date('2027-01-01'),
      motivosPositivos: [], riscos: [], desconhecidos: [], porqueDestaPosicao: [], nivelDeRisco: 'BAIXO',
    })
    for (const i of [1, 2]) await prisma.candidatoDeProduto.create({ data: cand(i) })
  })
  after(async () => {
    V?.definirPortasDoRender(null)
    for (const w of ws) {
      await prisma.midiaDoProduto.deleteMany({ where: { workspaceId: w } })
      await limpar(prisma, w, PREFIXO)
    }
    await prisma?.$disconnect()
  })

  test('tabela nova com RLS e sem acesso público', async () => {
    const [l] = await prisma.$queryRaw<{ rls: boolean; acesso: boolean }[]>`
      select c.relrowsecurity as rls,
        (has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE')) as acesso
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'PublicacaoAssistida'`
    assert.deepEqual([l.rls, l.acesso], [true, false])
  })

  let primeira = ''
  test('preparar SEM mídia autorizada: roteiro checado, AGUARDANDO_MIDIA, nada para aprovar (nada publicado)', async () => {
    const a = await A.prepararProximaPublicacao({ workspaceId: ws[0], userId: users[0], agora: AGORA })
    primeira = a.id
    assert.equal(a.estado, 'AGUARDANDO_MIDIA')
    assert.equal((a.qualityGate as { veredito: string }).veredito, 'APROVADO')
    const ap = a.apresentacao as { produto: { nome: string; comissaoTexto: string }; versao: { legenda: string; estrutura: string }; video: { situacao: string; arquivo: string | null }; missoes: string[]; horarioOrigem: string }
    assert.match(ap.produto.nome, /FIXTURE Árvore/)
    assert.match(ap.produto.comissaoTexto, /não informada/)
    assert.match(ap.versao.legenda, /comiss/i)
    assert.deepEqual([ap.video.situacao, ap.video.arquivo], ['FALTA_MIDIA_AUTORIZADA', null])
    assert.ok(!['DEMONSTRACAO', 'UNBOXING'].includes(ap.versao.estrutura), 'uso físico só com vídeo dela')
    assert.match(ap.horarioOrigem, /hipótese/)
    assert.equal(await prisma.publicacao.count({ where: { workspaceId: ws[0] } }), 0)
    await assert.rejects(A.aprovarEPublicar({ workspaceId: ws[0], userId: users[0], id: a.id, agora: AGORA, env: {} }), /nada a aprovar|ainda não foi gerado/)
    // Uma por vez: preparar de novo devolve a mesma.
    assert.equal((await A.prepararProximaPublicacao({ workspaceId: ws[0], userId: users[0], agora: AGORA })).id, a.id)
  })

  test('mídia AUTORIZADA chega → o vídeo é gerado sozinho, checado e SÓ ENTÃO vai para aprovação', async () => {
    const a = await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id: primeira } })
    await M.registrarMidia({ workspaceId: ws[0], candidatoId: a.candidatoId, nomeProduto: a.nomeProduto, declaracao: RT.declaracaoFixture('r82', users[0]) })
    const r = await A.prepararProximaPublicacao({ workspaceId: ws[0], userId: users[0], agora: AGORA })
    assert.equal(r.id, primeira)
    assert.equal(r.estado, 'AGUARDANDO_APROVACAO')
    const ap = r.apresentacao as { video: { situacao: string; arquivo: string | null; evidencia?: { origem: string } } }
    assert.equal(ap.video.situacao, 'GERADO')
    assert.match(ap.video.arquivo ?? '', /\/storage\/v1\/object\/public\/videos\//)
    assert.equal(ap.video.evidencia?.origem, 'DERIVADO')
    const qg = r.qualityGate as { veredito: string; arquivo?: { valido: boolean; duracaoS: number; direitoPublicavel: boolean } }
    assert.equal(qg.veredito, 'APROVADO')
    assert.deepEqual([qg.arquivo?.valido, qg.arquivo?.direitoPublicavel], [true, true])
    assert.ok(A.statusReal(r).etapas.includes('QUALITY GATE APROVADO'))
  })

  test('PEDIR AJUSTE: nova versão, vídeo gerado de novo (mesma mídia reaproveitada), histórico com o motivo', async () => {
    const r = await A.pedirAjuste({ workspaceId: ws[0], userId: users[0], id: primeira, motivo: 'Quero um gancho mais curto', alteracoes: { gancho: 'Olha essa árvore de 2,40 m' }, agora: AGORA })
    assert.equal(r.versao, 2)
    assert.equal(r.estado, 'AGUARDANDO_APROVACAO')
    const h = r.historico as { acao: string; detalhe?: string }[]
    assert.ok(h.some((x) => x.acao === 'AJUSTE_PEDIDO' && x.detalhe === 'Quero um gancho mais curto'))
    assert.ok((r.apresentacao as { video: { arquivo: string | null } }).video.arquivo)
    assert.equal(await prisma.midiaDoProduto.count({ where: { workspaceId: ws[0] } }), 1, 'a mídia não foi pedida de novo')
  })

  test('alteração que reprova na checagem: nada é aprovado; gancho escrito no vídeo só muda por ajuste', async () => {
    await assert.rejects(A.aprovarEPublicar({ workspaceId: ws[0], userId: users[0], id: primeira, alteracoes: { legenda: 'sem aviso' }, agora: AGORA }), /checagem de qualidade/)
    await assert.rejects(A.aprovarEPublicar({ workspaceId: ws[0], userId: users[0], id: primeira, alteracoes: { gancho: 'outro gancho' }, agora: AGORA }), /Pedir ajuste/)
    assert.equal((await prisma.publicacaoAssistida.findUnique({ where: { id: primeira } }))?.estado, 'AGUARDANDO_APROVACAO')
  })

  test('APROVAR E PUBLICAR com o TikTok indisponível: fica APROVADO com "BLOQUEADO PELO TIKTOK — falta…"; clique duplo não duplica', async () => {
    const [a, b] = await Promise.allSettled([
      A.aprovarEPublicar({ workspaceId: ws[0], userId: users[0], id: primeira, agora: AGORA, env: {} }),
      A.aprovarEPublicar({ workspaceId: ws[0], userId: users[0], id: primeira, agora: AGORA, env: {} }),
    ])
    assert.equal([a, b].filter((x) => x.status === 'fulfilled').length, 1)
    const r = await prisma.publicacaoAssistida.findUnique({ where: { id: primeira } })
    assert.equal(r?.estado, 'APROVADO')
    assert.match(r?.bloqueio ?? '', /BLOQUEADO PELO TIKTOK — falta o app aprovado/)
    assert.doesNotMatch(r?.bloqueio ?? '', /Falta o arquivo de vídeo/, 'o MP4 existe: o único bloqueio é o TikTok')
    assert.equal(r?.aprovadoDePrimeira, false, 'houve ajuste antes')
    const conteudo = await prisma.conteudo.findFirst({ where: { id: r!.conteudoId! } })
    assert.equal(conteudo?.status, 'aprovado')
    // O Conteúdo carrega o MP4 e a cadeia de direitos dele (a porta única confere).
    assert.equal(conteudo?.videoUrl, (r!.apresentacao as { video: { arquivo: string } }).video.arquivo)
    assert.ok((conteudo?.alertasCompliance as { tipo?: string; origem?: string }[]).some((x) => x.tipo === 'direito_da_midia' && x.origem === 'DERIVADO'))
    assert.equal(await prisma.publicacao.count({ where: { workspaceId: ws[0] } }), 0, 'nada saiu: a decisão bloqueou antes de criar publicação')
  })

  test('contingência: link do vídeo → PUBLICADO 1/10, resultado criado com métricas NULL', async () => {
    await assert.rejects(A.registrarPublicacaoManual({ workspaceId: ws[0], userId: users[0], id: primeira, url: 'https://golpe.example/x' }), /link do vídeo no TikTok/)
    const r = await A.registrarPublicacaoManual({ workspaceId: ws[0], userId: users[0], id: primeira, url: 'https://www.tiktok.com/@fixture/video/7500000000000000001', agora: AGORA })
    assert.deepEqual([r.estado, r.ordem, r.postId, r.modoDePublicacao], ['PUBLICADO', 1, '7500000000000000001', 'MANUAL_PELA_TITULAR'])
    const res = await prisma.videoTikTokResultado.findFirst({ where: { publicacaoAssistidaId: primeira } })
    assert.deepEqual([res?.views, res?.vendas, res?.comissao], [null, null, null])
    assert.match(res?.nomeProduto ?? '', /FIXTURE Árvore/)
  })

  test('P1: métricas reais entram (CTR derivado), inválidas são recusadas, ausente continua null', async () => {
    const res = await prisma.videoTikTokResultado.findFirstOrThrow({ where: { publicacaoAssistidaId: primeira } })
    await assert.rejects(R.atualizarMetricas({ workspaceId: ws[0], userId: users[0], id: res.id, metricas: { vendas: 1.5 }, origem: 'MANUAL' }), /inteiro/)
    await assert.rejects(R.atualizarMetricas({ workspaceId: ws[1], userId: users[1], id: res.id, metricas: { views: 1 }, origem: 'MANUAL' }), /não encontrado/)
    const r = await R.atualizarMetricas({ workspaceId: ws[0], userId: users[0], id: res.id, metricas: { views: 4000, cliquesProduto: 80, vendas: 2, comissao: 19.18 }, origem: 'MANUAL' })
    assert.equal(r.ctr, 0.02)
    assert.equal(r.retencaoMedia, null)
    const painel = await R.painelDeResultados(ws[0])
    assert.equal(painel.resultados[0].derivadas.conversaoCliqueVenda, 0.025)
    assert.equal(painel.aprendizado.length, 7)
    const prod = painel.produtos.find((p) => p.vendas === 2)
    assert.equal(prod?.status, 'PROMISSOR')
  })

  test('REJEITAR: motivo registrado e o Patrono já apresenta outra opção', async () => {
    const nova = await A.prepararProximaPublicacao({ workspaceId: ws[0], userId: users[0], agora: AGORA })
    assert.ok(['AGUARDANDO_APROVACAO', 'AGUARDANDO_MIDIA'].includes(nova.estado))
    const proxima = await A.rejeitar({ workspaceId: ws[0], userId: users[0], id: nova.id, motivo: 'Não gostei do produto', agora: AGORA })
    assert.equal((await prisma.publicacaoAssistida.findUnique({ where: { id: nova.id } }))?.estado, 'REJEITADO')
    assert.ok(proxima && proxima.id !== nova.id, 'reapresenta outra opção')
    assert.notEqual(proxima!.varianteId === nova.varianteId && proxima!.candidatoId === nova.candidatoId, true, 'não repete a mesma versão rejeitada')
  })

  test('relatório: só recomenda em 10/10 e NUNCA ativa a automação', async () => {
    const r1 = await A.relatorioDeTransicao(ws[0])
    assert.deepEqual([r1.concluidas, r1.final, r1.recomendacao, r1.ativaAutomacao], [1, false, null, false])
    // Completa 10 publicações (FIXTURE) para ver a recomendação.
    for (let i = 2; i <= 10; i++) {
      const a = await prisma.publicacaoAssistida.create({
        data: { workspaceId: ws[0], estado: 'APROVADO', nomeProduto: `FIXTURE P${i}`, varianteId: 'DEMONSTRACAO-A-CURTA', estrutura: 'DEMONSTRACAO', apresentacao: { produto: { categoria: 'Casa' }, versao: { estrutura: 'DEMONSTRACAO', gancho: 'g', cta: 'Toque no produto marcado no vídeo.', duracaoSegundos: 15, roteiro: [] } }, qualityGate: { veredito: 'APROVADO' }, aprovadoDePrimeira: true, motivoEscolha: 'x', objetivoDoTeste: 'x', metasIds: [] },
      })
      await A.concluirPublicacaoAssistida({ workspaceId: ws[0], id: a.id, postId: `75000000000000000${10 + i}`, url: null, modo: 'MANUAL_PELA_TITULAR', agora: new Date(AGORA.getTime() + i * 3_600_000) })
    }
    const r = await A.relatorioDeTransicao(ws[0])
    assert.equal(r.concluidas, 10)
    assert.ok(r.recomendacao === 'MANTER ASSISTIDO' || r.recomendacao === 'APTO PARA AUTOMAÇÃO')
    assert.equal(r.recomendacao, 'MANTER ASSISTIDO', 'poucos vídeos com métricas: evidência insuficiente')
    assert.equal(r.ativaAutomacao, false)
    const politica = await prisma.policyVersion.count({ where: { workspaceId: ws[0] } })
    assert.equal(politica, 0, 'nenhuma política criada/alterada')
    const ordens = (await prisma.publicacaoAssistida.findMany({ where: { workspaceId: ws[0], estado: 'PUBLICADO' }, select: { ordem: true } })).map((x) => x.ordem).sort((a, b) => (a ?? 0) - (b ?? 0))
    assert.deepEqual(ordens, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  test('P5: rascunho pendente → status oficial com post_id público → DISTRIBUIDA + assistida PUBLICADO', async () => {
    const produto = await prisma.produto.create({ data: { workspaceId: ws[1], userId: users[1], nome: 'FIXTURE Produto B', categoria: 'Casa', origemConteudo: 'Próprio', tipoVenda: 'Afiliado', imagens: [], videos: [], publicoAlvo: [], beneficios: [], pontosNegativos: [] } })
    const conteudo = await prisma.conteudo.create({ data: { workspaceId: ws[1], userId: users[1], produtoId: produto.id, status: 'aprovado' } })
    const pub = await prisma.publicacao.create({ data: { workspaceId: ws[1], contentId: conteudo.id, provider: 'TIKTOK', canal: 'tiktok', chaveDaTentativa: `${marca}-t1`, estado: 'DISTRIBUINDO', evidencia: { tipo: 'ENVIO_PENDENTE', canal: 'tiktok', referencia: 'FIXTURE-pub-9', modo: 'RASCUNHO', enviadoEm: AGORA.toISOString(), etapa: 'ENVIADO' } } })
    const assistida = await prisma.publicacaoAssistida.create({
      data: { workspaceId: ws[1], estado: 'PUBLICANDO', nomeProduto: 'FIXTURE Produto B', varianteId: 'v', estrutura: 'DEMONSTRACAO', publicacaoId: pub.id, publishId: 'FIXTURE-pub-9', modoDePublicacao: 'API_RASCUNHO', apresentacao: { produto: { categoria: 'Casa' }, versao: { estrutura: 'DEMONSTRACAO', gancho: 'g', cta: 'Toque no produto marcado no vídeo.', duracaoSegundos: 15, roteiro: [] } }, qualityGate: { veredito: 'APROVADO' }, motivoEscolha: 'x', objetivoDoTeste: 'x', metasIds: [] },
    })
    let status = 'SEND_TO_USER_INBOX'
    const fetcher = (async (url: string) => {
      // Como o TikTok envia: int64 SEM aspas (JSON.parse arredondaria).
      if (String(url).includes('/status/fetch/')) return new Response(`{"data":{"status":"${status}","publicaly_available_post_id":[${status === 'PUBLISH_COMPLETE' ? '7500000000000000999' : ''}]},"error":{"code":"ok"}}`, { status: 200 })
      return new Response(JSON.stringify({ data: { videos: [{ id: '7500000000000000999', share_url: 'https://www.tiktok.com/@fixture/video/7500000000000000999' }] } }), { status: 200 })
    }) as typeof fetch
    const token = async () => ({ accessToken: 'FIXTURE', openId: 'o', scope: 'user.info.basic,video.upload,video.list' })
    await T.acompanharPublicacoesTikTok({ workspaceId: ws[1], fetcher, obterToken: token })
    assert.match((await prisma.publicacaoAssistida.findUnique({ where: { id: assistida.id } }))?.bloqueio ?? '', /caixa de entrada.*marque o produto/)
    assert.equal((await prisma.publicacao.findUnique({ where: { id: pub.id } }))?.estado, 'DISTRIBUINDO')
    status = 'PUBLISH_COMPLETE'
    await T.acompanharPublicacoesTikTok({ workspaceId: ws[1], fetcher, obterToken: token })
    const p = await prisma.publicacao.findUnique({ where: { id: pub.id } })
    assert.deepEqual([p?.estado, p?.publicacaoExternaId], ['DISTRIBUIDA', '7500000000000000999'])
    const a = await prisma.publicacaoAssistida.findUnique({ where: { id: assistida.id } })
    assert.deepEqual([a?.estado, a?.ordem, a?.urlPublicada], ['PUBLICADO', 1, 'https://www.tiktok.com/@fixture/video/7500000000000000999'])
    // Idempotente: consultar de novo não muda nada.
    assert.equal((await T.acompanharPublicacoesTikTok({ workspaceId: ws[1], fetcher, obterToken: token })).consultadas, 0)
  })

  test('P8: Torre de Controle — consolida dado real, 8 etapas, nada inventado', async () => {
    const { torreDeControle } = await import('../lib/torre-de-controle')
    const t = await torreDeControle(ws[0], new Date(AGORA.getTime() + 12 * 3_600_000))
    assert.deepEqual(t.jornada.map((j) => j.etapa), ['DESCOBRINDO', 'ANALISANDO', 'GERANDO', 'VALIDANDO', 'APROVANDO', 'PUBLICANDO', 'VENDENDO', 'APRENDENDO'])
    assert.deepEqual([t.assistido.concluidas, t.assistido.limite], [10, 10])
    assert.equal(t.receita.trinta.comissao, 19.18, 'só a comissão registrada (um vídeo medido)')
    assert.equal(t.receita.trinta.vendas, 2)
    assert.ok(t.dinheiro.length <= 3)
    assert.equal(t.status.tiktok.nivel, 'BLOQUEADO')
    const vazio = await torreDeControle(ws[1])
    assert.equal(vazio.receita.hoje.comissao === null || typeof vazio.receita.hoje.comissao === 'number', true)
    assert.equal(vazio.assistido.concluidas, 1)
  })

  test('isolamento: nada do workspace A aparece no B', async () => {
    assert.equal(await prisma.publicacaoAssistida.count({ where: { workspaceId: ws[1], nomeProduto: { contains: 'Árvore' } } }), 0)
    assert.equal((await R.painelDeResultados(ws[1])).resultados.every((r) => !/Árvore/.test(r.nomeProduto ?? '')), true)
  })
})
