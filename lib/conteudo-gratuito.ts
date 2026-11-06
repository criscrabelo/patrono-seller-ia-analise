/**
 * Geração de conteúdo SEM IA paga (revisão do P0.1).
 *
 * Mapear o fallback não bastava: `escolherFallback()` devolvia o NOME da
 * alternativa, e nada a executava. Na prática, bloquear a Anthropic
 * significava não gerar conteúdo nenhum — o que empurraria a proprietária a
 * escrever tudo à mão, exatamente a rotina manual que a regra proíbe.
 *
 * Este módulo é o caminho gratuito de verdade: monta um `ConteudoGerado`
 * completo a partir do preset determinístico que já existe
 * (`gerarPresetTikTokDigitalTwinV1`), somado aos dados reais do produto.
 *
 * O que ele NÃO faz, e isso é deliberado:
 *  - não inventa benefício, ponto negativo, nota ou veredito. Campos que
 *    dependem de julgamento sobre o produto vêm do cadastro ou ficam vazios;
 *  - não escreve narração livre. É a única peça sem equivalente gratuito, e
 *    por isso está registrada na Automation Queue como dívida de automação,
 *    não como tarefa recorrente.
 *
 * Custo: R$ 0,00. Nenhuma chamada de rede.
 */

import { gerarPresetTikTokDigitalTwinV1 } from './digital-twin-tiktok-preset'
import { avaliarPreco } from './preco-verificado'
import { nomeSemClaims, montarLegendaDoCanal, hashtagsParaOCanal, ctaDoCanal } from './copy-por-canal'
import type { AlertaCompliance, ConteudoGerado } from '@/types'

export interface ProdutoParaConteudoGratuito {
  nome: string
  categoria: string
  preco?: number | null
  beneficios?: string[]
  pontosNegativos?: string[]
  /**
   * Data da última verificação REAL do preço (P1.9.1). Não é `updatedAt`:
   * editar o cadastro não verifica preço. Use `dataDaVerificacaoDoPreco()`.
   * Ausente = não verificado, e a legenda não afirma preço nem data.
   */
  precoVerificadoEm?: Date | null
  /** Relógio explícito. A data do preço nunca sai daqui. */
  agora?: Date
}

export interface ResultadoConteudoGratuito {
  conteudo: ConteudoGerado
  /** Campos que a versão gratuita deixa vazios, e por quê. */
  limitacoes: string[]
}

export function gerarConteudoGratuito(produto: ProdutoParaConteudoGratuito): ResultadoConteudoGratuito {
  // P1.9.1: o título do vendedor entra sem as alegações que ninguém
  // conferiu ("Homologado", "Original Lacrado").
  const { nome, removidos } = nomeSemClaims(produto.nome)
  const preco = avaliarPreco({
    preco: produto.preco ?? null,
    verificadoEm: produto.precoVerificadoEm ?? null,
    agora: produto.agora ?? new Date(),
  })

  const preset = gerarPresetTikTokDigitalTwinV1({
    produto: {
      nome,
      categoria: produto.categoria,
      // Sem verificação válida o preset não recebe preço: é ele quem decide
      // escrever "confira o preço atual", e assim não há data para inventar.
      preco: preco.status === 'VERIFICADO' ? produto.preco ?? null : null,
      precoConsultadoEm: preco.dataDaVerificacao,
      isAffiliate: true,
    },
    produtoVisivelNoAsset: false,
    usaAvatarSintetico: false,
    usaVozClonada: false,
    usaLipSync: false,
  })

  const limitacoes: string[] = []

  if (!preset.aprovado || !preset.pacote) {
    // O preset reprova quando o texto violaria Presenter Mode/unboxing. Nesse
    // caso não há conteúdo gratuito possível — e inventar um seria pior.
    throw new Error(`Conteúdo gratuito não pôde ser gerado: ${preset.motivo}`)
  }

  const pacote = preset.pacote

  // Uma legenda POR CANAL (P1.9.1). Antes era uma só, e o Instagram
  // recebia `#tiktokmademebuyit` e nenhuma CTA.
  const legendaDo = (canal: string) =>
    montarLegendaDoCanal({
      canal,
      nome,
      precoTexto: preco.textoParaCopy,
      disclosure: pacote.disclosure,
      hashtags: pacote.hashtags,
    })

  limitacoes.push('Narração livre não é gerada sem IA paga — use o roteiro do preset ou escreva a narração.')
  if (!produto.beneficios?.length) limitacoes.push('Benefícios não foram inferidos: vêm do cadastro do produto.')
  if (!produto.pontosNegativos?.length) limitacoes.push('Pontos negativos não foram inferidos: vêm do cadastro do produto.')

  // A mensagem começa pelo código estável (PRECO_NAO_VERIFICADO, ...), que
  // é o que a tela e os testes procuram.
  const alertasCompliance: AlertaCompliance[] = []
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

  const conteudo: ConteudoGerado = {
    // O "roteiro" gratuito é a sequência determinística hook → caption → CTA.
    roteiro: [pacote.hooks[0], pacote.caption, pacote.cta].join('\n\n'),
    legendaTiktok: legendaDo('tiktok'),
    legendaInstagram: legendaDo('instagram'),
    legendaYoutube: legendaDo('youtube'),
    legendaWhatsapp: `${pacote.caption}\n\n${pacote.cta}`,
    legendaFacebook: legendaDo('facebook'),
    legendaMarketplace: pacote.caption,
    // O campo é único; a legenda do Instagram é a que mais publica hoje,
    // então ele não pode carregar hashtag do TikTok.
    hashtags: hashtagsParaOCanal(pacote.hashtags, 'instagram'),
    textoTela: pacote.hooks[0],
    // Vazio de propósito: sem equivalente gratuito. Dívida de automação.
    narracao: '',
    trilhaSugerida: '',
    promptVideoIA: '',
    promptCurto: '',
    chamadaAcao: ctaDoCanal('instagram'),
    // Zero aqui significa "não avaliado", não "produto ruim". Nota é
    // julgamento sobre o produto, e a versão gratuita não julga.
    notaProduto: null,
    pontosPositivos: produto.beneficios ?? [],
    pontosNegativos: produto.pontosNegativos ?? [],
    veredito: 'Gerado sem IA paga — avaliação do produto não foi feita automaticamente.',
    alertasCompliance,
  }

  return { conteudo, limitacoes }
}
