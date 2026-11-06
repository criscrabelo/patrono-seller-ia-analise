/**
 * P1.0 Etapa 2.a — o link divulgado passa a ser o rastreado do Patrono.
 *
 * A prova central: publicar deixa de expor `Produto.linkProduto` e passa a
 * expor `/api/l/{slug}`, que registra `EventoLink` e termina no produto.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '../lib/prisma'
import {
  lerBasePublica,
  montarUrlRastreada,
  slugDaPublicacao,
  chaveDaTentativaPadrao,
  chaveDeTentativaDoConteudo,
  obterLinkRastreavelDaPublicacao,
  MOTIVOS_SEM_BASE_PUBLICA,
  MOTIVOS_SEM_LINK_RASTREAVEL,
} from '../lib/link-de-publicacao'
import { montarLegenda } from '../lib/instagram'

const TEM_BANCO = !!process.env.DATABASE_URL
const RAIZ = join(__dirname, '..')
const lerFonte = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')
const lerCodigo = (rel: string) =>
  lerFonte(rel)
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n')

const BASE_OK = { PUBLIC_BASE_URL: 'https://patrono.exemplo.com.br' }

// ── Base pública ────────────────────────────────────────────────────────

describe('URL pública — localhost nunca serve', () => {
  test('domínio real é aceito, sem barra final', () => {
    assert.deepEqual(lerBasePublica({ PUBLIC_BASE_URL: 'https://patrono.com.br/' }), {
      ok: true,
      baseUrl: 'https://patrono.com.br',
    })
  })

  test('sem configuração → fail-closed', () => {
    const r = lerBasePublica({})
    assert.equal(r.ok, false)
    assert.equal((r as { motivo: string }).motivo, 'NAO_CONFIGURADA')
  })

  for (const host of [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://0.0.0.0:3000',
    'https://meu-mac.local',
  ]) {
    test(`${host} é recusado — post nasceria quebrado`, () => {
      const r = lerBasePublica({ PUBLIC_BASE_URL: host })
      assert.equal(r.ok, false)
      assert.equal((r as { motivo: string }).motivo, 'HOST_NAO_PUBLICO')
    })
  }

  test('URL inválida ou protocolo estranho são recusados', () => {
    assert.equal((lerBasePublica({ PUBLIC_BASE_URL: 'nao-e-url' }) as { motivo: string }).motivo, 'URL_INVALIDA')
    assert.equal(
      (lerBasePublica({ PUBLIC_BASE_URL: 'ftp://patrono.com.br' }) as { motivo: string }).motivo,
      'PROTOCOLO_INVALIDO'
    )
  })

  test('NEXTAUTH_URL serve de segunda opção, com a MESMA validação', () => {
    assert.deepEqual(lerBasePublica({ NEXTAUTH_URL: 'https://app.patrono.com.br' }), {
      ok: true,
      baseUrl: 'https://app.patrono.com.br',
    })
    // Em desenvolvimento ela é localhost — e é recusada igual.
    assert.equal(lerBasePublica({ NEXTAUTH_URL: 'http://localhost:3000' }).ok, false)
  })

  test('PUBLIC_BASE_URL tem precedência', () => {
    const r = lerBasePublica({ PUBLIC_BASE_URL: 'https://a.com', NEXTAUTH_URL: 'https://b.com' })
    assert.equal((r as { baseUrl: string }).baseUrl, 'https://a.com')
  })

  test('todo motivo pertence à lista declarada', () => {
    for (const env of [{}, { PUBLIC_BASE_URL: 'x' }, { PUBLIC_BASE_URL: 'ftp://a.com' }, { PUBLIC_BASE_URL: 'http://localhost' }]) {
      const r = lerBasePublica(env)
      assert.equal(r.ok, false)
      assert.ok((MOTIVOS_SEM_BASE_PUBLICA as readonly string[]).includes((r as { motivo: string }).motivo))
    }
  })

  test('a URL rastreada aponta para o redirect do Patrono', () => {
    assert.equal(montarUrlRastreada('https://patrono.com.br', 'abc-123'), 'https://patrono.com.br/api/l/abc-123')
    assert.equal(montarUrlRastreada('https://patrono.com.br/', 'abc'), 'https://patrono.com.br/api/l/abc')
  })
})

// ── Slug determinístico ─────────────────────────────────────────────────

describe('Slug — idempotência sem coluna nova', () => {
  const base = { workspaceId: 'ws-a', contentId: 'cont-1', canal: 'instagram', nomeProduto: 'Carregador 20.000 mAh' }

  test('RETRY: mesma chave de tentativa → mesmo slug', () => {
    const a = slugDaPublicacao({ ...base, chaveDaTentativa: 't1' })
    const b = slugDaPublicacao({ ...base, chaveDaTentativa: 't1' })
    assert.equal(a, b)
  })

  test('REPUBLICAÇÃO: chave nova → slug diferente', () => {
    assert.notEqual(
      slugDaPublicacao({ ...base, chaveDaTentativa: 't1' }),
      slugDaPublicacao({ ...base, chaveDaTentativa: 't2' })
    )
  })

  test('outro workspace, outro conteúdo, outro canal → slugs diferentes', () => {
    const ref = slugDaPublicacao({ ...base, chaveDaTentativa: 't1' })
    assert.notEqual(ref, slugDaPublicacao({ ...base, workspaceId: 'ws-b', chaveDaTentativa: 't1' }))
    assert.notEqual(ref, slugDaPublicacao({ ...base, contentId: 'cont-2', chaveDaTentativa: 't1' }))
    assert.notEqual(ref, slugDaPublicacao({ ...base, canal: 'tiktok', chaveDaTentativa: 't1' }))
  })

  test('o sufixo é longo o bastante para resistir a colisão', () => {
    // O gerador antigo usava 3 dígitos aleatórios com slug @unique GLOBAL.
    const slug = slugDaPublicacao({ ...base, chaveDaTentativa: 't1' })
    const sufixo = slug.split('-').pop()!
    assert.equal(sufixo.length, 12)
    assert.match(slug, /^[a-z0-9-]+$/)
  })

  test('mil chaves distintas produzem mil slugs distintos', () => {
    const slugs = new Set(
      Array.from({ length: 1000 }, (_, i) => slugDaPublicacao({ ...base, chaveDaTentativa: `t${i}` }))
    )
    assert.equal(slugs.size, 1000)
  })

  test('produto sem nome ainda gera slug válido', () => {
    const slug = slugDaPublicacao({ ...base, nomeProduto: null, chaveDaTentativa: 't1' })
    assert.match(slug, /^produto-[a-z0-9]{12}$/)
  })

  test('a chave padrão é estável para retry do mesmo agendamento', () => {
    const quando = new Date('2026-09-25T12:00:00.000Z')
    const a = chaveDaTentativaPadrao({ contentId: 'c1', canal: 'instagram', dataAgendamento: quando })
    const b = chaveDaTentativaPadrao({ contentId: 'c1', canal: 'instagram', dataAgendamento: new Date(quando) })
    assert.equal(a, b)
    assert.notEqual(a, chaveDaTentativaPadrao({ contentId: 'c1', canal: 'tiktok', dataAgendamento: quando }))
  })
})

// ── As rotas de publicação ──────────────────────────────────────────────

describe('Publicação divulga o link RASTREADO, não o do produto', () => {
  const manual = lerCodigo('app/api/conteudos/[id]/publicar/route.ts')
  const cron = lerCodigo('app/api/cron/publicar/route.ts')
  // P2.2: as duas rotas registram o trabalho; quem monta a legenda e fala
  // com a Meta é o executor ÚNICO da publicação.
  const executor = lerCodigo('lib/trabalhos-longos/publicar-instagram.ts')

  test('nenhuma rota passa linkProduto direto para a legenda', () => {
    // Era exatamente isto: `montarLegenda(..., c.produto?.linkProduto)`.
    for (const codigo of [manual, cron, executor]) {
      assert.ok(!/montarLegenda\([^)]*linkProduto/.test(codigo))
    }
    // E nenhuma rota monta legenda por conta própria.
    assert.ok(!/montarLegenda\(/.test(manual) && !/montarLegenda\(/.test(cron))
  })

  test('as duas rotas obtêm o link rastreado antes de montar a legenda', () => {
    // A Etapa 2.c moveu a obtencao do link para dentro de
    // `prepararTentativaDePublicacao`, no fluxo. O invariante e o mesmo: a
    // URL tem de existir ANTES da legenda, senao o post sai sem ela.
    for (const [nome, codigo] of [['executor', executor]] as const) {
      assert.match(codigo, /prepararTentativaDePublicacao/, `${nome} precisa preparar a tentativa`)
      const posPreparo = codigo.indexOf('prepararTentativaDePublicacao({')
      const posLegenda = codigo.indexOf('montarLegenda(')
      assert.ok(posPreparo > 0 && posPreparo < posLegenda, `${nome} monta a legenda antes de preparar a tentativa`)
      assert.match(codigo, /tentativa\.urlParaDivulgar/, `${nome} usa a URL que o fluxo decidiu`)
    }
    for (const codigo of [manual, cron]) assert.match(codigo, /executorDaPublicacao\(\)/)
    // E o fluxo realmente obtem o link rastreado.
    const fluxo = lerCodigo('lib/publicacao-fluxo.ts')
    assert.match(fluxo, /obterLinkRastreavelDaPublicacao\({/)
  })

  test('a lacuna é registrada, nunca silenciosa', () => {
    // O registro tambem desceu para o fluxo — uma vez so, em vez de copiado
    // nas duas rotas.
    const fluxo = lerCodigo('lib/publicacao-fluxo.ts')
    assert.match(fluxo, /registrarLacunaDeRastreamento/)
    // E cada caminho continua expondo a lacuna a sua maneira. P2.2: a
    // resposta do "publicar agora" sai do executor; o cron lê o que o
    // executor gravou de cada trabalho.
    assert.match(executor, /rastreamento: respostaDeRastreamento\(tentativa\)/)
    assert.match(executor, /await e\.salvar\(\{ rastreada: tentativa\.rastreada \}\)/)
    assert.match(cron, /publicacoesSemRastreamento/)
    assert.match(cron, /if \(t\.contexto\?\.rastreada === false\) publicacoesSemRastreamento\+\+/)
  })

  test('a rota manual aceita chaveDaTentativa de quem chama', () => {
    // P1.9.2: a chave de quem chama é lida UMA vez, antes da porta, e a
    // mesma vai para o preflight e para a tentativa — é ela que fixa o link
    // que foi confirmado na bio.
    assert.match(manual, /typeof body\?\.chaveDaTentativa === 'string' \? body\.chaveDaTentativa\.trim\(\) : ''/)
    // P2.50 (D5): só a chave DESTE conteúdo e canal; outra é recusada antes da porta.
    assert.match(manual, /!chaveDeTentativaDoConteudo\(chaveDoCorpo, conteudo\.id\)/)
    assert.ok(manual.indexOf('CHAVE_DA_TENTATIVA_INVALIDA') < manual.indexOf('autorizarPublicacaoReal({'))
    assert.equal(chaveDeTentativaDoConteudo('c1:instagram:repub-2', 'c1'), true)
    assert.equal(chaveDeTentativaDoConteudo('c1:instagram:2026-10-25T10:00:00.000Z', 'c1'), true)
    assert.equal(chaveDeTentativaDoConteudo('c2:instagram:manual', 'c1'), false)
    assert.equal(chaveDeTentativaDoConteudo('c1:tiktok:manual', 'c1'), false)
    assert.equal(chaveDeTentativaDoConteudo('c1:instagram:', 'c1'), false)
    assert.equal(chaveDeTentativaDoConteudo('c1:instagram:a b', 'c1'), false)
    assert.equal(chaveDeTentativaDoConteudo('c1:instagram:' + 'x'.repeat(65), 'c1'), false)
    // P2.2: a mesma chave segue no pedido do trabalho e chega à tentativa.
    assert.match(manual, /pedido: \{ conteudoId: conteudo\.id, tipoMidia, destino, chaveDaTentativa, origem: 'manual' \}/)
    assert.match(executor, /prepararTentativaDePublicacao\(\{[\s\S]*?chaveDaTentativa: pedido\.chaveDaTentativa,/)
  })

  test('o destino NUNCA vem de quem chama', () => {
    const modulo = lerCodigo('lib/link-de-publicacao.ts')
    // urlDestino sai do Produto lido no servidor.
    assert.match(modulo, /const urlDestino = conteudo\.produto\?\.linkProduto/)
    assert.ok(!/params\.urlDestino|params\.destino/.test(modulo), 'aceitar destino abriria um redirecionador aberto')
  })

  test('nenhum provider pago é tocado — custo R$ 0,00', () => {
    const modulo = lerCodigo('lib/link-de-publicacao.ts')
    for (const pago of ['guardarChamadaPaga', 'falai', 'anthropic', 'resend', 'z-api', 'fetch(']) {
      assert.ok(!modulo.includes(pago), `${pago} não pode aparecer`)
    }
  })

  test('a Etapa 2.a nao passou a depender da tabela Publicacao', () => {
    // Nasceu como "Publicacao nao existe no schema". A Etapa 2.b criou a
    // tabela, entao a trava mudou de alvo: o link por slug precisa continuar
    // funcionando sozinho, senao publicacao antiga deixa de ter link no dia
    // da migration.
    const modulo = lerCodigo('lib/link-de-publicacao.ts')
    assert.ok(!/prisma\.publicacao/.test(modulo), 'o link e criado sem depender da tabela')
    assert.match(modulo, /sufixoDoSlugDaPublicacao/, 'a derivacao por slug continua de pe')
  })
})

// ── Banco ───────────────────────────────────────────────────────────────

let workspaceA = ''
let workspaceB = ''
let userA = ''
let userB = ''
let produtoA = ''
let conteudoA = ''
let conteudoSemUrl = ''
let conteudoB = ''
const criados: string[] = []

const URL_DESTINO = 'https://loja.exemplo.invalido/produto/123?ref=afiliado'

describe(
  'Etapa 2.a no banco — link criado sob demanda e reusado',
  { skip: !TEM_BANCO ? 'DATABASE_URL ausente — exige Postgres' : false },
  () => {
    before(async () => {
      const marca = Date.now()
      for (const nome of ['A', 'B']) {
        const ws = await prisma.workspace.create({
          data: { name: `E2A-${nome}`, ownerId: `teste-e2a-${nome}-${marca}` },
          select: { id: true },
        })
        criados.push(ws.id)
      }
      ;[workspaceA, workspaceB] = criados

      const criarUser = async (ws: string, s: string) =>
        (
          await prisma.user.create({
            data: { email: `e2a-${s}-${marca}@teste.local`, name: `U${s}`, password: 'x', workspaceId: ws },
            select: { id: true },
          })
        ).id
      userA = await criarUser(workspaceA, 'a')
      userB = await criarUser(workspaceB, 'b')

      const criarProduto = async (ws: string, uid: string, link: string | null) =>
        (
          await prisma.produto.create({
            data: {
              workspaceId: ws,
              userId: uid,
              nome: 'Carregador portátil',
              categoria: 'eletronicos',
              tipoVenda: 'Afiliado',
              origemConteudo: 'Proprio',
              linkProduto: link,
            },
            select: { id: true },
          })
        ).id
      produtoA = await criarProduto(workspaceA, userA, URL_DESTINO)
      const produtoSemUrl = await criarProduto(workspaceA, userA, null)
      const produtoB = await criarProduto(workspaceB, userB, URL_DESTINO)

      const criarConteudo = async (ws: string, uid: string, pid: string) =>
        (
          await prisma.conteudo.create({
            data: {
              workspaceId: ws,
              userId: uid,
              produtoId: pid,
              roteiro: 'x',
              chamadaAcao: 'Link na bio',
              redeSocial: 'instagram',
            },
            select: { id: true },
          })
        ).id
      conteudoA = await criarConteudo(workspaceA, userA, produtoA)
      conteudoSemUrl = await criarConteudo(workspaceA, userA, produtoSemUrl)
      conteudoB = await criarConteudo(workspaceB, userB, produtoB)
    })

    after(async () => {
      for (const ws of criados) {
        await prisma.eventoLink.deleteMany({ where: { workspaceId: ws } })
        await prisma.linkDinamico.deleteMany({ where: { workspaceId: ws } })
        await prisma.conteudo.deleteMany({ where: { workspaceId: ws } })
        await prisma.produto.deleteMany({ where: { workspaceId: ws } })
        await prisma.user.deleteMany({ where: { workspaceId: ws } })
      }
      await prisma.workspace.deleteMany({ where: { id: { in: criados } } })
      await prisma.$disconnect()
    })

    const obter = (over: Record<string, unknown> = {}) =>
      obterLinkRastreavelDaPublicacao({
        workspaceId: workspaceA,
        contentId: conteudoA,
        canal: 'instagram',
        env: BASE_OK,
        ...over,
      })

    test('a publicação recebe /api/l/{slug}, nunca o link do produto', async () => {
      const r = await obter({ chaveDaTentativa: 'pub-1' })
      assert.equal(r.ok, true, r.explicacao)
      assert.match(r.urlPublica!, /^https:\/\/patrono\.exemplo\.com\.br\/api\/l\//)
      assert.notEqual(r.urlPublica, URL_DESTINO)

      // E a legenda sai com ele.
      const legenda = montarLegenda('Olha isso', ['#oferta'], 'Link na bio', r.urlPublica)
      assert.ok(legenda.includes(r.urlPublica!))
      assert.ok(!legenda.includes(URL_DESTINO))
    })

    test('o link criado aponta para o destino do produto do MESMO workspace', async () => {
      const r = await obter({ chaveDaTentativa: 'pub-destino' })
      const link = await prisma.linkDinamico.findUnique({
        where: { id: r.linkId! },
        select: { urlDestino: true, workspaceId: true, produtoId: true },
      })
      assert.equal(link?.urlDestino, URL_DESTINO)
      assert.equal(link?.workspaceId, workspaceA)
      assert.equal(link?.produtoId, produtoA)
    })

    test('clicar na URL rastreada cria EventoLink e o redirect termina no produto', async () => {
      const r = await obter({ chaveDaTentativa: 'pub-clique' })
      const { GET } = await import('../app/api/l/[slug]/route')
      // P2.50: clique de compradora = navegador real (sem user-agent é robô e não conta).
      const req = new Request(r.urlPublica!, { headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' } }) as never

      const resposta = await GET(req, { params: Promise.resolve({ slug: r.slug! }) })
      assert.equal(resposta.status, 307, 'redirect')
      assert.equal(resposta.headers.get('location'), URL_DESTINO, 'termina no Produto.linkProduto')

      const eventos = await prisma.eventoLink.findMany({
        where: { workspaceId: workspaceA, linkId: r.linkId!, tipo: 'clique' },
      })
      assert.equal(eventos.length, 1, 'o clique foi registrado')
      assert.equal(eventos[0].workspaceId, workspaceA)
    })

    test('RETRY da mesma tentativa reusa o MESMO link', async () => {
      const antes = await prisma.linkDinamico.count({ where: { workspaceId: workspaceA } })
      const a = await obter({ chaveDaTentativa: 'pub-retry' })
      const b = await obter({ chaveDaTentativa: 'pub-retry' })
      const c = await obter({ chaveDaTentativa: 'pub-retry' })

      assert.equal(a.reutilizado, false)
      assert.equal(b.reutilizado, true)
      assert.equal(c.reutilizado, true)
      assert.equal(a.linkId, b.linkId)
      assert.equal(b.linkId, c.linkId)
      assert.equal(await prisma.linkDinamico.count({ where: { workspaceId: workspaceA } }), antes + 1)
    })

    test('REPUBLICAÇÃO com chave nova gera OUTRO link', async () => {
      const a = await obter({ chaveDaTentativa: 'pub-hoje' })
      const b = await obter({ chaveDaTentativa: 'pub-daqui-15-dias' })
      assert.notEqual(a.linkId, b.linkId)
      assert.notEqual(a.slug, b.slug)
      // Os dois apontam para o mesmo destino — o produto não mudou.
      assert.equal(a.urlDestino, b.urlDestino)
    })

    test('OUTRO workspace nunca reusa o link', async () => {
      const a = await obter({ chaveDaTentativa: 'mesma-chave' })
      const b = await obterLinkRastreavelDaPublicacao({
        workspaceId: workspaceB,
        contentId: conteudoB,
        canal: 'instagram',
        chaveDaTentativa: 'mesma-chave',
        env: BASE_OK,
      })
      assert.equal(b.ok, true, b.explicacao)
      assert.notEqual(a.linkId, b.linkId)
      assert.notEqual(a.slug, b.slug)

      const link = await prisma.linkDinamico.findUnique({ where: { id: b.linkId! }, select: { workspaceId: true } })
      assert.equal(link?.workspaceId, workspaceB)
    })

    test('conteúdo de outro workspace não gera link', async () => {
      const r = await obterLinkRastreavelDaPublicacao({
        workspaceId: workspaceA,
        contentId: conteudoB,
        canal: 'instagram',
        env: BASE_OK,
      })
      assert.equal(r.ok, false)
      assert.equal(r.motivo, 'CONTEUDO_NAO_ENCONTRADO')
    })

    test('SEM PUBLIC_BASE_URL a publicação rastreável é bloqueada', async () => {
      const antes = await prisma.linkDinamico.count({ where: { workspaceId: workspaceA } })
      const r = await obterLinkRastreavelDaPublicacao({
        workspaceId: workspaceA,
        contentId: conteudoA,
        canal: 'instagram',
        chaveDaTentativa: 'sem-base',
        env: {},
      })
      assert.equal(r.ok, false)
      assert.equal(r.motivo, 'SEM_BASE_PUBLICA')
      assert.equal(r.urlPublica, null, 'nenhum link quebrado é devolvido')
      // Nenhum link é criado à toa.
      assert.equal(await prisma.linkDinamico.count({ where: { workspaceId: workspaceA } }), antes)
      // O destino viaja para quem quiser decidir o fallback — nunca em silêncio.
      assert.equal(r.urlDestino, URL_DESTINO)
    })

    test('localhost também bloqueia', async () => {
      const r = await obterLinkRastreavelDaPublicacao({
        workspaceId: workspaceA,
        contentId: conteudoA,
        canal: 'instagram',
        chaveDaTentativa: 'localhost',
        env: { PUBLIC_BASE_URL: 'http://localhost:3000' },
      })
      assert.equal(r.ok, false)
      assert.equal(r.motivo, 'SEM_BASE_PUBLICA')
    })

    test('produto sem URL de destino não vira link para lugar nenhum', async () => {
      const r = await obterLinkRastreavelDaPublicacao({
        workspaceId: workspaceA,
        contentId: conteudoSemUrl,
        canal: 'instagram',
        env: BASE_OK,
      })
      assert.equal(r.ok, false)
      assert.equal(r.motivo, 'PRODUTO_SEM_URL_DE_DESTINO')
      assert.equal(r.urlPublica, null)
    })

    test('NÃO cria 18 links por produto — um por tentativa', async () => {
      const ws = workspaceA
      const antes = await prisma.linkDinamico.count({ where: { workspaceId: ws } })
      await obter({ chaveDaTentativa: 'sob-demanda-1' })
      assert.equal(await prisma.linkDinamico.count({ where: { workspaceId: ws } }), antes + 1)
    })

    test('todo motivo pertence à lista declarada', async () => {
      const casos = [
        await obterLinkRastreavelDaPublicacao({ workspaceId: workspaceA, contentId: 'x', canal: 'instagram', env: BASE_OK }),
        await obterLinkRastreavelDaPublicacao({ workspaceId: workspaceA, contentId: conteudoSemUrl, canal: 'instagram', env: BASE_OK }),
        await obterLinkRastreavelDaPublicacao({ workspaceId: workspaceA, contentId: conteudoA, canal: 'instagram', env: {} }),
      ]
      for (const c of casos) {
        assert.equal(c.ok, false)
        assert.ok((MOTIVOS_SEM_LINK_RASTREAVEL as readonly string[]).includes(c.motivo!))
        assert.ok(c.explicacao.length > 0)
      }
    })
  }
)
