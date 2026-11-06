/**
 * P2.35 — MÍDIA PRIVADA antes da aprovação (pacote mínimo sobre o RC de Production).
 *
 * Trava: originais e prévias no bucket PRIVADO `midias-privadas` (originais/ e previas/, por workspace);
 * referência guardada = endereço AUTENTICADO do storage (não abre sem credencial; passa na custódia própria);
 * link assinado só na RESPOSTA à usuária do próprio workspace (outro workspace → null); sem cache; o link
 * VENCE; nada vai para bucket público; vídeo privado nunca vai pela API de publicação; ajuste gera nova prévia
 * privada; mídia pública antiga continua funcionando (compatibilidade). Só material SINTÉTICO.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  refPrivada, caminhoDaRefPrivada, ehRefPrivada, pertenceAoWorkspace, caminhoDoOriginal, caminhoDaPrevia,
  assinarMidiasPrivadasNaResposta, definirPortasDaMidiaPrivada, BUCKET_MIDIA_PRIVADA,
} from '../lib/midia-privada'
import { emCustodiaPropria } from '../lib/evidencia-de-midia'
// P2.45: este arquivo testa o fluxo de publicação ANTERIOR aos três controles (técnico, comercial, conformidade).
process.env.PATRONO_TESTE_LEGADO_SEM_TRES_CONTROLES = 'true'

const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')
const TEM_STORAGE = !!process.env.SUPABASE_SERVICE_ROLE_KEY && (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').includes('ref-teste-exemplo')
const ENV = { NEXT_PUBLIC_SUPABASE_URL: 'https://projeto.supabase.co' }
const ff = (): string => require('ffmpeg-static') as string

describe('P2.35 — puro', () => {
  test('referência privada: ida e volta; recusa outros endereços e caminhos maliciosos', () => {
    const c = caminhoDoOriginal({ workspaceId: 'ws_A', candidatoId: 'cand-1', tipo: 'image/jpeg', agora: new Date(0), aleatorio: 'x' })
    assert.equal(c, 'originais/ws-ws_A/cand-1/0-x.jpg')
    const r = refPrivada(c, ENV)
    assert.equal(r, 'https://projeto.supabase.co/storage/v1/object/authenticated/midias-privadas/originais/ws-ws_A/cand-1/0-x.jpg')
    assert.equal(caminhoDaRefPrivada(r, ENV), c)
    assert.equal(caminhoDaRefPrivada('https://projeto.supabase.co/storage/v1/object/public/imagens/a.jpg', ENV), null, 'público não é privado')
    assert.equal(caminhoDaRefPrivada('https://outro.supabase.co/storage/v1/object/authenticated/midias-privadas/originais/ws-x/a.jpg', ENV), null, 'outro projeto')
    assert.equal(caminhoDaRefPrivada(refPrivada('originais/../segredo', ENV), ENV), null, 'sem ..')
    assert.equal(ehRefPrivada(r, ENV), true)
  })

  test('isolamento: o caminho só pertence ao próprio workspace; separação originais/previas', () => {
    assert.equal(pertenceAoWorkspace('originais/ws-ws_A/c/1.jpg', 'ws_A'), true)
    assert.equal(pertenceAoWorkspace('originais/ws-ws_A/c/1.jpg', 'ws_B'), false)
    assert.equal(pertenceAoWorkspace('outra-coisa/ws-ws_A/c/1.jpg', 'ws_A'), false, 'só originais/ e previas/')
    assert.match(caminhoDaPrevia({ workspaceId: 'ws_A', publicacaoId: 'pub1', versao: 2, agora: new Date(0), aleatorio: 'y' }), /^previas\/ws-ws_A\/pub1\/v2-0-y\.mp4$/)
  })

  test('a referência privada passa na custódia própria (sem mudar a regra de direitos)', () => {
    assert.equal(emCustodiaPropria(refPrivada('originais/ws-a/c/1.jpg', ENV), ENV), true)
  })

  test('na resposta: assina só o próprio workspace, anula o de outro, mantém público, não muda o original', async () => {
    const assinados: string[] = []
    definirPortasDaMidiaPrivada({ assinar: async (c, s) => { assinados.push(`${c}:${s}`); return `https://assinado/${c}?token=t` }, subir: async () => {} })
    try {
      const dados = {
        meu: refPrivada('previas/ws-ws_A/p/v1.mp4', ENV), deOutro: refPrivada('previas/ws-ws_B/p/v1.mp4', ENV),
        publico: 'https://x.supabase.co/storage/v1/object/public/videos/a.mp4', quando: new Date(0), lista: [refPrivada('previas/ws-ws_A/p/v1.mp4', ENV)],
      }
      const antes = JSON.stringify(dados)
      const r = await assinarMidiasPrivadasNaResposta(dados, 'ws_A', ENV)
      assert.equal(r.meu, 'https://assinado/previas/ws-ws_A/p/v1.mp4?token=t')
      assert.equal(r.deOutro, null, 'nunca assina caminho de outro workspace')
      assert.equal(r.publico, dados.publico)
      assert.ok(r.quando instanceof Date)
      assert.equal(r.lista[0], r.meu)
      assert.equal(assinados.length, 1, 'mesma referência → um link só')
      assert.equal(JSON.stringify(dados), antes, 'o objeto do banco não muda')
    } finally {
      definirPortasDaMidiaPrivada(null)
    }
  })

  test('erro/histórico nunca guardam o token de um link assinado', async () => {
    const { semSegredosDeLink } = await import('../lib/midia-privada')
    assert.equal(semSegredosDeLink('Não consegui baixar a mídia (HTTP 400): https://x.supabase.co/storage/v1/object/sign/midias-privadas/a.jpg?token=eyJabc.def'), 'Não consegui baixar a mídia (HTTP 400): https://x.supabase.co/storage/v1/object/sign/midias-privadas/a.jpg?token=***')
    assert.equal(semSegredosDeLink('sem link'), 'sem link')
  })

  test('Baixar o vídeo: o link temporário pede ANEXO ao storage (o celular salva); link público fica igual', async () => {
    const { linkParaBaixar } = await import('../lib/link-para-baixar')
    const sig = 'https://x.supabase.co/storage/v1/object/sign/midias-privadas/previas/ws-a/p/v1.mp4?token=abc'
    assert.equal(linkParaBaixar(sig, 'Livro Emocionário'), `${sig}&download=livro-emocionario.mp4`)
    assert.equal(linkParaBaixar(`${sig}&download=x.mp4`, 'Livro'), `${sig}&download=x.mp4`, 'não duplica')
    const pub = 'https://x.supabase.co/storage/v1/object/public/videos/a.mp4'
    assert.equal(linkParaBaixar(pub, 'Livro'), pub)
    assert.equal(linkParaBaixar(sig, '***'), `${sig}&download=video.mp4`)
    // P2.50: o pacote de publicação virou componente (components/assistido/PacoteDePublicacao.tsx) — mesma regra.
    const pagina = readFileSync(path.join(__dirname, '..', 'components', 'assistido', 'PacoteDePublicacao.tsx'), 'utf8')
    // P2.72: o botão baixa SÓ a cópia imutável do arquivo aprovado (URL assinada pela rota que confere o sha256), com a
    // mesma regra de anexo; o arquivo da geração (ap.video.arquivo) não tem mais link de download na tela
    assert.match(pagina, /fetch\(`\/api\/tiktok\/assistido\/\$\{id\}\/arquivo-aprovado`\)/)
    assert.match(pagina, /linkParaBaixar\(r\.url, nome\)/)
    assert.doesNotMatch(pagina, /linkParaBaixar\(ap\.video\.arquivo/)
    assert.doesNotMatch(readFileSync(path.join(__dirname, '..', 'lib', 'link-para-baixar.ts'), 'utf8'), /from 'node:|import /, 'roda no navegador: sem importações')
  })

  test('as rotas que entregam mídia à tela assinam e respondem SEM CACHE', () => {
    for (const f of ['app/api/operacao/route.ts', 'app/api/operacao/escolher/route.ts', 'app/api/operacao/responder/route.ts', 'app/api/tiktok/assistido/route.ts', 'app/api/precisa-de-voce/route.ts', 'app/api/midias/route.ts', 'app/api/tiktok/resultados/route.ts', 'app/api/tiktok/operacao/route.ts']) {
      const s = readFileSync(path.join(__dirname, '..', f), 'utf8')
      assert.match(s, /assinarMidiasPrivadasNaResposta/, f)
      assert.match(s, /SEM_CACHE/, f)
    }
  })
})

describe('P2.35 — banco e storage de TESTE (sintético)', { skip: !TEM_BANCO || !TEM_STORAGE ? 'exige banco e storage de TESTE' : false, timeout: 900_000 }, () => {
  let prisma: typeof import('../lib/prisma').prisma
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  let sb: import('@supabase/supabase-js').SupabaseClient
  const PREFIXO = 'Conta de Teste — '
  const marca = `r124-${Date.now()}`
  const workspaces: string[] = []
  const pasta = mkdtempSync(path.join(tmpdir(), 'r124-'))

  before(async () => {
    ;[{ prisma }, { limparWorkspaceDeTeste: limpar }] = await Promise.all([import('../lib/prisma'), import('./_limpar-workspace-de-teste')])
    const { createClient } = await import('@supabase/supabase-js')
    sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const { data } = await sb.storage.getBucket(BUCKET_MIDIA_PRIVADA)
    assert.ok(data && data.public === false, 'o bucket privado existe no TESTE e é privado')
  })
  after(async () => {
    if (prisma) for (const w of workspaces) {
      for (const pre of [`originais/ws-${w}`, `previas/ws-${w}`]) {
        const { data: subs } = await sb.storage.from(BUCKET_MIDIA_PRIVADA).list(pre)
        for (const s of subs ?? []) {
          const { data: objs } = await sb.storage.from(BUCKET_MIDIA_PRIVADA).list(`${pre}/${s.name}`)
          if (objs?.length) await sb.storage.from(BUCKET_MIDIA_PRIVADA).remove(objs.map((o) => `${pre}/${s.name}/${o.name}`))
        }
      }
      await prisma.automationJob.deleteMany({ where: { workspaceId: w } }).catch(() => null)
      await prisma.domainEvent.deleteMany({ where: { workspaceId: w } }).catch(() => null)
      await prisma.decisionRecord.deleteMany({ where: { workspaceId: w } }).catch(() => null)
      await limpar(prisma, w, PREFIXO)
    }
    await prisma?.$disconnect()
    rmSync(pasta, { recursive: true, force: true })
  })

  async function pronta(nome: string) {
    const J = await import('../lib/jornada')
    const M = await import('../lib/midia-do-produto')
    const A = await import('../lib/publicacao-assistida')
    const ws = (await prisma.workspace.create({ data: { name: `${PREFIXO}${nome} r124`, ownerId: `${marca}-${nome}` }, select: { id: true } })).id
    workspaces.push(ws)
    const u = (await prisma.user.create({ data: { email: `${marca}-${nome}@teste.local`, name: 'U', password: 'x', workspaceId: ws }, select: { id: true } })).id
    const cand = (await prisma.candidatoDeProduto.create({ data: {
      workspaceId: ws, chaveDeOrigem: `${marca}-${nome}`, fonte: 'USER_PROVIDED', nome: 'FIXTURE Livro', categoria: 'Papelaria', providerId: 'tiktok-shop', externalId: `9000000124${nome.length}`,
      linkProduto: `https://shop.tiktok.com/br/pdp/9000000124${nome.length}`, score: 50, baseDeEvidencia: 40, confianca: 'SEM_HISTORICO_REAL', status: 'NOVO', coletadoEm: new Date(), validoAte: new Date('2027-06-01'),
      compradoPelaTitular: true, motivosPositivos: [], riscos: [], desconhecidos: [], porqueDestaPosicao: [], nivelDeRisco: 'BAIXO',
    }, select: { id: true } })).id
    let v = J.visaoDaOperacao(await J.escolherProduto({ workspaceId: ws, userId: u, candidatoId: cand, emMaos: true }))
    const id = v.prioritaria!.assistida!.id
    for (const [i, cor] of ['red', 'green', 'blue'].entries()) {
      const f = path.join(pasta, `${nome}-${i}.jpg`)
      execFileSync(ff(), ['-f', 'lavfi', '-i', `color=c=${cor}:s=900x1600`, '-frames:v', '1', '-y', f], { stdio: 'ignore' })
      const caminho = caminhoDoOriginal({ workspaceId: ws, candidatoId: cand, tipo: 'image/jpeg' })
      const { error } = await sb.storage.from(BUCKET_MIDIA_PRIVADA).upload(caminho, readFileSync(f), { contentType: 'image/jpeg' })
      if (error) throw error
      const m = await M.registrarMidia({ workspaceId: ws, candidatoId: cand, nomeProduto: 'FIXTURE Livro', declaracao: { url: refPrivada(caminho), tipo: 'IMAGEM', origem: 'PROPRIO', titularidade: 'Titular da conta (eu)', direitoDeUso: 'Uso nas minhas redes', descricao: 'SINTÉTICO', declaradoPor: u, declaradoEm: new Date() } })
      assert.equal(m.status, 'AUTORIZADA', `custódia própria aceita a referência privada (${m.motivoStatus})`)
    }
    process.env.TRABALHO_LONGO_MODO = 'na-requisicao'
    await A.avancarVideo(await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id } }))
    v = J.visaoDaOperacao(await J.sincronizarOperacao({ workspaceId: ws, userId: u }))
    return { ws, u, cand, id, v }
  }

  test('ponta a ponta: originais privados → vídeo PRIVADO → link só na resposta, que vence; nada público', async () => {
    const p = await pronta('e2e')
    assert.equal(p.v.prioritaria!.acao?.tipo, 'APROVAR_VIDEO', p.v.prioritaria!.titulo)
    const a = await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id: p.id } })
    const arquivo = (a.apresentacao as { video: { arquivo: string } }).video.arquivo
    const caminho = caminhoDaRefPrivada(arquivo)
    assert.ok(caminho && caminho.startsWith(`previas/ws-${p.ws}/${p.id}/`), `prévia no privado: ${arquivo}`)
    // Sem credencial a referência não abre; o cliente anônimo não baixa.
    assert.notEqual((await fetch(arquivo)).status, 200, 'a referência guardada não é link público')
    const { createClient } = await import('@supabase/supabase-js')
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    assert.ok((await anon.storage.from(BUCKET_MIDIA_PRIVADA).download(caminho!)).error, 'visitante sem login não baixa')
    // Na resposta da Operação: link assinado (abre), nenhuma referência crua sobra.
    const resposta = await assinarMidiasPrivadasNaResposta(p.v, p.ws)
    const json = JSON.stringify(resposta)
    assert.ok(!json.includes('/object/authenticated/'), 'nenhuma referência privada crua vai para a tela')
    const link = (resposta.prioritaria!.assistida!.apresentacao as { video: { arquivo: string } }).video.arquivo
    assert.match(link, /token=/)
    const r = await fetch(link)
    assert.equal(r.status, 200)
    assert.match(r.headers.get('content-type') ?? '', /video\/mp4/)
    // Outra conta não recebe link deste arquivo.
    assert.equal((await assinarMidiasPrivadasNaResposta({ x: arquivo }, 'ws_de_outra_conta')).x, null)
    // O link vence.
    const { data: curto } = await sb.storage.from(BUCKET_MIDIA_PRIVADA).createSignedUrl(caminho!, 2)
    await new Promise((res) => setTimeout(res, 4000))
    assert.equal((await fetch(curto!.signedUrl)).status, 400, 'link vencido não abre')
    // Nada foi para os buckets públicos.
    for (const [b, pre] of [['imagens', `ws-${p.ws}`], ['videos', `ws-${p.ws}`], ['videos', `assistidas/${p.ws}`]] as const) {
      const { data } = await sb.storage.from(b).list(pre)
      assert.equal((data ?? []).length, 0, `nada público em ${b}/${pre}`)
    }
    // Mídias registradas com referência privada (originais/).
    const midias = await prisma.midiaDoProduto.findMany({ where: { workspaceId: p.ws }, select: { url: true } })
    assert.ok(midias.length === 3 && midias.every((m) => caminhoDaRefPrivada(m.url)?.startsWith(`originais/ws-${p.ws}/`)))
  })

  test('aprovar vídeo privado: fica APROVADO para publicar no app, nada vai pela API; ajuste gera nova prévia PRIVADA', async () => {
    const A = await import('../lib/publicacao-assistida')
    const p = await pronta('aprova')
    const v1 = (await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id: p.id } })).apresentacao as { video: { arquivo: string } }
    await A.pedirAjuste({ workspaceId: p.ws, userId: p.u, id: p.id, motivo: 'Teste de nova versão', alteracoes: { gancho: 'Uma ideia de presente: um livro.' } })
    await A.avancarVideo(await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id: p.id } }))
    const a2 = await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id: p.id } })
    const arquivo2 = (a2.apresentacao as { video: { arquivo: string } }).video.arquivo
    assert.equal(a2.estado, 'AGUARDANDO_APROVACAO')
    assert.ok(caminhoDaRefPrivada(arquivo2)?.startsWith(`previas/ws-${p.ws}/${p.id}/v2-`), `nova prévia privada: ${arquivo2}`)
    assert.notEqual(arquivo2, v1.video.arquivo)
    const ap = await A.aprovarEPublicar({ workspaceId: p.ws, userId: p.u, id: p.id })
    assert.equal(ap.estado, 'APROVADO')
    assert.match(ap.bloqueio ?? '', /armazenamento privado/)
    assert.equal(await prisma.publicacao.count({ where: { workspaceId: p.ws } }), 0, 'nada enviado ao TikTok')
    assert.equal(await prisma.conteudo.count({ where: { workspaceId: p.ws } }), 0, 'nenhum conteúdo com URL criado para API')
  })

  test('revogação: apagar o objeto derruba um link já entregue; a resposta seguinte não assina mais', async () => {
    const caminho = `originais/ws-r124rev/c/${Date.now()}.jpg`
    const { error } = await sb.storage.from(BUCKET_MIDIA_PRIVADA).upload(caminho, Buffer.from([0xff, 0xd8, 0xff, 0xd9]), { contentType: 'image/jpeg' })
    assert.ifError(error)
    const { data } = await sb.storage.from(BUCKET_MIDIA_PRIVADA).createSignedUrl(caminho, 600)
    assert.equal((await fetch(data!.signedUrl)).status, 200, 'link válido abre')
    await sb.storage.from(BUCKET_MIDIA_PRIVADA).remove([caminho])
    const depois = (await fetch(data!.signedUrl)).status
    assert.ok(depois === 400 || depois === 404, `link de objeto apagado não abre (${depois})`)
    const r = await assinarMidiasPrivadasNaResposta({ m: refPrivada(caminho) }, 'r124rev')
    assert.equal(r.m, null, 'objeto apagado → nenhum link na resposta')
  })
})
