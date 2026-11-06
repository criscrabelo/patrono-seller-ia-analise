'use client'

import { useEffect, useRef, useState } from 'react'
import {
  MessageCircle, Upload, Send, Loader2, CheckCircle2, XCircle,
  AlertCircle, Users, FileText, Image as ImageIcon, Trash2, RefreshCw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { useGuardModulo } from '@/hooks/useGuardModulo'
import { AvisoDeContingencia } from '@/components/shared/Ux'
import { respostaFinal } from '@/lib/aguardar-trabalho'
import { motivoParaNaoEnviar } from '@/lib/whatsapp-elegibilidade'

interface ConteudoOpcao {
  id: string
  status: string
  produto: { nome: string; imagens?: string[] }
  legendaWhatsapp: string | null
  redeSocial: string | null
  alertasCompliance?: unknown
  createdAt: string
}

interface ResultadoEnvio {
  numero: string
  ok: boolean
  erro?: string
}

type Aba = 'enviar' | 'contatos'

export default function WhatsAppPage() {
  useGuardModulo('whatsapp')
  const [aba, setAba] = useState<Aba>('enviar')
  const [status, setStatus] = useState<{ configurado: boolean; conectado?: boolean; numero?: string; envioPermitido?: boolean; motivoDoBloqueio?: string } | null>(null)
  const [carregando, setCarregando] = useState(true)

  // Contatos
  const [contatosTexto, setContatosTexto] = useState('')
  const [contatosSalvos, setContatosSalvos] = useState<string[]>([])

  // Conteúdo
  const [conteudos, setConteudos] = useState<ConteudoOpcao[]>([])
  const [conteudoSelecionado, setConteudoSelecionado] = useState<ConteudoOpcao | null>(null)
  const [mensagem, setMensagem] = useState('')
  const [usarImagem, setUsarImagem] = useState(false)

  // Envio
  const [enviando, setEnviando] = useState(false)
  const [resultados, setResultados] = useState<ResultadoEnvio[]>([])
  const [delay, setDelay] = useState(3)

  const csvRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    verificarStatus()
    carregarConteudos()
    const salvos = localStorage.getItem('wpp_contatos')
    try { if (salvos) setContatosSalvos(JSON.parse(salvos)) } catch { localStorage.removeItem('wpp_contatos') }
  }, [])

  async function verificarStatus() {
    setCarregando(true)
    try {
      const res = await fetch('/api/whatsapp/status')
      const data = await res.json()
      setStatus(data)
    } catch {
      setStatus({ configurado: false })
    }
    setCarregando(false)
  }

  async function carregarConteudos() {
    try {
      // P2.15.4: só conteúdo aprovado, feito para WhatsApp e sem alerta vermelho (o servidor confere de novo).
      const res = await fetch('/api/conteudos?redeSocial=WhatsApp')
      const data = await res.json()
      if (Array.isArray(data)) setConteudos(data.filter((c: ConteudoOpcao) => motivoParaNaoEnviar(c) === null))
    } catch { /* silencioso */ }
  }

  function parsearNumeros(texto: string): string[] {
    return texto
      .split(/[\n,;]+/)
      .map((n) => n.trim())
      .filter((n) => n.length >= 8)
  }

  function salvarContatos() {
    const numeros = parsearNumeros(contatosTexto)
    const novos = [...new Set([...contatosSalvos, ...numeros])]
    setContatosSalvos(novos)
    localStorage.setItem('wpp_contatos', JSON.stringify(novos))
    toast({ title: `${numeros.length} contato(s) salvos`, variant: 'success' })
    setContatosTexto('')
  }

  function removerContato(num: string) {
    const novos = contatosSalvos.filter((n) => n !== num)
    setContatosSalvos(novos)
    localStorage.setItem('wpp_contatos', JSON.stringify(novos))
  }

  function importarCSV(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const texto = ev.target?.result as string
      const linhas = texto.split('\n').map((l) => l.split(',')[0].trim())
      setContatosTexto((p) => (p ? p + '\n' : '') + linhas.join('\n'))
      toast({ title: `${linhas.length} números importados do CSV`, variant: 'success' })
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  function selecionarConteudo(c: ConteudoOpcao) {
    setConteudoSelecionado(c)
    setMensagem(c.legendaWhatsapp ?? '')
  }

  async function enviarMassa() {
    const numeros = contatosSalvos.length > 0 ? contatosSalvos : parsearNumeros(contatosTexto)
    if (numeros.length === 0) {
      toast({ title: 'Adicione ao menos um número', variant: 'destructive' })
      return
    }
    if (!conteudoSelecionado) {
      toast({ title: 'Escolha um conteúdo aprovado para WhatsApp', variant: 'destructive' })
      return
    }
    if (!confirm(`Enviar para ${numeros.length} contato(s)? Isso pode levar alguns minutos.`)) return

    setEnviando(true)
    setResultados([])

    try {
      const res = await fetch(`/api/whatsapp/enviar?conteudoId=${encodeURIComponent(conteudoSelecionado.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          numeros,
          comFotoDoProduto: usarImagem,
          delayMs: delay * 1000,
        }),
      })
      // P2.2: o envio roda como trabalho longo; a lista vai se preenchendo.
      const { ok, data } = await respostaFinal(res, {
        aoAtualizar: (parcial) => setResultados(parcial.resultados ?? []),
      })
      if (data.processando) {
        setResultados(data.resultados ?? [])
        toast({ title: 'Envio em andamento', description: data.mensagem ?? '' })
      } else if (!ok) {
        toast({ title: 'Erro no envio', description: data.error, variant: 'destructive' })
      } else {
        setResultados(data.resultados ?? [])
        const incertos = data.incertos > 0 ? `, ${data.incertos} sem confirmação (não reenviados)` : ''
        toast({
          title: `${data.enviados} enviado(s)${data.erros > 0 ? `, ${data.erros} com erro` : ''}${incertos}`,
          variant: data.erros === 0 && !data.incertos ? 'success' : 'destructive',
        })
      }
    } catch {
      toast({ title: 'Falha de conexão', variant: 'destructive' })
    }
    setEnviando(false)
  }

  if (carregando) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const numerosAtivos = contatosSalvos.length || parsearNumeros(contatosTexto).length

  return (
    <div className="space-y-6 max-w-5xl">
      <AvisoDeContingencia titulo="Ferramenta secundária, não prioritária">Sem solução oficial e segura (LGPD), o envio fica indisponível — não há contorno.</AvisoDeContingencia>
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-[#25D366]" />
            WhatsApp em Massa
          </h2>
          <p className="text-sm text-muted-foreground">Envie conteúdos de marketing para sua lista de contatos</p>
        </div>
        <Button variant="outline" size="sm" onClick={verificarStatus}>
          <RefreshCw className="w-3.5 h-3.5" /> Verificar conexão
        </Button>
      </div>

      {/* P2.11 / P2.17.14 — indisponível: primeiro o aviso; o formulário NÃO aparece como utilizável. */}
      {status && status.envioPermitido === false && (
        <div className="flex gap-3 rounded-xl border border-danger/30 bg-danger/5 p-4" role="status">
          <AlertCircle className="w-5 h-5 text-danger shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-danger">WhatsApp indisponível</p>
            <p className="text-xs text-white/80 mt-1">Dados de terceiros sem base legal de transferência internacional (LGPD). Sem solução oficial, não há contorno.</p>
            <details className="text-[11px] text-muted-foreground mt-1"><summary className="cursor-pointer">Motivo completo</summary><p className="mt-1">{status.motivoDoBloqueio}</p></details>
          </div>
        </div>
      )}

      <Implementacao indisponivel={status?.envioPermitido === false}>
      {/* Status Z-API */}
      {!status?.configurado ? (
        <div className="flex gap-3 rounded-xl border border-warning/30 bg-warning/5 p-4">
          <AlertCircle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-warning">WhatsApp não configurado</p>
            <p className="text-xs text-muted-foreground mt-1">
              Configure sua instância Z-API em{' '}
              <a href="/integracoes" className="text-accent underline">Integrações → WhatsApp (Z-API)</a>.
              Crie sua conta gratuita em{' '}
              <a href="https://z-api.io" target="_blank" rel="noopener noreferrer" className="text-accent underline">z-api.io</a>.
            </p>
          </div>
        </div>
      ) : !status.conectado ? (
        <div className="flex gap-3 rounded-xl border border-danger/30 bg-danger/5 p-4">
          <XCircle className="w-5 h-5 text-danger shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-danger">WhatsApp desconectado</p>
            <p className="text-xs text-muted-foreground mt-1">
              Abra o Z-API no painel, escaneie o QR Code com seu celular e tente novamente.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex gap-3 rounded-xl border border-[#25D366]/30 bg-[#25D366]/5 p-4">
          <CheckCircle2 className="w-5 h-5 text-[#25D366] shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-[#25D366]">WhatsApp conectado</p>
            {status.numero && <p className="text-xs text-muted-foreground">Número: {status.numero}</p>}
          </div>
        </div>
      )}

      {/* Abas */}
      <div className="flex gap-1 border-b border-border">
        {([['enviar', 'Enviar Mensagens', Send], ['contatos', `Contatos (${contatosSalvos.length})`, Users]] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setAba(id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              aba === id
                ? 'border-accent text-accent'
                : 'border-transparent text-muted-foreground hover:text-white'
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* ── ABA: ENVIAR ── */}
      {aba === 'enviar' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Coluna esquerda: conteúdo */}
            <div className="card-stat space-y-4">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <FileText className="w-4 h-4 text-accent" /> Mensagem
              </h3>

              {/* Selecionar conteúdo gerado */}
              {conteudos.length === 0 && (
                <p className="rounded-lg border border-border bg-secondary/40 p-3 text-xs text-muted-foreground">
                  Nenhum conteúdo pronto para WhatsApp. Só vai para envio em massa o conteúdo <span className="text-white">gerado para WhatsApp e aprovado</span>, sem alerta vermelho. Gere em Gerar Conteúdo (rede “WhatsApp”) e aprove em Aprovações.
                </p>
              )}
              {conteudos.length > 0 && (
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Conteúdo aprovado para WhatsApp</label>
                  <select
                    className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-accent"
                    value={conteudoSelecionado?.id ?? ''}
                    onChange={(e) => {
                      const c = conteudos.find((x) => x.id === e.target.value)
                      if (c) selecionarConteudo(c)
                      else { setConteudoSelecionado(null) }
                    }}
                  >
                    <option value="">— Escolha um conteúdo aprovado —</option>
                    {conteudos.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.produto.nome} {c.redeSocial ? `(${c.redeSocial})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">
                  Texto da mensagem
                  <span className="ml-2 text-accent">{mensagem.length} caracteres</span>
                </label>
                <textarea
                  rows={6}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent resize-none"
                  placeholder="A mensagem é a legenda aprovada do conteúdo escolhido acima."
                  value={mensagem}
                  readOnly
                />
                <p className="mt-1 text-[11px] text-muted-foreground">Para mudar o texto, edite a legenda do conteúdo e aprove de novo.</p>
              </div>

              {/* Imagem opcional */}
              <div>
                <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer mb-2">
                  <input
                    type="checkbox"
                    checked={usarImagem}
                    onChange={(e) => setUsarImagem(e.target.checked)}
                    className="rounded border-border accent-accent"
                  />
                  <ImageIcon className="w-3.5 h-3.5" />
                  Enviar com a foto do produto
                </label>
                {usarImagem && conteudoSelecionado && !(conteudoSelecionado.produto.imagens ?? []).length && (
                  <p className="text-[11px] text-warning">Este produto não tem foto cadastrada: a mensagem vai só com texto.</p>
                )}
              </div>

              {/* Delay */}
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">
                  Intervalo entre envios: <span className="text-accent font-medium">{delay}s</span>
                  <span className="ml-2 text-muted-foreground">(mín. 2s — reduz risco de bloqueio)</span>
                </label>
                <input
                  type="range"
                  min={2}
                  max={10}
                  value={delay}
                  onChange={(e) => setDelay(Number(e.target.value))}
                  className="w-full accent-accent"
                />
              </div>
            </div>

            {/* Coluna direita: contatos */}
            <div className="card-stat space-y-4">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Users className="w-4 h-4 text-accent" />
                Destinatários
                {numerosAtivos > 0 && (
                  <span className="ml-auto text-xs text-accent font-normal">{numerosAtivos} número(s)</span>
                )}
              </h3>

              {contatosSalvos.length > 0 ? (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">
                    Usando lista salva de {contatosSalvos.length} contato(s).{' '}
                    <button onClick={() => setAba('contatos')} className="text-accent underline">Gerenciar</button>
                  </p>
                  <div className="max-h-40 overflow-y-auto space-y-1 rounded-lg border border-border p-2">
                    {contatosSalvos.slice(0, 10).map((n) => (
                      <div key={n} className="flex items-center justify-between text-xs text-muted-foreground px-1">
                        <span>{n}</span>
                        <button onClick={() => removerContato(n)} className="text-danger hover:text-danger/80">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                    {contatosSalvos.length > 10 && (
                      <p className="text-xs text-muted-foreground text-center pt-1">
                        +{contatosSalvos.length - 10} mais
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">
                    Cole os números (um por linha, ou separados por vírgula)
                  </label>
                  <textarea
                    rows={5}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent resize-none"
                    placeholder={`5511999999999\n5521888888888\n5531777777777`}
                    value={contatosTexto}
                    onChange={(e) => setContatosTexto(e.target.value)}
                  />
                  <div className="flex gap-2 mt-2">
                    <Button variant="outline" size="sm" onClick={() => csvRef.current?.click()}>
                      <Upload className="w-3.5 h-3.5" /> CSV
                    </Button>
                    <Button variant="outline" size="sm" onClick={salvarContatos} disabled={!contatosTexto.trim()}>
                      Salvar lista
                    </Button>
                    <input ref={csvRef} type="file" accept=".csv,.txt" className="hidden" onChange={importarCSV} />
                  </div>
                </div>
              )}

              {/* Estimativa de tempo */}
              {numerosAtivos > 0 && (
                <div className="rounded-lg bg-secondary/50 border border-border px-3 py-2 text-xs text-muted-foreground">
                  ⏱ Estimativa: ~{Math.ceil((numerosAtivos * delay) / 60)} minuto(s) para {numerosAtivos} contato(s)
                </div>
              )}
            </div>
          </div>

          {/* Botão enviar */}
          <div className="flex justify-end">
            <Button
              size="lg"
              onClick={enviarMassa}
              disabled={enviando || !status?.conectado || status?.envioPermitido === false || numerosAtivos === 0 || !conteudoSelecionado}
              style={{ background: enviando ? undefined : '#25D366' }}
              className="text-white font-semibold"
            >
              {enviando
                ? <><Loader2 className="w-4 h-4 animate-spin" />Enviando...</>
                : <><Send className="w-4 h-4" />Enviar para {numerosAtivos} contato(s)</>}
            </Button>
          </div>

          {/* Resultados */}
          {resultados.length > 0 && (
            <div className="card-stat space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">Resultado do Envio</h3>
                <div className="flex gap-3 text-xs">
                  <span className="text-[#25D366]">✓ {resultados.filter((r) => r.ok).length} enviados</span>
                  <span className="text-danger">✗ {resultados.filter((r) => !r.ok).length} erros</span>
                </div>
              </div>
              <div className="max-h-56 overflow-y-auto space-y-1.5">
                {resultados.map((r, i) => (
                  <div
                    key={i}
                    className={cn(
                      'flex items-center gap-2 rounded-lg px-3 py-2 text-xs',
                      r.ok ? 'bg-[#25D366]/10 border border-[#25D366]/20' : 'bg-danger/10 border border-danger/20'
                    )}
                  >
                    {r.ok
                      ? <CheckCircle2 className="w-3.5 h-3.5 text-[#25D366] shrink-0" />
                      : <XCircle className="w-3.5 h-3.5 text-danger shrink-0" />}
                    <span className="font-medium">{r.numero}</span>
                    {r.erro && <span className="text-danger ml-auto truncate max-w-[180px]">{r.erro}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── ABA: CONTATOS ── */}
      {aba === 'contatos' && (
        <div className="card-stat space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Lista de Contatos</h3>
            {contatosSalvos.length > 0 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  if (confirm('Limpar toda a lista?')) {
                    setContatosSalvos([])
                    localStorage.removeItem('wpp_contatos')
                  }
                }}
              >
                <Trash2 className="w-3.5 h-3.5" /> Limpar lista
              </Button>
            )}
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">
              Adicionar números (um por linha ou separados por vírgula/ponto-e-vírgula)
            </label>
            <textarea
              rows={4}
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent resize-none"
              placeholder={`5511999999999\n5521888888888`}
              value={contatosTexto}
              onChange={(e) => setContatosTexto(e.target.value)}
            />
            <div className="flex gap-2 mt-2">
              <Button variant="outline" size="sm" onClick={() => csvRef.current?.click()}>
                <Upload className="w-3.5 h-3.5" /> Importar CSV
              </Button>
              <Button size="sm" onClick={salvarContatos} disabled={!contatosTexto.trim()}>
                Adicionar à lista
              </Button>
              <input ref={csvRef} type="file" accept=".csv,.txt" className="hidden" onChange={importarCSV} />
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">
              Formato CSV: primeira coluna deve conter o número. Ex: <code>5511999999999,Nome</code>
            </p>
          </div>

          {contatosSalvos.length > 0 ? (
            <div>
              <p className="text-xs text-muted-foreground mb-2">{contatosSalvos.length} contato(s) na lista</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {contatosSalvos.map((n) => (
                  <div key={n} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                    <span className="text-white font-medium">{n}</span>
                    <button onClick={() => removerContato(n)} className="text-muted-foreground hover:text-danger transition-colors ml-2">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <Users className="w-8 h-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">Nenhum contato salvo ainda.</p>
            </div>
          )}
        </div>
      )}
      </Implementacao>
    </div>
  )
}

/**
 * P2.17.14 — Com o envio indisponível, a configuração (contatos, envio) fica
 * recolhida e DESABILITADA em "Ver implementação": nada sugere que a titular
 * cole contatos e configure um envio que a própria plataforma recusa.
 */
function Implementacao({ indisponivel, children }: { indisponivel: boolean; children: React.ReactNode }) {
  if (!indisponivel) return <>{children}</>
  return (
    <details className="card-stat">
      <summary className="cursor-pointer text-xs text-muted-foreground hover:text-white">Ver implementação (desabilitada)</summary>
      <fieldset disabled aria-disabled className="mt-4 space-y-6 opacity-50 pointer-events-none">{children}</fieldset>
    </details>
  )
}
