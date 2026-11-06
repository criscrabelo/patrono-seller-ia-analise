'use client'

import { useEffect, useState } from 'react'
import { CheckCircle, Clock, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'

interface Estado {
  liberada: boolean
  conectada: boolean
  conta: string | null
  frase: string
}

/** P2.17 — Conexão da conta de criadora no TikTok Shop (fluxo oficial). */
export function TikTokShopCard() {
  const [estado, setEstado] = useState<Estado | null>(null)
  const [erro, setErro] = useState(false)
  const [saindo, setSaindo] = useState(false)

  async function carregar() {
    try {
      const r = await fetch('/api/integracoes/tiktok-shop/estado')
      if (!r.ok) throw new Error()
      setEstado(await r.json())
      setErro(false)
    } catch {
      setErro(true)
    }
  }
  useEffect(() => {
    carregar()
  }, [])

  async function desconectar() {
    setSaindo(true)
    const r = await fetch('/api/integracoes/tiktok-shop/desconectar', { method: 'POST' }).catch(() => null)
    setSaindo(false)
    toast(r?.ok ? { title: 'TikTok Shop desconectado' } : { title: 'Não consegui desconectar agora', variant: 'destructive' })
    carregar()
  }

  return (
    <div className="card-stat flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-cyan-500 flex items-center justify-center text-xl">🛍️</div>
        <div className="min-w-0">
          <p className="font-semibold text-white text-sm">TikTok Shop (afiliada)</p>
          <p className="text-xs text-muted-foreground break-words">
            {erro ? 'Não consegui conferir agora.' : estado ? estado.frase : 'Conferindo…'}
          </p>
        </div>
      </div>
      {estado?.conectada && estado.conta && <p className="text-xs text-accent break-words">{estado.conta}</p>}
      <div className="flex flex-wrap gap-2">
        {estado?.liberada && !estado.conectada && (
          <Button asChild size="sm">
            <a href="/api/integracoes/tiktok-shop/oauth/start">Conectar TikTok Shop</a>
          </Button>
        )}
        {estado?.conectada && (
          <Button size="sm" variant="outline" onClick={desconectar} disabled={saindo}>
            {saindo ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Desconectar'}
          </Button>
        )}
        {estado && !estado.liberada && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" /> Depende do TikTok
          </span>
        )}
        {estado?.conectada && (
          <span className="inline-flex items-center gap-1 text-xs text-accent">
            <CheckCircle className="w-3 h-3" /> Conexão oficial
          </span>
        )}
      </div>
    </div>
  )
}
