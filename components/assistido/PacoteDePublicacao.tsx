'use client'
/** P2.49/P2.51 — Pacote de publicação (vídeo, legenda, hashtags, CTA): SÓ com os três controles e a campanha aprovados.
 * Retido: o vídeo fica para conferência, sem "Baixar", sem legenda para copiar, com os motivos. */
import { useState } from 'react'
import { linkParaBaixar } from '@/lib/link-para-baixar'
import { toast } from '@/hooks/use-toast'
import type { VisaoDaOperacao } from '@/lib/jornada'
import { perfilSonoroDoVideo } from '@/lib/trilha-sonora'

type Prioritaria = NonNullable<VisaoDaOperacao['prioritaria']>

function Copiar({ texto, rotulo }: { texto: string; rotulo: string }) {
  return (
    <button type="button" className="text-accent text-xs" onClick={() => navigator.clipboard?.writeText(texto).then(() => toast({ title: `${rotulo} copiada` }), () => undefined)}>
      Copiar {rotulo.toLowerCase()}
    </button>
  )
}

/** P2.72 — baixa SÓ a cópia imutável do arquivo aprovado (relida e conferida pelo sha256 no servidor). */
function BaixarAprovado({ id, nome }: { id: string; nome: string }) {
  const [motivo, setMotivo] = useState<string | null>(null)
  const baixar = async () => {
    const r = await fetch(`/api/tiktok/assistido/${id}/arquivo-aprovado`).then((x) => x.json()).catch(() => ({ url: null, motivo: 'Falha ao conferir o arquivo.' }))
    if (r?.url) window.location.href = linkParaBaixar(r.url, nome)
    else setMotivo(r?.motivo ?? 'Arquivo aprovado indisponível.')
  }
  return (
    <>
      <button type="button" onClick={baixar} className="text-accent">Baixar o vídeo aprovado</button>
      {motivo && <span className="text-danger">{motivo}</span>}
    </>
  )
}

/** Pacote de publicação: tudo pronto para colar no app. */
export function PacoteDePublicacao({ j }: { j: Prioritaria }) {
  const ap = (j.assistida?.apresentacao ?? {}) as { video?: { arquivo?: string | null; cenas?: unknown[] }; versao?: { legenda?: string; hashtags?: string[]; cta?: string; disclosure?: string; estrutura?: string; duracaoSegundos?: number }; produtoMarcado?: string; versaoEscolhida?: string; produto?: { categoria?: string | null } }
  const final = (j.assistida?.versaoFinal ?? ap.versao ?? {}) as { legenda?: string; hashtags?: string[]; cta?: string; disclosure?: string }
  const legenda = final.legenda ?? ''
  const hashtags = (final.hashtags ?? []).join(' ')
  // P2.33.1: aprovada a versão NARRADA, o arquivo a publicar é o narrado — nunca o original (o servidor devolve o aprovado).
  const narrada = ap.versaoEscolhida === 'NARRADA'
  const som = perfilSonoroDoVideo({ nome: j.produto.nome, categoria: ap.produto?.categoria ?? null, estrutura: ap.versao?.estrutura ?? null, duracaoSegundos: ap.versao?.duracaoSegundos ?? null, temNarracao: narrada, temTextoNaTela: (ap.video?.cenas?.length ?? 0) > 0 })
  // P2.45/P2.49 — nada fica pronto para publicar sem os TRÊS controles (técnico, comercial, conformidade).
  const liberacao = j.assistida?.liberacao ?? { liberado: false, motivos: ['Controles não avaliados.'] }
  if (!liberacao.liberado) return (
    <div className="space-y-2 text-xs" aria-label="Publicação retida">
      {ap.video?.arquivo && <video src={ap.video.arquivo} controls controlsList="nodownload" playsInline preload="metadata" className="w-full max-w-[220px] aspect-[9/16] rounded-lg bg-black" aria-label={`Vídeo de ${j.produto.nome} (retido)`} />}
      <p className="text-danger font-medium">Publicação retida: faltam controles obrigatórios. Ainda não publique este vídeo.</p>
      <ul className="list-disc pl-4 text-muted-foreground">{liberacao.motivos.map((m) => <li key={m}>{m}</li>)}</ul>
      <p className="text-muted-foreground">O Patrono avisa aqui quando os três controles estiverem aprovados. A sua aprovação continua registrada.</p>
    </div>
  )
  return (
    <div className="space-y-2 text-xs" aria-label="Pacote de publicação">
      {ap.video?.arquivo && (
        <div className="flex flex-col items-start gap-1">
          <p className="text-muted-foreground">{narrada ? 'Vídeo narrado: baixe o aprovado abaixo (a prévia é o original)' : 'Vídeo final'}</p>
          <video src={ap.video.arquivo} controls controlsList="nodownload" playsInline preload="metadata" className="w-full max-w-[220px] aspect-[9/16] rounded-lg bg-black" aria-label={`Vídeo final de ${j.produto.nome}`} />
          {j.assistida?.id && <BaixarAprovado id={j.assistida.id} nome={j.produto.nome} />}
        </div>
      )}
      <p className="text-white">Produto para marcar: <strong>{j.produto.nome}</strong></p>
      {ap.produtoMarcado && <p className="text-muted-foreground">{ap.produtoMarcado}</p>}
      <details className="rounded-lg border border-border p-2" aria-label="Som do vídeo">
        <summary className="cursor-pointer text-white">Som do vídeo: {som.instrumental ? 'instrumental' : 'com ou sem voz'}, {som.clima.join(', ')}, andamento {som.andamento.toLowerCase()}</summary>
        <ul className="list-disc pl-4 text-muted-foreground mt-1">{som.porque.map((x) => <li key={x}>{x}</li>)}</ul>
        <ol className="list-decimal pl-4 text-white/85 mt-1">{som.comoEscolherNoApp.map((x) => <li key={x}>{x}</li>)}</ol>
        <p className="text-muted-foreground mt-1">{som.aviso}</p>
      </details>
      {legenda && <div className="rounded-lg border border-border p-2 space-y-1"><p className="text-white/85 whitespace-pre-wrap break-words">{legenda}</p><Copiar texto={legenda} rotulo="Legenda" /></div>}
      {hashtags && <p className="text-muted-foreground break-words">Hashtags: <span className="text-white">{hashtags}</span> <Copiar texto={hashtags} rotulo="Hashtags" /></p>}
      {final.cta && <p className="text-muted-foreground">CTA: <span className="text-white">{final.cta}</span></p>}
      {final.disclosure && <p className="text-muted-foreground">Aviso de afiliada: <span className="text-white">{final.disclosure}</span></p>}
    </div>
  )
}

