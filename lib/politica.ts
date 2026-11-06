/**
 * P2.14.7 (Fase 0A) — Policy Engine versionado.
 *
 * UMA fonte de regras de negócio (autonomia, limites, risco, custo,
 * aprovação, rotulagem). Providers e motores NÃO decidem política: eles
 * perguntam `avaliarAcao()`.
 *
 * Versões são IMUTÁVEIS: mudar a política cria a versão N+1 e desativa a
 * anterior, na mesma transação. Toda decisão registra a versão que a
 * governou (`DecisionRecord.politicaVersao`).
 *
 * Sem política gravada vale `POLITICA_PADRAO` (versão 0): conservadora —
 * MANUAL, custo zero, aprovação para risco médio ou maior.
 */
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { registrarDecisao, registrarEvento } from './ledger'

const Modo = z.enum(['MANUAL', 'ASSISTED', 'AUTOMATIC'])
const Risco = z.enum(['BAIXO', 'MEDIO', 'ALTO'])
const ORDEM_DO_RISCO = { BAIXO: 0, MEDIO: 1, ALTO: 2 } as const

export const EsquemaDaPolitica = z.object({
  versaoDoEsquema: z.literal(1),
  autonomia: z.object({
    padrao: Modo,
    porCanal: z.record(z.string(), Modo).default({}),
  }),
  limites: z.object({
    publicacoesPorDiaPorCanal: z.number().int().min(0).max(50),
    precoMaximo: z.number().positive().nullable(),
    riscoMaximoSemAprovacao: Risco,
    categoriasBloqueadas: z.array(z.string()).default([]),
  }),
  custo: z.object({
    orcamentoMensalCentavos: z.number().int().min(0),
    orcamentoDiarioCentavos: z.number().int().min(0),
    exigirAprovacaoAcimaDeCentavos: z.number().int().min(0),
  }),
  aprovacao: z.object({
    primeiraPublicacaoPorCanal: z.boolean(),
  }),
  conteudo: z.object({
    rotularConteudoDeIA: z.literal(true), // não negociável (regras das plataformas)
    identificacaoPublicitaria: z.literal(true), // não negociável (publicidade)
  }),
})
export type RegrasDaPolitica = z.infer<typeof EsquemaDaPolitica>

export const POLITICA_PADRAO: RegrasDaPolitica = {
  versaoDoEsquema: 1,
  autonomia: { padrao: 'MANUAL', porCanal: {} },
  limites: { publicacoesPorDiaPorCanal: 3, precoMaximo: null, riscoMaximoSemAprovacao: 'BAIXO', categoriasBloqueadas: [] },
  custo: { orcamentoMensalCentavos: 0, orcamentoDiarioCentavos: 0, exigirAprovacaoAcimaDeCentavos: 0 },
  aprovacao: { primeiraPublicacaoPorCanal: true },
  conteudo: { rotularConteudoDeIA: true, identificacaoPublicitaria: true },
}

// ── Avaliação (PURA) ────────────────────────────────────────────────────

export type AcaoAvaliada =
  | { tipo: 'PUBLICAR'; canal: string; risco: 'BAIXO' | 'MEDIO' | 'ALTO'; preco?: number | null; categoria?: string | null; publicacoesHojeNoCanal: number; primeiraNoCanal?: boolean }
  | { tipo: 'ESCOLHER_PRODUTO'; risco: 'BAIXO' | 'MEDIO' | 'ALTO'; preco?: number | null; categoria?: string | null }
  | { tipo: 'GASTAR'; centavos: number; gastoNoMesCentavos: number; gastoNoDiaCentavos: number }

export interface ContextoDeSeguranca {
  /** Kill switch global, pausa do workspace ou Safe Mode: nada irreversível. */
  acoesIrreversiveisBloqueadas: boolean
  motivoDoBloqueio?: string
}

export type ResultadoDaPolitica = 'PERMITIR' | 'EXIGIR_APROVACAO' | 'BLOQUEAR'

export interface Avaliacao {
  resultado: ResultadoDaPolitica
  motivos: string[]
}

const IRREVERSIVEIS = new Set(['PUBLICAR', 'GASTAR'])

export function modoDoCanal(regras: RegrasDaPolitica, canal: string): 'MANUAL' | 'ASSISTED' | 'AUTOMATIC' {
  return regras.autonomia.porCanal[canal] ?? regras.autonomia.padrao
}

/** Decide se a ação pode acontecer sozinha, precisa da titular ou é proibida. */
export function avaliarAcao(regras: RegrasDaPolitica, acao: AcaoAvaliada, seguranca: ContextoDeSeguranca): Avaliacao {
  const motivos: string[] = []
  if (IRREVERSIVEIS.has(acao.tipo) && seguranca.acoesIrreversiveisBloqueadas) {
    return { resultado: 'BLOQUEAR', motivos: [seguranca.motivoDoBloqueio ?? 'Ações irreversíveis bloqueadas (kill switch / Safe Mode).'] }
  }

  if (acao.tipo === 'GASTAR') {
    const c = regras.custo
    if (acao.centavos <= 0) return { resultado: 'PERMITIR', motivos: ['Operação sem custo.'] }
    if (acao.gastoNoMesCentavos + acao.centavos > c.orcamentoMensalCentavos) {
      return { resultado: 'BLOQUEAR', motivos: [`Orçamento mensal (${c.orcamentoMensalCentavos} centavos) seria ultrapassado.`] }
    }
    if (acao.gastoNoDiaCentavos + acao.centavos > c.orcamentoDiarioCentavos) {
      return { resultado: 'BLOQUEAR', motivos: [`Orçamento diário (${c.orcamentoDiarioCentavos} centavos) seria ultrapassado.`] }
    }
    if (acao.centavos > c.exigirAprovacaoAcimaDeCentavos) {
      return { resultado: 'EXIGIR_APROVACAO', motivos: ['Gasto acima do limite de aprovação automática.'] }
    }
    return { resultado: 'PERMITIR', motivos: ['Dentro do orçamento autorizado.'] }
  }

  const { limites } = regras
  if (acao.categoria && limites.categoriasBloqueadas.includes(acao.categoria)) {
    return { resultado: 'BLOQUEAR', motivos: [`Categoria "${acao.categoria}" bloqueada pela política.`] }
  }
  if (typeof acao.preco === 'number' && limites.precoMaximo !== null && acao.preco > limites.precoMaximo) {
    return { resultado: 'BLOQUEAR', motivos: [`Preço R$ ${acao.preco.toFixed(2)} acima do máximo da política (R$ ${limites.precoMaximo}).`] }
  }

  if (acao.tipo === 'PUBLICAR') {
    if (acao.publicacoesHojeNoCanal >= limites.publicacoesPorDiaPorCanal) {
      return { resultado: 'BLOQUEAR', motivos: [`Limite de ${limites.publicacoesPorDiaPorCanal} publicação(ões)/dia em ${acao.canal} atingido.`] }
    }
    const modo = modoDoCanal(regras, acao.canal)
    if (modo === 'MANUAL') return { resultado: 'EXIGIR_APROVACAO', motivos: [`${acao.canal} está em modo MANUAL.`] }
    if (modo === 'ASSISTED') motivos.push(`${acao.canal} está em modo ASSISTED.`)
    if (acao.primeiraNoCanal && regras.aprovacao.primeiraPublicacaoPorCanal) motivos.push(`Primeira publicação em ${acao.canal}.`)
  }

  if (ORDEM_DO_RISCO[acao.risco] > ORDEM_DO_RISCO[limites.riscoMaximoSemAprovacao]) {
    motivos.push(`Risco ${acao.risco} acima do máximo sem aprovação (${limites.riscoMaximoSemAprovacao}).`)
  }
  if (acao.tipo === 'ESCOLHER_PRODUTO' && regras.autonomia.padrao === 'MANUAL') {
    motivos.push('Autonomia em MANUAL.')
  }
  return motivos.length ? { resultado: 'EXIGIR_APROVACAO', motivos } : { resultado: 'PERMITIR', motivos: ['Dentro da política.'] }
}

// ── Persistência versionada ─────────────────────────────────────────────

export interface PoliticaEfetiva {
  versao: number // 0 = padrão do código
  regras: RegrasDaPolitica
}

export async function politicaAtiva(workspaceId: string): Promise<PoliticaEfetiva> {
  const linha = await prisma.policyVersion.findFirst({ where: { workspaceId, ativa: true } })
  if (!linha) return { versao: 0, regras: POLITICA_PADRAO }
  const ok = EsquemaDaPolitica.safeParse(linha.regras)
  // Versão gravada inválida nunca relaxa nada: cai na padrão conservadora.
  return ok.success ? { versao: linha.versao, regras: ok.data } : { versao: 0, regras: POLITICA_PADRAO }
}

/** Cria a versão N+1 (validada) e desativa a anterior, atomicamente. */
export async function publicarPolitica(p: {
  workspaceId: string
  regras: unknown
  ator: 'TITULAR' | 'SISTEMA'
  userId?: string | null
  motivo?: string | null
}): Promise<PoliticaEfetiva> {
  const regras = EsquemaDaPolitica.parse(p.regras)
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS ok FROM pg_advisory_xact_lock(hashtextextended(${`politica:${p.workspaceId}`}, 0))`
    const ultima = await tx.policyVersion.findFirst({ where: { workspaceId: p.workspaceId }, orderBy: { versao: 'desc' }, select: { versao: true } })
    const versao = (ultima?.versao ?? 0) + 1
    await tx.policyVersion.updateMany({ where: { workspaceId: p.workspaceId, ativa: true }, data: { ativa: false } })
    await tx.policyVersion.create({
      data: {
        workspaceId: p.workspaceId,
        versao,
        regras: regras as unknown as Prisma.InputJsonValue,
        ator: p.ator,
        criadoPorUserId: p.userId ?? null,
        motivo: p.motivo ?? null,
        ativa: true,
      },
    })
    await registrarDecisao(
      {
        workspaceId: p.workspaceId,
        tipo: 'POLITICA_ALTERADA',
        ator: p.ator,
        atorUserId: p.userId ?? null,
        decisao: `Política v${versao} ativada.`,
        explicacao: p.motivo ? [p.motivo] : [],
        politicaVersao: versao,
        chaveIdempotencia: `politica:v${versao}`,
      },
      tx
    )
    await registrarEvento({ workspaceId: p.workspaceId, tipo: 'POLICY_CHANGED', chaveIdempotencia: `politica:v${versao}`, payload: { versao } }, tx)
    return { versao, regras }
  })
}
