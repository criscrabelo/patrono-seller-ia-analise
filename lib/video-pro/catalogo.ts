/**
 * P2.42 — Catálogo dos modelos PROFISSIONAIS de vídeo (APIs oficiais). Fonte única de preço e política.
 *
 * Preço em USD por segundo GERADO, com fonte e data. Mudou o preço? Muda só aqui. `falhaCobrada`:
 *   false          = o fornecedor documenta que falha/moderação NÃO cobra (mesmo assim só se cancela a reserva com o
 *                    status oficial de falha em mãos — ver executor);
 *   true/'desconhecido' = conta como cobrada (conservador).
 * Só entram modos que PRESERVAM o produto real: animar foto real (primeiro quadro = foto), transformar/estender take
 * real, upscale. Texto→vídeo puro fica FORA: inventaria capa, marca e características.
 */
export type ModoDeGeracao = 'IMAGEM_PARA_VIDEO' | 'VIDEO_PARA_VIDEO' | 'UPSCALE'
export type ProvedorDeVideo = 'simulado-teste' | 'runway' | 'fal.ai' | 'google-veo' | 'luma'

export interface ModeloDeVideo {
  id: string
  provedor: ProvedorDeVideo
  rotulo: string
  modos: ModoDeGeracao[]
  usdPorSegundo: number
  /** Durações aceitas por chamada (s); ausente = qualquer duração até `maxSegundos`. */
  duracoesPermitidas?: number[]
  segundosMinimos?: number
  maxSegundos: number
  vertical916: boolean
  falhaCobrada: boolean | 'desconhecido'
  licencaComercial: 'SIM' | 'SIM_COM_CONDICOES' | 'NAO_VERIFICADO'
  /** Entrada usada para treinar o modelo? */
  treinaComEntrada: 'NAO' | 'SIM' | 'OPT_OUT' | 'NAO_VERIFICADO'
  marcaDagua: string | null
  fonte: string
  vistoEm: string
}

export const MODELOS: Record<string, ModeloDeVideo> = {
  mock: {
    id: 'mock', provedor: 'simulado-teste', rotulo: 'Simulado (TESTE, R$ 0)', modos: ['IMAGEM_PARA_VIDEO', 'VIDEO_PARA_VIDEO', 'UPSCALE'],
    usdPorSegundo: 0.05, duracoesPermitidas: [5, 10], maxSegundos: 10, vertical916: true, falhaCobrada: 'desconhecido',
    licencaComercial: 'SIM', treinaComEntrada: 'NAO', marcaDagua: null, fonte: 'interno (preço fictício igual ao de um modelo barato)', vistoEm: '2026-10-20',
  },
  // ── Reais (NENHUM tem adaptador neste protótipo; preços das páginas oficiais em 20/10/2026) ──
  'luma-ray32-reframe-720p': {
    // Reenquadra o take REAL 16:9 → 9:16 preservando o quadro original: o caso mais seguro para o produto.
    id: 'luma-ray32-reframe-720p', provedor: 'luma', rotulo: 'Luma Ray 3.2 — reenquadrar take real (720p)', modos: ['VIDEO_PARA_VIDEO'],
    usdPorSegundo: 0.12, duracoesPermitidas: [5, 10], maxSegundos: 10, vertical916: true, falhaCobrada: false,
    licencaComercial: 'NAO_VERIFICADO', treinaComEntrada: 'NAO_VERIFICADO', marcaDagua: null, fonte: 'https://docs.agents.lumalabs.ai/guides/pricing/', vistoEm: '2026-10-20',
  },
  'google-omni-flash-720p': {
    // Edita um take REAL de até 10 s; nível pago não treina com a entrada; SynthID em toda saída.
    id: 'google-omni-flash-720p', provedor: 'google-veo', rotulo: 'Gemini Omni Flash — editar take real (720p)', modos: ['VIDEO_PARA_VIDEO', 'IMAGEM_PARA_VIDEO'],
    usdPorSegundo: 0.11, maxSegundos: 10, segundosMinimos: 3, vertical916: true, falhaCobrada: false,
    licencaComercial: 'SIM', treinaComEntrada: 'NAO', marcaDagua: 'SynthID', fonte: 'https://ai.google.dev/gemini-api/docs/pricing', vistoEm: '2026-10-20',
  },
  'runway-gen4-turbo': {
    id: 'runway-gen4-turbo', provedor: 'runway', rotulo: 'Runway Gen-4 Turbo — animar foto real', modos: ['IMAGEM_PARA_VIDEO'],
    usdPorSegundo: 0.05, duracoesPermitidas: [5, 10], maxSegundos: 10, vertical916: true, falhaCobrada: true,
    // Termos: pode treinar com entradas/saídas (sem opt-out fora do Enterprise); app de API exibe "Powered by Runway".
    licencaComercial: 'SIM_COM_CONDICOES', treinaComEntrada: 'SIM', marcaDagua: null, fonte: 'https://docs.dev.runwayml.com/guides/pricing/', vistoEm: '2026-10-20',
  },
  'runway-aleph2': {
    id: 'runway-aleph2', provedor: 'runway', rotulo: 'Runway Aleph 2 — transformar take real (até 30 s)', modos: ['VIDEO_PARA_VIDEO'],
    usdPorSegundo: 0.28, segundosMinimos: 2, maxSegundos: 30, vertical916: true, falhaCobrada: true,
    licencaComercial: 'SIM_COM_CONDICOES', treinaComEntrada: 'SIM', marcaDagua: null, fonte: 'https://docs.dev.runwayml.com/guides/pricing/', vistoEm: '2026-10-20',
  },
  'fal-minimax-h3-turbo': {
    id: 'fal-minimax-h3-turbo', provedor: 'fal.ai', rotulo: 'MiniMax H3 Turbo (fal.ai) — animar foto real', modos: ['IMAGEM_PARA_VIDEO'],
    usdPorSegundo: 0.025, maxSegundos: 10, vertical916: true, falhaCobrada: 'desconhecido', // fal: 5xx não cobra; 422 pode cobrar
    licencaComercial: 'NAO_VERIFICADO', treinaComEntrada: 'NAO_VERIFICADO', marcaDagua: null, fonte: 'https://fal.ai/pricing', vistoEm: '2026-10-20',
  },
  'fal-kling25-turbo-pro': {
    id: 'fal-kling25-turbo-pro', provedor: 'fal.ai', rotulo: 'Kling 2.5 Turbo Pro (fal.ai) — animar foto real', modos: ['IMAGEM_PARA_VIDEO'],
    usdPorSegundo: 0.07, duracoesPermitidas: [5, 10], maxSegundos: 10, vertical916: true, falhaCobrada: 'desconhecido',
    licencaComercial: 'NAO_VERIFICADO', treinaComEntrada: 'NAO_VERIFICADO', marcaDagua: null, fonte: 'https://fal.ai/pricing', vistoEm: '2026-10-20',
  },
  'fal-topaz-precision-1080p': {
    // Upscale NÃO generativo (não redesenha a capa). Starlight/Astra são generativos: fora.
    id: 'fal-topaz-precision-1080p', provedor: 'fal.ai', rotulo: 'Topaz Precision (fal.ai) — upscale 1080p', modos: ['UPSCALE'],
    usdPorSegundo: 0.02, maxSegundos: 60, vertical916: true, falhaCobrada: 'desconhecido',
    licencaComercial: 'NAO_VERIFICADO', treinaComEntrada: 'NAO_VERIFICADO', marcaDagua: null, fonte: 'https://fal.ai/models/topaz/upscale/video/precision', vistoEm: '2026-10-20',
  },
}

export function modelo(id: string): ModeloDeVideo {
  const m = MODELOS[id]
  if (!m) throw new Error(`Modelo de vídeo desconhecido: ${id} (fora do catálogo = bloqueado).`)
  return m
}
