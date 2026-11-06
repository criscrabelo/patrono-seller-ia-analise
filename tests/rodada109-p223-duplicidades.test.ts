/**
 * P2.23 — travas contra duplicidade: cada regra/constante consolidada tem UMA fonte. Se alguém copiar de novo,
 * este teste aponta onde.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const arquivos = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n)
  return statSync(p).isDirectory() ? arquivos(p) : /\.(ts|tsx)$/.test(n) ? [p.split(String.fromCharCode(92)).join('/')] : []
})
const CODIGO = [...arquivos('lib'), ...arquivos('app'), ...arquivos('components')]
const onde = (re: RegExp) => CODIGO.filter((f) => re.test(readFileSync(f, 'utf8')))

describe('P2.23 — fontes únicas', () => {
  test("o tipo do pedido de escolha de produto ('ESCOLHER_PRODUTO') é definido só em lib/aprovacoes.ts (a política usa o literal no tipo da ação)", () => {
    assert.deepEqual(onde(/const \w+\s*=\s*'ESCOLHER_PRODUTO'/), ['lib/aprovacoes.ts'])
    assert.deepEqual(onde(/===\s*'ESCOLHER_PRODUTO'\)/).filter((f) => f !== 'lib/politica.ts'), [])
  })
  test("o filtro 'produto não excluído' só existe em lib/produto-canonico.ts", () => {
    assert.deepEqual(onde(/status:\s*\{\s*not:\s*'descartado'\s*\}/), ['lib/produto-canonico.ts'])
  })
  test('a faixa de evidência e as views mínimas têm uma definição só', () => {
    assert.deepEqual(onde(/FAIXA(_DE_DESEMPATE)?\s*=\s*5\b/), ['lib/faixa-de-evidencia.ts'])
    assert.deepEqual(onde(/VIEWS_MINIMAS\s*=\s*500\b/), ['lib/aprendizado-videos-tiktok.ts'])
  })
  test("'aprovada ou além' tem uma definição só (lib/estados-da-publicacao.ts)", () => {
    assert.deepEqual(onde(/\['APROVADO',\s*'PUBLICANDO',\s*'PUBLICADO'\]/), ['lib/estados-da-publicacao.ts'])
  })
  test("'PAID' não é status de comissão (não aparece em consulta)", () => {
    assert.deepEqual(onde(/'PAID'/), [])
  })
})

describe('P2.23 — cancelamento de pedidos pendentes por uma porta só', () => {
  test("nenhum módulo cancela ApprovalRequest direto (só lib/aprovacoes.ts)", () => {
    const fora = CODIGO.filter((f) => f !== 'lib/aprovacoes.ts' && /approvalRequest\.updateMany\([\s\S]{0,300}?'CANCELADA'/.test(readFileSync(f, 'utf8')))
    assert.deepEqual(fora, [])
  })
})

const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')
describe('P2.23 — cancelarPedidosPendentes (banco de TESTE)', { skip: !TEM_BANCO ? 'exige banco de TESTE' : false }, () => {
  let prisma: typeof import('../lib/prisma').prisma
  let A: typeof import('../lib/aprovacoes')
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  const ws: string[] = []
  before(async () => { ;[{ prisma }, A, { limparWorkspaceDeTeste: limpar }] = await Promise.all([import('../lib/prisma'), import('../lib/aprovacoes'), import('./_limpar-workspace-de-teste')]) })
  after(async () => { if (prisma) for (const w of ws) await limpar(prisma, w, 'Conta de Teste — '); await prisma?.$disconnect() })
  test('cancela só PENDENTE do próprio workspace, sempre com motivo e data da decisão', async () => {
    const marca = `r109-${Date.now()}`
    for (const n of ['a', 'b']) ws.push((await prisma.workspace.create({ data: { name: `Conta de Teste — ${n} r109`, ownerId: `${marca}-${n}` }, select: { id: true } })).id)
    const pedido = (w: string, chave: string, status = 'PENDENTE') => prisma.approvalRequest.create({ data: { workspaceId: w, tipo: A.TIPO_ESCOLHA_DE_PRODUTO, chave, status, titulo: 't', resumo: 'r', porque: [], acaoProposta: {}, risco: 'BAIXO' } as never })
    const p1 = await pedido(ws[0], `${marca}-1`); const p2 = await pedido(ws[0], `${marca}-2`, 'APROVADA'); const p3 = await pedido(ws[1], `${marca}-3`)
    const agora = new Date('2026-10-15T20:00:00-03:00')
    const r = await A.cancelarPedidosPendentes({ workspaceId: ws[0], filtro: { tipo: A.TIPO_ESCOLHA_DE_PRODUTO }, motivo: 'teste', agora })
    assert.equal(r.count, 1)
    const [x1, x2, x3] = await Promise.all([p1, p2, p3].map((p) => prisma.approvalRequest.findUniqueOrThrow({ where: { id: p.id } })))
    assert.deepEqual([x1.status, x1.motivoDaDecisao, x1.decididoEm?.getTime()], ['CANCELADA', 'teste', agora.getTime()])
    assert.equal(x2.status, 'APROVADA', 'decidido não muda'); assert.equal(x3.status, 'PENDENTE', 'outro workspace não muda')
  })
})
