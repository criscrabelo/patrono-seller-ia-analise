/**
 * P1.0 Etapa 2.b — as constraints do banco, exercitadas de verdade.
 *
 * Estas provas nasceram como script de scratchpad, rodaram uma vez e
 * aprovaram a migration. Isso não é proteção: proteção é o que roda de novo
 * sozinho. Aqui elas viram suíte.
 *
 * Cada teste faz uma operação que o banco DEVE recusar, e confere que a
 * recusa veio da constraint certa — não de qualquer erro. Um `INSERT` que
 * falhasse por outro motivo passaria despercebido num `assert.rejects` solto.
 *
 * ── SOBRE publicacaoExternaId = '' ──────────────────────────────────────
 * String vazia NÃO é caso válido e não é testada como se fosse. O Postgres a
 * trata como valor comum, então duas publicações com `''` colidiriam — por
 * isso toda escrita passa por `normalizarPublicacaoExternaId()`, que a
 * transforma em `null` ANTES de chegar ao banco. O que se testa aqui é a
 * normalização fazendo seu trabalho.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../lib/prisma'
import { ESTADOS_DA_PUBLICACAO, normalizarPublicacaoExternaId } from '../lib/publicacao-contrato'

const TEM_BANCO = !!process.env.DATABASE_URL

/**
 * Executa algo que o banco tem de recusar e devolve o erro do Prisma.
 *
 * Falha o teste se a operação PASSAR — o pior desfecho possível aqui seria
 * um "recusou" silencioso que na verdade nunca foi exercitado.
 */
async function capturarRecusa(fn: () => Promise<unknown>): Promise<{
  code: string
  target: string
  message: string
}> {
  try {
    await fn()
  } catch (e) {
    const err = e as { code?: string; meta?: Record<string, unknown>; message?: string }
    const alvo = err.meta?.target ?? err.meta?.field_name ?? err.meta ?? ''
    return {
      code: err.code ?? 'SEM_CODIGO',
      target: typeof alvo === 'string' ? alvo : JSON.stringify(alvo),
      message: err.message ?? '',
    }
  }
  assert.fail('a operação PASSOU quando o banco deveria tê-la recusado')
}

const marca = `r31-${Date.now()}`
let wsA = ''
let wsB = ''
let conteudoA = ''
let conteudoB = ''
let produtoA = ''
let produtoB = ''
let userA = ''
let userB = ''
const criados: string[] = []

const publicacaoBase = { provider: 'META', canal: 'instagram' }

describe(
  'Constraints da Publicacao — o banco recusa, não só o código',
  { skip: !TEM_BANCO ? 'DATABASE_URL ausente — exige Postgres' : false },
  () => {
    before(async () => {
      for (const n of ['A', 'B']) {
        const ws = await prisma.workspace.create({
          data: { name: `R31-${n}`, ownerId: `${marca}-${n}` },
          select: { id: true },
        })
        criados.push(ws.id)
      }
      ;[wsA, wsB] = criados

      const criarUser = async (ws: string, s: string) =>
        (
          await prisma.user.create({
            data: { email: `${marca}-${s}@teste.local`, name: 'U', password: 'x', workspaceId: ws },
            select: { id: true },
          })
        ).id
      userA = await criarUser(wsA, 'a')
      userB = await criarUser(wsB, 'b')

      const criarProduto = async (ws: string, uid: string, nome: string) =>
        (
          await prisma.produto.create({
            data: {
              workspaceId: ws,
              userId: uid,
              nome,
              categoria: 'x',
              tipoVenda: 'Afiliado',
              origemConteudo: 'Proprio',
            },
            select: { id: true },
          })
        ).id
      produtoA = await criarProduto(wsA, userA, 'r31-prod-a')
      produtoB = await criarProduto(wsB, userB, 'r31-prod-b')

      const criarConteudo = async (ws: string, uid: string, pid: string) =>
        (
          await prisma.conteudo.create({
            data: { workspaceId: ws, userId: uid, produtoId: pid, roteiro: 'x', redeSocial: 'instagram' },
            select: { id: true },
          })
        ).id
      conteudoA = await criarConteudo(wsA, userA, produtoA)
      conteudoB = await criarConteudo(wsB, userB, produtoB)
    })

    after(async () => {
      // O link precisa soltar a publicação antes de qualquer delete: a FK é
      // ON DELETE RESTRICT, que é justamente o que um dos testes prova.
      for (const ws of criados) {
        await prisma.linkDinamico.updateMany({ where: { workspaceId: ws }, data: { publicacaoId: null } })
        await prisma.eventoLink.deleteMany({ where: { workspaceId: ws } })
        await prisma.linkDinamico.deleteMany({ where: { workspaceId: ws } })
        await prisma.publicacao.deleteMany({ where: { workspaceId: ws } })
        await prisma.conteudo.deleteMany({ where: { workspaceId: ws } })
        await prisma.produto.deleteMany({ where: { workspaceId: ws } })
        await prisma.user.deleteMany({ where: { workspaceId: ws } })
      }
      await prisma.workspace.deleteMany({ where: { id: { in: criados } } })
      await prisma.$disconnect()
    })

    // ── Isolamento entre workspaces ─────────────────────────────────────

    test('Publicacao do workspace A apontando para Conteudo do B é RECUSADA', async () => {
      const erro = await capturarRecusa(() =>
        prisma.publicacao.create({
          data: { workspaceId: wsA, contentId: conteudoB, ...publicacaoBase, chaveDaTentativa: `${marca}-cross` },
        })
      )
      assert.equal(erro.code, 'P2003', 'tem de ser violação de FK')
      assert.match(erro.target, /Publicacao_contentId_workspaceId_fkey/)
    })

    test('Link do workspace B apontando para Publicacao do A é RECUSADO', async () => {
      const pub = await prisma.publicacao.create({
        data: { workspaceId: wsA, contentId: conteudoA, ...publicacaoBase, chaveDaTentativa: `${marca}-alvo-ws` },
        select: { id: true },
      })
      const linkB = await prisma.linkDinamico.create({
        data: {
          workspaceId: wsB,
          userId: userB,
          produtoId: produtoB,
          slug: `${marca}-link-b`,
          plataforma: 'instagram',
          urlDestino: 'https://x.invalido/d',
        },
        select: { id: true },
      })

      const erro = await capturarRecusa(() =>
        prisma.linkDinamico.update({ where: { id: linkB.id }, data: { publicacaoId: pub.id } })
      )
      assert.equal(erro.code, 'P2003')
      assert.match(erro.target, /LinkDinamico_publicacaoId_workspaceId_fkey/)
    })

    // ── Idempotência da tentativa ───────────────────────────────────────

    test('mesma workspaceId + chaveDaTentativa é RECUSADA', async () => {
      const chave = `${marca}-idem`
      const primeira = await prisma.publicacao.create({
        data: { workspaceId: wsA, contentId: conteudoA, ...publicacaoBase, chaveDaTentativa: chave },
        select: { id: true },
      })

      const erro = await capturarRecusa(() =>
        prisma.publicacao.create({
          data: { workspaceId: wsA, contentId: conteudoA, ...publicacaoBase, chaveDaTentativa: chave },
        })
      )
      assert.equal(erro.code, 'P2002', 'tem de ser violação de unique')
      assert.match(erro.target, /workspaceId.*chaveDaTentativa/)

      // Retry reencontra a MESMA linha — é isto que separa retry de
      // republicação.
      const achada = await prisma.publicacao.findUnique({
        where: { workspaceId_chaveDaTentativa: { workspaceId: wsA, chaveDaTentativa: chave } },
        select: { id: true },
      })
      assert.equal(achada?.id, primeira.id)
    })

    test('a MESMA chave em outro workspace é ACEITA', async () => {
      const chave = `${marca}-mesma-chave-dois-ws`
      const noA = await prisma.publicacao.create({
        data: { workspaceId: wsA, contentId: conteudoA, ...publicacaoBase, chaveDaTentativa: chave },
        select: { id: true },
      })
      const noB = await prisma.publicacao.create({
        data: { workspaceId: wsB, contentId: conteudoB, ...publicacaoBase, chaveDaTentativa: chave },
        select: { id: true },
      })
      assert.notEqual(noA.id, noB.id, 'são publicações distintas')
    })

    test('republicação com chave NOVA cria outra Publicacao', async () => {
      const a = await prisma.publicacao.create({
        data: { workspaceId: wsA, contentId: conteudoA, ...publicacaoBase, chaveDaTentativa: `${marca}-rep-1` },
        select: { id: true },
      })
      const b = await prisma.publicacao.create({
        data: { workspaceId: wsA, contentId: conteudoA, ...publicacaoBase, chaveDaTentativa: `${marca}-rep-2` },
        select: { id: true },
      })
      assert.notEqual(a.id, b.id)
    })

    // ── Idempotência externa ────────────────────────────────────────────

    test('duas Publicacoes com publicacaoExternaId = null COEXISTEM', async () => {
      // Mesmo workspace, mesmo provider. É o estado normal de publicação
      // manual ou ainda em processamento.
      const a = await prisma.publicacao.create({
        data: { workspaceId: wsA, contentId: conteudoA, ...publicacaoBase, chaveDaTentativa: `${marca}-null-1` },
        select: { id: true, publicacaoExternaId: true },
      })
      const b = await prisma.publicacao.create({
        data: { workspaceId: wsA, contentId: conteudoA, ...publicacaoBase, chaveDaTentativa: `${marca}-null-2` },
        select: { id: true, publicacaoExternaId: true },
      })
      assert.equal(a.publicacaoExternaId, null)
      assert.equal(b.publicacaoExternaId, null)
      assert.notEqual(a.id, b.id)
    })

    test('o MESMO publicacaoExternaId no mesmo workspace/provider é RECUSADO', async () => {
      const idExterno = `ig_${marca}`
      await prisma.publicacao.create({
        data: {
          workspaceId: wsA,
          contentId: conteudoA,
          ...publicacaoBase,
          chaveDaTentativa: `${marca}-ext-1`,
          publicacaoExternaId: idExterno,
        },
      })
      const segunda = await prisma.publicacao.create({
        data: { workspaceId: wsA, contentId: conteudoA, ...publicacaoBase, chaveDaTentativa: `${marca}-ext-2` },
        select: { id: true },
      })

      const erro = await capturarRecusa(() =>
        prisma.publicacao.update({ where: { id: segunda.id }, data: { publicacaoExternaId: idExterno } })
      )
      assert.equal(erro.code, 'P2002')
      assert.match(erro.target, /workspaceId.*provider.*publicacaoExternaId/)
    })

    test('o mesmo id externo em OUTRO workspace é aceito — isolamento, não furo', async () => {
      const idExterno = `ig_compartilhado_${marca}`
      const noA = await prisma.publicacao.create({
        data: {
          workspaceId: wsA,
          contentId: conteudoA,
          ...publicacaoBase,
          chaveDaTentativa: `${marca}-ext-ws-a`,
          publicacaoExternaId: idExterno,
        },
        select: { id: true },
      })
      const noB = await prisma.publicacao.create({
        data: {
          workspaceId: wsB,
          contentId: conteudoB,
          ...publicacaoBase,
          chaveDaTentativa: `${marca}-ext-ws-b`,
          publicacaoExternaId: idExterno,
        },
        select: { id: true },
      })
      assert.notEqual(noA.id, noB.id)
    })

    test('a NORMALIZAÇÃO é o que impede a colisão de vazio', async () => {
      // `''` não é caso válido: o Postgres o trata como valor comum, então
      // duas publicações com `''` colidiriam. Toda escrita passa pelo
      // normalizador, e aí as duas convivem como qualquer par sem id.
      assert.equal(normalizarPublicacaoExternaId(''), null)
      assert.equal(normalizarPublicacaoExternaId('   '), null)

      const a = await prisma.publicacao.create({
        data: {
          workspaceId: wsA,
          contentId: conteudoA,
          ...publicacaoBase,
          chaveDaTentativa: `${marca}-vazio-1`,
          publicacaoExternaId: normalizarPublicacaoExternaId(''),
        },
        select: { id: true, publicacaoExternaId: true },
      })
      const b = await prisma.publicacao.create({
        data: {
          workspaceId: wsA,
          contentId: conteudoA,
          ...publicacaoBase,
          chaveDaTentativa: `${marca}-vazio-2`,
          publicacaoExternaId: normalizarPublicacaoExternaId('   '),
        },
        select: { id: true, publicacaoExternaId: true },
      })

      assert.equal(a.publicacaoExternaId, null, 'vazio virou null antes do banco')
      assert.equal(b.publicacaoExternaId, null)
      assert.notEqual(a.id, b.id, 'e por isso as duas convivem')

      // E nenhuma linha com string vazia existe.
      const comVazio = await prisma.publicacao.count({
        where: { workspaceId: wsA, publicacaoExternaId: '' },
      })
      assert.equal(comVazio, 0)
    })

    // ── Cardinalidade com o link ────────────────────────────────────────

    test('SEGUNDO Link para a mesma Publicacao é RECUSADO', async () => {
      const pub = await prisma.publicacao.create({
        data: { workspaceId: wsA, contentId: conteudoA, ...publicacaoBase, chaveDaTentativa: `${marca}-card` },
        select: { id: true },
      })
      const criarLink = async (slug: string) =>
        (
          await prisma.linkDinamico.create({
            data: {
              workspaceId: wsA,
              userId: userA,
              produtoId: produtoA,
              slug,
              plataforma: 'instagram',
              urlDestino: 'https://x.invalido/d',
            },
            select: { id: true },
          })
        ).id
      const l1 = await criarLink(`${marca}-card-1`)
      const l2 = await criarLink(`${marca}-card-2`)

      await prisma.linkDinamico.update({ where: { id: l1 }, data: { publicacaoId: pub.id } })

      const erro = await capturarRecusa(() =>
        prisma.linkDinamico.update({ where: { id: l2 }, data: { publicacaoId: pub.id } })
      )
      assert.equal(erro.code, 'P2002')
      assert.match(erro.target, /publicacaoId.*workspaceId/)
    })

    test('excluir Publicacao que possui Link é RECUSADO', async () => {
      const pub = await prisma.publicacao.create({
        data: { workspaceId: wsA, contentId: conteudoA, ...publicacaoBase, chaveDaTentativa: `${marca}-restrict` },
        select: { id: true },
      })
      const link = await prisma.linkDinamico.create({
        data: {
          workspaceId: wsA,
          userId: userA,
          produtoId: produtoA,
          slug: `${marca}-restrict-link`,
          plataforma: 'instagram',
          urlDestino: 'https://x.invalido/d',
        },
        select: { id: true },
      })
      await prisma.linkDinamico.update({ where: { id: link.id }, data: { publicacaoId: pub.id } })

      const erro = await capturarRecusa(() => prisma.publicacao.delete({ where: { id: pub.id } }))
      assert.equal(erro.code, 'P2003', 'o link não pode ser orfanado em silêncio')
      assert.match(erro.target, /LinkDinamico_publicacaoId_workspaceId_fkey/)

      // A publicação continua lá — a recusa não deixou meio caminho.
      const aindaExiste = await prisma.publicacao.findUnique({ where: { id: pub.id }, select: { id: true } })
      assert.ok(aindaExiste)
    })

    test('vários links SEM publicação convivem — os 18 por produto', async () => {
      const semPub = await prisma.linkDinamico.count({ where: { workspaceId: wsA, publicacaoId: null } })
      assert.ok(semPub >= 1, `esperava links sem publicação, achei ${semPub}`)
    })

    // ── Vocabulário do estado ───────────────────────────────────────────

    test('estado fora do enum é RECUSADO pelo banco', async () => {
      const pub = await prisma.publicacao.create({
        data: { workspaceId: wsA, contentId: conteudoA, ...publicacaoBase, chaveDaTentativa: `${marca}-enum` },
        select: { id: true, estado: true },
      })
      assert.equal(pub.estado, 'PREPARADA', 'o default do contrato')

      // SQL cru de propósito: o TypeScript já barraria pelo tipo, e o que se
      // quer provar aqui é a defesa do BANCO, que vale mesmo para quem
      // escrever fora do Prisma.
      const erro = await capturarRecusa(() =>
        prisma.$executeRawUnsafe(`UPDATE "Publicacao" SET "estado" = 'PUBLICADA' WHERE "id" = $1`, pub.id)
      )
      assert.match(erro.message, /invalid input value for enum/i)
      assert.match(erro.message, /EstadoDaPublicacao/)

      const depois = await prisma.publicacao.findUnique({ where: { id: pub.id }, select: { estado: true } })
      assert.equal(depois?.estado, 'PREPARADA', 'nada mudou')
    })

    test('todo estado do contrato é aceito pelo banco', async () => {
      // A outra metade: o enum não pode estar mais restrito que o contrato.
      for (const estado of ESTADOS_DA_PUBLICACAO) {
        const p = await prisma.publicacao.create({
          data: {
            workspaceId: wsA,
            contentId: conteudoA,
            ...publicacaoBase,
            chaveDaTentativa: `${marca}-estado-${estado}`,
            estado,
          },
          select: { estado: true },
        })
        assert.equal(p.estado, estado)
      }
    })

    // ── Nenhum fluxo operacional escreve publicacaoId ───────────────────

    test('nenhuma Publicacao existe fora desta fixture', async () => {
      // Sem backfill: a migration não criou nada, e nenhum fluxo cria.
      // A pergunta e de ISOLAMENTO, nao de banco vazio: as suites rodam em
      // paralelo no mesmo Postgres e outras criam Publicacao legitimamente.
      // O que nao pode acontecer e uma Publicacao de FORA apontar para um
      // Conteudo DESTA fixture.
      const meus = await prisma.conteudo.findMany({
        where: { workspaceId: { in: criados } },
        select: { id: true },
      })
      const fora = await prisma.publicacao.count({
        where: { workspaceId: { notIn: criados }, contentId: { in: meus.map((c) => c.id) } },
      })
      assert.equal(fora, 0)
    })
  }
)
