'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { ConteudoPreview } from '@/components/conteudos/ConteudoPreview'
import { PacoteTikTok } from '@/components/conteudos/PacoteTikTok'
import { STATUS_LABELS, type StatusConteudo } from '@/types'
import { useGuardModulo } from '@/hooks/useGuardModulo'

/**
 * P2.15.3 — Detalhe de um conteúdo. O botão "Ver" (Banco de Conteúdos e
 * Calendário) apontava para esta rota, que não existia (404).
 */
export default function ConteudoDetalhePage() {
  useGuardModulo('conteudos')
  const { id } = useParams<{ id: string }>()
  const [conteudo, setConteudo] = useState<Record<string, unknown> | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    fetch(`/api/conteudos/${id}`)
      .then(async (r) => {
        const dados = await r.json().catch(() => ({}))
        if (!vivo) return
        if (r.ok) setConteudo(dados)
        else setErro(r.status === 404 ? 'Este conteúdo não existe mais ou não é deste workspace.' : 'Não consegui carregar este conteúdo.')
      })
      .catch(() => vivo && setErro('Sem conexão. Tente de novo.'))
    return () => {
      vivo = false
    }
  }, [id])

  return (
    <div className="space-y-4 max-w-4xl">
      <Link href="/conteudos" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-white">
        <ArrowLeft className="w-4 h-4" />
        Voltar para o Banco de Conteúdos
      </Link>
      {erro ? (
        <div className="card-stat text-sm text-muted-foreground">{erro}</div>
      ) : !conteudo ? (
        <div className="card-stat flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando…
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Status: <span className="text-white">{STATUS_LABELS[conteudo.status as StatusConteudo] ?? String(conteudo.status)}</span>
          </p>
          <ConteudoPreview conteudo={conteudo} />
          {/* P2.17.1: modo assistido do TikTok (só leitura). */}
          <PacoteTikTok conteudoId={id} />
        </>
      )}
    </div>
  )
}
