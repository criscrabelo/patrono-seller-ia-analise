/**
 * P2.17.12 — Portas de render para os testes de banco: o MP4 é REAL (o
 * mesmo ffmpeg-static, local e gratuito), mas sem baixar mídia nem subir no
 * storage — a URL devolvida é do storage do projeto de TESTE (custódia), e a
 * mídia FIXTURE é registrada como gerada pelo Patrono. Nada vai à internet.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import ffmpegStatic from 'ffmpeg-static'
import type { PortasDoRender } from '../lib/video-assistido'

const exec = promisify(execFile)

export function urlDeCustodia(caminho: string): string {
  return `${(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')}/storage/v1/object/public/${caminho}`
}

export function portasDeTeste(opcoes: { duracaoErrada?: boolean } = {}): PortasDoRender & { renders: number; subidos: string[] } {
  const estado = { renders: 0, subidos: [] as string[] }
  return Object.assign(estado, {
    async renderizar(p: { duracaoSegundos: number }) {
      estado.renders++
      const saida = join(tmpdir(), `r-teste-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.mp4`)
      const dur = opcoes.duracaoErrada ? p.duracaoSegundos + 5 : p.duracaoSegundos
      await exec(ffmpegStatic as unknown as string, ['-f', 'lavfi', '-i', 'color=c=0x1d3557:s=540x960:r=15', '-t', String(dur), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-y', saida])
      return { caminhoLocal: saida, durationSeconds: dur }
    },
    async subir(_buffer: Buffer, caminho: string) {
      const url = urlDeCustodia(`videos/${caminho}`)
      estado.subidos.push(url)
      return url
    },
  })
}

/** Declaração FIXTURE: imagem gerada pelo Patrono, no storage de teste. */
export function declaracaoFixture(nome: string, userId: string) {
  return {
    url: urlDeCustodia(`imagens/teste/${nome}-${Date.now()}.png`),
    tipo: 'IMAGEM' as const,
    origem: 'GERADO_PELO_PATRONO' as const,
    titularidade: 'Patrono (FIXTURE de teste)',
    direitoDeUso: 'Gerada pelo Patrono para teste',
    declaradoPor: userId,
    declaradoEm: new Date(),
    descricao: 'FIXTURE: imagem sintética de teste',
    geracaoId: `fixture-${Date.now()}`,
  }
}
