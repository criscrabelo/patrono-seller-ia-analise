'use client'

import { TrendingUp, DollarSign } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'

interface ProdutoEscala {
  produtoId: string
  nome: string
  cliques: number
  conversoes: number
  receitaTotal: number
  ticketMedio: number
  taxaConversao: number
  scoreEscala: number
  /** P2.50: abaixo da amostra mínima não há faixa de decisão nem número. */
  amostraSuficiente?: boolean
  faixa: { label: string; cor: 'gold' | 'blue' | 'amber' | 'red' }
}

const CORES: Record<ProdutoEscala['faixa']['cor'], string> = {
  gold: 'text-accent bg-accent/10 border-accent/30',
  blue: 'text-blue-400 bg-blue-400/10 border-blue-400/30',
  amber: 'text-warning bg-warning/10 border-warning/30',
  red: 'text-danger bg-danger/10 border-danger/30',
}

export interface ResultadoAposCustosResumo {
  receitaConfirmada: number
  custos: number
  resultado: number | null
  limitacoes: string[]
  /** P2.53: separado por tipo de operação. */
  porOperacao?: { afiliados: { receitaConfirmada: number; previsao: number }; vendasProprias: { situacao: string; motivo: string } }
}

export function LucroEscala({
  comissaoTotal,
  produtos,
  resultado,
}: {
  comissaoTotal: number
  produtos: ProdutoEscala[]
  /** P2.50: comissão confirmada − custos. */
  resultado?: ResultadoAposCustosResumo | null
}) {
  const temVendas = produtos.some((p) => p.conversoes > 0)

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Lucro e Escala
        </h2>
        <div className="flex items-center gap-1.5 text-sm">
          <DollarSign className="w-4 h-4 text-accent" />
          <span className="font-bold text-white">{formatCurrency(comissaoTotal)}</span>
          <span className="text-muted-foreground text-xs">em comissão</span>
        </div>
      </div>
      {resultado && (
        <p className="text-xs text-muted-foreground mb-3" title={resultado.limitacoes.join(' ')}>
          Resultado após custos:{' '}
          {resultado.resultado === null ? (
            <span className="text-warning">não calculado (custos não apurados)</span>
          ) : (
            <span className="font-semibold text-white">{formatCurrency(resultado.resultado)}</span>
          )}{' '}
          = comissão confirmada {formatCurrency(resultado.receitaConfirmada)} − custos {formatCurrency(resultado.custos)}
          {resultado.porOperacao && (
            <span className="block mt-0.5">
              Afiliados: {formatCurrency(resultado.porOperacao.afiliados.receitaConfirmada)} confirmado
              {resultado.porOperacao.afiliados.previsao > 0 && <> (+ {formatCurrency(resultado.porOperacao.afiliados.previsao)} em previsão, fora do resultado)</>}
              {' · '}Vendas próprias: <span title={resultado.porOperacao.vendasProprias.motivo}>sem operação (fase futura)</span>
            </span>
          )}
        </p>
      )}

      {produtos.length === 0 ? (
        <div className="card-stat flex flex-col items-center justify-center py-8 text-center">
          <TrendingUp className="w-8 h-8 text-muted-foreground mb-2 opacity-30" />
          <p className="text-sm text-muted-foreground">Gere links dinâmicos para ver o desempenho por produto aqui.</p>
        </div>
      ) : !temVendas ? (
        <div className="card-stat flex flex-col items-center justify-center py-8 text-center">
          <TrendingUp className="w-8 h-8 text-muted-foreground mb-2 opacity-30" />
          <p className="text-sm text-muted-foreground">
            Nenhuma venda registrada ainda. Registre vendas em{' '}
            <span className="text-accent">Links Dinâmicos</span> para calcular comissão, ticket médio e Score de Escala.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Produto</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Conversões</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground hidden sm:table-cell">Comissão Média</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Comissão Total</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Score de Escala</th>
              </tr>
            </thead>
            <tbody>
              {produtos.map((p) => (
                <tr key={p.produtoId} className="border-b border-border last:border-0 hover:bg-secondary/50 transition-colors">
                  <td className="px-4 py-3 font-medium text-white max-w-[160px] truncate">{p.nome}</td>
                  <td className="px-4 py-3 text-right text-muted-foreground">{p.conversoes}</td>
                  <td className="px-4 py-3 text-right text-muted-foreground hidden sm:table-cell">
                    {formatCurrency(p.ticketMedio)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-white">
                    {formatCurrency(p.receitaTotal)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold ${CORES[p.faixa.cor]}`}>
                      {p.amostraSuficiente === false ? p.faixa.label : `${p.scoreEscala} · ${p.faixa.label}`}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
