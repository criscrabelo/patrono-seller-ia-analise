/**
 * Motor de Oportunidades Reais (P1.1).
 *
 * Transforma o catálogo que JÁ EXISTE numa fila priorizada: quais produtos
 * valem uma publicação agora, por quê, e quais estão de fato prontos para
 * virar conteúdo.
 *
 * ── NÃO É UM SCORE NOVO ─────────────────────────────────────────────────
 * A fórmula final continua sendo `calcularOpportunityScoreComposto()`, em
 * lib/opportunity-score-composite.ts. Este módulo não inventa uma segunda
 * nota concorrente: ele ALIMENTA a que existe com dados reais do catálogo e
 * do histórico de publicações, e acrescenta o que a nota sozinha não diz —
 * se a oportunidade está pronta para publicar.
 *
 * ── AS DUAS PERGUNTAS SÃO DIFERENTES ────────────────────────────────────
 *   OPORTUNIDADE_COMERCIAL   vale a pena vender isto?
 *   PRONTA_PARA_PUBLICACAO   dá para fazer conteúdo disto hoje, legalmente?
 *
 * Um produto com comissão ótima e mídia sem direito de uso é a primeira
 * coisa e não é a segunda. Misturar as duas produziria uma fila que manda
 * publicar o que não pode ser publicado.
 *
 * ── NADA SINTÉTICO ──────────────────────────────────────────────────────
 * Só produto real do catálogo entra. `SEED`, `TEST_FIXTURE`, `DEMO` e
 * `SYNTHETIC_TEST` são recusados por construção — a fila de produção não
 * pode recomendar um produto que não existe para vender.
 *
 * ── CAMPO AUSENTE É `null` ──────────────────────────────────────────────
 * Cada provider entrega um subconjunto diferente. O que não vier fica
 * `null` e aparece em `dadosAusentes`, nunca preenchido com média, zero ou
 * palpite. A confiança cai; o número não mente.
 */

import { FAIXA_DE_DESEMPATE } from './faixa-de-evidencia'
import { PRODUTO_NAO_EXCLUIDO } from './produto-canonico'
import { avaliarCampanha, type AvaliacaoDaCampanha } from './campanha-sazonal'
import { prisma } from './prisma'
import {
  calcularOpportunityScoreComposto,
  PARTICIPACAO_DA_ADERENCIA,
  type OpportunityScoreComponents,
} from './opportunity-score-composite'
import type { AffiliateOpportunity, OrigemOportunidade } from './affiliate-discovery'
import { produtoPodeAparecerNoVideo } from './media-rights-produto'
import { ML_DATA_ORIGINS } from './ml-types'
import { calcularMetricasPorProduto } from './metricas-clique'
import { PERFIL_DA_LOJA } from './config'
import { buscarProvider } from './affiliate-providers'
import { avaliarPreco } from './preco-verificado'
// `plano-de-acao` importa deste módulo só TIPOS: não há ciclo em execução.
import { aplicarDiversidade } from './plano-de-acao'

// ── Vocabulário ─────────────────────────────────────────────────────────

export const CLASSIFICACOES = ['PRONTA_PARA_PUBLICACAO', 'OPORTUNIDADE_COMERCIAL', 'NAO_ELEGIVEL'] as const
export type ClassificacaoDaOportunidade = (typeof CLASSIFICACOES)[number]

export const NIVEIS_DE_CONFIANCA = ['ALTA', 'MEDIA', 'BAIXA', 'SEM_HISTORICO_REAL'] as const
export type NivelDeConfianca = (typeof NIVEIS_DE_CONFIANCA)[number]

/**
 * Por que um produto não está pronto para publicação. Cada motivo aponta
 * para uma ação concreta — nenhum é "não deu".
 */
export const MOTIVOS_NAO_PRONTA = [
  /** `Produto.status` não é ativo, ou o provider removeu da origem. */
  'INDISPONIVEL',
  /** Sem imagem, ou mídia sem direito de uso verificado. */
  'MIDIA_SEM_DIREITO',
  /** Sem URL de destino: não há para onde mandar o clique. */
  'SEM_DESTINO',
  /** Nenhum canal do workspace consegue publicar isto hoje. */
  'SEM_CANAL_CAPAZ',
  /** P2.14.5.12: regra de compliance que impede o produto (ex.: provedor não permite cadastro). */
  'COMPLIANCE_BLOQUEANTE',
] as const
export type MotivoNaoPronta = (typeof MOTIVOS_NAO_PRONTA)[number]

/** Origens de REGISTRO que nunca viram oportunidade de produção. */
export const ORIGENS_SINTETICAS = ML_DATA_ORIGINS.filter((o) => o !== 'REAL_OPERATION')

/**
 * `Produto.origemDados` → proveniência da oportunidade.
 *
 * Mapa explícito: origem desconhecida vira `MANUAL`, o nível mais baixo de
 * confiança que ainda é real, nunca `OFFICIAL_API`. Promover confiança por
 * omissão seria exatamente o erro que o P0.2 eliminou nas vendas.
 */
export const ORIGEM_DO_REGISTRO_PARA_OPORTUNIDADE: Record<string, OrigemOportunidade> = {
  MANUAL: 'MANUAL',
  USER_PROVIDED: 'USER_PROVIDED',
  TIKTOK_SHOWCASE: 'AFFILIATE_PORTAL_IMPORT',
  SHOPEE_API: 'OFFICIAL_API',
  AMAZON_PA_API: 'OFFICIAL_API',
  MERCADO_LIVRE_API: 'OFFICIAL_API',
  // P2.17: API oficial do TikTok Shop com a conta de criadora autorizada.
  TIKTOK_SHOP_API: 'AUTHORIZED_PARTNER_API',
  'TIKTOK-SHOP': 'AUTHORIZED_PARTNER_API',
}

export function origemDaOportunidade(origemDados: string | null | undefined): OrigemOportunidade {
  const chave = (origemDados ?? '').trim().toUpperCase()
  return ORIGEM_DO_REGISTRO_PARA_OPORTUNIDADE[chave] ?? 'MANUAL'
}

// ── Desempenho histórico REAL ───────────────────────────────────────────

/** Janela em que uma publicação ainda conta como "recente" para saturação. */
export const JANELA_DE_SATURACAO_DIAS = 14
/** A partir daqui, publicar de novo o mesmo produto começa a render menos. */
export const PUBLICACOES_ANTES_DE_SATURAR = 3
/** Cliques mínimos para a taxa observada valer como sinal. */
export const CLIQUES_MINIMOS_PARA_HISTORICO = 5

export interface DesempenhoHistorico {
  /** 0–100, ou `null` quando não há base real. Vai para o score composto. */
  nota: number | null
  taxaConversao: number | null
  receitaPorClique: number | null
  cliques: number
  vendasElegiveis: number
  /** Publicações deste produto na janela de saturação. */
  publicacoesRecentes: number
  /** Multiplicador aplicado por excesso de publicação. 1 = sem penalidade. */
  fatorDeSaturacao: number
  partes: string[]
}

/**
 * FUNÇÃO PURA. Nota de desempenho a partir de observação real.
 *
 * Duas metades, ambas medidas: a taxa de conversão e a receita por clique.
 * A saturação entra aqui, e não como número separado, porque ela É um fato
 * observado — publicar a mesma coisa cinco vezes em duas semanas rende
 * menos, e isso aparece no desempenho, não num segundo placar.
 *
 * Sem cliques suficientes devolve `null`, nunca 0. O score composto então
 * reequilibra os pesos entre os componentes que existem — que é o
 * comportamento que ele já tinha para cold start.
 */
export function calcularDesempenhoHistorico(entrada: {
  taxaConversao: number | null
  receitaPorClique: number | null
  cliques: number
  vendasElegiveis: number
  publicacoesRecentes: number
}): DesempenhoHistorico {
  const partes: string[] = []
  const publicacoesRecentes = Math.max(0, entrada?.publicacoesRecentes ?? 0)

  // Saturação vale mesmo sem histórico de clique: ela mede repetição, não
  // resultado.
  const excesso = Math.max(0, publicacoesRecentes - PUBLICACOES_ANTES_DE_SATURAR)
  const fatorDeSaturacao = excesso === 0 ? 1 : Math.max(0.5, 1 - excesso * 0.1)
  if (excesso > 0) {
    partes.push(
      `saturação: ${publicacoesRecentes} publicações nos últimos ${JANELA_DE_SATURACAO_DIAS} dias reduzem a nota em ${Math.round((1 - fatorDeSaturacao) * 100)}%`
    )
  }

  if ((entrada?.cliques ?? 0) < CLIQUES_MINIMOS_PARA_HISTORICO) {
    partes.push(
      `sem base real: ${entrada?.cliques ?? 0} clique(s) medido(s), mínimo ${CLIQUES_MINIMOS_PARA_HISTORICO}`
    )
    return {
      nota: null,
      taxaConversao: entrada?.taxaConversao ?? null,
      receitaPorClique: entrada?.receitaPorClique ?? null,
      cliques: entrada?.cliques ?? 0,
      vendasElegiveis: entrada?.vendasElegiveis ?? 0,
      publicacoesRecentes,
      fatorDeSaturacao,
      partes,
    }
  }

  // Conversão: 5% já pontua no teto. Acima disso o ganho marginal é ruído.
  const notaConversao =
    entrada.taxaConversao === null ? null : Math.min(100, (entrada.taxaConversao / 0.05) * 100)
  // Receita por clique: R$ 2,00 por clique é excelente para afiliado.
  const notaReceita =
    entrada.receitaPorClique === null ? null : Math.min(100, (entrada.receitaPorClique / 2) * 100)

  const disponiveis = [notaConversao, notaReceita].filter((n): n is number => n !== null)
  if (disponiveis.length === 0) {
    partes.push('cliques medidos, mas sem conversão nem receita observadas')
    return {
      nota: null,
      taxaConversao: entrada.taxaConversao,
      receitaPorClique: entrada.receitaPorClique,
      cliques: entrada.cliques,
      vendasElegiveis: entrada.vendasElegiveis,
      publicacoesRecentes,
      fatorDeSaturacao,
      partes,
    }
  }

  const media = disponiveis.reduce((s, n) => s + n, 0) / disponiveis.length
  const nota = Math.round(media * fatorDeSaturacao)
  if (notaConversao !== null) partes.push(`conversão observada ${(entrada.taxaConversao! * 100).toFixed(2)}%`)
  if (notaReceita !== null) partes.push(`receita por clique R$ ${entrada.receitaPorClique!.toFixed(2)}`)
  partes.push(`base: ${entrada.cliques} clique(s), ${entrada.vendasElegiveis} venda(s) elegível(is)`)

  return {
    nota,
    taxaConversao: entrada.taxaConversao,
    receitaPorClique: entrada.receitaPorClique,
    cliques: entrada.cliques,
    vendasElegiveis: entrada.vendasElegiveis,
    publicacoesRecentes,
    fatorDeSaturacao,
    partes,
  }
}

// ── Confiança ───────────────────────────────────────────────────────────

/**
 * FUNÇÃO PURA. Quanta fé se pode ter nesta posição da fila.
 *
 * `SEM_HISTORICO_REAL` é um nível próprio, e não "baixa": produto novo não
 * tem desempenho ruim, tem desempenho desconhecido. As duas coisas levam a
 * decisões diferentes — uma pede substituição, a outra pede teste.
 */
export function classificarConfianca(p: {
  temHistoricoReal: boolean
  dadosAusentes: string[]
  origem: OrigemOportunidade
  /**
   * P2.14.5.12: fração do peso do score que veio de dado real (0–1). Só
   * pode REBAIXAR a confiança — nunca a eleva.
   */
  cobertura?: number
}): NivelDeConfianca {
  if (!p.temHistoricoReal) return 'SEM_HISTORICO_REAL'
  const oficial = p.origem === 'OFFICIAL_API' || p.origem === 'AUTHORIZED_PARTNER_API'
  let nivel: NivelDeConfianca = 'BAIXA'
  if (p.dadosAusentes.length === 0 && oficial) nivel = 'ALTA'
  else if (p.dadosAusentes.length <= 2) nivel = 'MEDIA'
  if (typeof p.cobertura === 'number') {
    if (p.cobertura < 0.5) return 'BAIXA'
    if (p.cobertura < 0.8 && nivel === 'ALTA') return 'MEDIA'
  }
  return nivel
}

// ── Receita potencial ───────────────────────────────────────────────────

/**
 * FUNÇÃO PURA. Estimativa de receita — só com base real, e sempre rotulada.
 *
 * Exige preço, comissão e taxa de conversão OBSERVADA. Faltando qualquer
 * uma, devolve `null`. Uma estimativa com conversão chutada não é
 * estimativa, é ficção com casas decimais.
 */
export function estimarReceitaPotencial(p: {
  preco: number | null
  comissaoPercentual: number | null
  taxaConversao: number | null
  cliquesEsperados?: number
}): { valor: number | null; base: string } {
  if (p.preco === null || p.comissaoPercentual === null || p.taxaConversao === null) {
    return { valor: null, base: 'SEM_BASE_REAL_SUFICIENTE' }
  }
  const cliques = p.cliquesEsperados ?? 100
  const valor = p.preco * (p.comissaoPercentual / 100) * p.taxaConversao * cliques
  return {
    valor: Math.round(valor * 100) / 100,
    base: `ESTIMATIVA: ${cliques} cliques × conversão observada ${(p.taxaConversao * 100).toFixed(2)}% × comissão ${p.comissaoPercentual}% sobre R$ ${p.preco.toFixed(2)}`,
  }
}

// ── Prontidão ───────────────────────────────────────────────────────────

export interface VereditoDeProntidao {
  classificacao: ClassificacaoDaOportunidade
  motivos: MotivoNaoPronta[]
  explicacoes: string[]
}

/**
 * FUNÇÃO PURA. Separa "vale vender" de "dá para publicar hoje".
 *
 * Produto indisponível não é nem uma coisa nem outra. Produto disponível
 * com mídia sem direito é oportunidade comercial — a dona pode divulgar do
 * jeito dela —, mas o robô não gera conteúdo com a imagem dele.
 */
export function classificarProntidao(p: {
  disponivel: boolean
  temDestino: boolean
  midiaAutorizada: boolean
  motivoDaMidia: string
  canaisCapazes: string[]
}): VereditoDeProntidao {
  const motivos: MotivoNaoPronta[] = []
  const explicacoes: string[] = []

  if (!p.disponivel) {
    motivos.push('INDISPONIVEL')
    explicacoes.push('Produto inativo ou removido da origem — não entra na fila de publicação.')
    return { classificacao: 'NAO_ELEGIVEL', motivos, explicacoes }
  }

  if (!p.temDestino) {
    motivos.push('SEM_DESTINO')
    explicacoes.push('Sem URL de destino cadastrada: não há para onde mandar o clique.')
  }
  if (!p.midiaAutorizada) {
    motivos.push('MIDIA_SEM_DIREITO')
    explicacoes.push(p.motivoDaMidia)
  }
  if (p.canaisCapazes.length === 0) {
    motivos.push('SEM_CANAL_CAPAZ')
    explicacoes.push('Nenhum canal conectado consegue publicar este produto hoje.')
  }

  return {
    classificacao: motivos.length === 0 ? 'PRONTA_PARA_PUBLICACAO' : 'OPORTUNIDADE_COMERCIAL',
    motivos,
    explicacoes,
  }
}

// ── Aderência ao perfil da loja (P2.14.5.12 / .1) ───────────────────────

/** Teto do perfil dentro da aderência; os outros 20 são da afinidade. */
export const TETO_DO_PERFIL = 80

export interface AvaliacaoDeAderencia {
  /**
   * Aderência (0–100) = perfil (0–80) + afinidade aplicada (0–20).
   * `null` = perfil sem nenhum critério avaliável — nunca uma nota fabricada.
   */
  nota: number | null
  /** Perfil BoraComprar (0–80). `null` = desconhecido. */
  perfil: number | null
  /** Fração (0–1) do perfil que pôde ser avaliada com dado real (P2.14.5.13.5). */
  coberturaDoPerfil: number
  /** Bônus de afinidade que ENTROU na nota (0–20). */
  afinidade: number
  /**
   * Afinidade detectada, entre ou não na nota (0–20). Serve ao desempate
   * mesmo quando o perfil é desconhecido.
   */
  afinidadeDetectada: number
  sinaisDeAfinidade: string[]
  usadoPelaTitular: boolean
  positivos: string[]
  negativos: string[]
  desconhecidos: string[]
}

type MarcaPreferida = {
  nome: string
  termos: readonly string[]
  diferenciaMaiusculas?: boolean
  excetoCategorias?: readonly string[]
}

export type PerfilDaLoja = {
  categoriasDoCadastro: readonly string[]
  subcategoriasPrioritarias: Record<string, readonly string[]>
  faixaDePreco: { minimo: number; maximo: number; premiumAte: number }
  priorizarFacilDeDemonstrar: boolean
  priorizarSemPresencaDaTitular: boolean
  afinidadeDaTitular: {
    marcasPreferidas: ReadonlyArray<MarcaPreferida>
    estilo: readonly string[]
    marcadorDeUso: string
    bonus: { marcaPreferida: number; estilo: number; comprado: number; usado: number }
    teto: number
    perfilMinimoParaBonus: number
  }
}

/** `origemDados` que significa "informado/comprado pela titular" nesta fase (sem migration). */
export const ORIGEM_COMPRADO_PELA_TITULAR = 'USER_PROVIDED'

export function produtoCompradoPelaTitular(origemDados: string | null | undefined): boolean {
  return (origemDados ?? '').trim().toUpperCase() === ORIGEM_COMPRADO_PELA_TITULAR
}

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const escaparRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Palavra/expressão inteira, sem acento, sem diferenciar maiúsculas; aceita plural simples. */
function contemTermo(textoSemAcento: string, termo: string): boolean {
  const t = escaparRegex(semAcento(termo))
  return new RegExp(`(^|[^a-z0-9])${t}(s|es)?(?=$|[^a-z0-9])`).test(textoSemAcento)
}

function contemMarca(textoOriginal: string, textoSemAcento: string, marca: MarcaPreferida, categoria: string): boolean {
  if (marca.excetoCategorias?.includes(categoria)) return false
  if (marca.diferenciaMaiusculas) {
    return marca.termos.some((t) =>
      new RegExp(`(^|[^A-Za-z0-9])${escaparRegex(t)}(?=$|[^A-Za-z0-9])`).test(textoOriginal)
    )
  }
  return marca.termos.some((t) => contemTermo(textoSemAcento, t))
}

/**
 * P2.14.5.13.5 — pesos do PERFIL (somam 80 = TETO_DO_PERFIL). O perfil é a
 * SOMA dos pontos sustentados por dado real; critério desconhecido não tira
 * ponto, mas também não entrega os pontos que não foram comprovados. A
 * cobertura diz quanto do perfil pôde ser avaliado.
 */
export const PESOS_DO_PERFIL = {
  categoria: 25,
  subcategoria: 20,
  preco: 25,
  conteudo: 10,
} as const

/** Pontos de preço fora da faixa: neutro (abaixo do mínimo ou até o premium) e alto. */
export const PONTOS_DE_PRECO = { naFaixa: 25, neutro: 12, acimaDoPremium: 5 } as const

/**
 * Aderência ao perfil da BoraComprar.
 *
 * PERFIL (0–80): soma dos pontos SUSTENTADOS (pesos em `PESOS_DO_PERFIL`).
 * Só preço comprovado vale no máximo 25/80; categoria + subcategoria + preço
 * valem 70/80. `coberturaDoPerfil` = pesos avaliados ÷ 80.
 *
 * Sinais lidos SÓ no nome do produto (subcategoria, estilo, marca): a
 * descrição livre gerava falso positivo ("levar na bolsa"). `#usei` continua
 * vindo de Observações. Decisão da titular (P2.14.5.13.6): falso negativo
 * temporário é preferível a aderência inventada — se a subcategoria só
 * aparece na descrição, ela é DESCONHECIDA.
 *
 * Evolução futura (não implementada): um campo estruturado de
 * subcategoria/tags, ou dado oficial da plataforma, pode alimentar o
 * critério de subcategoria. Se a descrição livre algum dia for usada, terá
 * peso menor e regra própria — nunca os 20 pontos completos do nome.
 *
 * AFINIDADE (0–20): marca preferida +10, estilo +5, comprado +5 OU usado +10
 * (não acumulam). Só entra na nota se o perfil for ≥ 40/80. Nunca é prova de
 * demanda e nunca penaliza quem não tem marca preferida.
 */
export function avaliarAderenciaAoPerfil(
  p: {
    categoria: string
    preco: number | null
    origemDados: string | null | undefined
    nome?: string | null
    /** Não é usada para sinais (P2.14.5.13.5). Mantida por compatibilidade. */
    descricao?: string | null
    observacoes?: string | null
  },
  perfil: PerfilDaLoja = PERFIL_DA_LOJA
): AvaliacaoDeAderencia {
  const positivos: string[] = []
  const negativos: string[] = []
  const desconhecidos: string[] = []
  let pontos = 0
  let pesoAvaliado = 0

  const categoria = (p.categoria ?? '').trim()
  const nomeOriginal = (p.nome ?? '').trim()
  const nome = semAcento(nomeOriginal)

  // Categoria do cadastro (25).
  if (!categoria || categoria === 'Outros') {
    desconhecidos.push('aderência da categoria ("Outros" ou vazia)')
  } else {
    pesoAvaliado += PESOS_DO_PERFIL.categoria
    if (perfil.categoriasDoCadastro.some((c) => semAcento(c) === semAcento(categoria))) {
      pontos += PESOS_DO_PERFIL.categoria
      positivos.push(`Categoria "${categoria}" é prioridade da loja (+${PESOS_DO_PERFIL.categoria}).`)
    } else {
      negativos.push(`Categoria "${categoria}" fora das prioridades da loja (0/${PESOS_DO_PERFIL.categoria}).`)
    }
  }

  // Subcategoria pelo NOME (20). Sem termo reconhecido = desconhecido.
  const subcategorias = Object.entries(perfil.subcategoriasPrioritarias)
    .filter(([, termos]) => termos.some((t) => contemTermo(nome, t)))
    .map(([s]) => s)
  if (subcategorias.length > 0) {
    pesoAvaliado += PESOS_DO_PERFIL.subcategoria
    pontos += PESOS_DO_PERFIL.subcategoria
    positivos.push(`Subcategoria prioritária da loja no nome: ${subcategorias.join(', ')} (+${PESOS_DO_PERFIL.subcategoria}).`)
  } else {
    desconhecidos.push('subcategoria (nenhum termo prioritário no nome)')
  }

  // Preço (25): referência, não trava.
  if (typeof p.preco === 'number') {
    pesoAvaliado += PESOS_DO_PERFIL.preco
    const { minimo, maximo, premiumAte } = perfil.faixaDePreco
    const valor = `R$ ${p.preco.toFixed(2)}`
    if (p.preco >= minimo && p.preco <= maximo) {
      pontos += PONTOS_DE_PRECO.naFaixa
      positivos.push(`Preço ${valor} dentro da faixa da loja (R$ ${minimo}–${maximo}) (+${PONTOS_DE_PRECO.naFaixa}).`)
    } else if (p.preco < minimo || p.preco <= premiumAte) {
      pontos += PONTOS_DE_PRECO.neutro
      negativos.push(`Preço ${valor} fora da faixa de referência (R$ ${minimo}–${maximo}) — neutro, não elimina (+${PONTOS_DE_PRECO.neutro}).`)
    } else {
      pontos += PONTOS_DE_PRECO.acimaDoPremium
      negativos.push(`Preço ${valor} acima de R$ ${premiumAte} — concorre pela demanda e comissão, não pela faixa (+${PONTOS_DE_PRECO.acimaDoPremium}).`)
    }
  } else {
    desconhecidos.push('preço (para checar a faixa da loja)')
  }

  // Conteúdo (10): sem dado nesta fase — fica desconhecido, sem pontos.
  if (perfil.priorizarFacilDeDemonstrar) desconhecidos.push('facilidade de demonstrar (não informada)')
  if (perfil.priorizarSemPresencaDaTitular) desconhecidos.push('se o conteúdo dispensa a presença da titular (não informado)')

  const perfilNota = pesoAvaliado > 0 ? Math.round(pontos) : null
  const coberturaDoPerfil = Math.round((pesoAvaliado / TETO_DO_PERFIL) * 100) / 100

  // ── Afinidade da titular (sinais só no nome; #usei em Observações) ────
  const af = perfil.afinidadeDaTitular
  const sinaisDeAfinidade: string[] = []
  let bruto = 0
  const marca = af.marcasPreferidas.find((m) => contemMarca(nomeOriginal, nome, m, categoria))
  if (marca) {
    bruto += af.bonus.marcaPreferida
    sinaisDeAfinidade.push(`marca preferida da titular (${marca.nome})`)
  }
  const estilo = af.estilo.find((t) => contemTermo(nome, t))
  if (estilo) {
    bruto += af.bonus.estilo
    sinaisDeAfinidade.push(`estilo da titular (${estilo})`)
  }
  const usado = semAcento(p.observacoes ?? '').includes(semAcento(af.marcadorDeUso))
  const comprado = produtoCompradoPelaTitular(p.origemDados)
  if (usado) {
    bruto += af.bonus.usado
    sinaisDeAfinidade.push('usado pela titular')
  } else if (comprado) {
    bruto += af.bonus.comprado
    sinaisDeAfinidade.push('comprado pela titular')
  }
  const afinidadeDetectada = Math.min(af.teto, bruto)

  const aplica = perfilNota !== null && perfilNota >= af.perfilMinimoParaBonus
  const afinidade = aplica ? afinidadeDetectada : 0
  if (afinidadeDetectada > 0) {
    const sinais = sinaisDeAfinidade.join('; ')
    if (aplica) positivos.push(`Afinidade da titular +${afinidade}: ${sinais}.`)
    else if (perfilNota === null) positivos.push(`Afinidade da titular (${sinais}) — perfil desconhecido: não entra na nota, só no desempate.`)
    else positivos.push(`Afinidade da titular (${sinais}) — não aplicada: perfil ${perfilNota}/${TETO_DO_PERFIL} abaixo de ${af.perfilMinimoParaBonus}.`)
  }

  return {
    nota: perfilNota === null ? null : perfilNota + afinidade,
    perfil: perfilNota,
    coberturaDoPerfil,
    afinidade,
    afinidadeDetectada,
    sinaisDeAfinidade,
    usadoPelaTitular: usado,
    positivos,
    negativos,
    desconhecidos,
  }
}

// ── Compliance do produto (P2.14.5.12) ──────────────────────────────────

export const NIVEIS_DE_RISCO = ['BAIXO', 'MEDIO', 'ALTO'] as const
export type NivelDeRisco = (typeof NIVEIS_DE_RISCO)[number]

/**
 * Saúde, suplementos e promessa de resultado: risco ALTO (não elimina; o
 * modo automático não escolhe). "Beleza" sozinha NÃO é sensível — decisão
 * da titular em 08/10/2026. Busca por palavra, sem acento.
 */
export const CATEGORIAS_DE_RISCO_ALTO: readonly string[] = ['Saúde']
export const TERMOS_DE_RISCO_ALTO: readonly RegExp[] = [
  /\bsuplement\w*/,
  /\bemagrec\w*/,
  /\bperd(a|er) de peso\b/,
  /\bqueima de gordura\b/,
  /\bdetox\b/,
  /\bcura(r|s|do|da)?\b/,
  /\btratament\w*/,
  /\bmedicament\w*/,
  /\bremedio\w*/,
  /\bmilagr\w*/,
  /\bgarantid[oa]s?\b/,
  /\b100% (eficaz|garantido)/,
  /\bdoenca\w*/,
  /\bclinicamente comprovad\w*/,
  /\b(indicacao|prescricao|recomendacao) medica\b/,
]

/**
 * P2.14.5.12.1 — cuidados capilares de beleza NÃO são tratamento de saúde
 * (decisão da titular em 08/10/2026). Estas expressões são retiradas do
 * texto antes da busca de risco alto; hidratação, nutrição, reconstrução e
 * proteção térmica já não disparam nenhum termo.
 */
export const EXPRESSOES_CAPILARES_LIBERADAS: readonly RegExp[] = [
  /\btratamentos? capilar(es)?\b/g,
  /\btratamentos? (para|dos|de) (os )?cabelos?\b/g,
]

/** Alerta, sem bloqueio e sem tirar do modo automático. */
export const TERMOS_DE_RISCO_MEDIO: readonly RegExp[] = [/\banti-?queda\b/, /\bqueda de cabelo\b/]

export interface AvaliacaoDeCompliance {
  /** `true` elimina o candidato. */
  bloqueante: boolean
  motivoDoBloqueio: string | null
  nivel: NivelDeRisco
  riscos: string[]
  /** Mídia sem direito: o candidato fica, mas a mídia não é usada e não se publica. */
  publicacaoImpedida: boolean
}

export function avaliarComplianceDoProduto(p: {
  disponivel: boolean
  providerId: string | null
  categoria: string
  textos: Array<string | null | undefined>
  temLink: boolean
  midiaAutorizada: boolean
  motivoDaMidia: string
  preco: number | null
  verificadoEm: Date | null
  agora: Date
}): AvaliacaoDeCompliance {
  if (!p.disponivel) {
    return { bloqueante: true, motivoDoBloqueio: 'Produto indisponível ou removido da origem.', nivel: 'ALTO', riscos: [], publicacaoImpedida: true }
  }
  const provider = p.providerId ? buscarProvider(p.providerId) : undefined
  if (provider && provider.cadastroDisponivel === false) {
    return {
      bloqueante: true,
      motivoDoBloqueio: `O programa "${provider.nome}" não permite cadastro.`,
      nivel: 'ALTO',
      riscos: [],
      publicacaoImpedida: true,
    }
  }

  const riscos: string[] = []
  let nivel: NivelDeRisco = 'BAIXO'
  const subir = (n: NivelDeRisco) => {
    if (NIVEIS_DE_RISCO.indexOf(n) > NIVEIS_DE_RISCO.indexOf(nivel)) nivel = n
  }

  // P2.14.5.13.4: comparação sem acento e sem maiúsculas — "Saude" (cadastro
  // antigo) é "Saúde". Só a comparação; a categoria gravada não muda.
  const categoriaComparavel = semAcento((p.categoria ?? '').trim())
  if (CATEGORIAS_DE_RISCO_ALTO.some((c) => semAcento(c) === categoriaComparavel)) {
    riscos.push(`Categoria "${p.categoria}" exige cuidado com alegações (risco alto).`)
    subir('ALTO')
  }
  const texto = semAcento(p.textos.filter(Boolean).join(' \n '))
  const textoSemCapilar = EXPRESSOES_CAPILARES_LIBERADAS.reduce((t, re) => t.replace(re, ' '), texto)
  if (TERMOS_DE_RISCO_ALTO.some((re) => re.test(textoSemCapilar))) {
    riscos.push('Texto do produto sugere suplemento, tratamento, alegação médica ou promessa de resultado (risco alto).')
    subir('ALTO')
  }
  if (TERMOS_DE_RISCO_MEDIO.some((re) => re.test(texto))) {
    riscos.push('Texto menciona antiqueda/queda de cabelo — cuidado com alegação de resultado (risco médio).')
    subir('MEDIO')
  }

  if (!p.midiaAutorizada) {
    riscos.push(`Mídia sem direito de uso verificado — não será usada nem publicada. ${p.motivoDaMidia}`.trim())
    subir('MEDIO')
  }
  if (!p.temLink) {
    riscos.push('Sem link de destino cadastrado.')
    subir('MEDIO')
  }
  const preco = avaliarPreco({ preco: p.preco, verificadoEm: p.verificadoEm, agora: p.agora })
  if (preco.status === 'PRECO_NAO_VERIFICADO' || preco.status === 'PRECO_DESATUALIZADO') {
    riscos.push('Preço informado, sem verificação recente na origem — o conteúdo não afirmará preço.')
    subir('MEDIO')
  }
  if (p.providerId && !provider) {
    riscos.push(`Programa "${p.providerId}" não está no registro de programas.`)
    subir('MEDIO')
  }

  return { bloqueante: false, motivoDoBloqueio: null, nivel, riscos, publicacaoImpedida: !p.midiaAutorizada }
}

// ── A oportunidade pontuada ─────────────────────────────────────────────

export interface OportunidadePontuada {
  workspaceId: string
  produtoId: string
  produtoNome: string
  provider: string | null
  categoria: string
  origem: OrigemOportunidade

  /** A nota do motor existente. Nunca há uma segunda nota concorrente. */
  score: number
  componentes: OpportunityScoreComponents
  desempenho: DesempenhoHistorico

  classificacao: ClassificacaoDaOportunidade
  motivosDeProntidao: MotivoNaoPronta[]
  canaisElegiveis: string[]

  confianca: NivelDeConfianca
  dadosUsados: string[]
  dadosAusentes: string[]
  /** Por que está nesta posição, em frases. */
  porqueDestaPosicao: string[]

  receitaPotencialEstimada: number | null
  baseDaEstimativa: string

  // ── P2.14.5.12: explicação para curadoria ────────────────────────────
  /** O que pesa a favor, só com dado real. */
  motivosPositivos?: string[]
  /** Riscos e alertas de compliance (não eliminam). */
  riscos?: string[]
  /** Tudo o que o motor NÃO sabe, em linguagem clara. */
  desconhecidos?: string[]
  nivelDeRisco?: NivelDeRisco
  /** `true` = eliminado (ex.: provedor não permite cadastro, indisponível). */
  complianceBloqueante?: boolean
  motivoDoBloqueio?: string | null
  /** Mídia sem direito: pode ser escolhido, mas não se publica. */
  publicacaoImpedida?: boolean
  compradoPelaTitular?: boolean
  /** `#usei` em Observações (Fase 1, temporário). */
  usadoPelaTitular?: boolean
  /** Perfil BoraComprar 0–80 (`null` = desconhecido). */
  aderenciaDoPerfil?: number | null
  /** Bônus de afinidade que entrou na aderência (0–20). */
  afinidadeDaTitular?: number
  /** Afinidade detectada (0–20), usada só no desempate. */
  afinidadeParaDesempate?: number
  /** Fração (0–1) do perfil avaliada com dado real (P2.14.5.13.5). */
  coberturaDoPerfil?: number
  /**
   * P2.17.2 — campanha sazonal ativa (Natal 2026): aderência 0–100 e
   * etiquetas. `null` = nenhuma campanha ativa. Só ORDENA (depois da
   * evidência); não soma ponto no score.
   */
  campanha?: AvaliacaoDaCampanha | null
  /** Comissão estimada por venda (R$), só com preço E percentual reais. */
  comissaoEstimadaBRL?: number | null
}

/** Campos que o score usa. O que não vier fica em `dadosAusentes`. */
const CAMPOS_RELEVANTES = [
  'preco',
  'comissaoPercentual',
  'taxaConversaoObservada',
  'receitaPorClique',
  'provider',
  'imagens',
  'linkProduto',
] as const

export interface ProdutoDoCatalogo {
  id: string
  nome: string
  categoria: string
  preco: number | null
  linkProduto: string | null
  imagens: string[]
  origemConteudo: string
  origemDados: string | null
  providerId: string | null
  status: string
  removidoDaOrigemEm: Date | null
  createdAt: Date
  /** Taxa da oferta, quando algum link do produto a registra. */
  comissaoPercentual: number | null
  /** P2.14.5.12 — textos para o compliance e data real de verificação do preço. */
  descricao?: string | null
  beneficios?: string[]
  observacoes?: string | null
  sincronizadoEm?: Date | null
}

export interface ContextoDoWorkspace {
  /** Canais conectados que conseguem publicar hoje. */
  canaisCapazes: string[]
  agora: Date
  /**
   * P2.14.5.13: perfil da loja gravado no workspace. Ausente = perfil
   * padrão de lib/config.ts. Só muda a ADERÊNCIA; pesos e bônus ficam no
   * código.
   */
  perfil?: PerfilDaLoja
}

/**
 * FUNÇÃO PURA. Pontua UM produto real.
 *
 * Determinística: os mesmos dados produzem exatamente o mesmo score. Nada
 * de `Math.random`, nada de `Date.now()` dentro do cálculo — o instante
 * entra por `contexto.agora` para que o resultado seja reproduzível.
 */
export function pontuarProduto(
  produto: ProdutoDoCatalogo,
  desempenho: DesempenhoHistorico,
  contexto: ContextoDoWorkspace
): OportunidadePontuada {
  const dadosUsados: string[] = []
  const dadosAusentes: string[] = []
  const registrar = (campo: string, presente: boolean) =>
    presente ? dadosUsados.push(campo) : dadosAusentes.push(campo)

  registrar('preco', produto.preco !== null)
  registrar('comissaoPercentual', produto.comissaoPercentual !== null)
  registrar('taxaConversaoObservada', desempenho.taxaConversao !== null)
  registrar('receitaPorClique', desempenho.receitaPorClique !== null)
  registrar('provider', !!produto.providerId)
  registrar('imagens', produto.imagens.length > 0)
  registrar('linkProduto', !!produto.linkProduto)

  const disponivel = produto.status === 'ativo' && produto.removidoDaOrigemEm === null
  const midia = produtoPodeAparecerNoVideo({
    id: produto.id,
    nome: produto.nome,
    origemConteudo: produto.origemConteudo,
    imagens: produto.imagens,
    origemDados: produto.origemDados ?? undefined,
  })

  const prontidao = classificarProntidao({
    disponivel,
    temDestino: !!produto.linkProduto,
    midiaAutorizada: midia.visivel,
    motivoDaMidia: midia.motivo,
    canaisCapazes: contexto.canaisCapazes,
  })

  // P2.14.5.12: compliance determinístico e aderência ao perfil da loja.
  const compliance = avaliarComplianceDoProduto({
    disponivel,
    providerId: produto.providerId,
    categoria: produto.categoria,
    textos: [produto.nome, produto.descricao, produto.observacoes, ...(produto.beneficios ?? [])],
    temLink: !!produto.linkProduto,
    midiaAutorizada: midia.visivel,
    motivoDaMidia: midia.motivo,
    preco: produto.preco,
    verificadoEm: produto.sincronizadoEm ?? null,
    agora: contexto.agora,
  })
  if (compliance.bloqueante && prontidao.classificacao !== 'NAO_ELEGIVEL') {
    prontidao.classificacao = 'NAO_ELEGIVEL'
    prontidao.motivos.push('COMPLIANCE_BLOQUEANTE')
    prontidao.explicacoes.push(compliance.motivoDoBloqueio ?? 'Regra de compliance impede este produto.')
  }
  const aderencia = avaliarAderenciaAoPerfil({
    categoria: produto.categoria,
    preco: produto.preco,
    origemDados: produto.origemDados,
    nome: produto.nome,
    descricao: produto.descricao,
    observacoes: produto.observacoes,
  }, contexto.perfil)

  const origem = origemDaOportunidade(produto.origemDados)
  const comissaoEstimadaBRL =
    produto.preco !== null && produto.comissaoPercentual !== null
      ? produto.preco * (produto.comissaoPercentual / 100)
      : null

  // NOVIDADE: produto recém-cadastrado ainda não teve chance. Isso entra
  // como `trending` indefinido — nunca como `true`, que afirmaria uma
  // tendência que ninguém mediu.
  const diasNoCatalogo = Math.floor(
    (contexto.agora.getTime() - produto.createdAt.getTime()) / (24 * 60 * 60 * 1000)
  )

  const oportunidade: AffiliateOpportunity = {
    providerId: produto.providerId ?? 'MANUAL',
    productName: produto.nome,
    category: produto.categoria,
    price: produto.preco,
    commissionPercent: produto.comissaoPercentual,
    estimatedCommissionBRL: comissaoEstimadaBRL,
    salesVolumeRank: null,
    trending: null,
    historicalConversionRate: desempenho.taxaConversao,
    channelFit: contexto.canaisCapazes,
    origin: origem,
    source: produto.providerId ?? 'catalogo-interno',
    lastVerifiedAt: contexto.agora.toISOString(),
    canGenerateLinkAutomatically: !!produto.linkProduto,
    authorizedMediaAvailable: midia.visivel,
    canGenerateContent: prontidao.classificacao === 'PRONTA_PARA_PUBLICACAO',
    canAutoPublish: false,
    requiresUserConsent: true,
    rulesConfidence: origem === 'OFFICIAL_API' ? 'HIGH' : 'MEDIUM',
    automationCost: 'FREE',
    // Demanda: o catálogo interno não tem — fica desconhecida, nunca zero.
    avaliacao: null,
    numeroDeAvaliacoes: null,
    estoque: null,
    aderenciaAoPerfil: aderencia.nota,
  }

  // A NOTA vem do motor que já existe. Este módulo não calcula outra.
  const componentes = calcularOpportunityScoreComposto(oportunidade, {
    historicalPerformance: desempenho.nota,
    mlPrediction: null,
  })

  const confianca = classificarConfianca({
    temHistoricoReal: desempenho.nota !== null,
    dadosAusentes,
    origem,
    cobertura: componentes.cobertura,
  })

  const receita = estimarReceitaPotencial({
    preco: produto.preco,
    comissaoPercentual: produto.comissaoPercentual,
    taxaConversao: desempenho.taxaConversao,
  })

  // ── Explicação para a curadoria (P2.14.5.12) ─────────────────────────
  const ROTULO_AUSENTE: Record<string, string> = {
    preco: 'preço',
    comissaoPercentual: 'comissão do programa',
    taxaConversaoObservada: 'conversão observada (menos de 5 cliques ou nenhuma publicação)',
    receitaPorClique: 'receita por clique',
    provider: 'programa de afiliados de origem',
    imagens: 'imagem do produto',
    linkProduto: 'link de destino',
  }
  const desconhecidos = [...new Set([
    ...dadosAusentes.map((c) => ROTULO_AUSENTE[c] ?? c),
    'vendas e velocidade de vendas (a fonte não informa)',
    'avaliações de compradores (a fonte não informa)',
    'estoque (a fonte não informa)',
    ...aderencia.desconhecidos,
  ])]
  const motivosPositivos = [
    ...aderencia.positivos,
    midia.visivel ? 'Mídia com direito de uso verificado.' : '',
    produto.linkProduto ? 'Tem link de destino cadastrado.' : '',
    comissaoEstimadaBRL !== null ? `Comissão estimada de R$ ${comissaoEstimadaBRL.toFixed(2)} por venda.` : '',
    desempenho.nota !== null && desempenho.nota >= 60 ? `Bom desempenho real observado (${desempenho.nota}/100).` : '',
  ].filter(Boolean)
  const riscos = [...compliance.riscos, ...aderencia.negativos]

  const campanha = avaliarCampanha({ categoria: produto.categoria, nome: produto.nome, descricao: produto.descricao, preco: produto.preco }, contexto.agora)
  if (campanha && campanha.aderencia > 0) {
    motivosPositivos.push(`${campanha.nome}: ${campanha.motivos.join(', ')} (etiquetas: ${campanha.tags.join(', ')}).`)
  }

  const porqueDestaPosicao = [
    campanha
      ? `${campanha.nome}: aderência ${campanha.aderencia}/100 — bônus de ordenação dentro da mesma faixa de evidência; não muda o score nem passa à frente de evidência maior.`
      : '',
    componentes.externalMarketSignals === null
      ? 'Sinais de mercado: desconhecidos (sem vendas, tendência, comissão ou avaliações) — não entram na nota.'
      : `Sinais de mercado: ${componentes.externalMarketSignals}/100.`,
    `Capacidade de automatizar: ${componentes.automationFeasibility}/100.`,
    `Base de evidência (mercado, automatização, histórico e ML com dado real): ${componentes.base}/100.`,
    aderencia.nota === null
      ? 'Aderência ao perfil BoraComprar: sem base para avaliar — não entra na nota.'
      : `Aderência ao perfil BoraComprar: ${aderencia.nota}/100 = perfil ${aderencia.perfil}/${TETO_DO_PERFIL} + afinidade da titular ${aderencia.afinidade}/20 — vale ${Math.round(PARTICIPACAO_DA_ADERENCIA * 100)}% da nota.`,
    `Perfil: ${aderencia.perfil ?? 0}/${TETO_DO_PERFIL} · cobertura ${Math.round(aderencia.coberturaDoPerfil * 100)}% (o que não pôde ser avaliado não soma ponto).`,
    aderencia.afinidadeDetectada > 0
      ? `Afinidade da titular (${aderencia.sinaisDeAfinidade.join('; ')}) é bônus de aderência, não prova de demanda.`
      : '',
    `Nota apoiada em dado real: ${Math.round(componentes.cobertura * 100)}% do peso de evidência.`,
    desempenho.nota === null
      ? 'Sem histórico real suficiente — a nota vem só do que dá para saber antes de publicar.'
      : `Desempenho observado: ${desempenho.nota}/100.`,
    ...desempenho.partes,
    ...prontidao.explicacoes,
    diasNoCatalogo <= 7 ? `Produto novo no catálogo (${diasNoCatalogo} dia(s)) — ainda sem chance de provar.` : '',
  ].filter(Boolean)

  return {
    workspaceId: '',
    produtoId: produto.id,
    produtoNome: produto.nome,
    provider: produto.providerId,
    categoria: produto.categoria,
    origem,
    score: componentes.final,
    componentes,
    desempenho,
    classificacao: prontidao.classificacao,
    motivosDeProntidao: prontidao.motivos,
    canaisElegiveis: prontidao.classificacao === 'PRONTA_PARA_PUBLICACAO' ? contexto.canaisCapazes : [],
    confianca,
    dadosUsados,
    dadosAusentes,
    porqueDestaPosicao,
    receitaPotencialEstimada: receita.valor,
    baseDaEstimativa: receita.base,
    motivosPositivos,
    riscos,
    desconhecidos,
    nivelDeRisco: compliance.nivel,
    complianceBloqueante: compliance.bloqueante,
    motivoDoBloqueio: compliance.motivoDoBloqueio,
    publicacaoImpedida: compliance.publicacaoImpedida,
    compradoPelaTitular: produtoCompradoPelaTitular(produto.origemDados),
    usadoPelaTitular: aderencia.usadoPelaTitular,
    aderenciaDoPerfil: aderencia.perfil,
    afinidadeDaTitular: aderencia.afinidade,
    afinidadeParaDesempate: aderencia.afinidadeDetectada,
    coberturaDoPerfil: aderencia.coberturaDoPerfil,
    campanha,
    comissaoEstimadaBRL,
  }
}

// ── Leitura do catálogo real ────────────────────────────────────────────

/**
 * Monta a fila do workspace, do mais promissor ao menos.
 *
 * SÓ produto real: `status` diferente de descartado e origem de registro
 * que não seja sintética. Nada é criado, publicado ou alterado aqui — o
 * motor é somente leitura.
 */
export interface ParametrosDaFila {
  workspaceId: string
  agora?: Date
  /** Canais que conseguem publicar. Sem isso, nada fica PRONTA. */
  canaisCapazes?: string[]
  limite?: number
  /** P2.14.5.13: perfil da loja do workspace (ausente = padrão). */
  perfil?: PerfilDaLoja
}

export async function montarFilaDeOportunidades(params: ParametrosDaFila): Promise<OportunidadePontuada[]> {
  return (await montarFilaComProdutos(params)).fila
}

/**
 * P2.15: a fila E os produtos já carregados — quem precisa dos dados do
 * produto (a curadoria) não consulta o banco de novo. Métricas e saturação
 * rodam em paralelo: cada ida ao banco custa caro fora da região do banco.
 */
export async function montarFilaComProdutos(params: ParametrosDaFila) {
  const workspaceId = (params?.workspaceId ?? '').trim()
  if (!workspaceId) return { fila: [] as OportunidadePontuada[], produtos: [] as ProdutoDaFila[] }
  const agora = params?.agora ?? new Date()

  const produtos = await prisma.produto.findMany({
    where: {
      workspaceId,
      // P2.18.11: excluído pela titular nunca entra; 'inativo' (fora da origem) entra como NAO_ELEGIVEL, com o motivo.
      ...PRODUTO_NAO_EXCLUIDO,
      // Produto sintético NUNCA entra na fila de produção. `origemDados` é
      // NOT NULL com default 'MANUAL', então um `notIn` já cobre todo o
      // catálogo real — não há linha sem valor para tratar à parte.
      origemDados: { notIn: [...ORIGENS_SINTETICAS] },
    },
    select: {
      id: true,
      nome: true,
      categoria: true,
      preco: true,
      linkProduto: true,
      imagens: true,
      origemConteudo: true,
      origemDados: true,
      providerId: true,
      externalId: true,
      status: true,
      removidoDaOrigemEm: true,
      createdAt: true,
      descricao: true,
      beneficios: true,
      observacoes: true,
      sincronizadoEm: true,
      linksDinamicos: { select: { comissao: true }, take: 5 },
    },
  })
  if (produtos.length === 0) return { fila: [] as OportunidadePontuada[], produtos }

  // Métricas reais por produto (ver lib/metricas-clique.ts) e saturação
  // (publicações distribuídas na janela), em paralelo.
  const desde = new Date(agora.getTime() - JANELA_DE_SATURACAO_DIAS * 24 * 60 * 60 * 1000)
  const [metricas, conteudosRecentes] = await Promise.all([
    calcularMetricasPorProduto(
      workspaceId,
      produtos.map((p) => p.id),
      agora
    ),
    (async () => {
      const recentes = await prisma.publicacao.groupBy({
        by: ['contentId'],
        where: { workspaceId, estado: 'DISTRIBUIDA', distribuidaEm: { gte: desde, lt: agora } },
        _count: { _all: true },
      })
      // Sem publicação recente (o caso comum hoje): nenhuma consulta a mais.
      const conteudos = recentes.length
        ? await prisma.conteudo.findMany({
            where: { workspaceId, id: { in: recentes.map((r) => r.contentId) } },
            select: { id: true, produtoId: true },
          })
        : []
      return { recentes, conteudos }
    })(),
  ])
  const porProduto = new Map(metricas.map((m) => [m.produtoId, m]))
  const { recentes, conteudos } = conteudosRecentes
  const produtoDoConteudo = new Map(conteudos.map((c) => [c.id, c.produtoId]))
  const publicacoesPorProduto = new Map<string, number>()
  for (const r of recentes) {
    const pid = produtoDoConteudo.get(r.contentId)
    if (!pid) continue
    publicacoesPorProduto.set(pid, (publicacoesPorProduto.get(pid) ?? 0) + r._count._all)
  }

  const contexto: ContextoDoWorkspace = {
    canaisCapazes: params?.canaisCapazes ?? [],
    agora,
    perfil: params?.perfil,
  }

  const fila = produtos.map((p) => {
    const m = porProduto.get(p.id)
    const desempenho = calcularDesempenhoHistorico({
      taxaConversao: m?.taxaConversao ?? null,
      receitaPorClique: m?.receitaPorClique ?? null,
      cliques: m?.cliques ?? 0,
      vendasElegiveis: m?.vendasElegiveis ?? 0,
      publicacoesRecentes: publicacoesPorProduto.get(p.id) ?? 0,
    })

    // A taxa da oferta vem do link, que é onde ela é registrada.
    const comissaoPercentual = comissaoDaOferta(p.linksDinamicos)

    const pontuada = pontuarProduto(
      { ...p, comissaoPercentual },
      desempenho,
      contexto
    )
    return { ...pontuada, workspaceId }
  })

  ordenarFila(fila)
  return { fila: typeof params?.limite === 'number' ? fila.slice(0, params.limite) : fila, produtos }
}

/** Produto como carregado pela fila (o que a curadoria reaproveita). */
export type ProdutoDaFila = {
  id: string
  nome: string
  categoria: string | null
  preco: number | null
  linkProduto: string | null
  imagens: string[]
  providerId: string | null
  externalId: string | null
  origemDados: string
  linksDinamicos: { comissao: number | null }[]
}

/** Taxa da oferta: a primeira registrada nos links do produto, ou null. */
export function comissaoDaOferta(links: { comissao: number | null }[]): number | null {
  const comissoes = links.map((l) => l.comissao).filter((c): c is number => typeof c === 'number')
  return comissoes.length > 0 ? comissoes[0] : null
}

// ── Ordem da fila (P2.14.5.12.1) ────────────────────────────────────────

/** Largura da faixa de evidência dentro da qual vale o desempate por aderência. */
export { FAIXA_DE_DESEMPATE }

const PESO_DA_CONFIANCA: Record<NivelDeConfianca, number> = {
  ALTA: 3,
  MEDIA: 2,
  BAIXA: 1,
  SEM_HISTORICO_REAL: 0,
}

/** Faixa da BASE de evidência (sem aderência): 70–74 → 14. */
export function faixaDeEvidencia(o: Pick<OportunidadePontuada, 'componentes' | 'score'>): number {
  return Math.floor((o.componentes?.base ?? o.score) / FAIXA_DE_DESEMPATE)
}

type Desempate = 'faixa' | 'campanha' | 'perfil' | 'afinidade' | 'comissao' | 'facilidade' | 'score' | 'confianca' | 'cobertura' | 'tecnico' | null

/**
 * Qual critério põe `a` à frente de `b` (ou o contrário). Ordem da regra da
 * titular (P2.14.5.13.6, P2.17.2): faixa de evidência → campanha sazonal →
 * perfil → afinidade → comissão → facilidade de criação → score →
 * confiança → cobertura do perfil (maior primeiro) → nome normalizado → id.
 * Nome e id são só técnicos (empate técnico): nunca significam ser melhor.
 * Só ORDENA: não soma ponto a ninguém.
 */
export function criterioDeDesempate(a: OportunidadePontuada, b: OportunidadePontuada): { diferenca: number; criterio: Desempate } {
  const fa = faixaDeEvidencia(a)
  const fb = faixaDeEvidencia(b)
  if (fa !== fb) return { diferenca: fb - fa, criterio: 'faixa' }
  // P2.17.2 — campanha sazonal ativa (Natal 2026): logo depois da evidência.
  // Sem campanha ativa os dois ficam em -1 e o critério não decide nada.
  const ka = a.campanha?.aderencia ?? -1
  const kb = b.campanha?.aderencia ?? -1
  if (ka !== kb) return { diferenca: kb - ka, criterio: 'campanha' }
  // Perfil desconhecido não é "maior": vem depois de qualquer perfil conhecido.
  const pa = a.aderenciaDoPerfil ?? -1
  const pb = b.aderenciaDoPerfil ?? -1
  if (pa !== pb) return { diferenca: pb - pa, criterio: 'perfil' }
  const aa = a.afinidadeParaDesempate ?? 0
  const ab = b.afinidadeParaDesempate ?? 0
  if (aa !== ab) return { diferenca: ab - aa, criterio: 'afinidade' }
  // P2.17.2 — depois do público: comissão (R$ por venda; desconhecida vem
  // depois de qualquer conhecida) e facilidade de criar o conteúdo.
  const ma = a.comissaoEstimadaBRL ?? -1
  const mb = b.comissaoEstimadaBRL ?? -1
  if (ma !== mb) return { diferenca: mb - ma, criterio: 'comissao' }
  const ea = a.componentes?.automationFeasibility ?? 0
  const eb = b.componentes?.automationFeasibility ?? 0
  if (ea !== eb) return { diferenca: eb - ea, criterio: 'facilidade' }
  if (a.score !== b.score) return { diferenca: b.score - a.score, criterio: 'score' }
  const ca = PESO_DA_CONFIANCA[a.confianca]
  const cb = PESO_DA_CONFIANCA[b.confianca]
  if (ca !== cb) return { diferenca: cb - ca, criterio: 'confianca' }
  // P2.14.5.13.6 — cobertura do perfil: só em empate real, prefere quem é
  // sustentado por mais dado conhecido. Não altera score nem aderência.
  const cova = a.coberturaDoPerfil ?? 0
  const covb = b.coberturaDoPerfil ?? 0
  if (cova !== covb) return { diferenca: covb - cova, criterio: 'cobertura' }
  // P2.14.5.13.5 — EMPATE TÉCNICO: nenhum critério substantivo diferencia.
  // Só para a lista ser estável: nome normalizado e depois id. Não soma
  // ponto e não significa que um é melhor que o outro.
  const na = semAcento(a.produtoNome ?? '')
  const nb = semAcento(b.produtoNome ?? '')
  if (na !== nb) return { diferenca: na < nb ? -1 : 1, criterio: 'tecnico' }
  if (a.produtoId !== b.produtoId) return { diferenca: a.produtoId < b.produtoId ? -1 : 1, criterio: 'tecnico' }
  return { diferenca: 0, criterio: null }
}

/** Nenhum critério substantivo diferencia `a` de `b`. */
export function empateTecnico(a: OportunidadePontuada, b: OportunidadePontuada): boolean {
  const { criterio } = criterioDeDesempate(a, b)
  return criterio === 'tecnico' || criterio === null
}

export const TEXTO_DO_EMPATE_TECNICO = 'Empate técnico: não há evidência suficiente para diferenciar estes produtos.'

/** Ordena a fila no lugar, do mais promissor ao menos. */
export function ordenarFila<T extends OportunidadePontuada>(fila: T[]): T[] {
  return fila.sort((a, b) => criterioDeDesempate(a, b).diferenca)
}

const ROTULO_DO_DESEMPATE: Record<Exclude<Desempate, null>, string> = {
  faixa: 'evidência mais alta',
  campanha: 'maior aderência à campanha sazonal ativa (Natal 2026)',
  comissao: 'comissão por venda maior',
  facilidade: 'conteúdo mais fácil de criar',
  perfil: 'maior aderência ao perfil BoraComprar',
  afinidade: 'maior afinidade da titular',
  score: 'score maior',
  confianca: 'confiança maior',
  cobertura: 'perfil sustentado por mais dados conhecidos (cobertura), sem mudar o score',
  tecnico: 'ordem técnica (nome), que não significa ser melhor',
}

// ── Seleção por modo de automação (P2.14.5.12) ──────────────────────────

export type ModoDeAutomacao = 'MANUAL' | 'ASSISTED' | 'AUTOMATIC'

/** Quantos candidatos a curadoria (ASSISTED) apresenta. */
export const CANDIDATOS_NA_CURADORIA = 3
/** Quantos produtos o modo automático escolhe por ciclo. */
export const ESCOLHAS_NO_AUTOMATICO = 1

export interface CandidatoSelecionado extends OportunidadePontuada {
  posicao: number
  /** Por que ficou nesta posição em relação aos vizinhos. */
  motivoDaPosicao: string
}

export interface SelecaoPorModo {
  modo: ModoDeAutomacao
  pausado: boolean
  candidatos: CandidatoSelecionado[]
  /** Quem saiu e por quê (compliance, risco, diversidade, topo). */
  descartados: { produtoId: string; motivo: string }[]
  explicacao: string
}

/**
 * Decide o que cada modo entrega, SEM recalcular nada: a fila já vem
 * pontuada e ordenada por `montarFilaDeOportunidades` (`ordenarFila`: faixa
 * de evidência, aderência, afinidade, score, confiança).
 *
 *   pausado ou MANUAL → nenhum candidato, nenhuma tarefa automática
 *   ASSISTED          → os 3 melhores elegíveis, para a titular escolher 1;
 *                       nada é gerado nem publicado antes da escolha
 *   AUTOMATIC         → no máximo 1, excluindo risco ALTO
 *
 * Elegível = não eliminado por compliance e não NAO_ELEGIVEL. A diversidade
 * é a mesma do plano de ação (`aplicarDiversidade`).
 */
export function selecionarParaModo(
  fila: OportunidadePontuada[],
  controles: { automationMode: string | null | undefined; automationPaused: boolean }
): SelecaoPorModo {
  const modo: ModoDeAutomacao =
    controles.automationMode === 'ASSISTED' || controles.automationMode === 'AUTOMATIC'
      ? controles.automationMode
      : 'MANUAL'
  const base = { modo, pausado: controles.automationPaused, candidatos: [], descartados: [] }

  if (controles.automationPaused) {
    return { ...base, explicacao: 'Automação pausada: nenhum candidato e nenhuma tarefa automática.' }
  }
  if (modo === 'MANUAL') {
    return { ...base, explicacao: 'Modo manual: o Patrono não escolhe produto nem cria tarefa automática.' }
  }

  const descartados: { produtoId: string; motivo: string }[] = []
  const elegiveis = fila.filter((o) => {
    if (o.complianceBloqueante || o.classificacao === 'NAO_ELEGIVEL') {
      descartados.push({ produtoId: o.produtoId, motivo: o.motivoDoBloqueio ?? 'Não elegível (indisponível ou bloqueado).' })
      return false
    }
    if (modo === 'AUTOMATIC' && o.nivelDeRisco === 'ALTO') {
      descartados.push({ produtoId: o.produtoId, motivo: 'Risco de compliance alto: o modo automático não escolhe; só a curadoria.' })
      return false
    }
    return true
  })

  const limite = modo === 'ASSISTED' ? CANDIDATOS_NA_CURADORIA : ESCOLHAS_NO_AUTOMATICO
  const diversidade = aplicarDiversidade(elegiveis, limite)
  descartados.push(...diversidade.descartados)

  const escolhidos = diversidade.escolhidos
  const candidatos: CandidatoSelecionado[] = escolhidos.map((o, i) => {
    const acima = escolhidos[i - 1]
    const abaixo = escolhidos[i + 1]
    const partes = [`${i + 1}º de ${elegiveis.length} elegível(is), score ${o.score} (confiança ${o.confianca}).`]
    const empatados = elegiveis.filter((x) => x.produtoId !== o.produtoId && empateTecnico(o, x)).length
    if (empatados > 0) {
      partes.push(
        `${TEXTO_DO_EMPATE_TECNICO} Empatado com ${empatados} outro(s) elegível(is); a ordem entre eles é só técnica (nome) e não significa que este é melhor.`
      )
    }
    const relacao = (de: OportunidadePontuada, ate: OportunidadePontuada, posicaoDoOutro: number, frente: boolean) => {
      const { criterio } = criterioDeDesempate(frente ? de : ate, frente ? ate : de)
      const diff = Math.abs(de.score - ate.score)
      if (criterio === 'tecnico' || criterio === null) {
        return `Em empate técnico com o ${posicaoDoOutro}º.`
      }
      if (criterio === 'faixa') {
        return diff > 0
          ? `${diff} ponto(s) ${frente ? 'acima' : 'abaixo'} do ${posicaoDoOutro}º.`
          : `Mesmo score do ${posicaoDoOutro}º; base de evidência ${frente ? 'maior' : 'menor'}.`
      }
      const faixa = faixaDeEvidencia(de) * FAIXA_DE_DESEMPATE
      return (
        `Mesma faixa de evidência que o ${posicaoDoOutro}º (${faixa}–${faixa + FAIXA_DE_DESEMPATE - 1}); ` +
        `${frente ? 'ficou à frente' : 'ficou atrás'} por ${ROTULO_DO_DESEMPATE[criterio]}` +
        (diff > 0 ? ` (score ${de.score} × ${ate.score}).` : '.')
      )
    }
    if (acima) partes.push(relacao(o, acima, i, false))
    if (abaixo) partes.push(relacao(o, abaixo, i + 2, true))
    return { ...o, posicao: i + 1, motivoDaPosicao: partes.join(' ') }
  })

  const explicacao =
    candidatos.length === 0
      ? `Nenhum produto elegível para o modo ${modo}.`
      : modo === 'ASSISTED'
        ? `Curadoria: ${candidatos.length} candidato(s) para a titular escolher 1. Nada é gerado nem publicado antes da escolha.`
        : 'Automático: 1 produto escolhido. Nesta fase, nenhuma publicação real é executada.'

  return { modo, pausado: false, candidatos, descartados, explicacao }
}

// ── Detecção de mudança ─────────────────────────────────────────────────

export interface MudancaNaFila {
  novas: string[]
  queda: { produtoId: string; de: number; para: number }[]
  alta: { produtoId: string; de: number; para: number }[]
}

/**
 * FUNÇÃO PURA. O que mudou entre duas execuções.
 *
 * É o que permite o motor rodar sozinho e avisar só quando há novidade —
 * em vez de obrigar alguém a reler a fila inteira todo dia.
 */
export function compararFilas(
  anterior: { produtoId: string; score: number }[],
  atual: { produtoId: string; score: number }[],
  limiar = 10
): MudancaNaFila {
  const antes = new Map(anterior.map((o) => [o.produtoId, o.score]))
  const novas: string[] = []
  const queda: MudancaNaFila['queda'] = []
  const alta: MudancaNaFila['alta'] = []

  for (const o of atual) {
    const de = antes.get(o.produtoId)
    if (de === undefined) {
      novas.push(o.produtoId)
      continue
    }
    const delta = o.score - de
    if (delta <= -limiar) queda.push({ produtoId: o.produtoId, de, para: o.score })
    else if (delta >= limiar) alta.push({ produtoId: o.produtoId, de, para: o.score })
  }
  return { novas, queda, alta }
}

/**
 * FILA DE AUTOMAÇÃO — o que esta rodada deliberadamente NÃO faz.
 *
 * O motor recomenda; ninguém publica sozinho. Ligar a publicação autônoma
 * exige o Revenue Autopilot, que tem portão próprio e não é desta rodada.
 */
export const MOTOR_NAO_PUBLICA = {
  chave: 'motor-de-oportunidades:publicacao-autonoma',
  estado: 'DELIBERADAMENTE_FORA_DE_ESCOPO',
  porque:
    'Recomendar e publicar são decisões diferentes. A fila prioriza; a publicação autônoma depende do Revenue Autopilot e do consentimento da dona.',
  desbloqueiaCom: 'REVENUE_AUTOPILOT',
} as const
