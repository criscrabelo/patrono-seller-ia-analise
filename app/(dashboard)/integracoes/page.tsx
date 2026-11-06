'use client'

import { useEffect, useState } from 'react'
import { CheckCircle, XCircle, ExternalLink, Loader2, Info, RefreshCw, Clock, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import { useGuardModulo } from '@/hooks/useGuardModulo'
import { TikTokShopCard } from '@/components/integracoes/TikTokShopCard'
import { TikTokCard } from '@/components/integracoes/TikTokCard'
import { ResumoDasIntegracoes } from '@/components/integracoes/ResumoDasIntegracoes'
import { VitrineTikTokShop } from '@/components/integracoes/VitrineTikTokShop'
import { PLATAFORMAS_COM_CHAVE as PLATAFORMAS, type Plataforma } from '@/lib/integracoes-da-tela'

interface Integracao {
  plataforma: string
  status: string
  accountName?: string
  accountId?: string
  tokenExpiry?: string
  /** P1.5.1 — o que a conta comprovadamente autorizou. Nunca traz token. */
  autorizacao?: {
    estado: string
    scopes: string[] | null
    scopesFaltando: string[]
    scopesComprovadosEm: string | null
  }
  /** P1.5.2 — por que este canal ainda nao publica. */
  preflight?: {
    pronto: boolean
    executavelAgora: boolean
    bloqueio: string | null
    oQueFalta: string | null
    adapterLigado: boolean
  }
}

// P2.17.14: a lista de plataformas mora em lib/integracoes-da-tela.ts — a MESMA
// fonte do contador e do resumo executivo (nada de número escrito à mão).

export default function IntegracoesPage() {
  useGuardModulo('integracoes')
  const [integracoes, setIntegracoes] = useState<Integracao[]>([])
  const [loading, setLoading] = useState(true)
  // P2.17.14: os cartões técnicos ficam recolhidos; "Configurar" abre e leva ao cartão.
  const [configurando, setConfigurando] = useState(false)
  function configurar(id: string) {
    setConfigurando(true)
    setTimeout(() => document.getElementById(`cfg-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50)
  }
  const [expanded, setExpanded] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState<string | null>(null)
  const [renovando, setRenovando] = useState(false)
  const [revalidando, setRevalidando] = useState(false)
  const [campos, setCampos] = useState<Record<string, Record<string, string>>>({})

  const [erroAoCarregar, setErroAoCarregar] = useState(false)

  async function fetchIntegracoes() {
    try {
      const res = await fetch('/api/integracoes')
      const data = await res.json().catch(() => null)
      // P2.15.3: erro não pode aparecer como "tudo desconectado".
      setErroAoCarregar(!res.ok || !Array.isArray(data))
      if (Array.isArray(data)) setIntegracoes(data)
    } catch {
      setErroAoCarregar(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchIntegracoes() }, [])

  function getStatus(id: string) {
    return integracoes.find((i) => i.plataforma === id)
  }

  function setCampo(plat: string, key: string, val: string) {
    setCampos((prev) => ({ ...prev, [plat]: { ...(prev[plat] ?? {}), [key]: val } }))
  }

  async function conectar(plataforma: Plataforma) {
    const data = campos[plataforma.id] ?? {}
    const accessToken = data.accessToken?.trim()
    if (!accessToken) {
      toast({ title: 'Preencha o token de acesso', variant: 'destructive' })
      return
    }

    setSaving(plataforma.id)

    // Para o Instagram, guarda appId e appSecret em extraData para renovação automática
    // Para o WhatsApp, guarda clientToken em extraData
    const extraData =
      plataforma.id === 'instagram' && (data.appId || data.appSecret)
        ? { appId: data.appId?.trim(), appSecret: data.appSecret?.trim() }
        : plataforma.id === 'whatsapp' && data.clientToken
        ? { clientToken: data.clientToken.trim() }
        : undefined

    try {
      const res = await fetch('/api/integracoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plataforma: plataforma.id,
          accessToken,
          accountId: data.accountId || undefined,
          accountName: data.accountName || undefined,
          extraData,
        }),
      })
      const resposta = await res.json().catch(() => ({}))
      if (res.ok) {
        toast({ title: `${plataforma.nome} conectado!`, variant: 'success' })
        setExpanded(null)
        setCampos((prev) => ({ ...prev, [plataforma.id]: {} }))
        fetchIntegracoes()
      } else {
        toast({ title: `Não consegui conectar o ${plataforma.nome}`, description: resposta.error ?? 'Confira os dados e tente de novo.', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Sem conexão', description: 'Nada foi salvo. Tente de novo.', variant: 'destructive' })
    } finally {
      setSaving(null)
    }
  }

  async function renovarTokenInstagram() {
    setRenovando(true)
    const res = await fetch('/api/integracoes/instagram/renovar', { method: 'POST' })
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      const expiry = new Date(data.tokenExpiry)
      toast({
        title: 'Token renovado com sucesso!',
        description: `Válido até ${expiry.toLocaleDateString('pt-BR')}`,
        variant: 'success',
      })
      fetchIntegracoes()
    } else {
      toast({ title: 'Erro ao renovar token', description: data.error, variant: 'destructive' })
    }
    setRenovando(false)
  }

  async function revalidarInstagram() {
    setRevalidando(true)
    const res = await fetch('/api/integracoes/instagram/revalidar', { method: 'POST' })
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      const quantos = data.autorizacao?.scopes?.length ?? 0
      toast({
        title: quantos > 0 ? 'Permissões comprovadas' : 'Não foi possível comprovar as permissões',
        description: quantos > 0 ? `${quantos} permissão(ões) confirmada(s) pela Meta.` : data.motivo,
        variant: quantos > 0 ? 'success' : 'destructive',
      })
      fetchIntegracoes()
    } else {
      toast({ title: 'Erro ao comprovar as permissões', description: data.error, variant: 'destructive' })
    }
    setRevalidando(false)
  }

  function tokenExpiryBadge(tokenExpiry?: string) {
    if (!tokenExpiry) return null
    const expiry = new Date(tokenExpiry)
    const diasRestantes = Math.ceil((expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    if (diasRestantes <= 0) {
      return { label: 'Token expirado', cls: 'border-danger/40 bg-danger/10 text-danger' }
    }
    if (diasRestantes <= 15) {
      return { label: `Expira em ${diasRestantes} ${diasRestantes === 1 ? 'dia' : 'dias'}`, cls: 'border-warning/40 bg-warning/10 text-warning' }
    }
    return { label: `Válido por mais ${diasRestantes} dias`, cls: 'border-accent/30 bg-accent/10 text-accent' }
  }

  async function desconectar(id: string, nome: string) {
    if (!confirm(`Deseja desconectar o ${nome}?`)) return
    setDisconnecting(id)
    const res = await fetch(`/api/integracoes?plataforma=${id}`, { method: 'DELETE' }).catch(() => null)
    if (res?.ok) toast({ title: `${nome} desconectado` })
    else toast({ title: `Não consegui desconectar o ${nome}`, description: 'Nada foi alterado. Tente de novo.', variant: 'destructive' })
    fetchIntegracoes()
    setDisconnecting(null)
  }

  if (loading) return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {[...Array(5)].map((_, i) => <div key={i} className="card-stat animate-pulse h-48" />)}
    </div>
  )

  return (
    <div className="space-y-6 max-w-5xl">
      {/* O título "Integrações" já está no cabeçalho da página: aqui só o resumo. */}
      {erroAoCarregar ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-danger/40 bg-danger/5 p-3 text-sm text-white">
          Não consegui conferir as conexões agora — o estado abaixo pode estar desatualizado.
          <button onClick={fetchIntegracoes} className="underline">Tentar de novo</button>
        </div>
      ) : null}

      {/* P2.17.13/14: primeiro a visão executiva (contador · status · impacto · próxima ação). */}
      <ResumoDasIntegracoes onConfigurar={configurar} />

      {/* Vitrine do TikTok Shop (Affiliate Creator API): o que está CONFIRMADO na vitrine. */}
      <VitrineTikTokShop />

      {/* Detalhes técnicos (tokens, escopos, documentação): recolhidos por padrão. */}
      <details open={configurando} onToggle={(e) => setConfigurando(e.currentTarget.open)} className="space-y-4">
      <summary className="cursor-pointer select-none text-sm font-semibold uppercase tracking-wider text-muted-foreground hover:text-white">Configurar conexões e detalhes técnicos</summary>

      {/* Orientação (informativa, não é alerta) */}
      <div className="flex gap-3 rounded-xl border border-border bg-card/50 p-4">
        <Info className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="text-white font-medium mb-1">Como conectar</p>
          <p className="text-muted-foreground">
            Cada plataforma pede um cadastro próprio. Use o botão "Documentação" de cada card para obter o
            acesso. Os tokens ficam guardados criptografados.
          </p>
        </div>
      </div>

      {/* P2.17: TikTok Shop só conecta pelo fluxo oficial (sem campo de token).
          P2.17.10: o TikTok (publicação) também — OAuth oficial, sem token manual. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div id="cfg-tiktok"><TikTokCard /></div>
        <div id="cfg-tiktok-shop"><TikTokShopCard /></div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {PLATAFORMAS.map((plat) => {
          const status = getStatus(plat.id)
          const conectado = status?.status === 'conectado'
          const isExpanded = expanded === plat.id
          const isSaving = saving === plat.id
          const isDisconnecting = disconnecting === plat.id

          return (
            <div key={plat.id} id={`cfg-${plat.id}`} className="card-stat flex flex-col gap-4">
              {/* Header */}
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className={cn('w-10 h-10 rounded-xl bg-gradient-to-br flex items-center justify-center text-xl', plat.cor)}>
                    {plat.logo}
                  </div>
                  <div>
                    <p className="font-semibold text-white text-sm">{plat.nome}</p>
                    <div className="flex items-center gap-1 mt-0.5">
                      {conectado ? (
                        <>
                          <CheckCircle className="w-3 h-3 text-accent" />
                          <span className="text-xs text-accent">Conectado</span>
                        </>
                      ) : (
                        <>
                          <XCircle className="w-3 h-3 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">Desconectado</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">{plat.descricao}</p>

              {conectado && status?.accountName && (
                <div className="rounded-lg bg-accent/10 border border-accent/20 px-3 py-2">
                  <p className="text-xs text-accent font-medium">{status.accountName}</p>
                  {status.accountId && <p className="text-[10px] text-muted-foreground">ID: {status.accountId}</p>}
                </div>
              )}

              {/* P1.5.2 — a pergunta que a tela precisa responder sozinha:
                  "por que este canal ainda nao esta publicando?" */}
              {conectado && status?.preflight && (
                <div
                  className={cn(
                    'rounded-lg border px-3 py-2 space-y-1',
                    status.preflight.executavelAgora
                      ? 'border-accent/30 bg-accent/10'
                      : 'border-warning/40 bg-warning/10'
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    {status.preflight.executavelAgora ? (
                      <CheckCircle className="w-3.5 h-3.5 text-accent shrink-0" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-warning shrink-0" />
                    )}
                    <span
                      className={cn(
                        'text-xs font-medium',
                        status.preflight.executavelAgora ? 'text-accent' : 'text-warning'
                      )}
                    >
                      {status.preflight.executavelAgora
                        ? 'Publicação liberada'
                        : status.preflight.pronto
                          ? 'Conta pronta, canal desligado'
                          : 'Publicação bloqueada'}
                    </span>
                  </div>

                  {!status.preflight.executavelAgora && status.preflight.oQueFalta && (
                    <p className="text-[10px] text-warning break-words">{status.preflight.oQueFalta}</p>
                  )}

                  {status.autorizacao?.scopesFaltando?.length ? (
                    <p className="text-[10px] text-warning break-words">Falta conceder permissões na Meta.</p>
                  ) : null}

                  {/* Nomes técnicos (estado e escopos da Meta) ficam recolhidos. */}
                  <details className="text-[10px] text-muted-foreground">
                    <summary className="cursor-pointer select-none hover:text-white">Detalhes técnicos</summary>
                    <div className="mt-1 space-y-0.5 break-words">
                      <p>Autorização: {status.autorizacao?.estado ?? 'desconhecida'}</p>
                      {status.autorizacao?.scopes && status.autorizacao.scopes.length > 0 && (
                        <p>Permissões: {status.autorizacao.scopes.join(', ')}</p>
                      )}
                      {status.autorizacao?.scopesFaltando?.length ? (
                        <p>Faltando: {status.autorizacao.scopesFaltando.join(', ')}</p>
                      ) : null}
                      {status.autorizacao?.scopesComprovadosEm && (
                        <p>
                          Comprovado em{' '}
                          {new Date(status.autorizacao.scopesComprovadosEm).toLocaleDateString('pt-BR')}
                        </p>
                      )}
                    </div>
                  </details>

                  {plat.id === 'instagram' && (
                    <button
                      onClick={revalidarInstagram}
                      disabled={revalidando}
                      className="flex items-center gap-1 text-[10px] font-semibold text-accent opacity-80 hover:opacity-100 transition-opacity disabled:opacity-40"
                    >
                      {revalidando ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3 h-3" />
                      )}
                      Comprovar permissões de novo
                    </button>
                  )}
                </div>
              )}

              {/* Badge de expiração do token + botão renovar (apenas Instagram) */}
              {conectado && plat.id === 'instagram' && (() => {
                const badge = tokenExpiryBadge(status?.tokenExpiry)
                return badge ? (
                  <div className={cn('rounded-lg border px-3 py-2 flex items-center justify-between gap-2', badge.cls)}>
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 shrink-0" />
                      <span className="text-xs font-medium">{badge.label}</span>
                    </div>
                    <button
                      onClick={renovarTokenInstagram}
                      disabled={renovando}
                      className="flex items-center gap-1 text-[10px] font-semibold opacity-80 hover:opacity-100 transition-opacity disabled:opacity-40"
                    >
                      {renovando
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : <RefreshCw className="w-3 h-3" />}
                      Renovar
                    </button>
                  </div>
                ) : null
              })()}

              {/* Form de credenciais */}
              {isExpanded && !conectado && (
                <div className="space-y-3 pt-2 border-t border-border">
                  {plat.campos?.map((campo) => (
                    <div key={campo.key}>
                      <label className="text-xs text-muted-foreground mb-1 block">{campo.label}</label>
                      <input
                        type={campo.secret ? 'password' : 'text'}
                        placeholder={campo.placeholder}
                        value={campos[plat.id]?.[campo.key] ?? ''}
                        onChange={(e) => setCampo(plat.id, campo.key, e.target.value)}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-white
                          placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Ações */}
              <div className="flex gap-2 mt-auto pt-2 border-t border-border">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  asChild
                >
                  <a href={plat.urlDocs} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="w-3.5 h-3.5" />
                    Documentação
                  </a>
                </Button>

                {conectado ? (
                  plat.urlDedicada ? (
                    <Button size="sm" className="flex-1" asChild>
                      <Link href={plat.urlDedicada}><Settings className="w-3.5 h-3.5" />Gerenciar</Link>
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="destructive"
                      className="flex-1"
                      disabled={isDisconnecting}
                      onClick={() => desconectar(plat.id, plat.nome)}
                    >
                      {isDisconnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                      Desconectar
                    </Button>
                  )
                ) : plat.urlDedicada ? (
                  <Button size="sm" className="flex-1" asChild>
                    <Link href={plat.urlDedicada}><Settings className="w-3.5 h-3.5" />Configurar</Link>
                  </Button>
                ) : isExpanded ? (
                  <Button
                    size="sm"
                    className="flex-1"
                    disabled={isSaving}
                    onClick={() => conectar(plat)}
                  >
                    {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                    Conectar
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={() => setExpanded(plat.id)}
                  >
                    <Settings className="w-3.5 h-3.5" />
                    Configurar
                  </Button>
                )}
              </div>

              {isExpanded && !conectado && (
                <button
                  onClick={() => setExpanded(null)}
                  className="text-xs text-muted-foreground hover:text-white text-center"
                >
                  Cancelar
                </button>
              )}
            </div>
          )
        })}
      </div>
      </details>
    </div>
  )
}
