/**
 * P2.20 (parte 2) — REGRA DA PLATAFORMA × ESTADO DA CONTA, contador de quota, bloqueio central
 * (avaliarPermissaoDaAcao), Operação e PLATFORM_RULE_UPDATED.
 *
 * Os 18 cenários obrigatórios (numerados no nome de cada teste). Puros + banco de TESTE.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CATALOGO_DE_REGRAS, diaNoBrasil, type RegraDePlataforma } from '../lib/regras-de-plataforma'
import { avaliarPermissaoDaAcao, chaveDoContador, efeitoDaRegra, estadoVigente, textoDaQuota, tipoDaPublicacao, type EstadoDaConta } from '../lib/permissao-da-acao'
// P2.45: este arquivo testa o fluxo de publicação ANTERIOR aos três controles (técnico, comercial, conformidade).
process.env.PATRONO_TESTE_LEGADO_SEM_TRES_CONTROLES = 'true'

const AGORA = new Date('2026-10-15T12:00:00-03:00')
const PILOTO = 'PROGRAMA_PILOTO_VIDEOS_COMPRAVEIS'
const REGRA = 'VIDEOS_COMPRAVEIS_POR_DIA'
const PROMO = 'PUBLICAR_VIDEO_PROMOCIONAL' as const

const estado = (x: Partial<EstadoDaConta> = {}): EstadoDaConta => ({
  plataforma: 'TIKTOK_SHOP', conta: 'UNKNOWN', programa: PILOTO, participacao: 'PARTICIPA', regiao: 'BR', statusDaConta: 'ATIVA', elegibilidade: 'UNKNOWN',
  regraDaQuota: null, quotaDiaria: null, origem: 'TELA_DO_APP', dataDaFonte: null, verificadaEm: '2026-10-15T10:00:00-03:00', confianca: 'ALTA',
  observacoes: null, revisarEm: null, expiraEm: null, atualizadoEm: null, ...x,
})
/** Regra oficial sintética (o catálogo real não tem quota oficial confirmada — e não se inventa uma). */
const oficial = (x: Partial<RegraDePlataforma> = {}): RegraDePlataforma => ({
  id: 'teste-oficial-5-por-dia', plataforma: 'TIKTOK_SHOP', programa: null, escopo: 'PLATAFORMA', regiao: 'BR', regra: REGRA,
  descricao: 'Regra oficial de teste: 5 vídeos compráveis por dia.', limite: 5, unidade: 'vídeos compráveis por dia', fonte: 'Fonte oficial de teste', referencia: null,
  dataDaFonte: '2026-10-01', verificadaEm: '2026-10-14', vigenciaInicio: '2026-10-01', revisarEm: '2027-04-14', expiraEm: null, confianca: 'ALTA', status: 'CONFIRMADA', ...x,
})
const avaliar = (regras: readonly RegraDePlataforma[], estados: EstadoDaConta[], usado = 0, agora = AGORA, programa = 'PLATAFORMA') =>
  avaliarPermissaoDaAcao({ acao: PROMO, regras, estados, usadoHoje: { [chaveDoContador(REGRA, programa)]: usado }, agora })

describe('P2.20 — bloqueio central (puro)', () => {
  test('1. regra oficial confirmada: limita com fonte, validade, confiança e quota restante', () => {
    const p = avaliar([...CATALOGO_DE_REGRAS, oficial()], [estado({ participacao: 'NAO_PARTICIPA' })], 3)
    assert.equal(p.resultado, 'PERMITIDA'); assert.equal(p.limite, 5); assert.equal(p.quotaRestante, 2)
    assert.equal(p.fonte, 'Fonte oficial de teste'); assert.equal(p.confianca, 'ALTA'); assert.equal(p.regraId, 'teste-oficial-5-por-dia')
    assert.deepEqual(p.validade, { verificadaEm: '2026-10-14', revisarEm: '2027-04-14', expiraEm: null })
    assert.equal(textoDaQuota(p), 'Publicações promocionais hoje: 3/5')
  })
  test('2 e 18. regra NÃO confirmada nunca bloqueia (mesmo com a conta no programa e uso muito acima do número)', () => {
    const p = avaliar(CATALOGO_DE_REGRAS, [estado()], 50, AGORA, PILOTO)
    assert.notEqual(p.resultado, 'BLOQUEADA'); assert.equal(p.resultado, 'PERMITIDA_COM_AVISO'); assert.equal(p.limite, null)
    assert.match(p.motivo, /Limite não confirmado — não bloqueante/)
    for (const usado of [0, 10, 11, 1000]) assert.notEqual(avaliar(CATALOGO_DE_REGRAS, [estado()], usado, AGORA, PILOTO).resultado, 'BLOQUEADA')
  })
  test('3. regra CONFIRMADA de OUTRO programa não vale para esta conta', () => {
    const deOutro = oficial({ id: 'outro-programa', escopo: 'PROGRAMA', programa: 'PROGRAMA_X', limite: 1 })
    const p = avaliar([...CATALOGO_DE_REGRAS, deOutro], [estado({ participacao: 'NAO_PARTICIPA' }), estado({ programa: 'PROGRAMA_X', participacao: 'NAO_PARTICIPA' })], 9)
    assert.equal(p.resultado, 'PERMITIDA'); assert.equal(p.limite, null)
  })
  test('4. conta FORA do programa piloto: a regra do piloto não se aplica (e o efeito diz isso)', () => {
    const fora = [estado({ participacao: 'NAO_PARTICIPA' })]
    const p = avaliar(CATALOGO_DE_REGRAS, fora, 30)
    assert.equal(p.resultado, 'PERMITIDA'); assert.match(p.motivo, /Sem regra da plataforma que limite/)
    const piloto = CATALOGO_DE_REGRAS.find((r) => r.regra === REGRA)!
    assert.match(efeitoDaRegra(piloto, fora, AGORA), /Não se aplica: a conta não está no PROGRAMA_PILOTO/)
  })
  test('5. quota disponível (confirmada no app: 3/dia): 1 usada → PERMITIDA 1/3; 2 usadas → última, com aviso', () => {
    const e = [estado({ regraDaQuota: REGRA, quotaDiaria: 3 })]
    const um = avaliar(CATALOGO_DE_REGRAS, e, 1, AGORA, PILOTO)
    assert.deepEqual([um.resultado, um.limite, um.quotaRestante, um.programaDoContador], ['PERMITIDA', 3, 2, PILOTO])
    assert.match(um.fonte!, /Tela do app TikTok/)
    const dois = avaliar(CATALOGO_DE_REGRAS, e, 2, AGORA, PILOTO)
    assert.equal(dois.resultado, 'PERMITIDA_COM_AVISO'); assert.match(dois.motivo, /Última disponível hoje/)
  })
  test('6. quota atingida → BLOQUEADA "Ação indisponível: quota oficial atingida"', () => {
    const p = avaliar(CATALOGO_DE_REGRAS, [estado({ regraDaQuota: REGRA, quotaDiaria: 3 })], 3, AGORA, PILOTO)
    assert.equal(p.resultado, 'BLOQUEADA'); assert.equal(p.quotaRestante, 0)
    assert.equal(textoDaQuota(p), 'Ação indisponível: quota oficial atingida (3/3 hoje)')
  })
  test('7. regra vencida (expirada ou revisão passada) e estado vencido não bloqueiam', () => {
    assert.notEqual(avaliar([oficial({ expiraEm: '2026-10-10' })], [], 99).resultado, 'BLOQUEADA')
    assert.notEqual(avaliar([oficial({ revisarEm: '2026-10-01' })], [], 99).resultado, 'BLOQUEADA')
    const velho = estado({ regraDaQuota: REGRA, quotaDiaria: 3, verificadaEm: '2026-09-01T10:00:00-03:00' })
    assert.equal(estadoVigente(velho, AGORA), false, 'conferido há mais de 30 dias: precisa conferir de novo')
    const p = avaliar(CATALOGO_DE_REGRAS, [velho], 3, AGORA, PILOTO)
    assert.notEqual(p.resultado, 'BLOQUEADA'); assert.ok(p.avisos.some((a) => /conferido de novo/.test(a)))
  })
  test('8. regra futura (confirmada, vigência ainda não começou) não bloqueia antes; bloqueia a partir do início', () => {
    const futura = oficial({ vigenciaInicio: '2026-11-01' })
    assert.notEqual(avaliar([futura], [estado({ participacao: 'NAO_PARTICIPA' })], 5).resultado, 'BLOQUEADA')
    assert.equal(avaliar([futura], [estado({ participacao: 'NAO_PARTICIPA' })], 5, new Date('2026-11-02T12:00:00-03:00')).resultado, 'BLOQUEADA')
  })
  test('9. regra GLOBAL vale em qualquer região (mesmo com a região da conta desconhecida)', () => {
    const global = oficial({ id: 'global', regiao: 'GLOBAL', limite: 4 })
    assert.equal(avaliar([global], [estado({ participacao: 'NAO_PARTICIPA', regiao: 'UNKNOWN' })], 4).resultado, 'BLOQUEADA')
    assert.equal(avaliar([global], [estado({ participacao: 'NAO_PARTICIPA', regiao: 'GLOBAL' })], 1).limite, 4)
  })
  test('10. regra do BRASIL vale só para conta BR; fora do BR não se aplica; região UNKNOWN → DESCONHECIDA (não bloqueia)', () => {
    assert.equal(avaliar([oficial()], [estado({ participacao: 'NAO_PARTICIPA', regiao: 'BR' })], 5).resultado, 'BLOQUEADA')
    assert.equal(avaliar([oficial()], [estado({ participacao: 'NAO_PARTICIPA', regiao: 'GLOBAL' })], 5).resultado, 'PERMITIDA')
    const d = avaliar([oficial()], [estado({ participacao: 'NAO_PARTICIPA', regiao: 'UNKNOWN' })], 5)
    assert.equal(d.resultado, 'DESCONHECIDA'); assert.match(d.motivo, /região da conta não foi confirmada/)
  })
  test('11. status UNKNOWN: sem estado registrado tudo é desconhecido (nunca 0) e nada bloqueia', () => {
    const p = avaliar(CATALOGO_DE_REGRAS, [], 40)
    assert.equal(p.resultado, 'DESCONHECIDA'); assert.equal(p.limite, null); assert.equal(p.quotaRestante, null)
    assert.match(p.motivo, /Não se sabe se a conta está no PROGRAMA_PILOTO_VIDEOS_COMPRAVEIS/)
    assert.equal(textoDaQuota(p), 'Publicações promocionais hoje: 40 · Limite não confirmado — não bloqueante')
    // Participação UNKNOWN explícita é igual; quota sem origem não vale.
    assert.equal(avaliar(CATALOGO_DE_REGRAS, [estado({ participacao: 'UNKNOWN' })], 40).resultado, 'DESCONHECIDA')
    assert.notEqual(avaliar(CATALOGO_DE_REGRAS, [estado({ origem: 'UNKNOWN', regraDaQuota: REGRA, quotaDiaria: 1 })], 40, AGORA, PILOTO).resultado, 'BLOQUEADA')
  })
  test('conta SUSPENSA confirmada bloqueia; vídeo NORMAL não consome a quota de vídeo comprável', () => {
    assert.equal(avaliar(CATALOGO_DE_REGRAS, [estado({ statusDaConta: 'SUSPENSA' })]).resultado, 'BLOQUEADA')
    const normal = avaliarPermissaoDaAcao({ acao: 'PUBLICAR_VIDEO', regras: [oficial({ limite: 1 })], estados: [], usadoHoje: { [chaveDoContador(REGRA, 'PLATAFORMA')]: 9 }, agora: AGORA })
    assert.equal(normal.resultado, 'PERMITIDA')
    assert.equal(tipoDaPublicacao({ candidatoId: 'c1' }), 'PUBLICAR_VIDEO_PROMOCIONAL'); assert.equal(tipoDaPublicacao({ candidatoId: null, produtoId: null }), 'PUBLICAR_VIDEO')
  })
  test('distingue programa: o contador registra o programa; o limite de um programa só vale para quem está nele; mudar de programa não zera o uso do dia', () => {
    const e = [estado({ regraDaQuota: REGRA, quotaDiaria: 3 })]
    const p = avaliarPermissaoDaAcao({ acao: PROMO, regras: CATALOGO_DE_REGRAS, estados: e, usadoHoje: { [chaveDoContador(REGRA, 'PLATAFORMA')]: 2, [chaveDoContador(REGRA, PILOTO)]: 1 }, agora: AGORA })
    assert.equal(p.programaDoContador, PILOTO); assert.equal(p.usadoHoje, 3, 'os mesmos vídeos, qualquer que seja o programa'); assert.equal(p.resultado, 'BLOQUEADA')
    const fora = avaliarPermissaoDaAcao({ acao: PROMO, regras: CATALOGO_DE_REGRAS, estados: [estado({ participacao: 'NAO_PARTICIPA', regraDaQuota: REGRA, quotaDiaria: 3 })], usadoHoje: { [chaveDoContador(REGRA, PILOTO)]: 3 }, agora: AGORA })
    assert.equal(fora.programaDoContador, 'PLATAFORMA'); assert.equal(fora.resultado, 'PERMITIDA', 'fora do programa, o limite do programa não vale')
  })
  test('13 e 14. timezone Brasil e virada do dia: 23:59 de Brasília ainda é o mesmo dia; 00:00 zera', () => {
    assert.equal(diaNoBrasil(new Date('2026-10-15T23:59:00-03:00')), '2026-10-15', 'em UTC já seria dia 16')
    assert.equal(diaNoBrasil(new Date('2026-10-16T00:00:00-03:00')), '2026-10-16')
    assert.equal(diaNoBrasil(new Date('2026-10-16T02:30:00Z')), '2026-10-15')
    const e = [estado({ regraDaQuota: REGRA, quotaDiaria: 3 })]
    assert.equal(avaliar(CATALOGO_DE_REGRAS, e, 3, new Date('2026-10-15T23:59:00-03:00'), PILOTO).dia, '2026-10-15')
    assert.equal(avaliar(CATALOGO_DE_REGRAS, e, 0, new Date('2026-10-16T00:00:30-03:00'), PILOTO).dia, '2026-10-16')
  })
  test('nenhuma tela implementa regra paralela: a Operação só mostra o que o motor devolve', () => {
    const pagina = readFileSync('app/(dashboard)/operacao/page.tsx', 'utf8')
    assert.ok(!/quotaDiaria|VIDEOS_COMPRAVEIS_POR_DIA|limite\s*[<>]=?/.test(pagina), 'a página não calcula quota')
    const pub = readFileSync('lib/publicacao-assistida.ts', 'utf8')
    const ini = pub.indexOf('export async function publicarAprovada')
    const corpo = pub.slice(ini, pub.indexOf('\nexport ', ini + 10))
    assert.ok(corpo.indexOf('reservarCota(') > 0 && corpo.indexOf('reservarCota(') < corpo.indexOf('distribuirConteudo('), 'reserva a quota ANTES de publicar')
  })
})

const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')
const PREFIXO = 'Conta de Teste — '

describe('P2.20 — contador, evento e Operação (banco de TESTE)', { skip: !TEM_BANCO ? 'exige banco de TESTE' : false, timeout: 600_000 }, () => {
  let prisma: typeof import('../lib/prisma').prisma
  let C: typeof import('../lib/cotas-da-plataforma')
  let J: typeof import('../lib/jornada')
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  const workspaces: string[] = []
  const marca = `r106-${Date.now()}`
  const novoWs = async (nome: string) => {
    const ws = (await prisma.workspace.create({ data: { name: `${PREFIXO}${nome} r106`, ownerId: `${marca}-${nome}` }, select: { id: true } })).id
    workspaces.push(ws)
    return ws
  }
  const confirmarQuota = (ws: string, quota: number, agora = new Date()) =>
    C.salvarEstadoDaConta({ workspaceId: ws, userId: null, agora, dados: { plataforma: 'TIKTOK_SHOP', programa: PILOTO, participacao: 'PARTICIPA', regiao: 'BR', statusDaConta: 'ATIVA', regraDaQuota: REGRA, quotaDiaria: quota, origem: 'TELA_DO_APP' } })

  before(async () => {
    ;[{ prisma }, C, J, { limparWorkspaceDeTeste: limpar }] = await Promise.all([import('../lib/prisma'), import('../lib/cotas-da-plataforma'), import('../lib/jornada'), import('./_limpar-workspace-de-teste')])
  })
  after(async () => {
    if (prisma) for (const w of workspaces) await limpar(prisma, w, PREFIXO)
    await prisma?.$disconnect()
  })

  test('modelo da conta: nada informado = UNKNOWN/null (nunca 0); quota sem origem é recusada; histórico guarda o anterior', async () => {
    const ws = await novoWs('modelo')
    const r = await C.salvarEstadoDaConta({ workspaceId: ws, userId: null, dados: { plataforma: 'TIKTOK_SHOP', programa: PILOTO } })
    assert.deepEqual([r.estado.participacao, r.estado.regiao, r.estado.statusDaConta, r.estado.elegibilidade, r.estado.conta, r.estado.origem, r.estado.quotaDiaria, r.estado.verificadaEm], ['UNKNOWN', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN', null, null])
    await assert.rejects(C.salvarEstadoDaConta({ workspaceId: ws, userId: null, dados: { plataforma: 'TIKTOK_SHOP', programa: PILOTO, regraDaQuota: REGRA, quotaDiaria: 5 } }), /de onde veio a quota/)
    await assert.rejects(C.salvarEstadoDaConta({ workspaceId: ws, userId: null, dados: { plataforma: 'TIKTOK_SHOP', programa: PILOTO, quotaDiaria: 0, origem: 'TELA_DO_APP', regraDaQuota: REGRA } }), /vazio é UNKNOWN, não 0/)
    await confirmarQuota(ws, 4)
    const linha = await prisma.estadoDaContaNaPlataforma.findUniqueOrThrow({ where: { workspaceId_plataforma_programa: { workspaceId: ws, plataforma: 'TIKTOK_SHOP', programa: PILOTO } } })
    assert.equal(linha.quotaDiaria, 4); assert.ok(linha.verificadaEm)
    assert.equal((linha.historico as unknown[]).length, 2)
  })

  test('15. duas (e cinco) ações simultâneas não estouram a quota; repetir a mesma ação não conta duas vezes', async () => {
    const ws = await novoWs('corrida')
    await confirmarQuota(ws, 2)
    const r = await Promise.all([1, 2, 3, 4, 5].map((i) => C.reservarCota({ workspaceId: ws, acao: PROMO, acaoId: `acao-${i}` })))
    assert.equal(r.filter((x) => x.reservou).length, 2)
    assert.ok(r.filter((x) => !x.reservou).every((x) => x.resultado === 'BLOQUEADA'))
    const dia = diaNoBrasil(new Date())
    const cont = await prisma.contadorDeCotaDiaria.findFirstOrThrow({ where: { workspaceId: ws, dia } })
    assert.equal(cont.usado, 2); assert.equal(cont.programa, PILOTO)
    const reservada = r.findIndex((x) => x.reservou) + 1
    const de = await C.reservarCota({ workspaceId: ws, acao: PROMO, acaoId: `acao-${reservada}` })
    assert.equal((await prisma.contadorDeCotaDiaria.findFirstOrThrow({ where: { workspaceId: ws, dia } })).usado, 2, 'idempotente por ação')
    assert.ok(de)
    assert.ok(await prisma.domainEvent.count({ where: { workspaceId: ws, tipo: 'PLATFORM_QUOTA_BLOCKED' } }) >= 1)
  })

  test('16. refresh mantém o contador (outra leitura, mesmo número); liberar devolve a vaga; publicado no app conta mesmo acima do limite', async () => {
    const ws = await novoWs('refresh')
    await confirmarQuota(ws, 2)
    await C.reservarCota({ workspaceId: ws, acao: PROMO, acaoId: 'a1' })
    const p1 = await C.permissaoDaAcao(ws, PROMO)
    const p2 = await C.permissaoDaAcao(ws, PROMO)
    assert.deepEqual([p1.usadoHoje, p1.limite, p2.usadoHoje], [1, 2, 1])
    await C.liberarCota({ workspaceId: ws, acaoId: 'a1' }); await C.liberarCota({ workspaceId: ws, acaoId: 'a1' })
    assert.equal((await C.permissaoDaAcao(ws, PROMO)).usadoHoje, 0, 'liberar duas vezes devolve uma vaga só')
    for (const id of ['b1', 'b2', 'b3']) await C.reservarCota({ workspaceId: ws, acao: PROMO, acaoId: id, jaExecutada: true })
    assert.equal((await C.permissaoDaAcao(ws, PROMO)).usadoHoje, 3, 'o que já aconteceu é registrado, não bloqueado')
    // Vídeo normal não conta.
    await C.reservarCota({ workspaceId: ws, acao: 'PUBLICAR_VIDEO', acaoId: 'n1' })
    assert.equal((await C.permissaoDaAcao(ws, PROMO)).usadoHoje, 3)
  })

  test('14 (banco). virada do dia: o uso de ontem não conta hoje', async () => {
    const ws = await novoWs('virada')
    const ontem = new Date('2026-10-14T23:50:00-03:00')
    await confirmarQuota(ws, 1, ontem)
    await C.reservarCota({ workspaceId: ws, acao: PROMO, acaoId: 'ontem', agora: ontem })
    assert.equal((await C.permissaoDaAcao(ws, PROMO, ontem)).resultado, 'BLOQUEADA')
    const hoje = new Date('2026-10-15T00:05:00-03:00')
    const p = await C.permissaoDaAcao(ws, PROMO, hoje)
    assert.deepEqual([p.dia, p.usadoHoje, p.resultado], ['2026-10-15', 0, 'PERMITIDA_COM_AVISO'])
  })

  test('12. regra muda → PLATFORM_RULE_UPDATED (antes/depois) + recálculo de quota, pendentes e agenda; ação já executada intocada', async () => {
    const ws = await novoWs('mudanca')
    await C.sincronizarRegrasDoCatalogo(ws)
    assert.equal(await prisma.domainEvent.count({ where: { workspaceId: ws, tipo: 'PLATFORM_RULE_UPDATED' } }), 0, 'registrar o catálogo pela 1ª vez não é mudança')
    assert.deepEqual((await C.sincronizarRegrasDoCatalogo(ws)).mudaram, [], 'idempotente')
    const base = { workspaceId: ws, varianteId: 'v', estrutura: 'e', apresentacao: {}, qualityGate: {}, motivoEscolha: 'm', objetivoDoTeste: 'o', metasIds: [] as string[] }
    const publicada = await prisma.publicacaoAssistida.create({ data: { ...base, estado: 'PUBLICADO', nomeProduto: 'Já publicado', candidatoId: 'cand-pub', publicadoEm: new Date() } })
    const pendente = await prisma.publicacaoAssistida.create({ data: { ...base, estado: 'APROVADO', nomeProduto: 'Pendente', candidatoId: 'cand-pend' } })
    const amanha = new Date(Date.now() + 36 * 3600_000)
    for (const n of [1, 2]) await prisma.publicacaoAssistida.create({ data: { ...base, estado: 'AGUARDANDO_APROVACAO', nomeProduto: `Agenda ${n}`, candidatoId: `cand-ag${n}`, horarioPlanejado: amanha } })
    await confirmarQuota(ws, 5)
    await C.reservarCota({ workspaceId: ws, acao: PROMO, acaoId: 'hoje-1', jaExecutada: true })
    const antesPub = await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id: publicada.id } })
    // A regra do piloto muda para OFICIAL (fonte oficial, 1 por dia, plataforma inteira no BR).
    const piloto = CATALOGO_DE_REGRAS.find((r) => r.regra === REGRA)!
    const nova: RegraDePlataforma = { ...piloto, escopo: 'PLATAFORMA', programa: null, limite: 1, status: 'CONFIRMADA', confianca: 'ALTA', fonte: 'Fonte oficial (teste)', verificadaEm: diaNoBrasil(new Date()), revisarEm: '2099-01-01' }
    const r = await C.atualizarRegraDePlataforma({ workspaceId: ws, regra: nova, origem: 'TITULAR' })
    assert.equal(r.mudou, true); assert.equal(r.versao, 2)
    const ev = await prisma.domainEvent.findFirstOrThrow({ where: { workspaceId: ws, tipo: 'PLATFORM_RULE_UPDATED' } })
    const payload = ev.payload as { antes: { limite: number }; depois: { limite: number }; recalculo: { hoje: { resultado: string }; pendentes: { id: string; resultado: string }[]; agenda: { planejadas: number; limite: number; excede: boolean }[] } }
    assert.deepEqual([payload.antes.limite, payload.depois.limite], [10, 1])
    // A regra da conta (5, vista no app) vale mais que a geral? Não: entre confirmadas, a da conta vale mais.
    assert.equal(payload.recalculo.hoje.resultado, 'PERMITIDA', 'a da conta (5) prevalece sobre a geral nova (1)')
    assert.ok(payload.recalculo.pendentes.some((x) => x.id === pendente.id))
    assert.ok(!payload.recalculo.pendentes.some((x) => x.id === publicada.id), 'executada não entra no recálculo')
    // Sem a regra da conta, a geral nova vale e a agenda de amanhã (2 planejadas) excede 1.
    await C.salvarEstadoDaConta({ workspaceId: ws, userId: null, dados: { plataforma: 'TIKTOK_SHOP', programa: PILOTO, participacao: 'NAO_PARTICIPA', regiao: 'BR', origem: 'TELA_DO_APP' } })
    const rec = await C.recalcularRestricoes(ws)
    assert.equal(rec.hoje.resultado, 'BLOQUEADA', '1 já usada hoje, limite oficial 1')
    assert.ok(rec.pendentes.find((x) => x.id === pendente.id)!.resultado === 'BLOQUEADA')
    assert.ok(rec.agenda.some((a) => a.planejadas === 2 && a.limite === 1 && a.excede))
    const depoisPub = await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id: publicada.id } })
    assert.deepEqual([depoisPub.estado, depoisPub.updatedAt.getTime(), JSON.stringify(depoisPub.historico)], [antesPub.estado, antesPub.updatedAt.getTime(), JSON.stringify(antesPub.historico)], 'histórico da executada intocado')
    // O catálogo do código não sobrescreve a versão nova da titular enquanto o próprio catálogo não mudar.
    assert.deepEqual((await C.sincronizarRegrasDoCatalogo(ws)).mudaram, [])
    assert.equal((await C.regrasEfetivas(ws)).find((x) => x.id === piloto.id)!.limite, 1)
  })

  test('17. a Operação mostra o aviso certo: desconhecido → não bloqueante; confirmado → 0/2; esgotado → indisponível', async () => {
    const ws = await novoWs('operacao')
    const texto = async () => J.visaoDaOperacao(await J.carregarOperacao(ws, new Date())).hoje.quota
    const a = await texto()
    assert.equal(a?.resultado, 'DESCONHECIDA'); assert.match(a!.texto, /Limite não confirmado — não bloqueante/)
    await confirmarQuota(ws, 2)
    assert.equal((await texto())?.texto, 'Publicações promocionais hoje: 0/2')
    await C.reservarCota({ workspaceId: ws, acao: PROMO, acaoId: 'o1' }); await C.reservarCota({ workspaceId: ws, acao: PROMO, acaoId: 'o2' })
    const z = await texto()
    assert.equal(z?.resultado, 'BLOQUEADA'); assert.equal(z?.texto, 'Ação indisponível: quota oficial atingida (2/2 hoje)')
  })
})
