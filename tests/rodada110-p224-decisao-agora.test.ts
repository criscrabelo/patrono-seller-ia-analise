/**
 * P2.24 — motor unificado "o que fazer agora": degraus de prioridade preservados, nota com fatores e pesos,
 * ação bloqueada pela plataforma não é recomendada, explicação com sinais e alternativas.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { decidirAgora, PESOS_DA_NOTA, type JornadaParaDecidir } from '../lib/decisao-agora'
import type { EstadoDaJornada, FatosDaJornada } from '../lib/motor-da-jornada'
import type { PermissaoDaAcao } from '../lib/permissao-da-acao'

const AGORA = new Date('2026-10-15T12:00:00-03:00')
let n = 0
function j(x: { etapa?: string; espera?: string; acao?: string | null; prazoH?: number; missao?: string | null; perto?: number; base?: number; comissao?: number | null; emMaos?: boolean; escolhidaEm?: number; titulo?: string; amostra?: 'PEDIR' | 'NAO_PRIORITARIO' | null; provider?: string } = {}): JornadaParaDecidir {
  const id = `c${++n}`
  const estado = {
    candidatoId: id, etapa: x.etapa ?? 'APROVAR_PRODUTO', espera: x.espera ?? 'AGUARDANDO_CRISTIANE', executor: 'HUMANO', titulo: x.titulo ?? `Jornada ${id}`,
    acao: x.acao === null ? null : { tipo: x.acao ?? 'APROVAR_PRODUTO', rotulo: 'r', instrucao: 'i', porQueNaoAutomatico: '', tempoEstimado: '', evidencia: 'CONFIRMACAO', respostas: [], linkExterno: null },
    atualizacoes: [], missao: x.missao ?? null, prazo: x.prazoH != null ? new Date(AGORA.getTime() + x.prazoH * 3_600_000).toISOString() : null,
    terminal: false, pertoDoDinheiro: x.perto ?? 1, depois: '', proximoMarco: '', produto: { nome: `P ${id}`, imagem: null, link: null },
  } as unknown as EstadoDaJornada
  const fatos = {
    candidato: { id, nome: `P ${id}`, imagem: null, linkProduto: null, providerId: x.provider ?? 'tiktok-shop', externalId: null, status: 'APRESENTADO', score: 50, baseDeEvidencia: x.base ?? 50, comissaoPercentual: null, comissaoValor: x.comissao ?? null, vendas: null, preco: null, compradoPelaTitular: !!x.emMaos, usadoPelaTitular: false, complianceBloqueante: false, motivos: [] },
    decisoes: { iniciada: true, recusada: false, vitrine: null, amostraDispensada: false, emMaos: !!x.emMaos, falha: null, encerrada: null, entregaPerguntadaEm: null },
    vitrineOficial: null, amostra: null, assistida: null, outraProducao: null, resultado: null, midiaAutorizada: false, tipoDeAmostraObservado: null, missoes: [],
    oportunidadeDeAmostra: x.amostra ? { decisao: x.amostra, nota: x.amostra === 'PEDIR' ? 60 : 0, confianca: 'ALTA', cobertura: 0.6, fatores: [], usados: [], ausentes: [], vencidos: [], motivos: [], riscos: [], motivoFinal: '' } : null,
  } as unknown as FatosDaJornada
  return { estado, fatos, escolhidaEm: x.escolhidaEm ?? 0 }
}
const bloqueio = { resultado: 'BLOQUEADA', motivo: 'Ação indisponível: quota oficial atingida (2/2 hoje — Tela do app TikTok).' } as PermissaoDaAcao

describe('P2.24 — decidirAgora', () => {
  test('degraus preservados: prazo crítico > publicação pronta > escolhida > em mãos > nota', () => {
    const resto = j({ base: 99, comissao: 30 })
    const emMaos = j({ emMaos: true })
    const escolhida = j({ escolhidaEm: 5 })
    const publicar = j({ acao: 'PUBLICAR_VIDEO', etapa: 'PUBLICAR', perto: 6 })
    const critico = j({ prazoH: 10, missao: 'Missão X' })
    const d = decidirAgora({ jornadas: [resto, emMaos, escolhida, publicar, critico], agora: AGORA })
    assert.deepEqual(d.ordem.map((x) => x.candidatoId), [critico, publicar, escolhida, emMaos, resto].map((x) => x.estado.candidatoId))
    assert.deepEqual(d.ordem.map((x) => x.degrau), [0, 1, 2, 3, 4])
    assert.match(d.agora!.porque[0], /prazo crítico/)
  })
  test('dentro do degrau, a nota decide com fatores e pesos visíveis (perto do dinheiro, evidência, comissão, missão, em mãos, amostra)', () => {
    const fraca = j({ base: 20, comissao: 1 })
    const forte = j({ base: 90, comissao: 12, missao: 'Missão Y', prazoH: 200 })
    const d = decidirAgora({ jornadas: [fraca, forte], agora: AGORA })
    assert.equal(d.ordem[0].candidatoId, forte.estado.candidatoId)
    const f = d.ordem[0].fatores
    assert.deepEqual(f.map((x) => x.fator).sort(), ['comissao', 'evidencia', 'missaoOuCampanha', 'pertoDoDinheiro'])
    assert.ok(f.every((x) => x.peso === PESOS_DA_NOTA[x.fator] && x.pontos <= x.peso))
    assert.equal(d.ordem[0].nota, Math.round(f.reduce((s, x) => s + x.pontos, 0) * 10) / 10)
    assert.ok(!d.ordem[1].fatores.some((x) => x.fator === 'emMaos'), 'fator desconhecido/ausente não pontua')
    assert.match(d.agora!.porque.join(' '), /sinais: .*base de evidência 90/)
  })
  test('ação que a plataforma não deixa fazer agora (quota oficial) não é recomendada: vai para o fim, com o motivo', () => {
    const publicar = j({ acao: 'PUBLICAR_VIDEO', etapa: 'PUBLICAR', perto: 6, titulo: 'Publicar o vídeo' })
    const amostra = j({ acao: 'PEDIR_AMOSTRA', etapa: 'AMOSTRA', amostra: 'PEDIR', titulo: 'Pedir a amostra' })
    const d = decidirAgora({ jornadas: [publicar, amostra], agora: AGORA, restricoes: bloqueio })
    assert.equal(d.agora!.candidatoId, amostra.estado.candidatoId)
    assert.equal(d.ordem[1].bloqueadaPelaPlataforma, bloqueio.motivo)
    assert.equal(d.agora!.alternativas[0].porqueNao, bloqueio.motivo)
    // sem bloqueio, publicar volta à frente
    assert.equal(decidirAgora({ jornadas: [publicar, amostra], agora: AGORA }).agora!.candidatoId, publicar.estado.candidatoId)
    // produto fora do TikTok Shop não consome a quota de vídeo comprável
    const foraDoShop = j({ acao: 'PUBLICAR_VIDEO', etapa: 'PUBLICAR', perto: 6, provider: 'shopee' })
    assert.equal(decidirAgora({ jornadas: [foraDoShop, amostra], agora: AGORA, restricoes: bloqueio }).agora!.candidatoId, foraDoShop.estado.candidatoId)
  })
  test('a decisão da amostra (P2.22) entra como fator; o aprendizado (P2.21) aparece no porquê quando vai ser aplicado', () => {
    const pedir = j({ acao: 'PEDIR_AMOSTRA', etapa: 'AMOSTRA', amostra: 'PEDIR' })
    const d = decidirAgora({ jornadas: [pedir], agora: AGORA })
    assert.ok(d.ordem[0].fatores.some((x) => x.fator === 'amostra' && x.pontos === PESOS_DA_NOTA.amostra))
    const conteudo = j({ acao: null, etapa: 'CONTEUDO', espera: 'AGUARDANDO_PATRONO', titulo: 'Preparando o vídeo' })
    const o = { estruturasPreferidas: [], estruturasEvitar: [], ganchosPreferidos: ['DESCOBERTA'], ganchosEvitar: [], cta: null, duracao: null, motivos: ['REPETIR HOOK: Hook DESCOBERTA teve 3,0x mais comissão por 1.000 views em 6 vídeos comparáveis.'] }
    const d2 = decidirAgora({ jornadas: [conteudo], agora: AGORA, orientacao: o })
    assert.match(d2.agora!.porque.join(' '), /aplicar o que aprendeu: REPETIR HOOK/)
    assert.match(d2.agora!.titulo, /^Patrono trabalhando: Preparando o vídeo/)
  })
  test('alternativas dizem por que não vêm antes; sem jornadas, sem decisão', () => {
    const a = j({ acao: 'PUBLICAR_VIDEO', etapa: 'PUBLICAR', perto: 6 })
    const b = j({ base: 10 })
    const c = j({ espera: 'AGUARDANDO_LOJISTA', acao: null, etapa: 'AGUARDANDO_AMOSTRA' })
    const d = decidirAgora({ jornadas: [a, b, c], agora: AGORA })
    assert.equal(d.agora!.alternativas.length, 2)
    assert.ok(d.agora!.alternativas.every((x) => x.porqueNao.length > 5))
    assert.ok(d.agora!.alternativas.some((x) => /não depende de você agora|prioridade menor/.test(x.porqueNao)))
    assert.equal(decidirAgora({ jornadas: [], agora: AGORA }).agora, null)
  })
})
