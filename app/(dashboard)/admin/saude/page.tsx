'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { HeartPulse, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** P2.28 — saúde operacional (só admin): SISTEMA SAUDÁVEL ou ATENÇÃO NECESSÁRIA, com o que fazer. */
interface Indicador { chave: string; rotulo: string; valor: number | string | null; ok: boolean; texto: string; link?: string }
interface Achado { chave: string; tipo: string; gravidade: string; desfecho: 'CORRIGIDO' | 'PRECISA_DE_VOCE' | 'ADMIN'; texto: string; correcao?: string; acao?: { rotulo: string; link: string } }
interface Saude {
  geradoEm: string
  veredito: 'SISTEMA SAUDÁVEL' | 'ATENÇÃO NECESSÁRIA'
  indicadores: Indicador[]
  agendamentos: { rotina: string; ligada: boolean; detalhe: string }[]
  reconciliacao: { em: string; achados: Achado[]; falhas: string[]; corrigiu?: boolean } | null
}
const DESFECHO: Record<Achado['desfecho'], string> = { CORRIGIDO: 'Corrigido sozinho', PRECISA_DE_VOCE: 'Precisa de você', ADMIN: 'Técnico' }
const quando = (s: string) => new Date(s).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })

export default function SaudeAdminPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [s, setS] = useState<Saude | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const travado = useRef(false)

  const carregar = () => fetch('/api/admin/saude').then(async (r) => (r.ok ? setS(await r.json()) : setErro((await r.json().catch(() => null))?.error ?? 'Não foi possível abrir.'))).catch(() => setErro('Sem conexão.'))
  useEffect(() => {
    if (status === 'loading') return
    if (!session || session.user.role !== 'admin') { router.replace('/torre'); return }
    carregar()
  }, [session, status])

  async function reconciliar(acao: 'reconciliar' | 'conferir') {
    if (travado.current) return
    travado.current = true; setOcupado(true); setMsg(null)
    const r = await fetch('/api/admin/saude', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao }) }).catch(() => null)
    const j = await r?.json().catch(() => null)
    travado.current = false; setOcupado(false)
    const texto = acao === 'conferir'
      ? `Conferência feita (nada foi alterado): ${j?.achados ?? 0} achado(s), ${j?.paraVoce ?? 0} para você decidir.`
      : `Reconciliação feita: ${j?.corrigidos} corrigido(s) sozinho, ${j?.paraVoce} para você decidir, ${j?.admin} técnico(s).`
    setMsg(r?.ok ? { ok: true, texto } : { ok: false, texto: j?.error ?? 'Não foi possível.' })
    carregar()
  }

  if (erro) return <p role="alert" className="card-stat text-sm text-danger">{erro}</p>
  if (!s) return <p className="card-stat flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Conferindo o sistema…</p>
  const saudavel = s.veredito === 'SISTEMA SAUDÁVEL'
  const achados = s.reconciliacao?.achados ?? []
  return (
    <div className="space-y-4 max-w-4xl">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-white flex items-center gap-2"><HeartPulse className="w-5 h-5" /> Saúde do sistema</h1>
        <p className="text-sm text-muted-foreground">O que está preso, falho ou incerto — e o que fazer. Conferido em {quando(s.geradoEm)}.</p>
      </header>

      <section aria-label="Veredito" className={cn('card-stat flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between', saudavel ? 'border-accent' : 'border-warning')}>
        <p className={cn('text-lg font-bold', saudavel ? 'text-accent' : 'text-warning')}>{s.veredito}</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button size="sm" variant="outline" className="min-h-[44px] sm:min-h-0" disabled={ocupado} onClick={() => reconciliar('conferir')}>CONFERIR SEM CORRIGIR</Button>
          <Button size="sm" className="min-h-[44px] sm:min-h-0" disabled={ocupado} onClick={() => reconciliar('reconciliar')}>{ocupado ? 'Reconciliando…' : 'RECONCILIAR AGORA'}</Button>
        </div>
      </section>
      {msg && <p role="status" className={cn('text-sm', msg.ok ? 'text-accent' : 'text-danger')}>{msg.texto}</p>}

      <section aria-label="Indicadores" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {s.indicadores.map((i) => (
          <div key={i.chave} className={cn('card-stat space-y-1 min-w-0', !i.ok && 'border-warning/60')}>
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{i.rotulo}</p>
              <span className={cn('text-xs font-semibold', i.ok ? 'text-accent' : 'text-warning')}>{i.ok ? 'OK' : 'ATENÇÃO'}</span>
            </div>
            <p className="text-sm text-white break-words">{i.texto}</p>
            {!i.ok && i.link && <Link href={i.link} className="text-xs text-accent hover:underline">Resolver</Link>}
          </div>
        ))}
      </section>

      <section aria-label="Rotinas agendadas" className="card-stat space-y-1 text-sm">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Rotinas agendadas</p>
        <ul className="space-y-0.5">
          {s.agendamentos.map((a) => <li key={a.rotina} className="break-words"><span className="text-white">{a.rotina}</span> · <span className={a.ligada ? 'text-accent' : 'text-muted-foreground'}>{a.ligada ? 'ligada' : 'desligada'}</span> <span className="text-[11px] text-muted-foreground">({a.detalhe})</span></li>)}
        </ul>
      </section>

      <section aria-label="Reconciliação" className="card-stat space-y-2 text-sm">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Última reconciliação {s.reconciliacao ? `· ${quando(s.reconciliacao.em)}` : ''}{s.reconciliacao?.corrigiu === false ? ' · só conferência (nada foi alterado)' : ''}</p>
        {!s.reconciliacao ? <p className="text-muted-foreground">Ainda não rodou nesta conta.</p> : achados.length === 0 ? <p className="text-accent">Nada fora do lugar.</p> : (
          <ul className="space-y-2">
            {achados.map((a) => (
              <li key={a.chave} className="min-w-0">
                <p className="text-white break-words"><span className={cn('text-[10px] uppercase mr-1', a.desfecho === 'CORRIGIDO' ? 'text-accent' : a.desfecho === 'PRECISA_DE_VOCE' ? 'text-warning' : 'text-muted-foreground')}>{DESFECHO[a.desfecho]}</span>{a.texto}</p>
                {a.correcao && <p className="text-[11px] text-muted-foreground break-words">{a.correcao}</p>}
                {a.acao && a.desfecho !== 'CORRIGIDO' && <Link href={a.acao.link} className="text-xs text-accent hover:underline">{a.acao.rotulo}</Link>}
              </li>
            ))}
          </ul>
        )}
        {s.reconciliacao?.falhas.length ? <p className="text-xs text-danger break-words">Verificações com erro: {s.reconciliacao.falhas.join(' · ')}</p> : null}
      </section>
    </div>
  )
}
