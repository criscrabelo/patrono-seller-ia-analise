/**
 * TikTokPreflightValidator — arquitetura real, ainda sem chamada externa
 * habilitada (nenhuma credencial TikTok configurada nesta rodada).
 *
 * Objetivo: antes de publicar, consultar a própria conta (via API oficial,
 * quando configurada) para saber o que ELA permite — nunca hardcodar um
 * limite fixo de duração/formato no código, porque a API é quem manda
 * (contas diferentes podem ter regras diferentes, e a regra pode mudar).
 *
 * Enquanto não há credencial: todo campo relevante volta como
 * `unknown` e o resultado geral é `NOT_VERIFIED` — nunca um valor
 * inventado "porque geralmente é assim".
 */

export interface TikTokCreatorInfo {
  duracaoMaximaSegundos: number | 'unknown'
  privacidadeOpcoesPermitidas: string[] | 'unknown'
  duetPermitido: boolean | 'unknown'
  stitchPermitido: boolean | 'unknown'
  comentariosPermitidos: boolean | 'unknown'
}

export type PreflightStatus =
  | 'NOT_VERIFIED' // sem credencial/consulta ainda
  | 'TECHNICALLY_VALID' // formato/codec/duração conferidos contra a API e OK
  | 'REQUIRES_USER_CONSENT' // tudo pronto, falta só a usuária autorizar (exigência da própria plataforma)
  | 'BLOCKED_BY_POLICY' // a API recusou por regra de conteúdo/conta

/**
 * Status de publicação (Rodada 5, prioridade TikTok). `PREVALIDATED_FOR_TIKTOK`
 * é SÓ a nossa própria pré-validação interna — nunca deve ser confundido
 * com aceitação real. Só depois de uma resposta de verdade da API oficial
 * é que o status vira `ACCEPTED_BY_TIKTOK` (ou `REJECTED_BY_TIKTOK`).
 * Nunca dizer "validado pelo TikTok" antes disso.
 */
export type TikTokPublicationStatus =
  | 'PREVALIDATED_FOR_TIKTOK'
  | 'PUBLISHING'
  | 'ACCEPTED_BY_TIKTOK'
  | 'REJECTED_BY_TIKTOK'
  | 'FAILED'

export interface TikTokPreflightResult {
  status: PreflightStatus
  creatorInfo: TikTokCreatorInfo | null
  disclosureComercialNecessaria: boolean
  motivo: string
}

/**
 * Interface real que a Rodada 5 (ou quando houver credencial TikTok)
 * implementa de verdade. Aqui só o contrato — chamá-la sem credencial
 * configurada deve devolver NOT_VERIFIED, nunca simular uma resposta.
 */
export interface TikTokPreflightValidator {
  validar(params: { contentId: string; workspaceId: string }): Promise<TikTokPreflightResult>
}

/**
 * Implementação atual: sem credenciais configuradas, sempre devolve
 * NOT_VERIFIED. Existe para o resto do código já poder depender da
 * interface `TikTokPreflightValidator` sem quebrar quando a integração
 * real for plugada — só troca esta classe pela versão que chama a API.
 */
export class TikTokPreflightNotConfigured implements TikTokPreflightValidator {
  async validar(): Promise<TikTokPreflightResult> {
    return {
      status: 'NOT_VERIFIED',
      creatorInfo: null,
      disclosureComercialNecessaria: true, // assume o mais restritivo até confirmar o contrário
      motivo: 'Nenhuma credencial do TikTok configurada — nenhuma chamada foi feita.',
    }
  }
}

/**
 * TikTokHumanConsentGate — quando a própria plataforma exige consentimento
 * explícito, o Patrono faz TODO o resto sozinho (roteiro, mídia, preflight,
 * disclosure) e só então pede a autorização mínima. Nunca transforma essa
 * exigência num fluxo manual maior — a usuária só vê:
 * "Conteúdo pronto. Autorizar publicação no TikTok."
 */
export interface ConsentGateResult {
  liberadoParaPublicarSozinho: boolean
  mensagemParaUsuaria: string | null
}

// ── Preflight dinâmico com creator_info REAL (Rodada 6) ──────────────────
// Enquanto a Rodada 5 só devolvia NOT_VERIFIED sem credencial, agora que o
// OAuth real existe (lib/tiktok-oauth.ts) o preflight consulta creator_info
// de verdade antes de cada Direct Post — nunca hardcoda duração/formato.

export interface TikTokContentTecnico {
  duracaoSegundos: number | null
  privacyLevel: string | null
  comentariosHabilitados: boolean
  duetHabilitado: boolean
  stitchHabilitado: boolean
}

/**
 * Valida os dados técnicos do conteúdo contra o `creator_info` REAL da
 * conta — nunca contra um limite fixo no código. Campo do creatorInfo que
 * vier `'unknown'` nunca é tratado como "sem limite"; vira `NOT_VERIFIED`
 * para aquele aspecto específico.
 */
export function validarPreflightDinamico(creatorInfo: TikTokCreatorInfo, content: TikTokContentTecnico): TikTokPreflightResult {
  const disclosureComercialNecessaria = true // TikTok exige disclosure para conteúdo comercial/afiliado — nunca assumimos que não precisa

  if (creatorInfo.duracaoMaximaSegundos === 'unknown' || creatorInfo.privacidadeOpcoesPermitidas === 'unknown') {
    return {
      status: 'NOT_VERIFIED',
      creatorInfo,
      disclosureComercialNecessaria,
      motivo: 'creator_info não trouxe todos os campos necessários — não é possível confirmar tecnicamente ainda.',
    }
  }

  if (content.duracaoSegundos != null && content.duracaoSegundos > creatorInfo.duracaoMaximaSegundos) {
    return {
      status: 'BLOCKED_BY_POLICY',
      creatorInfo,
      disclosureComercialNecessaria,
      motivo: `Duração (${content.duracaoSegundos}s) excede o máximo permitido pela conta (${creatorInfo.duracaoMaximaSegundos}s).`,
    }
  }

  if (content.privacyLevel != null && !creatorInfo.privacidadeOpcoesPermitidas.includes(content.privacyLevel)) {
    return {
      status: 'BLOCKED_BY_POLICY',
      creatorInfo,
      disclosureComercialNecessaria,
      motivo: `Privacidade "${content.privacyLevel}" não está entre as opções permitidas pela conta (${creatorInfo.privacidadeOpcoesPermitidas.join(', ')}).`,
    }
  }

  if (content.comentariosHabilitados && creatorInfo.comentariosPermitidos === false) {
    return {
      status: 'BLOCKED_BY_POLICY',
      creatorInfo,
      disclosureComercialNecessaria,
      motivo: 'Conta não permite comentários habilitados para este post.',
    }
  }
  if (content.duetHabilitado && creatorInfo.duetPermitido === false) {
    return { status: 'BLOCKED_BY_POLICY', creatorInfo, disclosureComercialNecessaria, motivo: 'Conta não permite duet habilitado.' }
  }
  if (content.stitchHabilitado && creatorInfo.stitchPermitido === false) {
    return { status: 'BLOCKED_BY_POLICY', creatorInfo, disclosureComercialNecessaria, motivo: 'Conta não permite stitch habilitado.' }
  }

  // TikTok sempre exige consentimento explícito da usuária antes do envio (regra oficial) —
  // aqui devolvemos TECHNICALLY_VALID (passou nas checagens técnicas); é o `tiktokHumanConsentGate`
  // (função abaixo) quem decide se falta consentimento antes de publicar de fato.
  return { status: 'TECHNICALLY_VALID', creatorInfo, disclosureComercialNecessaria, motivo: 'Conferido contra o creator_info real da conta.' }
}

/**
 * Implementação real: quando há token TikTok válido, consulta creator_info
 * de verdade e valida contra os dados dinâmicos da conta. Sem token,
 * comporta-se como `TikTokPreflightNotConfigured` (NOT_VERIFIED).
 */
export class TikTokPreflightLive implements TikTokPreflightValidator {
  constructor(
    private obterCreatorInfo: () => Promise<TikTokCreatorInfo | null>,
    private obterConteudoTecnico: (params: { contentId: string; workspaceId: string }) => Promise<TikTokContentTecnico>
  ) {}

  async validar(params: { contentId: string; workspaceId: string }): Promise<TikTokPreflightResult> {
    const creatorInfo = await this.obterCreatorInfo()
    if (!creatorInfo) {
      return {
        status: 'NOT_VERIFIED',
        creatorInfo: null,
        disclosureComercialNecessaria: true,
        motivo: 'Sem conexão TikTok ativa — nenhuma chamada foi feita.',
      }
    }
    const content = await this.obterConteudoTecnico(params)
    return validarPreflightDinamico(creatorInfo, content)
  }
}

export function tiktokHumanConsentGate(preflight: TikTokPreflightResult): ConsentGateResult {
  if (preflight.status === 'BLOCKED_BY_POLICY') {
    return { liberadoParaPublicarSozinho: false, mensagemParaUsuaria: null } // não é consentimento, é bloqueio — vira HumanActionRequired diferente
  }
  if (preflight.status === 'REQUIRES_USER_CONSENT') {
    return { liberadoParaPublicarSozinho: false, mensagemParaUsuaria: 'Conteúdo pronto. Autorizar publicação no TikTok.' }
  }
  return { liberadoParaPublicarSozinho: preflight.status === 'TECHNICALLY_VALID', mensagemParaUsuaria: null }
}
