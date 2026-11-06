/**
 * Direitos de mídia de um Produto (Rodada 10) — resolvidos a partir do que o
 * cadastro JÁ guarda (`Produto.origemConteudo`), sem coluna nova e sem
 * migration.
 *
 * `mediaRightsGate()` (lib/media-rights.ts) sempre existiu como função pura,
 * mas nada no banco dizia qual a policy da mídia de um produto: na prática
 * ninguém conseguia chamar o portão com um produto real. Este módulo é a
 * ponte que faltava.
 *
 * A regra segue a mesma filosofia do resto do projeto — **nunca assumir
 * autorização**. Só duas origens liberam derivar/compor em vídeo:
 *
 * - `Próprio`       — a mídia é da própria proprietária.
 * - `Gerado por IA` — gerado legitimamente por nós (entra em
 *                     `PRIORIDADE_FONTE_MIDIA` como `GERADA_LEGITIMAMENTE`).
 *
 * `Licenciado` e `De fornecedor` caem em `UNKNOWN` de propósito: a licença
 * pode até permitir, mas os termos não estão registrados em lugar nenhum do
 * sistema (o modelo `TermoJuridico` ainda não existe). Tratar como permitido
 * seria inventar uma autorização que ninguém conferiu. Quando o termo de
 * cessão for modelado, é aqui que ele entra.
 */

import { direitosDaPolicy, type MediaRightsRecord, type MediaUsagePolicy } from './media-rights'
import { hostDeTerceiro } from './evidencia-de-midia'

export interface ProdutoParaDireitos {
  id: string
  nome: string
  origemConteudo: string
  imagens: string[]
  /**
   * `Produto.origemDados` (Rodada 11): de onde o REGISTRO veio — `MANUAL`
   * quando a proprietária cadastrou, `TIKTOK_SHOWCASE` quando foi importado
   * da vitrine. Ausente equivale a `MANUAL`, preservando o comportamento de
   * todo produto que já existia antes desta rodada.
   */
  origemDados?: string
}

/**
 * Origens de DADOS cuja mídia não pode ser transformada sem verificação.
 *
 * Sincronizar produto e adquirir direito sobre a mídia são coisas
 * separadas — e é justamente aqui que a diferença é aplicada. Uma imagem
 * que chega pela API oficial da vitrine é do vendedor ou da plataforma, não
 * da proprietária: recebê-la autoriza EXIBIR no Patrono, nunca compor um
 * vídeo derivado. Tratar o recebimento como licença seria inventar uma
 * autorização que ninguém concedeu.
 *
 * `UNKNOWN` já é o mais restritivo em `mediaRightsGate()`: permite exibir e
 * bloqueia transformar/derivar/reusar. Quando os termos do TikTok Shop forem
 * lidos e confirmados, é esta linha — e só ela — que muda.
 */
const ORIGENS_DE_DADOS_SEM_DIREITO_VERIFICADO: Record<string, MediaUsagePolicy> = {
  tiktok_showcase: 'UNKNOWN',
}

/** Compara origem sem depender de acento/caixa — o cadastro aceita texto livre. */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
}

const POLICY_POR_ORIGEM: Record<string, MediaUsagePolicy> = {
  proprio: 'DERIVATIVE_ALLOWED',
  'gerado por ia': 'DERIVATIVE_ALLOWED',
  licenciado: 'UNKNOWN',
  'de fornecedor': 'UNKNOWN',
}

/**
 * Identificador do asset para o registro de direitos. Sem imagem cadastrada,
 * o id aponta para o próprio produto: o portão continua decidindo sobre algo
 * concreto em vez de receber string vazia.
 */
function idDoAsset(produto: ProdutoParaDireitos): string {
  return produto.imagens[0] ?? `produto:${produto.id}:sem-midia`
}

export function resolverDireitosDoProduto(produto: ProdutoParaDireitos): MediaRightsRecord {
  const origemDados = normalizar(produto.origemDados || 'MANUAL')

  // A origem dos DADOS vence a origem declarada no cadastro. Um produto
  // importado da vitrine pode ter `origemConteudo: 'Próprio'` herdado do
  // formulário, mas a mídia continua sendo do vendedor/plataforma — deixar o
  // cadastro mandar aqui abriria exatamente o buraco que esta regra fecha.
  const policyDaOrigemDeDados = ORIGENS_DE_DADOS_SEM_DIREITO_VERIFICADO[origemDados]
  if (policyDaOrigemDeDados) {
    return direitosDaPolicy(policyDaOrigemDeDados, {
      assetId: idDoAsset(produto),
      source: `sincronizacao:${origemDados}`,
      authorizingSource: `Importado de ${produto.origemDados} — termos de uso da mídia ainda não verificados`,
      storageExpiresAt: null,
    })
  }

  const origem = normalizar(produto.origemConteudo || '')
  // Origem não reconhecida nunca vira "permitido por omissão".
  const policy = POLICY_POR_ORIGEM[origem] ?? 'UNKNOWN'

  // P1.9.1: declaração e evidência precisam concordar. "Próprio" ou "Gerado
  // por IA" com imagem no CDN de um marketplace é contradição — e o erro
  // estaria do lado perigoso, porque são as únicas origens que liberam
  // derivar. Na dúvida, vale a evidência.
  if (policy !== 'UNKNOWN') {
    const terceiro = produto.imagens.map(hostDeTerceiro).find((h): h is string => !!h)
    if (terceiro) {
      return direitosDaPolicy('UNKNOWN', {
        assetId: idDoAsset(produto),
        source: `cadastro-do-produto:${origem}`,
        authorizingSource: `Origem declarada "${produto.origemConteudo}" contradiz a mídia hospedada em ${terceiro} — direito não confirmado`,
        storageExpiresAt: null,
      })
    }
  }

  return direitosDaPolicy(policy, {
    assetId: idDoAsset(produto),
    source: `cadastro-do-produto:${origem || 'nao-informada'}`,
    authorizingSource: produto.origemConteudo || 'origem não informada no cadastro',
    storageExpiresAt: null,
  })
}

/**
 * O produto pode APARECER no vídeo? Exige mídia cadastrada E direito de
 * derivar. Sem imagem, o vídeo ainda é gerado — só não mostra o produto
 * (mesma decisão que `digital-twin-autopilot-integration.ts` já tomava para
 * o avatar), e o preset é avisado por `produtoVisivelNoAsset: false`.
 */
export function produtoPodeAparecerNoVideo(produto: ProdutoParaDireitos): {
  visivel: boolean
  motivo: string
  record: MediaRightsRecord
} {
  const record = resolverDireitosDoProduto(produto)

  if (produto.imagens.length === 0) {
    return {
      visivel: false,
      motivo: 'Produto sem imagem cadastrada — o vídeo usa fundo neutro e não exibe o produto.',
      record,
    }
  }

  const permitido = record.canDerive && record.canTransform
  return {
    visivel: permitido,
    motivo: permitido
      ? `Mídia do produto autorizada a compor vídeo (origem: ${produto.origemConteudo}).`
      : `Mídia do produto não autorizada a compor vídeo (origem: ${produto.origemConteudo}) — vídeo segue com fundo neutro.`,
    record,
  }
}
