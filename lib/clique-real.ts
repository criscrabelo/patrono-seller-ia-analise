/**
 * P2.50 — Clique REAL × robô × a própria titular. Robôs de pré-visualização (TikTok, WhatsApp, Instagram, Facebook,
 * Telegram, Google, Slack…), pré-carregamento do navegador e a titular logada abrindo o próprio link NÃO são cliques
 * de compradora: ficam registrados com outro tipo e não entram em cliques, CTR nem conversão.
 */
const ROBO = /bot\b|crawler|spider|preview|facebookexternalhit|facebookcatalog|whatsapp|telegrambot|slackbot|discordbot|twitterbot|linkedinbot|embedly|bytespider|tiktokspider|skypeuripreview|googleother|headlesschrome|curl\/|wget\/|python-requests|node-fetch|axios\//i

export type TipoDeClique = 'clique' | 'clique_bot' | 'clique_proprio'

export function classificarClique(h: { userAgent: string | null; purpose?: string | null; secPurpose?: string | null; temSessaoDoApp: boolean }): TipoDeClique {
  if (h.temSessaoDoApp) return 'clique_proprio'
  if (!h.userAgent || ROBO.test(h.userAgent)) return 'clique_bot'
  if (/prefetch|prerender/i.test(`${h.purpose ?? ''} ${h.secPurpose ?? ''}`)) return 'clique_bot'
  return 'clique'
}

/**
 * Lê os cabeçalhos SÓ para classificar (transitório): nada de agente, cookie ou IP é devolvido nem gravado —
 * a rota do clique continua sem guardar identificador de pessoa (regra de privacidade da rodada18).
 */
export function tipoDoCliqueDaRequisicao(h: Headers): TipoDeClique {
  const sessao = /(?:^|;\s*)(?:__Secure-)?next-auth\.session-token=/.test(h.get('cookie') ?? '')
  return classificarClique({ userAgent: h.get('user-agent'), purpose: h.get('purpose'), secPurpose: h.get('sec-purpose'), temSessaoDoApp: sessao })
}
