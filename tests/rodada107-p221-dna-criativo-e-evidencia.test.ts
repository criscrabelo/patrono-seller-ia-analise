/**
 * P2.21 — DNA criativo, classificação do hook, níveis de evidência, decaimento temporal, métricas comerciais
 * e feedback para o planejador. Os 15 cenários obrigatórios estão numerados no nome dos testes.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { aprenderCriativo, comissaoPonderada, mannWhitney, orientacaoParaOPlanejador, orientaOPlanejador, type VideoParaAprender, type AprendizadoCriativo } from '../lib/aprendizado-criativo'
import { classificarGancho, classificarHook } from '../lib/ml-hook-classifier'
import { classificarCta, tipoDeCta } from '../lib/ml-cta-classifier'
import { extrairDna } from '../lib/dna-criativo'
import { escolherVariante } from '../lib/publicacao-assistida'
import { planejarVideos } from '../lib/motor-de-videos-tiktok'

const AGORA = new Date('2026-10-16T12:00:00-03:00')
const DIA = 86_400_000
let seq = 0
/** Vídeo sintético: `valor` = comissão por 1.000 views desejada (comissão confirmada, salvo `estimada`). */
function v(x: Partial<VideoParaAprender> & { valor?: number; estimada?: boolean; dias?: number }): VideoParaAprender {
  const views = x.views ?? 2000
  const com = x.valor != null ? (x.valor * views) / 1000 : null
  return {
    id: x.id ?? `v${++seq}`, publicadoEm: new Date(AGORA.getTime() - (x.dias ?? 5) * DIA), produto: x.produto ?? 'P1', categoria: x.categoria ?? 'Casa', canal: x.canal ?? 'tiktok',
    estrutura: x.estrutura ?? 'ACHADO_TIKTOK_SHOP', tipoDeGancho: x.tipoDeGancho ?? 'DESCOBERTA', tipoDeCta: x.tipoDeCta ?? 'PRODUTO_MARCADO', duracaoSegundos: x.duracaoSegundos ?? 15,
    formatoDoConteudo: x.formatoDoConteudo ?? 'IMAGENS_COM_TEXTO', temRosto: x.temRosto ?? null, temDemonstracao: x.temDemonstracao ?? null, temNarracao: x.temNarracao ?? false, temTextoNaTela: x.temTextoNaTela ?? true,
    views, cliques: 'cliques' in x ? (x.cliques ?? null) : Math.round(views * 0.03), pedidos: 'pedidos' in x ? (x.pedidos ?? null) : 2,
    comissaoConfirmada: x.comissaoConfirmada !== undefined ? x.comissaoConfirmada : x.estimada ? null : com,
    comissaoEstimada: x.comissaoEstimada !== undefined ? x.comissaoEstimada : x.estimada ? com : null,
  }
}
const serie = (n: number, base: Partial<VideoParaAprender> & { valor?: number; estimada?: boolean; dias?: number }, variar = (i: number) => ({} as Partial<VideoParaAprender> & { valor?: number })) =>
  Array.from({ length: n }, (_, i) => v({ ...base, ...variar(i) }))
const grupo = (a: AprendizadoCriativo, d: string, g: string) => a.dimensoes.find((x) => x.dimensao === d)?.grupos.find((x) => x.grupo === g)

describe('P2.21 — classificação do hook (classificador único consolidado)', () => {
  test('10. hook UNKNOWN: vazio, sem padrão ou ambíguo → UNKNOWN (com candidatos); o texto original não é mexido', () => {
    assert.equal(classificarGancho('').tipo, 'UNKNOWN')
    assert.equal(classificarGancho('oi gente').tipo, 'UNKNOWN')
    const amb = classificarGancho('POV: você achou o presente perfeito.')
    assert.equal(amb.tipo, 'UNKNOWN'); assert.deepEqual(amb.candidatos.sort(), ['POV', 'PRESENTE']); assert.match(amb.motivo, /Ambíguo/)
    assert.equal(classificarHook('oi gente').tipo, 'NAO_CLASSIFICADO', 'contrato antigo preservado')
    // vídeos com hook UNKNOWN ficam fora da comparação de hook (não viram um grupo "UNKNOWN")
    const a = aprenderCriativo([...serie(6, { tipoDeGancho: 'UNKNOWN', valor: 50 }), ...serie(6, { tipoDeGancho: 'DESCOBERTA', valor: 5 })], AGORA)
    assert.ok(!a.dimensoes.find((d) => d.dimensao === 'gancho'), 'só um grupo conhecido: nada a comparar')
  })
  test('classifica os ganchos que o Patrono gera, com acento, confiança e método', () => {
    const casos: [string, string][] = [
      ['Em 10 segundos eu te mostro como funciona: Caneca.', 'DEMONSTRACAO'], ['Se você tem esse problema em casa, olha isso.', 'PROBLEMA_SOLUCAO'],
      ['Olha o que eu achei no TikTok Shop.', 'DESCOBERTA'], ['3 motivos para ter este produto: Caneca.', 'LISTA'], ['Esse ou o comum? Olha a diferença.', 'COMPARACAO'],
      ['Pouca gente sabe que dá para fazer isso…', 'CURIOSIDADE'], ['Uma ideia de presente para quem você gosta.', 'PRESENTE'], ['Última chance!', 'URGENCIA'], ['Só hoje com desconto e frete', 'UNKNOWN'],
    ]
    for (const [t, tipo] of casos) assert.equal(classificarGancho(t).tipo, tipo, t)
    const natal = classificarGancho('Uma ideia de presente de Natal para quem você gosta.')
    assert.deepEqual([natal.tipo, natal.confianca, natal.metodo], ['PRESENTE', 'MEDIA', 'REGRAS_PT_BR@2'])
    assert.equal(classificarGancho('Olha o que eu achei no TikTok Shop.').confianca, 'ALTA')
    assert.equal(classificarCta('Veja o preço atual').tipo, 'VEJA_PRECO', '"preço" com acento agora casa')
    assert.equal(tipoDeCta('Salva este vídeo e confere o produto marcado.'), 'SALVAR_E_CONFERIR')
    assert.equal(tipoDeCta('Toque no produto marcado no vídeo.'), 'PRODUTO_MARCADO')
    assert.equal(tipoDeCta('qualquer coisa'), 'UNKNOWN')
  })
  test('DNA: só o que tem prova (render sem áudio, texto na tela, foto não demonstra; rosto desconhecido)', () => {
    const d = extrairDna({ gancho: 'Olha o que eu achei no TikTok Shop.', cta: 'Toque no produto marcado no vídeo.', estrutura: 'ACHADO_TIKTOK_SHOP', video: { situacao: 'GERADO', arquivo: 'x.mp4', midiaTipo: 'IMAGEM', midiaOrigem: 'PROPRIO', cenas: [{}] } })
    assert.deepEqual([d.tipoDeGancho, d.tipoDeCta, d.formatoDoConteudo, d.tipoDeMidia, d.origemDaMidia, d.temNarracao, d.temTextoNaTela, d.temDemonstracao, d.temRosto], ['DESCOBERTA', 'PRODUTO_MARCADO', 'IMAGENS_COM_TEXTO', 'IMAGEM', 'PROPRIO', false, true, false, null])
    const semRender = extrairDna({ gancho: 'oi', cta: null, estrutura: 'POV', video: null })
    assert.deepEqual([semRender.tipoDeGancho, semRender.formatoDoConteudo, semRender.tipoDeMidia, semRender.temNarracao, semRender.temTextoNaTela], ['UNKNOWN', 'UNKNOWN', 'UNKNOWN', null, null])
    const demo = extrairDna({ gancho: 'x', cta: null, estrutura: 'DEMONSTRACAO', video: { situacao: 'GERADO', arquivo: 'a', midiaTipo: 'VIDEO', midiaOrigem: 'PROPRIO', cenas: [] } })
    assert.equal(demo.temDemonstracao, true)
  })
})

describe('P2.21 — níveis de evidência, decaimento e métricas (puro)', () => {
  test('1. mesmo produto, 3 hooks: o produto fica fixo — DESCOBERTA é padrão provável (não forte: 1 produto só)', () => {
    const vids = [...serie(6, { tipoDeGancho: 'DESCOBERTA' }, (i) => ({ valor: 20 + i })), ...serie(6, { tipoDeGancho: 'DEMONSTRACAO' }, (i) => ({ valor: 6 + i * 0.5 })), ...serie(6, { tipoDeGancho: 'LISTA' }, (i) => ({ valor: 7 + i * 0.5 }))]
    const g = grupo(aprenderCriativo(vids, AGORA), 'gancho', 'DESCOBERTA')!
    assert.equal(g.direcao, 'MELHOR'); assert.equal(g.nivel, 'PADRAO_PROVAVEL'); assert.equal(g.produtos, 1)
    assert.ok(g.limitacoes.some((l) => /padrão forte: 3\+ produtos/.test(l)))
  })
  test('2. mesmo hook, produtos diferentes: consistente em 3 produtos → padrão forte; invertido dentro de cada produto → não passa de sinal', () => {
    const bom: VideoParaAprender[] = []
    for (const pr of ['A', 'B', 'C']) {
      bom.push(...serie(3, { produto: pr, tipoDeGancho: 'DESCOBERTA' }, (i) => ({ valor: 30 + i })))
      bom.push(...serie(3, { produto: pr, tipoDeGancho: 'LISTA' }, (i) => ({ valor: 8 + i })))
    }
    const forte = grupo(aprenderCriativo(bom, AGORA), 'gancho', 'DESCOBERTA')!
    assert.equal(forte.nivel, 'PADRAO_FORTE'); assert.equal(forte.produtos, 3)
    // Simpson: o hook está nos produtos que vendem mais, mas DENTRO de cada produto ele perde.
    const simpson: VideoParaAprender[] = []
    for (const [pr, alto] of [['A', 40], ['B', 38], ['C', 6]] as const) {
      simpson.push(...serie(pr === 'C' ? 1 : 4, { produto: pr, tipoDeGancho: 'DESCOBERTA' }, (i) => ({ valor: alto - 2 - i * 0.1 })))
      simpson.push(...serie(pr === 'C' ? 6 : 1, { produto: pr, tipoDeGancho: 'LISTA' }, (i) => ({ valor: alto + i * 0.1 })))
    }
    const s = grupo(aprenderCriativo(simpson, AGORA), 'gancho', 'DESCOBERTA')!
    assert.equal(s.direcao, 'MELHOR'); assert.equal(s.nivel, 'SINAL_INICIAL')
    assert.ok(s.limitacoes.some((l) => /mesmo produto o resultado se inverte/.test(l)))
  })
  test('3. mesmo hook, categorias diferentes (sem categoria em comum) → efeito possível da categoria: só sinal', () => {
    const vids = [
      ...serie(6, { tipoDeGancho: 'DESCOBERTA', categoria: 'Casa' }, (i) => ({ valor: 30 + i, produto: `C${i}` })),
      ...serie(6, { tipoDeGancho: 'LISTA', categoria: 'Beleza' }, (i) => ({ valor: 5 + i, produto: `B${i}` })),
    ]
    const g = grupo(aprenderCriativo(vids, AGORA), 'gancho', 'DESCOBERTA')!
    assert.equal(g.nivel, 'SINAL_INICIAL'); assert.ok(g.limitacoes.some((l) => /categoria/.test(l)))
  })
  test('4. vídeo viral com pouca comissão perde para vídeo menor que vende (critério = comissão por 1.000 views)', () => {
    const vids = [
      ...serie(6, { tipoDeGancho: 'CURIOSIDADE', views: 500_000 }, (i) => ({ comissaoConfirmada: 5 + i, produto: `X${i % 3}` })),
      ...serie(6, { tipoDeGancho: 'LISTA', views: 1500 }, (i) => ({ comissaoConfirmada: 15 + i, produto: `X${i % 3}` })),
    ]
    const a = aprenderCriativo(vids, AGORA)
    assert.equal(grupo(a, 'gancho', 'CURIOSIDADE')!.direcao, 'PIOR')
    assert.equal(grupo(a, 'gancho', 'LISTA')!.direcao, 'MELHOR')
    assert.ok(a.recomendacoes.some((r) => r.dimensao === 'gancho' && r.grupo === 'CURIOSIDADE' && r.acao === 'EVITAR_ESTE_PADRAO'))
  })
  test('5. vídeo menor com alta comissão: métricas comerciais por grupo (comissão/1.000 views, pedidos/1.000, por clique, conversão, por vídeo, eficiência)', () => {
    const vids = [...serie(5, { tipoDeGancho: 'LISTA', views: 1000, cliques: 50, pedidos: 5 }, (i) => ({ comissaoConfirmada: 20, produto: `M${i}` })), ...serie(5, { tipoDeGancho: 'CURIOSIDADE', views: 100_000, cliques: 1000, pedidos: 2 }, (i) => ({ comissaoConfirmada: 10, produto: `M${i}` }))]
    const m = grupo(aprenderCriativo(vids, AGORA), 'gancho', 'LISTA')!.metricas
    assert.deepEqual([m.comissaoPor1000Views, m.pedidosPor1000Views, m.comissaoPorClique, m.conversao, m.comissaoPorVideo], [20, 5, 0.4, 0.1, 20])
    assert.ok(m.eficienciaComercial! > 1)
    // sem dado confiável, não calcula
    const semDado = aprenderCriativo([...serie(3, { tipoDeGancho: 'LISTA', cliques: null, pedidos: null }, () => ({ valor: 9 })), ...serie(3, { tipoDeGancho: 'PRESENTE', cliques: null, pedidos: null }, () => ({ valor: 3 }))], AGORA)
    const mm = grupo(semDado, 'gancho', 'LISTA')!.metricas
    assert.deepEqual([mm.comissaoPorClique, mm.conversao, mm.pedidosPor1000Views], [null, null, null])
  })
  test('6. outlier extremo: um vídeo absurdo não faz o grupo "vencer" (mediana + posições) e é apontado', () => {
    const vids = [
      ...serie(5, { tipoDeGancho: 'SURPRESA' }, (i) => ({ valor: 4 + i * 0.2, produto: `O${i}` })), v({ id: 'absurdo', tipoDeGancho: 'SURPRESA', valor: 5000, produto: 'O9' }),
      ...serie(6, { tipoDeGancho: 'LISTA' }, (i) => ({ valor: 10 + i * 0.2, produto: `O${i}` })),
    ]
    const a = aprenderCriativo(vids, AGORA)
    const s = grupo(a, 'gancho', 'SURPRESA')!
    assert.equal(s.direcao, 'PIOR', 'a média simples diria MELHOR')
    assert.ok(a.outliers.includes('absurdo')); assert.ok(s.outliers.includes('absurdo'))
  })
  test('7. dados insuficientes (2 vídeos por grupo; ou sem comissão; ou < 500 views) → INSUFICIENTE, nada orienta', () => {
    const a = aprenderCriativo([...serie(2, { tipoDeGancho: 'LISTA', valor: 50 }), ...serie(2, { tipoDeGancho: 'CURIOSIDADE', valor: 1 }), ...serie(3, { views: 100, valor: 99 }), v({ comissaoConfirmada: null, comissaoEstimada: null })], AGORA)
    assert.equal(grupo(a, 'gancho', 'LISTA')!.nivel, 'INSUFICIENTE')
    assert.equal(a.videosAbaixoDasViews, 3); assert.equal(a.videosSemComissao, 1)
    assert.equal(a.recomendacoes.length, 0)
    assert.deepEqual(orientacaoParaOPlanejador(a).motivos, [])
  })
  test('8. antigos × recentes: o recente pesa mais (o que funcionou há 1 ano e parou não vence); só antigos não viram padrão', () => {
    const vids = [
      ...serie(6, { tipoDeGancho: 'DESCOBERTA', dias: 360 }, (i) => ({ valor: 40 + i, produto: `T${i}` })), ...serie(6, { tipoDeGancho: 'DESCOBERTA', dias: 3 }, (i) => ({ valor: 4 + i * 0.1, produto: `T${i}` })),
      ...serie(10, { tipoDeGancho: 'LISTA', dias: 3 }, (i) => ({ valor: 10 + i * 0.1, produto: `T${i % 6}` })),
    ]
    const g = grupo(aprenderCriativo(vids, AGORA), 'gancho', 'DESCOBERTA')!
    assert.notEqual(g.direcao, 'MELHOR'); assert.ok(g.nEfetivo < g.videos)
    const velhos = [...serie(6, { tipoDeGancho: 'DESCOBERTA', dias: 400 }, (i) => ({ valor: 40 + i, produto: `T${i}` })), ...serie(6, { tipoDeGancho: 'LISTA', dias: 400 }, (i) => ({ valor: 5 + i, produto: `T${i}` }))]
    const gv = grupo(aprenderCriativo(velhos, AGORA), 'gancho', 'DESCOBERTA')!
    assert.equal(gv.nivel, 'SINAL_INICIAL', 'evidência de mais de 1 ano não orienta: precisa de vídeos recentes')
    assert.ok(!orientaOPlanejador(gv.nivel)); assert.ok(gv.limitacoes.some((l) => /antigos/.test(l)))
    // os mesmos vídeos, recentes, viram padrão: a conclusão depende do tempo (não é permanente)
    const recentes = velhos.map((x) => ({ ...x, publicadoEm: new Date(AGORA.getTime() - 5 * DIA) }))
    assert.equal(grupo(aprenderCriativo(recentes, AGORA), 'gancho', 'DESCOBERTA')!.nivel, 'PADRAO_PROVAVEL')
  })
  test('9. comissão estimada × confirmada: a confirmada pesa mais (estimada vale a metade) e as duas aparecem separadas', () => {
    assert.equal(comissaoPonderada({ comissaoConfirmada: 10, comissaoEstimada: 10 }), 15)
    assert.equal(comissaoPonderada({ comissaoConfirmada: null, comissaoEstimada: null }), null)
    const vids = [...serie(6, { tipoDeGancho: 'LISTA' }, (i) => ({ valor: 10 + i * 0.1, produto: `E${i}` })), ...serie(6, { tipoDeGancho: 'PRESENTE', estimada: true }, (i) => ({ valor: 10 + i * 0.1, produto: `E${i}` }))]
    const a = aprenderCriativo(vids, AGORA)
    const conf = grupo(a, 'gancho', 'LISTA')!, est = grupo(a, 'gancho', 'PRESENTE')!
    assert.equal(conf.direcao, 'MELHOR'); assert.equal(est.direcao, 'PIOR')
    assert.ok(conf.metricas.comissaoConfirmada! > 0 && conf.metricas.comissaoEstimada === null)
    assert.ok(est.metricas.comissaoEstimada! > 0 && est.metricas.comissaoConfirmada === null)
  })
  test('não declara padrão forte com amostra pequena (5 × 5, separação total)', () => {
    const vids = [...serie(5, { tipoDeGancho: 'LISTA' }, (i) => ({ valor: 50 + i, produto: `S${i}` })), ...serie(5, { tipoDeGancho: 'PRESENTE' }, (i) => ({ valor: 2 + i * 0.1, produto: `S${i}` }))]
    assert.equal(grupo(aprenderCriativo(vids, AGORA), 'gancho', 'LISTA')!.nivel, 'PADRAO_PROVAVEL')
    assert.ok(mannWhitney([1, 2, 3], [1, 2, 3]) > 0.9)
  })
  test('combinações (hook + formato/CTA/categoria) só aparecem com amostra suficiente', () => {
    const poucos = aprenderCriativo([...serie(3, { tipoDeGancho: 'LISTA', valor: 20 }), ...serie(3, { tipoDeGancho: 'PRESENTE', valor: 5 })], AGORA)
    assert.ok(!poucos.dimensoes.some((d) => d.dimensao.includes('+')))
    const muitos = aprenderCriativo([...serie(6, { tipoDeGancho: 'LISTA', formatoDoConteudo: 'VIDEO_COM_TEXTO' }, (i) => ({ valor: 20 + i, produto: `K${i}` })), ...serie(6, { tipoDeGancho: 'PRESENTE' }, (i) => ({ valor: 5 + i, produto: `K${i}` }))], AGORA)
    assert.ok(muitos.dimensoes.some((d) => d.dimensao === 'gancho+formato' && d.grupos.some((g) => g.grupo === 'LISTA + VIDEO_COM_TEXTO')))
    assert.ok(!muitos.dimensoes.some((d) => d.dimensao === 'gancho+categoria'), 'uma categoria só: a combinação só repetiria o hook')
  })
})

describe('P2.21 — feedback para o planejador (puro)', () => {
  const comPadrao = () => aprenderCriativo([
    ...serie(6, { tipoDeGancho: 'DESCOBERTA', tipoDeCta: 'SALVAR_E_CONFERIR' }, (i) => ({ valor: 30 + i, produto: `F${i}` })),
    ...serie(6, { tipoDeGancho: 'PROBLEMA_SOLUCAO', tipoDeCta: 'PRODUTO_MARCADO' }, (i) => ({ valor: 6 + i * 0.3, produto: `F${i}` })),
  ], AGORA)
  test('11. PADRAO_PROVAVEL orienta: hook DESCOBERTA na frente e CTA B; o vídeo escolhido muda e diz o que mudou', () => {
    const o = orientacaoParaOPlanejador(comPadrao())
    assert.ok(o.ganchosPreferidos.includes('DESCOBERTA')); assert.equal(o.cta, 'B'); assert.ok(o.motivos.length >= 2)
    const plano = planejarVideos({ nome: 'Organizador de gaveta', categoria: 'Casa', preco: 39.9, tiktokShop: true }, AGORA)
    const ordem = [...plano.testeInicial.variantes, ...plano.variantes.map((x) => x.id).filter((id) => !plano.testeInicial.variantes.includes(id))]
    const midias = [{ tipo: 'IMAGEM' as const, origem: 'PROPRIO' as const }]
    const sem = escolherVariante(plano.variantes, ordem, new Set(), null, midias, true)!
    const com = escolherVariante(plano.variantes, ordem, new Set(), null, midias, true, o)!
    assert.notEqual(sem.versao.estrutura, 'ACHADO_TIKTOK_SHOP')
    assert.equal(com.versao.estrutura, 'ACHADO_TIKTOK_SHOP', 'gancho "Olha o que eu achei" = DESCOBERTA')
    assert.equal(com.versao.cta, plano.variantes.find((x) => x.estrutura === 'ACHADO_TIKTOK_SHOP')!.ctaB)
    assert.ok(com.aplicado.includes('ordem das variantes') && com.aplicado.includes('CTA B'))
    assert.equal(com.qg.veredito, 'APROVADO')
  })
  test('12. INSUFICIENTE e SINAL_INICIAL não orientam: o vídeo escolhido é o mesmo de sem aprendizado', () => {
    const fraco = aprenderCriativo([...serie(3, { tipoDeGancho: 'DESCOBERTA' }, (i) => ({ valor: 30 + i, produto: `W${i}` })), ...serie(3, { tipoDeGancho: 'PROBLEMA_SOLUCAO' }, (i) => ({ valor: 6 + i, produto: `W${i}` }))], AGORA)
    assert.ok(fraco.recomendacoes.every((r) => !r.orientaPlanejador))
    assert.ok(fraco.recomendacoes.some((r) => r.acao === 'TESTAR_VARIACAO'), 'sinal inicial vira só sugestão de teste')
    const o = orientacaoParaOPlanejador(fraco)
    assert.deepEqual([o.ganchosPreferidos, o.cta, o.duracao, o.motivos], [[], null, null, []])
    const plano = planejarVideos({ nome: 'Organizador de gaveta', categoria: 'Casa', preco: 39.9, tiktokShop: true }, AGORA)
    const ordem = plano.variantes.map((x) => x.id)
    const midias = [{ tipo: 'IMAGEM' as const, origem: 'PROPRIO' as const }]
    assert.equal(escolherVariante(plano.variantes, ordem, new Set(), null, midias, true, o)!.versao.varianteId, escolherVariante(plano.variantes, ordem, new Set(), null, midias, true)!.versao.varianteId)
  })
  test('13. toda recomendação explica o motivo (efeito, critério, nº de vídeos comparáveis e nível)', () => {
    const r = comPadrao().recomendacoes.find((x) => x.dimensao === 'gancho' && x.grupo === 'DESCOBERTA')!
    assert.equal(r.acao, 'REPETIR_HOOK')
    assert.match(r.motivo, /^Hook DESCOBERTA teve \d+,\dx mais comissão por 1\.000 views em 6 vídeos comparáveis \(contra 6 dos demais; padrão provável, p (<|=) 0,\d\d\)\.$/)
    for (const x of comPadrao().recomendacoes) assert.ok(x.motivo.length > 30 && /vídeos comparáveis/.test(x.motivo), x.motivo)
  })
})

const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')
const PREFIXO = 'Conta de Teste — '

describe('P2.21 — persistência e concorrência do DNA (banco de TESTE)', { skip: !TEM_BANCO ? 'exige banco de TESTE' : false, timeout: 600_000 }, () => {
  let prisma: typeof import('../lib/prisma').prisma
  let D: typeof import('../lib/dna-criativo')
  let R: typeof import('../lib/resultados-videos')
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  const workspaces: string[] = []
  const marca = `r107-${Date.now()}`
  const novoWs = async (nome: string) => {
    const ws = (await prisma.workspace.create({ data: { name: `${PREFIXO}${nome} r107`, ownerId: `${marca}-${nome}` }, select: { id: true } })).id
    workspaces.push(ws)
    return ws
  }
  const criarResultado = async (ws: string, i: number, assistida = true) => {
    const a = assistida ? await prisma.publicacaoAssistida.create({ data: {
      workspaceId: ws, estado: 'PUBLICADO', nomeProduto: `Produto ${i}`, varianteId: 'ACHADO_TIKTOK_SHOP-A-CURTA', estrutura: 'ACHADO_TIKTOK_SHOP', candidatoId: `cand-${i}`,
      apresentacao: { video: { situacao: 'GERADO', arquivo: 'x.mp4', midiaTipo: 'IMAGEM', midiaOrigem: 'PROPRIO', cenas: [{ texto: 'a' }] }, textoNaTela: ['a'] }, qualityGate: {}, motivoEscolha: 'm', objetivoDoTeste: 'o', metasIds: [],
    } }) : null
    return prisma.videoTikTokResultado.create({ data: {
      workspaceId: ws, publicacaoAssistidaId: a?.id ?? null, candidatoId: `cand-${i}`, estrutura: 'ACHADO_TIKTOK_SHOP', gancho: 'Olha o que eu achei no TikTok Shop.', cta: 'A', ctaTexto: 'Toque no produto marcado no vídeo.',
      duracaoSegundos: 15, publicadoEm: new Date(), metasIds: [], origemMetricas: 'MANUAL', views: 1000, comissao: 10,
    } })
  }

  before(async () => {
    ;[{ prisma }, D, R, { limparWorkspaceDeTeste: limpar }] = await Promise.all([import('../lib/prisma'), import('../lib/dna-criativo'), import('../lib/resultados-videos'), import('./_limpar-workspace-de-teste')])
  })
  after(async () => {
    if (prisma) for (const w of workspaces) await limpar(prisma, w, PREFIXO)
    await prisma?.$disconnect()
  })

  test('14. refresh/persistência: o painel grava o DNA uma vez; ler de novo devolve o mesmo; o informado pela titular não é sobrescrito; o texto original fica', async () => {
    const ws = await novoWs('persistencia')
    const r = await criarResultado(ws, 1)
    const p1 = await R.painelDeResultados(ws)
    const dna1 = p1.resultados[0].dna
    assert.deepEqual([dna1.tipoDeGancho, dna1.tipoDeCta, dna1.formatoDoConteudo, dna1.tipoDeMidia, dna1.temNarracao, dna1.temTextoNaTela, dna1.temRosto], ['DESCOBERTA', 'PRODUTO_MARCADO', 'IMAGENS_COM_TEXTO', 'IMAGEM', false, true, null])
    const p2 = await R.painelDeResultados(ws)
    assert.deepEqual(p2.resultados[0].dna, dna1, 'refresh devolve o mesmo DNA')
    await D.informarDna({ workspaceId: ws, userId: null, id: r.id, valores: { temRosto: true, temNarracao: true } })
    await prisma.videoTikTokResultado.update({ where: { id: r.id }, data: { metodoDoGancho: 'REGRAS_PT_BR@1' } })
    await D.garantirDnaDosResultados(ws)
    const linha = await prisma.videoTikTokResultado.findUniqueOrThrow({ where: { id: r.id } })
    assert.deepEqual([linha.temRosto, linha.temNarracao, linha.metodoDoGancho, linha.gancho], [true, true, 'REGRAS_PT_BR@2', 'Olha o que eu achei no TikTok Shop.'])
    assert.equal((linha.origemDoDna as Record<string, string>).temRosto, 'INFORMADO_PELA_TITULAR')
    assert.ok(p2.aprendizadoCriativo && Array.isArray(p2.aprendizadoCriativo.recomendacoes) && p2.orientacao)
  })

  test('15. concorrência/idempotência: 5 extrações simultâneas gravam cada DNA uma vez só; a próxima não faz nada', async () => {
    const ws = await novoWs('concorrencia')
    for (let i = 0; i < 4; i++) await criarResultado(ws, i, i % 2 === 0)
    const r = await Promise.all([1, 2, 3, 4, 5].map(() => D.garantirDnaDosResultados(ws)))
    assert.equal(r.reduce((s, x) => s + x.extraidos, 0), 4)
    assert.deepEqual(await D.garantirDnaDosResultados(ws), { extraidos: 0, reclassificados: 0 })
    const linhas = await prisma.videoTikTokResultado.findMany({ where: { workspaceId: ws } })
    assert.ok(linhas.every((l) => l.versaoDoDna === 'DNA@1' && l.tipoDeGancho === 'DESCOBERTA'))
    assert.equal(linhas.filter((l) => l.formatoDoConteudo === 'UNKNOWN').length, 2, 'sem publicação assistida (sem render): formato UNKNOWN, não palpite')
    // a comissão informada pela titular entra como ESTIMADA (não confirmada)
    const vs = await R.videosParaAprender(ws)
    assert.ok(vs.every((x) => x.comissaoEstimada === 10 && x.comissaoConfirmada === null))
    // bug do E2E: vídeos com a mesma data voltavam em ordem diferente a cada leitura (a lista "pulava" no refresh)
    const mesmoInstante = new Date('2026-10-15T10:00:00-03:00')
    await prisma.videoTikTokResultado.updateMany({ where: { workspaceId: ws }, data: { publicadoEm: mesmoInstante } })
    const ordens = await Promise.all([1, 2, 3].map(async () => (await R.painelDeResultados(ws)).resultados.map((x) => x.id).join(',')))
    assert.equal(new Set(ordens).size, 1, 'ordem estável no refresh')
  })
})
