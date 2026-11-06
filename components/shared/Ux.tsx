'use client'

/**
 * P2.17.13 — Peças comuns da experiência: a mesma hierarquia em todas as
 * telas (decisão → dinheiro → status → próxima ação → detalhes).
 *
 *  - <Kpi>: número grande; sem dado oficial mostra "Aguardando dados
 *    oficiais" (curto) — nunca zero inventado.
 *  - <Indicador>: bolinha + rótulo (status compacto).
 *  - <Detalhes>: o técnico fica recolhido ("Ver detalhes").
 *  - <DadosPendentes>: UMA linha "Dados oficiais pendentes" no lugar de
 *    repetir "a plataforma ainda não forneceu" campo por campo.
 *  - <SeloDecisao>: PRIORIZAR | TESTAR | AGUARDAR | EVITAR.
 */
import Link from 'next/link'
import { cn } from '@/lib/utils'

/**
 * P2.17.14 — TERMINOLOGIA ÚNICA (nunca misturar):
 *  DESCONHECIDO   = não temos dado (sem fonte oficial)  → SEM_DADO_OFICIAL
 *  ZERO           = temos dado e é zero                  → mostrar 0 / R$ 0,00
 *  SEM REGISTRO   = base manual/ledger sem lançamento    → NENHUM_REGISTRO
 *  NÃO CONFIRMADO = não conseguimos comprovar o status   → NAO_CONFIRMADO
 *  BLOQUEADO EXTERNAMENTE · PRECISA DE VOCÊ · CONTINGÊNCIA · AUTOMÁTICO · ASSISTIDO
 */
export const SEM_DADO_OFICIAL = 'Aguardando dados oficiais'
export const NENHUM_REGISTRO = 'Nenhum resultado registrado'
export const NAO_CONFIRMADO = 'status não confirmado'

export const reaisOuNull = (v: number | null | undefined) => (v === null || v === undefined ? null : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
export const pctOuNull = (v: number | null | undefined) => (v === null || v === undefined ? null : `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`)

/**
 * `semValor`: o que dizer quando `valor` é null — por padrão "Aguardando
 * dados oficiais" (DESCONHECIDO); numa base manual sem lançamento, passe
 * NENHUM_REGISTRO. Zero conhecido chega como 0 e aparece como 0.
 * Valores longos (nome de produto) ficam em até 2 linhas, com o texto
 * completo no `title`.
 */
export function Kpi({ rotulo, valor, dica, destaque, semValor = SEM_DADO_OFICIAL }: { rotulo: string; valor: string | number | null | undefined; dica?: string | null; destaque?: boolean; semValor?: string }) {
  const vazio = valor === null || valor === undefined || valor === ''
  const texto = vazio ? '' : String(valor)
  const longo = texto.length > 18
  return (
    <div className={cn('rounded-xl border border-border bg-card p-3 min-w-0', destaque && 'border-accent/40')}>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{rotulo}</p>
      {vazio ? (
        <p className="mt-1 text-xs text-muted-foreground">{semValor}</p>
      ) : (
        <p title={texto} className={cn('mt-0.5 font-bold text-white tabular-nums break-words line-clamp-2', longo ? 'text-sm' : 'text-xl')}>{valor}</p>
      )}
      {dica && <p title={dica} className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2 break-words">{dica}</p>}
    </div>
  )
}

const COR = { ok: 'bg-accent', atencao: 'bg-warning', bloqueado: 'bg-danger', neutro: 'bg-white/40' } as const
export type Tom = keyof typeof COR

export function Indicador({ nome, estado, tom, href }: { nome: string; estado: string; tom: Tom; href?: string }) {
  const corpo = (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] text-white/90">
      <span className={cn('h-2 w-2 rounded-full', COR[tom])} aria-hidden />
      <b className="font-semibold">{nome}</b>
      <span className="text-muted-foreground">{estado}</span>
    </span>
  )
  return href ? <Link href={href} className="hover:opacity-80">{corpo}</Link> : corpo
}

export function Detalhes({ titulo = 'Ver detalhes', children, className }: { titulo?: string; children: React.ReactNode; className?: string }) {
  return (
    <details className={cn('text-xs text-muted-foreground', className)}>
      <summary className="cursor-pointer select-none hover:text-white">{titulo}</summary>
      <div className="mt-2 space-y-1">{children}</div>
    </details>
  )
}

export function DadosPendentes({ campos, fonte }: { campos: string[]; fonte?: string }) {
  if (campos.length === 0) return null
  return (
    <details className="text-[11px] text-muted-foreground">
      <summary className="cursor-pointer select-none hover:text-white">Dados oficiais pendentes ({campos.length})</summary>
      <p className="mt-1">{fonte ? `${fonte} ainda não forneceu: ` : 'Ainda sem fonte oficial: '}{campos.join(', ')}.</p>
    </details>
  )
}

export type Decisao = 'PRIORIZAR' | 'TESTAR' | 'AGUARDAR' | 'EVITAR'
const COR_DECISAO: Record<Decisao, string> = {
  PRIORIZAR: 'border-accent/40 bg-accent/15 text-accent',
  TESTAR: 'border-blue-400/40 bg-blue-400/10 text-blue-300',
  AGUARDAR: 'border-warning/40 bg-warning/10 text-warning',
  EVITAR: 'border-danger/40 bg-danger/10 text-danger',
}
export function SeloDecisao({ decisao }: { decisao: Decisao }) {
  return <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wide', COR_DECISAO[decisao])}>{decisao}</span>
}

export function TituloDeSecao({ children, acao }: { children: React.ReactNode; acao?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{children}</h2>
      {acao}
    </div>
  )
}

/** Faixa discreta para modos manuais/contingência (nunca o fluxo principal). */
export function AvisoDeContingencia({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
      <b>{titulo}.</b> <span className="text-white/80">{children}</span>
    </div>
  )
}
