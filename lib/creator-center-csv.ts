/**
 * P2.19 — Leitura do relatório de pedidos de afiliado do Creator Center (TikTok Shop): CSV ou XLSX.
 *
 * PURO (sem banco): lê o arquivo, reconhece as colunas por nome (PT e EN), normaliza números,
 * datas e o estado da comissão. Nada é inventado:
 * - coluna que não reconhecemos fica em `colunasIgnoradas` (aparece para a titular);
 * - sem as colunas obrigatórias, o arquivo inteiro é recusado (nada é gravado);
 * - status que não reconhecemos vira ESTIMADA (nunca conta como receita) e gera aviso;
 * - "liquidado" sem o valor real da comissão NÃO vira LIQUIDADA (fica NAO_LIQUIDADA, com aviso).
 *
 * O formato exato do arquivo do Brasil ainda não foi conferido com um export real: os nomes das
 * colunas abaixo seguem os relatórios do Creator Center/Seller Center. Coluna nova = acrescentar
 * o apelido em APELIDOS (ou a titular escolhe a coluna no mapeamento manual), nunca adivinhar.
 * Colunas não reconhecidas são GUARDADAS em cada pedido (colunasExtras) e as que parecem relevantes geram aviso.
 */

import { dinheiro } from './financeiro'

export const ESTADOS_DA_COMISSAO = ['ESTIMADA', 'NAO_LIQUIDADA', 'LIQUIDADA', 'CANCELADA'] as const
export type EstadoDaComissao = (typeof ESTADOS_DA_COMISSAO)[number]

/** Ordem de avanço. CANCELADA pode acontecer a qualquer momento (reembolso depois da liquidação). */
export const ORDEM_DO_ESTADO: Record<EstadoDaComissao, number> = { ESTIMADA: 0, NAO_LIQUIDADA: 1, LIQUIDADA: 2, CANCELADA: 3 }

export const DESCRICAO_DO_ESTADO: Record<EstadoDaComissao, string> = {
  ESTIMADA: 'Estimada — pedido pago, ainda pode ser cancelado. Não é receita.',
  NAO_LIQUIDADA: 'Não liquidada — pedido concluído, aguardando a liquidação (3, 7 ou 15 dias). Ainda não é receita.',
  LIQUIDADA: 'Liquidada — valor real da comissão. Receita confirmada.',
  CANCELADA: 'Cancelada ou reembolsada — comissão zero.',
}

export type Campo =
  | 'pedidoId' | 'skuId' | 'produtoIdExterno' | 'produtoNome' | 'lojaNome' | 'quantidade' | 'valorBase' | 'taxaComissao'
  | 'comissaoEstimada' | 'comissaoLiquidada' | 'statusPedido' | 'statusLiquidacao' | 'dataPedido' | 'dataLiquidacao'
  | 'tipoConteudo' | 'conteudoIdExterno'

/** Apelidos normalizados (minúsculas, sem acento, só letras/números/espaço). */
export const APELIDOS: Record<Campo, string[]> = {
  pedidoId: ['id do pedido', 'order id', 'id pedido', 'numero do pedido', 'n do pedido', 'pedido'],
  skuId: ['id do sku', 'sku id', 'sku'],
  produtoIdExterno: ['id do produto', 'product id'],
  produtoNome: ['nome do produto', 'product name', 'produto'],
  lojaNome: ['nome da loja', 'shop name', 'loja', 'vendedor'],
  // P2.29.1: os apelidos marcados "BR real" vieram do export real do Creator Center Brasil (affiliate_orders_*.xlsx, 48 colunas).
  quantidade: ['quantidade', 'quantity', 'qtd', 'itens vendidos' /* BR real */],
  valorBase: ['base de calculo da comissao', 'base da comissao', 'commission base', 'base de comissao estimada' /* BR real */, 'valor do pedido', 'order amount', 'payment amount', 'valor pago', 'gmv'],
  taxaComissao: ['taxa de comissao', 'commission rate', 'percentual de comissao', 'padrao' /* BR real: taxa da comissão padrão, ex. "9.5%" */],
  // BR real: o export separa a comissão em componentes (padrão, anúncios da loja, bônus, participação). Aqui entra a
  // PADRÃO; os outros componentes geram aviso quando têm valor (somar ou não = Gate B, com pedido elegível real).
  comissaoEstimada: ['comissao estimada', 'estimated commission', 'comissao prevista', 'est commission', 'comissao padrao estimada' /* BR real */],
  // BR real: "Valor total final recebido" = o que a titular recebe de fato (todos os componentes, depois de impostos e
  // repasses). Semântica a confirmar no Gate B (pedido elegível liquidado).
  comissaoLiquidada: ['comissao real', 'comissao liquidada', 'actual commission', 'settled commission', 'comissao efetiva', 'valor total final recebido' /* BR real */],
  statusPedido: ['status do pedido', 'order status', 'status'],
  statusLiquidacao: ['status da liquidacao', 'settlement status', 'status da comissao', 'commission status', 'status de liquidacao do pedido' /* BR real */],
  dataPedido: ['data do pedido', 'order created time', 'horario de criacao do pedido', 'created time', 'order date', 'data de criacao'],
  dataLiquidacao: ['data de liquidacao', 'data da liquidacao', 'order settled time', 'settlement time', 'settled time', 'data de liquidacao da comissao' /* BR real */],
  tipoConteudo: ['tipo de conteudo', 'content type', 'origem do pedido'],
  conteudoIdExterno: ['id do conteudo', 'content id', 'id do video', 'video id'],
}

export const normalizarCabecalho = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Lê CSV (vírgula, ponto e vírgula ou tab; aspas com "" escapado; quebra de linha dentro de aspas; BOM). */
export function lerCsv(texto: string): string[][] {
  const t = texto.replace(/^﻿/, '')
  const primeira = t.split(/\r?\n/, 1)[0] ?? ''
  const conta = (c: string) => primeira.split(c).length - 1
  const sep = [';', '\t', ','].reduce((m, c) => (conta(c) > conta(m) ? c : m), ',')
  const linhas: string[][] = []
  let linha: string[] = []
  let campo = ''
  let aspas = false
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (aspas) {
      if (ch === '"') {
        if (t[i + 1] === '"') { campo += '"'; i++ } else aspas = false
      } else campo += ch
    } else if (ch === '"' && campo === '') aspas = true
    else if (ch === sep) { linha.push(campo); campo = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++
      linha.push(campo); campo = ''
      if (linha.some((c) => c.trim() !== '')) linhas.push(linha)
      linha = []
    } else campo += ch
  }
  linha.push(campo)
  if (linha.some((c) => c.trim() !== '')) linhas.push(linha)
  return linhas
}

/** Versão do parser gravada em cada importação (mudou a regra de leitura → mude a versão). */
export const VERSAO_DO_PARSER = 'creator-center@3' // P2.29.1: formato real BR (Gate A)

type Valor = string | number | undefined | null

/** "R$ 1.234,56" | "1,234.56" | "12,5%" | "1234.5" → número. Número (XLSX) passa direto. Vazio, "-" ou "--" → null (não medido, nunca zero). */
export function lerNumero(v: Valor): number | null {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  let s = String(v).replace(/R\$|BRL|%|\s/gi, '').trim()
  if (!s || /^-+$/.test(s)) return null
  const neg = /^\(.*\)$/.test(s) || s.startsWith('-')
  s = s.replace(/[()]/g, '').replace(/^-/, '')
  const ultVirg = s.lastIndexOf(','), ultPonto = s.lastIndexOf('.')
  if (ultVirg >= 0 && ultPonto >= 0) s = ultVirg > ultPonto ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  else if (ultVirg >= 0) s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '')
  const n = Number(s)
  return Number.isFinite(n) ? (neg ? -n : n) : null
}

/** Taxa: "12%" ou "12" → 0,12; "0.12" → 0,12. */
export function lerTaxa(v: Valor): number | null {
  const n = lerNumero(v)
  if (n == null) return null
  return n > 1 ? n / 100 : n
}

/**
 * Datas sem fuso são do Brasil (America/Sao_Paulo, -03:00). Aceita ISO, "AAAA-MM-DD HH:MM[:SS]",
 * "DD/MM/AAAA [HH:MM[:SS]]" e o número serial do Excel (XLSX: dias desde 30/12/1899, hora local).
 */
export function lerData(v: Valor): Date | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') {
    if (v < 20_000 || v > 80_000) return null
    const ms = Math.round((v - 25_569) * 86_400_000) // 25569 = 01/01/1970
    return new Date(ms + 3 * 3_600_000) // a hora do Excel é a local do Brasil (-03:00)
  }
  const s = String(v).trim()
  if (!s || /^-+$/.test(s)) return null
  let m = s.match(/^(\d{4})[-/](\d{2})[-/](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?(Z|[+-]\d{2}:?\d{2})?$/)
  if (m) {
    const fuso = m[7] ? (m[7] === 'Z' ? 'Z' : m[7].replace(/^([+-]\d{2})(\d{2})$/, '$1:$2')) : '-03:00'
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4] ?? '00'}:${m[5] ?? '00'}:${m[6] ?? '00'}${fuso}`)
    return Number.isNaN(d.getTime()) ? null : d
  }
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/)
  if (m) {
    const d = new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4] ?? '00'}:${m[5] ?? '00'}:${m[6] ?? '00'}-03:00`)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

/**
 * Estado da comissão a partir do status do arquivo. O status da liquidação/comissão (quando a
 * coluna existe) vale mais que o status do pedido. Desconhecido → ESTIMADA (fail-closed).
 */
export function classificarEstado(p: { statusPedido?: string | null; statusLiquidacao?: string | null; comissaoLiquidada: number | null }): { estado: EstadoDaComissao; reconhecido: boolean; aviso?: string } {
  const n = (s?: string | null) => normalizarCabecalho(s ?? '')
  const textos = [n(p.statusLiquidacao), n(p.statusPedido)].filter(Boolean)
  const tem = (re: RegExp) => textos.some((t) => re.test(t))
  if (tem(/cancel|reembols|refund|devolvid|estornad|returned/)) return { estado: 'CANCELADA', reconhecido: true }
  // P2.29.1 — BR real: "Inelegível" = o pedido não gera comissão. Nunca é receita nem previsão.
  if (tem(/\binelegivel\b|\bineligible\b/)) return { estado: 'CANCELADA', reconhecido: true }
  if (tem(/\b(nao|not|un)\s?(liquidad|settled)|unsettled|aguardando liquida|pending settlement|a liquidar|em liquidacao/))
    return { estado: 'NAO_LIQUIDADA', reconhecido: true }
  if (tem(/liquidad|settled|creditad/)) {
    if (p.comissaoLiquidada == null) return { estado: 'NAO_LIQUIDADA', reconhecido: true, aviso: 'marcado como liquidado, mas sem o valor real da comissão: fica como não liquidada' }
    return { estado: 'LIQUIDADA', reconhecido: true }
  }
  if (tem(/conclu|complet|entregue|delivered|finaliz/)) return { estado: 'NAO_LIQUIDADA', reconhecido: true }
  if (tem(/pago|paid|pendente|pending|enviad|shipped|process|aguardando|a enviar|to ship|em transito|in transit|confirmad/)) return { estado: 'ESTIMADA', reconhecido: true }
  return { estado: 'ESTIMADA', reconhecido: false, aviso: textos.length ? `status não reconhecido ("${p.statusLiquidacao || p.statusPedido}"): tratado como estimada` : 'sem status: tratado como estimada' }
}

export function lerTipoDeConteudo(v?: string | null): string | null {
  const t = normalizarCabecalho(v ?? '')
  if (!t) return null
  if (/live/.test(t)) return 'LIVE'
  if (/video/.test(t)) return 'VIDEO'
  if (/vitrine|showcase|vitrin|product card|cartao/.test(t)) return 'VITRINE'
  return 'OUTRO'
}

export interface LinhaDoPedido {
  linha: number
  chave: string
  pedidoId: string
  skuId: string | null
  produtoIdExterno: string | null
  produtoNome: string
  lojaNome: string | null
  quantidade: number | null
  valorBase: number | null
  taxaComissao: number | null
  tipoConteudo: string | null
  conteudoIdExterno: string | null
  estado: EstadoDaComissao
  statusOriginal: string | null
  comissaoEstimada: number | null
  comissaoLiquidada: number | null
  dataPedido: Date | null
  dataLiquidacao: Date | null
  /** Colunas que o Patrono ainda não reconhece, com o valor desta linha (nada se perde). */
  colunasExtras: Record<string, string> | null
}

export interface ArquivoLido {
  ok: boolean
  /** motivo quando ok = false (nada deve ser gravado) */
  motivo?: string
  versaoDoParser: string
  cabecalho: string[]
  mapeamento: Partial<Record<Campo, string>>
  colunasIgnoradas: string[]
  /** Colunas não reconhecidas que parecem ter dado financeiro/de status — a titular é avisada. */
  colunasPossivelmenteRelevantes: string[]
  linhas: LinhaDoPedido[]
  rejeitadas: { linha: number; motivo: string }[]
  avisos: { linha: number; aviso: string }[]
}

/** Coluna não reconhecida cujo nome sugere dado que importa: avisar, nunca ignorar em silêncio. */
const PARECE_RELEVANTE = /comiss|commission|valor|amount|price|preco|receita|revenue|liquid|settle|reembols|refund|status|data|date|time|pedido|order|id\b/

export function mapearColunas(cabecalho: string[], manual: Partial<Record<Campo, string>> = {}): { mapeamento: Partial<Record<Campo, string>>; indice: Partial<Record<Campo, number>>; ignoradas: string[]; erros: string[] } {
  const norm = cabecalho.map((h) => normalizarCabecalho(String(h)))
  const indice: Partial<Record<Campo, number>> = {}
  const usados = new Set<number>()
  const erros: string[] = []
  // 1) Mapeamento manual (a titular escolheu a coluna) vale mais que qualquer apelido.
  for (const [campo, coluna] of Object.entries(manual) as [Campo, string][]) {
    if (!(campo in APELIDOS)) { erros.push(`campo desconhecido no mapeamento: ${campo}`); continue }
    const i = norm.findIndex((h, k) => h === normalizarCabecalho(coluna) && !usados.has(k))
    if (i < 0) { erros.push(`a coluna "${coluna}" (para ${campo}) não existe no arquivo`); continue }
    indice[campo] = i; usados.add(i)
  }
  // 2) Apelidos, correspondência exata, na ordem de prioridade.
  for (const campo of Object.keys(APELIDOS) as Campo[]) {
    if (indice[campo] != null) continue
    for (const apelido of APELIDOS[campo]) {
      const i = norm.findIndex((h, k) => h === apelido && !usados.has(k))
      if (i >= 0) { indice[campo] = i; usados.add(i); break }
    }
  }
  const mapeamento: Partial<Record<Campo, string>> = {}
  for (const [c, i] of Object.entries(indice)) mapeamento[c as Campo] = String(cabecalho[i as number])
  const ignoradas = cabecalho.map(String).filter((h, k) => !usados.has(k) && h.trim() !== '')
  return { mapeamento, indice, ignoradas, erros }
}

/** P2.28: das colunas que o Patrono não reconhece, as que parecem importantes (comissão, pedido, status…). */
export function colunasRelevantesNaoReconhecidas(ignoradas: string[]): string[] {
  return ignoradas.filter((h) => PARECE_RELEVANTE.test(normalizarCabecalho(h)) && !COLUNAS_BR_CONHECIDAS.has(normalizarCabecalho(h)))
}

/**
 * P2.29.1 — colunas do export real BR que o Patrono CONHECE e, por enquanto, só guarda (colunasExtras): não disparam
 * o aviso de "coluna desconhecida". Os componentes financeiros abaixo geram aviso POR LINHA quando têm valor.
 */
export const COMPONENTES_FINANCEIROS_BR = [
  'comissao estimada de anuncios da loja', 'bonus estimado', 'bonus estimado da agencia parceira', 'estimativa da participacao na receita',
  'comissao padrao', 'comissao de anuncios da loja', 'bonus', 'bonus da agencia parceira', 'compartilhado com parceiro', 'itens reembolsados',
]
const COLUNAS_BR_CONHECIDAS = new Set([
  ...COMPONENTES_FINANCEIROS_BR, 'preco', 'codigo da loja', 'agencia parceira', 'agencia', 'moeda', 'tipo de pedido', 'indireta', 'tipo de comissao', 'carrossel',
  'anuncios da loja', 'bonus do tiktok', 'bonus do parceiro', 'participacao na receita', 'gmv', 'iva estimado', 'isr estimado', 'est cedulartax', 'pit estimado',
  'base de comissao real', 'imposto isr', 'imposto iva', 'cedular tax', 'imposto pit',
])
/** Moeda: só BRL é importada (o export BR traz a coluna "Moeda"). */
const MOEDAS = ['moeda', 'currency']

export function lerArquivoDoCreatorCenter(texto: string, opcoes: { mapeamentoManual?: Partial<Record<Campo, string>> } = {}): ArquivoLido {
  return lerTabelaDoCreatorCenter(lerCsv(texto), opcoes)
}

/** A mesma leitura para CSV (texto) e XLSX (células texto ou número). */
export function lerTabelaDoCreatorCenter(tabela: (string | number)[][], opcoes: { mapeamentoManual?: Partial<Record<Campo, string>> } = {}): ArquivoLido {
  const cabecalho = (tabela[0] ?? []).map((h) => String(h).trim())
  const base = { versaoDoParser: VERSAO_DO_PARSER, cabecalho, colunasPossivelmenteRelevantes: [] as string[] }
  const vazio = (motivo: string): ArquivoLido => ({ ok: false, motivo, ...base, mapeamento: {}, colunasIgnoradas: [], linhas: [], rejeitadas: [], avisos: [] })
  if (tabela.length < 2) return vazio(tabela.length ? 'O arquivo só tem o cabeçalho: nenhuma linha de pedido.' : 'O arquivo está vazio.')
  const { mapeamento, indice, ignoradas, erros } = mapearColunas(cabecalho, opcoes.mapeamentoManual)
  const relevantes = colunasRelevantesNaoReconhecidas(ignoradas)
  if (erros.length) return { ...vazio(`Mapeamento inválido: ${erros.join('; ')}. Nada foi importado.`), mapeamento, colunasIgnoradas: ignoradas, colunasPossivelmenteRelevantes: relevantes }
  const faltam: string[] = []
  if (indice.pedidoId == null) faltam.push('ID do pedido')
  if (indice.produtoNome == null && indice.produtoIdExterno == null) faltam.push('nome ou ID do produto')
  if (indice.comissaoEstimada == null && indice.comissaoLiquidada == null) faltam.push('comissão estimada ou comissão real')
  if (faltam.length) return { ...vazio(`Colunas obrigatórias não encontradas: ${faltam.join(', ')}. Nada foi importado.`), mapeamento, colunasIgnoradas: ignoradas, colunasPossivelmenteRelevantes: relevantes }

  const indicesIgnorados = cabecalho.map((h, k) => k).filter((k) => !Object.values(indice).includes(k) && cabecalho[k] !== '')
  const linhas: LinhaDoPedido[] = []
  const rejeitadas: ArquivoLido['rejeitadas'] = []
  const avisos: ArquivoLido['avisos'] = relevantes.map((h) => ({ linha: 1, aviso: `coluna "${h}" não reconhecida pelo Patrono: o valor foi guardado em cada pedido, mas ainda não é usado` }))
  const vistas = new Map<string, number>()
  const normal = cabecalho.map((h) => normalizarCabecalho(h))
  const idxMoeda = normal.findIndex((h) => MOEDAS.includes(h))
  const componentes = normal.map((h, k) => [h, k] as const).filter(([h]) => COMPONENTES_FINANCEIROS_BR.includes(h)).map(([, k]) => k)
  for (let r = 1; r < tabela.length; r++) {
    const nLinha = r + 1
    const bruto = (c: Campo) => (indice[c] == null ? null : tabela[r][indice[c]!] ?? null)
    const cel = (c: Campo) => { const v = bruto(c); if (v == null) return null; const s = String(v).trim(); return s || null }
    const id = (c: Campo) => cel(c)?.replace(/^'+/, '') ?? null
    const pedidoId = id('pedidoId')
    if (!pedidoId) { rejeitadas.push({ linha: nLinha, motivo: 'sem ID do pedido' }); continue }
    const produtoIdExterno = id('produtoIdExterno')
    const produtoNome = cel('produtoNome') ?? (produtoIdExterno ? `Produto ${produtoIdExterno}` : null)
    if (!produtoNome) { rejeitadas.push({ linha: nLinha, motivo: 'sem produto' }); continue }
    const skuId = id('skuId')
    // P2.29.1: o Patrono só soma reais. Outra moeda → a linha não entra (nunca converte nem mistura).
    const moeda = idxMoeda >= 0 ? String(tabela[r][idxMoeda] ?? '').trim().toUpperCase() : ''
    if (moeda && moeda !== 'BRL') { rejeitadas.push({ linha: nLinha, motivo: `moeda ${moeda}: o Patrono só importa valores em reais (BRL)` }); continue }
    for (const k of componentes) {
      const v = lerNumero(tabela[r][k] ?? null)
      if (v != null && v !== 0) avisos.push({ linha: nLinha, aviso: `"${cabecalho[k]}" = ${String(tabela[r][k])}: valor guardado, ainda não somado à comissão (conferência com o primeiro pedido elegível)` })
    }
    // P2.50 (Codex 19): dinheiro entra com 2 casas.
    const comissaoEstimada = dinheiro(lerNumero(bruto('comissaoEstimada')))
    let comissaoLiquidada = dinheiro(lerNumero(bruto('comissaoLiquidada')))
    const statusPedido = cel('statusPedido'), statusLiquidacao = cel('statusLiquidacao')
    const cls = classificarEstado({ statusPedido, statusLiquidacao, comissaoLiquidada })
    if (cls.aviso) avisos.push({ linha: nLinha, aviso: cls.aviso })
    if (cls.estado === 'CANCELADA') comissaoLiquidada = 0
    if (cls.estado !== 'LIQUIDADA' && cls.estado !== 'CANCELADA') comissaoLiquidada = null
    if (comissaoEstimada == null && comissaoLiquidada == null && cls.estado !== 'CANCELADA') { rejeitadas.push({ linha: nLinha, motivo: 'sem valor de comissão' }); continue }
    const chave = `${pedidoId}:${skuId ?? produtoIdExterno ?? normalizarCabecalho(produtoNome)}`
    if (vistas.has(chave)) {
      rejeitadas.push({ linha: nLinha, motivo: `repetida no mesmo arquivo (igual à linha ${vistas.get(chave)})` })
      continue
    }
    vistas.set(chave, nLinha)
    const extras: Record<string, string> = {}
    for (const k of indicesIgnorados) { const v = tabela[r][k]; if (v != null && String(v).trim() !== '') extras[cabecalho[k]] = String(v) }
    const q = lerNumero(bruto('quantidade'))
    linhas.push({
      linha: nLinha, chave, pedidoId, skuId, produtoIdExterno, produtoNome,
      lojaNome: cel('lojaNome'),
      quantidade: q == null ? null : Math.round(q),
      valorBase: dinheiro(lerNumero(bruto('valorBase'))),
      taxaComissao: lerTaxa(bruto('taxaComissao')),
      tipoConteudo: lerTipoDeConteudo(cel('tipoConteudo')),
      conteudoIdExterno: id('conteudoIdExterno'),
      estado: cls.estado,
      statusOriginal: [statusPedido, statusLiquidacao].filter(Boolean).join(' / ') || null,
      comissaoEstimada, comissaoLiquidada,
      dataPedido: lerData(bruto('dataPedido')),
      dataLiquidacao: cls.estado === 'LIQUIDADA' ? lerData(bruto('dataLiquidacao')) : null,
      colunasExtras: Object.keys(extras).length ? extras : null,
    })
  }
  return { ok: true, ...base, colunasPossivelmenteRelevantes: relevantes, mapeamento, colunasIgnoradas: ignoradas, linhas, rejeitadas, avisos }
}
