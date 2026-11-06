/**
 * Classificação real do computador da proprietária (Rodada 9, regra 7) —
 * SEMPRE derivada do diagnóstico real (`diagnose-digital-twin-worker.ps1`
 * no Windows, ou `detectarCapacidadesRuntime()`/rede neste servidor),
 * nunca de uma suposição. A classificação decide o que o Autopilot pode
 * tentar automaticamente — nunca o contrário.
 */

import type { RuntimeClass } from './digital-twin-runtime'

export const MACHINE_CLASSIFICATIONS = ['FULL_DIGITAL_TWIN', 'VOICE_AND_LIPSYNC', 'VOICE_ONLY', 'MOTION_GRAPHICS_ONLY', 'UNAVAILABLE'] as const
export type MachineClassification = (typeof MACHINE_CLASSIFICATIONS)[number]

export interface DiagnosticoMaquina {
  runtimeClasse: RuntimeClass
  pythonDisponivel: boolean
  ffmpegDisponivel: boolean
  discoSuficiente: boolean // espaço livre acima do mínimo prático
  huggingFaceAcessivel: boolean
  supabaseAcessivel: boolean
  patronoAcessivel: boolean
}

/**
 * FULL_DIGITAL_TWIN: GPU pronta (VRAM suficiente) + tudo mais disponível
 * — voz e lip-sync com qualidade plena.
 * VOICE_AND_LIPSYNC: GPU existe mas limitada (VRAM abaixo do ideal) —
 * lip-sync ainda tentável, só potencialmente mais lento/qualidade menor.
 * VOICE_ONLY: sem GPU utilizável, mas Chatterbox roda (CPU) e há rede —
 * só voz clonada, sem avatar sincronizado.
 * MOTION_GRAPHICS_ONLY: Python/rede indisponíveis para o Chatterbox, mas
 * o essencial (FFmpeg + disco) funciona — fallback sem voz clonada.
 * UNAVAILABLE: nem o fallback básico tem o que precisa.
 */
export function classificarMaquina(d: DiagnosticoMaquina): MachineClassification {
  const redeOk = d.huggingFaceAcessivel && d.supabaseAcessivel && d.patronoAcessivel
  const vozViavel = d.pythonDisponivel && redeOk

  if (vozViavel && d.runtimeClasse === 'GPU_READY') return 'FULL_DIGITAL_TWIN'
  if (vozViavel && d.runtimeClasse === 'GPU_LIMITED') return 'VOICE_AND_LIPSYNC'
  if (vozViavel) return 'VOICE_ONLY'
  if (d.ffmpegDisponivel && d.discoSuficiente) return 'MOTION_GRAPHICS_ONLY'
  return 'UNAVAILABLE'
}

const ROTULOS: Record<MachineClassification, string> = {
  FULL_DIGITAL_TWIN: 'Pronto para avatar completo (voz + lip-sync)',
  VOICE_AND_LIPSYNC: 'Voz e sincronização labial disponíveis (GPU limitada)',
  VOICE_ONLY: 'Voz clonada disponível — sem avatar sincronizado',
  MOTION_GRAPHICS_ONLY: 'Modo leve (sem voz clonada, com motion graphics)',
  UNAVAILABLE: 'Ambiente insuficiente — apenas o essencial do Patrono continua funcionando',
}

export function rotuloClassificacaoMaquina(c: MachineClassification): string {
  return ROTULOS[c]
}
