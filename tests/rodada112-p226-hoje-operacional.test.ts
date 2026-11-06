/**
 * P2.26 — "HOJE" OPERACIONAL: uma resposta para "o que eu preciso fazer agora?".
 *
 * Trava: a resposta vem da decisão da Operação (P2.24) quando é com a titular; senão da central (o mesmo
 * número do sininho); senão diz que o Patrono está trabalhando; nunca inventa ação. O dinheiro é o da fonte
 * canônica (P2.25). A Torre não tem mais motor próprio de "próxima ação". Banco de TESTE na segunda parte.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { montarHoje, PERGUNTA_DO_HOJE } from '../lib/hoje'
import { somarFinanceiro } from '../lib/financeiro'
import type { VisaoDaOperacao } from '../lib/jornada'
import type { PendenciaDaCentral } from '../lib/precisa-de-voce-central'

const AGORA = new Date('2026-10-15T12:00:00-03:00')
const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')

function visao(o: { espera?: string; titulo?: string; alternativas?: { candidatoId: string; titulo: string; porqueNao: string }[]; quota?: 'BLOQUEADA' | 'PERMITIDA'; semDecisao?: boolean } = {}): VisaoDaOperacao {
  const titulo = o.titulo ?? 'Aprovar o produto'
  return {
    geradoEm: AGORA.toISOString(),
    prioritaria: o.semDecisao ? null : ({ candidatoId: 'c1', espera: o.espera ?? 'AGUARDANDO_CRISTIANE', titulo, produto: { nome: 'Organizador', imagem: null, link: null }, acao: { tempoEstimado: '~1 minuto' } } as never),
    outras: [],
    nenhumaAcaoSua: (o.espera ?? 'AGUARDANDO_CRISTIANE') !== 'AGUARDANDO_CRISTIANE',
    agora: o.semDecisao ? null : { candidatoId: 'c1', titulo: (o.espera ?? 'AGUARDANDO_CRISTIANE') === 'AGUARDANDO_CRISTIANE' ? titulo : `Patrono trabalhando: ${titulo}`, porque: ['melhor nota entre as demais', 'sinais: base de evidência 90'], fatores: [], alternativas: o.alternativas ?? [{ candidatoId: 'c2', titulo: 'Amostra pedida: aguardando o vendedor', porqueNao: 'não depende de você agora' }] },
    hoje: { campanhasAtivas: 0, prazoMaisProximo: { titulo: 'Missão Natal', fim: '2026-10-17T23:59:00-03:00', urgencia: 'ALTA' }, videosNecessariosHoje: 0, acoesPendentes: 1, receita: {} as never, capacidade: {} as never, campanhas: [], agenda: [], naoCabe: [] as never, quota: o.quota ? { texto: o.quota === 'BLOQUEADA' ? 'Ação indisponível: quota oficial atingida' : 'ok', resultado: o.quota, motivo: '', fonte: null, limite: 2, usado: 2, restante: 0, avisos: [] } : null },
    capacidades: [],
  } as unknown as VisaoDaOperacao
}
const pendencia = (titulo: string, link = '/precisa-de-voce'): PendenciaDaCentral => ({ id: titulo, origem: 'INTEGRACAO', categoria: 'LOGIN_MFA', titulo, motivo: 'a sessão expirou', urgencia: 'ALTA', impacto: 'sem isso nada publica', acao: { rotulo: 'Entrar de novo', link }, criadoEm: AGORA.toISOString(), perdeDinheiro: true, prazo: null, bloqueiaPublicacao: true, bloqueiaIntegracao: true }) as PendenciaDaCentral
const zero = somarFinanceiro([])

describe('P2.26 — montarHoje (pura)', () => {
  test('ação da jornada que é dela: FAZER, com o porquê, o tempo e o que vem depois', () => {
    const h = montarHoje({ visao: visao(), central: [pendencia('Login do TikTok')], dinheiro30d: zero, dinheiroAberto: zero, agora: AGORA })
    assert.equal(h.pergunta, PERGUNTA_DO_HOJE)
    assert.deepEqual([h.resposta.tipo, h.resposta.origem, h.resposta.titulo, h.resposta.link, h.resposta.botao], ['FAZER', 'JORNADA', 'Aprovar o produto', '/operacao', 'FAZER AGORA'])
    assert.equal(h.resposta.tempoEstimado, '~1 minuto')
    assert.match(h.resposta.porque.join(' '), /base de evidência 90/)
    assert.equal(h.depois[0].porqueNao, 'não depende de você agora')
    assert.equal(h.esperandoVoce, 1, 'o mesmo número do sininho')
    assert.equal(h.prazo?.titulo, 'Missão Natal')
  })
  test('jornada sem nada para ela + pendência na central: a central responde, e a jornada vira o "depois"', () => {
    const h = montarHoje({ visao: visao({ espera: 'AGUARDANDO_PATRONO', titulo: 'Gerando o vídeo' }), central: [pendencia('Entrar no TikTok de novo', '/integracoes')], dinheiro30d: zero, dinheiroAberto: zero, agora: AGORA })
    assert.deepEqual([h.resposta.tipo, h.resposta.origem, h.resposta.titulo, h.resposta.link, h.resposta.botao], ['FAZER', 'CENTRAL', 'Entrar no TikTok de novo', '/integracoes', 'ENTRAR DE NOVO'])
    assert.equal(h.depois[0].titulo, 'Patrono trabalhando: Gerando o vídeo')
  })
  test('nada com ela: AGUARDAR (o Patrono está fazendo) — nunca inventa uma ação', () => {
    const h = montarHoje({ visao: visao({ espera: 'AGUARDANDO_PATRONO', titulo: 'Gerando o vídeo' }), central: [], dinheiro30d: zero, dinheiroAberto: zero, agora: AGORA })
    assert.equal(h.resposta.tipo, 'AGUARDAR')
    assert.equal(h.resposta.titulo, 'Patrono trabalhando: Gerando o vídeo')
    assert.equal(h.resposta.porque[0], 'nenhuma ação sua agora')
    const nada = montarHoje({ visao: visao({ semDecisao: true }), central: [], dinheiro30d: null, dinheiroAberto: null, agora: AGORA })
    assert.deepEqual([nada.resposta.tipo, nada.resposta.origem], ['NADA', 'NENHUMA'])
    assert.equal(nada.dinheiro, null, 'fonte que falhou = sem dado (não zero inventado)')
    const semOperacao = montarHoje({ visao: null, central: [], dinheiro30d: zero, dinheiroAberto: zero, agora: AGORA })
    assert.equal(semOperacao.resposta.link, '/oportunidades')
  })
  test('quota oficial bloqueada aparece como restrição; dinheiro: confirmado e previsão separados', () => {
    const conf = somarFinanceiro([{ id: 'a', estado: 'LIQUIDADA', valor: 6.5 }, { id: 'b', estado: 'REVERTIDA', valor: 2 }])
    const aberto = somarFinanceiro([{ id: 'c', estado: 'ESTIMADA', valor: 7 }, { id: 'd', estado: 'NAO_LIQUIDADA', valor: 3 }])
    const h = montarHoje({ visao: visao({ quota: 'BLOQUEADA' }), central: [], dinheiro30d: conf, dinheiroAberto: aberto, agora: AGORA })
    assert.match(h.restricao!, /quota oficial atingida/)
    assert.deepEqual(h.dinheiro, { confirmada30d: 6.5, previsao: 10, revertida30d: 2 })
  })
  test('trava: a Torre não tem motor paralelo de "próxima ação"; o HOJE vem primeiro; dinheiro do topo pela fonte canônica', () => {
    const lib = fs.readFileSync('lib/torre-de-controle.ts', 'utf8')
    assert.doesNotMatch(lib, /const proximaAcao =/)
    assert.doesNotMatch(lib, /comercial\?\.proxima/)
    assert.match(lib, /resumoFinanceiro\(workspaceId, \{ periodoDaVenda/)
    const pagina = fs.readFileSync('app/(dashboard)/torre/page.tsx', 'utf8')
    assert.ok(pagina.indexOf('<BlocoHoje />') > 0 && pagina.indexOf('<BlocoHoje />') < pagina.indexOf('aria-label="Dinheiro"'))
    assert.match(pagina, /fetch\('\/api\/hoje'\)/)
    assert.doesNotMatch(pagina, /rotulo="Comissão hoje"/, 'comissão digitada nos vídeos não é mais o número principal')
    assert.match(fs.readFileSync('lib/hoje.ts', 'utf8'), /visaoDaOperacao/)
  })
})

describe('P2.26 — HOJE no banco de TESTE', { skip: !TEM_BANCO }, () => {
  let prisma: typeof import('../lib/prisma')['prisma']
  let H: typeof import('../lib/hoje')
  let J: typeof import('../lib/jornada')
  let C: typeof import('../lib/precisa-de-voce-central')
  let F: typeof import('../lib/financeiro')
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  const PREFIXO = 'Conta de Teste — '
  const marca = `r112-${Date.now()}`
  const workspaces: string[] = []
  before(async () => {
    ;[{ prisma }, H, J, C, F, { limparWorkspaceDeTeste: limpar }] = await Promise.all([import('../lib/prisma'), import('../lib/hoje'), import('../lib/jornada'), import('../lib/precisa-de-voce-central'), import('../lib/financeiro'), import('./_limpar-workspace-de-teste')])
  })
  after(async () => {
    if (prisma) for (const w of workspaces) await limpar(prisma, w, PREFIXO)
    await prisma?.$disconnect()
  })
  async function conta(nome: string, flag: boolean) {
    const ws = (await prisma.workspace.create({ data: { name: `${PREFIXO}${nome} r112`, ownerId: `${marca}-${nome}` }, select: { id: true } })).id
    workspaces.push(ws)
    if (flag) await prisma.featureFlag.create({ data: { chave: 'CENTRAL_DE_APROVACOES', escopo: ws, ligada: true } })
    const agora = new Date()
    await prisma.candidatoDeProduto.create({
      data: {
        workspaceId: ws, chaveDeOrigem: `${marca}-${nome}`, fonte: 'USER_PROVIDED', nome: 'Organizador r112', categoria: 'Casa e Decoração', preco: 59.9, comissaoValor: 12, vendas: 1500,
        providerId: 'tiktok-shop', externalId: `9112${Date.now() % 1_000_000}`, linkProduto: 'https://www.tiktok.com/view/product/1', score: 90, baseDeEvidencia: 90, confianca: 'SEM_HISTORICO_REAL',
        status: 'APRESENTADO', coletadoEm: agora, validoAte: new Date(agora.getTime() + 30 * 86_400_000), nivelDeRisco: 'BAIXO',
      },
    })
    return ws
  }

  test('Operação liberada: o HOJE é a MESMA decisão da Operação; "esperando você" = sininho; dinheiro = fonte canônica', async () => {
    const ws = await conta('liberada', true)
    const agora = new Date()
    const [h, v, central, fin] = await Promise.all([H.hojeOperacional(ws, agora), J.carregarOperacao(ws, agora).then(J.visaoDaOperacao), C.centralPrecisaDeVoce(ws, agora), F.resumoFinanceiro(ws)])
    assert.equal(h.resposta.origem, 'JORNADA')
    assert.equal(h.resposta.titulo, v.agora!.titulo)
    assert.equal(h.resposta.produto, 'Organizador r112')
    assert.equal(h.esperandoVoce, central.length)
    assert.equal(h.dinheiro!.previsao, fin.previsao)
    // refresh: a mesma pergunta, a mesma resposta
    assert.deepEqual((await H.hojeOperacional(ws, agora)).resposta, h.resposta)
  })
  test('Operação não liberada: o HOJE não inventa jornada (usa só a central / "nada pendente")', async () => {
    const ws = await conta('sem-flag', false)
    const h = await H.hojeOperacional(ws)
    assert.notEqual(h.resposta.origem, 'JORNADA')
    assert.equal(h.esperandoVoce, (await C.centralPrecisaDeVoce(ws)).length)
  })
})
