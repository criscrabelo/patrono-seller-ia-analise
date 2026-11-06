/**
 * P2.18.3 / P2.18.4 / P2.18.5 — Bloqueio da Affiliate API por elegibilidade,
 * registro de capacidades, motor da jornada e JORNADA ÚNICA ponta a ponta.
 *
 * Regras que estes testes travam (não regredir):
 *   - a data-base de elegibilidade mora em UM lugar só;
 *   - nada que dependa da Affiliate API aparece como "pronto para ligar agora";
 *   - AÇÃO ≠ EXECUTOR: liberar uma API troca o executor, não a jornada;
 *   - a titular só recebe ação em AGUARDANDO_CRISTIANE; uma ação em foco;
 *   - produto em mãos pula amostra (e a vitrine sai da frente);
 *   - "JÁ FIZ" não vale para tudo: publicar exige o link; resultado exige números;
 *   - falha automática cai para a contingência assistida, sem travar;
 *   - mesmos fatos → mesma etapa (refresh); duplo clique não duplica nada;
 *   - o motor é determinístico (nenhum modelo de ML decide transição).
 * Banco e storage de TESTE; mídias SINTÉTICAS (FFmpeg) marcadas FIXTURE; nada é publicado.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { AFFILIATE_CREATOR_API, dataDeElegibilidade, dataDeElegibilidadeBR, situacaoDaAffiliateApi } from '../lib/elegibilidade-tiktok-shop'
import { resolverCapacidades, type SinaisDasCapacidades } from '../lib/capacidades-tiktok'
import { ETAPAS_DA_AUTONOMIA, estadoDoCodigo, MODO_ASSISTIDO, resumoDaAutonomia } from '../lib/autonomia'
import { ordenarJornadas, resolverProximaEtapa, validarResposta, chaveDaEtapa, type FatosDaJornada } from '../lib/motor-da-jornada'
import { decisoesDosEventos } from '../lib/jornada'
// P2.45: este arquivo testa o fluxo de publicação ANTERIOR aos três controles (técnico, comercial, conformidade).
process.env.PATRONO_TESTE_LEGADO_SEM_TRES_CONTROLES = 'true'

const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')
const TEM_STORAGE = !!process.env.SUPABASE_SERVICE_ROLE_KEY && (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').includes('ref-teste-exemplo')
const HOJE = new Date('2026-10-13T12:00:00-03:00')
const DEPOIS_DA_DATA = new Date('2027-10-02T12:00:00-03:00')
const SEM_API: SinaisDasCapacidades = { agora: HOJE, affiliateConectada: false, vitrineLigada: false, publicacaoAutomatica: false, coletorDeMetricasLigado: false }

function lerFontes(dir: string): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...lerFontes(p))
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p)
  }
  return out
}

// ── P2.18.3: bloqueio por elegibilidade ─────────────────────────────────

describe('Affiliate Creator API: bloqueada por elegibilidade (fonte única da data)', () => {
  test('a data-base sai da constituição + 1 ano e fica num lugar só', () => {
    assert.equal(dataDeElegibilidade(), '2027-10-01')
    assert.equal(dataDeElegibilidadeBR(), '01/10/2027')
    const proibido = /2027-10-01|01\/10\/2027/
    const fora = [...lerFontes('lib'), ...lerFontes('app'), ...lerFontes('components')]
      .filter((f) => !f.endsWith(path.join('lib', 'elegibilidade-tiktok-shop.ts')))
      .filter((f) => proibido.test(fs.readFileSync(f, 'utf8')))
    assert.deepEqual(fora, [], 'a data de elegibilidade não pode estar escrita em outro arquivo')
  })
  test('até a data: bloqueada, com ressalva, fontes e o que NÃO é caminho; depois: elegível (ainda sem ligar nada)', () => {
    const s = situacaoDaAffiliateApi(HOJE)
    assert.equal(s.bloqueada, true)
    assert.equal(s.estado, 'BLOQUEADA_POR_ELEGIBILIDADE_TEMPORAL')
    assert.match(s.frase, /Salvo mudança oficial/)
    assert.ok(AFFILIATE_CREATOR_API.fontes.length >= 4)
    assert.ok(AFFILIATE_CREATOR_API.naoSaoCaminho.some((x) => /sandbox/i.test(x)))
    assert.equal(situacaoDaAffiliateApi(DEPOIS_DA_DATA).bloqueada, false)
  })
  test('nenhuma etapa que depende da Affiliate API aparece como "pronta para ligar agora" antes da data', () => {
    const dependentes = ETAPAS_DA_AUTONOMIA.filter((e) => e.dependeDaAffiliateApi)
    assert.ok(dependentes.length >= 5)
    for (const e of dependentes) {
      assert.ok(e.bloqueios.includes('ELEGIBILIDADE'), `${e.id} sem o bloqueio ELEGIBILIDADE`)
      assert.match(estadoDoCodigo(e, HOJE), /AGUARDANDO ELEGIBILIDADE/, e.id)
      assert.doesNotMatch(estadoDoCodigo(e, HOJE), /DEPENDE DO TIKTOK$/)
    }
    // Depois da data, volta a ser "depende do TikTok" (aprovação), sem mudar a matriz.
    assert.doesNotMatch(estadoDoCodigo(dependentes.find((e) => e.codigoOficialPronto)!, DEPOIS_DA_DATA), /ELEGIBILIDADE/)
    assert.equal(resumoDaAutonomia(ETAPAS_DA_AUTONOMIA, HOJE).bloqueadasPorElegibilidade, dependentes.length)
  })
  test('manual continua contingência (com por quê e como eliminar) e o Patrono continua ranqueando/escolhendo sozinho', () => {
    for (const e of ETAPAS_DA_AUTONOMIA.filter((x) => x.situacao === 'CONTINGENCIA_MANUAL')) {
      assert.ok(e.porqueManual && e.comoEliminar, e.id)
    }
    assert.equal(ETAPAS_DA_AUTONOMIA.find((e) => e.id === 'ranking')!.situacao, 'AUTOMATICA')
    assert.equal(ETAPAS_DA_AUTONOMIA.find((e) => e.id === 'escolha')!.situacao, 'AUTOMATICA_COM_APROVACAO')
    assert.ok(MODO_ASSISTIDO.oPatronoFazSozinho.some((x) => /ranqueia e escolhe/.test(x)))
  })
})

// ── Registro de capacidades: ação ≠ executor ────────────────────────────

describe('registro central de capacidades', () => {
  test('hoje: vitrine ASSISTED (HUMANO), amostra sem API pública, descoberta segue com o PATRONO', () => {
    const c = resolverCapacidades(SEM_API)
    assert.equal(c.TIKTOK_SHOWCASE_WRITE.modo, 'ASSISTED')
    assert.equal(c.TIKTOK_SHOWCASE_WRITE.executor, 'HUMANO')
    assert.equal(c.TIKTOK_SAMPLE_REQUEST.modo, 'UNAVAILABLE')
    assert.equal(c.TIKTOK_DISCOVERY.executor, 'PATRONO', 'sem a API o Patrono ranqueia as fontes disponíveis')
    assert.match(c.TIKTOK_SHOWCASE_WRITE.condicaoDeDesbloqueio!, /01\/10\/2027/)
    for (const x of Object.values(c)) assert.ok(x.motivo && x.fonte, x.id)
  })
  test('liberar a API muda SÓ a capacidade (executor API_EXTERNA); flags já existentes', () => {
    const c = resolverCapacidades({ ...SEM_API, affiliateConectada: true, vitrineLigada: true, publicacaoAutomatica: true, coletorDeMetricasLigado: true })
    assert.equal(c.TIKTOK_SHOWCASE_WRITE.modo, 'AUTOMATIC')
    assert.equal(c.TIKTOK_SHOWCASE_WRITE.executor, 'API_EXTERNA')
    assert.equal(c.TIKTOK_PUBLISH.executor, 'API_EXTERNA')
    assert.deepEqual([c.TIKTOK_DISCOVERY.flag, c.TIKTOK_SHOWCASE_WRITE.flag, c.TIKTOK_METRICS.flag], ['TIKTOK_SHOP_CATALOGO', 'TIKTOK_SHOP_VITRINE_AUTOMATICA', 'TIKTOK_METRICAS_AUTOMATICAS'])
  })
})

// ── Motor da jornada (puro) ─────────────────────────────────────────────

const CANDIDATO: FatosDaJornada['candidato'] = {
  id: 'c1', nome: 'FIXTURE Scarpin', imagem: null, linkProduto: 'https://www.tiktok.com/view/product/900000000000096001', providerId: 'tiktok-shop', externalId: '900000000000096001',
  status: 'APRESENTADO', score: 70, baseDeEvidencia: 70, comissaoPercentual: 12, comissaoValor: null, vendas: 340, preco: 129.9,
  compradoPelaTitular: false, usadoPelaTitular: false, complianceBloqueante: false, motivos: ['Vendas fortes no app'],
}
const SEM_DECISAO: FatosDaJornada['decisoes'] = { iniciada: true, recusada: false, vitrine: null, amostraDispensada: false, emMaos: false, falha: null, encerrada: null, entregaPerguntadaEm: null }
function fatos(x: Omit<Partial<FatosDaJornada>, 'decisoes' | 'candidato'> & { decisoes?: Partial<FatosDaJornada['decisoes']>; candidato?: Partial<FatosDaJornada['candidato']> } = {}): FatosDaJornada {
  return {
    vitrineOficial: null, amostra: null, assistida: null, outraProducao: null, resultado: null, midiaAutorizada: false, tipoDeAmostraObservado: null, missoes: [],
    ...x,
    candidato: { ...CANDIDATO, ...(x.candidato ?? {}) },
    decisoes: { ...SEM_DECISAO, ...(x.decisoes ?? {}) },
  }
}
const CAPS = resolverCapacidades(SEM_API)
const etapa = (f: FatosDaJornada, caps = CAPS, agora = HOJE) => resolverProximaEtapa(f, caps, agora)

describe('motor da jornada: próxima etapa a partir dos fatos', () => {
  test('produto escolhido ainda não aprovado → APROVAR_PRODUTO (aprovar · já tenho · não quero)', () => {
    const e = etapa(fatos({ decisoes: { iniciada: false } }))
    assert.equal(e.etapa, 'APROVAR_PRODUTO')
    assert.equal(e.espera, 'AGUARDANDO_CRISTIANE')
    assert.deepEqual(e.acao!.respostas.map((r) => r.id), ['APROVAR', 'TENHO_EM_MAOS', 'NAO_QUERO'])
  })
  test('produto EM MÃOS: pula amostra E vitrine e vai direto ao conteúdo (Patrono prepara)', () => {
    const e = etapa(fatos({ decisoes: { emMaos: true } }))
    assert.equal(e.etapa, 'CONTEUDO')
    assert.equal(e.espera, 'AGUARDANDO_PATRONO')
    assert.equal(e.acao, null)
    const pulados = e.progresso.filter((p) => p.situacao === 'PULADO').map((p) => p.passo)
    assert.deepEqual(pulados, ['Vitrine', 'Amostra', 'Recebimento'])
  })
  test('sem o produto: vitrine (ASSISTED → humano) → amostra; com a API ligada a MESMA etapa é do executor API', () => {
    const v = etapa(fatos())
    assert.equal(v.acao!.tipo, 'ADICIONAR_VITRINE')
    assert.equal(v.executor, 'HUMANO')
    assert.equal(v.acao!.linkExterno!.url, CANDIDATO.linkProduto, 'abre o produto (URL pública), nunca URL privada')
    const auto = etapa(fatos(), resolverCapacidades({ ...SEM_API, affiliateConectada: true, vitrineLigada: true }))
    assert.equal(auto.etapa, 'VITRINE')
    assert.equal(auto.executor, 'API_EXTERNA')
    assert.equal(auto.acao, null, 'com a API, nada para a titular')
    const am = etapa(fatos({ decisoes: { vitrine: 'CONFIRMADA' } }))
    assert.equal(am.acao!.tipo, 'PEDIR_AMOSTRA')
  })
  test('P2.22: o passo da amostra segue o SampleOpportunityScore (NÃO PEDIR encerra; NÃO PRIORITÁRIO não pede nada; PEDIR traz motivos)', () => {
    const op = (decisao: 'PEDIR' | 'PEDIR_SE_PRIORIDADE' | 'NAO_PRIORITARIO' | 'NAO_PEDIR', motivoFinal: string) => ({ decisao, nota: 50, confianca: 'MEDIA' as const, cobertura: 0.5, fatores: [], usados: [], ausentes: [], vencidos: [], motivos: ['amostra grátis disponível'], riscos: ['prazo curto'], motivoFinal })
    const naoPedir = etapa(fatos({ decisoes: { vitrine: 'CONFIRMADA' }, oportunidadeDeAmostra: op('NAO_PEDIR', 'Os fatores conhecidos apontam que não compensa pedir.') }))
    assert.equal(naoPedir.etapa, 'ENCERRADA'); assert.match(naoPedir.titulo, /não vale pedir amostra/)
    const naoPrio = etapa(fatos({ decisoes: { vitrine: 'CONFIRMADA' }, oportunidadeDeAmostra: op('NAO_PRIORITARIO', 'A comissão vista está desatualizada: revalide no app antes de decidir.') }))
    assert.deepEqual([naoPrio.etapa, naoPrio.espera, naoPrio.acao], ['AMOSTRA', 'AGUARDANDO_PATRONO', null]); assert.match(naoPrio.aguardando!, /desatualizada/)
    const pedir = etapa(fatos({ decisoes: { vitrine: 'CONFIRMADA' }, oportunidadeDeAmostra: op('PEDIR', 'Vale pedir: os fatores conhecidos são favoráveis.') }))
    assert.equal(pedir.acao!.tipo, 'PEDIR_AMOSTRA'); assert.match(pedir.acao!.instrucao, /^PEDIR: Vale pedir.*Motivos: amostra grátis disponível.*Riscos: prazo curto/)
    const seProrioridade = etapa(fatos({ decisoes: { vitrine: 'CONFIRMADA' }, oportunidadeDeAmostra: op('PEDIR_SE_PRIORIDADE', 'Razoável.') }))
    assert.match(seProrioridade.titulo, /se for prioridade/)
  })
  test('amostra pedida/aprovada/enviada: espera de TERCEIRO, "nenhuma ação sua", atualizações opcionais', () => {
    for (const [estado, espera] of [['PENDENTE_APROVACAO', 'AGUARDANDO_LOJISTA'], ['APROVADA', 'AGUARDANDO_LOJISTA'], ['ENVIADA', 'AGUARDANDO_ENTREGA']] as const) {
      const e = etapa(fatos({ decisoes: { vitrine: 'CONFIRMADA' }, amostra: { id: 'a1', estado, tipo: 'GRATIS', enviadaEm: HOJE, recebidaEm: null } }))
      assert.equal(e.espera, espera, estado)
      assert.equal(e.acao, null)
      assert.ok(e.atualizacoes.length > 0)
    }
    const atrasada = etapa(fatos({ decisoes: { vitrine: 'CONFIRMADA' }, amostra: { id: 'a1', estado: 'ENVIADA', tipo: null, enviadaEm: new Date(HOJE.getTime() - 8 * 86400_000), recebidaEm: null } }))
    assert.equal(atrasada.acao!.tipo, 'CONFIRMAR_RECEBIMENTO')
  })
  test('amostra rejeitada: o Patrono decide sem travar (encerra e traz o próximo)', () => {
    const e = etapa(fatos({ decisoes: { vitrine: 'CONFIRMADA' }, amostra: { id: 'a1', estado: 'REJEITADA', tipo: null, enviadaEm: null, recebidaEm: null } }))
    assert.equal(e.espera, 'ENCERRADA')
    assert.ok(e.terminal)
  })
  test('vídeo: mídia → gerando (Patrono) → aprovar (titular) → publicar com evidência = link', () => {
    const a = { id: 'p1', versao: 1, videoGerado: false, geracaoFalhou: false, bloqueio: null, erro: null, modoDePublicacao: null, publicadoEm: null }
    assert.equal(etapa(fatos({ decisoes: { emMaos: true }, assistida: { ...a, estado: 'AGUARDANDO_MIDIA' } })).acao!.tipo, 'FORNECER_MIDIA_REAL')
    assert.equal(etapa(fatos({ decisoes: { emMaos: true }, assistida: { ...a, estado: 'GERANDO_VIDEO' } })).espera, 'AGUARDANDO_PATRONO')
    assert.equal(etapa(fatos({ decisoes: { emMaos: true }, assistida: { ...a, estado: 'AGUARDANDO_APROVACAO' } })).espera, 'AGUARDANDO_PATRONO', 'sem MP4 não há "pronto para aprovar"')
    assert.equal(etapa(fatos({ decisoes: { emMaos: true }, assistida: { ...a, estado: 'AGUARDANDO_APROVACAO', videoGerado: true } })).acao!.tipo, 'APROVAR_VIDEO')
    const pub = etapa(fatos({ decisoes: { emMaos: true }, assistida: { ...a, estado: 'APROVADO', videoGerado: true } }))
    assert.equal(pub.acao!.tipo, 'PUBLICAR_VIDEO')
    assert.equal(pub.acao!.evidencia, 'URL')
    assert.match(validarResposta(pub, 'PUBLIQUEI', { url: '' })!, /link/)
    assert.match(validarResposta(pub, 'PUBLIQUEI', { url: 'https://exemplo.com/x' })!, /link/)
    assert.equal(validarResposta(pub, 'PUBLIQUEI', { url: 'https://www.tiktok.com/@x/video/7400000000000000001' }), null)
    assert.match(validarResposta(pub, 'APROVAR')!, /não é uma resposta válida/, 'não dá para responder outra etapa')
  })
  test('fallback: publicação automática FALHOU → publicação assistida na mesma jornada', () => {
    const caps = resolverCapacidades({ ...SEM_API, publicacaoAutomatica: true })
    const a = { id: 'p1', versao: 1, videoGerado: true, geracaoFalhou: false, bloqueio: null, modoDePublicacao: null, publicadoEm: null }
    assert.equal(etapa(fatos({ decisoes: { emMaos: true }, assistida: { ...a, estado: 'APROVADO', erro: null } }), caps).executor, 'API_EXTERNA')
    const f = etapa(fatos({ decisoes: { emMaos: true }, assistida: { ...a, estado: 'FALHOU', erro: 'Erro 500' } }), caps)
    assert.equal(f.acao!.tipo, 'PUBLICAR_VIDEO')
    assert.equal(f.executor, 'HUMANO')
    assert.match(f.acao!.porQueNaoAutomatico, /falhou/)
  })
  test('medição: 48 h de espera do Patrono; depois o mínimo (números); com views registradas → concluída', () => {
    const pub = new Date(HOJE.getTime() - 10 * 3600_000)
    const a = { id: 'p1', versao: 1, estado: 'PUBLICADO', videoGerado: true, geracaoFalhou: false, bloqueio: null, erro: null, modoDePublicacao: 'MANUAL_PELA_TITULAR', publicadoEm: pub }
    const r = { id: 'r1', views: null, vendas: null, comissao: null, publicadoEm: pub }
    assert.equal(etapa(fatos({ decisoes: { emMaos: true }, assistida: a, resultado: r })).espera, 'AGUARDANDO_PATRONO')
    const depois = etapa(fatos({ decisoes: { emMaos: true }, assistida: a, resultado: r }), CAPS, new Date(pub.getTime() + 49 * 3600_000))
    assert.equal(depois.acao!.tipo, 'CONFIRMAR_RESULTADO_MANUAL')
    assert.match(validarResposta(depois, 'INFORMAR', { numeros: { vendas: 1 } })!, /views/)
    assert.equal(validarResposta(depois, 'INFORMAR', { numeros: { views: 1200, vendas: 1, comissao: 9.9 } }), null)
    assert.equal(etapa(fatos({ decisoes: { emMaos: true }, assistida: a, resultado: { ...r, views: 1200 } })).espera, 'CONCLUIDA')
  })
  test('mesmos fatos → mesma etapa (refresh); a chave da etapa muda só quando o fato muda', () => {
    const f = fatos({ decisoes: { vitrine: 'CONFIRMADA' } })
    assert.deepEqual(etapa(f), etapa(f))
    const k1 = chaveDaEtapa(f, etapa(f))
    const f2 = fatos({ decisoes: { vitrine: 'CONFIRMADA' }, amostra: { id: 'a1', estado: 'PENDENTE_APROVACAO', tipo: null, enviadaEm: null, recebidaEm: null } })
    assert.notEqual(k1, chaveDaEtapa(f2, etapa(f2)))
  })
  test('prioridade: prazo crítico vence; depois ação humana; missão influencia; terminal por último', () => {
    const fim = new Date(HOJE.getTime() + 24 * 3600_000)
    const comMissao = etapa(fatos({ candidato: { id: 'm' }, decisoes: { vitrine: 'CONFIRMADA' }, missoes: [{ nome: 'Amostras', tipo: 'SOLICITAR_AMOSTRAS', fim, faltam: 2 }] }))
    const semMissao = etapa(fatos({ candidato: { id: 's' }, decisoes: { vitrine: 'CONFIRMADA' } }))
    const esperando = etapa(fatos({ candidato: { id: 'e' }, decisoes: { vitrine: 'CONFIRMADA' }, amostra: { id: 'a', estado: 'PENDENTE_APROVACAO', tipo: null, enviadaEm: null, recebidaEm: null } }))
    const encerrada = etapa(fatos({ candidato: { id: 't' }, decisoes: { recusada: true } }))
    assert.ok(comMissao.missao && /Amostras/.test(comMissao.missao))
    const ordem = ordenarJornadas([encerrada, esperando, semMissao, comMissao], HOJE).map((e) => e.candidatoId)
    assert.deepEqual(ordem, ['m', 's', 'e', 't'])
  })
  test('determinístico: o motor não importa ML nem banco', () => {
    const fonte = fs.readFileSync('lib/motor-da-jornada.ts', 'utf8')
    assert.doesNotMatch(fonte, /from '\.\/(ml-|prisma|aprendizado)/)
    assert.match(fonte, /import type \{[^}]+\} from '\.\/capacidades-tiktok'/)
  })
  test('o tipo do pedido de escolha usado pela jornada é o mesmo do supervisor', async () => {
    // P2.23: uma fonte só (lib/aprovacoes.ts) — a jornada e o supervisor usam a mesma constante.
    const [{ TIPO_ESCOLHA }, { TIPO_ESCOLHA_DE_PRODUTO }] = await Promise.all([import('../lib/supervisor/ciclo'), import('../lib/aprovacoes')])
    assert.equal(TIPO_ESCOLHA, TIPO_ESCOLHA_DE_PRODUTO)
    assert.ok(fs.readFileSync('lib/jornada.ts', 'utf8').includes('TIPO_DA_ESCOLHA = TIPO_ESCOLHA_DE_PRODUTO'))
  })
  test('eventos → decisões (estado nunca depende só de um campo status)', () => {
    const d = decisoesDosEventos([{ tipo: 'JOURNEY_STARTED', payload: {} }, { tipo: 'PRODUCT_IN_HAND', payload: {} }, { tipo: 'SHOWCASE_CONFIRMED', payload: {} }])
    assert.deepEqual([d.iniciada, d.emMaos, d.vitrine], [true, true, 'CONFIRMADA'])
  })
})

// ── Jornada única no banco de TESTE (cenários A–G) ──────────────────────

describe('jornada única (banco de TESTE)', { skip: !TEM_BANCO ? 'exige banco de TESTE' : false, timeout: 900_000 }, () => {
  let prisma: typeof import('../lib/prisma').prisma
  let J: typeof import('../lib/jornada')
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  const PREFIXO = 'Conta de Teste — '
  const marca = `r96-${Date.now()}`
  const workspaces: string[] = []
  const usuarios: Record<string, string> = {}

  async function novoWorkspace(nome: string) {
    const ws = (await prisma.workspace.create({ data: { name: `${PREFIXO}${nome} r96`, ownerId: `${marca}-${nome}` }, select: { id: true } })).id
    workspaces.push(ws)
    usuarios[ws] = (await prisma.user.create({ data: { email: `${marca}-${workspaces.length}@teste.local`, name: 'U', password: 'x', workspaceId: ws }, select: { id: true } })).id
    return ws
  }
  async function candidato(ws: string, nome: string, extra: Record<string, unknown> = {}) {
    const n = String(Date.now()).slice(-6) + Math.floor(Math.random() * 1000)
    return (await prisma.candidatoDeProduto.create({
      data: {
        // P2.22: dados de um produto bom (comissão e demanda conhecidas): o fluxo da amostra só abre com decisão favorável do SampleOpportunityScore.
        workspaceId: ws, chaveDeOrigem: `${marca}-${nome}-${n}`, fonte: 'USER_PROVIDED', nome: `FIXTURE ${nome}`, categoria: 'Moda', preco: 99.9, comissaoValor: 12, vendas: 1500, providerId: 'tiktok-shop', externalId: `9000000096${n}`,
        linkProduto: `https://www.tiktok.com/view/product/9000000096${n}`, score: 60, baseDeEvidencia: 60, confianca: 'SEM_HISTORICO_REAL', status: 'APRESENTADO', coletadoEm: new Date(), validoAte: new Date('2027-01-01'),
        motivosPositivos: ['Vende bem no app'], riscos: [], desconhecidos: [], porqueDestaPosicao: [], nivelDeRisco: 'BAIXO', ...extra,
      },
      select: { id: true },
    })).id
  }
  const visao = async (ws: string, agora = new Date()) => J.visaoDaOperacao(await J.sincronizarOperacao({ workspaceId: ws, userId: usuarios[ws], agora }))
  const responder = (ws: string, candidatoId: string, resposta: string, extra: Partial<import('../lib/jornada').RespostaDaTitular> = {}) =>
    J.responderNaJornada({ workspaceId: ws, userId: usuarios[ws], candidatoId, resposta, ...extra }).then(J.visaoDaOperacao)

  before(async () => {
    ;[{ prisma }, J, { limparWorkspaceDeTeste: limpar }] = await Promise.all([import('../lib/prisma'), import('../lib/jornada'), import('./_limpar-workspace-de-teste')])
  })
  after(async () => {
    if (prisma) {
      await prisma.domainEvent.deleteMany({ where: { workspaceId: { in: workspaces } } }).catch(() => null)
      await prisma.decisionRecord.deleteMany({ where: { workspaceId: { in: workspaces } } }).catch(() => null)
      for (const w of workspaces) await limpar(prisma, w, PREFIXO)
    }
    await prisma?.$disconnect()
  })

  test('B. com amostra: aprovar → vitrine → pedir amostra → pendente → aprovada → enviada → chegou → conteúdo', async () => {
    const ws = await novoWorkspace('amostra')
    const c = await candidato(ws, 'Bolsa', {})
    let v = await visao(ws)
    assert.equal(v.prioritaria!.candidatoId, c)
    assert.equal(v.prioritaria!.proposta, true, 'o Patrono trouxe o produto sozinho')
    assert.equal(v.prioritaria!.acao!.tipo, 'APROVAR_PRODUTO')
    v = await responder(ws, c, 'APROVAR')
    assert.equal(v.prioritaria!.acao!.tipo, 'ADICIONAR_VITRINE', 'a próxima etapa aparece na MESMA resposta')
    v = await responder(ws, c, 'FEITO')
    assert.equal(v.prioritaria!.acao!.tipo, 'PEDIR_AMOSTRA')
    v = await responder(ws, c, 'PEDIDO_FEITO')
    assert.equal(v.prioritaria!.espera, 'AGUARDANDO_LOJISTA')
    assert.equal(v.prioritaria!.acao, null)
    const am = await prisma.amostraTikTokShop.findFirstOrThrow({ where: { workspaceId: ws } })
    assert.equal(am.estado, 'PENDENTE_APROVACAO')
    for (const [r, esperado] of [['AMOSTRA_APROVADA', 'AGUARDANDO_LOJISTA'], ['AMOSTRA_ENVIADA', 'AGUARDANDO_ENTREGA']] as const) {
      v = await responder(ws, c, r)
      assert.equal(v.prioritaria!.espera, esperado, r)
    }
    v = await responder(ws, c, 'AMOSTRA_RECEBIDA')
    // Chegou: o Patrono já preparou o conteúdo (roteiro + "O que gravar").
    assert.equal((v.prioritaria!.acao as { tipo: string } | null)?.tipo, 'FORNECER_MIDIA_REAL', JSON.stringify(v.prioritaria).slice(0, 300))
    const evs = await prisma.domainEvent.findMany({ where: { workspaceId: ws, entidadeId: c }, select: { tipo: true, payload: true } })
    assert.ok(evs.some((e) => e.tipo === 'SHOWCASE_CONFIRMED' && (e.payload as { origem: string }).origem === 'USER_CONFIRMED'), 'vitrine confirmada pela titular, nunca "API"')
    assert.equal(await prisma.vitrineTikTokShop.count({ where: { workspaceId: ws } }), 0, 'a tabela oficial da vitrine (só API) não é tocada')
    assert.ok(evs.some((e) => e.tipo === 'JOURNEY_STEP_CHANGED'), 'transições registradas como eventos')
    const decisao = await prisma.decisionRecord.findFirst({ where: { workspaceId: ws, entidadeId: c, tipo: 'JORNADA_PRODUTO_ESCOLHIDO' } })
    assert.ok(decisao && (decisao.entradas as { fatores: string[] }).fatores.length > 0, 'motivo da escolha persistido')
  })

  test('C. rejeição: "não quero" encerra a jornada e o Patrono traz o PRÓXIMO produto', async () => {
    const ws = await novoWorkspace('rejeicao')
    const primeiro = await candidato(ws, 'Primeiro', { score: 90, baseDeEvidencia: 90 })
    const segundo = await candidato(ws, 'Segundo', { score: 40, baseDeEvidencia: 40 })
    let v = await visao(ws)
    assert.equal(v.prioritaria!.candidatoId, primeiro)
    v = await responder(ws, primeiro, 'NAO_QUERO')
    assert.equal(v.prioritaria!.candidatoId, segundo, 'o próximo aparece sem ninguém pedir')
    assert.equal((await prisma.candidatoDeProduto.findUniqueOrThrow({ where: { id: primeiro } })).status, 'DESCARTADO')
    v = await visao(ws)
    assert.notEqual(v.prioritaria!.candidatoId, primeiro, 'produto recusado não volta')
  })

  test('D. amostra rejeitada pelo vendedor: a jornada não trava (encerra e o próximo vem)', async () => {
    const ws = await novoWorkspace('amostra-rejeitada')
    const c = await candidato(ws, 'Rejeitada', { score: 90, baseDeEvidencia: 90 })
    const outro = await candidato(ws, 'Outro', { score: 30, baseDeEvidencia: 30 })
    await responder(ws, (await visao(ws)).prioritaria!.candidatoId, 'APROVAR')
    await responder(ws, c, 'FEITO')
    await responder(ws, c, 'PEDIDO_FEITO')
    const v = await responder(ws, c, 'AMOSTRA_REJEITADA')
    assert.equal(v.prioritaria!.candidatoId, outro)
    assert.ok(await prisma.domainEvent.findFirst({ where: { workspaceId: ws, entidadeId: c, tipo: 'JOURNEY_CLOSED' } }))
  })

  test('E/F. refresh volta à MESMA etapa; duplo clique (inclusive simultâneo) não duplica amostra nem evento', async () => {
    const ws = await novoWorkspace('idempotencia')
    const c = await candidato(ws, 'Duplo')
    await visao(ws)
    await responder(ws, c, 'APROVAR')
    await responder(ws, c, 'FEITO')
    const a1 = await visao(ws)
    const a2 = await visao(ws)
    assert.deepEqual([a1.prioritaria!.etapa, a1.prioritaria!.acao!.tipo], [a2.prioritaria!.etapa, a2.prioritaria!.acao!.tipo], 'refresh')
    const eventosAntes = await prisma.domainEvent.count({ where: { workspaceId: ws } })
    await visao(ws)
    assert.equal(await prisma.domainEvent.count({ where: { workspaceId: ws } }), eventosAntes, 'sincronizar de novo não grava nada')
    const r = await Promise.allSettled([responder(ws, c, 'PEDIDO_FEITO'), responder(ws, c, 'PEDIDO_FEITO')])
    assert.ok(r.some((x) => x.status === 'fulfilled'))
    assert.equal(await prisma.amostraTikTokShop.count({ where: { workspaceId: ws } }), 1, 'uma amostra só')
    assert.equal(await prisma.domainEvent.count({ where: { workspaceId: ws, tipo: 'SAMPLE_REQUESTED' } }), 1)
    await assert.rejects(responder(ws, c, 'PEDIDO_FEITO'), /Nenhuma ação sua|não é uma resposta válida/, 'terceiro clique: etapa já mudou')
  })

  test('G. nenhuma ação humana: "Patrono trabalhando" com o que espera e o próximo marco', async () => {
    const ws = await novoWorkspace('trabalhando')
    const c = await candidato(ws, 'Esperando')
    await visao(ws)
    await responder(ws, c, 'APROVAR')
    await responder(ws, c, 'FEITO')
    const v = await responder(ws, c, 'PEDIDO_FEITO')
    assert.equal(v.nenhumaAcaoSua, true)
    assert.equal(v.prioritaria!.espera, 'AGUARDANDO_LOJISTA')
    assert.ok(v.prioritaria!.aguardando && v.prioritaria!.proximoMarco)
  })

  test('onboarding impossível: o pedido "Liberar a descoberta" sai da fila e o supervisor não o recria', async () => {
    const ws = await novoWorkspace('onboarding')
    const { CHAVE_TIKTOK_SHOP } = await import('../lib/tiktok-shop-evidencia')
    const { TIPO_EXCECAO } = await import('../lib/supervisor/ciclo')
    const pedido = await prisma.approvalRequest.create({ data: { workspaceId: ws, tipo: TIPO_EXCECAO, chave: CHAVE_TIKTOK_SHOP, titulo: 'Liberar a descoberta automática no TikTok Shop', resumo: 'x', porque: [], status: 'PENDENTE', risco: 'BAIXO', acaoProposta: {} } as never })
    const { listarPrecisaDeVoce } = await import('../lib/precisa-de-voce')
    const itens = await listarPrecisaDeVoce(ws)
    assert.ok(!itens.some((i) => /Liberar a descoberta/.test(i.titulo)))
    const depois = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: (pedido as { id: string }).id } })
    assert.equal(depois.status, 'CANCELADA')
    assert.match(depois.motivoDaDecisao ?? '', /elegibilidade/)
    const { diagnosticar } = await import('../lib/supervisor/ciclo')
    assert.equal(diagnosticar({ agora: HOJE, integracoes: [], produtosAtivos: 1, informadosAbertos: 0, tiktokShopPendente: false }).length, 0)
  })

  test('A. PRODUTO EM MÃOS (happy path nº 1): aprovar "já tenho" → o que gravar → 4 mídias → render real → QG → aprovar → pronto para publicar → link → medindo → resultado', { skip: !TEM_STORAGE ? 'exige storage de TESTE' : false }, async () => {
    const ws = await novoWorkspace('em-maos')
    const c = await candidato(ws, 'Garrafa térmica 500 ml', { categoria: 'Casa e Cozinha', comissaoValor: 5.99 })
    const { createClient } = await import('@supabase/supabase-js')
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const pasta = mkdtempSync(path.join(tmpdir(), 'r96-'))
    const subidos: { bucket: string; caminho: string }[] = []
    try {
      let v = await visao(ws)
      v = await responder(ws, c, 'TENHO_EM_MAOS')
      const j = v.prioritaria!
      assert.equal(j.acao!.tipo, 'FORNECER_MIDIA_REAL', 'já tenho → direto ao "O que gravar" (sem vitrine e sem amostra)')
      assert.deepEqual(j.progresso.filter((p) => p.situacao === 'PULADO').map((p) => p.passo), ['Vitrine', 'Amostra', 'Recebimento'])
      const cenas = (j.assistida!.apresentacao as { cenasParaGravar: string[] }).cenasParaGravar
      assert.ok(cenas.length >= 4 && /3 a 10 arquivos/.test(cenas.join(' ')))
      assert.equal(await prisma.amostraTikTokShop.count({ where: { workspaceId: ws } }), 0)

      // Upload em lote (4 mídias SINTÉTICAS, FIXTURE) pela mesma porta da tela (registrar + avançar o vídeo).
      const ff = (await import('ffmpeg-static')).default as unknown as string
      const M = await import('../lib/midia-do-produto')
      const A = await import('../lib/publicacao-assistida')
      const subir = async (bucket: string, arquivo: string, tipo: string) => {
        const caminho = `testes/r96/${marca}/${path.basename(arquivo)}`
        const { error } = await sb.storage.from(bucket).upload(caminho, readFileSync(arquivo), { contentType: tipo, upsert: true })
        if (error) throw error
        subidos.push({ bucket, caminho })
        return sb.storage.from(bucket).getPublicUrl(caminho).data.publicUrl
      }
      const midias: { url: string; tipo: 'IMAGEM' | 'VIDEO' }[] = []
      for (const [i, cor] of ['0x6a1b9a', '0x00838f', '0xef6c00'].entries()) {
        const f = path.join(pasta, `foto-${i}.jpg`)
        execFileSync(ff, ['-f', 'lavfi', '-i', `color=c=${cor}:s=1080x1350`, '-frames:v', '1', '-y', f], { stdio: 'ignore' })
        midias.push({ url: await subir('imagens', f, 'image/jpeg'), tipo: 'IMAGEM' })
      }
      const vid = path.join(pasta, 'video.mp4')
      execFileSync(ff, ['-f', 'lavfi', '-i', 'testsrc=size=720x1280:rate=30', '-t', '4', '-pix_fmt', 'yuv420p', '-y', vid], { stdio: 'ignore' })
      midias.push({ url: await subir('videos', vid, 'video/mp4'), tipo: 'VIDEO' })
      for (const [i, m] of midias.entries()) {
        const r = await M.registrarMidia({ workspaceId: ws, candidatoId: c, nomeProduto: 'FIXTURE Garrafa térmica 500 ml', declaracao: { url: m.url, tipo: m.tipo, origem: 'PROPRIO', titularidade: 'Titular da conta (eu)', direitoDeUso: 'Uso nas minhas redes', declaradoPor: usuarios[ws], declaradoEm: new Date(), descricao: `FIXTURE ${i + 1}/4`, declaracoes: m.tipo === 'VIDEO' ? { gravadoPelaPropriaDona: true, semMusicaDeTerceiros: true, semTerceirosNemCriancas: true } : null } })
        assert.equal(r.status, 'AUTORIZADA', r.motivoStatus ?? '')
      }
      await A.avancarVideo(await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id: j.assistida!.id } }))
      v = await visao(ws)
      assert.equal(v.prioritaria!.acao?.tipo, 'APROVAR_VIDEO', `render real → QG → aprovar (${v.prioritaria!.titulo})`)
      const ap = v.prioritaria!.assistida!
      const qg = ap.qualityGate as { veredito: string; arquivo: { largura: number; altura: number; duracaoS: number } }
      assert.equal(qg.veredito, 'APROVADO')
      assert.deepEqual([qg.arquivo.largura, qg.arquivo.altura], [1080, 1920])
      assert.ok(qg.arquivo.duracaoS > 3)
      const mp4 = (ap.apresentacao as { video: { arquivo: string } }).video.arquivo
      assert.equal((await fetch(mp4, { method: 'HEAD' })).status, 200, 'o MP4 existe de verdade')

      // Refazer (ajuste) não destrói as mídias.
      await A.pedirAjuste({ workspaceId: ws, userId: usuarios[ws], id: ap.id, motivo: 'Gancho mais direto', alteracoes: { gancho: 'Olha essa garrafa' } })
      assert.equal(await prisma.midiaDoProduto.count({ where: { workspaceId: ws, status: 'AUTORIZADA' } }), 4)
      v = await visao(ws)
      assert.equal(v.prioritaria!.acao?.tipo, 'APROVAR_VIDEO')

      await A.aprovarEPublicar({ workspaceId: ws, userId: usuarios[ws], id: ap.id })
      v = await visao(ws)
      const pub = v.prioritaria!
      assert.equal(pub.acao!.tipo, 'PUBLICAR_VIDEO', 'PRONTO PARA PUBLICAR (assistido, nada é publicado de verdade)')
      assert.equal(pub.executor, 'HUMANO')
      assert.equal(pub.acao!.linkExterno!.url, 'https://www.tiktok.com/upload')
      const final = (pub.assistida!.versaoFinal ?? (pub.assistida!.apresentacao as { versao: unknown }).versao) as { legenda: string; hashtags: string[]; cta: string; disclosure: string }
      assert.ok(final.legenda && final.hashtags.length && final.cta && final.disclosure, 'pacote completo: legenda, hashtags, CTA, aviso de afiliada')
      await assert.rejects(responder(ws, c, 'PUBLIQUEI', { url: 'nao-e-link' }), /link do vídeo/)
      v = await responder(ws, c, 'PUBLIQUEI', { url: 'https://www.tiktok.com/@fixture/video/7400000000000000961' })
      assert.equal(v.prioritaria?.candidatoId === c ? v.prioritaria.etapa : 'MEDINDO', 'MEDINDO')
      const depois = J.visaoDaOperacao(await J.carregarOperacao(ws, new Date(Date.now() + 49 * 3600_000)))
      const medir = [depois.prioritaria, ...depois.outras].find((x) => x?.candidatoId === c)
      assert.ok(medir)
      const ctx = await J.carregarOperacao(ws, new Date(Date.now() + 49 * 3600_000))
      assert.equal(ctx.jornadas.find((x) => x.fatos.candidato.id === c)!.estado.acao?.tipo, 'CONFIRMAR_RESULTADO_MANUAL')
      await J.responderNaJornada({ workspaceId: ws, userId: usuarios[ws], candidatoId: c, resposta: 'INFORMAR', numeros: { views: 1500, vendas: 1, comissao: 5.99 }, agora: new Date(Date.now() + 49 * 3600_000) })
      const fim = await J.carregarOperacao(ws, new Date(Date.now() + 50 * 3600_000))
      assert.equal(fim.jornadas.find((x) => x.fatos.candidato.id === c)!.estado.espera, 'CONCLUIDA', 'aprendizado registrado')
      const linha = await prisma.videoTikTokResultado.findFirstOrThrow({ where: { workspaceId: ws } })
      assert.equal(linha.origemMetricas, 'MANUAL', 'informado pela titular nunca vira "API"')
    } finally {
      for (const s of subidos) await sb.storage.from(s.bucket).remove([s.caminho]).catch(() => null)
      const gerados = await sb.storage.from('videos').list(`assistidas/${ws}`).catch(() => ({ data: [] as { name: string }[] }))
      if (gerados.data?.length) await sb.storage.from('videos').remove(gerados.data.map((x) => `assistidas/${ws}/${x.name}`)).catch(() => null)
      rmSync(pasta, { recursive: true, force: true })
    }
  })
})
