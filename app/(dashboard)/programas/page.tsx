'use client'

import { useEffect, useState } from 'react'
import { Handshake, Plus, Loader2, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'
import { useGuardModulo } from '@/hooks/useGuardModulo'
import { Indicador } from '@/components/shared/Ux'
import { ROTULO_DO_CANAL } from '@/lib/rotulos-de-canal'
import type { SituacaoDoCanal } from '@/lib/resumos'

interface Provider {
  id: string
  nome: string
  categoria: string
  cadastroDisponivel: boolean
  urlOficial: string
  capability?: { status: string; automatedPublishing: boolean; officialApi: boolean }
}

// Rótulos de AffiliateProviderCapability.status — a UI só TRADUZ o que a
// capability diz, nunca decide sozinha se um provider "tem API" ou não.
const CAPABILITY_LABEL: Record<string, string> = {
  SUPPORTED_MANUAL: 'Funcionamento manual',
  OFFICIAL_API_AVAILABLE: 'API oficial disponível',
  AUTHORIZATION_REQUIRED: 'API oficial — exige autorização',
  PARTNER_ACCESS_REQUIRED: 'Acesso via parceiro/rede',
  NOT_VERIFIED: 'Não verificado ainda',
  NOT_AVAILABLE: 'Sem caminho oficial conhecido',
  BLOCKED_BY_POLICY: 'Bloqueado pela política da plataforma',
}

interface Programa {
  id: string
  platform: string
  status: string
  operationMode: string
  integrationStatus: string
  notes: string | null
  createdAt: string
}

const STATUS_LABEL: Record<string, { label: string; cor: string }> = {
  NOT_REGISTERED: { label: 'Não cadastrada', cor: 'text-muted-foreground bg-secondary' },
  REQUESTED: { label: 'Solicitado', cor: 'text-blue-400 bg-blue-400/10' },
  WAITING_APPROVAL: { label: 'Aguardando aprovação', cor: 'text-warning bg-warning/10' },
  ACTIVE: { label: 'Ativo', cor: 'text-accent bg-accent/10' },
  NEEDS_CONFIGURATION: { label: 'Precisa de configuração', cor: 'text-danger bg-danger/10' },
}

const INTEGRACAO_LABEL: Record<string, string> = {
  NOT_AVAILABLE: 'Sem integração disponível',
  FUTURE: 'Integração futura',
  CONFIGURED: 'Configurada, não conectada',
  CONNECTED: 'Conectada',
  ERROR: 'Erro de integração',
}

export default function ProgramasPage() {
  useGuardModulo('programas')
  const [providers, setProviders] = useState<Provider[]>([])
  // P2.17.13: o que o Patrono já sabe (programas conhecidos, integrações, aprovação) vem antes do cadastro manual.
  const [canais, setCanais] = useState<{ id: string; nome: string; situacao: SituacaoDoCanal; proximaAcao: string; urlOficial: string; integracaoOficial: boolean; conectado: boolean }[]>([])
  const [programas, setProgramas] = useState<Programa[]>([])
  const [loading, setLoading] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    platform: '',
    status: 'REQUESTED',
    accountName: '',
    accessLink: '',
    notes: '',
  })

  useEffect(() => {
    fetchAll()
  }, [])

  async function fetchAll() {
    setLoading(true)
    try {
      const [pRes, gRes, cRes] = await Promise.all([fetch('/api/programas/providers'), fetch('/api/programas'), fetch('/api/resumos/canais')])
      if (cRes.ok) setCanais(await cRes.json())
      if (pRes.ok) setProviders(await pRes.json())
      if (gRes.ok) setProgramas(await gRes.json())
      if (!pRes.ok || !gRes.ok) toast({ title: 'Parte dos dados não carregou', description: 'Atualize a página.', variant: 'destructive' })
    } catch {
      toast({ title: 'Sem conexão', description: 'Atualize a página para tentar de novo.', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  async function salvar() {
    if (!form.platform) {
      setErro('Selecione uma plataforma para continuar')
      return
    }
    setErro('')
    setSalvando(true)
    const res = await fetch('/api/programas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    if (res.ok) {
      toast({ title: 'Programa salvo!', variant: 'success' })
      setShowForm(false)
      setForm({ platform: '', status: 'REQUESTED', accountName: '', accessLink: '', notes: '' })
      fetchAll()
    } else {
      const data = await res.json().catch(() => ({}))
      setErro(data.error ?? 'Não foi possível salvar. Tente novamente.')
    }
    setSalvando(false)
  }

  const jaCadastradas = new Set(programas.map((p) => p.platform))
  const providerNome = (id: string) => providers.find((p) => p.id === id)?.nome ?? id

  return (
    <div className="space-y-6 w-full max-w-5xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            <Handshake className="w-5 h-5 text-accent" /> Meus Programas
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Os programas que o Patrono conhece e acompanha. Cadastrar à mão é só contingência.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setShowForm((s) => !s)} className="shrink-0">
          <Plus className="w-4 h-4" /> Cadastrar manualmente (contingência)
        </Button>
      </div>

      {showForm && (
        <div className="card-stat space-y-4 border-accent/30">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Plataforma</label>
            <select
              className="input mt-1 w-full"
              value={form.platform}
              onChange={(e) => setForm((f) => ({ ...f, platform: e.target.value }))}
            >
              <option value="">Selecione...</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id} disabled={jaCadastradas.has(p.id)}>
                  {p.nome}
                  {p.capability ? ` — ${CAPABILITY_LABEL[p.capability.status] ?? p.capability.status}` : ''}
                  {jaCadastradas.has(p.id) ? ' (já cadastrada)' : ''}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground mt-1.5">
              "API oficial" ou "acesso via parceiro" não significa que já estamos conectados — é só o que a
              plataforma permite, em tese. O cadastro abaixo continua manual nesta fase.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Status</label>
              <select
                className="input mt-1 w-full"
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              >
                {Object.entries(STATUS_LABEL).map(([id, { label }]) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Nome da conta (opcional)</label>
              <input
                className="input mt-1 w-full"
                value={form.accountName}
                onChange={(e) => setForm((f) => ({ ...f, accountName: e.target.value }))}
                placeholder="ex.: @boracomprar"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Link de acesso ao programa (opcional)</label>
            <input
              className="input mt-1 w-full"
              value={form.accessLink}
              onChange={(e) => setForm((f) => ({ ...f, accessLink: e.target.value }))}
              placeholder="https://..."
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Observações (opcional)</label>
            <textarea
              className="input mt-1 w-full"
              rows={2}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>
          <p className="text-xs text-muted-foreground bg-secondary/50 rounded-lg p-2.5">
            Nesta fase a operação é sempre <strong>manual</strong> — nenhuma senha da plataforma é
            solicitada aqui, e nenhuma conta é conectada de verdade automaticamente.
          </p>
          {erro && <p className="text-xs text-danger">{erro}</p>}
          <div className="flex gap-2">
            <Button onClick={salvar} disabled={salvando}>
              {salvando ? <><Loader2 className="w-4 h-4 animate-spin" />Salvando...</> : 'Salvar programa'}
            </Button>
            <Button variant="outline" onClick={() => setShowForm(false)} disabled={salvando}>Cancelar</Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="card-stat animate-pulse h-16" />)}</div>
      ) : programas.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhum programa registrado ainda — veja abaixo os que o Patrono acompanha.</p>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Plataforma</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Programa</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground hidden sm:table-cell">Operação</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground hidden sm:table-cell">Integração</th>
              </tr>
            </thead>
            <tbody>
              {programas.map((p) => {
                const status = STATUS_LABEL[p.status] ?? STATUS_LABEL.NOT_REGISTERED
                return (
                  <tr key={p.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-medium text-white">
                      <a
                        href={providers.find((x) => x.id === p.platform)?.urlOficial || '#'}
                        target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 hover:text-accent"
                      >
                        {providerNome(p.platform)} <ExternalLink className="w-3 h-3 opacity-50" />
                      </a>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`badge-status ${status.cor}`}>{status.label}</span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">Manual</td>
                    <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
                      {INTEGRACAO_LABEL[p.integrationStatus] ?? p.integrationStatus}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {!loading && canais.length > 0 && (
        <section className="space-y-2" aria-label="Programas conhecidos">
          <p className="text-sm font-semibold text-white">Programas que o Patrono acompanha</p>
          <p className="text-[11px] text-muted-foreground">Aqui: onde você participa — cadastro, aprovação, integração e documentação. Quanto cada canal trouxe fica em Canais de receita.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {canais.map((c) => {
              const r = ROTULO_DO_CANAL[c.situacao]
              return (
                <div key={c.id} className="rounded-lg border border-border p-3 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm text-white">{c.nome}</p>
                    <Indicador nome="" estado={r.rotulo} tom={r.tom} />
                  </div>
                  <p className="text-[11px] text-muted-foreground">Integração: {c.conectado ? 'conectada' : c.integracaoOficial ? 'API oficial disponível, não conectada' : 'sem API oficial (resultados por registro)'}</p>
                  <p className="text-[11px] text-white/85">Ação: {c.proximaAcao}</p>
                  <a href={c.urlOficial} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-accent">Documentação / site oficial <ExternalLink className="w-3 h-3" /></a>
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
