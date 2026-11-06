'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { SlidersHorizontal, Loader2 } from 'lucide-react'
import { toast } from '@/hooks/use-toast'

interface ModuloPermissao {
  key: string
  label: string
  liberado: boolean
}

export default function PermissoesAdminPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [modulos, setModulos] = useState<ModuloPermissao[]>([])
  const [loading, setLoading] = useState(true)
  const [salvandoKey, setSalvandoKey] = useState<string | null>(null)

  useEffect(() => {
    if (status === 'loading') return
    if (!session || session.user.role !== 'admin') {
      router.replace('/torre')
      return
    }
    fetchModulos()
  }, [session, status])

  async function fetchModulos() {
    setLoading(true)
    const res = await fetch('/api/admin/permissoes')
    const data = await res.json()
    setModulos(Array.isArray(data) ? data : [])
    setLoading(false)
  }

  async function alternar(modulo: string, liberadoAtual: boolean) {
    setSalvandoKey(modulo)
    setModulos((ms) => ms.map((m) => (m.key === modulo ? { ...m, liberado: !liberadoAtual } : m)))
    const res = await fetch('/api/admin/permissoes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modulo, liberado: !liberadoAtual }),
    })
    setSalvandoKey(null)
    if (!res.ok) {
      toast({ title: 'Erro ao atualizar permissão', variant: 'destructive' })
      setModulos((ms) => ms.map((m) => (m.key === modulo ? { ...m, liberado: liberadoAtual } : m)))
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <SlidersHorizontal className="w-5 h-5 text-accent" /> Permissões por Papel
        </h2>
        <p className="text-sm text-muted-foreground">
          Escolha quais módulos ficam visíveis para o papel <strong className="text-white">usuário</strong>.
          Administradores sempre veem tudo.
        </p>
      </div>

      {loading ? (
        <div className="card-stat flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="card-stat space-y-1">
          {modulos.map((m) => (
            <div key={m.key} className="flex items-center justify-between gap-3 py-2.5 border-b border-border last:border-0">
              <p className="text-sm text-white">{m.label}</p>
              <button
                onClick={() => alternar(m.key, m.liberado)}
                disabled={salvandoKey === m.key}
                className={`relative w-10 h-6 rounded-full p-0.5 transition-colors disabled:opacity-50 ${
                  m.liberado ? 'bg-accent' : 'bg-secondary'
                }`}
                title={m.liberado ? 'Liberado — clique para bloquear' : 'Bloqueado — clique para liberar'}
              >
                <span
                  className={`block w-5 h-5 rounded-full bg-white transition-transform ${
                    m.liberado ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
