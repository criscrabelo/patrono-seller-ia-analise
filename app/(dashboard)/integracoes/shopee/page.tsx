'use client'

import { useEffect, useState } from 'react'
import {
  CheckCircle, XCircle, Loader2, RefreshCw, Link2, ShoppingBag,
  AlertCircle, ExternalLink, ArrowLeft, Zap, Info, Copy, Check,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import { useGuardModulo } from '@/hooks/useGuardModulo'

type Modo = 'afiliado' | 'vendedor'

interface Config {
  status: string
  accountName?: string
  accountId?: string
  extraData?: { modo?: string; partnerId?: string; subId?: string }
  updatedAt?: string
}

interface ResultadoLinks {
  criados: number
  jaExistiam: number
  total: number
  naoVerificados?: number
  aviso?: string
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }}
      className="p-1 rounded hover:bg-white/10 transition-colors"
    >
      {copied
        ? <Check className="w-3.5 h-3.5 text-accent" />
        : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
    </button>
  )
}

export default function ShopeeIntegracaoPage() {
  useGuardModulo('integracoes')
  const [config, setConfig] = useState<Config | null>(null)
  const [loading, setLoading] = useState(true)
  const [modo, setModo] = useState<Modo>('afiliado')
  const [saving, setSaving] = useState(false)
  const [gerandoLinks, setGerandoLinks] = useState(false)
  const [resultado, setResultado] = useState<ResultadoLinks | null>(null)

  // Campos afiliado
  const [nomeLoja, setNomeLoja] = useState('')
  const [subId, setSubId] = useState('')

  // Campos vendedor
  const [shopId, setShopId] = useState('')
  const [partnerId, setPartnerId] = useState('')
  const [partnerKey, setPartnerKey] = useState('')
  const [accessToken, setAccessToken] = useState('')

  async function fetchConfig() {
    try {
      const res = await fetch('/api/integracoes/shopee')
      if (res.ok) {
        const data = await res.json().catch(() => null)
        setConfig(data)
        if (data?.extraData?.modo) setModo(data.extraData.modo as Modo)
      } else toast({ title: 'Não consegui carregar a configuração da Shopee', variant: 'destructive' })
    } catch {
      toast({ title: 'Sem conexão', description: 'Atualize a página.', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchConfig() }, [])

  const conectado = config?.status === 'conectado'

  async function salvar() {
    setSaving(true)
    const body: Record<string, string> = { modo }

    if (modo === 'afiliado') {
      if (!nomeLoja) { toast({ title: 'Informe o nome da sua conta Shopee', variant: 'destructive' }); setSaving(false); return }
      body.nomeLoja = nomeLoja
      body.subId = subId
    } else {
      if (!shopId || !partnerId || !partnerKey || !accessToken) {
        toast({ title: 'Preencha todos os campos de vendedor', variant: 'destructive' })
        setSaving(false); return
      }
      body.shopId = shopId
      body.partnerId = partnerId
      body.partnerKey = partnerKey
      body.accessToken = accessToken
      body.nomeLoja = nomeLoja || `Loja ${shopId}`
    }

    const res = await fetch('/api/integracoes/shopee', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (res.ok) {
      toast({ title: '🛍️ Shopee conectada com sucesso!', variant: 'success' })
      fetchConfig()
    } else {
      const err = await res.json()
      toast({ title: err.error || 'Erro ao conectar', variant: 'destructive' })
    }
    setSaving(false)
  }

  async function desconectar() {
    if (!confirm('Desconectar a Shopee?')) return
    const res = await fetch('/api/integracoes/shopee', { method: 'DELETE' }).catch(() => null)
    if (!res?.ok) {
      toast({ title: 'Não consegui desconectar a Shopee', description: 'Nada foi alterado. Tente de novo.', variant: 'destructive' })
      return
    }
    toast({ title: 'Shopee desconectada' })
    setConfig(null)
    setResultado(null)
  }

  async function gerarLinks() {
    setGerandoLinks(true)
    setResultado(null)
    const res = await fetch('/api/integracoes/shopee/sincronizar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acao: 'gerar_links' }),
    })
    const data = await res.json()
    if (res.ok) {
      setResultado(data)
      toast({ title: `✅ ${data.criados} links criados!`, variant: 'success' })
    } else {
      toast({ title: data.error || 'Erro ao gerar links', variant: 'destructive' })
    }
    setGerandoLinks(false)
  }

  const inputCls = `w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm
    text-white placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent`

  if (loading) return (
    <div className="space-y-4 max-w-3xl">
      {[...Array(3)].map((_, i) => <div key={i} className="card-stat animate-pulse h-24" />)}
    </div>
  )

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2">
        <Link href="/integracoes" className="text-muted-foreground hover:text-white transition-colors flex items-center gap-1 text-sm">
          <ArrowLeft className="w-3.5 h-3.5" /> Integrações
        </Link>
        <span className="text-muted-foreground/50">/</span>
        <span className="text-white text-sm font-medium">🛍️ Shopee</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center text-2xl shadow-lg">
            🛍️
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Integração Shopee</h2>
            <div className="flex items-center gap-2 mt-1">
              {conectado ? (
                <>
                  <CheckCircle className="w-4 h-4 text-accent" />
                  <span className="text-sm text-accent font-medium">
                    Conectada{config?.accountName ? ` · ${config.accountName}` : ''}
                  </span>
                </>
              ) : (
                <>
                  <XCircle className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Não conectada</span>
                </>
              )}
            </div>
          </div>
        </div>
        {conectado && (
          <Button variant="destructive" size="sm" onClick={desconectar}>
            <XCircle className="w-4 h-4" /> Desconectar
          </Button>
        )}
      </div>

      {/* Status conectada */}
      {conectado && (
        <div className="space-y-4">
          <div className="rounded-xl border border-accent/30 bg-accent/5 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-accent" />
              <span className="font-semibold text-white">Shopee conectada</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground text-xs mb-1">Modo</p>
                <p className="text-white font-medium capitalize">{config?.extraData?.modo ?? '—'}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs mb-1">Conta / Loja</p>
                <p className="text-white font-medium">{config?.accountName ?? '—'}</p>
              </div>
              {config?.extraData?.subId && (
                <div className="sm:col-span-2">
                  <p className="text-muted-foreground text-xs mb-1">Sub ID (rastreamento)</p>
                  <div className="flex items-center gap-2">
                    <code className="text-accent text-xs font-mono">{config.extraData.subId}</code>
                    <CopyBtn text={config.extraData.subId} />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Ação principal: gerar links */}
          <div className="card-stat space-y-4">
            <div>
              <h3 className="font-semibold text-white flex items-center gap-2">
                <Link2 className="w-4 h-4 text-accent" /> Gerar Links Rastreáveis
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                Cria links rastreáveis <code className="text-accent">/api/l/slug</code>, no domínio do Patrono, para todos os seus produtos Shopee cadastrados.
                Cada clique é rastreado no dashboard de monetização.
              </p>
            </div>

            {resultado && (
              <div className="rounded-lg bg-accent/10 border border-accent/20 p-4 grid grid-cols-3 sm:grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-2xl font-bold text-accent">{resultado.criados}</p>
                  <p className="text-xs text-muted-foreground">Links criados</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-white">{resultado.jaExistiam}</p>
                  <p className="text-xs text-muted-foreground">Já existiam</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-white">{resultado.total}</p>
                  <p className="text-xs text-muted-foreground">Produtos Shopee</p>
                </div>
              </div>
            )}
            {resultado?.aviso && (
              <p className="text-xs text-amber-300 rounded-lg bg-amber-500/10 border border-amber-500/20 p-3">{resultado.aviso}</p>
            )}

            <div className="flex gap-3">
              <Button onClick={gerarLinks} disabled={gerandoLinks} className="flex-1">
                {gerandoLinks
                  ? <><Loader2 className="w-4 h-4 animate-spin" />Gerando...</>
                  : <><Zap className="w-4 h-4" />Gerar Links para Todos os Produtos</>
                }
              </Button>
              <Button variant="outline" asChild>
                <Link href="/links"><Link2 className="w-4 h-4" />Ver Links</Link>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Formulário de configuração */}
      {!conectado && (
        <div className="space-y-5">
          {/* Seleção de modo */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(['afiliado', 'vendedor'] as Modo[]).map((m) => (
              <button
                key={m}
                onClick={() => setModo(m)}
                className={cn(
                  'rounded-xl border p-4 text-left transition-colors',
                  modo === m
                    ? 'border-accent bg-accent/10 text-white'
                    : 'border-border text-muted-foreground hover:border-accent/40'
                )}
              >
                <div className="font-semibold capitalize text-sm mb-1">
                  {m === 'afiliado' ? '🔗 Afiliado' : '🏪 Vendedor'}
                </div>
                <p className="text-xs opacity-70">
                  {m === 'afiliado'
                    ? 'Você divulga produtos e ganha comissão. Use o portal affiliate.shopee.com.br'
                    : 'Você tem uma loja na Shopee. Requer acesso à Shopee Open Platform'}
                </p>
              </button>
            ))}
          </div>

          {/* Campos modo afiliado */}
          {modo === 'afiliado' && (
            <div className="card-stat space-y-5">
              <div className="flex gap-3 rounded-lg bg-blue-500/10 border border-blue-500/20 p-3">
                <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                <div className="text-xs text-blue-300">
                  <p className="font-medium mb-1">Como funciona o modo Afiliado</p>
                  <p>Cada produto Shopee que você divulga gera um link rastreável no Patrono. A comissão só é atribuída quando o produto usa o link gerado no portal de afiliados (s.shopee.com.br); link da página do produto fica marcado como “não verificado”.</p>
                </div>
              </div>

              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Nome da conta Shopee *</label>
                <input className={inputCls} placeholder="@nomeDaSuaConta" value={nomeLoja}
                  onChange={e => setNomeLoja(e.target.value)} />
              </div>

              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block flex items-center gap-1">
                  Sub ID de rastreamento
                  <span className="text-[10px] bg-accent/20 text-accent px-1.5 py-0.5 rounded">opcional</span>
                </label>
                <input className={inputCls}
                  placeholder="ex: patrono (use o mesmo Sub ID ao gerar o link no portal)"
                  value={subId}
                  onChange={e => setSubId(e.target.value)} />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Este ID aparece nos relatórios do <a href="https://affiliate.shopee.com.br" target="_blank" className="text-accent hover:underline">portal de afiliados</a> para identificar de onde vieram seus cliques.
                </p>
              </div>

              <Button onClick={salvar} disabled={saving} className="w-full">
                {saving ? <><Loader2 className="w-4 h-4 animate-spin" />Conectando...</> : <><CheckCircle className="w-4 h-4" />Conectar como Afiliado</>}
              </Button>
            </div>
          )}

          {/* Campos modo vendedor */}
          {modo === 'vendedor' && (
            <div className="card-stat space-y-5">
              <div className="flex gap-3 rounded-lg bg-warning/10 border border-warning/20 p-3">
                <AlertCircle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                <div className="text-xs text-warning/80">
                  <p className="font-medium mb-1">Shopee Open Platform</p>
                  <p>Requer cadastro em <a href="https://open.shopee.com" target="_blank" className="underline">open.shopee.com</a>. Após aprovação, você recebe Partner ID e Partner Key.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Nome da loja *</label>
                  <input className={inputCls} placeholder="Minha Loja Shopee" value={nomeLoja}
                    onChange={e => setNomeLoja(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Shop ID *</label>
                  <input className={inputCls} placeholder="123456" value={shopId}
                    onChange={e => setShopId(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Partner ID *</label>
                  <input className={inputCls} placeholder="1234567" value={partnerId}
                    onChange={e => setPartnerId(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Partner Key *</label>
                  <input className={inputCls} type="password" placeholder="••••••••" value={partnerKey}
                    onChange={e => setPartnerKey(e.target.value)} />
                </div>
              </div>

              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Access Token *</label>
                <input className={inputCls} type="password" placeholder="access_token da sua loja" value={accessToken}
                  onChange={e => setAccessToken(e.target.value)} />
              </div>

              <div className="flex gap-3">
                <Button onClick={salvar} disabled={saving} className="flex-1">
                  {saving ? <><Loader2 className="w-4 h-4 animate-spin" />Testando conexão...</> : <><CheckCircle className="w-4 h-4" />Conectar e Testar</>}
                </Button>
                <Button variant="outline" asChild>
                  <a href="https://open.shopee.com/documents/v2/v2.shop.get_shop_info?module=3&type=1" target="_blank">
                    <ExternalLink className="w-4 h-4" />Docs
                  </a>
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Info sobre como funciona */}
      <div className="card-stat space-y-3">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <ShoppingBag className="w-4 h-4 text-orange-400" /> Como a integração funciona
        </h3>
        <div className="space-y-2 text-xs text-muted-foreground">
          {[
            { n: '1', t: 'Conecte sua conta Shopee', d: 'Modo afiliado (affiliate.shopee.com.br) ou vendedor (Open Platform)' },
            { n: '2', t: 'Gere links rastreáveis', d: 'O Patrono cria um link rastreável, no domínio dele, para cada produto Shopee cadastrado' },
            { n: '3', t: 'Compartilhe o conteúdo', d: 'Use os links gerados no TikTok, Instagram e outras plataformas' },
            { n: '4', t: 'Acompanhe os resultados', d: 'Cliques e conversões aparecem no dashboard de monetização em tempo real' },
          ].map(({ n, t, d }) => (
            <div key={n} className="flex gap-3">
              <div className="w-5 h-5 rounded-full bg-orange-500/20 text-orange-400 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">{n}</div>
              <div>
                <p className="text-white font-medium">{t}</p>
                <p>{d}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
