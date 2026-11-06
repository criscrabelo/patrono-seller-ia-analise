/**
 * P2.34 — QUALIDADE COMERCIAL (começando por LIVROS) + TRILHA (P2.32) + pacote de publicação.
 *
 * Trava o defeito real do 1º ciclo: o roteiro genérico PROBLEMA_SOLUCAO aplicado ao Livro Emocionário
 * ("problema em casa", "Olha como funciona", "Funcionando de verdade", "Resultado final") passava na checagem.
 * Agora: livro só recebe formatos e textos que um livro sustenta; a checagem aponta texto incoerente; o vídeo
 * final avisa leitura rápida e troca de imagem no meio do gancho; a trilha é só PERFIL (nunca música inventada).
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { planejarVideos, estruturasPossiveis, ehLivro } from '../lib/motor-de-videos-tiktok'
import { avaliarVideo, textosIncoerentesComOProduto } from '../lib/quality-gate-video-tiktok'
import { qualityGateDoVideoFinal, cenasDoVideo } from '../lib/video-assistido'
import { perfilSonoroDoVideo, normalizarSomUsado } from '../lib/trilha-sonora'
// P2.69: este arquivo testa qualidade comercial e trilha (não a liberação). O registro manual do link passou a exigir a
// liberação completa; como os demais testes anteriores a essa regra, usa a dispensa de teste legado (recusada em Production).
process.env.PATRONO_TESTE_LEGADO_SEM_TRES_CONTROLES = 'true'

const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')
const agora = new Date('2026-10-19T12:00:00-03:00')
const livro = { nome: 'Livro Emocionário', categoria: 'Papelaria', preco: null, tiktokShop: true }
const ROTEIRO_ANTIGO = {
  gancho: 'Se você tem esse problema em casa, olha isso.', cta: 'Toque no produto marcado no vídeo.',
  legenda: 'Se você tem esse problema em casa, olha isso.\n\nToque no produto marcado no vídeo.\n\nEste conteúdo contém link de afiliado — posso ganhar uma comissão sobre a venda.\n\n#tiktokshop #achadinhos',
  hashtags: ['#tiktokshop', '#achadinhos'], objetivo: 'VENDA', estrutura: 'PROBLEMA_SOLUCAO', duracaoSegundos: 15, exigeExperienciaReal: false,
  roteiro: [
    { etapa: 'Problema', texto: 'Mostre a situação do dia a dia que o produto resolve.', textoNaTela: 'O problema 👇' },
    { etapa: 'Demonstração', texto: 'Mostre o produto (Livro Emocionário) em uso, de perto, nos primeiros 5 segundos.', textoNaTela: 'Olha como funciona' },
    { etapa: 'Benefício', texto: 'Mostre na prática o principal benefício do produto.', textoNaTela: 'O que muda na prática' },
    { etapa: 'Prova', texto: 'Mostre o produto funcionando de verdade, sem cortes enganosos.', textoNaTela: 'Funcionando de verdade' },
    { etapa: 'Desejo', texto: 'Feche com o resultado final bonito na tela.', textoNaTela: 'Resultado final' },
  ],
}

describe('P2.34 — Livros: formatos, roteiro e checagem (puro)', () => {
  test('livro é reconhecido pela categoria ou pelo nome; outros produtos não', () => {
    assert.equal(ehLivro(livro), true)
    assert.equal(ehLivro({ nome: 'Dicionário ilustrado', categoria: null }), true)
    assert.equal(ehLivro({ nome: 'Organizador de gaveta', categoria: 'Casa e Decoração' }), false)
    assert.equal(ehLivro({ nome: 'Livreto de receitas', categoria: null }), false, 'só a palavra inteira')
  })

  test('livro só recebe formatos que ele sustenta (nada de problema/solução, demonstração ou resultado)', () => {
    const e = estruturasPossiveis(livro, agora)
    assert.ok(e.length > 0)
    for (const x of e) assert.ok(['ACHADO_TIKTOK_SHOP', 'PRESENTE', 'NATAL'].includes(x), x)
    const outro = estruturasPossiveis({ nome: 'Organizador de gaveta', categoria: 'Casa e Decoração', preco: 39, tiktokShop: true }, agora)
    assert.ok(outro.includes('PROBLEMA_SOLUCAO') && outro.includes('DEMONSTRACAO'), 'outras categorias intactas')
  })

  test('o plano de um livro: nenhum texto incoerente na tela/legenda e checagem APROVADA', () => {
    const plano = planejarVideos(livro, agora)
    for (const v of plano.variantes) {
      const visivel = [v.gancho, v.legenda, v.cta, ...v.roteiro.map((r) => r.textoNaTela ?? '')].join(' ')
      assert.deepEqual(textosIncoerentesComOProduto(visivel, livro), [], `${v.id}: ${visivel}`)
      const qg = avaliarVideo({ ...v, exigeExperienciaReal: false }, { tiktokShop: true, produto: livro })
      assert.equal(qg.veredito, 'APROVADO', `${v.id}: ${qg.motivos.join('; ')}`)
    }
  })

  test('o roteiro genérico que foi aplicado ao Emocionário agora é apontado (REVISAR) — antes passava', () => {
    const sem = avaliarVideo(ROTEIRO_ANTIGO, { tiktokShop: true })
    assert.equal(sem.veredito, 'APROVADO', 'sem saber o produto, a checagem antiga aprovava')
    const com = avaliarVideo(ROTEIRO_ANTIGO, { tiktokShop: true, produto: livro })
    assert.equal(com.veredito, 'REVISAR')
    assert.ok(com.motivos.some((m) => /incoerente com o produto \(livro\).*problema em casa/.test(m)), com.motivos.join(' | '))
    const outro = avaliarVideo(ROTEIRO_ANTIGO, { tiktokShop: true, produto: { nome: 'Organizador de gaveta', categoria: 'Casa e Decoração' } })
    assert.equal(outro.veredito, 'APROVADO', 'para um organizador o roteiro continua válido')
  })

  test('vídeo final: incoerência queimada → REVISAR; leitura rápida → aviso; troca no meio do gancho → aviso', () => {
    const roteiroOk = { veredito: 'APROVADO' as const, notas: {}, riscoDeCompliance: 'BAIXO' as const, motivos: [], resumo: 'ok' } as unknown as Parameters<typeof qualityGateDoVideoFinal>[0]['roteiro']
    const reel = { valido: true, problemas: [], metadados: { duracaoS: 15, largura: 1080, altura: 1920 }, tamanhoBytes: 1 } as unknown as Parameters<typeof qualityGateDoVideoFinal>[0]['reel']
    const base = { roteiro: roteiroOk, reel, duracaoPlanejada: 15, direito: { publicavel: true, motivo: 'ok' } }
    const cenasAntigas = cenasDoVideo(ROTEIRO_ANTIGO, 'Livro Emocionário', 'IMAGEM')
    assert.equal(qualityGateDoVideoFinal({ ...base, cenas: cenasAntigas, produto: livro }).veredito, 'REVISAR')
    assert.equal(qualityGateDoVideoFinal({ ...base, cenas: cenasAntigas }).veredito, 'APROVADO', 'sem o produto, nada muda (compatível)')
    const rapida = [{ texto: 'Um texto enorme que ninguém consegue ler em um segundo só', inicio: 0, fim: 1, posicao: 'topo' as const }, { texto: 'a', inicio: 1, fim: 2, posicao: 'centro' as const }, { texto: 'b', inicio: 2, fim: 3, posicao: 'centro' as const }]
    const qgRapida = qualityGateDoVideoFinal({ ...base, cenas: rapida })
    assert.equal(qgRapida.veredito, 'APROVADO', 'leitura rápida é AVISO (não derruba o vídeo)')
    assert.ok(qgRapida.motivos.some((m) => /rápido demais para ler/.test(m)), 'mas a titular vê o aviso')
    const v3 = [{ texto: 'Seu filho consegue\ndizer o que sente?', inicio: 0, fim: 3, posicao: 'topo' as const }, { texto: 'Livro Emocionário', inicio: 3, fim: 6, posicao: 'rodape' as const }, { texto: 'Toque no produto\nmarcado e conheça o livro.', inicio: 12, fim: 15, posicao: 'centro' as const }]
    const com7 = qualityGateDoVideoFinal({ ...base, cenas: v3, trechos: 7, produto: livro })
    assert.equal(com7.veredito, 'APROVADO')
    assert.ok(com7.motivos.some((m) => /troca no meio do gancho/.test(m)), '7 trechos: aviso de sincronia')
    const com5 = qualityGateDoVideoFinal({ ...base, cenas: v3, trechos: 5, produto: livro })
    assert.ok(!com5.motivos.some((m) => /troca no meio/.test(m)), '5 trechos de 3 s: gancho e CTA sobre uma imagem só')
  })
})

describe('P2.32 — trilha (puro): perfil, nunca música inventada', () => {
  test('livro: instrumental, delicado, calmo, acompanhando as trocas', () => {
    const p = perfilSonoroDoVideo({ nome: 'Livro Emocionário', categoria: 'Papelaria', estrutura: 'PRESENTE', duracaoSegundos: 15, trechos: 5, temTextoNaTela: true })
    assert.equal(p.instrumental, true)
    assert.equal(p.andamento, 'CALMO')
    assert.ok(p.clima.includes('delicado') && p.clima.includes('acolhedor'))
    assert.equal(p.trocaACadaS, 3)
    assert.match(p.aviso, /não sabe quais músicas estão em alta/)
    assert.ok(p.comoEscolherNoApp.some((x) => /comerciais/.test(x)))
    assert.ok(!JSON.stringify(p).match(/feat\.|remix|— [A-Z]/), 'nenhum nome de música/artista')
  })
  test('narração → só instrumental; Beleza → animado; som usado é texto limpo e limitado', () => {
    assert.equal(perfilSonoroDoVideo({ nome: 'Batom', categoria: 'Beleza', temNarracao: true }).instrumental, true)
    assert.equal(perfilSonoroDoVideo({ nome: 'Batom', categoria: 'Beleza' }).andamento, 'ANIMADO')
    assert.equal(normalizarSomUsado('  Piano   suave  '), 'Piano suave')
    assert.equal(normalizarSomUsado(''), null)
    assert.equal(normalizarSomUsado('x'.repeat(300))!.length, 120)
  })
})

describe('P2.34 — banco de TESTE: livro na jornada + som usado no registro', { skip: !TEM_BANCO ? 'exige banco de TESTE' : false, timeout: 600_000 }, () => {
  let prisma: typeof import('../lib/prisma').prisma
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  const PREFIXO = 'Conta de Teste — '
  const marca = `r123-${Date.now()}`
  const workspaces: string[] = []
  before(async () => { ;[{ prisma }, { limparWorkspaceDeTeste: limpar }] = await Promise.all([import('../lib/prisma'), import('./_limpar-workspace-de-teste')]) })
  after(async () => {
    if (prisma) for (const w of workspaces) {
      await prisma.domainEvent.deleteMany({ where: { workspaceId: w } }).catch(() => null)
      await prisma.decisionRecord.deleteMany({ where: { workspaceId: w } }).catch(() => null)
      await limpar(prisma, w, PREFIXO)
    }
    await prisma?.$disconnect()
  })

  test('um LIVRO real na jornada recebe formato e texto de livro (nunca "problema em casa"/"funcionando")', async () => {
    const J = await import('../lib/jornada')
    const ws = (await prisma.workspace.create({ data: { name: `${PREFIXO}livro r123`, ownerId: marca }, select: { id: true } })).id
    workspaces.push(ws)
    const u = (await prisma.user.create({ data: { email: `${marca}@teste.local`, name: 'U', password: 'x', workspaceId: ws }, select: { id: true } })).id
    const cand = (await prisma.candidatoDeProduto.create({ data: {
      workspaceId: ws, chaveDeOrigem: `${marca}-livro`, fonte: 'USER_PROVIDED', nome: 'FIXTURE Livro de emoções', categoria: 'Papelaria', providerId: 'tiktok-shop', externalId: '9000000123001',
      linkProduto: 'https://shop.tiktok.com/br/pdp/9000000123001', score: 50, baseDeEvidencia: 40, confianca: 'SEM_HISTORICO_REAL', status: 'NOVO', coletadoEm: new Date(), validoAte: new Date('2027-06-01'),
      compradoPelaTitular: true, motivosPositivos: [], riscos: [], desconhecidos: [], porqueDestaPosicao: [], nivelDeRisco: 'BAIXO',
    }, select: { id: true } })).id
    const v = J.visaoDaOperacao(await J.escolherProduto({ workspaceId: ws, userId: u, candidatoId: cand, emMaos: true }))
    const ap = v.prioritaria!.assistida!.apresentacao as { versao: { estrutura: string; gancho: string; legenda: string; cta: string; roteiro: { textoNaTela: string | null }[] } }
    assert.ok(['ACHADO_TIKTOK_SHOP', 'PRESENTE', 'NATAL'].includes(ap.versao.estrutura), ap.versao.estrutura)
    const visivel = [ap.versao.gancho, ap.versao.legenda, ap.versao.cta, ...ap.versao.roteiro.map((r) => r.textoNaTela ?? '')].join(' ')
    assert.deepEqual(textosIncoerentesComOProduto(visivel, { nome: 'Livro', categoria: 'Papelaria' }), [], visivel)
    const qg = (await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id: v.prioritaria!.assistida!.id } })).qualityGate as { veredito: string }
    assert.equal(qg.veredito, 'APROVADO')
  })

  test('registro da publicação: o "som que usei" fica como INFORMADO PELA TITULAR (não é confirmação da plataforma)', async () => {
    const A = await import('../lib/publicacao-assistida')
    const ws = (await prisma.workspace.create({ data: { name: `${PREFIXO}som r123`, ownerId: `${marca}-som` }, select: { id: true } })).id
    workspaces.push(ws)
    const u = (await prisma.user.create({ data: { email: `${marca}-som@teste.local`, name: 'U', password: 'x', workspaceId: ws }, select: { id: true } })).id
    const versao = { gancho: 'Uma ideia de presente: um livro.', cta: 'Toque no produto marcado no vídeo.', legenda: 'L', hashtags: [], estrutura: 'PRESENTE', duracaoSegundos: 15, roteiro: [] }
    const a = await prisma.publicacaoAssistida.create({ data: {
      workspaceId: ws, varianteId: 'PRESENTE-A-CURTA', estrutura: 'PRESENTE', estado: 'APROVADO', nomeProduto: 'FIXTURE Livro', candidatoId: `${marca}-cand`,
      apresentacao: { versao, produto: { nome: 'FIXTURE Livro', categoria: 'Papelaria', tiktokShop: true }, video: { situacao: 'GERADO', arquivo: 'https://x/v.mp4' } }, qualityGate: {}, motivoEscolha: 'm', objetivoDoTeste: 'o', metasIds: [], versaoFinal: versao,
    } })
    await A.registrarPublicacaoManual({ workspaceId: ws, userId: u, id: a.id, url: 'https://www.tiktok.com/@sintetica/video/7400000000000000123', som: '  Piano   suave  ' })
    const d = await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id: a.id } })
    assert.equal(d.estado, 'PUBLICADO')
    assert.deepEqual((d.apresentacao as { somUsado: { texto: string; fonte: string } }).somUsado.texto, 'Piano suave')
    assert.equal((d.apresentacao as { somUsado: { fonte: string } }).somUsado.fonte, 'INFORMADO_PELA_TITULAR')
  })
})
