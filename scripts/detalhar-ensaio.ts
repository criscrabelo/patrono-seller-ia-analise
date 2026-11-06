/**
 * O detalhe por trás dos números do ensaio, SOMENTE LEITURA.
 *
 * Uso:
 *   DATABASE_URL="..." npx tsx scripts/detalhar-ensaio.ts
 *
 * ── POR QUE ESTE SCRIPT EXISTE ──────────────────────────────────────────
 * A resposta do cron traz os totais: 20 oportunidades, 5 itens de plano, 5
 * jobs. Totais não respondem "quais" nem "por quê" — e é isso que decide o
 * que fazer a seguir. Aqui saem os produtos, os formatos escolhidos, os
 * bloqueios e o que sobrou de fora, item a item.
 *
 * Chama `planejarWorkspace`, a MESMA função que o ensaio usa, que é
 * read-only por construção: ela lê catálogo e integrações, pontua e monta o
 * plano. Não grava, não publica, não gera.
 */

import { prisma } from '../lib/prisma'
import { planejarWorkspace, capacidadesDeclaradas } from '../lib/ciclo-de-oportunidades'

function titulo(t: string) {
  console.log(`\n${'='.repeat(74)}\n${t}\n${'='.repeat(74)}`)
}

async function main() {
  const url = process.env.DATABASE_URL ?? ''
  console.log(`alvo: ${url.match(/@([^/:]+)/)?.[1] ?? '?'} — ref ${url.match(/[a-z]{20}/)?.[0] ?? '?'}`)
  console.log('modo: SOMENTE LEITURA')

  const workspaces = await prisma.workspace.findMany({ select: { id: true, name: true } })
  const agora = new Date()
  const capacidades = capacidadesDeclaradas()

  for (const w of workspaces) {
    titulo(`WORKSPACE ${w.id}`)

    // ── De onde vêm os 25 e por que só 20 ─────────────────────────────
    const total = await prisma.produto.count({ where: { workspaceId: w.id } })
    const porStatus = await prisma.produto.groupBy({
      by: ['status'],
      where: { workspaceId: w.id },
      _count: { _all: true },
    })
    console.log(`\n  CATÁLOGO: ${total} produtos`)
    for (const s of porStatus) console.log(`    status=${s.status}: ${s._count._all}`)

    const semPreco = await prisma.produto.count({ where: { workspaceId: w.id, preco: null } })
    const semLink = await prisma.produto.count({ where: { workspaceId: w.id, linkProduto: null } })
    console.log(`    sem preço:       ${semPreco}`)
    console.log(`    sem linkProduto: ${semLink}`)

    const { canaisConectados, fila, plano, desejados, lacunas } = await planejarWorkspace({
      workspaceId: w.id,
      agora,
      capacidades,
    })

    console.log(`\n  CANAIS CONECTADOS: ${canaisConectados.join(', ') || '(nenhum)'}`)
    console.log(`\n  FILA DE OPORTUNIDADES: ${fila.length} avaliadas`)

    titulo('ITENS DO PLANO')
    console.log(`  ${plano.itens.length} itens\n`)
    for (const it of plano.itens) {
      console.log(`  #${it.posicao} ${it.produtoNome}`)
      console.log(`      categoria      ${it.categoria}`)
      console.log(`      score          ${it.scoreDaOportunidade}   prioridade ${it.prioridadeOperacional}`)
      console.log(`      canal/formato  ${it.canalRecomendado ?? '-'} / ${it.formatoRecomendado ?? '-'}`)
      console.log(`      estado         ${it.estado}`)
      console.log(`      próxima ação   ${it.proximaAcao}`)
      console.log(`      automática?    ${it.podeExecutarAutomaticamente}`)
      console.log(`      confiança      ${it.confianca}`)
      if (it.dependenciaExterna) console.log(`      depende de     ${it.dependenciaExterna}`)
      const bloqueios = (it as { bloqueios?: unknown[] }).bloqueios
      if (bloqueios?.length) console.log(`      bloqueios      ${JSON.stringify(bloqueios)}`)
    }

    titulo('JOBS QUE NASCERIAM')
    for (const d of desejados) {
      console.log(`  ${d.tipo.padEnd(30)} entidade=${d.entityId ?? '-'}`)
    }
    if (desejados.length === 0) console.log('  (nenhum)')

    if (lacunas.length) {
      titulo('LACUNAS DE FORMATO')
      for (const l of lacunas) console.log(`  ${JSON.stringify(l)}`)
    }

    titulo('O QUE FICOU DE FORA DO PLANO')
    const noPlano = new Set(plano.itens.map((i) => i.produtoId))
    const foraDoPlano = fila.filter((o) => !noPlano.has(o.produtoId))
    console.log(`  ${foraDoPlano.length} de ${fila.length} oportunidades não viraram item de plano.`)
    console.log(`  (o plano corta no topo da fila — é seleção por prioridade, não recusa)`)
    for (const o of foraDoPlano.slice(0, 8)) {
      const nome = (o as { produtoNome?: string; nome?: string }).produtoNome ?? (o as { nome?: string }).nome ?? o.produtoId
      console.log(`    score ${String(o.score).padStart(6)}  ${nome}`)
    }
    if (foraDoPlano.length > 8) console.log(`    … e mais ${foraDoPlano.length - 8}`)

    titulo('DADOS AUSENTES QUE LIMITAM A DECISÃO')
    const semImagens = await prisma.produto.count({ where: { workspaceId: w.id, imagens: { isEmpty: true } } })
    const semVideos = await prisma.produto.count({ where: { workspaceId: w.id, videos: { isEmpty: true } } })
    const cliques = await prisma.eventoLink.count({ where: { workspaceId: w.id } })
    const publicacoes = await prisma.publicacao.count({ where: { workspaceId: w.id } })
    const amostras = await prisma.mLFeatureSnapshot.count({ where: { workspaceId: w.id } })
    console.log(`  produtos sem imagem autorizada   ${semImagens} de ${total}`)
    console.log(`  produtos sem vídeo autorizado    ${semVideos} de ${total}`)
    console.log(`  produtos sem preço               ${semPreco} de ${total}`)
    console.log(`  cliques medidos (EventoLink)     ${cliques}`)
    console.log(`  publicações feitas               ${publicacoes}`)
    console.log(`  amostras de ML                   ${amostras}`)
  }

  titulo('FIM — nenhuma escrita')
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error('ERRO:', e instanceof Error ? e.message : e)
  await prisma.$disconnect()
  process.exit(1)
})
