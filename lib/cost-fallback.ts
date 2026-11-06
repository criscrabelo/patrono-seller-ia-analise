/**
 * Alternativas gratuitas para operações bloqueadas pelo CostSafetyGate
 * (Rodada 14, P0.1).
 *
 * AUTOMATION FIRST: bloquear gasto não pode virar trabalho manual. Quando uma
 * operação paga é negada, o Patrono procura sozinho a alternativa local que
 * JÁ EXISTE no projeto — e só quando não houver nenhuma a operação fica
 * pendente.
 *
 * AUTOMATION QUEUE: operação sem alternativa gratuita é registrada como
 * DÍVIDA DE AUTOMAÇÃO (`pendenciaDeAutomacao`). É a regra permanente: se algo
 * passa a depender de ação manual repetida da proprietária por falta de
 * fallback, isso não é "o jeito que funciona" — é item de fila para
 * automatizar depois com solução gratuita/open source.
 */

import type { ProvedorPago } from './cost-safety-gate'

export type TipoDeFallback = 'LOCAL_GRATUITO' | 'DETERMINISTICO' | 'SEM_ALTERNATIVA'

export interface Fallback {
  tipo: TipoDeFallback
  /** Módulo/função local que assume a operação. `null` quando não há. */
  alternativa: string | null
  explicacao: string
  /**
   * Quando `true`, a falta de alternativa faria a proprietária repetir
   * trabalho à mão — entra na fila de automação em vez de virar rotina.
   */
  pendenciaDeAutomacao: boolean
}

/**
 * Chave: `${provider}:${operacao}`. A operação importa: o Anthropic tem
 * substituto determinístico para hook/caption/CTA, mas NÃO tem para narração
 * livre — tratar os dois como a mesma coisa esconderia uma dívida real.
 */
const ALTERNATIVAS: Record<string, Fallback> = {
  'fal.ai:gerar-video': {
    tipo: 'LOCAL_GRATUITO',
    alternativa: 'renderer-ffmpeg.renderTikTokComNarracao',
    explicacao:
      'Vídeo 9:16 com narração renderizado localmente por FFmpeg, custo R$ 0,00 — caminho já validado nesta branch com voz real.',
    pendenciaDeAutomacao: false,
  },
  'fal.ai:compor-video': {
    tipo: 'LOCAL_GRATUITO',
    alternativa: 'concat-video.concatVideos',
    explicacao:
      'Concatenação dos clipes feita localmente com ffmpeg-static (concat demuxer, -c:v copy), custo R$ 0,00. A capacidade existe de fato em lib/concat-video.ts e é executada automaticamente pela rota de status de vídeo.',
    pendenciaDeAutomacao: false,
  },
  'fal.ai:adicionar-legenda': {
    tipo: 'SEM_ALTERNATIVA',
    alternativa: null,
    explicacao:
      'Nenhuma função local queima legenda em vídeo JÁ EXISTENTE — renderer-ffmpeg só monta vídeo a partir de imagem. O SRT continua sendo gerado localmente e sem custo (falai.montarSrt), mas a queima entra na fila de automação em vez de virar trabalho manual.',
    pendenciaDeAutomacao: true,
  },
  'anthropic:gerar-roteiro': {
    tipo: 'DETERMINISTICO',
    alternativa: 'digital-twin-tiktok-preset.gerarPresetTikTokDigitalTwinV1',
    explicacao:
      'Hook, caption, CTA, hashtags e disclosures saem de função pura sobre os dados do produto, sem IA paga.',
    pendenciaDeAutomacao: false,
  },
  'anthropic:gerar-video-seller': {
    tipo: 'DETERMINISTICO',
    alternativa: 'conteudo-gratuito.gerarConteudoGratuito',
    explicacao:
      'Pacote de conteúdo (roteiro, legenda, hashtags, CTA, texto de tela) montado por função pura sobre os dados do produto, sem IA paga.',
    pendenciaDeAutomacao: false,
  },
  'anthropic:analisar-compliance': {
    tipo: 'SEM_ALTERNATIVA',
    alternativa: null,
    explicacao:
      'Análise de compliance não tem equivalente determinístico confiável no projeto. Inventar um daria falsa segurança jurídica, o que é pior que não ter — por isso fica pendente na fila de automação.',
    pendenciaDeAutomacao: true,
  },
  'anthropic:gerar-narracao-livre': {
    tipo: 'SEM_ALTERNATIVA',
    alternativa: null,
    explicacao:
      'Narração livre não tem equivalente gratuito automático no projeto. Hoje dependeria de texto escrito à mão — por isso entra na fila de automação, não na rotina da proprietária.',
    pendenciaDeAutomacao: true,
  },
  // Resend e Z-API ficam DELIBERADAMENTE sem estimativa em
  // `CUSTO_ESTIMADO_BRL`: sem estimativa, `avaliarCusto` bloqueia mesmo com
  // as duas chaves ligadas. É o correto enquanto os chamadores não tiverem
  // workspace real — sugerir que podem ser liberados seria enganoso.
  'resend:enviar-email': {
    tipo: 'SEM_ALTERNATIVA',
    alternativa: null,
    explicacao:
      'Sem provedor de e-mail gratuito configurado. A operação fica PENDENTE por política de custo — nunca vira erro fatal nem trava o fluxo que a chamou.',
    pendenciaDeAutomacao: true,
  },
  'z-api:enviar-whatsapp': {
    tipo: 'SEM_ALTERNATIVA',
    alternativa: null,
    explicacao:
      'Sem canal de WhatsApp gratuito configurado. A operação fica PENDENTE por política de custo, sem erro fatal.',
    pendenciaDeAutomacao: true,
  },
}

/** Fallback padrão: não existe alternativa e isso é uma dívida, não um fim. */
const SEM_ALTERNATIVA_CONHECIDA: Fallback = {
  tipo: 'SEM_ALTERNATIVA',
  alternativa: null,
  explicacao:
    'Nenhuma alternativa gratuita mapeada para esta operação. Fica pendente por política de custo e entra na fila de automação.',
  pendenciaDeAutomacao: true,
}

export function escolherFallback(provider: ProvedorPago | string, operacao: string): Fallback {
  return ALTERNATIVAS[`${provider}:${operacao}`] ?? SEM_ALTERNATIVA_CONHECIDA
}

/** Lista as dívidas de automação conhecidas — alimenta a Automation Queue. */
export function listarPendenciasDeAutomacao(): Array<{ chave: string; explicacao: string }> {
  return Object.entries(ALTERNATIVAS)
    .filter(([, f]) => f.pendenciaDeAutomacao)
    .map(([chave, f]) => ({ chave, explicacao: f.explicacao }))
}
