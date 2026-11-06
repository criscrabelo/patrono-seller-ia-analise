/**
 * P2.15.1 — Command Center legível: topo fiel ao estado real, UMA próxima
 * ação, fila por prioridade, card de Integrações com o estado real,
 * decisões em linguagem simples e agrupadas, Copilot sem jargão.
 *
 * Só funções puras: sem banco, sem rede. Custo R$ 0,00.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  estadoDoPatrono,
  proximaMelhorAcao,
  resumoDasIntegracoes,
  saudeDasIntegracoes,
  decisoesLegiveis,
  agruparRepetidas,
  frasesDoEvento,
} from '../lib/central'
import { porPrioridade, rotulos } from '../lib/precisa-de-voce'
import { avaliarEvidencia, exigeEvidencia, CHAVE_TIKTOK_SHOP } from '../lib/tiktok-shop-evidencia'
import { explicarCandidato } from '../lib/copilot'

const AGORA = new Date('2026-10-10T15:00:00Z')
const DIA = 86_400_000
const base = { globalDesligado: false, safeMode: false, pausado: false, modo: 'MANUAL', pendencias: 0, ultimoCiclo: null }

describe('P2.15.1 — topo do Command Center', () => {
  test('sem análise ainda: "pronto para trabalhar", nunca "trabalhando"', () => {
    const e = estadoDoPatrono({ ...base, pausado: true })
    assert.equal(e.titulo, 'Patrono pronto para trabalhar')
    assert.match(e.frase, /Posso analisar oportunidades agora/)
    assert.match(e.nota, /Publicação automática desligada por você/)
    assert.doesNotMatch(`${e.titulo} ${e.frase}`, /trabalhando para você/)
  })

  test('análise recente: "em operação"; com pendência, pede a decisão', () => {
    assert.equal(estadoDoPatrono({ ...base, ultimoCiclo: { estado: 'CONCLUIDO', ha: 60_000 } }).titulo, 'Patrono em operação')
    assert.match(estadoDoPatrono({ ...base, pendencias: 1, ultimoCiclo: { estado: 'CONCLUIDO', ha: 60_000 } }).frase, /só você pode resolver/)
  })

  test('Safe Mode, desligamento geral e falha nunca aparecem como "em operação"', () => {
    assert.equal(estadoDoPatrono({ ...base, safeMode: true, ultimoCiclo: { estado: 'CONCLUIDO', ha: 1 } }).titulo, 'Patrono em modo de segurança')
    assert.equal(estadoDoPatrono({ ...base, globalDesligado: true, safeMode: true }).titulo, 'Patrono desligado')
    assert.equal(estadoDoPatrono({ ...base, ultimoCiclo: { estado: 'FALHOU', ha: 1 } }).tom, 'atencao')
  })

  test('sem pausa, a nota não fala em pausa', () => {
    assert.doesNotMatch(estadoDoPatrono(base).nota, /desligada/)
  })
})

describe('P2.15.1 — próxima ação: uma só, pendência primeiro', () => {
  test('pendência vence tudo e vira botão direto', () => {
    const a = proximaMelhorAcao({ pendencias: 1, bloqueado: false, ultimoCicloHa: null, integracoesComProblema: 2, principal: 'Escolher "Boneca"?' })
    assert.deepEqual([a.link, a.botao, a.texto], ['/precisa-de-voce', 'Ver agora', 'Escolher "Boneca"?'])
    assert.equal(proximaMelhorAcao({ pendencias: 3, bloqueado: false, ultimoCicloHa: 1, integracoesComProblema: 0 }).botao, 'Ver itens')
    assert.equal(proximaMelhorAcao({ pendencias: 2, bloqueado: false, ultimoCicloHa: 1, integracoesComProblema: 0 }).texto, '2 itens precisam de você.')
  })

  test('sem pendência e sem análise: o botão principal é "Rodar agora"', () => {
    const a = proximaMelhorAcao({ pendencias: 0, bloqueado: false, ultimoCicloHa: null, integracoesComProblema: 0 })
    assert.deepEqual([a.comando, a.botao], ['rodar', 'Rodar agora'])
  })

  test('em dia: nenhum botão principal', () => {
    assert.equal(proximaMelhorAcao({ pendencias: 0, bloqueado: false, ultimoCicloHa: 1, integracoesComProblema: 0 }).botao, null)
  })
})

describe('P2.15.1 — fila "Precisa de você" por prioridade', () => {
  test('alto, médio, baixo; no mesmo risco, o mais antigo primeiro', () => {
    const itens = [
      { id: 'b1', risco: 'BAIXO', criadoEm: '2026-10-10T10:00:00Z' },
      { id: 'a2', risco: 'ALTO', criadoEm: '2026-10-10T12:00:00Z' },
      { id: 'm1', risco: 'MEDIO', criadoEm: '2026-10-10T09:00:00Z' },
      { id: 'a1', risco: 'ALTO', criadoEm: '2026-10-10T11:00:00Z' },
    ]
    assert.deepEqual(porPrioridade(itens).map((i) => i.id), ['a1', 'a2', 'm1', 'b1'])
  })
})

describe('P2.15.1 — card de Integrações com o estado real', () => {
  test('nenhuma linha: "0 de 7" e diz o que isso significa', () => {
    const r = resumoDasIntegracoes([])
    assert.deepEqual([r.conectadas, r.total, r.comProblema], [0, 7, 0])
    assert.match(r.mensagem, /Nenhum canal conectado ainda/)
  })

  test('desconectada não é problema nem aparece; vencendo e expirada aparecem primeiro', () => {
    const s = saudeDasIntegracoes([
      { plataforma: 'instagram', status: 'conectado', tokenExpiry: new Date(AGORA.getTime() + 50 * DIA) },
      { plataforma: 'tiktok', status: 'desconectado', tokenExpiry: null },
      { plataforma: 'hotmart', status: 'conectado', tokenExpiry: new Date(AGORA.getTime() - DIA) },
      { plataforma: 'tiktok-shop', status: 'conectado', tokenExpiry: null },
    ], AGORA)
    const r = resumoDasIntegracoes(s)
    assert.equal(r.total, 8) // 7 canais da tela + TikTok Shop
    assert.equal(r.conectadas, 2) // instagram + tiktok-shop (hotmart expirou)
    assert.equal(r.comProblema, 1)
    assert.deepEqual(r.destaque.map((d) => d.nome), ['Hotmart', 'Instagram', 'TikTok Shop'])
    assert.match(r.mensagem, /1 canal precisa de atenção/)
  })
})

describe('P2.15.1 — decisões em linguagem simples', () => {
  const curadoria = (id: string, min: number, top = 'Boneca Fada') => ({
    id,
    tipo: 'CURADORIA_APRESENTACAO',
    ator: 'PATRONO',
    decisao: 'Apresentar 3 candidato(s).',
    explicacao: [],
    entradas: { avaliados: 21, apresentados: [{ nome: top }, { nome: 'Colchão' }, { nome: 'Garrafa' }] },
    criadoEm: new Date(AGORA.getTime() - min * 60_000),
  })

  test('"Apresentar 3 candidato(s)" vira frase de gente, e repetições se juntam', () => {
    const l = decisoesLegiveis([curadoria('1', 5), curadoria('2', 9), curadoria('3', 12)])
    assert.equal(l.length, 1)
    assert.equal(l[0].texto, 'Analisei 21 produtos e selecionei 3 oportunidades.')
    assert.equal(l[0].vezes, 3)
    assert.equal(l[0].detalhes[0], 'Mantive “Boneca Fada” em 1º lugar nas 3 análises.')
    assert.ok(l[0].detalhes.includes('Nenhuma ação sua foi necessária.'))
  })

  test('líder diferente não se junta; limite de linhas respeitado', () => {
    const l = decisoesLegiveis([curadoria('1', 1, 'A'), curadoria('2', 2, 'B'), curadoria('3', 3, 'C'), curadoria('4', 4, 'D'), curadoria('5', 5, 'E')], 4)
    assert.equal(l.length, 4)
    assert.equal(l[0].detalhes[0], 'Em 1º lugar: A.')
  })

  test('escolhas e Safe Mode em primeira pessoa', () => {
    const [titular, patrono, bloqueio, safe] = decisoesLegiveis([
      { id: 'a', tipo: 'ESCOLHA_DE_PRODUTO', ator: 'TITULAR', decisao: 'Escolheu "Boneca".', explicacao: [], entradas: {}, criadoEm: AGORA },
      { id: 'b', tipo: 'ESCOLHA_DE_PRODUTO', ator: 'PATRONO', decisao: 'O Patrono escolheu "Colchão" (permitido pela política).', explicacao: [], entradas: {}, criadoEm: AGORA },
      { id: 'c', tipo: 'ESCOLHA_DE_PRODUTO', ator: 'PATRONO', decisao: 'Não escolheu "X": bloqueado pela política.', explicacao: ['Preço acima do limite.'], entradas: {}, criadoEm: AGORA },
      { id: 'd', tipo: 'SAFE_MODE', ator: 'TITULAR', decisao: 'Safe Mode ligado.', explicacao: ['Pedido da titular.'], entradas: {}, criadoEm: AGORA },
    ])
    assert.equal(titular.texto, 'Você escolheu “Boneca”.')
    assert.equal(patrono.texto, 'Escolhi “Colchão” dentro das suas regras.')
    assert.match(bloqueio.texto, /^Não escolhi “X”/)
    assert.equal(safe.texto, 'Entrei em modo de segurança.')
  })

  test('P2.15.2: aprovação de escolha não repete; tarefa resolvida/dispensada vira frase', () => {
    const l = decisoesLegiveis([
      { id: 'e', tipo: 'ESCOLHA_DE_PRODUTO', ator: 'TITULAR', decisao: 'Escolheu "Boneca".', explicacao: [], entradas: {}, criadoEm: AGORA },
      { id: 'a', tipo: 'APROVACAO', ator: 'TITULAR', decisao: 'APROVADA.', explicacao: [], entradas: { pedidoTipo: 'ESCOLHER_PRODUTO', titulo: 'Escolher "Boneca"?' }, criadoEm: AGORA },
      { id: 't', tipo: 'APROVACAO', ator: 'TITULAR', decisao: 'REJEITADA.', explicacao: [], entradas: { pedidoTipo: 'EXCECAO', titulo: 'Liberar a descoberta automática no TikTok Shop' }, criadoEm: AGORA },
      { id: 'v', tipo: 'APROVACAO', ator: 'TITULAR', decisao: 'APROVADA.', explicacao: [], entradas: null, criadoEm: AGORA },
    ])
    assert.deepEqual(l.map((d) => d.texto), [
      'Você escolheu “Boneca”.',
      'Você dispensou: Liberar a descoberta automática no TikTok Shop.',
      'Você aprovou um pedido.',
    ])
  })

  test('evento com chaves redigidas ainda dá frase completa (usa a contagem)', () => {
    assert.equal(frasesDoEvento({ tipo: 'CANDIDATES_PRESENTED', payload: { avaliados: 21, apresentados: 3, chaves: '[redigido]' } }), 'Analisei 21 produtos e selecionei 3 oportunidades.')
    assert.equal(frasesDoEvento({ tipo: 'CANDIDATES_PRESENTED', payload: { avaliados: 21, chaves: '[redigido]' } }), 'Analisei 21 produtos e selecionei as melhores oportunidades.')
  })

  test('atividade repetida vira uma linha com contagem', () => {
    const g = agruparRepetidas([
      { quando: '3', texto: 'x' },
      { quando: '2', texto: 'x' },
      { quando: '1', texto: 'y' },
    ])
    assert.deepEqual(g.map((l) => [l.texto, l.vezes, l.quando]), [['x', 2, '3'], ['y', 1, '1']])
  })
})

describe('P2.15.1 — Copilot sem jargão', () => {
  test('"por que este produto?" não mostra nota, pesos nem percentuais', () => {
    const linhas = explicarCandidato({
      posicao: 1,
      nome: 'Boneca Fada',
      confianca: 'SEM_HISTORICO_REAL',
      porqueDestaPosicao: [
        '1º de 21 elegível(is), score 32 (confiança SEM_HISTORICO_REAL). Empate técnico: não há evidência suficiente.',
        'Capacidade de automatizar: 28/100.',
        'Perfil: 50/80 · cobertura 63%.',
        'Afinidade da titular (comprado pela titular) é bônus de aderência, não prova de demanda.',
        'sem base real: 0 clique(s) medido(s), mínimo 5',
        'Produto sem imagem cadastrada — o vídeo usa fundo neutro e não exibe o produto.',
      ],
      riscos: ['Mídia sem direito de uso verificado. Produto sem imagem cadastrada — o vídeo usa fundo neutro e não exibe o produto.', 'Preço sem verificação recente.'],
    }, 3)
    assert.equal(linhas[0], '“Boneca Fada” está em 1º lugar entre as 3 oportunidades que separei.')
    assert.ok(linhas.some((l) => /empatado/.test(l)))
    assert.ok(linhas.some((l) => /Você já comprou este produto/.test(l)))
    assert.equal(linhas.at(-1), 'Pontos de atenção: Mídia sem direito de uso verificado; Preço sem verificação recente.')
    assert.match(explicarCandidato({ posicao: 1, nome: 'X', confianca: null, porqueDestaPosicao: [], riscos: [] }, 1)[0], /é a única oportunidade/)
    for (const l of linhas) assert.doesNotMatch(l, /score|\/100|\d+%|SEM_HISTORICO_REAL|elegível/, l)
  })
})

describe('P2.15.3 — TikTok Shop só sai com evidência real', () => {
  const ok = { plataforma: 'tiktok-shop', status: 'conectado', temToken: true, tokenExpiry: new Date(AGORA.getTime() + DIA) }
  test('evidência: conectada, com token e válida — nada menos', () => {
    assert.ok(avaliarEvidencia([ok], AGORA))
    assert.ok(avaliarEvidencia([{ ...ok, plataforma: 'tiktok-shop-creator', tokenExpiry: null }], AGORA))
    assert.equal(avaliarEvidencia([{ ...ok, status: 'desconectado' }], AGORA), null)
    assert.equal(avaliarEvidencia([{ ...ok, temToken: false }], AGORA), null)
    assert.equal(avaliarEvidencia([{ ...ok, tokenExpiry: new Date(AGORA.getTime() - 1) }], AGORA), null)
    assert.equal(avaliarEvidencia([{ ...ok, plataforma: 'tiktok' }], AGORA), null)
    assert.equal(avaliarEvidencia([], AGORA), null)
  })
  test('rótulos: "Ver como fazer" e "Agora não"; outras exceções seguem com "Já resolvi"', () => {
    assert.ok(exigeEvidencia(CHAVE_TIKTOK_SHOP))
    assert.deepEqual(rotulos('EXCECAO', CHAVE_TIKTOK_SHOP), { aprovar: 'Ver como fazer', rejeitar: 'Agora não' })
    assert.deepEqual(rotulos('EXCECAO', 'excecao:catalogo-vazio'), { aprovar: 'Já resolvi', rejeitar: 'Ignorar' })
  })
  test('histórico da resolução real em linguagem simples', () => {
    const [d] = decisoesLegiveis([{ id: 'r', tipo: 'RESOLUCAO_POR_EVIDENCIA', ator: 'SISTEMA', decisao: 'Resolvido por evidência.', explicacao: ['Integração tiktok-shop conectada, com acesso válido.'], entradas: { titulo: 'Liberar a descoberta automática no TikTok Shop' }, criadoEm: AGORA }])
    assert.equal(d.texto, 'Confirmei a conexão e tirei da fila: Liberar a descoberta automática no TikTok Shop.')
  })
})
