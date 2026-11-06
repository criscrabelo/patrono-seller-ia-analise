/**
 * P2.69+ — o arquivo que vai à plataforma É o arquivo aprovado (fecha o TOCTOU entre conferir e enviar).
 *
 * Mecanismo (lib/arquivo-aprovado.ts): lê a origem UMA vez → sha256 desses bytes → grava os MESMOS bytes no caminho
 * imutável `<ws>/aprovados/<sha256>.mp4` sem sobrescrever → a liberação usa esse sha256 → a peça aponta só para esse
 * caminho; o orquestrador recusa qualquer outro, e o adaptador do TikTok confere o hash dos bytes baixados.
 *
 * Testes de concorrência com storage em memória que reproduz a semântica do Supabase (upload sem upsert = falha se
 * o objeto existe, atômico). O bloco final roda contra o storage REAL do projeto de TESTE (pulado sem ele).
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { fixarArquivoAprovado, caminhoImutavel, type PortasDoArquivoAprovado } from '../lib/arquivo-aprovado'
import { liberacaoParaPublicacao } from '../lib/quality-gate-conformidade'
import { assetNoCaminhoImutavel, distribuirConteudo } from '../lib/distribuicao-orquestrador'
import { criarAdaptadorTikTok } from '../lib/tiktok-adaptador'
import { urlConferidaDoArquivoAprovado, hashDoTexto, dispensaLegadaAtiva, registroDoArquivoValido } from '../lib/arquivo-aprovado-vinculo'

const ENV = { NEXT_PUBLIC_SUPABASE_URL: 'https://proj.test' }

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
const pausa = () => new Promise((r) => setImmediate(r))
const URL_BASE = 'https://proj.test/storage/v1/object/sign/midias-privadas/'

/** storage com put-if-absent atômico e pausas entre as etapas (para intercalar as corridas) */
function storage(inicial: Record<string, Buffer> = {}) {
  const objetos = new Map<string, Buffer>(Object.entries(inicial))
  const origens = new Map<string, Buffer>()
  const portas: PortasDoArquivoAprovado = {
    baixar: async (o) => { await pausa(); const b = origens.get(o); if (!b) throw new Error('404'); return Buffer.from(b) },
    subirSemSobrescrever: async (c, b) => { await pausa(); if (objetos.has(c)) return 'JA_EXISTE'; objetos.set(c, Buffer.from(b)); return 'CRIADO' },
    ler: async (c) => { await pausa(); const b = objetos.get(c); if (!b) throw new Error('404'); return Buffer.from(b) },
    urlDeLeitura: async (c) => `${URL_BASE}${c}?token=t`,
  }
  /** o que a PLATAFORMA leria da URL entregue */
  const plataformaLe = (url: string) => objetos.get(decodeURIComponent(new URL(url).pathname).replace('/storage/v1/object/sign/midias-privadas/', ''))
  return { objetos, origens, portas, plataformaLe }
}

const APROVADO = Buffer.from('video-aprovado-pela-barreira')
const TROCADO = Buffer.from('video-trocado-depois')
const qg = (s: string) => ({ veredito: 'APROVADO', arquivo: { sha256: s }, comercial: { veredito: 'APRESENTAR_A_TITULAR' }, conformidade: { veredito: 'APTO' }, barreira: { decisao: 'APTO_PARA_TITULAR', sha256: s } })

describe('arquivo aprovado imutável — corridas', () => {
  test('origem TROCADA logo depois da leitura: a plataforma recebe os bytes aprovados, não os novos', async () => {
    const s = storage(); s.origens.set('ws1/v.mp4', APROVADO)
    const portas: PortasDoArquivoAprovado = { ...s.portas, baixar: async (o) => { const b = await s.portas.baixar(o); s.origens.set(o, TROCADO); return b } }
    const f = await fixarArquivoAprovado({ workspaceId: 'ws1', origem: 'ws1/v.mp4' }, portas)
    assert.equal(liberacaoParaPublicacao(qg(sha(APROVADO)), f.sha256).liberado, true)
    assert.deepEqual(s.plataformaLe(f.url), APROVADO)
    assert.equal(s.origens.get('ws1/v.mp4'), TROCADO) // a troca aconteceu e não importou
  })
  test('origem trocada ANTES da leitura: o hash é do arquivo novo → liberação recusa', async () => {
    const s = storage(); s.origens.set('ws1/v.mp4', TROCADO)
    const f = await fixarArquivoAprovado({ workspaceId: 'ws1', origem: 'ws1/v.mp4' }, s.portas)
    assert.equal(liberacaoParaPublicacao(qg(sha(APROVADO)), f.sha256).liberado, false)
  })
  test('20 fixações SIMULTÂNEAS do mesmo arquivo: 1 cria, 19 conferem; todas apontam para o mesmo objeto', async () => {
    const s = storage(); s.origens.set('o', APROVADO)
    const r = await Promise.all(Array.from({ length: 20 }, () => fixarArquivoAprovado({ workspaceId: 'ws1', origem: 'o' }, s.portas)))
    assert.equal(r.filter((x) => x.criado).length, 1)
    assert.equal(new Set(r.map((x) => x.url)).size, 1)
    assert.equal(s.objetos.size, 1)
  })
  test('troca da origem NO MEIO de fixações simultâneas: cada uma fica com o seu hash; só a do aprovado é liberada', async () => {
    const s = storage(); s.origens.set('o', APROVADO)
    const p1 = fixarArquivoAprovado({ workspaceId: 'ws1', origem: 'o' }, s.portas)
    await pausa(); await pausa(); s.origens.set('o', TROCADO)
    const p2 = fixarArquivoAprovado({ workspaceId: 'ws1', origem: 'o' }, s.portas)
    const [f1, f2] = await Promise.all([p1, p2])
    assert.notEqual(f1.caminho, f2.caminho)
    assert.equal(liberacaoParaPublicacao(qg(sha(APROVADO)), f1.sha256).liberado, true)
    assert.equal(liberacaoParaPublicacao(qg(sha(APROVADO)), f2.sha256).liberado, false)
    assert.deepEqual(s.plataformaLe(f1.url), APROVADO)
  })
  test('caminho do hash já ocupado por OUTRO conteúdo (corrompido/plantado): recusa', async () => {
    const s = storage({ [caminhoImutavel('ws1', sha(APROVADO))]: TROCADO }); s.origens.set('o', APROVADO)
    await assert.rejects(fixarArquivoAprovado({ workspaceId: 'ws1', origem: 'o' }, s.portas), /contém outro arquivo/)
  })
  test('tentativa de sobrescrever o aprovado depois de fixado: storage devolve JA_EXISTE e o conteúdo não muda', async () => {
    const s = storage(); s.origens.set('o', APROVADO)
    const f = await fixarArquivoAprovado({ workspaceId: 'ws1', origem: 'o' }, s.portas)
    assert.equal(await s.portas.subirSemSobrescrever(f.caminho, TROCADO), 'JA_EXISTE')
    assert.deepEqual(s.plataformaLe(f.url), APROVADO)
  })
  test('entradas inválidas: sem origem, vazio, workspace com barra, sha inválido', async () => {
    const s = storage(); s.origens.set('vazio', Buffer.alloc(0)); s.origens.set('o', APROVADO)
    await assert.rejects(fixarArquivoAprovado({ workspaceId: 'ws1', origem: '' }, s.portas))
    await assert.rejects(fixarArquivoAprovado({ workspaceId: 'ws1', origem: 'vazio' }, s.portas), /vazio/)
    await assert.rejects(fixarArquivoAprovado({ workspaceId: '../ws2', origem: 'o' }, s.portas), /workspace/)
    assert.throws(() => caminhoImutavel('ws1', 'abc'), /sha256/)
  })
})

describe('a peça só sai do caminho imutável do hash liberado', () => {
  const S = sha(APROVADO)
  test('assetNoCaminhoImutavel: só a URL assinada do bucket privado, do workspace e do sha certos', () => {
    assert.equal(assetNoCaminhoImutavel(`${URL_BASE}ws1/aprovados/${S}.mp4?token=t`, 'ws1', S, ENV), true)
    assert.equal(assetNoCaminhoImutavel(`${URL_BASE}ws1/aprovados/${sha(TROCADO)}.mp4?token=t`, 'ws1', S, ENV), false)
    assert.equal(assetNoCaminhoImutavel(`${URL_BASE}ws2/aprovados/${S}.mp4?token=t`, 'ws1', S, ENV), false)
    assert.equal(assetNoCaminhoImutavel(`https://proj.test/storage/v1/object/sign/videos/ws1/aprovados/${S}.mp4`, 'ws1', S, ENV), false)
    assert.equal(assetNoCaminhoImutavel(`https://proj.test/storage/v1/object/public/midias-privadas/ws1/aprovados/${S}.mp4`, 'ws1', S, ENV), false)
    assert.equal(assetNoCaminhoImutavel('https://x.test/base.mp4', 'ws1', S, ENV), false)
    // revisão, achado 16: mesmo caminho em OUTRO host (storage de terceiro) não vale; sem o host do projeto, nada vale
    assert.equal(assetNoCaminhoImutavel(`https://outro.test/storage/v1/object/sign/midias-privadas/ws1/aprovados/${S}.mp4`, 'ws1', S, ENV), false)
    assert.equal(assetNoCaminhoImutavel(`${URL_BASE}ws1/aprovados/${S}.mp4`, 'ws1', S, {}), false)
    assert.equal(assetNoCaminhoImutavel(`${URL_BASE}ws1/aprovados/${S}.mp4`, 'ws1', null, ENV), false)
  })
  test('orquestrador: videoUrl trocado depois da liberação → ARQUIVO_DIFERENTE_DO_APROVADO, nada enviado', async () => {
    let chamou = false
    const adaptadores = { tiktok: { canal: 'tiktok', publicar: async () => { chamou = true; return { ok: true, publicacaoExternaId: 'x' } } } } as never
    const r = await distribuirConteudo({ workspaceId: 'ws1', contentId: 'c', canal: 'tiktok', chaveDaTentativa: 'k', adaptadores, contexto: {} as never, conteudo: { assetUrl: 'https://x.test/outro.mp4' } as never, arquivoAprovadoSha256: S, env: ENV })
    assert.equal(r.motivoDaEspera, 'ARQUIVO_DIFERENTE_DO_APROVADO')
    assert.equal(chamou, false)
    const semSha = await distribuirConteudo({ workspaceId: 'ws1', contentId: 'c', canal: 'tiktok', chaveDaTentativa: 'k', adaptadores, contexto: {} as never, conteudo: { assetUrl: `${URL_BASE}ws1/aprovados/${S}.mp4` } as never, arquivoAprovadoSha256: null, env: ENV })
    assert.equal(semSha.motivoDaEspera, 'ARQUIVO_DIFERENTE_DO_APROVADO')
  })
  test('adaptador do TikTok: bytes baixados com hash diferente do aprovado → recusa ANTES de falar com o TikTok', async () => {
    const chamadas: string[] = []
    const fetcher = (async (u: string) => { chamadas.push(String(u)); return new Response('{}') }) as unknown as typeof fetch
    const ad = criarAdaptadorTikTok({ fetcher, obterToken: async () => ({ accessToken: 't', openId: 'o', scope: 'video.upload' }), baixarVideo: async () => TROCADO })
    const pedido = { canal: 'tiktok', workspaceId: 'ws1', publicacaoId: 'p', legenda: 'x', urlParaDivulgar: '', assetUrl: `${URL_BASE}ws1/aprovados/${S}.mp4`, formato: 'VIDEO_PROPRIO', sha256Esperado: S }
    const r = await ad.enviarDraft!(pedido)
    assert.equal(r.ok, false)
    assert.match(r.erro ?? '', /não é o arquivo aprovado/)
    assert.equal(r.fatal, true)
    assert.deepEqual(chamadas, [])
    const vazio = await ad.enviarDraft!({ ...pedido, sha256Esperado: null })
    assert.equal(vazio.ok, false)
  })
})

describe('storage REAL do projeto de TESTE: upload sem upsert recusa sobrescrever', () => {
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').includes('ref-teste-exemplo') || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    test('pulado: só com o storage do projeto de TESTE', { skip: true }, () => {})
    return
  }
  test('corrida real: 5 uploads simultâneos de conteúdos diferentes no mesmo caminho → exatamente 1 CRIADO; o objeto é o do vencedor', async () => {
    const { uploadBufferPrivadoSemSobrescrever, deleteFilePrivado, criarUrlAssinada } = await import('../lib/supabase')
    const caminho = `teste-r161/aprovados/${randomBytes(32).toString('hex')}.mp4`
    const versoes = Array.from({ length: 5 }, (_, i) => Buffer.from(`versao-${i}-${randomBytes(8).toString('hex')}`))
    try {
      const r = await Promise.all(versoes.map((v) => uploadBufferPrivadoSemSobrescrever(v, 'midias-privadas', caminho, 'video/mp4')))
      assert.equal(r.filter((x) => x === 'CRIADO').length, 1, JSON.stringify(r))
      const lido = Buffer.from(await (await fetch(await criarUrlAssinada('midias-privadas', caminho, 60))).arrayBuffer())
      assert.deepEqual(lido, versoes[r.indexOf('CRIADO')])
      assert.equal(await uploadBufferPrivadoSemSobrescrever(Buffer.from('depois'), 'midias-privadas', caminho, 'video/mp4'), 'JA_EXISTE')
      const deNovo = Buffer.from(await (await fetch(await criarUrlAssinada('midias-privadas', caminho, 60))).arrayBuffer())
      assert.deepEqual(deNovo, versoes[r.indexOf('CRIADO')])
    } finally {
      await deleteFilePrivado('midias-privadas', caminho).catch(() => {})
    }
  })
})

describe('revisão P2.69+ (achados 11/12): o vínculo vem do banco e o Instagram reconfere', () => {
  test('urlConferidaDoArquivoAprovado: objeto trocado no caminho → recusa; íntegro → URL nova', async () => {
    const S = sha(APROVADO)
    const caminho = caminhoImutavel('ws1', S)
    const portas = (b: Buffer) => ({ ler: async () => b, urlDeLeitura: async (c: string) => `${URL_BASE}${c}?token=novo` })
    assert.equal(await urlConferidaDoArquivoAprovado({ sha256: S, caminho }, portas(APROVADO)), `${URL_BASE}${caminho}?token=novo`)
    await assert.rejects(urlConferidaDoArquivoAprovado({ sha256: S, caminho }, portas(TROCADO)), /não confere/)
  })
  if (!(process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')) {
    test('pulado: vínculo pelo banco só com o banco de TESTE', { skip: true }, () => {})
    return
  }
  test('banco de TESTE: peça de assistida sem arquivo fixado → recusa; com arquivo → sha; peça avulsa → não se aplica', async () => {
    const { prisma } = await import('../lib/prisma')
    const { vinculoDoArquivoAprovado } = await import('../lib/arquivo-aprovado-vinculo')
    const marca = `r161-${Date.now()}`
    const ws = (await prisma.workspace.create({ data: { name: 'R161', ownerId: marca }, select: { id: true } })).id
    const S = sha(APROVADO)
    try {
      const base = { workspaceId: ws, estado: 'APROVADO', nomeProduto: 'P', varianteId: 'v', estrutura: 'e', motivoEscolha: 't', objetivoDoTeste: 't', metasIds: [], qualityGate: {} }
      await prisma.publicacaoAssistida.create({ data: { ...base, conteudoId: `${marca}-sem`, apresentacao: {} } })
      const T = hashDoTexto('Legenda aprovada #publi')
      const reg = (ws2: string, extra: object = {}) => ({ sha256: S, caminho: caminhoImutavel(ws2, S), tamanho: 1, versao: 1, versaoEscolhida: 'ORIGINAL', origem: 'orig.mp4', textoSha256: T, ...extra })
      const video = { arquivo: 'orig.mp4' }
      await prisma.publicacaoAssistida.create({ data: { ...base, versao: 1, conteudoId: `${marca}-com`, apresentacao: { video, arquivoAprovado: reg(ws) } } })
      await prisma.publicacaoAssistida.create({ data: { ...base, versao: 1, conteudoId: `${marca}-outro-ws`, apresentacao: { video, arquivoAprovado: reg('outro') } } })
      // 3ª revisão, achado 1: registro de versão anterior, de outra escolha, em estado que não envia, ou da narrada
      await prisma.publicacaoAssistida.create({ data: { ...base, versao: 2, conteudoId: `${marca}-velho`, apresentacao: { video, arquivoAprovado: reg(ws) } } })
      await prisma.publicacaoAssistida.create({ data: { ...base, versao: 1, conteudoId: `${marca}-outra-escolha`, apresentacao: { video, arquivoAprovado: reg(ws, { versaoEscolhida: 'NARRADA' }) } } })
      await prisma.publicacaoAssistida.create({ data: { ...base, versao: 1, estado: 'AGUARDANDO_APROVACAO', conteudoId: `${marca}-estado`, apresentacao: { video, arquivoAprovado: reg(ws) } } })
      // 4ª revisão, achado 8: vídeo gerado de novo na MESMA versão (origem diferente)
      await prisma.publicacaoAssistida.create({ data: { ...base, versao: 1, conteudoId: `${marca}-regerado`, apresentacao: { video: { arquivo: 'novo.mp4' }, arquivoAprovado: reg(ws) } } })
      // P2.72: registro anterior ao texto aprovado (sem textoSha256) não vale
      await prisma.publicacaoAssistida.create({ data: { ...base, versao: 1, conteudoId: `${marca}-sem-texto`, apresentacao: { video, arquivoAprovado: reg(ws, { textoSha256: undefined }) } } })
      await prisma.publicacaoAssistida.create({ data: { ...base, versao: 1, conteudoId: `${marca}-narrada`, apresentacao: { versaoEscolhida: 'NARRADA', arquivoAprovado: reg(ws, { versaoEscolhida: 'NARRADA' }) } } })
      assert.deepEqual(await vinculoDoArquivoAprovado(ws, `${marca}-avulsa`), { aplica: false })
      assert.ok((await vinculoDoArquivoAprovado(ws, `${marca}-sem`) as { erro?: string }).erro)
      assert.deepEqual(await vinculoDoArquivoAprovado(ws, `${marca}-com`), { aplica: true, sha256: S, caminho: caminhoImutavel(ws, S), textoSha256: T })
      assert.ok((await vinculoDoArquivoAprovado(ws, `${marca}-outro-ws`) as { erro?: string }).erro)
      for (const c of ['velho', 'outra-escolha', 'estado', 'narrada', 'regerado', 'sem-texto']) assert.ok((await vinculoDoArquivoAprovado(ws, `${marca}-${c}`) as { erro?: string }).erro, c)
    } finally {
      await prisma.publicacaoAssistida.deleteMany({ where: { workspaceId: ws } })
      await prisma.workspace.deleteMany({ where: { id: ws } })
      await prisma.$disconnect()
    }
  })
})

describe('revisão P2.72: texto aprovado no vínculo, dispensa só no executor de testes', () => {
  const S = sha(APROVADO)
  test('hashDoTexto: normaliza fim de linha e bordas; texto diferente → hash diferente', () => {
    assert.equal(hashDoTexto('  Oferta #publi\r\nLinha 2 '), hashDoTexto('Oferta #publi\nLinha 2'))
    assert.notEqual(hashDoTexto('Oferta #publi'), hashDoTexto('Oferta'))
    assert.equal(hashDoTexto(null), hashDoTexto(''))
  })
  test('registroDoArquivoValido exige textoSha256 válido', () => {
    const base = { workspaceId: 'ws1', estado: 'APROVADO', versao: 1 }
    const reg = (extra: object) => ({ video: { arquivo: 'o.mp4' }, arquivoAprovado: { sha256: S, caminho: caminhoImutavel('ws1', S), versao: 1, versaoEscolhida: 'ORIGINAL', origem: 'o.mp4', ...extra } })
    assert.equal(registroDoArquivoValido({ ...base, apresentacao: reg({}) }), null)
    assert.equal(registroDoArquivoValido({ ...base, apresentacao: reg({ textoSha256: 'abc' }) }), null)
    assert.deepEqual(registroDoArquivoValido({ ...base, apresentacao: reg({ textoSha256: hashDoTexto('x') }) }), { sha256: S, caminho: caminhoImutavel('ws1', S), textoSha256: hashDoTexto('x') })
  })
  test('dispensa legada: só dentro do node:test, nunca com PATRONO_AMBIENTE=producao', () => {
    const antes = { flag: process.env.PATRONO_TESTE_LEGADO_SEM_TRES_CONTROLES, ctx: process.env.NODE_TEST_CONTEXT }
    try {
      process.env.PATRONO_TESTE_LEGADO_SEM_TRES_CONTROLES = 'true'
      process.env.NODE_TEST_CONTEXT = antes.ctx ?? 'child-v8'
      assert.equal(dispensaLegadaAtiva({}), true)
      assert.equal(dispensaLegadaAtiva({ PATRONO_AMBIENTE: 'producao' }), false)
      delete process.env.NODE_TEST_CONTEXT // servidor, Preview, script: nunca
      assert.equal(dispensaLegadaAtiva({}), false)
    } finally {
      if (antes.flag === undefined) delete process.env.PATRONO_TESTE_LEGADO_SEM_TRES_CONTROLES; else process.env.PATRONO_TESTE_LEGADO_SEM_TRES_CONTROLES = antes.flag
      if (antes.ctx === undefined) delete process.env.NODE_TEST_CONTEXT; else process.env.NODE_TEST_CONTEXT = antes.ctx
    }
  })
  if (!(process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')) {
    test('pulado: orquestrador pelo banco só com o banco de TESTE', { skip: true }, () => {})
    return
  }
  test('banco de TESTE: orquestrador recusa legenda diferente do texto aprovado (TEXTO_DIFERENTE_DO_APROVADO), nada enviado', async () => {
    const { prisma } = await import('../lib/prisma')
    const marca = `r161t-${Date.now()}`
    const ws = (await prisma.workspace.create({ data: { name: 'R161T', ownerId: marca }, select: { id: true } })).id
    try {
      const user = (await prisma.user.create({ data: { email: `${marca}@teste.local`, name: 'U', password: 'x', workspaceId: ws }, select: { id: true } })).id
      const produto = (await prisma.produto.create({ data: { workspaceId: ws, userId: user, nome: `${marca}-p`, categoria: 'x', tipoVenda: 'Afiliado', origemConteudo: 'Proprio', linkProduto: 'https://loja.invalido/p' }, select: { id: true } })).id
      const host = process.env.NEXT_PUBLIC_SUPABASE_URL
      const videoUrl = `${host}/storage/v1/object/sign/midias-privadas/${ws}/aprovados/${S}.mp4?token=t`
      const peca = async (legendaTiktok: string) => (await prisma.conteudo.create({ data: { workspaceId: ws, userId: user, produtoId: produto, roteiro: 'x', redeSocial: 'tiktok', legendaTiktok, videoUrl }, select: { id: true } })).id
      const trocada = await peca('Legenda TROCADA depois da aprovação')
      const igual = await peca('Legenda aprovada #publi')
      const base = { workspaceId: ws, estado: 'APROVADO', versao: 1, nomeProduto: 'P', varianteId: 'v', estrutura: 'e', motivoEscolha: 't', objetivoDoTeste: 't', metasIds: [], qualityGate: {} }
      const reg = { sha256: S, caminho: caminhoImutavel(ws, S), tamanho: 1, versao: 1, versaoEscolhida: 'ORIGINAL', origem: 'orig.mp4', textoSha256: hashDoTexto('Legenda aprovada #publi') }
      for (const c of [trocada, igual]) await prisma.publicacaoAssistida.create({ data: { ...base, conteudoId: c, apresentacao: { video: { arquivo: 'orig.mp4' }, arquivoAprovado: reg } } })
      let chamou = false
      const adaptadores = { tiktok: { canal: 'tiktok', publicar: async () => { chamou = true; return { ok: true, publicacaoExternaId: 'x' } } } } as never
      const r1 = await distribuirConteudo({ workspaceId: ws, contentId: trocada, canal: 'tiktok', chaveDaTentativa: `${marca}-1`, adaptadores })
      assert.equal(r1.motivoDaEspera, 'TEXTO_DIFERENTE_DO_APROVADO')
      // sha informado pelo chamador diferente do registro do banco: recusa também
      const r2 = await distribuirConteudo({ workspaceId: ws, contentId: igual, canal: 'tiktok', chaveDaTentativa: `${marca}-2`, adaptadores, arquivoAprovadoSha256: sha(TROCADO) })
      assert.equal(r2.motivoDaEspera, 'ARQUIVO_DIFERENTE_DO_APROVADO')
      // texto igual: passa da conferência do texto (para na releitura do arquivo, que não existe no storage)
      const r3 = await distribuirConteudo({ workspaceId: ws, contentId: igual, canal: 'tiktok', chaveDaTentativa: `${marca}-3`, adaptadores })
      assert.equal(r3.motivoDaEspera, 'ARQUIVO_DIFERENTE_DO_APROVADO')
      assert.equal(chamou, false)
    } finally {
      await prisma.publicacaoAssistida.deleteMany({ where: { workspaceId: ws } })
      await prisma.conteudo.deleteMany({ where: { workspaceId: ws } })
      await prisma.produto.deleteMany({ where: { workspaceId: ws } })
      await prisma.user.deleteMany({ where: { workspaceId: ws } })
      await prisma.workspace.deleteMany({ where: { id: ws } })
    }
  })
})
