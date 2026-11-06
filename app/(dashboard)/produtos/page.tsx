'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus, Package, ExternalLink, Zap, Trash2, Search, RefreshCw, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CATEGORIAS } from '@/types'
import { toast } from '@/hooks/use-toast'
import { useGuardModulo } from '@/hooks/useGuardModulo'
import { reaisOuNull } from '@/components/shared/Ux'

interface Produto {
  id: string
  nome: string
  categoria: string
  preco: number | null
  tipoVenda: string
  origemConteudo?: string
  providerId?: string | null
  imagens: string[]
  createdAt: string
  _count: { conteudos: number }
}

const ORIGEM: Record<string, string> = { 'tiktok-shop': 'TikTok Shop', shopee: 'Shopee', 'mercado-livre': 'Mercado Livre', 'amazon-associados': 'Amazon' }
/** P2.17.13: TESTANDO | PROMISSOR | ESCALAR | PAUSAR | ENCERRADO (a régua do modo assistido). */
const COR_STATUS: Record<string, string> = {
  TESTANDO: 'border-blue-400/40 text-blue-300', PROMISSOR: 'border-accent/40 text-accent', ESCALAR: 'border-accent bg-accent/15 text-accent',
  PAUSAR: 'border-warning/40 text-warning', ENCERRADO: 'border-border text-muted-foreground',
}

export default function ProdutosPage() {
  useGuardModulo('produtos')
  const [produtos, setProdutos] = useState<Produto[]>([])
  // P2.17.13: status econômico, vendas/comissão reais e mídia autorizada por produto.
  const [extra, setExtra] = useState<Record<string, { statusEconomico: string | null; vendas: number | null; comissao: number | null; midiasAutorizadas: number }>>({})
  useEffect(() => {
    fetch('/api/resumos/produtos').then(async (r) => r.ok && setExtra(await r.json())).catch(() => null)
  }, [])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [categoria, setCategoria] = useState('')
  // P2.18.11: excluídos ficam fora de tudo, mas podem ser vistos e restaurados aqui.
  const [excluidos, setExcluidos] = useState(false)

  async function fetchProdutos() {
    setLoading(true)
    setErro(null)
    try {
      const params = new URLSearchParams()
      if (busca) params.set('busca', busca)
      if (categoria) params.set('categoria', categoria)
      if (excluidos) params.set('excluidos', '1')
      const res = await fetch(`/api/produtos?${params}`)
      const data = await res.json()
      if (!res.ok) {
        setErro(data?.error || `Erro ${res.status} ao carregar produtos`)
        setProdutos([])
      } else {
        setProdutos(Array.isArray(data) ? data : [])
      }
    } catch {
      setErro('Falha de conexão. Verifique sua internet e tente novamente.')
      setProdutos([])
    } finally {
      setLoading(false)
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchProdutos() }, [busca, categoria, excluidos])

  async function deletar(id: string) {
    if (!confirm('Excluir este produto? Ele sai de Operação, Oportunidades, Torre e Precisa de você. O histórico fica, e dá para restaurar em "Excluídos".')) return
    const res = await fetch(`/api/produtos/${id}`, { method: 'DELETE' }).catch(() => null)
    if (!res?.ok) {
      toast({ title: 'Não consegui arquivar', description: 'Nada foi alterado. Tente de novo.', variant: 'destructive' })
      return
    }
    toast({ title: 'Produto excluído', description: 'Saiu de todas as áreas ativas.', variant: 'success' })
    fetchProdutos()
  }

  async function restaurar(id: string) {
    const res = await fetch(`/api/produtos/${id}/restaurar`, { method: 'POST' }).catch(() => null)
    if (!res?.ok) {
      toast({ title: 'Não consegui restaurar', description: 'Nada foi alterado. Tente de novo.', variant: 'destructive' })
      return
    }
    toast({ title: 'Produto restaurado', description: 'Voltou a ser elegível em todas as áreas.', variant: 'success' })
    fetchProdutos()
  }

  return (
    <div className="space-y-4 w-full max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-white">Produtos</h2>
          <p className="text-sm text-muted-foreground">{produtos.length} produto(s) {excluidos ? 'excluído(s)' : 'cadastrado(s)'}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/produtos/imagens" className="self-center text-xs text-muted-foreground hover:text-white" title="Contingência: importar imagem manualmente">Importar imagens (contingência)</Link>
          <Button variant="outline" size="sm" onClick={fetchProdutos} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button asChild>
            <Link href="/produtos/novo">
              <Plus className="w-4 h-4" />
              Novo Produto
            </Link>
          </Button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-background
                       text-white placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
        <select
          value={categoria}
          onChange={(e) => setCategoria(e.target.value)}
          className="px-3 py-2 text-sm rounded-lg border border-border bg-background text-white
                     focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <option value="">Todas as categorias</option>
          {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <Button variant={excluidos ? 'default' : 'outline'} size="sm" className="self-center" onClick={() => setExcluidos((v) => !v)}>
          {excluidos ? 'Ver ativos' : 'Excluídos'}
        </Button>
      </div>

      {/* Erro de carregamento */}
      {erro && (
        <div className="flex items-start gap-3 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3">
          <AlertCircle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-danger font-medium">Erro ao carregar produtos</p>
            <p className="text-xs text-danger/80 mt-0.5">{erro}</p>
          </div>
          <button
            onClick={fetchProdutos}
            className="flex items-center gap-1.5 text-xs text-white/60 hover:text-white border border-border rounded-md px-2 py-1 transition-colors"
          >
            <RefreshCw className="w-3 h-3" /> Tentar novamente
          </button>
        </div>
      )}

      {/* Grid de produtos */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="card-stat animate-pulse h-48" />
          ))}
        </div>
      ) : produtos.length === 0 ? (
        <div className="card-stat flex flex-col items-center justify-center py-16 text-center">
          <Package className="w-10 h-10 text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground mb-4">{excluidos ? 'Nenhum produto excluído.' : 'Nenhum produto cadastrado ainda.'}</p>
          <Button asChild>
            <Link href="/produtos/novo"><Plus className="w-4 h-4" />Cadastrar primeiro produto</Link>
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {produtos.map((p) => (
            <div key={p.id} className="card-stat flex flex-col gap-3">
              {/* Imagem */}
              <div className="w-full h-32 rounded-lg bg-secondary flex items-center justify-center overflow-hidden">
                {p.imagens[0] ? (
                  <img src={p.imagens[0]} alt={p.nome} className="w-full h-full object-cover" />
                ) : (
                  <Package className="w-8 h-8 text-muted-foreground" />
                )}
              </div>

              {/* Info */}
              <div className="flex-1">
                <p className="font-semibold text-white text-sm line-clamp-1">{p.nome}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {p.categoria} · {ORIGEM[p.providerId ?? ''] ?? p.origemConteudo ?? p.tipoVenda}
                </p>
                {(() => {
                  const e = extra[p.id]
                  const st = e?.statusEconomico ?? 'TESTANDO'
                  const numeros = [p.preco !== null ? reaisOuNull(p.preco) : null, e?.comissao != null ? `comissão ${reaisOuNull(e.comissao)}` : null, e?.vendas != null ? `${e.vendas} venda(s)` : null].filter(Boolean)
                  return (
                    <div className="mt-2 space-y-1">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${COR_STATUS[st] ?? COR_STATUS.TESTANDO}`}>{st}</span>
                      {/* P2.17.14: selo compacto de mídia; preço/comissão só quando existem. */}
                      {!e?.midiasAutorizadas && <span className="ml-1 rounded-full border border-warning/40 px-2 py-0.5 text-[10px] text-warning">sem mídia autorizada</span>}
                      {numeros.length > 0 && <p className="text-xs text-white">{numeros.join(' · ')}</p>}
                      <p className="text-[11px] text-muted-foreground">
                        {e?.midiasAutorizadas ? `${e.midiasAutorizadas} mídia(s) autorizada(s) · ` : ''}{p._count.conteudos} conteúdo(s)
                      </p>
                    </div>
                  )
                })()}
              </div>

              {/* Ações */}
              {excluidos ? (
                <div className="flex gap-2 pt-2 border-t border-border">
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => restaurar(p.id)}><RefreshCw className="w-3.5 h-3.5" />RESTAURAR</Button>
                </div>
              ) : (
              <div className="flex gap-2 pt-2 border-t border-border">
                <Button asChild size="sm" variant="outline" className="flex-1">
                  <Link href={`/produtos/${p.id}/editar`}><ExternalLink className="w-3.5 h-3.5" />Mídia</Link>
                </Button>
                <Button asChild size="sm" variant="ghost" className="flex-1" title="Modo avançado: o Patrono já gera sozinho">
                  <Link href={`/conteudos/gerar?produtoId=${p.id}`}><Zap className="w-3.5 h-3.5" />Gerar manual</Link>
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => deletar(p.id)}
                  className="w-9 p-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
