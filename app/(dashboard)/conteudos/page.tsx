'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Eye, Trash2, Library, Zap, CalendarClock, X, Send, Upload, Copy,
  Instagram, Loader2, ExternalLink, AlertCircle, CheckCircle, Sparkles,
  LinkIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { PhonePreview } from '@/components/shared/PhonePreview'
import { CarouselPreview } from '@/components/shared/CarouselPreview'
import { formatDateShort, copyToClipboard } from '@/lib/utils'
import { LINK_COMPRA } from '@/lib/config'
import { STATUS_LABELS, type StatusConteudo } from '@/types'
import { toast } from '@/hooks/use-toast'
import { enviarMidia } from '@/lib/upload-midia'
import { useGuardModulo } from '@/hooks/useGuardModulo'
import { respostaFinal } from '@/lib/aguardar-trabalho'

interface Conteudo {
  id: string
  status: string
  atrasado?: boolean
  redeSocial: string
  estilo: string
  visualizacoes: number
  createdAt: string
  dataAgendamento: string | null
  videoUrl: string | null
  videoRequestId: string | null
  videoErro: string | null
  duracao: number | null
  legendaInstagram: string | null
  hashtags: string[]
  chamadaAcao: string | null
  publicacaoExternaId: string | null
  erroPublicacao: string | null
  produto: { nome: string; imagens: string[] }
  // P1.0 Etapa 2.a: a publicacao pode ter saido sem link rastreado. A
  // publicacao aconteceu; o que fica incompleto e a atribuicao do clique.
  rastreamento?: {
    estado: 'RASTREADA' | 'NAO_RASTREADA_COM_FALLBACK' | 'NAO_PUBLICADA'
    aviso: { titulo: string; detalhe: string } | null
  } | null
}

const STATUS_LIST = Object.keys(STATUS_LABELS) as StatusConteudo[]

export default function ConteudosPage() {
  useGuardModulo('conteudos')
  const [conteudos, setConteudos] = useState<Conteudo[]>([])
  const [loading, setLoading] = useState(true)
  const [filtroStatus, setFiltroStatus] = useState('')
  const [filtroRede, setFiltroRede] = useState('')
  const [agendarId, setAgendarId] = useState<string | null>(null)
  const [agendarData, setAgendarData] = useState('')
  const [salvandoAgenda, setSalvandoAgenda] = useState(false)
  const [igConectado, setIgConectado] = useState(false)
  const [publicarId, setPublicarId] = useState<string | null>(null)
  const [uploadingVideo, setUploadingVideo] = useState(false)
  const [publicandoIg, setPublicandoIg] = useState(false)
  const [gerandoVideoIA, setGerandoVideoIA] = useState(false)
  const [duracaoVideoIA, setDuracaoVideoIA] = useState<number>(5)
  const [motorVideo, setMotorVideo] = useState<'kling' | 'veo' | 'luma'>('kling')
  const [tipoMidiaIg, setTipoMidiaIg] = useState<'video' | 'imagens'>('video')
  const [destinoIg, setDestinoIg] = useState<'feed' | 'stories'>('feed')
  const [adicionandoLegenda, setAdicionandoLegenda] = useState(false)

  async function fetchConteudos() {
    setLoading(true)
    const params = new URLSearchParams()
    if (filtroStatus) params.set('status', filtroStatus)
    if (filtroRede) params.set('redeSocial', filtroRede)
    try {
      const res = await fetch(`/api/conteudos?${params}`)
      const data = await res.json().catch(() => null)
      setConteudos(Array.isArray(data) ? data : [])
      if (!res.ok) toast({ title: 'Não consegui carregar os conteúdos', description: 'Tente atualizar a página.', variant: 'destructive' })
    } catch {
      toast({ title: 'Sem conexão', description: 'Não consegui carregar os conteúdos.', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchConteudos() }, [filtroStatus, filtroRede])

  useEffect(() => {
    fetch('/api/integracoes')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setIgConectado(
            data.some((i) => i.plataforma === 'instagram' && i.status === 'conectado')
          )
        }
      })
      .catch(() => {})
  }, [])

  // Polling do status de geração de vídeo (fal.ai) enquanto a modal Postar
  // está aberta e existe um job em andamento.
  useEffect(() => {
    if (!publicarId) {
      setGerandoVideoIA(false)
      return
    }
    const c = conteudos.find((x) => x.id === publicarId)
    if (!c?.videoRequestId || c.videoUrl) {
      setGerandoVideoIA(false)
      return
    }
    setGerandoVideoIA(true)
    let cancelado = false
    const tick = async () => {
      if (cancelado) return
      try {
        const res = await fetch(`/api/conteudos/${publicarId}/video-status`)
        const data = await res.json().catch(() => ({}))
        if (cancelado) return
        if (data.status === 'pronto') {
          toast({ title: 'Vídeo pronto!', description: 'A IA gerou o vídeo e ele já está anexado.', variant: 'success' })
          fetchConteudos()
        } else if (data.status === 'erro') {
          toast({ title: 'Falha na geração do vídeo', description: data.erro ?? '', variant: 'destructive' })
          fetchConteudos()
        }
      } catch {}
    }
    const intervalo = setInterval(tick, 5000)
    return () => { cancelado = true; clearInterval(intervalo) }
  }, [publicarId, conteudos])

  // Ao abrir a modal Postar, parte da duração escolhida em "Gerar Conteúdo"
  // (cai para 5s se o conteúdo não tiver uma duração válida salva).
  useEffect(() => {
    if (!publicarId) return
    const c = conteudos.find((x) => x.id === publicarId)
    const DURACOES_VALIDAS = [5, 10, 15, 30]
    setDuracaoVideoIA(c?.duracao && DURACOES_VALIDAS.includes(c.duracao) ? c.duracao : 5)
  }, [publicarId])

  async function deletar(id: string) {
    if (!confirm('Deseja realmente excluir este conteúdo?')) return
    const res = await fetch(`/api/conteudos/${id}`, { method: 'DELETE' }).catch(() => null)
    if (!res?.ok) {
      toast({ title: 'Não consegui excluir', description: 'Nada foi alterado. Tente de novo.', variant: 'destructive' })
      return
    }
    toast({ title: 'Conteúdo excluído', variant: 'success' })
    fetchConteudos()
  }

  function abrirAgendamento(c: Conteudo) {
    setAgendarId(c.id)
    // pré-preenche com a data já agendada (se houver), no formato datetime-local
    if (c.dataAgendamento) {
      const d = new Date(c.dataAgendamento)
      const pad = (n: number) => String(n).padStart(2, '0')
      setAgendarData(
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
      )
    } else {
      setAgendarData('')
    }
  }

  async function confirmarAgendamento() {
    if (!agendarId || !agendarData) {
      toast({ title: 'Escolha a data e a hora', variant: 'destructive' })
      return
    }
    const dataISO = new Date(agendarData)
    if (isNaN(dataISO.getTime())) {
      toast({ title: 'Data inválida', variant: 'destructive' })
      return
    }
    setSalvandoAgenda(true)
    const res = await fetch(`/api/conteudos/${agendarId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'agendado', dataAgendamento: dataISO.toISOString() }),
    })
    setSalvandoAgenda(false)
    if (!res.ok) {
      toast({ title: 'Erro ao agendar', description: 'Tente novamente.', variant: 'destructive' })
      return
    }
    toast({ title: 'Conteúdo agendado!', description: 'Na data marcada eu publico, se houver vídeo e o Instagram estiver conectado.', variant: 'success' })
    setAgendarId(null)
    setAgendarData('')
    fetchConteudos()
  }

  async function enviarVideo(file: File) {
    if (!publicarId) return
    if (!file.type.startsWith('video/')) {
      toast({ title: 'Selecione um arquivo de vídeo', variant: 'destructive' })
      return
    }

    const MAX_VIDEO = 500 * 1024 * 1024
    if (file.size > MAX_VIDEO) {
      toast({ title: 'Vídeo muito grande', description: 'Máximo permitido: 500MB.', variant: 'destructive' })
      return
    }

    setUploadingVideo(true)

    // Upload direto do browser → Supabase Storage (sem passar pelo Next.js/Vercel)
    let publicUrl: string
    try {
      // P2.18.6: envio com token assinado (o storage recusa escrita anônima).
      publicUrl = await enviarMidia(file, publicarId)
    } catch (err) {
      setUploadingVideo(false)
      const msg = err instanceof Error ? err.message : 'Tente novamente.'
      toast({ title: 'Erro no upload', description: msg, variant: 'destructive' })
      return
    }

    const patch = await fetch(`/api/conteudos/${publicarId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoUrl: publicUrl }),
    })
    setUploadingVideo(false)
    if (!patch.ok) {
      toast({ title: 'Erro ao salvar o vídeo', variant: 'destructive' })
      return
    }
    toast({ title: 'Vídeo enviado!', variant: 'success' })
    fetchConteudos()
  }

  function copiarTudo(c: Conteudo) {
    const texto = [
      c.legendaInstagram?.trim(),
      (c.hashtags ?? []).join(' ').trim(),
      c.chamadaAcao?.trim(),
      `🛒 Comprar: ${LINK_COMPRA}`,
    ].filter(Boolean).join('\n\n')
    copyToClipboard(texto)
    toast({ title: 'Tudo copiado!', description: 'Legenda, hashtags e link prontos para colar.', variant: 'success' })
  }

  async function gerarVideoIA() {
    if (!publicarId) return
    setGerandoVideoIA(true)
    const res = await fetch(`/api/conteudos/${publicarId}/gerar-video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ motor: motorVideo, duracao: duracaoVideoIA }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setGerandoVideoIA(false)
      toast({ title: 'Erro ao iniciar geração', description: data.error ?? 'Tente novamente.', variant: 'destructive' })
      return
    }
    toast({ title: 'Geração iniciada!', description: 'O vídeo deve ficar pronto em 1-3 minutos. Aguarde nesta tela.', variant: 'success' })
    fetchConteudos()
  }

  async function adicionarLegenda() {
    if (!publicarId) return
    setAdicionandoLegenda(true)
    const res = await fetch(`/api/conteudos/${publicarId}/adicionar-legenda`, { method: 'POST' })
    // P2.2: a legenda roda como trabalho longo; espera o fim aqui mesmo.
    const { ok, data } = await respostaFinal(res)
    setAdicionandoLegenda(false)
    if (data.processando) {
      toast({
        title: 'Legendas em processamento',
        description: data.mensagem ?? 'Tente novamente em ~30s.',
      })
      return
    }
    if (!ok) {
      toast({
        title: 'Erro ao adicionar legendas',
        description: data.error ?? 'Tente novamente.',
        variant: 'destructive',
      })
      return
    }
    toast({
      title: 'Legendas adicionadas!',
      description: 'O vídeo foi atualizado com legendas estilo CapCut.',
      variant: 'success',
    })
    fetchConteudos()
  }

  async function publicarInstagram() {
    if (!publicarId) return
    setPublicandoIg(true)
    const res = await fetch(`/api/conteudos/${publicarId}/publicar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipoMidia: tipoMidiaIg, destino: destinoIg }),
    })
    // P2.2: a publicação roda como trabalho longo; espera o fim aqui mesmo.
    const { ok, data } = await respostaFinal(res)
    setPublicandoIg(false)
    if (data.processando) {
      toast({ title: 'Publicação em andamento', description: data.mensagem ?? '' })
      fetchConteudos()
      return
    }
    if (!ok) {
      toast({ title: data.incerto ? 'Publicação sem confirmação' : 'Falha ao publicar', description: data.error ?? 'Tente novamente.', variant: 'destructive' })
      if (data.oauthError) setIgConectado(false)
      fetchConteudos()
      return
    }
    // A publicacao ACONTECEU nos dois casos. O que muda e se o clique dela
    // sera medido: sem link rastreado, o post saiu com o link direto do
    // produto e nenhum clique passa pelo redirect do Patrono.
    const aviso = data?.rastreamento?.aviso
    if (data?.rastreamento && data.rastreamento.rastreado === false) {
      toast({
        title: aviso?.titulo ?? 'Publicada sem rastreamento de cliques',
        description: `${aviso?.detalhe ?? ''} A publicação foi feita; apenas a medição de cliques fica indisponível.`.trim(),
        variant: 'destructive',
      })
    } else {
      toast({ title: 'Publicado no Instagram!', variant: 'success' })
    }
    setPublicarId(null)
    fetchConteudos()
  }

  const selectClass = `rounded-lg border border-border bg-background px-3 py-2 text-sm text-white
    focus:outline-none focus:ring-1 focus:ring-accent`

  const conteudoPublicar = conteudos.find((c) => c.id === publicarId) ?? null

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Banco de Conteúdos</h2>
          <p className="text-sm text-muted-foreground">{conteudos.length} conteúdo(s)</p>
        </div>
        {/* P2.17.14: gerar à mão é modo avançado, nunca o fluxo normal. */}
        <Button asChild variant="ghost" size="sm">
          <Link href="/conteudos/gerar"><Zap className="w-4 h-4" />Gerar manualmente</Link>
        </Button>
      </div>

      {/* Filtros */}
      <div className="flex gap-3 flex-wrap">
        <select className={selectClass} value={filtroStatus}
          onChange={(e) => setFiltroStatus(e.target.value)}>
          <option value="">Todos os status</option>
          {STATUS_LIST.map((s) => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>
        <select className={selectClass} value={filtroRede}
          onChange={(e) => setFiltroRede(e.target.value)}>
          <option value="">Todas as redes</option>
          {['TikTok', 'Instagram Reels', 'YouTube Shorts', 'WhatsApp', 'Facebook', 'Marketplace', 'Landing Page'].map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>

      {/* Tabela */}
      {loading ? (
        <div className="card-stat animate-pulse h-64" />
      ) : conteudos.length === 0 ? (
        <div className="card-stat flex flex-col items-center justify-center py-16 text-center">
          <Library className="w-10 h-10 text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground mb-1">Nenhum conteúdo ainda.</p>
          <p className="text-xs text-muted-foreground mb-4">O Patrono gera os conteúdos sozinho a partir dos produtos escolhidos.</p>
          <Button asChild variant="ghost" size="sm">
            <Link href="/conteudos/gerar"><Zap className="w-4 h-4" />Gerar manualmente (modo avançado)</Link>
          </Button>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/30">
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Produto</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Rede</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Estilo</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Status</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Views</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Data</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Ações</th>
                </tr>
              </thead>
              <tbody>
                {conteudos.map((c) => (
                  <tr key={c.id} className="border-b border-border last:border-0 hover:bg-secondary/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {c.produto.imagens[0] ? (
                          <img src={c.produto.imagens[0]} alt="" className="w-7 h-7 rounded object-cover" />
                        ) : (
                          <div className="w-7 h-7 rounded bg-secondary" />
                        )}
                        <span className="font-medium text-white">{c.produto.nome}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{c.redeSocial}</td>
                    <td className="px-4 py-3 text-muted-foreground">{c.estilo}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={(c.atrasado ? 'publicacao_atrasada' : c.status) as StatusConteudo} />
                      {c.atrasado && (
                        <span className="mt-1 block max-w-[220px] text-[10px] text-amber-400">
                          {c.erroPublicacao ?? 'A data passou e nada foi publicado. Reagende quando estiver pronto.'}
                        </span>
                      )}
                      {c.rastreamento?.aviso && (
                        <span
                          title={`${c.rastreamento.aviso.titulo}. ${c.rastreamento.aviso.detalhe}`}
                          className="mt-1 flex items-center gap-1 text-[10px] text-amber-400"
                        >
                          <LinkIcon className="w-3 h-3 shrink-0" />
                          Sem rastreamento de cliques
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{c.visualizacoes.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{formatDateShort(c.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {(c.status === 'aprovado' || c.status === 'agendado' || c.status === 'publicacao_atrasada') && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => abrirAgendamento(c)}>
                              <CalendarClock className="w-3.5 h-3.5" />
                              {c.status === 'agendado' ? 'Reagendar' : 'Agendar'}
                            </Button>
                            <Button size="sm" onClick={() => setPublicarId(c.id)}>
                              <Send className="w-3.5 h-3.5" />Postar
                            </Button>
                          </>
                        )}
                        <Button asChild size="sm" variant="ghost">
                          <Link href={`/conteudos/${c.id}`}><Eye className="w-3.5 h-3.5" /></Link>
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => deletar(c.id)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal de agendamento */}
      {agendarId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => !salvandoAgenda && setAgendarId(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-border bg-card p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-white flex items-center gap-2">
                <CalendarClock className="w-4 h-4 text-accent" />Agendar publicação
              </h3>
              <button
                onClick={() => !salvandoAgenda && setAgendarId(null)}
                className="text-muted-foreground hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Data e hora</label>
              <input
                type="datetime-local"
                value={agendarData}
                onChange={(e) => setAgendarData(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm
                  text-white focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Na data marcada, se houver vídeo e o Instagram estiver conectado, o Reels é
              publicado de verdade. Sem isso nada sai: o conteúdo fica como “Publicação atrasada”
              e a Central avisa você.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAgendarId(null)} disabled={salvandoAgenda}>
                Cancelar
              </Button>
              <Button onClick={confirmarAgendamento} disabled={salvandoAgenda}>
                {salvandoAgenda ? 'Salvando...' : 'Confirmar agendamento'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de postagem */}
      {conteudoPublicar && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => !uploadingVideo && !publicandoIg && setPublicarId(null)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-border bg-card p-5 space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-white flex items-center gap-2">
                <Send className="w-4 h-4 text-accent" />Postar — {conteudoPublicar.produto.nome}
              </h3>
              <button
                onClick={() => !uploadingVideo && !publicandoIg && setPublicarId(null)}
                className="text-muted-foreground hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Vídeo */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Vídeo do Reels
              </p>
              {conteudoPublicar.videoUrl ? (
                <>
                  <div className="rounded-lg border border-accent/30 bg-accent/10 p-3 flex items-center justify-between gap-2">
                    <span className="text-sm text-accent flex items-center gap-1.5">
                      <CheckCircle className="w-4 h-4" />Vídeo pronto
                    </span>
                    <a
                      href={conteudoPublicar.videoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-accent hover:underline flex items-center gap-1"
                    >
                      <ExternalLink className="w-3 h-3" />Ver
                    </a>
                  </div>
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={adicionandoLegenda || publicandoIg || uploadingVideo}
                    onClick={adicionarLegenda}
                  >
                    {adicionandoLegenda
                      ? <><Loader2 className="w-4 h-4 animate-spin" />Adicionando legendas... (~40s)</>
                      : <><Sparkles className="w-4 h-4" />Adicionar legendas estilo CapCut</>}
                  </Button>
                </>
              ) : gerandoVideoIA ? (
                <div className="rounded-lg border border-accent/30 bg-accent/10 p-3 flex items-start gap-2 text-sm text-accent">
                  <Loader2 className="w-4 h-4 animate-spin mt-0.5 shrink-0" />
                  <span>
                    A IA está gerando o vídeo… leva de 1 a 3 minutos. Pode deixar
                    esta janela aberta — quando ficar pronto aparece aqui.
                  </span>
                </div>
              ) : (
                <>
                  <p className="text-[11px] text-muted-foreground">
                    Gere com IA a partir da imagem do produto, ou envie um vídeo pronto.
                  </p>
                  {/* Seletor de motor de vídeo */}
                  <div className="flex gap-2">
                    {([
                      { id: 'kling' as const, nome: 'Kling v3', desc: 'Anima a foto · mais em conta' },
                      { id: 'veo' as const, nome: 'Google Veo 3', desc: '~8s, com áudio · caro' },
                      { id: 'luma' as const, nome: 'Luma Ray 2', desc: '5 ou 9s' },
                    ]).map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          setMotorVideo(m.id)
                          // Normaliza a duração pro que cada motor aceita.
                          if (m.id === 'luma') setDuracaoVideoIA((d) => (d <= 5 ? 5 : 9))
                          else if (m.id === 'kling') setDuracaoVideoIA((d) => ([5, 10, 15, 30].includes(d) ? d : 5))
                        }}
                        disabled={uploadingVideo}
                        className={`flex-1 rounded-lg border p-2 text-left transition-colors ${
                          motorVideo === m.id
                            ? 'border-accent bg-accent/10'
                            : 'border-border hover:border-accent/40'
                        }`}
                      >
                        <p className={`text-xs font-semibold ${motorVideo === m.id ? 'text-accent' : 'text-white'}`}>{m.nome}</p>
                        <p className="text-[10px] text-muted-foreground">{m.desc}</p>
                      </button>
                    ))}
                  </div>
                  {/* Duração: Kling e Luma permitem escolher; Veo é fixo em ~8s. */}
                  {motorVideo === 'kling' && (
                    <div>
                      <label className="text-[11px] text-muted-foreground block mb-1">Duração</label>
                      <div className="flex gap-1.5">
                        {[5, 10, 15, 30].map((d) => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => setDuracaoVideoIA(d)}
                            disabled={uploadingVideo}
                            className={`flex-1 rounded-lg border py-1.5 text-xs font-semibold transition-colors ${
                              duracaoVideoIA === d
                                ? 'border-accent bg-accent/10 text-accent'
                                : 'border-border text-muted-foreground hover:border-accent/40'
                            }`}
                          >
                            {d}s
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {motorVideo === 'luma' && (
                    <div>
                      <label className="text-[11px] text-muted-foreground block mb-1">Duração</label>
                      <div className="flex gap-1.5">
                        {[5, 9].map((d) => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => setDuracaoVideoIA(d)}
                            disabled={uploadingVideo}
                            className={`flex-1 rounded-lg border py-1.5 text-xs font-semibold transition-colors ${
                              duracaoVideoIA === d
                                ? 'border-accent bg-accent/10 text-accent'
                                : 'border-border text-muted-foreground hover:border-accent/40'
                            }`}
                          >
                            {d}s
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {motorVideo === 'veo' && (
                    <p className="text-[11px] text-muted-foreground">
                      Duração fixa do Google Veo 3: ~8 segundos (com áudio).
                    </p>
                  )}
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={uploadingVideo}
                    onClick={gerarVideoIA}
                  >
                    <Sparkles className="w-4 h-4" />
                    Gerar vídeo com {motorVideo === 'veo' ? 'Google Veo 3' : motorVideo === 'luma' ? 'Luma Ray 2' : 'Kling v3'}
                    {motorVideo !== 'veo' ? ` (${duracaoVideoIA}s)` : ''}
                  </Button>
                </>
              )}
              {conteudoPublicar.videoErro && !gerandoVideoIA && (
                <div className="rounded-lg border border-danger/30 bg-danger/10 p-2.5 text-xs text-danger flex items-start gap-2">
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>Erro na geração: {conteudoPublicar.videoErro}</span>
                </div>
              )}
              <label className="block">
                <input
                  type="file"
                  accept="video/*"
                  disabled={uploadingVideo || gerandoVideoIA}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) enviarVideo(f)
                    e.target.value = ''
                  }}
                  className="hidden"
                />
                <span className={`flex items-center justify-center gap-2 rounded-lg border border-border
                  bg-background px-3 py-2.5 text-sm cursor-pointer hover:bg-secondary transition-colors
                  ${uploadingVideo || gerandoVideoIA ? 'opacity-60 pointer-events-none' : ''}`}>
                  {uploadingVideo
                    ? <><Loader2 className="w-4 h-4 animate-spin" />Enviando vídeo...</>
                    : <><Upload className="w-4 h-4" />{conteudoPublicar.videoUrl ? 'Trocar vídeo' : 'Ou enviar vídeo pronto'}</>}
                </span>
              </label>
            </div>

            {/* Como vai aparecer */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Como vai aparecer
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground">Mídia</p>
                  <div className="flex rounded-lg border border-border overflow-hidden">
                    <button
                      onClick={() => setTipoMidiaIg('video')}
                      disabled={!conteudoPublicar.videoUrl}
                      className={`flex-1 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed
                        ${tipoMidiaIg === 'video' ? 'bg-accent text-primary-dark' : 'text-muted-foreground hover:bg-secondary'}`}
                    >
                      Vídeo
                    </button>
                    <button
                      onClick={() => setTipoMidiaIg('imagens')}
                      disabled={(conteudoPublicar.produto.imagens?.length ?? 0) === 0}
                      className={`flex-1 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed
                        ${tipoMidiaIg === 'imagens' ? 'bg-accent text-primary-dark' : 'text-muted-foreground hover:bg-secondary'}`}
                    >
                      Imagens
                    </button>
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground">Onde publicar</p>
                  <div className="flex rounded-lg border border-border overflow-hidden">
                    <button
                      onClick={() => setDestinoIg('feed')}
                      className={`flex-1 py-1.5 text-xs font-medium transition-colors
                        ${destinoIg === 'feed' ? 'bg-accent text-primary-dark' : 'text-muted-foreground hover:bg-secondary'}`}
                    >
                      Feed
                    </button>
                    <button
                      onClick={() => setDestinoIg('stories')}
                      className={`flex-1 py-1.5 text-xs font-medium transition-colors
                        ${destinoIg === 'stories' ? 'bg-accent text-primary-dark' : 'text-muted-foreground hover:bg-secondary'}`}
                    >
                      Stories
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex justify-center pt-1">
                {tipoMidiaIg === 'video' ? (
                  <PhonePreview
                    videoUrl={conteudoPublicar.videoUrl}
                    label="Sem vídeo ainda"
                    badge={
                      <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-black/55 text-white">
                        {destinoIg === 'feed' ? 'Reels' : 'Stories'}
                      </span>
                    }
                  />
                ) : (
                  <CarouselPreview
                    slides={conteudoPublicar.produto.imagens ?? []}
                    badge={
                      <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-black/55 text-white">
                        {destinoIg === 'feed' ? 'Feed' : 'Stories'}
                      </span>
                    }
                  />
                )}
              </div>
            </div>

            {/* Legenda */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Legenda
              </p>
              <Button variant="outline" className="w-full" onClick={() => copiarTudo(conteudoPublicar)}>
                <Copy className="w-4 h-4" />Copiar tudo para postar
              </Button>
              <p className="text-[11px] text-muted-foreground">
                Copia legenda + hashtags + chamada + link de compra de uma vez.
              </p>
            </div>

            {/* Publicar no Instagram */}
            {(() => {
              const erro = conteudoPublicar.erroPublicacao ?? ''
              const erroLower = erro.toLowerCase()
              const erroOAuth = !!(erro && (
                erroLower.includes('oauth') ||
                erroLower.includes('access token') ||
                erroLower.includes('invalid token') ||
                erroLower.includes('token expired')
              ))
              const erroPermissao = !!(erro && (
                erroLower.includes('api access blocked') ||
                erroLower.includes('access blocked') ||
                erroLower.includes('(#200)') ||
                erroLower.includes('instagram_content_publish')
              ))
              return (
                <div className="space-y-2 pt-2 border-t border-border">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Publicar no Instagram
                  </p>

                  {(!igConectado || erroOAuth) ? (
                    <div className="space-y-2">
                      <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-danger mt-0.5 shrink-0" />
                        <div className="text-xs text-danger space-y-1">
                          <p className="font-semibold">Token do Instagram inválido ou expirado</p>
                          {erro && <p className="opacity-80">{erro}</p>}
                          <p>Reconecte sua conta para voltar a publicar.</p>
                        </div>
                      </div>
                      <Button className="w-full" variant="outline" asChild>
                        <Link href="/integracoes">
                          <Instagram className="w-4 h-4" />Reconectar Instagram
                        </Link>
                      </Button>
                    </div>
                  ) : erroPermissao ? (
                    <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 space-y-3">
                      {/* Cabeçalho */}
                      <div className="flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-warning mt-0.5 shrink-0" />
                        <div>
                          <p className="text-xs font-bold text-warning">Permissão bloqueada — API access blocked</p>
                          <p className="text-[11px] text-warning/70 mt-0.5">
                            O app Meta não possui <code className="bg-warning/20 px-1 rounded">instagram_content_publish</code>. Siga os 4 passos abaixo.
                          </p>
                        </div>
                      </div>

                      {/* Passo a passo */}
                      <div className="space-y-2">
                        <div className="rounded-lg border border-border bg-card p-2.5 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="w-5 h-5 rounded-full bg-accent text-primary text-[10px] font-bold flex items-center justify-center shrink-0">1</span>
                            <p className="text-xs font-semibold text-white">Converter conta para Business ou Creator</p>
                          </div>
                          <div className="pl-7 text-[11px] text-muted-foreground space-y-0.5">
                            <p>• No Instagram (celular): <strong className="text-white">Configurações → Conta → Mudar tipo de conta</strong></p>
                            <p>• Escolha <strong className="text-white">Conta Profissional → Creator</strong> ou <strong className="text-white">Empresa</strong></p>
                            <p className="text-warning/80">⚠ Contas pessoais não podem usar a API de publicação</p>
                          </div>
                        </div>

                        <div className="rounded-lg border border-border bg-card p-2.5 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="w-5 h-5 rounded-full bg-accent text-primary text-[10px] font-bold flex items-center justify-center shrink-0">2</span>
                            <p className="text-xs font-semibold text-white">Adicionar permissão no Meta for Developers</p>
                          </div>
                          <div className="pl-7 text-[11px] text-muted-foreground space-y-0.5">
                            <p>• Acesse <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener noreferrer" className="text-accent underline">developers.facebook.com/apps</a> → seu app</p>
                            <p>• Vá em <strong className="text-white">Casos de uso do app → Gerenciar</strong></p>
                            <p>• Adicione a permissão <code className="bg-border px-1 rounded text-accent">instagram_content_publish</code> e salve</p>
                          </div>
                        </div>

                        <div className="rounded-lg border border-border bg-card p-2.5 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="w-5 h-5 rounded-full bg-accent text-primary text-[10px] font-bold flex items-center justify-center shrink-0">3</span>
                            <p className="text-xs font-semibold text-white">Adicionar sua conta como Tester (modo dev)</p>
                          </div>
                          <div className="pl-7 text-[11px] text-muted-foreground space-y-0.5">
                            <p>• No app: <strong className="text-white">Funções → Roles → Testers → Adicionar Testers</strong></p>
                            <p>• Insira seu <strong className="text-white">@ do Instagram</strong> e envie o convite</p>
                            <p>• No Instagram: <strong className="text-white">Config. → Negócios → Solicitações → Aceitar</strong></p>
                          </div>
                        </div>

                        <div className="rounded-lg border border-border bg-card p-2.5 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="w-5 h-5 rounded-full bg-accent text-primary text-[10px] font-bold flex items-center justify-center shrink-0">4</span>
                            <p className="text-xs font-semibold text-white">Gerar novo token com as permissões corretas</p>
                          </div>
                          <div className="pl-7 text-[11px] text-muted-foreground space-y-0.5">
                            <p>• Acesse <a href="https://developers.facebook.com/tools/explorer" target="_blank" rel="noopener noreferrer" className="text-accent underline">Graph API Explorer</a> → selecione seu app</p>
                            <p>• Marque: <code className="bg-border px-1 rounded">instagram_basic</code> + <code className="bg-border px-1 rounded text-accent">instagram_content_publish</code></p>
                            <p>• Clique em <strong className="text-white">Gerar Token</strong>, copie e reconfigure em <a href="/integracoes" className="text-accent underline">Integrações</a></p>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2 pt-1">
                        <Button size="sm" variant="outline" className="w-full" asChild>
                          <a href="/integracoes">
                            <Instagram className="w-3.5 h-3.5" /> Ir para Integrações e reconectar
                          </a>
                        </Button>
                        <Button size="sm" className="w-full" disabled={publicandoIg} onClick={publicarInstagram}>
                          {publicandoIg
                            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Tentando...</>
                            : <><Instagram className="w-3.5 h-3.5" />Já corrigi — Tentar de novo</>}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {erro && (
                        <div className="rounded-lg border border-danger/30 bg-danger/10 p-2.5 text-xs text-danger flex items-start gap-2">
                          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                          <span>Último erro: {erro}</span>
                        </div>
                      )}
                      {(() => {
                        const semMidia = tipoMidiaIg === 'video'
                          ? !conteudoPublicar.videoUrl
                          : (conteudoPublicar.produto.imagens?.length ?? 0) === 0
                        return (
                          <>
                            <Button
                              className="w-full"
                              disabled={semMidia || publicandoIg || uploadingVideo}
                              onClick={publicarInstagram}
                            >
                              {publicandoIg
                                ? <><Loader2 className="w-4 h-4 animate-spin" />Publicando...</>
                                : <><Instagram className="w-4 h-4" />Publicar no Instagram agora</>}
                            </Button>
                            {semMidia && (
                              <p className="text-[11px] text-muted-foreground">
                                {tipoMidiaIg === 'video'
                                  ? 'Envie o vídeo acima para habilitar a publicação.'
                                  : 'Este produto não tem imagens cadastradas.'}
                              </p>
                            )}
                          </>
                        )
                      })()}
                      {publicandoIg && (
                        <p className="text-[11px] text-muted-foreground">
                          O Instagram pode levar até ~1 minuto processando o vídeo. Não feche esta janela.
                        </p>
                      )}
                    </>
                  )}
                </div>
              )
            })()}
          </div>
        </div>
      )}
    </div>
  )
}
