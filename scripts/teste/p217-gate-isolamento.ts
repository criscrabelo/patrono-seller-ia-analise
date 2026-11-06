// TESTE apenas: uma conta descartável (outro workspace) tenta ler/alterar
// registros do workspace da titular sabendo os IDs. Esperado: 404/403, nunca dado.
import { readFileSync } from 'node:fs'
import { prisma } from '../../lib/prisma'

const WS = 'cmuzg1b4a00016zmyag2lqbar'
if (!(process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')) throw new Error('só no banco de TESTE')
const { cookie } = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const BASE = 'http://localhost:3100'

async function main() {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const um = async <T>(p: Promise<T | null>) => (await p) as any
const amostra = await um(prisma.amostraTikTokShop.findFirst({ where: { workspaceId: WS }, select: { id: true, estado: true, updatedAt: true } }))
const conteudo = await um(prisma.conteudo.findFirst({ where: { workspaceId: WS }, select: { id: true } }))
const produto = await um(prisma.produto.findFirst({ where: { workspaceId: WS }, select: { id: true } }))
const venda = await um(prisma.sale.findFirst({ where: { workspaceId: WS }, select: { id: true } }))
const assistida = await um(prisma.publicacaoAssistida.findFirst({ where: { workspaceId: WS }, select: { id: true } }))
const meta = await um(prisma.metaTikTokShop.findFirst({ where: { workspaceId: WS }, select: { id: true } }))
const resultado = await um(prisma.videoTikTokResultado.findFirst({ where: { workspaceId: WS }, select: { id: true } }))

const casos: [string, string, string | null, unknown?][] = [
  ['GET', '/api/conteudos/', conteudo?.id],
  ['PATCH', '/api/conteudos/', conteudo?.id, { titulo: 'x' }],
  ['GET', '/api/produtos/', produto?.id],
  ['PATCH', '/api/produtos/', produto?.id, { nome: 'x' }],
  ['GET', '/api/vendas/__/dossie', venda?.id],
  ['PATCH', '/api/tiktok/amostras/', amostra?.id, { evento: 'APROVADA' }],
  ['POST', '/api/tiktok/assistido/__/aprovar', assistida?.id, {}],
  ['PATCH', '/api/tiktok/metas/', meta?.id, { quantidadeRealizada: 9 }],
  ['PATCH', '/api/tiktok/resultados/', resultado?.id, { views: 1 }],
]
let falhas = 0
for (const [m, rota, id, corpo] of casos) {
  if (!id) { console.log(`--  ${m} ${rota} (sem registro da titular para testar)`); continue }
  const url = rota.includes('__') ? rota.replace('__', id) : rota + id
  const r = await fetch(BASE + url, { method: m, headers: { cookie, 'content-type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined, redirect: 'manual' })
  const t = await r.text()
  const ok = [400, 403, 404, 409].includes(r.status) && !t.includes(WS)
  if (!ok) falhas++
  console.log(`${ok ? 'OK' : 'XX'}  ${m} ${url.replace(id, '<id-da-titular>')} → ${r.status} ${ok ? '' : t.slice(0, 150)}`)
}
// listas do outro workspace não trazem nada da titular
for (const l of ['/api/tiktok/amostras', '/api/conteudos', '/api/produtos', '/api/vendas', '/api/torre', '/api/precisa-de-voce', '/api/tiktok/operacao']) {
  const r = await fetch(BASE + l, { headers: { cookie } })
  const t = await r.text()
  const vazou = t.includes(WS) || (amostra && t.includes(amostra.id)) || (produto && t.includes(produto.id))
  if (vazou || r.status >= 500) falhas++
  console.log(`${!vazou && r.status < 500 ? 'OK' : 'XX'}  GET ${l} → ${r.status} vazou=${!!vazou}`)
}
const depois = amostra ? await prisma.amostraTikTokShop.findUnique({ where: { id: amostra.id }, select: { estado: true, updatedAt: true } }) : null
const intacta = !amostra || (depois?.estado === amostra.estado && depois?.updatedAt.getTime() === amostra.updatedAt.getTime())
if (!intacta) falhas++
console.log(`${intacta ? 'OK' : 'XX'}  amostra da titular intacta depois das tentativas`)
console.log(`FALHAS ${falhas}`)
await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
