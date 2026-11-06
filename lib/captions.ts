/**
 * Geração de legendas (Rodada 7) — determinística, sem serviço pago.
 * Usa o timing do próprio texto/TTS (estimativa de palavras por segundo)
 * para dividir a fala em blocos curtos, do jeito que o renderer já sabe
 * queimar como overlay (`lib/renderer-ffmpeg.ts`).
 */

export interface CaptionBloco {
  texto: string
  inicioSegundos: number
  fimSegundos: number
}

const PALAVRAS_POR_SEGUNDO_PADRAO = 2.5 // fala natural pt-BR, estimativa conservadora
const PALAVRAS_POR_BLOCO = 4 // legendas curtas e grandes, fáceis de ler em vídeo vertical

/**
 * Divide o texto em blocos de legenda com timing estimado. Se a duração
 * real do áudio for conhecida, `duracaoTotalSegundos` recalibra o ritmo
 * (nunca deixa a última legenda passar do fim do áudio).
 */
export function gerarLegendas(texto: string, duracaoTotalSegundos?: number): CaptionBloco[] {
  const palavras = texto.trim().split(/\s+/).filter(Boolean)
  if (palavras.length === 0) return []

  const duracaoEstimada = palavras.length / PALAVRAS_POR_SEGUNDO_PADRAO
  const duracaoTotal = duracaoTotalSegundos ?? duracaoEstimada
  const segundosPorPalavra = duracaoTotal / palavras.length

  const blocos: CaptionBloco[] = []
  for (let i = 0; i < palavras.length; i += PALAVRAS_POR_BLOCO) {
    const grupo = palavras.slice(i, i + PALAVRAS_POR_BLOCO)
    const inicioSegundos = i * segundosPorPalavra
    const fimSegundos = Math.min((i + grupo.length) * segundosPorPalavra, duracaoTotal)
    blocos.push({ texto: grupo.join(' '), inicioSegundos, fimSegundos })
  }
  return blocos
}
