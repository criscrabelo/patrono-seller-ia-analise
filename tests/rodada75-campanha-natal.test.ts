/**
 * P2.17.2 — Campanha sazonal Natal 2026.
 * Regra: evidência real de venda > aderência ao Natal > público BoraComprar >
 * comissão > facilidade de criação. Bônus de ORDEM (não muda o score);
 * preço nunca exclui (só etiqueta LEMBRANCINHA/PREMIUM).
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { avaliarCampanha, campanhaAtiva, NATAL_2026, TAGS_DA_CAMPANHA } from '../lib/campanha-sazonal'
import {
  pontuarProduto,
  calcularDesempenhoHistorico,
  ordenarFila,
  criterioDeDesempate,
  selecionarParaModo,
  type OportunidadePontuada,
  type ProdutoDoCatalogo,
} from '../lib/motor-de-oportunidades'
import { PARTICIPACAO_DA_ADERENCIA } from '../lib/opportunity-score-composite'
import { campanhaDoCandidato } from '../lib/curadoria-http'

const NO_NATAL = new Date('2026-11-20T12:00:00Z')
const FORA = new Date('2027-01-15T12:00:00Z')
const semHistorico = () =>
  calcularDesempenhoHistorico({ taxaConversao: null, receitaPorClique: null, cliques: 0, vendasElegiveis: 0, publicacoesRecentes: 0 })

function produto(extra: Partial<ProdutoDoCatalogo>): ProdutoDoCatalogo {
  return {
    id: 'p',
    nome: 'Produto',
    categoria: 'Outros',
    preco: 89.9,
    linkProduto: 'https://exemplo.com/p',
    imagens: ['https://supabase.exemplo/i.jpg'],
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
const pontuada = (extra: Partial<ProdutoDoCatalogo>, agora = NO_NATAL): OportunidadePontuada => ({
  ...pontuarProduto(produto(extra), semHistorico(), { canaisCapazes: ['instagram'], agora }),
  workspaceId: 'ws',
})
function comBase(o: OportunidadePontuada, base: number): OportunidadePontuada {
  const a = o.componentes.aderenciaAoPerfil
  const score = Math.round(a == null ? base : (1 - PARTICIPACAO_DA_ADERENCIA) * base + PARTICIPACAO_DA_ADERENCIA * a)
  return { ...o, score, componentes: { ...o.componentes, base, final: score } }
}

describe('P2.17.2 — campanha e etiquetas', () => {
  test('janela: ativa de 01/10 a 25/12/2026 (Brasília); fora dela, nada vale', () => {
    assert.equal(campanhaAtiva(NO_NATAL)?.id, 'NATAL_2026')
    assert.equal(campanhaAtiva(new Date('2026-12-25T23:00:00-03:00'))?.id, 'NATAL_2026')
    assert.equal(campanhaAtiva(new Date('2026-12-26T00:30:00-03:00')), null)
    assert.equal(avaliarCampanha({ categoria: 'Brinquedos', nome: 'Boneca', preco: 50 }, FORA), null)
    assert.deepEqual([...TAGS_DA_CAMPANHA], [
      'NATAL', 'PRESENTE', 'DECORACAO_NATALINA', 'PRESENTE_INFANTIL', 'PRESENTE_MULHER', 'PRESENTE_CASA', 'LEMBRANCINHA', 'PREMIUM',
    ])
  })

  test('etiquetas pelo dado real (categoria, nome, preço)', () => {
    const arvore = avaliarCampanha({ categoria: 'Casa e Decoração', nome: 'Árvore de Natal 1,80 m com pisca-pisca', preco: 249 }, NO_NATAL)!
    assert.ok(arvore.tags.includes('NATAL') && arvore.tags.includes('DECORACAO_NATALINA') && arvore.tags.includes('PREMIUM'))
    assert.ok(arvore.aderencia >= 90, String(arvore.aderencia))
    const boneca = avaliarCampanha({ categoria: 'Brinquedos', nome: 'Boneca de pelúcia', preco: 59.9 }, NO_NATAL)!
    assert.ok(boneca.tags.includes('PRESENTE_INFANTIL') && boneca.tags.includes('PRESENTE'))
    const kit = avaliarCampanha({ categoria: 'Beleza', nome: 'Kit skincare feminino', preco: 25 }, NO_NATAL)!
    for (const t of ['PRESENTE_MULHER', 'PRESENTE', 'LEMBRANCINHA', 'NATAL'] as const) assert.ok(kit.tags.includes(t), t)
    const potes = avaliarCampanha({ categoria: 'Casa e Decoração', nome: 'Conjunto de potes organizadores de cozinha', preco: 79 }, NO_NATAL)!
    assert.ok(potes.tags.includes('PRESENTE_CASA'))
    const neutro = avaliarCampanha({ categoria: 'Pet', nome: 'Ração 10 kg', preco: 120 }, NO_NATAL)!
    assert.equal(neutro.aderencia, 0)
    assert.deepEqual(neutro.tags, [])
  })

  test('preço nunca exclui nem tira ponto: só etiqueta', () => {
    const barato = avaliarCampanha({ categoria: 'Brinquedos', nome: 'Carrinho', preco: 15 }, NO_NATAL)!
    const caro = avaliarCampanha({ categoria: 'Brinquedos', nome: 'Carrinho', preco: 1500 }, NO_NATAL)!
    assert.equal(barato.aderencia, caro.aderencia)
    assert.ok(barato.tags.includes('LEMBRANCINHA') && caro.tags.includes('PREMIUM'))
    const p = pontuada({ id: 'caro', nome: 'Árvore de Natal premium', categoria: 'Casa e Decoração', preco: 3000 })
    assert.notEqual(p.classificacao, 'NAO_ELEGIVEL')
    assert.equal(p.complianceBloqueante, false)
  })
})

describe('P2.17.2 — ordem: evidência > Natal > perfil > comissão > facilidade', () => {
  test('o score é o mesmo dentro e fora da campanha (bônus só de ordem)', () => {
    const dentro = pontuada({ id: 'x', nome: 'Boneca de pelúcia', categoria: 'Brinquedos' }, NO_NATAL)
    const fora = pontuada({ id: 'x', nome: 'Boneca de pelúcia', categoria: 'Brinquedos' }, FORA)
    assert.equal(dentro.score, fora.score)
    assert.ok(dentro.campanha && dentro.campanha.aderencia > 0)
    assert.equal(fora.campanha, null)
    assert.ok(dentro.porqueDestaPosicao.some((l) => /Natal 2026: aderência \d+\/100 — bônus de ordenação/.test(l)))
  })

  test('evidência maior vence o Natal: produto natalino com evidência menor fica atrás', () => {
    const natalFraco = comBase(pontuada({ id: 'N', nome: 'Árvore de Natal', categoria: 'Casa e Decoração' }), 60)
    const comumForte = comBase(pontuada({ id: 'F', nome: 'Ração', categoria: 'Pet' }), 80)
    assert.deepEqual(ordenarFila([natalFraco, comumForte]).map((o) => o.produtoId), ['F', 'N'])
    assert.equal(criterioDeDesempate(comumForte, natalFraco).criterio, 'faixa')
  })

  test('mesma faixa de evidência: Natal vem antes do perfil BoraComprar', () => {
    const natal = comBase(pontuada({ id: 'N', nome: 'Kit presente de Natal', categoria: 'Casa e Decoração' }), 72)
    const perfil = comBase(pontuada({ id: 'P', nome: 'Caderno', categoria: 'Papelaria', preco: 50 }), 74)
    assert.equal(criterioDeDesempate(natal, perfil).criterio, 'campanha')
    assert.deepEqual(ordenarFila([perfil, natal]).map((o) => o.produtoId), ['N', 'P'])
    const s = selecionarParaModo(ordenarFila([perfil, natal]), { automationMode: 'ASSISTED', automationPaused: false })
    assert.match(s.candidatos[0].motivoDaPosicao, /maior aderência à campanha sazonal ativa \(Natal 2026\)/)
  })

  test('Natal e perfil iguais: comissão por venda decide; depois a facilidade de criar', () => {
    const base = { categoria: 'Brinquedos', nome: 'Boneca de pelúcia', preco: 100 }
    const maior = comBase(pontuada({ id: 'C1', ...base, comissaoPercentual: 15 }), 72)
    const menor = comBase(pontuada({ id: 'C2', ...base, comissaoPercentual: 5 }), 72)
    const menorMesmaFaixa: OportunidadePontuada = {
      ...menor,
      aderenciaDoPerfil: maior.aderenciaDoPerfil,
      afinidadeParaDesempate: maior.afinidadeParaDesempate,
      campanha: maior.campanha,
    }
    assert.equal(criterioDeDesempate(maior, menorMesmaFaixa).criterio, 'comissao')
    assert.equal(ordenarFila([menorMesmaFaixa, maior])[0].produtoId, 'C1')
    const facil: OportunidadePontuada = { ...menorMesmaFaixa, produtoId: 'E1', comissaoEstimadaBRL: 5, componentes: { ...menorMesmaFaixa.componentes, automationFeasibility: 90 } }
    const dificil: OportunidadePontuada = { ...menorMesmaFaixa, produtoId: 'E2', comissaoEstimadaBRL: 5, componentes: { ...menorMesmaFaixa.componentes, automationFeasibility: 40 } }
    assert.equal(criterioDeDesempate(facil, dificil).criterio, 'facilidade')
  })

  test('sem campanha ativa, o critério não decide nada', () => {
    const a = comBase(pontuada({ id: 'A', nome: 'Kit presente de Natal', categoria: 'Casa e Decoração' }, FORA), 72)
    const b = comBase(pontuada({ id: 'B', nome: 'Caderno', categoria: 'Papelaria', preco: 50 }, FORA), 72)
    assert.notEqual(criterioDeDesempate(a, b).criterio, 'campanha')
  })
})

describe('P2.17.2 — tela', () => {
  test('a API devolve as etiquetas do candidato; a tela mostra em português', () => {
    assert.deepEqual(campanhaDoCandidato({ nome: 'Boneca de pelúcia', categoria: 'Brinquedos', preco: 20 }, NO_NATAL)?.tags, [
      'NATAL', 'PRESENTE', 'PRESENTE_INFANTIL', 'LEMBRANCINHA',
    ])
    assert.equal(campanhaDoCandidato({ nome: 'Boneca', categoria: 'Brinquedos', preco: 20 }, FORA), null)
    const tela = fs.readFileSync('app/(dashboard)/oportunidades/page.tsx', 'utf8')
    assert.match(tela, /DECORACAO_NATALINA: 'Decoração natalina'/)
    assert.match(tela, /c\.campanha\.tags\.map/)
    assert.equal(NATAL_2026.categorias.includes('Brinquedos'), true)
  })
})
