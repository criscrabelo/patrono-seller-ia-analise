'use client'

import { PartyPopper, Sparkles } from 'lucide-react'
import { formatCurrency, formatDateShort } from '@/lib/utils'

type Comissao = {
  id: string
  status: string
  valor: number | null
  produto: string | null
  plataforma: string | null
  vendaId: string | null
  data: string
}

export type PrimeiraComissaoData =
  | { concluida: false }
  | { concluida: true; comissao: Comissao }

/**
 * Card "Minha primeira comissão" — fecha o fluxo aprovado (Programa →
 * Produto → Link → Conteúdo → Aprovar → Distribuir → Publicar → Resultados
 * → Registrar venda/comissão → Primeira comissão).
 *
 * Todo dado exibido na celebração (valor, produto, plataforma) vem de uma
 * Commission real — nunca hardcoded, nunca inventado quando os dados não
 * existem (ver lib/vendas-comissoes.ts `primeiraComissao()`).
 */
export function PrimeiraComissaoCard({ dados }: { dados: PrimeiraComissaoData | undefined }) {
  if (!dados) return null

  if (!dados.concluida) {
    return (
      <div className="card-stat flex items-center gap-4">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-accent/10 shrink-0">
          <Sparkles className="w-5 h-5 text-accent" />
        </div>
        <div>
          <p className="text-sm font-semibold text-white">Minha primeira comissão</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Ainda não há nenhuma comissão confirmada. Registre um resultado em{' '}
            <span className="text-accent">Vendas e Comissões</span> assim que tiver uma venda.
          </p>
        </div>
      </div>
    )
  }

  const { comissao } = dados

  return (
    <div className="card-stat border-accent/40 bg-accent/5 flex items-center gap-4">
      <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-accent/15 shrink-0">
        <PartyPopper className="w-5 h-5 text-accent" />
      </div>
      <div>
        <p className="text-sm font-semibold text-white">🎉 Primeira comissão registrada!</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {comissao.valor != null ? formatCurrency(comissao.valor) : 'Valor a confirmar'}
          {comissao.produto ? ` · ${comissao.produto}` : ''}
          {comissao.plataforma ? ` · ${comissao.plataforma}` : ''}
          {' · '}
          {formatDateShort(comissao.data)}
        </p>
      </div>
    </div>
  )
}
