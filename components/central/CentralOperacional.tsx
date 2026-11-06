'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Bot, BellRing, CheckCircle2, AlertTriangle, XCircle, Loader2, Play, ShieldAlert, Plug, Wallet, ArrowRight, History } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { CopilotPainel } from './CopilotPainel'

type Risco = 'ALTO' | 'MEDIO' | 'BAIXO'
type EstadoIntegracao = 'OK' | 'ATENCAO' | 'PROBLEMA' | 'DESCONECTADA'

interface Painel {
  patrono: {
    bloqueado: boolean
    safeMode: boolean
    ultimoCiclo: { estado: string; quando: string; resumo: string[] } | null
    estado: { titulo: string; frase: string; nota: string; tom: 'ok' | 'pronto' | 'atencao' | 'parado' }
  }
  precisaDeVoce: { total: number; porRisco: Record<Risco, number>; principal: { titulo: string; resumo: string; risco: string } | null }
  decisoesRecentes: { id: string; quando: string; texto: string; detalhes: string[]; vezes: number }[]
  resumoIntegracoes: {
    conectadas: number
    total: number
    comProblema: number
    mensagem: string
    destaque: { plataforma: string; nome: string; estado: EstadoIntegracao; detalhe: string }[]
  }
  financeiro: { comissoes: { prevista: number; confirmada: number; recebida: number } }
  publicacoesAtrasadas: number
  proximaAcao: { texto: string; link: string | null; comando: 'rodar' | null; botao: string | null }
}

const quandoRelativo = (iso: string) => {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'agora há pouco'
  if (min < 60) return `há ${min} min`
  const h = Math.round(min / 60)
  return h < 24 ? `há ${h} h` : `em ${new Date(iso).toLocaleDateString('pt-BR')}`
}
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const TOM = {
  ok: { icone: Bot, caixa: 'bg-accent/15', cor: 'text-accent', borda: 'border-accent/30' },
  pronto: { icone: Bot, caixa: 'bg-accent/15', cor: 'text-accent', borda: 'border-border' },
  atencao: { icone: BellRing, caixa: 'bg-warning/15', cor: 'text-warning', borda: 'border-warning/40' },
  parado: { icone: ShieldAlert, caixa: 'bg-warning/15', cor: 'text-warning', borda: 'border-warning/40' },
} as const

const RISCO: Record<Risco, { rotulo: string; cls: string }> = {
  ALTO: { rotulo: 'urgente', cls: 'border-danger/40 bg-danger/10 text-danger' },
  MEDIO: { rotulo: 'risco médio', cls: 'border-warning/40 bg-warning/10 text-warning' },
  BAIXO: { rotulo: 'risco baixo', cls: 'border-accent/30 bg-accent/10 text-accent' },
}

/**
 * P2.15 — Command Center no topo da home. Some sozinho se a flag
 * CENTRAL_OPERACIONAL estiver desligada (a API responde 404).
 *
 * P2.15.1 — hierarquia para ler em 5 segundos: (1) o que o Patrono está
 * fazendo + UMA próxima ação; (2) três números: precisa de você, ganhos,
 * integrações; (3) o que ele fez, em frases simples, e a conversa.
 */
export function CentralOperacional() {
  const [painel, setPainel] = useState<Painel | null>(null)
  const [desligado, setDesligado] = useState(false)
  const [rodando, setRodando] = useState(false)

  const [erro, setErro] = useState(false)

  const carregar = useCallback(async () => {
    try {
      const res = await fetch('/api/central')
      if (res.status === 404) return setDesligado(true)
      if (res.ok) {
        setPainel(await res.json())
        setErro(false)
      } else setErro(true)
    } catch {
      setErro(true)
    }
  }, [])

  useEffect(() => {
    carregar()
  }, [carregar])

  async function rodar() {
    setRodando(true)
    try {
      const res = await fetch('/api/supervisor/ciclo', { method: 'POST' })
      const dados = await res.json().catch(() => ({}))
      if (res.ok) toast({ title: 'Análise concluída', description: (dados.resumo ?? []).join(' '), variant: 'success' })
      else toast({ title: 'Não consegui analisar agora', description: dados.error, variant: 'destructive' })
      await carregar()
    } catch {
      toast({ title: 'Sem conexão', description: 'A análise não foi feita. Tente de novo.', variant: 'destructive' })
    } finally {
      setRodando(false)
    }
  }

  if (desligado) return null
  if (!painel && erro)
    return (
      <div className="card-stat flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-white">Não consegui carregar a Central agora.</p>
        <Button size="sm" variant="outline" onClick={carregar}>Tentar de novo</Button>
      </div>
    )
  if (!painel) return <div className="card-stat animate-pulse h-40" />

  const { patrono, proximaAcao: acao, precisaDeVoce: pv, resumoIntegracoes: ri } = painel
  const tom = TOM[patrono.estado.tom]
  const IconeTom = tom.icone
  const c = painel.financeiro.comissoes
  const riscoPrincipal = pv.principal ? RISCO[pv.principal.risco as Risco] ?? RISCO.BAIXO : null

  const botaoRodar = (principal: boolean) => (
    <Button size={principal ? 'lg' : 'sm'} variant={principal ? 'default' : 'ghost'} onClick={rodar} disabled={rodando} className={cn(principal && 'w-full sm:w-auto font-semibold')}>
      {rodando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
      {rodando ? 'Analisando…' : 'Rodar agora'}
    </Button>
  )

  return (
    <div className="space-y-4">
      {/* 1. O que o Patrono está fazendo + a UMA próxima ação */}
      <div className={cn('card-stat grid gap-4 md:grid-cols-[1fr_minmax(260px,340px)] md:items-center', tom.borda)}>
        <div className="flex items-start gap-3 min-w-0">
          <div className={cn('w-11 h-11 rounded-xl flex items-center justify-center shrink-0', tom.caixa)}>
            <IconeTom className={cn('w-5 h-5', tom.cor)} />
          </div>
          <div className="space-y-1 min-w-0">
            <p className="text-base font-semibold text-white leading-tight">{patrono.estado.titulo}</p>
            <p className="text-sm text-white/80">{patrono.estado.frase}</p>
            {patrono.estado.nota && <p className="text-xs text-muted-foreground">{patrono.estado.nota}</p>}
            <p className="text-xs text-muted-foreground">
              {patrono.ultimoCiclo ? `Última análise ${quandoRelativo(patrono.ultimoCiclo.quando)}.` : 'Ainda não fiz nenhuma análise.'}
            </p>
            {painel.publicacoesAtrasadas > 0 && (
              <Link href="/conteudos" className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-xs text-warning hover:bg-warning/20">
                <AlertTriangle className="w-3.5 h-3.5" />
                {painel.publicacoesAtrasadas === 1 ? '1 publicação atrasada: a data passou e nada saiu.' : `${painel.publicacoesAtrasadas} publicações atrasadas: a data passou e nada saiu.`}
              </Link>
            )}
          </div>
        </div>

        <div className={cn('rounded-xl border p-3 space-y-2', acao.link === '/precisa-de-voce' ? 'border-warning/40 bg-warning/5' : 'border-accent/30 bg-accent/5')}>
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Próximo passo</p>
          <p className="text-sm text-white font-medium">{acao.texto}</p>
          {acao.comando === 'rodar' ? (
            botaoRodar(true)
          ) : acao.link && acao.botao ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="lg" asChild className="w-full sm:w-auto font-semibold">
                <Link href={acao.link}>{acao.botao}<ArrowRight className="w-4 h-4" /></Link>
              </Button>
              {botaoRodar(false)}
            </div>
          ) : (
            botaoRodar(false)
          )}
        </div>
      </div>

      {/* 2. Três números: precisa de você · ganhos · integrações */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Link
          href="/precisa-de-voce"
          className={cn('card-stat flex flex-col gap-2 hover:border-accent/40 transition-colors', pv.total > 0 && 'border-warning/40')}
        >
          <div className="flex items-center gap-2">
            <BellRing className={cn('w-4 h-4', pv.total > 0 ? 'text-warning' : 'text-muted-foreground')} />
            <p className="text-sm font-semibold text-white flex-1">Precisa de você</p>
            <ArrowRight className="w-4 h-4 text-muted-foreground" />
          </div>
          {pv.total === 0 ? (
            <>
              <p className="text-2xl font-bold text-white tabular-nums">0</p>
              <p className="text-xs text-muted-foreground">Nada agora — o Patrono segue sozinho.</p>
            </>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <p className="text-2xl font-bold text-warning tabular-nums">{pv.total}</p>
                <p className="text-xs text-muted-foreground">{pv.total === 1 ? 'item precisa de você' : 'itens precisam de você'}</p>
                {riscoPrincipal && <span className={cn('ml-auto rounded-full border px-2 py-0.5 text-[10px] font-medium', riscoPrincipal.cls)}>{riscoPrincipal.rotulo}</span>}
              </div>
              {pv.principal && <p className="text-xs text-white/80 line-clamp-2">Primeiro: {pv.principal.titulo}</p>}
            </>
          )}
        </Link>

        <Link href="/vendas-comissoes" className="card-stat flex flex-col gap-2 hover:border-accent/40 transition-colors">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-accent" />
            <p className="text-sm font-semibold text-white flex-1">Ganhos</p>
            <ArrowRight className="w-4 h-4 text-muted-foreground" />
          </div>
          <p className="text-2xl font-bold text-white tabular-nums">{brl(c.recebida)}</p>
          <p className="text-xs text-muted-foreground">
            {c.recebida + c.confirmada + c.prevista === 0
              ? 'Nenhuma comissão ainda. Aparece aqui quando a primeira venda entrar.'
              : `Recebido. A receber: ${brl(c.confirmada)} · previsto: ${brl(c.prevista)}`}
          </p>
        </Link>

        <Link href="/integracoes" className={cn('card-stat flex flex-col gap-2 hover:border-accent/40 transition-colors', ri.comProblema > 0 && 'border-danger/40')}>
          <div className="flex items-center gap-2">
            <Plug className={cn('w-4 h-4', ri.comProblema > 0 ? 'text-danger' : 'text-muted-foreground')} />
            <p className="text-sm font-semibold text-white flex-1">Integrações</p>
            <ArrowRight className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="flex items-baseline gap-2">
            <p className="text-2xl font-bold text-white tabular-nums">{ri.conectadas}</p>
            <p className="text-xs text-muted-foreground">de {ri.total} canais conectados</p>
          </div>
          <p className={cn('text-xs', ri.comProblema > 0 ? 'text-danger' : 'text-muted-foreground')}>{ri.mensagem}</p>
          {ri.destaque.slice(0, 3).map((i) => (
            <p key={i.plataforma} className="text-xs flex items-center gap-1 min-w-0">
              {i.estado === 'OK' ? <CheckCircle2 className="w-3 h-3 text-accent shrink-0" /> : i.estado === 'ATENCAO' ? <AlertTriangle className="w-3 h-3 text-warning shrink-0" /> : <XCircle className="w-3 h-3 text-danger shrink-0" />}
              <span className="text-white">{i.nome}</span>
              <span className="text-muted-foreground truncate">— {i.detalhe}</span>
            </p>
          ))}
        </Link>
      </div>

      {/* 3. O que o Patrono fez + conversa */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card-stat space-y-3">
          <p className="text-sm font-semibold text-white flex items-center gap-2"><History className="w-4 h-4 text-muted-foreground" />O que eu fiz por último</p>
          {painel.decisoesRecentes.length === 0 ? (
            <p className="text-xs text-muted-foreground">Ainda não fiz nenhuma análise. Use “Rodar agora”.</p>
          ) : (
            <ul className="space-y-3">
              {painel.decisoesRecentes.map((d) => (
                <li key={d.id} className="text-xs space-y-0.5">
                  <p className="text-white">
                    {d.texto}
                    <span className="text-muted-foreground"> · {quandoRelativo(d.quando)}{d.vezes > 1 ? ` · ${d.vezes} vezes` : ''}</span>
                  </p>
                  {d.detalhes.map((x, i) => <p key={i} className="text-muted-foreground">{x}</p>)}
                </li>
              ))}
            </ul>
          )}
        </div>

        <CopilotPainel aoAlterar={carregar} />
      </div>
    </div>
  )
}
