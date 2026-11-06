'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Film, Download, Copy, CheckCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatDateShort, copyToClipboard } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import { useGuardModulo } from '@/hooks/useGuardModulo'

/**
 * P2.17.13 — VÍDEOS: todo vídeo REAL do fluxo, de qualquer origem (gerado
 * pelo Patrono com FFmpeg e mídia autorizada, enviado por você, IA quando
 * ligada). Só aparece o que tem arquivo — roteiro não é vídeo.
 */
interface Video { id: string; url: string; produto: string; status: string; canal: string | null; em: string; origem: string; link: string; demonstracao: boolean }

export default function VideosPage() {
  useGuardModulo('videos')
  const [videos, setVideos] = useState<Video[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  useEffect(() => {
    fetch('/api/resumos/videos')
      .then(async (r) => (r.ok ? setVideos(await r.json()) : setErro('Não consegui carregar os vídeos.')))
      .catch(() => setErro('Sem conexão.'))
  }, [])

  function copiarLink(url: string) {
    copyToClipboard(url)
    toast({ title: 'Link copiado!', description: 'Cole onde quiser usar.', variant: 'success' })
  }

  if (erro) return <p className="card-stat text-sm text-muted-foreground">{erro}</p>
  if (!videos) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => <div key={i} className="card-stat animate-pulse h-80" />)}
      </div>
    )
  }

  return (
    <div className="space-y-5 max-w-6xl">
      <div>
        <h2 className="text-lg font-semibold text-white">Vídeos</h2>
        <p className="text-sm text-muted-foreground">{videos.length} vídeo(s) com arquivo real, de qualquer origem.</p>
      </div>

      {videos.length === 0 ? (
        <div className="card-stat flex flex-col items-center justify-center py-16 text-center">
          <Film className="w-10 h-10 text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground mb-2 font-medium">Nenhum vídeo com arquivo ainda</p>
          <p className="text-xs text-muted-foreground max-w-md">
            O Patrono gera o vídeo sozinho assim que o produto tem mídia autorizada. Se faltar mídia, o pedido aparece em <Link href="/precisa-de-voce" className="underline">Precisa de você</Link>.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {videos.map((v) => (
            <div key={`${v.link}-${v.id}`} className="card-stat space-y-3 flex flex-col">
              <video src={v.url} controls playsInline preload="metadata" className="w-full rounded-lg aspect-[9/16] bg-black" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-white truncate">{v.produto}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{v.origem}{v.demonstracao ? ' · DEMONSTRAÇÃO (teste)' : ''}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
                  {formatDateShort(v.em)}{v.canal ? ` · ${v.canal}` : ''}
                  {v.status === 'publicado' || v.status === 'PUBLICADO' ? <span className="text-accent flex items-center gap-0.5">· <CheckCircle className="w-3 h-3" />Publicado</span> : <span>· {v.status.toLowerCase().replace(/_/g, ' ')}</span>}
                </p>
              </div>
              <div className="flex gap-2 mt-auto">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => copiarLink(v.url)}><Copy className="w-3.5 h-3.5" />Copiar URL</Button>
                <Button asChild variant="outline" size="sm" className="flex-1">
                  <a href={v.url} target="_blank" rel="noopener noreferrer" download><Download className="w-3.5 h-3.5" />Baixar</a>
                </Button>
                <Button asChild size="sm" variant="ghost"><Link href={v.link}>Abrir</Link></Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
