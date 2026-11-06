/**
 * P1.9.2 — Fechamento do pipeline de conteúdo publicável.
 *
 *   1. o planner não escolhe formato que o adapter real não publica;
 *   2. sem mídia da dona, a fila ESPERA — não gera conteúdo inútil;
 *   3. derivado FFmpeg herda o direito das fontes, e só ele;
 *   4. a validade do preço é configuração explícita;
 *   5. nada vai ao ar sem o link confirmado na bio por uma pessoa;
 *   6. as rotas que publicavam por fora passam pela porta única.
 *
 * NENHUMA publicação real. `fetch` é trocado por um espião que falha alto.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '../lib/prisma'
import { escolherCanalEFormato, derivarEstadoEAcao, montarPlanoDeAcao } from '../lib/plano-de-acao'
import {
  avaliarFormatoParaOCanal,
  MIDIA_ENTREGUE_PELA_FABRICA,
  ehFormatoDaDona,
} from '../lib/capacidades-da-fabrica'
import { CAPACIDADE_REAL_DO_ADAPTER } from '../lib/capacidade-real-do-adapter'
import { jobsDeGeracaoDoPlano, gerarConteudoDoJob } from '../lib/fabrica-de-conteudo'
import { jobsDesejadosDoPlano } from '../lib/automation-queue-contrato'
import { perfilContextual } from '../lib/automation-queue-repositorio'
import { portaPrisma } from '../lib/automation-queue-prisma'
import { rodarCicloDeOportunidades } from '../lib/ciclo-de-oportunidades'
import { rodarFilaDoWorkspace, acaoDeGerarConteudo } from '../lib/executor-da-fila'
import { fonteDaImagemDoProduto, fonteDoPatrono, registrarDerivacao } from '../lib/cadeia-de-direitos'
import { avaliarMidiaParaPublicacao, type EvidenciaDeMidia } from '../lib/evidencia-de-midia'
import { validadeDoPreco, avaliarPreco, VALIDADE_PADRAO_DO_PRECO_HORAS } from '../lib/preco-verificado'
import {
  avaliarLinkNaBio,
  confirmarLinkNaBio,
  gerarLinkParaABio,
  situacaoDoLinkNaBio,
  urlDaTentativa,
} from '../lib/link-na-bio'
import { preflightDePublicacao } from '../lib/preflight-de-publicacao'
import { distribuirConteudo, ADAPTADORES_LIGADOS, type AdaptadorDeCanal } from '../lib/distribuicao-orquestrador'
import { adaptadoresHabilitados } from '../lib/adaptadores-reais'
import { autorizarPublicacaoReal, envioSuportadoPeloAdapter } from '../lib/porta-de-publicacao-real'
import { validarReel, declaracoesFaltando } from '../lib/validacao-de-reel'
import { prepararPecaComMidiaPropria } from '../lib/peca-com-midia-propria'
import { chaveDaTentativaPadrao } from '../lib/link-de-publicacao'
import { CAMPO_DOS_SCOPES, CAMPO_DA_COMPROVACAO } from '../lib/autorizacao-da-conta'
import type { OportunidadePontuada } from '../lib/motor-de-oportunidades'
import type { LinhaDaFila } from '../lib/automation-queue-repositorio'
import {
  ENV_DE_CUSTODIA,
  SUPABASE_DE_TESTE,
  VIDEO_PROPRIO_URL,
  REEL_VALIDO,
  DECLARACOES_COMPLETAS,
} from './_fixtura-midia-propria'

const TEM_BANCO = !!process.env.DATABASE_URL
const RAIZ = join(__dirname, '..')
const marca = `r49-${Date.now()}`
const AGORA = new Date('2026-10-01T15:00:00Z')
const SHOPEE = 'https://down-br.img.susercontent.com/file/br-abc'
const IMAGEM_PROPRIA = `${SUPABASE_DE_TESTE}/storage/v1/object/public/imagens/p/foto.jpg`
const ENV = { PUBLIC_BASE_URL: 'https://patrono.exemplo.com.br', ...ENV_DE_CUSTODIA }
const ENV_LIGADO = { ...ENV, PUBLICACAO_REAL_INSTAGRAM: 'true' }
const fixtura = (n: string) => readFileSync(join(__dirname, 'fixtures', 'reel', `${n}.mp4`))

const fetchOriginal = globalThis.fetch
let chamadasDeRede = 0
before(() => {
  globalThis.fetch = (async () => {
    chamadasDeRede += 1
    throw new Error('rede proibida nesta suíte')
  }) as typeof fetch
})
after(() => {
  globalThis.fetch = fetchOriginal
})

const oport = (over: Partial<OportunidadePontuada> = {}): OportunidadePontuada =>
  ({
    workspaceId: 'ws-1',
    produtoId: 'p-1',
    produtoNome: 'Colchão',
    categoria: 'casa',
    score: 70,
    classificacao: 'PRONTA_PARA_PUBLICACAO',
    confianca: 'SEM_HISTORICO_REAL',
    motivosDeProntidao: [],
    porqueDestaPosicao: [],
    desempenho: { fatorDeSaturacao: 1 },
    ...over,
  }) as unknown as OportunidadePontuada

// ── 1. Planner ──────────────────────────────────────────────────────────

describe('Planner: só o que o adapter real publica', () => {
  test('Instagram nunca recebe TEXTO_COM_LINK nem vídeo que a fábrica não entrega — varredura', () => {
    const caps = [{}, { FFMPEG: true }, { DIGITAL_TWIN_GPU: true }, { FFMPEG: true, DIGITAL_TWIN_GPU: true }]
    for (const c of caps) {
      for (const midia of [[], ['MIDIA_SEM_DIREITO']]) {
        const o = oport({ motivosDeProntidao: midia as never })
        const e = escolherCanalEFormato(o, ['instagram'], c)
        assert.equal(e.formato, 'VIDEO_PROPRIO', `${JSON.stringify(c)} ${midia}`)
        assert.notEqual(derivarEstadoEAcao(o, e).estado, 'PRONTO_PARA_GERAR_CONTEUDO')
      }
    }
  })

  test('a utilidade de um formato sai da MESMA lista do adapter', () => {
    for (const [canal, cap] of Object.entries(CAPACIDADE_REAL_DO_ADAPTER)) {
      assert.equal(avaliarFormatoParaOCanal(canal, 'TEXTO_COM_LINK').util, cap.formatosPublicaveis.includes('TEXTO_COM_LINK'))
    }
    assert.equal(avaliarFormatoParaOCanal('instagram', 'TEXTO_COM_LINK').motivo, 'FORMATO_NAO_PUBLICAVEL_PELO_ADAPTER')
    assert.equal(avaliarFormatoParaOCanal('instagram', 'VIDEO_9X16_FFMPEG_NARRADO').motivo, 'FABRICA_NAO_ENTREGA_MIDIA')
    assert.equal(MIDIA_ENTREGUE_PELA_FABRICA.VIDEO_9X16_FFMPEG_NARRADO, null, 'a fábrica não grava o vídeo na peça')
    // Canal sem adapter real não é julgado por esta regra.
    assert.equal(avaliarFormatoParaOCanal('facebook', 'TEXTO_COM_LINK').util, true)
  })

  test('nenhum job de geração nasce para o Instagram', () => {
    const plano = montarPlanoDeAcao({
      workspaceId: 'ws-1', fila: [oport(), oport({ produtoId: 'p-2' })],
      canaisConectados: ['instagram'], capacidades: { FFMPEG: true }, agora: AGORA,
    })
    assert.deepEqual(jobsDeGeracaoDoPlano('ws-1', plano.itens), [])
    for (const i of plano.itens) assert.equal(i.estado, 'AGUARDANDO_MIDIA_AUTORIZADA')
    // A dependência é humana, e diz o que falta.
    const deps = jobsDesejadosDoPlano('ws-1', plano.filaDeAutomacao)
    assert.equal(deps.length, 2)
    for (const d of deps) {
      assert.equal(d.tipo, 'SINCRONIZAR_MIDIA_AUTORIZADA')
      assert.equal(d.classe, 'EXIGE_HUMANO')
      assert.equal(d.motivoHumano, 'MISSING_AUTHORIZED_MEDIA')
      assert.equal(d.contexto.origemDaMidia, 'DA_DONA')
      assert.equal(d.contexto.formato, 'VIDEO_PROPRIO')
    }
  })

  test('a mídia da dona é dependência HUMANA, sem tentativa', () => {
    const p = perfilContextual('SINCRONIZAR_MIDIA_AUTORIZADA', { origemDaMidia: 'DA_DONA' })
    assert.equal(p.classe, 'EXIGE_HUMANO')
    assert.equal(p.motivoHumano, 'MISSING_AUTHORIZED_MEDIA')
    assert.equal(p.maxTentativas, 0)
    // A sincronização com o provider continua sendo outra coisa.
    assert.equal(perfilContextual('SINCRONIZAR_MIDIA_AUTORIZADA', {}).classe, 'AGUARDA_CONDICAO')
    assert.equal(ehFormatoDaDona('VIDEO_PROPRIO'), true)
  })

  test('a fábrica e o executor recusam um job antigo de TEXTO_COM_LINK para o Instagram', async () => {
    const r = await gerarConteudoDoJob({
      workspaceId: 'ws-qualquer', produtoId: 'p', formato: 'TEXTO_COM_LINK', canal: 'instagram',
      capacidades: { ffmpeg: true, chatterbox: true, memoriaLivreBytes: 8 * 1024 ** 3 }, agora: AGORA,
    })
    assert.equal(r.ok, false)
    assert.equal(r.erroFatal, true)
    assert.match(r.explicacao, /obsoleto/)
    const acao = acaoDeGerarConteudo({
      workspaceId: 'ws-qualquer', workerId: 'w', agora: AGORA,
      capacidades: { ffmpeg: false, chatterbox: false, memoriaLivreBytes: 0 },
    })
    const a = await acao({ id: 'j', entityId: 'p', contexto: { formato: 'TEXTO_COM_LINK', canal: 'instagram' } } as unknown as LinhaDaFila)
    assert.equal(a.ok, false)
    assert.equal((a as { erroFatal?: boolean }).erroFatal, true, 'nem espera por capacidade: é inútil')
  })
})

// ── 2. Cadeia de direitos do FFmpeg ─────────────────────────────────────

const produtoProprio = (over: Record<string, unknown> = {}) => ({
  id: 'p1', nome: 'Colchão', origemConteudo: 'Próprio', imagens: [IMAGEM_PROPRIA],
  userId: 'u1', updatedAt: new Date('2026-09-30T10:00:00Z'), ...over,
})
const DERIVADO_EM_CUSTODIA = `${SUPABASE_DE_TESTE}/storage/v1/object/public/videos/p1/derivado.mp4`

describe('FFmpeg: o derivado herda o direito das fontes, e só ele', () => {
  test('imagem própria em custódia + fontes do Patrono → derivado autorizado e publicável', () => {
    const d = registrarDerivacao({
      assetUrl: DERIVADO_EM_CUSTODIA, formato: 'VIDEO_9X16_FFMPEG_NARRADO', geracaoId: 'job-1', agora: AGORA, env: ENV,
      fontes: [
        fonteDaImagemDoProduto(produtoProprio(), IMAGEM_PROPRIA, ENV),
        fonteDoPatrono('VOZ_SINTETIZADA', 'job-1', 'voz aprovada'),
        fonteDoPatrono('TEXTO_SOBREPOSTO', 'job-1', 'texto'),
      ],
    })
    assert.equal(d.fontesAutorizadas, true, d.motivo)
    assert.equal(d.publicavel, true)
    assert.equal(d.evidencia.origem, 'DERIVADO')
    assert.equal(d.evidencia.fontes!.length, 3)
  })

  test('imagem da Shopee, mesmo declarada "Próprio": o derivado inteiro fica bloqueado', () => {
    const d = registrarDerivacao({
      assetUrl: DERIVADO_EM_CUSTODIA, formato: 'VIDEO_9X16_FFMPEG_NARRADO', geracaoId: 'job-2', agora: AGORA, env: ENV,
      fontes: [fonteDaImagemDoProduto(produtoProprio({ imagens: [SHOPEE] }), SHOPEE, ENV), fonteDoPatrono('VOZ_SINTETIZADA', 'job-2', 'v')],
    })
    assert.equal(d.fontesAutorizadas, false)
    assert.equal(d.publicavel, false)
    assert.match(d.motivo, /IMAGEM_DO_PRODUTO/)
  })

  test('"Gerado por IA" no cadastro não basta: sem id de geração, a fonte fica sem direito', () => {
    const f = fonteDaImagemDoProduto(produtoProprio({ origemConteudo: 'Gerado por IA' }), IMAGEM_PROPRIA, ENV)
    assert.equal(f.evidencia, null)
  })

  test('comprei_e_testei não vira direito de imagem ao passar pelo FFmpeg', () => {
    const f = fonteDaImagemDoProduto(produtoProprio({ origemConteudo: 'comprei_e_testei' }), IMAGEM_PROPRIA, ENV)
    assert.equal(f.evidencia, null)
    const d = registrarDerivacao({
      assetUrl: DERIVADO_EM_CUSTODIA, formato: 'X', geracaoId: 'job-3', agora: AGORA, env: ENV, fontes: [f],
    })
    assert.equal(d.publicavel, false)
  })

  test('mídia PRÓPRIA (vídeo da dona) como fonte → derivado próprio', () => {
    const video: EvidenciaDeMidia = {
      tipo: 'direito_da_midia', severidade: 'verde', origem: 'PROPRIO', assetUrl: VIDEO_PROPRIO_URL,
      formato: 'VIDEO_PROPRIO', declaradoPor: 'u1', declaradoEm: AGORA.toISOString(), descricao: 'x', mensagem: 'x',
    }
    const d = registrarDerivacao({
      assetUrl: DERIVADO_EM_CUSTODIA, formato: 'VIDEO_9X16', geracaoId: 'job-4', agora: AGORA, env: ENV,
      fontes: [{ papel: 'VIDEO_BASE', assetUrl: VIDEO_PROPRIO_URL, evidencia: video }],
    })
    assert.equal(d.publicavel, true, d.motivo)
  })

  test('prévia privada: fontes legítimas, e mesmo assim NÃO publicável', () => {
    const d = registrarDerivacao({
      assetUrl: 'digital-twin-asset:abc', formato: 'VIDEO_9X16_FFMPEG_NARRADO', geracaoId: 'job-5', agora: AGORA, env: ENV,
      fontes: [fonteDaImagemDoProduto(produtoProprio(), IMAGEM_PROPRIA, ENV)],
    })
    assert.equal(d.fontesAutorizadas, true)
    assert.equal(d.publicavel, false, 'o arquivo não está em custódia pública')
  })

  test('derivado sem fontes, ou fonte "do Patrono" sem registro, não herda nada', () => {
    const vazio = avaliarMidiaParaPublicacao({
      assetUrl: DERIVADO_EM_CUSTODIA, env: ENV,
      evidencia: { ...fonteDoPatrono('X', 'j', 'x').evidencia!, origem: 'DERIVADO', assetUrl: DERIVADO_EM_CUSTODIA, fontes: [] },
    })
    assert.equal(vazio.autorizada, false)
    const falsa = registrarDerivacao({
      assetUrl: DERIVADO_EM_CUSTODIA, formato: 'X', geracaoId: 'j', agora: AGORA, env: ENV,
      fontes: [{ papel: 'FUNDO', assetUrl: 'patrono:fundo:j', evidencia: null }],
    })
    assert.equal(falsa.fontesAutorizadas, false)
  })

  test('o render real (PRODUCT_PREVIEW) grava a cadeia na peça', () => {
    const codigo = readFileSync(join(RAIZ, 'lib/digital-twin-worker-core.ts'), 'utf8')
    assert.match(codigo, /registrarDerivacao\(/)
    assert.match(codigo, /alertasCompliance: \[\.\.\.alertasAnteriores, derivacao\.evidencia\]/)
  })
})

// ── 3. Preço ────────────────────────────────────────────────────────────

describe('Preço: a validade é configuração explícita', () => {
  test('padrão conservador de 24 horas, e de onde ele veio', () => {
    assert.equal(VALIDADE_PADRAO_DO_PRECO_HORAS, 24)
    assert.deepEqual(validadeDoPreco({}), { horas: 24, origem: 'PADRAO' })
    assert.deepEqual(validadeDoPreco({ PRECO_VALIDADE_HORAS: '6' }), { horas: 6, origem: 'CONFIGURADA' })
  })

  test('valor inválido ou fora da faixa cai no padrão — nunca amplia o prazo', () => {
    for (const v of ['0', '169', '-1', '2.5', 'abc', '1e3', ' ']) {
      const r = validadeDoPreco({ PRECO_VALIDADE_HORAS: v })
      assert.equal(r.horas, 24, v)
    }
    assert.equal(validadeDoPreco({ PRECO_VALIDADE_HORAS: '999' }).origem, 'PADRAO_POR_VALOR_INVALIDO')
  })

  test('o prazo configurado decide; nenhuma data é inventada', () => {
    const verificado = new Date(AGORA.getTime() - 10 * 3_600_000)
    assert.equal(avaliarPreco({ preco: 10, verificadoEm: verificado, agora: AGORA, validadeHoras: 24 }).status, 'VERIFICADO')
    assert.equal(avaliarPreco({ preco: 10, verificadoEm: verificado, agora: AGORA, validadeHoras: 6 }).status, 'PRECO_DESATUALIZADO')
    assert.equal(avaliarPreco({ preco: 10, verificadoEm: null, agora: AGORA }).status, 'PRECO_NAO_VERIFICADO')
  })
})

// ── 4. Reel ─────────────────────────────────────────────────────────────

describe('Reel: o arquivo é lido, não presumido', () => {
  test('MP4 real 1080×1920, 12 s, H.264 + AAC: válido', () => {
    const r = validarReel(fixtura('vertical'))
    assert.equal(r.valido, true, r.problemas.join('|'))
    assert.equal(r.metadados!.largura, 1080)
    assert.equal(r.metadados!.altura, 1920)
    assert.equal(r.metadados!.codecDeVideo, 'avc1')
    assert.equal(r.metadados!.codecDeAudio, 'mp4a')
  })

  test('vídeo deitado: reprovado, e o motivo diz isso', () => {
    const r = validarReel(fixtura('deitado'))
    assert.equal(r.valido, false)
    assert.ok(r.problemas.some((p) => /deitado/.test(p)))
  })

  test('5 segundos: reprovado pela duração', () => {
    const r = validarReel(fixtura('curto'))
    assert.equal(r.valido, false)
    assert.ok(r.problemas.some((p) => /Duração/.test(p)))
  })

  test('celular grava deitado com rotação: lido como vertical, e aceito', () => {
    const r = validarReel(fixtura('rotacionado'))
    assert.equal(r.valido, true, r.problemas.join('|'))
    assert.ok([90, 270].includes(r.metadados!.rotacaoGraus))
    assert.equal(r.metadados!.largura, 1080)
  })

  test('arquivo que não é MP4: reprovado sem quebrar', () => {
    const r = validarReel(Buffer.from('isto não é um vídeo'))
    assert.equal(r.valido, false)
    assert.equal(r.metadados, null)
  })

  test('as três declarações são obrigatórias', () => {
    assert.deepEqual(declaracoesFaltando(DECLARACOES_COMPLETAS), [])
    assert.deepEqual(declaracoesFaltando({ gravadoPelaPropriaDona: true }), ['semMusicaDeTerceiros', 'semTerceirosNemCriancas'])
    assert.equal(declaracoesFaltando(null).length, 3)
  })
})

// ── 5. Link na bio (puro) ───────────────────────────────────────────────

describe('Link na bio: estratégia, link gerado e presença confirmada são três coisas', () => {
  const base = { canal: 'instagram', url: 'https://patrono.exemplo.com.br/api/l/x', rastreada: true }

  test('link não gerado ainda: não libera (colar na bio daria 404)', () => {
    const s = avaliarLinkNaBio({ ...base, gerado: false, alertas: [] })
    assert.equal(s.estrategia, 'BIO')
    assert.equal(s.estado, 'LINK_NAO_GERADO')
    assert.equal(s.liberaExecucao, false)
  })

  test('gerado e não confirmado: não libera', () => {
    const s = avaliarLinkNaBio({ ...base, gerado: true, alertas: [] })
    assert.equal(s.estado, 'AGUARDANDO_CONFIRMACAO')
    assert.equal(s.liberaExecucao, false)
  })

  test('confirmação de OUTRA url não conta', () => {
    const s = avaliarLinkNaBio({
      ...base, gerado: true,
      alertas: [{ tipo: 'link_na_bio_confirmado', canal: 'instagram', url: 'https://outra', confirmadoPor: 'u', confirmadoEm: 'x' }],
    })
    assert.equal(s.liberaExecucao, false)
  })

  test('confirmação desta url: libera', () => {
    const s = avaliarLinkNaBio({
      ...base, gerado: true,
      alertas: [{ tipo: 'link_na_bio_confirmado', canal: 'instagram', url: base.url, confirmadoPor: 'u', confirmadoEm: 'x' }],
    })
    assert.equal(s.estado, 'CONFIRMADO')
    assert.equal(s.liberaExecucao, true)
  })

  test('canal que põe o link na própria publicação não depende de bio', () => {
    assert.equal(avaliarLinkNaBio({ ...base, canal: 'facebook', gerado: false, alertas: [] }).liberaExecucao, true)
  })

  test('a URL da bio é determinística pela tentativa', () => {
    const p = {
      workspaceId: 'w', contentId: 'c', canal: 'instagram', nomeProduto: 'Colchão',
      urlDiretaDoProduto: 'https://shopee.com.br/x', env: ENV,
    }
    assert.equal(urlDaTentativa({ ...p, chaveDaTentativa: 'k1' }).url, urlDaTentativa({ ...p, chaveDaTentativa: 'k1' }).url)
    assert.notEqual(urlDaTentativa({ ...p, chaveDaTentativa: 'k1' }).url, urlDaTentativa({ ...p, chaveDaTentativa: 'k2' }).url)
  })
})

// ── 6. A porta única ────────────────────────────────────────────────────

describe('Toda publicação real passa pela mesma porta', () => {
  test('as duas rotas que publicavam por fora chamam a porta ANTES da Meta', () => {
    // P2.2: as rotas conferem a porta e só REGISTRAM o trabalho — nenhuma
    // chamada à Meta mora mais nelas.
    const META = /criarContainer\w*\(|publicarContainer\(|publicarReelInstagram\(|statusContainer\(/
    for (const rota of ['app/api/conteudos/[id]/publicar/route.ts', 'app/api/cron/publicar/route.ts']) {
      const codigo = readFileSync(join(RAIZ, rota), 'utf8')
      const porta = codigo.indexOf('autorizarPublicacaoReal({')
      const registro = codigo.indexOf('iniciarTrabalhoLongo({')
      assert.ok(porta > 0, `${rota} não chama a porta`)
      assert.ok(registro > porta, `${rota} registra o trabalho antes de conferir a porta`)
      assert.match(codigo, /if \(!porta\.liberada\)/)
      assert.ok(!META.test(codigo), `${rota} voltou a falar com a Meta diretamente`)
    }

    // O executor confere a porta antes do container E de novo antes do
    // único passo que põe algo no ar.
    const ex = readFileSync(join(RAIZ, 'lib/trabalhos-longos/publicar-instagram.ts'), 'utf8')
    assert.match(ex, /autorizar: autorizarPublicacaoReal,/, 'a porta real é a dependência padrão')
    const primeiraPorta = ex.indexOf('const porta = await conferirPorta()')
    const container = ex.indexOf('await dep.criarContainerReel({')
    const portaFinal = ex.indexOf('const portaFinal = await conferirPorta()')
    const fasePublicando = ex.indexOf("await e.salvar({ fase: 'PUBLICANDO' })")
    const publish = ex.indexOf('await dep.publicarContainer({')
    assert.ok(primeiraPorta > 0 && container > primeiraPorta, 'container antes da porta')
    assert.ok(portaFinal > container && publish > portaFinal, 'media_publish sem a segunda conferência da porta')
    assert.ok(fasePublicando > portaFinal && publish > fasePublicando, 'a fase PUBLICANDO precisa ser gravada ANTES do media_publish')
    assert.match(ex, /if \(!porta\.liberada\)/)
    assert.match(ex, /if \(!portaFinal\.liberada\)/)
  })

  test('imagens, carrossel e stories não passam: o adapter real só publica Reel', () => {
    assert.equal(envioSuportadoPeloAdapter('instagram', { tipoMidia: 'video', destino: 'feed' }), true)
    assert.equal(envioSuportadoPeloAdapter('instagram', { tipoMidia: 'imagens', destino: 'feed' }), false)
    assert.equal(envioSuportadoPeloAdapter('instagram', { tipoMidia: 'video', destino: 'stories' }), false)
    // P2.17.10: o TikTok tem adapter real de VÍDEO; imagens continuam fora.
    assert.equal(envioSuportadoPeloAdapter('tiktok', { tipoMidia: 'video', destino: 'feed' }), true)
    assert.equal(envioSuportadoPeloAdapter('tiktok', { tipoMidia: 'imagens', destino: 'feed' }), false)
  })
})

// ── 7. Banco: o caminho inteiro, até parar antes da publicação ──────────

describe(
  'Do ciclo ao link confirmado — e a publicação continua fechada',
  { skip: !TEM_BANCO ? 'DATABASE_URL ausente — exige Postgres' : false },
  () => {
    let wsA = ''
    let wsB = ''
    let userA = ''
    let userB = ''
    let produtoA = ''
    let pecaA = ''

    before(async () => {
      for (const n of ['A', 'B']) {
        const ws = await prisma.workspace.create({ data: { name: `R49-${n}`, ownerId: `${marca}-${n}`, automationPaused: false, automationMode: 'AUTOMATIC' }, select: { id: true } })
        const u = await prisma.user.create({
          data: { email: `${marca}-${n}@teste.local`, name: 'U', password: 'x', workspaceId: ws.id },
          select: { id: true },
        })
        if (n === 'A') { wsA = ws.id; userA = u.id } else { wsB = ws.id; userB = u.id }
      }
      produtoA = (
        await prisma.produto.create({
          data: {
            workspaceId: wsA, userId: userA, nome: 'Colchão Inflável Automático MODOFO', categoria: 'casa',
            tipoVenda: 'Afiliado', origemConteudo: 'comprei_e_testei', imagens: [SHOPEE],
            linkProduto: 'https://shopee.com.br/colchao', preco: 189.9,
          },
          select: { id: true },
        })
      ).id
      await prisma.integracao.create({
        data: {
          workspaceId: wsA, userId: userA, plataforma: 'instagram', status: 'conectado',
          accessToken: `TOKEN-${marca}`, tokenExpiry: new Date(Date.now() + 30 * 86_400_000),
          accountId: '178414', accountName: '@loja',
          extraData: { appId: '1', [CAMPO_DOS_SCOPES]: ['instagram_content_publish'], [CAMPO_DA_COMPROVACAO]: new Date().toISOString() } as never,
        },
      })
    })

    after(async () => {
      for (const ws of [wsA, wsB].filter(Boolean)) {
        await prisma.mLFeatureSnapshot.deleteMany({ where: { workspaceId: ws } })
        await prisma.eventoLink.deleteMany({ where: { workspaceId: ws } })
        await prisma.automationJob.deleteMany({ where: { workspaceId: ws } })
        await prisma.linkDinamico.updateMany({ where: { workspaceId: ws }, data: { publicacaoId: null } })
        await prisma.linkDinamico.deleteMany({ where: { workspaceId: ws } })
        await prisma.publicacao.deleteMany({ where: { workspaceId: ws } })
        await prisma.conteudo.deleteMany({ where: { workspaceId: ws } })
        await prisma.produto.deleteMany({ where: { workspaceId: ws } })
        await prisma.integracao.deleteMany({ where: { workspaceId: ws } })
        await prisma.auditLog.deleteMany({ where: { workspaceId: ws } })
        await prisma.user.deleteMany({ where: { workspaceId: ws } })
      }
      await prisma.workspace.deleteMany({ where: { id: { in: [wsA, wsB].filter(Boolean) } } })
      await prisma.$disconnect()
    })

    test('sem mídia: o ciclo cria UMA dependência WAITING e nenhuma peça', async () => {
      const porta = portaPrisma()
      const ciclo = await rodarCicloDeOportunidades({
        porta, agora: AGORA, escrever: true, workspaceIds: [wsA],
        capacidades: { FFMPEG: true, DIGITAL_TWIN_GPU: false, PROVEDOR_PAGO_AUTORIZADO: false },
      })
      assert.equal(ciclo.erros, 0)
      const jobs = await prisma.automationJob.findMany({ where: { workspaceId: wsA } })
      assert.equal(jobs.length, 1)
      assert.equal(jobs[0].tipo, 'SINCRONIZAR_MIDIA_AUTORIZADA')
      assert.equal(jobs[0].estado, 'WAITING')
      assert.equal(jobs[0].classe, 'EXIGE_HUMANO')
      assert.equal(await prisma.conteudo.count({ where: { workspaceId: wsA } }), 0)

      const laco = await rodarFilaDoWorkspace({
        porta, workspaceId: wsA, workerId: `w-${marca}`, agora: AGORA, limite: 5,
        capacidades: { ffmpeg: true, chatterbox: true, memoriaLivreBytes: 8 * 1024 ** 3 },
      })
      assert.equal(laco.executados, 0, 'nada a executar enquanto falta o vídeo')
    })

    test('RETRY do ciclo não duplica a dependência', async () => {
      const porta = portaPrisma()
      for (let i = 0; i < 2; i++) {
        await rodarCicloDeOportunidades({
          porta, agora: AGORA, escrever: true, workspaceIds: [wsA],
          capacidades: { FFMPEG: true, DIGITAL_TWIN_GPU: false, PROVEDOR_PAGO_AUTORIZADO: false },
        })
      }
      const jobs = await prisma.automationJob.findMany({ where: { workspaceId: wsA } })
      assert.equal(jobs.length, 1, 'mesma situação, mesma chave, mesma linha')
      assert.equal(jobs[0].tentativas, 0)
    })

    test('vídeo da Shopee como "próprio": recusado, nada gravado', async () => {
      const r = await prepararPecaComMidiaPropria({
        workspaceId: wsA, produtoId: produtoA, videoUrl: SHOPEE, gravar: true, reel: REEL_VALIDO, env: ENV, agora: AGORA,
        declaracao: { origem: 'PROPRIO', declaradoPor: userA, descricao: 'x', declaracoes: DECLARACOES_COMPLETAS },
      })
      assert.equal(r.montagem.ok, false)
      assert.equal(r.contentId, null)
      assert.equal(await prisma.conteudo.count({ where: { workspaceId: wsA } }), 0)
    })

    test('Reel reprovado ou declaração faltando: recusado, nada gravado', async () => {
      for (const caso of [
        { reel: validarReel(fixtura('deitado')), declaracoes: DECLARACOES_COMPLETAS },
        { reel: REEL_VALIDO, declaracoes: { gravadoPelaPropriaDona: true } },
        { reel: null, declaracoes: DECLARACOES_COMPLETAS },
      ]) {
        const r = await prepararPecaComMidiaPropria({
          workspaceId: wsA, produtoId: produtoA, videoUrl: VIDEO_PROPRIO_URL, gravar: true, reel: caso.reel, env: ENV, agora: AGORA,
          declaracao: { origem: 'PROPRIO', declaradoPor: userA, descricao: 'x', declaracoes: caso.declaracoes },
        })
        assert.equal(r.montagem.ok, false)
      }
      assert.equal(await prisma.conteudo.count({ where: { workspaceId: wsA } }), 0)
    })

    test('mídia própria: a peça nasce — uma só, mesmo rodando duas vezes', async () => {
      const preparar = () =>
        prepararPecaComMidiaPropria({
          workspaceId: wsA, produtoId: produtoA, videoUrl: VIDEO_PROPRIO_URL, gravar: true, reel: REEL_VALIDO, env: ENV, agora: AGORA,
          declaracao: { origem: 'PROPRIO', declaradoPor: userA, descricao: 'vídeo do colchão inflando', declaracoes: DECLARACOES_COMPLETAS },
        })
      const a = await preparar()
      const b = await preparar()
      assert.ok(a.contentId, a.montagem.ok ? '' : a.montagem.motivos.join('|'))
      assert.equal(b.contentId, a.contentId)
      assert.equal(b.reaproveitada, true)
      assert.equal(await prisma.conteudo.count({ where: { workspaceId: wsA } }), 1)
      pecaA = a.contentId!

      const c = await prisma.conteudo.findUniqueOrThrow({ where: { id: pecaA }, select: { alertasCompliance: true } })
      const ev = (c.alertasCompliance as Record<string, unknown>[]).find((x) => x.tipo === 'direito_da_midia')!
      assert.deepEqual(ev.declaracoes, DECLARACOES_COMPLETAS, 'as declarações ficam com a evidência')
    })

    test('link NÃO gerado nem confirmado: nem com o canal ligado é executável', async () => {
      const pf = await preflightDePublicacao({ workspaceId: wsA, canal: 'instagram', contentId: pecaA, env: ENV_LIGADO })
      assert.equal(pf.pronto, true, pf.explicacao.join(' | '))
      assert.equal(pf.adapterLigado, true)
      assert.equal(pf.executavelAgora, false)
      assert.equal(pf.bloqueio, 'LINK_NA_BIO_NAO_CONFIRMADO')
      assert.equal(pf.link!.estado, 'LINK_NAO_GERADO')
    })

    test('confirmação recusada: link ainda não gerado, URL errada, usuário de outro workspace', async () => {
      const sit = await situacaoDoLinkNaBio({ workspaceId: wsA, contentId: pecaA, canal: 'instagram', env: ENV })
      const antes = await prisma.auditLog.count({ where: { workspaceId: wsA, action: 'link_na_bio.confirmado' } })

      const naoGerado = await confirmarLinkNaBio({ workspaceId: wsA, contentId: pecaA, canal: 'instagram', url: sit!.url!, confirmadoPor: userA, env: ENV })
      assert.equal(naoGerado.ok, false)
      assert.match(naoGerado.explicacao, /ainda não foi gerado/)

      await gerarLinkParaABio({ workspaceId: wsA, contentId: pecaA, canal: 'instagram', env: ENV })
      const errada = await confirmarLinkNaBio({ workspaceId: wsA, contentId: pecaA, canal: 'instagram', url: 'https://outro.link/x', confirmadoPor: userA, env: ENV })
      assert.equal(errada.ok, false)
      const alheio = await confirmarLinkNaBio({ workspaceId: wsA, contentId: pecaA, canal: 'instagram', url: sit!.url!, confirmadoPor: userB, env: ENV })
      assert.equal(alheio.ok, false, 'quem confirma tem de ser deste workspace')

      assert.equal(await prisma.auditLog.count({ where: { workspaceId: wsA, action: 'link_na_bio.confirmado' } }), antes)
    })

    test('link gerado e NÃO confirmado: distribuir espera, sem chamar o canal e sem Publicacao', async () => {
      const chamadas: string[] = []
      const espiao: AdaptadorDeCanal = {
        canal: 'instagram',
        publicar: async () => { chamadas.push('x'); return { ok: true, publicacaoExternaId: 'x', erro: null } },
      }
      const r = await distribuirConteudo({
        workspaceId: wsA, contentId: pecaA, canal: 'instagram', adaptadores: { instagram: espiao }, env: ENV_LIGADO,
        chaveDaTentativa: chaveDaTentativaPadrao({ contentId: pecaA, canal: 'instagram', dataAgendamento: null }),
      })
      assert.equal(r.aguardar, true)
      assert.equal(r.motivoDaEspera, 'LINK_NA_BIO_NAO_CONFIRMADO')
      assert.equal(chamadas.length, 0)
      assert.equal(await prisma.publicacao.count({ where: { workspaceId: wsA } }), 0)
    })

    test('OUTRO WORKSPACE: não vê a peça, não confirma, não prepara peça do produto de A', async () => {
      const sit = await situacaoDoLinkNaBio({ workspaceId: wsA, contentId: pecaA, canal: 'instagram', env: ENV })
      const conf = await confirmarLinkNaBio({ workspaceId: wsB, contentId: pecaA, canal: 'instagram', url: sit!.url!, confirmadoPor: userB, env: ENV })
      assert.equal(conf.ok, false)
      const pf = await preflightDePublicacao({ workspaceId: wsB, canal: 'instagram', contentId: pecaA, env: ENV_LIGADO })
      assert.equal(pf.bloqueio, 'CONTEUDO_INDISPONIVEL')
      const peca = await prepararPecaComMidiaPropria({
        workspaceId: wsB, produtoId: produtoA, videoUrl: VIDEO_PROPRIO_URL, reel: REEL_VALIDO, gravar: true, env: ENV,
        declaracao: { origem: 'PROPRIO', declaradoPor: userB, descricao: 'x', declaracoes: DECLARACOES_COMPLETAS },
      })
      assert.equal(peca.contentId, null)
      assert.equal(await prisma.conteudo.count({ where: { workspaceId: wsB } }), 0)
    })

    test('CONFIRMAÇÃO HUMANA libera — auditada, e só para esta URL', async () => {
      const sit = await situacaoDoLinkNaBio({ workspaceId: wsA, contentId: pecaA, canal: 'instagram', env: ENV })
      assert.equal(sit!.estado, 'AGUARDANDO_CONFIRMACAO')
      const conf = await confirmarLinkNaBio({ workspaceId: wsA, contentId: pecaA, canal: 'instagram', url: sit!.url!, confirmadoPor: userA, env: ENV })
      assert.equal(conf.ok, true, conf.explicacao)
      assert.equal(conf.confirmacao!.conta, '@loja')

      const auditoria = await prisma.auditLog.findFirstOrThrow({ where: { workspaceId: wsA, action: 'link_na_bio.confirmado' } })
      assert.equal(auditoria.userId, userA)
      assert.equal(auditoria.entityId, pecaA)

      // Com o canal ligado (só neste teste, por env injetado): executável.
      const pf = await preflightDePublicacao({ workspaceId: wsA, canal: 'instagram', contentId: pecaA, env: ENV_LIGADO })
      assert.equal(pf.link!.estado, 'CONFIRMADO')
      assert.equal(pf.executavelAgora, true, pf.oQueFalta ?? '')
      // Sem o canal ligado: o ADAPTER é o que falta, e nada mais.
      const desligado = await preflightDePublicacao({ workspaceId: wsA, canal: 'instagram', contentId: pecaA, env: ENV })
      assert.equal(desligado.bloqueio, 'ADAPTER_DESLIGADO')

      // Outra tentativa = outro link = nova confirmação exigida.
      const outra = await preflightDePublicacao({
        workspaceId: wsA, canal: 'instagram', contentId: pecaA, env: ENV_LIGADO, chaveDaTentativa: `${marca}-republicacao`,
      })
      assert.equal(outra.executavelAgora, false)
      assert.equal(outra.bloqueio, 'LINK_NA_BIO_NAO_CONFIRMADO')
    })

    test('com tudo liberado, um adapter ESPIÃO recebe a peça: uma Publicacao, um LinkDinamico, URL fora da legenda', async () => {
      const recebidos: { legenda: string; urlParaDivulgar: string; formato?: string | null }[] = []
      const espiao: AdaptadorDeCanal = {
        canal: 'instagram',
        publicar: async (p) => { recebidos.push(p); return { ok: true, publicacaoExternaId: `ext-${marca}`, erro: null } },
      }
      const chave = chaveDaTentativaPadrao({ contentId: pecaA, canal: 'instagram', dataAgendamento: null })
      const sit = await situacaoDoLinkNaBio({ workspaceId: wsA, contentId: pecaA, canal: 'instagram', env: ENV })
      for (let i = 0; i < 2; i++) {
        await distribuirConteudo({
          workspaceId: wsA, contentId: pecaA, canal: 'instagram', chaveDaTentativa: chave,
          adaptadores: { instagram: espiao }, env: ENV_LIGADO,
        })
      }
      assert.ok(recebidos.length >= 1)
      assert.equal(recebidos[0].urlParaDivulgar, sit!.url, 'o link publicado é o confirmado na bio')
      assert.ok(!recebidos[0].legenda.includes(sit!.url!))
      assert.equal(recebidos[0].formato, 'VIDEO_PROPRIO')
      assert.equal(await prisma.publicacao.count({ where: { workspaceId: wsA } }), 1, 'retry não duplica')
      assert.equal(await prisma.linkDinamico.count({ where: { workspaceId: wsA } }), 1, 'o link da bio É o da publicação')
    })

    test('a porta das rotas reais: sem a flag no ambiente, nada é liberado', async () => {
      const r = await autorizarPublicacaoReal({
        workspaceId: wsA, contentId: pecaA, canal: 'instagram', envio: { tipoMidia: 'video', destino: 'feed' }, env: ENV,
      })
      assert.equal(r.liberada, false)
      assert.equal(r.bloqueio, 'ADAPTER_DESLIGADO')
      const img = await autorizarPublicacaoReal({
        workspaceId: wsA, contentId: pecaA, canal: 'instagram', envio: { tipoMidia: 'imagens', destino: 'feed' }, env: ENV_LIGADO,
      })
      assert.equal(img.liberada, false)
      assert.equal(img.bloqueio, 'ENVIO_NAO_SUPORTADO_PELO_ADAPTER')
    })

    test('ZERO publicação real: nenhum adapter ligado, flag ausente, nenhuma rede', () => {
      assert.deepEqual(Object.keys(ADAPTADORES_LIGADOS), [])
      assert.deepEqual(Object.keys(adaptadoresHabilitados(process.env)), [])
      assert.equal(process.env.PUBLICACAO_REAL_INSTAGRAM, undefined)
      assert.equal(chamadasDeRede, 0, 'nenhum fetch saiu durante a suíte')
    })
  }
)
