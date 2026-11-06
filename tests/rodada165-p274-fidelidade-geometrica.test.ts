/**
 * P2.74 — Fidelidade com movimento de câmera (worker/fidelidade_geometrica.py). Local, sem rede.
 * Referência sintética: "produto" com textura (testsrc2) no centro de um fundo liso. Precisa do Python com OpenCV
 * (C:\patrono-venv ou PATRONO_PYTHON); sem ele, o teste é PULADO (não aprovado).
 *   node node_modules/tsx/dist/cli.mjs --test tests/rodada165-p274-fidelidade-geometrica.test.ts
 */
import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import ffmpegStatic from 'ffmpeg-static'

const PY = process.env.PATRONO_PYTHON || 'C:\\patrono-venv\\Scripts\\python.exe'
const temCv = spawnSync(PY, ['-c', 'import cv2'], { stdio: 'ignore' }).status === 0
const ff = ffmpegStatic as unknown as string
const D = mkdtempSync(join(tmpdir(), 'fid-geo-'))
const f = (n: string) => join(D, n)
const run = (args: string[]) => execFileSync(ff, ['-hide_banner', '-loglevel', 'error', '-y', ...args])
const enc = ['-t', '6', '-r', '30', '-c:v', 'libx264', '-crf', '23', '-pix_fmt', 'yuv420p']
const avaliar = (video: string) => JSON.parse(execFileSync(PY, ['-I', join(__dirname, '..', 'worker', 'fidelidade_geometrica.py'), '--referencia', f('ref.png'), '--video', video], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })) as { aprovado: boolean; motivos: string[] }

describe('P2.74 — fidelidade geométrica', { skip: !temCv && 'Python com OpenCV ausente' }, () => {
  before(() => {
    run(['-f', 'lavfi', '-i', 'color=c=0xF4F6F8:s=720x1280', '-f', 'lavfi', '-i', 'testsrc2=s=520x700', '-filter_complex', '[0][1]overlay=100:290', '-frames:v', '1', f('ref.png')])
    run(['-f', 'lavfi', '-i', 'mandelbrot=s=720x1280', '-frames:v', '1', f('outro.png')])
    run(['-loop', '1', '-r', '30', '-i', f('ref.png'), '-vf', "zoompan=z='1+0.0008*on':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=180:s=720x1280:fps=30", ...enc, f('aproximacao.mp4')])
    run(['-loop', '1', '-r', '30', '-i', f('ref.png'), '-vf', "perspective=x0='40*in/180':y0=0:x1=W:y1='30*in/180':x2=0:y2=H:x3=W:y3='H-30*in/180':sense=destination:eval=frame", ...enc, f('orbita.mp4')])
    run(['-loop', '1', '-t', '6', '-i', f('ref.png'), '-loop', '1', '-t', '6', '-i', f('outro.png'), '-filter_complex', '[0:v]fps=30[a];[1:v]fps=30[b];[a][b]xfade=transition=fade:duration=2:offset=2', ...enc, f('trocado.mp4')])
    run(['-i', f('aproximacao.mp4'), '-vf', "drawbox=x=260:y=560:w=200:h=160:color=0x204080:t=fill:enable='gt(t,2)'", ...enc, f('alteracao-local.mp4')])
    run(['-i', f('orbita.mp4'), '-i', f('outro.png'), '-filter_complex', "[1:v]scale=160:-1[o];[0:v][o]overlay=40:60:enable='gt(t,2)'", ...enc, f('objeto-novo.mp4')])
  })
  test('movimento de câmera com o produto intacto é APROVADO (aproximação e órbita em perspectiva)', () => {
    for (const v of ['aproximacao', 'orbita']) { const r = avaliar(f(`${v}.mp4`)); assert.ok(r.aprovado, `${v}: ${r.motivos.join(' / ')}`) }
  })
  test('produto trocado, alteração local e objeto novo são REPROVADOS', () => {
    assert.match(avaliar(f('trocado.mp4')).motivos.join(' '), /não alinha|difere da foto/)
    assert.match(avaliar(f('alteracao-local.mp4')).motivos.join(' '), /alteração local|difere da foto/)
    assert.match(avaliar(f('objeto-novo.mp4')).motivos.join(' '), /objeto que não está na foto/)
  })
})
