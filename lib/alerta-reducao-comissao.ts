/**
 * P2.19 — ALERTA DE REDUÇÃO DE COMISSÃO (30 dias).
 *
 * Regra OFICIAL (TikTok Shop Brasil, Seller University; regra de 10/02/2026, conferida na auditoria de 14/10/2026 — P2.18.12 §B.3):
 *   - aumento de taxa vale na hora;
 *   - REDUÇÃO de taxa só vale 30 dias depois, para produtos JÁ ADICIONADOS pelo afiliado.
 *
 * O que o Patrono NÃO inventa:
 *   - se não sabe se o produto já foi adicionado → APLICABILIDADE_NAO_CONFIRMADA (mostra a conta, avisando);
 *   - se só VIU a mudança (não sabe quando o vendedor anunciou) → a data calculada é um TETO: pode valer antes;
 *   - impacto em reais só com preço/pedidos que existem; nunca projeta volume de vendas inventado.
 * A data que o app do TikTok mostrar (informada pela titular) vale mais que a calculada.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { registrarAuditoria } from '@/lib/audit-log'

import { CATALOGO_DE_REGRAS } from '@/lib/regras-de-plataforma'

/** Fonte única: a regra vem do catálogo da P2.20 (lib/regras-de-plataforma.ts), não é copiada aqui. */
const regraDoCatalogo = CATALOGO_DE_REGRAS.find((r) => r.regra === 'REDUCAO_DE_COMISSAO_APOS_DIAS' && r.regiao === 'BR')!

export const REGRA_REDUCAO_DE_COMISSAO = {
  id: regraDoCatalogo.id,
  dias: regraDoCatalogo.limite as number,
  aplicaA: 'produtos já adicionados pelo afiliado',
  fonte: regraDoCatalogo.fonte,
  /** Data da regra na fonte oficial. */
  dataDaFonte: regraDoCatalogo.dataDaFonte!,
  /** Quando o Patrono leu e conferiu a fonte (auditoria P2.18.12). */
  verificadaEm: regraDoCatalogo.verificadaEm!,
  revisarEm: regraDoCatalogo.revisarEm,
  status: regraDoCatalogo.status,
} as const

const DIA = 86_400_000
export type JaAdicionado = 'SIM' | 'NAO' | 'NAO_CONFIRMADO'
export type StatusDoAlerta = 'ATIVO' | 'EFETIVADO' | 'CANCELADO' | 'NAO_SE_APLICA' | 'APLICABILIDADE_NAO_CONFIRMADA'
export type NivelDoAlerta = 'INFORMATIVO' | 'AVISO' | 'URGENTE'

export interface EntradaDoCalculo {
  taxaAtual: number
  taxaNova: number
  dataDoAnuncio: Date
  fonteDoAnuncio: 'INFORMADA_PELA_TITULAR' | 'OBSERVADA_PELO_PATRONO'
  dataEfetivaInformada?: Date | null
  produtoJaAdicionado: JaAdicionado
  agora: Date
  /** Preço para o impacto por venda; `precoConfirmado` diz se veio de fonte confirmada (revalidação comercial). */
  preco?: number | null
  precoConfirmado?: boolean
  /** Pedidos reais (P2.19) deste produto nos últimos 30 dias, com a base de cálculo da comissão. */
  pedidosRecentes?: { valorBase: number | null }[]
}

export interface Calculo {
  status: StatusDoAlerta
  nivel: NivelDoAlerta | null
  dataEfetiva: Date | null
  fonteDataEfetiva: 'CALCULADA_30_DIAS' | 'INFORMADA_PELA_TITULAR' | null
  diasRestantes: number | null
  impacto: {
    pontosPercentuais: number
    porVenda: number | null
    baseDoPorVenda: 'PRECO_CONFIRMADO' | 'PRECO_DE_REFERENCIA' | null
    /** Se os próximos 30 dias venderem como os últimos 30 (pedidos reais importados). */
    observado30Dias: { pedidos: number; valor: number } | null
  }
  mensagem: string
  avisos: string[]
}

const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pct = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`
const dataBr = (d: Date) => d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })

export function calcularAlerta(e: EntradaDoCalculo): Calculo {
  const diferenca = Math.round((e.taxaAtual - e.taxaNova) * 100) / 100
  const semImpacto = { pontosPercentuais: Math.max(0, diferenca), porVenda: null, baseDoPorVenda: null, observado30Dias: null }
  if (!(diferenca > 0)) {
    return { status: 'NAO_SE_APLICA', nivel: null, dataEfetiva: null, fonteDataEfetiva: null, diasRestantes: null, impacto: semImpacto, mensagem: `Não é redução (${pct(e.taxaAtual)} → ${pct(e.taxaNova)}): aumento de taxa vale na hora.`, avisos: [] }
  }
  if (e.produtoJaAdicionado === 'NAO') {
    return { status: 'NAO_SE_APLICA', nivel: null, dataEfetiva: null, fonteDataEfetiva: null, diasRestantes: null, impacto: semImpacto, mensagem: `Você ainda não adicionou este produto: a janela de 30 dias só protege quem já adicionou. Se adicionar agora, conte com ${pct(e.taxaNova)}.`, avisos: [] }
  }
  const avisos: string[] = []
  const informada = e.dataEfetivaInformada ?? null
  const dataEfetiva = informada ?? new Date(e.dataDoAnuncio.getTime() + REGRA_REDUCAO_DE_COMISSAO.dias * DIA)
  const fonteDataEfetiva = informada ? 'INFORMADA_PELA_TITULAR' as const : 'CALCULADA_30_DIAS' as const
  if (!informada && e.fonteDoAnuncio === 'OBSERVADA_PELO_PATRONO')
    avisos.push(`O Patrono viu a mudança em ${dataBr(e.dataDoAnuncio)}; se o vendedor anunciou antes, a taxa nova pode valer antes de ${dataBr(dataEfetiva)}. Confira a data no app.`)
  if (e.produtoJaAdicionado === 'NAO_CONFIRMADO')
    avisos.push('Não está confirmado que você já adicionou este produto. A janela de 30 dias só vale se já adicionou.')

  // Impacto: só com dado que existe.
  const porVenda = e.preco != null && e.preco > 0 ? Math.round(e.preco * diferenca) / 100 : null
  const base = (e.pedidosRecentes ?? []).filter((x) => x.valorBase != null && x.valorBase > 0)
  const observado30Dias = base.length ? { pedidos: base.length, valor: Math.round(base.reduce((s, x) => s + x.valorBase! * diferenca, 0)) / 100 } : null
  if (porVenda != null && !e.precoConfirmado) avisos.push('Impacto por venda calculado com o preço de referência (não confirmado agora).')
  const impacto = { pontosPercentuais: diferenca, porVenda, baseDoPorVenda: porVenda == null ? null : e.precoConfirmado ? 'PRECO_CONFIRMADO' as const : 'PRECO_DE_REFERENCIA' as const, observado30Dias }

  const restante = dataEfetiva.getTime() - e.agora.getTime()
  if (restante <= 0) {
    return { status: 'EFETIVADO', nivel: null, dataEfetiva, fonteDataEfetiva, diasRestantes: 0, impacto, mensagem: `A comissão já é ${pct(e.taxaNova)} desde ${dataBr(dataEfetiva)} (antes ${pct(e.taxaAtual)}).`, avisos }
  }
  const dias = Math.ceil(restante / DIA)
  const nivel: NivelDoAlerta = dias <= 7 ? 'URGENTE' : dias <= 14 ? 'AVISO' : 'INFORMATIVO'
  const quanto = porVenda != null ? ` Cada venda depois disso rende ${reais(porVenda)} a menos.` : ''
  const mensagem = `Comissão vai cair de ${pct(e.taxaAtual)} para ${pct(e.taxaNova)} em ${dias} dia(s) (${dataBr(dataEfetiva)}).${quanto}${nivel !== 'INFORMATIVO' ? ' Priorize postar este produto antes da data.' : ''}`
  return { status: e.produtoJaAdicionado === 'SIM' ? 'ATIVO' : 'APLICABILIDADE_NAO_CONFIRMADA', nivel, dataEfetiva, fonteDataEfetiva, diasRestantes: dias, impacto, mensagem, avisos }
}

// ── Banco ─────────────────────────────────────────────────────────────────

const ABERTOS: StatusDoAlerta[] = ['ATIVO', 'APLICABILIDADE_NAO_CONFIRMADA']
type Evento = { em: string; tipo: string; detalhe?: string; status?: string; nivel?: string | null }
const historicoDe = (h: Prisma.JsonValue): Evento[] => (Array.isArray(h) ? (h as Evento[]) : [])

async function contexto(workspaceId: string, chaveProduto: string, candidatoId: string | null, agora: Date) {
  const [, externalId] = chaveProduto.split(':')
  const [vitrine, candidato, pedidos] = await Promise.all([
    chaveProduto.startsWith('tiktok-shop:') ? prisma.vitrineTikTokShop.findUnique({ where: { workspaceId_productId: { workspaceId, productId: externalId } }, select: { estado: true } }) : null,
    candidatoId ? prisma.candidatoDeProduto.findUnique({ where: { id: candidatoId }, select: { preco: true } }) : null,
    chaveProduto.startsWith('tiktok-shop:') ? prisma.pedidoAfiliadoTikTok.findMany({ where: { workspaceId, produtoIdExterno: externalId, estado: { not: 'CANCELADA' }, dataPedido: { gte: new Date(agora.getTime() - 30 * DIA) } }, select: { valorBase: true } }) : [],
  ])
  return { naVitrine: vitrine?.estado === 'CONFIRMADO_NA_VITRINE', preco: candidato?.preco ?? null, pedidos }
}

/**
 * Registra (ou reaproveita) o alerta de uma redução. Idempotente: a mesma redução (produto + taxa nova)
 * com alerta aberto não cria outro. Aumento de taxa não cria alerta.
 */
export async function registrarReducaoDeComissao(p: {
  workspaceId: string
  userId?: string | null
  candidatoId?: string | null
  chaveProduto: string
  nomeProduto: string
  taxaAtual: number
  taxaNova: number
  dataDoAnuncio: Date
  fonteDoAnuncio: 'INFORMADA_PELA_TITULAR' | 'OBSERVADA_PELO_PATRONO'
  dataEfetivaInformada?: Date | null
  produtoJaAdicionado?: JaAdicionado
  agora?: Date
}) {
  const agora = p.agora ?? new Date()
  if (!(p.taxaNova < p.taxaAtual)) return null
  const aberto = await prisma.alertaReducaoComissao.findFirst({ where: { workspaceId: p.workspaceId, chaveProduto: p.chaveProduto, taxaNova: p.taxaNova, status: { in: ABERTOS } } })
  if (aberto) return aberto
  const ctx = await contexto(p.workspaceId, p.chaveProduto, p.candidatoId ?? null, agora)
  const jaAdicionado: JaAdicionado = p.produtoJaAdicionado ?? (ctx.naVitrine ? 'SIM' : 'NAO_CONFIRMADO')
  const primeira = await prisma.historicoDadoDeProduto.findFirst({
    where: { workspaceId: p.workspaceId, chave: p.chaveProduto, campo: 'comissaoPercentual', valorNovo: String(p.taxaAtual) }, orderBy: { createdAt: 'asc' }, select: { createdAt: true },
  })
  const c = calcularAlerta({ ...p, produtoJaAdicionado: jaAdicionado, agora, preco: ctx.preco, precoConfirmado: false, pedidosRecentes: ctx.pedidos })
  const criado = await prisma.alertaReducaoComissao.upsert({
    where: { workspaceId_chaveProduto_dataDoAnuncio: { workspaceId: p.workspaceId, chaveProduto: p.chaveProduto, dataDoAnuncio: p.dataDoAnuncio } },
    update: {},
    create: {
      workspaceId: p.workspaceId, candidatoId: p.candidatoId ?? null, chaveProduto: p.chaveProduto, nomeProduto: p.nomeProduto.slice(0, 200),
      taxaAtual: p.taxaAtual, taxaNova: p.taxaNova, dataInicialDaTaxa: primeira?.createdAt ?? null, dataDoAnuncio: p.dataDoAnuncio, fonteDoAnuncio: p.fonteDoAnuncio,
      dataEfetiva: c.dataEfetiva, fonteDataEfetiva: c.fonteDataEfetiva, produtoJaAdicionado: jaAdicionado, status: c.status, nivel: c.nivel,
      historico: [{ em: agora.toISOString(), tipo: 'CRIADO', detalhe: c.mensagem, status: c.status, nivel: c.nivel }] as unknown as Prisma.InputJsonValue,
    },
  })
  await registrarAuditoria({ workspaceId: p.workspaceId, userId: p.userId ?? null, action: 'comissao.reducao_registrada', entityType: 'AlertaReducaoComissao', entityId: criado.id, metadata: { taxaAtual: p.taxaAtual, taxaNova: p.taxaNova, fonte: p.fonteDoAnuncio, status: c.status } })
  return criado
}

/**
 * Atualização automática (depois de cada enriquecimento e na reconciliação; a tela só lê): recalcula
 * contagem, nível e status dos alertas abertos; cada mudança de status/nível vai para o histórico.
 * `gravar: false` = SÓ LEITURA (a tela usa assim e
 * mostra o cálculo do momento); a gravação do status fica para quem escreve (registrar/corrigir/enriquecer)
 * e para a reconciliação (P2.31.1: leitura não grava).
 */
export async function atualizarAlertasDeComissao(workspaceId: string, agora = new Date(), opcoes: { gravar?: boolean } = {}) {
  const gravar = opcoes.gravar !== false
  const abertos = await prisma.alertaReducaoComissao.findMany({ where: { workspaceId, status: { in: ABERTOS } } })
  const saida = []
  for (const a of abertos) {
    const ctx = await contexto(workspaceId, a.chaveProduto, a.candidatoId, agora)
    const jaAdicionado = (a.produtoJaAdicionado === 'NAO_CONFIRMADO' && ctx.naVitrine ? 'SIM' : a.produtoJaAdicionado) as JaAdicionado
    const c = calcularAlerta({
      taxaAtual: a.taxaAtual, taxaNova: a.taxaNova, dataDoAnuncio: a.dataDoAnuncio, fonteDoAnuncio: a.fonteDoAnuncio as EntradaDoCalculo['fonteDoAnuncio'],
      dataEfetivaInformada: a.fonteDataEfetiva === 'INFORMADA_PELA_TITULAR' ? a.dataEfetiva : null, produtoJaAdicionado: jaAdicionado, agora, preco: ctx.preco, pedidosRecentes: ctx.pedidos,
    })
    if (gravar && (c.status !== a.status || c.nivel !== a.nivel || jaAdicionado !== a.produtoJaAdicionado)) {
      const h = [...historicoDe(a.historico), { em: agora.toISOString(), tipo: 'ATUALIZADO', detalhe: c.mensagem, status: c.status, nivel: c.nivel }]
      await prisma.alertaReducaoComissao.update({ where: { id: a.id }, data: { status: c.status, nivel: c.nivel, produtoJaAdicionado: jaAdicionado, historico: h as unknown as Prisma.InputJsonValue } })
    }
    saida.push({ id: a.id, produtoJaAdicionado: jaAdicionado, ...c })
  }
  return saida
}

/** A titular corrige: data que o app mostra, se já adicionou, ou cancela (o vendedor desistiu da redução). */
export async function corrigirAlerta(p: { workspaceId: string; userId: string | null; id: string; dataEfetiva?: Date | null; produtoJaAdicionado?: JaAdicionado; cancelar?: boolean; agora?: Date }) {
  const agora = p.agora ?? new Date()
  const a = await prisma.alertaReducaoComissao.findFirst({ where: { id: p.id, workspaceId: p.workspaceId } })
  if (!a) return null
  const ev: Evento[] = []
  const dados: Prisma.AlertaReducaoComissaoUpdateInput = {}
  if (p.cancelar) { dados.status = 'CANCELADO'; dados.nivel = null; ev.push({ em: agora.toISOString(), tipo: 'CANCELADO_PELA_TITULAR', status: 'CANCELADO' }) }
  if (p.dataEfetiva) { dados.dataEfetiva = p.dataEfetiva; dados.fonteDataEfetiva = 'INFORMADA_PELA_TITULAR'; ev.push({ em: agora.toISOString(), tipo: 'DATA_INFORMADA', detalhe: p.dataEfetiva.toISOString() }) }
  if (p.produtoJaAdicionado) { dados.produtoJaAdicionado = p.produtoJaAdicionado; ev.push({ em: agora.toISOString(), tipo: 'ADICIONADO_INFORMADO', detalhe: p.produtoJaAdicionado }) }
  dados.historico = [...historicoDe(a.historico), ...ev] as unknown as Prisma.InputJsonValue
  await prisma.alertaReducaoComissao.update({ where: { id: a.id }, data: dados })
  await registrarAuditoria({ workspaceId: p.workspaceId, userId: p.userId, action: 'comissao.alerta_corrigido', entityType: 'AlertaReducaoComissao', entityId: a.id, metadata: { eventos: ev.map((x) => x.tipo) } })
  if (!p.cancelar) await atualizarAlertasDeComissao(p.workspaceId, agora)
  return prisma.alertaReducaoComissao.findUnique({ where: { id: a.id } })
}
