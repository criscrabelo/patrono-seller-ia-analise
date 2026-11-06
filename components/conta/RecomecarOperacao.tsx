'use client'

/**
 * P2.18.11 — RECOMEÇAR OPERAÇÃO: zera a operação VISÍVEL (produtos, jornadas,
 * filas) sem apagar histórico, usuários, integrações, configurações nem
 * aprendizado. Pede a palavra RECOMEÇAR: não é um clique acidental.
 */
import { useState } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'
import { toast } from '@/hooks/use-toast'
import { avisarMudancaNoPrecisaDeVoce } from '@/hooks/usePrecisaDeVoce'

type Previa = { contagens: { produtosAtivos: number; produtosInativos: number; candidatosAtivos: number } }

export function RecomecarOperacao() {
  const [aberto, setAberto] = useState(false)
  const [previa, setPrevia] = useState<Previa | null>(null)
  const [palavra, setPalavra] = useState('')
  const [ocupado, setOcupado] = useState(false)

  async function abrir() {
    setAberto(true)
    const r = await fetch('/api/operacao/recomecar').catch(() => null)
    setPrevia(r?.ok ? await r.json() : null)
  }

  async function recomecar() {
    setOcupado(true)
    const r = await fetch('/api/operacao/recomecar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmacao: palavra.trim() }) }).catch(() => null)
    const d = r ? await r.json().catch(() => ({})) : {}
    setOcupado(false)
    if (!r?.ok) {
      toast({ title: 'Não recomeçou', description: d.error ?? 'Sem conexão. Nada foi alterado.', variant: 'destructive' })
      return
    }
    toast({ title: 'Operação recomeçada', description: `${d.produtos} produto(s) e ${d.candidatos} oportunidade(s) arquivados. O histórico continua guardado.`, variant: 'success' })
    avisarMudancaNoPrecisaDeVoce()
    setAberto(false)
    setPalavra('')
  }

  if (!aberto) {
    return (
      <button type="button" onClick={abrir} className="card-stat w-full text-left hover:bg-white/5 transition-colors">
        <span className="text-sm font-medium text-white flex items-center gap-2"><RotateCcw className="w-4 h-4 text-accent" /> Recomeçar operação</span>
        <span className="text-xs text-muted-foreground block mt-0.5">Arquiva produtos e jornadas para começar do zero. O histórico fica guardado.</span>
      </button>
    )
  }
  return (
    <div className="card-stat space-y-3" aria-label="Recomeçar operação">
      <p className="text-sm font-medium text-white">Recomeçar operação</p>
      <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
        <li>Arquiva {previa ? `${previa.contagens.produtosAtivos + previa.contagens.produtosInativos} produto(s) e ${previa.contagens.candidatosAtivos} oportunidade(s)` : 'todos os produtos e oportunidades'}, encerra jornadas e vídeos em andamento.</li>
        <li>Fica guardado: publicações feitas, resultados, vendas, comissões, aprendizado, usuários, integrações e configurações.</li>
        <li>Dá para restaurar um produto depois, em Produtos → Excluídos.</li>
      </ul>
      <input className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-white" placeholder="Escreva RECOMEÇAR para confirmar" value={palavra} onChange={(e) => setPalavra(e.target.value)} aria-label="Confirmação" />
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="rounded-lg border border-border px-3 py-2 text-sm text-white" onClick={() => setAberto(false)}>Cancelar</button>
        <button type="button" disabled={ocupado || palavra.trim() !== 'RECOMEÇAR'} onClick={recomecar} className="rounded-lg bg-danger px-3 py-2 text-sm font-semibold text-white disabled:opacity-40 flex items-center justify-center gap-2">
          {ocupado ? <Loader2 className="w-4 h-4 animate-spin" /> : null}RECOMEÇAR
        </button>
      </div>
    </div>
  )
}
