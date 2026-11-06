// P2.74 — ENCAIXE de uma tomada gerada por IA na montagem (local, R$ 0). Nada aqui chama API.
//   node node_modules/tsx/dist/cli.mjs scripts/video-pro/encaixar-tomada-ia.ts <gerado.mp4> <quadro-inicial.png> <papel> <pasta-producao>
// 1. Fidelidade objetiva com movimento de câmera (worker/fidelidade_geometrica.py, OpenCV): cada quadro a cada 0,5 s
//    é alinhado à foto oficial (quadro inicial enviado) e comparado por regiões — produto trocado, letreiro/chip
//    alterado ou objeto novo reprovam. (O SSIM contra o 1º quadro de lib/video-pro/fidelidade.ts reprova até
//    aproximação fiel: medido 0,11.) Reprovada = descartada (o custo já conta no livro-caixa; não se "conserta").
// 2. Folha de conferência: quadro inicial ao lado de um quadro a cada 0,5 s, para a conferência visual de serigrafia,
//    chips e conectores (e para o revisor independente, que recebe só o vídeo final).
// 3. Aprovada: ampliação LOCAL para 1080×1920 (lanczos), 30 fps, 4 s, sem o áudio gerado → <pasta-producao>/tomadas/<papel>.mp4;
//    a tomada de foto anterior fica guardada como tomadas/foto-<papel>.mp4.
// P2.84: similaridade aprovada NÃO basta. Produto com inscrições (padrão; só "semInscricoes": true no brief.json da
//    produção dispensa) só é encaixado com <pasta-de-conferência>/conferencia-inscricoes.json de revisor humano
//    independente, do MESMO sha256 do arquivo gerado (registrar-conferencia-inscricoes.ts). Sem isso: código 3, nada
//    encaixado. Encaixada, deixa tomadas/<papel>.ia.json — a auditoria do vídeo final passa a tratar a imagem como IA.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { duracaoDe } from '../../lib/video-pro/fidelidade'
import { ARQUIVO_DE_CONFERENCIA, decidirFidelidade, lerConferencia, produtoTemInscricoes } from '../../lib/video-pro/inscricoes'

const [GERADO, QUADRO, PAPEL, PRODUCAO] = process.argv.slice(2)
if (!GERADO || !QUADRO || !PAPEL || !PRODUCAO) throw new Error('uso: encaixar-tomada-ia.ts <gerado.mp4> <quadro-inicial.png> <papel> <pasta-producao>')
const ff = process.env.FFMPEG || (ffmpegStatic as unknown as string)

async function main() {
  const py = process.env.PATRONO_PYTHON || join('C:', 'patrono-venv', 'Scripts', 'python.exe')
  const fid = JSON.parse(execFileSync(py, ['-I', join(__dirname, '..', '..', 'worker', 'fidelidade_geometrica.py'), '--referencia', QUADRO, '--video', GERADO, '--passo', '0.5'], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, maxBuffer: 1 << 24 })) as { aprovado: boolean; motivos: string[]; quadros: { t: number; pontos: number; correlacao: number; piorRegiao: number }[] }
  const d = await duracaoDe(GERADO)
  const pasta = join(dirname(GERADO), `conferencia-${basename(GERADO, '.mp4')}`)
  mkdirSync(pasta, { recursive: true })
  // folha: referência + quadros a cada 0,5 s (até 10 s), em grade de 6 colunas
  const n = Math.min(20, Math.floor(d / 0.5))
  execFileSync(ff, ['-hide_banner', '-loglevel', 'error', '-y', '-i', GERADO, '-vf', `fps=2,scale=270:480:force_original_aspect_ratio=decrease,pad=270:480:(ow-iw)/2:(oh-ih)/2,tile=6x${Math.ceil(n / 6)}`, '-frames:v', '1', join(pasta, 'folha-0,5s.jpg')])
  execFileSync(ff, ['-hide_banner', '-loglevel', 'error', '-y', '-i', QUADRO, '-vf', 'scale=540:960:force_original_aspect_ratio=decrease', join(pasta, 'referencia.jpg')])
  const sha256 = createHash('sha256').update(readFileSync(GERADO)).digest('hex')
  const brief = (() => { try { return JSON.parse(readFileSync(join(PRODUCAO, 'brief.json'), 'utf8')) as { semInscricoes?: boolean } } catch { return {} } })()
  const conferencia = lerConferencia(join(pasta, ARQUIVO_DE_CONFERENCIA))
  const dec = decidirFidelidade({ aprovadoPelaSimilaridade: fid.aprovado, produtoTemInscricoes: produtoTemInscricoes({ semInscricoes: brief.semInscricoes }), sha256, conferencia })
  const registro = { gerado: GERADO, sha256, quadroInicial: QUADRO, papel: PAPEL, duracaoS: d, fidelidade: fid, decisao: dec.decisao, motivoDaDecisao: dec.motivo, conferenciaDeInscricoes: conferencia, em: new Date().toISOString() }
  writeFileSync(join(pasta, 'fidelidade.json'), JSON.stringify(registro, null, 1))
  if (!fid.aprovado) { console.log(JSON.stringify({ papel: PAPEL, aprovado: false, decisao: dec.decisao, motivos: fid.motivos, folha: pasta })); process.exitCode = 2; return }
  if (dec.decisao !== 'APROVADO') { console.log(JSON.stringify({ papel: PAPEL, aprovado: false, decisao: dec.decisao, motivo: dec.motivo, sha256, folha: pasta })); process.exitCode = dec.decisao === 'REPROVADO' ? 2 : 3; return }
  const tomadas = join(PRODUCAO, 'tomadas'), alvo = join(tomadas, `${PAPEL}.mp4`)
  mkdirSync(tomadas, { recursive: true })
  if (existsSync(alvo) && !existsSync(join(tomadas, `foto-${PAPEL}.mp4`))) copyFileSync(alvo, join(tomadas, `foto-${PAPEL}.mp4`))
  execFileSync(ff, ['-hide_banner', '-loglevel', 'error', '-y', '-i', GERADO, '-t', '4', '-an', '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', alvo])
  writeFileSync(join(tomadas, `${PAPEL}.ia.json`), JSON.stringify({ geradaPorIA: true, origem: GERADO, sha256DoGerado: sha256, decisao: dec.decisao, conferencia, em: new Date().toISOString() }, null, 1))
  console.log(JSON.stringify({ papel: PAPEL, aprovado: true, decisao: dec.decisao, correlacaoMin: Math.min(...fid.quadros.map((q) => q.correlacao)), piorRegiao: Math.min(...fid.quadros.map((q) => q.piorRegiao)), encaixado: alvo, folha: pasta }))
}
main()
