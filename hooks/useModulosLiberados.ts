'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { MODULO_KEYS, type ModuloKey } from '@/lib/modulos'

// Módulos liberados para o usuário logado (admin sempre tem todos, sem
// esperar a chamada). Enquanto carrega, assume tudo liberado — evita
// "piscar" a tela como bloqueada antes da resposta chegar.
export function useModulosLiberados() {
  const { data: session } = useSession()
  const [modulos, setModulos] = useState<ModuloKey[]>(MODULO_KEYS)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!session) return
    if (session.user.role === 'admin') {
      setModulos(MODULO_KEYS)
      setLoaded(true)
      return
    }
    fetch('/api/permissoes')
      .then((r) => r.json())
      .then((d) => {
        setModulos(Array.isArray(d.modulos) ? d.modulos : MODULO_KEYS)
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [session])

  function temAcesso(modulo: ModuloKey) {
    return modulos.includes(modulo)
  }

  return { modulos, loaded, temAcesso }
}
