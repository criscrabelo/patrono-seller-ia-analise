'use client'

import { useEffect, useState } from 'react'
import { Detalhes, Indicador, reaisOuNull } from '@/components/shared/Ux'

/**
 * P2.17.20 — As 10 primeiras como EXPERIMENTO organizado: cada slot testa uma
 * hipótese (formato, gancho, duração, objetivo, categoria). Slot publicado =
 * dado real; slot futuro = só a hipótese (nunca dado inventado). A fila
 * comercial manda: se houver oportunidade melhor, ela vence a matriz.
 */
interface Slot {
  slot: number; rotulo: string; situacao: 'PUBLICADA' | 'EM_PRODUCAO' | 'PLANEJADA'; produtoSugerido: string | null
  hipotese: { estrutura: string; duracao: number; objetivo: string; hipotese: string; categoriaSugerida: string | null }
  real: null | { produto: string; hook: string | null; duracao: number | null; qualityGate: string | null; aprovacao: string | null; link: string | null; views: number | null; cliques: number | null; vendas: number | null; comissao: number | null }
}
const SIT = { PUBLICADA: { r: 'publicada', t: 'ok' as const }, EM_PRODUCAO: { r: 'em produção', t: 'atencao' as const }, PLANEJADA: { r: 'planejada', t: 'neutro' as const } }
const n = (v: number | null) => (v === null ? 'sem registro' : v.toLocaleString('pt-BR'))

export function PlanoDasDez() {
  const [plano, setPlano] = useState<Slot[] | null>(null)
  useEffect(() => {
    fetch('/api/tiktok/operacao').then(async (r) => r.ok && setPlano((await r.json()).plano)).catch(() => null)
  }, [])
  if (!plano) return null
  const feitas = plano.filter((s) => s.situacao === 'PUBLICADA').length
  return (
    <section className="card-stat space-y-2" aria-label="Plano das 10 primeiras">
      <Detalhes titulo={`Plano das 10 primeiras — experimento comercial (${feitas}/10 publicadas)`}>
        <p className="pb-1">Cada publicação testa uma hipótese diferente. Slots futuros mostram só a hipótese; o produto é escolhido pela fila comercial na hora (dinheiro antes da matriz).</p>
        <ol className="space-y-1.5">
          {plano.map((s) => (
            <li key={s.slot} className="rounded bg-black/20 p-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <b className="text-white tabular-nums">{s.rotulo}</b>
                <Indicador nome="" estado={SIT[s.situacao].r} tom={SIT[s.situacao].t} />
                <span className="text-white/80">{s.hipotese.estrutura.toLowerCase().replace(/_/g, ' ')} · {s.hipotese.duracao} s · objetivo {s.hipotese.objetivo.toLowerCase()}</span>
              </div>
              <p>Hipótese: {s.hipotese.hipotese}</p>
              {s.real ? (
                <p className="text-white/80">
                  {s.real.produto} · gancho “{s.real.hook ?? '—'}” · QG {s.real.qualityGate ?? '—'} · {s.real.aprovacao ?? 'aprovação não registrada'} · views {n(s.real.views)} · cliques {n(s.real.cliques)} · vendas {n(s.real.vendas)} · comissão {reaisOuNull(s.real.comissao) ?? 'sem registro'}
                  {s.real.link ? <> · <a href={s.real.link} target="_blank" rel="noreferrer" className="text-accent hover:underline">ver</a></> : null}
                </p>
              ) : (
                <p>{s.produtoSugerido ? `Produto sugerido: ${s.produtoSugerido}` : 'Produto: definido pela fila comercial quando chegar a vez.'}</p>
              )}
            </li>
          ))}
        </ol>
      </Detalhes>
    </section>
  )
}
