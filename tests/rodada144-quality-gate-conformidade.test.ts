/**
 * P2.45 — Quality Gate de CONFORMIDADE + regra dos TRÊS controles.
 * Puro: classificação por requisito (com fonte oficial), configuração por plataforma/país/modalidade, correções
 * automáticas, pendências da titular, checklist da publicação, nota comercial alta NÃO libera.
 * Banco de TESTE: `publicarAprovada` RETÉM a publicação sem os três controles e libera (para a titular) com eles.
 *   node --env-file=<.env de TESTE> node_modules/tsx/dist/cli.mjs --test tests/rodada144-quality-gate-conformidade.test.ts
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { auditarConformidade, liberacaoParaPublicacao, REQUISITOS, type ContextoDeConformidade } from '../lib/quality-gate-conformidade'
import { FONTES } from '../lib/politicas-plataformas'

const LEGENDA_OK = 'O Emocionário — Diga o que você sente é um dicionário ilustrado de emoções.\n🛍️ Conheça o livro na sacolinha do vídeo.\n#publi Conteúdo de afiliada — posso receber comissão.\nNarração com voz gerada por inteligência artificial a partir da minha própria voz.\n#Emocionário #LivroInfantil'
const ctx = (o: Partial<ContextoDeConformidade> = {}): ContextoDeConformidade => ({
  plataforma: 'tiktok', pais: 'BR', categoria: 'LIVROS', modalidade: 'AFILIADO_TIKTOK_SHOP',
  arquivo: { largura: 1080, altura: 1920, duracaoS: 25, tamanhoBytes: 16e6, codecVideo: 'h264', codecAudio: 'aac', fps: 30, errosDeDecodificacao: 0 },
  textos: { narracao: ['Esse é o Emocionário, um dicionário ilustrado de emoções.', 'Se quiser conhecer, o livro está na sacolinha.'], naTela: ['#publi'], legendaDoPost: LEGENDA_OK, hashtags: ['#Emocionário', '#LivroInfantil'], publiNaTelaNoInicio: true },
  voz: { sintetica: true, daPropriaTitular: true, consentimentoRegistrado: true },
  imagens: { geradasPorIA: false, midiasReaisDaTitular: true, declaracaoDeAutoria: true, obraProtegida: ['CAPA'], textoInternoLegivelS: 0, ilustracaoInternaS: 0, menoresNaTela: false },
  trilha: { tipo: 'PROPRIA', evidencia: 'síntese local' },
  produto: { idNaLoja: '1734150650544162236', nome: 'Livro Emocionário', categoriaNaLoja: 'Livros', listagemConferida: true },
  dirigidoACriancas: false,
  resolucoes: { 'direitos.obra': { tipo: 'AUTORIZACAO_DOS_TITULARES', em: '2026-10-21', detalhe: 'e-mail da editora', concedente: { nome: 'Editora', qualidade: 'EDITORA' }, documento: 'autorizacao-editora.pdf' } },
  ...o,
})
const status = (r: ReturnType<typeof auditarConformidade>, id: string) => r.achados.find((a) => a.id === id)?.status

describe('Conformidade (puro)', () => {
  test('todo requisito cita fonte oficial registrada (URL + data da consulta)', () => {
    for (const r of REQUISITOS) for (const id of r.fontes) {
      assert.ok(FONTES[id], `${r.id} → fonte ${id}`)
      assert.match(FONTES[id].url, /^https:\/\/(www\.)?(tiktok\.com|seller-br\.tiktok\.com|support\.tiktok\.com|ads\.tiktok\.com|developers\.tiktok\.com|planalto\.gov\.br|www\.planalto\.gov\.br|www\.gov\.br|conar\.)/)
      assert.match(FONTES[id].consultadoEm, /^\d{4}-\d{2}-\d{2}$/)
    }
  })
  test('tudo resolvido: APTO, com checklist da publicação (IA, divulgação, marcação, música) — e não "garantia"', () => {
    const r = auditarConformidade(ctx())
    assert.equal(r.veredito, 'APTO', r.resumo)
    assert.match(r.resumo, /não é garantia/)
    assert.equal(r.checklistDaPublicacao.length, 4) // produto conferido → só IA, divulgação, marcação, música
    assert.ok(r.checklistDaPublicacao.some((x) => /gerado por IA/.test(x)))
    assert.ok(r.checklistDaPublicacao.some((x) => /Conteúdo de marca/.test(x)))
  })
  test('sem #publi na tela no início (CONAR 2026): APTO_APOS_CORRECOES (o Patrono corrige)', () => {
    const r = auditarConformidade(ctx({ textos: { ...ctx().textos, publiNaTelaNoInicio: false } }))
    assert.equal(status(r, 'divulgacao.na-tela'), 'NAO_CONFORME')
    assert.equal(r.veredito, 'APTO_APOS_CORRECOES')
  })
  test('legenda sem divulgação, "#ad" sozinho não basta, e promessa de desenvolvimento bloqueia', () => {
    let r = auditarConformidade(ctx({ textos: { ...ctx().textos, legendaDoPost: 'Livro lindo #ad\nNarração com voz gerada por IA.' } }))
    assert.equal(status(r, 'divulgacao.afiliado'), 'NAO_CONFORME')
    r = auditarConformidade(ctx({ textos: { ...ctx().textos, hashtags: ['#InteligênciaEmocional'], legendaDoPost: LEGENDA_OK + ' #InteligênciaEmocional' } }))
    assert.equal(status(r, 'alegacoes'), 'NAO_CONFORME')
    r = auditarConformidade(ctx({ textos: { ...ctx().textos, narracao: ['Comprovado: desenvolve a inteligência emocional.'] } }))
    assert.equal(status(r, 'alegacoes'), 'NAO_CONFORME')
  })
  test('voz sintética: legenda sem menção → NÃO CONFORME; voz humana → rótulo de IA NÃO APLICÁVEL', () => {
    let r = auditarConformidade(ctx({ textos: { ...ctx().textos, legendaDoPost: '#publi Conteúdo de afiliada.' } }))
    assert.equal(status(r, 'ia.legenda'), 'NAO_CONFORME')
    r = auditarConformidade(ctx({ voz: { sintetica: false, daPropriaTitular: true, consentimentoRegistrado: false } }))
    assert.equal(status(r, 'ia.rotulo'), 'NAO_APLICAVEL')
    assert.equal(status(r, 'ia.legenda'), 'NAO_APLICAVEL')
  })
  test('direitos autorais: três naturezas distintas — só titulares ou análise jurídica deste arquivo resolvem; risco aceito NÃO', () => {
    const base = { ...ctx(), arquivo: { ...ctx().arquivo, sha256: 'abc' } }
    const com = (res: object) => auditarConformidade({ ...base, resolucoes: { 'direitos.obra': { em: '2026-10-21', detalhe: 'x', ...res } as never } })
    let r = auditarConformidade({ ...base, resolucoes: {} })
    assert.equal(status(r, 'direitos.obra'), 'PENDENTE'); assert.equal(r.veredito, 'BLOQUEADO')
    r = com({ tipo: 'RISCO_RESIDUAL_ACEITO' })
    assert.equal(status(r, 'direitos.obra'), 'PENDENTE'); assert.equal(r.veredito, 'BLOQUEADO', 'aceitar o risco não libera')
    r = com({ tipo: 'AUTORIZACAO_DE_TERCEIRO', concedente: { nome: 'Loja X', qualidade: 'VENDEDOR' }, documento: 'chat.png' })
    assert.equal(status(r, 'direitos.obra'), 'PENDENTE', 'vendedor sem prova de titularidade não resolve')
    r = com({ tipo: 'AUTORIZACAO_DOS_TITULARES', concedente: { nome: 'Loja X', qualidade: 'VENDEDOR' }, documento: 'chat.png' })
    assert.equal(status(r, 'direitos.obra'), 'PENDENTE', 'quem concede tem de ser titular')
    r = com({ tipo: 'AUTORIZACAO_DOS_TITULARES', concedente: { nome: 'Editora Sextante', qualidade: 'EDITORA' } })
    assert.equal(status(r, 'direitos.obra'), 'PENDENTE', 'sem documento não resolve')
    r = com({ tipo: 'AUTORIZACAO_DOS_TITULARES', concedente: { nome: 'Editora Sextante', qualidade: 'EDITORA' }, documento: 'autorizacao.pdf' })
    assert.equal(status(r, 'direitos.obra'), 'CONFORME'); assert.equal(r.veredito, 'APTO')
    r = com({ tipo: 'ANALISE_JURIDICA_FUNDAMENTADA', conclusao: 'USO_PERMITIDO', concedente: { nome: 'Adv.', qualidade: 'ADVOGADO', registro: 'OAB/XX 0000' }, documento: 'parecer.pdf', sha256DoVideo: 'abc' })
    assert.equal(status(r, 'direitos.obra'), 'CONFORME')
    assert.match(r.achados.find((a) => a.id === 'direitos.obra')!.fundamento, /não é autorização dos titulares/)
    r = com({ tipo: 'ANALISE_JURIDICA_FUNDAMENTADA', conclusao: 'USO_PERMITIDO', concedente: { nome: 'Adv.', qualidade: 'ADVOGADO', registro: 'OAB/XX 0000' }, documento: 'parecer.pdf', sha256DoVideo: 'outro' })
    assert.equal(status(r, 'direitos.obra'), 'PENDENTE', 'parecer sobre OUTRO arquivo não vale')
    r = com({ tipo: 'ANALISE_JURIDICA_FUNDAMENTADA', conclusao: 'INCONCLUSIVO', concedente: { nome: 'Adv.', qualidade: 'ADVOGADO', registro: 'OAB/XX 0000' }, documento: 'parecer.pdf', sha256DoVideo: 'abc' })
    assert.equal(status(r, 'direitos.obra'), 'PENDENTE')
    r = auditarConformidade({ ...base, imagens: { ...base.imagens, textoInternoLegivelS: 3 } })
    assert.equal(status(r, 'direitos.obra'), 'NAO_CONFORME')
  })
  test('produto sem fonte oficial: conferido NO card oficial ao marcar (checklist), sem conferência manual à parte; com leitor oficial, automático', () => {
    let r = auditarConformidade(ctx({ produto: { ...ctx().produto, listagemConferida: false } }))
    const a = r.achados.find((x) => x.id === 'produto.vinculo')!
    assert.equal(a.status, 'PENDENTE'); assert.equal(a.momento, 'NA_PUBLICACAO'); assert.equal(a.bloqueia, false)
    assert.ok(r.checklistDaPublicacao.some((x) => /card/.test(x) && /não publicar/.test(x)))
    assert.match(a.fundamento, /só fonte oficial/)
    r = auditarConformidade(ctx({ produto: { ...ctx().produto, listagemConferida: false, fonteOficialDisponivel: true } }))
    assert.match(r.achados.find((x) => x.id === 'produto.vinculo')!.comoResolver ?? '', /Automático/)
  })
  test('crianças: dirigido à criança → NÃO CONFORME (CDC 37 §2, CONANDA 163); aos pais → CONFORME', () => {
    assert.equal(status(auditarConformidade(ctx({ dirigidoACriancas: true })), 'criancas'), 'NAO_CONFORME')
    assert.equal(status(auditarConformidade(ctx()), 'criancas'), 'CONFORME')
  })
  test('música de terceiros sem licença bloqueia; arquivo com erro/horizontal → NÃO CONFORME técnico', () => {
    assert.equal(status(auditarConformidade(ctx({ trilha: { tipo: 'TERCEIROS_SEM_LICENCA', evidencia: null } })), 'musica'), 'NAO_CONFORME')
    assert.equal(status(auditarConformidade(ctx({ arquivo: { ...ctx().arquivo, largura: 1920, altura: 1080, errosDeDecodificacao: 2 } })), 'tecnico.formato'), 'NAO_CONFORME')
  })
  test('configurável: fora do BR, regras brasileiras (CDC/CONAR/LDA/CONANDA) NÃO se aplicam; conteúdo orgânico sem regras de afiliado', () => {
    const r = auditarConformidade(ctx({ pais: 'PT' }))
    for (const id of ['divulgacao.afiliado', 'divulgacao.na-tela', 'direitos.obra', 'criancas']) assert.equal(r.achados.some((a) => a.id === id), false, id)
    const o = auditarConformidade(ctx({ modalidade: 'CONTEUDO_ORGANICO' }))
    assert.equal(o.achados.some((a) => a.id === 'produto.marcacao'), false)
  })
  test('TRÊS controles: nota comercial alta sem conformidade NÃO libera; com os três, libera e ainda depende da titular', () => {
    const tecnico = { veredito: 'APROVADO', arquivo: { largura: 1080 } }
    assert.equal(liberacaoParaPublicacao({ ...tecnico, comercial: { veredito: 'APRESENTAR_A_TITULAR' } }).liberado, false)
    assert.equal(liberacaoParaPublicacao({ ...tecnico, comercial: { veredito: 'APRESENTAR_A_TITULAR' }, conformidade: { veredito: 'BLOQUEADO' } }).liberado, false)
    assert.equal(liberacaoParaPublicacao({ ...tecnico, conformidade: { veredito: 'APTO' } }).liberado, false)
    // P2.66: os três controles SOZINHOS não liberam mais (deixaram passar vídeos genéricos com nota 93–98).
    const semBarreira = liberacaoParaPublicacao({ ...tecnico, comercial: { veredito: 'APRESENTAR_A_TITULAR' }, conformidade: { veredito: 'APTO' } })
    assert.equal(semBarreira.liberado, false)
    assert.ok(semBarreira.motivos.some((m) => /Barreira de Qualidade Profissional não executada/.test(m)))
    const ok = liberacaoParaPublicacao({ ...tecnico, arquivo: { largura: 1080, sha256: 'abc' }, comercial: { veredito: 'APRESENTAR_A_TITULAR' }, conformidade: { veredito: 'APTO' }, barreira: { decisao: 'APTO_PARA_TITULAR', sha256: 'abc' } })
    assert.equal(ok.liberado, true)
    assert.equal(ok.aindaDependeDaTitular, true)
  })
})

describe('publicarAprovada retém sem os três controles (banco de TESTE)', () => {
  if (!(process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')) {
    test('pulado: só com o banco de TESTE', { skip: true }, () => {})
    return
  }
  let prisma: typeof import('../lib/prisma').prisma
  let A: typeof import('../lib/publicacao-assistida')
  let ws = '', userId = ''
  const marca = `r144-${Date.now()}`
  // P2.69+: storage em memória (o arquivo é fixado no caminho imutável do sha256 antes de liberar)
  const BYTES_FALSOS = Buffer.from('video-narrado-r144')
  const SHA_FALSO = createHash('sha256').update(BYTES_FALSOS).digest('hex')
  const portas = () => { const m = new Map<string, Buffer>(); return {
    baixar: async () => BYTES_FALSOS,
    subirSemSobrescrever: async (c: string, b: Buffer) => (m.has(c) ? 'JA_EXISTE' as const : (m.set(c, b), 'CRIADO' as const)),
    ler: async (c: string) => m.get(c)!,
    urlDeLeitura: async (c: string) => `https://x.test/storage/v1/object/sign/digital-twin-private/${c}?token=t`,
  } }
  const criar = (qualityGate: object) => prisma.publicacaoAssistida.create({ data: {
    workspaceId: ws, estado: 'APROVADO', nomeProduto: 'Livro Emocionário', varianteId: 'v', estrutura: 'e', motivoEscolha: 'teste', objetivoDoTeste: 'teste', metasIds: [],
    apresentacao: { versaoEscolhida: 'NARRADA', narracao: { videoPath: 'ws/r144/video-narrado.mp4' }, produto: { nome: 'Livro Emocionário', tiktokShop: true, categoria: 'Livros', preco: null } }, qualityGate,
  } })
  before(async () => {
    delete process.env.PATRONO_TESTE_LEGADO_SEM_TRES_CONTROLES
    ;[{ prisma }, A] = await Promise.all([import('../lib/prisma'), import('../lib/publicacao-assistida')])
    ws = (await prisma.workspace.create({ data: { name: 'R144', ownerId: marca }, select: { id: true } })).id
    userId = (await prisma.user.create({ data: { email: `${marca}@teste.local`, name: 'U', password: 'x', workspaceId: ws }, select: { id: true } })).id
  })
  after(async () => {
    if (prisma && ws) {
      const w = { workspaceId: ws }
      await prisma.publicacaoAssistida.deleteMany({ where: w }); await prisma.auditLog.deleteMany({ where: w }); await prisma.domainEvent.deleteMany({ where: w })
      await prisma.user.deleteMany({ where: w }); await prisma.workspace.deleteMany({ where: { id: ws } })
    }
    await prisma?.$disconnect()
  })
  test('só técnico + comercial (sem conformidade): RETIDA, nada liberado', async () => {
    const a = await criar({ veredito: 'APROVADO', arquivo: { largura: 1080 }, comercial: { veredito: 'APRESENTAR_A_TITULAR' } })
    const r = await A.publicarAprovada({ workspaceId: ws, userId, id: a.id, env: {}, portasDoArquivo: portas() })
    assert.equal(r.estado, 'APROVADO')
    assert.match(r.bloqueio ?? '', /PUBLICAÇÃO RETIDA.*conformidade/i)
  })
  test('conformidade BLOQUEADA (direitos/produto pendentes): RETIDA com o motivo', async () => {
    const a = await criar({ veredito: 'APROVADO', arquivo: { largura: 1080 }, comercial: { veredito: 'APRESENTAR_A_TITULAR' }, conformidade: { veredito: 'BLOQUEADO', resumo: 'Bloqueado: Direitos autorais (PENDENTE).' } })
    const r = await A.publicarAprovada({ workspaceId: ws, userId, id: a.id, env: {}, portasDoArquivo: portas() })
    assert.match(r.bloqueio ?? '', /Direitos autorais/)
  })
  test('P2.66: três controles SEM a barreira profissional: publicação retida', async () => {
    const a = await criar({ veredito: 'APROVADO', arquivo: { largura: 1080 }, comercial: { veredito: 'APRESENTAR_A_TITULAR' }, conformidade: { veredito: 'APTO', resumo: 'ok' } })
    const r = await A.publicarAprovada({ workspaceId: ws, userId, id: a.id, env: {}, portasDoArquivo: portas() })
    assert.match(r.bloqueio ?? '', /Barreira de Qualidade Profissional não executada/)
    assert.equal(await prisma.publicacao.count({ where: { workspaceId: ws } }), 0)
  })
  test('os três controles + barreira profissional APTA: liberada para a TITULAR publicar pelo app (nada enviado automaticamente)', async () => {
    const a = await criar({ veredito: 'APROVADO', arquivo: { largura: 1080, sha256: SHA_FALSO }, comercial: { veredito: 'APRESENTAR_A_TITULAR' }, conformidade: { veredito: 'APTO', resumo: 'ok' }, barreira: { decisao: 'APTO_PARA_TITULAR', sha256: SHA_FALSO } })
    const r = await A.publicarAprovada({ workspaceId: ws, userId, id: a.id, env: {}, portasDoArquivo: portas() })
    assert.equal(r.estado, 'APROVADO')
    assert.match(r.bloqueio ?? '', /Versão narrada: baixe/)
    assert.equal(await prisma.publicacao.count({ where: { workspaceId: ws } }), 0)
  })
  test('a dispensa dos testes legados NÃO vale em Production', async () => {
    process.env.PATRONO_TESTE_LEGADO_SEM_TRES_CONTROLES = 'true'
    process.env.PATRONO_AMBIENTE = 'producao'
    try {
      const a = await criar({ veredito: 'APROVADO', arquivo: { largura: 1080 } })
      const r = await A.publicarAprovada({ workspaceId: ws, userId, id: a.id, env: {}, portasDoArquivo: portas() })
      assert.match(r.bloqueio ?? '', /PUBLICAÇÃO RETIDA/)
    } finally { delete process.env.PATRONO_TESTE_LEGADO_SEM_TRES_CONTROLES; delete process.env.PATRONO_AMBIENTE }
  })
})
