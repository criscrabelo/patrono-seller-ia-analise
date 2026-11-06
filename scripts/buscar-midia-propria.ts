/**
 * P1.9.1 — Existe mídia própria, com evidência, para a primeira publicação?
 *
 * SOMENTE LEITURA. Não grava, não publica, não chama canal.
 *
 * Uso:
 *   DATABASE_URL="..." NEXT_PUBLIC_SUPABASE_URL="..." npx tsx scripts/buscar-midia-propria.ts
 *
 * Para cada produto ativo, e para cada peça com vídeo, responde:
 *   - onde está a mídia (custódia própria × terceiro);
 *   - qual origem foi declarada;
 *   - se ela serve para publicação real no Instagram.
 *
 * Imprime HOST, nunca a URL inteira: a URL do storage pode ser assinada.
 */

import { prisma } from '../lib/prisma'
import {
  avaliarMidiaParaPublicacao,
  emCustodiaPropria,
  hostDeTerceiro,
  lerEvidenciaDeMidia,
} from '../lib/evidencia-de-midia'

const host = (u: string) => {
  try {
    return new URL(u).host
  } catch {
    return '?'
  }
}

async function main() {
  const env = process.env
  const url = env.DATABASE_URL ?? ''
  console.log(`alvo: ${url.match(/@([^/:]+)/)?.[1] ?? '?'}`)
  if (!env.NEXT_PUBLIC_SUPABASE_URL) {
    console.error('NEXT_PUBLIC_SUPABASE_URL ausente: sem ela não há como reconhecer custódia própria.')
    process.exit(1)
  }

  const produtos = await prisma.produto.findMany({
    where: { status: 'ativo' },
    select: { id: true, nome: true, origemConteudo: true, imagens: true, videos: true },
    orderBy: { nome: 'asc' },
  })

  let emCustodia = 0
  console.log(`\n${produtos.length} produtos ativos\n`)
  for (const p of produtos) {
    const midias = [...p.imagens, ...p.videos]
    const proprias = midias.filter((m) => emCustodiaPropria(m, env))
    const terceiros = [...new Set(midias.map(hostDeTerceiro).filter(Boolean))]
    if (proprias.length) emCustodia += 1
    console.log(
      `  ${p.nome.slice(0, 60).padEnd(60)}  origem=${p.origemConteudo.padEnd(18)} ` +
        `mídias=${midias.length} custódia-própria=${proprias.length} terceiros=${terceiros.join(',') || '-'}`
    )
  }

  const pecas = await prisma.conteudo.findMany({
    where: { videoUrl: { not: null } },
    select: { id: true, videoUrl: true, alertasCompliance: true, produto: { select: { nome: true } } },
  })
  let publicaveis = 0
  console.log(`\n${pecas.length} peças com vídeo\n`)
  for (const c of pecas) {
    const ev = lerEvidenciaDeMidia(c.alertasCompliance as unknown[])
    const r = avaliarMidiaParaPublicacao({ assetUrl: c.videoUrl, evidencia: ev, env })
    if (r.autorizada) publicaveis += 1
    console.log(`  ${c.id}  ${c.produto.nome.slice(0, 40).padEnd(40)}  host=${host(c.videoUrl!)}  ${r.autorizada ? 'PUBLICÁVEL' : 'não'} — ${r.motivo}`)
  }

  console.log(`\n${'='.repeat(70)}`)
  console.log(`  produtos com alguma mídia em custódia própria: ${emCustodia}`)
  console.log(`  peças com vídeo publicável no Instagram:       ${publicaveis}`)
  console.log('  Custódia prova que a conta subiu o arquivo — não prova autoria.')
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error('ERRO:', e instanceof Error ? e.message : e)
  await prisma.$disconnect()
  process.exit(1)
})
