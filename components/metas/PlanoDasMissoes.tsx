'use client'

import { useEffect, useState } from 'react'
import { Indicador } from '@/components/shared/Ux'

/**
 * P2.18 — O que falta em cada missão ativa: atual (o que o APP contou),
 * falta, prazo, de que depende, a próxima ação e quem age. Sem progresso
 * inventado: amostra registrada aqui que o app não contou é dependência.
 */
interface Linha {
  id: string; nome: string; atual: number; exigido: number; falta: number; prazo: string; diasRestantes: number
  dependencia: string; proximaAcao: string; responsavel: 'TITULAR' | 'TIKTOK' | 'PATRONO' | 'NINGUEM'
}
const QUEM = {
  TITULAR: { r: 'você', t: 'atencao' as const },
  TIKTOK: { r: 'TikTok', t: 'neutro' as const },
  PATRONO: { r: 'Patrono', t: 'ok' as const },
  NINGUEM: { r: '—', t: 'neutro' as const },
}
const data = (iso: string) => new Date(new Date(iso).getTime() - 60_000).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })

export function PlanoDasMissoes() {
  const [linhas, setLinhas] = useState<Linha[] | null>(null)
  useEffect(() => {
    fetch('/api/tiktok/operacao').then(async (r) => r.ok && setLinhas((await r.json()).missoes ?? [])).catch(() => null)
  }, [])
  if (!linhas || linhas.length === 0) return null
  return (
    <section className="card-stat space-y-2" aria-label="O que falta nas missões">
      <h2 className="text-sm font-semibold text-white">O que falta nas missões</h2>
      <ul className="space-y-2">
        {linhas.map((l) => (
          <li key={l.id} className="rounded bg-black/20 p-2 text-xs space-y-1">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <b className="text-white">{l.nome}</b>
              <span className="text-white/80 tabular-nums">{l.atual}/{l.exigido} · falta {l.falta} · até {data(l.prazo)} ({l.diasRestantes === 1 ? '1 dia' : `${l.diasRestantes} dias`})</span>
            </div>
            <p className="text-muted-foreground">Depende de: {l.dependencia}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Indicador nome="Quem age" estado={QUEM[l.responsavel].r} tom={QUEM[l.responsavel].t} />
              <span className="text-white/90">{l.proximaAcao}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
