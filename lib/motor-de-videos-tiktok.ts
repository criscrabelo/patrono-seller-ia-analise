/**
 * P2.17.3 / P2.17.4 — Motor de Vídeos TikTok para afiliados. FUNÇÃO PURA, sem IA paga.
 *
 * Objetivo: retenção, clique, conversão, comissão, cumprimento de missão e
 * aprendizado — NÃO "viralizar". Por isso:
 *  - nunca afirma que um vídeo vai viralizar: fala em POTENCIAL, com os sinais;
 *  - "prova" só com dado real (ex.: vendas informadas pela fonte); sem dado,
 *    a prova é mostrar o produto funcionando de verdade;
 *  - estruturas que exigem experiência real (teste, UGC, antes/depois,
 *    "eu não esperava") dizem isso; antes/depois fica fora de Beleza/Saúde;
 *  - não copia criadores, não usa marca de terceiros, não promete resultado;
 *  - legenda com divulgação de afiliado e CTA coerente com onde o link fica
 *    (produto marcado no TikTok Shop; fora dele, link na bio).
 *
 * P2.17.4: cada variante sai pronta para gravar — texto na tela por etapa,
 * objetivo principal, instrução de produto marcado, versão curta (15 s) e
 * média (30 s), CTA A/B e as duas legendas.
 */
import { claimsNaoComprovados, hashtagsParaOCanal, nomeSemClaims } from './copy-por-canal'
import { textoDisclosure } from './creative-factory'
import { avaliarCampanha } from './campanha-sazonal'

export const ESTRUTURAS = [
  'DEMONSTRACAO',
  'PROBLEMA_SOLUCAO',
  'SURPRESA',
  'LISTA_3_MOTIVOS',
  'ACHADO_TIKTOK_SHOP',
  'TESTE_REAL',
  'PRESENTE',
  'NATAL',
  'COMPARACAO',
  'UNBOXING',
  'POV',
  'UGC',
  'FACELESS',
  'CURIOSIDADE',
  'UTILIDADE',
  'ANTES_DEPOIS',
] as const
export type Estrutura = (typeof ESTRUTURAS)[number]

export type ObjetivoDoVideo = 'RETENCAO' | 'CLIQUE' | 'VENDA'

export const CTA_A = 'Toque no produto marcado no vídeo.'
export const CTA_B = 'Salva este vídeo e confere o produto marcado.'
export const CTA_A_BIO = 'Link na bio.'
export const CTA_B_BIO = 'Salva este vídeo; o link está na bio.'
export const DURACAO = { CURTA: 15, MEDIA: 30 } as const

export interface ProdutoDoVideo {
  nome: string
  categoria: string | null
  preco: number | null
  beneficios?: string[]
  /** Vendas informadas por fonte oficial (null = não se sabe). */
  vendas?: number | null
  tiktokShop: boolean
  temImagem?: boolean
}

export interface Etapa {
  etapa: string
  texto: string
  /** Texto curto para sobrepor na tela nesta etapa (null = sem texto). */
  textoNaTela: string | null
}

export interface VersaoDoVideo {
  segundos: number
  roteiro: Etapa[]
}

export interface VarianteDeVideo {
  id: string
  estrutura: Estrutura
  objetivo: ObjetivoDoVideo
  gancho: string
  roteiro: Etapa[]
  versaoCurta: VersaoDoVideo
  versaoMedia: VersaoDoVideo
  cta: string
  ctaB: string
  duracaoSegundos: number
  legenda: string
  legendaB: string
  disclosure: string
  hashtags: string[]
  produtoMarcado: string
  exigeExperienciaReal: boolean
  observacao: string | null
}

export interface PotencialDeViralizacao {
  nivel: 'ALTO' | 'MEDIO' | 'BAIXO'
  sinais: string[]
  aviso: string
}

export interface PlanoDeVideos {
  facilidadeDeVideo: number
  potencial: PotencialDeViralizacao
  variantes: VarianteDeVideo[]
  /** Teste A/B/C recomendado para começar. */
  testeInicial: { variantes: string[]; explicacao: string }
  /** O que medir para aprender (quando houver métricas). */
  metricasDeAprendizado: string[]
}

function semAcento(t: string) {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Nome curto e limpo para falar no vídeo (sem alegações do vendedor). */
export function nomeCurto(nome: string): string {
  let limpo = nome
  try {
    limpo = nomeSemClaims(nome).nome
  } catch {
    // nome feito só de alegações: usa o original truncado
  }
  const palavras = limpo.replace(/\s+/g, ' ').trim().split(' ')
  return palavras.slice(0, 6).join(' ').replace(/[,;:\-–]+$/, '')
}

/** 0–100: quão fácil é mostrar o produto funcionando em poucos segundos. */
export function facilidadeDeVideo(p: Pick<ProdutoDoVideo, 'categoria' | 'nome' | 'preco'>): number {
  const porCategoria: Record<string, number> = {
    'Casa e Decoração': 85,
    Brinquedos: 85,
    Beleza: 70,
    Eletrônicos: 70,
    Moda: 65,
    Papelaria: 70,
    Pet: 70,
    Esportes: 60,
    Alimentação: 45,
    Saúde: 35,
    Outros: 50,
  }
  let n = porCategoria[p.categoria ?? 'Outros'] ?? 50
  const t = semAcento(p.nome)
  if (/\b(organizador|dobravel|portatil|mini|automatico|eletrico|led|recarregavel|magnetico|kit)\b/.test(t)) n += 10
  return Math.max(0, Math.min(100, n))
}

const BELEZA_OU_SAUDE = new Set(['Beleza', 'Saúde'])

/**
 * P2.34 — LIVRO é produto de leitura: não "funciona", não tem "resultado", não resolve "problema em casa".
 * Categoria "Livros" ou nome com livro/dicionário/gibi/HQ. (Começa por Livros; outras categorias intactas.)
 */
export function ehLivro(p: { nome: string; categoria: string | null }): boolean {
  return p.categoria === 'Livros' || /\b(livros?|dicion[aá]rio|gibis?|hqs?|mang[aá])\b/i.test(p.nome)
}
/** Formatos que fazem sentido para um livro (sem demonstração de uso, sem problema/solução, sem resultado). */
const ESTRUTURAS_DE_LIVRO: ReadonlySet<Estrutura> = new Set(['ACHADO_TIKTOK_SHOP', 'PRESENTE', 'NATAL'])

export function estruturasPossiveis(p: ProdutoDoVideo, agora: Date): Estrutura[] {
  const natal = avaliarCampanha({ categoria: p.categoria, nome: p.nome, preco: p.preco }, agora)
  if (ehLivro(p)) {
    return ESTRUTURAS.filter((e) => ESTRUTURAS_DE_LIVRO.has(e) && (e !== 'ACHADO_TIKTOK_SHOP' || p.tiktokShop) && (e !== 'NATAL' || (!!natal && natal.aderencia > 0)))
  }
  return ESTRUTURAS.filter((e) => {
    if (e === 'ACHADO_TIKTOK_SHOP') return p.tiktokShop
    if (e === 'PRESENTE') return !!natal && natal.tags.includes('PRESENTE')
    if (e === 'NATAL') return !!natal && natal.aderencia > 0
    // Antes/depois em Beleza/Saúde vira promessa de resultado: fora.
    if (e === 'ANTES_DEPOIS') return !BELEZA_OU_SAUDE.has(p.categoria ?? '') && p.categoria === 'Casa e Decoração'
    return true
  })
}

export const EXIGE_EXPERIENCIA: ReadonlySet<Estrutura> = new Set(['SURPRESA', 'TESTE_REAL', 'UGC', 'ANTES_DEPOIS'])

/** Objetivo principal de cada estrutura (o que ela mais move). */
export const OBJETIVO_DA_ESTRUTURA: Record<Estrutura, ObjetivoDoVideo> = {
  DEMONSTRACAO: 'VENDA',
  PROBLEMA_SOLUCAO: 'VENDA',
  SURPRESA: 'RETENCAO',
  LISTA_3_MOTIVOS: 'CLIQUE',
  ACHADO_TIKTOK_SHOP: 'CLIQUE',
  TESTE_REAL: 'VENDA',
  PRESENTE: 'VENDA',
  NATAL: 'CLIQUE',
  COMPARACAO: 'CLIQUE',
  UNBOXING: 'RETENCAO',
  POV: 'RETENCAO',
  UGC: 'VENDA',
  FACELESS: 'VENDA',
  CURIOSIDADE: 'RETENCAO',
  UTILIDADE: 'VENDA',
  ANTES_DEPOIS: 'VENDA',
}

function ganchoDe(e: Estrutura, n: string, natal: boolean, livro = false): string {
  if (livro) {
    if (e === 'PRESENTE' || e === 'NATAL') return natal ? 'Uma ideia de presente de Natal: um livro.' : 'Uma ideia de presente: um livro.'
    return `Olha este livro que eu achei: ${n}.`
  }
  switch (e) {
    case 'DEMONSTRACAO': return `Em 10 segundos eu te mostro como funciona: ${n}.`
    case 'PROBLEMA_SOLUCAO': return 'Se você tem esse problema em casa, olha isso.'
    case 'SURPRESA': return 'Eu não esperava que isso funcionasse…'
    case 'LISTA_3_MOTIVOS': return `3 motivos para ter este produto: ${n}.`
    case 'ACHADO_TIKTOK_SHOP': return 'Olha o que eu achei no TikTok Shop.'
    case 'TESTE_REAL': return `Testei de verdade: ${n}. Olha como foi.`
    case 'PRESENTE': return natal ? 'Uma ideia de presente de Natal para quem você gosta.' : 'Uma ideia de presente para quem você gosta.'
    case 'NATAL': return `Preparando o Natal por aqui: ${n}.`
    case 'COMPARACAO': return 'Esse ou o comum? Olha a diferença.'
    case 'UNBOXING': return `Abre comigo: ${n}.`
    case 'POV': return natal ? 'POV: você achou o presente perfeito.' : 'POV: você achou exatamente o que precisava.'
    case 'UGC': return `Minha opinião sincera depois de usar: ${n}.`
    case 'FACELESS': return `Só as mãos: ${n} em ação.`
    case 'CURIOSIDADE': return 'Pouca gente sabe que dá para fazer isso…'
    case 'UTILIDADE': return 'Um item que resolve uma coisa chata do dia a dia.'
    case 'ANTES_DEPOIS': return 'Antes e depois de organizar com isso.'
  }
}

/** Texto na tela: curto (≤ 40 caracteres), sem alegação. */
function telaDe(etapa: string, natal: boolean): string | null {
  const mapa: Record<string, string> = {
    Problema: 'O problema 👇',
    Demonstração: 'Olha como funciona',
    Benefício: 'O que muda na prática',
    Prova: 'Funcionando de verdade',
    Desejo: natal ? 'Ideia para o Natal 🎄' : 'Resultado final',
    'Para quem': 'Para quem é',
    Abertura: 'Abrindo agora',
    Comparação: 'Comum × este',
    'Motivo 1': 'Motivo 1',
    'Motivo 2': 'Motivo 2',
    'Motivo 3': 'Motivo 3',
    Curiosidade: 'Você sabia?',
    CTA: 'Produto marcado 👇',
  }
  return mapa[etapa] ?? null
}

/** Livro: só o que é verdade para QUALQUER livro mostrado pela titular (capa, páginas, contracapa). */
function roteiroDeLivro(e: Estrutura, n: string, natal: boolean): Etapa[] {
  const presente = e === 'PRESENTE' || e === 'NATAL'
  return [
    { etapa: 'Capa', texto: n, textoNaTela: null },
    { etapa: 'Por dentro', texto: 'Folheie algumas páginas devagar, de perto, para mostrar o livro por dentro.', textoNaTela: 'Por dentro do livro' },
    { etapa: 'Desejo', texto: presente ? 'Mostre a capa de novo no final.' : 'Mostre a contracapa no final.', textoNaTela: presente ? (natal ? 'Ideia para o Natal 🎄' : 'Ideia de presente') : null },
  ]
}

function roteiroDe(e: Estrutura, p: ProdutoDoVideo, n: string, natal: boolean): Etapa[] {
  if (ehLivro(p)) return roteiroDeLivro(e, n, natal)
  const beneficio = p.beneficios?.find((b) => b.trim()) ?? 'Mostre na prática o principal benefício do produto.'
  const prova =
    typeof p.vendas === 'number' && p.vendas > 0
      ? `${p.vendas.toLocaleString('pt-BR')} vendidos${p.tiktokShop ? ' no TikTok Shop' : ''} (dado da loja).`
      : 'Mostre o produto funcionando de verdade, sem cortes enganosos.'
  const et = (etapa: string, texto: string): Etapa => ({ etapa, texto, textoNaTela: telaDe(etapa, natal) })
  const base = [
    et('Problema', 'Mostre a situação do dia a dia que o produto resolve.'),
    et('Demonstração', `Mostre o produto (${n}) em uso, de perto, nos primeiros 5 segundos.`),
    et('Benefício', beneficio),
    et('Prova', prova),
    et('Desejo', 'Feche com o resultado final bonito na tela.'),
  ]
  if (e === 'LISTA_3_MOTIVOS') return [et('Motivo 1', beneficio), et('Motivo 2', 'Praticidade no dia a dia.'), et('Motivo 3', prova)]
  if (e === 'UNBOXING') return [et('Abertura', 'Abra a embalagem na frente da câmera.'), ...base.slice(1)]
  if (e === 'COMPARACAO') return [et('Comparação', 'Compare com a forma comum de fazer (sem citar marcas).'), ...base.slice(1)]
  if (e === 'PRESENTE' || e === 'NATAL') return [et('Para quem', 'Diga para quem é o presente ideal.'), ...base.slice(1)]
  if (e === 'CURIOSIDADE') return [et('Curiosidade', 'Mostre o uso que pouca gente conhece, sem exagerar.'), ...base.slice(1)]
  return base
}

export function potencialDeViralizacao(p: ProdutoDoVideo, agora: Date): PotencialDeViralizacao {
  const sinais: string[] = []
  let pontos = 0
  const facil = facilidadeDeVideo(p)
  if (facil >= 75) { pontos += 2; sinais.push('fácil de demonstrar em poucos segundos') }
  else if (facil >= 60) { pontos += 1; sinais.push('demonstração possível') }
  const natal = avaliarCampanha({ categoria: p.categoria, nome: p.nome, preco: p.preco }, agora)
  if (natal && natal.aderencia >= 50) { pontos += 2; sinais.push(`combina com ${natal.nome}`) }
  if (p.preco !== null && p.preco > 0 && p.preco <= 60) { pontos += 1; sinais.push('preço de compra por impulso') }
  if (typeof p.vendas === 'number' && p.vendas >= 100) { pontos += 2; sinais.push('já vende (dado da loja)') }
  if (p.tiktokShop) { pontos += 1; sinais.push('produto marcável no vídeo (TikTok Shop)') }
  if (p.temImagem) sinais.push('tem imagem do produto')
  sinais.push('histórico dos nossos vídeos: ainda sem dados')
  const nivel = pontos >= 5 ? 'ALTO' : pontos >= 3 ? 'MEDIO' : 'BAIXO'
  return { nivel, sinais, aviso: 'Potencial, não promessa: nenhum vídeo tem viralização garantida.' }
}

export function planejarVideos(p: ProdutoDoVideo, agora: Date = new Date()): PlanoDeVideos {
  const n = nomeCurto(p.nome)
  const natal = avaliarCampanha({ categoria: p.categoria, nome: p.nome, preco: p.preco }, agora)
  const ehNatal = !!natal && natal.aderencia > 0
  const hashtagsBase = hashtagsParaOCanal(
    [...(p.tiktokShop ? ['#tiktokshop'] : []), '#achadinhos', ...(ehNatal ? ['#natal', '#presentedenatal'] : [])],
    'tiktok'
  ).slice(0, 5)
  const disclosure = textoDisclosure('afiliado')
  const ctaA = p.tiktokShop ? CTA_A : CTA_A_BIO
  const ctaB = p.tiktokShop ? CTA_B : CTA_B_BIO
  const produtoMarcado = p.tiktokShop
    ? 'Ao publicar, toque em "Adicionar link" › Produtos e marque este produto do TikTok Shop.'
    : 'Produto fora do TikTok Shop: não há produto para marcar; deixe o link na bio.'
  const estruturas = estruturasPossiveis(p, agora)
  const variantes: VarianteDeVideo[] = []
  for (const e of estruturas) {
    const gancho = ganchoDe(e, n, ehNatal, ehLivro(p))
    const roteiro = roteiroDe(e, p, n, ehNatal)
    const abertura: Etapa = { etapa: 'Gancho (0–3 s)', texto: gancho, textoNaTela: gancho.length <= 40 ? gancho : null }
    const fecho: Etapa = { etapa: 'CTA', texto: ctaA, textoNaTela: telaDe('CTA', ehNatal) }
    const demonstracao = roteiro.find((r) => r.etapa === 'Demonstração') ?? roteiro[0]
    variantes.push({
      id: `${e}-A-CURTA`,
      estrutura: e,
      objetivo: OBJETIVO_DA_ESTRUTURA[e],
      gancho,
      roteiro,
      versaoCurta: { segundos: DURACAO.CURTA, roteiro: [abertura, demonstracao, fecho] },
      versaoMedia: { segundos: DURACAO.MEDIA, roteiro: [abertura, ...roteiro, fecho] },
      cta: ctaA,
      ctaB,
      duracaoSegundos: e === 'LISTA_3_MOTIVOS' || e === 'COMPARACAO' ? DURACAO.MEDIA : DURACAO.CURTA,
      legenda: [gancho, ctaA, disclosure, hashtagsBase.join(' ')].join('\n\n'),
      legendaB: [gancho, ctaB, disclosure, hashtagsBase.join(' ')].join('\n\n'),
      disclosure,
      hashtags: hashtagsBase,
      produtoMarcado,
      exigeExperienciaReal: EXIGE_EXPERIENCIA.has(e),
      observacao: EXIGE_EXPERIENCIA.has(e) ? 'Use só se você realmente testou o produto.' : null,
    })
  }
  // Teste inicial: 3 ganchos diferentes (A/B/C), sem exigir experiência real.
  // Natal: presente/POV na frente; decoração natalina: demonstração e POV ("problema em casa" não cabe).
  const decoracao = !!natal && natal.tags.includes('DECORACAO_NATALINA')
  const ordemDeTeste: Estrutura[] = decoracao
    ? ['DEMONSTRACAO', 'POV', 'ACHADO_TIKTOK_SHOP', 'LISTA_3_MOTIVOS', 'FACELESS']
    : natal && natal.aderencia >= 50
      ? ['PRESENTE', 'DEMONSTRACAO', 'ACHADO_TIKTOK_SHOP', 'POV', 'PROBLEMA_SOLUCAO', 'LISTA_3_MOTIVOS', 'FACELESS']
      : ['DEMONSTRACAO', 'PROBLEMA_SOLUCAO', 'UTILIDADE', 'PRESENTE', 'ACHADO_TIKTOK_SHOP', 'LISTA_3_MOTIVOS', 'POV', 'FACELESS']
  const iniciais = ordemDeTeste.filter((e) => estruturas.includes(e)).slice(0, 3).map((e) => `${e}-A-CURTA`)
  return {
    facilidadeDeVideo: facilidadeDeVideo(p),
    potencial: potencialDeViralizacao(p, agora),
    variantes,
    testeInicial: {
      variantes: iniciais,
      explicacao: `Comece com ${iniciais.length} vídeos curtos com ganchos diferentes (A/B/C) e o mesmo CTA ("${ctaA}"). O que tiver mais clique no produto e venda ganha uma versão com o CTA B ("${ctaB}") e uma versão média (${DURACAO.MEDIA} s) contando a história.`,
    },
    metricasDeAprendizado: ['visualizações', 'retenção', 'tempo médio assistido', 'clique no produto', 'CTR', 'adição ao carrinho', 'vendas', 'comissão'],
  }
}

/** Para testes e conferência: nenhuma variante afirma algo sem comprovação. */
export function alegacoesDoPlano(plano: PlanoDeVideos): string[] {
  return plano.variantes.flatMap((v) =>
    claimsNaoComprovados([v.gancho, v.legenda, v.legendaB, ...v.roteiro.map((r) => `${r.texto} ${r.textoNaTela ?? ''}`)].join(' '))
  )
}
