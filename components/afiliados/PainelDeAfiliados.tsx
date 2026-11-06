'use client'

/**
 * P2.53 — Painel de Afiliados: as cinco situações da comissão, sem misturar previsão com resultado.
 * Fonte única: /api/afiliados/painel (lib/painel-afiliados.ts → lib/financeiro.ts).
 */
export type CategoriaDoPainel = 'ESTIMADA' | 'APROVADA' | 'RECEBIDA' | 'CANCELADA' | 'ESTORNADA'
interface Bloco { valores: Record<CategoriaDoPainel, number>; quantidades: Record<CategoriaDoPainel, number>; confirmado: number; aguardandoLiquidacao: number }
export interface PainelDeAfiliadosDados { total: Bloco; porPlataforma: Array<{ plataforma: string; rotulo: string } & Bloco>; excluidos: { quantidade: number; motivo: string } }

const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
export const ROTULO_DA_CATEGORIA: Record<CategoriaDoPainel, { rotulo: string; dica: string }> = {
  ESTIMADA: { rotulo: 'Estimadas', dica: 'Previsão: pedido pago ou concluído, ainda sem liquidação. Não é receita.' },
  APROVADA: { rotulo: 'Aprovadas', dica: 'Valor confirmado (liquidado) pela plataforma.' },
  RECEBIDA: { rotulo: 'Recebidas', dica: 'Dinheiro que já caiu na sua conta.' },
  CANCELADA: { rotulo: 'Canceladas', dica: 'Estimativas que não viraram comissão.' },
  ESTORNADA: { rotulo: 'Estornadas', dica: 'Eram aprovadas ou recebidas e foram revertidas.' },
}
const ORDEM: CategoriaDoPainel[] = ['ESTIMADA', 'APROVADA', 'RECEBIDA', 'CANCELADA', 'ESTORNADA']

function Linha({ bloco }: { bloco: Bloco }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
      {ORDEM.map((k) => (
        <div key={k} title={ROTULO_DA_CATEGORIA[k].dica}>
          <p className="text-muted-foreground">{ROTULO_DA_CATEGORIA[k].rotulo} ({bloco.quantidades[k]})</p>
          <p className={k === 'ESTIMADA' ? 'text-muted-foreground' : k === 'APROVADA' || k === 'RECEBIDA' ? 'text-white font-semibold' : 'text-white/70'}>{reais(bloco.valores[k])}</p>
        </div>
      ))}
    </div>
  )
}

export function PainelDeAfiliados({ dados }: { dados: PainelDeAfiliadosDados }) {
  const vazio = ORDEM.every((k) => dados.total.quantidades[k] === 0)
  return (
    <section className="card-stat space-y-3" aria-label="Painel de afiliados">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-white">Painel de afiliados</p>
        <p className="text-xs text-muted-foreground">Confirmado: <span className="text-white font-semibold">{reais(dados.total.confirmado)}</span> (aprovadas + recebidas)</p>
      </div>
      {vazio ? (
        <p className="text-xs text-muted-foreground">Nenhuma comissão registrada ainda. Importe o relatório do Creator Center ou registre uma venda.</p>
      ) : (
        <>
          <Linha bloco={dados.total} />
          {dados.total.aguardandoLiquidacao > 0 && <p className="text-[11px] text-muted-foreground">Das estimadas, {reais(dados.total.aguardandoLiquidacao)} são pedidos concluídos aguardando a liquidação.</p>}
          <div className="space-y-2">
            {dados.porPlataforma.map((p) => (
              <div key={p.plataforma} className="rounded-lg border border-border p-2 space-y-1">
                <p className="text-xs font-medium text-white">{p.rotulo}</p>
                <Linha bloco={p} />
              </div>
            ))}
          </div>
        </>
      )}
      {dados.excluidos.quantidade > 0 && <p className="text-[11px] text-muted-foreground">{dados.excluidos.quantidade} registro(s) fora do painel. {dados.excluidos.motivo}</p>}
      <p className="text-[11px] text-muted-foreground">Estimadas são previsão e nunca entram no resultado. Só aprovadas e recebidas são receita.</p>
    </section>
  )
}
