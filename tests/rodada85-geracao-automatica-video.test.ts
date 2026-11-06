/**
 * P2.17.12 (Parte A) — Geração AUTOMÁTICA do vídeo do modo assistido:
 * fonte única de mídia, política de formatos, cenas honestas, Quality Gate
 * do ARQUIVO, trabalho longo e central (aprovação só com o MP4).
 * Produtos e mídias abaixo são FIXTURE (dados fictícios).
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  politicaDoFormato, formatoServeComFoto, ordemDasVariantes, cenasDoVideo, textoParaTela, quebrarLinhas, qualityGateDoVideoFinal,
  estadoPeloVideo, videoInicial, FORMATOS_COM_IMAGEM, MAXIMO_DE_TENTATIVAS_DE_RENDER,
} from '../lib/video-assistido'
import { classificarMidia, type DeclaracaoDaMidia } from '../lib/midia-do-produto'
import { escolherVariante, temVideoGerado } from '../lib/publicacao-assistida'
import { planejarVideos, EXIGE_EXPERIENCIA } from '../lib/motor-de-videos-tiktok'
import { avaliarVideo } from '../lib/quality-gate-video-tiktok'
import { TIPOS_DE_TRABALHO_LONGO } from '../lib/trabalho-longo'
import { TIPOS_DE_ENTIDADE } from '../lib/automation-queue-entidades'
import { regraDaRota } from '../lib/modulos-rotas'
// P2.45: este arquivo testa o fluxo de publicação ANTERIOR aos três controles (técnico, comercial, conformidade).
process.env.PATRONO_TESTE_LEGADO_SEM_TRES_CONTROLES = 'true'

const ENV = { NEXT_PUBLIC_SUPABASE_URL: 'https://ref-teste-exemplo.supabase.co' }
const custodia = (c: string) => `${ENV.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${c}`
const decl = (m: Partial<DeclaracaoDaMidia>): DeclaracaoDaMidia => ({
  url: custodia('imagens/fixture.png'), tipo: 'IMAGEM', origem: 'PROPRIO', titularidade: 'eu', direitoDeUso: 'minhas redes', descricao: 'FIXTURE',
  declaradoPor: 'u1', declaradoEm: new Date('2026-10-11T12:00:00Z'), ...m,
})

describe('P2.17.12 — fonte única de mídia: AUTORIZADA / NÃO CONFIRMADA / BLOQUEADA', () => {
  test('foto própria, declarada e em custódia: AUTORIZADA (régua do preflight)', () => {
    assert.equal(classificarMidia(decl({}), ENV).status, 'AUTORIZADA')
  })
  test('foto do vendedor (host de marketplace) ou origem FORNECEDOR/PLATAFORMA: BLOQUEADA, sem "autorizar por declaração"', () => {
    assert.equal(classificarMidia(decl({ url: 'https://down-br.img.susercontent.com/file/x.jpg' }), ENV).status, 'BLOQUEADA')
    assert.equal(classificarMidia(decl({ url: 'https://p16-oec-va.ibyteimg.com/x.jpg' }), ENV).status, 'BLOQUEADA')
    assert.match(classificarMidia(decl({ origem: 'FORNECEDOR' }), ENV).motivo, /TikTok Shop proíbe/)
    assert.equal(classificarMidia(decl({ origem: 'PLATAFORMA' }), ENV).status, 'BLOQUEADA')
  })
  test('falta evidência: NÃO CONFIRMADA (sem custódia, sem quem/quando, licença sem termo, vídeo próprio sem declarações)', () => {
    assert.equal(classificarMidia(decl({ url: 'https://exemplo.com/foto.png' }), ENV).status, 'NAO_CONFIRMADA')
    assert.equal(classificarMidia(decl({ declaradoPor: null }), ENV).status, 'NAO_CONFIRMADA')
    assert.equal(classificarMidia(decl({ origem: 'LICENCIADO' }), ENV).status, 'NAO_CONFIRMADA')
    assert.equal(classificarMidia(decl({ origem: 'LICENCIADO', termoDeLicenca: 'Termo 12/2026' }), ENV).status, 'AUTORIZADA')
    assert.equal(classificarMidia(decl({ origem: 'DESCONHECIDA' }), ENV).status, 'NAO_CONFIRMADA')
    const video = decl({ tipo: 'VIDEO', url: custodia('videos/fixture.mp4') })
    assert.equal(classificarMidia(video, ENV).status, 'NAO_CONFIRMADA')
    assert.equal(classificarMidia({ ...video, declaracoes: { gravadoPelaPropriaDona: true, semMusicaDeTerceiros: true, semTerceirosNemCriancas: true } }, ENV).status, 'AUTORIZADA')
  })
  test('gerada pelo Patrono exige o id da geração', () => {
    assert.equal(classificarMidia(decl({ origem: 'GERADO_PELO_PATRONO' }), ENV).status, 'NAO_CONFIRMADA')
    assert.equal(classificarMidia(decl({ origem: 'GERADO_PELO_PATRONO', geracaoId: 'g1' }), ENV).status, 'AUTORIZADA')
  })
})

describe('P2.17.12 — formatos automáticos × bloqueados sem evidência', () => {
  const FOTO = [{ tipo: 'IMAGEM' as const, origem: 'PROPRIO' as const }]
  const VIDEO_LIC = [{ tipo: 'VIDEO' as const, origem: 'LICENCIADO' as const }]
  const VIDEO_PROPRIO = [{ tipo: 'VIDEO' as const, origem: 'PROPRIO' as const }]
  test('com FOTO: PROBLEMA_SOLUCAO, LISTA_3_MOTIVOS, ACHADO, PRESENTE, NATAL, POV, UTILIDADE', () => {
    for (const e of ['PROBLEMA_SOLUCAO', 'LISTA_3_MOTIVOS', 'ACHADO_TIKTOK_SHOP', 'PRESENTE', 'NATAL', 'POV', 'UTILIDADE']) assert.equal(politicaDoFormato(e, FOTO).automatico, true, e)
    assert.deepEqual([...FORMATOS_COM_IMAGEM].sort(), ['ACHADO_TIKTOK_SHOP', 'LISTA_3_MOTIVOS', 'NATAL', 'POV', 'PRESENTE', 'PROBLEMA_SOLUCAO', 'UTILIDADE'])
  })
  test('FACELESS e CURIOSIDADE mostram o produto em ação: só com VÍDEO autorizado', () => {
    for (const e of ['FACELESS', 'CURIOSIDADE']) {
      assert.deepEqual(politicaDoFormato(e, FOTO), { automatico: false, falta: 'VIDEO', motivo: politicaDoFormato(e, FOTO).automatico ? '' : (politicaDoFormato(e, FOTO) as { motivo: string }).motivo })
      assert.equal(politicaDoFormato(e, VIDEO_LIC).automatico, true)
    }
  })
  test('DEMONSTRACAO e UNBOXING (uso físico): só com VÍDEO PRÓPRIO', () => {
    for (const e of ['DEMONSTRACAO', 'UNBOXING']) {
      assert.equal(politicaDoFormato(e, FOTO).automatico, false)
      assert.equal(politicaDoFormato(e, VIDEO_LIC).automatico, false)
      assert.equal(politicaDoFormato(e, VIDEO_PROPRIO).automatico, true)
    }
  })
  test('COMPARACAO só com dado real; TESTE_REAL, SURPRESA, UGC, ANTES_DEPOIS nunca automáticos', () => {
    assert.equal(politicaDoFormato('COMPARACAO', VIDEO_PROPRIO).automatico, false)
    assert.equal(politicaDoFormato('COMPARACAO', FOTO, { comparacaoComDadoReal: true }).automatico, true)
    for (const e of EXIGE_EXPERIENCIA) assert.equal(politicaDoFormato(e, VIDEO_PROPRIO).automatico, false, e)
    for (const e of ['TESTE_REAL', 'SURPRESA', 'UGC', 'ANTES_DEPOIS']) assert.equal(formatoServeComFoto(e), false, e)
  })
  test('sem mídia: nada é automático (vira AGUARDANDO_MIDIA)', () => {
    assert.equal(politicaDoFormato('POV', []).automatico, false)
    assert.equal(videoInicial('POV', []).situacao, 'FALTA_MIDIA_AUTORIZADA')
    assert.equal(estadoPeloVideo('FALTA_MIDIA_AUTORIZADA', 0), 'AGUARDANDO_MIDIA')
  })
  test('escolha da variação: Árvore de Natal (decoração) sem mídia → formato que serve com foto, nunca DEMONSTRACAO', () => {
    const plano = planejarVideos({ nome: 'FIXTURE Árvore de Natal Pinheiro 2,40 m', categoria: 'Casa e Decoração', preco: 199, tiktokShop: true }, new Date('2026-11-20T12:00:00-03:00'))
    const ordem = [...plano.testeInicial.variantes, ...plano.variantes.map((v) => v.id)]
    assert.equal(ordem[0], 'DEMONSTRACAO-A-CURTA', 'o plano comercial começaria por demonstração…')
    const sem = escolherVariante(plano.variantes, ordem, new Set(), null, [], true)!
    assert.notEqual(sem.versao.estrutura, 'DEMONSTRACAO', '…mas sem vídeo dela não dá')
    assert.equal(sem.automatico, false)
    assert.ok(formatoServeComFoto(sem.versao.estrutura))
    const comVideo = escolherVariante(plano.variantes, ordem, new Set(), null, [{ tipo: 'VIDEO', origem: 'PROPRIO' }], true)!
    assert.deepEqual([comVideo.versao.estrutura, comVideo.automatico], ['DEMONSTRACAO', true])
  })
  test('aprendizado: a estrutura vencedora (dado real) vem primeiro; as já usadas vão para o fim', () => {
    const est = (id: string) => id.split('-')[0]
    assert.deepEqual(ordemDasVariantes(['A-1', 'B-1', 'C-1'], est, new Set(), 'C'), ['C-1', 'A-1', 'B-1'])
    assert.deepEqual(ordemDasVariantes(['A-1', 'B-1', 'C-1'], est, new Set(['A-1']), null), ['B-1', 'C-1', 'A-1'])
  })
})

describe('P2.17.12 — cenas do vídeo: só o que é verdade com a mídia', () => {
  const plano = planejarVideos({ nome: 'FIXTURE Árvore de Natal Pinheiro 2,40 m', categoria: 'Casa e Decoração', preco: 199, vendas: 1200, tiktokShop: true }, new Date('2026-11-20T12:00:00-03:00'))
  const v = (e: string) => plano.variantes.find((x) => x.estrutura === e)!
  test('com FOTO: sem "Olha como funciona"/"Funcionando de verdade"; sem instrução de gravação; gancho 0–3 s e CTA nos 3 s finais', () => {
    const cenas = cenasDoVideo(v('POV'), 'FIXTURE Árvore de Natal Pinheiro 2,40 m', 'IMAGEM')
    const texto = cenas.map((c) => c.texto.split('\n').join(' ')).join(' | ')
    assert.doesNotMatch(texto, /Olha como funciona|Funcionando de verdade|Abrindo agora/)
    assert.doesNotMatch(texto, /\b(Mostre|Abra|Compare|Diga|Feche)\b/)
    assert.deepEqual([cenas[0].inicio, cenas[0].fim], [0, 3])
    assert.equal(cenas.at(-1)!.fim, v('POV').duracaoSegundos)
    assert.ok(cenas.every((c) => c.fim > c.inicio))
    assert.match(texto, /vendidos no TikTok Shop \(dado da loja\)/, 'prova com dado real entra como texto')
  })
  test('sem emoji (vira quadrado no vídeo) e com quebra de linha', () => {
    assert.equal(textoParaTela('Produto marcado 👇'), 'Produto marcado')
    assert.equal(textoParaTela('Ideia para o Natal 🎄'), 'Ideia para o Natal')
    assert.equal(quebrarLinhas('Toque no produto marcado no vídeo.', 22), 'Toque no produto\nmarcado no vídeo.')
  })
})

describe('P2.17.12 — Quality Gate do VÍDEO FINAL', () => {
  const roteiro = avaliarVideo({ gancho: 'POV: você achou o presente perfeito.', roteiro: [{ etapa: 'Demonstração', texto: 'Mostre o produto em uso.' }, { etapa: 'b', texto: 'b' }, { etapa: 'c', texto: 'c' }], cta: 'Toque no produto marcado no vídeo.', legenda: 'x #publi comissão', hashtags: ['#tiktokshop'], duracaoSegundos: 15, exigeExperienciaReal: false }, { tiktokShop: true })
  const reelOk = { valido: true, problemas: [], tamanhoBytes: 100_000, metadados: { marca: 'isom', duracaoS: 15, largura: 1080, altura: 1920, rotacaoGraus: 0, codecDeVideo: 'avc1', codecDeAudio: null, temAudio: false } }
  const cenas = [{ texto: 'a', inicio: 0, fim: 3, posicao: 'topo' as const }, { texto: 'b', inicio: 3, fim: 12, posicao: 'centro' as const }, { texto: 'c', inicio: 12, fim: 15, posicao: 'centro' as const }]
  test('arquivo legível 9:16, duração do roteiro, direito ok, sem alegação → vale o veredito do roteiro', () => {
    const qg = qualityGateDoVideoFinal({ roteiro: { ...roteiro, veredito: 'APROVADO' }, reel: reelOk, duracaoPlanejada: 15, direito: { publicavel: true, motivo: 'ok' }, cenas })
    assert.equal(qg.veredito, 'APROVADO')
    assert.deepEqual([qg.arquivo.largura, qg.arquivo.altura, qg.arquivo.duracaoS, qg.arquivo.direitoPublicavel], [1080, 1920, 15, true])
  })
  test('direito da mídia sem cadeia, arquivo inválido ou alegação no texto queimado → BLOQUEADO', () => {
    const base = { roteiro: { ...roteiro, veredito: 'APROVADO' as const }, reel: reelOk, duracaoPlanejada: 15, direito: { publicavel: true, motivo: 'ok' }, cenas }
    assert.equal(qualityGateDoVideoFinal({ ...base, direito: { publicavel: false, motivo: 'fonte sem direito' } }).veredito, 'BLOQUEADO')
    assert.equal(qualityGateDoVideoFinal({ ...base, reel: { ...reelOk, valido: false, problemas: ['deitado'] } }).veredito, 'BLOQUEADO')
    assert.equal(qualityGateDoVideoFinal({ ...base, cenas: [...cenas, { texto: 'O melhor do Brasil, 100% garantido', inicio: 1, fim: 2, posicao: 'centro' }] }).veredito, 'BLOQUEADO')
  })
  test('duração diferente do roteiro → REVISAR (o Patrono gera de novo; não chega à titular)', () => {
    const qg = qualityGateDoVideoFinal({ roteiro: { ...roteiro, veredito: 'APROVADO' }, reel: { ...reelOk, metadados: { ...reelOk.metadados, duracaoS: 21 } }, duracaoPlanejada: 15, direito: { publicavel: true, motivo: 'ok' }, cenas })
    assert.equal(qg.veredito, 'REVISAR')
    assert.equal(estadoPeloVideo('FALHOU', 1), 'VIDEO_NA_FILA', '1ª falha: volta para a fila')
    assert.equal(estadoPeloVideo('FALHOU', MAXIMO_DE_TENTATIVAS_DE_RENDER), 'VIDEO_FALHOU', 'depois das tentativas: o Patrono segue para outro')
  })
  test('APROVAR só com o MP4', () => {
    assert.equal(temVideoGerado({ apresentacao: { video: { arquivo: null } } }), false)
    assert.equal(temVideoGerado({ apresentacao: { video: { arquivo: 'https://x/v.mp4' } } }), true)
  })
})

describe('P2.17.12 — infraestrutura: trabalho longo, rotas, pacote, tela', () => {
  test('render é um trabalho longo registrado (segundo plano/requisição) com entidade validada', () => {
    assert.ok((TIPOS_DE_TRABALHO_LONGO as readonly string[]).includes('LONGO_RENDER_VIDEO'))
    assert.ok((TIPOS_DE_ENTIDADE as readonly string[]).includes('PUBLICACAO_ASSISTIDA'))
    assert.match(fs.readFileSync('lib/trabalhos-longos/index.ts', 'utf8'), /LONGO_RENDER_VIDEO: executorDoRenderAssistido\(\)/)
  })
  test('o binário do FFmpeg vai no pacote das rotas que geram e da Background Function', () => {
    const cfg = fs.readFileSync('next.config.ts', 'utf8')
    for (const r of ['/api/tiktok/assistido', '/api/tiktok/assistido/[id]/ajuste', '/api/tiktok/assistido/[id]/rejeitar', '/api/midias']) assert.ok(cfg.includes(`'${r}': ['./node_modules/ffmpeg-static/ffmpeg']`), r)
    assert.match(fs.readFileSync('netlify.toml', 'utf8'), /trabalho-longo-background[\s\S]*"node_modules\/ffmpeg-static\/ffmpeg"/)
  })
  test('/api/midias: sessão + módulo; quem declarou e quando vêm do servidor, nunca do corpo', () => {
    assert.ok(regraDaRota('/api/midias', 'POST')?.modulos.includes('precisa-de-voce'))
    const src = fs.readFileSync('app/api/midias/route.ts', 'utf8')
    assert.match(src, /exigirSessao\(\)/)
    assert.match(src, /declaradoPor: session\.user\.id, declaradoEm: new Date\(\)/)
    assert.doesNotMatch(src, /GERADO_PELO_PATRONO/, 'a titular não declara "gerado pelo Patrono"')
  })
  test('cartão: APROVAR E PUBLICAR só com vídeo; player do MP4; demonstração nunca aprova', () => {
    const src = fs.readFileSync('components/assistido/PainelAssistido.tsx', 'utf8')
    // P2.51: além do vídeo, 'APROVAR E PUBLICAR' só aparece com a campanha LIBERADA (!retida) — regra mais rígida.
    assert.match(src, /modo === 'APROVAR' && temVideo && !retida && <Button[\s\S]{0,300}>APROVAR E PUBLICAR</)
    assert.match(src, /<video src=\{ap\.video\.arquivo/)
    assert.match(src, /DESCARTAR DEMONSTRAÇÃO/)
    const central = fs.readFileSync('app/(dashboard)/precisa-de-voce/page.tsx', 'utf8')
    assert.match(central, /fetch\('\/api\/midias', \{ method: 'POST'/)
    assert.match(central, /não conta no sininho/)
  })
})

const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')

describe('P2.17.12 — banco de TESTE: render real, falha que se corrige, demonstração fora do sininho', { skip: !TEM_BANCO ? 'exige banco de TESTE' : false }, () => {
  let prisma: typeof import('../lib/prisma').prisma
  let A: typeof import('../lib/publicacao-assistida')
  let C: typeof import('../lib/precisa-de-voce-central')
  let V: typeof import('../lib/video-assistido')
  let M: typeof import('../lib/midia-do-produto')
  let RT: typeof import('./_render-de-teste')
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  const PREFIXO = 'Conta de Teste — '
  const marca = `r85-${Date.now()}`
  let ws = ''
  let user = ''
  const AGORA = new Date('2026-11-20T12:00:00-03:00')

  before(async () => {
    ;[{ prisma }, A, C, V, M, RT, { limparWorkspaceDeTeste: limpar }] = await Promise.all([
      import('../lib/prisma'), import('../lib/publicacao-assistida'), import('../lib/precisa-de-voce-central'), import('../lib/video-assistido'),
      import('../lib/midia-do-produto'), import('./_render-de-teste'), import('./_limpar-workspace-de-teste'),
    ])
    ws = (await prisma.workspace.create({ data: { name: `${PREFIXO}render P2.17.12`, ownerId: marca }, select: { id: true } })).id
    user = (await prisma.user.create({ data: { email: `${marca}@teste.local`, name: 'U', password: 'x', workspaceId: ws }, select: { id: true } })).id
    await prisma.candidatoDeProduto.create({
      data: {
        workspaceId: ws, chaveDeOrigem: `${marca}-1`, fonte: 'USER_PROVIDED', nome: 'FIXTURE Árvore de Natal Pinheiro 2,40 m', categoria: 'Casa e Decoração', preco: 199,
        linkProduto: 'https://shop.tiktok.com/br/pdp/900000000000000851', providerId: 'tiktok-shop', externalId: '900000000000000851', score: 70, baseDeEvidencia: 60,
        confianca: 'SEM_HISTORICO_REAL', status: 'APRESENTADO', coletadoEm: AGORA, validoAte: new Date('2027-01-01'), motivosPositivos: [], riscos: [], desconhecidos: [], porqueDestaPosicao: [], nivelDeRisco: 'BAIXO',
      },
    })
  })
  after(async () => {
    V?.definirPortasDoRender(null)
    await prisma.midiaDoProduto.deleteMany({ where: { workspaceId: ws } })
    await limpar(prisma, ws, PREFIXO)
    await prisma?.$disconnect()
  })

  test('tabela MidiaDoProduto com RLS e sem acesso público', async () => {
    const [l] = await prisma.$queryRaw<{ rls: boolean; acesso: boolean }[]>`
      select c.relrowsecurity as rls,
        (has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE')) as acesso
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'MidiaDoProduto'`
    assert.deepEqual([l.rls, l.acesso], [true, false])
  })

  test('mídia BLOQUEADA (foto do vendedor) não destrava nada: continua AGUARDANDO_MIDIA', async () => {
    const a = await A.prepararProximaPublicacao({ workspaceId: ws, userId: user, agora: AGORA })
    assert.equal(a.estado, 'AGUARDANDO_MIDIA')
    const m = await M.registrarMidia({ workspaceId: ws, candidatoId: a.candidatoId, nomeProduto: a.nomeProduto, declaracao: { ...RT.declaracaoFixture('vendedor', user), url: 'https://down-br.img.susercontent.com/file/fixture.jpg', origem: 'FORNECEDOR' } })
    assert.equal(m.status, 'BLOQUEADA')
    assert.equal((await A.prepararProximaPublicacao({ workspaceId: ws, userId: user, agora: AGORA })).estado, 'AGUARDANDO_MIDIA')
  })

  test('render que reprova na checagem do arquivo: volta para a fila e NÃO chega à titular; a 2ª tentativa corrige', async () => {
    const a = await prisma.publicacaoAssistida.findFirstOrThrow({ where: { workspaceId: ws } })
    await M.registrarMidia({ workspaceId: ws, candidatoId: a.candidatoId, nomeProduto: a.nomeProduto, declaracao: RT.declaracaoFixture('r85', user) })
    V.definirPortasDoRender(RT.portasDeTeste({ duracaoErrada: true }))
    const r1 = await A.prepararProximaPublicacao({ workspaceId: ws, userId: user, agora: AGORA })
    assert.equal(r1.estado, 'VIDEO_NA_FILA')
    assert.equal((r1.qualityGate as { veredito: string }).veredito, 'APROVADO', 'a checagem do roteiro continua a do roteiro')
    const v1 = (r1.apresentacao as { video: { situacao: string; tentativas: number; checagemDoArquivo?: { duracaoS: number } } }).video
    assert.deepEqual([v1.situacao, v1.tentativas, v1.checagemDoArquivo?.duracaoS], ['FALHOU', 1, 20])
    assert.ok(!(await C.centralPrecisaDeVoce(ws, AGORA)).some((i) => i.id.startsWith(`assistida:${a.id}:`)), 'nada para a titular enquanto o Patrono corrige')
    V.definirPortasDoRender(RT.portasDeTeste())
    const r2 = await A.prepararProximaPublicacao({ workspaceId: ws, userId: user, agora: AGORA })
    assert.equal(r2.estado, 'AGUARDANDO_APROVACAO', JSON.stringify({ video: (r2.apresentacao as { video: unknown }).video, h: r2.historico }).slice(0, 3000))
    assert.ok(A.statusReal(r2).videoGerado)
    // Idempotente: preparar de novo não gera outro vídeo.
    const arquivo = (r2.apresentacao as { video: { arquivo: string } }).video.arquivo
    const r3 = await A.prepararProximaPublicacao({ workspaceId: ws, userId: user, agora: AGORA })
    assert.equal((r3.apresentacao as { video: { arquivo: string } }).video.arquivo, arquivo)
    const midia = await prisma.midiaDoProduto.findFirstOrThrow({ where: { workspaceId: ws, status: 'AUTORIZADA' } })
    assert.equal(midia.usos, 1, 'reaproveitamento contado')
  })

  test('demonstração: aparece à parte, não conta no sininho, não aprova, não entra na ordem', async () => {
    const real = await prisma.publicacaoAssistida.findFirstOrThrow({ where: { workspaceId: ws, demonstracao: false } })
    const demo = await prisma.publicacaoAssistida.create({
      data: { workspaceId: ws, demonstracao: true, estado: 'AGUARDANDO_APROVACAO', nomeProduto: 'FIXTURE Demonstração', varianteId: real.varianteId, estrutura: real.estrutura, apresentacao: real.apresentacao as object, qualityGate: real.qualityGate as object, motivoEscolha: 'demo', objetivoDoTeste: 'demo', metasIds: [] },
    })
    const central = await C.centralPrecisaDeVoce(ws, AGORA)
    assert.ok(!central.some((i) => i.id.includes(demo.id)), 'fora do sininho')
    const demos = await C.demonstracoesDaCentral(ws)
    assert.equal(demos.length, 1)
    assert.equal(demos[0].assistida?.modo, 'DEMONSTRACAO')
    await assert.rejects(A.aprovarEPublicar({ workspaceId: ws, userId: user, id: demo.id, agora: AGORA, env: {} }), /DEMONSTRAÇÃO/)
    assert.equal((await A.prepararProximaPublicacao({ workspaceId: ws, userId: user, agora: AGORA })).id, real.id, 'a demonstração não ocupa o lugar da real')
    assert.equal((await A.relatorioDeTransicao(ws)).concluidas, 0)
    assert.equal(await A.rejeitar({ workspaceId: ws, userId: user, id: demo.id, motivo: 'só demonstração', agora: AGORA }), null, 'descartar não puxa outra')
  })
})
