'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, ArrowRight } from 'lucide-react'
import { useGuardModulo } from '@/hooks/useGuardModulo'
import { useModulosLiberados } from '@/hooks/useModulosLiberados'
import { MENU_PRINCIPAL, modulosDaArea } from '@/lib/navegacao'
import { TituloDeSecao } from '@/components/shared/Ux'

/**
 * P2.17.13 — Home de CONTEÚDO: a esteira numa leitura só. O fluxo principal
 * é o do Patrono (seleciona → gera → valida → apresenta/publica); "Gerar
 * manualmente" é modo avançado para teste, exceção ou pedido específico.
 */
interface Etapa { total: number; detalhe: string | null }
interface Resumo { aguardandoGeracao: Etapa; emGeracao: Etapa; gerados: Etapa; aguardandoAprovacao: Etapa; agendados: Etapa; publicados: Etapa }
const ETAPAS: [keyof Resumo, string, string][] = [
  ['aguardandoGeracao', 'Aguardando geração', '/precisa-de-voce'],
  ['emGeracao', 'Em geração', '/torre'],
  ['gerados', 'Gerados', '/conteudos'],
  ['aguardandoAprovacao', 'Aguardando aprovação', '/precisa-de-voce'],
  ['agendados', 'Agendados', '/calendario'],
  ['publicados', 'Publicados', '/conteudos'],
]
const DESCRICAO: Record<string, string> = {
  '/conteudos': 'Tudo o que foi criado: produto, canal, status, data e resultado.',
  '/videos': 'Todo vídeo real do fluxo, de qualquer origem (FFmpeg, mídia autorizada, upload, IA quando ligada).',
  '/calendario': 'O Patrono monta a agenda; você ajusta se quiser.',
  '/conteudos/gerar': 'Modo manual/avançado: para testes, exceções ou um pedido específico seu.',
}

export default function ConteudoPage() {
  useGuardModulo(modulosDaArea('/conteudo'))
  const { temAcesso } = useModulosLiberados()
  const [r, setR] = useState<Resumo | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  useEffect(() => {
    fetch('/api/resumos/conteudo')
      .then(async (res) => (res.ok ? setR(await res.json()) : setErro('Não consegui carregar a esteira.')))
      .catch(() => setErro('Sem conexão.'))
  }, [])
  const subareas = MENU_PRINCIPAL.find((a) => a.href === '/conteudo')!.filhos.filter((f) => temAcesso(f.modulo))
  return (
    <div className="w-full max-w-5xl space-y-5">
      <section className="space-y-2" aria-label="Esteira de conteúdo">
        <TituloDeSecao>Esteira</TituloDeSecao>
        {erro ? <p className="card-stat text-sm text-muted-foreground">{erro}</p> : !r ? (
          <p className="card-stat flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Contando…</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {ETAPAS.map(([k, rotulo, href]) => (
              <Link key={k} href={href} className="rounded-xl border border-border bg-card p-3 hover:bg-white/5">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{rotulo}</p>
                <p className="text-2xl font-bold text-white tabular-nums">{r[k].total}</p>
                {r[k].detalhe && <p className="text-[10px] text-muted-foreground">{r[k].detalhe}</p>}
              </Link>
            ))}
          </div>
        )}
      </section>
      <section className="grid grid-cols-1 sm:grid-cols-2 gap-3" aria-label="Subáreas">
        {subareas.map((f) => (
          <Link key={f.href} href={f.href} className="card-stat hover:bg-white/5">
            <p className="text-sm font-semibold text-white flex items-center gap-1">{f.label} <ArrowRight className="w-3 h-3" /></p>
            <p className="text-xs text-muted-foreground">{DESCRICAO[f.href]}</p>
          </Link>
        ))}
      </section>
    </div>
  )
}
