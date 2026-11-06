'use client'

import { useState } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * P2.17.4 — Importar missões a partir do TEXTO do print da tela de metas.
 * 1) colar o texto → 2) revisar e corrigir o rascunho → 3) "Revisei, salvar".
 * Nada é gravado antes do passo 3.
 */

interface MetaRascunho {
  nome: string
  tipo: string
  quantidadeRealizada: number
  quantidadeExigida: number
}

interface Rascunho {
  campanha: string | null
  inicio: string | null
  fim: string | null
  recompensaTotal: number | null
  metas: MetaRascunho[]
  avisos: string[]
}

const TIPOS = [
  { v: 'VIDEOS_QUALIFICADOS', r: 'Vídeos qualificados' },
  { v: 'VIDEOS_COM_PRODUTO', r: 'Vídeos com produtos à venda' },
  { v: 'ADICIONAR_PRODUTOS', r: 'Adicionar produtos' },
  { v: 'SOLICITAR_AMOSTRAS', r: 'Solicitar amostras' },
  { v: 'OUTRO', r: 'Outro' },
]

export function ImportarMetas({ onSalvo, onCancelar }: { onSalvo: () => void; onCancelar: () => void }) {
  const [texto, setTexto] = useState('')
  const [rascunho, setRascunho] = useState<Rascunho | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [revisado, setRevisado] = useState(false)

  const input = 'rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-white'

  async function ler() {
    setErro(null)
    setOcupado(true)
    try {
      const r = await fetch('/api/tiktok/metas/importar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ texto }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(r.status === 401 ? 'Sua sessão expirou. Entre de novo.' : d.error ?? 'Não consegui ler o texto.')
      setRascunho(d.rascunho)
      setRevisado(false)
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setOcupado(false)
    }
  }

  async function salvar() {
    if (!rascunho) return
    setErro(null)
    setOcupado(true)
    try {
      const r = await fetch('/api/tiktok/metas/salvar-revisadas', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ revisado, campanha: rascunho.campanha ?? '', recompensaTotal: rascunho.recompensaTotal, inicio: rascunho.inicio ?? '', fim: rascunho.fim ?? '', metas: rascunho.metas }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error ?? 'Não consegui salvar as metas.')
      onSalvo()
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setOcupado(false)
    }
  }

  const mudarMeta = (i: number, campo: keyof MetaRascunho, valor: string) =>
    setRascunho((r) =>
      r ? { ...r, metas: r.metas.map((m, k) => (k === i ? { ...m, [campo]: campo === 'nome' || campo === 'tipo' ? valor : Number(valor) } : m)) } : r
    )

  return (
    <div className="card-stat space-y-3">
      <p className="text-sm font-semibold text-white">Importar do print da tela de metas <span className="text-xs font-normal text-warning">contingência</span></p>
      <p className="text-xs text-muted-foreground">
        No celular, abra o print da tela de metas do TikTok Shop, use “copiar texto” (iPhone: Texto ao Vivo; Android: Google Lens) e cole aqui.
        Eu monto um rascunho; nada é salvo antes de você revisar. Reimportar a mesma campanha atualiza progresso, prazo e recompensa — não duplica.
      </p>
      {erro && <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-white">{erro}</p>}
      {!rascunho ? (
        <>
          <textarea className={`${input} w-full min-h-[140px]`} placeholder="Cole aqui o texto copiado do print…" value={texto} onChange={(e) => setTexto(e.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" disabled={ocupado || !texto.trim()} onClick={ler}>
              {ocupado ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Ler texto'}
            </Button>
            <Button size="sm" variant="outline" onClick={onCancelar}>Cancelar</Button>
          </div>
        </>
      ) : (
        <>
          {rascunho.avisos.length > 0 && (
            <ul className="list-disc pl-5 text-xs text-warning space-y-0.5">{rascunho.avisos.map((a) => <li key={a}>{a}</li>)}</ul>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input className={`${input} sm:col-span-2`} placeholder="Campanha" value={rascunho.campanha ?? ''} onChange={(e) => setRascunho({ ...rascunho, campanha: e.target.value })} />
            <label className="text-xs text-muted-foreground">Início<input type="date" className={`${input} w-full mt-1`} value={rascunho.inicio ?? ''} onChange={(e) => setRascunho({ ...rascunho, inicio: e.target.value })} /></label>
            <label className="text-xs text-muted-foreground">Fim<input type="date" className={`${input} w-full mt-1`} value={rascunho.fim ?? ''} onChange={(e) => setRascunho({ ...rascunho, fim: e.target.value })} /></label>
            <input
              className={input}
              placeholder="Recompensa total (R$)"
              inputMode="decimal"
              value={rascunho.recompensaTotal ?? ''}
              onChange={(e) => setRascunho({ ...rascunho, recompensaTotal: e.target.value.trim() ? Number(e.target.value.replace(',', '.')) : null })}
            />
          </div>
          <div className="space-y-2">
            {rascunho.metas.map((m, i) => (
              <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto_auto] gap-2 items-center">
                <input className={input} value={m.nome} onChange={(e) => mudarMeta(i, 'nome', e.target.value)} aria-label="Nome da meta" />
                <select className={input} value={m.tipo} onChange={(e) => mudarMeta(i, 'tipo', e.target.value)} aria-label="Tipo">
                  {TIPOS.map((t) => <option key={t.v} value={t.v}>{t.r}</option>)}
                </select>
                <input className={`${input} w-20`} inputMode="numeric" value={m.quantidadeRealizada} onChange={(e) => mudarMeta(i, 'quantidadeRealizada', e.target.value)} aria-label="Feito" />
                <input className={`${input} w-20`} inputMode="numeric" value={m.quantidadeExigida} onChange={(e) => mudarMeta(i, 'quantidadeExigida', e.target.value)} aria-label="Exigido" />
                <Button size="sm" variant="outline" onClick={() => setRascunho({ ...rascunho, metas: rascunho.metas.filter((_, k) => k !== i) })} aria-label="Remover meta">
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-white">
            <input type="checkbox" checked={revisado} onChange={(e) => setRevisado(e.target.checked)} />
            Revisei: campanha, datas, recompensa e metas conferem com o app.
          </label>
          <div className="flex gap-2">
            <Button size="sm" disabled={ocupado || !revisado || rascunho.metas.length === 0} onClick={salvar}>Salvar metas revisadas</Button>
            <Button size="sm" variant="outline" onClick={() => setRascunho(null)}>Voltar ao texto</Button>
            <Button size="sm" variant="outline" onClick={onCancelar}>Cancelar</Button>
          </div>
        </>
      )}
    </div>
  )
}
