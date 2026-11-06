/**
 * P2.9 — Retenção e expurgo dos registros de tarefas em segundo plano.
 *
 *   - ensaio por padrão: relata e não escreve;
 *   - anonimiza WhatsApp/legenda concluídos e parados há N dias: nenhum
 *     número, mensagem, texto ou URL sobra na linha;
 *   - publicação e tarefas ativas nunca são tocadas;
 *   - exclui só o que já foi anonimizado há tempo suficiente;
 *   - um workspace por vez; repetir não muda nada; corrida não sobrescreve;
 *   - depois de anonimizar, o mesmo pedido NÃO reenvia.
 *
 * Banco de TESTE (DATABASE_URL). Nenhum provider é chamado. R$ 0,00.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  lerPrazos,
  decidirRetencao,
  contextoAnonimizado,
  executarRetencao,
  PRAZO_PADRAO_DE_ANONIMIZACAO_DIAS,
  PRAZO_PADRAO_DE_EXCLUSAO_DIAS,
  type TarefaParaRetencao,
} from '../lib/retencao-de-tarefas'
import { portaDeRetencaoPrisma } from '../lib/automation-queue-prisma'
import { iniciarTrabalhoLongo, RESERVA_DO_SEGUNDO_PLANO } from '../lib/trabalho-longo'
import { prisma } from '../lib/prisma'

const RAIZ = join(__dirname, '..')
const DIA = 24 * 60 * 60 * 1000
const AGORA = new Date('2026-10-03T12:00:00Z')
const PRAZOS = { anonimizacaoDias: 30, exclusaoDias: 180 }

// DDD 00 não existe no Brasil: nenhum destes números pertence a alguém.
const NUMEROS = ['5500900000001', '5500900000002', '5500900000003']
const MENSAGEM = 'Promoção secreta só para você — mensagem de teste r55'
const contextoWhatsApp = () => ({
  pedido: { numeros: NUMEROS, mensagem: MENSAGEM, imagemUrl: 'https://midia.invalido/promo.jpg', delayMs: 1500 },
  resultados: {
    [NUMEROS[0]]: { ok: true },
    [NUMEROS[1]]: { ok: false, erro: `falha ao enviar para ${NUMEROS[1]}` },
    [NUMEROS[2]]: { ok: false, incerto: true, erro: 'fetch failed' },
  },
  emEnvio: null,
  origem: 'https://teste.invalido',
  resposta: { status: 200, corpo: { ok: true, enviados: 1, erros: 1, incertos: 1, resultados: NUMEROS.map((numero) => ({ numero })) } },
})
const contextoLegenda = () => ({
  pedido: { conteudoId: 'c', userId: 'u', preset: 'glass', videoUrl: 'https://midia.invalido/v.mp4', srt: '1\n00:00:00,000 --> 00:00:02,000\nTexto da narração r55\n' },
  fal: { statusUrl: 'https://fal.invalido/s', resultUrl: 'https://fal.invalido/r', requestId: 'req-r55' },
  videoUrlFinal: 'https://storage.invalido/legendado.mp4',
  resposta: { status: 200, corpo: { ok: true, videoUrl: 'https://storage.invalido/legendado.mp4' } },
})

// ── 1. Política pura ────────────────────────────────────────────────────

describe('Prazos', () => {
  test('padrão 30 dias para anonimizar e 180 para excluir', () => {
    assert.deepEqual(lerPrazos({}), { anonimizacaoDias: PRAZO_PADRAO_DE_ANONIMIZACAO_DIAS, exclusaoDias: PRAZO_PADRAO_DE_EXCLUSAO_DIAS })
    assert.equal(PRAZO_PADRAO_DE_ANONIMIZACAO_DIAS, 30)
    assert.equal(PRAZO_PADRAO_DE_EXCLUSAO_DIAS, 180)
  })

  test('configurável, com limites; excluir nunca antes de anonimizar', () => {
    assert.deepEqual(lerPrazos({ RETENCAO_TAREFAS_ANONIMIZAR_DIAS: '90', RETENCAO_TAREFAS_EXCLUIR_DIAS: '365' }), { anonimizacaoDias: 90, exclusaoDias: 365 })
    assert.deepEqual(lerPrazos({ RETENCAO_TAREFAS_ANONIMIZAR_DIAS: '90', RETENCAO_TAREFAS_EXCLUIR_DIAS: '60' }), { anonimizacaoDias: 90, exclusaoDias: 90 })
    for (const ruim of ['0', '-5', 'abc', '1.5', '']) assert.equal(lerPrazos({ RETENCAO_TAREFAS_ANONIMIZAR_DIAS: ruim }).anonimizacaoDias, 30, ruim)
  })
})

describe('Decisão por tarefa', () => {
  const t = (over: Partial<TarefaParaRetencao>): TarefaParaRetencao => ({
    id: 'x', workspaceId: 'w', tipo: 'LONGO_ENVIO_WHATSAPP', estado: 'SUCCEEDED',
    updatedAt: new Date(AGORA.getTime() - 40 * DIA), contexto: contextoWhatsApp(), ...over,
  })

  test('WhatsApp e legenda concluídos e parados há mais de 30 dias: anonimizar', () => {
    for (const estado of ['SUCCEEDED', 'FAILED_RETRYABLE', 'WAITING', 'FAILED_FINAL', 'CANCELLED']) {
      assert.equal(decidirRetencao(t({ estado }), AGORA, PRAZOS).acao, 'anonimizar', estado)
    }
    assert.equal(decidirRetencao(t({ tipo: 'LONGO_LEGENDA_VIDEO', contexto: contextoLegenda() }), AGORA, PRAZOS).acao, 'anonimizar')
  })

  test('dentro do prazo, ativo, publicação ou fila genérica: manter', () => {
    assert.equal(decidirRetencao(t({ updatedAt: new Date(AGORA.getTime() - 29 * DIA) }), AGORA, PRAZOS).acao, 'manter')
    for (const estado of ['PENDING', 'RUNNING']) assert.equal(decidirRetencao(t({ estado, updatedAt: new Date(0) }), AGORA, PRAZOS).acao, 'manter', estado)
    assert.equal(decidirRetencao(t({ tipo: 'LONGO_PUBLICAR_INSTAGRAM', updatedAt: new Date(0) }), AGORA, PRAZOS).acao, 'manter')
    assert.equal(decidirRetencao(t({ tipo: 'GERAR_CONTEUDO', updatedAt: new Date(0) }), AGORA, PRAZOS).acao, 'manter')
  })

  test('excluir só o já anonimizado, depois do prazo de exclusão', () => {
    const anon = (dias: number) => ({ anonimizadoEm: new Date(AGORA.getTime() - dias * DIA).toISOString() })
    assert.equal(decidirRetencao(t({ contexto: anon(149), updatedAt: new Date(0) }), AGORA, PRAZOS).acao, 'manter')
    assert.equal(decidirRetencao(t({ contexto: anon(151), updatedAt: new Date(0) }), AGORA, PRAZOS).acao, 'excluir')
  })
})

describe('Anonimização não deixa dado pessoal', () => {
  test('WhatsApp: só contagens', () => {
    const c = contextoAnonimizado('LONGO_ENVIO_WHATSAPP', contextoWhatsApp(), AGORA)
    const texto = JSON.stringify(c)
    for (const n of NUMEROS) assert.ok(!texto.includes(n), `número ${n} sobrou`)
    for (const resto of [MENSAGEM, 'promo.jpg', 'teste.invalido', 'falha ao enviar']) assert.ok(!texto.includes(resto), `${resto} sobrou`)
    assert.deepEqual(c.resumo, { total: 3, enviados: 1, erros: 1, incertos: 1 })
    assert.equal((c.resposta as { corpo: { anonimizado: boolean } }).corpo.anonimizado, true)
  })

  test('legenda: sem texto, sem URL, sem id externo', () => {
    const texto = JSON.stringify(contextoAnonimizado('LONGO_LEGENDA_VIDEO', contextoLegenda(), AGORA))
    for (const resto of ['narração', 'midia.invalido', 'fal.invalido', 'storage.invalido', 'req-r55']) assert.ok(!texto.includes(resto), `${resto} sobrou`)
  })
})

describe('Rotina própria: pode ser ligada sozinha', () => {
  const env = { AGENDADOR_DOS_CRONS: 'netlify', CRON_SECRET: 's', ROTINAS_NETLIFY_LIGADAS: 'expurgar-tarefas' }
  const contexto = { site: { url: 'https://x.test' } }

  test('com a lista, só o expurgo dispara — fila e oportunidades não', async () => {
    const urls: string[] = []
    const enviar = (async (url: string) => { urls.push(url); return new Response('{}') }) as unknown as typeof fetch
    const { dispararRotina } = await import('../netlify/rotina-interna')
    assert.equal((await dispararRotina('expurgar-tarefas', contexto, env, enviar, '?modo=execucao')).disparou, true)
    assert.equal((await dispararRotina('executar-fila', contexto, env, enviar)).disparou, false)
    assert.equal((await dispararRotina('oportunidades', contexto, env, enviar)).disparou, false)
    assert.deepEqual(urls, ['https://x.test/api/cron/expurgar-tarefas?modo=execucao'])
  })

  test('sem a lista, o comportamento de antes (todas com o agendador ligado)', async () => {
    const { dispararRotina } = await import('../netlify/rotina-interna')
    const enviar = (async () => new Response('{}')) as unknown as typeof fetch
    assert.equal((await dispararRotina('executar-fila', contexto, { AGENDADOR_DOS_CRONS: 'netlify', CRON_SECRET: 's' }, enviar)).disparou, true)
  })
})

describe('Rota e agendamento', () => {
  const rota = readFileSync(join(RAIZ, 'app/api/cron/expurgar-tarefas/route.ts'), 'utf8')

  test('ensaio por padrão: execução exige o pedido E o interruptor', () => {
    assert.match(rota, /const modo = pedido === 'execucao' && ativo \? 'execucao' : 'ensaio'/)
    assert.match(rota, /const ativo = process\.env\.EXPURGO_TAREFAS_ATIVO === 'true'/)
    assert.match(rota, /autorizacaoDeRotinaValida\(req\.headers\.get\('authorization'\), secret\)/)
    assert.match(rota, /chamadaDeOutroAgendador\(req\.headers\)/)
  })

  test('Scheduled Function diária e workflow do GitHub, ambos sujeitos ao interruptor', () => {
    const fn = readFileSync(join(RAIZ, 'netlify/functions/rotina-expurgar-tarefas.ts'), 'utf8')
    assert.match(fn, /schedule: '0 4 \* \* \*'/)
    assert.match(fn, /dispararRotina\('expurgar-tarefas'/)
    const wf = readFileSync(join(RAIZ, '.github/workflows/patrono-crons.yml'), 'utf8')
    assert.match(wf, /hora\}" = "04" \]; then chamar "expurgar-tarefas" "\?modo=execucao"/)
  })
})

// ── 2. Banco de teste ───────────────────────────────────────────────────

const TEM_BANCO = !!process.env.DATABASE_URL
const marca = `r55-${Date.now()}`
const criados: string[] = []
let wsA = ''
let wsB = ''
let integracaoA = ''
const ids: Record<string, string> = {}

async function semear(nome: string, ws: string, dados: { tipo: string; estado: string; contexto: object; diasParado: number; chave?: string }) {
  const j = await prisma.automationJob.create({
    data: {
      workspaceId: ws, tipo: dados.tipo, chave: dados.chave ?? `${marca}-${nome}`, estado: dados.estado as never,
      classe: 'TENTANDO', entityType: 'INTEGRACAO', entityId: integracaoA || 'x', contexto: dados.contexto as never,
      ultimoErro: dados.tipo === 'LONGO_ENVIO_WHATSAPP' ? `1 envio sem confirmação (${NUMEROS[2]})` : null,
      workerId: dados.estado === 'PENDING' ? RESERVA_DO_SEGUNDO_PLANO : null,
    },
  })
  // A data de atividade que o teste precisa — direto no banco de teste.
  await prisma.$executeRaw`UPDATE "AutomationJob" SET "updatedAt" = ${new Date(AGORA.getTime() - dados.diasParado * DIA)} WHERE id = ${j.id}`
  ids[nome] = j.id
}

const linha = (nome: string) => prisma.automationJob.findUnique({ where: { id: ids[nome] } })

describe(
  'Retenção contra o banco de teste',
  { skip: !TEM_BANCO ? 'DATABASE_URL ausente — exige Postgres' : false },
  () => {
    before(async () => {
      const refProducao = process.env.PATRONO_REF_DO_BANCO_DE_PRODUCAO
      if (refProducao && (process.env.DATABASE_URL ?? '').includes(refProducao)) throw new Error('Nunca contra o banco de produção.')
      for (const n of ['A', 'B']) {
        const ws = await prisma.workspace.create({ data: { name: `R55-${n}`, ownerId: `${marca}-${n}` }, select: { id: true } })
        criados.push(ws.id)
      }
      ;[wsA, wsB] = criados
      const user = await prisma.user.create({ data: { email: `${marca}@teste.local`, name: 'U', password: 'x', workspaceId: wsA }, select: { id: true } })
      integracaoA = (await prisma.integracao.create({ data: { workspaceId: wsA, userId: user.id, plataforma: 'whatsapp', status: 'conectado', accessToken: 'FICTICIO', accountId: 'FICTICIO' }, select: { id: true } })).id

      await semear('waVelho', wsA, { tipo: 'LONGO_ENVIO_WHATSAPP', estado: 'SUCCEEDED', contexto: contextoWhatsApp(), diasParado: 40 })
      await semear('waIncerto', wsA, { tipo: 'LONGO_ENVIO_WHATSAPP', estado: 'WAITING', contexto: contextoWhatsApp(), diasParado: 45 })
      await semear('waRecente', wsA, { tipo: 'LONGO_ENVIO_WHATSAPP', estado: 'SUCCEEDED', contexto: contextoWhatsApp(), diasParado: 5 })
      await semear('waAtivo', wsA, { tipo: 'LONGO_ENVIO_WHATSAPP', estado: 'PENDING', contexto: contextoWhatsApp(), diasParado: 400 })
      await semear('legVelha', wsA, { tipo: 'LONGO_LEGENDA_VIDEO', estado: 'SUCCEEDED', contexto: contextoLegenda(), diasParado: 60 })
      await semear('pubVelha', wsA, { tipo: 'LONGO_PUBLICAR_INSTAGRAM', estado: 'SUCCEEDED', contexto: { pedido: { conteudoId: 'c' }, mediaId: 'm' }, diasParado: 400 })
      await semear('anonAntigo', wsA, { tipo: 'LONGO_ENVIO_WHATSAPP', estado: 'SUCCEEDED', contexto: { anonimizadoEm: new Date(AGORA.getTime() - 200 * DIA).toISOString(), resumo: {} }, diasParado: 200 })
      await semear('waVelhoB', wsB, { tipo: 'LONGO_ENVIO_WHATSAPP', estado: 'SUCCEEDED', contexto: contextoWhatsApp(), diasParado: 40 })
    })

    after(async () => {
      for (const ws of criados) {
        await prisma.automationJob.deleteMany({ where: { workspaceId: ws } })
        await prisma.integracao.deleteMany({ where: { workspaceId: ws } })
        await prisma.user.deleteMany({ where: { workspaceId: ws } })
      }
      await prisma.workspace.deleteMany({ where: { id: { in: criados } } })
      await prisma.$disconnect()
    })

    test('ensaio relata e NÃO escreve nada', async () => {
      const antes = await prisma.automationJob.findMany({ where: { workspaceId: wsA }, orderBy: { id: 'asc' } })
      const r = await executarRetencao({ porta: portaDeRetencaoPrisma(), agora: AGORA, prazos: PRAZOS, modo: 'ensaio', workspaceId: wsA })
      const a = r.workspaces[0]
      assert.equal(r.modo, 'ensaio')
      assert.equal(a.anonimizar, 3, 'waVelho, waIncerto, legVelha')
      assert.equal(a.excluir, 1, 'anonAntigo')
      assert.equal(a.aplicadas, 0)
      assert.ok(!JSON.stringify(r).includes(NUMEROS[0]), 'o relatório não pode conter número')
      const depois = await prisma.automationJob.findMany({ where: { workspaceId: wsA }, orderBy: { id: 'asc' } })
      assert.deepEqual(depois, antes)
    })

    test('execução num workspace: anonimiza, exclui, preserva — e não toca o outro', async () => {
      const r = await executarRetencao({ porta: portaDeRetencaoPrisma(), agora: AGORA, prazos: PRAZOS, modo: 'execucao', workspaceId: wsA })
      assert.equal(r.workspaces[0].aplicadas, 4)

      for (const nome of ['waVelho', 'waIncerto']) {
        const j = await linha(nome)
        const texto = JSON.stringify(j)
        for (const n of NUMEROS) assert.ok(!texto.includes(n), `${nome}: número ${n} sobrou na linha`)
        assert.ok(!texto.includes(MENSAGEM))
        assert.equal(j?.ultimoErro, null)
        assert.equal(j?.chave, `${marca}-${nome}`, 'a chave fica — é a trava anti-duplicidade')
      }
      assert.ok(!JSON.stringify(await linha('legVelha')).includes('narração'))
      assert.equal(await linha('anonAntigo'), null, 'excluída')

      // Preservados.
      assert.ok(JSON.stringify(await linha('waRecente')).includes(NUMEROS[0]), 'recente fica intacto')
      assert.ok(JSON.stringify(await linha('waAtivo')).includes(NUMEROS[0]), 'ativo fica intacto')
      assert.equal(((await linha('pubVelha'))?.contexto as { mediaId: string }).mediaId, 'm', 'publicação fica intacta')
      assert.ok(JSON.stringify(await linha('waVelhoB')).includes(NUMEROS[0]), 'outro workspace não é tocado')
    })

    test('repetir não muda nada (idempotência)', async () => {
      const r = await executarRetencao({ porta: portaDeRetencaoPrisma(), agora: AGORA, prazos: PRAZOS, modo: 'execucao', workspaceId: wsA })
      assert.equal(r.workspaces[0].aplicadas, 0)
      assert.equal(r.workspaces[0].anonimizar + r.workspaces[0].excluir, 0)
    })

    test('corrida: linha alterada depois da leitura não é sobrescrita', async () => {
      const porta = portaDeRetencaoPrisma()
      const [t] = (await porta.listar(wsB, 10)).filter((x) => x.id === ids.waVelhoB)
      await prisma.$executeRaw`UPDATE "AutomationJob" SET "updatedAt" = now() WHERE id = ${t.id}`
      assert.equal(await porta.anonimizar(t, { anonimizadoEm: AGORA.toISOString() }), false)
      assert.equal(await porta.excluir(t), false)
      assert.ok(JSON.stringify(await linha('waVelhoB')).includes(NUMEROS[0]))
    })

    test('depois de anonimizar, o MESMO pedido não reenvia', async () => {
      let execucoes = 0
      const r = await iniciarTrabalhoLongo({
        workspaceId: wsA, tipo: 'LONGO_ENVIO_WHATSAPP', chave: `${marca}-waVelho`, entityType: 'INTEGRACAO', entityId: integracaoA,
        contexto: { pedido: { numeros: NUMEROS, mensagem: MENSAGEM, delayMs: 1500 } },
        executor: async () => { execucoes++; return { fim: 'concluido', resposta: { status: 200, corpo: {} } } },
        origem: 'https://teste.invalido', mensagemDeProcessando: 'x', modo: 'na-requisicao',
      })
      assert.equal(execucoes, 0, 'reenvio depois da anonimização')
      assert.equal(r.resposta.corpo.anonimizado, true)
      assert.ok(!JSON.stringify(await linha('waVelho')).includes(NUMEROS[0]), 'o pedido repetido não regravou os números')
    })
  }
)
