/**
 * P2.17.6 — Inteligência comercial: visões (rankings) dos candidatos, cada
 * posição com o PORQUÊ em linguagem de consultor. FUNÇÕES PURAS.
 *
 * Regras:
 *   - produto sem o dado da visão não é "chutado": vai para o fim, com o motivo;
 *   - "Maior comissão" desempata por % → evidência de venda → conversão → risco;
 *   - "Melhor oportunidade" NÃO é a maior comissão: soma vendas, comissão,
 *     preço, conversão, avaliação, missão, sazonalidade, facilidade de vídeo e
 *     risco — e a evidência de venda continua sendo o maior peso;
 *   - bloqueado por compliance nunca aparece.
 */

export interface ProdutoParaVisao {
  id: string
  nome: string
  preco: number | null
  precoAnterior: number | null
  descontoPercentual: number | null
  comissaoPercentual: number | null
  comissaoValor: number | null
  vendas: number | null
  avaliacao: number | null
  numeroDeAvaliacoes: number | null
  estoque: number | null
  /** Conversão real (vendas ÷ cliques) do histórico do Patrono; null sem histórico. */
  conversao: number | null
  baseDeEvidencia: number
  aderenciaNatal: number | null
  tiktokShop: boolean
  ajudaMissao: boolean
  facilidadeVideo: number
  nivelDeRisco: string | null
  complianceBloqueante: boolean
  /**
   * P2.17.18 — Proveniência dos sinais de mercado. OFICIAL_API (enriquecimento
   * oficial/catálogo) nunca se mistura com o que a titular VIU no app
   * (TIKTOK_APP_MANUAL / TIKTOK_RANKING_MANUAL / USER_PROVIDED): o texto diz a
   * fonte e o snapshot manual só preenche lacuna.
   */
  fonteVendas?: string | null
  fonteComissao?: string | null
  rankingPosicao?: number | null
  rankingCategoria?: string | null
  tipoDeAmostra?: string | null
  observadoEm?: string | null
}

const MANUAL = (f: string | null | undefined) => !!f && f !== 'OFICIAL_API'
const dataCurta = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }) : '?')
const origemDasVendas = (p: ProdutoParaVisao) => (MANUAL(p.fonteVendas) ? `visto no app em ${dataCurta(p.observadoEm)} — snapshot manual` : 'dado oficial da loja')
/** Evidência de demanda do ranking manual (0–1), com desconto de snapshot (×0,8). */
function evidenciaDoRanking(p: ProdutoParaVisao): number | null {
  if (!p.rankingPosicao || p.rankingPosicao < 1) return null
  return (1 / (1 + Math.log10(p.rankingPosicao) * 0.9)) * 0.8
}

export const VISOES = [
  { id: 'MAIS_VENDIDOS', rotulo: 'Mais vendidos', rapida: true },
  { id: 'MAIOR_COMISSAO', rotulo: 'Maior comissão', rapida: true },
  { id: 'MELHOR_OPORTUNIDADE', rotulo: 'Melhor oportunidade', rapida: true },
  { id: 'MENOR_PRECO', rotulo: 'Menor preço', rapida: true },
  { id: 'NATAL', rotulo: 'Melhor para Natal', rapida: true },
  { id: 'MISSAO_TIKTOK', rotulo: 'Melhor para TikTok', rapida: true },
  { id: 'MAIOR_TICKET', rotulo: 'Maior ticket', rapida: false },
  { id: 'PRECO_X_COMISSAO', rotulo: 'Melhor relação preço × comissão', rapida: false },
  { id: 'VENDAS_X_COMISSAO', rotulo: 'Melhor relação vendas × comissão', rapida: false },
  { id: 'POTENCIAL_DE_RECEITA', rotulo: 'Maior potencial de receita', rapida: false },
  { id: 'MELHOR_AVALIACAO', rotulo: 'Melhor avaliação', rapida: false },
  { id: 'MAIS_AVALIACOES', rotulo: 'Mais avaliações', rapida: false },
  { id: 'VIDEO', rotulo: 'Melhor para vídeo', rapida: false },
  { id: 'MENOR_RISCO', rotulo: 'Menor risco', rapida: false },
  { id: 'EQUILIBRIO', rotulo: 'Melhor equilíbrio geral', rapida: false },
] as const
export type IdDaVisao = (typeof VISOES)[number]['id']

export interface ItemDaVisao {
  posicao: number
  id: string
  nome: string
  /** Valor que ordena esta visão (null = sem dado, no fim). */
  valor: number | null
  porque: string
}

const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const num = (v: number) => v.toLocaleString('pt-BR')
const pct = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
const RISCO: Record<string, number> = { BAIXO: 0, MEDIO: 1, ALTO: 2 }
const risco = (p: ProdutoParaVisao) => (p.nivelDeRisco ? RISCO[p.nivelDeRisco] ?? 1 : 1)
const desc = <T>(f: (x: T) => number | null) => (a: T, b: T) => {
  const x = f(a), y = f(b)
  if (x === null && y === null) return 0
  if (x === null) return 1
  if (y === null) return -1
  return y - x
}
const asc = <T>(f: (x: T) => number | null) => desc<T>((v) => { const r = f(v); return r === null ? null : -r })
const encadear = <T>(...cs: ((a: T, b: T) => number)[]) => (a: T, b: T) => {
  for (const c of cs) {
    const r = c(a, b)
    if (r !== 0) return r
  }
  return 0
}

/** Normaliza 0–1 dentro do conjunto (dado ausente = null). */
function normalizador(lista: ProdutoParaVisao[], f: (p: ProdutoParaVisao) => number | null) {
  const vals = lista.map(f).filter((v): v is number => v !== null)
  const min = Math.min(...vals), max = Math.max(...vals)
  return (p: ProdutoParaVisao) => {
    const v = f(p)
    if (v === null || !vals.length) return null
    return max === min ? 1 : (v - min) / (max - min)
  }
}

/** Nota da "Melhor oportunidade" (0–100) e o que pesou. */
export function notaDeOportunidade(p: ProdutoParaVisao, lista: ProdutoParaVisao[]) {
  const nVendas = normalizador(lista, (x) => (x.vendas !== null ? Math.log10(1 + x.vendas) : null))(p)
  const nComissao = normalizador(lista, (x) => x.comissaoValor)(p)
  const nPreco = normalizador(lista, (x) => (x.preco !== null ? -x.preco : null))(p)
  const nAval = p.avaliacao !== null && (p.numeroDeAvaliacoes ?? 0) >= 10 ? p.avaliacao / 5 : null
  // P2.17.18: posição no "Mais vendidos" visto no app conta como evidência
  // de DEMANDA (com desconto de snapshot) — nunca decide sozinha.
  const rank = evidenciaDoRanking(p)
  const pesos = {
    evidencia: [25, Math.max(p.baseDeEvidencia / 100, rank ?? 0)],
    vendas: [15, nVendas ?? rank],
    comissao: [15, nComissao],
    conversao: [10, p.conversao !== null ? Math.min(1, p.conversao / 0.05) : null],
    avaliacao: [7, nAval],
    preco: [5, nPreco],
    missao: [8, p.ajudaMissao ? 1 : p.tiktokShop ? 0.5 : 0],
    natal: [7, p.aderenciaNatal !== null ? p.aderenciaNatal / 100 : 0],
    video: [8, p.facilidadeVideo / 100],
    // Amostra: facilita produzir, não decide (grátis ≠ boa oportunidade).
    amostra: [3, p.tipoDeAmostra === 'GRATIS' ? 1 : p.tipoDeAmostra === 'REEMBOLSAVEL' ? 0.4 : p.tipoDeAmostra === 'NENHUMA' ? 0 : null],
  } as const
  let nota = 0
  const desconhecidos: string[] = []
  for (const [k, [peso, v]] of Object.entries(pesos)) {
    if (v === null) desconhecidos.push(k)
    else nota += peso * v
  }
  nota -= risco(p) === 2 ? 15 : risco(p) === 1 ? 4 : 0
  return { nota: Math.round(Math.max(0, nota) * 10) / 10, desconhecidos }
}

/** Por que este produto está nesta posição — consultoria, não só número. */
function porqueDaOportunidade(p: ProdutoParaVisao, lista: ProdutoParaVisao[], nota: number, desconhecidos: string[]): string {
  const maiorComissao = Math.max(...lista.map((x) => x.comissaoValor ?? -1))
  const maisVendas = Math.max(...lista.map((x) => x.vendas ?? -1))
  const partes: string[] = []
  if (p.comissaoValor !== null && p.comissaoValor === maiorComissao && p.vendas !== null && maisVendas > 0 && p.vendas < maisVendas / 5) partes.push('Tem a maior comissão, mas vende pouco.')
  else if (p.vendas !== null && p.vendas === maisVendas && p.comissaoValor !== null && maiorComissao > p.comissaoValor) partes.push('Paga menos comissão, porém o volume de vendas é o maior da lista.')
  else if (p.comissaoValor !== null && p.comissaoValor === maiorComissao && p.baseDeEvidencia >= 60) partes.push('Tem comissão alta e boa evidência de venda; eu priorizaria.')
  if (p.conversao !== null && p.preco !== null && p.conversao >= 0.03) partes.push('Tem preço competitivo e forte evidência de conversão.')
  partes.push(`Evidência de venda ${p.baseDeEvidencia}/100.`)
  if (p.rankingPosicao) partes.push(`#${p.rankingPosicao} em ${p.rankingCategoria ?? 'ranking'} no app (snapshot manual de ${dataCurta(p.observadoEm)}).`)
  if (MANUAL(p.fonteComissao) && p.comissaoValor !== null) partes.push('Comissão vista no app (snapshot manual).')
  if (p.tipoDeAmostra === 'GRATIS') partes.push('Tem amostra grátis (facilita produzir; não decide).')
  if (p.ajudaMissao) partes.push('Ajuda a cumprir missão ativa do TikTok Shop.')
  if (p.aderenciaNatal) partes.push(`Natal ${p.aderenciaNatal}/100.`)
  if (risco(p) === 2) partes.push('Risco alto pesa contra.')
  const faltam = desconhecidos.filter((d) => ['vendas', 'comissao', 'conversao', 'avaliacao', 'preco'].includes(d))
  if (faltam.length) partes.push(`Sem dado de ${faltam.map((d) => ({ vendas: 'vendas', comissao: 'comissão', conversao: 'conversão', avaliacao: 'avaliação', preco: 'preço' })[d]).join(', ')}: não contou a favor.`)
  return `Nota ${nota}/100. ${partes.join(' ')}`
}

export function montarVisao(visao: IdDaVisao, produtos: ProdutoParaVisao[]): ItemDaVisao[] {
  const lista = produtos.filter((p) => !p.complianceBloqueante)
  const semDado = (o: string) => `Sem dado de ${o}: fica no fim desta visão (nada foi estimado).`
  const evid = desc<ProdutoParaVisao>((p) => p.baseDeEvidencia)
  const menorRisco = asc<ProdutoParaVisao>(risco)
  let ordenados: ProdutoParaVisao[]
  let valor: (p: ProdutoParaVisao) => number | null
  let porque: (p: ProdutoParaVisao) => string

  switch (visao) {
    case 'MAIS_VENDIDOS':
      // Número de vendas primeiro; sem número, a POSIÇÃO vista no app (snapshot manual) ordena depois.
      valor = (p) => p.vendas ?? (p.rankingPosicao ? -p.rankingPosicao : null)
      ordenados = [...lista].sort(encadear(desc(valor), evid))
      porque = (p) =>
        p.vendas !== null
          ? `${num(p.vendas)} vendidos (${origemDasVendas(p)}).${p.comissaoValor !== null ? ` Comissão ${reais(p.comissaoValor)} por venda.` : ''}`
          : p.rankingPosicao
            ? `#${p.rankingPosicao} em ${p.rankingCategoria ?? 'Mais vendidos'} (visto no app em ${dataCurta(p.observadoEm)} — snapshot manual).`
            : semDado('vendas')
      break
    case 'MAIOR_COMISSAO':
      valor = (p) => p.comissaoValor
      ordenados = [...lista].sort(encadear(desc(valor), desc((p) => p.comissaoPercentual), evid, desc((p) => p.conversao), menorRisco))
      porque = (p) =>
        p.comissaoValor !== null
          ? `${reais(p.comissaoValor)} por venda${p.comissaoPercentual !== null ? ` (${pct(p.comissaoPercentual)} de ${p.preco !== null ? reais(p.preco) : 'preço desconhecido'})` : ''}.${p.vendas === 0 || (p.vendas === null && p.baseDeEvidencia < 40) ? ' Atenção: sem evidência de venda — comissão alta sozinha não garante receita.' : ''}`
          : p.comissaoPercentual !== null ? `${pct(p.comissaoPercentual)} de comissão; valor em R$ desconhecido (falta o preço real).` : semDado('comissão')
      break
    case 'MELHOR_OPORTUNIDADE':
    case 'EQUILIBRIO': {
      const notas = new Map(lista.map((p) => [p.id, notaDeOportunidade(p, lista)]))
      if (visao === 'EQUILIBRIO') {
        // Pesos iguais entre as dimensões conhecidas: ninguém domina.
        const dims = (p: ProdutoParaVisao) => {
          const v = [p.baseDeEvidencia / 100, normalizador(lista, (x) => x.vendas)(p), normalizador(lista, (x) => x.comissaoValor)(p), p.avaliacao !== null ? p.avaliacao / 5 : null, p.facilidadeVideo / 100, 1 - risco(p) / 2].filter((x): x is number => x !== null)
          return Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 1000) / 10
        }
        valor = dims
        ordenados = [...lista].sort(encadear(desc(valor), evid))
        porque = (p) => `Equilíbrio ${dims(p)}/100: média simples de evidência, vendas, comissão, avaliação, facilidade de vídeo e risco (só o que é conhecido).`
      } else {
        valor = (p) => notas.get(p.id)!.nota
        ordenados = [...lista].sort(encadear(desc(valor), evid))
        porque = (p) => porqueDaOportunidade(p, lista, notas.get(p.id)!.nota, notas.get(p.id)!.desconhecidos)
      }
      break
    }
    case 'MENOR_PRECO':
      valor = (p) => p.preco
      ordenados = [...lista].sort(encadear(asc(valor), evid))
      porque = (p) => (p.preco !== null ? `${reais(p.preco)}${p.descontoPercentual ? ` (${pct(p.descontoPercentual)} de desconto${p.precoAnterior ? ` sobre ${reais(p.precoAnterior)}` : ''})` : ''}. Preço baixo facilita a decisão de compra.` : semDado('preço'))
      break
    case 'MAIOR_TICKET':
      valor = (p) => p.preco
      ordenados = [...lista].sort(encadear(desc(valor), evid))
      porque = (p) => (p.preco !== null ? `${reais(p.preco)}: ticket alto rende mais comissão por venda, mas costuma converter menos.` : semDado('preço'))
      break
    case 'PRECO_X_COMISSAO': {
      // Quanto da venda vira comissão, favorecendo preço acessível (até R$ 100 sem desconto na nota).
      valor = (p) => (p.comissaoPercentual !== null && p.preco !== null ? Math.round(p.comissaoPercentual * Math.min(1, 100 / p.preco) * 10) / 10 : null)
      ordenados = [...lista].sort(encadear(desc(valor), evid))
      porque = (p) =>
        valor(p) !== null
          ? `${pct(p.comissaoPercentual!)} de comissão num produto de ${reais(p.preco!)}${p.preco! > 100 ? ' (preço alto reduz a nota: compra mais difícil)' : ''}.`
          : semDado(p.preco === null ? 'preço' : 'comissão')
      break
    }
    case 'VENDAS_X_COMISSAO':
    case 'POTENCIAL_DE_RECEITA': {
      valor = (p) => (p.vendas !== null && p.comissaoValor !== null ? Math.round(p.vendas * p.comissaoValor) : null)
      ordenados = [...lista].sort(encadear(desc(valor), evid))
      porque = (p) =>
        valor(p) !== null
          ? visao === 'POTENCIAL_DE_RECEITA'
            ? `${num(p.vendas!)} vendas × ${reais(p.comissaoValor!)} = ${reais(valor(p)!)} de comissão que este volume já gerou na loja (referência de demanda, não previsão).`
            : `Combina ${num(p.vendas!)} vendidos com ${reais(p.comissaoValor!)} por venda.`
          : semDado(p.vendas === null ? 'vendas' : 'comissão')
      break
    }
    case 'MELHOR_AVALIACAO':
      valor = (p) => ((p.numeroDeAvaliacoes ?? 0) >= 10 ? p.avaliacao : null)
      ordenados = [...lista].sort(encadear(desc(valor), desc((p) => p.numeroDeAvaliacoes), evid))
      porque = (p) => (valor(p) !== null ? `Nota ${p.avaliacao} com ${num(p.numeroDeAvaliacoes!)} avaliações.` : p.avaliacao !== null ? `Nota ${p.avaliacao}, mas com poucas avaliações (menos de 10): não conta.` : semDado('avaliação'))
      break
    case 'MAIS_AVALIACOES':
      valor = (p) => p.numeroDeAvaliacoes
      ordenados = [...lista].sort(encadear(desc(valor), evid))
      porque = (p) => (p.numeroDeAvaliacoes !== null ? `${num(p.numeroDeAvaliacoes)} avaliações${p.avaliacao !== null ? ` (nota ${p.avaliacao})` : ''}: prova social forte.` : semDado('avaliações'))
      break
    case 'NATAL':
      valor = (p) => p.aderenciaNatal
      ordenados = [...lista].sort(encadear(desc(valor), evid, desc((p) => p.comissaoValor)))
      porque = (p) => (p.aderenciaNatal ? `Aderência ao Natal ${p.aderenciaNatal}/100; evidência de venda ${p.baseDeEvidencia}/100.` : 'Sem relação com o Natal identificada.')
      break
    case 'MISSAO_TIKTOK':
      valor = (p) => (p.ajudaMissao ? 2 : p.tiktokShop ? 1 : 0)
      ordenados = [...lista].sort(encadear(desc(valor), evid, desc((p) => p.comissaoValor), desc((p) => p.facilidadeVideo)))
      porque = (p) =>
        p.ajudaMissao ? 'Produto do TikTok Shop que ajuda a cumprir missão ativa (marcável no vídeo).' : p.tiktokShop ? 'Produto do TikTok Shop (marcável no vídeo); nenhuma missão ativa de vídeo agora.' : 'Fora do TikTok Shop: não conta para missão nem pode ser marcado no vídeo.'
      break
    case 'VIDEO':
      valor = (p) => p.facilidadeVideo
      ordenados = [...lista].sort(encadear(desc(valor), evid))
      porque = (p) => `Facilidade de vídeo ${p.facilidadeVideo}/100 (demonstração visual, preço e categoria).`
      break
    case 'MENOR_RISCO':
      valor = (p) => 2 - risco(p)
      ordenados = [...lista].sort(encadear(desc(valor), evid))
      porque = (p) => (p.nivelDeRisco ? `Risco ${p.nivelDeRisco.toLowerCase()} de compliance/reputação.` : 'Risco não classificado.')
      break
  }
  return ordenados.map((p, i) => ({ posicao: i + 1, id: p.id, nome: p.nome, valor: valor(p), porque: porque(p) }))
}

/**
 * Comparação do consultor entre o 1º da "Maior comissão" e o 1º da "Melhor
 * oportunidade": "Este paga mais comissão, mas eu priorizaria aquele porque vende muito mais."
 */
export function compararComissaoEOportunidade(produtos: ProdutoParaVisao[]): string | null {
  const [c] = montarVisao('MAIOR_COMISSAO', produtos)
  const [o] = montarVisao('MELHOR_OPORTUNIDADE', produtos)
  if (!c || !o || c.valor === null) return null
  const pc = produtos.find((p) => p.id === c.id)!, po = produtos.find((p) => p.id === o.id)!
  if (c.id === o.id) return `"${pc.nome}" tem a maior comissão e também é a melhor oportunidade${pc.baseDeEvidencia >= 60 ? ' — comissão alta e boa evidência de venda; eu priorizaria' : ''}.`
  if (pc.vendas !== null && po.vendas !== null && po.vendas >= pc.vendas * 2) return `"${pc.nome}" paga mais comissão, mas eu priorizaria "${po.nome}" porque vende muito mais (${num(po.vendas)} contra ${num(pc.vendas)}).`
  if (po.baseDeEvidencia > pc.baseDeEvidencia) return `"${pc.nome}" paga mais comissão, mas eu priorizaria "${po.nome}" porque tem mais evidência de venda (${po.baseDeEvidencia} contra ${pc.baseDeEvidencia}).`
  return `"${pc.nome}" paga mais comissão; "${po.nome}" fica à frente no conjunto (vendas, missão, sazonalidade e vídeo).`
}
