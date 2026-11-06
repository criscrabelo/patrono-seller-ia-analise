// P2.76/P2.77 — Avaliação objetiva de uma tomada gerada por IA (local, R$ 0): duração real, fidelidade geométrica à
// foto oficial com a causa da reprovação, folha de quadros a cada 0,5 s ao lado da referência e cópia para a titular.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { decidirFidelidade, produtoTemInscricoes } from '../../lib/video-pro/inscricoes'

export function avaliarTomada(o: { arquivo: string; quadro: string; rotulo: string; pastaTitular: string; semInscricoes?: boolean }) {
  const ff = ffmpegStatic as unknown as string
  const py = process.env.PATRONO_PYTHON || join('C:', 'patrono-venv', 'Scripts', 'python.exe')
  const dur = (() => { try { execFileSync(ff, ['-hide_banner', '-i', o.arquivo], { stdio: 'pipe' }) } catch (e) { const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(String((e as { stderr?: Buffer }).stderr)); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null } return null })()
  // código de saída ≠ 0 com veredito em JSON (ex.: arquivo ilegível) = REPROVADO com o motivo, não queda do processo
  const saidaFid = (() => { try { return execFileSync(py, ['-I', join(__dirname, '..', '..', 'worker', 'fidelidade_geometrica.py'), '--referencia', o.quadro, '--video', o.arquivo], { encoding: 'utf8' }) } catch (e) { return String((e as { stdout?: string }).stdout || '{"aprovado":false,"quadros":[],"motivos":["conferência não executou"]}') } })()
  const fid = JSON.parse(saidaFid) as { aprovado: boolean; motivos: string[]; quadros: { t: number; pontos: number; correlacao: number; piorRegiao: number }[] }
  const folha = o.arquivo.replace(/\.mp4$/, '-folha-0,5s.jpg')
  const linhas = Math.max(1, Math.ceil(Math.floor((dur ?? 10) * 2) / 6))
  execFileSync(ff, ['-hide_banner', '-loglevel', 'error', '-y', '-i', o.arquivo, '-i', o.quadro, '-filter_complex', `[0:v]fps=2,scale=240:426,tile=6x${linhas}[f];[1:v]scale=240:426,pad=240:${426 * linhas}[r];[r][f]hstack=shortest=1`, '-frames:v', '1', folha])
  // causa objetiva da reprovação, por tipo de falha da conferência
  const causas = [...new Set(fid.motivos.map((m) => /não alinha/.test(m) ? 'produto some ou é trocado (sem alinhamento com a foto)' : /difere da foto/.test(m) ? 'produto alterado no conjunto (forma/cor)' : /alteração local/.test(m) ? 'inscrição ou componente alterado em uma região' : /objeto/.test(m) ? 'objeto que não existe na foto foi acrescentado' : m))]
  mkdirSync(o.pastaTitular, { recursive: true })
  copyFileSync(o.arquivo, join(o.pastaTitular, `${o.rotulo}.mp4`))
  copyFileSync(folha, join(o.pastaTitular, `${o.rotulo}-folha.jpg`))
  // P2.84: a nota de similaridade só reprova; com inscrições, aprovar exige conferência humana do arquivo (sha256)
  const sha256 = createHash('sha256').update(readFileSync(o.arquivo)).digest('hex')
  const decisao = decidirFidelidade({ aprovadoPelaSimilaridade: fid.aprovado, produtoTemInscricoes: produtoTemInscricoes({ semInscricoes: o.semInscricoes }), sha256 })
  return {
    decisao: decisao.decisao,
    motivoDaDecisao: decisao.motivo,
    sha256,
    duracaoGeradaS: dur,
    // P2.83: a ia-heroi trocou IOREF→"ZOREF", RESET→"MESSY", GND→"CND" e passou com 0,971 (grade 16×16 também não separa):
    // a conferência por regiões NÃO valida inscrições. Texto é sempre conferido no olho, na folha, antes de qualquer uso.
    textoDaPlaca: 'NÃO VERIFICADO pela conferência automática: conferir as inscrições na folha de quadros',
    fidelidade: { aprovado: fid.aprovado, piorCorrelacao: fid.quadros.length ? Math.min(...fid.quadros.map((q) => q.correlacao)) : null, piorRegiao: fid.quadros.length ? Math.min(...fid.quadros.map((q) => q.piorRegiao)) : null, causas, motivos: fid.motivos.slice(0, 5) },
    folha,
    paraAvaliacaoVisual: o.pastaTitular,
  }
}
