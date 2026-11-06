/**
 * P2.45 — Quality Gate de CONFORMIDADE da plataforma (regra permanente). FUNÇÃO PURA, determinística.
 *
 * Independente do Quality Gate Comercial: nota criativa alta NÃO libera nada. Cada requisito vem de uma FONTE OFICIAL
 * registrada (`politicas-plataformas.ts`: URL, data da consulta, versão, trecho) e é configurável por plataforma, país,
 * categoria e modalidade de publicação. Resultado por requisito: CONFORME | NAO_CONFORME | PENDENTE | NAO_APLICAVEL,
 * sempre com fundamento e evidência. "Nenhuma infração encontrada" ≠ "o TikTok vai aprovar".
 *
 * Momento do requisito:
 *   ANTES          — precisa estar resolvido para LIBERAR a publicação (bloqueia);
 *   NA_PUBLICACAO  — só existe no app no momento de postar (marcar produto, rótulo de IA, divulgação): entra no
 *                    CHECKLIST obrigatório da publicação e é conferido depois (link do post), sem bloquear antes.
 * Pendência que depende de terceiros (ex.: autorização da editora) pode ser resolvida por EVIDÊNCIA documentada;
 * onde a regra permitir, a titular pode ACEITAR O RISCO por escrito — o item continua PENDENTE (nunca vira CONFORME),
 * mas deixa de bloquear e fica registrado como decisão dela.
 */
import { FONTES, VERSAO_DAS_REGRAS, type Fonte } from './politicas-plataformas'
import { claimsNaoComprovados } from './copy-por-canal'

export type Status = 'CONFORME' | 'NAO_CONFORME' | 'PENDENTE' | 'NAO_APLICAVEL'
export type Plataforma = 'tiktok' | 'instagram' | 'youtube' | 'facebook'
// P2.62: AFILIADO_LINK_EXTERNO = afiliada de programa fora do TikTok Shop (ex.: Mercado Livre) com link na bio —
// sem sacolinha/marcação; a divulgação comercial continua obrigatória.
export type Modalidade = 'AFILIADO_TIKTOK_SHOP' | 'AFILIADO_LINK_EXTERNO' | 'CONTEUDO_ORGANICO' | 'PUBLI_DE_MARCA'
export type ObraProtegida = 'CAPA' | 'CONTRACAPA' | 'FOLHA_DE_ROSTO' | 'PAGINA_INTERNA' | 'ILUSTRACAO_INTERNA'

/**
 * P2.45.1 — NATUREZAS diferentes de resolução (nunca equivalentes):
 *  - AUTORIZACAO_DOS_TITULARES: concedida por quem DETÉM o direito (editora, autor, ilustrador) ou por licenciado com
 *    poder de sublicenciar, DOCUMENTADA → CONFORME;
 *  - AUTORIZACAO_DE_TERCEIRO: ex.: o vendedor da loja diz "pode usar" sem provar a titularidade → continua PENDENTE
 *    (o vendedor não é, necessariamente, titular dos direitos da obra);
 *  - ANALISE_JURIDICA_FUNDAMENTADA: parecer escrito de profissional habilitado, sobre ESTE arquivo (sha256), concluindo
 *    "USO_PERMITIDO" → CONFORME, com fundamento "análise jurídica" (distinto de autorização); outra conclusão não resolve;
 *  - RISCO_RESIDUAL_ACEITO: decisão da titular, REGISTRADA, que NÃO resolve nem desbloqueia direitos autorais;
 *  - CONFIRMADO_PELA_TITULAR: confirmação de fato simples (ex.: produto conferido) → CONFORME onde a regra admitir.
 */
export interface Resolucao {
  tipo: 'AUTORIZACAO_DOS_TITULARES' | 'AUTORIZACAO_DE_TERCEIRO' | 'ANALISE_JURIDICA_FUNDAMENTADA' | 'RISCO_RESIDUAL_ACEITO' | 'CONFIRMADO_PELA_TITULAR'
  em: string
  detalhe: string
  /** quem concedeu/assinou e em que qualidade (EDITORA, AUTOR, ILUSTRADOR, LICENCIADO_COM_PODER_DE_SUBLICENCIAR, ADVOGADO…) */
  concedente?: { nome: string; qualidade: string; registro?: string }
  /** documento guardado (caminho/identificador), nunca o conteúdo */
  documento?: string
  /** ANALISE_JURIDICA_FUNDAMENTADA: conclusão e o arquivo analisado */
  conclusao?: 'USO_PERMITIDO' | 'USO_NAO_PERMITIDO' | 'INCONCLUSIVO'
  sha256DoVideo?: string
}
const TITULARES = new Set(['EDITORA', 'AUTOR', 'AUTORA', 'ILUSTRADOR', 'ILUSTRADORA', 'TITULAR', 'LICENCIADO_COM_PODER_DE_SUBLICENCIAR'])

export interface ContextoDeConformidade {
  plataforma: Plataforma
  pais: string
  categoria: string
  modalidade: Modalidade
  arquivo: { largura: number; altura: number; duracaoS: number; tamanhoBytes: number; codecVideo: string; codecAudio: string | null; fps: number; errosDeDecodificacao: number; sha256?: string }
  textos: { narracao: string[]; naTela: string[]; legendaDoPost: string; hashtags: string[]; /** "#publi"/"publicidade" legível na tela nos primeiros segundos */ publiNaTelaNoInicio: boolean }
  voz: { sintetica: boolean; daPropriaTitular: boolean; consentimentoRegistrado: boolean } | null
  imagens: { geradasPorIA: boolean; midiasReaisDaTitular: boolean; declaracaoDeAutoria: boolean; obraProtegida: ObraProtegida[]; textoInternoLegivelS: number; ilustracaoInternaS: number; menoresNaTela: boolean
    /** P2.51: só gráficos gerados pelo próprio Patrono (originais), SEM o produto real na tela */
    graficosDoPatrono?: boolean
    /** P2.72: fotos/vídeos de TERCEIRO sob licença documentada que permite uso comercial e edição (ex.: CC BY-SA 4.0) */
    midiasLicenciadas?: { licenca: string; fonte: string } | null }
  trilha: { tipo: 'PROPRIA' | 'BIBLIOTECA_COMERCIAL' | 'BIBLIOTECA_GERAL' | 'TERCEIROS_LICENCIADA' | 'TERCEIROS_SEM_LICENCA' | 'NENHUMA'; evidencia: string | null }
  /** `fonteOficialDisponivel`: há leitor OFICIAL do produto (API de afiliados conectada). Sem ele, a conferência é feita
   *  no card oficial do produto que o próprio app mostra ao MARCAR (passo já obrigatório) — sem conferência extra. */
  produto: { idNaLoja: string | null; nome: string; categoriaNaLoja: string | null; listagemConferida: boolean; fonteOficialDisponivel?: boolean }
  /** conteúdo dirigido a crianças (não "sobre" crianças): linguagem, apelo e público-alvo infantis */
  dirigidoACriancas: boolean
  resolucoes?: Record<string, Resolucao>
}

export interface Achado {
  id: string
  titulo: string
  status: Status
  momento: 'ANTES' | 'NA_PUBLICACAO'
  bloqueia: boolean
  fundamento: string
  evidencia: string
  comoResolver?: string
  correcaoAutomatica?: boolean
  fontes: Pick<Fonte, 'id' | 'url' | 'consultadoEm'>[]
  resolucao?: Resolucao
}

export interface RelatorioDeConformidade {
  veredito: 'APTO' | 'APTO_APOS_CORRECOES' | 'BLOQUEADO'
  resumo: string
  achados: Achado[]
  checklistDaPublicacao: string[]
  versaoDasRegras: string
}

interface Requisito {
  id: string
  titulo: string
  plataformas: Plataforma[]
  paises: string[] | '*'
  modalidades?: Modalidade[]
  categorias?: string[]
  momento: 'ANTES' | 'NA_PUBLICACAO'
  bloqueante: boolean
  fontes: string[]
  verificar(c: ContextoDeConformidade): Omit<Achado, 'id' | 'titulo' | 'momento' | 'bloqueia' | 'fontes'>
}

const PROMESSA = /\b(desenvolv(e|imento)|terap|comprovad|cientificamente|cura|garantid|resolve|acaba com|melhora (o|a|seu|sua)|ajuda (seu|sua|a crian)|intelig[eê]ncia ?emocional|ampliar o vocabul|aumenta (a|o))/i
// "#ad" e termos em inglês sozinhos podem ser insuficientes no BR (Guia CONAR 2026): só contam termos em português.
const DIVULGACAO = /(#publi\b|#publicidade|publicidade|conte[uú]do de afiliad|afiliad[ao]|comiss[aã]o|parceria paga)/i
const ROTULO_IA = /(gerad[ao] por (intelig[eê]ncia artificial|ia)|voz (gerada|sint[eé]tica)|#ia\b|conte[uú]do gerado por ia)/i
const LIVRO = /(livro|livros|literatura|infantil)/i

const R: Requisito[] = [
  {
    id: 'tecnico.formato', titulo: 'Formato, resolução, duração e integridade do arquivo', plataformas: ['tiktok'], paises: '*', momento: 'ANTES', bloqueante: true,
    fontes: ['tiktok.upload'],
    verificar: (c) => {
      const a = c.arquivo
      const prob: string[] = []
      if (!(a.altura > a.largura && Math.abs(a.largura / a.altura - 9 / 16) < 0.02)) prob.push('não é vertical 9:16')
      if (a.largura < 720) prob.push(`largura ${a.largura}px < 720`)
      if (a.duracaoS < 3 || a.duracaoS > 600) prob.push(`duração ${a.duracaoS}s fora do aceito pelo app`)
      if (!/h264|hevc|h265/i.test(a.codecVideo)) prob.push(`codec ${a.codecVideo}`)
      if (a.errosDeDecodificacao > 0) prob.push(`${a.errosDeDecodificacao} erro(s) de decodificação`)
      return prob.length
        ? { status: 'NAO_CONFORME', fundamento: 'Requisitos de envio do app.', evidencia: prob.join('; '), correcaoAutomatica: true, comoResolver: 'O Patrono renderiza de novo em 1080×1920 H.264.' }
        : { status: 'CONFORME', fundamento: 'Vertical, resolução e duração dentro do aceito pelo app; arquivo íntegro.', evidencia: `${a.largura}×${a.altura}, ${a.duracaoS}s, ${a.fps} fps, ${a.codecVideo}/${a.codecAudio}, ${(a.tamanhoBytes / 1e6).toFixed(1)} MB, ${a.errosDeDecodificacao} erros na decodificação completa` }
    },
  },
  {
    id: 'ia.rotulo', titulo: 'Rótulo de conteúdo gerado por IA (voz sintética realista)', plataformas: ['tiktok'], paises: '*', momento: 'NA_PUBLICACAO', bloqueante: true,
    fontes: ['tiktok.cg.aigc', 'tiktok.shop.ia-br', 'tiktok.suporte.rotulo-ia'],
    verificar: (c) => {
      const precisa = !!c.voz?.sintetica || c.imagens.geradasPorIA
      if (!precisa) return { status: 'NAO_APLICAVEL', fundamento: 'Sem voz ou imagem sintética.', evidencia: 'voz humana gravada; imagens reais' }
      const naLegenda = ROTULO_IA.test(c.textos.legendaDoPost)
      return {
        status: 'PENDENTE',
        fundamento: 'Conteúdo realista gerado/alterado por IA exige o rótulo de IA da plataforma; a menção na legenda complementa, não substitui.',
        evidencia: `voz sintética: ${c.voz?.sintetica ? 'sim (da própria titular, consentida)' : 'não'}; menção na legenda: ${naLegenda ? 'sim' : 'NÃO'}`,
        comoResolver: 'Na tela de postar: Mais opções → ativar "Conteúdo gerado por IA".' + (naLegenda ? '' : ' E incluir a frase de IA na legenda (o Patrono inclui automaticamente).'),
      }
    },
  },
  {
    id: 'ia.legenda', titulo: 'Menção à voz gerada por IA na legenda do post', plataformas: ['tiktok', 'instagram', 'youtube', 'facebook'], paises: '*', momento: 'ANTES', bloqueante: true,
    fontes: ['tiktok.cg.aigc'],
    verificar: (c) => !c.voz?.sintetica
      ? { status: 'NAO_APLICAVEL', fundamento: 'Sem voz sintética.', evidencia: '—' }
      : ROTULO_IA.test(c.textos.legendaDoPost)
        ? { status: 'CONFORME', fundamento: 'Transparência sobre a voz sintética no texto do post.', evidencia: 'legenda menciona a voz gerada por IA' }
        : { status: 'NAO_CONFORME', fundamento: 'A voz é sintética e a legenda não diz isso.', evidencia: 'sem menção na legenda', correcaoAutomatica: true, comoResolver: 'O Patrono acrescenta: "Narração com voz gerada por inteligência artificial a partir da minha própria voz."' },
  },
  {
    id: 'divulgacao.afiliado', titulo: 'Identificação da publicidade / relação de afiliada', plataformas: ['tiktok', 'instagram', 'youtube', 'facebook'], paises: ['BR'], momento: 'ANTES', bloqueante: true,
    fontes: ['br.cdc.art36', 'br.conar.guia-influenciadores', 'tiktok.termos-criador-br'],
    verificar: (c) => DIVULGACAO.test(c.textos.legendaDoPost)
      ? { status: 'CONFORME', fundamento: 'Publicidade identificada de forma clara (CDC art. 36; Guia CONAR).', evidencia: (c.textos.legendaDoPost.match(DIVULGACAO) ?? [''])[0] }
      : { status: 'NAO_CONFORME', fundamento: 'Conteúdo comissionado precisa ser identificado como publicidade.', evidencia: 'legenda sem identificação', correcaoAutomatica: true, comoResolver: 'O Patrono acrescenta "#publi" e "Conteúdo de afiliada — posso receber comissão pelas compras."' },
  },
  {
    id: 'divulgacao.chave', titulo: 'Chave de divulgação de conteúdo comercial do app', plataformas: ['tiktok'], paises: '*', modalidades: ['AFILIADO_TIKTOK_SHOP', 'AFILIADO_LINK_EXTERNO', 'PUBLI_DE_MARCA'], momento: 'NA_PUBLICACAO', bloqueante: true,
    fontes: ['tiktok.branded-content', 'tiktok.ads.divulgacao', 'tiktok.termos-criador-br'],
    verificar: (c) => c.modalidade === 'AFILIADO_TIKTOK_SHOP'
      ? { status: 'PENDENTE', fundamento: 'Afiliada do TikTok Shop sem contrato com a editora: pela definição oficial, a COMISSÃO é o "incentivo" — é "Conteúdo de marca" (rótulo "Parceria paga"), não "Sua marca" (que é para o próprio negócio). A política não exige contrato com a marca; os Termos do Criador BR descrevem a relação como "relação comercial com o Vendedor". Nenhuma fonte oficial diz que a sacolinha dispensa o botão.', evidencia: 'só se ativa no app, ao postar', comoResolver: 'Ao postar: Mais opções → "Divulgação de conteúdo comercial" → ativar → "Conteúdo de marca". Se o app pedir para marcar um parceiro de marca, não marcar a editora (não há parceria direta com ela); seguir sem marcar, se o app permitir (não verificado).' }
      : { status: 'PENDENTE', fundamento: 'Conteúdo com contrapartida de terceiro exige a divulgação de conteúdo comercial.', evidencia: 'só se ativa no app, ao postar', comoResolver: 'Ao postar: ativar "Divulgação de conteúdo comercial" e escolher a opção correspondente.' },
  },
  {
    id: 'divulgacao.na-tela', titulo: 'Identificação publicitária visível no INÍCIO do vídeo', plataformas: ['tiktok', 'instagram', 'youtube', 'facebook'], paises: ['BR'], momento: 'ANTES', bloqueante: true,
    fontes: ['tiktok.termos-criador-br', 'br.cdc.art36', 'br.conar.guia-influenciadores'],
    verificar: (c) => c.textos.publiNaTelaNoInicio
      ? { status: 'CONFORME', fundamento: 'Identificação clara e visível desde o início (Termos do Criador BR: "declaração clara e visível … como hashtags"; CDC art. 36: identificação fácil e imediata), além da legenda. O Guia CONAR 2026 vai no mesmo sentido (trecho não reverificado por acesso permitido).', evidencia: '"#publi" legível na tela desde os primeiros segundos' }
      : { status: 'NAO_CONFORME', fundamento: 'A identificação publicitária deve aparecer no início do vídeo ou no momento do endosso — só na legenda não basta para quem assiste.', evidencia: 'nenhum "#publi"/"publicidade" na tela no início', correcaoAutomatica: true, comoResolver: 'O Patrono acrescenta "#publi" fixo e legível desde o 1º segundo (sem cobrir o produto).' },
  },
  {
    id: 'musica.confirmacao', titulo: 'Confirmação de uso de música original no app', plataformas: ['tiktok'], paises: ['BR'], momento: 'NA_PUBLICACAO', bloqueante: false,
    fontes: ['tiktok.termos-criador-br'],
    verificar: (c) => c.trilha.tipo === 'PROPRIA'
      ? { status: 'PENDENTE', fundamento: 'Trilha original pode exigir aceitar o pop-up de Confirmação de Uso de Música.', evidencia: c.trilha.evidencia ?? 'trilha própria', comoResolver: 'Se aparecer o aviso de uso de música ao postar, confirmar que a trilha é original (a prova de autoria fica com o Patrono).' }
      : { status: 'NAO_APLICAVEL', fundamento: 'Trilha não é original própria.', evidencia: c.trilha.tipo },
  },
  {
    id: 'alegacoes', titulo: 'Sem promessas ou benefícios não comprovados', plataformas: ['tiktok', 'instagram', 'youtube', 'facebook'], paises: '*', momento: 'ANTES', bloqueante: true,
    fontes: ['tiktok.shop.alegacoes', 'br.cdc.art37'],
    verificar: (c) => {
      const tudo = [...c.textos.narracao, ...c.textos.naTela, c.textos.legendaDoPost, ...c.textos.hashtags].join(' \n ')
      const achados = [...new Set([...(tudo.match(new RegExp(PROMESSA.source, 'gi')) ?? []), ...claimsNaoComprovados(tudo)])]
      return achados.length
        ? { status: 'NAO_CONFORME', fundamento: 'Benefício (desenvolvimento, terapêutico, educacional) sem comprovação não pode ser afirmado.', evidencia: achados.join(', '), correcaoAutomatica: true, comoResolver: 'O Patrono troca por descrição factual do produto (o que o livro É, não o que ele "causa").' }
        : { status: 'CONFORME', fundamento: 'Só descrição factual do produto.', evidencia: 'narração, textos da tela, legenda e hashtags sem promessa' }
    },
  },
  {
    id: 'produto.fidelidade', titulo: 'Demonstração fiel do produto (sem alteração por IA)', plataformas: ['tiktok'], paises: '*', modalidades: ['AFILIADO_TIKTOK_SHOP'], momento: 'ANTES', bloqueante: true,
    fontes: ['tiktok.shop.conteudo'],
    verificar: (c) => c.imagens.geradasPorIA
      ? { status: 'PENDENTE', fundamento: 'Imagem gerada por IA: a nota de similaridade não basta (P2.84, caso ia-heroi: inscrições trocadas aprovadas com 0,971); inscrições e componentes do produto exigem conferência humana registrada no arquivo exato.', evidencia: 'há imagem gerada por IA', comoResolver: 'Rodar a checagem de fidelidade E registrar a conferência das inscrições (lib/video-pro/inscricoes.ts).' }
      : c.imagens.graficosDoPatrono && !c.imagens.midiasReaisDaTitular
        ? { status: 'PENDENTE', fundamento: 'O produto real não aparece: gráficos do Patrono não demonstram o produto.', evidencia: 'só gráficos gerados localmente pelo Patrono', comoResolver: 'Gravar o produto (mídia própria) ou obter mídia licenciada/autorizada pelo vendedor.' }
      : c.imagens.midiasReaisDaTitular && c.imagens.declaracaoDeAutoria
        ? { status: 'CONFORME', fundamento: 'Só filmagens reais do exemplar físico, feitas pela titular (declaração registrada).', evidencia: 'mídias reais, sem IA na imagem' }
        : { status: 'PENDENTE', fundamento: 'Origem das imagens não comprovada.', evidencia: 'sem declaração de autoria', comoResolver: 'Registrar a declaração de autoria das mídias.' },
  },
  {
    id: 'produto.vinculo', titulo: 'Produto correto e coerente com o vídeo e a legenda', plataformas: ['tiktok'], paises: '*', modalidades: ['AFILIADO_TIKTOK_SHOP'], momento: 'NA_PUBLICACAO', bloqueante: true,
    fontes: ['tiktok.shop.conteudo', 'tiktok.shop.vinculo'],
    verificar: (c) => {
      const nomeOk = c.textos.narracao.join(' ').toLowerCase().includes(c.produto.nome.replace(/^livro\s+/i, '').toLowerCase())
      const catTxt = c.produto.categoriaNaLoja ?? ''
      const catIncoerente = c.categoria === 'LIVROS' && catTxt && !LIVRO.test(catTxt)
      if (!c.produto.idNaLoja) return { status: 'NAO_CONFORME', fundamento: 'Sem produto da loja para vincular.', evidencia: '—' }
      const ev = `produto ${c.produto.idNaLoja} ("${c.produto.nome}"); nome dito na narração: ${nomeOk ? 'sim' : 'não'}${catIncoerente ? `; categoria no cadastro do Patrono "${catTxt}" (dado interno, não do TikTok)` : ''}`
      if (c.produto.listagemConferida) return { status: 'CONFORME', fundamento: 'Produto da listagem oficial = exemplar filmado; nome dito no vídeo.', evidencia: ev }
      if (c.produto.fonteOficialDisponivel) return { status: 'PENDENTE', fundamento: 'Há leitor oficial: o Patrono confere a listagem sozinho antes de liberar.', evidencia: ev, comoResolver: 'Automático (leitor oficial do TikTok Shop).' }
      return {
        status: 'PENDENTE', fundamento: 'Sem dado oficial do produto acessível ao Patrono (API de afiliados do TikTok Shop indisponível para a conta; sem importação do Creator Center). Não se lê a página do produto (regra do Patrono: só fonte oficial). O card oficial do produto aparece no app no passo obrigatório de marcação.',
        evidencia: ev,
        comoResolver: `Ao MARCAR o produto ${c.produto.idNaLoja} no app, conferir no card que título e capa são do Emocionário — Diga o que você sente (Sextante). Se não forem, não publicar.`,
      }
    },
  },
  {
    id: 'produto.marcacao', titulo: 'Marcação do produto no post (sacolinha)', plataformas: ['tiktok'], paises: '*', modalidades: ['AFILIADO_TIKTOK_SHOP'], momento: 'NA_PUBLICACAO', bloqueante: true,
    fontes: ['tiktok.shop.vinculo'],
    verificar: (c) => {
      const citaCesta = /sacolinha|carrinho|cesta/i.test([...c.textos.narracao, ...c.textos.naTela, c.textos.legendaDoPost].join(' '))
      return { status: 'PENDENTE', fundamento: 'O vídeo convida a comprar pela sacolinha: só pode ir ao ar com o produto marcado.', evidencia: citaCesta ? 'narração/legenda citam a sacolinha' : 'sem menção à sacolinha', comoResolver: `Ao postar: Adicionar link → Produtos → produto ${c.produto.idNaLoja}.` }
    },
  },
  {
    id: 'musica', titulo: 'Trilha sonora com direito de uso comercial', plataformas: ['tiktok', 'instagram', 'youtube', 'facebook'], paises: '*', momento: 'ANTES', bloqueante: true,
    fontes: ['tiktok.musica-comercial'],
    verificar: (c) => {
      const t = c.trilha
      if (t.tipo === 'NENHUMA') return { status: 'NAO_APLICAVEL', fundamento: 'Sem música.', evidencia: '—' }
      if (t.tipo === 'PROPRIA' && t.evidencia) return { status: 'CONFORME', fundamento: 'Música original própria, sem obra de terceiros.', evidencia: t.evidencia }
      if (t.tipo === 'BIBLIOTECA_COMERCIAL') return { status: 'CONFORME', fundamento: 'Biblioteca de Música Comercial do TikTok (liberada para uso comercial).', evidencia: t.evidencia ?? 'escolhida no app' }
      if (t.tipo === 'TERCEIROS_LICENCIADA' && t.evidencia) return { status: 'CONFORME', fundamento: 'Licença comercial documentada.', evidencia: t.evidencia }
      return { status: 'NAO_CONFORME', fundamento: 'Música sem licença para uso comercial (inclui a biblioteca geral em conteúdo promocional).', evidencia: t.tipo, comoResolver: 'Trocar por trilha própria ou da Biblioteca de Música Comercial.' }
    },
  },
  {
    id: 'direitos.obra', titulo: 'Direitos autorais sobre capa, páginas e ilustrações', plataformas: ['tiktok', 'instagram', 'youtube', 'facebook'], paises: ['BR'], momento: 'ANTES', bloqueante: true,
    fontes: ['tiktok.ip', 'br.lda.art46'],
    verificar: (c) => {
      const i = c.imagens
      if (!i.obraProtegida.length) return { status: 'NAO_APLICAVEL', fundamento: 'Nenhuma obra de terceiros na imagem.', evidencia: '—' }
      if (i.textoInternoLegivelS > 0.3 || i.ilustracaoInternaS > 4) return { status: 'NAO_CONFORME', fundamento: 'Reprodução de conteúdo interno além de trechos breves.', evidencia: `texto legível ${i.textoInternoLegivelS}s; ilustração ${i.ilustracaoInternaS}s`, correcaoAutomatica: true, comoResolver: 'O Patrono remonta com menos páginas internas (como a v5/v6).' }
      return {
        status: 'PENDENTE',
        fundamento: 'Mostrar o produto à venda (capa, contracapa) e trechos breves em movimento reduz o risco, mas o uso é comercial e a Lei 9.610 não traz exceção expressa para publicidade; só a editora/titulares autorizam com segurança.',
        evidencia: `mostra: ${i.obraProtegida.join(', ')}; texto interno legível ${i.textoInternoLegivelS}s; ilustração interna ${i.ilustracaoInternaS}s (em movimento)`,
        comoResolver: 'Resolve: (1) autorização por escrito de quem DETÉM os direitos (editora, autores/ilustradores) ou de licenciado com poder de sublicenciar; ou (2) análise jurídica fundamentada, escrita, sobre ESTE arquivo, concluindo pelo uso permitido. Não resolve: "pode usar" do vendedor sem prova de titularidade, nem a aceitação de risco (fica registrada, a publicação segue retida).',
      }
    },
  },
  {
    id: 'criancas', titulo: 'Conteúdo sobre crianças / publicidade infantil', plataformas: ['tiktok', 'instagram', 'youtube', 'facebook'], paises: ['BR'], momento: 'ANTES', bloqueante: true,
    fontes: ['br.conanda.163', 'br.cdc.art37', 'tiktok.shop.conteudo', 'tiktok.cg.menores'],
    verificar: (c) => {
      if (c.imagens.menoresNaTela) return { status: 'PENDENTE', fundamento: 'Menores na imagem exigem cuidados e autorização dos responsáveis.', evidencia: 'há menor na imagem', comoResolver: 'Remover ou obter autorização.' }
      if (c.dirigidoACriancas) return { status: 'NAO_CONFORME', fundamento: 'Publicidade dirigida à criança é abusiva no BR (CDC art. 37 §2; Res. CONANDA 163/2014).', evidencia: 'linguagem/apelo dirigidos a crianças', comoResolver: 'Reescrever para falar com os adultos responsáveis.' }
      return { status: 'CONFORME', fundamento: 'Sem crianças na imagem; mensagem dirigida aos pais/responsáveis ("Seu filho…"), sem apelo direto à criança nem promessa de desenvolvimento.', evidencia: 'apenas mãos adultas; narração para adultos' }
    },
  },
  {
    id: 'originalidade', titulo: 'Originalidade e autenticidade', plataformas: ['tiktok'], paises: '*', momento: 'ANTES', bloqueante: true,
    fontes: ['tiktok.shop.conteudo', 'tiktok.cg.integridade'],
    verificar: (c) => c.imagens.graficosDoPatrono && !c.imagens.midiasReaisDaTitular
      ? { status: 'CONFORME', fundamento: 'Conteúdo original: gráficos gerados pelo próprio Patrono, narração e trilha próprias; nada baixado de terceiros.', evidencia: 'manifesto de direitos dos ativos (sha256 e origem de cada arquivo)' }
      : c.imagens.midiasLicenciadas
      ? { status: 'CONFORME', fundamento: 'Montagem própria (roteiro, narração, legendas, movimento de câmera e trilha próprios) sobre fotos oficiais sob licença que permite uso comercial e edição; não é reenvio de vídeo de terceiros.', evidencia: `${c.imagens.midiasLicenciadas.licenca} — ${c.imagens.midiasLicenciadas.fonte}` }
      : c.imagens.midiasReaisDaTitular
      ? { status: 'CONFORME', fundamento: 'Conteúdo original: filmagens próprias do exemplar da titular, narração própria, trilha própria; não é reenvio de conteúdo de terceiros.', evidencia: 'declaração de autoria registrada; sem material baixado de terceiros' }
      : { status: 'PENDENTE', fundamento: 'Origem não comprovada.', evidencia: '—', comoResolver: 'Registrar a autoria das mídias.' },
  },
]

const aplica = (r: Requisito, c: ContextoDeConformidade) =>
  r.plataformas.includes(c.plataforma) && (r.paises === '*' || r.paises.includes(c.pais)) &&
  (!r.modalidades || r.modalidades.includes(c.modalidade)) && (!r.categorias || r.categorias.includes(c.categoria))

export function auditarConformidade(c: ContextoDeConformidade, requisitos: Requisito[] = R): RelatorioDeConformidade {
  const achados: Achado[] = requisitos.filter((r) => aplica(r, c)).map((r) => {
    const v = r.verificar(c)
    const fontes = r.fontes.map((id) => { const f = FONTES[id]; if (!f) throw new Error(`fonte não registrada: ${id}`); return { id, url: f.url, consultadoEm: f.consultadoEm } })
    let bloqueia = r.bloqueante && r.momento === 'ANTES' && (v.status === 'NAO_CONFORME' || v.status === 'PENDENTE')
    const resolucao = c.resolucoes?.[r.id]
    let status = v.status
    let fundamento = v.fundamento
    if (resolucao && v.status === 'PENDENTE') {
      const t = resolucao.tipo
      const ehDireitos = r.id === 'direitos.obra'
      if (t === 'AUTORIZACAO_DOS_TITULARES' && resolucao.documento && TITULARES.has((resolucao.concedente?.qualidade ?? '').toUpperCase())) {
        status = 'CONFORME'; bloqueia = false; fundamento = `Autorização documentada de ${resolucao.concedente!.nome} (${resolucao.concedente!.qualidade}).`
      } else if (t === 'ANALISE_JURIDICA_FUNDAMENTADA' && resolucao.conclusao === 'USO_PERMITIDO' && resolucao.documento && resolucao.concedente?.registro &&
        (!c.arquivo.sha256 || resolucao.sha256DoVideo === c.arquivo.sha256)) {
        status = 'CONFORME'; bloqueia = false; fundamento = `Análise jurídica fundamentada (${resolucao.concedente.nome}, ${resolucao.concedente.registro}) concluiu pelo uso permitido deste arquivo — não é autorização dos titulares.`
      } else if (t === 'CONFIRMADO_PELA_TITULAR' && !ehDireitos) {
        status = 'CONFORME'; bloqueia = false
      }
      // AUTORIZACAO_DE_TERCEIRO, RISCO_RESIDUAL_ACEITO, análise de OUTRO arquivo ou inconclusiva: ficam registradas e o item
      // continua PENDENTE e bloqueante.
    }
    return { id: r.id, titulo: r.titulo, momento: r.momento, ...v, fundamento, status, bloqueia, fontes, resolucao }
  })
  const bloqueios = achados.filter((a) => a.bloqueia)
  const soAutomaticas = bloqueios.length > 0 && bloqueios.every((a) => a.status === 'NAO_CONFORME' && a.correcaoAutomatica)
  const veredito = !bloqueios.length ? 'APTO' : soAutomaticas ? 'APTO_APOS_CORRECOES' : 'BLOQUEADO'
  const checklistDaPublicacao = achados.filter((a) => a.momento === 'NA_PUBLICACAO' && a.status === 'PENDENTE').map((a) => a.comoResolver ?? a.titulo)
  const resumo = veredito === 'APTO'
    ? 'Apto pelas verificações disponíveis (não é garantia de aprovação pela plataforma). Falta só o checklist da publicação e a aprovação da titular.'
    : veredito === 'APTO_APOS_CORRECOES'
      ? `Apto após ${bloqueios.length} correção(ões) automática(s): ${bloqueios.map((a) => a.titulo).join('; ')}.`
      : `Bloqueado: ${bloqueios.map((a) => `${a.titulo} (${a.status})`).join('; ')}.`
  return { veredito, resumo, achados, checklistDaPublicacao, versaoDasRegras: VERSAO_DAS_REGRAS }
}

/**
 * REGRA DEFINITIVA: pronto para a titular SÓ com os três controles aprovados (técnico, comercial, conformidade)
 * E a Barreira de Qualidade Profissional APTA (P2.66) para o MESMO arquivo. Os três controles sozinhos deixaram passar
 * vídeos genéricos com nota 93–98: sem a barreira, nada é liberado.
 * Mesmo liberado, continua dependendo da aprovação da titular (e do checklist da publicação).
 */
export function liberacaoParaPublicacao(qg: { veredito?: string; arquivo?: unknown; comercial?: { veredito?: string; bloqueios?: string[] } | null; conformidade?: { veredito?: string; resumo?: string } | null; campanha?: { liberacaoComercial?: string; motivos?: string[] } | null; barreira?: { decisao?: string; resumo?: string; sha256?: string } | null } | null, videoAtualSha256?: string | null) {
  const motivos: string[] = []
  // P2.50 (A6): os controles valem para UM arquivo. Vídeo trocado depois da auditoria = controles de outro arquivo.
  const shaAuditado = (qg?.arquivo as { sha256?: string } | null | undefined)?.sha256 ?? null
  if (shaAuditado && videoAtualSha256 && shaAuditado !== videoAtualSha256) motivos.push('Os controles foram feitos em outro arquivo de vídeo: refazer a auditoria do vídeo atual.')
  if (!qg || qg.veredito !== 'APROVADO' || !qg.arquivo) motivos.push('Quality Gate Técnico (arquivo) não aprovado.')
  if (qg?.comercial?.veredito !== 'APRESENTAR_A_TITULAR') motivos.push(qg?.comercial ? `Quality Gate Comercial: ${qg.comercial.veredito}${qg.comercial.bloqueios?.length ? ` — ${qg.comercial.bloqueios.join(' ')}` : '.'}` : 'Quality Gate Comercial não executado.')
  if (qg?.conformidade?.veredito !== 'APTO') motivos.push(qg?.conformidade ? `Conformidade: ${qg.conformidade.resumo ?? qg.conformidade.veredito}` : 'Auditoria de conformidade não executada.')
  // P2.51 — campanha comercial: afiliação/link e cadeia de direitos dos ativos. Só ACRESCENTA motivos (nunca libera).
  if (qg?.campanha && qg.campanha.liberacaoComercial !== 'LIBERADA') motivos.push(...(qg.campanha.motivos?.length ? qg.campanha.motivos.map((m) => `Campanha: ${m}`) : ['Campanha: liberação comercial pendente.']))
  // P2.66 — Barreira de Qualidade Profissional: obrigatória, com evidência, no mesmo arquivo.
  if (!qg?.barreira) motivos.push('Barreira de Qualidade Profissional não executada: sem evidência de qualidade, o vídeo não vai à titular.')
  else {
    if (qg.barreira.decisao !== 'APTO_PARA_TITULAR') motivos.push(`Barreira de Qualidade Profissional: ${qg.barreira.resumo ?? qg.barreira.decisao}`)
    // achado 4 da revisão independente: sem sha256 nas duas pontas não há como provar que é o MESMO arquivo
    if (!qg.barreira.sha256 || !shaAuditado) motivos.push('Barreira ou auditoria sem sha256 do arquivo: não há como provar que avaliaram este vídeo.')
    else if (qg.barreira.sha256 !== shaAuditado || (videoAtualSha256 && videoAtualSha256 !== shaAuditado)) motivos.push('A barreira foi avaliada em outro arquivo de vídeo.')
  }
  return { liberado: motivos.length === 0, motivos, aindaDependeDaTitular: true as const }
}

export const REQUISITOS = R
