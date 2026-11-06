/**
 * Resolução de privacidade do post no TikTok (Rodada 6, regras 8 e 15).
 *
 * Regra 15: enquanto o app não estiver auditado pelo TikTok, a documentação
 * oficial só permite visualização PRIVADA para clientes não auditados —
 * `PRIVATE_TESTING_ONLY`. Nunca contornar isso.
 *
 * Regra 8: se a plataforma permite múltiplas opções e a usuária já
 * configurou uma preferência válida, usar automaticamente — só interrompe
 * quando a própria API exigir escolha, a preferência não for mais válida,
 * houver risco de compliance, ou for exigido consentimento explícito.
 */

export type TikTokPrivacyResolutionStatus = 'PRIVATE_TESTING_ONLY' | 'RESOLVIDO_AUTOMATICAMENTE' | 'REQUER_ESCOLHA_DA_USUARIA'

export interface TikTokPrivacyResolution {
  status: TikTokPrivacyResolutionStatus
  privacyLevel: string | null
  motivo: string
}

export function resolverPrivacidadeTikTok(params: {
  appAuditado: boolean
  opcoesPermitidasPelaConta: string[] | 'unknown'
  preferenciaConfiguradaPelaUsuaria: string | null
}): TikTokPrivacyResolution {
  if (!params.appAuditado) {
    // Enquanto não auditado, a única opção aceitável é a mais restrita disponível — nunca pública.
    const privadas = params.opcoesPermitidasPelaConta === 'unknown' ? [] : params.opcoesPermitidasPelaConta.filter((o) => o.includes('PRIVATE') || o === 'SELF_ONLY')
    return {
      status: 'PRIVATE_TESTING_ONLY',
      privacyLevel: privadas[0] ?? 'SELF_ONLY',
      motivo: 'App ainda não auditado pelo TikTok — conteúdo de clientes não auditados fica limitado à visualização privada.',
    }
  }

  if (params.opcoesPermitidasPelaConta === 'unknown') {
    return { status: 'REQUER_ESCOLHA_DA_USUARIA', privacyLevel: null, motivo: 'Conta ainda não consultada (creator_info indisponível) — não é seguro escolher sozinho.' }
  }

  if (params.preferenciaConfiguradaPelaUsuaria && params.opcoesPermitidasPelaConta.includes(params.preferenciaConfiguradaPelaUsuaria)) {
    return {
      status: 'RESOLVIDO_AUTOMATICAMENTE',
      privacyLevel: params.preferenciaConfiguradaPelaUsuaria,
      motivo: 'Preferência já configurada pela usuária continua válida para esta conta — usada automaticamente.',
    }
  }

  return {
    status: 'REQUER_ESCOLHA_DA_USUARIA',
    privacyLevel: null,
    motivo: params.preferenciaConfiguradaPelaUsuaria
      ? 'A preferência configurada não está mais entre as opções permitidas pela conta.'
      : 'Nenhuma preferência configurada ainda — a própria API exige uma escolha explícita.',
  }
}
