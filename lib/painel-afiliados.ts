/**
 * P2.53 — PAINEL DE AFILIADOS (incorporação da proposta do Lovable, sem plataforma paralela).
 *
 * Não cria regra nova de dinheiro: cada comissão passa por `estadoDaComissao` (lib/financeiro.ts,
 * fonte canônica) e só é AGRUPADA nas cinco categorias que a titular pediu:
 *
 *   ESTIMADA   = ESTIMADA + NAO_LIQUIDADA  (previsão — nunca receita)
 *   APROVADA   = LIQUIDADA                 (valor confirmado pela plataforma)
 *   RECEBIDA   = RECEBIDA                  (dinheiro na conta)
 *   CANCELADA  = CANCELADA                 (estimativa que não virou comissão)
 *   ESTORNADA  = REVERTIDA                 (era aprovada/recebida e foi revertida)
 *
 * Confirmado = APROVADA + RECEBIDA (o mesmo `confirmada` da fonte única).
 * Só entra comissão de OPERAÇÃO REAL ou RELATADA PELA TITULAR; teste, demo, seed, sintético e origem
 * não verificada ficam fora (contados à parte, para ninguém achar que sumiram).
 * TikTok Shop vem primeiro (prioridade da operação).
 */
import { centavos, estadoDaComissao, ORIGENS_DE_RESULTADO, type EstadoFinanceiro, type ComissaoParaClassificar } from './financeiro'

export type CategoriaDoPainel = 'ESTIMADA' | 'APROVADA' | 'RECEBIDA' | 'CANCELADA' | 'ESTORNADA'
export const CATEGORIAS_DO_PAINEL: readonly CategoriaDoPainel[] = ['ESTIMADA', 'APROVADA', 'RECEBIDA', 'CANCELADA', 'ESTORNADA']

export const CATEGORIA_DO_ESTADO: Record<EstadoFinanceiro, CategoriaDoPainel> = {
  ESTIMADA: 'ESTIMADA',
  NAO_LIQUIDADA: 'ESTIMADA',
  LIQUIDADA: 'APROVADA',
  RECEBIDA: 'RECEBIDA',
  CANCELADA: 'CANCELADA',
  REVERTIDA: 'ESTORNADA',
}

/** Origens que entram no painel (contabilidade da titular). Treino do Learning Engine continua só REAL_OPERATION. */
export const ORIGENS_DO_PAINEL = ORIGENS_DE_RESULTADO

export interface ItemDoPainel {
  id: string
  plataforma: string
  estado: EstadoFinanceiro
  valor: number
  origem: string | null
}

export interface Bloco {
  valores: Record<CategoriaDoPainel, number>
  quantidades: Record<CategoriaDoPainel, number>
  /** APROVADA + RECEBIDA. */
  confirmado: number
  /** Parte da ESTIMADA que é pedido concluído aguardando liquidação. */
  aguardandoLiquidacao: number
}

export interface PainelDeAfiliados {
  total: Bloco
  porPlataforma: Array<{ plataforma: string; rotulo: string } & Bloco>
  excluidos: { quantidade: number; motivo: string }
}

const ROTULOS: Record<string, string> = {
  'tiktok-shop': 'TikTok Shop', tiktokshop: 'TikTok Shop', shopee: 'Shopee', amazon: 'Amazon Associados',
  'amazon-associados': 'Amazon Associados', mercadolivre: 'Mercado Livre', 'mercado-livre': 'Mercado Livre', hotmart: 'Hotmart',
}
/** Uma chave por plataforma (tiktokshop e tiktok-shop são a mesma). */
export function plataformaCanonica(p: string | null | undefined): string {
  const v = (p ?? '').trim().toLowerCase()
  if (!v) return 'sem-programa'
  if (v === 'tiktokshop' || v === 'tiktok') return 'tiktok-shop'
  if (v === 'amazon') return 'amazon-associados'
  if (v === 'mercadolivre') return 'mercado-livre'
  return v
}

function blocoVazio() {
  const zero = () => ({ ESTIMADA: 0, APROVADA: 0, RECEBIDA: 0, CANCELADA: 0, ESTORNADA: 0 })
  return { c: zero(), q: zero(), aguardando: 0 }
}
function fechar(b: ReturnType<typeof blocoVazio>): Bloco {
  const valores = Object.fromEntries(CATEGORIAS_DO_PAINEL.map((k) => [k, b.c[k] / 100])) as Record<CategoriaDoPainel, number>
  return { valores, quantidades: { ...b.q }, confirmado: (b.c.APROVADA + b.c.RECEBIDA) / 100, aguardandoLiquidacao: b.aguardando / 100 }
}

/** FUNÇÃO PURA. Itens com o mesmo id contam uma vez; somas em centavos inteiros. */
export function montarPainelDeAfiliados(itens: ItemDoPainel[]): PainelDeAfiliados {
  const vistos = new Set<string>()
  const total = blocoVazio()
  const porPlat = new Map<string, ReturnType<typeof blocoVazio>>()
  let excluidos = 0
  for (const i of itens) {
    if (vistos.has(i.id)) continue
    vistos.add(i.id)
    if (!(ORIGENS_DO_PAINEL as readonly string[]).includes(i.origem ?? '')) { excluidos++; continue }
    const cat = CATEGORIA_DO_ESTADO[i.estado]
    const c = centavos(i.valor)
    const plat = plataformaCanonica(i.plataforma)
    const b = porPlat.get(plat) ?? blocoVazio()
    for (const alvo of [total, b]) {
      alvo.c[cat] += c
      alvo.q[cat] += 1
      if (i.estado === 'NAO_LIQUIDADA') alvo.aguardando += c
    }
    porPlat.set(plat, b)
  }
  const porPlataforma = [...porPlat.entries()]
    .map(([plataforma, b]) => ({ plataforma, rotulo: ROTULOS[plataforma] ?? plataforma, ...fechar(b) }))
    .sort((a, b) => Number(b.plataforma === 'tiktok-shop') - Number(a.plataforma === 'tiktok-shop') || b.confirmado - a.confirmado)
  return {
    total: fechar(total),
    porPlataforma,
    excluidos: { quantidade: excluidos, motivo: 'Registros de teste, demonstração, carga inicial ou sem origem verificável não entram no painel.' },
  }
}

/** Leitura do banco (workspace da sessão). */
export async function painelDeAfiliados(workspaceId: string): Promise<PainelDeAfiliados> {
  const { prisma } = await import('./prisma')
  const cs = await prisma.commission.findMany({
    where: { workspaceId },
    select: {
      id: true, status: true, expectedAmount: true, confirmedAmount: true, receivedAmount: true, saleId: true,
      affiliateProgram: { select: { platform: true } },
      sale: { select: { status: true, source: true, dataOrigin: true } },
    },
  })
  const saleIds = cs.map((c) => c.saleId).filter((x): x is string => !!x)
  const pedidos = saleIds.length ? await prisma.pedidoAfiliadoTikTok.findMany({ where: { workspaceId, saleId: { in: saleIds } }, select: { saleId: true, estado: true } }) : []
  const estadoPorVenda = new Map(pedidos.map((p) => [p.saleId!, p.estado]))
  return montarPainelDeAfiliados(cs.map((c) => {
    const { estado, valor } = estadoDaComissao(c as ComissaoParaClassificar, c.sale?.status ?? null, c.saleId ? estadoPorVenda.get(c.saleId) ?? null : null)
    const plataforma = c.affiliateProgram?.platform ?? (c.sale?.source === 'creator_center_csv' ? 'tiktok-shop' : null)
    return { id: c.id, plataforma: plataforma ?? 'sem-programa', estado, valor, origem: c.sale?.dataOrigin ?? null }
  }))
}
