/**
 * P2.17 — Modo assistido: reconhecer um link de produto do TikTok Shop
 * colado pela titular. FUNÇÃO PURA, sem rede.
 *
 * Formatos de página de produto (vistos em links públicos):
 *   https://shop.tiktok.com/view/product/<id>?region=BR
 *   https://www.tiktok.com/view/product/<id>
 *   https://shop-br.tiktok.com/.../product/<id>
 *   https://shop.tiktok.com/br/pdp/<id>            (P2.17.6: formato real dos
 *   https://shop.tiktok.com/br/pdp/<nome>/<id>      links copiados no Brasil)
 * Links curtos (vt./vm.tiktok.com) só revelam o produto abrindo a página, o
 * que não fazemos (sem scraping): ficam como TikTok, produto não identificado.
 */
export interface LinkDoTikTokShop {
  /** Domínio do TikTok. */
  ehTikTok: boolean
  /** Página de produto do TikTok Shop, com id reconhecido. */
  ehProduto: boolean
  productId: string | null
  /** Link curto: pode ser produto, mas só abrindo saberíamos. */
  curto: boolean
}

const NAO = { ehTikTok: false, ehProduto: false, productId: null, curto: false }

export function linkDoTikTokShop(link: string | null | undefined): LinkDoTikTokShop {
  if (!link) return NAO
  let u: URL
  try {
    u = new URL(link.trim())
  } catch {
    return NAO
  }
  const host = u.hostname.toLowerCase()
  const ehTikTok = u.protocol === 'https:' && (host === 'tiktok.com' || host.endsWith('.tiktok.com'))
  if (!ehTikTok) return NAO
  if (host === 'vt.tiktok.com' || host === 'vm.tiktok.com') return { ehTikTok, ehProduto: false, productId: null, curto: true }
  const m = u.pathname.match(/\/product\/(\d{10,25})(?:\/|$)/) ?? u.pathname.match(/\/pdp\/(?:[^/]+\/)?(\d{10,25})(?:\/|$)/)
  return m ? { ehTikTok, ehProduto: true, productId: m[1], curto: false } : { ehTikTok, ehProduto: false, productId: null, curto: false }
}

/**
 * P2.17.4 (auditoria): a ÚNICA regra de "é produto do TikTok Shop" — programa
 * tiktok-shop OU link de produto reconhecido pelo parser estrito (https, domínio
 * do TikTok, id numérico). Antes havia 4 cópias de uma regex frouxa.
 */
export function ehProdutoTikTokShop(providerId: string | null | undefined, link: string | null | undefined): boolean {
  return providerId === 'tiktok-shop' || linkDoTikTokShop(link).ehProduto
}
