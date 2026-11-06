/**
 * P2.69+ — CONFERÊNCIA SEMÂNTICA dos números do vídeo (ditos, mostrados ou na legenda do post).
 *
 * Cada número vira uma AFIRMAÇÃO: valor + atributo (do que é o número) + comparador ("mais de", "quase", "até").
 * Ela só é aceita se a ficha tiver um fato que diga a MESMA coisa, conferido em três camadas:
 *   1. atributo, valor e comparador iguais (nota, vendas, avaliações, preço de/por/parcela, "anos de GARANTIA"…);
 *   2. as palavras PRÓXIMAS do número no vídeo (até 2 de cada lado) estão NO MESMO fato
 *      ("6,5 polegadas de BATERIA" não casa com "tela de 6,5 polegadas");
 *   3. as demais palavras da oração estão em ALGUM fato ou no nome do produto
 *      ("FRETE GRÁTIS a partir de R$ 79", "LAVA 3 vezes mais RÁPIDO", "RESTAM 2 unidades" não passam).
 * Número cujo significado não se estabelece é REPROVADO — nunca presumido. Dígito que não vira número (código
 * desconhecido, algarismo de outro sistema, fração "½") também reprova, salvo código que esteja na ficha ("A4").
 *
 * Revisões independentes P2.69+ (achados 1–12 e 1–12 da segunda rodada) estão cobertas em tests/rodada162.
 */

const NUM: Record<string, number> = {
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13,
  catorze: 14, quatorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50,
  sessenta: 60, setenta: 70, oitenta: 80, noventa: 90, cem: 100, cento: 100, duzentos: 200, duzentas: 200, trezentos: 300, trezentas: 300,
  quatrocentos: 400, quatrocentas: 400, quinhentos: 500, quinhentas: 500, seiscentos: 600, seiscentas: 600, setecentos: 700, setecentas: 700,
  oitocentos: 800, oitocentas: 800, novecentos: 900, novecentas: 900,
}
/** afirmações sem valor exato: precisam de um fato com a MESMA expressão */
const EXPRESSOES = new Set(['metade', 'dobro', 'triplo', 'milhares', 'milhar', 'centenas', 'centena', 'dezenas', 'dezena', 'milhoes', 'milhao', 'bilhoes', 'bilhao', 'terco', 'tercos', 'maxima', 'maximo'])
/** ordinais só são afirmação diante destes substantivos ("segunda unidade"); "segundo o fabricante" não é */
const ORDINAIS = new Set(['primeiro', 'primeira', 'segundo', 'segunda', 'terceiro', 'terceira', 'quarto', 'quarta', 'quinto', 'quinta', 'sexto', 'sexta', 'decimo', 'decima'])
/** "segundo o fabricante" não é ordinal */
const NAO_ORDINAL_DEPOIS = /^(o|a|os|as|ele|ela|eles|elas)$/
const MESES = /^(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)$/

type Token = { t: string; n?: undefined; e?: undefined } | { n: number; origem: string; t?: undefined; e?: undefined } | { e: string; t?: undefined; n?: undefined }
const SEP = '|'
/** fim de FRASE (. ! ? ; e quebra de linha) — também é fim de oração */
const FIM = '#'
const ehSep = (w: string | undefined) => w === SEP || w === FIM
const ILEGIVEL = 'numeroilegivel'
const MARCA_DE_HASHTAG = 'zzhashtag'
const RAIZES_COMERCIAIS = /frete|gratis|juros|pix|hoje|desconto|cupom|promo|avista|black|friday|liquida|ultimas|estoque|parcel|mensal|anual|semana|cashback|oferta/g

/** "1.600" → 1600, "1.600,00" → 1600, "4,9" → 4.9, "4.9" e "5.3" → decimal; sufixo mil/milhão multiplica */
export function valorDeAlgarismos(t: string, sufixo?: string | null): number {
  let v: number
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) v = Number(t.replace(/\./g, ''))
  else if (/^\d{1,3}(\.\d{3})+,\d+$/.test(t)) v = Number(t.replace(/\./g, '').replace(',', '.'))
  else if (/^\d+,\d+$/.test(t)) v = Number(t.replace(',', '.'))
  else if (/^\d+\.\d{1,2}$/.test(t)) v = Number(t)
  else v = Number(t.replace(/[.,]/g, ''))
  if (sufixo) v *= /^mil$/i.test(sufixo) ? 1000 : 1_000_000
  return +v.toFixed(6)
}

// ── vocabulário ──────────────────────────────────────────────────────────────────────────────────────────────
const ATRIBUTOS: [RegExp, string][] = [
  [/^(nota|estrelas?|avaliacao|classificacao)$/, 'NOTA'],
  [/^(avaliacoes|opinioes|comentarios|reviews?|resenhas|classificacoes)$/, 'QTD_AVALIACOES'],
  [/^(vendas|vendid[oa]s?|compras|pedidos)$/, 'VENDAS'],
  [/^(reais|real|preco|custa|custando)$/, 'PRECO'],
  [/^paginas?$/, 'PAGINAS'],
  [/^(leds?|lampadas?)$/, 'LEDS'],
  [/^gramatura$/, 'GRAMATURA'],
  [/^escala$/, 'ESCALA'],
]
/** unidades que NÃO dizem do que é o número: exigem qualificador ("2 anos de garantia", "20 W de potência") */
const UNIDADES: [RegExp, string, number][] = [
  [/^anos?$/, 'ANOS', 1], [/^(mes|meses)$/, 'MESES', 1], [/^dias?$/, 'DIAS', 1], [/^(h|horas?)$/, 'HORAS', 1], [/^(min|minutos?)$/, 'MINUTOS', 1], [/^segundos?$/, 'SEGUNDOS', 1], [/^semanas?$/, 'SEMANAS', 1],
  [/^(cm|centimetros?)$/, 'COMPRIMENTO_CM', 1], [/^(mm|milimetros?)$/, 'COMPRIMENTO_CM', 0.1], [/^(m|metros?)$/, 'COMPRIMENTO_CM', 100],
  [/^(g|gramas?)$/, 'MASSA_G', 1], [/^(kg|quilos?|quilogramas?)$/, 'MASSA_G', 1000],
  [/^(ml|mililitros?)$/, 'VOLUME_ML', 1], [/^(l|litros?)$/, 'VOLUME_ML', 1000],
  [/^(w|watts?)$/, 'POTENCIA_W', 1], [/^(v|volts?)$/, 'TENSAO_V', 1], [/^(gb|gigas?)$/, 'MEMORIA_GB', 1], [/^mah$/, 'BATERIA_MAH', 1],
  [/^(pol|polegadas?)$/, 'POLEGADAS', 1],
  [/^porcento$/, 'PERCENTUAL', 1],
]
const PESSOAS = /^(pessoas|clientes|compradores|usuarios|consumidores)$/
const PAGAMENTO = /^(juros|cartao|parcelas?|parcelad[oa]s?|boleto)$/
/** preço que NÃO é o preço do produto (frete mínimo, cupom, economia…) */
const PRECO_DE_OUTRA_COISA = /^(frete|cupom|cupons|economize|economia|ganhe|cashback|desconto|compras|pedido|minimo|partir|acima)$/
const PRECO_ANTIGO = /^(antes|era|antigo|original)$/
/** palavras que não carregam significado na conferência de contexto */
const NEUTRAS = new Set(['de', 'do', 'da', 'dos', 'das', 'e', 'o', 'a', 'os', 'as', 'ao', 'aos', 'um', 'uma', 'uns', 'umas', 'em', 'no', 'na', 'nos', 'nas', 'com', 'por', 'para', 'pra', 'que', 'esse', 'essa', 'este', 'esta', 'isso', 'seu', 'sua', 'sao', 'e', 'eh', 'tem', 'ja', 'so', 'apenas', 'somente', 'muito', 'bem', 'ou', 'mais', 'menos', 'quase', 'cerca', 'ate', 'acima', 'abaixo', 'aproximadamente', 'vem', 'sai'])
/** recipientes: "em PACOTE de 500 folhas", "KIT com 2" — não mudam o que o número afirma */
const RECIPIENTES = /^(pacotes?|kits?|caixas?|embalage(m|ns)|conjuntos?|jogos?|produtos?)$/
const QUALIFICADOR_CANONICO: Record<string, string> = { off: 'desconto', descontos: 'desconto' }
const JANELA = 5

const atributoDe = (w: string | undefined) => (w ? ATRIBUTOS.find(([r]) => r.test(w))?.[1] ?? null : null)
const unidadeDe = (w: string | undefined) => (w ? UNIDADES.find(([r]) => r.test(w)) ?? null : null)
const radical = (w: string) => { if (QUALIFICADOR_CANONICO[w]) return QUALIFICADOR_CANONICO[w]; const r = w.replace(/oes$/, 'ao').replace(/([rsz])es$/, '$1').replace(/s$/, ''); return QUALIFICADOR_CANONICO[r] ?? r }
const ehPalavraNumero = (p: string | undefined) => !!p && (p in NUM || p === 'mil')
const ehCodigo = (w: string) => /\d/.test(w) || w === ILEGIVEL

// ── tokens ──────────────────────────────────────────────────────────────────────────────────────────────────
export function tokenizar(texto: string): Token[] {
  const s = texto
    // P2.74: o endereço do TEXTO DA LICENÇA Creative Commons ("…/by-sa/4.0") é obrigação de atribuição, não afirmação
    // sobre o produto. Só esse domínio: número em qualquer outro link continua sendo conferido.
    .replace(/(?:https?:\/\/)?(?:www\.)?creativecommons\.org\/[\w./-]*/gi, ' ')
    // hashtag sem algarismo não é afirmação; com algarismo ("#50off", "#top1") é código a conferir ("#papelA4" contém "a4")
    .replace(/#([\p{L}\p{N}_]+)/gu, (_m, h: string) => {
      if (/\d/.test(h)) return ` ${MARCA_DE_HASHTAG}${h.replace(/_/g, '')} `
      // "#fretegratis", "#sohoje", "#pix": condição comercial disfarçada de hashtag vira oração própria
      const raizes = (h.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').match(RAIZES_COMERCIAIS) ?? [])
      return raizes.length ? ` , ${raizes.join(' ')} , ` : ' '
    })
    .normalize('NFKC') // algarismos de largura cheia → ASCII
    .replace(/[²]/g, ' quadrado ').replace(/[³]/g, ' cubico ')
    .replace(/[^\p{ASCII}]/gu, (c) => (/[\p{Nd}\p{No}]/u.test(c) ? ` ${ILEGIVEL} ` : c)) // "٥", "½": não há como conferir
    .toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[★⭐]/gu, ' estrelas ')
    .replace(/g\s*\/\s*m\s*(quadrado|2)\b|gramas?\s+por\s+metro\s+quadrado/g, ' gramatura ')
    .replace(/r\$/g, ' reais ').replace(/%/g, ' porcento ').replace(/\bpor\s+cento\b/g, ' porcento ')
    .replace(/(\d[\d.,]*\s*(?:k|mil)?)\s*\+/g, ' mais de $1 ')
    .replace(/\+\s*(de\s+)?(?=\d)/g, ' mais de ')
    .replace(/>\s*(?=\d)/g, ' mais de ')
    .replace(/[~≈]\s*(?=(r\$|\s*reais|\d))/gi, ' cerca de ')
    .replace(/:/g, ' ')
    .replace(/(?<![a-z0-9])(\d+(?:[.,]\d+)?)\s*k\b/g, '$1 mil') // "10k" = 10 mil
    .replace(/(?<![a-z0-9])(\d+(?:[.,]\d+)*)\s*(anos?|meses|mes|dias?|horas?|h|min|cm|mm|ml|kg|m|g|l|x|w|v|gb|mah|pol|polegadas?)\b/g, '$1 $2') // "5anos", "120cm", "3x"
  const brutos: Token[] = []
  // algarismos ANTES da pontuação virar separador (a vírgula de "4,9" é decimal); colado em letra ("A4", "PS5") é código
  const partes = s.split(/((?<![a-z0-9])\d+(?:[.,]\d+)*(?:\s*(?:mil|milhao|milhoes)\b)?)(?![a-z0-9])/)
  partes.forEach((p, i) => {
    if (i % 2 === 1) {
      const m = p.match(/^(\d+(?:[.,]\d+)*)\s*(mil|milhao|milhoes)?$/)!
      brutos.push({ n: valorDeAlgarismos(m[1], m[2]), origem: p.trim() })
      return
    }
    for (const w of p.replace(/[.!?;\n]/g, ` ${FIM} `).replace(/[,()[\]"“”/—–]/g, ` ${SEP} `).replace(/[^a-z0-9|# ]/g, ' ').split(/\s+/).filter(Boolean)) brutos.push({ t: w })
  })
  const out: Token[] = []
  const pal = (k: number) => brutos[k]?.t
  for (let i = 0; i < brutos.length;) {
    const w = pal(i)
    if (w !== undefined && (EXPRESSOES.has(w) || (ORDINAIS.has(w) && !((w === 'segundo' || w === 'segunda') && NAO_ORDINAL_DEPOIS.test(pal(i + 1) ?? ''))))) { out.push({ e: w }); i++; continue }
    if ((w === 'meia' || w === 'meio') && (pal(i + 1) === 'duzia' || unidadeDe(pal(i + 1)))) {
      const duzia = pal(i + 1) === 'duzia'
      out.push({ n: duzia ? 6 : 0.5, origem: `${w}${duzia ? ' duzia' : ''}` }); i += duzia ? 2 : 1; continue
    }
    // "5 mil e quinhentos" = 5500
    const anterior = out[out.length - 1]
    if (w === 'e' && anterior?.n !== undefined && /mil$/.test(anterior.origem) && ehPalavraNumero(pal(i + 1)) && pal(i + 1) !== 'mil') {
      let j = i + 1, resto = 0
      for (; j < brutos.length && (pal(j)! in NUM || (pal(j) === 'e' && (pal(j + 1) ?? '') in NUM)); j++) if (pal(j)! in NUM) resto += NUM[pal(j)!]
      if (resto > 0 && resto < 1000) { out[out.length - 1] = { n: anterior.n + resto, origem: `${anterior.origem} e ${brutos.slice(i + 1, j).map((b) => b.t).join(' ')}` }; i = j; continue }
    }
    if (!ehPalavraNumero(w)) { out.push(brutos[i]); i++; continue }
    let total = 0, atual = 0, palavras = 0, j = i
    for (; j < brutos.length; j++) {
      const p = pal(j)
      if (p === undefined) break
      if (p in NUM) { atual += NUM[p]; palavras++ }
      else if (p === 'mil') { total += (atual || 1) * 1000; atual = 0; palavras++ }
      else if (p === 'milhao' || p === 'milhoes') { total += (atual || 1) * 1_000_000; atual = 0; palavras++ }
      else if (p === 'e' && ehPalavraNumero(pal(j + 1))) continue
      else break
    }
    let valor = total + atual
    const k0 = pal(j + 1)
    if (pal(j) === 'virgula' && k0 !== undefined && k0 in NUM) {
      const dec: number[] = []
      let k = j + 1
      for (; k < brutos.length; k++) { const q = pal(k); if (q !== undefined && q in NUM) dec.push(NUM[q]); else if (q === 'e' && (pal(k + 1) ?? '') in NUM) continue; else break }
      const casas = dec.every((d) => d < 10) ? dec.join('') : String(dec.reduce((s2, d) => s2 + d, 0))
      valor = Number(`${valor}.${casas}`); j = k; palavras++
    }
    if (pal(j) === 'e' && (pal(j + 1) === 'meio' || pal(j + 1) === 'meia')) { valor += 0.5; j += 2; palavras++ }
    if (pal(j) === 'duzia' || pal(j) === 'duzias') { valor *= 12; j++; palavras++ }
    const origem = brutos.slice(i, j).map((b) => b.t).join(' ')
    // "um/uma" sozinhos são artigo ("um cordão") — salvo diante de unidade ou atributo ("um ano", "uma estrela")
    const artigo = palavras === 1 && (w === 'um' || w === 'uma') && !unidadeDe(pal(j)) && !atributoDe(pal(j)) && !/^(numero|top|lugar|nota)$/.test(pal(i - 1) ?? '')
    if (artigo) out.push(brutos[i])
    else out.push({ n: +valor.toFixed(6), origem })
    i = Math.max(j, i + 1)
  }
  return out
}

/** Valores ditos por extenso (compatível com a P2.69). */
export function numerosPorExtenso(texto: string): number[] {
  return tokenizar(texto.replace(/\d/g, ' ')).flatMap((t) => (t.n !== undefined ? [t.n] : []))
}

// ── afirmações ──────────────────────────────────────────────────────────────────────────────────────────────
export type Comparador = '=' | '>' | '<' | '≈'
export interface AfirmacaoNumerica {
  valor: number
  atributo: string | null
  comparador: Comparador
  trecho: string
  /** posição do número nos tokens de `tokenizar(texto)` */
  indice: number
  /** palavras de conteúdo até 2 de cada lado (têm de estar no MESMO fato) */
  proximas: string[]
  /** palavras de conteúdo da oração (têm de estar em algum fato ou no nome do produto) */
  oracao: string[]
}

const conteudo = (w: string | undefined): w is string => !!w && !ehSep(w) && !NEUTRAS.has(w) && !ehCodigo(w)

export function afirmacoesNumericas(texto: string): AfirmacaoNumerica[] {
  const tk = tokenizar(texto)
  const palavra = (k: number) => tk[k]?.t
  const ehNum = (k: number) => tk[k]?.n !== undefined
  const out: AfirmacaoNumerica[] = []
  const trechoEm = (k: number) => tk.slice(Math.max(0, k - 3), k + 4).map((x) => (x.n !== undefined ? x.origem : x.e ?? x.t)).filter((x) => !ehSep(x)).join(' ')
  /** limites da oração de k */
  const oracaoDe = (k: number): [number, number] => {
    let a = k, b = k
    while (a > 0 && !ehSep(tk[a - 1].t)) a--
    while (b < tk.length - 1 && !ehSep(tk[b + 1].t)) b++
    return [a, b]
  }
  const palavrasDeContexto = (k: number) => {
    const [a, b] = oracaoDe(k)
    const proximas: string[] = []
    for (const dir of [-1, 1]) for (let j = k + dir, n = 0; j >= a && j <= b && n < 2; j += dir) { const w = tk[j].t; if (conteudo(w)) { if (!RECIPIENTES.test(w)) proximas.push(radical(w)); n++ } }
    const oracao = tk.slice(Math.max(a, k - 8), Math.min(b, k + 8) + 1).flatMap((x) => (conteudo(x.t) && !RECIPIENTES.test(x.t!) ? [radical(x.t!)] : []))
    return { proximas, oracao }
  }
  /** primeira palavra útil à frente de k (pula neutras, a escala "de 5" e o fim de intervalo "a 5") */
  const aFrente = (k: number): number | null => {
    for (let j = k + 1, vistos = 0; j < tk.length && vistos < JANELA; j++, vistos++) {
      const x = tk[j]
      if (ehSep(x.t) || x.e !== undefined) return null
      if (x.n !== undefined) { if (['de', 'a', 'ate'].includes(palavra(j - 1) ?? '')) continue; return null }
      if (x.t === 'e' && tk[j + 1]?.t !== undefined && atributoDe(tk[j + 1].t)) return null // "1.200 e nota 4,9": o atributo é do PRÓXIMO número
      if (NEUTRAS.has(x.t!)) continue
      return j
    }
    return null
  }
  const atras = (k: number, alcance = JANELA): number | null => {
    for (let j = k - 1, vistos = 0; j >= 0 && vistos < alcance; j--, vistos++) {
      const x = tk[j]
      if (ehSep(x.t) || x.e !== undefined) return null
      if (x.n !== undefined) continue
      if (NEUTRAS.has(x.t!)) continue
      return j
    }
    return null
  }
  const comparadorAntes = (k: number): Comparador => {
    const ant = [palavra(k - 1), palavra(k - 2), palavra(k - 3)]
    const pre = ant[0] === 'reais' ? ant.slice(1) : ant
    const [a, b] = pre
    if (a === 'quase' || a === 'aproximadamente' || a === 'uns' || (a === 'de' && b === 'cerca')) return '≈'
    if ((a === 'de' && (b === 'mais' || b === 'acima' || b === 'partir')) || a === 'mais' || (a === 'menos' && b === 'pelo')) return '>'
    if (a === 'ate' || (a === 'de' && (b === 'menos' || b === 'abaixo'))) return '<'
    return '='
  }
  /** "4,9 de 5" / "9 de 10": escala só ao lado de nota/estrelas — "9 de 10 clientes" NÃO é escala */
  const ehEscala = (k: number) => {
    const v = tk[k].n!
    if (!(palavra(k - 1) === 'de' && ehNum(k - 2) && (v === 5 || v === 10) && tk[k - 2].n! <= v)) return false
    const depois = tk[k + 1]
    return !depois || ehSep(depois.t) || /^estrelas?$/.test(depois.t ?? '') || palavra(k - 3) === 'nota'
  }
  const [palavraAntes, palavraAntes2, palavraAntes3] = [(k: number) => palavra(k - 1), (k: number) => palavra(k - 2), (k: number) => palavra(k - 3)]

  tk.forEach((tok, k) => {
    const trecho = trechoEm(k)
    const ctx = () => palavrasDeContexto(k)
    if (tok.t !== undefined && ehCodigo(tok.t)) {
      // código ("A4", "PS5") só passa se estiver na ficha; dígito ilegível nunca passa
      out.push({ valor: NaN, atributo: tok.t === ILEGIVEL ? null : `CODIGO:${tok.t}`, comparador: '=', trecho, indice: k, proximas: [], oracao: [] })
      return
    }
    if (tok.e !== undefined) {
      const f = aFrente(k)
      out.push({ valor: NaN, atributo: `EXPRESSAO:${tok.e}:${f !== null ? radical(palavra(f)!) : ''}`, comparador: '=', trecho, indice: k, ...ctx() })
      return
    }
    if (tok.n === undefined) return
    const push = (atributo: string | null, valor = tok.n!, comparador: Comparador = comparadorAntes(k)) => out.push({ valor: +valor.toFixed(6), atributo, comparador, trecho, indice: k, ...ctx() })
    const ant = palavraAntes(k), ant2 = palavraAntes2(k)
    if (ehEscala(k)) return push('ESCALA', tok.n, '=')
    if ([ant, ant2].includes('escala')) return push('ESCALA', tok.n, '=')
    // data: só com o mês ("dia 28 de novembro"); horário: "às 20h"
    const mes = palavra(k + 1) === 'de' && MESES.test(palavra(k + 2) ?? '') ? palavra(k + 2) : null
    if (ant === 'dia' || mes) return push(mes ? `DATA:${mes}` : null)
    if ((ant === 'as' || ant === 'a') && unidadeDe(palavra(k + 1))?.[1] === 'HORAS') return push(null) // horário sem data não se confere
    // preço com papel: "de R$ 89,90 por R$ 69,90", "3x de R$ 16,63"; frete mínimo, cupom, economia: não é o preço
    const ctxPreco = ant === 'reais' ? [ant2, palavraAntes3(k), palavra(k - 4)] : [ant, ant2, palavraAntes3(k)]
    if (ctxPreco[0] === 'de' && (ctxPreco[1] === 'x' || ctxPreco[1] === 'vezes')) return push('PARCELA_VALOR', tok.n, '=')
    if (ant === 'reais' || atributoDe(palavra(k + 1)) === 'PRECO') {
      const antes = [ctxPreco[0], ctxPreco[1], ctxPreco[2]]
      if (antes.some((w) => PRECO_DE_OUTRA_COISA.test(w ?? ''))) return push(null)
      if (antes.some((w) => PRECO_ANTIGO.test(w ?? ''))) return push('PRECO_DE')
      if (ctxPreco[0] === 'de') {
        // "de R$ X por R$ Y": só é o preço antigo se houver o "por" depois (ou se a oração começa com "de")
        const [, fim] = oracaoDe(k)
        const temPor = tk.slice(k + 1, fim + 1).some((x) => x.t === 'por')
        const inicio = ant === 'reais' ? k - 2 : k - 1
        return push(temPor || inicio === oracaoDe(k)[0] ? 'PRECO_DE' : null)
      }
      return push('PRECO') // "por R$" = preço atual
    }
    // imediatamente antes manda ("vendas: 1.200 e nota 4,9")
    if (atributoDe(ant) && atributoDe(ant) !== 'PRECO') return push(atributoDe(ant))
    const f = aFrente(k)
    const fw = f !== null ? palavra(f)! : undefined
    // "3x sem juros" = parcelas; "30 x 20 cm" = dimensão; "3 vezes mais rápido" = sem atributo
    if (fw === 'x' || fw === 'vezes') {
      const [a, b] = oracaoDe(k)
      const pagamento = tk.slice(a, b + 1).some((x) => PAGAMENTO.test(x.t ?? '')) || (palavra(f! + 1) === 'de' && (palavra(f! + 2) === 'reais' || ehNum(f! + 2)))
      if (fw === 'x' && ehNum(f! + 1)) return push(null)
      return push(pagamento ? 'PARCELAS' : null)
    }
    const attrF = atributoDe(fw)
    if (attrF && attrF !== 'PRECO') return push(attrF)
    if (palavra(k + 1) === 'de' && ehNum(k + 2) && ehEscala(k + 2)) return push('NOTA')
    const un = unidadeDe(fw)
    if (un && f !== null) {
      // idade mínima só sem outro qualificador: "a partir de 3 anos" (≠ "a partir de 3 anos de garantia")
      const depois = aFrente(f)
      if (ant === 'de' && ant2 === 'partir' && depois === null) return push(`IDADE_MINIMA_${un[1]}`, tok.n * un[2], '=')
      const antes = atras(k)
      const q = depois !== null && !unidadeDe(palavra(depois)) ? palavra(depois)! : antes !== null ? palavra(antes)! : null
      return push(q ? `${un[1]}:${radical(q)}` : null, tok.n * un[2])
    }
    if (fw && PESSOAS.test(fw)) {
      const v = f !== null ? aFrente(f) : null
      const verbo = v !== null ? palavra(v)! : ''
      return push(/^avali/.test(verbo) ? 'QTD_AVALIACOES' : /^compr/.test(verbo) ? 'VENDAS' : null)
    }
    const b = atras(k, 2)
    const attrB = b !== null ? atributoDe(palavra(b)) : null
    if (attrB && attrB !== 'PRECO') return push(attrB)
    if (fw) return push(`UNIDADE:${radical(fw)}`)
    if (b !== null && b === k - 1) return push(`MODELO:${palavra(b)}`) // "Bluetooth 5.3"
    return push(null)
  })
  return out
}

const fmt = (v: number) => (Number.isNaN(v) ? '' : String(v).replace('.', ','))
const rotulo = (a: AfirmacaoNumerica) => `${a.atributo === null ? 'sem contexto' : a.atributo.replace(/^(UNIDADE|MODELO|CODIGO):/, '').toLowerCase()}${Number.isNaN(a.valor) ? '' : ` ${a.comparador} ${fmt(a.valor)}`}`

// ── conferência por ORAÇÃO (revisão independente P2.69+, 3ª rodada) ───────────────────────────────────────────
/**
 * Regra fechada: a oração do vídeo que tem número precisa dizer EXATAMENTE o que diz uma oração da ficha —
 * as mesmas afirmações (atributo, valor, comparador) e as mesmas palavras de conteúdo, nos DOIS sentidos
 * ("R$ 49,90" não casa com "R$ 49,90 no Pix"; "30 horas de bateria sem o estojo" não casa com "… com o estojo").
 * Só as palavras do nome do produto podem sobrar no vídeo. Na mesma frase, oração sem número com "sem", "não",
 * "só", "exceto"… reprova (o qualificador mudaria o fato). Códigos ("A4") têm de estar na ficha ou no nome.
 */
/** palavras (já normalizadas) de avisos obrigatórios: IA, publicidade, afiliação */
/** palavra que caracteriza o aviso (sem ela, "Não." não é aviso) */
const AVISO_FORTE = /^(inteligencia|sintetica|publicidade|publi|afiliada|afiliado|patrocinado|comissao)$/
/** vocabulário dos avisos obrigatórios (IA, publicidade): a frase só é aviso se TODAS as palavras forem daqui */
const AVISO_OBRIGATORIO = /^(voz|sintetica|gerada|gerado|inteligencia|artificial|neutra|nao|criadora|criador|publicidade|publi|contem|link|afiliada|afiliado|com|narracao|conteudo|feito|criado|comissao|patrocinado|ia|eh)$/
/** condição comercial: em QUALQUER parte do vídeo, só se a ficha disser (no fato do número que o vídeo usa) */
const CONDICAO_COMERCIAL = /^(pix|vista|cartao|boleto|frete|gratis|cupom|juros|hoje|amanha|semana|semanal|mes|mensal|mensai|anual|ano|plano|kit|pessoa|unidade|cada|promocao|promo|black|friday|limitado|limitada|estoque|desconto|off|parcela|assinante|assinatura|vitalicia|vitalicio|estendida|total|reclame|lancamento|exclusivo|exclusiva|cashback|oferta|liquidacao|ultima|ultimo|domingo|segunda|terca|quarta|quinta|sexta|sabado|feira|acaba|termina|encerra|sobe|aumenta|volta|normal|enquanto|prazo|fim|lancado|lancada|lancamento|verificado|verificados)$/
const MINIMAS = new Set(['de', 'do', 'da', 'dos', 'das', 'o', 'a', 'os', 'as', 'ao', 'aos', 'um', 'uma', 'uns', 'umas', 'em', 'no', 'na', 'nos', 'nas', 'e', 'que', 'para', 'pra', 'por', 'pelo', 'pela', 'esse', 'essa', 'este', 'esta', 'isso', 'eh', 'sao', 'tem', 'vem', 'aqui', 'ja', 'seu', 'sua'])
const COMPARADORES = new Set(['mais', 'de', 'acima', 'partir', 'menos', 'abaixo', 'ate', 'quase', 'cerca', 'aproximadamente', 'uns', 'a'])
const RISCO = /^(sem|com|nao|nem|nunca|jamais|nenhum|nenhuma|exceto|salvo|so|apenas|somente|menos|desde|se|caso|quando|mas|porem|ate|mesmo|dispensa|sob|condicao|condicoes|cada|inclus[oa]|inclusive|tambem|todo|toda|todos|todas|qualquer|vitalici[oa]|mes|unidade|assinante|frete|gratis|cupom|pix|vista|cartao)$/
const CANONICO: Record<string, string> = {
  estrela: 'nota', avaliacao: 'nota', classificacao: 'nota', vendido: 'venda', vendida: 'venda', real: 'reais', preco: 'reais', custa: 'reais', custando: 'reais',
  off: 'desconto', vezes: 'x', veze: 'x', parcela: 'x', h: 'hora', min: 'minuto', g: 'grama', kg: 'quilo', m: 'metro', cm: 'centimetro', mm: 'milimetro', l: 'litro', ml: 'mililitro', w: 'watt', v: 'volt', pol: 'polegada',
}
const canonico = (w: string) => { if (w === 'reais') return 'reais'; const r = radical(w); return CANONICO[w] ?? CANONICO[r] ?? r }

/** `grupo` muda na pontuação (vírgula, ponto…), não na separação por "e"/"com" de um fato composto */
/** retoma o número de outra frase ("esse valor", "essa nota", "isso") */
/** ("está", verbo, vira "esta" na normalização: fica de fora) */
const ANAFORA = /^(esse|essa|este|isso|isto|ele|ela|dele|dela|nesse|nessa|desse|dessa|neste|nesta)$/
const RETOMA = /^(valor|reais|numero|nota|garantia|bateria|parcela|desconto)$/
interface Oracao { frase: number; grupo: number; anafora: boolean; palavras: Set<string>; afirmacoes: string[]; escalas: string[]; codigos: string[]; expostas: AfirmacaoNumerica[]; risco: boolean }

function oracoesDe(texto: string): Oracao[] {
  const tk = tokenizar(texto)
  const af = new Map(afirmacoesNumericas(texto).map((x) => [x.indice, x]))
  // palavras de comparação/ligação logo antes do número ("mais de 5 mil", "de R$ 79"): já estão na afirmação
  const consumidas = new Set<number>()
  for (const k of af.keys()) for (let j = k - 1; j >= Math.max(0, k - 4); j--) { const w = tk[j].t; if (w === 'reais') continue; if (!w || !COMPARADORES.has(w)) break; consumidas.add(j) }
  const out: Oracao[] = []
  let frase = 0
  let grupo = 0
  const nova = (): Oracao => ({ frase, grupo, anafora: false, palavras: new Set(), afirmacoes: [], escalas: [], codigos: [], expostas: [], risco: false })
  let atual = nova()
  const fecha = () => { if (atual.palavras.size || atual.afirmacoes.length || atual.codigos.length || atual.escalas.length) out.push(atual); atual = nova() }
  const temNumeroAFrente = (k: number) => tk.slice(k + 1, k + 5).some((x) => x.n !== undefined || x.e !== undefined)
  tk.forEach((x, k) => {
    if (x.t === FIM) { fecha(); frase++; grupo++; atual.frase = frase; atual.grupo = grupo; return }
    if (x.t === SEP) { fecha(); grupo++; atual.grupo = grupo; return }
    // "nota 4,9 com 1.125 avaliações", "4,9 e mais de 5 mil vendidos": cada número na sua oração ("de R$ 79 por R$ 59" e "ou" ficam juntos)
    // ("em" NÃO separa: "100% em 30 minutos" é uma afirmação só)
    if ((x.t === 'e' || x.t === 'com') && temNumeroAFrente(k) && atual.afirmacoes.length) return fecha()
    const a = af.get(k)
    if (a) {
      if (a.atributo?.startsWith('CODIGO:')) atual.codigos.push(a.atributo.slice(7))
      else if (a.atributo === 'ESCALA') atual.escalas.push(String(a.valor))
      else { atual.afirmacoes.push(`${a.atributo}|${a.valor}|${a.comparador}`); atual.expostas.push(a) }
      return
    }
    if (x.t !== undefined && ANAFORA.test(x.t)) atual.anafora = true
    if (x.t === undefined || consumidas.has(k) || MINIMAS.has(x.t)) return
    if (RISCO.test(x.t)) atual.risco = true
    if (RETOMA.test(canonico(x.t))) atual.anafora = true
    atual.palavras.add(canonico(x.t))
  })
  fecha()
  return out
}

const mesmaLista = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n')
const contida = (a: Set<string>, b: Set<string>) => [...a].every((w) => b.has(w))

/**
 * Cada oração do vídeo com número precisa de uma oração da ficha com as MESMAS afirmações e as MESMAS palavras
 * (só o nome do produto pode sobrar no vídeo). A fonte entre parênteses no fato ("(painel, 27/10/2026)") é ignorada.
 */
export function conferirAfirmacoes(trechosDoVideo: string[], fatosValidados: string[], nomeDoProduto = ''): { total: number; semVinculo: string[] } {
  // só a FONTE no fim do fato sai ("(painel, 27/10/2026)"); qualquer outro parêntese é condição e fica
  const semFonte = (f: string) => f.replace(/\(([^)]*(fonte|t[ií]tulo|p[aá]gina|painel|an[uú]ncio|export|creator|site|loja|regulamento|print|\d{1,2}\/\d{1,2}\/\d{2,4})[^)]*)\)\s*$/i, ' ')
  // a oração do fato com número HERDA as palavras das orações sem número do mesmo fato ("No Pix, R$ 49,90")
  const fatos = fatosValidados.flatMap((f) => {
    const ors = oracoesDe(semFonte(f))
    // cada oração com número HERDA as palavras das orações da ficha separadas por pontuação ("No Pix, R$ 49,90",
    // "Comprando 2 unidades, cada uma sai por R$ 39,90", "R$ 49,90. Válido só no Pix."): a condição vem junto
    return ors.filter((o) => o.afirmacoes.length || o.codigos.length).map((o) => ({
      ...o,
      palavras: new Set([...o.palavras, ...ors.filter((v) => v.grupo !== o.grupo).flatMap((v) => [...v.palavras, ...v.afirmacoes.map((x) => canonico(x.split('|')[0].toLowerCase()))])]),
    }))
  })
  const doNome = oracoesDe(nomeDoProduto)
  const codigosConhecidos = new Set([...fatos.flatMap((o) => o.codigos), ...doNome.flatMap((o) => o.codigos)])
  // o nome do produto só cobre palavra que SOBRA no vídeo, e nunca condição/ligação/recipiente
  const doProduto = new Set(doNome.flatMap((o) => [...o.palavras]).filter((w) => !RISCO.test(w) && !CONDICAO_COMERCIAL.test(w) && w !== 'com' && w !== 'sem' && !RECIPIENTES.test(w)))
  const codigoConhecido = (c: string) => {
    if (!c.startsWith(MARCA_DE_HASHTAG)) return codigosConhecidos.has(c)
    const h = c.slice(MARCA_DE_HASHTAG.length)
    return [...codigosConhecidos].some((k) => h.includes(k) && !/\d/.test(h.replace(k, '')))
  }
  const semVinculo: string[] = []
  let total = 0
  /** frase de aviso obrigatório (IA, publicidade): só palavras de aviso, com ao menos uma forte */
  const frasesDeAvisoDe = (ors: Oracao[]) => new Set([...new Set(ors.map((v) => v.frase))].filter((fr) => {
    const da = ors.filter((v) => v.frase === fr)
    return da.every((v) => !v.afirmacoes.length && !v.codigos.length) && da.some((v) => [...v.palavras].some((w) => AVISO_FORTE.test(w))) && da.every((v) => [...v.palavras].every((w) => AVISO_OBRIGATORIO.test(w)))
  }))
  const semNome = (p: Set<string>) => new Set([...p].filter((w) => !doProduto.has(w)))
  /** oração descritiva da ficha (sem número): "marca Chamex", "formato A4" */
  const descritivas = fatosValidados.flatMap((f) => oracoesDe(semFonte(f)).filter((o) => !o.afirmacoes.length).map((o) => o.palavras))
  const usados: typeof fatos = []
  for (const trecho of trechosDoVideo) {
    const ors = oracoesDe(trecho)
    const frasesDeAviso = frasesDeAvisoDe(ors)
    const conteudoDaFrase = (fr: number) => ors.filter((v) => v.frase === fr).reduce((n, v) => n + v.palavras.size + v.afirmacoes.length + v.codigos.length, 0)
    for (const o of ors) {
      total += o.afirmacoes.length + o.codigos.length
      for (const c of o.codigos) if (!codigoConhecido(c)) semVinculo.push(`"${c.replace(MARCA_DE_HASHTAG, '#')}": código que a ficha não tem`)
      if (!o.afirmacoes.length) continue
      const descricao = `"${[...o.palavras].join(' ')}" [${o.expostas.map(rotulo).join('; ')}]`
      if (o.expostas.some((x) => x.atributo === null)) { semVinculo.push(`${descricao}: número sem significado identificável`); continue }
      const igual = fatos.find((f) => mesmaLista(o.afirmacoes, f.afirmacoes) && o.escalas.every((e) => f.escalas.includes(e)) && f.escalas.every((e) => e === '5' || o.escalas.includes(e))
        && contida(semNome(o.palavras), f.palavras) && contida(f.palavras, o.palavras))
      if (!igual) { semVinculo.push(`${descricao}: nenhuma frase da ficha diz exatamente isso`); continue }
      usados.push(igual)
      // 6ª revisão: a oração sem número só é aceita se estiver NO fato usado (com as condições herdadas) ou numa
      // oração descritiva da ficha — nunca na condição de OUTRO fato (com outro número)
      const cabe = (v: Oracao) => contida(semNome(v.palavras), igual.palavras) || descritivas.some((d) => contida(semNome(v.palavras), d))
      // na FRASE do número, e nas frases CURTAS (até 3 palavras) logo antes/depois ("Esta semana.", "Por mês.")
      const ligada = (v: Oracao) => v.frase === o.frase || (Math.abs(v.frase - o.frase) === 1 && !frasesDeAviso.has(v.frase) && !ors.some((x) => x.frase === v.frase && x.afirmacoes.length) && conteudoDaFrase(v.frase) <= 3)
      const solta = ors.find((v) => v !== o && !v.afirmacoes.length && v.palavras.size && ligada(v) && !cabe(v))
      if (solta) { semVinculo.push(`${descricao}: a frase acrescenta o que a ficha não diz ("${[...solta.palavras].join(' ')}")`); continue }
      // condição/negação em QUALQUER oração sem número do trecho pode mudar o que o número afirma
      const vizinha = ors.find((v) => v !== o && !v.afirmacoes.length && v.risco && !frasesDeAviso.has(v.frase) && !cabe(v))
      if (vizinha) semVinculo.push(`${descricao}: o trecho traz condição/negação que a ficha não tem ("${[...vizinha.palavras].join(' ')}")`)
    }
  }
  // 6ª revisão (ALTA 3): condição COMERCIAL em qualquer trecho do vídeo (CTA, legenda, hashtag) tem de estar num fato
  // que o próprio vídeo usou (com o número dele) ou numa oração descritiva da ficha
  if (usados.length) {
    const todas = trechosDoVideo.flatMap((t) => { const ors = oracoesDe(t); const av = frasesDeAvisoDe(ors); return ors.filter((v) => !av.has(v.frase)) })
    for (const v of todas) {
      if (v.afirmacoes.length || !(v.anafora || [...v.palavras].some((w) => CONDICAO_COMERCIAL.test(w)))) continue
      if (usados.some((f) => contida(semNome(v.palavras), f.palavras)) || descritivas.some((d) => contida(semNome(v.palavras), d))) continue
      semVinculo.push(`"${[...v.palavras].join(' ')}": ${v.anafora ? 'retoma um número com o que a ficha não diz' : 'condição comercial que a ficha não traz junto do número'}`)
    }
  }
  return { total, semVinculo }
}
