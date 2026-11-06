/**
 * P2.2 — Trabalhos longos (Netlify Free: função síncrona morre aos 30 s).
 *
 * O que se prova aqui:
 *   - nenhuma rota longa espera provider dentro da requisição;
 *   - mesmo pedido = mesmo trabalho; o que concluiu não roda de novo;
 *   - desfecho INCERTO (rede, timeout, 5xx, execução interrompida no
 *     `media_publish`) nunca é repetido automaticamente;
 *   - recusa explícita do provider é repetível, a pedido;
 *   - a fila genérica não enxerga os trabalhos longos;
 *   - disparo duplicado da Background Function é inofensivo;
 *   - um agendador por vez.
 *
 * Nenhum teste fala com Meta, fal.ai ou Z-API: os executores recebem
 * dublês. O banco é o de TESTE (DATABASE_URL). Custo R$ 0,00.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  assinarDisparo,
  disparoAutentico,
  modoDeExecucao,
  iniciarTrabalhoLongo,
  executarTrabalhoLongo,
  situacaoDoTrabalho,
  buscarTrabalho,
  RESERVA_DO_SEGUNDO_PLANO,
  CAMINHO_DA_FUNCAO,
  MOTIVO_HUMANO_DO_INCERTO,
  type ExecutorDeTrabalho,
} from '../lib/trabalho-longo'
import { chamadaDeOutroAgendador, agendadorAtivo, CABECALHO_DO_AGENDADOR } from '../lib/agendador'
import { dispararRotina } from '../netlify/rotina-interna'
import { ErroDaApiInstagram, metaRecusouComCerteza } from '../lib/instagram'
import { RespostaDeErroDoFal, falRecusouComCerteza, BloqueadoPorPoliticaDeCusto } from '../lib/falai'
import { HUMAN_ACTION_REASONS } from '../lib/automation'
import { respostaFinal } from '../lib/aguardar-trabalho'
import { esperaMaximaDeProviderMs } from '../lib/limite-sincrono'
import { executorDaPublicacao, chaveDaPublicacao, type DependenciasDaPublicacao } from '../lib/trabalhos-longos/publicar-instagram'
import { executorDoEnvio, chaveDoEnvio, type DependenciasDoEnvio } from '../lib/trabalhos-longos/envio-whatsapp'
import { executorDaLegenda, chaveDaLegenda, type DependenciasDaLegenda } from '../lib/trabalhos-longos/legenda-video'
import { prisma } from '../lib/prisma'
import { portaPrisma } from '../lib/automation-queue-prisma'

const RAIZ = join(__dirname, '..')
const lerCodigo = (rel: string) =>
  readFileSync(join(RAIZ, rel), 'utf8')
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n')

const SEGREDO = 'segredo-de-teste-r51'
process.env.NEXTAUTH_SECRET ??= SEGREDO

// ── 1. Peças puras ──────────────────────────────────────────────────────

describe('Disparo assinado da Background Function', () => {
  test('só o jobId assinado com o segredo do ambiente é aceito', () => {
    const a = assinarDisparo('job-1', SEGREDO)
    assert.equal(disparoAutentico('job-1', a, SEGREDO), true)
    assert.equal(disparoAutentico('job-2', a, SEGREDO), false, 'assinatura de outro job')
    assert.equal(disparoAutentico('job-1', a.slice(0, -1) + 'x', SEGREDO), false, 'adulterada')
    assert.equal(disparoAutentico('job-1', a, 'outro-segredo'), false, 'outro ambiente')
    assert.equal(disparoAutentico('job-1', a, undefined), false, 'sem segredo, nada passa')
    assert.equal(disparoAutentico(undefined, a, SEGREDO), false)
    assert.equal(disparoAutentico('job-1', 123, SEGREDO), false)
  })

  test('o modo só vira segundo plano com a variável exata', () => {
    assert.equal(modoDeExecucao({}), 'na-requisicao')
    assert.equal(modoDeExecucao({ TRABALHO_LONGO_MODO: 'sim' }), 'na-requisicao')
    assert.equal(modoDeExecucao({ TRABALHO_LONGO_MODO: 'segundo-plano' }), 'segundo-plano')
  })

  test('fora da Netlify, a espera por provider não muda; nela, 24 s', () => {
    assert.equal(esperaMaximaDeProviderMs({}), null)
    assert.equal(esperaMaximaDeProviderMs({ TRABALHO_LONGO_MODO: 'segundo-plano' }), 24_000)
  })
})

describe('Classificação de erro: recusa certa × desfecho incerto', () => {
  test('Instagram: só 4xx com corpo de erro da Graph API é recusa certa', () => {
    assert.equal(metaRecusouComCerteza(new ErroDaApiInstagram('Invalid parameter', 400, true)), true)
    assert.equal(metaRecusouComCerteza(new ErroDaApiInstagram('HTTP 500', 500, true)), false, '5xx pode ter publicado')
    assert.equal(metaRecusouComCerteza(new ErroDaApiInstagram('HTTP 400', 400, false)), false, 'sem corpo de erro')
    assert.equal(metaRecusouComCerteza(new TypeError('fetch failed')), false, 'rede: ninguém sabe')
    assert.equal(metaRecusouComCerteza(new Error('Instagram não retornou o ID da publicação')), false)
  })

  test('fal.ai: só 4xx é recusa certa', () => {
    assert.equal(falRecusouComCerteza(new RespostaDeErroDoFal('validação', 422)), true)
    assert.equal(falRecusouComCerteza(new RespostaDeErroDoFal('erro interno', 503)), false)
    assert.equal(falRecusouComCerteza(new TypeError('fetch failed')), false)
  })

  test('o motivo humano do incerto é do vocabulário oficial', () => {
    assert.ok((HUMAN_ACTION_REASONS as readonly string[]).includes(MOTIVO_HUMANO_DO_INCERTO))
  })

  test('envio de WhatsApp: só o pedido que saiu sem resposta é incerto', () => {
    const f = lerCodigo('lib/whatsapp.ts')
    // Marcado ANTES do fetch e só depois da política: bloqueio da política
    // não é incerto (nada saiu).
    const marcas = f.match(/pedidoSaiu = true\n\s+const res = await fetch/g) ?? []
    assert.equal(marcas.length, 2, 'send-text e send-image')
    assert.equal((f.match(/\.\.\.\(pedidoSaiu \? \{ incerto: true \} : \{\}\)/g) ?? []).length, 2)
  })
})

describe('Chaves determinísticas', () => {
  test('publicação: a chave do trabalho é a da tentativa', () => {
    assert.equal(chaveDaPublicacao({ chaveDaTentativa: 'c1:instagram:manual' }), chaveDaPublicacao({ chaveDaTentativa: 'c1:instagram:manual' }))
    assert.notEqual(chaveDaPublicacao({ chaveDaTentativa: 'c1:instagram:manual' }), chaveDaPublicacao({ chaveDaTentativa: 'c1:instagram:outra' }))
  })

  test('WhatsApp: mesma lista no mesmo dia = mesmo envio; amanhã, outro', () => {
    const p = { numeros: ['5511999990001', '5511999990002'], mensagem: 'oi', delayMs: 3000 }
    const hoje = new Date('2026-10-02T10:00:00Z')
    const maisTarde = new Date('2026-10-02T23:00:00Z')
    const amanha = new Date('2026-10-03T10:00:00Z')
    assert.equal(chaveDoEnvio(p, hoje), chaveDoEnvio({ ...p, numeros: [...p.numeros].reverse() }, maisTarde), 'a ordem não muda o envio')
    assert.notEqual(chaveDoEnvio(p, hoje), chaveDoEnvio(p, amanha))
    assert.notEqual(chaveDoEnvio(p, hoje), chaveDoEnvio({ ...p, mensagem: 'outra' }, hoje))
    assert.notEqual(chaveDoEnvio(p, hoje), chaveDoEnvio(p, hoje, 'repetir-hoje'), 'repetição explícita é outro envio')
  })

  test('legenda: muda o vídeo, muda o trabalho', () => {
    const base = { conteudoId: 'c', userId: 'u', preset: 'glass', videoUrl: 'https://x/v1.mp4', srt: '1\n' }
    assert.equal(chaveDaLegenda(base), chaveDaLegenda({ ...base }))
    assert.notEqual(chaveDaLegenda(base), chaveDaLegenda({ ...base, videoUrl: 'https://x/v2.mp4' }))
  })
})

describe('Um agendador por vez', () => {
  const h = (v: string | null) => ({ get: (n: string) => (n === CABECALHO_DO_AGENDADOR ? v : null) })

  test('sem configuração, vale o GitHub e nada é recusado', () => {
    assert.equal(agendadorAtivo({}), 'github')
    assert.equal(chamadaDeOutroAgendador(h(null), {}), false)
  })

  test('com a Netlify ativa, chamada sem o cabeçalho dela é recusada', () => {
    const env = { AGENDADOR_DOS_CRONS: 'netlify' }
    assert.equal(chamadaDeOutroAgendador(h(null), env), true, 'o GitHub esquecido ligado')
    assert.equal(chamadaDeOutroAgendador(h('github'), env), true)
    assert.equal(chamadaDeOutroAgendador(h('netlify'), env), false)
  })

  test('as cinco rotas de cron têm a trava, depois do CRON_SECRET', () => {
    for (const c of ['executar-fila', 'ml-janela-observacao', 'oportunidades', 'sincronizar-catalogo', 'publicar']) {
      const src = lerCodigo(`app/api/cron/${c}/route.ts`)
      const segredo = src.indexOf('autorizacaoDeRotinaValida(')
      const trava = src.indexOf('if (chamadaDeOutroAgendador(req.headers))')
      assert.ok(segredo > 0 && trava > segredo, `${c}: trava ausente ou antes do segredo`)
    }
  })

  test('a Scheduled Function não dispara nada se o agendador ativo não for a Netlify', async () => {
    let chamadas = 0
    const enviar = (async () => { chamadas++; return new Response('{}') }) as typeof fetch
    const r = await dispararRotina('executar-fila', { site: { url: 'https://x.test' } }, { CRON_SECRET: 's' }, enviar)
    assert.equal(r.disparou, false)
    assert.equal(chamadas, 0)
  })

  test('publicar exige a decisão explícita, como no workflow', async () => {
    let chamadas = 0
    const enviar = (async () => { chamadas++; return new Response('{}') }) as typeof fetch
    const env = { AGENDADOR_DOS_CRONS: 'netlify', CRON_SECRET: 's' }
    assert.equal((await dispararRotina('publicar', { site: { url: 'https://x.test' } }, env, enviar)).disparou, false)
    assert.equal(chamadas, 0)
  })

  test('quando dispara: segredo no header, nunca na URL, e o cabeçalho do agendador', async () => {
    let visto: { url: string; headers: Record<string, string> } | null = null
    const enviar = (async (url: string, init: RequestInit) => {
      visto = { url, headers: init.headers as Record<string, string> }
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    const r = await dispararRotina('oportunidades', { site: { url: 'https://x.test' } }, { AGENDADOR_DOS_CRONS: 'netlify', CRON_SECRET: 's3' }, enviar)
    assert.equal(r.disparou, true)
    assert.equal(visto!.url, 'https://x.test/api/cron/oportunidades')
    assert.equal(visto!.headers.authorization, 'Bearer s3')
    assert.equal(visto!.headers[CABECALHO_DO_AGENDADOR], 'netlify')
    assert.ok(!visto!.url.includes('s3'))
  })

  test('os horários das Scheduled Functions são os do workflow do GitHub', () => {
    const esperado: Record<string, string> = {
      'executar-fila': '0 * * * *',
      oportunidades: '0 5 * * *',
      'sincronizar-catalogo': '0 6,12,18 * * *',
      'ml-janela-observacao': '0 3 * * *',
      publicar: '0 12 * * *',
      // P2.36: economia de créditos da Netlify (cada disparo acorda duas funções a frio).
      'processar-eventos': '0 */3 * * *',
      reconciliar: '0 */6 * * *',
    }
    for (const [rota, cron] of Object.entries(esperado)) {
      const src = readFileSync(join(RAIZ, `netlify/functions/rotina-${rota}.ts`), 'utf8')
      assert.match(src, new RegExp(`schedule: '${cron.replace(/\*/g, '\\*')}'`), rota)
      assert.match(src, new RegExp(`dispararRotina\\('${rota}'`), rota)
    }
    const fluxo = readFileSync(join(RAIZ, '.github/workflows/patrono-crons.yml'), 'utf8')
    assert.match(fluxo, /hora}" = "05" \]; then chamar "oportunidades"/)
    assert.match(fluxo, /hora}" = "03" \]; then chamar "ml-janela-observacao"/)
  })
})

describe('Arquitetura: nenhuma rota longa espera provider na requisição', () => {
  const ROTAS = {
    legenda: 'app/api/conteudos/[id]/adicionar-legenda/route.ts',
    publicar: 'app/api/conteudos/[id]/publicar/route.ts',
    cron: 'app/api/cron/publicar/route.ts',
    whatsapp: 'app/api/whatsapp/enviar/route.ts',
  }

  test('nenhuma das quatro rotas dorme nem consulta status em laço', () => {
    for (const [nome, rel] of Object.entries(ROTAS)) {
      const src = lerCodigo(rel)
      assert.ok(!/setTimeout/.test(src), `${nome} ainda espera dentro da requisição`)
      assert.ok(!/statusContainer|consultarStatusVideo|enviarTexto\(|enviarImagem\(|adicionarLegendaVideo\(/.test(src), `${nome} ainda chama o provider`)
      assert.match(src, /iniciarTrabalhoLongo\(\{/, `${nome} precisa registrar o trabalho`)
    }
  })

  test('a Background Function exige assinatura e só executa pelo claim', () => {
    const fn = lerCodigo('netlify/functions/trabalho-longo-background.ts')
    assert.match(fn, /if \(!disparoAutentico\(corpo\.jobId, corpo\.assinatura\)\)/)
    assert.match(fn, /executarTrabalhoLongo\(/)
    assert.ok(CAMINHO_DA_FUNCAO.endsWith('/trabalho-longo-background'), 'o caminho do disparo é o do arquivo')
    assert.ok(readdirSync(join(RAIZ, 'netlify/functions')).includes('trabalho-longo-background.ts'))
  })

  test('o núcleo nunca agenda retry automático nem expõe trabalho à fila genérica', () => {
    const src = lerCodigo('lib/trabalho-longo.ts')
    // proximaTentativaEm só é escrito como null.
    for (const m of src.matchAll(/proximaTentativaEm: ([^,\n]+)/g)) assert.equal(m[1].trim(), 'null')
    // Todo PENDING nasce/volta reservado.
    assert.match(src, /estado: 'PENDING',[\s\S]{0,200}?workerId: RESERVA_DO_SEGUNDO_PLANO/)
    // Exceção não tratada vira INCERTO, não falha repetível.
    assert.match(src, /\.catch\(\(e\): Desfecho => \{[\s\S]*?fim: 'incerto'/)
  })

  test('a fase PUBLICANDO é gravada antes do media_publish, e reencontrá-la é incerto', () => {
    const ex = lerCodigo('lib/trabalhos-longos/publicar-instagram.ts')
    assert.ok(ex.indexOf("await e.salvar({ fase: 'PUBLICANDO' })") < ex.indexOf('await dep.publicarContainer({'))
    assert.ok(ex.indexOf("await e.salvar({ mediaId, fase: 'PUBLICADO' })") > ex.indexOf('await dep.publicarContainer({'))
    assert.match(ex, /if \(ctx\.fase === 'PUBLICANDO'\) \{[\s\S]*?fim: 'incerto'/)
  })
})

describe('Tela: respostaFinal acompanha o trabalho até o fim', () => {
  const resposta = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status })
  const semEspera = async () => {}

  test('resposta direta passa intacta', async () => {
    const r = await respostaFinal(resposta({ ok: true, mediaId: 'm' }))
    assert.deepEqual(r, { ok: true, status: 200, data: { ok: true, mediaId: 'm' } })
    const e = await respostaFinal(resposta({ error: 'x' }, 409))
    assert.equal(e.ok, false)
  })

  test('202 processando: consulta até terminar e devolve o corpo final', async () => {
    let n = 0
    const buscar = (async (url: string) => {
      assert.equal(url, '/api/trabalhos/t1')
      n++
      return resposta(
        n < 3
          ? { terminado: false, resposta: { status: 202, corpo: { processando: true, resultados: [n] } } }
          : { terminado: true, resposta: { status: 200, corpo: { ok: true, enviados: 2 } } }
      )
    }) as unknown as typeof fetch
    const parciais: unknown[] = []
    const r = await respostaFinal(resposta({ ok: false, processando: true, trabalhoId: 't1' }, 202), {
      buscar, dormir: semEspera, aoAtualizar: (p) => parciais.push(p),
    })
    assert.deepEqual(r, { ok: true, status: 200, data: { ok: true, enviados: 2 } })
    assert.equal(n, 3)
    assert.ok(parciais.length >= 2)
  })

  test('incerto termina como falha visível, não como sucesso', async () => {
    const buscar = (async () => resposta({ terminado: true, resposta: { status: 409, corpo: { error: 'confira', incerto: true } } })) as unknown as typeof fetch
    const r = await respostaFinal(resposta({ processando: true, trabalhoId: 't2' }, 202), { buscar, dormir: semEspera })
    assert.equal(r.ok, false)
    assert.equal(r.data.incerto, true)
  })

  test('esgotada a espera da tela, diz que segue no servidor', async () => {
    const buscar = (async () => resposta({ terminado: false, resposta: null })) as unknown as typeof fetch
    const r = await respostaFinal(resposta({ processando: true, trabalhoId: 't3' }, 202), { buscar, dormir: semEspera, esperaMaximaMs: 0 })
    assert.equal(r.data.processando, true)
  })
})

// ── 2. Banco de teste ───────────────────────────────────────────────────

const TEM_BANCO = !!process.env.DATABASE_URL
const marca = `r51-${Date.now()}`
const criados: string[] = []
let wsA = ''
let wsB = ''
let userA = ''
let produtoA = ''
let integracaoWa = ''

const semEspera = async () => {}
const ORIGEM = 'https://teste.invalido'

async function novoConteudo(over: Record<string, unknown> = {}) {
  return (
    await prisma.conteudo.create({
      data: {
        workspaceId: wsA, userId: userA, produtoId: produtoA, roteiro: 'x', redeSocial: 'instagram',
        legendaInstagram: 'Legenda aprovada #publi', videoUrl: 'https://midia.invalido/v.mp4', narracao: 'Texto da narração.',
        ...over,
      },
      select: { id: true },
    })
  ).id
}

/** Dublê da Meta: conta cada chamada. Nunca toca rede. */
function metaFalsa(over: Partial<DependenciasDaPublicacao> = {}) {
  const chamadas = { container: 0, status: 0, publish: 0, porta: 0 }
  const dep: DependenciasDaPublicacao = {
    autorizar: async () => { chamadas.porta++; return { liberada: true, bloqueio: null, explicacao: 'ok', preflight: null } as never },
    criarContainerReel: async () => { chamadas.container++; return `cont-${chamadas.container}` },
    criarContainerStoryVideo: async () => { throw new Error('não usado') },
    criarContainerImagemFeed: async () => { throw new Error('não usado') },
    criarContainerStoryImagem: async () => { throw new Error('não usado') },
    criarContainerCarrossel: async () => { throw new Error('não usado') },
    statusContainer: async () => { chamadas.status++; return 'FINISHED' },
    publicarContainer: async () => { chamadas.publish++; return `media-${chamadas.publish}` },
    ...over,
  }
  return { dep, chamadas }
}

function pedidoDePublicacao(conteudoId: string, chaveDaTentativa = `${marca}:${conteudoId}`) {
  return {
    chave: chaveDaPublicacao({ chaveDaTentativa }),
    contexto: { pedido: { conteudoId, tipoMidia: 'video', destino: 'feed', chaveDaTentativa, origem: 'manual' } },
  }
}

const iniciar = (p: { chave: string; contexto: Record<string, unknown>; tipo?: 'LONGO_PUBLICAR_INSTAGRAM' | 'LONGO_ENVIO_WHATSAPP' | 'LONGO_LEGENDA_VIDEO'; entityId: string; entityType?: string; executor: ExecutorDeTrabalho; orcamentoMs?: number; workspaceId?: string; modo?: 'segundo-plano' | 'na-requisicao'; enviar?: typeof fetch }) =>
  iniciarTrabalhoLongo({
    workspaceId: p.workspaceId ?? wsA,
    tipo: p.tipo ?? 'LONGO_PUBLICAR_INSTAGRAM',
    chave: p.chave,
    entityType: p.entityType ?? (p.tipo === 'LONGO_ENVIO_WHATSAPP' ? 'INTEGRACAO' : 'CONTEUDO'),
    entityId: p.entityId,
    contexto: p.contexto,
    executor: p.executor,
    origem: ORIGEM,
    mensagemDeProcessando: 'processando',
    modo: p.modo ?? 'na-requisicao',
    orcamentoMs: p.orcamentoMs ?? 60_000,
    dormir: semEspera,
    enviar: p.enviar,
  })

describe(
  'Trabalhos longos contra o banco de teste',
  { skip: !TEM_BANCO ? 'DATABASE_URL ausente — exige Postgres' : false },
  () => {
    before(async () => {
      // Trava opcional: com a referência do projeto de produção no ambiente
      // (nunca no repositório), o teste se recusa a rodar contra ele.
      const refProducao = process.env.PATRONO_REF_DO_BANCO_DE_PRODUCAO
      if (refProducao && (process.env.DATABASE_URL ?? '').includes(refProducao)) throw new Error('Este teste nunca roda contra o banco de produção.')
      for (const n of ['A', 'B']) {
        const ws = await prisma.workspace.create({ data: { name: `R51-${n}`, ownerId: `${marca}-${n}` }, select: { id: true } })
        criados.push(ws.id)
      }
      ;[wsA, wsB] = criados
      userA = (await prisma.user.create({ data: { email: `${marca}-a@teste.local`, name: 'U', password: 'x', workspaceId: wsA }, select: { id: true } })).id
      produtoA = (
        await prisma.produto.create({
          data: { workspaceId: wsA, userId: userA, nome: `${marca}-p`, categoria: 'x', tipoVenda: 'Afiliado', origemConteudo: 'Proprio', linkProduto: 'https://loja.invalido/p' },
          select: { id: true },
        })
      ).id
      // Credenciais FICTÍCIAS: os dublês nunca as usam para falar com ninguém.
      await prisma.integracao.create({
        data: { workspaceId: wsA, userId: userA, plataforma: 'instagram', status: 'conectado', accessToken: 'IG-FICTICIO', accountId: 'ig-ficticio' },
      })
      integracaoWa = (
        await prisma.integracao.create({
          data: { workspaceId: wsA, userId: userA, plataforma: 'whatsapp', status: 'conectado', accessToken: 'ZAPI-FICTICIO', accountId: 'inst-ficticia' },
          select: { id: true },
        })
      ).id
    })

    after(async () => {
      for (const ws of criados) {
        await prisma.mLFeatureSnapshot.deleteMany({ where: { workspaceId: ws } })
        await prisma.linkDinamico.updateMany({ where: { workspaceId: ws }, data: { publicacaoId: null } })
        await prisma.auditLog.deleteMany({ where: { workspaceId: ws } })
        await prisma.eventoLink.deleteMany({ where: { workspaceId: ws } })
        await prisma.linkDinamico.deleteMany({ where: { workspaceId: ws } })
        await prisma.publicacao.deleteMany({ where: { workspaceId: ws } })
        await prisma.automationJob.deleteMany({ where: { workspaceId: ws } })
        await prisma.integracao.deleteMany({ where: { workspaceId: ws } })
        await prisma.conteudo.deleteMany({ where: { workspaceId: ws } })
        await prisma.produto.deleteMany({ where: { workspaceId: ws } })
        await prisma.user.deleteMany({ where: { workspaceId: ws } })
      }
      await prisma.workspace.deleteMany({ where: { id: { in: criados } } })
      await prisma.$disconnect()
    })

    // ── Publicação ────────────────────────────────────────────────────

    test('revisão P2.72 (MÉDIA 1/2): peça assistida — container de outro arquivo não é reaproveitado; legenda fora do aprovado é recusada', async () => {
      const { createHash } = await import('node:crypto')
      const { hashDoTexto } = await import('../lib/arquivo-aprovado-vinculo')
      const A = createHash('sha256').update('arquivo-A').digest('hex')
      const B = createHash('sha256').update('arquivo-B').digest('hex')
      const host = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://proj.invalido'
      if (!process.env.NEXT_PUBLIC_SUPABASE_URL) process.env.NEXT_PUBLIC_SUPABASE_URL = host
      const urlDe = (s: string) => `${host}/storage/v1/object/sign/midias-privadas/${wsA}/aprovados/${s}.mp4?token=t`
      const vinculo = (s: string, texto = 'Legenda aprovada #publi') => async () => ({ aplica: true as const, sha256: s, caminho: `${wsA}/aprovados/${s}.mp4`, textoSha256: hashDoTexto(texto) })
      const publicados: string[] = []
      const caso = async (videoRequestId: string | null, legendaAprovada?: string) => {
        const c = await novoConteudo({ videoUrl: urlDe(A), videoRequestId })
        const { dep, chamadas } = metaFalsa({
          vinculoDoArquivo: vinculo(A, legendaAprovada),
          urlDoArquivoAprovado: async (v) => urlDe(v.sha256),
          publicarContainer: async (x) => { chamadas.publish++; publicados.push(x.containerId); return `media-${publicados.length}` },
        })
        const r = await iniciar({ ...pedidoDePublicacao(c, `${marca}:${c}:p272`), entityId: c, executor: executorDaPublicacao(dep) })
        return { r, chamadas }
      }
      // container criado com o arquivo B (versão anterior) → cria um NOVO com o A
      const v1 = await caso(`ig:cont-velho@${B}`)
      assert.equal(v1.r.estado, 'SUCCEEDED')
      assert.equal(v1.chamadas.container, 1)
      assert.notEqual(publicados.at(-1), 'cont-velho')
      // container sem sha (anterior à P2.72) → também não é reaproveitado
      const v2 = await caso('ig:cont-legado')
      assert.equal(v2.chamadas.container, 1)
      assert.notEqual(publicados.at(-1), 'cont-legado')
      // container do MESMO arquivo aprovado → reaproveitado
      const v3 = await caso(`ig:cont-mesmo@${A}`)
      assert.equal(v3.chamadas.container, 0)
      assert.equal(publicados.at(-1), 'cont-mesmo')
      // legenda da peça diferente do texto aprovado → recusa antes de falar com a Meta
      const v4 = await caso(null, 'Outro texto aprovado')
      assert.equal(v4.r.resposta.status, 409)
      assert.match(String(v4.r.resposta.corpo.error), /texto aprovado/)
      assert.equal(v4.chamadas.container + v4.chamadas.publish, 0)
    })

    test('publica uma vez; o mesmo pedido de novo devolve o mesmo resultado sem tocar na Meta', async () => {
      const c = await novoConteudo()
      const { dep, chamadas } = metaFalsa()
      const p = pedidoDePublicacao(c)
      const r1 = await iniciar({ ...p, entityId: c, executor: executorDaPublicacao(dep) })
      assert.equal(r1.estado, 'SUCCEEDED')
      assert.equal(r1.resposta.status, 200)
      assert.equal(r1.resposta.corpo.mediaId, 'media-1')
      const conteudo = await prisma.conteudo.findUnique({ where: { id: c } })
      assert.equal(conteudo?.status, 'publicado')
      assert.equal(conteudo?.publicacaoExternaId, 'media-1')

      const r2 = await iniciar({ ...p, entityId: c, executor: executorDaPublicacao(dep) })
      assert.equal(r2.trabalhoId, r1.trabalhoId, 'mesmo pedido, mesmo trabalho')
      assert.equal(r2.resposta.corpo.mediaId, 'media-1')
      assert.equal(chamadas.publish, 1, 'a Meta recebeu UM media_publish')
      assert.equal(chamadas.container, 1)
      assert.ok(chamadas.porta >= 2, 'a porta é conferida antes do container e antes do publish')
    })

    test('media_publish sem resposta (rede) é INCERTO e nunca é repetido', async () => {
      const c = await novoConteudo()
      const { dep, chamadas } = metaFalsa({
        publicarContainer: async () => { chamadas.publish++; throw new TypeError('fetch failed') },
      })
      const p = pedidoDePublicacao(c)
      const r1 = await iniciar({ ...p, entityId: c, executor: executorDaPublicacao(dep) })
      assert.equal(r1.estado, 'WAITING')
      assert.equal(r1.resposta.corpo.incerto, true)
      const job = await prisma.automationJob.findUnique({ where: { id: r1.trabalhoId } })
      assert.equal(job?.classe, 'EXIGE_HUMANO')
      assert.equal(job?.motivoHumano, MOTIVO_HUMANO_DO_INCERTO)
      assert.equal(job?.proximaTentativaEm, null)

      const r2 = await iniciar({ ...p, entityId: c, executor: executorDaPublicacao(dep) })
      assert.equal(r2.estado, 'WAITING')
      assert.equal(chamadas.publish, 1, 'repetir às cegas é como nasce o post duplicado')
      const conteudo = await prisma.conteudo.findUnique({ where: { id: c } })
      assert.notEqual(conteudo?.status, 'publicado')
      assert.match(conteudo?.erroPublicacao ?? '', /confira o perfil/i)
    })

    test('5xx da Meta no media_publish também é incerto', async () => {
      const c = await novoConteudo()
      const { dep, chamadas } = metaFalsa({
        publicarContainer: async () => { chamadas.publish++; throw new ErroDaApiInstagram('Service unavailable', 503, true) },
      })
      const r = await iniciar({ ...pedidoDePublicacao(c), entityId: c, executor: executorDaPublicacao(dep) })
      assert.equal(r.estado, 'WAITING')
    })

    test('recusa explícita da Meta (4xx) é repetível a pedido — e a repetição publica uma vez', async () => {
      const c = await novoConteudo()
      let recusar = true
      const { dep, chamadas } = metaFalsa({
        publicarContainer: async () => {
          chamadas.publish++
          if (recusar) throw new ErroDaApiInstagram('Media ID is not available', 400, true)
          return 'media-ok'
        },
      })
      const p = pedidoDePublicacao(c)
      const r1 = await iniciar({ ...p, entityId: c, executor: executorDaPublicacao(dep) })
      assert.equal(r1.estado, 'FAILED_RETRYABLE')
      const job = await prisma.automationJob.findUnique({ where: { id: r1.trabalhoId } })
      assert.equal(job?.proximaTentativaEm, null, 'nenhum retry automático agendado')

      recusar = false
      const r2 = await iniciar({ ...p, entityId: c, executor: executorDaPublicacao(dep) })
      assert.equal(r2.estado, 'SUCCEEDED')
      assert.equal(r2.resposta.corpo.mediaId, 'media-ok')
      assert.equal(chamadas.container, 1, 'o container da tentativa recusada foi reaproveitado')
    })

    test('execução interrompida no media_publish: a retomada é INCERTA e não chama a Meta', async () => {
      const c = await novoConteudo()
      const p = pedidoDePublicacao(c)
      // Como a Background Function deixaria o banco se morresse no meio.
      const job = await prisma.automationJob.create({
        data: {
          workspaceId: wsA, tipo: 'LONGO_PUBLICAR_INSTAGRAM', chave: p.chave, estado: 'RUNNING', classe: 'TENTANDO',
          entityType: 'CONTEUDO', entityId: c, workerId: 'segundo-plano:morto',
          heartbeatAt: new Date(Date.now() - 10 * 60_000),
          contexto: { ...p.contexto, containerId: 'cont-x', fase: 'PUBLICANDO', origem: ORIGEM },
        },
      })
      const { dep, chamadas } = metaFalsa()
      const r = await iniciar({ ...p, entityId: c, executor: executorDaPublicacao(dep) })
      assert.equal(r.trabalhoId, job.id)
      assert.equal(r.estado, 'WAITING')
      assert.equal(chamadas.publish, 0)
      assert.equal(chamadas.container, 0)
    })

    test('RUNNING com heartbeat em dia não ganha segunda execução', async () => {
      const c = await novoConteudo()
      const p = pedidoDePublicacao(c)
      await prisma.automationJob.create({
        data: {
          workspaceId: wsA, tipo: 'LONGO_PUBLICAR_INSTAGRAM', chave: p.chave, estado: 'RUNNING', classe: 'TENTANDO',
          entityType: 'CONTEUDO', entityId: c, workerId: 'segundo-plano:vivo', heartbeatAt: new Date(), contexto: p.contexto,
        },
      })
      const { dep, chamadas } = metaFalsa()
      const r = await iniciar({ ...p, entityId: c, executor: executorDaPublicacao(dep) })
      assert.equal(r.resposta.status, 202)
      assert.equal(r.resposta.corpo.processando, true)
      assert.equal(chamadas.container + chamadas.publish, 0)
    })

    test('Meta ainda processando: o trabalho CONTINUA, reservado e invisível para a fila genérica', async () => {
      const c = await novoConteudo()
      const { dep, chamadas } = metaFalsa({ statusContainer: async () => 'IN_PROGRESS' })
      const p = pedidoDePublicacao(c)
      // Orçamento curto: não sobra tempo nem para uma consulta.
      const r = await iniciar({ ...p, entityId: c, executor: executorDaPublicacao(dep), orcamentoMs: 1_000 })
      assert.equal(r.estado, 'PENDING')
      assert.equal(r.resposta.corpo.processando, true)
      const job = await prisma.automationJob.findUnique({ where: { id: r.trabalhoId } })
      assert.equal(job?.workerId, RESERVA_DO_SEGUNDO_PLANO)
      assert.equal((job?.contexto as Record<string, unknown>).containerId, 'cont-1', 'o container ficou gravado para a retomada')

      // O claim genérico (executar-fila) não pode pegar trabalho longo.
      const pego = await portaPrisma().reivindicar(wsA, 'executor-generico', new Date())
      assert.ok(!pego || !pego.tipo.startsWith('LONGO_'), 'a fila genérica reivindicou um trabalho longo')

      // A retomada usa o MESMO container.
      const { dep: dep2, chamadas: ch2 } = metaFalsa()
      const r2 = await iniciar({ ...p, entityId: c, executor: executorDaPublicacao(dep2) })
      assert.equal(r2.estado, 'SUCCEEDED')
      assert.equal(ch2.container, 0)
      assert.equal(ch2.publish, 1)
      assert.equal(chamadas.publish, 0)
    })

    test('dois disparos simultâneos: só um executa', async () => {
      const c = await novoConteudo()
      const p = pedidoDePublicacao(c)
      const job = await prisma.automationJob.create({
        data: {
          workspaceId: wsA, tipo: 'LONGO_PUBLICAR_INSTAGRAM', chave: p.chave, estado: 'PENDING', classe: 'TENTANDO',
          entityType: 'CONTEUDO', entityId: c, workerId: RESERVA_DO_SEGUNDO_PLANO, contexto: p.contexto,
        },
      })
      const { dep, chamadas } = metaFalsa()
      const executores = { LONGO_PUBLICAR_INSTAGRAM: executorDaPublicacao(dep) }
      const [a, b] = await Promise.all([
        executarTrabalhoLongo(job.id, { executores, orcamentoMs: 60_000, modo: 'na-requisicao', dormir: semEspera }),
        executarTrabalhoLongo(job.id, { executores, orcamentoMs: 60_000, modo: 'na-requisicao', dormir: semEspera }),
      ])
      assert.equal([a, b].filter(Boolean).length, 1, 'exatamente um vence o claim')
      assert.equal(chamadas.publish, 1)
    })

    test('em segundo plano: registra, dispara assinado e responde 202 — a função executa depois', async () => {
      const c = await novoConteudo()
      const p = pedidoDePublicacao(c)
      let disparo: { url: string; body: { jobId: string; assinatura: string } } | null = null
      const enviar = (async (url: string, init: RequestInit) => {
        disparo = { url, body: JSON.parse(String(init.body)) }
        return new Response(null, { status: 202 })
      }) as unknown as typeof fetch
      const { dep, chamadas } = metaFalsa()
      const r = await iniciar({ ...p, entityId: c, executor: executorDaPublicacao(dep), modo: 'segundo-plano', enviar })
      assert.equal(r.resposta.status, 202)
      assert.equal(chamadas.container, 0, 'nada da Meta dentro da requisição')
      assert.equal(disparo!.url, `${ORIGEM}${CAMINHO_DA_FUNCAO}`)
      assert.equal(disparo!.body.jobId, r.trabalhoId)
      assert.equal(disparoAutentico(disparo!.body.jobId, disparo!.body.assinatura), true)

      // O que a Background Function faria ao receber o disparo:
      const fim = await executarTrabalhoLongo(r.trabalhoId, {
        executores: { LONGO_PUBLICAR_INSTAGRAM: executorDaPublicacao(dep) },
        orcamentoMs: 60_000, modo: 'segundo-plano', dormir: semEspera,
      })
      assert.equal(fim?.estado, 'SUCCEEDED')
      // Disparo repetido depois do fim: inofensivo.
      const deNovo = await executarTrabalhoLongo(r.trabalhoId, {
        executores: { LONGO_PUBLICAR_INSTAGRAM: executorDaPublicacao(dep) }, orcamentoMs: 60_000, dormir: semEspera,
      })
      assert.equal(deNovo, null)
      assert.equal(chamadas.publish, 1)
    })

    test('a porta fechada no fim impede o media_publish', async () => {
      const c = await novoConteudo()
      let n = 0
      const { dep, chamadas } = metaFalsa({
        autorizar: async () => ({ liberada: ++n === 1, bloqueio: n === 1 ? null : 'FLAG_DESLIGADA', explicacao: 'flag desligada', preflight: null }) as never,
      })
      const r = await iniciar({ ...pedidoDePublicacao(c), entityId: c, executor: executorDaPublicacao(dep) })
      assert.equal(r.estado, 'FAILED_RETRYABLE')
      assert.equal(chamadas.publish, 0)
    })

    test('trabalho para entidade de OUTRO workspace é recusado antes de existir', async () => {
      const c = await novoConteudo()
      const { dep, chamadas } = metaFalsa()
      await assert.rejects(
        iniciar({ ...pedidoDePublicacao(c, `${marca}:alheio`), entityId: c, workspaceId: wsB, executor: executorDaPublicacao(dep) }),
        /Trabalho recusado/
      )
      assert.equal(await prisma.automationJob.count({ where: { workspaceId: wsB } }), 0)
      assert.equal(chamadas.porta + chamadas.container, 0)
    })

    test('a consulta de status é escopada pelo workspace', async () => {
      const c = await novoConteudo()
      const { dep } = metaFalsa()
      const r = await iniciar({ ...pedidoDePublicacao(c), entityId: c, executor: executorDaPublicacao(dep) })
      const minha = await situacaoDoTrabalho({ workspaceId: wsA, trabalhoId: r.trabalhoId, origem: ORIGEM })
      assert.equal(minha?.terminado, true)
      assert.equal(minha?.resposta?.status, 200)
      assert.equal(await situacaoDoTrabalho({ workspaceId: wsB, trabalhoId: r.trabalhoId, origem: ORIGEM }), null)
    })

    // ── WhatsApp ──────────────────────────────────────────────────────

    // P2.11: o envio só roda em ambiente local/teste declarado; estes
    // testes exercitam o executor nesse ambiente controlado.
    const AMBIENTE_DE_TESTE = { NODE_ENV: 'test' }

    const zapiFalsa = (comportamento: (numero: string) => { ok: boolean; erro?: string; incerto?: boolean }) => {
      const envios: string[] = []
      const dep: DependenciasDoEnvio = {
        enviarTexto: async (_cfg, p) => { envios.push(p.numero); return { numero: p.numero, ...comportamento(p.numero) } },
        enviarImagem: async (_cfg, p) => { envios.push(p.numero); return { numero: p.numero, ...comportamento(p.numero) } },
      }
      return { dep, envios }
    }
    const pedidoWa = (numeros: string[]) => {
      const pedido = { numeros, mensagem: `${marca} oi`, delayMs: 1500 }
      return { chave: chaveDoEnvio(pedido, new Date()), contexto: { pedido } }
    }

    test('WhatsApp: cada número recebe uma vez; o incerto não é reenviado', async () => {
      const nums = ['5511900000001', '5511900000002', '5511900000003']
      const { dep, envios } = zapiFalsa((n) => (n.endsWith('2') ? { ok: false, erro: 'fetch failed', incerto: true } : { ok: true }))
      const p = pedidoWa(nums)
      const r = await iniciar({ ...p, tipo: 'LONGO_ENVIO_WHATSAPP', entityId: integracaoWa, executor: executorDoEnvio(dep, AMBIENTE_DE_TESTE) })
      assert.equal(r.estado, 'WAITING', 'há envio sem confirmação: uma pessoa olha')
      assert.equal(r.resposta.corpo.enviados, 2)
      assert.equal(r.resposta.corpo.incertos, 1)
      assert.deepEqual(envios, nums)

      await iniciar({ ...p, tipo: 'LONGO_ENVIO_WHATSAPP', entityId: integracaoWa, executor: executorDoEnvio(dep, AMBIENTE_DE_TESTE) })
      assert.deepEqual(envios, nums, 'nenhuma mensagem saiu duas vezes')
    })

    test('WhatsApp: orçamento acaba no meio — retoma só os que faltam', async () => {
      const nums = ['5511900000011', '5511900000012', '5511900000013']
      const { dep, envios } = zapiFalsa(() => ({ ok: true }))
      const p = pedidoWa(nums)
      // Sem orçamento: nenhum envio cabe.
      const r1 = await iniciar({ ...p, tipo: 'LONGO_ENVIO_WHATSAPP', entityId: integracaoWa, executor: executorDoEnvio(dep, AMBIENTE_DE_TESTE), orcamentoMs: 0 })
      assert.equal(r1.estado, 'PENDING')
      assert.equal(envios.length, 0)
      const r2 = await iniciar({ ...p, tipo: 'LONGO_ENVIO_WHATSAPP', entityId: integracaoWa, executor: executorDoEnvio(dep, AMBIENTE_DE_TESTE) })
      assert.equal(r2.estado, 'SUCCEEDED')
      assert.deepEqual(envios, nums)
    })

    test('WhatsApp: execução que morreu com mensagem no caminho marca o número como incerto', async () => {
      const nums = ['5511900000021', '5511900000022']
      const p = pedidoWa(nums)
      await prisma.automationJob.create({
        data: {
          workspaceId: wsA, tipo: 'LONGO_ENVIO_WHATSAPP', chave: p.chave, estado: 'RUNNING', classe: 'TENTANDO',
          entityType: 'INTEGRACAO', entityId: integracaoWa, workerId: 'segundo-plano:morto',
          heartbeatAt: new Date(Date.now() - 10 * 60_000),
          contexto: { ...p.contexto, emEnvio: nums[0], resultados: {}, origem: ORIGEM },
        },
      })
      const { dep, envios } = zapiFalsa(() => ({ ok: true }))
      const r = await iniciar({ ...p, tipo: 'LONGO_ENVIO_WHATSAPP', entityId: integracaoWa, executor: executorDoEnvio(dep, AMBIENTE_DE_TESTE) })
      assert.deepEqual(envios, [nums[1]], 'o número que estava no caminho não recebeu de novo')
      assert.equal(r.estado, 'WAITING')
      assert.equal(r.resposta.corpo.incertos, 1)
    })

    // ── Legenda ───────────────────────────────────────────────────────

    const falFalso = (over: Partial<DependenciasDaLegenda> = {}) => {
      const chamadas = { submeter: 0, consultar: 0 }
      const dep: DependenciasDaLegenda = {
        submeter: async () => { chamadas.submeter++; return { requestId: 'r', statusUrl: 'https://fal.invalido/s', resultUrl: 'https://fal.invalido/r' } },
        consultar: async () => { chamadas.consultar++; return { status: 'COMPLETED' } as never },
        resultado: async () => ({ videoUrl: 'https://fal.invalido/legendado.mp4' }),
        guardarVideo: async () => 'https://storage.invalido/legendado.mp4',
        ...over,
      }
      return { dep, chamadas }
    }
    const pedidoLeg = (c: string) => {
      const pedido = { conteudoId: c, userId: userA, preset: 'glass', videoUrl: `https://midia.invalido/${c}.mp4`, srt: '1\n00:00:00,000 --> 00:00:02,000\nOi\n' }
      return { chave: chaveDaLegenda(pedido), contexto: { pedido } }
    }

    test('legenda: submete uma vez e grava o vídeo legendado', async () => {
      const c = await novoConteudo()
      const { dep, chamadas } = falFalso()
      const p = pedidoLeg(c)
      const r = await iniciar({ ...p, tipo: 'LONGO_LEGENDA_VIDEO', entityId: c, executor: executorDaLegenda(dep) })
      assert.equal(r.estado, 'SUCCEEDED')
      assert.equal((await prisma.conteudo.findUnique({ where: { id: c } }))?.videoUrl, 'https://storage.invalido/legendado.mp4')
      await iniciar({ ...p, tipo: 'LONGO_LEGENDA_VIDEO', entityId: c, executor: executorDaLegenda(dep) })
      assert.equal(chamadas.submeter, 1)
    })

    test('legenda bloqueada por custo devolve o SRT e pode ser pedida de novo', async () => {
      const c = await novoConteudo()
      const { dep, chamadas } = falFalso({
        submeter: async () => { chamadas.submeter++; throw new BloqueadoPorPoliticaDeCusto('fal.ai', 'adicionar-legenda', null, 'custo zero') },
      })
      const r = await iniciar({ ...pedidoLeg(c), tipo: 'LONGO_LEGENDA_VIDEO', entityId: c, executor: executorDaLegenda(dep) })
      assert.equal(r.estado, 'FAILED_RETRYABLE')
      assert.equal(r.resposta.status, 402)
      assert.equal(r.resposta.corpo.bloqueadoPorCusto, true)
      assert.ok(String(r.resposta.corpo.srt).includes('Oi'))
    })

    test('legenda: submissão sem resposta é incerta — não paga duas vezes', async () => {
      const c = await novoConteudo()
      const { dep, chamadas } = falFalso({
        submeter: async () => { chamadas.submeter++; throw new TypeError('fetch failed') },
      })
      const p = pedidoLeg(c)
      const r = await iniciar({ ...p, tipo: 'LONGO_LEGENDA_VIDEO', entityId: c, executor: executorDaLegenda(dep) })
      assert.equal(r.estado, 'WAITING')
      await iniciar({ ...p, tipo: 'LONGO_LEGENDA_VIDEO', entityId: c, executor: executorDaLegenda(dep) })
      assert.equal(chamadas.submeter, 1)
    })

    test('legenda: recusa 4xx do fal.ai é repetível a pedido', async () => {
      const c = await novoConteudo()
      let recusar = true
      const { dep, chamadas } = falFalso({
        submeter: async () => {
          chamadas.submeter++
          if (recusar) throw new RespostaDeErroDoFal('vídeo inválido', 422)
          return { requestId: 'r', statusUrl: 'https://fal.invalido/s', resultUrl: 'https://fal.invalido/r' }
        },
      })
      const p = pedidoLeg(c)
      assert.equal((await iniciar({ ...p, tipo: 'LONGO_LEGENDA_VIDEO', entityId: c, executor: executorDaLegenda(dep) })).estado, 'FAILED_RETRYABLE')
      recusar = false
      assert.equal((await iniciar({ ...p, tipo: 'LONGO_LEGENDA_VIDEO', entityId: c, executor: executorDaLegenda(dep) })).estado, 'SUCCEEDED')
      assert.equal(chamadas.submeter, 2)
    })

    test('buscarTrabalho ignora o que não é trabalho longo', async () => {
      const outro = await prisma.automationJob.create({
        data: { workspaceId: wsA, tipo: 'GERAR_CONTEUDO', chave: `${marca}-generico`, estado: 'PENDING', classe: 'AUTOMATIZAVEL', entityType: 'PRODUTO', entityId: produtoA },
      })
      assert.equal(await buscarTrabalho(outro.id), null)
    })
  }
)
