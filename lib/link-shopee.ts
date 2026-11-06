/**
 * P2.50 (Codex 16b) — link de afiliado da Shopee sem prova de elegibilidade.
 *
 * Antes, "Gerar links" anexava `smtt=0.0.9&sub_id1=<subId>` à URL do produto e
 * gravava tudo como `afiliado`. Esses parâmetros não são o contrato oficial: o
 * link que atribui a comissão é o link CURTO gerado no portal de afiliados
 * (affiliate.shopee.com.br → "Link personalizado", com os Sub IDs definidos
 * lá). Sem esse link não há prova de que a venda será atribuída.
 *
 * Regra: só link curto oficial (`s.shopee.com.br`, `shope.ee`) é `afiliado`.
 * Qualquer outro link da Shopee fica `nao_verificado` — nada é anexado à URL.
 */
import { destinoPublico } from './destino-publico'

export const HOSTS_LINK_AFILIADO_SHOPEE = ['s.shopee.com.br', 'shope.ee'] as const

export type ClassificacaoLinkShopee =
  | { ok: true; tipo: 'afiliado' | 'nao_verificado'; urlDestino: string; motivo: string | null }
  | { ok: false; motivo: string }

export function classificarLinkShopee(bruto: string | null | undefined): ClassificacaoLinkShopee {
  const destino = destinoPublico(bruto ?? '')
  if (!destino.ok || !destino.url) return { ok: false, motivo: destino.motivo ?? 'Endereço inválido.' }
  const host = destino.url.hostname.toLowerCase()
  const daShopee = host === 'shopee.com.br' || host.endsWith('.shopee.com.br') || host === 'shope.ee'
  if (!daShopee) return { ok: false, motivo: 'O link não é da Shopee.' }
  const urlDestino = destino.url.toString()
  if ((HOSTS_LINK_AFILIADO_SHOPEE as readonly string[]).includes(host)) {
    return { ok: true, tipo: 'afiliado', urlDestino, motivo: null }
  }
  return {
    ok: true,
    tipo: 'nao_verificado',
    urlDestino,
    motivo: 'Link do produto, não o link de afiliado. Gere o link no portal affiliate.shopee.com.br (s.shopee.com.br) para a comissão ser atribuída.',
  }
}
