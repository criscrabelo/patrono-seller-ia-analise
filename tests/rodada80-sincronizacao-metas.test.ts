/**
 * P2.17.5 — TikTok Mission Sync: idempotência, histórico (anterior → novo),
 * ausência com confirmação, reação do consultor, fonte honesta e isolamento.
 * Missões abaixo são FIXTURE de teste (dados fictícios), exceto o exemplo
 * "Metas de Outubro", que reproduz o print da titular com progresso 0.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { planejarSincronizacao, reagir, chavesDoTexto, type MissaoDaFonte, type MetaExistente } from '../lib/sincronizacao-metas-tiktok'
import { estadoDaApiOficial, estadoDaAutomacaoWeb, melhorFonteAutomatica } from '../lib/fonte-missoes-tiktok'
import { lerTextoDeMetas } from '../lib/importar-metas-tiktok'
import { regraDaRota } from '../lib/modulos-rotas'

const AGORA = new Date('2026-10-11T12:00:00-03:00')
const INICIO = new Date('2026-10-10T00:00:00-03:00')
const FIM = new Date('2026-10-19T23:59:59-03:00')

function missao(chave: string, extra: Partial<MissaoDaFonte> = {}): MissaoDaFonte {
  return {
    chave, campanha: 'FIXTURE Campanha', nome: `FIXTURE ${chave}`, tipo: 'VIDEOS_QUALIFICADOS', inicio: INICIO, fim: FIM,
    recompensaValor: null, recompensaCampanha: 100, recompensaDescricao: null, quantidadeExigida: 10, quantidadeRealizada: 0, requisitos: null, ...extra,
  }
}
function existente(id: string, m: MissaoDaFonte, extra: Partial<MetaExistente> = {}): MetaExistente {
  const { chave, ...resto } = m
  return { ...resto, id, chaveExterna: chave, status: 'ATIVA', ausenciasSeguidas: 0, fonteSincronizacao: 'API_OFICIAL', ...extra }
}
const COMPLETA = { tipo: 'COMPLETA' as const, fonte: 'API_OFICIAL' as const }

describe('P2.17.5 — planejamento (puro)', () => {
  test('missão nova = CRIAR; a mesma leitura de novo = INALTERADA (idempotente)', () => {
    const m = missao('a')
    assert.deepEqual(planejarSincronizacao({ existentes: [], recebidas: [m], escopo: COMPLETA }).map((a) => a.tipo), ['CRIAR'])
    assert.deepEqual(planejarSincronizacao({ existentes: [existente('1', m)], recebidas: [m], escopo: COMPLETA }).map((a) => a.tipo), ['INALTERADA'])
  })
  test('chave repetida na leitura não duplica', () => {
    const acoes = planejarSincronizacao({ existentes: [], recebidas: [missao('a'), missao('a', { quantidadeRealizada: 2 })], escopo: COMPLETA })
    assert.equal(acoes.length, 1)
    assert.equal(acoes[0].tipo === 'CRIAR' && acoes[0].missao.quantidadeRealizada, 2)
  })
  test('progresso, prazo e recompensa mudam com valor anterior e novo', () => {
    const m = missao('a')
    const nova = missao('a', { quantidadeRealizada: 4, fim: new Date('2026-10-21T23:59:59-03:00'), recompensaCampanha: 150 })
    const [a] = planejarSincronizacao({ existentes: [existente('1', m)], recebidas: [nova], escopo: COMPLETA })
    assert.equal(a.tipo, 'ATUALIZAR')
    if (a.tipo !== 'ATUALIZAR') return
    const porCampo = Object.fromEntries(a.mudancas.map((x) => [x.campo, [x.anterior, x.novo]]))
    assert.deepEqual(porCampo.quantidadeRealizada, ['0', '4'])
    assert.deepEqual(porCampo.recompensaCampanha, ['100', '150'])
    assert.ok(porCampo.fim)
  })
  test('sumiu: 1ª vez AUSENTE (não apaga); 2ª seguida ENCERRAR; voltar = reapareceu', () => {
    const m = missao('a')
    assert.deepEqual(planejarSincronizacao({ existentes: [existente('1', m)], recebidas: [missao('b')], escopo: COMPLETA }).map((a) => a.tipo).sort(), ['AUSENTE', 'CRIAR'])
    const segunda = planejarSincronizacao({ existentes: [existente('1', m, { ausenciasSeguidas: 1 })], recebidas: [missao('b')], escopo: COMPLETA })
    assert.ok(segunda.some((a) => a.tipo === 'ENCERRAR' && a.ausencias === 2))
    const volta = planejarSincronizacao({ existentes: [existente('1', m, { status: 'ENCERRADA', ausenciasSeguidas: 2 })], recebidas: [m], escopo: COMPLETA })
    assert.ok(volta[0].tipo === 'INALTERADA' && volta[0].reapareceu)
  })
  test('meta manual (sem chave) nunca é encerrada; é ADOTADA quando a fonte traz a mesma campanha/tipo/início', () => {
    const manual = existente('m', missao('x'), { chaveExterna: null, fonteSincronizacao: null })
    assert.deepEqual(planejarSincronizacao({ existentes: [manual], recebidas: [missao('b', { tipo: 'SOLICITAR_AMOSTRAS' })], escopo: COMPLETA }).map((a) => a.tipo), ['CRIAR'])
    const [a] = planejarSincronizacao({ existentes: [manual], recebidas: [missao('nova-chave', { quantidadeRealizada: 1 })], escopo: COMPLETA })
    assert.ok(a.tipo === 'ATUALIZAR' && a.adotada && a.metaId === 'm')
  })
  test('arquivada pela titular: não reativa nem altera', () => {
    const m = missao('a')
    const [a] = planejarSincronizacao({ existentes: [existente('1', m, { status: 'ARQUIVADA' })], recebidas: [missao('a', { quantidadeRealizada: 9 })], escopo: COMPLETA })
    assert.equal(a.tipo, 'ARQUIVADA_PELA_TITULAR')
  })
  test('escopo de campanha: ausência só vale para metas da mesma campanha', () => {
    const outra = existente('o', missao('o', { campanha: 'FIXTURE Outra' }))
    const acoes = planejarSincronizacao({ existentes: [outra], recebidas: [missao('a')], escopo: { tipo: 'CAMPANHA', campanha: 'FIXTURE Campanha' } })
    assert.deepEqual(acoes.map((a) => a.tipo), ['CRIAR'])
  })
  test('chave do texto: nome corrigido na revisão não muda a chave; dois do mesmo tipo desempatam pelo nome', () => {
    const base = { campanha: 'Metas de Outubro', tipo: 'VIDEOS_QUALIFICADOS', inicio: INICIO }
    assert.equal(chavesDoTexto([{ ...base, nome: 'Vídeos qualificados' }])[0], chavesDoTexto([{ ...base, nome: 'Videos qualificados publicados' }])[0])
    const [k1, k2] = chavesDoTexto([{ ...base, nome: 'A' }, { ...base, nome: 'B' }])
    assert.notEqual(k1, k2)
  })
})

describe('P2.17.5 — reação do consultor (pura)', () => {
  test('novas metas, recompensa subiu, prazo, mais urgente com quanto falta e dias', () => {
    const m = missao('a')
    const acoes = planejarSincronizacao({
      existentes: [existente('1', m)],
      recebidas: [missao('a', { recompensaCampanha: 150, quantidadeRealizada: 7, fim: new Date('2026-10-12T23:59:59-03:00') }), missao('b', { tipo: 'SOLICITAR_AMOSTRAS', quantidadeExigida: 3 }), missao('c', { tipo: 'ADICIONAR_PRODUTOS' })],
      escopo: COMPLETA,
    })
    const ativas = [
      { ...missao('a', { quantidadeRealizada: 7, fim: new Date('2026-10-12T23:59:59-03:00') }), id: '1' },
      { ...missao('b', { tipo: 'SOLICITAR_AMOSTRAS', quantidadeExigida: 3 }), id: '2' },
    ]
    const f = reagir(acoes, ativas, AGORA)
    assert.ok(f.includes('Hoje apareceram 2 novas metas no TikTok Shop.'), f.join('\n'))
    assert.ok(f.some((x) => /A recompensa da campanha "FIXTURE Campanha" subiu de R\$\s?100,00 para R\$\s?150,00\./.test(x)))
    assert.ok(f.some((x) => /O prazo de "FIXTURE a" mudou de 19\/10 para 12\/10\./.test(x)))
    assert.ok(f.some((x) => /progresso foi de 0 para 7/.test(x)))
    assert.ok(f.some((x) => /^Mais urgente: "FIXTURE a" — faltam 3 vídeo\(s\) qualificado\(s\) e restam 2 dias\./.test(x)), f.join('\n'))
  })
  test('nada mudou = diz isso', () => {
    const m = missao('a')
    const f = reagir(planejarSincronizacao({ existentes: [existente('1', m)], recebidas: [m], escopo: COMPLETA }), [], AGORA)
    assert.equal(f[0], 'Nada mudou desde a última leitura.')
  })
})

describe('P2.17.5 — fontes (honestidade e segurança)', () => {
  test('API oficial indisponível, automação web não permitida, com data da verificação', () => {
    const a = estadoDaApiOficial()
    assert.equal(a.disponivel, false)
    assert.match(!a.disponivel ? a.motivo : '', /verificado em 2026-10-11/)
    const w = estadoDaAutomacaoWeb()
    assert.ok(!w.disponivel && w.status === 'NAO_PERMITIDA')
    assert.equal(melhorFonteAutomatica().disponivel, false)
  })
  test('sem scraping, sem navegador automatizado, sem senha: nenhuma dependência nem chamada', () => {
    const codigo = ['lib/fonte-missoes-tiktok.ts', 'lib/sincronizacao-metas-tiktok.ts'].map((f) => fs.readFileSync(f, 'utf8')).join('\n')
    assert.doesNotMatch(codigo, /puppeteer|playwright|selenium|cheerio|fetch\(|password|senha:/i)
    const pkg = fs.readFileSync('package.json', 'utf8')
    assert.doesNotMatch(pkg, /puppeteer|playwright|selenium/)
  })
  test('rotas: sincronizar exige o módulo de oportunidades; o cron exige CRON_SECRET e flag desligada por padrão', () => {
    assert.deepEqual(regraDaRota('/api/tiktok/metas/sincronizar', 'POST')?.modulos, ['oportunidades'])
    const cron = fs.readFileSync('app/api/cron/sincronizar-metas-tiktok/route.ts', 'utf8')
    assert.match(cron, /CRON_SECRET/)
    assert.match(cron, /TIKTOK_MISSOES_SYNC_AGENDADA !== 'true'/)
    // Nenhuma Scheduled Function chama esta rota ainda (cron não ativado).
    for (const f of fs.readdirSync('netlify/functions')) assert.doesNotMatch(fs.readFileSync(`netlify/functions/${f}`, 'utf8'), /sincronizar-metas-tiktok/)
  })
})

const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')

describe('P2.17.5 — banco de TESTE', { skip: !TEM_BANCO ? 'exige banco de TESTE' : false }, () => {
  let prisma: typeof import('../lib/prisma').prisma
  let S: typeof import('../lib/sincronizacao-metas-tiktok')
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  const PREFIXO = 'Conta de Teste — '
  const marca = `r80-${Date.now()}`
  const ws: string[] = []
  const users: string[] = []
  before(async () => {
    ;[{ prisma }, S, { limparWorkspaceDeTeste: limpar }] = await Promise.all([import('../lib/prisma'), import('../lib/sincronizacao-metas-tiktok'), import('./_limpar-workspace-de-teste')])
    for (const n of ['A', 'B']) {
      const w = (await prisma.workspace.create({ data: { name: `${PREFIXO}sync ${n} P2.17.5`, ownerId: `${marca}-${n}` }, select: { id: true } })).id
      ws.push(w)
      users.push((await prisma.user.create({ data: { email: `${marca}-${n}@teste.local`, name: 'U', password: 'x', workspaceId: w }, select: { id: true } })).id)
    }
  })
  after(async () => {
    for (const w of ws) await limpar(prisma, w, PREFIXO)
    await prisma?.$disconnect()
  })

  function doTexto(texto: string) {
    const r = lerTextoDeMetas(texto, AGORA)
    const inicio = new Date(`${r.inicio}T00:00:00-03:00`)
    const fim = new Date(`${r.fim}T23:59:59-03:00`)
    const metas = r.metas.map((m) => ({ nome: m.nome, tipo: m.tipo, inicio, fim, recompensaValor: null, recompensaDescricao: null, campanha: r.campanha, recompensaCampanha: r.recompensaTotal, quantidadeExigida: m.quantidadeExigida, quantidadeRealizada: m.quantidadeRealizada, requisitos: null }))
    const chaves = S.chavesDoTexto(metas)
    return metas.map((m, i) => ({ ...m, chave: chaves[i] }))
  }
  const OUTUBRO = (q: number, total: string) => `Metas de Outubro
10/10/2026 - 19/10/2026
Recompensa total: R$ ${total}
Vídeos qualificados publicados ${q}/10
Produtos adicionados 0/10
Amostras solicitadas 0/3
Vídeos com produtos à venda publicados 0/1`

  test('tabelas novas com RLS e sem acesso público', async () => {
    for (const t of ['SincronizacaoMetasTikTok', 'AlteracaoMetaTikTok']) {
      const [l] = await prisma.$queryRaw<{ rls: boolean; acesso: boolean }[]>`
        select c.relrowsecurity as rls,
          (has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE')) as acesso
        from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = ${t}`
      assert.deepEqual([l.rls, l.acesso], [true, false], t)
    }
  })

  test('Metas de Outubro: 1ª leitura cria 4; reimportar igual não duplica; progresso e recompensa mudam com histórico', async () => {
    const base = { workspaceId: ws[0], userId: users[0], gatilho: 'MANUAL' as const, fonte: 'TEXTO_REVISADO' as const, escopo: { tipo: 'CAMPANHA' as const, campanha: 'Metas de Outubro' } }
    const r1 = await S.aplicarLeitura({ ...base, missoes: doTexto(OUTUBRO(0, '230,00')), agora: AGORA })
    assert.deepEqual([r1.criadas, r1.atualizadas], [4, 0])
    assert.ok(r1.reacao.includes('Hoje apareceram 4 novas metas no TikTok Shop.'))
    const r2 = await S.aplicarLeitura({ ...base, missoes: doTexto(OUTUBRO(0, '230,00')), agora: AGORA })
    assert.deepEqual([r2.criadas, r2.atualizadas, r2.inalteradas], [0, 0, 4])
    assert.equal(r2.reacao[0], 'Nada mudou desde a última leitura.')
    const r3 = await S.aplicarLeitura({ ...base, missoes: doTexto(OUTUBRO(3, '260,00')), agora: AGORA })
    assert.deepEqual([r3.criadas, r3.atualizadas], [0, 4]) // recompensa da campanha mudou em todas; progresso em 1
    assert.equal(r3.reacao.filter((f) => /subiu de R\$\s?230,00 para R\$\s?260,00/.test(f)).length, 1, 'uma frase por campanha')
    assert.ok(r3.reacao.some((f) => /progresso foi de 0 para 3/.test(f)))
    assert.equal(await prisma.metaTikTokShop.count({ where: { workspaceId: ws[0] } }), 4)
    const h = await prisma.alteracaoMetaTikTok.findFirst({ where: { workspaceId: ws[0], campo: 'quantidadeRealizada' } })
    assert.deepEqual([h?.valorAnterior, h?.valorNovo, h?.origem], ['0', '3', 'TEXTO_REVISADO'])
    const m = await prisma.metaTikTokShop.findFirst({ where: { workspaceId: ws[0], tipo: 'VIDEOS_QUALIFICADOS' } })
    assert.equal(m?.fonteSincronizacao, 'TEXTO_REVISADO')
    assert.ok(m?.ultimaSincronizacaoEm)
    assert.equal(await prisma.metaTikTokShop.count({ where: { workspaceId: ws[1] } }), 0, 'isolamento')
  })

  test('meta que some: 1ª leitura marca ausente, 2ª encerra; nada é apagado', async () => {
    const base = { workspaceId: ws[0], userId: users[0], gatilho: 'MANUAL' as const, fonte: 'TEXTO_REVISADO' as const, escopo: { tipo: 'CAMPANHA' as const, campanha: 'Metas de Outubro' } }
    const semAmostras = doTexto(OUTUBRO(3, '260,00')).filter((x) => x.tipo !== 'SOLICITAR_AMOSTRAS')
    const r1 = await S.aplicarLeitura({ ...base, missoes: semAmostras, agora: AGORA })
    assert.equal(r1.ausentes, 1)
    const amostra = await prisma.metaTikTokShop.findFirst({ where: { workspaceId: ws[0], tipo: 'SOLICITAR_AMOSTRAS' } })
    assert.deepEqual([amostra?.status, amostra?.ausenciasSeguidas, !!amostra?.ausenteDesde], ['ATIVA', 1, true])
    const r2 = await S.aplicarLeitura({ ...base, missoes: semAmostras, agora: AGORA })
    assert.equal(r2.encerradas, 1)
    assert.equal((await prisma.metaTikTokShop.findFirst({ where: { id: amostra!.id } }))?.status, 'ENCERRADA')
    assert.equal(await prisma.metaTikTokShop.count({ where: { workspaceId: ws[0] } }), 4)
  })

  test('meta manual igual à do print é adotada (sem duplicar)', async () => {
    await prisma.metaTikTokShop.create({
      data: { workspaceId: ws[1], nome: 'Produtos', tipo: 'ADICIONAR_PRODUTOS', inicio: INICIO, fim: FIM, campanha: 'Metas de Outubro', recompensaCampanha: 230, quantidadeExigida: 10, origem: 'MANUAL' },
    })
    const r = await S.aplicarLeitura({ workspaceId: ws[1], userId: users[1], gatilho: 'MANUAL', fonte: 'TEXTO_REVISADO', escopo: { tipo: 'CAMPANHA', campanha: 'Metas de Outubro' }, missoes: doTexto(OUTUBRO(0, '230,00')), agora: AGORA })
    assert.deepEqual([r.criadas, r.atualizadas], [3, 1])
    assert.equal(await prisma.metaTikTokShop.count({ where: { workspaceId: ws[1] } }), 4)
  })

  test('duas leituras ao mesmo tempo não duplicam (trava por workspace)', async () => {
    const base = { workspaceId: ws[1], userId: users[1], gatilho: 'MANUAL' as const, fonte: 'TEXTO_REVISADO' as const, escopo: { tipo: 'CAMPANHA' as const, campanha: 'FIXTURE Paralela' } }
    const missoes = doTexto(OUTUBRO(0, '230,00').replace('Metas de Outubro', 'FIXTURE Paralela'))
    await Promise.all([S.aplicarLeitura({ ...base, missoes, agora: AGORA }), S.aplicarLeitura({ ...base, missoes, agora: AGORA })])
    assert.equal(await prisma.metaTikTokShop.count({ where: { workspaceId: ws[1], campanha: 'FIXTURE Paralela' } }), 4)
  })

  test('"Sincronizar metas agora" sem fonte automática: registra SEM_FONTE e não toca nas metas', async () => {
    const antes = await prisma.metaTikTokShop.findMany({ where: { workspaceId: ws[0] }, orderBy: { id: 'asc' } })
    const r = await S.sincronizarAgora({ workspaceId: ws[0], userId: users[0], gatilho: 'MANUAL' })
    assert.equal(r.status, 'SEM_FONTE')
    assert.match(r.mensagem ?? '', /não oferece API oficial de missões/)
    assert.deepEqual(await prisma.metaTikTokShop.findMany({ where: { workspaceId: ws[0] }, orderBy: { id: 'asc' } }), antes)
    const e = await S.estadoDaSincronizacao(ws[0])
    assert.equal(e.ultima?.status, 'SEM_FONTE')
    assert.equal(e.ultimaComDados?.fonte, 'TEXTO_REVISADO')
  })
})
