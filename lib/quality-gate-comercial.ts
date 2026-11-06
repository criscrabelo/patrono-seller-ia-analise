/**
 * P2.44 — Quality Gate COMERCIAL da montagem (direção criativa). FUNÇÃO PURA, determinística, sem IA.
 *
 * O Quality Gate de texto (`quality-gate-video-tiktok`) avalia roteiro, CTA e divulgação; o do arquivo checa formato.
 * Este avalia o VÍDEO MONTADO como peça comercial: a linha do tempo de falas, tomadas, legendas e áudio, com sinais
 * medidos (movimento por tomada, loudness, voz × trilha). São 12 critérios permanentes (P2.44 §2.1), cada um 0–100 com
 * diagnóstico e CORREÇÃO sugerida em forma executável.
 *
 * Não prevê vendas: "potencial" é heurística declarada. Nunca aprova sozinho para publicação — a titular aprova.
 * Ciclo limitado: no máximo `MAX_TENTATIVAS` montagens por vídeo; esgotado, apresenta a melhor e diz o que falta.
 *
 * P2.66 — ESCOPO REAL (auditoria P2.66-AUDITORIA-DOS-CONTROLES.md): é uma PRÉ-CHECAGEM ESTRUTURAL. Começa em 100 e só
 * desconta o que detecta em metadados (tempos, rótulos declarados, geometria de texto, loudness, movimento médio).
 * Não vê direção de arte, composição, qualidade da voz nem poder de venda: nota alta aqui significa "nenhum defeito
 * estrutural detectado", NÃO "peça publicitária boa". A decisão de levar à titular é da Barreira de Qualidade
 * Profissional (lib/barreira-profissional.ts), com evidência por item e laudo independente.
 */
import { claimsNaoComprovados } from './copy-por-canal'

/** O que aparece na tomada (declarado no plano; conferido no Quality Gate do arquivo/fidelidade). */
export type Mostra =
  | 'CAPA' | 'CONTRACAPA' | 'MAOS' | 'ABRINDO' | 'FOLHEANDO' | 'PAGINA_COM_LOGO' | 'FOLHA_DE_ROSTO'
  | 'ILUSTRACAO_INTERNA' | 'TEXTO_INTERNO_LEGIVEL' | 'PRODUTO_EM_USO'
  // P2.51: produto que não é livro — o produto REAL na tela; e gráfico gerado pelo próprio Patrono (não é o produto).
  | 'PRODUTO_REAL' | 'GRAFICO_DO_PATRONO'

export type Papel = 'GANCHO' | 'APRESENTACAO' | 'DEMONSTRACAO' | 'PROPOSTA' | 'CTA'

export interface FalaDaMontagem { ini: number; fim: number; texto: string; papel: Papel; /** o que a fala pede na imagem */ pede?: Mostra[] }
export interface TomadaDaMontagem {
  ini: number; fim: number
  /** arquivo de origem e o instante de origem (detecta reuso do MESMO trecho) */
  origem: string; origemIni: number
  mostra: Mostra[]
  /** movimento medido, 0–1 (diferença média entre quadros, normalizada). < LIMITES.movimentoParado = parado */
  movimento: number
  /** aproximação aplicada (fator final; 1 = sem zoom) */
  zoom: number
  /** segundos EFETIVOS de exposição por conteúdo, quando menor que a tomada inteira (ex.: texto legível só no fim) */
  mostraPorSegundos?: Partial<Record<Mostra, number>>
  /** gerada/alterada por IA? exige checagem de fidelidade aprovada */
  ia?: { fidelidadeAprovada: boolean }
}
export interface TextoNaTela {
  ini: number; fim: number; texto: string; /** topo e base do texto, px num quadro 1920 */ topo: number; base: number; tipo: 'LEGENDA' | 'DESTAQUE'
  /** P2.65: altura da fonte MEDIDA (px num quadro 1920), quando o motor visual informa */
  tamanhoPx?: number
}
export interface AudioDaMontagem {
  lufs: number; picoDb: number
  /** voz menos trilha, em dB (loudness de cada pista como entra na mixagem) */
  vozSobreTrilhaDb: number | null
  trilha: 'PROPRIA' | 'BIBLIOTECA_COMERCIAL_TIKTOK' | 'LICENCIADA' | 'SEM_LICENCA' | 'NENHUMA'
  vozSintetica: boolean
  /** similaridade média da voz com a referência da titular (0–1), quando sintética */
  similaridadeDaVoz?: number
}
export interface MontagemParaAvaliar {
  duracao: number
  produto: { nome: string; categoria: string | null }
  falas: FalaDaMontagem[]
  tomadas: TomadaDaMontagem[]
  textos: TextoNaTela[]
  audio: AudioDaMontagem
  /** o produto JÁ está marcado no post? (só a titular faz, no app) */
  produtoMarcado: boolean
  /**
   * P2.62. 'OFERTA_SEM_IMAGEM' = vídeo original de texto + narração quando não há mídia do produto com direito
   * (ex.: ML não licencia as fotos dos anúncios). Não mostra o produto e NÃO o simula: sem imagem do produto, sem
   * tomada gerada por IA, e remetendo às fotos/detalhes do anúncio. Uso por campanha é decisão da titular.
   * Ausente = 'PADRAO' (o produto real precisa aparecer).
   */
  formato?: 'PADRAO' | 'OFERTA_SEM_IMAGEM'
  /** P2.62: afiliada com LINK EXTERNO (ex.: Mercado Livre): "link na bio" é o caminho certo, não marcação de produto do TikTok Shop. */
  linkExterno?: boolean
}

const MOSTRA_O_PRODUTO: Mostra[] = ['CAPA', 'PRODUTO_REAL', 'PRODUTO_EM_USO', 'ABRINDO', 'FOLHEANDO', 'MAOS']
/** A CHAMADA (fala de CTA ou texto na tela) manda ver as fotos/detalhes — citar "o anúncio" no meio não basta. */
const REMETE_AO_ANUNCIO = /(fotos?|detalhes|ficha t[eé]cnica)/i

export const CRITERIOS = [
  'aberturaForte', 'propostaClara', 'curiosidade', 'ritmo', 'coerenciaNarracaoImagem', 'naturalidadeDaVoz',
  'trilha', 'fidelidadeAoProduto', 'legendas', 'chamadaParaAcao', 'conformidade', 'potencialDeRetencao',
] as const
export type Criterio = (typeof CRITERIOS)[number]

export type Correcao =
  | { tipo: 'ENCURTAR_TOMADA'; tomada: number; ateSegundos: number; motivo: string }
  | { tipo: 'TROCAR_TOMADA'; tomada: number; motivo: string }
  | { tipo: 'REESCREVER_FALA'; fala: number; motivo: string }
  | { tipo: 'AJUSTAR_AUDIO'; motivo: string }
  | { tipo: 'MOVER_TEXTO'; texto: number; motivo: string }
  | { tipo: 'REMOVER_ZOOM'; tomada: number; motivo: string }

export interface ResultadoDoCriterio { nota: number; diagnostico: string[] }
export interface AvaliacaoComercial {
  veredito: 'APRESENTAR_A_TITULAR' | 'CORRIGIR' | 'BLOQUEADO'
  notaGeral: number
  criterios: Record<Criterio, ResultadoDoCriterio>
  bloqueios: string[]
  correcoes: Correcao[]
  /** itens para a etapa de publicação (não reprovam o vídeo) */
  avisosDePublicacao: string[]
  metricas: Record<string, number>
}

// ── Limites (padrão permanente; mudar aqui) ─────────────────────────────────
export const LIMITES = {
  primeiraFalaAte: 0.6, ganchoTerminaAte: 4.0, produtoNomeadoAte: 9.0,
  // movimentoParado calibrado em 20/10: contracapa parada 0,006; mãos na página 0,010; folheando 0,013–0,028
  tomadaParadaMax: 3.0, movimentoParado: 0.008, tomadaMax: 5.0, mediaDeTomadaMax: 3.8,
  silencioEntreFalasMax: 0.8, caudaMax: 1.2,
  lufsAlvo: -14, lufsTolerancia: 1.5, picoMax: -1.0, vozSobreTrilhaMin: 10, vozSobreTrilhaMax: 18,
  zoomMax: 1.12, legendaMinS: 0.6, caracteresPorLinha: 34, areaSeguraTopo: 220, areaSeguraBase: 1500,
  textoInternoLegivelMax: 0.3, ilustracaoInternaMax: 4.0, ctaTerminaAntesDoFimMax: 1.5,
  similaridadeMin: 0.85, notaMinimaPorCriterio: 70, notaGeralMinima: 80,
  // P2.65 (v2 do Cordão reprovada pela titular: simples demais, letra pequena): mínimos de legibilidade no celular e,
  // em vídeo só de gráficos (OFERTA_SEM_IMAGEM), movimento FORTE nos 2 primeiros segundos (o gráfico é o que prende).
  legendaMinPx: 60, textoMinPx: 34, aberturaGraficaMovimentoMin: 0.02,
} as const
export const MAX_TENTATIVAS = 3

const PROMESSA_INFANTIL = /\b(desenvolv(e|imento)|terap|comprovad|cientificamente|cura|garantid|resolve|acaba com|melhora (o|a|seu|sua)|ajuda (seu|sua|a crian))/i
const PRODUTO_MARCADO = /(produto marcado|link (abaixo|aqui|na bio)|toque no produto|clique no produto)/i
const PERGUNTA_OU_LACUNA = /(\?|\bvoc[eê]\b|\bseu\b|\bsua\b|\bj[aá]\b|\bsabia\b|\bpor que\b|\bcomo\b)/i
const CHAMADA = /(conhec|sacolinha|carrinho|garant|veja|confira|loja|comprar|pe[cç]a)/i

const nota = (v: number) => Math.max(0, Math.min(100, Math.round(v)))
const sobreposicao = (a: { ini: number; fim: number }, b: { ini: number; fim: number }) => Math.max(0, Math.min(a.fim, b.fim) - Math.max(a.ini, b.ini))
const parada = (t: TomadaDaMontagem) => t.movimento < LIMITES.movimentoParado && t.zoom <= 1.0001
const exposicao = (ts: TomadaDaMontagem[], x: Mostra) => ts.filter((t) => t.mostra.includes(x)).reduce((s, t) => s + (t.mostraPorSegundos?.[x] ?? t.fim - t.ini), 0)

export function avaliarMontagem(m: MontagemParaAvaliar): AvaliacaoComercial {
  const L = LIMITES
  const correcoes: Correcao[] = []
  const bloqueios: string[] = []
  const avisos: string[] = []
  const C = {} as Record<Criterio, ResultadoDoCriterio>
  const falas = [...m.falas].sort((a, b) => a.ini - b.ini)
  const tomadas = [...m.tomadas].sort((a, b) => a.ini - b.ini)
  // Nome DISTINTIVO: palavras genéricas de categoria ("livro", "kit"…) não contam como nomear o produto.
  const GENERICAS = new Set(['livro', 'livros', 'kit', 'produto', 'conjunto', 'caixa', 'unidade'])
  const nomeProduto = m.produto.nome.split(/\s+/).map((w) => w.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')).filter((w) => w.length > 3 && !GENERICAS.has(w))
  const temNome = (t: string) => { const n = t.toLowerCase().normalize('NFD').replace(/\p{M}/gu, ''); return nomeProduto.some((w) => n.includes(w)) }

  // 1. Abertura forte: fala cedo, gancho curto com pergunta/lacuna, imagem em movimento nos 2 primeiros segundos.
  {
    const d: string[] = []; let n = 100
    const f0 = falas[0]
    if (!f0 || f0.ini > L.primeiraFalaAte) { n -= 25; d.push(`A primeira fala começa em ${f0?.ini.toFixed(2) ?? '—'} s (alvo ≤ ${L.primeiraFalaAte} s).`) }
    const g = falas.find((f) => f.papel === 'GANCHO')
    if (!g) { n -= 45; d.push('Não há fala de GANCHO.') ; if (f0) correcoes.push({ tipo: 'REESCREVER_FALA', fala: 0, motivo: 'Abrir com uma pergunta ou lacuna sobre a dor/curiosidade do público.' }) }
    else {
      if (g.fim > L.ganchoTerminaAte) { n -= 20; d.push(`O gancho termina em ${g.fim.toFixed(1)} s (alvo ≤ ${L.ganchoTerminaAte} s).`) }
      if (!PERGUNTA_OU_LACUNA.test(g.texto)) { n -= 25; d.push('O gancho não é pergunta nem fala com o público (genérico).'); correcoes.push({ tipo: 'REESCREVER_FALA', fala: falas.indexOf(g), motivo: 'Gancho genérico: transformar em pergunta/lacuna dirigida ao público.' }) }
    }
    const abertura = tomadas.filter((t) => t.ini < 2)
    if (abertura.length && abertura.every(parada)) { n -= 20; d.push('Os 2 primeiros segundos estão parados.'); correcoes.push({ tipo: 'TROCAR_TOMADA', tomada: tomadas.indexOf(abertura[0]), motivo: 'Abrir com movimento (mãos/abertura) ou aproximação moderada.' }) }
    else if (m.formato === 'OFERTA_SEM_IMAGEM' && abertura.length && Math.max(...abertura.map((t) => t.movimento)) < L.aberturaGraficaMovimentoMin) {
      n -= 15; d.push(`Abertura gráfica fraca: movimento ${Math.max(...abertura.map((t) => t.movimento)).toFixed(3)} nos 2 primeiros segundos (mín. ${L.aberturaGraficaMovimentoMin}).`)
    }
    C.aberturaForte = { nota: nota(n), diagnostico: d }
  }

  // 2. Proposta clara: o produto é NOMEADO cedo, numa fala de apresentação.
  {
    const d: string[] = []; let n = 100
    const ap = falas.find((f) => temNome(f.texto))
    if (!ap) { n -= 60; d.push('O nome do produto não é dito.') }
    else if (ap.ini > L.produtoNomeadoAte) { n -= 30; d.push(`O produto só é nomeado em ${ap.ini.toFixed(1)} s (alvo ≤ ${L.produtoNomeadoAte} s).`) }
    if (!falas.some((f) => f.papel === 'PROPOSTA' || f.papel === 'DEMONSTRACAO')) { n -= 30; d.push('Falta explicar a proposta do produto.') }
    C.propostaClara = { nota: nota(n), diagnostico: d }
  }

  // 3. Curiosidade: gancho em forma de pergunta/lacuna RESPONDIDA depois pela apresentação.
  {
    const d: string[] = []; let n = 40
    const gi = falas.findIndex((f) => f.papel === 'GANCHO')
    if (gi >= 0 && /\?/.test(falas[gi].texto)) n += 35
    else d.push('Sem pergunta que o vídeo responda.')
    if (gi >= 0 && falas.slice(gi + 1).some((f) => f.papel === 'APRESENTACAO')) n += 25
    else d.push('A apresentação não vem logo depois do gancho.')
    C.curiosidade = { nota: nota(n), diagnostico: d }
  }

  // 4. Ritmo: tomadas paradas curtas, duração média e máxima, reuso do mesmo trecho.
  {
    const d: string[] = []; let n = 100
    tomadas.forEach((t, i) => {
      const dur = t.fim - t.ini
      if (parada(t) && dur > L.tomadaParadaMax) { n -= 15; d.push(`Tomada ${i + 1} parada por ${dur.toFixed(1)} s.`); correcoes.push({ tipo: 'ENCURTAR_TOMADA', tomada: i, ateSegundos: L.tomadaParadaMax, motivo: 'Cena estática longa.' }) }
      else if (dur > L.tomadaMax) { n -= 8; d.push(`Tomada ${i + 1} longa (${dur.toFixed(1)} s).`); correcoes.push({ tipo: 'ENCURTAR_TOMADA', tomada: i, ateSegundos: L.tomadaMax, motivo: 'Tomada longa demais para o ritmo.' }) }
    })
    const media = m.duracao / Math.max(1, tomadas.length)
    if (media > L.mediaDeTomadaMax) { n -= 15; d.push(`Duração média de tomada ${media.toFixed(1)} s (alvo ≤ ${L.mediaDeTomadaMax} s).`) }
    for (let i = 0; i < tomadas.length; i++) for (let j = i + 1; j < tomadas.length; j++) {
      const a = tomadas[i], b = tomadas[j]
      const ra = { ini: a.origemIni, fim: a.origemIni + (a.fim - a.ini) }, rb = { ini: b.origemIni, fim: b.origemIni + (b.fim - b.ini) }
      if (a.origem === b.origem && sobreposicao(ra, rb) > 0.3) { n -= 20; d.push(`Tomadas ${i + 1} e ${j + 1} repetem o mesmo trecho.`); correcoes.push({ tipo: 'TROCAR_TOMADA', tomada: j, motivo: 'Repetição perceptível.' }) }
    }
    // Trecho sem função: tomada longa sem fala nem texto por cima.
    tomadas.forEach((t, i) => {
      const comFala = falas.reduce((s, f) => s + sobreposicao(t, f), 0) + m.textos.reduce((s, x) => s + sobreposicao(t, x), 0)
      if (t.fim - t.ini > 1.5 && comFala < 0.2) { n -= 10; d.push(`Tomada ${i + 1} sem fala nem texto (sem função narrativa).`) }
    })
    C.ritmo = { nota: nota(n), diagnostico: d }
  }

  // 5. Coerência: o que cada fala pede aparece na imagem durante a maior parte da fala.
  {
    const d: string[] = []; let soma = 0, k = 0
    falas.forEach((f, i) => {
      if (!f.pede?.length) return
      const dur = f.fim - f.ini
      const coberto = tomadas.filter((t) => t.mostra.some((x) => f.pede!.includes(x))).reduce((s, t) => s + sobreposicao(t, f), 0)
      const r = dur > 0 ? coberto / dur : 0
      soma += r; k++
      if (r < 0.5) d.push(`Fala ${i + 1} ("${f.texto.slice(0, 30)}…") pede ${f.pede.join('/')} mas só ${Math.round(r * 100)}% da fala mostra isso.`)
    })
    // P2.66: "pede gráfico" × "mostra gráfico" é tautologia (o próprio produtor rotula as duas pontas): não comprova
    // que a imagem ilustra o que a fala diz. Sem rótulo de conteúdo real, a coerência fica abaixo do mínimo.
    const soGenerico = falas.every((f) => !f.pede?.length || f.pede.every((x) => x === 'GRAFICO_DO_PATRONO'))
    if (k && soGenerico) d.push('Coerência não comprovada: fala e imagem só rotuladas como "gráfico do Patrono" (avaliar no laudo da Barreira Profissional).')
    C.coerenciaNarracaoImagem = { nota: nota(k ? (soGenerico ? Math.min(60, (soma / k) * 100) : (soma / k) * 100) : 60), diagnostico: k ? d : ['Falas sem indicação do que pedem na imagem.'] }
  }

  // 6. Naturalidade da voz: silêncios, cauda, similaridade com a titular.
  {
    const d: string[] = []; let n = 100
    for (let i = 1; i < falas.length; i++) {
      const gap = falas[i].ini - falas[i - 1].fim
      if (gap > L.silencioEntreFalasMax) { n -= 12; d.push(`Silêncio de ${gap.toFixed(2)} s antes da fala ${i + 1}.`) }
    }
    const cauda = m.duracao - (falas.at(-1)?.fim ?? 0)
    if (cauda > L.caudaMax) { n -= 10; d.push(`Final sem fala por ${cauda.toFixed(1)} s.`) }
    if (m.audio.vozSintetica && (m.audio.similaridadeDaVoz ?? 0) < L.similaridadeMin) { n -= 30; d.push(`Similaridade da voz ${(m.audio.similaridadeDaVoz ?? 0).toFixed(2)} < ${L.similaridadeMin}.`) }
    C.naturalidadeDaVoz = { nota: nota(n), diagnostico: d }
  }

  // 7. Trilha: licença, voz claramente acima, loudness de plataforma.
  {
    const d: string[] = []; let n = 100
    const a = m.audio
    if (a.trilha === 'SEM_LICENCA') { n = 0; bloqueios.push('Trilha sem licença comercial.') }
    if (a.trilha === 'NENHUMA') { n -= 30; d.push('Sem trilha.') }
    if (a.trilha === 'BIBLIOTECA_COMERCIAL_TIKTOK') avisos.push('Escolher a música na Biblioteca Comercial do TikTok ao publicar.')
    if (a.vozSobreTrilhaDb !== null && a.vozSobreTrilhaDb < L.vozSobreTrilhaMin) { n -= 25; d.push(`Voz só ${a.vozSobreTrilhaDb.toFixed(1)} dB acima da trilha (mín. ${L.vozSobreTrilhaMin}).`); correcoes.push({ tipo: 'AJUSTAR_AUDIO', motivo: 'Baixar a trilha.' }) }
    if (a.trilha !== 'NENHUMA' && a.vozSobreTrilhaDb !== null && a.vozSobreTrilhaDb > L.vozSobreTrilhaMax) { n -= 30; d.push(`Trilha praticamente inaudível: ${a.vozSobreTrilhaDb.toFixed(1)} dB abaixo da voz (máx. ${L.vozSobreTrilhaMax}).`); correcoes.push({ tipo: 'AJUSTAR_AUDIO', motivo: 'Subir a trilha: ela não contribui para a emoção.' }) }
    if (Math.abs(a.lufs - L.lufsAlvo) > L.lufsTolerancia) { n -= 20; d.push(`Loudness ${a.lufs} LUFS (alvo ${L.lufsAlvo} ± ${L.lufsTolerancia}).`); correcoes.push({ tipo: 'AJUSTAR_AUDIO', motivo: 'Normalizar loudness.' }) }
    if (a.picoDb > L.picoMax) { n -= 15; d.push(`Pico ${a.picoDb} dBFS.`) }
    C.trilha = { nota: nota(n), diagnostico: d }
  }

  // 8. Fidelidade: produto real; IA só com checagem aprovada; zoom moderado.
  {
    const d: string[] = []; let n = 100
    tomadas.forEach((t, i) => {
      if (t.ia && !t.ia.fidelidadeAprovada) { n = 0; bloqueios.push(`Tomada ${i + 1} gerada por IA sem checagem de fidelidade aprovada.`) }
      if (t.zoom > L.zoomMax) { n -= 20; d.push(`Tomada ${i + 1} com aproximação ${t.zoom.toFixed(2)}× (máx. ${L.zoomMax}×).`); correcoes.push({ tipo: 'REMOVER_ZOOM', tomada: i, motivo: 'Aproximação exagerada.' }) }
    })
    if (m.formato === 'OFERTA_SEM_IMAGEM') {
      // P2.62: honesto por construção — nada do produto na tela, nada simulado, e o público é mandado ao anúncio.
      if (tomadas.some((t) => t.mostra.some((x) => MOSTRA_O_PRODUTO.includes(x)))) { n = 0; bloqueios.push('Formato "oferta sem imagem" com imagem do produto: use o formato padrão, com a mídia de direito comprovado.') }
      if (tomadas.some((t) => t.ia)) { n = 0; bloqueios.push('Formato "oferta sem imagem" não admite tomada gerada por IA (seria demonstração simulada do produto).') }
      if (![...falas.filter((f) => f.papel === 'CTA').map((f) => f.texto), ...m.textos.map((t) => t.texto)].some((t) => REMETE_AO_ANUNCIO.test(t))) { n = 0; bloqueios.push('Formato "oferta sem imagem" precisa mandar o público ver as fotos e detalhes no anúncio.') }
      n = Math.min(n, 75)
      d.push('Formato sem imagem do produto: só informações do anúncio, atribuídas a ele (uso aprovado pela titular por campanha).')
    } else if (!tomadas.some((t) => t.mostra.includes('CAPA'))) {
      // P2.51: fora de livro, a identificação é o produto real (sozinho ou em uso). Vídeo comercial sem o produto real
      // na tela (só gráficos) é BLOQUEIO: não se vende o que não se mostra (fidelidade ao produto).
      const livro = /livro/i.test(m.produto.categoria ?? '')
      if (livro) { n -= 40; d.push('A capa (identificação do produto) nunca aparece.') }
      else if (!tomadas.some((t) => t.mostra.includes('PRODUTO_REAL') || t.mostra.includes('PRODUTO_EM_USO'))) { n = 0; d.push('O produto real nunca aparece (só gráficos).'); bloqueios.push('O produto real nunca aparece no vídeo: falta mídia do produto com direito de uso (própria, licenciada ou autorizada).') }
    }
    C.fidelidadeAoProduto = { nota: nota(n), diagnostico: d }
  }

  // 9. Legendas e textos: duração mínima, sem sobreposição do mesmo tipo, área segura, linhas curtas.
  {
    const d: string[] = []; let n = 100
    m.textos.forEach((t, i) => {
      if (t.fim - t.ini < L.legendaMinS) { n -= 8; d.push(`Texto ${i + 1} fica só ${(t.fim - t.ini).toFixed(2)} s.`) }
      if (t.topo < L.areaSeguraTopo || t.base > L.areaSeguraBase) { n -= 15; d.push(`Texto ${i + 1} fora da área segura (${t.topo}–${t.base} px).`); correcoes.push({ tipo: 'MOVER_TEXTO', texto: i, motivo: 'Fora da área segura do TikTok.' }) }
      if (t.texto.split('\n').some((l) => l.length > L.caracteresPorLinha + (t.tipo === 'LEGENDA' ? 8 : 0))) { n -= 6; d.push(`Texto ${i + 1} com linha longa.`) }
      const minPx = t.tipo === 'LEGENDA' ? L.legendaMinPx : L.textoMinPx
      if (t.tamanhoPx !== undefined && t.tamanhoPx < minPx) { n -= 10; d.push(`Texto ${i + 1} pequeno para celular (${t.tamanhoPx} px; mín. ${minPx}).`) }
    })
    for (let i = 0; i < m.textos.length; i++) for (let j = i + 1; j < m.textos.length; j++) {
      const a = m.textos[i], b = m.textos[j]
      const mesmaFaixa = !(a.base <= b.topo || b.base <= a.topo)
      if (sobreposicao(a, b) > 0.05 && mesmaFaixa) { n -= 15; d.push(`Textos ${i + 1} e ${j + 1} se sobrepõem.`) }
    }
    C.legendas = { nota: nota(n), diagnostico: d }
  }

  // 10. CTA: no fim, natural, sem dizer "produto marcado" antes de marcar.
  {
    const d: string[] = []; let n = 100
    const cta = falas.filter((f) => f.papel === 'CTA').at(-1)
    if (!cta) { n -= 60; d.push('Sem chamada para ação.') }
    else {
      if (cta.fim < m.duracao - L.ctaTerminaAntesDoFimMax) { n -= 20; d.push(`A chamada termina ${(m.duracao - cta.fim).toFixed(1)} s antes do fim.`) }
      if (!CHAMADA.test(cta.texto)) { n -= 20; d.push('A chamada não convida a conhecer/comprar.') }
      const linkNaBioExterno = m.linkExterno && /link (n|d)a bio/i.test(cta.texto) && !/sacolinha|carrinho|produto marcado|toque no produto|clique no produto/i.test(cta.texto)
      if (PRODUTO_MARCADO.test(cta.texto) && !m.produtoMarcado && !linkNaBioExterno) { n -= 40; d.push('Fala em produto marcado/link antes da marcação.') }
      if (/sacolinha|carrinho/i.test(cta.texto)) avisos.push('A fala cita a sacolinha: só publicar com o produto MARCADO no post (Adicionar link → Produtos).')
    }
    C.chamadaParaAcao = { nota: nota(n), diagnostico: d }
  }

  // 11. Conformidade: promessas/alegações, exposição de páginas internas, rótulo de IA.
  {
    const d: string[] = []; let n = 100
    const tudo = [...falas.map((f) => f.texto), ...m.textos.map((t) => t.texto)].join(' ')
    const alegacoes = claimsNaoComprovados(tudo)
    if (PROMESSA_INFANTIL.test(tudo) || alegacoes.length) { n = 0; bloqueios.push(`Promessa/alegação não comprovada: ${[...alegacoes, tudo.match(PROMESSA_INFANTIL)?.[0]].filter(Boolean).join(', ')}.`) }
    const legivel = exposicao(tomadas, 'TEXTO_INTERNO_LEGIVEL')
    if (legivel > L.textoInternoLegivelMax) { n -= 40; d.push(`Texto interno legível por ${legivel.toFixed(1)} s (máx. ${L.textoInternoLegivelMax} s).`) }
    const ilustr = exposicao(tomadas, 'ILUSTRACAO_INTERNA')
    if (ilustr > L.ilustracaoInternaMax) { n -= 25; d.push(`Ilustração interna por ${ilustr.toFixed(1)} s (máx. ${L.ilustracaoInternaMax} s).`) }
    tomadas.forEach((t, i) => {
      if (t.zoom > 1.0001 && t.mostra.some((x) => x === 'ILUSTRACAO_INTERNA' || x === 'TEXTO_INTERNO_LEGIVEL')) { n -= 30; d.push(`Aproximação sobre página interna na tomada ${i + 1}.`); correcoes.push({ tipo: 'REMOVER_ZOOM', tomada: i, motivo: 'Sem zoom em ilustração/página interna.' }) }
      if (parada(t) && t.mostra.includes('ILUSTRACAO_INTERNA')) { n -= 15; d.push(`Ilustração interna parada na tomada ${i + 1}.`) }
    })
    if (m.audio.vozSintetica) avisos.push('Voz sintética: ligar "Conteúdo gerado por IA" no post.')
    if (tomadas.some((t) => t.mostra.some((x) => ['CAPA', 'CONTRACAPA', 'FOLHA_DE_ROSTO', 'ILUSTRACAO_INTERNA'].includes(x)))) avisos.push('Mostra obra protegida (capa/páginas): avaliar autorização da editora/titulares; a edição reduz, não elimina, o risco.')
    C.conformidade = { nota: nota(n), diagnostico: d }
  }

  // 12. Potencial de retenção/conversão — HEURÍSTICA declarada (não previsão).
  {
    const dur = m.duracao
    const n = C.aberturaForte.nota * 0.35 + C.ritmo.nota * 0.25 + C.chamadaParaAcao.nota * 0.2 + (dur >= 12 && dur <= 34 ? 20 : 8)
    C.potencialDeRetencao = { nota: nota(n), diagnostico: ['Heurística (abertura 35%, ritmo 25%, CTA 20%, duração 20%): não prevê views nem vendas.'] }
  }

  const notas = CRITERIOS.map((c) => C[c].nota)
  const notaGeral = nota(notas.reduce((s, x) => s + x, 0) / notas.length)
  const algumBaixo = notas.some((x) => x < L.notaMinimaPorCriterio)
  const veredito = bloqueios.length ? 'BLOQUEADO' : algumBaixo || notaGeral < L.notaGeralMinima ? 'CORRIGIR' : 'APRESENTAR_A_TITULAR'
  const paradas = tomadas.filter(parada)
  const metricas = {
    duracao: m.duracao,
    tomadas: tomadas.length,
    mediaDeTomadaS: Math.round((m.duracao / Math.max(1, tomadas.length)) * 100) / 100,
    maiorTomadaParadaS: Math.round(Math.max(0, ...paradas.map((t) => t.fim - t.ini)) * 100) / 100,
    primeiraFalaS: falas[0]?.ini ?? -1,
    produtoNomeadoS: falas.find((f) => temNome(f.texto))?.ini ?? -1,
    ilustracaoInternaS: Math.round(exposicao(tomadas, 'ILUSTRACAO_INTERNA') * 100) / 100,
    textoInternoLegivelS: Math.round(exposicao(tomadas, 'TEXTO_INTERNO_LEGIVEL') * 100) / 100,
    capaS: Math.round(exposicao(tomadas, 'CAPA') * 100) / 100,
    vozSobreTrilhaDb: m.audio.vozSobreTrilhaDb ?? -1,
  }
  return { veredito, notaGeral, criterios: C, bloqueios, correcoes, avisosDePublicacao: [...new Set(avisos)], metricas }
}

/**
 * Ciclo LIMITADO: decide o próximo passo a partir das avaliações já feitas deste vídeo.
 * Nunca aprova para publicação: o melhor resultado vai para a TITULAR, com o que ainda falta.
 */
export function proximoPasso(historico: AvaliacaoComercial[]): { acao: 'CORRIGIR' | 'APRESENTAR' | 'APRESENTAR_MELHOR_COM_RESSALVAS' | 'PARAR_BLOQUEADO'; melhor: number; motivo: string } {
  if (!historico.length) throw new Error('sem avaliação')
  const melhor = historico.reduce((bi, a, i) => (a.veredito !== 'BLOQUEADO' && (historico[bi].veredito === 'BLOQUEADO' || a.notaGeral > historico[bi].notaGeral) ? i : bi), 0)
  const ultima = historico.at(-1)!
  if (ultima.veredito === 'APRESENTAR_A_TITULAR') return { acao: 'APRESENTAR', melhor: historico.length - 1, motivo: 'Passou em todos os critérios.' }
  if (historico.length < MAX_TENTATIVAS && ultima.correcoes.length) return { acao: 'CORRIGIR', melhor, motivo: `Tentativa ${historico.length}/${MAX_TENTATIVAS}: aplicar ${ultima.correcoes.length} correção(ões).` }
  if (historico[melhor].veredito === 'BLOQUEADO') return { acao: 'PARAR_BLOQUEADO', melhor, motivo: historico[melhor].bloqueios.join(' ') }
  return { acao: 'APRESENTAR_MELHOR_COM_RESSALVAS', melhor, motivo: `Limite de ${MAX_TENTATIVAS} tentativas: apresentar a melhor (nota ${historico[melhor].notaGeral}) com o que ainda falta.` }
}
