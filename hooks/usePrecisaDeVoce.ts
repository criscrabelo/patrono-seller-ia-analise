'use client'

import { useEffect, useState } from 'react'

/**
 * P2.17.11 — O número do sininho: pendências abertas em "Precisa de você".
 *
 * Uma leitura compartilhada (o sininho do menu e o do topo no celular não
 * consultam duas vezes). Atualiza:
 *   - a cada 3 min com a aba visível (mesma regra do selo antigo, P2.15.6);
 *   - ao voltar para a aba;
 *   - NA HORA quando alguma tela avisa `avisarMudancaNoPrecisaDeVoce()`
 *     (aprovar, rejeitar, pedir ajuste, conectar, resolver…).
 * Se a central estiver desligada para a conta (404) ou der erro, o badge some.
 */
export const EVENTO_PRECISA_DE_VOCE = 'patrono:precisa-de-voce'
const INTERVALO_MS = 3 * 60_000

let total = 0
let ultimaLeitura = 0
let lendo: Promise<void> | null = null
const ouvintes = new Set<(n: number) => void>()

function publicar(n: number) {
  total = n
  for (const f of ouvintes) f(n)
}

function ler(): Promise<void> {
  if (lendo) return lendo
  ultimaLeitura = Date.now()
  lendo = fetch('/api/precisa-de-voce?contar=1')
    .then(async (r) => {
      if (!r.ok) return publicar(0)
      const d = await r.json().catch(() => null)
      publicar(typeof d?.total === 'number' ? d.total : 0)
    })
    .catch(() => {})
    .finally(() => {
      lendo = null
    })
  return lendo
}

/** Chame depois de qualquer ação que possa criar ou resolver pendência. */
export function avisarMudancaNoPrecisaDeVoce() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENTO_PRECISA_DE_VOCE))
}

export function usePrecisaDeVoce() {
  const [n, setN] = useState(total)
  useEffect(() => {
    ouvintes.add(setN)
    const visivel = () => typeof document === 'undefined' || document.visibilityState === 'visible'
    if (Date.now() - ultimaLeitura > 5_000) ler()
    const intervalo = setInterval(() => visivel() && ler(), INTERVALO_MS)
    const aoVoltar = () => visivel() && Date.now() - ultimaLeitura > 60_000 && ler()
    const aoMudar = () => ler()
    document.addEventListener('visibilitychange', aoVoltar)
    window.addEventListener(EVENTO_PRECISA_DE_VOCE, aoMudar)
    return () => {
      ouvintes.delete(setN)
      clearInterval(intervalo)
      document.removeEventListener('visibilitychange', aoVoltar)
      window.removeEventListener(EVENTO_PRECISA_DE_VOCE, aoMudar)
    }
  }, [])
  return { total: n }
}
