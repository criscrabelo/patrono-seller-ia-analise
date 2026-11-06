'use client'

import { useEffect, useRef, useState } from 'react'
import { FileUp, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'
import { formatCurrency, formatDateShort } from '@/lib/utils'

/**
 * P2.19 — IMPORTAR RELATÓRIO DO CREATOR CENTER (CSV ou XLSX de pedidos de afiliado).
 * Estados SEMPRE separados: estimada e não liquidada são previsão; liquidada é receita confirmada;
 * recebida (dinheiro na conta) é marcada pela titular — liquidada não significa recebida.
 */
interface Resumo {
  estimada: { pedidos: number; valor: number }
  naoLiquidada: { pedidos: number; valor: number }
  liquidada: { pedidos: number; valor: number }
  cancelada: { pedidos: number }
  /** P2.25: era liquidada/recebida e foi cancelada/reembolsada. */
  revertida?: { pedidos: number; valor: number }
  recebida: { pedidos: number; valor: number }
  receitaConfirmada: number
  previsao: number
  naoVinculados: number
  ultimaImportacao: { nomeArquivo: string; importadoEm: string; origem: string; formato: string } | null
}
interface Retorno {
  repetida?: boolean
  linhasNovas: number; linhasAtualizadas: number; linhasIguais: number; linhasRejeitadas: number; regressoesIgnoradas: number; naoVinculados: number
  colunasPossivelmenteRelevantes: string[]
  ocorrencias: { linha: number; tipo: string; texto: string }[]
  situacao?: Situacao | null
}
/** P2.28 — situação real da importação: parcial nunca aparece como sucesso completo. */
interface Situacao { situacao: 'IMPORTADO' | 'IMPORTADO_COM_ALERTAS' | 'INCOMPLETA'; nomeArquivo: string; linhasValidas: number; linhasRecusadas: number; naoVinculados: number; colunasRelevantesNaoReconhecidas: string[]; alertas: string[]; proximaAcao: string }
const ROTULO_DA_SITUACAO: Record<Situacao['situacao'], string> = { IMPORTADO: 'IMPORTADO', IMPORTADO_COM_ALERTAS: 'IMPORTADO COM ALERTAS', INCOMPLETA: 'IMPORTAÇÃO INCOMPLETA' }
function QuadroDaSituacao({ s }: { s: Situacao }) {
  if (s.situacao === 'IMPORTADO') return null
  return (
    <div role="status" aria-label="Situação da importação" className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-white space-y-0.5 break-words">
      <p className="font-semibold">{ROTULO_DA_SITUACAO[s.situacao]} · {s.nomeArquivo}</p>
      <p>{s.linhasValidas} linha(s) válida(s) · {s.linhasRecusadas} recusada(s) · {s.naoVinculados} pedido(s) sem vínculo{s.colunasRelevantesNaoReconhecidas.length ? ` · coluna(s) desconhecida(s): ${s.colunasRelevantesNaoReconhecidas.join(', ')}` : ''}</p>
      <p>{s.alertas.join('; ')}</p>
      <p className="text-warning">Próxima ação: {s.proximaAcao}</p>
    </div>
  )
}

const paraBase64 = async (f: File) => {
  const bytes = new Uint8Array(await f.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

export function ImportarCreatorCenter({ aoImportar }: { aoImportar?: () => void }) {
  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [situacaoDaUltima, setSituacaoDaUltima] = useState<Situacao | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [retorno, setRetorno] = useState<Retorno | null>(null)
  const [progresso, setProgresso] = useState<{ tratadas: number; total: number } | null>(null)
  // P2.29.1: Gate B — a importação só aparece quando a flag IMPORTACAO_CREATOR_CENTER está ligada (null = carregando).
  const [importacaoAtiva, setImportacaoAtiva] = useState<boolean | null>(null)
  const emAndamento = useRef(false)
  const input = useRef<HTMLInputElement>(null)

  const carregar = () => fetch('/api/comissoes/creator-center').then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) { setResumo(d.resumo); setSituacaoDaUltima(d.situacaoDaUltima ?? null); setImportacaoAtiva(d.importacaoAtiva !== false) } }).catch(() => null)
  useEffect(() => { carregar() }, [])

  async function enviar(arquivo: File) {
    if (emAndamento.current) return // duplo clique / segundo arquivo enquanto o primeiro sobe
    emAndamento.current = true
    setEnviando(true); setErro(null); setRetorno(null)
    try {
      if (arquivo.size === 0) { setErro('O arquivo está vazio.'); return }
      if (arquivo.size > 3_000_000) { setErro('Arquivo grande demais (máximo de 3 MB).'); return }
      const xlsx = /\.xlsx$/i.test(arquivo.name)
      const corpo = xlsx ? { nomeArquivo: arquivo.name, conteudoBase64: await paraBase64(arquivo) } : { nomeArquivo: arquivo.name, conteudo: await arquivo.text() }
      // P2.29: arquivo grande é tratado em partes (cada envio cabe no limite do servidor); o MESMO arquivo é
      // reenviado até terminar — o que já foi gravado é reconhecido como igual, nada duplica.
      const enviarUmaVez = () => fetch('/api/comissoes/creator-center', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
      let r = await enviarUmaVez()
      let d = await r.json().catch(() => ({}))
      for (let parte = 1; r.ok && d.continuar && parte < 200; parte++) {
        setProgresso(d.progresso ?? null)
        r = await enviarUmaVez()
        d = await r.json().catch(() => ({}))
      }
      if (r.ok && d.continuar) { setErro(`A importação parou em ${d.progresso?.tratadas ?? '?'} de ${d.progresso?.total ?? '?'} linhas. Envie o mesmo arquivo de novo: continua de onde parou e nada duplica.`); return }
      if (!r.ok) {
        const relevantes: string[] = d.colunasPossivelmenteRelevantes ?? []
        setErro(`${d.error ?? 'Não foi possível importar.'}${relevantes.length ? ` Colunas do arquivo que o Patrono não reconheceu: ${relevantes.join(', ')}.` : ''}`)
        return
      }
      setRetorno(d)
      toast({
        title: d.repetida ? 'Este arquivo já tinha sido importado' : d.situacao?.situacao === 'IMPORTADO_COM_ALERTAS' ? 'Importado com alertas' : 'Relatório importado',
        description: d.repetida ? 'Nada mudou.' : `${d.linhasNovas} novos · ${d.linhasAtualizadas} atualizados · ${d.linhasIguais} sem mudança · ${d.linhasRejeitadas} recusados`,
      })
      await carregar(); aoImportar?.()
    } catch {
      setErro('Não foi possível ler ou enviar o arquivo. Tente de novo.')
    } finally {
      emAndamento.current = false
      setEnviando(false)
      setProgresso(null)
      if (input.current) input.current.value = ''
    }
  }

  const temDados = !!resumo && resumo.estimada.pedidos + resumo.naoLiquidada.pedidos + resumo.liquidada.pedidos + resumo.cancelada.pedidos > 0
  const cartoes = resumo ? [
    { rotulo: 'Estimada', valor: resumo.estimada.valor, pedidos: resumo.estimada.pedidos, nota: 'Pedido pago; pode cancelar. Não é receita.' },
    { rotulo: 'Não liquidada', valor: resumo.naoLiquidada.valor, pedidos: resumo.naoLiquidada.pedidos, nota: 'Concluído; aguardando liquidação (3, 7 ou 15 dias). Não é receita.' },
    { rotulo: 'Liquidada', valor: resumo.liquidada.valor, pedidos: resumo.liquidada.pedidos, nota: 'Valor real. Receita confirmada (ainda não é dinheiro na conta).' },
    { rotulo: 'Recebida', valor: resumo.recebida.valor, pedidos: resumo.recebida.pedidos, nota: 'Dinheiro na conta: você marca quando o pagamento cair.' },
  ] : []

  return (
    <section aria-label="Relatório do Creator Center" className="card-stat space-y-3 min-w-0">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-white">Relatório do Creator Center (TikTok Shop)</h2>
          <p className="text-[11px] text-muted-foreground">Exporte os pedidos de afiliado (CSV ou XLSX) no Creator Center e envie aqui. O mesmo arquivo duas vezes não duplica nada.</p>
        </div>
        {importacaoAtiva === false ? (
          <p role="status" className="text-xs text-muted-foreground sm:max-w-xs break-words">Importação do relatório em validação: ela é liberada quando o primeiro pedido elegível real for conferido.</p>
        ) : <>
        <input
          ref={input} id="arquivo-creator-center" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" disabled={enviando}
          aria-label="Arquivo do relatório do Creator Center" onChange={(e) => e.target.files?.[0] && enviar(e.target.files[0])}
        />
        <Button size="sm" onClick={() => input.current?.click()} disabled={enviando} aria-busy={enviando} className="shrink-0 w-full sm:w-auto min-h-[44px] sm:min-h-0">
          {enviando ? <><Loader2 className="w-4 h-4 animate-spin" aria-hidden /> {progresso ? `Importando ${progresso.tratadas} de ${progresso.total}...` : 'Importando...'}</> : <><FileUp className="w-4 h-4" aria-hidden /> IMPORTAR RELATÓRIO</>}
        </Button>
        </>}
      </div>
      <div aria-live="polite" className="space-y-1">
        {erro && <p role="alert" className="text-xs text-danger break-words">{erro}</p>}
        {retorno && (
          <p className="text-xs text-white break-words">
            {retorno.repetida ? 'Este arquivo já tinha sido importado: nada mudou.' : `Importado: ${retorno.linhasNovas} novos, ${retorno.linhasAtualizadas} atualizados, ${retorno.linhasIguais} sem mudança, ${retorno.linhasRejeitadas} recusados${retorno.regressoesIgnoradas ? `, ${retorno.regressoesIgnoradas} mais antigos ignorados` : ''}.`}
          </p>
        )}
        {retorno?.situacao && <QuadroDaSituacao s={retorno.situacao} />}
        {!retorno && situacaoDaUltima && <QuadroDaSituacao s={situacaoDaUltima} />}
        {retorno && retorno.colunasPossivelmenteRelevantes?.length > 0 && (
          <p className="text-[11px] text-warning break-words">Colunas que o Patrono ainda não usa (o valor foi guardado): {retorno.colunasPossivelmenteRelevantes.join(', ')}.</p>
        )}
      </div>
      {temDados && resumo && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {cartoes.map((c) => (
              <div key={c.rotulo} className="rounded-lg border border-border p-3 min-w-0">
                <p className="text-base font-bold text-white">{formatCurrency(c.valor)}</p>
                <p className="text-xs text-white">{c.rotulo} · {c.pedidos} pedido(s)</p>
                <p className="text-[11px] text-muted-foreground">{c.nota}</p>
              </div>
            ))}
          </div>
          <dl className="text-[11px] text-muted-foreground grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5">
            <div><dt className="inline">Receita confirmada (liquidada): </dt><dd className="inline text-white font-semibold">{formatCurrency(resumo.receitaConfirmada)}</dd></div>
            <div><dt className="inline">Previsão (estimada + não liquidada): </dt><dd className="inline">{formatCurrency(resumo.previsao)}</dd></div>
            {resumo.cancelada.pedidos > 0 && <div><dt className="inline">Cancelados/reembolsados: </dt><dd className="inline">{resumo.cancelada.pedidos}</dd></div>}
            {(resumo.revertida?.pedidos ?? 0) > 0 && <div><dt className="inline">Revertida (já era liquidada, saiu da receita): </dt><dd className="inline">{formatCurrency(resumo.revertida!.valor)} · {resumo.revertida!.pedidos} pedido(s)</dd></div>}
            {resumo.naoVinculados > 0 && <div><dt className="inline">Pedidos sem produto identificado no Patrono: </dt><dd className="inline">{resumo.naoVinculados} (NÃO VINCULADO; nada é ligado por nome)</dd></div>}
            {resumo.ultimaImportacao && <div className="sm:col-span-2 break-words"><dt className="inline">Último arquivo: </dt><dd className="inline">{resumo.ultimaImportacao.nomeArquivo} ({resumo.ultimaImportacao.formato}) em {formatDateShort(resumo.ultimaImportacao.importadoEm)} · origem: Creator Center</dd></div>}
          </dl>
        </>
      )}
      {retorno && retorno.ocorrencias.length > 0 && (
        <details className="text-[11px] text-muted-foreground">
          <summary className="cursor-pointer">{retorno.ocorrencias.length} aviso(s) da importação</summary>
          <ul className="mt-1 space-y-0.5 break-words">{retorno.ocorrencias.slice(0, 50).map((o, i) => <li key={i}>Linha {o.linha}: {o.texto}</li>)}</ul>
        </details>
      )}
    </section>
  )
}
