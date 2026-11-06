'use client'

import { useEffect, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Activity, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** P2.22 — processador de eventos (auditoria, só admin): o que o Patrono percebeu e como reagiu. */
interface Problema { id: string; tipo: string; entidadeTipo: string | null; entidadeId: string | null; estadoProcessamento: string; tentativas: number; ultimaTentativaEm: string | null; proximaTentativaEm: string | null; erroProcessamento: string | null; ocorridoEm: string; travado: boolean }
interface Painel {
  tipos: string[]; ativo: boolean
  corte: { em: string; ignorados: number; detalhe: { porTipo?: Record<string, number>; motivo?: string } } | null
  contagem: Record<string, number>
  ultimaExecucao: { em: string; tipo: string; processados: number; falhas: number; retries: number; ignorados: number } | null
  execucoes: { em: string; tipo: string; processados: number; falhas: number; retries: number; ignorados: number }[]
  problemas: Problema[]
}
const ROTULO: Record<string, string> = { pendentes: 'Pendentes', processando: 'Processando', processados: 'Processados', emRetry: 'Em retry', falhos: 'Falhos', ignoradosLoop: 'Ignorados (ciclo)', ignoradosAntesDoCorte: 'Antes do corte' }
const quando = (s: string | null) => (s ? new Date(s).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—')

export default function EventosAdminPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [p, setP] = useState<Painel | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const travado = useRef(false)

  const carregar = () => fetch('/api/admin/eventos').then(async (r) => (r.ok ? setP(await r.json()) : setErro((await r.json().catch(() => null))?.error ?? 'Não foi possível abrir.'))).catch(() => setErro('Sem conexão.'))
  useEffect(() => {
    if (status === 'loading') return
    if (!session || session.user.role !== 'admin') { router.replace('/torre'); return }
    carregar()
  }, [session, status])

  async function agir(corpo: Record<string, string>, ok: (j: Record<string, unknown>) => string) {
    if (travado.current) return
    travado.current = true; setOcupado(true); setMsg(null)
    const r = await fetch('/api/admin/eventos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) }).catch(() => null)
    const j = await r?.json().catch(() => null)
    travado.current = false; setOcupado(false)
    setMsg(r?.ok ? { ok: true, texto: ok(j) } : { ok: false, texto: j?.error ?? 'Não foi possível.' })
    carregar()
  }

  if (erro) return <p role="alert" className="card-stat text-sm text-danger">{erro}</p>
  if (!p) return <p className="card-stat flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Abrindo o processador…</p>
  return (
    <div className="space-y-4 max-w-4xl">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-white flex items-center gap-2"><Activity className="w-5 h-5" /> Processador de eventos</h1>
        <p className="text-sm text-muted-foreground">O que mudou e como o Patrono reagiu (só reações internas: nada é publicado, pedido, enviado ou cobrado). Reage a: {p.tipos.join(', ')}.</p>
      </header>

      <section aria-label="Situação" className="card-stat space-y-2 text-sm">
        {!p.ativo ? (
          <>
            <p className="text-white">Processador ainda não ativado nesta conta.</p>
            <p className="text-xs text-muted-foreground">Ao ativar, os eventos anteriores ficam registrados como &quot;antes do corte&quot; (com contagem e motivo) e não disparam reações velhas.</p>
            <Button className="min-h-[44px]" disabled={ocupado} onClick={() => agir({ acao: 'ativar' }, (j) => `Ativado. ${j.ignorados} evento(s) antigo(s) registrados como antes do corte.`)}>ATIVAR PROCESSADOR</Button>
          </>
        ) : (
          <>
            <p className="text-white">Ativo desde {quando(p.corte!.em)} · {p.corte!.ignorados} evento(s) anterior(es) não reprocessado(s){p.corte!.detalhe.porTipo && Object.keys(p.corte!.detalhe.porTipo).length ? ` (${Object.entries(p.corte!.detalhe.porTipo).map(([t, n]) => `${t}: ${n}`).join(', ')})` : ''}.</p>
            <p className="text-xs text-muted-foreground">{p.corte!.detalhe.motivo}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {Object.entries(p.contagem).map(([k, v]) => (
                <div key={k} className="rounded border border-border p-2"><p className="text-xs text-muted-foreground">{ROTULO[k] ?? k}</p><p className={`text-lg font-semibold ${k === 'falhos' && v ? 'text-danger' : 'text-white'}`}>{v}</p></div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Última execução: {p.ultimaExecucao ? `${quando(p.ultimaExecucao.em)} · ${p.ultimaExecucao.processados} processado(s), ${p.ultimaExecucao.retries} retry, ${p.ultimaExecucao.falhas} falha(s), ${p.ultimaExecucao.ignorados} ignorado(s)` : 'nenhuma ainda'}</p>
            <Button className="min-h-[44px]" variant="outline" disabled={ocupado} onClick={() => agir({ acao: 'processar' }, (j) => `${j.processados} processado(s), ${j.retries} em retry, ${j.falhas} falha(s), ${j.ignorados} ignorado(s).`)}>{ocupado && <Loader2 className="w-4 h-4 animate-spin" />}PROCESSAR AGORA</Button>
          </>
        )}
        {msg && <p role={msg.ok ? 'status' : 'alert'} className={`text-xs ${msg.ok ? 'text-emerald-300' : 'text-danger'}`}>{msg.texto}</p>}
      </section>

      {p.ativo && (
        <section aria-label="Falhas e retries" className="card-stat space-y-2 text-xs">
          <h2 className="text-sm font-semibold text-white">Falhas, retries e ciclos</h2>
          {p.problemas.length === 0 ? <p className="text-muted-foreground">Nenhum.</p> : p.problemas.map((x) => (
            <article key={x.id} className="rounded border border-border p-2 space-y-1 break-words">
              <p className="text-white"><b>{x.estadoProcessamento}{x.travado ? ' (lease vencido: será retomado)' : ''}</b> · {x.tipo} · {x.entidadeTipo ?? ''} {x.entidadeId ?? ''}</p>
              <p className="text-muted-foreground">Ocorreu {quando(x.ocorridoEm)} · {x.tentativas} tentativa(s) · última {quando(x.ultimaTentativaEm)}{x.proximaTentativaEm ? ` · próxima ${quando(x.proximaTentativaEm)}` : ''}</p>
              {x.erroProcessamento && <p className="text-danger">{x.erroProcessamento}</p>}
              {x.estadoProcessamento === 'FALHOU' && <Button size="sm" variant="outline" className="min-h-[44px]" disabled={ocupado} onClick={() => agir({ acao: 'reprocessar', eventoId: x.id }, () => 'Evento volta para a fila.')}>TENTAR DE NOVO</Button>}
            </article>
          ))}
        </section>
      )}
    </div>
  )
}
