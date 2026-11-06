'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Loader2, ShieldCheck, ArrowRight, BookOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { useGuardModulo } from '@/hooks/useGuardModulo'
import { avisarMudancaNoPrecisaDeVoce } from '@/hooks/usePrecisaDeVoce'
import { CartaoDeAprovacao, type ItemParaAprovar } from '@/components/assistido/PainelAssistido'

/**
 * P2.15 / P2.17.11 — "Precisa de você": a ÚNICA central do que depende da
 * titular (aprovação, autorização, login/MFA, documento, revisão, ação
 * externa, bloqueio da plataforma). O que o Patrono resolve sozinho não aparece.
 */

interface Pedido {
  id: string
  tipo: string
  porque: string[]
  acoes: { aprovar: string; rejeitar: string }
  link: string | null
  podeVirarRegra: boolean
  podeMarcarResolvido: boolean
  comoFazer: string[] | null
}
interface Pendencia {
  id: string
  origem: 'PEDIDO' | 'PUBLICACAO_ASSISTIDA' | 'CONTEUDO' | 'INTEGRACAO'
  categoria: string
  titulo: string
  motivo: string
  urgencia: 'ALTA' | 'MEDIA' | 'BAIXA'
  impacto: string
  acao: { rotulo: string; link: string | null }
  prazo: string | null
  pedido?: Pedido
  assistida?: ItemParaAprovar & { motivoEscolha: string; contador: string }
}

const CATEGORIA: Record<string, string> = {
  APROVACAO: 'APROVAÇÃO', AUTORIZACAO: 'AUTORIZAÇÃO', LOGIN_MFA: 'LOGIN / MFA', DOCUMENTO: 'DOCUMENTO',
  REVISAO: 'REVISÃO', ACAO_EXTERNA: 'AÇÃO EXTERNA', BLOQUEIO_DA_PLATAFORMA: 'BLOQUEIO DA PLATAFORMA',
}
const URGENCIA: Record<string, { rotulo: string; cls: string }> = {
  BAIXA: { rotulo: 'Urgência baixa', cls: 'border-accent/30 bg-accent/10 text-accent' },
  MEDIA: { rotulo: 'Urgência média', cls: 'border-warning/40 bg-warning/10 text-warning' },
  ALTA: { rotulo: 'Urgência alta', cls: 'border-danger/40 bg-danger/10 text-danger' },
}
const data = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })

export default function PrecisaDeVocePage() {
  useGuardModulo('precisa-de-voce')
  const [itens, setItens] = useState<Pendencia[] | null>(null)
  // P2.17.12: demonstrações (teste) à parte — não contam no sininho.
  const [demos, setDemos] = useState<Pendencia[]>([])
  const [desligado, setDesligado] = useState(false)
  const [erro, setErro] = useState(false)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [sempre, setSempre] = useState<Record<string, boolean>>({})
  const [abertos, setAbertos] = useState<Record<string, boolean>>({})

  const carregar = useCallback(async () => {
    try {
      const res = await fetch('/api/precisa-de-voce')
      if (res.status === 404) return setDesligado(true)
      // Erro NÃO pode parecer "nada precisa de você".
      if (!res.ok) return setErro(true)
      const dados = await res.json().catch(() => null)
      if (!dados || !Array.isArray(dados.itens)) return setErro(true)
      setErro(false)
      setItens(dados.itens)
      setDemos(Array.isArray(dados.demonstracoes) ? dados.demonstracoes : [])
    } catch {
      setErro(true)
    }
  }, [])
  useEffect(() => {
    carregar()
  }, [carregar])

  async function depois() {
    avisarMudancaNoPrecisaDeVoce()
    await carregar()
  }

  async function decidirPedido(p: Pendencia, decisao: 'APROVAR' | 'REJEITAR') {
    if (!p.pedido) return
    setOcupado(p.id)
    try {
      const res = await fetch(`/api/precisa-de-voce/${p.pedido.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decisao, sempre: decisao === 'APROVAR' && !!sempre[p.id] }),
      })
      const dados = await res.json().catch(() => ({}))
      if (res.ok) toast({ title: dados.mensagem ?? 'Feito.', variant: dados.status === 'PENDENTE' ? 'default' : 'success' })
      else toast({ title: 'Não foi possível concluir', description: dados.error, variant: 'destructive' })
      await depois()
    } catch {
      toast({ title: 'Sem conexão', description: 'Nada foi alterado. Tente de novo.', variant: 'destructive' })
    } finally {
      setOcupado(null)
    }
  }

  async function agirNaAssistida(p: Pendencia, acao: string, corpo?: unknown) {
    if (!p.assistida) return
    setOcupado(p.id)
    try {
      const headers = { 'Content-Type': 'application/json' }
      const body = JSON.stringify(corpo ?? {})
      const aid = p.assistida.id
      const res =
        acao === 'aprovar' ? await fetch(`/api/tiktok/assistido/${aid}/aprovar`, { method: 'POST', headers, body })
          : acao === 'ajuste' ? await fetch(`/api/tiktok/assistido/${aid}/ajuste`, { method: 'POST', headers, body })
            : acao === 'midia' ? await fetch('/api/midias', { method: 'POST', headers, body: JSON.stringify({ ...(corpo as object), assistidaId: aid }) })
              : await fetch(`/api/tiktok/assistido/${aid}/rejeitar`, { method: 'POST', headers, body })
      const dados = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(dados.error ?? 'Não deu certo.')
      const titulo =
        acao === 'aprovar' ? 'Aprovado'
          : acao === 'ajuste' ? 'Ajuste registrado — o Patrono gera o vídeo de novo'
            : acao === 'midia' ? (dados.midia?.status === 'AUTORIZADA' ? 'Mídia autorizada — o Patrono gerou o vídeo para você ver' : `Mídia ${String(dados.midia?.status ?? '').toLowerCase().replace('_', ' ')}: ${dados.midia?.motivo ?? ''}`)
              : p.assistida.modo === 'DEMONSTRACAO' ? 'Demonstração descartada' : 'Rejeitado — o Patrono preparou outra opção'
      toast({ title: titulo, variant: acao === 'midia' && dados.midia?.status !== 'AUTORIZADA' ? 'destructive' : 'success' })
      await depois()
    } catch (e) {
      toast({ title: 'Não deu certo', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setOcupado(null)
    }
  }

  if (desligado) {
    return (
      <div className="card-stat max-w-2xl text-sm text-muted-foreground">
        Esta área ainda não foi liberada para a sua conta. As aprovações de conteúdo continuam em{' '}
        <Link href="/aprovacao" className="underline">Aprovações</Link>.
      </div>
    )
  }
  if (erro)
    return (
      <div className="card-stat max-w-3xl flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-white">Não consegui carregar o que precisa de você. A lista pode não estar vazia.</p>
        <Button size="sm" variant="outline" onClick={carregar}>Tentar de novo</Button>
      </div>
    )
  if (!itens) return <div className="card-stat animate-pulse h-32 max-w-3xl" />

  return (
    <div className="space-y-4 max-w-3xl">
      {itens.length > 0 && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="text-2xl font-bold text-warning tabular-nums">{itens.length}</p>
          <p className="text-sm text-white">{itens.length === 1 ? 'pendência precisa de você' : 'pendências precisam de você'}</p>
          <p className="w-full text-xs text-muted-foreground">Primeiro o que pode custar dinheiro, depois prazo, o que trava publicação e o que trava integração. O resto o Patrono resolve sozinho.</p>
        </div>
      )}

      {itens.length === 0 ? (
        <div className="card-stat flex items-center gap-3">
          <ShieldCheck className="w-6 h-6 text-accent" />
          <div>
            <p className="text-sm font-semibold text-white">Nenhuma ação sua necessária.</p>
            <p className="text-xs text-muted-foreground">Quando algo depender só de você, aparece aqui e no sininho.</p>
          </div>
        </div>
      ) : (
        itens.map((p, posicao) => {
          const u = URGENCIA[p.urgencia] ?? URGENCIA.MEDIA
          const emAndamento = ocupado === p.id
          return (
            <div key={p.id} className={cn('card-stat space-y-3', posicao === 0 && itens.length > 1 && 'border-warning/40')}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-accent">{CATEGORIA[p.categoria] ?? p.categoria}</p>
                  <p className="text-sm font-semibold text-white break-words">{p.titulo}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{p.motivo}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Impacto: {p.impacto}{p.prazo ? ` · prazo ${data(p.prazo)}` : ''}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {posicao === 0 && itens.length > 1 && <span className="text-[10px] font-semibold uppercase tracking-wider text-warning">Primeiro</span>}
                  <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', u.cls)}>{u.rotulo}</span>
                </div>
              </div>

              {/* Publicação assistida: a aprovação completa acontece aqui. */}
              {p.assistida && <CartaoDeAprovacao item={p.assistida} ocupado={emAndamento} agir={(acao, corpo) => agirNaAssistida(p, acao, corpo)} />}

              {/* Pedido existente: os botões de sempre. */}
              {p.pedido && (
                <>
                  {p.pedido.porque.length > 0 && (
                    <details className="text-xs text-muted-foreground">
                      <summary className="cursor-pointer select-none hover:text-white">Por que estou pedindo</summary>
                      <ul className="mt-1 ml-4 list-disc space-y-0.5">{p.pedido.porque.map((x, i) => <li key={i}>{x}</li>)}</ul>
                    </details>
                  )}
                  {p.pedido.podeVirarRegra && (
                    <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                      <input type="checkbox" checked={!!sempre[p.id]} onChange={(e) => setSempre((s) => ({ ...s, [p.id]: e.target.checked }))} />
                      Sempre aprovar casos assim (mesma categoria, até este preço e risco)
                    </label>
                  )}
                  {p.pedido.comoFazer && abertos[p.id] && (
                    <ol className="ml-4 list-decimal space-y-1 rounded-lg border border-border bg-secondary/40 p-3 pl-7 text-xs text-white/90">
                      {p.pedido.comoFazer.map((passo, i) => <li key={i}>{passo}</li>)}
                    </ol>
                  )}
                  <div className="flex flex-wrap gap-2 pt-1 border-t border-border">
                    {p.pedido.podeMarcarResolvido ? (
                      <Button size="sm" disabled={emAndamento} onClick={() => decidirPedido(p, 'APROVAR')}>
                        {emAndamento ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                        {p.pedido.acoes.aprovar}
                      </Button>
                    ) : (
                      <Button size="sm" onClick={() => setAbertos((a) => ({ ...a, [p.id]: !a[p.id] }))} aria-expanded={!!abertos[p.id]}>
                        <BookOpen className="w-3.5 h-3.5" />
                        {abertos[p.id] ? 'Fechar passos' : p.pedido.acoes.aprovar}
                      </Button>
                    )}
                    <Button size="sm" variant="outline" disabled={emAndamento} onClick={() => decidirPedido(p, 'REJEITAR')}>{p.pedido.acoes.rejeitar}</Button>
                    {p.pedido.link && p.pedido.podeMarcarResolvido && (
                      <Button size="sm" variant="ghost" asChild>
                        <Link href={p.pedido.link}>Ver detalhes<ArrowRight className="w-3.5 h-3.5" /></Link>
                      </Button>
                    )}
                  </div>
                </>
              )}

              {/* Demais (conteúdo, integração, ações externas): leva ao contexto. */}
              {!p.pedido && !p.assistida && p.acao.link && (
                <div className="pt-1 border-t border-border">
                  <Button size="sm" asChild>
                    <Link href={p.acao.link}>{p.acao.rotulo}<ArrowRight className="w-3.5 h-3.5" /></Link>
                  </Button>
                </div>
              )}
            </div>
          )
        })
      )}

      {/* P2.17.13: um caminho só para decidir; o histórico fica aqui, discreto. */}
      <p className="text-[11px] text-muted-foreground">
        Histórico: <Link href="/publicacoes-assistidas" className="underline hover:text-white">publicações assistidas</Link> · <Link href="/aprovacao" className="underline hover:text-white">conteúdos aprovados e rejeitados</Link>
      </p>

      {/* P2.17.12: demonstração em TESTE — para assistir o fluxo; não conta no sininho. */}
      {demos.length > 0 && (
        <details className="card-stat space-y-3">
          <summary className="cursor-pointer text-xs font-semibold text-muted-foreground hover:text-white">DEMONSTRAÇÃO — NÃO CONTA — NÃO PUBLICA ({demos.length})</summary>
          {demos.map((p) => p.assistida && (
            <div key={p.id} className="space-y-2">
              <p className="text-xs text-muted-foreground">{p.motivo}</p>
              <CartaoDeAprovacao item={{ ...p.assistida, modo: 'DEMONSTRACAO' }} ocupado={ocupado === p.id} agir={(acao, corpo) => agirNaAssistida(p, acao, corpo)} />
            </div>
          ))}
        </details>
      )}
    </div>
  )
}
