/**
 * P2.17.4 — Aprendizado com vídeos do TikTok (contrato + lógica). FUNÇÃO PURA.
 *
 * Ainda não há métricas reais: nada aqui inventa número. Quando houver (manual
 * pela titular, clique em link rastreado ou API oficial após a conexão), cada
 * vídeo vira um `RegistroDeVideo` e esta lógica compara estrutura, CTA e
 * duração. Regras:
 *  - métrica ausente = não medida (fica fora da média), nunca zero;
 *  - só declara vencedor com amostra mínima em TODOS os grupos comparados;
 *  - o critério principal é RECEITA (comissão + vendas), não visualização:
 *    um vídeo com menos views e mais vendas vence o "viral sem conversão".
 */

export type OrigemDasMetricas = 'MANUAL' | 'LINK_RASTREADO' | 'API_TIKTOK'

export interface MetricasDoVideo {
  views?: number | null
  retencaoMedia?: number | null // 0–1
  tempoMedioSeg?: number | null
  cliquesProduto?: number | null
  ctr?: number | null // 0–1
  adicoesCarrinho?: number | null
  vendas?: number | null
  comissao?: number | null // R$
  /** P2.17.10: receita do vídeo (comissão + recompensa atribuída). Sem ela, vale a comissão. */
  receita?: number | null
}

export interface RegistroDeVideo {
  id: string
  produtoId: string | null
  estrutura: string
  gancho: string
  cta: 'A' | 'B'
  duracaoSegundos: number
  publicadoEm: Date
  metricas: MetricasDoVideo
  metasIds: string[]
  origemMetricas: OrigemDasMetricas
  /** P2.17.10: contexto para aprender por produto e categoria. */
  nomeProduto?: string | null
  categoria?: string | null
}

/** P2.17.10: produto, categoria, gancho e horário entram ao lado de estrutura, CTA e duração. */
export const DIMENSOES = ['produto', 'categoria', 'estrutura', 'gancho', 'cta', 'duracao', 'horario'] as const
export type Dimensao = (typeof DIMENSOES)[number]

export interface ResumoDoGrupo {
  grupo: string
  videos: number
  comMetricas: number
  receitaPor1000Views: number | null
  ctrMedio: number | null
  retencaoMedia: number | null
  vendas: number | null
  comissao: number | null
  receita?: number | null
}

export interface Aprendizado {
  dimensao: Dimensao
  grupos: ResumoDoGrupo[]
  vencedor: string | null
  recomendacao: string
}

export const AMOSTRA_MINIMA = 3
export const VIEWS_MINIMAS = 500

function media(xs: (number | null | undefined)[]): number | null {
  const v = xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null
}
function soma(xs: (number | null | undefined)[]): number | null {
  const v = xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
  return v.length ? v.reduce((s, x) => s + x, 0) : null
}

/** Faixa de horário em Brasília (UTC−3), pela hora da publicação. */
export function faixaDeHorario(d: Date): string {
  const h = (d.getUTCHours() + 21) % 24
  return h < 6 ? 'madrugada (0–6 h)' : h < 12 ? 'manhã (6–12 h)' : h < 18 ? 'tarde (12–18 h)' : 'noite (18–24 h)'
}

function chave(r: RegistroDeVideo, d: Dimensao): string {
  if (d === 'estrutura') return r.estrutura
  if (d === 'cta') return `CTA ${r.cta}`
  if (d === 'produto') return r.nomeProduto ?? r.produtoId ?? 'produto não informado'
  if (d === 'categoria') return r.categoria ?? 'categoria não informada'
  if (d === 'gancho') return r.gancho.trim().toLowerCase()
  if (d === 'horario') return faixaDeHorario(r.publicadoEm)
  return r.duracaoSegundos <= 20 ? 'curta (até 20 s)' : 'média (21 s ou mais)'
}

/** Receita do vídeo: informada, ou a comissão (receita de afiliada). NULL se nenhuma. */
const receitaDoRegistro = (r: RegistroDeVideo) => (typeof r.metricas.receita === 'number' ? r.metricas.receita : r.metricas.comissao ?? null)

/** FUNÇÃO PURA. Compara grupos de uma dimensão; vencedor só com amostra suficiente. */
export function aprender(registros: RegistroDeVideo[], d: Dimensao, opcoes = { amostraMinima: AMOSTRA_MINIMA, viewsMinimas: VIEWS_MINIMAS }): Aprendizado {
  const porGrupo = new Map<string, RegistroDeVideo[]>()
  for (const r of registros) porGrupo.set(chave(r, d), [...(porGrupo.get(chave(r, d)) ?? []), r])
  const grupos: ResumoDoGrupo[] = [...porGrupo.entries()].map(([grupo, rs]) => {
    const medidos = rs.filter((r) => typeof r.metricas.views === 'number' && r.metricas.views >= opcoes.viewsMinimas)
    const views = soma(medidos.map((r) => r.metricas.views))
    // P2.17.10: o critério é RECEITA (receita informada, senão comissão), nunca views.
    const receita = soma(medidos.map((r) => receitaDoRegistro(r)))
    return {
      grupo,
      videos: rs.length,
      comMetricas: medidos.length,
      receitaPor1000Views: views && receita !== null ? Math.round((receita / views) * 1000 * 100) / 100 : null,
      ctrMedio: media(medidos.map((r) => r.metricas.ctr)),
      retencaoMedia: media(medidos.map((r) => r.metricas.retencaoMedia)),
      vendas: soma(medidos.map((r) => r.metricas.vendas)),
      comissao: soma(medidos.map((r) => r.metricas.comissao)),
      receita,
    }
  })
  const comparaveis = grupos.filter((g) => g.comMetricas >= opcoes.amostraMinima && g.receitaPor1000Views !== null)
  if (grupos.length < 2 || comparaveis.length < 2 || comparaveis.length < grupos.length) {
    return {
      dimensao: d,
      grupos,
      vencedor: null,
      recomendacao: `Dados insuficientes para comparar por ${d}: preciso de pelo menos ${opcoes.amostraMinima} vídeos medidos (≥ ${opcoes.viewsMinimas} views) em cada grupo. Continue testando.`,
    }
  }
  const ordenados = [...comparaveis].sort((a, b) => (b.receitaPor1000Views ?? 0) - (a.receitaPor1000Views ?? 0) || (b.ctrMedio ?? 0) - (a.ctrMedio ?? 0))
  const [melhor, segundo] = ordenados
  return {
    dimensao: d,
    grupos,
    vencedor: melhor.grupo,
    recomendacao: `Produzir mais "${melhor.grupo}": R$ ${melhor.receitaPor1000Views?.toFixed(2)} a cada 1.000 views, contra R$ ${segundo.receitaPor1000Views?.toFixed(2)} de "${segundo.grupo}". Critério: receita, não visualização.`,
  }
}

/** FUNÇÃO PURA. O que fazer com cada estrutura: repetir, testar mais, reduzir ou parar. */
export function decisaoPorEstrutura(a: Aprendizado): { grupo: string; decisao: 'REPETIR' | 'TESTAR_MAIS' | 'REDUZIR' | 'PARAR'; motivo: string }[] {
  return a.grupos.map((g) => {
    if (g.comMetricas < AMOSTRA_MINIMA) return { grupo: g.grupo, decisao: 'TESTAR_MAIS' as const, motivo: `Só ${g.comMetricas} vídeo(s) medido(s).` }
    if (a.vencedor === g.grupo) return { grupo: g.grupo, decisao: 'REPETIR' as const, motivo: 'Melhor receita por 1.000 views.' }
    if ((g.vendas ?? 0) === 0 && (g.receita ?? g.comissao ?? 0) === 0) return { grupo: g.grupo, decisao: 'PARAR' as const, motivo: 'Medido e sem nenhuma venda.' }
    return { grupo: g.grupo, decisao: 'REDUZIR' as const, motivo: 'Vende, mas menos que o vencedor.' }
  })
}

/** Converte a linha do banco no contrato (métrica NULL continua NULL). */
export function registroDaLinha(l: {
  id: string; produtoId: string | null; estrutura: string; gancho: string; cta: string; duracaoSegundos: number; publicadoEm: Date
  views: number | null; retencaoMedia: number | null; tempoMedioSeg: number | null; cliquesProduto: number | null; ctr: number | null
  adicoesCarrinho: number | null; vendas: number | null; comissao: number | null; metasIds: string[]; origemMetricas: string
  receita?: number | null; nomeProduto?: string | null; categoria?: string | null
}): RegistroDeVideo {
  return {
    id: l.id, produtoId: l.produtoId, estrutura: l.estrutura, gancho: l.gancho, cta: l.cta === 'B' ? 'B' : 'A', duracaoSegundos: l.duracaoSegundos,
    publicadoEm: l.publicadoEm, metasIds: l.metasIds, nomeProduto: l.nomeProduto ?? null, categoria: l.categoria ?? null,
    origemMetricas: (['MANUAL', 'LINK_RASTREADO', 'API_TIKTOK'].includes(l.origemMetricas) ? l.origemMetricas : 'MANUAL') as OrigemDasMetricas,
    metricas: { views: l.views, retencaoMedia: l.retencaoMedia, tempoMedioSeg: l.tempoMedioSeg, cliquesProduto: l.cliquesProduto, ctr: l.ctr, adicoesCarrinho: l.adicoesCarrinho, vendas: l.vendas, comissao: l.comissao, receita: l.receita ?? null },
  }
}
