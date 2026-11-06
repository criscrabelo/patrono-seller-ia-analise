/**
 * AffiliateProviderRegistry — catálogo de providers de afiliação conhecidos.
 *
 * O Patrono Seller NÃO é limitado a marketplaces. Um "provider" aqui pode
 * ser um marketplace (Shopee), uma rede de afiliação que reúne várias
 * marcas (Awin, Rakuten, Lomadee), o programa próprio de um varejista
 * (Renner, Riachuelo, Netshoes) ou uma plataforma de infoprodutos
 * (Hotmart). Novo provider = uma entrada nova neste array — nunca é
 * preciso reconstruir nada para adicionar um.
 *
 * O que este registro NÃO guarda: nada específico da usuária (se ela já
 * está cadastrada, status da conta dela, link de acesso). Isso é o
 * `AffiliateProgram` (por workspace). Este registro é só o catálogo do que
 * existe no mercado — metadado público, igual para todo mundo.
 *
 * `lastVerifiedAt` e `source` existem porque um programa pode fechar,
 * mudar de regra ou de comissão a qualquer momento — nunca assumir que
 * continua disponível/correto para sempre. Ver AffiliateProgramDiscoveryEngine
 * (lib/affiliate-discovery.ts) para a evolução futura que vai manter isso
 * atualizado automaticamente.
 */

export type CategoriaProvider =
  | 'marketplace'
  | 'varejo'
  | 'moda'
  | 'beleza'
  | 'infoprodutos'
  | 'rede-de-afiliacao'
  | 'software'
  | 'outro'

export type TipoPrograma =
  | 'afiliado-direto'
  | 'rede-de-afiliacao'
  | 'programa-proprio-do-varejista'

export interface AffiliateProvider {
  id: string
  nome: string
  categoria: CategoriaProvider
  pais: string
  urlOficial: string
  tipoPrograma: TipoPrograma
  cadastroDisponivel: boolean
  // Como gerar o link de afiliada de forma autorizada (nunca contornar
  // termos de uso): 'link-manual' = a própria usuária copia o link do
  // painel do programa; 'api-oficial' = existe API pública para isso;
  // 'rede-terceira' = o link é gerado pela rede de afiliação, não pelo
  // provider diretamente.
  metodoGeracaoLink: 'link-manual' | 'api-oficial' | 'rede-terceira'
  apiOficialDisponivel: boolean
  catalogoDisponivel: boolean
  rankingTendenciasDisponivel: boolean
  comissaoDisponivel: boolean
  trackingDisponivel: boolean
  automacaoPermitida: boolean
  restricoes: string[]
  canaisDivulgacaoPermitidos: string[]
  regrasDeConteudo: string
  fonteDasRegras: string
  lastVerifiedAt: string // ISO date — quando os campos acima foram checados por último
}

/**
 * Catálogo inicial. Cobre marketplaces, redes de afiliação e programas
 * próprios de varejo/moda/beleza — não é uma lista fechada, é o ponto de
 * partida. `restricoes`/`regrasDeConteudo` são descrições gerais para
 * orientar a usuária; a fonte oficial (`fonteDasRegras`) é sempre o lugar
 * certo para conferir o texto exato antes de agir.
 */
export const AFFILIATE_PROVIDER_REGISTRY: AffiliateProvider[] = [
  {
    id: 'amazon-associados',
    nome: 'Amazon Associados',
    categoria: 'marketplace',
    pais: 'BR',
    urlOficial: 'https://associados.amazon.com.br',
    tipoPrograma: 'afiliado-direto',
    cadastroDisponivel: true,
    metodoGeracaoLink: 'link-manual',
    apiOficialDisponivel: true,
    catalogoDisponivel: true,
    rankingTendenciasDisponivel: true,
    comissaoDisponivel: true,
    trackingDisponivel: true,
    automacaoPermitida: false,
    restricoes: ['Exige aprovação de cadastro', 'Regras próprias de divulgação por categoria'],
    canaisDivulgacaoPermitidos: ['blog', 'redes sociais', 'e-mail (com regras)'],
    regrasDeConteudo: 'Proíbe preços/promessas de desconto não confirmadas; exige disclosure de afiliado.',
    fonteDasRegras: 'https://associados.amazon.com.br/help/operating/agreement',
    lastVerifiedAt: '2026-09-13',
  },
  {
    id: 'mercado-livre',
    nome: 'Mercado Livre (Afiliados)',
    categoria: 'marketplace',
    pais: 'BR',
    urlOficial: 'https://www.mercadolivre.com.br/afiliados',
    tipoPrograma: 'afiliado-direto',
    cadastroDisponivel: true,
    metodoGeracaoLink: 'link-manual',
    apiOficialDisponivel: true,
    catalogoDisponivel: true,
    rankingTendenciasDisponivel: true,
    comissaoDisponivel: true,
    trackingDisponivel: true,
    automacaoPermitida: false,
    restricoes: ['Comissão varia por categoria'],
    canaisDivulgacaoPermitidos: ['redes sociais', 'blog', 'WhatsApp'],
    regrasDeConteudo: 'Proíbe uso de marca em anúncios pagos sem autorização.',
    fonteDasRegras: 'https://www.mercadolivre.com.br/afiliados/termos',
    lastVerifiedAt: '2026-09-13',
  },
  {
    id: 'shopee',
    nome: 'Shopee (Programa de Afiliados)',
    categoria: 'marketplace',
    pais: 'BR',
    urlOficial: 'https://affiliate.shopee.com.br',
    tipoPrograma: 'afiliado-direto',
    cadastroDisponivel: true,
    metodoGeracaoLink: 'link-manual',
    apiOficialDisponivel: true,
    catalogoDisponivel: true,
    rankingTendenciasDisponivel: true,
    comissaoDisponivel: true,
    trackingDisponivel: true,
    automacaoPermitida: false,
    restricoes: ['Janela de cookie curta', 'Regras específicas para Shopee Live/Vídeo'],
    canaisDivulgacaoPermitidos: ['redes sociais', 'blog', 'grupos'],
    regrasDeConteudo: 'Proíbe autocompra para gerar comissão.',
    fonteDasRegras: 'https://affiliate.shopee.com.br/terms',
    lastVerifiedAt: '2026-09-13',
  },
  {
    id: 'tiktok-shop',
    nome: 'TikTok Shop (Afiliados)',
    categoria: 'marketplace',
    pais: 'BR',
    urlOficial: 'https://seller-br.tiktok.com/university',
    tipoPrograma: 'afiliado-direto',
    cadastroDisponivel: true,
    metodoGeracaoLink: 'link-manual',
    apiOficialDisponivel: true,
    catalogoDisponivel: true,
    rankingTendenciasDisponivel: true,
    comissaoDisponivel: true,
    trackingDisponivel: true,
    automacaoPermitida: false,
    restricoes: ['Precisa de conta TikTok elegível (seguidores/atividade mínima varia)'],
    canaisDivulgacaoPermitidos: ['TikTok (vídeo/live)'],
    regrasDeConteudo: 'Selo de conteúdo comercial obrigatório; políticas de live selling próprias.',
    fonteDasRegras: 'https://seller-br.tiktok.com/university/policy',
    lastVerifiedAt: '2026-09-13',
  },
  {
    id: 'hotmart',
    nome: 'Hotmart',
    categoria: 'infoprodutos',
    pais: 'BR',
    urlOficial: 'https://www.hotmart.com',
    tipoPrograma: 'afiliado-direto',
    cadastroDisponivel: true,
    metodoGeracaoLink: 'link-manual',
    apiOficialDisponivel: true,
    catalogoDisponivel: true,
    rankingTendenciasDisponivel: true,
    comissaoDisponivel: true,
    trackingDisponivel: true,
    automacaoPermitida: false,
    restricoes: ['Aprovação por produtor pode ser exigida em produtos com afiliação restrita'],
    canaisDivulgacaoPermitidos: ['redes sociais', 'e-mail', 'blog', 'anúncios (com regras)'],
    regrasDeConteudo: 'Proíbe promessas de resultado; exige transparência sobre ser afiliado.',
    fonteDasRegras: 'https://developers.hotmart.com/docs/en/start/terms-of-use/',
    lastVerifiedAt: '2026-09-13',
  },
  {
    id: 'favoritos-renner',
    nome: 'Favoritos Renner',
    categoria: 'moda',
    pais: 'BR',
    urlOficial: 'https://www.lojasrenner.com.br',
    tipoPrograma: 'programa-proprio-do-varejista',
    cadastroDisponivel: true,
    metodoGeracaoLink: 'rede-terceira',
    apiOficialDisponivel: false,
    catalogoDisponivel: true,
    rankingTendenciasDisponivel: false,
    comissaoDisponivel: true,
    trackingDisponivel: true,
    automacaoPermitida: false,
    restricoes: ['Operado através de uma rede de afiliação parceira — confirmar qual antes de aderir'],
    canaisDivulgacaoPermitidos: ['redes sociais', 'blog'],
    regrasDeConteudo: 'Seguir diretrizes de marca da Renner (uso de logo, imagens oficiais).',
    fonteDasRegras: 'A VERIFICAR — confirmar rede de afiliação vigente antes do cadastro',
    lastVerifiedAt: '2026-09-13',
  },
  {
    id: 'riachuelo',
    nome: 'Riachuelo (Afiliados)',
    categoria: 'moda',
    pais: 'BR',
    urlOficial: 'https://www.riachuelo.com.br',
    tipoPrograma: 'programa-proprio-do-varejista',
    cadastroDisponivel: true,
    metodoGeracaoLink: 'rede-terceira',
    apiOficialDisponivel: false,
    catalogoDisponivel: true,
    rankingTendenciasDisponivel: false,
    comissaoDisponivel: true,
    trackingDisponivel: true,
    automacaoPermitida: false,
    restricoes: ['Operado através de rede de afiliação parceira — confirmar qual antes de aderir'],
    canaisDivulgacaoPermitidos: ['redes sociais', 'blog'],
    regrasDeConteudo: 'Seguir diretrizes de marca da Riachuelo.',
    fonteDasRegras: 'A VERIFICAR — confirmar rede de afiliação vigente antes do cadastro',
    lastVerifiedAt: '2026-09-13',
  },
  {
    id: 'netshoes',
    nome: 'Parceiro Netshoes',
    categoria: 'varejo',
    pais: 'BR',
    urlOficial: 'https://www.netshoes.com.br',
    tipoPrograma: 'programa-proprio-do-varejista',
    cadastroDisponivel: true,
    metodoGeracaoLink: 'rede-terceira',
    apiOficialDisponivel: false,
    catalogoDisponivel: true,
    rankingTendenciasDisponivel: false,
    comissaoDisponivel: true,
    trackingDisponivel: true,
    automacaoPermitida: false,
    restricoes: ['Operado através de rede de afiliação parceira — confirmar qual antes de aderir'],
    canaisDivulgacaoPermitidos: ['redes sociais', 'blog'],
    regrasDeConteudo: 'Seguir diretrizes de marca da Netshoes.',
    fonteDasRegras: 'A VERIFICAR — confirmar rede de afiliação vigente antes do cadastro',
    lastVerifiedAt: '2026-09-13',
  },
  {
    id: 'sephora-rakuten',
    nome: 'Sephora (via Rakuten Advertising)',
    categoria: 'beleza',
    pais: 'BR',
    urlOficial: 'https://www.sephora.com.br',
    tipoPrograma: 'rede-de-afiliacao',
    cadastroDisponivel: true,
    metodoGeracaoLink: 'rede-terceira',
    apiOficialDisponivel: true,
    catalogoDisponivel: true,
    rankingTendenciasDisponivel: false,
    comissaoDisponivel: true,
    trackingDisponivel: true,
    automacaoPermitida: false,
    restricoes: ['Cadastro passa pela plataforma Rakuten Advertising, não diretamente pela Sephora'],
    canaisDivulgacaoPermitidos: ['redes sociais', 'blog', 'e-mail (com regras)'],
    regrasDeConteudo: 'Seguir diretrizes de marca da Sephora e termos da rede Rakuten.',
    fonteDasRegras: 'https://rakutenadvertising.com',
    lastVerifiedAt: '2026-09-13',
  },
  {
    id: 'rakuten-advertising',
    nome: 'Rakuten Advertising',
    categoria: 'rede-de-afiliacao',
    pais: 'Global',
    urlOficial: 'https://rakutenadvertising.com',
    tipoPrograma: 'rede-de-afiliacao',
    cadastroDisponivel: true,
    metodoGeracaoLink: 'rede-terceira',
    apiOficialDisponivel: true,
    catalogoDisponivel: true,
    rankingTendenciasDisponivel: true,
    comissaoDisponivel: true,
    trackingDisponivel: true,
    automacaoPermitida: false,
    restricoes: ['Reúne várias marcas — cada uma com regras próprias de aprovação'],
    canaisDivulgacaoPermitidos: ['varia por marca anunciante'],
    regrasDeConteudo: 'Definida por cada anunciante dentro da rede.',
    fonteDasRegras: 'https://rakutenadvertising.com/legal/',
    lastVerifiedAt: '2026-09-13',
  },
  {
    id: 'awin',
    nome: 'Awin',
    categoria: 'rede-de-afiliacao',
    pais: 'Global',
    urlOficial: 'https://www.awin.com',
    tipoPrograma: 'rede-de-afiliacao',
    cadastroDisponivel: true,
    metodoGeracaoLink: 'rede-terceira',
    apiOficialDisponivel: true,
    catalogoDisponivel: true,
    rankingTendenciasDisponivel: true,
    comissaoDisponivel: true,
    trackingDisponivel: true,
    automacaoPermitida: false,
    restricoes: ['Taxa de adesão pode se aplicar dependendo do país/conta'],
    canaisDivulgacaoPermitidos: ['varia por marca anunciante'],
    regrasDeConteudo: 'Definida por cada anunciante dentro da rede.',
    fonteDasRegras: 'https://www.awin.com/gb/legal',
    lastVerifiedAt: '2026-09-13',
  },
  {
    id: 'impact',
    nome: 'Impact',
    categoria: 'rede-de-afiliacao',
    pais: 'Global',
    urlOficial: 'https://impact.com',
    tipoPrograma: 'rede-de-afiliacao',
    cadastroDisponivel: true,
    metodoGeracaoLink: 'rede-terceira',
    apiOficialDisponivel: true,
    catalogoDisponivel: true,
    rankingTendenciasDisponivel: true,
    comissaoDisponivel: true,
    trackingDisponivel: true,
    automacaoPermitida: false,
    restricoes: ['Reúne várias marcas — cada uma com regras próprias de aprovação'],
    canaisDivulgacaoPermitidos: ['varia por marca anunciante'],
    regrasDeConteudo: 'Definida por cada anunciante dentro da rede.',
    fonteDasRegras: 'https://impact.com/legal/',
    lastVerifiedAt: '2026-09-13',
  },
  {
    id: 'cj-affiliate',
    nome: 'CJ Affiliate',
    categoria: 'rede-de-afiliacao',
    pais: 'Global',
    urlOficial: 'https://www.cj.com',
    tipoPrograma: 'rede-de-afiliacao',
    cadastroDisponivel: true,
    metodoGeracaoLink: 'rede-terceira',
    apiOficialDisponivel: true,
    catalogoDisponivel: true,
    rankingTendenciasDisponivel: true,
    comissaoDisponivel: true,
    trackingDisponivel: true,
    automacaoPermitida: false,
    restricoes: ['Reúne várias marcas — cada uma com regras próprias de aprovação'],
    canaisDivulgacaoPermitidos: ['varia por marca anunciante'],
    regrasDeConteudo: 'Definida por cada anunciante dentro da rede.',
    fonteDasRegras: 'https://www.cj.com/legal',
    lastVerifiedAt: '2026-09-13',
  },
  {
    id: 'lomadee',
    nome: 'Lomadee',
    categoria: 'rede-de-afiliacao',
    pais: 'BR',
    urlOficial: 'https://www.lomadee.com',
    tipoPrograma: 'rede-de-afiliacao',
    cadastroDisponivel: true,
    metodoGeracaoLink: 'rede-terceira',
    apiOficialDisponivel: true,
    catalogoDisponivel: true,
    rankingTendenciasDisponivel: true,
    comissaoDisponivel: true,
    trackingDisponivel: true,
    automacaoPermitida: false,
    restricoes: ['Reúne várias marcas/lojistas — cada um com regras próprias'],
    canaisDivulgacaoPermitidos: ['redes sociais', 'blog', 'e-mail'],
    regrasDeConteudo: 'Definida por cada lojista dentro da rede.',
    fonteDasRegras: 'https://www.lomadee.com/termos',
    lastVerifiedAt: '2026-09-13',
  },
  {
    id: 'monetizze',
    nome: 'Monetizze',
    categoria: 'infoprodutos',
    pais: 'BR',
    urlOficial: 'https://www.monetizze.com.br',
    tipoPrograma: 'afiliado-direto',
    cadastroDisponivel: true,
    metodoGeracaoLink: 'link-manual',
    apiOficialDisponivel: true,
    catalogoDisponivel: true,
    rankingTendenciasDisponivel: true,
    comissaoDisponivel: true,
    trackingDisponivel: true,
    automacaoPermitida: false,
    restricoes: ['Aprovação por produtor pode ser exigida'],
    canaisDivulgacaoPermitidos: ['redes sociais', 'e-mail', 'blog'],
    regrasDeConteudo: 'Proíbe promessas de resultado; exige transparência sobre ser afiliado.',
    fonteDasRegras: 'https://www.monetizze.com.br/termos-de-uso',
    lastVerifiedAt: '2026-09-13',
  },
  {
    id: 'eduzz',
    nome: 'Eduzz',
    categoria: 'infoprodutos',
    pais: 'BR',
    urlOficial: 'https://www.eduzz.com',
    tipoPrograma: 'afiliado-direto',
    cadastroDisponivel: true,
    metodoGeracaoLink: 'link-manual',
    apiOficialDisponivel: true,
    catalogoDisponivel: true,
    rankingTendenciasDisponivel: true,
    comissaoDisponivel: true,
    trackingDisponivel: true,
    automacaoPermitida: false,
    restricoes: ['Aprovação por produtor pode ser exigida'],
    canaisDivulgacaoPermitidos: ['redes sociais', 'e-mail', 'blog'],
    regrasDeConteudo: 'Proíbe promessas de resultado; exige transparência sobre ser afiliado.',
    fonteDasRegras: 'https://www.eduzz.com/termos-de-uso',
    lastVerifiedAt: '2026-09-13',
  },
  {
    id: 'kiwify',
    nome: 'Kiwify',
    categoria: 'infoprodutos',
    pais: 'BR',
    urlOficial: 'https://kiwify.com.br',
    tipoPrograma: 'afiliado-direto',
    cadastroDisponivel: true,
    metodoGeracaoLink: 'link-manual',
    apiOficialDisponivel: true,
    catalogoDisponivel: true,
    rankingTendenciasDisponivel: true,
    comissaoDisponivel: true,
    trackingDisponivel: true,
    automacaoPermitida: false,
    restricoes: ['Aprovação por produtor pode ser exigida'],
    canaisDivulgacaoPermitidos: ['redes sociais', 'e-mail', 'blog'],
    regrasDeConteudo: 'Proíbe promessas de resultado; exige transparência sobre ser afiliado.',
    fonteDasRegras: 'https://kiwify.com.br/termos-de-uso',
    lastVerifiedAt: '2026-09-13',
  },
  {
    id: 'magalu-parceiro',
    nome: 'Magalu Parceiro',
    categoria: 'marketplace',
    pais: 'BR',
    urlOficial: 'https://www.magazineluiza.com.br/parceiro',
    tipoPrograma: 'afiliado-direto',
    cadastroDisponivel: true,
    metodoGeracaoLink: 'link-manual',
    apiOficialDisponivel: false,
    catalogoDisponivel: true,
    rankingTendenciasDisponivel: false,
    comissaoDisponivel: true,
    trackingDisponivel: true,
    automacaoPermitida: false,
    restricoes: ['Modelo de "loja virtual própria" dentro do Magalu, não link de produto avulso'],
    canaisDivulgacaoPermitidos: ['redes sociais', 'WhatsApp'],
    regrasDeConteudo: 'Seguir diretrizes de marca do Magalu.',
    fonteDasRegras: 'https://www.magazineluiza.com.br/parceiro',
    lastVerifiedAt: '2026-09-13',
  },
  {
    id: 'outro',
    nome: 'Outro (cadastro manual)',
    categoria: 'outro',
    pais: '—',
    urlOficial: '',
    tipoPrograma: 'afiliado-direto',
    cadastroDisponivel: true,
    metodoGeracaoLink: 'link-manual',
    apiOficialDisponivel: false,
    catalogoDisponivel: false,
    rankingTendenciasDisponivel: false,
    comissaoDisponivel: true,
    trackingDisponivel: false,
    automacaoPermitida: false,
    restricoes: ['Preencher manualmente — a plataforma não tem metadado próprio para este programa ainda'],
    canaisDivulgacaoPermitidos: ['a critério da usuária, respeitando o programa'],
    regrasDeConteudo: 'Consultar as regras do programa específico antes de divulgar.',
    fonteDasRegras: '—',
    lastVerifiedAt: '2026-09-13',
  },
]

export function listarProviders(): AffiliateProvider[] {
  return AFFILIATE_PROVIDER_REGISTRY
}

export function buscarProvider(id: string): AffiliateProvider | undefined {
  return AFFILIATE_PROVIDER_REGISTRY.find((p) => p.id === id)
}

/**
 * Adiciona (ou substitui) um provider no registro em memória — permite
 * estender o catálogo sem alterar este arquivo (ex.: a partir de um script
 * de manutenção, ou futuramente do AffiliateProgramDiscoveryEngine).
 */
export function registrarProvider(provider: AffiliateProvider) {
  const idx = AFFILIATE_PROVIDER_REGISTRY.findIndex((p) => p.id === provider.id)
  if (idx >= 0) AFFILIATE_PROVIDER_REGISTRY[idx] = provider
  else AFFILIATE_PROVIDER_REGISTRY.push(provider)
}
