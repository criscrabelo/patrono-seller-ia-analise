/**
 * P1.0 Etapa 2.b — o invariante que o banco NÃO garante.
 *
 * As FKs compostas garantem workspace. Não garantem produto. Dentro de um
 * mesmo workspace o banco aceitaria:
 *
 *   Conteudo(produto A) → Publicacao → LinkDinamico(produto B)
 *
 * O post falaria do produto A e o clique levaria ao B. Estes testes provam
 * que o código recusa, com linhas reais no banco de teste.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Todos os .ts/.tsx sob um diretório, recursivamente. */
function varrer(dir: string): string[] {
  const saida: string[] = []
  for (const nome of readdirSync(dir)) {
    const abs = join(dir, nome)
    if (statSync(abs).isDirectory()) saida.push(...varrer(abs))
    else if (/[.]tsx?$/.test(nome)) saida.push(abs)
  }
  return saida
}
import { prisma } from '../lib/prisma'
import {
  avaliarVinculoDeLinkComPublicacao,
  MOTIVOS_VINCULO_INVALIDO,
  VINCULO_EXIGE_AVALIACAO,
} from '../lib/vinculo-publicacao-link'
import {
  normalizarPublicacaoExternaId,
  chaveExternaDaPublicacao,
  validarPublicacao,
} from '../lib/publicacao-contrato'

const TEM_BANCO = !!process.env.DATABASE_URL
const RAIZ = join(__dirname, '..')
const lerCodigo = (rel: string) =>
  readFileSync(join(RAIZ, rel), 'utf8')
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n')

// ── publicacaoExternaId vazio ───────────────────────────────────────────

describe("publicacaoExternaId = '' nunca é id externo", () => {
  test('vazio e espaço viram null', () => {
    for (const v of ['', '   ', '\t', '\n  \n']) {
      assert.equal(normalizarPublicacaoExternaId(v), null, `${JSON.stringify(v)} deveria virar null`)
    }
  })

  test('não-string vira null, nunca "undefined" nem "[object Object]"', () => {
    for (const v of [null, undefined, 0, 123, {}, [], NaN, false]) {
      assert.equal(normalizarPublicacaoExternaId(v), null)
    }
  })

  test('id de verdade sobrevive, aparado', () => {
    assert.equal(normalizarPublicacaoExternaId('  ig_17900000000  '), 'ig_17900000000')
    assert.equal(normalizarPublicacaoExternaId('ig_17900000000'), 'ig_17900000000')
  })

  test('a chave externa também recusa vazio — as duas leituras concordam', () => {
    // É este acordo que importa: se o código dissesse "não há id" e o banco
    // tratasse '' como identidade, duas publicações sem id colidiriam.
    for (const v of ['', '   ', null, undefined]) {
      assert.equal(
        chaveExternaDaPublicacao({ workspaceId: 'ws', provider: 'META', publicacaoExternaId: v }),
        null
      )
    }
    assert.equal(
      chaveExternaDaPublicacao({ workspaceId: 'ws', provider: 'META', publicacaoExternaId: ' abc ' }),
      'ws|META|abc'
    )
  })

  test('a normalização é a única porta — a chave externa usa a mesma função', () => {
    const contrato = lerCodigo('lib/publicacao-contrato.ts')
    assert.match(
      contrato,
      /const id = normalizarPublicacaoExternaId\(p\?\.publicacaoExternaId\)/,
      'chaveExternaDaPublicacao precisa delegar, não reimplementar o trim'
    )
  })
})

// ── O contrato sozinho é fail-open; o guard não ─────────────────────────

describe('Por que o guard existe além do contrato', () => {
  const publicacao = {
    workspaceId: 'ws-1',
    contentId: 'cont-1',
    destino: { provider: 'META', canal: 'instagram' },
    chaveDaTentativa: 't1',
    estado: 'PREPARADA' as const,
    linkId: 'link-1',
    dataOrigin: 'UNVERIFIED',
    criadaEm: new Date(),
  }

  test('o contrato RECUSA quando recebe os dois produtos', () => {
    const r = validarPublicacao(publicacao, {
      conteudoWorkspaceId: 'ws-1',
      linkWorkspaceId: 'ws-1',
      conteudoProdutoId: 'produto-A',
      linkProdutoId: 'produto-B',
    })
    assert.equal(r.ok, false)
    assert.equal((r as { motivo: string }).motivo, 'LINK_DE_OUTRO_PRODUTO')
  })

  test('mas ACEITA se quem chama esquecer de passar os produtos', () => {
    // Este é o fail-open que motiva o módulo de vínculo: a regra existe e
    // depende de alguém lembrar de alimentá-la.
    const r = validarPublicacao(publicacao, { conteudoWorkspaceId: 'ws-1', linkWorkspaceId: 'ws-1' })
    assert.equal(r.ok, true)
  })

  test('o guard não tem parâmetro de produto para esquecer', () => {
    const modulo = lerCodigo('lib/vinculo-publicacao-link.ts')
    assert.ok(!/produtoId\?:/.test(modulo), 'nenhum produtoId entra por parâmetro')
    assert.match(modulo, /prisma\.conteudo\.findFirst/, 'o produto do conteúdo vem do servidor')
    assert.match(modulo, /prisma\.linkDinamico\.findFirst/, 'o produto do link vem do servidor')
    assert.match(modulo, /link\.produtoId !== conteudo\.produtoId/, 'e são comparados sem condição')
  })

  test('a regra permanente está declarada', () => {
    assert.equal(VINCULO_EXIGE_AVALIACAO.funcaoObrigatoria, 'avaliarVinculoDeLinkComPublicacao')
    assert.equal(VINCULO_EXIGE_AVALIACAO.colunaProtegida, 'LinkDinamico.publicacaoId')
  })

  test('TODO módulo que grava publicacaoId passa pelo guard', () => {
    // Varredura ampla de propósito: `lib/` e as rotas inteiras, não uma
    // lista que alguém esqueceria de atualizar ao criar arquivo novo.
    //
    // O padrão procurado é a ESCRITA via Prisma da COLUNA `publicacaoId`
    // dentro de um `data: { … }`. O `[^.\w]` antes do nome importa:
    // `entityId: base.publicacaoId` grava OUTRA coluna a partir de uma
    // variável homônima, e sem isso acusaria falso positivo.
    const arquivos = [
      ...varrer(join(RAIZ, 'lib')),
      ...varrer(join(RAIZ, 'app')),
    ]
    const escrevem: string[] = []
    for (const abs of arquivos) {
      const semComentario = readFileSync(abs, 'utf8')
        .split(/\r?\n/)
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n')
      // P2.17.10: `PublicacaoAssistida.publicacaoId` é OUTRA tabela (referência
      // à publicação da porta única), não o vínculo LinkDinamico ↔ Publicacao.
      const semAssistida = semComentario.replace(/publicacaoAssistida\.(update|create|updateMany|upsert)\(\{[\s\S]*?\n\s*\}\)/g, '')
      if (/data:\s*\{[^}]*[^.\w]publicacaoId\s*[:,}]/.test(semAssistida)) {
        const rel = abs.slice(RAIZ.length + 1).split('\\').join('/')
        escrevem.push(rel)
        assert.match(
          semComentario,
          /avaliarVinculoDeLinkComPublicacao/,
          `${rel} grava publicacaoId sem passar pelo guard`
        )
      }
    }
    // Uma porta so. Se aparecer outra, ela precisa do guard — e este teste
    // obriga a decisao a ser consciente.
    assert.deepEqual(escrevem, ['lib/publicacao-repositorio.ts'])
  })
})

// ── Banco: produto A vs produto B ───────────────────────────────────────

let workspaceA = ''
let workspaceB = ''
let produtoA = ''
let produtoB = ''
let conteudoDoProdutoA = ''
let linkDoProdutoA = ''
let linkDoProdutoB = ''
let conteudoDoWorkspaceB = ''
let linkDoWorkspaceB = ''
const criados: string[] = []

describe(
  'Vínculo no banco — mesmo workspace, produtos diferentes',
  { skip: !TEM_BANCO ? 'DATABASE_URL ausente — exige Postgres' : false },
  () => {
    before(async () => {
      const marca = Date.now()
      for (const nome of ['A', 'B']) {
        const ws = await prisma.workspace.create({
          data: { name: `R30-${nome}`, ownerId: `teste-r30-${nome}-${marca}` },
          select: { id: true },
        })
        criados.push(ws.id)
      }
      ;[workspaceA, workspaceB] = criados

      const criarUser = async (ws: string, s: string) =>
        (
          await prisma.user.create({
            data: { email: `r30-${s}-${marca}@teste.local`, name: `U${s}`, password: 'x', workspaceId: ws },
            select: { id: true },
          })
        ).id
      const userA = await criarUser(workspaceA, 'a')
      const userB = await criarUser(workspaceB, 'b')

      const criarProduto = async (ws: string, uid: string, nome: string) =>
        (
          await prisma.produto.create({
            data: {
              workspaceId: ws,
              userId: uid,
              nome,
              categoria: 'eletronicos',
              tipoVenda: 'Afiliado',
              origemConteudo: 'Proprio',
              linkProduto: `https://loja.exemplo.invalido/${nome}`,
            },
            select: { id: true },
          })
        ).id

      // Os DOIS produtos no MESMO workspace — é esse o caso que o banco
      // sozinho aceitaria.
      produtoA = await criarProduto(workspaceA, userA, 'fone-a')
      produtoB = await criarProduto(workspaceA, userA, 'carregador-b')
      const produtoOutroWs = await criarProduto(workspaceB, userB, 'fone-b')

      const criarConteudo = async (ws: string, uid: string, pid: string) =>
        (
          await prisma.conteudo.create({
            data: { workspaceId: ws, userId: uid, produtoId: pid, roteiro: 'x', redeSocial: 'instagram' },
            select: { id: true },
          })
        ).id
      conteudoDoProdutoA = await criarConteudo(workspaceA, userA, produtoA)
      conteudoDoWorkspaceB = await criarConteudo(workspaceB, userB, produtoOutroWs)

      const criarLink = async (ws: string, uid: string, pid: string, slug: string) =>
        (
          await prisma.linkDinamico.create({
            data: {
              workspaceId: ws,
              userId: uid,
              produtoId: pid,
              slug: `${slug}-${marca}`,
              plataforma: 'instagram',
              urlDestino: 'https://loja.exemplo.invalido/destino',
            },
            select: { id: true },
          })
        ).id
      linkDoProdutoA = await criarLink(workspaceA, userA, produtoA, 'r30-link-a')
      linkDoProdutoB = await criarLink(workspaceA, userA, produtoB, 'r30-link-b')
      linkDoWorkspaceB = await criarLink(workspaceB, userB, produtoOutroWs, 'r30-link-ws-b')
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

    test('RECUSA: publicação do produto A com link do produto B', async () => {
      // O caso exato: mesmo workspace, produtos diferentes. O banco
      // aceitaria; o código não.
      const r = await avaliarVinculoDeLinkComPublicacao({
        workspaceId: workspaceA,
        contentId: conteudoDoProdutoA,
        linkId: linkDoProdutoB,
      })
      assert.equal(r.ok, false)
      assert.equal(r.motivo, 'LINK_DE_OUTRO_PRODUTO')
      assert.equal(r.produtoId, null)
      assert.match(r.explicacao, /produto diferente/i)
    })

    test('ACEITA: mesmo produto, mesmo workspace', async () => {
      const r = await avaliarVinculoDeLinkComPublicacao({
        workspaceId: workspaceA,
        contentId: conteudoDoProdutoA,
        linkId: linkDoProdutoA,
      })
      assert.equal(r.ok, true, r.explicacao)
      assert.equal(r.motivo, null)
      assert.equal(r.produtoId, produtoA, 'devolve o produto que os dois compartilham')
    })

    test('o produto devolvido é o do CONTEÚDO, não o que alguém alegou', async () => {
      const r = await avaliarVinculoDeLinkComPublicacao({
        workspaceId: workspaceA,
        contentId: conteudoDoProdutoA,
        linkId: linkDoProdutoA,
      })
      const conteudo = await prisma.conteudo.findUniqueOrThrow({
        where: { id: conteudoDoProdutoA },
        select: { produtoId: true },
      })
      assert.equal(r.produtoId, conteudo.produtoId)
    })

    test('RECUSA: link de outro workspace, mesmo com produto de nome igual', async () => {
      const r = await avaliarVinculoDeLinkComPublicacao({
        workspaceId: workspaceA,
        contentId: conteudoDoProdutoA,
        linkId: linkDoWorkspaceB,
      })
      assert.equal(r.ok, false)
      assert.equal(r.motivo, 'LINK_NAO_ENCONTRADO')
    })

    test('RECUSA: conteúdo de outro workspace', async () => {
      const r = await avaliarVinculoDeLinkComPublicacao({
        workspaceId: workspaceA,
        contentId: conteudoDoWorkspaceB,
        linkId: linkDoProdutoA,
      })
      assert.equal(r.ok, false)
      assert.equal(r.motivo, 'CONTEUDO_NAO_ENCONTRADO')
    })

    test('RECUSA: parâmetro faltando nunca "passa por omissão"', async () => {
      const casos = [
        { workspaceId: '', contentId: conteudoDoProdutoA, linkId: linkDoProdutoA },
        { workspaceId: workspaceA, contentId: '', linkId: linkDoProdutoA },
        { workspaceId: workspaceA, contentId: conteudoDoProdutoA, linkId: '  ' },
      ]
      for (const c of casos) {
        const r = await avaliarVinculoDeLinkComPublicacao(c)
        assert.equal(r.ok, false)
        assert.equal(r.motivo, 'PARAMETROS_INCOMPLETOS')
      }
    })

    test('RETRY: link já vinculado à MESMA publicação é aceito', async () => {
      const r = await avaliarVinculoDeLinkComPublicacao({
        workspaceId: workspaceA,
        contentId: conteudoDoProdutoA,
        linkId: linkDoProdutoA,
        publicacaoId: 'pub-1',
        publicacaoIdAtualDoLink: 'pub-1',
      })
      assert.equal(r.ok, true, r.explicacao)
      assert.match(r.explicacao, /retry/i)
    })

    test('RECUSA: link já vinculado a OUTRA publicação', async () => {
      const r = await avaliarVinculoDeLinkComPublicacao({
        workspaceId: workspaceA,
        contentId: conteudoDoProdutoA,
        linkId: linkDoProdutoA,
        publicacaoId: 'pub-2',
        publicacaoIdAtualDoLink: 'pub-1',
      })
      assert.equal(r.ok, false)
      assert.equal(r.motivo, 'LINK_JA_VINCULADO')
    })

    test('o produto vem antes da cardinalidade — produto errado recusa mesmo em retry', async () => {
      const r = await avaliarVinculoDeLinkComPublicacao({
        workspaceId: workspaceA,
        contentId: conteudoDoProdutoA,
        linkId: linkDoProdutoB,
        publicacaoId: 'pub-1',
        publicacaoIdAtualDoLink: 'pub-1',
      })
      assert.equal(r.motivo, 'LINK_DE_OUTRO_PRODUTO')
    })

    test('todo motivo pertence à lista declarada', async () => {
      const casos = [
        await avaliarVinculoDeLinkComPublicacao({ workspaceId: workspaceA, contentId: conteudoDoProdutoA, linkId: linkDoProdutoB }),
        await avaliarVinculoDeLinkComPublicacao({ workspaceId: workspaceA, contentId: 'x', linkId: linkDoProdutoA }),
        await avaliarVinculoDeLinkComPublicacao({ workspaceId: workspaceA, contentId: conteudoDoProdutoA, linkId: 'x' }),
        await avaliarVinculoDeLinkComPublicacao({ workspaceId: '', contentId: '', linkId: '' }),
      ]
      for (const c of casos) {
        assert.equal(c.ok, false)
        assert.ok((MOTIVOS_VINCULO_INVALIDO as readonly string[]).includes(c.motivo!))
        assert.ok(c.explicacao.length > 0)
      }
    })

    test('o link da publicação continua nascendo com o produto do conteúdo', async () => {
      // A outra metade da garantia: o caminho de CRIAÇÃO não deixa o
      // produto divergir, porque nem pergunta qual é.
      const { obterLinkRastreavelDaPublicacao } = await import('../lib/link-de-publicacao')
      const r = await obterLinkRastreavelDaPublicacao({
        workspaceId: workspaceA,
        contentId: conteudoDoProdutoA,
        canal: 'instagram',
        chaveDaTentativa: 'r30-criacao',
        env: { PUBLIC_BASE_URL: 'https://patrono.exemplo.com.br' },
      })
      assert.equal(r.ok, true, r.explicacao)

      const link = await prisma.linkDinamico.findUniqueOrThrow({
        where: { id: r.linkId! },
        select: { produtoId: true },
      })
      assert.equal(link.produtoId, produtoA)
      assert.notEqual(link.produtoId, produtoB)

      // E o guard aprova o que esse caminho criou.
      const v = await avaliarVinculoDeLinkComPublicacao({
        workspaceId: workspaceA,
        contentId: conteudoDoProdutoA,
        linkId: r.linkId!,
      })
      assert.equal(v.ok, true, v.explicacao)
    })
  }
)
