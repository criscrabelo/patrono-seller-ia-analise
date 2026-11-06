/**
 * P2.17 — Lógica HTTP da conexão da criadora no TikTok Shop, fora das rotas
 * para ser testável sem servidor. Rotas: app/api/integracoes/tiktok-shop/*.
 */
import { NextResponse } from 'next/server'
import {
  conexaoTikTokShopLiberada,
  ErroDeAutorizacaoTikTokShop,
  gerarStateCreator,
  guardarTokensDaCriadora,
  lerCredenciaisTikTokShopCreator,
  montarUrlDeAutorizacaoCreator,
  trocarCodigoDaCriadora,
  validarStateCreator,
} from './tiktok-shop-oauth'

export const BLOQUEIO_TIKTOK_SHOP = {
  error: 'A conexão com o TikTok Shop ainda não está disponível. Nenhum dado da autorização foi lido ou guardado.',
  bloqueio: 'TIKTOK_SHOP_OAUTH_NAO_IMPLEMENTADO',
} as const

type Quem = { workspaceId: string; userId: string }

function voltarParaIntegracoes(base: string, resultado: string) {
  const u = new URL('/integracoes', base)
  u.searchParams.set('tiktokShop', resultado)
  return NextResponse.redirect(u)
}

export async function iniciarAutorizacaoDaCriadora(quem: Quem, deps: { env?: Record<string, string | undefined> } = {}) {
  const env = deps.env ?? process.env
  if (!(await conexaoTikTokShopLiberada(quem.workspaceId, env))) return NextResponse.json(BLOQUEIO_TIKTOK_SHOP, { status: 501 })
  const creds = lerCredenciaisTikTokShopCreator(env)!
  return NextResponse.redirect(montarUrlDeAutorizacaoCreator(creds, gerarStateCreator(quem, env)))
}

export async function tratarCallbackDaCriadora(
  url: string,
  quem: Quem,
  deps: { env?: Record<string, string | undefined>; fetcher?: typeof fetch } = {}
) {
  const env = deps.env ?? process.env
  // Primeiro a porta: sem liberação, nem a URL é lida.
  if (!(await conexaoTikTokShopLiberada(quem.workspaceId, env))) return NextResponse.json(BLOQUEIO_TIKTOK_SHOP, { status: 501 })

  const q = new URL(url).searchParams
  if (q.get('error')) return voltarParaIntegracoes(url, 'recusado')
  const code = q.get('code') ?? q.get('auth_code')
  const state = q.get('state')
  if (!code || !state) return voltarParaIntegracoes(url, 'incompleto')

  const dono = validarStateCreator(state, Date.now(), env)
  if (!dono || dono.workspaceId !== quem.workspaceId || dono.userId !== quem.userId) {
    return voltarParaIntegracoes(url, 'state-invalido')
  }

  try {
    const tokens = await trocarCodigoDaCriadora(lerCredenciaisTikTokShopCreator(env)!, code, deps.fetcher)
    await guardarTokensDaCriadora({ ...quem, tokens })
    return voltarParaIntegracoes(url, 'conectado')
  } catch (e) {
    return voltarParaIntegracoes(url, e instanceof ErroDeAutorizacaoTikTokShop && e.codigo === 'REDE' ? 'tente-de-novo' : 'falhou')
  }
}
