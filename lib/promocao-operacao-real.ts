/**
 * Comprovação e promoção auditada para `REAL_OPERATION` (P0.2 — Bloco 3.1).
 *
 * ── A LACUNA QUE ESTE MÓDULO FECHA ──────────────────────────────────────
 * Depois do Bloco 3 o sistema estava corretamente fail-closed e, por isso
 * mesmo, travado: a tela cria `USER_REPORTED`, a autoridade exige
 * `REAL_OPERATION` mais evidência, e nada no código produzia nenhum dos
 * dois. Não existia caminho legítimo para a primeira operação real.
 *
 * ── DOIS CAMINHOS, CAPACIDADES DIFERENTES (revisão de confiança) ─────────
 * Antes havia uma função só, e o tipo de evidência vinha no payload. Uma
 * futura rota poderia enviar `PROVIDER_OFICIAL` + `"webhook-123"` e
 * fabricar prova. Agora os caminhos são estruturalmente distintos:
 *
 *   promoverPorCorrecaoManual()      ← o ÚNICO que a interface pode chamar.
 *                                      Exige usuária autenticada do MESMO
 *                                      workspace, motivo e referência.
 *
 *   promoverPorEvidenciaVerificada() ← exige uma `FonteVerificada`, que só
 *                                      `verificarEvidencia()` emite, a
 *                                      pedido de um verificador registrado
 *                                      que consultou a fonte externa.
 *
 * Não há campo "tipo de evidência" aceito do chamador no segundo caminho: o
 * tipo vem da fonte verificada. Um objeto montado à mão não passa na
 * checagem de runtime (`WeakSet` em `evidencia-verificada.ts`).
 *
 * ── PROMOVER ≠ SER ELEGÍVEL ─────────────────────────────────────────────
 * Promover muda a ORIGEM do registro. Elegibilidade continua dependendo de
 * venda CONFIRMED, comissão reconhecida e relações coerentes. Uma venda
 * pode ser promovida com evidência impecável e continuar inelegível porque
 * ainda está PENDING — e isso é correto, não é bug. Por isso a função
 * devolve o veredito da autoridade, nunca a própria conclusão.
 *
 * ── TUDO OU NADA ────────────────────────────────────────────────────────
 * Validar → registrar evidência → promover origem → auditar acontecem na
 * MESMA transação, protegida por advisory lock na chave da evidência. Uma
 * venda promovida sem evidência registrada, ou evidência registrada sem
 * promoção, seria pior que não ter o mecanismo: pareceria comprovada.
 *
 * ── CORREÇÃO MANUAL É EXCEÇÃO, NÃO ROTINA ───────────────────────────────
 * `CORRECAO_MANUAL_AUDITADA` existe para destravar o primeiro ciclo real
 * sem depender da Affiliate API do TikTok. Ela não é, e não pode virar, o
 * jeito normal de confirmar venda — ver `PENDENCIA_DE_AUTOMACAO` no fim
 * deste arquivo.
 */

import { prisma } from './prisma'
import { ORIGENS_PROMOVIVEIS, normalizarOrigemDeRegistro, type OrigemDeRegistro } from './proveniencia'
import { ehFonteVerificada, type FonteVerificada } from './evidencia-verificada'
import {
  ACAO_AUDIT_EVIDENCIA,
  avaliarVendaParaOperacaoReal,
  type VereditoDeOperacaoReal,
} from './real-operation'

export const ACAO_AUDIT_PROMOCAO = 'venda.promovida_para_operacao_real'

/**
 * Origens que PODEM ser promovidas.
 *
 * `USER_REPORTED` é relato de boa-fé da proprietária; `UNVERIFIED` é
 * registro cuja origem nunca foi estabelecida. Ambos são afirmações sobre
 * uma venda que pode muito bem ter acontecido — só faltava prova.
 *
 * `SEED`, `TEST_FIXTURE`, `DEMO` e `SYNTHETIC_TEST` estão FORA e nunca
 * entram: não são afirmações sobre o mundo, são dados que o próprio sistema
 * fabricou. Nenhuma evidência externa pode tornar real o que nasceu
 * sintético — promover um deles seria falsificar a procedência, não
 * comprová-la.
 *
 * A constante foi movida para `lib/proveniencia.ts` — módulo puro, que a
 * interface também consegue importar — e é reexportada aqui para manter
 * esta API pública igual. A REGRA continua inteiramente neste arquivo.
 */
export { ORIGENS_PROMOVIVEIS }

export const MOTIVOS_RECUSA_PROMOCAO = [
  'VENDA_NAO_ENCONTRADA',
  'ORIGEM_SINTETICA_NAO_PROMOVIVEL',
  'ORIGEM_NAO_PROMOVIVEL',
  'JA_ERA_OPERACAO_REAL',
  'REFERENCIA_AUSENTE',
  'RESPONSAVEL_AUSENTE',
  /** O usuário informado não existe OU não pertence ao workspace da venda. */
  'RESPONSAVEL_INVALIDO',
  'MOTIVO_AUSENTE',
  'MOTIVO_INSUFICIENTE',
  /** A "fonte verificada" não foi emitida por `verificarEvidencia()`. */
  'FONTE_NAO_VERIFICADA',
  /**
   * A fonte É legítima, mas foi verificada para OUTRO alvo — outra venda,
   * outro workspace ou outra comissão. Motivo separado de propósito: "não
   * foi verificada" e "foi verificada, mas para outra coisa" são problemas
   * diferentes, e confundi-los esconderia uma tentativa de reaproveitamento.
   */
  'FONTE_NAO_CORRESPONDE_AO_ALVO',
  /** Evidência sobre comissão sem `commissionId`. */
  'COMISSAO_NAO_INFORMADA',
  /** A comissão indicada não confere: não existe, é de outra venda/workspace, ou não está CONFIRMED/RECEIVED. */
  'COMISSAO_NAO_COMPROVADA',
  'WORKSPACE_AUSENTE',
] as const

export type MotivoRecusaPromocao = (typeof MOTIVOS_RECUSA_PROMOCAO)[number]

/** Tamanho mínimo de um motivo de correção manual: uma frase, não uma letra. */
export const TAMANHO_MINIMO_DO_MOTIVO = 10

// ── Pedidos ─────────────────────────────────────────────────────────────

export interface PedidoDeCorrecaoManual {
  workspaceId: string
  saleId: string
  /** Usuária autenticada que assina a correção. Conferida contra o banco. */
  responsavelUserId: string
  motivo: string
  /** Onde a comprovação foi conferida (extrato, print de painel, protocolo). */
  referencia: string
}

export interface PedidoDeEvidenciaVerificada {
  workspaceId: string
  saleId: string
  /** Emitida por `verificarEvidencia()`. Checada em runtime, não por tipo. */
  fonte: FonteVerificada
  /** Obrigatório quando a fonte é `COMISSAO_CONFIRMADA_COM_ORIGEM_VERIFICAVEL`. */
  commissionId?: string | null
}

export interface ResultadoDaPromocao {
  promovido: boolean
  /** `true` quando a MESMA evidência já havia promovido esta venda antes. */
  idempotente: boolean
  motivo: MotivoRecusaPromocao | null
  explicacao: string
  saleId: string
  workspaceId: string
  origemAnterior: OrigemDeRegistro | null
  origemNova: OrigemDeRegistro | null
  evidencia: { tipo: string; referencia: string; commissionId?: string | null } | null
  /** Veredito da autoridade única APÓS a promoção. `null` se nada mudou. */
  veredito: VereditoDeOperacaoReal | null
}

function textoUtil(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

/**
 * Chave determinística da evidência: workspace + venda + tipo + referência.
 *
 * O MESMO evento de webhook reprocessado, ou a mesma linha de extrato
 * conferida duas vezes, produz a mesma chave — e a segunda tentativa não
 * cria auditoria duplicada nem promove de novo.
 */
export function chaveDaEvidencia(p: {
  workspaceId: string
  saleId: string
  tipoEvidencia: string
  referencia: string
}): string {
  return [p.workspaceId, p.saleId, p.tipoEvidencia, p.referencia.trim()].join('|')
}

// ── Validação pura ──────────────────────────────────────────────────────

export interface ContextoDaVenda {
  origemAtual: string
  /**
   * `true` quando o `responsavelUserId` existe E pertence ao workspace da
   * venda. Conferido contra o banco — a FK de `AuditLog.userId` não basta:
   * ela garante que o usuário existe, não que é DESTE negócio.
   */
  responsavelDoWorkspace?: boolean
  /**
   * `true` quando a comissão indicada existe, é DESTA venda, DESTE
   * workspace e está CONFIRMED ou RECEIVED.
   */
  comissaoComprovada?: boolean
}

export type ResultadoValidacao =
  | { ok: true }
  | { ok: false; motivo: MotivoRecusaPromocao; explicacao: string }

function recusar(motivo: MotivoRecusaPromocao, explicacao: string): ResultadoValidacao {
  return { ok: false, motivo, explicacao }
}

/** Regras comuns aos dois caminhos: identificação e origem promovível. */
export function validarOrigemPromovivel(
  identificacao: { workspaceId: string; saleId: string },
  origemAtual: string
): ResultadoValidacao {
  if (!textoUtil(identificacao?.workspaceId) || !textoUtil(identificacao?.saleId)) {
    return recusar(
      'WORKSPACE_AUSENTE',
      'Promoção exige workspaceId e saleId juntos — um id de venda solto não identifica de quem é a venda.'
    )
  }
  const origem = normalizarOrigemDeRegistro(origemAtual)
  if (origem === 'REAL_OPERATION') {
    return recusar('JA_ERA_OPERACAO_REAL', 'Esta venda já está marcada como operação real.')
  }
  if (['SEED', 'TEST_FIXTURE', 'DEMO', 'SYNTHETIC_TEST'].includes(origem)) {
    // Dado que o sistema fabricou não vira real por evidência nenhuma:
    // isso seria falsificar a procedência, não comprová-la.
    return recusar(
      'ORIGEM_SINTETICA_NAO_PROMOVIVEL',
      `Origem ${origem} é dado sintético e nunca pode ser promovida — nem com evidência externa válida.`
    )
  }
  if (!(ORIGENS_PROMOVIVEIS as readonly string[]).includes(origem)) {
    return recusar('ORIGEM_NAO_PROMOVIVEL', `Origem ${origem} não está na lista de origens promovíveis.`)
  }
  return { ok: true }
}

/** VALIDAÇÃO PURA da correção manual. */
export function validarCorrecaoManual(
  pedido: PedidoDeCorrecaoManual,
  contexto: ContextoDaVenda
): ResultadoValidacao {
  const base = validarOrigemPromovivel(pedido ?? ({} as PedidoDeCorrecaoManual), contexto?.origemAtual)
  if (!base.ok) return base

  if (!textoUtil(pedido.responsavelUserId)) {
    return recusar(
      'RESPONSAVEL_AUSENTE',
      'Correção manual exige o usuário responsável — uma correção sem quem assinou é indistinguível de alguém ter digitado "é real".'
    )
  }
  if (contexto?.responsavelDoWorkspace !== true) {
    // Mensagem única para "não existe" e "é de outro workspace": confirmar a
    // existência de um id alheio já vazaria informação sobre o outro negócio.
    return recusar(
      'RESPONSAVEL_INVALIDO',
      'O usuário responsável não pertence a este workspace.'
    )
  }
  if (!textoUtil(pedido.referencia)) {
    return recusar(
      'REFERENCIA_AUSENTE',
      'A correção manual precisa apontar onde a comprovação foi conferida (extrato, protocolo, painel).'
    )
  }
  if (!textoUtil(pedido.motivo)) {
    return recusar('MOTIVO_AUSENTE', 'Correção manual exige o motivo por escrito.')
  }
  if (pedido.motivo.trim().length < TAMANHO_MINIMO_DO_MOTIVO) {
    return recusar(
      'MOTIVO_INSUFICIENTE',
      `O motivo precisa explicar a correção (mínimo ${TAMANHO_MINIMO_DO_MOTIVO} caracteres) — "ok" não é justificativa.`
    )
  }
  return { ok: true }
}

/** VALIDAÇÃO PURA da evidência de sistema. */
export function validarEvidenciaVerificada(
  pedido: PedidoDeEvidenciaVerificada,
  contexto: ContextoDaVenda
): ResultadoValidacao {
  const base = validarOrigemPromovivel(pedido ?? ({} as PedidoDeEvidenciaVerificada), contexto?.origemAtual)
  if (!base.ok) return base

  // CHECAGEM DE RUNTIME, não de tipo: um objeto com o mesmo formato vindo de
  // `JSON.parse` de uma requisição não foi emitido por `verificarEvidencia()`
  // e não passa daqui.
  if (!ehFonteVerificada(pedido.fonte)) {
    return recusar(
      'FONTE_NAO_VERIFICADA',
      'A evidência não foi emitida por um verificador registrado. Referência preenchida não é referência verificada.'
    )
  }
  if (!textoUtil(pedido.fonte.referencia)) {
    return recusar('REFERENCIA_AUSENTE', 'A fonte verificada não trouxe referência externa.')
  }

  // ── CORRESPONDÊNCIA EXATA COM O ALVO VERIFICADO ────────────────────
  // Ser legítima não basta: a fonte tem de ter sido verificada PARA ESTE
  // objeto. Sem isto, uma fonte emitida para a venda A do workspace A
  // promoveria a venda B do workspace B — replay puro.
  if (pedido.fonte.workspaceIdVerificado !== pedido.workspaceId) {
    return recusar(
      'FONTE_NAO_CORRESPONDE_AO_ALVO',
      'A evidência foi verificada para outro workspace — uma verificação não vale fora do negócio em que foi feita.'
    )
  }
  if (pedido.fonte.saleIdVerificado !== pedido.saleId) {
    return recusar(
      'FONTE_NAO_CORRESPONDE_AO_ALVO',
      'A evidência foi verificada para outra venda — comprovar uma venda não comprova as demais.'
    )
  }

  if (pedido.fonte.tipo === 'COMISSAO_CONFIRMADA_COM_ORIGEM_VERIFICAVEL') {
    if (!textoUtil(pedido.commissionId)) {
      return recusar(
        'COMISSAO_NAO_INFORMADA',
        'Evidência sobre comissão precisa dizer QUAL comissão foi comprovada — referência genérica não basta.'
      )
    }
    // Vale inclusive entre comissões da MESMA venda: conferir a comissão X
    // não diz nada sobre a comissão Y.
    if (pedido.fonte.commissionIdVerificado !== pedido.commissionId.trim()) {
      return recusar(
        'FONTE_NAO_CORRESPONDE_AO_ALVO',
        'A evidência foi verificada para outra comissão — mesmo dentro da mesma venda, cada comissão precisa da sua conferência.'
      )
    }
    if (contexto?.comissaoComprovada !== true) {
      return recusar(
        'COMISSAO_NAO_COMPROVADA',
        'A comissão indicada não confere: não existe, é de outra venda ou workspace, ou não está CONFIRMED/RECEIVED.'
      )
    }
  }

  return { ok: true }
}

// ── Execução ────────────────────────────────────────────────────────────

interface EntradaInterna {
  workspaceId: string
  saleId: string
  tipoEvidencia: string
  referencia: string
  commissionId: string | null
  responsavelUserId: string | null
  motivo: string | null
  verificadorId: string | null
  /** Alvo que a fonte atestou. `null` na correção manual (não há fonte). */
  alvoVerificado: {
    workspaceId: string
    saleId: string
    commissionId: string | null
    verificadaEm: string
  } | null
  atorTipo: 'USUARIA' | 'VERIFICADOR'
  validar: (contexto: ContextoDaVenda) => ResultadoValidacao
}

function resultadoBase(workspaceId: string, saleId: string) {
  return {
    saleId: saleId ?? '',
    workspaceId: workspaceId ?? '',
    origemAnterior: null,
    origemNova: null,
    evidencia: null,
    veredito: null,
  }
}

/**
 * Núcleo transacional compartilhado pelos dois caminhos.
 *
 *   1. trava a chave da evidência (advisory lock);
 *   2. lê a venda DESTE workspace;
 *   3. apura o contexto NO BANCO (responsável, comissão);
 *   4. valida;
 *   5. registra a evidência;
 *   6. muda `Sale.dataOrigin`;
 *   7. registra a promoção, com estado anterior e novo.
 */
async function executarPromocao(entrada: EntradaInterna): Promise<ResultadoDaPromocao> {
  const base = resultadoBase(entrada.workspaceId, entrada.saleId)

  if (!textoUtil(entrada.workspaceId) || !textoUtil(entrada.saleId)) {
    return {
      ...base,
      promovido: false,
      idempotente: false,
      motivo: 'WORKSPACE_AUSENTE',
      explicacao: 'Promoção exige workspaceId e saleId juntos.',
    }
  }

  const chave = chaveDaEvidencia({
    workspaceId: entrada.workspaceId,
    saleId: entrada.saleId,
    tipoEvidencia: entrada.tipoEvidencia,
    referencia: entrada.referencia ?? '',
  })

  const resultado = await prisma.$transaction(async (tx) => {
    // Serializa por chave de evidência: duas entregas simultâneas do mesmo
    // webhook não conseguem promover duas vezes nem duplicar auditoria.
    await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtext(${chave}))) AS trava`

    // A venda é buscada SEMPRE com o workspace junto — nunca por id solto.
    const venda = await tx.sale.findFirst({
      where: { id: entrada.saleId, workspaceId: entrada.workspaceId },
      select: { id: true, dataOrigin: true },
    })
    if (!venda) {
      return {
        ...base,
        promovido: false,
        idempotente: false,
        motivo: 'VENDA_NAO_ENCONTRADA' as const,
        explicacao: 'Venda não encontrada neste workspace.',
      }
    }

    // Idempotência: a MESMA evidência já registrada para esta venda.
    const jaRegistrada = await tx.auditLog.findFirst({
      where: {
        workspaceId: entrada.workspaceId,
        action: ACAO_AUDIT_EVIDENCIA,
        entityType: 'Sale',
        entityId: entrada.saleId,
        metadata: { path: ['chaveEvidencia'], equals: chave },
      },
      select: { id: true },
    })
    if (jaRegistrada) {
      const origem = normalizarOrigemDeRegistro(venda.dataOrigin)
      return {
        ...base,
        promovido: false,
        idempotente: true,
        motivo: null,
        origemAnterior: origem,
        origemNova: origem,
        evidencia: {
          tipo: entrada.tipoEvidencia,
          referencia: entrada.referencia,
          commissionId: entrada.commissionId,
        },
        explicacao: 'Esta evidência já havia sido registrada para esta venda — nada foi alterado nem duplicado.',
      }
    }

    // ── Contexto apurado NO BANCO, nunca aceito do chamador ───────────
    const contexto: ContextoDaVenda = { origemAtual: venda.dataOrigin }

    if (entrada.responsavelUserId) {
      // Não basta a FK de `AuditLog.userId`: ela garante que o usuário
      // existe, não que pertence ao workspace desta venda. Gravar a
      // auditoria assinada por alguém de outro negócio produziria um
      // registro que parece legítimo e não é.
      const responsavel = await tx.user.findFirst({
        where: { id: entrada.responsavelUserId, workspaceId: entrada.workspaceId },
        select: { id: true },
      })
      contexto.responsavelDoWorkspace = !!responsavel
    }

    if (entrada.commissionId) {
      // A comissão tem de existir, ser DESTA venda, DESTE workspace e estar
      // reconhecida. Os quatro, juntos.
      const comissao = await tx.commission.findFirst({
        where: {
          id: entrada.commissionId,
          workspaceId: entrada.workspaceId,
          saleId: entrada.saleId,
          status: { in: ['CONFIRMED', 'RECEIVED'] },
        },
        select: { id: true },
      })
      contexto.comissaoComprovada = !!comissao
    }

    const validacao = entrada.validar(contexto)
    if (!validacao.ok) {
      return {
        ...base,
        promovido: false,
        idempotente: false,
        motivo: validacao.motivo,
        explicacao: validacao.explicacao,
        origemAnterior: normalizarOrigemDeRegistro(venda.dataOrigin),
      }
    }

    const origemAnterior = normalizarOrigemDeRegistro(venda.dataOrigin)
    const agora = new Date()

    // Evidência primeiro: se algo falhar daqui em diante, a transação
    // desfaz tudo e a venda NÃO fica promovida sem prova.
    await tx.auditLog.create({
      data: {
        workspaceId: entrada.workspaceId,
        userId: entrada.responsavelUserId,
        action: ACAO_AUDIT_EVIDENCIA,
        entityType: 'Sale',
        entityId: entrada.saleId,
        metadata: {
          tipo: entrada.tipoEvidencia,
          referencia: entrada.referencia,
          chaveEvidencia: chave,
          atorTipo: entrada.atorTipo,
          responsavelUserId: entrada.responsavelUserId,
          verificadorId: entrada.verificadorId,
          commissionId: entrada.commissionId,
          // ALVO que a verificação atestou. Permite conferir depois que a
          // evidência não foi reaproveitada de outro objeto. Nunca contém
          // credencial: só ids do próprio sistema e o carimbo de tempo.
          workspaceIdVerificado: entrada.alvoVerificado?.workspaceId ?? null,
          saleIdVerificado: entrada.alvoVerificado?.saleId ?? null,
          commissionIdVerificado: entrada.alvoVerificado?.commissionId ?? null,
          verificadaEm: entrada.alvoVerificado?.verificadaEm ?? null,
          motivo: entrada.motivo,
          registradaEm: agora.toISOString(),
        } as never,
      },
    })

    await tx.sale.update({
      where: { id: entrada.saleId },
      data: { dataOrigin: 'REAL_OPERATION' },
    })

    await tx.auditLog.create({
      data: {
        workspaceId: entrada.workspaceId,
        userId: entrada.responsavelUserId,
        action: ACAO_AUDIT_PROMOCAO,
        entityType: 'Sale',
        entityId: entrada.saleId,
        metadata: {
          estadoAnterior: origemAnterior,
          estadoNovo: 'REAL_OPERATION',
          tipoEvidencia: entrada.tipoEvidencia,
          referencia: entrada.referencia,
          chaveEvidencia: chave,
          atorTipo: entrada.atorTipo,
          responsavelUserId: entrada.responsavelUserId,
          verificadorId: entrada.verificadorId,
          commissionId: entrada.commissionId,
          workspaceIdVerificado: entrada.alvoVerificado?.workspaceId ?? null,
          saleIdVerificado: entrada.alvoVerificado?.saleId ?? null,
          commissionIdVerificado: entrada.alvoVerificado?.commissionId ?? null,
          verificadaEm: entrada.alvoVerificado?.verificadaEm ?? null,
          motivo: entrada.motivo,
          promovidaEm: agora.toISOString(),
        } as never,
      },
    })

    return {
      ...base,
      promovido: true,
      idempotente: false,
      motivo: null,
      origemAnterior,
      origemNova: 'REAL_OPERATION' as OrigemDeRegistro,
      evidencia: {
        tipo: entrada.tipoEvidencia,
        referencia: entrada.referencia,
        commissionId: entrada.commissionId,
      },
      explicacao: `Venda promovida de ${origemAnterior} para REAL_OPERATION com evidência ${entrada.tipoEvidencia} (ref. ${entrada.referencia}).`,
    }
  })

  // Revalidação pela autoridade única, já com o dado gravado. Promover não
  // é o mesmo que ser elegível.
  if (resultado.promovido || resultado.idempotente) {
    const veredito = await avaliarVendaParaOperacaoReal(entrada.workspaceId, entrada.saleId)
    // GATILHO B (P0.2 Bloco 4.1): promoveu e ficou elegível → tenta rotular
    // a amostra como conversão real, sem ninguém pedir "atualizar ML".
    //
    // Quando NÃO fica elegível — promoção antes da comissão ser reconhecida —
    // nada é escrito, e quem retoma é o GATILHO C, na mudança da comissão.
    if (veredito?.elegivel) {
      await rotularAmostraDeOperacaoReal(entrada.workspaceId, entrada.saleId)
    }
    return { ...resultado, veredito }
  }
  return resultado
}

/**
 * Chama o Feature Store sem deixar que uma falha dele derrube a promoção ou
 * a atualização de comissão. O fato comercial é o principal; a observação de
 * ML é consequência, e uma consequência que falha vira log, não exceção.
 *
 * Idempotente: rotular de novo reaproveita a mesma amostra.
 */
export async function rotularAmostraDeOperacaoReal(
  workspaceId: string,
  saleId: string
): Promise<void> {
  try {
    const { registrarOperacaoRealNoFeatureStore } = await import('./ml-operacao-real')
    const r = await registrarOperacaoRealNoFeatureStore({ workspaceId, saleId })
    if (!r.registrado) {
      console.warn(`[ml-gatilho] amostra não rotulada (${r.motivo}) venda=${saleId}: ${r.explicacao}`)
    }

    // GERACAO publication_v1 (Etapa 2.d). As duas convivem: a antiga rotula
    // a amostra do Conteudo, esta rotula a da Publicacao atribuida pelo
    // clique. Uma nao substitui a outra, e nenhuma reescreve a da outra.
    const { rotularPositivoDaPublicacao } = await import('./ml-geracao-publicacao')
    const p = await rotularPositivoDaPublicacao({ workspaceId, saleId })
    if (!p.rotulado) {
      console.warn(`[ml-gatilho:publicacao] sem rotulo (${p.motivo}) venda=${saleId}: ${p.explicacao}`)
    }
  } catch (e) {
    console.error(`[ml-gatilho] falha ao rotular amostra da venda ${saleId} — o registro comercial seguiu normalmente:`, e)
  }
}

/**
 * CAMINHO MANUAL — o único que a interface pode iniciar.
 *
 * Exige usuária autenticada que pertença ao MESMO workspace da venda
 * (conferido contra o banco), motivo escrito e referência de onde a
 * comprovação foi conferida. É deliberadamente trabalhoso: comprovar venda
 * a venda à mão não deve ser confortável, porque não deve virar rotina.
 */
export async function promoverPorCorrecaoManual(
  pedido: PedidoDeCorrecaoManual
): Promise<ResultadoDaPromocao> {
  return executarPromocao({
    workspaceId: pedido?.workspaceId,
    saleId: pedido?.saleId,
    tipoEvidencia: 'CORRECAO_MANUAL_AUDITADA',
    referencia: (pedido?.referencia ?? '').trim(),
    commissionId: null,
    responsavelUserId: textoUtil(pedido?.responsavelUserId) ? pedido.responsavelUserId : null,
    motivo: (pedido?.motivo ?? '').trim() || null,
    verificadorId: null,
    alvoVerificado: null,
    atorTipo: 'USUARIA',
    validar: (contexto) => validarCorrecaoManual(pedido, contexto),
  })
}

/**
 * CAMINHO DE SISTEMA — indisponível para a interface.
 *
 * Só avança com uma `FonteVerificada` emitida por `verificarEvidencia()`. O
 * TIPO da evidência vem da fonte, não do chamador: não há como pedir
 * "promova isto como PROVIDER_OFICIAL".
 *
 * Hoje nenhum verificador está registrado, então este caminho está fechado
 * na prática — e é exatamente esse o estado correto enquanto não houver
 * integração de provider nem importação de conciliação.
 */
export async function promoverPorEvidenciaVerificada(
  pedido: PedidoDeEvidenciaVerificada
): Promise<ResultadoDaPromocao> {
  const fonteOk = ehFonteVerificada(pedido?.fonte)
  return executarPromocao({
    workspaceId: pedido?.workspaceId,
    saleId: pedido?.saleId,
    // Sem fonte legítima não há tipo: o rótulo nunca vem do payload.
    tipoEvidencia: fonteOk ? pedido.fonte.tipo : 'NAO_VERIFICADA',
    referencia: fonteOk ? pedido.fonte.referencia : '',
    commissionId: textoUtil(pedido?.commissionId) ? pedido.commissionId! : null,
    responsavelUserId: null,
    motivo: null,
    verificadorId: fonteOk ? pedido.fonte.verificadorId : null,
    alvoVerificado: fonteOk
      ? {
          workspaceId: pedido.fonte.workspaceIdVerificado,
          saleId: pedido.fonte.saleIdVerificado,
          commissionId: pedido.fonte.commissionIdVerificado,
          verificadaEm: pedido.fonte.verificadaEm.toISOString(),
        }
      : null,
    atorTipo: 'VERIFICADOR',
    validar: (contexto) => validarEvidenciaVerificada(pedido, contexto),
  })
}

/**
 * FILA DE AUTOMAÇÃO (regra permanente).
 *
 * `CORRECAO_MANUAL_AUDITADA` destrava o primeiro ciclo real sem depender da
 * Affiliate API do TikTok — e é exceção, não rotina. Se a proprietária
 * passar a comprovar venda a venda toda semana, isso deixou de ser exceção
 * e virou trabalho manual recorrente: dívida de automação, não "o jeito que
 * funciona".
 *
 * A confirmação recorrente precisa vir de `PROVIDER_OFICIAL` (webhook/API
 * do provider) ou `CONCILIACAO_FINANCEIRA` (importação de extrato/repasse),
 * cada uma como um verificador registrado em `evidencia-verificada.ts`.
 */
export const PENDENCIA_DE_AUTOMACAO = {
  chave: 'operacao-real:comprovacao-recorrente',
  explicacao:
    'A comprovação de venda real depende hoje de correção manual auditada. Recorrente, isso é dívida de automação: deve passar a vir de webhook/API oficial do provider ou de conciliação financeira importada, registrados como verificadores de evidência.',
  evidenciaManualAceitaHoje: 'CORRECAO_MANUAL_AUDITADA',
  substitutosAutomaticos: ['PROVIDER_OFICIAL', 'CONCILIACAO_FINANCEIRA'],
} as const
