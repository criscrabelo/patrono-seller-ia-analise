/**
 * ComplianceEngine (Rodada 5) — decide automaticamente quando incluir
 * disclosure de afiliado/conteúdo comercial, e registra qual regra
 * provocou essa decisão. Nunca oculta relação comercial — a decisão só é
 * "sim, precisa de disclosure" ou "sim, precisa, e por este motivo
 * específico"; nunca "não precisa" por omissão de checagem.
 */

import { textoDisclosure } from './creative-factory'
import type { ChannelCapability } from './channel-registry'
import type { AffiliateOpportunity } from './affiliate-discovery'

export interface DecisaoDisclosure {
  necessario: boolean
  texto: string | null
  motivo: string
}

/**
 * Decide o disclosure para uma publicação. Regras avaliadas, em ordem:
 * 1. Se a oportunidade vem de um provider de afiliados (qualquer origem
 *    que não seja `MANUAL`/`USER_PROVIDED` sem programa de afiliados),
 *    disclosure de afiliado é obrigatório.
 * 2. Se o canal exige disclosure comercial (`ChannelCapability.commercialDisclosure`),
 *    obrigatório independente da origem.
 * 3. Nunca "false" por falta de informação — na dúvida, exige disclosure
 *    (mais seguro pedir disclosure a mais do que esconder relação comercial).
 */
export function decidirDisclosure(params: {
  opportunity: Pick<AffiliateOpportunity, 'origin' | 'providerId'>
  channel: Pick<ChannelCapability, 'channelId' | 'commercialDisclosure'>
}): DecisaoDisclosure {
  const ehAfiliado = params.opportunity.origin !== 'MANUAL'

  if (ehAfiliado) {
    return {
      necessario: true,
      texto: textoDisclosure('afiliado'),
      motivo: `Conteúdo originado de programa de afiliados (${params.opportunity.providerId}) — disclosure de afiliado é obrigatório.`,
    }
  }

  if (params.channel.commercialDisclosure) {
    return {
      necessario: true,
      texto: textoDisclosure('publicidade'),
      motivo: `Canal "${params.channel.channelId}" exige disclosure comercial em qualquer conteúdo patrocinado.`,
    }
  }

  // Nenhuma regra confirmada como aplicável — ainda assim, não afirma que
  // "não precisa": marca como necessário por segurança até uma rodada
  // futura refinar esta regra com mais contexto (ex.: conteúdo 100%
  // orgânico sem nenhum vínculo comercial).
  return {
    necessario: true,
    texto: textoDisclosure('afiliado'),
    motivo: 'Nenhuma regra específica descartou a necessidade de disclosure — aplicado por segurança.',
  }
}
