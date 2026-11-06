'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Package } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'
import { Detalhes, Indicador, reaisOuNull, type Tom } from '@/components/shared/Ux'
import { RegistrosDoApp } from './RegistrosDoApp'

/**
 * P2.17.17 — Amostras do TikTok Shop como OPERAÇÃO. O Patrono não pede amostra
 * (isso é no app); aqui ficam o ciclo, os prazos, a missão e o kit pronto para
 * gravar. Os botões registram o que SÓ você vê no app (não há API de amostras).
 */
interface Roteiro { id: string; titulo: string; hook: string; duracaoSegundos: number; cta: string; legenda: string; exigeUsoReal: boolean; liberadoQuando: string; faceless: boolean; roteiro: { etapa: string; texto: string; textoNaTela: string | null }[] }
interface Kit {
  objetivo: string; formatoRecomendado: string; duracaoRecomendada: string; exigeUsoReal: boolean; podeSerFaceless: boolean; roteiros: Roteiro[]; hooks: string[]; ctas: string[]; legendas: string[]
  hashtags: string[]; disclosure: string; planoAB: { a: string; b: string; mede: string; regra: string }; midiaNecessaria: string[]; cenasParaGravar: string[]; alternativaFaceless: string | null
  riscosDeClaim: string[]; usosOperacionais?: string[]; situacao: string; checagem: { ok: boolean; qualityGate: { id: string; veredito: string }[] }
}
interface Amostra {
  id: string; nomeProduto: string; tipo: string | null; estado: string; efetivo: string; rotulo: string; papeis: string[]; comissaoObservada: number | null; comissaoFonte: string | null
  datas: Record<string, string | null>; prazo: { em: string; confirmado: boolean; aviso: string | null } | null; alertas: string[]; alertasDetalhe: string[]
  missao: { computada: boolean | null }; sinais: { rankingPosicao: number | null; rankingCategoria: string | null; vendasTexto: string | null; observadoEm: string; aviso: string } | null
  acaoDaTitular: { titulo: string; motivo: string } | null; proximoDoPatrono: string; motivo: string | null; observacao: string | null; kit: Kit | null
}
interface Resposta {
  amostras: Amostra[]
  respostas: { oQueChegou: string[]; oQueProduzir: string[]; qualVencePrimeiro: { nome: string; prazo: { em: string; confirmado: boolean } } | null; qualValeMais: { nome: string; base: string } | null; qualConteudoPrimeiro: string | null; fila: { id: string; nomeProduto: string; posicao: number; porque: string }[] }
}

const PROXIMOS: Record<string, { evento: string; rotulo: string }[]> = {
  SOLICITADA: [{ evento: 'APROVADA', rotulo: 'Aprovada' }, { evento: 'REJEITADA', rotulo: 'Rejeitada' }],
  PENDENTE_APROVACAO: [{ evento: 'APROVADA', rotulo: 'Aprovada' }, { evento: 'REJEITADA', rotulo: 'Rejeitada' }],
  APROVADA: [{ evento: 'ENVIADA', rotulo: 'Enviada' }, { evento: 'RECEBIDA', rotulo: 'Recebida' }, { evento: 'CANCELADA', rotulo: 'Cancelada' }],
  ENVIADA: [{ evento: 'RECEBIDA', rotulo: 'Recebida' }, { evento: 'CANCELADA', rotulo: 'Cancelada' }],
}
const tomDo = (e: string): Tom => (['RECEBIDA', 'CONTEUDO_PENDENTE', 'APROVACAO'].includes(e) ? 'atencao' : ['PUBLICADA', 'MEDINDO_RESULTADO', 'CONCLUIDA'].includes(e) ? 'ok' : ['REJEITADA', 'CANCELADA'].includes(e) ? 'bloqueado' : 'neutro')
const data = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }) : 'desconhecida')

export function AmostrasTikTokShop() {
  const [d, setD] = useState<Resposta | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const carregar = useCallback(() => {
    fetch('/api/tiktok/amostras').then(async (r) => r.ok && setD(await r.json())).catch(() => null)
  }, [])
  useEffect(() => carregar(), [carregar])

  async function atualizar(id: string, corpo: Record<string, unknown>, msg: string) {
    setOcupado(id)
    try {
      const r = await fetch(`/api/tiktok/amostras/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.erro ?? 'Não consegui atualizar.')
      toast({ title: msg })
      carregar()
    } catch (e) {
      toast({ title: (e as Error).message, variant: 'destructive' })
    } finally {
      setOcupado(null)
    }
  }

  if (!d) return null
  // Sem amostra ainda: só os registros (compactos), para começar.
  if (!d.amostras.length) {
    return (
      <section id="amostras" className="card-stat space-y-2 scroll-mt-20" aria-label="Amostras">
        <div className="flex items-center gap-2"><Package className="w-4 h-4 text-accent" /><p className="text-sm font-semibold text-white">Amostras</p></div>
        <p className="text-xs text-muted-foreground">Nenhuma amostra registrada. O pedido é feito no app do TikTok; registre aqui para o Patrono preparar o conteúdo.</p>
        <RegistrosDoApp aoRegistrar={carregar} />
      </section>
    )
  }
  const r = d.respostas
  return (
    <section id="amostras" className="card-stat space-y-3 scroll-mt-20" aria-label="Amostras">
      <div className="flex items-center gap-2">
        <Package className="w-4 h-4 text-accent" />
        <p className="text-sm font-semibold text-white">Amostras ({d.amostras.length})</p>
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <div><dt className="text-muted-foreground inline">O que chegou: </dt><dd className="inline text-white">{r.oQueChegou.length ? r.oQueChegou.join(', ') : 'nada ainda'}</dd></div>
        <div><dt className="text-muted-foreground inline">O que produzir: </dt><dd className="inline text-white">{r.oQueProduzir.length ? r.oQueProduzir.join(', ') : 'nada agora'}</dd></div>
        <div><dt className="text-muted-foreground inline">Vence primeiro: </dt><dd className="inline text-white">{r.qualVencePrimeiro ? `${r.qualVencePrimeiro.nome} (${data(r.qualVencePrimeiro.prazo.em)}${r.qualVencePrimeiro.prazo.confirmado ? '' : ', estimado'})` : 'nenhum prazo em curso'}</dd></div>
        <div><dt className="text-muted-foreground inline">Vale mais: </dt><dd className="inline text-white">{r.qualValeMais ? r.qualValeMais.nome : 'sem dado para comparar'}</dd></div>
        <div className="sm:col-span-2"><dt className="text-muted-foreground inline">Conteúdo primeiro: </dt><dd className="inline text-white">{r.qualConteudoPrimeiro ?? 'quando a primeira amostra chegar'}</dd></div>
      </dl>
      <ul className="divide-y divide-border">
        {d.amostras.map((a) => (
          <li key={a.id} className="py-2 space-y-1">
            {/* Celular: nome na largura toda e o selo embaixo (não espreme o nome). */}
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
              <span className="text-sm text-white min-w-0 break-words">{a.nomeProduto}</span>
              <span className="self-start sm:self-auto shrink-0"><Indicador nome="" estado={a.rotulo} tom={tomDo(a.efetivo)} /></span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {a.tipo === 'GRATIS' ? 'Amostra grátis' : a.tipo === 'REEMBOLSAVEL' ? 'Amostra reembolsável' : 'Tipo de amostra não informado'}
              {' · '}comissão vista: {reaisOuNull(a.comissaoObservada) ?? 'não vista'}{a.comissaoObservada !== null ? ' (no app, snapshot)' : ''}
              {a.papeis.includes('EQUIPAMENTO_OPERACIONAL') ? ' · também equipamento de produção' : ''}
              {' · '}missão: {a.missao.computada === true ? 'contou no app' : 'contagem não confirmada'}
            </p>
            {a.prazo && <p className="text-[11px] text-warning">Prazo {a.prazo.confirmado ? 'confirmado' : 'estimado'}: {data(a.prazo.em)}{a.prazo.aviso ? ` — ${a.prazo.aviso}` : ''}</p>}
            {a.alertasDetalhe.map((x) => <p key={x} className="text-[11px] text-warning">{x}</p>)}
            <p className="text-[11px] text-white/80">{a.acaoDaTitular ? <b className="text-warning">Você: {a.acaoDaTitular.titulo}. </b> : null}Patrono: {a.proximoDoPatrono}</p>
            <div className="flex flex-wrap gap-1">
              {(PROXIMOS[a.estado] ?? []).map((p) => (
                <Button key={p.evento} size="sm" variant="outline" disabled={ocupado === a.id} onClick={() => atualizar(a.id, { evento: p.evento }, `Amostra: ${p.rotulo.toLowerCase()}`)}>
                  {ocupado === a.id ? <Loader2 className="w-3 h-3 animate-spin" /> : null}{p.rotulo}
                </Button>
              ))}
              {a.missao.computada !== true && !['REJEITADA', 'CANCELADA'].includes(a.efetivo) && (
                <Button size="sm" variant="ghost" disabled={ocupado === a.id} onClick={() => atualizar(a.id, { missaoComputada: true }, 'Registrado: o app contou na missão')}>O app contou na missão</Button>
              )}
            </div>
            {a.kit && (
              <Detalhes titulo={`Kit de conteúdo — ${a.kit.situacao}`}>
                <p>{a.kit.objetivo}</p>
                <p>Formato: {a.kit.formatoRecomendado} · Duração: {a.kit.duracaoRecomendada}{a.kit.podeSerFaceless ? ' · pode ser sem rosto' : ''}</p>
                <p className="text-white mt-1">Cenas para gravar</p>
                <ul className="list-disc pl-4">{a.kit.cenasParaGravar.map((c) => <li key={c}>{c}</li>)}</ul>
                {a.kit.usosOperacionais && (<><p className="text-white mt-1">Como equipamento de produção</p><ul className="list-disc pl-4">{a.kit.usosOperacionais.map((c) => <li key={c}>{c}</li>)}</ul></>)}
                <p className="text-white mt-1">Roteiros</p>
                <ol className="space-y-1">
                  {a.kit.roteiros.map((rt) => (
                    <li key={rt.id} className="rounded bg-black/20 p-1.5">
                      <p className="text-white">{rt.titulo} · {rt.duracaoSegundos} s{rt.liberadoQuando === 'APOS_USO_REAL' ? ' · só depois do uso real (a fala é sua)' : ''} · QG: {a.kit!.checagem.qualityGate.find((q) => q.id === rt.id)?.veredito.toLowerCase()}</p>
                      <p>Gancho: “{rt.hook}”</p>
                      <ul className="pl-3">{rt.roteiro.map((e, i) => <li key={i}>{e.etapa}: {e.texto}{e.textoNaTela ? ` [tela: ${e.textoNaTela}]` : ''}</li>)}</ul>
                      <p>CTA: {rt.cta} · Legenda: {rt.legenda}</p>
                    </li>
                  ))}
                </ol>
                <p className="mt-1">Teste A/B: {a.kit.planoAB.a} × {a.kit.planoAB.b} — mede {a.kit.planoAB.mede}. {a.kit.planoAB.regra}</p>
                <p>Divulgação: {a.kit.disclosure} · Hashtags: {a.kit.hashtags.join(' ')}</p>
                {a.kit.alternativaFaceless && <p>Sem rosto: {a.kit.alternativaFaceless}</p>}
                <p className="text-white mt-1">Cuidados (claims)</p>
                <ul className="list-disc pl-4">{a.kit.riscosDeClaim.map((c) => <li key={c}>{c}</li>)}</ul>
              </Detalhes>
            )}
          </li>
        ))}
      </ul>
      <RegistrosDoApp aoRegistrar={carregar} />
      <Detalhes titulo="Ordem de execução quando chegarem (prazo → risco → evidência de venda → dinheiro → missão → Natal → facilidade)">
        <ol className="space-y-0.5">{r.fila.map((f) => <li key={f.id}>{f.posicao}. <span className="text-white">{f.nomeProduto}</span> — {f.porque}</li>)}</ol>
      </Detalhes>
    </section>
  )
}
