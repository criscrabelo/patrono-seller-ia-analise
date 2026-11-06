'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CheckCircle, X, Clock, AlertTriangle, AlertCircle, Pencil, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PhonePreview } from '@/components/shared/PhonePreview'
import { formatDateShort, cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import type { AlertaCompliance } from '@/types'
import { useGuardModulo } from '@/hooks/useGuardModulo'

interface Conteudo {
  id: string
  status: string
  redeSocial: string
  estilo: string
  videoUrl: string | null
  roteiro: string
  legendaTiktok: string
  legendaInstagram: string
  legendaYoutube: string
  legendaWhatsapp: string
  legendaFacebook: string
  legendaMarketplace: string
  hashtags: string[]
  chamadaAcao: string
  notaProduto: number | null
  veredito: string
  alertasCompliance: AlertaCompliance[]
  createdAt: string
  produto: { nome: string }
}

export default function AprovacaoPage() {
  useGuardModulo('aprovacao')
  const [conteudos, setConteudos] = useState<Conteudo[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [confirmedRisks, setConfirmedRisks] = useState<string[]>([])
  const [editandoLegendaId, setEditandoLegendaId] = useState<string | null>(null)
  const [legendaTexto, setLegendaTexto] = useState('')
  const [salvandoLegenda, setSalvandoLegenda] = useState(false)

  const [erroAoCarregar, setErroAoCarregar] = useState(false)
  const [decidindo, setDecidindo] = useState<string | null>(null)

  async function fetchConteudos() {
    setLoading(true)
    try {
      const res = await fetch('/api/conteudos?status=aguardando_aprovacao')
      const data = await res.json().catch(() => null)
      setErroAoCarregar(!res.ok)
      setConteudos(Array.isArray(data) ? data : [])
    } catch {
      setErroAoCarregar(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchConteudos() }, [])

  async function atualizar(id: string, status: string) {
    if (decidindo) return
    setDecidindo(id)
    try {
      const res = await fetch(`/api/conteudos/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, ...(status === 'aprovado' && confirmedRisks.includes(id) && { confirmarRisco: true }) }),
      })
      const dados = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: 'Não foi possível concluir', description: dados.error ?? 'Tente de novo.', variant: 'destructive' })
        return
      }
      const labels: Record<string, string> = {
        aprovado: 'Conteúdo aprovado!',
        descartado: 'Conteúdo rejeitado.',
        roteiro_gerado: 'Conteúdo adiado.',
      }
      toast({ title: labels[status], variant: status === 'aprovado' ? 'success' : 'default' })
      fetchConteudos()
    } catch {
      toast({ title: 'Sem conexão', description: 'Nada foi alterado. Tente de novo.', variant: 'destructive' })
    } finally {
      setDecidindo(null)
    }
  }

  // Identifica qual campo de legenda está em uso (o primeiro não-vazio).
  function getCampoLegenda(c: Conteudo): string {
    if (c.legendaInstagram?.trim()) return 'legendaInstagram'
    if (c.legendaTiktok?.trim()) return 'legendaTiktok'
    if (c.legendaYoutube?.trim()) return 'legendaYoutube'
    if (c.legendaWhatsapp?.trim()) return 'legendaWhatsapp'
    if (c.legendaFacebook?.trim()) return 'legendaFacebook'
    if (c.legendaMarketplace?.trim()) return 'legendaMarketplace'
    // Default por rede social, se nenhuma estiver preenchida ainda
    const map: Record<string, string> = {
      'Instagram Reels': 'legendaInstagram',
      'TikTok': 'legendaTiktok',
      'YouTube Shorts': 'legendaYoutube',
      'WhatsApp': 'legendaWhatsapp',
      'Facebook': 'legendaFacebook',
      'Marketplace': 'legendaMarketplace',
    }
    return map[c.redeSocial] || 'legendaInstagram'
  }

  function getLegendaAtual(c: Conteudo): string {
    return (c[getCampoLegenda(c) as keyof Conteudo] as string) || ''
  }

  function iniciarEdicaoLegenda(c: Conteudo) {
    setEditandoLegendaId(c.id)
    setLegendaTexto(getLegendaAtual(c))
  }

  function cancelarEdicaoLegenda() {
    setEditandoLegendaId(null)
    setLegendaTexto('')
  }

  async function salvarLegenda(c: Conteudo) {
    setSalvandoLegenda(true)
    const campo = getCampoLegenda(c)
    const res = await fetch(`/api/conteudos/${c.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [campo]: legendaTexto }),
    })
    setSalvandoLegenda(false)
    if (!res.ok) {
      toast({ title: 'Erro ao salvar legenda', variant: 'destructive' })
      return
    }
    toast({ title: 'Legenda atualizada!', variant: 'success' })
    setEditandoLegendaId(null)
    setLegendaTexto('')
    fetchConteudos()
  }

  if (loading) return <div className="card-stat animate-pulse h-48" />

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h2 className="text-lg font-semibold text-white">Aprovações Pendentes</h2>
        <p className="text-sm text-muted-foreground">{conteudos.length} conteúdo(s) aguardando</p>
      </div>

      {erroAoCarregar ? (
        <div className="card-stat flex flex-col items-center justify-center py-12 text-center gap-3">
          <p className="text-sm text-white">Não consegui carregar as aprovações.</p>
          <Button variant="outline" onClick={fetchConteudos}>Tentar de novo</Button>
        </div>
      ) : conteudos.length === 0 ? (
        <div className="card-stat flex flex-col items-center justify-center py-16 text-center">
          <CheckCircle className="w-10 h-10 text-accent mb-3" />
          <p className="text-sm text-muted-foreground">Nenhum conteúdo aguardando aprovação.</p>
          <Button asChild variant="outline" className="mt-4">
            <Link href="/conteudos/gerar">Gerar novo conteúdo</Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {conteudos.map((c) => {
            const hasRedAlert = c.alertasCompliance?.some((a) => a.severidade === 'vermelho')
            const isConfirmed = confirmedRisks.includes(c.id)
            const canApprove = !hasRedAlert || isConfirmed

            return (
              <div key={c.id} className="card-stat">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4">
                  <div>
                    <p className="font-semibold text-white">{c.produto.nome}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {c.redeSocial} · {c.estilo} · {formatDateShort(c.createdAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 shrink-0">
                    <Button size="sm" variant="destructive" disabled={decidindo === c.id}
                      onClick={() => atualizar(c.id, 'descartado')}>
                      <X className="w-3.5 h-3.5" />Rejeitar
                    </Button>
                    <Button size="sm" variant="outline" disabled={decidindo === c.id}
                      onClick={() => atualizar(c.id, 'roteiro_gerado')}>
                      <Clock className="w-3.5 h-3.5" />Adiar
                    </Button>
                    <Button size="sm"
                      disabled={!canApprove || decidindo === c.id}
                      onClick={() => atualizar(c.id, 'aprovado')}>
                      <CheckCircle className="w-3.5 h-3.5" />Aprovar
                    </Button>
                  </div>
                </div>

                {/* Alertas */}
                {c.alertasCompliance?.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {c.alertasCompliance.map((a, i) => {
                      const colors = {
                        verde: 'border-accent/30 bg-accent/10 text-accent',
                        amarelo: 'border-warning/30 bg-warning/10 text-warning',
                        vermelho: 'border-danger/30 bg-danger/10 text-danger',
                      }
                      const Icon = a.severidade === 'vermelho' ? AlertCircle : AlertTriangle
                      return (
                        <div key={i} className={cn('flex gap-2 rounded-lg border p-2.5 text-xs', colors[a.severidade])}>
                          <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                          <span>{a.mensagem}</span>
                        </div>
                      )
                    })}
                    {hasRedAlert && !isConfirmed && (
                      <button
                        onClick={() => setConfirmedRisks((s) => [...s, c.id])}
                        className="w-full text-xs text-danger border border-danger/30 rounded-lg py-1.5
                                   hover:bg-danger/10 transition-colors">
                        ⚠️ Entendi o risco — aprovar mesmo assim
                      </button>
                    )}
                  </div>
                )}

                {/* Preview expandido */}
                <button
                  onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                  className="mt-3 text-xs text-muted-foreground hover:text-accent transition-colors">
                  {expanded === c.id ? '▲ Ocultar detalhes' : '▼ Ver roteiro e legenda'}
                </button>

                {expanded === c.id && (
                  <div className="mt-3 space-y-3 pt-3 border-t border-border">
                    <div className="flex justify-center">
                      <PhonePreview
                        videoUrl={c.videoUrl}
                        label="Vídeo ainda não gerado"
                        badge={
                          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-black/55 text-white">
                            {c.redeSocial}
                          </span>
                        }
                        w={130}
                      />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-1.5">ROTEIRO</p>
                      <div className="rounded-lg bg-background border border-border p-3 text-xs text-foreground whitespace-pre-wrap">
                        {c.roteiro}
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-xs font-semibold text-muted-foreground">LEGENDA</p>
                        {editandoLegendaId === c.id ? (
                          <div className="flex gap-1.5">
                            <button
                              onClick={cancelarEdicaoLegenda}
                              disabled={salvandoLegenda}
                              className="text-[11px] text-muted-foreground hover:text-white px-2 py-0.5 rounded transition-colors"
                            >
                              Cancelar
                            </button>
                            <button
                              onClick={() => salvarLegenda(c)}
                              disabled={salvandoLegenda}
                              className="text-[11px] text-accent hover:text-accent-light flex items-center gap-1 px-2 py-0.5 rounded transition-colors"
                            >
                              <Save className="w-3 h-3" />
                              {salvandoLegenda ? 'Salvando...' : 'Salvar'}
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => iniciarEdicaoLegenda(c)}
                            className="text-[11px] text-muted-foreground hover:text-accent flex items-center gap-1 px-2 py-0.5 rounded transition-colors"
                          >
                            <Pencil className="w-3 h-3" />Editar
                          </button>
                        )}
                      </div>
                      {editandoLegendaId === c.id ? (
                        <textarea
                          value={legendaTexto}
                          onChange={(e) => setLegendaTexto(e.target.value)}
                          rows={4}
                          className="w-full rounded-lg bg-background border border-accent/40 p-3 text-xs text-foreground
                            focus:outline-none focus:ring-1 focus:ring-accent resize-y"
                        />
                      ) : (
                        <div className="rounded-lg bg-background border border-border p-3 text-xs text-foreground whitespace-pre-wrap">
                          {getLegendaAtual(c) || '—'}
                        </div>
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-1">HASHTAGS</p>
                      <div className="flex flex-wrap gap-1">
                        {c.hashtags?.map((h) => (
                          <span key={h} className="px-2 py-0.5 rounded-full bg-secondary text-[10px] text-accent">{h}</span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        🏆 Veredito: <span className="text-white">{c.veredito}</span>
                        {typeof c.notaProduto === 'number' && c.notaProduto > 0 && <> · ⭐ Nota: <span className="text-warning">{c.notaProduto}/10</span></>}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
