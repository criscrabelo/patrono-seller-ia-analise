/**
 * P2.67 — revisão independente: o revisor não recebe nada do produtor; laudo sem evidência observável não conta;
 * revisor por IA só vale calibrado (distingue aprovados de reprovados com margem e estabilidade); chamada paga só com
 * autorização e dentro do teto.
 * P2.68 — negócio por objetivo: portões antes da comissão; principal = menos pendências; etapas com critério
 * verificável; métricas sem mistura; gestor sem duplicar tarefas; página de links só com link oficial idêntico.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { validarEntradasDoRevisor, fatosParaORevisor, laudoDaResposta, avaliarCalibracao, estimarCustoUsd, podeChamarRevisorPago, instrucaoDoRevisor, RUBRICA, VERSAO_DA_INSTRUCAO } from '../lib/revisao-independente'
import { avaliarBarreiraProfissional, ITENS_DE_LAUDO, type ItemDeLaudo } from '../lib/barreira-profissional'
import { portoesDaOportunidade, priorizarOportunidades, etapaDaCampanha, quadroDeResultados, type FatosDaOportunidade } from '../lib/ciclo-comercial'
import { planejarOperacao, situacaoDasTarefasDoGestor, idDaTarefa } from '../lib/gestor-da-operacao'
import { validarItem, montarPaginaDeLinks, type ItemDaPagina } from '../lib/pagina-de-links'

const SHA = 'f'.repeat(64)
const todas = (nota: number) => Object.fromEntries((Object.keys(ITENS_DE_LAUDO) as ItemDeLaudo[]).map((k) => [k, nota]))
const calibrada = { revisor: 'gemini-2.5-pro@google', aprovada: true, em: '2026-10-27', conjunto: [], motivo: 'ok' }
// achado 1: a confiança vem do CADASTRO (escrito pelo exame de calibração), nunca do laudo
const CADASTRO_IA = [{ revisor: 'gemini-2.5-pro@google', tipo: 'IA' as const, calibracao: { aprovada: true, em: '2026-10-27', validaAte: '2027-01-25', versaoDoPrompt: VERSAO_DA_INSTRUCAO, motivo: 'ok' } }]

describe('P2.67 — separação gerador × revisor', () => {
  test('pacote só com o arquivo final e o que se extrai dele: aceito', () => {
    assert.equal(validarEntradasDoRevisor(['video.mp4', 'audio.wav', 'quadro-01.jpg', 'folha-de-quadros.jpg', 'fatos-com-fonte.json', 'pacote.json']).ok, true)
  })
  test('qualquer artefato do produtor (auditoria, montagem, barreira, roteiro, legendas, notas) é recusado', () => {
    for (const a of ['auditoria.json', 'montagem.json', 'barreira.json', 'relatorio-de-producao.json', 'roteiro-visual.json', 'legendas.ass', 'brief.json', 'nota-do-produtor.txt', 'laudo.json'])
      assert.equal(validarEntradasDoRevisor(['video.mp4', a]).ok, false, a)
  })
  test('da ficha, o revisor recebe só fatos COM FONTE — nunca falas, roteiro ou legenda planejada', () => {
    const f = fatosParaORevisor({ produto: { nome: 'X' }, fatosValidados: ['1.600 LEDs (título do anúncio)', 'sem fonte'], gancho: 'fala do produtor' } as never)
    assert.deepEqual(f.fatosComFonte, ['1.600 LEDs (título do anúncio)'])
    assert.ok(!JSON.stringify(f).includes('fala do produtor'))
  })
  test('a instrução pede nota ancorada, descrição do que foi visto/ouvido e instantes, para os 14 itens', () => {
    const s = instrucaoDoRevisor({ produto: 'X', programa: null, fatosComFonte: [] }, 30)
    for (const id of Object.keys(RUBRICA)) assert.ok(s.includes(id), id)
    assert.match(s, /NÃO produziu/); assert.match(s, /instantes/)
  })
})

describe('P2.67 — laudo só com evidência observável', () => {
  test('item sem instantes ou sem descrição do que foi observado é descartado (fica NÃO VERIFICADO)', () => {
    const { laudo, descartados } = laudoDaResposta({ itens: { direcaoDeArte: { nota: 5, observado: 'ótimo', instantes: [] }, composicao: { nota: 4, observado: 'Aos 3 s o título ocupa o terço superior e o produto aparece centralizado, com respiro.', instantes: [3] } }, defeitos: [] }, { sha256: SHA, duracaoS: 30, revisor: 'r', tipo: 'IA', calibracao: null, em: 'x' })
    assert.ok(!laudo.itens.direcaoDeArte); assert.ok(laudo.itens.composicao); assert.ok(descartados.some((d) => d.startsWith('direcaoDeArte')))
  })
  test('instante fora do vídeo não conta', () => {
    const { laudo } = laudoDaResposta({ itens: { composicao: { nota: 4, observado: 'Descrição longa o suficiente do que foi visto no quadro citado.', instantes: [99] } }, defeitos: [] }, { sha256: SHA, duracaoS: 30, revisor: 'r', tipo: 'IA', calibracao: null, em: 'x' })
    assert.ok(!laudo.itens.composicao)
  })
  test('revisor por IA SEM calibração aprovada: todos os itens subjetivos NÃO VERIFICADOS na barreira', () => {
    const itens = Object.fromEntries((Object.keys(ITENS_DE_LAUDO) as ItemDeLaudo[]).map((k) => [k, { nota: 5, observado: 'Descrição longa o suficiente do que foi visto e ouvido no instante.', instantes: [2] }]))
    const semCal = laudoDaResposta({ itens, defeitos: [] }, { sha256: SHA, duracaoS: 30, revisor: 'gemini-2.5-pro@google', tipo: 'IA', calibracao: null, em: 'x' }).laudo
    const r = avaliarBarreiraProfissional({ sha256: SHA, produtoFisico: false, midiaDoProduto: { aparece: true, direitosComprovados: true }, laudo: semCal, revisoresConfiaveis: [], agora: '2026-10-28' })
    assert.ok(r.itens.filter((i) => i.id in ITENS_DE_LAUDO).every((i) => i.status === 'NAO_VERIFICADO'))
    const comCal = laudoDaResposta({ itens, defeitos: [] }, { sha256: SHA, duracaoS: 30, revisor: 'gemini-2.5-pro@google', tipo: 'IA', calibracao: calibrada, em: 'x' }).laudo
    const r2 = avaliarBarreiraProfissional({ sha256: SHA, produtoFisico: false, midiaDoProduto: { aparece: true, direitosComprovados: true }, laudo: comCal, revisoresConfiaveis: CADASTRO_IA, agora: '2026-10-28', duracaoS: 30 })
    assert.ok(r2.itens.filter((i) => i.id in ITENS_DE_LAUDO).every((i) => i.status === 'APROVADO'))
  })
  test('calibração de OUTRO revisor não vale', () => {
    const itens = { composicao: { nota: 5, observado: 'Descrição longa o suficiente do que foi visto e ouvido no instante.', instantes: [2] } }
    const l = laudoDaResposta({ itens, defeitos: [] }, { sha256: SHA, duracaoS: 30, revisor: 'gemini-2.5-flash@google', tipo: 'IA', calibracao: calibrada, em: 'x' }).laudo
    const r = avaliarBarreiraProfissional({ sha256: SHA, produtoFisico: false, midiaDoProduto: { aparece: true, direitosComprovados: true }, laudo: l, revisoresConfiaveis: CADASTRO_IA, agora: '2026-10-28' })
    assert.equal(r.itens.find((i) => i.id === 'composicao')!.status, 'NAO_VERIFICADO')
  })
})

describe('P2.67 — exame de admissão do revisor (calibração)', () => {
  const bom = (n: number) => ({ video: 'emocionario-v4', esperado: 'BOM' as const, execucoes: [todas(n), todas(n)] })
  const ruim = (v: string, n: number) => ({ video: v, esperado: 'RUIM' as const, execucoes: [todas(n), todas(n)] })
  test('distingue com margem e estabilidade: aprovada', () => {
    assert.equal(avaliarCalibracao('r', [bom(4.4 as never), ruim('cordao-v2', 2), ruim('kappa-v2', 1)], 'x').aprovada, true)
  })
  test('revisor complacente (dá 4 para o Cordão v3 que a titular reprovou): reprovado no exame', () => {
    const c = avaliarCalibracao('r', [bom(5), ruim('cordao-v2', 2), ruim('cordao-v3', 4)], 'x')
    assert.equal(c.aprovada, false); assert.match(c.motivo, /complacente/)
  })
  test('revisor instável (mesmo vídeo, notas 2 e 5): reprovado no exame', () => {
    const c = avaliarCalibracao('r', [bom(5), ruim('cordao-v2', 2), { video: 'kappa-v2', esperado: 'RUIM', execucoes: [todas(1), { ...todas(1), credibilidade: 4 }] }], 'x')
    assert.equal(c.aprovada, false); assert.match(c.motivo, /variação/)
  })
  test('uma execução só por vídeo não basta', () => {
    assert.equal(avaliarCalibracao('r', [{ video: 'b', esperado: 'BOM', execucoes: [todas(5)] }, ruim('a', 1), ruim('c', 1)], 'x').aprovada, false)
  })
})

describe('P2.67 — custo e orçamento', () => {
  test('estimativa (TETO: saída e pensamento no máximo) por vídeo de 30 s: Pro × 2 < US$ 0,35; Flash × 2 < US$ 0,10', () => {
    assert.ok(estimarCustoUsd(30, 'gemini-2.5-pro', 2) < 0.35); assert.ok(estimarCustoUsd(30, 'gemini-2.5-flash', 2) < 0.1)
  })
  test('sem autorização da titular: nunca chama, mesmo com teto', () => {
    assert.equal(podeChamarRevisorPago({ autorizado: false, tetoPorVideoUsd: 1, tetoMensalUsd: 10, gastoNoMesUsd: 0 }, 0.01).pode, false)
  })
  test('acima do teto por vídeo ou do mensal: recusa', () => {
    assert.equal(podeChamarRevisorPago({ autorizado: true, tetoPorVideoUsd: 0.1, tetoMensalUsd: 10, gastoNoMesUsd: 0 }, 0.2).pode, false)
    assert.equal(podeChamarRevisorPago({ autorizado: true, tetoPorVideoUsd: 1, tetoMensalUsd: 5, gastoNoMesUsd: 4.95 }, 0.1).pode, false)
    assert.equal(podeChamarRevisorPago({ autorizado: true, tetoPorVideoUsd: 1, tetoMensalUsd: 5, gastoNoMesUsd: 1 }, 0.1).pode, true)
  })
})

// ── P2.68 ──
const op = (o: Partial<FatosDaOportunidade> & { id: string }): FatosDaOportunidade => ({
  nome: o.id, programa: 'MERCADO_LIVRE', produtoFisico: true, afiliacao: 'ATIVA', linkOficial: 'https://meli.la/abc', midia: 'NENHUMA',
  canal: { destino: 'LINK_NA_BIO', destinoPronto: false, midiaCadastradaNoPrograma: true }, comissaoPercentual: null, comissaoObservadaEm: null, precoUnitario: null, ...o,
})
describe('P2.68 — portões antes da comissão', () => {
  test('produto físico sem mídia (Cordão/Kappa): bloqueado por terceiro em direitos e viabilidade, mesmo com 36% de comissão', () => {
    const p = portoesDaOportunidade(op({ id: 'kappa', comissaoPercentual: 36 }))
    assert.equal(p.find((x) => x.portao === 'DIREITOS_DE_MIDIA')!.status, 'BLOQUEADO')
    assert.equal(p.find((x) => x.portao === 'VIABILIDADE_DE_CONTEUDO')!.status, 'BLOQUEADO')
  })
  test('comissão alta não passa na frente de oportunidade viável', () => {
    const r = priorizarOportunidades([op({ id: 'kappa', comissaoPercentual: 36 }), op({ id: 'hotmart', programa: 'HOTMART', produtoFisico: false, afiliacao: 'PERFIL_INEXISTENTE', linkOficial: null, midia: 'NAO_INVESTIGADA' })])
    assert.equal(r.principal, 'hotmart')
  })
  test('oportunidade retida pela titular nunca vira principal, mesmo com menos pendências', () => {
    const r = priorizarOportunidades([op({ id: 'emoc', programa: 'TIKTOK_SHOP', midia: 'PROPRIA_DA_TITULAR', midiaEvidencia: 'x', retidoPelaTitular: 'direitos', canal: { destino: 'MARCACAO_NATIVA', destinoPronto: true, midiaCadastradaNoPrograma: true } }), op({ id: 'hotmart', programa: 'HOTMART', produtoFisico: false, midia: 'MATERIAL_DO_PRODUTOR' })])
    assert.equal(r.principal, 'hotmart')
  })
  test('amostra do TikTok Shop depende do vendedor (terceiro) e de alguém filmar', () => {
    const p = portoesDaOportunidade(op({ id: 'tts', programa: 'TIKTOK_SHOP', midia: 'AMOSTRA_FILMAVEL', linkOficial: null, canal: { destino: 'MARCACAO_NATIVA', destinoPronto: false, midiaCadastradaNoPrograma: true } })).flatMap((x) => x.pendencias)
    assert.ok(p.some((x) => x.quem === 'TERCEIRO' && /vendedor/i.test(x.texto)))
    assert.ok(p.some((x) => /filmar/i.test(x.texto)))
  })
  test('nenhuma viável: principal null (não inventa campanha)', () => {
    assert.equal(priorizarOportunidades([op({ id: 'a' }), op({ id: 'b' })]).principal, null)
  })
})

describe('P2.68 — etapas com critério verificável', () => {
  const agora = new Date('2026-10-28T12:00:00Z')
  test('só roteiro/vídeo/link NÃO é campanha pronta: falta barreira e destino do clique', () => {
    const e = etapaDaCampanha({ portoesOk: true, link: { url: 'u', registradoEm: '2026-10-27', comissaoConferidaEm: '2026-10-27' }, manifestoDeDireitosAprovado: true, barreira: { decisao: 'REPROVADO', sha256: SHA } }, agora)
    assert.equal(e.prontaParaATitular, false); assert.equal(e.atual, 'VIDEO_NA_BARREIRA')
  })
  test('comissão conferida há mais de 7 dias derruba a etapa do link', () => {
    assert.equal(etapaDaCampanha({ portoesOk: true, link: { url: 'u', registradoEm: '2026-10-01', comissaoConferidaEm: '2026-10-01' } }, agora).atual, 'LINK_OFICIAL')
  })
  test('pronta para a titular só com as 5 etapas anteriores; aprovação vale para o mesmo sha256', () => {
    const base = { portoesOk: true, link: { url: 'u', registradoEm: '2026-10-27', comissaoConferidaEm: '2026-10-27' }, manifestoDeDireitosAprovado: true, barreira: { decisao: 'APTO_PARA_TITULAR', sha256: SHA }, destinoDoClique: { tipo: 'PAGINA_DE_LINKS' as const, conferidoEm: '2026-10-27', linkConferido: 'u' } }
    assert.equal(etapaDaCampanha(base, agora).prontaParaATitular, true)
    assert.equal(etapaDaCampanha({ ...base, aprovacaoDaTitular: { sha256: 'outro', em: 'x' } }, agora).atual, 'APROVACAO_DA_TITULAR')
  })
  test('métrica coletada antes de 48 h da publicação não conclui a medição', () => {
    const e = etapaDaCampanha({ portoesOk: true, link: { url: 'u', registradoEm: 'x', comissaoConferidaEm: '2026-10-27' }, manifestoDeDireitosAprovado: true, barreira: { decisao: 'APTO_PARA_TITULAR', sha256: SHA }, destinoDoClique: { tipo: 'MARCACAO_NATIVA', conferidoEm: 'x' }, aprovacaoDaTitular: { sha256: SHA, em: 'x' }, publicacao: { url: 'p', conferidaEm: '2026-10-27T00:00:00Z' }, metricasColetadasEm: '2026-10-28T00:00:00Z' }, agora)
    assert.equal(e.atual, 'MEDIDO')
  })
})

describe('P2.68 — métricas sem mistura', () => {
  test('venda/comissão de fonte não oficial é recusada; prevista e recebida ficam separadas; ausente = null', () => {
    const { quadro, recusadas } = quadroDeResultados([
      { metrica: 'VISUALIZACOES', valor: 111, fonte: 'insights IG', oficial: true, coletadoEm: '2026-10-27' },
      { metrica: 'VENDAS', valor: 3, fonte: 'estimativa', oficial: false, coletadoEm: '2026-10-27' },
      { metrica: 'COMISSAO_PREVISTA', valor: 20, fonte: 'painel ML', oficial: true, coletadoEm: '2026-10-27' },
    ])
    assert.equal(quadro.VISUALIZACOES?.valor, 111); assert.equal(quadro.VENDAS, null); assert.equal(quadro.COMISSAO_RECEBIDA, null); assert.equal(quadro.CLIQUES, null)
    assert.equal(recusadas.length, 1)
  })
})

describe('P2.68 — gestor', () => {
  test('decisões indispensáveis = só pendências da titular que travam a principal (máx. 3); tarefas com id estável', () => {
    const ops = [op({ id: 'kappa', comissaoPercentual: 36 }), op({ id: 'hotmart', programa: 'HOTMART', produtoFisico: false, afiliacao: 'PERFIL_INEXISTENTE', linkOficial: null, midia: 'NAO_INVESTIGADA' })]
    const a = planejarOperacao(ops, [], new Date()), b = planejarOperacao(ops, [], new Date())
    assert.equal(a.principal?.id, 'hotmart')
    assert.ok(a.decisoes.length <= 3 && a.decisoes.every((d) => d.oportunidade === 'hotmart'))
    assert.deepEqual(a.tarefas.map((t) => t.id), b.tarefas.map((t) => t.id))
    // da oportunidade não principal, só entram tarefas do próprio Patrono
    assert.ok(a.tarefas.filter((t) => t.oportunidade === 'kappa').every((t) => t.quem === 'PATRONO'))
  })
})

describe('P2.68 — página de links', () => {
  const item = (o: Partial<ItemDaPagina> = {}): ItemDaPagina => ({ campanhaId: 'c', programa: 'MERCADO_LIVRE', titulo: 'T', detalhe: 'D', rotuloDoBotao: 'Ver', link: 'https://meli.la/2vxDsrA', linkRegistrado: 'https://meli.la/2vxDsrA', aprovacaoDaTitular: { em: 'x', sha256DoVideo: SHA }, sha256AptoNaBarreira: SHA, ...o })
  test('link oficial idêntico e campanha aprovada: aceito, com #publi e rel=sponsored', () => {
    const r = montarPaginaDeLinks({ nome: 'BC', iniciais: 'BC' }, [item()])
    assert.deepEqual(r.aceitos, ['c']); assert.match(r.html, /#publi/); assert.match(r.html, /rel="sponsored noopener"/); assert.match(r.html, /href="https:\/\/meli\.la\/2vxDsrA"/)
  })
  test('sem aprovação, link alterado, encurtador de terceiro ou TikTok Shop: recusado', () => {
    assert.ok(validarItem(item({ aprovacaoDaTitular: null })).length)
    assert.ok(validarItem(item({ link: 'https://meli.la/2vxDsrA?utm_source=x' })).length)
    assert.ok(validarItem(item({ link: 'https://bit.ly/abc', linkRegistrado: 'https://bit.ly/abc' })).length)
    assert.ok(validarItem(item({ programa: 'TIKTOK_SHOP' })).length)
  })
  test('texto com HTML é escapado', () => {
    assert.ok(!montarPaginaDeLinks({ nome: '<script>', iniciais: 'X' }, []).html.includes('<script>'))
  })
})

describe('P2.67/P2.68 — achados da revisão independente do código (não podem voltar)', () => {
  test('achado 7: resposta vazia do revisor para vídeo RUIM não conta como "rejeitou"', () => {
    const c = avaliarCalibracao('r', [{ video: 'bom', esperado: 'BOM', execucoes: [todas(5), todas(5)] }, { video: 'r1', esperado: 'RUIM', execucoes: [{}, {}] }, { video: 'r2', esperado: 'RUIM', execucoes: [todas(1), todas(1)] }], '2026-10-27T00:00:00Z')
    assert.equal(c.aprovada, false); assert.match(c.motivo, /avaliou 0 de/)
  })
  test('achado 7: o mesmo vídeo repetido não conta duas vezes', () => {
    const c = avaliarCalibracao('r', [{ video: 'bom', esperado: 'BOM', execucoes: [todas(5), todas(5)] }, { video: 'r1', esperado: 'RUIM', execucoes: [todas(1), todas(1)] }, { video: 'r1', esperado: 'RUIM', execucoes: [todas(1), todas(1)] }], '2026-10-27T00:00:00Z')
    assert.equal(c.aprovada, false)
  })
  test('achado 7: calibração aprovada fica presa à versão da instrução e tem validade', () => {
    const c = avaliarCalibracao('r', [{ video: 'bom', esperado: 'BOM', execucoes: [todas(5), todas(5)] }, { video: 'r1', esperado: 'RUIM', execucoes: [todas(1), todas(1)] }, { video: 'r2', esperado: 'RUIM', execucoes: [todas(2), todas(2)] }], '2026-10-27T00:00:00Z')
    assert.equal(c.aprovada, true); assert.equal(c.versaoDoPrompt, VERSAO_DA_INSTRUCAO); assert.equal(c.validaAte?.slice(0, 10), '2027-01-25')
  })
  test('achado 9: produto DIGITAL sem material não é bloqueio de terceiro (pode virar principal)', () => {
    const p = portoesDaOportunidade(op({ id: 'curso', programa: 'HOTMART', produtoFisico: false, midia: 'NENHUMA', linkOficial: 'https://go.hotmart.com/X1' })).flatMap((x) => x.pendencias)
    assert.ok(!p.some((x) => x.quem === 'TERCEIRO'))
  })
  test('achado 9: TikTok Shop com "link na bio" gera pendência (o caminho é a marcação nativa)', () => {
    const p = portoesDaOportunidade(op({ id: 'tts', programa: 'TIKTOK_SHOP', midia: 'PROPRIA_DA_TITULAR', midiaEvidencia: 'x', linkOficial: null })).find((x) => x.portao === 'CANAL')!
    assert.ok(p.pendencias.some((x) => /marcação do produto/.test(x.texto)))
  })
  test('achado 10: barreira sem sha256, conferência de comissão no futuro e página sem o link oficial não concluem etapas', () => {
    const agora = new Date('2026-10-28T12:00:00Z')
    assert.equal(etapaDaCampanha({ portoesOk: true, link: { url: 'u', registradoEm: 'x', comissaoConferidaEm: '2026-11-30' } }, agora).atual, 'LINK_OFICIAL')
    const base = { portoesOk: true, link: { url: 'u', registradoEm: 'x', comissaoConferidaEm: '2026-10-27' }, manifestoDeDireitosAprovado: true }
    assert.equal(etapaDaCampanha({ ...base, barreira: { decisao: 'APTO_PARA_TITULAR', sha256: '' } }, agora).atual, 'VIDEO_NA_BARREIRA')
    assert.equal(etapaDaCampanha({ ...base, barreira: { decisao: 'APTO_PARA_TITULAR', sha256: SHA }, destinoDoClique: { tipo: 'PAGINA_DE_LINKS', conferidoEm: 'x', linkConferido: 'outro' } }, agora).atual, 'DESTINO_DO_CLIQUE')
  })
  test('achado 10: aprovação da titular de OUTRO vídeo não entra na página; URL comum do ML (sem afiliação) também não', () => {
    const it = { campanhaId: 'c', programa: 'MERCADO_LIVRE' as const, titulo: 'T', detalhe: 'D', rotuloDoBotao: 'Ver', link: 'https://meli.la/2vxDsrA', linkRegistrado: 'https://meli.la/2vxDsrA', aprovacaoDaTitular: { em: 'x', sha256DoVideo: 'outro' }, sha256AptoNaBarreira: SHA }
    assert.ok(validarItem(it).some((e) => /não é do vídeo aprovado/.test(e)))
    assert.ok(validarItem({ ...it, aprovacaoDaTitular: { em: 'x', sha256DoVideo: SHA }, link: 'https://www.mercadolivre.com.br/p/MLB1', linkRegistrado: 'https://www.mercadolivre.com.br/p/MLB1' }).length)
  })
  test('re-revisão (defeito novo 1): a fila só fecha pendência que SUMIU da avaliação completa — mudar a principal não "resolve" nada', () => {
    const kappa = op({ id: 'ml-kappa', comissaoPercentual: 36 })
    const hotmart = op({ id: 'hotmart', programa: 'HOTMART', produtoFisico: false, afiliacao: 'PERFIL_INEXISTENTE', linkOficial: null, midia: 'NAO_INVESTIGADA' })
    const ids = [idDaTarefa('ml-kappa', 'sem-midia-do-produto'), idDaTarefa('hotmart', 'ativar-perfil'), idDaTarefa('sumiu', 'ativar-perfil')]
    // a pendência de terceiro do Kappa não entra no plano (não é a principal), mas continua VIVA: não pode fechar
    const s = situacaoDasTarefasDoGestor([kappa, hotmart], ids)
    assert.deepEqual(s.resolvidas, []); assert.deepEqual(s.semOportunidade, [idDaTarefa('sumiu', 'ativar-perfil')])
    // a titular ativa o perfil: só AQUELA tarefa fecha
    const s2 = situacaoDasTarefasDoGestor([kappa, { ...hotmart, afiliacao: 'ATIVA' }], ids)
    assert.deepEqual(s2.resolvidas, [idDaTarefa('hotmart', 'ativar-perfil')])
  })
  test('re-revisão: o id da tarefa vem da CHAVE da pendência (reescrever o texto não muda o id)', () => {
    const p = portoesDaOportunidade(op({ id: 'x' })).flatMap((y) => y.pendencias)
    assert.ok(p.length && p.every((y) => /^[a-z0-9-]+$/.test(y.chave)))
  })
  test('achado 11: "fato" sem fonte reconhecível ou com nota/controle do produtor não chega ao revisor', () => {
    const f = fatosParaORevisor({ fatosValidados: ['nota 98 (QG)', 'vídeo aprovado (auditoria interna)', 'nota 4,9 (painel de Afiliados, 27/10)'] })
    assert.deepEqual(f.fatosComFonte, ['nota 4,9 (painel de Afiliados, 27/10)'])
  })
})
