/**
 * P1.9.1 — O preço que a legenda pode afirmar.
 *
 * ── O BUG QUE ESTE ARQUIVO FECHA ────────────────────────────────────────
 * As cinco peças da P1.8 diziam "R$ 299,90 (consultado em 24/09/2026)".
 * Ninguém consultou preço em 24/09: essa é a data em que a peça foi GERADA.
 * O registro do produto não era tocado desde maio. A causa estava em
 * `lib/conteudo-gratuito.ts`: `(produto.atualizadoEm ?? new Date())`.
 * Faltando a data, ele escrevia a de hoje.
 *
 * ── A REGRA ─────────────────────────────────────────────────────────────
 * 1. A data vem SÓ de uma verificação real do preço. Hoje o único evento
 *    que verifica é a sincronização com a origem (`Produto.sincronizadoEm`).
 *    `updatedAt` não serve: qualquer edição do cadastro o move.
 * 2. Sem data, a legenda não diz "consultado em". Diz "confira o preço atual".
 * 3. Data mais velha que o prazo: o preço não aparece. `PRECO_DESATUALIZADO`.
 * 4. Nunca se inventa data. Não existe `new Date()` neste arquivo fora de
 *    um parâmetro `agora` explícito.
 *
 * ── O PRAZO (auditoria da P1.9.2) ───────────────────────────────────────
 * A P1.9.1 fixou 3 dias. Não havia base objetiva para isso: nenhum dado do
 * projeto mede com que frequência o preço dos produtos muda, e nenhum
 * termo de programa de afiliado consultado aqui fixa um prazo. Um número
 * escolhido sem base não pode morar no código como se fosse regra.
 *
 * Agora o prazo é CONFIGURAÇÃO EXPLÍCITA:
 *
 *   PRECO_VALIDADE_HORAS   inteiro, de 1 a 168 (7 dias)
 *
 * Padrão: 24 horas. É conservador no sentido que importa aqui — quanto
 * menor o prazo, menos a legenda afirma preço; o erro possível é omitir
 * um preço ainda válido ("confira o preço atual"), nunca afirmar um
 * vencido. Valor ausente, inválido ou fora da faixa cai no padrão, e o
 * motivo fica visível em `validadeDoPreco().origem`.
 *
 * Hoje nenhum produto tem `sincronizadoEm`: com qualquer prazo, nenhuma
 * legenda afirma preço. Isto só passa a importar quando houver
 * sincronização real de preço — e é nela que o prazo deve ser recalibrado,
 * com dado.
 */

import { formatarBRLOuNulo } from './formato-moeda'

/** Padrão quando `PRECO_VALIDADE_HORAS` não é informado ou é inválido. */
export const VALIDADE_PADRAO_DO_PRECO_HORAS = 24
/** Faixa aceita. Acima de 7 dias, "consultado em" deixa de informar. */
export const VALIDADE_MINIMA_DO_PRECO_HORAS = 1
export const VALIDADE_MAXIMA_DO_PRECO_HORAS = 168

export interface ValidadeDoPreco {
  horas: number
  origem: 'CONFIGURADA' | 'PADRAO' | 'PADRAO_POR_VALOR_INVALIDO'
}

/** O prazo em vigor, e de onde ele veio. Lido do ambiente. */
export function validadeDoPreco(env: Record<string, string | undefined> = process.env): ValidadeDoPreco {
  const bruto = (env.PRECO_VALIDADE_HORAS ?? '').trim()
  if (!bruto) return { horas: VALIDADE_PADRAO_DO_PRECO_HORAS, origem: 'PADRAO' }
  const n = Number(bruto)
  if (
    !/^\d+$/.test(bruto) ||
    !Number.isInteger(n) ||
    n < VALIDADE_MINIMA_DO_PRECO_HORAS ||
    n > VALIDADE_MAXIMA_DO_PRECO_HORAS
  ) {
    return { horas: VALIDADE_PADRAO_DO_PRECO_HORAS, origem: 'PADRAO_POR_VALOR_INVALIDO' }
  }
  return { horas: n, origem: 'CONFIGURADA' }
}

const HORA_MS = 3_600_000

function descreverPrazo(horas: number): string {
  return horas % 24 === 0 ? `${horas / 24} dia(s)` : `${horas} hora(s)`
}

export type StatusDoPreco =
  /** Preço com data real dentro do prazo: pode ir para a legenda. */
  | 'VERIFICADO'
  /** Há preço, e nenhuma verificação real dele. */
  | 'PRECO_NAO_VERIFICADO'
  /** Houve verificação, e ela passou do prazo. */
  | 'PRECO_DESATUALIZADO'
  /** Não há preço cadastrado. */
  | 'SEM_PRECO'

export interface AvaliacaoDoPreco {
  status: StatusDoPreco
  /** O que a legenda pode dizer. Sem data real, nunca contém "consultado em". */
  textoParaCopy: string
  /** dd/mm/aaaa da verificação, quando ela existe e vale. */
  dataDaVerificacao: string | null
  /** Para `alertasCompliance`. `null` quando não há nada a avisar. */
  alerta: string | null
}

export const TEXTO_SEM_PRECO = 'confira o preço atual'

/** Data em pt-BR fixa no fuso de Brasília: o texto é publicado no Brasil. */
export function dataPtBr(d: Date): string {
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

/**
 * A data da última verificação REAL do preço deste produto, ou `null`.
 *
 * Só a sincronização com a origem verifica. Produto cadastrado à mão não tem
 * data de verificação, e isso é dito em vez de inventado.
 */
export function dataDaVerificacaoDoPreco(produto: { sincronizadoEm?: Date | null }): Date | null {
  const d = produto.sincronizadoEm ?? null
  return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null
}

export function avaliarPreco(params: {
  preco: number | null | undefined
  verificadoEm: Date | null | undefined
  agora: Date
  /** Sobrepõe o ambiente. Ausente = `validadeDoPreco(process.env)`. */
  validadeHoras?: number
}): AvaliacaoDoPreco {
  const precoFormatado = formatarBRLOuNulo(params.preco ?? null)
  if (!precoFormatado) {
    return { status: 'SEM_PRECO', textoParaCopy: TEXTO_SEM_PRECO, dataDaVerificacao: null, alerta: null }
  }

  const verificadoEm = params.verificadoEm ?? null
  if (!verificadoEm || Number.isNaN(verificadoEm.getTime())) {
    return {
      status: 'PRECO_NAO_VERIFICADO',
      textoParaCopy: TEXTO_SEM_PRECO,
      dataDaVerificacao: null,
      alerta:
        'PRECO_NAO_VERIFICADO: não há data real de verificação do preço. A legenda não afirma preço nem data.',
    }
  }

  const validade = params.validadeHoras ?? validadeDoPreco().horas
  const idadeMs = params.agora.getTime() - verificadoEm.getTime()
  // Data no futuro também é suspeita: relógio errado não vira preço válido.
  if (idadeMs < 0 || idadeMs > validade * HORA_MS) {
    return {
      status: 'PRECO_DESATUALIZADO',
      textoParaCopy: TEXTO_SEM_PRECO,
      dataDaVerificacao: null,
      alerta: `PRECO_DESATUALIZADO: o preço foi verificado em ${dataPtBr(verificadoEm)}, fora do prazo de ${descreverPrazo(validade)}. A legenda não afirma preço.`,
    }
  }

  const data = dataPtBr(verificadoEm)
  return {
    status: 'VERIFICADO',
    textoParaCopy: `${precoFormatado} (consultado em ${data})`,
    dataDaVerificacao: data,
    alerta: null,
  }
}

/**
 * A legenda JÁ ESCRITA afirma um preço que se sustenta hoje?
 *
 * Existe para as peças geradas antes desta correção: elas trazem
 * "consultado em" com a data de geração. O preflight usa isto para não
 * deixar nenhuma delas ir ao ar.
 *
 * Devolve a pendência, ou `null` quando a legenda não afirma preço ou
 * afirma um preço sustentado pela verificação real.
 */
export function pendenciaDePrecoNaLegenda(params: {
  legenda: string
  verificadoEm: Date | null | undefined
  agora: Date
  validadeHoras?: number
}): string | null {
  const legenda = params.legenda ?? ''
  const afirmaPreco = /R\$\s?\d/.test(legenda)
  if (!afirmaPreco) return null

  const verificadoEm = params.verificadoEm ?? null
  if (!verificadoEm) {
    return 'PRECO_NAO_VERIFICADO: a legenda afirma um preço que nenhuma verificação real sustenta.'
  }
  const validade = params.validadeHoras ?? validadeDoPreco().horas
  const idadeMs = params.agora.getTime() - verificadoEm.getTime()
  if (idadeMs < 0 || idadeMs > validade * HORA_MS) {
    return `PRECO_DESATUALIZADO: a legenda afirma preço e a última verificação (${dataPtBr(verificadoEm)}) passou do prazo de ${descreverPrazo(validade)}.`
  }
  const datas = [...legenda.matchAll(/consultado em (\d{2}\/\d{2}\/\d{4})/g)].map((m) => m[1])
  if (datas.length === 0) {
    return 'PRECO_NAO_VERIFICADO: a legenda afirma um preço sem dizer quando ele foi consultado.'
  }
  const real = dataPtBr(verificadoEm)
  if (datas.some((d) => d !== real)) {
    return `PRECO_NAO_VERIFICADO: a legenda diz "consultado em ${datas[0]}", e a verificação real é de ${real}.`
  }
  return null
}
