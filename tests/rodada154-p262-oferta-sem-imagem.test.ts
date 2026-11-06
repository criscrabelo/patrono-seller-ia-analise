/**
 * P2.62 — formato "oferta sem imagem do produto" no Quality Gate Comercial: quando não há mídia do produto com
 * direito, um vídeo original de texto + narração pode ser avaliado, desde que NÃO mostre e NÃO simule o produto e
 * mande o público ao anúncio. Sem declarar o formato, a regra da P2.51 continua (produto real precisa aparecer).
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { avaliarMontagem, type MontagemParaAvaliar } from '../lib/quality-gate-comercial'

const falas = [
  { ini: 0.3, fim: 3, texto: 'Sua casa pode ser a mais iluminada da rua neste Natal?', papel: 'GANCHO' as const },
  { ini: 3.4, fim: 7, texto: 'Segundo o anúncio, o cordão tem 1.600 LEDs e 50 metros.', papel: 'APRESENTACAO' as const },
  { ini: 7.4, fim: 11, texto: 'O anúncio informa efeito pisca-flash em branco quente.', papel: 'DEMONSTRACAO' as const },
  { ini: 11.4, fim: 14, texto: 'Veja as fotos e os detalhes no anúncio: link na bio.', papel: 'CTA' as const },
]
const base = (o: Partial<MontagemParaAvaliar> = {}, mostra: string[] = ['GRAFICO_DO_PATRONO']) => avaliarMontagem({
  duracao: 15, produto: { nome: 'Cordão de Natal 1600 LEDs', categoria: 'Decoração' }, produtoMarcado: false, falas,
  tomadas: [{ ini: 0, fim: 15, origem: 'grafico.mp4', origemIni: 0, mostra: mostra as never, movimento: 0.05, zoom: 1 }],
  textos: [], audio: { lufs: -14, picoDb: -2, vozSobreTrilhaDb: 12, trilha: 'PROPRIA', vozSintetica: true }, ...o,
})

describe('P2.62 — oferta sem imagem do produto', () => {
  test('sem declarar o formato: continua o bloqueio da P2.51', () => {
    assert.ok(base().bloqueios.some((b) => /produto real nunca aparece/.test(b)))
  })
  test('declarado, honesto (só gráficos, remete ao anúncio): sem bloqueio de fidelidade; nota limitada a 75', () => {
    const r = base({ formato: 'OFERTA_SEM_IMAGEM' })
    assert.ok(!r.bloqueios.some((b) => /produto real|oferta sem imagem/.test(b)), r.bloqueios.join(' | '))
    assert.ok(r.criterios.fidelidadeAoProduto.nota <= 75 && r.criterios.fidelidadeAoProduto.nota >= 70)
    assert.match(r.criterios.fidelidadeAoProduto.diagnostico.join(' '), /sem imagem do produto/)
  })
  test('declarado mas com imagem do produto: bloqueia (use o formato padrão com mídia de direito)', () => {
    assert.ok(base({ formato: 'OFERTA_SEM_IMAGEM' }, ['PRODUTO_REAL']).bloqueios.some((b) => /com imagem do produto/.test(b)))
  })
  test('declarado com tomada gerada por IA: bloqueia (demonstração simulada)', () => {
    const r = base({ formato: 'OFERTA_SEM_IMAGEM', tomadas: [{ ini: 0, fim: 15, origem: 'ia.mp4', origemIni: 0, mostra: ['GRAFICO_DO_PATRONO'], movimento: 0.05, zoom: 1, ia: { fidelidadeAprovada: true } }] })
    assert.ok(r.bloqueios.some((b) => /simulada/.test(b)))
  })
  test('declarado sem mandar ao anúncio: bloqueia', () => {
    const r = base({ formato: 'OFERTA_SEM_IMAGEM', falas: falas.map((f) => (f.papel === 'CTA' ? { ...f, texto: 'Link na bio, corre que acaba.' } : f)) })
    assert.ok(r.bloqueios.some((b) => /fotos e detalhes no anúncio/.test(b)))
  })
})

describe('P2.62 — "link na bio" com link externo (ML) não é marcação de produto', () => {
  test('sem linkExterno: "link na bio" sem produto marcado desconta (regra do TikTok Shop mantida)', () => {
    assert.ok(base({ formato: 'OFERTA_SEM_IMAGEM' }).criterios.chamadaParaAcao.diagnostico.some((d) => /produto marcado\/link/.test(d)))
  })
  test('com linkExterno: "link na bio" é o caminho certo — sem desconto', () => {
    const r = base({ formato: 'OFERTA_SEM_IMAGEM', linkExterno: true })
    assert.ok(!r.criterios.chamadaParaAcao.diagnostico.some((d) => /produto marcado\/link/.test(d)))
  })
  test('com linkExterno mas falando em sacolinha: continua descontando', () => {
    const r = base({ formato: 'OFERTA_SEM_IMAGEM', linkExterno: true, falas: falas.map((f) => (f.papel === 'CTA' ? { ...f, texto: 'Veja as fotos no anúncio, o produto está na sacolinha e no link na bio.' } : f)) })
    assert.ok(r.criterios.chamadaParaAcao.diagnostico.some((d) => /produto marcado\/link/.test(d)))
  })
})
