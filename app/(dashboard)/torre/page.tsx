'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, ArrowRight, ChevronRight } from 'lucide-react'
import { useGuardModulo } from '@/hooks/useGuardModulo'
import { VisaoGeral } from '@/components/dashboard/VisaoGeral'
import { Kpi, Indicador, Detalhes, TituloDeSecao, reaisOuNull, type Tom } from '@/components/shared/Ux'
import { cn } from '@/lib/utils'
import { estadoDoCodigo, MODO_ASSISTIDO, resumoDaAutonomia } from '@/lib/autonomia'
import { situacaoDaAffiliateApi } from '@/lib/elegibilidade-tiktok-shop'

/**
 * P2.17.10 → P2.17.13 — Torre de Controle: VISÃO EXECUTIVA.
 *
 * Em segundos: dinheiro → status → o que o Patrono está fazendo → o que
 * precisa de você → próxima ação. O técnico (filas, produtos, linha do
 * tempo, antigo Dashboard) fica recolhido em "Detalhes da operação".
 * Nada inventado: sem dado oficial, "Aguardando dados oficiais".
 */

interface ItemDaAgenda { quando: string; titulo: string; origem: string; link: string }
interface Janela { vendas: number | null; comissao: number | null; receita: number | null; views: number | null; receitaPor1000Views: number | null }
interface Torre {
  status: { tiktok: { nivel: string; frase: string }; tiktokShopApi: string; iaPaga?: string; integracoes: { nome: string; estado: string; detalhe: string }[]; metricas: string; patrono: { titulo: string; frase: string } }
  receita: { hoje: Janela; sete: Janela; trinta: Janela; comissoesFonteUnica: { prevista: number; confirmada: number; recebida: number }; financeiro: { confirmada30d: number; previsao: number; revertida30d: number; informadaNosVideos30d: number | null }; missaoEmJogo: number | null; melhorProduto: string | null; melhorVideo: { produto: string | null; gancho: string; receita: number | null; url: string | null } | null }
  agenda: { hoje: ItemDaAgenda[]; proximas: ItemDaAgenda[]; proximoHorario: string | null }
  agora: { tarefa: string; inicio: string | null; status: string; proxima: string | null }
  agoraEnxuto: { produto: string | null; etapa: string; depois: string | null }
  jornada: { etapa: string; rotulo: string; valor: number | null; detalhe: string | null }[]
  assistido: { concluidas: number; limite: number; porEstado: Record<string, number>; recomendacao: string | null }
  filaDeConteudos: Record<string, number>
  filaDePublicacao: { id: string; produto: string; estado: string; statusReal: string; videoGerado: boolean; qualityGate: string | null; motivoEscolha: string; bloqueio: string | null; erro: string | null; url: string | null; ordem: number | null }[]
  produtos: { escalar: { id: string; nome: string; motivo: string | null }[]; pausar: { id: string; nome: string; motivo: string | null }[] }
  precisaDeVoce: { titulo: string; link: string; categoria: string }[]
  precisaDeVoceTotal: number
  dinheiro: { titulo: string; detalhe: string; valor: number | null; href: string; acao: string }[]
  linhaDoTempo: { quando: string; texto: string; vezes: number }[]
  amostras: { pendentesDeAprovacao: number; aprovadas: number; enviadas: number; recebidas: number; comPrazoProximo: number; total: number } | null
  caminhoPrimeiraComissao: { etapa: string; estado: string; detalhe: string }[] | null
  riscos: { tipo: string; produto: string | null; detalhe: string; gravidade: string }[]
}

const diaEHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
const ROTULO_ASSISTIDO: Record<string, string> = { GERANDO: 'gerando', AGUARDANDO_MIDIA: 'aguardando mídia autorizada', VIDEO_NA_FILA: 'vídeo na fila', GERANDO_VIDEO: 'vídeo em geração', VIDEO_FALHOU: 'geração do vídeo falhou', PRONTO: 'pronto', AGUARDANDO_APROVACAO: 'aguardando aprovação', APROVADO: 'aprovado', PUBLICANDO: 'publicando', PUBLICADO: 'publicado', FALHOU: 'falhou' }
const ESTADO_DA_ETAPA: Record<string, { rotulo: string; cor: string }> = {
  CONCLUIDO: { rotulo: 'CONCLUÍDO', cor: 'text-accent' }, EM_ANDAMENTO: { rotulo: 'EM ANDAMENTO', cor: 'text-white' }, BLOQUEADO: { rotulo: 'BLOQUEADO', cor: 'text-white/50' },
  PRECISA_DE_VOCE: { rotulo: 'PRECISA DE VOCÊ', cor: 'text-warning' }, DEPENDE_DO_TIKTOK: { rotulo: 'DEPENDE DO TIKTOK', cor: 'text-muted-foreground' },
}
const CATEGORIA: Record<string, string> = { APROVACAO: 'Aprovação', AUTORIZACAO: 'Autorização', LOGIN_MFA: 'Login', DOCUMENTO: 'Documento', REVISAO: 'Revisão', ACAO_EXTERNA: 'Ação externa', BLOQUEIO_DA_PLATAFORMA: 'Bloqueio' }
/** Cada etapa da jornada abre o lugar onde ela é detalhada. */
const DETALHE_DA_ETAPA: Record<string, string> = {
  DESCOBRINDO: '/oportunidades', ANALISANDO: '/oportunidades', GERANDO: '/conteudo', VALIDANDO: '/conteudo',
  APROVANDO: '/precisa-de-voce', PUBLICANDO: '/calendario', VENDENDO: '/vendas-receita', APRENDENDO: '/relatorios',
}

/** Status das integrações em indicadores compactos (bolinha + estado curto). */
function indicadoresDaTorre(s: Torre['status']): { nome: string; estado: string; tom: Tom; href: string }[] {
  return [
    { nome: 'TikTok', estado: s.tiktok.nivel === 'BLOQUEADO' ? 'aguardando aprovação' : s.tiktok.nivel === 'SEMIAUTOMATICO' ? 'rascunho' : 'automático', tom: s.tiktok.nivel === 'BLOQUEADO' ? 'atencao' : 'ok', href: '/integracoes' },
    { nome: 'TikTok Shop', estado: situacaoDaAffiliateApi().bloqueada ? `API bloqueada até ${situacaoDaAffiliateApi().revisaoEmBR} · operação assistida` : 'aguardando acesso', tom: 'atencao', href: '/integracoes' },
    { nome: 'Métricas', estado: /API/.test(s.metricas) ? 'API oficial' : 'manual temporário', tom: /API/.test(s.metricas) ? 'ok' : 'neutro', href: '/relatorios' },
    ...s.integracoes.filter((i) => i.estado !== 'OK').map((i) => ({ nome: i.nome, estado: i.estado.toLowerCase(), tom: 'atencao' as Tom, href: '/integracoes' })),
  ]
}

const AUTONOMIA = resumoDaAutonomia()

interface Hoje {
  pergunta: string
  resposta: { tipo: 'FAZER' | 'AGUARDAR' | 'NADA'; titulo: string; produto: string | null; porque: string[]; tempoEstimado: string | null; link: string; botao: string; origem: string }
  depois: { titulo: string; porqueNao: string }[]
  esperandoVoce: number
  prazo: { titulo: string; em: string } | null
  dinheiro: { confirmada30d: number; previsao: number; revertida30d: number } | null
  restricao: string | null
}

/**
 * P2.26 — HOJE: a primeira coisa da Home responde "O que eu preciso fazer agora?".
 * Uma resposta só (a decisão da Operação; senão a central do sininho), com o porquê e o que vem depois.
 */
function BlocoHoje() {
  const [h, setH] = useState<Hoje | null>(null)
  const [falhou, setFalhou] = useState(false)
  useEffect(() => {
    let vivo = true
    const carregar = () => fetch('/api/hoje').then((x) => (x.ok ? x.json() : Promise.reject(x.status))).then((d) => vivo && (setH(d), setFalhou(false))).catch(() => vivo && setFalhou(true))
    carregar()
    const i = setInterval(carregar, 60_000)
    return () => { vivo = false; clearInterval(i) }
  }, [])
  if (!h) {
    return (
      <section aria-label="Hoje" className="card-stat text-sm text-muted-foreground">
        {falhou ? <>Não consegui montar o HOJE agora. <Link href="/operacao" className="text-accent hover:underline">Abrir a Operação</Link></> : <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Vendo o que é preciso agora…</span>}
      </section>
    )
  }
  const r = h.resposta
  return (
    <section aria-label="Hoje" className={cn('card-stat space-y-2', r.tipo === 'FAZER' ? 'border-accent' : 'border-border')}>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Hoje · {h.pergunta}</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className={cn('text-lg font-bold break-words', r.tipo === 'FAZER' ? 'text-white' : 'text-accent')}>{r.tipo === 'FAZER' ? r.titulo : r.tipo === 'AGUARDAR' ? 'Nada com você agora' : r.titulo}</p>
          {r.tipo === 'AGUARDAR' && <p className="text-sm text-white break-words">{r.titulo}</p>}
          {r.produto && r.tipo === 'FAZER' && <p className="text-sm text-muted-foreground break-words">{r.produto}{r.tempoEstimado ? ` · ${r.tempoEstimado}` : ''}</p>}
        </div>
        <Link href={r.link} className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-black hover:opacity-90 shrink-0" aria-label="Fazer agora">
          {r.botao} <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
      {r.porque.length > 0 && <p className="text-xs text-muted-foreground break-words" aria-label="Por quê">Por quê: {r.porque.slice(0, 2).join(' · ')}</p>}
      {h.depois.length > 0 && <p className="text-xs text-muted-foreground break-words" aria-label="Depois">Depois: {h.depois.map((d) => `${d.titulo} (${d.porqueNao})`).join(' · ')}</p>}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <Link href="/precisa-de-voce" className="hover:underline">Esperando você: <span className={cn('font-semibold', h.esperandoVoce ? 'text-warning' : 'text-accent')}>{h.esperandoVoce}</span></Link>
        {h.prazo && <span>Prazo mais próximo: <span className="text-white">{h.prazo.titulo}</span> · {diaEHora(h.prazo.em)}</span>}
        {h.restricao && <span className="text-warning">{h.restricao}</span>}
      </div>
    </section>
  )
}

export default function TorreDeControlePage() {
  useGuardModulo('dashboard')
  const [t, setT] = useState<Torre | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  // O antigo Dashboard só carrega quando a seção é aberta.
  const [verVisaoGeral, setVerVisaoGeral] = useState(false)
  useEffect(() => {
    let vivo = true
    const carregar = () =>
      fetch('/api/torre')
        .then(async (r) => {
          const d = await r.json().catch(() => ({}))
          if (!r.ok) throw new Error(r.status === 401 ? 'Sua sessão expirou. Entre de novo.' : d.error ?? 'Não consegui carregar.')
          if (vivo) setT(d)
        })
        .catch((e) => vivo && setErro((e as Error).message))
    carregar()
    const i = setInterval(carregar, 60_000)
    return () => {
      vivo = false
      clearInterval(i)
    }
  }, [])

  if (erro) return <p className="card-stat text-sm text-muted-foreground">{erro}</p>
  if (!t) return <p className="card-stat flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Montando a Torre…</p>

  return (
    <div className="w-full max-w-6xl space-y-4">
      {/* 0. HOJE — o que eu preciso fazer agora (P2.26) */}
      <BlocoHoje />
      {/* 1. Dinheiro — pela fonte canônica (P2.25): confirmado, previsão e informada nunca se somam */}
      <section aria-label="Dinheiro" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Kpi rotulo="Comissão confirmada (30 d)" valor={reaisOuNull(t.receita.financeiro.confirmada30d)} destaque />
        <Kpi rotulo="Previsão (não é receita)" valor={reaisOuNull(t.receita.financeiro.previsao)} />
        <Kpi rotulo="Informada nos vídeos (30 d)" valor={reaisOuNull(t.receita.financeiro.informadaNosVideos30d)} />
        <Kpi rotulo="Vendas (30 d)" valor={t.receita.trinta.vendas} />
        {/* Missões são registradas no Patrono: sem registro = "nenhuma registrada", não "aguardando dados". */}
        <Kpi rotulo="Missão em jogo" valor={reaisOuNull(t.receita.missaoEmJogo)} semValor="Nenhuma missão registrada" />
      </section>

      {/* 2. Status */}
      <section aria-label="Status" className="flex flex-wrap gap-1.5">
        {indicadoresDaTorre(t.status).map((i) => <Indicador key={i.nome} {...i} />)}
      </section>

      {/* 3. O Patrono agora · 4. Precisa de você (a próxima ação está no HOJE, no topo) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <section className="card-stat space-y-1" aria-label="O que o Patrono está fazendo agora">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">O Patrono agora</p>
          {t.agoraEnxuto.produto && <p className="text-sm font-semibold text-white">{t.agoraEnxuto.produto}</p>}
          <p className="text-sm text-accent">{t.agoraEnxuto.etapa}</p>
          {t.agoraEnxuto.depois && <p className="text-xs text-muted-foreground">Depois: {t.agoraEnxuto.depois}</p>}
          <p className="text-[11px] text-muted-foreground">Modo assistido: <Link href="/precisa-de-voce" className="text-white hover:underline">{t.assistido.concluidas}/{t.assistido.limite}</Link></p>
        </section>

        <section className="card-stat space-y-1.5" aria-label="Precisa de você">
          <div className="flex items-baseline justify-between">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Precisa de você</p>
            <span className={cn('text-lg font-bold tabular-nums', t.precisaDeVoceTotal ? 'text-warning' : 'text-accent')}>{t.precisaDeVoceTotal}</span>
          </div>
          {t.precisaDeVoce.length === 0 ? (
            <p className="text-sm text-accent">Nenhuma ação sua necessária.</p>
          ) : (
            <ul className="space-y-1">
              {t.precisaDeVoce.slice(0, 3).map((p) => (
                <li key={p.titulo}><Link href={p.link} className="text-sm text-white hover:underline"><span className="text-[10px] uppercase text-muted-foreground mr-1">{CATEGORIA[p.categoria] ?? p.categoria}</span>{p.titulo}</Link></li>
              ))}
            </ul>
          )}
          <Link href="/precisa-de-voce" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">Abrir a central <ArrowRight className="w-3 h-3" /></Link>
        </section>
      </div>

      {/* Jornada visual */}
      <section aria-label="Jornada" className="space-y-2">
        <TituloDeSecao>Jornada</TituloDeSecao>
        <div className="flex flex-wrap items-stretch gap-1">
          {t.jornada.map((j, i) => (
            <div key={j.etapa} className="flex items-center gap-1">
              <Link href={DETALHE_DA_ETAPA[j.etapa] ?? '/torre'} title={j.detalhe ?? undefined} className={cn('rounded-lg border px-3 py-2 min-w-[92px] hover:bg-white/5', j.valor ? 'border-accent/40' : 'border-border')}>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{j.rotulo}</p>
                <p className={cn('text-lg font-bold tabular-nums', j.valor ? 'text-white' : 'text-white/40')}>{j.valor ?? '—'}</p>
              </Link>
              {i < t.jornada.length - 1 && <ChevronRight className="w-3 h-3 text-white/30 shrink-0" aria-hidden />}
            </div>
          ))}
        </div>
      </section>

      {/* Dinheiro agora + Agenda (+ Amostras, quando houver) */}
      <div className={cn('grid grid-cols-1 gap-3', t.amostras ? 'lg:grid-cols-3' : 'lg:grid-cols-2')}>
        <section className="card-stat space-y-2" aria-label="Onde está o dinheiro agora">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Onde está o dinheiro agora</p>
          {t.dinheiro.length === 0 ? <p className="text-sm text-muted-foreground">Sem oportunidade com dado real agora.</p> : (
            <ul className="space-y-2">
              {t.dinheiro.slice(0, 3).map((d) => (
                <li key={d.titulo} className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm text-white truncate">{d.titulo}</p>
                    <p className="text-[11px] text-muted-foreground line-clamp-1">{d.detalhe}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    {d.valor !== null && <p className="text-sm font-semibold text-accent">{reaisOuNull(d.valor)}</p>}
                    <Link href={d.href} className="text-[11px] text-accent hover:underline">{d.acao}</Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card-stat space-y-2" aria-label="Agenda">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Agenda</p>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div><p className="text-[11px] text-muted-foreground">Hoje</p><p className="text-white font-semibold">{t.agenda.hoje.length}</p></div>
            <div><p className="text-[11px] text-muted-foreground">Próxima publicação</p><p className="text-white text-xs">{t.agenda.proximas[0]?.titulo ?? '—'}</p></div>
            <div><p className="text-[11px] text-muted-foreground">Próximo horário</p><p className="text-white text-xs">{t.agenda.proximoHorario ? diaEHora(t.agenda.proximoHorario) : '—'}</p></div>
          </div>
          <Link href="/calendario" className="inline-block text-xs text-accent hover:underline">Abrir calendário</Link>
        </section>

        {t.amostras && (
          <section className="card-stat space-y-2" aria-label="Amostras em andamento">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Amostras em andamento</p>
            <div className="grid grid-cols-4 gap-2 text-sm">
              <div><p className="text-[11px] text-muted-foreground">Pendentes</p><p className="text-white font-semibold tabular-nums">{t.amostras.pendentesDeAprovacao + t.amostras.aprovadas}</p></div>
              <div><p className="text-[11px] text-muted-foreground">Enviadas</p><p className="text-white font-semibold tabular-nums">{t.amostras.enviadas}</p></div>
              <div><p className="text-[11px] text-muted-foreground">Recebidas</p><p className="text-white font-semibold tabular-nums">{t.amostras.recebidas}</p></div>
              <div><p className="text-[11px] text-muted-foreground">Prazo próximo</p><p className={cn('font-semibold tabular-nums', t.amostras.comPrazoProximo ? 'text-warning' : 'text-white')}>{t.amostras.comPrazoProximo}</p></div>
            </div>
            <Link href="/tiktok-metas#amostras" className="inline-block text-xs text-accent hover:underline">Ver amostras</Link>
          </section>
        )}
      </div>

      {t.riscos.length > 0 && (
        <section className="card-stat space-y-1" aria-label="Riscos">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Riscos que podem custar dinheiro</p>
          <ul className="space-y-0.5 text-xs">{t.riscos.map((r, i) => <li key={i} className={r.gravidade === 'ALTA' ? 'text-warning' : 'text-white/80'}>{r.produto ? <b>{r.produto}: </b> : null}{r.detalhe}</li>)}</ul>
        </section>
      )}

      {t.caminhoPrimeiraComissao && (
        <section className="card-stat" aria-label="Caminho para a primeira comissão">
          <Detalhes titulo={`Caminho para a primeira comissão (${t.caminhoPrimeiraComissao.filter((e) => e.estado === 'CONCLUIDO').length}/${t.caminhoPrimeiraComissao.length} concluídas)`}>
            <ol className="space-y-1 pt-1">
              {t.caminhoPrimeiraComissao.map((e) => (
                <li key={e.etapa} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-white">{e.etapa}</span>
                  <b className={cn('text-[10px]', ESTADO_DA_ETAPA[e.estado]?.cor)}>{ESTADO_DA_ETAPA[e.estado]?.rotulo ?? e.estado}</b>
                  <span className="text-muted-foreground basis-full sm:basis-auto">{e.detalhe}</span>
                </li>
              ))}
            </ol>
          </Detalhes>
        </section>
      )}

      {/* P2.18.1 — regra permanente: manual é contingência e diz como será eliminado. */}
      <section className="card-stat" aria-label="Autonomia do Patrono">
        <Detalhes titulo={`Autonomia do Patrono (${AUTONOMIA.automaticas}/${AUTONOMIA.total} etapas automáticas; ${AUTONOMIA.manuais.length} em contingência manual)`}>
          <p className="pt-1 text-muted-foreground"><span className="text-white">{MODO_ASSISTIDO.nome}</span> (até {MODO_ASSISTIDO.ate}): {AUTONOMIA.affiliate.frase} A operação continua assistida na página Operação.</p>
          <ul className="space-y-1.5 pt-1">
            {AUTONOMIA.manuais.map((e) => (
              <li key={e.id}>
                <span className="text-white">{e.etapa}</span> <b className="text-[10px] text-warning">{estadoDoCodigo(e)}</b>
                <span className="block text-muted-foreground">Hoje: {e.hoje}</span>
                <span className="block text-muted-foreground">Por quê: {e.porqueManual}</span>
                <span className="block text-muted-foreground">Como deixa de ser manual: {e.comoEliminar}</span>
              </li>
            ))}
          </ul>
        </Detalhes>
      </section>

      {/* Detalhes técnicos: recolhidos */}
      <section className="card-stat" aria-label="Detalhes da operação">
        <Detalhes titulo="Detalhes da operação (fila de publicação, conteúdos, produtos, status por extenso)">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pt-1">
            <div>
              <p className="text-white font-medium mb-1">Fila de publicação</p>
              {t.filaDePublicacao.length === 0 ? <p>Vazia.</p> : (
                <ul className="space-y-1">{t.filaDePublicacao.map((p) => (
                  <li key={p.id}>
                    <span className="text-white">{p.produto}</span>{p.ordem ? ` (#${p.ordem})` : ''}
                    <span className="block"><b className="text-white">{p.statusReal}</b></span>
                    <span className="block">Quality Gate: <b className={p.qualityGate === 'APROVADO' ? 'text-accent' : 'text-danger'}>{p.qualityGate ?? '—'}</b></span>
                    <details><summary className="cursor-pointer">Por que este produto</summary><span className="block">{p.motivoEscolha}</span></details>
                    {p.bloqueio ? <span className="block text-warning">{p.bloqueio}</span> : null}{p.erro ? <span className="block text-danger">{p.erro}</span> : null}
                  </li>
                ))}</ul>
              )}
            </div>
            <div>
              <p className="text-white font-medium mb-1">Conteúdos por status</p>
              {Object.keys(t.filaDeConteudos).length === 0 ? <p>Vazia.</p> : <ul>{Object.entries(t.filaDeConteudos).map(([s, n]) => <li key={s}>{s.replace(/_/g, ' ')}: <b className="text-white">{n}</b></li>)}</ul>}
              <p className="text-white font-medium mt-3 mb-1">Modo assistido</p>
              <p>{Object.entries(t.assistido.porEstado).filter(([, n]) => n > 0).map(([e, n]) => `${ROTULO_ASSISTIDO[e] ?? e} ${n}`).join(' · ') || 'nenhuma em andamento'}</p>
              {t.assistido.recomendacao && <p className="text-warning">Recomendação: {t.assistido.recomendacao} (você decide)</p>}
            </div>
            <div>
              <p className="text-white font-medium mb-1">Produtos</p>
              {t.produtos.escalar.length === 0 && t.produtos.pausar.length === 0 && <p>Nenhum em ESCALAR/PAUSAR: ainda sem evidência suficiente.</p>}
              <ul>
                {t.produtos.escalar.map((p) => <li key={p.id}><b className="text-accent">ESCALAR</b> · {p.nome}</li>)}
                {t.produtos.pausar.map((p) => <li key={p.id}><b className="text-warning">PAUSAR</b> · {p.nome}</li>)}
              </ul>
              <p className="text-white font-medium mt-3 mb-1">Status por extenso</p>
              <p>Patrono: {t.status.patrono.titulo}. TikTok: {t.status.tiktok.frase} TikTok Shop: {t.status.tiktokShopApi}. Métricas: {t.status.metricas}. IA paga: {t.status.iaPaga === 'LIGADA' ? 'ligada' : 'desligada (só gratuito)'}.</p>
              <p className="mt-1">Agora: {t.agora.tarefa}{t.agora.inicio ? ` · desde ${hora(t.agora.inicio)}` : ''}</p>
            </div>
          </div>
        </Detalhes>
      </section>

      <details className="card-stat text-sm">
        <summary className="cursor-pointer text-white font-medium">Linha do tempo de hoje</summary>
        {t.linhaDoTempo.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">Nenhum evento registrado hoje.</p> : (
          <ul className="mt-2 space-y-1 text-xs">{t.linhaDoTempo.map((l, i) => <li key={i} className="text-muted-foreground"><b className="text-white">{hora(l.quando)}</b> — {l.texto}{l.vezes > 1 ? ` (${l.vezes}×)` : ''}</li>)}</ul>
        )}
      </details>

      {/* O antigo Dashboard, absorvido. Mesmo conteúdo, sem segunda Home. */}
      <details className="card-stat text-sm" onToggle={(e) => e.currentTarget.open && setVerVisaoGeral(true)}>
        <summary className="cursor-pointer text-white font-medium">Visão geral (produtos, conteúdos, lucro e escala)</summary>
        {verVisaoGeral && <div className="mt-3"><VisaoGeral /></div>}
      </details>
    </div>
  )
}
