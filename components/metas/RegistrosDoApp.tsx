'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'
import { Detalhes } from '@/components/shared/Ux'

/**
 * P2.17.17/18 — Os dois registros que SÓ a titular pode fazer (não há API):
 *   1) amostra que ela já pediu no app (o Patrono nunca pede amostra);
 *   2) o que ela VIU no app (Mais vendidos, comissão, amostra) — snapshot manual,
 *      nunca chamado de API oficial.
 * Campo em branco = não visto (nada é preenchido por estimativa).
 */
const input = 'rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-white w-full'
const numero = (v: FormDataEntryValue | null) => {
  const t = String(v ?? '').trim().replace(',', '.')
  return t === '' ? null : Number(t)
}

async function enviar(url: string, corpo: unknown) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.erro ?? 'Não consegui registrar.')
  return j
}

export function RegistrosDoApp({ aoRegistrar }: { aoRegistrar: () => void }) {
  const [ocupado, setOcupado] = useState(false)

  async function amostra(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    // O formulário é guardado antes do await (o evento do React não segura currentTarget depois).
    const form = e.currentTarget
    const f = new FormData(form)
    setOcupado(true)
    try {
      const papeis = ['PRODUTO_AFILIADO', ...(f.get('equipamento') ? ['EQUIPAMENTO_OPERACIONAL'] : [])]
      const j = await enviar('/api/tiktok/amostras', {
        nomeProduto: String(f.get('nome') ?? ''), categoria: String(f.get('categoria') ?? '') || null, tipo: String(f.get('tipo') ?? '') || null,
        estado: 'PENDENTE_APROVACAO', papeis, comissaoObservada: numero(f.get('comissao')), comissaoFonte: 'TIKTOK_APP_MANUAL',
      })
      toast({ title: j.criada ? 'Amostra registrada' : 'Essa amostra já estava registrada' })
      form.reset()
      aoRegistrar()
    } catch (err) {
      toast({ title: (err as Error).message, variant: 'destructive' })
    } finally {
      setOcupado(false)
    }
  }

  async function observacao(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    // O formulário é guardado antes do await (o evento do React não segura currentTarget depois).
    const form = e.currentTarget
    const f = new FormData(form)
    setOcupado(true)
    try {
      await enviar('/api/tiktok/observacoes', {
        nomeProduto: String(f.get('nome') ?? ''), fonte: f.get('posicao') ? 'TIKTOK_RANKING_MANUAL' : 'TIKTOK_APP_MANUAL',
        rankingCategoria: String(f.get('ranking') ?? '') || null, rankingPosicao: numero(f.get('posicao')),
        vendasExibidasTexto: String(f.get('vendas') ?? '') || null, comissaoExibida: numero(f.get('comissao')), preco: numero(f.get('preco')),
        comissaoPercentualExibida: numero(f.get('comissaoPct')), estoque: numero(f.get('estoque')),
        tipoDeAmostra: String(f.get('tipo') ?? '') || null,
        // P2.18: quando foi visto no app (vazio = agora). A validade de 7 dias conta daí.
        observadoEm: f.get('vistoEm') ? new Date(String(f.get('vistoEm'))).toISOString() : null,
      })
      toast({ title: 'Registrado (vale 7 dias como retrato do app)' })
      form.reset()
      aoRegistrar()
    } catch (err) {
      toast({ title: (err as Error).message, variant: 'destructive' })
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-2">
      <Detalhes titulo="Registrar amostra que você pediu no app">
        <form onSubmit={amostra} className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
          <input name="nome" required placeholder="Produto (como aparece no app)" className={`${input} sm:col-span-2`} />
          <select name="tipo" className={input} defaultValue=""><option value="">Tipo de amostra (não sei)</option><option value="GRATIS">Grátis</option><option value="REEMBOLSAVEL">Reembolsável</option></select>
          <input name="comissao" inputMode="decimal" placeholder="Comissão vista (R$) — deixe vazio se não viu" className={input} />
          <input name="categoria" placeholder="Categoria (opcional)" className={input} />
          <label className="flex items-center gap-2 text-xs text-white/80"><input type="checkbox" name="equipamento" /> Também é equipamento de produção</label>
          <Button type="submit" size="sm" disabled={ocupado} className="sm:col-span-2 justify-self-start">Registrar (pendente de aprovação)</Button>
        </form>
      </Detalhes>
      <Detalhes titulo="Registrar o que você viu no app (Mais vendidos, comissão, amostra)">
        <form onSubmit={observacao} className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
          <input name="nome" required placeholder="Produto" className={`${input} sm:col-span-2`} />
          <input name="ranking" placeholder="Aba/categoria do ranking (ex.: Mais vendidos · Beleza)" className={input} />
          <input name="posicao" inputMode="numeric" placeholder="Posição (ex.: 3)" className={input} />
          <input name="vendas" placeholder="Vendas exibidas (ex.: 10 mil+)" className={input} />
          <input name="comissao" inputMode="decimal" placeholder="Comissão estimada (R$)" className={input} />
          <input name="comissaoPct" inputMode="decimal" placeholder="Comissão (%)" className={input} />
          <input name="preco" inputMode="decimal" placeholder="Preço (R$)" className={input} />
          <input name="estoque" inputMode="numeric" placeholder="Estoque exibido" className={input} />
          <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">Visto no app em (vazio = agora)<input name="vistoEm" type="datetime-local" className={input} /></label>
          <select name="tipo" className={input} defaultValue=""><option value="">Amostra (não vi)</option><option value="GRATIS">Grátis</option><option value="REEMBOLSAVEL">Reembolsável</option><option value="NENHUMA">Sem amostra</option></select>
          <p className="sm:col-span-2 text-[11px] text-muted-foreground">É um retrato do app: vale 7 dias e nunca é tratado como dado oficial de API. &quot;Mais vendido&quot; é evidência de demanda — a melhor oportunidade é decidida pela conta econômica (comissão, preço, missão, mídia).</p>
          <Button type="submit" size="sm" disabled={ocupado} className="sm:col-span-2 justify-self-start">Registrar o que vi</Button>
        </form>
      </Detalhes>
    </div>
  )
}
