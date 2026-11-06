/**
 * P2.17.6 — De onde vêm os dados OFICIAIS de cada produto, e por que não vêm.
 *
 * Só fontes oficiais: API de afiliados do TikTok Shop (Affiliate Creator API)
 * e Open API do Programa de Afiliados da Shopee. Nada de abrir a página do
 * produto, nada de endpoint privado. Sem leitor oficial ativo, o motivo vai
 * para a tela ("O TikTok ainda não forneceu esse dado.") em vez de "desconhecido".
 */
import { estadoDaConexaoTikTokShop } from './tiktok-shop-estado'
import { situacaoDaAffiliateApi } from './elegibilidade-tiktok-shop'
import type { OfertaBruta, Provider, ProdutoIdentificado } from './dados-de-produto'

export type FonteOficial = 'TIKTOK_SHOP_AFFILIATE_API' | 'SHOPEE_AFFILIATE_API'

/** Lê ofertas oficiais por id externo. Ausente no Map = a fonte não devolveu o item. */
export type LeitorOficial = (externalIds: string[]) => Promise<Map<string, OfertaBruta>>

export type EstadoDaFonteDeProduto =
  | { disponivel: true; fonte: FonteOficial; leitor: LeitorOficial }
  | { disponivel: false; fonte: FonteOficial | 'NENHUMA'; situacao: 'INDISPONIVEL' | 'NAO_IDENTIFICADO'; motivoCurto: string; motivo: string }

export const FONTE_DO_PROVIDER: Partial<Record<Provider, FonteOficial>> = {
  'tiktok-shop': 'TIKTOK_SHOP_AFFILIATE_API',
  shopee: 'SHOPEE_AFFILIATE_API',
}

/**
 * Leitores oficiais ATIVOS. Hoje nenhum: o detalhe de produto da Affiliate
 * Creator API e o `productOfferV2` da Shopee só entram com a documentação
 * oficial conferida (ou a primeira resposta real) — nunca por palpite.
 * Os testes injetam leitores FIXTURE pelo parâmetro de `estadoDaFonte`.
 */
export const LEITORES_ATIVOS: Partial<Record<FonteOficial, LeitorOficial>> = {}

const CURTO_TIKTOK = 'O TikTok ainda não forneceu esse dado.'
const CURTO_SHOPEE = 'A Shopee ainda não forneceu esse dado.'

export async function estadoDaFonte(
  p: { workspaceId: string; link: string | null; id: ProdutoIdentificado },
  opcoes: { leitores?: Partial<Record<FonteOficial, LeitorOficial>>; env?: Record<string, string | undefined>; cacheTikTok?: Map<string, Awaited<ReturnType<typeof estadoDaConexaoTikTokShop>>> } = {}
): Promise<EstadoDaFonteDeProduto> {
  const env = opcoes.env ?? process.env
  const leitores = { ...LEITORES_ATIVOS, ...(opcoes.leitores ?? {}) }
  if (!p.link) return { disponivel: false, fonte: 'NENHUMA', situacao: 'NAO_IDENTIFICADO', motivoCurto: 'Sem link do produto: não há onde consultar.', motivo: 'O produto não tem link cadastrado.' }
  const { provider, externalId, curto } = p.id

  if (provider === 'tiktok-shop' || (curto && /tiktok\.com/i.test(p.link))) {
    if (!externalId) {
      return { disponivel: false, fonte: 'TIKTOK_SHOP_AFFILIATE_API', situacao: 'NAO_IDENTIFICADO', motivoCurto: CURTO_TIKTOK, motivo: 'Link curto do TikTok: o produto só seria identificado abrindo a página (não fazemos). Cole o link completo do produto (…/pdp/<número> ou …/product/<número>).' }
    }
    const cache = opcoes.cacheTikTok
    const conexao = cache?.get(p.workspaceId) ?? (await estadoDaConexaoTikTokShop(p.workspaceId, env))
    cache?.set(p.workspaceId, conexao)
    const leitor = leitores.TIKTOK_SHOP_AFFILIATE_API
    if (conexao.capacidade === 'AVAILABLE' && leitor) return { disponivel: true, fonte: 'TIKTOK_SHOP_AFFILIATE_API', leitor }
    const motivo = !conexao.liberada
      ? (situacaoDaAffiliateApi().bloqueada ? `API de afiliados do TikTok Shop: ${situacaoDaAffiliateApi().frase}` : 'A API de afiliados do TikTok Shop ainda não está ligada: falta a certificação no TikTok Shop Partner Center.')
      : !conexao.conectada
        ? 'Falta conectar a sua conta de criadora do TikTok Shop.'
        : conexao.capacidade !== 'AVAILABLE'
          ? 'O TikTok ainda não liberou a Affiliate API para o app.'
          : 'A API está liberada; o detalhe do produto entra quando o formato for confirmado na documentação ou na primeira resposta real.'
    return { disponivel: false, fonte: 'TIKTOK_SHOP_AFFILIATE_API', situacao: 'INDISPONIVEL', motivoCurto: CURTO_TIKTOK, motivo }
  }

  if (provider === 'shopee') {
    if (!externalId) {
      return {
        disponivel: false, fonte: 'SHOPEE_AFFILIATE_API', situacao: 'NAO_IDENTIFICADO', motivoCurto: CURTO_SHOPEE,
        motivo: curto
          ? 'Link curto da Shopee (s.shopee.com.br): o produto só seria identificado abrindo a página (não fazemos). Para enriquecer, use o link completo do produto (com "-i.<loja>.<item>").'
          : 'O link da Shopee não traz o número da loja e do item ("-i.<loja>.<item>").',
      }
    }
    const temCredencial = !!env.SHOPEE_AFFILIATE_APP_ID && !!env.SHOPEE_AFFILIATE_SECRET
    const leitor = leitores.SHOPEE_AFFILIATE_API
    if (temCredencial && leitor) return { disponivel: true, fonte: 'SHOPEE_AFFILIATE_API', leitor }
    return {
      disponivel: false, fonte: 'SHOPEE_AFFILIATE_API', situacao: 'INDISPONIVEL', motivoCurto: CURTO_SHOPEE,
      motivo: temCredencial
        ? 'Credenciais da Open API de afiliados presentes; a leitura entra depois de conferir a documentação oficial (portal de afiliados, exige login).'
        : 'Falta liberar a Open API do Programa de Afiliados da Shopee (AppID e Secret, pedidos no portal affiliate.shopee.com.br).',
    }
  }

  if (provider === 'mercado-livre' || provider === 'amazon') {
    const nome = provider === 'amazon' ? 'Amazon' : 'Mercado Livre'
    return { disponivel: false, fonte: 'NENHUMA', situacao: 'INDISPONIVEL', motivoCurto: `Sem fonte oficial do ${nome} conectada.`, motivo: `Nenhuma API oficial do ${nome} está conectada para dados de produto.` }
  }
  return { disponivel: false, fonte: 'NENHUMA', situacao: 'NAO_IDENTIFICADO', motivoCurto: 'Loja não reconhecida pelo link.', motivo: 'O link não é de uma loja com fonte oficial suportada (TikTok Shop, Shopee).' }
}
