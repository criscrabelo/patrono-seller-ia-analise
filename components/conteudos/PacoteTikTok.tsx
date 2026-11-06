'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle, Copy, Loader2, ShoppingBag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'

interface Pacote {
  tiktokShop: boolean
  productId: string | null
  gancho: string | null
  legenda: string
  hashtags: string[]
  video: { url: string | null; formato: string }
  pendencias: string[]
  avisos: string[]
  passosNoApp: string[]
  pronto: boolean
}

/** Tira o código técnico do começo ("VIDEO_AUSENTE: ...") para a tela. */
const semCodigo = (t: string) => t.replace(/^[A-Z_]+:\s*/, '')

/**
 * P2.17.1 — Pacote do TikTok (modo assistido). Só leitura: o Patrono prepara,
 * a titular publica no app do TikTok e marca o produto. Nada é enviado daqui.
 */
export function PacoteTikTok({ conteudoId }: { conteudoId: string }) {
  const [pacote, setPacote] = useState<Pacote | null>(null)
  const [erro, setErro] = useState(false)

  useEffect(() => {
    let vivo = true
    fetch(`/api/tiktok/pacote-manual?conteudoId=${encodeURIComponent(conteudoId)}`)
      .then(async (r) => {
        const d = await r.json().catch(() => null)
        if (!vivo) return
        if (r.ok && d?.pacote) setPacote(d.pacote)
        else setErro(true)
      })
      .catch(() => vivo && setErro(true))
    return () => {
      vivo = false
    }
  }, [conteudoId])

  async function copiar() {
    if (!pacote) return
    try {
      await navigator.clipboard.writeText(pacote.legenda)
      toast({ title: 'Legenda copiada' })
    } catch {
      toast({ title: 'Não consegui copiar; selecione o texto e copie', variant: 'destructive' })
    }
  }

  return (
    <section className="card-stat space-y-3" aria-label="Pacote para o TikTok">
      <div className="flex items-center gap-2">
        <ShoppingBag className="w-4 h-4 text-accent" />
        <h2 className="text-sm font-semibold text-white">Pacote para o TikTok</h2>
      </div>
      {erro ? (
        <p className="text-xs text-muted-foreground">Não consegui montar o pacote agora.</p>
      ) : !pacote ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" /> Montando…
        </p>
      ) : (
        <>
          <p className={pacote.pronto ? 'flex items-center gap-1.5 text-xs text-accent' : 'flex items-center gap-1.5 text-xs text-warning'}>
            {pacote.pronto ? <CheckCircle className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
            {pacote.pronto ? 'Pronto para você publicar no app do TikTok.' : 'Ainda falta resolver antes de publicar:'}
          </p>
          {pacote.pendencias.length > 0 && (
            <ul className="list-disc pl-5 text-xs text-warning space-y-0.5">
              {pacote.pendencias.map((p) => (
                <li key={p}>{semCodigo(p)}</li>
              ))}
            </ul>
          )}
          {pacote.avisos.length > 0 && (
            <ul className="list-disc pl-5 text-xs text-muted-foreground space-y-0.5">
              {pacote.avisos.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
          {pacote.gancho && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Gancho (primeiros segundos)</p>
              <p className="text-sm text-white break-words">{pacote.gancho}</p>
            </div>
          )}
          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Legenda</p>
              <Button size="sm" variant="outline" onClick={copiar}>
                <Copy className="w-3.5 h-3.5 mr-1" /> Copiar
              </Button>
            </div>
            <pre className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-black/30 p-3 text-xs text-white font-sans">{pacote.legenda}</pre>
          </div>
          {pacote.video.url ? (
            <a href={pacote.video.url} target="_blank" rel="noopener noreferrer" className="text-xs text-accent underline">
              Baixar o vídeo vertical ({pacote.video.formato})
            </a>
          ) : null}
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">No app do TikTok</p>
            <ol className="list-decimal pl-5 text-xs text-white space-y-1">
              {pacote.passosNoApp.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ol>
          </div>
        </>
      )}
    </section>
  )
}
