/**
 * P2.17.11 — Central ÚNICA "Precisa de você" + sininho + status verdadeiro.
 * Produtos e conteúdos abaixo são FIXTURE (dados fictícios).
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { ordenarPendencias, type PendenciaDaCentral } from '../lib/precisa-de-voce-central'
import { statusReal } from '../lib/publicacao-assistida'
// P2.45: este arquivo testa o fluxo de publicação ANTERIOR aos três controles (técnico, comercial, conformidade).
process.env.PATRONO_TESTE_LEGADO_SEM_TRES_CONTROLES = 'true'

const p = (id: string, m: Partial<PendenciaDaCentral>): PendenciaDaCentral => ({
  id, origem: 'INTEGRACAO', categoria: 'ACAO_EXTERNA', titulo: id, motivo: '', urgencia: 'MEDIA', impacto: '', acao: { rotulo: '', link: null },
  criadoEm: '2026-10-11T10:00:00Z', perdeDinheiro: false, prazo: null, bloqueiaPublicacao: false, bloqueiaIntegracao: false, ...m,
})

describe('P2.17.11 — ordem e status (puros)', () => {
  test('ordem: dinheiro em risco → prazo → bloqueia publicação → bloqueia integração → urgência', () => {
    const r = ordenarPendencias([
      p('integracao', { bloqueiaIntegracao: true }),
      p('publicacao', { bloqueiaPublicacao: true }),
      p('prazo-longe', { perdeDinheiro: true, prazo: '2026-10-30T00:00:00Z' }),
      p('prazo-perto', { perdeDinheiro: true, prazo: '2026-10-19T00:00:00Z' }),
      p('alta', { urgencia: 'ALTA' }),
    ])
    assert.deepEqual(r.map((x) => x.id), ['prazo-perto', 'prazo-longe', 'publicacao', 'integracao', 'alta'])
  })
  test('roteiro pronto ≠ vídeo pronto', () => {
    // P2.17.12: sem o arquivo, o selo do Quality Gate não aparece (a checagem foi só do roteiro).
    const sem = statusReal({ estado: 'AGUARDANDO_APROVACAO', apresentacao: { video: { arquivo: null } }, qualityGate: { veredito: 'APROVADO' } })
    assert.deepEqual(sem.etapas, ['ROTEIRO PRONTO', 'SEM ARQUIVO DE VÍDEO', 'AGUARDANDO APROVAÇÃO'])
    assert.deepEqual(statusReal({ estado: 'AGUARDANDO_MIDIA', apresentacao: { video: { arquivo: null, situacao: 'FALTA_MIDIA_AUTORIZADA' } }, qualityGate: { veredito: 'APROVADO' } }).etapas, ['ROTEIRO PRONTO', 'AGUARDANDO MÍDIA AUTORIZADA'])
    assert.deepEqual(statusReal({ estado: 'VIDEO_NA_FILA', apresentacao: { video: { arquivo: null, situacao: 'NA_FILA' } }, qualityGate: null }).etapas, ['ROTEIRO PRONTO', 'VÍDEO NA FILA'])
    assert.deepEqual(statusReal({ estado: 'GERANDO_VIDEO', apresentacao: { video: { arquivo: null, situacao: 'GERANDO' } }, qualityGate: null }).etapas, ['ROTEIRO PRONTO', 'VÍDEO EM GERAÇÃO'])
    assert.equal(statusReal({ estado: 'AGUARDANDO_APROVACAO', apresentacao: { video: { arquivo: 'https://s/v.mp4' } }, qualityGate: { veredito: 'APROVADO' } }).etapas.at(-1), 'AGUARDANDO SUA APROVAÇÃO')
    assert.equal(sem.videoGerado, false)
    assert.match(sem.principal, /vídeo ainda não gerado/)
    assert.doesNotMatch(sem.principal, /VÍDEO GERADO|vídeo pronto/i)
    const com = statusReal({ estado: 'APROVADO', apresentacao: { video: { arquivo: 'https://s/v.mp4' } }, qualityGate: { veredito: 'APROVADO' } })
    assert.deepEqual(com.etapas, ['ROTEIRO PRONTO', 'VÍDEO GERADO', 'QUALITY GATE APROVADO', 'APROVADO'])
    assert.equal(statusReal({ estado: 'PUBLICANDO', apresentacao: {}, qualityGate: null, publishId: null }).etapas.at(-1), 'ENVIANDO')
    assert.equal(statusReal({ estado: 'PUBLICANDO', apresentacao: {}, qualityGate: null, publishId: 'x' }).etapas.at(-1), 'PUBLICANDO')
  })
  test('sininho: badge pequeno que some com zero; mesmo número no menu e no topo do celular; sem selo separado de Aprovações', () => {
    const badge = fs.readFileSync('components/shared/SininhoBadge.tsx', 'utf8')
    assert.match(badge, /if \(total <= 0\) return null/)
    // P2.17.12: a árvore do menu mora em lib/navegacao.ts.
    const sidebar = fs.readFileSync('lib/navegacao.ts', 'utf8')
    assert.match(sidebar, /href: '\/precisa-de-voce'.*badge: true/)
    assert.doesNotMatch(sidebar, /href: '\/aprovacao'.*badge: true/)
    const header = fs.readFileSync('components/shared/Header.tsx', 'utf8')
    assert.match(header, /lg:hidden[\s\S]*BellRing[\s\S]*SininhoBadge/)
    const hook = fs.readFileSync('hooks/usePrecisaDeVoce.ts', 'utf8')
    assert.match(hook, /\/api\/precisa-de-voce\?contar=1/)
    assert.match(hook, /EVENTO_PRECISA_DE_VOCE/)
    // As telas que resolvem pendência avisam o sininho na hora.
    for (const f of ['app/(dashboard)/precisa-de-voce/page.tsx', 'components/assistido/PainelAssistido.tsx']) {
      assert.match(fs.readFileSync(f, 'utf8'), /avisarMudancaNoPrecisaDeVoce\(\)/, f)
    }
  })
})

const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')

describe('P2.17.11 — banco de TESTE: a central única', { skip: !TEM_BANCO ? 'exige banco de TESTE' : false }, () => {
  let prisma: typeof import('../lib/prisma').prisma
  let C: typeof import('../lib/precisa-de-voce-central')
  let A: typeof import('../lib/publicacao-assistida')
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  let V: typeof import('../lib/video-assistido')
  let M: typeof import('../lib/midia-do-produto')
  let RT: typeof import('./_render-de-teste')
  const PREFIXO = 'Conta de Teste — '
  const marca = `r83-${Date.now()}`
  const ws: string[] = []
  const users: string[] = []
  const AGORA = new Date('2026-11-20T12:00:00-03:00')

  before(async () => {
    ;[{ prisma }, C, A, { limparWorkspaceDeTeste: limpar }, V, M, RT] = await Promise.all([
      import('../lib/prisma'), import('../lib/precisa-de-voce-central'), import('../lib/publicacao-assistida'), import('./_limpar-workspace-de-teste'),
      import('../lib/video-assistido'), import('../lib/midia-do-produto'), import('./_render-de-teste'),
    ])
    V.definirPortasDoRender(RT.portasDeTeste())
    for (const n of ['A', 'B']) {
      const w = (await prisma.workspace.create({ data: { name: `${PREFIXO}central ${n} P2.17.11`, ownerId: `${marca}-${n}` }, select: { id: true } })).id
      ws.push(w)
      users.push((await prisma.user.create({ data: { email: `${marca}-${n}@teste.local`, name: 'U', password: 'x', workspaceId: w }, select: { id: true } })).id)
    }
    for (const i of [1, 2]) {
      await prisma.candidatoDeProduto.create({
        data: {
          workspaceId: ws[0], chaveDeOrigem: `${marca}-${i}`, fonte: 'USER_PROVIDED', nome: `FIXTURE Árvore ${i}`, categoria: 'Casa e Decoração', preco: 199,
          linkProduto: `https://shop.tiktok.com/br/pdp/90000000000000083${i}`, providerId: 'tiktok-shop', externalId: `90000000000000083${i}`, score: 70, baseDeEvidencia: 60 - i,
          confianca: 'SEM_HISTORICO_REAL', status: 'APRESENTADO', coletadoEm: AGORA, validoAte: new Date('2027-01-01'), motivosPositivos: [], riscos: [], desconhecidos: [], porqueDestaPosicao: [], nivelDeRisco: 'BAIXO',
        },
      })
    }
  })
  after(async () => {
    V?.definirPortasDoRender(null)
    for (const w of ws) {
      await prisma.midiaDoProduto.deleteMany({ where: { workspaceId: w } })
      await limpar(prisma, w, PREFIXO)
    }
    await prisma?.$disconnect()
  })

  const doTipo = (itens: { id: string }[], prefixo: string) => itens.filter((i) => i.id.startsWith(prefixo))

  let id = ''
  test('sem mídia autorizada: UMA pendência "Fornecer mídia autorizada" (AÇÃO EXTERNA), nenhuma aprovação', async () => {
    // P2.18.5: a proposta da jornada (aprovar produto) é do MESMO produto que vira a publicação; não conta como pendência nova.
    const semJornada = (xs: { id: string }[]) => xs.filter((i) => !i.id.startsWith('jornada:'))
    const antes = semJornada(await C.centralPrecisaDeVoce(ws[0], AGORA)).length
    const a = await A.prepararProximaPublicacao({ workspaceId: ws[0], userId: users[0], agora: AGORA })
    id = a.id
    assert.equal(a.estado, 'AGUARDANDO_MIDIA')
    const itens = await C.centralPrecisaDeVoce(ws[0], AGORA)
    assert.equal(semJornada(itens).length, antes + 1, 'nasce exatamente uma pendência')
    const item = itens.find((i) => i.id === `assistida:${id}:midia`)!
    assert.equal(item.categoria, 'ACAO_EXTERNA')
    assert.match(item.titulo, /^Fornecer mídia autorizada para /)
    assert.equal(item.assistida?.modo, 'MIDIA')
    assert.ok(!itens.some((i) => i.id.startsWith(`assistida:${id}:v`)), 'sem vídeo não há aprovação')
    // O TikTok sem app aprovado vira AÇÃO EXTERNA (criar o app), uma vez só.
    assert.equal(doTipo(itens, 'tiktok:').length, 1)
  })

  test('aprovação PREMATURA (sem MP4) é retirada: volta para o fluxo do vídeo, sem duplicar', async () => {
    // Simula o estado antigo (P2.17.11): AGUARDANDO_APROVACAO sem arquivo, formato DEMONSTRACAO.
    const a = await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id } })
    const ap = a.apresentacao as { versao: { estrutura: string; varianteId: string } }
    await prisma.publicacaoAssistida.update({ where: { id }, data: { estado: 'AGUARDANDO_APROVACAO', estrutura: 'DEMONSTRACAO', apresentacao: { ...(a.apresentacao as object), versao: { ...ap.versao, estrutura: 'DEMONSTRACAO', varianteId: 'DEMONSTRACAO-A-CURTA' } } } })
    assert.ok(!(await C.centralPrecisaDeVoce(ws[0], AGORA)).some((i) => i.id.startsWith(`assistida:${id}:v`)), 'a central nunca mostra aprovação sem vídeo')
    const r = await A.prepararProximaPublicacao({ workspaceId: ws[0], userId: users[0], agora: AGORA })
    assert.equal(r.id, id)
    assert.equal(r.estado, 'AGUARDANDO_MIDIA')
    assert.notEqual(r.estrutura, 'DEMONSTRACAO', 'DEMONSTRACAO exige vídeo dela: trocado por formato automático')
    assert.ok((r.historico as { detalhe?: string }[]).some((h) => /Aprovação retirada/.test(h.detalhe ?? '')))
  })

  test('mídia autorizada → vídeo gerado → a MESMA publicação vira APROVAÇÃO 1/10 (a pendência de mídia some)', async () => {
    const a = await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id } })
    await M.registrarMidia({ workspaceId: ws[0], candidatoId: a.candidatoId, nomeProduto: a.nomeProduto, declaracao: RT.declaracaoFixture('r83', users[0]) })
    const antes = (await C.centralPrecisaDeVoce(ws[0], AGORA)).length
    await A.prepararProximaPublicacao({ workspaceId: ws[0], userId: users[0], agora: AGORA })
    const itens = await C.centralPrecisaDeVoce(ws[0], AGORA)
    assert.equal(itens.length, antes, 'troca uma pendência pela outra')
    assert.ok(!itens.some((i) => i.id === `assistida:${id}:midia`))
    const item = itens.find((i) => i.id === `assistida:${id}:v1`)!
    assert.equal(item.categoria, 'APROVACAO')
    assert.equal(item.assistida?.contador, 'Publicação assistida 1/10')
    assert.equal(item.assistida?.modo, 'APROVAR')
    assert.match(item.assistida!.status.principal, /ROTEIRO PRONTO · VÍDEO GERADO · QUALITY GATE APROVADO · AGUARDANDO SUA APROVAÇÃO/)
    assert.equal((item.assistida!.qualityGate as { veredito: string }).veredito, 'APROVADO')
    assert.ok(item.assistida!.motivoEscolha.length > 10)
  })

  test('pedir ajuste: a nova versão volta para a fila (sem duplicar)', async () => {
    const antes = (await C.centralPrecisaDeVoce(ws[0], AGORA)).length
    await A.pedirAjuste({ workspaceId: ws[0], userId: users[0], id, motivo: 'Gancho mais curto', alteracoes: { gancho: 'Olha essa árvore de 2,40 m' }, agora: AGORA })
    const itens = await C.centralPrecisaDeVoce(ws[0], AGORA)
    assert.equal(itens.length, antes)
    assert.ok(itens.some((i) => i.id === `assistida:${id}:v2`))
    assert.ok(!itens.some((i) => i.id === `assistida:${id}:v1`))
  })

  test('aprovar: a aprovação sai da fila; nada de pendência de mídia (o vídeo já existe)', async () => {
    await A.aprovarEPublicar({ workspaceId: ws[0], userId: users[0], id, agora: AGORA, env: {} })
    const itens = await C.centralPrecisaDeVoce(ws[0], AGORA)
    assert.ok(!itens.some((i) => i.id.startsWith(`assistida:${id}:`)), 'aprovada com vídeo: só o TikTok (ação externa já listada) segura o envio')
  })

  test('rejeitar: some a rejeitada e aparece a nova opção (uma pendência, não duas)', async () => {
    const nova = await A.prepararProximaPublicacao({ workspaceId: ws[0], userId: users[0], agora: AGORA })
    // (com a anterior APROVADA em andamento, preparar devolve a que está em andamento)
    assert.equal(nova.id, id)
    await prisma.publicacaoAssistida.update({ where: { id }, data: { estado: 'PUBLICADO', ordem: 1, bloqueio: null } })
    const segunda = await A.prepararProximaPublicacao({ workspaceId: ws[0], userId: users[0], agora: AGORA })
    const proxima = await A.rejeitar({ workspaceId: ws[0], userId: users[0], id: segunda.id, motivo: 'Não gostei', agora: AGORA })
    const itens = await C.centralPrecisaDeVoce(ws[0], AGORA)
    assert.ok(!itens.some((i) => i.id.startsWith(`assistida:${segunda.id}:`)))
    assert.ok(proxima && itens.some((i) => i.id.startsWith(`assistida:${proxima.id}:`)))
    assert.equal(itens.filter((i) => i.origem === 'PUBLICACAO_ASSISTIDA').length, 1)
    const p = itens.find((i) => i.id.startsWith(`assistida:${proxima!.id}:`))!
    assert.ok(/Publicação assistida 2\/10/.test(p.titulo) || /^Fornecer mídia autorizada/.test(p.titulo))
  })

  test('conteúdo aguardando aprovação entra; aprovado, sai', async () => {
    const produto = await prisma.produto.create({ data: { workspaceId: ws[0], userId: users[0], nome: 'FIXTURE Conteúdo', categoria: 'Casa', origemConteudo: 'Próprio', tipoVenda: 'Afiliado', imagens: [], videos: [], publicoAlvo: [], beneficios: [], pontosNegativos: [] } })
    const c = await prisma.conteudo.create({ data: { workspaceId: ws[0], userId: users[0], produtoId: produto.id, status: 'aguardando_aprovacao' } })
    assert.ok((await C.centralPrecisaDeVoce(ws[0], AGORA)).some((i) => i.id === `conteudo:${c.id}`))
    await prisma.conteudo.update({ where: { id: c.id }, data: { status: 'aprovado' } })
    assert.ok(!(await C.centralPrecisaDeVoce(ws[0], AGORA)).some((i) => i.id === `conteudo:${c.id}`))
  })

  test('isolamento: o workspace B não vê nada do A; ids únicos', async () => {
    const b = await C.centralPrecisaDeVoce(ws[1], AGORA)
    assert.ok(b.every((i) => !/FIXTURE/.test(i.titulo)))
    const a = await C.centralPrecisaDeVoce(ws[0], AGORA)
    assert.equal(new Set(a.map((i) => i.id)).size, a.length)
  })

  test('Torre: mesmo total do sininho, Quality Gate, motivo e status verdadeiro', async () => {
    const { torreDeControle } = await import('../lib/torre-de-controle')
    const t = await torreDeControle(ws[0], AGORA)
    assert.equal(t.precisaDeVoceTotal, (await C.centralPrecisaDeVoce(ws[0], AGORA)).length)
    const naFila = t.filaDePublicacao.find((x) => x.estado !== 'PUBLICADO')!
    assert.equal(naFila.qualityGate, 'APROVADO')
    assert.ok(naFila.motivoEscolha.length > 10)
    assert.equal(naFila.statusReal.includes('VÍDEO GERADO'), naFila.videoGerado, 'o status só diz "vídeo gerado" com o arquivo')
    assert.doesNotMatch(JSON.stringify(t.agora), /pronto e checado/)
  })
})
