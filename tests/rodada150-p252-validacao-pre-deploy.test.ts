/**
 * P2.52 — Validação pré-deploy pedida pela titular (25/10):
 *  (4) o limite de R$ 0 não bloqueia o que é gratuito e nenhuma chamada paga sai sem autorização válida;
 *  (5) comportamento REAL do Painel de Afiliados, do Calendário editorial e do Lucro Real no banco de TESTE:
 *      workspace sem dados, comissões em todos os estados (inclusive cancelada e estornada), registro de teste
 *      fora do painel, peças retidas/aprovadas/publicadas/sem data e custo reservado.
 * Cria um workspace próprio e apaga tudo no fim.
 */
process.env.PATRONO_TESTE_LEGADO_SEM_TRES_CONTROLES = ''
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { guardarChamadaPaga, lerPoliticaDeCusto, ACAO_AUDIT_AUTORIZADO } from '../lib/cost-safety-gate'

const fonte = (f: string) => readFileSync(f, 'utf8')

describe('(4) Limite de R$ 0: nada pago sem autorização; o gratuito continua', () => {
  test('cada chamada paga tem o seu portão ANTES da chamada (por função, não só por arquivo)', () => {
    const claude = fonte('lib/claude.ts')
    assert.equal((claude.match(/client\.messages\.create\(/g) ?? []).length, (claude.match(/await exigirPermissaoDeCusto\(/g) ?? []).length)
    for (const bloco of claude.split(/\nexport async function /).slice(1)) {
      const chamada = bloco.indexOf('client.messages.create(')
      if (chamada >= 0) assert.ok(bloco.indexOf('await exigirPermissaoDeCusto(') >= 0 && bloco.indexOf('await exigirPermissaoDeCusto(') < chamada, bloco.slice(0, 40))
    }
    assert.doesNotMatch(claude, /export (const|let) client\b/, 'o cliente da Anthropic não sai do módulo')
    const fal = fonte('lib/falai.ts')
    for (const bloco of fal.split(/\nexport async function /).slice(1)) {
      const post = bloco.indexOf("method: 'POST'")
      if (post >= 0) assert.ok(bloco.indexOf('await exigirAutorizacaoFal(') >= 0 && bloco.indexOf('await exigirAutorizacaoFal(') < post, bloco.slice(0, 40))
    }
    const zap = fonte('lib/whatsapp.ts')
    for (const nome of ['enviarTexto', 'enviarImagem']) {
      const bloco = zap.slice(zap.indexOf(`export async function ${nome}`))
      assert.ok(bloco.indexOf("envioPermitidoPelaPolitica(") < bloco.indexOf('fetch('), nome)
    }
    const email = fonte('lib/email.ts')
    assert.ok(email.indexOf('guardarChamadaPaga(') < email.indexOf('emails.send('))
  })

  test('nenhum outro arquivo fala com provedor pago (SDK ou endpoint)', async () => {
    const { execFileSync } = await import('node:child_process')
    const saida = execFileSync('git', ['grep', '-lE', "new Anthropic\\(|from '@anthropic-ai/sdk'|from 'resend'|api\\.z-api\\.io|fal\\.run|api\\.openai|elevenlabs|replicate\\.com|heygen|d-id\\.com|firecrawl", '--', 'lib', 'app', 'netlify', 'worker', 'components'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).sort()
    assert.deepEqual(saida, ['lib/claude.ts', 'lib/email.ts', 'lib/falai.ts', 'lib/whatsapp.ts'])
  })

  test('caminhos gratuitos não passam pelo orçamento (não são bloqueados pelo R$ 0)', () => {
    for (const f of ['lib/conteudo-gratuito.ts', 'lib/renderer-ffmpeg.ts', 'lib/chatterbox-adapter.ts', 'lib/creator-center-importacao.ts', 'lib/concat-video.ts', 'lib/painel-afiliados.ts', 'lib/calendario-editorial.ts']) {
      assert.doesNotMatch(fonte(f), /guardarChamadaPaga|exigirPermissaoDeCusto|exigirAutorizacaoFal/, f)
    }
    // Quando a parte paga é bloqueada, as rotas caem no caminho gratuito (em vez de falhar).
    for (const f of ['app/api/conteudos/gerar/route.ts', 'app/api/conteudos/[id]/gerar-video/route.ts', 'app/api/conteudos/[id]/video-status/route.ts']) {
      assert.match(fonte(f), /BloqueadoPorPoliticaDeCusto/, f)
    }
  })

  test('configuração igual à de Production hoje (sem chaves de IA paga, sem orçamento): tudo pago bloqueado', async () => {
    const env = { PATRONO_AMBIENTE: 'producao' }
    assert.equal(lerPoliticaDeCusto(env).orcamentoMensal, 0)
    for (const [provider, operacao] of [['anthropic', 'gerar-roteiro'], ['fal.ai', 'gerar-video'], ['resend', 'enviar-email'], ['z-api', 'enviar-whatsapp']] as const) {
      const g = await guardarChamadaPaga({ provider, operacao, workspaceId: null, env })
      assert.equal(g.permitido, false, `${provider}:${operacao}`)
    }
  })

  test('com chave e orçamento mas SEM autorização (ou vencida): continua bloqueado; só a autorização válida libera', async () => {
    const base = { PAID_AI_ENABLED: 'true', AI_MONTHLY_BUDGET: '50', ANTHROPIC_API_KEY: 'chave-qualquer' }
    const agora = new Date('2026-11-02T12:00:00-03:00')
    for (const extra of [{}, { AI_BUDGET_AUTORIZADO_POR: 'titular' }, { AI_BUDGET_AUTORIZADO_POR: 'titular', AI_BUDGET_AUTORIZADO_ATE: '2026-11-01' }]) {
      const g = await guardarChamadaPaga({ provider: 'anthropic', operacao: 'gerar-roteiro', workspaceId: null, env: { ...base, ...extra }, agora })
      assert.equal(g.permitido, false, JSON.stringify(extra))
    }
    assert.equal(lerPoliticaDeCusto({ ...base, AI_BUDGET_AUTORIZADO_POR: 'titular', AI_BUDGET_AUTORIZADO_ATE: '2026-11-30' }, agora).orcamentoMensal, 50)
  })
})

describe('(5) Comportamento real no banco de TESTE', { skip: !process.env.DATABASE_URL ? 'sem banco' : false }, () => {
  let prisma: typeof import('../lib/prisma').prisma
  let ws = ''
  let wsVazio = ''
  const ids = { users: [] as string[] }

  before(async () => {
    ;({ prisma } = await import('../lib/prisma'))
    const { criarUsuarioComWorkspace } = await import('../lib/workspace')
    const a = await criarUsuarioComWorkspace(prisma, { email: `r150-a-${randomUUID()}@teste.local`, password: 'x' })
    const b = await criarUsuarioComWorkspace(prisma, { email: `r150-b-${randomUUID()}@teste.local`, password: 'x' })
    ws = a.user.workspaceId
    wsVazio = b.user.workspaceId
    ids.users.push(a.user.id, b.user.id)

    const tts = await prisma.affiliateProgram.create({ data: { workspaceId: ws, platform: 'tiktokshop' } })
    const shp = await prisma.affiliateProgram.create({ data: { workspaceId: ws, platform: 'shopee' } })
    const venda = (programa: string, dataOrigin: string, status = 'CONFIRMED') => prisma.sale.create({ data: { workspaceId: ws, affiliateProgramId: programa, status, dataOrigin, source: 'manual' } })
    const comissao = async (programa: string, dados: { status: string; expectedAmount?: number; confirmedAmount?: number; receivedAmount?: number }, dataOrigin = 'USER_REPORTED', vendaStatus = 'CONFIRMED') => {
      const s = await venda(programa, dataOrigin, vendaStatus)
      return prisma.commission.create({ data: { workspaceId: ws, saleId: s.id, affiliateProgramId: programa, ...dados } })
    }
    await comissao(tts.id, { status: 'EXPECTED', expectedAmount: 10 }, 'USER_REPORTED', 'PENDING')
    await comissao(tts.id, { status: 'CONFIRMED', expectedAmount: 2.6, confirmedAmount: 2.56 }, 'REAL_OPERATION')
    await comissao(tts.id, { status: 'RECEIVED', expectedAmount: 5, confirmedAmount: 5, receivedAmount: 5 })
    await comissao(tts.id, { status: 'CANCELLED', expectedAmount: 3 }, 'USER_REPORTED', 'CANCELLED')
    await comissao(tts.id, { status: 'REVERSED', expectedAmount: 4, confirmedAmount: 4, receivedAmount: 4 })
    await comissao(shp.id, { status: 'RECEIVED', expectedAmount: 7, confirmedAmount: 7, receivedAmount: 7 })
    await comissao(shp.id, { status: 'RECEIVED', expectedAmount: 999, confirmedAmount: 999, receivedAmount: 999 }, 'TEST_FIXTURE')

    // Custo reservado de uma chamada paga autorizada (R$ 1,50) — entra no resultado.
    await prisma.auditLog.create({ data: { workspaceId: ws, action: ACAO_AUDIT_AUTORIZADO, entityType: 'CostSafetyGate', entityId: 'anthropic:gerar-roteiro', metadata: { custoReservado: 1.5 } } })

    const sha = 'b'.repeat(64)
    const qgOk = { veredito: 'APROVADO', arquivo: { sha256: sha }, comercial: { veredito: 'APRESENTAR_A_TITULAR' }, conformidade: { veredito: 'APTO' }, barreira: { decisao: 'APTO_PARA_TITULAR', sha256: sha, resumo: 'ok' } }
    const peca = (estado: string, extra: Record<string, unknown>) => prisma.publicacaoAssistida.create({
      data: { workspaceId: ws, estado, nomeProduto: `Peça ${estado}`, varianteId: 'v', estrutura: 'APRESENTACAO_NARRADA', motivoEscolha: 'teste', objetivoDoTeste: 'teste', apresentacao: { video: { sha256: sha } }, qualityGate: qgOk, ...extra } as never,
    })
    await peca('AGUARDANDO_APROVACAO', { horarioPlanejado: new Date('2026-11-03T18:00:00Z'), qualityGate: { veredito: 'APROVADO', arquivo: { sha256: sha }, comercial: { veredito: 'BLOQUEADO', bloqueios: ['o produto real nunca aparece'] }, conformidade: { veredito: 'PENDENTE', resumo: 'demonstração fiel pendente' } } })
    await peca('AGUARDANDO_APROVACAO', { horarioPlanejado: new Date('2026-11-04T18:00:00Z') })
    await peca('APROVADO', { horarioPlanejado: new Date('2026-11-05T18:00:00Z') })
    await peca('PUBLICADO', { publicadoEm: new Date('2026-10-20T15:00:00Z') })
    await peca('GERANDO_VIDEO', {})
    await peca('AGUARDANDO_APROVACAO', { demonstracao: true })
  })

  after(async () => {
    for (const w of [ws, wsVazio].filter(Boolean)) {
      await prisma.publicacaoAssistida.deleteMany({ where: { workspaceId: w } })
      await prisma.commission.deleteMany({ where: { workspaceId: w } })
      await prisma.sale.deleteMany({ where: { workspaceId: w } })
      await prisma.affiliateProgram.deleteMany({ where: { workspaceId: w } })
      await prisma.auditLog.deleteMany({ where: { workspaceId: w } })
      await prisma.user.deleteMany({ where: { workspaceId: w } })
      await prisma.workspace.deleteMany({ where: { id: w } })
    }
    await prisma.$disconnect()
  })

  test('sem dados: painel vazio, calendário vazio, resultado zero confirmado e vendas próprias "sem operação"', async () => {
    const { painelDeAfiliados } = await import('../lib/painel-afiliados')
    const { calendarioEditorial } = await import('../lib/calendario-editorial')
    const { resultadoAposCustos } = await import('../lib/financeiro')
    const p = await painelDeAfiliados(wsVazio)
    assert.deepEqual(p.total.quantidades, { ESTIMADA: 0, APROVADA: 0, RECEBIDA: 0, CANCELADA: 0, ESTORNADA: 0 })
    assert.equal(p.porPlataforma.length, 0)
    assert.deepEqual(await calendarioEditorial(wsVazio), [])
    const r = await resultadoAposCustos(wsVazio)
    assert.equal(r.receitaConfirmada, 0)
    assert.equal(r.custos, 0)
    assert.equal(r.resultado, 0)
    assert.equal(r.porOperacao.vendasProprias.situacao, 'SEM_OPERACAO')
  })

  test('painel: cinco situações com cancelada e estornada separadas; teste fora; TikTok Shop primeiro', async () => {
    const { painelDeAfiliados } = await import('../lib/painel-afiliados')
    const p = await painelDeAfiliados(ws)
    assert.deepEqual(p.total.valores, { ESTIMADA: 10, APROVADA: 2.56, RECEBIDA: 12, CANCELADA: 3, ESTORNADA: 4 })
    assert.deepEqual(p.total.quantidades, { ESTIMADA: 1, APROVADA: 1, RECEBIDA: 2, CANCELADA: 1, ESTORNADA: 1 })
    assert.equal(p.total.confirmado, 14.56, 'confirmado = aprovadas + recebidas; estimada, cancelada e estornada fora')
    assert.equal(p.excluidos.quantidade, 1, 'o registro TEST_FIXTURE (R$ 999) não entra')
    assert.equal(p.porPlataforma[0].plataforma, 'tiktok-shop')
    assert.deepEqual(p.porPlataforma[0].valores, { ESTIMADA: 10, APROVADA: 2.56, RECEBIDA: 5, CANCELADA: 3, ESTORNADA: 4 })
    assert.equal(p.porPlataforma[1].plataforma, 'shopee')
  })

  test('Lucro Real: confirmado − custo reservado; previsão e estorno fora do resultado', async () => {
    const { resultadoAposCustos } = await import('../lib/financeiro')
    const r = await resultadoAposCustos(ws)
    // P2.52: mesma regra de origem do painel — o registro de teste (R$ 999) NÃO vira lucro.
    assert.equal(r.receitaConfirmada, 14.56)
    assert.equal(r.custosReservados, 1.5)
    assert.equal(r.resultado, 13.06)
    assert.equal(r.porOperacao.afiliados.estornos, 4)
    assert.equal(r.porOperacao.afiliados.previsao, 10)
    assert.equal(r.resultado, Math.round((r.receitaConfirmada - 1.5) * 100) / 100)
    assert.equal(r.porOperacao.vendasProprias.situacao, 'SEM_OPERACAO')
  })

  test('calendário: retida com motivos, aguardando a titular, aprovada, publicada na data real, sem data; demonstração fora', async () => {
    const { calendarioEditorial } = await import('../lib/calendario-editorial')
    const c = await calendarioEditorial(ws)
    assert.equal(c.length, 5, 'a peça de demonstração não aparece')
    const por = Object.fromEntries(c.map((p) => [p.titulo + '|' + (p.quando ?? 'sem'), p]))
    const retida = c.find((p) => p.situacao === 'RETIDO')!
    assert.ok(retida.motivos.some((m) => /produto real nunca aparece/.test(m)))
    assert.ok(retida.motivos.some((m) => /demonstração fiel pendente/.test(m)))
    assert.ok(c.some((p) => p.situacao === 'AGUARDANDO_TITULAR'))
    assert.ok(c.some((p) => p.situacao === 'APROVADO'))
    const pub = c.find((p) => p.situacao === 'PUBLICADO')!
    assert.equal(pub.origemDaData, 'PUBLICADO')
    assert.equal(pub.quando, '2026-10-20T15:00:00.000Z')
    assert.equal(c[c.length - 1].quando, null, '"sem data" no fim')
    assert.equal(c[c.length - 1].situacao, 'EM_PRODUCAO')
    assert.ok(Object.keys(por).length === 5)
  })
})
