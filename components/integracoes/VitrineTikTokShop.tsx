'use client'

import { useEffect, useState } from 'react'
import { Detalhes, Indicador, reaisOuNull, type Tom } from '@/components/shared/Ux'

/**
 * Vitrine do TikTok Shop + GESTOR DE VITRINE (P2.17.15). Só mostra como "na
 * vitrine" o que o Get Showcase Products CONFIRMOU; screening do vendedor é
 * AGUARDANDO APROVAÇÃO. Desligada até a Affiliate Creator API ser autorizada.
 */
interface ItemDoGestor {
  productId: string; nome: string; estado: string; entrouEm: string | null; motivoEntrada: string | null
  comissao: { valor: number | null; percentual: number | null }; vendasDaLoja: number | null; conteudos: number
  views: number | null; cliques: number | null; vendas: number | null; comissaoGerada: number | null; receitaPor1000Views: number | null
  status: string | null; missao: string | null; sazonalidade: string | null; decisao: string; motivo: string; historico: { em: string; acao: string; estado?: string; decisao?: string; detalhe?: string }[]
}
interface Resposta {
  ligada: boolean; motivo: string | null; remocao: { ligada: boolean; motivo: string | null }; divergencias: string[]
  gestor: { itens: ItemDoGestor[]; entrar: { nome: string; motivo: string } | null }
}
const TOM_DECISAO: Record<string, Tom> = { ENTRAR: 'ok', MANTER: 'ok', ESCALAR: 'ok', OBSERVAR: 'neutro', SUBSTITUIR: 'atencao', REMOVER: 'bloqueado' }
const ROTULO_ESTADO: Record<string, string> = {
  CONFIRMADO_NA_VITRINE: 'na vitrine (confirmado)', AGUARDANDO_APROVACAO: 'AGUARDANDO APROVAÇÃO do vendedor', ENVIADO: 'enviado — conferindo', ENVIO_INCERTO: 'envio incerto — conferindo',
  NAO_ENCONTRADO_NA_VITRINE: 'não encontrado na vitrine', FALHOU: 'falhou', SELECIONADO: 'selecionado', REMOCAO_ENVIADA: 'remoção enviada', REMOCAO_INCERTA: 'remoção incerta',
}
const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—')
const num = (v: number | null) => (v === null ? 'aguardando dados oficiais' : v.toLocaleString('pt-BR'))

export function VitrineTikTokShop() {
  const [d, setD] = useState<Resposta | null>(null)
  useEffect(() => {
    fetch('/api/tiktok/vitrine').then(async (r) => r.ok && setD(await r.json())).catch(() => null)
  }, [])
  if (!d) return null
  const itens = d.gestor?.itens ?? []
  return (
    <section className="card-stat space-y-2" aria-label="Vitrine do TikTok Shop">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-white">Vitrine do TikTok Shop · Gestor de Vitrine</p>
        <Indicador nome="" estado={d.ligada ? 'automática ligada' : 'aguardando autorização da API'} tom={d.ligada ? 'ok' : 'neutro'} />
      </div>
      {!d.ligada && <p className="text-[11px] text-muted-foreground">{d.motivo}</p>}
      <p className="text-[11px] text-muted-foreground">Remoção: {d.remocao.ligada ? 'automática ligada' : `só recomendação — ${d.remocao.motivo}`}</p>
      {d.divergencias.map((x) => <p key={x} className="text-[11px] text-warning">{x}</p>)}
      {d.gestor?.entrar && <p className="text-xs text-white/85">Próximo a ENTRAR: <b>{d.gestor.entrar.nome}</b> <span className="text-muted-foreground">— {d.gestor.entrar.motivo}</span></p>}
      {itens.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhum produto na vitrine pelo Patrono ainda.</p>
      ) : (
        <ul className="divide-y divide-border text-xs">
          {itens.map((i) => (
            <li key={i.productId} className="py-2 space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-white truncate min-w-0 flex-1" title={i.nome}>{i.nome}</span>
                <Indicador nome="" estado={ROTULO_ESTADO[i.estado] ?? i.estado} tom={i.estado === 'CONFIRMADO_NA_VITRINE' ? 'ok' : 'atencao'} />
                <Indicador nome="" estado={i.decisao} tom={TOM_DECISAO[i.decisao] ?? 'neutro'} />
              </div>
              <p className="text-muted-foreground">{i.motivo}</p>
              <Detalhes titulo="detalhes">
                <p>Entrou: {quando(i.entrouEm)}{i.motivoEntrada ? ` · ${i.motivoEntrada}` : ''}</p>
                <p>Comissão: {reaisOuNull(i.comissao.valor) ?? (i.comissao.percentual !== null ? `${i.comissao.percentual}%` : 'aguardando dados oficiais')} · vendas da loja: {num(i.vendasDaLoja)} · conteúdos: {i.conteudos}</p>
                <p>Nossos vídeos: views {num(i.views)} · cliques {num(i.cliques)} · vendas {num(i.vendas)} · comissão {reaisOuNull(i.comissaoGerada) ?? 'aguardando dados oficiais'} · R$/1.000 views {reaisOuNull(i.receitaPor1000Views) ?? '—'}</p>
                <p>Status econômico: {i.status ?? 'TESTANDO'} · missão: {i.missao ?? '—'} · sazonalidade: {i.sazonalidade ?? '—'}</p>
                <ul className="mt-1 space-y-0.5">{i.historico.map((h, k) => <li key={k}>{quando(h.em)} · {h.acao}{h.decisao ? ` → ${h.decisao}` : h.estado ? ` → ${h.estado}` : ''}{h.detalhe ? ` · ${h.detalhe}` : ''}</li>)}</ul>
              </Detalhes>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
