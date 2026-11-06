/**
 * P2.22 — SampleOpportunityScore, eventos novos (SAMPLE_DELIVERED, COMMISSION_CONFIRMED/REVERSED), processador
 * genérico (idempotência, concorrência, queda/retomada, retry, falha permanente, fora de ordem, anti-loop, corte)
 * e reações internas. Os 20 cenários obrigatórios estão numerados no nome dos testes.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { avaliarOportunidadeDeAmostra, tendenciaDasVendas, PESOS, type EntradaDaAmostra } from '../lib/oportunidade-de-amostra'
// P2.69: este arquivo testa eventos (não a liberação). O registro manual do link passou a exigir a liberação completa
// (três controles + barreira + sha256); como os demais testes anteriores a essa regra, usa a dispensa de teste legado
// (recusada em Production).
process.env.PATRONO_TESTE_LEGADO_SEM_TRES_CONTROLES = 'true'

const AGORA = new Date('2026-10-16T12:00:00-03:00')
const DIA = 86_400_000
const recente = new Date(AGORA.getTime() - DIA)
const m = <T>(valor: T | null, fonte = 'Visto no app', em: Date | null = recente, vencido = false) => ({ valor, fonte, em, vencido })
const base = (x: Partial<EntradaDaAmostra> = {}): EntradaDaAmostra => ({
  agora: AGORA, emMaos: false, tiktokShop: true, complianceBloqueante: false, nome: 'Organizador', categoria: 'Casa e Decoração',
  comissaoValor: m(12), comissaoPercentual: m(15), preco: m(79.9), vendas: m(2500),
  serieDeVendas: [{ em: new Date(AGORA.getTime() - 10 * DIA), vendas: 1000 }, { em: new Date(AGORA.getTime() - 5 * DIA), vendas: 1500 }, { em: recente, vendas: 2500 }],
  tipoDeAmostra: m<'GRATIS' | 'REEMBOLSAVEL' | 'NENHUMA'>('GRATIS'), disponivel: m(true, 'Fonte oficial'), medianaDaCategoria: 6, comissaoLiquidadaHistorica: null,
  categoriasDaAudiencia: ['Casa e Decoração'], historicoDaLoja: null, aderenciaDeCampanha: { nome: 'Natal 2026', aderencia: 70, fim: new Date('2026-12-26T03:00:00Z') },
  metasDeAmostra: [], prazoDeConteudoDias: null, facilidadeDeVideo: 85, formatosPossiveis: 12, formatosSemUsoReal: 9, semelhantes: null, ...x,
})
const ruim = (x: Partial<EntradaDaAmostra> = {}) => base({
  comissaoValor: m(1.2), vendas: m(3), preco: m(9.9), serieDeVendas: [], categoriasDaAudiencia: ['Beleza'], aderenciaDeCampanha: null,
  facilidadeDeVideo: 35, formatosPossiveis: 3, formatosSemUsoReal: 0, tipoDeAmostra: m<'GRATIS' | 'REEMBOLSAVEL' | 'NENHUMA'>('REEMBOLSAVEL'), ...x,
})

describe('P2.22 — SampleOpportunityScore (puro)', () => {
  test('1. produto em mãos: NÃO PEDIR — segue para o conteúdo', () => {
    const a = avaliarOportunidadeDeAmostra(base({ emMaos: true }))
    assert.equal(a.decisao, 'NAO_PEDIR'); assert.match(a.motivoFinal, /já tem o produto.*conteúdo/)
  })
  test('2. produto bom → PEDIR, com fatores visíveis, pesos, dados usados, ausentes, motivos e riscos', () => {
    const a = avaliarOportunidadeDeAmostra(base())
    assert.equal(a.decisao, 'PEDIR'); assert.ok(a.nota! > 35); assert.notEqual(a.confianca, 'BAIXA')
    const com = a.fatores.find((f) => f.fator === 'comissao')!
    assert.deepEqual([com.situacao, com.peso, com.efeito, com.contribuicao], ['USADO', PESOS.comissao, 2, 6]); assert.match(com.explicacao, /acima da média da categoria/)
    assert.ok(a.motivos.some((x) => /amostra grátis/.test(x)) && a.motivos.some((x) => /aceleração/.test(x)) && a.motivos.some((x) => /fácil de demonstrar/.test(x)))
    assert.ok(a.ausentes.includes('Comissão liquidada deste produto') && a.ausentes.includes('Produtos semelhantes'), 'ausente fica UNKNOWN, não 0')
    assert.equal(a.fatores.find((f) => f.fator === 'semelhantes')!.valor, 'UNKNOWN')
    assert.ok(a.riscos.some((r) => /Prazo de publicação exigido/.test(r)))
    assert.deepEqual(tendenciaDasVendas(base().serieDeVendas), { tendencia: 'SUBINDO', aceleracao: 'ACELERANDO' })
  })
  test('3. produto ruim (comissão baixa, sem demanda, conteúdo difícil) → NÃO PEDIR', () => {
    const a = avaliarOportunidadeDeAmostra(ruim())
    assert.equal(a.decisao, 'NAO_PEDIR'); assert.ok(a.riscos.some((r) => /comissão baixa/.test(r)) && a.riscos.some((r) => /sem demanda/.test(r)))
  })
  test('4. dado comercial vencido não gera decisão forte: comissão vencida → NÃO PRIORITÁRIO até revalidar; sem dado nenhum → NÃO PRIORITÁRIO', () => {
    const velho = new Date(AGORA.getTime() - 20 * DIA)
    const a = avaliarOportunidadeDeAmostra(base({ comissaoValor: m(12, 'Visto no app', velho), vendas: m(2500, 'Visto no app', velho) }))
    assert.equal(a.decisao, 'NAO_PRIORITARIO'); assert.match(a.motivoFinal, /desatualizada.*revalide/i); assert.equal(a.confianca, 'BAIXA')
    assert.ok(a.vencidos.includes('Comissão atual'))
    const vazio = avaliarOportunidadeDeAmostra(base({ comissaoValor: m(null), comissaoPercentual: m(null), preco: m(null), vendas: m(null), serieDeVendas: [], tipoDeAmostra: m(null), categoriasDaAudiencia: null, aderenciaDeCampanha: null, facilidadeDeVideo: null, formatosPossiveis: null, formatosSemUsoReal: null }))
    assert.equal(vazio.decisao, 'NAO_PRIORITARIO'); assert.match(vazio.motivoFinal, /Dados insuficientes/)
    // amostra NENHUMA vencida não trava (pode ter mudado); vigente trava
    assert.equal(avaliarOportunidadeDeAmostra(base({ tipoDeAmostra: m<'GRATIS' | 'REEMBOLSAVEL' | 'NENHUMA'>('NENHUMA') })).decisao, 'NAO_PEDIR')
  })
  test('5. meta de amostras não transforma produto ruim em bom (só desempata um razoável, e só se chega a tempo)', () => {
    const meta = [{ nome: 'Solicite 5 amostras', faltam: 2, fim: new Date(AGORA.getTime() + 30 * DIA) }]
    const r = avaliarOportunidadeDeAmostra(ruim({ metasDeAmostra: meta }))
    assert.equal(r.decisao, 'NAO_PEDIR'); assert.ok(r.riscos.some((x) => /não justifica este produto/.test(x)))
    assert.equal(r.fatores.find((f) => f.fator === 'metaDeAmostras')!.peso, 0, 'a meta não entra na nota')
    // razoável/neutro: a meta sobe um degrau
    const neutro = { comissaoValor: m(3), vendas: m(50), serieDeVendas: [], aderenciaDeCampanha: null, categoriasDaAudiencia: null, tipoDeAmostra: m<'GRATIS' | 'REEMBOLSAVEL' | 'NENHUMA'>('REEMBOLSAVEL'), facilidadeDeVideo: 60, formatosPossiveis: 6, formatosSemUsoReal: 4 }
    const semMeta = avaliarOportunidadeDeAmostra(base(neutro))
    const comMeta = avaliarOportunidadeDeAmostra(base({ ...neutro, metasDeAmostra: meta }))
    assert.equal(semMeta.decisao, 'NAO_PRIORITARIO'); assert.equal(comMeta.decisao, 'PEDIR_SE_PRIORIDADE'); assert.match(comMeta.motivoFinal, /Conta para a meta/)
    const curta = avaliarOportunidadeDeAmostra(base({ metasDeAmostra: [{ nome: 'M', faltam: 1, fim: new Date(AGORA.getTime() + 5 * DIA) }] }))
    assert.ok(curta.riscos.some((x) => /prazo curto/.test(x)))
  })
  test('travas: fora do TikTok Shop, compliance e indisponível → NÃO PEDIR', () => {
    assert.equal(avaliarOportunidadeDeAmostra(base({ tiktokShop: false })).decisao, 'NAO_PEDIR')
    assert.equal(avaliarOportunidadeDeAmostra(base({ complianceBloqueante: true })).decisao, 'NAO_PEDIR')
    assert.equal(avaliarOportunidadeDeAmostra(base({ disponivel: m(false, 'Fonte oficial') })).decisao, 'NAO_PEDIR')
  })
})

const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')
const PREFIXO = 'Conta de Teste — '
const CAB = 'ID do pedido;ID do SKU;ID do produto;Nome do produto;Nome da loja;Quantidade;Valor do pedido;Taxa de comissão;Comissão estimada;Comissão real;Status do pedido;Status da liquidação;Data do pedido;Data de liquidação;Tipo de conteúdo;ID do conteúdo'
const linha = (o: { pedido: string; status: string; liq?: string; real?: string; conteudo?: string; produto?: string }) =>
  [o.pedido, 'sku-1', o.produto ?? '1729000108', 'Produto P222', 'Loja X', '1', 'R$ 59,90', '12%', 'R$ 7,19', o.real ?? '', o.status, o.liq ?? '', '14/10/2026 10:30', o.liq ? '15/10/2026 10:30' : '', 'Vídeo', o.conteudo ?? ''].join(';')

describe('P2.22 — eventos, processador e reações (banco de TESTE)', { skip: !TEM_BANCO ? 'exige banco de TESTE' : false, timeout: 900_000 }, () => {
  let prisma: typeof import('../lib/prisma').prisma
  let P: typeof import('../lib/processador-de-eventos')
  let R: typeof import('../lib/reacoes-a-eventos')
  let L: typeof import('../lib/ledger')
  let Am: typeof import('../lib/amostras')
  let I: typeof import('../lib/creator-center-importacao')
  let J: typeof import('../lib/jornada')
  let A: typeof import('../lib/publicacao-assistida')
  let C: typeof import('../lib/dados-comerciais')
  let RV: typeof import('../lib/resultados-videos')
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  const workspaces: string[] = []
  const usuarios: Record<string, string> = {}
  const marca = `r108-${Date.now()}`
  const novoWs = async (nome: string, ativar = true, agora = new Date()) => {
    const ws = (await prisma.workspace.create({ data: { name: `${PREFIXO}${nome} r108`, ownerId: `${marca}-${nome}` }, select: { id: true } })).id
    workspaces.push(ws)
    usuarios[ws] = (await prisma.user.create({ data: { email: `${marca}-${workspaces.length}@teste.local`, name: 'U', password: 'x', workspaceId: ws }, select: { id: true } })).id
    if (ativar) await P.ativarProcessador({ workspaceId: ws, tipos: R.TIPOS_COM_REACAO, agora })
    return ws
  }
  const evento = (ws: string, tipo: 'SAMPLE_DELIVERED' | 'COMMISSION_CONFIRMED' | 'PRICE_CHANGED', id: string, extra: Record<string, unknown> = {}) =>
    L.registrarEvento({ workspaceId: ws, tipo, chaveIdempotencia: `teste:${tipo}:${id}`, entidadeTipo: 'Teste', entidadeId: id, payload: extra })
  async function candidato(ws: string, nome: string, extra: Record<string, unknown> = {}) {
    const ext = `9000000108${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 1000)}`
    return (await prisma.candidatoDeProduto.create({ data: {
      workspaceId: ws, chaveDeOrigem: `${marca}-${ext}`, fonte: 'USER_PROVIDED', nome: `FIXTURE ${nome}`, categoria: 'Casa e Decoração', preco: 79.9, comissaoValor: 12, vendas: 1500, providerId: 'tiktok-shop', externalId: ext,
      linkProduto: `https://www.tiktok.com/view/product/${ext}`, score: 60, baseDeEvidencia: 60, confianca: 'SEM_HISTORICO_REAL', status: 'APRESENTADO', coletadoEm: new Date(), validoAte: new Date('2027-01-01'),
      motivosPositivos: [], riscos: [], desconhecidos: [], porqueDestaPosicao: [], nivelDeRisco: 'BAIXO', ...extra,
    }, select: { id: true, externalId: true } }))
  }
  const importar = (ws: string, nome: string, linhas: string[]) => I.importarCreatorCenter({ workspaceId: ws, userId: null, nomeArquivo: nome, conteudo: [CAB, ...linhas].join('\n'), dataOrigin: 'TEST_FIXTURE' })
  const estadoDe = async (id: string) => (await prisma.domainEvent.findUniqueOrThrow({ where: { id } }))

  before(async () => {
    ;[{ prisma }, P, R, L, Am, I, J, A, C, RV, { limparWorkspaceDeTeste: limpar }] = await Promise.all([
      import('../lib/prisma'), import('../lib/processador-de-eventos'), import('../lib/reacoes-a-eventos'), import('../lib/ledger'), import('../lib/amostras'),
      import('../lib/creator-center-importacao'), import('../lib/jornada'), import('../lib/publicacao-assistida'), import('../lib/dados-comerciais'), import('../lib/resultados-videos'), import('./_limpar-workspace-de-teste'),
    ])
  })
  after(async () => {
    if (prisma) {
      await prisma.domainEvent.deleteMany({ where: { workspaceId: { in: workspaces } } }).catch(() => null)
      await prisma.decisionRecord.deleteMany({ where: { workspaceId: { in: workspaces } } }).catch(() => null)
      for (const w of workspaces) await limpar(prisma, w, PREFIXO)
    }
    await prisma?.$disconnect()
  })

  test('19. eventos antigos não disparam avalanche: ao ativar, ficam IGNORADO_ANTES_DO_CORTE com contagem, data e motivo', async () => {
    const ws = await novoWs('corte', false)
    for (let i = 0; i < 4; i++) await evento(ws, 'SAMPLE_DELIVERED', `antigo-${i}`)
    await evento(ws, 'PRICE_CHANGED', 'antigo-p')
    const depois = new Date(Date.now() + 1000)
    const r = await P.ativarProcessador({ workspaceId: ws, tipos: R.TIPOS_COM_REACAO, agora: depois })
    assert.equal(r.novo, true); assert.equal(r.corte.ignorados, 5)
    assert.deepEqual((r.corte.detalhe as { porTipo: Record<string, number> }).porTipo, { SAMPLE_DELIVERED: 4, PRICE_CHANGED: 1 })
    assert.match(String((r.corte.detalhe as { motivo: string }).motivo), /avalanche/)
    assert.equal((await P.ativarProcessador({ workspaceId: ws, tipos: R.TIPOS_COM_REACAO })).novo, false, 'ativar de novo não refaz o corte')
    let chamadas = 0
    const x = await P.processarEventos({ reacoes: { SAMPLE_DELIVERED: async () => { chamadas++; return {} }, PRICE_CHANGED: async () => { chamadas++; return {} } }, workspaceId: ws, agora: new Date(depois.getTime() + 60_000) })
    assert.deepEqual([x.processados, chamadas], [0, 0])
    const painel = await P.painelDoProcessador(ws, R.TIPOS_COM_REACAO)
    assert.equal(painel.contagem.ignoradosAntesDoCorte, 5); assert.equal(painel.ativo, true)
  })

  test('9. duas instâncias ao mesmo tempo: cada evento reage UMA vez; 6. o mesmo evento não é processado de novo', async () => {
    const ws = await novoWs('concorrencia')
    for (let i = 0; i < 8; i++) await evento(ws, 'SAMPLE_DELIVERED', `c-${i}`)
    const vistos = new Map<string, number>()
    const reacoes = { SAMPLE_DELIVERED: async (e: { id: string }) => { vistos.set(e.id, (vistos.get(e.id) ?? 0) + 1); await new Promise((r) => setTimeout(r, 30)); return { ok: true } } }
    const [a, b] = await Promise.all([P.processarEventos({ reacoes, workspaceId: ws, limite: 8, worker: 'A' }), P.processarEventos({ reacoes, workspaceId: ws, limite: 8, worker: 'B' })])
    assert.equal(a.processados + b.processados, 8); assert.equal(vistos.size, 8); assert.ok([...vistos.values()].every((n) => n === 1))
    const de_novo = await P.processarEventos({ reacoes, workspaceId: ws })
    assert.equal(de_novo.processados, 0)
    assert.equal((await prisma.execucaoDoProcessador.findMany({ where: { workspaceId: ws, tipo: 'EXECUCAO' } })).length >= 1, true, 'execução registrada')
  })

  test('10. queda no meio e retomada: os reivindicados e não terminados voltam quando o lease vence', async () => {
    const ws = await novoWs('queda')
    for (let i = 0; i < 3; i++) await evento(ws, 'SAMPLE_DELIVERED', `q-${i}`)
    const vistos: string[] = []
    const reacoes = { SAMPLE_DELIVERED: async (e: { id: string }) => { vistos.push(e.id); return {} } }
    const t0 = new Date()
    const r1 = await P.processarEventos({ reacoes, workspaceId: ws, agora: t0, interromperDepoisDe: 1 })
    // O lease é RENOVADO durante o lote (P2.28), pelo relógio real: ele vence LEASE_MS depois do fim da execução
    // interrompida, não do início (com banco remoto lento, o lote leva mais de 1 s).
    const t1 = new Date()
    assert.equal(r1.processados, 1)
    assert.equal(await prisma.domainEvent.count({ where: { workspaceId: ws, estadoProcessamento: 'PROCESSANDO' } }), 2)
    assert.equal((await P.processarEventos({ reacoes, workspaceId: ws, agora: new Date(t0.getTime() + 60_000) })).processados, 0, 'lease ainda vale')
    const r3 = await P.processarEventos({ reacoes, workspaceId: ws, agora: new Date(t1.getTime() + P.LEASE_MS + 1000) })
    assert.equal(r3.processados, 2); assert.equal(new Set(vistos).size, 3); assert.equal(vistos.length, 3)
    assert.ok((await P.painelDoProcessador(ws, R.TIPOS_COM_REACAO)).execucoes.length >= 2)
  })

  test('11. retry: falha temporária volta com espera crescente e processa; 12. falha permanente vira FALHOU (dead letter) com erro e contexto; retry manual', async () => {
    const ws = await novoWs('retry')
    const e1 = await evento(ws, 'SAMPLE_DELIVERED', 'r-temporario')
    const e2 = await evento(ws, 'PRICE_CHANGED', 'r-permanente')
    let falhasRestantes = 2
    const reacoes = {
      SAMPLE_DELIVERED: async () => { if (falhasRestantes-- > 0) throw new Error('banco ocupado (temporário)'); return { ok: true } },
      PRICE_CHANGED: async () => { throw new Error('dado corrompido (permanente)') },
    }
    let t = new Date()
    await P.processarEventos({ reacoes, workspaceId: ws, agora: t })
    let x1 = await estadoDe(e1.id)
    assert.deepEqual([x1.estadoProcessamento, x1.tentativas], ['RETRY', 1]); assert.match(x1.erroProcessamento!, /temporário/)
    const espera1 = x1.proximaTentativaEm!.getTime() - t.getTime()
    assert.equal((await P.processarEventos({ reacoes, workspaceId: ws, agora: new Date(t.getTime() + 1000) })).processados, 0, 'respeita a espera')
    for (let i = 0; i < 8; i++) { t = new Date(t.getTime() + 61 * 60_000); await P.processarEventos({ reacoes, workspaceId: ws, agora: t }) }
    x1 = await estadoDe(e1.id)
    assert.deepEqual([x1.estadoProcessamento, x1.tentativas], ['PROCESSADO', 3])
    const x2 = await estadoDe(e2.id)
    assert.deepEqual([x2.estadoProcessamento, x2.tentativas], ['FALHOU', P.MAX_TENTATIVAS]); assert.match(x2.erroProcessamento!, /permanente/); assert.ok(x2.ultimaTentativaEm)
    assert.ok(espera1 >= 2 * 60_000 - 1000, 'espera crescente (2^tentativa min)')
    const painel = await P.painelDoProcessador(ws, R.TIPOS_COM_REACAO)
    assert.equal(painel.contagem.falhos, 1); assert.ok(painel.problemas.some((p) => p.id === e2.id && /permanente/.test(p.erroProcessamento ?? '')))
    // retry manual com a reação corrigida
    assert.equal(await P.reprocessarEvento({ workspaceId: ws, eventoId: e2.id, userId: usuarios[ws] }), true)
    assert.equal(await P.reprocessarEvento({ workspaceId: ws, eventoId: e1.id, userId: usuarios[ws] }), false, 'só FALHOU pode ser reprocessado')
    await P.processarEventos({ reacoes: { ...reacoes, PRICE_CHANGED: async () => ({ corrigido: true }) }, workspaceId: ws, agora: new Date(t.getTime() + 1000) })
    assert.equal((await estadoDe(e2.id)).estadoProcessamento, 'PROCESSADO')
  })

  test('14. prevenção de loop: reação que gera o MESMO evento da mesma entidade é cortada; cadeia longa para na profundidade máxima', async () => {
    const ws = await novoWs('loop')
    const raiz = await evento(ws, 'SAMPLE_DELIVERED', 'loop-1')
    let n = 0
    const reacoes = {
      SAMPLE_DELIVERED: async (e: { workspaceId: string; entidadeId: string | null }) => { n++; await L.registrarEvento({ workspaceId: e.workspaceId, tipo: 'SAMPLE_DELIVERED', chaveIdempotencia: `loop:${n}`, entidadeTipo: 'Teste', entidadeId: e.entidadeId, payload: {} }); return {} },
    }
    for (let i = 0; i < 5; i++) await P.processarEventos({ reacoes, workspaceId: ws })
    assert.equal(n, 1, 'reagiu só ao original')
    const filho = await prisma.domainEvent.findFirstOrThrow({ where: { workspaceId: ws, causadoPorEventoId: raiz.id } })
    assert.deepEqual([filho.estadoProcessamento, filho.profundidade], ['IGNORADO_LOOP', 1]); assert.match(filho.erroProcessamento!, /ciclo/)
    // cadeia: cada reação gera um evento de OUTRA entidade → para na profundidade máxima
    const ws2 = await novoWs('cadeia')
    await evento(ws2, 'SAMPLE_DELIVERED', 'cadeia-0')
    let k = 0
    const cadeia = { SAMPLE_DELIVERED: async (e: { workspaceId: string }) => { k++; await L.registrarEvento({ workspaceId: e.workspaceId, tipo: 'SAMPLE_DELIVERED', chaveIdempotencia: `cadeia:${k}`, entidadeTipo: 'Teste', entidadeId: `cadeia-${k}`, payload: {} }); return {} } }
    for (let i = 0; i < 10; i++) await P.processarEventos({ reacoes: cadeia, workspaceId: ws2 })
    assert.equal(k, P.PROFUNDIDADE_MAXIMA + 1)
    assert.equal(await prisma.domainEvent.count({ where: { workspaceId: ws2, estadoProcessamento: 'IGNORADO_LOOP' } }), 1)
  })

  test('6/16. SAMPLE_DELIVERED: emitido só no RECEBIMENTO (ENVIADA não), processado uma vez, cria a próxima ação (jornada em conteúdo, publicação com briefing) e calcula o prazo; 13. fora de ordem = obsoleto', async () => {
    const ws = await novoWs('amostra')
    const c = await candidato(ws, 'Organizador')
    const { amostra } = await Am.registrarAmostra({ workspaceId: ws, userId: null, dados: { nomeProduto: 'FIXTURE Organizador', productIdExterno: c.externalId, candidatoId: c.id, tipo: 'GRATIS' } })
    await Am.aplicarEventoNaAmostra({ workspaceId: ws, userId: null, id: amostra.id, evento: 'APROVADA' })
    await Am.aplicarEventoNaAmostra({ workspaceId: ws, userId: null, id: amostra.id, evento: 'ENVIADA' })
    assert.equal(await prisma.domainEvent.count({ where: { workspaceId: ws, tipo: 'SAMPLE_DELIVERED' } }), 0, 'ENVIADA não é entrega')
    await Am.aplicarEventoNaAmostra({ workspaceId: ws, userId: null, id: amostra.id, evento: 'RECEBIDA' })
    assert.equal(await prisma.domainEvent.count({ where: { workspaceId: ws, tipo: 'SAMPLE_DELIVERED' } }), 1)
    const r1 = await P.processarEventos({ reacoes: R.REACOES, workspaceId: ws })
    const r2 = await P.processarEventos({ reacoes: R.REACOES, workspaceId: ws })
    assert.deepEqual([r1.processados, r2.processados], [1, 0])
    const ev = await prisma.domainEvent.findFirstOrThrow({ where: { workspaceId: ws, tipo: 'SAMPLE_DELIVERED' } })
    const res = ev.resultadoProcessamento as { prazo: { em: string; confirmado: boolean }; etapa: string; publicacao: { id: string; briefing: number; horarioPlanejado: string | null } | null }
    assert.ok(res.prazo && res.prazo.confirmado === false, 'prazo estimado (regra geral), dito como estimado')
    assert.ok(['CONTEUDO', 'MIDIA', 'GERANDO_VIDEO', 'APROVAR_VIDEO'].includes(res.etapa), `jornada avançou para o conteúdo (${res.etapa})`)
    assert.ok(res.publicacao && res.publicacao.briefing > 0, 'publicação preparada com o briefing (cenas para gravar)')
    assert.equal(await prisma.publicacaoAssistida.count({ where: { workspaceId: ws, estado: { in: ['PUBLICADO', 'PUBLICANDO'] } } }), 0, 'nada publicado')
    // 13: evento chega depois de a amostra já ter sido concluída → obsoleto, sem efeito
    await Am.aplicarEventoNaAmostra({ workspaceId: ws, userId: null, id: amostra.id, evento: 'CONCLUIDA' })
    const fora = await evento(ws, 'SAMPLE_DELIVERED', amostra.id)
    await P.processarEventos({ reacoes: R.REACOES, workspaceId: ws })
    assert.match(String(((await estadoDe(fora.id)).resultadoProcessamento as { obsoleto: string }).obsoleto), /CONCLUIDA/)
  })

  test('7/8. COMMISSION_CONFIRMED: só na passagem para LIQUIDADA, uma vez; reimportar não duplica; reversão vira COMMISSION_REVERSED e o histórico fica; 18. alimenta o aprendizado; 13. confirmado e já revertido = obsoleto', async () => {
    const ws = await novoWs('comissao')
    const post = `75500000108${String(Date.now()).slice(-6)}`
    await prisma.videoTikTokResultado.create({ data: { workspaceId: ws, estrutura: 'ACHADO_TIKTOK_SHOP', gancho: 'Olha o que eu achei no TikTok Shop.', cta: 'A', duracaoSegundos: 15, publicadoEm: new Date(), metasIds: [], origemMetricas: 'MANUAL', views: 2000, postId: post } })
    await importar(ws, 'a.csv', [linha({ pedido: 'P1', status: 'Pago', conteudo: post })])
    assert.equal(await prisma.domainEvent.count({ where: { workspaceId: ws, tipo: 'COMMISSION_CONFIRMED' } }), 0, 'estimada não é confirmada')
    const liq = [linha({ pedido: 'P1', status: 'Concluído', liq: 'Liquidado', real: 'R$ 6,50', conteudo: post })]
    await importar(ws, 'b.csv', liq)
    await importar(ws, 'b.csv', liq)
    await importar(ws, 'b2.csv', [...liq, linha({ pedido: 'P9', status: 'Pago' })])
    assert.equal(await prisma.domainEvent.count({ where: { workspaceId: ws, tipo: 'COMMISSION_CONFIRMED' } }), 1, 'reimportação não duplica')
    const r = await P.processarEventos({ reacoes: R.REACOES, workspaceId: ws })
    assert.equal(r.processados, 1)
    assert.equal((await P.processarEventos({ reacoes: R.REACOES, workspaceId: ws })).processados, 0)
    const conf = await prisma.domainEvent.findFirstOrThrow({ where: { workspaceId: ws, tipo: 'COMMISSION_CONFIRMED' } })
    const res = conf.resultadoProcessamento as { comissaoLiquidada: number; aprendizado: { videosComparaveis: number } }
    assert.equal(res.comissaoLiquidada, 6.5)
    const vs = await RV.videosParaAprender(ws)
    assert.equal(vs.find((v) => v.views === 2000)!.comissaoConfirmada, 6.5, 'o aprendizado conta a comissão confirmada (peso 1)')
    assert.equal(res.aprendizado.videosComparaveis, 1)
    // reversão
    await importar(ws, 'c.csv', [linha({ pedido: 'P1', status: 'Cancelado', conteudo: post })])
    assert.equal(await prisma.domainEvent.count({ where: { workspaceId: ws, tipo: 'COMMISSION_REVERSED' } }), 1)
    assert.equal(await prisma.domainEvent.count({ where: { workspaceId: ws, tipo: 'COMMISSION_CONFIRMED' } }), 1, '20. o evento histórico fica')
    await P.processarEventos({ reacoes: R.REACOES, workspaceId: ws })
    assert.equal(await prisma.domainEvent.count({ where: { workspaceId: ws, tipo: { in: ['COMMISSION_CONFIRMED', 'COMMISSION_REVERSED'] }, estadoProcessamento: 'PROCESSADO' } }), 2)
    // 13: um COMMISSION_CONFIRMED atrasado (pedido já revertido) não age
    const atrasado = await L.registrarEvento({ workspaceId: ws, tipo: 'COMMISSION_CONFIRMED', chaveIdempotencia: 'teste:atrasado', entidadeTipo: 'PedidoAfiliadoTikTok', entidadeId: conf.entidadeId, payload: {} })
    await P.processarEventos({ reacoes: R.REACOES, workspaceId: ws })
    assert.match(String(((await estadoDe(atrasado.id)).resultadoProcessamento as { obsoleto: string }).obsoleto), /CANCELADA/)
  })

  test('15. PRICE_CHANGED invalida o conteúdo pendente (preço antigo sai, continua aguardando aprovação) e 20. a publicação histórica não muda', async () => {
    const ws = await novoWs('preco')
    const c = await candidato(ws, 'Garrafa')
    await J.escolherProduto({ workspaceId: ws, userId: usuarios[ws], candidatoId: c.id, emMaos: true })
    const a = await prisma.publicacaoAssistida.findFirstOrThrow({ where: { workspaceId: ws, candidatoId: c.id } })
    const ap = a.apresentacao as Record<string, unknown> & { versao: Record<string, unknown> }
    await prisma.publicacaoAssistida.update({ where: { id: a.id }, data: { estado: 'AGUARDANDO_APROVACAO', apresentacao: { ...ap, versao: { ...ap.versao, legenda: 'Amei!\nSai por R$ 79,90\n#achadinhos' }, video: { arquivo: 'https://exemplo.invalid/fixture.mp4', situacao: 'GERADO' } } as never, qualityGate: { veredito: 'APROVADO', arquivo: { fixture: true } } as never } })
    const historica = await prisma.publicacaoAssistida.create({ data: { workspaceId: ws, estado: 'PUBLICADO', nomeProduto: 'Histórica', varianteId: 'v', estrutura: 'e', candidatoId: c.id, apresentacao: { versao: { legenda: 'Sai por R$ 79,90' } }, qualityGate: {}, motivoEscolha: 'm', objetivoDoTeste: 'o', metasIds: [], publicadoEm: new Date() } })
    // o preço mudou de fato (89,90) e a fonte de curadoria já não confirma o valor (coleta antiga): o texto com R$ 79,90 não pode ir ao ar
    await prisma.candidatoDeProduto.update({ where: { id: c.id }, data: { preco: 89.9, coletadoEm: new Date('2026-01-01') } })
    await evento(ws, 'PRICE_CHANGED', c.id, { anterior: 79.9, novo: 89.9 })
    const ev = await prisma.domainEvent.findFirstOrThrow({ where: { workspaceId: ws, tipo: 'PRICE_CHANGED', chaveIdempotencia: `teste:PRICE_CHANGED:${c.id}` } })
    // a reação procura pelo candidato: o evento de teste usa entidadeId = candidato
    assert.equal(ev.entidadeId, c.id)
    await P.processarEventos({ reacoes: R.REACOES, workspaceId: ws })
    const depois = await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id: a.id } })
    assert.equal(depois.estado, 'AGUARDANDO_APROVACAO', 'volta/continua para a aprovação humana')
    assert.equal((depois.apresentacao as { versao: { legenda: string } }).versao.legenda, `Amei!\n${C.FALLBACK_DO_PRECO}\n#achadinhos`, 'preço antigo invalidado')
    const res = (await estadoDe(ev.id)).resultadoProcessamento as { revisadas: { id: string; legendaCorrigida: boolean }[] }
    assert.ok(res.revisadas.some((x) => x.id === a.id && x.legendaCorrigida))
    const h2 = await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id: historica.id } })
    assert.deepEqual([h2.estado, JSON.stringify(h2.apresentacao), h2.updatedAt.getTime()], [historica.estado, JSON.stringify(historica.apresentacao), historica.updatedAt.getTime()])
  })

  test('17. CONTENT_PUBLISHED: publicado (por qualquer caminho) inicia a medição, liga a amostra e registra a obrigação cumprida', async () => {
    const ws = await novoWs('publicado')
    const c = await candidato(ws, 'Luminária')
    const { amostra } = await Am.registrarAmostra({ workspaceId: ws, userId: null, dados: { nomeProduto: 'FIXTURE Luminária', productIdExterno: c.externalId, candidatoId: c.id, tipo: 'GRATIS' } })
    await Am.aplicarEventoNaAmostra({ workspaceId: ws, userId: null, id: amostra.id, evento: 'RECEBIDA' })
    await J.escolherProduto({ workspaceId: ws, userId: usuarios[ws], candidatoId: c.id, emMaos: true })
    const a = await prisma.publicacaoAssistida.findFirstOrThrow({ where: { workspaceId: ws, candidatoId: c.id } })
    await prisma.publicacaoAssistida.update({ where: { id: a.id }, data: { estado: 'APROVADO' } })
    await A.registrarPublicacaoManual({ workspaceId: ws, userId: usuarios[ws], id: a.id, url: 'https://www.tiktok.com/@teste/video/7550000000108000001' })
    assert.equal(await prisma.domainEvent.count({ where: { workspaceId: ws, tipo: 'CONTENT_PUBLISHED' } }), 1, 'uma vez, mesmo com dois caminhos emitindo')
    await P.processarEventos({ reacoes: R.REACOES, workspaceId: ws })
    const ev = await prisma.domainEvent.findFirstOrThrow({ where: { workspaceId: ws, tipo: 'CONTENT_PUBLISHED' } })
    assert.equal(ev.estadoProcessamento, 'PROCESSADO')
    const res = ev.resultadoProcessamento as { medicaoIniciada: boolean; medirAPartirDe: string; obrigacao: { amostraId: string; cumpridaNoPrazo: boolean } }
    assert.equal(res.medicaoIniciada, true); assert.ok(res.medirAPartirDe)
    assert.equal(res.obrigacao.amostraId, amostra.id); assert.equal(res.obrigacao.cumpridaNoPrazo, true)
    const am = await prisma.amostraTikTokShop.findUniqueOrThrow({ where: { id: amostra.id } })
    assert.equal(am.publicacaoAssistidaId, a.id)
    assert.equal((am.historico as { acao: string }[]).filter((h) => h.acao === 'OBRIGACAO_DE_CONTEUDO').length, 1)
    const resultado = await prisma.videoTikTokResultado.findUniqueOrThrow({ where: { publicacaoAssistidaId: a.id } })
    assert.ok(resultado.versaoDoDna, 'DNA extraído junto com o início da medição')
  })
})
