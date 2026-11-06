/**
 * P2.53 — CALCULADORA DE RENTABILIDADE, COMPARADOR DE FORNECEDORES E SIMULADOR DE ESCALA
 * (a "Calculadora de Lucro" de 10 blocos da proposta do Lovable, reimplementada aqui, sem copiar código).
 *
 * É SIMULAÇÃO: nada daqui entra em resultado, painel ou Learning Engine. Serve à fase de VENDAS PRÓPRIAS
 * (e a comparar cenários). Regras:
 *  - nenhuma alíquota é presumida pelo código: impostos e taxas são informados por quem simula (o regime
 *    tributário e as alíquotas vigentes são decisão contábil, não do Patrono);
 *  - valor ausente obrigatório = erro explícito, nunca zero silencioso;
 *  - contas em centavos inteiros (lib/financeiro.ts → centavos).
 * Limitação declarada: o ICMS de importação é calculado "por dentro" sobre (base aduaneira + II + despesas);
 * IPI, PIS/COFINS-importação e regimes especiais entram como "outros tributos de importação (%)".
 */
import { centavos } from './financeiro'

export interface EntradaDeRentabilidade {
  /** 1. Custo do produto na moeda do fornecedor e a cotação para BRL (1 quando já em reais). */
  custoProduto: number
  cotacao?: number
  /** 2. Frete internacional (mesma moeda do produto). */
  freteInternacional?: number
  /** 3. Frete nacional (BRL); se pago pelo comprador, não entra no custo. */
  freteNacional?: number
  fretePagoPeloComprador?: boolean
  /** 4. Importação (% em fração: 0.6 = 60%). Cada um só entra se informado. */
  importacao?: { impostoDeImportacao?: number; icms?: number; outrosTributos?: number; despachoBRL?: number } | null
  /** 5. Tributo sobre a venda (% do preço, conforme o regime informado). */
  tributoSobreVenda: number
  /** 6. Taxas da plataforma e do meio de pagamento (% do preço). */
  taxaPlataforma: number
  taxaPagamento?: number
  /** 7. Marketing: % do preço OU custo por venda (CPA, BRL). */
  marketing?: { tipo: 'PERCENTUAL'; valor: number } | { tipo: 'CPA'; valorBRL: number } | null
  /** 8. Perdas e devoluções (% do preço). */
  perdas?: number
  /** 9. Custo logístico por unidade (BRL: embalagem, armazenagem, etiqueta). */
  logisticaBRL?: number
  /** 10. Preço de venda (BRL). */
  preco: number
}

export type FaixaDeMargem = 'VERMELHO' | 'AMARELO' | 'VERDE'

export interface ResultadoDeRentabilidade {
  simulacao: true
  /** Custo que NÃO depende do preço (produto, fretes, importação, logística, CPA). */
  custoFixoUnitario: number
  /** Soma das frações sobre o preço (tributo, taxas, marketing %, perdas). */
  percentualSobrePreco: number
  /** Custo total na venda ao preço informado. */
  custoTotal: number
  lucroUnitario: number
  /** Margem sobre o preço (fração). */
  margem: number
  faixa: FaixaDeMargem
  prejuizo: boolean
  /** Preço mínimo sem prejuízo (null quando as frações somam 100% ou mais: não há preço que pague). */
  precoDeEquilibrio: number | null
  /** Faixa do controle deslizante: do custo final estimado até 3×. */
  faixaDoPreco: { minimo: number; maximo: number }
  detalhes: Array<{ bloco: string; valor: number }>
}

export class EntradaInvalida extends Error {}

const r2 = (n: number) => centavos(n) / 100
function exigir(nome: string, v: number | undefined, { fracao = false } = {}): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new EntradaInvalida(`${nome}: informe um valor (não negativo).`)
  if (fracao && v >= 1) throw new EntradaInvalida(`${nome}: use fração (0,12 = 12%).`)
  return v
}
const opcional = (nome: string, v: number | undefined, fracao = false) => (v === undefined ? 0 : exigir(nome, v, { fracao }))

/** Faixas da margem: vermelho < 15%, amarelo 15–30%, verde > 30% (regra da proposta). */
export function faixaDaMargem(margem: number): FaixaDeMargem {
  if (margem < 0.15) return 'VERMELHO'
  if (margem <= 0.3) return 'AMARELO'
  return 'VERDE'
}

/** FUNÇÃO PURA. */
export function calcularRentabilidade(e: EntradaDeRentabilidade): ResultadoDeRentabilidade {
  const cotacao = e.cotacao === undefined ? 1 : exigir('Cotação', e.cotacao)
  if (cotacao <= 0) throw new EntradaInvalida('Cotação: precisa ser maior que zero.')
  const produto = exigir('Custo do produto', e.custoProduto) * cotacao
  const freteInt = opcional('Frete internacional', e.freteInternacional) * cotacao
  const freteNac = e.fretePagoPeloComprador ? 0 : opcional('Frete nacional', e.freteNacional)
  const preco = exigir('Preço de venda', e.preco)
  if (preco <= 0) throw new EntradaInvalida('Preço de venda: precisa ser maior que zero.')

  let importacao = 0
  if (e.importacao) {
    const base = produto + freteInt
    const ii = base * opcional('Imposto de importação', e.importacao.impostoDeImportacao, true)
    const outros = base * opcional('Outros tributos de importação', e.importacao.outrosTributos, true)
    const despacho = opcional('Taxa de despacho', e.importacao.despachoBRL)
    const aliqIcms = opcional('ICMS de importação', e.importacao.icms, true)
    const icms = aliqIcms > 0 ? ((base + ii + outros + despacho) * aliqIcms) / (1 - aliqIcms) : 0
    importacao = ii + outros + despacho + icms
  }
  const logistica = opcional('Custo logístico', e.logisticaBRL)
  const cpa = e.marketing?.tipo === 'CPA' ? exigir('Marketing (CPA)', e.marketing.valorBRL) : 0
  const custoFixoUnitario = produto + freteInt + freteNac + importacao + logistica + cpa

  const percentualSobrePreco =
    exigir('Tributo sobre a venda', e.tributoSobreVenda, { fracao: true }) +
    exigir('Taxa da plataforma', e.taxaPlataforma, { fracao: true }) +
    opcional('Taxa de pagamento', e.taxaPagamento, true) +
    (e.marketing?.tipo === 'PERCENTUAL' ? exigir('Marketing (%)', e.marketing.valor, { fracao: true }) : 0) +
    opcional('Perdas e devoluções', e.perdas, true)

  const custoTotal = custoFixoUnitario + preco * percentualSobrePreco
  const lucro = preco - custoTotal
  const margem = lucro / preco
  const precoDeEquilibrio = percentualSobrePreco < 1 ? r2(custoFixoUnitario / (1 - percentualSobrePreco)) : null
  const custoFinal = r2(custoFixoUnitario)
  return {
    simulacao: true,
    custoFixoUnitario: custoFinal,
    percentualSobrePreco: Math.round(percentualSobrePreco * 10000) / 10000,
    custoTotal: r2(custoTotal),
    lucroUnitario: r2(lucro),
    margem: Math.round(margem * 10000) / 10000,
    faixa: faixaDaMargem(margem),
    prejuizo: lucro < 0,
    precoDeEquilibrio,
    faixaDoPreco: { minimo: custoFinal, maximo: r2(custoFinal * 3) },
    detalhes: [
      { bloco: 'Produto', valor: r2(produto) },
      { bloco: 'Frete internacional', valor: r2(freteInt) },
      { bloco: 'Frete nacional', valor: r2(freteNac) },
      { bloco: 'Importação', valor: r2(importacao) },
      { bloco: 'Logística', valor: r2(logistica) },
      { bloco: 'Marketing (CPA)', valor: r2(cpa) },
      { bloco: 'Sobre o preço (tributo, taxas, marketing %, perdas)', valor: r2(preco * percentualSobrePreco) },
    ],
  }
}

export interface Fornecedor { nome: string; custoProduto: number; freteInternacional?: number; cotacao?: number }

/** FUNÇÃO PURA. Mesmo cenário, fornecedores diferentes; o melhor é o de menor custo total (empate: o primeiro). */
export function compararFornecedores(base: Omit<EntradaDeRentabilidade, 'custoProduto' | 'freteInternacional' | 'cotacao'>, fornecedores: Fornecedor[]) {
  if (!fornecedores.length) throw new EntradaInvalida('Informe pelo menos um fornecedor.')
  const linhas = fornecedores.map((f) => ({ nome: f.nome, ...calcularRentabilidade({ ...base, custoProduto: f.custoProduto, freteInternacional: f.freteInternacional, cotacao: f.cotacao }) }))
  const melhor = linhas.reduce((a, b) => (b.custoTotal < a.custoTotal ? b : a))
  return { simulacao: true as const, melhor: melhor.nome, linhas }
}

/** FUNÇÃO PURA. Lucro de N vendas com custo fixo do período (BRL) e o ponto em que se paga. */
export function simularEscala(r: ResultadoDeRentabilidade, custoFixoDoPeriodoBRL: number, quantidades: number[] = [10, 50, 100, 500, 1000, 5000]) {
  const fixo = exigir('Custo fixo do período', custoFixoDoPeriodoBRL)
  const pontos = quantidades.map((n) => ({ vendas: n, lucro: r2(n * r.lucroUnitario - fixo) }))
  const vendasParaPagar = r.lucroUnitario > 0 ? Math.ceil(fixo / r.lucroUnitario) : null
  return { simulacao: true as const, pontos, vendasParaPagar }
}
