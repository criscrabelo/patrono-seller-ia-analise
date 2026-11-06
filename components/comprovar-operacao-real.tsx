'use client'

import { useEffect, useState } from 'react'
import { ShieldCheck, Loader2, AlertTriangle, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils'

/**
 * Comprovação manual auditada de uma venda real.
 *
 * ── POR QUE NÃO É UM BOTÃO "MARCAR COMO REAL" ───────────────────────────
 * Marcar como real é uma afirmação sobre o mundo, assinada por quem clica e
 * gravada para sempre na auditoria. Um botão de um clique convidaria ao uso
 * distraído, e dado de origem duvidosa é justamente o que toda a cadeia do
 * P0.2 existe para impedir.
 *
 * Por isso a tela: mostra primeiro o que o sistema JÁ sabe (status, origem,
 * os três estágios da comissão, elegibilidade, lacunas), exige motivo escrito
 * e referência conferível, e avisa que a ação é excepcional e auditada.
 *
 * ── A TELA NÃO CONHECE A REGRA ──────────────────────────────────────────
 * Ela não valida tamanho de motivo, não decide origem promovível e não sabe
 * o que torna uma venda elegível. Envia e mostra o que o servidor respondeu.
 * Uma segunda cópia da regra aqui divergiria da primeira no dia seguinte.
 */

interface Dossie {
  venda: { id: string; status: string; valorBruto: number | null; dataOrigin: string }
  proveniencia: { dataOrigin: string; descricao: string; ehOperacaoReal: boolean }
  receita: {
    valorBrutoDaVenda: number | null
    comissaoEsperada: number
    comissaoConfirmada: number
    comissaoRecebida: number
    receitaRealizada: number
  }
  veredito: { elegivel: boolean; motivos: string[]; explicacao: string } | null
  amostraML: { labeledAt: string | null; dataOrigin: string; contadaPeloReadiness: boolean; label: unknown } | null
  lacunas: Array<{ codigo: string; gravidade: string; explicacao: string }>
}

export function ComprovarOperacaoReal({
  saleId,
  aoFechar,
  aoComprovar,
}: {
  saleId: string
  aoFechar: () => void
  aoComprovar?: () => void
}) {
  const [dossie, setDossie] = useState<Dossie | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [referencia, setReferencia] = useState('')
  const [erro, setErro] = useState('')
  const [sucesso, setSucesso] = useState('')

  useEffect(() => {
    let ativo = true
    setCarregando(true)
    fetch(`/api/vendas/${saleId}/dossie`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (ativo) setDossie(d)
      })
      .catch(() => {})
      .finally(() => {
        if (ativo) setCarregando(false)
      })
    return () => {
      ativo = false
    }
  }, [saleId])

  async function enviar() {
    setEnviando(true)
    setErro('')
    setSucesso('')
    try {
      const res = await fetch(`/api/vendas/${saleId}/comprovar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Só motivo e referência. Workspace e responsável saem da sessão no
        // servidor — enviá-los daqui não teria efeito nenhum.
        body: JSON.stringify({ motivo, referencia }),
      })
      const data = await res.json()
      if (!res.ok) {
        setErro(data.erro ?? data.error ?? 'Não foi possível comprovar a operação.')
        return
      }
      // O servidor devolve o estado JÁ atualizado: nada de "atualize a tela".
      if (data.dossie) setDossie(data.dossie)
      setSucesso(data.explicacao ?? 'Comprovação registrada.')
      aoComprovar?.()
    } catch {
      setErro('Falha de conexão ao comprovar a operação.')
    } finally {
      setEnviando(false)
    }
  }

  const jaEhReal = dossie?.proveniencia.ehOperacaoReal === true

  return (
    <div className="card-stat space-y-5 border-warning/40">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-warning/10 shrink-0">
            <ShieldCheck className="w-5 h-5 text-warning" />
          </div>
          <div>
            <h3 className="font-semibold text-white">Comprovar operação real</h3>
            <p className="text-xs text-muted-foreground">
              Ação excepcional e auditada — use apenas quando a venda realmente aconteceu.
            </p>
          </div>
        </div>
        <button onClick={aoFechar} className="text-muted-foreground hover:text-white" aria-label="Fechar">
          <X className="w-4 h-4" />
        </button>
      </div>

      {carregando ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando o dossiê desta operação…
        </div>
      ) : !dossie ? (
        <p className="text-sm text-danger">Não foi possível carregar o dossiê desta venda.</p>
      ) : (
        <>
          {/* O que o sistema JÁ sabe, antes de qualquer afirmação nova. */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <Campo rotulo="Status da venda" valor={dossie.venda.status} />
            <Campo rotulo="Origem do registro" valor={dossie.proveniencia.dataOrigin} />
            <Campo rotulo="Valor da venda" valor={dossie.receita.valorBrutoDaVenda != null ? formatCurrency(dossie.receita.valorBrutoDaVenda) : '—'} />
            <Campo rotulo="Comissão esperada" valor={formatCurrency(dossie.receita.comissaoEsperada)} />
            <Campo rotulo="Comissão confirmada" valor={formatCurrency(dossie.receita.comissaoConfirmada)} />
            <Campo rotulo="Comissão recebida" valor={formatCurrency(dossie.receita.comissaoRecebida)} />
          </div>

          <div className="rounded-lg border border-border p-3 text-sm">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Elegibilidade para aprendizado</p>
            <p className={dossie.veredito?.elegivel ? 'text-accent' : 'text-muted-foreground'}>
              {dossie.veredito?.elegivel ? 'Elegível como operação real.' : dossie.veredito?.explicacao ?? '—'}
            </p>
            {dossie.amostraML && (
              <p className="text-xs text-muted-foreground mt-2">
                Amostra de ML: {dossie.amostraML.labeledAt ? 'rotulada' : 'capturada, sem rótulo'} ·{' '}
                {dossie.amostraML.contadaPeloReadiness ? 'contando na prontidão' : 'fora da prontidão'}
              </p>
            )}
          </div>

          {dossie.lacunas.length > 0 && (
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
                Lacunas encontradas ({dossie.lacunas.length})
              </p>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {dossie.lacunas.map((l) => (
                  <li key={l.codigo} className="flex gap-2">
                    <span className={l.gravidade === 'INCONSISTENCIA' ? 'text-danger shrink-0' : 'text-warning shrink-0'}>
                      {l.gravidade === 'INCONSISTENCIA' ? '!' : '·'}
                    </span>
                    <span>{l.explicacao}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {jaEhReal ? (
            <p className="text-sm text-accent">Esta venda já está registrada como operação real comprovada.</p>
          ) : (
            <>
              <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 flex gap-2">
                <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>
                    <strong className="text-white">Esta ação é auditada.</strong> Seu usuário, a data, o motivo e a
                    referência ficam registrados permanentemente e podem ser conferidos depois.
                  </p>
                  <p>
                    Use apenas quando a venda <strong className="text-white">realmente ocorreu</strong> e você tem como
                    demonstrar — extrato, repasse, painel do programa. Enquanto provedores e conciliação não forem
                    automatizados, este é o caminho excepcional; depois, ele fica só como recurso administrativo.
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Motivo da comprovação</label>
                  <textarea
                    className="input-field w-full min-h-[72px]"
                    placeholder="Ex.: comissão recebida e conferida no extrato bancário da empresa em 18/09."
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    disabled={enviando}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Referência da evidência</label>
                  <input
                    className="input-field w-full"
                    placeholder="Ex.: extrato-banco-2026-09-18-linha-42"
                    value={referencia}
                    onChange={(e) => setReferencia(e.target.value)}
                    disabled={enviando}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Algo que outra pessoa consiga conferir depois: linha do extrato, número do repasse, protocolo.
                  </p>
                </div>
              </div>

              {erro && <p className="text-sm text-danger">{erro}</p>}

              <div className="flex gap-2">
                <Button onClick={enviar} disabled={enviando}>
                  {enviando ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
                  Comprovar operação real
                </Button>
                <Button variant="outline" onClick={aoFechar} disabled={enviando}>
                  Cancelar
                </Button>
              </div>
            </>
          )}

          {sucesso && <p className="text-sm text-accent">{sucesso}</p>}
        </>
      )}
    </div>
  )
}

function Campo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className="text-white font-medium">{valor}</p>
    </div>
  )
}
