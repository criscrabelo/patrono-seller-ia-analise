/**
 * P2.17.12 — Operação em TESTE (nunca Production):
 *
 *   --arvore        leva a publicação em andamento da titular adiante (a
 *                   aprovação prematura sem MP4 é retirada; sem mídia
 *                   autorizada vira UMA pendência "Fornecer mídia autorizada").
 *   --demonstracao  demonstração ponta a ponta com mídia FIXTURE gerada pelo
 *                   Patrono: produto → mídia autorizada → roteiro → render
 *                   (FFmpeg local) → MP4 no storage de TESTE → Quality Gate →
 *                   "Precisa de você" (seção Demonstração; não conta no sininho).
 *
 * Uso: node --env-file=<env de TESTE> node_modules/tsx/dist/cli.mjs scripts/teste/p21712-video-assistido.ts <workspaceId> --arvore --demonstracao
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import ffmpegStatic from 'ffmpeg-static'
import { createClient } from '@supabase/supabase-js'
import { Prisma } from '@prisma/client'

const REF_DE_TESTE = 'ref-teste-exemplo'
const exec = promisify(execFile)

async function main() {
  const [workspaceId, ...flags] = process.argv.slice(2)
  if (!workspaceId) throw new Error('Informe o workspaceId.')
  for (const v of ['DATABASE_URL', 'DIRECT_URL', 'NEXT_PUBLIC_SUPABASE_URL']) {
    if (!(process.env[v] ?? '').includes(REF_DE_TESTE)) throw new Error(`${v} não aponta para o projeto de TESTE: recusado.`)
  }
  const { prisma } = await import('../../lib/prisma')
  const A = await import('../../lib/publicacao-assistida')
  const C = await import('../../lib/precisa-de-voce-central')
  const V = await import('../../lib/video-assistido')
  const M = await import('../../lib/midia-do-produto')
  const { planejarVideos } = await import('../../lib/motor-de-videos-tiktok')
  try {
    if (flags.includes('--arvore')) {
      const a = await A.prepararProximaPublicacao({ workspaceId, userId: null })
      const ap = a.apresentacao as { video: { situacao: string } }
      console.log(JSON.stringify({ arvore: { id: a.id, produto: a.nomeProduto, estado: a.estado, estrutura: a.estrutura, video: ap.video.situacao, status: A.statusReal(a).principal } }, null, 1))
    }

    if (flags.includes('--demonstracao')) {
      const agora = new Date()
      const marca = `p21712-${agora.getTime()}`
      // 1) Mídia FIXTURE gerada PELO PATRONO (FFmpeg, sem foto de ninguém).
      const png = join(tmpdir(), `${marca}.png`)
      await exec(ffmpegStatic as unknown as string, [
        '-f', 'lavfi', '-i', 'gradients=s=1080x1920:c0=0x0b3d2e:c1=0x8a1c1c:x0=0:y0=0:x1=1080:y1=1920:d=1',
        '-f', 'lavfi', '-i', 'color=c=0xf4c542:s=360x360:d=1',
        '-filter_complex', '[0][1]overlay=(W-w)/2:(H-h)/2-120,drawbox=x=(iw-520)/2:y=(ih-520)/2-120:w=520:h=520:color=white@0.9:t=10',
        '-frames:v', '1', '-y', png,
      ])
      const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
      const { data: up, error } = await admin.storage.from('imagens').upload(`demonstracao/${marca}.png`, await readFile(png), { contentType: 'image/png', upsert: true })
      await unlink(png).catch(() => null)
      if (error) throw new Error(`upload da FIXTURE: ${error.message}`)
      const urlImagem = admin.storage.from('imagens').getPublicUrl(up.path).data.publicUrl
      const nome = 'FIXTURE Kit de Enfeites de Natal (demonstração)'
      const candidatoId = `demonstracao-${marca}`
      const midia = await M.registrarMidia({
        workspaceId, candidatoId, nomeProduto: nome, demonstracao: true,
        declaracao: {
          url: urlImagem, tipo: 'IMAGEM', origem: 'GERADO_PELO_PATRONO', titularidade: 'Patrono (FIXTURE de demonstração)', direitoDeUso: 'Gerada pelo Patrono só para demonstração em TESTE',
          declaradoPor: 'patrono', declaradoEm: agora, descricao: 'FIXTURE: imagem sintética (gradiente e formas), sem produto real', geracaoId: marca,
        },
      })
      if (midia.status !== 'AUTORIZADA') throw new Error(`FIXTURE não autorizada: ${midia.motivoStatus}`)
      // 2) Roteiro + checagem + formato escolhido pela MESMA política do fluxo real.
      const plano = planejarVideos({ nome, categoria: 'Casa e Decoração', preco: null, tiktokShop: true }, agora)
      const ordem = [...plano.testeInicial.variantes, ...plano.variantes.map((v) => v.id)]
      const midias = await M.midiasAutorizadas({ workspaceId, candidatoId })
      const escolha = A.escolherVariante(plano.variantes, ordem, new Set(), null, midias, true)
      if (!escolha?.automatico) throw new Error('Nenhum formato automático para a demonstração.')
      const video = V.videoInicial(escolha.versao.estrutura, midias)
      const demo = await prisma.publicacaoAssistida.create({
        data: {
          workspaceId, demonstracao: true, estado: V.estadoPeloVideo(video.situacao, 0), candidatoId, nomeProduto: nome,
          varianteId: escolha.versao.varianteId, estrutura: escolha.versao.estrutura,
          apresentacao: {
            produto: { nome, preco: null, comissaoPercentual: null, comissaoValor: null, comissaoTexto: 'demonstração (sem comissão)', link: null, tiktokShop: true, categoria: 'Casa e Decoração', statusEconomico: 'TESTANDO' },
            motivoEscolha: ['DEMONSTRAÇÃO em TESTE: produto e imagem fictícios (FIXTURE), para você assistir ao fluxo inteiro.'],
            video, versao: escolha.versao, textoNaTela: [], canal: 'tiktok', horarioPlanejado: agora.toISOString(), horarioOrigem: 'demonstração', missoes: [],
            produtoMarcado: 'Demonstração: nenhum produto real para marcar.',
          } as unknown as Prisma.InputJsonValue,
          qualityGate: escolha.qg as unknown as Prisma.InputJsonValue,
          historico: [{ em: agora.toISOString(), versao: 1, acao: 'QUALITY_GATE', veredito: escolha.qg.veredito, detalhe: `Roteiro: ${escolha.qg.resumo}` }] as unknown as Prisma.InputJsonValue,
          motivoEscolha: 'Demonstração em TESTE (FIXTURE).', objetivoDoTeste: 'Mostrar o fluxo: mídia autorizada → render → checagem → central.', metasIds: [],
        },
      })
      // 3) Render pelo trabalho longo (o mesmo do fluxo real): FFmpeg local + storage de TESTE.
      const inicio = Date.now()
      const r = await V.gerarVideoDaAssistida({ workspaceId, id: demo.id })
      const ap = r!.apresentacao as { video: { situacao: string; arquivo: string | null; erro?: string } }
      const qg = r!.qualityGate as { veredito: string; resumo: string; arquivo?: unknown }
      console.log(JSON.stringify({ demonstracao: { id: demo.id, estado: r!.estado, estrutura: r!.estrutura, situacao: ap.video.situacao, arquivo: ap.video.arquivo, erro: ap.video.erro ?? null, qualityGate: qg.veredito, resumo: qg.resumo, arquivoChecado: qg.arquivo, segundos: Math.round((Date.now() - inicio) / 100) / 10 } }, null, 1))
    }

    const central = await C.centralPrecisaDeVoce(workspaceId)
    const demos = await C.demonstracoesDaCentral(workspaceId)
    console.log(JSON.stringify({ sininho: central.length, pendencias: central.map((p) => `${p.categoria} — ${p.titulo}`), demonstracoes: demos.map((d) => d.titulo) }, null, 1))
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error((e as Error).message)
  process.exit(1)
})
