'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import Link from 'next/link'
import { Loader2, AlertCircle, Eye, EyeOff } from 'lucide-react'
import { BrandMark } from '@/components/shared/BrandMark'

const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'Senha muito curta'),
})

type LoginForm = z.infer<typeof loginSchema>

export default function LoginPage() {
  const router = useRouter()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) })

  async function onSubmit(data: LoginForm) {
    setLoading(true)
    setError('')

    let result: Awaited<ReturnType<typeof signIn>>
    try {
      result = await signIn('credentials', {
        email: data.email.trim(),
        password: data.password,
        redirect: false,
      })
    } catch {
      setError('Sem conexão. Tente de novo.')
      setLoading(false)
      return
    }

    if (result?.error) {
      if (result.error.includes('PENDENTE')) {
        setError('Sua conta está aguardando aprovação do administrador.')
      } else if (result.error.includes('LIMITE')) {
        setError('Muitas tentativas. Aguarde alguns minutos e tente de novo.')
      } else if (result.error.includes('BLOQUEADO')) {
        setError('Sua conta foi bloqueada. Entre em contato com o administrador.')
      } else {
        setError('Email ou senha inválidos.')
      }
      setLoading(false)
    } else {
      // P2.15.3: volta para onde a usuária queria ir (só caminho interno).
      const destino = new URLSearchParams(window.location.search).get('callbackUrl') ?? ''
      let caminho = '/torre'
      try {
        const u = new URL(destino, window.location.origin)
        if (u.origin === window.location.origin && u.pathname !== '/login') caminho = u.pathname + u.search
      } catch {}
      router.push(caminho)
    }
  }

  return (
    <div className="w-full max-w-sm">
      {/* Logo */}
      <div className="text-center mb-8">
        <div className="inline-flex justify-center mb-4">
          <BrandMark size={56} />
        </div>
        <h1 className="text-2xl font-bold text-white">Patrono Seller IA</h1>
        <p className="text-sm text-white/50 mt-1">Seu assistente de vendas inteligente</p>
      </div>

      {/* Card */}
      <div className="rounded-2xl border border-border bg-card p-8">
        <h2 className="text-lg font-semibold text-white mb-6">Entrar na plataforma</h2>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label htmlFor="email" className="text-sm font-medium text-white/70 block mb-1.5">Email</label>
            <input
              {...register('email')}
              id="email"
              type="email"
              autoComplete="username"
              placeholder="admin@patronosellerai.com"
              className="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm
                         text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-accent
                         transition-colors"
            />
            {errors.email && (
              <p className="text-danger text-xs mt-1">{errors.email.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="password" className="text-sm font-medium text-white/70 block mb-1.5">Senha</label>
            <div className="relative">
              <input
                {...register('password')}
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="••••••••"
                className="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 pr-10 text-sm
                           text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-accent
                           transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                tabIndex={-1}
                title={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/70 hover:text-white transition-colors"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {errors.password && (
              <p className="text-danger text-xs mt-1">{errors.password.message}</p>
            )}
            <div className="text-right mt-1.5">
              <Link href="/esqueci-senha" className="text-xs text-white/50 hover:text-accent transition-colors">
                Esqueci a senha
              </Link>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5">
              <AlertCircle className="w-4 h-4 text-danger shrink-0" />
              <p className="text-danger text-sm">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-primary-dark
                       hover:bg-accent-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                       flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Entrando...
              </>
            ) : (
              'Entrar'
            )}
          </button>
        </form>
      </div>

      <p className="text-center text-xs text-white/50 mt-6">
        Não tem acesso?{' '}
        <Link href="/register" className="text-accent hover:underline">
          Solicitar cadastro
        </Link>
      </p>
      <p className="text-center text-xs text-white/30 mt-2">
        Patrono Seller IA — Grupo Patrono
      </p>
    </div>
  )
}
