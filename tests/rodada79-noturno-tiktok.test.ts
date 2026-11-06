/**
 * P2.17.4 — Trabalho noturno: importação de metas por texto (com revisão),
 * motor de vídeos para produção, quality gate e aprendizado (sem métrica inventada).
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { lerTextoDeMetas, tipoDaLinha, extrairValor } from '../lib/importar-metas-tiktok'
import { planejarVideos, ESTRUTURAS } from '../lib/motor-de-videos-tiktok'
import { avaliarVideo } from '../lib/quality-gate-video-tiktok'
import { aprender, decisaoPorEstrutura, type RegistroDeVideo } from '../lib/aprendizado-videos-tiktok'
import { regraDaRota } from '../lib/modulos-rotas'

const AGORA = new Date('2026-10-11T12:00:00-03:00')
const OUTUBRO_LIMPO = `Metas de Outubro
10/10/2026 - 19/10/2026
Recompensa total: R$ 230,00
Vídeos qualificados publicados 0/10
Produtos adicionados 0/10
Amostras solicitadas 0/3
Vídeos com produtos à venda publicados 0/1`
const OUTUBRO_DO_CELULAR = `‹ Metas
Metas de Outubro
Período: 10 out. – 19 out.
Ganhe até R$230,00
• Vídeos qualificados publicados  0 / 10
• Produtos adicionados 0/10
Amostras solicitadas: 0/3
Vídeos com produtos à venda publicados (0/1)
Ver regras`

describe('P2.17.4 — importar metas do texto do print', () => {
  test('exemplo real "Metas de Outubro": campanha, período, R$ 230 e as 4 metas com tipo certo', () => {
    const r = lerTextoDeMetas(OUTUBRO_LIMPO, AGORA)
    assert.equal(r.campanha, 'Metas de Outubro')
    assert.equal(r.inicio, '2026-10-10')
    assert.equal(r.fim, '2026-10-19')
    assert.equal(r.recompensaTotal, 230)
    assert.deepEqual(r.metas.map((m) => [m.tipo, m.quantidadeRealizada, m.quantidadeExigida]), [
      ['VIDEOS_QUALIFICADOS', 0, 10], ['ADICIONAR_PRODUTOS', 0, 10], ['SOLICITAR_AMOSTRAS', 0, 3], ['VIDEOS_COM_PRODUTO', 0, 1],
    ])
    assert.deepEqual(r.avisos, [])
    assert.equal(r.exigeRevisao, true)
  })
  test('texto "bagunçado" do copiar-texto do celular: mesmo resultado, com avisos honestos', () => {
    const r = lerTextoDeMetas(OUTUBRO_DO_CELULAR, AGORA)
    assert.equal(r.campanha, 'Metas de Outubro')
    assert.deepEqual([r.inicio, r.fim, r.recompensaTotal, r.metas.length], ['2026-10-10', '2026-10-19', 230, 4])
    assert.ok(r.avisos.some((a) => /não traz o ano/.test(a)))
    assert.ok(r.avisos.some((a) => /Confira se é o total/.test(a)))
  })
  test('o que não acha vira aviso, nunca valor inventado', () => {
    const r = lerTextoDeMetas('qualquer coisa sem metas', AGORA)
    assert.equal(r.metas.length, 0)
    assert.equal(r.inicio, null)
    assert.equal(r.recompensaTotal, null)
    assert.ok(r.avisos.length >= 3)
    assert.equal(extrairValor('R$ 1.234,56'), 1234.56)
    assert.equal(tipoDaLinha('Vídeos com produto marcado 0/2'), 'VIDEOS_COM_PRODUTO')
  })
  test('período que vira o ano (28/12 a 05/01) usa o ano seguinte no fim', () => {
    const r = lerTextoDeMetas('Campanha Virada\n28/12 - 05/01\nVídeos qualificados 0/5', AGORA)
    assert.equal(r.inicio, '2026-12-28')
    assert.equal(r.fim, '2027-01-05')
  })
  test('importar NUNCA grava; salvar exige "revisado: true"; tudo sob o módulo Oportunidades', () => {
    const importar = fs.readFileSync('app/api/tiktok/metas/importar/route.ts', 'utf8')
    assert.match(importar, /exigirSessao\(\)/)
    assert.doesNotMatch(importar, /prisma|criarMeta/)
    const salvar = fs.readFileSync('app/api/tiktok/metas/salvar-revisadas/route.ts', 'utf8')
    assert.match(salvar, /revisado: z\.literal\(true\)/)
    assert.match(salvar, /session\.user\.workspaceId/)
    for (const r of ['/api/tiktok/metas/importar', '/api/tiktok/metas/salvar-revisadas']) assert.deepEqual(regraDaRota(r, 'POST')?.modulos, ['oportunidades'])
    assert.match(fs.readFileSync('components/metas/ImportarMetas.tsx', 'utf8'), /disabled=\{ocupado \|\| !revisado/)
  })
})

describe('P2.17.4 — motor de vídeos para produção', () => {
  const plano = planejarVideos({ nome: 'FIXTURE Kit organizador de gavetas', categoria: 'Casa e Decoração', preco: 49.9, tiktokShop: true, vendas: 340 }, AGORA)
  test('estruturas novas: curiosidade, utilidade e Natal', () => {
    for (const e of ['CURIOSIDADE', 'UTILIDADE', 'NATAL'] as const) assert.ok(ESTRUTURAS.includes(e))
    assert.ok(plano.variantes.some((v) => v.estrutura === 'CURIOSIDADE'))
    assert.ok(plano.variantes.some((v) => v.estrutura === 'NATAL'))
  })
  test('cada variante pronta para gravar: texto na tela, objetivo, produto marcado, curta/média, CTA A/B, 2 legendas', () => {
    for (const v of plano.variantes) {
      assert.ok(['RETENCAO', 'CLIQUE', 'VENDA'].includes(v.objetivo))
      assert.match(v.produtoMarcado, /Adicionar link/)
      assert.equal(v.versaoCurta.segundos, 15)
      assert.equal(v.versaoMedia.segundos, 30)
      assert.equal(v.versaoCurta.roteiro[0].etapa, 'Gancho (0–3 s)')
      assert.equal(v.versaoCurta.roteiro.at(-1)!.etapa, 'CTA')
      assert.notEqual(v.cta, v.ctaB)
      assert.match(v.legendaB, /comissão/)
      for (const e of v.versaoMedia.roteiro) assert.ok((e.textoNaTela ?? '').length <= 40, e.textoNaTela ?? '')
    }
    const fora = planejarVideos({ nome: 'Kit', categoria: 'Outros', preco: 50, tiktokShop: false }, AGORA)
    assert.match(fora.variantes[0].produtoMarcado, /fora do TikTok Shop/)
    assert.equal(fora.variantes[0].cta, 'Link na bio.')
  })
})

describe('P2.17.4 — quality gate de vídeo', () => {
  const v = planejarVideos({ nome: 'FIXTURE Kit organizador', categoria: 'Casa e Decoração', preco: 49.9, tiktokShop: true, vendas: 340 }, AGORA).variantes.find((x) => x.estrutura === 'DEMONSTRACAO')!
  test('variante do motor: APROVADO', () => {
    const a = avaliarVideo(v, { tiktokShop: true, temVendasReais: true })
    assert.equal(a.veredito, 'APROVADO', a.motivos.join(' | '))
    assert.equal(a.riscoDeCompliance, 'BAIXO')
  })
  test('sem divulgação ou com promessa: BLOQUEADO, com o motivo', () => {
    assert.equal(avaliarVideo({ ...v, legenda: 'Compre já!' }, { tiktokShop: true }).veredito, 'BLOQUEADO')
    const promessa = avaliarVideo({ ...v, gancho: 'Esse vídeo vai viralizar e é garantido!' }, { tiktokShop: true })
    assert.equal(promessa.veredito, 'BLOQUEADO')
    assert.match(promessa.resumo, /Promessa proibida/)
  })
  test('exige experiência real, CTA incoerente ou longo demais: REVISAR', () => {
    const ugc = planejarVideos({ nome: 'Kit', categoria: 'Casa e Decoração', preco: 49.9, tiktokShop: true }, AGORA).variantes.find((x) => x.estrutura === 'UGC')!
    assert.equal(avaliarVideo(ugc, { tiktokShop: true }).veredito, 'REVISAR')
    assert.equal(avaliarVideo({ ...v, cta: 'Link na bio.' }, { tiktokShop: true }).veredito, 'REVISAR')
    assert.equal(avaliarVideo({ ...v, duracaoSegundos: 90 }, { tiktokShop: true }).veredito, 'REVISAR')
  })
  test('o painel mostra o veredito do quality gate em cada gancho', () => {
    assert.match(fs.readFileSync('lib/metas-tiktok-http.ts', 'utf8'), /qualidade: avaliarVideo\(v,/)
  })
})

describe('P2.17.4 — aprendizado (sem métrica inventada)', () => {
  const reg = (id: string, estrutura: string, m: RegistroDeVideo['metricas'], cta: 'A' | 'B' = 'A'): RegistroDeVideo => ({
    id, produtoId: 'p', estrutura, gancho: 'g', cta, duracaoSegundos: 15, publicadoEm: AGORA, metricas: m, metasIds: [], origemMetricas: 'MANUAL',
  })
  test('sem amostra mínima: nenhum vencedor, recomendação de continuar testando', () => {
    const a = aprender([reg('1', 'DEMONSTRACAO', { views: 1000, comissao: 10 }), reg('2', 'POV', { views: 9000, comissao: 0 })], 'estrutura')
    assert.equal(a.vencedor, null)
    assert.match(a.recomendacao, /Dados insuficientes/)
  })
  test('receita vence visualização: o "viral sem venda" perde', () => {
    const demo = ['1', '2', '3'].map((i) => reg(i, 'DEMONSTRACAO', { views: 1000, comissao: 30, vendas: 3, ctr: 0.04 }))
    const viral = ['4', '5', '6'].map((i) => reg(i, 'POV', { views: 50_000, comissao: 0, vendas: 0, ctr: 0.005 }))
    const a = aprender([...demo, ...viral], 'estrutura')
    assert.equal(a.vencedor, 'DEMONSTRACAO')
    assert.match(a.recomendacao, /Critério: receita, não visualização/)
    const d = decisaoPorEstrutura(a)
    assert.equal(d.find((x) => x.grupo === 'DEMONSTRACAO')!.decisao, 'REPETIR')
    assert.equal(d.find((x) => x.grupo === 'POV')!.decisao, 'PARAR')
  })
  test('métrica ausente fica fora da conta (não vira zero)', () => {
    const a = aprender([reg('1', 'A', {}), reg('2', 'A', { views: 1000 })], 'estrutura')
    assert.equal(a.grupos[0].comMetricas, 1)
    assert.equal(a.grupos[0].comissao, null)
    assert.equal(a.grupos[0].receitaPor1000Views, null)
  })
})

const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')

describe('P2.17.4 — banco de TESTE', { skip: !TEM_BANCO ? 'exige banco de TESTE' : false }, () => {
  let prisma: typeof import('../lib/prisma').prisma
  let M: typeof import('../lib/metas-tiktok')
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  const PREFIXO = 'Conta de Teste — '
  const marca = `r79-${Date.now()}`
  const ws: string[] = []
  const users: string[] = []
  before(async () => {
    ;[{ prisma }, M, { limparWorkspaceDeTeste: limpar }] = await Promise.all([import('../lib/prisma'), import('../lib/metas-tiktok'), import('./_limpar-workspace-de-teste')])
    for (const n of ['A', 'B']) {
      const w = (await prisma.workspace.create({ data: { name: `${PREFIXO}noturno ${n} P2.17.4`, ownerId: `${marca}-${n}` }, select: { id: true } })).id
      ws.push(w)
      users.push((await prisma.user.create({ data: { email: `${marca}-${n}@teste.local`, name: 'U', password: 'x', workspaceId: w }, select: { id: true } })).id)
    }
  })
  after(async () => {
    for (const w of ws) await limpar(prisma, w, PREFIXO)
    await prisma?.$disconnect()
  })

  test('tabela de resultados de vídeo com RLS e sem acesso público', async () => {
    const [l] = await prisma.$queryRaw<{ rls: boolean; acesso: boolean }[]>`
      select c.relrowsecurity as rls,
        (has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE')) as acesso
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'VideoTikTokResultado'`
    assert.deepEqual([l.rls, l.acesso], [true, false])
  })

  test('salvar revisadas: o exemplo de outubro entra inteiro, no workspace certo; inválida = nada gravado', async () => {
    const r = lerTextoDeMetas(OUTUBRO_LIMPO, AGORA)
    const inicio = new Date(`${r.inicio}T00:00:00-03:00`)
    const fim = new Date(`${r.fim}T23:59:59-03:00`)
    const dados = r.metas.map((m) => ({ nome: m.nome, tipo: m.tipo, inicio, fim, recompensaValor: null, recompensaDescricao: null, campanha: r.campanha, recompensaCampanha: r.recompensaTotal, quantidadeExigida: m.quantidadeExigida, quantidadeRealizada: m.quantidadeRealizada, requisitos: null }))
    assert.equal(await M.criarMetasRevisadas({ workspaceId: ws[0], userId: users[0], metas: dados }), 4)
    assert.equal(await prisma.metaTikTokShop.count({ where: { workspaceId: ws[0], origem: 'IMPORTADA_REVISADA', campanha: 'Metas de Outubro' } }), 4)
    assert.equal(await prisma.metaTikTokShop.count({ where: { workspaceId: ws[1] } }), 0)
    await assert.rejects(
      M.criarMetasRevisadas({ workspaceId: ws[1], userId: users[1], metas: [dados[0], { ...dados[1], quantidadeExigida: 0 }] }),
      /Meta 2/
    )
    assert.equal(await prisma.metaTikTokShop.count({ where: { workspaceId: ws[1] } }), 0)
  })
})
