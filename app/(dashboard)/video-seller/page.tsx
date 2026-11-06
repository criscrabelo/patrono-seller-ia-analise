'use client'

import { useState } from 'react'
import { Video, Loader2, Copy, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { copyToClipboard } from '@/lib/utils'
import type { VideoSellerOutput } from '@/types'
import { toast } from '@/hooks/use-toast'
import { useGuardModulo } from '@/hooks/useGuardModulo'
import { AvisoDeContingencia } from '@/components/shared/Ux'

const PLATAFORMAS = ['TikTok', 'Instagram Reels', 'YouTube Shorts', 'WhatsApp', 'Marketplace', 'Landing Page']
const DURACOES = [6, 10, 15, 20, 30, 60]
const OBJETIVOS = ['Venda', 'Apresentar', 'Gerar curiosidade', 'Demonstrar uso', 'Comparar']
const ESTILOS = ['Orientado à retenção', 'Premium / Luxuoso', 'Popular', 'Clean', 'Institucional', 'Emocional', 'Direto para venda']
const COMANDOS = [
  { key: 'anuncio', label: 'Versão Anúncio' },
  { key: 'premium', label: 'Versão Premium' },
  { key: 'viral', label: 'Versão retenção' },
  { key: 'marketplace', label: 'Versão Marketplace' },
  { key: 'lifestyle', label: 'Versão Lifestyle' },
]

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  async function handle() {
    await copyToClipboard(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button onClick={handle} className="copy-btn">
      {copied ? <Check className="w-3.5 h-3.5 text-accent" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? 'Copiado!' : 'Copiar'}
    </button>
  )
}

export default function VideoSellerPage() {
  useGuardModulo('video-seller')
  const [form, setForm] = useState({
    nome: '',
    descricao: '',
    publicoAlvo: '',
    plataforma: 'TikTok',
    duracao: 30,
    objetivo: 'Venda',
    estilo: 'Orientado à retenção',
    comando: '',
  })
  const [gerando, setGerando] = useState(false)
  const [output, setOutput] = useState<VideoSellerOutput | null>(null)

  function set(k: string, v: unknown) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  async function gerar(comandoOverride?: string) {
    if (!form.nome) {
      toast({ title: 'Informe o nome do produto', variant: 'destructive' })
      return
    }
    setGerando(true)
    setOutput(null)

    try {
      const res = await fetch('/api/video-seller', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, comando: comandoOverride || form.comando }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: 'Não foi possível gerar', description: data.error ?? 'Tente novamente.', variant: 'destructive' })
        return
      }
      setOutput(data)
    } catch {
      toast({ title: 'Sem conexão', description: 'Tente novamente.', variant: 'destructive' })
    } finally {
      setGerando(false)
    }
  }

  const inputClass = `w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm
    text-white placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent`

  return (
    <div className="space-y-6 max-w-5xl">
      {/* P2.17.13: ferramenta secundária/legado — não é o motor do Patrono e não cria arquivo de vídeo. */}
      <AvisoDeContingencia titulo="Ferramenta legada">Gera roteiro e prompt a partir de um texto; não cria o arquivo de vídeo, não usa o catálogo e não salva no Banco. Depende de IA paga (hoje desligada). Os vídeos de verdade o Patrono gera em Conteúdo.</AvisoDeContingencia>
      {/* Formulário */}
      <div className="card-stat space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-accent/10 border border-accent/30 flex items-center justify-center">
            <Video className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h2 className="font-semibold text-white">Patrono Video Seller</h2>
            <p className="text-xs text-muted-foreground">Transforme produto em roteiro e prompt de vídeo profissional</p>
          </div>
        </div>

        {/* Comandos rápidos */}
        <div>
          <label className="text-xs text-muted-foreground mb-2 block">Comandos Rápidos</label>
          <div className="flex flex-wrap gap-2">
            {COMANDOS.map(({ key, label }) => (
              <button key={key}
                onClick={() => gerar(key)}
                disabled={gerando || !form.nome}
                className="px-3 py-1.5 rounded-full text-xs border border-border text-muted-foreground
                           hover:border-accent/50 hover:text-accent transition-colors disabled:opacity-40">
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="border-t border-border pt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="text-xs text-muted-foreground mb-1.5 block">Nome do Produto *</label>
            <input className={inputClass} placeholder="Ex: Fone Bluetooth Premium"
              value={form.nome} onChange={(e) => set('nome', e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs text-muted-foreground mb-1.5 block">Descrição (opcional)</label>
            <textarea className={`${inputClass} resize-none`} rows={2}
              placeholder="Descreva o produto, seus benefícios, diferenciais..."
              value={form.descricao} onChange={(e) => set('descricao', e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Público-alvo</label>
            <input className={inputClass} placeholder="Ex: Mulheres de 25-40 anos"
              value={form.publicoAlvo} onChange={(e) => set('publicoAlvo', e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Plataforma</label>
            <select className={inputClass} value={form.plataforma}
              onChange={(e) => set('plataforma', e.target.value)}>
              {PLATAFORMAS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Duração (segundos)</label>
            <select className={inputClass} value={form.duracao}
              onChange={(e) => set('duracao', Number(e.target.value))}>
              {DURACOES.map((d) => <option key={d} value={d}>{d}s</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Objetivo</label>
            <select className={inputClass} value={form.objetivo}
              onChange={(e) => set('objetivo', e.target.value)}>
              {OBJETIVOS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs text-muted-foreground mb-1.5 block">Estilo</label>
            <select className={inputClass} value={form.estilo}
              onChange={(e) => set('estilo', e.target.value)}>
              {ESTILOS.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>
        </div>

        <Button onClick={() => gerar()} disabled={gerando || !form.nome} className="w-full" size="lg">
          {gerando
            ? <><Loader2 className="w-4 h-4 animate-spin" />Criando roteiro e prompt...</>
            : <><Video className="w-4 h-4" />Gerar roteiro e prompt</>}
        </Button>
      </div>

      {/* Loading */}
      {gerando && (
        <div className="card-stat flex flex-col items-center justify-center py-14 text-center gap-4">
          <Loader2 className="w-8 h-8 text-accent animate-spin" />
          <p className="text-white font-semibold">Analisando produto e criando roteiro profissional...</p>
        </div>
      )}

      {/* Output */}
      {output && !gerando && (
        <div className="space-y-4">
          {/* Análise */}
          <div className="card-stat">
            <h3 className="font-semibold text-white mb-3">Análise do Produto</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Tipo</p>
                <p className="text-white">{output.analiseProduto.tipo}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Público-alvo</p>
                <p className="text-white">{output.analiseProduto.publicoAlvo}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Melhor formato</p>
                <p className="text-white">{output.analiseProduto.melhorFormato}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Diferenciais</p>
                <ul className="text-white space-y-0.5">
                  {(output.analiseProduto?.diferenciais ?? []).map((d, i) => <li key={i}>• {d}</li>)}
                </ul>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-border grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-muted-foreground">Ideia central</p>
                <p className="text-sm text-white mt-1">{output.ideaCentral}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Objetivo do vídeo</p>
                <p className="text-sm text-white mt-1">{output.objetivoVideo}</p>
              </div>
            </div>
          </div>

          {/* Roteiro */}
          <div className="card-stat">
            <h3 className="font-semibold text-white mb-3">Roteiro Cena a Cena</h3>
            <div className="space-y-2">
              {(output.roteiro ?? []).map((cena) => (
                <div key={cena.cena} className="rounded-lg bg-background border border-border p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-6 h-6 rounded-full bg-accent/20 text-accent text-xs font-bold flex items-center justify-center">
                      {cena.cena}
                    </span>
                    <span className="text-xs text-muted-foreground">{cena.inicio} → {cena.fim}</span>
                    <span className="text-xs text-accent ml-auto">{cena.objetivo}</span>
                  </div>
                  <p className="text-xs text-white mb-1"><span className="text-muted-foreground">Visual: </span>{cena.descricaoVisual}</p>
                  <p className="text-xs text-white mb-1"><span className="text-muted-foreground">Movimento: </span>{cena.movimento}</p>
                  {cena.textoTela && <p className="text-xs text-accent"><span className="text-muted-foreground">Tela: </span>{cena.textoTela}</p>}
                  {cena.som && <p className="text-xs text-muted-foreground mt-1">🎵 {cena.som}</p>}
                </div>
              ))}
            </div>
          </div>

          {/* Prompt Completo */}
          <div className="card-stat">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-white">Prompt de Vídeo IA</h3>
              <CopyBtn text={output.promptCompleto} />
            </div>
            <div className="rounded-xl border border-accent/30 bg-background p-4 text-sm text-foreground whitespace-pre-wrap font-mono">
              {output.promptCompleto}
            </div>
            <div className="flex items-center justify-between mt-4 mb-2">
              <h3 className="font-semibold text-white text-sm">Versão Curta</h3>
              <CopyBtn text={output.promptCurto} />
            </div>
            <div className="rounded-lg border border-border bg-background p-3 text-sm text-foreground font-mono">
              {output.promptCurto}
            </div>
            <p className="text-xs text-muted-foreground mt-2">✅ Compatível com: Runway, Kling, Pika, Veo</p>
          </div>

          {/* Narração e Extras */}
          <div className="card-stat space-y-4">
            {output.narracao && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-white text-sm">Narração</h3>
                  <CopyBtn text={output.narracao} />
                </div>
                <div className="rounded-lg bg-background border border-border p-3 text-sm text-foreground whitespace-pre-wrap">
                  {output.narracao}
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Estilo Visual</p>
                <p className="text-white">{output.estiloVisual}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Sugestão de Música</p>
                <p className="text-white">{output.sugestaoMusica}</p>
              </div>
            </div>
          </div>

          {/* Legenda e Hashtags */}
          <div className="card-stat space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-white text-sm">CTA Final</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {(output.ctaFinal ?? []).map((cta, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
                    <span className="text-sm text-white">{cta}</span>
                    <CopyBtn text={cta} />
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-white text-sm">Hashtags</h3>
                <CopyBtn text={output.hashtagsSugeridas.join(' ')} />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(output.hashtagsSugeridas ?? []).map((h) => (
                  <span key={h} className="px-2 py-1 rounded-full bg-secondary text-xs text-accent">{h}</span>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Título sugerido</p>
              <div className="flex items-center gap-2">
                <p className="text-sm text-white">{output.tituloSugerido}</p>
                <CopyBtn text={output.tituloSugerido} />
              </div>
            </div>
          </div>

          {/* Variações A/B */}
          {output.variacoesTeste?.length > 0 && (
            <div className="card-stat">
              <h3 className="font-semibold text-white mb-3">Variações para Teste A/B</h3>
              <div className="space-y-3">
                {(output.variacoesTeste ?? []).map((v, i) => (
                  <div key={i} className="rounded-lg bg-background border border-border p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-5 h-5 rounded-full bg-accent/20 text-accent text-xs font-bold flex items-center justify-center">
                        {v.versao}
                      </span>
                      <span className="text-sm font-medium text-white">{v.descricao}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{v.diferencial}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
