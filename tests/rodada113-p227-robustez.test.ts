/**
 * P2.27 — ROBUSTEZ E RECUPERAÇÃO: nada publica duas vezes, nada fica preso para sempre.
 *
 * Trava: reserva atômica do envio (duas chamadas, uma chega ao provider); tentativa já em envio/publicada
 * não chama o adapter; aprovação com claim atômico e conferência do perfil depois de envio incerto; a fila
 * genérica não pega trabalho longo; retomar job interrompido conta tentativa e para no limite; trabalho
 * longo interrompido é retomado pela consulta; render interrompido sai de GERANDO_VIDEO. Banco de TESTE.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
// P2.45: este arquivo testa o fluxo de publicação ANTERIOR aos três controles (técnico, comercial, conformidade).
process.env.PATRONO_TESTE_LEGADO_SEM_TRES_CONTROLES = 'true'

const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')
const ler = (p: string) => fs.readFileSync(p, 'utf8')

describe('P2.27 — travas de código', () => {
  test('o adapter só é chamado por quem reservou o envio; tentativa já enviada vira incerta (sem retry automático)', () => {
    const fluxo = ler('lib/publicacao-fluxo.ts')
    assert.match(fluxo, /reservarEnvio\(/)
    assert.doesNotMatch(fluxo, /await marcarDistribuindo\(/, 'a ida para DISTRIBUINDO não pode ignorar o resultado')
    const orq = ler('lib/distribuicao-orquestrador.ts')
    const i = orq.indexOf('if (tentativa.jaEnviada)'), j = orq.indexOf('resposta = await executar(')
    assert.ok(i > 0 && j > i, 'a checagem vem ANTES do executar')
    assert.match(orq.slice(i, i + 500), /envioIncerto: tentativa\.jaEnviada !== 'DISTRIBUIDA'/)
    assert.match(ler('lib/trabalhos-longos/publicar-instagram.ts'), /permitirReentrada: true/, 'só o Instagram (trava própria por fase) reentra')
  })
  test('aprovar/publicar: claim atômico antes do envio; envio incerto exige "conferi o perfil"', () => {
    const a = ler('lib/publicacao-assistida.ts')
    const ini = a.indexOf('export async function publicarAprovada')
    const corpo = a.slice(ini, a.indexOf('export async function concluirPublicacaoAssistida'))
    const claim = corpo.indexOf("estado: 'PUBLICANDO', erro: null"), envio = corpo.indexOf('await distribuirConteudo(')
    assert.ok(claim > 0 && envio > claim, 'claim antes do envio')
    assert.match(corpo, /where: \{ id: a\.id, workspaceId: p\.workspaceId, estado: a\.estado \},\s+data: \{ estado: 'PUBLICANDO'/)
    assert.match(corpo, /startsWith\('ENVIO INCERTO'\) && !p\.conferiuOPerfil/)
    assert.match(ler('app/api/tiktok/assistido/[id]/tentar-de-novo/route.ts'), /conferiuOPerfil: bruto\.conferiuOPerfil === true/)
    assert.match(ler('components/assistido/PainelAssistido.tsx'), /Conferi o perfil: tentar de novo/)
  })
  test('fila genérica não pega LONGO_*; retomar RUNNING vencido conta tentativa', () => {
    const q = ler('lib/automation-queue-prisma.ts')
    assert.match(q, /AND left\("tipo", 6\) <> 'LONGO_'/)
    assert.match(q, /"tentativas" = "tentativas" \+ \(CASE WHEN "estado" = 'RUNNING' THEN 1 ELSE 0 END\)/)
  })
})

describe('P2.27 — banco de TESTE', { skip: !TEM_BANCO }, () => {
  let prisma: typeof import('../lib/prisma')['prisma']
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  const PREFIXO = 'Conta de Teste — '
  const marca = `r113-${Date.now()}`
  let ws = '', userId = '', produtoId = ''
  before(async () => {
    ;[{ prisma }, { limparWorkspaceDeTeste: limpar }] = await Promise.all([import('../lib/prisma'), import('./_limpar-workspace-de-teste')])
    const { criarUsuarioComWorkspace } = await import('../lib/workspace')
    const r = await criarUsuarioComWorkspace(prisma, { email: `${marca}@teste.local`, password: 'x', name: `${PREFIXO}robustez r113` })
    ws = r.workspace.id; userId = r.user.id
    await prisma.workspace.update({ where: { id: ws }, data: { name: `${PREFIXO}robustez r113` } })
    produtoId = (await prisma.produto.create({ data: { workspaceId: ws, userId, nome: 'Produto r113', categoria: 'Casa', origemConteudo: 'manual', tipoVenda: 'afiliado', linkProduto: 'https://example.com/p' } })).id
  })
  after(async () => {
    if (prisma && ws) {
      await prisma.automationJob.deleteMany({ where: { workspaceId: ws } })
      await limpar(prisma, ws, PREFIXO)
    }
    await prisma?.$disconnect()
  })

  test('reserva do envio: duas chamadas ao mesmo tempo, só UMA chega ao provider; retry depois de falha reserva de novo', async () => {
    const { prepararTentativaDePublicacao } = await import('../lib/publicacao-fluxo')
    const { reservarEnvio, marcarFalhou } = await import('../lib/publicacao-repositorio')
    const conteudo = await prisma.conteudo.create({ data: { workspaceId: ws, userId, produtoId, roteiro: 'x', redeSocial: 'instagram' }, select: { id: true } })
    const chave = `${marca}-envio`
    const [t1, t2] = await Promise.all([1, 2].map(() => prepararTentativaDePublicacao({ workspaceId: ws, contentId: conteudo.id, canal: 'instagram', chaveDaTentativa: chave })))
    const passaram = [t1, t2].filter((t) => !t.jaEnviada)
    assert.equal(passaram.length, 1, 'só uma tentativa pode chamar o provider')
    assert.equal([t1, t2].find((t) => t.jaEnviada)!.jaEnviada, 'DISTRIBUINDO')
    assert.equal(await prisma.publicacao.count({ where: { workspaceId: ws, chaveDaTentativa: chave } }), 1)
    // reentrada depois de queda (mesma chave, ainda DISTRIBUINDO): não reenvia
    assert.equal((await prepararTentativaDePublicacao({ workspaceId: ws, contentId: conteudo.id, canal: 'instagram', chaveDaTentativa: chave })).jaEnviada, 'DISTRIBUINDO')
    // ...exceto para quem tem trava própria por fase
    assert.ok(!(await prepararTentativaDePublicacao({ workspaceId: ws, contentId: conteudo.id, canal: 'instagram', chaveDaTentativa: chave, permitirReentrada: true })).jaEnviada)
    // falhou de verdade (provider recusou) → o retry reserva de novo
    const pub = await prisma.publicacao.findFirstOrThrow({ where: { workspaceId: ws, chaveDaTentativa: chave } })
    await marcarFalhou({ workspaceId: ws, publicacaoId: pub.id })
    assert.deepEqual(await reservarEnvio({ workspaceId: ws, publicacaoId: pub.id }), { reservou: true, estado: 'DISTRIBUINDO' })
    // publicada não volta a enviar
    await prisma.publicacao.update({ where: { id: pub.id }, data: { estado: 'DISTRIBUIDA' } })
    assert.equal((await prepararTentativaDePublicacao({ workspaceId: ws, contentId: conteudo.id, canal: 'instagram', chaveDaTentativa: chave, permitirReentrada: true })).jaEnviada, 'DISTRIBUIDA')
  })

  test('fila: LONGO_* RUNNING vencido não é pego pela fila genérica; job comum interrompido conta tentativa e para no limite', async () => {
    const { portaPrisma } = await import('../lib/automation-queue-prisma')
    const { executarProximoJob } = await import('../lib/automation-queue-repositorio')
    const porta = portaPrisma(50)
    const velho = new Date(Date.now() - 60_000)
    await prisma.automationJob.create({ data: { workspaceId: ws, tipo: 'LONGO_RENDER_VIDEO', chave: `${marca}-longo`, estado: 'RUNNING', classe: 'TENTANDO', entityType: 'PUBLICACAO_ASSISTIDA', entityId: 'x', workerId: 'morto', heartbeatAt: velho } as never })
    assert.equal(await porta.reivindicar(ws, 'w1', new Date()), null, 'trabalho longo tem ciclo próprio')
    const comum = await prisma.automationJob.create({ data: { workspaceId: ws, tipo: 'GERAR_CONTEUDO', chave: `${marca}-comum`, estado: 'RUNNING', classe: 'AUTOMATIZAVEL', entityType: 'PRODUTO', entityId: produtoId, workerId: 'morto', heartbeatAt: velho, tentativas: 2 } as never })
    const r = await executarProximoJob({ porta, workspaceId: ws, workerId: 'w2', agora: new Date(), acoes: { GERAR_CONTEUDO: async () => { throw new Error('não deveria rodar') } } })
    assert.equal(r.estadoFinal, 'FAILED_FINAL', r.explicacao)
    const final = await prisma.automationJob.findUniqueOrThrow({ where: { id: comum.id } })
    assert.equal(final.tentativas, 3)
    assert.match(final.ultimoErro ?? '', /Interrompido 3 vez/)
  })

  test('trabalho longo interrompido (RUNNING sem heartbeat) é retomado pela consulta da tela, com interrompido: true', async () => {
    const { situacaoDoTrabalho } = await import('../lib/trabalho-longo')
    const job = await prisma.automationJob.create({ data: { workspaceId: ws, tipo: 'LONGO_LEGENDA_VIDEO', chave: `${marca}-legenda`, estado: 'RUNNING', classe: 'TENTANDO', entityType: 'CONTEUDO', entityId: 'x', workerId: 'morto', heartbeatAt: new Date(Date.now() - 10 * 60_000), contexto: { fase: 'GERANDO' } } as never })
    let viu: Record<string, unknown> | null = null
    await situacaoDoTrabalho({ workspaceId: ws, trabalhoId: job.id, origem: 'http://localhost', modo: 'na-requisicao' as never, executores: { LONGO_LEGENDA_VIDEO: async ({ trabalho }: { trabalho: { contexto: Record<string, unknown> } }) => { viu = trabalho.contexto; return { fim: 'concluido', resposta: { status: 200, corpo: { ok: true } } } } } as never })
    assert.equal((viu as Record<string, unknown> | null)?.interrompido, true, 'o executor recebe interrompido: true e decide se retomar é seguro')
    assert.equal((await prisma.automationJob.findUniqueOrThrow({ where: { id: job.id } })).estado, 'SUCCEEDED')
  })

  test('render interrompido: GERANDO_VIDEO sem trabalho vivo volta à fila; depois das tentativas vira VIDEO_FALHOU; trabalho vivo não é mexido', async () => {
    const { recuperarRenderInterrompido } = await import('../lib/publicacao-assistida')
    const antigo = new Date(Date.now() - 10 * 60_000)
    const criar = async (tentativas: number, trabalhoId: string | null) => {
      const a = await prisma.publicacaoAssistida.create({ data: { workspaceId: ws, estado: 'GERANDO_VIDEO', nomeProduto: 'Produto r113', varianteId: 'v', estrutura: 'DEMONSTRACAO', apresentacao: { video: { situacao: 'GERANDO', tentativas, trabalhoId, midiaId: 'm' } }, qualityGate: {}, motivoEscolha: 'teste', objetivoDoTeste: 'teste', historico: [] } as never })
      await prisma.$executeRaw`UPDATE "PublicacaoAssistida" SET "updatedAt" = ${antigo} WHERE id = ${a.id}`
      return prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id: a.id } })
    }
    const morto = await prisma.automationJob.create({ data: { workspaceId: ws, tipo: 'LONGO_RENDER_VIDEO', chave: `${marca}-r1`, estado: 'RUNNING', classe: 'TENTANDO', entityType: 'PUBLICACAO_ASSISTIDA', entityId: 'x', workerId: 'morto', heartbeatAt: antigo } as never })
    const a1 = await recuperarRenderInterrompido(await criar(1, morto.id))
    assert.equal(a1.estado, 'VIDEO_NA_FILA')
    const a2 = await recuperarRenderInterrompido(await criar(2, null))
    assert.equal(a2.estado, 'VIDEO_FALHOU', 'depois das tentativas o Patrono segue para outra opção')
    const vivo = await prisma.automationJob.create({ data: { workspaceId: ws, tipo: 'LONGO_RENDER_VIDEO', chave: `${marca}-r2`, estado: 'RUNNING', classe: 'TENTANDO', entityType: 'PUBLICACAO_ASSISTIDA', entityId: 'x', workerId: 'vivo', heartbeatAt: new Date() } as never })
    assert.equal((await recuperarRenderInterrompido(await criar(1, vivo.id))).estado, 'GERANDO_VIDEO', 'render vivo não é interrompido')
    // duas abas recuperando ao mesmo tempo: uma escreve
    const dupla = await criar(1, null)
    await Promise.all([recuperarRenderInterrompido(dupla), recuperarRenderInterrompido(dupla)])
    const h = (await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id: dupla.id } })).historico as unknown[]
    assert.equal(h.length, 1)
  })
})
