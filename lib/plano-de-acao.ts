/**
 * Motor de Seleção e Plano de Ação (P1.2).
 *
 * A fila do P1.1 diz o que VALE. Este módulo diz o que FAZER: qual
 * oportunidade entra agora, em que canal, em que formato, e qual é a
 * próxima ação concreta.
 *
 * ── POR QUE ORDENAR POR SCORE NÃO BASTA ─────────────────────────────────
 * O score responde "quanto vale", e só. Uma oportunidade de score 90 com a
 * mídia bloqueada não rende nada hoje; uma de 82 pronta para gerar vídeo
 * rende. E repetir o mesmo produto cinco vezes seguidas porque ele lidera a
 * lista transforma a conta num repetidor — que é como se queima audiência.
 *
 * Então a PRIORIDADE OPERACIONAL é uma coisa diferente do score, e as duas
 * aparecem lado a lado, nunca fundidas num número só.
 *
 * ── CUSTO R$ 0,00 É RESTRIÇÃO, NÃO PREFERÊNCIA ──────────────────────────
 * Formato que depende de provider pago não é escolhido. Quando existe
 * alternativa local, ela é a escolha — não um plano B. Quando não existe, a
 * ação fica bloqueada e vira item de fila de automação.
 *
 * ── ESTE MÓDULO NÃO PUBLICA ─────────────────────────────────────────────
 * Ele seleciona, planeja e enfileira. Publicar depende do Revenue Autopilot,
 * que tem portão próprio e não é desta rodada.
 */

import { capacidadeDoCanal, type ChannelCapability } from './channel-registry'
import { escolherFallback } from './cost-fallback'
import {
  ehFormatoProduzivel,
  motivoNaoProduzido,
  posicaoNaProducao,
  avaliarFormatoParaOCanal,
  ehFormatoDaDona,
} from './capacidades-da-fabrica'
import { capacidadeRealDoAdapter } from './capacidade-real-do-adapter'
import { implementacaoDoCanal } from './distribuicao-decisao'

/**
 * P2.17.10 — O canal publica SOZINHO? A plataforma permitir não basta: onde a
 * publicação direta exige aprovação confirmada (TikTok: auditoria do Direct
 * Post), sem ela o caminho é rascunho. Mesma regra de `decidirDistribuicao`.
 */
function publicaSozinho(canal: string, cap: ChannelCapability, env: Record<string, string | undefined> = process.env): boolean {
  if (!cap.autoPublish) return false
  if (!implementacaoDoCanal(canal)?.publicarExigeAprovacaoConfirmada) return true
  return (env.TIKTOK_APP_AUDITADO ?? '').trim().toLowerCase() === 'true' && canal === 'tiktok'
}
import type { HumanActionReason } from './automation'
import type { OportunidadePontuada, NivelDeConfianca } from './motor-de-oportunidades'

// ── Estados do plano ────────────────────────────────────────────────────

export const ESTADOS_DO_PLANO = [
  /** Dá para gerar conteúdo agora, sem depender de ninguém. */
  'PRONTO_PARA_GERAR_CONTEUDO',
  /** O produto vale, mas a mídia dele não pode ser usada em vídeo. */
  'AGUARDANDO_MIDIA_AUTORIZADA',
  /** Nenhum canal conectado consegue a ação necessária. */
  'AGUARDANDO_CANAL',
  /** Falta dado que o provider ou a dona precisa fornecer. */
  'AGUARDANDO_DADO',
  /** Falta capacidade técnica (render, GPU) que não existe hoje. */
  'AGUARDANDO_CAPACIDADE',
  /** Indisponível — não entra em plano nenhum. */
  'NAO_ELEGIVEL',
] as const
export type EstadoDoPlano = (typeof ESTADOS_DO_PLANO)[number]

/** Só este estado autoriza seguir sozinho. */
export const ESTADO_QUE_EXECUTA: EstadoDoPlano = 'PRONTO_PARA_GERAR_CONTEUDO'

// ── Formatos: só o que o projeto REALMENTE faz ──────────────────────────

export interface CapacidadeDeFormato {
  formato: string
  /**
   * Capacidades do canal que servem para este formato — QUALQUER uma basta.
   *
   * É lista, e não campo único, porque o mesmo formato tem nome diferente
   * em cada canal: um vídeo 9:16 é `reel` no Instagram e `shortVideo` no
   * TikTok. Exigir só `reel` excluiria o TikTok de todo formato de vídeo,
   * que é o oposto da prioridade estratégica.
   */
  exigeDoCanal: Array<keyof Pick<ChannelCapability, 'reel' | 'shortVideo' | 'imagePost' | 'carousel' | 'story'>>
  /** Precisa de imagem do produto com direito de uso? */
  exigeMidiaAutorizada: boolean
  /** Provider pago de que depende. `null` = custo zero. */
  provedorPago: string | null
  /** Operação, para consultar o fallback gratuito. */
  operacao: string | null
  /** Capacidade técnica que precisa estar declarada disponível. */
  exigeCapacidade: string | null
  explicacao: string
}

/**
 * O catálogo de formatos. Cada um aponta para código que existe.
 *
 * Nenhuma entrada aqui é aspiracional: se o projeto não faz, não está na
 * lista. Prometer formato inexistente produziria um plano que nunca sai do
 * papel e, pior, esconderia a lacuna real.
 */
export const FORMATOS: CapacidadeDeFormato[] = [
  {
    formato: 'VIDEO_9X16_FFMPEG_NARRADO',
    exigeDoCanal: ['reel', 'shortVideo'],
    exigeMidiaAutorizada: true,
    provedorPago: null,
    operacao: null,
    exigeCapacidade: 'FFMPEG',
    explicacao: 'Vídeo 9:16 montado localmente por FFmpeg com narração — custo R$ 0,00.',
  },
  {
    formato: 'VIDEO_DIGITAL_TWIN',
    exigeDoCanal: ['reel', 'shortVideo'],
    exigeMidiaAutorizada: true,
    provedorPago: null,
    operacao: null,
    // Depende de GPU/worker pareado. Sem isso declarado, não é escolhido.
    exigeCapacidade: 'DIGITAL_TWIN_GPU',
    explicacao: 'Vídeo com avatar do Digital Twin — exige worker com GPU pareado.',
  },
  {
    formato: 'VIDEO_IA_GERADO',
    exigeDoCanal: ['reel', 'shortVideo'],
    exigeMidiaAutorizada: true,
    provedorPago: 'fal.ai',
    operacao: 'gerar-video',
    exigeCapacidade: null,
    explicacao: 'Vídeo gerado por IA no fal.ai — PAGO, só com autorização explícita.',
  },
  {
    formato: 'CARROSSEL',
    exigeDoCanal: ['carousel'],
    exigeMidiaAutorizada: true,
    provedorPago: null,
    operacao: null,
    exigeCapacidade: null,
    explicacao: 'Carrossel com as imagens autorizadas do produto — custo R$ 0,00.',
  },
  {
    formato: 'IMAGEM_UNICA',
    exigeDoCanal: ['imagePost'],
    exigeMidiaAutorizada: true,
    provedorPago: null,
    operacao: null,
    exigeCapacidade: null,
    explicacao: 'Post de imagem única com a mídia autorizada — custo R$ 0,00.',
  },
  {
    // P1.9.1. O vídeo que a PRÓPRIA dona gravou, publicado como Reel. Não
    // sai da fábrica: entra por `lib/peca-com-midia-propria.ts`, com o
    // registro de direito do arquivo. Por isso está em FORMATOS_NAO_PRODUZIDOS
    // e o plano nunca o escolhe sozinho.
    formato: 'VIDEO_PROPRIO',
    exigeDoCanal: ['reel', 'shortVideo'],
    exigeMidiaAutorizada: true,
    provedorPago: null,
    operacao: null,
    exigeCapacidade: null,
    explicacao: 'Vídeo gravado pela própria dona, com registro de direito do arquivo — custo R$ 0,00.',
  },
  {
    formato: 'TEXTO_COM_LINK',
    exigeDoCanal: ['imagePost', 'shortVideo', 'reel'],
    // Texto não usa a imagem do produto: serve justamente quando a mídia
    // está bloqueada.
    exigeMidiaAutorizada: false,
    provedorPago: null,
    operacao: null,
    exigeCapacidade: null,
    explicacao: 'Legenda e link, sem usar a mídia do produto — custo R$ 0,00.',
  },
]

/** Capacidades técnicas que o chamador declara existir HOJE. */
export interface CapacidadesTecnicas {
  /** FFmpeg local disponível. É o caminho gratuito padrão. */
  FFMPEG?: boolean
  /** Worker com GPU pareado para o Digital Twin. */
  DIGITAL_TWIN_GPU?: boolean
  /** Gasto pago explicitamente autorizado. Padrão: NUNCA. */
  PROVEDOR_PAGO_AUTORIZADO?: boolean
}

// ── Ações ───────────────────────────────────────────────────────────────

export const PROXIMAS_ACOES = [
  'GERAR_CONTEUDO',
  /** P1.5. Como GERAR_CONTEUDO, é execução — não dependência que falta. */
  'DISTRIBUIR_CONTEUDO',
  'SINCRONIZAR_MIDIA_AUTORIZADA',
  'CONECTAR_CANAL',
  /** P1.5.1. Renovar acesso vencido e trabalho de maquina, nao de pessoa. */
  'RENOVAR_TOKEN',
  'COMPLETAR_DADO_DO_PRODUTO',
  'HABILITAR_CAPACIDADE',
  'NENHUMA',
] as const
export type ProximaAcao = (typeof PROXIMAS_ACOES)[number]

export interface ItemDoPlano {
  workspaceId: string
  produtoId: string
  produtoNome: string
  categoria: string

  /** Do P1.1. Não é recalculado aqui. */
  scoreDaOportunidade: number
  /** Quanto vale FAZER isto agora. Diferente do score. */
  prioridadeOperacional: number
  posicao: number

  canalRecomendado: string | null
  formatoRecomendado: string | null
  estado: EstadoDoPlano
  proximaAcao: ProximaAcao
  /** `true` só quando dá para seguir sem depender de ninguém. */
  podeExecutarAutomaticamente: boolean
  dependenciaExterna: string | null

  confianca: NivelDeConfianca
  bloqueios: string[]
  motivo: string[]
  /** Custo em reais da ação recomendada. Sempre 0 nesta rodada. */
  custoEstimado: number
}

export interface ItemDaFilaDeAutomacao {
  chave: string
  produtoId: string
  dependencia: ProximaAcao
  explicacao: string
  /** `true` quando ignorar isso vira trabalho manual repetido. */
  repetivel: boolean
  /**
   * P1.9.2. Contexto que diferencia esta dependência de outra do mesmo
   * tipo. Entra na chave do job: mídia que a DONA precisa fornecer não é
   * a mesma pendência que sincronizar o catálogo do provider.
   */
  contexto?: Record<string, unknown>
  /** P1.9.2. Quando só uma pessoa destrava. */
  motivoHumano?: HumanActionReason | null
}

export interface PlanoDeAcao {
  workspaceId: string
  geradoEm: string
  itens: ItemDoPlano[]
  filaDeAutomacao: ItemDaFilaDeAutomacao[]
  /** Explica quem ficou de fora e por quê — nunca sumir em silêncio. */
  descartados: { produtoId: string; motivo: string }[]
  custoTotal: number
}

// ── Diversidade e saturação ─────────────────────────────────────────────

/** No máximo isto do MESMO produto num plano. */
export const MAXIMO_POR_PRODUTO = 1
/** No máximo isto da MESMA categoria num plano. */
export const MAXIMO_POR_CATEGORIA = 2
/** Vantagem de score que justifica romper o teto de categoria. */
export const VANTAGEM_MATERIAL = 25
/** Tamanho padrão do plano. */
export const TAMANHO_DO_PLANO = 5

/**
 * FUNÇÃO PURA. Prioridade operacional — quanto vale FAZER isto agora.
 *
 * Parte do score e aplica o que o score não sabe:
 *
 *   pronta para publicar          ×1,00   dá para executar hoje
 *   comercial mas bloqueada       ×0,60   vale, mas depende de alguém
 *   não elegível                  ×0,00   não entra
 *
 *   confiança ALTA                ×1,00
 *   MEDIA                         ×0,95
 *   BAIXA                         ×0,85
 *   SEM_HISTORICO_REAL            ×0,90   desconhecido pesa menos que ruim
 *
 *   saturação                     ×fator observado (já vem do P1.1)
 *
 * `SEM_HISTORICO_REAL` fica ACIMA de `BAIXA` de propósito: produto novo
 * merece a chance de provar; produto com histórico ruim e dados incompletos
 * já teve a dele.
 */
export function calcularPrioridadeOperacional(o: OportunidadePontuada): number {
  const porProntidao =
    o.classificacao === 'PRONTA_PARA_PUBLICACAO' ? 1 : o.classificacao === 'OPORTUNIDADE_COMERCIAL' ? 0.6 : 0
  const porConfianca: Record<NivelDeConfianca, number> = {
    ALTA: 1,
    MEDIA: 0.95,
    BAIXA: 0.85,
    SEM_HISTORICO_REAL: 0.9,
  }
  const bruto = o.score * porProntidao * porConfianca[o.confianca] * o.desempenho.fatorDeSaturacao
  return Math.round(bruto * 100) / 100
}

/**
 * FUNÇÃO PURA. Aplica diversidade e saturação sobre a lista já ordenada.
 *
 * DETERMINÍSTICA: mesma entrada, mesma saída, sempre. A exceção ao teto de
 * categoria existe, mas exige vantagem MATERIAL e fica registrada no motivo
 * — não é um "às vezes deixa passar".
 */
export function aplicarDiversidade(
  ordenados: OportunidadePontuada[],
  limite = TAMANHO_DO_PLANO
): { escolhidos: OportunidadePontuada[]; descartados: { produtoId: string; motivo: string }[] } {
  const escolhidos: OportunidadePontuada[] = []
  const descartados: { produtoId: string; motivo: string }[] = []
  const porProduto = new Map<string, number>()
  const porCategoria = new Map<string, number>()

  for (const o of ordenados) {
    if (escolhidos.length >= limite) {
      descartados.push({ produtoId: o.produtoId, motivo: `Fora do topo ${limite} deste plano.` })
      continue
    }

    const doProduto = porProduto.get(o.produtoId) ?? 0
    if (doProduto >= MAXIMO_POR_PRODUTO) {
      descartados.push({
        produtoId: o.produtoId,
        motivo: `Já há ${MAXIMO_POR_PRODUTO} item deste produto no plano — repetir vira repetidor.`,
      })
      continue
    }

    const daCategoria = porCategoria.get(o.categoria) ?? 0
    if (daCategoria >= MAXIMO_POR_CATEGORIA) {
      // EXCEÇÃO: vantagem material sobre o último escolhido da categoria.
      const piorDaCategoria = Math.min(
        ...escolhidos.filter((e) => e.categoria === o.categoria).map((e) => e.score)
      )
      if (o.score - piorDaCategoria < VANTAGEM_MATERIAL) {
        descartados.push({
          produtoId: o.produtoId,
          motivo: `Categoria "${o.categoria}" já tem ${MAXIMO_POR_CATEGORIA} itens e a vantagem (${o.score - piorDaCategoria}) não chega a ${VANTAGEM_MATERIAL}.`,
        })
        continue
      }
    }

    escolhidos.push(o)
    porProduto.set(o.produtoId, doProduto + 1)
    porCategoria.set(o.categoria, daCategoria + 1)
  }

  return { escolhidos, descartados }
}

// ── Canal e formato ─────────────────────────────────────────────────────

/**
 * Ordem de preferência estratégica entre canais.
 *
 * TikTok é prioridade nº 1 — QUANDO conseguir a ação necessária. Hoje o
 * registro declara `autoPublish: false` e `draftUpload: true`, então ele
 * entra como rascunho assistido, não como publicação automática. Forçar
 * TikTok onde a API ainda não permite produziria um plano que falha na hora
 * de executar.
 */
export const PREFERENCIA_DE_CANAL = ['tiktok', 'instagram', 'youtube', 'facebook', 'whatsapp']

/**
 * O catálogo reordenado pelo que a fábrica produz.
 *
 * Ordem estável: produzíveis primeiro, na ordem declarada pela fábrica;
 * o resto depois, na ordem original do catálogo. Eles continuam na lista
 * de propósito — é assim que o plano consegue explicar "existe este
 * formato e ele não sai hoje" em vez de simplesmente omiti-lo.
 */
export const FORMATOS_POR_PRODUCAO: CapacidadeDeFormato[] = [...FORMATOS].sort(
  (a, b) => posicaoNaProducao(a.formato) - posicaoNaProducao(b.formato)
)

export interface EscolhaDeCanal {
  canal: string | null
  formato: string | null
  bloqueios: string[]
  motivo: string[]
  custo: number
  dependenciaExterna: string | null
}

/**
 * FUNÇÃO PURA. Escolhe canal e formato para uma oportunidade.
 *
 * Percorre os canais na ordem estratégica e, dentro de cada um, os formatos
 * na ordem do catálogo — que já está do mais capaz e gratuito para o mais
 * simples. O primeiro par viável vence.
 */
export function escolherCanalEFormato(
  o: OportunidadePontuada,
  canaisConectados: string[],
  capacidades: CapacidadesTecnicas = {}
): EscolhaDeCanal {
  const bloqueios: string[] = []
  const motivo: string[] = []

  if (canaisConectados.length === 0) {
    return {
      canal: null,
      formato: null,
      bloqueios: ['SEM_CANAL_CONECTADO'],
      motivo: ['Nenhum canal conectado — o plano não tem por onde sair.'],
      custo: 0,
      dependenciaExterna: 'CONECTAR_CANAL',
    }
  }

  const midiaAutorizada = !o.motivosDeProntidao.includes('MIDIA_SEM_DIREITO')
  if (!midiaAutorizada) bloqueios.push('MIDIA_SEM_DIREITO')

  const ordem = [
    ...PREFERENCIA_DE_CANAL.filter((c) => canaisConectados.includes(c)),
    ...canaisConectados.filter((c) => !PREFERENCIA_DE_CANAL.includes(c)),
  ]

  for (const canal of ordem) {
    const cap = capacidadeDoCanal(canal)
    if (!cap) {
      bloqueios.push(`CANAL_SEM_CAPACIDADE_DECLARADA:${canal}`)
      continue
    }

    // A ordem é a da FÁBRICA, não a do catálogo. O catálogo descreve o que
    // existe no mundo; a fábrica diz o que sai hoje. Percorrer primeiro o
    // produzível é o que impede o plano de escolher carrossel e a fila
    // ficar vazia.
    const real = capacidadeRealDoAdapter(canal)
    for (const f of FORMATOS_POR_PRODUCAO) {
      if (!f.exigeDoCanal.some((c) => cap[c])) continue

      // P1.9.2. Canal com adapter REAL: só entra o que ele publicaria.
      // A autoridade é lib/capacidade-real-do-adapter.ts, a mesma do
      // preflight e do adapter. Sem isto o plano mandava gerar
      // TEXTO_COM_LINK para o Instagram — peça que nunca vai ao ar.
      const utilidade = avaliarFormatoParaOCanal(canal, f.formato)
      if (!utilidade.util) {
        bloqueios.push(`${utilidade.motivo}:${canal}:${f.formato}`)
        continue
      }

      // Mídia da DONA: a fábrica não produz, e o direito do produto não
      // importa — o arquivo é outro. O plano recomenda e espera por ela.
      if (ehFormatoDaDona(f.formato)) {
        if (!real) continue
        bloqueios.push('MIDIA_PROPRIA_AUSENTE')
        motivo.push(
          `${canal} só publica ${real.formatosPublicaveis.join(' ou ')}, e nada que a fábrica gera hoje entrega isso. ` +
            `O caminho é ${f.formato}: ${f.explicacao}`
        )
        return {
          canal,
          formato: f.formato,
          bloqueios,
          motivo,
          custo: 0,
          dependenciaExterna: 'MIDIA_DA_DONA',
        }
      }

      if (f.exigeMidiaAutorizada && !midiaAutorizada) continue

      // CUSTO: provider pago só com autorização explícita. Sem ela, tenta o
      // fallback gratuito; sem fallback, o formato é descartado.
      if (f.provedorPago && !capacidades.PROVEDOR_PAGO_AUTORIZADO) {
        const alternativa = f.operacao ? escolherFallback(f.provedorPago, f.operacao) : null
        if (alternativa?.alternativa) {
          motivo.push(
            `"${f.formato}" depende de ${f.provedorPago} (pago) — usando a alternativa gratuita ${alternativa.alternativa}.`
          )
        } else {
          bloqueios.push(`CUSTO_PAGO_BLOQUEADO:${f.formato}`)
        }
        continue
      }

      if (f.exigeCapacidade && !capacidades[f.exigeCapacidade as keyof CapacidadesTecnicas]) {
        bloqueios.push(`CAPACIDADE_AUSENTE:${f.exigeCapacidade}`)
        continue
      }

      // TRAVA FINAL: execução automática só em formato que a fábrica monta.
      // Vem DEPOIS dos gates de custo e capacidade de propósito — assim o
      // plano continua registrando CUSTO_PAGO_BLOQUEADO e CAPACIDADE_AUSENTE,
      // que explicam POR QUE aquele formato saiu. Esta trava responde outra
      // pergunta: mesmo que passasse, ninguém sabe montá-lo.
      //
      // Sem ela, o item virava PRONTO_PARA_GERAR_CONTEUDO e nenhum job
      // nascia — a execução fantasma observada em 24/09.
      if (!ehFormatoProduzivel(f.formato)) {
        bloqueios.push(`FORMATO_NAO_PRODUZIDO:${f.formato}`)
        motivo.push(`"${f.formato}" não é produzido pela fábrica. ${motivoNaoProduzido(f.formato)}`)
        continue
      }

      motivo.push(`Canal ${canal} aceita ${f.formato}. ${f.explicacao}`)
      const sozinho = publicaSozinho(canal, cap)
      if (!sozinho && cap.draftUpload) {
        motivo.push(
          `${canal} não permite publicação automática pela API — a ação prepara um rascunho para confirmação.`
        )
      }
      return {
        canal,
        formato: f.formato,
        bloqueios,
        motivo,
        custo: 0,
        dependenciaExterna: sozinho ? null : 'CONFIRMACAO_NO_CANAL',
      }
    }
  }

  return {
    canal: null,
    formato: null,
    bloqueios: bloqueios.length > 0 ? bloqueios : ['SEM_FORMATO_VIAVEL'],
    motivo: ['Nenhum par canal+formato viável hoje.'],
    custo: 0,
    dependenciaExterna: null,
  }
}

// ── Estado e ação ───────────────────────────────────────────────────────

/** FUNÇÃO PURA. Em que estado este item está, e o que fazer a seguir. */
export function derivarEstadoEAcao(
  o: OportunidadePontuada,
  escolha: EscolhaDeCanal
): { estado: EstadoDoPlano; proximaAcao: ProximaAcao } {
  if (o.classificacao === 'NAO_ELEGIVEL') {
    return { estado: 'NAO_ELEGIVEL', proximaAcao: 'NENHUMA' }
  }
  if (o.motivosDeProntidao.includes('SEM_DESTINO')) {
    return { estado: 'AGUARDANDO_DADO', proximaAcao: 'COMPLETAR_DADO_DO_PRODUTO' }
  }
  if (escolha.bloqueios.includes('SEM_CANAL_CONECTADO') || escolha.canal === null) {
    if (
      escolha.bloqueios.some(
        (b) => b.startsWith('CAPACIDADE_AUSENTE') || b.startsWith('FORMATO_NAO_PRODUZIDO')
      )
    ) {
      return { estado: 'AGUARDANDO_CAPACIDADE', proximaAcao: 'HABILITAR_CAPACIDADE' }
    }
    return { estado: 'AGUARDANDO_CANAL', proximaAcao: 'CONECTAR_CANAL' }
  }
  // P1.9.2. Falta o vídeo da dona: nada a gerar, uma mídia a receber.
  if (ehFormatoDaDona(escolha.formato)) {
    return { estado: 'AGUARDANDO_MIDIA_AUTORIZADA', proximaAcao: 'SINCRONIZAR_MIDIA_AUTORIZADA' }
  }
  if (escolha.bloqueios.includes('MIDIA_SEM_DIREITO') && escolha.formato !== 'TEXTO_COM_LINK') {
    return { estado: 'AGUARDANDO_MIDIA_AUTORIZADA', proximaAcao: 'SINCRONIZAR_MIDIA_AUTORIZADA' }
  }
  return { estado: 'PRONTO_PARA_GERAR_CONTEUDO', proximaAcao: 'GERAR_CONTEUDO' }
}

// ── O plano ─────────────────────────────────────────────────────────────

/**
 * FUNÇÃO PURA. Monta o plano a partir da fila do P1.1.
 *
 * Determinística de ponta a ponta: nenhuma chamada de rede, nenhum
 * `Date.now()` interno, nenhuma aleatoriedade. A mesma fila produz sempre o
 * mesmo plano — é o que permite comparar duas execuções e saber que a
 * diferença veio do dado, não do motor.
 *
 * NÃO PUBLICA, não gera conteúdo e não chama provider. Devolve o que fazer.
 */
export function montarPlanoDeAcao(params: {
  workspaceId: string
  fila: OportunidadePontuada[]
  canaisConectados: string[]
  capacidades?: CapacidadesTecnicas
  agora: Date
  limite?: number
}): PlanoDeAcao {
  const capacidades = params.capacidades ?? {}
  const limite = params.limite ?? TAMANHO_DO_PLANO

  // 1. Prioridade operacional — diferente do score, e calculada por cima dele.
  const comPrioridade = params.fila
    .filter((o) => o.workspaceId === params.workspaceId)
    .map((o) => ({ o, prioridade: calcularPrioridadeOperacional(o) }))

  // 2. Ordem: prioridade desc; empate pelo score; empate pelo id, para ser
  //    estável mesmo com dois itens idênticos.
  comPrioridade.sort(
    (a, b) =>
      b.prioridade - a.prioridade ||
      b.o.score - a.o.score ||
      a.o.produtoId.localeCompare(b.o.produtoId)
  )

  // 3. Diversidade e saturação.
  const { escolhidos, descartados } = aplicarDiversidade(
    comPrioridade.map((x) => x.o),
    limite
  )

  const prioridadePorProduto = new Map(comPrioridade.map((x) => [x.o.produtoId, x.prioridade]))
  const filaDeAutomacao: ItemDaFilaDeAutomacao[] = []
  const itens: ItemDoPlano[] = []

  escolhidos.forEach((o, i) => {
    const escolha = escolherCanalEFormato(o, params.canaisConectados, capacidades)
    const { estado, proximaAcao } = derivarEstadoEAcao(o, escolha)
    const podeExecutar = estado === ESTADO_QUE_EXECUTA && escolha.dependenciaExterna === null

    itens.push({
      workspaceId: params.workspaceId,
      produtoId: o.produtoId,
      produtoNome: o.produtoNome,
      categoria: o.categoria,
      scoreDaOportunidade: o.score,
      prioridadeOperacional: prioridadePorProduto.get(o.produtoId) ?? 0,
      posicao: i + 1,
      canalRecomendado: escolha.canal,
      formatoRecomendado: escolha.formato,
      estado,
      proximaAcao,
      podeExecutarAutomaticamente: podeExecutar,
      dependenciaExterna: escolha.dependenciaExterna,
      confianca: o.confianca,
      bloqueios: escolha.bloqueios,
      motivo: [...escolha.motivo, ...o.porqueDestaPosicao.slice(0, 2)],
      // Nesta rodada nenhuma ação recomendada custa dinheiro, por construção.
      custoEstimado: escolha.custo,
    })

    // AUTOMATION QUEUE: dependência repetível não pode virar rotina manual.
    if (proximaAcao !== 'NENHUMA' && proximaAcao !== 'GERAR_CONTEUDO') {
      const daDona = ehFormatoDaDona(escolha.formato)
      filaDeAutomacao.push({
        chave: `plano:${proximaAcao}:${o.produtoId}`,
        produtoId: o.produtoId,
        dependencia: proximaAcao,
        explicacao: escolha.motivo[0] ?? `Bloqueado por ${escolha.bloqueios.join(', ')}.`,
        repetivel: true,
        // P1.9.2. A mídia que falta é da dona: dependência humana, WAITING
        // desde o nascimento e sem tentativa — tentar não grava vídeo.
        ...(daDona
          ? {
              contexto: { origemDaMidia: 'DA_DONA', formato: escolha.formato, canal: escolha.canal },
              motivoHumano: 'MISSING_AUTHORIZED_MEDIA' as const,
            }
          : {}),
      })
    }
  })

  return {
    workspaceId: params.workspaceId,
    geradoEm: params.agora.toISOString(),
    itens,
    filaDeAutomacao,
    descartados,
    custoTotal: itens.reduce((s, i) => s + i.custoEstimado, 0),
  }
}

/**
 * REGRA PERMANENTE desta etapa.
 *
 * O plano diz o que fazer; ninguém executa sozinho. Ligar a execução exige
 * o Revenue Autopilot, que tem portão próprio.
 */
export const PLANO_NAO_EXECUTA = {
  chave: 'plano-de-acao:execucao-autonoma',
  estado: 'DELIBERADAMENTE_FORA_DE_ESCOPO',
  porque:
    'Planejar e executar são decisões diferentes. O plano prioriza e enfileira; publicar depende do Revenue Autopilot e do consentimento da dona.',
  desbloqueiaCom: 'REVENUE_AUTOPILOT',
} as const
