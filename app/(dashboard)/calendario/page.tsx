'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  isSameMonth, isToday, isSameDay, addMonths, subMonths,
} from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useGuardModulo } from '@/hooks/useGuardModulo'
import { AgendaSugerida } from '@/components/calendario/AgendaSugerida'
import { STATUS_LABELS, type StatusConteudo } from '@/types'
import type { PecaEditorial, SituacaoEditorial } from '@/lib/calendario-editorial'

// P2.53: cor de cada situação das peças da Central (três controles + aprovação da titular).
const COR_DA_SITUACAO: Record<SituacaoEditorial, string> = {
  EM_PRODUCAO: 'bg-slate-500/80', RETIDO: 'bg-amber-600/80', AGUARDANDO_TITULAR: 'bg-sky-600/80', APROVADO: 'bg-emerald-600/80',
  PUBLICANDO: 'bg-emerald-500/80', PUBLICADO: 'bg-emerald-700/80', REJEITADO: 'bg-zinc-600/80', FALHOU: 'bg-red-600/80',
}

interface Conteudo {
  atrasado?: boolean
  id: string
  redeSocial: string
  status: string
  dataAgendamento: string | null
  dataPublicacao: string | null
  estilo?: string | null
  produto: { nome: string }
}

const REDE_CORES: Record<string, string> = {
  'TikTok': 'bg-pink-500/80',
  'Instagram Reels': 'bg-purple-500/80',
  'YouTube Shorts': 'bg-red-500/80',
  'WhatsApp': 'bg-green-600/80',
  'Facebook': 'bg-blue-600/80',
  'Marketplace': 'bg-orange-500/80',
  'Landing Page': 'bg-blue-500/80',
}

export default function CalendarioPage() {
  useGuardModulo('calendario')
  const [mes, setMes] = useState(new Date())
  const [conteudos, setConteudos] = useState<Conteudo[]>([])
  const [selecionado, setSelecionado] = useState<Date | null>(null)
  const [pecas, setPecas] = useState<PecaEditorial[]>([])

  useEffect(() => {
    fetch('/api/calendario/editorial')
      .then(async (r) => (r.ok ? setPecas(await r.json()) : null))
      .catch(() => null)
  }, [])

  useEffect(() => {
    fetch('/api/conteudos')
      .then((r) => r.json())
      .then((data) => setConteudos(Array.isArray(data) ? data : []))
      .catch(() => setConteudos([]))
  }, [])

  const diasDoMes = eachDayOfInterval({
    start: startOfMonth(mes),
    end: endOfMonth(mes),
  })

  function conteudosDoDia(dia: Date) {
    return conteudos.filter((c) => {
      const data = c.dataAgendamento || c.dataPublicacao
      return data && isSameDay(new Date(data), dia)
    })
  }

  const conteudosSelecionados = selecionado ? conteudosDoDia(selecionado) : []
  const pecasDoDia = (dia: Date) => pecas.filter((p) => p.quando && isSameDay(new Date(p.quando), dia))
  const pecasSelecionadas = selecionado ? pecasDoDia(selecionado) : []
  const pecasSemData = pecas.filter((p) => !p.quando && p.situacao !== 'REJEITADO')

  return (
    <div className="space-y-5 max-w-5xl">
      {/* P2.17.23: agenda montada pelo Patrono (amostras, missões, Natal, vídeos prontos). */}
      <AgendaSugerida />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white capitalize">
            {format(mes, 'MMMM yyyy', { locale: ptBR })}
          </h2>
          <p className="text-sm text-muted-foreground">Calendário editorial</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setMes(subMonths(mes, 1))}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={() => setMes(new Date())}>Hoje</Button>
          <Button size="sm" variant="outline" onClick={() => setMes(addMonths(mes, 1))}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Calendário */}
        <div className="lg:col-span-2 card-stat">
          {/* Dias da semana */}
          <div className="grid grid-cols-7 mb-2">
            {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((d) => (
              <div key={d} className="text-center text-xs font-medium text-muted-foreground py-2">{d}</div>
            ))}
          </div>

          {/* Offset do primeiro dia */}
          <div className="grid grid-cols-7 gap-1">
            {[...Array(startOfMonth(mes).getDay())].map((_, i) => (
              <div key={`empty-${i}`} />
            ))}
            {diasDoMes.map((dia) => {
              const eventos = conteudosDoDia(dia)
              const doDia = pecasDoDia(dia)
              const isSel = selecionado && isSameDay(dia, selecionado)
              return (
                <button key={dia.toISOString()}
                  onClick={() => setSelecionado(isSel ? null : dia)}
                  className={cn(
                    'relative rounded-lg p-1 min-h-[52px] text-left transition-colors',
                    !isSameMonth(dia, mes) && 'opacity-30',
                    isToday(dia) && 'bg-accent/10 border border-accent/40',
                    isSel && 'bg-accent/20 border border-accent',
                    !isSel && !isToday(dia) && 'hover:bg-secondary/50'
                  )}>
                  <span className={cn(
                    'text-xs font-medium block mb-1',
                    isToday(dia) ? 'text-accent' : 'text-foreground'
                  )}>
                    {format(dia, 'd')}
                  </span>
                  <div className="space-y-0.5">
                    {doDia.slice(0, 2).map((p) => (
                      <div key={p.id} title={p.rotulo} className={cn('text-[9px] px-1 py-0.5 rounded truncate text-white', COR_DA_SITUACAO[p.situacao])}>
                        {p.titulo}
                      </div>
                    ))}
                    {eventos.slice(0, Math.max(0, 2 - doDia.length)).map((e) => (
                      <div key={e.id} className={cn(
                        'text-[9px] px-1 py-0.5 rounded truncate text-white',
                        REDE_CORES[e.redeSocial] ?? 'bg-gray-500/80'
                      )}>
                        {e.produto.nome}
                      </div>
                    ))}
                    {eventos.length + doDia.length > 2 && (
                      <p className="text-[9px] text-muted-foreground pl-1">+{eventos.length + doDia.length - 2} mais</p>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Painel lateral */}
        <div className="card-stat">
          {selecionado ? (
            <>
              <h3 className="font-semibold text-white text-sm mb-1 capitalize">
                {format(selecionado, "d 'de' MMMM", { locale: ptBR })}
              </h3>
              <p className="text-xs text-muted-foreground mb-4">
                {conteudosSelecionados.length + pecasSelecionadas.length} conteúdo(s)
              </p>
              {pecasSelecionadas.length > 0 && (
                <div className="space-y-3 mb-3">
                  {pecasSelecionadas.map((p) => <CartaoDaPeca key={p.id} p={p} />)}
                </div>
              )}
              {conteudosSelecionados.length === 0 && pecasSelecionadas.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum conteúdo neste dia.</p>
              ) : (
                <div className="space-y-3">
                  {conteudosSelecionados.map((c) => (
                    <div key={c.id} className="rounded-lg border border-border p-3">
                      <p className="text-sm font-medium text-white">{c.produto.nome}</p>
                      {/* P2.17.13: plataforma, horário e tipo de publicação. */}
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {c.redeSocial}
                        {(c.dataAgendamento || c.dataPublicacao) ? ` · ${format(new Date((c.dataAgendamento || c.dataPublicacao)!), 'HH:mm')}` : ''}
                        {c.estilo ? ` · ${c.estilo}` : ''}
                      </p>
                      <div className="flex items-center justify-between mt-2">
                        <span className={cn(
                          'text-[10px] px-2 py-0.5 rounded-full text-white',
                          REDE_CORES[c.redeSocial] ?? 'bg-gray-500'
                        )}>
                          {STATUS_LABELS[(c.atrasado ? 'publicacao_atrasada' : c.status) as StatusConteudo] ?? c.status}
                        </span>
                        <Link href={`/conteudos/${c.id}`}
                          className="text-xs text-accent hover:underline">Ver</Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-40 text-center">
              <Calendar className="w-8 h-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">Clique em um dia para ver os conteúdos</p>
            </div>
          )}
        </div>
      </div>

      {/* P2.53: peças da Central sem data definida (o horário é decidido ao aprovar). */}
      {pecasSemData.length > 0 && (
        <div className="card-stat space-y-2">
          <p className="text-sm font-semibold text-white">Sem data definida ({pecasSemData.length})</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {pecasSemData.map((p) => <CartaoDaPeca key={p.id} p={p} />)}
          </div>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">O calendário só mostra. Aprovar, pedir ajuste ou publicar é sempre na Central de Operação, e nenhuma peça é publicada sem os três controles e a sua aprovação.</p>
    </div>
  )
}

function CartaoDaPeca({ p }: { p: PecaEditorial }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-sm font-medium text-white">{p.titulo}</p>
      <p className="text-xs text-muted-foreground mt-0.5">
        {p.canal} · versão {p.versao}
        {p.quando ? ` · ${format(new Date(p.quando), 'dd/MM HH:mm')}${p.origemDaData === 'PUBLICADO' ? ' (publicado)' : ' (planejado)'}` : ''}
      </p>
      <div className="flex items-center justify-between mt-2">
        <span className={cn('text-[10px] px-2 py-0.5 rounded-full text-white', COR_DA_SITUACAO[p.situacao])}>{p.rotulo}</span>
        <Link href={p.link} className="text-xs text-accent hover:underline">Abrir na Operação</Link>
      </div>
      {p.motivos.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[11px] text-warning">
          {p.motivos.slice(0, 3).map((m) => <li key={m}>• {m}</li>)}
        </ul>
      )}
    </div>
  )
}
