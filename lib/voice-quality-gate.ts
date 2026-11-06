/**
 * Voice Quality Gate (Rodada 7) — checagens mínimas e determinísticas
 * antes de aceitar um áudio gerado pela clonagem de voz. Nenhuma avaliação
 * subjetiva de "soa natural" nesta rodada — isso fica para um campo futuro
 * de avaliação humana (`avaliacaoHumana`), nunca exigido a cada vídeo.
 */

import { analisarAudio } from './audio-ffprobe'

export interface VoiceQualityGateResultado {
  aprovado: boolean
  problemas: string[]
  analise: { duracaoSegundos: number | null; meanVolumeDb: number | null; maxVolumeDb: number | null }
}

export interface VoiceQualityLimites {
  duracaoMinimaSegundos: number
  duracaoMaximaSegundos: number
  volumeMinimoDb: number // abaixo disso, áudio "vazio"/baixo demais
  clippingMaximoDb: number // acima disso (perto de 0dB), risco de clipping extremo
}

export const LIMITES_PADRAO_VOZ: VoiceQualityLimites = {
  duracaoMinimaSegundos: 0.5,
  duracaoMaximaSegundos: 120,
  volumeMinimoDb: -40,
  clippingMaximoDb: -0.1,
}

export async function avaliarQualidadeVoz(
  caminhoArquivo: string,
  tamanhoBytes: number,
  limites: VoiceQualityLimites = LIMITES_PADRAO_VOZ
): Promise<VoiceQualityGateResultado> {
  const problemas: string[] = []

  if (tamanhoBytes <= 0) {
    problemas.push('Arquivo gerado está vazio.')
    return { aprovado: false, problemas, analise: { duracaoSegundos: null, meanVolumeDb: null, maxVolumeDb: null } }
  }

  const analise = await analisarAudio(caminhoArquivo)

  if (analise.duracaoSegundos == null) {
    problemas.push('Não foi possível determinar a duração do áudio.')
  } else if (analise.duracaoSegundos < limites.duracaoMinimaSegundos || analise.duracaoSegundos > limites.duracaoMaximaSegundos) {
    problemas.push(`Duração (${analise.duracaoSegundos.toFixed(2)}s) fora do intervalo plausível (${limites.duracaoMinimaSegundos}-${limites.duracaoMaximaSegundos}s).`)
  }

  if (analise.meanVolumeDb == null) {
    problemas.push('Não foi possível determinar o volume médio.')
  } else if (analise.meanVolumeDb < limites.volumeMinimoDb) {
    problemas.push(`Volume médio (${analise.meanVolumeDb}dB) abaixo do mínimo aceitável (${limites.volumeMinimoDb}dB) — áudio pode estar vazio/baixo demais.`)
  }

  if (analise.maxVolumeDb != null && analise.maxVolumeDb > limites.clippingMaximoDb) {
    problemas.push(`Volume de pico (${analise.maxVolumeDb}dB) indica possível clipping extremo.`)
  }

  return { aprovado: problemas.length === 0, problemas, analise }
}
