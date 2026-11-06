'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, ArrowRight } from 'lucide-react'
import { useGuardModulo } from '@/hooks/useGuardModulo'
import { useModulosLiberados } from '@/hooks/useModulosLiberados'
import { FERRAMENTAS, modulosDaArea } from '@/lib/navegacao'
import { Indicador, type Tom } from '@/components/shared/Ux'

/**
 * P2.17.13 — Ferramentas tem página própria: clicar em "Ferramentas" muda a
 * tela (antes só abria o submenu). São ferramentas SECUNDÁRIAS: nenhuma é o
 * motor do Patrono. Cada cartão diz o que faz, se está disponível e por quê.
 */
interface Ferramenta { href: string; nome: string; funcao: string; natureza: string; situacao: 'ATIVA' | 'INDISPONIVEL' | 'NAO_CONFIGURADA'; motivo: string }
const SITUACAO: Record<Ferramenta['situacao'], { rotulo: string; tom: Tom }> = {
  ATIVA: { rotulo: 'disponível', tom: 'ok' },
  NAO_CONFIGURADA: { rotulo: 'não configurada', tom: 'atencao' },
  INDISPONIVEL: { rotulo: 'indisponível', tom: 'bloqueado' },
}

export default function FerramentasPage() {
  useGuardModulo(modulosDaArea('/ferramentas'))
  const { temAcesso } = useModulosLiberados()
  const [itens, setItens] = useState<Ferramenta[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  useEffect(() => {
    fetch('/api/resumos/ferramentas')
      .then(async (r) => (r.ok ? setItens(await r.json()) : setErro('Não consegui carregar as ferramentas.')))
      .catch(() => setErro('Sem conexão.'))
  }, [])
  if (erro) return <p className="card-stat text-sm text-muted-foreground">{erro}</p>
  if (!itens) return <p className="card-stat flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Carregando…</p>
  const liberadas = itens.filter((f) => { const n = FERRAMENTAS.find((x) => x.href === f.href); return !n || temAcesso(n.modulo) })
  return (
    <div className="w-full max-w-4xl space-y-4">
      <p className="text-sm text-muted-foreground">Ferramentas auxiliares. O trabalho principal (escolher, gerar, checar e publicar) o Patrono faz em Oportunidades, Conteúdo e Precisa de você.</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {liberadas.map((f) => (
          <div key={f.href} className="card-stat flex flex-col gap-2">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold text-white">{f.nome}</p>
              <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">{f.natureza}</span>
            </div>
            <p className="text-xs text-white/80">{f.funcao}</p>
            <Indicador nome="" estado={SITUACAO[f.situacao].rotulo} tom={SITUACAO[f.situacao].tom} />
            <p className="text-[11px] text-muted-foreground flex-1">{f.motivo}</p>
            <Link href={f.href} className="inline-flex items-center gap-1 text-xs text-accent hover:underline">Abrir <ArrowRight className="w-3 h-3" /></Link>
          </div>
        ))}
      </div>
    </div>
  )
}
