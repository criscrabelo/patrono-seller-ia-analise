'use client'

import { useState } from 'react'
import {
  Copy, Check, Star, AlertTriangle, AlertCircle, CheckCircle, ChevronRight,
  ShoppingBag, Pencil, Save, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn, copyToClipboard } from '@/lib/utils'
import { LINK_COMPRA, NOME_LOJA } from '@/lib/config'
import { toast } from '@/hooks/use-toast'
import type { AlertaCompliance } from '@/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface ConteudoPreviewProps {
  conteudo: Record<string, any>
  onEnviarAprovacao?: () => void
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  async function handle() {
    await copyToClipboard(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button onClick={handle} className="copy-btn">
      {copied ? <Check className="w-3.5 h-3.5 text-accent" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? 'Copiado!' : 'Copiar'}
    </button>
  )
}

/** Bloco de texto que vira textarea no modo de edição. */
function BlocoTexto({
  titulo, valor, editando, onChange, mono, linhas = 4,
}: {
  titulo: string
  valor: string
  editando: boolean
  onChange: (v: string) => void
  mono?: boolean
  linhas?: number
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-white text-sm">{titulo}</h3>
        {!editando && <CopyButton text={valor} />}
      </div>
      {editando ? (
        <textarea
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          rows={linhas}
          className={cn(
            'w-full rounded-lg bg-background border border-accent/40 p-3 text-sm text-foreground',
            'focus:outline-none focus:ring-1 focus:ring-accent resize-y',
            mono && 'font-mono'
          )}
        />
      ) : (
        <div className={cn(
          'rounded-lg bg-background border border-border p-4 text-sm text-foreground whitespace-pre-wrap',
          mono && 'font-mono'
        )}>
          {valor}
        </div>
      )}
    </div>
  )
}

function AlertaBadge({ alerta }: { alerta: AlertaCompliance }) {
  const colors = {
    verde: 'border-accent/30 bg-accent/10 text-accent',
    amarelo: 'border-warning/30 bg-warning/10 text-warning',
    vermelho: 'border-danger/30 bg-danger/10 text-danger',
  }
  const Icon = alerta.severidade === 'verde' ? CheckCircle
    : alerta.severidade === 'amarelo' ? AlertTriangle : AlertCircle

  return (
    <div className={cn('rounded-lg border p-3 flex gap-2.5', colors[alerta.severidade])}>
      <Icon className="w-4 h-4 mt-0.5 shrink-0" />
      <div>
        <p className="text-sm font-medium">{alerta.mensagem}</p>
        <p className="text-xs opacity-75 mt-0.5">{alerta.acaoRecomendada}</p>
      </div>
    </div>
  )
}

const TABS = ['Roteiro', 'Legendas', 'Extras', 'Prompt de Vídeo']

export function ConteudoPreview({ conteudo, onEnviarAprovacao }: ConteudoPreviewProps) {
  const [tab, setTab] = useState(0)
  const alertas = (conteudo.alertasCompliance as AlertaCompliance[]) ?? []
  const temAlertaVermelho = alertas.some((a) => a.severidade === 'vermelho')
  const [confirmedRisk, setConfirmedRisk] = useState(false)

  // ── Modo de edição ──────────────────────────────────────────────
  const [editando, setEditando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [edits, setEdits] = useState<Record<string, string>>({})

  // Valor atual de um campo de texto (editado tem prioridade sobre o original)
  const val = (campo: string): string => edits[campo] ?? String(conteudo[campo] ?? '')
  const setVal = (campo: string, v: string) => setEdits((e) => ({ ...e, [campo]: v }))

  // Hashtags como string editável (separadas por espaço)
  const hashtagsStr = (): string =>
    edits.hashtags ?? ((conteudo.hashtags as string[]) ?? []).join(' ')
  const hashtagsArr = (): string[] =>
    edits.hashtags !== undefined
      ? edits.hashtags.split(/[\s,]+/).map((h) => h.trim()).filter(Boolean)
      : ((conteudo.hashtags as string[]) ?? [])

  async function salvarEdicoes() {
    if (!conteudo.id) {
      toast({ title: 'Salve o conteúdo antes de editar', variant: 'destructive' })
      return
    }
    setSalvando(true)
    const body: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(edits)) {
      body[k] = k === 'hashtags'
        ? v.split(/[\s,]+/).map((h) => h.trim()).filter(Boolean)
        : v
    }
    const res = await fetch(`/api/conteudos/${conteudo.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setSalvando(false)
    if (!res.ok) {
      toast({ title: 'Erro ao salvar alterações', description: 'Tente novamente.', variant: 'destructive' })
      return
    }
    toast({ title: 'Alterações salvas!', variant: 'success' })
    setEditando(false)
  }

  function cancelarEdicao() {
    setEdits({})
    setEditando(false)
  }

  const legendas: { campo: string; label: string }[] = [
    { campo: 'legendaTiktok', label: 'TikTok' },
    { campo: 'legendaInstagram', label: 'Instagram' },
    { campo: 'legendaYoutube', label: 'YouTube Shorts' },
    { campo: 'legendaWhatsapp', label: 'WhatsApp' },
    { campo: 'legendaFacebook', label: 'Facebook' },
    { campo: 'legendaMarketplace', label: 'Marketplace' },
  ]

  return (
    <div className="space-y-4">
      {/* Alertas */}
      {alertas.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Alertas de Compliance
          </h3>
          {alertas.map((a, i) => <AlertaBadge key={i} alerta={a} />)}
          {temAlertaVermelho && !confirmedRisk && (
            <button onClick={() => setConfirmedRisk(true)}
              className="w-full text-xs text-danger border border-danger/30 rounded-lg py-2 hover:bg-danger/10 transition-colors">
              ⚠️ Entendi o risco — continuar mesmo assim
            </button>
          )}
        </div>
      )}

      {/* Tabs + botão Editar */}
      <div className="card-stat space-y-5">
        <div className="flex items-center justify-between border-b border-border -mx-5 px-5">
          <div className="flex">
            {TABS.map((t, i) => (
              <button key={t} onClick={() => setTab(i)}
                className={cn(
                  'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                  tab === i
                    ? 'border-accent text-accent'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                )}>
                {t}
              </button>
            ))}
          </div>
          {editando ? (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={cancelarEdicao} disabled={salvando}>
                <X className="w-3.5 h-3.5" />Cancelar
              </Button>
              <Button size="sm" onClick={salvarEdicoes} disabled={salvando}>
                <Save className="w-3.5 h-3.5" />{salvando ? 'Salvando...' : 'Salvar'}
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setEditando(true)}>
              <Pencil className="w-3.5 h-3.5" />Editar
            </Button>
          )}
        </div>

        {/* ABA ROTEIRO */}
        {tab === 0 && (
          <div className="space-y-4">
            <BlocoTexto titulo="Roteiro" valor={val('roteiro')} editando={editando}
              onChange={(v) => setVal('roteiro', v)} linhas={6} />
            <BlocoTexto titulo="Texto para Tela" valor={val('textoTela')} editando={editando}
              onChange={(v) => setVal('textoTela', v)} linhas={3} />
          </div>
        )}

        {/* ABA LEGENDAS */}
        {tab === 1 && (
          <div className="space-y-4">
            {legendas.map(({ campo, label }) => (
              (editando || conteudo[campo]) && (
                <BlocoTexto key={campo} titulo={label} valor={val(campo)} editando={editando}
                  onChange={(v) => setVal(campo, v)} linhas={4} />
              )
            ))}
          </div>
        )}

        {/* ABA EXTRAS */}
        {tab === 2 && (
          <div className="space-y-5">
            {/* Hashtags */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-white text-sm">Hashtags</h3>
                {!editando && <CopyButton text={hashtagsArr().join(' ')} />}
              </div>
              {editando ? (
                <textarea
                  value={hashtagsStr()}
                  onChange={(e) => setVal('hashtags', e.target.value)}
                  rows={2}
                  placeholder="Separe as hashtags por espaço"
                  className="w-full rounded-lg bg-background border border-accent/40 p-3 text-sm text-foreground
                    focus:outline-none focus:ring-1 focus:ring-accent resize-y"
                />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {hashtagsArr().map((h) => (
                    <span key={h} className="px-2 py-1 rounded-full bg-secondary text-xs text-accent">{h}</span>
                  ))}
                </div>
              )}
            </div>

            {/* CTA */}
            <BlocoTexto titulo="Chamada para Ação" valor={val('chamadaAcao')} editando={editando}
              onChange={(v) => setVal('chamadaAcao', v)} linhas={2} />

            {/* Link de Compra */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-white text-sm">Link de Compra</h3>
                <CopyButton text={LINK_COMPRA} />
              </div>
              <div className="rounded-lg border border-accent/30 bg-accent/10 p-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white">🛒 {NOME_LOJA}</p>
                  <p className="text-xs text-muted-foreground truncate">{LINK_COMPRA}</p>
                </div>
                <Button asChild size="sm" className="shrink-0">
                  <a href={LINK_COMPRA} target="_blank" rel="noopener noreferrer">
                    <ShoppingBag className="w-3.5 h-3.5" />Comprar
                  </a>
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5">
                O link de afiliado vai na legenda a partir do campo &quot;Link de compra&quot; do produto.
              </p>
            </div>

            {/* Narração */}
            {(editando || conteudo.narracao) && (
              <BlocoTexto titulo="Narração" valor={val('narracao')} editando={editando}
                onChange={(v) => setVal('narracao', v)} linhas={4} />
            )}

            {/* Avaliação (somente leitura) */}
            <div className="rounded-xl border border-border bg-background p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-white text-sm">Avaliação do Produto</h3>
                {typeof conteudo.notaProduto === 'number' && conteudo.notaProduto > 0 ? (
                  <div className="flex items-center gap-1">
                    <Star className="w-4 h-4 text-warning fill-warning" />
                    <span className="text-warning font-bold">{conteudo.notaProduto}/10</span>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">sem nota (sem evidência)</span>
                )}
              </div>
              <div className="space-y-2 text-xs">
                <div>
                  <p className="text-accent font-medium mb-1">✅ Pontos Positivos</p>
                  {((conteudo.pontosPositivos as string[]) ?? []).map((p, i) => (
                    <p key={i} className="text-muted-foreground">• {p}</p>
                  ))}
                </div>
                <div>
                  <p className="text-danger font-medium mb-1">❌ Pontos Negativos</p>
                  {((conteudo.pontosNegativos as string[]) ?? []).map((p, i) => (
                    <p key={i} className="text-muted-foreground">• {p}</p>
                  ))}
                </div>
                <div className="border-t border-border pt-2">
                  <p className="text-white font-medium">🏆 Veredito: <span className="text-accent">{conteudo.veredito as string}</span></p>
                </div>
              </div>
            </div>

            {/* Trilha */}
            {conteudo.trilhaSugerida && (
              <p className="text-sm text-muted-foreground">
                🎵 Trilha sugerida: <span className="text-white">{conteudo.trilhaSugerida as string}</span>
              </p>
            )}
          </div>
        )}

        {/* ABA PROMPT DE VÍDEO */}
        {tab === 3 && (
          <div className="space-y-4">
            <BlocoTexto titulo="Prompt Completo" valor={val('promptVideoIA')} editando={editando}
              onChange={(v) => setVal('promptVideoIA', v)} mono linhas={5} />
            <BlocoTexto titulo="Prompt Curto" valor={val('promptCurto')} editando={editando}
              onChange={(v) => setVal('promptCurto', v)} mono linhas={2} />
            <p className="text-xs text-muted-foreground">
              ✅ Compatível com: Runway, Kling, Pika, Veo
            </p>
          </div>
        )}
      </div>

      {/* Ações */}
      <div className="space-y-3">
        {editando && (
          <p className="text-[11px] text-warning text-center">
            Você está editando — clique em &quot;Salvar&quot; antes de enviar para aprovação.
          </p>
        )}
        {temAlertaVermelho && !confirmedRisk && (
          <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-danger">
              ⚠️ Há um alerta de compliance grave. Confirme que entendeu o risco para liberar o envio.
            </p>
            <Button
              variant="destructive"
              size="sm"
              className="shrink-0"
              onClick={() => setConfirmedRisk(true)}
            >
              Entendi o risco — liberar envio
            </Button>
          </div>
        )}
        <div className="flex justify-end gap-3">
          <Button
            onClick={onEnviarAprovacao}
            disabled={(temAlertaVermelho && !confirmedRisk) || editando}
          >
            Enviar para Aprovação <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
