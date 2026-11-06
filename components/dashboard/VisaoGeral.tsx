'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Package, Zap, CheckCircle, Eye, Plus, BarChart2, AlertTriangle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { LucroEscala, type ResultadoAposCustosResumo } from '@/components/dashboard/LucroEscala'
import { PrimeiraComissaoCard, type PrimeiraComissaoData } from '@/components/dashboard/PrimeiraComissao'
import { formatDateShort } from '@/lib/utils'
import type { StatusConteudo } from '@/types'
import { CentralOperacional } from '@/components/central/CentralOperacional'

interface Metricas {
  totalProdutos: number
  totalConteudos: number
  aguardandoAprovacao: number
  visualizacoesTotais: number
  topConteudos: Array<{
    id: string
    produto: { nome: string }
    redeSocial: string
    visualizacoes: number
    status: string
    createdAt: string
  }>
  comissaoTotal: number
  lucroEscala: Array<{
    produtoId: string
    nome: string
    cliques: number
    conversoes: number
    receitaTotal: number
    ticketMedio: number
    taxaConversao: number
    scoreEscala: number
    faixa: { label: string; cor: 'gold' | 'blue' | 'amber' | 'red' }
  }>
  primeiraComissao?: PrimeiraComissaoData
  resultadoAposCustos?: ResultadoAposCustosResumo | null
}

/**
 * P2.17.12 — o antigo Dashboard, agora DENTRO da Torre de Controle ("Visão
 * geral"). Mesmo conteúdo, mesma API (/api/metricas): nada se perdeu, só
 * deixou de existir uma segunda Home competindo com a Torre.
 */
export function VisaoGeral() {
  const [metricas, setMetricas] = useState<Metricas | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/metricas')
      .then((r) => r.json())
      .then((data) => {
        setMetricas(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const cards = [
    {
      label: 'Produtos Cadastrados',
      value: metricas?.totalProdutos ?? 0,
      icon: Package,
      color: 'text-blue-400',
      bg: 'bg-blue-400/10',
    },
    {
      label: 'Conteúdos Gerados',
      value: metricas?.totalConteudos ?? 0,
      icon: Zap,
      color: 'text-accent',
      bg: 'bg-accent/10',
    },
    {
      label: 'Aguardando Aprovação',
      value: metricas?.aguardandoAprovacao ?? 0,
      icon: CheckCircle,
      color: 'text-warning',
      bg: 'bg-warning/10',
      alert: (metricas?.aguardandoAprovacao ?? 0) > 0,
    },
    {
      label: 'Visualizações Totais',
      value: metricas?.visualizacoesTotais ?? 0,
      icon: Eye,
      color: 'text-purple-400',
      bg: 'bg-purple-400/10',
    },
  ]

  return (
    <div className="space-y-6 w-full">
      {/* P2.15: Command Center (só aparece com a flag CENTRAL_OPERACIONAL) */}
      <CentralOperacional />

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(({ label, value, icon: Icon, color, bg, alert }) => (
          <div key={label} className={`card-stat relative ${alert ? 'border-warning/40' : ''}`}>
            {alert && (
              <span className="absolute top-3 right-3 w-2 h-2 rounded-full bg-warning animate-pulse" />
            )}
            <div className={`inline-flex items-center justify-center w-10 h-10 rounded-lg ${bg} mb-3`}>
              <Icon className={`w-5 h-5 ${color}`} />
            </div>
            <p className="text-2xl font-bold text-white">
              {loading ? '—' : value.toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Ações rápidas */}
      <div>
        {/* P2.17.14: o fluxo principal é automático; estas são ações MANUAIS — discretas. */}
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Ações manuais
        </h2>
        <div className="flex flex-wrap gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href="/produtos/novo">
              <Plus className="w-4 h-4" />
              Novo Produto
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/conteudos/gerar">
              <Zap className="w-4 h-4" />
              Gerar manualmente
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/aprovacao">
              <CheckCircle className="w-4 h-4" />
              Ver Aprovações
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/relatorios">
              <BarChart2 className="w-4 h-4" />
              Relatórios
            </Link>
          </Button>
        </div>
      </div>

      {/* Primeira comissão */}
      {!loading && <PrimeiraComissaoCard dados={metricas?.primeiraComissao} />}

      {/* Lucro e Escala */}
      {!loading && (
        <LucroEscala
          comissaoTotal={metricas?.comissaoTotal ?? 0}
          produtos={metricas?.lucroEscala ?? []}
          resultado={metricas?.resultadoAposCustos ?? null}
        />
      )}

      {/* Top conteúdos */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Conteúdos Recentes
        </h2>
        {loading ? (
          <div className="card-stat">
            <p className="text-muted-foreground text-sm">Carregando...</p>
          </div>
        ) : (metricas?.topConteudos ?? []).length === 0 ? (
          <div className="card-stat flex flex-col items-center justify-center py-10 text-center">
            <AlertTriangle className="w-8 h-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">Nenhum conteúdo gerado ainda.</p>
            <Button asChild variant="outline" size="sm" className="mt-3">
              <Link href="/conteudos/gerar">Gerar primeiro conteúdo</Link>
            </Button>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-x-auto">
            <table className="w-full text-sm min-w-[500px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Produto</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground hidden sm:table-cell">Rede</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Status</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground hidden sm:table-cell">Views</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Data</th>
                </tr>
              </thead>
              <tbody>
                {metricas?.topConteudos.map((c) => (
                  <tr key={c.id} className="border-b border-border last:border-0 hover:bg-secondary/50 transition-colors">
                    <td className="px-4 py-3 font-medium text-white max-w-[140px] truncate">{c.produto.nome}</td>
                    <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{c.redeSocial}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={c.status as StatusConteudo} />
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground hidden sm:table-cell">{c.visualizacoes.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{formatDateShort(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
