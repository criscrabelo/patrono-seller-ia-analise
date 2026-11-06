'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Loader2, MailCheck, ArrowLeft } from 'lucide-react'
import { BrandMark } from '@/components/shared/BrandMark'

export default function EsqueciSenhaPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [enviado, setEnviado] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    await fetch('/api/auth/esqueci-senha', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }).catch(() => {})
    setLoading(false)
    setEnviado(true)
  }

  const inputClass = `w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm
    text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-accent transition-colors`

  if (enviado) {
    return (
      <div className="w-full max-w-sm text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-accent/10 border border-accent/30 mb-6">
          <MailCheck className="w-7 h-7 text-accent" />
        </div>
        <h1 className="text-xl font-bold text-white mb-2">Verifique seu email</h1>
        <p className="text-sm text-white/50 mb-6">
          Se existir uma conta com <strong className="text-white">{email}</strong>, enviamos um link
          para redefinir a senha. O link vale por 1 hora. Confira também a caixa de spam.
        </p>
        <Link href="/login" className="text-accent text-sm hover:underline inline-flex items-center gap-1">
          <ArrowLeft className="w-3.5 h-3.5" /> Voltar ao login
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
        <p className="text-sm text-white/50 mt-1">Recuperar acesso</p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-8">
        <h2 className="text-lg font-semibold text-white mb-1.5">Esqueci minha senha</h2>
        <p className="text-sm text-white/50 mb-6">
          Digite seu email e enviaremos um link para você criar uma nova senha.
        </p>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="text-sm font-medium text-white/70 block mb-1.5">Email</label>
            <input
              id="email"
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              className={inputClass}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-primary-dark
                       hover:bg-accent-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                       flex items-center justify-center gap-2"
          >
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" />Enviando...</> : 'Enviar link de redefinição'}
          </button>
        </form>
      </div>

      <p className="text-center text-xs text-white/50 mt-6">
        Lembrou a senha?{' '}
        <Link href="/login" className="text-accent hover:underline">Entrar</Link>
      </p>
    </div>
  )
}
