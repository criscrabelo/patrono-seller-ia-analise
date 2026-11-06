/**
 * TIKTOK_DIGITAL_TWIN_V1 (Rodada 7, regra 29) — primeiro preset de
 * conteúdo do Digital Twin para TikTok: 9:16, gancho inicial, fala curta,
 * legendas grandes, produto visível quando autorizado, CTA, sem watermark
 * de outra plataforma, Presenter Mode, AI disclosure, commercial
 * disclosure quando aplicável.
 */

import { gerarPacoteCriativoTikTokFirst, type FonteFatualProduto, type PacoteCriativoTikTokFirst } from './creative-factory'
import { validarPresenterMode, validarUnboxingStyle, AUTOPILOT_PRODUCT_EXPERIENCE_MODE, type ProductExperienceMode } from './digital-twin'
import { decidirAIContentDisclosure } from './ai-content-disclosure'
import { gerarLegendas, type CaptionBloco } from './captions'

export interface TikTokDigitalTwinV1Input {
  produto: FonteFatualProduto
  produtoVisivelNoAsset: boolean // MediaRightsGate já deve ter aprovado antes de chegar aqui
  usaAvatarSintetico: boolean
  usaVozClonada: boolean
  usaLipSync: boolean
  duracaoAudioSegundos?: number
}

export interface TikTokDigitalTwinV1Result {
  aprovado: boolean
  motivo: string
  pacote: PacoteCriativoTikTokFirst | null
  legendas: CaptionBloco[]
  aiDisclosureNecessario: boolean
  productExperienceMode: ProductExperienceMode
}

export function gerarPresetTikTokDigitalTwinV1(input: TikTokDigitalTwinV1Input): TikTokDigitalTwinV1Result {
  const pacote = gerarPacoteCriativoTikTokFirst(input.produto)

  // Presenter Mode: nenhum hook/caption pode simular depoimento pessoal.
  for (const texto of [...pacote.hooks, pacote.caption]) {
    const validacao = validarPresenterMode(texto)
    if (!validacao.valido) {
      return {
        aprovado: false,
        motivo: validacao.motivo,
        pacote: null,
        legendas: [],
        aiDisclosureNecessario: false,
        productExperienceMode: AUTOPILOT_PRODUCT_EXPERIENCE_MODE,
      }
    }
  }

  // Nunca finge posse física do produto — o Autopilot sempre usa VIRTUAL_PRESENTATION.
  const unboxing = validarUnboxingStyle({ mode: AUTOPILOT_PRODUCT_EXPERIENCE_MODE, afirmaRecebimentoFisicoReal: false })
  if (!unboxing.permitido) {
    return { aprovado: false, motivo: unboxing.motivo, pacote: null, legendas: [], aiDisclosureNecessario: false, productExperienceMode: AUTOPILOT_PRODUCT_EXPERIENCE_MODE }
  }

  const aiDisclosure = decidirAIContentDisclosure({
    usaAvatarSintetico: input.usaAvatarSintetico,
    usaVozClonada: input.usaVozClonada,
    usaLipSync: input.usaLipSync,
  })

  const legendas = gerarLegendas(pacote.caption, input.duracaoAudioSegundos)

  return {
    aprovado: true,
    motivo: 'Preset TIKTOK_DIGITAL_TWIN_V1 gerado com sucesso.',
    pacote,
    legendas,
    aiDisclosureNecessario: aiDisclosure.necessario,
    productExperienceMode: AUTOPILOT_PRODUCT_EXPERIENCE_MODE,
  }
}
