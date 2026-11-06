/**
 * P2.18.3 — BLOQUEIO OFICIAL DA AFFILIATE CREATOR API POR ELEGIBILIDADE.
 *
 * Regra publicada pelo TikTok Shop Partner Center (categoria App Developer /
 * Customer Engagement / Creator collaborations): a empresa precisa ter pelo
 * menos 1 ano de registro. A Patrono Inova Simples foi constituída em
 * 01/10/2026, então só cumpre o requisito em 01/10/2027.
 *
 * Isto NÃO é "pendência de configuração": é bloqueio por elegibilidade
 * temporal. O código oficial (descoberta, vitrine, OAuth de criadora…) fica
 * PRONTO / DESLIGADO / AGUARDANDO ELEGIBILIDADE OFICIAL — nada é apagado.
 *
 * FONTE ÚNICA das datas: nenhum outro arquivo escreve 2027-10-01 / 01/10/2027
 * (o teste rodada96 confere). FUNÇÕES PURAS, sem banco: a Torre (cliente) lê.
 */

/** Data de constituição da empresa (CNPJ). */
export const CONSTITUICAO_DA_EMPRESA = '2026-10-01'
/** Tempo mínimo de registro exigido pela regra publicada. */
export const ANOS_DE_REGISTRO_EXIGIDOS = 1

/** Primeiro dia em que a empresa cumpre o requisito (constituição + 1 ano), em ISO (AAAA-MM-DD). */
export function dataDeElegibilidade(): string {
  const [a, m, d] = CONSTITUICAO_DA_EMPRESA.split('-').map(Number)
  return `${a + ANOS_DE_REGISTRO_EXIGIDOS}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** A mesma data, como a titular lê (DD/MM/AAAA). */
export function dataDeElegibilidadeBR(): string {
  const [a, m, d] = dataDeElegibilidade().split('-')
  return `${d}/${m}/${a}`
}

export const AFFILIATE_CREATOR_API = {
  estado: 'BLOQUEADA_POR_ELEGIBILIDADE_TEMPORAL',
  rotulo: 'PRONTO · DESLIGADO · AGUARDANDO ELEGIBILIDADE OFICIAL',
  regra: 'Categoria App Developer / Customer Engagement / Creator collaborations: a empresa precisa ter pelo menos 1 ano de registro.',
  empresa: 'Patrono Inova Simples (constituída em 01/10/2026).',
  ressalva: 'Salvo mudança oficial da regra, aprovação excepcional documentada ou novo caminho oficial liberado pelo TikTok.',
  /** O que já foi verificado e NÃO é caminho (não insistir). */
  naoSaoCaminho: [
    'Conta individual de creator não substitui a certificação da empresa.',
    'TSP / ISV / TAP / CAP não aparecem como isenção do requisito.',
    'Beta / sandbox não é caminho aberto para contornar a exigência.',
    'Não foi encontrada exceção oficial documentada para empresa recém-constituída.',
  ],
  fontes: [
    'Affiliate / Creator Collaboration Developer onboarding & termination Rules (TikTok Shop Partner Center)',
    'Read Creator Affiliate Collaborations (documentação oficial)',
    'Manage Showcase Products (documentação oficial)',
    'Creator authorization (documentação oficial)',
  ],
} as const

/** Revisão antecipada só com fato novo e oficial (nunca nova tentativa às cegas). */
export const CONDICOES_DE_REVISAO_ANTECIPADA = [
  'O TikTok mudou a regra de onboarding (tempo mínimo de registro).',
  'Surgiu exceção oficial documentada para empresa recém-constituída.',
  'O Partner Manager respondeu por escrito com um novo caminho.',
  'O Brasil ganhou um novo programa oficial de acesso.',
] as const

/**
 * Checklist DOCUMENTAL de monitoramento (sem scraping; não é tarefa da
 * titular). Revisado pelo time técnico a cada RC e na data-base.
 */
export const CHECKLIST_DE_MONITORAMENTO = [
  'Onboarding rules (Affiliate / Creator Collaboration Developer)',
  'Affiliate Creator API: escopos e disponibilidade',
  'Disponibilidade no Brasil',
  'Sandbox / beta',
  'Creator authorization',
  'APIs de amostra (sample)',
  'APIs de vitrine (showcase)',
] as const

export interface SituacaoDaAffiliateApi {
  /** true até a data-base: não mostrar como "pronta para ligar agora" nem pedir onboarding. */
  bloqueada: boolean
  estado: string
  rotulo: string
  revisaoEm: string
  revisaoEmBR: string
  diasAteRevisao: number
  frase: string
}

const DIA = 24 * 60 * 60 * 1000

/**
 * FUNÇÃO PURA. A data-base é meia-noite de Brasília do dia de elegibilidade.
 * Depois dela, a API deixa de ser bloqueada POR ELEGIBILIDADE (ainda depende
 * da aprovação do TikTok — o registro de capacidades continua mandando).
 */
export function situacaoDaAffiliateApi(agora: Date = new Date()): SituacaoDaAffiliateApi {
  const revisao = new Date(`${dataDeElegibilidade()}T00:00:00-03:00`)
  const bloqueada = agora.getTime() < revisao.getTime()
  const dias = Math.max(0, Math.ceil((revisao.getTime() - agora.getTime()) / DIA))
  return {
    bloqueada,
    estado: bloqueada ? AFFILIATE_CREATOR_API.estado : 'ELEGIVEL_AGUARDANDO_CERTIFICACAO',
    rotulo: bloqueada ? AFFILIATE_CREATOR_API.rotulo : 'ELEGÍVEL · PEDIR A CERTIFICAÇÃO NO PARTNER CENTER',
    revisaoEm: dataDeElegibilidade(),
    revisaoEmBR: dataDeElegibilidadeBR(),
    diasAteRevisao: dias,
    frase: bloqueada
      ? `Bloqueada por elegibilidade da empresa até ${dataDeElegibilidadeBR()} (exige 1 ano de registro). Código pronto e desligado. ${AFFILIATE_CREATOR_API.ressalva}`
      : `A empresa já cumpre o tempo de registro desde ${dataDeElegibilidadeBR()}: dá para pedir a certificação no Partner Center.`,
  }
}
