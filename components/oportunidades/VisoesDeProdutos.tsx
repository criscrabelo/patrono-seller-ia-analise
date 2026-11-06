'use client'

import { useEffect, useState } from 'react'
import { ExternalLink, Loader2 } from 'lucide-react'

/**
 * P2.17.6 — Visões dos candidatos, além do Top 3: Mais vendidos | Maior
 * comissão | Melhor oportunidade | Menor preço | Melhor para Natal | Melhor
 * para TikTok (+ as demais em "Mais visões"). Cada posição diz POR QUÊ.
 */

interface Visao { id: string; rotulo: string; rapida: boolean }
interface Item {
  posicao: number
  id: string
  nome: string
  porque: string
  linkProduto: string | null
  tiktokShop: boolean
  preco: number | null
  comissaoPercentual: number | null
  comissaoValor: number | null
  vendas: number | null
  avaliacao: number | null
  dadosOficiais: { motivoCurto: string | null; alertas: string[] } | null
}
interface Painel { visoes: Visao[]; visao: string; itens: Item[]; comparacao: string | null; aviso: string | null }

const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function VisoesDeProdutos({ versao, top3 = [] }: { versao: number; top3?: string[] }) {
  const [visao, setVisao] = useState('MELHOR_OPORTUNIDADE')
  const [painel, setPainel] = useState<Painel | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)

  useEffect(() => {
    let vivo = true
    setCarregando(true)
    fetch(`/api/oportunidades/visoes?visao=${visao}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(r.status === 401 ? 'Sua sessão expirou. Entre de novo.' : d.error ?? 'Não consegui carregar as visões.')
        if (vivo) {
          setPainel(d)
          setErro(null)
        }
      })
      .catch((e) => vivo && setErro((e as Error).message))
      .finally(() => vivo && setCarregando(false))
    return () => {
      vivo = false
    }
  }, [visao, versao])

  const rapidas = painel?.visoes.filter((v) => v.rapida) ?? []
  const outras = painel?.visoes.filter((v) => !v.rapida) ?? []
  return (
    <div className="card-stat space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-base font-semibold text-white">Inteligência comercial</p>
          {/* P2.17.14: a decisão é o Top 3 acima; aqui é COMPARAÇÃO (os do Top 3 aparecem marcados). */}
          <p className="text-[11px] text-muted-foreground">Para comparar. A decisão principal é o Top 3 acima.</p>
        </div>
        {carregando && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
      </div>
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Visões dos produtos">
        {rapidas.map((v) => (
          <button
            key={v.id}
            role="tab"
            aria-selected={visao === v.id}
            onClick={() => setVisao(v.id)}
            className={`rounded-full border px-3 py-1 text-xs ${visao === v.id ? 'border-accent bg-accent/15 text-accent' : 'border-border text-muted-foreground hover:text-white'}`}
          >
            {v.rotulo}
          </button>
        ))}
        {outras.length > 0 && (
          <select
            aria-label="Mais visões"
            className="rounded-full border border-border bg-background px-3 py-1 text-xs text-white"
            value={outras.some((o) => o.id === visao) ? visao : ''}
            onChange={(e) => e.target.value && setVisao(e.target.value)}
          >
            <option value="">Mais visões…</option>
            {outras.map((v) => <option key={v.id} value={v.id}>{v.rotulo}</option>)}
          </select>
        )}
      </div>
      {erro && <p role="alert" className="text-xs text-danger">{erro}</p>}
      {painel?.aviso && <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-white">{painel.aviso}</p>}
      {painel?.comparacao && <p className="text-sm text-white">{painel.comparacao}</p>}
      {painel && (
        <ol className="divide-y divide-border rounded-lg border border-border" aria-label="Ranking">
          {/* P2.17.13: ranking compacto — uma linha por produto; o detalhe abre no clique. */}
          {painel.itens.slice(0, 10).map((i) => {
            const numeros = [
              i.preco !== null ? reais(i.preco) : null,
              i.comissaoValor !== null ? `${reais(i.comissaoValor)}/venda` : i.comissaoPercentual !== null ? `${i.comissaoPercentual}%` : null,
              i.vendas !== null ? `${i.vendas.toLocaleString('pt-BR')} vendidos` : null,
            ].filter(Boolean).join(' · ')
            return (
              <li key={i.id}>
                <details className="group px-2.5 py-2">
                  <summary className="cursor-pointer list-none flex items-baseline gap-2 text-sm">
                    <span className="text-accent font-semibold w-6 shrink-0">{i.posicao}º</span>
                    <span className="text-white truncate flex-1 min-w-0">{i.nome}</span>
                    {top3.includes(i.id) && <span className="shrink-0 rounded-full border border-accent/40 px-1.5 text-[10px] text-accent">Top 3</span>}
                    <span className="text-[11px] text-muted-foreground shrink-0">{numeros || 'dados oficiais pendentes'}</span>
                  </summary>
                  <div className="mt-1 pl-8 space-y-0.5">
                    <p className="text-xs text-muted-foreground">{i.porque}</p>
                    {i.tiktokShop && <p className="text-[11px] text-accent">TikTok Shop</p>}
                    {i.avaliacao !== null && <p className="text-[11px] text-muted-foreground">nota {i.avaliacao}</p>}
                    {!numeros && i.dadosOficiais?.motivoCurto && <p className="text-[11px] text-muted-foreground">{i.dadosOficiais.motivoCurto}</p>}
                    {i.dadosOficiais?.alertas.map((a) => <p key={a} className="text-[11px] text-warning">{a}</p>)}
                    {i.linkProduto && <a href={i.linkProduto} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-accent"><ExternalLink className="w-3 h-3" /> abrir link</a>}
                  </div>
                </details>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
