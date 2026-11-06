/**
 * P2.14.5.13 — Fase 2: candidatos e tela de curadoria (regras puras).
 *
 * Validade por fonte, retrato do motor sem inventar dado, produto criado só
 * com dado real, impedimentos de escolha, "Informar produto", perfil do
 * banco ≡ perfil padrão, e guardas: nada de IA paga, publicação, tarefa ou
 * mudança de modo; migration só aditiva.
 *
 * Sem banco, sem rede. Custo R$ 0,00.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { CandidatoDeProduto } from '@prisma/client'
import {
  calcularValidade,
  dadosDoProdutoACriar,
  impedimentoParaEscolha,
  informadoComoProduto,
  origemDoInformado,
  podeVoltarAConcorrer,
  QUARENTENA_DO_DESCARTE_DIAS,
  retratoDoCandidato,
  tipoDeFonteDoCatalogo,
  VALIDADE_POR_TIPO,
  type DadosReaisDoItem,
} from '../lib/curadoria'
import { candidatoParaTela } from '../lib/curadoria-http'
import { estadoDaCuradoria, textoDoResumo, type UltimaColetaNaTela } from '../lib/curadoria-estado'
import { linhaDoPerfilPadrao, perfilDaLinha, perfilPadrao } from '../lib/perfil-da-loja'
import {
  avaliarAderenciaAoPerfil,
  calcularDesempenhoHistorico,
  pontuarProduto,
  type ProdutoDoCatalogo,
} from '../lib/motor-de-oportunidades'

const RAIZ = join(__dirname, '..')
const AGORA = new Date('2026-10-08T15:00:00Z')
const HORA = 3600 * 1000
const semHistorico = () =>
  calcularDesempenhoHistorico({ taxaConversao: null, receitaPorClique: null, cliques: 0, vendasElegiveis: 0, publicacoesRecentes: 0 })

function produto(extra: Partial<ProdutoDoCatalogo> = {}): ProdutoDoCatalogo {
  return {
    id: 'p1',
    nome: 'Organizador de gavetas',
    categoria: 'Casa e Decoração',
    preco: 89.9,
    linkProduto: 'https://exemplo.com/p',
    imagens: [],
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
const pontuada = (extra: Partial<ProdutoDoCatalogo> = {}) =>
  ({ ...pontuarProduto(produto(extra), semHistorico(), { canaisCapazes: [], agora: AGORA }), workspaceId: 'ws' })

const ITEM_VAZIO: DadosReaisDoItem = {
  nome: 'Item',
  linkProduto: 'https://exemplo.com/p',
  imagem: null,
  categoria: null,
  preco: null,
  providerId: null,
  externalId: null,
  comissaoPercentual: null,
  vendas: null,
  velocidadeDeVendas: null,
  avaliacao: null,
  numeroDeAvaliacoes: null,
  estoque: null,
}

function candidato(extra: Partial<CandidatoDeProduto> = {}): CandidatoDeProduto {
  return {
    id: 'c1', workspaceId: 'ws', chaveDeOrigem: 'titular:c1', fonte: 'USER_PROVIDED', providerId: null, externalId: null,
    produtoId: null, nome: 'Bolsa', linkProduto: 'https://exemplo.com/b', imagem: null, imagemAutorizada: false,
    categoria: null, preco: null, comissaoPercentual: null, comissaoValor: null, vendas: null, velocidadeDeVendas: null,
    avaliacao: null, numeroDeAvaliacoes: null, estoque: null, score: 60, baseDeEvidencia: 58, aderencia: null,
    aderenciaDoPerfil: null, afinidade: 0, confianca: 'SEM_HISTORICO_REAL', nivelDeRisco: 'MEDIO', complianceBloqueante: false,
    publicacaoImpedida: true, compradoPelaTitular: false, usadoPelaTitular: false, motivosPositivos: [], riscos: [],
    desconhecidos: [], porqueDestaPosicao: [], status: 'APRESENTADO', posicao: 1, coletadoEm: AGORA,
    validoAte: new Date(AGORA.getTime() + 7 * 24 * HORA), escolhidoEm: null, escolhidoPorUserId: null,
    createdAt: AGORA, updatedAt: AGORA,
    ...extra,
  }
}

describe('Validade por fonte (decisão da titular)', () => {
  test('externa 48h; catálogo e titular 7 dias', () => {
    assert.equal(VALIDADE_POR_TIPO.EXTERNA, 48 * HORA)
    assert.equal(calcularValidade({ tipo: 'CATALOGO', coletadoEm: AGORA }).getTime(), AGORA.getTime() + 7 * 24 * HORA)
    assert.equal(calcularValidade({ tipo: 'USER_PROVIDED', coletadoEm: AGORA }).getTime(), AGORA.getTime() + 7 * 24 * HORA)
    assert.equal(calcularValidade({ tipo: 'EXTERNA', coletadoEm: AGORA }).getTime(), AGORA.getTime() + 48 * HORA)
  })

  test('validade própria da fonte: vale a menor, nunca a maior', () => {
    const menor = new Date(AGORA.getTime() + 6 * HORA)
    const maior = new Date(AGORA.getTime() + 30 * 24 * HORA)
    assert.equal(calcularValidade({ tipo: 'EXTERNA', coletadoEm: AGORA, validadeDaFonte: menor }).getTime(), menor.getTime())
    assert.equal(calcularValidade({ tipo: 'CATALOGO', coletadoEm: AGORA, validadeDaFonte: maior }).getTime(), AGORA.getTime() + 7 * 24 * HORA)
  })

  test('tipo de fonte do catálogo pela origem do registro', () => {
    assert.equal(tipoDeFonteDoCatalogo({ origem: 'OFFICIAL_API' }, 'TIKTOK_SHOWCASE'), 'EXTERNA')
    assert.equal(tipoDeFonteDoCatalogo({ origem: 'MANUAL' }, 'USER_PROVIDED'), 'USER_PROVIDED')
    assert.equal(tipoDeFonteDoCatalogo({ origem: 'MANUAL' }, 'MANUAL'), 'CATALOGO')
  })
})

describe('Retrato do motor: nada é inventado', () => {
  const datas = { coletadoEm: AGORA, validoAte: new Date(AGORA.getTime() + HORA) }

  test('sinais de mercado ausentes ficam null', () => {
    const r = retratoDoCandidato(pontuada(), ITEM_VAZIO, datas)
    for (const campo of ['preco', 'comissaoPercentual', 'comissaoValor', 'vendas', 'velocidadeDeVendas', 'avaliacao', 'numeroDeAvaliacoes', 'estoque', 'imagem', 'categoria'] as const) {
      assert.equal(r[campo], null, campo)
    }
    assert.equal((r.desconhecidos as string[]).filter((d) => /image(m|ns) do produto/.test(d)).length, 1, 'sem duplicata')
    assert.ok((r.desconhecidos as string[]).includes('imagem do produto'))
    assert.ok((r.desconhecidos as string[]).some((d) => /categoria/.test(d)))
  })

  test('comissão em R$ só com preço E percentual reais', () => {
    assert.equal(retratoDoCandidato(pontuada(), { ...ITEM_VAZIO, preco: 100 }, datas).comissaoValor, null)
    assert.equal(retratoDoCandidato(pontuada(), { ...ITEM_VAZIO, preco: 100, comissaoPercentual: 12 }, datas).comissaoValor, 12)
  })

  test('score, base, aderência e afinidade vêm do motor, sem recálculo', () => {
    const o = pontuada({ categoria: 'Beleza', nome: 'Máscara capilar Kérastase', preco: 189, origemDados: 'USER_PROVIDED' })
    const r = retratoDoCandidato(o, ITEM_VAZIO, datas)
    assert.equal(r.score, o.score)
    assert.equal(r.baseDeEvidencia, o.componentes.base)
    assert.equal(r.aderencia, 85)
    assert.equal(r.aderenciaDoPerfil, 70)
    assert.equal(r.afinidade, 15)
    assert.equal(r.compradoPelaTitular, true)
  })

  test('imagem só é autorizada se existe e o motor não impediu a mídia', () => {
    const comDireito = pontuada({ imagens: ['https://ref-teste-exemplo.supabase.co/storage/v1/object/public/p.jpg'] })
    const semDireito = pontuada({ imagens: ['https://outra-loja.com/p.jpg'], origemConteudo: 'De fornecedor' })
    assert.equal(retratoDoCandidato(semDireito, { ...ITEM_VAZIO, imagem: 'https://outra-loja.com/p.jpg' }, datas).imagemAutorizada, false)
    assert.equal(
      retratoDoCandidato(comDireito, { ...ITEM_VAZIO, imagem: 'x' }, datas).imagemAutorizada,
      comDireito.publicacaoImpedida === false
    )
    assert.equal(retratoDoCandidato(comDireito, ITEM_VAZIO, datas).imagemAutorizada, false)
  })
})

describe('Produto criado na escolha: só dado real', () => {
  const quem = { workspaceId: 'ws', userId: 'u' }

  test('ausentes continuam ausentes; categoria vazia = Outros; imagem ausente é válida', () => {
    const d = dadosDoProdutoACriar(candidato(), quem)
    assert.equal(d.categoria, 'Outros')
    assert.equal(d.preco, null)
    assert.deepEqual(d.imagens, [])
    assert.equal(d.descricao, null)
    assert.equal(d.origemConteudo, 'De fornecedor', 'direito da imagem não verificado')
  })

  test('preserva providerId e externalId; origem externa preservada', () => {
    const d = dadosDoProdutoACriar(candidato({ fonte: 'tiktok-shop', providerId: 'tiktok-shop', externalId: 'X1' }), quem)
    assert.equal(d.providerId, 'tiktok-shop')
    assert.equal(d.externalId, 'X1')
    assert.equal(d.origemDados, 'tiktok-shop')
  })

  test('Comprei OU Usei → USER_PROVIDED; nenhum → MANUAL; Usei → #usei', () => {
    assert.equal(dadosDoProdutoACriar(candidato({ compradoPelaTitular: true }), quem).origemDados, 'USER_PROVIDED')
    assert.equal(dadosDoProdutoACriar(candidato({ usadoPelaTitular: true }), quem).origemDados, 'USER_PROVIDED')
    assert.equal(dadosDoProdutoACriar(candidato({ compradoPelaTitular: true, usadoPelaTitular: true }), quem).origemDados, 'USER_PROVIDED')
    assert.equal(dadosDoProdutoACriar(candidato(), quem).origemDados, 'MANUAL')
    assert.equal(origemDoInformado({ compradoPelaTitular: false, usadoPelaTitular: true }), 'USER_PROVIDED')
    assert.equal(origemDoInformado({ compradoPelaTitular: false, usadoPelaTitular: false }), 'MANUAL')
    assert.equal(dadosDoProdutoACriar(candidato({ usadoPelaTitular: true }), quem).observacoes, '#usei')
    assert.equal(dadosDoProdutoACriar(candidato(), quem).observacoes, null)
  })
})

describe('Descarte com quarentena de 30 dias', () => {
  const DIA = 24 * HORA
  test('descartado volta a concorrer só depois de 30 dias', () => {
    assert.equal(QUARENTENA_DO_DESCARTE_DIAS, 30)
    assert.equal(podeVoltarAConcorrer(candidato({ status: 'DESCARTADO', updatedAt: new Date(AGORA.getTime() - 29 * DIA) }), AGORA), false)
    assert.equal(podeVoltarAConcorrer(candidato({ status: 'DESCARTADO', updatedAt: new Date(AGORA.getTime() - 30 * DIA) }), AGORA), true)
    assert.equal(podeVoltarAConcorrer(candidato({ status: 'DESCARTADO', updatedAt: new Date(AGORA.getTime() - 90 * DIA) }), AGORA), true)
  })

  test('ESCOLHIDO e CADASTRADO nunca voltam; NOVO/APRESENTADO seguem concorrendo', () => {
    const antigo = new Date(AGORA.getTime() - 365 * DIA)
    assert.equal(podeVoltarAConcorrer(candidato({ status: 'ESCOLHIDO', updatedAt: antigo }), AGORA), false)
    assert.equal(podeVoltarAConcorrer(candidato({ status: 'CADASTRADO', updatedAt: antigo }), AGORA), false)
    assert.equal(podeVoltarAConcorrer(candidato({ status: 'NOVO' }), AGORA), true)
    assert.equal(podeVoltarAConcorrer(candidato({ status: 'APRESENTADO' }), AGORA), true)
  })
})

describe('Impedimentos de escolha', () => {
  test('só APRESENTADO, válido e sem bloqueio', () => {
    assert.equal(impedimentoParaEscolha(candidato(), AGORA), null)
    assert.match(impedimentoParaEscolha(candidato({ status: 'NOVO' }), AGORA)!, /3 apresentados/)
    assert.match(impedimentoParaEscolha(candidato({ status: 'CADASTRADO' }), AGORA)!, /CADASTRADO/)
    assert.match(impedimentoParaEscolha(candidato({ complianceBloqueante: true }), AGORA)!, /compliance/)
    assert.match(impedimentoParaEscolha(candidato({ validoAte: new Date(AGORA.getTime() - 1) }), AGORA)!, /vencido/)
  })
})

describe('"Informar produto" (fallback)', () => {
  test('Comprei e Usei viram os sinais da Fase 1; imagem informada não tem direito verificado', () => {
    const base = candidato({ categoria: 'Beleza', preco: 150, imagem: 'https://loja.com/i.jpg', compradoPelaTitular: true, usadoPelaTitular: true })
    const o = pontuarProduto(informadoComoProduto(base), semHistorico(), { canaisCapazes: [], agora: AGORA })
    assert.equal(o.compradoPelaTitular, true)
    assert.equal(o.usadoPelaTitular, true)
    assert.equal(o.publicacaoImpedida, true)
    assert.equal(o.componentes.externalMarketSignals, null, 'nenhum dado de mercado inventado')
  })

  test('"Usei" sem "Comprei": origem USER_PROVIDED, mas afinidade só de uso (+10), sem o +5 de comprado', () => {
    const o = pontuarProduto(
      informadoComoProduto(candidato({ nome: 'Organizador', categoria: 'Casa e Decoração', preco: 50, usadoPelaTitular: true })),
      semHistorico(),
      { canaisCapazes: [], agora: AGORA }
    )
    assert.equal(o.afinidadeParaDesempate, 10)
    assert.equal(o.usadoPelaTitular, true)
  })

  test('sem categoria → "Outros"; sem preço → preço desconhecido', () => {
    const o = pontuarProduto(informadoComoProduto(candidato()), semHistorico(), { canaisCapazes: [], agora: AGORA })
    assert.equal(o.categoria, 'Outros')
    assert.ok(o.desconhecidos!.some((d) => /preço/.test(d)))
  })
})

describe('Perfil gravado no banco ≡ perfil padrão', () => {
  test('a cópia do padrão produz exatamente a mesma aderência', () => {
    const doBanco = perfilDaLinha(linhaDoPerfilPadrao())
    assert.ok(doBanco)
    for (const p of [
      { categoria: 'Beleza', preco: 189, origemDados: 'USER_PROVIDED', nome: 'Máscara capilar Kérastase' },
      { categoria: 'Outros', preco: null, origemDados: 'MANUAL', nome: 'Perfume floral' },
      { categoria: 'Eletrônicos', preco: 150, origemDados: 'MANUAL', nome: 'Capa para MAC e MacBook' },
      { categoria: 'Esportes', preco: 900, origemDados: 'MANUAL', nome: 'Bola Adidas' },
    ]) {
      assert.deepEqual(avaliarAderenciaAoPerfil(p, doBanco!), avaliarAderenciaAoPerfil(p, perfilPadrao()), p.nome)
    }
  })

  test('pesos sempre do código; linha malformada → null (usa o padrão)', () => {
    const doBanco = perfilDaLinha(linhaDoPerfilPadrao())!
    assert.deepEqual(doBanco.afinidadeDaTitular.bonus, { marcaPreferida: 10, estilo: 5, comprado: 5, usado: 10 })
    assert.equal(doBanco.afinidadeDaTitular.teto, 20)
    assert.equal(perfilDaLinha({ ...linhaDoPerfilPadrao(), marcasPreferidas: 'MAC' }), null)
    assert.equal(perfilDaLinha({ ...linhaDoPerfilPadrao(), precoMinimo: 500, precoMaximo: 300 }), null)
  })
})

describe('A tela não mostra imagem sem direito', () => {
  test('API devolve imagem só quando autorizada', () => {
    assert.equal(candidatoParaTela(candidato({ imagem: 'https://loja.com/i.jpg', imagemAutorizada: false })).imagem, null)
    assert.equal(candidatoParaTela(candidato({ imagem: 'https://loja.com/i.jpg', imagemAutorizada: false })).imagemInformadaSemDireito, true)
    assert.equal(candidatoParaTela(candidato({ imagem: 'https://s/i.jpg', imagemAutorizada: true })).imagem, 'https://s/i.jpg')
  })

  test('a tela exibe todos os campos e não esconde desconhecidos', () => {
    const fonte = readFileSync(join(RAIZ, 'app/(dashboard)/oportunidades/page.tsx'), 'utf8')
    for (const rotulo of [
      'Score', 'Base de evidência', 'Confiança', 'Aderência BoraComprar', 'Afinidade da titular', 'Preço', 'Comissão',
      'Motivos positivos', 'Riscos', 'Dados desconhecidos', 'Por que está nesta posição', 'Escolher produto', // P2.17.13: rótulo pedido; os técnicos ficam em "Ver análise completa"
      'Informar produto', 'Comprei', 'Usei',
    ]) {
      assert.ok(fonte.includes(rotulo), rotulo)
    }
    assert.match(fonte, /const DESCONHECIDO = 'desconhecido'/)
  })
})

describe('Estado da tela /oportunidades (P2.14.5.13.3)', () => {
  const coleta = (avaliados: number, apresentados: number, bloqueados: number | null = 0): UltimaColetaNaTela => ({
    em: AGORA.toISOString(), avaliados, apresentados, bloqueados,
  })

  test('nunca houve coleta', () => {
    const e = estadoDaCuradoria({ ultima: null, candidatosEmAberto: 0 })
    assert.equal(e.estado, 'NUNCA_COLETADO')
    assert.equal(e.resumo, null)
  })

  test('coleta com catálogo vazio: texto fixo pedido, sem obrigar a titular a cadastrar', () => {
    const e = estadoDaCuradoria({ ultima: coleta(0, 0, 0), candidatosEmAberto: 0 })
    assert.equal(e.estado, 'CATALOGO_VAZIO')
    assert.equal(e.titulo, 'Ainda não há produtos disponíveis para o Patrono avaliar.')
    assert.equal(
      e.detalhe,
      'Quando houver produtos no catálogo ou em uma fonte conectada, o Patrono selecionará automaticamente os melhores candidatos.'
    )
    assert.equal(e.resumo, '0 avaliados · 0 apresentados · 0 bloqueados')
  })

  test('coleta com produtos, mas nenhum elegível', () => {
    const e = estadoDaCuradoria({ ultima: coleta(5, 0, 5), candidatosEmAberto: 0 })
    assert.equal(e.estado, 'SEM_ELEGIVEIS')
    assert.match(e.titulo, /avaliou 5 produto/)
  })

  test('candidatos encontrados (e os já resolvidos)', () => {
    assert.equal(estadoDaCuradoria({ ultima: coleta(9, 3, 1), candidatosEmAberto: 3 }).estado, 'COM_CANDIDATOS')
    assert.equal(estadoDaCuradoria({ ultima: coleta(9, 3, 1), candidatosEmAberto: 0 }).estado, 'CANDIDATOS_RESOLVIDOS')
  })

  test('toast com os números reais: X avaliados · Y apresentados · Z bloqueados', () => {
    assert.equal(textoDoResumo(coleta(12, 3, 2)), '12 avaliados · 3 apresentados · 2 bloqueados')
    assert.equal(textoDoResumo(coleta(4, 0, null)), '4 avaliados · 0 apresentados · — bloqueados')
    const pagina = readFileSync(join(RAIZ, 'app/(dashboard)/oportunidades/page.tsx'), 'utf8')
    assert.match(pagina, /description: nova \? textoDoResumo\(nova\)/)
    assert.ok(!/title: 'Candidatos atualizados'/.test(pagina), 'o toast antigo sem números saiu')
    assert.match(pagina, /estadoDaCuradoria\(\{ ultima, candidatosEmAberto: candidatos\.length \}\)/)
    assert.match(pagina, /“Informar produto” — é opcional/)
  })

  test('a coleta grava os bloqueados na auditoria; a tela não puxa código de servidor', () => {
    const curadoria = readFileSync(join(RAIZ, 'lib/curadoria.ts'), 'utf8')
    assert.match(curadoria, /metadata: \{ avaliados: fila\.length, apresentados: [^}]*, bloqueados \}/)
    assert.match(curadoria, /action: 'curadoria\.candidatos_coletados'/)
    assert.ok(!/^import /m.test(readFileSync(join(RAIZ, 'lib/curadoria-estado.ts'), 'utf8')), 'curadoria-estado sem imports')
    const pagina = readFileSync(join(RAIZ, 'app/(dashboard)/oportunidades/page.tsx'), 'utf8')
    assert.match(pagina, /^import type \{ CandidatoNaTela \} from '@\/lib\/curadoria-http'/m, 'da camada HTTP, só tipo')
  })
})

describe('Guardas: só curadoria, nada além', () => {
  function arquivos(dir: string): string[] {
    return readdirSync(dir).flatMap((f) => {
      const p = join(dir, f)
      return statSync(p).isDirectory() ? arquivos(p) : [p]
    })
  }
  const novos = [
    join(RAIZ, 'lib/curadoria.ts'),
    join(RAIZ, 'lib/curadoria-http.ts'),
    join(RAIZ, 'lib/curadoria-estado.ts'),
    join(RAIZ, 'lib/perfil-da-loja.ts'),
    join(RAIZ, 'app/(dashboard)/oportunidades/page.tsx'),
    ...arquivos(join(RAIZ, 'app/api/oportunidades')),
  ]

  test('nenhum arquivo novo importa IA, publicação, fila de tarefas ou geração de conteúdo', () => {
    const proibidos = /from ['"][^'"]*(anthropic|falai|openai|ai-|publica|instagram|tiktok|automation-queue|ciclo-de-oportunidades|plano-de-acao|conteudo|video|whatsapp)[^'"]*['"]/i
    // P2.17: a curadoria pode ler a FONTE de catálogo do TikTok Shop (busca
    // oficial e leitura de link) — não o canal TikTok nem publicação.
    const fontesDeCatalogo = /from ['"]\.\/tiktok-shop-(descoberta|link|oauth|cliente)['"]/g
    for (const f of novos) assert.ok(!proibidos.test(readFileSync(f, 'utf8').replace(fontesDeCatalogo, '')), f)
    // …e essas fontes também não puxam IA, publicação, fila nem conteúdo.
    for (const m of ['descoberta', 'link', 'oauth', 'cliente']) {
      const fonte = readFileSync(join(RAIZ, `lib/tiktok-shop-${m}.ts`), 'utf8').replace(fontesDeCatalogo, '')
      assert.ok(!/from ['"][^'"]*(anthropic|falai|openai|ai-|publica|instagram|tiktok-(channel|upload|rascunho|autopilot|preflight)|automation-queue|conteudo|video|whatsapp)[^'"]*['"]/i.test(fonte), m)
    }
  })

  test('não toca em tarefa, conteúdo, publicação nem no modo do workspace', () => {
    for (const f of novos) {
      const fonte = readFileSync(f, 'utf8')
      assert.ok(!/prisma\.(automationJob|conteudo|publicacao)\b/.test(fonte), f)
      assert.ok(!/workspace\.(update|upsert)/.test(fonte), f)
      assert.ok(!/automationPaused\s*:/.test(fonte.replace(/automationPaused: false \}\)/, '')), f)
    }
  })

  test('migration só aditiva: cria, nunca altera/apaga o que existe', () => {
    const sql = readFileSync(join(RAIZ, 'prisma/migrations/20261008120000_curadoria_candidatos_e_perfil/migration.sql'), 'utf8')
    const comandos = sql.split('\n').filter((l) => l.trim() && !l.trim().startsWith('--'))
    // "ON DELETE/UPDATE ..." das chaves estrangeiras é cláusula, não comando.
    const semClausulasDeFk = comandos.join('\n').replace(/ON (DELETE|UPDATE) (RESTRICT|CASCADE|SET NULL|NO ACTION)/g, '')
    assert.ok(!/\bDROP\b|\bTRUNCATE\b|\bDELETE\b|\bUPDATE\b/i.test(semClausulasDeFk))
    for (const l of comandos.filter((x) => /^ALTER TABLE/.test(x))) {
      assert.match(l, /^ALTER TABLE "(CandidatoDeProduto|PerfilDaLoja)"/, l)
    }
    assert.match(sql, /ALTER TABLE "CandidatoDeProduto" ENABLE ROW LEVEL SECURITY/)
    assert.match(sql, /REVOKE ALL ON TABLE "PerfilDaLoja" FROM anon, authenticated/)
  })

  test('o perfil padrão de lib/config.ts continua existindo (reserva)', () => {
    const config = readFileSync(join(RAIZ, 'lib/config.ts'), 'utf8')
    assert.match(config, /export const PERFIL_DA_LOJA = \{/)
  })
})
