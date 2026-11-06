/**
 * P2.18 — Simulação PONTA A PONTA da primeira publicação, no banco e no
 * storage de TESTE, com render FFmpeg REAL (nada é publicado):
 *
 *   produto em mãos → 4 mídias reais (3 fotos + 1 vídeo, em lote) → roteiro
 *   → render com as 4 → Quality Gate do arquivo → refazer (ajuste) sem
 *   duplicar → aprovação → publicação assistida (manual) → link → métricas
 *   → resultado → aprendizado/caminho.
 *
 * As "fotos" e o "vídeo" são arquivos SINTÉTICOS gerados pelo FFmpeg (cores
 * e padrão de teste) e marcados como FIXTURE — servem só para provar o
 * pipeline; nenhum produto real nem posse real é afirmado.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
// P2.45: este arquivo testa o fluxo de publicação ANTERIOR aos três controles (técnico, comercial, conformidade).
process.env.PATRONO_TESTE_LEGADO_SEM_TRES_CONTROLES = 'true'

const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')
const TEM_STORAGE = !!process.env.SUPABASE_SERVICE_ROLE_KEY && (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').includes('ref-teste-exemplo')
const DECL = { gravadoPelaPropriaDona: true, semMusicaDeTerceiros: true, semTerceirosNemCriancas: true }

describe('pipeline da 1ª publicação (TESTE, render real, nada publicado)', { skip: !(TEM_BANCO && TEM_STORAGE) ? 'exige banco e storage de TESTE' : false, timeout: 600_000 }, () => {
  let prisma: typeof import('../lib/prisma').prisma
  let A: typeof import('../lib/publicacao-assistida')
  let M: typeof import('../lib/midia-do-produto')
  let R: typeof import('../lib/resultados-videos')
  let OP: typeof import('../lib/operacao-comercial')
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  let sb: import('@supabase/supabase-js').SupabaseClient
  const PREFIXO = 'Conta de Teste — '
  const marca = `r93-${Date.now()}`
  const pasta = mkdtempSync(join(tmpdir(), 'p218-'))
  const subidos: { bucket: string; caminho: string }[] = []
  let ws = ''
  let user = ''
  let candidatoId = ''
  let assistidaId = ''
  const urls: { url: string; tipo: 'IMAGEM' | 'VIDEO' }[] = []

  async function subir(bucket: string, arquivo: string, tipo: string) {
    const caminho = `testes/p218/${marca}/${arquivo.split(/[\\/]/).pop()}`
    const { error } = await sb.storage.from(bucket).upload(caminho, readFileSync(arquivo), { contentType: tipo, upsert: true })
    if (error) throw error
    subidos.push({ bucket, caminho })
    return sb.storage.from(bucket).getPublicUrl(caminho).data.publicUrl
  }

  before(async () => {
    ;[{ prisma }, A, M, R, OP, { limparWorkspaceDeTeste: limpar }] = await Promise.all([
      import('../lib/prisma'), import('../lib/publicacao-assistida'), import('../lib/midia-do-produto'), import('../lib/resultados-videos'), import('../lib/operacao-comercial'), import('./_limpar-workspace-de-teste'),
    ])
    const { createClient } = await import('@supabase/supabase-js')
    sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    ws = (await prisma.workspace.create({ data: { name: `${PREFIXO}pipeline 1ª publicação`, ownerId: marca }, select: { id: true } })).id
    user = (await prisma.user.create({ data: { email: `${marca}@teste.local`, name: 'U', password: 'x', workspaceId: ws }, select: { id: true } })).id
    candidatoId = (await prisma.candidatoDeProduto.create({
      data: {
        workspaceId: ws, chaveDeOrigem: `${marca}-garrafa`, fonte: 'USER_PROVIDED', nome: 'FIXTURE Garrafa térmica 500 ml', categoria: 'Casa e Cozinha', preco: 59.9, providerId: 'tiktok-shop', externalId: '900000000000093001',
        linkProduto: 'https://www.tiktok.com/view/product/900000000000093001', comissaoValor: 5.99,
        score: 60, baseDeEvidencia: 60, confianca: 'SEM_HISTORICO_REAL', status: 'APRESENTADO', coletadoEm: new Date(), validoAte: new Date('2027-01-01'), motivosPositivos: [], riscos: [], desconhecidos: [], porqueDestaPosicao: [], nivelDeRisco: 'BAIXO',
      },
      select: { id: true },
    })).id
    // Mídias SINTÉTICAS (FFmpeg): 3 "fotos" e 1 "vídeo" de 4 s.
    const ff = (await import('ffmpeg-static')).default as unknown as string
    for (const [i, cor] of ['0x2e7d32', '0x1565c0', '0xc62828'].entries()) {
      const f = join(pasta, `foto-${i}.jpg`)
      execFileSync(ff, ['-f', 'lavfi', '-i', `color=c=${cor}:s=1080x1350`, '-frames:v', '1', '-y', f], { stdio: 'ignore' })
      urls.push({ url: await subir('imagens', f, 'image/jpeg'), tipo: 'IMAGEM' })
    }
    const v = join(pasta, 'video.mp4')
    execFileSync(ff, ['-f', 'lavfi', '-i', 'testsrc=size=720x1280:rate=30', '-t', '4', '-pix_fmt', 'yuv420p', '-y', v], { stdio: 'ignore' })
    urls.push({ url: await subir('videos', v, 'video/mp4'), tipo: 'VIDEO' })
  })

  after(async () => {
    for (const s of subidos) await sb.storage.from(s.bucket).remove([s.caminho]).catch(() => null)
    const gerados = await sb.storage.from('videos').list(`assistidas/${ws}`).catch(() => ({ data: [] as { name: string }[] }))
    if (gerados.data?.length) await sb.storage.from('videos').remove(gerados.data.map((x) => `assistidas/${ws}/${x.name}`)).catch(() => null)
    rmSync(pasta, { recursive: true, force: true })
    await limpar(prisma, ws, PREFIXO)
    await prisma?.$disconnect()
  })

  test('1. "tenho em mãos" → publicação esperando mídia, com a lista do que gravar (sem kit, sem amostra)', async () => {
    const a = await A.prepararProximaPublicacao({ workspaceId: ws, userId: user, candidatoEmMaos: candidatoId })
    assert.equal(a.estado, 'AGUARDANDO_MIDIA')
    assistidaId = a.id
    const ap = a.apresentacao as { cenasParaGravar: string[] | null; versao: { legenda: string } }
    assert.ok(ap.cenasParaGravar && ap.cenasParaGravar.length >= 4, 'lista genérica de cenas')
    assert.match(ap.cenasParaGravar!.join(' '), /3 a 10 arquivos/)
    assert.match(ap.versao.legenda, /comiss|afiliad|publi/i, 'divulgação de afiliado na legenda')
    assert.equal(await prisma.amostraTikTokShop.count({ where: { workspaceId: ws } }), 0, 'não depende de amostra')
  })

  test('2. direitos: foto do vendedor BLOQUEADA, origem desconhecida e vídeo próprio sem declarações NÃO confirmados', async () => {
    const base = { titularidade: 'Titular da conta (eu)', direitoDeUso: 'Uso nas minhas redes', declaradoPor: user, declaradoEm: new Date(), descricao: 'FIXTURE' }
    const vendedor = await M.registrarMidia({ workspaceId: ws, candidatoId, nomeProduto: 'x', declaracao: { ...base, url: urls[0].url + '?v', tipo: 'IMAGEM', origem: 'FORNECEDOR' } })
    const desconhecida = await M.registrarMidia({ workspaceId: ws, candidatoId, nomeProduto: 'x', declaracao: { ...base, url: urls[1].url + '?d', tipo: 'IMAGEM', origem: 'DESCONHECIDA' } })
    const semDecl = await M.registrarMidia({ workspaceId: ws, candidatoId, nomeProduto: 'x', declaracao: { ...base, url: urls[3].url + '?s', tipo: 'VIDEO', origem: 'PROPRIO', declaracoes: null } })
    assert.equal(vendedor.status, 'BLOQUEADA')
    assert.equal(desconhecida.status, 'NAO_CONFIRMADA')
    assert.equal(semDecl.status, 'NAO_CONFIRMADA')
    // Nenhuma delas destrava o vídeo.
    const a = await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id: assistidaId } })
    assert.equal((await A.avancarVideo(a)).estado, 'AGUARDANDO_MIDIA')
    await prisma.midiaDoProduto.deleteMany({ where: { id: { in: [vendedor.id, desconhecida.id, semDecl.id] } } })
  })

  test('3. lote de 4 mídias reais da titular → UM render com as 4 → QG do arquivo APROVADO → aguardando aprovação', async () => {
    for (const [i, m] of urls.entries()) {
      const r = await M.registrarMidia({
        workspaceId: ws, candidatoId, nomeProduto: 'FIXTURE Garrafa térmica 500 ml',
        declaracao: { url: m.url, tipo: m.tipo, origem: 'PROPRIO', titularidade: 'Titular da conta (eu)', direitoDeUso: 'Uso nas minhas redes e nos vídeos do Patrono', declaradoPor: user, declaradoEm: new Date(), descricao: `FIXTURE ${i + 1}/4`, declaracoes: m.tipo === 'VIDEO' ? DECL : null },
      })
      assert.equal(r.status, 'AUTORIZADA', `${m.tipo} ${i}: ${r.motivoStatus}`)
    }
    const a = await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id: assistidaId } })
    const depois = await A.avancarVideo(a)
    assert.equal(depois.estado, 'AGUARDANDO_APROVACAO', JSON.stringify((depois.apresentacao as { video: unknown }).video).slice(0, 400))
    const v = (depois.apresentacao as { video: { arquivo: string; midiaIds: string[]; cenas: unknown[] } }).video
    assert.match(v.arquivo, /^https:\/\/ref-teste-exemplo\.supabase\.co\/storage\/v1\/object\/public\/videos\/assistidas\//)
    assert.equal(v.midiaIds.length, 4, 'o vídeo usou as 4 mídias')
    const qg = depois.qualityGate as { veredito: string; arquivo: { largura: number; altura: number; duracaoS: number; direitoPublicavel: boolean } }
    assert.equal(qg.veredito, 'APROVADO')
    assert.deepEqual([qg.arquivo.largura, qg.arquivo.altura, qg.arquivo.direitoPublicavel], [1080, 1920, true])
    const usos = await prisma.midiaDoProduto.findMany({ where: { workspaceId: ws }, select: { usos: true } })
    assert.ok(usos.every((u) => u.usos === 1), 'cada mídia contada uma vez')
  })

  test('4. refazer (pedir ajuste do gancho) gera de novo SEM duplicar produto, mídia ou publicação', async () => {
    const antes = await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id: assistidaId } })
    const r = await A.pedirAjuste({ workspaceId: ws, userId: user, id: assistidaId, motivo: 'Gancho mais direto', alteracoes: { gancho: 'Olha essa garrafa que eu uso todo dia' } })
    assert.equal(r.id, assistidaId)
    assert.equal(r.versao, antes.versao + 1)
    assert.equal(r.estado, 'AGUARDANDO_APROVACAO')
    assert.notEqual((r.apresentacao as { video: { arquivo: string } }).video.arquivo, (antes.apresentacao as { video: { arquivo: string } }).video.arquivo)
    assert.equal(await prisma.publicacaoAssistida.count({ where: { workspaceId: ws } }), 1)
    assert.equal(await prisma.midiaDoProduto.count({ where: { workspaceId: ws } }), 4)
  })

  test('5. aprovação → publicação assistida (manual, sem app aprovado) → link → resultado; produto criado UMA vez', async () => {
    const aprovada = await A.aprovarEPublicar({ workspaceId: ws, userId: user, id: assistidaId })
    assert.ok(['APROVADO', 'PUBLICANDO'].includes(aprovada.estado), aprovada.estado)
    assert.equal(await prisma.produto.count({ where: { workspaceId: ws } }), 1)
    assert.equal(await prisma.conteudo.count({ where: { workspaceId: ws } }), 1)
    const link = 'https://www.tiktok.com/@fixture/video/7400000000000000931'
    // Um segundo produto no ranking: depois do link, o Patrono já prepara a próxima (sem publicar).
    await prisma.candidatoDeProduto.create({ data: { workspaceId: ws, chaveDeOrigem: `${marca}-segundo`, fonte: 'USER_PROVIDED', nome: 'FIXTURE Segundo produto do ranking', categoria: 'Casa e Cozinha', preco: 39.9, providerId: 'tiktok-shop', externalId: '900000000000093002', score: 50, baseDeEvidencia: 50, confianca: 'SEM_HISTORICO_REAL', status: 'APRESENTADO', coletadoEm: new Date(), validoAte: new Date('2027-01-01'), motivosPositivos: [], riscos: [], desconhecidos: [], porqueDestaPosicao: [], nivelDeRisco: 'BAIXO' } })
    const { publicada: pub, proxima } = await A.registrarPublicacaoManualEContinuar({ workspaceId: ws, userId: user, id: assistidaId, url: link })
    assert.equal(pub.estado, 'PUBLICADO')
    assert.ok(proxima && proxima.id !== assistidaId, 'PATRONO CONTINUA: próxima preparada')
    assert.match(proxima!.nomeProduto, /Segundo produto/)
    assert.notEqual(proxima!.estado, 'PUBLICADO')
    await A.registrarPublicacaoManual({ workspaceId: ws, userId: user, id: assistidaId, url: link }).catch(() => null)
    assert.equal(await prisma.videoTikTokResultado.count({ where: { workspaceId: ws } }), 1, 'repetir não duplica')
    const linha = await prisma.videoTikTokResultado.findFirstOrThrow({ where: { workspaceId: ws } })
    assert.equal(linha.postId, '7400000000000000931')
    await R.atualizarMetricas({ workspaceId: ws, userId: user, id: linha.id, metricas: { views: 1200, cliquesProduto: 30, vendas: 2, comissao: 11.98 }, origem: 'MANUAL' })
    const status = await R.statusDosProdutos(ws)
    assert.ok([...status.values()].some((s) => s.nome.includes('Garrafa')))
    const op = await OP.operacaoComercial(ws)
    const etapa = (n: string) => (op.caminho as { etapa: string; estado: string }[]).find((e) => e.etapa === n)?.estado
    assert.equal(etapa('Publicado'), 'CONCLUIDO')
    assert.equal(etapa('Comissão'), 'CONCLUIDO')
    assert.equal(op.atribuicao.CONFIRMADA, 1, 'venda do próprio vídeo = atribuição CONFIRMADA')
    const hist = (await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id: assistidaId } })).historico as { acao: string }[]
    for (const acao of ['PRODUTO_EM_MAOS', 'QUALITY_GATE', 'APROVADO', 'PUBLICADO']) assert.ok(hist.some((h) => h.acao === acao), `rastreio: ${acao}`)
  })
})

describe('P2.18 — várias mídias e cenas genéricas (funções puras)', () => {
  test('sequência: a escolhida pelo formato abre; até 10; no máximo 1 a cada 2 s', async () => {
    const { sequenciaDeMidias } = await import('../lib/video-assistido')
    const m = (id: string) => ({ id })
    const todas = Array.from({ length: 12 }, (_, i) => m(`m${i}`))
    assert.deepEqual(sequenciaDeMidias(m('m5'), todas, 30).map((x) => x.id), ['m5', 'm0', 'm1', 'm2', 'm3', 'm4', 'm6', 'm7', 'm8', 'm9'])
    assert.equal(sequenciaDeMidias(m('m0'), todas, 12).length, 6)
    assert.deepEqual(sequenciaDeMidias(m('a'), [m('a')], 15).map((x) => x.id), ['a'])
  })
  test('cenas genéricas: só o produto; uso físico só com vídeo dela de verdade; pede 3 a 10 arquivos', async () => {
    const { cenasParaGravarGenericas } = await import('../lib/video-assistido')
    const foto = cenasParaGravarGenericas('LISTA_3_MOTIVOS').join(' ')
    assert.match(foto, /produto inteiro/)
    assert.match(foto, /3 a 10 arquivos/)
    assert.doesNotMatch(foto, /usando o produto/)
    assert.match(foto, /vendedor/, 'avisa que foto do vendedor não serve')
    assert.match(cenasParaGravarGenericas('DEMONSTRACAO').join(' '), /só o que aconteceu de verdade/)
  })
})
