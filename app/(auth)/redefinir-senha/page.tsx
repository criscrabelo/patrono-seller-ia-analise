'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Loader2, CheckCircle, Eye, EyeOff, ArrowLeft } from 'lucide-react'
import { BrandMark } from '@/components/shared/BrandMark'

function RedefinirForm() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token') || ''

  const [novaSenha, setNovaSenha] = useState('')
  const [confirmar, setConfirmar] = useState('')
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState('')
  const [ok, setOk] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    if (novaSenha !== confirmar) { setErro('As senhas não coincidem'); return }
    if (novaSenha.length < 10) { setErro('A nova senha precisa ter pelo menos 10 caracteres'); return }
    setLoading(true)
    const res = await fetch('/api/auth/redefinir-senha', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, novaSenha }),
    }).catch(() => null)
    setLoading(false)
    if (!res) { setErro('Sem conexão. Tente de novo.'); return }
    if (res.ok) {
      setOk(true)
    } else {
      const d = await res.json().catch(() => ({}))
      setErro(d.error || 'Não foi possível redefinir a senha.')
    }
  }

  const inputClass = `w-full rounded-lg border border-border bg-background px-3.5 py-2.5 pr-10 text-sm
    text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-accent transition-colors`

  if (ok) {
    return (
      <div className="w-full max-w-sm text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-accent/10 border border-accent/30 mb-6">
          <CheckCircle className="w-7 h-7 text-accent" />
        </div>
        <h1 className="text-xl font-bold text-white mb-2">Senha redefinida!</h1>
        <p className="text-sm text-white/50 mb-6">Já pode entrar com a nova senha.</p>
        <Link href="/login" className="text-accent text-sm hover:underline inline-flex items-center gap-1">
          <ArrowLeft className="w-3.5 h-3.5" /> Ir para o login
        </Link>
      </div>
    )
  }

  return (
    <div className="w-full max-w-sm">
      <div className="text-center mb-8">
        <div className="inline-flex justify-center mb-4">
          <BrandMark size={56} />
        </div>
        <h1 className="text-2xl font-bold text-white">Patrono Seller IA</h1>
        <p className="text-sm text-white/50 mt-1">Criar nova senha</p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-8">
        <h2 className="text-lg font-semibold text-white mb-6">Nova senha</h2>

        {!token ? (
          <p className="text-sm text-danger">
            Link inválido. Abra o link que enviamos no seu email, ou{' '}
            <Link href="/esqueci-senha" className="underline">peça um novo</Link>.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label htmlFor="novaSenha" className="text-sm font-medium text-white/70 block mb-1.5">Nova senha</label>
              <div className="relative">
                <input
                  id="novaSenha"
                  type={show ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={novaSenha}
                  onChange={(e) => setNovaSenha(e.target.value)}
                  placeholder="Pelo menos 6 caracteres"
                  className={inputClass}
                />
                <button type="button" onClick={() => setShow((v) => !v)} tabIndex={-1}
                  title={show ? 'Ocultar senha' : 'Mostrar senha'}
                  aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/70 hover:text-white transition-colors">
                  {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="confirmar" className="text-sm font-medium text-white/70 block mb-1.5">Confirmar nova senha</label>
              <div className="relative">
                <input
                  id="confirmar"
                  type={show ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={confirmar}
                  onChange={(e) => setConfirmar(e.target.value)}
                  placeholder="••••••••"
                  className={inputClass}
                />
              </div>
            </div>

            {erro && <p className="text-danger text-sm">{erro}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-primary-dark
                         hover:bg-accent-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                         flex items-center justify-center gap-2"
            >
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" />Salvando...</> : 'Redefinir senha'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

export default function RedefinirSenhaPage() {
  return (
    <Suspense fallback={<div className="text-white/50 text-sm">Carregando...</div>}>
      <RedefinirForm />
    </Suspense>
  )
}
