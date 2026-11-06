'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useDropzone } from 'react-dropzone'
import { Plus, X, Upload, Loader2, ChevronRight, ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  CATEGORIAS, TIPOS_VENDA, ORIGENS_CONTEUDO, PUBLICOS_ALVO,
} from '@/types'
import { toast } from '@/hooks/use-toast'
import { useGuardModulo } from '@/hooks/useGuardModulo'
import { useColarArquivos } from '@/hooks/useColarArquivos'
import { enviarMidia } from '@/lib/upload-midia'

export default function NovoProdutoPage() {
  useGuardModulo('produtos')
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

  const [form, setForm] = useState({
    nome: '',
    categoria: '',
    preco: '',
    linkProduto: '',
    descricao: '',
    publicoAlvo: [] as string[],
    tipoVenda: '',
    origemConteudo: '',
    observacoes: '',
    beneficios: ['', '', ''],
    pontosNegativos: ['', ''],
    imagens: [] as string[],
    videos: [] as string[],
  })

  function set(key: string, val: unknown) {
    setForm((f) => ({ ...f, [key]: val }))
  }

  function togglePublico(p: string) {
    setForm((f) => ({
      ...f,
      publicoAlvo: f.publicoAlvo.includes(p)
        ? f.publicoAlvo.filter((x) => x !== p)
        : [...f.publicoAlvo, p],
    }))
  }

  // Upload direto do navegador → Supabase (a rota /api/upload passaria pela
  // Vercel, que corta requisições acima de 4,5 MB e barraria os vídeos).
  const enviarLista = useCallback(async (arquivos: File[]) => {
    const urls: string[] = []
    for (const file of arquivos) {
      try {
        urls.push(await enviarMidia(file, 'novos'))
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Falha no upload'
        toast({ title: `Erro em ${file.name}`, description: msg, variant: 'destructive' })
      }
    }
    return urls
  }, [])

  const onDropImages = useCallback(async (files: File[]) => {
    setUploading(true)
    const urls = await enviarLista(files.slice(0, 10 - form.imagens.length))
    if (urls.length) setForm((f) => ({ ...f, imagens: [...f.imagens, ...urls] }))
    setUploading(false)
  }, [form.imagens, enviarLista])

  const onDropVideos = useCallback(async (files: File[]) => {
    setUploading(true)
    const urls = await enviarLista(files.slice(0, 5 - form.videos.length))
    if (urls.length) setForm((f) => ({ ...f, videos: [...f.videos, ...urls] }))
    setUploading(false)
  }, [form.videos, enviarLista])

  const { getRootProps: imgProps, getInputProps: imgInput } = useDropzone({
    onDrop: onDropImages, accept: { 'image/*': [] }, maxFiles: 10,
  })
  const { getRootProps: vidProps, getInputProps: vidInput } = useDropzone({
    onDrop: onDropVideos, accept: { 'video/*': [] }, maxFiles: 5,
  })

  // Ctrl+V / Cmd+V cola imagens e vídeos, roteando cada um para a sua lista.
  const colarArquivos = useCallback((files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith('image/'))
    const vids = files.filter((f) => f.type.startsWith('video/'))
    if (imgs.length) onDropImages(imgs)
    if (vids.length) onDropVideos(vids)
  }, [onDropImages, onDropVideos])

  useColarArquivos(colarArquivos)

  async function salvar() {
    if (!form.tipoVenda || !form.origemConteudo) {
      toast({ title: 'Preencha o tipo de venda e origem do conteúdo', variant: 'destructive' })
      setStep(2)
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/produtos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          preco: form.preco !== '' ? Number(form.preco) : undefined,
          beneficios: form.beneficios.filter(Boolean),
          pontosNegativos: form.pontosNegativos.filter(Boolean),
          linkProduto: form.linkProduto || undefined,
        }),
      })
      const dados = await res.json().catch(() => ({}))
      if (!res.ok) {
        const linkRuim = form.linkProduto && !/^https?:\/\//i.test(form.linkProduto)
        toast({ title: 'Não consegui salvar o produto', description: linkRuim ? 'O link precisa ser um endereço completo, começando com https://' : dados.error ?? 'Confira os campos e tente de novo.', variant: 'destructive' })
        setSaving(false)
        return
      }
      toast({ title: 'Produto cadastrado!', variant: 'success' })
      router.push(`/conteudos/gerar?produtoId=${dados.id}`)
    } catch {
      toast({ title: 'Sem conexão', description: 'Nada foi salvo. Tente de novo.', variant: 'destructive' })
      setSaving(false)
    }
  }

  const inputClass = `w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm
    text-white placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent`

  return (
    <div className="w-full max-w-2xl space-y-6">
      {/* Progress */}
      <div className="flex items-center gap-2">
        {[1, 2, 3].map((s) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold
              ${step >= s ? 'bg-accent text-primary-dark' : 'bg-secondary text-muted-foreground'}`}>
              {s}
            </div>
            {s < 3 && <div className={`h-px w-12 ${step > s ? 'bg-accent' : 'bg-border'}`} />}
          </div>
        ))}
        <span className="text-xs text-muted-foreground ml-2">
          {step === 1 ? 'Informações básicas' : step === 2 ? 'Detalhes comerciais' : 'Mídia'}
        </span>
      </div>

      <div className="card-stat space-y-5">
        {/* PASSO 1 */}
        {step === 1 && (
          <>
            <h2 className="font-semibold text-white">Informações do Produto</h2>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Nome *</label>
                <input className={inputClass} placeholder="Ex: Power Bank 20000mAh"
                  value={form.nome} onChange={(e) => set('nome', e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Categoria *</label>
                <select className={inputClass} value={form.categoria}
                  onChange={(e) => set('categoria', e.target.value)}>
                  <option value="">Selecionar...</option>
                  {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Link do produto</label>
                <input className={inputClass} placeholder="https://..." type="url"
                  value={form.linkProduto} onChange={(e) => set('linkProduto', e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Descrição resumida</label>
                <textarea className={`${inputClass} resize-none`} rows={3}
                  placeholder="Descreva brevemente o produto..."
                  value={form.descricao} onChange={(e) => set('descricao', e.target.value)} />
              </div>
            </div>
          </>
        )}

        {/* PASSO 2 */}
        {step === 2 && (
          <>
            <h2 className="font-semibold text-white">Detalhes Comerciais</h2>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-muted-foreground mb-2 block">Público-alvo</label>
                <div className="flex flex-wrap gap-2">
                  {PUBLICOS_ALVO.map((p) => (
                    <button key={p} type="button"
                      onClick={() => togglePublico(p)}
                      className={`px-3 py-1.5 rounded-full text-xs border transition-colors
                        ${form.publicoAlvo.includes(p)
                          ? 'bg-accent text-primary-dark border-accent'
                          : 'border-border text-muted-foreground hover:border-accent/50'}`}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Tipo de venda *</label>
                  <select className={inputClass} value={form.tipoVenda}
                    onChange={(e) => set('tipoVenda', e.target.value)}>
                    <option value="">Selecionar...</option>
                    {TIPOS_VENDA.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Origem do conteúdo *</label>
                  <select className={inputClass} value={form.origemConteudo}
                    onChange={(e) => set('origemConteudo', e.target.value)}>
                    <option value="">Selecionar...</option>
                    {ORIGENS_CONTEUDO.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Benefícios principais</label>
                {form.beneficios.map((b, i) => (
                  <input key={i} className={`${inputClass} mb-2`}
                    placeholder={`Benefício ${i + 1}`}
                    value={b} onChange={(e) => {
                      const arr = [...form.beneficios]
                      arr[i] = e.target.value
                      set('beneficios', arr)
                    }} />
                ))}
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Pontos negativos</label>
                {form.pontosNegativos.map((n, i) => (
                  <input key={i} className={`${inputClass} mb-2`}
                    placeholder={`Ponto negativo ${i + 1}`}
                    value={n} onChange={(e) => {
                      const arr = [...form.pontosNegativos]
                      arr[i] = e.target.value
                      set('pontosNegativos', arr)
                    }} />
                ))}
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Observações pessoais</label>
                <textarea className={`${inputClass} resize-none`} rows={3}
                  placeholder="O que achou do produto? Qualidade, experiência..."
                  value={form.observacoes} onChange={(e) => set('observacoes', e.target.value)} />
              </div>
            </div>
          </>
        )}

        {/* PASSO 3 */}
        {step === 3 && (
          <>
            <h2 className="font-semibold text-white">Mídia do Produto</h2>
            <div className="space-y-5">
              <div>
                <label className="text-xs text-muted-foreground mb-2 block">
                  Imagens (máx. 10, 10MB cada)
                </label>
                <div {...imgProps()} className="border-2 border-dashed border-border rounded-xl p-6
                  text-center cursor-pointer hover:border-accent/50 transition-colors">
                  <input {...imgInput()} />
                  <Upload className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">Arraste imagens ou clique para selecionar</p>
                  <p className="text-xs text-accent mt-1">Ou cole com Ctrl+V</p>
                </div>
                {form.imagens.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {form.imagens.map((url, i) => (
                      <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-border">
                        <img src={url} alt="" className="w-full h-full object-cover" />
                        <button onClick={() => setForm((f) => ({ ...f, imagens: f.imagens.filter((_, j) => j !== i) }))}
                          className="absolute top-0.5 right-0.5 bg-danger rounded-full w-4 h-4 flex items-center justify-center">
                          <X className="w-2.5 h-2.5 text-white" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-2 block">
                  Vídeos (máx. 5, 500MB cada)
                </label>
                <div {...vidProps()} className="border-2 border-dashed border-border rounded-xl p-6
                  text-center cursor-pointer hover:border-accent/50 transition-colors">
                  <input {...vidInput()} />
                  <Upload className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">Arraste vídeos ou clique para selecionar</p>
                  <p className="text-xs text-accent mt-1">Ou cole com Ctrl+V</p>
                </div>
                {form.videos.length > 0 && (
                  <div className="flex flex-col gap-2 mt-3">
                    {form.videos.map((url, i) => (
                      <div key={i} className="flex items-center gap-2 rounded-lg border border-border p-2">
                        <span className="text-xs text-muted-foreground flex-1 truncate">{url}</span>
                        <button onClick={() => setForm((f) => ({ ...f, videos: f.videos.filter((_, j) => j !== i) }))}>
                          <X className="w-4 h-4 text-danger" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {uploading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Enviando arquivo...
                </div>
              )}
            </div>
          </>
        )}

        {/* Navegação */}
        <div className="flex justify-between pt-4 border-t border-border">
          <Button variant="outline" onClick={() => setStep((s) => s - 1)} disabled={step === 1}>
            <ChevronLeft className="w-4 h-4" /> Anterior
          </Button>
          {step < 3 ? (
            <Button onClick={() => setStep((s) => s + 1)}
              disabled={step === 1 && (!form.nome || !form.categoria)}>
              Próximo <ChevronRight className="w-4 h-4" />
            </Button>
          ) : (
            <Button onClick={salvar} disabled={saving || uploading}>
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" />Salvando...</> : <><Plus className="w-4 h-4" />Salvar Produto</>}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
