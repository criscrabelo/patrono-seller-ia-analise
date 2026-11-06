/**
 * P2.17 — Pacote de publicação para o TikTok (modo assistido).
 *
 * O Patrono prepara tudo; a titular só publica no app do TikTok, onde o
 * produto do TikTok Shop é marcado no vídeo. A Content Posting API não tem
 * campo de produto: o vínculo com a comissão acontece no app.
 *
 * FUNÇÃO PURA: não chama rede, não publica, não grava. Reaproveita as regras
 * de copy existentes (lib/copy-por-canal.ts) e o texto de divulgação
 * (lib/creative-factory.ts). Nada é "publicado" por aqui.
 */
import { claimsNaoComprovados, hashtagsParaOCanal } from './copy-por-canal'
import { textoDisclosure } from './creative-factory'
import { linkDoTikTokShop } from './tiktok-shop-link'

/** Limite da legenda (campo `title` da Content Posting API). */
export const LIMITE_DA_LEGENDA = 2200
export const MAX_HASHTAGS = 5
export const CTA_PRODUTO_MARCADO = 'Toque no produto marcado no vídeo para ver os detalhes.'
export const CTA_BIO = 'Link na bio.'

export interface ProdutoDoPacote {
  nome: string
  linkProduto: string | null
  providerId: string | null
  externalId: string | null
}

export interface ConteudoDoPacote {
  id: string
  status: string
  roteiro: string | null
  textoTela: string | null
  legendaTiktok: string | null
  chamadaAcao: string | null
  hashtags: string[]
  videoUrl: string | null
  alertasCompliance: unknown[]
}

export interface PacoteTikTok {
  conteudoId: string
  tiktokShop: boolean
  productId: string | null
  gancho: string | null
  roteiro: string | null
  textoNaTela: string | null
  legenda: string
  cta: string
  divulgacao: string
  hashtags: string[]
  video: { url: string | null; formato: '9:16' }
  /** Bloqueiam a publicação até serem resolvidas. */
  pendencias: string[]
  /** Não bloqueiam; a titular precisa saber. */
  avisos: string[]
  passosNoApp: string[]
  pronto: boolean
  publicacao: 'MANUAL_PELA_TITULAR'
}

const TEM_DIVULGACAO = /comiss|afiliad|#publi\b|publicidade|parceria/i

/** Primeira linha do roteiro (ou do texto de tela) como gancho. */
function ganchoDe(c: ConteudoDoPacote): string | null {
  const fonte = c.textoTela?.trim() || c.roteiro?.trim() || ''
  const linha = fonte.split('\n').map((l) => l.replace(/^(gancho|hook)\s*[:\-–]\s*/i, '').trim()).find(Boolean)
  return linha ? linha.slice(0, 150) : null
}

export function montarPacoteTikTok(produto: ProdutoDoPacote, conteudo: ConteudoDoPacote): PacoteTikTok {
  const link = linkDoTikTokShop(produto.linkProduto)
  const productId = produto.providerId === 'tiktok-shop' ? produto.externalId ?? link.productId : link.productId
  const tiktokShop = produto.providerId === 'tiktok-shop' || link.ehProduto
  const cta = tiktokShop ? CTA_PRODUTO_MARCADO : CTA_BIO
  const divulgacao = textoDisclosure('afiliado')
  const hashtags = hashtagsParaOCanal(conteudo.hashtags ?? [], 'tiktok')
    .filter((h) => /^#[\p{L}\p{N}_]+$/u.test(h))
    .slice(0, MAX_HASHTAGS)

  // Legenda: a do conteúdo (já sem claims, gerada para o TikTok), com a CTA
  // certa para onde o link fica e a divulgação garantida.
  let base = (conteudo.legendaTiktok ?? '').trim()
  base = base.replace(/#[\p{L}\p{N}_]+/gu, '').replace(/link na bio\.?/gi, '').replace(/\n{3,}/g, '\n\n').trim()
  if (!base) base = produto.nome
  const partes = [base, cta]
  if (!TEM_DIVULGACAO.test(base)) partes.push(divulgacao)
  if (hashtags.length) partes.push(hashtags.join(' '))
  const legenda = partes.join('\n\n')

  const pendencias: string[] = []
  const avisos: string[] = []
  if (conteudo.status !== 'aprovado') pendencias.push('APROVACAO_PENDENTE: aprove o conteúdo antes de publicar.')
  if (!conteudo.videoUrl) pendencias.push('VIDEO_AUSENTE: falta o vídeo vertical (9:16). Gere no Video Seller ou grave e envie o seu.')
  const claims = claimsNaoComprovados(legenda)
  if (claims.length) pendencias.push(`CLAIM_NAO_COMPROVADO: a legenda afirma "${claims.join('", "')}" sem comprovação.`)
  if (legenda.length > LIMITE_DA_LEGENDA) pendencias.push(`LEGENDA_LONGA: ${legenda.length} caracteres (máximo ${LIMITE_DA_LEGENDA}).`)
  if (/https?:\/\//i.test(legenda)) pendencias.push('LINK_NA_LEGENDA: no TikTok o link da legenda não abre; o produto vai marcado no vídeo.')
  const alertas = Array.isArray(conteudo.alertasCompliance) ? conteudo.alertasCompliance.length : 0
  if (alertas) pendencias.push(`COMPLIANCE: ${alertas} alerta(s) do conteúdo para revisar antes de publicar.`)
  if (!tiktokShop) avisos.push('Produto fora do TikTok Shop: no TikTok o link fica na bio e não há comissão do TikTok Shop por este vídeo.')
  if (link.curto) avisos.push('Link curto do TikTok: confira no app se é o mesmo produto antes de marcar.')
  if (tiktokShop && !productId) avisos.push('Não identifiquei o número do produto no link: busque pelo nome ao marcar no app.')

  const passosNoApp = tiktokShop
    ? [
        'No TikTok, confira se o produto está na sua vitrine (TikTok Shop › Central de afiliados › buscar o produto › adicionar à vitrine). Os nomes dos menus podem variar com a versão do app.',
        'Baixe o vídeo vertical e, no TikTok, toque em + › Carregar e escolha o vídeo.',
        'Na tela de postagem, toque em "Adicionar link" › Produtos e escolha este produto.',
        'Cole a legenda (botão Copiar). Ela já diz que você pode receber comissão.',
        'Em "Mais opções", ligue a divulgação de conteúdo comercial se o app oferecer para este vídeo.',
        'Publique e guarde o link do vídeo publicado.',
      ]
    : [
        'Baixe o vídeo vertical e, no TikTok, toque em + › Carregar e escolha o vídeo.',
        'Cole a legenda (botão Copiar) e confira se o link do produto está na sua bio.',
        'Em "Mais opções", ligue a divulgação de conteúdo comercial.',
        'Publique e guarde o link do vídeo publicado.',
      ]

  return {
    conteudoId: conteudo.id,
    tiktokShop,
    productId: productId ?? null,
    gancho: ganchoDe(conteudo),
    roteiro: conteudo.roteiro,
    textoNaTela: conteudo.textoTela,
    legenda,
    cta,
    divulgacao,
    hashtags,
    video: { url: conteudo.videoUrl, formato: '9:16' },
    pendencias,
    avisos,
    passosNoApp,
    pronto: pendencias.length === 0,
    publicacao: 'MANUAL_PELA_TITULAR',
  }
}
