/**
 * P2.42 — Checagem LOCAL (R$ 0) de fidelidade ao produto real, depois de cada trecho gerado por IA.
 *
 * A IA não pode trocar capa, marca, cores ou características. Medida objetiva com FFmpeg (filtro `ssim`):
 *   - INÍCIO: o 1º quadro gerado tem de ser a mídia REAL (imagem→vídeo começa nela; vídeo→vídeo, no 1º quadro do take);
 *   - DERIVA: quadros do meio e do fim comparados ao 1º — produto "derretendo"/trocando de forma derruba o SSIM;
 *   - COR: deriva de cor média (capa recolorida) acima do limite reprova.
 * Reprovado = tentativa perdida (o custo conta) e o trecho NÃO entra no vídeo. A aprovação da titular continua sendo a
 * palavra final; isto só impede que um trecho adulterado chegue até ela.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import ffmpegStatic from 'ffmpeg-static'

const exec = promisify(execFile)
const bin = () => {
  const b = process.env.FFMPEG || (ffmpegStatic as unknown as string | null)
  if (!b) throw new Error('FFmpeg não encontrado')
  return b
}

export interface LimitesDeFidelidade {
  ssimInicioMin: number
  ssimDerivaMin: number
  derivaDeCorMax: number
}
export const LIMITES_PADRAO: LimitesDeFidelidade = { ssimInicioMin: 0.8, ssimDerivaMin: 0.55, derivaDeCorMax: 18 }

const NORMALIZAR = 'scale=540:960:force_original_aspect_ratio=increase,crop=540:960,setsar=1'

/** SSIM entre o quadro em `ta` de A e o quadro em `tb` de B (imagem ou vídeo), normalizados para 540×960. */
export async function ssim(a: string, ta: number, b: string, tb: number): Promise<number> {
  const { stderr } = await exec(bin(), ['-hide_banner', '-ss', String(ta), '-i', a, '-ss', String(tb), '-i', b,
    '-lavfi', `[0:v]${NORMALIZAR},format=gray[x];[1:v]${NORMALIZAR},format=gray[y];[x][y]ssim`, '-frames:v', '1', '-f', 'null', '-'], { maxBuffer: 8 << 20 })
  const m = stderr.match(/All:([0-9.]+)/)
  if (!m) throw new Error('SSIM ilegível')
  return Number(m[1])
}

/** Cor média (R,G,B 0–255) do quadro em `t`. */
async function corMedia(arq: string, t: number): Promise<[number, number, number]> {
  const { stdout } = await exec(bin(), ['-hide_banner', '-v', 'error', '-ss', String(t), '-i', arq, '-vf', `${NORMALIZAR},scale=1:1:flags=area,format=rgb24`, '-frames:v', '1', '-f', 'rawvideo', '-'], { encoding: 'buffer', maxBuffer: 1 << 20 })
  const b = stdout as unknown as Buffer
  return [b[0], b[1], b[2]]
}

export async function duracaoDe(arq: string): Promise<number> {
  const { stderr } = await exec(bin(), ['-hide_banner', '-i', arq], { maxBuffer: 8 << 20 }).catch((e) => ({ stderr: String(e.stderr ?? '') }))
  const m = stderr.match(/Duration: (\d+):(\d+):([\d.]+)/)
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0
}

export interface ResultadoDeFidelidade {
  aprovado: boolean
  ssimInicio: number
  ssimMeio: number
  ssimFim: number
  derivaDeCor: number
  motivos: string[]
}

export async function checarFidelidade(p: { midiaReal: string; gerado: string; limites?: LimitesDeFidelidade }): Promise<ResultadoDeFidelidade> {
  const L = p.limites ?? LIMITES_PADRAO
  const d = await duracaoDe(p.gerado)
  if (d <= 0.2) return { aprovado: false, ssimInicio: 0, ssimMeio: 0, ssimFim: 0, derivaDeCor: 999, motivos: ['Arquivo gerado vazio ou ilegível.'] }
  const [ini, meio, fim, c0, c1] = await Promise.all([
    ssim(p.midiaReal, 0, p.gerado, 0),
    ssim(p.gerado, 0, p.gerado, d / 2),
    ssim(p.gerado, 0, p.gerado, Math.max(0, d - 0.2)),
    corMedia(p.midiaReal, 0),
    corMedia(p.gerado, Math.max(0, d - 0.2)),
  ])
  const deriva = Math.hypot(c0[0] - c1[0], c0[1] - c1[1], c0[2] - c1[2])
  const motivos: string[] = []
  if (ini < L.ssimInicioMin) motivos.push(`1º quadro difere da mídia real (SSIM ${ini.toFixed(2)} < ${L.ssimInicioMin}).`)
  if (Math.min(meio, fim) < L.ssimDerivaMin) motivos.push(`Produto muda ao longo do trecho (SSIM ${Math.min(meio, fim).toFixed(2)} < ${L.ssimDerivaMin}).`)
  if (deriva > L.derivaDeCorMax) motivos.push(`Cores alteradas (deriva ${deriva.toFixed(1)} > ${L.derivaDeCorMax}).`)
  return { aprovado: motivos.length === 0, ssimInicio: ini, ssimMeio: meio, ssimFim: fim, derivaDeCor: Math.round(deriva * 10) / 10, motivos }
}
