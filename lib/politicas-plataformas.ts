/**
 * P2.45 — Registro das FONTES OFICIAIS que fundamentam o Quality Gate de Conformidade.
 * Cada fonte: URL oficial, data da consulta, versão/vigência quando a página informa, trecho curto e abrangência.
 * Mudou a política? `scripts/conformidade/acompanhar-politicas.ts` sinaliza; o requisito só muda após validação e com
 * nova VERSAO_DAS_REGRAS. "Não verificado" = a página não pôde ser lida (só JavaScript/login): NÃO significa
 * ausência de regra.
 */
export interface Fonte {
  id: string
  titulo: string
  url: string
  consultadoEm: string
  versao: string | null
  trecho: string
  abrangencia: 'GLOBAL' | 'BR'
  verificado: boolean
}

export const VERSAO_DAS_REGRAS = '2026-10-20.2'

const f = (id: string, titulo: string, url: string, versao: string | null, trecho: string, abrangencia: 'GLOBAL' | 'BR', verificado = true): [string, Fonte] =>
  [id, { id, titulo, url, consultadoEm: '2026-10-20', versao, trecho, abrangencia, verificado }]

export const FONTES: Record<string, Fonte> = Object.fromEntries([
  f('tiktok.cg.aigc', 'Diretrizes da Comunidade — Integridade e autenticidade (conteúdo gerado por IA)', 'https://www.tiktok.com/community-guidelines/pt/integrity-authenticity', 'vigência 24/09/2026 (publicada 25/08/2026)',
    'exigimos que os criadores identifiquem conteúdo gerado por AI ou significativamente editado … que mostre cenas ou pessoas realistas', 'GLOBAL'),
  f('tiktok.shop.ia-br', 'TikTok Shop BR — Restrições e requisitos para conteúdo gerado por IA', 'https://seller-br.tiktok.com/university/essay?knowledge_id=2324329879832321', '20/09/2026 (aplica-se a: Brasil)',
    'se o seu conteúdo for total ou significativamente criado/alterado por IA, você deve sinalizá-lo como tal (inclui vozes sintéticas); proibido usar IA para fabricar exibições de produtos', 'BR'),
  f('tiktok.suporte.rotulo-ia', 'Central de Ajuda — rótulo de conteúdo gerado por IA (passo a passo no app)', 'https://support.tiktok.com/en/using-tiktok/creating-videos/ai-generated-content', null,
    'Página só com JavaScript: não verificada automaticamente (o caminho "Mais opções → Conteúdo gerado por IA" vem de resumo oficial de busca).', 'GLOBAL', false),
  f('tiktok.cg.integridade', 'Diretrizes da Comunidade — conteúdo original / enganoso', 'https://www.tiktok.com/community-guidelines/en/integrity-authenticity', 'vigência 24/09/2026',
    'Content is also ineligible for the FYF if it includes unoriginal or reused material without anything new.', 'GLOBAL'),
  f('tiktok.cg.menores', 'Diretrizes da Comunidade — Segurança de jovens', 'https://www.tiktok.com/community-guidelines/en/youth-safety', 'vigência 24/09/2026',
    "We don't allow content that could harm young people—physically, emotionally, or developmentally.", 'GLOBAL'),
  f('tiktok.shop.conteudo', 'TikTok Shop BR — Política de Conteúdo (originalidade, produto exibido = produto vinculado)', 'https://seller-br.tiktok.com/university/essay?knowledge_id=1413208980588305', '01/07/2026',
    '3.13.2: "Todos os produtos promovidos devem ser relevantes e claramente exibidos no conteúdo relacionado." 3.13.1: conteúdo original com edições novas ou criativas; 3.8: proibido conteúdo direcionado a menores.', 'BR'),
  f('tiktok.shop.alegacoes', 'TikTok Shop BR — Política de Conteúdo (alegações)', 'https://seller-br.tiktok.com/university/essay?knowledge_id=1413208980588305', '01/07/2026',
    '3.10.2: proíbe "promessas exageradas sobre o desempenho, o efeito ou o preço de um produto"; 3.10.3: afirmações absolutas sem provas; 3.10.6: alegações médicas/terapêuticas restritas.', 'BR'),
  f('tiktok.shop.vinculo', 'TikTok Shop BR — Política de Conteúdo (produto e links)', 'https://seller-br.tiktok.com/university/essay?knowledge_id=1413208980588305', '01/07/2026',
    '3.10.1: o produto mostrado deve ser o produto vinculado; 3.11/3.12: sem links ou chamadas para fora do TikTok Shop.', 'BR'),
  f('tiktok.termos-criador-br', 'TikTok Shop BR — Termos de Uso do Criador', 'https://seller-br.tiktok.com/university/essay?knowledge_id=3275818982590224', 'página mostra 23/07/2025',
    'o Conteúdo do Criador incluirá declaração clara e visível indicando que se trata de uma promoção patrocinada e que o Criador mantém relação comercial com o Vendedor … utilizando divulgações apropriadas, como hashtags; utilizará qualquer funcionalidade de rotulagem publicitária disponibilizada por nós (como o botão de Conteúdo Patrocinado); somente poderá usar trilhas disponibilizadas por nós ou trilhas originais que você possua', 'BR'),
  f('tiktok.branded-content', 'Política de Conteúdo de Marca (pt-BR)', 'https://www.tiktok.com/legal/page/global/bc-policy/pt-BR', 'publicada 04/08/2026, vigência 31/08/2026',
    'Conteúdo de marca "é todo conteúdo que promove ou analisa uma marca de terceiros ou seus produtos ou serviços em troca de pagamento ou qualquer outro incentivo", incluindo "um produto ou serviço para o qual você receberá comissão sobre as vendas (por exemplo, por meio de um link de afiliado…)"; é obrigatório ativar a divulgação de conteúdo comercial. Não exige contrato com a marca.', 'GLOBAL'),
  f('tiktok.ads.divulgacao', 'Ajuda TikTok Ads — como ativar a Divulgação de conteúdo comercial', 'https://ads.tiktok.com/resources/help/article/how-to-turn-on-the-commercial-content-disclosure-setting-in-tiktok', 'atualizada jan/2026',
    '"Select whether you’re promoting Your brand or Branded content. After selecting Branded content, click Brand partnership to tag a brand partner." O rótulo exibido é "Paid partnership" ao promover terceiro.', 'GLOBAL'),
  f('tiktok.musica-comercial', 'Biblioteca de Música Comercial + Termos do Criador BR (cláusula 11)', 'https://ads.tiktok.com/help/article/commercial-music-library', 'atualizada jul/2025',
    'Businesses should instead use the Commercial Music Library for all commercial TikTok activities; Termos BR: trilhas da plataforma ou trilhas originais que você possua (pode haver pop-up de Confirmação de Uso de Música).', 'GLOBAL'),
  f('tiktok.ip', 'TikTok Shop BR — Política de Conteúdo 3.7 (propriedade intelectual)', 'https://seller-br.tiktok.com/university/essay?knowledge_id=1413208980588305', '01/07/2026',
    'proíbe conteúdo que viole os direitos de propriedade intelectual de terceiros; marcas e logotipos para ganho comercial exigem permissão expressa.', 'BR'),
  f('tiktok.upload', 'Content Posting API — Media Transfer Guide (requisitos de vídeo)', 'https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide', 'atualizada 04/08/2026',
    'MP4 (recomendado)/WebM/MOV; H.264 (recomendado)/H.265/VP8/VP9; 23–60 fps; 360–4096 px por lado; até 4 GB; até 10 min (envio por API).', 'GLOBAL'),
  f('br.cdc.art36', 'Código de Defesa do Consumidor, art. 36', 'https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm', 'Lei 8.078/1990 (compilada)',
    'A publicidade deve ser veiculada de tal forma que o consumidor, fácil e imediatamente, a identifique como tal.', 'BR'),
  f('br.cdc.art37', 'Código de Defesa do Consumidor, art. 37 (enganosa/abusiva; §2º criança)', 'https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm', 'Lei 8.078/1990 (compilada)',
    '§2º: é abusiva a publicidade que se aproveite da deficiência de julgamento e experiência da criança.', 'BR'),
  f('br.conar.guia-influenciadores', 'CONAR — Guia de Marketing e Publicidade por Influenciadores Digitais 2026', 'https://conar.wpenginepowered.com/wp-content/uploads/2026/05/260525_GUIA_INFLUENCIADORES_CONAR_v6.pdf', 'v6, vigência 01/06/2026',
    'NÃO VERIFICADO por acesso permitido (o servidor do PDF proíbe acesso automático no robots.txt; a cópia do conar.org.br responde "Forbidden"). Trecho lido em pesquisa anterior, a reconferir manualmente: identificação publicitária no início do vídeo ou no momento do endosso. Verificado no Código do CONAR, art. 28: "O anúncio deve ser claramente distinguido como tal".', 'BR', false),
  f('br.lda.art46', 'Lei de Direitos Autorais (9.610/1998), art. 46, VIII', 'https://www.planalto.gov.br/ccivil_03/leis/l9610.htm', 'Lei 9.610/1998',
    'não constitui ofensa … a reprodução … de pequenos trechos de obras preexistentes … sempre que a reprodução em si não seja o objetivo principal da obra nova e que não prejudique a exploração normal da obra reproduzida', 'BR'),
  f('br.conanda.163', 'Resolução CONANDA 163/2014 (publicidade dirigida à criança)', 'https://www.gov.br/mdh/pt-br/acesso-a-informacao/participacao-social/old/conselho-nacional-dos-direitos-da-crianca-e-do-adolescente-conanda/resolucoes/resolucao-163-_publicidade-infantil.pdf', 'Res. 163/2014',
    'art. 2º: abusivo o direcionamento de publicidade à criança com a intenção de persuadi-la para o consumo (ex.: linguagem infantil, músicas infantis, desenho animado).', 'BR'),
])
