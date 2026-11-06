'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'
import { formatCurrency } from '@/lib/utils'

/** P2.19 — Alertas de redução de comissão (janela oficial de 30 dias para produto já adicionado). */
interface Alerta {
  id: string
  nomeProduto: string
  taxaAtual: number
  taxaNova: number
  dataEfetiva: string | null
  fonteDataEfetiva: string | null
  produtoJaAdicionado: 'SIM' | 'NAO' | 'NAO_CONFIRMADO'
  status: string
  nivel: string | null
  calculo: { diasRestantes: number | null; mensagem: string; avisos: string[]; impacto: { porVenda: number | null; observado30Dias: { pedidos: number; valor: number } | null } } | null
}

const COR: Record<string, string> = { URGENTE: 'border-danger/60 bg-danger/5', AVISO: 'border-warning/60 bg-warning/5', INFORMATIVO: 'border-border' }

export function AlertasReducaoComissao() {
  const [alertas, setAlertas] = useState<Alerta[]>([])
  const [fonte, setFonte] = useState<string>('')
  const [ocupado, setOcupado] = useState<string | null>(null)
  const carregar = () => fetch('/api/comissoes/alertas-reducao').then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) { setAlertas(d.alertas); setFonte(`${d.regra.fonte} (regra de ${d.regra.dataDaFonte.split('-').reverse().join('/')}, conferida pelo Patrono em ${d.regra.verificadaEm.split('-').reverse().join('/')})`) } }).catch(() => null)
  useEffect(() => { carregar() }, [])

  async function corrigir(id: string, corpo: Record<string, unknown>) {
    setOcupado(id)
    try {
      const r = await fetch('/api/comissoes/alertas-reducao', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'corrigir', id, ...corpo }) })
      if (!r.ok) toast({ title: 'Não foi possível salvar', description: (await r.json().catch(() => ({}))).error ?? '', variant: 'destructive' })
      await carregar()
    } finally { setOcupado(null) }
  }

  const visiveis = alertas.filter((a) => ['ATIVO', 'APLICABILIDADE_NAO_CONFIRMADA', 'EFETIVADO'].includes(a.status))
  if (!visiveis.length) return null
  return (
    <section aria-label="Alertas de redução de comissão" className="card-stat space-y-3">
      <h2 className="text-sm font-semibold text-white flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-warning" /> Comissão vai cair</h2>
      <p className="text-[11px] text-muted-foreground">Regra oficial: redução de comissão só vale 30 dias depois para produto que você já adicionou. Fonte: {fonte}.</p>
      <ul className="space-y-2">
        {visiveis.map((a) => (
          <li key={a.id} className={`rounded-lg border p-3 space-y-1 ${COR[a.nivel ?? 'INFORMATIVO'] ?? 'border-border'}`}>
            <p className="text-sm text-white break-words">{a.nomeProduto}</p>
            <p className="text-xs text-white">
              {a.status === 'EFETIVADO' ? 'Já vale' : a.calculo?.diasRestantes != null ? <strong>{a.calculo.diasRestantes} dia(s)</strong> : '—'} · {a.taxaAtual}% → {a.taxaNova}%
              {a.nivel && <span className="ml-2 text-[10px] uppercase tracking-wider">{a.nivel}</span>}
            </p>
            {a.calculo && <p className="text-[11px] text-muted-foreground">{a.calculo.mensagem}</p>}
            {a.calculo?.impacto.observado30Dias && (
              <p className="text-[11px] text-muted-foreground">Se as vendas dos próximos 30 dias forem iguais às dos últimos 30 ({a.calculo.impacto.observado30Dias.pedidos} pedidos importados): {formatCurrency(a.calculo.impacto.observado30Dias.valor)} a menos.</p>
            )}
            {a.calculo?.avisos.map((t, i) => <p key={i} className="text-[11px] text-warning">{t}</p>)}
            {a.status !== 'EFETIVADO' && (
              <div className="flex flex-wrap gap-2 pt-1">
                {a.produtoJaAdicionado === 'NAO_CONFIRMADO' && (
                  <Button size="sm" variant="outline" className="min-h-[44px] sm:min-h-0" disabled={ocupado === a.id} onClick={() => corrigir(a.id, { produtoJaAdicionado: 'SIM' })}>JÁ ADICIONEI</Button>
                )}
                <label className="text-[11px] text-muted-foreground flex items-center gap-1">
                  Data no app:
                  <input type="date" className="rounded border border-border bg-background px-2 text-white text-xs [color-scheme:dark] min-h-[44px] sm:h-8 sm:min-h-0" aria-label={`Data em que a comissão de ${a.nomeProduto} muda no app`} disabled={ocupado === a.id}
                    onChange={(e) => e.target.value && corrigir(a.id, { dataEfetiva: e.target.value })} />
                </label>
                <Button size="sm" variant="ghost" className="min-h-[44px] sm:min-h-0" disabled={ocupado === a.id} onClick={() => corrigir(a.id, { cancelar: true })}>O VENDEDOR DESISTIU</Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
