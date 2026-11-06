'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useDropzone } from 'react-dropzone'
import { X, Upload, Loader2, Save, ImageIcon, Link as LinkIcon, Film } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'
import { useGuardModulo } from '@/hooks/useGuardModulo'
import { useColarArquivos } from '@/hooks/useColarArquivos'
import { enviarMidia } from '@/lib/upload-midia'

interface Produto {
  id: string
  nome: string
  categoria: string
  preco: number
  imagens: string[]
  videos: string[]
  descricao: string
  linkProduto: string | null
}

const MAX_IMAGENS = 10
const MAX_VIDEOS = 5

export default function EditarImagensPage() {
  useGuardModulo('produtos')
  const router = useRouter()
  const params = useParams()
  const id = params.id as string

  const [produto, setProduto] = useState<Produto | null>(null)
  const [imagens, setImagens] = useState<string[]>([])
  const [videos, setVideos] = useState<string[]>([])
  const [urlInput, setUrlInput] = useState('')
  const [linkProduto, setLinkProduto] = useState('')
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [erroAoCarregar, setErroAoCarregar] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/produtos/${id}`)
      .then(async (r) => {
        const p = await r.json().catch(() => ({}))
        if (!r.ok) {
          setErroAoCarregar(r.status === 404 ? 'Este produto não existe mais ou não é deste workspace.' : 'Não consegui carregar o produto.')
          return
        }
        setProduto(p)
        setImagens(p.imagens ?? [])
        setVideos(p.videos ?? [])
        setLinkProduto(p.linkProduto ?? '')
      })
      .catch(() => setErroAoCarregar('Sem conexão. Tente de novo.'))
      .finally(() => setLoading(false))
  }, [id])

  // Envia arquivos, separando imagens de vídeos e respeitando os limites.
  const enviarArquivos = useCallback(async (files: File[]) => {
    const novasImagens = files.filter((f) => f.type.startsWith('image/'))
    const novosVideos = files.filter((f) => f.type.startsWith('video/'))
    if (novasImagens.length === 0 && novosVideos.length === 0) {
      toast({ title: 'Envie apenas imagens ou vídeos', variant: 'destructive' })
      return
    }

    setUploading(true)
    try {
      // Upload direto do navegador → Supabase (a rota /api/upload passaria pela
      // Vercel, que corta requisições acima de 4,5 MB e barraria os vídeos).
      const enviar = async (arquivos: File[]) => {
        const urls: string[] = []
        for (const file of arquivos) {
          try {
            urls.push(await enviarMidia(file, id))
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Falha no upload'
            toast({ title: `Erro em ${file.name}`, description: msg, variant: 'destructive' })
          }
        }
        return urls
      }

      if (novasImagens.length > 0) {
        const espaco = MAX_IMAGENS - imagens.length
        if (espaco <= 0) {
          toast({ title: `Limite de ${MAX_IMAGENS} imagens atingido`, variant: 'destructive' })
        } else {
          const urls = await enviar(novasImagens.slice(0, espaco))
          if (urls.length) setImagens((prev) => [...prev, ...urls])
        }
      }

      if (novosVideos.length > 0) {
        const espaco = MAX_VIDEOS - videos.length
        if (espaco <= 0) {
          toast({ title: `Limite de ${MAX_VIDEOS} vídeos atingido`, variant: 'destructive' })
        } else {
          const urls = await enviar(novosVideos.slice(0, espaco))
          if (urls.length) setVideos((prev) => [...prev, ...urls])
        }
      }
    } finally {
      setUploading(false)
    }
  }, [imagens, videos])

  // Ctrl+V / Cmd+V cola imagens e vídeos direto na página. Desligado enquanto
  // o produto carrega, pois o fetch inicial sobrescreveria o que foi colado.
  useColarArquivos(enviarArquivos, !loading)

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: enviarArquivos,
    accept: { 'image/*': [] },
    maxFiles: MAX_IMAGENS,
  })

  const vid = useDropzone({
    onDrop: enviarArquivos,
    accept: { 'video/*': [] },
    maxFiles: MAX_VIDEOS,
  })

  function adicionarUrl() {
    const url = urlInput.trim()
    if (!url) return
    try { new URL(url) } catch { toast({ title: 'URL inválida', variant: 'destructive' }); return }
    setImagens((prev) => [...prev, url])
    setUrlInput('')
  }

  async function salvar() {
    setSaving(true)
    try {
      const patch: Record<string, unknown> = { imagens, videos }
      // Campo vazio = tirar o link (antes, apagar não tinha efeito).
      patch.linkProduto = linkProduto.trim() || null

      const res = await fetch(`/api/produtos/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const dados = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: 'Não consegui salvar', description: dados.error ?? 'Tente de novo.', variant: 'destructive' })
        return
      }
      // Atualiza também os links dinâmicos se o link mudou
      if (linkProduto.trim() && linkProduto.trim() !== produto?.linkProduto) {
        const linksRes = await fetch('/api/links')
        const links = await linksRes.json().catch(() => [])
        const meus = Array.isArray(links) ? links.filter((l: { produtoId: string }) => l.produtoId === id) : []
        const r = await Promise.all(meus.map((l: { id: string }) =>
          fetch('/api/links', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: l.id, urlDestino: linkProduto.trim() }),
          })
        ))
        if (!linksRes.ok || r.some((x) => !x.ok))
          toast({ title: 'Produto salvo, mas alguns links não foram atualizados', description: 'Confira em Links Dinâmicos.', variant: 'destructive' })
      }
      toast({ title: 'Produto salvo!', variant: 'success' })
      router.push('/produtos')
    } catch {
      toast({ title: 'Sem conexão', description: 'Tente de novo.', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="card-stat animate-pulse h-48" />
  if (erroAoCarregar)
    return (
      <div className="card-stat max-w-2xl space-y-3">
        <p className="text-sm text-white">{erroAoCarregar}</p>
        <Button asChild variant="outline"><a href="/produtos">Voltar para Produtos</a></Button>
      </div>
    )

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white">{produto?.nome}</h2>
        <p className="text-sm text-muted-foreground">Adicione imagens do produto</p>
      </div>

      {/* Link de compra */}
      <div className="card-stat space-y-3">
        <label className="text-xs text-muted-foreground flex items-center gap-1">
          <LinkIcon className="w-3 h-3" /> Link de compra (Shopee, Amazon, etc.)
        </label>
        <input
          className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-white
            placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent"
          placeholder="https://shopee.com.br/..."
          value={linkProduto}
          onChange={e => setLinkProduto(e.target.value)}
        />
        {linkProduto && linkProduto !== produto?.linkProduto && (
          <p className="text-[10px] text-warning">⚠ Link alterado — todos os links rastreáveis serão atualizados ao salvar</p>
        )}
      </div>

      <div className="card-stat space-y-5">
        {/* Drop Zone */}
        <div>
          <label className="text-xs text-muted-foreground mb-2 block">
            Arraste imagens do seu computador (máx. 10)
          </label>
          <div {...getRootProps()} className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors
            ${isDragActive ? 'border-accent bg-accent/5' : 'border-border hover:border-accent/50'}`}>
            <input {...getInputProps()} />
            <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            {isDragActive
              ? <p className="text-sm text-accent">Solte as imagens aqui...</p>
              : <p className="text-sm text-muted-foreground">Arraste imagens ou clique para selecionar</p>
            }
            <p className="text-xs text-muted-foreground mt-1">JPG, PNG, WEBP — até 10MB cada</p>
            <p className="text-xs text-accent mt-1">Você também pode colar com Ctrl+V</p>
          </div>
          {uploading && (
            <div className="flex items-center gap-2 mt-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Enviando...
            </div>
          )}
        </div>

        {/* Vídeos */}
        <div>
          <label className="text-xs text-muted-foreground mb-2 block flex items-center gap-1">
            <Film className="w-3 h-3" /> Vídeos (máx. {MAX_VIDEOS})
          </label>
          <div {...vid.getRootProps()} className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors
            ${vid.isDragActive ? 'border-accent bg-accent/5' : 'border-border hover:border-accent/50'}`}>
            <input {...vid.getInputProps()} />
            <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            {vid.isDragActive
              ? <p className="text-sm text-accent">Solte os vídeos aqui...</p>
              : <p className="text-sm text-muted-foreground">Arraste vídeos ou clique para selecionar</p>
            }
            <p className="text-xs text-muted-foreground mt-1">MP4, MOV, WEBM — até 500MB cada</p>
            <p className="text-xs text-accent mt-1">Você também pode colar com Ctrl+V</p>
          </div>
          {videos.length > 0 && (
            <div className="flex flex-col gap-2 mt-3">
              {videos.map((url, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border border-border p-2">
                  <Film className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="text-xs text-muted-foreground flex-1 truncate">{url}</span>
                  <button
                    onClick={() => setVideos((prev) => prev.filter((_, j) => j !== i))}
                    title="Remover vídeo"
                  >
                    <X className="w-4 h-4 text-danger" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* URL Input */}
        <div>
          <label className="text-xs text-muted-foreground mb-2 block flex items-center gap-1">
            <LinkIcon className="w-3 h-3" /> Ou cole uma URL de imagem
          </label>
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent"
              placeholder="https://..."
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && adicionarUrl()}
            />
            <Button variant="outline" onClick={adicionarUrl}>Adicionar</Button>
          </div>
        </div>

        {/* Preview */}
        {imagens.length > 0 ? (
          <div>
            <label className="text-xs text-muted-foreground mb-2 block">
              <ImageIcon className="w-3 h-3 inline mr-1" />{imagens.length} imagem(ns)
            </label>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {imagens.map((url, i) => (
                <div key={i} className="relative aspect-square rounded-xl overflow-hidden border border-border group">
                  <img src={url} alt="" className="w-full h-full object-cover" />
                  <button
                    onClick={() => setImagens((prev) => prev.filter((_, j) => j !== i))}
                    className="absolute top-1 right-1 bg-danger rounded-full w-5 h-5 flex items-center justify-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-3 h-3 text-white" />
                  </button>
                  {i === 0 && (
                    <span className="absolute bottom-1 left-1 bg-accent text-primary-dark text-[10px] font-bold px-1.5 py-0.5 rounded">
                      CAPA
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <div className="text-center">
              <ImageIcon className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Nenhuma imagem adicionada</p>
            </div>
          </div>
        )}

        <div className="flex justify-between pt-4 border-t border-border">
          <Button variant="outline" onClick={() => router.push('/produtos')}>Cancelar</Button>
          <Button onClick={salvar} disabled={saving || uploading}>
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" />Salvando...</> : <><Save className="w-4 h-4" />Salvar Imagens</>}
          </Button>
        </div>
      </div>
    </div>
  )
}
