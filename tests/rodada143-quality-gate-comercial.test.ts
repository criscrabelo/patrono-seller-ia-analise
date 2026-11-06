/**
 * P2.44 — Quality Gate COMERCIAL (puro). Cada critério detecta o defeito que deve detectar e sugere a correção;
 * o ciclo é limitado e nunca aprova sozinho para publicação.
 *   node node_modules/tsx/dist/cli.mjs --test tests/rodada143-quality-gate-comercial.test.ts
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { avaliarMontagem, proximoPasso, MAX_TENTATIVAS, type MontagemParaAvaliar, type Mostra } from '../lib/quality-gate-comercial'

/** Montagem de referência BOA (como a v6): gancho-pergunta, produto nomeado, ritmo, trilha audível, CTA no fim. */
const boa = (): MontagemParaAvaliar => ({
  duracao: 25, produto: { nome: 'Livro Emocionário', categoria: 'Livros' }, produtoMarcado: false,
  falas: [
    { ini: 0.1, fim: 3.9, texto: 'Seu filho já sentiu alguma coisa e não soube explicar o quê?', papel: 'GANCHO', pede: ['CAPA'] },
    { ini: 4.3, fim: 8.3, texto: 'Esse é o Emocionário, um dicionário ilustrado de emoções.', papel: 'APRESENTACAO', pede: ['PAGINA_COM_LOGO'] },
    { ini: 8.6, fim: 13.6, texto: 'Cada emoção ganha nome, ilustração e uma explicação simples.', papel: 'DEMONSTRACAO', pede: ['FOLHEANDO'] },
    { ini: 13.9, fim: 18, texto: 'Um jeito leve de conversar sobre o que a gente sente.', papel: 'PROPOSTA', pede: ['MAOS'] },
    { ini: 18.3, fim: 24.4, texto: 'Se quiser conhecer, o livro está na sacolinha.', papel: 'CTA', pede: ['CAPA'] },
  ],
  tomadas: [
    { ini: 0, fim: 4.2, origem: 'a', origemIni: 0, mostra: ['CAPA', 'MAOS'] as Mostra[], movimento: 0.012, zoom: 1.05 },
    { ini: 4.2, fim: 8.4, origem: 'b', origemIni: 0, mostra: ['PAGINA_COM_LOGO', 'MAOS'] as Mostra[], movimento: 0.014, zoom: 1 },
    { ini: 8.4, fim: 11.4, origem: 'b', origemIni: 18, mostra: ['FOLHEANDO', 'ILUSTRACAO_INTERNA'] as Mostra[], movimento: 0.014, zoom: 1 },
    { ini: 11.4, fim: 14.4, origem: 'c', origemIni: 1, mostra: ['CONTRACAPA', 'FOLHEANDO'] as Mostra[], movimento: 0.009, zoom: 1.06 },
    { ini: 14.4, fim: 18.6, origem: 'a', origemIni: 7, mostra: ['MAOS', 'FOLHA_DE_ROSTO'] as Mostra[], movimento: 0.010, zoom: 1 },
    { ini: 18.6, fim: 20.8, origem: 'c', origemIni: 9, mostra: ['CONTRACAPA'] as Mostra[], movimento: 0.009, zoom: 1 },
    { ini: 20.8, fim: 25, origem: 'b', origemIni: 0.0, mostra: ['CAPA', 'MAOS'] as Mostra[], movimento: 0.011, zoom: 1.06 },
  ].map((t, i) => (i === 6 ? { ...t, origem: 'd' } : t)),
  textos: [
    { ini: 0.1, fim: 4.1, texto: 'Seu filho já sentiu…', tipo: 'LEGENDA', topo: 1118, base: 1400 },
    { ini: 4.3, fim: 8.4, texto: 'Esse é o Emocionário,', tipo: 'LEGENDA', topo: 1316, base: 1400 },
    { ini: 8.6, fim: 9.4, texto: 'ternura', tipo: 'DESTAQUE', topo: 330, base: 474 },
  ],
  audio: { lufs: -14.3, picoDb: -1.5, vozSobreTrilhaDb: 12, trilha: 'PROPRIA', vozSintetica: true, similaridadeDaVoz: 0.92 },
})

describe('Quality Gate Comercial (puro)', () => {
  test('montagem de referência boa: APRESENTAR_A_TITULAR, com avisos de publicação (marcar produto, rótulo IA, direitos)', () => {
    const a = avaliarMontagem(boa())
    assert.equal(a.veredito, 'APRESENTAR_A_TITULAR', JSON.stringify(a.criterios))
    assert.ok(a.notaGeral >= 90)
    assert.ok(a.avisosDePublicacao.some((x) => /MARCADO/.test(x)))
    assert.ok(a.avisosDePublicacao.some((x) => /gerado por IA/.test(x)))
    assert.ok(a.avisosDePublicacao.some((x) => /autoriza/.test(x)))
  })
  test('abertura fraca (frase genérica, sem pergunta) é detectada e vira correção REESCREVER_FALA', () => {
    const m = boa(); m.falas[0] = { ...m.falas[0], texto: 'Olha que livro interessante!' }
    const a = avaliarMontagem(m)
    assert.ok(a.criterios.aberturaForte.nota < 80)
    assert.ok(a.criterios.curiosidade.nota < 70)
    assert.ok(a.correcoes.some((c) => c.tipo === 'REESCREVER_FALA'))
  })
  test('cena parada longa e repetição do mesmo trecho', () => {
    const m = boa(); m.tomadas[5] = { ...m.tomadas[5], ini: 14.4, fim: 20.8, movimento: 0.005, zoom: 1 }; m.tomadas.splice(4, 1)
    m.tomadas.push({ ini: 25, fim: 25.1, origem: 'a', origemIni: 0.5, mostra: ['CAPA'] as Mostra[], movimento: 0.02, zoom: 1 })
    const a = avaliarMontagem(m)
    assert.ok(a.criterios.ritmo.diagnostico.some((d) => /parada/.test(d)))
    assert.ok(a.correcoes.some((c) => c.tipo === 'ENCURTAR_TOMADA'))
  })
  test('trecho repetido da mesma origem é apontado', () => {
    const m = boa(); m.tomadas[6] = { ...m.tomadas[6], origem: 'a', origemIni: 0.5 }
    assert.ok(avaliarMontagem(m).criterios.ritmo.diagnostico.some((d) => /repetem/.test(d)))
  })
  test('trilha: inaudível (>18 dB abaixo), alta demais (<10 dB) e sem licença (bloqueio)', () => {
    const m = boa(); m.audio.vozSobreTrilhaDb = 23
    assert.ok(avaliarMontagem(m).criterios.trilha.diagnostico.some((d) => /inaudível/.test(d)))
    m.audio.vozSobreTrilhaDb = 6
    assert.ok(avaliarMontagem(m).criterios.trilha.diagnostico.some((d) => /acima da trilha/.test(d)))
    m.audio.trilha = 'SEM_LICENCA'
    assert.equal(avaliarMontagem(m).veredito, 'BLOQUEADO')
  })
  test('promessa infantil/terapêutica bloqueia; "garanta o seu" não é promessa', () => {
    const m = boa(); m.falas[3] = { ...m.falas[3], texto: 'Comprovado: desenvolve a inteligência emocional do seu filho.' }
    assert.equal(avaliarMontagem(m).veredito, 'BLOQUEADO')
    const ok = boa(); ok.falas[4] = { ...ok.falas[4], texto: 'Garanta o seu na sacolinha.' }
    assert.notEqual(avaliarMontagem(ok).veredito, 'BLOQUEADO')
  })
  test('direitos autorais: zoom sobre ilustração, texto interno legível e excesso de ilustração', () => {
    const m = boa(); m.tomadas[2] = { ...m.tomadas[2], zoom: 1.08 }
    let a = avaliarMontagem(m)
    assert.ok(a.correcoes.some((c) => c.tipo === 'REMOVER_ZOOM'))
    m.tomadas[2] = { ...m.tomadas[2], zoom: 1, mostra: ['FOLHEANDO', 'ILUSTRACAO_INTERNA', 'TEXTO_INTERNO_LEGIVEL'], mostraPorSegundos: { TEXTO_INTERNO_LEGIVEL: 2, ILUSTRACAO_INTERNA: 6 } }
    a = avaliarMontagem(m)
    assert.ok(a.criterios.conformidade.nota < 70)
    assert.equal(a.metricas.textoInternoLegivelS, 2)
  })
  test('CTA: falar em "produto marcado" antes da marcação é apontado; com a marcação feita, não', () => {
    const m = boa(); m.falas[4] = { ...m.falas[4], texto: 'Toque no produto marcado para conhecer.' }
    assert.ok(avaliarMontagem(m).criterios.chamadaParaAcao.diagnostico.some((d) => /marcação/.test(d)))
    m.produtoMarcado = true
    assert.ok(!avaliarMontagem(m).criterios.chamadaParaAcao.diagnostico.some((d) => /marcação/.test(d)))
  })
  test('legenda fora da área segura e textos sobrepostos', () => {
    const m = boa(); m.textos.push({ ini: 4.5, fim: 6, texto: 'x', tipo: 'LEGENDA', topo: 1600, base: 1700 })
    m.textos.push({ ini: 4.4, fim: 6, texto: 'y', tipo: 'LEGENDA', topo: 1316, base: 1400 })
    const a = avaliarMontagem(m)
    assert.ok(a.criterios.legendas.diagnostico.some((d) => /área segura/.test(d)))
    assert.ok(a.criterios.legendas.diagnostico.some((d) => /sobrepõem/.test(d)))
  })
  test('IA sem checagem de fidelidade bloqueia; voz pouco parecida com a titular derruba naturalidade', () => {
    const m = boa(); m.tomadas[3] = { ...m.tomadas[3], ia: { fidelidadeAprovada: false } }
    assert.equal(avaliarMontagem(m).veredito, 'BLOQUEADO')
    const v = boa(); v.audio.similaridadeDaVoz = 0.7
    assert.ok(avaliarMontagem(v).criterios.naturalidadeDaVoz.nota <= 70)
  })
  test('ciclo LIMITADO: corrige até MAX_TENTATIVAS e depois apresenta a MELHOR com ressalvas; nunca publica', () => {
    const ruim = boa(); ruim.falas[0] = { ...ruim.falas[0], texto: 'Olha que livro interessante!' }; ruim.audio.vozSobreTrilhaDb = 23
    const r = avaliarMontagem(ruim), b = avaliarMontagem(boa())
    assert.equal(proximoPasso([r]).acao, 'CORRIGIR')
    assert.equal(proximoPasso([r, b]).acao, 'APRESENTAR')
    const tres = Array.from({ length: MAX_TENTATIVAS }, () => r)
    const p = proximoPasso(tres)
    assert.equal(p.acao, 'APRESENTAR_MELHOR_COM_RESSALVAS')
    assert.ok(!['PUBLICAR', 'APROVAR'].includes(p.acao as string))
  })
})
