'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useGuardModulo } from '@/hooks/useGuardModulo'
import { Kpi, TituloDeSecao, Detalhes, reaisOuNull, pctOuNull, SEM_DADO_OFICIAL, NENHUM_REGISTRO } from '@/components/shared/Ux'
import { cn } from '@/lib/utils'

/**
 * P2.17.13 — Relatórios no modelo ATUAL (antes: contadores da tela antiga e
 * "métricas inseridas manualmente; integração em versões futuras"). Agora:
 * resultados por vídeo + fonte única de vendas/comissões + conteúdos e
 * publicações do período, vencedores do aprendizado (só com amostra mínima),
 * por categoria e por canal. Sem dado = "aguardando dados oficiais".
 */
interface Grupo { nome: string; videos: number; receita: number | null; vendas: number | null; views: number | null }
interface Relatorio {
  receita: number | null; comissao: number | null; vendas: number | null; conteudos: number; publicados: number; visualizacoes: number | null
  ctr: number | null; conversao: number | null; receitaPor1000Views: number | null; videosMedidos: number
  vencedores: { dimensao: string; vencedor: string; recomendacao: string }[]
  categorias: Grupo[]; canais: Grupo[]; origemDasMetricas: string | null
}
const PERIODOS = [['hoje', 'Hoje'], ['7', '7 dias'], ['30', '30 dias'], ['custom', 'Personalizado']] as const
const DIMENSAO: Record<string, string> = { produto: 'Produto', categoria: 'Categoria', estrutura: 'Formato', gancho: 'Gancho', cta: 'CTA', duracao: 'Duração', horario: 'Horário' }

function Tabela({ titulo, linhas }: { titulo: string; linhas: Grupo[] }) {
  return (
    <div className="card-stat space-y-2">
      <p className="text-sm font-semibold text-white">{titulo}</p>
      {linhas.length === 0 ? <p className="text-xs text-muted-foreground">{SEM_DADO_OFICIAL}</p> : (
        <ul className="space-y-1 text-xs">
          {linhas.map((l) => (
            <li key={l.nome} className="flex justify-between gap-2">
              <span className="text-white truncate">{l.nome}</span>
              <span className="text-muted-foreground shrink-0">{l.videos} vídeo(s) · {reaisOuNull(l.receita) ?? '—'} · {l.views?.toLocaleString('pt-BR') ?? '—'} views</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function RelatoriosPage() {
  useGuardModulo('relatorios')
  const [periodo, setPeriodo] = useState<(typeof PERIODOS)[number][0]>('30')
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  const [r, setR] = useState<Relatorio | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)

  useEffect(() => {
    if (periodo === 'custom' && !de) return
    const q = periodo === 'custom' ? `de=${de}${ate ? `&ate=${ate}` : ''}` : `periodo=${periodo}`
    setCarregando(true)
    fetch(`/api/resumos/relatorio?${q}`)
      .then(async (res) => {
        const d = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(d.error ?? 'Não consegui carregar o relatório.')
        setR(d)
        setErro(null)
      })
      .catch((e) => setErro((e as Error).message))
      .finally(() => setCarregando(false))
  }, [periodo, de, ate])

  return (
    <div className="w-full max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Período">
        {PERIODOS.map(([v, rotulo]) => (
          <button key={v} role="tab" aria-selected={periodo === v} onClick={() => setPeriodo(v)} className={cn('rounded-full border px-3 py-1 text-xs', periodo === v ? 'border-accent bg-accent/15 text-accent' : 'border-border text-muted-foreground hover:text-white')}>{rotulo}</button>
        ))}
        {periodo === 'custom' && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <input type="date" value={de} onChange={(e) => setDe(e.target.value)} className="rounded border border-border bg-background px-2 py-1 text-white" aria-label="De" />
            até
            <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="rounded border border-border bg-background px-2 py-1 text-white" aria-label="Até" />
          </span>
        )}
        {carregando && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
      </div>

      {erro && <p className="card-stat text-sm text-muted-foreground">{erro}</p>}
      {r && (
        <>
          <section aria-label="Resultado" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <Kpi rotulo="Receita" valor={reaisOuNull(r.receita)} destaque />
            {/* P2.17.14: vendas/comissão sem métrica oficial NEM registro = "nenhum registrado" (o ledger sabe que não há lançamento); views/CTR sem API = desconhecido. */}
            <Kpi rotulo="Comissão" valor={reaisOuNull(r.comissao)} semValor={NENHUM_REGISTRO} />
            <Kpi rotulo="Vendas" valor={r.vendas} semValor={NENHUM_REGISTRO} />
            <Kpi rotulo="Receita / 1.000 views" valor={reaisOuNull(r.receitaPor1000Views)} />
            <Kpi rotulo="Conversão" valor={pctOuNull(r.conversao)} />
            <Kpi rotulo="Conteúdos criados" valor={r.conteudos} />
            <Kpi rotulo="Publicados" valor={r.publicados} />
            <Kpi rotulo="Visualizações" valor={r.visualizacoes?.toLocaleString('pt-BR') ?? null} />
            <Kpi rotulo="CTR" valor={pctOuNull(r.ctr)} />
            <Kpi rotulo="Vídeos medidos" valor={r.videosMedidos} />
          </section>

          <section className="space-y-2" aria-label="Vencedores">
            <TituloDeSecao>Vencedores</TituloDeSecao>
            {r.vencedores.length === 0 ? (
              <p className="card-stat text-xs text-muted-foreground">Ainda sem vencedor: o Patrono só aponta com amostra mínima (3 vídeos com 500+ views). Formatos com melhor desempenho aparecem aqui quando houver dado.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {r.vencedores.map((v) => (
                  <div key={v.dimensao} className="card-stat"><p className="text-[11px] uppercase text-muted-foreground">{DIMENSAO[v.dimensao] ?? v.dimensao}</p><p className="text-sm text-white">{v.vencedor}</p><p className="text-[11px] text-muted-foreground">{v.recomendacao}</p></div>
                ))}
              </div>
            )}
          </section>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Tabela titulo="Por categoria" linhas={r.categorias} />
            <Tabela titulo="Por canal" linhas={r.canais} />
          </div>

          <Detalhes titulo="De onde vêm estes números">
            <p>Métricas dos vídeos: {r.origemDasMetricas ?? 'nenhum vídeo medido no período'}. Vendas e comissões: fonte única (registros oficiais ou informados por você). Nada aqui é estimativa.</p>
          </Detalhes>
        </>
      )}
    </div>
  )
}
