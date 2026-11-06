/**
 * P2.14.5.12 / .1 — Fase 1: o motor de oportunidades existente passa a servir a
 * curadoria (ASSISTED), sem segundo motor.
 *
 * Confere: dado desconhecido nunca vira número; aderência ao perfil da loja
 * só com dado real; compliance que elimina e risco que só alerta; seleção por
 * modo (pausado/MANUAL/ASSISTED/AUTOMATIC); explicação de cada candidato; e
 * as guardas de arquitetura (um único lugar para pesos e para `notaPotencial`).
 *
 * Sem banco, sem rede, sem IA paga. Custo R$ 0,00.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { notaPotencial, calcularFeasibility, AVALIACOES_MINIMAS_PARA_NOTA } from '../lib/automation-feasibility'
import { calcularOpportunityScoreComposto, PARTICIPACAO_DA_ADERENCIA } from '../lib/opportunity-score-composite'
import type { AffiliateOpportunity } from '../lib/affiliate-discovery'
import { buscarProvider, registrarProvider } from '../lib/affiliate-providers'
import { PERFIL_DA_LOJA } from '../lib/config'
import {
  avaliarAderenciaAoPerfil,
  avaliarComplianceDoProduto,
  calcularDesempenhoHistorico,
  classificarConfianca,
  pontuarProduto,
  selecionarParaModo,
  ordenarFila,
  criterioDeDesempate,
  FAIXA_DE_DESEMPATE,
  TETO_DO_PERFIL,
  PESOS_DO_PERFIL,
  TEXTO_DO_EMPATE_TECNICO,
  ORIGENS_SINTETICAS,
  ORIGEM_COMPRADO_PELA_TITULAR,
  type OportunidadePontuada,
  type ProdutoDoCatalogo,
} from '../lib/motor-de-oportunidades'

const RAIZ = join(__dirname, '..')
const AGORA = new Date('2026-10-08T12:00:00Z')

function oportunidade(extra: Partial<AffiliateOpportunity> = {}): AffiliateOpportunity {
  return {
    providerId: 'MANUAL',
    productName: 'Organizador de gavetas',
    category: 'Casa e Decoração',
    origin: 'MANUAL',
    source: 'catalogo-interno',
    lastVerifiedAt: AGORA.toISOString(),
    canGenerateLinkAutomatically: true,
    authorizedMediaAvailable: true,
    canGenerateContent: true,
    canAutoPublish: false,
    requiresUserConsent: true,
    rulesConfidence: 'MEDIUM',
    automationCost: 'FREE',
    ...extra,
  }
}

function produto(extra: Partial<ProdutoDoCatalogo> = {}): ProdutoDoCatalogo {
  return {
    id: 'p1',
    nome: 'Organizador de gavetas',
    categoria: 'Casa e Decoração',
    preco: 89.9,
    linkProduto: 'https://exemplo.com/produto',
    imagens: ['https://supabase.exemplo/img.jpg'],
    origemConteudo: 'Próprio',
    origemDados: 'MANUAL',
    providerId: null,
    status: 'ativo',
    removidoDaOrigemEm: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    comissaoPercentual: null,
    ...extra,
  }
}

const semHistorico = () =>
  calcularDesempenhoHistorico({ taxaConversao: null, receitaPorClique: null, cliques: 0, vendasElegiveis: 0, publicacoesRecentes: 0 })
const CONTEXTO = { canaisCapazes: ['instagram'], agora: AGORA }

function pontuada(extra: Partial<ProdutoDoCatalogo> = {}): OportunidadePontuada {
  return { ...pontuarProduto(produto(extra), semHistorico(), CONTEXTO), workspaceId: 'ws' }
}

/** Fixa score e base iguais (cenário de seleção sem aderência no meio). */
function comScore(o: OportunidadePontuada, score: number): OportunidadePontuada {
  return { ...o, score, componentes: { ...o.componentes, base: score } }
}

/** P2.17.2: estes testes cuidam de perfil/afinidade; a campanha sazonal tem testes próprios (rodada75). */
const semCampanha = (o: OportunidadePontuada): OportunidadePontuada => ({ ...o, campanha: null })

/** Fixa a base de evidência e recalcula o score pela fórmula real. */
function comBase(o: OportunidadePontuada, base: number): OportunidadePontuada {
  const a = o.componentes.aderenciaAoPerfil
  const score = Math.round(a == null ? base : (1 - PARTICIPACAO_DA_ADERENCIA) * base + PARTICIPACAO_DA_ADERENCIA * a)
  return { ...o, score, componentes: { ...o.componentes, base, final: score } }
}

describe('Desconhecido nunca vira número (notaPotencial e score composto)', () => {
  test('sem nenhum sinal de mercado, a nota é null — não 0', () => {
    const r = notaPotencial(oportunidade())
    assert.equal(r.nota, null)
    assert.ok(r.motivos.some((m) => /Sales Rank/.test(m)))
  })

  test('o score composto não conta o bloco de mercado desconhecido', () => {
    const c = calcularOpportunityScoreComposto(oportunidade())
    assert.equal(c.externalMarketSignals, null)
    // Só a automatizabilidade tinha dado: a nota final é ela, sem zero puxando para baixo.
    assert.equal(c.final, c.automationFeasibility)
    assert.ok(c.cobertura > 0 && c.cobertura < 1)
  })

  test('com comissão real, o bloco de mercado volta a contar', () => {
    const c = calcularOpportunityScoreComposto(oportunidade({ commissionPercent: 10 }))
    assert.equal(c.externalMarketSignals, 30)
  })

  test('avaliações só entram com volume mínimo', () => {
    assert.equal(notaPotencial(oportunidade({ avaliacao: 5, numeroDeAvaliacoes: 2 })).nota, null)
    assert.equal(notaPotencial(oportunidade({ avaliacao: 4, numeroDeAvaliacoes: AVALIACOES_MINIMAS_PARA_NOTA })).nota, 80)
  })

  test('aderência desconhecida: a nota é só a evidência (nunca 0,87 × base)', () => {
    const sem = calcularOpportunityScoreComposto(oportunidade())
    assert.equal(sem.aderenciaAoPerfil, null)
    assert.equal(sem.final, sem.base)
  })

  test('aderência tem participação FIXA de 13%, mesmo sem dado de mercado', () => {
    assert.equal(PARTICIPACAO_DA_ADERENCIA, 0.13)
    const zero = calcularOpportunityScoreComposto(oportunidade({ aderenciaAoPerfil: 0 }))
    const cem = calcularOpportunityScoreComposto(oportunidade({ aderenciaAoPerfil: 100 }))
    assert.equal(zero.externalMarketSignals, null, 'cenário sem mercado: antes a aderência chegava a ~32%')
    assert.equal(zero.base, cem.base)
    // 0 → 100 de aderência move a nota em 13 pontos (±1 de arredondamento), não em 32.
    assert.ok(Math.abs(cem.final - zero.final - 13) <= 1, `${zero.final} → ${cem.final}`)
  })

  test('aderência fica fora da cobertura/confiança', () => {
    const sem = calcularOpportunityScoreComposto(oportunidade())
    const com = calcularOpportunityScoreComposto(oportunidade({ aderenciaAoPerfil: 100 }))
    assert.equal(com.cobertura, sem.cobertura)
  })

  test('afinidade vale no máximo 2,6 pontos do score final', () => {
    const teto = PERFIL_DA_LOJA.afinidadeDaTitular.teto
    assert.equal(teto, 20)
    assert.ok(Math.abs(teto * PARTICIPACAO_DA_ADERENCIA - 2.6) < 1e-9)
    const sem = calcularOpportunityScoreComposto(oportunidade({ aderenciaAoPerfil: 80 }))
    const com = calcularOpportunityScoreComposto(oportunidade({ aderenciaAoPerfil: 100 }))
    assert.ok(com.final - sem.final <= 3)
  })

  test('calcularFeasibility (autopilot antigo) também não trata desconhecido como 0', () => {
    const f = calcularFeasibility(oportunidade())
    assert.equal(f.potencial, null)
    assert.equal(f.final, f.automatizabilidade)
  })

  test('confiança só cai com pouca cobertura de dado real, nunca sobe', () => {
    const base = { temHistoricoReal: true, dadosAusentes: [], origem: 'OFFICIAL_API' as const }
    assert.equal(classificarConfianca(base), 'ALTA')
    assert.equal(classificarConfianca({ ...base, cobertura: 0.6 }), 'MEDIA')
    assert.equal(classificarConfianca({ ...base, cobertura: 0.4 }), 'BAIXA')
    assert.equal(classificarConfianca({ ...base, temHistoricoReal: false, cobertura: 1 }), 'SEM_HISTORICO_REAL')
  })
})

describe('Aderência ao perfil da BoraComprar (configuração, sem migration)', () => {
  test('perfil declarado pela titular', () => {
    assert.deepEqual(PERFIL_DA_LOJA.faixaDePreco, { minimo: 30, maximo: 300, premiumAte: 600 })
    assert.ok(PERFIL_DA_LOJA.categoriasDoCadastro.includes('Casa e Decoração'))
    assert.ok(PERFIL_DA_LOJA.categoriasDoCadastro.includes('Beleza'))
    const marcas = PERFIL_DA_LOJA.afinidadeDaTitular.marcasPreferidas.map((m) => m.nome)
    assert.deepEqual(marcas, ['O Boticário', 'Renner', 'Adidas', 'Usaflex', 'MAC', 'Kérastase', 'Wella'])
    assert.deepEqual(PERFIL_DA_LOJA.afinidadeDaTitular.bonus, { marcaPreferida: 10, estilo: 5, comprado: 5, usado: 10 })
  })

  test('categoria prioritária e preço na faixa: 50/80 (subcategoria e conteúdo não comprovados)', () => {
    const a = avaliarAderenciaAoPerfil({ categoria: 'Casa e Decoração', preco: 89.9, origemDados: 'MANUAL' })
    assert.equal(a.perfil, PESOS_DO_PERFIL.categoria + PESOS_DO_PERFIL.preco)
    assert.equal(a.coberturaDoPerfil, 0.63) // (25 + 25) / 80
    assert.equal(a.afinidade, 0)
    assert.equal(a.nota, 50)
    assert.ok(a.desconhecidos.some((d) => /demonstrar/.test(d)))
    assert.ok(a.desconhecidos.some((d) => /presença da titular/.test(d)))
  })

  test('fora das prioridades pesa contra; preço é referência, não trava', () => {
    const a = avaliarAderenciaAoPerfil({ categoria: 'Esportes', preco: 900, origemDados: 'MANUAL' })
    assert.equal(a.perfil, 5) // categoria 0/25 + preço acima do premium 5/25
    assert.equal(a.negativos.length, 2)
    const premium = avaliarAderenciaAoPerfil({ categoria: 'Beleza', preco: 450, origemDados: 'MANUAL' })
    assert.equal(premium.perfil, 37) // categoria 25 + preço neutro 12
  })

  test('subcategoria revela prioridade mesmo em "Outros"', () => {
    const a = avaliarAderenciaAoPerfil({ categoria: 'Outros', preco: null, origemDados: 'MANUAL', nome: 'Perfume floral 100 ml' })
    assert.equal(a.perfil, PESOS_DO_PERFIL.subcategoria)
    assert.equal(a.coberturaDoPerfil, 0.25)
    assert.ok(a.positivos.some((p) => /perfumes/.test(p)))
  })

  test('"Outros" sem subcategoria e preço ausente não viram nota: ficam desconhecidos', () => {
    const a = avaliarAderenciaAoPerfil({ categoria: 'Outros', preco: null, origemDados: 'MANUAL', nome: 'Item genérico' })
    assert.equal(a.nota, null)
    assert.equal(a.perfil, null)
  })
})

describe('Perfil por pesos com cobertura (P2.14.5.13.5)', () => {
  test('pesos do perfil somam o teto de 80; afinidade e 13% inalterados', () => {
    assert.deepEqual(PESOS_DO_PERFIL, { categoria: 25, subcategoria: 20, preco: 25, conteudo: 10 })
    assert.equal(Object.values(PESOS_DO_PERFIL).reduce((s, n) => s + n, 0), TETO_DO_PERFIL)
    assert.equal(PERFIL_DA_LOJA.afinidadeDaTitular.teto, 20)
  })

  test('só o preço comprovado NÃO vale 80/80', () => {
    const soPreco = avaliarAderenciaAoPerfil({ categoria: 'Outros', preco: 299.9, origemDados: 'MANUAL', nome: 'Robô Aspirador H40' })
    assert.equal(soPreco.perfil, 25)
    assert.equal(soPreco.coberturaDoPerfil, 0.31)
    assert.ok(soPreco.desconhecidos.some((d) => /categoria/.test(d)), 'desconhecido, não negativo')
    assert.equal(soPreco.negativos.length, 0)
  })

  test('categoria + subcategoria + preço comprovados valem mais que só preço', () => {
    const completo = avaliarAderenciaAoPerfil({ categoria: 'Brinquedos', preco: 89.9, origemDados: 'MANUAL', nome: 'Trem infantil com luz' })
    const soPreco = avaliarAderenciaAoPerfil({ categoria: 'Outros', preco: 89.9, origemDados: 'MANUAL', nome: 'Item genérico' })
    assert.equal(completo.perfil, 70)
    assert.equal(completo.coberturaDoPerfil, 0.88)
    assert.ok(completo.perfil! > soPreco.perfil!)
  })

  test('só preço não libera o bônus de afinidade (perfil < 40)', () => {
    const a = avaliarAderenciaAoPerfil({ categoria: 'Outros', preco: 299.9, origemDados: 'USER_PROVIDED', nome: 'Robô Aspirador H40' })
    assert.equal(a.afinidadeDetectada, 5)
    assert.equal(a.afinidade, 0)
  })
})

describe('Sinais só no nome do produto (P2.14.5.13.5)', () => {
  test('"guarda-chuva para levar na bolsa" (descrição) não recebe bônus nem subcategoria por bolsa', () => {
    const a = avaliarAderenciaAoPerfil({
      categoria: 'Outros', preco: 24.24, origemDados: 'MANUAL',
      nome: 'Mini Guarda-Chuva de Bolso', descricao: 'Compacto, guarda-chuva para levar na bolsa.',
    })
    assert.equal(a.afinidadeDetectada, 0)
    assert.ok(!a.positivos.some((p) => /bolsas/.test(p)))
  })

  test('"Bolsa Renner" recebe marca, estilo e subcategoria', () => {
    const a = avaliarAderenciaAoPerfil({ categoria: 'Moda', preco: 199, origemDados: 'MANUAL', nome: 'Bolsa Renner' })
    assert.ok(a.sinaisDeAfinidade.some((s) => /Renner/.test(s)))
    assert.ok(a.sinaisDeAfinidade.some((s) => /estilo da titular \(bolsa\)/.test(s)))
    assert.ok(a.positivos.some((p) => /bolsas/.test(p)))
    assert.equal(a.afinidade, 15)
  })

  test('marca citada só na descrição não conta; #usei continua vindo de Observações', () => {
    const a = avaliarAderenciaAoPerfil({ categoria: 'Beleza', preco: 90, origemDados: 'MANUAL', nome: 'Shampoo hidratante', descricao: 'Mesma linha da Kérastase', observacoes: '#usei' })
    assert.ok(!a.sinaisDeAfinidade.some((s) => /Kérastase/.test(s)))
    assert.equal(a.usadoPelaTitular, true)
  })
})

describe('Afinidade da titular (bônus dentro da aderência, teto 20)', () => {
  const kerastase = { categoria: 'Beleza', preco: 189, nome: 'Máscara capilar Kérastase Nutritive' }

  test('marca preferida +10', () => {
    const a = avaliarAderenciaAoPerfil({ ...kerastase, origemDados: 'MANUAL' })
    assert.equal(a.perfil, 70) // categoria 25 + subcategoria 20 + preço 25
    assert.equal(a.afinidade, 10)
    assert.equal(a.nota, 80)
    assert.ok(a.sinaisDeAfinidade.some((s) => /Kérastase/.test(s)))
  })

  test('comprado +5 OU usado +10 — nunca os dois', () => {
    const comprado = avaliarAderenciaAoPerfil({ ...kerastase, origemDados: 'USER_PROVIDED' })
    assert.equal(comprado.afinidade, 15)
    const usadoEComprado = avaliarAderenciaAoPerfil({ ...kerastase, origemDados: 'USER_PROVIDED', observacoes: 'Uso toda semana #usei' })
    assert.equal(usadoEComprado.afinidade, 20) // 10 marca + 10 usado; o +5 de comprado não soma
    assert.ok(!usadoEComprado.sinaisDeAfinidade.some((s) => /comprado/.test(s)))
    assert.equal(usadoEComprado.usadoPelaTitular, true)
    const semMarca = avaliarAderenciaAoPerfil({ categoria: 'Casa e Decoração', preco: 50, nome: 'Organizador', origemDados: 'USER_PROVIDED', observacoes: '#USEI' })
    assert.equal(semMarca.afinidade, 10)
  })

  test('teto de 20 pontos', () => {
    const a = avaliarAderenciaAoPerfil({
      categoria: 'Moda', preco: 280, origemDados: 'MANUAL', nome: 'Scarpin Usaflex salto alto', observacoes: '#usei',
    })
    assert.equal(a.afinidadeDetectada, 20) // 10 + 5 + 10 = 25 → 20
    assert.equal(a.perfil, 70)
    assert.equal(a.nota, 90)
  })

  test('perfil desconhecido: comprado/usado NÃO cria nota; vai para explicação e desempate', () => {
    const a = avaliarAderenciaAoPerfil({ categoria: 'Outros', preco: null, origemDados: 'USER_PROVIDED', nome: 'Item genérico', observacoes: '#usei' })
    assert.equal(a.nota, null)
    assert.equal(a.afinidade, 0)
    assert.equal(a.afinidadeDetectada, 10)
    assert.ok(a.positivos.some((p) => /só no desempate/.test(p)))
  })

  test('perfil fraco: marca preferida não ganha bônus', () => {
    const a = avaliarAderenciaAoPerfil({ categoria: 'Esportes', preco: 900, origemDados: 'MANUAL', nome: 'Bola de futebol Adidas' })
    assert.equal(a.perfil, 5)
    assert.equal(a.afinidade, 0)
    assert.equal(a.afinidadeDetectada, 10)
  })

  test('marca famosa fora da lista não conta; ausência de marca não penaliza', () => {
    const famosa = avaliarAderenciaAoPerfil({ categoria: 'Beleza', preco: 250, origemDados: 'MANUAL', nome: 'Perfume Dior' })
    const comum = avaliarAderenciaAoPerfil({ categoria: 'Beleza', preco: 250, origemDados: 'MANUAL', nome: 'Perfume floral' })
    assert.equal(famosa.afinidade, 0)
    assert.equal(famosa.nota, comum.nota)
  })

  test('"MAC" só em maiúsculas e fora de Eletrônicos', () => {
    const batom = avaliarAderenciaAoPerfil({ categoria: 'Beleza', preco: 150, origemDados: 'MANUAL', nome: 'Batom MAC Ruby Woo' })
    const capa = avaliarAderenciaAoPerfil({ categoria: 'Eletrônicos', preco: 150, origemDados: 'MANUAL', nome: 'Capa para MAC e MacBook' })
    const minusculo = avaliarAderenciaAoPerfil({ categoria: 'Casa e Decoração', preco: 50, origemDados: 'MANUAL', nome: 'Forma para mac and cheese' })
    assert.equal(batom.afinidade, 10)
    assert.equal(capa.afinidade, 0)
    assert.equal(minusculo.afinidade, 0)
  })

  test('Wella e O Boticário, com ou sem acento', () => {
    assert.equal(avaliarAderenciaAoPerfil({ categoria: 'Beleza', preco: 90, origemDados: 'MANUAL', nome: 'Shampoo WELLA Professionals' }).afinidade, 10)
    assert.equal(avaliarAderenciaAoPerfil({ categoria: 'Beleza', preco: 90, origemDados: 'MANUAL', nome: 'Hidratante Boticario' }).afinidade, 10)
  })

  test('comprado pela titular continua sinalizado (USER_PROVIDED)', () => {
    assert.equal(ORIGEM_COMPRADO_PELA_TITULAR, 'USER_PROVIDED')
  })
})

describe('Compliance do produto (decisões da titular de 08/10/2026)', () => {
  const base = {
    disponivel: true,
    providerId: null,
    categoria: 'Casa e Decoração',
    textos: ['Organizador de gavetas'],
    temLink: true,
    midiaAutorizada: true,
    motivoDaMidia: '',
    preco: null,
    verificadoEm: null,
    agora: AGORA,
  }

  test('indisponível ou removido elimina', () => {
    const r = avaliarComplianceDoProduto({ ...base, disponivel: false })
    assert.equal(r.bloqueante, true)
  })

  test('programa que não permite cadastro elimina', () => {
    const modelo = buscarProvider('hotmart')!
    registrarProvider({ ...modelo, id: 'teste-p214512-sem-cadastro', nome: 'Programa de teste', cadastroDisponivel: false })
    const r = avaliarComplianceDoProduto({ ...base, providerId: 'teste-p214512-sem-cadastro' })
    assert.equal(r.bloqueante, true)
    assert.match(r.motivoDoBloqueio ?? '', /não permite cadastro/)
  })

  test('mídia sem direito NÃO elimina, mas impede a publicação', () => {
    const r = avaliarComplianceDoProduto({ ...base, midiaAutorizada: false, motivoDaMidia: 'Sem direito.' })
    assert.equal(r.bloqueante, false)
    assert.equal(r.publicacaoImpedida, true)
    assert.equal(r.nivel, 'MEDIO')
  })

  test('preço não verificado e sem link são alertas', () => {
    const r = avaliarComplianceDoProduto({ ...base, preco: 50, temLink: false })
    assert.equal(r.bloqueante, false)
    assert.ok(r.riscos.some((x) => /Preço informado/.test(x)))
    assert.ok(r.riscos.some((x) => /Sem link/.test(x)))
  })

  test('"Beleza" sozinha não é sensível', () => {
    const r = avaliarComplianceDoProduto({ ...base, categoria: 'Beleza', textos: ['Escova de cabelo'] })
    assert.equal(r.nivel, 'BAIXO')
  })

  test('saúde, suplemento e promessa de resultado: risco ALTO, sem eliminar', () => {
    assert.equal(avaliarComplianceDoProduto({ ...base, categoria: 'Saúde' }).nivel, 'ALTO')
    assert.equal(avaliarComplianceDoProduto({ ...base, textos: ['Suplemento que ajuda a emagrecer'] }).nivel, 'ALTO')
    assert.equal(avaliarComplianceDoProduto({ ...base, textos: ['Resultado garantido em 7 dias'] }).nivel, 'ALTO')
    assert.equal(avaliarComplianceDoProduto({ ...base, textos: ['Creme que cura manchas'] }).bloqueante, false)
  })

  test('cuidados capilares não são risco alto; antiqueda é médio', () => {
    const capilar = avaliarComplianceDoProduto({
      ...base,
      categoria: 'Beleza',
      textos: ['Máscara de tratamento capilar com hidratação, nutrição e reconstrução', 'Protetor térmico; tratamento para cabelos'],
    })
    assert.equal(capilar.nivel, 'BAIXO')
    const antiqueda = avaliarComplianceDoProduto({ ...base, categoria: 'Beleza', textos: ['Shampoo antiqueda'] })
    assert.equal(antiqueda.nivel, 'MEDIO')
    assert.equal(antiqueda.bloqueante, false)
  })

  test('cura, remédio, doença, alegação médica e promessa garantida: risco ALTO', () => {
    for (const t of ['Tônico que cura a calvície', 'Remédio natural', 'Tratamento para acne', 'Indicado para doenças do couro cabeludo', 'Clinicamente comprovado', 'Recomendação médica', 'Resultado garantido']) {
      assert.equal(avaliarComplianceDoProduto({ ...base, categoria: 'Beleza', textos: [t] }).nivel, 'ALTO', t)
    }
  })

  test('categoria sem acento ou em maiúsculas: "Saude" = "Saúde" (risco ALTO)', () => {
    for (const categoria of ['Saúde', 'Saude', 'SAUDE', 'saúde', ' Saude ']) {
      const r = avaliarComplianceDoProduto({ ...base, categoria })
      assert.equal(r.nivel, 'ALTO', categoria)
      assert.ok(r.riscos.some((x) => x.includes(`"${categoria}"`)), 'o texto cita a categoria original, sem alterar')
    }
    assert.equal(avaliarComplianceDoProduto({ ...base, categoria: 'Beleza' }).nivel, 'BAIXO')
  })

  test('palavra inteira: "procurar" não dispara "cura"', () => {
    assert.equal(avaliarComplianceDoProduto({ ...base, textos: ['Fácil de procurar na gaveta'] }).nivel, 'BAIXO')
  })
})

describe('Explicação de cada candidato (pontuarProduto)', () => {
  test('catálogo interno: mercado desconhecido, explicado — sem zero', () => {
    const o = pontuada()
    assert.equal(o.componentes.externalMarketSignals, null)
    assert.ok(o.desconhecidos!.some((d) => /vendas/.test(d)))
    assert.ok(o.desconhecidos!.some((d) => /avaliações/.test(d)))
    assert.ok(o.desconhecidos!.some((d) => /estoque/.test(d)))
    assert.ok(o.porqueDestaPosicao.some((p) => /Sinais de mercado: desconhecidos/.test(p)))
    assert.ok(o.porqueDestaPosicao.some((p) => /apoiada em dado real/.test(p)))
    assert.ok(o.motivosPositivos!.some((m) => /prioridade da loja/.test(m)))
  })

  test('explicação separa base, aderência e afinidade', () => {
    const o = pontuada({ categoria: 'Beleza', nome: 'Máscara capilar Kérastase', preco: 189, origemDados: 'USER_PROVIDED' })
    assert.equal(o.aderenciaDoPerfil, 70)
    assert.equal(o.afinidadeDaTitular, 15)
    assert.equal(o.componentes.aderenciaAoPerfil, 85)
    assert.ok(o.porqueDestaPosicao.some((p) => /Base de evidência/.test(p)))
    assert.ok(o.porqueDestaPosicao.some((p) => /perfil 70\/80 \+ afinidade da titular 15\/20 — vale 13% da nota/.test(p)))
    assert.ok(o.porqueDestaPosicao.some((p) => /^Perfil: 70\/80 · cobertura 88%/.test(p)))
    assert.ok(o.porqueDestaPosicao.some((p) => /não prova de demanda/.test(p)))
  })

  test('comprado pela titular aparece marcado', () => {
    assert.equal(pontuada({ origemDados: 'USER_PROVIDED' }).compradoPelaTitular, true)
    assert.equal(pontuada().compradoPelaTitular, false)
  })

  test('compliance bloqueante torna o produto NAO_ELEGIVEL', () => {
    const o = pontuada({ status: 'inativo' })
    assert.equal(o.complianceBloqueante, true)
    assert.equal(o.classificacao, 'NAO_ELEGIVEL')
  })

  test('dado sintético segue fora por construção', () => {
    assert.ok(ORIGENS_SINTETICAS.includes('TEST_FIXTURE'))
    assert.ok(!(ORIGENS_SINTETICAS as readonly string[]).includes('REAL_OPERATION'))
    const fonte = readFileSync(join(RAIZ, 'lib/motor-de-oportunidades.ts'), 'utf8')
    assert.match(fonte, /origemDados: \{ notIn: \[\.\.\.ORIGENS_SINTETICAS\] \}/)
  })
})

describe('Seleção por modo (selecionarParaModo)', () => {
  const fila: OportunidadePontuada[] = [
    comScore(pontuada({ id: 'a', nome: 'A', categoria: 'Casa e Decoração' }), 80),
    comScore(pontuada({ id: 'b', nome: 'B', categoria: 'Papelaria' }), 70),
    comScore(pontuada({ id: 'c', nome: 'C', categoria: 'Saúde' }), 65),
    comScore(pontuada({ id: 'd', nome: 'D', categoria: 'Moda' }), 60),
    comScore(pontuada({ id: 'e', nome: 'E', status: 'inativo' }), 99),
  ]

  test('pausado: nada', () => {
    const s = selecionarParaModo(fila, { automationMode: 'ASSISTED', automationPaused: true })
    assert.equal(s.candidatos.length, 0)
    assert.equal(s.pausado, true)
  })

  test('MANUAL (e modo desconhecido): nada', () => {
    assert.equal(selecionarParaModo(fila, { automationMode: 'MANUAL', automationPaused: false }).candidatos.length, 0)
    assert.equal(selecionarParaModo(fila, { automationMode: 'DRY_RUN', automationPaused: false }).modo, 'MANUAL')
  })

  test('ASSISTED: os 3 melhores elegíveis, com a posição explicada', () => {
    const s = selecionarParaModo(fila, { automationMode: 'ASSISTED', automationPaused: false })
    assert.deepEqual(s.candidatos.map((c) => c.produtoId), ['a', 'b', 'c'])
    assert.ok(s.descartados.some((d) => d.produtoId === 'e'))
    assert.match(s.candidatos[0].motivoDaPosicao, /1º de 4 elegível/)
    assert.match(s.candidatos[1].motivoDaPosicao, /10 ponto\(s\) abaixo do 1º/)
    assert.match(s.explicacao, /Nada é gerado nem publicado antes da escolha/)
  })

  test('AUTOMATIC: no máximo 1, sem risco ALTO', () => {
    const s = selecionarParaModo(
      [comScore(fila[2], 95), ...fila.filter((o) => o.produtoId !== 'c')],
      { automationMode: 'AUTOMATIC', automationPaused: false }
    )
    assert.equal(s.candidatos.length, 1)
    assert.equal(s.candidatos[0].produtoId, 'a')
    assert.ok(s.descartados.some((d) => d.produtoId === 'c' && /Risco de compliance alto/.test(d.motivo)))
    assert.match(s.explicacao, /nenhuma publicação real/)
  })
})

describe('Desempate por faixa de evidência (regra 14 da titular)', () => {
  // A e B na mesma faixa (70–74); C numa faixa acima.
  const A = semCampanha(comBase(pontuada({ id: 'A', nome: 'Organizador', categoria: 'Casa e Decoração', preco: 450 }), 74))
  const B = semCampanha(comBase(pontuada({ id: 'B', nome: 'Caderno', categoria: 'Papelaria', preco: 50 }), 70))
  const C = semCampanha(comBase(pontuada({ id: 'C', nome: 'Bolsa Renner', categoria: 'Moda', preco: 200, observacoes: '#usei' }), 75))

  test('na mesma faixa, maior aderência ao perfil vem antes, mesmo com score um pouco menor', () => {
    assert.equal(FAIXA_DE_DESEMPATE, 5)
    assert.ok(A.score > B.score, `${A.score} > ${B.score}`)
    const ordem = ordenarFila([A, B]).map((o) => o.produtoId)
    assert.deepEqual(ordem, ['B', 'A'])
    const s = selecionarParaModo([B, A], { automationMode: 'ASSISTED', automationPaused: false })
    assert.match(s.candidatos[0].motivoDaPosicao, /ficou à frente por maior aderência ao perfil BoraComprar/)
    assert.match(s.candidatos[1].motivoDaPosicao, /Mesma faixa de evidência que o 1º \(70–74\)/)
  })

  test('faixa de evidência superior vence afinidade: marca não supera desempenho', () => {
    const semAfinidade = semCampanha(comBase(pontuada({ id: 'D', nome: 'Organizador', categoria: 'Casa e Decoração', preco: 50 }), 80))
    const comAfinidade = semCampanha(comBase(pontuada({ id: 'E', nome: 'Bolsa Renner', categoria: 'Moda', preco: 200, observacoes: '#usei' }), 76))
    assert.ok((comAfinidade.afinidadeDaTitular ?? 0) > 0)
    assert.deepEqual(ordenarFila([comAfinidade, semAfinidade]).map((o) => o.produtoId), ['D', 'E'])
    assert.equal(ordenarFila([C, A, B])[0].produtoId, 'C')
  })

  test('perfil igual: afinidade desempata; perfil desconhecido vem depois de conhecido', () => {
    const semUso = semCampanha(comBase(pontuada({ id: 'F', nome: 'Organizador', categoria: 'Casa e Decoração', preco: 50 }), 72))
    const usado = semCampanha(comBase(pontuada({ id: 'G', nome: 'Organizador', categoria: 'Casa e Decoração', preco: 50, observacoes: '#usei' }), 71))
    assert.deepEqual(ordenarFila([semUso, usado]).map((o) => o.produtoId), ['G', 'F'])
    const desconhecido = semCampanha(comBase(pontuada({ id: 'H', nome: 'Item genérico', categoria: 'Outros', preco: null, origemDados: 'USER_PROVIDED' }), 73))
    assert.equal(desconhecido.aderenciaDoPerfil, null)
    assert.deepEqual(ordenarFila([desconhecido, semUso]).map((o) => o.produtoId), ['F', 'H'])
    assert.equal(criterioDeDesempate(semUso, desconhecido).criterio, 'perfil')
  })
})

describe('Empate técnico e desconhecidos únicos (P2.14.5.13.5)', () => {
  test('empate total: ordem só técnica (nome), dita com clareza, sem "0 pontos acima"', () => {
    const zeta = comScore(pontuada({ id: 'z', nome: 'Zeta organizador', categoria: 'Casa e Decoração' }), 50)
    const alfa = comScore(pontuada({ id: 'a2', nome: 'Alfa organizador', categoria: 'Casa e Decoração' }), 50)
    assert.equal(criterioDeDesempate(alfa, zeta).criterio, 'tecnico')
    assert.deepEqual(ordenarFila([zeta, alfa]).map((o) => o.produtoId), ['a2', 'z'])
    const s = selecionarParaModo(ordenarFila([zeta, alfa]), { automationMode: 'ASSISTED', automationPaused: false })
    for (const c of s.candidatos) {
      assert.ok(c.motivoDaPosicao.includes(TEXTO_DO_EMPATE_TECNICO), c.motivoDaPosicao)
      assert.ok(!/0 ponto\(s\)/.test(c.motivoDaPosicao), c.motivoDaPosicao)
    }
    assert.equal(TEXTO_DO_EMPATE_TECNICO, 'Empate técnico: não há evidência suficiente para diferenciar estes produtos.')
  })

  test('cobertura desempata só depois de confiança, sem mudar score; antes de nome/ID', () => {
    // Mesma base, perfil 50, afinidade 0, mesmo score: o de cobertura maior vem antes,
    // mesmo com nome alfabeticamente posterior.
    const menosDados = comScore(pontuada({ id: 'm', nome: 'Aaa', categoria: 'Casa e Decoração', preco: 89.9 }), 50)
    const maisDados = comScore(pontuada({ id: 'n', nome: 'Zzz organizador', categoria: 'Casa e Decoração', preco: 89.9 }), 50)
    const igualado = { ...maisDados, aderenciaDoPerfil: menosDados.aderenciaDoPerfil, afinidadeParaDesempate: 0 }
    assert.ok((igualado.coberturaDoPerfil ?? 0) > (menosDados.coberturaDoPerfil ?? 0))
    assert.equal(criterioDeDesempate(igualado, menosDados).criterio, 'cobertura')
    assert.deepEqual(ordenarFila([menosDados, igualado]).map((o) => o.produtoId), ['n', 'm'])
    assert.equal(igualado.score, menosDados.score, 'cobertura não mexe no score')
    const s = selecionarParaModo([igualado, menosDados], { automationMode: 'ASSISTED', automationPaused: false })
    assert.ok(!s.candidatos[0].motivoDaPosicao.includes(TEXTO_DO_EMPATE_TECNICO), 'cobertura diferente não é empate técnico')
    assert.match(s.candidatos[0].motivoDaPosicao, /sustentado por mais dados conhecidos/)
  })

  test('"imagem do produto" aparece uma vez só', () => {
    const o = pontuada({ imagens: [] })
    assert.equal(o.desconhecidos!.filter((d) => /image(m|ns) do produto/.test(d)).length, 1)
    assert.ok(o.desconhecidos!.includes('imagem do produto'))
    assert.equal(new Set(o.desconhecidos).size, o.desconhecidos!.length)
  })
})

describe('Guardas de arquitetura: um único motor', () => {
  const arquivosLib = readdirSync(join(RAIZ, 'lib')).filter((f) => f.endsWith('.ts'))

  test('a aderência não volta para os pesos de evidência', () => {
    const fonte = readFileSync(join(RAIZ, 'lib/opportunity-score-composite.ts'), 'utf8')
    const pesos = fonte.slice(fonte.indexOf('const PESOS = {'), fonte.indexOf('const PESO_NOMINAL_TOTAL'))
    assert.ok(!/aderencia/i.test(pesos), 'aderência dentro de PESOS = dupla contagem')
  })

  test('pesos do score só em opportunity-score-composite.ts', () => {
    for (const f of arquivosLib) {
      if (f === 'opportunity-score-composite.ts') continue
      const fonte = readFileSync(join(RAIZ, 'lib', f), 'utf8')
      assert.ok(!/externalMarketSignals:\s*0\.\d/.test(fonte), `${f} declara peso de score`)
    }
  })

  test('notaPotencial só é chamada pelo composto e pela feasibility', () => {
    const permitidos = new Set(['automation-feasibility.ts', 'opportunity-score-composite.ts'])
    for (const f of arquivosLib) {
      if (permitidos.has(f)) continue
      const fonte = readFileSync(join(RAIZ, 'lib', f), 'utf8')
      assert.ok(!/notaPotencial\(/.test(fonte), `${f} chama notaPotencial`)
    }
  })

  test('o motor continua usando o score composto existente e o ciclo usa a seleção do motor', () => {
    const motor = readFileSync(join(RAIZ, 'lib/motor-de-oportunidades.ts'), 'utf8')
    assert.match(motor, /calcularOpportunityScoreComposto\(oportunidade/)
    const ciclo = readFileSync(join(RAIZ, 'lib/ciclo-de-oportunidades.ts'), 'utf8')
    assert.match(ciclo, /selecionarParaModo\(fila/)
    assert.match(ciclo, /automatico \? fila\.filter/)
  })
})
