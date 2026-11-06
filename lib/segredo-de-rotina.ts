/**
 * P2.50 — Autenticação das rotinas automáticas (cron): `Authorization: Bearer <CRON_SECRET>` comparado em TEMPO
 * CONSTANTE (sem vazar, pelo tempo de resposta, quantos caracteres acertou). Sem segredo configurado = recusa.
 */
import { createHash, timingSafeEqual } from 'node:crypto'

export function autorizacaoDeRotinaValida(cabecalho: string | null | undefined, segredo: string | null | undefined): boolean {
  if (!segredo || !cabecalho) return false
  // Hash dos dois lados: mesmo tamanho sempre (timingSafeEqual exige), sem revelar o tamanho do segredo.
  const a = createHash('sha256').update(cabecalho).digest()
  const b = createHash('sha256').update(`Bearer ${segredo}`).digest()
  return timingSafeEqual(a, b)
}
