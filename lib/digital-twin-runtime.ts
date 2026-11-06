/**
 * DigitalTwinRuntimeCapabilities (Rodada 7) — detecção REAL do que a
 * máquina onde o Patrono está rodando consegue fazer, antes de tentar
 * instalar/chamar qualquer modelo pesado (Chatterbox, MuseTalk). Nunca
 * assume que existe GPU — a detecção sempre confere de verdade (via
 * `os` nativo do Node e, quando disponível, `nvidia-smi`).
 */

import os from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { statfs } from 'fs/promises'

const execFileAsync = promisify(execFile)

export interface DigitalTwinRuntimeCapabilities {
  cpuCores: number
  totalRamGB: number
  freeRamGB: number
  gpuDetected: boolean
  gpuName: string | null
  vramGB: number | null
  cudaAvailable: boolean
  freeDiskGB: number | null
  verificadoEm: string
}

/** Tenta consultar `nvidia-smi` — se não existir/falhar, considera "sem GPU NVIDIA detectada" (nunca assume presença). */
async function detectarGpuNvidia(): Promise<{ nome: string | null; vramGB: number | null; cuda: boolean }> {
  try {
    const { stdout } = await execFileAsync('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'])
    const linha = stdout.trim().split('\n')[0]
    if (!linha) return { nome: null, vramGB: null, cuda: false }
    const [nome, memoriaMB] = linha.split(',').map((s) => s.trim())
    const vramGB = memoriaMB ? Math.round((parseInt(memoriaMB, 10) / 1024) * 10) / 10 : null
    return { nome: nome || null, vramGB, cuda: true }
  } catch {
    return { nome: null, vramGB: null, cuda: false }
  }
}

async function detectarDiscoLivreGB(caminho: string): Promise<number | null> {
  try {
    const info = await statfs(caminho)
    return Math.round(((info.bfree * info.bsize) / 1024 ** 3) * 10) / 10
  } catch {
    return null
  }
}

/** Detecção real, sem I/O de rede — segura para rodar a qualquer momento (ex.: tela de configuração do Digital Twin). */
export async function detectarCapacidadesRuntime(): Promise<DigitalTwinRuntimeCapabilities> {
  const gpu = await detectarGpuNvidia()
  const freeDiskGB = await detectarDiscoLivreGB(os.tmpdir())

  return {
    cpuCores: os.cpus().length,
    totalRamGB: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    freeRamGB: Math.round((os.freemem() / 1024 ** 3) * 10) / 10,
    gpuDetected: gpu.nome != null,
    gpuName: gpu.nome,
    vramGB: gpu.vramGB,
    cudaAvailable: gpu.cuda,
    freeDiskGB,
    verificadoEm: new Date().toISOString(),
  }
}

/** Requisitos mínimos considerados razoáveis para tentar rodar um motor de avatar/lip-sync local. Nunca hardcoded como garantia — só um corte de bom senso. */
export const REQUISITOS_MINIMOS_AVATAR_LOCAL = {
  vramGBMinima: 8,
  discoLivreGBMinimo: 10,
}

export function atendeRequisitosMinimosAvatar(caps: DigitalTwinRuntimeCapabilities): boolean {
  if (!caps.gpuDetected || !caps.cudaAvailable) return false
  if (caps.vramGB == null || caps.vramGB < REQUISITOS_MINIMOS_AVATAR_LOCAL.vramGBMinima) return false
  if (caps.freeDiskGB != null && caps.freeDiskGB < REQUISITOS_MINIMOS_AVATAR_LOCAL.discoLivreGBMinimo) return false
  return true
}

// ── Classificação amigável (Rodada 8, regra 13) ───────────────────────────
// Nunca mostrar CUDA/VRAM cru para a usuária comum — a tela traduz para
// "Pronto para gerar avatar" / "Modo leve disponível".

export const RUNTIME_CLASSES = ['GPU_READY', 'GPU_LIMITED', 'CPU_ONLY', 'UNSUPPORTED'] as const
export type RuntimeClass = (typeof RUNTIME_CLASSES)[number]

export function classificarRuntime(caps: DigitalTwinRuntimeCapabilities): RuntimeClass {
  if (caps.gpuDetected && caps.cudaAvailable && caps.vramGB != null && caps.vramGB >= REQUISITOS_MINIMOS_AVATAR_LOCAL.vramGBMinima) {
    return 'GPU_READY'
  }
  if (caps.gpuDetected && caps.cudaAvailable) {
    return 'GPU_LIMITED' // GPU existe, mas VRAM abaixo do recomendado
  }
  if (caps.cpuCores >= 2 && caps.totalRamGB >= 4) {
    return 'CPU_ONLY' // sem GPU, mas dá pra rodar o fallback (voz + motion graphics)
  }
  return 'UNSUPPORTED'
}

const ROTULOS_AMIGAVEIS: Record<RuntimeClass, string> = {
  GPU_READY: 'Pronto para gerar avatar',
  GPU_LIMITED: 'Modo leve disponível (GPU limitada)',
  CPU_ONLY: 'Modo leve disponível',
  UNSUPPORTED: 'Ambiente insuficiente — usando apenas recursos básicos',
}

export function rotuloAmigavelRuntime(classe: RuntimeClass): string {
  return ROTULOS_AMIGAVEIS[classe]
}
