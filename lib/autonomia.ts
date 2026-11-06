/**
 * P2.18.1 — REGRA PERMANENTE DE PRODUTO: "O Patrono foi criado para
 * executar; a titular, para aprovar." Manual = contingência temporária,
 * nunca desenho final.
 *
 * Este arquivo é o registro oficial de cada etapa do fluxo-alvo:
 *   descoberta → ranking → escolha → vitrine → amostra → acompanhamento →
 *   recebimento → conteúdo → vídeo → aprovação → publicação → marcação →
 *   métricas → venda → comissão → aprendizado (+ missões e agenda)
 *
 * Toda etapa que ainda depende da titular DIZ: por que está manual, qual API
 * oficial falta, qual aprovação externa falta, qual código falta e como será
 * eliminada. O teste (rodada95) recusa etapa manual sem esses campos e
 * recusa "manual" como estado final. FUNÇÕES PURAS, sem banco: a Torre lê
 * direto daqui.
 *
 * O papel da titular, quando tudo estiver liberado, fica limitado a: aprovar
 * ou rejeitar, pedir ajuste, fornecer mídia real, executar o que o TikTok
 * exigir dela e autorizar ações sensíveis/irreversíveis/financeiras.
 */

import { dataDeElegibilidadeBR, situacaoDaAffiliateApi } from './elegibilidade-tiktok-shop'
import type { IdDaCapacidade } from './capacidades-tiktok'

export type SituacaoDaEtapa =
  /** O Patrono faz sozinho. */
  | 'AUTOMATICA'
  /** O Patrono faz; a titular aprova (papel dela por regra, não trabalho operacional). */
  | 'AUTOMATICA_COM_APROVACAO'
  /** Hoje a titular faz; é contingência e tem plano de eliminação. */
  | 'CONTINGENCIA_MANUAL'

export type TipoDeBloqueio =
  | 'API_OFICIAL' // a API oficial não existe ou não está disponível no Brasil
  | 'APROVACAO_TIKTOK' // existe, mas depende de revisão/liberação do TikTok
  | 'CONFIGURACAO' // código pronto; falta chave, flag ou agendador
  | 'CODIGO' // falta código nosso
  | 'ELEGIBILIDADE' // P2.18.3: a empresa ainda não cumpre o requisito oficial (1 ano de registro)

export interface EtapaDaAutonomia {
  id: string
  etapa: string
  situacao: SituacaoDaEtapa
  /** O que roda hoje (automático ou a contingência). */
  hoje: string
  bloqueios: TipoDeBloqueio[]
  apiNecessaria: string | null
  aprovacaoExterna: string | null
  /** null = nenhum código nosso falta. */
  codigoFaltante: string | null
  /** Só nas etapas manuais: por que ainda é manual. */
  porqueManual: string | null
  /** Só nas etapas manuais: como a etapa deixa de ser manual. */
  comoEliminar: string | null
  /** O código oficial já existe (desligado até a liberação)? */
  codigoOficialPronto: boolean
  /** P2.18.3: depende da Affiliate Creator API (bloqueada por elegibilidade até a data-base). */
  dependeDaAffiliateApi: boolean
  /** P2.18.5: a capacidade do registro central que decide quem executa esta etapa. */
  capacidade: IdDaCapacidade | null
}

const DATA_BASE = dataDeElegibilidadeBR()
const APP_PARTNER = `Certificação da empresa no TikTok Shop Partner Center (exige 1 ano de registro: elegível a partir de ${DATA_BASE}) + autorização da conta de criadora (OAuth)`
const APP_DEVELOPERS = 'Revisão do app no TikTok for Developers (Login Kit + Content Posting)'

export const ETAPAS_DA_AUTONOMIA: readonly EtapaDaAutonomia[] = [
  {
    id: 'descoberta',
    etapa: 'Descoberta de produtos no TikTok Shop',
    situacao: 'CONTINGENCIA_MANUAL',
    hoje: 'Catálogo + "Mais vendidos" visto no app + "Informar produto" (fallback). A busca oficial roda sozinha todo dia assim que liberada.',
    bloqueios: ['ELEGIBILIDADE', 'APROVACAO_TIKTOK', 'CONFIGURACAO'],
    apiNecessaria: 'Affiliate Creator API — Search Open Collaboration Product',
    aprovacaoExterna: `${APP_PARTNER}; disponibilidade da Affiliate API no Brasil`,
    codigoFaltante: null,
    porqueManual: 'A Affiliate Creator API está bloqueada por elegibilidade da empresa (1 ano de registro); scraping e endpoint privado são proibidos. Até lá o Patrono ranqueia catálogo, "Mais vendidos" registrado e produtos informados.',
    comoEliminar: `A partir de ${DATA_BASE} (ou mudança oficial): certificação → chaves TIKTOK_SHOP_* → flag TIKTOK_SHOP_CATALOGO → conectar a conta → agendador. A coleta diária (05:00 UTC) já está pronta para trazer os produtos sozinha.`,
    codigoOficialPronto: true,
    dependeDaAffiliateApi: true,
    capacidade: 'TIKTOK_DISCOVERY',
  },
  {
    id: 'ranking',
    etapa: 'Ranking (vendas, comissão, conversão, sazonalidade, perfil, facilidade de vídeo)',
    situacao: 'AUTOMATICA',
    hoje: 'Motor de oportunidades + visões; o dado oficial vence o informado campo a campo.',
    bloqueios: [],
    apiNecessaria: null,
    aprovacaoExterna: null,
    codigoFaltante: null,
    porqueManual: null,
    comoEliminar: null,
    codigoOficialPronto: true,
    dependeDaAffiliateApi: false,
    capacidade: null,
  },
  {
    id: 'escolha',
    etapa: 'Escolha do produto',
    situacao: 'AUTOMATICA_COM_APROVACAO',
    hoje: 'O supervisor escolhe pelo ranking; a titular aprova na Central de Aprovações.',
    bloqueios: [],
    apiNecessaria: null,
    aprovacaoExterna: null,
    codigoFaltante: null,
    porqueManual: null,
    comoEliminar: null,
    codigoOficialPronto: true,
    dependeDaAffiliateApi: false,
    capacidade: null,
  },
  {
    id: 'vitrine',
    etapa: 'Adicionar à vitrine',
    situacao: 'CONTINGENCIA_MANUAL',
    hoje: 'O Gestor de Vitrine decide o que entra; a titular adiciona no app.',
    bloqueios: ['ELEGIBILIDADE', 'APROVACAO_TIKTOK', 'API_OFICIAL'],
    apiNecessaria: 'Affiliate Creator API — Add Showcase Products (origin=SHOWCASE)',
    aprovacaoExterna: `${APP_PARTNER}; confirmação do recurso no Brasil`,
    codigoFaltante: null,
    porqueManual: 'A escrita na vitrine só existe pela Affiliate API, bloqueada por elegibilidade da empresa. O Patrono decide o produto; a titular só adiciona no app (um toque na jornada).',
    comoEliminar: `A partir de ${DATA_BASE} (ou mudança oficial), com a API liberada: TIKTOK_SHOP_VITRINE_AUTOMATICA → a mesma ação da jornada passa a ser executada pela API (código pronto e desligado).`,
    codigoOficialPronto: true,
    dependeDaAffiliateApi: true,
    capacidade: 'TIKTOK_SHOWCASE_WRITE',
  },
  {
    id: 'amostra-pedido',
    etapa: 'Solicitar amostra',
    situacao: 'CONTINGENCIA_MANUAL',
    hoje: 'O Patrono indica quais pedir e por quê; a titular pede no app.',
    bloqueios: ['ELEGIBILIDADE', 'API_OFICIAL'],
    apiNecessaria: 'Endpoint oficial de solicitação de amostra para criadora (não encontrado na documentação pública)',
    aprovacaoExterna: 'Confirmação do Partner Manager (P2.17.34) de que existe e vale no Brasil',
    codigoFaltante: 'Cliente do endpoint, quando o contrato oficial for publicado',
    porqueManual: 'Não há API pública confirmada para pedir amostra (e a Affiliate API está bloqueada por elegibilidade). O Patrono decide se vale; a titular pede no app.',
    comoEliminar: 'Confirmado o endpoint, implementar o pedido com teto econômico e autorização da titular por regra (ação com custo de oportunidade).',
    codigoOficialPronto: false,
    dependeDaAffiliateApi: true,
    capacidade: 'TIKTOK_SAMPLE_REQUEST',
  },
  {
    id: 'amostra-acompanhamento',
    etapa: 'Acompanhar aprovação e envio da amostra',
    situacao: 'CONTINGENCIA_MANUAL',
    hoje: 'A titular toca o estado da amostra no Patrono quando o app muda.',
    bloqueios: ['ELEGIBILIDADE', 'API_OFICIAL', 'APROVACAO_TIKTOK'],
    apiNecessaria: 'Leitura oficial do status de amostras (Affiliate Creator API)',
    aprovacaoExterna: APP_PARTNER,
    codigoFaltante: 'Coletor do status, quando a leitura oficial for confirmada',
    porqueManual: 'A leitura oficial do status de amostra não está confirmada.',
    comoEliminar: 'Confirmada a leitura, sincronizar o status sozinho (como as metas já fazem) e só avisar a titular.',
    codigoOficialPronto: false,
    dependeDaAffiliateApi: true,
    capacidade: 'TIKTOK_SAMPLE_STATUS',
  },
  {
    id: 'amostra-recebimento',
    etapa: 'Recebimento do produto',
    situacao: 'CONTINGENCIA_MANUAL',
    hoje: 'A titular confirma que recebeu (ou toca "Tenho este produto em mãos").',
    bloqueios: ['ELEGIBILIDADE', 'API_OFICIAL'],
    apiNecessaria: 'Status de entrega da amostra (Affiliate Creator API)',
    aprovacaoExterna: APP_PARTNER,
    codigoFaltante: 'Leitura do status de entrega',
    porqueManual: 'Sem leitura oficial de entrega, só quem tem o produto sabe que ele chegou.',
    comoEliminar: 'Com o status de entrega oficial, a chegada dispara sozinha a preparação do vídeo (pedindo só a mídia).',
    codigoOficialPronto: false,
    dependeDaAffiliateApi: true,
    capacidade: 'TIKTOK_SAMPLE_STATUS',
  },
  {
    id: 'conteudo',
    etapa: 'Roteiro, legenda, hashtags, divulgação de afiliado',
    situacao: 'AUTOMATICA',
    hoje: 'Gerado sozinho, gratuito, com Quality Gate.',
    bloqueios: [],
    apiNecessaria: null,
    aprovacaoExterna: null,
    codigoFaltante: null,
    porqueManual: null,
    comoEliminar: null,
    codigoOficialPronto: true,
    dependeDaAffiliateApi: false,
    capacidade: null,
  },
  {
    id: 'video',
    etapa: 'Vídeo',
    situacao: 'AUTOMATICA',
    hoje: 'Render sozinho com 3 a 10 mídias reais da titular (fornecer mídia real é papel dela por regra).',
    bloqueios: [],
    apiNecessaria: null,
    aprovacaoExterna: null,
    codigoFaltante: null,
    porqueManual: null,
    comoEliminar: null,
    codigoOficialPronto: true,
    dependeDaAffiliateApi: false,
    capacidade: null,
  },
  {
    id: 'aprovacao',
    etapa: 'Aprovação do vídeo',
    situacao: 'AUTOMATICA_COM_APROVACAO',
    hoje: 'Cartão de aprovação; nas 10 primeiras é obrigatório. Depois: ASSISTIDO → SEMIAUTOMÁTICO → AUTOMÁTICO.',
    bloqueios: [],
    apiNecessaria: null,
    aprovacaoExterna: null,
    codigoFaltante: null,
    porqueManual: null,
    comoEliminar: null,
    codigoOficialPronto: true,
    dependeDaAffiliateApi: false,
    capacidade: null,
  },
  {
    id: 'publicacao',
    etapa: 'Publicação no TikTok',
    situacao: 'CONTINGENCIA_MANUAL',
    hoje: 'A titular publica no app e cola o link; o Patrono já prepara a próxima.',
    bloqueios: ['APROVACAO_TIKTOK', 'CONFIGURACAO'],
    apiNecessaria: 'Content Posting API (upload de rascunho; Direct Post é outra auditoria)',
    aprovacaoExterna: APP_DEVELOPERS,
    codigoFaltante: null,
    porqueManual: 'Sem o app revisado, o TikTok não aceita envio pela API.',
    comoEliminar: 'App aprovado → conectar a conta → ligar a publicação (código pronto). Direct Post depois da auditoria própria.',
    codigoOficialPronto: true,
    dependeDaAffiliateApi: false,
    capacidade: 'TIKTOK_PUBLISH',
  },
  {
    id: 'marcacao',
    etapa: 'Marcar o produto no vídeo',
    situacao: 'CONTINGENCIA_MANUAL',
    hoje: 'A titular marca o produto no app ao publicar.',
    bloqueios: ['API_OFICIAL'],
    apiNecessaria: 'Campo de produto (anchor) na Content Posting API — não existe hoje',
    aprovacaoExterna: 'Recurso que o TikTok ainda não oferece a terceiros',
    codigoFaltante: 'Envio do anchor, quando o campo existir',
    porqueManual: 'A API oficial de publicação não tem campo para marcar produto do TikTok Shop.',
    comoEliminar: 'Acompanhar a documentação; quando o campo existir, enviar o produto junto com o vídeo.',
    codigoOficialPronto: false,
    dependeDaAffiliateApi: false,
    capacidade: 'TIKTOK_PRODUCT_TAG',
  },
  {
    id: 'metricas',
    etapa: 'Métricas do vídeo',
    situacao: 'CONTINGENCIA_MANUAL',
    hoje: 'A titular registra as visualizações que o app mostra.',
    bloqueios: ['APROVACAO_TIKTOK', 'CONFIGURACAO'],
    apiNecessaria: 'Display API — video.list',
    aprovacaoExterna: APP_DEVELOPERS,
    codigoFaltante: null,
    porqueManual: 'Sem o app aprovado não há leitura oficial das métricas.',
    comoEliminar: 'App aprovado com o escopo video.list → ligar o coletor (código pronto).',
    codigoOficialPronto: true,
    dependeDaAffiliateApi: false,
    capacidade: 'TIKTOK_METRICS',
  },
  {
    id: 'venda-comissao',
    etapa: 'Vendas e comissões',
    situacao: 'CONTINGENCIA_MANUAL',
    hoje: 'A titular registra o que o app mostra (atribuição CONFIRMADA/PROVÁVEL).',
    bloqueios: ['ELEGIBILIDADE', 'APROVACAO_TIKTOK', 'API_OFICIAL'],
    apiNecessaria: 'Affiliate Creator API — Orders / Commissions',
    aprovacaoExterna: `${APP_PARTNER}; disponibilidade no Brasil`,
    codigoFaltante: 'Coletor de pedidos/comissões, quando o contrato for confirmado',
    porqueManual: 'Pedidos e comissões só existem pela Affiliate API, bloqueada por elegibilidade da empresa.',
    comoEliminar: `A partir de ${DATA_BASE} (ou mudança oficial), com a API liberada: sincronizar pedidos e comissões sozinho; o registro manual vira só conferência.`,
    codigoOficialPronto: false,
    dependeDaAffiliateApi: true,
    capacidade: 'TIKTOK_COMMISSIONS',
  },
  {
    id: 'aprendizado',
    etapa: 'Aprendizado',
    situacao: 'AUTOMATICA',
    hoje: 'O Patrono aprende formato, horário e produto com cada resultado registrado.',
    bloqueios: [],
    apiNecessaria: null,
    aprovacaoExterna: null,
    codigoFaltante: null,
    porqueManual: null,
    comoEliminar: null,
    codigoOficialPronto: true,
    dependeDaAffiliateApi: false,
    capacidade: null,
  },
  {
    id: 'missoes',
    etapa: 'Missões do TikTok Shop',
    situacao: 'CONTINGENCIA_MANUAL',
    hoje: 'A titular registra o que o app mostra; o Patrono planeja o que falta.',
    bloqueios: ['API_OFICIAL'],
    apiNecessaria: 'API de missões/campanhas de criadora (não existe pública)',
    aprovacaoExterna: 'Recurso que o TikTok ainda não oferece a terceiros',
    codigoFaltante: null,
    porqueManual: 'Não existe API pública de missões.',
    comoEliminar: 'O sincronizador de metas já existe (desligado): ligar assim que houver fonte oficial.',
    codigoOficialPronto: true,
    dependeDaAffiliateApi: false,
    capacidade: null,
  },
  {
    id: 'agenda',
    etapa: 'Calendário e agenda',
    situacao: 'AUTOMATICA',
    hoje: 'Agenda sugerida pelo prazo real das missões e pela fila.',
    bloqueios: [],
    apiNecessaria: null,
    aprovacaoExterna: null,
    codigoFaltante: null,
    porqueManual: null,
    comoEliminar: null,
    codigoOficialPronto: true,
    dependeDaAffiliateApi: false,
    capacidade: null,
  },
]

/**
 * FUNÇÃO PURA: estado do CÓDIGO oficial de uma etapa manual, como a Torre
 * mostra. Enquanto a Affiliate API estiver bloqueada por elegibilidade, nada
 * que dependa dela aparece como "pronto para ligar agora".
 */
export function estadoDoCodigo(e: EtapaDaAutonomia, agora: Date = new Date()): string {
  if (e.situacao !== 'CONTINGENCIA_MANUAL') return 'AUTOMÁTICO'
  if (e.dependeDaAffiliateApi && situacaoDaAffiliateApi(agora).bloqueada) {
    return e.codigoOficialPronto ? `PRONTO · DESLIGADO · AGUARDANDO ELEGIBILIDADE (${DATA_BASE})` : `SEM API PÚBLICA · AGUARDANDO ELEGIBILIDADE (${DATA_BASE})`
  }
  return e.codigoOficialPronto ? 'CÓDIGO PRONTO · DEPENDE DO TIKTOK' : 'DEPENDE DE API OFICIAL'
}

/** FUNÇÃO PURA: resumo para a Torre. */
export function resumoDaAutonomia(etapas: readonly EtapaDaAutonomia[] = ETAPAS_DA_AUTONOMIA, agora: Date = new Date()) {
  const manuais = etapas.filter((e) => e.situacao === 'CONTINGENCIA_MANUAL')
  const affiliate = situacaoDaAffiliateApi(agora)
  return {
    total: etapas.length,
    automaticas: etapas.length - manuais.length,
    manuais,
    soDependemDoTikTok: manuais.filter((e) => e.codigoOficialPronto).length,
    bloqueadasPorElegibilidade: affiliate.bloqueada ? manuais.filter((e) => e.dependeDaAffiliateApi).length : 0,
    affiliate,
  }
}

/**
 * P2.18.3 — MODO ASSISTIDO SEM AFFILIATE CREATOR API (até a data-base).
 * O Patrono não fica parado esperando a API: maximiza a automação com os
 * meios oficiais disponíveis e chama a titular só no clique que o TikTok obriga.
 */
export const MODO_ASSISTIDO = {
  nome: 'MODO ASSISTIDO SEM AFFILIATE CREATOR API',
  ate: DATA_BASE,
  oPatronoFazSozinho: [
    'Analisa os produtos do catálogo e os informados',
    'Usa o "Mais vendidos" registrado (snapshot manual, nunca tratado como API)',
    'Pontua, ranqueia e escolhe o produto',
    'Prioriza o que a titular já tem em mãos (sem esperar amostra)',
    'Decide o que entra na vitrine e se vale pedir amostra',
    'Prepara roteiro, plano de cenas e "O que gravar"',
    'Gera o vídeo e roda o Quality Gate',
    'Prepara legenda, hashtags e aviso de afiliada',
    'Acompanha as missões informadas e o prazo real',
    'Aprende com os resultados registrados',
    'Monta a agenda',
    'Diz qual é a única ação humana inevitável agora (página Operação)',
  ],
  acoesHumanasInevitaveis: [
    'Aprovar ou recusar o produto escolhido',
    'Adicionar o produto à vitrine no app',
    'Pedir a amostra no app',
    'Informar o que o app mostra da amostra / confirmar o recebimento',
    'Gravar e enviar a mídia real',
    'Aprovar o vídeo',
    'Publicar no app marcando o produto e colar o link',
    'Informar o mínimo do resultado (views, vendas, comissão) até haver API',
  ],
} as const
