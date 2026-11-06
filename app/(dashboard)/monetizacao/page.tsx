'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ExternalLink, Loader2 } from 'lucide-react'
import { useGuardModulo } from '@/hooks/useGuardModulo'
import { Indicador, TituloDeSecao, reaisOuNull } from '@/components/shared/Ux'
import { ROTULO_DO_CANAL } from '@/lib/rotulos-de-canal'
import type { SituacaoDoCanal } from '@/lib/resumos'
import { PainelDeAfiliados, type PainelDeAfiliadosDados } from '@/components/afiliados/PainelDeAfiliados'
import { ControleDeGastos, type SituacaoDosGastosDados } from '@/components/gastos/ControleDeGastos'

/**
 * P2.17.13 — CANAIS DE RECEITA (antiga "Monetização").
 *
 * Saíram as estimativas genéricas que pareciam precisas sem ser (faixas de
 * comissão por modelo, "estimativa com 10k seguidores", R$/dia, "categorias
 * de conteúdo viral"). Aqui só entra o que é da NOSSA operação: programa
 * cadastrado, integração conectada, vendas e comissões registradas,
 * oportunidades abertas — e a próxima ação de cada canal.
 */
interface Canal {
  id: string; nome: string; urlOficial: string
  situacao: SituacaoDoCanal
  conectado: boolean; elegivel: boolean; receita: number | null; comissao: number | null; oportunidades: number; proximaAcao: string
}

const SITUACAO = ROTULO_DO_CANAL

export default function CanaisDeReceitaPage() {
  useGuardModulo('monetizacao')
  const [canais, setCanais] = useState<Canal[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  // P2.53: painel de afiliados e controle de gastos (cada um falha sozinho, sem derrubar a página).
  const [painel, setPainel] = useState<PainelDeAfiliadosDados | null>(null)
  const [gastos, setGastos] = useState<SituacaoDosGastosDados | null>(null)
  useEffect(() => {
    fetch('/api/afiliados/painel').then(async (r) => r.ok && setPainel(await r.json())).catch(() => null)
    fetch('/api/gastos').then(async (r) => r.ok && setGastos(await r.json())).catch(() => null)
  }, [])
  useEffect(() => {
    fetch('/api/resumos/canais')
      .then(async (r) => (r.ok ? setCanais(await r.json()) : setErro('Não consegui carregar os canais.')))
      .catch(() => setErro('Sem conexão.'))
  }, [])
  if (erro) return <p className="card-stat text-sm text-muted-foreground">{erro}</p>
  if (!canais) return <p className="card-stat flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Conferindo os canais…</p>
  return (
    <div className="w-full max-w-5xl space-y-4">
      <TituloDeSecao acao={<Link href="/programas" className="text-xs text-accent hover:underline">Meus Programas</Link>}>Canais de receita</TituloDeSecao>
      {painel && <PainelDeAfiliados dados={painel} />}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {canais.map((c) => (
          <div key={c.id} className="card-stat space-y-2">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold text-white">{c.nome}</p>
              <Indicador nome="" estado={SITUACAO[c.situacao].rotulo} tom={SITUACAO[c.situacao].tom} />
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              {/* P2.17.14: sem lançamento = "nenhuma registrada" (não é faturamento zero nem dado oficial). */}
              <div><p className="text-muted-foreground">Receita</p><p className={c.receita === null ? 'text-muted-foreground' : 'text-white'}>{reaisOuNull(c.receita) ?? 'Nenhuma venda registrada'}</p></div>
              <div><p className="text-muted-foreground">Comissão</p><p className={c.comissao === null ? 'text-muted-foreground' : 'text-white'}>{reaisOuNull(c.comissao) ?? 'Nenhuma comissão registrada'}</p></div>
              <div><p className="text-muted-foreground">Oportunidades</p><p className="text-white">{c.oportunidades}</p></div>
            </div>
            <p className="text-xs text-white/90"><span className="text-muted-foreground">Próxima ação:</span> {c.proximaAcao}</p>
            <a href={c.urlOficial} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-white">Site oficial <ExternalLink className="w-3 h-3" /></a>
          </div>
        ))}
      </div>
      {gastos && <ControleDeGastos dados={gastos} />}
      <p className="text-[11px] text-muted-foreground">Aqui: onde o dinheiro está sendo gerado e quanto cada canal trouxe. Participação, aprovação e cadastro ficam em Meus Programas. Nenhum valor aqui é estimativa.</p>
    </div>
  )
}
