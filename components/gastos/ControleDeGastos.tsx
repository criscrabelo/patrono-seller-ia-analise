'use client'

/** P2.53 — Situação do limite de gastos (o bloqueio acontece no servidor, antes de toda chamada paga). */
export interface SituacaoDosGastosDados {
  orcamentoAdicionalAutorizadoBRL: number
  pagoHabilitado: boolean
  autorizacao: { valida: boolean; por: string | null; ate: string | null; motivo: string | null }
  orcamentoIgnoradoBRL: number | null
  reservadoNoMesBRL: number | null
  bloqueiosNoMes: number | null
  ultimosBloqueios: Array<{ quando: string; operacao: string; motivo: string }>
  provedoresPagos: Array<{ provedor: string; descricao: string; liberado: boolean }>
  semCustoAdicional: ReadonlyArray<{ recurso: string; por: string }>
  regra: string
}
const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function ControleDeGastos({ dados }: { dados: SituacaoDosGastosDados }) {
  const liberado = dados.pagoHabilitado && dados.orcamentoAdicionalAutorizadoBRL > 0
  return (
    <section className="card-stat space-y-2" aria-label="Controle de gastos">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-white">Controle de gastos</p>
        <p className="text-xs"><span className="text-muted-foreground">Orçamento adicional autorizado:</span> <span className="text-white font-semibold">{reais(dados.orcamentoAdicionalAutorizadoBRL)}/mês</span></p>
      </div>
      <p className="text-xs text-white/90">
        {liberado
          ? `Gasto autorizado por ${dados.autorizacao.por} até ${dados.autorizacao.ate}. Reservado neste mês: ${dados.reservadoNoMesBRL === null ? 'não apurado' : reais(dados.reservadoNoMesBRL)}.`
          : 'Nenhuma despesa nova é feita: toda chamada a serviço pago é bloqueada no servidor e o Patrono usa a alternativa sem custo.'}
      </p>
      {dados.orcamentoIgnoradoBRL !== null && (
        <p className="text-[11px] text-warning">Há {reais(dados.orcamentoIgnoradoBRL)} configurados no servidor, mas sem a sua autorização registrada: vale R$ 0. {dados.autorizacao.motivo}</p>
      )}
      <p className="text-[11px] text-muted-foreground">Bloqueios neste mês: {dados.bloqueiosNoMes ?? 'não apurado'}. {dados.regra}</p>
      <details className="text-[11px] text-muted-foreground">
        <summary className="cursor-pointer">O que continua funcionando sem custo e o que está bloqueado</summary>
        <ul className="mt-1 space-y-0.5">{dados.semCustoAdicional.map((r) => <li key={r.recurso}>✓ {r.recurso}: {r.por}</li>)}</ul>
        <ul className="mt-1 space-y-0.5">{dados.provedoresPagos.map((p) => <li key={p.provedor}>{p.liberado ? '●' : '⛔'} {p.provedor}: {p.descricao} ({p.liberado ? 'liberado pelo orçamento' : 'bloqueado'})</li>)}</ul>
        {dados.ultimosBloqueios.length > 0 && (
          <ul className="mt-1 space-y-0.5">{dados.ultimosBloqueios.map((b, i) => <li key={i}>{new Date(b.quando).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} · {b.operacao}: {b.motivo}</li>)}</ul>
        )}
      </details>
    </section>
  )
}
