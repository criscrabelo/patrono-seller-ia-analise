/**
 * P2.17.17 → P2.17.28 — Amostras como operação, evidência manual do app,
 * fila comercial, plano das 10, agenda, riscos, caminho até a 1ª comissão,
 * atribuição e coletor de métricas (desligado). Nenhuma chamada real ao TikTok.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  transicionar, estadoEfetivo, prazoDaAmostra, alertasDaAmostra, priorizarAmostras, valorEconomico, acaoEProximo, validarDadosDaAmostra,
  type AmostraDaTela, type AmostraParaPrioridade,
} from '../lib/amostras'
import { KITS_DE_AMOSTRAS, checarKit, DEPOIMENTO, kitParaTela } from '../lib/kits-de-amostras'
import { validarObservacao, sinaisVigentes, chaveDeProduto, chavesDoCandidato, demandaPelaPosicao } from '../lib/observacoes-de-mercado'
import { montarVisao, notaDeOportunidade, type ProdutoParaVisao } from '../lib/visoes-de-produtos'
import { filaComercial, proximaExecucao, planoDasDez, agendaSugerida, riscosOperacionais, caminhoParaPrimeiraComissao, classificarAtribuicao, MATRIZ_DAS_10 } from '../lib/operacao-comercial'
import { pendenciasDasAmostras, pendenciasDasMissoes } from '../lib/precisa-de-voce-central'
import { configuracaoDoColetor, lerMetricas, origemDepoisDaColeta } from '../lib/coletor-de-metricas-tiktok'
import { avaliarCampanha } from '../lib/campanha-sazonal'

const AGORA = new Date('2026-10-13T03:00:00-03:00')
const DIA = 24 * 60 * 60 * 1000

function amostra(m: Partial<AmostraDaTela> = {}): AmostraDaTela {
  return {
    id: 'a1', chave: 'nome:fixture', nomeProduto: 'FIXTURE produto', marketplace: 'tiktok-shop', tipo: 'GRATIS', estado: 'PENDENTE_APROVACAO', efetivo: 'PENDENTE_APROVACAO', rotulo: '',
    papeis: ['PRODUTO_AFILIADO'], comissaoObservada: null, comissaoFonte: null,
    datas: { solicitadaEm: null, aprovadaEm: null, enviadaEm: null, recebidaEm: null, rejeitadaEm: null }, prazo: null, alertas: [], alertasDetalhe: [],
    missao: { computada: null, computadaEm: null, metaId: null }, sinais: null, candidatoId: null, publicacaoAssistidaId: null, campanha: null, motivo: null, observacao: null, historico: [],
    aderenciaNatal: null, facilidade: 60, missaoAtiva: false, acaoDaTitular: null, proximoDoPatrono: '', ...m,
  }
}

describe('ciclo de vida da amostra', () => {
  test('avança; nunca recua nem salta para estado sem sentido', () => {
    assert.equal(transicionar('SOLICITADA', 'PENDENTE_APROVACAO'), 'PENDENTE_APROVACAO')
    assert.equal(transicionar('PENDENTE_APROVACAO', 'APROVADA'), 'APROVADA')
    assert.equal(transicionar('APROVADA', 'ENVIADA'), 'ENVIADA')
    assert.equal(transicionar('ENVIADA', 'RECEBIDA'), 'RECEBIDA')
    assert.equal(transicionar('RECEBIDA', 'CONCLUIDA'), 'CONCLUIDA')
    assert.throws(() => transicionar('RECEBIDA', 'APROVADA'), /Não dá para ir/)
    assert.throws(() => transicionar('ENVIADA', 'REJEITADA'), /Não dá para ir/, 'rejeição é do vendedor, antes do envio')
    assert.throws(() => transicionar('CANCELADA', 'RECEBIDA'), /Não dá para ir/)
    assert.throws(() => transicionar('SOLICITADA', 'QUALQUER'), /Evento inválido/)
  })
  test('produção é DERIVADA da publicação assistida (uma verdade só)', () => {
    assert.equal(estadoEfetivo('PENDENTE_APROVACAO', null, AGORA), 'PENDENTE_APROVACAO')
    assert.equal(estadoEfetivo('RECEBIDA', null, AGORA), 'CONTEUDO_PENDENTE')
    assert.equal(estadoEfetivo('RECEBIDA', { estado: 'AGUARDANDO_MIDIA', videoGerado: false, publicadoEm: null }, AGORA), 'CONTEUDO_PENDENTE')
    assert.equal(estadoEfetivo('RECEBIDA', { estado: 'VIDEO_NA_FILA', videoGerado: true, publicadoEm: null }, AGORA), 'VIDEO_GERADO')
    assert.equal(estadoEfetivo('RECEBIDA', { estado: 'AGUARDANDO_APROVACAO', videoGerado: true, publicadoEm: null }, AGORA), 'APROVACAO')
    assert.equal(estadoEfetivo('RECEBIDA', { estado: 'AGUARDANDO_APROVACAO', videoGerado: false, publicadoEm: null }, AGORA), 'CONTEUDO_PENDENTE', 'sem MP4 não há aprovação')
    assert.equal(estadoEfetivo('RECEBIDA', { estado: 'PUBLICADO', videoGerado: true, publicadoEm: new Date(AGORA.getTime() - 2 * DIA) }, AGORA), 'MEDINDO_RESULTADO')
    assert.equal(estadoEfetivo('RECEBIDA', { estado: 'PUBLICADO', videoGerado: true, publicadoEm: new Date(AGORA.getTime() - 20 * DIA) }, AGORA), 'CONCLUIDA')
  })
  test('pendente de aprovação NÃO conta como aprovada', () => {
    const a = amostra()
    assert.equal(a.datas.aprovadaEm, null)
    assert.equal(estadoEfetivo('PENDENTE_APROVACAO', null, AGORA), 'PENDENTE_APROVACAO')
    const fila = filaComercial({ amostras: [a], assistidas: [], status: [], agora: AGORA })
    assert.equal(fila[0].estado, 'AGUARDANDO_TERCEIRO')
    assert.equal(fila[0].quem, 'VENDEDOR')
  })
})

describe('prazo e alertas: desconhecido ≠ zero, estimativa rotulada', () => {
  test('sem recebimento e sem prazo do app: null (nada inventado)', () => {
    assert.equal(prazoDaAmostra({ prazoConteudoEm: null, prazoConteudoFonte: null, recebidaEm: null }), null)
  })
  test('recebida sem prazo confirmado: ESTIMADO, com aviso; confirmado no app vence', () => {
    const rec = new Date('2026-10-20T12:00:00Z')
    const e = prazoDaAmostra({ prazoConteudoEm: null, prazoConteudoFonte: null, recebidaEm: rec })!
    assert.equal(e.confirmado, false)
    assert.match(e.aviso ?? '', /Estimativa/)
    const c = prazoDaAmostra({ prazoConteudoEm: new Date('2026-10-25T00:00:00Z'), prazoConteudoFonte: 'CONFIRMADO_NO_APP', recebidaEm: rec })!
    assert.equal(c.confirmado, true)
    assert.equal(c.em, '2026-10-25T00:00:00.000Z')
  })
  test('obrigação de conteúdo, prazo próximo, atrasada', () => {
    const prazo = { em: new Date(AGORA.getTime() + 2 * DIA).toISOString(), confirmado: true, fonte: 'CONFIRMADO_NO_APP', aviso: null }
    assert.deepEqual(alertasDaAmostra({ estado: 'RECEBIDA', aprovadaEm: null }, 'CONTEUDO_PENDENTE', prazo, AGORA).alertas, ['OBRIGACAO_DE_CONTEUDO', 'PRAZO_PROXIMO'])
    const vencido = { ...prazo, em: new Date(AGORA.getTime() - DIA).toISOString() }
    assert.ok(alertasDaAmostra({ estado: 'RECEBIDA', aprovadaEm: null }, 'CONTEUDO_PENDENTE', vencido, AGORA).alertas.includes('ATRASADA'))
    assert.deepEqual(alertasDaAmostra({ estado: 'RECEBIDA', aprovadaEm: null }, 'MEDINDO_RESULTADO', vencido, AGORA).alertas, [], 'publicada: sem obrigação')
    const semEnvio = alertasDaAmostra({ estado: 'APROVADA', aprovadaEm: new Date(AGORA.getTime() - 8 * DIA) }, 'APROVADA', null, AGORA)
    assert.deepEqual(semEnvio.alertas, ['ATRASADA'])
    assert.match(semEnvio.detalhe[0], /não é regra do TikTok/)
  })
  test('valor econômico: sem comissão vista = null (não zero)', () => {
    assert.equal(valorEconomico({ comissaoObservada: null, sinais: null }), null)
    assert.ok((valorEconomico({ comissaoObservada: 5.54, sinais: null }) ?? 0) > 0)
  })
})

describe('prioridade operacional (fila de execução; não mexe no ranking)', () => {
  const base = (m: Partial<AmostraParaPrioridade>): AmostraParaPrioridade => ({ id: 'x', nomeProduto: 'X', estado: 'RECEBIDA', efetivo: 'CONTEUDO_PENDENTE', prazo: null, alertas: [], comissaoObservada: null, sinais: null, missaoAtiva: false, aderenciaNatal: null, facilidade: 50, papeis: ['PRODUTO_AFILIADO'], ...m })
  test('prazo mais próximo primeiro; depois risco; depois evidência; grátis sozinho não decide', () => {
    const p = (dias: number) => ({ em: new Date(AGORA.getTime() + dias * DIA).toISOString(), confirmado: true, fonte: 'X', aviso: null })
    const fila = priorizarAmostras([
      base({ id: 'tarde', nomeProduto: 'Tarde', prazo: p(10), comissaoObservada: 20 }),
      base({ id: 'cedo', nomeProduto: 'Cedo', prazo: p(2), comissaoObservada: 1 }),
      base({ id: 'semPrazo', nomeProduto: 'SemPrazo', estado: 'PENDENTE_APROVACAO', efetivo: 'PENDENTE_APROVACAO', comissaoObservada: 50 }),
      base({ id: 'rejeitada', nomeProduto: 'R', estado: 'REJEITADA', efetivo: 'REJEITADA' }),
    ])
    assert.deepEqual(fila.map((f) => f.id), ['cedo', 'tarde', 'semPrazo'])
    assert.match(fila[0].porque, /prazo confirmado/)
  })
  test('sem prazo: evidência de venda vence comissão; equipamento operacional aparece no porquê', () => {
    const fila = priorizarAmostras([
      base({ id: 'comissao', estado: 'PENDENTE_APROVACAO', efetivo: 'PENDENTE_APROVACAO', comissaoObservada: 9 }),
      base({ id: 'ranking', estado: 'PENDENTE_APROVACAO', efetivo: 'PENDENTE_APROVACAO', comissaoObservada: 3, sinais: { rankingPosicao: 2, rankingCategoria: 'Mais vendidos' } as never }),
      base({ id: 'suporte', estado: 'PENDENTE_APROVACAO', efetivo: 'PENDENTE_APROVACAO', papeis: ['PRODUTO_AFILIADO', 'EQUIPAMENTO_OPERACIONAL'] }),
    ])
    assert.equal(fila[0].id, 'ranking')
    assert.match(fila.find((f) => f.id === 'suporte')!.porque, /equipamento de produção/)
  })
})

describe('Precisa de você: só com ação humana real', () => {
  test('aguardando vendedor/logística não vira pendência', () => {
    for (const efetivo of ['SOLICITADA', 'PENDENTE_APROVACAO', 'APROVADA', 'ENVIADA'] as const) {
      const ap = acaoEProximo({ estado: efetivo, efetivo, alertas: [], assistidaEstado: null, papeis: ['PRODUTO_AFILIADO'] })
      assert.equal(ap.acaoDaTitular, null, efetivo)
      assert.deepEqual(pendenciasDasAmostras([amostra({ estado: efetivo, efetivo, ...ap })], AGORA), [], efetivo)
    }
  })
  test('recebida sem produção → gravar as cenas; com cartão da assistida pedindo algo → não duplica', () => {
    const ap = acaoEProximo({ estado: 'RECEBIDA', efetivo: 'CONTEUDO_PENDENTE', alertas: ['OBRIGACAO_DE_CONTEUDO'], assistidaEstado: null, papeis: ['PRODUTO_AFILIADO'] })
    assert.equal(ap.acaoDaTitular?.titulo, 'Gravar as cenas')
    const p = pendenciasDasAmostras([amostra({ estado: 'RECEBIDA', efetivo: 'CONTEUDO_PENDENTE', ...ap })], AGORA)
    assert.equal(p.length, 1)
    assert.equal(p[0].origem, 'AMOSTRA')
    const dup = acaoEProximo({ estado: 'RECEBIDA', efetivo: 'CONTEUDO_PENDENTE', alertas: [], assistidaEstado: 'AGUARDANDO_MIDIA', papeis: ['PRODUTO_AFILIADO'] })
    assert.equal(dup.acaoDaTitular, null)
  })
  test('missão: amostras pedidas sem confirmação de contagem → conferir (pedido ≠ missão computada); confirmadas → nada', () => {
    const meta = { id: 'm1', tipo: 'SOLICITAR_AMOSTRAS', situacao: 'NAO_INICIADA', faltam: 3, progresso: 0, diasRestantes: 7, risco: 'BAIXO', recompensaTexto: 'R$ 230' } as never
    assert.equal(pendenciasDasMissoes([meta], [{ missao: { computada: null }, efetivo: 'PENDENTE_APROVACAO' }], AGORA).length, 1)
    assert.equal(pendenciasDasMissoes([meta], [{ missao: { computada: true }, efetivo: 'PENDENTE_APROVACAO' }], AGORA).length, 0)
  })
})

describe('produto operacional + afiliado', () => {
  test('papéis válidos; inválido recusado', () => {
    assert.equal(validarDadosDaAmostra({ nomeProduto: 'Suporte', papeis: ['PRODUTO_AFILIADO', 'EQUIPAMENTO_OPERACIONAL'] }), null)
    assert.match(validarDadosDaAmostra({ nomeProduto: 'X', papeis: ['ESTOQUE'] }) ?? '', /Papel inválido/)
    assert.match(validarDadosDaAmostra({ nomeProduto: 'X', comissaoObservada: 3, comissaoFonte: 'OFICIAL_API' }) ?? '', /não é API oficial/)
  })
  test('o kit do suporte planeja os POV dos outros produtos', () => {
    const k = KITS_DE_AMOSTRAS.find((x) => x.papeis.includes('EQUIPAMENTO_OPERACIONAL'))!
    assert.ok(k.usosOperacionais && k.usosOperacionais.length >= 3)
    assert.ok(k.usosOperacionais!.some((u) => /Hidrabene|depilador|almofadas/i.test(u)))
  })
})

describe('kits: planejamento, não depoimento; claims; Quality Gate', () => {
  test('os 4 kits completos e aprovados pelas checagens', () => {
    assert.equal(KITS_DE_AMOSTRAS.length, 4)
    for (const k of KITS_DE_AMOSTRAS) {
      assert.equal(k.roteiros.length, 3); assert.equal(k.hooks.length, 3); assert.equal(k.ctas.length, 2); assert.equal(k.legendas.length, 2)
      assert.ok(k.cenasParaGravar.length >= 3 && k.riscosDeClaim.length >= 2 && k.disclosure.length > 10)
      const c = checarKit(k)
      assert.deepEqual(c.depoimentos, [], k.produto)
      assert.deepEqual(c.claims, [], k.produto)
      assert.ok(c.qualityGate.every((q) => q.veredito !== 'BLOQUEADO'), k.produto)
    }
  })
  test('o detector pega depoimento; roteiro de uso real fica REVISAR e só libera depois do uso', () => {
    assert.ok(DEPOIMENTO.test('Testei por uma semana'))
    assert.ok(DEPOIMENTO.test('minha pele ficou ótima'))
    assert.ok(!DEPOIMENTO.test('Olha a textura desse protetor FPS 70 de perto.'))
    const h = checarKit(KITS_DE_AMOSTRAS[0])
    assert.equal(h.qualityGate.find((q) => q.id === 'hidrabene-rotina')?.veredito, 'REVISAR')
    const tela = kitParaTela(KITS_DE_AMOSTRAS[0].chave, false)!
    assert.ok(tela.aguardandoUsoReal.includes('hidrabene-rotina'))
    assert.ok(!tela.liberados.includes('hidrabene-rotina'))
  })
  test('Natal preserva a sazonalidade (almofadas: campanha, presente, antes/depois de decoração)', () => {
    const k = KITS_DE_AMOSTRAS.find((x) => /almofadas/i.test(x.produto))!
    assert.equal(k.campanha, 'natal-2026')
    assert.ok(k.roteiros.some((r) => r.estrutura === 'PRESENTE') && k.roteiros.some((r) => r.estrutura === 'ANTES_DEPOIS'))
    assert.ok((avaliarCampanha({ categoria: 'Casa e Decoração', nome: k.produto, preco: null }, AGORA)?.aderencia ?? 0) > 0)
  })
})

describe('evidência manual do app (P2.17.18): proveniência nunca misturada', () => {
  test('observação recusa "API oficial", número negativo e registro vazio', () => {
    assert.match(validarObservacao({ nomeProduto: 'X', fonte: 'OFICIAL_API', comissaoExibida: 2 }) ?? '', /API oficial/)
    assert.match(validarObservacao({ nomeProduto: 'X', fonte: 'TIKTOK_APP_MANUAL', comissaoExibida: -1 }) ?? '', /inválido/)
    assert.match(validarObservacao({ nomeProduto: 'X', fonte: 'TIKTOK_APP_MANUAL' }) ?? '', /ao menos um sinal/)
    assert.equal(validarObservacao({ nomeProduto: 'X', fonte: 'TIKTOK_RANKING_MANUAL', rankingPosicao: 3, rankingCategoria: 'Mais vendidos' }), null)
  })
  test('snapshot vencido não conta; campos vêm do mais recente que tem o dado', () => {
    const l = (dias: number, m: object) => ({ id: String(dias), workspaceId: 'w', chave: 'k', candidatoId: null, nomeProduto: 'X', fonte: 'TIKTOK_APP_MANUAL', observadoEm: new Date(AGORA.getTime() - dias * DIA), validaAte: new Date(AGORA.getTime() + (7 - dias) * DIA), rankingCategoria: null, rankingPosicao: null, vendasExibidas: null, vendasExibidasTexto: null, comissaoExibida: null, comissaoPercentualExibida: null, preco: null, estoque: null, tipoDeAmostra: null, observacao: null, registradoPorUserId: null, createdAt: AGORA, ...m })
    const s = sinaisVigentes([l(1, { comissaoExibida: 5 }), l(3, { rankingPosicao: 4, rankingCategoria: 'Mais vendidos' }), l(10, { vendasExibidas: 999 })], AGORA)!
    assert.equal(s.comissaoValor, 5)
    assert.equal(s.rankingPosicao, 4)
    assert.equal(s.vendas, null, 'vencido não conta')
    assert.equal(sinaisVigentes([l(10, { comissaoExibida: 1 })], AGORA), null)
  })
  test('chave comum entre amostra, observação e candidato', () => {
    assert.equal(chaveDeProduto({ nome: 'Capa de Almofadas de Natal' }), 'nome:capa de almofadas de natal')
    assert.deepEqual(chavesDoCandidato({ providerId: 'tiktok-shop', externalId: '123', nome: 'Á b' }), ['tiktok-shop:123', 'nome:a b'])
    assert.ok(demandaPelaPosicao(1)! > demandaPelaPosicao(10)! && demandaPelaPosicao(null) === null)
  })
  const prod = (id: string, m: Partial<ProdutoParaVisao>): ProdutoParaVisao => ({ id, nome: id, preco: null, precoAnterior: null, descontoPercentual: null, comissaoPercentual: null, comissaoValor: null, vendas: null, avaliacao: null, numeroDeAvaliacoes: null, estoque: null, conversao: null, baseDeEvidencia: 20, aderenciaNatal: null, tiktokShop: true, ajudaMissao: false, facilidadeVideo: 60, nivelDeRisco: 'BAIXO', complianceBloqueante: false, ...m })
  test('Mais vendidos: dado manual é rotulado como snapshot, nunca como "dado oficial"', () => {
    const v = montarVisao('MAIS_VENDIDOS', [prod('oficial', { vendas: 100, fonteVendas: 'OFICIAL_API' }), prod('manual', { vendas: 50, fonteVendas: 'TIKTOK_APP_MANUAL', observadoEm: AGORA.toISOString() }), prod('rank', { rankingPosicao: 3, rankingCategoria: 'Mais vendidos', observadoEm: AGORA.toISOString() }), prod('nada', {})])
    assert.deepEqual(v.map((i) => i.id), ['oficial', 'manual', 'rank', 'nada'])
    assert.match(v[0].porque, /dado oficial/)
    assert.match(v[1].porque, /snapshot manual/)
    assert.doesNotMatch(v[1].porque, /oficial/)
    assert.match(v[2].porque, /#3 em Mais vendidos/)
  })
  test('decisão econômica: mais vendido ≠ melhor; amostra grátis não decide', () => {
    const lista = [
      prod('topVendas', { rankingPosicao: 1, comissaoValor: 0.5, observadoEm: AGORA.toISOString(), facilidadeVideo: 30 }),
      prod('equilibrado', { rankingPosicao: 8, comissaoValor: 6, observadoEm: AGORA.toISOString(), facilidadeVideo: 80, ajudaMissao: true }),
      prod('soGratis', { tipoDeAmostra: 'GRATIS' }),
    ]
    const nota = (id: string) => notaDeOportunidade(lista.find((p) => p.id === id)!, lista).nota
    assert.ok(nota('equilibrado') > nota('topVendas'), 'o mais vendido com comissão irrisória não vence sozinho')
    assert.ok(nota('topVendas') > nota('soGratis'), 'grátis sem evidência não passa na frente')
  })
})

describe('fila comercial, plano das 10, agenda, riscos, caminho, atribuição', () => {
  const ass = (m: object) => ({ id: 'p1', estado: 'AGUARDANDO_MIDIA', nomeProduto: 'Árvore', candidatoId: 'c1', apresentacao: {}, qualityGate: {}, publishId: null, publicadoEm: null, bloqueio: null, updatedAt: AGORA, ...m })
  test('ordem: pronto para publicar → aprovar → gravar → ... → aguardando vendedor; a próxima é algo que NÓS movemos', () => {
    const fila = filaComercial({
      amostras: [amostra({ id: 'am', nomeProduto: 'Hidrabene', comissaoObservada: 5.54 })],
      assistidas: [ass({ id: 'p1' }), ass({ id: 'p2', nomeProduto: 'Pronto', candidatoId: 'c2', estado: 'AGUARDANDO_APROVACAO', apresentacao: { video: { arquivo: 'x.mp4' } } })],
      status: [], agora: AGORA,
    })
    assert.deepEqual(fila.map((f) => f.estado), ['PRONTO_PARA_APROVACAO', 'AGUARDANDO_TERCEIRO', 'BLOQUEADO'])
    assert.equal(proximaExecucao(fila)?.produto, 'Pronto')
  })
  test('plano das 10: nenhum slot futuro tem dado inventado; matriz varia formato/duração/objetivo', () => {
    const plano = planoDasDez({ publicadas: [], emProducao: null, amostras: [] })
    assert.equal(plano.length, 10)
    assert.ok(plano.every((s) => s.real === null && s.situacao === 'PLANEJADA'))
    assert.ok(new Set(MATRIZ_DAS_10.map((m) => m.estrutura)).size >= 9)
    assert.ok(new Set(MATRIZ_DAS_10.map((m) => m.duracao)).size === 2 && new Set(MATRIZ_DAS_10.map((m) => m.objetivo)).size === 3)
  })
  test('agenda: sem material não há horário (dependência); com material, no máx. 2 por dia', () => {
    const fila = [
      { id: '1', produto: 'A', estado: 'AGUARDANDO_TERCEIRO', quem: 'VENDEDOR', acao: '', motivo: '', comissaoPorVenda: null, prazo: null, link: '', origem: 'AMOSTRA' },
      ...[1, 2, 3].map((i) => ({ id: `p${i}`, produto: `P${i}`, estado: 'PRONTO_PARA_PUBLICACAO', quem: 'PATRONO', acao: '', motivo: '', comissaoPorVenda: null, prazo: null, link: '', origem: 'PUBLICACAO' })),
    ] as never
    const ag = agendaSugerida(fila, [], [], AGORA, null)
    const dep = ag.find((i) => i.titulo === 'A')!
    assert.equal(dep.quando, null)
    assert.equal(dep.dependencia, 'Aguardando amostra')
    const datas = ag.filter((i) => i.tipo === 'PUBLICAR').map((i) => i.quando!.slice(0, 10))
    assert.equal(datas.length, 3)
    assert.ok(Object.values(datas.reduce<Record<string, number>>((m, d) => ({ ...m, [d]: (m[d] ?? 0) + 1 }), {})).every((n) => n <= 2))
  })
  test('riscos: só notifica o que é da titular; comissão alterada vira risco do Patrono', () => {
    const r = riscosOperacionais({
      amostras: [amostra({ estado: 'RECEBIDA', efetivo: 'CONTEUDO_PENDENTE', alertas: ['OBRIGACAO_DE_CONTEUDO'], acaoDaTitular: { titulo: 'Gravar as cenas', motivo: '', urgente: false } })],
      metas: [], assistidas: [], resultados: [], natalFim: null, agora: AGORA,
      observacoes: [{ chave: 'k', nomeProduto: 'X', observadoEm: new Date(AGORA.getTime() - 2 * DIA), comissaoExibida: 5, rankingPosicao: null }, { chave: 'k', nomeProduto: 'X', observadoEm: AGORA, comissaoExibida: 3, rankingPosicao: null }],
    })
    assert.equal(r.find((x) => x.tipo === 'AMOSTRA_RECEBIDA_SEM_CONTEUDO')?.notificar, true)
    assert.equal(r.find((x) => x.tipo === 'COMISSAO_ALTERADA')?.notificar, false)
  })
  test('caminho para a 1ª comissão: nada marcado como concluído sem o fato', () => {
    const c = caminhoParaPrimeiraComissao({ contaAfiliadaConfirmada: null, produtosEmJogo: 0, amostrasACaminho: 4, amostrasRecebidas: 0, missaoProdutosAdicionados: 0, midiaAutorizada: false, videoGerando: false, videoGerado: false, qgAprovado: false, aguardandoAprovacao: false, aprovado: false, publicado: null, views: null, cliques: null, vendas: null, comissao: null, canalAutomatico: false })
    assert.equal(c.filter((e) => e.estado === 'CONCLUIDO').length, 0)
    assert.equal(c.find((e) => e.etapa === 'Mídia')?.estado, 'EM_ANDAMENTO')
    assert.equal(c.find((e) => e.etapa === 'Produto marcado')?.estado, 'PRECISA_DE_VOCE')
    const conta = caminhoParaPrimeiraComissao({ contaAfiliadaConfirmada: { em: AGORA.toISOString(), fonte: 'confirmado pela titular' }, produtosEmJogo: 1, amostrasACaminho: 0, amostrasRecebidas: 0, missaoProdutosAdicionados: null, midiaAutorizada: false, videoGerando: false, videoGerado: false, qgAprovado: false, aguardandoAprovacao: false, aprovado: false, publicado: null, views: null, cliques: null, vendas: null, comissao: null, canalAutomatico: false })
    assert.match(conta[0].detalhe, /sem confirmação por API/)
  })
  test('atribuição: correlação nunca vira certeza', () => {
    const v = [{ produtoId: 'p', publicadoEm: new Date(AGORA.getTime() - 3 * DIA) }]
    assert.equal(classificarAtribuicao({ origem: 'RESULTADO_DO_VIDEO', data: AGORA }, v).classe, 'CONFIRMADA')
    assert.equal(classificarAtribuicao({ origem: 'VENDA', clickEventId: 'ck', data: AGORA }, v).classe, 'CONFIRMADA')
    assert.equal(classificarAtribuicao({ origem: 'VENDA', produtoId: 'p', data: AGORA }, v).classe, 'PROVAVEL')
    assert.equal(classificarAtribuicao({ origem: 'VENDA', produtoId: 'p', data: AGORA }, [...v, { produtoId: 'p', publicadoEm: new Date(AGORA.getTime() - DIA) }]).classe, 'DESCONHECIDA')
    assert.equal(classificarAtribuicao({ origem: 'VENDA', produtoId: 'p', data: AGORA }, [{ produtoId: 'p', publicadoEm: new Date(AGORA.getTime() - 30 * DIA) }]).classe, 'DESCONHECIDA')
    assert.equal(classificarAtribuicao({ origem: 'VENDA', data: AGORA }, v).classe, 'DESCONHECIDA')
  })
})

describe('coletor de métricas oficiais (P1 pós-aprovação): pronto e desligado', () => {
  test('desligado por padrão', () => {
    assert.equal(configuracaoDoColetor({}).ligado, false)
    assert.equal(configuracaoDoColetor({ TIKTOK_METRICAS_AUTOMATICAS: 'true' }).ligado, true)
  })
  test('só número vira número; manual preservado marca origem mista', () => {
    assert.deepEqual(lerMetricas({ data: { videos: [{ id: 7, view_count: 120 }, { id: '8', view_count: 'x' }, { view_count: 5 }] } }), [{ postId: '7', views: 120 }, { postId: '8', views: null }])
    assert.deepEqual(lerMetricas(null), [])
    assert.equal(origemDepoisDaColeta({ origemMetricas: 'MANUAL', cliquesProduto: 3, vendas: null, comissao: null, retencaoMedia: null }), 'API_TIKTOK+MANUAL')
    assert.equal(origemDepoisDaColeta({ origemMetricas: 'MANUAL', cliquesProduto: null, vendas: null, comissao: null, retencaoMedia: null }), 'API_TIKTOK')
  })
})

const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')

describe('banco de TESTE: amostra → candidato → produção na frente; missão sem contagem indevida; coletor', { skip: !TEM_BANCO ? 'exige banco de TESTE' : false }, () => {
  let prisma: typeof import('../lib/prisma').prisma
  let AM: typeof import('../lib/amostras')
  let A: typeof import('../lib/publicacao-assistida')
  let OB: typeof import('../lib/observacoes-de-mercado')
  let COL: typeof import('../lib/coletor-de-metricas-tiktok')
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  const PREFIXO = 'Conta de Teste — '
  const marca = `r90-${Date.now()}`
  let ws = ''
  let user = ''

  before(async () => {
    ;[{ prisma }, AM, A, OB, COL, { limparWorkspaceDeTeste: limpar }] = await Promise.all([
      import('../lib/prisma'), import('../lib/amostras'), import('../lib/publicacao-assistida'), import('../lib/observacoes-de-mercado'), import('../lib/coletor-de-metricas-tiktok'), import('./_limpar-workspace-de-teste'),
    ])
    ws = (await prisma.workspace.create({ data: { name: `${PREFIXO}amostras P2.17.17`, ownerId: marca }, select: { id: true } })).id
    user = (await prisma.user.create({ data: { email: `${marca}@teste.local`, name: 'U', password: 'x', workspaceId: ws }, select: { id: true } })).id
    await prisma.candidatoDeProduto.create({
      data: {
        workspaceId: ws, chaveDeOrigem: `${marca}-arvore`, fonte: 'USER_PROVIDED', nome: 'FIXTURE Árvore sem mídia', categoria: 'Casa e Decoração', preco: 199, providerId: 'tiktok-shop', externalId: '900000000000000901',
        score: 90, baseDeEvidencia: 90, confianca: 'SEM_HISTORICO_REAL', status: 'APRESENTADO', coletadoEm: AGORA, validoAte: new Date('2027-01-01'), motivosPositivos: [], riscos: [], desconhecidos: [], porqueDestaPosicao: [], nivelDeRisco: 'BAIXO',
      },
    })
    await prisma.metaTikTokShop.create({ data: { workspaceId: ws, nome: 'Amostras solicitadas', tipo: 'SOLICITAR_AMOSTRAS', inicio: new Date('2026-10-01'), fim: new Date('2026-10-20T23:59:00-03:00'), quantidadeExigida: 3, quantidadeRealizada: 0 } })
  })
  after(async () => {
    await limpar(prisma, ws, PREFIXO)
    await prisma?.$disconnect()
  })

  test('tabelas novas com RLS e sem acesso público', async () => {
    for (const t of ['AmostraTikTokShop', 'ObservacaoDeMercado']) {
      const [l] = await prisma.$queryRaw<{ rls: boolean; acesso: boolean }[]>`
        select c.relrowsecurity as rls,
          (has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE')) as acesso
        from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = ${t}`
      assert.deepEqual([l.rls, l.acesso], [true, false], t)
    }
  })

  let amostraId = ''
  test('registrar não duplica; cria o candidato no mesmo motor; data desconhecida fica null', async () => {
    const d = { nomeProduto: 'Capa de almofadas de Natal', categoria: 'Casa e Decoração', tipo: 'GRATIS', estado: 'PENDENTE_APROVACAO' as const, comissaoObservada: 2.84 }
    const r1 = await AM.registrarAmostra({ workspaceId: ws, userId: user, dados: d, agora: AGORA })
    const r2 = await AM.registrarAmostra({ workspaceId: ws, userId: user, dados: { ...d, nomeProduto: 'Capa de Almofadas de NATAL' }, agora: AGORA })
    assert.equal(r1.criada, true)
    assert.equal(r2.criada, false)
    assert.equal(r2.amostra.id, r1.amostra.id)
    assert.equal(await prisma.amostraTikTokShop.count({ where: { workspaceId: ws } }), 1)
    assert.equal(r1.amostra.solicitadaEm, null)
    assert.equal(r1.amostra.comissaoFonte, 'TIKTOK_APP_MANUAL')
    const c = await prisma.candidatoDeProduto.findUniqueOrThrow({ where: { id: r1.amostra.candidatoId! } })
    assert.equal(c.providerId, 'tiktok-shop')
    assert.equal(c.comissaoValor, null, 'comissão vista no app NÃO vira dado do candidato (fica na observação)')
    amostraId = r1.amostra.id
  })

  test('missão: registrar/aprovar não conta; "o app contou" conta UMA vez (máximo, nunca soma em dobro)', async () => {
    await AM.aplicarEventoNaAmostra({ workspaceId: ws, userId: user, id: amostraId, evento: 'APROVADA', agora: AGORA })
    let meta = await prisma.metaTikTokShop.findFirstOrThrow({ where: { workspaceId: ws } })
    assert.equal(meta.quantidadeRealizada, 0)
    await AM.marcarMissaoComputada({ workspaceId: ws, userId: user, id: amostraId, agora: AGORA })
    await AM.marcarMissaoComputada({ workspaceId: ws, userId: user, id: amostraId, agora: AGORA })
    meta = await prisma.metaTikTokShop.findFirstOrThrow({ where: { workspaceId: ws } })
    assert.equal(meta.quantidadeRealizada, 1)
    await prisma.metaTikTokShop.update({ where: { id: meta.id }, data: { quantidadeRealizada: 2 } }) // print do app já dizia 2
    const outra = await AM.registrarAmostra({ workspaceId: ws, userId: user, dados: { nomeProduto: 'Kit Depilador Elétrico 4 em 1', tipo: 'GRATIS' }, agora: AGORA })
    await AM.marcarMissaoComputada({ workspaceId: ws, userId: user, id: outra.amostra.id, agora: AGORA })
    assert.equal((await prisma.metaTikTokShop.findFirstOrThrow({ where: { workspaceId: ws } })).quantidadeRealizada, 2, 'max(2, 2 computadas) = 2')
  })

  test('produção: amostra recebida passa na frente de publicação que só espera mídia de outro produto; liga e traz as cenas do kit', async () => {
    const arvore = await A.prepararProximaPublicacao({ workspaceId: ws, userId: user, agora: AGORA })
    assert.equal(arvore.estado, 'AGUARDANDO_MIDIA')
    assert.match(arvore.nomeProduto, /Árvore/)
    await AM.aplicarEventoNaAmostra({ workspaceId: ws, userId: user, id: amostraId, evento: 'RECEBIDA', agora: AGORA })
    const nova = await A.prepararProximaPublicacao({ workspaceId: ws, userId: user, agora: AGORA })
    assert.notEqual(nova.id, arvore.id)
    assert.match(nova.nomeProduto, /almofadas/i)
    assert.match(nova.motivoEscolha, /Amostra recebida/)
    const ap = nova.apresentacao as { cenasParaGravar: string[] | null }
    assert.ok(ap.cenasParaGravar && ap.cenasParaGravar.length >= 3)
    const am = await prisma.amostraTikTokShop.findUniqueOrThrow({ where: { id: amostraId } })
    assert.equal(am.publicacaoAssistidaId, nova.id)
    // Lista: produção derivada, prazo ESTIMADO (não confirmado), pendência não duplicada (é do cartão da assistida).
    const [l] = (await AM.listarAmostras(ws, AGORA)).filter((x) => x.id === amostraId)
    assert.equal(l.efetivo, 'CONTEUDO_PENDENTE')
    assert.equal(l.prazo?.confirmado, false)
    assert.equal(l.acaoDaTitular, null)
  })

  test('observação manual: grava como snapshot com validade; "API oficial" recusada', async () => {
    const o = await OB.registrarObservacao({ workspaceId: ws, userId: user, dados: { nomeProduto: 'Capa de almofadas de Natal', fonte: 'TIKTOK_RANKING_MANUAL', rankingCategoria: 'Mais vendidos', rankingPosicao: 5 }, agora: AGORA })
    assert.equal(o.validaAte.getTime() - o.observadoEm.getTime(), OB.VALIDADE_DA_OBSERVACAO_DIAS * DIA)
    await assert.rejects(OB.registrarObservacao({ workspaceId: ws, userId: user, dados: { nomeProduto: 'X', fonte: 'OFICIAL_API', comissaoExibida: 1 } }), /API oficial/)
  })

  test('coletor: desligado não chama nada; ligado sem conexão não inventa; com fixture grava views e preserva o manual', async () => {
    const r = await prisma.videoTikTokResultado.create({ data: { workspaceId: ws, estrutura: 'POV', gancho: 'g', cta: 'A', duracaoSegundos: 15, publicadoEm: new Date(AGORA.getTime() - 2 * DIA), postId: '7000000000000000001', origemMetricas: 'MANUAL', cliquesProduto: 4 } })
    let chamadas = 0
    const fetcher = (async () => { chamadas++; return new Response(JSON.stringify({ data: { videos: [{ id: '7000000000000000001', view_count: 1234 }] } }), { status: 200 }) }) as typeof fetch
    assert.equal((await COL.coletarMetricasOficiais({ workspaceId: ws, fetcher, env: {}, agora: AGORA })).ligado, false)
    assert.equal(chamadas, 0)
    const env = { TIKTOK_METRICAS_AUTOMATICAS: 'true' }
    assert.equal((await COL.coletarMetricasOficiais({ workspaceId: ws, fetcher, env, agora: AGORA, obterToken: async () => null })).semConexao, true)
    assert.equal((await COL.coletarMetricasOficiais({ workspaceId: ws, fetcher, env, agora: AGORA, obterToken: async () => ({ accessToken: 't', openId: 'o', scope: 'user.info.basic' }) })).semEscopo, true)
    assert.equal(chamadas, 0)
    const ok = await COL.coletarMetricasOficiais({ workspaceId: ws, fetcher, env, agora: AGORA, obterToken: async () => ({ accessToken: 't', openId: 'o', scope: 'user.info.basic,video.list' }) })
    assert.equal(ok.atualizados, 1)
    const depois = await prisma.videoTikTokResultado.findUniqueOrThrow({ where: { id: r.id } })
    assert.deepEqual([depois.views, depois.cliquesProduto, depois.origemMetricas], [1234, 4, 'API_TIKTOK+MANUAL'])
  })
})
