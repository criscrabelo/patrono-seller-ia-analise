'use client'

import { useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useModulosLiberados } from './useModulosLiberados'
import type { ModuloKey } from '@/lib/modulos'
import { rotaInicial } from '@/lib/navegacao'

// Redireciona para a Home (Torre; sem a Torre, a primeira área liberada) se o papel do usuário não tiver este módulo
// liberado. Não faz nada enquanto a sessão/permissões ainda carregam.
// P2.17.13: aceita uma lista (página-resumo): basta UM módulo liberado.
export function useGuardModulo(modulo: ModuloKey | ModuloKey[]) {
  const { status } = useSession()
  const router = useRouter()
  const { modulos, loaded } = useModulosLiberados()

  useEffect(() => {
    if (status === 'loading' || !loaded) return
    const lista = Array.isArray(modulo) ? modulo : [modulo]
    if (!lista.some((m) => modulos.includes(m))) {
      router.replace(rotaInicial((m) => modulos.includes(m)))
    }
  }, [status, loaded, modulos, Array.isArray(modulo) ? modulo.join(',') : modulo])
}
