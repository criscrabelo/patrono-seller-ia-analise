/**
 * P2.17.14 — A FONTE ÚNICA das integrações que a tela Integrações mostra.
 *
 * O contador ("X de Y conectadas"), o resumo executivo e os cartões leem
 * DAQUI. Antes, o contador usava só as plataformas com chave (6) enquanto a
 * tela mostrava também TikTok e TikTok Shop (8) e o resumo tinha outra lista
 * (5) — três fontes, três números.
 *
 * Puro (sem React, sem banco).
 */

export interface Plataforma {
  id: string
  nome: string
  logo: string
  cor: string
  descricao: string
  tipo: 'oauth' | 'token' | 'chaves'
  campos?: { key: string; label: string; placeholder: string; secret?: boolean }[]
  urlDocs: string
  urlOAuth?: string
  urlDedicada?: string
}

/** Plataformas conectadas por chave/token (cartões técnicos). */
export const PLATAFORMAS_COM_CHAVE: Plataforma[] = [
  {
    id: 'instagram',
    nome: 'Instagram',
    logo: '📸',
    cor: 'from-pink-500 to-purple-600',
    descricao: 'Publique posts, reels e stories automaticamente',
    tipo: 'oauth',
    urlDocs: 'https://developers.facebook.com/docs/instagram-api',
    campos: [
      { key: 'accessToken', label: 'Access Token de longa duração (EAA... ou IGAA...)', placeholder: 'EAABsbCS... ou IGAAxxxx...', secret: true },
      { key: 'accountId', label: 'Instagram Business Account ID (ou Instagram User ID)', placeholder: '17841400...' },
      { key: 'appId', label: 'Meta App ID (para renovação automática)', placeholder: '123456789012345' },
      { key: 'appSecret', label: 'Meta App Secret (para renovação automática)', placeholder: 'abc123def456...', secret: true },
    ],
  },
  {
    id: 'mercadolivre',
    nome: 'Mercado Livre',
    logo: '🛒',
    cor: 'from-yellow-400 to-yellow-500',
    descricao: 'Gerencie anúncios e vendas automaticamente',
    tipo: 'chaves',
    urlDocs: 'https://developers.mercadolivre.com.br',
    campos: [
      { key: 'accessToken', label: 'Access Token', placeholder: 'APP_USR-...', secret: true },
      { key: 'accountId', label: 'Seller ID', placeholder: '123456789' },
      { key: 'accountName', label: 'Nome da loja', placeholder: 'Minha Loja ML' },
    ],
  },
  {
    id: 'shopee',
    nome: 'Shopee',
    logo: '🛍️',
    cor: 'from-orange-500 to-red-500',
    descricao: 'Afiliado ou vendedor — gere links rastreáveis para todos os produtos',
    tipo: 'chaves',
    urlDocs: 'https://affiliate.shopee.com.br',
    urlDedicada: '/integracoes/shopee',
    campos: [
      { key: 'accessToken', label: 'Access Token (Shopee Open Platform)', placeholder: 'access_token...', secret: true },
      { key: 'accountId', label: 'Shop ID', placeholder: '123456' },
      { key: 'accountName', label: 'Nome da loja', placeholder: 'Minha Loja Shopee' },
    ],
  },
  {
    id: 'hotmart',
    nome: 'Hotmart',
    logo: '🔥',
    cor: 'from-red-500 to-orange-400',
    descricao: 'Gerencie produtos digitais e afiliados',
    tipo: 'chaves',
    urlDocs: 'https://developers.hotmart.com',
    campos: [
      { key: 'accessToken', label: 'Bearer Token (Hotmart API)', placeholder: 'eyJhbGci...', secret: true },
      { key: 'accountId', label: 'Client ID', placeholder: 'seu-client-id' },
      { key: 'accountName', label: 'Nome da conta', placeholder: 'Minha Conta Hotmart' },
    ],
  },
  {
    id: 'amazon',
    nome: 'Amazon',
    logo: '📦',
    cor: 'from-yellow-500 to-orange-400',
    descricao: 'Gerencie produtos e vendas na Amazon / Amazon Afiliados',
    tipo: 'chaves',
    urlDocs: 'https://developer-docs.amazon.com/sp-api',
    campos: [
      { key: 'accessToken', label: 'LWA Access Token (SP-API)', placeholder: 'Atza|...', secret: true },
      { key: 'accountId', label: 'Seller ID / Associate Tag', placeholder: 'A1XXXXX ou seu-tag-22' },
      { key: 'accountName', label: 'Nome da loja', placeholder: 'Minha Loja Amazon' },
    ],
  },
  {
    id: 'whatsapp',
    nome: 'WhatsApp (Z-API)',
    logo: '💬',
    cor: 'from-[#25D366] to-[#128C7E]',
    descricao: 'Envie conteúdos em massa para sua lista de contatos via Z-API',
    tipo: 'chaves',
    urlDocs: 'https://developer.z-api.io',
    urlDedicada: '/whatsapp',
    campos: [
      { key: 'accountId', label: 'Instance ID (Z-API)', placeholder: '3ABC1...', secret: false },
      { key: 'accessToken', label: 'Token (Z-API)', placeholder: 'F0...', secret: true },
      { key: 'clientToken', label: 'Client-Token (segurança — opcional)', placeholder: 'F0...', secret: true },
      { key: 'accountName', label: 'Identificação (ex: WhatsApp da Loja)', placeholder: 'Loja Principal' },
    ],
  },
]

/** Integrações com fluxo oficial próprio (OAuth/evidência), com cartão dedicado. */
export const INTEGRACOES_OFICIAIS = [
  { id: 'tiktok', nome: 'TikTok (publicação)' },
  { id: 'tiktok-shop', nome: 'TikTok Shop (afiliados)' },
] as const

/** TODAS as integrações da tela, na ordem em que aparecem. Y do contador = isto. */
export const INTEGRACOES_DA_TELA: { id: string; nome: string }[] = [
  ...INTEGRACOES_OFICIAIS.map((i) => ({ id: i.id, nome: i.nome })),
  ...PLATAFORMAS_COM_CHAVE.map((p) => ({ id: p.id, nome: p.nome })),
]
