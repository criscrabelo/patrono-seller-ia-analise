'use client'

/**
 * P2.18.5 — OPERAÇÃO: uma página, uma jornada, uma etapa atual.
 *
 * A página NÃO decide nada: ela mostra o que o orquestrador
 * (lib/motor-da-jornada.ts) determinou e envia a resposta da titular.
 * Toda resposta volta com a jornada recalculada: a área muda para a próxima
 * etapa ali mesmo, sem navegar. Refresh/fechar/voltar → mesma etapa (o
 * estado é derivado dos fatos persistidos).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, ExternalLink, Loader2, Route } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { useGuardModulo } from '@/hooks/useGuardModulo'
import { avisarMudancaNoPrecisaDeVoce } from '@/hooks/usePrecisaDeVoce'
import { CartaoDeAprovacao, type ItemParaAprovar } from '@/components/assistido/PainelAssistido'
import { MidiaDoVendedor } from '@/components/assistido/MidiaDoVendedor'
import { PacoteDePublicacao } from '@/components/assistido/PacoteDePublicacao'
import type { VisaoDaOperacao } from '@/lib/jornada'
import { perfilSonoroDoVideo } from '@/lib/trilha-sonora'

type Prioritaria = NonNullable<VisaoDaOperacao['prioritaria']>

const ESPERA_TEXTO: Record<string, string> = {
  AGUARDANDO_CRISTIANE: 'Sua vez',
  AGUARDANDO_PATRONO: 'Patrono trabalhando',
  AGUARDANDO_TIKTOK: 'Aguardando o TikTok',
  AGUARDANDO_LOJISTA: 'Aguardando o vendedor',
  AGUARDANDO_ENTREGA: 'Aguardando a entrega',
}
const COR_DO_PASSO: Record<string, string> = {
  CONCLUIDO: 'bg-accent',
  ATUAL: 'bg-white',
  FUTURO: 'bg-white/15',
  PULADO: 'bg-white/15 opacity-40',
  BLOQUEADO_EXTERNAMENTE: 'bg-warning',
}
const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

async function chamar(url: string, corpo?: unknown): Promise<VisaoDaOperacao> {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo ?? {}) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(r.status === 401 ? 'Sua sessão expirou. Entre de novo.' : d.error ?? 'Não deu certo.')
  return d as VisaoDaOperacao
}

function BarraDeProgresso({ j }: { j: Prioritaria }) {
  const atual = j.progresso.findIndex((p) => p.situacao === 'ATUAL' || p.situacao === 'BLOQUEADO_EXTERNAMENTE')
  return (
    <div aria-label="Progresso da jornada" className="space-y-1">
      <div className="grid grid-cols-8 gap-1">
        {j.progresso.map((p) => (
          <span key={p.passo} title={`${p.passo}: ${p.situacao.toLowerCase().replace(/_/g, ' ')}`} className={cn('h-1.5 rounded-full', COR_DO_PASSO[p.situacao])} />
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {atual >= 0 ? `${j.progresso[atual].passo} · etapa ${atual + 1} de ${j.progresso.length}` : j.etapa === 'CONCLUIDA' ? 'Concluída' : ''}
        {j.progresso.some((p) => p.situacao === 'PULADO') ? ` · pulado: ${j.progresso.filter((p) => p.situacao === 'PULADO').map((p) => p.passo.toLowerCase()).join(', ')}` : ''}
      </p>
    </div>
  )
}

const URGENCIA_TEXTO: Record<string, string> = { NORMAL: 'em dia', ATENCAO: 'atenção', EM_RISCO: 'EM RISCO', CRITICA: 'CRÍTICA', EXPIRADA: 'expirada' }
const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const diaCurto = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })

/** P2.18.7 — HOJE: campanhas e dinheiro em uma linha; o resto recolhido. A etapa atual continua sendo o foco. */
function BlocoHoje({ h }: { h: VisaoDaOperacao['hoje'] }) {
  const p = h.prazoMaisProximo
  return (
    <details className="card-stat text-xs" aria-label="Hoje">
      <summary className="cursor-pointer list-none space-y-0.5">
        <span className="block text-white">
          Hoje: {h.campanhasAtivas ? `${h.campanhasAtivas} campanha(s)` : 'nenhuma campanha registrada'}
          {p ? <> · prazo {diaCurto(p.fim)} <b className={p.urgencia === 'CRITICA' || p.urgencia === 'EM_RISCO' ? 'text-danger' : 'text-accent'}>{URGENCIA_TEXTO[p.urgencia]}</b></> : null}
          {h.videosNecessariosHoje ? ` · ${h.videosNecessariosHoje} vídeo(s) hoje` : ''}
        </span>
        <span className="block text-muted-foreground">
          Receita confirmada {reais(h.receita.confirmada)} · recompensa em jogo {reais(h.receita.recompensaEmJogo)}{h.receita.recompensaElegivel ? ` · elegível ${reais(h.receita.recompensaElegivel)}` : ''}
        </span>
        {h.quota && <span data-quota={h.quota.resultado} className={`block ${h.quota.resultado === 'BLOQUEADA' ? 'text-danger font-semibold' : h.quota.resultado === 'PERMITIDA' ? 'text-muted-foreground' : 'text-accent'}`}>{h.quota.texto}</span>}
      </summary>
      <div className="mt-2 space-y-2 text-muted-foreground">
        {h.quota && <p>{h.quota.motivo}{h.quota.avisos.length ? ` ${h.quota.avisos.join(' ')}` : ''} <a href="/admin/regras-da-plataforma" className="underline">Regras da plataforma</a></p>}
        {h.campanhas.map((c) => (
          <p key={c.titulo}><span className="text-white/85">{c.titulo}</span> · {c.progresso} contado pelo app · faltam {c.faltam}{c.prazo ? ` até ${diaCurto(c.prazo)}` : ''}{c.ritmo ? ` · ${c.ritmo}/dia` : ''} · <b>{URGENCIA_TEXTO[c.urgencia]}</b><span className="block">{c.pipeline}</span></p>
        ))}
        {h.agenda.length > 0 && <p>Agenda: {h.agenda.map((d) => `${diaCurto(`${d.dia}T12:00:00Z`)} ${d.total} vídeo(s)`).join(' · ')}</p>}
        {h.naoCabe.length > 0 && <p className="text-danger">Não cabe no ritmo atual: {h.naoCabe.map((n) => `${n.oportunidade} (${n.videos})`).join(', ')}. O Patrono prioriza produtos em mãos e vídeos que contam para mais de uma meta.</p>}
        <p>Ritmo real: {h.capacidade.porDia.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} vídeo(s)/dia {h.capacidade.medida ? '(medido)' : '(estimativa conservadora, sem histórico)'} · Comissão informada (não confirmada): {reais(h.receita.informada)}</p>
      </div>
    </details>
  )
}

function FormularioDeResultado({ ocupado, enviar }: { ocupado: boolean; enviar: (n: { views: number | null; vendas: number | null; comissao: number | null }) => void }) {
  const [v, setV] = useState({ views: '', vendas: '', comissao: '' })
  const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(/\./g, '').replace(',', '.')))
  const input = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-white'
  return (
    <div className="grid grid-cols-3 gap-2 text-xs">
      {([['views', 'Views'], ['vendas', 'Vendas'], ['comissao', 'Comissão R$']] as const).map(([k, r]) => (
        <label key={k} className="text-muted-foreground">{r}<input inputMode="decimal" className={`${input} mt-1`} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></label>
      ))}
      <Button className="col-span-3" disabled={ocupado || v.views.trim() === ''} onClick={() => enviar({ views: num(v.views), vendas: num(v.vendas), comissao: num(v.comissao) })}>SALVAR</Button>
    </div>
  )
}

type ProdutoParaEscolher = { candidatoId: string; nome: string; imagem: string | null; emMaos: boolean }

/** "ESCOLHER OUTRO PRODUTO": a titular vai direto ao produto que quer, sem recusar os outros. */
function EscolherProduto({ ocupado, escolher }: { ocupado: boolean; escolher: (candidatoId: string, emMaos: boolean) => Promise<void> }) {
  const [aberto, setAberto] = useState(false)
  const [termo, setTermo] = useState('')
  const [lista, setLista] = useState<ProdutoParaEscolher[] | null>(null)
  useEffect(() => {
    if (!aberto) return
    let vivo = true
    const t = setTimeout(async () => {
      const r = await fetch(`/api/operacao/escolher?q=${encodeURIComponent(termo)}`).catch(() => null)
      const d = r?.ok ? await r.json().catch(() => null) : null
      if (vivo) setLista(d?.produtos ?? [])
    }, 250)
    return () => { vivo = false; clearTimeout(t) }
  }, [aberto, termo])

  if (!aberto) {
    return <Button variant="outline" className="w-full" onClick={() => setAberto(true)}>ESCOLHER OUTRO PRODUTO</Button>
  }
  return (
    <section className="card-stat space-y-2" aria-label="Escolher outro produto">
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium text-white">Qual produto você quer trabalhar?</p>
        <button type="button" className="ml-auto text-xs text-muted-foreground hover:text-white" onClick={() => setAberto(false)}>Fechar</button>
      </div>
      <input autoFocus className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-white" placeholder="Buscar pelo nome" value={termo} onChange={(e) => setTermo(e.target.value)} aria-label="Buscar produto pelo nome" />
      {lista === null ? (
        <p className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Buscando…</p>
      ) : lista.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhum produto com esse nome. <a href="/oportunidades" className="text-accent">Informar produto</a> com o link do TikTok Shop.</p>
      ) : (
        <ul className="space-y-2">
          {lista.map((p) => (
            <li key={p.candidatoId} className="rounded-lg border border-border p-2 space-y-2">
              <div className="flex gap-2 items-center min-w-0">
                {p.imagem && <img src={p.imagem} alt="" className="w-9 h-9 rounded object-cover shrink-0" />}
                <p className="text-sm text-white/90 min-w-0 break-words">{p.nome}{p.emMaos && <span className="ml-1 text-[11px] text-accent">· em mãos</span>}</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" disabled={ocupado} onClick={() => escolher(p.candidatoId, true)}>JÁ TENHO</Button>
                <Button size="sm" variant="outline" disabled={ocupado} onClick={() => escolher(p.candidatoId, false)}>AINDA NÃO TENHO</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default function OperacaoPage() {
  useGuardModulo('precisa-de-voce')
  const [visao, setVisao] = useState<VisaoDaOperacao | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [publicou, setPublicou] = useState(false)
  const [url, setUrl] = useState('')
  const [somUsado, setSomUsado] = useState('')
  const travado = useRef(false)

  const carregar = useCallback(async () => {
    try {
      setVisao(await chamar('/api/operacao'))
      setErro(null)
    } catch (e) {
      setErro((e as Error).message)
    }
  }, [])
  useEffect(() => {
    carregar()
  }, [carregar])

  // Enquanto o Patrono trabalha (render, medição), a página se atualiza sozinha — sem loading falso.
  const esperaDoPatrono = visao?.prioritaria?.espera === 'AGUARDANDO_PATRONO'
  useEffect(() => {
    if (!esperaDoPatrono) return
    const t = setInterval(carregar, 20_000)
    return () => clearInterval(t)
  }, [esperaDoPatrono, carregar])

  const j = visao?.prioritaria ?? null
  useEffect(() => {
    setPublicou(false)
    setUrl('')
  }, [j?.candidatoId, j?.etapa])

  /** Uma ação por vez: duplo clique não envia duas vezes (o servidor também é idempotente). */
  async function executar(fn: () => Promise<VisaoDaOperacao | void>, ok?: string) {
    if (travado.current) return
    travado.current = true
    setOcupado(true)
    try {
      const v = await fn()
      if (v) setVisao(v)
      else await carregar()
      if (ok) toast({ title: ok, variant: 'success' })
      avisarMudancaNoPrecisaDeVoce()
    } catch (e) {
      toast({ title: 'Não deu certo', description: (e as Error).message, variant: 'destructive' })
      await carregar()
    } finally {
      travado.current = false
      setOcupado(false)
    }
  }

  const responder = (resposta: string, extra?: Record<string, unknown>) =>
    executar(() => chamar('/api/operacao/responder', { candidatoId: j!.candidatoId, resposta, ...extra }))

  /** Mídia e aprovação de vídeo usam as portas que já existiam (mesmas regras de direito de uso e checagem). */
  async function agirNoVideo(acao: string, corpo?: unknown) {
    const aid = j?.assistida?.id
    if (!aid) return
    await executar(async () => {
      const headers = { 'Content-Type': 'application/json' }
      const body = JSON.stringify(corpo ?? {})
      const res =
        acao === 'aprovar' ? await fetch(`/api/tiktok/assistido/${aid}/aprovar`, { method: 'POST', headers, body })
          : acao === 'ajuste' ? await fetch(`/api/tiktok/assistido/${aid}/ajuste`, { method: 'POST', headers, body })
            : acao === 'midia' ? await fetch('/api/midias', { method: 'POST', headers, body: JSON.stringify({ ...(corpo as object), assistidaId: aid }) })
              : await fetch(`/api/tiktok/assistido/${aid}/rejeitar`, { method: 'POST', headers, body })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error ?? 'Não deu certo.')
      return chamar('/api/operacao')
    }, acao === 'midia' ? 'Mídia recebida: o Patrono está gerando o vídeo' : acao === 'aprovar' ? 'Aprovado' : 'Registrado')
  }

  if (erro && !visao) {
    return <div className="card-stat text-sm text-danger">Não consegui carregar a operação: {erro} <Button size="sm" variant="outline" onClick={carregar}>Tentar de novo</Button></div>
  }
  if (!visao) return <p className="card-stat flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Abrindo a operação…</p>

  const acao = j?.acao ?? null
  const itemDoVideo: ItemParaAprovar | null = j?.assistida && (acao?.tipo === 'FORNECER_MIDIA_REAL' || acao?.tipo === 'APROVAR_VIDEO')
    ? {
        id: j.assistida.id, versao: j.assistida.versao, apresentacao: j.assistida.apresentacao as ItemParaAprovar['apresentacao'], qualityGate: j.assistida.qualityGate as ItemParaAprovar['qualityGate'],
        objetivoDoTeste: j.assistida.objetivoDoTeste, vezesQueOProdutoApareceu: j.assistida.vezesQueOProdutoApareceu, status: j.assistida.status, imagem: j.assistida.imagem, liberacao: j.assistida.liberacao,
        modo: acao.tipo === 'FORNECER_MIDIA_REAL' ? 'MIDIA' : 'APROVAR',
      }
    : null
  const respostasSimples = acao && !['FORNECER_MIDIA_REAL', 'APROVAR_VIDEO', 'PUBLICAR_VIDEO', 'MARCAR_PRODUTO', 'COLAR_LINK_PUBLICADO', 'CONFIRMAR_RESULTADO_MANUAL'].includes(acao.tipo)

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center gap-2">
        <Route className="w-5 h-5 text-accent shrink-0" />
        <h1 className="text-lg font-semibold text-white">Operação</h1>
        {j && <span className={cn('ml-auto text-[11px] rounded-full border px-2 py-0.5', j.espera === 'AGUARDANDO_CRISTIANE' ? 'border-accent text-accent' : 'border-border text-muted-foreground')}>{ESPERA_TEXTO[j.espera] ?? j.espera}</span>}
      </div>

      <BlocoHoje h={visao.hoje} />

      {!j && (
        <section className="card-stat space-y-1 text-sm" aria-label="Patrono trabalhando">
          <p className="text-white font-medium">Patrono está trabalhando</p>
          <p className="text-muted-foreground">Nenhuma jornada em andamento e nenhum produto elegível agora. A coleta diária e o ranking continuam; quando houver produto, ele aparece aqui para você aprovar.</p>
        </section>
      )}

      {j && (
        <section className="card-stat space-y-3" aria-label="Etapa atual">
          <BarraDeProgresso j={j} />
          <div className="flex gap-3 items-start">
            {j.produto.imagem && <img src={j.produto.imagem} alt="" className="w-14 h-14 rounded-lg object-cover shrink-0" />}
            <div className="min-w-0 space-y-0.5">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Etapa atual{j.proposta ? ' · novo produto' : ''}</p>
              <p className="text-base font-semibold text-white">{j.titulo}</p>
              <p className="text-sm text-white/80 line-clamp-2" title={j.produto.nome}>{j.produto.nome}</p>
            </div>
          </div>
          {/* P2.24: por que ESTA ação agora — a decisão vem do motor único (lib/decisao-agora.ts); a tela só mostra. */}
          {visao.agora?.candidatoId === j.candidatoId && visao.agora.porque.length > 0 && (
            <details className="text-xs text-muted-foreground" aria-label="Por que agora">
              <summary className="cursor-pointer hover:text-white">Por que esta ação agora</summary>
              <ul className="mt-1 space-y-0.5 list-disc pl-4 break-words">{visao.agora.porque.map((x) => <li key={x}>{x}</li>)}</ul>
              {visao.agora.alternativas.length > 0 && <p className="mt-1 break-words">Depois: {visao.agora.alternativas.map((x) => `${x.titulo} (${x.porqueNao})`).join(' · ')}</p>}
            </details>
          )}

          {acao ? (
            <div className="space-y-3">
              <p className="text-sm text-white">{acao.instrucao}</p>
              {j.missao && <p className="text-xs text-accent">{j.missao}</p>}

              {/* P2.20: o motor único diz se a quota oficial acabou; a tela só mostra. */}
              {(acao.tipo === 'APROVAR_VIDEO' || acao.tipo === 'PUBLICAR_VIDEO') && visao.hoje.quota?.resultado === 'BLOQUEADA' && <p role="alert" className="text-sm text-danger font-semibold">{visao.hoje.quota.motivo}</p>}
              {itemDoVideo && <CartaoDeAprovacao item={itemDoVideo} ocupado={ocupado} agir={agirNoVideo} />}
              {acao.tipo === 'FORNECER_MIDIA_REAL' && <MidiaDoVendedor candidatoId={j.candidatoId} linkDoProduto={j.produto.link} />}

              {(acao.tipo === 'PUBLICAR_VIDEO' || acao.tipo === 'MARCAR_PRODUTO' || acao.tipo === 'COLAR_LINK_PUBLICADO') && (
                <div className="space-y-3">
                  {acao.tipo === 'PUBLICAR_VIDEO' && <PacoteDePublicacao j={j} />}
                  <div className="flex flex-wrap gap-2">
                    {acao.linkExterno && <a href={acao.linkExterno.url} target="_blank" rel="noopener noreferrer"><Button variant="outline"><ExternalLink className="w-4 h-4" />{acao.linkExterno.rotulo}</Button></a>}
                    {!publicou && <Button disabled={ocupado} onClick={() => setPublicou(true)}>JÁ PUBLIQUEI</Button>}
                  </div>
                  {publicou && (
                    <div className="space-y-2">
                      <input autoFocus className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-white" placeholder="Cole o link do vídeo (https://www.tiktok.com/@…/video/…)" value={url} onChange={(e) => setUrl(e.target.value)} />
                      <input className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-white" placeholder="Som que você usou no app (opcional — ajuda o Patrono a aprender)" value={somUsado} onChange={(e) => setSomUsado(e.target.value)} aria-label="Som usado" />
                      <Button className="w-full" disabled={ocupado || url.trim().length < 20} onClick={() => responder('PUBLIQUEI', { url, som: somUsado || null })}>{ocupado ? <Loader2 className="w-4 h-4 animate-spin" /> : null}SALVAR LINK</Button>
                    </div>
                  )}
                </div>
              )}

              {acao.tipo === 'CONFIRMAR_RESULTADO_MANUAL' && (
                <div className="space-y-2">
                  {acao.linkExterno && <a href={acao.linkExterno.url} target="_blank" rel="noopener noreferrer" className="text-accent text-xs inline-flex items-center gap-1"><ExternalLink className="w-3.5 h-3.5" />{acao.linkExterno.rotulo}</a>}
                  <FormularioDeResultado ocupado={ocupado} enviar={(numeros) => responder('INFORMAR', { numeros })} />
                </div>
              )}

              {respostasSimples && (
                <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2">
                  {acao.linkExterno && <a href={acao.linkExterno.url} target="_blank" rel="noopener noreferrer" className="sm:order-first"><Button variant="outline" className="w-full"><ExternalLink className="w-4 h-4" />{acao.linkExterno.rotulo}</Button></a>}
                  {acao.respostas.map((r) => (
                    <Button key={r.id} size={r.principal ? 'lg' : 'default'} variant={r.principal ? 'default' : 'outline'} className="w-full sm:w-auto" disabled={ocupado} onClick={() => responder(r.id)}>
                      {ocupado && r.principal ? <Loader2 className="w-4 h-4 animate-spin" /> : null}{r.rotulo}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2 text-sm">
              <p className="text-white flex items-center gap-2">{j.terminal ? <CheckCircle2 className="w-4 h-4 text-accent" /> : null}{j.terminal ? j.depois : 'Nenhuma ação sua agora.'}</p>
              {j.aguardando && <p className="text-muted-foreground">Aguardando: {j.aguardando}</p>}
              <p className="text-muted-foreground">Próximo marco: {j.proximoMarco}</p>
              {j.atualizacoes.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Mudou no app? (opcional)</p>
                  <div className="flex flex-wrap gap-2">
                    {j.atualizacoes.map((r) => <Button key={r.id} size="sm" variant="outline" disabled={ocupado} onClick={() => responder(r.id)}>{r.rotulo}</Button>)}
                  </div>
                </div>
              )}
            </div>
          )}

          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-white">Detalhes</summary>
            <div className="mt-2 space-y-2 text-muted-foreground">
              <div><p className="text-white/80">O Patrono já fez</p><ul className="list-disc pl-4">{j.patronoJaFez.map((x) => <li key={x}>{x}</li>)}</ul></div>
              {j.porqueEsteProduto.length > 0 && <div><p className="text-white/80">Por que este produto</p><ul className="list-disc pl-4">{j.porqueEsteProduto.map((x) => <li key={x}>{x}</li>)}</ul></div>}
              <p><span className="text-white/80">Depois:</span> {j.depois}</p>
              {acao && <p><span className="text-white/80">Por que não é automático:</span> {acao.porQueNaoAutomatico}</p>}
              {acao && <p><span className="text-white/80">Tempo estimado:</span> {acao.tempoEstimado}</p>}
            </div>
          </details>

          {j.historico.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-white">Histórico</summary>
              <ul className="mt-2 space-y-0.5 text-muted-foreground">{j.historico.map((h, i) => <li key={`${h.em}-${i}`}><span className="text-white/60">{quando(h.em)}</span> {h.texto}</li>)}</ul>
            </details>
          )}
        </section>
      )}

      <EscolherProduto
        key={j?.candidatoId ?? 'nenhuma'}
        ocupado={ocupado}
        escolher={(candidatoId, emMaos) => executar(() => chamar('/api/operacao/escolher', { candidatoId, emMaos }), 'Produto escolhido: é a sua operação agora')}
      />

      {visao.outras.length > 0 && (
        <details className="card-stat text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-white">Outras jornadas em andamento: {visao.outras.length}</summary>
          <ul className="mt-2 space-y-1">
            {visao.outras.map((o) => <li key={o.candidatoId} className="text-muted-foreground"><span className="text-white/85">{o.nome}</span> · {o.titulo} · {ESPERA_TEXTO[o.espera] ?? o.espera}</li>)}
          </ul>
        </details>
      )}
    </div>
  )
}
