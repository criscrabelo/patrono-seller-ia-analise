/**
 * P2.28 — OBSERVABILIDADE E RECONCILIAÇÃO OPERACIONAL.
 *
 * Trava: publicação presa/confirmada/incerta (nunca republica; incerto pede confirmação humana); importação
 * parcial/interrompida/sem vínculo como "IMPORTADO COM ALERTAS"/"INCOMPLETA"; reconciliação que corrige só o
 * seguro (com histórico) e manda o resto para "Precisa de você"; duas rodadas simultâneas; processador reiniciado
 * e evento processado uma vez; health check saudável e com pendência. Banco de TESTE.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { vereditoDaSaude } from '../lib/saude-operacional'
// P2.45: este arquivo testa o fluxo de publicação ANTERIOR aos três controles (técnico, comercial, conformidade).
process.env.PATRONO_TESTE_LEGADO_SEM_TRES_CONTROLES = 'true'

const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')

describe('P2.28 — puro', () => {
  test('veredito: qualquer indicador em atenção → ATENÇÃO NECESSÁRIA', () => {
    assert.equal(vereditoDaSaude([{ ok: true }, { ok: true }]), 'SISTEMA SAUDÁVEL')
    assert.equal(vereditoDaSaude([{ ok: true }, { ok: false }]), 'ATENÇÃO NECESSÁRIA')
  })
})

describe('P2.28 — banco de TESTE', { skip: !TEM_BANCO }, () => {
  let prisma: typeof import('../lib/prisma')['prisma']
  let R: typeof import('../lib/reconciliacao')
  let S: typeof import('../lib/saude-operacional')
  let C: typeof import('../lib/precisa-de-voce-central')
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  const PREFIXO = 'Conta de Teste — '
  const marca = `r114-${Date.now()}`
  const contas: string[] = []
  const MIN = 60_000
  before(async () => {
    ;[{ prisma }, R, S, C, { limparWorkspaceDeTeste: limpar }] = await Promise.all([import('../lib/prisma'), import('../lib/reconciliacao'), import('../lib/saude-operacional'), import('../lib/precisa-de-voce-central'), import('./_limpar-workspace-de-teste')])
  })
  after(async () => {
    if (prisma) for (const w of contas) {
      await prisma.automationJob.deleteMany({ where: { workspaceId: w } })
      await prisma.execucaoDoProcessador.deleteMany({ where: { workspaceId: w } })
      await limpar(prisma, w, PREFIXO)
    }
    await prisma?.$disconnect()
  })
  async function conta(nome: string) {
    const { criarUsuarioComWorkspace } = await import('../lib/workspace')
    const r = await criarUsuarioComWorkspace(prisma, { email: `${marca}-${nome}@teste.local`, password: 'x', name: `${PREFIXO}${nome} r114` })
    await prisma.workspace.update({ where: { id: r.workspace.id }, data: { name: `${PREFIXO}${nome} r114` } })
    contas.push(r.workspace.id)
    const produto = await prisma.produto.create({ data: { workspaceId: r.workspace.id, userId: r.user.id, nome: `Produto ${nome}`, categoria: 'Casa', origemConteudo: 'manual', tipoVenda: 'afiliado' } })
    return { ws: r.workspace.id, userId: r.user.id, produtoId: produto.id }
  }
  const antigo = (min: number) => new Date(Date.now() - min * MIN)
  async function assistida(ws: string, estado: string, extra: Record<string, unknown> = {}, idadeMin = 60) {
    const a = await prisma.publicacaoAssistida.create({ data: { workspaceId: ws, estado, nomeProduto: 'Organizador r114', varianteId: 'v', estrutura: 'DEMONSTRACAO', apresentacao: { produto: { nome: 'Organizador r114', categoria: 'Casa' }, versao: { estrutura: 'DEMONSTRACAO', gancho: 'g', cta: 'Comente', duracaoSegundos: 20 }, video: { situacao: 'GERADO' } }, qualityGate: {}, motivoEscolha: 't', objetivoDoTeste: 't', historico: [], ...extra } as never })
    await prisma.$executeRaw`UPDATE "PublicacaoAssistida" SET "updatedAt" = ${antigo(idadeMin)} WHERE id = ${a.id}`
    return a
  }
  async function publicacao(ws: string, userId: string, produtoId: string, assistidaId: string, estado: string, publicacaoExternaId: string | null = null) {
    const c = await prisma.conteudo.create({ data: { workspaceId: ws, userId, produtoId, roteiro: 'x', redeSocial: 'tiktok' }, select: { id: true } })
    return prisma.publicacao.create({ data: { workspaceId: ws, contentId: c.id, provider: 'TIKTOK', canal: 'tiktok', chaveDaTentativa: `assistida:${assistidaId}:t1`, estado: estado as never, publicacaoExternaId } as never })
  }

  test('publicações: confirmada na plataforma fecha; não enviada volta para APROVADO; sem confirmação vira ENVIO INCERTO (nunca republica) e o retry exige "conferi o perfil"', async () => {
    const { ws, userId, produtoId } = await conta('publicacoes')
    const confirmada = await assistida(ws, 'PUBLICANDO')
    const p1 = await publicacao(ws, userId, produtoId, confirmada.id, 'DISTRIBUIDA', '7559999000000000001')
    await prisma.publicacaoAssistida.update({ where: { id: confirmada.id }, data: { publicacaoId: p1.id } })
    await prisma.$executeRaw`UPDATE "PublicacaoAssistida" SET "updatedAt" = ${antigo(60)} WHERE id = ${confirmada.id}`
    const naoEnviada = await assistida(ws, 'PUBLICANDO')
    const incerta = await assistida(ws, 'PUBLICANDO')
    await publicacao(ws, userId, produtoId, incerta.id, 'DISTRIBUINDO')
    const recente = await assistida(ws, 'PUBLICANDO', {}, 5)
    const r = await R.reconciliarEstadoOperacional(ws)
    const est = async (id: string) => (await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id } }))
    assert.equal((await est(confirmada.id)).estado, 'PUBLICADO', 'a plataforma respondeu: o estado local fecha')
    assert.equal((await est(confirmada.id)).postId, '7559999000000000001')
    assert.equal((await est(naoEnviada.id)).estado, 'APROVADO', 'nada saiu: volta para aprovada')
    const i = await est(incerta.id)
    assert.equal(i.estado, 'FALHOU')
    assert.match(i.erro ?? '', /^ENVIO INCERTO/)
    assert.equal((await est(recente.id)).estado, 'PUBLICANDO', 'recente: ainda aguardando, não mexe')
    const achado = r.achados.find((a) => a.entidade.id === incerta.id)!
    assert.equal(achado.desfecho, 'PRECISA_DE_VOCE')
    assert.match(achado.texto, /1 publicação está em estado incerto há \d+ minutos .* confirme se apareceu no TikTok antes de tentar novamente\./)
    assert.equal(await prisma.publicacao.count({ where: { workspaceId: ws, chaveDaTentativa: `assistida:${incerta.id}:t1` } }), 1, 'nada foi republicado')
    const { publicarAprovada } = await import('../lib/publicacao-assistida')
    await assert.rejects(publicarAprovada({ workspaceId: ws, userId, id: incerta.id, env: {} }), /confira o seu perfil/)
    // a central mostra a incerta pela própria assistida (sem duplicar pela reconciliação)
    const central = await C.centralPrecisaDeVoce(ws)
    assert.ok(!central.some((x) => x.id === `reconciliacao:pub-incerta:${incerta.id}`))
  })

  test('importação: interrompida = INCOMPLETA (vai para a central); parcial = IMPORTADO COM ALERTAS (recusadas, sem vínculo); a central some quando resolvida', async () => {
    const { ws } = await conta('importacao')
    const I = await import('../lib/creator-center-importacao')
    const CAB = 'ID do pedido;ID do SKU;ID do produto;Nome do produto;Nome da loja;Quantidade;Valor do pedido;Taxa de comissão;Comissão estimada;Comissão real;Status do pedido;Status da liquidação;Data do pedido;Data de liquidação;Tipo de conteúdo;ID do conteúdo;Comissão do parceiro'
    const linha = (p: string, prod = '1729114001') => [p, 'sku', prod, 'Item', 'Loja', '1', 'R$ 10,00', '10%', 'R$ 1,00', '', 'Pago', '', '14/10/2026 10:00', '', 'Vídeo', '', 'x'].join(';')
    const r = await I.importarCreatorCenter({ workspaceId: ws, userId: null, nomeArquivo: 'parcial.csv', conteudo: [CAB, linha('P1'), linha('P2'), ';;;;;;;;;;;;;;;;'].join('\n'), dataOrigin: 'TEST_FIXTURE' })
    const s = await I.situacaoDaImportacao(ws, r.importacaoId!)
    assert.equal(s!.situacao, 'IMPORTADO_COM_ALERTAS', JSON.stringify(s))
    assert.equal(s!.naoVinculados, 2)
    assert.match(s!.alertas.join(' '), /2 pedido\(s\) sem vínculo/)
    assert.match(s!.proximaAcao, /Revise os IDs/)
    // interrompida: começou e não terminou
    const parada = await prisma.importacaoCreatorCenter.create({ data: { workspaceId: ws, nomeArquivo: 'parou.csv', sha256: `${marca}-parou`, dataOrigin: 'TEST_FIXTURE', mapeamento: {}, colunasIgnoradas: [], linhasTotal: 40, linhasNovas: 0, linhasAtualizadas: 0, linhasIguais: 0, linhasRejeitadas: 0, ocorrencias: [], importadoEm: antigo(30), concluida: false } })
    assert.equal((await I.situacaoDaImportacao(ws, parada.id))!.situacao, 'INCOMPLETA')
    const rec = await R.reconciliarEstadoOperacional(ws)
    assert.ok(rec.achados.some((a) => a.tipo === 'IMPORTACAO_INCOMPLETA' && a.desfecho === 'PRECISA_DE_VOCE' && /envie o mesmo arquivo de novo/.test(a.texto)))
    assert.ok(rec.achados.some((a) => a.tipo === 'IMPORTACAO_COM_ALERTAS' && /2 pedido\(s\) sem vínculo/.test(a.texto)))
    let central = await C.centralPrecisaDeVoce(ws)
    assert.ok(central.some((x) => x.id === `reconciliacao:importacao-incompleta:${parada.id}`), 'não determinístico → Precisa de você')
    await prisma.importacaoCreatorCenter.update({ where: { id: parada.id }, data: { concluida: true } })
    central = await C.centralPrecisaDeVoce(ws)
    assert.ok(!central.some((x) => x.id === `reconciliacao:importacao-incompleta:${parada.id}`), 'resolvido some na hora (sem esperar a próxima rodada)')
  })

  test('reconciliação automática: comissão de venda cancelada, contador divergente, fila sem entidade e render interrompido corrigidos com histórico; publicação pendente de produto descartado encerrada pela regra canônica (P2.29.1)', async () => {
    const { ws, produtoId } = await conta('auto')
    const venda = await prisma.sale.create({ data: { workspaceId: ws, productId: produtoId, amount: 50, status: 'CANCELLED', source: 'manual', dataOrigin: 'TEST_FIXTURE' } })
    const com = await prisma.commission.create({ data: { workspaceId: ws, saleId: venda.id, productId: produtoId, expectedAmount: 5, confirmedAmount: 5, status: 'CONFIRMED' } })
    await prisma.contadorDeCotaDiaria.create({ data: { workspaceId: ws, plataforma: 'TIKTOK', regra: 'VIDEO_COMPRAVEL_POR_DIA', programa: 'PLATAFORMA', dia: '2026-10-15', usado: 3 } })
    const job = await prisma.automationJob.create({ data: { workspaceId: ws, tipo: 'GERAR_CONTEUDO', chave: `${marca}-orfao`, estado: 'PENDING', classe: 'AUTOMATIZAVEL', entityType: 'PRODUTO', entityId: 'nao-existe' } as never })
    const render = await assistida(ws, 'GERANDO_VIDEO', { apresentacao: { produto: { nome: 'Organizador r114', categoria: 'Casa' }, video: { situacao: 'GERANDO', tentativas: 1, trabalhoId: null } } }, 20)
    const cand = await prisma.candidatoDeProduto.create({ data: { workspaceId: ws, chaveDeOrigem: `${marca}-desc`, fonte: 'USER_PROVIDED', nome: 'Descartado r114', status: 'DESCARTADO', coletadoEm: new Date(), validoAte: new Date(), score: 10, baseDeEvidencia: 10, confianca: 'SEM_HISTORICO_REAL', nivelDeRisco: 'BAIXO' } as never })
    const pendente = await assistida(ws, 'AGUARDANDO_APROVACAO', { candidatoId: cand.id })
    // duas rodadas ao mesmo tempo: uma roda, a outra vê a primeira aberta (e nada é corrigido duas vezes)
    const [a, b] = await Promise.all([R.reconciliarEstadoOperacional(ws), R.reconciliarEstadoOperacional(ws)])
    assert.equal([a, b].filter((x) => x.emAndamento).length, 1, JSON.stringify([a.emAndamento, b.emAndamento]))
    assert.equal((await prisma.commission.findUniqueOrThrow({ where: { id: com.id } })).status, 'REVERSED')
    const h = await prisma.historicoDeComissao.findMany({ where: { commissionId: com.id } })
    assert.equal(h.length, 1)
    assert.equal(h[0].origem, 'RECONCILIACAO')
    assert.equal((await prisma.contadorDeCotaDiaria.findFirstOrThrow({ where: { workspaceId: ws } })).usado, 0, 'contador recalculado pelos consumos')
    assert.equal((await prisma.automationJob.findUniqueOrThrow({ where: { id: job.id } })).estado, 'CANCELLED')
    assert.equal((await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id: render.id } })).estado, 'VIDEO_NA_FILA')
    const feita = a.emAndamento ? b : a
    // P2.29.1: descartar é a decisão; o que com certeza não saiu é encerrado sozinho, com histórico (sem pergunta)
    assert.ok(feita.achados.some((x) => x.tipo === 'PRODUTO_EXCLUIDO_AINDA_VIVO' && x.desfecho === 'CORRIGIDO'), JSON.stringify(feita.achados.map((x) => `${x.tipo}:${x.desfecho}`)))
    assert.equal((await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id: pendente.id } })).estado, 'REJEITADO')
    assert.ok(!(await C.centralPrecisaDeVoce(ws)).some((x) => x.id.includes(pendente.id)))
    // a correção é auditada
    assert.equal(await prisma.auditLog.count({ where: { workspaceId: ws, action: 'reconciliacao.corrigiu' } }), 1)
    // rodar de novo não acha o que já foi corrigido (idempotente)
    const de_novo = await R.reconciliarEstadoOperacional(ws)
    assert.ok(!de_novo.achados.some((x) => x.desfecho === 'CORRIGIDO'), JSON.stringify(de_novo.achados.filter((x) => x.desfecho === 'CORRIGIDO').map((x) => x.tipo)))
  })

  test('processador reiniciado: lote interrompido é retomado; evento processado UMA vez com duas execuções simultâneas; evento que derruba a execução vira FALHOU', async () => {
    const { ws } = await conta('eventos')
    const P = await import('../lib/processador-de-eventos')
    await prisma.execucaoDoProcessador.create({ data: { workspaceId: ws, tipo: 'CORTE', worker: 't', iniciadoEm: antigo(10), terminadoEm: antigo(10) } })
    let chamadas = 0
    const reacoes = { TESTE_R114: async () => { chamadas++; await new Promise((r) => setTimeout(r, 20)); return { ok: true } } }
    for (let i = 0; i < 12; i++) await prisma.domainEvent.create({ data: { workspaceId: ws, tipo: 'TESTE_R114', payload: {}, chaveIdempotencia: `${marca}:${i}` } })
    // "queda" depois de 3: os demais ficam PROCESSANDO até o lease vencer
    await P.processarEventos({ reacoes, workspaceId: ws, limite: 12, interromperDepoisDe: 3 })
    assert.equal(chamadas, 3)
    const depois = new Date(Date.now() + P.LEASE_MS + 60_000)
    const [x, y] = await Promise.all([P.processarEventos({ reacoes, workspaceId: ws, limite: 12, agora: depois }), P.processarEventos({ reacoes, workspaceId: ws, limite: 12, agora: depois })])
    assert.equal(x.processados + y.processados, 9, 'retomados os 9 que estavam no lote derrubado')
    assert.equal(chamadas, 12, 'cada evento reagiu uma vez só')
    assert.equal(await prisma.domainEvent.count({ where: { workspaceId: ws, tipo: 'TESTE_R114', estadoProcessamento: 'PROCESSADO' } }), 12)
    // envenenado: caiu MAX vezes (a tentativa sobe no claim) → dead letter, sem reagir
    const env = await prisma.domainEvent.create({ data: { workspaceId: ws, tipo: 'TESTE_R114', payload: {}, chaveIdempotencia: `${marca}:env`, estadoProcessamento: 'PROCESSANDO', processandoPor: 'morto', processandoAte: antigo(5), tentativas: P.MAX_TENTATIVAS } })
    const r = await P.processarEventos({ reacoes, workspaceId: ws })
    assert.equal(r.falhas, 1)
    assert.equal(chamadas, 12)
    assert.equal((await prisma.domainEvent.findUniqueOrThrow({ where: { id: env.id } })).estadoProcessamento, 'FALHOU')
  })

  test('health check: conta limpa e conferida = SISTEMA SAUDÁVEL; com evento falho e publicação incerta = ATENÇÃO NECESSÁRIA com a ação', async () => {
    const limpa = await conta('saudavel')
    await R.reconciliarEstadoOperacional(limpa.ws)
    const ok = await S.saudeOperacional(limpa.ws)
    assert.equal(ok.veredito, 'SISTEMA SAUDÁVEL', JSON.stringify(ok.indicadores.filter((i) => !i.ok)))
    const suja = await conta('pendente')
    await prisma.domainEvent.create({ data: { workspaceId: suja.ws, tipo: 'PRICE_CHANGED', payload: {}, chaveIdempotencia: `${marca}:falho`, estadoProcessamento: 'FALHOU', tentativas: 5, erroProcessamento: 'teste' } })
    await assistida(suja.ws, 'FALHOU', { erro: 'ENVIO INCERTO — teste' })
    await R.reconciliarEstadoOperacional(suja.ws)
    const ruim = await S.saudeOperacional(suja.ws)
    assert.equal(ruim.veredito, 'ATENÇÃO NECESSÁRIA')
    const porChave = Object.fromEntries(ruim.indicadores.map((i) => [i.chave, i]))
    assert.equal(porChave.eventosFalhos.ok, false)
    assert.match(porChave.eventosFalhos.texto, /reprocesse em Eventos/)
    assert.equal(porChave.publicacoesIncertas.ok, false)
    assert.match(porChave.publicacoesIncertas.texto, /confirme no TikTok antes de tentar de novo/)
    assert.ok(ruim.agendamentos.some((a) => a.rotina === 'processar-eventos'))
  })
})
