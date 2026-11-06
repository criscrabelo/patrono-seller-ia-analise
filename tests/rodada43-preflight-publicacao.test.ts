/**
 * P1.5.2 — Preflight de publicação + dry run.
 *
 * Prova que o Patrono responde "esta conta está pronta para publicar
 * agora?" com evidência, e que o ensaio roda o caminho inteiro sem enviar
 * nada e sem gravar nada.
 *
 * NENHUMA postagem real. NENHUM Direct Post. NENHUM draft.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '../lib/prisma'
import {
  preflightDePublicacao,
  simularDistribuicao,
  dependenciasDoPreflight,
  DRY_RUN_NAO_E_OPERACAO,
} from '../lib/preflight-de-publicacao'
import {
  ADAPTADORES_DISPONIVEIS,
  VARIAVEL_DE_PUBLICACAO_REAL,
  LIGAR_NAO_AUTORIZA,
  adaptadoresHabilitados,
  publicacaoRealHabilitada,
  motivoDeAdapterDesligado,
} from '../lib/adaptadores-reais'
import { ADAPTADORES_LIGADOS, type AdaptadorDeCanal } from '../lib/distribuicao-orquestrador'
import { lerAutorizacao, CAMPO_DOS_SCOPES, CAMPO_DA_COMPROVACAO } from '../lib/autorizacao-da-conta'
import {
  ENV_DE_CUSTODIA,
  LEGENDA_PUBLICAVEL,
  VIDEO_PROPRIO_URL,
  evidenciaDeMidiaPropria,
  confirmarLinkNaBioParaTeste,
} from './_fixtura-midia-propria'
import { chaveDaTentativaPadrao } from '../lib/link-de-publicacao'

const TEM_BANCO = !!process.env.DATABASE_URL
const RAIZ = join(__dirname, '..')
const marca = `r43-${Date.now()}`

const ONTEM = new Date(Date.now() - 24 * 60 * 60 * 1000)
const AMANHA = new Date(Date.now() + 24 * 60 * 60 * 1000)

/** Ambiente mínimo: base pública para o link, e NADA ligado. */
const ENV_BASE: Record<string, string | undefined> = {
  PUBLIC_BASE_URL: 'https://patrono.exemplo.com.br',
  // P1.9.1: sem o host do storage não há como provar custódia da mídia.
  ...ENV_DE_CUSTODIA,
}
/** O mesmo, com o Instagram ligado de propósito. */
const ENV_LIGADO = { ...ENV_BASE, PUBLICACAO_REAL_INSTAGRAM: 'true' }

const SEGREDO = `TOKEN-SECRETO-${marca}`
const APP_SECRET = `APPSECRET-${marca}`

let wsA = ''
let wsB = ''
let userA = ''
const criados: string[] = []
/**
 * Peça completa: vídeo próprio em custódia, registro de direito do arquivo,
 * legenda com CTA e disclosure (P1.9.1).
 */
let conteudoOk = ''
/** Peça sem disclosure na legenda. */
let conteudoSemDisclosure = ''
/** Peça com vídeo e SEM registro de direito do arquivo. */
let conteudoSemDireito = ''

const LEGENDA_OK = LEGENDA_PUBLICAVEL

async function integracaoInstagram(over: {
  scopes?: string[] | null
  expiraEm?: Date | null
  refresh?: string | null
} = {}) {
  const extra: Record<string, unknown> = { appId: '123', appSecret: APP_SECRET }
  const scopes = over.scopes === undefined ? ['instagram_content_publish'] : over.scopes
  if (scopes) {
    extra[CAMPO_DOS_SCOPES] = scopes
    extra[CAMPO_DA_COMPROVACAO] = new Date().toISOString()
  }
  await prisma.integracao.deleteMany({ where: { workspaceId: wsA, plataforma: 'instagram' } })
  await prisma.integracao.create({
    data: {
      workspaceId: wsA,
      userId: userA,
      plataforma: 'instagram',
      status: 'conectado',
      accessToken: SEGREDO,
      refreshToken: over.refresh ?? null,
      tokenExpiry: over.expiraEm === undefined ? AMANHA : over.expiraEm,
      accountId: '178414',
      accountName: '@loja',
      extraData: extra as never,
    },
  })
}

// As fixturas vivem no ARQUIVO: o `after` de uma suite apagaria o
// workspace antes de a seguinte comecar.
before(async () => {
  if (!TEM_BANCO) return
  for (const n of ['A', 'B']) {
    const ws = await prisma.workspace.create({
      data: { name: `R43-${n}`, ownerId: `${marca}-${n}` },
      select: { id: true },
    })
    criados.push(ws.id)
  }
  ;[wsA, wsB] = criados
  userA = (
    await prisma.user.create({
      data: { email: `${marca}-a@teste.local`, name: 'U', password: 'x', workspaceId: wsA },
      select: { id: true },
    })
  ).id

  const criarProduto = async (origem: string) =>
    (
      await prisma.produto.create({
        data: {
          workspaceId: wsA, userId: userA, nome: `${marca}-p`, categoria: 'x',
          tipoVenda: 'Afiliado', origemConteudo: origem,
          imagens: ['https://loja.invalido/i.jpg'],
          linkProduto: 'https://loja.invalido/p',
        },
        select: { id: true },
      })
    ).id
  const comDireito = await criarProduto('Proprio')
  const semDireito = await criarProduto('Licenciado')

  const criarConteudo = async (pid: string, legenda: string, comEvidencia: boolean) =>
    (
      await prisma.conteudo.create({
        data: {
          workspaceId: wsA, userId: userA, produtoId: pid, roteiro: 'x',
          redeSocial: 'instagram', legendaInstagram: legenda,
          videoUrl: VIDEO_PROPRIO_URL,
          alertasCompliance: comEvidencia ? [evidenciaDeMidiaPropria()] : [],
        },
        select: { id: true },
      })
    ).id
  conteudoOk = await criarConteudo(comDireito, LEGENDA_OK, true)
  conteudoSemDisclosure = await criarConteudo(comDireito, 'Olha esse produto.\n\nLink na bio.', true)
  conteudoSemDireito = await criarConteudo(semDireito, LEGENDA_OK, false)

  // P1.9.2: a peça completa também tem o link rastreado GERADO e
  // CONFIRMADO na bio por uma pessoa — sem isso nada é executável.
  await confirmarLinkNaBioParaTeste({
    workspaceId: wsA, contentId: conteudoOk, userId: userA, env: ENV_BASE,
    chaveDaTentativa: chaveDaTentativaPadrao({ contentId: conteudoOk, canal: 'instagram', dataAgendamento: null }),
  })
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
    await prisma.integracao.deleteMany({ where: { workspaceId: ws } })
    await prisma.auditLog.deleteMany({ where: { workspaceId: ws } })
    await prisma.user.deleteMany({ where: { workspaceId: ws } })
  }
  await prisma.workspace.deleteMany({ where: { id: { in: criados } } })
  await prisma.$disconnect()
})


// ── O mecanismo de ligar um canal ───────────────────────────────────────

describe('Ligar um canal exige duas coisas, não uma', () => {
  test('o registro padrão continua vazio', () => {
    assert.deepEqual(Object.keys(ADAPTADORES_LIGADOS), [])
    assert.deepEqual(Object.keys(adaptadoresHabilitados(ENV_BASE)), [])
  })

  test('só a string `true` liga — nada de `1`, `yes` ou vazio', () => {
    assert.equal(publicacaoRealHabilitada('instagram', { PUBLICACAO_REAL_INSTAGRAM: 'true' }), true)
    for (const valor of ['1', 'yes', 'sim', 'TRUE ', '', undefined]) {
      assert.equal(
        publicacaoRealHabilitada('instagram', { PUBLICACAO_REAL_INSTAGRAM: valor }),
        valor === 'TRUE ' ? true : false,
        `valor ${String(valor)}`
      )
    }
  })

  test('flag sem implementação NÃO liga nada', () => {
    // O Facebook não tem adapter disponível: a variável existe e não cria o
    // que não foi escrito. (P2.17.10: o TikTok agora TEM adapter.)
    const ligados = adaptadoresHabilitados({ ...ENV_BASE, PUBLICACAO_REAL_FACEBOOK: 'true' })
    assert.deepEqual(Object.keys(ligados), [])
    assert.ok(!ADAPTADORES_DISPONIVEIS.facebook)
  })

  test('flag COM implementação liga — e só aquele canal', () => {
    const ligados = adaptadoresHabilitados(ENV_LIGADO)
    assert.deepEqual(Object.keys(ligados), ['instagram'])
  })

  test('o motivo de estar desligado é dizível', () => {
    assert.match(motivoDeAdapterDesligado('instagram', ENV_BASE)!, /PUBLICACAO_REAL_INSTAGRAM=true/)
    assert.match(motivoDeAdapterDesligado('tiktok', ENV_BASE)!, /PUBLICACAO_REAL_TIKTOK=true/)
    assert.equal(motivoDeAdapterDesligado('instagram', ENV_LIGADO), null)
    assert.equal(VARIAVEL_DE_PUBLICACAO_REAL.instagram, 'PUBLICACAO_REAL_INSTAGRAM')
  })

  test('ligar o canal não dispensa nenhuma porta anterior', () => {
    assert.ok(LIGAR_NAO_AUTORIZA.condicoesQueContinuamValendo.includes('escopo comprovado'))
    assert.ok(LIGAR_NAO_AUTORIZA.condicoesQueContinuamValendo.includes('disclosure presente'))
  })
})

// ── Preflight ───────────────────────────────────────────────────────────

describe(
  'Preflight: esta conta está pronta para publicar agora?',
  { skip: !TEM_BANCO ? 'DATABASE_URL ausente — exige Postgres' : false },
  () => {
    const pf = (over: Record<string, unknown> = {}) =>
      preflightDePublicacao({
        workspaceId: wsA, canal: 'instagram', contentId: conteudoOk, env: ENV_BASE, ...over,
      })

    test('CONEXÃO SEM SCOPE bloqueia', async () => {
      await integracaoInstagram({ scopes: null })
      const r = await pf()
      assert.equal(r.conectado, true)
      assert.equal(r.pronto, false)
      assert.equal(r.bloqueio, 'SCOPE_NAO_VERIFICAVEL')
      assert.equal(r.capabilityEfetiva.publicar, false)
      assert.match(r.oQueFalta!, /App ID e App Secret/)
    })

    test('SCOPE ERRADO bloqueia e nomeia o que falta', async () => {
      await integracaoInstagram({ scopes: ['instagram_basic'] })
      const r = await pf()
      assert.equal(r.bloqueio, 'ESCOPO_INSUFICIENTE')
      assert.deepEqual(r.scopesFaltando, ['instagram_content_publish'])
      assert.deepEqual(r.scopesNecessarios, ['instagram_content_publish'])
    })

    test('SCOPE CORRETO: o preflight avança e a conta fica PRONTA', async () => {
      await integracaoInstagram()
      const r = await pf()
      assert.equal(r.capabilityEfetiva.publicar, true)
      assert.equal(r.estadoDaDistribuicao, 'AUTO_PUBLICAVEL')
      assert.equal(r.pronto, true)
      assert.equal(r.scopesComprovadosEm !== null, true, 'o instante da comprovação está registrado')
    })

    test('ADAPTER DESLIGADO: pronto sim, executável não', async () => {
      await integracaoInstagram()
      const r = await pf()
      assert.equal(r.pronto, true, 'a conta não tem culpa de o canal estar desligado')
      assert.equal(r.executavelAgora, false)
      assert.equal(r.adapterImplementado, true)
      assert.equal(r.adapterLigado, false)
      assert.equal(r.bloqueio, 'ADAPTER_DESLIGADO')
    })

    test('INSTAGRAM COMPLETAMENTE AUTORIZADO com o canal ligado = executável', async () => {
      await integracaoInstagram()
      const r = await pf({ env: ENV_LIGADO })
      assert.equal(r.pronto, true)
      assert.equal(r.executavelAgora, true)
      assert.equal(r.bloqueio, null)
      assert.equal(r.oQueFalta, null)
    })

    test('TOKEN EXPIRADO sem refresh bloqueia e pede reconexão', async () => {
      await integracaoInstagram({ expiraEm: ONTEM })
      const r = await pf({ env: ENV_LIGADO })
      assert.equal(r.tokenValido, false)
      assert.equal(r.bloqueio, 'TOKEN_EXPIRADO')
      assert.match(r.oQueFalta!, /reconecte/i)
    })

    test('TOKEN EXPIRADO com refresh bloqueia, e diz que renova sozinho', async () => {
      await integracaoInstagram({ expiraEm: ONTEM, refresh: `REFRESH-${marca}` })
      const r = await pf({ env: ENV_LIGADO })
      assert.equal(r.executavelAgora, false)
      assert.equal(r.bloqueio, 'TOKEN_EXPIRADO')
      assert.match(r.oQueFalta!, /renovado automaticamente/)
    })

    test('APP NÃO APROVADO bloqueia mesmo com tudo o resto certo', async () => {
      await integracaoInstagram()
      const r = await pf({ env: { ...ENV_LIGADO, META_APP_APROVADO: 'false' } })
      assert.equal(r.appAprovado, false)
      assert.equal(r.pronto, false)
      assert.equal(r.bloqueio, 'APP_NAO_APROVADO')
    })

    test('MÍDIA SEM DIREITO bloqueia', async () => {
      await integracaoInstagram()
      const r = await pf({ contentId: conteudoSemDireito, env: ENV_LIGADO })
      assert.equal(r.midiaAutorizada, false)
      assert.equal(r.executavelAgora, false)
      assert.equal(r.bloqueio, 'MIDIA_SEM_DIREITO')
    })

    test('DISCLOSURE AUSENTE bloqueia', async () => {
      await integracaoInstagram()
      const r = await pf({ contentId: conteudoSemDisclosure, env: ENV_LIGADO })
      assert.equal(r.disclosurePresente, false)
      assert.equal(r.executavelAgora, false)
      assert.equal(r.bloqueio, 'DISCLOSURE_AUSENTE')
    })

    test('CUSTO ZERO: o caminho inteiro é gratuito', async () => {
      await integracaoInstagram()
      const r = await pf({ env: ENV_LIGADO })
      assert.equal(r.custoZero, true)
    })

    test('WORKSPACE ISOLADO: B não vê a conta nem a peça de A', async () => {
      await integracaoInstagram()
      const r = await preflightDePublicacao({
        workspaceId: wsB, canal: 'instagram', contentId: conteudoOk, env: ENV_LIGADO,
      })
      assert.equal(r.conectado, false)
      assert.equal(r.conta.id, null)
      assert.equal(r.executavelAgora, false)
    })

    test('sem peça, o relatório responde só sobre a CONTA', async () => {
      await integracaoInstagram()
      const r = await preflightDePublicacao({ workspaceId: wsA, canal: 'instagram', env: ENV_LIGADO })
      assert.equal(r.capabilityEfetiva.publicar, true)
      assert.equal(r.estadoDaDistribuicao, null, 'não há peça para julgar')
      assert.equal(r.pronto, true)
    })

    test('NENHUM SEGREDO no relatório', async () => {
      await integracaoInstagram()
      const texto = JSON.stringify(await pf({ env: ENV_LIGADO }))
      assert.ok(!texto.includes(SEGREDO))
      assert.ok(!texto.includes(APP_SECRET))
      for (const proibido of ['accessToken', 'refreshToken', 'clientSecret', 'appSecret', 'Bearer']) {
        assert.ok(!texto.includes(proibido), `${proibido} não pode sair no preflight`)
      }
    })
  }
)

// ── TikTok ──────────────────────────────────────────────────────────────

describe(
  'TikTok: Direct Post e Draft avaliados separadamente',
  { skip: !TEM_BANCO ? 'DATABASE_URL ausente — exige Postgres' : false },
  () => {
    async function tiktok(scopes: string[]) {
      await prisma.integracao.deleteMany({ where: { workspaceId: wsA, plataforma: 'tiktok' } })
      await prisma.integracao.create({
        data: {
          workspaceId: wsA, userId: userA, plataforma: 'tiktok', status: 'conectado',
          accessToken: SEGREDO, tokenExpiry: AMANHA, accountId: 'open-id',
          extraData: { scope: scopes.join(',') } as never,
        },
      })
    }

    test('com video.publish, a plataforma continua recusando Direct Post', async () => {
      await tiktok(['video.publish'])
      const r = await preflightDePublicacao({
        workspaceId: wsA, canal: 'tiktok', contentId: conteudoOk,
        env: { ...ENV_BASE, PUBLICACAO_REAL_TIKTOK: 'true', TIKTOK_APP_AUDITADO: 'false' },
      })
      assert.deepEqual(r.scopesComprovados, ['video.publish'])
      assert.equal(r.capabilityEfetiva.publicar, false)
      assert.equal(r.executavelAgora, false)
    })

    test('com video.upload o rascunho é capacidade da conta — mas a peça ainda passa pela checagem e pela aprovação', async () => {
      await tiktok(['video.publish', 'video.upload'])
      const r = await preflightDePublicacao({
        workspaceId: wsA, canal: 'tiktok', contentId: conteudoOk,
        env: { ...ENV_BASE, PUBLICACAO_REAL_TIKTOK: 'true', TIKTOK_APP_AUDITADO: 'false' },
      })
      assert.equal(r.capabilityEfetiva.draft, true)
      assert.equal(r.capabilityEfetiva.publicar, false, 'sem auditoria, nada de Direct Post')
      assert.equal(r.executavelAgora, false)
      assert.match(JSON.stringify(r), /Quality Gate|aprovação da titular/)
    })

    test('o adapter do TikTok existe, e só a flag explícita o liga', async () => {
      assert.equal(adaptadoresHabilitados({}).tiktok, undefined)
      assert.ok(adaptadoresHabilitados({ PUBLICACAO_REAL_TIKTOK: 'true' }).tiktok)
    })
  }
)

// ── Dry run ─────────────────────────────────────────────────────────────

describe(
  'Dry run: o caminho inteiro, sem enviar e sem gravar',
  { skip: !TEM_BANCO ? 'DATABASE_URL ausente — exige Postgres' : false },
  () => {
    test('a decisão de não criar Publicacao está declarada', () => {
      assert.ok(DRY_RUN_NAO_E_OPERACAO.naoFaz.includes('criar Publicacao'))
      assert.ok(DRY_RUN_NAO_E_OPERACAO.naoFaz.includes('marcar DISTRIBUIDA'))
      assert.match(DRY_RUN_NAO_E_OPERACAO.comoSimulaOLink, /calculada, não reservada/)
    })

    test('NÃO cria Publicacao nem LinkDinamico, mesmo com tudo liberado', async () => {
      await integracaoInstagram()
      const pubAntes = await prisma.publicacao.count({ where: { workspaceId: wsA } })
      const linkAntes = await prisma.linkDinamico.count({ where: { workspaceId: wsA } })

      const r = await simularDistribuicao({
        workspaceId: wsA, contentId: conteudoOk, canal: 'instagram', env: ENV_LIGADO,
      })
      assert.equal(r.simulado, true)
      assert.equal(r.criouPublicacao, false)
      assert.equal(r.acaoQueSeriaTomada, 'PUBLICAR')

      assert.equal(await prisma.publicacao.count({ where: { workspaceId: wsA } }), pubAntes)
      assert.equal(await prisma.linkDinamico.count({ where: { workspaceId: wsA } }), linkAntes)
    })

    test('NENHUMA Publicacao fica DISTRIBUIDA por causa do ensaio', async () => {
      await simularDistribuicao({
        workspaceId: wsA, contentId: conteudoOk, canal: 'instagram', env: ENV_LIGADO,
      })
      assert.equal(
        await prisma.publicacao.count({ where: { workspaceId: wsA, estado: 'DISTRIBUIDA' } }),
        0
      )
    })

    test('NÃO chama o adapter — nem quando o canal está ligado', async () => {
      const chamadas: string[] = []
      const espiao: AdaptadorDeCanal = {
        canal: 'instagram',
        publicar: async () => {
          chamadas.push('publicou')
          return { ok: true, publicacaoExternaId: 'x', erro: null }
        },
      }
      const r = await simularDistribuicao({
        workspaceId: wsA, contentId: conteudoOk, canal: 'instagram',
        env: ENV_LIGADO, adaptadores: { instagram: espiao },
      })
      assert.equal(r.enviouAoCanal, false)
      assert.equal(chamadas.length, 0, 'o adapter não é chamado no ensaio')
      assert.equal(r.preflight.executavelAgora, true, 'e mesmo assim o ensaio diz que daria')
    })

    test('o payload mostra o LINK RASTREADO que seria usado', async () => {
      const r = await simularDistribuicao({
        workspaceId: wsA, contentId: conteudoOk, canal: 'instagram', env: ENV_LIGADO,
      })
      assert.equal(r.payload!.linkRastreado, true)
      assert.match(r.payload!.urlQueSeriaUsada!, /\/api\/l\//)
      assert.equal(r.payload!.temMidia, true)
      assert.equal(r.payload!.disclosurePresente, true)
      // O formato vem do registro de direito do arquivo.
      assert.equal(r.payload!.formato, 'VIDEO_PROPRIO')
      // P1.9.1: no Instagram o link vai na bio, nunca colado na legenda.
      assert.equal(r.payload!.ondeVaiOLink, 'BIO')
      assert.equal(r.payload!.urlNaLegenda, false)
    })

    test('a URL simulada é a MESMA que a chave da tentativa produziria', async () => {
      const a = await simularDistribuicao({
        workspaceId: wsA, contentId: conteudoOk, canal: 'instagram',
        chaveDaTentativa: `${marca}-fixa`, env: ENV_LIGADO,
      })
      const b = await simularDistribuicao({
        workspaceId: wsA, contentId: conteudoOk, canal: 'instagram',
        chaveDaTentativa: `${marca}-fixa`, env: ENV_LIGADO,
      })
      assert.equal(a.payload!.urlQueSeriaUsada, b.payload!.urlQueSeriaUsada, 'determinística')
    })

    test('o payload leva o TAMANHO da legenda, não o texto', async () => {
      const r = await simularDistribuicao({
        workspaceId: wsA, contentId: conteudoOk, canal: 'instagram', env: ENV_LIGADO,
      })
      assert.equal(r.payload!.tamanhoDaLegenda, LEGENDA_OK.length)
      assert.ok(!JSON.stringify(r.payload).includes('Produto de teste'))
    })

    test('bloqueado: o ensaio diz que nada sairia, e por quê', async () => {
      await integracaoInstagram({ scopes: null })
      const r = await simularDistribuicao({
        workspaceId: wsA, contentId: conteudoOk, canal: 'instagram', env: ENV_LIGADO,
      })
      assert.equal(r.acaoQueSeriaTomada, 'NENHUMA')
      assert.deepEqual(r.bloqueios, ['SCOPE_NAO_VERIFICAVEL'])
    })

    test('NENHUM SEGREDO no resultado do ensaio', async () => {
      await integracaoInstagram()
      const texto = JSON.stringify(
        await simularDistribuicao({
          workspaceId: wsA, contentId: conteudoOk, canal: 'instagram', env: ENV_LIGADO,
        })
      )
      assert.ok(!texto.includes(SEGREDO))
      assert.ok(!texto.includes(APP_SECRET))
      for (const proibido of ['accessToken', 'refreshToken', 'authorization', 'Bearer']) {
        assert.ok(!texto.includes(proibido), `${proibido} não pode sair no ensaio`)
      }
    })

    test('WORKSPACE ISOLADO no ensaio', async () => {
      const r = await simularDistribuicao({
        workspaceId: wsB, contentId: conteudoOk, canal: 'instagram', env: ENV_LIGADO,
      })
      assert.equal(r.acaoQueSeriaTomada, 'NENHUMA')
      assert.equal(r.payload, null)
    })
  }
)

// ── Fila ────────────────────────────────────────────────────────────────

describe(
  'O preflight alimenta a fila que já existe',
  { skip: !TEM_BANCO ? 'DATABASE_URL ausente — exige Postgres' : false },
  () => {
    test('mídia sem direito → SINCRONIZAR_MIDIA_AUTORIZADA, no produto', async () => {
      await integracaoInstagram()
      const relatorio = await preflightDePublicacao({
        workspaceId: wsA, canal: 'instagram', contentId: conteudoSemDireito, env: ENV_LIGADO,
      })
      const autorizacao = await lerAutorizacao({ workspaceId: wsA, canal: 'instagram', env: ENV_LIGADO })
      const jobs = dependenciasDoPreflight({
        workspaceId: wsA, integracaoId: 'int-1', produtoId: 'prod-1', relatorio, autorizacao,
      })
      const midia = jobs.find((j) => j.tipo === 'SINCRONIZAR_MIDIA_AUTORIZADA')
      assert.ok(midia, 'a pendência da mídia é do produto')
      assert.equal(midia!.entityType, 'PRODUTO')
      assert.equal(midia!.classe, 'AUTOMATIZAVEL')
      assert.equal(midia!.contexto.custoEstimado, 0)
    })

    test('conta sem escopo → CONECTAR_CANAL, reusando a autoridade da P1.5.1', async () => {
      await integracaoInstagram({ scopes: null })
      const relatorio = await preflightDePublicacao({
        workspaceId: wsA, canal: 'instagram', contentId: conteudoOk, env: ENV_LIGADO,
      })
      const autorizacao = await lerAutorizacao({ workspaceId: wsA, canal: 'instagram', env: ENV_LIGADO })
      const jobs = dependenciasDoPreflight({
        workspaceId: wsA, integracaoId: 'int-1', produtoId: 'prod-1', relatorio, autorizacao,
      })
      assert.equal(jobs[0].tipo, 'CONECTAR_CANAL')
      assert.equal(jobs[0].classe, 'EXIGE_HUMANO')
    })

    test('tudo pronto → nenhuma pendência', async () => {
      await integracaoInstagram()
      const relatorio = await preflightDePublicacao({
        workspaceId: wsA, canal: 'instagram', contentId: conteudoOk, env: ENV_LIGADO,
      })
      const autorizacao = await lerAutorizacao({ workspaceId: wsA, canal: 'instagram', env: ENV_LIGADO })
      const jobs = dependenciasDoPreflight({
        workspaceId: wsA, integracaoId: 'int-1', produtoId: 'prod-1', relatorio, autorizacao,
      })
      assert.deepEqual(jobs, [])
    })
  }
)

// ── Código ──────────────────────────────────────────────────────────────

describe('O que os módulos desta rodada não fazem', () => {
  test('o preflight não publica, não grava e não chama a rede', () => {
    const codigo = readFileSync(join(RAIZ, 'lib/preflight-de-publicacao.ts'), 'utf8')
    for (const proibido of [
      'fetch(',
      'publicarReelInstagram',
      'TikTokPublisher',
      'confirmarDistribuicao',
      'marcarDistribuida',
      'prepararTentativaDePublicacao',
      'prisma.publicacao.create',
      'prisma.linkDinamico.create',
    ]) {
      assert.ok(!codigo.includes(proibido), `${proibido} não pode aparecer no preflight`)
    }
  })

  test('a rota de revalidação não posta nada', () => {
    const codigo = readFileSync(join(RAIZ, 'app/api/integracoes/instagram/revalidar/route.ts'), 'utf8')
    for (const proibido of ['publicarReelInstagram', 'criarContainer', 'publicarContainer']) {
      assert.ok(!codigo.includes(proibido), `${proibido} não pode aparecer na revalidação`)
    }
    // Só as chamadas oficiais que o fluxo de conexão já usava.
    assert.match(codigo, /validarCredenciaisInstagram/)
    assert.match(codigo, /inspecionarTokenMeta/)
  })

  test('a tela não mostra token nem secret', () => {
    const codigo = readFileSync(join(RAIZ, 'app/(dashboard)/integracoes/page.tsx'), 'utf8')
    // A tela ESCREVE accessToken/appSecret nos campos de conexão; o que ela
    // não pode é LER de volta da resposta da API.
    for (const proibido of ['status?.accessToken', 'status.accessToken', 'autorizacao?.token']) {
      assert.ok(!codigo.includes(proibido), `${proibido} não pode ser lido na tela`)
    }
    assert.match(codigo, /oQueFalta/, 'a tela explica o bloqueio')
  })

  test('o adapter real do Instagram busca o token, não o recebe', () => {
    const codigo = readFileSync(join(RAIZ, 'lib/adaptadores-reais.ts'), 'utf8')
    assert.match(codigo, /prisma\.integracao\.findFirst/)
    assert.ok(!/pedido\.accessToken/.test(codigo), 'o token não viaja no pedido')
    assert.match(codigo, /higienizar/, 'o erro da Meta é higienizado')
  })
})
