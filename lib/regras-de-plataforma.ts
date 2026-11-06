/**
 * P2.20 — Motor de restrições e cotas da PLATAFORMA (PlatformConstraintEngine).
 *
 * Cada regra diz: plataforma, programa, escopo (plataforma inteira, um programa ou só esta conta),
 * região, regra, limite, fonte, data da fonte, data de verificação, início de vigência, revisão/expiração,
 * confiança e status. Só a regra CONFIRMADA (fonte oficial) ou CONFIRMADA_PELA_TITULAR (vista no app, para
 * esta conta) pode BLOQUEAR; o resto só informa.
 *
 * Regra de ouro: regra de um PROGRAMA (ex.: piloto de vídeos compráveis) nunca vale para quem não está no
 * programa — e nunca vira "regra do TikTok". Escopo PROGRAMA/CONTA exige participação explícita.
 *
 * Isto NÃO substitui os limites INTERNOS do Patrono (10 publicações
 * assistidas, no máximo 2 por dia na agenda): aqueles são prudência nossa, não regra da plataforma.
 */

export type Plataforma = 'TIKTOK' | 'TIKTOK_SHOP'
export type Escopo = 'PLATAFORMA' | 'PROGRAMA' | 'CONTA'
export type Regiao = 'BR' | 'GLOBAL'
export type Confianca = 'ALTA' | 'MEDIA' | 'BAIXA'
/** FUTURA = confirmada, mas ainda não vigente (não bloqueia antes do início). */
export type StatusDaRegra = 'CONFIRMADA' | 'CONFIRMADA_PELA_TITULAR' | 'NAO_CONFIRMADA' | 'REVISAR' | 'EXPIRADA' | 'FUTURA'

export interface RegraDePlataforma {
  id: string
  plataforma: Plataforma
  /** Programa a que a regra pertence (null = vale para a plataforma inteira na região). */
  programa: string | null
  escopo: Escopo
  regiao: Regiao
  /** Código estável da regra (o que o motor consulta). */
  regra: string
  descricao: string
  limite: number | number[] | string | null
  unidade: string | null
  fonte: string
  referencia: string | null
  /** Data da regra na fonte (quando a fonte informa). */
  dataDaFonte: string | null
  /** Quando o Patrono conferiu a fonte. Sem data = REVISAR. */
  verificadaEm: string | null
  vigenciaInicio: string | null
  /** Revisar a fonte a partir desta data (regra de plataforma muda). */
  revisarEm: string | null
  expiraEm: string | null
  confianca: Confianca
  status: StatusDaRegra
  observacao?: string
}

/**
 * Catálogo conferido (P2.18.12 §B.3, auditoria de 14/10/2026). Nada aqui foi inventado: o que não tem
 * fonte oficial está NAO_CONFIRMADA e não bloqueia nada.
 */
export const CATALOGO_DE_REGRAS: readonly RegraDePlataforma[] = [
  {
    id: 'tts-br-afiliados-reducao-30d', plataforma: 'TIKTOK_SHOP', programa: 'PLANO_DE_AFILIADOS', escopo: 'PLATAFORMA', regiao: 'BR',
    regra: 'REDUCAO_DE_COMISSAO_APOS_DIAS', descricao: 'Redução de taxa de comissão só vale 30 dias depois para produtos já adicionados pelo afiliado; aumento vale na hora.',
    limite: 30, unidade: 'dias', fonte: 'TikTok Shop Brasil — Seller University', referencia: 'seller-br.tiktok.com/university (P2.18.12 §B.4)',
    dataDaFonte: '2026-02-10', verificadaEm: '2026-10-14', vigenciaInicio: '2026-02-10', revisarEm: '2027-04-14', expiraEm: null, confianca: 'ALTA', status: 'CONFIRMADA',
  },
  {
    id: 'tts-br-afiliados-liquidacao', plataforma: 'TIKTOK_SHOP', programa: 'PLANO_DE_AFILIADOS', escopo: 'PLATAFORMA', regiao: 'BR',
    regra: 'PRAZO_DE_LIQUIDACAO', descricao: 'A comissão é liquidada em 3, 7 ou 15 dias; antes disso aparece como não liquidada (zero).',
    limite: [3, 7, 15], unidade: 'dias', fonte: 'TikTok Shop Brasil — Seller University', referencia: 'seller-br.tiktok.com/university (P2.18.12 §B.4)',
    dataDaFonte: null, verificadaEm: '2026-10-14', vigenciaInicio: null, revisarEm: '2027-04-14', expiraEm: null, confianca: 'ALTA', status: 'CONFIRMADA',
  },
  {
    id: 'tts-br-afiliados-pagamento', plataforma: 'TIKTOK_SHOP', programa: 'PLANO_DE_AFILIADOS', escopo: 'PLATAFORMA', regiao: 'BR',
    regra: 'DIA_DO_PAGAMENTO', descricao: 'O pagamento sai às quartas-feiras, depois da liquidação.',
    limite: 'QUARTA_FEIRA', unidade: null, fonte: 'TikTok Shop Brasil — Seller University', referencia: 'seller-br.tiktok.com/university (P2.18.12 §B.4)',
    dataDaFonte: null, verificadaEm: '2026-10-14', vigenciaInicio: null, revisarEm: '2027-04-14', expiraEm: null, confianca: 'ALTA', status: 'CONFIRMADA',
  },
  {
    id: 'tts-br-piloto-videos-compraveis', plataforma: 'TIKTOK_SHOP', programa: 'PROGRAMA_PILOTO_VIDEOS_COMPRAVEIS', escopo: 'PROGRAMA', regiao: 'BR',
    regra: 'VIDEOS_COMPRAVEIS_POR_DIA', descricao: 'Programa piloto: até 10 vídeos compráveis por dia; sair com 30 dias e 2.000 seguidores.',
    limite: 10, unidade: 'vídeos compráveis por dia', fonte: 'Fontes de terceiros (as fontes divergem)', referencia: 'P2.18.12 §B.3',
    dataDaFonte: null, verificadaEm: '2026-10-14', vigenciaInicio: null, revisarEm: null, expiraEm: null, confianca: 'BAIXA', status: 'NAO_CONFIRMADA',
    observacao: 'Vale só para contas DENTRO do programa piloto. A titular confere o número na tela do app; até lá, não bloqueia nada.',
  },
  {
    id: 'tts-br-links-externos', plataforma: 'TIKTOK_SHOP', programa: 'LINKS_EXTERNOS_ETP', escopo: 'PROGRAMA', regiao: 'BR',
    regra: 'LINK_DE_AFILIADO_FORA_DO_TIKTOK', descricao: 'Links de afiliado do TikTok Shop fora do TikTok (ETP) no Brasil.',
    limite: null, unidade: null, fonte: 'Não encontrado em fonte oficial', referencia: 'P2.18.12 §B.3',
    dataDaFonte: null, verificadaEm: '2026-10-14', vigenciaInicio: null, revisarEm: null, expiraEm: null, confianca: 'BAIXA', status: 'NAO_CONFIRMADA',
    observacao: 'Não construir multicanal com link do TikTok até confirmar.',
  },
  {
    id: 'tts-partner-center-registro-minimo', plataforma: 'TIKTOK_SHOP', programa: 'AFFILIATE_CREATOR_API', escopo: 'PROGRAMA', regiao: 'GLOBAL',
    regra: 'REGISTRO_MINIMO_DA_EMPRESA', descricao: 'Certificação no Partner Center (App Developer / Creator collaborations) exige pelo menos 1 ano de registro da empresa.',
    limite: 1, unidade: 'ano de registro', fonte: 'TikTok Shop Partner Center — Affiliate / Creator Collaboration Developer onboarding & termination Rules', referencia: 'P2.18.3 §1',
    dataDaFonte: null, verificadaEm: '2026-10-13', vigenciaInicio: null, revisarEm: '2027-04-13', expiraEm: null, confianca: 'ALTA', status: 'CONFIRMADA',
    observacao: 'A data desta empresa é calculada num lugar só: lib/elegibilidade-tiktok-shop.ts (constituição + 1 ano).',
  },
  {
    id: 'tiktok-content-posting-legenda', plataforma: 'TIKTOK', programa: 'CONTENT_POSTING_API', escopo: 'PROGRAMA', regiao: 'GLOBAL',
    regra: 'LEGENDA_MAX_CARACTERES', descricao: 'Limite do campo de legenda (title) da Content Posting API.',
    limite: 2200, unidade: 'caracteres', fonte: 'Documentação da Content Posting API (developers.tiktok.com)', referencia: 'lib/tiktok-pacote.ts LIMITE_DA_LEGENDA',
    dataDaFonte: null, verificadaEm: null, vigenciaInicio: null, revisarEm: null, expiraEm: null, confianca: 'MEDIA', status: 'CONFIRMADA',
    observacao: 'Sem data de conferência registrada: o motor marca REVISAR.',
  },
]

/** Dia (AAAA-MM-DD) no fuso de Brasília: é o dia da quota (zera à meia-noite de Brasília, não do UTC). */
export function diaNoBrasil(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

/** A data (AAAA-MM-DD = meia-noite de Brasília, ou ISO completo) já chegou? */
export const antes = (iso: string | null, agora: Date) => !!iso && new Date(`${iso.length === 10 ? `${iso}T00:00:00-03:00` : iso}`).getTime() <= agora.getTime()

/** Status que vale AGORA: expirada, revisão vencida ou sem data de conferência viram EXPIRADA/REVISAR. */
export function statusEfetivo(r: RegraDePlataforma, agora: Date): StatusDaRegra {
  if (antes(r.expiraEm, agora)) return 'EXPIRADA'
  if (r.status === 'NAO_CONFIRMADA') return 'NAO_CONFIRMADA'
  if (!r.verificadaEm || antes(r.revisarEm, agora)) return 'REVISAR'
  if (r.vigenciaInicio && !antes(r.vigenciaInicio, agora)) return 'FUTURA'
  return r.status
}

export const podeBloquear = (r: RegraDePlataforma, agora: Date) => ['CONFIRMADA', 'CONFIRMADA_PELA_TITULAR'].includes(statusEfetivo(r, agora))

export interface ContextoDaConta {
  regiao: Regiao
  /** Programas em que a conta COMPROVADAMENTE está (a titular confirmou ou a fonte oficial diz). */
  programas: string[]
}

/**
 * Regras que se aplicam a esta conta: mesma plataforma, região da conta (ou GLOBAL), e — para escopo
 * PROGRAMA/CONTA — só se a conta está no programa. Nunca generaliza regra de programa.
 */
export function regrasAplicaveis(regras: readonly RegraDePlataforma[], p: { plataforma: Plataforma; regra?: string; conta: ContextoDaConta; agora: Date }) {
  return regras
    .filter((r) => r.plataforma === p.plataforma && (!p.regra || r.regra === p.regra))
    .filter((r) => r.regiao === 'GLOBAL' || r.regiao === p.conta.regiao)
    .filter((r) => r.escopo === 'PLATAFORMA' || (r.programa != null && p.conta.programas.includes(r.programa)))
    .map((r) => ({ ...r, statusAgora: statusEfetivo(r, p.agora), bloqueia: podeBloquear(r, p.agora) }))
}

/** A titular conferiu no app: vira uma regra DA CONTA, com a tela do app como fonte e revisão em 30 dias. */
export function confirmarNaConta(base: RegraDePlataforma, p: { limite: number; agora: Date }): RegraDePlataforma {
  // Dia de Brasília (às 22h no Brasil o UTC já é o dia seguinte).
  const hoje = diaNoBrasil(p.agora)
  const revisar = diaNoBrasil(new Date(p.agora.getTime() + 30 * 86_400_000))
  return {
    ...base, id: `${base.id}:conta`, escopo: 'CONTA', limite: p.limite, fonte: 'Tela do app TikTok (conferido pela titular)', referencia: null,
    dataDaFonte: hoje, verificadaEm: hoje, vigenciaInicio: hoje, revisarEm: revisar, confianca: 'ALTA', status: 'CONFIRMADA_PELA_TITULAR',
    observacao: `Confirmado para esta conta em ${hoje}. ${base.observacao ?? ''}`.trim(),
  }
}

export interface AvaliacaoDeCota {
  regra: string
  /** null = não há regra que possa limitar esta conta */
  limite: number | null
  usado: number
  restante: number | null
  bloqueia: boolean
  motivo: string
  fonte: string | null
  /** Regra que definiu o limite (null = nenhuma). */
  regraId: string | null
  /** Regras que existem mas não podem limitar (não confirmadas, a revisar, de programa em que a conta não está). */
  informativas: { id: string; descricao: string; status: StatusDaRegra; motivo: string }[]
}

/** Cota numérica por dia (ex.: VIDEOS_COMPRAVEIS_POR_DIA). Sem regra confirmada para a conta: não bloqueia. */
export function avaliarCotaDiaria(regras: readonly RegraDePlataforma[], p: { plataforma: Plataforma; regra: string; conta: ContextoDaConta; usadoHoje: number; agora: Date }): AvaliacaoDeCota {
  const todas = regras.filter((r) => r.plataforma === p.plataforma && r.regra === p.regra)
  const aplicaveis = regrasAplicaveis(regras, p)
  const vigentes = aplicaveis.filter((r) => r.bloqueia && typeof r.limite === 'number')
  // A da conta (conferida no app) vale mais que a geral; entre iguais, a mais restritiva.
  const escolhida = [...vigentes].sort((a, b) => (a.escopo === 'CONTA' ? -1 : 0) - (b.escopo === 'CONTA' ? -1 : 0) || (a.limite as number) - (b.limite as number))[0]
  const informativas = todas.filter((r) => r.id !== escolhida?.id).map((r) => {
    const ap = aplicaveis.find((x) => x.id === r.id)
    const motivo = !ap ? `só vale para quem está no programa ${r.programa}` : ap.statusAgora === 'NAO_CONFIRMADA' ? 'não confirmada em fonte oficial nem no app' : ap.statusAgora === 'REVISAR' ? 'precisa ser conferida de novo' : ap.statusAgora === 'EXPIRADA' ? 'expirada' : ap.statusAgora === 'FUTURA' ? `ainda não vigente (começa em ${r.vigenciaInicio})` : 'outra regra vale mais para esta conta'
    return { id: r.id, descricao: r.descricao, status: ap?.statusAgora ?? statusEfetivo(r, p.agora), motivo }
  })
  if (!escolhida) {
    return { regra: p.regra, limite: null, usado: p.usadoHoje, restante: null, bloqueia: false, fonte: null, regraId: null, informativas, motivo: 'Sem regra confirmada para a sua conta: o Patrono não limita por conta própria.' }
  }
  const limite = escolhida.limite as number
  const restante = Math.max(0, limite - p.usadoHoje)
  return {
    regra: p.regra, limite, usado: p.usadoHoje, restante, bloqueia: restante === 0, fonte: escolhida.fonte, regraId: escolhida.id, informativas,
    motivo: restante === 0 ? `Limite de ${limite} ${escolhida.unidade ?? ''} atingido hoje (${escolhida.fonte}).`.replace(/\s+/g, ' ') : `${restante} de ${limite} disponíveis hoje (${escolhida.fonte}).`,
  }
}
