/**
 * P2.14.7 (Fase 0A) — Fundações do Autopilot: arquitetura, atomicidade,
 * idempotência e segurança.
 *
 * Puro: matriz da política, regras de aprovação, máquina de estados,
 * precedência de flags, travas, roteador de providers, fitness de
 * arquitetura (lendo o código-fonte).
 * Banco de TESTE: ledger idempotente e transacional, versões de política
 * concorrentes, aprovação com clique duplo, runs concorrentes, Safe Mode,
 * Cost Governor sob concorrência, recibo de webhook, curadoria registrando
 * decisão/evento. Limpa tudo o que cria. Sem rede externa. Custo R$ 0,00.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { avaliarAcao, POLITICA_PADRAO, EsquemaDaPolitica, type RegrasDaPolitica } from '../lib/politica'
import { regraCasa, regraAplicavel } from '../lib/aprovacoes'
import { podeTransitar, retomadaValida, FLUXO } from '../lib/supervisor/estados'
import { resolverFlag, ehFlagConhecida, FLAGS } from '../lib/feature-flags'
import { combinarTravas, killSwitchGlobalAtivo } from '../lib/kill-switch'
import { RegistroDeProviders, type DescritorDeProvider } from '../lib/providers/contratos'
import { TIPOS_DE_EVENTO } from '../lib/ledger'

const LIVRE = { acoesIrreversiveisBloqueadas: false }
const TRAVADO = { acoesIrreversiveisBloqueadas: true, motivoDoBloqueio: 'Safe Mode' }
const AUTO: RegrasDaPolitica = {
  ...POLITICA_PADRAO,
  autonomia: { padrao: 'AUTOMATIC', porCanal: { instagram: 'MANUAL' } },
  limites: { ...POLITICA_PADRAO.limites, riscoMaximoSemAprovacao: 'MEDIO', precoMaximo: 500, categoriasBloqueadas: ['Medicamentos'] },
  custo: { orcamentoMensalCentavos: 1000, orcamentoDiarioCentavos: 300, exigirAprovacaoAcimaDeCentavos: 150 },
}

describe('Policy Engine (puro)', () => {
  test('padrão é conservador: MANUAL, custo zero, aprovação a partir de risco médio', () => {
    assert.equal(avaliarAcao(POLITICA_PADRAO, { tipo: 'ESCOLHER_PRODUTO', risco: 'BAIXO' }, LIVRE).resultado, 'EXIGIR_APROVACAO')
    assert.equal(avaliarAcao(POLITICA_PADRAO, { tipo: 'GASTAR', centavos: 1, gastoNoMesCentavos: 0, gastoNoDiaCentavos: 0 }, LIVRE).resultado, 'BLOQUEAR')
    assert.equal(avaliarAcao(POLITICA_PADRAO, { tipo: 'PUBLICAR', canal: 'tiktok', risco: 'BAIXO', publicacoesHojeNoCanal: 0 }, LIVRE).resultado, 'EXIGIR_APROVACAO')
  })

  test('travas bloqueiam ações irreversíveis, mesmo em AUTOMATIC', () => {
    assert.equal(avaliarAcao(AUTO, { tipo: 'PUBLICAR', canal: 'tiktok', risco: 'BAIXO', publicacoesHojeNoCanal: 0 }, TRAVADO).resultado, 'BLOQUEAR')
    assert.equal(avaliarAcao(AUTO, { tipo: 'GASTAR', centavos: 10, gastoNoMesCentavos: 0, gastoNoDiaCentavos: 0 }, TRAVADO).resultado, 'BLOQUEAR')
    // Escolher produto não é irreversível: travas não impedem observar/sugerir.
    assert.equal(avaliarAcao(AUTO, { tipo: 'ESCOLHER_PRODUTO', risco: 'BAIXO' }, TRAVADO).resultado, 'PERMITIR')
  })

  test('matriz AUTOMATIC: limites, categoria, preço, risco, canal MANUAL, orçamento', () => {
    const pub = (o: Partial<{ canal: string; risco: 'BAIXO' | 'MEDIO' | 'ALTO'; publicacoesHojeNoCanal: number; preco: number; categoria: string; primeiraNoCanal: boolean }>) =>
      avaliarAcao(AUTO, { tipo: 'PUBLICAR', canal: 'tiktok', risco: 'BAIXO', publicacoesHojeNoCanal: 0, ...o }, LIVRE).resultado
    assert.equal(pub({}), 'PERMITIR')
    assert.equal(pub({ publicacoesHojeNoCanal: 3 }), 'BLOQUEAR')
    assert.equal(pub({ categoria: 'Medicamentos' }), 'BLOQUEAR')
    assert.equal(pub({ preco: 501 }), 'BLOQUEAR')
    assert.equal(pub({ risco: 'MEDIO' }), 'PERMITIR')
    assert.equal(pub({ risco: 'ALTO' }), 'EXIGIR_APROVACAO')
    assert.equal(pub({ canal: 'instagram' }), 'EXIGIR_APROVACAO')
    assert.equal(pub({ primeiraNoCanal: true }), 'EXIGIR_APROVACAO')
    const gasto = (c: number, mes = 0, dia = 0) => avaliarAcao(AUTO, { tipo: 'GASTAR', centavos: c, gastoNoMesCentavos: mes, gastoNoDiaCentavos: dia }, LIVRE).resultado
    assert.equal(gasto(0), 'PERMITIR')
    assert.equal(gasto(100), 'PERMITIR')
    assert.equal(gasto(200), 'EXIGIR_APROVACAO')
    assert.equal(gasto(100, 950), 'BLOQUEAR')
    assert.equal(gasto(100, 0, 250), 'BLOQUEAR')
  })

  test('esquema: rotulagem de IA e identificação publicitária não podem ser desligadas', () => {
    assert.ok(EsquemaDaPolitica.safeParse(POLITICA_PADRAO).success)
    assert.equal(EsquemaDaPolitica.safeParse({ ...POLITICA_PADRAO, conteudo: { rotularConteudoDeIA: false, identificacaoPublicitaria: true } }).success, false)
    assert.equal(EsquemaDaPolitica.safeParse({ ...POLITICA_PADRAO, custo: { ...POLITICA_PADRAO.custo, orcamentoMensalCentavos: -1 } }).success, false)
  })
})

describe('Approval Engine — regras (puro)', () => {
  const agora = new Date('2026-10-09T12:00:00Z')
  const regra = (o: Partial<{ id: string; efeito: string; condicao: object; validaAte: Date | null; ativa: boolean; revogadaEm: Date | null; tipo: string }>) => ({
    id: 'r', tipo: 'PUBLICAR', efeito: 'APROVAR', condicao: {}, validaAte: null, ativa: true, revogadaEm: null, ...o,
  })
  test('condição: todos os campos precisam casar; desconhecido nunca casa com limite', () => {
    assert.ok(regraCasa({ categoriaIn: ['Casa'], precoMax: 300, riscoMax: 'BAIXO' }, { risco: 'BAIXO', categoria: 'Casa', preco: 299 }))
    assert.ok(!regraCasa({ precoMax: 300 }, { risco: 'BAIXO', preco: null }))
    assert.ok(!regraCasa({ categoriaIn: ['Casa'] }, { risco: 'BAIXO' }))
    assert.ok(!regraCasa({ riscoMax: 'BAIXO' }, { risco: 'MEDIO' }))
  })
  test('REJEITAR vence APROVAR; regra vencida, revogada, inativa ou de outro tipo não vale', () => {
    const f = { risco: 'BAIXO' as const }
    assert.equal(regraAplicavel([regra({ id: 'a' }), regra({ id: 'b', efeito: 'REJEITAR' })], 'PUBLICAR', f, agora)?.id, 'b')
    assert.equal(regraAplicavel([regra({ validaAte: new Date('2026-10-09T11:59:59Z') })], 'PUBLICAR', f, agora), null)
    assert.equal(regraAplicavel([regra({ revogadaEm: agora })], 'PUBLICAR', f, agora), null)
    assert.equal(regraAplicavel([regra({ ativa: false })], 'PUBLICAR', f, agora), null)
    assert.equal(regraAplicavel([regra({ tipo: 'GASTAR' })], 'PUBLICAR', f, agora), null)
  })
})

describe('Supervisor — máquina de estados (pura)', () => {
  test('fluxo feliz é aceito passo a passo; pular etapa é recusado', () => {
    for (let i = 0; i < FLUXO.length - 1; i++) assert.ok(podeTransitar(FLUXO[i], FLUXO[i + 1]), `${FLUXO[i]}→${FLUXO[i + 1]}`)
    assert.ok(!podeTransitar('PLANEJADO', 'PUBLICANDO'))
    assert.ok(!podeTransitar('CRIANDO', 'PUBLICANDO'))
    assert.ok(!podeTransitar('DESCOBRINDO', 'DESCOBRINDO'))
  })
  test('terminais não saem; qualquer ativo pode falhar/cancelar/pausar', () => {
    for (const t of ['CONCLUIDO', 'FALHOU', 'CANCELADO'] as const) assert.ok(!podeTransitar(t, 'PLANEJADO'))
    assert.ok(podeTransitar('PUBLICANDO', 'FALHOU') && podeTransitar('CRIANDO', 'CANCELADO') && podeTransitar('MEDINDO', 'PAUSADO'))
    assert.ok(podeTransitar('AGUARDANDO_APROVACAO', 'DECIDINDO'), 'rejeição volta a decidir')
  })
  test('retomada só volta ao estado em que parou', () => {
    assert.ok(retomadaValida('CRIANDO', 'CRIANDO'))
    assert.ok(!retomadaValida('CRIANDO', 'PUBLICANDO'))
    assert.ok(!retomadaValida(null, 'CRIANDO'))
  })
})

describe('Flags, travas e providers (puro)', () => {
  test('flags nascem desligadas; env false vence tudo; desconhecida é false', () => {
    assert.equal(resolverFlag({}), false)
    assert.equal(resolverFlag({ global: true }), true)
    assert.equal(resolverFlag({ global: true, workspace: false }), false)
    assert.equal(resolverFlag({ env: 'false', workspace: true, global: true }), false)
    assert.ok(!ehFlagConhecida('QUALQUER_COISA'))
    assert.ok(Object.keys(FLAGS).length >= 5)
  })
  test('travas combinadas; kill switch global só com "true" explícito', () => {
    assert.equal(killSwitchGlobalAtivo({ PATRONO_AUTOPILOT_DESLIGADO: 'TRUE ' }), true)
    assert.equal(killSwitchGlobalAtivo({ PATRONO_AUTOPILOT_DESLIGADO: '1' }), false)
    assert.equal(combinarTravas({ global: false, pausado: false, safeMode: false }).acoesIrreversiveisBloqueadas, false)
    assert.match(combinarTravas({ global: true, pausado: false, safeMode: true }).motivoDoBloqueio!, /global/)
    assert.match(combinarTravas({ global: false, pausado: true, safeMode: true, motivoSafeMode: 'falha de token' }).motivoDoBloqueio!, /falha de token/)
  })
  test('roteador de vídeo: licença, consentimento, custo e saúde; mais barato vence; troca sem mudar o núcleo', () => {
    const reg = new RegistroDeProviders()
    const base: DescritorDeProvider = { id: 'x', tipo: 'MIDIA', capacidades: ['VIDEO_VERTICAL'], licenca: 'COMERCIAL', custoEstimadoCentavos: 0, consentimentosExigidos: [], oficial: true, exigeCredencial: false }
    reg.registrar({ ...base, id: 'local-gratis' })
    reg.registrar({ ...base, id: 'avatar-pago', custoEstimadoCentavos: 500, consentimentosExigidos: ['USO_DE_IMAGEM_DA_TITULAR'] })
    reg.registrar({ ...base, id: 'nc', licenca: 'NAO_COMERCIAL' })
    const pedido = { capacidade: 'VIDEO_VERTICAL' as const, licencasPermitidas: ['COMERCIAL' as const], consentimentosConcedidos: [], custoMaximoCentavos: 1000, saude: () => 'OK' as const }
    assert.equal(reg.escolher(pedido).provider?.id, 'local-gratis')
    assert.equal(reg.escolher({ ...pedido, saude: (id) => (id === 'local-gratis' ? 'FORA' : 'OK') }).provider, null, 'sem consentimento, o pago não entra')
    assert.equal(reg.escolher({ ...pedido, consentimentosConcedidos: ['USO_DE_IMAGEM_DA_TITULAR'], saude: (id) => (id === 'local-gratis' ? 'FORA' : 'OK') }).provider?.id, 'avatar-pago')
    assert.equal(reg.escolher({ ...pedido, custoMaximoCentavos: 0, consentimentosConcedidos: ['USO_DE_IMAGEM_DA_TITULAR'], saude: (id) => (id === 'local-gratis' ? 'FORA' : 'OK') }).provider, null)
    assert.ok(reg.escolher(pedido).descartados.some((d) => d.id === 'nc'))
    assert.throws(() => reg.registrar({ ...base, id: 'local-gratis' }), /duplicado/)
    assert.throws(() => reg.registrar({ ...base, id: 'scraper', oficial: false as unknown as true }), /oficial/)
  })
})

describe('Fitness de arquitetura (lê o código)', () => {
  const RAIZ = join(__dirname, '..')
  function arquivos(dir: string, out: string[] = []): string[] {
    for (const n of readdirSync(join(RAIZ, dir))) {
      const rel = `${dir}/${n}`
      if (statSync(join(RAIZ, rel)).isDirectory()) arquivos(rel, out)
      else if (/\.(ts|tsx)$/.test(n)) out.push(rel)
    }
    return out
  }
  const codigo = [...arquivos('lib'), ...arquivos('app')]

  test('só lib/prisma.ts cria PrismaClient no app (toda escrita passa pelo cofre)', () => {
    const fora = codigo.filter((f) => f !== 'lib/prisma.ts' && /new PrismaClient\s*\(/.test(readFileSync(join(RAIZ, f), 'utf8')))
    assert.deepEqual(fora, [])
  })
  test('nenhum SQL cru grava tokens de Integracao fora do cofre', () => {
    const suspeitos = codigo.filter((f) => {
      const s = readFileSync(join(RAIZ, f), 'utf8')
      return /\$(executeRaw|queryRaw)[\s\S]{0,400}"Integracao"[\s\S]{0,200}(accessToken|refreshToken)/.test(s)
    })
    assert.deepEqual(suspeitos, [])
  })
  test('contratos de provider não fazem rede nem scraping', () => {
    const s = readFileSync(join(RAIZ, 'lib/providers/contratos.ts'), 'utf8')
    assert.ok(!/fetch\(|axios|puppeteer|playwright|cheerio/.test(s))
  })
  test('vocabulário de eventos sem duplicata; console.log não loga tokens nas rotas de integração', () => {
    assert.equal(new Set(TIPOS_DE_EVENTO).size, TIPOS_DE_EVENTO.length)
    const vaza = arquivos('app/api/integracoes').filter((f) => /console\.(log|info|error|warn)\([^)]*(accessToken|refreshToken|appSecret|clientToken)/.test(readFileSync(join(RAIZ, f), 'utf8')))
    assert.deepEqual(vaza, [])
  })
  test('migração 0A só adiciona: nenhum DROP, nenhum DELETE de dado, ALTER só ADD COLUMN', () => {
    const sql = readFileSync(join(RAIZ, 'prisma/migrations/20261010120000_fundacoes_autopilot_fase0a/migration.sql'), 'utf8')
    assert.ok(!/\bDROP\b/i.test(sql))
    assert.ok(!/\bDELETE\s+FROM\b/i.test(sql))
    assert.ok(!/\bTRUNCATE\b/i.test(sql))
    for (const linha of sql.split('\n').filter((l) => /ALTER TABLE "Workspace"/.test(l))) assert.match(linha + ' ADD COLUMN', /ADD COLUMN/)
  })
})

// ── Com banco de TESTE ──────────────────────────────────────────────────
const TEM_BANCO = !!process.env.DATABASE_URL

describe('Fundações contra o banco de teste', { skip: !TEM_BANCO ? 'DATABASE_URL ausente — exige Postgres' : false }, () => {
  let prisma: typeof import('../lib/prisma').prisma
  let L: typeof import('../lib/ledger')
  let P: typeof import('../lib/politica')
  let A: typeof import('../lib/aprovacoes')
  let R: typeof import('../lib/supervisor/run')
  let F: typeof import('../lib/feature-flags')
  let K: typeof import('../lib/kill-switch')
  let C: typeof import('../lib/cost-governor')
  let W: typeof import('../lib/webhook-receipt')
  let CUR: typeof import('../lib/curadoria')
  const marca = `r65-${Date.now()}`
  const ws: Record<'A' | 'B' | 'CUR', string> = { A: '', B: '', CUR: '' }
  const usr: Record<string, string> = {}

  before(async () => {
    ;[{ prisma }, L, P, A, R, F, K, C, W, CUR] = await Promise.all([
      import('../lib/prisma'), import('../lib/ledger'), import('../lib/politica'), import('../lib/aprovacoes'),
      import('../lib/supervisor/run'), import('../lib/feature-flags'), import('../lib/kill-switch'),
      import('../lib/cost-governor'), import('../lib/webhook-receipt'), import('../lib/curadoria'),
    ])
    for (const n of Object.keys(ws) as (keyof typeof ws)[]) {
      ws[n] = (await prisma.workspace.create({ data: { name: `R65-${n}`, ownerId: `${marca}-${n}` }, select: { id: true } })).id
      usr[ws[n]] = (await prisma.user.create({ data: { email: `${marca}-${n}@teste.local`, name: 'U', password: 'x', workspaceId: ws[n] }, select: { id: true } })).id
    }
  })

  after(async () => {
    const ids = Object.values(ws).filter(Boolean)
    if (prisma && ids.length) {
      const w = { workspaceId: { in: ids } }
      await prisma.decisionRecord.deleteMany({ where: w })
      await prisma.domainEvent.deleteMany({ where: w })
      await prisma.approvalRequest.deleteMany({ where: w })
      await prisma.approvalRule.deleteMany({ where: w })
      await prisma.policyVersion.deleteMany({ where: w })
      await prisma.supervisorRun.deleteMany({ where: w })
      await prisma.costLedger.deleteMany({ where: w })
      await prisma.featureFlag.deleteMany({ where: { escopo: { in: ids } } })
      await prisma.webhookReceipt.deleteMany({ where: { provider: marca } })
      await prisma.candidatoDeProduto.deleteMany({ where: w })
      await prisma.perfilDaLoja.deleteMany({ where: w })
      await prisma.produto.deleteMany({ where: w })
      await prisma.auditLog.deleteMany({ where: w })
      await prisma.user.deleteMany({ where: w })
      await prisma.workspace.deleteMany({ where: { id: { in: ids } } })
    }
    await prisma?.$disconnect()
  })

  test('ledger: mesma chave = um registro; evento em transação desfeita não fica', async () => {
    const d = { workspaceId: ws.A, tipo: 'TESTE', ator: 'PATRONO' as const, decisao: 'x', chaveIdempotencia: 'k1', entradas: { token: 'nao-vaza' } }
    const [a, b] = await Promise.all([L.registrarDecisao(d).catch(() => L.registrarDecisao(d)), L.registrarDecisao(d).catch(() => L.registrarDecisao(d))])
    assert.equal(a.id, b.id)
    assert.equal(await prisma.decisionRecord.count({ where: { workspaceId: ws.A, chaveIdempotencia: 'k1' } }), 1)
    assert.ok(!JSON.stringify(a.entradas).includes('nao-vaza'), 'entradas devem ser redigidas')
    await assert.rejects(() => L.registrarEvento({ workspaceId: ws.A, tipo: 'INVENTADO' as never, chaveIdempotencia: 'z' }))
    await assert.rejects(() =>
      prisma.$transaction(async (tx) => {
        await L.registrarEvento({ workspaceId: ws.A, tipo: 'ERROR_DETECTED', chaveIdempotencia: 'rollback' }, tx)
        throw new Error('falha no meio')
      })
    )
    assert.equal(await prisma.domainEvent.count({ where: { workspaceId: ws.A, chaveIdempotencia: 'rollback' } }), 0)
  })

  test('política: publicações concorrentes geram versões distintas e só UMA ativa', async () => {
    assert.equal((await P.politicaAtiva(ws.A)).versao, 0)
    await Promise.all([1, 2, 3].map(() => P.publicarPolitica({ workspaceId: ws.A, regras: AUTO, ator: 'TITULAR', userId: usr[ws.A] })))
    const versoes = await prisma.policyVersion.findMany({ where: { workspaceId: ws.A }, orderBy: { versao: 'asc' } })
    assert.deepEqual(versoes.map((v) => v.versao), [1, 2, 3])
    assert.equal(versoes.filter((v) => v.ativa).length, 1)
    assert.equal((await P.politicaAtiva(ws.A)).versao, 3)
    assert.equal(await prisma.domainEvent.count({ where: { workspaceId: ws.A, tipo: 'POLICY_CHANGED' } }), 3)
    await assert.rejects(() => P.publicarPolitica({ workspaceId: ws.A, regras: { ...AUTO, conteudo: { rotularConteudoDeIA: false } }, ator: 'TITULAR' }))
    // Índice parcial do banco impede duas ativas mesmo por fora do código.
    await assert.rejects(() => prisma.policyVersion.create({ data: { workspaceId: ws.A, versao: 99, regras: {}, ativa: true, ator: 'SISTEMA' } }))
  })

  test('aprovação: pedido idempotente; clique duplo decide uma vez; vencido não aprova; isolamento', async () => {
    const pedido = { workspaceId: ws.A, tipo: 'PUBLICAR', chave: 'pub-1', titulo: 'Publicar vídeo', resumo: 'r', porque: ['primeira publicação'], fatos: { risco: 'MEDIO' as const }, acaoProposta: { conteudoId: 'c1' } }
    const [p1, p2] = await Promise.all([A.solicitarAprovacao(pedido).catch(() => A.solicitarAprovacao(pedido)), A.solicitarAprovacao(pedido).catch(() => A.solicitarAprovacao(pedido))])
    assert.equal(p1.id, p2.id)
    assert.equal(p1.status, 'PENDENTE')
    assert.equal((await A.pendentes(ws.A)).length, 1)
    await assert.rejects(() => A.decidirAprovacao({ workspaceId: ws.B, id: p1.id, decisao: 'APROVAR', userId: usr[ws.B] }), (e: unknown) => (e as { status: number }).status === 404)
    const r = await Promise.allSettled([1, 2, 3].map(() => A.decidirAprovacao({ workspaceId: ws.A, id: p1.id, decisao: 'APROVAR', userId: usr[ws.A] })))
    assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1)
    assert.equal(await prisma.domainEvent.count({ where: { workspaceId: ws.A, tipo: 'APPROVAL_GRANTED', entidadeId: p1.id } }), 1)

    const vencido = await A.solicitarAprovacao({ ...pedido, chave: 'pub-venc', expiraEm: new Date(Date.now() - 1000) })
    await assert.rejects(() => A.decidirAprovacao({ workspaceId: ws.A, id: vencido.id, decisao: 'APROVAR', userId: usr[ws.A] }), /vencido/)
    assert.equal(await A.expirarVencidas(ws.A), 1)
  })

  test('aprovação: regra da titular resolve sozinha (e REJEITAR vence)', async () => {
    const regra = await A.criarRegra({ workspaceId: ws.A, tipo: 'ESCOLHER_PRODUTO', condicao: { categoriaIn: ['Casa'], precoMax: 300, riscoMax: 'BAIXO' }, efeito: 'APROVAR', userId: usr[ws.A] })
    const ok = await A.solicitarAprovacao({ workspaceId: ws.A, tipo: 'ESCOLHER_PRODUTO', chave: 'esc-1', titulo: 't', resumo: 'r', porque: [], fatos: { risco: 'BAIXO', categoria: 'Casa', preco: 120 }, acaoProposta: {} })
    assert.equal(ok.status, 'APROVADA')
    assert.equal(ok.decididoPorRegraId, regra.id)
    const caro = await A.solicitarAprovacao({ workspaceId: ws.A, tipo: 'ESCOLHER_PRODUTO', chave: 'esc-2', titulo: 't', resumo: 'r', porque: [], fatos: { risco: 'BAIXO', categoria: 'Casa', preco: 900 }, acaoProposta: {} })
    assert.equal(caro.status, 'PENDENTE')
    await A.revogarRegra({ workspaceId: ws.A, id: regra.id, userId: usr[ws.A] })
    const depois = await A.solicitarAprovacao({ workspaceId: ws.A, tipo: 'ESCOLHER_PRODUTO', chave: 'esc-3', titulo: 't', resumo: 'r', porque: [], fatos: { risco: 'BAIXO', categoria: 'Casa', preco: 120 }, acaoProposta: {} })
    assert.equal(depois.status, 'PENDENTE')
  })

  test('supervisor: run idempotente; transição concorrente avança uma vez; pausa e retomada; PUBLICANDO respeita travas', async () => {
    const [r1, r2] = await Promise.all([R.iniciarRun({ workspaceId: ws.A, chave: 'ciclo-1', modo: 'ASSISTED' }).catch(() => R.iniciarRun({ workspaceId: ws.A, chave: 'ciclo-1', modo: 'ASSISTED' })), R.iniciarRun({ workspaceId: ws.A, chave: 'ciclo-1', modo: 'ASSISTED' }).catch(() => R.iniciarRun({ workspaceId: ws.A, chave: 'ciclo-1', modo: 'ASSISTED' }))])
    assert.equal(r1.id, r2.id)
    const corrida = await Promise.allSettled([1, 2, 3].map(() => R.transitar({ workspaceId: ws.A, runId: r1.id, de: 'PLANEJADO', para: 'DESCOBRINDO' })))
    assert.equal(corrida.filter((x) => x.status === 'fulfilled').length, 1)
    await assert.rejects(() => R.transitar({ workspaceId: ws.A, runId: r1.id, de: 'DESCOBRINDO', para: 'PUBLICANDO' }), /proibida/)
    await R.transitar({ workspaceId: ws.A, runId: r1.id, de: 'DESCOBRINDO', para: 'PAUSADO' })
    await assert.rejects(() => R.transitar({ workspaceId: ws.A, runId: r1.id, de: 'PAUSADO', para: 'RANQUEANDO' }), /Retomada inválida/)
    const retomado = await R.transitar({ workspaceId: ws.A, runId: r1.id, de: 'PAUSADO', para: 'DESCOBRINDO' })
    assert.equal(retomado.estado, 'DESCOBRINDO')
    assert.equal(await prisma.domainEvent.count({ where: { workspaceId: ws.A, tipo: 'RUN_STATE_CHANGED', entidadeId: r1.id } }), 3)

    // Leva um run até AGENDANDO e tenta publicar com o workspace pausado (padrão).
    const r = await R.iniciarRun({ workspaceId: ws.A, chave: 'ciclo-pub', modo: 'AUTOMATIC' })
    const passos = ['PLANEJADO', 'DESCOBRINDO', 'VALIDANDO', 'RANQUEANDO', 'DECIDINDO', 'CRIANDO', 'AGENDANDO'] as const
    for (let i = 0; i < passos.length - 1; i++) await R.transitar({ workspaceId: ws.A, runId: r.id, de: passos[i], para: passos[i + 1] })
    await assert.rejects(() => R.transitar({ workspaceId: ws.A, runId: r.id, de: 'AGENDANDO', para: 'PUBLICANDO' }), /pausada/)
    assert.equal((await prisma.supervisorRun.findUniqueOrThrow({ where: { id: r.id } })).estado, 'AGENDANDO', 'bloqueio não muda estado')
  })

  test('kill switch e Safe Mode: entrar é idempotente; bloqueia; sair só pela titular', async () => {
    await prisma.workspace.update({ where: { id: ws.B }, data: { automationPaused: false } })
    assert.equal((await K.estadoDeExecucao(ws.B, {})).acoesIrreversiveisBloqueadas, false)
    await K.exigirPodeAgir(ws.B, {})
    await assert.rejects(() => K.exigirPodeAgir(ws.B, { PATRONO_AUTOPILOT_DESLIGADO: 'true' }), /global/)
    const e = await Promise.all([1, 2].map((i) => K.entrarEmSafeMode({ workspaceId: ws.B, motivo: 'token expirado', ator: 'SISTEMA', agora: new Date(Date.now() + i) })))
    assert.equal(e.filter((x) => x.mudou).length, 1)
    await assert.rejects(() => K.exigirPodeAgir(ws.B, {}), /token expirado/)
    assert.equal(await prisma.domainEvent.count({ where: { workspaceId: ws.B, tipo: 'SAFE_MODE_ENTERED' } }), 1)
    assert.equal((await K.sairDoSafeMode({ workspaceId: ws.B, userId: usr[ws.B] })).mudou, true)
    await K.exigirPodeAgir(ws.B, {})
    assert.equal((await K.estadoDeExecucao('inexistente', {})).acoesIrreversiveisBloqueadas, true)
  })

  test('cost governor: bloqueado por padrão (e auditado); com orçamento, concorrência não estoura o teto; idempotente', async () => {
    const pedido = (chave: string, centavos = 100) => ({ workspaceId: ws.B, provider: 'anthropic', operacao: 'gerar-roteiro', estimadoCentavos: centavos, chaveIdempotencia: chave })
    const padrao = await C.reservarCusto({ ...pedido('c0'), env: {} })
    assert.equal(padrao.status, 'BLOQUEADO')
    assert.equal(await prisma.domainEvent.count({ where: { workspaceId: ws.B, tipo: 'COST_BLOCKED' } }), 1)
    assert.equal((await C.reservarCusto({ ...pedido('c-inv', 0), env: {} })).status, 'BLOQUEADO')

    await P.publicarPolitica({ workspaceId: ws.B, regras: AUTO, ator: 'TITULAR', userId: usr[ws.B] })
    const env = { PAID_AI_ENABLED: 'true', AI_MONTHLY_BUDGET: '50', AI_BUDGET_AUTORIZADO_POR: 'titular', AI_BUDGET_AUTORIZADO_ATE: '2099-12-31' }
    const r = await Promise.all([1, 2, 3, 4, 5].map((i) => C.reservarCusto({ ...pedido(`c${i}`), env })))
    assert.equal(r.filter((x) => x.status === 'RESERVADO').length, 3, 'teto diário de 300 centavos = 3 × 100')
    assert.equal(r.filter((x) => x.status === 'BLOQUEADO').length, 2)
    const soma = await prisma.costLedger.aggregate({ where: { workspaceId: ws.B, status: 'RESERVADO' }, _sum: { estimadoCentavos: true } })
    assert.equal(soma._sum.estimadoCentavos, 300)

    const primeira = r.find((x) => x.status === 'RESERVADO') as { id: string }
    const repetida = await C.reservarCusto({ ...pedido(`c${r.indexOf(primeira as never) + 1}`), env })
    assert.equal(repetida.status, 'RESERVADO')
    assert.equal((repetida as { repetida: boolean }).repetida, true)
    assert.equal(await C.confirmarCusto({ workspaceId: ws.B, id: primeira.id, realCentavos: 87 }), true)
    assert.equal(await C.confirmarCusto({ workspaceId: ws.B, id: primeira.id, realCentavos: 87 }), false)
    await assert.rejects(() => C.cancelarReserva({ workspaceId: ws.B, id: primeira.id, provaDeNaoCobranca: ' ' }), /prova/)
    // Gasto acima do limite de aprovação automática não reserva: pede aprovação.
    assert.equal((await C.reservarCusto({ ...pedido('c-alto', 200), env, agora: new Date(Date.now() + 86_400_000) })).status, 'EXIGE_APROVACAO')
    // Safe Mode bloqueia gasto mesmo com orçamento.
    await K.entrarEmSafeMode({ workspaceId: ws.B, motivo: 'teste', ator: 'SISTEMA' })
    assert.equal((await C.reservarCusto({ ...pedido('c-safe', 50), env, agora: new Date(Date.now() + 86_400_000) })).status, 'BLOQUEADO')
  })

  test('freio de emergência nas portas ANTIGAS: publicação e chamada paga respeitam Safe Mode e kill switch global', async () => {
    const { autorizarPublicacaoReal } = await import('../lib/porta-de-publicacao-real')
    const { guardarChamadaPaga } = await import('../lib/cost-safety-gate')
    // ws.B terminou o teste anterior em Safe Mode.
    assert.equal((await prisma.workspace.findUniqueOrThrow({ where: { id: ws.B } })).safeModeAtivo, true)
    const pub = await autorizarPublicacaoReal({ workspaceId: ws.B, contentId: 'qualquer', canal: 'instagram', env: {} })
    assert.equal(pub.liberada, false)
    assert.equal(pub.bloqueio, 'SAFE_MODE_OU_KILL_SWITCH')
    const pago = await guardarChamadaPaga({ provider: 'anthropic', operacao: 'gerar-roteiro', workspaceId: ws.B, env: { PAID_AI_ENABLED: 'true', AI_MONTHLY_BUDGET: '50', AI_BUDGET_AUTORIZADO_POR: 'titular', AI_BUDGET_AUTORIZADO_ATE: '2099-12-31' } })
    assert.equal(pago.permitido, false)
    // Kill switch global fecha também quem não está em Safe Mode.
    const glob = await autorizarPublicacaoReal({ workspaceId: ws.A, contentId: 'qualquer', canal: 'instagram', env: { PATRONO_AUTOPILOT_DESLIGADO: 'true' } })
    assert.equal(glob.bloqueio, 'SAFE_MODE_OU_KILL_SWITCH')
    // Sem trava, a porta segue para o preflight de sempre (que decide o resto).
    const livre = await autorizarPublicacaoReal({ workspaceId: ws.A, contentId: 'qualquer', canal: 'instagram', env: {} })
    assert.notEqual(livre.bloqueio, 'SAFE_MODE_OU_KILL_SWITCH')
    await prisma.auditLog.deleteMany({ where: { workspaceId: ws.B } })
  })

  test('flags no banco: workspace vence global; env false desliga', async () => {
    assert.equal(await F.flagLigada('COPILOT_DETERMINISTICO', ws.A, {}), false)
    await F.definirFlag({ chave: 'COPILOT_DETERMINISTICO', escopo: ws.A, ligada: true })
    assert.equal(await F.flagLigada('COPILOT_DETERMINISTICO', ws.A, {}), true)
    assert.equal(await F.flagLigada('COPILOT_DETERMINISTICO', ws.B, {}), false)
    assert.equal(await F.flagLigada('COPILOT_DETERMINISTICO', ws.A, { FLAG_COPILOT_DETERMINISTICO: 'false' }), false)
    assert.equal(await F.flagLigada('NAO_EXISTE', ws.A, {}), false)
  })

  test('webhook: reivindicações concorrentes do mesmo evento — só uma processa', async () => {
    const s = new W.WebhookReceiptStore(marca)
    const r = await Promise.all([1, 2, 3, 4].map(() => s.reivindicar('evt-1')))
    assert.equal(r.filter(Boolean).length, 1)
    assert.equal(await s.jaProcessado('evt-1'), true)
    assert.equal(await s.jaProcessado('evt-2'), false)
  })

  test('curadoria registra decisão + CANDIDATES_PRESENTED na coleta e PRODUCT_SELECTED na escolha', async () => {
    const w = ws.CUR
    await prisma.produto.createMany({
      data: Array.from({ length: 5 }, (_, i) => ({
        workspaceId: w, userId: usr[w], nome: `${marca} organizador ${i}`, categoria: 'Casa e Decoração', preco: 50 + i * 30,
        tipoVenda: 'Afiliado', origemConteudo: 'De fornecedor', imagens: [], linkProduto: `https://loja.invalido/${marca}/${i}`,
      })),
    })
    const col = await CUR.coletarCandidatos({ workspaceId: w, userId: usr[w] })
    assert.ok(col.apresentados > 0)
    const dec = await prisma.decisionRecord.findFirstOrThrow({ where: { workspaceId: w, tipo: 'CURADORIA_APRESENTACAO' } })
    assert.equal(dec.ator, 'PATRONO')
    assert.equal(dec.explicacao.length, col.apresentados)
    assert.equal(await prisma.domainEvent.count({ where: { workspaceId: w, tipo: 'CANDIDATES_PRESENTED' } }), 1)
    // P2.14.8: decisão e evento da mesma coleta compartilham correlationId e chave; chaves de produto não são redigidas.
    const evento = await prisma.domainEvent.findFirstOrThrow({ where: { workspaceId: w, tipo: 'CANDIDATES_PRESENTED' } })
    assert.match(dec.correlationId ?? '', /^coleta_/)
    assert.equal(evento.correlationId, dec.correlationId)
    assert.equal(evento.chaveIdempotencia, dec.chaveIdempotencia)
    assert.ok(Array.isArray((evento.payload as { chaves: unknown }).chaves), 'chaves de produto não podem ser redigidas')
    assert.ok(!JSON.stringify(dec.entradas).includes('[redigido]'))
    const [primeiro] = await CUR.listarApresentados(w)
    await CUR.escolherCandidato({ workspaceId: w, userId: usr[w], candidatoId: primeiro.id })
    assert.equal(await prisma.domainEvent.count({ where: { workspaceId: w, tipo: 'PRODUCT_SELECTED' } }), 1)
    const esc = await prisma.decisionRecord.findFirstOrThrow({ where: { workspaceId: w, tipo: 'ESCOLHA_DE_PRODUTO' } })
    assert.equal(esc.ator, 'TITULAR')
    const sel = await prisma.domainEvent.findFirstOrThrow({ where: { workspaceId: w, tipo: 'PRODUCT_SELECTED' } })
    assert.match(esc.correlationId ?? '', /^escolha_/)
    assert.equal(sel.correlationId, esc.correlationId)
    assert.notEqual(esc.correlationId, dec.correlationId, 'escolha e coleta são execuções diferentes')
    await assert.rejects(() => CUR.escolherCandidato({ workspaceId: w, userId: usr[w], candidatoId: primeiro.id }))
    assert.equal(await prisma.domainEvent.count({ where: { workspaceId: w, tipo: 'PRODUCT_SELECTED' } }), 1, 'segunda escolha não duplica evento')
  })
})
