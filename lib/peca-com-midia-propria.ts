/**
 * P1.9.1 — A primeira peça realmente publicável: vídeo da própria dona.
 *
 * A fábrica gera texto e vídeo FFmpeg a partir da mídia do PRODUTO. Nenhum
 * produto do catálogo tem mídia com direito comprovado: são fotos de
 * vendedor na Shopee. O caminho que fecha o primeiro ciclo sem depender
 * delas é o vídeo que a dona grava do produto que tem em mãos.
 *
 * Este módulo monta essa peça com tudo o que o preflight exige:
 *   - formato `VIDEO_PROPRIO`, que o adapter do Instagram publica;
 *   - registro de direito do ARQUIVO (`direito_da_midia`);
 *   - legenda do canal: sem claim, sem hashtag alheia, com CTA e disclosure;
 *   - preço só com verificação real;
 *   - link rastreado na estratégia do canal (bio, no Instagram).
 *
 * ── NÃO PUBLICA ─────────────────────────────────────────────────────────
 * O máximo que faz é gravar um `Conteudo`, e só com `gravar: true`.
 * `Publicacao` continua nascendo apenas na distribuição real.
 */

import { prisma } from './prisma'
import { capacidadeRealDoAdapter } from './capacidade-real-do-adapter'
import {
  avaliarMidiaParaPublicacao,
  TIPO_EVIDENCIA_DE_MIDIA,
  type EvidenciaDeMidia,
  type OrigemDeMidiaPublicavel,
} from './evidencia-de-midia'
import { avaliarPreco, dataDaVerificacaoDoPreco, type AvaliacaoDoPreco } from './preco-verificado'
import { nomeSemClaims, montarLegendaDoCanal, hashtagsParaOCanal, ctaDoCanal, pendenciasDeCopy } from './copy-por-canal'
import { textoDisclosure } from './creative-factory'
import {
  declaracoesFaltando,
  DECLARACOES_OBRIGATORIAS,
  type ValidacaoDoReel,
  type DeclaracaoDoReel,
} from './validacao-de-reel'

export const FORMATO_VIDEO_PROPRIO = 'VIDEO_PROPRIO'

export interface DeclaracaoDeMidia {
  origem: OrigemDeMidiaPublicavel
  /** Id do usuário que declara o direito. */
  declaradoPor: string
  /** O que é o arquivo: "vídeo que gravei do colchão inflando, 15 s". */
  descricao: string
  termoDeLicenca?: string | null
  geracaoId?: string | null
  /**
   * P1.9.2. O que só quem enviou pode afirmar: gravado por ela, sem música
   * de terceiros, sem terceiros nem crianças. Todas obrigatórias.
   */
  declaracoes?: Partial<Record<DeclaracaoDoReel, boolean>> | null
}

export interface ProdutoParaPecaPropria {
  id: string
  nome: string
  categoria: string
  preco: number | null
  status: string
  linkProduto: string | null
  sincronizadoEm: Date | null
}

export interface PreviaDaPeca {
  produto: string
  canal: string
  formato: string
  legenda: string
  cta: string
  disclosure: string
  ondeVaiOLink: string
  midia: { url: string; origem: OrigemDeMidiaPublicavel; motivo: string }
  preco: AvaliacaoDoPreco
  /** P1.9.2. O que o arquivo é, lido dele mesmo. */
  reel: ValidacaoDoReel['metadados']
}

export type MontagemDaPeca =
  | {
      ok: true
      previa: PreviaDaPeca
      /** Pronto para `prisma.conteudo.create`, sem workspaceId/userId. */
      dados: {
        produtoId: string
        legendaInstagram: string
        hashtags: string[]
        chamadaAcao: string
        videoUrl: string
        redeSocial: string
        status: string
        alertasCompliance: object[]
      }
    }
  | { ok: false; motivos: string[] }

/**
 * FUNÇÃO PURA. Monta a peça, ou diz exatamente por que não dá.
 *
 * Todas as checagens rodam, não só a primeira: quem envia o vídeo precisa
 * saber tudo o que falta de uma vez.
 */
export function montarPecaComMidiaPropria(params: {
  canal: string
  produto: ProdutoParaPecaPropria
  videoUrl: string
  declaracao: DeclaracaoDeMidia
  /**
   * P1.9.2. A validação do ARQUIVO (`validarReel`). Obrigatória: sem ela
   * não se sabe se o vídeo é vertical, se tem a duração certa, se é MP4.
   */
  reel: ValidacaoDoReel | null
  agora: Date
  env: Record<string, string | undefined>
}): MontagemDaPeca {
  const canal = (params.canal ?? '').trim().toLowerCase()
  const motivos: string[] = []

  if (!params.reel) motivos.push('O arquivo não foi validado como Reel.')
  else if (!params.reel.valido) motivos.push(...params.reel.problemas.map((p) => `Reel: ${p}`))

  const faltando = declaracoesFaltando(params.declaracao.declaracoes)
  if (faltando.length > 0) {
    motivos.push(`Faltam declarações de quem enviou: ${faltando.join(', ')}.`)
  }

  const cap = capacidadeRealDoAdapter(canal)
  if (!cap) motivos.push(`Não há adapter real para ${canal}.`)
  else if (!cap.formatosPublicaveis.includes(FORMATO_VIDEO_PROPRIO)) {
    motivos.push(`O adapter de ${canal} não publica ${FORMATO_VIDEO_PROPRIO}.`)
  }

  if (params.produto.status !== 'ativo') motivos.push(`Produto não está ativo (status: ${params.produto.status}).`)
  if (!(params.produto.linkProduto ?? '').trim()) {
    motivos.push('Produto sem link de afiliado: não haveria o que rastrear.')
  }

  const evidencia: EvidenciaDeMidia = {
    tipo: TIPO_EVIDENCIA_DE_MIDIA,
    severidade: 'verde',
    origem: params.declaracao.origem,
    assetUrl: (params.videoUrl ?? '').trim(),
    formato: FORMATO_VIDEO_PROPRIO,
    declaradoPor: (params.declaracao.declaradoPor ?? '').trim(),
    declaradoEm: params.agora.toISOString(),
    descricao: (params.declaracao.descricao ?? '').trim(),
    termoDeLicenca: params.declaracao.termoDeLicenca ?? null,
    geracaoId: params.declaracao.geracaoId ?? null,
    declaracoes: Object.fromEntries(
      DECLARACOES_OBRIGATORIAS.map((k) => [k, params.declaracao.declaracoes?.[k] === true])
    ),
    mensagem: `Direito do arquivo declarado como ${params.declaracao.origem} por ${params.declaracao.declaradoPor}.`,
  }
  if (!evidencia.descricao) motivos.push('A declaração precisa descrever o arquivo.')

  const midia = avaliarMidiaParaPublicacao({ assetUrl: evidencia.assetUrl, evidencia, env: params.env })
  if (!midia.autorizada) motivos.push(midia.motivo)

  let nome = params.produto.nome
  let removidos: string[] = []
  try {
    ;({ nome, removidos } = nomeSemClaims(params.produto.nome))
  } catch (e) {
    motivos.push(e instanceof Error ? e.message : String(e))
  }

  const preco = avaliarPreco({
    preco: params.produto.preco,
    verificadoEm: dataDaVerificacaoDoPreco(params.produto),
    agora: params.agora,
  })

  const disclosure = textoDisclosure('afiliado')
  const hashtags = hashtagsParaOCanal(
    [`#${params.produto.categoria.replace(/\s+/g, '').toLowerCase()}`],
    canal
  )
  const legenda = montarLegendaDoCanal({ canal, nome, precoTexto: preco.textoParaCopy, disclosure, hashtags })

  // A legenda que acabamos de escrever precisa passar na mesma régua que o
  // preflight aplica. Se não passar, o defeito é deste módulo.
  motivos.push(...pendenciasDeCopy({ canal, legenda }))

  if (motivos.length > 0) return { ok: false, motivos }

  const alertasCompliance: object[] = [
    evidencia,
    {
      tipo: 'proveniencia',
      severidade: 'verde',
      mensagem: `Peça montada a partir de vídeo enviado pela dona (${FORMATO_VIDEO_PROPRIO}, ${canal}) em ${params.agora.toISOString()}. Custo R$ 0,00.`,
      acaoRecomendada: 'REVISAR_ANTES_DE_PUBLICAR',
    },
  ]
  if (preco.alerta) {
    alertasCompliance.push({
      tipo: 'enganoso',
      severidade: 'amarelo',
      mensagem: preco.alerta,
      acaoRecomendada: 'VERIFICAR_PRECO_ANTES_DE_PUBLICAR',
    })
  }
  if (removidos.length > 0) {
    alertasCompliance.push({
      tipo: 'enganoso',
      severidade: 'amarelo',
      mensagem: `CLAIM_NAO_COMPROVADO: removido do título por falta de comprovação: ${removidos.join(', ')}.`,
      acaoRecomendada: 'REVISAR_SE_NECESSARIO',
    })
  }

  return {
    ok: true,
    previa: {
      produto: nome,
      canal,
      formato: FORMATO_VIDEO_PROPRIO,
      legenda,
      cta: ctaDoCanal(canal),
      disclosure,
      ondeVaiOLink: cap!.estrategiaDeLink,
      midia: { url: evidencia.assetUrl, origem: evidencia.origem, motivo: midia.motivo },
      preco,
      reel: params.reel?.metadados ?? null,
    },
    dados: {
      produtoId: params.produto.id,
      legendaInstagram: legenda,
      hashtags,
      chamadaAcao: ctaDoCanal(canal),
      videoUrl: evidencia.assetUrl,
      redeSocial: canal,
      status: 'roteiro_gerado',
      alertasCompliance,
    },
  }
}

/**
 * Lê o produto do workspace, monta a peça e, só com `gravar: true`, grava
 * o `Conteudo`. Nunca cria `Publicacao`, nunca chama canal.
 */
export async function prepararPecaComMidiaPropria(params: {
  workspaceId: string
  produtoId: string
  videoUrl: string
  declaracao: DeclaracaoDeMidia
  reel: ValidacaoDoReel | null
  canal?: string
  gravar?: boolean
  agora?: Date
  env?: Record<string, string | undefined>
}): Promise<{ montagem: MontagemDaPeca; contentId: string | null; reaproveitada: boolean }> {
  const produto = await prisma.produto.findFirst({
    where: { id: params.produtoId, workspaceId: params.workspaceId },
    select: {
      id: true, nome: true, categoria: true, preco: true, status: true,
      linkProduto: true, sincronizadoEm: true, userId: true,
    },
  })
  if (!produto) {
    return {
      montagem: { ok: false, motivos: ['Produto não encontrado neste workspace.'] },
      contentId: null,
      reaproveitada: false,
    }
  }

  const montagem = montarPecaComMidiaPropria({
    canal: params.canal ?? 'instagram',
    produto,
    videoUrl: params.videoUrl,
    declaracao: params.declaracao,
    reel: params.reel,
    agora: params.agora ?? new Date(),
    env: params.env ?? process.env,
  })
  if (!montagem.ok || !params.gravar) return { montagem, contentId: null, reaproveitada: false }

  // IDEMPOTÊNCIA: o mesmo vídeo, para o mesmo produto, é a mesma peça.
  // Rodar o script duas vezes não pode criar duas.
  const existente = await prisma.conteudo.findFirst({
    where: { workspaceId: params.workspaceId, produtoId: produto.id, videoUrl: montagem.dados.videoUrl },
    select: { id: true },
  })
  if (existente) return { montagem, contentId: existente.id, reaproveitada: true }

  const criado = await prisma.conteudo.create({
    data: {
      workspaceId: params.workspaceId,
      userId: produto.userId,
      ...montagem.dados,
    },
    select: { id: true },
  })
  return { montagem, contentId: criado.id, reaproveitada: false }
}
