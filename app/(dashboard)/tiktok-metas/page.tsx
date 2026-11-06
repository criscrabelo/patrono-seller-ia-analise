'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle, Loader2, Minus, Plus, Trophy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'
import { useGuardModulo } from '@/hooks/useGuardModulo'
import { ImportarMetas } from '@/components/metas/ImportarMetas'
import { AmostrasTikTokShop } from '@/components/metas/AmostrasTikTokShop'
import { PlanoDasMissoes } from '@/components/metas/PlanoDasMissoes'
import { SincronizacaoMetas, type EstadoDaSincronizacao } from '@/components/metas/SincronizacaoMetas'
import { Kpi, SeloDecisao, Detalhes, type Decisao } from '@/components/shared/Ux'

/**
 * P2.17.3 — TikTok Shop — Metas e Recompensas.
 * Missões registradas pela titular (não há API pública de missões); o Patrono
 * calcula faltantes, prazo, ritmo, risco e recomenda produtos e vídeos.
 * Nada é publicado daqui.
 */

interface Meta {
  id: string
  nome: string
  tipo: string
  situacao: string
  faltam: number
  progresso: number
  diasRestantes: number
  hojeRecomendado: number
  risco: string
  prioridade: number
  recompensaTexto: string
  frases: string[]
  proximaAcao: string
  inicio: string
  fim: string
  quantidadeExigida: number
  quantidadeRealizada: number
  requisitos: string | null
}

interface Etapa {
  etapa: string
  texto: string
  textoNaTela?: string | null
}

interface Gancho {
  letra: string
  gancho: string
  exigeExperienciaReal: boolean
  objetivo: string
  produtoMarcado: string
  qualidade: { veredito: string; resumo: string; riscoDeCompliance: string }
  curta: { segundos: number; roteiro: Etapa[] }
  media: { segundos: number; roteiro: Etapa[] }
  ctaA: string
  ctaB: string
  legendaA: string
  legendaB: string
  disclosure: string
  hashtags: string[]
}

interface Produto {
  id: string
  nome: string
  posicao: number
  ajudaMissao: boolean
  facilidade: number
  porque: string[]
  consultoria: { veredito: string; resumo: string; proximoPasso: string }
  videos: {
    potencial: { nivel: string; sinais: string[]; aviso: string }
    teste: { explicacao: string }
    missoes: string[]
    ganchos: Gancho[]
  } | null
}

interface Painel {
  sincronizacao: EstadoDaSincronizacao
  metas: Meta[]
  campanhas: { nome: string; recompensaTotal: number | null; metas: number; faltamTotal: number }[]
  produtos: Produto[]
  resumo: {
    recompensaEmJogo: number
    videosHoje: number
    emRisco: number
    frase: string
    receita: string | null
    alerta: string | null
    prioridade: string | null
    maisApertada: { id: string; nome: string; frase: string } | null
  }
}

const TIPOS = [
  { v: 'VIDEOS_COM_PRODUTO', r: 'Vídeos com produtos à venda' },
  { v: 'VIDEOS_QUALIFICADOS', r: 'Vídeos qualificados' },
  { v: 'ADICIONAR_PRODUTOS', r: 'Adicionar produtos' },
  { v: 'SOLICITAR_AMOSTRAS', r: 'Solicitar amostras' },
  { v: 'OUTRO', r: 'Outro' },
]
const ROTULO_DO_RISCO: Record<string, string> = { ALTO: 'risco alto', MEDIO: 'sem folga', BAIXO: 'no ritmo', NENHUM: 'concluída', PERDIDA: 'perdida' }
const COR_DO_RISCO: Record<string, string> = { ALTO: 'text-danger', MEDIO: 'text-warning', BAIXO: 'text-accent', NENHUM: 'text-accent', PERDIDA: 'text-muted-foreground' }
const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const data = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
const VAZIO = { nome: '', tipo: 'VIDEOS_COM_PRODUTO', inicio: '', fim: '', recompensa: '', exigida: '', realizada: '', requisitos: '', campanha: '', recompensaCampanha: '' }
const ROTULO_DO_OBJETIVO: Record<string, string> = { RETENCAO: 'retenção', CLIQUE: 'clique no produto', VENDA: 'venda', MISSAO: 'cumprir missão' }
const lerValor = (t: string) => (t.trim() ? Number(t.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')) : null)

function Roteiro({ titulo, etapas }: { titulo: string; etapas: Etapa[] }) {
  return (
    <div>
      <p className="text-[11px] text-white">{titulo}</p>
      <ul className="list-disc pl-4 text-[11px] text-muted-foreground">
        {etapas.map((r, i) => (
          <li key={`${r.etapa}-${i}`}>
            {r.etapa}: {r.texto}
            {r.textoNaTela ? <span className="text-accent"> · na tela: “{r.textoNaTela}”</span> : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function TikTokMetasPage() {
  useGuardModulo('oportunidades')
  const [painel, setPainel] = useState<Painel | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [form, setForm] = useState(VAZIO)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [erroDoForm, setErroDoForm] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [importando, setImportando] = useState(false)

  async function carregar() {
    try {
      const r = await fetch('/api/tiktok/metas')
      const d = await r.json().catch(() => null)
      if (!r.ok) throw new Error(d?.error ?? 'Não consegui carregar as metas.')
      setPainel(d)
      setErro(null)
    } catch (e) {
      setErro((e as Error).message)
    }
  }
  useEffect(() => {
    carregar()
  }, [])

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    setErroDoForm(null)
    const recompensa = lerValor(form.recompensa)
    const corpo = {
      campanha: form.campanha.trim() || null,
      recompensaCampanha: lerValor(form.recompensaCampanha),
      nome: form.nome,
      tipo: form.tipo,
      inicio: form.inicio ? new Date(`${form.inicio}T00:00:00-03:00`).toISOString() : '',
      fim: form.fim ? new Date(`${form.fim}T23:59:59-03:00`).toISOString() : '',
      recompensaValor: recompensa,
      quantidadeExigida: Number(form.exigida),
      quantidadeRealizada: form.realizada ? Number(form.realizada) : 0,
      requisitos: form.requisitos || null,
    }
    setOcupado(true)
    try {
      const r = await fetch('/api/tiktok/metas', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(r.status === 401 ? 'Sua sessão expirou. Entre de novo.' : d.error ?? 'Não consegui salvar a missão.')
      setForm(VAZIO)
      setMostrarForm(false)
      toast({ title: 'Missão registrada' })
      await carregar()
    } catch (err) {
      setErroDoForm((err as Error).message)
    } finally {
      setOcupado(false)
    }
  }

  async function alterar(id: string, mudanca: Record<string, unknown>) {
    setOcupado(true)
    try {
      const r = await fetch(`/api/tiktok/metas/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(mudanca) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error ?? 'Não consegui atualizar a missão.')
      await carregar()
    } catch (err) {
      toast({ title: 'Não deu certo', description: (err as Error).message, variant: 'destructive' })
    } finally {
      setOcupado(false)
    }
  }

  const input = 'rounded-lg border border-border bg-background px-3 py-2 text-sm text-white'
  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Trophy className="w-5 h-5 text-accent" />
          <p className="text-sm font-semibold text-white">TikTok Shop — Metas e Recompensas</p>
        </div>
        {/* P2.17.13: print e registro manual são CONTINGÊNCIA — visualmente secundários. */}
        <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <span>Contingência:</span>
          <Button size="sm" variant="ghost" onClick={() => setImportando((v) => !v)}>Importar print</Button>
          <Button size="sm" variant="ghost" onClick={() => setMostrarForm((v) => !v)}>
            <Plus className="w-3.5 h-3.5" /> Registrar missão
          </Button>
        </div>
      </div>
      {/* P2.17.17: amostras como operação (ciclo, prazos, missão, kit). */}
      <PlanoDasMissoes />
      <AmostrasTikTokShop />

      {importando && (
        <ImportarMetas
          onCancelar={() => setImportando(false)}
          onSalvo={() => {
            setImportando(false)
            toast({ title: 'Metas salvas' })
            carregar()
          }}
        />
      )}

      {erro && <p className="card-stat text-sm text-muted-foreground">{erro}</p>}
      {!painel && !erro && (
        <p className="card-stat flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando…
        </p>
      )}

      {mostrarForm && (
        <form onSubmit={salvar} className="card-stat grid grid-cols-1 sm:grid-cols-2 gap-3">
          <p className="sm:col-span-2 text-xs text-muted-foreground">
            Copie os dados da missão como aparecem no app do TikTok Shop. Eu calculo o que falta, o ritmo e o risco.
          </p>
          {erroDoForm && (
            <p role="alert" className="sm:col-span-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-white">
              {erroDoForm}
            </p>
          )}
          <input className={`${input} sm:col-span-2`} placeholder="Nome da missão *" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
          <select className={input} value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
            {TIPOS.map((t) => (
              <option key={t.v} value={t.v}>{t.r}</option>
            ))}
          </select>
          <input className={input} placeholder="Recompensa desta meta em R$ (opcional)" inputMode="decimal" value={form.recompensa} onChange={(e) => setForm({ ...form, recompensa: e.target.value })} />
          <input className={input} placeholder="Campanha (ex.: Metas de Outubro)" value={form.campanha} onChange={(e) => setForm({ ...form, campanha: e.target.value })} />
          <input className={input} placeholder="Recompensa total da campanha em R$" inputMode="decimal" value={form.recompensaCampanha} onChange={(e) => setForm({ ...form, recompensaCampanha: e.target.value })} />
          <label className="text-xs text-muted-foreground">Início *<input type="date" className={`${input} w-full mt-1`} value={form.inicio} onChange={(e) => setForm({ ...form, inicio: e.target.value })} /></label>
          <label className="text-xs text-muted-foreground">Fim *<input type="date" className={`${input} w-full mt-1`} value={form.fim} onChange={(e) => setForm({ ...form, fim: e.target.value })} /></label>
          <input className={input} placeholder="Quantidade exigida *" inputMode="numeric" value={form.exigida} onChange={(e) => setForm({ ...form, exigida: e.target.value })} />
          <input className={input} placeholder="Já realizadas (opcional)" inputMode="numeric" value={form.realizada} onChange={(e) => setForm({ ...form, realizada: e.target.value })} />
          <input className={`${input} sm:col-span-2`} placeholder="Requisitos adicionais (opcional)" value={form.requisitos} onChange={(e) => setForm({ ...form, requisitos: e.target.value })} />
          <div className="sm:col-span-2 flex gap-2">
            <Button type="submit" size="sm" disabled={ocupado}>Salvar missão</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setMostrarForm(false)}>Cancelar</Button>
          </div>
        </form>
      )}

      {painel && (
        <>
          {(() => {
            const abertas = painel.metas.filter((m) => m.risco !== 'NENHUM' && m.risco !== 'PERDIDA')
            const faltam = abertas.reduce((t, m) => t + m.faltam, 0)
            const prazo = [...abertas].sort((x, y) => x.diasRestantes - y.diasRestantes)[0] ?? null
            return (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3" aria-label="Resumo das missões">
                <Kpi rotulo="Recompensa em jogo" valor={painel.resumo.recompensaEmJogo > 0 ? reais(painel.resumo.recompensaEmJogo) : null} destaque />
                <Kpi rotulo="Ações faltando" valor={abertas.length ? faltam : null} dica={`recomendação do Patrono hoje: ${painel.resumo.videosHoje}`} />
                <Kpi rotulo="Prazo mais próximo" valor={prazo ? `${prazo.diasRestantes} dia(s)` : null} dica={prazo?.nome ?? null} />
                <Kpi rotulo="Missões em risco" valor={painel.resumo.emRisco} dica={painel.resumo.maisApertada?.nome ?? null} />
                <Kpi rotulo="Produto prioritário" valor={painel.produtos[0]?.nome ?? null} />
              </div>
            )
          })()}
          <SincronizacaoMetas estado={painel.sincronizacao} onSincronizado={carregar} />
          {painel.resumo.alerta && (
            <p role="alert" className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-white">{painel.resumo.alerta}</p>
          )}
          <Detalhes titulo="Leitura completa do Patrono">
            <p className="text-white">{painel.resumo.frase}</p>
            {painel.resumo.maisApertada && <p className="text-warning">{painel.resumo.maisApertada.frase}</p>}
            {painel.resumo.prioridade && <p>{painel.resumo.prioridade}</p>}
            {painel.resumo.receita && <p>{painel.resumo.receita}</p>}
          </Detalhes>
          {painel.campanhas.map((c) => (
            <div key={c.nome} className="rounded-xl border border-accent/30 bg-accent/5 p-3 text-sm text-white">
              Campanha <b>{c.nome}</b>: {c.metas} meta(s), faltam {c.faltamTotal} ações no total
              {c.recompensaTotal != null ? ` · recompensa total exibida ${reais(c.recompensaTotal)} (divisão por meta não informada)` : ''}.
            </div>
          ))}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {painel.metas.map((m) => (
              <div key={m.id} className="card-stat space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-white text-sm break-words">{m.nome}</p>
                  <span className={`text-xs whitespace-nowrap ${COR_DO_RISCO[m.risco] ?? 'text-white'}`}>
                    {m.risco === 'ALTO' ? <AlertTriangle className="inline w-3 h-3 mr-1" /> : m.risco === 'NENHUM' ? <CheckCircle className="inline w-3 h-3 mr-1" /> : null}
                    {ROTULO_DO_RISCO[m.risco] ?? m.risco}
                  </span>
                </div>
                <p className="text-2xl font-bold text-white tabular-nums">{m.quantidadeRealizada} <span className="text-base text-muted-foreground">/ {m.quantidadeExigida}</span></p>
                <div className="h-2 rounded-full bg-secondary overflow-hidden" aria-label={`Progresso ${m.quantidadeRealizada} de ${m.quantidadeExigida}`}>
                  <div className="h-full bg-accent" style={{ width: `${Math.round(m.progresso * 100)}%` }} />
                </div>
                {/* P2.17.14: "faltam/prazo" vêm da missão (TikTok); o ritmo diário é RECOMENDAÇÃO do Patrono. */}
                <p className="text-xs text-white">Necessário para a meta: faltam {m.faltam} · {m.diasRestantes} dia(s)</p>
                {m.hojeRecomendado > 0 && <p className="text-xs text-accent">Recomendação do Patrono para hoje: {m.hojeRecomendado}</p>}
                <Detalhes>
                  <p>{data(m.inicio)} → {data(m.fim)} · {m.recompensaTexto}</p>
                  <ul className="space-y-0.5">{m.frases.map((f) => <li key={f}>{f}</li>)}</ul>
                  <p className="text-accent">Próxima ação: {m.proximaAcao}</p>
                  {m.requisitos && <p>Requisitos: {m.requisitos}</p>}
                </Detalhes>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" variant="outline" disabled={ocupado} onClick={() => alterar(m.id, { incremento: 1 })}><Plus className="w-3 h-3" /> 1 feito</Button>
                  <Button size="sm" variant="outline" disabled={ocupado || m.quantidadeRealizada === 0} onClick={() => alterar(m.id, { incremento: -1 })}><Minus className="w-3 h-3" /></Button>
                  <Button size="sm" variant="ghost" disabled={ocupado} onClick={() => confirm(`Arquivar "${m.nome}"?`) && alterar(m.id, { arquivar: true })}>Arquivar</Button>
                </div>
              </div>
            ))}
          </div>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-white">Produtos recomendados para o TikTok</h2>
            {painel.produtos.length === 0 && (
              <p className="card-stat text-xs text-muted-foreground">Ainda não há candidatos. Em Oportunidades, atualize os candidatos ou informe um produto do TikTok Shop.</p>
            )}
            {painel.produtos.map((p) => (
              <div key={p.id} className="card-stat space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-white text-sm break-words">{p.posicao}º · {p.nome}</p>
                  <SeloDecisao decisao={p.consultoria.veredito as Decisao} />
                </div>
                {p.porque[0] && <p className="text-xs text-white/85">Por quê: {p.porque[0]}</p>}
                <p className="text-[11px] text-muted-foreground">
                  {p.ajudaMissao ? <span className="text-accent">Ajuda na missão</span> : 'Sem missão ligada'}
                  {p.videos ? ` · potencial ${p.videos.potencial.nivel.toLowerCase()}` : ''}
                </p>
                <p className="text-[11px] text-accent">Próxima ação: {p.consultoria.proximoPasso}</p>
                <Detalhes titulo="Análise do Patrono">
                  <p className="text-white">{p.consultoria.resumo}</p>
                  <ul className="space-y-0.5">{p.porque.map((x) => <li key={x}>{x}</li>)}</ul>
                </Detalhes>
                {p.videos && (
                  <details className="text-xs">
                    <summary className="cursor-pointer select-none text-white">Vídeos para testar (potencial {p.videos.potencial.nivel.toLowerCase()})</summary>
                    <p className="mt-1 text-[11px] text-muted-foreground">{p.videos.potencial.aviso} Sinais: {p.videos.potencial.sinais.join('; ')}.</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">{p.videos.teste.explicacao}</p>
                    {p.videos.missoes.length > 0 && (
                      <div className="mt-2">
                        <p className="text-[11px] text-white">Missões que estes vídeos ajudam a cumprir:</p>
                        <ul className="list-disc pl-4 text-[11px] text-accent">{p.videos.missoes.map((m) => <li key={m}>{m}</li>)}</ul>
                      </div>
                    )}
                    <ol className="mt-2 space-y-2">
                      {p.videos.ganchos.map((g) => (
                        <li key={g.letra} className="rounded-lg bg-black/20 p-2 space-y-1.5">
                          <p className="text-white">Gancho {g.letra}: “{g.gancho}”</p>
                          <p className="text-[11px] text-muted-foreground">
                            Objetivo: {ROTULO_DO_OBJETIVO[g.objetivo] ?? g.objetivo} · Qualidade:{' '}
                            <span className={g.qualidade.veredito === 'APROVADO' ? 'text-accent' : g.qualidade.veredito === 'BLOQUEADO' ? 'text-danger' : 'text-warning'}>
                              {g.qualidade.veredito.toLowerCase()}
                            </span>{' '}
                            — {g.qualidade.resumo}
                          </p>
                          <p className="text-[11px] text-muted-foreground">{g.produtoMarcado}</p>
                          {g.exigeExperienciaReal && <p className="text-[11px] text-warning">Use só se você realmente testou o produto.</p>}
                          <Roteiro titulo={`Versão curta (${g.curta.segundos} s)`} etapas={g.curta.roteiro} />
                          <Roteiro titulo={`Versão média (${g.media.segundos} s)`} etapas={g.media.roteiro} />
                          <p className="text-[11px] text-accent">CTA A: {g.ctaA} · CTA B: {g.ctaB}</p>
                          <p className="text-[11px] text-white">Legenda (CTA A):</p>
                          <pre className="whitespace-pre-wrap break-words rounded bg-black/30 p-2 text-[11px] text-white font-sans">{g.legendaA}</pre>
                          <p className="text-[11px] text-muted-foreground">Divulgação: {g.disclosure} · Hashtags: {g.hashtags.join(' ')}</p>
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  )
}
