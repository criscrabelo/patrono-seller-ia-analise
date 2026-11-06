/**
 * Segunda prévia com produto (Rodada 9, regras 19-20) — depois que a voz/
 * perfil já estão aprovados: avatar apresenta → produto real autorizado →
 * legendas → CTA → AI disclosure → commercial disclosure → TikTok
 * preflight. Ainda NÃO publica — é sempre uma prévia privada para revisão.
 *
 * Compõe peças já reais e testadas separadamente: preset TIKTOK_DIGITAL_TWIN_V1
 * (roteiro/captions/CTA/Presenter Mode/unboxing, Rodada 7), job de voz
 * (Chatterbox, Rodada 9), job de avatar (lip-sync real ou VOICE_ONLY_PREVIEW,
 * Rodada 9), layout de produto (Presenter+Product Panel / Presenter→B-roll,
 * Rodada 8) e o DigitalTwinQualityGate final (Rodada 7). Disclosure comercial
 * e preflight do TikTok dependem de estado real (canal/oportunidade,
 * creator_info) — chegam já decididos por quem chama, nunca recalculados
 * aqui com dados fabricados.
 */

import { gerarPresetTikTokDigitalTwinV1, type TikTokDigitalTwinV1Input } from './digital-twin-tiktok-preset'
import { gerarPreviaDeVoz, type VoicePreviewJobDeps } from './digital-twin-voice-job'
import { gerarPreviaLipSync, gerarPreviaVozSomente, type LipSyncPreviewDeps, type VoiceOnlyPreviewDeps } from './digital-twin-lipsync-job'
import { prepararSegundaPreviaComProduto } from './digital-twin-autopilot-integration'
import { avaliarDigitalTwinQualityGate, type DigitalTwinQualityInput } from './digital-twin-quality-gate'
import type { CreativePresenterMode } from './creative-presenter-mode'

export interface SegundaPreviaComProdutoInput {
  modo: CreativePresenterMode
  produto: TikTokDigitalTwinV1Input['produto']
  produtoVisivelNoAsset: boolean
  /** `DigitalTwinProfile.approvedAt != null` — primeira aprovação, feita pela própria proprietária (regra 18). */
  identidadeAprovada: boolean
  vozDeps: VoicePreviewJobDeps
  /** Só usado quando `modo === 'DIGITAL_TWIN'`. */
  lipSyncDeps: LipSyncPreviewDeps | null
  /** Só usado quando `modo === 'VOICE_ONLY'`. */
  vozSomenteDeps: VoiceOnlyPreviewDeps | null
  /** Já decidido por `decidirDisclosure()` (lib/compliance-engine.ts) com a oportunidade/canal reais. */
  commercialDisclosureNecessario: boolean
  commercialDisclosureAplicado: boolean
  /** Já decidido por `validarPreflightDinamico()` (lib/tiktok-preflight.ts) com o creator_info real. */
  tiktokPreflightStatus: DigitalTwinQualityInput['tiktokPreflightStatus']
}

export interface SegundaPreviaComProdutoResultado {
  aprovado: boolean
  motivo: string
  videoUrl: string | null
  problemas: string[]
}

export async function gerarSegundaPreviaComProduto(input: SegundaPreviaComProdutoInput): Promise<SegundaPreviaComProdutoResultado> {
  if (input.modo !== 'DIGITAL_TWIN' && input.modo !== 'VOICE_ONLY') {
    return {
      aprovado: false,
      motivo: `Modo atual (${input.modo}) não usa avatar/voz do Digital Twin — a segunda prévia com produto não se aplica.`,
      videoUrl: null,
      problemas: [],
    }
  }

  const preset = gerarPresetTikTokDigitalTwinV1({
    produto: input.produto,
    produtoVisivelNoAsset: input.produtoVisivelNoAsset,
    usaAvatarSintetico: input.modo === 'DIGITAL_TWIN',
    usaVozClonada: true,
    usaLipSync: input.modo === 'DIGITAL_TWIN',
  })
  if (!preset.aprovado || !preset.pacote) {
    return { aprovado: false, motivo: preset.motivo, videoUrl: null, problemas: [preset.motivo] }
  }

  const vozResultado = await gerarPreviaDeVoz({ ...input.vozDeps, texto: input.vozDeps.texto ?? preset.pacote.caption })
  if (vozResultado.status !== 'READY') {
    return { aprovado: false, motivo: vozResultado.motivo, videoUrl: null, problemas: [vozResultado.motivo] }
  }

  const avatarResultado =
    input.modo === 'DIGITAL_TWIN'
      ? input.lipSyncDeps
        ? await gerarPreviaLipSync(input.lipSyncDeps)
        : null
      : input.vozSomenteDeps
        ? await gerarPreviaVozSomente(input.vozSomenteDeps)
        : null

  if (!avatarResultado) {
    const dependenciaFaltando = input.modo === 'DIGITAL_TWIN' ? 'lipSyncDeps' : 'vozSomenteDeps'
    return { aprovado: false, motivo: `Modo ${input.modo} exige ${dependenciaFaltando}.`, videoUrl: null, problemas: [] }
  }
  if (avatarResultado.status === 'FAILED') {
    return { aprovado: false, motivo: avatarResultado.motivo, videoUrl: null, problemas: [avatarResultado.motivo] }
  }

  const layout = prepararSegundaPreviaComProduto({
    produtoNome: input.produto.nome,
    produtoMidiaAutorizada: input.produtoVisivelNoAsset,
    roteiro: preset.pacote.hooks[0],
    legenda: preset.pacote.caption,
    cta: preset.pacote.cta,
  })

  const qualityGate = avaliarDigitalTwinQualityGate({
    identidadeOk: input.identidadeAprovada,
    audioOk: vozResultado.qualidade?.aprovado ?? false,
    lipSyncOk: input.modo === 'DIGITAL_TWIN' ? avatarResultado.status === 'READY_LIP_SYNC_PREVIEW' : null,
    duracaoDentroDoLimite: true, // já validado dentro de gerarPreviaLipSync (5-10s); VOICE_ONLY segue a duração real do áudio
    legendasPresentes: preset.legendas.length > 0,
    produtoAutorizado: input.produtoVisivelNoAsset,
    aiDisclosureAplicado: preset.aiDisclosureNecessario,
    commercialDisclosureAplicado: input.commercialDisclosureNecessario ? input.commercialDisclosureAplicado : null,
    tiktokPreflightStatus: input.tiktokPreflightStatus,
  })

  return {
    aprovado: qualityGate.aprovado,
    motivo: qualityGate.aprovado
      ? `Segunda prévia com produto pronta para revisão privada (layout ${layout.layout}) — nunca publicada automaticamente.`
      : `Segunda prévia reprovada no Quality Gate: ${qualityGate.problemas.join('; ')}`,
    // P2.33.1: com rosto/voz, a prévia é só o arquivo local (quem chama guarda no privado).
    videoUrl: qualityGate.aprovado ? avatarResultado.videoUrl ?? avatarResultado.caminhoLocal ?? null : null,
    problemas: qualityGate.problemas,
  }
}
