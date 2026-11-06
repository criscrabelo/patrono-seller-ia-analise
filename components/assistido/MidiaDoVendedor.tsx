'use client'

/**
 * P2.18.10 — MÍDIA DO VENDEDOR, dentro da etapa de mídia da Operação.
 * Mostra a situação ("Autorização geral: APROVADA" / "Autorização necessária")
 * e, quando precisa: COPIAR MENSAGEM · ABRIR CONVERSA · REGISTRAR RESPOSTA.
 * Não bloqueia a mídia própria da titular: é só uma alternativa.
 * Nada é enviado ao vendedor pelo Patrono.
 */
import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'

type Situacao = { autorizada: boolean; rotulo: string; motivo: string; autorizacaoId: string | null; loja: string | null; mensagem: string }

export function MidiaDoVendedor({ candidatoId, linkDoProduto }: { candidatoId: string; linkDoProduto: string | null }) {
  const [s, setS] = useState<Situacao | null>(null)
  const [aberto, setAberto] = useState(false)
  const [loja, setLoja] = useState('')
  const [resposta, setResposta] = useState('')
  const [ocupado, setOcupado] = useState(false)

  const carregar = useCallback(async () => {
    const r = await fetch(`/api/midias/vendedor?candidatoId=${encodeURIComponent(candidatoId)}`).catch(() => null)
    setS(r?.ok ? await r.json() : null)
  }, [candidatoId])
  useEffect(() => { carregar() }, [carregar])

  async function postar(corpo: Record<string, unknown>, ok: string) {
    setOcupado(true)
    const r = await fetch('/api/midias/vendedor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) }).catch(() => null)
    const d = r ? await r.json().catch(() => ({})) : {}
    setOcupado(false)
    if (!r?.ok) return toast({ title: 'Não deu certo', description: d.error ?? 'Sem conexão.', variant: 'destructive' })
    toast({ title: ok, description: d.status ? `Situação: ${String(d.status).toLowerCase().replace(/_/g, ' ')}` : undefined, variant: 'success' })
    setResposta('')
    await carregar()
  }

  if (!s) return null
  const input = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-white'
  return (
    <details className="rounded-lg border border-border p-3 text-xs" open={aberto} onToggle={(e) => setAberto((e.target as HTMLDetailsElement).open)} aria-label="Mídia do vendedor">
      <summary className="cursor-pointer list-none">
        <span className="text-white font-medium">MÍDIA DO VENDEDOR</span>{' '}
        <span className={s.autorizada ? 'text-accent' : 'text-muted-foreground'}>· {s.rotulo}{s.loja ? ` (${s.loja})` : ''}</span>
      </summary>
      <div className="mt-2 space-y-2">
        {s.autorizada ? (
          <p className="text-muted-foreground">Pode usar fotos e vídeos do vendedor desta loja: no envio, escolha "Do vendedor (autorizada)".</p>
        ) : (
          <>
            <p className="text-muted-foreground">Prefere usar as fotos/vídeos do vendedor? Peça uma autorização geral uma vez: ela vale para todos os produtos da loja que você divulgar.</p>
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(s.mensagem).then(() => toast({ title: 'Mensagem copiada' }), () => undefined)}>COPIAR MENSAGEM</Button>
              {linkDoProduto ? (
                <a href={linkDoProduto} target="_blank" rel="noopener noreferrer"><Button size="sm" variant="outline" className="w-full"><ExternalLink className="w-3.5 h-3.5" />ABRIR CONVERSA</Button></a>
              ) : <span />}
            </div>
            {!s.autorizacaoId && (
              <div className="space-y-1">
                <input className={input} placeholder="Nome da loja (como aparece no app)" value={loja} onChange={(e) => setLoja(e.target.value)} aria-label="Nome da loja" />
                <Button size="sm" className="w-full" disabled={ocupado || loja.trim().length < 2} onClick={() => postar({ acao: 'solicitar', candidatoId, lojaNome: loja }, 'Pedido registrado')}>JÁ ENVIEI A MENSAGEM</Button>
              </div>
            )}
            {s.autorizacaoId && (
              <div className="space-y-1">
                <textarea className={`${input} min-h-[72px]`} placeholder="Cole aqui a resposta do vendedor" value={resposta} onChange={(e) => setResposta(e.target.value)} aria-label="Resposta do vendedor" />
                <Button size="sm" className="w-full" disabled={ocupado || resposta.trim().length < 2} onClick={() => postar({ acao: 'responder', id: s.autorizacaoId, resposta }, 'Resposta registrada')}>
                  {ocupado ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}REGISTRAR RESPOSTA
                </Button>
                <p className="text-muted-foreground">Silêncio não é autorização. Resposta com condição fica em revisão.</p>
              </div>
            )}
          </>
        )}
      </div>
    </details>
  )
}
