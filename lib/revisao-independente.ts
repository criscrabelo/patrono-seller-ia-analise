/**
 * P2.67 — REVISÃO AUDIOVISUAL INDEPENDENTE. Quem produz não revisa; o revisor nunca vê as notas do produtor.
 *
 *  1. SEPARAÇÃO: o revisor recebe SÓ o arquivo final (e o que se extrai dele: quadros, áudio, transcrição feita do
 *     próprio arquivo) mais os FATOS COM FONTE da ficha. Auditoria, montagem, barreira, relatório, plano, roteiro
 *     visual, legendas geradas e qualquer nota/justificativa do produtor são RECUSADOS na entrada.
 *  2. RUBRICA ANCORADA: cada item tem descrição do que é 1, 3 e 5, e a resposta precisa citar instantes e o que se vê
 *     ou ouve neles. Item sem evidência observável vira NÃO VERIFICADO na barreira (não há nota presumida).
 *  3. EXAME DE ADMISSÃO: um revisor por IA só vale depois de CALIBRADO — distinguir, com margem, vídeos que a
 *     titular aprovou de vídeos que ela reprovou, e repetir a avaliação com variação pequena. Sem calibração aprovada,
 *     o laudo dele não aprova nada.
 *  4. ORÇAMENTO: chamada paga só com autorização expressa, com teto por vídeo e por mês, e estimativa antes.
 */
import { ITENS_DE_LAUDO, type ItemDeLaudo, type LaudoDeRevisao } from './barreira-profissional'

// ── 1. Separação gerador × revisor ──────────────────────────────────────────────────────────
/** Arquivos que o revisor PODE receber (nomes dentro do pacote de revisão). */
export const ENTRADAS_PERMITIDAS = /^(video\.mp4|audio\.wav|transcricao\.json|quadro-\d{2}\.jpg|folha-de-quadros\.jpg|fatos-com-fonte\.json|pacote\.json)$/
/** Artefatos do PRODUTOR: nunca entram na revisão (eram a fonte das notas que enganaram na P2.66). */
export const ARTEFATOS_DO_PRODUTOR = /(auditoria|montagem|barreira|relatorio|plano|roteiro|legendas\.ass|brief|liberacao|pronuncia|escolha|laudo|nota|justificativa|geometria)/i

export function validarEntradasDoRevisor(arquivos: string[]): { ok: boolean; recusados: string[] } {
  const recusados = arquivos.filter((a) => { const n = a.split(/[\\/]/).pop() ?? a; return ARTEFATOS_DO_PRODUTOR.test(n) || !ENTRADAS_PERMITIDAS.test(n) })
  return { ok: recusados.length === 0, recusados }
}

/** Da ficha, o revisor só recebe os fatos COM FONTE (para conferir afirmações), nunca o roteiro ou as falas planejadas. */
export function fatosParaORevisor(brief: { fatosValidados?: string[]; produto?: { nome?: string }; programa?: { nome?: string } }): { produto: string; programa: string | null; fatosComFonte: string[] } {
  // achado 11: fonte reconhecível (anúncio, painel, título, relatório, site/termos oficiais) e nada de nota/controle do produtor
  const FONTE = /\((?=[^)]*(an[uú]ncio|painel|t[ií]tulo|relat[oó]rio|site oficial|termos|ficha t[eé]cnica|fabricante|produtor))[^)]+\)/i
  const DO_PRODUTOR = /(\bnota \d{2,3}\b|\bQG\b|quality gate|barreira|auditoria|comercial \d|aprovad[oa] nos)/i
  return { produto: brief.produto?.nome ?? '?', programa: brief.programa?.nome ?? null, fatosComFonte: (brief.fatosValidados ?? []).filter((f) => FONTE.test(f) && !DO_PRODUTOR.test(f)) }
}

// ── 2. Rubrica ancorada ─────────────────────────────────────────────────────────────────────
export const RUBRICA: Record<ItemDeLaudo, { pergunta: string; um: string; tres: string; cinco: string }> = {
  impactoInicial: { pergunta: 'Os 2 primeiros segundos fazem alguém parar de rolar o feed?', um: 'tela genérica/escura, nada acontece, texto pequeno', tres: 'há movimento e título, mas sem surpresa nem promessa clara', cinco: 'imagem forte do produto ou situação + gancho legível em < 1 s' },
  direcaoDeArte: { pergunta: 'Há uma direção visual intencional e profissional?', um: 'formas genéricas, cores sem critério, aparência de rascunho', tres: 'coerente mas comum, parece modelo pronto', cinco: 'paleta, tipografia e enquadramentos consistentes, parece anúncio de marca' },
  composicao: { pergunta: 'Os quadros são bem compostos para tela vertical?', um: 'elementos perdidos, grandes vazios, texto encostado/cortado', tres: 'equilibrado, sem destaque claro', cinco: 'hierarquia clara, foco onde deve, respiro adequado' },
  qualidadeDasAnimacoes: { pergunta: 'As cenas/animações têm qualidade e variedade?', um: 'mesma cena o vídeo todo, movimento sem propósito', tres: 'algumas variações, transições simples', cinco: 'cenas variadas, transições com intenção, nada repetitivo' },
  identidadeDaMarca: { pergunta: 'Dá para reconhecer o perfil/marca e confiar nele?', um: 'nada identifica quem fala', tres: 'identificação discreta', cinco: 'identidade consistente com o perfil, sem poluir' },
  naturalidadeDaVoz: { pergunta: 'A voz soa natural e agradável em português do Brasil?', um: 'robótica, entonação errada, cortes', tres: 'compreensível mas sintética', cinco: 'natural, ritmo e entonação de pessoa real' },
  sincronizacao: { pergunta: 'O que aparece na tela acompanha o que é dito, no tempo certo?', um: 'texto/imagem não correspondem à fala', tres: 'correspondem com atraso ou adiantamento perceptível', cinco: 'cada informação aparece quando é dita' },
  qualidadeDaTrilha: { pergunta: 'A trilha ajuda sem competir com a voz?', um: 'irritante, alta ou sem relação', tres: 'neutra', cinco: 'reforça o clima e some sob a voz' },
  despertaInteresse: { pergunta: 'Um cliente do público-alvo ficaria interessado no produto?', um: 'não dá vontade de saber mais', tres: 'interesse moderado', cinco: 'cria desejo/curiosidade concreta' },
  clarezaDaOferta: { pergunta: 'Fica claro o que é o produto, para quem é e por que considerar?', um: 'não se entende o que é vendido', tres: 'entende-se o produto, não o benefício', cinco: 'produto, benefício e condição claros' },
  coerenciaImagemNarracao: { pergunta: 'As imagens mostram o que a narração descreve?', um: 'imagens não têm relação com o produto descrito', tres: 'relação indireta/ilustrativa', cinco: 'imagens mostram exatamente o que é dito' },
  credibilidade: { pergunta: 'O vídeo parece confiável e honesto?', um: 'parece golpe/genérico, promessas sem prova', tres: 'neutro', cinco: 'transparente, fatos atribuídos, produto real' },
  forcaDoCta: { pergunta: 'A chamada final é clara e motivadora?', um: 'ausente ou confusa', tres: 'presente mas fraca', cinco: 'clara, visível e com motivo para agir agora' },
  adequacaoPublicoPlataforma: { pergunta: 'Funciona como Reels/TikTok para o público do perfil?', um: 'formato/linguagem errados para a plataforma', tres: 'aceitável', cinco: 'nativo da plataforma, linguagem do público' },
}

export interface RespostaDoRevisor {
  itens: Partial<Record<ItemDeLaudo, { nota: number; observado: string; instantes: number[] }>>
  defeitos: { instante: number; descricao: string }[]
}

/** Converte a resposta do revisor em laudo, recusando o que não tem evidência observável. */
export function laudoDaResposta(r: RespostaDoRevisor, ctx: { sha256: string; duracaoS: number; revisor: string; tipo: 'IA' | 'HUMANO'; calibracao: CalibracaoRegistrada | null; em: string; versaoDoPrompt?: string }): { laudo: LaudoDeRevisao; descartados: string[] } {
  const itens: LaudoDeRevisao['itens'] = {}, descartados: string[] = []
  for (const id of Object.keys(ITENS_DE_LAUDO) as ItemDeLaudo[]) {
    const x = r.itens?.[id]
    if (!x) { descartados.push(`${id}: ausente`); continue }
    const nota = Math.round(Number(x.nota))
    const instantes = (x.instantes ?? []).map(Number).filter((t) => Number.isFinite(t) && t >= 0 && t <= ctx.duracaoS + 0.5)
    if (!(nota >= 1 && nota <= 5) || !instantes.length || String(x.observado ?? '').trim().length < 40) { descartados.push(`${id}: sem nota válida, instantes do vídeo ou descrição do que foi observado`); continue }
    itens[id] = { nota: nota as 1 | 2 | 3 | 4 | 5, justificativa: String(x.observado).trim(), quadros: instantes }
  }
  const defeitos = (r.defeitos ?? []).filter((x) => x && typeof x.descricao === 'string' && x.descricao.trim()).map((x) => ({ instante: Number(x.instante) || 0, descricao: x.descricao.trim() }))
  return { laudo: { revisor: ctx.revisor, independenteDaProducao: true, sha256: ctx.sha256, em: ctx.em, itens, tipo: ctx.tipo, versaoDoPrompt: ctx.versaoDoPrompt ?? VERSAO_DA_INSTRUCAO, defeitos, calibracao: ctx.calibracao } as LaudoDeRevisao, descartados }
}

/** Identifica a instrução + rubrica: um revisor calibrado numa versão não vale em outra (achado 7). */
export const VERSAO_DA_INSTRUCAO = (() => {
  let h = 0; const s = JSON.stringify(RUBRICA) + 'instrucao-v1'
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return `p267-${(h >>> 0).toString(16)}`
})()
export const VALIDADE_DA_CALIBRACAO_DIAS = 90

// ── 3. Exame de admissão (calibração) ──────────────────────────────────────────────────────
export interface ResultadoDeCalibracao { video: string; esperado: 'BOM' | 'RUIM'; execucoes: Partial<Record<ItemDeLaudo, number>>[] }
export interface CalibracaoRegistrada { revisor: string; aprovada: boolean; em: string; conjunto: string[]; motivo: string; versaoDoPrompt?: string; validaAte?: string }
export const LIMITES_DA_CALIBRACAO = { mediaMinBom: 3.8, mediaMaxRuim: 2.5, margemMin: 1.5, variacaoMaxEntreExecucoes: 1.0, execucoesMin: 2, videosBonsMin: 1, videosRuinsMin: 2 } as const

const media = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length)
export function avaliarCalibracao(revisor: string, res: ResultadoDeCalibracao[], em: string): CalibracaoRegistrada {
  const L = LIMITES_DA_CALIBRACAO, prob: string[] = []
  // achado 7: vídeo repetido não conta duas vezes
  const unicos = [...new Map(res.map((r) => [r.video, r])).values()]
  if (unicos.length !== res.length) prob.push('vídeo repetido no conjunto do exame')
  const bons = unicos.filter((r) => r.esperado === 'BOM'), ruins = unicos.filter((r) => r.esperado === 'RUIM')
  if (bons.length < L.videosBonsMin || ruins.length < L.videosRuinsMin) prob.push(`conjunto pequeno (${bons.length} bom/${ruins.length} ruim)`)
  const mediaDo = (r: ResultadoDeCalibracao) => media(r.execucoes.flatMap((e) => Object.values(e).filter((x): x is number => typeof x === 'number')))
  const totalDeItens = Object.keys(RUBRICA).length
  for (const r of unicos) {
    if (r.execucoes.length < L.execucoesMin) prob.push(`${r.video}: ${r.execucoes.length} execução(ões) (mín. ${L.execucoesMin})`)
    // achado 7: resposta vazia/incompleta não vale como "rejeitou o vídeo ruim"
    r.execucoes.forEach((e, i) => { const n = Object.values(e).filter((x) => typeof x === 'number').length; if (n < totalDeItens) prob.push(`${r.video}: execução ${i + 1} avaliou ${n} de ${totalDeItens} itens`) })
    const m = mediaDo(r)
    if (r.esperado === 'BOM' && m < L.mediaMinBom) prob.push(`${r.video} (aprovado pela titular) recebeu média ${m.toFixed(1)}`)
    if (r.esperado === 'RUIM' && m > L.mediaMaxRuim) prob.push(`${r.video} (reprovado pela titular) recebeu média ${m.toFixed(1)}: revisor complacente`)
    // estabilidade: a mesma pergunta, no mesmo vídeo, não pode variar mais que o limite entre execuções
    const ids = new Set(r.execucoes.flatMap((e) => Object.keys(e)))
    const varMax = Math.max(0, ...[...ids].map((id) => { const v = r.execucoes.map((e) => e[id as ItemDeLaudo]).filter((x): x is number => typeof x === 'number'); return v.length ? Math.max(...v) - Math.min(...v) : 0 }))
    if (varMax > L.variacaoMaxEntreExecucoes + 1e-9) prob.push(`${r.video}: variação de ${varMax} ponto(s) entre execuções no mesmo item`)
  }
  if (bons.length && ruins.length) {
    const margem = Math.min(...bons.map(mediaDo)) - Math.max(...ruins.map(mediaDo))
    if (margem < L.margemMin) prob.push(`margem entre o pior bom e o melhor ruim = ${margem.toFixed(1)} (mín. ${L.margemMin})`)
  }
  // data inválida = sem validade (e a barreira exige validade: não aprova)
  const t = new Date(em).getTime()
  const validaAte = Number.isFinite(t) ? new Date(t + VALIDADE_DA_CALIBRACAO_DIAS * 86_400_000).toISOString() : undefined
  return { revisor, aprovada: prob.length === 0, em, conjunto: unicos.map((r) => `${r.video}:${r.esperado}`), motivo: prob.length ? prob.join('; ') : 'distingue aprovados de reprovados com margem e estabilidade', versaoDoPrompt: VERSAO_DA_INSTRUCAO, validaAte }
}

// ── 3b. Exame de DEFEITOS (P2.74) ───────────────────────────────────────────────────────────
/**
 * Quatro vídeos não bastam: o revisor também precisa PERCEBER defeitos reais, um de cada vez, inseridos de propósito
 * num vídeo BOM (a variante só difere da base pelo defeito). Cada defeito tem os itens que ele obrigatoriamente
 * afeta; "detectou" = a média desses itens caiu ≥ `quedaMin` em relação à base E pelo menos um deles ficou ≤ `notaMaxAfetado`.
 * Defeito CRÍTICO não detectado reprova sozinho (o revisor deixaria passar um vídeo que não pode ir ao ar).
 */
export const DEFEITOS_DE_TESTE = {
  dessincronia: { itens: ['sincronizacao'], critico: false, ffmpeg: 'áudio atrasado 0,8 s' },
  cenaCongelada: { itens: ['qualidadeDasAnimacoes'], critico: false, ffmpeg: 'imagem parada do 1/4 aos 3/4 do vídeo' },
  semCta: { itens: ['forcaDoCta'], critico: true, ffmpeg: 'últimos 5 s cortados' },
  baixaDefinicao: { itens: ['direcaoDeArte', 'composicao'], critico: false, ffmpeg: 'reduzido a 180 px de largura e ampliado' },
  trilhaAbafando: { itens: ['qualidadeDaTrilha'], critico: false, ffmpeg: 'ruído rosa alto sob o áudio todo' },
  narracaoTrocada: { itens: ['coerenciaImagemNarracao', 'clarezaDaOferta'], critico: true, ffmpeg: 'áudio de OUTRO produto' },
  aberturaEscura: { itens: ['impactoInicial'], critico: false, ffmpeg: '3 s iniciais pretos e mudos' },
  vozRobotizada: { itens: ['naturalidadeDaVoz'], critico: false, ffmpeg: 'eco metálico curto na voz' },
} as const satisfies Record<string, { itens: readonly ItemDeLaudo[]; critico: boolean; ffmpeg: string }>
export type DefeitoDeTeste = keyof typeof DEFEITOS_DE_TESTE
export const LIMITES_DOS_DEFEITOS = { quedaMin: 1.0, notaMaxAfetado: 2, deteccaoMin: 0.85, variantesMin: 6 } as const

export interface ResultadoDeDefeito { base: ResultadoDeCalibracao; defeito: DefeitoDeTeste; variante: ResultadoDeCalibracao }
export interface ExameDeDefeitos { aprovado: boolean; detectados: DefeitoDeTeste[]; perdidos: DefeitoDeTeste[]; motivo: string }

export function avaliarDeteccaoDeDefeitos(res: ResultadoDeDefeito[]): ExameDeDefeitos {
  const L = LIMITES_DOS_DEFEITOS, prob: string[] = [], detectados: DefeitoDeTeste[] = [], perdidos: DefeitoDeTeste[] = []
  const unicos = [...new Map(res.map((r) => [r.defeito, r])).values()]
  if (unicos.length < L.variantesMin) prob.push(`só ${unicos.length} defeito(s) testado(s) (mín. ${L.variantesMin})`)
  const mediaDoItem = (r: ResultadoDeCalibracao, id: ItemDeLaudo) => { const v = r.execucoes.map((e) => e[id]).filter((x): x is number => typeof x === 'number'); return v.length ? media(v) : NaN }
  for (const r of unicos) {
    if (r.variante.video === r.base.video) { prob.push(`${r.defeito}: variante com o mesmo sha256 da base`); perdidos.push(r.defeito); continue }
    const itens = DEFEITOS_DE_TESTE[r.defeito].itens as readonly ItemDeLaudo[]
    const b = media(itens.map((i) => mediaDoItem(r.base, i))), v = itens.map((i) => mediaDoItem(r.variante, i))
    // item sem nota (resposta incompleta) = não detectou
    const ok = v.every(Number.isFinite) && Number.isFinite(b) && b - media(v) >= L.quedaMin && Math.min(...v) <= L.notaMaxAfetado
    ;(ok ? detectados : perdidos).push(r.defeito)
    if (!ok && DEFEITOS_DE_TESTE[r.defeito].critico) prob.push(`defeito CRÍTICO não percebido: ${r.defeito}`)
  }
  const taxa = unicos.length ? detectados.length / unicos.length : 0
  if (taxa < L.deteccaoMin) prob.push(`detectou ${detectados.length} de ${unicos.length} defeitos (mín. ${Math.round(L.deteccaoMin * 100)}%)`)
  return { aprovado: prob.length === 0, detectados, perdidos, motivo: prob.length ? prob.join('; ') : `detectou ${detectados.length} de ${unicos.length} defeitos, todos os críticos` }
}

/**
 * Estágios do revisor (P2.74): FUNCIONAMENTO (o pipeline produz laudo completo, com instantes e sha256) NÃO aprova nada;
 * só APTO_PARA_OPERACAO — calibração (bons × ruins, estabilidade) E exame de defeitos aprovados — dá laudo que vale
 * na barreira. Não existe aprovação automática fora desse estágio.
 */
export type EstagioDoRevisor = 'NAO_TESTADO' | 'FUNCIONANDO' | 'CALIBRADO_SEM_EXAME_DE_DEFEITOS' | 'APTO_PARA_OPERACAO' | 'REPROVADO'
export function estagioDoRevisor(p: { laudoDeFuncionamentoOk: boolean; calibracao: CalibracaoRegistrada | null; defeitos: ExameDeDefeitos | null }): { estagio: EstagioDoRevisor; laudoValeNaBarreira: boolean } {
  if (!p.laudoDeFuncionamentoOk) return { estagio: 'NAO_TESTADO', laudoValeNaBarreira: false }
  if (!p.calibracao) return { estagio: 'FUNCIONANDO', laudoValeNaBarreira: false }
  if (!p.calibracao.aprovada || (p.defeitos && !p.defeitos.aprovado)) return { estagio: 'REPROVADO', laudoValeNaBarreira: false }
  if (!p.defeitos) return { estagio: 'CALIBRADO_SEM_EXAME_DE_DEFEITOS', laudoValeNaBarreira: false }
  return { estagio: 'APTO_PARA_OPERACAO', laudoValeNaBarreira: true }
}

// ── 3c. Confiabilidade em operação (P2.75) ────────────────────────────────────────────────────
/**
 * Passar no exame com vídeos CONHECIDOS não garante o futuro. Em operação, o revisor perde a aprovação na hora quando:
 *  - DIVERGÊNCIA: um vídeo que ele aprovou (laudo sem item ≤ 2) é reprovado por quem decide (titular ou revisor humano
 *    cadastrado), ou um vídeo que ele reprovou é aprovado com motivo registrado — erro em produção revoga a calibração;
 *  - AUDITORIA: a cada `AUDITORIA_A_CADA` laudos usados na barreira, 1 vai para revisor humano cadastrado; sem essa
 *    auditoria feita, o laudo seguinte não vale;
 *  - validade de 90 dias, troca de modelo ou de instrução (já existentes).
 * A recalibração usa um conjunto NOVO de variantes (outra base, defeitos sorteados), não o mesmo já visto.
 */
export const AUDITORIA_A_CADA = 5
export interface EventoDeOperacao { tipo: 'DIVERGENCIA' | 'AUDITORIA_OK' | 'LAUDO_USADO'; sha256: string; em: string; detalhe?: string }
export function confiabilidadeEmOperacao(cal: CalibracaoRegistrada, eventos: EventoDeOperacao[]): { vale: boolean; motivo: string } {
  if (!cal.aprovada) return { vale: false, motivo: 'calibração não aprovada' }
  const depois = eventos.filter((e) => Date.parse(e.em) >= Date.parse(cal.em)).sort((a, b) => Date.parse(a.em) - Date.parse(b.em))
  const div = depois.find((e) => e.tipo === 'DIVERGENCIA')
  if (div) return { vale: false, motivo: `revogado: divergência em operação no vídeo ${div.sha256.slice(0, 12)} (${div.detalhe ?? 'sem detalhe'}); recalibrar com conjunto novo` }
  let semAuditoria = 0
  for (const e of depois) { if (e.tipo === 'LAUDO_USADO') semAuditoria++; else if (e.tipo === 'AUDITORIA_OK') semAuditoria = 0 }
  if (semAuditoria >= AUDITORIA_A_CADA) return { vale: false, motivo: `${semAuditoria} laudos usados sem auditoria humana (máx. ${AUDITORIA_A_CADA - 1}): auditar um antes do próximo` }
  return { vale: true, motivo: `em operação; ${semAuditoria} laudo(s) desde a última auditoria` }
}

// ── 4. Custo e orçamento ────────────────────────────────────────────────────────────────────
/** Preços OFICIAIS do nível pago (US$/milhão de tokens), conferidos em ai.google.dev/gemini-api/docs/pricing em
 *  28/10/2026 (comandos ≤ 200 mil tokens). `entradaAudio` quando o áudio tem preço próprio. Os do 3.8 Flash dobram em
 *  01/01/2027 (aqui já se usa o valor de 2027, o mais caro, para o teto não ficar subestimado).
 *  Vídeo: 258 tokens/quadro a 1 quadro/s + 32 tokens/s de áudio ≈ 300 tokens/s (docs/video-understanding). */
export const PRECOS_REFERENCIA = {
  'gemini-2.5-flash': { entrada: 0.3, entradaAudio: 1.0, saida: 2.5 },
  'gemini-2.5-pro': { entrada: 1.25, entradaAudio: 1.25, saida: 10 },
  'gemini-3.8-flash': { entrada: 1.5, entradaAudio: 1.5, saida: 7.5 },
  'gemini-3.1-pro-preview': { entrada: 2.0, entradaAudio: 2.0, saida: 12 },
} as const
export type ModeloRevisor = keyof typeof PRECOS_REFERENCIA
export const TOKENS_POR_SEGUNDO_DE_VIDEO = 300
// achado 6: a saída é LIMITADA na chamada (maxOutputTokens + thinkingBudget) e a estimativa cobre o limite inteiro
export const MAX_TOKENS_DE_SAIDA = 6000, ORCAMENTO_DE_PENSAMENTO = 2048
export const TOKENS_DO_PEDIDO = 4000, TOKENS_DA_RESPOSTA = MAX_TOKENS_DE_SAIDA + ORCAMENTO_DE_PENSAMENTO
export const EXECUCOES_PERMITIDAS = [1, 2, 3] as const

export function estimarCustoUsd(duracaoS: number, modelo: ModeloRevisor, execucoes = 1, folga = 1.5): number {
  const p = PRECOS_REFERENCIA[modelo]
  // 32 tokens/s são de áudio (preço próprio em alguns modelos); o resto é quadro + pedido
  const entrada = ((duracaoS * (TOKENS_POR_SEGUNDO_DE_VIDEO - 32) + TOKENS_DO_PEDIDO) * p.entrada + duracaoS * 32 * p.entradaAudio) / 1e6
  const saida = TOKENS_DA_RESPOSTA / 1e6 * p.saida
  return +((entrada + saida) * execucoes * folga).toFixed(4)
}

export interface Orcamento { autorizado: boolean; tetoPorVideoUsd: number; tetoMensalUsd: number; gastoNoMesUsd: number }
export function podeChamarRevisorPago(o: Orcamento, custoEstimadoUsd: number): { pode: boolean; motivo: string } {
  if (!o.autorizado) return { pode: false, motivo: 'Revisão paga não autorizada pela titular (orçamento de IA paga = R$ 0).' }
  if (custoEstimadoUsd > o.tetoPorVideoUsd) return { pode: false, motivo: `Estimativa US$ ${custoEstimadoUsd} acima do teto por vídeo (US$ ${o.tetoPorVideoUsd}).` }
  if (o.gastoNoMesUsd + custoEstimadoUsd > o.tetoMensalUsd) return { pode: false, motivo: `Teto mensal (US$ ${o.tetoMensalUsd}) seria ultrapassado: gasto ${o.gastoNoMesUsd} + ${custoEstimadoUsd}.` }
  return { pode: true, motivo: 'Dentro do autorizado.' }
}

/** Instrução ao revisor: só o que ele pode ver/ouvir; nada do produtor. */
export function instrucaoDoRevisor(fatos: ReturnType<typeof fatosParaORevisor>, duracaoS: number): string {
  const itens = (Object.keys(RUBRICA) as ItemDeLaudo[]).map((id) => `- ${id}: ${RUBRICA[id].pergunta} (1 = ${RUBRICA[id].um}; 3 = ${RUBRICA[id].tres}; 5 = ${RUBRICA[id].cinco})`).join('\n')
  return [
    'Você é um revisor independente de anúncios em vídeo vertical para Instagram Reels e TikTok no Brasil. Você NÃO produziu este vídeo e não tem acesso a notas de quem produziu.',
    `Assista ao vídeo inteiro (${duracaoS.toFixed(1)} s), com som. Seja exigente: nota 4 ou 5 só para padrão de anúncio profissional publicável.`,
    `Produto anunciado: ${fatos.produto}${fatos.programa ? ` (${fatos.programa})` : ''}. Fatos com fonte que o vídeo pode afirmar: ${fatos.fatosComFonte.join(' | ') || 'nenhum informado'}.`,
    'Para CADA item dê nota inteira de 1 a 5, descreva em pelo menos uma frase o que você VIU ou OUVIU, e cite os instantes (segundos) que comprovam. Sem instante e descrição, o item não conta.',
    itens,
    'Liste também todo defeito encontrado (instante + descrição): erro de pronúncia, texto ilegível, corte brusco, afirmação sem fonte, imagem que não é o produto, etc.',
    'Responda SOMENTE em JSON: {"itens":{"<id>":{"nota":n,"observado":"...","instantes":[s,...]}},"defeitos":[{"instante":s,"descricao":"..."}]}',
  ].join('\n')
}
