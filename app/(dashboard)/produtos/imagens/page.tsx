'use client'

import { useEffect, useState } from 'react'
import { ExternalLink, Check, Loader2, Image as ImageIcon, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'
import { useGuardModulo } from '@/hooks/useGuardModulo'
import { AvisoDeContingencia } from '@/components/shared/Ux'

interface Produto {
  id: string
  nome: string
  linkProduto: string | null
  imagens: string[]
  preco: number
}

export default function ImportarImagensPage() {
  useGuardModulo('produtos-imagens')
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [loading, setLoading] = useState(true)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [salvando, setSalvando] = useState<string | null>(null)
  const [salvos, setSalvos] = useState<Record<string, boolean>>({})

  const [totalDeProdutos, setTotalDeProdutos] = useState(0)
  const [erro, setErro] = useState(false)

  useEffect(() => {
    fetch('/api/produtos')
      .then(async (r) => {
        const prods = await r.json().catch(() => null)
        if (!r.ok || !Array.isArray(prods)) { setErro(true); return }
        setTotalDeProdutos(prods.length)
        setProdutos(prods.filter((p: Produto) => p.linkProduto?.includes('shopee') && (p.imagens ?? []).length === 0))
      })
      .catch(() => setErro(true))
      .finally(() => setLoading(false))
  }, [])

  async function salvar(prod: Produto) {
    const url = urls[prod.id]?.trim()
    if (!url) { toast({ title: 'Cole a URL da imagem', variant: 'destructive' }); return }

    setSalvando(prod.id)
    try {
      const res = await fetch(`/api/produtos/${prod.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imagens: [url] }),
      })
      const dados = await res.json().catch(() => ({}))
      if (res.ok) {
        setSalvos(s => ({ ...s, [prod.id]: true }))
        setProdutos(p => p.filter(x => x.id !== prod.id))
        toast({ title: `✅ Imagem salva — ${prod.nome}`, variant: 'success' })
      } else {
        toast({ title: 'Não consegui salvar', description: dados.error ?? 'Confira se o endereço da imagem está completo (https://…).', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Sem conexão', description: 'Tente de novo.', variant: 'destructive' })
    } finally {
      setSalvando(null)
    }
  }

  if (loading) return (
    <div className="space-y-3 max-w-3xl">
      {[...Array(5)].map((_, i) => <div key={i} className="card-stat animate-pulse h-24" />)}
    </div>
  )

  if (erro) return (
    <div className="card-stat flex flex-col items-center justify-center py-16 text-center max-w-3xl gap-2">
      <p className="text-white font-semibold">Não consegui carregar os produtos.</p>
      <button onClick={() => location.reload()} className="text-sm underline text-muted-foreground hover:text-white">Tentar de novo</button>
    </div>
  )

  if (produtos.length === 0) return (
    <div className="card-stat flex flex-col items-center justify-center py-20 text-center max-w-3xl">
      <Check className="w-12 h-12 text-accent mb-3" />
      {totalDeProdutos === 0 ? (
        <>
          <p className="text-white font-semibold">Nenhum produto cadastrado ainda.</p>
          <a href="/produtos/novo" className="mt-2 text-sm underline text-muted-foreground hover:text-white">Cadastrar o primeiro produto</a>
        </>
      ) : (
        <p className="text-white font-semibold">Nenhum produto da Shopee está sem imagem.</p>
      )}
    </div>
  )

  return (
    <div className="space-y-6 max-w-3xl">
      {/* P2.17.13: não é o fluxo normal — o Patrono busca a imagem sozinho quando há fonte oficial/autorizada. */}
      <AvisoDeContingencia titulo="Modo manual de contingência">Use só quando a fonte oficial não trouxer a imagem. A foto do anúncio serve para identificar o produto no catálogo; ela é mídia de terceiro e não vira vídeo.</AvisoDeContingencia>
      <div>
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <ImageIcon className="w-5 h-5 text-accent" /> Importar Imagens da Shopee
        </h2>
        <p className="text-sm text-muted-foreground">
          {produtos.length} produtos sem imagem · Abra cada produto, clique com o botão direito na imagem → <strong className="text-white">Copiar endereço da imagem</strong> → Cole aqui
        </p>
      </div>

      {/* Instrução rápida */}
      <div className="rounded-xl border border-accent/20 bg-accent/5 px-4 py-3 text-xs text-muted-foreground space-y-1">
        <p className="text-white font-medium">Como fazer em 3 passos:</p>
        <p>1. Clique em <span className="text-accent">Abrir Shopee</span> — o produto abre numa nova aba</p>
        <p>2. Clique com o botão direito na foto principal → <span className="text-accent">Copiar endereço da imagem</span></p>
        <p>3. Cole no campo abaixo e clique <span className="text-accent">Salvar</span></p>
      </div>

      <div className="space-y-3">
        {produtos.map(prod => {
          const url = urls[prod.id] ?? ''
          const isSalvando = salvando === prod.id

          return (
            <div key={prod.id} className="card-stat space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium text-white text-sm leading-tight">{prod.nome}</p>
                <a
                  href={prod.linkProduto!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-500/10 border border-orange-500/30
                    text-orange-400 text-xs font-medium hover:bg-orange-500/20 transition-colors"
                >
                  <ExternalLink className="w-3 h-3" /> Abrir Shopee
                </a>
              </div>

              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <input
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-white
                      placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent pr-8"
                    placeholder="Cole aqui a URL da imagem (https://down-br.img.susercontent.com/...)"
                    value={url}
                    onChange={e => setUrls(u => ({ ...u, [prod.id]: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && salvar(prod)}
                  />
                  {url && (
                    <button
                      onClick={() => setUrls(u => ({ ...u, [prod.id]: '' }))}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <Button size="sm" onClick={() => salvar(prod)} disabled={isSalvando || !url}>
                  {isSalvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  Salvar
                </Button>
              </div>

              {/* Preview da imagem */}
              {url && url.startsWith('http') && (
                <div className="flex gap-3 items-center">
                  <img
                    src={url}
                    alt={prod.nome}
                    className="w-16 h-16 rounded-lg object-cover border border-border"
                    onError={e => (e.currentTarget.style.display = 'none')}
                  />
                  <p className="text-xs text-muted-foreground">Preview da imagem</p>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
