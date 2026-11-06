'use client'

import { useEffect, useState } from 'react'
import { Indicador, type Tom } from '@/components/shared/Ux'

/**
 * P2.17.13 / P2.17.14 — Integrações em linguagem executiva: status · impacto
 * · próxima ação, e o contador "X de Y" calculado da MESMA lista que gera as
 * linhas e os cartões (lib/integracoes-da-tela.ts) — nunca um número fixo.
 * Cinco status: CONECTADO, PRECISA DE VOCÊ, AGUARDANDO PLATAFORMA,
 * BLOQUEADO EXTERNAMENTE, NÃO CONFIGURADO.
 */
type Situacao = 'CONECTADO' | 'PRECISA_DE_VOCE' | 'AGUARDANDO_PLATAFORMA' | 'BLOQUEADO_EXTERNAMENTE' | 'NAO_CONFIGURADO'
interface Linha { id: string; nome: string; situacao: Situacao; impacto: string; proximaAcao: string }
interface Resumo { linhas: Linha[]; total: number; conectadas: number; porSituacao: Record<Situacao, number> }
export const SITUACAO_DA_INTEGRACAO: Record<Situacao, { rotulo: string; tom: Tom }> = {
  CONECTADO: { rotulo: 'CONECTADO', tom: 'ok' },
  PRECISA_DE_VOCE: { rotulo: 'PRECISA DE VOCÊ', tom: 'atencao' },
  AGUARDANDO_PLATAFORMA: { rotulo: 'AGUARDANDO PLATAFORMA', tom: 'atencao' },
  BLOQUEADO_EXTERNAMENTE: { rotulo: 'BLOQUEADO EXTERNAMENTE', tom: 'bloqueado' },
  NAO_CONFIGURADO: { rotulo: 'NÃO CONFIGURADO', tom: 'neutro' },
}
const ORDEM: Situacao[] = ['PRECISA_DE_VOCE', 'AGUARDANDO_PLATAFORMA', 'BLOQUEADO_EXTERNAMENTE', 'NAO_CONFIGURADO', 'CONECTADO']

export function ResumoDasIntegracoes({ onConfigurar }: { onConfigurar?: (id: string) => void }) {
  const [r, setR] = useState<Resumo | null>(null)
  useEffect(() => {
    fetch('/api/resumos/integracoes').then(async (res) => res.ok && setR(await res.json())).catch(() => null)
  }, [])
  if (!r) return null
  // O que bloqueia dinheiro/automação primeiro.
  const linhas = [...r.linhas].sort((a, b) => ORDEM.indexOf(a.situacao) - ORDEM.indexOf(b.situacao))
  return (
    <section className="space-y-2" aria-label="Situação das integrações">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-sm text-white" data-testid="contador-integracoes"><b>{r.conectadas} de {r.total}</b> integrações conectadas</p>
        {ORDEM.filter((s) => s !== 'CONECTADO' && r.porSituacao[s] > 0).map((s) => (
          <span key={s} className="text-[11px] text-muted-foreground">{r.porSituacao[s]} {SITUACAO_DA_INTEGRACAO[s].rotulo.toLowerCase()}</span>
        ))}
      </div>
      <div className="card-stat divide-y divide-border p-0">
        {linhas.map((l) => (
          <div key={l.id} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 px-4 py-3">
            <p className="text-sm font-semibold text-white sm:w-48 shrink-0">{l.nome}</p>
            <div className="sm:w-52 shrink-0"><Indicador nome="" estado={SITUACAO_DA_INTEGRACAO[l.situacao].rotulo} tom={SITUACAO_DA_INTEGRACAO[l.situacao].tom} /></div>
            <div className="min-w-0 flex-1 text-xs break-words">
              <p className="text-white/85">{l.impacto}</p>
              <p className="text-muted-foreground">Próxima ação: {l.proximaAcao}</p>
            </div>
            {onConfigurar && (
              <button type="button" onClick={() => onConfigurar(l.id)} className="self-start sm:self-center shrink-0 text-xs text-accent hover:underline">Configurar</button>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
