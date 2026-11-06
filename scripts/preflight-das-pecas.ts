/**
 * Preflight de cada peça gerada, SOMENTE LEITURA.
 *
 * Uso:
 *   DATABASE_URL="..." npx tsx scripts/preflight-das-pecas.ts [minutos]
 *
 * ── O QUE ELE RESPONDE ──────────────────────────────────────────────────
 * "A peça está pronta?" e "dá para publicar agora?" são perguntas
 * diferentes, e o preflight separa as duas: `pronto` fala da conta e da
 * peça; `executavelAgora` só é verdadeiro quando existe adapter ligado.
 * Com o registro de adapters vazio, o segundo tem de ser `false` em todas —
 * e é isso que este script confere.
 *
 * ── NÃO PUBLICA, NÃO CRIA Publicacao ────────────────────────────────────
 * `preflightDePublicacao` é read-only por construção. Nenhum adapter é
 * injetado: ele roda com o registro real, que está vazio.
 */

import { prisma } from '../lib/prisma'
import { preflightDePublicacao } from '../lib/preflight-de-publicacao'

async function main() {
  const minutos = Number(process.argv[2] ?? 30)
  const url = process.env.DATABASE_URL ?? ''
  console.log(`alvo: ${url.match(/@([^/:]+)/)?.[1] ?? '?'} — ref ${url.match(/[a-z]{20}/)?.[0] ?? '?'}`)
  console.log(`peças criadas nos últimos ${minutos} minutos\n`)

  const desde = new Date(Date.now() - minutos * 60_000)
  const pecas = await prisma.conteudo.findMany({
    where: { createdAt: { gte: desde } },
    select: { id: true, workspaceId: true, produtoId: true, status: true, redeSocial: true },
    orderBy: { createdAt: 'asc' },
  })

  if (pecas.length === 0) {
    console.log('nenhuma peça nesse intervalo')
    await prisma.$disconnect()
    return
  }

  let prontas = 0
  let executaveis = 0

  for (const p of pecas) {
    const produto = await prisma.produto.findUnique({
      where: { id: p.produtoId },
      select: { nome: true },
    })
    const canal = p.redeSocial ?? 'instagram'
    const r = await preflightDePublicacao({
      workspaceId: p.workspaceId,
      canal,
      contentId: p.id,
    })
    if (r.pronto) prontas += 1
    if (r.executavelAgora) executaveis += 1

    console.log(`  ${produto?.nome ?? p.produtoId}`)
    console.log(`    peça            ${p.id}  status=${p.status}`)
    console.log(`    canal           ${canal}`)
    console.log(`    pronto          ${r.pronto}`)
    console.log(`    executavelAgora ${r.executavelAgora}`)
    console.log(`    bloqueio        ${r.bloqueio ?? '(nenhum)'}`)
    console.log(`    oQueFalta       ${r.oQueFalta ?? '(nada)'}`)
    console.log(`    custoZero       ${r.custoZero}`)
    console.log(`    capability      publicar=${r.capabilityEfetiva.publicar} draft=${r.capabilityEfetiva.draft}`)
    console.log('')
  }

  console.log(`${'='.repeat(70)}`)
  console.log(`  ${pecas.length} peças  |  prontas: ${prontas}  |  executáveis agora: ${executaveis}`)
  if (executaveis > 0) {
    console.error('\n  ATENÇÃO: alguma peça está executável — havia adapter ligado?')
    await prisma.$disconnect()
    process.exit(1)
  }
  console.log('  Nenhuma é executável agora — nenhum adapter está ligado, como deve ser.')

  const publicacoes = await prisma.publicacao.count()
  console.log(`  Publicacao no banco: ${publicacoes}`)

  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error('ERRO:', e instanceof Error ? e.message : e)
  await prisma.$disconnect()
  process.exit(1)
})
