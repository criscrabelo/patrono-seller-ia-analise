/** P2.17.13 — leitura (só TESTE) dos resumos no workspace informado. Não grava nada. */
import { prisma } from '../../lib/prisma'
import * as R from '../../lib/resumos'
import { torreDeControle } from '../../lib/torre-de-controle'
async function main() {
  const ws = process.argv[2]
  if (!(process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')) throw new Error('só TESTE')
  const t = await torreDeControle(ws)
  console.log(JSON.stringify({
    torre: { receita: [t.receita.hoje.comissao, t.receita.sete.comissao, t.receita.trinta.comissao, t.receita.trinta.vendas, t.receita.missaoEmJogo], agora: t.agoraEnxuto, pendencias: t.precisaDeVoceTotal },
    topo: await R.statusDoTopo(ws), conteudo: await R.resumoConteudo(ws), ferramentas: (await R.situacaoDasFerramentas(ws)).map((f) => `${f.nome}: ${f.situacao}`),
    integracoes: (await R.integracoesExecutivo(ws)).linhas.map((i) => `${i.nome}: ${i.situacao}`), canais: (await R.canaisDeReceita(ws)).map((c) => `${c.nome}: ${c.situacao}`),
    videos: (await R.videosDoFluxo(ws)).map((v) => `${v.produto} · ${v.origem}${v.demonstracao ? ' · demo' : ''}`),
  }, null, 1))
}
main().finally(() => prisma.$disconnect())
