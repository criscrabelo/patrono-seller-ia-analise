/**
 * P1.0 Etapa 2.c — a Publicacao passa a existir de verdade.
 *
 * Aqui se prova o ciclo operacional inteiro contra o banco:
 *
 *   Conteudo → Publicacao PREPARADA → LinkDinamico → vínculo validado
 *            → DISTRIBUINDO → provider → DISTRIBUIDA | FALHOU
 *
 * O provider não é chamado: nenhum teste toca rede, e custo é R$ 0,00. O que
 * se exercita é tudo o que acontece ANTES e DEPOIS da chamada — que é onde
 * mora o registro.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '../lib/prisma'
import {
  obterOuCriarPublicacaoDaTentativa,
  vincularLinkAPublicacao,
  marcarDistribuindo,
  marcarDistribuida,
  marcarFalhou,
  montarEvidenciaDeDistribuicao,
  obterPublicacaoDaTentativa,
  ACAO_AUDIT_CONFLITO,
  CAMPOS_DE_EVIDENCIA,
} from '../lib/publicacao-repositorio'
import {
  prepararTentativaDePublicacao,
  confirmarDistribuicao,
  registrarFalhaDaTentativa,
  respostaDeRastreamento,
  providerDoCanal,
} from '../lib/publicacao-fluxo'
import { avaliarRastreamentoDoConteudo } from '../lib/rastreamento-da-publicacao'
import { obterLinkRastreavelDaPublicacao } from '../lib/link-de-publicacao'

const TEM_BANCO = !!process.env.DATABASE_URL
const RAIZ = join(__dirname, '..')
const lerCodigo = (rel: string) =>
  readFileSync(join(RAIZ, rel), 'utf8')
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n')

const BASE_OK = { PUBLIC_BASE_URL: 'https://patrono.exemplo.com.br' }

// ── Puro ────────────────────────────────────────────────────────────────

describe('Evidência — metadados, nunca credencial', () => {
  test('só os campos da whitelist entram', () => {
    const e = montarEvidenciaDeDistribuicao({
      provider: 'meta',
      canal: 'INSTAGRAM',
      publicacaoExternaId: '  ig_123  ',
      confirmadaEm: new Date('2026-09-22T12:00:00.000Z'),
    })
    assert.deepEqual(Object.keys(e).sort(), [...CAMPOS_DE_EVIDENCIA].sort())
    assert.equal(e.provider, 'META', 'normalizado')
    assert.equal(e.canal, 'instagram')
    assert.equal(e.referenciaExterna, 'ig_123', 'aparado')
    assert.equal(e.confirmadaEm, '2026-09-22T12:00:00.000Z')
    assert.equal(e.tipo, 'ID_EXTERNO_DO_PROVIDER')
  })

  test('id externo vazio vira null também na evidência', () => {
    for (const v of ['', '   ', null, undefined]) {
      assert.equal(montarEvidenciaDeDistribuicao({ provider: 'META', canal: 'x', publicacaoExternaId: v }).referenciaExterna, null)
    }
  })

  test('a whitelist NÃO tem campo que possa carregar segredo', () => {
    for (const proibido of ['token', 'accessToken', 'secret', 'headers', 'payload', 'authorization', 'cookie']) {
      assert.ok(
        !(CAMPOS_DE_EVIDENCIA as readonly string[]).some((c) => c.toLowerCase().includes(proibido.toLowerCase())),
        `${proibido} não pode existir na whitelist`
      )
    }
  })

  test('o repositório não recebe nem repassa credencial', () => {
    const codigo = lerCodigo('lib/publicacao-repositorio.ts')
    for (const proibido of ['accessToken', 'access_token', 'Authorization', 'integracao.', 'secret']) {
      assert.ok(!codigo.includes(proibido), `${proibido} não pode aparecer no repositório`)
    }
  })

  test('canal desconhecido não vira palpite de provider', () => {
    assert.equal(providerDoCanal('instagram'), 'META')
    assert.equal(providerDoCanal('TikTok'), 'TIKTOK')
    assert.equal(providerDoCanal('rede-que-nao-existe'), 'DESCONHECIDO')
    assert.equal(providerDoCanal(null), 'DESCONHECIDO')
  })
})

describe('As rotas usam a autoridade central, sem replicar regra', () => {
  const manual = lerCodigo('app/api/conteudos/[id]/publicar/route.ts')
  const cron = lerCodigo('app/api/cron/publicar/route.ts')
  // P2.2: as duas rotas delegam ao MESMO executor — uma regra, um lugar.
  const executor = lerCodigo('lib/trabalhos-longos/publicar-instagram.ts')

  test('as duas preparam a tentativa pelo mesmo fluxo', () => {
    assert.match(executor, /prepararTentativaDePublicacao/)
    assert.match(executor, /confirmarDistribuicao/)
    assert.match(executor, /registrarFalhaDaTentativa/)
    for (const [nome, codigo] of [['manual', manual], ['cron', cron]] as const) {
      assert.match(codigo, /executorDaPublicacao\(\)/, `${nome} delega ao executor único`)
      assert.match(codigo, /tipo: 'LONGO_PUBLICAR_INSTAGRAM'/, `${nome}`)
      assert.match(codigo, /chave: chaveDaPublicacao\(\{ chaveDaTentativa \}\)/, `${nome} usa a chave da tentativa`)
    }
  })

  test('nenhuma rota cria Publicacao por conta própria', () => {
    for (const codigo of [manual, cron, executor]) {
      assert.ok(!/prisma\.publicacao\.(create|update|upsert)/.test(codigo))
      assert.ok(!/avaliarVinculoDeLinkComPublicacao/.test(codigo), 'o guard é chamado pelo repositório')
    }
  })

  test('workspaceId vem da SESSÃO, nunca do corpo', () => {
    assert.match(manual, /workspaceId: session\.user\.workspaceId/)
    assert.ok(!/workspaceId: body/.test(manual))
  })

  test('produtoId nunca é aceito de quem chama', () => {
    const fluxo = lerCodigo('lib/publicacao-fluxo.ts')
    assert.ok(!/produtoId/.test(fluxo), 'o produto sai de Conteudo.produtoId, no servidor')
    assert.ok(!/body\?\.produtoId|body\.produtoId/.test(manual))
  })
})

// ── Banco ───────────────────────────────────────────────────────────────

const marca = `r32-${Date.now()}`
let wsA = ''
let wsB = ''
let userA = ''
let produtoA = ''
let produtoB = ''
let conteudoA = ''
let conteudoSemUrl = ''
let conteudoB = ''
const criados: string[] = []

describe(
  'Ciclo operacional da Publicacao',
  { skip: !TEM_BANCO ? 'DATABASE_URL ausente — exige Postgres' : false },
  () => {
    before(async () => {
      for (const n of ['A', 'B']) {
        const ws = await prisma.workspace.create({
          data: { name: `R32-${n}`, ownerId: `${marca}-${n}` },
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
      const userB = await criarUser(wsB, 'b')

      const criarProduto = async (ws: string, uid: string, nome: string, link: string | null) =>
        (
          await prisma.produto.create({
            data: {
              workspaceId: ws,
              userId: uid,
              nome,
              categoria: 'x',
              tipoVenda: 'Afiliado',
              origemConteudo: 'Proprio',
              linkProduto: link,
            },
            select: { id: true },
          })
        ).id
      produtoA = await criarProduto(wsA, userA, 'r32-a', 'https://loja.invalido/a')
      produtoB = await criarProduto(wsA, userA, 'r32-b', 'https://loja.invalido/b')
      const produtoSemUrl = await criarProduto(wsA, userA, 'r32-sem-url', null)
      const produtoOutroWs = await criarProduto(wsB, userB, 'r32-outro', 'https://loja.invalido/c')

      const criarConteudo = async (ws: string, uid: string, pid: string) =>
        (
          await prisma.conteudo.create({
            data: { workspaceId: ws, userId: uid, produtoId: pid, roteiro: 'x', redeSocial: 'instagram' },
            select: { id: true },
          })
        ).id
      conteudoA = await criarConteudo(wsA, userA, produtoA)
      conteudoSemUrl = await criarConteudo(wsA, userA, produtoSemUrl)
      conteudoB = await criarConteudo(wsB, userB, produtoOutroWs)
    })

    after(async () => {
      for (const ws of criados) {
        // A Etapa 2.d faz a confirmacao da distribuicao capturar amostra de
        // ML. Elas nascem nestes workspaces e precisam sair antes deles.
        await prisma.mLFeatureSnapshot.deleteMany({ where: { workspaceId: ws } })
        await prisma.linkDinamico.updateMany({ where: { workspaceId: ws }, data: { publicacaoId: null } })
        await prisma.auditLog.deleteMany({ where: { workspaceId: ws } })
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

    const preparar = (over: Record<string, unknown> = {}) =>
      prepararTentativaDePublicacao({
        workspaceId: wsA,
        contentId: conteudoA,
        canal: 'instagram',
        urlDiretaDoProduto: 'https://loja.invalido/a',
        env: BASE_OK,
        ...over,
      })

    // ── Criação e reuso ─────────────────────────────────────────────────

    test('primeira tentativa CRIA a Publicacao, em PREPARADA', async () => {
      const r = await obterOuCriarPublicacaoDaTentativa({
        workspaceId: wsA,
        contentId: conteudoA,
        provider: 'META',
        canal: 'instagram',
        chaveDaTentativa: `${marca}-primeira`,
      })
      assert.equal(r.ok, true, r.explicacao)
      assert.equal(r.criada, true)
      assert.equal(r.publicacao?.estado, 'PREPARADA')
      assert.equal(r.publicacao?.publicacaoExternaId, null)
      assert.equal(r.publicacao?.distribuidaEm, null)
    })

    test('RETRY reutiliza a MESMA Publicacao — nunca outra linha', async () => {
      const chave = `${marca}-retry`
      const a = await obterOuCriarPublicacaoDaTentativa({
        workspaceId: wsA, contentId: conteudoA, provider: 'META', canal: 'instagram', chaveDaTentativa: chave,
      })
      const b = await obterOuCriarPublicacaoDaTentativa({
        workspaceId: wsA, contentId: conteudoA, provider: 'META', canal: 'instagram', chaveDaTentativa: chave,
      })
      assert.equal(a.criada, true)
      assert.equal(b.criada, false)
      assert.equal(a.publicacao?.id, b.publicacao?.id)

      const quantas = await prisma.publicacao.count({ where: { workspaceId: wsA, chaveDaTentativa: chave } })
      assert.equal(quantas, 1)
    })

    test('REPUBLICAÇÃO com chave nova cria OUTRA Publicacao', async () => {
      const a = await preparar({ chaveDaTentativa: `${marca}-rep-a` })
      const b = await preparar({ chaveDaTentativa: `${marca}-rep-b` })
      assert.notEqual(a.publicacao?.id, b.publicacao?.id)
      assert.notEqual(a.linkId, b.linkId, 'e link próprio para cada uma')
    })

    test('MESMO conteúdo em OUTRO canal é outra Publicacao', async () => {
      const ig = await preparar({ canal: 'instagram', chaveDaTentativa: `${marca}-canal-ig` })
      const tk = await preparar({ canal: 'tiktok', chaveDaTentativa: `${marca}-canal-tk` })
      assert.notEqual(ig.publicacao?.id, tk.publicacao?.id)
      assert.equal(ig.publicacao?.provider, 'META')
      assert.equal(tk.publicacao?.provider, 'TIKTOK')
    })

    test('TikTok hoje + TikTok de novo + Instagram = TRÊS Publicacoes', async () => {
      const t1 = await preparar({ canal: 'tiktok', chaveDaTentativa: `${marca}-tres-1` })
      const t2 = await preparar({ canal: 'tiktok', chaveDaTentativa: `${marca}-tres-2` })
      const i1 = await preparar({ canal: 'instagram', chaveDaTentativa: `${marca}-tres-3` })

      const ids = new Set([t1.publicacao?.id, t2.publicacao?.id, i1.publicacao?.id])
      assert.equal(ids.size, 3, 'três publicações independentes do MESMO conteúdo')
      // E cada uma com seu link.
      assert.equal(new Set([t1.linkId, t2.linkId, i1.linkId]).size, 3)
    })

    test('conteúdo de outro workspace não cria Publicacao', async () => {
      const r = await obterOuCriarPublicacaoDaTentativa({
        workspaceId: wsA, contentId: conteudoB, provider: 'META', canal: 'instagram',
        chaveDaTentativa: `${marca}-cross`,
      })
      assert.equal(r.ok, false)
      assert.equal(r.motivo, 'CONTEUDO_NAO_ENCONTRADO')
    })

    // ── Vínculo ─────────────────────────────────────────────────────────

    test('o Link CORRETO recebe publicacaoId', async () => {
      const t = await preparar({ chaveDaTentativa: `${marca}-vinculo` })
      assert.equal(t.rastreada, true, t.explicacao)
      assert.ok(t.linkId)

      const link = await prisma.linkDinamico.findUniqueOrThrow({
        where: { id: t.linkId! },
        select: { publicacaoId: true, produtoId: true },
      })
      assert.equal(link.publicacaoId, t.publicacao?.id)
      assert.equal(link.produtoId, produtoA, 'produto do CONTEÚDO, lido no servidor')
    })

    test('link de OUTRO produto é recusado', async () => {
      const t = await preparar({ chaveDaTentativa: `${marca}-outro-prod` })
      const linkDoB = await prisma.linkDinamico.create({
        data: {
          workspaceId: wsA, userId: userA, produtoId: produtoB,
          slug: `${marca}-link-prod-b`, plataforma: 'instagram', urlDestino: 'https://loja.invalido/b',
        },
        select: { id: true },
      })

      const r = await vincularLinkAPublicacao({
        workspaceId: wsA,
        contentId: conteudoA,
        publicacaoId: t.publicacao!.id,
        linkId: linkDoB.id,
      })
      assert.equal(r.ok, false)
      assert.equal(r.motivo, 'VINCULO_RECUSADO')
      assert.match(r.explicacao, /produto diferente/i)

      const link = await prisma.linkDinamico.findUniqueOrThrow({
        where: { id: linkDoB.id },
        select: { publicacaoId: true },
      })
      assert.equal(link.publicacaoId, null, 'nada foi gravado')
    })

    test('link de OUTRO workspace é recusado', async () => {
      const t = await preparar({ chaveDaTentativa: `${marca}-outro-ws` })
      const r = await vincularLinkAPublicacao({
        workspaceId: wsA,
        contentId: conteudoA,
        publicacaoId: t.publicacao!.id,
        linkId: 'link-que-nao-e-deste-workspace',
      })
      assert.equal(r.ok, false)
      assert.equal(r.motivo, 'VINCULO_RECUSADO')
    })

    test('revincular o MESMO link à MESMA publicação é idempotente', async () => {
      const t = await preparar({ chaveDaTentativa: `${marca}-idem-vinc` })
      const r = await vincularLinkAPublicacao({
        workspaceId: wsA, contentId: conteudoA, publicacaoId: t.publicacao!.id, linkId: t.linkId!,
      })
      assert.equal(r.ok, true, r.explicacao)
      assert.match(r.explicacao, /já estava vinculado/i)
    })

    // ── Fallback ────────────────────────────────────────────────────────

    test('FALLBACK: sem base pública, publica sem vínculo e fica não rastreada', async () => {
      const t = await prepararTentativaDePublicacao({
        workspaceId: wsA,
        contentId: conteudoA,
        canal: 'instagram',
        chaveDaTentativa: `${marca}-fallback`,
        urlDiretaDoProduto: 'https://loja.invalido/a',
        env: {},
      })

      assert.equal(t.ok, true, 'a publicação acontece do mesmo jeito')
      assert.ok(t.publicacao, 'e a Publicacao EXISTE')
      assert.equal(t.rastreada, false)
      assert.equal(t.linkId, null)
      assert.equal(t.urlParaDivulgar, 'https://loja.invalido/a', 'link direto do produto')
      assert.equal(t.aviso?.titulo, 'Publicada sem rastreamento de cliques')

      // Chega a DISTRIBUIDA sem link nenhum.
      const conf = await confirmarDistribuicao({
        workspaceId: wsA,
        publicacaoId: t.publicacao!.id,
        publicacaoExternaId: `ig_fb_${marca}`,
      })
      assert.equal(conf.ok, true, conf.explicacao)
      assert.equal(conf.publicacao?.estado, 'DISTRIBUIDA')

      const vinculado = await prisma.linkDinamico.count({ where: { publicacaoId: t.publicacao!.id } })
      assert.equal(vinculado, 0, 'nenhum link — é esse o preço do fallback')

      const estado = await avaliarRastreamentoDoConteudo({ workspaceId: wsA, contentId: conteudoA })
      assert.equal(estado.estado, 'NAO_RASTREADA_COM_FALLBACK')
      assert.equal(estado.metricasDeClique.indisponibilidade, 'INDISPONIVEL_POR_FALTA_DE_RASTREAMENTO')
      assert.equal(estado.metricasDeClique.cliques, null, 'nunca zero inventado')
      assert.equal(estado.metricasDeClique.taxaConversao, null)
    })

    test('FALLBACK: produto sem URL de destino também publica', async () => {
      const t = await prepararTentativaDePublicacao({
        workspaceId: wsA,
        contentId: conteudoSemUrl,
        canal: 'instagram',
        chaveDaTentativa: `${marca}-sem-url`,
        urlDiretaDoProduto: null,
        env: BASE_OK,
      })
      assert.ok(t.publicacao)
      assert.equal(t.rastreada, false)
      assert.equal(t.motivo, 'PRODUTO_SEM_URL_DE_DESTINO')
    })

    // ── Máquina de estados ──────────────────────────────────────────────

    test('preparar já deixa a publicação em DISTRIBUINDO', async () => {
      const t = await preparar({ chaveDaTentativa: `${marca}-distribuindo` })
      const p = await prisma.publicacao.findUniqueOrThrow({
        where: { id: t.publicacao!.id },
        select: { estado: true },
      })
      assert.equal(p.estado, 'DISTRIBUINDO')
    })

    test('provider com SUCESSO → DISTRIBUIDA, com id externo e instante', async () => {
      const t = await preparar({ chaveDaTentativa: `${marca}-sucesso` })
      const quando = new Date()
      const r = await confirmarDistribuicao({
        workspaceId: wsA,
        publicacaoId: t.publicacao!.id,
        publicacaoExternaId: `  ig_ok_${marca}  `,
        distribuidaEm: quando,
      })
      assert.equal(r.ok, true, r.explicacao)
      assert.equal(r.publicacao?.estado, 'DISTRIBUIDA')
      assert.equal(r.publicacao?.publicacaoExternaId, `ig_ok_${marca}`, 'aparado')
      assert.equal(r.publicacao?.distribuidaEm?.toISOString(), quando.toISOString())

      const salva = await prisma.publicacao.findUniqueOrThrow({
        where: { id: t.publicacao!.id },
        select: { evidencia: true },
      })
      const ev = salva.evidencia as Record<string, unknown>
      assert.equal(ev.tipo, 'ID_EXTERNO_DO_PROVIDER')
      assert.equal(ev.resultado, 'PUBLICADO')
      assert.deepEqual(Object.keys(ev).sort(), [...CAMPOS_DE_EVIDENCIA].sort())
    })

    test('provider com ERRO → FALHOU, e o retry volta a DISTRIBUINDO', async () => {
      const chave = `${marca}-falha`
      const t = await preparar({ chaveDaTentativa: chave })
      const f = await registrarFalhaDaTentativa({ workspaceId: wsA, publicacaoId: t.publicacao!.id })
      assert.equal(f.ok, true, f.explicacao)
      assert.equal(f.publicacao?.estado, 'FALHOU')

      // Retry: mesma chave, mesma linha, e a máquina permite FALHOU → DISTRIBUINDO.
      const t2 = await preparar({ chaveDaTentativa: chave })
      assert.equal(t2.publicacao?.id, t.publicacao?.id, 'mesma Publicacao')
      const p = await prisma.publicacao.findUniqueOrThrow({
        where: { id: t.publicacao!.id },
        select: { estado: true },
      })
      assert.equal(p.estado, 'DISTRIBUINDO')
    })

    test('transição proibida é recusada com motivo', async () => {
      const t = await preparar({ chaveDaTentativa: `${marca}-transicao` })
      await confirmarDistribuicao({ workspaceId: wsA, publicacaoId: t.publicacao!.id, publicacaoExternaId: `ig_tr_${marca}` })
      // DISTRIBUIDA → DISTRIBUINDO não existe.
      const r = await marcarDistribuindo({ workspaceId: wsA, publicacaoId: t.publicacao!.id })
      assert.equal(r.ok, false)
      assert.equal(r.motivo, 'TRANSICAO_NAO_PERMITIDA')
    })

    // ── Id externo ──────────────────────────────────────────────────────

    test('id externo VAZIO vira null — nunca chega ao banco', async () => {
      const t = await preparar({ chaveDaTentativa: `${marca}-vazio` })
      const r = await confirmarDistribuicao({
        workspaceId: wsA, publicacaoId: t.publicacao!.id, publicacaoExternaId: '   ',
      })
      assert.equal(r.ok, true, r.explicacao)
      assert.equal(r.publicacao?.publicacaoExternaId, null)

      const comVazio = await prisma.publicacao.count({ where: { workspaceId: wsA, publicacaoExternaId: '' } })
      assert.equal(comVazio, 0)
    })

    test('MESMO id externo em retry NÃO duplica — é idempotente', async () => {
      const t = await preparar({ chaveDaTentativa: `${marca}-idem-ext` })
      const idExterno = `ig_idem_${marca}`
      const a = await confirmarDistribuicao({ workspaceId: wsA, publicacaoId: t.publicacao!.id, publicacaoExternaId: idExterno })
      const b = await confirmarDistribuicao({ workspaceId: wsA, publicacaoId: t.publicacao!.id, publicacaoExternaId: idExterno })

      assert.equal(a.ok, true, a.explicacao)
      assert.equal(b.ok, true, b.explicacao)
      assert.match(b.explicacao, /retry do provider/i)
      assert.equal(await prisma.publicacao.count({ where: { workspaceId: wsA, publicacaoExternaId: idExterno } }), 1)
    })

    test('CONFLITO chave × id externo entre publicações diferentes BLOQUEIA e audita', async () => {
      const idExterno = `ig_conflito_${marca}`
      const dona = await preparar({ chaveDaTentativa: `${marca}-conf-dona` })
      await confirmarDistribuicao({ workspaceId: wsA, publicacaoId: dona.publicacao!.id, publicacaoExternaId: idExterno })

      // Outra tentativa, chave diferente, e o provider devolve o MESMO id.
      const outra = await preparar({ chaveDaTentativa: `${marca}-conf-outra` })
      const r = await confirmarDistribuicao({
        workspaceId: wsA, publicacaoId: outra.publicacao!.id, publicacaoExternaId: idExterno,
      })

      assert.equal(r.ok, false, 'fail-closed: nenhuma das duas é escolhida')
      assert.equal(r.motivo, 'CONFLITO_DE_IDENTIDADE')

      // Nada foi mesclado em silêncio.
      const aindaSemId = await prisma.publicacao.findUniqueOrThrow({
        where: { id: outra.publicacao!.id },
        select: { publicacaoExternaId: true, estado: true },
      })
      assert.equal(aindaSemId.publicacaoExternaId, null)
      assert.notEqual(aindaSemId.estado, 'DISTRIBUIDA')

      // E ficou auditado.
      const audit = await prisma.auditLog.findFirst({
        where: { workspaceId: wsA, action: ACAO_AUDIT_CONFLITO, entityId: outra.publicacao!.id },
        select: { metadata: true },
      })
      assert.ok(audit, 'o conflito precisa deixar rastro')
      const meta = audit!.metadata as Record<string, unknown>
      assert.equal(meta.publicacaoQueJaTemOIdExterno, dona.publicacao!.id)
      for (const proibido of ['token', 'accessToken', 'secret', 'payload']) {
        assert.ok(!JSON.stringify(meta).toLowerCase().includes(proibido.toLowerCase()))
      }
    })

    // ── Rastreamento deixa de depender do slug ──────────────────────────

    test('com Publicacao persistida, o rastreamento usa a RELAÇÃO, não o slug', async () => {
      const conteudo = await prisma.conteudo.create({
        data: { workspaceId: wsA, userId: userA, produtoId: produtoA, roteiro: 'x', redeSocial: 'instagram' },
        select: { id: true },
      })
      const t = await prepararTentativaDePublicacao({
        workspaceId: wsA,
        contentId: conteudo.id,
        canal: 'instagram',
        // Chave PRÓPRIA: o slug dela não é recalculável pela derivação
        // legada. Se o rastreamento ainda dependesse do slug, leria como
        // fallback; com a relação explícita, lê como RASTREADA.
        chaveDaTentativa: `${marca}-chave-nao-derivavel-${Math.random()}`,
        urlDiretaDoProduto: 'https://loja.invalido/a',
        env: BASE_OK,
      })
      assert.equal(t.rastreada, true, t.explicacao)
      await confirmarDistribuicao({
        workspaceId: wsA, publicacaoId: t.publicacao!.id, publicacaoExternaId: `ig_rel_${marca}`,
      })

      const r = await avaliarRastreamentoDoConteudo({ workspaceId: wsA, contentId: conteudo.id })
      assert.equal(r.estado, 'RASTREADA')
      assert.equal(r.aviso, null)
      assert.equal(r.metricasDeClique.indisponibilidade, null)
    })

    test('LEGADO sem Publicacao continua funcionando como antes', async () => {
      // Conteúdo distribuído da forma antiga: link criado pela derivação de
      // slug da Etapa 2.a, sem nenhuma Publicacao. Sem backfill.
      const conteudo = await prisma.conteudo.create({
        data: {
          workspaceId: wsA,
          userId: userA,
          produtoId: produtoA,
          roteiro: 'x',
          redeSocial: 'instagram',
          publicacaoExternaId: `ig_legado_${marca}`,
          dataPublicacao: new Date(),
        },
        select: { id: true },
      })
      const link = await obterLinkRastreavelDaPublicacao({
        workspaceId: wsA,
        contentId: conteudo.id,
        canal: 'instagram',
        env: BASE_OK,
      })
      assert.equal(link.ok, true, link.explicacao)

      const semPublicacao = await prisma.publicacao.count({ where: { contentId: conteudo.id } })
      assert.equal(semPublicacao, 0, 'nenhuma Publicacao nasceu retroativamente')

      const r = await avaliarRastreamentoDoConteudo({ workspaceId: wsA, contentId: conteudo.id })
      assert.equal(r.estado, 'RASTREADA', 'a derivação por slug ainda responde pelo legado')
    })

    test('a resposta HTTP não vaza detalhe interno', async () => {
      const t = await prepararTentativaDePublicacao({
        workspaceId: wsA, contentId: conteudoA, canal: 'instagram',
        chaveDaTentativa: `${marca}-resposta`, urlDiretaDoProduto: 'https://loja.invalido/a', env: {},
      })
      const resposta = JSON.stringify(respostaDeRastreamento(t))
      for (const proibido of ['PUBLIC_BASE_URL', 'NEXTAUTH_URL', 'prisma', 'accessToken', 'explicacao']) {
        assert.ok(!resposta.includes(proibido), `${proibido} não pode viajar na resposta`)
      }
      assert.match(resposta, /Publicada sem rastreamento de cliques/)
    })

    test('obterPublicacaoDaTentativa reencontra pela chave', async () => {
      const chave = `${marca}-busca`
      const t = await preparar({ chaveDaTentativa: chave })
      const achada = await obterPublicacaoDaTentativa({ workspaceId: wsA, chaveDaTentativa: chave })
      assert.equal(achada?.id, t.publicacao?.id)
      assert.equal(await obterPublicacaoDaTentativa({ workspaceId: wsB, chaveDaTentativa: chave }), null)
    })

    test('nenhuma Publicacao vazou para fora da fixture', async () => {
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
