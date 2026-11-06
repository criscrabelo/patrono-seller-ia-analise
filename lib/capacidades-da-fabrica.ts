/**
 * O que a Creative Factory REALMENTE produz hoje — autoridade única.
 *
 * ── POR QUE ESTE ARQUIVO EXISTE ─────────────────────────────────────────
 * Havia duas listas de formatos em dois módulos diferentes. `FORMATOS`, em
 * lib/plano-de-acao.ts, dizia o que o PLANO pode escolher. `FORMATOS_GRATUITOS`,
 * em lib/fabrica-de-conteudo.ts, dizia o que a FÁBRICA sabe montar. Elas
 * discordavam: o plano escolhia CARROSSEL e a fábrica não produz carrossel.
 * O resultado observado em 24/09 foi um plano marcado
 * PRONTO_PARA_GERAR_CONTEUDO com fila vazia — execução fantasma.
 *
 * A lista de quem PRODUZ é esta. O planejador pergunta, não repete.
 *
 * ── ESTE ARQUIVO É PURO E SEM DEPENDÊNCIA ───────────────────────────────
 * De propósito. lib/plano-de-acao.ts é determinístico e testável sem
 * Postgres; importar a fábrica inteira arrastaria prisma, worker de memória
 * e gate de custo para dentro do planejador. Aqui só existe a declaração.
 *
 * ── COMO ACRESCENTAR UM FORMATO ─────────────────────────────────────────
 * Escreva o caminho de geração na fábrica PRIMEIRO. Só depois mova o
 * formato de FORMATOS_NAO_PRODUZIDOS para ORDEM_DE_PRODUCAO. Inverter a
 * ordem recria exatamente o bug que este arquivo fecha.
 */

import { capacidadeRealDoAdapter } from './capacidade-real-do-adapter'

/**
 * Formatos que a fábrica monta, em ordem de preferência.
 *
 * A ordem é a do valor entregue: vídeo 9:16 narrado converte mais que
 * texto, então vem primeiro; texto é o piso que funciona sem capacidade
 * nenhuma e sem depender da mídia do produto.
 *
 * Cada entrada aponta para código que existe em `gerarConteudoDoJob`.
 * Nenhuma é aspiracional.
 */
export const ORDEM_DE_PRODUCAO = [
  'VIDEO_9X16_FFMPEG_NARRADO',
  'TEXTO_COM_LINK',
] as const
export type FormatoProduzido = (typeof ORDEM_DE_PRODUCAO)[number]

/**
 * Formatos reconhecidos pelo catálogo que a fábrica NÃO produz, e por quê.
 *
 * `VIDEO_DIGITAL_TWIN` merece nota: declarar a GPU disponível NÃO o torna
 * produzível. `avaliarCapacidade()` recusa qualquer formato fora de
 * `ORDEM_DE_PRODUCAO` antes mesmo de olhar capacidade, e não existe caminho
 * de geração para ele em `gerarConteudoDoJob`. Enquanto esse caminho não
 * for escrito, ele é tão não-produzível quanto o carrossel.
 */
export const FORMATOS_NAO_PRODUZIDOS: Record<string, string> = {
  VIDEO_IA_GERADO: 'Depende do fal.ai, que é pago. Bloqueado pelo CostSafetyGate.',
  VIDEO_DIGITAL_TWIN:
    'Não há caminho de geração na fábrica. Exigiria worker com GPU pareado E o código de render do avatar, que não existe. Declarar a GPU não basta.',
  CARROSSEL: 'O renderer monta imagem única e vídeo; carrossel ainda não tem caminho local de montagem.',
  IMAGEM_UNICA: 'Renderizável, mas depende de mídia autorizada do produto — entra quando o gate de direitos permitir.',
  VIDEO_PROPRIO:
    'Não é montado pela fábrica: é o vídeo que a própria dona grava e envia. Entra por lib/peca-com-midia-propria.ts, com registro de direito do arquivo.',
}

/** `true` só para o que a fábrica sabe montar agora. */
export function ehFormatoProduzivel(formato: string | null | undefined): formato is FormatoProduzido {
  return !!formato && (ORDEM_DE_PRODUCAO as readonly string[]).includes(formato)
}

/** Por que este formato não é produzido. `null` quando ele é produzido. */
export function motivoNaoProduzido(formato: string | null | undefined): string | null {
  if (ehFormatoProduzivel(formato)) return null
  if (!formato) return 'Nenhum formato indicado.'
  return FORMATOS_NAO_PRODUZIDOS[formato] ?? `Formato "${formato}" não está no catálogo da fábrica.`
}

/**
 * Posição do formato na ordem de produção. Não produzido vai para o fim.
 *
 * É o que faz o planejador percorrer primeiro o que dá para fazer, sem
 * precisar conhecer a lista — ele só ordena por este número.
 */
export function posicaoNaProducao(formato: string): number {
  const i = (ORDEM_DE_PRODUCAO as readonly string[]).indexOf(formato)
  return i === -1 ? Number.MAX_SAFE_INTEGER : i
}

/**
 * REGRA PERMANENTE.
 *
 * O plano nunca escolhe como execução automática um formato que a fábrica
 * não produz. Quando nenhum produzível é viável, o item vai para
 * AGUARDANDO_CAPACIDADE — e não para PRONTO_PARA_GERAR_CONTEUDO com fila
 * vazia, que é a execução fantasma.
 */
export const PLANO_SO_ESCOLHE_O_QUE_A_FABRICA_PRODUZ = {
  chave: 'formatos:autoridade-unica',
  autoridade: 'lib/capacidades-da-fabrica.ts',
  consultadoPor: ['lib/plano-de-acao.ts', 'lib/fabrica-de-conteudo.ts'],
  porque:
    'Duas listas divergentes produziram um plano que dizia "pronto" e uma fila vazia. Com uma autoridade só, a divergência deixa de ser possível.',
} as const

// ── P1.9.2: o que a fábrica entrega × o que o adapter real publica ──────

/**
 * A MÍDIA que cada formato produzido sai da fábrica carregando.
 *
 * `VIDEO_9X16_FFMPEG_NARRADO` é `null` de propósito, e é a verdade de hoje:
 * `gerarConteudoDoJob` monta a copy e devolve `assetUrl: null`. O único
 * render FFmpeg real (PRODUCT_PREVIEW, no worker do Digital Twin) grava uma
 * PRÉVIA PRIVADA, que não é `Conteudo.videoUrl` e não vai ao ar. Declarar
 * 'VIDEO' aqui faria o plano escolher um formato que termina sem vídeo — o
 * mesmo tipo de execução fantasma que este arquivo existe para impedir.
 *
 * Quando o render passar a gravar o vídeo na peça, com a cadeia de direitos
 * (lib/cadeia-de-direitos.ts), é esta linha — e só ela — que muda.
 */
export const MIDIA_ENTREGUE_PELA_FABRICA: Record<FormatoProduzido, 'VIDEO' | 'IMAGEM' | null> = {
  VIDEO_9X16_FFMPEG_NARRADO: null,
  TEXTO_COM_LINK: null,
}

/**
 * Formatos que ninguém da fábrica produz: a mídia vem da DONA. O plano pode
 * recomendá-los, mas nunca como GERAR_CONTEUDO — o que falta é o arquivo,
 * e só uma pessoa o fornece.
 */
export const FORMATOS_FORNECIDOS_PELA_DONA = ['VIDEO_PROPRIO'] as const

export function ehFormatoDaDona(formato: string | null | undefined): boolean {
  return !!formato && (FORMATOS_FORNECIDOS_PELA_DONA as readonly string[]).includes(formato)
}

export type MotivoDeFormatoInutil = 'FORMATO_NAO_PUBLICAVEL_PELO_ADAPTER' | 'FABRICA_NAO_ENTREGA_MIDIA'

/**
 * Gerar este formato para este canal resulta em algo que o adapter REAL
 * publicaria?
 *
 * Uma pergunta, uma resposta, consultada pelo planner e pela fábrica. A
 * lista do adapter vem de lib/capacidade-real-do-adapter.ts — a mesma que o
 * preflight e o próprio adapter leem. Nada é duplicado aqui: só se cruza o
 * que o adapter exige com o que a fábrica entrega.
 *
 * Canal sem adapter real não é julgado: não há publicação real possível
 * por ele, e quem bloqueia é ADAPTER_NAO_IMPLEMENTADO.
 */
export function avaliarFormatoParaOCanal(
  canal: string,
  formato: string | null | undefined
): { util: boolean; motivo: MotivoDeFormatoInutil | null; explicacao: string | null } {
  const real = capacidadeRealDoAdapter(canal)
  if (!real) return { util: true, motivo: null, explicacao: null }

  if (!formato || !real.formatosPublicaveis.includes(formato)) {
    return {
      util: false,
      motivo: 'FORMATO_NAO_PUBLICAVEL_PELO_ADAPTER',
      explicacao: `O adapter de ${real.canal} não publica "${formato ?? 'sem formato'}". ${real.descricao}`,
    }
  }
  if (real.midiaObrigatoria && ehFormatoProduzivel(formato)) {
    const entregue = MIDIA_ENTREGUE_PELA_FABRICA[formato]
    if (entregue !== real.midiaObrigatoria) {
      return {
        util: false,
        motivo: 'FABRICA_NAO_ENTREGA_MIDIA',
        explicacao: `${real.canal} exige ${real.midiaObrigatoria === 'VIDEO' ? 'vídeo' : 'imagem'} e a fábrica, em "${formato}", entrega ${entregue ? entregue.toLowerCase() : 'só a copy'}.`,
      }
    }
  }
  return { util: true, motivo: null, explicacao: null }
}
