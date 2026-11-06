/**
 * P2.50 — Segurança e confiabilidade (confronto da auditoria externa + auditoria própria).
 * Puro: destinos públicos (SSRF/links), credencial da fal.ai só para a fal.ai, segredo das rotinas em tempo constante,
 * clique real × robô × titular, impressão da aprovação, liberação presa ao arquivo auditado, base pública, motor da
 * jornada sem "publicar" para vídeo retido.
 * Banco de TESTE: aprovação de Conteúdo vinculada à versão na porta única; aprovação da publicação assistida presa à
 * versão vista; registro manual de vídeo retido recusado (e aceito só com confirmação auditada); link duplicado.
 */
process.env.PATRONO_TESTE_LEGADO_SEM_TRES_CONTROLES = ''
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { destinoPublico, ipNaoPublico } from '../lib/destino-publico'
import { urlDaFal } from '../lib/falai'
import { autorizacaoDeRotinaValida } from '../lib/segredo-de-rotina'
import { classificarClique } from '../lib/clique-real'
import { alteraMaterialAprovado, impressaoDoConteudo } from '../lib/aprovacao-de-conteudo'
import { liberacaoParaPublicacao } from '../lib/quality-gate-conformidade'
import { lerBasePublica } from '../lib/link-de-publicacao'

describe('destinos públicos (SSRF e links de divulgação)', () => {
  test('recusa interno, privado, metadados de nuvem, http, esquemas estranhos, credencial na URL e o próprio Patrono', () => {
    for (const u of ['http://shop.tiktok.com/x', 'https://localhost/x', 'https://127.0.0.1/', 'https://10.0.0.5/', 'https://169.254.169.254/latest/meta-data', 'https://192.168.1.10/', 'https://172.20.0.1/', 'https://[::1]/', 'https://[fd00::1]/', 'javascript:alert(1)', 'file:///etc/passwd', 'https://user:senha@shop.tiktok.com/', 'https://intranet/', 'https://maquina.local/'])
      assert.equal(destinoPublico(u).ok, false, u)
    assert.equal(destinoPublico('https://seller.exemplo.com.br/api/l/abc', { hostsDoApp: ['seller.exemplo.com.br'] }).ok, false)
    assert.equal(destinoPublico('https://shop.tiktok.com/br/pdp/1736244818989057096').ok, true)
    assert.equal(destinoPublico('https://shopee.com.br/produto-i.1.2').ok, true)
  })
  test('IPs: privados e reservados não são públicos; públicos são', () => {
    for (const ip of ['0.0.0.0', '10.1.1.1', '100.64.0.1', '127.0.0.1', '169.254.1.1', '172.31.255.255', '192.168.0.1', '224.0.0.1', '::1', 'fe80::1', '::ffff:10.0.0.1']) assert.equal(ipNaoPublico(ip), true, ip)
    for (const ip of ['8.8.8.8', '200.160.2.3', '2001:4860:4860::8888']) assert.equal(ipNaoPublico(ip), false, ip)
  })
})

describe('credenciais e rotinas', () => {
  test('a chave da fal.ai só vai para domínios da fal.ai (https)', () => {
    assert.equal(urlDaFal('https://queue.fal.run/fal-ai/kling/requests/1/status'), true)
    assert.equal(urlDaFal('https://v3.fal.media/files/x.mp4'), true)
    for (const u of ['http://queue.fal.run/x', 'https://evil.example/fal.run', 'https://fal.run.evil.example/x', 'https://169.254.169.254/', 'https://a:b@queue.fal.run/']) assert.equal(urlDaFal(u), false, u)
  })
  test('segredo da rotina: certo passa; errado, vazio ou sem segredo configurado recusa', () => {
    assert.equal(autorizacaoDeRotinaValida('Bearer s3gr3d0-longo', 's3gr3d0-longo'), true)
    assert.equal(autorizacaoDeRotinaValida('Bearer s3gr3d0-longX', 's3gr3d0-longo'), false)
    assert.equal(autorizacaoDeRotinaValida(null, 's3gr3d0-longo'), false)
    assert.equal(autorizacaoDeRotinaValida('Bearer ', ''), false)
    assert.equal(autorizacaoDeRotinaValida('Bearer undefined', undefined), false)
  })
})

describe('indicadores', () => {
  test('clique real × robô de pré-visualização × pré-carregamento × a própria titular', () => {
    const navegador = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'
    assert.equal(classificarClique({ userAgent: navegador, temSessaoDoApp: false }), 'clique')
    for (const ua of ['facebookexternalhit/1.1', 'WhatsApp/2.23', 'TelegramBot (like TwitterBot)', 'Mozilla/5.0 (compatible; Googlebot/2.1)', 'curl/8.0', null]) assert.equal(classificarClique({ userAgent: ua, temSessaoDoApp: false }), 'clique_bot', String(ua))
    assert.equal(classificarClique({ userAgent: navegador, secPurpose: 'prefetch', temSessaoDoApp: false }), 'clique_bot')
    assert.equal(classificarClique({ userAgent: navegador, temSessaoDoApp: true }), 'clique_proprio')
  })
})

describe('aprovação e liberação (puro)', () => {
  test('impressão muda com vídeo/legenda/produto; edições que tocam o material invalidam', () => {
    const base = { videoUrl: 'https://x/v.mp4', legendaInstagram: 'a', produtoId: 'p1' }
    assert.equal(impressaoDoConteudo(base), impressaoDoConteudo({ ...base }))
    assert.notEqual(impressaoDoConteudo(base), impressaoDoConteudo({ ...base, legendaInstagram: 'b' }))
    assert.notEqual(impressaoDoConteudo(base), impressaoDoConteudo({ ...base, videoUrl: 'https://x/v2.mp4' }))
    assert.equal(alteraMaterialAprovado({ legendaTiktok: 'x' }), true)
    assert.equal(alteraMaterialAprovado({ dataAgendamento: '2026-11-01T10:00:00Z' }), false)
  })
  test('controles de OUTRO arquivo não liberam o vídeo atual', () => {
    const qg = { veredito: 'APROVADO', arquivo: { largura: 1080, sha256: 'a'.repeat(64) }, comercial: { veredito: 'APRESENTAR_A_TITULAR' }, conformidade: { veredito: 'APTO', resumo: 'ok' }, barreira: { decisao: 'APTO_PARA_TITULAR', sha256: 'a'.repeat(64), resumo: 'ok' } }
    assert.equal(liberacaoParaPublicacao(qg, 'a'.repeat(64)).liberado, true)
    const l = liberacaoParaPublicacao(qg, 'b'.repeat(64))
    assert.equal(l.liberado, false)
    assert.match(l.motivos[0], /outro arquivo/)
  })
  test('base pública dos links: só https, sem IP interno nem domínio de prévia', () => {
    assert.equal(lerBasePublica({ PUBLIC_BASE_URL: 'https://seller.exemplo.com.br' }).ok, true)
    for (const b of ['http://seller.exemplo.com.br', 'https://192.168.0.10', 'https://deploy-preview-12--patrono.netlify.app', 'https://main--patrono.netlify.app', 'http://localhost:3000'])
      assert.equal(lerBasePublica({ PUBLIC_BASE_URL: b }).ok, false, b)
  })
  test('motor da jornada: aprovado mas RETIDO → nenhuma ação de publicar (nem API, nem assistida)', async () => {
    const src = (await import('node:fs')).readFileSync('lib/motor-da-jornada.ts', 'utf8')
    assert.match(src, /if \(a\.liberacao && !a\.liberacao\.liberado\) \{\s*return \{ etapa: 'PUBLICAR'[^}]*titulo: 'Publicação retida'/)
    const idxRetida = src.indexOf("titulo: 'Publicação retida'"), idxApi = src.indexOf("caps.TIKTOK_PUBLISH.modo === 'AUTOMATIC' && !falhouPublicar")
    assert.ok(idxRetida > 0 && idxRetida < idxApi, 'a retenção vem ANTES da publicação automática e da assistida')
  })
})

describe('banco de TESTE — aprovação por versão e retenção no servidor', () => {
  if (!(process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')) { test('pulado: só com o banco de TESTE', { skip: true }, () => {}); return }
  let prisma: typeof import('../lib/prisma').prisma
  let ws = '', userId = '', produtoId = ''
  const marca = `r148-${Date.now()}`
  before(async () => {
    ;({ prisma } = await import('../lib/prisma'))
    ws = (await prisma.workspace.create({ data: { name: 'R148', ownerId: marca }, select: { id: true } })).id
    userId = (await prisma.user.create({ data: { email: `${marca}@teste.local`, name: 'U', password: 'x', workspaceId: ws }, select: { id: true } })).id
    produtoId = (await prisma.produto.create({ data: { userId, workspaceId: ws, nome: 'Produto R148', categoria: 'Outros', publicoAlvo: [], beneficios: [], pontosNegativos: [], imagens: [], videos: [], tipoVenda: 'afiliado', origemConteudo: 'Própria' }, select: { id: true } })).id
  })
  after(async () => {
    if (prisma && ws) {
      const w = { workspaceId: ws }
      await prisma.videoTikTokResultado.deleteMany({ where: w }).catch(() => null); await prisma.contadorDeCotaDiaria.deleteMany({ where: w }).catch(() => null); await prisma.consumoDeCota.deleteMany({ where: w }).catch(() => null)
      await prisma.publicacaoAssistida.deleteMany({ where: w }); await prisma.auditLog.deleteMany({ where: w }); await prisma.domainEvent.deleteMany({ where: w })
      await prisma.conteudo.deleteMany({ where: w }); await prisma.produto.deleteMany({ where: w }); await prisma.user.deleteMany({ where: w }); await prisma.workspace.deleteMany({ where: { id: ws } })
    }
    await prisma?.$disconnect()
  })

  test('Conteúdo: sem aprovação, com aprovação de OUTRA versão ou editado depois → a porta única recusa', async () => {
    const { aprovacaoValidaDoConteudo } = await import('../lib/aprovacao-de-conteudo')
    const { autorizarPublicacaoReal } = await import('../lib/porta-de-publicacao-real')
    const c = await prisma.conteudo.create({ data: { userId, workspaceId: ws, produtoId, status: 'aguardando_aprovacao', videoUrl: 'https://x.supabase.co/v.mp4', legendaInstagram: 'v1' } as never })
    assert.match((await aprovacaoValidaDoConteudo(ws, c.id)).motivo ?? '', /não está aprovado/)
    await prisma.conteudo.update({ where: { id: c.id }, data: { status: 'aprovado' } })
    assert.match((await aprovacaoValidaDoConteudo(ws, c.id)).motivo ?? '', /QUAL versão/)
    const atual = await prisma.conteudo.findUniqueOrThrow({ where: { id: c.id } })
    await prisma.auditLog.create({ data: { workspaceId: ws, userId, action: 'conteudo.aprovado', entityType: 'Conteudo', entityId: c.id, metadata: { impressao: impressaoDoConteudo(atual as never) } } })
    assert.equal((await aprovacaoValidaDoConteudo(ws, c.id)).valida, true)
    await prisma.conteudo.update({ where: { id: c.id }, data: { legendaInstagram: 'v2 editada depois' } })
    assert.match((await aprovacaoValidaDoConteudo(ws, c.id)).motivo ?? '', /mudou depois da aprovação/)
    const porta = await autorizarPublicacaoReal({ workspaceId: ws, contentId: c.id, canal: 'instagram' })
    assert.equal(porta.liberada, false)
    // A conferência da aprovação fica no caminho que LIBERA (depois do preflight): nada passa sem ela.
    const src = (await import('node:fs')).readFileSync('lib/porta-de-publicacao-real.ts', 'utf8')
    assert.match(src, /if \(preflight\.executavelAgora\) \{\s*const aprovacao = await aprovacaoValidaDoConteudo/)
    assert.match(src, /if \(!aprovacao\.valida\) return \{ liberada: false, bloqueio: 'SEM_APROVACAO_VALIDA'/)
  })

  const criarAssistida = (dados: Record<string, unknown>) => prisma.publicacaoAssistida.create({ data: {
    workspaceId: ws, estado: 'APROVADO', versao: 1, nomeProduto: 'Produto R148', varianteId: 'v', estrutura: 'e', motivoEscolha: 't', objetivoDoTeste: 't', metasIds: [],
    apresentacao: { produto: { nome: 'Produto R148', tiktokShop: true, categoria: 'Outros', preco: null }, video: { arquivo: 'https://x/v.mp4', sha256: 'c'.repeat(64) }, versao: { varianteId: 'v', estrutura: 'e', objetivo: 'VENDA', gancho: 'Olha que produto interessante para você', roteiro: [], cta: 'Toque no produto marcado.', legenda: 'legenda #publi', hashtags: [], disclosure: 'Conteúdo de afiliada.', duracaoSegundos: 20 } },
    qualityGate: { veredito: 'APROVADO', arquivo: { largura: 1080 } }, ...dados,
  } as never })

  test('registro manual de vídeo RETIDO: recusado; só com a confirmação explícita (auditada) vira publicado', async () => {
    const A = await import('../lib/publicacao-assistida')
    const a = await criarAssistida({})
    await assert.rejects(A.registrarPublicacaoManual({ workspaceId: ws, userId, id: a.id, url: 'https://www.tiktok.com/@x/video/7494097262036092518' }), /RETIDO/)
    assert.equal((await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id: a.id } })).estado, 'APROVADO')
    await A.registrarPublicacaoManual({ workspaceId: ws, userId, id: a.id, url: 'https://www.tiktok.com/@x/video/7494097262036092518', confirmoPublicacaoRetida: true })
    assert.equal((await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id: a.id } })).estado, 'PUBLICADO')
    assert.equal(await prisma.auditLog.count({ where: { workspaceId: ws, action: 'tiktok.assistido_publicado_apesar_de_retido', entityId: a.id } }), 1)
  })

  test('o mesmo link do TikTok não conta como duas publicações', async () => {
    const A = await import('../lib/publicacao-assistida')
    const b = await criarAssistida({})
    await assert.rejects(A.registrarPublicacaoManual({ workspaceId: ws, userId, id: b.id, url: 'https://www.tiktok.com/@x/video/7494097262036092518', confirmoPublicacaoRetida: true }), /já está registrado em outra publicação/)
  })

  test('aprovação presa à versão VISTA: aba antiga (versão ou arquivo diferentes) não aprova', async () => {
    const A = await import('../lib/publicacao-assistida')
    const c = await criarAssistida({ estado: 'AGUARDANDO_APROVACAO', versao: 2 })
    await assert.rejects(A.aprovarEPublicar({ workspaceId: ws, userId, id: c.id, versao: 1 }), /O vídeo mudou desde que você abriu a tela/)
    await assert.rejects(A.aprovarEPublicar({ workspaceId: ws, userId, id: c.id, versao: 2, sha256: 'd'.repeat(64) }), /arquivo do vídeo mudou/)
    assert.equal((await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id: c.id } })).estado, 'AGUARDANDO_APROVACAO')
  })
})

describe('P2.50 — pendências fechadas em 25/10 (16b Shopee)', () => {
  test('16b: só o link curto do portal é afiliado; link de produto fica não verificado e nada é anexado', async () => {
    const { classificarLinkShopee } = await import('../lib/link-shopee')
    const curto = classificarLinkShopee('https://s.shopee.com.br/AbC123')
    assert.equal(curto.ok && curto.tipo, 'afiliado')
    const shopeeEe = classificarLinkShopee('https://shope.ee/xyz')
    assert.equal(shopeeEe.ok && shopeeEe.tipo, 'afiliado')
    const produto = classificarLinkShopee('https://shopee.com.br/produto-i.1.2')
    assert.ok(produto.ok)
    assert.equal(produto.ok && produto.tipo, 'nao_verificado')
    assert.equal(produto.ok && produto.urlDestino, 'https://shopee.com.br/produto-i.1.2')
    for (const u of ['http://shopee.com.br/x', 'https://shopee.com.br.golpe.com/x', 'https://evil.com/?shopee.com.br', '', null])
      assert.equal(classificarLinkShopee(u as string).ok, false, String(u))
    const { readFileSync } = await import('node:fs')
    const rota = readFileSync('app/api/integracoes/shopee/sincronizar/route.ts', 'utf8')
    assert.doesNotMatch(rota, /smtt=|sub_id1=/)
    assert.match(rota, /tipo: link\.tipo/)
  })
})

describe('P2.50 — Codex 20 (resultado após custos) e 22 (escala com amostra mínima)', () => {
  test('22: 1 venda em 2 cliques NÃO é "escalar já"; com amostra suficiente a faixa volta a valer', async () => {
    const { calcularScoreEscala, AMOSTRA_MINIMA_ESCALA } = await import('../lib/score-de-escala')
    const [pequeno] = calcularScoreEscala([{ produtoId: 'a', nome: 'A', cliques: 2, conversoes: 1, receitaTotal: 10 }])
    assert.equal(pequeno.scoreEscala, 100)
    assert.equal(pequeno.amostraSuficiente, false)
    assert.doesNotMatch(pequeno.faixa.label, /escalar/i)
    const r = calcularScoreEscala([
      { produtoId: 'p', nome: 'Pequeno', cliques: 5, conversoes: 2, receitaTotal: 50 },
      { produtoId: 'g', nome: 'Grande', cliques: AMOSTRA_MINIMA_ESCALA.cliques, conversoes: 20, receitaTotal: 40 },
    ])
    assert.equal(r[0].produtoId, 'g', 'amostra suficiente vem primeiro')
    assert.equal(r[0].faixa.label, 'Campeão · escalar já')
    const fonte = (await import('node:fs')).readFileSync('app/api/metricas/route.ts', 'utf8')
    assert.match(fonte, /from '@\/lib\/score-de-escala'/)
    assert.doesNotMatch(fonte, /function calcularScoreEscala/)
  })

  test('20: resultado = confirmada − custos; estorno não é subtraído duas vezes; previsão fica fora; sem custos apurados = null', async () => {
    const { calcularResultadoAposCustos, somarFinanceiro } = await import('../lib/financeiro')
    const soma = somarFinanceiro([
      { id: '1', estado: 'LIQUIDADA', valor: 30 },
      { id: '2', estado: 'RECEBIDA', valor: 20 },
      { id: '3', estado: 'REVERTIDA', valor: 15 },
      { id: '4', estado: 'ESTIMADA', valor: 99 },
    ])
    const r = calcularResultadoAposCustos(soma, { reaisBRL: 5, reservadosBRL: 7.5 })
    assert.equal(r.receitaConfirmada, 50)
    assert.equal(r.estornos, 15)
    assert.equal(r.custos, 12.5)
    assert.equal(r.resultado, 37.5)
    assert.equal(r.previsao, 99)
    const semCustos = calcularResultadoAposCustos(soma, null)
    assert.equal(semCustos.resultado, null)
    assert.match(semCustos.limitacoes[0], /não calculado/)
  })
})

describe('P2.50 — Codex 5 (prazo e canal do direito por ativo)', () => {
  const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://proj.supabase.co' }
  const url = 'https://proj.supabase.co/storage/v1/object/public/midias/video.mp4'
  const base = { tipo: 'EVIDENCIA_DE_MIDIA', severidade: 'verde', origem: 'PROPRIO', assetUrl: url, formato: 'video', declaradoPor: 'u1', declaradoEm: '2026-10-01T00:00:00Z', descricao: 'gravei', mensagem: 'x' }

  test('sem prazo/canais declarados nada muda; vencido, ilegível ou canal fora da lista bloqueiam', async () => {
    const { avaliarMidiaParaPublicacao, TIPO_EVIDENCIA_DE_MIDIA } = await import('../lib/evidencia-de-midia')
    const ev = (extra: object) => ({ ...base, tipo: TIPO_EVIDENCIA_DE_MIDIA, ...extra }) as never
    const agora = new Date('2026-10-25T12:00:00Z')
    assert.equal(avaliarMidiaParaPublicacao({ assetUrl: url, evidencia: ev({}), env, uso: { canal: 'tiktok', agora } }).autorizada, true)
    assert.equal(avaliarMidiaParaPublicacao({ assetUrl: url, evidencia: ev({ validaAte: '2026-12-31T00:00:00Z', canaisPermitidos: ['TikTok', 'instagram'] }), env, uso: { canal: 'tiktok', agora } }).autorizada, true)
    const vencida = avaliarMidiaParaPublicacao({ assetUrl: url, evidencia: ev({ validaAte: '2026-10-01T00:00:00Z' }), env, uso: { agora } })
    assert.equal(vencida.autorizada, false)
    assert.match(vencida.motivo, /venceu em 2026-10-01/)
    assert.equal(avaliarMidiaParaPublicacao({ assetUrl: url, evidencia: ev({ validaAte: 'amanhã' }), env, uso: { agora } }).autorizada, false)
    const canal = avaliarMidiaParaPublicacao({ assetUrl: url, evidencia: ev({ canaisPermitidos: ['instagram'] }), env, uso: { canal: 'tiktok', agora } })
    assert.equal(canal.autorizada, false)
    assert.match(canal.motivo, /não cobre o canal "tiktok"/)
  })

  test('derivado herda: fonte vencida derruba o arquivo final; o orquestrador passa o canal', async () => {
    const { avaliarMidiaParaPublicacao, TIPO_EVIDENCIA_DE_MIDIA } = await import('../lib/evidencia-de-midia')
    const fonteUrl = 'https://proj.supabase.co/storage/v1/object/public/midias/foto.jpg'
    const fonte = { ...base, tipo: TIPO_EVIDENCIA_DE_MIDIA, assetUrl: fonteUrl, validaAte: '2026-10-10T00:00:00Z' }
    const derivado = { ...base, tipo: TIPO_EVIDENCIA_DE_MIDIA, origem: 'DERIVADO', geracaoId: 'g1', fontes: [{ papel: 'imagem do produto', assetUrl: fonteUrl, evidencia: fonte }] } as never
    assert.equal(avaliarMidiaParaPublicacao({ assetUrl: url, evidencia: derivado, env, uso: { agora: new Date('2026-10-05T00:00:00Z') } }).autorizada, true)
    const depois = avaliarMidiaParaPublicacao({ assetUrl: url, evidencia: derivado, env, uso: { agora: new Date('2026-10-25T00:00:00Z') } })
    assert.equal(depois.autorizada, false)
    assert.match(depois.motivo, /venceu/)
    const orq = (await import('node:fs')).readFileSync('lib/distribuicao-orquestrador.ts', 'utf8')
    assert.match(orq, /avaliarMidiaParaPublicacao\(\{ assetUrl, evidencia, env: params\.env \?\? process\.env, uso: \{ canal \} \}\)/)
  })
})

describe('P2.50 — Codex 5 na declaração', () => {
  test('a declaração grava prazo e canais no registro; mídia do vendedor herda os da autorização; a API aceita', async () => {
    const { evidenciaDaDeclaracao } = await import('../lib/midia-do-produto')
    const ev = evidenciaDaDeclaracao({ url: 'https://x.supabase.co/storage/v1/object/a.jpg', tipo: 'IMAGEM', origem: 'LICENCIADO', titularidade: 'Banco de imagens', direitoDeUso: 'licença', descricao: 'foto', termoDeLicenca: 'L-1', declaradoPor: 'u', declaradoEm: new Date('2026-10-01'), validaAte: new Date('2026-12-31T23:59:59Z'), canaisPermitidos: [' TikTok ', 'instagram'] })
    assert.equal(ev?.validaAte, '2026-12-31T23:59:59.000Z')
    assert.deepEqual(ev?.canaisPermitidos, ['tiktok', 'instagram'])
    const sem = evidenciaDaDeclaracao({ url: 'https://x.supabase.co/storage/v1/object/b.jpg', tipo: 'IMAGEM', origem: 'PROPRIO', titularidade: 'eu', direitoDeUso: 'meu', descricao: 'foto', declaradoPor: 'u', declaradoEm: new Date() })
    assert.equal(sem?.validaAte, null)
    assert.equal(sem?.canaisPermitidos, null)
    const { readFileSync } = await import('node:fs')
    assert.match(readFileSync('lib/midia-do-produto.ts', 'utf8'), /validaAte: r\.autorizacao\.validaAte \?\? null, canaisPermitidos: r\.autorizacao\.canaisPermitidos \?\? null/)
    assert.match(readFileSync('app/api/midias/route.ts', 'utf8'), /validaAte: z\.string\(\)\.regex/)
  })
})

describe('P2.50 — Codex 24 (nota comercial sem pesquisa)', () => {
  test('o prompt não pede nota nem veredito; a saída é null + texto que aponta o motor; a tela não mostra 0/10', async () => {
    const { readFileSync } = await import('node:fs')
    const claude = readFileSync('lib/claude.ts', 'utf8')
    const prompt = claude.slice(claude.indexOf('const userPrompt = `Crie conteúdo comercial'), claude.indexOf("await exigirPermissaoDeCusto('gerar-roteiro'"))
    assert.doesNotMatch(prompt, /notaProduto|veredito/)
    assert.match(prompt, /não invente números, avaliações/)
    assert.match(claude, /notaProduto: null,/)
    assert.doesNotMatch(claude, /parsed\.notaProduto|parsed\.veredito/)
    const { gerarConteudoGratuito } = await import('../lib/conteudo-gratuito')
    assert.equal(gerarConteudoGratuito({ nome: 'X', categoria: 'casa' }).conteudo.notaProduto, null)
    assert.match(readFileSync('components/conteudos/ConteudoPreview.tsx', 'utf8'), /sem nota \(sem evidência\)/)
  })
})

describe('P2.50 — Codex 19 opção B (centavos sem migration)', () => {
  test('soma em centavos é exata; gravação com 2 casas; ausente continua ausente', async () => {
    const { somarFinanceiro, dinheiro, centavos } = await import('../lib/financeiro')
    const itens = Array.from({ length: 10000 }, (_, i) => ({ id: String(i), estado: 'LIQUIDADA' as const, valor: 0.1 }))
    assert.equal(somarFinanceiro(itens).confirmada, 1000)
    assert.equal(somarFinanceiro([{ estado: 'RECEBIDA', valor: 0.1 }, { estado: 'RECEBIDA', valor: 0.2 }]).confirmada, 0.3)
    assert.equal(dinheiro(1.005), 1.01)
    assert.equal(dinheiro(-1.005), -1.01)
    assert.equal(dinheiro(12.5), 12.5)
    assert.equal(dinheiro(null), null)
    assert.equal(dinheiro(Number.NaN), null)
    assert.equal(centavos(2.675), 268)
    const { readFileSync } = await import('node:fs')
    const csv = readFileSync('lib/creator-center-csv.ts', 'utf8')
    assert.match(csv, /valorBase: dinheiro\(lerNumero/)
    assert.match(csv, /comissaoLiquidada = dinheiro\(lerNumero/)
    const vc = readFileSync('lib/vendas-comissoes.ts', 'utf8')
    for (const re of [/amount: dinheiro\(input\.amount\)/, /expectedAmount: dinheiro\(input\.expectedCommission\)/, /confirmedAmount: dinheiro\(params\.confirmedAmount\)/, /receivedAmount: dinheiro\(params\.receivedAmount\)/]) assert.match(vc, re)
  })
})
