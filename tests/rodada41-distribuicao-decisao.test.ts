/**
 * P1.5 — Decisão de distribuição segura.
 *
 * Prova que o Patrono nunca publica só porque a peça está pronta, e que a
 * decisão cruza TRÊS fontes: o que a plataforma permite, o que nós
 * implementamos e o que a conta autorizou.
 *
 * NENHUMA chamada externa real. Nenhum provider de canal é tocado.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '../lib/prisma'
import {
  ESTADOS_DE_DISTRIBUICAO,
  ESTADOS_EXECUTAVEIS,
  MOTIVOS_DE_BLOQUEIO,
  IMPLEMENTACAO_POR_CANAL,
  LACUNAS_DE_DISTRIBUICAO,
  DECISAO_CRUZA_TRES_FONTES,
  decidirDistribuicao,
  implementacaoDoCanal,
  type ContextoDaDistribuicao,
} from '../lib/distribuicao-decisao'
import {
  TIPO_JOB_DISTRIBUICAO,
  ADAPTADORES_LIGADOS,
  NENHUM_ADAPTADOR_REAL_LIGADO,
  DISTRIBUICAO_NAO_CONHECE_PLATAFORMA,
  adaptadorDoCanal,
  distribuirConteudo,
  jobDeDistribuicao,
  acaoDeDistribuir,
  higienizar,
  lerScopesDaIntegracao,
  formatoAceitoPeloCanal,
  type AdaptadorDeCanal,
  type PedidoDeDistribuicao,
  type RespostaDoAdaptador,
} from '../lib/distribuicao-orquestrador'
import type { LinhaDaFila } from '../lib/automation-queue-repositorio'
import { capacidadeDoCanal } from '../lib/channel-registry'
import { TIKTOK_SCOPES } from '../lib/tiktok-oauth'
import { prepararTentativaDePublicacao, confirmarDistribuicao } from '../lib/publicacao-fluxo'
import { avaliarRastreamentoDoConteudo } from '../lib/rastreamento-da-publicacao'
import { confirmarLinkNaBioParaTeste } from './_fixtura-midia-propria'

const TEM_BANCO = !!process.env.DATABASE_URL
const RAIZ = join(__dirname, '..')
const marca = `r41-${Date.now()}`
const BASE_OK = { PUBLIC_BASE_URL: 'https://patrono.exemplo.com.br' }

/** Tudo em ordem — cada teste derruba uma porta por vez. */
const ctxOk = (over: Partial<ContextoDaDistribuicao> = {}): ContextoDaDistribuicao => ({
  canal: 'instagram',
  canalConectado: true,
  scopesConcedidos: ['instagram_content_publish'],
  appAprovadoPeloProvider: true,
  midiaAutorizada: true,
  formatoCompativel: true,
  // P1.9.1: o adapter real aceita a peça (vídeo, formato publicável).
  pecaParaOAdapter: { aceita: true, bloqueios: [], explicacao: [] },
  disclosurePresente: true,
  pendenciasDeCompliance: [],
  custoZero: true,
  ...over,
})

// As fixturas vivem no ARQUIVO, não numa suíte: o `after` de uma suíte
// apagaria o workspace antes de a seguinte começar.
before(async () => {
  if (!TEM_BANCO) return
  for (const n of ['A', 'B']) {
    const ws = await prisma.workspace.create({
      data: { name: `R41-${n}`, ownerId: `${marca}-${n}` },
      select: { id: true },
    })
    criados.push(ws.id)
  }
  ;[wsA, wsB] = criados

  const uA = (userA = (
    await prisma.user.create({
      data: { email: `${marca}-a@teste.local`, name: 'U', password: 'x', workspaceId: wsA },
      select: { id: true },
    })
  ).id)

  const criarProduto = async (link: string | null) =>
    (
      await prisma.produto.create({
        data: {
          workspaceId: wsA, userId: uA, nome: `${marca}-p`, categoria: 'x',
          tipoVenda: 'Afiliado', origemConteudo: 'Proprio', linkProduto: link,
        },
        select: { id: true },
      })
    ).id
  const pComLink = await criarProduto('https://loja.invalido/p')
  const pSemLink = await criarProduto(null)

  const criarConteudo = async (pid: string) =>
    (
      await prisma.conteudo.create({
        data: { workspaceId: wsA, userId: uA, produtoId: pid, roteiro: 'x', redeSocial: 'instagram' },
        select: { id: true },
      })
    ).id
  conteudoA = await criarConteudo(pComLink)
  conteudoSemUrl = await criarConteudo(pSemLink)
})

after(async () => {
  if (!TEM_BANCO) return
  for (const ws of criados) {
    await prisma.mLFeatureSnapshot.deleteMany({ where: { workspaceId: ws } })
    await prisma.linkDinamico.updateMany({ where: { workspaceId: ws }, data: { publicacaoId: null } })
    await prisma.eventoLink.deleteMany({ where: { workspaceId: ws } })
    await prisma.linkDinamico.deleteMany({ where: { workspaceId: ws } })
    await prisma.publicacao.deleteMany({ where: { workspaceId: ws } })
    await prisma.conteudo.deleteMany({ where: { workspaceId: ws } })
    await prisma.produto.deleteMany({ where: { workspaceId: ws } })
    await prisma.user.deleteMany({ where: { workspaceId: ws } })
    await prisma.auditLog.deleteMany({ where: { workspaceId: ws } })
  }
  await prisma.workspace.deleteMany({ where: { id: { in: criados } } })
  await prisma.$disconnect()
})

// ── A auditoria, congelada em teste ─────────────────────────────────────

describe('Auditoria: o registro fala da plataforma, não de nós', () => {
  test('a decisão cruza as três fontes, e isso está declarado', () => {
    assert.equal(DECISAO_CRUZA_TRES_FONTES.fontes.length, 3)
  })

  // P2.17.10: a contradição da auditoria foi FECHADA — rascunho implementado
  // (lib/tiktok-adaptador.ts), escopo pedido, Direct Post só com auditoria confirmada.
  test('TikTok: o registro diz draftUpload=true e AGORA existe implementação', () => {
    assert.equal(capacidadeDoCanal('tiktok')!.draftUpload, true, 'a plataforma permite')
    assert.equal(implementacaoDoCanal('tiktok')!.enviaDraft, true, 'e nós implementamos (lib/tiktok-adaptador.ts)')
  })

  test('TikTok: o app pede video.upload (rascunho); video.publish é o escopo do Direct Post', () => {
    assert.deepEqual([...TIKTOK_SCOPES], ['video.publish'])
    const impl = implementacaoDoCanal('tiktok')!
    assert.equal(impl.scopeParaDraft, 'video.upload')
    assert.ok(impl.scopesPedidos.includes('video.upload'), 'o escopo do rascunho é solicitado')
    assert.equal(impl.publicarExigeAprovacaoConfirmada, true, 'Direct Post só com a auditoria CONFIRMADA')
  })

  test('TikTok: Direct Post existe na plataforma (com auditoria) e o rascunho é chamado pelo adapter', () => {
    assert.equal(capacidadeDoCanal('tiktok')!.autoPublish, true)
    assert.equal(implementacaoDoCanal('tiktok')!.publicaDireto, true)
    const codigo = readFileSync(join(RAIZ, 'lib/tiktok-adaptador.ts'), 'utf8')
    assert.match(codigo, /post\/publish\/video\/init/, 'é o endpoint de Direct Post')
    assert.match(codigo, /URL_INIT_RASCUNHO/, 'e o endpoint de rascunho (inbox)')
  })

  test('Instagram: publica de verdade, e não tem rascunho por API', () => {
    const impl = implementacaoDoCanal('instagram')!
    assert.equal(impl.publicaDireto, true)
    assert.equal(impl.enviaDraft, false)
    assert.equal(capacidadeDoCanal('instagram')!.autoPublish, true)
  })

  test('canais sem adapter estão marcados como tal', () => {
    for (const canal of ['facebook', 'youtube', 'pinterest']) {
      const impl = implementacaoDoCanal(canal)!
      assert.equal(impl.publicaDireto, false, `${canal} não tem adapter`)
      assert.equal(impl.enviaDraft, false)
    }
  })

  test('as lacunas estão registradas, não esquecidas', () => {
    assert.ok(LACUNAS_DE_DISTRIBUICAO.length >= 4)
    const chaves = LACUNAS_DE_DISTRIBUICAO.map((l) => l.chave)
    assert.ok(chaves.includes('tiktok:draft-nao-implementado'))
    assert.ok(chaves.includes('tiktok:scope-de-draft-nao-pedido'))
    for (const l of LACUNAS_DE_DISTRIBUICAO) assert.ok(l.destravaCom.length > 0)
  })
})

// ── A decisão ───────────────────────────────────────────────────────────

describe('Nunca publicar só porque a peça está pronta', () => {
  test('o vocabulário tem os sete estados', () => {
    assert.deepEqual([...ESTADOS_DE_DISTRIBUICAO], [
      'AUTO_PUBLICAVEL',
      'DRAFT_AUTOMATICO',
      'AGUARDANDO_OAUTH',
      'AGUARDANDO_APROVACAO_DO_PROVIDER',
      'AGUARDANDO_MIDIA_AUTORIZADA',
      'PUBLICACAO_MANUAL_ASSISTIDA',
      'NAO_ELEGIVEL',
    ])
    assert.deepEqual([...ESTADOS_EXECUTAVEIS], ['AUTO_PUBLICAVEL', 'DRAFT_AUTOMATICO'])
  })

  test('Instagram com tudo em ordem = AUTO_PUBLICAVEL', () => {
    const r = decidirDistribuicao(ctxOk())
    assert.equal(r.estado, 'AUTO_PUBLICAVEL')
    assert.equal(r.podeExecutarSozinho, true)
    assert.deepEqual(r.bloqueios, [])
  })

  test('CANAL DESCONECTADO = AGUARDANDO_OAUTH, nunca publica', () => {
    const r = decidirDistribuicao(ctxOk({ canalConectado: false }))
    assert.equal(r.estado, 'AGUARDANDO_OAUTH')
    assert.equal(r.podeExecutarSozinho, false)
    assert.ok(r.bloqueios.includes('CANAL_DESCONECTADO'))
  })

  test('SCOPE AUSENTE = AGUARDANDO_OAUTH, com o escopo nomeado', () => {
    const r = decidirDistribuicao(ctxOk({ scopesConcedidos: [] }))
    assert.equal(r.estado, 'AGUARDANDO_OAUTH')
    assert.ok(r.bloqueios.includes('SCOPE_AUSENTE'))
    assert.ok(r.explicacao.some((e) => e.includes('instagram_content_publish')))
  })

  test('APROVAÇÃO DO PROVIDER pendente = AGUARDANDO_APROVACAO_DO_PROVIDER', () => {
    const r = decidirDistribuicao(ctxOk({ appAprovadoPeloProvider: false }))
    assert.equal(r.estado, 'AGUARDANDO_APROVACAO_DO_PROVIDER')
    assert.equal(r.podeExecutarSozinho, false)
  })

  test('aprovação DESCONHECIDA não bloqueia — só a negativa explícita', () => {
    // `null` é "não sabemos": travar aqui impediria o Instagram, que já
    // publica de verdade hoje.
    const r = decidirDistribuicao(ctxOk({ appAprovadoPeloProvider: null }))
    assert.equal(r.estado, 'AUTO_PUBLICAVEL')
  })

  test('MÍDIA SEM DIREITO = AGUARDANDO_MIDIA_AUTORIZADA', () => {
    const r = decidirDistribuicao(ctxOk({ midiaAutorizada: false }))
    assert.equal(r.estado, 'AGUARDANDO_MIDIA_AUTORIZADA')
    assert.ok(r.bloqueios.includes('MIDIA_SEM_DIREITO'))
  })

  test('COMPLIANCE PENDENTE bloqueia', () => {
    const r = decidirDistribuicao(ctxOk({ pendenciasDeCompliance: ['disclosure de saúde'] }))
    assert.equal(r.estado, 'PUBLICACAO_MANUAL_ASSISTIDA')
    assert.ok(r.bloqueios.includes('COMPLIANCE_PENDENTE'))
  })

  test('DISCLOSURE ausente bloqueia onde o canal o exige', () => {
    assert.equal(capacidadeDoCanal('instagram')!.commercialDisclosure, true)
    const r = decidirDistribuicao(ctxOk({ disclosurePresente: false }))
    assert.ok(r.bloqueios.includes('DISCLOSURE_AUSENTE'))
    assert.equal(r.podeExecutarSozinho, false)
  })

  test('FORMATO incompatível bloqueia', () => {
    const r = decidirDistribuicao(ctxOk({ formatoCompativel: false }))
    assert.ok(r.bloqueios.includes('FORMATO_INCOMPATIVEL'))
  })

  test('CUSTO não autorizado bloqueia', () => {
    const r = decidirDistribuicao(ctxOk({ custoZero: false }))
    assert.ok(r.bloqueios.includes('CUSTO_NAO_AUTORIZADO'))
    assert.equal(r.podeExecutarSozinho, false)
  })

  test('canal desconhecido = NAO_ELEGIVEL, sem assumir nada', () => {
    const r = decidirDistribuicao(ctxOk({ canal: 'rede-que-nao-existe' }))
    assert.equal(r.estado, 'NAO_ELEGIVEL')
    assert.ok(r.bloqueios.includes('CANAL_DESCONHECIDO'))
  })

  test('todo bloqueio pertence à lista declarada', () => {
    const casos = [
      ctxOk({ canalConectado: false }),
      ctxOk({ scopesConcedidos: [] }),
      ctxOk({ midiaAutorizada: false }),
      ctxOk({ custoZero: false, formatoCompativel: false }),
      ctxOk({ canal: 'x' }),
    ]
    for (const c of casos) {
      for (const b of decidirDistribuicao(c).bloqueios) {
        assert.ok((MOTIVOS_DE_BLOQUEIO as readonly string[]).includes(b))
      }
    }
  })
})

// ── TikTok, o caso que motiva a rodada ──────────────────────────────────

describe('TikTok: prioridade nº 1, mas sem fingir capacidade', () => {
  const tiktok = (over: Partial<ContextoDaDistribuicao> = {}) =>
    ctxOk({ canal: 'tiktok', scopesConcedidos: ['video.publish'], ...over })

  test('NÃO publica direto sem a auditoria CONFIRMADA (desconhecida não basta)', () => {
    const r = decidirDistribuicao(tiktok({ appAprovadoPeloProvider: null }))
    assert.notEqual(r.estado, 'AUTO_PUBLICAVEL', 'sem auditoria, Direct Post sai privado: não é publicar')
  })

  test('publica direto só com auditoria confirmada + video.publish', () => {
    const r = decidirDistribuicao(tiktok({ appAprovadoPeloProvider: true }))
    assert.equal(r.estado, 'AUTO_PUBLICAVEL')
  })

  test('com video.upload, o motor oferece o RASCUNHO (que não depende da auditoria)', () => {
    for (const aprovado of [null, false] as const) {
      const r = decidirDistribuicao(tiktok({ scopesConcedidos: ['video.publish', 'video.upload'], appAprovadoPeloProvider: aprovado }))
      assert.equal(r.estado, 'DRAFT_AUTOMATICO')
      assert.equal(r.podeExecutarSozinho, true)
    }
    void IMPLEMENTACAO_POR_CANAL
  })

  test('sem auditoria e SEM o escopo do rascunho continua em AGUARDANDO_OAUTH', () => {
    const r = decidirDistribuicao(tiktok({ scopesConcedidos: ['video.publish'], appAprovadoPeloProvider: null }))
    assert.equal(r.estado, 'AGUARDANDO_OAUTH')
    assert.ok(r.explicacao.some((e) => e.includes('video.upload')))
  })

  test('nenhum scraping nem automação de navegador em lugar nenhum', () => {
    for (const rel of ['lib/distribuicao-decisao.ts', 'lib/tiktok-channel.ts']) {
      const codigo = readFileSync(join(RAIZ, rel), 'utf8')
      for (const proibido of ['puppeteer', 'playwright', 'selenium', 'webdriver', 'cheerio']) {
        assert.ok(!codigo.includes(proibido), `${proibido} não pode aparecer em ${rel}`)
      }
    }
  })
})

// ── Segurança ───────────────────────────────────────────────────────────

describe('Nenhum segredo vaza', () => {
  test('a decisão nunca carrega token, secret ou credencial', () => {
    const r = decidirDistribuicao(ctxOk({ canalConectado: false }))
    const serializado = JSON.stringify(r)
    for (const proibido of ['accessToken', 'access_token', 'clientSecret', 'Bearer', 'refresh_token', 'CRON_SECRET']) {
      assert.ok(!serializado.includes(proibido), `${proibido} não pode viajar na decisão`)
    }
  })

  test('o contexto pede SCOPES, nunca o token', () => {
    const codigo = readFileSync(join(RAIZ, 'lib/distribuicao-decisao.ts'), 'utf8')
    for (const proibido of ['accessToken', 'clientSecret', 'refreshToken', 'process.env']) {
      assert.ok(!codigo.includes(proibido), `${proibido} não pode aparecer no módulo de decisão`)
    }
  })

  test('o módulo não faz chamada externa nenhuma', () => {
    const codigo = readFileSync(join(RAIZ, 'lib/distribuicao-decisao.ts'), 'utf8')
    for (const proibido of ['fetch(', 'axios', 'https://', 'prisma.']) {
      assert.ok(!codigo.includes(proibido), `${proibido} não pode aparecer — a decisão é pura`)
    }
  })
})

// ── Publicacao e link rastreado ─────────────────────────────────────────

const criados: string[] = []
let wsA = ''
let wsB = ''
let conteudoA = ''
let conteudoSemUrl = ''
let userA = ''

describe(
  'Publicacao e LinkDinamico no fluxo de distribuição',
  { skip: !TEM_BANCO ? 'DATABASE_URL ausente — exige Postgres' : false },
  () => {
    test('o LINK RASTREADO é usado quando dá para criá-lo', async () => {
      const t = await prepararTentativaDePublicacao({
        workspaceId: wsA, contentId: conteudoA, canal: 'instagram',
        chaveDaTentativa: `${marca}-rastreado`,
        urlDiretaDoProduto: 'https://loja.invalido/p', env: BASE_OK,
      })
      assert.equal(t.rastreada, true, t.explicacao)
      assert.match(t.urlParaDivulgar!, /\/api\/l\//)
      assert.notEqual(t.urlParaDivulgar, 'https://loja.invalido/p')
      assert.ok(t.linkId)
    })

    test('FALLBACK registra NAO_RASTREADA_COM_FALLBACK, sem esconder', async () => {
      const t = await prepararTentativaDePublicacao({
        workspaceId: wsA, contentId: conteudoSemUrl, canal: 'instagram',
        chaveDaTentativa: `${marca}-fallback`,
        urlDiretaDoProduto: null, env: BASE_OK,
      })
      assert.equal(t.rastreada, false)
      assert.ok(t.aviso, 'a lacuna precisa ser visível')

      await confirmarDistribuicao({
        workspaceId: wsA, publicacaoId: t.publicacao!.id, publicacaoExternaId: `ig_fb_${marca}`,
      })
      const r = await avaliarRastreamentoDoConteudo({ workspaceId: wsA, contentId: conteudoSemUrl })
      assert.equal(r.estado, 'NAO_RASTREADA_COM_FALLBACK')
    })

    test('RETRY não duplica Publicacao', async () => {
      const chave = `${marca}-retry`
      const a = await prepararTentativaDePublicacao({
        workspaceId: wsA, contentId: conteudoA, canal: 'instagram',
        chaveDaTentativa: chave, urlDiretaDoProduto: 'https://loja.invalido/p', env: BASE_OK,
      })
      const b = await prepararTentativaDePublicacao({
        workspaceId: wsA, contentId: conteudoA, canal: 'instagram',
        chaveDaTentativa: chave, urlDiretaDoProduto: 'https://loja.invalido/p', env: BASE_OK,
      })
      assert.equal(a.publicacao!.id, b.publicacao!.id)
      assert.equal(a.linkId, b.linkId, 'e nem outro link')
      assert.equal(
        await prisma.publicacao.count({ where: { workspaceId: wsA, chaveDaTentativa: chave } }),
        1
      )
    })

    test('REPUBLICAÇÃO cria outra Publicacao', async () => {
      const a = await prepararTentativaDePublicacao({
        workspaceId: wsA, contentId: conteudoA, canal: 'instagram',
        chaveDaTentativa: `${marca}-rep-1`, urlDiretaDoProduto: 'https://loja.invalido/p', env: BASE_OK,
      })
      const b = await prepararTentativaDePublicacao({
        workspaceId: wsA, contentId: conteudoA, canal: 'instagram',
        chaveDaTentativa: `${marca}-rep-2`, urlDiretaDoProduto: 'https://loja.invalido/p', env: BASE_OK,
      })
      assert.notEqual(a.publicacao!.id, b.publicacao!.id)
      assert.notEqual(a.linkId, b.linkId)
    })

    test('publicacaoExternaId é IDEMPOTENTE e normalizado', async () => {
      const t = await prepararTentativaDePublicacao({
        workspaceId: wsA, contentId: conteudoA, canal: 'instagram',
        chaveDaTentativa: `${marca}-ext`, urlDiretaDoProduto: 'https://loja.invalido/p', env: BASE_OK,
      })
      const id = `  ig_ext_${marca}  `
      const a = await confirmarDistribuicao({ workspaceId: wsA, publicacaoId: t.publicacao!.id, publicacaoExternaId: id })
      const b = await confirmarDistribuicao({ workspaceId: wsA, publicacaoId: t.publicacao!.id, publicacaoExternaId: id })
      assert.equal(a.publicacao!.publicacaoExternaId, `ig_ext_${marca}`, 'aparado')
      assert.equal(b.ok, true)
      assert.match(b.explicacao, /retry do provider/i)
    })

    test('a EVIDÊNCIA não carrega segredo', async () => {
      const t = await prepararTentativaDePublicacao({
        workspaceId: wsA, contentId: conteudoA, canal: 'instagram',
        chaveDaTentativa: `${marca}-evidencia`, urlDiretaDoProduto: 'https://loja.invalido/p', env: BASE_OK,
      })
      await confirmarDistribuicao({
        workspaceId: wsA, publicacaoId: t.publicacao!.id, publicacaoExternaId: `ig_ev_${marca}`,
      })
      const salva = await prisma.publicacao.findUniqueOrThrow({
        where: { id: t.publicacao!.id },
        select: { evidencia: true },
      })
      const texto = JSON.stringify(salva.evidencia)
      for (const proibido of ['accessToken', 'access_token', 'Bearer', 'clientSecret', 'refresh']) {
        assert.ok(!texto.includes(proibido), `${proibido} não pode entrar na evidência`)
      }
    })

    test('WORKSPACE ISOLADO: conteúdo de outro negócio não distribui', async () => {
      const t = await prepararTentativaDePublicacao({
        workspaceId: wsB, contentId: conteudoA, canal: 'instagram',
        chaveDaTentativa: `${marca}-cross`, urlDiretaDoProduto: null, env: BASE_OK,
      })
      assert.equal(t.ok, false, 'conteúdo de A não vira publicação em B')
      assert.equal(await prisma.publicacao.count({ where: { workspaceId: wsB } }), 0)
    })
  }
)

// ── Orquestração, com adapters mockados ─────────────────────────────────

describe(
  'Orquestração: decisão → adapter → Publicacao',
  { skip: !TEM_BANCO ? 'DATABASE_URL ausente — exige Postgres' : false },
  () => {
    /** Registra o que recebeu, e nunca sai da máquina. */
    let sequencia = 0
    const espiao = () => {
      const chamadas: PedidoDeDistribuicao[] = []
      return {
        chamadas,
        adapter: (over: Partial<RespostaDoAdaptador> = {}): AdaptadorDeCanal => ({
          canal: 'instagram',
          publicar: async (p) => {
            chamadas.push(p)
            // Único por chamada: um id externo repetido pertenceria a outra
            // Publicacao, e o guard da Etapa 2.c recusa esse merge.
            sequencia += 1
            return { ok: true, publicacaoExternaId: `ig_${sequencia}_${marca}`, erro: null, ...over }
          },
        }),
      }
    }

    const ctxAutorizado = (): ContextoDaDistribuicao => ({
      canal: 'instagram',
      canalConectado: true,
      scopesConcedidos: ['instagram_content_publish'],
      appAprovadoPeloProvider: true,
      midiaAutorizada: true,
      formatoCompativel: true,
      pecaParaOAdapter: { aceita: true, bloqueios: [], explicacao: [] },
      disclosurePresente: true,
      pendenciasDeCompliance: [],
      custoZero: true,
    })

    /**
     * P1.9.2: no Instagram o link vai na bio, e nada sai sem a confirmação
     * humana dele lá. Os testes de mecânica fazem esse passo pelo caminho
     * real; os de bloqueio chamam `distribuirConteudo` direto, sem ele.
     */
    const distribuirComBio = async (p: Parameters<typeof distribuirConteudo>[0]) => {
      if (p.workspaceId === wsA) {
        await confirmarLinkNaBioParaTeste({
          workspaceId: wsA, contentId: p.contentId, chaveDaTentativa: p.chaveDaTentativa,
          userId: userA, env: p.env,
        })
      }
      return distribuirConteudo(p)
    }

    test('nenhum adapter ligado por padrão — decidir não é publicar', () => {
      assert.deepEqual(Object.keys(ADAPTADORES_LIGADOS), [])
      assert.equal(adaptadorDoCanal('instagram'), null)
      assert.equal(adaptadorDoCanal('tiktok'), null)
    })

    test('decisão aprovada + adapter DESLIGADO = espera, sem Publicacao', async () => {
      const antes = await prisma.publicacao.count({ where: { workspaceId: wsA } })
      const r = await distribuirConteudo({
        workspaceId: wsA, contentId: conteudoA, canal: 'instagram',
        chaveDaTentativa: `${marca}-desligado`, contexto: ctxAutorizado(), env: BASE_OK,
      })
      assert.equal(r.ok, false)
      assert.equal(r.aguardar, true)
      assert.equal(r.motivoDaEspera, 'ADAPTADOR_NAO_LIGADO')
      assert.equal(r.publicacaoId, null)
      assert.equal(await prisma.publicacao.count({ where: { workspaceId: wsA } }), antes)
    })

    test('CAMINHO AUTORIZADO: publica e registra a Publicacao distribuída', async () => {
      const e = espiao()
      const r = await distribuirComBio({
        workspaceId: wsA, contentId: conteudoA, canal: 'instagram',
        chaveDaTentativa: `${marca}-auto`, contexto: ctxAutorizado(),
        adaptadores: { instagram: e.adapter() }, env: BASE_OK,
      })
      assert.equal(r.ok, true, r.explicacao)
      assert.equal(r.estado, 'AUTO_PUBLICAVEL')
      assert.equal(r.acao, 'PUBLICAR')
      assert.equal(r.registroConfirmado, true, 'o banco registrou o que o canal aceitou')
      assert.equal(e.chamadas.length, 1)

      const pub = await prisma.publicacao.findUniqueOrThrow({ where: { id: r.publicacaoId! } })
      assert.equal(pub.estado, 'DISTRIBUIDA')
      assert.equal(pub.publicacaoExternaId, r.publicacaoExternaId)
    })

    test('o canal recebe o LINK RASTREADO, não o link direto — e no Instagram ele vai na bio', async () => {
      const e = espiao()
      const r = await distribuirComBio({
        workspaceId: wsA, contentId: conteudoA, canal: 'instagram',
        chaveDaTentativa: `${marca}-link`, contexto: ctxAutorizado(),
        adaptadores: { instagram: e.adapter() }, env: BASE_OK,
      })
      assert.equal(r.rastreada, true)
      assert.match(e.chamadas[0].urlParaDivulgar, /\/api\/l\//)
      // P1.9.1: legenda do Instagram não é clicável. A URL rastreada segue
      // para quem publica (bio), e NÃO é colada no texto.
      assert.ok(!e.chamadas[0].legenda.includes(e.chamadas[0].urlParaDivulgar))
      assert.ok(!e.chamadas[0].legenda.includes('https://loja.invalido/p'))
    })

    test('P1.9.2 — produto sem link: no Instagram não há o que pôr na bio, e nada sai', async () => {
      // Antes, o fallback publicava com um link genérico colado na legenda.
      // No Instagram a legenda não é clicável e a bio precisa de UM link
      // deste produto: sem destino, espera — o adapter não é chamado.
      const e = espiao()
      const antes = await prisma.publicacao.count({ where: { workspaceId: wsA } })
      const r = await distribuirConteudo({
        workspaceId: wsA, contentId: conteudoSemUrl, canal: 'instagram',
        chaveDaTentativa: `${marca}-orq-fb`, contexto: ctxAutorizado(),
        adaptadores: { instagram: e.adapter() }, env: BASE_OK,
      })
      assert.equal(r.ok, false)
      assert.equal(r.aguardar, true)
      assert.equal(r.motivoDaEspera, 'LINK_NA_BIO_NAO_CONFIRMADO')
      assert.equal(e.chamadas.length, 0)
      assert.equal(await prisma.publicacao.count({ where: { workspaceId: wsA } }), antes)
    })

    test('P1.9.2 — link NÃO confirmado na bio: espera, o adapter não é chamado, nenhuma Publicacao', async () => {
      const e = espiao()
      const antes = await prisma.publicacao.count({ where: { workspaceId: wsA } })
      const r = await distribuirConteudo({
        workspaceId: wsA, contentId: conteudoA, canal: 'instagram',
        chaveDaTentativa: `${marca}-sem-bio`, contexto: ctxAutorizado(),
        adaptadores: { instagram: e.adapter() }, env: BASE_OK,
      })
      assert.equal(r.ok, false)
      assert.equal(r.aguardar, true, 'esperar não consome tentativa')
      assert.equal(r.motivoDaEspera, 'LINK_NA_BIO_NAO_CONFIRMADO')
      assert.equal(e.chamadas.length, 0)
      assert.equal(await prisma.publicacao.count({ where: { workspaceId: wsA } }), antes)
    })

    test('RETRY do mesmo job não cria segunda Publicacao', async () => {
      const e = espiao()
      const chave = `${marca}-orq-retry`
      const a = await distribuirComBio({
        workspaceId: wsA, contentId: conteudoA, canal: 'instagram', chaveDaTentativa: chave,
        contexto: ctxAutorizado(), adaptadores: { instagram: e.adapter() }, env: BASE_OK,
      })
      const b = await distribuirComBio({
        workspaceId: wsA, contentId: conteudoA, canal: 'instagram', chaveDaTentativa: chave,
        contexto: ctxAutorizado(), adaptadores: { instagram: e.adapter() }, env: BASE_OK,
      })
      assert.equal(a.publicacaoId, b.publicacaoId)
      assert.equal(
        await prisma.publicacao.count({ where: { workspaceId: wsA, chaveDaTentativa: chave } }),
        1
      )
    })

    test('REPUBLICAÇÃO cria outra Publicacao', async () => {
      const e = espiao()
      const a = await distribuirComBio({
        workspaceId: wsA, contentId: conteudoA, canal: 'instagram', chaveDaTentativa: `${marca}-orq-r1`,
        contexto: ctxAutorizado(), adaptadores: { instagram: e.adapter() }, env: BASE_OK,
      })
      const b = await distribuirComBio({
        workspaceId: wsA, contentId: conteudoA, canal: 'instagram', chaveDaTentativa: `${marca}-orq-r2`,
        contexto: ctxAutorizado(), adaptadores: { instagram: e.adapter() }, env: BASE_OK,
      })
      assert.notEqual(a.publicacaoId, b.publicacaoId)
    })

    test('canal aceitou e REGISTRO recusou: não mente, e não tenta de novo', async () => {
      // Id externo que já pertence a outra Publicacao. O guard da Etapa 2.c
      // recusa o merge — e recusar está certo. O que não pode é o
      // orquestrador afirmar uma distribuição que o banco não registrou.
      const idRepetido = `ig_colidido_${marca}`
      const adapter: AdaptadorDeCanal = {
        canal: 'instagram',
        publicar: async () => ({ ok: true, publicacaoExternaId: idRepetido, erro: null }),
      }
      const a = await distribuirComBio({
        workspaceId: wsA, contentId: conteudoA, canal: 'instagram', chaveDaTentativa: `${marca}-col-1`,
        contexto: ctxAutorizado(), adaptadores: { instagram: adapter }, env: BASE_OK,
      })
      assert.equal(a.registroConfirmado, true)

      const b = await distribuirComBio({
        workspaceId: wsA, contentId: conteudoA, canal: 'instagram', chaveDaTentativa: `${marca}-col-2`,
        contexto: ctxAutorizado(), adaptadores: { instagram: adapter }, env: BASE_OK,
      })
      // O post SAIU: devolver falha faria a fila republicar e duplicar.
      assert.equal(b.ok, true)
      assert.equal(b.registroConfirmado, false, 'a lacuna fica visível')
      assert.match(b.explicacao, /ATENÇÃO/)
      assert.notEqual(a.publicacaoId, b.publicacaoId)

      const pub = await prisma.publicacao.findUniqueOrThrow({ where: { id: b.publicacaoId! } })
      assert.notEqual(pub.estado, 'DISTRIBUIDA', 'o banco não registrou o que não pôde provar')
    })

    test('canal recusou: a Publicacao fica FALHOU, e não some', async () => {
      const adapter: AdaptadorDeCanal = {
        canal: 'instagram',
        publicar: async () => ({ ok: false, publicacaoExternaId: null, erro: 'Mídia rejeitada.', fatal: true }),
      }
      const r = await distribuirComBio({
        workspaceId: wsA, contentId: conteudoA, canal: 'instagram', chaveDaTentativa: `${marca}-falha`,
        contexto: ctxAutorizado(), adaptadores: { instagram: adapter }, env: BASE_OK,
      })
      assert.equal(r.ok, false)
      assert.equal(r.aguardar, false, 'recusa não é espera')
      assert.equal(r.erroFatal, true)
      const pub = await prisma.publicacao.findUniqueOrThrow({ where: { id: r.publicacaoId! } })
      assert.equal(pub.estado, 'FALHOU')
    })

    test('erro do adapter com TOKEN dentro é redigido antes de sair', async () => {
      const adapter: AdaptadorDeCanal = {
        canal: 'instagram',
        publicar: async () => {
          throw new Error('GET https://exemplo.invalido/x?access_token=EAAsegredoquenaopodevazar123 falhou')
        },
      }
      const r = await distribuirComBio({
        workspaceId: wsA, contentId: conteudoA, canal: 'instagram', chaveDaTentativa: `${marca}-token`,
        contexto: ctxAutorizado(), adaptadores: { instagram: adapter }, env: BASE_OK,
      })
      assert.equal(r.ok, false)
      assert.ok(!r.explicacao.includes('EAAsegredoquenaopodevazar123'))
      assert.match(r.explicacao, /REDIGIDO/)

      const pub = await prisma.publicacao.findUniqueOrThrow({
        where: { id: r.publicacaoId! }, select: { evidencia: true },
      })
      assert.ok(!JSON.stringify(pub.evidencia).includes('EAAsegredoquenaopodevazar123'))
    })

    test('WORKSPACE ISOLADO: B não distribui conteúdo de A, nem chama o adapter', async () => {
      const e = espiao()
      const r = await distribuirComBio({
        workspaceId: wsB, contentId: conteudoA, canal: 'instagram', chaveDaTentativa: `${marca}-orq-cross`,
        adaptadores: { instagram: e.adapter() }, env: BASE_OK,
      })
      assert.equal(r.ok, false)
      assert.equal(e.chamadas.length, 0, 'o adapter nem chega a ser chamado')
    })

    test('o job usa a fila que já existe, com entidade CONTEUDO', () => {
      const job = jobDeDistribuicao({
        workspaceId: wsA, contentId: conteudoA, canal: 'instagram', chaveDaTentativa: `${marca}-job`,
      })
      assert.equal(job.tipo, 'DISTRIBUIR_CONTEUDO')
      assert.equal(job.entityType, 'CONTEUDO')
      assert.equal(job.classe, 'AUTOMATIZAVEL')
      assert.equal(job.contexto.custoEstimado, 0)
      // Mesma chave duas vezes = mesmo job. É o que impede post duplicado.
      const igual = jobDeDistribuicao({
        workspaceId: wsA, contentId: conteudoA, canal: 'instagram', chaveDaTentativa: `${marca}-job`,
      })
      assert.equal(job.chave, igual.chave)
    })

    test('o contexto do job não guarda token nem segredo', async () => {
      const e = espiao()
      const acao = acaoDeDistribuir({ workspaceId: wsA, adaptadores: { instagram: e.adapter() }, env: BASE_OK })
      const r = await acao({
        id: 'job-x', workspaceId: wsA, tipo: 'DISTRIBUIR_CONTEUDO', entityType: 'CONTEUDO',
        entityId: conteudoA, tentativas: 0,
        contexto: { canal: 'instagram', chaveDaTentativa: `${marca}-acao` },
      } as unknown as LinhaDaFila)
      const texto = JSON.stringify(r)
      for (const proibido of ['accessToken', 'access_token', 'Bearer', 'clientSecret']) {
        assert.ok(!texto.includes(proibido), `${proibido} não pode entrar no resultado do job`)
      }
    })

    test('a ação devolve AGUARDAR, não falha, quando falta condição', async () => {
      const acao = acaoDeDistribuir({ workspaceId: wsA, env: BASE_OK })
      const r = await acao({
        id: 'job-y', workspaceId: wsA, tipo: 'DISTRIBUIR_CONTEUDO', entityType: 'CONTEUDO',
        entityId: conteudoA, tentativas: 0,
        contexto: { canal: 'tiktok', chaveDaTentativa: `${marca}-acao-tt` },
      } as unknown as LinhaDaFila)
      assert.equal(r.ok, false)
      assert.equal(r.aguardar, true, 'falta de escopo não gasta tentativa')
    })

    test('job sem chave da tentativa é FATAL, não retry', async () => {
      const acao = acaoDeDistribuir({ workspaceId: wsA, env: BASE_OK })
      const r = await acao({
        id: 'job-z', workspaceId: wsA, tipo: 'DISTRIBUIR_CONTEUDO', entityType: 'CONTEUDO',
        entityId: conteudoA, tentativas: 0, contexto: { canal: 'instagram' },
      } as unknown as LinhaDaFila)
      assert.equal(r.erroFatal, true)
    })

    test('nenhum provider PAGO é tocado pela distribuição', () => {
      const codigo = readFileSync(join(RAIZ, 'lib/distribuicao-orquestrador.ts'), 'utf8').toLowerCase()
      for (const pago of ['fal.ai', 'fal-ai', 'anthropic', 'openai', 'elevenlabs']) {
        assert.ok(!codigo.includes(pago), `${pago} não pode aparecer na distribuição`)
      }
    })

    test('o orquestrador não cita endpoint de plataforma nenhuma', () => {
      const codigo = readFileSync(join(RAIZ, 'lib/distribuicao-orquestrador.ts'), 'utf8')
      for (const host of ['open.tiktokapis.com', 'graph.facebook.com', 'graph.instagram.com']) {
        assert.ok(!codigo.includes(host), `${host} pertence ao adapter, não ao núcleo`)
      }
      assert.deepEqual([...DISTRIBUICAO_NAO_CONHECE_PLATAFORMA.proibido], [
        'scraping',
        'automação de navegador',
        'endpoint não oficial',
      ])
    })
  }
)
