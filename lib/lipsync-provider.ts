/**
 * Lip Sync (Rodada 7, atualizado na Rodada 9) — registro de motores
 * avaliados e a primeira implementação real de `LipSyncProvider`
 * (lib/digital-twin.ts).
 *
 * Decisão registrada (ver `DIGITAL-TWIN-MODEL-LICENSES.md` para a tabela
 * completa):
 *  - MuseTalk: código MIT, modelos com uso comercial informado pelo
 *    projeto — candidato PRINCIPAL desta rodada. Preferir a versão 1.5
 *    quando compatível com o ambiente (regra 12, Rodada 9); nunca usar um
 *    fork da comunidade como implementação principal.
 *    `verificarDisponibilidadeMuseTalk()` nunca assume presença — checa de
 *    verdade. As DEPENDÊNCIAS adicionais do MuseTalk (Whisper, ft-mse-vae,
 *    DWPose, S3FD, MMDetection, MMPose) têm licenças próprias e são
 *    revalidadas INDIVIDUALMENTE antes de qualquer ativação comercial —
 *    ver `MUSETALK_DEPENDENCY_LICENSES`/`podeAtivarMuseTalkComercialmente()`.
 *  - Wav2Lip (tradicional): BLOCKED_BY_LICENSE — os modelos publicados
 *    pelo projeto original são restritos a uso pessoal/acadêmico/pesquisa/
 *    não comercial. Como o Patrono é comercial, NUNCA integrado.
 *  - LivePortrait: BLOCKED_BY_LICENSE nesta rodada — cadeia de dependências
 *    (incluindo componentes de detecção facial) com restrições comerciais
 *    não totalmente esclarecidas. Só reavaliar se TODA a cadeia for
 *    confirmada compatível.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import type { LipSyncProvider } from './digital-twin'

const execFileAsync = promisify(execFile)

export const LIP_SYNC_ENGINE_STATUSES = ['AVAILABLE_CANDIDATE', 'BLOCKED_BY_LICENSE', 'NOT_VERIFIED'] as const
export type LipSyncEngineStatus = (typeof LIP_SYNC_ENGINE_STATUSES)[number]

export interface LipSyncEngineDecision {
  engine: string
  status: LipSyncEngineStatus
  motivo: string
}

/**
 * Registro FIXO das decisões já tomadas — nunca mudar sem reavaliar a
 * licença de verdade. `bloquearMotor()` abaixo impede qualquer código de
 * rotear para um motor `BLOCKED_BY_LICENSE`, mesmo por engano.
 */
export const LIP_SYNC_ENGINE_REGISTRY: LipSyncEngineDecision[] = [
  {
    engine: 'musetalk',
    status: 'AVAILABLE_CANDIDATE',
    motivo: 'Código MIT; projeto informa modelos disponíveis para uso comercial. Ainda assim, verificar as licenças das dependências efetivamente usadas antes de integrar em produção.',
  },
  {
    engine: 'wav2lip',
    status: 'BLOCKED_BY_LICENSE',
    motivo: 'Modelos publicados pelo projeto original restritos a uso pessoal/acadêmico/pesquisa/não comercial — incompatível com a finalidade comercial do Patrono.',
  },
  {
    engine: 'liveportrait',
    status: 'BLOCKED_BY_LICENSE',
    motivo: 'Cadeia de dependências (incluindo componentes de detecção facial) com restrições comerciais não totalmente esclarecidas nesta rodada — só reavaliar se toda a cadeia for confirmada compatível.',
  },
]

export function decisaoDoMotor(engine: string): LipSyncEngineDecision {
  return LIP_SYNC_ENGINE_REGISTRY.find((e) => e.engine === engine) ?? { engine, status: 'NOT_VERIFIED', motivo: 'Motor não avaliado ainda — nunca usar sem registrar a licença primeiro.' }
}

/** Nunca deixa um motor BLOCKED_BY_LICENSE ser usado, mesmo se alguém tentar chamar direto. */
export function bloquearMotor(engine: string): void {
  const decisao = decisaoDoMotor(engine)
  if (decisao.status !== 'AVAILABLE_CANDIDATE') {
    throw new Error(`Motor de lip-sync "${engine}" está ${decisao.status} — ${decisao.motivo}`)
  }
}

/** Versão preferida do MuseTalk (regra 12, Rodada 9) — só usada como sinal de preferência, nunca bloqueia sozinha. */
export const MUSETALK_VERSAO_PREFERIDA = '1.5'

export type MuseTalkAvailability =
  | { available: false; reason: string }
  | { available: true; pythonVersion: string; versaoDetectada: string | null; versaoPreferidaConfirmada: boolean }

/**
 * Nunca assume que o MuseTalk está instalado — tenta importar de verdade.
 * Também tenta ler `musetalk.__version__` (quando o pacote expõe isso) só
 * para informar se a versão 1.5 preferida está confirmada — a ausência
 * desse atributo NUNCA é tratada como motor indisponível, só como versão
 * "não determinada".
 */
export async function verificarDisponibilidadeMuseTalk(pythonBin: string = 'python3'): Promise<MuseTalkAvailability> {
  try {
    const { stdout } = await execFileAsync(pythonBin, [
      '-c',
      'import musetalk, sys; v = getattr(musetalk, "__version__", ""); print(sys.version); print(v)',
    ])
    const linhas = stdout.trim().split('\n')
    const pythonVersion = linhas[0] ?? ''
    const versaoDetectada = linhas[1]?.trim() || null
    return {
      available: true,
      pythonVersion,
      versaoDetectada,
      versaoPreferidaConfirmada: versaoDetectada != null && versaoDetectada.startsWith(MUSETALK_VERSAO_PREFERIDA),
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha desconhecida'
    return { available: false, reason: `MuseTalk não encontrado no ambiente (${msg}).` }
  }
}

// ── Licenças das dependências adicionais do MuseTalk (regra 13, Rodada 9) ──
// O código/pesos do MuseTalk em si são AVAILABLE_CANDIDATE (ver registro
// acima), mas a ativação comercial exige que CADA dependência adicional
// usada pelo pipeline real (detecção facial, extração de áudio, pose) seja
// revalidada individualmente. Nenhuma entrada aqui é assumida "liberada"
// por padrão — só um humano que efetivamente checou a licença de cada uma
// pode mudar o status para `CLEARED`.
export const MUSETALK_DEPENDENCY_LICENSE_STATUSES = ['CLEARED', 'NOT_VERIFIED', 'BLOCKED_BY_LICENSE'] as const
export type MuseTalkDependencyLicenseStatus = (typeof MUSETALK_DEPENDENCY_LICENSE_STATUSES)[number]

export interface MuseTalkDependencyLicense {
  dependencia: string
  status: MuseTalkDependencyLicenseStatus
  motivo: string
}

export const MUSETALK_DEPENDENCY_LICENSES: MuseTalkDependencyLicense[] = [
  { dependencia: 'whisper', status: 'NOT_VERIFIED', motivo: 'Usado pelo MuseTalk para extração de features de áudio — licença precisa ser revalidada antes de ativação comercial.' },
  { dependencia: 'ft-mse-vae', status: 'NOT_VERIFIED', motivo: 'Componente de codificação visual do MuseTalk — licença não revalidada nesta rodada.' },
  { dependencia: 'dwpose', status: 'NOT_VERIFIED', motivo: 'Estimativa de pose usada no pipeline — licença não revalidada nesta rodada.' },
  { dependencia: 's3fd', status: 'NOT_VERIFIED', motivo: 'Detector facial usado no pipeline — licença não revalidada nesta rodada.' },
  { dependencia: 'mmdetection', status: 'NOT_VERIFIED', motivo: 'Framework de detecção (OpenMMLab) — licença Apache 2.0 do framework em si é permissiva, mas modelos pré-treinados específicos usados precisam ser checados individualmente.' },
  { dependencia: 'mmpose', status: 'NOT_VERIFIED', motivo: 'Framework de pose (OpenMMLab) — mesma ressalva do mmdetection: checar os pesos pré-treinados específicos usados.' },
]

/**
 * Só permite considerar o MuseTalk pronto para ativação COMERCIAL quando o
 * motor em si está `AVAILABLE_CANDIDATE` E todas as dependências adicionais
 * estão `CLEARED`. Nunca aprova por omissão — uma dependência ainda
 * `NOT_VERIFIED` bloqueia exatamente como uma `BLOCKED_BY_LICENSE`.
 */
export function podeAtivarMuseTalkComercialmente(): { pode: boolean; pendencias: string[] } {
  const pendencias = MUSETALK_DEPENDENCY_LICENSES.filter((d) => d.status !== 'CLEARED').map((d) => `${d.dependencia}: ${d.status} — ${d.motivo}`)
  if (decisaoDoMotor('musetalk').status !== 'AVAILABLE_CANDIDATE') {
    pendencias.unshift('Motor MuseTalk não está AVAILABLE_CANDIDATE no registro principal.')
  }
  return { pode: pendencias.length === 0, pendencias }
}

export class MuseTalkLipSyncProvider implements LipSyncProvider {
  constructor(private pythonBin: string = 'python3') {}

  async sincronizar(params: { videoUrl: string; audioUrl: string }): Promise<{ videoUrl: string }> {
    bloquearMotor('musetalk') // defesa em profundidade — nunca depende só do caller ter checado antes
    const disponibilidade = await verificarDisponibilidadeMuseTalk(this.pythonBin)
    if (!disponibilidade.available) throw new Error(disponibilidade.reason)
    throw new Error('MuseTalk disponível no ambiente, mas a chamada real ainda não está implementada nesta rodada.')
  }
}
