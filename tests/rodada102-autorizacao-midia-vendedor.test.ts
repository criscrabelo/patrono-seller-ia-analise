/**
 * P2.18.10 — AUTORIZAÇÃO GERAL DE MÍDIA DO VENDEDOR.
 *
 * Trava: autorização geral aprovada; reaproveitamento em 2 produtos da mesma
 * loja; outra loja não reaproveita; revogação bloqueia o uso futuro (publicado
 * fica); resposta ambígua não vira autorização; silêncio não é autorização;
 * mídia de terceiro exige revisão (VERIFICAR_DIREITOS_ESPECIFICOS); refresh
 * mantém o status; sem duplicação. Nada é enviado ao vendedor.
 * Banco e storage (URL) de TESTE.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { classificarResposta, cobre, chaveDaLoja, provenienciaDaMidia, MENSAGEM_PADRAO_GERAL, ESCOPO_DA_MENSAGEM_GERAL } from '../lib/autorizacao-midia-vendedor'

const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')
const AGORA = new Date('2026-10-15T12:00:00-03:00')

describe('regras (puras)', () => {
  test('resposta: só a afirmação inequívoca aprova; condição/ambiguidade → revisão; negativa → negada; silêncio → pendente', () => {
    assert.equal(classificarResposta('Autorizo o uso dos vídeos e imagens dos produtos da minha loja que forem divulgados por você como afiliada, nos termos desta mensagem.'), 'APROVADA')
    assert.equal(classificarResposta('autorizamos sim, pode usar os vídeos'), 'APROVADA')
    assert.equal(classificarResposta('Pode usar, mas só no TikTok'), 'PENDENTE_DE_REVISAO')
    assert.equal(classificarResposta('Autorizo os vídeos, desde que não corte'), 'PENDENTE_DE_REVISAO')
    assert.equal(classificarResposta('oi, vou ver com o dono'), 'PENDENTE_DE_REVISAO')
    assert.equal(classificarResposta('Não autorizo.'), 'NEGADA')
    assert.equal(classificarResposta(''), 'PENDENTE')
    assert.equal(classificarResposta(null), 'PENDENTE')
  })
  test('a mensagem padrão é a da titular, com a frase de resposta', () => {
    assert.match(MENSAGEM_PADRAO_GERAL, /autorização geral para utilização dos conteúdos audiovisuais/)
    assert.match(MENSAGEM_PADRAO_GERAL, /‘Autorizo o uso dos vídeos e imagens dos produtos da minha loja/)
  })
  test('cobertura: escopo, indício de terceiro, loja, revogação e expiração', () => {
    const base = { status: 'APROVADA', tipo: 'GERAL', candidatoIds: ['c1'], ...ESCOPO_DA_MENSAGEM_GERAL, evidenciaUrl: null, respostaDoVendedor: 'Autorizo os vídeos', validaAte: null, dataRevogacao: null }
    const uso = { candidatoId: 'c1', canal: 'tiktok', tipoDeMidia: 'VIDEO' as const, edita: true }
    assert.deepEqual(cobre(base, uso, AGORA), { ok: true })
    assert.match((cobre(base, { ...uso, candidatoId: 'c9' }, AGORA) as { motivo: string }).motivo, /não é desta loja/)
    assert.match((cobre(base, { ...uso, indicios: ['MUSICA_LICENCIADA'] }, AGORA) as { motivo: string }).motivo, /VERIFICAR_DIREITOS_ESPECIFICOS/)
    assert.deepEqual(cobre({ ...base, tipo: 'ESPECIFICA' }, { ...uso, indicios: ['MUSICA_LICENCIADA'] }, AGORA), { ok: true }, 'a específica do produto cobre')
    assert.match((cobre({ ...base, status: 'REVOGADA' }, uso, AGORA) as { motivo: string }).motivo, /revogada/)
    assert.match((cobre({ ...base, validaAte: new Date('2026-01-01') }, uso, AGORA) as { motivo: string }).motivo, /expirada/)
    assert.match((cobre({ ...base, respostaDoVendedor: null }, uso, AGORA) as { motivo: string }).motivo, /Sem prova/)
    assert.match((cobre({ ...base, edicaoPermitida: false }, uso, AGORA) as { motivo: string }).motivo, /Edição/)
  })
  test('identidade da loja nunca une por semelhança; proveniência no vocabulário pedido', () => {
    assert.equal(chaveDaLoja({ lojaNome: '  Loja da Maria ' }), 'nome:loja da maria')
    assert.notEqual(chaveDaLoja({ lojaNome: 'Loja da Maria' }), chaveDaLoja({ lojaNome: 'Loja da Maria 2' }))
    assert.equal(chaveDaLoja({ provider: 'tiktok-shop', lojaId: '123', lojaNome: 'X' }), 'tiktok-shop:123')
    assert.equal(provenienciaDaMidia({ origem: 'PROPRIO', evidencia: null }, null), 'USER_OWNED')
    assert.equal(provenienciaDaMidia({ origem: 'FORNECEDOR', evidencia: null }, { tipo: 'GERAL' }), 'SELLER_AUTHORIZED')
    assert.equal(provenienciaDaMidia({ origem: 'FORNECEDOR', evidencia: null }, { tipo: 'ESPECIFICA' }), 'SELLER_SPECIFIC_AUTHORIZATION')
    assert.equal(provenienciaDaMidia({ origem: 'FORNECEDOR', evidencia: null }, null), 'UNKNOWN')
  })
})

describe('autorização de mídia do vendedor (banco de TESTE)', { skip: !TEM_BANCO ? 'exige banco de TESTE' : false, timeout: 900_000 }, () => {
  let prisma: typeof import('../lib/prisma').prisma
  let V: typeof import('../lib/autorizacao-midia-vendedor')
  let M: typeof import('../lib/midia-do-produto')
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  const PREFIXO = 'Conta de Teste — '
  const marca = `r102-${Date.now()}`
  const workspaces: string[] = []
  const usuarios: Record<string, string> = {}
  const urlDoProjeto = (nome: string) => `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/imagens/ws-fixture/${marca}-${nome}.jpg`

  async function novoWorkspace(nome: string) {
    const ws = (await prisma.workspace.create({ data: { name: `${PREFIXO}${nome} r102`, ownerId: `${marca}-${nome}` }, select: { id: true } })).id
    workspaces.push(ws)
    usuarios[ws] = (await prisma.user.create({ data: { email: `${marca}-${workspaces.length}@teste.local`, name: 'U', password: 'x', workspaceId: ws }, select: { id: true } })).id
    return ws
  }
  async function candidato(ws: string, nome: string) {
    const n = `${Date.now()}${Math.floor(Math.random() * 1000)}`
    return (await prisma.candidatoDeProduto.create({
      data: {
        workspaceId: ws, chaveDeOrigem: `${marca}-${nome}-${n}`, fonte: 'USER_PROVIDED', nome: `FIXTURE ${nome}`, categoria: 'Casa', preco: 49.9, providerId: 'tiktok-shop', externalId: `9000000102${n}`,
        linkProduto: `https://www.tiktok.com/view/product/9000000102${n}`, score: 60, baseDeEvidencia: 60, confianca: 'SEM_HISTORICO_REAL', status: 'APRESENTADO', coletadoEm: new Date(), validoAte: new Date('2027-01-01'),
        motivosPositivos: [], riscos: [], desconhecidos: [], porqueDestaPosicao: [], nivelDeRisco: 'BAIXO',
      },
      select: { id: true },
    })).id
  }
  const midiaDoVendedor = (ws: string, candidatoId: string, nome: string, indicios: string[] = []) =>
    M.registrarMidia({
      workspaceId: ws, candidatoId, nomeProduto: nome,
      declaracao: { url: urlDoProjeto(`${nome}-${indicios.join('-')}`), tipo: 'IMAGEM', origem: 'FORNECEDOR', titularidade: 'Vendedor', direitoDeUso: 'Autorização do vendedor', declaradoPor: usuarios[ws], declaradoEm: new Date(), descricao: `foto do vendedor ${nome}`, indicios: indicios as never },
    })

  before(async () => {
    ;[{ prisma }, V, M, { limparWorkspaceDeTeste: limpar }] = await Promise.all([import('../lib/prisma'), import('../lib/autorizacao-midia-vendedor'), import('../lib/midia-do-produto'), import('./_limpar-workspace-de-teste')])
  })
  after(async () => {
    if (prisma) {
      await prisma.domainEvent.deleteMany({ where: { workspaceId: { in: workspaces } } }).catch(() => null)
      await prisma.autorizacaoDeMidiaDoVendedor.deleteMany({ where: { workspaceId: { in: workspaces } } }).catch(() => null)
      await prisma.midiaDoProduto.deleteMany({ where: { workspaceId: { in: workspaces } } }).catch(() => null)
      for (const w of workspaces) await limpar(prisma, w, PREFIXO)
    }
    await prisma?.$disconnect()
  })

  test('sem autorização: mídia do vendedor BLOQUEADA ("Autorização necessária"); silêncio continua pendente', async () => {
    const ws = await novoWorkspace('sem')
    const c = await candidato(ws, 'Livro')
    const m = await midiaDoVendedor(ws, c, 'livro')
    assert.equal(m.status, 'BLOQUEADA')
    assert.match(m.motivoStatus, /Autorização necessária/)
    const a = await V.solicitarAutorizacao({ workspaceId: ws, userId: usuarios[ws], candidatoId: c, lojaNome: 'Loja Emoção' })
    assert.equal(a.status, 'PENDENTE')
    const sit = await V.situacaoDaMidiaDoVendedor(ws, c)
    assert.equal(sit.autorizada, false)
    assert.match(sit.rotulo, /aguardando resposta/)
    await assert.rejects(() => V.registrarResposta({ workspaceId: ws, userId: usuarios[ws], id: a.id, resposta: '' }), /Cole a resposta/)
  })

  test('geral aprovada: reaproveita em 2 produtos da mesma loja, sem novo pedido; outra loja não reaproveita; sem duplicação; refresh mantém', async () => {
    const ws = await novoWorkspace('geral')
    const [livro, giz, outro] = [await candidato(ws, 'Livro'), await candidato(ws, 'Giz'), await candidato(ws, 'Outra loja')]
    const a = await V.solicitarAutorizacao({ workspaceId: ws, userId: usuarios[ws], candidatoId: livro, lojaNome: 'Loja Emoção' })
    const deNovo = await V.solicitarAutorizacao({ workspaceId: ws, userId: usuarios[ws], candidatoId: giz, lojaNome: 'loja emoção ' })
    assert.equal(deNovo.id, a.id, 'mesma loja: não pede de novo, só associa')
    await V.solicitarAutorizacao({ workspaceId: ws, userId: usuarios[ws], candidatoId: giz, lojaNome: 'Loja Emoção' })
    assert.deepEqual((await prisma.autorizacaoDeMidiaDoVendedor.findUniqueOrThrow({ where: { id: a.id } })).candidatoIds.sort(), [livro, giz].sort(), 'sem duplicar o produto')
    assert.equal(await prisma.autorizacaoDeMidiaDoVendedor.count({ where: { workspaceId: ws } }), 1)
    const ml = await midiaDoVendedor(ws, livro, 'livro')
    assert.equal(ml.status, 'BLOQUEADA', 'antes da resposta')
    const r = await V.registrarResposta({ workspaceId: ws, userId: usuarios[ws], id: a.id, resposta: 'Autorizo o uso dos vídeos e imagens dos produtos da minha loja que forem divulgados por você como afiliada, nos termos desta mensagem.' })
    assert.equal(r.status, 'APROVADA')
    assert.equal((await prisma.midiaDoProduto.findUniqueOrThrow({ where: { id: ml.id } })).status, 'AUTORIZADA', 'a mídia já registrada é reavaliada sozinha')
    const mg = await midiaDoVendedor(ws, giz, 'giz')
    assert.equal(mg.status, 'AUTORIZADA', 'o 2º produto da mesma loja reaproveita')
    assert.equal(((mg.evidencia as { termoDeLicenca: string }).termoDeLicenca), `${V.PREFIXO_DO_TERMO}${a.id}`, 'o termo é a autorização registrada')
    assert.equal((await M.midiasAutorizadas({ workspaceId: ws, candidatoId: giz })).length, 1)
    const mo = await midiaDoVendedor(ws, outro, 'outro')
    assert.equal(mo.status, 'BLOQUEADA', 'produto de outra loja não reaproveita')
    for (let i = 0; i < 2; i++) assert.match((await V.situacaoDaMidiaDoVendedor(ws, giz)).rotulo, /geral: APROVADA/, 'refresh mantém')
  })

  test('resposta ambígua não vira autorização; a titular pode revisar e aprovar com a prova', async () => {
    const ws = await novoWorkspace('ambigua')
    const c = await candidato(ws, 'Livro')
    const a = await V.solicitarAutorizacao({ workspaceId: ws, userId: usuarios[ws], candidatoId: c, lojaNome: 'Loja X' })
    const r = await V.registrarResposta({ workspaceId: ws, userId: usuarios[ws], id: a.id, resposta: 'pode usar mas só no tiktok' })
    assert.equal(r.status, 'PENDENTE_DE_REVISAO')
    assert.equal((await midiaDoVendedor(ws, c, 'livro')).status, 'BLOQUEADA')
    const so = await V.registrarResposta({ workspaceId: ws, userId: usuarios[ws], id: a.id, evidenciaUrl: urlDoProjeto('print') })
    assert.equal(so.status, 'PENDENTE_DE_REVISAO', 'só o print: alguém precisa ler')
    const rev = await V.confirmarRevisao({ workspaceId: ws, userId: usuarios[ws], id: a.id, aprovar: true })
    assert.equal(rev.status, 'APROVADA')
  })

  test('mídia com indício de terceiro: a geral não basta (VERIFICAR_DIREITOS_ESPECIFICOS); a específica do produto cobre', async () => {
    const ws = await novoWorkspace('terceiro')
    const c = await candidato(ws, 'Giz')
    const a = await V.solicitarAutorizacao({ workspaceId: ws, userId: usuarios[ws], candidatoId: c, lojaNome: 'Loja Y' })
    await V.registrarResposta({ workspaceId: ws, userId: usuarios[ws], id: a.id, resposta: 'Autorizo o uso dos vídeos e imagens' })
    const m = await midiaDoVendedor(ws, c, 'giz', ['INFLUENCIADOR'])
    assert.equal(m.status, 'BLOQUEADA')
    assert.match(m.motivoStatus, /VERIFICAR_DIREITOS_ESPECIFICOS/)
    const esp = await V.solicitarAutorizacao({ workspaceId: ws, userId: usuarios[ws], candidatoId: c, lojaNome: 'Loja Y', tipo: 'ESPECIFICA' })
    await V.registrarResposta({ workspaceId: ws, userId: usuarios[ws], id: esp.id, resposta: 'Autorizo o uso deste vídeo com a influenciadora' })
    assert.equal((await prisma.midiaDoProduto.findUniqueOrThrow({ where: { id: m.id } })).status, 'AUTORIZADA')
  })

  test('revogação bloqueia o uso futuro: mídia volta a BLOQUEADA, vídeo pendente volta a pedir mídia, publicado fica', async () => {
    const ws = await novoWorkspace('revoga')
    const c = await candidato(ws, 'Livro')
    const a = await V.solicitarAutorizacao({ workspaceId: ws, userId: usuarios[ws], candidatoId: c, lojaNome: 'Loja Z' })
    await V.registrarResposta({ workspaceId: ws, userId: usuarios[ws], id: a.id, resposta: 'Autorizo o uso dos vídeos e imagens' })
    const m = await midiaDoVendedor(ws, c, 'livro')
    assert.equal(m.status, 'AUTORIZADA')
    const base = { workspaceId: ws, candidatoId: c, nomeProduto: 'FIXTURE Livro', varianteId: 'v1', estrutura: 'DEMONSTRACAO', qualityGate: {}, historico: [], motivoEscolha: 'x', objetivoDoTeste: 'x', vezesQueOProdutoApareceu: 0, horarioPlanejado: new Date(), metasIds: [] }
    const pendente = await prisma.publicacaoAssistida.create({ data: { ...base, estado: 'AGUARDANDO_APROVACAO', apresentacao: { video: { arquivo: 'https://exemplo.invalid/v.mp4', midiaId: m.id } } } as never })
    const publicada = await prisma.publicacaoAssistida.create({ data: { ...base, estado: 'PUBLICADO', publicadoEm: new Date(), apresentacao: { video: { arquivo: 'https://exemplo.invalid/p.mp4', midiaId: m.id } } } as never })
    await V.revogarAutorizacao({ workspaceId: ws, userId: usuarios[ws], id: a.id, motivo: 'vendedor pediu' })
    assert.equal((await prisma.midiaDoProduto.findUniqueOrThrow({ where: { id: m.id } })).status, 'BLOQUEADA')
    assert.equal((await M.midiasAutorizadas({ workspaceId: ws, candidatoId: c })).length, 0, 'nenhum uso futuro')
    const p1 = await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id: pendente.id } })
    assert.equal(p1.estado, 'AGUARDANDO_MIDIA')
    assert.equal((p1.apresentacao as { video: { arquivo: string | null } }).video.arquivo, null)
    const p2 = await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id: publicada.id } })
    assert.equal(p2.estado, 'PUBLICADO', 'o publicado fica')
    assert.ok(await prisma.domainEvent.findFirst({ where: { workspaceId: ws, tipo: 'MEDIA_AUTHORIZATION_REVOKED' } }))
    await assert.rejects(() => V.registrarResposta({ workspaceId: ws, userId: usuarios[ws], id: a.id, resposta: 'Autorizo de novo' }), /revogada/)
  })
})
