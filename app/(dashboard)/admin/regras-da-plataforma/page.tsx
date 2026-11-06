'use client'

import { useEffect, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Loader2, Scale } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * P2.20 — Revisão das regras da plataforma (auditoria, só admin). Não é tela do dia a dia: a Operação
 * mostra só a linha da quota. Nada aqui decide — a decisão é do motor (avaliarPermissaoDaAcao).
 */
interface Regra {
  id: string; plataforma: string; programa: string | null; escopo: string; regiao: string; regra: string; descricao: string
  limite: unknown; unidade: string | null; fonte: string; referencia: string | null; verificadaEm: string | null; revisarEm: string | null
  expiraEm: string | null; vigenciaInicio: string | null; confianca: string; statusAgora: string; rotulo: string; efeito: string; observacao?: string
}
interface Estado {
  plataforma: string; conta: string; programa: string; participacao: string; regiao: string; statusDaConta: string; elegibilidade: string
  regraDaQuota: string | null; quotaDiaria: number | null; origem: string; dataDaFonte: string | null; verificadaEm: string | null; confianca: string
  observacoes: string | null; revisarEm: string | null; expiraEm: string | null; atualizadoEm: string | null
}
interface Dados {
  regras: Regra[]; estados: Estado[]
  quota: { resultado: string; motivo: string; limite: number | null; usadoHoje: number; quotaRestante: number | null; fonte: string | null; avisos: string[] }
  eventos: { tipo: string; entidadeId: string | null; ocorridoEm: string }[]
}

const COR: Record<string, string> = {
  CONFIRMADO: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  'CONFIRMADO NO APP': 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  'NÃO CONFIRMADO': 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  'EM REVISÃO': 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  'AINDA NÃO VIGENTE': 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  EXPIRADO: 'bg-red-500/15 text-red-300 border-red-500/30',
}
const dataBr = (s: string | null) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '—')
const VAZIO = { plataforma: 'TIKTOK_SHOP', programa: 'PROGRAMA_PILOTO_VIDEOS_COMPRAVEIS', conta: '', participacao: 'UNKNOWN', regiao: 'UNKNOWN', statusDaConta: 'UNKNOWN', elegibilidade: 'UNKNOWN', regraDaQuota: 'VIDEOS_COMPRAVEIS_POR_DIA', quotaDiaria: '', origem: 'UNKNOWN', dataDaFonte: '', observacoes: '' }

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return <label className="block text-xs text-muted-foreground space-y-1"><span>{rotulo}</span>{children}</label>
}

export default function RegrasDaPlataformaPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [dados, setDados] = useState<Dados | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [f, setF] = useState(VAZIO)
  const [salvando, setSalvando] = useState(false)
  const [mensagem, setMensagem] = useState<{ ok: boolean; texto: string } | null>(null)
  // Duplo clique: o segundo chega antes do botão desabilitar — a trava é síncrona.
  const enviando = useRef(false)

  const carregar = () => fetch('/api/admin/regras-da-plataforma').then(async (r) => (r.ok ? setDados(await r.json()) : setErro((await r.json().catch(() => null))?.error ?? 'Não foi possível abrir.'))).catch(() => setErro('Sem conexão.'))
  useEffect(() => {
    if (status === 'loading') return
    if (!session || session.user.role !== 'admin') { router.replace('/torre'); return }
    carregar()
  }, [session, status])

  async function salvar() {
    if (enviando.current) return
    enviando.current = true
    setSalvando(true); setMensagem(null)
    const r = await fetch('/api/admin/regras-da-plataforma', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...f, conta: f.conta || undefined, quotaDiaria: f.quotaDiaria.trim() === '' ? null : Number(f.quotaDiaria), regraDaQuota: f.regraDaQuota || null, dataDaFonte: f.dataDaFonte || null, observacoes: f.observacoes || null }),
    }).catch(() => null)
    const j = await r?.json().catch(() => null)
    setSalvando(false)
    enviando.current = false
    if (!r?.ok) { setMensagem({ ok: false, texto: j?.error ?? 'Não foi possível salvar.' }); return }
    setMensagem({ ok: true, texto: `Estado salvo. Quota de hoje: ${j.recalculo.hoje.motivo}` })
    carregar()
  }

  if (erro) return <p role="alert" className="card-stat text-sm text-danger">{erro}</p>
  if (!dados) return <p className="card-stat flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Abrindo as regras…</p>
  const programas = [...new Set(dados.regras.map((r) => r.programa).filter((x): x is string => !!x))]
  const regrasDeQuota = [...new Set(dados.regras.filter((r) => typeof r.limite === 'number' && r.unidade?.includes('por dia')).map((r) => r.regra))]
  const sel = (k: keyof typeof VAZIO, opcoes: string[]) => (
    <select className="input w-full" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>{opcoes.map((o) => <option key={o} value={o}>{o}</option>)}</select>
  )

  return (
    <div className="space-y-4 max-w-4xl">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-white flex items-center gap-2"><Scale className="w-5 h-5" /> Regras da plataforma</h1>
        <p className="text-sm text-muted-foreground">Auditoria. Só regra CONFIRMADA (fonte oficial) ou CONFIRMADA NO APP (para esta conta) pode bloquear. Regra de um programa só vale para quem está nele.</p>
      </header>

      <section aria-label="Quota de hoje" className="card-stat text-sm space-y-1">
        <p className="text-white">Publicações promocionais hoje: {dados.quota.usadoHoje}{dados.quota.limite != null ? `/${dados.quota.limite}` : ''} · <b>{dados.quota.resultado}</b></p>
        <p className="text-muted-foreground">{dados.quota.motivo}</p>
        {dados.quota.avisos.map((a) => <p key={a} className="text-xs text-muted-foreground">{a}</p>)}
      </section>

      <section aria-label="Regras" className="space-y-2">
        {dados.regras.map((r) => (
          <article key={r.id} className="card-stat text-xs space-y-1 break-words">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded border px-2 py-0.5 font-semibold ${COR[r.rotulo] ?? ''}`}>{r.rotulo}</span>
              <span className="text-white font-medium">{r.regra}</span>
            </div>
            <p className="text-white/85">{r.descricao}</p>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 text-muted-foreground">
              <div><dt className="inline">Plataforma: </dt><dd className="inline">{r.plataforma}</dd></div>
              <div><dt className="inline">Programa: </dt><dd className="inline">{r.programa ?? '— (plataforma inteira)'} · {r.escopo}</dd></div>
              <div><dt className="inline">Região: </dt><dd className="inline">{r.regiao}</dd></div>
              <div><dt className="inline">Limite: </dt><dd className="inline">{r.limite == null ? '—' : `${Array.isArray(r.limite) ? r.limite.join(', ') : String(r.limite)} ${r.unidade ?? ''}`}</dd></div>
              <div><dt className="inline">Fonte: </dt><dd className="inline">{r.fonte}{r.referencia ? ` (${r.referencia})` : ''}</dd></div>
              <div><dt className="inline">Confiança: </dt><dd className="inline">{r.confianca}</dd></div>
              <div><dt className="inline">Verificada em: </dt><dd className="inline">{dataBr(r.verificadaEm)}</dd></div>
              <div><dt className="inline">Revisar em: </dt><dd className="inline">{dataBr(r.revisarEm)}{r.expiraEm ? ` · expira ${dataBr(r.expiraEm)}` : ''}{r.vigenciaInicio ? ` · vigência ${dataBr(r.vigenciaInicio)}` : ''}</dd></div>
            </dl>
            <p className="text-white/85"><b>Efeito nesta conta:</b> {r.efeito}</p>
          </article>
        ))}
      </section>

      <section aria-label="Estado da conta" className="card-stat space-y-3">
        <h2 className="text-sm font-semibold text-white">Estado da conta (o que você viu)</h2>
        {dados.estados.length === 0 && <p className="text-xs text-muted-foreground">Nada registrado: tudo é UNKNOWN (desconhecido). Nada é bloqueado por suposição.</p>}
        {dados.estados.map((e) => (
          <p key={`${e.plataforma}:${e.programa}`} className="text-xs text-muted-foreground break-words">
            <span className="text-white">{e.programa}</span> · {e.participacao} · região {e.regiao} · conta {e.statusDaConta} · elegibilidade {e.elegibilidade} · quota {e.quotaDiaria ?? 'UNKNOWN'}{e.regraDaQuota ? ` (${e.regraDaQuota})` : ''} · origem {e.origem} · conferido {dataBr(e.verificadaEm)} · confiança {e.confianca}{e.observacoes ? ` · ${e.observacoes}` : ''}
          </p>
        ))}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Campo rotulo="Plataforma">{sel('plataforma', ['TIKTOK_SHOP', 'TIKTOK'])}</Campo>
          <Campo rotulo="Programa">{sel('programa', programas)}</Campo>
          <Campo rotulo="A conta participa?">{sel('participacao', ['UNKNOWN', 'PARTICIPA', 'NAO_PARTICIPA'])}</Campo>
          <Campo rotulo="Região">{sel('regiao', ['UNKNOWN', 'BR', 'GLOBAL'])}</Campo>
          <Campo rotulo="Status da conta">{sel('statusDaConta', ['UNKNOWN', 'ATIVA', 'RESTRITA', 'SUSPENSA'])}</Campo>
          <Campo rotulo="Elegibilidade">{sel('elegibilidade', ['UNKNOWN', 'ELEGIVEL', 'NAO_ELEGIVEL'])}</Campo>
          <Campo rotulo="Regra da quota">{sel('regraDaQuota', ['', ...regrasDeQuota])}</Campo>
          <Campo rotulo="Quota diária vista (vazio = UNKNOWN)"><input inputMode="numeric" className="input w-full" value={f.quotaDiaria} onChange={(e) => setF({ ...f, quotaDiaria: e.target.value.replace(/\D/g, '') })} /></Campo>
          <Campo rotulo="De onde veio">{sel('origem', ['UNKNOWN', 'TELA_DO_APP', 'FONTE_OFICIAL', 'SUPORTE_TIKTOK'])}</Campo>
          <Campo rotulo="Data da fonte"><input type="date" className="input w-full" value={f.dataDaFonte} onChange={(e) => setF({ ...f, dataDaFonte: e.target.value })} /></Campo>
          <Campo rotulo="Conta (ex.: @usuario)"><input className="input w-full" value={f.conta} onChange={(e) => setF({ ...f, conta: e.target.value })} /></Campo>
          <Campo rotulo="Observações"><input className="input w-full" value={f.observacoes} onChange={(e) => setF({ ...f, observacoes: e.target.value })} /></Campo>
        </div>
        <Button className="min-h-[44px] w-full sm:w-auto" disabled={salvando} onClick={salvar}>{salvando && <Loader2 className="w-4 h-4 animate-spin" />}SALVAR ESTADO DA CONTA</Button>
        {mensagem && <p role={mensagem.ok ? 'status' : 'alert'} className={`text-xs ${mensagem.ok ? 'text-emerald-300' : 'text-danger'}`}>{mensagem.texto}</p>}
      </section>

      <section aria-label="Mudanças recentes" className="card-stat text-xs space-y-1 text-muted-foreground">
        <h2 className="text-sm font-semibold text-white">Mudanças recentes</h2>
        {dados.eventos.length === 0 ? <p>Nenhuma.</p> : dados.eventos.map((e, i) => <p key={i}>{new Date(e.ocorridoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} · {e.tipo} · {e.entidadeId}</p>)}
      </section>
    </div>
  )
}
