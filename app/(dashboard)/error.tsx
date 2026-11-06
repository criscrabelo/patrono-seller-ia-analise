'use client'

import { useEffect } from 'react'
import Link from 'next/link'

// P2.15.3: erro de tela vira mensagem com saída (antes, tela branca).
export default function ErroDaTela({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[tela] erro', error.digest ?? error.message)
  }, [error])
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="card-stat max-w-md w-full text-center space-y-3">
        <p className="text-base font-semibold text-white">Algo deu errado nesta tela.</p>
        <p className="text-xs text-muted-foreground">Nada foi publicado nem cobrado. Tente de novo; se repetir, volte para a Central.</p>
        <div className="flex flex-wrap justify-center gap-2">
          <button onClick={reset} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-primary-dark hover:bg-accent-light">Tentar de novo</button>
          <Link href="/torre" className="rounded-lg border border-border px-4 py-2 text-sm text-white hover:bg-secondary">Ir para a Central</Link>
        </div>
      </div>
    </div>
  )
}
