/**
 * AIContentDisclosureGate (complemento Digital Twin, Rodada 6) — decide
 * quando o TikTok exige identificação de conteúdo gerado/alterado por IA,
 * distinto do `TikTokCommercialDisclosure` (relação comercial/afiliado).
 * Um vídeo com Digital Twin pode precisar dos DOIS disclosures ao mesmo
 * tempo — nunca um substitui o outro.
 *
 * Fail-safe: na dúvida (rosto ou voz sintéticos realistas presentes),
 * SEMPRE exige disclosure de IA. Nunca esconde esse fato para tentar
 * burlar a plataforma.
 */

export interface AIContentDisclosureDecisao {
  necessario: boolean
  motivo: string
}

export function decidirAIContentDisclosure(params: {
  usaAvatarSintetico: boolean
  usaVozClonada: boolean
  usaLipSync: boolean
}): AIContentDisclosureDecisao {
  if (params.usaAvatarSintetico || params.usaVozClonada || params.usaLipSync) {
    const partes: string[] = []
    if (params.usaAvatarSintetico) partes.push('avatar sintético (rosto)')
    if (params.usaVozClonada) partes.push('voz clonada')
    if (params.usaLipSync) partes.push('sincronização labial')
    return {
      necessario: true,
      motivo: `Conteúdo usa ${partes.join(', ')} — regras do TikTok para conteúdo gerado/alterado por IA se aplicam.`,
    }
  }
  return { necessario: false, motivo: 'Nenhum elemento sintético (avatar/voz/lip sync) identificado neste conteúdo.' }
}
