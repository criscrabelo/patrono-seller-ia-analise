/**
 * Estado real de configuração do TikTok Channel (Rodada 6, regra 4) — a
 * tela de integrações nunca deve mostrar "Conectado" só porque existem
 * client credentials. Cada estado abaixo reflete uma combinação real e
 * verificável de configuração/token/escopo/auditoria do app.
 */

export const TIKTOK_CONFIG_STATUSES = [
  'NAO_CONFIGURADO',
  'APP_CONFIGURADO',
  'AUTORIZACAO_NECESSARIA',
  'CONECTADO',
  'ESCOPO_PENDENTE',
  'APP_AGUARDANDO_AUDITORIA',
  'PRONTO_PARA_POSTAGEM_PRIVADA',
  'PRONTO_PARA_POSTAGEM_PUBLICA',
  'TOKEN_EXPIRADO',
  'ERRO',
] as const
export type TikTokConfigStatus = (typeof TIKTOK_CONFIG_STATUSES)[number]

export interface TikTokConfigStatusInput {
  appConfigured: boolean // TIKTOK_CLIENT_KEY/SECRET/REDIRECT_URI presentes
  integracaoConectada: boolean // Integracao.status === 'conectado' e accessToken presente
  tokenExpirado: boolean // Integracao.tokenExpiry no passado e refresh falhou/ausente
  escoposConcedidos: string[] | null // vieram do OAuth (Integracao.extraData.scope)
  escoposNecessarios: readonly string[] // ex.: TIKTOK_SCOPES (lib/tiktok-oauth.ts)
  appAuditado: boolean // auditoria oficial do TikTok concluída para o app
  erro: string | null // erro de saúde/consulta mais recente, se houver
}

export function calcularStatusConfiguracaoTikTok(input: TikTokConfigStatusInput): TikTokConfigStatus {
  if (input.erro) return 'ERRO'
  if (!input.appConfigured) return 'NAO_CONFIGURADO'
  if (!input.integracaoConectada) return 'AUTORIZACAO_NECESSARIA'
  if (input.tokenExpirado) return 'TOKEN_EXPIRADO'

  const escopoOk = input.escoposConcedidos != null && input.escoposNecessarios.every((e) => input.escoposConcedidos!.includes(e))
  if (!escopoOk) return 'ESCOPO_PENDENTE'

  if (!input.appAuditado) return 'PRONTO_PARA_POSTAGEM_PRIVADA'
  return 'PRONTO_PARA_POSTAGEM_PUBLICA'
}

/** Só para telas que querem um rótulo intermediário genérico — nunca usado para decidir automação. */
export function rotuloConfiguracaoTikTok(status: TikTokConfigStatus): string {
  const rotulos: Record<TikTokConfigStatus, string> = {
    NAO_CONFIGURADO: 'Não configurado',
    APP_CONFIGURADO: 'App configurado',
    AUTORIZACAO_NECESSARIA: 'Autorização necessária',
    CONECTADO: 'Conectado',
    ESCOPO_PENDENTE: 'Escopo pendente',
    APP_AGUARDANDO_AUDITORIA: 'App aguardando auditoria',
    PRONTO_PARA_POSTAGEM_PRIVADA: 'Pronto para postagem privada',
    PRONTO_PARA_POSTAGEM_PUBLICA: 'Pronto para postagem pública',
    TOKEN_EXPIRADO: 'Token expirado',
    ERRO: 'Erro',
  }
  return rotulos[status]
}
