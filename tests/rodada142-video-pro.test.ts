/**
 * P2.42 — Vídeo profissional sob demanda (protótipo). SÓ TESTE, SÓ MOCK: nenhuma chamada paga, nenhuma rede externa.
 * Puro: estimativa, limite por execução, simulação mensal, recusa de provedor real.
 * FFmpeg local: checagem de fidelidade aprova o trecho fiel e reprova o adulterado.
 * Banco de TESTE: Cost Governor real (duas chaves, orçamento mensal, limite de aprovação), tentativas cobradas e não
 * cobradas, bloqueio automático ao atingir o orçamento, idempotência da execução, registro de consumo. Limpa tudo.
 *   node --env-file=<.env de TESTE> node_modules/tsx/dist/cli.mjs --test tests/rodada142-video-pro.test.ts
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import ffmpegStatic from 'ffmpeg-static'
import { MODELOS, modelo } from '../lib/video-pro/catalogo'
import { centavosPorTentativa, estimarExecucao, verificarLimiteDaExecucao, simularMes, CAMBIO_PADRAO } from '../lib/video-pro/orcamento'
import { AdaptadorMock, criarAdaptador, promptSeguro, type CenarioDoMock } from '../lib/video-pro/adaptadores'
import { checarFidelidade } from '../lib/video-pro/fidelidade'

const MOCK = MODELOS.mock
const pasta = mkdtempSync(join(tmpdir(), 'r142-'))
const capa = join(pasta, 'capa.png')
// "Capa" sintética com bastante estrutura (o SSIM precisa de detalhe para discriminar).
execFileSync(ffmpegStatic as unknown as string, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=800x1200:rate=1', '-frames:v', '1', capa])

describe('orçamento (puro)', () => {
  test('custo por tentativa: arredonda para a duração aceita, com câmbio + margem, para cima', () => {
    assert.equal(centavosPorTentativa(MOCK, 5), 140) // 5 s × US$ 0,05 × 5,0564 × 1,10 = R$ 1,39
    assert.equal(centavosPorTentativa(MOCK, 6), 279) // 6 s → modelo só aceita 5/10 → cobra 10 s
    assert.throws(() => centavosPorTentativa(MOCK, 0))
  })
  test('estimativa antes de gerar: pior caso = todas as tentativas; esperado com refação', () => {
    const e = estimarExecucao({ modelo: MOCK, segundos: 5, tentativasMax: 3, taxaDeRefacao: 0.3 })
    assert.equal(e.piorCasoCentavos, 420)
    assert.equal(e.esperadoCentavos, 195) // 140 × (1 + 0,3 + 0,09)
    assert.equal(e.falhaCobrada, true, "'desconhecido' conta como cobrada")
    assert.throws(() => estimarExecucao({ modelo: MOCK, segundos: 5, tentativasMax: 9, taxaDeRefacao: 0.3 }))
  })
  test('limite rígido por execução: sem limite não gera; pior caso acima do limite não gera', () => {
    const e = estimarExecucao({ modelo: MOCK, segundos: 5, tentativasMax: 3, taxaDeRefacao: 0.3 })
    assert.equal(verificarLimiteDaExecucao(e, 0).cabe, false)
    assert.equal(verificarLimiteDaExecucao(e, 419).cabe, false)
    assert.equal(verificarLimiteDaExecucao(e, 420).cabe, true)
  })
  test('simulação mensal escala linearmente e o pior caso nunca fica abaixo do esperado', () => {
    const perfil = { nome: 'p', trechos: [{ modelo: MOCK, segundos: 5 }, { modelo: MOCK, segundos: 5 }], tentativasMax: 3, taxaDeRefacao: 0.3, taxaDeDescarte: 0.2 }
    const [a, b] = [simularMes(30, perfil), simularMes(300, perfil)]
    assert.equal(b.esperadoCentavos, a.esperadoCentavos * 10)
    assert.ok(a.piorCasoCentavos >= a.esperadoCentavos)
    assert.equal(a.porVideoEsperadoCentavos, Math.ceil(195 * 2 / 0.8))
  })
  test('fora do catálogo e provedor real: recusados; prompt sempre com as restrições do produto', () => {
    assert.throws(() => modelo('gen-inexistente'), /fora do catálogo/)
    assert.throws(() => criarAdaptador('runway'), /NÃO habilitada/)
    assert.throws(() => criarAdaptador('fal.ai'), /NÃO habilitada/)
    assert.match(promptSeguro('Slow push-in.'), /same cover, title, text, logo, colors/)
    assert.equal(CAMBIO_PADRAO.margem > 0, true)
  })
})

describe('fidelidade ao produto (FFmpeg local, R$ 0)', () => {
  test('trecho fiel aprova; trecho com capa recolorida/coberta reprova', async () => {
    const m = new AdaptadorMock(['SUCESSO', 'ADULTERADO'])
    const ped = { modo: 'IMAGEM_PARA_VIDEO' as const, modeloId: 'mock', midiaReal: capa, prompt: 'x', segundos: 5 }
    const ok = await m.submeter(ped, 'a'); await m.consultar(ok.jobId)
    const ruim = await m.submeter(ped, 'b'); await m.consultar(ruim.jobId)
    const [e1, e2] = [await m.consultar(ok.jobId), await m.consultar(ruim.jobId)]
    const f1 = await checarFidelidade({ midiaReal: capa, gerado: e1.arquivo! })
    const f2 = await checarFidelidade({ midiaReal: capa, gerado: e2.arquivo! })
    assert.equal(f1.aprovado, true, JSON.stringify(f1))
    assert.equal(f2.aprovado, false, JSON.stringify(f2))
  })
})

describe('executor + Cost Governor (banco de TESTE, mock)', () => {
  if (!(process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')) {
    test('pulado: só roda com o banco de TESTE', { skip: true }, () => {})
    return
  }
  let prisma: typeof import('../lib/prisma').prisma
  let X: typeof import('../lib/video-pro/executor')
  let P: typeof import('../lib/politica')
  let ws = ''
  let userId = ''
  const marca = `r142-${Date.now()}`
  const env = { PAID_AI_ENABLED: 'true', AI_MONTHLY_BUDGET: '50' }
  const pedido = { modo: 'IMAGEM_PARA_VIDEO' as const, modeloId: 'mock', midiaReal: capa, prompt: 'Slow push-in on the book.', segundos: 5 }
  const rodar = (execucaoId: string, cenarios: CenarioDoMock[], extra: Record<string, unknown> = {}) => {
    const adaptador = new AdaptadorMock(cenarios)
    return X.gerarTrechoProfissional({ workspaceId: ws, execucaoId, pedido, adaptador, limiteExecucaoCentavos: 450, intervaloMs: 0, maxConsultas: 4, env, semInscricoes: true, ...extra }).then((r) => ({ r, adaptador }))
  }
  const politica = (mensal: number, aprovarAcima: number) => P.publicarPolitica({ workspaceId: ws, ator: 'TITULAR', userId, regras: {
    ...P.POLITICA_PADRAO, custo: { orcamentoMensalCentavos: mensal, orcamentoDiarioCentavos: mensal, exigirAprovacaoAcimaDeCentavos: aprovarAcima } } })

  before(async () => {
    ;[{ prisma }, X, P] = await Promise.all([import('../lib/prisma'), import('../lib/video-pro/executor'), import('../lib/politica')])
    ws = (await prisma.workspace.create({ data: { name: 'R142', ownerId: marca, automationPaused: false }, select: { id: true } })).id
    userId = (await prisma.user.create({ data: { email: `${marca}@teste.local`, name: 'U', password: 'x', workspaceId: ws }, select: { id: true } })).id
  })
  after(async () => {
    if (prisma && ws) {
      const w = { workspaceId: ws }
      await prisma.costLedger.deleteMany({ where: w })
      await prisma.domainEvent.deleteMany({ where: w })
      await prisma.decisionRecord.deleteMany({ where: w })
      await prisma.policyVersion.deleteMany({ where: w })
      await prisma.auditLog.deleteMany({ where: w })
      await prisma.user.deleteMany({ where: w })
      await prisma.workspace.deleteMany({ where: { id: ws } })
    }
    await prisma?.$disconnect()
  })

  test('padrão = custo zero: sem as chaves/política, BLOQUEADO e NADA é submetido', async () => {
    const { r, adaptador } = await rodar('e0', ['SUCESSO'], { env: {} })
    assert.equal(r.status, 'BLOQUEADO')
    assert.equal(adaptador.submetidos.length, 0)
    assert.match(r.fallback ?? '', /filmagem real/)
  })

  test('automação PAUSADA pela titular: com chaves e orçamento, mesmo assim bloqueia e não submete', async () => {
    await politica(900, 500)
    await prisma.workspace.update({ where: { id: ws }, data: { automationPaused: true } })
    const { r, adaptador } = await rodar('e-pausa', ['SUCESSO'])
    await prisma.workspace.update({ where: { id: ws }, data: { automationPaused: false } })
    assert.equal(r.status, 'BLOQUEADO')
    assert.match(r.motivo ?? '', /pausada/)
    assert.equal(adaptador.submetidos.length, 0)
  })

  test('limite por execução menor que o pior caso: bloqueia ANTES de reservar e de submeter', async () => {
    await politica(900, 500)
    const antes = await prisma.costLedger.count({ where: { workspaceId: ws } })
    const { r, adaptador } = await rodar('e-lim', ['SUCESSO'], { limiteExecucaoCentavos: 300 })
    assert.equal(r.status, 'BLOQUEADO')
    assert.match(r.motivo ?? '', /limite por execução/)
    assert.equal(adaptador.submetidos.length, 0)
    assert.equal(await prisma.costLedger.count({ where: { workspaceId: ws } }), antes)
  })

  test('falha técnica (cobrada) + adulterado (reprovado, cobrado) + sucesso: 3 tentativas, R$ 4,20, trecho fiel', async () => {
    const { r, adaptador } = await rodar('e1', ['FALHA_TECNICA', 'ADULTERADO', 'SUCESSO'])
    assert.equal(r.status, 'GERADO', JSON.stringify(r.tentativas))
    assert.deepEqual(r.tentativas.map((t) => t.status), ['FALHOU', 'REPROVADA_FIDELIDADE', 'APROVADA'])
    assert.equal(r.gastoCentavos, 420)
    assert.equal(adaptador.submetidos.length, 3)
    assert.match(adaptador.submetidos[0].pedido.prompt, /Keep the product EXACTLY/)
    assert.equal(await prisma.costLedger.count({ where: { workspaceId: ws, status: 'CONFIRMADO' } }), 3)
  })

  test('moderação com prova oficial de não cobrança: reserva CANCELADA (R$ 0) e a próxima tentativa segue', async () => {
    const { r } = await rodar('e2', ['MODERACAO', 'SUCESSO'])
    assert.equal(r.status, 'GERADO')
    assert.deepEqual(r.tentativas.map((t) => [t.status, t.cobrada]), [['FALHOU', false], ['APROVADA', true]])
    assert.equal(r.gastoCentavos, 140)
    assert.equal(await prisma.costLedger.count({ where: { workspaceId: ws, status: 'CANCELADO' } }), 1)
  })

  test('repetir a MESMA execução não submete nem cobra de novo (idempotente)', async () => {
    const antes = await prisma.costLedger.count({ where: { workspaceId: ws } })
    const { adaptador } = await rodar('e1', ['SUCESSO'])
    assert.equal(adaptador.submetidos.length, 0)
    assert.equal(await prisma.costLedger.count({ where: { workspaceId: ws } }), antes)
  })

  test('orçamento mensal atingido: bloqueio AUTOMÁTICO no meio da execução, sem passar do teto', async () => {
    // Já contam 560 (4 × 140). Teto 900: cabem mais 2 tentativas (840); a 3ª (980) é bloqueada.
    const { r, adaptador } = await rodar('e3', ['FALHA_TECNICA'])
    assert.equal(r.status, 'BLOQUEADO')
    assert.match(r.motivo ?? '', /Orçamento mensal/)
    assert.equal(adaptador.submetidos.length, 2)
    const c = await X.consumoDoMes(ws)
    assert.equal(c.totalCentavos, 840)
    assert.ok(c.totalCentavos <= 900)
  })

  test('gasto acima do limite de aprovação automática: pede aprovação, não submete', async () => {
    await politica(5000, 100)
    const { r, adaptador } = await rodar('e4', ['SUCESSO'])
    assert.equal(r.status, 'AGUARDA_APROVACAO_DE_GASTO')
    assert.equal(adaptador.submetidos.length, 0)
  })

  test('registro de consumo do mês: por provedor/operação/status', async () => {
    const c = await X.consumoDoMes(ws)
    const conf = c.linhas.find((l) => l.status === 'CONFIRMADO')!
    assert.equal(conf.provider, 'simulado-teste')
    assert.equal(conf.operacao, 'gerar-trecho:mock')
    assert.equal(conf.quantidade, 6)
    assert.equal(c.linhas.find((l) => l.status === 'CANCELADO')?.centavos, 0)
  })

  test('P2.84: produto sem "semInscricoes" declarado — similaridade aprova, mas o trecho AGUARDA a conferência das inscrições (não vira GERADO)', async () => {
    // por último: soma gasto ao mês e não pode mexer nos testes de orçamento acima
    await politica(5000, 5000)
    const { r, adaptador } = await rodar('e-insc', ['SUCESSO'], { semInscricoes: undefined })
    assert.equal(r.status, 'AGUARDA_CONFERENCIA_DE_INSCRICOES', JSON.stringify(r.tentativas))
    assert.deepEqual(r.tentativas.map((t) => t.status), ['AGUARDA_CONFERENCIA_DE_INSCRICOES'])
    assert.equal(adaptador.submetidos.length, 1)
    assert.match(r.motivo ?? '', /inscri/)
  })
})
