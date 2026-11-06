/**
 * P2.17.3 — Consultor de afiliados, Metas do TikTok Shop e Motor de Vídeos.
 * Missões e produtos aqui são de TESTE (nomes "FIXTURE"/"Teste").
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { analisarMeta, analisarMetas, priorizarProdutosTikTok, validarDadosDaMeta, type MetaParaAnalise } from '../lib/metas-tiktok'
import { planejarVideos, alegacoesDoPlano, estruturasPossiveis, potencialDeViralizacao, CTA_A } from '../lib/motor-de-videos-tiktok'
import { consultar, type EntradaDoConsultor } from '../lib/consultor-afiliados'
import { regraDaRota } from '../lib/modulos-rotas'

const AGORA = new Date('2026-11-20T15:00:00Z')
const dias = (n: number) => new Date(AGORA.getTime() + n * 24 * 60 * 60 * 1000)
const meta = (extra: Partial<MetaParaAnalise>): MetaParaAnalise => ({
  id: 'm', nome: 'FIXTURE Missão de Natal', tipo: 'VIDEOS_COM_PRODUTO', inicio: dias(-7), fim: dias(3),
  recompensaValor: 50, recompensaDescricao: null, quantidadeExigida: 10, quantidadeRealizada: 6, requisitos: null, ...extra,
})

describe('P2.17.3 — metas do TikTok Shop', () => {
  test('o exemplo da titular: faltam 4, temos 3 dias, hoje recomendo publicar 2', () => {
    const a = analisarMeta(meta({}), AGORA)
    assert.equal(a.faltam, 4)
    assert.equal(a.diasRestantes, 3)
    assert.equal(a.hojeRecomendado, 2)
    assert.equal(a.situacao, 'EM_ANDAMENTO')
    assert.ok(a.frases.includes('Faltam 4 vídeo(s) com produto à venda para concluir esta missão.'))
    assert.ok(a.frases.includes('Temos 3 dias.'))
    assert.ok(a.frases.includes('Hoje recomendo publicar 2.'))
    assert.ok(a.frases.some((f) => /Recompensa: R\$\s?50,00/.test(f)))
    assert.match(a.proximaAcao, /Gravar 2 vídeo/)
  })
  test('risco: ritmo acima do sustentável = alto; prazo acabou = perdida; concluída = nenhum', () => {
    assert.equal(analisarMeta(meta({ quantidadeExigida: 30, quantidadeRealizada: 0, fim: dias(2) }), AGORA).risco, 'ALTO')
    const perdida = analisarMeta(meta({ fim: dias(-1) }), AGORA)
    assert.equal(perdida.situacao, 'EXPIRADA')
    assert.equal(perdida.risco, 'PERDIDA')
    assert.equal(perdida.prioridade, 0)
    const feita = analisarMeta(meta({ quantidadeRealizada: 10 }), AGORA)
    assert.equal(feita.situacao, 'CONCLUIDA')
    assert.equal(feita.risco, 'NENHUM')
  })
  test('prioridade: recompensa maior e prazo menor vêm primeiro; encerradas por último', () => {
    const lista = analisarMetas([
      meta({ id: 'pequena', recompensaValor: 10, fim: dias(10) }),
      meta({ id: 'grande-urgente', recompensaValor: 100, fim: dias(2) }),
      meta({ id: 'encerrada', fim: dias(-2) }),
    ], AGORA)
    assert.deepEqual(lista.map((a) => a.id), ['grande-urgente', 'pequena', 'encerrada'])
  })
  test('validação: fim depois do início, quantidade inteira > 0', () => {
    const base = { nome: 'x', tipo: 'OUTRO' as const, inicio: dias(0), fim: dias(1), recompensaValor: null, recompensaDescricao: null, quantidadeExigida: 1, quantidadeRealizada: 0, requisitos: null }
    assert.equal(validarDadosDaMeta(base), null)
    assert.match(validarDadosDaMeta({ ...base, fim: dias(-1) }) ?? '', /fim precisa ser depois/)
    assert.match(validarDadosDaMeta({ ...base, quantidadeExigida: 0 }) ?? '', /maior que zero/)
  })
})

describe('P2.17.3 — prioridade comercial no TikTok', () => {
  const p = (id: string, extra: Record<string, unknown>) => ({
    id, nome: 'FIXTURE', categoria: 'Casa e Decoração', preco: 50, providerId: null, linkProduto: null, baseDeEvidencia: 50,
    vendas: null, comissaoValor: null, comissaoPercentual: null, aderenciaNatal: null, ...extra,
  })
  const missao = analisarMetas([meta({})], AGORA)
  test('evidência primeiro; na mesma faixa, quem ajuda a missão; depois Natal, comissão e facilidade', () => {
    const ordem = priorizarProdutosTikTok([
      p('fraco-com-missao', { baseDeEvidencia: 40, providerId: 'tiktok-shop' }),
      p('forte', { baseDeEvidencia: 70 }),
      p('missao', { baseDeEvidencia: 52, providerId: 'tiktok-shop' }),
      p('natal', { baseDeEvidencia: 53, aderenciaNatal: 90 }),
      p('comissao', { baseDeEvidencia: 51, aderenciaNatal: 90, comissaoValor: 12 }),
    ], missao).map((x) => x.id)
    assert.deepEqual(ordem, ['forte', 'missao', 'comissao', 'natal', 'fraco-com-missao'])
  })
  test('sem missão de vídeo ativa, ser do TikTok Shop não dá prioridade de missão', () => {
    const r = priorizarProdutosTikTok([p('a', { providerId: 'tiktok-shop' })], [])
    assert.equal(r[0].ajudaMissao, false)
  })
})

describe('P2.17.3 — motor de vídeos', () => {
  const prod = { nome: 'FIXTURE Kit organizador de gavetas', categoria: 'Casa e Decoração', preco: 49.9, tiktokShop: true, vendas: 340 }
  test('variantes com gancho, roteiro, CTA do produto marcado, legenda com divulgação e teste A/B/C', () => {
    const plano = planejarVideos(prod, AGORA)
    assert.ok(plano.variantes.length >= 8)
    for (const v of plano.variantes) {
      assert.ok(v.gancho.length > 5 && v.gancho.length <= 80, v.gancho)
      assert.match(v.legenda, /comissão/)
      assert.equal(v.cta, CTA_A)
      assert.ok(v.duracaoSegundos === 15 || v.duracaoSegundos === 30)
    }
    assert.equal(plano.testeInicial.variantes.length, 3)
    assert.match(plano.testeInicial.explicacao, /ganchos diferentes \(A\/B\/C\)/)
    assert.ok(plano.variantes.find((v) => v.estrutura === 'DEMONSTRACAO')!.roteiro.some((r) => /340 vendidos no TikTok Shop \(dado da loja\)/.test(r.texto)))
  })
  test('nenhuma alegação sem prova e nunca promete viralizar', () => {
    const plano = planejarVideos(prod, AGORA)
    assert.deepEqual(alegacoesDoPlano(plano), [])
    const tudo = JSON.stringify(plano.variantes)
    assert.doesNotMatch(tudo, /vai viralizar|garantid[oa]|milagre/i)
    assert.match(plano.potencial.aviso, /Potencial, não promessa/)
  })
  test('sem vendas informadas, a "prova" é mostrar funcionando (nada inventado)', () => {
    const plano = planejarVideos({ ...prod, vendas: null }, AGORA)
    assert.ok(plano.variantes.every((v) => !/vendidos/.test(JSON.stringify(v.roteiro))))
  })
  test('estruturas respeitam o produto: antes/depois fora de Beleza; achado só TikTok Shop; experiência real sinalizada', () => {
    assert.ok(!estruturasPossiveis({ ...prod, categoria: 'Beleza' }, AGORA).includes('ANTES_DEPOIS'))
    assert.ok(!estruturasPossiveis({ ...prod, tiktokShop: false }, AGORA).includes('ACHADO_TIKTOK_SHOP'))
    const ugc = planejarVideos(prod, AGORA).variantes.find((v) => v.estrutura === 'UGC')!
    assert.equal(ugc.exigeExperienciaReal, true)
    assert.match(ugc.observacao ?? '', /realmente testou/)
  })
  test('potencial usa sinais reais e registra que ainda não há histórico próprio', () => {
    const pot = potencialDeViralizacao(prod, AGORA)
    assert.ok(['ALTO', 'MEDIO', 'BAIXO'].includes(pot.nivel))
    assert.ok(pot.sinais.includes('histórico dos nossos vídeos: ainda sem dados'))
  })
})

describe('P2.17.3 — consultor', () => {
  const base: EntradaDoConsultor = {
    nome: 'FIXTURE Boneca de pelúcia', categoria: 'Brinquedos', preco: 79.9, providerId: 'tiktok-shop', linkProduto: 'https://shop.tiktok.com/view/product/9000000000000000101',
    comissaoPercentual: 12, comissaoValor: 9.59, vendas: 520, baseDeEvidencia: 62, confianca: 'MEDIA', nivelDeRisco: 'BAIXO', riscos: [],
    complianceBloqueante: false, publicacaoImpedida: false, campanha: { nome: 'Natal 2026', aderencia: 70, tags: ['NATAL', 'PRESENTE', 'PRESENTE_INFANTIL'] },
  }
  test('vende + Natal: "Eu priorizaria este produto porque…", com as 10 respostas preenchidas', () => {
    const c = consultar(base, AGORA)
    assert.equal(c.veredito, 'PRIORIZAR')
    assert.match(c.resumo, /^Eu priorizaria este produto porque já vende de verdade, combina com Natal 2026/)
    for (const k of ['valeAPena', 'programa', 'canal', 'formato', 'comissao', 'evidencia', 'sazonalidade', 'risco', 'proximoPasso'] as const) assert.ok(c[k].length > 5, k)
    assert.match(c.programa, /TikTok Shop \(Afiliados\) — regras conferidas em \d{4}-\d{2}-\d{2} \(fonte: https?:\/\//)
    assert.match(c.canal, /produto marcado no vídeo/)
    assert.match(c.evidencia, /520 vendidos \(dado da loja\)/)
  })
  test('comissão boa sem evidência: "A comissão é boa, mas a evidência de venda ainda é fraca."', () => {
    const c = consultar({ ...base, vendas: null, baseDeEvidencia: 30, comissaoPercentual: 20, comissaoValor: 16, campanha: null }, AGORA)
    assert.equal(c.veredito, 'TESTAR')
    assert.match(c.resumo, /A comissão é boa, mas a evidência de venda ainda é fraca\./)
  })
  test('risco alto: "Eu evitaria este agora porque…"; nada conhecido: aguardar; desconhecido dito como desconhecido', () => {
    assert.equal(consultar({ ...base, nivelDeRisco: 'ALTO', riscos: ['Texto do produto sugere alegação médica (risco alto).'] }, AGORA).veredito, 'EVITAR')
    const nada = consultar({ ...base, providerId: null, linkProduto: 'https://loja.invalido/x', vendas: null, baseDeEvidencia: 30, comissaoPercentual: null, comissaoValor: null, campanha: null }, AGORA)
    assert.equal(nada.veredito, 'AGUARDAR')
    assert.match(nada.comissao, /Comissão não informada/)
    assert.match(nada.programa, /Programa não identificado/)
    assert.match(nada.canal, /link na bio/)
  })
  test('missão ativa entra na opinião', () => {
    const c = consultar({ ...base, vendas: null, baseDeEvidencia: 45, campanha: null, comissaoPercentual: 5, comissaoValor: 4 }, AGORA, analisarMetas([meta({})], AGORA))
    assert.equal(c.veredito, 'TESTAR')
    assert.match(c.resumo, /ajuda a cumprir uma missão do TikTok Shop/)
  })
})

describe('P2.17.3 — rotas e telas', () => {
  test('metas exigem o módulo Oportunidades; tudo com sessão e por workspace', () => {
    assert.deepEqual(regraDaRota('/api/tiktok/metas', 'POST')?.modulos, ['oportunidades'])
    assert.deepEqual(regraDaRota('/api/tiktok/metas/abc', 'PATCH')?.modulos, ['oportunidades'])
    assert.ok(regraDaRota('/api/tiktok/videos', 'GET')?.modulos.includes('oportunidades'))
    for (const f of ['app/api/tiktok/metas/route.ts', 'app/api/tiktok/metas/[id]/route.ts', 'app/api/tiktok/videos/route.ts']) {
      const src = fs.readFileSync(f, 'utf8')
      assert.match(src, /exigirSessao\(\)/, f)
      assert.match(src, /session\.user\.workspaceId/, f)
    }
    assert.match(fs.readFileSync('lib/navegacao.ts', 'utf8'), /href: '\/tiktok-metas', label: 'Metas TikTok Shop'/)
    assert.match(fs.readFileSync('app/(dashboard)/oportunidades/page.tsx', 'utf8'), /aria-label="Minha opinião"/)
  })
})

const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')

describe('P2.17.3 — banco de TESTE', { skip: !TEM_BANCO ? 'exige banco de TESTE' : false }, () => {
  let prisma: typeof import('../lib/prisma').prisma
  let M: typeof import('../lib/metas-tiktok')
  let H: typeof import('../lib/metas-tiktok-http')
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  const PREFIXO = 'Conta de Teste — '
  const marca = `r76-${Date.now()}`
  const ws: string[] = []
  const users: string[] = []

  before(async () => {
    ;[{ prisma }, M, H, { limparWorkspaceDeTeste: limpar }] = await Promise.all([import('../lib/prisma'), import('../lib/metas-tiktok'), import('../lib/metas-tiktok-http'), import('./_limpar-workspace-de-teste')])
    for (const n of ['A', 'B']) {
      const w = (await prisma.workspace.create({ data: { name: `${PREFIXO}metas ${n} P2.17.3`, ownerId: `${marca}-${n}` }, select: { id: true } })).id
      ws.push(w)
      users.push((await prisma.user.create({ data: { email: `${marca}-${n}@teste.local`, name: 'U', password: 'x', workspaceId: w }, select: { id: true } })).id)
    }
  })
  after(async () => {
    for (const w of ws) await limpar(prisma, w, PREFIXO)
    await prisma?.$disconnect()
  })

  test('tabela nova com RLS ligado e sem acesso de anon/authenticated', async () => {
    const [l] = await prisma.$queryRaw<{ rls: boolean; acesso: boolean }[]>`
      select c.relrowsecurity as rls,
        (has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE')) as acesso
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'MetaTikTokShop'`
    assert.equal(l.rls, true)
    assert.equal(l.acesso, false)
  })

  test('registrar, avançar, arquivar; o outro workspace não enxerga nem altera', async () => {
    const lido = H.lerMeta({ nome: 'FIXTURE Missão vídeos com produto', tipo: 'VIDEOS_COM_PRODUTO', inicio: new Date(Date.now() - 86400000).toISOString(), fim: new Date(Date.now() + 3 * 86400000).toISOString(), recompensaValor: 50, quantidadeExigida: 10, quantidadeRealizada: 6 })
    assert.ok(lido.ok)
    if (!lido.ok) return
    const m = await M.criarMeta({ workspaceId: ws[0], userId: users[0], dados: lido.dados })
    const mais = await M.atualizarMeta({ workspaceId: ws[0], userId: users[0], id: m.id, mudanca: { incremento: 1 } })
    assert.equal(mais.quantidadeRealizada, 7)
    await assert.rejects(M.atualizarMeta({ workspaceId: ws[1], userId: users[1], id: m.id, mudanca: { incremento: 1 } }), (e: Error) => /não encontrada/.test(e.message))
    const painel = await H.painelDeMetas(ws[0])
    assert.equal(painel.metas.length, 1)
    assert.equal(painel.metas[0].faltam, 3)
    assert.equal(painel.resumo.recompensaEmJogo, 50)
    assert.ok(painel.resumo.videosHoje >= 1)
    assert.equal((await H.painelDeMetas(ws[1])).metas.length, 0)
    await M.atualizarMeta({ workspaceId: ws[0], userId: users[0], id: m.id, mudanca: { arquivar: true } })
    assert.equal((await H.painelDeMetas(ws[0])).metas.length, 0)
    assert.ok(await prisma.auditLog.findFirst({ where: { workspaceId: ws[0], action: 'tiktok.meta_arquivada' } }))
  })

  test('entrada inválida volta com frase clara', () => {
    const r = H.lerMeta({ nome: 'x', tipo: 'VIDEOS_COM_PRODUTO', inicio: 'ontem', fim: '2026-12-01', quantidadeExigida: 5 })
    assert.ok(!r.ok && /Data de início inválida/.test(r.mensagem))
  })
})
