'use client'

import { useState } from 'react'
import { Loader2, Send, Sparkles } from 'lucide-react'

interface Resposta {
  comando: string
  texto: string[]
  sugestoes: string[]
  alterou: boolean
}

interface Troca {
  pergunta: string
  resposta: Resposta | null
  erro?: string
}

const SUGESTOES_INICIAIS = ['Como está a operação?', 'O que precisa de mim?', 'O que você fez hoje?', 'Por que este produto?', 'Rodar agora']

/**
 * P2.15 — Copilot determinístico: comandos predefinidos, sem IA paga.
 * Não aparece se a flag COPILOT_DETERMINISTICO estiver desligada (404).
 */
export function CopilotPainel({ aoAlterar }: { aoAlterar?: () => void }) {
  const [texto, setTexto] = useState('')
  const [trocas, setTrocas] = useState<Troca[]>([])
  const [enviando, setEnviando] = useState(false)
  const [desligado, setDesligado] = useState(false)

  async function perguntar(pergunta: string) {
    const p = pergunta.trim()
    if (!p || enviando) return
    setEnviando(true)
    setTexto('')
    try {
      const res = await fetch('/api/copilot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texto: p }) })
      if (res.status === 404) {
        setDesligado(true)
        return
      }
      const dados = await res.json().catch(() => ({}))
      if (!res.ok) {
        setTrocas((t) => [...t, { pergunta: p, resposta: null, erro: dados.error ?? 'Não consegui responder agora.' }].slice(-6))
        return
      }
      setTrocas((t) => [...t, { pergunta: p, resposta: dados as Resposta }].slice(-6))
      if ((dados as Resposta).alterou) aoAlterar?.()
    } catch {
      setTrocas((t) => [...t, { pergunta: p, resposta: null, erro: 'Sem conexão. Tente de novo.' }].slice(-6))
    } finally {
      setEnviando(false)
    }
  }

  if (desligado) return null
  const sugestoes = trocas.at(-1)?.resposta?.sugestoes ?? SUGESTOES_INICIAIS

  return (
    <div className="card-stat flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-accent" />
        <p className="text-sm font-semibold text-white">Fale com o Patrono</p>
        <span className="text-[10px] text-muted-foreground">respostas na hora · sem custo</span>
      </div>

      {trocas.length > 0 && (
        <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
          {trocas.map((t, i) => (
            <div key={i} className="space-y-1">
              <p className="text-xs text-muted-foreground text-right">{t.pergunta}</p>
              {t.erro ? (
                <p className="text-sm text-danger">{t.erro}</p>
              ) : (
                <div className="rounded-lg bg-secondary/60 px-3 py-2 text-sm text-white space-y-0.5">
                  {t.resposta?.texto.map((linha, j) => <p key={j}>{linha}</p>)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {trocas.length === 0 && <p className="w-full text-xs text-muted-foreground">Toque numa pergunta ou escreva a sua:</p>}
        {sugestoes.map((s) => (
          <button
            key={s}
            onClick={() => perguntar(s)}
            disabled={enviando}
            className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:text-white hover:border-accent/50 disabled:opacity-40"
          >
            {s}
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          perguntar(texto)
        }}
        className="flex gap-2"
      >
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          maxLength={300}
          placeholder="Escreva do seu jeito, ex.: o que precisa de mim?"
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <button
          type="submit"
          disabled={enviando || !texto.trim()}
          className="rounded-lg bg-accent/90 hover:bg-accent px-3 text-white disabled:opacity-40"
          aria-label="Enviar"
        >
          {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </form>
    </div>
  )
}
