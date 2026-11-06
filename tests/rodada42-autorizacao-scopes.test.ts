/**
 * P1.5.1 — Autorizações e scopes verificáveis.
 *
 * Prova que o Patrono sabe, de forma persistente e auditável, o que cada
 * conta REALMENTE autorizou — e que ter token nunca vira ter permissão.
 *
 * NENHUMA publicação. NENHUMA chamada externa real.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '../lib/prisma'
import {
  ESTADOS_DA_AUTORIZACAO,
  MOTIVOS_DA_CONTA,
  TIPO_JOB_RENOVAR_TOKEN,
  TOKEN_NAO_E_PERMISSAO,
  CAMPO_DOS_SCOPES,
  CAMPO_DA_COMPROVACAO,
  aprovacaoDoApp,
  derivarAutorizacao,
  capabilityEfetivaDaConta,
  scopesExigidosDoCanal,
  lerScopesComprovados,
  lerAutorizacao,
  resumoPublicoDaIntegracao,
  dependenciaDaAutorizacao,
  type RegistroDaIntegracao,
} from '../lib/autorizacao-da-conta'
import {
  RENOVADORES_LIGADOS,
  renovadorDoCanal,
  renovarAcessoDaConta,
  acaoDeRenovarToken,
  type RenovadorDeAcesso,
} from '../lib/renovacao-de-acesso'
import { ADAPTADORES_LIGADOS } from '../lib/distribuicao-orquestrador'
import { implementacaoDoCanal } from '../lib/distribuicao-decisao'
import { perfilDaDependencia } from '../lib/automation-queue-contrato'
import type { LinhaDaFila } from '../lib/automation-queue-repositorio'

const TEM_BANCO = !!process.env.DATABASE_URL
const RAIZ = join(__dirname, '..')
const marca = `r42-${Date.now()}`

const ONTEM = new Date(Date.now() - 24 * 60 * 60 * 1000)
const AMANHA = new Date(Date.now() + 24 * 60 * 60 * 1000)
const SEM_APROVACAO: Record<string, string | undefined> = {}

/** Uma conexão em ordem. Cada teste derruba um fator por vez. */
const conta = (over: Partial<RegistroDaIntegracao> = {}): RegistroDaIntegracao => ({
  canal: 'instagram',
  conectada: true,
  temToken: true,
  temRefreshToken: false,
  expiraEm: AMANHA,
  contaId: '178414',
  contaNome: '@loja',
  scopesComprovados: ['instagram_content_publish'],
  scopesComprovadosEm: new Date(),
  ...over,
})

const autorizar = (over: Partial<RegistroDaIntegracao> = {}, env = SEM_APROVACAO) =>
  derivarAutorizacao(conta(over), { env })

// ── O vocabulário ───────────────────────────────────────────────────────

describe('Os estados que a P1.5.1 pediu para distinguir', () => {
  test('os cinco estados existem, e DESCONECTADA junto', () => {
    for (const e of [
      'CONECTADA',
      'SCOPES_COMPROVADOS',
      'SCOPES_NAO_VERIFICAVEIS',
      'ESCOPO_INSUFICIENTE',
      'TOKEN_EXPIRADO',
    ]) {
      assert.ok((ESTADOS_DA_AUTORIZACAO as readonly string[]).includes(e), e)
    }
    // Sem conta conectada não é "conectada com escopo ilegível": é outra
    // coisa, e confundir as duas esconderia o que destrava cada uma.
    assert.ok((ESTADOS_DA_AUTORIZACAO as readonly string[]).includes('DESCONECTADA'))
  })

  test('a conta da capability efetiva tem os quatro fatores', () => {
    assert.deepEqual([...TOKEN_NAO_E_PERMISSAO.fatores], [
      'capability da plataforma',
      'implementação do Patrono',
      'scope concedido pela conta',
      'aprovação do app pelo provider',
    ])
  })
})

// ── A autorização, fator por fator ──────────────────────────────────────

describe('Ter token não é ter permissão', () => {
  test('TOKEN SEM SCOPES não libera o Instagram', () => {
    const a = autorizar({ scopesComprovados: null })
    assert.equal(a.estado, 'SCOPES_NAO_VERIFICAVEIS')

    const c = capabilityEfetivaDaConta(a)
    assert.equal(c.publicar.permitido, false)
    assert.equal(c.publicar.bloqueio, 'SCOPE_NAO_VERIFICAVEL')
    assert.equal(c.algoLiberado, false)
  })

  test('SCOPE CORRETO libera a capability de publicar', () => {
    const a = autorizar()
    assert.equal(a.estado, 'SCOPES_COMPROVADOS')

    const c = capabilityEfetivaDaConta(a)
    assert.equal(c.publicar.permitido, true)
    assert.equal(c.publicar.plataformaPermite, true)
    assert.equal(c.publicar.patronoImplementa, true)
    assert.equal(c.publicar.scopeConcedido, true)
    assert.equal(c.publicar.bloqueio, null)
  })

  test('SCOPE INSUFICIENTE bloqueia e nomeia o que falta', () => {
    const a = autorizar({ scopesComprovados: ['instagram_basic', 'pages_show_list'] })
    assert.equal(a.estado, 'ESCOPO_INSUFICIENTE')
    assert.deepEqual(a.scopesFaltando, ['instagram_content_publish'])

    const c = capabilityEfetivaDaConta(a)
    assert.equal(c.publicar.permitido, false)
    assert.equal(c.publicar.bloqueio, 'ESCOPO_INSUFICIENTE')
  })

  test('TOKEN EXPIRADO bloqueia mesmo com o escopo certo', () => {
    const a = autorizar({ expiraEm: ONTEM })
    assert.equal(a.estado, 'TOKEN_EXPIRADO')
    assert.equal(a.expirado, true)

    const c = capabilityEfetivaDaConta(a)
    assert.equal(c.publicar.permitido, false)
    assert.equal(c.publicar.bloqueio, 'TOKEN_EXPIRADO')
  })

  test('sem token não há autorização nenhuma', () => {
    assert.equal(autorizar({ temToken: false }).estado, 'DESCONECTADA')
    assert.equal(autorizar({ conectada: false }).estado, 'DESCONECTADA')
  })

  test('expirado COM refresh é automatizável; sem refresh, não', () => {
    assert.equal(autorizar({ expiraEm: ONTEM, temRefreshToken: true }).podeRenovarSozinho, true)
    assert.equal(autorizar({ expiraEm: ONTEM, temRefreshToken: false }).podeRenovarSozinho, false)
  })

  test('sem validade declarada o acesso não é tratado como vencido', () => {
    // `null` aqui significa "o provider não informou prazo", que é comum em
    // token de longa duração — e tratar isso como vencido derrubaria conta boa.
    assert.equal(autorizar({ expiraEm: null }).expirado, false)
  })

  test('todo bloqueio pertence à lista declarada', () => {
    const casos = [
      autorizar({ scopesComprovados: null }),
      autorizar({ scopesComprovados: [] }),
      autorizar({ expiraEm: ONTEM }),
      autorizar({ conectada: false }),
      autorizar({ canal: 'pinterest' }),
    ]
    for (const a of casos) {
      const c = capabilityEfetivaDaConta(a)
      for (const b of [c.publicar.bloqueio, c.draft.bloqueio]) {
        if (b !== null) assert.ok((MOTIVOS_DA_CONTA as readonly string[]).includes(b), String(b))
      }
    }
  })
})

// ── Aprovação do app ────────────────────────────────────────────────────

describe('Aprovação do app pelo provider', () => {
  test('APP NÃO APROVADO bloqueia, mesmo com tudo o resto em ordem', () => {
    const a = autorizar({}, { META_APP_APROVADO: 'false' })
    assert.equal(a.estado, 'SCOPES_COMPROVADOS', 'o escopo está lá')
    assert.equal(a.aprovacaoDoApp, false)

    const c = capabilityEfetivaDaConta(a)
    assert.equal(c.publicar.permitido, false)
    assert.equal(c.publicar.bloqueio, 'APP_NAO_APROVADO')
  })

  test('aprovação DESCONHECIDA não bloqueia — só a reprovação conhecida', () => {
    assert.equal(aprovacaoDoApp('instagram', {}), null)
    assert.equal(aprovacaoDoApp('instagram', { META_APP_APROVADO: 'talvez' }), null)
    assert.equal(capabilityEfetivaDaConta(autorizar()).publicar.permitido, true)
  })

  test('aprovação afirmada é lida como afirmada', () => {
    assert.equal(aprovacaoDoApp('tiktok', { TIKTOK_APP_AUDITADO: 'true' }), true)
    assert.equal(aprovacaoDoApp('tiktok', { TIKTOK_APP_AUDITADO: 'false' }), false)
  })

  test('canal desconhecido não tem variável, e não vira aprovado', () => {
    assert.equal(aprovacaoDoApp('rede-que-nao-existe', { QUALQUER: 'true' }), null)
  })
})

// ── TikTok ──────────────────────────────────────────────────────────────

describe('TikTok: publish e upload são coisas diferentes', () => {
  const tiktok = (scopes: string[] | null) =>
    autorizar({ canal: 'tiktok', scopesComprovados: scopes })

  // P2.17.10: rascunho implementado (lib/tiktok-adaptador.ts); Direct Post só
  // com a auditoria CONFIRMADA. Os testes abaixo congelam essas regras.
  test('sem auditoria confirmada, a implementação exige só o escopo do rascunho', () => {
    assert.deepEqual(scopesExigidosDoCanal(implementacaoDoCanal('tiktok')), ['video.upload'])
    assert.deepEqual(scopesExigidosDoCanal(implementacaoDoCanal('tiktok'), true), ['video.publish', 'video.upload'])
  })

  test('só video.publish NÃO ganha rascunho (falta video.upload)', () => {
    const c = capabilityEfetivaDaConta(tiktok(['video.publish']))
    assert.equal(c.draft.permitido, false)
    assert.equal(c.draft.bloqueio, 'ESCOPO_INSUFICIENTE')
    assert.equal(c.draft.plataformaPermite, true)
    assert.equal(c.draft.patronoImplementa, true)
  })

  test('COM video.upload o rascunho é liberado (não depende da auditoria)', () => {
    const c = capabilityEfetivaDaConta(tiktok(['video.publish', 'video.upload']))
    assert.equal(c.draft.permitido, true)
    assert.equal(c.algoLiberado, true)
  })

  test('publicar direto no TikTok exige a auditoria confirmada', () => {
    const c = capabilityEfetivaDaConta(tiktok(['video.publish']))
    assert.equal(c.publicar.permitido, false)
    assert.equal(c.publicar.bloqueio, 'APP_NAO_APROVADO')
    assert.equal(c.publicar.patronoImplementa, true, 'o Direct Post está escrito')
  })

  test('DRAFT_AUTOMATICO só nasce com os três: implementação, pedido e concessão', () => {
    const impl = implementacaoDoCanal('tiktok')!
    assert.equal(impl.enviaDraft, true, '1. há implementação')
    assert.ok(impl.scopesPedidos.includes('video.upload'), '2. o app pede o escopo')
    assert.equal(capabilityEfetivaDaConta(tiktok(['user.info.basic'])).draft.permitido, false, '3. sem a concessão, não')
  })
})

// ── Canais sem adapter ──────────────────────────────────────────────────

describe('Canais sem implementação', () => {
  test('pinterest não exige escopo porque não faz nada', () => {
    const a = autorizar({ canal: 'pinterest', scopesComprovados: [] })
    assert.deepEqual(a.scopesExigidosPelaImplementacao, [])
    assert.equal(a.estado, 'CONECTADA', 'conectada, e sem nada a comprovar')

    const c = capabilityEfetivaDaConta(a)
    assert.equal(c.publicar.bloqueio, 'PLATAFORMA_NAO_PERMITE')
    assert.equal(c.algoLiberado, false)
  })

  test('facebook: a plataforma permite e nós não implementamos', () => {
    const c = capabilityEfetivaDaConta(autorizar({ canal: 'facebook', scopesComprovados: [] }))
    assert.equal(c.publicar.bloqueio, 'ADAPTER_NAO_IMPLEMENTADO')
  })
})

// ── Leitura dos escopos guardados ───────────────────────────────────────

describe('Onde os escopos comprovados moram', () => {
  test('lê o campo desta rodada, e o `scope` que o OAuth já gravava', () => {
    assert.deepEqual(lerScopesComprovados({ [CAMPO_DOS_SCOPES]: ['a', 'b'] }), ['a', 'b'])
    assert.deepEqual(lerScopesComprovados({ scope: 'video.publish,video.upload' }), [
      'video.publish',
      'video.upload',
    ])
  })

  test('sem nenhum dos dois campos, a resposta é NULL, não vazio', () => {
    // A diferença decide o estado: `[]` é "nada concedido", `null` é "não sei".
    assert.equal(lerScopesComprovados({ appId: '123' }), null)
    assert.equal(lerScopesComprovados(null), null)
    assert.equal(lerScopesComprovados({ scope: 42 }), null)
  })

  test('o campo desta rodada tem precedência sobre o antigo', () => {
    const lido = lerScopesComprovados({ [CAMPO_DOS_SCOPES]: ['novo'], scope: 'antigo' })
    assert.deepEqual(lido, ['novo'])
  })
})

// ── Segurança ───────────────────────────────────────────────────────────

describe('Nenhum segredo sai', () => {
  test('o resumo público não tem token, secret nem header', () => {
    const texto = JSON.stringify(resumoPublicoDaIntegracao(autorizar()))
    for (const proibido of [
      'accessToken',
      'access_token',
      'refreshToken',
      'refresh_token',
      'clientSecret',
      'appSecret',
      'Bearer',
      'authorization',
    ]) {
      assert.ok(!texto.includes(proibido), `${proibido} não pode sair no resumo`)
    }
  })

  test('o resumo leva só o que a P1.5.1 autorizou mostrar', () => {
    const r = resumoPublicoDaIntegracao(autorizar())
    assert.deepEqual(Object.keys(r).sort(), [
      'bloqueio',
      'capabilities',
      'conta',
      'estado',
      'motivo',
      'provider',
      'scopes',
      // P1.5.2: o instante da comprovacao passou a aparecer — e continua
      // sendo um fato publico, nao um segredo.
      'scopesComprovadosEm',
      'scopesFaltando',
      'validade',
    ])
  })

  test('a função pura nem recebe token: o contrato é `temToken`', () => {
    const codigo = readFileSync(join(RAIZ, 'lib/autorizacao-da-conta.ts'), 'utf8')
    // O CONTRATO, não o arquivo: dentro da leitura do banco existe um tipo
    // local para a linha do Prisma, e ali o token é lido de propósito — para
    // virar um booleano e ser descartado na mesma linha.
    const contrato = codigo.slice(
      codigo.indexOf('export interface RegistroDaIntegracao'),
      codigo.indexOf('export interface AutorizacaoDaConta')
    )
    assert.ok(contrato.length > 0)
    assert.match(contrato, /temToken: boolean/)
    for (const proibido of ['accessToken', 'refreshToken', 'clientSecret']) {
      assert.ok(!contrato.includes(proibido), `${proibido} não pode ser campo do contrato`)
    }
  })

  test('a rota de integrações não devolve mais a linha crua', () => {
    const codigo = readFileSync(join(RAIZ, 'app/api/integracoes/route.ts'), 'utf8')
    assert.ok(!/NextResponse\.json\(integracoes\)/.test(codigo), 'GET não devolve a linha inteira')
    assert.ok(!/NextResponse\.json\(integracao\)/.test(codigo), 'POST não devolve a linha inteira')
    assert.match(codigo, /resumoPublicoDaIntegracao/)
  })

  test('nenhum dos módulos novos chama a rede', () => {
    for (const rel of ['lib/autorizacao-da-conta.ts', 'lib/renovacao-de-acesso.ts']) {
      const codigo = readFileSync(join(RAIZ, rel), 'utf8')
      for (const proibido of ['fetch(', 'axios', 'https://']) {
        assert.ok(!codigo.includes(proibido), `${proibido} não pode aparecer em ${rel}`)
      }
    }
  })
})

// ── Nenhuma publicação ──────────────────────────────────────────────────

describe('Nenhuma publicação real acontece nesta rodada', () => {
  test('nenhum adapter de canal e nenhum renovador estão ligados', () => {
    assert.deepEqual(Object.keys(ADAPTADORES_LIGADOS), [])
    assert.deepEqual(Object.keys(RENOVADORES_LIGADOS), [])
    assert.equal(renovadorDoCanal('instagram'), null)
    assert.equal(renovadorDoCanal('tiktok'), null)
  })

  test('os módulos desta rodada não publicam nem enviam rascunho', () => {
    for (const rel of ['lib/autorizacao-da-conta.ts', 'lib/renovacao-de-acesso.ts']) {
      const codigo = readFileSync(join(RAIZ, rel), 'utf8')
      for (const proibido of ['publicarReelInstagram', 'TikTokPublisher', 'distribuirConteudo']) {
        assert.ok(!codigo.includes(proibido), `${proibido} não pode aparecer em ${rel}`)
      }
    }
  })
})

// ── A fila que já existe ────────────────────────────────────────────────

describe('Automation Queue: cada falta gera a dependência certa', () => {
  const dep = (over: Partial<RegistroDaIntegracao>, env = SEM_APROVACAO) =>
    dependenciaDaAutorizacao({
      workspaceId: 'ws-1',
      integracaoId: 'int-1',
      autorizacao: autorizar(over, env),
    })

  test('OAUTH necessário → EXIGE_HUMANO, sem tentativa automática', () => {
    const j = dep({ conectada: false })!
    assert.equal(j.tipo, 'CONECTAR_CANAL')
    assert.equal(j.classe, 'EXIGE_HUMANO')
    assert.equal(perfilDaDependencia(j.tipo).maxTentativas, 0, 'nunca tenta sozinho')
  })

  test('TOKEN EXPIRADO com refresh → AUTOMATIZÁVEL', () => {
    const j = dep({ expiraEm: ONTEM, temRefreshToken: true })!
    assert.equal(j.tipo, TIPO_JOB_RENOVAR_TOKEN)
    assert.equal(j.classe, 'AUTOMATIZAVEL')
    assert.equal(perfilDaDependencia(j.tipo).maxTentativas, 3)
  })

  test('TOKEN EXPIRADO sem refresh → humano, não retry infinito', () => {
    const j = dep({ expiraEm: ONTEM, temRefreshToken: false })!
    assert.equal(j.tipo, 'CONECTAR_CANAL')
    assert.equal(j.classe, 'EXIGE_HUMANO')
  })

  test('ESCOPO INSUFICIENTE → nova autorização, com o que falta no contexto', () => {
    const j = dep({ scopesComprovados: [] })!
    assert.equal(j.tipo, 'CONECTAR_CANAL')
    assert.deepEqual(j.contexto.scopesFaltando, ['instagram_content_publish'])
  })

  test('APP NÃO APROVADO → AGUARDA_CONDICAO, sem tentativa', () => {
    const j = dep({}, { META_APP_APROVADO: 'false' })!
    assert.equal(j.tipo, 'HABILITAR_CAPACIDADE')
    assert.equal(j.classe, 'AGUARDA_CONDICAO')
    assert.equal(perfilDaDependencia(j.tipo).maxTentativas, 0)
  })

  test('tudo em ordem → nenhuma dependência', () => {
    assert.equal(dep({}), null)
  })

  test('a dependência aponta para a INTEGRACAO, e é idempotente', () => {
    const a = dep({ conectada: false })!
    const b = dep({ conectada: false })!
    assert.equal(a.entityType, 'INTEGRACAO')
    assert.equal(a.chave, b.chave, 'mesma situação = mesmo job')
    assert.equal(a.contexto.custoEstimado, 0)
  })
})

// ── Contra o banco ──────────────────────────────────────────────────────

const criados: string[] = []
let wsA = ''
let wsB = ''
let userA = ''
let userB = ''

async function conectar(params: {
  workspaceId: string
  userId: string
  plataforma: string
  extraData?: Record<string, unknown>
  tokenExpiry?: Date | null
  refreshToken?: string | null
}) {
  return prisma.integracao.create({
    data: {
      workspaceId: params.workspaceId,
      userId: params.userId,
      plataforma: params.plataforma,
      status: 'conectado',
      accessToken: `TOKEN-SECRETO-${marca}`,
      refreshToken: params.refreshToken ?? null,
      tokenExpiry: params.tokenExpiry ?? AMANHA,
      accountId: '178414',
      accountName: '@loja',
      extraData: (params.extraData ?? {}) as never,
    },
    select: { id: true },
  })
}

// As fixturas vivem no ARQUIVO, não numa suíte: o `after` de uma suíte
// apagaria o workspace antes de a seguinte começar.
  before(async () => {
  if (!TEM_BANCO) return
    for (const n of ['A', 'B']) {
      const ws = await prisma.workspace.create({
        data: { name: `R42-${n}`, ownerId: `${marca}-${n}` },
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
    userB = (
      await prisma.user.create({
        data: { email: `${marca}-b@teste.local`, name: 'U', password: 'x', workspaceId: wsB },
        select: { id: true },
      })
    ).id
  })

  after(async () => {
  if (!TEM_BANCO) return
    for (const ws of criados) {
      await prisma.integracao.deleteMany({ where: { workspaceId: ws } })
      await prisma.auditLog.deleteMany({ where: { workspaceId: ws } })
      await prisma.user.deleteMany({ where: { workspaceId: ws } })
    }
    await prisma.workspace.deleteMany({ where: { id: { in: criados } } })
    await prisma.$disconnect()
  })


describe(
  'A autorização lida do banco',
  { skip: !TEM_BANCO ? 'DATABASE_URL ausente — exige Postgres' : false },
  () => {
    test('conexão SEM escopo gravado = SCOPES_NAO_VERIFICAVEIS', async () => {
      await conectar({
        workspaceId: wsA,
        userId: userA,
        plataforma: 'instagram',
        // Exatamente o que a conexão por token colado gravava antes: segredo
        // da Meta, e nenhuma permissão comprovada.
        extraData: { appId: '123', appSecret: 'SEGREDO-DA-META' },
      })
      const a = await lerAutorizacao({ workspaceId: wsA, canal: 'instagram', env: SEM_APROVACAO })
      assert.equal(a.estado, 'SCOPES_NAO_VERIFICAVEIS')
      assert.equal(capabilityEfetivaDaConta(a).publicar.permitido, false)
    })

    test('o resumo dessa conexão não vaza o appSecret', async () => {
      const a = await lerAutorizacao({ workspaceId: wsA, canal: 'instagram', env: SEM_APROVACAO })
      const texto = JSON.stringify(resumoPublicoDaIntegracao(a))
      assert.ok(!texto.includes('SEGREDO-DA-META'))
      assert.ok(!texto.includes(`TOKEN-SECRETO-${marca}`))
      assert.equal(JSON.stringify(a).includes(`TOKEN-SECRETO-${marca}`), false)
    })

    test('com o escopo COMPROVADO gravado, a capability libera', async () => {
      await prisma.integracao.updateMany({
        where: { workspaceId: wsA, plataforma: 'instagram' },
        data: {
          extraData: {
            appId: '123',
            appSecret: 'SEGREDO-DA-META',
            [CAMPO_DOS_SCOPES]: ['instagram_content_publish'],
            [CAMPO_DA_COMPROVACAO]: new Date().toISOString(),
          } as never,
        },
      })
      const a = await lerAutorizacao({ workspaceId: wsA, canal: 'instagram', env: SEM_APROVACAO })
      assert.equal(a.estado, 'SCOPES_COMPROVADOS')
      assert.equal(capabilityEfetivaDaConta(a).publicar.permitido, true)
    })

    test('WORKSPACE ISOLADO: a conta de A não autoriza nada em B', async () => {
      const b = await lerAutorizacao({ workspaceId: wsB, canal: 'instagram', env: SEM_APROVACAO })
      assert.equal(b.estado, 'DESCONECTADA')
      assert.equal(b.contaId, null, 'nem o id da conta vaza')
      assert.equal(capabilityEfetivaDaConta(b).algoLiberado, false)
    })

    test('conexão inexistente responde igual a conexão de outro workspace', async () => {
      const inexistente = await lerAutorizacao({ workspaceId: wsB, canal: 'youtube', env: SEM_APROVACAO })
      const deOutro = await lerAutorizacao({ workspaceId: wsB, canal: 'instagram', env: SEM_APROVACAO })
      assert.equal(inexistente.estado, deOutro.estado)
      assert.equal(inexistente.contaId, deOutro.contaId)
    })
  }
)

// ── Renovação ───────────────────────────────────────────────────────────

describe(
  'Renovação: o consentimento já guardado faz o trabalho',
  { skip: !TEM_BANCO ? 'DATABASE_URL ausente — exige Postgres' : false },
  () => {
    let integracaoId = ''

    before(async () => {
      const i = await conectar({
        workspaceId: wsB,
        userId: userB,
        plataforma: 'tiktok',
        tokenExpiry: ONTEM,
        refreshToken: `REFRESH-SECRETO-${marca}`,
        extraData: { scope: 'video.publish' },
      })
      integracaoId = i.id
    })

    /** Grava o token novo por dentro, como um renovador real faria. */
    const renovadorFalso = (over: Partial<{ scopes: string[] | null; ok: boolean }> = {}): RenovadorDeAcesso => ({
      canal: 'tiktok',
      renovar: async ({ integracaoId: id }) => {
        if (over.ok === false) {
          return { ok: false, expiraEm: null, scopes: null, erro: 'refresh revogado', fatal: true }
        }
        await prisma.integracao.update({
          where: { id },
          data: { accessToken: `TOKEN-NOVO-${marca}`, tokenExpiry: AMANHA },
        })
        return {
          ok: true,
          expiraEm: AMANHA,
          scopes: over.scopes === undefined ? ['user.info.basic', 'video.upload', 'video.list'] : over.scopes,
          erro: null,
        }
      },
    })

    test('expirado com refresh, e nenhum renovador ligado = espera', async () => {
      const r = await renovarAcessoDaConta({
        workspaceId: wsB, integracaoId, canal: 'tiktok', env: SEM_APROVACAO,
      })
      assert.equal(r.ok, false)
      assert.equal(r.aguardar, true)
      assert.equal(r.motivo, 'RENOVADOR_NAO_LIGADO')
    })

    test('REFRESH BEM-SUCEDIDO atualiza a capacidade', async () => {
      const antes = await lerAutorizacao({ workspaceId: wsB, canal: 'tiktok', env: SEM_APROVACAO })
      assert.equal(antes.estado, 'TOKEN_EXPIRADO')

      const r = await renovarAcessoDaConta({
        workspaceId: wsB, integracaoId, canal: 'tiktok',
        renovadores: { tiktok: renovadorFalso() }, env: SEM_APROVACAO,
      })
      assert.equal(r.ok, true, r.explicacao)
      assert.equal(r.depois!.estado, 'SCOPES_COMPROVADOS')
      assert.equal(r.depois!.expirado, false)
      assert.deepEqual(r.depois!.scopesComprovados, ['user.info.basic', 'video.upload', 'video.list'])
    })

    test('o token novo NÃO atravessa a orquestração', async () => {
      const r = await renovarAcessoDaConta({
        workspaceId: wsB, integracaoId, canal: 'tiktok',
        renovadores: { tiktok: renovadorFalso() }, env: SEM_APROVACAO,
      })
      // Já não está expirado depois do teste anterior: o importante é que
      // nenhum caminho carregue o segredo.
      const texto = JSON.stringify(r)
      assert.ok(!texto.includes(`TOKEN-NOVO-${marca}`))
      assert.ok(!texto.includes(`REFRESH-SECRETO-${marca}`))
    })

    test('renovar o que ainda vale não queima o refresh token', async () => {
      const chamadas: string[] = []
      const espiao: RenovadorDeAcesso = {
        canal: 'tiktok',
        renovar: async () => {
          chamadas.push('chamou')
          return { ok: true, expiraEm: AMANHA, scopes: null, erro: null }
        },
      }
      const r = await renovarAcessoDaConta({
        workspaceId: wsB, integracaoId, canal: 'tiktok',
        renovadores: { tiktok: espiao }, env: SEM_APROVACAO,
      })
      assert.equal(r.motivo, 'NAO_EXPIRADO')
      assert.equal(chamadas.length, 0, 'o renovador nem é chamado')
    })

    test('provider recusou: falha, e não fica esperando para sempre', async () => {
      await prisma.integracao.update({ where: { id: integracaoId }, data: { tokenExpiry: ONTEM } })
      const r = await renovarAcessoDaConta({
        workspaceId: wsB, integracaoId, canal: 'tiktok',
        renovadores: { tiktok: renovadorFalso({ ok: false }) }, env: SEM_APROVACAO,
      })
      assert.equal(r.ok, false)
      assert.equal(r.aguardar, false, 'recusa não é espera')
      assert.equal(r.erroFatal, true)
    })

    test('a ação do executor devolve resultado sem segredo', async () => {
      await prisma.integracao.update({ where: { id: integracaoId }, data: { tokenExpiry: ONTEM } })
      const acao = acaoDeRenovarToken({
        workspaceId: wsB, renovadores: { tiktok: renovadorFalso() }, env: SEM_APROVACAO,
      })
      const r = await acao({
        id: 'job-r', workspaceId: wsB, tipo: TIPO_JOB_RENOVAR_TOKEN, entityType: 'INTEGRACAO',
        entityId: integracaoId, tentativas: 0, contexto: { canal: 'tiktok' },
      } as unknown as LinhaDaFila)
      assert.equal(r.ok, true)
      const texto = JSON.stringify(r)
      assert.ok(!texto.includes(`TOKEN-NOVO-${marca}`))
      assert.ok(!texto.includes(`REFRESH-SECRETO-${marca}`))
      for (const proibido of ['accessToken', 'refreshToken', 'clientSecret']) {
        assert.ok(!texto.includes(proibido), `${proibido} não pode entrar no resultado do job`)
      }
    })

    test('job de renovação sem canal é FATAL, não retry', async () => {
      const acao = acaoDeRenovarToken({ workspaceId: wsB, env: SEM_APROVACAO })
      const r = await acao({
        id: 'job-s', workspaceId: wsB, tipo: TIPO_JOB_RENOVAR_TOKEN, entityType: 'INTEGRACAO',
        entityId: integracaoId, tentativas: 0, contexto: {},
      } as unknown as LinhaDaFila)
      assert.equal(r.erroFatal, true)
    })

    test('WORKSPACE ISOLADO: A não renova a integração de B', async () => {
      const chamadas: string[] = []
      const espiao: RenovadorDeAcesso = {
        canal: 'tiktok',
        renovar: async () => {
          chamadas.push('chamou')
          return { ok: true, expiraEm: AMANHA, scopes: null, erro: null }
        },
      }
      const r = await renovarAcessoDaConta({
        workspaceId: wsA, integracaoId, canal: 'tiktok',
        renovadores: { tiktok: espiao }, env: SEM_APROVACAO,
      })
      assert.equal(r.ok, false)
      assert.equal(chamadas.length, 0, 'nem chega ao renovador')
    })
  }
)
