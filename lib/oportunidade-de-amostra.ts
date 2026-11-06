/**
 * P2.22 — SAMPLE OPPORTUNITY SCORE: vale pedir a amostra deste produto? FUNÇÃO PURA.
 *
 * Decisão: PEDIR | PEDIR_SE_PRIORIDADE | NAO_PRIORITARIO | NAO_PEDIR — sempre com a decomposição:
 * cada FATOR mostra o valor visto, a fonte, o efeito (−2…+2), o PESO e a contribuição. Fator sem fonte
 * confiável é UNKNOWN (fica fora da conta; ausência nunca vira zero). Dado vencido é VENCIDO (fora da conta
 * e limita a decisão até revalidar).
 *
 * Travas (antes da conta):
 *   - produto em mãos → NAO_PEDIR (segue para o conteúdo);
 *   - fora do TikTok Shop, sem amostra no app, indisponível ou bloqueio de compliance → NAO_PEDIR.
 * A META de amostras não entra na nota: só pode subir um degrau um produto que JÁ é razoável por conta
 * própria (nunca transforma produto ruim em PEDIR) e só se a amostra chega antes do prazo.
 */

export type DecisaoDeAmostra = 'PEDIR' | 'PEDIR_SE_PRIORIDADE' | 'NAO_PRIORITARIO' | 'NAO_PEDIR'
export type SituacaoDoFator = 'USADO' | 'UNKNOWN' | 'VENCIDO'

/** Pesos documentados (o efeito de cada fator vai de −2 a +2). */
export const PESOS = {
  comissao: 3,
  comissaoLiquidadaHistorica: 2,
  vendas: 2,
  tendencia: 1.5,
  aceleracao: 1,
  preco: 1,
  aderencia: 2,
  tipoDeAmostra: 2,
  historicoDaLoja: 1,
  campanha: 1.5,
  facilidade: 1.5,
  usoReal: 1,
  reaproveitamento: 1,
  semelhantes: 2,
} as const
export type Fator = keyof typeof PESOS | 'metaDeAmostras' | 'prazo' | 'obrigacaoDeConteudo' | 'disponibilidade'

/** Limites da nota normalizada (−1…+1 sobre os fatores conhecidos). */
export const LIMITES = { PEDIR: 0.35, PEDIR_SE_PRIORIDADE: 0.1, NAO_PEDIR: -0.2, COBERTURA_MINIMA: 0.3 } as const
/** Recebimento estimado (sem prazo oficial): a amostra costuma levar ~14 dias; +2 dias para produzir. */
export const DIAS_ATE_PODER_PUBLICAR = 16
export const VALIDADE_DO_DADO_COMERCIAL_DIAS = 7

const DIA = 86_400_000

export interface Medida<T> { valor: T | null; fonte: string | null; em: Date | null; vencido?: boolean }
export interface EntradaDaAmostra {
  agora: Date
  emMaos: boolean
  tiktokShop: boolean
  complianceBloqueante: boolean
  nome: string
  categoria: string | null
  comissaoValor: Medida<number>
  comissaoPercentual: Medida<number>
  preco: Medida<number>
  vendas: Medida<number>
  /** Série de vendas exibidas (acumuladas no app), mais antiga primeiro. */
  serieDeVendas: { em: Date; vendas: number }[]
  tipoDeAmostra: Medida<'GRATIS' | 'REEMBOLSAVEL' | 'NENHUMA'>
  disponivel: Medida<boolean>
  /** Mediana da comissão (R$/venda) da categoria entre os produtos conhecidos (null = sem base). */
  medianaDaCategoria: number | null
  comissaoLiquidadaHistorica: number | null
  /** Categorias prioritárias do perfil da loja/audiência (null = perfil não configurado). */
  categoriasDaAudiencia: string[] | null
  historicoDaLoja: { loja: string; aprovadas: number; rejeitadas: number } | null
  aderenciaDeCampanha: { nome: string; aderencia: number; fim: Date | null } | null
  metasDeAmostra: { nome: string; faltam: number; fim: Date }[]
  /** Prazo para publicar depois de receber (dias), quando informado pelo app/vendedor. */
  prazoDeConteudoDias: number | null
  facilidadeDeVideo: number | null
  /** Formatos de vídeo possíveis e quantos NÃO exigem uso real (planner). */
  formatosPossiveis: number | null
  formatosSemUsoReal: number | null
  /** Comissão por 1.000 views dos vídeos da categoria ÷ todos (P2.21; null = poucos vídeos). */
  semelhantes: { razao: number; videos: number } | null
}

export interface FatorAvaliado {
  fator: Fator
  rotulo: string
  valor: string
  fonte: string | null
  situacao: SituacaoDoFator
  efeito: number
  peso: number
  contribuicao: number
  explicacao: string
}

export interface AvaliacaoDeAmostra {
  decisao: DecisaoDeAmostra
  /** Nota interna (−100…+100) — sempre acompanhada da decomposição. */
  nota: number | null
  confianca: 'ALTA' | 'MEDIA' | 'BAIXA'
  cobertura: number
  fatores: FatorAvaliado[]
  usados: string[]
  ausentes: string[]
  vencidos: string[]
  motivos: string[]
  riscos: string[]
  motivoFinal: string
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dias = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DIA)
const vencido = (m: Medida<unknown>, agora: Date) => !!m.vencido || (!!m.em && agora.getTime() - m.em.getTime() > VALIDADE_DO_DADO_COMERCIAL_DIAS * DIA)

/** Tendência/aceleração das vendas acumuladas: velocidade (vendas/dia) entre observações. */
export function tendenciaDasVendas(serie: { em: Date; vendas: number }[]): { tendencia: 'SUBINDO' | 'ESTAVEL' | null; aceleracao: 'ACELERANDO' | 'DESACELERANDO' | 'ESTAVEL' | null } {
  const s = [...serie].sort((a, b) => a.em.getTime() - b.em.getTime()).filter((x, i, xs) => i === 0 || x.em.getTime() - xs[i - 1].em.getTime() >= DIA)
  if (s.length < 2) return { tendencia: null, aceleracao: null }
  const vel = (a: { em: Date; vendas: number }, b: { em: Date; vendas: number }) => Math.max(0, b.vendas - a.vendas) / Math.max(1, (b.em.getTime() - a.em.getTime()) / DIA)
  const ultimo = s[s.length - 1]
  const v2 = vel(s[s.length - 2], ultimo)
  const tendencia = ultimo.vendas > 0 && v2 / ultimo.vendas >= 0.01 ? 'SUBINDO' : 'ESTAVEL'
  if (s.length < 3) return { tendencia, aceleracao: null }
  const v1 = vel(s[s.length - 3], s[s.length - 2])
  const aceleracao = v1 === 0 ? (v2 > 0 ? 'ACELERANDO' : 'ESTAVEL') : v2 > 1.2 * v1 ? 'ACELERANDO' : v2 < 0.8 * v1 ? 'DESACELERANDO' : 'ESTAVEL'
  return { tendencia, aceleracao }
}

export function avaliarOportunidadeDeAmostra(e: EntradaDaAmostra): AvaliacaoDeAmostra {
  const fatores: FatorAvaliado[] = []
  const riscos: string[] = []
  const add = (fator: Fator, rotulo: string, situacao: SituacaoDoFator, valor: string, fonte: string | null, efeito: number, explicacao: string) => {
    const peso = (PESOS as Record<string, number>)[fator] ?? 0
    fatores.push({ fator, rotulo, valor, fonte, situacao, efeito: situacao === 'USADO' ? efeito : 0, peso, contribuicao: situacao === 'USADO' ? efeito * peso : 0, explicacao })
  }
  const desconhecido = (fator: Fator, rotulo: string, por = 'sem fonte confiável') => add(fator, rotulo, 'UNKNOWN', 'UNKNOWN', null, 0, por)
  const medida = <T>(fator: Fator, rotulo: string, m: Medida<T>, avaliar: (v: T) => [number, string], fmt: (v: T) => string = String) => {
    if (m.valor === null || m.valor === undefined) return desconhecido(fator, rotulo)
    if (vencido(m, e.agora)) return add(fator, rotulo, 'VENCIDO', fmt(m.valor), m.fonte, 0, `dado de ${m.em ? m.em.toLocaleDateString('pt-BR') : '?'}: precisa revalidar`)
    const [efeito, explicacao] = avaliar(m.valor)
    add(fator, rotulo, 'USADO', fmt(m.valor), m.fonte, efeito, explicacao)
  }

  // ── Travas ──
  const trava = (motivo: string): AvaliacaoDeAmostra => ({ decisao: 'NAO_PEDIR', nota: null, confianca: 'ALTA', cobertura: 0, fatores: [], usados: [], ausentes: [], vencidos: [], motivos: [motivo], riscos: [], motivoFinal: motivo })
  if (e.emMaos) return trava('Você já tem o produto: não precisa de amostra — o Patrono segue para o conteúdo.')
  if (!e.tiktokShop) return trava('Produto fora do TikTok Shop: não há amostra de afiliada para pedir.')
  if (e.complianceBloqueante) return trava('Produto com bloqueio de compliance: não divulgar, então não pedir amostra.')
  if (e.tipoDeAmostra.valor === 'NENHUMA' && !vencido(e.tipoDeAmostra, e.agora)) return trava('O produto não oferece amostra no app.')
  if (e.disponivel.valor === false && !vencido(e.disponivel, e.agora)) return trava(`Produto indisponível na fonte oficial${e.disponivel.fonte ? ` (${e.disponivel.fonte})` : ''}.`)

  // ── Fatores ──
  medida('comissao', 'Comissão atual', e.comissaoValor, (v) => {
    const med = e.medianaDaCategoria
    if (med && v >= med * 1.5) return [2, `${brl(v)} por venda: acima da média da categoria (${brl(med)})`]
    if (v >= 10) return [2, `${brl(v)} por venda: comissão alta`]
    if (v >= 4) return [1, `${brl(v)} por venda: comissão boa`]
    if (v >= 2) return [0, `${brl(v)} por venda: comissão modesta`]
    return [-2, `${brl(v)} por venda: comissão baixa`]
  }, brl)
  if (e.comissaoValor.valor == null && e.comissaoPercentual.valor != null) {
    // Sem o valor em R$, o percentual sozinho não diz quanto se ganha: registra, sem pontuar.
    fatores[fatores.length - 1] = { ...fatores[fatores.length - 1], valor: `${e.comissaoPercentual.valor}% (sem valor em R$)`, explicacao: 'só o percentual: sem o preço confirmado não dá para saber quanto rende' }
  }
  if (e.comissaoLiquidadaHistorica == null) desconhecido('comissaoLiquidadaHistorica', 'Comissão liquidada deste produto', 'nenhum pedido liquidado importado')
  else add('comissaoLiquidadaHistorica', 'Comissão liquidada deste produto', 'USADO', brl(e.comissaoLiquidadaHistorica), 'Creator Center (pedidos LIQUIDADA)', e.comissaoLiquidadaHistorica > 0 ? 2 : 0, e.comissaoLiquidadaHistorica > 0 ? 'já gerou comissão confirmada' : 'ainda sem comissão confirmada')
  medida('vendas', 'Vendas observadas', e.vendas, (v) => (v >= 1000 ? [2, `${v} vendas: demanda comprovada`] : v >= 100 ? [1, `${v} vendas: há demanda`] : v >= 10 ? [0, `${v} vendas: demanda pequena`] : [-2, `${v} vendas: sem demanda visível`]))
  const t = tendenciaDasVendas(e.serieDeVendas)
  if (!t.tendencia) desconhecido('tendencia', 'Tendência', 'menos de 2 observações em dias diferentes')
  else add('tendencia', 'Tendência', 'USADO', t.tendencia, 'Observações de mercado', t.tendencia === 'SUBINDO' ? 1 : 0, t.tendencia === 'SUBINDO' ? 'vendas subindo entre as observações' : 'vendas paradas entre as observações')
  if (!t.aceleracao) desconhecido('aceleracao', 'Aceleração', 'menos de 3 observações')
  else add('aceleracao', 'Aceleração', 'USADO', t.aceleracao, 'Observações de mercado', t.aceleracao === 'ACELERANDO' ? 1 : t.aceleracao === 'DESACELERANDO' ? -1 : 0, t.aceleracao === 'ACELERANDO' ? 'produto em aceleração' : t.aceleracao === 'DESACELERANDO' ? 'vendas desacelerando' : 'ritmo estável')
  medida('preco', 'Preço atual', e.preco, (v) => (v < 15 ? [-1, `${brl(v)}: ticket baixo`] : v > 400 ? [-1, `${brl(v)}: ticket alto, conversão difícil`] : [1, `${brl(v)}: faixa boa para vídeo`]), brl)
  if (!e.categoriasDaAudiencia || !e.categoria) desconhecido('aderencia', 'Aderência à audiência', !e.categoriasDaAudiencia ? 'perfil da loja não configurado' : 'categoria do produto desconhecida')
  else {
    const casa = e.categoriasDaAudiencia.some((c) => c.toLowerCase() === e.categoria!.toLowerCase())
    add('aderencia', 'Aderência à audiência', 'USADO', e.categoria, 'Perfil da loja', casa ? 2 : -1, casa ? 'categoria prioritária da sua audiência' : 'fora das categorias prioritárias da sua audiência')
  }
  medida('tipoDeAmostra', 'Tipo de amostra', e.tipoDeAmostra, (v) => (v === 'GRATIS' ? [2, 'amostra grátis disponível'] : [0, 'reembolsável: você paga e recebe de volta depois']))
  if (!e.historicoDaLoja) desconhecido('historicoDaLoja', 'Histórico da loja', 'sem pedidos anteriores a esta loja')
  else {
    const h = e.historicoDaLoja
    add('historicoDaLoja', 'Histórico da loja', 'USADO', `${h.aprovadas} aprovada(s), ${h.rejeitadas} rejeitada(s)`, h.loja, h.rejeitadas > h.aprovadas ? -1 : h.aprovadas > 0 ? 1 : 0, h.rejeitadas > h.aprovadas ? 'a loja já recusou amostras suas' : 'a loja já aprovou amostras suas')
  }
  if (!e.aderenciaDeCampanha) desconhecido('campanha', 'Campanha', 'nenhuma campanha ligada ao produto')
  else {
    const c = e.aderenciaDeCampanha
    const aTempo = !c.fim || dias(e.agora, c.fim) >= DIAS_ATE_PODER_PUBLICAR
    add('campanha', 'Campanha', 'USADO', `${c.nome} (aderência ${c.aderencia})`, 'Calendário de campanhas', c.aderencia >= 50 && aTempo ? 1 : 0, c.aderencia >= 50 ? (aTempo ? `combina com ${c.nome}` : `${c.nome} termina antes de a amostra chegar`) : `pouca aderência a ${c.nome}`)
    if (c.fim && !aTempo && c.aderencia >= 50) riscos.push(`${c.nome} termina em ${dias(e.agora, c.fim)} dia(s): a amostra pode não chegar a tempo.`)
  }
  if (e.facilidadeDeVideo == null) desconhecido('facilidade', 'Facilidade de demonstrar')
  else add('facilidade', 'Facilidade de demonstrar', 'USADO', `${e.facilidadeDeVideo}/100`, 'Planejador de vídeos', e.facilidadeDeVideo >= 75 ? 1 : e.facilidadeDeVideo < 45 ? -1 : 0, e.facilidadeDeVideo >= 75 ? 'conteúdo fácil de demonstrar' : e.facilidadeDeVideo < 45 ? 'conteúdo difícil de demonstrar' : 'demonstração média')
  if (e.formatosPossiveis == null || e.formatosSemUsoReal == null) { desconhecido('usoReal', 'Necessidade de uso real'); desconhecido('reaproveitamento', 'Reaproveitamento de conteúdo') }
  else {
    add('usoReal', 'Necessidade de uso real', 'USADO', `${e.formatosSemUsoReal} de ${e.formatosPossiveis} formatos sem uso real`, 'Planejador de vídeos', e.formatosSemUsoReal === 0 ? -1 : 0, e.formatosSemUsoReal === 0 ? 'todo vídeo exige usar o produto de verdade antes' : 'há formatos que não exigem uso prolongado')
    add('reaproveitamento', 'Reaproveitamento de conteúdo', 'USADO', `${e.formatosPossiveis} formatos`, 'Planejador de vídeos', e.formatosPossiveis >= 8 ? 1 : e.formatosPossiveis <= 3 ? -1 : 0, e.formatosPossiveis >= 8 ? 'rende vários vídeos diferentes' : e.formatosPossiveis <= 3 ? 'rende poucos vídeos' : 'rende alguns vídeos')
  }
  if (!e.semelhantes) desconhecido('semelhantes', 'Produtos semelhantes', 'poucos vídeos medidos da categoria')
  else add('semelhantes', 'Produtos semelhantes', 'USADO', `${e.semelhantes.razao.toFixed(1).replace('.', ',')}x (${e.semelhantes.videos} vídeos)`, 'Resultados dos seus vídeos (P2.21)', e.semelhantes.razao >= 1.3 ? 2 : e.semelhantes.razao >= 1 ? 1 : e.semelhantes.razao < 0.7 ? -1 : 0, e.semelhantes.razao >= 1 ? 'a categoria rende bem nos seus vídeos' : 'a categoria rende abaixo da média nos seus vídeos')

  // Disponibilidade, prazo e obrigação: informativos (não pontuam), viram risco quando faltam.
  fatores.push({ fator: 'disponibilidade', rotulo: 'Disponibilidade', valor: e.disponivel.valor == null ? 'UNKNOWN' : e.disponivel.valor ? 'disponível' : 'indisponível', fonte: e.disponivel.fonte, situacao: e.disponivel.valor == null ? 'UNKNOWN' : vencido(e.disponivel, e.agora) ? 'VENCIDO' : 'USADO', efeito: 0, peso: 0, contribuicao: 0, explicacao: 'trava (indisponível = não pedir)' })
  fatores.push({ fator: 'obrigacaoDeConteudo', rotulo: 'Prazo para publicar após receber', valor: e.prazoDeConteudoDias == null ? 'UNKNOWN' : `${e.prazoDeConteudoDias} dia(s)`, fonte: e.prazoDeConteudoDias == null ? null : 'App/vendedor', situacao: e.prazoDeConteudoDias == null ? 'UNKNOWN' : 'USADO', efeito: 0, peso: 0, contribuicao: 0, explicacao: 'informativo' })
  if (e.prazoDeConteudoDias == null) riscos.push('Prazo de publicação exigido pelo vendedor não informado: confira no app antes de pedir.')
  else if (e.prazoDeConteudoDias <= 5) riscos.push(`Depois de receber, você tem só ${e.prazoDeConteudoDias} dia(s) para publicar.`)

  // ── Nota ──
  const conhecidos = fatores.filter((f) => f.peso > 0 && f.situacao === 'USADO')
  const pesoTotal = Object.values(PESOS).reduce((s, p) => s + p, 0)
  const pesoConhecido = conhecidos.reduce((s, f) => s + f.peso, 0)
  const cobertura = Math.round((pesoConhecido / pesoTotal) * 100) / 100
  const nota = pesoConhecido ? conhecidos.reduce((s, f) => s + f.contribuicao, 0) / (2 * pesoConhecido) : null
  const vencidos = fatores.filter((f) => f.situacao === 'VENCIDO').map((f) => f.rotulo)
  const comissaoVencida = fatores.some((f) => f.fator === 'comissao' && f.situacao === 'VENCIDO')
  const ruim = conhecidos.some((f) => (f.fator === 'comissao' || f.fator === 'vendas') && f.efeito <= -2)
  const confianca: AvaliacaoDeAmostra['confianca'] = vencidos.length ? 'BAIXA' : cobertura >= 0.6 ? 'ALTA' : cobertura >= 0.4 ? 'MEDIA' : 'BAIXA'

  let decisao: DecisaoDeAmostra
  let motivoFinal: string
  if (nota === null || cobertura < LIMITES.COBERTURA_MINIMA) {
    decisao = 'NAO_PRIORITARIO'
    motivoFinal = `Dados insuficientes para decidir (${Math.round(cobertura * 100)}% dos fatores conhecidos): registre comissão, vendas e tipo de amostra vistos no app.`
  } else if (nota < LIMITES.NAO_PEDIR) {
    decisao = 'NAO_PEDIR'
    motivoFinal = 'Os fatores conhecidos apontam que não compensa pedir.'
  } else if (comissaoVencida) {
    decisao = 'NAO_PRIORITARIO'
    motivoFinal = 'A comissão vista está desatualizada: revalide no app antes de decidir.'
  } else if (nota >= LIMITES.PEDIR && confianca !== 'BAIXA') {
    decisao = 'PEDIR'
    motivoFinal = 'Vale pedir: os fatores conhecidos são favoráveis.'
  } else if (nota >= LIMITES.PEDIR_SE_PRIORIDADE) {
    decisao = 'PEDIR_SE_PRIORIDADE'
    motivoFinal = nota >= LIMITES.PEDIR ? 'Favorável, mas com pouca informação: peça se for prioridade.' : 'Razoável: peça se não houver opção melhor.'
  } else {
    decisao = 'NAO_PRIORITARIO'
    motivoFinal = 'Neutro: há opções melhores agora.'
  }
  if (vencidos.length && decisao === 'PEDIR') { decisao = 'PEDIR_SE_PRIORIDADE'; motivoFinal = `${motivoFinal} Revalide: ${vencidos.join(', ')}.` }

  // Meta: só sobe um degrau produto razoável, nunca produto ruim, e só se a amostra chega a tempo.
  const metas = e.metasDeAmostra.filter((m) => m.faltam > 0)
  fatores.push({ fator: 'metaDeAmostras', rotulo: 'Meta de amostras', valor: metas.length ? metas.map((m) => `${m.nome}: faltam ${m.faltam}`).join('; ') : 'nenhuma ativa', fonte: metas.length ? 'Metas do TikTok Shop' : null, situacao: metas.length ? 'USADO' : 'UNKNOWN', efeito: 0, peso: 0, contribuicao: 0, explicacao: 'não entra na nota: só desempata produto razoável' })
  const metaATempo = metas.find((m) => dias(e.agora, m.fim) >= 0)
  if (metaATempo && nota !== null && !ruim && !comissaoVencida && cobertura >= LIMITES.COBERTURA_MINIMA) {
    if (decisao === 'NAO_PRIORITARIO' && nota >= 0) { decisao = 'PEDIR_SE_PRIORIDADE'; motivoFinal = `Conta para a meta "${metaATempo.nome}" (faltam ${metaATempo.faltam}) e o produto é razoável.` }
    else if (decisao === 'PEDIR_SE_PRIORIDADE' && nota >= 0.25 && confianca !== 'BAIXA') { decisao = 'PEDIR'; motivoFinal = `Bom produto e conta para a meta "${metaATempo.nome}" (faltam ${metaATempo.faltam}).` }
  } else if (metaATempo && ruim) riscos.push(`A meta "${metaATempo.nome}" não justifica este produto: comissão ou demanda fracas.`)
  for (const m of metas) if (dias(e.agora, m.fim) < DIAS_ATE_PODER_PUBLICAR) riscos.push(`A meta "${m.nome}" termina em ${dias(e.agora, m.fim)} dia(s): prazo curto para receber e publicar.`)

  const motivos = [...conhecidos].filter((f) => f.efeito > 0).sort((a, b) => b.contribuicao - a.contribuicao).map((f) => f.explicacao)
  if (metaATempo && !ruim) motivos.push(`você ainda precisa de ${metaATempo.faltam} amostra(s) para a meta "${metaATempo.nome}"`)
  riscos.unshift(...conhecidos.filter((f) => f.efeito < 0).map((f) => f.explicacao))
  if (vencidos.length) riscos.push(`Dados vencidos (fora da conta): ${vencidos.join(', ')}.`)
  return {
    decisao, nota: nota === null ? null : Math.round(nota * 100), confianca, cobertura, fatores,
    usados: conhecidos.map((f) => f.rotulo), ausentes: fatores.filter((f) => f.situacao === 'UNKNOWN').map((f) => f.rotulo), vencidos,
    motivos, riscos, motivoFinal,
  }
}

/** Uma linha para a Jornada: decisão + o principal motivo (a decomposição completa vai junto). */
export function resumoDaAvaliacao(a: AvaliacaoDeAmostra): string {
  const rot = { PEDIR: 'PEDIR', PEDIR_SE_PRIORIDADE: 'PEDIR SE FOR PRIORIDADE', NAO_PRIORITARIO: 'NÃO PRIORITÁRIO', NAO_PEDIR: 'NÃO PEDIR' }[a.decisao]
  const pontos = a.motivos.slice(0, 3)
  return `${rot}: ${a.motivoFinal}${pontos.length ? ` Motivos: ${pontos.join('; ')}.` : ''}${a.riscos.length ? ` Riscos: ${a.riscos.slice(0, 2).join(' ')}` : ''}`
}
