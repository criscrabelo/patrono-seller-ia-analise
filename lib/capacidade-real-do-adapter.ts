/**
 * P1.9.1 — O que cada adapter REAL publica. Autoridade única.
 *
 * ── O BUG QUE ESTE ARQUIVO FECHA ────────────────────────────────────────
 * Na P1.9 o preflight disse `pronto: true` para cinco peças `TEXTO_COM_LINK`
 * no Instagram. O adapter real só publica Reel e recusa peça sem vídeo — e a
 * Graph API não tem post só de texto. Ligar o flag teria produzido cinco
 * falhas previsíveis.
 *
 * A causa: havia duas respostas para "o Instagram aceita esta peça?".
 * `FORMATOS` + `ChannelRegistry` respondiam sobre a PLATAFORMA (aceita
 * imagem, logo aceita texto sobre imagem). O adapter respondia sobre o
 * CÓDIGO (só Reel, só com vídeo). O preflight perguntava ao primeiro.
 *
 * Agora as duas pontas leem DESTA declaração: o preflight para decidir
 * `pronto`, e o adapter para recusar. Elas não podem divergir porque não
 * há duas listas.
 *
 * ── PURO, SEM DEPENDÊNCIA ───────────────────────────────────────────────
 * Importado pela decisão (pura) e pelo adapter (com rede). Não pode
 * arrastar prisma nem `lib/instagram.ts`.
 */

/**
 * Onde o link rastreado fica para o público, por canal.
 *
 * - `BIO`: a legenda NÃO é clicável. O link vai na bio do perfil, e a
 *   legenda só aponta para ela.
 * - `LEGENDA`: o texto do post aceita link clicável.
 *
 * Ausente = não verificado. Nesse caso o link NÃO é colado na legenda: um
 * link que não abre, apresentado como se abrisse, é pior que nenhum.
 */
export type EstrategiaDeLink = 'BIO' | 'LEGENDA' | 'PRODUTO_MARCADO'

export const ESTRATEGIA_DE_LINK_POR_CANAL: Record<string, EstrategiaDeLink> = {
  // Legenda e comentário do Instagram não geram link clicável, e a API de
  // publicação de conteúdo não cria link sticker. O caminho oficial é a bio.
  instagram: 'BIO',
  // Legenda do TikTok também não é clicável.
  tiktok: 'BIO',
  // Texto de post de Página do Facebook aceita link clicável.
  facebook: 'LEGENDA',
}

export function estrategiaDeLinkDoCanal(canal: string): EstrategiaDeLink | null {
  return ESTRATEGIA_DE_LINK_POR_CANAL[(canal ?? '').trim().toLowerCase()] ?? null
}

/** A legenda pode carregar a URL? Só quando o canal torna o link clicável. */
export function urlVaiNaLegenda(canal: string): boolean {
  return estrategiaDeLinkDoCanal(canal) === 'LEGENDA'
}

export interface CapacidadeRealDoAdapter {
  canal: string
  /**
   * Formatos que o adapter ENVIA de verdade. Qualquer outro é recusado por
   * ele, e por isso o preflight também precisa recusar.
   */
  formatosPublicaveis: readonly string[]
  /** Mídia sem a qual o adapter não envia nada. `null` = publica sem mídia. */
  midiaObrigatoria: 'VIDEO' | 'IMAGEM' | null
  estrategiaDeLink: EstrategiaDeLink
  /** O que o adapter faz, em uma frase, para a tela e para o relatório. */
  descricao: string
}

/**
 * Um registro por adapter em `ADAPTADORES_DISPONIVEIS`. Um teste de
 * invariante garante que as duas listas tenham as mesmas chaves.
 *
 * Para acrescentar IMAGEM_UNICA no Instagram: escreva primeiro o caminho de
 * imagem no adapter (`criarContainerImagemFeed` já existe em
 * lib/instagram.ts e o adapter não o chama), e só depois inclua o formato
 * aqui. Inverter a ordem recria o bug da P1.9.
 */
export const CAPACIDADE_REAL_DO_ADAPTER: Record<string, CapacidadeRealDoAdapter> = {
  instagram: {
    canal: 'instagram',
    formatosPublicaveis: ['VIDEO_9X16_FFMPEG_NARRADO', 'VIDEO_PROPRIO'],
    midiaObrigatoria: 'VIDEO',
    estrategiaDeLink: 'BIO',
    descricao: 'Publica Reel pela Graph API oficial. Só vídeo: sem post de texto, imagem ou carrossel.',
  },
  // P2.17.10: lib/tiktok-adaptador.ts — vídeo por FILE_UPLOAD (rascunho ou Direct Post).
  tiktok: {
    canal: 'tiktok',
    formatosPublicaveis: ['VIDEO_9X16_FFMPEG_NARRADO', 'VIDEO_PROPRIO'],
    midiaObrigatoria: 'VIDEO',
    estrategiaDeLink: 'BIO',
    descricao: 'Envia vídeo pela Content Posting API oficial (rascunho na caixa de entrada; Direct Post só com app auditado). Produto do TikTok Shop é marcado pela titular no app.',
  },
}

export function capacidadeRealDoAdapter(canal: string): CapacidadeRealDoAdapter | null {
  return CAPACIDADE_REAL_DO_ADAPTER[(canal ?? '').trim().toLowerCase()] ?? null
}

export type BloqueioDoAdapter = 'FORMATO_INCOMPATIVEL_COM_ADAPTER' | 'MIDIA_OBRIGATORIA_AUSENTE'

export interface AvaliacaoDoAdapter {
  /** O adapter enviaria esta peça? */
  aceita: boolean
  /** Todos os motivos, não só o primeiro: texto sem vídeo falha nos dois. */
  bloqueios: BloqueioDoAdapter[]
  explicacao: string[]
}

/**
 * O adapter real deste canal enviaria esta peça?
 *
 * Canal sem adapter real não é avaliado aqui: quem bloqueia esse caso é
 * `ADAPTER_NAO_IMPLEMENTADO` / `ADAPTER_DESLIGADO`, com motivo próprio.
 *
 * Esta é a MESMA função que o adapter chama antes de abrir rede.
 */
export function avaliarPecaParaOAdapter(params: {
  canal: string
  formato: string | null
  assetUrl: string | null
}): AvaliacaoDoAdapter {
  const cap = capacidadeRealDoAdapter(params.canal)
  if (!cap) return { aceita: true, bloqueios: [], explicacao: [] }

  const bloqueios: BloqueioDoAdapter[] = []
  const explicacao: string[] = []

  if (!params.formato || !cap.formatosPublicaveis.includes(params.formato)) {
    bloqueios.push('FORMATO_INCOMPATIVEL_COM_ADAPTER')
    explicacao.push(
      `O adapter de ${cap.canal} não publica "${params.formato ?? 'sem formato'}". ` +
        `Publica: ${cap.formatosPublicaveis.join(', ')}. ${cap.descricao}`
    )
  }
  if (cap.midiaObrigatoria && !(params.assetUrl ?? '').trim()) {
    bloqueios.push('MIDIA_OBRIGATORIA_AUSENTE')
    explicacao.push(
      `${cap.canal} exige ${cap.midiaObrigatoria === 'VIDEO' ? 'vídeo' : 'imagem'} e a peça não tem mídia.`
    )
  }

  return { aceita: bloqueios.length === 0, bloqueios, explicacao }
}

/** REGRA PERMANENTE. */
export const PREFLIGHT_E_ADAPTER_LEEM_A_MESMA_LISTA = {
  chave: 'adapter:capacidade-real-unica',
  autoridade: 'lib/capacidade-real-do-adapter.ts',
  consultadoPor: ['lib/distribuicao-orquestrador.ts', 'lib/adaptadores-reais.ts'],
  porque:
    'Na P1.9 o preflight aprovou TEXTO_COM_LINK no Instagram e o adapter o recusaria. Com uma lista só, "pronto" passa a significar "o adapter enviaria".',
} as const
