'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { CheckCircle, XCircle, Trash2, Shield, User, Clock, Loader2, Pencil, Save, X, KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'
import { formatDateShort } from '@/lib/utils'

interface Usuario {
  id: string
  name: string | null
  email: string
  role: string
  status: string
  createdAt: string
}

const statusLabel: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  ativo:    { label: 'Ativo',    color: 'text-success border-success/30 bg-success/10',  icon: <CheckCircle className="w-3 h-3" /> },
  pendente: { label: 'Pendente', color: 'text-warning border-warning/30 bg-warning/10',  icon: <Clock className="w-3 h-3" /> },
  bloqueado:{ label: 'Bloqueado',color: 'text-danger border-danger/30 bg-danger/10',     icon: <XCircle className="w-3 h-3" /> },
}

export default function UsuariosAdminPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [loading, setLoading] = useState(true)
  const [editandoEmailId, setEditandoEmailId] = useState<string | null>(null)
  const [emailEditado, setEmailEditado] = useState('')
  const [salvandoEmail, setSalvandoEmail] = useState(false)
  const [editandoNomeId, setEditandoNomeId] = useState<string | null>(null)
  const [nomeEditado, setNomeEditado] = useState('')
  const [salvandoNome, setSalvandoNome] = useState(false)
  const [redefinindoSenhaId, setRedefinindoSenhaId] = useState<string | null>(null)
  const [senhaNova, setSenhaNova] = useState('')
  const [salvandoSenha, setSalvandoSenha] = useState(false)

  useEffect(() => {
    if (status === 'loading') return
    if (!session || session.user.role !== 'admin') {
      router.replace('/torre')
      return
    }
    fetchUsuarios()
  }, [session, status])

  async function fetchUsuarios() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/usuarios')
      const data = await res.json().catch(() => null)
      setUsuarios(Array.isArray(data) ? data : [])
      if (!res.ok) toast({ title: 'Não consegui carregar as usuárias', variant: 'destructive' })
    } catch {
      toast({ title: 'Sem conexão', description: 'Atualize a página.', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  async function atualizar(id: string, payload: { status?: string; role?: string }) {
    const res = await fetch('/api/admin/usuarios', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...payload }),
    })
    if (res.ok) {
      toast({ title: 'Usuário atualizado', variant: 'success' })
      fetchUsuarios()
    } else {
      const d = await res.json().catch(() => ({}))
      toast({ title: d.error || 'Erro ao atualizar', variant: 'destructive' })
    }
  }

  function iniciarEdicaoNome(u: Usuario) {
    setEditandoNomeId(u.id)
    setNomeEditado(u.name || '')
  }

  function cancelarEdicaoNome() {
    setEditandoNomeId(null)
    setNomeEditado('')
  }

  async function salvarNome(id: string) {
    const novoNome = nomeEditado.trim()
    if (!novoNome) {
      toast({ title: 'Informe um nome', variant: 'destructive' }); return
    }
    setSalvandoNome(true)
    const res = await fetch('/api/admin/usuarios', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name: novoNome }),
    })
    setSalvandoNome(false)
    if (res.ok) {
      toast({ title: 'Nome atualizado', variant: 'success' })
      setEditandoNomeId(null)
      setNomeEditado('')
      fetchUsuarios()
    } else {
      const d = await res.json().catch(() => ({}))
      toast({ title: d.error || 'Erro ao atualizar nome', variant: 'destructive' })
    }
  }

  function iniciarEdicaoEmail(u: Usuario) {
    setEditandoEmailId(u.id)
    setEmailEditado(u.email)
  }

  function cancelarEdicaoEmail() {
    setEditandoEmailId(null)
    setEmailEditado('')
  }

  async function salvarEmail(id: string) {
    const novoEmail = emailEditado.trim()
    if (!novoEmail) {
      toast({ title: 'Informe um email', variant: 'destructive' }); return
    }
    setSalvandoEmail(true)
    const res = await fetch('/api/admin/usuarios', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, email: novoEmail }),
    })
    setSalvandoEmail(false)
    if (res.ok) {
      toast({ title: 'Email atualizado', variant: 'success' })
      setEditandoEmailId(null)
      setEmailEditado('')
      fetchUsuarios()
    } else {
      const d = await res.json().catch(() => ({}))
      toast({ title: d.error || 'Erro ao atualizar email', variant: 'destructive' })
    }
  }

  function iniciarReset(id: string) {
    setRedefinindoSenhaId(id)
    setSenhaNova('')
  }

  function cancelarReset() {
    setRedefinindoSenhaId(null)
    setSenhaNova('')
  }

  async function salvarSenhaReset(id: string) {
    if (senhaNova.length < 10) {
      toast({ title: 'A senha precisa ter pelo menos 10 caracteres', variant: 'destructive' }); return
    }
    setSalvandoSenha(true)
    const res = await fetch('/api/admin/usuarios', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, password: senhaNova }),
    })
    setSalvandoSenha(false)
    if (res.ok) {
      toast({ title: 'Senha redefinida com sucesso', variant: 'success' })
      cancelarReset()
    } else {
      const d = await res.json().catch(() => ({}))
      toast({ title: d.error || 'Erro ao redefinir senha', variant: 'destructive' })
    }
  }

  async function excluir(id: string, email: string) {
    if (!confirm(`Excluir usuário ${email}? Todos os dados serão perdidos.`)) return
    const res = await fetch(`/api/admin/usuarios?id=${id}`, { method: 'DELETE' })
    if (res.ok) {
      toast({ title: 'Usuário excluído', variant: 'success' })
      fetchUsuarios()
    } else {
      const d = await res.json().catch(() => ({}))
      toast({ title: d.error || 'Erro ao excluir', variant: 'destructive' })
    }
  }

  const pendentes = usuarios.filter((u) => u.status === 'pendente')
  const demais   = usuarios.filter((u) => u.status !== 'pendente')
  const totalAdmins = usuarios.filter((u) => u.role === 'admin').length

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white">Gerenciar Usuários</h2>
        <p className="text-sm text-muted-foreground">{usuarios.length} usuário(s) cadastrado(s)</p>
      </div>

      {loading ? (
        <div className="card-stat flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Pendentes */}
          {pendentes.length > 0 && (
            <div className="card-stat space-y-4">
              <h3 className="text-sm font-semibold text-warning flex items-center gap-2">
                <Clock className="w-4 h-4" /> Aguardando aprovação ({pendentes.length})
              </h3>
              {pendentes.map((u) => (
                <div key={u.id} className="flex items-center justify-between gap-3 rounded-lg border border-warning/20 bg-warning/5 p-3">
                  <div>
                    <p className="text-sm font-medium text-white">{u.name || '—'}</p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Solicitado em {formatDateShort(u.createdAt)}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button size="sm" onClick={() => atualizar(u.id, { status: 'ativo' })}>
                      <CheckCircle className="w-3.5 h-3.5" /> Aprovar
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => atualizar(u.id, { status: 'bloqueado' })}>
                      <XCircle className="w-3.5 h-3.5" /> Rejeitar
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Todos os usuários */}
          <div className="card-stat space-y-3">
            <h3 className="text-sm font-semibold text-white">Todos os usuários</h3>
            {demais.length === 0 && pendentes.length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhum usuário cadastrado.</p>
            )}
            {demais.map((u) => {
              const st = statusLabel[u.status] ?? statusLabel.bloqueado
              const isSelf = u.id === session?.user.id
              return (
                <div key={u.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
                      {u.role === 'admin' ? <Shield className="w-4 h-4 text-accent" /> : <User className="w-4 h-4 text-muted-foreground" />}
                    </div>
                    <div className="min-w-0">
                      {editandoNomeId === u.id ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            autoFocus
                            value={nomeEditado}
                            onChange={(e) => setNomeEditado(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') salvarNome(u.id) }}
                            className="rounded-md border border-accent/40 bg-background px-2 py-1 text-sm text-white
                              focus:outline-none focus:ring-1 focus:ring-accent w-full max-w-56"
                          />
                          <button onClick={() => salvarNome(u.id)} disabled={salvandoNome}
                            className="text-accent hover:text-accent-light p-1 disabled:opacity-50">
                            <Save className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={cancelarEdicaoNome} disabled={salvandoNome}
                            className="text-muted-foreground hover:text-white p-1">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <p className="text-sm font-medium text-white flex items-center gap-1.5">
                          <span>{u.name || '—'}</span>
                          {isSelf && <span className="text-[10px] text-accent">(você)</span>}
                          <button onClick={() => iniciarEdicaoNome(u)} title="Editar nome"
                            className="text-muted-foreground hover:text-accent shrink-0">
                            <Pencil className="w-3 h-3" />
                          </button>
                        </p>
                      )}
                      {editandoEmailId === u.id ? (
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <input
                            autoFocus
                            type="email"
                            value={emailEditado}
                            onChange={(e) => setEmailEditado(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') salvarEmail(u.id) }}
                            className="rounded-md border border-accent/40 bg-background px-2 py-1 text-xs text-white
                              focus:outline-none focus:ring-1 focus:ring-accent w-full max-w-56"
                          />
                          <button onClick={() => salvarEmail(u.id)} disabled={salvandoEmail}
                            className="text-accent hover:text-accent-light p-1 disabled:opacity-50">
                            <Save className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={cancelarEdicaoEmail} disabled={salvandoEmail}
                            className="text-muted-foreground hover:text-white p-1">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                          <button onClick={() => iniciarEdicaoEmail(u)} title="Editar email"
                            className="text-muted-foreground hover:text-accent shrink-0">
                            <Pencil className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${st.color}`}>
                      {st.icon}{st.label}
                    </span>
                    <select
                      value={u.role}
                      onChange={(e) => atualizar(u.id, { role: e.target.value })}
                      title="Classificar papel do usuário"
                      className="rounded-md border border-border bg-background px-2 py-1 text-xs text-white
                        focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer"
                    >
                      <option value="admin">Administrador</option>
                      <option value="usuario" disabled={u.role === 'admin' && totalAdmins <= 1}>Usuário</option>
                    </select>
                    <Button size="sm" variant="outline"
                      onClick={() => (redefinindoSenhaId === u.id ? cancelarReset() : iniciarReset(u.id))}
                      title="Redefinir senha">
                      <KeyRound className="w-3.5 h-3.5" />
                    </Button>
                    {!isSelf && (
                      <>
                        {u.status === 'ativo' && (
                          <Button size="sm" variant="outline" onClick={() => atualizar(u.id, { status: 'bloqueado' })}
                            title="Bloquear usuário">
                            <XCircle className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {u.status === 'bloqueado' && (
                          <Button size="sm" variant="outline" onClick={() => atualizar(u.id, { status: 'ativo' })}
                            title="Ativar usuário">
                            <CheckCircle className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        <Button size="sm" variant="destructive" onClick={() => excluir(u.id, u.email)}
                          className="w-8 p-0">
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                  </div>
                  {redefinindoSenhaId === u.id && (
                    <div className="mt-3 pt-3 border-t border-border flex items-center gap-2">
                      <KeyRound className="w-4 h-4 text-accent shrink-0" />
                      <input
                        autoFocus
                        type="text"
                        value={senhaNova}
                        onChange={(e) => setSenhaNova(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') salvarSenhaReset(u.id) }}
                        placeholder="Nova senha (mín. 10 caracteres)"
                        className="flex-1 rounded-md border border-accent/40 bg-background px-2 py-1 text-sm text-white
                          placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                      <button onClick={() => salvarSenhaReset(u.id)} disabled={salvandoSenha}
                        className="text-accent hover:text-accent-light p-1 disabled:opacity-50" title="Salvar senha">
                        <Save className="w-4 h-4" />
                      </button>
                      <button onClick={cancelarReset} disabled={salvandoSenha}
                        className="text-muted-foreground hover:text-white p-1" title="Cancelar">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
