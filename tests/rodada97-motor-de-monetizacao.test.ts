/**
 * P2.18.7 — Motor de monetização sobre as missões/campanhas que já existiam.
 * Cenário realista (FIXTURE): campanha A até 16/10 (5 vídeos, 2 feitos) e
 * campanha B até 19/10 (10 vídeos, 1 feito), "hoje" = 13/10/2026.
 * Banco de TESTE para "campanha gera jornada"; nada em Production.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { agendaDeMonetizacao, capacidadePorDia, classificarUrgencia, COMISSAO_POR_VENDA, oportunidadesDasMetas, resumirMonetizacao, separarReceita, type MetaParaMonetizacao } from '../lib/monetizacao'

const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')
const HOJE = new Date('2026-10-13T09:00:00-03:00')
const meta = (x: Partial<MetaParaMonetizacao> & Pick<MetaParaMonetizacao, 'id' | 'fim' | 'quantidadeExigida' | 'quantidadeRealizada'>): MetaParaMonetizacao => ({
  nome: x.id, tipo: 'VIDEOS_COM_PRODUTO', inicio: new Date('2026-10-01T00:00:00-03:00'), recompensaValor: null, campanha: null, recompensaCampanha: null, origem: 'MANUAL', ...x,
})
const A = meta({ id: 'A', nome: 'Campanha 16/10', fim: new Date('2026-10-16T23:59:00-03:00'), quantidadeExigida: 5, quantidadeRealizada: 2, recompensaValor: 50 })
const B = meta({ id: 'B', nome: 'Campanha 19/10', fim: new Date('2026-10-19T23:59:00-03:00'), quantidadeExigida: 10, quantidadeRealizada: 1, recompensaValor: 150 })
const SEM_PIPELINE = () => ({ planejado: 0, gerado: 0, aprovado: 0, publicado: 0 })

describe('motor de monetização (funções puras)', () => {
  test('planejamento reverso: faltam ÷ dias operacionais', () => {
    const ops = oportunidadesDasMetas([A, B], SEM_PIPELINE, HOJE, 1)
    const a = ops.find((o) => o.id === 'A')!
    const b = ops.find((o) => o.id === 'B')!
    assert.equal(a.faltam, 3)
    assert.equal(b.faltam, 9)
    assert.equal(a.ritmoNecessario, 0.8, '3 vídeos em 4 dias operacionais')
    assert.equal(b.ritmoNecessario, 1.3, '9 vídeos em 7 dias operacionais')
  })
  test('risco a partir da capacidade REAL: com 1/dia, B (1,3/dia) está EM RISCO e A em atenção; com 3/dia, ambas em dia', () => {
    const lenta = oportunidadesDasMetas([A, B], SEM_PIPELINE, HOJE, 1)
    assert.equal(lenta.find((o) => o.id === 'B')!.urgencia, 'EM_RISCO')
    assert.equal(lenta.find((o) => o.id === 'A')!.urgencia, 'ATENCAO')
    assert.equal(lenta[0].id, 'B', 'a mais arriscada vem primeiro')
    const rapida = oportunidadesDasMetas([A, B], SEM_PIPELINE, HOJE, 3)
    assert.ok(rapida.every((o) => o.urgencia === 'NORMAL'))
  })
  test('crítica no último dia; expirada depois do prazo; concluída não pede nada', () => {
    assert.equal(classificarUrgencia({ faltam: 1, fim: new Date(HOJE.getTime() + 10 * 3600_000), agora: HOJE, capacidadePorDia: 5 }).urgencia, 'CRITICA')
    assert.equal(classificarUrgencia({ faltam: 1, fim: new Date(HOJE.getTime() - 1000), agora: HOJE, capacidadePorDia: 5 }).urgencia, 'EXPIRADA')
    assert.equal(classificarUrgencia({ faltam: 0, fim: new Date(HOJE.getTime() + 86400_000), agora: HOJE, capacidadePorDia: 1 }).urgencia, 'NORMAL')
  })
  test('capacidade nunca inventada: sem histórico é 1/dia rotulado; com histórico é medida', () => {
    assert.deepEqual(capacidadePorDia([], HOJE), { porDia: 1, medida: false })
    const dias = Array.from({ length: 28 }, (_, i) => new Date(HOJE.getTime() - (i % 14) * 86400_000))
    assert.deepEqual(capacidadePorDia(dias, HOJE), { porDia: 2, medida: true })
  })
  test('agenda automática: prazo mais próximo primeiro, respeitando a capacidade; o que não cabe é sinalizado', () => {
    const ops = oportunidadesDasMetas([A, B], SEM_PIPELINE, HOJE, 2)
    const { agenda, naoCabe } = agendaDeMonetizacao(ops, HOJE, 2)
    assert.equal(agenda[0].total, 2)
    assert.equal(agenda[0].itens[0].oportunidade, 'Campanha 16/10', 'A vence antes: entra primeiro')
    assert.equal(agenda.slice(0, 4).flatMap((d) => d.itens).filter((i) => i.oportunidade === 'Campanha 16/10').reduce((s, i) => s + i.videos, 0), 3)
    assert.deepEqual(naoCabe, [], 'com 2/dia as duas cabem até 19/10')
    const lenta = agendaDeMonetizacao(oportunidadesDasMetas([A, B], SEM_PIPELINE, HOJE, 1), HOJE, 1)
    assert.ok(lenta.naoCabe.some((n) => n.oportunidade === 'Campanha 19/10'), 'com 1/dia, B não cabe: crítica, sem inventar capacidade')
  })
  test('progresso só com evidência: vídeo gerado/publicado aqui é pipeline, não conclusão', () => {
    const ops = oportunidadesDasMetas([A], () => ({ planejado: 3, gerado: 3, aprovado: 3, publicado: 3 }), HOJE, 1)
    assert.equal(ops[0].progressoConfirmado, 2)
    assert.equal(ops[0].faltam, 3, 'publicar não reduz o que falta até o app contar')
    assert.match(ops[0].conclusao, /app contar/)
  })
  test('receita separada: confirmada × informada × elegível × em jogo; campanha conta a recompensa UMA vez', () => {
    const c1 = meta({ id: 'c1', fim: B.fim, quantidadeExigida: 5, quantidadeRealizada: 5, campanha: 'Outubro', recompensaCampanha: 200 })
    const c2 = meta({ id: 'c2', fim: B.fim, quantidadeExigida: 5, quantidadeRealizada: 5, campanha: 'Outubro', recompensaCampanha: 200 })
    const r = separarReceita({ metas: [c1, c2, A], comissoesConfirmadas: 0, comissoesInformadas: 11.98, agora: HOJE })
    assert.deepEqual(r, { confirmada: 0, informada: 11.98, recompensaElegivel: 200, recompensaEmJogo: 50 })
  })
  test('venda normal continua mesmo sem campanha (e mesmo com campanha expirada)', () => {
    const r = resumirMonetizacao({ metas: [meta({ id: 'X', fim: new Date('2026-10-01'), quantidadeExigida: 3, quantidadeRealizada: 0 })], pipeline: SEM_PIPELINE, publicacoesRecentes: [], comissoesConfirmadas: 0, comissoesInformadas: 0, agora: HOJE })
    assert.equal(r.ativas, 0)
    assert.ok(r.oportunidades.includes(COMISSAO_POR_VENDA))
    assert.equal(r.oportunidades.find((o) => o.id === 'X')!.urgencia, 'EXPIRADA')
  })
  test('cenário realista: quantos vídeos faltam, o que vem primeiro e quanto entra hoje', () => {
    const r = resumirMonetizacao({ metas: [A, B], pipeline: SEM_PIPELINE, publicacoesRecentes: [], comissoesConfirmadas: 0, comissoesInformadas: 0, agora: HOJE })
    assert.equal(r.ativas, 2)
    assert.equal(r.prazoMaisProximo!.titulo, 'Campanha 16/10')
    assert.equal(r.videosEmRisco, 9, 'B em risco com o ritmo conservador')
    assert.equal(r.videosNecessariosHoje, 1, 'capacidade conservadora: 1 hoje (da campanha mais próxima)')
    assert.equal(r.receita.recompensaEmJogo, 200)
    assert.equal(r.receita.confirmada, 0, 'potencial nunca vira receita confirmada')
  })
})

describe('campanha gera jornada e um vídeo conta para várias metas (banco de TESTE)', { skip: !TEM_BANCO ? 'exige banco de TESTE' : false, timeout: 300_000 }, () => {
  let prisma: typeof import('../lib/prisma').prisma
  let J: typeof import('../lib/jornada')
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  const PREFIXO = 'Conta de Teste — '
  const marca = `r97-${Date.now()}`
  let ws = ''
  let user = ''
  const cand = async (nome: string, score: number) => (await prisma.candidatoDeProduto.create({ data: {
    workspaceId: ws, chaveDeOrigem: `${marca}-${nome}`, fonte: 'USER_PROVIDED', nome: `FIXTURE ${nome}`, categoria: 'Moda', preco: 89.9, providerId: 'tiktok-shop', externalId: `9000000097${score}`, linkProduto: `https://www.tiktok.com/view/product/9000000097${score}`,
    score, baseDeEvidencia: score, confianca: 'SEM_HISTORICO_REAL', status: 'APRESENTADO', coletadoEm: new Date(), validoAte: new Date('2027-01-01'), motivosPositivos: [], riscos: [], desconhecidos: [], porqueDestaPosicao: [], nivelDeRisco: 'BAIXO',
  }, select: { id: true } })).id

  before(async () => {
    ;[{ prisma }, J, { limparWorkspaceDeTeste: limpar }] = await Promise.all([import('../lib/prisma'), import('../lib/jornada'), import('./_limpar-workspace-de-teste')])
    ws = (await prisma.workspace.create({ data: { name: `${PREFIXO}campanhas r97`, ownerId: marca }, select: { id: true } })).id
    user = (await prisma.user.create({ data: { email: `${marca}@teste.local`, name: 'U', password: 'x', workspaceId: ws }, select: { id: true } })).id
    const agora = new Date()
    for (const [nome, dias, exig, feitos, valor] of [['FIXTURE Campanha A', 3, 5, 2, 50], ['FIXTURE Campanha B', 6, 10, 1, 150]] as const) {
      await prisma.metaTikTokShop.create({ data: { workspaceId: ws, nome, tipo: 'VIDEOS_COM_PRODUTO', inicio: new Date(agora.getTime() - 5 * 86400_000), fim: new Date(agora.getTime() + dias * 86400_000), quantidadeExigida: exig, quantidadeRealizada: feitos, recompensaValor: valor, origem: 'MANUAL' } })
    }
  })
  after(async () => {
    if (prisma) {
      await prisma.domainEvent.deleteMany({ where: { workspaceId: ws } }).catch(() => null)
      await prisma.decisionRecord.deleteMany({ where: { workspaceId: ws } }).catch(() => null)
      await limpar(prisma, ws, PREFIXO)
    }
    await prisma?.$disconnect()
  })

  test('campanha em risco traz o próximo produto MESMO com outra ação pendente; a ação mostra a missão; o bloco HOJE separa o dinheiro', async () => {
    const p1 = await cand('Primeiro', 80)
    const p2 = await cand('Segundo', 60)
    let v = J.visaoDaOperacao(await J.sincronizarOperacao({ workspaceId: ws, userId: user }))
    assert.equal(v.prioritaria!.candidatoId, p1)
    // Aprovar o 1º leva a vitrine (ação humana pendente). Mesmo assim, como a campanha está em risco, o 2º já é trazido.
    v = J.visaoDaOperacao(await J.responderNaJornada({ workspaceId: ws, userId: user, candidatoId: p1, resposta: 'APROVAR' }))
    const ids = [v.prioritaria!.candidatoId, ...v.outras.map((o) => o.candidatoId)]
    assert.ok(ids.includes(p2), 'campanha gera jornada: o Patrono trouxe mais um produto')
    assert.equal(v.hoje.campanhasAtivas, 2)
    assert.equal(v.hoje.receita.confirmada, 0)
    assert.equal(v.hoje.receita.recompensaEmJogo, 200)
    assert.ok(v.hoje.campanhas.some((c) => c.urgencia === 'EM_RISCO' || c.urgencia === 'CRITICA'))
  })

  test('um vídeo pode cumprir várias metas (sem duplicar o vídeo): a publicação guarda as duas metas', async () => {
    const p3 = await cand('Em maos', 70)
    const A = await import('../lib/publicacao-assistida')
    const a = await A.prepararProximaPublicacao({ workspaceId: ws, userId: user, candidatoEmMaos: p3 })
    const metas = await prisma.metaTikTokShop.findMany({ where: { workspaceId: ws }, select: { id: true } })
    assert.deepEqual([...a.metasIds].sort(), metas.map((m) => m.id).sort(), 'UM vídeo vinculado às DUAS campanhas')
    assert.equal(await prisma.publicacaoAssistida.count({ where: { workspaceId: ws, candidatoId: p3 } }), 1)
  })
})
