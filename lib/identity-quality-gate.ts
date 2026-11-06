/**
 * Identity Quality Gate (Rodada 7) — valida o vídeo de referência antes de
 * ativar o Digital Twin. Checagens objetivas (duração, resolução, arquivo
 * utilizável) são verificadas de verdade via FFmpeg. Detecção de rosto
 * ("rosto detectável", "apenas uma identidade principal") exigiria um
 * modelo de visão computacional que este ambiente não tem instalado — por
 * isso NUNCA é assumida como `true`: enquanto não houver um detector real
 * plugado, o resultado geral nunca passa de `NOT_VERIFIED`, nunca
 * `TECHNICALLY_VALID` sozinho aprova a ativação.
 */

import { analisarVideo } from './audio-ffprobe'

export type IdentityQualityStatus = 'TECHNICALLY_VALID' | 'NOT_VERIFIED' | 'REJECTED'

export interface IdentityQualityLimites {
  duracaoMinimaSegundos: number
  duracaoMaximaSegundos: number
  larguraMinimaPx: number
  alturaMinimaPx: number
}

export const LIMITES_PADRAO_IDENTIDADE: IdentityQualityLimites = {
  duracaoMinimaSegundos: 5,
  duracaoMaximaSegundos: 120,
  larguraMinimaPx: 480,
  alturaMinimaPx: 480,
}

export interface IdentityQualityResultado {
  status: IdentityQualityStatus
  problemas: string[]
  detalhes: { duracaoSegundos: number | null; larguraPx: number | null; alturaPx: number | null }
}

/**
 * Detector de rosto — nunca assume disponibilidade. Sem um modelo real
 * plugado (nenhum nesta rodada), sempre devolve `disponivel: false`.
 */
export interface DetectorDeRosto {
  detectar(caminhoVideo: string): Promise<{ disponivel: boolean; rostosDetectados: number | null }>
}

export class DetectorDeRostoNaoDisponivel implements DetectorDeRosto {
  async detectar() {
    return { disponivel: false, rostosDetectados: null }
  }
}

export async function avaliarQualidadeIdentidade(
  caminhoVideo: string,
  tamanhoBytes: number,
  detector: DetectorDeRosto = new DetectorDeRostoNaoDisponivel(),
  limites: IdentityQualityLimites = LIMITES_PADRAO_IDENTIDADE
): Promise<IdentityQualityResultado> {
  const problemas: string[] = []

  if (tamanhoBytes <= 0) {
    return { status: 'REJECTED', problemas: ['Arquivo de vídeo vazio.'], detalhes: { duracaoSegundos: null, larguraPx: null, alturaPx: null } }
  }

  const analise = await analisarVideo(caminhoVideo)

  if (analise.duracaoSegundos == null) {
    problemas.push('Não foi possível determinar a duração do vídeo.')
  } else if (analise.duracaoSegundos < limites.duracaoMinimaSegundos) {
    problemas.push(`Vídeo curto demais (${analise.duracaoSegundos.toFixed(1)}s) — mínimo ${limites.duracaoMinimaSegundos}s.`)
  } else if (analise.duracaoSegundos > limites.duracaoMaximaSegundos) {
    problemas.push(`Vídeo longo demais (${analise.duracaoSegundos.toFixed(1)}s) — máximo ${limites.duracaoMaximaSegundos}s.`)
  }

  if (analise.larguraPx == null || analise.alturaPx == null) {
    problemas.push('Não foi possível determinar a resolução do vídeo.')
  } else if (analise.larguraPx < limites.larguraMinimaPx || analise.alturaPx < limites.alturaMinimaPx) {
    problemas.push(`Resolução (${analise.larguraPx}x${analise.alturaPx}) abaixo do mínimo (${limites.larguraMinimaPx}x${limites.alturaMinimaPx}).`)
  }

  if (problemas.length > 0) {
    return { status: 'REJECTED', problemas, detalhes: analise }
  }

  const deteccao = await detector.detectar(caminhoVideo)
  if (!deteccao.disponivel) {
    return {
      status: 'NOT_VERIFIED',
      problemas: ['Checagens técnicas (duração/resolução) passaram, mas nenhum detector de rosto real está disponível neste ambiente — não é possível confirmar "rosto detectável"/"identidade única" ainda.'],
      detalhes: analise,
    }
  }
  if (deteccao.rostosDetectados !== 1) {
    return { status: 'REJECTED', problemas: [`Detectado ${deteccao.rostosDetectados ?? 0} rosto(s) — é preciso exatamente 1 identidade principal.`], detalhes: analise }
  }

  return { status: 'TECHNICALLY_VALID', problemas: [], detalhes: analise }
}
