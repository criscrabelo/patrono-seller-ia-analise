/**
 * P1.5.1 — renovação automática do acesso.
 *
 * Um token de 60 dias que vence e espera alguém reconectar é trabalho
 * manual recorrente — e a regra do projeto chama isso de dívida de
 * automação. O refresh token JÁ é o consentimento da proprietária,
 * guardado: usá-lo não pede nada de novo a ninguém.
 *
 * ── A PORTA, E POR QUE O TOKEN NÃO PASSA POR AQUI ───────────────────────
 * O renovador devolve apenas fatos públicos: nova validade, escopos
 * comprovados, motivo da falha. Quem grava o token novo é o próprio
 * renovador, dentro do adapter. Assim o segredo nunca atravessa o
 * orquestrador, nem o resultado do job, nem o log.
 *
 * ── NENHUM RENOVADOR REAL LIGADO ────────────────────────────────────────
 * `RENOVADORES_LIGADOS` está vazio nesta rodada, pelo mesmo motivo que
 * `ADAPTADORES_LIGADOS`: nenhuma chamada externa parte daqui sem
 * autorização específica. A orquestração se prova contra mocks.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import {
  lerAutorizacao,
  capabilityEfetivaDaConta,
  TIPO_JOB_RENOVAR_TOKEN,
  CAMPO_DOS_SCOPES,
  CAMPO_DA_COMPROVACAO,
  type AutorizacaoDaConta,
} from './autorizacao-da-conta'
import { higienizar } from './distribuicao-orquestrador'
import type { LinhaDaFila } from './automation-queue-repositorio'

export { TIPO_JOB_RENOVAR_TOKEN }

/** O que o renovador devolve. Nenhum campo aqui guarda segredo. */
export interface ResultadoDaRenovacao {
  ok: boolean
  /** Nova validade, quando o provider informa uma. */
  expiraEm: Date | null
  /** Escopos que o provider confirmou junto com o token novo. */
  scopes: string[] | null
  /** Mensagem já higienizada. */
  erro: string | null
  /** `true` quando repetir não adianta (refresh revogado, por exemplo). */
  fatal?: boolean
}

/**
 * Um renovador por canal.
 *
 * Ele recebe o id da integração, não o token: buscar e gravar o segredo é
 * responsabilidade dele, e essa fronteira é o que mantém o resto do
 * caminho livre de credencial.
 */
export interface RenovadorDeAcesso {
  canal: string
  renovar: (p: { workspaceId: string; integracaoId: string }) => Promise<ResultadoDaRenovacao>
}

/** Vazio de propósito — ver o cabeçalho. */
export const RENOVADORES_LIGADOS: Record<string, RenovadorDeAcesso> = {}

export const NENHUM_RENOVADOR_REAL_LIGADO = {
  chave: 'renovacao:renovadores-desligados',
  estado: 'Nenhum renovador real está registrado nesta rodada.',
  porque: 'Renovar chama o provider de verdade, e isso depende de autorização específica.',
  comoLigar: 'Registrar o renovador em RENOVADORES_LIGADOS. A orquestração já está pronta.',
} as const

export function renovadorDoCanal(
  canal: string,
  registro: Record<string, RenovadorDeAcesso> = RENOVADORES_LIGADOS
): RenovadorDeAcesso | null {
  return registro[(canal ?? '').trim().toLowerCase()] ?? null
}

// ── A execução ──────────────────────────────────────────────────────────

export const MOTIVOS_SEM_RENOVACAO = [
  'NAO_EXPIRADO',
  'SEM_REFRESH_TOKEN',
  'RENOVADOR_NAO_LIGADO',
  'INTEGRACAO_INDISPONIVEL',
] as const
export type MotivoSemRenovacao = (typeof MOTIVOS_SEM_RENOVACAO)[number]

export interface ResultadoDoJobDeRenovacao {
  ok: boolean
  aguardar: boolean
  motivo: MotivoSemRenovacao | null
  /** Como ficou a autorização DEPOIS da tentativa. */
  antes: AutorizacaoDaConta | null
  depois: AutorizacaoDaConta | null
  /** `true` quando a renovação destravou alguma capability efetiva. */
  destravou: boolean
  erroFatal: boolean
  explicacao: string
}

/**
 * Renova o acesso de uma conta — ou explica por que não renovou.
 *
 * Fail-closed em cada porta, e nenhuma delas grava token: quem grava é o
 * renovador. Aqui só se persiste o que é público (validade e escopos), e
 * só quando o provider os informou.
 */
export async function renovarAcessoDaConta(params: {
  workspaceId: string
  integracaoId: string
  canal: string
  renovadores?: Record<string, RenovadorDeAcesso>
  agora?: Date
  env?: Record<string, string | undefined>
}): Promise<ResultadoDoJobDeRenovacao> {
  const canal = (params.canal ?? '').trim().toLowerCase()
  const opcoes = { agora: params.agora, env: params.env }

  const antes = await lerAutorizacao({ workspaceId: params.workspaceId, canal, ...opcoes })

  const parar = (
    motivo: MotivoSemRenovacao,
    explicacao: string,
    aguardar = true
  ): ResultadoDoJobDeRenovacao => ({
    ok: false,
    aguardar,
    motivo,
    antes,
    depois: antes,
    destravou: false,
    erroFatal: false,
    explicacao,
  })

  if (antes.estado === 'DESCONECTADA') {
    return parar('INTEGRACAO_INDISPONIVEL', 'Não há conta conectada neste canal.')
  }
  if (!antes.expirado) {
    // Renovar o que ainda vale queimaria o refresh token à toa.
    return parar('NAO_EXPIRADO', 'O acesso ainda é válido — nada a renovar.')
  }
  if (!antes.podeRenovarSozinho) {
    return parar(
      'SEM_REFRESH_TOKEN',
      'O acesso venceu e não há refresh token: só uma nova autorização destrava.'
    )
  }

  const renovador = renovadorDoCanal(canal, params.renovadores ?? RENOVADORES_LIGADOS)
  if (!renovador) {
    return parar(
      'RENOVADOR_NAO_LIGADO',
      `Dá para renovar ${canal} sozinho, e nenhum renovador está ligado. ${NENHUM_RENOVADOR_REAL_LIGADO.comoLigar}`
    )
  }

  let resposta: ResultadoDaRenovacao
  try {
    resposta = await renovador.renovar({
      workspaceId: params.workspaceId,
      integracaoId: params.integracaoId,
    })
  } catch (e) {
    return {
      ok: false,
      aguardar: false,
      motivo: null,
      antes,
      depois: antes,
      destravou: false,
      erroFatal: false,
      explicacao: higienizar(e instanceof Error ? e.message : String(e)),
    }
  }

  if (!resposta.ok) {
    return {
      ok: false,
      aguardar: false,
      motivo: null,
      antes,
      depois: antes,
      destravou: false,
      erroFatal: resposta.fatal === true,
      explicacao: higienizar(resposta.erro) || 'O provider recusou a renovação.',
    }
  }

  // Só o que é público volta para o banco por este caminho. O token novo já
  // foi gravado pelo renovador, que é quem tem o direito de tocá-lo.
  const extra: Record<string, unknown> = {}
  if (resposta.scopes) {
    extra[CAMPO_DOS_SCOPES] = resposta.scopes
    extra[CAMPO_DA_COMPROVACAO] = (params.agora ?? new Date()).toISOString()
  }

  try {
    const atual = await prisma.integracao.findFirst({
      where: { id: params.integracaoId, workspaceId: params.workspaceId },
      select: { extraData: true },
    })
    if (!atual) {
      return parar('INTEGRACAO_INDISPONIVEL', 'Integração não encontrada neste workspace.')
    }
    const base = (atual.extraData ?? {}) as Record<string, unknown>
    await prisma.integracao.update({
      where: { id: params.integracaoId },
      data: {
        ...(resposta.expiraEm ? { tokenExpiry: resposta.expiraEm } : {}),
        extraData: { ...base, ...extra } as Prisma.InputJsonObject,
        updatedAt: params.agora ?? new Date(),
      },
    })
  } catch (e) {
    return {
      ok: false,
      aguardar: false,
      motivo: null,
      antes,
      depois: antes,
      destravou: false,
      erroFatal: false,
      explicacao: higienizar(e instanceof Error ? e.message : String(e)),
    }
  }

  const depois = await lerAutorizacao({ workspaceId: params.workspaceId, canal, ...opcoes })
  const destravou =
    !capabilityEfetivaDaConta(antes).algoLiberado && capabilityEfetivaDaConta(depois).algoLiberado

  return {
    ok: true,
    aguardar: false,
    motivo: null,
    antes,
    depois,
    destravou,
    erroFatal: false,
    explicacao: `Acesso de ${canal} renovado. Estado da autorização: ${depois.estado}.`,
  }
}

/** A ação que o executor do P1.4.1 passa a conhecer. */
export function acaoDeRenovarToken(ctx: {
  workspaceId: string
  renovadores?: Record<string, RenovadorDeAcesso>
  agora?: Date
  env?: Record<string, string | undefined>
}) {
  return async (job: LinhaDaFila) => {
    const contexto = job.contexto ?? {}
    const canal = String(contexto.canal ?? '')
    if (!canal) {
      return { ok: false, erroFatal: true, erro: 'Job de renovação sem canal declarado.' }
    }

    const r = await renovarAcessoDaConta({
      workspaceId: ctx.workspaceId,
      integracaoId: job.entityId,
      canal,
      renovadores: ctx.renovadores,
      agora: ctx.agora,
      env: ctx.env,
    })

    const resultado: Record<string, unknown> = {
      canal,
      estado: r.depois?.estado ?? null,
      expiraEm: r.depois?.expiraEm ? r.depois.expiraEm.toISOString() : null,
      scopes: r.depois?.scopesComprovados ?? null,
      destravou: r.destravou,
      custo: 0,
      reavaliarQuandoHouverCapacidade: r.aguardar,
    }

    if (r.ok) return { ok: true, resultado }
    if (r.aguardar) return { ok: false, aguardar: true, erro: r.explicacao, resultado }
    return { ok: false, erroFatal: r.erroFatal, erro: r.explicacao, resultado }
  }
}

/** REGRA PERMANENTE: o segredo não atravessa a orquestração. */
export const RENOVACAO_NAO_CARREGA_SEGREDO = {
  chave: 'renovacao:sem-segredo-no-caminho',
  quemGravaOToken: 'o renovador, dentro do adapter',
  oQueVoltaParaCa: ['validade', 'escopos comprovados', 'motivo da falha'],
  porque:
    'Um token que atravessa três camadas acaba num log. Mantendo-o no adapter, não há caminho por onde ele vaze.',
} as const
