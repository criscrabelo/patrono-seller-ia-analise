'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

/**
 * P2.17.23 — Agenda montada pelo Patrono a partir de amostras, missões, Natal,
 * vídeos aprovados e prontos. Horário só onde há material (hipótese declarada:
 * ainda sem dado de audiência); sem material, aparece a DEPENDÊNCIA, sem data.
 * Você pode ajustar no calendário; não precisa montar à mão.
 */
interface Item { quando: string | null; titulo: string; tipo: string; dependencia: string | null; link: string }
const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const ROTULO: Record<string, string> = { PUBLICAR: 'Publicar', APROVAR: 'Aprovar e publicar', GRAVAR: 'Gravar', DEPENDENCIA: 'Dependência', PRAZO: 'Prazo' }

export function AgendaSugerida() {
  const [itens, setItens] = useState<Item[] | null>(null)
  useEffect(() => {
    fetch('/api/tiktok/operacao').then(async (r) => r.ok && setItens((await r.json()).agenda)).catch(() => null)
  }, [])
  if (!itens) return null
  const datados = itens.filter((i) => i.quando)
  const dependencias = itens.filter((i) => !i.quando)
  return (
    <section className="card-stat space-y-2" aria-label="Agenda sugerida pelo Patrono">
      <p className="text-sm font-semibold text-white">Agenda sugerida pelo Patrono</p>
      {itens.length === 0 ? <p className="text-xs text-muted-foreground">Nada para agendar agora: sem vídeo pronto, amostra ou prazo em curso.</p> : null}
      {datados.length > 0 && (
        <ul className="space-y-1 text-xs">
          {datados.map((i, k) => (
            <li key={k} className="flex flex-wrap gap-x-2">
              <b className="text-white tabular-nums">{quando(i.quando!)}</b>
              <span className="text-muted-foreground">{ROTULO[i.tipo] ?? i.tipo}</span>
              <Link href={i.link} className="text-white hover:underline break-words min-w-0">{i.titulo}</Link>
            </li>
          ))}
        </ul>
      )}
      {dependencias.length > 0 && (
        <ul className="space-y-1 text-xs">
          {dependencias.map((i, k) => <li key={k}><span className="text-warning">{i.dependencia}</span> · <Link href={i.link} className="text-white hover:underline">{i.titulo}</Link></li>)}
        </ul>
      )}
      <p className="text-[11px] text-muted-foreground">Horários são hipótese (ainda sem dado da sua audiência); no máximo 2 por dia.</p>
    </section>
  )
}
