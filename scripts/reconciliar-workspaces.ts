/**
 * P2.18.11 — Reconciliação da fonte única do produto, workspace por workspace.
 *
 * Corrige SÓ estado derivado (candidato vivo de cadastro excluído; publicação,
 * amostra e pedido em andamento de produto inativo). Nunca apaga histórico.
 * Também é o BACKFILL dos produtos excluídos antes da P2.18.11 (a exclusão
 * antiga só marcava o cadastro).
 *
 * Padrão: SÓ CONTA (não escreve). Para corrigir: --aplicar.
 * Em Production exige também --confirmo-producao (decisão da titular).
 *
 *   node --env-file=<.env de teste> ./node_modules/tsx/dist/cli.mjs scripts/reconciliar-workspaces.ts [--workspace=<id>] [--aplicar]
 */
import { prisma } from '../lib/prisma'
import { reconciliarEstadoDoWorkspace } from '../lib/produto-canonico'

const aplicar = process.argv.includes('--aplicar')
const ehProducao = process.env.PATRONO_AMBIENTE === 'producao'
const so = process.argv.find((a) => a.startsWith('--workspace='))?.split('=')[1]

async function main() {
  if (aplicar && ehProducao && !process.argv.includes('--confirmo-producao')) {
    console.log('Recusado: em Production é preciso --confirmo-producao (com autorização da titular).')
    process.exitCode = 1
    return
  }
  const workspaces = so ? [{ id: so }] : await prisma.workspace.findMany({ select: { id: true } })
  let divergentes = 0
  for (const w of workspaces) {
    const r = await reconciliarEstadoDoWorkspace(w.id, { aplicar })
    const soma = r.candidatosDeProdutoExcluido + r.publicacoesDeProdutoInativo + r.amostrasDeProdutoInativo + r.pedidosDeProdutoInativo
    if (soma || r.jornadasOrfas) {
      divergentes++
      console.log(`${w.id}: candidatos de produto excluído=${r.candidatosDeProdutoExcluido} publicações=${r.publicacoesDeProdutoInativo} amostras=${r.amostrasDeProdutoInativo} pedidos=${r.pedidosDeProdutoInativo} jornadas órfãs=${r.jornadasOrfas} | ativos agora: produtos=${r.contagens.produtosAtivos} candidatos=${r.contagens.candidatosAtivos}`)
    }
  }
  console.log(`${workspaces.length} workspace(s); ${divergentes} com divergência; ${aplicar ? 'CORRIGIDO' : 'só contagem (use --aplicar)'}`)
}

main().finally(() => prisma.$disconnect())
