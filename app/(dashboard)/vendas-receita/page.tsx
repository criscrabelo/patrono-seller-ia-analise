'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { useGuardModulo } from '@/hooks/useGuardModulo'
import { modulosDaArea } from '@/lib/navegacao'
import { Kpi, TituloDeSecao, reaisOuNull, pctOuNull} from '@/components/shared/Ux'

/**
 * P2.17.13 — Vendas & Receita: visão CONSOLIDADA (não é mais a mesma página
 * de "Vendas e Comissões"). Só dado real: resultados por vídeo e a fonte
 * única de vendas/comissões. Registrar resultado à mão é contingência e
 * fica em "Resultados".
 */
interface Janela { comissao: number | null; receita: number | null; vendas: number | null; views: number | null; receitaPor1000Views: number | null; conversao: number | null; ctr: number | null }
interface Resumo {
  hoje: Janela; sete: Janela; trinta: Janela
  fonteUnica: { vendas: Record<string, number>; comissoes: { prevista: number; confirmada: number; recebida: number } }
  melhorProduto: { nome: string; receita: number } | null
  melhorVideo: { produto: string | null; gancho: string; receita: number; url: string | null } | null
  melhorCanal: { canal: string; receita: number } | null
  videosMedidos: number
}

export default function VendasReceitaPage() {
  useGuardModulo(modulosDaArea('/vendas-receita'))
  const [r, setR] = useState<Resumo | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  useEffect(() => {
    fetch('/api/resumos/vendas-receita')
      .then(async (res) => (res.ok ? setR(await res.json()) : setErro('Não consegui carregar o resumo.')))
      .catch(() => setErro('Sem conexão.'))
  }, [])
  if (erro) return <p className="card-stat text-sm text-muted-foreground">{erro}</p>
  if (!r) return <p className="card-stat flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Somando a receita…</p>
  const fu = r.fonteUnica
  const vendasConfirmadas = fu.vendas.CONFIRMED ?? 0
  return (
    <div className="w-full max-w-5xl space-y-5">
      <section className="space-y-2" aria-label="Dinheiro">
        <TituloDeSecao>Dinheiro</TituloDeSecao>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* P2.50: o destaque é a comissão CONFIRMADA; o informado nos vídeos é ESTIMATIVA e aparece com esse nome. */}
          <Kpi rotulo="Comissão confirmada (registrada)" valor={fu.comissoes.confirmada > 0 ? reaisOuNull(fu.comissoes.confirmada) : null} semValor="Nenhuma comissão registrada" dica={fu.comissoes.recebida > 0 ? `recebida ${reaisOuNull(fu.comissoes.recebida)}` : null} destaque />
          <Kpi rotulo="Informada nos vídeos hoje (estimada)" valor={reaisOuNull(r.hoje.comissao)} />
          <Kpi rotulo="Informada 7 dias (estimada)" valor={reaisOuNull(r.sete.comissao)} />
          <Kpi rotulo="Informada 30 dias (estimada)" valor={reaisOuNull(r.trinta.comissao)} />
          <Kpi rotulo="Vendas (30 d)" valor={r.trinta.vendas} />
          <Kpi rotulo="Receita estimada / 1.000 views" valor={reaisOuNull(r.trinta.receitaPor1000Views)} />
          <Kpi rotulo="Conversão clique → venda" valor={pctOuNull(r.trinta.conversao)} />
          {/* Fonte única (registros): sem lançamento = "nenhum registrado", nunca "faturamento zero". */}
          <Kpi rotulo="Vendas confirmadas (registradas)" valor={vendasConfirmadas > 0 ? vendasConfirmadas : null} semValor="Nenhuma venda registrada" />
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-3" aria-label="Vencedores">
        <Kpi rotulo="Melhor produto (estimado)" valor={r.melhorProduto?.nome ?? null} dica={r.melhorProduto ? reaisOuNull(r.melhorProduto.receita) : null} />
        <Kpi rotulo="Melhor vídeo (estimado)" valor={r.melhorVideo ? `“${r.melhorVideo.gancho}”` : null} dica={r.melhorVideo ? `${r.melhorVideo.produto ?? ''} · ${reaisOuNull(r.melhorVideo.receita)}` : null} />
        <Kpi rotulo="Melhor canal (estimado)" valor={r.melhorCanal?.canal ?? null} dica={r.melhorCanal ? reaisOuNull(r.melhorCanal.receita) : null} />
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Link href="/vendas-comissoes" className="card-stat hover:bg-white/5">
          <p className="text-sm font-semibold text-white">Resultados</p>
          <p className="text-xs text-muted-foreground">Vendas e comissões registradas, por produto e programa. Registrar à mão só como contingência, até as APIs conectarem.</p>
        </Link>
        <Link href="/monetizacao" className="card-stat hover:bg-white/5">
          <p className="text-sm font-semibold text-white">Canais de receita</p>
          <p className="text-xs text-muted-foreground">TikTok Shop, Shopee, Amazon, Mercado Livre: conectado, elegível, receita e comissão reais, próxima ação.</p>
        </Link>
      </section>
      <p className="text-[11px] text-muted-foreground">{r.videosMedidos} vídeo(s) com métricas. Sem dado oficial, o valor aparece como “aguardando dados oficiais” — nunca como zero.</p>
    </div>
  )
}
