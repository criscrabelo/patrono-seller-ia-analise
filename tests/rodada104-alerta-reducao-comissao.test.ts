/**
 * P2.19 — ALERTA DE REDUÇÃO DE COMISSÃO (regra oficial: redução só vale 30 dias depois para produto já
 * adicionado; aumento vale na hora). Trava: data efetiva, contagem regressiva, níveis, impacto só com dado
 * real, "não inventar" (aplicabilidade não confirmada, data observada = teto), idempotência, atualização
 * automática com histórico, correção pela titular. Banco de TESTE.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { calcularAlerta, REGRA_REDUCAO_DE_COMISSAO } from '../lib/alerta-reducao-comissao'

const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')
const DIA = 86_400_000
const ANUNCIO = new Date('2026-10-01T12:00:00-03:00')
const base = { taxaAtual: 12, taxaNova: 8, dataDoAnuncio: ANUNCIO, fonteDoAnuncio: 'INFORMADA_PELA_TITULAR' as const, produtoJaAdicionado: 'SIM' as const }

describe('regra (pura)', () => {
  test('a regra é a oficial, com fonte e data de verificação', () => {
    assert.equal(REGRA_REDUCAO_DE_COMISSAO.dias, 30)
    assert.equal(REGRA_REDUCAO_DE_COMISSAO.status, 'CONFIRMADA')
    assert.match(REGRA_REDUCAO_DE_COMISSAO.fonte, /Seller University/)
  })
  test('data efetiva = anúncio + 30 dias; contagem regressiva e níveis (informativo > 14, aviso ≤ 14, urgente ≤ 7)', () => {
    const a = calcularAlerta({ ...base, agora: new Date(ANUNCIO.getTime() + 10 * DIA) })
    assert.equal(a.status, 'ATIVO'); assert.equal(a.dataEfetiva!.toISOString(), new Date(ANUNCIO.getTime() + 30 * DIA).toISOString())
    assert.equal(a.diasRestantes, 20); assert.equal(a.nivel, 'INFORMATIVO'); assert.equal(a.fonteDataEfetiva, 'CALCULADA_30_DIAS')
    assert.equal(calcularAlerta({ ...base, agora: new Date(ANUNCIO.getTime() + 17 * DIA) }).nivel, 'AVISO')
    const u = calcularAlerta({ ...base, agora: new Date(ANUNCIO.getTime() + 25 * DIA) })
    assert.equal(u.nivel, 'URGENTE'); assert.match(u.mensagem, /Priorize postar/)
    const e = calcularAlerta({ ...base, agora: new Date(ANUNCIO.getTime() + 31 * DIA) })
    assert.equal(e.status, 'EFETIVADO'); assert.equal(e.nivel, null)
  })
  test('aumento não gera alerta (vale na hora); produto não adicionado: a janela não se aplica', () => {
    assert.equal(calcularAlerta({ ...base, taxaNova: 15, agora: ANUNCIO }).status, 'NAO_SE_APLICA')
    const n = calcularAlerta({ ...base, produtoJaAdicionado: 'NAO', agora: ANUNCIO })
    assert.equal(n.status, 'NAO_SE_APLICA'); assert.match(n.mensagem, /só protege quem já adicionou/)
  })
  test('não inventa: adicionado não confirmado → APLICABILIDADE_NAO_CONFIRMADA; data só observada → aviso de que pode valer antes', () => {
    const r = calcularAlerta({ ...base, produtoJaAdicionado: 'NAO_CONFIRMADO', fonteDoAnuncio: 'OBSERVADA_PELO_PATRONO', agora: ANUNCIO })
    assert.equal(r.status, 'APLICABILIDADE_NAO_CONFIRMADA')
    assert.ok(r.avisos.some((x) => /pode valer antes/.test(x)))
    assert.ok(r.avisos.some((x) => /Não está confirmado que você já adicionou/.test(x)))
  })
  test('data que o app mostra (informada) vale mais que a calculada', () => {
    const r = calcularAlerta({ ...base, dataEfetivaInformada: new Date('2026-10-20T00:00:00-03:00'), agora: ANUNCIO })
    assert.equal(r.fonteDataEfetiva, 'INFORMADA_PELA_TITULAR'); assert.equal(r.diasRestantes, 19)
  })
  test('impacto só com dado real: por venda com o preço (avisando se não confirmado) e o observado com pedidos importados', () => {
    const sem = calcularAlerta({ ...base, agora: ANUNCIO })
    assert.equal(sem.impacto.porVenda, null); assert.equal(sem.impacto.observado30Dias, null); assert.equal(sem.impacto.pontosPercentuais, 4)
    const com = calcularAlerta({ ...base, agora: ANUNCIO, preco: 50, precoConfirmado: false, pedidosRecentes: [{ valorBase: 50 }, { valorBase: 100 }, { valorBase: null }] })
    assert.equal(com.impacto.porVenda, 2); assert.equal(com.impacto.baseDoPorVenda, 'PRECO_DE_REFERENCIA')
    assert.deepEqual(com.impacto.observado30Dias, { pedidos: 2, valor: 6 })
    assert.ok(com.avisos.some((x) => /preço de referência/.test(x)))
  })
})

describe('alerta no banco de TESTE', { skip: !TEM_BANCO ? 'exige banco de TESTE' : false, timeout: 600_000 }, () => {
  let prisma: typeof import('../lib/prisma').prisma
  let A: typeof import('../lib/alerta-reducao-comissao')
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  const PREFIXO = 'Conta de Teste — '
  const marca = `r104-${Date.now()}`
  const workspaces: string[] = []
  async function novoWorkspace(nome: string) {
    const ws = (await prisma.workspace.create({ data: { name: `${PREFIXO}${nome} r104`, ownerId: `${marca}-${nome}` }, select: { id: true } })).id
    workspaces.push(ws)
    return ws
  }
  before(async () => { ;[{ prisma }, A, { limparWorkspaceDeTeste: limpar }] = await Promise.all([import('../lib/prisma'), import('../lib/alerta-reducao-comissao'), import('./_limpar-workspace-de-teste')]) })
  after(async () => { if (prisma) for (const w of workspaces) await limpar(prisma, w, PREFIXO); await prisma?.$disconnect() })

  const registrar = (ws: string, extra: Partial<Parameters<typeof A.registrarReducaoDeComissao>[0]> = {}) =>
    A.registrarReducaoDeComissao({ workspaceId: ws, chaveProduto: 'tiktok-shop:900000104001', nomeProduto: 'FIXTURE Livro', taxaAtual: 12, taxaNova: 8, dataDoAnuncio: ANUNCIO, fonteDoAnuncio: 'OBSERVADA_PELO_PATRONO', agora: ANUNCIO, ...extra })

  test('idempotente; aumento não cria; na vitrine confirmada = SIM; atualização automática muda o nível e grava histórico', async () => {
    const ws = await novoWorkspace('alerta')
    await prisma.vitrineTikTokShop.create({ data: { workspaceId: ws, productId: '900000104001', nomeProduto: 'FIXTURE Livro', estado: 'CONFIRMADO_NA_VITRINE' } })
    const a = await registrar(ws)
    const b = await registrar(ws, { dataDoAnuncio: new Date(ANUNCIO.getTime() + DIA), agora: new Date(ANUNCIO.getTime() + DIA) })
    assert.equal(b!.id, a!.id, 'a mesma redução não cria outro alerta')
    assert.equal(await registrar(ws, { taxaNova: 14 }), null, 'aumento não gera alerta')
    assert.equal(a!.produtoJaAdicionado, 'SIM'); assert.equal(a!.status, 'ATIVO'); assert.equal(a!.nivel, 'INFORMATIVO')
    await A.atualizarAlertasDeComissao(ws, new Date(ANUNCIO.getTime() + 25 * DIA))
    let x = await prisma.alertaReducaoComissao.findUniqueOrThrow({ where: { id: a!.id } })
    assert.equal(x.nivel, 'URGENTE')
    await A.atualizarAlertasDeComissao(ws, new Date(ANUNCIO.getTime() + 31 * DIA))
    x = await prisma.alertaReducaoComissao.findUniqueOrThrow({ where: { id: a!.id } })
    assert.equal(x.status, 'EFETIVADO')
    assert.deepEqual((x.historico as { tipo: string; nivel: string | null }[]).map((h) => [h.tipo, h.nivel]), [['CRIADO', 'INFORMATIVO'], ['ATUALIZADO', 'URGENTE'], ['ATUALIZADO', null]])
  })

  test('sem vitrine: aplicabilidade não confirmada; a titular confirma, informa a data do app ou cancela — tudo no histórico', async () => {
    const ws = await novoWorkspace('corrigir')
    const a = await registrar(ws)
    assert.equal(a!.status, 'APLICABILIDADE_NAO_CONFIRMADA')
    const c = await A.corrigirAlerta({ workspaceId: ws, userId: null, id: a!.id, produtoJaAdicionado: 'SIM', dataEfetiva: new Date('2026-10-20T00:00:00-03:00'), agora: ANUNCIO })
    assert.equal(c!.status, 'ATIVO'); assert.equal(c!.fonteDataEfetiva, 'INFORMADA_PELA_TITULAR')
    const d = await A.corrigirAlerta({ workspaceId: ws, userId: null, id: a!.id, cancelar: true, agora: ANUNCIO })
    assert.equal(d!.status, 'CANCELADO')
    assert.deepEqual((d!.historico as { tipo: string }[]).map((h) => h.tipo), ['CRIADO', 'DATA_INFORMADA', 'ADICIONADO_INFORMADO', 'ATUALIZADO', 'CANCELADO_PELA_TITULAR'])
    assert.equal(await A.corrigirAlerta({ workspaceId: 'outro-workspace', userId: null, id: a!.id, cancelar: true }), null, 'outro workspace não mexe')
  })
})
