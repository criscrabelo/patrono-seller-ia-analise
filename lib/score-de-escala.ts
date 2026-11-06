/**
 * Score de Escala (0-100): metade pelo desempenho de conversão, metade pela receita
 * gerada em relação ao produto que mais rendeu. 15% de conversão já vale os 50 pontos
 * da metade de conversão — acima disso não soma mais.
 *
 * P2.50 (Codex 22): sem amostra mínima, 1 venda em 2 cliques virava "Campeão ·
 * escalar já". Abaixo de AMOSTRA_MINIMA_ESCALA o produto NÃO recebe faixa de
 * decisão: fica "Amostra pequena · continuar medindo" e nunca é recomendado
 * para escalar. FUNÇÃO PURA (antes morava na rota /api/metricas).
 */
export const AMOSTRA_MINIMA_ESCALA = { cliques: 100, conversoes: 3 } as const

export interface ProdutoComVenda {
  produtoId: string
  nome: string
  cliques: number
  conversoes: number
  receitaTotal: number
}

export type CorDaFaixa = 'gold' | 'blue' | 'amber' | 'red'

export function amostraSuficiente(p: { cliques: number; conversoes: number }): boolean {
  return p.cliques >= AMOSTRA_MINIMA_ESCALA.cliques && p.conversoes >= AMOSTRA_MINIMA_ESCALA.conversoes
}

export function faixaEscala(score: number, suficiente = true): { label: string; cor: CorDaFaixa } {
  if (!suficiente) return { label: 'Amostra pequena · continuar medindo', cor: 'amber' }
  if (score >= 81) return { label: 'Campeão · escalar já', cor: 'gold' }
  if (score >= 61) return { label: 'Promissor', cor: 'blue' }
  if (score >= 31) return { label: 'Testar mais', cor: 'amber' }
  return { label: 'Não escalar', cor: 'red' }
}

export function calcularScoreEscala(produtos: ProdutoComVenda[]) {
  const maxReceita = Math.max(0, ...produtos.map((p) => p.receitaTotal))

  return produtos
    .map((p) => {
      const taxaConversao = p.cliques > 0 ? p.conversoes / p.cliques : 0
      const receitaRelativa = maxReceita > 0 ? p.receitaTotal / maxReceita : 0
      const scoreEscala = Math.round(Math.min(1, taxaConversao / 0.15) * 50 + receitaRelativa * 50)
      const suficiente = amostraSuficiente(p)
      return {
        produtoId: p.produtoId,
        nome: p.nome,
        cliques: p.cliques,
        conversoes: p.conversoes,
        receitaTotal: p.receitaTotal,
        ticketMedio: p.conversoes > 0 ? p.receitaTotal / p.conversoes : 0,
        taxaConversao,
        scoreEscala,
        amostraSuficiente: suficiente,
        faixa: faixaEscala(scoreEscala, suficiente),
      }
    })
    // Com amostra suficiente primeiro; dentro de cada grupo, pelo score.
    .sort((a, b) => Number(b.amostraSuficiente) - Number(a.amostraSuficiente) || b.scoreEscala - a.scoreEscala)
}
