/**
 * P2.29 — E2E DO CICLO COMPLETO (um cenário só, banco e storage de TESTE, nada publicado de verdade):
 * produto → escolha → produto em mãos → mídia → autorização → vídeo (render real) → aprovação → publicação
 * assistida → resultado → PEDIDO (CSV do Creator Center com o postId) → COMISSÃO (estimada → liquidada, sem
 * duplicar a informada) → APRENDIZADO (o vídeo entra com a comissão) → PRÓXIMA RECOMENDAÇÃO (outro produto).
 * Prova que o ciclo fecha. Reaproveita o caminho do rodada96-A e continua de onde ele para.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
// P2.45: este arquivo testa o fluxo de publicação ANTERIOR aos três controles (técnico, comercial, conformidade).
process.env.PATRONO_TESTE_LEGADO_SEM_TRES_CONTROLES = 'true'

const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')
const TEM_STORAGE = !!process.env.SUPABASE_SERVICE_ROLE_KEY && (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').includes('ref-teste-exemplo')

describe('P2.29 — ciclo completo (banco de TESTE)', { skip: !TEM_BANCO ? 'exige banco de TESTE' : false, timeout: 900_000 }, () => {
  let prisma: typeof import('../lib/prisma').prisma
  let J: typeof import('../lib/jornada')
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  const PREFIXO = 'Conta de Teste — '
  const marca = `r116-${Date.now()}`
  const workspaces: string[] = []
  const usuarios: Record<string, string> = {}

  async function novoWorkspace(nome: string) {
    const ws = (await prisma.workspace.create({ data: { name: `${PREFIXO}${nome} r116`, ownerId: `${marca}-${nome}` }, select: { id: true } })).id
    workspaces.push(ws)
    usuarios[ws] = (await prisma.user.create({ data: { email: `${marca}-${workspaces.length}@teste.local`, name: 'U', password: 'x', workspaceId: ws }, select: { id: true } })).id
    return ws
  }
  async function candidato(ws: string, nome: string, extra: Record<string, unknown> = {}) {
    const n = String(Date.now()).slice(-6) + Math.floor(Math.random() * 1000)
    return (await prisma.candidatoDeProduto.create({
      data: {
        // P2.22: dados de um produto bom (comissão e demanda conhecidas): o fluxo da amostra só abre com decisão favorável do SampleOpportunityScore.
        workspaceId: ws, chaveDeOrigem: `${marca}-${nome}-${n}`, fonte: 'USER_PROVIDED', nome: `FIXTURE ${nome}`, categoria: 'Moda', preco: 99.9, comissaoValor: 12, vendas: 1500, providerId: 'tiktok-shop', externalId: `9000000096${n}`,
        linkProduto: `https://www.tiktok.com/view/product/9000000096${n}`, score: 60, baseDeEvidencia: 60, confianca: 'SEM_HISTORICO_REAL', status: 'APRESENTADO', coletadoEm: new Date(), validoAte: new Date('2027-01-01'),
        motivosPositivos: ['Vende bem no app'], riscos: [], desconhecidos: [], porqueDestaPosicao: [], nivelDeRisco: 'BAIXO', ...extra,
      },
      select: { id: true },
    })).id
  }
  const visao = async (ws: string, agora = new Date()) => J.visaoDaOperacao(await J.sincronizarOperacao({ workspaceId: ws, userId: usuarios[ws], agora }))
  const responder = (ws: string, candidatoId: string, resposta: string, extra: Partial<import('../lib/jornada').RespostaDaTitular> = {}) =>
    J.responderNaJornada({ workspaceId: ws, userId: usuarios[ws], candidatoId, resposta, ...extra }).then(J.visaoDaOperacao)

  before(async () => {
    ;[{ prisma }, J, { limparWorkspaceDeTeste: limpar }] = await Promise.all([import('../lib/prisma'), import('../lib/jornada'), import('./_limpar-workspace-de-teste')])
  })
  after(async () => {
    if (prisma) {
      await prisma.domainEvent.deleteMany({ where: { workspaceId: { in: workspaces } } }).catch(() => null)
      await prisma.decisionRecord.deleteMany({ where: { workspaceId: { in: workspaces } } }).catch(() => null)
      for (const w of workspaces) await limpar(prisma, w, PREFIXO)
    }
    await prisma?.$disconnect()
  })


  test('o ciclo fecha: do produto escolhido à próxima recomendação, passando por pedido, comissão e aprendizado', { skip: !TEM_STORAGE ? 'exige storage de TESTE' : false }, async () => {
    const ws = await novoWorkspace('ciclo')
    const c = await candidato(ws, 'Garrafa térmica 500 ml', { categoria: 'Casa e Cozinha', comissaoValor: 5.99 })
    const proximo = await candidato(ws, 'Organizador de gaveta', { categoria: 'Casa e Cozinha', comissaoValor: 4.5, score: 50 })
    const { createClient } = await import('@supabase/supabase-js')
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const pasta = mkdtempSync(path.join(tmpdir(), 'r116-'))
    const subidos: { bucket: string; caminho: string }[] = []
    try {
      let v = await visao(ws)
      v = await responder(ws, c, 'TENHO_EM_MAOS')
      const j = v.prioritaria!
      assert.equal(j.acao!.tipo, 'FORNECER_MIDIA_REAL', 'já tenho → direto ao "O que gravar" (sem vitrine e sem amostra)')
      assert.deepEqual(j.progresso.filter((p) => p.situacao === 'PULADO').map((p) => p.passo), ['Vitrine', 'Amostra', 'Recebimento'])
      const cenas = (j.assistida!.apresentacao as { cenasParaGravar: string[] }).cenasParaGravar
      assert.ok(cenas.length >= 4 && /3 a 10 arquivos/.test(cenas.join(' ')))
      assert.equal(await prisma.amostraTikTokShop.count({ where: { workspaceId: ws } }), 0)

      // Upload em lote (4 mídias SINTÉTICAS, FIXTURE) pela mesma porta da tela (registrar + avançar o vídeo).
      const ff = (await import('ffmpeg-static')).default as unknown as string
      const M = await import('../lib/midia-do-produto')
      const A = await import('../lib/publicacao-assistida')
      const subir = async (bucket: string, arquivo: string, tipo: string) => {
        const caminho = `testes/r116/${marca}/${path.basename(arquivo)}`
        const { error } = await sb.storage.from(bucket).upload(caminho, readFileSync(arquivo), { contentType: tipo, upsert: true })
        if (error) throw error
        subidos.push({ bucket, caminho })
        return sb.storage.from(bucket).getPublicUrl(caminho).data.publicUrl
      }
      const midias: { url: string; tipo: 'IMAGEM' | 'VIDEO' }[] = []
      for (const [i, cor] of ['0x6a1b9a', '0x00838f', '0xef6c00'].entries()) {
        const f = path.join(pasta, `foto-${i}.jpg`)
        execFileSync(ff, ['-f', 'lavfi', '-i', `color=c=${cor}:s=1080x1350`, '-frames:v', '1', '-y', f], { stdio: 'ignore' })
        midias.push({ url: await subir('imagens', f, 'image/jpeg'), tipo: 'IMAGEM' })
      }
      const vid = path.join(pasta, 'video.mp4')
      execFileSync(ff, ['-f', 'lavfi', '-i', 'testsrc=size=720x1280:rate=30', '-t', '4', '-pix_fmt', 'yuv420p', '-y', vid], { stdio: 'ignore' })
      midias.push({ url: await subir('videos', vid, 'video/mp4'), tipo: 'VIDEO' })
      for (const [i, m] of midias.entries()) {
        const r = await M.registrarMidia({ workspaceId: ws, candidatoId: c, nomeProduto: 'FIXTURE Garrafa térmica 500 ml', declaracao: { url: m.url, tipo: m.tipo, origem: 'PROPRIO', titularidade: 'Titular da conta (eu)', direitoDeUso: 'Uso nas minhas redes', declaradoPor: usuarios[ws], declaradoEm: new Date(), descricao: `FIXTURE ${i + 1}/4`, declaracoes: m.tipo === 'VIDEO' ? { gravadoPelaPropriaDona: true, semMusicaDeTerceiros: true, semTerceirosNemCriancas: true } : null } })
        assert.equal(r.status, 'AUTORIZADA', r.motivoStatus ?? '')
      }
      await A.avancarVideo(await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id: j.assistida!.id } }))
      v = await visao(ws)
      assert.equal(v.prioritaria!.acao?.tipo, 'APROVAR_VIDEO', `render real → QG → aprovar (${v.prioritaria!.titulo})`)
      const ap = v.prioritaria!.assistida!
      const qg = ap.qualityGate as { veredito: string; arquivo: { largura: number; altura: number; duracaoS: number } }
      assert.equal(qg.veredito, 'APROVADO')
      assert.deepEqual([qg.arquivo.largura, qg.arquivo.altura], [1080, 1920])
      assert.ok(qg.arquivo.duracaoS > 3)
      const mp4 = (ap.apresentacao as { video: { arquivo: string } }).video.arquivo
      assert.equal((await fetch(mp4, { method: 'HEAD' })).status, 200, 'o MP4 existe de verdade')

      // Refazer (ajuste) não destrói as mídias.
      await A.pedirAjuste({ workspaceId: ws, userId: usuarios[ws], id: ap.id, motivo: 'Gancho mais direto', alteracoes: { gancho: 'Olha essa garrafa' } })
      assert.equal(await prisma.midiaDoProduto.count({ where: { workspaceId: ws, status: 'AUTORIZADA' } }), 4)
      v = await visao(ws)
      assert.equal(v.prioritaria!.acao?.tipo, 'APROVAR_VIDEO')

      await A.aprovarEPublicar({ workspaceId: ws, userId: usuarios[ws], id: ap.id })
      v = await visao(ws)
      const pub = v.prioritaria!
      assert.equal(pub.acao!.tipo, 'PUBLICAR_VIDEO', 'PRONTO PARA PUBLICAR (assistido, nada é publicado de verdade)')
      assert.equal(pub.executor, 'HUMANO')
      assert.equal(pub.acao!.linkExterno!.url, 'https://www.tiktok.com/upload')
      const final = (pub.assistida!.versaoFinal ?? (pub.assistida!.apresentacao as { versao: unknown }).versao) as { legenda: string; hashtags: string[]; cta: string; disclosure: string }
      assert.ok(final.legenda && final.hashtags.length && final.cta && final.disclosure, 'pacote completo: legenda, hashtags, CTA, aviso de afiliada')
      await assert.rejects(responder(ws, c, 'PUBLIQUEI', { url: 'nao-e-link' }), /link do vídeo/)
      v = await responder(ws, c, 'PUBLIQUEI', { url: 'https://www.tiktok.com/@fixture/video/7400000000000000961' })
      assert.equal(v.prioritaria?.candidatoId === c ? v.prioritaria.etapa : 'MEDINDO', 'MEDINDO')
      const depois = J.visaoDaOperacao(await J.carregarOperacao(ws, new Date(Date.now() + 49 * 3600_000)))
      const medir = [depois.prioritaria, ...depois.outras].find((x) => x?.candidatoId === c)
      assert.ok(medir)
      const ctx = await J.carregarOperacao(ws, new Date(Date.now() + 49 * 3600_000))
      assert.equal(ctx.jornadas.find((x) => x.fatos.candidato.id === c)!.estado.acao?.tipo, 'CONFIRMAR_RESULTADO_MANUAL')
      await J.responderNaJornada({ workspaceId: ws, userId: usuarios[ws], candidatoId: c, resposta: 'INFORMAR', numeros: { views: 1500, vendas: 1, comissao: 5.99 }, agora: new Date(Date.now() + 49 * 3600_000) })
      const fim = await J.carregarOperacao(ws, new Date(Date.now() + 50 * 3600_000))
      assert.equal(fim.jornadas.find((x) => x.fatos.candidato.id === c)!.estado.espera, 'CONCLUIDA', 'aprendizado registrado')
      const linha = await prisma.videoTikTokResultado.findFirstOrThrow({ where: { workspaceId: ws } })
      assert.equal(linha.origemMetricas, 'MANUAL', 'informado pela titular nunca vira "API"')

      // ── PEDIDO: o relatório do Creator Center traz a venda do vídeo publicado (postId) e do produto (id externo)
      const cand = await prisma.candidatoDeProduto.findUniqueOrThrow({ where: { id: c } })
      const POST = '7400000000000000961'
      assert.equal(linha.postId, POST, 'o resultado guarda o id do post (é por ele que o pedido se liga ao vídeo)')
      const I = await import('../lib/creator-center-importacao')
      const F = await import('../lib/financeiro')
      const antesDoPedido = await F.resumoFinanceiro(ws)
      const CAB = 'ID do pedido;ID do SKU;ID do produto;Nome do produto;Nome da loja;Quantidade;Valor do pedido;Taxa de comissão;Comissão estimada;Comissão real;Status do pedido;Status da liquidação;Data do pedido;Data de liquidação;Tipo de conteúdo;ID do conteúdo'
      const csv = (status: string, real: string, liq: string, dataLiq: string) => [CAB, ['PED-R116-1', 'sku1', cand.externalId, 'Garrafa térmica 500 ml', 'Loja X', '1', 'R$ 59,90', '10%', 'R$ 5,99', real, status, liq, '16/10/2026 10:00', dataLiq, 'Vídeo', POST].join(';')].join('\n')
      const imp1 = await I.importarCreatorCenter({ workspaceId: ws, userId: usuarios[ws], nomeArquivo: 'pedidos-1.csv', conteudo: csv('Pago', '', '', ''), dataOrigin: 'TEST_FIXTURE' })
      const ped = await prisma.pedidoAfiliadoTikTok.findFirstOrThrow({ where: { workspaceId: ws, pedidoId: 'PED-R116-1' } })
      assert.equal(ped.vinculoVideo, 'VINCULADO_POR_POST_ID', 'pedido ligado ao vídeo pelo postId')
      assert.equal(ped.vinculoProduto, 'VINCULADO_POR_ID_EXTERNO', 'pedido ligado ao produto pelo id externo (nunca por nome)')
      assert.equal(ped.videoResultadoId, linha.id)
      assert.equal(ped.estado, 'ESTIMADA')
      assert.equal((await I.situacaoDaImportacao(ws, imp1.importacaoId!))!.situacao, 'IMPORTADO')

      // ── COMISSÃO: estimada não é receita; liquidada é. A mesma linha reimportada não duplica.
      let s = await F.resumoFinanceiro(ws)
      assert.equal(s.confirmada, antesDoPedido.confirmada, 'estimada não vira receita')
      await I.importarCreatorCenter({ workspaceId: ws, userId: usuarios[ws], nomeArquivo: 'pedidos-1-de-novo.csv', conteudo: csv('Pago', '', '', '') + '\n', dataOrigin: 'TEST_FIXTURE' })
      assert.equal(await prisma.pedidoAfiliadoTikTok.count({ where: { workspaceId: ws } }), 1, 'reimportar não duplica o pedido')
      await I.importarCreatorCenter({ workspaceId: ws, userId: usuarios[ws], nomeArquivo: 'pedidos-2.csv', conteudo: csv('Concluído', 'R$ 5,99', 'Liquidado', '20/10/2026 10:00'), dataOrigin: 'TEST_FIXTURE' })
      assert.equal((await prisma.pedidoAfiliadoTikTok.findUniqueOrThrow({ where: { id: ped.id } })).estado, 'LIQUIDADA')
      s = await F.resumoFinanceiro(ws)
      assert.ok(Math.abs(s.liquidada - 5.99) < 0.001, `liquidada pela fonte canônica (${JSON.stringify(s)})`)
      assert.ok(s.confirmada <= antesDoPedido.confirmada + 5.99 + 0.001, `a comissão informada no vídeo e a do pedido não somam duas vezes (${antesDoPedido.confirmada} → ${s.confirmada})`)
      const cadeia = await F.cadeiaFinanceira(ws, { videoResultadoId: linha.id })
      assert.ok(cadeia.elos.length >= 1, 'cadeia produto → conteúdo → publicação → pedido montada pelo identificador')

      // ── APRENDIZADO: o vídeo entra no aprendizado com a comissão do pedido
      const R = await import('../lib/resultados-videos')
      const videos = await R.videosParaAprender(ws)
      const aprendido = videos.find((x) => x.id === linha.id)!
      assert.ok(aprendido, "o vídeo publicado entra no aprendizado")
      assert.ok((aprendido.comissaoConfirmada ?? 0) > 0, `com a comissão liquidada do pedido (${JSON.stringify({ c: aprendido.comissaoConfirmada, e: aprendido.comissaoEstimada })})`)
      const ap2 = await R.aprendizadoCriativoDoWorkspace(ws)
      assert.ok(ap2.aprendizado && ap2.orientacao, 'aprendizado e orientação do planejador gerados')

      // ── PRÓXIMA RECOMENDAÇÃO: com a jornada concluída, a Operação traz o próximo produto
      const prox = J.visaoDaOperacao(await J.sincronizarOperacao({ workspaceId: ws, userId: usuarios[ws], agora: new Date(Date.now() + 51 * 3600_000) }))
      assert.equal(prox.prioritaria?.candidatoId, proximo, `próxima recomendação = o outro produto (${prox.prioritaria?.titulo})`)
      assert.ok(prox.prioritaria?.acao, 'com a próxima ação para a titular')
      // e nada se duplicou no caminho
      assert.equal(await prisma.publicacaoAssistida.count({ where: { workspaceId: ws, candidatoId: c } }), 1)
      assert.equal(await prisma.videoTikTokResultado.count({ where: { workspaceId: ws } }), 1)
    } finally {
      for (const s of subidos) await sb.storage.from(s.bucket).remove([s.caminho]).catch(() => null)
      const gerados = await sb.storage.from('videos').list(`assistidas/${ws}`).catch(() => ({ data: [] as { name: string }[] }))
      if (gerados.data?.length) await sb.storage.from('videos').remove(gerados.data.map((x) => `assistidas/${ws}/${x.name}`)).catch(() => null)
      rmSync(pasta, { recursive: true, force: true })
    }
  })

  test('RECOMEÇAR OPERAÇÃO com operação cheia: a operação fica limpa; histórico, vendas, comissões (e o histórico delas), pedidos importados, aprendizado, usuários, integrações e quota permanecem; repetir não duplica', async () => {
    const ws = await novoWorkspace('recomeco')
    const P = await import('../lib/produto-canonico')
    const C = await import('../lib/precisa-de-voce-central')
    const I = await import('../lib/creator-center-importacao')
    const V = await import('../lib/vendas-comissoes')
    const Rc = await import('../lib/reconciliacao')
    const cs = [] as string[]
    for (const n of ['Garrafa', 'Bolsa', 'Luminária', 'Organizador']) cs.push(await candidato(ws, n))
    await J.escolherProduto({ workspaceId: ws, userId: usuarios[ws], candidatoId: cs[0], emMaos: true })
    await J.escolherProduto({ workspaceId: ws, userId: usuarios[ws], candidatoId: cs[1], emMaos: false })
    await visao(ws)
    // conteúdo e resultado já publicados (histórico), venda + comissão confirmada com histórico, pedido importado, integração, quota
    const pub = await prisma.publicacaoAssistida.findFirstOrThrow({ where: { workspaceId: ws, candidatoId: cs[0] } })
    await prisma.publicacaoAssistida.update({ where: { id: pub.id }, data: { estado: 'PUBLICADO', postId: '7400000000000001161', publicadoEm: new Date() } })
    const res = await prisma.videoTikTokResultado.create({ data: { workspaceId: ws, estrutura: 'POV', gancho: 'g', cta: 'A', duracaoSegundos: 15, publicadoEm: new Date(), postId: '7400000000000001161', origemMetricas: 'MANUAL', cliquesProduto: 3, tipoDeGancho: 'POV', versaoDoDna: 'dna@1' } as never })
    const venda = await prisma.sale.create({ data: { workspaceId: ws, amount: 80, status: 'CONFIRMED', source: 'manual', dataOrigin: 'TEST_FIXTURE' } })
    const com = await prisma.commission.create({ data: { workspaceId: ws, saleId: venda.id, expectedAmount: 8, status: 'EXPECTED' } })
    await V.atualizarComissao({ workspaceId: ws, commissionId: com.id, actorUserId: usuarios[ws], status: 'CONFIRMED', confirmedAmount: 8 } as never)
    const ext = (await prisma.candidatoDeProduto.findUniqueOrThrow({ where: { id: cs[0] } })).externalId
    const CAB = 'ID do pedido;ID do produto;Nome do produto;Comissão estimada;Status do pedido;Data do pedido;ID do conteúdo'
    await I.importarCreatorCenter({ workspaceId: ws, userId: usuarios[ws], nomeArquivo: 'r116.csv', conteudo: [CAB, ['PED-R116-R', ext, 'Garrafa', 'R$ 2,00', 'Pago', '16/10/2026 10:00', '7400000000000001161'].join(';')].join(String.fromCharCode(10)), dataOrigin: 'TEST_FIXTURE' })
    const integ = await prisma.integracao.create({ data: { workspaceId: ws, userId: usuarios[ws], plataforma: 'mercadolivre', status: 'conectado' } as never })
    await prisma.consumoDeCota.create({ data: { workspaceId: ws, plataforma: 'TIKTOK_SHOP', regra: 'VIDEOS_COMPRAVEIS_POR_DIA', programa: 'PLATAFORMA', dia: '2026-10-16', acaoId: `publicacaoAssistida:${pub.id}`, estado: 'CONFIRMADA' } })
    const foto = async () => ({
      vendas: await prisma.sale.count({ where: { workspaceId: ws } }),
      comissoes: JSON.stringify(await prisma.commission.findMany({ where: { workspaceId: ws }, select: { id: true, status: true, confirmedAmount: true }, orderBy: { id: 'asc' } })),
      historicoComissao: await prisma.historicoDeComissao.count({ where: { workspaceId: ws } }),
      pedidos: await prisma.pedidoAfiliadoTikTok.count({ where: { workspaceId: ws } }),
      resultados: JSON.stringify(await prisma.videoTikTokResultado.findMany({ where: { workspaceId: ws }, select: { id: true, postId: true, tipoDeGancho: true, versaoDoDna: true } })),
      publicado: (await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id: pub.id } })).estado,
      usuarios: await prisma.user.count({ where: { workspaceId: ws } }),
      integracoes: await prisma.integracao.count({ where: { workspaceId: ws } }),
      cota: await prisma.consumoDeCota.count({ where: { workspaceId: ws } }),
      importacoes: await prisma.importacaoCreatorCenter.count({ where: { workspaceId: ws } }),
    })
    const antes = await foto()
    assert.ok(antes.historicoComissao >= 1 && antes.pedidos === 1, JSON.stringify(antes))

    const r = await P.recomecarOperacao({ workspaceId: ws, userId: usuarios[ws] })
    assert.ok(r.produtos >= 4 || r.candidatos >= 4, JSON.stringify(r))
    const v = await visao(ws)
    assert.equal(v.prioritaria, null, 'operação limpa')
    assert.equal(v.outras.length, 0)
    assert.ok(!(await C.centralPrecisaDeVoce(ws)).some((p) => p.origem !== 'INTEGRACAO'), 'nada operacional pendente')
    assert.deepEqual(await foto(), antes, 'histórico, vendas, comissões, pedidos, aprendizado, usuários, integrações e quota permanecem')
    assert.ok(await prisma.integracao.findUnique({ where: { id: integ.id } }))
    assert.equal((await prisma.commission.findUniqueOrThrow({ where: { id: com.id } })).status, 'CONFIRMED')
    assert.equal(await prisma.videoTikTokResultado.count({ where: { id: res.id } }), 1)

    // repetir não duplica nada e não estraga nada; a reconciliação não acha o que corrigir
    await P.recomecarOperacao({ workspaceId: ws, userId: usuarios[ws], agora: new Date(Date.now() + 1000) })
    assert.deepEqual(await foto(), antes)
    const rec = await Rc.reconciliarEstadoOperacional(ws)
    assert.equal(rec.corrigidos, 0, JSON.stringify(rec.achados.map((a) => a.tipo)))
    assert.equal(await prisma.domainEvent.count({ where: { workspaceId: ws, tipo: 'OPERATION_RESET' } }), 2, 'cada recomeço fica registrado (com o estado anterior)')
  })

})
