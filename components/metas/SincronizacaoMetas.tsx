'use client'

import { useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * P2.17.5 — Bloco "Sincronização automática (principal)" do painel de metas.
 * Mostra a última leitura, o que mudou (anterior → novo) e a reação do
 * consultor. O "Importar do print" fica como contingência.
 */

export interface EstadoDaSincronizacao {
  principal: 'automatica'
  fonteDisponivel: boolean
  verificadoEm: string
  ultima: { em: string; fonte: string; status: string; mensagem: string | null; gatilho: string } | null
  ultimaComDados: { em: string; fonte: string; criadas: number; atualizadas: number; encerradas: number; reacao: string[] } | null
  alteracoes: { em: string; metaId: string; meta: string | null; campo: string; anterior: string | null; novo: string | null; origem: string }[]
}

const ROTULO_DA_FONTE: Record<string, string> = { API_OFICIAL: 'API oficial do TikTok Shop', TEXTO_REVISADO: 'print revisado (contingência)', NENHUMA: 'nenhuma fonte automática' }
const ROTULO_DO_CAMPO: Record<string, string> = {
  CRIADA: 'nova meta', quantidadeRealizada: 'progresso', quantidadeExigida: 'exigência', fim: 'prazo', inicio: 'início', recompensaCampanha: 'recompensa da campanha',
  recompensaValor: 'recompensa', recompensaDescricao: 'descrição da recompensa', requisitos: 'requisitos', nome: 'nome', tipo: 'tipo', campanha: 'campanha',
  AUSENTE: 'não apareceu na leitura', ENCERRADA: 'encerrada', REAPARECEU: 'voltou a aparecer', VINCULADA_A_FONTE: 'vinculada à fonte',
}
const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
function valor(campo: string, v: string | null) {
  if (v === null) return '—'
  if (campo === 'fim' || campo === 'inicio') return new Date(v).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  if (campo.startsWith('recompensa') && campo !== 'recompensaDescricao') return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  return v
}

export function SincronizacaoMetas({ estado, onSincronizado }: { estado: EstadoDaSincronizacao; onSincronizado: () => void }) {
  const [ocupado, setOcupado] = useState(false)
  const [resposta, setResposta] = useState<string | null>(null)

  async function sincronizar() {
    setOcupado(true)
    setResposta(null)
    try {
      const r = await fetch('/api/tiktok/metas/sincronizar', { method: 'POST' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(r.status === 401 ? 'Sua sessão expirou. Entre de novo.' : d.error ?? 'Não consegui sincronizar.')
      setResposta(d.status === 'OK' ? (d.reacao ?? []).join(' ') || 'Sincronizado.' : d.mensagem ?? 'Sem fonte automática disponível.')
      onSincronizado()
    } catch (e) {
      setResposta((e as Error).message)
    } finally {
      setOcupado(false)
    }
  }

  const ultima = estado.ultima
  // P2.17.13: indicador discreto; a explicação longa fica em "Saiba mais".
  return (
    <div className="rounded-lg border border-border px-3 py-2 space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-white flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${estado.fonteDisponivel ? 'bg-accent' : 'bg-warning'}`} aria-hidden />
          {estado.fonteDisponivel ? 'Sincronização automática ativa' : 'Sincronização automática indisponível — aguardando fonte oficial'}
          {ultima && <span className="text-muted-foreground">· última tentativa {quando(ultima.em)}</span>}
        </p>
        <Button size="sm" variant="ghost" disabled={ocupado} onClick={sincronizar}>
          {ocupado ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Sincronizar agora
        </Button>
      </div>
      <details className="text-[11px] text-muted-foreground">
        <summary className="cursor-pointer select-none hover:text-white">Saiba mais</summary>
        <p className="mt-1">
          {ultima ? `Última tentativa: ${quando(ultima.em)} · ${ROTULO_DA_FONTE[ultima.fonte] ?? ultima.fonte}.` : 'Nenhuma sincronização ainda.'}
          {estado.ultimaComDados ? ` Última leitura com dados: ${quando(estado.ultimaComDados.em)} (${ROTULO_DA_FONTE[estado.ultimaComDados.fonte] ?? estado.ultimaComDados.fonte}).` : ''}
        </p>
        {!estado.fonteDisponivel && (
          <p className="mt-1">
            O TikTok ainda não oferece API oficial de missões para criadoras (verificado em {new Date(`${estado.verificadoEm}T12:00:00`).toLocaleDateString('pt-BR')}), e automatizar o painel do TikTok com a sua sessão não é permitido pelos Termos dele. Assim que existir fonte oficial, ela entra aqui sem mudar o resto. Até lá, o print é a contingência: reimportar ATUALIZA as metas, não duplica.
          </p>
        )}
      </details>
      {resposta && <p className="text-xs text-white">{resposta}</p>}
      {estado.ultimaComDados && estado.ultimaComDados.reacao.length > 0 && (
        <ul className="list-disc pl-5 text-xs text-white space-y-0.5">{estado.ultimaComDados.reacao.map((f, i) => <li key={i}>{f}</li>)}</ul>
      )}
      {estado.alteracoes.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">O que mudou (últimas {estado.alteracoes.length})</summary>
          <ul className="mt-1 space-y-0.5">
            {estado.alteracoes.map((h, i) => (
              <li key={i}>
                {quando(h.em)} · {h.meta ?? 'meta'} · {ROTULO_DO_CAMPO[h.campo] ?? h.campo}
                {h.anterior !== null || h.novo !== null ? `: ${valor(h.campo, h.anterior)} → ${valor(h.campo, h.novo)}` : ''} · {ROTULO_DA_FONTE[h.origem] ?? h.origem}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
