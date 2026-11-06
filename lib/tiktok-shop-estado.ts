/**
 * P2.17 — Em que pé está o TikTok Shop deste workspace, em uma frase.
 * Sem rede e sem segredo: lê só configuração, flag e a linha da integração.
 */
import { prisma } from './prisma'
import { situacaoDaAffiliateApi } from './elegibilidade-tiktok-shop'
import { conexaoTikTokShopLiberada, PLATAFORMA_CREATOR } from './tiktok-shop-oauth'
import { TikTokShopAffiliateCapabilityProbe, type TikTokShopCapabilityStatus } from './tiktok-shop-provider'

export interface EstadoDaConexaoTikTokShop {
  liberada: boolean
  conectada: boolean
  conta: string | null
  validoAte: string | null
  escopos: string[]
  capacidade: TikTokShopCapabilityStatus
  frase: string
}

export async function estadoDaConexaoTikTokShop(workspaceId: string, env: Record<string, string | undefined> = process.env): Promise<EstadoDaConexaoTikTokShop> {
  const [liberada, i] = await Promise.all([
    conexaoTikTokShopLiberada(workspaceId, env),
    prisma.integracao.findUnique({
      where: { workspaceId_plataforma: { workspaceId, plataforma: PLATAFORMA_CREATOR } },
      select: { status: true, accountName: true, tokenExpiry: true, extraData: true },
    }),
  ])
  const conectada = i?.status === 'conectado'
  const escopos = Array.isArray((i?.extraData as { escopos?: unknown } | null)?.escopos) ? ((i!.extraData as { escopos: string[] }).escopos) : []
  const capacidade = new TikTokShopAffiliateCapabilityProbe().calcular({
    appConfigured: liberada,
    creatorAutorizado: conectada,
    // Aprovação da Affiliate API só é afirmada quando o TikTok a confirma (env definida após o e-mail de aprovação).
    affiliateApiAprovada: (env.TIKTOK_SHOP_AFFILIATE_APROVADA ?? '').trim().toLowerCase() === 'true',
    regiaoSuportada: true,
    erro: null,
  })
  const frase = !liberada
    ? (situacaoDaAffiliateApi().bloqueada ? situacaoDaAffiliateApi().frase : 'Aguardando a certificação da empresa no TikTok Shop Partner Center.')
    : i?.status === 'expirado'
      ? 'A autorização venceu: conecte de novo.'
      : !conectada
        ? 'Pronto para conectar a sua conta de criadora.'
        : capacidade === 'AVAILABLE'
          ? 'Conectado e com a Affiliate API marcada como aprovada. A primeira busca real confirma os produtos de colaboração aberta.'
          : 'Conectado. Falta o TikTok liberar a Affiliate API para o app.'
  return { liberada, conectada, conta: conectada ? i?.accountName ?? null : null, validoAte: conectada ? i?.tokenExpiry?.toISOString() ?? null : null, escopos, capacidade, frase }
}
