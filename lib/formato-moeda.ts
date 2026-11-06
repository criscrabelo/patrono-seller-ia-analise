/**
 * Formatação monetária brasileira — ponto único de verdade (Rodada 10.1).
 *
 * Antes existiam duas cópias de `R$ ${valor.toFixed(2)}` espalhadas, as duas
 * em texto que a proprietária PUBLICA: a legenda do preset do Digital Twin
 * (`creative-factory.ts`) e a legenda do Autopilot (`autopilot.ts`). As duas
 * escreviam `R$ 199.00`, com ponto — que não é como se escreve dinheiro em
 * português.
 *
 * Sem dependência de UI (nada de clsx/date-fns): este módulo é importado
 * também pelo worker, que roda em Node puro, fora do Next.
 *
 * Cuidado com o espaço: `Intl.NumberFormat('pt-BR', …)` separa `R$` do número
 * com NBSP (U+00A0), não com espaço comum. Num texto que vai para a legenda
 * do TikTok e é comparado/recortado adiante, esse caractere invisível vira
 * bug difícil de enxergar — por isso é normalizado aqui, de uma vez.
 *
 * Isto é APRESENTAÇÃO. Nenhuma regra de preço, arredondamento de negócio ou
 * cálculo de comissão passa por aqui: o valor entra e sai com o mesmo
 * número, só muda como ele é escrito.
 */

const FORMATADOR_BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

/** Espaços "invisíveis" que o ICU pode usar entre o símbolo e o número. */
const ESPACOS_NAO_QUEBRAVEIS = /[  ]/g

/** `199` → `"R$ 199,00"`. Sempre devolve texto; não decide se deve exibir. */
export function formatarBRL(valor: number): string {
  return FORMATADOR_BRL.format(valor).replace(ESPACOS_NAO_QUEBRAVEIS, ' ')
}

/**
 * Versão para quem só tem o preço às vezes (o caso das legendas: produto sem
 * preço confirmado nunca ganha um valor inventado). `null` significa
 * "não há preço para mostrar" — quem chama decide o texto alternativo.
 */
export function formatarBRLOuNulo(valor: number | null | undefined): string | null {
  if (valor == null || !Number.isFinite(valor)) return null
  return formatarBRL(valor)
}
