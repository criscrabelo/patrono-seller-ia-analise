/**
 * REVALIDAÇÃO DE DADOS COMERCIAIS — "PREÇO NÃO CONFIRMADO = PREÇO NÃO PUBLICADO".
 *
 * Os 12 cenários pedidos pela titular + o caso 79,90 → 89,90:
 *  1 confirmado e inalterado · 2 aumentou · 3 diminuiu · 4 promoção expirou ·
 *  5 indisponível · 6 não confirmável · 7 banco com preço antigo sem confirmação ·
 *  8 vídeo pronto com preço que mudou · 9 legenda antiga com preço que mudou ·
 *  10 conteúdo sem preço continua válido · 11 publicação histórica mantém o preço ·
 *  12 duas verificações simultâneas sem conflito.
 * Banco de TESTE; nada é publicado.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { decidirDadosComerciais, sanearTextoComercial, revisarVersao, FALLBACK_DO_PRECO, mencionaDadoComercial } from '../lib/dados-comerciais'
// P2.45: este arquivo testa o fluxo de publicação ANTERIOR aos três controles (técnico, comercial, conformidade).
process.env.PATRONO_TESTE_LEGADO_SEM_TRES_CONTROLES = 'true'

const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')
const DIA1 = new Date('2026-10-01T12:00:00-03:00')
const H = 3_600_000
const oficial = (preco: number | null, em: Date, extra: Record<string, unknown> = {}) => ({ preco, atualizadoEm: em, situacao: 'OK', disponivel: true, descontoPercentual: null, comissaoPercentual: 12, comissaoValor: null, ...extra })
const candidato = (preco: number | null, extra: Record<string, unknown> = {}) => ({ preco, fonte: 'CATALOGO', coletadoEm: DIA1, comissaoPercentual: 10, comissaoValor: null, ...extra })

describe('decidir e sanear (puro)', () => {
  test('1. confirmado e inalterado: o preço pode ir ao público', () => {
    const d = decidirDadosComerciais({ agora: new Date(DIA1.getTime() + 2 * H), oficial: oficial(79.9, DIA1), produto: null, candidato: candidato(79.9) })
    assert.equal(d.precoPublicavel, 79.9)
    assert.equal(d.fonte, 'OFICIAL')
    assert.equal(d.confianca, 'ALTA')
    assert.equal(d.lastVerifiedAt, DIA1.toISOString())
    const t = sanearTextoComercial('Só R$ 79,90 hoje!', d)
    assert.equal(t.mudou, false)
  })
  test('2/3. aumentou ou diminuiu: o valor antigo do texto sai; o novo confirmado pode ficar', () => {
    for (const novo of [89.9, 69.9]) {
      const d = decidirDadosComerciais({ agora: new Date(DIA1.getTime() + 2 * H), oficial: oficial(novo, DIA1), produto: null, candidato: candidato(79.9) })
      assert.equal(d.precoPublicavel, novo)
      assert.equal(sanearTextoComercial('Por R$ 79,90!', d).texto, FALLBACK_DO_PRECO)
      assert.equal(sanearTextoComercial(`Por ${novo === 89.9 ? 'R$ 89,90' : 'R$ 69,90'}!`, d).mudou, false)
    }
  })
  test('4. promoção expirou: desconto não confirmado sai do texto', () => {
    const d = decidirDadosComerciais({ agora: new Date(DIA1.getTime() + 2 * H), oficial: oficial(89.9, DIA1, { descontoPercentual: null }), produto: null, candidato: candidato(89.9) })
    const t = sanearTextoComercial('Gancho\n30% OFF só hoje\nCompre no link', d)
    assert.equal(t.texto, `Gancho\n${FALLBACK_DO_PRECO}\nCompre no link`)
    assert.equal(sanearTextoComercial('Use o cupom PATRONO10', d).texto, FALLBACK_DO_PRECO, 'cupom sem fonte nunca vai ao ar')
  })
  test('5. indisponível na fonte oficial: nenhum preço publicável', () => {
    const d = decidirDadosComerciais({ agora: new Date(DIA1.getTime() + H), oficial: oficial(79.9, DIA1, { disponivel: false }), produto: null, candidato: candidato(79.9) })
    assert.equal(d.disponivel, false)
    assert.equal(d.precoPublicavel, null)
  })
  test('6/7. não confirmável ou só o preço antigo do banco: PREÇO NÃO CONFIRMADO = PREÇO NÃO PUBLICADO', () => {
    const semFonte = decidirDadosComerciais({ agora: DIA1, oficial: null, produto: null, candidato: candidato(79.9) })
    assert.equal(semFonte.status, 'PRECO_NAO_VERIFICADO')
    assert.equal(semFonte.precoPublicavel, null)
    assert.equal(semFonte.preco, 79.9, 'o valor salvo continua no registro (histórico), mas não é publicável')
    const vencido = decidirDadosComerciais({ agora: new Date(DIA1.getTime() + 72 * H), oficial: oficial(79.9, DIA1), produto: null, candidato: candidato(79.9) })
    assert.equal(vencido.status, 'PRECO_DESATUALIZADO')
    assert.equal(vencido.precoPublicavel, null)
    assert.equal(sanearTextoComercial('Compre por R$ 79,90.', vencido).texto, FALLBACK_DO_PRECO, 'dia 4 sem nova confirmação: "Confira o valor atual no link."')
    const titular = decidirDadosComerciais({ agora: new Date(DIA1.getTime() + H), oficial: null, produto: null, candidato: candidato(79.9, { fonte: 'USER_PROVIDED' }) })
    assert.equal(titular.fonte, 'TITULAR')
    assert.equal(titular.confianca, 'MEDIA')
    assert.equal(titular.precoPublicavel, 79.9, 'informado pela titular há 1 h: dentro do prazo')
  })
  test('9/10. legenda com preço errado é corrigida sem tocar no vídeo; texto sem preço segue igual', () => {
    const d = decidirDadosComerciais({ agora: DIA1, oficial: null, produto: null, candidato: candidato(79.9) })
    const v = { gancho: 'Olha isso', cta: 'Link no carrinho', legenda: 'Amei!\nSai por R$ 79,90\n#achadinhos', roteiro: [{ textoNaTela: 'Olha isso' }] }
    const r = revisarVersao(v, d)
    assert.equal(r.legendaMudou, true)
    assert.equal(r.queimadoMudou, false)
    assert.equal(r.versao.legenda, `Amei!\n${FALLBACK_DO_PRECO}\n#achadinhos`)
    const sem = revisarVersao({ ...v, legenda: 'Amei!\n#achadinhos' }, d)
    assert.equal(sem.legendaMudou, false)
    assert.equal(mencionaDadoComercial('Amei!\n#achadinhos'), false)
  })
  test('8 (puro). preço no texto queimado no vídeo exige regerar', () => {
    const d = decidirDadosComerciais({ agora: DIA1, oficial: null, produto: null, candidato: candidato(79.9) })
    const r = revisarVersao({ gancho: 'Só R$ 79,90', cta: 'Link', legenda: 'x', roteiro: [{ textoNaTela: 'Só R$ 79,90' }] }, d)
    assert.equal(r.queimadoMudou, true)
    assert.equal(r.versao.gancho, FALLBACK_DO_PRECO)
  })
})

describe('revalidação comercial (banco de TESTE)', { skip: !TEM_BANCO ? 'exige banco de TESTE' : false, timeout: 900_000 }, () => {
  let prisma: typeof import('../lib/prisma').prisma
  let J: typeof import('../lib/jornada')
  let C: typeof import('../lib/dados-comerciais')
  let A: typeof import('../lib/publicacao-assistida')
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  const PREFIXO = 'Conta de Teste — '
  const marca = `r101-${Date.now()}`
  const workspaces: string[] = []
  const usuarios: Record<string, string> = {}

  async function novoWorkspace(nome: string) {
    const ws = (await prisma.workspace.create({ data: { name: `${PREFIXO}${nome} r101`, ownerId: `${marca}-${nome}` }, select: { id: true } })).id
    workspaces.push(ws)
    usuarios[ws] = (await prisma.user.create({ data: { email: `${marca}-${workspaces.length}@teste.local`, name: 'U', password: 'x', workspaceId: ws }, select: { id: true } })).id
    return ws
  }
  async function candidatoTikTok(ws: string, preco: number) {
    const ext = `9000000101${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 1000)}`
    const c = await prisma.candidatoDeProduto.create({
      data: {
        workspaceId: ws, chaveDeOrigem: `${marca}-${ext}`, fonte: 'USER_PROVIDED', nome: 'FIXTURE Garrafa', categoria: 'Casa', preco, providerId: 'tiktok-shop', externalId: ext,
        linkProduto: `https://www.tiktok.com/view/product/${ext}`, score: 60, baseDeEvidencia: 60, confianca: 'SEM_HISTORICO_REAL', status: 'APRESENTADO', coletadoEm: new Date('2026-01-01'), validoAte: new Date('2027-01-01'),
        motivosPositivos: [], riscos: [], desconhecidos: [], porqueDestaPosicao: [], nivelDeRisco: 'BAIXO',
      },
      select: { id: true },
    })
    return { candidatoId: c.id, chave: `tiktok-shop:${ext}` }
  }
  const oficialNoBanco = (ws: string, chave: string, preco: number, em: Date, extra: Record<string, unknown> = {}) =>
    prisma.dadoOficialDeProduto.upsert({
      where: { workspaceId_chave: { workspaceId: ws, chave } },
      create: { workspaceId: ws, chave, preco, fonte: 'TIKTOK_SHOP_AFFILIATE_API', situacao: 'OK', consultadoEm: em, atualizadoEm: em, disponivel: true, ...extra },
      update: { preco, consultadoEm: em, atualizadoEm: em, ...extra },
    })
  /** Publicação pronta para aprovar, com o vídeo "gerado" (FIXTURE) e o texto pedido. */
  async function prontaParaAprovar(ws: string, candidatoId: string, texto: { gancho?: string; legenda?: string }) {
    await J.escolherProduto({ workspaceId: ws, userId: usuarios[ws], candidatoId, emMaos: true })
    const a = await prisma.publicacaoAssistida.findFirstOrThrow({ where: { workspaceId: ws, candidatoId } })
    const ap = a.apresentacao as Record<string, unknown> & { versao: Record<string, unknown> }
    const versao = { ...ap.versao, ...(texto.gancho ? { gancho: texto.gancho, roteiro: [{ ...((ap.versao.roteiro as object[])[0] ?? {}), textoNaTela: texto.gancho }] } : {}), ...(texto.legenda ? { legenda: texto.legenda } : {}) }
    await prisma.publicacaoAssistida.update({
      where: { id: a.id },
      data: { estado: 'AGUARDANDO_APROVACAO', apresentacao: { ...ap, versao, video: { arquivo: 'https://exemplo.invalid/fixture.mp4', situacao: 'GERADO' } } as never, qualityGate: { veredito: 'APROVADO', arquivo: { fixture: true } } as never },
    })
    return a.id
  }

  before(async () => {
    ;[{ prisma }, J, C, A, { limparWorkspaceDeTeste: limpar }] = await Promise.all([import('../lib/prisma'), import('../lib/jornada'), import('../lib/dados-comerciais'), import('../lib/publicacao-assistida'), import('./_limpar-workspace-de-teste')])
  })
  after(async () => {
    if (prisma) {
      await prisma.domainEvent.deleteMany({ where: { workspaceId: { in: workspaces } } }).catch(() => null)
      await prisma.decisionRecord.deleteMany({ where: { workspaceId: { in: workspaces } } }).catch(() => null)
      await prisma.dadoOficialDeProduto.deleteMany({ where: { workspaceId: { in: workspaces } } }).catch(() => null)
      for (const w of workspaces) await limpar(prisma, w, PREFIXO)
    }
    await prisma?.$disconnect()
  })

  test('79,90 no dia 1 → 89,90 no dia 3: a fonte única passa a 89,90, PRICE_CHANGED guarda o anterior, e 79,90 nunca volta como atual', async () => {
    const ws = await novoWorkspace('preco')
    const { candidatoId, chave } = await candidatoTikTok(ws, 79.9)
    const dia3 = new Date(Date.now() - H)
    await oficialNoBanco(ws, chave, 89.9, dia3)
    // 12. duas verificações simultâneas
    const [d1, d2] = await Promise.all([C.revalidarDadosComerciais({ workspaceId: ws, candidatoId }), C.revalidarDadosComerciais({ workspaceId: ws, candidatoId })])
    assert.equal(d1!.precoPublicavel, 89.9)
    assert.equal(d2!.precoPublicavel, 89.9)
    assert.equal((await prisma.candidatoDeProduto.findUniqueOrThrow({ where: { id: candidatoId } })).preco, 89.9)
    const ev = await prisma.domainEvent.findMany({ where: { workspaceId: ws, tipo: 'PRICE_CHANGED', entidadeId: candidatoId } })
    assert.equal(ev.length, 1, 'uma mudança, um evento (sem conflito)')
    assert.deepEqual({ anterior: (ev[0].payload as { anterior: number }).anterior, novo: (ev[0].payload as { novo: number }).novo }, { anterior: 79.9, novo: 89.9 })
    assert.equal(C.sanearTextoComercial('Leve por R$ 79,90', d1!).texto, C.FALLBACK_DO_PRECO)
    assert.equal(C.sanearTextoComercial('Leve por R$ 89,90', d1!).mudou, false, 'nova publicação pode usar 89,90')
  })

  test('8. vídeo pronto com preço que não pode mais ser confirmado: aprovar é bloqueado e o vídeo é gerado de novo sem o valor', async () => {
    const ws = await novoWorkspace('video')
    const { candidatoId } = await candidatoTikTok(ws, 79.9)
    const id = await prontaParaAprovar(ws, candidatoId, { gancho: 'Só R$ 79,90 hoje' })
    await assert.rejects(() => A.aprovarEPublicar({ workspaceId: ws, userId: usuarios[ws], id }), /gerando de novo sem o valor/)
    const a = await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id } })
    const ap = a.apresentacao as { versao: { gancho: string }; video: { arquivo: string | null } }
    assert.notEqual(a.estado, 'AGUARDANDO_APROVACAO', 'volta para gerar')
    assert.equal(ap.versao.gancho, C.FALLBACK_DO_PRECO)
    assert.ok(!ap.video.arquivo, 'o arquivo antigo não é aproveitado')
    assert.ok((a.historico as { acao: string }[]).some((h) => h.acao === 'DADOS_COMERCIAIS_DESATUALIZADOS'))
  })

  test('9. legenda com preço não confirmado: corrigida na sincronização da Operação, sem regerar o vídeo; 10. sem preço não muda nada', async () => {
    const ws = await novoWorkspace('legenda')
    const { candidatoId } = await candidatoTikTok(ws, 79.9)
    const id = await prontaParaAprovar(ws, candidatoId, { legenda: 'Amei!\nSai por R$ 79,90\n#achadinhos' })
    await J.sincronizarOperacao({ workspaceId: ws, userId: usuarios[ws] })
    const a = await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id } })
    assert.equal(a.estado, 'AGUARDANDO_APROVACAO', 'o vídeo não precisa ser gerado de novo')
    assert.equal((a.apresentacao as { versao: { legenda: string } }).versao.legenda, `Amei!\n${C.FALLBACK_DO_PRECO}\n#achadinhos`)
    // de novo: nada muda (idempotente)
    const r = await A.revisarComercialDaAssistida({ workspaceId: ws, id })
    assert.deepEqual(r, { regerou: false, legendaCorrigida: false, indisponivel: false })
  })

  test('5. produto indisponível na fonte oficial: não aprova nem publica', async () => {
    const ws = await novoWorkspace('indisponivel')
    const { candidatoId, chave } = await candidatoTikTok(ws, 79.9)
    const id = await prontaParaAprovar(ws, candidatoId, {})
    await oficialNoBanco(ws, chave, 79.9, new Date(Date.now() - H), { disponivel: false })
    await assert.rejects(() => A.aprovarEPublicar({ workspaceId: ws, userId: usuarios[ws], id }), /indisponível/)
    assert.ok(await prisma.domainEvent.findFirst({ where: { workspaceId: ws, tipo: 'PRODUCT_BECAME_UNAVAILABLE' } }))
  })

  test('11. publicação histórica mantém o preço confirmado na época (nunca reescrita)', async () => {
    const ws = await novoWorkspace('historico')
    const { candidatoId, chave } = await candidatoTikTok(ws, 79.9)
    await oficialNoBanco(ws, chave, 79.9, new Date(Date.now() - H))
    const id = await prontaParaAprovar(ws, candidatoId, { legenda: 'Por R$ 79,90' })
    await A.revisarComercialDaAssistida({ workspaceId: ws, id })
    // P2.50 (P4): só conclui publicação APROVADA (antes o teste concluía direto de AGUARDANDO_APROVACAO).
    await prisma.publicacaoAssistida.update({ where: { id }, data: { estado: 'APROVADO' } })
    await A.concluirPublicacaoAssistida({ workspaceId: ws, id, postId: null, url: 'https://www.tiktok.com/@fixture/video/1', modo: 'MANUAL_PELA_TITULAR' })
    // preço muda depois
    await oficialNoBanco(ws, chave, 99.9, new Date())
    await C.revalidarDadosComerciais({ workspaceId: ws, candidatoId })
    const r = await A.revisarComercialDaAssistida({ workspaceId: ws, id })
    assert.deepEqual(r, { regerou: false, legendaCorrigida: false, indisponivel: false }, 'publicada não é tocada')
    const a = await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id } })
    const pub = (a.historico as { acao: string; comercial?: { preco: number; precoPublicavel: number } }[]).find((h) => h.acao === 'PUBLICADO')!
    assert.equal(pub.comercial!.precoPublicavel, 79.9, 'o preço confirmado na época fica')
    assert.equal(((a.versaoFinal ?? a.apresentacao) as { legenda?: string; versao?: { legenda: string } }).legenda ?? (a.apresentacao as { versao: { legenda: string } }).versao.legenda, 'Por R$ 79,90')
  })
})
