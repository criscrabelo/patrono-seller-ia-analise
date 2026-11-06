/**
 * P2.17.15 — Situação de um candidato em relação à VITRINE, para o cartão de
 * Oportunidades (só leitura). A vitrine é consequência do ranking: o cartão
 * só INFORMA; quem inclui é o fluxo automático, quando a API estiver
 * autorizada (lib/tiktok-shop-vitrine.ts).
 *
 * Puro e sem dependência do canal TikTok: a tela de curadoria continua só
 * curadoria (guarda da rodada 61).
 */
export type SituacaoNaVitrine = 'ELEGIVEL' | 'NA_VITRINE' | 'AGUARDANDO_SELLER' | 'NAO_ELEGIVEL' | 'DADOS_PENDENTES'

export const ROTULO_NA_VITRINE: Record<SituacaoNaVitrine, string> = {
  ELEGIVEL: 'Elegível para vitrine',
  NA_VITRINE: 'Já está na vitrine',
  AGUARDANDO_SELLER: 'Aguardando seller',
  NAO_ELEGIVEL: 'Não elegível',
  DADOS_PENDENTES: 'Dados oficiais pendentes',
}

/** FUNÇÃO PURA. Mesma régua de colaboração do fluxo: só produto da busca oficial de colaboração aberta, com dado válido. */
export function situacaoNaVitrine(
  c: { fonte: string; providerId: string | null; externalId: string | null; complianceBloqueante: boolean; validoAte: Date },
  registro: { estado: string } | null,
  agora: Date
): SituacaoNaVitrine {
  if (registro?.estado === 'CONFIRMADO_NA_VITRINE') return 'NA_VITRINE'
  if (registro?.estado === 'AGUARDANDO_APROVACAO') return 'AGUARDANDO_SELLER'
  if (c.providerId !== 'tiktok-shop' || c.complianceBloqueante) return 'NAO_ELEGIVEL'
  if (!c.externalId || c.fonte !== 'tiktok-shop' || c.validoAte.getTime() < agora.getTime()) return 'DADOS_PENDENTES'
  return 'ELEGIVEL'
}
