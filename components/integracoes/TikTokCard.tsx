'use client'

import { useEffect, useState } from 'react'
import { CheckCircle, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Estado {
  appConfigurado: boolean
  conectado: boolean
  conta: string | null
  escopos: string[]
  nivel: 'AUTOMATICO' | 'SEMIAUTOMATICO' | 'MANUAL_POR_LIMITACAO' | 'BLOQUEADO'
  frase: string
  bloqueios: { quem: 'TIKTOK' | 'TITULAR' | 'AMBIENTE'; texto: string }[]
  produtoMarcado: string
}

const ROTULO: Record<Estado['nivel'], string> = {
  AUTOMATICO: 'AUTOMÁTICO',
  SEMIAUTOMATICO: 'SEMIAUTOMÁTICO',
  MANUAL_POR_LIMITACAO: 'MANUAL POR LIMITAÇÃO DA PLATAFORMA',
  BLOQUEADO: 'BLOQUEADO',
}

/** P2.17.10 — Conexão oficial do TikTok (Login Kit + Content Posting API). Sem token manual. */
export function TikTokCard() {
  const [estado, setEstado] = useState<Estado | null>(null)
  const [erro, setErro] = useState(false)
  useEffect(() => {
    fetch('/api/integracoes/tiktok/estado')
      .then(async (r) => {
        if (!r.ok) throw new Error()
        setEstado(await r.json())
      })
      .catch(() => setErro(true))
  }, [])

  return (
    <div className="card-stat flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-gray-900 to-gray-700 flex items-center justify-center text-xl">🎵</div>
        <div className="min-w-0">
          <p className="font-semibold text-white text-sm">TikTok (publicação)</p>
          <p className="text-xs text-muted-foreground break-words">{erro ? 'Não consegui conferir agora.' : estado ? estado.frase : 'Conferindo…'}</p>
        </div>
      </div>
      {estado && (
        <>
          <p className="text-[11px] text-white">
            Nível: <b>{ROTULO[estado.nivel]}</b>
            {estado.conta ? ` · ${estado.conta}` : ''}
          </p>
          {estado.bloqueios.length > 0 && (
            <ul className="list-disc pl-4 text-[11px] text-muted-foreground space-y-0.5">
              {estado.bloqueios.map((b) => <li key={b.texto}>{b.texto}</li>)}
            </ul>
          )}
          <p className="text-[11px] text-muted-foreground">{estado.produtoMarcado}</p>
        </>
      )}
      <div className="flex flex-wrap gap-2">
        {estado?.appConfigurado && !estado.conectado && (
          <Button asChild size="sm">
            <a href="/api/integracoes/tiktok/oauth/start">Conectar TikTok</a>
          </Button>
        )}
        {estado?.appConfigurado && estado.conectado && !estado.escopos.includes('video.upload') && (
          <Button asChild size="sm" variant="outline">
            <a href="/api/integracoes/tiktok/oauth/start">Reconectar (autorizar rascunhos)</a>
          </Button>
        )}
        {estado && !estado.appConfigurado && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" /> Depende do TikTok
          </span>
        )}
        {estado?.conectado && (
          <span className="inline-flex items-center gap-1 text-xs text-accent">
            <CheckCircle className="w-3 h-3" /> Conexão oficial
          </span>
        )}
      </div>
    </div>
  )
}
