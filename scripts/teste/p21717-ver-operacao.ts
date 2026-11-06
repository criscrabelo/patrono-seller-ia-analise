/** P2.17.17+ — leitura (só TESTE) da operação comercial e da central de um workspace. Não grava. */
import { prisma } from '../../lib/prisma'
import { operacaoComercial } from '../../lib/operacao-comercial'
import { centralPrecisaDeVoce } from '../../lib/precisa-de-voce-central'
import { painelDeVisoes } from '../../lib/visoes-de-produtos-http'
async function main() {
  const ws = process.argv[2]
  if (!(process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')) throw new Error('só TESTE')
  const o = await operacaoComercial(ws)
  console.log('FILA'); for (const i of o.fila) console.log(' ', i.estado, '|', i.quem, '|', i.produto.slice(0, 45), '|', i.acao)
  console.log('PROXIMA', o.proxima?.produto, o.proxima?.acao)
  console.log('AMOSTRAS', JSON.stringify({ ...o.amostras, prioridade: undefined })); for (const p of o.amostras.prioridade) console.log('  ', p.posicao, p.nome, '|', p.porque, '| valor', p.valor)
  console.log('CAMINHO'); for (const e of o.caminho) console.log('  ', e.etapa, e.estado, '—', e.detalhe)
  console.log('RISCOS'); for (const r of o.riscos) console.log('  ', r.gravidade, r.tipo, r.quem, r.notificar, '|', r.detalhe)
  console.log('AGENDA'); for (const a of o.agenda) console.log('  ', a.quando?.slice(0, 16) ?? '—', a.tipo, a.dependencia ?? '', a.titulo)
  console.log('PLANO'); for (const s of o.plano) console.log('  ', s.rotulo, s.situacao, s.hipotese.estrutura, '|', s.produtoSugerido ?? '')
  console.log('ATRIBUICAO', JSON.stringify(o.atribuicao))
  const c = await centralPrecisaDeVoce(ws)
  console.log('CENTRAL', c.length); for (const p of c) console.log('  ', p.categoria, p.urgencia, '|', p.titulo)
  const v = await painelDeVisoes(ws, 'MELHOR_OPORTUNIDADE')
  console.log('VISOES top'); for (const i of v.itens.slice(0, 8)) console.log('  ', i.posicao, i.nome.slice(0, 45), '|', i.porque.slice(0, 160))
}
main().finally(() => prisma.$disconnect())
