/**
 * P1.9.2 — Do vídeo da dona até o preflight. PARA ANTES DE PUBLICAR.
 *
 *   upload → registrar direito → validar Reel → copy → link rastreado
 *        → (confirmação da bio, em outro script) → preflight
 *
 * PADRÃO: PRÉVIA. Sem `--gravar`, não sobe arquivo, não grava peça, não
 * gera link. Mostra o que aconteceria, com a URL exata.
 *
 * NUNCA publica: não cria `Publicacao`, não chama o Instagram, recusa
 * rodar com PUBLICACAO_REAL_INSTAGRAM=true.
 *
 * Uso:
 *   npx tsx scripts/preparar-peca-midia-propria.ts \
 *     --workspace <id> --produto <id> --declarado-por <seu-userId> \
 *     --arquivo "C:\caminho\colchao.mp4" \
 *     --descricao "vídeo que gravei do colchão inflando" \
 *     --declaro-gravado-por-mim --declaro-sem-musica-de-terceiros \
 *     --declaro-sem-terceiros-nem-criancas \
 *     [--gravar]
 *
 * Alternativa ao `--arquivo`: `--video-url <url>` de um vídeo já enviado
 * pela tela de Conteúdos (bucket `videos` do projeto). O arquivo é baixado
 * só para ser validado.
 *
 * Idempotente: o caminho no storage é o hash do arquivo, e a peça é
 * reencontrada pelo vídeo. Rodar duas vezes não duplica nada.
 */

import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { prisma } from '../lib/prisma'
import { prepararPecaComMidiaPropria } from '../lib/peca-com-midia-propria'
import { preflightDePublicacao } from '../lib/preflight-de-publicacao'
import { gerarLinkParaABio, situacaoDoLinkNaBio } from '../lib/link-na-bio'
import { validarReel } from '../lib/validacao-de-reel'
import { emCustodiaPropria } from '../lib/evidencia-de-midia'
import { uploadBuffer } from '../lib/supabase'

const BUCKET = 'videos'

function arg(nome: string): string | null {
  const i = process.argv.indexOf(`--${nome}`)
  return i === -1 ? null : process.argv[i + 1] ?? null
}
const flag = (nome: string) => process.argv.includes(`--${nome}`)

function urlPublicaDoStorage(caminho: string): string {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '')
  return `${base}/storage/v1/object/public/${BUCKET}/${caminho}`
}

async function main() {
  const workspaceId = arg('workspace')
  const produtoId = arg('produto')
  const declaradoPor = arg('declarado-por')
  const descricao = arg('descricao')
  const arquivo = arg('arquivo')
  const videoUrlInformada = arg('video-url')
  const gravar = flag('gravar')

  if (!workspaceId || !produtoId || !declaradoPor || !descricao || (!arquivo && !videoUrlInformada)) {
    console.error('Faltam argumentos. Veja o cabeçalho do script.')
    process.exit(1)
  }
  if (process.env.PUBLICACAO_REAL_INSTAGRAM?.trim().toLowerCase() === 'true') {
    console.error('PUBLICACAO_REAL_INSTAGRAM=true neste ambiente. Este script só prepara — desligue antes.')
    process.exit(1)
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    console.error('NEXT_PUBLIC_SUPABASE_URL ausente: sem ela não há storage nem custódia.')
    process.exit(1)
  }

  console.log(`modo: ${gravar ? 'GRAVAR (sobe o vídeo, grava a peça, gera o link — NÃO publica)' : 'PRÉVIA (nada é gravado)'}\n`)

  // 1. O ARQUIVO, lido e validado como Reel.
  let bytes: Buffer
  if (arquivo) {
    bytes = readFileSync(arquivo)
  } else {
    if (!emCustodiaPropria(videoUrlInformada!, process.env)) {
      console.error('A --video-url precisa estar no storage deste projeto (envie pela tela de Conteúdos).')
      process.exit(1)
    }
    const res = await fetch(videoUrlInformada!)
    if (!res.ok) throw new Error(`Não consegui baixar o vídeo para validar (HTTP ${res.status}).`)
    bytes = Buffer.from(await res.arrayBuffer())
  }
  const reel = validarReel(bytes)
  const m = reel.metadados
  console.log('1. Validação do Reel')
  console.log(`   ${m ? `${m.largura}×${m.altura}, ${m.duracaoS?.toFixed(1)} s, vídeo ${m.codecDeVideo}, áudio ${m.codecDeAudio ?? 'nenhum'}` : 'ilegível'}, ${(reel.tamanhoBytes / 1048576).toFixed(1)} MB`)
  console.log(`   ${reel.valido ? 'OK' : `REPROVADO:\n     - ${reel.problemas.join('\n     - ')}`}\n`)
  if (!reel.valido) {
    await prisma.$disconnect()
    process.exit(2)
  }

  // 2. O LUGAR no storage: hash do arquivo, determinístico.
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16)
  const caminho = `${produtoId}/reel-${hash}.mp4`
  const videoUrl = videoUrlInformada ?? urlPublicaDoStorage(caminho)
  if (!videoUrlInformada) {
    if (gravar) {
      const enviada = await uploadBuffer(bytes, BUCKET, caminho, 'video/mp4')
      if (enviada !== videoUrl) {
        console.error(`O storage devolveu uma URL inesperada (${enviada}). Nada foi gravado na peça.`)
        process.exit(1)
      }
      console.log(`2. Upload: ${BUCKET}/${caminho}\n`)
    } else {
      console.log(`2. Upload (prévia): iria para ${BUCKET}/${caminho}\n`)
    }
  }

  // 3. DIREITO + COPY + PEÇA.
  const { montagem, contentId, reaproveitada } = await prepararPecaComMidiaPropria({
    workspaceId, produtoId, videoUrl, gravar, reel,
    declaracao: {
      origem: 'PROPRIO',
      declaradoPor,
      descricao,
      declaracoes: {
        gravadoPelaPropriaDona: flag('declaro-gravado-por-mim'),
        semMusicaDeTerceiros: flag('declaro-sem-musica-de-terceiros'),
        semTerceirosNemCriancas: flag('declaro-sem-terceiros-nem-criancas'),
      },
    },
  })
  if (!montagem.ok) {
    console.log('3. A peça NÃO pode ser montada:')
    for (const x of montagem.motivos) console.log(`   - ${x}`)
    await prisma.$disconnect()
    process.exit(2)
  }
  const p = montagem.previa
  console.log('3. Peça')
  console.log(`   produto   ${p.produto}`)
  console.log(`   formato   ${p.formato}`)
  console.log(`   mídia     ${p.midia.origem} — ${p.midia.motivo}`)
  console.log(`   preço     ${p.preco.status}${p.preco.alerta ? ` — ${p.preco.alerta}` : ''}`)
  console.log(`   CTA       ${p.cta}`)
  console.log(`   legenda:\n${p.legenda.split('\n').map((l) => `     ${l}`).join('\n')}`)
  if (contentId) console.log(`   ${reaproveitada ? 'reaproveitada' : 'gravada'}: ${contentId}`)
  console.log('')

  if (!contentId) {
    console.log('Prévia concluída. Rode de novo com --gravar para subir o vídeo e gravar a peça.')
    await prisma.$disconnect()
    return
  }

  // 4. LINK RASTREADO — gerado de verdade, para a bio não abrir um 404.
  const link = await gerarLinkParaABio({ workspaceId, contentId, canal: 'instagram' })
  console.log('4. Link rastreado para a BIO')
  console.log(`   ${link.ok ? link.url : `não gerado: ${link.explicacao}`}\n`)

  // 5. PREFLIGHT. Para aqui.
  const situacao = await situacaoDoLinkNaBio({ workspaceId, contentId, canal: 'instagram' })
  const pf = await preflightDePublicacao({ workspaceId, canal: 'instagram', contentId })
  console.log('5. Preflight')
  console.log(`   pronto=${pf.pronto}  executavelAgora=${pf.executavelAgora}  bloqueio=${pf.bloqueio ?? '-'}`)
  console.log(`   link na bio: ${situacao?.estado ?? '-'}`)
  if (pf.pendencias.length) console.log(`   pendências: ${pf.pendencias.join(' | ')}`)
  console.log('\nPRÓXIMO PASSO (humano):')
  console.log(`   Cole ${link.url} na bio do Instagram e confirme com:`)
  console.log(`   npx tsx scripts/confirmar-link-na-bio.ts --workspace ${workspaceId} --conteudo ${contentId} \\`)
  console.log(`     --url "${link.url}" --confirmado-por ${declaradoPor} --eu-vi-o-link-na-bio`)
  console.log('\nNada foi publicado.')
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error('ERRO:', e instanceof Error ? e.message : e)
  await prisma.$disconnect()
  process.exit(1)
})
