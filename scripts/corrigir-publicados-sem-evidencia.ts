/**
 * P2.15.4 — Corrige conteúdos marcados "publicado" SEM evidência real.
 *
 * Até a P2.15.3, três caminhos internos gravavam `publicado` sem nada ter
 * saído (listagem, cron sem vídeo, cron sem canal). Evidência real =
 * `Conteudo.publicacaoExternaId` OU uma `Publicacao` DISTRIBUIDA do conteúdo.
 * O que não tiver evidência volta a ser "Publicação atrasada".
 *
 * Padrão: SÓ CONTA (não escreve). Para corrigir: --aplicar.
 * Em Production exige também --confirmo-producao (decisão da titular).
 *
 *   node --env-file=<.env de teste> ./node_modules/tsx/dist/cli.mjs scripts/corrigir-publicados-sem-evidencia.ts [--aplicar]
 */
import { prisma } from '../lib/prisma'
import { STATUS_ATRASADA } from '../lib/publicacao-atrasada'

const aplicar = process.argv.includes('--aplicar')
const ehProducao = process.env.PATRONO_AMBIENTE === 'producao'

async function main() {
  if (aplicar && ehProducao && !process.argv.includes('--confirmo-producao')) {
    console.log('Recusado: em Production é preciso --confirmo-producao (com autorização da titular).')
    process.exitCode = 1
    return
  }
  const semEvidencia = await prisma.conteudo.findMany({
    where: {
      status: 'publicado',
      publicacaoExternaId: null,
      publicacoes: { none: { estado: 'DISTRIBUIDA' } },
    },
    select: { id: true, workspaceId: true, dataPublicacao: true },
  })
  const porWorkspace = new Map<string, number>()
  for (const c of semEvidencia) porWorkspace.set(c.workspaceId, (porWorkspace.get(c.workspaceId) ?? 0) + 1)
  console.log(`Ambiente: ${ehProducao ? 'PRODUÇÃO' : 'teste'} | "publicado" sem evidência: ${semEvidencia.length} conteúdo(s) em ${porWorkspace.size} workspace(s).`)
  if (!aplicar) {
    console.log('Só contagem. Nada foi alterado. Use --aplicar para corrigir.')
    return
  }
  const r = await prisma.conteudo.updateMany({
    where: { id: { in: semEvidencia.map((c) => c.id) }, status: 'publicado', publicacaoExternaId: null },
    data: {
      status: STATUS_ATRASADA,
      erroPublicacao: 'Estava como "publicado" sem confirmação do canal (corrigido na P2.15.4). Nada saiu: reagende quando estiver pronto.',
    },
  })
  console.log(`Corrigidos: ${r.count}. A data de publicação antiga foi mantida no registro para auditoria.`)
}

main().finally(() => prisma.$disconnect())
