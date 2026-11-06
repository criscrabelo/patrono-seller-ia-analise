/**
 * P2.2 — Quanto uma chamada externa pode esperar DENTRO de uma requisição.
 *
 * Na Netlify Free a função síncrona morre aos 30 s (medido na P2.1). Quem
 * espera provider dentro da requisição precisa desistir antes, com erro
 * claro, em vez de virar 502 sem explicação. O sinal de "estou na
 * Netlify" é o mesmo dos trabalhos longos: `TRABALHO_LONGO_MODO`.
 *
 * Fora dela (Vercel, `maxDuration = 60`), nada muda: `null` = sem teto
 * extra, o SDK segue com o padrão de sempre.
 */
export const ESPERA_MAXIMA_NA_NETLIFY_MS = 24_000

export function esperaMaximaDeProviderMs(env: Record<string, string | undefined> = process.env): number | null {
  return env.TRABALHO_LONGO_MODO === 'segundo-plano' ? ESPERA_MAXIMA_NA_NETLIFY_MS : null
}
