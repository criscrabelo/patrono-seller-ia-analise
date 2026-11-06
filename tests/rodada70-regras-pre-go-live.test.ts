/**
 * P2.15.4 — As 3 regras de negócio fechadas antes do go-live.
 *
 *   1. "Publicado" só com evidência real; agendado vencido = publicação atrasada.
 *   2. WhatsApp em massa só com conteúdo aprovado + liberado para WhatsApp +
 *      sem alerta vermelho; recusa no servidor com audit log.
 *   3. Permissão de módulo vale no servidor (porta única exigirSessao).
 *
 * Puro + banco de TESTE (papel de teste próprio, nunca o papel "usuario").
 * Nada é publicado nem enviado. Custo R$ 0,00. Limpa o que cria.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { estaAtrasado, FOLGA_MS, STATUS_ATRASADA } from '../lib/publicacao-atrasada'
import { motivoParaNaoEnviar } from '../lib/whatsapp-elegibilidade'
import { regraDaRota, rotaLiberada, REGRAS_DE_ROTA } from '../lib/modulos-rotas'
import { MODULO_KEYS } from '../lib/modulos'
import { proximaMelhorAcao } from '../lib/central'

const AGORA = new Date('2026-10-10T15:00:00Z')

describe('P2.15.4 — 1. "Publicado" só com evidência', () => {
  test('agendado vencido (além da folga) é atrasado; dentro da folga, ainda não', () => {
    assert.equal(estaAtrasado({ status: 'agendado', dataAgendamento: new Date(AGORA.getTime() - FOLGA_MS - 1) }, AGORA), true)
    assert.equal(estaAtrasado({ status: 'agendado', dataAgendamento: new Date(AGORA.getTime() - 60_000) }, AGORA), false)
    assert.equal(estaAtrasado({ status: 'agendado', dataAgendamento: new Date(AGORA.getTime() + 60_000) }, AGORA), false)
    assert.equal(estaAtrasado({ status: STATUS_ATRASADA, dataAgendamento: null }, AGORA), true)
    assert.equal(estaAtrasado({ status: 'publicado', dataAgendamento: new Date(0) }, AGORA), false)
  })

  test('nenhum caminho fora do executor grava "publicado" (listagem, cron, PATCH)', () => {
    const semComentario = (f: string) => fs.readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    assert.doesNotMatch(semComentario('app/api/conteudos/route.ts'), /status:\s*'publicado'|updateMany/)
    assert.doesNotMatch(semComentario('app/api/cron/publicar/route.ts'), /status:\s*'publicado'/)
    const patch = semComentario('app/api/conteudos/[id]/route.ts')
    assert.doesNotMatch(patch.match(/const STATUS = \[[^\]]*\]/)![0], /'publicado'/)
    assert.match(patch, /status === 'publicado'[\s\S]{0,200}status: 409/)
    // o único lugar que grava "publicado" é o executor, depois do id do canal
    const executor = semComentario('lib/trabalhos-longos/publicar-instagram.ts')
    assert.ok(executor.indexOf("status: 'publicado'") > executor.indexOf('publicarContainer('))
    assert.match(executor, /publicacaoExternaId: mediaId/)
  })

  test('a Central alerta publicação atrasada como próximo passo (depois das decisões)', () => {
    const a = proximaMelhorAcao({ pendencias: 0, bloqueado: false, ultimoCicloHa: 1, integracoesComProblema: 1, publicacoesAtrasadas: 2 })
    assert.equal(a.texto, '2 publicações estão atrasadas: a data passou e nada saiu.')
    assert.equal(a.link, '/conteudos')
    assert.equal(proximaMelhorAcao({ pendencias: 1, bloqueado: false, ultimoCicloHa: 1, integracoesComProblema: 0, publicacoesAtrasadas: 2 }).link, '/precisa-de-voce')
  })
})

describe('P2.15.4 — 2. WhatsApp só com conteúdo aprovado e liberado', () => {
  const ok = { status: 'aprovado', redeSocial: 'WhatsApp', legendaWhatsapp: 'Oferta!', alertasCompliance: [] }
  test('aprovado + feito para WhatsApp + legenda + sem alerta vermelho = pode', () => {
    assert.equal(motivoParaNaoEnviar(ok), null)
    for (const s of ['agendado', 'publicado', 'publicacao_atrasada']) assert.equal(motivoParaNaoEnviar({ ...ok, status: s }), null, s)
  })
  test('qualquer outra coisa é recusada com motivo claro', () => {
    assert.match(motivoParaNaoEnviar({ ...ok, status: 'roteiro_gerado' })!, /não foi aprovado/)
    assert.match(motivoParaNaoEnviar({ ...ok, status: 'aguardando_aprovacao' })!, /não foi aprovado/)
    assert.match(motivoParaNaoEnviar({ ...ok, redeSocial: 'Instagram Reels' })!, /não foi liberado para WhatsApp/)
    assert.match(motivoParaNaoEnviar({ ...ok, legendaWhatsapp: '  ' })!, /mensagem de WhatsApp aprovada/)
    assert.match(motivoParaNaoEnviar({ ...ok, alertasCompliance: [{ severidade: 'vermelho' }] })!, /alerta vermelho/)
  })
  test('a rota não aceita mais texto livre nem URL de imagem livre', () => {
    const rota = fs.readFileSync('app/api/whatsapp/enviar/route.ts', 'utf8')
    assert.match(rota, /mensagem: mensagemAprovada/)
    assert.doesNotMatch(rota, /body\.mensagem|body\.imagemUrl/)
    assert.ok(rota.indexOf('envioDeWhatsappPermitido()') < rota.indexOf('conferirConteudoParaWhatsapp('), 'trava P2.11 continua primeiro')
    assert.ok(rota.indexOf('conferirConteudoParaWhatsapp(') < rota.indexOf('req.json()'), 'conteúdo conferido antes de ler o corpo')
  })
})

describe('P2.15.4 — 3. Permissão de módulo: tabela central', () => {
  test('toda regra aponta para módulo que existe', () => {
    for (const r of REGRAS_DE_ROTA) for (const m of r.modulos) assert.ok((MODULO_KEYS as string[]).includes(m), `${r.prefixo}: ${m}`)
  })
  test('rota compartilhada: leitura liberada por qualquer módulo que a usa; escrita só pelo dono', () => {
    const bloqueadoProdutos = new Set(['produtos'])
    assert.equal(rotaLiberada(regraDaRota('/api/produtos', 'GET'), bloqueadoProdutos), true) // Gerar Conteúdo, Links… ainda leem
    assert.equal(rotaLiberada(regraDaRota('/api/produtos', 'POST'), bloqueadoProdutos), false)
    assert.equal(rotaLiberada(regraDaRota('/api/produtos/abc', 'DELETE'), bloqueadoProdutos), false)
    assert.equal(rotaLiberada(regraDaRota('/api/produtos/abc', 'PATCH'), bloqueadoProdutos), true) // Importar Imagens
    assert.equal(rotaLiberada(regraDaRota('/api/whatsapp/enviar', 'POST'), new Set(['whatsapp'])), false)
    assert.equal(rotaLiberada(regraDaRota('/api/conteudos/gerar', 'POST'), new Set(['conteudos'])), true)
    assert.equal(rotaLiberada(regraDaRota('/api/conteudos/gerar', 'POST'), new Set(['conteudos-gerar'])), false)
  })
  test('rotas sem módulo (conta, auth, admin, cron) não dependem da tabela', () => {
    for (const c of ['/api/conta/senha', '/api/auth/register', '/api/admin/usuarios', '/api/cron/publicar', '/api/digital-twin', '/api/permissoes'])
      assert.equal(regraDaRota(c, 'GET'), null, c)
    assert.equal(regraDaRota('/api/produtosx', 'GET'), null, 'prefixo não casa com outro nome')
  })
  test('nenhuma rota de API com sessão fica de fora da porta única', () => {
    const fora: string[] = []
    const varrer = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = `${d}/${e.name}`
        if (e.isDirectory()) varrer(p)
        else if (e.name === 'route.ts') {
          const s = fs.readFileSync(p, 'utf8')
          if (/getServerSession\(/.test(s) && !/requireAdmin|role !== 'admin'/.test(s) && !p.includes('/auth/')) fora.push(p)
        }
      }
    }
    varrer('app/api')
    assert.deepEqual(fora, [])
  })
})

describe('P2.15.4 — pendências que sobravam da P2.15.3', () => {
  test('Digital Twin: saúde do processador só para admin (a tabela não separa workspace)', () => {
    const rota = fs.readFileSync('app/api/digital-twin/route.ts', 'utf8')
    assert.match(rota, /const workers = session\.user\.role !== 'admin' \? \[\] : await prisma\.generationWorkerHealth\.findMany/)
  })
  test('Shopee: sincronizar catálogo responde indisponível, sem chamar a Shopee com assinatura errada', () => {
    const rota = fs.readFileSync('app/api/integracoes/shopee/sincronizar/route.ts', 'utf8')
    const bloco = rota.slice(rota.indexOf("acao === 'sincronizar_produtos'"))
    assert.match(bloco.slice(0, 600), /status: 501/)
    assert.doesNotMatch(rota, /sincronizar_produtos_legado|partnerKey está no accessToken/)
  })
  test('Vendas e Comissões: a tela marca comissão como confirmada/recebida pela API existente', () => {
    const tela = fs.readFileSync('app/(dashboard)/vendas-comissoes/page.tsx', 'utf8')
    assert.match(tela, /fetch\('\/api\/comissoes', \{\s*method: 'PATCH'/)
    assert.match(tela, /Marcar como recebida/)
  })
})

const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')

describe('P2.15.4 — banco de teste', { skip: !TEM_BANCO ? 'exige banco de TESTE' : false }, () => {
  let prisma: typeof import('../lib/prisma').prisma
  let S: typeof import('../lib/sessao')
  let W: typeof import('../lib/whatsapp-envio-conferencia')
  let A: typeof import('../lib/publicacao-atrasada')
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  const PREFIXO = 'Conta de Teste — '
  const marca = `r70-${Date.now()}`
  const PAPEL = `teste-modulos-${marca}`
  let ws = ''
  let usuario = ''
  let produto = ''

  before(async () => {
    ;[{ prisma }, S, W, A, { limparWorkspaceDeTeste: limpar }] = await Promise.all([
      import('../lib/prisma'), import('../lib/sessao'), import('../lib/whatsapp-envio-conferencia'), import('../lib/publicacao-atrasada'), import('./_limpar-workspace-de-teste'),
    ])
    ws = (await prisma.workspace.create({ data: { name: `${PREFIXO}Regras P2.15.4`, ownerId: marca }, select: { id: true } })).id
    usuario = (await prisma.user.create({ data: { email: `${marca}@teste.local`, name: 'U', password: 'x', workspaceId: ws, status: 'ativo' }, select: { id: true } })).id
    produto = (await prisma.produto.create({ data: { workspaceId: ws, userId: usuario, nome: `${marca} produto`, categoria: 'Teste', tipoVenda: 'afiliado', origemConteudo: 'manual', imagens: ['https://img.invalido/p.jpg'] }, select: { id: true } })).id
  })

  after(async () => {
    if (prisma) {
      await prisma.moduloPermissao.deleteMany({ where: { role: PAPEL } })
      if (ws) await limpar(prisma, ws, PREFIXO)
      await prisma.$disconnect()
    }
  })

  const conteudo = (data: Record<string, unknown>) =>
    prisma.conteudo.create({ data: { workspaceId: ws, userId: usuario, produtoId: produto, redeSocial: 'WhatsApp', status: 'aprovado', legendaWhatsapp: 'Oferta aprovada', ...data } as never, select: { id: true } })

  test('WhatsApp: recusa no servidor com audit log; aprovado e liberado passa', async () => {
    const naoAprovado = await conteudo({ status: 'roteiro_gerado' })
    const r1 = await W.conferirConteudoParaWhatsapp({ workspaceId: ws, userId: usuario, conteudoId: naoAprovado.id })
    assert.deepEqual([r1.ok, !r1.ok && r1.status], [false, 403])
    const outraRede = await conteudo({ redeSocial: 'TikTok' })
    assert.equal((await W.conferirConteudoParaWhatsapp({ workspaceId: ws, userId: usuario, conteudoId: outraRede.id })).ok, false)
    const semConteudo = await W.conferirConteudoParaWhatsapp({ workspaceId: ws, userId: usuario, conteudoId: null })
    assert.deepEqual([semConteudo.ok, !semConteudo.ok && semConteudo.status], [false, 400])
    const auditorias = await prisma.auditLog.findMany({ where: { workspaceId: ws, action: 'whatsapp.envio_recusado' } })
    assert.equal(auditorias.length, 3)
    assert.ok(auditorias.some((a) => a.entityId === naoAprovado.id))
    const bom = await conteudo({})
    const r2 = await W.conferirConteudoParaWhatsapp({ workspaceId: ws, userId: usuario, conteudoId: bom.id })
    assert.equal(r2.ok, true)
    assert.equal(r2.ok && r2.conteudo.legendaWhatsapp, 'Oferta aprovada')
  })

  test('publicação atrasada: contagem pega o gravado e o derivado; publicado com id não conta', async () => {
    await conteudo({ status: 'agendado', dataAgendamento: new Date(Date.now() - 2 * 60 * 60 * 1000) })
    await conteudo({ status: A.STATUS_ATRASADA })
    await conteudo({ status: 'agendado', dataAgendamento: new Date(Date.now() + 60 * 60 * 1000) })
    await conteudo({ status: 'publicado', publicacaoExternaId: `${marca}-media` })
    assert.equal(await A.contarPublicacoesAtrasadas(ws), 2)
  })

  test('trocar a senha derruba as sessões abertas com a senha antiga', async () => {
    const { authOptions, versaoDaSenha } = await import('../lib/auth')
    const jwt = async (token: Record<string, unknown>) => authOptions.callbacks!.jwt!({ token, user: undefined as never, account: null } as never)
    const atual = await prisma.user.findUniqueOrThrow({ where: { id: usuario }, select: { password: true } })
    const t = { id: usuario, role: 'usuario', workspaceId: ws, verificadoEm: 0, senhaVersao: versaoDaSenha(atual.password) }
    assert.equal(((await jwt({ ...t })) as { senhaVersao: string }).senhaVersao, versaoDaSenha(atual.password))
    await prisma.user.update({ where: { id: usuario }, data: { password: 'hash-novo-da-senha' } })
    await assert.rejects(jwt({ ...t }), /SESSAO_REVOGADA/)
    // sessão antiga sem a versão (emitida antes desta mudança) passa a ter a versão atual
    const semVersao = (await jwt({ id: usuario, role: 'usuario', workspaceId: ws, verificadoEm: 0 })) as { senhaVersao: string }
    assert.equal(semVersao.senhaVersao, versaoDaSenha('hash-novo-da-senha'))
  })

  test('módulos: usuária autorizada passa; bloqueada leva não; admin sempre passa; sem carimbo fecha', async () => {
    S.limparCacheDePermissoes()
    const pode = (role: string, caminho: string | null, metodo: string | null) => S.podeUsarRota({ role, caminho, metodo })
    assert.equal(await pode(PAPEL, '/api/whatsapp/status', 'GET'), true)
    await prisma.moduloPermissao.createMany({ data: [{ role: PAPEL, modulo: 'whatsapp', liberado: false }, { role: PAPEL, modulo: 'produtos', liberado: false }] })
    S.limparCacheDePermissoes()
    assert.equal(await pode(PAPEL, '/api/whatsapp/status', 'GET'), false)
    assert.equal(await pode(PAPEL, '/api/whatsapp/enviar', 'POST'), false)
    assert.equal(await pode(PAPEL, '/api/produtos', 'POST'), false)
    assert.equal(await pode(PAPEL, '/api/produtos', 'GET'), true) // compartilhada
    assert.equal(await pode(PAPEL, '/api/oportunidades', 'GET'), true) // módulo não bloqueado
    assert.equal(await pode('admin', '/api/whatsapp/status', 'GET'), true)
    assert.equal(await pode(PAPEL, null, null), false)
    assert.equal(await pode('admin', null, null), true)
  })
})
