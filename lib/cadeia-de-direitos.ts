/**
 * P1.9.2 — Cadeia de direitos de um arquivo derivado (FFmpeg).
 *
 * Um vídeo montado pelo FFmpeg não tem direito próprio. Ele é feito de
 * outras mídias — a imagem do produto, o vídeo da dona, a voz, um fundo —
 * e só pode valer o que TODAS elas valem. Esta é a regra:
 *
 *   mídia própria          → derivado autorizado
 *   uma fonte sem direito  → derivado bloqueado, inteiro
 *
 * Passar pelo FFmpeg não lava direito de imagem. Uma foto de vendedor da
 * Shopee com zoom, legenda e narração continua sendo a foto do vendedor.
 *
 * ── ONDE A CADEIA FICA ──────────────────────────────────────────────────
 * Em `Conteudo.alertasCompliance`, como um registro `direito_da_midia` de
 * origem `DERIVADO`, com cada fonte e o direito dela. Sem coluna nova, sem
 * migration: é o mesmo lugar onde o direito de um vídeo próprio já mora, e
 * o preflight o lê com a mesma função (`avaliarMidiaParaPublicacao`).
 *
 * Puro: o banco e o storage ficam com quem chama.
 */

import {
  TIPO_EVIDENCIA_DE_MIDIA,
  PREFIXO_FONTE_DO_PATRONO,
  emCustodiaPropria,
  hostDeTerceiro,
  avaliarMidiaParaPublicacao,
  avaliarFontesDaDerivacao,
  type EvidenciaDeMidia,
  type FonteDaDerivacao,
} from './evidencia-de-midia'
import { resolverDireitosDoProduto } from './media-rights-produto'

/**
 * A imagem do produto como FONTE, com o direito que o cadastro sustenta.
 *
 * Só vira evidência quando as três coisas batem: o cadastro declara
 * "Próprio", o direito do produto permite derivar (o que já recusa imagem
 * em CDN de marketplace) e o arquivo está no storage do projeto.
 *
 * "Gerado por IA" no cadastro NÃO basta: geração pelo Patrono se prova com
 * o id da geração, e o cadastro não o tem. Licenciado também não: sem termo
 * registrado. Nos dois casos a fonte fica sem evidência — e o derivado,
 * bloqueado.
 */
export function fonteDaImagemDoProduto(
  produto: {
    id: string
    nome: string
    origemConteudo: string
    imagens: string[]
    origemDados?: string
    userId: string
    updatedAt: Date
  },
  imagemUrl: string,
  env: Record<string, string | undefined>
): FonteDaDerivacao {
  const fonte: FonteDaDerivacao = { papel: 'IMAGEM_DO_PRODUTO', assetUrl: imagemUrl, evidencia: null }

  const direitos = resolverDireitosDoProduto(produto)
  const declaradoProprio =
    produto.origemConteudo.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase() === 'proprio'
  if (!declaradoProprio || !direitos.canDerive) return fonte
  if (hostDeTerceiro(imagemUrl) || !emCustodiaPropria(imagemUrl, env)) return fonte

  fonte.evidencia = {
    tipo: TIPO_EVIDENCIA_DE_MIDIA,
    severidade: 'verde',
    origem: 'PROPRIO',
    assetUrl: imagemUrl,
    formato: 'IMAGEM',
    // A declaração de origem é do cadastro, feito pela dona.
    declaradoPor: produto.userId,
    declaradoEm: produto.updatedAt.toISOString(),
    descricao: `Imagem do produto "${produto.nome}", origem declarada no cadastro.`,
    mensagem: 'Origem "Próprio" declarada no cadastro do produto, arquivo em custódia própria.',
  }
  return fonte
}

/** Uma fonte que o próprio Patrono sintetizou: fundo neutro, texto, voz gerada. */
export function fonteDoPatrono(papel: string, geracaoId: string, descricao: string): FonteDaDerivacao {
  const assetUrl = `${PREFIXO_FONTE_DO_PATRONO}${papel.toLowerCase()}:${geracaoId}`
  return {
    papel,
    assetUrl,
    evidencia: {
      tipo: TIPO_EVIDENCIA_DE_MIDIA,
      severidade: 'verde',
      origem: 'GERADO_PELO_PATRONO',
      assetUrl,
      formato: papel,
      declaradoPor: 'patrono',
      declaradoEm: new Date(0).toISOString(),
      descricao,
      geracaoId,
      mensagem: descricao,
    },
  }
}

export interface DerivacaoRegistrada {
  /** O registro a gravar na peça. Vai SEMPRE, autorizado ou não: é proveniência. */
  evidencia: EvidenciaDeMidia
  /** O derivado herdou direito de TODAS as fontes? */
  fontesAutorizadas: boolean
  /**
   * Além das fontes, o arquivo final pode ir ao ar? Exige custódia própria.
   * Uma prévia privada pode ter fontes legítimas e não ser publicável.
   */
  publicavel: boolean
  motivo: string
}

/**
 * Monta o registro de um arquivo derivado e diz se ele herdou direito.
 *
 * O registro é gravado mesmo quando o derivado sai bloqueado: a proveniência
 * é o que permite explicar, depois, POR QUE aquele vídeo não pode ir ao ar.
 */
export function registrarDerivacao(params: {
  /** O arquivo gerado. URL em custódia, ou um identificador interno. */
  assetUrl: string
  formato: string
  /** Job que gerou. */
  geracaoId: string
  fontes: FonteDaDerivacao[]
  agora: Date
  env: Record<string, string | undefined>
}): DerivacaoRegistrada {
  const evidencia: EvidenciaDeMidia = {
    tipo: TIPO_EVIDENCIA_DE_MIDIA,
    severidade: 'verde',
    origem: 'DERIVADO',
    assetUrl: params.assetUrl,
    formato: params.formato,
    declaradoPor: 'patrono',
    declaradoEm: params.agora.toISOString(),
    descricao: `Derivado por FFmpeg de ${params.fontes.length} fonte(s): ${params.fontes.map((f) => f.papel).join(', ')}.`,
    geracaoId: params.geracaoId,
    fontes: params.fontes,
    mensagem: 'Cadeia de direitos do arquivo derivado. O direito é o das fontes, nunca maior.',
  }

  // A régua é a do preflight: primeiro a cadeia, depois o arquivo final.
  const fontes = avaliarFontesDaDerivacao(params.fontes, params.env)
  const final = avaliarMidiaParaPublicacao({ assetUrl: params.assetUrl, evidencia, env: params.env })
  return {
    evidencia,
    fontesAutorizadas: fontes.autorizada,
    publicavel: fontes.autorizada && final.autorizada,
    motivo: fontes.autorizada ? final.motivo : fontes.motivo,
  }
}
