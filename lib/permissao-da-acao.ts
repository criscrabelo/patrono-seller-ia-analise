/**
 * P2.20 (parte 2) — ESTADO DA CONTA × REGRA DA PLATAFORMA. Puro (sem banco).
 *
 * A REGRA DA PLATAFORMA (lib/regras-de-plataforma.ts) diz o que existe. O ESTADO DA CONTA diz o que vale para
 * ESTA conta: programa, região, status, elegibilidade e a quota vista no app. Os dois só se encontram aqui,
 * em `avaliarPermissaoDaAcao` — a função ÚNICA que diz se uma ação pode ser feita. Nenhuma tela decide sozinha.
 *
 * Desconhecido é 'UNKNOWN' (texto) ou null (número) — nunca 0.
 */
import {
  antes, avaliarCotaDiaria, diaNoBrasil, podeBloquear, statusEfetivo,
  type Confianca, type Plataforma, type Regiao, type RegraDePlataforma, type StatusDaRegra,
} from '@/lib/regras-de-plataforma'

export type Desconhecido = 'UNKNOWN'
export type Participacao = 'PARTICIPA' | 'NAO_PARTICIPA' | Desconhecido
export type StatusDaConta = 'ATIVA' | 'RESTRITA' | 'SUSPENSA' | Desconhecido
export type Elegibilidade = 'ELEGIVEL' | 'NAO_ELEGIVEL' | Desconhecido
export type OrigemDoEstado = 'TELA_DO_APP' | 'FONTE_OFICIAL' | 'SUPORTE_TIKTOK' | Desconhecido

export const PARTICIPACOES: Participacao[] = ['PARTICIPA', 'NAO_PARTICIPA', 'UNKNOWN']
export const STATUS_DA_CONTA: StatusDaConta[] = ['ATIVA', 'RESTRITA', 'SUSPENSA', 'UNKNOWN']
export const ELEGIBILIDADES: Elegibilidade[] = ['ELEGIVEL', 'NAO_ELEGIVEL', 'UNKNOWN']
export const ORIGENS: OrigemDoEstado[] = ['TELA_DO_APP', 'FONTE_OFICIAL', 'SUPORTE_TIKTOK', 'UNKNOWN']

/** O que se sabe da conta num programa. */
export interface EstadoDaConta {
  plataforma: Plataforma
  conta: string
  programa: string
  participacao: Participacao
  regiao: Regiao | Desconhecido
  statusDaConta: StatusDaConta
  elegibilidade: Elegibilidade
  regraDaQuota: string | null
  quotaDiaria: number | null
  origem: OrigemDoEstado
  dataDaFonte: string | null
  verificadaEm: string | null
  confianca: Confianca
  observacoes: string | null
  revisarEm: string | null
  expiraEm: string | null
  atualizadoEm: string | null
}

/** Revisão padrão do estado conferido no app: 30 dias (o app muda sem aviso). */
export const DIAS_PARA_REVISAR_O_ESTADO = 30

const dia = (iso: string) => iso.slice(0, 10)
const maisDias = (iso: string, n: number) => diaNoBrasil(new Date(new Date(`${dia(iso)}T12:00:00-03:00`).getTime() + n * 86_400_000))

/** Quando o estado precisa ser conferido de novo (o informado, ou 30 dias depois da conferência). */
export const revisaoDoEstado = (e: EstadoDaConta) => (e.revisarEm ? dia(e.revisarEm) : e.verificadaEm ? maisDias(e.verificadaEm, DIAS_PARA_REVISAR_O_ESTADO) : null)

/** Estado vencido (revisão/expiração passou) ou sem conferência não vale: volta a ser desconhecido. */
export function estadoVigente(e: EstadoDaConta, agora: Date): boolean {
  if (e.origem === 'UNKNOWN' || !e.verificadaEm) return false
  if (antes(e.expiraEm && dia(e.expiraEm), agora)) return false
  return !antes(revisaoDoEstado(e), agora)
}

/** Ações que a plataforma pode limitar. Vídeo normal (sem produto) não consome a quota de vídeo comprável. */
export type TipoDeAcao = 'PUBLICAR_VIDEO' | 'PUBLICAR_VIDEO_PROMOCIONAL'
export const REGRAS_POR_ACAO: Record<TipoDeAcao, { plataforma: Plataforma; regra: string }[]> = {
  PUBLICAR_VIDEO: [],
  PUBLICAR_VIDEO_PROMOCIONAL: [{ plataforma: 'TIKTOK_SHOP', regra: 'VIDEOS_COMPRAVEIS_POR_DIA' }],
}
/** Vídeo com produto vinculado (âncora do TikTok Shop) é promocional; sem produto é normal. */
export const tipoDaPublicacao = (a: { candidatoId?: string | null; produtoId?: string | null }): TipoDeAcao =>
  a.candidatoId || a.produtoId ? 'PUBLICAR_VIDEO_PROMOCIONAL' : 'PUBLICAR_VIDEO'

export type ResultadoDaPermissao = 'PERMITIDA' | 'PERMITIDA_COM_AVISO' | 'BLOQUEADA' | 'DESCONHECIDA'

export interface PermissaoDaAcao {
  acao: TipoDeAcao
  resultado: ResultadoDaPermissao
  motivo: string
  /** Regra que decidiu (código e id), quando houver. */
  regra: string | null
  regraId: string | null
  fonte: string | null
  validade: { verificadaEm: string | null; revisarEm: string | null; expiraEm: string | null } | null
  limite: number | null
  usadoHoje: number
  quotaRestante: number | null
  confianca: Confianca | null
  /** Programa do contador (distingue as quotas de programas diferentes). */
  programaDoContador: string
  /** Dia da quota (Brasília). */
  dia: string
  avisos: string[]
}

export interface ContextoDaAcao {
  acao: TipoDeAcao
  regras: readonly RegraDePlataforma[]
  estados: readonly EstadoDaConta[]
  /** Uso de hoje por `chaveDoContador(regra, programa)` (vem do contador diário). */
  usadoHoje: Record<string, number>
  agora: Date
}

export const chaveDoContador = (regra: string, programa: string) => `${regra}|${programa}`
/**
 * Uso do dia na regra: a SOMA de todos os programas. Os vídeos são os mesmos qualquer que seja o programa em
 * que foram contados (mudar de programa no meio do dia não "zera" a quota). O programa fica no contador para auditoria.
 */
export const usoTotal = (usadoHoje: Record<string, number>, regra: string) =>
  Object.entries(usadoHoje).reduce((s, [k, v]) => (k.startsWith(`${regra}|`) ? s + v : s), 0)

/** Regra DA CONTA construída do estado conferido (a titular viu o número no app, ou fonte oficial da conta). */
export function regraDaContaDoEstado(base: RegraDePlataforma | undefined, e: EstadoDaConta, agora: Date): RegraDePlataforma | null {
  if (!estadoVigente(e, agora) || e.participacao !== 'PARTICIPA' || e.quotaDiaria == null || !e.regraDaQuota) return null
  return {
    id: `${base?.id ?? e.regraDaQuota}:conta`, plataforma: e.plataforma, programa: e.programa, escopo: 'CONTA',
    // Vista na própria conta: vale para ela qualquer que seja a região (região desconhecida não anula o que a titular viu).
    regiao: e.regiao === 'UNKNOWN' ? 'GLOBAL' : e.regiao,
    regra: e.regraDaQuota, descricao: base?.descricao ?? e.regraDaQuota, limite: e.quotaDiaria, unidade: base?.unidade ?? null,
    fonte: e.origem === 'FONTE_OFICIAL' ? 'Fonte oficial (registrada para esta conta)' : e.origem === 'SUPORTE_TIKTOK' ? 'Suporte do TikTok (registrado para esta conta)' : 'Tela do app TikTok (conferido pela titular)',
    referencia: null, dataDaFonte: e.dataDaFonte ? dia(e.dataDaFonte) : dia(e.verificadaEm!), verificadaEm: dia(e.verificadaEm!), vigenciaInicio: null,
    revisarEm: revisaoDoEstado(e), expiraEm: e.expiraEm ? dia(e.expiraEm) : null, confianca: e.confianca,
    status: e.origem === 'FONTE_OFICIAL' ? 'CONFIRMADA' : 'CONFIRMADA_PELA_TITULAR', observacao: e.observacoes ?? undefined,
  }
}

const GRAVIDADE: Record<ResultadoDaPermissao, number> = { PERMITIDA: 0, PERMITIDA_COM_AVISO: 1, DESCONHECIDA: 2, BLOQUEADA: 3 }

/** Programa cujo contador vale para a regra nesta conta (o da regra da conta, o de um programa em que participa, ou PLATAFORMA). */
export function programaDoContador(regras: readonly RegraDePlataforma[], estados: readonly EstadoDaConta[], regra: string, agora: Date): string {
  const vigentes = estados.filter((e) => estadoVigente(e, agora))
  const participa = vigentes.filter((e) => e.participacao === 'PARTICIPA').map((e) => e.programa)
  const daConta = vigentes.find((e) => e.regraDaQuota === regra && e.participacao === 'PARTICIPA' && e.quotaDiaria != null)
  if (daConta) return daConta.programa
  const deProgramaQueParticipa = regras.find((r) => r.regra === regra && r.escopo !== 'PLATAFORMA' && r.programa && participa.includes(r.programa))
  return deProgramaQueParticipa?.programa ?? 'PLATAFORMA'
}

/**
 * A função ÚNICA de bloqueio. Só BLOQUEIA com regra confirmada (fonte oficial ou conferida no app) que se
 * aplica a esta conta, vigente, com a quota esgotada — ou com a conta SUSPENSA confirmada. Regra não
 * confirmada, de outro programa, vencida ou futura nunca bloqueia. Sem dado suficiente: DESCONHECIDA
 * (não bloqueia, mas diz o que falta).
 */
export function avaliarPermissaoDaAcao(c: ContextoDaAcao): PermissaoDaAcao {
  const hoje = diaNoBrasil(c.agora)
  const vigentes = c.estados.filter((e) => estadoVigente(e, c.agora))
  const avisosDeEstado = c.estados.filter((e) => e.origem !== 'UNKNOWN' && !estadoVigente(e, c.agora))
    .map((e) => `O estado da conta no ${e.programa} precisa ser conferido de novo (conferido em ${e.verificadaEm ? dia(e.verificadaEm) : '—'}); até lá vale como desconhecido.`)
  const base: PermissaoDaAcao = { acao: c.acao, resultado: 'PERMITIDA', motivo: 'Nenhuma regra da plataforma limita esta ação.', regra: null, regraId: null, fonte: null, validade: null, limite: null, usadoHoje: 0, quotaRestante: null, confianca: null, programaDoContador: 'PLATAFORMA', dia: hoje, avisos: avisosDeEstado }
  const exigidas = REGRAS_POR_ACAO[c.acao]

  for (const plataforma of new Set(exigidas.map((x) => x.plataforma))) {
    const suspensa = vigentes.find((e) => e.plataforma === plataforma && e.statusDaConta === 'SUSPENSA')
    if (suspensa) {
      return { ...base, resultado: 'BLOQUEADA', motivo: `Ação indisponível: conta suspensa na plataforma (conferido em ${dia(suspensa.verificadaEm!)}).`, fonte: suspensa.origem, confianca: suspensa.confianca, validade: { verificadaEm: suspensa.verificadaEm, revisarEm: revisaoDoEstado(suspensa), expiraEm: suspensa.expiraEm } }
    }
  }

  const resultados: PermissaoDaAcao[] = []
  for (const { plataforma, regra } of exigidas) {
    const daPlataforma = vigentes.filter((e) => e.plataforma === plataforma)
    const regioes = new Set(daPlataforma.map((e) => e.regiao).filter((r) => r !== 'UNKNOWN'))
    const regiao: Regiao | Desconhecido = regioes.size === 1 ? ([...regioes][0] as Regiao) : 'UNKNOWN'
    const programas = daPlataforma.filter((e) => e.participacao === 'PARTICIPA').map((e) => e.programa)
    const daConta = daPlataforma.filter((e) => e.regraDaQuota === regra)
      .map((e) => regraDaContaDoEstado(c.regras.find((r) => r.regra === regra && r.programa === e.programa), e, c.agora))
      .filter((x): x is RegraDePlataforma => !!x)
    const todas = [...c.regras, ...daConta]
    // Região desconhecida: só regra GLOBAL ou da própria conta pode ser avaliada com segurança.
    const avaliaveis = regiao === 'UNKNOWN' ? todas.filter((r) => r.regiao === 'GLOBAL' || r.escopo === 'CONTA') : todas
    const programa = programaDoContador(c.regras, c.estados, regra, c.agora)
    const usado = usoTotal(c.usadoHoje, regra)
    const cota = avaliarCotaDiaria(avaliaveis, { plataforma, regra, conta: { regiao: regiao === 'UNKNOWN' ? 'GLOBAL' : regiao, programas }, usadoHoje: usado, agora: c.agora })
    const informativas = cota.informativas.map((i) => `${i.descricao} (${i.status}: ${i.motivo}).`)
    const comum: PermissaoDaAcao = { ...base, regra, programaDoContador: programa, usadoHoje: usado, avisos: [...avisosDeEstado, ...informativas] }
    const escolhida = cota.regraId ? todas.find((r) => r.id === cota.regraId) ?? null : null
    if (cota.limite != null && escolhida) {
      const ultima = cota.restante === 1
      resultados.push({
        ...comum, regraId: escolhida.id, fonte: escolhida.fonte, confianca: escolhida.confianca,
        validade: { verificadaEm: escolhida.verificadaEm, revisarEm: escolhida.revisarEm, expiraEm: escolhida.expiraEm },
        limite: cota.limite, quotaRestante: cota.restante,
        resultado: cota.bloqueia ? 'BLOQUEADA' : ultima ? 'PERMITIDA_COM_AVISO' : 'PERMITIDA',
        motivo: cota.bloqueia ? `Ação indisponível: quota oficial atingida (${usado}/${cota.limite} hoje — ${escolhida.fonte}).`
          : ultima ? `Última disponível hoje (${usado}/${cota.limite} — ${escolhida.fonte}).` : cota.motivo,
      })
      continue
    }
    // Sem limite confirmado: diz por quê, sem bloquear.
    const doCodigo = todas.filter((r) => r.plataforma === plataforma && r.regra === regra)
    const participacaoDesconhecida = doCodigo.filter((r) => r.escopo !== 'PLATAFORMA' && r.programa && !daPlataforma.some((e) => e.programa === r.programa && e.participacao !== 'UNKNOWN'))
    const regiaoDesconhecida = regiao === 'UNKNOWN' && doCodigo.some((r) => r.regiao !== 'GLOBAL')
    const naoConfirmadaQueVale = doCodigo.filter((r) => (r.regiao === 'GLOBAL' || r.regiao === regiao) && (r.escopo === 'PLATAFORMA' || (r.programa && programas.includes(r.programa))) && !podeBloquear(r, c.agora))
    if (participacaoDesconhecida.length || regiaoDesconhecida) {
      resultados.push({
        ...comum, resultado: 'DESCONHECIDA', confianca: 'BAIXA',
        motivo: `Limite não confirmado — não bloqueante. ${participacaoDesconhecida.length ? `Não se sabe se a conta está no ${[...new Set(participacaoDesconhecida.map((r) => r.programa))].join(', ')}` : 'A região da conta não foi confirmada'}: confira no app para o Patrono contar o limite certo.`,
      })
    } else if (naoConfirmadaQueVale.length) {
      const r = naoConfirmadaQueVale[0]
      resultados.push({ ...comum, resultado: 'PERMITIDA_COM_AVISO', regraId: r.id, fonte: r.fonte, confianca: r.confianca, validade: { verificadaEm: r.verificadaEm, revisarEm: r.revisarEm, expiraEm: r.expiraEm }, motivo: `Limite não confirmado — não bloqueante (${r.descricao} Status: ${rotuloDoStatus(statusEfetivo(r, c.agora))}).` })
    } else {
      resultados.push({ ...comum, motivo: 'Sem regra da plataforma que limite a sua conta nesta ação.' })
    }
  }
  if (!resultados.length) return base
  return resultados.sort((a, b) => GRAVIDADE[b.resultado] - GRAVIDADE[a.resultado])[0]
}

/** Texto curto para a Operação (o lugar certo; nenhuma tela calcula sozinha). */
export function textoDaQuota(p: PermissaoDaAcao): string {
  if (p.resultado === 'BLOQUEADA') return p.limite != null ? `Ação indisponível: quota oficial atingida (${p.usadoHoje}/${p.limite} hoje)` : p.motivo
  if (p.limite != null) return `Publicações promocionais hoje: ${p.usadoHoje}/${p.limite}`
  if (p.resultado === 'DESCONHECIDA' || p.resultado === 'PERMITIDA_COM_AVISO') return `Publicações promocionais hoje: ${p.usadoHoje} · Limite não confirmado — não bloqueante`
  return `Publicações promocionais hoje: ${p.usadoHoje} · sem limite confirmado para a sua conta`
}

/** Rótulo de auditoria: deixa claro o que é CONFIRMADO, NÃO CONFIRMADO, EXPIRADO, EM REVISÃO ou AINDA NÃO VIGENTE. */
export function rotuloDoStatus(s: StatusDaRegra) {
  return ({ CONFIRMADA: 'CONFIRMADO', CONFIRMADA_PELA_TITULAR: 'CONFIRMADO NO APP', NAO_CONFIRMADA: 'NÃO CONFIRMADO', EXPIRADA: 'EXPIRADO', REVISAR: 'EM REVISÃO', FUTURA: 'AINDA NÃO VIGENTE' } as const)[s]
}

/** O efeito da regra nesta conta, em uma frase (tela de revisão). Usa a mesma lógica do motor. */
export function efeitoDaRegra(r: RegraDePlataforma, estados: readonly EstadoDaConta[], agora: Date): string {
  const vigentes = estados.filter((e) => estadoVigente(e, agora) && e.plataforma === r.plataforma)
  const regioes = new Set(vigentes.map((e) => e.regiao).filter((x) => x !== 'UNKNOWN'))
  const regiao = regioes.size === 1 ? [...regioes][0] : 'UNKNOWN'
  const st = statusEfetivo(r, agora)
  if (r.regiao !== 'GLOBAL' && regiao !== 'UNKNOWN' && r.regiao !== regiao) return `Não se aplica: regra da região ${r.regiao}.`
  if (r.escopo !== 'PLATAFORMA' && r.programa) {
    const e = vigentes.find((x) => x.programa === r.programa)
    if (!e || e.participacao === 'UNKNOWN') return `Desconhecido: não se sabe se a conta está no ${r.programa} (não bloqueia).`
    if (e.participacao === 'NAO_PARTICIPA') return `Não se aplica: a conta não está no ${r.programa}.`
  }
  if (!podeBloquear(r, agora)) return `Não bloqueia (${rotuloDoStatus(st)}).`
  return typeof r.limite === 'number' && r.unidade?.includes('por dia') ? `Limita: ${r.limite} ${r.unidade}.` : 'Vale para a conta (regra de cálculo/informativa).'
}
