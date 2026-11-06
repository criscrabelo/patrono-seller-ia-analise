/**
 * Ponte entre o OAuth real do TikTok (`lib/tiktok-oauth.ts`) e a persistência
 * existente (`Integracao`, mesma tabela usada por Instagram/Shopee) — sem
 * tabela nova. Renova o access token automaticamente quando expirado
 * (usando o refresh token), nunca pede novo consentimento à toa.
 */

import { prisma } from './prisma'
import { lerCredenciaisOAuthTikTok, renovarAccessToken } from './tiktok-oauth'
import { registrarAuditoria } from './audit-log'

export interface TikTokIntegracaoAtiva {
  accessToken: string
  openId: string
  scope: string | null
}

/** Devolve um access token válido, renovando via refresh token se necessário. Nunca loga o token. */
export async function obterTikTokTokenValido(workspaceId: string): Promise<TikTokIntegracaoAtiva | null> {
  const integracao = await prisma.integracao.findUnique({
    where: { workspaceId_plataforma: { workspaceId, plataforma: 'tiktok' } },
  })
  if (!integracao || integracao.status !== 'conectado' || !integracao.accessToken) return null

  const expirado = integracao.tokenExpiry != null && integracao.tokenExpiry.getTime() <= Date.now()
  if (!expirado) {
    const extra = (integracao.extraData as { scope?: string } | null) ?? null
    return { accessToken: integracao.accessToken, openId: integracao.accountId ?? '', scope: extra?.scope ?? null }
  }

  if (!integracao.refreshToken) return null // expirado e sem refresh — precisa reconectar (HumanActionRequired: TOKEN_EXPIRED)

  const creds = lerCredenciaisOAuthTikTok()
  if (!creds) return null

  const novoToken = await renovarAccessToken(creds, integracao.refreshToken)
  await prisma.integracao.update({
    where: { id: integracao.id },
    data: {
      accessToken: novoToken.accessToken,
      refreshToken: novoToken.refreshToken,
      tokenExpiry: new Date(Date.now() + novoToken.expiresInSeconds * 1000),
      extraData: { scope: novoToken.scope, refreshExpiresInSeconds: novoToken.refreshExpiresInSeconds },
    },
  })
  await registrarAuditoria({
    workspaceId,
    action: 'integracao.token_renovado',
    entityType: 'Integracao',
    entityId: integracao.id,
    metadata: { plataforma: 'tiktok' },
  })

  return { accessToken: novoToken.accessToken, openId: novoToken.openId, scope: novoToken.scope }
}
