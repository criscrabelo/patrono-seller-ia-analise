/**
 * P2.18 — Plano B: "tenho este produto em mãos". A titular declara a posse;
 * o Patrono prepara o vídeo DESTE produto sem esperar amostra, passando na
 * frente de publicação que só espera mídia de outro produto. Banco de TESTE.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')
const AGORA = new Date('2026-10-13T15:00:00-03:00')

describe('produto em mãos (banco de TESTE)', { skip: !TEM_BANCO ? 'exige banco de TESTE' : false }, () => {
  let prisma: typeof import('../lib/prisma').prisma
  let A: typeof import('../lib/publicacao-assistida')
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  const PREFIXO = 'Conta de Teste — '
  const marca = `r92-${Date.now()}`
  const workspaces: string[] = []
  let ws = ''
  let user = ''
  const ids: Record<string, string> = {}

  async function candidato(workspaceId: string, chave: string, nome: string, score: number, extra: Record<string, unknown> = {}) {
    return (await prisma.candidatoDeProduto.create({
      data: {
        workspaceId, chaveDeOrigem: `${marca}-${chave}`, fonte: 'USER_PROVIDED', nome, categoria: 'Casa e Decoração', preco: 49.9, providerId: 'tiktok-shop', externalId: `9000000000000${String(score).padStart(5, '0')}`,
        score, baseDeEvidencia: score, confianca: 'SEM_HISTORICO_REAL', status: 'APRESENTADO', coletadoEm: AGORA, validoAte: new Date('2027-01-01'), motivosPositivos: [], riscos: [], desconhecidos: [], porqueDestaPosicao: [], nivelDeRisco: 'BAIXO',
        ...extra,
      },
      select: { id: true },
    })).id
  }

  before(async () => {
    ;[{ prisma }, A, { limparWorkspaceDeTeste: limpar }] = await Promise.all([import('../lib/prisma'), import('../lib/publicacao-assistida'), import('./_limpar-workspace-de-teste')])
    ws = (await prisma.workspace.create({ data: { name: `${PREFIXO}produto em mãos`, ownerId: marca }, select: { id: true } })).id
    workspaces.push(ws)
    user = (await prisma.user.create({ data: { email: `${marca}@teste.local`, name: 'U', password: 'x', workspaceId: ws }, select: { id: true } })).id
    ids.arvore = await candidato(ws, 'arvore', 'FIXTURE Árvore de Natal sem mídia', 90)
    ids.garrafa = await candidato(ws, 'garrafa', 'FIXTURE Garrafa térmica que a titular tem', 40)
    ids.bloqueado = await candidato(ws, 'bloq', 'FIXTURE Produto com compliance bloqueante', 30, { complianceBloqueante: true })
    const outro = (await prisma.workspace.create({ data: { name: `${PREFIXO}outro r92`, ownerId: `${marca}-b` }, select: { id: true } })).id
    workspaces.push(outro)
    ids.deOutro = await candidato(outro, 'outro', 'FIXTURE Produto de outro workspace', 50)
  })
  after(async () => {
    for (const w of workspaces) await limpar(prisma, w, PREFIXO)
    await prisma?.$disconnect()
  })

  let arvoreId = ''
  let garrafaId = ''
  test('sem declaração, o Patrono segue o ranking (Árvore) e fica esperando mídia', async () => {
    const a = await A.prepararProximaPublicacao({ workspaceId: ws, userId: user, agora: AGORA })
    assert.match(a.nomeProduto, /Árvore/)
    assert.equal(a.estado, 'AGUARDANDO_MIDIA')
    arvoreId = a.id
  })

  test('"tenho em mãos" passa na frente da publicação que só espera mídia de outro produto', async () => {
    const g = await A.prepararProximaPublicacao({ workspaceId: ws, userId: user, agora: AGORA, candidatoEmMaos: ids.garrafa })
    assert.notEqual(g.id, arvoreId)
    assert.match(g.nomeProduto, /Garrafa/)
    assert.match(g.motivoEscolha, /em mãos/)
    const hist = g.historico as { acao: string }[]
    assert.equal(hist[0].acao, 'PRODUTO_EM_MAOS', 'a declaração da titular fica registrada')
    assert.ok(hist.some((h) => h.acao === 'QUALITY_GATE'), 'o roteiro passou pela checagem de qualidade')
    garrafaId = g.id
  })

  test('repetir a declaração não duplica: devolve a mesma publicação', async () => {
    const g2 = await A.prepararProximaPublicacao({ workspaceId: ws, userId: user, agora: AGORA, candidatoEmMaos: ids.garrafa })
    assert.equal(g2.id, garrafaId)
    assert.equal(await prisma.publicacaoAssistida.count({ where: { workspaceId: ws, candidatoId: ids.garrafa } }), 1)
  })

  test('não passa por cima de vídeo já pronto para aprovação', async () => {
    await prisma.publicacaoAssistida.update({ where: { id: garrafaId }, data: { estado: 'AGUARDANDO_APROVACAO' } })
    await assert.rejects(A.prepararProximaPublicacao({ workspaceId: ws, userId: user, agora: AGORA, candidatoEmMaos: ids.arvore }), (e: { status?: number; message: string }) => e.status === 409 && /em andamento/.test(e.message))
  })

  test('compliance bloqueante e produto de outro workspace são recusados', async () => {
    await prisma.publicacaoAssistida.update({ where: { id: garrafaId }, data: { estado: 'REJEITADO' } })
    await assert.rejects(A.prepararProximaPublicacao({ workspaceId: ws, userId: user, agora: AGORA, candidatoEmMaos: ids.bloqueado }), (e: { status?: number }) => e.status === 409)
    await assert.rejects(A.prepararProximaPublicacao({ workspaceId: ws, userId: user, agora: AGORA, candidatoEmMaos: ids.deOutro }), (e: { status?: number }) => e.status === 404)
  })
})

describe('P2.18 — plano das missões (função pura)', () => {
  const FIM = new Date('2026-10-20T23:59:00-03:00')
  const metas = [
    { id: 'p', nome: 'Produtos adicionados', tipo: 'ADICIONAR_PRODUTOS', fim: FIM, quantidadeExigida: 10, quantidadeRealizada: 0 },
    { id: 'a', nome: 'Amostras solicitadas', tipo: 'SOLICITAR_AMOSTRAS', fim: FIM, quantidadeExigida: 3, quantidadeRealizada: 0 },
    { id: 'q', nome: 'Vídeos qualificados', tipo: 'VIDEOS_QUALIFICADOS', fim: FIM, quantidadeExigida: 10, quantidadeRealizada: 0 },
    { id: 'v', nome: 'Vídeo com produto', tipo: 'VIDEOS_COM_PRODUTO', fim: FIM, quantidadeExigida: 1, quantidadeRealizada: 0 },
  ]
  const analises = metas.map((m) => ({ id: m.id, situacao: 'EM_ANDAMENTO', diasRestantes: 8, faltam: m.quantidadeExigida - m.quantidadeRealizada }))
  const base = { metas, analises, amostrasPedidas: 4, amostrasComputadas: 0, publicadas: 0, aguardandoMidia: 1, emProducao: 0, aguardandoAprovacao: 0, temMidiaAutorizada: false }

  test('atual é o que o APP contou: 4 amostras registradas aqui NÃO viram 4/3 — viram dependência do TikTok', async () => {
    const { planoDasMissoes } = await import('../lib/operacao-comercial')
    const a = planoDasMissoes(base).find((l) => l.id === 'a')!
    assert.equal(a.atual, 0)
    assert.equal(a.falta, 3)
    assert.equal(a.responsavel, 'TIKTOK')
    assert.match(a.dependencia, /ainda não mostrou 4/)
  })
  test('vitrine só no app → titular; vídeos sem mídia → titular com o caminho "tenho em mãos"', async () => {
    const { planoDasMissoes } = await import('../lib/operacao-comercial')
    const l = planoDasMissoes(base)
    assert.equal(l.find((x) => x.id === 'p')!.responsavel, 'TITULAR')
    const v = l.find((x) => x.id === 'v')!
    assert.equal(v.responsavel, 'TITULAR')
    assert.match(v.proximaAcao, /Tenho este produto em mãos/)
    assert.match(v.dependencia, /marcado no app/)
  })
  test('vídeo gerando → Patrono; vídeo pronto → aprovação da titular', async () => {
    const { planoDasMissoes } = await import('../lib/operacao-comercial')
    assert.equal(planoDasMissoes({ ...base, emProducao: 1 }).find((x) => x.id === 'q')!.responsavel, 'PATRONO')
    assert.match(planoDasMissoes({ ...base, aguardandoAprovacao: 1 }).find((x) => x.id === 'q')!.proximaAcao, /Aprovar/)
  })
  test('missão concluída ou expirada sai do plano', async () => {
    const { planoDasMissoes } = await import('../lib/operacao-comercial')
    const l = planoDasMissoes({ ...base, analises: analises.map((a) => (a.id === 'p' ? { ...a, situacao: 'CONCLUIDA' } : a)) })
    assert.ok(!l.some((x) => x.id === 'p'))
  })
})

describe('P2.18 — prazo da missão na agenda = fim real (19/10 23:59 BRT não vira 20/10)', () => {
  test('agenda usa o fim da missão, não "agora + dias arredondados"', async () => {
    const { agendaSugerida } = await import('../lib/operacao-comercial')
    const { analisarMeta } = await import('../lib/metas-tiktok')
    const fim = new Date('2026-10-19T23:59:59-03:00')
    const agora = new Date('2026-10-12T13:01:00-03:00')
    const a = analisarMeta({ id: 'm', nome: 'Produtos adicionados', tipo: 'ADICIONAR_PRODUTOS', inicio: new Date('2026-10-10T00:00:00-03:00'), fim, recompensaValor: null, recompensaDescricao: null, quantidadeExigida: 10, quantidadeRealizada: 0, requisitos: null }, agora)
    const prazo = agendaSugerida([], [{ ...a, fim }], [], agora, null).find((x) => x.tipo === 'PRAZO')!
    assert.equal(prazo.quando, fim.toISOString())
    assert.equal(new Date(prazo.quando!).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }), '19/10/2026')
  })
})
