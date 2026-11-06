/**
 * P2.15 (Fase 1) — Supervisor operacional, "Precisa de você", Command Center
 * e Copilot determinístico.
 *
 * Puro: diagnóstico, frases do ledger, saúde, próxima ação, interpretador.
 * Banco de TESTE: ciclo em MANUAL (pede aprovação), em AUTOMATIC (escolhe
 * sozinho, ator PATRONO), regra "sempre aprovar", exceção idempotente,
 * limpeza da fila, kill switch, Copilot executando comandos, painel.
 * Nunca publica, nunca gasta. Limpa tudo o que cria. Custo R$ 0,00.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { diagnosticar } from '../lib/supervisor/ciclo'
import { frasesDoEvento, saudeDasIntegracoes, proximaMelhorAcao, inicioDoDiaEmBrasilia } from '../lib/central'
import { interpretadorDeterministico as I } from '../lib/copilot'
import { rotulos } from '../lib/precisa-de-voce'

const AGORA = new Date('2026-10-10T15:00:00Z')
const DIA = 86_400_000

describe('Fase 1 — partes puras', () => {
  test('diagnóstico: só o que exige a titular vira exceção', () => {
    const ex = diagnosticar({
      agora: AGORA,
      integracoes: [
        { plataforma: 'instagram', status: 'conectado', tokenExpiry: new Date(AGORA.getTime() + 5 * DIA) },
        { plataforma: 'hotmart', status: 'conectado', tokenExpiry: new Date(AGORA.getTime() - DIA) },
        { plataforma: 'shopee', status: 'conectado', tokenExpiry: null },
        { plataforma: 'tiktok', status: 'desconectado', tokenExpiry: new Date(AGORA.getTime() - DIA) },
        { plataforma: 'amazon', status: 'conectado', tokenExpiry: new Date(AGORA.getTime() + 40 * DIA) },
      ],
      produtosAtivos: 0,
      informadosAbertos: 0,
      tiktokShopPendente: true,
    })
    assert.equal(ex.pop()!.chave, 'estrategia:tiktok-shop-descoberta')
    assert.deepEqual(ex.map((e) => [e.chave.split(':')[1], e.risco]), [['token-expirando', 'MEDIO'], ['token-expirado', 'ALTO'], ['catalogo-vazio', 'MEDIO']])
    assert.equal(diagnosticar({ agora: AGORA, integracoes: [], produtosAtivos: 3, informadosAbertos: 0 }).length, 0)
  })

  test('ledger em linguagem simples; ruído técnico some', () => {
    assert.match(frasesDoEvento({ tipo: 'CANDIDATES_PRESENTED', payload: { avaliados: 22, chaves: ['a', 'b', 'c'] } })!, /Analisei 22 produtos e selecionei 3 oportunidades/)
    assert.equal(frasesDoEvento({ tipo: 'RUN_STATE_CHANGED', payload: { para: 'VALIDANDO' } }), null)
    assert.match(frasesDoEvento({ tipo: 'RUN_STATE_CHANGED', payload: { para: 'CONCLUIDO' } })!, /Concluí/)
    assert.equal(frasesDoEvento({ tipo: 'QUALQUER', payload: {} }), null)
  })

  test('saúde das integrações e próxima melhor ação (uma só, por prioridade)', () => {
    const s = saudeDasIntegracoes([
      { plataforma: 'instagram', status: 'conectado', tokenExpiry: new Date(AGORA.getTime() + 51 * DIA) },
      { plataforma: 'x', status: 'conectado', tokenExpiry: new Date(AGORA.getTime() + 3 * DIA) },
      { plataforma: 'y', status: 'desconectado', tokenExpiry: null },
    ], AGORA)
    assert.deepEqual(s.map((i) => i.estado), ['OK', 'ATENCAO', 'DESCONECTADA'])
    assert.equal(proximaMelhorAcao({ pendencias: 2, bloqueado: false, ultimoCicloHa: 1, integracoesComProblema: 1 }).link, '/precisa-de-voce')
    assert.equal(proximaMelhorAcao({ pendencias: 0, bloqueado: false, ultimoCicloHa: 1, integracoesComProblema: 1 }).link, '/integracoes')
    assert.equal(proximaMelhorAcao({ pendencias: 0, bloqueado: false, ultimoCicloHa: null, integracoesComProblema: 0 }).comando, 'rodar')
    assert.match(proximaMelhorAcao({ pendencias: 0, bloqueado: false, ultimoCicloHa: 60_000, integracoesComProblema: 0 }).texto, /em dia/)
  })

  test('início do dia em Brasília', () => {
    assert.equal(inicioDoDiaEmBrasilia(new Date('2026-10-10T02:30:00Z')).toISOString(), '2026-10-09T03:00:00.000Z')
    assert.equal(inicioDoDiaEmBrasilia(new Date('2026-10-10T15:00:00Z')).toISOString(), '2026-10-10T03:00:00.000Z')
  })

  test('Copilot entende português (acentos, sinônimos, números)', () => {
    const casos: Array<[string, string]> = [
      ['Como está a operação?', 'STATUS'], ['o que você está fazendo', 'STATUS'],
      ['O que precisa de mim?', 'PENDENCIAS'], ['tem pendência?', 'PENDENCIAS'],
      ['O que você fez hoje?', 'HOJE'], ['Por que este produto?', 'PORQUE'], ['explica a boneca', 'PORQUE'],
      ['Rodar agora', 'RODAR'], ['atualizar candidatos', 'RODAR'], ['aprovar 1', 'DECIDIR'], ['rejeitar 2', 'DECIDIR'],
      ['pausar tudo', 'PAUSAR'], ['retomar', 'RETOMAR'], ['instagram ok?', 'INTEGRACOES'], ['quanto de comissão?', 'RESULTADO'],
      ['ajuda', 'AJUDA'], ['', 'AJUDA'], ['qual a capital da frança', 'DESCONHECIDO'],
    ]
    for (const [t, esperado] of casos) assert.equal(I.interpretar(t).tipo, esperado, t)
    assert.deepEqual(I.interpretar('rejeitar 2'), { tipo: 'DECIDIR', decisao: 'REJEITAR', numero: 2 })
    assert.deepEqual(I.interpretar('explica a boneca'), { tipo: 'PORQUE', alvo: 'boneca' })
    assert.deepEqual(rotulos('EXCECAO'), { aprovar: 'Já resolvi', rejeitar: 'Ignorar' })
  })
})

const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')

describe('Fase 1 contra o banco de teste', { skip: !TEM_BANCO ? 'exige banco de TESTE' : false }, () => {
  let prisma: typeof import('../lib/prisma').prisma
  let C: typeof import('../lib/supervisor/ciclo')
  let PV: typeof import('../lib/precisa-de-voce')
  let CO: typeof import('../lib/copilot')
  let CE: typeof import('../lib/central')
  let P: typeof import('../lib/politica')
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  const PREFIXO = 'Conta de Teste — '
  const marca = `r67-${Date.now()}`
  const ws: Record<'MANUAL' | 'AUTO' | 'COP', string> = { MANUAL: '', AUTO: '', COP: '' }
  const usr: Record<string, string> = {}

  async function criar(n: keyof typeof ws, produtos = 6) {
    const w = (await prisma.workspace.create({ data: { name: `${PREFIXO}Fase 1 ${n}`, ownerId: `${marca}-${n}` }, select: { id: true } })).id
    usr[w] = (await prisma.user.create({ data: { email: `${marca}-${n}@teste.local`, name: 'U', password: 'x', workspaceId: w }, select: { id: true } })).id
    await prisma.produto.createMany({
      data: Array.from({ length: produtos }, (_, i) => ({
        workspaceId: w, userId: usr[w], nome: `${marca} organizador ${i}`, categoria: 'Casa e Decoração', preco: 40 + i * 20,
        tipoVenda: 'Afiliado', origemConteudo: 'De fornecedor', imagens: [], linkProduto: `https://loja.invalido/${marca}/${n}/${i}`,
      })),
    })
    return w
  }

  before(async () => {
    ;[{ prisma }, C, PV, CO, CE, P, { limparWorkspaceDeTeste: limpar }] = await Promise.all([
      import('../lib/prisma'), import('../lib/supervisor/ciclo'), import('../lib/precisa-de-voce'), import('../lib/copilot'),
      import('../lib/central'), import('../lib/politica'), import('./_limpar-workspace-de-teste'),
    ])
    ws.MANUAL = await criar('MANUAL')
    ws.AUTO = await criar('AUTO')
    ws.COP = await criar('COP')
  })

  after(async () => {
    if (prisma) for (const w of Object.values(ws)) await limpar(prisma, w, PREFIXO)
    await prisma?.$disconnect()
  })

  test('MANUAL: o ciclo descobre, ranqueia e pede UMA aprovação clara; nada é escolhido sozinho', async () => {
    const w = ws.MANUAL
    const r = await C.executarCiclo({ workspaceId: w, userId: usr[w], env: {} })
    assert.equal(r.estadoFinal, 'CONCLUIDO')
    assert.equal(r.escolhaAutomatica, null)
    assert.ok(r.pedidoDeAprovacao, 'deve pedir aprovação')
    const run = await prisma.supervisorRun.findUniqueOrThrow({ where: { id: r.runId! } })
    assert.equal(run.estado, 'CONCLUIDO')
    // Tudo do ciclo amarrado pelo mesmo correlationId/runId.
    const dec = await prisma.decisionRecord.findFirstOrThrow({ where: { workspaceId: w, tipo: 'CURADORIA_APRESENTACAO' } })
    assert.equal(dec.correlationId, run.correlationId)
    assert.equal(dec.runId, run.id)
    assert.equal(await prisma.domainEvent.count({ where: { workspaceId: w, tipo: 'RUN_STATE_CHANGED', runId: run.id } }), 5)
    // Rodar de novo com o mesmo melhor produto não duplica o pedido.
    await C.executarCiclo({ workspaceId: w, userId: usr[w], env: {} })
    assert.equal(await prisma.approvalRequest.count({ where: { workspaceId: w, tipo: 'ESCOLHER_PRODUTO', status: 'PENDENTE' } }), 1)
    assert.equal(await prisma.publicacao.count({ where: { workspaceId: w } }), 0, 'Fase 1 nunca publica')
    assert.equal(await prisma.costLedger.count({ where: { workspaceId: w } }), 0, 'nunca gasta')
  })

  test('"Precisa de você": aprovar executa a escolha; "sempre" vira regra que resolve o próximo caso sozinho', async () => {
    const w = ws.MANUAL
    const item = (await PV.listarPrecisaDeVoce(w)).find((i) => i.tipo === 'ESCOLHER_PRODUTO')!
    assert.ok(item, 'deve haver um pedido de escolha')
    assert.equal(item.acoes.aprovar, 'Escolher este produto')
    const res = await PV.decidirPrecisaDeVoce({ workspaceId: w, userId: usr[w], id: item.id, decisao: 'APROVAR', sempre: true })
    assert.equal(res.status, 'APROVADA')
    assert.equal(res.regraCriada, true)
    assert.equal(await prisma.candidatoDeProduto.count({ where: { workspaceId: w, status: { in: ['ESCOLHIDO', 'CADASTRADO'] } } }), 1)
    assert.equal((await PV.listarPrecisaDeVoce(w)).filter((i) => i.tipo === 'ESCOLHER_PRODUTO').length, 0)
    // Próximo ciclo: produto parecido (mesma categoria, preço ≤ regra, risco ≤) → o Patrono escolhe sozinho.
    const r2 = await C.executarCiclo({ workspaceId: w, userId: usr[w], env: {} })
    if (r2.escolhaAutomatica) {
      const d = await prisma.decisionRecord.findFirstOrThrow({ where: { workspaceId: w, tipo: 'ESCOLHA_DE_PRODUTO', entidadeId: r2.escolhaAutomatica.candidatoId } })
      assert.equal(d.ator, 'PATRONO')
      assert.equal(d.atorUserId, null)
      assert.match(d.regra ?? '', /ApprovalRule:/)
    } else {
      // Se o novo melhor ficou fora da regra (preço maior), ele pede — e a regra continua valendo.
      assert.ok(r2.pedidoDeAprovacao)
    }
  })

  test('AUTOMATIC: a política permite e o Patrono escolhe sozinho, registrado como PATRONO', async () => {
    const w = ws.AUTO
    await P.publicarPolitica({ workspaceId: w, regras: { ...P.POLITICA_PADRAO, autonomia: { padrao: 'AUTOMATIC', porCanal: {} }, limites: { ...P.POLITICA_PADRAO.limites, riscoMaximoSemAprovacao: 'MEDIO' } }, ator: 'TITULAR', userId: usr[w] })
    const r = await C.executarCiclo({ workspaceId: w, userId: usr[w], env: {} })
    assert.ok(r.escolhaAutomatica, JSON.stringify(r.resumo))
    assert.equal(r.pedidoDeAprovacao, null)
    const d = await prisma.decisionRecord.findFirstOrThrow({ where: { workspaceId: w, tipo: 'ESCOLHA_DE_PRODUTO' } })
    assert.equal(d.ator, 'PATRONO')
    assert.match(d.regra ?? '', /^politica:v1$/)
    assert.equal(await prisma.approvalRequest.count({ where: { workspaceId: w, tipo: 'ESCOLHER_PRODUTO' } }), 0)
  })

  test('exceção de integração: uma só, idempotente entre ciclos; "já resolvi" a tira da fila', async () => {
    const w = ws.AUTO
    await prisma.integracao.create({ data: { workspaceId: w, userId: usr[w], plataforma: 'instagram', status: 'conectado', tokenExpiry: new Date(Date.now() + 5 * DIA) } })
    await C.executarCiclo({ workspaceId: w, userId: usr[w], env: {} })
    await C.executarCiclo({ workspaceId: w, userId: usr[w], env: {} })
    const exc = (await PV.listarPrecisaDeVoce(w)).filter((i) => i.tipo === 'EXCECAO' && /Instagram/.test(i.titulo))
    assert.equal(exc.length, 1)
    assert.match(exc[0].titulo, /Renovar o acesso ao Instagram/)
    assert.equal(exc[0].link, '/integracoes')
    await PV.decidirPrecisaDeVoce({ workspaceId: w, userId: usr[w], id: exc[0].id, decisao: 'APROVAR' })
    assert.equal((await PV.listarPrecisaDeVoce(w)).filter((i) => /Instagram/.test(i.titulo)).length, 0)
  })

  // P2.18.3: até a data-base de elegibilidade o onboarding é impossível e o item nem nasce (rodada96).
  // A regra de evidência continua valendo DEPOIS da data — é o que este teste trava.
  test('P2.15.3 TikTok Shop (após a elegibilidade): nenhum clique tira o item; só a evidência real, registrada no ledger', async () => {
    const w = ws.AUTO
    const { dataDeElegibilidade } = await import('../lib/elegibilidade-tiktok-shop')
    const DEPOIS = new Date(`${dataDeElegibilidade()}T12:00:00-03:00`)
    const ctx = { workspaceId: w, userId: usr[w], agora: DEPOIS }
    const lista = async () => (await PV.listarPrecisaDeVoce(w, DEPOIS)).filter((i) => /TikTok Shop/.test(i.titulo))
    await C.executarCiclo({ workspaceId: w, userId: usr[w], env: {}, agora: new Date(DEPOIS.getTime() + 1 * 60_000) })
    const [tk] = await lista()
    assert.ok(tk)
    assert.equal(tk.risco, 'BAIXO')
    assert.deepEqual(tk.acoes, { aprovar: 'Ver como fazer', rejeitar: 'Agora não' })
    assert.equal(tk.podeMarcarResolvido, false)
    assert.ok((tk.comoFazer ?? []).length >= 4)
    // botão/API: aprovar é recusado; "Agora não" não muda nada
    await assert.rejects(PV.decidirPrecisaDeVoce({ workspaceId: w, userId: usr[w], id: tk.id, decisao: 'APROVAR', agora: DEPOIS }), /só sai sozinho/)
    const agoraNao = await PV.decidirPrecisaDeVoce({ workspaceId: w, userId: usr[w], id: tk.id, decisao: 'REJEITAR', agora: DEPOIS })
    assert.equal(agoraNao.status, 'PENDENTE')
    // Copilot: "aprovar N" e "rejeitar N" também não tiram
    const n = (await PV.listarPrecisaDeVoce(w, DEPOIS)).findIndex((i) => i.id === tk.id) + 1
    assert.match((await CO.perguntarAoCopilot(`aprovar ${n}`, ctx)).texto[0], /Nada foi alterado/)
    assert.equal((await CO.perguntarAoCopilot(`rejeitar ${n}`, ctx)).alterou, false)
    await C.executarCiclo({ workspaceId: w, userId: usr[w], env: {}, agora: new Date(DEPOIS.getTime() + 2 * 60_000) })
    assert.equal((await lista()).length, 1)
    assert.equal((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: tk.id } })).status, 'PENDENTE')
    // conexão VENCIDA não é evidência
    await prisma.integracao.create({ data: { workspaceId: w, userId: usr[w], plataforma: 'tiktok-shop', status: 'conectado', accessToken: 'fixture-de-teste', tokenExpiry: new Date(Date.now() - DIA) } })
    assert.equal((await lista()).length, 1)
    // conexão válida (fixture do workspace descartável de teste) = evidência → sai sozinho, com ledger
    await prisma.integracao.updateMany({ where: { workspaceId: w, plataforma: 'tiktok-shop' }, data: { tokenExpiry: new Date(DEPOIS.getTime() + 30 * DIA) } })
    assert.equal((await lista()).length, 0)
    await PV.listarPrecisaDeVoce(w, DEPOIS) // idempotente
    const pedido = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: tk.id } })
    assert.equal(pedido.status, 'APROVADA')
    assert.equal(pedido.decididoPorUserId, null)
    assert.match(pedido.motivoDaDecisao ?? '', /Resolvido por evidência/)
    const decs = await prisma.decisionRecord.findMany({ where: { workspaceId: w, tipo: 'RESOLUCAO_POR_EVIDENCIA' } })
    assert.equal(decs.length, 1)
    assert.equal(decs[0].ator, 'SISTEMA')
    const evs = await prisma.domainEvent.findMany({ where: { workspaceId: w, chaveIdempotencia: 'evidencia:estrategia:tiktok-shop-descoberta' } })
    assert.equal(evs.length, 1)
    assert.equal((evs[0].payload as { resolvidoPor?: string }).resolvidoPor, 'EVIDENCIA')
    // o Supervisor não recria o item
    await C.executarCiclo({ workspaceId: w, userId: usr[w], env: {}, agora: new Date(DEPOIS.getTime() + 3 * 60_000) })
    assert.equal((await lista()).length, 0)
  })

  test('a fila se limpa sozinha: escolha feita em Oportunidades cancela o pedido pendente', async () => {
    const w = ws.COP
    const r = await C.executarCiclo({ workspaceId: w, userId: usr[w], env: {} })
    assert.ok(r.pedidoDeAprovacao)
    const pedido = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: r.pedidoDeAprovacao.id } })
    const { escolherCandidato } = await import('../lib/curadoria')
    await escolherCandidato({ workspaceId: w, userId: usr[w], candidatoId: (pedido.acaoProposta as { candidatoId: string }).candidatoId })
    assert.equal((await PV.listarPrecisaDeVoce(w)).filter((i) => i.tipo === 'ESCOLHER_PRODUTO').length, 0)
    assert.equal((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: pedido.id } })).status, 'CANCELADA')
  })

  test('kill switch global: o ciclo não roda e nada é criado', async () => {
    const w = ws.COP
    const antes = await prisma.supervisorRun.count({ where: { workspaceId: w } })
    const r = await C.executarCiclo({ workspaceId: w, userId: usr[w], env: { PATRONO_AUTOPILOT_DESLIGADO: 'true' } })
    assert.equal(r.estadoFinal, 'CANCELADO')
    assert.equal(await prisma.supervisorRun.count({ where: { workspaceId: w } }), antes)
  })

  test('P2.15.2: aprovar pela fila = escolha da TITULAR, mesmo correlationId, sem regra e sem duplicata', async () => {
    const w = ws.COP
    const r = await C.executarCiclo({ workspaceId: w, userId: usr[w], env: {} })
    assert.ok(r.pedidoDeAprovacao, JSON.stringify(r.resumo))
    const regrasAntes = await prisma.approvalRule.count({ where: { workspaceId: w } })
    const pedido = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: r.pedidoDeAprovacao.id } })
    const candidatoId = (pedido.acaoProposta as { candidatoId: string }).candidatoId
    const res = await PV.decidirPrecisaDeVoce({ workspaceId: w, userId: usr[w], id: pedido.id, decisao: 'APROVAR' })
    assert.equal(res.status, 'APROVADA')
    assert.equal(res.regraCriada, false)
    assert.equal((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: pedido.id } })).status, 'APROVADA')
    assert.equal((await prisma.candidatoDeProduto.findUniqueOrThrow({ where: { id: candidatoId } })).status, 'ESCOLHIDO')
    const aprov = await prisma.decisionRecord.findFirstOrThrow({ where: { workspaceId: w, tipo: 'APROVACAO', entidadeId: pedido.id } })
    const escolha = await prisma.decisionRecord.findFirstOrThrow({ where: { workspaceId: w, tipo: 'ESCOLHA_DE_PRODUTO', entidadeId: candidatoId } })
    assert.deepEqual([aprov.ator, escolha.ator], ['TITULAR', 'TITULAR'])
    assert.ok(aprov.correlationId?.startsWith('decisao_'))
    assert.equal(escolha.correlationId, aprov.correlationId)
    const eventos = await prisma.domainEvent.findMany({ where: { workspaceId: w, correlationId: aprov.correlationId } })
    assert.deepEqual(eventos.map((e) => e.tipo).sort(), ['APPROVAL_GRANTED', 'PRODUCT_SELECTED'])
    assert.equal(await prisma.approvalRule.count({ where: { workspaceId: w } }), regrasAntes)
    await assert.rejects(PV.decidirPrecisaDeVoce({ workspaceId: w, userId: usr[w], id: pedido.id, decisao: 'APROVAR' }), /já está APROVADA/)
    assert.equal(await prisma.decisionRecord.count({ where: { workspaceId: w, tipo: 'ESCOLHA_DE_PRODUTO', entidadeId: candidatoId } }), 1)
  })

  test('Copilot executa pelos mesmos motores: status, pendências, rodar, aprovar, pausar/retomar, porquê', async () => {
    const w = ws.COP
    const ctx = { workspaceId: w, userId: usr[w] }
    const rodar = await CO.perguntarAoCopilot('rodar agora', ctx)
    assert.equal(rodar.comando, 'RODAR')
    assert.equal(rodar.alterou, true)
    const pend = await CO.perguntarAoCopilot('o que precisa de mim?', ctx)
    assert.equal(pend.comando, 'PENDENCIAS')
    const linhas = pend.texto
    const n = linhas.findIndex((l) => /^\d+\. Escolher/.test(l))
    assert.ok(n > 0, linhas.join(' | '))
    const aprovar = await CO.perguntarAoCopilot(`aprovar ${n}`, ctx)
    assert.match(aprovar.texto[0], /aprovado/)
    assert.match((await CO.perguntarAoCopilot('aprovar 9', ctx)).texto[0], /Não há o item 9/)
    assert.match((await CO.perguntarAoCopilot('por que este produto?', ctx)).texto[0], /º lugar|única oportunidade/)
    const pausar = await CO.perguntarAoCopilot('pausar tudo', ctx)
    assert.equal(pausar.alterou, true)
    assert.equal((await prisma.workspace.findUniqueOrThrow({ where: { id: w } })).safeModeAtivo, true)
    assert.match((await CO.perguntarAoCopilot('como está?', ctx)).texto[0], /modo de segurança/)
    await CO.perguntarAoCopilot('retomar', ctx)
    assert.equal((await prisma.workspace.findUniqueOrThrow({ where: { id: w } })).safeModeAtivo, false)
    const desconhecido = await CO.perguntarAoCopilot('qual a capital da frança', ctx)
    assert.equal(desconhecido.comando, 'DESCONHECIDO')
    assert.ok(desconhecido.sugestoes.length > 0)
  })

  test('Command Center agrega a operação numa leitura', async () => {
    const p = await CE.painelCentral(ws.COP)
    assert.ok(p.patrono.ultimoCiclo)
    assert.equal(p.patrono.ultimoCiclo.estado, 'CONCLUIDO')
    assert.ok(p.atividadeHoje.length > 0)
    assert.ok(p.decisoesRecentes.length > 0)
    assert.ok(['MANUAL', 'ASSISTED', 'AUTOMATIC'].includes(p.patrono.modo))
    assert.ok(p.proximaAcao.texto.length > 0)
    // P2.15.1: o topo, o card de integrações e a fila vêm prontos para a tela.
    assert.ok(p.patrono.estado.titulo.startsWith('Patrono'))
    assert.equal(p.resumoIntegracoes.total >= 7, true)
    assert.equal(p.precisaDeVoce.total, p.pendencias)
    assert.ok(p.decisoesRecentes.length <= 4)
    assert.ok(p.decisoesRecentes.every((d) => !/candidato\(s\)/.test(d.texto)), JSON.stringify(p.decisoesRecentes))
  })
})
