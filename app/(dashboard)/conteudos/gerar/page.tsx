'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Zap, Loader2, CheckSquare, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConteudoPreview } from '@/components/conteudos/ConteudoPreview'
import { REDES_SOCIAIS, DURACOES, ESTILOS, OBJETIVOS } from '@/types'
import { toast } from '@/hooks/use-toast'
import { useGuardModulo } from '@/hooks/useGuardModulo'
import { AvisoDeContingencia } from '@/components/shared/Ux'

interface Produto {
  id: string
  nome: string
  categoria: string
}

const REDE_ICONS: Record<string, string> = {
  'TikTok': '🎵',
  'Instagram Reels': '📸',
  'YouTube Shorts': '▶️',
  'WhatsApp': '💬',
  'Facebook': '👍',
  'Marketplace': '🛒',
  'Landing Page': '🌐',
}

function GerarConteudoInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [conteudos, setConteudos] = useState<Array<Record<string, unknown>>>([])
  const [gerando, setGerando] = useState(false)
  const [progresso, setProgresso] = useState({ atual: 0, total: 0 })
  const [config, setConfig] = useState({
    produtoId: searchParams.get('produtoId') ?? '',
    redesSociais: ['TikTok'] as string[],
    duracao: 30,
    estilo: 'Orientado à retenção',
    objetivo: 'Venda',
  })

  useEffect(() => {
    fetch('/api/produtos').then((r) => r.json()).then((data) => {
      if (Array.isArray(data)) setProdutos(data)
    })
  }, [])

  function toggleRede(rede: string) {
    setConfig((c) => ({
      ...c,
      redesSociais: c.redesSociais.includes(rede)
        ? c.redesSociais.filter((r) => r !== rede)
        : [...c.redesSociais, rede],
    }))
  }

  function toggleTodas() {
    setConfig((c) => ({
      ...c,
      redesSociais: c.redesSociais.length === REDES_SOCIAIS.length ? [] : [...REDES_SOCIAIS],
    }))
  }

  async function gerar() {
    if (!config.produtoId) {
      toast({ title: 'Selecione um produto', variant: 'destructive' })
      return
    }
    if (config.redesSociais.length === 0) {
      toast({ title: 'Selecione ao menos uma rede social', variant: 'destructive' })
      return
    }

    setGerando(true)
    setConteudos([])
    setProgresso({ atual: 0, total: config.redesSociais.length })

    const resultados: Array<Record<string, unknown>> = []
    let erros = 0

    // Gera em paralelo para todas as redes selecionadas
    await Promise.all(
      config.redesSociais.map(async (redeSocial) => {
        try {
          const res = await fetch('/api/conteudos/gerar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              produtoId: config.produtoId,
              redeSocial,
              duracao: config.duracao,
              estilo: config.estilo,
              objetivo: config.objetivo,
            }),
          })

          if (!res.ok) {
            let descricao = `${redeSocial}: falha ao gerar`
            try {
              const err = await res.json()
              if (err?.error) descricao = `${redeSocial}: ${err.error}`
            } catch { /* ignora */ }
            toast({ title: 'Erro parcial', description: descricao, variant: 'destructive' })
            erros++
          } else {
            const data = await res.json()
            resultados.push({ ...data, _redeSocial: redeSocial })
          }
        } catch {
          toast({ title: 'Erro de conexão', description: `Falha ao gerar para ${redeSocial}`, variant: 'destructive' })
          erros++
        } finally {
          setProgresso((p) => ({ ...p, atual: p.atual + 1 }))
        }
      })
    )

    // Ordena pelos resultados na ordem original das redes selecionadas
    resultados.sort((a, b) => {
      const ia = config.redesSociais.indexOf(a._redeSocial as string)
      const ib = config.redesSociais.indexOf(b._redeSocial as string)
      return ia - ib
    })

    setConteudos(resultados)
    setGerando(false)

    if (resultados.length > 0) {
      toast({
        title: erros === 0
          ? `${resultados.length} conteúdo(s) gerado(s) com sucesso!`
          : `${resultados.length} gerado(s), ${erros} com erro`,
        variant: erros === 0 ? 'success' : 'destructive',
      })
    }
  }

  const selectClass = `w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm
    text-white focus:outline-none focus:ring-1 focus:ring-accent`

  const todasSelecionadas = config.redesSociais.length === REDES_SOCIAIS.length
  const algumaSelecionada = config.redesSociais.length > 0 && !todasSelecionadas

  return (
    <div className="space-y-6 max-w-5xl">
      {/* P2.17.13: o fluxo principal é o do Patrono (seleciona → gera → valida → apresenta). */}
      <AvisoDeContingencia titulo="Modo manual / avançado">O Patrono já escolhe, gera, checa e te apresenta o conteúdo sozinho. Use esta tela só para testes, exceções ou um pedido específico seu.</AvisoDeContingencia>
      {/* Formulário */}
      <div className="card-stat space-y-5">
        <h2 className="font-semibold text-white">Configurar Geração</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">

          {/* Produto — linha inteira */}
          <div className="sm:col-span-2 lg:col-span-3">
            <label className="text-xs text-muted-foreground mb-1.5 block">Produto *</label>
            <select className={selectClass} value={config.produtoId}
              onChange={(e) => setConfig((c) => ({ ...c, produtoId: e.target.value }))}>
              <option value="">Selecionar produto...</option>
              {produtos.map((p) => <option key={p.id} value={p.id}>{p.nome} — {p.categoria}</option>)}
            </select>
          </div>

          {/* Redes sociais — multi-select com checkboxes */}
          <div className="sm:col-span-2 lg:col-span-3">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-muted-foreground">
                Redes Sociais
                {config.redesSociais.length > 0 && (
                  <span className="ml-2 text-accent font-medium">
                    ({config.redesSociais.length} selecionada{config.redesSociais.length > 1 ? 's' : ''})
                  </span>
                )}
              </label>
              <button
                type="button"
                onClick={toggleTodas}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-accent transition-colors"
              >
                {todasSelecionadas ? (
                  <CheckSquare className="w-3.5 h-3.5 text-accent" />
                ) : algumaSelecionada ? (
                  <CheckSquare className="w-3.5 h-3.5 text-accent/60" />
                ) : (
                  <Square className="w-3.5 h-3.5" />
                )}
                {todasSelecionadas ? 'Desmarcar todas' : 'Selecionar todas'}
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {REDES_SOCIAIS.map((rede) => {
                const selecionada = config.redesSociais.includes(rede)
                return (
                  <button
                    key={rede}
                    type="button"
                    onClick={() => toggleRede(rede)}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                      selecionada
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-border text-muted-foreground hover:border-accent/40 hover:text-white'
                    }`}
                  >
                    <span className="text-base leading-none">{REDE_ICONS[rede] ?? '📱'}</span>
                    <span className="truncate text-xs">{rede}</span>
                    {selecionada && <CheckSquare className="w-3.5 h-3.5 ml-auto shrink-0" />}
                    {!selecionada && <Square className="w-3.5 h-3.5 ml-auto shrink-0 opacity-30" />}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Duração */}
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Duração (segundos)</label>
            <select className={selectClass} value={config.duracao}
              onChange={(e) => setConfig((c) => ({ ...c, duracao: Number(e.target.value) }))}>
              {DURACOES.map((d) => <option key={d} value={d}>{d}s</option>)}
            </select>
          </div>

          {/* Estilo */}
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Estilo</label>
            <select className={selectClass} value={config.estilo}
              onChange={(e) => setConfig((c) => ({ ...c, estilo: e.target.value }))}>
              {ESTILOS.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>

          {/* Objetivo */}
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Objetivo</label>
            <select className={selectClass} value={config.objetivo}
              onChange={(e) => setConfig((c) => ({ ...c, objetivo: e.target.value }))}>
              {OBJETIVOS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between pt-1">
          {config.redesSociais.length > 1 && !gerando && (
            <p className="text-xs text-muted-foreground">
              Serão gerados <span className="text-accent font-semibold">{config.redesSociais.length} conteúdos</span> em paralelo
            </p>
          )}
          <div className="ml-auto">
            <Button onClick={gerar} disabled={gerando || !config.produtoId || config.redesSociais.length === 0} size="lg">
              {gerando
                ? <><Loader2 className="w-4 h-4 animate-spin" />Gerando {progresso.atual}/{progresso.total}...</>
                : <><Zap className="w-4 h-4" />{config.redesSociais.length > 1 ? `Gerar ${config.redesSociais.length} Conteúdos` : 'Gerar Conteúdo'}</>}
            </Button>
          </div>
        </div>
      </div>

      {/* Loading */}
      {gerando && (
        <div className="card-stat flex flex-col items-center justify-center py-12 text-center gap-4">
          <div className="w-14 h-14 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center">
            <Loader2 className="w-7 h-7 text-accent animate-spin" />
          </div>
          <div>
            <p className="text-white font-semibold">
              Gerando conteúdo para {config.redesSociais.length} rede{config.redesSociais.length > 1 ? 's' : ''} em paralelo...
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {progresso.atual} de {progresso.total} concluído{progresso.atual !== 1 ? 's' : ''}
            </p>
            {/* Barra de progresso */}
            <div className="mt-3 w-64 h-1.5 bg-border rounded-full overflow-hidden mx-auto">
              <div
                className="h-full bg-accent rounded-full transition-all duration-500"
                style={{ width: progresso.total > 0 ? `${(progresso.atual / progresso.total) * 100}%` : '0%' }}
              />
            </div>
          </div>
          <div className="flex flex-wrap justify-center gap-2 mt-1">
            {config.redesSociais.map((rede) => (
              <span key={rede} className="text-xs px-2 py-1 rounded-full border border-border text-muted-foreground">
                {REDE_ICONS[rede]} {rede}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Previews — um por rede */}
      {conteudos.length > 0 && !gerando && (
        <div className="space-y-6">
          {conteudos.length > 1 && (
            <div className="flex items-center gap-2">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground px-3">
                {conteudos.length} conteúdos gerados
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>
          )}
          {conteudos.map((conteudo, idx) => (
            <div key={conteudo.id as string ?? idx}>
              {conteudos.length > 1 && (
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-lg">{REDE_ICONS[conteudo._redeSocial as string] ?? '📱'}</span>
                  <span className="text-sm font-semibold text-white">{conteudo._redeSocial as string}</span>
                  <span className="text-xs text-muted-foreground">— {conteudo.redeSocial as string}</span>
                </div>
              )}
              <ConteudoPreview
                conteudo={conteudo}
                onEnviarAprovacao={async () => {
                  if (!conteudo.id) {
                    toast({ title: 'Erro: conteúdo sem identificador', description: 'Gere o conteúdo novamente.', variant: 'destructive' })
                    return
                  }
                  const res = await fetch(`/api/conteudos/${conteudo.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: 'aguardando_aprovacao' }),
                  })
                  if (!res.ok) {
                    toast({ title: 'Erro ao enviar para aprovação', variant: 'destructive' })
                    return
                  }
                  toast({ title: 'Enviado para aprovação!', variant: 'success' })
                  if (conteudos.length === 1) router.push('/aprovacao')
                }}
              />
            </div>
          ))}
          {conteudos.length > 1 && (
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => router.push('/aprovacao')}>
                Ver todas as aprovações →
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function GerarConteudoPage() {
  useGuardModulo('conteudos-gerar')
  return (
    <Suspense fallback={<div className="card-stat animate-pulse h-48" />}>
      <GerarConteudoInner />
    </Suspense>
  )
}
